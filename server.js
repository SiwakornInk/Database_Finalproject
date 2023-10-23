const express = require("express");
const mysql = require("mysql2");
const session = require("express-session");
const bodyParser = require("body-parser");

const app = express();
const port = 3000;

const db = mysql.createConnection({
  host: "localhost",
  user: "root",
  database: "dormitory",
});

db.connect((err) => {
  if (err) {
    console.error("Failed to connect to database:", err);
    process.exit(1);
  }
  console.log("Connected to database.");
});

const db_olap = mysql.createConnection({
  host: "localhost",
  user: "root",
  database: "olap_dormitory",
});

db_olap.connect((err) => {
  if (err) {
    console.error("Failed to connect to OLAP database:", err);
    process.exit(1);
  }
  console.log("Connected to OLAP database.");
});

app.use(
  session({
    secret: "Secret",
    resave: false,
    saveUninitialized: true,
  })
);

app.use(express.static("public"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.get("/", (req, res) => {
  res.redirect("/register.html");
});

app.post("/register", (req, res) => {
  const { name, username, pwd, pwd_repeat } = req.body;

  if (pwd !== pwd_repeat) {
    return res.status(400).json({ message: "password not match" });
  }

  db.query(
    "SELECT * FROM users WHERE username = ?",
    [username],
    (err, results) => {
      if (err) {
        console.error("Error checking username:", err);
        return res.status(500).send("Registration failed. Please try again.");
      }

      if (results.length > 0) {
        return res.status(400).json({ message: "Username has already use" });
      }

      db.query(
        'INSERT INTO users (name, username, password, role) VALUES (?, ?, ?, "user")',
        [name, username, pwd],
        (err, results) => {
          if (err) {
            console.error("Error inserting user:", err);
            return res
              .status(500)
              .json({ message: "Registration failed. Please try again." });
          }

          res.json({ message: "Successfully" });
        }
      );
    }
  );
});

app.post("/login", (req, res) => {
  const { username, pwd } = req.body;
  db.query(
    "SELECT username, role FROM users WHERE username = ? AND password = ?",
    [username, pwd],
    (err, results) => {
      if (err) {
        console.error("Error during login:", err);
        return res
          .status(500)
          .json({ message: "Login failed. Please try again." });
      }

      if (results.length === 0) {
        return res
          .status(401)
          .json({ message: "Invalid username or password." });
      }

      req.session.userName = results[0].username;

      const userRole = results[0].role;
      if (userRole === "user") {
        res.json({ redirect: "/user-main.html" });
      } else if (userRole === "admin") {
        res.json({ redirect: "/admin-main.html" });
      } else {
        res.status(401).json({ message: "Authentication failed." });
      }
    }
  );
});

app.get("/api/currentUserName", (req, res) => {
  if (req.session && req.session.userName) {
    res.json({ userName: req.session.userName });
  } else {
    res.status(401).send("User not logged in");
  }
});

app.get("/api/rooms", (req, res) => {
  const sql =
    "SELECT `dormitory_name`, `room_number`, `size (sq.m)`, `monthly_rent (baht)`, `is_available` FROM `rooms` WHERE `is_available` = 1";

  db.query(sql, (err, results) => {
    if (err) {
      console.error("Error fetching rooms:", err);
      return res.status(500).send("Failed to fetch rooms.");
    }
    res.json(results);
  });
});

app.post("/api/book", (req, res) => {
  const { dormitory_name, room_number, start_date } = req.body;
  const booking_time = new Date();
  const username = req.session.userName;

  const checkRoomAvailabilitySql = `
    SELECT is_available
    FROM rooms
    WHERE dormitory_name = ? AND room_number = ?
  `;

  db.query(
    checkRoomAvailabilitySql,
    [dormitory_name, room_number],
    (checkErr, checkResults) => {
      if (checkErr) {
        console.error("Error checking room availability:", checkErr);
        return res
          .status(500)
          .json({ message: "Booking failed. Please try again." });
      }

      if (checkResults.length === 0 || checkResults[0].is_available !== 1) {
        return res.status(400).json({ message: "Room is not available." });
      }

      const insertBookingLogSql = `
      INSERT INTO booking_logs (username, dormitory_name, room_number, booking_date, check_in_date)
      VALUES (?, ?, ?, ?, ?)
    `;

      const checkInDate = new Date(start_date);

      db.query(
        insertBookingLogSql,
        [username, dormitory_name, room_number, booking_time, checkInDate],
        (err, result) => {
          if (err) {
            console.error("Error inserting booking log:", err);
            return res
              .status(500)
              .json({ message: "Booking failed. Please try again." });
          }

          const updateRoomAvailabilitySql = `
            UPDATE rooms
            SET is_available = 0
            WHERE dormitory_name = ? AND room_number = ?
          `;

          db.query(
            updateRoomAvailabilitySql,
            [dormitory_name, room_number],
            (updateErr, updateResult) => {
              if (updateErr) {
                console.error("Error updating room availability:", updateErr);
                return res
                  .status(500)
                  .json({ message: "Booking failed. Please try again." });
              }

              res.json({ message: "Booking successful" });
            }
          );
        }
      );
    }
  );
});

app.get("/api/userBookings", (req, res) => {
  if (!req.session || !req.session.userName) {
    return res.status(401).send("User not logged in");
  }

  const sql = `
    SELECT b.log_id, b.dormitory_name, b.room_number, b.check_in_date
    FROM booking_logs b
    WHERE b.username = ? AND b.is_active = 1
  `;

  db.query(sql, [req.session.userName], (err, results) => {
    if (err) {
      console.error("Error fetching user bookings:", err);
      return res.status(500).send("Failed to fetch bookings.");
    }
    res.json(results);
  });
});

app.post("/api/cancelBooking/:bookingId", (req, res) => {
  const bookingId = req.params.bookingId;

  db.beginTransaction((err) => {
    if (err) {
      console.error("Transaction error:", err);
      return res
        .status(500)
        .json({ message: "Cancellation failed. Please try again." });
    }

    db.query(
      "UPDATE booking_logs SET is_active = 0 WHERE log_id = ?",
      [bookingId],
      (err, result) => {
        if (err) {
          return db.rollback(() => {
            console.error("Error updating booking_logs:", err);
            res
              .status(500)
              .json({ message: "Cancellation failed. Please try again." });
          });
        }

        const now = new Date();
        db.query(
          "INSERT INTO cancelling_logs (username, dormitory_name, room_number, cancellation_date) SELECT username, dormitory_name, room_number, ? FROM booking_logs WHERE log_id = ?",
          [now, bookingId],
          (err, result) => {
            if (err) {
              return db.rollback(() => {
                console.error("Error inserting into cancelling_logs:", err);
                res
                  .status(500)
                  .json({ message: "Cancellation failed. Please try again." });
              });
            }

            db.query(
              "UPDATE rooms r JOIN booking_logs b ON r.dormitory_name = b.dormitory_name AND r.room_number = b.room_number SET r.is_available = 1 WHERE b.log_id = ?",
              [bookingId],
              (err, result) => {
                if (err) {
                  return db.rollback(() => {
                    console.error("Error updating rooms availability:", err);
                    res.status(500).json({
                      message: "Cancellation failed. Please try again.",
                    });
                  });
                }

                db.commit((err) => {
                  if (err) {
                    return db.rollback(() => {
                      console.error("Error committing transaction:", err);
                      res.status(500).json({
                        message: "Cancellation failed. Please try again.",
                      });
                    });
                  }

                  res.json({ message: "Booking cancellation successful" });
                });
              }
            );
          }
        );
      }
    );
  });
});

app.get("/api/olap/averageRentBySize", (req, res) => {
  const sql = `SELECT r.Size, AVG(r.MonthlyRent) as AverageMonthlyRent
  FROM DimRoom as r
  GROUP BY r.Size
  ORDER BY r.Size;`;
  db_olap.query(sql, (err, results) => {
    if (err) {
      console.error("Error fetching averageRentBySize:", err);
      return res.status(500).send("Failed to fetch data.");
    }
    res.json(results);
  });
});

app.get("/api/olap/bookingsByDormitory", (req, res) => {
  const sql = `
  SELECT r.DormitoryName, COUNT(IsActive) as BookingCount
FROM FactBooking as b
NATURAL JOIN DimRoom as r
where IsActive = 1
GROUP BY r.DormitoryName
ORDER BY r.DormitoryName;`;
  db_olap.query(sql, (err, results) => {
    if (err) {
      console.error("Error fetching bookingsByDormitory:", err);
      return res.status(500).send("Failed to fetch data.");
    }
    res.json(results);
  });
});

app.get("/api/olap/bookingStatusCount", (req, res) => {
  const sql = `
  SELECT 'Booking' as Status, COUNT(BookingID) as Count FROM FactBooking
UNION ALL
SELECT 'Cancellation' as Status, COUNT(CancellationID) as Count FROM FactCancellation;
`;
  db_olap.query(sql, (err, results) => {
    if (err) {
      console.error("Error fetching bookingStatusCount:", err);
      return res.status(500).send("Failed to fetch data.");
    }
    res.json(results);
  });
});

app.get("/api/olap/cumulativeBookingOverTime", (req, res) => {
  const sql = `
  SELECT d.Date,
       COALESCE(b.BookingCount, 0) as BookingCount, 
       COALESCE(c.CancellationCount, 0) as CancellationCount
FROM DimDate as d
LEFT JOIN (
    SELECT BookingDateID, COUNT(BookingID) as BookingCount
    FROM FactBooking
    GROUP BY BookingDateID
) as b ON d.DateID = b.BookingDateID
LEFT JOIN (
    SELECT CancellationDateID, COUNT(CancellationID) as CancellationCount
    FROM FactCancellation
    GROUP BY CancellationDateID
) as c ON d.DateID = c.CancellationDateID
GROUP BY d.Date
ORDER BY d.Date;
`;
  db_olap.query(sql, (err, results) => {
    if (err) {
      console.error("Error fetching cumulativeBookingOverTime:", err);
      return res.status(500).send("Failed to fetch data.");
    }
    res.json(results);
  });
});

app.get("/api/olap/availableRoomsByDormitory", (req, res) => {
  const sql = `
  SELECT 
    a.DormitoryName AS dormitory_name,
    a.AllRooms AS "number_of_rooms",
    COALESCE(b.AvailableRooms, 0) AS "available_rooms"
FROM 
(
    SELECT 
        DormitoryName, 
        COUNT(RoomID) AS AllRooms
    FROM DimRoom
    GROUP BY DormitoryName
) a
LEFT JOIN 
(
    SELECT 
        DormitoryName, 
        COUNT(RoomID) AS AvailableRooms
    FROM DimRoom
    WHERE IsAvailable = 1
    GROUP BY DormitoryName
) b
ON a.DormitoryName = b.DormitoryName
ORDER BY a.DormitoryName;`;
  db_olap.query(sql, (err, results) => {
    if (err) {
      console.error("Error fetching availableRoomsTable:", err);
      return res.status(500).send("Failed to fetch data.");
    }
    res.json(results);
  });
});

app.post("/api/addRoom", (req, res) => {
  const { dormitory_name, room_number, size, monthly_rent } = req.body;
  console.log("Received data:", req.body);
  if (!dormitory_name || !room_number || !size || !monthly_rent) {
    return res.json({ success: false, message: "Incomplete data received." });
  }
  const query =
    "INSERT INTO rooms (dormitory_name, room_number, `size (sq.m)`, `monthly_rent (baht)`) VALUES (?, ?, ?, ?)";
  db.query(
    query,
    [dormitory_name, room_number, size, monthly_rent],
    (err, result) => {
      if (err) {
        console.error("Error inserting data:", err);
        res.json({ success: false, message: "Database error." });
      } else {
        res.json({ success: true, message: "Room added successfully!" });
      }
    }
  );
});

app.listen(port, () => {
  console.log(`Server started on http://localhost:${port}`);
});

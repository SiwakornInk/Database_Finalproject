const express = require("express");
const mysql = require("mysql2");
const session = require("express-session");

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
  database: "dormitory_olap",
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

      // Set the session variable here
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
  const username = req.session.userName; // Use the correct username from the session

  // Check if the room is available
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
        // Room is not available, return an error message
        return res.status(400).json({ message: "Room is not available." });
      }

      // Room is available, proceed with booking
      const insertBookingLogSql = `
      INSERT INTO booking_logs (username, dormitory_name, room_number, booking_date, check_in_date)
      VALUES (?, ?, ?, ?, ?)
    `;

      const checkInDate = new Date(start_date); // You might want to adjust this based on your business logic

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

          // Update the rooms.is_available field to 0 for the booked room
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
                // Handle the error appropriately, e.g., return an error response
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

  // Start a transaction to ensure data consistency
  db.beginTransaction((err) => {
    if (err) {
      console.error("Transaction error:", err);
      return res
        .status(500)
        .json({ message: "Cancellation failed. Please try again." });
    }

    // Update is_active in booking_logs
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

        // Insert into cancelling_logs
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

            // Update is_available in rooms
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

                // Commit the transaction
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
  db_olap.query(
    "SELECT Size, AVG(Monthly_Rent) AS Avg_Rent FROM Room_Dimension GROUP BY Size",
    (err, results) => {
      if (err) {
        console.error("Error fetching average rent by size:", err);
        return res.status(500).send("Failed to fetch data.");
      }
      res.json(results);
    }
  );
});

app.listen(port, () => {
  console.log(`Server started on http://localhost:${port}`);
});
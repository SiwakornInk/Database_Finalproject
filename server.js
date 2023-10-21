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
    "SELECT name, role FROM users WHERE username = ? AND password = ?",
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

      req.session.userName = results[0].name;

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
  const { dormitory_name, room_number, start_date, username } = req.body;

  const booking_time = new Date();

  const user = req.session.userName;

  const sql = `
    INSERT INTO bookings (username, dormitory_name, room_number, start_date, booking_time)
    VALUES (?, ?, ?, ?, ?)
  `;

  db.query(
    sql,
    [user, dormitory_name, room_number, start_date, booking_time],
    (err, result) => {
      if (err) {
        console.error("Error inserting booking:", err);
        return res
          .status(500)
          .json({ message: "Booking failed. Please try again." });
      }
      res.json({ message: "Booking successful" });
    }
  );
});

app.listen(port, () => {
  console.log(`Server started on http://localhost:${port}`);
});
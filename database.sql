database name 'dormitory'

CREATE TABLE `users` (
  `username` varchar(255) NOT NULL,
  `name` varchar(255) NOT NULL,
  `password` varchar(255) NOT NULL,
  `role` enum('user','admin') NOT NULL,
  PRIMARY KEY (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci

CREATE TABLE `rooms` (
  `dormitory_name` varchar(255) NOT NULL,
  `room_number` int(11) NOT NULL,
  `size (sq.m)` decimal(6,2) NOT NULL,
  `monthly_rent (baht)` decimal(10,2) NOT NULL,
  `is_available` tinyint(4) NOT NULL DEFAULT 1,
  PRIMARY KEY (`dormitory_name`,`room_number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci

CREATE TABLE `booking_logs` (
  `log_id` int(11) NOT NULL AUTO_INCREMENT,
  `username` varchar(255) NOT NULL,
  `dormitory_name` varchar(255) NOT NULL,
  `room_number` int(11) NOT NULL,
  `booking_date` datetime NOT NULL,
  `check_in_date` date NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`log_id`),
  KEY `username` (`username`),
  KEY `dormitory_name` (`dormitory_name`,`room_number`),
  CONSTRAINT `booking_logs_ibfk_1` FOREIGN KEY (`username`) REFERENCES `users` (`username`),
  CONSTRAINT `booking_logs_ibfk_2` FOREIGN KEY (`dormitory_name`, `room_number`) REFERENCES `rooms` (`dormitory_name`, `room_number`)
) ENGINE=InnoDB AUTO_INCREMENT=11 DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci

CREATE TABLE `cancelling_logs` (
  `log_id` int(11) NOT NULL AUTO_INCREMENT,
  `username` varchar(255) NOT NULL,
  `dormitory_name` varchar(255) NOT NULL,
  `room_number` int(11) NOT NULL,
  `cancellation_date` datetime NOT NULL,
  PRIMARY KEY (`log_id`),
  KEY `username` (`username`),
  KEY `dormitory_name` (`dormitory_name`,`room_number`),
  CONSTRAINT `cancelling_logs_ibfk_1` FOREIGN KEY (`username`) REFERENCES `users` (`username`),
  CONSTRAINT `cancelling_logs_ibfk_2` FOREIGN KEY (`dormitory_name`, `room_number`) REFERENCES `rooms` (`dormitory_name`, `room_number`)
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci

database name 'olap_dormitory'

CREATE TABLE `dimdate` (
  `DateID` int(11) NOT NULL AUTO_INCREMENT,
  `Date` date NOT NULL,
  `Year` int(11) NOT NULL,
  `Month` int(11) NOT NULL,
  `Day` int(11) NOT NULL,
  PRIMARY KEY (`DateID`),
  UNIQUE KEY `Date` (`Date`)
) ENGINE=InnoDB AUTO_INCREMENT=51 DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci

CREATE TABLE `dimroom` (
  `RoomID` int(11) NOT NULL AUTO_INCREMENT,
  `DormitoryName` varchar(255) NOT NULL,
  `RoomNumber` int(11) NOT NULL,
  `Size` decimal(6,2) NOT NULL,
  `MonthlyRent` decimal(10,2) NOT NULL,
  `IsAvailable` tinyint(1) DEFAULT 1,
  PRIMARY KEY (`RoomID`)
) ENGINE=InnoDB AUTO_INCREMENT=505 DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci

CREATE TABLE `dimuser` (
  `UserID` int(11) NOT NULL AUTO_INCREMENT,
  `Username` varchar(255) NOT NULL,
  `Name` varchar(255) NOT NULL,
  `Role` enum('user','admin') NOT NULL,
  PRIMARY KEY (`UserID`)
) ENGINE=InnoDB AUTO_INCREMENT=31 DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci

CREATE TABLE `factbooking` (
  `BookingID` int(11) NOT NULL AUTO_INCREMENT,
  `UserID` int(11) NOT NULL,
  `RoomID` int(11) NOT NULL,
  `BookingDateID` int(11) NOT NULL,
  `IsActive` tinyint(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`BookingID`),
  KEY `UserID` (`UserID`),
  KEY `RoomID` (`RoomID`),
  KEY `BookingDateID` (`BookingDateID`),
  CONSTRAINT `factbooking_ibfk_1` FOREIGN KEY (`UserID`) REFERENCES `dimuser` (`UserID`),
  CONSTRAINT `factbooking_ibfk_2` FOREIGN KEY (`RoomID`) REFERENCES `dimroom` (`RoomID`),
  CONSTRAINT `factbooking_ibfk_3` FOREIGN KEY (`BookingDateID`) REFERENCES `dimdate` (`DateID`)
) ENGINE=InnoDB AUTO_INCREMENT=77 DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci

CREATE TABLE `factcancellation` (
  `CancellationID` int(11) NOT NULL AUTO_INCREMENT,
  `UserID` int(11) NOT NULL,
  `RoomID` int(11) NOT NULL,
  `CancellationDateID` int(11) NOT NULL,
  PRIMARY KEY (`CancellationID`),
  KEY `UserID` (`UserID`),
  KEY `RoomID` (`RoomID`),
  KEY `CancellationDateID` (`CancellationDateID`),
  CONSTRAINT `factcancellation_ibfk_1` FOREIGN KEY (`UserID`) REFERENCES `dimuser` (`UserID`),
  CONSTRAINT `factcancellation_ibfk_2` FOREIGN KEY (`RoomID`) REFERENCES `dimroom` (`RoomID`),
  CONSTRAINT `factcancellation_ibfk_3` FOREIGN KEY (`CancellationDateID`) REFERENCES `dimdate` (`DateID`)
) ENGINE=InnoDB AUTO_INCREMENT=65 DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci

CREATE DEFINER=`root`@`localhost` PROCEDURE `UpdateOLAPData`()
BEGIN

    -- 1. Delete existing data in OLAP
    DELETE FROM FactBooking;
    DELETE FROM FactCancellation;
    DELETE FROM DimDate;
    DELETE FROM DimRoom;
    DELETE FROM DimUser;

    -- 2. Populate DimUser
    INSERT INTO DimUser (Username, Name, Role)
    SELECT username, name, role
    FROM dormitory.users;

    -- 3. Populate DimRoom
 INSERT INTO DimRoom (RoomID, DormitoryName, RoomNumber, Size, MonthlyRent, IsAvailable)
    SELECT NULL, dormitory_name, room_number, `size (sq.m)`, `monthly_rent (baht)`, is_available
    FROM dormitory.rooms;
    
    -- 4. Populate DimDate (from booking_logs and cancelling_logs)
    INSERT INTO DimDate (Date, Year, Month, Day)
    SELECT DISTINCT DATE(booking_date), YEAR(booking_date), MONTH(booking_date), DAY(booking_date)
    FROM dormitory.booking_logs
    UNION
    SELECT DISTINCT DATE(cancellation_date), YEAR(cancellation_date), MONTH(cancellation_date), DAY(cancellation_date)
    FROM dormitory.cancelling_logs;

    -- 5. Populate FactBooking
    INSERT INTO FactBooking (UserID, RoomID, BookingDateID, IsActive)
    SELECT u.UserID, r.RoomID, d.DateID, bl.is_active
    FROM dormitory.booking_logs bl
    JOIN DimUser u ON bl.username = u.Username
    JOIN DimRoom r ON bl.dormitory_name = r.DormitoryName AND bl.room_number = r.RoomNumber
    JOIN DimDate d ON DATE(bl.booking_date) = d.Date;

    -- 6. Populate FactCancellation (we don't have IsActive in cancelling_logs so skipping that)
    INSERT INTO FactCancellation (UserID, RoomID, CancellationDateID)
    SELECT u.UserID, r.RoomID, d.DateID
    FROM dormitory.cancelling_logs cl
    JOIN DimUser u ON cl.username = u.Username
    JOIN DimRoom r ON cl.dormitory_name = r.DormitoryName AND cl.room_number = r.RoomNumber
    JOIN DimDate d ON DATE(cl.cancellation_date) = d.Date;

END
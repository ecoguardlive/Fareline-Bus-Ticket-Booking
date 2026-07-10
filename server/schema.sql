-- Fareline — MySQL schema
-- Run with:  mysql -u root -p < schema.sql

CREATE DATABASE IF NOT EXISTS fareline CHARACTER SET utf8mb4;
USE fareline;

CREATE TABLE IF NOT EXISTS users (
  id            VARCHAR(20)  PRIMARY KEY,
  name          VARCHAR(120) NOT NULL,
  email         VARCHAR(160) NOT NULL UNIQUE,
  phone         VARCHAR(30)  NOT NULL,
  password_hash VARCHAR(120) NOT NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS trips (
  id            VARCHAR(64) PRIMARY KEY,
  origin        VARCHAR(60) NOT NULL,
  destination   VARCHAR(60) NOT NULL,
  travel_date   DATE NOT NULL,
  depart_time   TIME NOT NULL,
  arrive_time   TIME NOT NULL,
  duration_min  INT NOT NULL,
  operator      VARCHAR(80) NOT NULL,
  tier          ENUM('standard','executive','vip') NOT NULL DEFAULT 'standard',
  fare          DECIMAL(8,2) NOT NULL,
  total_seats   INT NOT NULL DEFAULT 44,
  INDEX idx_route_date (origin, destination, travel_date)
);

CREATE TABLE IF NOT EXISTS bookings (
  id            VARCHAR(20) PRIMARY KEY,
  user_id       VARCHAR(20) NOT NULL,
  trip_id       VARCHAR(64) NOT NULL,
  contact_email VARCHAR(160) NOT NULL,
  total_fare    DECIMAL(8,2) NOT NULL,
  card_last4    CHAR(4),
  status        ENUM('confirmed','cancelled') NOT NULL DEFAULT 'confirmed',
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS booking_seats (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  booking_id    VARCHAR(20) NOT NULL,
  seat_index    INT NOT NULL,
  passenger_name  VARCHAR(120) NOT NULL,
  passenger_age   INT NOT NULL,
  passenger_phone VARCHAR(30) NOT NULL,
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
  UNIQUE KEY uniq_trip_seat_per_booking (booking_id, seat_index)
);

-- Prevents the same seat on the same trip being double-booked across
-- different bookings while a booking is confirmed.
CREATE TABLE IF NOT EXISTS trip_seat_locks (
  trip_id     VARCHAR(64) NOT NULL,
  seat_index  INT NOT NULL,
  booking_id  VARCHAR(20) NOT NULL,
  PRIMARY KEY (trip_id, seat_index),
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
);

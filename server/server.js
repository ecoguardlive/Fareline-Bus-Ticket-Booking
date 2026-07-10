require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("./db");

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";
const genId = (prefix) => prefix + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 900 + 100);

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Sign in required." });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Session expired, please sign in again." });
  }
}

/* ---------------------------- auth ---------------------------- */

app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;
    if (!name || !email || !phone || !password) return res.status(400).json({ error: "All fields are required." });

    const [existing] = await pool.query("SELECT id FROM users WHERE email = ?", [email]);
    if (existing.length) return res.status(409).json({ error: "An account with this email already exists." });

    const id = genId("U");
    const passwordHash = await bcrypt.hash(password, 10);
    await pool.query("INSERT INTO users (id, name, email, phone, password_hash) VALUES (?,?,?,?,?)", [id, name, email, phone, passwordHash]);

    const token = jwt.sign({ id, name, email }, JWT_SECRET, { expiresIn: "7d" });
    res.status(201).json({ token, user: { id, name, email } });
  } catch (err) {
    res.status(500).json({ error: "Could not create account." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const [rows] = await pool.query("SELECT * FROM users WHERE email = ?", [email]);
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: "Incorrect email or password." });
    }
    const token = jwt.sign({ id: user.id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
  } catch (err) {
    res.status(500).json({ error: "Login failed." });
  }
});

/* ---------------------------- trips ---------------------------- */

app.get("/api/trips", async (req, res) => {
  const { from, to, date } = req.query;
  const clauses = [];
  const values = [];
  if (from) { clauses.push("origin = ?"); values.push(from); }
  if (to) { clauses.push("destination = ?"); values.push(to); }
  if (date) { clauses.push("travel_date = ?"); values.push(date); }
  const where = clauses.length ? "WHERE " + clauses.join(" AND ") : "";

  const [trips] = await pool.query(`SELECT * FROM trips ${where} ORDER BY depart_time`, values);
  res.json(trips);
});

app.get("/api/trips/:id/seats", async (req, res) => {
  const [locks] = await pool.query("SELECT seat_index FROM trip_seat_locks WHERE trip_id = ?", [req.params.id]);
  res.json({ takenSeats: locks.map((l) => l.seat_index) });
});

/* ---------------------------- bookings ---------------------------- */

app.post("/api/bookings", auth, async (req, res) => {
  const { tripId, seats, passengers, contactEmail, cardLast4 } = req.body;
  if (!tripId || !Array.isArray(seats) || !seats.length || !Array.isArray(passengers)) {
    return res.status(400).json({ error: "Missing booking details." });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [tripRows] = await conn.query("SELECT * FROM trips WHERE id = ? FOR UPDATE", [tripId]);
    const trip = tripRows[0];
    if (!trip) throw new Error("Trip not found.");

    const [existingLocks] = await conn.query(
      "SELECT seat_index FROM trip_seat_locks WHERE trip_id = ? AND seat_index IN (?)",
      [tripId, seats]
    );
    if (existingLocks.length) throw new Error("One or more selected seats were just booked by someone else.");

    const bookingId = genId("FL");
    const totalFare = seats.length * Number(trip.fare);

    await conn.query(
      "INSERT INTO bookings (id, user_id, trip_id, contact_email, total_fare, card_last4, status) VALUES (?,?,?,?,?,?,'confirmed')",
      [bookingId, req.user.id, tripId, contactEmail, totalFare, cardLast4 || null]
    );

    for (const p of passengers) {
      await conn.query(
        "INSERT INTO booking_seats (booking_id, seat_index, passenger_name, passenger_age, passenger_phone) VALUES (?,?,?,?,?)",
        [bookingId, p.seat, p.name, p.age, p.phone]
      );
      await conn.query("INSERT INTO trip_seat_locks (trip_id, seat_index, booking_id) VALUES (?,?,?)", [tripId, p.seat, bookingId]);
    }

    await conn.commit();
    res.status(201).json({ id: bookingId, tripId, seats, totalFare, status: "confirmed" });
  } catch (err) {
    await conn.rollback();
    res.status(400).json({ error: err.message || "Booking failed." });
  } finally {
    conn.release();
  }
});

app.get("/api/bookings/me", auth, async (req, res) => {
  const [bookings] = await pool.query(
    `SELECT b.*, t.origin, t.destination, t.travel_date, t.depart_time, t.arrive_time, t.operator, t.tier
     FROM bookings b JOIN trips t ON t.id = b.trip_id
     WHERE b.user_id = ? ORDER BY b.created_at DESC`,
    [req.user.id]
  );
  for (const b of bookings) {
    const [seats] = await pool.query("SELECT * FROM booking_seats WHERE booking_id = ?", [b.id]);
    b.passengers = seats;
  }
  res.json(bookings);
});

app.post("/api/bookings/:id/cancel", auth, async (req, res) => {
  const [rows] = await pool.query("SELECT * FROM bookings WHERE id = ? AND user_id = ?", [req.params.id, req.user.id]);
  const booking = rows[0];
  if (!booking) return res.status(404).json({ error: "Booking not found." });
  if (booking.status === "cancelled") return res.json({ ok: true });

  await pool.query("UPDATE bookings SET status = 'cancelled' WHERE id = ?", [req.params.id]);
  await pool.query("DELETE FROM trip_seat_locks WHERE booking_id = ?", [req.params.id]);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Fareline API listening on http://localhost:${PORT}`));

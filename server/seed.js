/* Seeds `trips` with a two-week schedule across a fixed set of routes.
   Run:  npm run seed   (after `mysql -u root -p < schema.sql`)          */
require("dotenv").config();
const pool = require("./db");

const ROUTE_DISTANCE = {
  "Kumasi-Accra": 250, "Kumasi-Takoradi": 210, "Kumasi-Tamale": 390,
  "Kumasi-Cape Coast": 240, "Kumasi-Sunyani": 125, "Accra-Cape Coast": 145,
  "Accra-Koforidua": 90, "Accra-Ho": 165, "Kumasi-Techiman": 120,
};
const OPERATORS = [
  { name: "Highway Express", tier: "standard" },
  { name: "Golden Coach Lines", tier: "vip" },
  { name: "Savannah Line", tier: "standard" },
  { name: "Coastal Cruiser", tier: "executive" },
  { name: "Northbound Transit", tier: "standard" },
];
const TIER_MULTIPLIER = { standard: 1, executive: 1.35, vip: 1.7 };
const DEPARTURE_HOURS = [6, 9, 13, 17];

function isoDate(d) { return d.toISOString().slice(0, 10); }
function pad(n) { return String(n).padStart(2, "0"); }
function addMinutes(hour, min, add) {
  const total = hour * 60 + min + add;
  return `${pad(Math.floor(total / 60) % 24)}:${pad(total % 60)}`;
}

async function seed() {
  const rows = [];
  const today = new Date();

  for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
    const date = new Date(today);
    date.setDate(date.getDate() + dayOffset);
    const iso = isoDate(date);

    Object.keys(ROUTE_DISTANCE).forEach((key) => {
      const [a, b] = key.split("-");
      const distance = ROUTE_DISTANCE[key];
      const durationMin = Math.round((distance / 62) * 60);

      [[a, b], [b, a]].forEach(([origin, destination]) => {
        DEPARTURE_HOURS.forEach((hour, i) => {
          const operator = OPERATORS[(hour + i + origin.length) % OPERATORS.length];
          const departTime = `${pad(hour)}:00`;
          const arriveTime = addMinutes(hour, 0, durationMin);
          const fare = Math.round(distance * 1.35 * TIER_MULTIPLIER[operator.tier] / 5) * 5;
          const id = `${origin.slice(0,3)}-${destination.slice(0,3)}-${iso}-${departTime}-${operator.name.replace(/\s+/g,"")}`.toUpperCase();

          rows.push([id, origin, destination, iso, departTime, arriveTime, durationMin, operator.name, operator.tier, fare, 44]);
        });
      });
    });
  }

  const sql = `INSERT IGNORE INTO trips
    (id, origin, destination, travel_date, depart_time, arrive_time, duration_min, operator, tier, fare, total_seats)
    VALUES ?`;

  // Insert in chunks to keep the query size reasonable.
  const chunkSize = 200;
  for (let i = 0; i < rows.length; i += chunkSize) {
    await pool.query(sql, [rows.slice(i, i + chunkSize)]);
  }

  console.log(`Seeded ${rows.length} trips.`);
  await pool.end();
}

seed().catch((err) => { console.error(err); process.exit(1); });

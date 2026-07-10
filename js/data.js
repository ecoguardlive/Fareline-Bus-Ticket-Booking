/* ==========================================================================
   Fareline — seed data
   Generates a deterministic set of trips for the next 14 days so seat
   availability stays stable for a given trip id across page reloads.
   ========================================================================== */

const CITIES = [
  "Kumasi", "Accra", "Takoradi", "Tamale", "Cape Coast",
  "Sunyani", "Ho", "Koforidua", "Techiman", "Bolgatanga"
];

// Distance in km, used to derive duration + fare so numbers stay consistent.
const ROUTE_DISTANCE = {
  "Kumasi-Accra": 250, "Kumasi-Takoradi": 210, "Kumasi-Tamale": 390,
  "Kumasi-Cape Coast": 240, "Kumasi-Sunyani": 125, "Kumasi-Ho": 300,
  "Kumasi-Koforidua": 180, "Kumasi-Techiman": 120, "Kumasi-Bolgatanga": 480,
  "Accra-Takoradi": 230, "Accra-Tamale": 600, "Accra-Cape Coast": 145,
  "Accra-Sunyani": 370, "Accra-Ho": 165, "Accra-Koforidua": 90,
  "Accra-Techiman": 350, "Accra-Bolgatanga": 780,
  "Takoradi-Cape Coast": 80, "Tamale-Bolgatanga": 160, "Techiman-Tamale": 260
};

const OPERATORS = [
  { name: "Highway Express", tier: "standard" },
  { name: "Golden Coach Lines", tier: "vip" },
  { name: "Savannah Line", tier: "standard" },
  { name: "Coastal Cruiser", tier: "executive" },
  { name: "Northbound Transit", tier: "standard" },
];

const TIER_LABEL = { standard: "Standard", executive: "Executive", vip: "VIP" };
const TIER_MULTIPLIER = { standard: 1, executive: 1.35, vip: 1.7 };
const DEPARTURE_HOURS = [5, 6, 7, 9, 11, 13, 15, 17, 19];

function seededRandom(seed) {
  // Small deterministic PRNG (mulberry32) so a given trip id always
  // produces the same seat map / minor variance.
  let t = seed += 0x6D2B79F5;
  return function () {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) { h = (h * 31 + str.charCodeAt(i)) | 0; }
  return Math.abs(h);
}

function routeDistance(from, to) {
  return ROUTE_DISTANCE[`${from}-${to}`] || ROUTE_DISTANCE[`${to}-${from}`] || 200;
}

function formatDateISO(d) {
  return d.toISOString().slice(0, 10);
}

function addMinutes(hour, minutesToAdd) {
  const total = hour * 60 + minutesToAdd;
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Builds the full trip catalogue for the next `days` days.
 * Trips are generated on demand and cached so the data stays stable
 * for the lifetime of the page.
 */
const TripCatalogue = (function () {
  let cache = null;

  function build(days = 14) {
    const trips = [];
    const today = new Date();

    for (let dayOffset = 0; dayOffset < days; dayOffset++) {
      const date = new Date(today);
      date.setDate(date.getDate() + dayOffset);
      const iso = formatDateISO(date);

      Object.keys(ROUTE_DISTANCE).forEach((key) => {
        const [from, to] = key.split("-");
        [[from, to], [to, from]].forEach(([origin, dest]) => {
          const distance = routeDistance(origin, dest);
          const durationMin = Math.round((distance / 62) * 60); // ~62km/h avg

          // Pick 2-3 departures per route/day, varying by day+route seed.
          const seedBase = hashCode(`${origin}-${dest}-${iso}`);
          const rnd = seededRandom(seedBase);
          const numDepartures = 2 + Math.floor(rnd() * 2);
          const usedHours = new Set();

          for (let i = 0; i < numDepartures; i++) {
            let hour;
            let guard = 0;
            do {
              hour = DEPARTURE_HOURS[Math.floor(rnd() * DEPARTURE_HOURS.length)];
              guard++;
            } while (usedHours.has(hour) && guard < 10);
            usedHours.add(hour);

            const operator = OPERATORS[Math.floor(rnd() * OPERATORS.length)];
            const departTime = `${String(hour).padStart(2, "0")}:${["00", "15", "30", "45"][Math.floor(rnd() * 4)]}`;
            const [dh, dm] = departTime.split(":").map(Number);
            const arriveTime = addMinutes(dh, dm + durationMin);

            const baseFarePerKm = 1.35; // GHS per km, base standard tier
            const fare = Math.round(distance * baseFarePerKm * TIER_MULTIPLIER[operator.tier] / 5) * 5;

            const id = `${origin.slice(0,3)}-${dest.slice(0,3)}-${iso}-${departTime}-${operator.name.replace(/\s+/g,'')}`.toUpperCase();

            trips.push({
              id,
              from: origin,
              to: dest,
              date: iso,
              departTime,
              arriveTime,
              durationMin,
              operator: operator.name,
              tier: operator.tier,
              fare,
              totalSeats: 44,
            });
          }
        });
      });
    }
    return trips;
  }

  return {
    // Raw generated schedule, before admin overrides are applied.
    generated() {
      if (!cache) cache = build();
      return cache;
    },
    // Generated trips minus admin-cancelled ones, plus admin-added custom trips.
    all() {
      const cancelled = (typeof Store !== "undefined" && Store.getCancelledTripIds) ? new Set(Store.getCancelledTripIds()) : new Set();
      const custom = (typeof Store !== "undefined" && Store.getCustomTrips) ? Store.getCustomTrips() : [];
      return this.generated().filter((t) => !cancelled.has(t.id)).concat(custom);
    },
    byId(id) {
      return this.all().find((t) => t.id === id);
    },
    search({ from, to, date }) {
      return this.all().filter((t) =>
        (!from || t.from === from) &&
        (!to || t.to === to) &&
        (!date || t.date === date)
      ).sort((a, b) => a.departTime.localeCompare(b.departTime));
    }
  };
})();

/**
 * Deterministic occupied-seat map for a trip, derived from its id so a
 * given trip always shows the same "already booked" seats, minus any
 * seats the current visitor has actually booked (tracked in storage).
 */
function occupiedSeatsForTrip(tripId, totalSeats = 44) {
  const rnd = seededRandom(hashCode(tripId));
  const occupied = new Set();
  const occupancyRate = 0.25 + rnd() * 0.35; // 25%-60% pre-filled
  const targetCount = Math.floor(totalSeats * occupancyRate);
  while (occupied.size < targetCount) {
    occupied.add(1 + Math.floor(rnd() * totalSeats));
  }
  return occupied;
}

/** Converts a 1-based seat index into a bus-style label, e.g. 1 -> "1A". */
function seatLabel(index) {
  const perRow = 4;
  const row = Math.floor((index - 1) / perRow) + 1;
  const col = ["A", "B", "C", "D"][(index - 1) % perRow];
  return `${row}${col}`;
}

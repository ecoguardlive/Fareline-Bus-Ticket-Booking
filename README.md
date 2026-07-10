# Fareline — Bus Ticket Booking System

A complete, self-contained bus ticket booking web app: search routes, pick an
exact seat on a visual seat map, enter passenger details, pay (simulated),
and get a downloadable/printable e-ticket. Includes an optional Node.js +
MySQL backend for teams that want real, server-side persistence.

## What's inside

```
bus-ticket-booking/
├── index.html          # App shell
├── css/style.css        # All styling (single stylesheet, CSS variables)
├── js/
│   ├── data.js          # Cities, operators, deterministic trip/seat generator
│   ├── storage.js       # localStorage persistence (users, session, bookings)
│   └── app.js            # Router + all views + booking flow
└── server/               # OPTIONAL backend (Express + MySQL)
    ├── schema.sql
    ├── seed.js
    ├── server.js
    ├── db.js
    ├── .env.example
    └── package.json
```

## Quick start (no install needed)

The app runs entirely in the browser using `localStorage` — there is nothing
to build or install.

1. Unzip the folder.
2. Open `index.html` directly in a browser, **or**, for the best experience
   (some browsers restrict `fetch`/module behavior on `file://`), serve it
   with any static server, e.g.:
   ```bash
   cd bus-ticket-booking
   npx serve .
   # or
   python3 -m http.server 8080
   ```
3. Visit the printed URL. Search a route, create an account when prompted,
   pick seats, and complete a (simulated) payment to get your e-ticket.

That's it — trips, seat availability, accounts and bookings are generated
and stored on-device. No server, database, or API keys required.

### Installing it as an app

Fareline is a PWA (`manifest.json` + `service-worker.js`) — you can install it
to your device's home screen / app list, and it'll keep working offline.

**Important:** browsers only offer the install prompt over `https://` or
`http://localhost` — **not** over a plain `file://` path. Serve it with
`npx serve .` (or deploy it anywhere) rather than double-clicking
`index.html` if you want the install option to show up.

- **Chrome/Edge (desktop):** an install icon (⊕) appears in the address bar,
  or use the "⬇ Install app" button in the footer.
- **Android Chrome:** tap the "⬇ Install app" button, or the browser menu →
  *Add to Home screen*.
- **iOS Safari:** Safari doesn't support the install prompt API — tap
  *Share* → *Add to Home Screen* instead.

Once installed it opens in its own window (no browser chrome), and the app
shell is cached so it still loads if you're offline.

### Admin access

A demo admin account is seeded automatically the first time the app loads:

```
email:    admin@fareline.demo
password: admin123
```

Sign in with those credentials and an **Admin** tab appears in the top
navigation, linking to the dashboard at `#/admin`.

## Features

- **Route search** with swappable origin/destination, date and passenger count
- **Deterministic trip catalogue** — routes, times, operators and fares for
  the next 14 days, regenerated the same way every time (no flicker/randomness
  between reloads)
- **Visual seat map** (2×2 layout with aisle), taken vs. available vs. selected
- **Multi-passenger booking** with per-seat passenger details
- **Promo codes** — apply a discount code at checkout (seeded with
  `WELCOME10` and `SAVE20`; manage codes from the admin dashboard)
- **Simulated payment** with card-number formatting, expiry and CVV validation
  (no real payment is processed)
- **Boarding-pass style e-ticket** — printable, and downloadable as a
  self-contained `.html` file
- **My bookings** — view past tickets, cancel upcoming ones, rate completed trips
- **Operator ratings** — star ratings left after a trip show up as an
  average rating badge on search results
- **In-app notifications** — a bell icon in the top bar shows booking
  confirmations, cancellations and account updates
- **Accounts** — register/sign in, stored locally (demo-grade password hashing)
- **Admin dashboard** (`#/admin`, admin accounts only):
  - **Overview** — revenue, booking counts, average fare, a 7-day revenue
    chart and top routes by revenue
  - **Trips** — see today's schedule and seats sold, cancel a scheduled
    trip, restore a cancelled one, or add a custom trip
  - **Bookings** — browse and cancel any customer's booking
  - **Users** — promote/demote admins, ban/unban accounts
  - **Promo codes** — create, pause, or delete discount codes

## Optional backend (Node.js + Express + MySQL)

The `server/` folder is a separate, optional REST API for anyone who wants
real server-side storage instead of `localStorage` — useful if you want
multiple devices/users to share the same trip and booking data.

### 1. Create the database

```bash
mysql -u root -p < server/schema.sql
```

### 2. Configure environment

```bash
cd server
cp .env.example .env
# edit .env with your MySQL credentials and a random JWT_SECRET
```

### 3. Install and seed

```bash
npm install
npm run seed     # populates the trips table with a 14-day schedule
npm start        # starts the API on http://localhost:4000
```

### API summary

| Method | Endpoint                  | Purpose                          |
|--------|----------------------------|-----------------------------------|
| POST   | `/api/auth/register`       | Create an account                |
| POST   | `/api/auth/login`          | Sign in, returns a JWT           |
| GET    | `/api/trips?from&to&date`  | Search trips                     |
| GET    | `/api/trips/:id/seats`     | Get taken seats for a trip       |
| POST   | `/api/bookings`            | Create a booking (auth required) |
| GET    | `/api/bookings/me`         | List the signed-in user's bookings |
| POST   | `/api/bookings/:id/cancel` | Cancel a booking                 |

Passwords are hashed with **bcrypt**, auth uses a signed **JWT**, and seat
double-booking is prevented with a transaction + unique lock table
(`trip_seat_locks`).

> The bundled frontend (`js/storage.js`) talks to `localStorage` by default,
> so it works with zero setup. To point it at this API instead, swap the
> body of `storage.js`'s methods for `fetch()` calls against the endpoints
> above and store the returned JWT (e.g. in `sessionStorage`) — the rest of
> `app.js` (views, validation, routing) needs no changes since it only calls
> the `Store.*` methods.

## Notes & limitations (by design, as a demo)

- Payments are simulated — no card is ever charged or transmitted anywhere.
- The frontend's password hashing is a simple, non-cryptographic digest;
  the optional backend uses proper bcrypt hashing and should be preferred
  for anything beyond a local demo.
- Trip data is generated algorithmically rather than pulled from a live
  operator feed, so times/fares are illustrative.

## Credits

Built with plain HTML, CSS and JavaScript — no framework or build step
required for the frontend. Fonts: Space Grotesk, Inter, IBM Plex Mono
(Google Fonts, Open Font License).

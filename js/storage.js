/* ==========================================================================
   Fareline — storage layer
   Everything lives in localStorage under the "fareline:" namespace.
   Password "hashing" here is a simple demo digest, NOT cryptographically
   secure — fine for a client-only demo, do not reuse for a real system.
   (See server/ for a real backend with proper bcrypt hashing.)
   ========================================================================== */

const Store = (function () {
  const KEYS = {
    users: "fareline:users",
    session: "fareline:session",
    bookings: "fareline:bookings",
    bookedSeats: "fareline:bookedSeats",   // { tripId: [seatIndex,...] }
    promos: "fareline:promos",
    reviews: "fareline:reviews",
    notifications: "fareline:notifications", // { userId: [notif,...] }
    cancelledTrips: "fareline:cancelledTrips", // [tripId,...]
    customTrips: "fareline:customTrips",       // [trip,...]
  };

  const DEFAULT_PROMOS = [
    { code: "WELCOME10", type: "percent", value: 10, active: true, uses: 0 },
    { code: "SAVE20", type: "fixed", value: 20, active: true, uses: 0 },
  ];

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }
  function write(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function digest(text) {
    let h = 5381;
    for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }

  function uid(prefix) {
    return prefix + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 900 + 100).toString(36).toUpperCase();
  }

  return {
    // ---- users ----
    getUsers() { return read(KEYS.users, []); },
    findUserByEmail(email) {
      return this.getUsers().find((u) => u.email.toLowerCase() === email.toLowerCase());
    },
    getUserById(id) {
      return this.getUsers().find((u) => u.id === id) || null;
    },
    registerUser({ name, email, phone, password }) {
      const users = this.getUsers();
      if (users.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
        throw new Error("An account with this email already exists.");
      }
      const user = {
        id: "U" + Date.now().toString(36).toUpperCase(),
        name, email, phone,
        passwordHash: digest(password),
        role: "user",
        status: "active",
        createdAt: Date.now(),
      };
      users.push(user);
      write(KEYS.users, users);
      return user;
    },
    verifyLogin(email, password) {
      const user = this.findUserByEmail(email);
      if (!user || user.passwordHash !== digest(password)) {
        throw new Error("Incorrect email or password.");
      }
      if (user.status === "banned") {
        throw new Error("This account has been suspended. Contact support.");
      }
      return user;
    },
    ensureSeedAdmin() {
      const users = this.getUsers();
      if (users.some((u) => u.role === "admin")) return;
      users.push({
        id: "ADMIN1",
        name: "Fareline Admin",
        email: "admin@fareline.demo",
        phone: "0200000000",
        passwordHash: digest("admin123"),
        role: "admin",
        status: "active",
        createdAt: Date.now(),
      });
      write(KEYS.users, users);
    },
    setUserRole(userId, role) {
      const users = this.getUsers();
      const u = users.find((x) => x.id === userId);
      if (!u) return null;
      u.role = role;
      write(KEYS.users, users);
      return u;
    },
    setUserStatus(userId, status) {
      const users = this.getUsers();
      const u = users.find((x) => x.id === userId);
      if (!u) return null;
      u.status = status;
      write(KEYS.users, users);
      return u;
    },

    // ---- session ----
    getSession() { return read(KEYS.session, null); },
    setSession(user) {
      write(KEYS.session, { id: user.id, name: user.name, email: user.email, role: user.role || "user" });
    },
    clearSession() { localStorage.removeItem(KEYS.session); },
    refreshSession() {
      const session = this.getSession();
      if (!session) return null;
      const user = this.getUserById(session.id);
      if (!user) { this.clearSession(); return null; }
      this.setSession(user);
      return this.getSession();
    },

    // ---- bookings ----
    getBookings() { return read(KEYS.bookings, []); },
    getBookingsForUser(userId) {
      return this.getBookings().filter((b) => b.userId === userId).sort((a, b) => b.createdAt - a.createdAt);
    },
    saveBooking(booking) {
      const bookings = this.getBookings();
      bookings.push(booking);
      write(KEYS.bookings, bookings);
      this.markSeatsBooked(booking.tripId, booking.seats);
      return booking;
    },
    cancelBooking(bookingId) {
      const bookings = this.getBookings();
      const booking = bookings.find((b) => b.id === bookingId);
      if (!booking) return null;
      booking.status = "cancelled";
      write(KEYS.bookings, bookings);
      this.releaseSeats(booking.tripId, booking.seats);
      return booking;
    },
    getBookingById(id) {
      return this.getBookings().find((b) => b.id === id) || null;
    },

    // ---- extra booked seats layered on top of the generated occupancy ----
    getBookedSeatMap() { return read(KEYS.bookedSeats, {}); },
    markSeatsBooked(tripId, seatIndexes) {
      const map = this.getBookedSeatMap();
      map[tripId] = Array.from(new Set([...(map[tripId] || []), ...seatIndexes]));
      write(KEYS.bookedSeats, map);
    },
    releaseSeats(tripId, seatIndexes) {
      const map = this.getBookedSeatMap();
      if (!map[tripId]) return;
      map[tripId] = map[tripId].filter((s) => !seatIndexes.includes(s));
      write(KEYS.bookedSeats, map);
    },
    extraOccupiedSeats(tripId) {
      return new Set(this.getBookedSeatMap()[tripId] || []);
    },

    // ---- promo codes ----
    ensureSeedPromos() {
      if (!localStorage.getItem(KEYS.promos)) write(KEYS.promos, DEFAULT_PROMOS);
    },
    getPromos() { return read(KEYS.promos, DEFAULT_PROMOS.slice()); },
    findPromo(code) {
      return this.getPromos().find((p) => p.code.toLowerCase() === String(code || "").toLowerCase());
    },
    addPromo(promo) {
      const promos = this.getPromos();
      if (promos.some((p) => p.code.toLowerCase() === promo.code.toLowerCase())) {
        throw new Error("A promo with this code already exists.");
      }
      promos.push({ uses: 0, active: true, ...promo });
      write(KEYS.promos, promos);
    },
    setPromoActive(code, active) {
      const promos = this.getPromos();
      const p = promos.find((x) => x.code === code);
      if (p) { p.active = active; write(KEYS.promos, promos); }
    },
    deletePromo(code) {
      write(KEYS.promos, this.getPromos().filter((p) => p.code !== code));
    },
    applyPromo(code, subtotal) {
      const promo = this.findPromo(code);
      if (!promo) throw new Error("That promo code isn't recognised.");
      if (!promo.active) throw new Error("That promo code is no longer active.");
      const discount = promo.type === "percent"
        ? Math.round(subtotal * (promo.value / 100))
        : Math.min(promo.value, subtotal);
      return { promo, discount };
    },
    redeemPromo(code) {
      const promos = this.getPromos();
      const p = promos.find((x) => x.code === code);
      if (p) { p.uses = (p.uses || 0) + 1; write(KEYS.promos, promos); }
    },

    // ---- reviews / ratings ----
    getReviews() { return read(KEYS.reviews, []); },
    hasReviewed(bookingId) {
      return this.getReviews().some((r) => r.bookingId === bookingId);
    },
    addReview({ bookingId, tripId, operator, userId, rating, comment }) {
      const reviews = this.getReviews();
      const review = { id: uid("R"), bookingId, tripId, operator, userId, rating, comment: comment || "", createdAt: Date.now() };
      reviews.push(review);
      write(KEYS.reviews, reviews);
      return review;
    },
    ratingForOperator(operator) {
      const list = this.getReviews().filter((r) => r.operator === operator);
      if (!list.length) return null;
      const avg = list.reduce((s, r) => s + r.rating, 0) / list.length;
      return { avg, count: list.length };
    },

    // ---- notifications ----
    getNotifications(userId) {
      const all = read(KEYS.notifications, {});
      return (all[userId] || []).sort((a, b) => b.createdAt - a.createdAt);
    },
    addNotification(userId, { title, body, type = "info" }) {
      const all = read(KEYS.notifications, {});
      const list = all[userId] || [];
      list.unshift({ id: uid("N"), title, body, type, read: false, createdAt: Date.now() });
      all[userId] = list.slice(0, 30);
      write(KEYS.notifications, all);
    },
    unreadCount(userId) {
      return this.getNotifications(userId).filter((n) => !n.read).length;
    },
    markAllNotificationsRead(userId) {
      const all = read(KEYS.notifications, {});
      (all[userId] || []).forEach((n) => (n.read = true));
      write(KEYS.notifications, all);
    },

    // ---- trip overrides (admin: cancel generated trips / add custom ones) ----
    getCancelledTripIds() { return read(KEYS.cancelledTrips, []); },
    cancelGeneratedTrip(tripId) {
      const ids = new Set(this.getCancelledTripIds());
      ids.add(tripId);
      write(KEYS.cancelledTrips, Array.from(ids));
    },
    restoreGeneratedTrip(tripId) {
      write(KEYS.cancelledTrips, this.getCancelledTripIds().filter((id) => id !== tripId));
    },
    getCustomTrips() { return read(KEYS.customTrips, []); },
    addCustomTrip(trip) {
      const trips = this.getCustomTrips();
      trips.push(trip);
      write(KEYS.customTrips, trips);
      return trip;
    },
    removeCustomTrip(tripId) {
      write(KEYS.customTrips, this.getCustomTrips().filter((t) => t.id !== tripId));
    },
  };
})();

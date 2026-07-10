/* ==========================================================================
   Fareline — app
   Small hash router + render-to-innerHTML views. No framework, no build step.
   ========================================================================== */

const viewEl = document.getElementById("view");
const authArea = document.getElementById("authArea");

// Transient state for the in-progress booking (not persisted until payment
// succeeds — at which point it becomes a Store booking record).
let draft = { tripId: null, seats: [], passengers: [], contactEmail: "" };
let pendingRedirect = null;

/* ---------------------------- utilities ---------------------------- */

function qs(params) {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}
function parseQuery(str) {
  const out = {};
  new URLSearchParams(str || "").forEach((v, k) => (out[k] = v));
  return out;
}
function navigate(hash) { window.location.hash = hash; }
function todayISO() { return new Date().toISOString().slice(0, 10); }
function maxDateISO() { const d = new Date(); d.setDate(d.getDate() + 13); return d.toISOString().slice(0, 10); }
function fmtDate(iso) {
  return new Date(iso + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}
function fmtMoney(n) { return `GHS ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function cityOptions(selected) {
  return CITIES.map((c) => `<option value="${c}" ${c === selected ? "selected" : ""}>${c}</option>`).join("");
}
function showToast(message, type = "success") {
  const host = document.getElementById("toastHost");
  const toast = document.createElement("div");
  toast.className = "toast" + (type === "error" ? " is-error" : "");
  toast.textContent = message;
  host.appendChild(toast);
  setTimeout(() => toast.remove(), 3400);
}
function genRef() {
  return "FL" + Date.now().toString(36).slice(-6).toUpperCase() + Math.floor(Math.random() * 90 + 10);
}
function requireAuth(nextHash) {
  if (Store.getSession()) return true;
  pendingRedirect = nextHash;
  openAuthModal("login");
  return false;
}
function requireAdmin() {
  const session = Store.getSession();
  if (!session || session.role !== "admin") {
    showToast("Admin access only.", "error");
    navigate("#/search");
    return false;
  }
  return true;
}

/* ---------------------------- topbar ---------------------------- */

function renderAdminNavLink() {
  const topnav = document.getElementById("topnav");
  const existing = topnav.querySelector('[data-nav="admin"]');
  const session = Store.getSession();
  if (session && session.role === "admin") {
    if (!existing) {
      const btn = document.createElement("button");
      btn.className = "topnav__link topnav__link--admin";
      btn.dataset.nav = "admin";
      btn.textContent = "Admin";
      btn.addEventListener("click", () => navigate("#/admin"));
      topnav.appendChild(btn);
    }
  } else if (existing) {
    existing.remove();
  }
}

function renderNotifBell() {
  const host = document.getElementById("notifArea");
  const session = Store.getSession();
  if (!session) { host.innerHTML = ""; return; }
  const unread = Store.unreadCount(session.id);
  host.innerHTML = `
    <button class="notif-bell" id="notifBellBtn" aria-label="Notifications">
      🔔${unread > 0 ? `<span class="notif-dot">${unread > 9 ? "9+" : unread}</span>` : ""}
    </button>`;
  document.getElementById("notifBellBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    toggleNotifPanel();
  });
}

function toggleNotifPanel() {
  const existing = document.querySelector(".notif-panel");
  if (existing) { existing.remove(); return; }
  const session = Store.getSession();
  if (!session) return;
  const notifs = Store.getNotifications(session.id);
  const panel = document.createElement("div");
  panel.className = "notif-panel";
  panel.innerHTML = `
    <div class="notif-panel__head"><span>Notifications</span>${notifs.length ? '<button class="notif-panel__clear" id="notifMarkRead">Mark all read</button>' : ""}</div>
    <div class="notif-panel__list">
      ${notifs.length ? notifs.map((n) => `
        <div class="notif-item ${n.read ? "" : "is-unread"}">
          <div class="notif-item__title">${escapeHtml(n.title)}</div>
          <div class="notif-item__body">${escapeHtml(n.body)}</div>
          <div class="notif-item__time">${new Date(n.createdAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
        </div>`).join("") : `<div class="notif-empty muted">You're all caught up.</div>`}
    </div>`;
  document.body.appendChild(panel);
  const markBtn = panel.querySelector("#notifMarkRead");
  if (markBtn) markBtn.addEventListener("click", () => {
    Store.markAllNotificationsRead(session.id);
    renderNotifBell();
    panel.remove();
  });
  setTimeout(() => {
    document.addEventListener("click", function closer(e) {
      if (!panel.contains(e.target)) { panel.remove(); document.removeEventListener("click", closer); }
    });
  }, 0);
}

function notify(userId, payload) {
  Store.addNotification(userId, payload);
  const session = Store.getSession();
  if (session && session.id === userId) renderNotifBell();
}

function renderTopbarAuth() {
  const session = Store.getSession();
  if (session) {
    const initials = session.name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
    authArea.innerHTML = `
      <div class="user-chip">
        <span class="user-chip__avatar">${initials}</span>
        <span class="user-chip__name">${escapeHtml(session.name)}</span>
        ${session.role === "admin" ? `<span class="user-chip__role">Admin</span>` : ""}
      </div>
      <button class="btn btn-ghost btn-sm" id="logoutBtn" style="border-color:transparent;color:#C9D0E0;">Sign out</button>`;
    document.getElementById("logoutBtn").onclick = () => {
      Store.clearSession();
      renderTopbarAuth();
      renderAdminNavLink();
      renderNotifBell();
      showToast("Signed out.");
      navigate("#/search");
    };
  } else {
    authArea.innerHTML = `<button class="btn btn-primary btn-sm" id="loginBtn">Sign in</button>`;
    document.getElementById("loginBtn").onclick = () => openAuthModal("login");
  }
  renderAdminNavLink();
  renderNotifBell();
}

function setActiveNav(name) {
  document.querySelectorAll(".topnav__link").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.nav === name);
  });
}
document.querySelectorAll("[data-nav]").forEach((btn) => {
  btn.addEventListener("click", () => navigate("#/" + btn.dataset.nav));
});

/* ---------------------------- auth modal ---------------------------- */

function openAuthModal(mode) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = authModalHtml(mode);
  document.body.appendChild(backdrop);
  wireAuthModal(backdrop, mode);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) backdrop.remove(); });
}

function authModalHtml(mode) {
  if (mode === "login") {
    return `
      <div class="modal">
        <h3>Welcome back</h3>
        <p class="muted" style="margin:6px 0 18px;">Sign in to book and manage your trips.</p>
        <form class="stack" id="loginForm" novalidate>
          <div class="field"><label>Email</label><input type="email" name="email" required></div>
          <div class="field"><label>Password</label><input type="password" name="password" required></div>
          <div class="field-error" id="authError"></div>
          <button class="btn btn-primary btn-block" type="submit">Sign in</button>
        </form>
        <p class="muted" style="margin-top:14px;font-size:.85rem;">New here? <a href="#" id="toRegister" style="color:var(--color-amber-dark);font-weight:600;">Create an account</a></p>
      </div>`;
  }
  return `
    <div class="modal">
      <h3>Create your account</h3>
      <p class="muted" style="margin:6px 0 18px;">Takes less than a minute.</p>
      <form class="stack" id="registerForm" novalidate>
        <div class="field"><label>Full name</label><input type="text" name="name" required></div>
        <div class="field"><label>Email</label><input type="email" name="email" required></div>
        <div class="field"><label>Phone</label><input type="tel" name="phone" required placeholder="0XX XXX XXXX"></div>
        <div class="field"><label>Password</label><input type="password" name="password" required minlength="6"></div>
        <div class="field-error" id="authError"></div>
        <button class="btn btn-primary btn-block" type="submit">Create account</button>
      </form>
      <p class="muted" style="margin-top:14px;font-size:.85rem;">Already have an account? <a href="#" id="toLogin" style="color:var(--color-amber-dark);font-weight:600;">Sign in</a></p>
    </div>`;
}

function wireAuthModal(backdrop, mode) {
  const errorEl = () => backdrop.querySelector("#authError");
  if (mode === "login") {
    backdrop.querySelector("#loginForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        const user = Store.verifyLogin(fd.get("email").trim(), fd.get("password"));
        Store.setSession(user);
        backdrop.remove();
        renderTopbarAuth();
        showToast(`Welcome back, ${user.name.split(" ")[0]}.`);
        if (user.role === "admin") showToast("Signed in as admin — the Admin tab is now in the top nav.");
        if (pendingRedirect) { navigate(pendingRedirect); pendingRedirect = null; }
        else router();
      } catch (err) { errorEl().textContent = err.message; }
    });
    backdrop.querySelector("#toRegister").addEventListener("click", (e) => {
      e.preventDefault();
      backdrop.innerHTML = authModalHtml("register");
      wireAuthModal(backdrop, "register");
    });
  } else {
    backdrop.querySelector("#registerForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        const user = Store.registerUser({
          name: fd.get("name").trim(),
          email: fd.get("email").trim(),
          phone: fd.get("phone").trim(),
          password: fd.get("password"),
        });
        Store.setSession(user);
        Store.addNotification(user.id, { title: "Welcome to Fareline", body: "Your account is ready. Search a route to make your first booking.", type: "info" });
        backdrop.remove();
        renderTopbarAuth();
        showToast(`Account created — welcome, ${user.name.split(" ")[0]}.`);
        if (pendingRedirect) { navigate(pendingRedirect); pendingRedirect = null; }
        else router();
      } catch (err) { errorEl().textContent = err.message; }
    });
    backdrop.querySelector("#toLogin").addEventListener("click", (e) => {
      e.preventDefault();
      backdrop.innerHTML = authModalHtml("login");
      wireAuthModal(backdrop, "login");
    });
  }
}

/* ---------------------------- view: search ---------------------------- */

function renderSearch(params) {
  setActiveNav("search");
  viewEl.innerHTML = `
    <section class="hero">
      <div class="hero__inner">
        <span class="eyebrow">Fareline · intercity bus travel</span>
        <h1>Book your seat, board with confidence.</h1>
        <p class="hero__sub">Compare departures across Ghana's routes, pick an exact seat, and carry a boarding pass on your phone.</p>

        <form class="search-card" id="searchForm">
          <div class="field">
            <label for="fromCity">From</label>
            <select id="fromCity" name="from">${cityOptions(params.from || "Kumasi")}</select>
          </div>
          <div class="field field-swap">
            <button type="button" class="swap-btn" id="swapBtn" title="Swap cities" aria-label="Swap cities">⇄</button>
          </div>
          <div class="field">
            <label for="toCity">To</label>
            <select id="toCity" name="to">${cityOptions(params.to || "Accra")}</select>
          </div>
          <div class="field">
            <label for="travelDate">Departure date</label>
            <input type="date" id="travelDate" name="date" min="${todayISO()}" max="${maxDateISO()}" value="${params.date || todayISO()}">
          </div>
          <div class="field">
            <label for="passengers">Passengers</label>
            <select id="passengers" name="passengers">
              ${[1,2,3,4,5,6].map((n) => `<option value="${n}" ${String(n) === (params.passengers || "1") ? "selected" : ""}>${n} ${n === 1 ? "seat" : "seats"}</option>`).join("")}
            </select>
          </div>
          <button class="btn btn-primary" type="submit" style="grid-column:1/-1;">Search trips</button>
        </form>
      </div>
    </section>

    <div class="container">
      <div class="section-head"><h2>Popular routes</h2></div>
      <div class="stack" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;">
        ${["Kumasi-Accra","Accra-Cape Coast","Kumasi-Tamale","Accra-Koforidua"].map((pair) => {
          const [f, t] = pair.split("-");
          return `<button class="card btn-ghost popular-route" data-from="${f}" data-to="${t}" style="padding:16px;text-align:left;cursor:pointer;">
            <div class="route-strip"><span class="city">${f}</span><span class="route-line"></span><span class="city">${t}</span></div>
            <span class="muted" style="font-size:.82rem;">from ${fmtMoney(Math.round(routeDistance(f,t) * 1.35 / 5) * 5)}</span>
          </button>`;
        }).join("")}
      </div>
    </div>
  `;

  document.getElementById("swapBtn").onclick = () => {
    const from = document.getElementById("fromCity");
    const to = document.getElementById("toCity");
    [from.value, to.value] = [to.value, from.value];
  };
  document.getElementById("searchForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const from = fd.get("from"), to = fd.get("to");
    if (from === to) { showToast("Origin and destination can't be the same.", "error"); return; }
    navigate("#/results?" + qs({ from, to, date: fd.get("date"), passengers: fd.get("passengers") }));
  });
  viewEl.querySelectorAll(".popular-route").forEach((btn) => {
    btn.addEventListener("click", () => {
      navigate("#/results?" + qs({ from: btn.dataset.from, to: btn.dataset.to, date: todayISO(), passengers: 1 }));
    });
  });
}

/* ---------------------------- view: results ---------------------------- */

function renderResults(params) {
  setActiveNav("search");
  const from = params.from, to = params.to, date = params.date || todayISO();
  const passengers = parseInt(params.passengers || "1", 10);
  const trips = TripCatalogue.search({ from, to, date });

  const tripsHtml = trips.map((trip) => {
    const occupied = occupiedSeatsForTrip(trip.id, trip.totalSeats);
    const extra = Store.extraOccupiedSeats(trip.id);
    const seatsLeft = trip.totalSeats - occupied.size - extra.size;
    const durationH = Math.floor(trip.durationMin / 60), durationM = trip.durationMin % 60;
    return `
      <div class="card trip-card">
        <div class="trip-card__top">
          <div>
            <span class="badge badge-${trip.tier}">${TIER_LABEL[trip.tier]}</span>
            <div class="route-strip" style="margin-top:10px;width:280px;max-width:60vw;">
              <span class="city">${trip.departTime}</span><span class="route-line"></span><span class="city">${trip.arriveTime}</span>
            </div>
          </div>
          <div class="trip-meta">
            <span><strong>${trip.operator}</strong>${(() => { const r = Store.ratingForOperator(trip.operator); return r ? ` <span class="op-rating">★ ${r.avg.toFixed(1)} <span class="muted">(${r.count})</span></span>` : ""; })()}</span>
            <span>${durationH}h ${durationM}m</span>
            <span>${escapeHtml(trip.from)} → ${escapeHtml(trip.to)}</span>
          </div>
        </div>
        <div class="trip-card__bottom">
          <div>
            <div class="price">${fmtMoney(trip.fare)} <small>/ seat</small></div>
            <div class="seats-left ${seatsLeft <= 5 ? "is-low" : ""}">${seatsLeft <= 0 ? "Fully booked" : seatsLeft + " seats left"}</div>
          </div>
          <button class="btn btn-primary" data-trip="${trip.id}" data-pax="${passengers}" ${seatsLeft < passengers ? "disabled" : ""}>
            ${seatsLeft < passengers ? "Not enough seats" : "Select seats"}
          </button>
        </div>
      </div>`;
  }).join("");

  viewEl.innerHTML = `
    <div class="container">
      <div class="card" style="padding:16px 20px;margin-bottom:24px;">
        <form class="search-card" id="editSearchForm" style="box-shadow:none;padding:0;">
          <div class="field"><label>From</label><select name="from">${cityOptions(from)}</select></div>
          <div class="field field-swap"><button type="button" class="swap-btn" id="swapBtn2">⇄</button></div>
          <div class="field"><label>To</label><select name="to">${cityOptions(to)}</select></div>
          <div class="field"><label>Date</label><input type="date" name="date" min="${todayISO()}" max="${maxDateISO()}" value="${date}"></div>
          <button class="btn btn-dark" type="submit">Update</button>
        </form>
      </div>

      <div class="section-head">
        <div>
          <span class="eyebrow">${trips.length} ${trips.length === 1 ? "trip" : "trips"} found</span>
          <h2>${escapeHtml(from)} → ${escapeHtml(to)} · ${fmtDate(date)}</h2>
        </div>
      </div>

      <div class="stack">
        ${tripsHtml || `
          <div class="empty-state card">
            <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="var(--color-ink-soft)" stroke-width="1.4"><circle cx="12" cy="12" r="9"/><path d="M9 10h.01M15 10h.01M8 15c1.5 1.2 6.5 1.2 8 0"/></svg>
            <h3>No trips on this route today</h3>
            <p class="muted" style="margin-top:6px;">Try a nearby date or a different route.</p>
          </div>`}
      </div>
    </div>
  `;

  document.getElementById("swapBtn2").onclick = () => {
    const form = document.getElementById("editSearchForm");
    const f = form.elements["from"], t = form.elements["to"];
    [f.value, t.value] = [t.value, f.value];
  };
  document.getElementById("editSearchForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    navigate("#/results?" + qs({ from: fd.get("from"), to: fd.get("to"), date: fd.get("date"), passengers }));
  });
  viewEl.querySelectorAll("[data-trip]").forEach((btn) => {
    btn.addEventListener("click", () => {
      draft = { tripId: btn.dataset.trip, seats: [], passengers: [], contactEmail: "" };
      navigate(`#/trip/${btn.dataset.trip}/seats?pax=${btn.dataset.pax}`);
    });
  });
}

/* ---------------------------- view: seats ---------------------------- */

function renderSeats(tripId, params) {
  const trip = TripCatalogue.byId(tripId);
  if (!trip) { navigate("#/search"); return; }
  const pax = parseInt(params.pax || "1", 10);
  if (draft.tripId !== tripId) draft = { tripId, seats: [], passengers: [], contactEmail: "" };

  const occupied = occupiedSeatsForTrip(tripId, trip.totalSeats);
  const extra = Store.extraOccupiedSeats(tripId);

  const seatButtons = [];
  for (let i = 1; i <= trip.totalSeats; i++) {
    const isTaken = occupied.has(i) || extra.has(i);
    const isSelected = draft.seats.includes(i);
    seatButtons.push(`<button type="button" class="seat ${isTaken ? "is-taken" : ""} ${isSelected ? "is-selected" : ""}" data-seat="${i}" ${isTaken ? "disabled" : ""} aria-label="Seat ${seatLabel(i)} ${isTaken ? "taken" : "available"}">${seatLabel(i)}</button>`);
    if (i % 4 === 2) seatButtons.push(`<span class="seat-aisle-gap" aria-hidden="true"></span>`);
  }

  viewEl.innerHTML = `
    <div class="container">
      <div class="section-head">
        <div>
          <span class="eyebrow">Step 1 of 3</span>
          <h2>Choose ${pax} seat${pax > 1 ? "s" : ""}</h2>
        </div>
        <div class="route-strip" style="width:auto;"><span class="city">${escapeHtml(trip.from)}</span><span class="route-line" style="min-width:60px;"></span><span class="city">${escapeHtml(trip.to)}</span></div>
      </div>
      <div class="steps">
        <span class="step is-active">1. Seats</span><span class="step">2. Passengers</span><span class="step">3. Payment</span>
      </div>

      <div class="seat-layout">
        <div class="bus-shell">
          <div class="bus-shell__wheel-label"><span class="driver-chip">🚌 Driver</span></div>
          <div class="seat-grid">${seatButtons.join("")}</div>
          <div class="seat-legend">
            <span class="legend-item"><span class="legend-swatch"></span>Available</span>
            <span class="legend-item"><span class="legend-swatch selected"></span>Selected</span>
            <span class="legend-item"><span class="legend-swatch taken"></span>Taken</span>
          </div>
        </div>

        <div class="card summary-panel">
          <h3 style="margin-bottom:12px;">Trip summary</h3>
          <div class="summary-row"><span class="muted">Operator</span><span>${escapeHtml(trip.operator)}</span></div>
          <div class="summary-row"><span class="muted">Date</span><span>${fmtDate(trip.date)}</span></div>
          <div class="summary-row"><span class="muted">Departs</span><span>${trip.departTime}</span></div>
          <div class="summary-row"><span class="muted">Selected seats</span><span id="selectedSeatsLabel">—</span></div>
          <div class="summary-total"><span>Total</span><span id="totalFare">${fmtMoney(0)}</span></div>
          <button class="btn btn-primary btn-block" id="continueBtn" style="margin-top:16px;" disabled>Continue</button>
        </div>
      </div>
    </div>
  `;

  function updateSummary() {
    const label = document.getElementById("selectedSeatsLabel");
    const total = document.getElementById("totalFare");
    const continueBtn = document.getElementById("continueBtn");
    label.textContent = draft.seats.length ? draft.seats.slice().sort((a,b)=>a-b).map(seatLabel).join(", ") : "—";
    total.textContent = fmtMoney(draft.seats.length * trip.fare);
    continueBtn.disabled = draft.seats.length !== pax;
    continueBtn.textContent = draft.seats.length === pax ? "Continue" : `Select ${pax - draft.seats.length} more`;
  }

  viewEl.querySelectorAll(".seat[data-seat]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const seatIndex = parseInt(btn.dataset.seat, 10);
      const idx = draft.seats.indexOf(seatIndex);
      if (idx >= 0) {
        draft.seats.splice(idx, 1);
        btn.classList.remove("is-selected");
      } else {
        if (draft.seats.length >= pax) { showToast(`You can only select ${pax} seat${pax > 1 ? "s" : ""} for this search.`, "error"); return; }
        draft.seats.push(seatIndex);
        btn.classList.add("is-selected");
      }
      updateSummary();
    });
  });
  updateSummary();

  document.getElementById("continueBtn").addEventListener("click", () => {
    if (draft.seats.length !== pax) return;
    if (!requireAuth(`#/trip/${tripId}/passengers?pax=${pax}`)) return;
    navigate(`#/trip/${tripId}/passengers?pax=${pax}`);
  });
}

/* ---------------------------- view: passengers ---------------------------- */

function renderPassengers(tripId, params) {
  const trip = TripCatalogue.byId(tripId);
  if (!trip || draft.tripId !== tripId || !draft.seats.length) { navigate(`#/trip/${tripId}/seats?${qs(params)}`); return; }
  if (!requireAuth(`#/trip/${tripId}/passengers?${qs(params)}`)) return;

  const seats = draft.seats.slice().sort((a, b) => a - b);
  const session = Store.getSession();

  viewEl.innerHTML = `
    <div class="container container--narrow">
      <div class="section-head"><div><span class="eyebrow">Step 2 of 3</span><h2>Passenger details</h2></div></div>
      <div class="steps"><span class="step is-done">1. Seats</span><span class="step is-active">2. Passengers</span><span class="step">3. Payment</span></div>

      <form id="paxForm" class="stack" novalidate>
        ${seats.map((seat, i) => `
          <div class="passenger-block">
            <div class="passenger-block__title">Passenger ${i + 1} <span class="seat-tag">Seat ${seatLabel(seat)}</span></div>
            <div class="form-grid">
              <div class="field field--full"><label>Full name</label><input type="text" name="name-${seat}" required value="${i === 0 && session ? escapeHtml(session.name) : ""}"></div>
              <div class="field"><label>Age</label><input type="number" name="age-${seat}" min="1" max="110" required></div>
              <div class="field"><label>Phone</label><input type="tel" name="phone-${seat}" required placeholder="0XX XXX XXXX"></div>
            </div>
          </div>`).join("")}

        <div class="field">
          <label>Contact email for e-ticket</label>
          <input type="email" name="contactEmail" required value="${session ? escapeHtml(session.email) : ""}">
        </div>
        <div class="field-error" id="paxError"></div>
        <button class="btn btn-primary btn-block" type="submit">Continue to payment</button>
      </form>
    </div>
  `;

  document.getElementById("paxForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const passengers = seats.map((seat) => ({
      seat,
      name: (fd.get(`name-${seat}`) || "").trim(),
      age: fd.get(`age-${seat}`),
      phone: (fd.get(`phone-${seat}`) || "").trim(),
    }));
    if (passengers.some((p) => !p.name || !p.phone)) {
      document.getElementById("paxError").textContent = "Please fill in every passenger's name and phone number.";
      return;
    }
    draft.passengers = passengers;
    draft.contactEmail = fd.get("contactEmail").trim();
    navigate(`#/trip/${tripId}/payment?${qs(params)}`);
  });
}

/* ---------------------------- view: payment ---------------------------- */

function renderPayment(tripId, params) {
  const trip = TripCatalogue.byId(tripId);
  if (!trip || draft.tripId !== tripId || !draft.passengers.length) { navigate(`#/trip/${tripId}/seats?${qs(params)}`); return; }
  if (!requireAuth(`#/trip/${tripId}/payment?${qs(params)}`)) return;

  const subtotal = draft.seats.length * trip.fare;
  let appliedPromo = null; // { promo, discount }

  function total() { return Math.max(0, subtotal - (appliedPromo ? appliedPromo.discount : 0)); }

  function renderSummary() {
    return `
      <div class="card" style="padding:18px 20px;margin-bottom:18px;">
        <div class="summary-row"><span class="muted">${draft.seats.length} seat(s) · ${escapeHtml(trip.from)} → ${escapeHtml(trip.to)}</span><span>${fmtMoney(trip.fare)} each</span></div>
        <div class="summary-row"><span class="muted">Subtotal</span><span>${fmtMoney(subtotal)}</span></div>
        ${appliedPromo ? `<div class="summary-row" style="color:var(--color-success);"><span>Promo ${escapeHtml(appliedPromo.promo.code)}</span><span>−${fmtMoney(appliedPromo.discount)}</span></div>` : ""}
        <div class="summary-total"><span>Total due</span><span id="payableTotal">${fmtMoney(total())}</span></div>
      </div>`;
  }

  viewEl.innerHTML = `
    <div class="container container--narrow">
      <div class="section-head"><div><span class="eyebrow">Step 3 of 3</span><h2>Payment</h2></div></div>
      <div class="steps"><span class="step is-done">1. Seats</span><span class="step is-done">2. Passengers</span><span class="step is-active">3. Payment</span></div>

      <div id="summaryHost">${renderSummary()}</div>

      <div class="card promo-box">
        <div class="field-row">
          <input type="text" id="promoInput" placeholder="Promo code (try WELCOME10)" style="text-transform:uppercase;">
          <button type="button" class="btn btn-ghost btn-sm" id="applyPromoBtn">Apply</button>
        </div>
        <div class="field-error" id="promoError"></div>
      </div>

      <form id="payForm" class="stack" novalidate>
        <div class="field"><label>Name on card</label><input type="text" name="cardName" required></div>
        <div class="field"><label>Card number</label><input type="text" name="cardNumber" inputmode="numeric" maxlength="19" placeholder="4242 4242 4242 4242" required></div>
        <div class="form-grid">
          <div class="field"><label>Expiry (MM/YY)</label><input type="text" name="expiry" placeholder="08/28" maxlength="5" required></div>
          <div class="field"><label>CVV</label><input type="text" name="cvv" inputmode="numeric" maxlength="4" required></div>
        </div>
        <div class="field-error" id="payError"></div>
        <button class="btn btn-primary btn-block" id="payBtn" type="submit">Pay ${fmtMoney(total())}</button>
        <p class="muted" style="font-size:.78rem;text-align:center;">This is a demo — no real card is charged.</p>
      </form>
    </div>
  `;

  document.getElementById("applyPromoBtn").addEventListener("click", () => {
    const code = document.getElementById("promoInput").value.trim().toUpperCase();
    const promoErr = document.getElementById("promoError");
    if (!code) { promoErr.textContent = "Enter a promo code first."; return; }
    try {
      appliedPromo = Store.applyPromo(code, subtotal);
      promoErr.textContent = "";
      document.getElementById("summaryHost").innerHTML = renderSummary();
      document.getElementById("payBtn").textContent = `Pay ${fmtMoney(total())}`;
      showToast(`Promo applied — you saved ${fmtMoney(appliedPromo.discount)}.`);
    } catch (err) {
      appliedPromo = null;
      promoErr.textContent = err.message;
    }
  });

  const cardNumberInput = viewEl.querySelector('[name="cardNumber"]');
  cardNumberInput.addEventListener("input", () => {
    cardNumberInput.value = cardNumberInput.value.replace(/\D/g, "").slice(0, 16).replace(/(.{4})/g, "$1 ").trim();
  });
  const expiryInput = viewEl.querySelector('[name="expiry"]');
  expiryInput.addEventListener("input", () => {
    let v = expiryInput.value.replace(/\D/g, "").slice(0, 4);
    if (v.length > 2) v = v.slice(0, 2) + "/" + v.slice(2);
    expiryInput.value = v;
  });

  document.getElementById("payForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const cardNumber = fd.get("cardNumber").replace(/\s/g, "");
    const expiry = fd.get("expiry");
    const cvv = fd.get("cvv");
    const errEl = document.getElementById("payError");

    if (cardNumber.length !== 16) return (errEl.textContent = "Enter a 16-digit card number.");
    if (!/^\d{2}\/\d{2}$/.test(expiry)) return (errEl.textContent = "Enter expiry as MM/YY.");
    const [mm, yy] = expiry.split("/").map(Number);
    if (mm < 1 || mm > 12) return (errEl.textContent = "Enter a valid expiry month.");
    const expDate = new Date(2000 + yy, mm, 0);
    if (expDate < new Date()) return (errEl.textContent = "This card has expired.");
    if (!/^\d{3,4}$/.test(cvv)) return (errEl.textContent = "Enter a valid CVV.");
    errEl.textContent = "";

    const payBtn = document.getElementById("payBtn");
    payBtn.disabled = true;
    payBtn.textContent = "Processing…";

    setTimeout(() => {
      const session = Store.getSession();
      const finalTotal = total();
      const booking = {
        id: genRef(),
        userId: session.id,
        tripId: trip.id,
        seats: draft.seats.slice(),
        passengers: draft.passengers,
        contactEmail: draft.contactEmail,
        totalFare: finalTotal,
        promoCode: appliedPromo ? appliedPromo.promo.code : null,
        status: "confirmed",
        createdAt: Date.now(),
        cardLast4: cardNumber.slice(-4),
      };
      Store.saveBooking(booking);
      if (appliedPromo) Store.redeemPromo(appliedPromo.promo.code);
      notify(session.id, {
        title: "Booking confirmed",
        body: `${trip.from} → ${trip.to} on ${fmtDate(trip.date)}, seats ${booking.seats.slice().sort((a,b)=>a-b).map(seatLabel).join(", ")}. Ref ${booking.id}.`,
        type: "success",
      });
      draft = { tripId: null, seats: [], passengers: [], contactEmail: "" };
      showToast("Payment successful — your seat is booked!");
      navigate(`#/ticket/${booking.id}`);
    }, 700);
  });
}

/* ---------------------------- view: ticket ---------------------------- */

function ticketBarcode(seed) {
  const rnd = seededRandom(hashCode(seed));
  let bars = "";
  for (let i = 0; i < 34; i++) {
    const h = 14 + Math.floor(rnd() * 32);
    bars += `<span style="height:${h}px;"></span>`;
  }
  return bars;
}

function ticketMarkup(booking, trip) {
  const durationH = Math.floor(trip.durationMin / 60), durationM = trip.durationMin % 60;
  return `
    <div class="ticket card" id="ticketNode">
      <div class="ticket__main">
        <div class="ticket__header">
          <div>
            <span class="eyebrow">Boarding pass</span>
            <h3>${escapeHtml(trip.operator)}</h3>
          </div>
          <span class="status-pill ${booking.status}">${booking.status}</span>
        </div>
        <div class="ticket__ref">Booking ref · ${booking.id}</div>

        <div class="ticket__route">
          <div class="route-strip"><span class="city">${escapeHtml(trip.from)}</span><span class="route-line"></span><span class="city">${escapeHtml(trip.to)}</span></div>
          <div class="ticket__times"><span class="ticket__time">${trip.departTime}</span><span class="ticket__time">${trip.arriveTime}</span></div>
        </div>

        <dl class="ticket__grid">
          <div><dt>Date</dt><dd>${fmtDate(trip.date)}</dd></div>
          <div><dt>Duration</dt><dd>${durationH}h ${durationM}m</dd></div>
          <div><dt>Class</dt><dd>${TIER_LABEL[trip.tier]}</dd></div>
          <div><dt>Seats</dt><dd>${booking.seats.slice().sort((a,b)=>a-b).map(seatLabel).join(", ")}</dd></div>
          <div><dt>Passengers</dt><dd style="font-family:var(--font-body);font-weight:600;">${booking.passengers.map(p=>escapeHtml(p.name)).join(", ")}</dd></div>
          <div><dt>Total paid</dt><dd>${fmtMoney(booking.totalFare)}</dd></div>
        </dl>
      </div>
      <div class="ticket__stub">
        <div>
          <span class="eyebrow">Fareline</span>
          <div style="font-family:var(--font-mono);font-size:.8rem;margin-top:6px;">${booking.id}</div>
          <div class="muted" style="font-size:.78rem;margin-top:10px;">Card ending ${booking.cardLast4 || "----"}</div>
        </div>
        <div class="ticket__barcode">${ticketBarcode(booking.id)}</div>
      </div>
    </div>`;
}

function renderTicket(bookingId) {
  const booking = Store.getBookingById(bookingId);
  const trip = booking && TripCatalogue.byId(booking.tripId);
  if (!booking || !trip) {
    viewEl.innerHTML = `<div class="container"><div class="empty-state card"><h3>Ticket not found</h3></div></div>`;
    return;
  }
  viewEl.innerHTML = `
    <div class="container">
      ${ticketMarkup(booking, trip)}
      <div class="ticket-actions">
        <button class="btn btn-dark" id="printBtn">Print ticket</button>
        <button class="btn btn-ghost" id="downloadBtn">Download ticket (.html)</button>
        <button class="btn btn-ghost" id="toBookingsBtn">Go to my bookings</button>
      </div>
    </div>`;

  document.getElementById("printBtn").addEventListener("click", () => window.print());
  document.getElementById("toBookingsBtn").addEventListener("click", () => navigate("#/bookings"));
  document.getElementById("downloadBtn").addEventListener("click", async () => {
    let css = "";
    try { css = await (await fetch("css/style.css")).text(); } catch { /* fall back to bare markup */ }
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Fareline ticket ${booking.id}</title>
      <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600;700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap" rel="stylesheet">
      <style>${css}
        body{padding:40px;} .ticket{margin:0 auto;}</style>
      </head><body>${ticketMarkup(booking, trip)}</body></html>`;
    const blob = new Blob([html], { type: "text/html" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `fareline-ticket-${booking.id}.html`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
}

/* ---------------------------- view: bookings ---------------------------- */

function renderBookings() {
  setActiveNav("bookings");
  if (!requireAuth("#/bookings")) { viewEl.innerHTML = `<div class="container"></div>`; return; }
  const session = Store.getSession();
  const bookings = Store.getBookingsForUser(session.id);

  const rows = bookings.map((b) => {
    const trip = TripCatalogue.byId(b.tripId);
    if (!trip) return "";
    const canCancel = b.status === "confirmed" && trip.date >= todayISO();
    const canReview = b.status === "confirmed" && trip.date < todayISO() && !Store.hasReviewed(b.id);
    return `
      <div class="card booking-row">
        <div class="booking-row__info">
          <div class="route-strip" style="width:auto;"><span class="city">${escapeHtml(trip.from)}</span><span class="route-line" style="min-width:36px;"></span><span class="city">${escapeHtml(trip.to)}</span></div>
          <span class="muted" style="font-size:.85rem;">${fmtDate(trip.date)} · ${trip.departTime} · Seats ${b.seats.slice().sort((a,b2)=>a-b2).map(seatLabel).join(", ")} · ${fmtMoney(b.totalFare)}${b.promoCode ? ` · Promo ${escapeHtml(b.promoCode)}` : ""}</span>
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <span class="status-pill ${b.status}">${b.status}</span>
          <button class="btn btn-ghost btn-sm" data-view="${b.id}">View ticket</button>
          ${canCancel ? `<button class="btn btn-danger-ghost btn-sm" data-cancel="${b.id}">Cancel</button>` : ""}
          ${canReview ? `<button class="btn btn-ghost btn-sm" data-review="${b.id}">Rate trip</button>` : ""}
        </div>
      </div>`;
  }).join("");

  viewEl.innerHTML = `
    <div class="container">
      <div class="section-head"><h2>My bookings</h2></div>
      <div class="stack">
        ${rows || `<div class="empty-state card"><h3>No bookings yet</h3><p class="muted" style="margin-top:6px;">Search a route to make your first booking.</p></div>`}
      </div>
    </div>`;

  viewEl.querySelectorAll("[data-view]").forEach((btn) => btn.addEventListener("click", () => navigate(`#/ticket/${btn.dataset.view}`)));
  viewEl.querySelectorAll("[data-cancel]").forEach((btn) => btn.addEventListener("click", () => {
    if (!confirm("Cancel this booking? This can't be undone.")) return;
    const booking = Store.cancelBooking(btn.dataset.cancel);
    if (booking) {
      notify(session.id, { title: "Booking cancelled", body: `Ref ${booking.id} has been cancelled and your seats released.`, type: "warning" });
    }
    showToast("Booking cancelled.");
    renderBookings();
  }));
  viewEl.querySelectorAll("[data-review]").forEach((btn) => btn.addEventListener("click", () => openReviewModal(btn.dataset.review)));
}

/* ---------------------------- rating modal ---------------------------- */

function openReviewModal(bookingId) {
  const booking = Store.getBookingById(bookingId);
  const trip = booking && TripCatalogue.byId(booking.tripId);
  if (!booking || !trip) return;
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal">
      <h3>Rate your trip</h3>
      <p class="muted" style="margin:6px 0 16px;">${escapeHtml(trip.operator)} · ${escapeHtml(trip.from)} → ${escapeHtml(trip.to)}</p>
      <div class="star-picker" id="starPicker">
        ${[1,2,3,4,5].map((n) => `<button type="button" class="star-btn" data-star="${n}">★</button>`).join("")}
      </div>
      <div class="field" style="margin-top:14px;"><label>Comment (optional)</label><textarea id="reviewComment" rows="3" style="border:1.5px solid var(--color-line);border-radius:var(--radius-sm);padding:10px;font-family:var(--font-body);"></textarea></div>
      <button class="btn btn-primary btn-block" id="submitReviewBtn" style="margin-top:14px;" disabled>Submit rating</button>
    </div>`;
  document.body.appendChild(backdrop);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) backdrop.remove(); });

  let rating = 0;
  const stars = backdrop.querySelectorAll(".star-btn");
  const submitBtn = backdrop.querySelector("#submitReviewBtn");
  function paint() {
    stars.forEach((s) => s.classList.toggle("is-on", Number(s.dataset.star) <= rating));
    submitBtn.disabled = rating === 0;
  }
  stars.forEach((s) => s.addEventListener("click", () => { rating = Number(s.dataset.star); paint(); }));

  submitBtn.addEventListener("click", () => {
    const session = Store.getSession();
    Store.addReview({
      bookingId, tripId: trip.id, operator: trip.operator, userId: session.id,
      rating, comment: backdrop.querySelector("#reviewComment").value.trim(),
    });
    backdrop.remove();
    showToast("Thanks for your rating!");
    renderBookings();
  });
}

/* ============================================================
   ADMIN DASHBOARD
   ============================================================ */

const ADMIN_TABS = [
  { key: "overview", label: "Overview" },
  { key: "trips", label: "Trips" },
  { key: "bookings", label: "Bookings" },
  { key: "users", label: "Users" },
  { key: "promos", label: "Promo codes" },
];

function adminStats() {
  const bookings = Store.getBookings();
  const confirmed = bookings.filter((b) => b.status === "confirmed");
  const revenue = confirmed.reduce((s, b) => s + b.totalFare, 0);
  const users = Store.getUsers();

  const routeMap = {};
  confirmed.forEach((b) => {
    const trip = TripCatalogue.byId(b.tripId);
    if (!trip) return;
    const key = `${trip.from} → ${trip.to}`;
    routeMap[key] = (routeMap[key] || 0) + b.totalFare;
  });
  const topRoutes = Object.entries(routeMap).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const maxRoute = topRoutes.length ? topRoutes[0][1] : 1;

  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const iso = formatDateISO(d);
    const dayRevenue = confirmed
      .filter((b) => formatDateISO(new Date(b.createdAt)) === iso)
      .reduce((s, b) => s + b.totalFare, 0);
    days.push({ iso, revenue: dayRevenue });
  }
  const maxDay = Math.max(1, ...days.map((d) => d.revenue));

  return {
    revenue, totalBookings: bookings.length, confirmedCount: confirmed.length,
    cancelledCount: bookings.length - confirmed.length,
    totalUsers: users.length,
    avgFare: confirmed.length ? revenue / confirmed.length : 0,
    topRoutes, maxRoute, days, maxDay,
  };
}

function adminLayout(active, contentHtml) {
  return `
    <div class="container admin-container">
      <div class="section-head"><div><span class="eyebrow">Admin</span><h2>Dashboard</h2></div></div>
      <div class="admin-layout">
        <nav class="admin-sidebar">
          ${ADMIN_TABS.map((t) => `<button class="admin-tab ${t.key === active ? "is-active" : ""}" data-admin-tab="${t.key}">${t.label}</button>`).join("")}
        </nav>
        <div class="admin-content">${contentHtml}</div>
      </div>
    </div>`;
}

function wireAdminNav() {
  viewEl.querySelectorAll("[data-admin-tab]").forEach((btn) => {
    btn.addEventListener("click", () => navigate(`#/admin/${btn.dataset.adminTab === "overview" ? "" : btn.dataset.adminTab}`));
  });
}

function renderAdmin(sub) {
  setActiveNav("admin");
  if (!requireAdmin()) return;
  const tab = sub || "overview";
  if (tab === "overview") return renderAdminOverview();
  if (tab === "trips") return renderAdminTrips();
  if (tab === "bookings") return renderAdminBookings();
  if (tab === "users") return renderAdminUsers();
  if (tab === "promos") return renderAdminPromos();
  navigate("#/admin");
}

/* ---- overview ---- */
function renderAdminOverview() {
  const s = adminStats();
  const content = `
    <div class="kpi-grid">
      <div class="kpi-card"><span class="kpi-label">Total revenue</span><span class="kpi-value">${fmtMoney(s.revenue)}</span></div>
      <div class="kpi-card"><span class="kpi-label">Confirmed bookings</span><span class="kpi-value">${s.confirmedCount}</span></div>
      <div class="kpi-card"><span class="kpi-label">Cancelled bookings</span><span class="kpi-value">${s.cancelledCount}</span></div>
      <div class="kpi-card"><span class="kpi-label">Registered users</span><span class="kpi-value">${s.totalUsers}</span></div>
      <div class="kpi-card"><span class="kpi-label">Average fare</span><span class="kpi-value">${fmtMoney(s.avgFare)}</span></div>
    </div>

    <div class="admin-panels">
      <div class="card admin-panel">
        <h3>Revenue, last 7 days</h3>
        <div class="bar-chart">
          ${s.days.map((d) => `
            <div class="bar-chart__col">
              <div class="bar-chart__bar" style="height:${Math.max(4, Math.round((d.revenue / s.maxDay) * 110))}px" title="${fmtMoney(d.revenue)}"></div>
              <span class="bar-chart__label">${new Date(d.iso + "T00:00:00").toLocaleDateString(undefined, { weekday: "short" })}</span>
            </div>`).join("")}
        </div>
      </div>
      <div class="card admin-panel">
        <h3>Top routes by revenue</h3>
        ${s.topRoutes.length ? `
          <div class="stack" style="gap:10px;">
            ${s.topRoutes.map(([route, rev]) => `
              <div class="route-bar-row">
                <span class="route-bar-row__label">${escapeHtml(route)}</span>
                <div class="route-bar-row__track"><div class="route-bar-row__fill" style="width:${Math.max(4, Math.round((rev / s.maxRoute) * 100))}%"></div></div>
                <span class="route-bar-row__value">${fmtMoney(rev)}</span>
              </div>`).join("")}
          </div>` : `<p class="muted">No confirmed bookings yet.</p>`}
      </div>
    </div>`;
  viewEl.innerHTML = adminLayout("overview", content);
  wireAdminNav();
}

/* ---- trips ---- */
function renderAdminTrips() {
  const date = todayISO();
  const trips = TripCatalogue.all().filter((t) => t.date === date).sort((a, b) => a.departTime.localeCompare(b.departTime));

  const rows = trips.map((t) => {
    const occupied = occupiedSeatsForTrip(t.id, t.totalSeats).size + Store.extraOccupiedSeats(t.id).size;
    const isCustom = Store.getCustomTrips().some((c) => c.id === t.id);
    return `
      <tr>
        <td>${escapeHtml(t.from)} → ${escapeHtml(t.to)}${isCustom ? ' <span class="badge badge-standard">custom</span>' : ""}</td>
        <td>${t.departTime}</td>
        <td>${escapeHtml(t.operator)}</td>
        <td>${TIER_LABEL[t.tier]}</td>
        <td>${fmtMoney(t.fare)}</td>
        <td>${occupied}/${t.totalSeats}</td>
        <td>
          ${isCustom
            ? `<button class="btn btn-danger-ghost btn-sm" data-remove-custom="${t.id}">Delete</button>`
            : `<button class="btn btn-danger-ghost btn-sm" data-cancel-trip="${t.id}">Cancel</button>`}
        </td>
      </tr>`;
  }).join("");

  const cancelledToday = Store.getCancelledTripIds()
    .map((id) => TripCatalogue.generated().find((t) => t.id === id))
    .filter((t) => t && t.date === date);

  const content = `
    <div class="card admin-panel" style="margin-bottom:20px;">
      <h3>Today's schedule · ${fmtDate(date)}</h3>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Route</th><th>Departs</th><th>Operator</th><th>Class</th><th>Fare</th><th>Seats sold</th><th></th></tr></thead>
          <tbody>${rows || `<tr><td colspan="7" class="muted">No trips today.</td></tr>`}</tbody>
        </table>
      </div>
      ${cancelledToday.length ? `
        <h3 style="margin-top:22px;">Cancelled today</h3>
        <div class="table-wrap">
          <table class="data-table">
            <tbody>
              ${cancelledToday.map((t) => `<tr><td>${escapeHtml(t.from)} → ${escapeHtml(t.to)}</td><td>${t.departTime}</td><td>${escapeHtml(t.operator)}</td><td><button class="btn btn-ghost btn-sm" data-restore-trip="${t.id}">Restore</button></td></tr>`).join("")}
            </tbody>
          </table>
        </div>` : ""}
    </div>

    <div class="card admin-panel">
      <h3>Add a custom trip</h3>
      <form id="addTripForm" class="form-grid" style="margin-top:12px;">
        <div class="field"><label>From</label><select name="from">${cityOptions("Kumasi")}</select></div>
        <div class="field"><label>To</label><select name="to">${cityOptions("Accra")}</select></div>
        <div class="field"><label>Date</label><input type="date" name="date" min="${todayISO()}" max="${maxDateISO()}" value="${todayISO()}" required></div>
        <div class="field"><label>Departure time</label><input type="time" name="departTime" value="08:00" required></div>
        <div class="field"><label>Operator</label><input type="text" name="operator" value="Fareline Special" required></div>
        <div class="field"><label>Class</label>
          <select name="tier">
            <option value="standard">Standard</option>
            <option value="executive">Executive</option>
            <option value="vip">VIP</option>
          </select>
        </div>
        <div class="field"><label>Fare (GHS)</label><input type="number" name="fare" min="1" step="1" value="120" required></div>
        <div class="field"><label>Total seats</label><input type="number" name="totalSeats" min="4" max="60" value="44" required></div>
        <button class="btn btn-primary" type="submit" style="grid-column:1/-1;">Add trip</button>
      </form>
    </div>`;

  viewEl.innerHTML = adminLayout("trips", content);
  wireAdminNav();

  viewEl.querySelectorAll("[data-cancel-trip]").forEach((btn) => btn.addEventListener("click", () => {
    if (!confirm("Cancel this scheduled trip? Booked passengers won't be automatically refunded in this demo.")) return;
    Store.cancelGeneratedTrip(btn.dataset.cancelTrip);
    showToast("Trip cancelled.");
    renderAdminTrips();
  }));
  viewEl.querySelectorAll("[data-restore-trip]").forEach((btn) => btn.addEventListener("click", () => {
    Store.restoreGeneratedTrip(btn.dataset.restoreTrip);
    showToast("Trip restored.");
    renderAdminTrips();
  }));
  viewEl.querySelectorAll("[data-remove-custom]").forEach((btn) => btn.addEventListener("click", () => {
    if (!confirm("Delete this custom trip?")) return;
    Store.removeCustomTrip(btn.dataset.removeCustom);
    showToast("Custom trip removed.");
    renderAdminTrips();
  }));

  document.getElementById("addTripForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const from = fd.get("from"), to = fd.get("to");
    if (from === to) { showToast("Origin and destination can't be the same.", "error"); return; }
    const date = fd.get("date");
    const departTime = fd.get("departTime");
    const distance = routeDistance(from, to);
    const durationMin = Math.round((distance / 62) * 60);
    const [dh, dm] = departTime.split(":").map(Number);
    const arriveTime = addMinutes(dh, dm + durationMin);
    const trip = {
      id: "CUSTOM-" + uidLite(),
      from, to, date, departTime, arriveTime, durationMin,
      operator: fd.get("operator").trim() || "Fareline Special",
      tier: fd.get("tier"),
      fare: Math.max(1, parseInt(fd.get("fare"), 10) || 1),
      totalSeats: Math.max(4, parseInt(fd.get("totalSeats"), 10) || 44),
    };
    Store.addCustomTrip(trip);
    showToast("Custom trip added.");
    renderAdminTrips();
  });
}
function uidLite() { return Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 900 + 100); }

/* ---- bookings ---- */
function renderAdminBookings() {
  const bookings = Store.getBookings().slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 200);
  const rows = bookings.map((b) => {
    const trip = TripCatalogue.byId(b.tripId);
    const user = Store.getUserById(b.userId);
    return `
      <tr>
        <td class="mono">${b.id}</td>
        <td>${user ? escapeHtml(user.name) : "—"}</td>
        <td>${trip ? `${escapeHtml(trip.from)} → ${escapeHtml(trip.to)}` : "—"}</td>
        <td>${trip ? fmtDate(trip.date) : "—"}</td>
        <td>${fmtMoney(b.totalFare)}</td>
        <td><span class="status-pill ${b.status}">${b.status}</span></td>
        <td>
          <button class="btn btn-ghost btn-sm" data-view="${b.id}">View</button>
          ${b.status === "confirmed" ? `<button class="btn btn-danger-ghost btn-sm" data-admin-cancel="${b.id}">Cancel</button>` : ""}
        </td>
      </tr>`;
  }).join("");

  const content = `
    <div class="card admin-panel">
      <h3>All bookings <span class="muted" style="font-weight:400;">(latest 200)</span></h3>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Ref</th><th>Customer</th><th>Route</th><th>Date</th><th>Total</th><th>Status</th><th></th></tr></thead>
          <tbody>${rows || `<tr><td colspan="7" class="muted">No bookings yet.</td></tr>`}</tbody>
        </table>
      </div>
    </div>`;
  viewEl.innerHTML = adminLayout("bookings", content);
  wireAdminNav();

  viewEl.querySelectorAll("[data-view]").forEach((btn) => btn.addEventListener("click", () => navigate(`#/ticket/${btn.dataset.view}`)));
  viewEl.querySelectorAll("[data-admin-cancel]").forEach((btn) => btn.addEventListener("click", () => {
    if (!confirm("Cancel this booking on the customer's behalf?")) return;
    const booking = Store.cancelBooking(btn.dataset.adminCancel);
    if (booking) notify(booking.userId, { title: "Booking cancelled by support", body: `Ref ${booking.id} was cancelled by Fareline support.`, type: "warning" });
    showToast("Booking cancelled.");
    renderAdminBookings();
  }));
}

/* ---- users ---- */
function renderAdminUsers() {
  const session = Store.getSession();
  const users = Store.getUsers().slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const rows = users.map((u) => {
    const bookingCount = Store.getBookingsForUser(u.id).length;
    const isSelf = u.id === session.id;
    return `
      <tr>
        <td>${escapeHtml(u.name)}</td>
        <td>${escapeHtml(u.email)}</td>
        <td>${escapeHtml(u.phone || "—")}</td>
        <td>${bookingCount}</td>
        <td>${u.role === "admin" ? `<span class="badge badge-vip">Admin</span>` : `<span class="badge badge-standard">User</span>`}</td>
        <td>${u.status === "banned" ? `<span class="status-pill cancelled">banned</span>` : `<span class="status-pill confirmed">active</span>`}</td>
        <td style="white-space:nowrap;">
          ${isSelf ? `<span class="muted" style="font-size:.8rem;">You</span>` : `
            <button class="btn btn-ghost btn-sm" data-toggle-role="${u.id}">${u.role === "admin" ? "Demote" : "Make admin"}</button>
            <button class="btn ${u.status === "banned" ? "btn-ghost" : "btn-danger-ghost"} btn-sm" data-toggle-status="${u.id}">${u.status === "banned" ? "Unban" : "Ban"}</button>
          `}
        </td>
      </tr>`;
  }).join("");

  const content = `
    <div class="card admin-panel">
      <h3>Users</h3>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Bookings</th><th>Role</th><th>Status</th><th></th></tr></thead>
          <tbody>${rows || `<tr><td colspan="7" class="muted">No users yet.</td></tr>`}</tbody>
        </table>
      </div>
    </div>`;
  viewEl.innerHTML = adminLayout("users", content);
  wireAdminNav();

  viewEl.querySelectorAll("[data-toggle-role]").forEach((btn) => btn.addEventListener("click", () => {
    const u = Store.getUserById(btn.dataset.toggleRole);
    Store.setUserRole(u.id, u.role === "admin" ? "user" : "admin");
    showToast(u.role === "admin" ? `${u.name} is no longer an admin.` : `${u.name} is now an admin.`);
    renderAdminUsers();
  }));
  viewEl.querySelectorAll("[data-toggle-status]").forEach((btn) => btn.addEventListener("click", () => {
    const u = Store.getUserById(btn.dataset.toggleStatus);
    const next = u.status === "banned" ? "active" : "banned";
    Store.setUserStatus(u.id, next);
    showToast(next === "banned" ? `${u.name} has been banned.` : `${u.name} has been unbanned.`);
    renderAdminUsers();
  }));
}

/* ---- promo codes ---- */
function renderAdminPromos() {
  const promos = Store.getPromos();
  const rows = promos.map((p) => `
    <tr>
      <td class="mono">${escapeHtml(p.code)}</td>
      <td>${p.type === "percent" ? `${p.value}%` : fmtMoney(p.value)}</td>
      <td>${p.uses || 0}</td>
      <td>${p.active ? `<span class="status-pill confirmed">active</span>` : `<span class="status-pill cancelled">paused</span>`}</td>
      <td>
        <button class="btn btn-ghost btn-sm" data-toggle-promo="${p.code}">${p.active ? "Pause" : "Activate"}</button>
        <button class="btn btn-danger-ghost btn-sm" data-delete-promo="${p.code}">Delete</button>
      </td>
    </tr>`).join("");

  const content = `
    <div class="card admin-panel" style="margin-bottom:20px;">
      <h3>Promo codes</h3>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Code</th><th>Discount</th><th>Uses</th><th>Status</th><th></th></tr></thead>
          <tbody>${rows || `<tr><td colspan="5" class="muted">No promo codes yet.</td></tr>`}</tbody>
        </table>
      </div>
    </div>
    <div class="card admin-panel">
      <h3>New promo code</h3>
      <form id="addPromoForm" class="form-grid" style="margin-top:12px;">
        <div class="field"><label>Code</label><input type="text" name="code" placeholder="SUMMER15" required style="text-transform:uppercase;"></div>
        <div class="field"><label>Type</label>
          <select name="type"><option value="percent">Percent off</option><option value="fixed">Fixed amount (GHS)</option></select>
        </div>
        <div class="field"><label>Value</label><input type="number" name="value" min="1" value="10" required></div>
        <button class="btn btn-primary" type="submit" style="grid-column:1/-1;">Create promo</button>
      </form>
    </div>`;
  viewEl.innerHTML = adminLayout("promos", content);
  wireAdminNav();

  viewEl.querySelectorAll("[data-toggle-promo]").forEach((btn) => btn.addEventListener("click", () => {
    const p = Store.findPromo(btn.dataset.togglePromo);
    Store.setPromoActive(p.code, !p.active);
    renderAdminPromos();
  }));
  viewEl.querySelectorAll("[data-delete-promo]").forEach((btn) => btn.addEventListener("click", () => {
    if (!confirm("Delete this promo code?")) return;
    Store.deletePromo(btn.dataset.deletePromo);
    showToast("Promo deleted.");
    renderAdminPromos();
  }));
  document.getElementById("addPromoForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      Store.addPromo({ code: fd.get("code").trim().toUpperCase(), type: fd.get("type"), value: Math.max(1, parseInt(fd.get("value"), 10) || 1) });
      showToast("Promo code created.");
      renderAdminPromos();
    } catch (err) {
      showToast(err.message, "error");
    }
  });
}

/* ---------------------------- router ---------------------------- */

function router() {
  const hash = window.location.hash.replace(/^#/, "") || "/search";
  const [path, queryStr] = hash.split("?");
  const params = parseQuery(queryStr);
  const segs = path.split("/").filter(Boolean);

  viewEl.focus();

  if (segs[0] === "search") return renderSearch(params);
  if (segs[0] === "results") return renderResults(params);
  if (segs[0] === "bookings") return renderBookings();
  if (segs[0] === "trip" && segs[2] === "seats") return renderSeats(segs[1], params);
  if (segs[0] === "trip" && segs[2] === "passengers") return renderPassengers(segs[1], params);
  if (segs[0] === "trip" && segs[2] === "payment") return renderPayment(segs[1], params);
  if (segs[0] === "ticket") return renderTicket(segs[1]);
  if (segs[0] === "admin") return renderAdmin(segs[1]);

  navigate("#/search");
}

window.addEventListener("hashchange", router);
window.addEventListener("DOMContentLoaded", () => {
  Store.ensureSeedAdmin();
  Store.ensureSeedPromos();
  Store.refreshSession();
  renderTopbarAuth();
  router();
});

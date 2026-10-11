// EventBook - frontend logic

// ---- Settings: change these if you recreate the API or user pool ----
const API = "https://y25p7gjr7k.execute-api.us-east-2.amazonaws.com";
const CLIENT_ID = "2crbis6usdmt7ukohbafbunv26";
const REGION = "us-east-2";
// ---------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const $ = (id) => document.getElementById(id);

const state = { token: null, email: null, events: [], category: "All", query: "", pendingEmail: null };

// ---------- Messages ----------
let toastTimer;
function toast(text, kind) {
  const t = $("toast");
  t.textContent = text;
  t.className = "toast " + (kind || "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 6000);
}

function say(text, kind) {
  if ($("dlg").open) {
    const m = $("dmsg");
    m.textContent = text || "";
    m.className = "dmsg " + (kind || "");
  } else if (text) {
    toast(text, kind);
  }
}

// ---------- Cognito (direct API calls, no SDK needed) ----------
async function cognito(target, body) {
  const res = await fetch(`https://cognito-idp.${REGION}.amazonaws.com/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": "AWSCognitoIdentityProviderService." + target,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || "Something went wrong. Try again.");
  return data;
}

function readToken(token) {
  try {
    const p = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return { email: p.email, exp: p.exp };
  } catch (e) {
    return null;
  }
}

function setSession(token) {
  const info = token && readToken(token);
  const valid = info && info.exp * 1000 > Date.now();
  state.token = valid ? token : null;
  state.email = valid ? info.email : null;
  try {
    valid ? sessionStorage.setItem("idToken", token) : sessionStorage.removeItem("idToken");
  } catch (e) { /* storage may be blocked; the session then lasts until refresh */ }
  $("who").textContent = state.email || "";
  $("btn-login").classList.toggle("hidden", valid);
  $("btn-logout").classList.toggle("hidden", !valid);
}

// ---------- Login dialog ----------
function showTab(name) {
  for (const n of ["login", "signup"]) {
    $("t-" + n).setAttribute("aria-selected", String(n === name));
    $("f-" + n).classList.toggle("hidden", n !== name);
  }
  $("f-code").classList.add("hidden");
  $("dlg-title").textContent = name === "login" ? "Welcome back" : "Create your account";
  say("");
}

function openDialog(tab) {
  showTab(tab || "login");
  $("dlg").showModal();
}

$("btn-login").onclick = () => openDialog("login");
$("dlg-close").onclick = () => $("dlg").close();
$("t-login").onclick = () => showTab("login");
$("t-signup").onclick = () => showTab("signup");
$("btn-logout").onclick = () => { setSession(null); toast("You are logged out."); };

$("f-login").onsubmit = async (e) => {
  e.preventDefault();
  say("Logging in...");
  try {
    const r = await cognito("InitiateAuth", {
      AuthFlow: "USER_PASSWORD_AUTH",
      ClientId: CLIENT_ID,
      AuthParameters: { USERNAME: $("l-email").value.trim(), PASSWORD: $("l-pass").value },
    });
    setSession(r.AuthenticationResult.IdToken);
    $("l-pass").value = "";
    $("dlg").close();
    toast("Logged in as " + state.email + ". Pick an event to book.", "ok");
  } catch (err) {
    say(err.message, "err");
  }
};

$("f-signup").onsubmit = async (e) => {
  e.preventDefault();
  say("Creating your account...");
  state.pendingEmail = $("s-email").value.trim();
  try {
    await cognito("SignUp", {
      ClientId: CLIENT_ID,
      Username: state.pendingEmail,
      Password: $("s-pass").value,
      UserAttributes: [{ Name: "email", Value: state.pendingEmail }],
    });
    $("f-signup").classList.add("hidden");
    $("f-code").classList.remove("hidden");
    say("Account created. Enter the code we emailed you.", "ok");
  } catch (err) {
    say(err.message, "err");
  }
};

$("f-code").onsubmit = async (e) => {
  e.preventDefault();
  say("Verifying...");
  try {
    await cognito("ConfirmSignUp", {
      ClientId: CLIENT_ID,
      Username: state.pendingEmail,
      ConfirmationCode: $("c-code").value.trim(),
    });
    $("l-email").value = state.pendingEmail;
    $("s-pass").value = "";
    showTab("login");
    say("Email verified. You can log in now.", "ok");
  } catch (err) {
    say(err.message, "err");
  }
};

// ---------- Events ----------
function ticket(ev) {
  const [datePart = "", timePart = ""] = String(ev.date || "").split(" ");
  const [, month, day] = datePart.split("-");
  const seats = Number(ev.seatsLeft) || 0;

  const el = document.createElement("article");
  el.className = "ticket";

  const poster = document.createElement("img");
  poster.className = "poster";
  poster.alt = "";
  poster.loading = "lazy";
  poster.src = ev.imageUrl || "images/" + String(ev.category || "default").toLowerCase() + ".svg";
  poster.onerror = () => { poster.onerror = null; poster.src = "images/default.svg"; };
  const strip = document.createElement("div");
  strip.className = "ticket-row";

  const stub = document.createElement("div");
  stub.className = "stub";
  const d = document.createElement("b");
  d.textContent = day || "";
  const m = document.createElement("span");
  m.textContent = MONTHS[Number(month) - 1] || "";
  stub.append(d, m);

  const body = document.createElement("div");
  body.className = "body";
  const tag = document.createElement("span");
  tag.className = "tag";
  tag.dataset.cat = ev.category || "";
  tag.textContent = ev.category || "Event";
  const h = document.createElement("h3");
  h.textContent = ev.title;
  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = timePart + " at " + ev.venue;

  const row = document.createElement("div");
  row.className = "row";
  const info = document.createElement("div");
  const price = document.createElement("div");
  price.className = "price";
  price.textContent = Number(ev.price) === 0 ? "Free" : "Rs " + ev.price;
  const left = document.createElement("div");
  left.className = "seats" + (seats === 0 ? " out" : seats <= 10 ? " low" : "");
  left.textContent = seats === 0 ? "Sold out" : seats + " seats left";
  info.append(price, left);

  const btn = document.createElement("button");
  btn.className = "btn";
  btn.textContent = "Book now";
  btn.disabled = seats === 0;
  btn.onclick = () => book(ev, btn);

  row.append(info, btn);
  body.append(tag, h, meta, row);
  strip.append(stub, body);
  el.append(poster, strip);
  return el;
}

function renderChips() {
  const cats = ["All", ...new Set(state.events.map((e) => e.category).filter(Boolean))];
  const box = $("chips");
  box.textContent = "";
  for (const c of cats) {
    const b = document.createElement("button");
    b.className = "chip";
    b.textContent = c;
    b.setAttribute("aria-pressed", String(c === state.category));
    b.onclick = () => { state.category = c; renderChips(); renderGrid(); };
    box.append(b);
  }
}

function renderGrid() {
  const q = state.query.toLowerCase();
  const list = state.events.filter((e) =>
    (state.category === "All" || e.category === state.category) &&
    (!q || (e.title + " " + e.venue + " " + (e.category || "")).toLowerCase().includes(q))
  );
  const grid = $("grid");
  grid.textContent = "";
  if (!list.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "No events match your search. Try a different word or category.";
    grid.append(p);
    return;
  }
  list.forEach((ev) => grid.append(ticket(ev)));
}

async function loadEvents() {
  const grid = $("grid");
  grid.textContent = "";
  for (let i = 0; i < 3; i++) {
    const s = document.createElement("div");
    s.className = "skeleton";
    grid.append(s);
  }
  try {
    const res = await fetch(API + "/events");
    if (!res.ok) throw new Error("bad status");
    state.events = (await res.json()).sort((a, b) => String(a.date).localeCompare(String(b.date)));
    renderChips();
    renderGrid();
  } catch (err) {
    grid.textContent = "";
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "Could not load events. Check your connection and refresh the page.";
    grid.append(p);
  }
}

$("search").oninput = (e) => { state.query = e.target.value; renderGrid(); };

// ---------- Booking ----------
async function book(ev, btn) {
  setSession(state.token); // drops the session if the token has expired
  if (!state.token) {
    toast("Log in to book " + ev.title + ".", "err");
    openDialog("login");
    return;
  }
  btn.disabled = true;
  try {
    const res = await fetch(API + "/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + state.token },
      body: JSON.stringify({ eventId: ev.eventId }),
    });
    if (res.status === 401) {
      setSession(null);
      throw new Error("Your session expired. Log in again.");
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Booking failed. Try again.");
    toast(
      "Booked " + ev.title + ". Booking ID: " + data.bookingId +
        (data.emailSent ? ". Confirmation sent to " + state.email + " (check spam)." : ". The email could not be sent."),
      "ok"
    );
    loadEvents();
  } catch (err) {
    toast(err.message, "err");
    btn.disabled = false;
  }
}

// ---------- Start ----------
try { setSession(sessionStorage.getItem("idToken")); } catch (e) { setSession(null); }
loadEvents();

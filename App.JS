// app.js — PayFlow frontend logic (vanilla JS, no build step)

const API_BASE = "http://localhost:4000/api";

const state = {
  token: null,
  user: null,
  pendingPayee: null, // { id, name, upi_id, phone }
};

// ---------- tiny helpers ----------

const $ = (sel) => document.querySelector(sel);
const $all = (sel) => Array.from(document.querySelectorAll(sel));

function money(n) {
  return Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function initialOf(name) {
  return (name || "?").trim().charAt(0).toUpperCase();
}
async function api(path, { method = "GET", body, auth = true } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth && state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong");
  return data;
}

// ---------- navigation ----------

function showScreen(name) {
  $all(".screen").forEach((s) => s.classList.remove("active"));
  $(`#screen-${name}`).classList.add("active");
  $all(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.nav === name));
  const nav = $("#bottom-nav");
  nav.style.display = name === "auth" ? "none" : "flex";
  if (name === "home") refreshHome();
  if (name === "history") refreshHistory();
  if (name === "send") resetSendForm();
}

$all("[data-nav]").forEach((el) => {
  el.addEventListener("click", () => showScreen(el.dataset.nav));
});

// ---------- auth ----------

$all(".auth-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    $all(".auth-tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    const isLogin = tab.dataset.tab === "login";
    $("#form-login").classList.toggle("hidden", !isLogin);
    $("#form-register").classList.toggle("hidden", isLogin);
  });
});

$("#form-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = $("#login-error");
  errEl.textContent = "";
  const phone = $("#login-phone").value.trim();
  const password = $("#login-password").value;
  try {
    const data = await api("/auth/login", { method: "POST", auth: false, body: { phone, password } });
    onAuthed(data);
  } catch (err) {
    errEl.textContent = err.message;
  }
});

$("#form-register").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = $("#register-error");
  errEl.textContent = "";
  const name = $("#reg-name").value.trim();
  const phone = $("#reg-phone").value.trim();
  const password = $("#reg-password").value;
  const pin = $("#reg-pin").value;
  try {
    const data = await api("/auth/register", { method: "POST", auth: false, body: { name, phone, password, pin } });
    onAuthed(data);
  } catch (err) {
    errEl.textContent = err.message;
  }
});

function onAuthed({ token, user }) {
  state.token = token;
  state.user = user;
  sessionStorage.setItem("payflow_token", token);
  showScreen("home");
}

$("#btn-logout").addEventListener("click", () => {
  state.token = null;
  state.user = null;
  sessionStorage.removeItem("payflow_token");
  showScreen("auth");
});

// ---------- home ----------

async function refreshHome() {
  try {
    const me = await api("/auth/me");
    state.user = me.user;
    $("#home-username").textContent = state.user.name;
    $("#home-initial").textContent = initialOf(state.user.name);
    $("#home-upi").textContent = state.user.upi_id;

    const wallet = await api("/wallet/balance");
    $("#balance-value").textContent = money(wallet.balance);

    const txns = await api("/transactions");
    renderTxnList($("#home-recent"), txns.transactions.slice(0, 4));
  } catch (err) {
    console.error(err);
  }
}

function renderTxnList(listEl, txns) {
  listEl.innerHTML = "";
  txns.forEach((t) => {
    const li = document.createElement("li");
    li.className = "txn-item";
    const isDebit = t.direction === "DEBIT";
    li.innerHTML = `
      <div class="txn-glyph ${isDebit ? "debit" : "credit"}">${isDebit ? "↗" : "↙"}</div>
      <div class="txn-mid">
        <p class="txn-name">${t.counterparty.name}</p>
        <p class="txn-meta">${t.note ? t.note + " · " : ""}${new Date(t.created_at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
      </div>
      <div class="txn-amount ${isDebit ? "debit" : "credit"}">${isDebit ? "−" : "+"}₹${money(t.amount)}</div>
    `;
    listEl.appendChild(li);
  });
}

// ---------- history ----------

async function refreshHistory() {
  try {
    const txns = await api("/transactions");
    renderTxnList($("#history-list"), txns.transactions);
    $("#history-empty").classList.toggle("hidden", txns.transactions.length > 0);
  } catch (err) {
    console.error(err);
  }
}

// ---------- send money ----------

function resetSendForm() {
  $("#form-lookup").reset();
  $("#form-pay").classList.add("hidden");
  $("#payee-card").classList.add("hidden");
  $("#lookup-error").textContent = "";
  $("#pay-error").textContent = "";
  state.pendingPayee = null;
}

$("#form-lookup").addEventListener("submit", async (e) => {
  e.preventDefault();
  await lookupPayee($("#send-to").value.trim(), "#lookup-error");
});

$("#form-scan-fallback").addEventListener("submit", async (e) => {
  e.preventDefault();
  const upi = $("#scan-upi").value.trim();
  showScreen("send");
  $("#send-to").value = upi;
  await lookupPayee(upi, "#lookup-error");
});

async function lookupPayee(query, errSelector) {
  const errEl = $(errSelector);
  errEl.textContent = "";
  try {
    const { user } = await api(`/wallet/lookup?query=${encodeURIComponent(query)}`);
    state.pendingPayee = user;
    $("#payee-initial").textContent = initialOf(user.name);
    $("#payee-name").textContent = user.name;
    $("#payee-upi").textContent = user.upi_id;
    $("#payee-card").classList.remove("hidden");
    $("#form-pay").classList.remove("hidden");
  } catch (err) {
    errEl.textContent = err.message;
    $("#payee-card").classList.add("hidden");
    $("#form-pay").classList.add("hidden");
  }
}

$("#form-pay").addEventListener("submit", (e) => {
  e.preventDefault();
  const amount = Number($("#pay-amount").value);
  if (!state.pendingPayee || !amount || amount <= 0) return;
  openPinModal(amount, $("#pay-note").value.trim());
});

// ---------- PIN modal ----------

let pinBuffer = "";
let pendingPayment = null;

function openPinModal(amount, note) {
  pendingPayment = { amount, note };
  pinBuffer = "";
  renderPinDots();
  $("#pin-error").textContent = "";
  $("#pin-modal-summary").textContent = `Paying ₹${money(amount)} to ${state.pendingPayee.name}`;
  $("#pin-modal").classList.remove("hidden");
  $("#pin-input").value = "";
  $("#pin-input").focus();
}

function renderPinDots() {
  const dots = $all("#pin-dots span");
  dots.forEach((d, i) => d.classList.toggle("filled", i < pinBuffer.length));
}

$("#pin-input").addEventListener("input", (e) => {
  pinBuffer = e.target.value.replace(/\D/g, "").slice(0, 6);
  renderPinDots();
});

$("#pin-cancel").addEventListener("click", closePinModal);
function closePinModal() {
  $("#pin-modal").classList.add("hidden");
  pendingPayment = null;
}

$("#pin-confirm").addEventListener("click", async () => {
  if (!pendingPayment || pinBuffer.length < 4) {
    $("#pin-error").textContent = "Enter your PIN to continue";
    return;
  }
  try {
    const res = await api("/pay", {
      method: "POST",
      body: {
        to: state.pendingPayee.upi_id,
        amount: pendingPayment.amount,
        note: pendingPayment.note,
        pin: pinBuffer,
      },
    });
    closePinModal();
    showSuccess(pendingPayment.amount, state.pendingPayee.name);
  } catch (err) {
    $("#pin-error").textContent = err.message;
  }
});

// ---------- success overlay ----------

function showSuccess(amount, payeeName) {
  $("#success-amount").textContent = `₹${money(amount)}`;
  $("#success-sub").textContent = `sent to ${payeeName}`;
  $("#success-overlay").classList.remove("hidden");
  // restart check-draw animation
  const check = $("#check-path");
  check.style.animation = "none";
  void check.offsetWidth;
  check.style.animation = null;
}

$("#success-done").addEventListener("click", () => {
  $("#success-overlay").classList.add("hidden");
  showScreen("home");
});

// ---------- boot ----------

(function boot() {
  const saved = sessionStorage.getItem("payflow_token");
  if (saved) {
    state.token = saved;
    showScreen("home");
  } else {
    showScreen("auth");
  }
})();

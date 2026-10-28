/* SPARK admin: leads (with a live popup), client folders, Drive videos, tasks, notes and WhatsApp chat. */
"use strict";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const lat = (s) => esc(s).replace(/[A-Za-z][A-Za-z0-9 .&'-]*/g, (m) => `<span class="lat">${m}</span>`);
const sqlDate = (s) => (s ? new Date(s.includes("T") ? s : s.replace(" ", "T") + "Z") : null);

const I = {
  inbox: '<path d="M3 13l3-8h12l3 8v6H3z"/><path d="M3 13h5l1 3h6l1-3h5"/>',
  folder: '<path d="M3 6h6l2 2h10v11H3z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  link: '<path d="M10 14a4 4 0 006 0l3-3a4 4 0 00-6-6l-1 1"/><path d="M14 10a4 4 0 00-6 0l-3 3a4 4 0 006 6l1-1"/>',
  drive: '<path d="M8 3h8l6 11-4 7H6l-4-7z"/><path d="M8 3l6 11H2M16 3l-6 11M14 14h8"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  back: '<path d="M9 6l6 6-6 6"/>',
  send: '<path d="M20 4L3 11l7 2 2 7z"/><path d="M10 13l10-9"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
  out: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>',
};
const icon = (name, cls = "ico") => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${I[name]}</svg>`;

function ago(s) {
  const d = sqlDate(s);
  if (!d) return "";
  const sec = (Date.now() - d) / 1000;
  if (sec < 60) return "עכשיו";
  if (sec < 3600) return `לפני ${Math.floor(sec / 60)} דק׳`;
  if (sec < 86400) return `לפני ${Math.floor(sec / 3600)} שע׳`;
  if (sec < 86400 * 7) return `לפני ${Math.floor(sec / 86400)} ימים`;
  return d.toLocaleDateString("he-IL");
}
const clock = (s) => sqlDate(s)?.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" }) || "";
const dayLabel = (s) => sqlDate(s)?.toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" }) || "";
const fmtSize = (b) => (b > 1e9 ? `${(b / 1e9).toFixed(1)}GB` : `${Math.max(1, Math.round(b / 1e6))}MB`);
const fmtDur = (s) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : "");

class ApiError extends Error {}
async function api(path, opts = {}) {
  const init = { method: opts.method || "GET", headers: {}, credentials: "same-origin" };
  if (opts.body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(opts.body);
  }
  let res;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError("אין חיבור לשרת.");
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.needsLogin) {
    showLogin();
    throw new ApiError(data.error);
  }
  if (!res.ok || data.success === false) {
    const err = new ApiError(data.error || "משהו השתבש.");
    err.data = data;
    throw err;
  }
  return data;
}

const STATUS = { new: "חדשה", contacted: "בטיפול", converted: "לקוח", closed: "סגורה" };
const TYPES_WEB = /אתר|נחיתה/;

let me = null;
let waState = { status: "off" };
const openChats = new Map(); // phone -> chat controller

/* ======================= login ======================= */

function showLogin() {
  const err = new URLSearchParams(location.search).get("error");
  const msg = err === "not_allowed" ? "החשבון הזה לא מורשה להיכנס לניהול." : err ? "ההתחברות לא הצליחה. נסו שוב." : "";
  $("#app").innerHTML = `
    <main class="gate">
      <div class="panel gate-card">
        <img class="gate-logo" src="/assets/spark-logo-3d.png" alt="">
        <h1><span class="cap">ניהול</span> <span class="neon lat tilt">SPARK</span></h1>
        <p class="muted">מתחברים עם חשבון Google. אותה התחברות מחברת גם את תיקיית הדרייב של הלקוחות.</p>
        <a class="btn g-btn" href="/auth/google">${googleG()} כניסה עם Google</a>
        <p class="err-box">${esc(msg)}</p>
      </div>
    </main>`;
  if (err) history.replaceState(null, "", "/admin");
}
const googleG = () =>
  '<svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';

/* ======================= shell ======================= */

async function boot() {
  try {
    me = await api("/api/admin/me");
  } catch {
    return;
  }
  waState = me.wa;
  $("#app").innerHTML = `
    <div class="shell">
      <nav class="side" aria-label="ניווט">
        <a class="brand" href="#/leads"><img src="/assets/spark-mark.png" alt=""><span>SPARK</span></a>
        <a class="nav-link" href="#/leads" data-nav="leads">${icon("inbox")}פניות<span class="count" id="leadCount"></span></a>
        <a class="nav-link" href="#/clients" data-nav="clients">${icon("folder")}לקוחות<span class="count" id="msgCount"></span></a>
        <a class="nav-link" href="#/settings" data-nav="settings">${icon("gear")}הגדרות<span class="count" id="setCount"></span></a>
        <div class="side-foot">
          <span class="row"><span class="status-dot" id="waDot"></span><span id="waLabel"></span></span>
          <span class="who">${esc(me.email)}</span>
          <button class="btn btn-ghost btn-sm" type="button" id="logoutBtn">${icon("out")} התנתקות</button>
        </div>
      </nav>
      <main class="main" id="view"></main>
    </div>`;
  $("#logoutBtn").onclick = async () => {
    await api("/api/admin/logout", { method: "POST" }).catch(() => {});
    location.href = "/admin";
  };
  renderWaBadge();
  setLeadCount(me.counts.newLeads);
  setMsgCount(me.counts.unreadMessages);
  connectEvents();
  initPush().catch(() => {});
  window.addEventListener("hashchange", route);
  route();
  // Leads that arrived while the admin was closed get one popup each (up to three).
  if (me.counts.unseenLeads) {
    const { leads } = await api("/api/admin/leads");
    leads.filter((l) => !l.seen).slice(0, 3).reverse().forEach((l) => leadToast(l, false));
  }
}

function setLeadCount(n) {
  const el = $("#leadCount");
  if (el) {
    el.textContent = n || "";
    el.dataset.n = n || 0;
  }
  document.title = n ? `(${n}) SPARK · ניהול` : "SPARK · ניהול";
}
function setMsgCount(n) {
  const el = $("#msgCount");
  if (!el) return;
  el.textContent = n || "";
  el.dataset.n = n || 0;
}
async function refreshCounts() {
  const c = await api("/api/admin/counts");
  setLeadCount(c.newLeads);
  setMsgCount(c.unreadMessages);
}

// A system notification when the admin tab isn't in front (after the browser allows it).
// With push on, the service worker shows it instead, so it isn't shown twice.
function desktopNotify(title, body, onClick) {
  if (pushOn || !document.hidden || !("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const n = new Notification(title, { body, icon: "/assets/spark-mark.png", lang: "he", dir: "rtl" });
    n.onclick = () => {
      window.focus();
      onClick?.();
      n.close();
    };
  } catch {}
}

const WA_LABEL = { connected: "וואטסאפ מחובר", qr: "צריך לסרוק QR", starting: "וואטסאפ עולה...", linking: "מתחבר...", off: "וואטסאפ כבוי", logged_out: "וואטסאפ התנתק", error: "שגיאה בוואטסאפ", disabled: "וואטסאפ כבוי" };
function renderWaBadge() {
  const dot = $("#waDot");
  if (!dot) return;
  dot.className = "status-dot " + (waState.status === "connected" ? "ok" : ["starting", "linking"].includes(waState.status) ? "warn" : "bad");
  $("#waLabel").textContent = WA_LABEL[waState.status] || waState.status;
  const s = $("#setCount");
  const needs = ["qr", "logged_out", "error"].includes(waState.status) || !me.drive.connected;
  s.textContent = needs ? "!" : "";
  s.dataset.n = needs ? 1 : 0;
}

function route() {
  const [, page = "leads", id] = location.hash.split("/");
  $$(".nav-link").forEach((a) => a.classList.toggle("on", a.dataset.nav === page));
  openChats.clear();
  if (modal.open) modal.close(); // a dialog belongs to the page it was opened on
  const view = $("#view");
  view.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
  window.scrollTo(0, 0);
  if (page === "clients" && id) return clientPage(view, Number(id));
  if (page === "clients") return clientsPage(view);
  if (page === "settings") return settingsPage(view);
  return leadsPage(view);
}

/* ======================= push notifications ======================= */

// Push reaches this device even with the admin page (or the browser window) closed.
// On iPhone it works once the admin page is added to the home screen.
let pushOn = false;
const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

async function initPush() {
  if (!("serviceWorker" in navigator)) return;
  const reg = await navigator.serviceWorker.register("/admin-sw.js", { scope: "/admin" });
  // A tap on a notification focuses this page and opens what it was about.
  navigator.serviceWorker.addEventListener("message", (e) => {
    if (e.data?.open) location.href = e.data.open;
  });
  if (!pushSupported() || Notification.permission !== "granted") return;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    pushOn = true;
    // Keep the server's copy fresh (it's dropped there if the browser rotated it).
    api("/api/admin/push/subscribe", { method: "POST", body: { subscription: sub.toJSON() } }).catch(() => {});
  }
}

async function enablePush() {
  if ((await Notification.requestPermission()) !== "granted") throw new ApiError("ההתראות נחסמו. אפשר לאשר אותן בהגדרות האתר בדפדפן.");
  const reg = await navigator.serviceWorker.ready;
  const { publicKey } = await api("/api/admin/push");
  const key = Uint8Array.from(atob(publicKey.replace(/-/g, "+").replace(/_/g, "/")), (ch) => ch.charCodeAt(0));
  const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }));
  await api("/api/admin/push/subscribe", { method: "POST", body: { subscription: sub.toJSON() } });
  pushOn = true;
}

async function disablePush() {
  const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
  if (sub) {
    await api("/api/admin/push/unsubscribe", { method: "POST", body: { endpoint: sub.endpoint } }).catch(() => {});
    await sub.unsubscribe();
  }
  pushOn = false;
}

/* ======================= live events ======================= */

function connectEvents() {
  const es = new EventSource("/api/admin/events");
  es.addEventListener("lead", (e) => {
    const lead = JSON.parse(e.data);
    leadToast(lead, true);
    desktopNotify(`פנייה חדשה: ${lead.name}`, [lead.phoneDisplay, lead.type, lead.message].filter(Boolean).join(" · "), () => (location.hash = "#/leads"));
    refreshCounts().catch(() => {});
    if (currentPage() === "leads") leadsPage($("#view"), true);
  });
  es.addEventListener("message", (e) => {
    const { phone, message, name } = JSON.parse(e.data);
    const chat = openChats.get(phone);
    if (chat) chat.upsert(message);
    else if (message.direction === "in") {
      chime();
      messageToast(name || fmtPhone(phone), message.body, phone);
    }
    if (message.direction === "in") {
      desktopNotify(name || fmtPhone(phone), message.body, () => chatModal(phone, name || fmtPhone(phone)));
      refreshCounts().catch(() => {});
    }
  });
  es.addEventListener("message-unknown", (e) => {
    const { name, body } = JSON.parse(e.data);
    chime();
    toast(
      `<div class="notif-top"><span>הודעה ממספר לא מזוהה</span><i>${icon("chat")}</i></div>
       <h4>${esc(name || "וואטסאפ")}</h4><p>${esc(body.length > 160 ? body.slice(0, 160) + "…" : body)}</p>
       <div class="acts"><button class="btn btn-ghost btn-sm" type="button" data-x>סגירה</button></div>`,
      { timeout: 30000, cls: "mini" },
    );
  });
  es.addEventListener("wa", (e) => {
    waState = JSON.parse(e.data);
    renderWaBadge();
    openChats.forEach((c) => c.renderWaNote());
    if (currentPage() === "settings") renderWaCard();
  });
  es.addEventListener("clients", () => {
    if (location.hash === "#/clients") clientsPage($("#view"), true);
  });
}
const currentPage = () => location.hash.split("/")[1] || "leads";

function chime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [880, 1320].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      o.type = "sine";
      g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.14);
      g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + i * 0.14 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.14 + 0.35);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.14);
      o.stop(ctx.currentTime + i * 0.14 + 0.4);
    });
  } catch {}
}

function toast(html, { timeout = 0, cls = "" } = {}) {
  const el = document.createElement("div");
  el.className = "toast " + cls;
  el.innerHTML = html;
  $("#toasts").prepend(el);
  const close = () => el.remove();
  if (timeout) setTimeout(close, timeout);
  el.addEventListener("click", (e) => {
    if (e.target.closest("[data-x]")) close();
  });
  return { el, close };
}

// The "new lead" popup: talk to the lead, then fill in their details to open a client folder.
function leadToast(lead, live) {
  if (live) chime();
  const t = toast(`
    <div class="notif-top"><span>פנייה חדשה · ${esc(ago(lead.created_at))}</span><i><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7z"/></svg></i></div>
    <h4>${esc(lead.name)}</h4>
    <p><span class="phone">${esc(lead.phoneDisplay)}</span>${lead.type ? ` · ${esc(lead.type)}` : ""}</p>
    ${lead.message ? `<p>${esc(lead.message)}</p>` : ""}
    <div class="acts">
      <a class="btn btn-primary btn-sm" href="tel:+${esc(lead.phone)}" data-act="call">${icon("phone")} שיחה</a>
      <button class="btn btn-ghost btn-sm" type="button" data-act="chat">${icon("chat")} וואטסאפ</button>
      <button class="btn btn-ghost btn-sm" type="button" data-act="convert">${icon("plus")} מילוי פרטים</button>
      <button class="btn btn-ghost btn-sm" type="button" data-x>אחר כך</button>
    </div>`);
  const seen = () => api(`/api/admin/leads/${lead.id}`, { method: "PATCH", body: { seen: true } }).catch(() => {});
  t.el.querySelector("[data-act=call]").addEventListener("click", () => {
    seen();
    api(`/api/admin/leads/${lead.id}`, { method: "PATCH", body: { status: "contacted" } }).catch(() => {});
  });
  t.el.querySelector("[data-act=chat]").onclick = () => {
    seen();
    t.close();
    chatModal(lead.phone, lead.name);
  };
  t.el.querySelector("[data-act=convert]").onclick = () => {
    seen();
    t.close();
    clientForm({ lead });
  };
  t.el.querySelector("[data-x]").addEventListener("click", seen);
}

function messageToast(name, body, phone) {
  const t = toast(
    `<div class="notif-top"><span>הודעה חדשה בוואטסאפ</span><i>${icon("chat")}</i></div>
     <h4>${esc(name)}</h4><p>${esc(body.length > 120 ? body.slice(0, 120) + "…" : body)}</p>
     <div class="acts"><button class="btn btn-primary btn-sm" type="button" data-open>פתיחת השיחה</button><button class="btn btn-ghost btn-sm" type="button" data-x>סגירה</button></div>`,
    { timeout: 15000, cls: "mini" },
  );
  t.el.querySelector("[data-open]").onclick = () => {
    t.close();
    chatModal(phone, name);
  };
}

/* ======================= dialogs ======================= */

const modal = $("#modal");
function openModal(html) {
  openChats.forEach((c, p) => c.inModal && openChats.delete(p));
  $("#modalBody").innerHTML = html;
  if (!modal.open) modal.showModal();
  return $("#modalBody");
}
modal.addEventListener("click", (e) => {
  if (e.target === modal || e.target.closest("[data-close]")) modal.close();
});
modal.addEventListener("close", () => openChats.forEach((c, p) => c.inModal && openChats.delete(p)));

const player = $("#player");
function playVideo(v) {
  $("#playerVideo").src = v.src;
  $("#playerName").textContent = v.name;
  $("#playerDl").href = v.download;
  player.showModal();
  $("#playerVideo").play().catch(() => {});
}
player.addEventListener("click", (e) => {
  if (e.target === player || e.target.closest("[data-close]")) player.close();
});
player.addEventListener("close", () => {
  $("#playerVideo").pause();
  $("#playerVideo").removeAttribute("src");
  $("#playerVideo").load();
});

function chatModal(phone, name) {
  const body = openModal(`<div class="row spread"><h2>${esc(name)}</h2><button class="btn btn-ghost btn-sm" type="button" data-close>סגירה</button></div><div id="modalChat"></div>`);
  const ctl = mountChat($("#modalChat", body), phone, name, { compact: true });
  ctl.inModal = true;
}

/* ======================= WhatsApp chat ======================= */

function mountChat(host, phone, name, { compact = false } = {}) {
  host.innerHTML = `
    <section class="card chat ${compact ? "" : "rim"}" style="${compact ? "height:min(60svh,560px)" : ""}">
      <div class="chat-head"><h3>${compact ? "וואטסאפ" : "הודעות"}</h3><span class="muted small phone">${esc(fmtPhone(phone))}</span></div>
      <p class="wa-off" hidden></p>
      <div class="chat-log" aria-live="polite"><div class="loading"><span class="spinner"></span></div></div>
      <form class="chat-form">
        <textarea class="input" rows="1" placeholder="כתבו הודעה ל${esc(name.split(" ")[0])}..." aria-label="הודעה"></textarea>
        <button class="btn btn-primary" type="submit" aria-label="שליחה">${icon("send")}</button>
      </form>
    </section>`;
  const log = $(".chat-log", host);
  const form = $(".chat-form", host);
  const ta = $("textarea", form);
  const note = $(".wa-off", host);
  let lastDay = "";
  const ids = new Map();

  const ctl = {
    renderWaNote() {
      const off = waState.status !== "connected";
      note.hidden = !off;
      note.textContent = off ? "וואטסאפ לא מחובר כרגע. הודעות יישמרו וישלחו כשיתחבר (אפשר לחבר בהגדרות)." : "";
    },
    upsert(m) {
      const html = bubble(m);
      const day = dayLabel(m.created_at);
      const existing = ids.get(m.id);
      if (existing) {
        existing.outerHTML = html;
        ids.set(m.id, $(`[data-mid="${m.id}"]`, log));
        return;
      }
      if (day !== lastDay) {
        log.insertAdjacentHTML("beforeend", `<div class="bubble sys">${esc(day)}</div>`);
        lastDay = day;
      }
      log.insertAdjacentHTML("beforeend", html);
      ids.set(m.id, log.lastElementChild);
      log.scrollTop = log.scrollHeight;
    },
  };
  openChats.set(phone, ctl);
  ctl.renderWaNote();

  api(`/api/admin/messages?phone=${encodeURIComponent(phone)}`)
    .then(({ messages }) => {
      log.innerHTML = messages.length ? "" : `<div class="bubble sys">עוד אין הודעות. ההודעה הראשונה שתשלחו תגיע ל${esc(name.split(" ")[0])} בוואטסאפ.</div>`;
      messages.forEach((m) => ctl.upsert(m));
      refreshCounts().catch(() => {});
    })
    .catch((e) => (log.innerHTML = `<div class="bubble sys">${esc(e.message)}</div>`));

  log.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-retry]");
    if (!b) return;
    b.disabled = true;
    try {
      const { replaced, message } = await api(`/api/admin/messages/${b.dataset.retry}/retry`, { method: "POST" });
      ids.get(replaced)?.remove();
      ids.delete(replaced);
      ctl.upsert(message);
    } catch (err) {
      alert(err.message);
      b.disabled = false;
    }
  });
  ta.addEventListener("input", () => {
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
  });
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = ta.value.trim();
    if (!body) return;
    ta.value = "";
    ta.style.height = "auto";
    try {
      const { message } = await api("/api/admin/messages", { method: "POST", body: { phone, body } });
      ctl.upsert(message);
    } catch (err) {
      ta.value = body;
      alert(err.message);
    }
  });
  return ctl;
}

const KIND_TAG = { auto: "הודעה אוטומטית", link: "קישור לאזור האישי", video: "עדכון על סרטון חדש", otp: "" };
function bubble(m) {
  if (m.kind === "otp") return `<div class="bubble sys" data-mid="${m.id}">🔐 ${esc(m.body)} · ${clock(m.created_at)}</div>`;
  const tick = m.direction === "in" ? "" : m.status === "sent" ? "✓✓" : m.status === "pending" ? "⏱" : "";
  const failed = m.status === "failed";
  return `<div class="bubble ${m.direction}${failed ? " failed" : ""}" data-mid="${m.id}">${KIND_TAG[m.kind] ? `<span class="tag">${KIND_TAG[m.kind]}</span>` : ""}${esc(m.body)}<time>${clock(m.created_at)} ${tick}${
    failed ? ` · לא נשלחה <button class="link-btn" type="button" data-retry="${m.id}">לשלוח שוב</button>` : ""
  }</time></div>`;
}
function fmtPhone(digits) {
  if (digits?.startsWith("972") && digits.length === 12) return `0${digits.slice(3, 5)}-${digits.slice(5)}`;
  return "+" + digits;
}

/* ======================= leads ======================= */

let leadFilter = "new";
async function leadsPage(view, quiet = false) {
  let data;
  try {
    data = await api("/api/admin/leads");
  } catch (e) {
    if (!quiet) view.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
    return;
  }
  if (currentPage() !== "leads") return;
  const counts = Object.fromEntries(Object.keys(STATUS).map((k) => [k, data.leads.filter((l) => l.status === k).length]));
  const list = leadFilter === "all" ? data.leads : data.leads.filter((l) => l.status === leadFilter);
  setLeadCount(counts.new);
  view.innerHTML = `
    <header class="head">
      <div><p class="eyebrow">מדף הנחיתה</p><h1><span class="cap">פניות</span> <span class="neon tilt">חדשות</span></h1></div>
    </header>
    <div class="tabs" role="tablist">
      ${[["new", "חדשות"], ["contacted", "בטיפול"], ["converted", "הפכו ללקוחות"], ["closed", "סגורות"], ["all", "הכול"]]
        .map(([k, label]) => `<button type="button" role="tab" data-f="${k}" class="${leadFilter === k ? "on" : ""}" aria-selected="${leadFilter === k}">${label}${k !== "all" && counts[k] ? `<span class="count">${counts[k]}</span>` : ""}</button>`)
        .join("")}
    </div>
    <div class="grid cols-2" id="leadList">
      ${list.length ? list.map(leadCard).join("") : `<div class="card empty" style="grid-column:1/-1"><span class="cap">אין כאן פניות</span>פניות חדשות מהאתר יקפצו כאן מיד, גם עם התראה.</div>`}
    </div>`;
  $$(".tabs button", view).forEach((b) => (b.onclick = () => ((leadFilter = b.dataset.f), leadsPage(view))));
  $("#leadList").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const lead = data.leads.find((l) => l.id === Number(b.closest("[data-lead]").dataset.lead));
    if (b.dataset.act === "chat") chatModal(lead.phone, lead.name);
    if (b.dataset.act === "convert") clientForm({ lead });
    if (b.dataset.act === "open") location.hash = `#/clients/${lead.client_id}`;
    if (b.dataset.act === "call") api(`/api/admin/leads/${lead.id}`, { method: "PATCH", body: { status: "contacted", seen: true } }).then(() => leadsPage(view, true));
    if (b.dataset.act === "status") {
      await api(`/api/admin/leads/${lead.id}`, { method: "PATCH", body: { status: b.dataset.to, seen: true } }).catch((err) => alert(err.message));
      leadsPage(view, true);
    }
  });
}

function leadCard(l) {
  return `
    <article class="card lead-card ${l.status === "new" ? "new" : ""}" data-lead="${l.id}">
      <div class="lead-top">
        <div><div class="lead-name">${esc(l.name)}</div><div class="muted small"><span class="phone">${esc(l.phoneDisplay)}</span> · ${esc(ago(l.created_at))}</div></div>
        <span class="pill ${l.status}"><i></i>${STATUS[l.status]}</span>
      </div>
      ${l.type ? `<div><span class="pill">${esc(l.type)}</span></div>` : ""}
      ${l.message ? `<div class="lead-msg">${esc(l.message)}</div>` : ""}
      <div class="row">
        <a class="btn btn-primary btn-sm" href="tel:+${esc(l.phone)}" data-act="call">${icon("phone")} שיחה</a>
        <button class="btn btn-ghost btn-sm" type="button" data-act="chat">${icon("chat")} וואטסאפ${l.unread ? ` <span class="count">${l.unread}</span>` : ""}</button>
        ${l.client_id ? `<button class="btn btn-ghost btn-sm" type="button" data-act="open">${icon("folder")} לתיקיית הלקוח</button>` : `<button class="btn btn-ghost btn-sm" type="button" data-act="convert">${icon("plus")} מילוי פרטים</button>`}
        ${l.status === "closed" ? `<button class="link-btn small" type="button" data-act="status" data-to="new">החזרה לחדשות</button>` : l.status !== "converted" ? `<button class="link-btn small" type="button" data-act="status" data-to="closed">סגירת הפנייה</button>` : ""}
      </div>
    </article>`;
}

/* ======================= client form (new client / from a lead) ======================= */

async function clientForm({ lead = null } = {}) {
  const v = lead
    ? { name: lead.name, phone: lead.phoneDisplay, service: lead.type, notes: lead.message ? `מהפנייה באתר: ${lead.message}` : "" }
    : {};
  const body = openModal(`
    <div class="row spread"><h2>${lead ? "פרטי הלקוח" : "לקוח חדש"}</h2><button class="btn btn-ghost btn-sm" type="button" data-close>סגירה</button></div>
    <p class="muted" style="margin:0">${lead ? "אחרי השיחה, משלימים פרטים והלקוח נכנס למערכת עם תיקייה משלו." : "הלקוח ייכנס למערכת עם תיקייה משלו בדרייב."}</p>
    <form class="form" id="clientForm" novalidate>
      <div class="form-grid">
        <div class="field"><label for="c-name">שם מלא</label><input class="input" id="c-name" name="name" value="${esc(v.name)}" required autocomplete="off"></div>
        <div class="field"><label for="c-phone">טלפון (וואטסאפ)</label><input class="input" id="c-phone" name="phone" value="${esc(v.phone)}" dir="ltr" style="text-align:right" inputmode="tel" required></div>
        <div class="field"><label for="c-business">שם העסק <small>(לא חובה)</small></label><input class="input" id="c-business" name="business" autocomplete="off"></div>
        <div class="field"><label for="c-email">אימייל <small>(לא חובה)</small></label><input class="input" id="c-email" name="email" type="email" dir="ltr" style="text-align:right"></div>
        <div class="field"><label for="c-service">מה בונים</label><input class="input" id="c-service" name="service" value="${esc(v.service)}" placeholder="למשל: 4 רילסים בחודש"></div>
        <div class="field"><label for="c-price">מחיר מוסכם <small>(לא חובה)</small></label><input class="input" id="c-price" name="price" placeholder="₪"></div>
      </div>
      <div class="field"><label for="c-notes">הערות לעצמי</label><textarea class="input" id="c-notes" name="notes" rows="3">${esc(v.notes)}</textarea></div>
      <div class="field"><label for="c-folder">תיקייה בדרייב</label>
        <select class="input" id="c-folder" name="folder">${me.drive.connected ? '<option value="new">תיקייה חדשה בשם הלקוח</option>' : '<option value="none">הדרייב לא מחובר. אפשר לחבר אחר כך</option>'}</select>
      </div>
      <p class="err-box" id="cfErr"></p>
      <button class="btn btn-primary" type="submit">${lead ? "הכנסה למערכת" : "יצירת לקוח"}</button>
    </form>`);
  if (me.drive.connected) {
    api("/api/admin/drive/folders")
      .then(({ folders }) => {
        const free = folders.filter((f) => !f.linked);
        if (free.length) $("#c-folder").insertAdjacentHTML("beforeend", `<optgroup label="תיקייה קיימת">${free.map((f) => `<option value="id:${esc(f.id)}">${esc(f.name)}</option>`).join("")}</optgroup>`);
        $("#c-folder").insertAdjacentHTML("beforeend", '<option value="none">בלי תיקייה כרגע</option>');
      })
      .catch(() => {});
  }
  $("#c-name").focus();
  $("#clientForm", body).addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    const data = Object.fromEntries(new FormData(f));
    const folder = data.folder.startsWith("id:") ? { mode: "existing", id: data.folder.slice(3) } : { mode: data.folder };
    delete data.folder;
    const btn = $("button[type=submit]", f);
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';
    try {
      const { client } = await api(lead ? `/api/admin/leads/${lead.id}/convert` : "/api/admin/clients", { method: "POST", body: { ...data, folder } });
      modal.close();
      refreshCounts().catch(() => {});
      location.hash = `#/clients/${client.id}`;
    } catch (err) {
      $("#cfErr").textContent = err.message;
      btn.disabled = false;
      btn.textContent = lead ? "הכנסה למערכת" : "יצירת לקוח";
    }
  });
}

/* ======================= clients ======================= */

let clientQuery = "";
async function clientsPage(view, quiet = false) {
  let data;
  try {
    data = await api("/api/admin/clients");
  } catch (e) {
    if (!quiet) view.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
    return;
  }
  if (location.hash !== "#/clients") return;
  view.innerHTML = `
    <header class="head">
      <div><p class="eyebrow">תיקייה לכל לקוח</p><h1><span class="cap">הלקוחות</span> <span class="neon tilt">שלי</span></h1></div>
      <div class="head-actions">
        <input class="input sm search" type="search" id="clientSearch" placeholder="חיפוש לפי שם, עסק או טלפון" value="${esc(clientQuery)}" aria-label="חיפוש">
        <button class="btn btn-primary" type="button" id="newClient">${icon("plus")} לקוח חדש</button>
      </div>
    </header>
    <div class="clients" id="clientList"></div>`;
  const draw = () => {
    const q = clientQuery.trim().toLowerCase();
    const list = data.clients.filter((c) => !q || [c.name, c.business, c.phone, c.phoneDisplay].join(" ").toLowerCase().includes(q.replace(/\D/g, "") || q));
    $("#clientList").innerHTML = list.length
      ? list.map(clientCard).join("")
      : `<div class="card empty" style="grid-column:1/-1"><span class="cap">${data.clients.length ? "לא נמצא" : "עוד אין לקוחות"}</span>${data.clients.length ? "נסו חיפוש אחר." : "לוחצים על \"מילוי פרטים\" בפנייה, או על \"לקוח חדש\"."}</div>`;
  };
  draw();
  $("#clientSearch").oninput = (e) => ((clientQuery = e.target.value), draw());
  $("#newClient").onclick = () => clientForm();
}

function clientCard(c) {
  return `
    <a class="card folder" href="#/clients/${c.id}">
      <div class="row spread"><span class="name">${esc(c.name)}</span>${c.unread ? `<span class="count">${c.unread}</span>` : ""}</div>
      <div class="muted small">${c.business ? esc(c.business) + " · " : ""}<span class="phone">${esc(c.phoneDisplay)}</span></div>
      <div class="row small">
        ${c.service ? `<span class="pill">${esc(c.service)}</span>` : ""}
        ${c.openTasks ? `<span class="pill">${c.openTasks} משימות פתוחות</span>` : ""}
        ${c.drive_folder_id ? "" : '<span class="pill closed">בלי תיקייה</span>'}
      </div>
    </a>`;
}

/* ======================= client page ======================= */

async function clientPage(view, id) {
  let data;
  try {
    data = await api(`/api/admin/clients/${id}`);
  } catch (e) {
    view.innerHTML = `<div class="empty"><span class="cap">הלקוח לא נמצא</span><a class="link-btn" href="#/clients">חזרה ללקוחות</a></div>`;
    return;
  }
  let c = data.client;
  view.innerHTML = `
    <header class="head">
      <div>
        <a class="link-btn small" href="#/clients">${icon("back")} כל הלקוחות</a>
        <h1 style="margin-top:10px"><span class="neon">${esc(c.name)}</span></h1>
        <div class="muted" style="margin-top:8px">${c.business ? esc(c.business) + " · " : ""}<span class="phone">${esc(c.phoneDisplay)}</span>${c.service ? " · " + esc(c.service) : ""}</div>
      </div>
      <div class="head-actions">
        <a class="btn btn-ghost btn-sm" href="tel:+${esc(c.phone)}">${icon("phone")} שיחה</a>
        <button class="btn btn-wa btn-sm" type="button" id="sendLink">${icon("link")} שליחת קישור לאזור האישי</button>
        ${c.folderUrl ? `<a class="btn btn-ghost btn-sm" href="${esc(c.folderUrl)}" target="_blank" rel="noopener">${icon("drive")} פתיחה בדרייב</a>` : ""}
      </div>
    </header>
    <div class="client-grid">
      <div class="grid">
        <section class="card rim" id="videosCard"></section>
        <section class="card">
          <div class="row spread"><h3>משימות</h3><span class="muted small" id="taskCount"></span></div>
          <ul class="tasks" id="tasks"></ul>
          <form class="add-task" id="addTask">
            <input class="input sm" name="text" placeholder="משימה חדשה, למשל: לשלוח טיוטה ראשונה" aria-label="משימה חדשה" autocomplete="off">
            <input class="input sm" name="due_date" type="date" aria-label="תאריך יעד">
            <button class="btn btn-primary btn-sm" type="submit" aria-label="הוספה">${icon("plus")}</button>
          </form>
        </section>
        <section class="card">
          <div class="row spread"><h3>פתקים לעצמי</h3><span class="saved" id="notesSaved"></span></div>
          <p class="hint" style="margin:6px 0 10px">רק אתה רואה את זה. נשמר אוטומטית.</p>
          <textarea class="input notes" id="notes" placeholder="רעיונות, העדפות של הלקוח, סיסמאות לחשבונות, מה סוכם בשיחה...">${esc(c.notes)}</textarea>
        </section>
      </div>
      <div class="grid">
        <div id="chatHost"></div>
        <section class="card" id="portalCard"></section>
        <section class="card" id="detailsCard"></section>
      </div>
    </div>`;

  mountChat($("#chatHost"), c.phone, c.name);
  renderVideos($("#videosCard"), c);
  renderTasks(data.tasks, c);
  renderPortal(c, data.devices);
  renderDetails(c, (updated) => (c = updated));

  // Notes autosave
  let timer;
  $("#notes").addEventListener("input", (e) => {
    clearTimeout(timer);
    $("#notesSaved").textContent = "שומר...";
    timer = setTimeout(async () => {
      try {
        await api(`/api/admin/clients/${c.id}`, { method: "PATCH", body: { notes: e.target.value } });
        $("#notesSaved").textContent = "נשמר ✓";
      } catch (err) {
        $("#notesSaved").textContent = err.message;
      }
    }, 700);
  });

  $("#sendLink").onclick = async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    try {
      const { message } = await api(`/api/admin/clients/${c.id}/send-link`, { method: "POST" });
      openChats.get(c.phone)?.upsert(message);
      b.innerHTML = `${icon("link")} ${message.status === "sent" ? "הקישור נשלח ✓" : "יישלח כשהוואטסאפ יתחבר"}`;
    } catch (err) {
      alert(err.message);
    } finally {
      setTimeout(() => {
        b.disabled = false;
        b.innerHTML = `${icon("link")} שליחת קישור לאזור האישי`;
      }, 3000);
    }
  };
}

async function renderVideos(card, c) {
  card.innerHTML = `<div class="row spread"><h3>סרטונים</h3><span class="muted small" id="vidCount"></span></div><div id="vidBody"><div class="loading"><span class="spinner"></span></div></div>`;
  const bodyEl = $("#vidBody", card);
  if (!me.drive.connected) {
    bodyEl.innerHTML = `<div class="empty">הדרייב לא מחובר. <a class="link-btn" href="/auth/google">חיבור Google Drive</a></div>`;
    return;
  }
  if (!c.drive_folder_id) {
    bodyEl.innerHTML = `<div class="empty"><p>ללקוח אין עדיין תיקייה בדרייב.</p><button class="btn btn-primary btn-sm" type="button" id="mkFolder">${icon("plus")} יצירת תיקייה</button></div>`;
    $("#mkFolder").onclick = async () => {
      try {
        const { client } = await api(`/api/admin/clients/${c.id}/folder`, { method: "POST", body: {} });
        Object.assign(c, client);
        renderVideos(card, c);
      } catch (err) {
        alert(err.message);
      }
    };
    return;
  }
  bodyEl.innerHTML = `
    <label class="drop" id="drop"><input type="file" accept="video/*" multiple hidden>${icon("upload", "ico")}<b>גוררים לכאן סרטונים</b><span class="muted small">או לוחצים לבחירה. הם עולים לתיקייה של הלקוח בדרייב ומופיעים לו באזור האישי.</span></label>
    <div class="uploads" id="uploads"></div>
    <div class="videos" id="videoGrid"></div>`;
  const load = async () => {
    try {
      const { videos } = await api(`/api/admin/clients/${c.id}/videos`);
      $("#vidCount", card).textContent = videos.length ? `${videos.length} סרטונים` : "";
      $("#videoGrid", card).innerHTML = videos.length
        ? videos.map((v, i) => `
          <div class="vid" role="button" tabindex="0" data-i="${i}" aria-label="ניגון ${esc(v.name)}"${v.note ? ` title="${esc(v.note)}"` : ""}>
            ${v.hasThumb ? `<img src="${esc(v.thumb)}" alt="" loading="lazy" onerror="this.remove()">` : `<video src="${esc(v.src)}#t=0.5" preload="metadata" muted playsinline></video>`}
            <span class="play"><span><svg viewBox="0 0 24 24"><path d="M7 4l13 8-13 8z"/></svg></span></span>
            <span class="vname">${v.note ? "📝 " : ""}${esc(v.name)}${v.size ? ` · ${fmtSize(v.size)}` : ""}</span>
            <button class="del" type="button" data-del="${esc(v.id)}" aria-label="מחיקת ${esc(v.name)}">${icon("trash")}</button>
          </div>`).join("")
        : "";
      $("#videoGrid", card).onclick = async (e) => {
        const del = e.target.closest("[data-del]");
        if (del) {
          e.stopPropagation();
          if (!confirm("למחוק את הסרטון? הוא יעבור לפח בדרייב.")) return;
          await api(`/api/admin/clients/${c.id}/videos/${del.dataset.del}`, { method: "DELETE" }).catch((err) => alert(err.message));
          return load();
        }
        const v = videos[e.target.closest("[data-i]")?.dataset.i];
        if (v) playVideo(v);
      };
      $("#videoGrid", card).onkeydown = (e) => {
        if ((e.key === "Enter" || e.key === " ") && e.target.dataset.i) {
          e.preventDefault();
          playVideo(videos[e.target.dataset.i]);
        }
      };
    } catch (err) {
      $("#videoGrid", card).innerHTML = `<div class="empty">${esc(err.message)}</div>`;
    }
  };
  load();

  const drop = $("#drop", card);
  const input = $("input", drop);
  const queue = async (files) => {
    const videos = files.filter((f) => f.type.startsWith("video/"));
    if (!videos.length) return;
    const choice = await uploadDialog(videos, c);
    if (!choice) return;
    const host = $("#uploads", card);
    let ok = 0;
    for (const f of videos) ok += (await uploadOne(f, c.id, host, choice.note)) ? 1 : 0;
    load();
    if (!ok || !choice.notify) return;
    const line = document.createElement("div");
    line.className = "up muted small";
    host.append(line);
    try {
      const { message } = await api(`/api/admin/clients/${c.id}/videos/notify`, { method: "POST", body: { count: ok, note: choice.note } });
      line.textContent = message.status === "sent" ? `נשלחה ל${firstName(c.name)} הודעה בוואטסאפ ✓` : message.status === "pending" ? "ההודעה ללקוח תישלח כשהוואטסאפ יתחבר" : "ההודעה ללקוח לא נשלחה. אפשר לשלוח שוב מהצ'אט.";
    } catch (err) {
      line.textContent = err.message;
    }
    setTimeout(() => line.remove(), 8000);
  };
  input.onchange = () => queue([...input.files]).then(() => (input.value = ""));
  drop.ondragover = (e) => (e.preventDefault(), drop.classList.add("over"));
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = (e) => {
    e.preventDefault();
    drop.classList.remove("over");
    queue([...e.dataTransfer.files]);
  };
}

const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || "";

// Before uploading: optional notes for the client and whether to tell them on WhatsApp.
function uploadDialog(files, c) {
  return new Promise((resolve) => {
    let result = null;
    const body = openModal(`
      <div class="row spread"><h2>העלאת סרטונים</h2><button class="btn btn-ghost btn-sm" type="button" data-close>ביטול</button></div>
      <ul class="up-files">${files.map((f) => `<li><span dir="ltr">${esc(f.name)}</span><span class="muted small">${fmtSize(f.size)}</span></li>`).join("")}</ul>
      <form class="form" id="upForm">
        <div class="field"><label for="up-note">הערות ל${esc(firstName(c.name))} <small>(לא חובה)</small></label>
          <textarea class="input" id="up-note" name="note" rows="4" maxlength="2000" placeholder="למשל: זו גרסה ראשונה, ספרו לי מה לשנות"></textarea>
          <span class="hint">ההערות יופיעו בהודעה בוואטסאפ ומתחת לסרטון באזור האישי.</span></div>
        <label class="row" style="cursor:pointer"><input type="checkbox" name="notify" checked style="width:20px;height:20px;accent-color:#a84dff"> <span>לשלוח ל${esc(firstName(c.name))} הודעה בוואטסאפ כשההעלאה מסתיימת</span></label>
        <div class="row"><button class="btn btn-primary" type="submit">${icon("upload")} העלאה${files.length > 1 ? ` (${files.length})` : ""}</button></div>
      </form>`);
    $("#upForm", body).onsubmit = (e) => {
      e.preventDefault();
      result = { note: e.target.note.value.trim(), notify: e.target.notify.checked };
      modal.close();
    };
    modal.addEventListener("close", () => resolve(result), { once: true });
    setTimeout(() => $("#up-note", body).focus(), 50);
  });
}

function uploadOne(file, clientId, host, note = "") {
  return new Promise((resolve) => {
    const row = document.createElement("div");
    row.className = "up";
    row.innerHTML = `<div class="row spread"><span>${esc(file.name)}</span><span class="muted small" data-s>0%</span></div><div class="bar"><i></i></div>`;
    host.append(row);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/admin/clients/${clientId}/videos`);
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const p = Math.round((e.loaded / e.total) * 100);
      $("i", row).style.width = p + "%";
      $("[data-s]", row).textContent = p < 100 ? `${p}%` : "מעלה לדרייב...";
    };
    xhr.onload = () => {
      let data = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status < 300) {
        row.remove();
      } else {
        $("[data-s]", row).textContent = data.error || "ההעלאה נכשלה";
        $("[data-s]", row).style.color = "#ff8db4";
      }
      resolve(xhr.status < 300);
    };
    xhr.onerror = () => {
      $("[data-s]", row).textContent = "ההעלאה נכשלה";
      resolve(false);
    };
    const fd = new FormData();
    fd.append("note", note); // before the file, so the server has it when the file arrives
    fd.append("video", file);
    xhr.send(fd);
  });
}

function renderTasks(tasks, c) {
  const list = $("#tasks");
  const today = new Date().toLocaleDateString("sv"); // local YYYY-MM-DD
  const draw = () => {
    const open = tasks.filter((t) => !t.done).length;
    $("#taskCount").textContent = tasks.length ? `${open} פתוחות מתוך ${tasks.length}` : "";
    list.innerHTML = tasks.length
      ? tasks.map((t) => `
        <li class="task ${t.done ? "done" : ""}" data-id="${t.id}">
          <input type="checkbox" ${t.done ? "checked" : ""} aria-label="סימון ${esc(t.text)}">
          <span>${esc(t.text)}</span>
          ${t.due_date ? `<span class="due ${!t.done && t.due_date < today ? "late" : ""}">${new Date(t.due_date + "T00:00").toLocaleDateString("he-IL", { day: "numeric", month: "short" })}</span>` : ""}
          <button class="x" type="button" aria-label="מחיקה">${icon("trash")}</button>
        </li>`).join("")
      : '<li class="muted small">אין משימות. מה הדבר הבא שצריך לעשות בשביל הלקוח?</li>';
  };
  draw();
  list.onchange = async (e) => {
    const id = Number(e.target.closest("[data-id]").dataset.id);
    const t = tasks.find((x) => x.id === id);
    t.done = e.target.checked ? 1 : 0;
    draw();
    await api(`/api/admin/tasks/${id}`, { method: "PATCH", body: { done: Boolean(t.done) } }).catch((err) => alert(err.message));
  };
  list.onclick = async (e) => {
    const x = e.target.closest(".x");
    if (!x) return;
    const id = Number(x.closest("[data-id]").dataset.id);
    tasks.splice(tasks.findIndex((t) => t.id === id), 1);
    draw();
    await api(`/api/admin/tasks/${id}`, { method: "DELETE" }).catch((err) => alert(err.message));
  };
  $("#addTask").onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const text = f.text.value.trim();
    if (!text) return f.text.focus();
    try {
      const { task } = await api(`/api/admin/clients/${c.id}/tasks`, { method: "POST", body: { text, due_date: f.due_date.value } });
      tasks.unshift(task);
      tasks.sort((a, b) => a.done - b.done);
      f.reset();
      draw();
      f.text.focus();
    } catch (err) {
      alert(err.message);
    }
  };
}

function renderPortal(c, devices) {
  const card = $("#portalCard");
  card.innerHTML = `
    <h3>האזור האישי של הלקוח</h3>
    <p class="hint" style="margin:8px 0 12px">בכניסה הראשונה הלקוח מקבל קוד בוואטסאפ, ומאז המכשיר זוכר אותו. שם הוא רואה את כל הסרטונים שבתיקייה שלו.</p>
    <div class="row" style="flex-wrap:nowrap">
      <input class="input sm" value="${esc(c.link)}" readonly dir="ltr" aria-label="קישור לאזור האישי" id="portalLink">
      <button class="btn btn-ghost btn-sm" type="button" id="copyLink">העתקה</button>
    </div>
    <div class="row spread small" style="margin-top:12px">
      <span class="muted">${devices ? `מחובר ב-${devices} ${devices === 1 ? "מכשיר" : "מכשירים"}` : "עוד לא התחבר"}</span>
      <span class="row">
        ${devices ? '<button class="link-btn" type="button" id="signout">ניתוק כל המכשירים</button>' : ""}
        <button class="link-btn" type="button" id="newLink">קישור חדש</button>
      </span>
    </div>`;
  $("#copyLink").onclick = async (e) => {
    await navigator.clipboard?.writeText(c.link).catch(() => $("#portalLink").select());
    e.target.textContent = "הועתק ✓";
    setTimeout(() => (e.target.textContent = "העתקה"), 1800);
  };
  if (devices) {
    $("#signout").onclick = async () => {
      if (!confirm("לנתק את הלקוח מכל המכשירים? בכניסה הבאה הוא יקבל קוד חדש.")) return;
      await api(`/api/admin/clients/${c.id}/signout-devices`, { method: "POST" }).catch((err) => alert(err.message));
      renderPortal(c, 0);
    };
  }
  $("#newLink").onclick = async () => {
    if (!confirm("ליצור קישור חדש? הקישור הקודם יפסיק לעבוד והלקוח ינותק מכל המכשירים.")) return;
    try {
      const { client } = await api(`/api/admin/clients/${c.id}/new-link`, { method: "POST" });
      Object.assign(c, client);
      renderPortal(c, 0);
    } catch (err) {
      alert(err.message);
    }
  };
}

function renderDetails(c, onSave) {
  const card = $("#detailsCard");
  const fields = [
    ["name", "שם מלא"], ["phone", "טלפון"], ["business", "שם העסק"], ["email", "אימייל"], ["service", "מה בונים"], ["price", "מחיר מוסכם"],
  ];
  card.innerHTML = `
    <div class="row spread"><h3>פרטים</h3><span class="saved" id="detSaved"></span></div>
    <form class="form-grid" id="detForm" style="margin-top:14px">
      ${fields.map(([k, label]) => `<div class="field"><label for="d-${k}">${label}</label><input class="input sm" id="d-${k}" name="${k}" value="${esc(k === "phone" ? c.phoneDisplay : c[k])}" ${k === "phone" || k === "email" ? 'dir="ltr" style="text-align:right"' : ""}></div>`).join("")}
    </form>
    <div class="row spread small" style="margin-top:16px">
      <span class="muted">נוסף ${esc(ago(c.created_at))}</span>
      <button class="link-btn" type="button" id="delClient" style="color:#ff8db4">מחיקת הלקוח</button>
    </div>`;
  const form = $("#detForm");
  form.addEventListener("change", async (e) => {
    const { name, value } = e.target;
    $("#detSaved").textContent = "שומר...";
    try {
      const { client } = await api(`/api/admin/clients/${c.id}`, { method: "PATCH", body: { [name]: value } });
      onSave(client);
      Object.assign(c, client);
      $("#detSaved").textContent = "נשמר ✓";
    } catch (err) {
      $("#detSaved").textContent = err.message;
    }
  });
  $("#delClient").onclick = async () => {
    if (!confirm(`למחוק את ${c.name} מהמערכת? התיקייה והסרטונים בדרייב נשארים.`)) return;
    await api(`/api/admin/clients/${c.id}`, { method: "DELETE" }).catch((err) => alert(err.message));
    location.hash = "#/clients";
  };
}

/* ======================= settings ======================= */

async function settingsPage(view) {
  view.innerHTML = `
    <header class="head"><div><p class="eyebrow">חיבורים והודעות</p><h1><span class="cap">הגדרות</span></h1></div></header>
    <div class="grid cols-2">
      <section class="card rim" id="waCard"></section>
      <section class="card" id="driveCard"></section>
    </div>
    <section class="card" style="margin-top:16px" id="notifyCard"><div class="loading"><span class="spinner"></span></div></section>
    <section class="card" style="margin-top:16px" id="tplCard"><div class="loading"><span class="spinner"></span></div></section>`;
  renderWaCard();
  const d = me.drive;
  $("#driveCard").innerHTML = `
    <div class="row spread"><h3>Google Drive</h3><span class="row small"><span class="status-dot ${d.connected ? "ok" : "bad"}"></span>${d.connected ? "מחובר" : "לא מחובר"}</span></div>
    <p class="muted" style="margin:10px 0 14px">${d.connected ? `התיקיות והסרטונים נשמרים בתיקיית Spark בדרייב של <b dir="ltr">${esc(d.email)}</b>.` : "מתחברים עם Google כדי שכל לקוח יקבל תיקייה בדרייב."}</p>
    <div class="row">${d.connected ? `<a class="btn btn-ghost btn-sm" href="${esc(d.folderUrl)}" target="_blank" rel="noopener">${icon("drive")} פתיחת התיקייה</a>` : `<a class="btn btn-primary btn-sm" href="/auth/google">חיבור Google Drive</a>`}</div>`;

  let settings;
  try {
    settings = await api("/api/admin/settings");
  } catch (err) {
    $("#notifyCard").innerHTML = $("#tplCard").innerHTML = `<p class="err-box">${esc(err.message)}</p>`;
    return;
  }
  const { templates } = settings;
  renderNotifyCard(settings);
  $("#tplCard").innerHTML = `
    <h3>הודעות אוטומטיות בוואטסאפ</h3>
    <form class="form" id="tplForm" style="margin-top:14px">
      <div class="field"><label for="t-auto">אחרי שמשאירים פרטים באתר</label><textarea class="input" id="t-auto" name="auto_reply" rows="3">${esc(templates.auto_reply)}</textarea><span class="hint"><code>{name}</code> מוחלף בשם הפרטי.</span></div>
      <div class="field"><label for="t-link">קישור לאזור האישי</label><textarea class="input" id="t-link" name="link_message" rows="4">${esc(templates.link_message)}</textarea><span class="hint"><code>{link}</code> מוחלף בקישור (חובה).</span></div>
      <div class="field"><label for="t-video">סרטון חדש עלה</label><textarea class="input" id="t-video" name="video_message" rows="4">${esc(templates.video_message)}</textarea><span class="hint"><code>{videos}</code> מוחלף ב"עלה סרטון חדש" (או כמה), <code>{notes}</code> בהערות אם כתבת, <code>{link}</code> בקישור.</span></div>
      <div class="field"><label for="t-otp">קוד כניסה</label><textarea class="input" id="t-otp" name="otp_message" rows="2">${esc(templates.otp_message)}</textarea><span class="hint"><code>{code}</code> מוחלף בקוד (חובה).</span></div>
      <p class="err-box" id="tplErr"></p>
      <div class="row"><button class="btn btn-primary" type="submit">שמירה</button><span class="saved" id="tplSaved"></span></div>
    </form>`;
  $("#tplForm").onsubmit = async (e) => {
    e.preventDefault();
    $("#tplErr").textContent = "";
    try {
      await api("/api/admin/settings", { method: "PUT", body: { templates: Object.fromEntries(new FormData(e.target)) } });
      $("#tplSaved").textContent = "נשמר ✓";
    } catch (err) {
      $("#tplErr").textContent = err.message;
    }
  };
}

function renderNotifyCard(st) {
  const linked = st.linkedPhone || "המספר המחובר";
  $("#notifyCard").innerHTML = `
    <h3>התראות ומספר הסטודיו</h3>
    <form class="form" id="notifyForm" style="margin-top:14px">
      <label class="row" style="cursor:pointer"><input type="checkbox" name="notifyLeads" ${st.notifyLeads ? "checked" : ""} style="width:20px;height:20px;accent-color:#a84dff"> <span>לשלוח לי הודעת וואטסאפ על כל פנייה חדשה</span></label>
      <div class="form-grid">
        <div class="field"><label for="n-phone">לאיזה מספר לשלוח את ההתראה</label><input class="input sm" id="n-phone" name="notifyPhone" value="${esc(st.notifyPhone ? fmtPhone(st.notifyPhone) : "")}" placeholder="ברירת מחדל: ${esc(linked)}" dir="ltr" style="text-align:right" inputmode="tel"></div>
        <div class="field"><label for="n-public">מספר הוואטסאפ שמופיע באתר</label><input class="input sm" id="n-public" name="publicWhatsapp" value="${esc(st.publicWhatsapp ? fmtPhone(st.publicWhatsapp) : "")}" placeholder="ברירת מחדל: ${esc(linked)}" dir="ltr" style="text-align:right" inputmode="tel"></div>
      </div>
      <p class="hint" style="margin:0">ההודעה לעצמך מגיעה לצ'אט "הודעה לעצמי" בוואטסאפ. כפתור הוואטסאפ באתר ובאזור האישי פותח שיחה עם המספר שמופיע באתר.</p>
      <p class="err-box" id="nErr"></p>
      <div class="row"><button class="btn btn-primary" type="submit">שמירה</button><span class="saved" id="nSaved"></span></div>
    </form>
    <div class="push-row" id="pushRow"></div>`;
  renderPushRow();
  $("#notifyForm").onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    $("#nErr").textContent = "";
    try {
      await api("/api/admin/settings", { method: "PUT", body: { notifyLeads: f.notifyLeads.checked, notifyPhone: f.notifyPhone.value, publicWhatsapp: f.publicWhatsapp.value } });
      $("#nSaved").textContent = "נשמר ✓";
    } catch (err) {
      $("#nErr").textContent = err.message;
    }
  };
}

// Push on this device: on/off and a test, or what's needed first (iPhone home screen, permission).
function renderPushRow() {
  const row = $("#pushRow");
  if (!row) return;
  const ios = isIos();
  let text, buttons = "";
  if (ios && !isStandalone()) {
    text = 'באייפון: פותחים את הניהול בספארי, לוחצים "שיתוף" ← "הוספה למסך הבית", ונכנסים מהאייקון. שם יופיע כפתור להפעלת התראות.';
  } else if (!pushSupported()) {
    text = "הדפדפן הזה לא תומך בהתראות. ב-Chrome, Edge או Safari זה עובד.";
  } else if (Notification.permission === "denied") {
    text = "ההתראות חסומות במכשיר הזה. אפשר לאשר אותן בהגדרות האתר בדפדפן, ואז לרענן.";
  } else if (pushOn) {
    text = "התראות פעילות במכשיר הזה ✓ פנייה או הודעה חדשה יקפצו גם כשהניהול סגור.";
    buttons = `<button class="btn btn-ghost btn-sm" type="button" data-push="test">שליחת התראת בדיקה</button><button class="btn btn-ghost btn-sm" type="button" data-push="off">כיבוי</button>`;
  } else {
    text = "התראה על המסך על כל פנייה או הודעה חדשה, גם כשהניהול סגור. מפעילים בכל מכשיר בנפרד (מחשב, טלפון).";
    buttons = `<button class="btn btn-primary btn-sm" type="button" data-push="on">הפעלת התראות במכשיר הזה</button>`;
  }
  row.innerHTML = `<div><b>התראות במכשיר</b><p class="muted small" style="margin:4px 0 0">${text}</p><p class="err-box" id="pushErr" style="margin:6px 0 0"></p></div><div class="row">${buttons}</div>`;
  row.onclick = async (e) => {
    const b = e.target.closest("[data-push]");
    if (!b) return;
    b.disabled = true;
    $("#pushErr").textContent = "";
    try {
      if (b.dataset.push === "on") await enablePush();
      if (b.dataset.push === "off") await disablePush();
      if (b.dataset.push === "test") {
        await api("/api/admin/push/test", { method: "POST" });
        b.textContent = "נשלחה ✓ (מופיעה כשהלשונית לא מולך)";
        return;
      }
      renderPushRow();
    } catch (err) {
      $("#pushErr").textContent = err.message;
      b.disabled = false;
    }
  };
}

function renderWaCard() {
  const card = $("#waCard");
  if (!card) return;
  const s = waState;
  const good = s.status === "connected";
  let body = "";
  if (good) body = `<p class="muted">מחובר למספר <b class="phone">${esc(s.me || "")}</b>. פניות מהאתר מקבלות אישור אוטומטי, ולקוחות מקבלים מכאן קודי כניסה.</p>`;
  else if (s.status === "qr" && s.qr) body = `<p class="muted">בטלפון של הסטודיו: וואטסאפ ← הגדרות ← מכשירים מקושרים ← קישור מכשיר, וסורקים:</p><div class="qr" id="qrBox"></div>`;
  else if (s.status === "starting") body = `<p class="muted row"><span class="spinner"></span> פותח את וואטסאפ ווב. זה יכול לקחת עד דקה.</p>`;
  else if (s.status === "linking") body = `<p class="muted row"><span class="spinner"></span> הקוד נסרק. מסיים להתחבר, זה לוקח עד דקה. אין צורך לסרוק שוב או להפעיל מחדש.</p>`;
  else if (s.status === "disabled") body = `<p class="muted">וואטסאפ כבוי בהגדרות השרת (<code>WA_DISABLED=1</code> בקובץ <code>.env</code>).</p>`;
  else body = `<p class="muted">${s.status === "logged_out" ? "הטלפון התנתק מהמערכת. בעוד כמה שניות יופיע כאן QR חדש לסריקה." : s.error ? esc(s.error) : "וואטסאפ לא פועל."}${s.status === "logged_out" ? "" : " לוחצים על הפעלה מחדש כדי לקבל QR חדש."}</p>`;
  card.innerHTML = `
    <div class="row spread"><h3>וואטסאפ</h3><span class="row small"><span class="status-dot ${good ? "ok" : ["starting", "linking"].includes(s.status) ? "warn" : "bad"}"></span>${esc(WA_LABEL[s.status] || s.status)}</span></div>
    <div class="grid" style="margin-top:12px">${body}</div>
    ${["error", "off", "logged_out"].includes(s.status) ? `<div class="row" style="margin-top:14px"><button class="btn btn-ghost btn-sm" type="button" id="waRestart">הפעלה מחדש</button></div>` : ""}`;
  if (s.status === "qr" && s.qr) drawQr($("#qrBox"), s.qr);
  $("#waRestart")?.addEventListener("click", async (e) => {
    e.target.disabled = true;
    await api("/api/admin/wa/restart", { method: "POST" }).catch((err) => {
      alert(err.message);
      e.target.disabled = false;
    });
  });
}

function drawQr(box, data) {
  if (data.startsWith("data:image")) {
    box.innerHTML = `<img src="${esc(data)}" alt="QR לחיבור וואטסאפ">`;
    return;
  }
  const make = () => {
    const q = window.qrcode(0, "L");
    q.addData(data);
    q.make();
    box.innerHTML = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  };
  if (window.qrcode) make();
  else window.addEventListener("load", make, { once: true });
}

boot();

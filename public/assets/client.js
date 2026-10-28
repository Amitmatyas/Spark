/* SPARK client area: sign in once with a WhatsApp code, then this device stays signed in. */
"use strict";

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const slug = location.pathname.split("/").filter(Boolean)[1] || "";
const KEY = `spark.portal.${slug}`;
const app = $("#app");

const store = {
  get() {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  },
  set(v) {
    try {
      localStorage.setItem(KEY, v);
    } catch {}
  },
  clear() {
    try {
      localStorage.removeItem(KEY);
    } catch {}
  },
};

async function api(path, { method = "GET", body, auth = false } = {}) {
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  if (auth) headers.Authorization = `Bearer ${store.get()}`;
  let res;
  try {
    res = await fetch(`/api/portal/${encodeURIComponent(slug)}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw Object.assign(new Error("אין חיבור לאינטרנט. נסו שוב."), { status: 0 });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw Object.assign(new Error(data.error || "משהו השתבש. נסו שוב."), { status: res.status });
  return data;
}

const shell = (inner) => `
  <div class="portal">
    <nav class="portal-nav"><span class="brand"><img src="/assets/spark-mark.png" alt=""><span>SPARK</span></span><span id="navEnd"></span></nav>
    ${inner}
  </div>`;

/* ---------- start ---------- */

async function start() {
  if (!slug) return fatal("הקישור לא שלם. פתחו את הקישור המלא שקיבלתם מאיתנו בוואטסאפ.");
  if (store.get()) {
    try {
      return showVideos(await api("/me", { auth: true }));
    } catch (e) {
      if (e.status !== 401) return fatal(e.message);
      store.clear();
    }
  }
  let info;
  try {
    info = await api("");
  } catch (e) {
    return fatal(e.message);
  }
  showGate(info);
}

function fatal(msg) {
  app.innerHTML = `<main class="gate"><div class="panel gate-card"><img class="gate-logo" src="/assets/spark-logo-3d.png" alt=""><h1><span class="cap">אופס</span></h1><p class="muted">${esc(msg)}</p><button class="btn btn-ghost" type="button" onclick="location.reload()">לנסות שוב</button></div></main>`;
}

/* ---------- sign in with a WhatsApp code ---------- */

function showGate(info) {
  app.innerHTML = `
    <main class="gate">
      <div class="panel gate-card" id="gate">
        <img class="gate-logo" src="/assets/spark-logo-3d.png" alt="">
        <h1><span class="cap">היי ${esc(info.firstName)},</span><span class="neon tilt">הסרטונים שלך</span></h1>
        <div id="step"></div>
      </div>
    </main>`;
  stepPhone(info);
}

function stepPhone(info) {
  $("#step").innerHTML = `
    <div class="grid" style="justify-items:center">
      <p class="muted" style="margin:0">כדי לוודא שזה את/ה, נשלח קוד בוואטסאפ למספר</p>
      <span class="phone-hint">${esc(info.phoneHint)}</span>
      <button class="btn btn-primary" type="button" id="sendCode">שלחו לי קוד בוואטסאפ</button>
      <p class="err-box" id="err" role="alert"></p>
    </div>`;
  $("#sendCode").onclick = () => requestCode(info, $("#sendCode"));
}

async function requestCode(info, btn) {
  $("#err").textContent = "";
  btn.disabled = true;
  const label = btn.textContent;
  btn.innerHTML = '<span class="spinner"></span>';
  try {
    await api("/code", { method: "POST" });
    stepCode(info);
  } catch (e) {
    $("#err").textContent = e.message;
    btn.disabled = false;
    btn.textContent = label;
  }
}

function stepCode(info) {
  $("#step").innerHTML = `
    <form class="grid" id="codeForm" style="justify-items:center;width:100%" novalidate>
      <label class="muted" for="code" style="margin:0">שלחנו קוד בן 6 ספרות בוואטסאפ ל-<span class="phone-hint" style="font-size:17px">${esc(info.phoneHint)}</span></label>
      <input class="input code-input" id="code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]*" placeholder="••••••" required>
      <button class="btn btn-primary" type="submit">כניסה</button>
      <p class="err-box" id="err" role="alert"></p>
      <button class="link-btn resend" type="button" id="resend" disabled>שליחת קוד חדש (<span id="sec">45</span>)</button>
    </form>`;
  const input = $("#code");
  input.focus();
  let left = 45;
  const timer = setInterval(() => {
    left--;
    if ($("#sec")) $("#sec").textContent = left;
    if (left <= 0) {
      clearInterval(timer);
      const r = $("#resend");
      if (r) {
        r.disabled = false;
        r.textContent = "לא הגיע? שליחת קוד חדש";
      }
    }
  }, 1000);
  $("#resend").onclick = () => {
    clearInterval(timer);
    requestCode(info, $("#resend"));
  };
  input.addEventListener("input", () => {
    input.value = input.value.replace(/\D/g, "").slice(0, 6);
    if (input.value.length === 6) $("#codeForm").requestSubmit();
  });
  $("#codeForm").onsubmit = async (e) => {
    e.preventDefault();
    const btn = $("button[type=submit]", e.target);
    if (input.value.length !== 6) return ($("#err").textContent = "הקוד צריך להיות 6 ספרות.");
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';
    try {
      const { token } = await api("/verify", { method: "POST", body: { code: input.value } });
      store.set(token);
      clearInterval(timer);
      showVideos(await api("/me", { auth: true }));
    } catch (err) {
      $("#err").textContent = err.message;
      input.select();
      btn.disabled = false;
      btn.textContent = "כניסה";
    }
  };
}

/* ---------- videos ---------- */

function showVideos({ client, videos }) {
  app.innerHTML = shell(`
    <header class="portal-hero">
      <p class="eyebrow">${client.business ? esc(client.business) : "האזור האישי"}</p>
      <h1><span class="cap">היי ${esc(client.firstName)},</span> <span class="neon tilt">הסרטונים שלך</span></h1>
    </header>
    ${videos.length
      ? `<div class="videos" id="grid">${videos.map((v, i) => `
          <div>
            <button class="vid" type="button" data-i="${i}" aria-label="ניגון ${esc(v.name)}">
              ${v.hasThumb ? `<img src="${esc(v.thumb)}" alt="" loading="lazy" onerror="this.remove()">` : `<video src="${esc(v.src)}#t=0.5" preload="metadata" muted playsinline></video>`}
              <span class="play"><span><svg viewBox="0 0 24 24"><path d="M7 4l13 8-13 8z"/></svg></span></span>
            </button>
            <div class="vid-meta"><b>${esc(v.name)}</b><span>${fmtDate(v.createdTime)}</span></div>
            ${v.note ? `<p class="vid-note">${esc(v.note)}</p>` : ""}
          </div>`).join("")}</div>`
      : `<div class="card empty"><span class="cap">עוד אין כאן סרטונים</span>ברגע שנעלה סרטון, הוא יופיע כאן.</div>`}
    <div class="card contact-us" id="contactUs" hidden>
      <div><h3>יש שאלה או בקשה לשינוי?</h3><p class="muted" style="margin:6px 0 0">כתבו לנו ונחזור אליכם.</p></div>
      <a class="btn btn-wa" target="_blank" rel="noopener" href="#">כתבו לנו בוואטסאפ</a>
    </div>
  `);
  fetch("/api/public/info").then((r) => (r.ok ? r.json() : null)).then((info) => {
    if (!info?.whatsapp || !$("#contactUs")) return;
    $("#contactUs a").href = `https://wa.me/${info.whatsapp}?text=${encodeURIComponent(`היי, זה ${client.firstName}. לגבי הסרטונים שלי:`)}`;
    $("#contactUs").hidden = false;
  }).catch(() => {});
  $("#navEnd").innerHTML = `<button class="btn btn-ghost btn-sm" type="button" id="logout">התנתקות</button>`;
  $("#logout").onclick = async () => {
    if (!confirm("להתנתק מהמכשיר הזה? בכניסה הבאה נשלח קוד חדש בוואטסאפ.")) return;
    await api("/logout", { method: "POST", auth: true }).catch(() => {});
    store.clear();
    start();
  };
  $("#grid")?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-i]");
    if (b) play(videos[b.dataset.i]);
  });
}

const fmtDate = (s) => (s ? new Date(s).toLocaleDateString("he-IL", { day: "numeric", month: "short" }) : "");

const player = $("#player");
function play(v) {
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
  const v = $("#playerVideo");
  v.pause();
  v.removeAttribute("src");
  v.load();
});

start();

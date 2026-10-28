// SPARK studio system: landing page + lead form, admin (Google sign-in, leads, client folders,
// Drive videos, notes, tasks, WhatsApp chat) and a client area with WhatsApp code sign-in.
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
try {
  process.loadEnvFile(path.join(__dirname, ".env"));
} catch {}

const express = require("express");
const cookieParser = require("cookie-parser");
const multer = require("multer");
const { get, all, run, setting, setSetting, hash, sign, DATA_DIR } = require("./lib/db");
const { normalizePhone, displayPhone } = require("./lib/phone");
const events = require("./lib/events");
const wa = require("./lib/wa");
const drive = require("./lib/drive");
const push = require("./lib/push");

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
const SECURE_COOKIES = PUBLIC_URL.startsWith("https://");
const PUBLIC_DIR = path.join(__dirname, "public");
drive.configure(PUBLIC_URL);
push.configure(PUBLIC_URL);

const DEFAULT_TEMPLATES = {
  auto_reply: "היי {name}, כאן SPARK ✨\nקיבלנו את הפרטים שלך ונחזור אליך בקרוב לשיחה קצרה על הפרויקט.",
  link_message: "היי {name}, זה הקישור לאזור האישי שלך ב-SPARK. שם יופיעו כל הסרטונים שלך:\n{link}\n\nבכניסה הראשונה נשלח לך קוד בוואטסאפ, ומאז המכשיר יזכור אותך.",
  otp_message: "קוד הכניסה שלך ל-SPARK: {code}\nהקוד בתוקף ל-10 דקות. אל תעבירו אותו לאף אחד.",
  video_message: "היי {name} 🎬\n{videos} לאזור האישי שלך ב-SPARK.{notes}\n\nלצפייה: {link}",
};
// Where the studio is reached on WhatsApp (landing button, client area) and where new-lead
// alerts go. Both default to the number linked to WhatsApp.
const studioPhone = () => normalizePhone(setting("public_whatsapp", "")) || wa.state.me || null;
const notifyPhone = () => normalizePhone(setting("notify_phone", "")) || wa.state.me || null;
const template = (key) => setting(`tpl_${key}`, DEFAULT_TEMPLATES[key]);
const fill = (text, vars) => text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || "";
const token = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");
const slugId = () => {
  const abc = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(crypto.randomBytes(12), (b) => abc[b % abc.length]).join("");
};
const portalLink = (client) => `${PUBLIC_URL}/c/${client.slug}`;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Tiny fixed-window rate limiter kept in memory.
const buckets = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now - b.start > windowMs) {
    buckets.set(key, { start: now, count: 1 });
    return false;
  }
  b.count++;
  return b.count > max;
}

// ---------- WhatsApp messages ----------

const nameForPhone = (phone) =>
  get("SELECT name FROM clients WHERE phone = ? ORDER BY id DESC LIMIT 1", phone)?.name ||
  get("SELECT name FROM leads WHERE phone = ? ORDER BY id DESC LIMIT 1", phone)?.name ||
  null;

const messageRow = (id) => get("SELECT * FROM messages WHERE id = ?", id);

// Store an outgoing message and try to send it. Messages that can wait (chat, auto reply,
// link) stay "pending" while WhatsApp is offline and go out when it reconnects.
async function sendMessage(phone, body, { kind = "chat", storedBody = body, canWait = true } = {}) {
  const { lastInsertRowid: id } = run(
    "INSERT INTO messages (phone, direction, kind, body, status) VALUES (?, 'out', ?, ?, 'pending')", phone, kind, storedBody,
  );
  events.publish("message", { phone, message: messageRow(id) });
  try {
    const waId = await wa.sendText(phone, body);
    run("UPDATE messages SET status = 'sent', wa_id = ?, error = NULL WHERE id = ?", waId, id);
  } catch (err) {
    if (!(canWait && err.code === "WA_OFFLINE")) {
      run("UPDATE messages SET status = 'failed', error = ? WHERE id = ?", err.message, id);
    }
  }
  const row = messageRow(id);
  events.publish("message", { phone, message: row });
  return row;
}

async function flushPending() {
  const rows = all(
    "SELECT * FROM messages WHERE direction = 'out' AND status = 'pending' AND kind != 'otp' AND created_at > datetime('now', '-1 day') ORDER BY id",
  );
  for (const m of rows) {
    try {
      const waId = await wa.sendText(m.phone, m.body);
      run("UPDATE messages SET status = 'sent', wa_id = ?, error = NULL WHERE id = ?", waId, m.id);
    } catch (err) {
      if (err.code === "WA_OFFLINE") return;
      run("UPDATE messages SET status = 'failed', error = ? WHERE id = ?", err.message, m.id);
    }
    events.publish("message", { phone: m.phone, message: messageRow(m.id) });
  }
}

wa.bus.on("ready", () => flushPending().catch((e) => console.error("flush failed:", e.message)));
wa.bus.on("state", (s) => events.publish("wa", publicWaState(s)));
wa.bus.on("incoming", ({ phone, body, waId }) => {
  const { lastInsertRowid: id } = run(
    "INSERT INTO messages (phone, direction, kind, body, status, wa_id, read) VALUES (?, 'in', 'chat', ?, 'received', ?, 0)", phone, body, waId,
  );
  const client = get("SELECT id, name FROM clients WHERE phone = ? ORDER BY id DESC LIMIT 1", phone);
  const lead = client ? null : get("SELECT id, name FROM leads WHERE phone = ? ORDER BY id DESC LIMIT 1", phone);
  const name = (client || lead)?.name || displayPhone(phone);
  events.publish("message", { phone, message: messageRow(id), client, lead, name });
  push.notify({ title: name, body, url: client ? `/admin#/clients/${client.id}` : "/admin#/leads", tag: `msg-${phone}` });
});

// A message whose sender couldn't be matched to a phone number still shows up as a popup.
wa.bus.on("incoming-unknown", ({ name, body }) => {
  events.publish("message-unknown", { name, body });
  push.notify({ title: name || "הודעה בוואטסאפ", body, url: "/admin", tag: "msg-unknown" });
});

const publicWaState = (s = wa.state) => ({ status: s.status, qr: s.qr, me: s.me ? displayPhone(s.me) : null, error: s.error });

// ---------- App ----------

const app = express();
app.set("trust proxy", true);
app.use(express.json({ limit: "200kb" }));
app.use(cookieParser());
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  next();
});

// ---------- Public: lead form ----------

// The landing page may live elsewhere (e.g. Vercel) and post its form here. These two
// endpoints take no cookies, so any origin may call them.
app.use(["/api/leads", "/api/public"], (req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.post("/api/leads", wrap(async (req, res) => {
  const b = req.body || {};
  if (b.website) return res.json({ success: true }); // honeypot
  if (limited(`lead:${req.ip}`, 5, 10 * 60e3)) throw new HttpError(429, "יותר מדי פניות. נסו שוב בעוד כמה דקות.");
  const name = String(b.name || "").trim().slice(0, 120);
  const phone = normalizePhone(b.phone);
  if (name.length < 2) throw new HttpError(400, "כתבו שם, כדי שנדע איך לפנות אליכם.");
  if (!phone) throw new HttpError(400, "מספר הטלפון לא נראה תקין.");
  if (limited(`lead-phone:${phone}`, 3, 60 * 60e3)) return res.json({ success: true });

  const type = String(b.type || "").trim().slice(0, 80);
  const message = String(b.message || "").trim().slice(0, 4000);
  const client = get("SELECT id FROM clients WHERE phone = ? ORDER BY id DESC LIMIT 1", phone);
  const { lastInsertRowid: id } = run(
    "INSERT INTO leads (name, phone, type, message, client_id) VALUES (?, ?, ?, ?, ?)", name, phone, type, message, client?.id ?? null,
  );
  const lead = leadView(get("SELECT * FROM leads WHERE id = ?", id));
  events.publish("lead", lead);
  res.json({ success: true });

  sendMessage(phone, fill(template("auto_reply"), { name: firstName(name) }), { kind: "auto" }).catch((e) =>
    console.error("auto reply failed:", e.message),
  );
  notifyStudio(lead);
  push.notify({
    title: `פנייה חדשה: ${lead.name}`,
    body: [lead.phoneDisplay, lead.type, lead.message].filter(Boolean).join(" · "),
    url: "/admin#/leads",
    tag: `lead-${lead.id}`,
  });
}));

// A short WhatsApp alert to the studio's own phone, so a new lead is seen even when the
// admin page is closed. Sent once, not queued: an old alert is no use.
function notifyStudio(lead) {
  const to = notifyPhone();
  if (setting("notify_leads", "1") !== "1" || !to || !wa.isConnected()) return;
  const lines = [`🔔 פנייה חדשה מהאתר`, `${lead.name} · ${lead.phoneDisplay}`, lead.type, lead.message, `${PUBLIC_URL}/admin`].filter(Boolean);
  wa.sendText(to, lines.join("\n")).catch((e) => console.error("lead alert failed:", e.message));
}

// Public: the studio's WhatsApp number for "message us" buttons (null when unknown).
app.get("/api/public/info", (req, res) => {
  res.setHeader("cache-control", "no-cache");
  res.json({ success: true, whatsapp: studioPhone() });
});

app.get("/healthz", (req, res) => {
  res.json({ ok: true, whatsapp: wa.state.status, drive: drive.isConnected(), uptime: Math.round(process.uptime()) });
});

// ---------- Admin auth (Google) ----------

const pendingStates = new Map();
const ADMIN_COOKIE = "spark_admin";

function allowedAdmin(email) {
  if (ADMIN_EMAILS.length) return ADMIN_EMAILS.includes(email);
  const owner = setting("owner_email");
  if (owner) return owner === email;
  setSetting("owner_email", email); // first sign-in on a fresh install claims the admin
  console.log(`Admin owner set to ${email}. Set ADMIN_EMAILS in .env to change it.`);
  return true;
}

app.get("/auth/google", (req, res) => {
  const state = token(16);
  pendingStates.set(state, Date.now());
  for (const [s, t] of pendingStates) if (Date.now() - t > 10 * 60e3) pendingStates.delete(s);
  res.redirect(drive.authUrl(state));
});

app.get("/oauth2callback", wrap(async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.redirect(`/admin?error=${encodeURIComponent(error)}`);
  if (!code || !state || !pendingStates.has(state)) return res.redirect("/admin?error=invalid_state");
  pendingStates.delete(state);
  let result;
  try {
    result = await drive.finishSignIn(code);
  } catch (err) {
    return res.redirect(`/admin?error=${encodeURIComponent(drive.errorMessage(err))}`);
  }
  if (!allowedAdmin(result.email)) return res.redirect("/admin?error=not_allowed");
  result.saveDrive();
  const t = token();
  run("INSERT INTO admin_sessions (token_hash, email, expires_at) VALUES (?, ?, ?)", hash(t), result.email, Date.now() + 30 * 864e5);
  res.cookie(ADMIN_COOKIE, t, { httpOnly: true, sameSite: "lax", secure: SECURE_COOKIES, maxAge: 30 * 864e5, path: "/" });
  res.redirect("/admin");
}));

function adminSession(req) {
  const t = req.cookies?.[ADMIN_COOKIE];
  if (!t) return null;
  const s = get("SELECT * FROM admin_sessions WHERE token_hash = ?", hash(t));
  if (!s || s.expires_at < Date.now()) return null;
  return s;
}

const requireAdmin = (req, res, next) => {
  const s = adminSession(req);
  if (!s) return res.status(401).json({ success: false, needsLogin: true, error: "יש להתחבר מחדש." });
  req.admin = s;
  next();
};

app.post("/api/admin/logout", (req, res) => {
  const t = req.cookies?.[ADMIN_COOKIE];
  if (t) run("DELETE FROM admin_sessions WHERE token_hash = ?", hash(t));
  res.clearCookie(ADMIN_COOKIE, { path: "/" });
  res.json({ success: true });
});

app.use("/api/admin", requireAdmin);

// ---------- Admin: overview, events, settings ----------

app.get("/api/admin/me", wrap(async (req, res) => {
  let driveEmail = null;
  if (drive.isConnected()) driveEmail = await drive.account().catch(() => null);
  res.json({
    success: true,
    email: req.admin.email,
    publicUrl: PUBLIC_URL,
    drive: { connected: drive.isConnected() && Boolean(driveEmail), email: driveEmail, folderUrl: drive.folderUrl(drive.PARENT_FOLDER_ID) },
    wa: publicWaState(),
    counts: {
      newLeads: get("SELECT COUNT(*) n FROM leads WHERE status = 'new'").n,
      unseenLeads: get("SELECT COUNT(*) n FROM leads WHERE seen = 0").n,
      clients: get("SELECT COUNT(*) n FROM clients").n,
      unreadMessages: get("SELECT COUNT(*) n FROM messages WHERE read = 0").n,
    },
  });
}));

app.get("/api/admin/counts", (req, res) => {
  res.json({
    success: true,
    newLeads: get("SELECT COUNT(*) n FROM leads WHERE status = 'new'").n,
    unreadMessages: get("SELECT COUNT(*) n FROM messages WHERE read = 0").n,
  });
});

app.get("/api/admin/events", (req, res) => {
  events.subscribe(req, res);
  res.write(`event: wa\ndata: ${JSON.stringify(publicWaState())}\n\n`);
});

app.post("/api/admin/wa/restart", wrap(async (req, res) => {
  try {
    await wa.restart();
  } catch (err) {
    throw new HttpError(err.status || 500, err.message);
  }
  res.json({ success: true });
}));

app.get("/api/admin/settings", (req, res) => {
  res.json({
    success: true,
    templates: Object.fromEntries(Object.keys(DEFAULT_TEMPLATES).map((k) => [k, template(k)])),
    notifyLeads: setting("notify_leads", "1") === "1",
    notifyPhone: setting("notify_phone", ""),
    publicWhatsapp: setting("public_whatsapp", ""),
    linkedPhone: wa.state.me ? displayPhone(wa.state.me) : null,
  });
});

app.put("/api/admin/settings", (req, res) => {
  const t = req.body?.templates || {};
  for (const key of Object.keys(DEFAULT_TEMPLATES)) {
    if (typeof t[key] !== "string") continue;
    const value = t[key].trim().slice(0, 2000);
    if (key === "otp_message" && !value.includes("{code}")) throw new HttpError(400, "הודעת הקוד חייבת לכלול {code}.");
    if (key === "link_message" && !value.includes("{link}")) throw new HttpError(400, "הודעת הקישור חייבת לכלול {link}.");
    setSetting(`tpl_${key}`, value || DEFAULT_TEMPLATES[key]);
  }
  const b = req.body || {};
  if (b.notifyLeads !== undefined) setSetting("notify_leads", b.notifyLeads ? "1" : "0");
  for (const [field, key] of [["notifyPhone", "notify_phone"], ["publicWhatsapp", "public_whatsapp"]]) {
    if (typeof b[field] !== "string") continue;
    const v = b[field].trim();
    if (v && !normalizePhone(v)) throw new HttpError(400, "מספר הטלפון לא נראה תקין.");
    setSetting(key, v ? normalizePhone(v) : "");
  }
  res.json({ success: true });
});

// ---------- Admin: push notifications on this device ----------

app.get("/api/admin/push", (req, res) => res.json({ success: true, publicKey: push.publicKey }));

app.post("/api/admin/push/subscribe", (req, res) => {
  if (!push.subscribe(req.body?.subscription, req.admin.email)) throw new HttpError(400, "המכשיר לא החזיר פרטי התראות תקינים.");
  res.json({ success: true });
});

app.post("/api/admin/push/unsubscribe", (req, res) => {
  push.unsubscribe(req.body?.endpoint);
  res.json({ success: true });
});

app.post("/api/admin/push/test", wrap(async (req, res) => {
  await push.notify({ title: "SPARK ✨", body: "ככה תיראה התראה על פנייה או הודעה חדשה.", url: "/admin#/settings", tag: "test" });
  res.json({ success: true });
}));

// ---------- Admin: leads ----------

function leadView(l) {
  return { ...l, phoneDisplay: displayPhone(l.phone), unread: get("SELECT COUNT(*) n FROM messages WHERE phone = ? AND read = 0", l.phone).n };
}

app.get("/api/admin/leads", (req, res) => {
  const status = String(req.query.status || "");
  const rows = status
    ? all("SELECT * FROM leads WHERE status = ? ORDER BY id DESC LIMIT 500", status)
    : all("SELECT * FROM leads ORDER BY id DESC LIMIT 500");
  res.json({ success: true, leads: rows.map(leadView) });
});

app.patch("/api/admin/leads/:id", (req, res) => {
  const lead = get("SELECT * FROM leads WHERE id = ?", Number(req.params.id));
  if (!lead) throw new HttpError(404, "הפנייה לא נמצאה.");
  const { status, seen } = req.body || {};
  if (status && ["new", "contacted", "converted", "closed"].includes(status)) run("UPDATE leads SET status = ? WHERE id = ?", status, lead.id);
  if (seen !== undefined) run("UPDATE leads SET seen = ? WHERE id = ?", seen ? 1 : 0, lead.id);
  res.json({ success: true, lead: leadView(get("SELECT * FROM leads WHERE id = ?", lead.id)) });
});

app.post("/api/admin/leads/seen-all", (req, res) => {
  run("UPDATE leads SET seen = 1 WHERE seen = 0");
  res.json({ success: true });
});

// ---------- Admin: clients ----------

const CLIENT_FIELDS = ["name", "phone", "email", "business", "service", "price", "notes", "drive_folder_id"];

function clientSummary(c) {
  return {
    ...c,
    phoneDisplay: displayPhone(c.phone),
    link: portalLink(c),
    folderUrl: c.drive_folder_id ? drive.folderUrl(c.drive_folder_id) : null,
    openTasks: get("SELECT COUNT(*) n FROM tasks WHERE client_id = ? AND done = 0", c.id).n,
    unread: get("SELECT COUNT(*) n FROM messages WHERE phone = ? AND read = 0", c.phone).n,
    lastMessageAt: get("SELECT MAX(created_at) t FROM messages WHERE phone = ?", c.phone).t,
  };
}

function cleanClientInput(body, { partial = false } = {}) {
  const out = {};
  for (const key of CLIENT_FIELDS) {
    if (body[key] === undefined) continue;
    let v = body[key] === null ? null : String(body[key]).trim();
    if (key === "phone") {
      v = normalizePhone(v);
      if (!v) throw new HttpError(400, "מספר הטלפון לא נראה תקין.");
    }
    if (key === "name" && (!v || v.length < 2)) throw new HttpError(400, "חסר שם לקוח.");
    if (key === "notes") v = v.slice(0, 50000);
    else if (v) v = v.slice(0, 300);
    out[key] = key === "drive_folder_id" ? v || null : v ?? "";
  }
  if (!partial && (!out.name || !out.phone)) throw new HttpError(400, "שם וטלפון הם שדות חובה.");
  return out;
}

async function createClient(body, leadId = null) {
  const data = cleanClientInput(body);
  // Drive folder: an existing one, a new one, or none (when Drive isn't connected).
  const folder = body.folder || {};
  if (folder.mode === "existing" && folder.id) data.drive_folder_id = String(folder.id);
  else if (folder.mode !== "none" && drive.isConnected()) {
    const folderName = data.business ? `${data.name} · ${data.business}` : data.name;
    data.drive_folder_id = await drive.ensureFolder(folderName);
  }
  const cols = Object.keys(data);
  const { lastInsertRowid: id } = run(
    `INSERT INTO clients (${cols.join(", ")}, slug) VALUES (${cols.map(() => "?").join(", ")}, ?)`, ...cols.map((k) => data[k]), slugId(),
  );
  if (leadId) run("UPDATE leads SET status = 'converted', seen = 1, client_id = ? WHERE id = ?", id, leadId);
  run("UPDATE leads SET client_id = ? WHERE phone = ? AND client_id IS NULL", id, data.phone);
  return get("SELECT * FROM clients WHERE id = ?", id);
}

app.post("/api/admin/leads/:id/convert", wrap(async (req, res) => {
  const lead = get("SELECT * FROM leads WHERE id = ?", Number(req.params.id));
  if (!lead) throw new HttpError(404, "הפנייה לא נמצאה.");
  const client = await createClient({ service: lead.type, ...req.body }, lead.id);
  events.publish("clients", {});
  res.status(201).json({ success: true, client: clientSummary(client) });
}));

app.get("/api/admin/clients", (req, res) => {
  const rows = all("SELECT * FROM clients ORDER BY updated_at DESC, id DESC");
  res.json({ success: true, clients: rows.map(clientSummary) });
});

app.post("/api/admin/clients", wrap(async (req, res) => {
  const client = await createClient(req.body || {});
  events.publish("clients", {});
  res.status(201).json({ success: true, client: clientSummary(client) });
}));

function loadClient(req) {
  const c = get("SELECT * FROM clients WHERE id = ?", Number(req.params.id));
  if (!c) throw new HttpError(404, "הלקוח לא נמצא.");
  return c;
}

app.get("/api/admin/clients/:id", (req, res) => {
  const c = loadClient(req);
  res.json({
    success: true,
    client: clientSummary(c),
    tasks: all("SELECT * FROM tasks WHERE client_id = ? ORDER BY done, COALESCE(due_date, '9999'), id", c.id),
    leads: all("SELECT * FROM leads WHERE client_id = ? ORDER BY id DESC", c.id),
    devices: get("SELECT COUNT(*) n FROM devices WHERE client_id = ?", c.id).n,
  });
});

app.patch("/api/admin/clients/:id", (req, res) => {
  const c = loadClient(req);
  const data = cleanClientInput(req.body || {}, { partial: true });
  const cols = Object.keys(data);
  if (cols.length) {
    run(`UPDATE clients SET ${cols.map((k) => `${k} = ?`).join(", ")}, updated_at = datetime('now') WHERE id = ?`, ...cols.map((k) => data[k]), c.id);
  }
  res.json({ success: true, client: clientSummary(get("SELECT * FROM clients WHERE id = ?", c.id)) });
});

app.delete("/api/admin/clients/:id", (req, res) => {
  const c = loadClient(req);
  run("UPDATE leads SET client_id = NULL WHERE client_id = ?", c.id);
  run("DELETE FROM clients WHERE id = ?", c.id);
  events.publish("clients", {});
  res.json({ success: true });
});

app.post("/api/admin/clients/:id/folder", wrap(async (req, res) => {
  const c = loadClient(req);
  if (!drive.isConnected()) throw new HttpError(409, "צריך לחבר את Google Drive קודם.");
  const id = req.body?.id ? String(req.body.id) : await drive.ensureFolder(c.business ? `${c.name} · ${c.business}` : c.name);
  run("UPDATE clients SET drive_folder_id = ?, updated_at = datetime('now') WHERE id = ?", id, c.id);
  res.json({ success: true, client: clientSummary(get("SELECT * FROM clients WHERE id = ?", c.id)) });
}));

app.post("/api/admin/clients/:id/send-link", wrap(async (req, res) => {
  const c = loadClient(req);
  const body = fill(template("link_message"), { name: firstName(c.name), link: portalLink(c) });
  const message = await sendMessage(c.phone, body, { kind: "link" });
  res.json({ success: true, message });
}));

app.post("/api/admin/clients/:id/signout-devices", (req, res) => {
  const c = loadClient(req);
  run("DELETE FROM devices WHERE client_id = ?", c.id);
  res.json({ success: true });
});

app.post("/api/admin/clients/:id/new-link", (req, res) => {
  const c = loadClient(req);
  run("UPDATE clients SET slug = ? WHERE id = ?", slugId(), c.id);
  run("DELETE FROM devices WHERE client_id = ?", c.id);
  res.json({ success: true, client: clientSummary(get("SELECT * FROM clients WHERE id = ?", c.id)) });
});

// ---------- Admin: tasks ----------

app.post("/api/admin/clients/:id/tasks", (req, res) => {
  const c = loadClient(req);
  const text = String(req.body?.text || "").trim().slice(0, 500);
  if (!text) throw new HttpError(400, "כתבו משימה.");
  const due = /^\d{4}-\d{2}-\d{2}$/.test(req.body?.due_date || "") ? req.body.due_date : null;
  const { lastInsertRowid: id } = run("INSERT INTO tasks (client_id, text, due_date) VALUES (?, ?, ?)", c.id, text, due);
  run("UPDATE clients SET updated_at = datetime('now') WHERE id = ?", c.id);
  res.status(201).json({ success: true, task: get("SELECT * FROM tasks WHERE id = ?", id) });
});

app.patch("/api/admin/tasks/:id", (req, res) => {
  const t = get("SELECT * FROM tasks WHERE id = ?", Number(req.params.id));
  if (!t) throw new HttpError(404, "המשימה לא נמצאה.");
  const b = req.body || {};
  if (b.done !== undefined) run("UPDATE tasks SET done = ? WHERE id = ?", b.done ? 1 : 0, t.id);
  if (typeof b.text === "string" && b.text.trim()) run("UPDATE tasks SET text = ? WHERE id = ?", b.text.trim().slice(0, 500), t.id);
  if (b.due_date !== undefined) run("UPDATE tasks SET due_date = ? WHERE id = ?", /^\d{4}-\d{2}-\d{2}$/.test(b.due_date || "") ? b.due_date : null, t.id);
  res.json({ success: true, task: get("SELECT * FROM tasks WHERE id = ?", t.id) });
});

app.delete("/api/admin/tasks/:id", (req, res) => {
  run("DELETE FROM tasks WHERE id = ?", Number(req.params.id));
  res.json({ success: true });
});

// ---------- Admin: messages ----------

app.get("/api/admin/messages", (req, res) => {
  const phone = normalizePhone(req.query.phone);
  if (!phone) throw new HttpError(400, "חסר מספר טלפון.");
  run("UPDATE messages SET read = 1 WHERE phone = ? AND read = 0", phone);
  res.json({ success: true, messages: all("SELECT * FROM messages WHERE phone = ? ORDER BY id DESC LIMIT 300", phone).reverse(), name: nameForPhone(phone) });
});

app.post("/api/admin/messages", wrap(async (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  const body = String(req.body?.body || "").trim().slice(0, 4000);
  if (!phone || !body) throw new HttpError(400, "חסר טלפון או הודעה.");
  const message = await sendMessage(phone, body);
  run("UPDATE leads SET status = 'contacted' WHERE phone = ? AND status = 'new'", phone);
  res.json({ success: true, message });
}));

app.post("/api/admin/messages/:id/retry", wrap(async (req, res) => {
  const m = messageRow(Number(req.params.id));
  if (!m || m.direction !== "out" || m.kind === "otp") throw new HttpError(404, "ההודעה לא נמצאה.");
  run("DELETE FROM messages WHERE id = ?", m.id);
  const message = await sendMessage(m.phone, m.body, { kind: m.kind });
  res.json({ success: true, message, replaced: m.id });
}));

// ---------- Admin: Drive folders and videos ----------

const tmpUploads = path.join(DATA_DIR, "uploads");
fs.mkdirSync(tmpUploads, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: tmpUploads,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${token(8)}`),
  }),
  limits: { fileSize: 5 * 1024 ** 3 },
  fileFilter: (req, file, cb) => (file.mimetype.startsWith("video/") ? cb(null, true) : cb(new HttpError(400, "אפשר להעלות רק קבצי וידאו."))),
});
// multer gives latin1 file names; restore UTF-8 so Hebrew names survive.
const utf8Name = (name) => Buffer.from(name, "latin1").toString("utf8");

function requireDrive(req, res, next) {
  if (drive.isConnected()) return next();
  res.status(409).json({ success: false, needsDrive: true, error: "צריך לחבר את Google Drive." });
}

app.get("/api/admin/drive/folders", requireDrive, wrap(async (req, res) => {
  const used = new Set(all("SELECT drive_folder_id id FROM clients WHERE drive_folder_id IS NOT NULL").map((r) => r.id));
  const folders = await drive.listFolders();
  res.json({ success: true, folders: folders.map((f) => ({ ...f, linked: used.has(f.id) })) });
}));

app.get("/api/admin/clients/:id/videos", requireDrive, wrap(async (req, res) => {
  const c = loadClient(req);
  if (!c.drive_folder_id) return res.json({ success: true, videos: [], noFolder: true });
  const videos = await drive.listVideos(c.drive_folder_id);
  const notes = videoNotes(c.id);
  res.json({ success: true, videos: videos.map((v) => ({ ...v, note: notes.get(v.id) || "", ...mediaUrls(v.id, c.id) })) });
}));

const videoNotes = (clientId) => new Map(all("SELECT file_id, note FROM video_notes WHERE client_id = ?", clientId).map((r) => [r.file_id, r.note]));
const cleanNote = (note) => String(note || "").trim().slice(0, 2000);

app.post("/api/admin/clients/:id/videos", requireDrive, upload.single("video"), wrap(async (req, res) => {
  const file = req.file;
  try {
    const c = loadClient(req);
    if (!file) throw new HttpError(400, "לא נבחר קובץ.");
    if (!c.drive_folder_id) throw new HttpError(409, "ללקוח אין עדיין תיקייה בדרייב.");
    file.originalname = utf8Name(file.originalname);
    const uploaded = await drive.upload(c.drive_folder_id, file);
    const note = cleanNote(req.body?.note);
    if (note) run("INSERT OR REPLACE INTO video_notes (file_id, client_id, note) VALUES (?, ?, ?)", uploaded.id, c.id, note);
    run("UPDATE clients SET updated_at = datetime('now') WHERE id = ?", c.id);
    res.status(201).json({ success: true, video: { id: uploaded.id, name: uploaded.name } });
  } finally {
    if (file) fs.promises.unlink(file.path).catch(() => {});
  }
}));

app.delete("/api/admin/clients/:id/videos/:fileId", requireDrive, wrap(async (req, res) => {
  const c = loadClient(req);
  await assertInFolder(req.params.fileId, c.drive_folder_id);
  await drive.trash(req.params.fileId);
  run("DELETE FROM video_notes WHERE file_id = ?", req.params.fileId);
  res.json({ success: true });
}));

// After an upload: one WhatsApp message to the client, with the notes when there are any.
app.post("/api/admin/clients/:id/videos/notify", wrap(async (req, res) => {
  const c = loadClient(req);
  const count = Math.max(1, Math.min(50, Number(req.body?.count) || 1));
  const note = cleanNote(req.body?.note);
  const body = fill(template("video_message"), {
    name: firstName(c.name),
    videos: count === 1 ? "עלה סרטון חדש" : `עלו ${count} סרטונים חדשים`,
    notes: note ? `\n\nהערות:\n${note}` : "",
    link: portalLink(c),
  }).replace(/\n{3,}/g, "\n\n");
  const message = await sendMessage(c.phone, body, { kind: "video" });
  res.json({ success: true, message });
}));

// ---------- Media (signed links, used by the admin and the client area) ----------

function mediaUrls(fileId, clientId) {
  const exp = Date.now() + 12 * 3600e3;
  const sig = sign(`${fileId}.${clientId}.${exp}`);
  const q = `c=${clientId}&e=${exp}&s=${sig}`;
  return { src: `/media/v/${fileId}?${q}`, thumb: `/media/t/${fileId}?${q}`, download: `/media/v/${fileId}?${q}&dl=1` };
}

const folderCache = new Map();
async function assertInFolder(fileId, folderId) {
  if (!folderId) throw new HttpError(404, "Not found");
  const key = `${fileId}:${folderId}`;
  if (folderCache.get(key) > Date.now()) return;
  const meta = await drive.fileParents(fileId);
  if (!meta.parents?.includes(folderId)) throw new HttpError(404, "Not found");
  folderCache.set(key, Date.now() + 10 * 60e3);
  return meta;
}

function checkSignature(req) {
  const { c, e, s } = req.query;
  const expected = sign(`${req.params.fileId}.${c}.${e}`);
  if (!s || Number(e) < Date.now() || s.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected))) {
    throw new HttpError(403, "Link expired");
  }
  const client = get("SELECT * FROM clients WHERE id = ?", Number(c));
  if (!client) throw new HttpError(404, "Not found");
  return client;
}

app.get("/media/v/:fileId", wrap(async (req, res) => {
  const client = checkSignature(req);
  const meta = (await assertInFolder(req.params.fileId, client.drive_folder_id)) || (await drive.fileParents(req.params.fileId));
  await drive.stream(req.params.fileId, req, res, { download: req.query.dl === "1", name: meta.name, mimeType: meta.mimeType });
}));

app.get("/media/t/:fileId", wrap(async (req, res) => {
  const client = checkSignature(req);
  await assertInFolder(req.params.fileId, client.drive_folder_id);
  await drive.thumbnail(req.params.fileId, res);
}));

// ---------- Client area: WhatsApp code sign-in ----------

function portalClient(req) {
  const c = get("SELECT * FROM clients WHERE slug = ?", String(req.params.slug));
  if (!c) throw new HttpError(404, "הקישור לא נמצא. בקשו מאיתנו קישור חדש.");
  return c;
}
const phoneHint = (phone) => displayPhone(phone).replace(/\d(?=[\d-]{3})/g, "•");

function deviceClient(req) {
  const c = portalClient(req);
  const t = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!t) throw new HttpError(401, "צריך להתחבר.");
  const d = get("SELECT * FROM devices WHERE token_hash = ? AND client_id = ?", hash(t), c.id);
  if (!d) throw new HttpError(401, "צריך להתחבר מחדש.");
  if (Date.now() - Date.parse(d.last_seen + "Z") > 3600e3) run("UPDATE devices SET last_seen = datetime('now') WHERE id = ?", d.id);
  return { client: c, device: d };
}

app.get("/api/portal/:slug", (req, res) => {
  const c = portalClient(req);
  res.json({ success: true, firstName: firstName(c.name), phoneHint: phoneHint(c.phone) });
});

app.post("/api/portal/:slug/code", wrap(async (req, res) => {
  const c = portalClient(req);
  if (limited(`otp-ip:${req.ip}`, 10, 60 * 60e3)) throw new HttpError(429, "יותר מדי ניסיונות. נסו שוב מאוחר יותר.");
  const now = Date.now();
  const prev = get("SELECT * FROM otps WHERE client_id = ?", c.id);
  if (prev && now - prev.sent_at < 45e3) throw new HttpError(429, "כבר שלחנו קוד. אפשר לבקש קוד חדש בעוד כמה שניות.");
  const inWindow = prev && now - prev.window_start < 60 * 60e3;
  if (inWindow && prev.window_count >= 5) throw new HttpError(429, "ביקשתם הרבה קודים בשעה האחרונה. נסו שוב מאוחר יותר.");
  if (!wa.isConnected()) throw new HttpError(503, "אי אפשר לשלוח קוד כרגע. נסו שוב בעוד כמה דקות.");

  const code = String(crypto.randomInt(0, 1e6)).padStart(6, "0");
  run(
    `INSERT INTO otps (client_id, code_hash, expires_at, attempts, sent_at, window_start, window_count) VALUES (?, ?, ?, 0, ?, ?, ?)
     ON CONFLICT(client_id) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0,
       sent_at = excluded.sent_at, window_start = excluded.window_start, window_count = excluded.window_count`,
    c.id, hash(`${c.id}:${code}`), now + 10 * 60e3, now, inWindow ? prev.window_start : now, inWindow ? prev.window_count + 1 : 1,
  );
  const msg = await sendMessage(c.phone, fill(template("otp_message"), { code, name: firstName(c.name) }), {
    kind: "otp", storedBody: "קוד כניסה לאזור האישי נשלח", canWait: false,
  });
  if (msg.status !== "sent") throw new HttpError(502, "שליחת הקוד בוואטסאפ לא הצליחה. נסו שוב.");
  res.json({ success: true, phoneHint: phoneHint(c.phone) });
}));

app.post("/api/portal/:slug/verify", (req, res) => {
  const c = portalClient(req);
  const code = String(req.body?.code || "").replace(/\D/g, "");
  const otp = get("SELECT * FROM otps WHERE client_id = ?", c.id);
  if (!otp || otp.expires_at < Date.now()) throw new HttpError(400, "הקוד פג תוקף. בקשו קוד חדש.");
  if (otp.attempts >= 5) throw new HttpError(429, "יותר מדי ניסיונות. בקשו קוד חדש.");
  const ok = code.length === 6 && crypto.timingSafeEqual(Buffer.from(hash(`${c.id}:${code}`)), Buffer.from(otp.code_hash));
  if (!ok) {
    run("UPDATE otps SET attempts = attempts + 1 WHERE client_id = ?", c.id);
    throw new HttpError(400, "הקוד לא נכון. בדקו את ההודעה בוואטסאפ ונסו שוב.");
  }
  run("DELETE FROM otps WHERE client_id = ?", c.id);
  const t = token();
  run("INSERT INTO devices (client_id, token_hash, label) VALUES (?, ?, ?)", c.id, hash(t), String(req.headers["user-agent"] || "").slice(0, 200));
  res.json({ success: true, token: t });
});

app.get("/api/portal/:slug/me", wrap(async (req, res) => {
  const { client: c } = deviceClient(req);
  let videos = [];
  if (c.drive_folder_id && drive.isConnected()) {
    const notes = videoNotes(c.id);
    videos = (await drive.listVideos(c.drive_folder_id)).map((v) => ({
      id: v.id, name: v.name.replace(/\.[^.]+$/, ""), note: notes.get(v.id) || "", createdTime: v.createdTime, duration: v.duration,
      width: v.width, height: v.height, hasThumb: v.hasThumb, ...mediaUrls(v.id, c.id),
    }));
  }
  res.json({ success: true, client: { name: c.name, firstName: firstName(c.name), business: c.business }, videos });
}));

app.post("/api/portal/:slug/logout", (req, res) => {
  try {
    const { device } = deviceClient(req);
    run("DELETE FROM devices WHERE id = ?", device.id);
  } catch {}
  res.json({ success: true });
});

// ---------- Pages ----------

app.use("/api", (req, res) => res.status(404).json({ success: false, error: "Not found" }));
app.get(["/admin", "/admin/*"], (req, res) => res.sendFile(path.join(PUBLIC_DIR, "admin.html")));
// The landing page carries __SITE_URL__ where link previews (WhatsApp, Facebook) need absolute URLs.
let landingCache = null;
app.get(["/", "/index.html"], (req, res) => {
  if (!landingCache || process.env.NODE_ENV !== "production") {
    landingCache = fs.readFileSync(path.join(PUBLIC_DIR, "index.html"), "utf8").replaceAll("__SITE_URL__", PUBLIC_URL);
  }
  res.type("html").send(landingCache);
});
app.get("/c/:slug", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "client.html")));
app.use(express.static(PUBLIC_DIR, { extensions: ["html"] }));

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ success: false, error: err.code === "LIMIT_FILE_SIZE" ? "הקובץ גדול מדי (עד 5GB)." : err.message });
  }
  if (!(err instanceof HttpError)) {
    if (drive.needsReconnect(err)) {
      drive.disconnect();
      return res.status(409).json({ success: false, needsDrive: true, error: "החיבור ל-Google Drive פג. התחברו מחדש." });
    }
    console.error(err);
  }
  const status = err.status || 500;
  if (res.headersSent) return res.end();
  res.status(status).json({ success: false, error: status === 500 ? drive.errorMessage(err) : err.message });
});

// ---------- Daily database backup (data/backups, last 14 days) ----------

const BACKUP_DIR = path.join(DATA_DIR, "backups");
function backup() {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const file = path.join(BACKUP_DIR, `spark-${new Date().toISOString().slice(0, 10)}.db`);
    if (!fs.existsSync(file)) run(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    const old = fs.readdirSync(BACKUP_DIR).filter((f) => /^spark-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().slice(0, -14);
    for (const f of old) fs.unlinkSync(path.join(BACKUP_DIR, f));
  } catch (err) {
    console.error("Backup failed:", err.message);
  }
}

const server = app.listen(PORT, () => {
  console.log(`SPARK running at ${PUBLIC_URL}`);
  console.log(`  landing: ${PUBLIC_URL}/   admin: ${PUBLIC_URL}/admin`);
  wa.start();
  backup();
  setInterval(backup, 6 * 3600e3).unref();
});

// Close the WhatsApp connection with the server, so a restart never leaves two sockets on one session.
let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  console.log(`${signal}: shutting down`);
  server.close();
  await Promise.race([wa.stop(), new Promise((r) => setTimeout(r, 8000))]);
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

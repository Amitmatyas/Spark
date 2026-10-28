// WhatsApp through open-wa (WhatsApp Web driven by Chrome). The admin page shows the QR
// to link the studio's phone once; the session is kept in data/wa so restarts reconnect.
const EventEmitter = require("events");
const path = require("path");
const fs = require("fs");
const { DATA_DIR, setting, setSetting } = require("./db");

const SESSION_ID = "spark";
const CHROME_PATHS = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
].filter(Boolean);

const bus = new EventEmitter();
const state = { status: "off", qr: null, me: null, error: null }; // off | starting | qr | linking | connected | logged_out | error | disabled
let client = null;
let starting = false;
let listening = false;

function setState(patch) {
  Object.assign(state, patch);
  bus.emit("state", { ...state });
}

// Follow open-wa's own session lifecycle (registered once, also before create() resolves):
// QR shown -> scanned (linking) -> READY, and back to a new QR after the phone logs out.
function listen(ev) {
  if (listening) return;
  listening = true;
  ev.on(`qr.${SESSION_ID}`, (qr) => setState({ status: "qr", qr }));
  ev.on("launch.auth.qr.scanned", () => setState({ status: "linking", qr: null }));
  ev.on("session.logout", () => setState({ status: "logged_out", qr: null, me: null }));
  ev.on("session.state.changed", (payload) => {
    const next = payload?.details?.next;
    if (next === "READY" && client) setState({ status: "connected", qr: null, error: null });
    else if (next === "READY") setState({ status: "linking", qr: null });
  });
}

async function start() {
  if (process.env.WA_DISABLED === "1") return setState({ status: "disabled" });
  if (starting || client) return;
  starting = true;
  let wa;
  try {
    wa = require("@open-wa/wa-automate");
  } catch (err) {
    starting = false;
    return setState({ status: "error", error: "open-wa is not installed (npm install)" });
  }
  listen(wa.ev);
  setState({ status: "starting", qr: null, error: null });

  try {
    client = await wa.create({
      sessionId: SESSION_ID,
      sessionDataPath: path.join(DATA_DIR, "wa"),
      multiDevice: true,
      useChrome: true,
      executablePath: CHROME_PATHS.find((p) => fs.existsSync(p)),
      headless: process.env.WA_HEADLESS !== "0",
      qrTimeout: 0,
      authTimeout: 0,
      qrLogSkip: true,
      popup: false,
      logConsole: false,
      killProcessOnBrowserClose: false,
      killProcessOnTimeout: false,
      // On Linux servers Chrome often needs --no-sandbox (see deploy/spark.service).
      ...(process.env.WA_CHROME_ARGS ? { chromiumArgs: process.env.WA_CHROME_ARGS.split(/\s+/).filter(Boolean) } : {}),
    });
  } catch (err) {
    client = null;
    starting = false;
    console.error("WhatsApp failed to start:", err?.message || err);
    return setState({ status: "error", error: err?.message || String(err) });
  }
  starting = false;

  let me = null;
  try {
    me = String(await client.getHostNumber()).replace(/\D/g, "") || null;
  } catch {}
  setState({ status: "connected", qr: null, me, error: null });
  bus.emit("ready");

  client.onStateChanged((s) => {
    if (s === "CONNECTED" || s === "READY") setState({ status: "connected" });
    else if (/UNPAIRED|LOGOUT/.test(String(s))) setState({ status: "logged_out" });
  });
  client.onMessage(async (m) => {
    try {
      const from = String(m.from || "");
      if (m.fromMe || m.isGroupMsg || from.endsWith("@g.us") || from === "status@broadcast") return;
      const phone = await senderPhone(m);
      const body = m.body && m.type === "chat" ? m.body : m.caption || "[מדיה]";
      console.log(`WhatsApp in: from=${from} sender=${m.sender?.id || "-"} -> ${phone || "unknown"} (${m.type})`);
      if (phone) bus.emit("incoming", { phone, body, waId: String(m.id) });
      else bus.emit("incoming-unknown", { name: m.notifyName || m.sender?.pushname || m.sender?.name || "", body });
    } catch (err) {
      console.error("WhatsApp incoming message failed:", err?.message || err);
    }
  });
}

// WhatsApp increasingly addresses people by a private "@lid" id instead of their number.
// Resolve the sender's phone from the message, the contact, or a mapping learned when we
// sent them a message (the send result names the @lid chat it went to).
const digits = (v) => String(v || "").replace(/@.*/, "").replace(/\D/g, "");
const LID_KEY = (lid) => `lid:${digits(lid)}`;

async function senderPhone(m) {
  const ids = [m.from, m.sender?.id, m.chatId, m.chat?.id, m.author].map((v) => String(v || ""));
  const cus = ids.find((v) => v.endsWith("@c.us"));
  if (cus) return digits(cus);
  const direct = m.sender?.phoneNumber || m.sender?.pn || m.senderPn || m.chat?.contact?.phoneNumber;
  if (direct && digits(direct).length >= 10) return digits(direct);
  const lid = ids.find((v) => v.endsWith("@lid"));
  if (!lid) return null;
  const known = setting(LID_KEY(lid));
  if (known) return known;
  try {
    const c = await client.getContact(lid);
    const fromContact = [c?.phoneNumber, c?.pn, c?.number, c?.userid, c?.id?._serialized, c?.id].map(String).find((v) => /@c\.us$|^\+?\d{10,15}$/.test(v));
    if (fromContact) {
      setSetting(LID_KEY(lid), digits(fromContact));
      return digits(fromContact);
    }
  } catch {}
  return null;
}

function learnLid(phone, sentId) {
  const lid = String(sentId).match(/(\d+)@lid/);
  if (lid) setSetting(`lid:${lid[1]}`, phone);
}

async function stop() {
  const c = client;
  client = null;
  starting = false;
  if (c) await c.stop("restart").catch(() => {});
  setState({ status: "off", qr: null });
}

// A second browser on the same WhatsApp session makes WhatsApp log the device out, so a
// restart is refused while a session is still starting or linking.
async function restart() {
  if (starting) {
    const err = new Error("וואטסאפ עדיין מתחבר. חכו עד דקה לפני הפעלה מחדש.");
    err.status = 409;
    throw err;
  }
  await stop();
  start();
}

const isConnected = () => Boolean(client) && state.status === "connected";

async function sendText(phone, text) {
  if (!isConnected()) {
    const err = new Error("WhatsApp is not connected");
    err.code = "WA_OFFLINE";
    throw err;
  }
  const id = await client.sendText(`${phone}@c.us`, text);
  if (!id) throw new Error("WhatsApp did not accept the message");
  const waId = String(typeof id === "object" ? id._serialized || id.id || JSON.stringify(id) : id);
  learnLid(phone, waId);
  return waId;
}

module.exports = { bus, state, start, stop, restart, sendText, isConnected };

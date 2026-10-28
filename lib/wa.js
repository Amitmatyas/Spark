// WhatsApp through Baileys (WhatsApp Web's own protocol over a WebSocket, no browser), so it
// fits small servers. The admin page shows the QR to link the studio's phone once; the session
// is kept in data/wa-baileys so restarts reconnect.
const EventEmitter = require("events");
const path = require("path");
const fs = require("fs");
const { DATA_DIR, setting, setSetting } = require("./db");

const AUTH_DIR = path.join(DATA_DIR, "wa-baileys");

const bus = new EventEmitter();
const state = { status: "off", qr: null, me: null, error: null }; // off | starting | qr | linking | connected | logged_out | error | disabled
let sock = null;
let starting = false;
let stopping = false;
let retryTimer = null;
let retries = 0;

function setState(patch) {
  Object.assign(state, patch);
  bus.emit("state", { ...state });
}

// Baileys wants a pino-style logger; keep it quiet unless WA_DEBUG=1.
const noop = () => {};
const logger = {
  level: "silent",
  child() { return logger; },
  trace: noop, debug: noop, info: noop,
  warn: process.env.WA_DEBUG === "1" ? console.warn : noop,
  error: process.env.WA_DEBUG === "1" ? console.error : noop,
  fatal: console.error,
};

const digits = (v) => String(v || "").replace(/[:@].*/, "").replace(/\D/g, "");

async function start() {
  if (process.env.WA_DISABLED === "1") return setState({ status: "disabled" });
  if (starting || sock) return;
  starting = true;
  stopping = false;
  clearTimeout(retryTimer);
  let B;
  try {
    B = await import("@whiskeysockets/baileys");
  } catch (err) {
    starting = false;
    return setState({ status: "error", error: "Baileys is not installed (npm install)" });
  }
  setState({ status: "starting", qr: null, error: null });

  try {
    const { state: auth, saveCreds } = await B.useMultiFileAuthState(AUTH_DIR);
    const s = B.makeWASocket({
      auth: { creds: auth.creds, keys: B.makeCacheableSignalKeyStore(auth.keys, logger) },
      logger,
      browser: B.Browsers.macOS("SPARK"),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false,
    });
    sock = s;
    s.ev.on("creds.update", saveCreds);
    s.ev.on("connection.update", (u) => onConnection(B, s, u));
    s.ev.on("messages.upsert", ({ messages, type }) => {
      if (type !== "notify") return;
      for (const m of messages) onMessage(s, m).catch((err) => console.error("WhatsApp incoming message failed:", err?.message || err));
    });
  } catch (err) {
    sock = null;
    console.error("WhatsApp failed to start:", err?.message || err);
    setState({ status: "error", error: err?.message || String(err) });
  }
  starting = false;
}

function onConnection(B, s, { connection, lastDisconnect, qr }) {
  if (s !== sock) return;
  if (qr) setState({ status: "qr", qr });
  if (connection === "connecting" && state.status !== "qr") setState({ status: state.me ? "starting" : "linking" });
  if (connection === "open") {
    retries = 0;
    setState({ status: "connected", qr: null, me: digits(s.user?.id) || null, error: null });
    bus.emit("ready");
  }
  if (connection === "close") {
    sock = null;
    if (stopping) return;
    const code = lastDisconnect?.error?.output?.statusCode;
    if (code === B.DisconnectReason.loggedOut) {
      // The phone removed this device: drop the old keys and show a fresh QR.
      fs.rmSync(AUTH_DIR, { recursive: true, force: true });
      setState({ status: "logged_out", qr: null, me: null });
      retryTimer = setTimeout(start, 2000);
      return;
    }
    // Network drops and WhatsApp's routine "restart required" after linking: reconnect,
    // backing off to a minute between attempts.
    const delay = code === B.DisconnectReason.restartRequired ? 0 : Math.min(60000, 2000 * 2 ** retries++);
    setState({ status: "starting", qr: null, error: lastDisconnect?.error?.message || null });
    retryTimer = setTimeout(start, delay);
  }
}

// WhatsApp increasingly addresses people by a private "@lid" id instead of their number.
// Resolve the phone from the message's alternate address, Baileys' own LID map, or one we
// learned before.
async function senderPhone(s, key) {
  const jid = String(key.remoteJid || "");
  if (jid.endsWith("@s.whatsapp.net")) return digits(jid);
  if (!jid.endsWith("@lid")) return null;
  const alt = String(key.remoteJidAlt || key.senderPn || "");
  if (alt.endsWith("@s.whatsapp.net")) return remember(jid, digits(alt));
  try {
    const pn = await s.signalRepository?.lidMapping?.getPNForLID?.(jid);
    if (pn) return remember(jid, digits(pn));
  } catch {}
  return setting(`lid:${digits(jid)}`) || null;
}

function remember(lid, phone) {
  if (phone && setting(`lid:${digits(lid)}`) !== phone) setSetting(`lid:${digits(lid)}`, phone);
  return phone || null;
}

function messageText(msg) {
  if (!msg) return null;
  const m = msg.ephemeralMessage?.message || msg.viewOnceMessage?.message || msg;
  if (m.conversation) return m.conversation;
  if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
  for (const k of ["imageMessage", "videoMessage", "documentMessage"]) {
    if (m[k]) return m[k].caption || "[מדיה]";
  }
  if (m.audioMessage || m.stickerMessage || m.contactMessage || m.locationMessage) return "[מדיה]";
  return null; // reactions, receipts, protocol messages
}

async function onMessage(s, m) {
  const jid = String(m.key?.remoteJid || "");
  if (m.key?.fromMe || jid.endsWith("@g.us") || jid === "status@broadcast" || jid.endsWith("@newsletter")) return;
  const body = messageText(m.message);
  if (!body) return;
  const phone = await senderPhone(s, m.key);
  console.log(`WhatsApp in: from=${jid} -> ${phone || "unknown"}`);
  if (phone) bus.emit("incoming", { phone, body, waId: String(m.key.id) });
  else bus.emit("incoming-unknown", { name: m.pushName || "", body });
}

async function stop() {
  stopping = true;
  clearTimeout(retryTimer);
  const s = sock;
  sock = null;
  starting = false;
  if (s) {
    try { s.end(undefined); } catch {}
  }
  setState({ status: "off", qr: null });
}

async function restart() {
  if (starting) {
    const err = new Error("וואטסאפ עדיין מתחבר. חכו כמה שניות לפני הפעלה מחדש.");
    err.status = 409;
    throw err;
  }
  await stop();
  retries = 0;
  start();
}

const isConnected = () => Boolean(sock) && state.status === "connected";

async function sendText(phone, text) {
  if (!isConnected()) {
    const err = new Error("WhatsApp is not connected");
    err.code = "WA_OFFLINE";
    throw err;
  }
  const sent = await sock.sendMessage(`${phone}@s.whatsapp.net`, { text });
  if (!sent?.key?.id) throw new Error("WhatsApp did not accept the message");
  return String(sent.key.id);
}

module.exports = { bus, state, start, stop, restart, sendText, isConnected };

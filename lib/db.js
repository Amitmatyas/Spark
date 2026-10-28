// SQLite storage (Node's built-in node:sqlite, no native build step).
const { DatabaseSync } = require("node:sqlite");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "..", "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, "spark.db"));
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  business TEXT NOT NULL DEFAULT '',
  service TEXT NOT NULL DEFAULT '',
  price TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  slug TEXT NOT NULL UNIQUE,
  drive_folder_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS clients_phone ON clients(phone);

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new',          -- new | contacted | converted | closed
  seen INTEGER NOT NULL DEFAULT 0,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS leads_phone ON leads(phone);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  due_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  phone TEXT NOT NULL,
  direction TEXT NOT NULL,                      -- in | out
  kind TEXT NOT NULL DEFAULT 'chat',            -- chat | auto | otp | link | video
  body TEXT NOT NULL,
  status TEXT NOT NULL,                         -- pending | sent | failed | received
  error TEXT,
  wa_id TEXT,
  read INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS messages_phone ON messages(phone, id);

CREATE TABLE IF NOT EXISTS otps (
  client_id INTEGER PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  sent_at INTEGER NOT NULL,
  window_start INTEGER NOT NULL,
  window_count INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- What the studio wrote to the client about a video, shown in the client area.
CREATE TABLE IF NOT EXISTS video_notes (
  file_id TEXT PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Admin devices that get push notifications (Web Push), even with the admin page closed.
CREATE TABLE IF NOT EXISTS push_subs (
  endpoint TEXT PRIMARY KEY,
  keys TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

const get = (sql, ...args) => db.prepare(sql).get(...args);
const all = (sql, ...args) => db.prepare(sql).all(...args);
const run = (sql, ...args) => db.prepare(sql).run(...args);

function setting(key, fallback = null) {
  const row = get("SELECT value FROM settings WHERE key = ?", key);
  return row ? row.value : fallback;
}
function setSetting(key, value) {
  run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, String(value));
}

// Server secret for hashing codes/tokens and signing media URLs, created once.
let secret = setting("secret");
if (!secret) {
  secret = crypto.randomBytes(32).toString("hex");
  setSetting("secret", secret);
}
const hash = (value) => crypto.createHmac("sha256", secret).update(String(value)).digest("hex");
const sign = (value) => crypto.createHmac("sha256", secret).update(String(value)).digest("base64url").slice(0, 32);

module.exports = { db, get, all, run, setting, setSetting, hash, sign, DATA_DIR };

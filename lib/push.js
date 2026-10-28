// Web Push to the admin's devices, so new leads and messages pop up on the computer or phone
// even when the admin page is closed. Keys are made once and kept in settings.
const webpush = require("web-push");
const { all, run, setting, setSetting } = require("./db");

let keys = JSON.parse(setting("vapid", "null"));
if (!keys) {
  keys = webpush.generateVAPIDKeys();
  setSetting("vapid", JSON.stringify(keys));
}

function configure(publicUrl) {
  // Push services want a contact: the site's https address, or a placeholder while running locally.
  const subject = publicUrl.startsWith("https://") ? publicUrl : "mailto:admin@spark.invalid";
  webpush.setVapidDetails(subject, keys.publicKey, keys.privateKey);
}

function subscribe(sub, email) {
  if (!sub?.endpoint?.startsWith("https://") || !sub.keys?.p256dh || !sub.keys?.auth) return false;
  run(
    "INSERT INTO push_subs (endpoint, keys, email) VALUES (?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET keys = excluded.keys, email = excluded.email",
    sub.endpoint, JSON.stringify({ p256dh: sub.keys.p256dh, auth: sub.keys.auth }), email,
  );
  return true;
}

const unsubscribe = (endpoint) => run("DELETE FROM push_subs WHERE endpoint = ?", String(endpoint || ""));

// payload: { title, body, url, tag }. Never throws; dead subscriptions are dropped.
async function notify(payload) {
  const subs = all("SELECT * FROM push_subs");
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: JSON.parse(s.keys) }, JSON.stringify(payload), { TTL: 6 * 3600, urgency: "high" });
    } catch (err) {
      if ([404, 410].includes(err.statusCode)) unsubscribe(s.endpoint);
      else console.error("push failed:", err.statusCode || err.message);
    }
  }));
}

module.exports = { configure, subscribe, unsubscribe, notify, publicKey: keys.publicKey };

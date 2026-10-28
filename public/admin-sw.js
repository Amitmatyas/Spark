/* SPARK admin service worker: shows push notifications (new leads, WhatsApp messages)
   even when the admin page is closed, and opens the right page when one is tapped. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let d = {};
  try {
    d = e.data ? e.data.json() : {};
  } catch {}
  e.waitUntil((async () => {
    // The admin page in front already shows its own popup and sound.
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (wins.some((w) => w.focused && w.visibilityState === "visible")) return;
    await self.registration.showNotification(d.title || "SPARK", {
      body: d.body || "",
      icon: "/assets/icon-192.png",
      badge: "/assets/spark-mark.png",
      tag: d.tag,
      renotify: Boolean(d.tag),
      lang: "he",
      dir: "rtl",
      data: { url: d.url || "/admin" },
    });
  })());
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || "/admin", self.location.origin).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const win = wins.find((w) => new URL(w.url).pathname.startsWith("/admin"));
    if (win) {
      await win.focus();
      win.postMessage({ open: url });
      return;
    }
    await self.clients.openWindow(url);
  })());
});

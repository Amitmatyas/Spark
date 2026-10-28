/* SPARK legal pages: show the studio's WhatsApp number where a page offers it ([data-wa]).
   Same server address rule as the landing page: on the SPARK server itself call it directly, elsewhere (Vercel) the NAS. */
"use strict";
(() => {
  const API_BASE = location.hostname === "localhost" || location.hostname.endsWith(".ts.net") ? "" : "https://spark.taildf6d08.ts.net";
  const year = document.querySelector("[data-year]");
  if (year) year.textContent = new Date().getFullYear();
  fetch(API_BASE + "/api/public/info")
    .then((r) => (r.ok ? r.json() : null))
    .then((info) => {
      if (!info || !info.whatsapp) return;
      const local = info.whatsapp.startsWith("972") && info.whatsapp.length === 12 ? `0${info.whatsapp.slice(3, 5)}-${info.whatsapp.slice(5)}` : `+${info.whatsapp}`;
      document.querySelectorAll("[data-wa]").forEach((el) => {
        const a = el.querySelector("a") || el;
        a.href = `https://wa.me/${info.whatsapp}`;
        el.querySelectorAll("[data-wa-number]").forEach((n) => (n.textContent = local));
        el.hidden = false;
      });
    })
    .catch(() => {});
})();

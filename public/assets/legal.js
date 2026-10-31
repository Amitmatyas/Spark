/* SPARK legal pages: show the studio's WhatsApp number where a page offers it ([data-wa]).
   Same server address rule as the landing page: on the SPARK server itself call it directly, elsewhere (Vercel) the NAS. */
"use strict";
(() => {
  const API_BASE = location.hostname === "localhost" || location.hostname.endsWith(".ts.net") ? "" : "https://spark.taildf6d08.ts.net";
  /* The studio's WhatsApp, shown even while the server is unreachable (same number as CONFIG.WHATSAPP in index.html). */
  const WHATSAPP = "972792015879";
  const year = document.querySelector("[data-year]");
  if (year) year.textContent = new Date().getFullYear();
  const show = (number) => {
    const local = number.startsWith("972") && number.length === 12 ? `0${number.slice(3, 5)}-${number.slice(5)}` : `+${number}`;
    document.querySelectorAll("[data-wa]").forEach((el) => {
      const a = el.querySelector("a") || el;
      a.href = `https://wa.me/${number}`;
      el.querySelectorAll("[data-wa-number]").forEach((n) => (n.textContent = local));
      el.hidden = false;
    });
  };
  if (WHATSAPP) show(WHATSAPP);
  fetch(API_BASE + "/api/public/info")
    .then((r) => (r.ok ? r.json() : null))
    .then((info) => {
      if (info && info.whatsapp) show(info.whatsapp);
    })
    .catch(() => {});
})();

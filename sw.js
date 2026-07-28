// ============================================================================
//  Service worker — Spaar Electra Urenregistratie
//
//  Doet twee dingen:
//    1. Push-meldingen (herinnering om in of uit te klokken).
//    2. De app laten starten zonder bereik.
//
//  Dat tweede is de reden dat dit bestand is uitgebreid. Zonder service worker
//  haalde elke pagina zijn code van het net; op een bouwplaats zonder signaal
//  kreeg de monteur een leeg scherm en kon hij niet klokken — precies wanneer
//  het moet.
//
//  Strategie: network-first met een korte time-out voor de eigen bestanden. Dus
//  altijd de nieuwste versie als het kan, en de laatst bekende als het niet kan.
//  Aanroepen naar Supabase gaan er nooit doorheen: die moeten falen als er geen
//  verbinding is, anders denkt een monteur dat hij is ingeklokt terwijl dat niet
//  zo is.
// ============================================================================

// ── NOODSTOP ────────────────────────────────────────────────────────────────
//  Zet dit op true en push: elke telefoon ruimt bij de volgende start zijn
//  cache op en meldt de service worker af. Eén commit ontkoppelt de hele ploeg
//  als dit bestand ooit stukgaat — zonder dat er 25 telefoons langs hoeven.
const NOODSTOP = false;

const CACHE = "spaar-uren-v40";
const NETWERK_TIMEOUT_MS = 3000;

// Wat er klaar moet staan om te kunnen starten zonder bereik.
const BESTANDEN = [
  "./",
  "./index.html",
  "./monteur.html",
  "./aanmelden.html",
  "./uren.css",
  "./monteur.js",
  "./aanmelden.js",
  "./config.js",
  "./iconen.js",
  "./vendor/supabase-js.js",
  "./vendor/node-process.js",
  "./vendor/node-buffer.js",
  "./vendor/node-events.js",
  "./vendor/node-tty.js",
  "./vendor/node-async_hooks.js",
  "./manifest.json",
  "./spaarlogo.svg",
  "./apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  if (NOODSTOP) return;
  // Niet wachten op de oude versie: bij een kapotte cache wil je snel door.
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((c) =>
      // Per bestand, zodat één ontbrekend bestand niet de hele installatie sloopt.
      Promise.all(BESTANDEN.map((b) => c.add(b).catch(() => null))),
    ),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    if (NOODSTOP) {
      await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
      await self.registration.unregister();
      const wins = await self.clients.matchAll({ type: "window" });
      wins.forEach((w) => w.navigate(w.url));
      return;
    }
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  if (NOODSTOP) return;
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Alles wat niet van onze eigen site komt met rust laten — met name Supabase.
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      // Korte time-out: liever de opgeslagen versie dan een monteur die staat te
      // wachten op een verbinding die er niet is.
      const antwoord = await Promise.race([
        fetch(req),
        new Promise((_, af) => setTimeout(() => af(new Error("traag")), NETWERK_TIMEOUT_MS)),
      ]);
      if (antwoord && antwoord.ok) cache.put(req, antwoord.clone());
      return antwoord;
    } catch (_) {
      const opgeslagen = await cache.match(req, { ignoreSearch: true });
      if (opgeslagen) return opgeslagen;
      // Paginanavigatie zonder bereik en zonder opgeslagen versie: dan toch het
      // startscherm proberen, dat staat er meestal wel.
      if (req.mode === "navigate") {
        const start = await cache.match("./index.html", { ignoreSearch: true });
        if (start) return start;
      }
      return new Response("Geen verbinding en niets opgeslagen.", {
        status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
  })());
});

// ── Push-meldingen ──────────────────────────────────────────────────────────
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data.json(); } catch (_) { data = { body: event.data ? event.data.text() : "" }; }
  const titel = data.titel || "Spaar Electra — Urenregistratie";
  const opts = {
    body: data.body || "",
    icon: "push-icon.png",
    badge: "push-icon.png",
    tag: data.tag || "herinnering",
    data: { url: data.url || "./" },
    requireInteraction: true,
  };
  event.waitUntil(self.registration.showNotification(titel, opts));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "./";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) { if ("focus" in w) return w.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    }),
  );
});

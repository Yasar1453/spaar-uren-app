// Service worker voor Spaar Electra Urenregistratie — ontvangt push-meldingen
// (herinneringen om in/uit te klokken).

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

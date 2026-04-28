// Penney Construction service worker — handles push notifications.
// Lives at /sw.js so its scope is the whole origin.

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Penney Construction", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "Penney Construction";
  const options = {
    body: data.body || "",
    icon: data.icon || "/icon-192.png",
    badge: data.badge || "/icon-192.png",
    data: { url: data.url || "/command-center" },
    tag: data.tag,
    requireInteraction: false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/command-center";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const win of windows) {
        if (win.url.includes(url) && "focus" in win) return win.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});

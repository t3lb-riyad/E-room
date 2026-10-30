/* =========================================================================
   RoomSet — service worker
   Handles: app-shell caching, offline fallback, and FCM background messages.
   ========================================================================= */

const CACHE_VERSION = "roomset-v1.2.0";

// Config changes must not be masked by the old app-shell cache. The query
// string forces a fresh fetch when the service worker updates.
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");
importScripts("./js/config.js?v=" + CACHE_VERSION);

const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./user.html",
  "./offline.html",
  "./css/styles.css",
  "./js/config.js",
  "./js/core.js",
  "./js/ui.js",
  "./js/admin.js",
  "./js/user.js",
  "./js/push.js",
  "./manifest.webmanifest",
  "./manifest-user.webmanifest",
  "./icons/favicon.svg",
  "./icons/favicon-32.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/badge-72.png",
];

const CDN_HOSTS = new Set([
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "www.gstatic.com",
  "cdn.jsdelivr.net",
]);

/* -------------------------------------------------------------------------
   Lifecycle
   ------------------------------------------------------------------------- */

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      await Promise.allSettled(
        PRECACHE_URLS.map((url) =>
          cache.add(new Request(url, { cache: "reload" })),
        ),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

/* -------------------------------------------------------------------------
   Fetch strategies
   ------------------------------------------------------------------------- */

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return;
  if (request.headers.has("range")) return;

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request));
    return;
  }

  // Never serve a stale config from the cache-first app shell.
  if (
    url.origin === self.location.origin &&
    url.pathname.endsWith("/js/config.js")
  ) {
    event.respondWith(handleConfig(request));
    return;
  }

  if (url.origin === self.location.origin || CDN_HOSTS.has(url.hostname)) {
    handleAsset(event);
  }
});

async function handleNavigation(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(CACHE_VERSION);
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;

    const offline = await caches.match("./offline.html");
    if (offline) return offline;

    return new Response(
      "<!doctype html><html lang='ar' dir='rtl'><meta charset='utf-8'><title>غير متصل</title><body style='font-family:sans-serif;background:#EFE3CE;color:#342B1C;display:grid;place-items:center;min-height:100vh;margin:0'><p>لا يوجد اتصال بالإنترنت.</p></body></html>",
      { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }
}

function handleConfig(request) {
  return (async () => {
    const cache = await caches.open(CACHE_VERSION);

    try {
      const response = await fetch(request, { cache: "no-store" });
      if (response && response.ok) {
        await cache.put(request, response.clone()).catch(() => {});
        return response;
      }

      const cached = await cache.match(request, { ignoreSearch: true });
      return cached || response;
    } catch {
      const cached = await cache.match(request, { ignoreSearch: true });
      if (cached) return cached;

      return new Response("", {
        status: 504,
        statusText: "Offline",
      });
    }
  })();
}

function handleAsset(event) {
  const { request } = event;
  const cachePromise = caches.open(CACHE_VERSION);
  const cachedPromise = cachePromise.then((cache) => cache.match(request));

  const networkPromise = fetch(request)
    .then(async (response) => {
      if (response && (response.ok || response.type === "opaque")) {
        const cache = await cachePromise;
        await cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    })
    .catch(() => null);

  event.respondWith(
    (async () => {
      const cached = await cachedPromise;
      if (cached) return cached;

      const fresh = await networkPromise;
      if (fresh) return fresh;

      return new Response("", {
        status: 504,
        statusText: "Offline",
      });
    })(),
  );

  event.waitUntil(networkPromise.then(() => undefined));
}

/* -------------------------------------------------------------------------
   Firebase Cloud Messaging (background)
   ------------------------------------------------------------------------- */

const firebaseConfig = (self.APP_CONFIG && self.APP_CONFIG.firebase) || {};
const hasFirebaseConfig =
  firebaseConfig.apiKey &&
  !String(firebaseConfig.apiKey).includes("YOUR_") &&
  firebaseConfig.projectId &&
  firebaseConfig.messagingSenderId &&
  firebaseConfig.appId;

if (hasFirebaseConfig) {
  try {
    firebase.initializeApp(firebaseConfig);
    const messaging = firebase.messaging();

    messaging.onBackgroundMessage((payload) => {
      // Notification payloads are displayed by the SDK automatically.
      if (payload && payload.notification) return;

      const data = (payload && payload.data) || {};
      const title = data.title || "تنبيه جديد";
      const options = {
        body: data.body || "أحدهم يريد التواصل معك الآن.",
        icon: "./icons/icon-192.png",
        badge: "./icons/badge-72.png",
        dir: "rtl",
        lang: "ar",
        tag: "roomset-ping",
        renotify: true,
        vibrate: [120, 60, 120],
        data: { url: data.url || "./index.html" },
      };

      self.registration.showNotification(title, options);
    });
  } catch (error) {
    console.warn("[RoomSet SW] FCM init failed:", error);
  }
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const relativeUrl =
    (event.notification.data && event.notification.data.url) || "./index.html";

  let target;
  try {
    target = new URL(relativeUrl, self.registration.scope).href;
  } catch {
    target = new URL("./index.html", self.registration.scope).href;
  }

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      for (const client of clientList) {
        if (client.url.startsWith(self.registration.scope)) {
          await client.focus();
          client.postMessage({ type: "ROOMSET_NOTIFICATION_CLICK" });
          return;
        }
      }

      await self.clients.openWindow(target);
    })(),
  );
});

/**
 * Root Service Worker for colintan.dev Briefings PWA
 * Scope: / (Home, Daily Briefing, Weekly Briefing, Bookmarks)
 */

const SW_VERSION = "2026-11-28-9";
const STATIC_CACHE = `briefings-static-${SW_VERSION}`;
const DATA_CACHE = `briefings-data-${SW_VERSION}`;
const ARCHIVE_CACHE = `briefings-archive-${SW_VERSION}`;
const ACTIVE_CACHES = new Set([STATIC_CACHE, DATA_CACHE, ARCHIVE_CACHE]);
const MAX_ARCHIVE_ENTRIES = 60;

const PRECACHE_URLS = [
  "/",
  "/briefing/",
  "/weekly/",
  "/bookmarks/",
  "/manifest.json",
  "/favicon.svg?v=2",
  "/briefing/icon-192.png",
  "/briefing/icon-512.png",
  "/briefing/icon-512-maskable.png",
  "/shared/tokens.css?v=2",
  "/shared/auth.css?v=3",
  "/shared/briefing-base.css?v=17",
  "/shared/theme-boot.js?v=2",
  "/briefing/styles.css?v=64",
  "/weekly/styles.css?v=11",
  "/bookmarks/styles.css?v=5",
];

const BYPASS_PATH_RE = /^\/(?:auth|user|markets|s)(?:\/|$)/;
const ARCHIVE_JSON_RE = /^\/(briefing|weekly)\/data\/archive\/[^/]+\.json$/;
const MUTABLE_JSON_RE =
  /^\/(?:(?:briefing|weekly)\/data\/(?:latest|index|markets_live|country_leaders)\.json|shared\/data\/entities\/[^/]+\.json)$/;
const STATIC_ASSET_RE = /\.(?:css|js|svg|png|ico|webp|woff2)$/i;

const OFFLINE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="theme-color" content="#faf8f5">
  <title>Offline — colintan.dev Briefings</title>
  <style>
    :root { color-scheme: light dark; }
    body {
      margin: 0;
      min-height: 100svh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #faf8f5;
      color: #181a1f;
    }
    @media (prefers-color-scheme: dark) {
      body { background: #161b24; color: #eef0f4; }
      .card { background: #1d2430; border-color: #303a4d; }
      .btn { background: #e06d53; }
      .links a { color: #bcc4d2; }
    }
    .card {
      max-width: 420px;
      width: 100%;
      background: #ffffff;
      border: 1px solid #e4dfd6;
      border-top: 3px solid #a63a2b;
      border-radius: 8px;
      padding: 28px 24px;
      text-align: center;
    }
    h1 { margin: 0 0 10px; font-family: Georgia, serif; font-size: 24px; }
    p { margin: 0 0 20px; font-size: 14.5px; line-height: 1.55; opacity: 0.82; }
    .btn {
      display: inline-block;
      background: #a63a2b;
      color: #ffffff;
      text-decoration: none;
      font-weight: 600;
      font-size: 14px;
      padding: 10px 18px;
      border-radius: 5px;
    }
    .links {
      margin-top: 18px;
      display: flex;
      justify-content: center;
      gap: 14px;
      font-size: 13px;
    }
    .links a { color: #4a505c; text-decoration: none; }
    .links a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <main class="card">
    <h1>You&rsquo;re offline</h1>
    <p>This page isn&rsquo;t cached yet. Reconnect to load the latest edition, or open a previously visited briefing.</p>
    <a class="btn" href="">Try again</a>
    <div class="links">
      <a href="/briefing/?date=latest">Daily</a>
      <a href="/weekly/?date=latest">Weekly</a>
      <a href="/bookmarks/">Bookmarks</a>
    </div>
  </main>
</body>
</html>`;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      await Promise.allSettled(
        PRECACHE_URLS.map(async (url) => {
          try {
            const resp = await fetch(url, { cache: "no-cache", credentials: "same-origin" });
            if (resp && resp.ok) {
              await cache.put(url, resp);
            }
          } catch {
            // Resilient precache: ignore individual network failures
          }
        })
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.map((name) => (ACTIVE_CACHES.has(name) ? Promise.resolve() : caches.delete(name)))
      );
      await self.clients.claim();
    })()
  );
});

function canonicalShellUrl(url) {
  let pathname = url.pathname;
  if (pathname === "/index.html") {
    pathname = "/";
  } else if (pathname.endsWith("/index.html")) {
    pathname = pathname.slice(0, -"index.html".length);
  }
  return `${url.origin}${pathname}`;
}

async function purgeScriptsAndStyles(cache) {
  const keys = await cache.keys();
  await Promise.all(
    keys.map((req) => {
      try {
        const pathname = new URL(req.url).pathname;
        if (pathname.endsWith(".js") || pathname.endsWith(".css")) {
          return cache.delete(req);
        }
      } catch {
        // Ignore malformed cache keys
      }
      return Promise.resolve();
    })
  );
}

async function handleNavigation(request, url) {
  const cache = await caches.open(STATIC_CACHE);
  const shellKey = canonicalShellUrl(url);

  try {
    const resp = await fetch(url.href, {
      cache: "no-cache",
      credentials: "same-origin",
      redirect: "follow",
    });

    if (resp && resp.ok) {
      const prev = await cache.match(shellKey);
      const prevTag = prev
        ? prev.headers.get("etag") || prev.headers.get("last-modified") || ""
        : "";
      const nextTag = resp.headers.get("etag") || resp.headers.get("last-modified") || "";

      if (prev && prevTag && nextTag && prevTag !== nextTag) {
        await purgeScriptsAndStyles(cache);
      }

      await cache.put(shellKey, resp.clone());
      return resp;
    }

    const cached = await cache.match(shellKey);
    if (cached) return cached;
    return resp;
  } catch {
    const cached = await cache.match(shellKey);
    if (cached) return cached;

    return new Response(OFFLINE_HTML, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }
}

async function handleArchiveJson(event, request, url) {
  const cache = await caches.open(ARCHIVE_CACHE);
  const cacheKey = `${url.origin}${url.pathname}`;
  const cached = await cache.match(cacheKey);

  if (cached) {
    // True LRU touch: delete and re-insert at the tail
    const touchCopy = cached.clone();
    event.waitUntil(
      cache
        .delete(cacheKey)
        .then(() => cache.put(cacheKey, touchCopy))
        .catch(() => {})
    );
    return cached;
  }

  const resp = await fetch(request);
  if (resp && resp.ok) {
    await cache.put(cacheKey, resp.clone());
    const keys = await cache.keys();
    if (keys.length > MAX_ARCHIVE_ENTRIES) {
      const evictCount = keys.length - MAX_ARCHIVE_ENTRIES;
      await Promise.all(keys.slice(0, evictCount).map((k) => cache.delete(k)));
    }
  }
  return resp;
}

function withOfflineFallbackHeader(cachedResponse) {
  const headers = new Headers(cachedResponse.headers);
  headers.set("X-SW-Cache", "offline-fallback");
  return new Response(cachedResponse.body, {
    status: cachedResponse.status,
    statusText: cachedResponse.statusText,
    headers,
  });
}

async function handleMutableJson(request, url) {
  const cache = await caches.open(DATA_CACHE);
  const cacheKey = `${url.origin}${url.pathname}`;

  try {
    const resp = await fetch(request);
    if (resp && resp.ok) {
      await cache.put(cacheKey, resp.clone());
      return resp;
    }
    const cached = await cache.match(cacheKey);
    if (cached) return withOfflineFallbackHeader(cached);
    return resp;
  } catch {
    const cached = await cache.match(cacheKey);
    if (cached) return withOfflineFallbackHeader(cached);
    return new Response(JSON.stringify({ error: "offline" }), {
      status: 503,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
}

async function handleCodeAsset(request) {
  const cache = await caches.open(STATIC_CACHE);
  try {
    const resp = await fetch(request, { cache: "no-cache" });
    if (resp && resp.ok) {
      await cache.put(request, resp.clone());
      return resp;
    }
    const cached = await cache.match(request);
    return cached || resp;
  } catch {
    const cached = await cache.match(request);
    return cached || new Response("", { status: 504 });
  }
}

async function handleStaticAsset(event, request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);

  const networkPromise = fetch(request)
    .then(async (resp) => {
      if (resp && resp.ok) {
        await cache.put(request, resp.clone());
      }
      return resp;
    })
    .catch(() => null);

  if (cached) {
    event.waitUntil(networkPromise);
    return cached;
  }

  const resp = await networkPromise;
  if (resp) return resp;
  return new Response("", { status: 504 });
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;
  if (request.headers.has("authorization")) return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === "/sw.js") return;
  if (BYPASS_PATH_RE.test(url.pathname)) return;

  const isNavigation =
    request.mode === "navigate" ||
    request.destination === "document" ||
    url.pathname.endsWith("/") ||
    url.pathname.endsWith(".html");

  if (isNavigation) {
    event.respondWith(handleNavigation(request, url));
    return;
  }

  if (ARCHIVE_JSON_RE.test(url.pathname)) {
    event.respondWith(handleArchiveJson(event, request, url));
    return;
  }

  if (MUTABLE_JSON_RE.test(url.pathname)) {
    event.respondWith(handleMutableJson(request, url));
    return;
  }

  if (url.pathname.endsWith(".js") || url.pathname.endsWith(".css")) {
    event.respondWith(handleCodeAsset(request));
    return;
  }

  if (url.pathname === "/manifest.json" || STATIC_ASSET_RE.test(url.pathname)) {
    event.respondWith(handleStaticAsset(event, request));
  }
});

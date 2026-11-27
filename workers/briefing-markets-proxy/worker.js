/**
 * Cloudflare Worker: briefing-markets-proxy (KV + Cron Triggers)
 *
 * Stores and serves the full live market dataset (1D, 7D/5D, 30D sparklines,
 * 11 GICS sectors, and CNN Fear & Greed) in Cloudflare KV (`MARKETS_KV`),
 * completely replacing GitHub Actions pseudo-live market commits.
 *
 * Cron schedule (all well under Cloudflare's 50-subrequest free-tier limit):
 * - `* /5 * * * *`      : 1D intraday refresh for actively-trading symbols only (<= 29 subrequests)
 * - `3 * /2 * * *`      : 5D hourly (16 symbols) + CNN Fear & Greed (18 subrequests)
 * - `20 14,21 * * 1-5`  : 30D daily closes for all 27 symbols (29 subrequests)
 *
 * On-demand `GET /markets`:
 * - Default: serves full `markets:latest` snapshot directly from KV (<50ms, 0 Yahoo calls).
 * - `?force=1`: refreshes actively-trading symbols on demand (rate-limited to
 *   <= 3 fetches per symbol every 5 minutes; returns HTTP 429 when exceeded so
 *   the client cleanly falls back to public CORS relays).
 */

import {
  AuthError,
  deriveUid,
  extractBearerToken,
  maybeRefreshSession,
  mintSessionToken,
  verifyGoogleIdToken,
  verifySessionToken,
} from "./auth.js";
import {
  authSecurityHeaders,
  checkSlidingRateLimit,
  handleGetUserState,
  handlePutUserState,
  readJsonBody,
} from "./user_state.js";

const AUTH_ALLOWED_ORIGINS = new Set([
  "https://colintan.dev",
  "https://www.colintan.dev",
  "https://tzm41.github.io",
]);
const LOCALHOST_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;
const GOOGLE_AUTH_IP_WINDOW_SEC = 600; // 10 min
const GOOGLE_AUTH_IP_MAX = 15;
const GOOGLE_AUTH_MAX_BODY_BYTES = 16384;

const WATCHLIST_CONFIG = [
  { symbol: "^GSPC", name: "S&P 500", group: "Equity" },
  { symbol: "^IXIC", name: "Nasdaq", group: "Equity" },
  { symbol: "^DJI", name: "Dow Jones", group: "Equity" },
  { symbol: "^RUT", name: "Russell 2000", group: "Equity" },
  { symbol: "^VIX", name: "VIX", group: "Volatility" },
  { symbol: "^TNX", name: "US 10Y Yield", group: "Rates" },
  { symbol: "CL=F", name: "WTI Crude", group: "Commodities" },
  { symbol: "GC=F", name: "Gold", group: "Commodities" },
  { symbol: "BTC-USD", name: "Bitcoin", group: "Crypto" },
];

const BIG7_CONFIG = [
  { symbol: "AAPL", name: "Apple", group: "Big 7" },
  { symbol: "MSFT", name: "Microsoft", group: "Big 7" },
  { symbol: "GOOGL", name: "Alphabet", group: "Big 7" },
  { symbol: "AMZN", name: "Amazon", group: "Big 7" },
  { symbol: "NVDA", name: "Nvidia", group: "Big 7" },
  { symbol: "META", name: "Meta", group: "Big 7" },
  { symbol: "TSLA", name: "Tesla", group: "Big 7" },
];

const SECTORS_CONFIG = [
  { symbol: "XLK", name: "Technology" },
  { symbol: "XLF", name: "Financials" },
  { symbol: "XLV", name: "Health Care" },
  { symbol: "XLE", name: "Energy" },
  { symbol: "XLI", name: "Industrials" },
  { symbol: "XLY", name: "Cons. Discret." },
  { symbol: "XLP", name: "Cons. Staples" },
  { symbol: "XLU", name: "Utilities" },
  { symbol: "XLRE", name: "Real Estate" },
  { symbol: "XLB", name: "Materials" },
  { symbol: "XLC", name: "Comm. Services" },
];

const QUOTE_SYMBOLS = [...WATCHLIST_CONFIG, ...BIG7_CONFIG].map((c) => c.symbol);
const SECTOR_SYMBOLS = SECTORS_CONFIG.map((c) => c.symbol);
const ALL_SYMBOLS_LIST = [...QUOTE_SYMBOLS, ...SECTOR_SYMBOLS];
const ALLOWED_SYMBOLS = new Set(ALL_SYMBOLS_LIST);

const KV_KEY_LATEST = "markets:latest";
const RL_CACHE_KEY = new Request("https://rl.briefing-markets.internal/v3/all");
const RL_WINDOW_MS = 5 * 60 * 1000;
const RL_MAX_FETCHES = 3;

const YF_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Accept: "application/json",
};

const NY_PARTS_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function isUsMarketHolidayEt(y, m, d) {
  const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const fmt = (dt) => dt.toISOString().slice(0, 10);
  const obs = (mo, da) => {
    const dt = new Date(Date.UTC(y, mo - 1, da));
    const wd = dt.getUTCDay();
    if (wd === 6) dt.setUTCDate(dt.getUTCDate() - 1);
    else if (wd === 0) dt.setUTCDate(dt.getUTCDate() + 1);
    return fmt(dt);
  };
  const nth = (mo, wd, n) => {
    const dt = new Date(Date.UTC(y, mo - 1, 1));
    const off = (wd - dt.getUTCDay() + 7) % 7;
    dt.setUTCDate(1 + off + (n - 1) * 7);
    return fmt(dt);
  };
  const last = (mo, wd) => {
    const dt = new Date(Date.UTC(y, mo, 0));
    dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() - wd + 7) % 7));
    return fmt(dt);
  };
  return new Set([
    obs(1, 1),
    nth(1, 1, 3),
    nth(2, 1, 3),
    last(5, 1),
    obs(6, 19),
    obs(7, 4),
    nth(9, 1, 1),
    nth(11, 4, 4),
    obs(12, 25),
  ]).has(iso);
}

function isSymbolTradingNow(symbol, now = new Date()) {
  if (symbol === "BTC-USD") return true;
  const parts = Object.fromEntries(NY_PARTS_FMT.formatToParts(now).map((p) => [p.type, p.value]));
  const wd = parts.weekday;
  const mins = (Number(parts.hour) % 24) * 60 + Number(parts.minute);
  const isWeekend = wd === "Sat" || wd === "Sun";
  const isHoliday = isUsMarketHolidayEt(Number(parts.year), Number(parts.month), Number(parts.day));
  if (symbol === "CL=F" || symbol === "GC=F") {
    if (wd === "Sat") return false;
    if (wd === "Sun") return mins >= 18 * 60;
    if (wd === "Fri" && mins >= 17 * 60) return false;
    if (mins >= 17 * 60 && mins < 18 * 60) return false;
    if (isHoliday && mins >= 13 * 60) return false;
    return true;
  }
  if (symbol === "^VIX") {
    if (isWeekend) return false;
    const endMin = isHoliday ? 11 * 60 + 30 : 16 * 60 + 15;
    return mins >= 3 * 60 + 15 && mins <= endMin;
  }
  if (isWeekend || isHoliday) return false;
  return mins >= 4 * 60 && mins <= 20 * 60;
}

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  const allowed =
    origin === "https://tzm41.github.io" ||
    origin === "https://colintan.dev" ||
    origin === "https://www.colintan.dev" ||
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
  return {
    "Access-Control-Allow-Origin": allowed ? origin : "https://tzm41.github.io",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function isAllowedAuthOrigin(origin, env) {
  if (typeof origin !== "string" || !origin) return false;
  if (AUTH_ALLOWED_ORIGINS.has(origin)) return true;
  if (env?.ALLOW_LOCALHOST_CORS === "true" && LOCALHOST_ORIGIN_RE.test(origin)) {
    return true;
  }
  return false;
}

export function authCorsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, If-None-Match",
    "Access-Control-Expose-Headers": "ETag, Retry-After, X-Refreshed-Token",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (isAllowedAuthOrigin(origin, env)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function authJsonResponse(body, status, request, env, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...authCorsHeaders(request, env),
      ...authSecurityHeaders(extraHeaders),
    },
  });
}

function jsonResponse(body, status, request, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(request),
      ...extraHeaders,
    },
  });
}

function pctChange(cur, prev) {
  if (!Number.isFinite(cur) || !Number.isFinite(prev) || prev === 0) return 0;
  return Number((((cur - prev) / prev) * 100).toFixed(2));
}

function roundPrice(val, symbol) {
  return Number(Number(val).toFixed(symbol === "^TNX" ? 3 : 2));
}

function parseYahoo1D(symbol, payload) {
  const result = payload?.chart?.result?.[0];
  if (!result) return null;
  const meta = result.meta || {};
  const rawTimestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
  const rawCloses = result.indicators?.quote?.[0]?.close || [];
  const isRolling24h = symbol === "BTC-USD";
  const cutoffSec = isRolling24h ? Math.floor(Date.now() / 1000) - 86400 : 0;

  const valid = [];
  for (let i = 0; i < rawTimestamps.length; i++) {
    const ts = rawTimestamps[i];
    const v = rawCloses[i];
    if (v == null || !Number.isFinite(Number(v))) continue;
    if (isRolling24h && ts < cutoffSec) continue;
    valid.push([ts, Number(v)]);
  }

  const sparkVals = [];
  const sparkTimes = [];
  const step = valid.length > 96 ? Math.ceil(valid.length / 96) : 1;
  for (let i = 0; i < valid.length; i++) {
    if (i % step === 0 || i === valid.length - 1) {
      sparkVals.push(Number(valid[i][1].toFixed(4)));
      sparkTimes.push(new Date(valid[i][0] * 1000).toISOString());
    }
  }

  const lastBar = sparkVals.length ? sparkVals[sparkVals.length - 1] : null;
  const regularPrice =
    typeof meta.regularMarketPrice === "number" && Number.isFinite(meta.regularMarketPrice)
      ? meta.regularMarketPrice
      : null;
  const price =
    symbol === "^TNX" || symbol.startsWith("^") ? regularPrice ?? lastBar : lastBar ?? regularPrice;
  const prevClose = isRolling24h
    ? sparkVals.length
      ? sparkVals[0]
      : null
    : typeof meta.chartPreviousClose === "number" && meta.chartPreviousClose > 0
    ? meta.chartPreviousClose
    : typeof meta.previousClose === "number" && meta.previousClose > 0
    ? meta.previousClose
    : sparkVals.length
    ? sparkVals[0]
    : null;

  if (price == null || !Number.isFinite(price)) return null;
  return {
    symbol,
    price: roundPrice(price, symbol),
    change_pct: pctChange(price, prevClose),
    sparkline_1d: sparkVals,
    sparkline_1d_times: sparkTimes,
  };
}

function parseYahooSeries(symbol, payload, formatDateOnly = false, maxPoints = 96) {
  const result = payload?.chart?.result?.[0];
  if (!result) return null;
  const rawTimestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
  const rawCloses = result.indicators?.quote?.[0]?.close || [];
  const valid = [];
  for (let i = 0; i < rawTimestamps.length; i++) {
    const v = rawCloses[i];
    if (v == null || !Number.isFinite(Number(v))) continue;
    const iso = new Date(rawTimestamps[i] * 1000).toISOString();
    valid.push([formatDateOnly ? iso.slice(0, 10) : iso, Number(Number(v).toFixed(2))]);
  }
  const sliced = valid.slice(-maxPoints);
  if (sliced.length < 2) return null;
  return {
    symbol,
    values: sliced.map((x) => x[1]),
    times: sliced.map((x) => x[0]),
  };
}

async function fetchYahooChart(symbol, queryStr) {
  const yfUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol
  )}?${queryStr}`;
  try {
    const resp = await fetch(yfUrl, { headers: YF_HEADERS });
    if (!resp.ok) return { ok: false, status: resp.status, data: null };
    return { ok: true, status: 200, data: await resp.json() };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

async function fetchFearGreed() {
  try {
    const resp = await fetch("https://production.dataviz.cnn.io/index/fearandgreed/graphdata", {
      headers: YF_HEADERS,
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const fg = data?.fear_and_greed;
    if (!fg || fg.score == null) return null;
    return {
      score: Number(Number(fg.score).toFixed(1)),
      rating: String(fg.rating || "Neutral"),
      previous_close: fg.previous_close != null ? Number(Number(fg.previous_close).toFixed(1)) : null,
      previous_1_week: fg.previous_1_week != null ? Number(Number(fg.previous_1_week).toFixed(1)) : null,
      previous_1_month: fg.previous_1_month != null ? Number(Number(fg.previous_1_month).toFixed(1)) : null,
      previous_1_year: fg.previous_1_year != null ? Number(Number(fg.previous_1_year).toFixed(1)) : null,
    };
  } catch {
    return null;
  }
}

function emptyState() {
  return {
    updated_at: new Date().toISOString(),
    source: "cloudflare-kv",
    health: "ok",
    watchlist: WATCHLIST_CONFIG.map((c) => ({ ...c, price: 0, change_pct: 0, change_5d_pct: 0, change_30d_pct: 0, sparkline_1d: [], sparkline_1d_times: [], sparkline_5d: [], sparkline_5d_times: [], sparkline_30d: [], sparkline_30d_times: [] })),
    big7: BIG7_CONFIG.map((c) => ({ ...c, price: 0, change_pct: 0, change_5d_pct: 0, change_30d_pct: 0, sparkline_1d: [], sparkline_1d_times: [], sparkline_5d: [], sparkline_5d_times: [], sparkline_30d: [], sparkline_30d_times: [] })),
    sectors: SECTORS_CONFIG.map((c) => ({ ...c, change_pct: 0, change_5d_pct: 0, change_30d_pct: 0 })),
    fear_greed: null,
  };
}

async function loadState(env) {
  try {
    const stored = await env.MARKETS_KV.get(KV_KEY_LATEST, { type: "json" });
    if (stored && Array.isArray(stored.watchlist) && stored.watchlist.length) {
      return stored;
    }
  } catch {
    // Fall through to seed
  }
  // One-time bootstrap seed from GitHub Pages static snapshot if KV is empty
  try {
    const seedResp = await fetch("https://tzm41.github.io/briefing/data/markets_live.json");
    if (seedResp.ok) {
      const seed = await seedResp.json();
      if (seed && Array.isArray(seed.watchlist) && seed.watchlist.length) {
        seed.source = "cloudflare-kv";
        await env.MARKETS_KV.put(KV_KEY_LATEST, JSON.stringify(seed));
        return seed;
      }
    }
  } catch {
    // Fall back to empty state
  }
  return emptyState();
}

async function saveState(env, state) {
  state.updated_at = new Date().toISOString();
  state.source = "cloudflare-kv";
  try {
    await env.MARKETS_KV.put(KV_KEY_LATEST, JSON.stringify(state));
  } catch (err) {
    console.error("[markets] MARKETS_KV.put failed:", err?.message || err);
  }
}

function apply1DUpdates(state, map1d) {
  const patchList = (arr) =>
    (arr || []).map((item) => {
      const u = map1d[item.symbol];
      if (!u) return item;
      const s5 = Array.isArray(item.sparkline_5d) ? [...item.sparkline_5d] : [];
      const s30 = Array.isArray(item.sparkline_30d) ? [...item.sparkline_30d] : [];
      if (s5.length) s5[s5.length - 1] = u.price;
      if (s30.length) s30[s30.length - 1] = u.price;
      return {
        ...item,
        price: u.price,
        change_pct: u.change_pct,
        change_5d_pct: s5.length >= 2 ? pctChange(u.price, s5[0]) : item.change_5d_pct,
        change_30d_pct: s30.length >= 2 ? pctChange(u.price, s30[0]) : item.change_30d_pct,
        sparkline_1d: u.sparkline_1d.length >= 2 ? u.sparkline_1d : item.sparkline_1d,
        sparkline_1d_times: u.sparkline_1d_times.length >= 2 ? u.sparkline_1d_times : item.sparkline_1d_times,
        sparkline_5d: s5,
        sparkline_30d: s30,
      };
    });

  state.watchlist = patchList(state.watchlist);
  state.big7 = patchList(state.big7);
  state.sectors = (state.sectors || []).map((sec) => {
    const u = map1d[sec.symbol];
    return u ? { ...sec, change_pct: u.change_pct } : sec;
  });
}

async function runIntradayRefresh(env, requestedSymbols = null) {
  const state = await loadState(env);
  const pool = requestedSymbols || ALL_SYMBOLS_LIST;
  const active = pool.filter((sym) => isSymbolTradingNow(sym));
  if (!active.length) return { state, fetchedCount: 0, rateLimited: false };

  const results = await Promise.all(
    active.map(async (sym) => {
      const q = sym === "BTC-USD" ? "range=2d&interval=15m" : "range=1d&interval=5m&includePrePost=true";
      const res = await fetchYahooChart(sym, q);
      if (!res.ok) return { sym, parsed: null, rateLimited: res.status === 429 };
      return { sym, parsed: parseYahoo1D(sym, res.data), rateLimited: false };
    })
  );

  const map1d = {};
  let rateLimited = false;
  for (const r of results) {
    if (r.parsed) map1d[r.sym] = r.parsed;
    if (r.rateLimited) rateLimited = true;
  }

  const fetchedCount = Object.keys(map1d).length;
  if (fetchedCount > 0) {
    apply1DUpdates(state, map1d);
    await saveState(env, state);
  }
  return { state, fetchedCount, rateLimited };
}

async function run5DAndFearGreedRefresh(env) {
  const state = await loadState(env);
  const [seriesResults, fg] = await Promise.all([
    Promise.all(
      QUOTE_SYMBOLS.map(async (sym) => {
        const res = await fetchYahooChart(sym, "range=5d&interval=1h");
        return res.ok ? parseYahooSeries(sym, res.data, false, 120) : null;
      })
    ),
    fetchFearGreed(),
  ]);

  const map5d = {};
  for (const s of seriesResults) {
    if (s) map5d[s.symbol] = s;
  }

  const patch5d = (arr) =>
    (arr || []).map((item) => {
      const s = map5d[item.symbol];
      if (!s) return item;
      const latest = item.price || s.values[s.values.length - 1];
      return {
        ...item,
        change_5d_pct: pctChange(latest, s.values[0]),
        sparkline_5d: s.values,
        sparkline_5d_times: s.times,
      };
    });

  state.watchlist = patch5d(state.watchlist);
  state.big7 = patch5d(state.big7);
  if (fg) state.fear_greed = fg;
  await saveState(env, state);
}

async function run30DRefresh(env) {
  const state = await loadState(env);
  const seriesResults = await Promise.all(
    ALL_SYMBOLS_LIST.map(async (sym) => {
      const res = await fetchYahooChart(sym, "range=45d&interval=1d");
      return res.ok ? parseYahooSeries(sym, res.data, true, 30) : null;
    })
  );

  const map30d = {};
  for (const s of seriesResults) {
    if (s) map30d[s.symbol] = s;
  }

  const patch30d = (arr) =>
    (arr || []).map((item) => {
      const s = map30d[item.symbol];
      if (!s) return item;
      const latest = item.price || s.values[s.values.length - 1];
      return {
        ...item,
        change_30d_pct: pctChange(latest, s.values[0]),
        sparkline_30d: s.values,
        sparkline_30d_times: s.times,
      };
    });

  state.watchlist = patch30d(state.watchlist);
  state.big7 = patch30d(state.big7);
  state.sectors = (state.sectors || []).map((sec) => {
    const s = map30d[sec.symbol];
    if (!s || s.values.length < 2) return sec;
    const latest = s.values[s.values.length - 1];
    const prev1d = s.values[s.values.length - 2];
    const prev5d = s.values.length >= 6 ? s.values[s.values.length - 6] : s.values[0];
    return {
      ...sec,
      change_pct: pctChange(latest, prev1d),
      change_5d_pct: pctChange(latest, prev5d),
      change_30d_pct: pctChange(latest, s.values[0]),
    };
  });

  await saveState(env, state);
}

async function consumeRateLimit(cache, symbols) {
  const now = Date.now();
  let rlStore = {};
  const existing = await cache.match(RL_CACHE_KEY);
  if (existing) {
    try {
      rlStore = (await existing.json()) || {};
    } catch {
      rlStore = {};
    }
  }

  const allowed = [];
  let maxRetryAfter = 0;
  for (const sym of symbols) {
    const recent = Array.isArray(rlStore[sym])
      ? rlStore[sym].filter((t) => typeof t === "number" && now - t < RL_WINDOW_MS)
      : [];
    if (recent.length >= RL_MAX_FETCHES) {
      const oldest = Math.min(...recent);
      maxRetryAfter = Math.max(maxRetryAfter, Math.max(1, Math.ceil((oldest + RL_WINDOW_MS - now) / 1000)));
    } else {
      recent.push(now);
      rlStore[sym] = recent;
      allowed.push(sym);
    }
  }

  await cache.put(
    RL_CACHE_KEY,
    new Response(JSON.stringify(rlStore), {
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
    })
  );
  return { allowed, maxRetryAfter };
}

async function handleAuthAndUserRoutes(request, env, url) {
  const path = url.pathname;
  const method = request.method;

  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: authCorsHeaders(request, env) });
  }

  // Enforce strict Origin allowlist on state-changing auth/user endpoints
  if (method === "POST" || method === "PUT") {
    const origin = request.headers.get("Origin") || "";
    if (!isAllowedAuthOrigin(origin, env)) {
      return authJsonResponse(
        { error: "origin_not_allowed", message: "Request origin is not permitted." },
        403,
        request,
        env
      );
    }
  }

  try {
    if (path === "/auth/config") {
      if (method !== "GET") {
        return authJsonResponse({ error: "method_not_allowed" }, 405, request, env);
      }
      return authJsonResponse(
        {
          google_client_id: env?.GOOGLE_CLIENT_ID || "",
          sync_writes_enabled: env?.AUTH_SYNC_WRITES_ENABLED !== "false",
          open_signup: env?.AUTH_OPEN_SIGNUP !== "false",
        },
        200,
        request,
        env
      );
    }

    if (path === "/auth/google") {
      if (method !== "POST") {
        return authJsonResponse({ error: "method_not_allowed" }, 405, request, env);
      }

      const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
      const rl = await checkSlidingRateLimit(
        `https://rl.internal/v1/auth-google-ip/${encodeURIComponent(clientIp)}`,
        GOOGLE_AUTH_IP_WINDOW_SEC,
        GOOGLE_AUTH_IP_MAX,
        true
      );
      if (!rl.allowed) {
        return authJsonResponse(
          { error: "rate_limited", retry_after: rl.retryAfter },
          429,
          request,
          env,
          { "Retry-After": String(rl.retryAfter) }
        );
      }

      const parsed = await readJsonBody(request, GOOGLE_AUTH_MAX_BODY_BYTES);
      if (!parsed.ok) {
        return authJsonResponse(
          { error: parsed.error, message: parsed.message },
          parsed.status,
          request,
          env
        );
      }

      const credential = parsed.data?.credential ?? parsed.data?.id_token;
      if (typeof credential !== "string" || !credential.trim()) {
        return authJsonResponse(
          { error: "missing_credential", message: "Google ID token credential is required." },
          400,
          request,
          env
        );
      }

      const verified = await verifyGoogleIdToken(credential.trim(), env);
      const uid = await deriveUid(verified.sub);

      if (env?.AUTH_OPEN_SIGNUP === "false") {
        const existing = env?.USER_PREFS_KV
          ? await env.USER_PREFS_KV.get(`user:${uid}`).catch(() => null)
          : null;
        if (!existing) {
          return authJsonResponse(
            { error: "signup_disabled", message: "New account sign-ups are currently disabled." },
            403,
            request,
            env
          );
        }
      }

      const minted = await mintSessionToken(
        { uid, name: verified.name, picture: verified.picture },
        env
      );
      return authJsonResponse(
        {
          token: minted.token,
          expires_at: minted.payload.exp,
          user: {
            uid,
            name: minted.payload.name,
            picture: minted.payload.picture,
          },
        },
        200,
        request,
        env
      );
    }

    if (path === "/auth/me") {
      if (method !== "GET") {
        return authJsonResponse({ error: "method_not_allowed" }, 405, request, env);
      }
      const token = extractBearerToken(request);
      if (!token) {
        return authJsonResponse({ error: "unauthorized", message: "Missing Bearer token." }, 401, request, env);
      }
      const session = await verifySessionToken(token, env);
      const refreshed = await maybeRefreshSession(session, env);
      const extraHeaders = refreshed ? { "X-Refreshed-Token": refreshed.token } : {};
      return authJsonResponse(
        {
          user: {
            uid: session.uid,
            name: session.name,
            picture: session.picture,
          },
          expires_at: refreshed ? refreshed.exp : session.exp,
        },
        200,
        request,
        env,
        extraHeaders
      );
    }

    if (path === "/user/state") {
      if (method !== "GET" && method !== "PUT") {
        return authJsonResponse({ error: "method_not_allowed" }, 405, request, env);
      }
      const token = extractBearerToken(request);
      if (!token) {
        return authJsonResponse({ error: "unauthorized", message: "Missing Bearer token." }, 401, request, env);
      }
      const session = await verifySessionToken(token, env);
      const refreshed = await maybeRefreshSession(session, env);
      const cors = authCorsHeaders(request, env);
      if (method === "GET") {
        return await handleGetUserState(request, env, session, refreshed, cors);
      }
      return await handlePutUserState(request, env, session, refreshed, cors);
    }

    return authJsonResponse({ error: "not_found" }, 404, request, env);
  } catch (err) {
    if (err instanceof AuthError) {
      return authJsonResponse({ error: err.code, message: err.message }, err.status, request, env);
    }
    console.error("[auth] Unhandled error:", err?.message || err);
    return authJsonResponse({ error: "internal_error" }, 500, request, env);
  }
}

export default {
  async scheduled(controller, env, ctx) {
    const cron = controller.cron || "";
    if (cron === "3 */2 * * *") {
      ctx.waitUntil(run5DAndFearGreedRefresh(env));
    } else if (cron === "20 14,21 * * 1-5") {
      ctx.waitUntil(run30DRefresh(env));
    } else {
      // */5 * * * *: run every 5m when non-crypto markets trade;
      // when only BTC-USD is trading (weekends/holidays/break), throttle to every 15m (:00/:15/:30/:45)
      const now = new Date();
      const nonCryptoTrading = ALL_SYMBOLS_LIST.some(
        (sym) => sym !== "BTC-USD" && isSymbolTradingNow(sym, now)
      );
      if (!nonCryptoTrading && now.getUTCMinutes() % 15 !== 0) {
        return;
      }
      ctx.waitUntil(runIntradayRefresh(env));
    }
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/auth/") || url.pathname.startsWith("/user/")) {
      return handleAuthAndUserRoutes(request, env, url);
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }
    if (request.method !== "GET") {
      return jsonResponse({ error: "Method not allowed" }, 405, request);
    }

    if (url.pathname === "/health") {
      return jsonResponse({ ok: true, symbols: ALL_SYMBOLS_LIST.length, storage: "kv" }, 200, request);
    }

    if (url.pathname === "/markets" || url.pathname === "/") {
      const force = url.searchParams.get("force") === "1";
      const rawParam = url.searchParams.get("symbols");
      const requested = rawParam
        ? rawParam
            .split(",")
            .map((s) => s.trim())
            .filter((s) => ALLOWED_SYMBOLS.has(s))
        : null;

      if (force) {
        const active = (requested || ALL_SYMBOLS_LIST).filter((sym) => isSymbolTradingNow(sym));
        if (active.length) {
          const rl = await consumeRateLimit(caches.default, active);
          if (!rl.allowed.length) {
            return jsonResponse(
              {
                error: "rate_limited",
                message: "Cloudflare Worker per-symbol rate limit reached (max 3 fetches / 5 min).",
                retry_after: rl.maxRetryAfter || 60,
              },
              429,
              request,
              { "Retry-After": String(rl.maxRetryAfter || 60) }
            );
          }
          const { state } = await runIntradayRefresh(env, rl.allowed);
          return jsonResponse(state, 200, request, {
            "Cache-Control": "public, max-age=0",
            "X-RateLimit-Policy": `${RL_MAX_FETCHES};w=${RL_WINDOW_MS / 1000}`,
          });
        }
      }

      const state = await loadState(env);
      return jsonResponse(state, 200, request, {
        "Cache-Control": "public, max-age=60",
        "X-RateLimit-Policy": `${RL_MAX_FETCHES};w=${RL_WINDOW_MS / 1000}`,
      });
    }

    return jsonResponse({ error: "Not found" }, 404, request);
  },
};

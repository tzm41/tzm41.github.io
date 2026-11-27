/**
 * Cloudflare Worker: briefing-markets-proxy
 *
 * Proxies Yahoo Finance 1D intraday quotes + sparklines (including extended hours)
 * for tzm41.github.io/briefing/ (and colintan.dev/briefing/).
 *
 * Subrequest budget (Cloudflare Free tier = 50 subrequests/invocation):
 * - Uses 1 consolidated Edge Cache entry for all quotes (100s per-symbol TTL)
 *   and 1 consolidated Edge Cache entry for per-symbol 5-minute rate limits
 *   (max 3 upstream fetches per symbol every 5 minutes).
 * - Total subrequests for all 27 symbols <= 31 (well under 50).
 */

const ALLOWED_SYMBOLS = new Set([
  // Watchlist (9)
  "^GSPC",
  "^IXIC",
  "^DJI",
  "^RUT",
  "^VIX",
  "^TNX",
  "CL=F",
  "GC=F",
  "BTC-USD",
  // Magnificent 7 (7)
  "AAPL",
  "MSFT",
  "GOOGL",
  "AMZN",
  "NVDA",
  "META",
  "TSLA",
  // 11 GICS SPDR Sector ETFs
  "XLK",
  "XLF",
  "XLV",
  "XLE",
  "XLI",
  "XLY",
  "XLP",
  "XLU",
  "XLRE",
  "XLB",
  "XLC",
]);

const ALL_SYMBOLS_LIST = [...ALLOWED_SYMBOLS];
const SYMBOL_CACHE_TTL_MS = 100 * 1000; // 100s -> max 3 fetches per 5 min
const RL_WINDOW_MS = 5 * 60 * 1000;
const RL_MAX_FETCHES = 3;

const QUOTES_CACHE_KEY = new Request("https://quote.briefing-markets.internal/v2/all");
const RL_CACHE_KEY = new Request("https://rl.briefing-markets.internal/v2/all");

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

function parseYahooChart(symbol, payload) {
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
    symbol === "^TNX" || symbol.startsWith("^")
      ? regularPrice ?? lastBar
      : lastBar ?? regularPrice;

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

  const changePct =
    prevClose && prevClose > 0 ? Number((((price - prevClose) / prevClose) * 100).toFixed(2)) : 0;

  return {
    symbol,
    price: Number(price.toFixed(symbol === "^TNX" ? 3 : 2)),
    change_pct: changePct,
    sparkline_1d: sparkVals,
    sparkline_1d_times: sparkTimes,
    market_state: meta.marketState || null,
  };
}

async function fetchYahooOne(symbol) {
  const isRolling24h = symbol === "BTC-USD";
  const rangeParams = isRolling24h
    ? "range=2d&interval=15m"
    : "range=1d&interval=5m&includePrePost=true";
  const yfUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol
  )}?${rangeParams}`;
  try {
    const resp = await fetch(yfUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        Accept: "application/json",
      },
    });
    if (!resp.ok) return { symbol, quote: null, rateLimited: resp.status === 429 };
    const payload = await resp.json();
    return { symbol, quote: parseYahooChart(symbol, payload), rateLimited: false };
  } catch {
    return { symbol, quote: null, rateLimited: false };
  }
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }
    if (request.method !== "GET") {
      return jsonResponse({ error: "Method not allowed" }, 405, request);
    }

    const url = new URL(request.url);
    const cache = caches.default;

    if (url.pathname === "/health") {
      return jsonResponse({ ok: true, symbols: ALL_SYMBOLS_LIST.length }, 200, request);
    }

    if (url.pathname === "/markets" || url.pathname === "/") {
      const rawParam = url.searchParams.get("symbols");
      const force = url.searchParams.get("force") === "1";
      const requested = rawParam
        ? rawParam
            .split(",")
            .map((s) => s.trim())
            .filter((s) => ALLOWED_SYMBOLS.has(s))
        : ALL_SYMBOLS_LIST;

      if (!requested.length) {
        return jsonResponse({ error: "No valid symbols requested" }, 400, request);
      }

      const now = Date.now();
      const [cachedQuotesResp, rlResp] = await Promise.all([
        cache.match(QUOTES_CACHE_KEY),
        cache.match(RL_CACHE_KEY),
      ]);

      let quoteStore = {};
      if (cachedQuotesResp) {
        try {
          quoteStore = (await cachedQuotesResp.json()) || {};
        } catch {
          quoteStore = {};
        }
      }

      let rlStore = {};
      if (rlResp) {
        try {
          rlStore = (await rlResp.json()) || {};
        } catch {
          rlStore = {};
        }
      }

      const quotes = {};
      const toFetch = [];
      let cacheHits = 0;
      let rateLimitedCount = 0;
      let maxRetryAfter = 0;

      for (const sym of requested) {
        const entry = quoteStore[sym];
        if (!force && entry?.quote && typeof entry.ts === "number" && now - entry.ts < SYMBOL_CACHE_TTL_MS) {
          quotes[sym] = entry.quote;
          cacheHits += 1;
          continue;
        }
        const recent = Array.isArray(rlStore[sym])
          ? rlStore[sym].filter((t) => typeof t === "number" && now - t < RL_WINDOW_MS)
          : [];
        rlStore[sym] = recent;
        if (recent.length >= RL_MAX_FETCHES) {
          rateLimitedCount += 1;
          const oldest = Math.min(...recent);
          maxRetryAfter = Math.max(maxRetryAfter, Math.max(1, Math.ceil((oldest + RL_WINDOW_MS - now) / 1000)));
        } else {
          recent.push(now);
          toFetch.push(sym);
        }
      }

      if (toFetch.length > 0) {
        const fetched = await Promise.all(toFetch.map(fetchYahooOne));
        for (const r of fetched) {
          if (r.quote) {
            quotes[r.symbol] = r.quote;
            quoteStore[r.symbol] = { quote: r.quote, ts: now };
          } else if (r.rateLimited) {
            rateLimitedCount += 1;
            maxRetryAfter = Math.max(maxRetryAfter, 60);
          }
        }

        ctx.waitUntil(
          Promise.all([
            cache.put(
              QUOTES_CACHE_KEY,
              new Response(JSON.stringify(quoteStore), {
                headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
              })
            ),
            cache.put(
              RL_CACHE_KEY,
              new Response(JSON.stringify(rlStore), {
                headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
              })
            ),
          ])
        );
      }

      const quoteCount = Object.keys(quotes).length;
      if (quoteCount === 0 && rateLimitedCount > 0) {
        return jsonResponse(
          {
            error: "rate_limited",
            message: "Cloudflare Worker per-symbol rate limit reached (max 3 fetches / 5 min).",
            retry_after: maxRetryAfter,
          },
          429,
          request,
          { "Retry-After": String(maxRetryAfter) }
        );
      }

      return jsonResponse(
        {
          updated_at: new Date().toISOString(),
          source: "cloudflare",
          count: quoteCount,
          cache_hits: cacheHits,
          rate_limited_count: rateLimitedCount,
          quotes,
        },
        200,
        request,
        {
          "Cache-Control": `public, max-age=${force ? 0 : 60}`,
          "X-RateLimit-Policy": `${RL_MAX_FETCHES};w=${RL_WINDOW_MS / 1000}`,
        }
      );
    }

    return jsonResponse({ error: "Not found" }, 404, request);
  },
};

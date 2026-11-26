/**
 * Cloudflare Worker: briefing-markets-proxy
 *
 * Proxies Yahoo Finance 1D intraday quotes + sparklines (including extended hours)
 * for the tzm41.github.io/briefing/ dashboard.
 *
 * Rate limiting:
 * - At most 3 upstream Yahoo Finance fetches per symbol every 5 minutes (300s),
 *   enforced via Cloudflare Edge Cache (100s per-symbol TTL) + a 5-minute
 *   sliding-window counter per symbol. Returns HTTP 429 when limit is exceeded
 *   so the client can cleanly fall back to a public CORS proxy.
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
const SYMBOL_CACHE_TTL_SEC = 100; // 300s / 3 = 100s -> max 3 fetches per 5 min
const RL_WINDOW_MS = 5 * 60 * 1000;
const RL_MAX_FETCHES = 3;

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  const allowed =
    origin === "https://tzm41.github.io" ||
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
  const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
  const closes = result.indicators?.quote?.[0]?.close || [];

  const sparkVals = [];
  const sparkTimes = [];
  const step = timestamps.length > 96 ? Math.ceil(timestamps.length / 96) : 1;
  for (let i = 0; i < timestamps.length; i++) {
    const v = closes[i];
    if (v == null || !Number.isFinite(Number(v))) continue;
    if (i % step === 0 || i === timestamps.length - 1) {
      sparkVals.push(Number(Number(v).toFixed(4)));
      sparkTimes.push(new Date(timestamps[i] * 1000).toISOString());
    }
  }

  const lastBar = sparkVals.length ? sparkVals[sparkVals.length - 1] : null;
  const regularPrice =
    typeof meta.regularMarketPrice === "number" && Number.isFinite(meta.regularMarketPrice)
      ? meta.regularMarketPrice
      : null;
  // Prefer extended-hours last bar if available for equities, else regularMarketPrice
  const price =
    symbol === "^TNX" || symbol.startsWith("^")
      ? regularPrice ?? lastBar
      : lastBar ?? regularPrice;

  const prevClose =
    typeof meta.chartPreviousClose === "number" && meta.chartPreviousClose > 0
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

async function checkAndConsumeSymbolRateLimit(cache, symbol) {
  const rlKey = new Request(`https://rl.briefing-markets.internal/v1/${encodeURIComponent(symbol)}`);
  const now = Date.now();
  let timestamps = [];
  const existing = await cache.match(rlKey);
  if (existing) {
    try {
      const data = await existing.json();
      if (Array.isArray(data?.timestamps)) {
        timestamps = data.timestamps.filter((t) => typeof t === "number" && now - t < RL_WINDOW_MS);
      }
    } catch {
      timestamps = [];
    }
  }

  if (timestamps.length >= RL_MAX_FETCHES) {
    const oldest = Math.min(...timestamps);
    const retryAfter = Math.max(1, Math.ceil((oldest + RL_WINDOW_MS - now) / 1000));
    return { allowed: false, remaining: 0, retryAfter };
  }

  timestamps.push(now);
  await cache.put(
    rlKey,
    new Response(JSON.stringify({ timestamps }), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `public, max-age=${Math.ceil(RL_WINDOW_MS / 1000)}`,
      },
    })
  );
  return { allowed: true, remaining: Math.max(0, RL_MAX_FETCHES - timestamps.length), retryAfter: 0 };
}

async function fetchSymbolQuote(cache, symbol, bypassQuoteCache = false) {
  const cacheKey = new Request(
    `https://quote.briefing-markets.internal/v1/${encodeURIComponent(symbol)}`
  );

  if (!bypassQuoteCache) {
    const cached = await cache.match(cacheKey);
    if (cached) {
      const data = await cached.json();
      return { quote: data, cached: true, rateLimited: false, retryAfter: 0 };
    }
  }

  const rl = await checkAndConsumeSymbolRateLimit(cache, symbol);
  if (!rl.allowed) {
    // Even if bypass was requested, serve stale cached value only if not bypassing; otherwise signal 429
    return { quote: null, cached: false, rateLimited: true, retryAfter: rl.retryAfter };
  }

  const yfUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol
  )}?range=1d&interval=5m&includePrePost=true`;

  try {
    const resp = await fetch(yfUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        Accept: "application/json",
      },
    });
    if (!resp.ok) {
      return { quote: null, cached: false, rateLimited: resp.status === 429, retryAfter: 60 };
    }
    const payload = await resp.json();
    const parsed = parseYahooChart(symbol, payload);
    if (!parsed) {
      return { quote: null, cached: false, rateLimited: false, retryAfter: 0 };
    }

    await cache.put(
      cacheKey,
      new Response(JSON.stringify(parsed), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": `public, max-age=${SYMBOL_CACHE_TTL_SEC}`,
        },
      })
    );
    return { quote: parsed, cached: false, rateLimited: false, retryAfter: 0 };
  } catch {
    return { quote: null, cached: false, rateLimited: false, retryAfter: 0 };
  }
}

export default {
  async fetch(request) {
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

      const results = await Promise.all(
        requested.map((sym) => fetchSymbolQuote(cache, sym, force))
      );

      const quotes = {};
      let rateLimitedCount = 0;
      let maxRetryAfter = 0;
      let cacheHits = 0;

      for (const r of results) {
        if (r.quote) quotes[r.quote.symbol] = r.quote;
        if (r.cached) cacheHits += 1;
        if (r.rateLimited) {
          rateLimitedCount += 1;
          maxRetryAfter = Math.max(maxRetryAfter, r.retryAfter || 60);
        }
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

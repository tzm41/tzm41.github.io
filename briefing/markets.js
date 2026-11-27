/**
 * Daily Briefing — Markets, Live Cloudflare KV / CORS Proxy, Sparklines & Sector Heatmap
 */

import { escapeHtml, readJsonStorage, writeJsonStorage } from "../shared/utils.js";
import { COMPANY_LOGOS, renderCompanyLogoImg } from "../shared/entities.js";

export function fmtPct(val) {
  const num = Number(val ?? 0);
  const sign = num > 0 ? "+" : "";
  return `${sign}${num.toFixed(2)}%`;
}


export function fmtPrice(price, symbol) {
  const num = Number(price ?? 0);
  if (symbol === "^TNX") return `${num.toFixed(2)}%`;
  if (num >= 1000) return num.toLocaleString("en-US", { maximumFractionDigits: 1 });
  return num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}


export function deltaClass(val) {
  const num = Number(val ?? 0);
  if (num > 0.02) return "pos";
  if (num < -0.02) return "neg";
  return "flat";
}


const NY_TIME_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour12: false,
  hour: "2-digit",
  minute: "2-digit",
});

function getNyMinutes(isoStr) {
  if (!isoStr || isoStr.length <= 10) return null;
  const dt = new Date(isoStr);
  if (Number.isNaN(dt.getTime())) return null;
  const parts = NY_TIME_FMT.formatToParts(dt);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

function computeSparklineLayout(values, times, tf, symbol) {
  const w = 120;
  const n = values.length;
  if (n < 2) return { xs: [], closeX: null, isExtended: [] };

  const isRolling24h = symbol === "BTC-USD";
  const isFullDayEt = symbol === "CL=F" || symbol === "GC=F";
  if (tf === "1d" && Array.isArray(times) && times.length === n && !isRolling24h) {
    const mins = times.map(getNyMinutes);
    const isMonotonicSingleDay =
      mins.every((m) => m !== null) && mins.every((m, i) => i === 0 || m >= mins[i - 1]);
    if (isMonotonicSingleDay) {
      if (isFullDayEt) {
        // WTI Crude & Gold futures (CME Globex): anchor to first bar (snap to left, avoiding
        // holiday/delayed-open left gaps), track progress to 5:00 PM ET close (or midnight if
        // evening Globex bars past 6:00 PM ET exist), and snap edge-to-edge once closed (>30m).
        const lastMs = Date.parse(times[times.length - 1] || "");
        const sessionClosed = !Number.isNaN(lastMs) && Date.now() - lastMs > 30 * 60 * 1000;
        const minMin = Math.min(...mins);
        const maxMin = Math.max(...mins);
        const startMin = minMin;
        const targetClose = maxMin >= 1080 ? 1440 : 1020;
        const endMin = sessionClosed ? Math.max(maxMin, minMin + 1) : Math.max(maxMin, targetClose);
        const spanMin = Math.max(60, endMin - startMin);
        const xs = mins.map((m) => Math.max(0, Math.min(w, ((m - startMin) / spanMin) * w)));
        return { xs, closeX: null, isExtended: mins.map(() => false) };
      }
      const maxMin = Math.max(...mins);
      const minMin = Math.min(...mins);
      const isTnx = symbol === "^TNX";
      const isVix = symbol === "^VIX";
      if (isTnx) {
        // US 10Y Treasury yields: anchor to first bar (8:20 AM live or 9:30 AM static),
        // and span edge-to-edge once the session is closed (>30m since last bar)
        const lastMs = Date.parse(times[times.length - 1] || "");
        const sessionClosed = !Number.isNaN(lastMs) && Date.now() - lastMs > 30 * 60 * 1000;
        const startMin = minMin;
        const endMin = sessionClosed ? Math.max(maxMin, minMin + 1) : Math.max(maxMin, 900);
        const spanMin = Math.max(60, endMin - startMin);
        const xs = mins.map((m) => Math.max(0, Math.min(w, ((m - startMin) / spanMin) * w)));
        return { xs, closeX: null, isExtended: mins.map(() => false) };
      }
      if (isVix) {
        // CBOE VIX trades global hours (3:15 AM–4:15 PM ET) with early holiday closes;
        // fill edge-to-edge once session is closed (>30m since last bar)
        const lastMs = Date.parse(times[times.length - 1] || "");
        const sessionClosed = !Number.isNaN(lastMs) && Date.now() - lastMs > 30 * 60 * 1000;
        const startMin = minMin;
        const endMin = sessionClosed ? Math.max(maxMin, minMin + 1) : Math.max(maxMin, 975);
        const spanMin = Math.max(60, endMin - startMin);
        const xs = mins.map((m) => Math.max(0, Math.min(w, ((m - startMin) / spanMin) * w)));
        return { xs, closeX: null, isExtended: mins.map(() => false) };
      }
      const startMin = minMin < 570 ? Math.min(minMin, 240) : 570; // 9:30 AM ET (or 4:00 AM if pre-market)
      const hasPreMarket = minMin < 570;
      const hasAfterHours = maxMin > 960;
      const endMin = hasAfterHours ? 1200 : 960; // equities 4:00 / 8:00 PM ET
      const spanMin = Math.max(60, endMin - startMin);
      const xs = mins.map((m) => Math.max(0, Math.min(w, ((m - startMin) / spanMin) * w)));
      const openX = hasPreMarket ? ((570 - startMin) / spanMin) * w : null;
      const closeX = hasAfterHours ? ((960 - startMin) / spanMin) * w : null;
      const isExtended = mins.map((m) => m > 960 || m < 570);
      return { xs, openX, closeX, isExtended };
    }
  }

  const xs = values.map((_, i) => (i / (n - 1)) * w);
  return { xs, closeX: null, isExtended: values.map(() => false) };
}


export function buildSparklineSvg(
  values,
  color,
  className = "sparkline",
  interactive = false,
  layout = null
) {
  if (!Array.isArray(values) || values.length < 2) {
    return `<svg class="${className}" viewBox="0 0 120 32" aria-hidden="true"><line x1="0" y1="16" x2="120" y2="16" stroke="currentColor" stroke-opacity="0.2" stroke-dasharray="3 3"/></svg>`;
  }
  const w = 120;
  const h = 32;
  const pad = 3;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const xs =
    layout?.xs && layout.xs.length === values.length
      ? layout.xs
      : values.map((_, i) => (i / (values.length - 1)) * w);
  const isExt =
    layout?.isExtended && layout.isExtended.length === values.length
      ? layout.isExtended
      : values.map(() => false);

  const coords = values.map((v, i) => [
    xs[i],
    h - pad - ((v - min) / span) * (h - pad * 2),
  ]);

  const toPoly = (arr) => arr.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const toArea = (arr) =>
    arr.length >= 2
      ? `${arr[0][0].toFixed(1)},${h} ${toPoly(arr)} ${arr[arr.length - 1][0].toFixed(1)},${h}`
      : "";

  let shapesHtml = "";
  let runStart = 0;
  while (runStart < coords.length) {
    const ext = Boolean(isExt[runStart]);
    let runEnd = runStart + 1;
    while (runEnd < coords.length && Boolean(isExt[runEnd]) === ext) runEnd += 1;
    const segStart = runStart > 0 ? runStart - 1 : runStart;
    const seg = coords.slice(segStart, runEnd);
    if (seg.length >= 2) {
      shapesHtml += `
        <polygon points="${toArea(seg)}" fill="${color}" fill-opacity="${ext ? "0.05" : "0.12"}"></polygon>
        <polyline points="${toPoly(seg)}" fill="none" stroke="${color}" stroke-opacity="${ext ? "0.45" : "1"}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></polyline>
      `;
    }
    runStart = runEnd;
  }

  const openLineHtml =
    layout?.openX != null
      ? `<line class="spark-close-line" x1="${layout.openX.toFixed(1)}" y1="0" x2="${layout.openX.toFixed(1)}" y2="${h}"></line>`
      : "";
  const closeLineHtml =
    layout?.closeX != null
      ? `<line class="spark-close-line" x1="${layout.closeX.toFixed(1)}" y1="0" x2="${layout.closeX.toFixed(1)}" y2="${h}"></line>`
      : "";

  if (!interactive) {
    return `
      <svg class="${className}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
        ${openLineHtml}${closeLineHtml}
        ${shapesHtml}
      </svg>
    `;
  }

  return `
    <svg class="${className}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
      ${openLineHtml}${closeLineHtml}
      ${shapesHtml}
      <line class="spark-guide" x1="0" y1="0" x2="0" y2="${h}"></line>
    </svg>
    <span class="spark-dot" style="background:${color}" aria-hidden="true"></span>
  `;
}


function sectorTileStyle(pct) {
  const clamped = Math.max(-3.5, Math.min(3.5, Number(pct ?? 0)));
  const intensity = Math.abs(clamped) / 3.5;
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";

  if (Math.abs(clamped) < 0.08) {
    return isDark
      ? "background:#222832; color:#d8dce4;"
      : "background:#eceae4; color:#2b303a;";
  }

  if (clamped > 0) {
    const alpha = (0.14 + intensity * 0.48).toFixed(2);
    const text = intensity > 0.55 ? "#ffffff" : isDark ? "#b8f2d8" : "#0e4d2f";
    return `background:rgba(21, 115, 71, ${alpha}); color:${text};`;
  } else {
    const alpha = (0.14 + intensity * 0.48).toFixed(2);
    const text = intensity > 0.55 ? "#ffffff" : isDark ? "#ffd2cc" : "#6e1c14";
    return `background:rgba(185, 56, 44, ${alpha}); color:${text};`;
  }
}

/* ---------- Rendering ---------- */


function getTimeframeValue(item, tf) {
  if (tf === "30d") return item.change_30d_pct ?? item.change_5d_pct ?? item.change_pct;
  if (tf === "5d") return item.change_5d_pct ?? item.change_pct;
  return item.change_pct;
}

function getSparklineData(q, tf) {
  if (tf === "1d") {
    if (Array.isArray(q.sparkline_1d) && q.sparkline_1d.length >= 2) {
      return { values: q.sparkline_1d, times: q.sparkline_1d_times || [] };
    }
    return { values: Array.isArray(q.sparkline_30d) ? q.sparkline_30d : [], times: q.sparkline_30d_times || [] };
  }
  if (tf === "5d") {
    if (Array.isArray(q.sparkline_5d) && q.sparkline_5d.length >= 2) {
      return { values: q.sparkline_5d, times: q.sparkline_5d_times || [] };
    }
    return {
      values: Array.isArray(q.sparkline_30d) ? q.sparkline_30d.slice(-6) : [],
      times: Array.isArray(q.sparkline_30d_times) ? q.sparkline_30d_times.slice(-6) : [],
    };
  }
  return {
    values: Array.isArray(q.sparkline_30d) ? q.sparkline_30d : [],
    times: q.sparkline_30d_times || [],
  };
}

function fmtSparkTime(raw, kind) {
  if (!raw) return "";
  if (raw.length === 10 && raw[4] === "-") {
    const [y, m, d] = raw.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  }
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return raw;
  if (kind === "1d") {
    return dt.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  if (kind === "5d") {
    return dt.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric" });
  }
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const NY_DATE_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function getPriorSessionBadge(times, tf, state) {
  if (tf !== "1d" || !Array.isArray(times) || !times.length) return null;
  const lastRaw = times[times.length - 1];
  if (!lastRaw) return null;
  const lastDt = new Date(lastRaw);
  if (Number.isNaN(lastDt.getTime())) return null;
  const lastEt = NY_DATE_FMT.format(lastDt);
  const refEt = state?.viewingLatest
    ? NY_DATE_FMT.format(new Date())
    : String(state?.briefing?.date || "").slice(0, 10);
  if (!refEt || lastEt >= refEt) return null;
  const diffDays = Math.round((Date.parse(`${refEt}T00:00:00Z`) - Date.parse(`${lastEt}T00:00:00Z`)) / 86400000);
  const shortDate = lastDt.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });
  return {
    label: `-${diffDays}D`,
    title: `Market closed today · showing ${shortDate} session`,
  };
}


const CF_MARKETS_PROXY_URL = "https://briefing-markets-proxy.tzm41.workers.dev/markets";
const LIVE_CACHE_KEY = "briefing-live-markets-cache-v3";
const CF_RL_KEY = "briefing-cf-rl-v1";
const LIVE_CACHE_TTL_MS = 100 * 1000; // 100s TTL -> max 3 fetches per 5 min
const CF_RL_WINDOW_MS = 5 * 60 * 1000;
const CF_RL_MAX_PER_SYMBOL = 3;

function canCallCloudflare(symbols) {
  const now = Date.now();
  const map = readJsonStorage(CF_RL_KEY) || {};
  return symbols.every((sym) => {
    const arr = Array.isArray(map[sym])
      ? map[sym].filter((t) => typeof t === "number" && now - t < CF_RL_WINDOW_MS)
      : [];
    return arr.length < CF_RL_MAX_PER_SYMBOL;
  });
}

function recordCloudflareFetch(symbols) {
  const now = Date.now();
  const map = readJsonStorage(CF_RL_KEY) || {};
  const next = {};
  for (const sym of symbols) {
    const arr = Array.isArray(map[sym])
      ? map[sym].filter((t) => typeof t === "number" && now - t < CF_RL_WINDOW_MS)
      : [];
    arr.push(now);
    next[sym] = arr;
  }
  writeJsonStorage(CF_RL_KEY, next);
}

function parseYahooChartClient(symbol, payload) {
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
  };
}

async function fetchSymbolViaPublicCors(symbol) {
  const isRolling24h = symbol === "BTC-USD";
  const rangeParams = isRolling24h
    ? "range=2d&interval=15m"
    : "range=1d&interval=5m&includePrePost=true";
  const yfUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol
  )}?${rangeParams}`;
  const relays = [
    `https://api.allorigins.win/raw?url=${encodeURIComponent(yfUrl)}`,
    `https://corsproxy.io/?url=${encodeURIComponent(yfUrl)}`,
  ];
  for (const relayUrl of relays) {
    try {
      const ctrl = new AbortController();
      const timer = window.setTimeout(() => ctrl.abort(), 6500);
      const resp = await fetch(relayUrl, { signal: ctrl.signal, cache: "no-store" });
      window.clearTimeout(timer);
      if (!resp.ok) continue;
      const payload = await resp.json();
      const parsed = parseYahooChartClient(symbol, payload);
      if (parsed) return parsed;
    } catch {
      // Try next public relay
    }
  }
  return null;
}

async function fetchViaPublicCorsFallback(symbols) {
  const quotes = {};
  const batchSize = 6;
  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(fetchSymbolViaPublicCors));
    for (const q of results) {
      if (q) quotes[q.symbol] = q;
    }
  }
  if (!Object.keys(quotes).length) return null;
  return {
    updated_at: new Date().toISOString(),
    fetched_at_ms: Date.now(),
    source: "cors-fallback",
    quotes,
  };
}

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
  const holidays = new Set([
    obs(1, 1),
    nth(1, 1, 3),
    nth(2, 1, 3),
    last(5, 1),
    obs(6, 19),
    obs(7, 4),
    nth(9, 1, 1),
    nth(11, 4, 4),
    obs(12, 25),
  ]);
  return holidays.has(iso);
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

export function createMarketsController({
  state,
  els,
  dataBase = "./data",
  highlightSummaryHtml,
  buildTickerMap,
  formatTickerTip,
  onQuotesPatched,
}) {
  const DATA_BASE = dataBase;

  function renderQuoteGrid(container, quotes, tf, emptyMsg) {
    if (!quotes.length) {
      container.innerHTML = `<div class="empty-state">${escapeHtml(emptyMsg)}</div>`;
      return;
    }
    container.innerHTML = quotes
      .map((q) => {
        const pct = getTimeframeValue(q, tf);
        const cls = deltaClass(pct);
        const stroke =
          cls === "pos"
            ? "var(--pos)"
            : cls === "neg"
            ? "var(--neg)"
            : "var(--ink-muted)";
        const { values: series, times } = getSparklineData(q, tf);
        const layout = computeSparklineLayout(series, times, tf, q.symbol);
        const logoDomain = COMPANY_LOGOS[q.name];
        const logoHtml = logoDomain ? renderCompanyLogoImg(logoDomain) : "";
        const domainAttr = logoDomain ? ` data-company-domain="${escapeHtml(logoDomain)}"` : "";
        const isExpanded = state.expandedQuoteSymbol === q.symbol;
        const hi = series.length ? fmtPrice(Math.max(...series), q.symbol) : "—";
        const lo = series.length ? fmtPrice(Math.min(...series), q.symbol) : "—";
        const prevBadge = getPriorSessionBadge(times, tf, state);
        const prevBadgeHtml = prevBadge
          ? `<span class="quote-prev-badge" tabindex="0" data-tooltip="${escapeHtml(prevBadge.title)}">${escapeHtml(prevBadge.label)}</span>`
          : "";
        return `
          <div class="quote-card${isExpanded ? " is-expanded" : ""}" data-symbol="${escapeHtml(q.symbol)}" role="button" tabindex="0" aria-expanded="${isExpanded}">
            <div class="quote-top">
              <span class="quote-name"${domainAttr}>${logoHtml}${escapeHtml(q.name)}</span>
              <span class="quote-top-right">${prevBadgeHtml}<span class="quote-sym">${escapeHtml(q.symbol)}</span></span>
            </div>
            <div class="quote-mid">
              <span class="quote-price">${fmtPrice(q.price, q.symbol)}</span>
              <span class="delta-pill ${cls}">${fmtPct(pct)}</span>
            </div>
            <div class="sparkline-wrap" data-kind="${escapeHtml(tf)}" data-symbol="${escapeHtml(q.symbol)}" data-values="${escapeHtml(JSON.stringify(series))}" data-times="${escapeHtml(JSON.stringify(times))}" data-xs="${escapeHtml(JSON.stringify(layout.xs.map((x) => Number(x.toFixed(2)))))}">
              <div class="spark-tooltip hidden"></div>
              ${buildSparklineSvg(series, stroke, "sparkline", true, layout)}
            </div>
            <div class="quote-expanded-stats">
              <div class="quote-stat"><span class="quote-stat-label">1D</span><span class="quote-stat-val ${deltaClass(q.change_pct)}">${fmtPct(q.change_pct)}</span></div>
              <div class="quote-stat"><span class="quote-stat-label">7D</span><span class="quote-stat-val ${deltaClass(q.change_5d_pct)}">${fmtPct(q.change_5d_pct)}</span></div>
              <div class="quote-stat"><span class="quote-stat-label">30D</span><span class="quote-stat-val ${deltaClass(q.change_30d_pct)}">${fmtPct(q.change_30d_pct)}</span></div>
              <div class="quote-stat"><span class="quote-stat-label">${escapeHtml(tf === "5d" ? "7D" : tf.toUpperCase())} Low</span><span class="quote-stat-val">${escapeHtml(lo)}</span></div>
              <div class="quote-stat"><span class="quote-stat-label">${escapeHtml(tf === "5d" ? "7D" : tf.toUpperCase())} High</span><span class="quote-stat-val">${escapeHtml(hi)}</span></div>
            </div>
          </div>
        `;
      })
      .join("");
  }

  function renderFearGreed(fg) {
    if (!els.fearGreedCard) return;
    if (!fg || fg.score == null) {
      els.fearGreedCard.classList.add("hidden");
      els.fearGreedCard.innerHTML = "";
      return;
    }
    const score = Math.max(0, Math.min(100, Number(fg.score)));
    const rating = String(fg.rating || "Neutral");
    const slug = rating.toLowerCase().replace(/\s+/g, "-");
    const hist = [
      ["Prev Close", fg.previous_close],
      ["1W Ago", fg.previous_1_week],
      ["1M Ago", fg.previous_1_month],
      ["1Y Ago", fg.previous_1_year],
    ]
      .filter(([, val]) => val != null)
      .map(([label, val]) => `<span>${label}: <strong>${Number(val).toFixed(1)}</strong></span>`)
      .join("");

    els.fearGreedCard.classList.remove("hidden");
    els.fearGreedCard.innerHTML = `
      <div class="fg-top">
        <div class="fg-title-group">
          <span class="fg-label">Market Fear &amp; Greed Index</span>
          <span class="fg-score">${score.toFixed(1)}</span>
          <span class="fg-scale">/ 100</span>
          <span class="fg-rating ${escapeHtml(slug)}">${escapeHtml(rating)}</span>
        </div>
        ${hist ? `<div class="fg-history">${hist}</div>` : ""}
      </div>
      <div class="fg-bar-wrap" aria-label="Fear and Greed score ${score.toFixed(1)} out of 100">
        <div class="fg-marker" style="left:${score.toFixed(1)}%"></div>
      </div>
      <div class="fg-zones">
        <span>Extreme Fear</span>
        <span>Fear</span>
        <span>Neutral</span>
        <span>Greed</span>
        <span>Extreme Greed</span>
      </div>
    `;
  }

  function renderSectorHeatmap(markets = {}) {
    const tf = state.marketTimeframe;
    const tfLabels = {
      "1d": "Daily ETF performance (SPDR Select Sectors)",
      "5d": "5-day rolling ETF performance (SPDR Select Sectors)",
      "30d": "30-day rolling ETF performance (SPDR Select Sectors)",
    };
    els.heatmapLabel.textContent = tfLabels[tf] || tfLabels["1d"];

    const sectors = [...(markets.sectors || [])].sort(
      (a, b) => getTimeframeValue(b, tf) - getTimeframeValue(a, tf)
    );

    if (!sectors.length) {
      els.sectorHeatmap.innerHTML = `<div class="empty-state">Sector heatmap unavailable for this date.</div>`;
    } else {
      els.sectorHeatmap.innerHTML = sectors
        .map((s) => {
          const pct = getTimeframeValue(s, tf);
          return `
            <div class="sector-tile" style="${sectorTileStyle(pct)}">
              <span class="sector-sym">${escapeHtml(s.symbol)}</span>
              <span class="sector-name">${escapeHtml(s.name)}</span>
              <span class="sector-val">${fmtPct(pct)}</span>
            </div>
          `;
        })
        .join("");
    }
  }

  function renderMarkets(markets = {}) {
    els.marketNarrative.innerHTML = highlightSummaryHtml(markets.narrative || "");

    const tf = state.marketTimeframe;
    renderFearGreed(markets.fear_greed);

    renderQuoteGrid(
      els.watchlistGrid,
      markets.watchlist || [],
      tf,
      "Market watchlist data unavailable for this date."
    );

    const big7 = markets.big7 || [];
    if (els.big7Block && els.big7Grid) {
      if (!big7.length) {
        els.big7Block.classList.add("hidden");
        els.big7Grid.innerHTML = "";
      } else {
        els.big7Block.classList.remove("hidden");
        if (els.big7Label) {
          const big7Sub = {
            "1d": "Mega-cap tech leaders (1D change · 15m chart)",
            "5d": "Mega-cap tech leaders (5D change · 1h chart)",
            "30d": "Mega-cap tech leaders (30D change · daily chart)",
          };
          els.big7Label.textContent = big7Sub[tf] || big7Sub["1d"];
        }
        renderQuoteGrid(els.big7Grid, big7, tf, "");
      }
    }

    renderSectorHeatmap(markets);
  }


  function updateMarketsLivePill(updatedAt, sourceTag = "") {
    if (!els.marketsLivePill || !updatedAt) return;
    const dt = new Date(updatedAt);
    const timeStr = Number.isNaN(dt.getTime())
      ? updatedAt
      : dt.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZoneName: "short" });
    const ageMin = Number.isNaN(dt.getTime()) ? 999 : Math.max(0, (Date.now() - dt.getTime()) / 60000);
    const freshness = ageMin < 45 ? "fresh" : ageMin < 180 ? "aging" : "stale";
    const ageLabel =
      ageMin < 1 ? "just now" : ageMin < 60 ? `${Math.round(ageMin)}m ago` : `${Math.round(ageMin / 60)}h ago`;
    const srcNote =
      sourceTag === "cloudflare"
        ? " · live"
        : sourceTag === "cors-fallback"
        ? " · live (fallback)"
        : "";
    els.marketsLivePill.innerHTML = `<span class="live-dot ${freshness}" aria-hidden="true"></span>${escapeHtml(timeStr)}`;
    els.marketsLivePill.title = `${freshness} · ${ageLabel}${srcNote}`;
    els.marketsLivePill.classList.remove("hidden");
  }

  function applyMarketQuotesPatch(quotesMap, updatedAt, sourceTag = "") {
    if (!state.briefing?.markets || !quotesMap) return;
    const patchList = (arr) =>
      Array.isArray(arr)
        ? arr.map((item) => {
            const live = quotesMap[item?.symbol];
            if (!live) return item;
            return {
              ...item,
              price: live.price ?? item.price,
              change_pct: live.change_pct ?? item.change_pct,
              sparkline_1d:
                Array.isArray(live.sparkline_1d) && live.sparkline_1d.length >= 2
                  ? live.sparkline_1d
                  : item.sparkline_1d,
              sparkline_1d_times:
                Array.isArray(live.sparkline_1d_times) && live.sparkline_1d_times.length >= 2
                  ? live.sparkline_1d_times
                  : item.sparkline_1d_times,
            };
          })
        : arr;

    state.briefing.markets = {
      ...state.briefing.markets,
      watchlist: patchList(state.briefing.markets.watchlist),
      big7: patchList(state.briefing.markets.big7),
      sectors: patchList(state.briefing.markets.sectors),
    };

    buildTickerMap(state.briefing.markets);
    document.querySelectorAll(".ticker-tag[data-ticker-sym]").forEach((el) => {
      const sym = el.dataset.tickerSym;
      const info =
        state.tickerMap.get(sym) ||
        state.tickerMap.get(sym?.replace(/^\^/, ""));
      if (!info) return;
      const cls = deltaClass(info.change_pct);
      const tip = formatTickerTip(info);
      el.classList.remove("pos", "neg", "flat");
      el.classList.add(cls);
      el.dataset.tickerTip = tip;
      el.title = tip;
    });

    onQuotesPatched?.();
    renderMarkets(state.briefing.markets);
    updateMarketsLivePill(updatedAt, sourceTag);
  }

  function applyFullMarketsSnapshot(snap, sourceTag = "cloudflare") {
    if (!state.briefing?.markets || !snap || !Array.isArray(snap.watchlist) || !snap.watchlist.length) {
      return false;
    }
    state.briefing.markets = {
      ...state.briefing.markets,
      watchlist: snap.watchlist,
      big7: Array.isArray(snap.big7) && snap.big7.length ? snap.big7 : state.briefing.markets.big7,
      sectors: Array.isArray(snap.sectors) && snap.sectors.length ? snap.sectors : state.briefing.markets.sectors,
      fear_greed: snap.fear_greed || state.briefing.markets.fear_greed,
    };
    applyMarketQuotesPatch({}, snap.updated_at || new Date().toISOString(), sourceTag);
    return true;
  }

  async function fetchCloudflareKvMarkets(activeSymbols, force = false) {
    if (force && activeSymbols.length && !canCallCloudflare(activeSymbols)) {
      return { status: 429, data: null };
    }
    try {
      if (force && activeSymbols.length) recordCloudflareFetch(activeSymbols);
      const ctrl = new AbortController();
      const timer = window.setTimeout(() => ctrl.abort(), 8000);
      const url = force ? `${CF_MARKETS_PROXY_URL}?force=1` : CF_MARKETS_PROXY_URL;
      const resp = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
      window.clearTimeout(timer);
      if (!resp.ok) return { status: resp.status, data: null };
      const data = await resp.json();
      if (data && Array.isArray(data.watchlist) && data.watchlist.length) {
        return { status: 200, data };
      }
      return { status: 500, data: null };
    } catch {
      return { status: 0, data: null };
    }
  }

  async function refreshLiveMarkets(forceClientRefresh = false) {
    if (!state.viewingLatest || !state.briefing) {
      els.marketsLivePill?.classList.add("hidden");
      return;
    }

    const cached = readJsonStorage(LIVE_CACHE_KEY);
    const cacheFresh =
      cached?.snapshot &&
      typeof cached.fetched_at_ms === "number" &&
      Date.now() - cached.fetched_at_ms < LIVE_CACHE_TTL_MS;

    if (!forceClientRefresh && cacheFresh) {
      applyFullMarketsSnapshot(cached.snapshot, cached.source || "cloudflare");
      return;
    }

    const allSymbols = [
      ...(state.briefing.markets?.watchlist || []),
      ...(state.briefing.markets?.big7 || []),
      ...(state.briefing.markets?.sectors || []),
    ]
      .map((q) => q?.symbol)
      .filter(Boolean);
    const activeSymbols = allSymbols.filter((sym) => isSymbolTradingNow(sym));

    // Primary: Cloudflare KV Worker (full 1D/7D/30D + sectors + Fear & Greed)
    const cfRes = await fetchCloudflareKvMarkets(activeSymbols, forceClientRefresh);
    if (cfRes.status === 200 && cfRes.data) {
      writeJsonStorage(LIVE_CACHE_KEY, {
        fetched_at_ms: Date.now(),
        source: "cloudflare",
        snapshot: cfRes.data,
      });
      applyFullMarketsSnapshot(cfRes.data, "cloudflare");
      return;
    }

    // Fallback: load cached KV or static markets_live.json baseline, then Option 3 public CORS relay for active symbols
    if (cached?.snapshot) {
      applyFullMarketsSnapshot(cached.snapshot, cached.source || "cloudflare");
    } else {
      try {
        const resp = await fetch(`${DATA_BASE}/markets_live.json`, { cache: "no-store" });
        if (resp.ok) {
          const live = await resp.json();
          applyFullMarketsSnapshot(live, "static");
        }
      } catch {
        // Keep daily briefing snapshot
      }
    }

    if (activeSymbols.length) {
      const corsPatch = await fetchViaPublicCorsFallback(activeSymbols);
      if (corsPatch?.quotes && Object.keys(corsPatch.quotes).length) {
        applyMarketQuotesPatch(corsPatch.quotes, corsPatch.updated_at, "cors-fallback");
        writeJsonStorage(LIVE_CACHE_KEY, {
          fetched_at_ms: Date.now(),
          source: "cors-fallback",
          snapshot: {
            updated_at: corsPatch.updated_at,
            watchlist: state.briefing.markets.watchlist,
            big7: state.briefing.markets.big7,
            sectors: state.briefing.markets.sectors,
            fear_greed: state.briefing.markets.fear_greed,
          },
        });
      }
    }
  }

  function initSparklineHover() {
    const root = document.getElementById("app-root");
    if (!root) return;

    const clearHover = (wrap) => {
      if (!wrap) return;
      wrap.classList.remove("hovering");
      const tip = wrap.querySelector(".spark-tooltip");
      if (tip) tip.classList.add("hidden");
    };

    let activeWrap = null;
    const seriesCache = new WeakMap();

    const getCachedSeries = (wrap) => {
      let entry = seriesCache.get(wrap);
      if (!entry) {
        try {
          const values = JSON.parse(wrap.dataset.values || "[]");
          if (!Array.isArray(values) || values.length < 2) return null;
          let times = [];
          try {
            const parsed = JSON.parse(wrap.dataset.times || "[]");
            if (Array.isArray(parsed)) times = parsed;
          } catch {
            times = [];
          }
          let xs = null;
          try {
            const parsedXs = JSON.parse(wrap.dataset.xs || "null");
            if (Array.isArray(parsedXs) && parsedXs.length === values.length) xs = parsedXs;
          } catch {
            xs = null;
          }
          const min = Math.min(...values);
          const max = Math.max(...values);
          entry = {
            values,
            times,
            xs,
            min,
            span: max - min || 1,
            guide: wrap.querySelector(".spark-guide"),
            dot: wrap.querySelector(".spark-dot"),
            tip: wrap.querySelector(".spark-tooltip"),
          };
          seriesCache.set(wrap, entry);
        } catch {
          return null;
        }
      }
      return entry;
    };

    const showAt = (wrap, clientX) => {
      if (activeWrap && activeWrap !== wrap) {
        clearHover(activeWrap);
      }
      activeWrap = wrap;

      const entry = getCachedSeries(wrap);
      if (!entry) return;

      const rect = wrap.getBoundingClientRect();
      if (!rect.width) return;

      const { values, times, xs, min, span, guide, dot, tip } = entry;
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const w = 120;
      const h = 32;
      const pad = 3;

      let idx = 0;
      if (xs) {
        const targetX = ratio * w;
        let bestDist = Infinity;
        for (let i = 0; i < xs.length; i++) {
          const dist = Math.abs(xs[i] - targetX);
          if (dist < bestDist) {
            bestDist = dist;
            idx = i;
          }
        }
      } else {
        idx = Math.round(ratio * (values.length - 1));
      }

      const val = values[idx];
      const ptX = xs ? xs[idx] : (idx / (values.length - 1)) * w;
      const ptY = h - pad - ((val - min) / span) * (h - pad * 2);

      if (guide) {
        guide.setAttribute("x1", ptX.toFixed(1));
        guide.setAttribute("x2", ptX.toFixed(1));
      }
      if (dot) {
        dot.style.left = `${((ptX / w) * 100).toFixed(2)}%`;
        dot.style.top = `${((ptY / h) * 100).toFixed(2)}%`;
      }
      if (tip) {
        const kind = wrap.dataset.kind || "";
        const valText =
          kind === "gdelt"
            ? `${Number(val).toFixed(0)}`
            : fmtPrice(val, wrap.dataset.symbol);
        const timeText = times[idx] ? fmtSparkTime(times[idx], kind) : "";
        tip.innerHTML = timeText
          ? `<span class="spark-tip-time">${escapeHtml(timeText)}</span> ${escapeHtml(valText)}`
          : escapeHtml(valText);
        const pctLeft = Math.max(18, Math.min(82, (ptX / w) * 100));
        tip.style.left = `${pctLeft.toFixed(1)}%`;
        tip.classList.remove("hidden");
      }
      wrap.classList.add("hovering");
    };

    root.addEventListener("pointerdown", (e) => {
      const wrap = e.target.closest(".sparkline-wrap");
      if (!wrap) {
        if (activeWrap) {
          clearHover(activeWrap);
          activeWrap = null;
        }
        return;
      }
      showAt(wrap, e.clientX);
    });

    root.addEventListener("pointermove", (e) => {
      const wrap = e.target.closest(".sparkline-wrap");
      if (!wrap) {
        if (activeWrap && e.pointerType !== "touch") {
          clearHover(activeWrap);
          activeWrap = null;
        }
        return;
      }
      showAt(wrap, e.clientX);
    });

    root.addEventListener("pointerleave", (e) => {
      if (activeWrap && e.pointerType !== "touch") {
        clearHover(activeWrap);
        activeWrap = null;
      }
    });
  }

  return {
    renderMarkets,
    renderSectorHeatmap,
    refreshLiveMarkets,
    initSparklineHover,
    updateMarketsLivePill,
  };
}

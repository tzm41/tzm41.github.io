/**
 * Daily Briefing Dashboard — Client Application (Zero-Build ES Module)
 */

import { initCountryMapTooltip } from "./country-map.js?v=15";
import {
  escapeHtml,
  safeUrl,
  escapeRegex,
  fmtReadableDate,
  fmtLocalTimestamp,
  resolveTheme,
  initTheme,
  initScrollSpy,
  createCollapsibleManager,
  renderSourceChip,
  initSourceBiasPopover,
  SENTIMENT_LABELS,
  inferSentimentFromText,
  renderSentimentRing,
} from "../shared/ui.js?v=4";
import {
  COMPANY_LOGOS,
  renderCompanyLogoImg,
  renderCountryFlagImg,
  buildPersonNameRegexFromTexts,
  createEntityFormatter,
  initFloatingTooltips,
} from "../shared/entities.js?v=5";
import {
  makeBookmarkKey,
  buildBookmarkRecord,
  isBookmarked,
  getBookmarkStats,
  renderBookmarkButton,
  syncBookmarkButtons,
  bindBookmarkToggle,
  onBookmarksChange,
} from "../shared/bookmarks.js?v=1";
import {
  initAuth,
  getLocalPreferences,
  setPreference,
} from "../shared/auth.js?v=2";

const DATA_BASE = "./data";

const bookmarkRecordMap = new Map();

const state = {
  index: null,
  currentDate: null,
  viewingLatest: true,
  briefing: null,
  priorBriefing: null,
  tickerMap: new Map(),
  inlineTickerRe: null,
  newsCategory: "All",
  marketTimeframe: [0, 6].includes(new Date().getDay()) ? "5d" : "1d",
  expandedQuoteSymbol: null,
  localRegionId: null,
  localLang: "en",
  localExpanded: false,
  companyFacts: null,
  countryLeaders: null,
};

const els = {
  editionDate: document.getElementById("edition-date"),
  generatedMeta: document.getElementById("generated-meta"),
  dateSelect: document.getElementById("date-select"),
  btnPrevDay: document.getElementById("btn-prev-day"),
  btnNextDay: document.getElementById("btn-next-day"),
  btnExpandAll: document.getElementById("btn-expand-all"),
  btnRefresh: document.getElementById("btn-refresh"),
  themeToggle: document.getElementById("theme-toggle"),
  authMount: document.getElementById("auth-mount"),
  navBookmarksCount: document.getElementById("nav-bookmarks-count"),
  sourceHealth: document.getElementById("source-health"),
  statusBanner: document.getElementById("status-banner"),
  kpiWrapper: document.getElementById("kpi-wrapper"),
  btnToggleKpi: document.getElementById("btn-toggle-kpi"),
  kpiToggleSummary: document.getElementById("kpi-toggle-summary"),
  kpiStrip: document.getElementById("kpi-strip"),
  synthesisModeTag: document.getElementById("synthesis-mode-tag"),
  executiveList: document.getElementById("executive-list"),
  afternoonPanel: document.getElementById("afternoon-panel"),
  afternoonTimeTag: document.getElementById("afternoon-time-tag"),
  afternoonList: document.getElementById("afternoon-list"),
  newsFilters: document.getElementById("news-filters"),
  newsGrid: document.getElementById("news-grid"),
  marketRegime: document.getElementById("market-regime"),
  marketsLivePill: document.getElementById("markets-live-pill"),
  marketNarrative: document.getElementById("market-narrative"),
  fearGreedCard: document.getElementById("fear-greed-card"),
  watchlistGrid: document.getElementById("watchlist-grid"),
  big7Block: document.getElementById("big7-block"),
  big7Grid: document.getElementById("big7-grid"),
  big7Label: document.getElementById("big7-label"),
  sectorHeatmap: document.getElementById("sector-heatmap"),
  heatmapLabel: document.getElementById("heatmap-label"),
  btnTf1d: document.getElementById("btn-tf-1d"),
  btnTf5d: document.getElementById("btn-tf-5d"),
  btnTf30d: document.getElementById("btn-tf-30d"),
  conflictsOverview: document.getElementById("conflicts-overview"),
  conflictsGrid: document.getElementById("conflicts-grid"),
  politicsPulse: document.getElementById("politics-pulse"),
  polymarketList: document.getElementById("polymarket-list"),
  policyList: document.getElementById("policy-list"),
  topicsList: document.getElementById("topics-list"),
  positiveSection: document.getElementById("positive"),
  positiveNewsSlot: document.getElementById("positive-news-slot"),
  btnMovePositive: document.getElementById("btn-move-positive"),
  localSection: document.getElementById("local-news"),
  localLocationToggle: document.getElementById("local-location-toggle"),
  localLangToggle: document.getElementById("local-lang-toggle"),
  btnToggleLocal: document.getElementById("btn-toggle-local"),
  localNewsBody: document.getElementById("local-news-body"),
  localNewsGrid: document.getElementById("local-news-grid"),
  companyFactsMeta: document.getElementById("company-facts-meta"),
};

/* ---------- Utilities ---------- */

function fmtPct(val) {
  const num = Number(val ?? 0);
  const sign = num > 0 ? "+" : "";
  return `${sign}${num.toFixed(2)}%`;
}

function fmtPrice(price, symbol) {
  const num = Number(price ?? 0);
  if (symbol === "^TNX") return `${num.toFixed(2)}%`;
  if (num >= 1000) return num.toLocaleString("en-US", { maximumFractionDigits: 1 });
  return num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtUsdCompact(amount) {
  const num = Number(amount ?? 0);
  if (num >= 1e6) return `$${(num / 1e6).toFixed(1)}M vol`;
  if (num >= 1e3) return `$${(num / 1e3).toFixed(0)}K vol`;
  return `$${num.toFixed(0)} vol`;
}

const TICKER_ALIASES = [
  ["S&P 500", "^GSPC"],
  ["Nasdaq", "^IXIC"],
  ["Dow Jones", "^DJI"],
  ["Dow", "^DJI"],
  ["Russell 2000", "^RUT"],
  ["VIX", "^VIX"],
  ["WTI crude", "CL=F"],
  ["Bitcoin", "BTC-USD"],
  ["Nvidia", "NVDA"],
  ["Apple", "AAPL"],
  ["Microsoft", "MSFT"],
  ["Alphabet", "GOOGL"],
  ["Amazon", "AMZN"],
  ["Meta", "META"],
  ["Tesla", "TSLA"],
];

function buildTickerMap(markets = {}) {
  const map = new Map();
  const bySym = new Map();
  for (const q of [...(markets.watchlist || []), ...(markets.big7 || [])]) {
    if (!q?.symbol) continue;
    const info = {
      symbol: q.symbol,
      name: q.name,
      price: q.price,
      change_pct: q.change_pct,
      currency: q.symbol.startsWith("^") ? "" : "$",
      hasPrice: true,
    };
    bySym.set(q.symbol, info);
    map.set(q.symbol.replace(/^\^/, ""), info);
  }
  for (const s of markets.sectors || []) {
    if (!s?.symbol) continue;
    const info = {
      symbol: s.symbol,
      name: s.name,
      price: null,
      change_pct: s.change_pct,
      currency: "",
      hasPrice: false,
    };
    bySym.set(s.symbol, info);
    map.set(s.symbol, info);
  }
  for (const [alias, sym] of TICKER_ALIASES) {
    const info = bySym.get(sym);
    if (info) map.set(alias, info);
  }
  for (const mq of markets.mentioned_quotes || []) {
    if (!mq?.symbol) continue;
    const info = {
      symbol: mq.symbol,
      name: mq.name,
      price: mq.price,
      change_pct: mq.change_pct,
      currency: mq.currency ?? "$",
      hasPrice: true,
    };
    map.set(mq.symbol.replace(/^\^/, ""), info);
    for (const alias of mq.aliases || []) {
      if (alias) map.set(alias, info);
    }
  }
  state.tickerMap = map;

  const keys = [...map.keys()].sort((a, b) => b.length - a.length);
  if (keys.length) {
    const parts = keys.map((k) => {
      const esc = escapeRegex(k);
      return /^[\x00-\x7F]+$/.test(k) ? `\\b${esc}\\b` : esc;
    });
    state.inlineTickerRe = new RegExp(`(${parts.join("|")})`, "g");
  } else {
    state.inlineTickerRe = null;
  }
}

function formatTickerTip(info) {
  const pct = fmtPct(info.change_pct);
  const cleanSym = info.symbol.replace(/^\^/, "");
  if (info.hasPrice) {
    const cur = info.currency || "";
    return `${cleanSym} · ${cur}${fmtPrice(info.price, info.symbol)} (1D: ${pct})`;
  }
  return `${cleanSym} · ${info.name} (1D: ${pct})`;
}

function buildPersonNameRegex(briefing, companyFacts) {
  const texts = [];
  const asArr = (v) => (Array.isArray(v) ? v : []);
  const pushStr = (v) => {
    if (typeof v === "string" && v.includes("*")) texts.push(v);
  };
  for (const it of asArr(briefing?.morning_brief?.bullets)) pushStr(it?.text ?? it);
  for (const it of asArr(briefing?.afternoon_brief?.bullets)) pushStr(it?.text ?? it);
  for (const s of asArr(briefing?.top_news)) pushStr(s?.summary);
  pushStr(briefing?.markets?.narrative);
  pushStr(briefing?.conflicts?.overview);
  for (const t of asArr(briefing?.conflicts?.theaters)) pushStr(t?.summary);
  pushStr(briefing?.us_politics?.pulse_summary);
  for (const p of asArr(briefing?.us_politics?.legislative_and_executive)) pushStr(p?.summary);
  for (const t of asArr(briefing?.us_politics?.trending_topics)) pushStr(t?.framing_note ?? t?.note);
  if (Array.isArray(briefing?.positive_news)) {
    for (const s of briefing.positive_news) pushStr(s?.summary);
  } else if (briefing?.positive_news && typeof briefing.positive_news === "object") {
    pushStr(briefing.positive_news.summary);
  }
  const localRegions = Array.isArray(briefing?.local_news)
    ? briefing.local_news
    : asArr(briefing?.local_news?.regions);
  for (const r of localRegions) {
    for (const s of [...asArr(r?.stories), ...asArr(r?.stories_en)]) pushStr(s?.summary);
  }
  state.personNameRe = buildPersonNameRegexFromTexts(texts, companyFacts);
}

const { formatEntitiesInPlain, highlightSummaryHtml } = createEntityFormatter({
  getPersonRe: () => state.personNameRe,
  getTickerMap: () => state.tickerMap,
  getInlineTickerRe: () => state.inlineTickerRe,
  formatTickerTip,
  deltaClass,
  pillCompaniesInSummary: true,
});

function deltaClass(val) {
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
        const startMin = 0;
        const endMin = 1440;
        const xs = mins.map((m) => Math.max(0, Math.min(w, ((m - startMin) / (endMin - startMin)) * w)));
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

function buildSparklineSvg(
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

function renderSourceHealth(health = {}) {
  const labels = [
    ["news", "News"],
    ["markets", "Markets"],
    ["conflicts", "Conflicts"],
    ["politics", "Politics"],
  ];
  els.sourceHealth.innerHTML = labels
    .map(([key, label]) => {
      const status = health[key] || "ok";
      return `<span class="health-item" title="${label}: ${status}"><span class="health-dot ${escapeHtml(status)}"></span>${label}</span>`;
    })
    .join("");
}

function renderKpiStrip(briefing) {
  const watchlist = briefing.markets?.watchlist || [];
  const bySym = Object.fromEntries(watchlist.map((q) => [q.symbol, q]));
  const sp = bySym["^GSPC"];
  const vix = bySym["^VIX"];
  const tnx = bySym["^TNX"];
  const theaters = briefing.conflicts?.theaters || [];
  const topTheater = theaters.length
    ? [...theaters].sort((a, b) => (b.intensity_score || 0) - (a.intensity_score || 0))[0]
    : null;

  const cards = [];
  if (sp) {
    cards.push(`
      <div class="kpi-card">
        <div class="kpi-label">S&amp;P 500</div>
        <div class="kpi-value-row">
          <span class="kpi-value">${fmtPrice(sp.price, sp.symbol)}</span>
          <span class="delta-pill ${deltaClass(sp.change_pct)}">${fmtPct(sp.change_pct)}</span>
        </div>
        <div class="kpi-sub">5D: ${fmtPct(sp.change_5d_pct)}</div>
      </div>
    `);
  }
  if (vix) {
    cards.push(`
      <div class="kpi-card">
        <div class="kpi-label">VIX Volatility</div>
        <div class="kpi-value-row">
          <span class="kpi-value">${fmtPrice(vix.price, vix.symbol)}</span>
          <span class="delta-pill ${deltaClass(-vix.change_pct)}">${fmtPct(vix.change_pct)}</span>
        </div>
        <div class="kpi-sub">Regime: ${escapeHtml(briefing.markets?.regime_tag || "Mixed")}</div>
      </div>
    `);
  }
  if (tnx) {
    cards.push(`
      <div class="kpi-card">
        <div class="kpi-label">US 10Y Yield</div>
        <div class="kpi-value-row">
          <span class="kpi-value">${fmtPrice(tnx.price, tnx.symbol)}</span>
          <span class="delta-pill ${deltaClass(tnx.change_pct)}">${fmtPct(tnx.change_pct)}</span>
        </div>
        <div class="kpi-sub">Benchmark Treasury</div>
      </div>
    `);
  }
  if (topTheater) {
    cards.push(`
      <div class="kpi-card">
        <div class="kpi-label">Highest Conflict Activity</div>
        <div class="kpi-value-row">
          <span class="kpi-value" style="font-size:15px;">${escapeHtml(topTheater.region)}</span>
          <span class="status-badge ${escapeHtml(topTheater.status)}">${escapeHtml(topTheater.status)}</span>
        </div>
        <div class="kpi-sub">${escapeHtml(topTheater.name)}</div>
      </div>
    `);
  }
  els.kpiStrip.innerHTML = cards.join("");
  if (els.kpiToggleSummary) {
    const collapsedLabel = sp
      ? `S&P 500 ${fmtPrice(sp.price, sp.symbol)} (${fmtPct(sp.change_pct)})`
      : "Signals";
    els.kpiToggleSummary.dataset.collapsedText = collapsedLabel;
    const isExpanded = els.kpiWrapper?.classList.contains("is-expanded");
    els.kpiToggleSummary.textContent = isExpanded ? "Signals" : collapsedLabel;
  }
}

function fmtLocalTimeOnly(isoStr) {
  if (!isoStr) return "";
  const dt = new Date(isoStr);
  if (Number.isNaN(dt.getTime())) return isoStr;
  return dt.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function renderBriefBullets(bullets = []) {
  return bullets
    .map((item) => {
      const text = typeof item === "string" ? item : item?.text || "";
      const category =
        typeof item === "object" && item?.category
          ? item.category
          : inferCategoryFromText(text);
      const sentiment =
        typeof item === "object" && item?.sentiment && SENTIMENT_LABELS[item.sentiment]
          ? item.sentiment
          : inferSentimentFromText(text);
      return `
        <li>
          <span class="exec-meta">
            ${renderSentimentRing(sentiment)}
            <span class="cat-pill">${escapeHtml(category)}</span>
          </span>
          <span class="exec-text">${highlightSummaryHtml(text)}</span>
        </li>
      `;
    })
    .join("");
}

function renderExecutiveBrief(briefing) {
  const morning = briefing.morning_brief || {
    generated_at: briefing.generated_at,
    bullets: briefing.executive_brief || [],
  };
  const morningTs = morning.generated_at || briefing.generated_at;
  els.synthesisModeTag.textContent = fmtLocalTimeOnly(morningTs);
  els.synthesisModeTag.title = `Generated ${fmtLocalTimestamp(morningTs)}`;

  const bullets = morning.bullets || [];
  if (!bullets.length) {
    els.executiveList.innerHTML = `<li>No executive summary items available for this edition.</li>`;
  } else {
    els.executiveList.innerHTML = renderBriefBullets(bullets);
  }

  const afternoon = briefing.afternoon_brief;
  if (els.afternoonPanel && els.afternoonList) {
    if (afternoon && Array.isArray(afternoon.bullets) && afternoon.bullets.length) {
      els.afternoonPanel.classList.remove("hidden");
      if (els.afternoonTimeTag) {
        els.afternoonTimeTag.textContent = fmtLocalTimeOnly(afternoon.generated_at);
        els.afternoonTimeTag.title = `Generated ${fmtLocalTimestamp(afternoon.generated_at)}`;
      }
      els.afternoonList.innerHTML = renderBriefBullets(afternoon.bullets);
    } else {
      els.afternoonPanel.classList.add("hidden");
      els.afternoonList.innerHTML = "";
    }
  }
}

const SIMILAR_STOPWORDS = new Set([
  "about", "after", "again", "against", "amid", "because", "before", "being",
  "between", "could", "first", "from", "have", "into", "more", "most", "over",
  "said", "says", "since", "some", "still", "than", "that", "their", "them",
  "then", "there", "these", "they", "this", "through", "today", "under",
  "very", "were", "what", "when", "where", "which", "while", "will", "with",
  "would", "year", "years",
]);

function contentTokens(text) {
  const words = String(text || "").toLowerCase().match(/[a-z0-9]{4,}/g) || [];
  const set = new Set();
  for (const w of words) {
    if (!SIMILAR_STOPWORDS.has(w)) set.add(w);
  }
  return set;
}

function jaccard(setA, setB) {
  if (!setA.size || !setB.size) return 0;
  let inter = 0;
  for (const w of setA) {
    if (setB.has(w)) inter += 1;
  }
  return inter / (setA.size + setB.size - inter);
}

function isContinuedFromPrior(story, priorStories = []) {
  if (story.continued_from_prior) return true;
  if (!Array.isArray(priorStories) || !priorStories.length) return false;
  const hCur = contentTokens(story.headline);
  const fCur = contentTokens(`${story.headline || ""} ${story.summary || ""}`);
  for (const prev of priorStories) {
    if (jaccard(hCur, contentTokens(prev.headline)) >= 0.42) return true;
    if (jaccard(fCur, contentTokens(`${prev.headline || ""} ${prev.summary || ""}`)) >= 0.35) {
      return true;
    }
  }
  return false;
}

function resolveStorySentiment(story) {
  if (story?.sentiment && SENTIMENT_LABELS[story.sentiment] && story.sentiment !== "neutral") {
    return story.sentiment;
  }
  return inferSentimentFromText(`${story?.headline || ""} ${story?.summary || ""}`);
}

function inferCategoryFromText(text) {
  const s = String(text || "");
  if (/\b(nasdaq|s&p|dow|russell|market|stock|tariff|inflation|yield|bitcoin|oil|fed)\b/i.test(s)) return "Economy";
  if (/\b(nvidia|huawei|microsoft|apple|ai\b|chip|tech|cloud|cyber)\b/i.test(s)) return "Tech";
  if (/\b(congress|senate|house|lawmaker|white house|trump|rep\.|doj|court|deport)\b/i.test(s)) return "Policy";
  if (/\b(science|trial|bacteria|virus|climate|space|health)\b/i.test(s)) return "Science";
  return "World";
}

function registerStoryBookmark({ section, story, badge, region = null, lang = null }) {
  const itemId = story?.id || story?.headline;
  if (!itemId) return "";
  const date = state.briefing?.date || state.currentDate || "";
  const key = makeBookmarkKey({
    edition: "daily",
    date,
    section,
    id: itemId,
    region,
  });
  bookmarkRecordMap.set(
    key,
    buildBookmarkRecord({
      edition: "daily",
      date,
      section,
      id: itemId,
      region,
      lang,
      kind: null,
      title: story.headline || "",
      badge: badge || story.category || "News",
      source: story.sources?.[0]?.name || "",
      url: story.sources?.[0]?.url || "",
    })
  );
  return renderBookmarkButton(key, {
    saved: isBookmarked(key),
    label: story.headline || "story",
  });
}

function renderNewsCard(story, badgeLabel, continued, showEditionTag = false, bookmarkCtx = null) {
  const sourcesHtml = (story.sources || []).map(renderSourceChip).join("");
  const sentiment = resolveStorySentiment(story);

  const toggleBtn = continued
    ? `<button type="button" class="card-toggle-btn" aria-expanded="false">Expand &#9662;</button>`
    : "";
  const bookmarkBtn = bookmarkCtx
    ? registerStoryBookmark({
        section: bookmarkCtx.section,
        story,
        badge: bookmarkCtx.badge || badgeLabel,
        region: bookmarkCtx.region || null,
        lang: bookmarkCtx.lang || null,
      })
    : "";
  const editionBadge = showEditionTag
    ? story.is_afternoon
      ? `<span class="afternoon-pill" title="Added in Afternoon Update">Afternoon</span>`
      : `<span class="morning-pill" title="Published in Morning Briefing">Morning</span>`
    : "";
  const continuedBadge = continued
    ? `<span class="continued-pill" title="Substantially similar to a story from yesterday">From yesterday</span>`
    : "";

  return `
    <article class="news-card${continued ? " is-collapsed" : ""}">
      <div class="news-meta">
        <div class="news-card-badges">
          <span class="cat-pill">${escapeHtml(badgeLabel)}</span>
          ${renderSentimentRing(sentiment)}
          ${editionBadge}
          ${continuedBadge}
        </div>
        <div class="news-meta-actions">
          ${toggleBtn}
          ${bookmarkBtn}
        </div>
      </div>
      <h3>${formatEntitiesInPlain(story.headline)}</h3>
      <p class="news-summary">${highlightSummaryHtml(story.summary)}</p>
      <div class="why-box"><strong>Why it matters:</strong> ${highlightSummaryHtml(story.why_it_matters)}</div>
      <div class="source-links">${sourcesHtml}</div>
    </article>
  `;
}

function renderNews(stories = []) {
  const filtered =
    state.newsCategory === "All"
      ? stories
      : stories.filter((s) => s.category === state.newsCategory);

  if (!filtered.length) {
    els.newsGrid.innerHTML = `<div class="empty-state">No stories in the "${escapeHtml(state.newsCategory)}" category for this edition.</div>`;
    return;
  }

  const priorTop = state.priorBriefing?.top_news || [];
  els.newsGrid.innerHTML = filtered
    .map((story) =>
      renderNewsCard(story, story.category, isContinuedFromPrior(story, priorTop), true, {
        section: "top_news",
        badge: story.category || "News",
      })
    )
    .join("");
}

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

function getPriorSessionBadge(times, tf) {
  if (tf !== "1d" || !Array.isArray(times) || !times.length) return null;
  const lastRaw = times[times.length - 1];
  if (!lastRaw) return null;
  const lastDt = new Date(lastRaw);
  if (Number.isNaN(lastDt.getTime())) return null;
  const lastEt = NY_DATE_FMT.format(lastDt);
  const refEt = state.viewingLatest
    ? NY_DATE_FMT.format(new Date())
    : String(state.briefing?.date || "").slice(0, 10);
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
      const prevBadge = getPriorSessionBadge(times, tf);
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
  if (els.marketRegime) {
    const regime = markets.regime_tag || "Mixed";
    const regimeSlug = regime.toLowerCase().replace(/\s+/g, "-");
    els.marketRegime.textContent = regime;
    els.marketRegime.className = `regime-badge ${regimeSlug}`;
  }
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

function renderConflicts(conflicts = {}) {
  els.conflictsOverview.innerHTML = highlightSummaryHtml(conflicts.overview || "");
  const theaters = conflicts.theaters || [];
  if (!theaters.length) {
    els.conflictsGrid.innerHTML = `<div class="empty-state">No conflict tracker data available for this edition.</div>`;
    return;
  }

  const trendArrow = { up: "↑ Rising", flat: "→ Steady", down: "↓ Cooling" };

  els.conflictsGrid.innerHTML = theaters
    .map((t) => {
      const sparkColor =
        t.status === "escalating"
          ? "var(--neg)"
          : t.status === "elevated"
          ? "var(--warn)"
          : "var(--ink-muted)";

      const eventsHtml = (t.timeline_events || [])
        .map(
          (ev) => `
            <li>
              <a href="${safeUrl(ev.url)}" target="_blank" rel="noopener noreferrer">${formatEntitiesInPlain(ev.headline)}</a>
              <span class="timeline-src">${escapeHtml(ev.source)}</span>
            </li>
          `
        )
        .join("");

      return `
        <article class="conflict-card">
          <div class="conflict-head">
            <div>
              <span class="conflict-region">${escapeHtml(t.region)}</span>
              <h3>${formatEntitiesInPlain(t.name)}</h3>
            </div>
            <span class="status-badge ${escapeHtml(t.status)}">${escapeHtml(t.status)}</span>
          </div>

          <div class="intensity-row">
            <div class="intensity-meta">
              14D GDELT Intensity: <strong>${Number(t.intensity_score || 0).toFixed(0)}</strong>
              &middot; 7D: <strong>${trendArrow[t.trend_7d] || "→ Steady"}</strong>
            </div>
            <div class="sparkline-wrap intensity-spark-wrap" data-kind="gdelt" data-values="${escapeHtml(JSON.stringify(t.intensity_series_14d || []))}" data-times="${escapeHtml(JSON.stringify(t.intensity_dates_14d || []))}">
              <div class="spark-tooltip hidden"></div>
              ${buildSparklineSvg(t.intensity_series_14d, sparkColor, "intensity-spark", true)}
            </div>
          </div>

          <p class="conflict-summary">${highlightSummaryHtml(t.summary)}</p>

          ${eventsHtml ? `<ul class="timeline-list">${eventsHtml}</ul>` : ""}
        </article>
      `;
    })
    .join("");
}

function renderPolitics(politics = {}) {
  els.politicsPulse.innerHTML = highlightSummaryHtml(politics.pulse_summary || "");

  const markets = politics.prediction_markets || [];
  if (!markets.length) {
    els.polymarketList.innerHTML = `<div class="empty-state">No prediction market quotes captured for this edition.</div>`;
  } else {
    els.polymarketList.innerHTML = markets
      .map((m) => {
        const pct = Math.round((m.yes_prob || 0) * 100);
        const deltaPts = (m.delta_24h || 0) * 100;
        const dCls = deltaClass(deltaPts);
        const sourceLabel =
          m.source ||
          (String(m.url || "").includes("kalshi.com") ? "Kalshi" : "Polymarket");
        return `
          <a class="poly-card" href="${safeUrl(m.url)}" target="_blank" rel="noopener noreferrer">
            <div class="poly-top">
              <span class="poly-q">${formatEntitiesInPlain(m.question)}</span>
              <div class="poly-odds">
                <div class="poly-pct">${pct}%</div>
              </div>
            </div>
            <div class="poly-bar-track">
              <div class="poly-bar-fill" style="width:${pct}%"></div>
            </div>
            <div class="poly-foot">
              <span>${escapeHtml(sourceLabel)} &middot; ${fmtUsdCompact(m.volume_usd)}</span>
              <span class="delta-pill ${dCls}">24h: ${deltaPts >= 0 ? "+" : ""}${deltaPts.toFixed(1)} pts</span>
            </div>
          </a>
        `;
      })
      .join("");
  }

  const policies = politics.legislative_and_executive || [];
  if (!policies.length) {
    els.policyList.innerHTML = `<div class="empty-state">No legislative or executive updates listed.</div>`;
  } else {
    els.policyList.innerHTML = policies
      .map(
        (p) => `
          <article class="policy-card">
            <div class="policy-head">
              <span class="branch-tag">${escapeHtml(p.chamber_or_branch)}</span>
              <a class="policy-title" href="${safeUrl(p.url)}" target="_blank" rel="noopener noreferrer">${formatEntitiesInPlain(p.title)}</a>
            </div>
            <p class="policy-summary">${highlightSummaryHtml(p.summary)}</p>
          </article>
        `
      )
      .join("");
  }

  const topics = politics.trending_topics || [];
  if (!topics.length) {
    els.topicsList.innerHTML = `<div class="empty-state">No trending topic notes available.</div>`;
  } else {
    els.topicsList.innerHTML = topics
      .map(
        (t) => `
          <article class="topic-card">
            <div class="topic-top">
              <span class="topic-name">${formatEntitiesInPlain(t.topic)}</span>
              <span class="momentum-pill ${escapeHtml(t.momentum)}">${escapeHtml(t.momentum)}</span>
            </div>
            <p class="topic-note">${highlightSummaryHtml(t.framing_note)}</p>
          </article>
        `
      )
      .join("");
  }
}

function renderPositiveNews(positiveNews) {
  if (!els.positiveSection || !els.positiveNewsSlot) return;
  const stories = Array.isArray(positiveNews)
    ? positiveNews.filter((s) => s && s.headline)
    : positiveNews && positiveNews.headline
    ? [positiveNews]
    : [];
  if (!stories.length) {
    els.positiveSection.classList.add("hidden");
    els.positiveNewsSlot.innerHTML = "";
    return;
  }

  els.positiveSection.classList.remove("hidden");
  const cardsHtml = stories
    .map((story) => {
      const sourcesHtml = (story.sources || []).map(renderSourceChip).join("");
      const posSentiment =
        story.sentiment && SENTIMENT_LABELS[story.sentiment] && story.sentiment !== "neutral"
          ? story.sentiment
          : "very_positive";
      const bookmarkBtn = registerStoryBookmark({
        section: "positive_news",
        story,
        badge: story.category || "Progress",
      });
      return `
        <article class="positive-card">
          <div class="news-meta">
            <div class="news-card-badges">
              <span class="cat-pill">${escapeHtml(story.category || "Progress")}</span>
              ${renderSentimentRing(posSentiment)}
            </div>
            <div class="news-meta-actions">
              ${bookmarkBtn}
            </div>
          </div>
          <h3>${formatEntitiesInPlain(story.headline)}</h3>
          <p class="news-summary">${highlightSummaryHtml(story.summary)}</p>
          <div class="why-box"><strong>Why it matters:</strong> ${highlightSummaryHtml(story.why_it_matters)}</div>
          <div class="source-links">${sourcesHtml}</div>
        </article>
      `;
    })
    .join("");

  els.positiveNewsSlot.innerHTML = `<div class="positive-grid${stories.length === 1 ? " is-single" : ""}">${cardsHtml}</div>`;
}

let syncExpandAllButton = () => {};

function setLocalExpanded(expanded) {
  state.localExpanded = Boolean(expanded);
  if (els.localNewsBody) {
    els.localNewsBody.classList.toggle("hidden", !state.localExpanded);
  }
  if (els.btnToggleLocal) {
    els.btnToggleLocal.setAttribute("aria-expanded", String(state.localExpanded));
    const lbl = els.btnToggleLocal.querySelector(".collapse-label");
    if (lbl) lbl.textContent = state.localExpanded ? "Collapse" : "Expand";
  }
  syncExpandAllButton();
}

function renderLocalNews(regions = []) {
  if (!els.localSection || !els.localLocationToggle || !els.localNewsGrid) return;
  if (!Array.isArray(regions) || !regions.length) {
    els.localSection.classList.add("hidden");
    els.localLocationToggle.innerHTML = "";
    els.localNewsGrid.innerHTML = "";
    return;
  }

  els.localSection.classList.remove("hidden");
  if (!state.localRegionId || !regions.some((r) => r.id === state.localRegionId)) {
    state.localRegionId = regions[0].id;
  }

  els.localLocationToggle.innerHTML = regions
    .map((r) => {
      const active = r.id === state.localRegionId;
      return `<button type="button" class="seg-btn${active ? " active" : ""}" data-region-id="${escapeHtml(r.id)}" aria-pressed="${active}">${escapeHtml(r.name)}</button>`;
    })
    .join("");

  const activeRegion = regions.find((r) => r.id === state.localRegionId) || regions[0];
  const hasTranslation = Array.isArray(activeRegion.stories_en) && activeRegion.stories_en.length > 0;
  if (els.localLangToggle) {
    els.localLangToggle.classList.toggle("hidden", !hasTranslation);
    els.localLangToggle.querySelectorAll(".seg-btn").forEach((btn) => {
      const active = btn.dataset.lang === state.localLang;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-pressed", String(active));
    });
  }

  const useEn = hasTranslation && state.localLang === "en";
  const stories = useEn ? activeRegion.stories_en : activeRegion.stories || [];
  const priorRegion = (state.priorBriefing?.local_news || []).find((r) => r.id === activeRegion.id);
  const priorLocal = useEn ? priorRegion?.stories_en || [] : priorRegion?.stories || [];
  if (!stories.length) {
    els.localNewsGrid.innerHTML = `<div class="empty-state">No local news stories available for ${escapeHtml(activeRegion.name)} in this edition.</div>`;
  } else {
    els.localNewsGrid.innerHTML = stories
      .map((story) =>
        renderNewsCard(story, activeRegion.name, isContinuedFromPrior(story, priorLocal), false, {
          section: "local_news",
          region: activeRegion.id,
          lang: useEn ? "en" : "native",
          badge: activeRegion.name,
        })
      )
      .join("");
  }

  setLocalExpanded(state.localExpanded);
}

function renderAll(briefing) {
  state.briefing = briefing;
  bookmarkRecordMap.clear();
  buildTickerMap(briefing.markets);
  buildPersonNameRegex(briefing, state.companyFacts);
  els.editionDate.textContent = fmtReadableDate(briefing.date);
  const candidates = [
    briefing.generated_at,
    briefing.morning_brief?.generated_at,
    briefing.afternoon_brief?.generated_at,
  ].filter(Boolean);
  const latestUpdateTs = candidates.reduce((best, cur) =>
    !best || new Date(cur) > new Date(best) ? cur : best,
    ""
  );
  els.generatedMeta.textContent = `Updated ${fmtLocalTimestamp(latestUpdateTs)}`;
  renderSourceHealth(briefing.source_health);
  renderKpiStrip(briefing);
  renderExecutiveBrief(briefing);
  renderNews(briefing.top_news);
  renderMarkets(briefing.markets);
  renderConflicts(briefing.conflicts);
  renderPolitics(briefing.us_politics);
  renderPositiveNews(briefing.positive_news);
  renderLocalNews(briefing.local_news);
}

/* ---------- Archive Navigation & Data Loading ---------- */

function updateArchiveButtons() {
  const dates = state.index?.dates || [];
  const idx = dates.indexOf(state.currentDate);
  // dates are sorted newest-first: index 0 is newest, index length-1 is oldest
  els.btnNextDay.disabled = idx <= 0;
  els.btnPrevDay.disabled = idx === -1 || idx >= dates.length - 1;
}

const CF_MARKETS_PROXY_URL = "https://briefing-markets-proxy.tzm41.workers.dev/markets";
const LIVE_CACHE_KEY = "briefing-live-markets-cache-v3";
const CF_RL_KEY = "briefing-cf-rl-v1";
const LIVE_CACHE_TTL_MS = 100 * 1000; // 100s TTL -> max 3 fetches per 5 min
const CF_RL_WINDOW_MS = 5 * 60 * 1000;
const CF_RL_MAX_PER_SYMBOL = 3;

function readJsonStorage(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJsonStorage(key, val) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch {
    // Ignore storage quota / private-mode errors
  }
}

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

async function fetchClientLiveQuotes(symbols, force = false) {
  if (!symbols.length) return null;

  // Primary: Cloudflare Worker (strictly rate-limited to <= 3 fetches / symbol / 5 min)
  if (canCallCloudflare(symbols)) {
    try {
      recordCloudflareFetch(symbols);
      const ctrl = new AbortController();
      const timer = window.setTimeout(() => ctrl.abort(), 8000);
      const url = `${CF_MARKETS_PROXY_URL}?symbols=${encodeURIComponent(symbols.join(","))}${
        force ? "&force=1" : ""
      }`;
      const resp = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
      window.clearTimeout(timer);
      if (resp.ok) {
        const data = await resp.json();
        if (data?.quotes && Object.keys(data.quotes).length > 0) {
          return {
            updated_at: data.updated_at || new Date().toISOString(),
            fetched_at_ms: Date.now(),
            source: "cloudflare",
            quotes: data.quotes,
          };
        }
      }
      // On HTTP 429 (Worker rate limit reached) or 5xx, fall through to Option 3 public CORS fallback
    } catch {
      // Network/CORS failure -> fall through to Option 3 public CORS fallback
    }
  }

  // Fallback (Option 3): Public CORS relay
  return fetchViaPublicCorsFallback(symbols);
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

  renderKpiStrip(state.briefing);
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

async function loadBriefingForDate(dateStr) {
  els.statusBanner.classList.add("hidden");
  const isLatest = !dateStr || dateStr === "latest";
  state.viewingLatest = isLatest;
  if (!isLatest) els.marketsLivePill?.classList.add("hidden");
  const url = isLatest
    ? `${DATA_BASE}/latest.json`
    : `${DATA_BASE}/archive/${encodeURIComponent(dateStr)}.json`;

  try {
    const resp = await fetch(url, { cache: "no-store" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    state.currentDate = data.date;
    const selectVal = isLatest ? "latest" : data.date;
    if (els.dateSelect.value !== selectVal) {
      els.dateSelect.value = selectVal;
    }
    const qs = new URLSearchParams(window.location.search);
    qs.set("date", isLatest ? "latest" : data.date);
    window.history.replaceState(null, "", `?${qs.toString()}`);

    updateArchiveButtons();
    state.priorBriefing = null;
    const dates = state.index?.dates || [];
    const curIdx = dates.indexOf(data.date);
    if (curIdx !== -1 && curIdx + 1 < dates.length) {
      try {
        const prevResp = await fetch(
          `${DATA_BASE}/archive/${encodeURIComponent(dates[curIdx + 1])}.json`,
          { cache: "no-store" }
        );
        if (prevResp.ok) {
          state.priorBriefing = await prevResp.json();
        }
      } catch {
        state.priorBriefing = null;
      }
    }
    renderAll(data);
    if (isLatest) {
      await refreshLiveMarkets();
    }
  } catch (err) {
    els.statusBanner.textContent = `Could not load briefing data (${err.message}). Run the daily pipeline or check briefing/data/.`;
    els.statusBanner.classList.remove("hidden");
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

function applyPositivePlacement(pos) {
  const placement = pos === "top" ? "top" : "bottom";
  const positiveSec = els.positiveSection;
  const execSec = document.getElementById("executive");
  const appRoot = document.getElementById("app-root");
  if (positiveSec && execSec && appRoot) {
    if (placement === "top") {
      execSec.insertAdjacentElement("afterend", positiveSec);
    } else {
      appRoot.appendChild(positiveSec);
    }
  }

  const navLinks = document.querySelector(".nav-links");
  const posLink = navLinks?.querySelector('a[href="#positive"]');
  const execLink = navLinks?.querySelector('a[href="#executive"]');
  if (posLink && execLink && navLinks) {
    if (placement === "top") {
      execLink.insertAdjacentElement("afterend", posLink);
    } else {
      navLinks.appendChild(posLink);
    }
  }

  if (els.btnMovePositive) {
    els.btnMovePositive.innerHTML =
      placement === "top" ? "Move to bottom &darr;" : "Move below Brief &uarr;";
  }
}

const SYNCED_THEME_ICONS = {
  system: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none"/></svg>`,
  light: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4.5"/><path d="M12 2.5v2M12 19.5v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2.5 12h2M19.5 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>`,
  dark: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`,
};

const SYNCED_THEME_LABELS = {
  system: "Theme: Auto (switch to Light)",
  light: "Theme: Light (switch to Dark)",
  dark: "Theme: Dark (switch to Auto)",
};

let lastThemePref = null;

function applySyncedTheme(pref) {
  const validPref = ["system", "light", "dark"].includes(pref) ? pref : "system";
  lastThemePref = validPref;
  localStorage.setItem("briefing-theme", validPref);
  const resolved = resolveTheme(validPref);
  document.documentElement.setAttribute("data-theme", resolved);
  if (els.themeToggle) {
    els.themeToggle.dataset.themePref = validPref;
    els.themeToggle.innerHTML = SYNCED_THEME_ICONS[validPref];
    const label = SYNCED_THEME_LABELS[validPref];
    els.themeToggle.setAttribute("aria-label", label);
    els.themeToggle.setAttribute("title", label);
  }
  if (state.briefing) renderSectorHeatmap(state.briefing.markets);
}

let toastTimer = null;
function showToast(msg) {
  let el = document.querySelector(".auth-toast[data-briefing-toast]");
  if (!el) {
    el = document.createElement("div");
    el.className = "auth-toast";
    el.dataset.briefingToast = "1";
    el.setAttribute("role", "status");
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.remove("hidden");
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    el.classList.add("hidden");
  }, 4000);
}

function updateNavBookmarksCount() {
  if (!els.navBookmarksCount) return;
  const stats = getBookmarkStats();
  if (stats.total > 0) {
    els.navBookmarksCount.textContent = `(${stats.total})`;
    els.navBookmarksCount.classList.remove("hidden");
  } else {
    els.navBookmarksCount.textContent = "";
    els.navBookmarksCount.classList.add("hidden");
  }
}

async function bootstrap() {
  const initialPrefs = getLocalPreferences();
  if (initialPrefs?.local_region) state.localRegionId = initialPrefs.local_region;
  if (initialPrefs?.local_lang === "en" || initialPrefs?.local_lang === "native") {
    state.localLang = initialPrefs.local_lang;
  }
  if (["1d", "5d", "30d"].includes(initialPrefs?.market_tf)) {
    state.marketTimeframe = initialPrefs.market_tf;
  }

  initTheme(els.themeToggle, (_resolved, pref) => {
    if (lastThemePref !== null && pref !== lastThemePref) {
      setPreference("theme", pref);
    }
    lastThemePref = pref;
    if (state.briefing) renderSectorHeatmap(state.briefing.markets);
  });

  applyPositivePlacement(
    initialPrefs?.positive_pos || localStorage.getItem("briefing-positive-pos") || "bottom"
  );
  initScrollSpy();
  initSparklineHover();
  initSourceBiasPopover();
  initFloatingTooltips(() => state.companyFacts);
  initCountryMapTooltip(
    escapeHtml,
    renderCountryFlagImg,
    (code) => state.countryLeaders?.leaders?.[code] || null
  );

  bindBookmarkToggle(
    document.getElementById("app-root"),
    (key) => bookmarkRecordMap.get(key),
    {
      onLimitReached: () =>
        showToast("Bookmark limit reached. Remove an older bookmark to save more."),
    }
  );
  updateNavBookmarksCount();
  onBookmarksChange(() => {
    updateNavBookmarksCount();
    syncBookmarkButtons();
  });

  // Mobile KPI strip collapse toggle (collapsed by default on narrow screens)
  const setKpiOpen = (open) => {
    if (!els.kpiWrapper || !els.btnToggleKpi) return;
    els.kpiWrapper.classList.toggle("is-expanded", open);
    els.btnToggleKpi.setAttribute("aria-expanded", String(open));
    const lbl = els.btnToggleKpi.querySelector(".collapse-label");
    if (lbl) lbl.textContent = open ? "Collapse" : "Expand";
    if (els.kpiToggleSummary) {
      els.kpiToggleSummary.textContent = open
        ? "Signals"
        : els.kpiToggleSummary.dataset.collapsedText || "Signals";
    }
  };
  els.btnToggleKpi?.addEventListener("click", () => {
    const next = !els.kpiWrapper?.classList.contains("is-expanded");
    setKpiOpen(next);
  });

  // Collapsible sections (collapsed by default on load): Markets, Global Conflicts, US Politics, Positive News
  const { wireCollapsible, syncExpandAllButton: syncAll } = createCollapsibleManager(els.btnExpandAll, {
    extraIsOpen: () => {
      const localVisible = els.localSection && !els.localSection.classList.contains("hidden");
      return !localVisible || state.localExpanded;
    },
    extraSetOpen: (open) => {
      setKpiOpen(open);
      if (els.localSection && !els.localSection.classList.contains("hidden")) {
        setLocalExpanded(open);
      }
    },
  });
  syncExpandAllButton = syncAll;
  const setMarketsOpen = wireCollapsible("btn-toggle-markets", "markets-body", "#markets");
  wireCollapsible("btn-toggle-heatmap", "sector-heatmap");
  wireCollapsible("btn-toggle-conflicts", "conflicts-body", "#conflicts");
  wireCollapsible("btn-toggle-politics", "politics-body", "#politics");
  wireCollapsible("btn-toggle-positive", "positive-news-slot", "#positive");
  syncExpandAllButton();

  // Positive News placement toggle (above Top News vs bottom)
  els.btnMovePositive?.addEventListener("click", () => {
    const cur = localStorage.getItem("briefing-positive-pos") || "bottom";
    const next = cur === "top" ? "bottom" : "top";
    localStorage.setItem("briefing-positive-pos", next);
    setPreference("positive_pos", next);
    applyPositivePlacement(next);
    els.positiveSection?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  // Delegated expand/collapse for continued-from-yesterday news cards
  document.getElementById("app-root")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".card-toggle-btn");
    if (!btn) return;
    const card = btn.closest(".news-card");
    if (!card) return;
    const collapsed = card.classList.toggle("is-collapsed");
    btn.setAttribute("aria-expanded", String(!collapsed));
    btn.innerHTML = collapsed ? "Expand &#9662;" : "Collapse &#9652;";
  });

  // News category filters (click active filter again to reset to All)
  els.newsFilters.addEventListener("click", (e) => {
    const btn = e.target.closest(".filter-btn");
    if (!btn) return;
    const clicked = btn.dataset.category;
    state.newsCategory = state.newsCategory === clicked ? "All" : clicked;
    els.newsFilters.querySelectorAll(".filter-btn").forEach((b) => {
      const active = b.dataset.category === state.newsCategory;
      b.classList.toggle("active", active);
      b.setAttribute("aria-selected", String(active));
    });
    if (state.briefing) renderNews(state.briefing.top_news);
  });

  // Market timeframe toggle (1D / 7D / 30D; defaults to 1D on weekdays, 7D on weekends)
  const tfBtns = [els.btnTf1d, els.btnTf5d, els.btnTf30d].filter(Boolean);
  const syncTfButtons = () => {
    tfBtns.forEach((b) => b.classList.toggle("active", b.dataset.tf === state.marketTimeframe));
  };
  syncTfButtons();
  tfBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      state.marketTimeframe = btn.dataset.tf;
      setPreference("market_tf", state.marketTimeframe);
      syncTfButtons();
      setMarketsOpen?.(true);
      if (state.briefing) renderMarkets(state.briefing.markets);
    });
  });

  // Expand/shrink stock tile (2x2 = 4 tiles, single active expanded tile at a time)
  const marketsBody = document.getElementById("markets-body");
  let sparkDragStartX = null;
  let sparkDragged = false;
  marketsBody?.addEventListener("pointerdown", (e) => {
    sparkDragged = false;
    sparkDragStartX = e.target.closest(".sparkline-wrap") ? e.clientX : null;
  });
  marketsBody?.addEventListener("pointermove", (e) => {
    if (sparkDragStartX !== null && Math.abs(e.clientX - sparkDragStartX) > 8) {
      sparkDragged = true;
    }
  });
  const toggleQuoteCard = (card) => {
    const sym = card?.dataset?.symbol;
    if (!sym) return;
    state.expandedQuoteSymbol = state.expandedQuoteSymbol === sym ? null : sym;
    marketsBody?.querySelectorAll(".quote-card").forEach((el) => {
      const expanded = el.dataset.symbol === state.expandedQuoteSymbol;
      el.classList.toggle("is-expanded", expanded);
      el.setAttribute("aria-expanded", String(expanded));
    });
  };
  marketsBody?.addEventListener("click", (e) => {
    if (sparkDragged) {
      sparkDragged = false;
      return;
    }
    if (e.target.closest(".quote-name[data-company-domain], .quote-prev-badge[data-tooltip]")) {
      return;
    }
    const card = e.target.closest(".quote-card");
    if (card) toggleQuoteCard(card);
  });
  marketsBody?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const card = e.target.closest(".quote-card");
    if (!card) return;
    e.preventDefault();
    toggleQuoteCard(card);
  });

  // Local news expand/collapse & location toggle
  els.btnToggleLocal?.addEventListener("click", () => {
    setLocalExpanded(!state.localExpanded);
  });
  const localHeading = els.localSection?.querySelector(".section-header h2");
  if (localHeading) {
    localHeading.classList.add("collapsible-title");
    localHeading.addEventListener("click", () => setLocalExpanded(!state.localExpanded));
  }

  els.localLocationToggle?.addEventListener("click", (e) => {
    const btn = e.target.closest(".seg-btn");
    if (!btn) return;
    state.localRegionId = btn.dataset.regionId;
    setPreference("local_region", state.localRegionId);
    if (!state.localExpanded) setLocalExpanded(true);
    if (state.briefing) renderLocalNews(state.briefing.local_news);
  });

  els.localLangToggle?.addEventListener("click", (e) => {
    const btn = e.target.closest(".seg-btn");
    if (!btn) return;
    state.localLang = btn.dataset.lang || "native";
    setPreference("local_lang", state.localLang);
    if (!state.localExpanded) setLocalExpanded(true);
    if (state.briefing) renderLocalNews(state.briefing.local_news);
  });

  initAuth({
    mountEl: els.authMount,
    bookmarksHref: "../bookmarks/",
    onPreferencesApplied(prefs) {
      if (!prefs || typeof prefs !== "object") return;
      if (prefs.theme && ["system", "light", "dark"].includes(prefs.theme)) {
        applySyncedTheme(prefs.theme);
      }
      if (prefs.positive_pos && (prefs.positive_pos === "top" || prefs.positive_pos === "bottom")) {
        localStorage.setItem("briefing-positive-pos", prefs.positive_pos);
        applyPositivePlacement(prefs.positive_pos);
      }
      let localChanged = false;
      if (prefs.local_region && prefs.local_region !== state.localRegionId) {
        state.localRegionId = prefs.local_region;
        localChanged = true;
      }
      if (
        (prefs.local_lang === "en" || prefs.local_lang === "native") &&
        prefs.local_lang !== state.localLang
      ) {
        state.localLang = prefs.local_lang;
        localChanged = true;
      }
      if (localChanged && state.briefing) {
        renderLocalNews(state.briefing.local_news);
      }
      if (
        ["1d", "5d", "30d"].includes(prefs.market_tf) &&
        prefs.market_tf !== state.marketTimeframe
      ) {
        state.marketTimeframe = prefs.market_tf;
        syncTfButtons();
        if (state.briefing) renderMarkets(state.briefing.markets);
      }
    },
  });

  // Archive navigation controls
  els.dateSelect.addEventListener("change", () => {
    if (els.dateSelect.value) loadBriefingForDate(els.dateSelect.value);
  });

  els.btnPrevDay.addEventListener("click", () => {
    const dates = state.index?.dates || [];
    const idx = dates.indexOf(state.currentDate);
    if (idx !== -1 && idx + 1 < dates.length) {
      loadBriefingForDate(dates[idx + 1]);
    }
  });

  els.btnNextDay.addEventListener("click", () => {
    const dates = state.index?.dates || [];
    const idx = dates.indexOf(state.currentDate);
    if (idx > 0) {
      loadBriefingForDate(idx - 1 === 0 ? "latest" : dates[idx - 1]);
    }
  });

  // Refresh button: re-fetch archive index + current edition (+ live markets if on Latest)
  els.btnRefresh?.addEventListener("click", async () => {
    if (els.btnRefresh.disabled) return;
    els.btnRefresh.disabled = true;
    els.btnRefresh.classList.add("is-spinning");
    try {
      try {
        const idxResp = await fetch(`${DATA_BASE}/index.json`, { cache: "no-store" });
        if (idxResp.ok) {
          state.index = await idxResp.json();
          const dates = state.index.dates || [];
          if (dates.length) {
            const curVal = els.dateSelect.value;
            els.dateSelect.innerHTML =
              `<option value="latest">Latest</option>` +
              dates.map((d) => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join("");
            els.dateSelect.value = curVal;
          }
        }
      } catch {
        // Ignore index refresh errors and still reload current briefing
      }
      await loadBriefingForDate(state.viewingLatest ? "latest" : state.currentDate || "latest");
      if (state.viewingLatest) {
        await refreshLiveMarkets(true);
      }
    } finally {
      els.btnRefresh.classList.remove("is-spinning");
      els.btnRefresh.disabled = false;
    }
  });

  // Fetch company facts, country leaders & archive manifest in parallel
  const factsPromise = fetch(`${DATA_BASE}/company_facts.json`, { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((facts) => {
      if (!facts) return;
      state.companyFacts = facts;
      if (els.companyFactsMeta && facts.updated_at) {
        els.companyFactsMeta.textContent = ` · Company facts updated ${fmtLocalTimestamp(facts.updated_at)}.`;
      }
    })
    .catch(() => {});

  const leadersPromise = fetch(`${DATA_BASE}/country_leaders.json`, { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((leaders) => {
      if (leaders) state.countryLeaders = leaders;
    })
    .catch(() => {});

  const indexPromise = fetch(`${DATA_BASE}/index.json`, { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((idxData) => {
      if (!idxData) return;
      state.index = idxData;
      const dates = state.index.dates || [];
      if (dates.length) {
        els.dateSelect.innerHTML =
          `<option value="latest">Latest</option>` +
          dates.map((d) => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join("");
      }
    })
    .catch(() => {});

  await Promise.all([factsPromise, leadersPromise, indexPromise]);

  const requested = new URLSearchParams(window.location.search).get("date");
  const initialDate =
    requested && requested !== "latest" && state.index?.dates?.includes(requested)
      ? requested
      : "latest";

  await loadBriefingForDate(initialDate);

  // Periodically poll markets_live.json every 5 min while tab is visible on Latest
  window.setInterval(() => {
    if (!document.hidden && state.viewingLatest) {
      refreshLiveMarkets();
    }
  }, 5 * 60 * 1000);
}

bootstrap();

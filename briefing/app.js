/**
 * Daily Briefing Dashboard — Client Application (Zero-Build ES Module)
 */

import {
  escapeHtml,
  safeUrl,
  escapeRegex,
  fmtReadableDate,
  fmtLocalTimestamp,
  fetchJson,
} from "../shared/utils.js";
import {
  initTheme,
  initScrollSpy,
  createCollapsibleManager,
  renderSourceChip,
  showToast,
  syncButtonGroup,
  renderSourceHealth as renderSourceHealthStrip,
} from "../shared/ui.js";
import {
  buildPersonNameRegexFromTexts,
  createEntityFormatter,
  initEntityOverlays,
  loadSharedEntityData,
} from "../shared/entities.js";
import {
  createBookmarkRegistry,
  bindBookmarkCountBadge,
  bindBookmarkToggle,
} from "../shared/bookmarks.js";
import {
  initAuth,
  getLocalPreferences,
  setPreference,
} from "../shared/auth.js";
import { createArchiveController } from "../shared/archive-nav.js";
import {
  renderBriefBullets as renderSharedBriefBullets,
  renderDailyStoryCard,
  resolveLocalStoryTag,
} from "../shared/cards.js";
import {
  fmtPct,
  fmtPrice,
  deltaClass,
  buildSparklineSvg,
  createMarketsController,
} from "./markets.js";

const DATA_BASE = "./data";



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
  getEntities: () => state.briefing?.entities || null,
  formatTickerTip,
  deltaClass,
  pillCompaniesInSummary: true,
});

const bookmarkRegistry = createBookmarkRegistry({
  edition: "daily",
  getDate: () => state.briefing?.date || state.currentDate || "",
});

const entityFormatter = { formatEntitiesInPlain, highlightSummaryHtml };

const marketsCtrl = createMarketsController({
  state,
  els,
  dataBase: DATA_BASE,
  highlightSummaryHtml,
  buildTickerMap,
  formatTickerTip,
  onQuotesPatched: () => renderKpiStrip(state.briefing),
});
const { renderMarkets, renderSectorHeatmap, refreshLiveMarkets, initSparklineHover } = marketsCtrl;

function renderSourceHealth(health = {}) {
  renderSourceHealthStrip(els.sourceHealth, [
    ["News", health.news],
    ["Markets", health.markets],
    ["Conflicts", health.conflicts],
    ["Politics", health.politics],
    ["Local", health.local_news],
  ]);
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
  return renderSharedBriefBullets(bullets, {
    highlightSummaryHtml,
    resolveCategory: inferCategoryFromText,
  });
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

function inferCategoryFromText(text) {
  const s = String(text || "");
  if (/\b(nasdaq|s&p|dow|russell|market|stock|tariff|inflation|yield|bitcoin|oil|fed)\b/i.test(s)) return "Economy";
  if (/\b(nvidia|huawei|microsoft|apple|ai\b|chip|tech|cloud|cyber)\b/i.test(s)) return "Tech";
  if (/\b(congress|senate|house|lawmaker|white house|trump|rep\.|doj|court|deport)\b/i.test(s)) return "Policy";
  if (/\b(science|trial|bacteria|virus|climate|space|health)\b/i.test(s)) return "Science";
  return "World";
}

function renderNewsCard(story, badgeLabel, continued, showEditionTag = false, bookmarkCtx = null) {
  const bookmarkHtml = bookmarkCtx
    ? bookmarkRegistry.register({
        section: bookmarkCtx.section,
        id: story?.id || story?.headline,
        region: bookmarkCtx.region || null,
        lang: bookmarkCtx.lang || null,
        title: story.headline || "",
        badge: bookmarkCtx.badge || badgeLabel || story.category || "News",
        source: story.sources?.[0]?.name || "",
        url: story.sources?.[0]?.url || "",
      })
    : "";
  return renderDailyStoryCard(story, {
    section: bookmarkCtx?.section || "top_news",
    badgeLabel,
    formatter: entityFormatter,
    bookmarkHtml,
    continued,
    showEditionTag,
  });
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
      const bookmarkHtml = bookmarkRegistry.register({
        section: "positive_news",
        id: story?.id || story?.headline,
        title: story.headline || "",
        badge: story.category || "Progress",
        source: story.sources?.[0]?.name || "",
        url: story.sources?.[0]?.url || "",
      });
      return renderDailyStoryCard(story, {
        section: "positive_news",
        badgeLabel: story.category || "Progress",
        formatter: entityFormatter,
        bookmarkHtml,
      });
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
      .map((story) => {
        const tag = resolveLocalStoryTag(story);
        return renderNewsCard(story, tag, isContinuedFromPrior(story, priorLocal), false, {
          section: "local_news",
          region: activeRegion.id,
          lang: useEn ? "en" : "native",
          badge: tag,
        });
      })
      .join("");
  }

  setLocalExpanded(state.localExpanded);
}

function renderAll(briefing) {
  state.briefing = briefing;
  bookmarkRegistry.clear();
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

const archiveNav = createArchiveController({
  dateSelectEl: els.dateSelect,
  prevBtnEl: els.btnPrevDay,
  nextBtnEl: els.btnNextDay,
  refreshBtnEl: els.btnRefresh,
  indexUrl: `${DATA_BASE}/index.json`,
  getDates: () => state.index?.dates || [],
  getCurrentDate: () => state.currentDate,
  isViewingLatest: () => state.viewingLatest,
  onIndexLoaded: (idxData) => {
    state.index = idxData;
  },
  onSelectDate: (dateStr) => loadBriefingForDate(dateStr),
  onRefresh: async () => {
    await loadBriefingForDate(state.viewingLatest ? "latest" : state.currentDate || "latest");
    if (state.viewingLatest) {
      await refreshLiveMarkets(true);
    }
  },
});

async function loadBriefingForDate(dateStr) {
  els.statusBanner.classList.add("hidden");
  const isLatest = !dateStr || dateStr === "latest";
  state.viewingLatest = isLatest;
  const url = isLatest
    ? `${DATA_BASE}/latest.json`
    : `${DATA_BASE}/archive/${encodeURIComponent(dateStr)}.json`;

  try {
    const data = await fetchJson(url);
    state.currentDate = data.date;
    archiveNav.syncUrlDate(data.date, isLatest);
    archiveNav.updateControls();

    state.priorBriefing = null;
    const dates = state.index?.dates || [];
    const curIdx = dates.indexOf(data.date);
    if (curIdx !== -1 && curIdx + 1 < dates.length) {
      try {
        state.priorBriefing = await fetchJson(
          `${DATA_BASE}/archive/${encodeURIComponent(dates[curIdx + 1])}.json`
        );
      } catch {
        state.priorBriefing = null;
      }
    }

    renderAll(data);
    if (isLatest) {
      refreshLiveMarkets();
    } else {
      els.marketsLivePill?.classList.add("hidden");
    }
  } catch (err) {
    els.statusBanner.textContent = `Could not load briefing (${dateStr || "latest"}): ${err.message}`;
    els.statusBanner.classList.remove("hidden");
  }
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

async function bootstrap() {
  const initialPrefs = getLocalPreferences();
  if (initialPrefs?.local_region) state.localRegionId = initialPrefs.local_region;
  if (initialPrefs?.local_lang === "en" || initialPrefs?.local_lang === "native") {
    state.localLang = initialPrefs.local_lang;
  }
  if (["1d", "5d", "30d"].includes(initialPrefs?.market_tf)) {
    state.marketTimeframe = initialPrefs.market_tf;
  }

  const themeCtrl = initTheme(els.themeToggle, (_resolved, pref) => {
    setPreference("theme", pref);
    if (state.briefing) renderSectorHeatmap(state.briefing.markets);
  });

  applyPositivePlacement(
    initialPrefs?.positive_pos || localStorage.getItem("briefing-positive-pos") || "bottom"
  );
  initScrollSpy();
  initSparklineHover();
  initEntityOverlays({
    getCompanyFacts: () => state.companyFacts,
    getCountryLeaders: () => state.countryLeaders,
  });

  bindBookmarkToggle(
    document.getElementById("app-root"),
    (key) => bookmarkRegistry.get(key),
    {
      onLimitReached: () =>
        showToast("Bookmark limit reached. Remove an older bookmark to save more."),
    }
  );
  bindBookmarkCountBadge(els.navBookmarksCount, { syncButtons: true });

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
    syncButtonGroup(els.newsFilters, (b) => b.dataset.category === state.newsCategory, "aria-selected");
    if (state.briefing) renderNews(state.briefing.top_news);
  });

  // Market timeframe toggle (1D / 7D / 30D; defaults to 1D on weekdays, 7D on weekends)
  const tfBtns = [els.btnTf1d, els.btnTf5d, els.btnTf30d].filter(Boolean);
  const syncTfButtons = () => {
    syncButtonGroup(tfBtns, (b) => b.dataset.tf === state.marketTimeframe, null);
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
        themeCtrl.apply(prefs.theme, { silent: true, persist: true });
        if (state.briefing) renderSectorHeatmap(state.briefing.markets);
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

  archiveNav.bind();

  // Fetch company facts, country leaders & archive manifest in parallel
  const [entityData, idxRes] = await Promise.all([
    loadSharedEntityData(DATA_BASE),
    fetchJson(`${DATA_BASE}/index.json`).then(
      (value) => ({ ok: true, value }),
      () => ({ ok: false, value: null })
    ),
  ]);

  if (entityData.companyFacts) {
    state.companyFacts = entityData.companyFacts;
    if (els.companyFactsMeta && entityData.companyFacts.updated_at) {
      els.companyFactsMeta.textContent = ` · Company facts updated ${fmtLocalTimestamp(entityData.companyFacts.updated_at)}.`;
    }
  }
  if (entityData.countryLeaders) {
    state.countryLeaders = entityData.countryLeaders;
  }
  if (idxRes.ok && idxRes.value) {
    state.index = idxRes.value;
    archiveNav.populateDateSelect(idxRes.value.dates || []);
  }

  const initialDate = archiveNav.resolveRequestedDate(state.index?.dates || []);
  await loadBriefingForDate(initialDate);

  // Periodically poll markets_live.json every 5 min while tab is visible on Latest
  window.setInterval(() => {
    if (!document.hidden && state.viewingLatest) {
      refreshLiveMarkets();
    }
  }, 5 * 60 * 1000);
}

bootstrap();

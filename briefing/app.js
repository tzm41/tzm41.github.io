/**
 * Daily Briefing Dashboard — Client Application (Zero-Build ES Module)
 */

const DATA_BASE = "./data";

const state = {
  index: null,
  currentDate: null,
  briefing: null,
  newsCategory: "All",
  marketTimeframe: "1d",
};

const els = {
  editionDate: document.getElementById("edition-date"),
  generatedMeta: document.getElementById("generated-meta"),
  dateSelect: document.getElementById("date-select"),
  btnPrevDay: document.getElementById("btn-prev-day"),
  btnNextDay: document.getElementById("btn-next-day"),
  themeSwitcher: document.getElementById("theme-switcher"),
  sourceHealth: document.getElementById("source-health"),
  statusBanner: document.getElementById("status-banner"),
  kpiStrip: document.getElementById("kpi-strip"),
  synthesisModeTag: document.getElementById("synthesis-mode-tag"),
  executiveList: document.getElementById("executive-list"),
  newsFilters: document.getElementById("news-filters"),
  newsGrid: document.getElementById("news-grid"),
  marketRegime: document.getElementById("market-regime"),
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
};

/* ---------- Utilities ---------- */

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeUrl(url) {
  if (!url) return "#";
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? url : "#";
  } catch {
    return "#";
  }
}

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

function fmtReadableDate(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function fmtLocalTimestamp(isoStr) {
  if (!isoStr) return "";
  const dt = new Date(isoStr);
  if (Number.isNaN(dt.getTime())) return isoStr;
  return dt.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function highlightSummaryHtml(text) {
  const raw = String(text ?? "");
  if (!raw) return "";

  const pattern =
    /\*\*([^*]+)\*\*|(?<![\w.$])([+-]?\$\d[\d,]*(?:\.\d+)?(?:\s?(?:million|billion|trillion|M|B|K))?|[+-]?\d[\d,]*(?:\.\d+)?%|\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b)(?!\w)|(['"][A-Z][^'"]{1,40}['"])|\b([A-Z][A-Za-z0-9.&'-]*(?:\s+(?:of|and|for|the|in|on|to)\s+)?(?:[A-Z][A-Za-z0-9.&'-]*)(?:\s+[A-Z0-9][A-Za-z0-9.&'-]*)*)\b|\b([A-Z]{2,5}(?:\s*&\s*[A-Z]{2,5})?)\b/g;

  let out = "";
  let lastIdx = 0;
  for (const match of raw.matchAll(pattern)) {
    const idx = match.index ?? 0;
    if (idx > lastIdx) {
      out += escapeHtml(raw.slice(lastIdx, idx));
    }
    const inner = match[1] ?? match[0];
    out += `<strong>${escapeHtml(inner)}</strong>`;
    lastIdx = idx + match[0].length;
  }
  if (lastIdx < raw.length) {
    out += escapeHtml(raw.slice(lastIdx));
  }
  return out;
}

function deltaClass(val) {
  const num = Number(val ?? 0);
  if (num > 0.02) return "pos";
  if (num < -0.02) return "neg";
  return "flat";
}

function buildSparklineSvg(values, color, className = "sparkline", interactive = false) {
  if (!Array.isArray(values) || values.length < 2) {
    return `<svg class="${className}" viewBox="0 0 120 32" aria-hidden="true"><line x1="0" y1="16" x2="120" y2="16" stroke="currentColor" stroke-opacity="0.2" stroke-dasharray="3 3"/></svg>`;
  }
  const w = 120;
  const h = 32;
  const pad = 3;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - pad - ((v - min) / span) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const polyline = pts.join(" ");
  const area = `0,${h} ${polyline} ${w},${h}`;

  if (!interactive) {
    return `
      <svg class="${className}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
        <polygon points="${area}" fill="${color}" fill-opacity="0.12"></polygon>
        <polyline points="${polyline}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></polyline>
      </svg>
    `;
  }

  return `
    <svg class="${className}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
      <polygon points="${area}" fill="${color}" fill-opacity="0.12"></polygon>
      <polyline points="${polyline}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></polyline>
      <line class="spark-guide" x1="0" y1="0" x2="0" y2="${h}"></line>
      <circle class="spark-dot" cx="0" cy="0" r="2.8" fill="${color}"></circle>
    </svg>
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

/* ---------- Theme ---------- */

function resolveTheme(pref) {
  if (pref === "light" || pref === "dark") return pref;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyThemePreference(pref) {
  const validPref = ["system", "light", "dark"].includes(pref) ? pref : "system";
  const resolved = resolveTheme(validPref);
  document.documentElement.setAttribute("data-theme", resolved);

  els.themeSwitcher?.querySelectorAll(".seg-btn").forEach((btn) => {
    const active = btn.dataset.themePref === validPref;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", String(active));
  });

  if (state.briefing) renderMarkets(state.briefing.markets);
}

function initTheme() {
  const media = window.matchMedia?.("(prefers-color-scheme: dark)");
  const saved = localStorage.getItem("briefing-theme") || "system";
  applyThemePreference(saved);

  els.themeSwitcher?.addEventListener("click", (e) => {
    const btn = e.target.closest(".seg-btn");
    if (!btn) return;
    const nextPref = btn.dataset.themePref || "system";
    localStorage.setItem("briefing-theme", nextPref);
    applyThemePreference(nextPref);
  });

  media?.addEventListener?.("change", () => {
    if ((localStorage.getItem("briefing-theme") || "system") === "system") {
      applyThemePreference("system");
    }
  });
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
  const topPoly = (briefing.us_politics?.prediction_markets || [])[0];

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
  if (topPoly) {
    cards.push(`
      <div class="kpi-card">
        <div class="kpi-label">Top Politics Market</div>
        <div class="kpi-value-row">
          <span class="kpi-value">${Math.round((topPoly.yes_prob || 0) * 100)}%</span>
          <span class="delta-pill ${deltaClass(topPoly.delta_24h)}">${fmtPct((topPoly.delta_24h || 0) * 100)}</span>
        </div>
        <div class="kpi-sub" title="${escapeHtml(topPoly.question)}">${escapeHtml(topPoly.question)}</div>
      </div>
    `);
  }

  els.kpiStrip.innerHTML = cards.join("");
}

function renderExecutiveBrief(briefing) {
  const mode = briefing.synthesis_mode === "gemini" ? "Gemini" : "Extractive Fallback";
  els.synthesisModeTag.textContent = mode;

  const bullets = briefing.executive_brief || [];
  if (!bullets.length) {
    els.executiveList.innerHTML = `<li>No executive summary items available for this edition.</li>`;
    return;
  }
  els.executiveList.innerHTML = bullets.map((b) => `<li>${highlightSummaryHtml(b)}</li>`).join("");
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

  els.newsGrid.innerHTML = filtered
    .map((story) => {
      const sourcesHtml = (story.sources || [])
        .map(
          (src) =>
            `<a class="source-chip" href="${safeUrl(src.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(src.name)} &nearr;</a>`
        )
        .join("");

      return `
        <article class="news-card">
          <div class="news-meta">
            <span class="cat-pill">${escapeHtml(story.category)}</span>
          </div>
          <h3>${escapeHtml(story.headline)}</h3>
          <p class="news-summary">${highlightSummaryHtml(story.summary)}</p>
          <div class="why-box"><strong>Why it matters:</strong> ${highlightSummaryHtml(story.why_it_matters)}</div>
          <div class="source-links">${sourcesHtml}</div>
        </article>
      `;
    })
    .join("");
}

function getTimeframeValue(item, tf) {
  if (tf === "30d") return item.change_30d_pct ?? item.change_5d_pct ?? item.change_pct;
  if (tf === "5d") return item.change_5d_pct ?? item.change_pct;
  return item.change_pct;
}

function getSparklineSeries(q, tf) {
  if (tf === "1d") {
    if (Array.isArray(q.sparkline_1d) && q.sparkline_1d.length >= 2) return q.sparkline_1d;
    return Array.isArray(q.sparkline_30d) ? q.sparkline_30d : [];
  }
  if (tf === "5d") {
    if (Array.isArray(q.sparkline_5d) && q.sparkline_5d.length >= 2) return q.sparkline_5d;
    return Array.isArray(q.sparkline_30d) ? q.sparkline_30d.slice(-6) : [];
  }
  return Array.isArray(q.sparkline_30d) ? q.sparkline_30d : [];
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
      const series = getSparklineSeries(q, tf);
      return `
        <div class="quote-card">
          <div class="quote-top">
            <span class="quote-name">${escapeHtml(q.name)}</span>
            <span class="quote-sym">${escapeHtml(q.symbol)}</span>
          </div>
          <div class="quote-mid">
            <span class="quote-price">${fmtPrice(q.price, q.symbol)}</span>
            <span class="delta-pill ${cls}">${fmtPct(pct)}</span>
          </div>
          <div class="sparkline-wrap" data-symbol="${escapeHtml(q.symbol)}" data-values="${escapeHtml(JSON.stringify(series))}">
            <div class="spark-tooltip hidden"></div>
            ${buildSparklineSvg(series, stroke, "sparkline", true)}
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

function renderMarkets(markets = {}) {
  const regime = markets.regime_tag || "Mixed";
  const regimeSlug = regime.toLowerCase().replace(/\s+/g, "-");
  els.marketRegime.textContent = regime;
  els.marketRegime.className = `regime-badge ${regimeSlug}`;
  els.marketNarrative.innerHTML = highlightSummaryHtml(markets.narrative || "");

  const tf = state.marketTimeframe;
  const tfLabels = {
    "1d": "Daily ETF performance (SPDR Select Sectors)",
    "5d": "5-day rolling ETF performance (SPDR Select Sectors)",
    "30d": "30-day rolling ETF performance (SPDR Select Sectors)",
  };
  els.heatmapLabel.textContent = tfLabels[tf] || tfLabels["1d"];

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
          "1d": "Mega-cap tech leaders (1D change · 30m chart)",
          "5d": "Mega-cap tech leaders (5D change · 1h chart)",
          "30d": "Mega-cap tech leaders (30D change · daily chart)",
        };
        els.big7Label.textContent = big7Sub[tf] || big7Sub["1d"];
      }
      renderQuoteGrid(els.big7Grid, big7, tf, "");
    }
  }

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
              <a href="${safeUrl(ev.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(ev.headline)}</a>
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
              <h3>${escapeHtml(t.name)}</h3>
            </div>
            <span class="status-badge ${escapeHtml(t.status)}">${escapeHtml(t.status)}</span>
          </div>

          <div class="intensity-row">
            <div class="intensity-meta">
              14D GDELT Intensity: <strong>${Number(t.intensity_score || 0).toFixed(0)}</strong>
              &middot; 7D: <strong>${trendArrow[t.trend_7d] || "→ Steady"}</strong>
            </div>
            ${buildSparklineSvg(t.intensity_series_14d, sparkColor, "intensity-spark")}
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
        return `
          <a class="poly-card" href="${safeUrl(m.url)}" target="_blank" rel="noopener noreferrer">
            <div class="poly-top">
              <span class="poly-q">${escapeHtml(m.question)}</span>
              <div class="poly-odds">
                <div class="poly-pct">${pct}%</div>
              </div>
            </div>
            <div class="poly-bar-track">
              <div class="poly-bar-fill" style="width:${pct}%"></div>
            </div>
            <div class="poly-foot">
              <span>${fmtUsdCompact(m.volume_usd)}</span>
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
              <a class="policy-title" href="${safeUrl(p.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(p.title)}</a>
              <span class="branch-tag">${escapeHtml(p.chamber_or_branch)}</span>
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
              <span class="topic-name">${escapeHtml(t.topic)}</span>
              <span class="momentum-pill ${escapeHtml(t.momentum)}">${escapeHtml(t.momentum)}</span>
            </div>
            <p class="topic-note">${highlightSummaryHtml(t.framing_note)}</p>
          </article>
        `
      )
      .join("");
  }
}

function renderAll(briefing) {
  state.briefing = briefing;
  els.editionDate.textContent = fmtReadableDate(briefing.date);
  els.generatedMeta.textContent = `Updated ${fmtLocalTimestamp(briefing.generated_at)} · Automated Daily Intelligence Edition`;
  renderSourceHealth(briefing.source_health);
  renderKpiStrip(briefing);
  renderExecutiveBrief(briefing);
  renderNews(briefing.top_news);
  renderMarkets(briefing.markets);
  renderConflicts(briefing.conflicts);
  renderPolitics(briefing.us_politics);
}

/* ---------- Archive Navigation & Data Loading ---------- */

function updateArchiveButtons() {
  const dates = state.index?.dates || [];
  const idx = dates.indexOf(state.currentDate);
  // dates are sorted newest-first: index 0 is newest, index length-1 is oldest
  els.btnNextDay.disabled = idx <= 0;
  els.btnPrevDay.disabled = idx === -1 || idx >= dates.length - 1;
}

async function loadBriefingForDate(dateStr) {
  els.statusBanner.classList.add("hidden");
  const url = dateStr
    ? `${DATA_BASE}/archive/${encodeURIComponent(dateStr)}.json`
    : `${DATA_BASE}/latest.json`;

  try {
    const resp = await fetch(url, { cache: "no-store" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    state.currentDate = data.date;
    if (els.dateSelect.value !== data.date) {
      els.dateSelect.value = data.date;
    }
    const qs = new URLSearchParams(window.location.search);
    qs.set("date", data.date);
    window.history.replaceState(null, "", `?${qs.toString()}`);

    updateArchiveButtons();
    renderAll(data);
  } catch (err) {
    els.statusBanner.textContent = `Could not load briefing data (${err.message}). Run the daily pipeline or check briefing/data/.`;
    els.statusBanner.classList.remove("hidden");
  }
}

function initScrollSpy() {
  const nav = document.querySelector(".section-nav");
  const links = [...document.querySelectorAll(".nav-links a[href^='#']")];
  const pairs = links
    .map((link) => {
      const id = link.getAttribute("href").slice(1);
      const section = document.getElementById(id);
      return section ? { link, section } : null;
    })
    .filter(Boolean);

  if (!pairs.length) return;

  const updateActive = () => {
    const navH = nav ? nav.getBoundingClientRect().height : 44;
    const atBottom =
      window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 40;

    let activePair = pairs[0];
    if (atBottom) {
      activePair = pairs[pairs.length - 1];
    } else {
      const threshold = navH + 36;
      for (const pair of pairs) {
        if (pair.section.getBoundingClientRect().top <= threshold) {
          activePair = pair;
        }
      }
    }

    for (const { link } of pairs) {
      const isActive = link === activePair.link;
      link.classList.toggle("active", isActive);
      if (isActive) {
        link.setAttribute("aria-current", "location");
      } else {
        link.removeAttribute("aria-current");
      }
    }
  };

  let ticking = false;
  window.addEventListener(
    "scroll",
    () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(() => {
        updateActive();
        ticking = false;
      });
    },
    { passive: true }
  );

  updateActive();
}

function initSparklineHover() {
  const marketsSection = document.getElementById("markets");
  if (!marketsSection) return;

  const clearHover = (wrap) => {
    if (!wrap) return;
    wrap.classList.remove("hovering");
    const tip = wrap.querySelector(".spark-tooltip");
    if (tip) tip.classList.add("hidden");
  };

  let activeWrap = null;

  marketsSection.addEventListener("pointermove", (e) => {
    const wrap = e.target.closest(".sparkline-wrap");
    if (!wrap) {
      if (activeWrap) {
        clearHover(activeWrap);
        activeWrap = null;
      }
      return;
    }
    if (activeWrap && activeWrap !== wrap) {
      clearHover(activeWrap);
    }
    activeWrap = wrap;

    let values;
    try {
      values = JSON.parse(wrap.dataset.values || "[]");
    } catch {
      return;
    }
    if (!Array.isArray(values) || values.length < 2) return;

    const rect = wrap.getBoundingClientRect();
    if (!rect.width) return;

    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const idx = Math.round(ratio * (values.length - 1));
    const val = values[idx];

    const w = 120;
    const h = 32;
    const pad = 3;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const ptX = (idx / (values.length - 1)) * w;
    const ptY = h - pad - ((val - min) / span) * (h - pad * 2);

    const guide = wrap.querySelector(".spark-guide");
    const dot = wrap.querySelector(".spark-dot");
    const tip = wrap.querySelector(".spark-tooltip");
    if (guide) {
      guide.setAttribute("x1", ptX.toFixed(1));
      guide.setAttribute("x2", ptX.toFixed(1));
    }
    if (dot) {
      dot.setAttribute("cx", ptX.toFixed(1));
      dot.setAttribute("cy", ptY.toFixed(1));
    }
    if (tip) {
      tip.textContent = fmtPrice(val, wrap.dataset.symbol);
      const pctLeft = Math.max(14, Math.min(86, (ptX / w) * 100));
      tip.style.left = `${pctLeft.toFixed(1)}%`;
      tip.classList.remove("hidden");
    }
    wrap.classList.add("hovering");
  });

  marketsSection.addEventListener("pointerleave", () => {
    if (activeWrap) {
      clearHover(activeWrap);
      activeWrap = null;
    }
  });
}

async function bootstrap() {
  initTheme();
  initScrollSpy();
  initSparklineHover();

  // News category filters
  els.newsFilters.addEventListener("click", (e) => {
    const btn = e.target.closest(".filter-btn");
    if (!btn) return;
    state.newsCategory = btn.dataset.category;
    els.newsFilters.querySelectorAll(".filter-btn").forEach((b) => {
      const active = b === btn;
      b.classList.toggle("active", active);
      b.setAttribute("aria-selected", String(active));
    });
    if (state.briefing) renderNews(state.briefing.top_news);
  });

  // Market timeframe toggle (1D / 5D / 30D)
  const tfBtns = [els.btnTf1d, els.btnTf5d, els.btnTf30d].filter(Boolean);
  tfBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      state.marketTimeframe = btn.dataset.tf;
      tfBtns.forEach((b) => b.classList.toggle("active", b === btn));
      if (state.briefing) renderMarkets(state.briefing.markets);
    });
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
      loadBriefingForDate(dates[idx - 1]);
    }
  });

  // Fetch archive manifest
  try {
    const idxResp = await fetch(`${DATA_BASE}/index.json`, { cache: "no-store" });
    if (idxResp.ok) {
      state.index = await idxResp.json();
      const dates = state.index.dates || [];
      if (dates.length) {
        els.dateSelect.innerHTML = dates
          .map((d) => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`)
          .join("");
      }
    }
  } catch {
    // Fall back cleanly to latest.json
  }

  const requested = new URLSearchParams(window.location.search).get("date");
  const initialDate =
    requested && state.index?.dates?.includes(requested)
      ? requested
      : state.index?.latest_date || null;

  await loadBriefingForDate(initialDate);
}

bootstrap();

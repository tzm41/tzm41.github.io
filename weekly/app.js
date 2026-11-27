/**
 * Weekly Briefing — Client Application (Zero-Build ES Module)
 * Inherits UI, theme, entity, Wikipedia link, and tooltip engines from ../shared/
 */

import { initCountryMapTooltip, loadWorldAtlas } from "../briefing/country-map.js?v=14";
import {
  escapeHtml,
  safeUrl,
  fmtReadableDate,
  fmtLocalTimestamp,
  initTheme,
  initScrollSpy,
  createCollapsibleManager,
  renderSourceChip,
  renderHashedTag,
  initSourceBiasPopover,
  renderSentimentRing,
} from "../shared/ui.js?v=2";
import {
  DEFAULT_PERSON_NAME_RE,
  buildPersonNameRegexFromTexts,
  createEntityFormatter,
  initFloatingTooltips,
  renderCountryFlagImg,
} from "../shared/entities.js?v=2";

const DATA_BASE = "./data";
const SHARED_DATA_BASE = "../briefing/data";

const state = {
  index: null,
  currentDate: null,
  viewingLatest: true,
  edition: null,
  companyFacts: null,
  countryLeaders: null,
  personNameRe: null,
};

const els = {
  editionDate: document.getElementById("edition-date"),
  generatedMeta: document.getElementById("generated-meta"),
  dateSelect: document.getElementById("date-select"),
  btnPrevWeek: document.getElementById("btn-prev-week"),
  btnNextWeek: document.getElementById("btn-next-week"),
  btnExpandAll: document.getElementById("btn-expand-all"),
  btnRefresh: document.getElementById("btn-refresh"),
  themeToggle: document.getElementById("theme-toggle"),
  statusBanner: document.getElementById("status-banner"),
  digestList: document.getElementById("weekly-digest-list"),
  featuredQuoteCard: document.getElementById("featured-quote-card"),
  scienceNarrative: document.getElementById("science-narrative"),
  scienceGrid: document.getElementById("science-grid"),
  cultureNarrative: document.getElementById("culture-narrative"),
  cultureGrid: document.getElementById("culture-grid"),
  historyNarrative: document.getElementById("history-narrative"),
  historyGrid: document.getElementById("history-grid"),
  milestonesBlock: document.getElementById("milestones-block"),
  milestonesNote: document.getElementById("milestones-note"),
  historyTimeline: document.getElementById("history-timeline"),
  aroundWorldSection: document.getElementById("around-world"),
  worldMapStage: document.getElementById("world-map-stage"),
  worldMapSvg: document.getElementById("world-map-svg"),
  worldMapPins: document.getElementById("world-map-pins"),
  worldMapPopover: document.getElementById("world-map-popover"),
  worldMapMobileSlot: document.getElementById("world-map-mobile-slot"),
  worldMapLegend: document.getElementById("world-map-legend"),
  longreadsGrid: document.getElementById("longreads-grid"),
  pulseList: document.getElementById("pulse-list"),
  sourceHealth: document.getElementById("source-health"),
};

const { formatEntitiesInPlain, highlightSummaryHtml } = createEntityFormatter({
  getPersonRe: () => state.personNameRe || DEFAULT_PERSON_NAME_RE,
  pillCompaniesInSummary: false,
});

const collapsibles = createCollapsibleManager(els.btnExpandAll);

/* ---------- Status & Helpers ---------- */

function showBanner(msg, type = "info") {
  if (!els.statusBanner) return;
  if (!msg) {
    els.statusBanner.classList.add("hidden");
    els.statusBanner.textContent = "";
    return;
  }
  els.statusBanner.textContent = msg;
  els.statusBanner.className = `status-banner ${type}`;
}

function collectEditionTexts(ed) {
  const texts = [];
  for (const b of ed.digest || []) {
    texts.push(typeof b === "string" ? b : b?.text || "");
  }
  if (ed.featured_quote) {
    texts.push(ed.featured_quote.quote || "", ed.featured_quote.author || "", ed.featured_quote.context || "");
  }
  for (const key of ["science", "culture", "history"]) {
    const sec = ed[key];
    if (!sec) continue;
    texts.push(sec.narrative || "");
    for (const item of sec.items || []) {
      texts.push(item.headline || "", item.summary || "", item.takeaway || "");
    }
  }
  for (const m of ed.this_week_in_history || []) {
    texts.push(m.title || "", m.summary || "");
  }
  for (const g of ed.around_the_world || []) {
    texts.push(g.place || "", g.region || "", g.title || "", g.fact || "");
  }
  for (const lr of ed.long_reads || []) {
    texts.push(lr.headline || "", lr.summary || "");
  }
  for (const p of ed.week_in_brief || []) {
    texts.push(typeof p === "string" ? p : p?.text || "");
  }
  return texts;
}

/* ---------- Renderers ---------- */

function renderHeader(ed) {
  const label = ed.week_label || fmtReadableDate(ed.date);
  els.editionDate.textContent = label;
  const themeSuffix = ed.theme_title ? ` · Theme: ${ed.theme_title}` : "";
  els.generatedMeta.textContent = `Published ${fmtLocalTimestamp(ed.generated_at)}${themeSuffix}`;
}

function renderBriefBullets(bullets = []) {
  return bullets
    .map((item) => {
      const text = typeof item === "string" ? item : item?.text || "";
      const category = typeof item === "object" && item?.category ? item.category : "Weekly";
      const sentiment = typeof item === "object" ? item?.sentiment : null;
      return `
        <li>
          <span class="exec-meta">
            ${renderSentimentRing(sentiment, text)}
            <span class="cat-pill">${escapeHtml(category)}</span>
          </span>
          <span class="exec-text">${highlightSummaryHtml(text)}</span>
        </li>
      `;
    })
    .join("");
}

function renderDigest(ed) {
  const bullets = ed.digest || [];
  if (!bullets.length) {
    els.digestList.innerHTML = `<li class="empty-note">No weekly digest bullets available for this edition.</li>`;
    return;
  }
  els.digestList.innerHTML = renderBriefBullets(bullets);
}

function renderFeaturedQuote(ed) {
  const q = ed.featured_quote;
  if (!q || !q.quote) {
    els.featuredQuoteCard.classList.add("hidden");
    els.featuredQuoteCard.innerHTML = "";
    return;
  }
  els.featuredQuoteCard.classList.remove("hidden");
  const contextHtml = q.context
    ? `<span class="quote-card-context">&mdash; ${formatEntitiesInPlain(q.context)}</span>`
    : "";
  els.featuredQuoteCard.innerHTML = `
    <span class="quote-card-kicker">Idea &amp; Quote of the Week</span>
    <blockquote>&ldquo;${formatEntitiesInPlain(q.quote)}&rdquo;</blockquote>
    <div class="quote-card-meta">
      <span class="quote-card-author">${formatEntitiesInPlain(q.author || "")}</span>
      ${contextHtml}
    </div>
  `;
}

function renderLearningCard(item) {
  const headlineUrl = safeUrl(item.sources?.[0]?.url);
  const headlineHtml = headlineUrl
    ? `<a href="${headlineUrl}" target="_blank" rel="noopener noreferrer">${formatEntitiesInPlain(item.headline)}</a>`
    : formatEntitiesInPlain(item.headline);

  const sourcesHtml = (item.sources || []).slice(0, 3).map(renderSourceChip).join("");
  const ringHtml = renderSentimentRing(item.sentiment, `${item.headline || ""} ${item.summary || ""}`);
  const disciplineHtml = item.discipline
    ? `<span class="discipline-tag">${escapeHtml(item.discipline)}</span>`
    : "";
  const takeawayHtml = item.takeaway
    ? `<p class="weekly-takeaway"><span class="weekly-takeaway-label">Takeaway</span>${highlightSummaryHtml(item.takeaway)}</p>`
    : "";

  return `
    <article class="news-card">
      <div class="news-meta">
        <div class="news-card-badges">
          ${renderHashedTag(item.category || "Learning")}
          ${ringHtml}
        </div>
        ${disciplineHtml}
      </div>
      <h3>${headlineHtml}</h3>
      <p class="news-summary">${highlightSummaryHtml(item.summary)}</p>
      ${takeawayHtml}
      <div class="source-links">${sourcesHtml}</div>
    </article>
  `;
}

function renderLearningSection(secData, narrativeEl, gridEl, emptyMsg) {
  const narrative = secData?.narrative || "";
  const items = secData?.items || [];
  narrativeEl.innerHTML = narrative ? highlightSummaryHtml(narrative) : "";
  if (!items.length) {
    gridEl.innerHTML = `<p class="empty-note">${escapeHtml(emptyMsg)}</p>`;
    return;
  }
  gridEl.innerHTML = items.map(renderLearningCard).join("");
}

function renderHistoryMilestones(ed) {
  const milestones = ed.this_week_in_history || [];
  if (!milestones.length) {
    els.milestonesBlock.classList.add("hidden");
    els.historyTimeline.innerHTML = "";
    return;
  }
  els.milestonesBlock.classList.remove("hidden");
  if (ed.week_label) {
    els.milestonesNote.textContent = `Anniversaries for ${ed.week_label}`;
  }
  els.historyTimeline.innerHTML = milestones
    .map(
      (m) => `
      <article class="history-milestone">
        <div class="milestone-year-col">
          <span class="milestone-year">${escapeHtml(String(m.year ?? ""))}</span>
          ${m.date_label ? `<span class="milestone-date">${escapeHtml(m.date_label)}</span>` : ""}
        </div>
        <div class="milestone-body">
          <h4 class="milestone-title">${formatEntitiesInPlain(m.title)}</h4>
          <p class="milestone-summary">${highlightSummaryHtml(m.summary)}</p>
        </div>
      </article>
    `
    )
    .join("");
}

/* ---------- Around the World — Interactive Geological Map ---------- */

const WORLD_MAP_W = 960;
const WORLD_MAP_H = 440;
const WORLD_LON_MIN = -170;
const WORLD_LON_MAX = 180;
const WORLD_LAT_MIN = -56;
const WORLD_LAT_MAX = 78;

function projectWorld(lon, lat) {
  const x = ((lon - WORLD_LON_MIN) / (WORLD_LON_MAX - WORLD_LON_MIN)) * WORLD_MAP_W;
  const y = ((WORLD_LAT_MAX - lat) / (WORLD_LAT_MAX - WORLD_LAT_MIN)) * WORLD_MAP_H;
  return [x, y];
}

function fmtCoords(lat, lon) {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(1)}°${ns}, ${Math.abs(lon).toFixed(1)}°${ew}`;
}

function buildWorldBaseSvg(features) {
  const ringToPath = (ring) => {
    let d = "";
    for (let i = 0; i < ring.length; i++) {
      const [lon, lat] = ring[i];
      const [x, y] = projectWorld(lon, lat);
      if (i > 0 && Math.abs(lon - ring[i - 1][0]) > 180) {
        d += `M${x.toFixed(1)},${y.toFixed(1)}`;
        continue;
      }
      d += `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    }
    return d ? `${d}Z` : "";
  };

  let landPaths = "";
  for (const f of features) {
    if (f.id === "010") continue; // Skip Antarctica for cleaner inhabited-world framing
    for (const r of f.rings) {
      const p = ringToPath(r);
      if (p) landPaths += p;
    }
  }

  const latLines = [-30, 0, 30, 60]
    .map((lat) => {
      const [, y] = projectWorld(0, lat);
      const cls = lat === 0 ? "world-map-equator" : "world-map-graticule";
      return `<line class="${cls}" x1="0" y1="${y.toFixed(1)}" x2="${WORLD_MAP_W}" y2="${y.toFixed(1)}"/>`;
    })
    .join("");

  const lonLines = [-120, -60, 0, 60, 120]
    .map((lon) => {
      const [x] = projectWorld(lon, 0);
      return `<line class="world-map-graticule" x1="${x.toFixed(1)}" y1="0" x2="${x.toFixed(1)}" y2="${WORLD_MAP_H}"/>`;
    })
    .join("");

  return `
    <svg class="world-map-svg" viewBox="0 0 ${WORLD_MAP_W} ${WORLD_MAP_H}" preserveAspectRatio="none" aria-hidden="true">
      ${latLines}
      ${lonLines}
      <path class="world-map-land" d="${landPaths}"/>
    </svg>
  `;
}

let worldMapSvgReady = false;
let worldMapEventsBound = false;
let activeGeoId = null;
let pinnedGeoId = null;
let geoHideTimer = null;
let currentGeoItems = [];

function buildGeoCardHtml(item, showClose = true) {
  const flagHtml = item.country_code ? renderCountryFlagImg(item.country_code.toLowerCase()) : "";
  const coords = fmtCoords(Number(item.lat ?? 0), Number(item.lon ?? 0));
  const wikiTitle = item.wiki_title || item.place || "";
  const wikiUrl = wikiTitle
    ? `https://en.wikipedia.org/wiki/${encodeURIComponent(String(wikiTitle).replace(/ /g, "_"))}`
    : "";
  return `
    <div class="geo-fact-head">
      <div class="geo-fact-loc-row">
        ${flagHtml}
        <span class="geo-fact-place">${escapeHtml(item.place)}</span>
        <span>&middot; ${escapeHtml(item.region || "")}</span>
        <span class="geo-fact-coords">(${escapeHtml(coords)})</span>
      </div>
      ${showClose ? `<button type="button" class="geo-fact-close" aria-label="Close geological fact">&times;</button>` : ""}
    </div>
    <h4 class="geo-fact-title">${formatEntitiesInPlain(item.title)}</h4>
    <p class="geo-fact-body">${highlightSummaryHtml(item.fact)}</p>
    <div class="geo-fact-foot">
      ${renderHashedTag(item.feature_type || "Geology")}
      ${wikiUrl ? `<a class="geo-fact-wiki" href="${wikiUrl}" target="_blank" rel="noopener noreferrer">Wikipedia &nearr;</a>` : ""}
    </div>
  `;
}

function setGeoActiveState(id) {
  activeGeoId = id;
  els.worldMapPins?.querySelectorAll(".geo-pin").forEach((btn) => {
    const active = btn.dataset.geoId === id;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-pressed", String(active));
  });
  els.worldMapLegend?.querySelectorAll(".geo-chip").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.geoId === id);
  });
}

function hideGeoCard(force = false) {
  if (!force && pinnedGeoId) return;
  if (force) pinnedGeoId = null;
  setGeoActiveState(null);
  els.worldMapPopover?.classList.add("hidden");
  els.worldMapMobileSlot?.classList.add("hidden");
}

function showGeoCard(item, { pin = false } = {}) {
  if (!item || !els.worldMapStage || !els.worldMapPopover) return;
  if (geoHideTimer) {
    clearTimeout(geoHideTimer);
    geoHideTimer = null;
  }
  if (pin) pinnedGeoId = item.id;
  setGeoActiveState(item.id);

  // Desktop floating popover
  els.worldMapPopover.innerHTML = buildGeoCardHtml(item, true);
  els.worldMapPopover.classList.remove("hidden");

  // Position cleanly inside the map stage
  const stageW = els.worldMapStage.clientWidth || WORLD_MAP_W;
  const stageH = els.worldMapStage.clientHeight || WORLD_MAP_H;
  const [px, py] = projectWorld(Number(item.lon ?? 0), Number(item.lat ?? 0));
  const pinX = (px / WORLD_MAP_W) * stageW;
  const pinY = (py / WORLD_MAP_H) * stageH;
  const cardW = els.worldMapPopover.offsetWidth || 320;
  const cardH = els.worldMapPopover.offsetHeight || 190;
  const margin = 10;

  let left = pinX > stageW * 0.52 ? pinX - cardW - 18 : pinX + 18;
  left = Math.max(margin, Math.min(stageW - cardW - margin, left));

  let top = pinY > stageH * 0.56 ? pinY - cardH - 14 : pinY + 14;
  top = Math.max(margin, Math.min(stageH - cardH - margin, top));

  els.worldMapPopover.style.left = `${Math.round(left)}px`;
  els.worldMapPopover.style.top = `${Math.round(top)}px`;

  // Mobile docked card below map
  if (els.worldMapMobileSlot) {
    els.worldMapMobileSlot.innerHTML = buildGeoCardHtml(item, true);
    els.worldMapMobileSlot.classList.remove("hidden");
  }
}

function bindWorldMapEvents() {
  if (worldMapEventsBound) return;
  worldMapEventsBound = true;

  const scheduleHide = () => {
    if (pinnedGeoId) return;
    if (geoHideTimer) clearTimeout(geoHideTimer);
    geoHideTimer = setTimeout(() => hideGeoCard(false), 160);
  };

  const findItem = (id) => currentGeoItems.find((g) => g.id === id);

  els.worldMapPins?.addEventListener("pointerenter", (e) => {
    if (e.pointerType === "touch") return;
    const btn = e.target.closest?.(".geo-pin");
    if (!btn) return;
    const item = findItem(btn.dataset.geoId);
    if (item) showGeoCard(item, { pin: false });
  }, true);

  els.worldMapPins?.addEventListener("pointerleave", (e) => {
    if (e.pointerType === "touch") return;
    if (e.target.closest?.(".geo-pin")) scheduleHide();
  }, true);

  els.worldMapPins?.addEventListener("focusin", (e) => {
    const btn = e.target.closest?.(".geo-pin");
    if (!btn) return;
    const item = findItem(btn.dataset.geoId);
    if (item) showGeoCard(item, { pin: false });
  });

  els.worldMapPins?.addEventListener("click", (e) => {
    const btn = e.target.closest?.(".geo-pin");
    if (!btn) return;
    e.stopPropagation();
    const item = findItem(btn.dataset.geoId);
    if (!item) return;
    if (pinnedGeoId === item.id) {
      hideGeoCard(true);
    } else {
      showGeoCard(item, { pin: true });
    }
  });

  els.worldMapLegend?.addEventListener("pointerenter", (e) => {
    if (e.pointerType === "touch") return;
    const chip = e.target.closest?.(".geo-chip");
    if (!chip) return;
    const item = findItem(chip.dataset.geoId);
    if (item) showGeoCard(item, { pin: false });
  }, true);

  els.worldMapLegend?.addEventListener("pointerleave", (e) => {
    if (e.pointerType === "touch") return;
    if (e.target.closest?.(".geo-chip")) scheduleHide();
  }, true);

  els.worldMapLegend?.addEventListener("click", (e) => {
    const chip = e.target.closest?.(".geo-chip");
    if (!chip) return;
    e.stopPropagation();
    const item = findItem(chip.dataset.geoId);
    if (!item) return;
    if (pinnedGeoId === item.id) {
      hideGeoCard(true);
    } else {
      showGeoCard(item, { pin: true });
    }
  });

  els.worldMapPopover?.addEventListener("pointerenter", () => {
    if (geoHideTimer) {
      clearTimeout(geoHideTimer);
      geoHideTimer = null;
    }
  });

  els.worldMapPopover?.addEventListener("pointerleave", () => {
    scheduleHide();
  });

  els.worldMapPopover?.addEventListener("click", (e) => {
    if (e.target.closest?.(".geo-fact-close")) {
      e.stopPropagation();
      hideGeoCard(true);
    }
  });

  els.worldMapMobileSlot?.addEventListener("click", (e) => {
    if (e.target.closest?.(".geo-fact-close")) {
      e.stopPropagation();
      hideGeoCard(true);
    }
  });

  document.addEventListener("click", (e) => {
    if (!activeGeoId && !pinnedGeoId) return;
    if (
      e.target.closest?.(".geo-pin") ||
      e.target.closest?.(".geo-chip") ||
      e.target.closest?.(".geo-fact-popover") ||
      e.target.closest?.(".geo-mobile-card")
    ) {
      return;
    }
    hideGeoCard(true);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && (activeGeoId || pinnedGeoId)) hideGeoCard(true);
  });
}

function renderAroundTheWorld(ed) {
  const items = ed.around_the_world || [];
  currentGeoItems = items;
  hideGeoCard(true);

  if (!items.length) {
    els.aroundWorldSection?.classList.add("hidden");
    return;
  }
  els.aroundWorldSection?.classList.remove("hidden");

  if (!worldMapSvgReady && els.worldMapSvg) {
    loadWorldAtlas()
      .then((features) => {
        if (!els.worldMapSvg) return;
        els.worldMapSvg.innerHTML = buildWorldBaseSvg(features);
        worldMapSvgReady = true;
      })
      .catch((err) => {
        console.warn("[weekly] World map failed to load:", err);
      });
  }

  if (els.worldMapPins) {
    els.worldMapPins.innerHTML = items
      .map((item) => {
        const [x, y] = projectWorld(Number(item.lon ?? 0), Number(item.lat ?? 0));
        const leftPct = Math.max(2, Math.min(98, (x / WORLD_MAP_W) * 100));
        const topPct = Math.max(4, Math.min(96, (y / WORLD_MAP_H) * 100));
        const label = `${item.place}, ${item.region} — ${item.title}`;
        return `
          <button
            type="button"
            class="geo-pin"
            data-geo-id="${escapeHtml(item.id)}"
            style="left:${leftPct.toFixed(2)}%;top:${topPct.toFixed(2)}%;"
            aria-label="${escapeHtml(label)}"
            aria-pressed="false"
            title="${escapeHtml(item.place)}"
          >
            <span class="geo-pin-halo" aria-hidden="true"></span>
            <span class="geo-pin-core" aria-hidden="true"></span>
          </button>
        `;
      })
      .join("");
  }

  if (els.worldMapLegend) {
    els.worldMapLegend.innerHTML = items
      .map((item) => {
        const flagHtml = item.country_code ? renderCountryFlagImg(item.country_code.toLowerCase()) : "";
        return `
          <button type="button" class="geo-chip" data-geo-id="${escapeHtml(item.id)}">
            <span class="geo-chip-dot" aria-hidden="true"></span>
            ${flagHtml}
            <span>${escapeHtml(item.place)}</span>
          </button>
        `;
      })
      .join("");
  }

  bindWorldMapEvents();
}

function renderLongReads(ed) {
  const items = ed.long_reads || [];
  if (!items.length) {
    els.longreadsGrid.innerHTML = `<p class="empty-note">No long reads curated for this edition.</p>`;
    return;
  }
  els.longreadsGrid.innerHTML = items
    .map((lr) => {
      const headlineUrl = safeUrl(lr.sources?.[0]?.url);
      const headlineHtml = headlineUrl
        ? `<a href="${headlineUrl}" target="_blank" rel="noopener noreferrer">${formatEntitiesInPlain(lr.headline)}</a>`
        : formatEntitiesInPlain(lr.headline);
      const sourcesHtml = (lr.sources || []).slice(0, 3).map(renderSourceChip).join("");
      const timeHtml = lr.reading_time
        ? `<span class="reading-time-tag">${escapeHtml(lr.reading_time)}</span>`
        : "";
      return `
        <article class="news-card">
          <div class="news-meta">
            <div class="news-card-badges">
              ${renderHashedTag(lr.topic || "Essay")}
            </div>
            ${timeHtml}
          </div>
          <h3>${headlineHtml}</h3>
          <p class="news-summary">${highlightSummaryHtml(lr.summary)}</p>
          <div class="source-links">${sourcesHtml}</div>
        </article>
      `;
    })
    .join("");
}

function renderWeekInBrief(ed) {
  const items = ed.week_in_brief || [];
  if (!items.length) {
    els.pulseList.innerHTML = `<li class="empty-note">No macro recap available for this week.</li>`;
    return;
  }
  els.pulseList.innerHTML = renderBriefBullets(items);
}

function renderSourceHealth(health = {}) {
  const entries = [
    ["Science", health.science],
    ["Culture & Arts", health.culture],
    ["History", health.history],
    ["Long Reads", health.long_reads],
  ];
  els.sourceHealth.innerHTML = entries
    .map(([label, status]) => {
      const cls = status === "ok" ? "ok" : status === "partial" ? "partial" : "failed";
      return `<span class="health-pill ${cls}" title="${label}: ${status || "unknown"}"><span class="dot"></span>${label}</span>`;
    })
    .join("");
}

function renderEdition(ed) {
  state.edition = ed;
  state.currentDate = ed.date;
  state.personNameRe = buildPersonNameRegexFromTexts(collectEditionTexts(ed), state.companyFacts);

  renderHeader(ed);
  renderDigest(ed);
  renderFeaturedQuote(ed);
  renderLearningSection(ed.science, els.scienceNarrative, els.scienceGrid, "No science learnings available.");
  renderLearningSection(ed.culture, els.cultureNarrative, els.cultureGrid, "No culture & arts stories available.");
  renderLearningSection(ed.history, els.historyNarrative, els.historyGrid, "No history stories available.");
  renderHistoryMilestones(ed);
  renderAroundTheWorld(ed);
  renderLongReads(ed);
  renderWeekInBrief(ed);
  renderSourceHealth(ed.source_health);

  updateArchiveControls();
  showBanner("");
}

/* ---------- Archive Navigation & Data Loading ---------- */

async function fetchJson(url) {
  const resp = await fetch(url, { cache: "no-store" });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
  return resp.json();
}

function populateDateSelect(index) {
  const dates = index?.dates || [];
  els.dateSelect.innerHTML = "";

  const latestOpt = document.createElement("option");
  latestOpt.value = "latest";
  latestOpt.textContent = "Latest";
  els.dateSelect.appendChild(latestOpt);

  for (const d of dates) {
    const opt = document.createElement("option");
    opt.value = d;
    opt.textContent = d;
    els.dateSelect.appendChild(opt);
  }
}

function updateArchiveControls() {
  const dates = state.index?.dates || [];
  const idx = dates.indexOf(state.currentDate);
  els.dateSelect.value = state.viewingLatest ? "latest" : state.currentDate || "latest";
  els.btnPrevWeek.disabled = idx === -1 || idx >= dates.length - 1;
  els.btnNextWeek.disabled = idx <= 0;
}

async function loadEdition(dateOrLatest = "latest", pushUrl = true) {
  try {
    const isLatest = !dateOrLatest || dateOrLatest === "latest";
    state.viewingLatest = isLatest;
    const url = isLatest
      ? `${DATA_BASE}/latest.json?t=${Date.now()}`
      : `${DATA_BASE}/archive/${encodeURIComponent(dateOrLatest)}.json`;

    const ed = await fetchJson(url);
    renderEdition(ed);

    if (pushUrl) {
      const target = new URL(window.location.href);
      target.searchParams.set("date", isLatest ? "latest" : ed.date);
      window.history.replaceState({}, "", target);
    }
  } catch (err) {
    console.error(err);
    showBanner(
      "Could not load the Weekly Briefing edition yet. Please refresh in a moment.",
      "error"
    );
  }
}

async function bootstrap() {
  initTheme(els.themeToggle);
  initScrollSpy();
  initSourceBiasPopover();
  initFloatingTooltips(() => state.companyFacts);
  initCountryMapTooltip(
    escapeHtml,
    renderCountryFlagImg,
    (code) => state.countryLeaders?.leaders?.[code] || null
  );

  // Wire collapsible sections (Science, Culture, History, Around the World open by default; Long Reads & Week in Brief collapsed)
  const setScienceOpen = collapsibles.wireCollapsible("btn-toggle-science", "science-body", "#science");
  const setCultureOpen = collapsibles.wireCollapsible("btn-toggle-culture", "culture-body", "#culture");
  const setHistoryOpen = collapsibles.wireCollapsible("btn-toggle-history", "history-body", "#history");
  const setWorldOpen = collapsibles.wireCollapsible("btn-toggle-world", "around-world-body", "#around-world");
  collapsibles.wireCollapsible("btn-toggle-longreads", "longreads-body", "#longreads");
  collapsibles.wireCollapsible("btn-toggle-pulse", "pulse-body", "#pulse");
  setScienceOpen?.(true);
  setCultureOpen?.(true);
  setHistoryOpen?.(true);
  setWorldOpen?.(true);
  collapsibles.syncExpandAllButton();

  els.dateSelect.addEventListener("change", () => {
    loadEdition(els.dateSelect.value);
  });

  els.btnPrevWeek.addEventListener("click", () => {
    const dates = state.index?.dates || [];
    const idx = dates.indexOf(state.currentDate);
    if (idx >= 0 && idx < dates.length - 1) loadEdition(dates[idx + 1]);
  });

  els.btnNextWeek.addEventListener("click", () => {
    const dates = state.index?.dates || [];
    const idx = dates.indexOf(state.currentDate);
    if (idx > 0) loadEdition(idx === 1 ? "latest" : dates[idx - 1]);
  });

  els.btnRefresh?.addEventListener("click", async () => {
    if (els.btnRefresh.disabled) return;
    els.btnRefresh.disabled = true;
    els.btnRefresh.classList.add("is-spinning");
    try {
      const idxData = await fetchJson(`${DATA_BASE}/index.json?t=${Date.now()}`);
      state.index = idxData;
      populateDateSelect(idxData);
      await loadEdition(state.viewingLatest ? "latest" : state.currentDate, false);
    } catch {
      await loadEdition(state.viewingLatest ? "latest" : state.currentDate, false);
    } finally {
      els.btnRefresh.disabled = false;
      els.btnRefresh.classList.remove("is-spinning");
    }
  });

  // Load shared company facts + country leaders + weekly index in parallel
  const [factsRes, leadersRes, idxRes] = await Promise.allSettled([
    fetchJson(`${SHARED_DATA_BASE}/company_facts.json`),
    fetchJson(`${SHARED_DATA_BASE}/country_leaders.json`),
    fetchJson(`${DATA_BASE}/index.json?t=${Date.now()}`),
  ]);

  if (factsRes.status === "fulfilled") state.companyFacts = factsRes.value;
  if (leadersRes.status === "fulfilled") state.countryLeaders = leadersRes.value;
  if (idxRes.status === "fulfilled") {
    state.index = idxRes.value;
    populateDateSelect(idxRes.value);
  }

  const params = new URLSearchParams(window.location.search);
  const requestedDate = params.get("date") || "latest";
  await loadEdition(requestedDate, false);
}

bootstrap();

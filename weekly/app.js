/**
 * Weekly Briefing — Client Application (Zero-Build ES Module)
 * Inherits UI, theme, entity, Wikipedia link, and tooltip engines from ../shared/
 */

import { loadWorldAtlas } from "../shared/country-map.js";
import {
  escapeHtml,
  fmtReadableDate,
  fmtLocalTimestamp,
  fetchJson,
} from "../shared/utils.js";
import {
  initTheme,
  initMasthead,
  renderEditionDate,
  initScrollSpy,
  focusSharedCardFromUrl,
  createCollapsibleManager,
  showToast,
  syncButtonGroup,
  renderSourceHealth as renderSourceHealthStrip,
} from "../shared/ui.js";
import {
  DEFAULT_PERSON_NAME_RE,
  buildPersonNameRegexFromTexts,
  createEntityFormatter,
  ensureEntityShards,
  renderCountryFlagImg,
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
import { initSectionSettings } from "../shared/section-settings.js";
import { createArchiveController } from "../shared/archive-nav.js";
import { initPwa } from "../shared/pwa.js";
import {
  renderBriefBullets as renderSharedBriefBullets,
  renderWeeklyStoryCard,
  renderAroundTheWorldCard,
} from "../shared/cards.js";
import {
  initTts,
  setTtsEnabled,
  tts,
  buildReaderText,
  renderTtsCardButton,
  createTtsRegistry,
  bindTtsTriggers,
} from "../shared/tts.js";

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
  briefStyle: getLocalPreferences().brief_style === "bullets" ? "bullets" : "regular",
};

const bookmarkRegistry = createBookmarkRegistry({
  edition: "weekly",
  getDate: () => state.currentDate || state.edition?.date || "",
});

const ttsRegistry = createTtsRegistry();

function stopTtsIfSection(...sectionIds) {
  const snap = tts.getState();
  if (snap.status === "idle") return;
  if (snap.sectionId && sectionIds.includes(snap.sectionId)) {
    tts.stop();
    return;
  }
  if (snap.currentId && sectionIds.some((sec) => snap.currentId.startsWith(`${sec}:`))) {
    tts.stop();
  }
}

const els = {
  editionDate: document.getElementById("edition-date"),
  generatedMeta: document.getElementById("generated-meta"),
  dateSelect: document.getElementById("date-select"),
  btnPrevWeek: document.getElementById("btn-prev-week"),
  btnNextWeek: document.getElementById("btn-next-week"),
  btnExpandAll: document.getElementById("btn-expand-all"),
  btnRefresh: document.getElementById("btn-refresh"),
  themeToggle: document.getElementById("theme-toggle"),
  authMount: document.getElementById("auth-mount"),
  navBookmarksCount: document.getElementById("nav-bookmarks-count"),
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
  worldKindFilter: document.getElementById("world-kind-filter"),
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

const entityFormatter = createEntityFormatter({
  getPersonRe: () => state.personNameRe || DEFAULT_PERSON_NAME_RE,
  getEntities: () => state.briefing?.entities || null,
  pillCompaniesInSummary: false,
});
const { formatEntitiesInPlain, highlightSummaryHtml } = entityFormatter;

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
  renderEditionDate(els.editionDate, ed.date);
  els.generatedMeta.textContent = `Published ${fmtLocalTimestamp(ed.generated_at)}`;
}

function renderBriefBullets(bullets = [], sectionId = "digest") {
  ttsRegistry.clearSection(sectionId);
  return renderSharedBriefBullets(bullets, {
    highlightSummaryHtml,
    resolveCategory: () => "Weekly",
    bulletStyle: state.briefStyle,
    getTtsId: (_item, idx) => `${sectionId}:${idx}`,
    getTtsButtonHtml: (item, _idx, ttsId) => {
      const built = buildReaderText(item, { kind: "bullet", bulletStyle: state.briefStyle });
      if (!built.text) return "";
      ttsRegistry.register(sectionId, ttsId, built);
      return renderTtsCardButton(ttsId, { title: built.title, variant: "inline" });
    },
  });
}

function renderDigest(ed) {
  const bullets = ed.digest || [];
  if (!bullets.length) {
    ttsRegistry.clearSection("digest");
    els.digestList.innerHTML = `<li class="empty-state">No weekly digest bullets available for this edition.</li>`;
    return;
  }
  els.digestList.innerHTML = renderBriefBullets(bullets, "digest");
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

const LEARNING_SECTION_TITLES = {
  science: "Science & Discovery",
  culture: "Culture & Arts",
  history: "History & Archaeology",
};

function renderLearningCard(item, sectionName) {
  const bookmarkHtml = bookmarkRegistry.register({
    section: sectionName,
    id: item.id || item.headline,
    title: item.headline || "",
    badge: item.category || item.discipline || sectionName,
    source: item.sources?.[0]?.name || "",
    url: item.sources?.[0]?.url || "",
    label: "item",
  });
  const ttsId = `${sectionName}:${item.id || item.headline || ""}`;
  const built = buildReaderText(item, { kind: "weekly" });
  if (built.text) {
    ttsRegistry.register(sectionName, ttsId, built);
  }
  const ttsHtml = built.text ? renderTtsCardButton(ttsId, { title: built.title, variant: "card" }) : "";

  return renderWeeklyStoryCard(item, {
    section: sectionName,
    formatter: entityFormatter,
    bookmarkHtml,
    ttsHtml,
    showSubtypeTag: true,
  });
}

function renderLearningSection(secData, narrativeEl, gridEl, emptyMsg, sectionName) {
  ttsRegistry.clearSection(sectionName);
  const narrative = secData?.narrative || "";
  const items = secData?.items || [];
  narrativeEl.innerHTML = narrative ? highlightSummaryHtml(narrative) : "";
  if (narrative) {
    const builtNarr = buildReaderText(
      { title: LEARNING_SECTION_TITLES[sectionName] || sectionName, narrative },
      { kind: "narrative" }
    );
    if (builtNarr.text) {
      ttsRegistry.register(sectionName, `${sectionName}:narrative`, builtNarr);
    }
  }
  if (!items.length) {
    gridEl.innerHTML = `<p class="empty-state">${escapeHtml(emptyMsg)}</p>`;
    return;
  }
  gridEl.innerHTML = items.map((item) => renderLearningCard(item, sectionName)).join("");
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
let worldKindFilter = "all";

function itemGeoKind(item) {
  return item?.kind === "cuisine" ? "cuisine" : "geology";
}

function buildGeoCardHtml(item, showClose = true) {
  const kind = itemGeoKind(item);
  const kindLabel = kind === "cuisine" ? "Cuisine" : "Geology";
  const wikiTitle = item.wiki_title || item.place || "";
  const wikiUrl = wikiTitle
    ? `https://en.wikipedia.org/wiki/${encodeURIComponent(String(wikiTitle).replace(/ /g, "_"))}`
    : "";
  const bookmarkTitle =
    item.place && item.title ? `${item.place} — ${item.title}` : item.title || item.place || "";
  const bookmarkHtml = bookmarkRegistry.register({
    section: "around_the_world",
    id: item.id || item.place || item.title,
    region: null,
    kind,
    title: bookmarkTitle,
    badge: kindLabel,
    source: wikiUrl ? "Wikipedia" : item.region || "",
    url: wikiUrl,
    label: "item",
  });
  const ttsId = `around_the_world:${item.id || item.place || item.title || ""}`;
  const built = buildReaderText(item, { kind: "geo" });
  if (built.text) {
    ttsRegistry.register("around_the_world", ttsId, built);
  }
  const ttsHtml = built.text ? renderTtsCardButton(ttsId, { title: built.title, variant: "card" }) : "";
  return renderAroundTheWorldCard(item, {
    variant: "popover",
    formatter: entityFormatter,
    bookmarkHtml,
    ttsHtml,
    showClose,
  });
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
  const isCuisine = itemGeoKind(item) === "cuisine";
  els.worldMapPopover.classList.toggle("is-cuisine", isCuisine);
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
    els.worldMapMobileSlot.classList.toggle("is-cuisine", isCuisine);
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
      e.target.closest?.(".geo-mobile-card") ||
      e.target.closest?.(".floating-tip") ||
      e.target.closest?.(".country-map-tip") ||
      e.target.closest?.(".source-popover") ||
      e.target.closest?.(".tts-player")
    ) {
      return;
    }
    hideGeoCard(true);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && (activeGeoId || pinnedGeoId)) hideGeoCard(true);
  });

  els.worldKindFilter?.addEventListener("click", (e) => {
    const btn = e.target.closest?.(".seg-btn");
    if (!btn) return;
    const next = btn.dataset.kind || "all";
    if (next === worldKindFilter) return;
    applyWorldKindFilter(next, { rerender: true });
    setPreference("world_kind_filter", worldKindFilter);
  });
}

function applyWorldKindFilter(kind, { rerender = true } = {}) {
  const valid = ["all", "geology", "cuisine"].includes(kind) ? kind : "all";
  worldKindFilter = valid;
  syncButtonGroup(els.worldKindFilter, (b) => b.dataset.kind === worldKindFilter, "aria-pressed");
  if (rerender && currentGeoItems.length) {
    hideGeoCard(true);
    renderWorldPinsAndLegend();
  }
}

function renderWorldPinsAndLegend() {
  const filtered =
    worldKindFilter === "all"
      ? currentGeoItems
      : currentGeoItems.filter((item) => itemGeoKind(item) === worldKindFilter);

  if (els.worldMapPins) {
    els.worldMapPins.innerHTML = filtered
      .map((item) => {
        const kind = itemGeoKind(item);
        const [x, y] = projectWorld(Number(item.lon ?? 0), Number(item.lat ?? 0));
        const leftPct = Math.max(2, Math.min(98, (x / WORLD_MAP_W) * 100));
        const topPct = Math.max(4, Math.min(96, (y / WORLD_MAP_H) * 100));
        const label = `${item.place}, ${item.region} — ${item.title}`;
        return `
          <button
            type="button"
            class="geo-pin is-${kind}"
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
    els.worldMapLegend.innerHTML = filtered
      .map((item) => {
        const kind = itemGeoKind(item);
        const flagHtml = item.country_code ? renderCountryFlagImg(item.country_code.toLowerCase()) : "";
        return `
          <button type="button" class="geo-chip" data-geo-id="${escapeHtml(item.id)}">
            <span class="geo-chip-dot is-${kind}" aria-hidden="true"></span>
            ${flagHtml}
            <span>${escapeHtml(item.place)}</span>
          </button>
        `;
      })
      .join("");
  }
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

  renderWorldPinsAndLegend();
  bindWorldMapEvents();
}

function renderLongReads(ed) {
  ttsRegistry.clearSection("long_reads");
  const items = ed.long_reads || [];
  if (!items.length) {
    els.longreadsGrid.innerHTML = `<p class="empty-state">No long reads curated for this edition.</p>`;
    return;
  }
  els.longreadsGrid.innerHTML = items
    .map((lr) => {
      const bookmarkHtml = bookmarkRegistry.register({
        section: "long_reads",
        id: lr.id || lr.headline,
        title: lr.headline || "",
        badge: lr.topic || "Essay",
        source: lr.sources?.[0]?.name || "",
        url: lr.sources?.[0]?.url || "",
        label: "item",
      });
      const ttsId = `long_reads:${lr.id || lr.headline || ""}`;
      const built = buildReaderText(lr, { kind: "long_read" });
      if (built.text) {
        ttsRegistry.register("long_reads", ttsId, built);
      }
      const ttsHtml = built.text ? renderTtsCardButton(ttsId, { title: built.title, variant: "card" }) : "";
      return renderWeeklyStoryCard(lr, {
        section: "long_reads",
        formatter: entityFormatter,
        bookmarkHtml,
        ttsHtml,
        showSubtypeTag: true,
      });
    })
    .join("");
}

function renderWeekInBrief(ed) {
  const items = ed.week_in_brief || [];
  if (!items.length) {
    ttsRegistry.clearSection("week_in_brief");
    els.pulseList.innerHTML = `<li class="empty-state">No macro recap available for this week.</li>`;
    return;
  }
  els.pulseList.innerHTML = renderBriefBullets(items, "week_in_brief");
}

function renderSourceHealth(health = {}) {
  renderSourceHealthStrip(els.sourceHealth, [
    ["Science", health.science],
    ["Culture & Arts", health.culture],
    ["History", health.history],
    ["Long Reads", health.long_reads],
  ]);
}

function renderEdition(ed) {
  state.edition = ed;
  state.currentDate = ed.date;
  bookmarkRegistry.clear();
  ttsRegistry.clear();
  state.personNameRe = buildPersonNameRegexFromTexts(collectEditionTexts(ed), state.companyFacts);

  renderHeader(ed);
  renderDigest(ed);
  renderFeaturedQuote(ed);
  renderLearningSection(ed.science, els.scienceNarrative, els.scienceGrid, "No science learnings available.", "science");
  renderLearningSection(ed.culture, els.cultureNarrative, els.cultureGrid, "No culture & arts stories available.", "culture");
  renderLearningSection(ed.history, els.historyNarrative, els.historyGrid, "No history stories available.", "history");
  renderHistoryMilestones(ed);
  renderAroundTheWorld(ed);
  renderLongReads(ed);
  renderWeekInBrief(ed);
  renderSourceHealth(ed.source_health);

  archiveNav.updateControls();
  showBanner("");

  focusSharedCardFromUrl({
    onBeforeFind(cardId) {
      if ((ed.long_reads || []).some((it) => it?.id === cardId)) {
        const body = document.getElementById("longreads-body");
        const btn = document.getElementById("btn-toggle-longreads");
        body?.classList.remove("hidden");
        btn?.setAttribute("aria-expanded", "true");
      }
    },
  });
}

/* ---------- Archive Navigation & Data Loading ---------- */

const archiveNav = createArchiveController({
  dateSelectEl: els.dateSelect,
  prevBtnEl: els.btnPrevWeek,
  nextBtnEl: els.btnNextWeek,
  refreshBtnEl: els.btnRefresh,
  indexUrl: `${DATA_BASE}/index.json`,
  getDates: () => state.index?.dates || [],
  getCurrentDate: () => state.currentDate,
  isViewingLatest: () => state.viewingLatest,
  onIndexLoaded: (idxData) => {
    state.index = idxData;
  },
  onSelectDate: (dateStr) => loadEdition(dateStr),
  onRefresh: () => loadEdition(state.viewingLatest ? "latest" : state.currentDate, false),
});

async function loadEdition(dateOrLatest = "latest", pushUrl = true) {
  tts.stop();
  try {
    const isLatest = !dateOrLatest || dateOrLatest === "latest";
    state.viewingLatest = isLatest;
    const url = isLatest
      ? `${DATA_BASE}/latest.json`
      : `${DATA_BASE}/archive/${encodeURIComponent(dateOrLatest)}.json`;

    const ed = await fetchJson(url);
    await ensureEntityShards(
      Array.isArray(ed.entity_shards) && ed.entity_shards.length ? ed.entity_shards : ["hot"]
    );
    renderEdition(ed);

    if (pushUrl) {
      archiveNav.syncUrlDate(ed.date, isLatest);
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
  const initialPrefs = getLocalPreferences();
  if (initialPrefs?.world_kind_filter) {
    applyWorldKindFilter(initialPrefs.world_kind_filter, { rerender: false });
  }

  initMasthead({ currentPage: "weekly" });
  initPwa();
  initTts();
  state.showListen = Boolean(initialPrefs?.show_listen);
  setTtsEnabled(state.showListen);
  els.navBookmarksCount = document.getElementById("nav-bookmarks-count");
  const themeCtrl = initTheme(els.themeToggle, (_resolved, pref) => {
    setPreference("theme", pref);
  });

  initScrollSpy();
  initEntityOverlays({
    getCompanyFacts: () => state.companyFacts,
    getCountryLeaders: () => state.countryLeaders,
  });

  const appRoot = document.getElementById("app-root");
  bindBookmarkToggle(appRoot, (key) => bookmarkRegistry.get(key), {
    onLimitReached: () =>
      showToast("Bookmark limit reached. Remove an older bookmark to save more."),
  });
  bindBookmarkCountBadge(els.navBookmarksCount, { syncButtons: true });

  // Wire collapsible sections and section layout settings
  const setOverviewOpen = collapsibles.wireCollapsible("btn-toggle-overview", "overview-body", "#overview");
  const setScienceOpen = collapsibles.wireCollapsible("btn-toggle-science", "science-body", "#science");
  const setCultureOpen = collapsibles.wireCollapsible("btn-toggle-culture", "culture-body", "#culture");
  const setHistoryOpen = collapsibles.wireCollapsible("btn-toggle-history", "history-body", "#history");
  const setWorldOpen = collapsibles.wireCollapsible("btn-toggle-world", "around-world-body", "#around-world");
  const setLongreadsOpen = collapsibles.wireCollapsible("btn-toggle-longreads", "longreads-body", "#longreads");
  const setPulseOpen = collapsibles.wireCollapsible("btn-toggle-pulse", "pulse-body", "#pulse");

  const sectionSettings = initSectionSettings({
    prefKey: "weekly_sections",
    pageLabel: "Weekly Briefing",
    triggerBtn: document.getElementById("btn-section-settings"),
    getInitialLayout: () => initialPrefs?.weekly_sections || null,
    onSave: (layout) => setPreference("weekly_sections", layout),
    onApplied: () => collapsibles.syncExpandAllButton(),
    areAllExpanded: collapsibles.areAllExpanded,
    onToggleAll: collapsibles.toggleAll,
    getBriefStyle: () => state.briefStyle,
    onBriefStyleChange: (nextStyle) => {
      state.briefStyle = nextStyle === "bullets" ? "bullets" : "regular";
      setPreference("brief_style", state.briefStyle);
      stopTtsIfSection("digest", "week_in_brief");
      if (state.edition) {
        renderDigest(state.edition);
        renderWeekInBrief(state.edition);
      }
    },
    getShowListen: () => state.showListen,
    onShowListenChange: (nextOn) => {
      state.showListen = Boolean(nextOn);
      setPreference("show_listen", state.showListen);
      setTtsEnabled(state.showListen);
    },
    sections: [
      { id: "overview", label: "Sunday Digest", defaultCollapsed: false, setOpen: setOverviewOpen },
      { id: "science", label: "Science & Discovery", defaultCollapsed: false, setOpen: setScienceOpen },
      { id: "culture", label: "Culture & Arts", defaultCollapsed: false, setOpen: setCultureOpen },
      { id: "history", label: "History & Archaeology", defaultCollapsed: false, setOpen: setHistoryOpen },
      { id: "around-world", label: "Around the World", defaultCollapsed: false, setOpen: setWorldOpen },
      { id: "longreads", label: "Long Reads & Essays", defaultCollapsed: true, setOpen: setLongreadsOpen },
      { id: "pulse", label: "Week in Brief", defaultCollapsed: true, setOpen: setPulseOpen },
    ],
  });
  collapsibles.syncExpandAllButton();

  bindTtsTriggers(appRoot, {
    resolveItem: (id) => ttsRegistry.get(id),
    resolveSection: (secId) => ttsRegistry.getSectionQueue(secId),
    onBeforePlaySection: (secId) => {
      if (secId === "digest") setOverviewOpen?.(true);
      else if (secId === "science") setScienceOpen?.(true);
      else if (secId === "culture") setCultureOpen?.(true);
      else if (secId === "history") setHistoryOpen?.(true);
      else if (secId === "long_reads") setLongreadsOpen?.(true);
      else if (secId === "week_in_brief") setPulseOpen?.(true);
    },
  });

  initAuth({
    mountEl: els.authMount,
    bookmarksHref: "../bookmarks/",
    onPreferencesApplied(prefs) {
      if (!prefs || typeof prefs !== "object") return;
      if (prefs.theme && ["system", "light", "dark"].includes(prefs.theme)) {
        themeCtrl.apply(prefs.theme, { silent: true, persist: true });
      }
      if (prefs.weekly_sections !== undefined) {
        sectionSettings.applyLayout(prefs.weekly_sections, { applyCollapse: true });
      }
      if (
        prefs.world_kind_filter &&
        ["all", "geology", "cuisine"].includes(prefs.world_kind_filter) &&
        prefs.world_kind_filter !== worldKindFilter
      ) {
        applyWorldKindFilter(prefs.world_kind_filter, { rerender: true });
      }
      if (
        (prefs.brief_style === "regular" || prefs.brief_style === "bullets") &&
        prefs.brief_style !== state.briefStyle
      ) {
        state.briefStyle = prefs.brief_style;
        sectionSettings.syncBriefStyle(state.briefStyle);
        stopTtsIfSection("digest", "week_in_brief");
        if (state.edition) {
          renderDigest(state.edition);
          renderWeekInBrief(state.edition);
        }
      }
      if (typeof prefs.show_listen === "boolean" && prefs.show_listen !== state.showListen) {
        state.showListen = prefs.show_listen;
        sectionSettings.syncShowListen(state.showListen);
        setTtsEnabled(state.showListen);
      }
    },
  });

  archiveNav.bind();

  // Load shared company facts + country leaders + weekly index in parallel
  const [entityData, idxRes] = await Promise.all([
    loadSharedEntityData(SHARED_DATA_BASE),
    fetchJson(`${DATA_BASE}/index.json`).then(
      (v) => ({ ok: true, value: v }),
      () => ({ ok: false, value: null })
    ),
  ]);

  state.companyFacts = entityData.companyFacts;
  state.countryLeaders = entityData.countryLeaders;
  if (idxRes.ok && idxRes.value) {
    state.index = idxRes.value;
    archiveNav.populateDateSelect(idxRes.value.dates || []);
  }

  const requestedDate = archiveNav.resolveRequestedDate(state.index?.dates || []);
  await loadEdition(requestedDate, false);
}

bootstrap();

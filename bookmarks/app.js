/**
 * Dedicated Bookmarks Page (/bookmarks/)
 * Performance-first progressive hydration:
 * 1. T=0 synchronous preview render from localStorage
 * 2. Parallel index.json + company_facts + country_leaders fetch (0 wasted 404s)
 * 3. Concurrency-5 deduplicated archive hydration with immediate full-JSON discard
 * 4. Memoized rich <article> DOM nodes in Map<key, entry> for <2ms filter/sort switching
 */

import { escapeHtml, safeUrl, fmtShortDate, fetchJson } from "../shared/utils.js";
import { initTheme, initMasthead, renderSourceChip, syncButtonGroup } from "../shared/ui.js";
import {
  ensureEntityShards,
  initEntityOverlays,
  loadSharedEntityData,
  createCachedPersonFormatter,
} from "../shared/entities.js";
import {
  ARCHIVE_TTL_DAYS,
  makeBookmarkKey,
  computeBookmarkTtl,
  getBookmarks,
  clearExpiredBookmarks,
  renderBookmarkButton,
  bindBookmarkToggle,
  onBookmarksChange,
} from "../shared/bookmarks.js";
import { initAuth, getLocalPreferences, setPreference, getSyncState, onSyncStatusChange } from "../shared/auth.js";
import { initSectionSettings } from "../shared/section-settings.js";
import { initPwa } from "../shared/pwa.js";
import {
  renderCardShell,
  renderDailyStoryCard,
  renderWeeklyStoryCard,
  renderAroundTheWorldCard,
  resolveLocalStoryTag,
} from "../shared/cards.js";
import {
  initTts,
  setTtsEnabled,
  tts,
  buildReaderText,
  renderTtsCardButton,
  bindTtsTriggers,
} from "../shared/tts.js";

const BRIEFING_DATA = "../briefing/data";
const WEEKLY_DATA = "../weekly/data";
const PAGE_SIZE = 24;
const HYDRATE_CONCURRENCY = 5;

const state = {
  filter: "all", // "all" | "expiring" | "type:<normalized>"
  sort: "saved_desc", // "saved_desc" | "date_desc" | "expiry_asc"
  visibleLimit: PAGE_SIZE,
  indicesLoaded: false,
  availableDates: {
    daily: null, // Set<string> | null
    weekly: null,
  },
  latestDates: {
    daily: "",
    weekly: "",
  },
  ttlOverrides: {
    daily: ARCHIVE_TTL_DAYS.daily,
    weekly: ARCHIVE_TTL_DAYS.weekly,
  },
  companyFacts: null,
  countryLeaders: null,
  /** @type {Map<string, { key: string, record: object, el: HTMLElement, ttl: object, hydrated: boolean, extracted: object|null, lang: string }>} */
  cardCache: new Map(),
  inFlightArchives: new Set(),
  fetchedArchives: new Set(),
};

const els = {
  appRoot: document.getElementById("app-root"),
  countLabel: document.getElementById("bookmarks-count-label"),
  btnTtsBookmarks: document.getElementById("btn-tts-bookmarks"),
  btnSectionSettings: document.getElementById("btn-section-settings"),
  btnClearExpired: document.getElementById("btn-clear-expired"),
  btnClearExpiredSection: document.getElementById("btn-clear-expired-section"),
  themeToggle: document.getElementById("theme-toggle"),
  authMount: document.getElementById("auth-mount"),
  filterBar: document.getElementById("bookmarks-filter-bar"),
  expiryBanner: document.getElementById("expiry-banner"),
  emptyState: document.getElementById("bookmarks-empty"),
  availableSection: document.getElementById("available-section"),
  grid: document.getElementById("bookmarks-grid"),
  loadMoreWrap: document.getElementById("load-more-wrap"),
  btnLoadMore: document.getElementById("btn-load-more"),
  expiredSection: document.getElementById("expired-section"),
  expiredCountNote: document.getElementById("expired-count-note"),
  expiredGrid: document.getElementById("expired-grid"),
  footerSync: document.getElementById("bookmarks-sync-indicator"),
};

/* ---------- Formatting Helpers ---------- */

function sectionAnchor(edition, section) {
  if (edition === "daily") {
    if (section === "local_news") return "#local-news";
    if (section === "positive_news") return "#positive";
    return "#news";
  }
  if (section === "around_the_world") return "#around-world";
  if (section === "long_reads") return "#longreads";
  if (section === "science" || section === "culture" || section === "history") {
    return `#${section}`;
  }
  return "#overview";
}

function buildEditionHref(record) {
  const base = record.edition === "weekly" ? "../weekly/" : "../briefing/";
  const anchor = sectionAnchor(record.edition, record.section);
  return `${base}?date=${encodeURIComponent(record.date)}${anchor}`;
}

function sectionDisplayLabel(record, extracted = null) {
  const map = {
    top_news: "Top News",
    local_news: "Local News",
    positive_news: "Positive News",
    science: "Science",
    culture: "Culture & Arts",
    history: "History",
    long_reads: "Long Reads",
    around_the_world: "Around the World",
  };
  if (record.section === "local_news") {
    const region =
      extracted?.regionName ||
      (record.region === "bay-area" ? "Bay Area" : record.region === "china" ? "China" : "");
    return region ? `Local · ${region}` : "Local News";
  }
  return map[record.section] || record.section;
}

function getBookmarkType(entry) {
  const { record, extracted } = entry;
  if (record.section === "around_the_world") {
    const kind = (extracted?.item?.kind || record.kind) === "cuisine" ? "cuisine" : "geology";
    return kind === "cuisine" ? "Cuisine" : "Geology";
  }
  if (record.edition === "daily") {
    if (record.section === "local_news") {
      const story = extracted?.storyEn || extracted?.storyNative || null;
      return resolveLocalStoryTag(story, record.badge);
    }
    if (record.section === "positive_news") {
      return String(extracted?.story?.category || record.badge || "Progress").trim() || "Progress";
    }
    return String(extracted?.story?.category || record.badge || "News").trim() || "News";
  }
  if (record.edition === "weekly") {
    if (record.section === "long_reads") {
      return String(extracted?.item?.topic || record.badge || "Essay").trim() || "Essay";
    }
    return (
      String(extracted?.item?.category || record.badge || sectionDisplayLabel(record)).trim() ||
      "Learning"
    );
  }
  return String(record.badge || "Saved").trim() || "Saved";
}

function normalizeTypeKey(label) {
  return String(label || "").trim().toLowerCase();
}

function ttlBarClass(status) {
  if (status === "expired") return "is-expired";
  if (status === "expiring_soon") return "is-warn";
  return "is-active";
}

function renderOriginRowHtml(record, extracted = null) {
  const isWeekly = record.edition === "weekly";
  const edBadgeCls = isWeekly ? "is-weekly" : "is-daily";
  const edLabel = isWeekly ? "Weekly" : "Daily";
  const dateLabel = fmtShortDate(record.date) || record.date;
  const href = buildEditionHref(record);
  return `
    <div class="bm-origin-row">
      <div class="bm-origin-left">
        <span class="bm-edition-badge ${edBadgeCls}">${edLabel}</span>
        <a class="bm-origin-link" href="${escapeHtml(href)}">${escapeHtml(dateLabel)} &middot; ${escapeHtml(sectionDisplayLabel(record, extracted))}</a>
      </div>
    </div>
  `;
}

function renderTtlBarHtml(ttl) {
  return `
    <div class="bm-ttl-bar ${ttlBarClass(ttl.status)}">
      <span class="bm-ttl-text">
        <span class="bm-ttl-dot" aria-hidden="true"></span>
        <span>${escapeHtml(ttl.label)}</span>
      </span>
    </div>
  `;
}

function computeEntryTtl(record) {
  const availSet = state.availableDates[record.edition] || null;
  return computeBookmarkTtl(record, {
    ttlOverrides: state.ttlOverrides,
    availableDatesSet: availSet,
  });
}

/* ---------- Card Builders (Preview, Fallback, Full Rich) ---------- */

const getFormatterForTexts = createCachedPersonFormatter(() => state.companyFacts);

function buildPreviewCardHtml(entry) {
  const { key, record, ttl } = entry;
  const safeHref = safeUrl(record.url);
  const titleHtml =
    safeHref !== "#"
      ? `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${escapeHtml(record.title || "Saved story")}</a>`
      : escapeHtml(record.title || "Saved story");
  const sourceChip =
    record.source && safeHref !== "#"
      ? renderSourceChip({ name: record.source, url: record.url })
      : record.source
      ? `<span class="source-chip">${escapeHtml(record.source)}</span>`
      : "";

  return renderCardShell({
    innerOnly: true,
    bookmarkHtml: renderBookmarkButton(key, { saved: true, label: record.title || "bookmark" }),
    headerHtml: renderOriginRowHtml(record),
    badgeLabel: getBookmarkType(entry),
    headlineHtml: titleHtml,
    summaryHtml: `
      <div class="bm-shimmer-group" aria-hidden="true">
        <div class="bm-shimmer"></div>
        <div class="bm-shimmer"></div>
        <div class="bm-shimmer is-short"></div>
      </div>
    `,
    sourcesHtml: sourceChip,
    footerHtml: renderTtlBarHtml(ttl),
  });
}

function buildFallbackCardHtml(entry, noteText = "") {
  entry.ttsItem = null;
  const { key, record, ttl } = entry;
  const safeHref = safeUrl(record.url);
  const titleHtml =
    safeHref !== "#"
      ? `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${escapeHtml(record.title || "Saved story")}</a>`
      : escapeHtml(record.title || "Saved story");
  const sourceChip =
    safeHref !== "#"
      ? renderSourceChip({ name: record.source || "Open original article", url: record.url })
      : record.source
      ? `<span class="source-chip">${escapeHtml(record.source)}</span>`
      : "";
  const fallbackNote =
    noteText ||
    (ttl.status === "expired"
      ? "This briefing edition has rotated out of the archive. Use the saved link below to read the original source."
      : "Full archived card details were unavailable; showing saved headline and source link.");

  return renderCardShell({
    innerOnly: true,
    bookmarkHtml: renderBookmarkButton(key, { saved: true, label: record.title || "bookmark" }),
    headerHtml: renderOriginRowHtml(record),
    badgeLabel: getBookmarkType(entry),
    headlineHtml: titleHtml,
    summaryHtml: `<p class="bm-fallback-note">${escapeHtml(fallbackNote)}</p>`,
    sourcesHtml: sourceChip,
    footerHtml: renderTtlBarHtml(ttl),
  });
}

function buildRichCardHtml(entry) {
  const { key, record, ttl, extracted } = entry;
  if (!extracted) return buildFallbackCardHtml(entry);

  const bookmarkHtml = renderBookmarkButton(key, {
    saved: true,
    label: record.title || "bookmark",
    share: { edition: record.edition, date: record.date, id: record.id, title: record.title },
  });
  const headerHtml = renderOriginRowHtml(record, extracted);
  const footerHtml = renderTtlBarHtml(ttl);
  const typeLabel = getBookmarkType(entry);

  if (record.edition === "daily" && (record.section === "top_news" || record.section === "positive_news")) {
    const story = extracted.story;
    const formatter = getFormatterForTexts([story.headline, story.summary, story.why_it_matters], true);
    const built = buildReaderText(story, { kind: "story" });
    entry.ttsItem = built.text
      ? { id: key, title: built.title, text: built.text, lang: built.lang, sectionId: "bookmarks" }
      : null;
    const ttsHtml = entry.ttsItem
      ? renderTtsCardButton(key, { title: entry.ttsItem.title, variant: "card" })
      : "";
    return renderDailyStoryCard(story, {
      section: record.section,
      badgeLabel: typeLabel,
      formatter,
      bookmarkHtml,
      ttsHtml,
      showEditionTag: false,
      headerHtml,
      footerHtml,
      innerOnly: true,
    });
  }

  if (record.edition === "daily" && record.section === "local_news") {
    const hasNative = Boolean(extracted.storyNative);
    const hasEn = Boolean(extracted.storyEn);
    const isBilingual = hasNative && hasEn;
    const useEn = isBilingual ? entry.lang !== "native" : hasEn;
    const story = useEn ? extracted.storyEn : extracted.storyNative;
    const formatter = getFormatterForTexts([story.headline, story.summary, story.why_it_matters], true);
    const ttsLang = useEn ? "en-US" : record.region === "china" ? "zh-CN" : "";
    const built = buildReaderText(story, { kind: "story", lang: ttsLang });
    entry.ttsItem = built.text
      ? { id: key, title: built.title, text: built.text, lang: built.lang, sectionId: "bookmarks" }
      : null;
    const ttsHtml = entry.ttsItem
      ? renderTtsCardButton(key, { title: entry.ttsItem.title, variant: "card" })
      : "";
    const langToggleHtml = isBilingual
      ? `
        <div class="bm-lang-toggle" role="group" aria-label="Story language" data-lang-key="${escapeHtml(key)}">
          <button type="button" class="bm-lang-btn${!useEn ? " active" : ""}" data-lang="native" aria-pressed="${!useEn}">中文</button>
          <button type="button" class="bm-lang-btn${useEn ? " active" : ""}" data-lang="en" aria-pressed="${useEn}">EN</button>
        </div>
      `
      : "";

    return renderDailyStoryCard(story, {
      section: "local_news",
      badgeLabel: typeLabel,
      formatter,
      bookmarkHtml,
      ttsHtml,
      showEditionTag: false,
      headerHtml,
      metaRightHtml: langToggleHtml,
      footerHtml,
      innerOnly: true,
    });
  }

  if (
    record.edition === "weekly" &&
    (record.section === "science" ||
      record.section === "culture" ||
      record.section === "history" ||
      record.section === "long_reads")
  ) {
    const item = extracted.item;
    const formatter = getFormatterForTexts([item.headline, item.summary, item.takeaway], false);
    const built = buildReaderText(item, {
      kind: record.section === "long_reads" ? "long_read" : "weekly",
    });
    entry.ttsItem = built.text
      ? { id: key, title: built.title, text: built.text, lang: built.lang, sectionId: "bookmarks" }
      : null;
    const ttsHtml = entry.ttsItem
      ? renderTtsCardButton(key, { title: entry.ttsItem.title, variant: "card" })
      : "";
    return renderWeeklyStoryCard(item, {
      section: record.section,
      badgeLabel: typeLabel,
      formatter,
      bookmarkHtml,
      ttsHtml,
      showSubtypeTag: false,
      headerHtml,
      footerHtml,
      innerOnly: true,
    });
  }

  if (record.edition === "weekly" && record.section === "around_the_world") {
    const item = extracted.item;
    const formatter = getFormatterForTexts([item.place, item.region, item.title, item.fact], false);
    const built = buildReaderText(item, { kind: "geo" });
    entry.ttsItem = built.text
      ? { id: key, title: built.title, text: built.text, lang: built.lang, sectionId: "bookmarks" }
      : null;
    const ttsHtml = entry.ttsItem
      ? renderTtsCardButton(key, { title: entry.ttsItem.title, variant: "card" })
      : "";
    return renderAroundTheWorldCard(item, {
      variant: "card",
      formatter,
      bookmarkHtml,
      ttsHtml,
      headerHtml,
      footerHtml,
      innerOnly: true,
    });
  }

  return buildFallbackCardHtml(entry);
}

function applyCardClasses(el, entry) {
  const { record, ttl, extracted } = entry;
  const classes = [];
  if (record.edition === "daily" && record.section === "positive_news" && ttl.status !== "expired") {
    classes.push("positive-card");
  } else {
    classes.push("news-card");
  }
  if (record.section === "around_the_world" && ttl.status !== "expired") {
    const kind = (extracted?.item?.kind || record.kind) === "cuisine" ? "cuisine" : "geology";
    classes.push("bm-geo-card", `is-${kind}`);
  }
  if (ttl.status === "expired") {
    classes.push("bm-expired-card");
  }
  el.className = classes.join(" ");
}

function updateTtlBarInPlace(entry) {
  const bar = entry.el.querySelector(".bm-ttl-bar");
  if (!bar) return;
  bar.className = `bm-ttl-bar ${ttlBarClass(entry.ttl.status)}`;
  const spans = bar.querySelectorAll(".bm-ttl-text span");
  if (spans.length >= 2) {
    spans[1].textContent = entry.ttl.label;
  }
}

/* ---------- Card Cache Management (Memoized DOM Nodes) ---------- */

function createCardEntry(record) {
  const key = makeBookmarkKey(record);
  const ttl = computeEntryTtl(record);
  const el = document.createElement("article");
  el.dataset.bmKey = key;

  const entry = {
    key,
    record,
    el,
    ttl,
    hydrated: false,
    extracted: null,
    ttsItem: null,
    lang: record.lang || "en",
  };

  applyCardClasses(el, entry);
  el.innerHTML = ttl.status === "expired" ? buildFallbackCardHtml(entry) : buildPreviewCardHtml(entry);
  if (ttl.status === "expired") {
    entry.hydrated = true;
  }
  return entry;
}

function syncCardCacheFromStore() {
  const records = getBookmarks();
  const activeKeys = new Set();

  for (const rec of records) {
    const key = makeBookmarkKey(rec);
    activeKeys.add(key);
    const existing = state.cardCache.get(key);
    if (!existing) {
      state.cardCache.set(key, createCardEntry(rec));
    } else {
      existing.record = rec;
      existing.ttl = computeEntryTtl(rec);
      updateTtlBarInPlace(existing);
    }
  }

  const snap = tts.getState();
  for (const key of [...state.cardCache.keys()]) {
    if (!activeKeys.has(key)) {
      if (snap.status !== "idle" && (snap.currentId === key || snap.sectionId === "bookmarks")) {
        tts.stop();
      }
      state.cardCache.delete(key);
    }
  }
}

function refreshAllEntryTtls() {
  for (const entry of state.cardCache.values()) {
    const prevStatus = entry.ttl.status;
    entry.ttl = computeEntryTtl(entry.record);
    if (entry.ttl.status === "expired" && prevStatus !== "expired") {
      entry.hydrated = true;
      applyCardClasses(entry.el, entry);
      entry.el.innerHTML = buildFallbackCardHtml(entry);
    } else {
      updateTtlBarInPlace(entry);
    }
  }
}

/* ---------- Filtering, Sorting & DOM Mounting (<2ms, Zero Re-Parse) ---------- */

function matchesFilter(entry, filter) {
  if (filter === "all") return true;
  if (filter === "expiring") return entry.ttl.status === "expiring_soon";
  if (filter.startsWith("type:")) {
    return normalizeTypeKey(getBookmarkType(entry)) === filter.slice(5);
  }
  return true;
}

function compareEntries(a, b) {
  if (state.sort === "date_desc") {
    if (a.record.date !== b.record.date) return a.record.date < b.record.date ? 1 : -1;
    return (b.record.saved_at || 0) - (a.record.saved_at || 0);
  }
  if (state.sort === "expiry_asc") {
    const diff = a.ttl.daysRemaining - b.ttl.daysRemaining;
    if (diff !== 0) return diff;
    return (b.record.saved_at || 0) - (a.record.saved_at || 0);
  }
  // Default: saved_desc
  const diff = (b.record.saved_at || 0) - (a.record.saved_at || 0);
  if (diff !== 0) return diff;
  return a.record.date < b.record.date ? 1 : a.record.date > b.record.date ? -1 : 0;
}

function updateCountsAndBanners() {
  const all = [...state.cardCache.values()];
  const typeCounts = new Map(); // normKey -> { label, count }
  let expiring = 0;
  let expired = 0;

  for (const e of all) {
    const typeLabel = getBookmarkType(e);
    const normKey = normalizeTypeKey(typeLabel);
    if (normKey) {
      const prev = typeCounts.get(normKey);
      if (prev) prev.count += 1;
      else typeCounts.set(normKey, { label: typeLabel, count: 1 });
    }
    if (e.ttl.status === "expiring_soon") expiring += 1;
    else if (e.ttl.status === "expired") expired += 1;
  }

  if (els.countLabel) {
    els.countLabel.textContent = `${all.length} saved`;
  }

  // Auto-reset active filter if the selected type or expiring bucket became empty
  if (state.filter.startsWith("type:") && !typeCounts.has(state.filter.slice(5))) {
    state.filter = "all";
  } else if (state.filter === "expiring" && expiring === 0) {
    state.filter = "all";
  }

  if (els.filterBar) {
    const sortedTypes = [...typeCounts.entries()].sort((a, b) => {
      if (b[1].count !== a[1].count) return b[1].count - a[1].count;
      return a[1].label.localeCompare(b[1].label);
    });

    const tabs = [
      { id: "all", label: "All", count: all.length },
      ...sortedTypes.map(([normKey, info]) => ({
        id: `type:${normKey}`,
        label: info.label,
        count: info.count,
      })),
    ];
    if (expiring > 0) {
      tabs.push({ id: "expiring", label: "Expiring Soon", count: expiring });
    }

    els.filterBar.innerHTML = tabs
      .map((tab) => {
        const active = state.filter === tab.id;
        return `
          <button type="button" class="bm-filter-tab${active ? " active" : ""}" data-filter="${escapeHtml(tab.id)}" role="tab" aria-selected="${active ? "true" : "false"}">
            <span>${escapeHtml(tab.label)}</span><span class="bm-tab-count">${tab.count}</span>
          </button>
        `;
      })
      .join("");
  }

  els.btnClearExpired?.classList.toggle("hidden", expired === 0);

  if (els.expiryBanner) {
    if (expiring === 0 && expired === 0) {
      els.expiryBanner.classList.add("hidden");
      els.expiryBanner.innerHTML = "";
    } else {
      const parts = [];
      if (expiring > 0) {
        parts.push(
          `<strong>${expiring}</strong> ${expiring === 1 ? "bookmark expires" : "bookmarks expire"} within 7 days`
        );
      }
      if (expired > 0) {
        parts.push(
          `<strong>${expired}</strong> ${expired === 1 ? "edition has" : "editions have"} rotated out of the archive`
        );
      }
      const actions = [];
      if (expiring > 0 && state.filter !== "expiring") {
        actions.push(
          `<button type="button" class="bm-banner-btn" data-banner-action="show-expiring">Show Expiring</button>`
        );
      }
      if (expired > 0) {
        actions.push(
          `<button type="button" class="bm-banner-btn" data-banner-action="clear-expired">Clear Expired</button>`
        );
      }
      els.expiryBanner.innerHTML = `
        <div class="bm-expiry-banner-text">${parts.join(" &middot; ")}</div>
        <div class="bm-expiry-banner-actions">${actions.join("")}</div>
      `;
      els.expiryBanner.classList.remove("hidden");
    }
  }

  if (els.expiredCountNote) {
    els.expiredCountNote.textContent = `${expired} ${expired === 1 ? "story" : "stories"} · Showing saved links`;
  }
}

function getVisiblePlayableBookmarks() {
  const allEntries = [...state.cardCache.values()];
  const filtered = allEntries
    .filter((e) => e.ttl.status !== "expired" && matchesFilter(e, state.filter))
    .sort(compareEntries)
    .slice(0, state.visibleLimit);
  return filtered.map((e) => e.ttsItem).filter((it) => it && it.text);
}

function updateBookmarksTtsButton() {
  if (!els.btnTtsBookmarks) return;
  const playable = getVisiblePlayableBookmarks();
  els.btnTtsBookmarks.classList.toggle("hidden", playable.length === 0);
}

function renderLists() {
  updateCountsAndBanners();

  const allEntries = [...state.cardCache.values()];
  const filtered = allEntries.filter((e) => matchesFilter(e, state.filter)).sort(compareEntries);

  const available = [];
  const expired = [];
  for (const e of filtered) {
    if (e.ttl.status === "expired") expired.push(e);
    else available.push(e);
  }

  // Empty state handling
  if (allEntries.length === 0) {
    els.availableSection?.classList.add("hidden");
    els.expiredSection?.classList.add("hidden");
    updateBookmarksTtsButton();
    if (els.emptyState) {
      els.emptyState.innerHTML = `
        <h2>No bookmarks yet</h2>
        <p>Tap the bookmark icon on any story in Daily Briefing, Weekly Briefing, or the Around the World map to build your personal reading list.</p>
        <div class="bm-empty-actions">
          <a class="bm-empty-link" href="../briefing/?date=latest">Explore Daily Briefing &rarr;</a>
          <a class="bm-empty-link" href="../weekly/?date=latest">Explore Weekly Briefing &rarr;</a>
        </div>
      `;
      els.emptyState.classList.remove("hidden");
    }
    return [];
  }

  if (filtered.length === 0) {
    els.availableSection?.classList.add("hidden");
    els.expiredSection?.classList.add("hidden");
    updateBookmarksTtsButton();
    if (els.emptyState) {
      els.emptyState.innerHTML = `
        <h2>No matching bookmarks</h2>
        <p>None of your saved stories match this filter.</p>
        <div class="bm-empty-actions">
          <button type="button" class="bm-empty-link" data-reset-filter="all">Show all bookmarks</button>
        </div>
      `;
      els.emptyState.classList.remove("hidden");
    }
    return [];
  }

  els.emptyState?.classList.add("hidden");

  // Available cards (sliced to visibleLimit for progressive hydration)
  const visibleAvailable = available.slice(0, state.visibleLimit);
  if (visibleAvailable.length > 0) {
    els.availableSection?.classList.remove("hidden");
    const frag = document.createDocumentFragment();
    for (const entry of visibleAvailable) {
      frag.appendChild(entry.el);
    }
    els.grid.replaceChildren(frag);
  } else {
    els.availableSection?.classList.add("hidden");
    els.grid.replaceChildren();
  }

  const remaining = available.length - visibleAvailable.length;
  if (els.loadMoreWrap && els.btnLoadMore) {
    els.loadMoreWrap.classList.toggle("hidden", remaining <= 0);
    if (remaining > 0) {
      els.btnLoadMore.textContent = `Load more (${remaining} remaining)`;
    }
  }

  // Expired cards section
  if (expired.length > 0) {
    els.expiredSection?.classList.remove("hidden");
    const expFrag = document.createDocumentFragment();
    for (const entry of expired) {
      expFrag.appendChild(entry.el);
    }
    els.expiredGrid.replaceChildren(expFrag);
  } else {
    els.expiredSection?.classList.add("hidden");
    els.expiredGrid.replaceChildren();
  }

  updateBookmarksTtsButton();
  return visibleAvailable;
}

/* ---------- Archive Extraction & Concurrency-5 Hydration Pool ---------- */

function extractItemFromArchive(archiveData, record) {
  if (!archiveData || typeof archiveData !== "object") return null;

  if (record.edition === "daily") {
    if (record.section === "top_news") {
      const story = (archiveData.top_news || []).find((s) => s?.id === record.id);
      return story ? { story } : null;
    }
    if (record.section === "positive_news") {
      const list = Array.isArray(archiveData.positive_news)
        ? archiveData.positive_news
        : archiveData.positive_news
        ? [archiveData.positive_news]
        : [];
      const story = list.find((s) => s?.id === record.id);
      return story ? { story } : null;
    }
    if (record.section === "local_news") {
      const regions = Array.isArray(archiveData.local_news)
        ? archiveData.local_news
        : archiveData.local_news?.regions || [];
      const region = regions.find((r) => r?.id === record.region);
      if (!region) return null;
      const storyNative = (region.stories || []).find((s) => s?.id === record.id) || null;
      const storyEn = (region.stories_en || []).find((s) => s?.id === record.id) || null;
      if (!storyNative && !storyEn) return null;
      return { regionName: region.name || record.region, storyNative, storyEn };
    }
    return null;
  }

  if (record.edition === "weekly") {
    if (record.section === "science" || record.section === "culture" || record.section === "history") {
      const item = (archiveData[record.section]?.items || []).find((i) => i?.id === record.id);
      return item ? { item } : null;
    }
    if (record.section === "long_reads") {
      const item = (archiveData.long_reads || []).find((i) => i?.id === record.id);
      return item ? { item } : null;
    }
    if (record.section === "around_the_world") {
      const item = (archiveData.around_the_world || []).find((i) => i?.id === record.id);
      return item ? { item } : null;
    }
  }
  return null;
}

async function hydrateArchiveGroup(edition, date) {
  const archiveKey = `${edition}:${date}`;
  if (state.inFlightArchives.has(archiveKey)) return;

  // Double-check against availableDates to guarantee 0 wasted 404s
  const availSet = state.availableDates[edition];
  if (availSet && !availSet.has(date)) {
    for (const entry of state.cardCache.values()) {
      if (entry.record.edition === edition && entry.record.date === date && !entry.hydrated) {
        entry.ttl = computeEntryTtl(entry.record);
        entry.hydrated = true;
        applyCardClasses(entry.el, entry);
        entry.el.innerHTML = buildFallbackCardHtml(entry);
      }
    }
    return;
  }

  state.inFlightArchives.add(archiveKey);
  try {
    const base = edition === "weekly" ? WEEKLY_DATA : BRIEFING_DATA;
    const url = `${base}/archive/${encodeURIComponent(date)}.json`;
    const latestDate = state.latestDates[edition];
    const cacheMode = latestDate && date < latestDate ? "force-cache" : "no-cache";

    const resp = await fetch(url, { cache: cacheMode });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    let fullJson = await resp.json();
    if (Array.isArray(fullJson?.entity_shards) && fullJson.entity_shards.length) {
      await ensureEntityShards(fullJson.entity_shards, { cache: "no-cache" });
    }

    // Extract ONLY matched bookmarked entries for this (edition, date)
    for (const entry of state.cardCache.values()) {
      if (entry.record.edition !== edition || entry.record.date !== date) continue;
      if (entry.hydrated) continue;
      entry.extracted = extractItemFromArchive(fullJson, entry.record);
      entry.hydrated = true;
      entry.ttl = computeEntryTtl(entry.record);
      applyCardClasses(entry.el, entry);
      entry.el.innerHTML = entry.extracted
        ? buildRichCardHtml(entry)
        : buildFallbackCardHtml(entry);
    }

    // Immediately drop reference to the full ~139 KB archive JSON
    fullJson = null;
    state.fetchedArchives.add(archiveKey);
    updateCountsAndBanners();
    updateBookmarksTtsButton();
  } catch {
    for (const entry of state.cardCache.values()) {
      if (entry.record.edition !== edition || entry.record.date !== date) continue;
      if (entry.hydrated) continue;
      entry.hydrated = true;
      applyCardClasses(entry.el, entry);
      entry.el.innerHTML = buildFallbackCardHtml(entry);
    }
  } finally {
    state.inFlightArchives.delete(archiveKey);
  }
}

async function hydrateVisibleEntries(visibleEntries) {
  const queue = [];
  const seen = new Set();

  for (const entry of visibleEntries) {
    if (entry.hydrated || entry.ttl.status === "expired") continue;
    const ak = `${entry.record.edition}:${entry.record.date}`;
    if (seen.has(ak) || state.inFlightArchives.has(ak)) continue;
    seen.add(ak);
    queue.push([entry.record.edition, entry.record.date]);
  }

  if (!queue.length) return;

  let cursor = 0;
  const workerCount = Math.min(HYDRATE_CONCURRENCY, queue.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (cursor < queue.length) {
      const idx = cursor++;
      const [edition, date] = queue[idx];
      await hydrateArchiveGroup(edition, date);
    }
  });

  await Promise.all(workers);
}

/* ---------- Event Wiring ---------- */

function setActiveFilter(nextFilter) {
  state.filter = nextFilter;
  state.visibleLimit = PAGE_SIZE;
  syncButtonGroup(els.filterBar, (btn) => btn.dataset.filter === nextFilter, "aria-selected");
  const visible = renderLists();
  if (state.indicesLoaded) {
    hydrateVisibleEntries(visible);
  }
}

function handleClearExpired() {
  clearExpiredBookmarks(state.availableDates, { ttlOverrides: state.ttlOverrides });
  syncCardCacheFromStore();
  const visible = renderLists();
  if (state.indicesLoaded) {
    hydrateVisibleEntries(visible);
  }
}

function bindEvents() {
  els.filterBar?.addEventListener("click", (e) => {
    const btn = e.target.closest?.(".bm-filter-tab");
    if (!btn) return;
    setActiveFilter(btn.dataset.filter || "all");
  });

  els.sortSelect?.addEventListener("change", () => {
    state.sort = els.sortSelect.value || "saved_desc";
    const visible = renderLists();
    if (state.indicesLoaded) {
      hydrateVisibleEntries(visible);
    }
  });

  els.btnClearExpired?.addEventListener("click", handleClearExpired);
  els.btnClearExpiredSection?.addEventListener("click", handleClearExpired);

  els.btnLoadMore?.addEventListener("click", () => {
    state.visibleLimit += PAGE_SIZE;
    const visible = renderLists();
    if (state.indicesLoaded) {
      hydrateVisibleEntries(visible);
    }
  });

  els.expiryBanner?.addEventListener("click", (e) => {
    const btn = e.target.closest?.("[data-banner-action]");
    if (!btn) return;
    const action = btn.dataset.bannerAction;
    if (action === "show-expiring") setActiveFilter("expiring");
    else if (action === "clear-expired") handleClearExpired();
  });

  els.emptyState?.addEventListener("click", (e) => {
    if (e.target.closest?.("[data-reset-filter]")) {
      setActiveFilter("all");
    }
  });

  // Inline bilingual toggle for China local news cards
  els.appRoot?.addEventListener("click", (e) => {
    const langBtn = e.target.closest?.(".bm-lang-btn");
    if (!langBtn) return;
    const group = langBtn.closest(".bm-lang-toggle");
    const key = group?.dataset.langKey;
    const nextLang = langBtn.dataset.lang;
    if (!key || !nextLang) return;
    const entry = state.cardCache.get(key);
    if (!entry || entry.lang === nextLang) return;
    const snap = tts.getState();
    if (snap.status !== "idle" && (snap.currentId === key || snap.sectionId === "bookmarks")) {
      tts.stop();
    }
    entry.lang = nextLang;
    entry.el.innerHTML = buildRichCardHtml(entry);
    updateBookmarksTtsButton();
  });

  bindTtsTriggers(document.body, {
    resolveItem: (id) => state.cardCache.get(id)?.ttsItem || null,
    resolveSection: (secId) => (secId === "bookmarks" ? getVisiblePlayableBookmarks() : []),
  });

  // Delegated bookmark removal on /bookmarks/
  bindBookmarkToggle(
    els.appRoot,
    (key) => state.cardCache.get(key)?.record || null,
    {
      onToggle: (res) => {
        if (!res.saved && res.key) {
          const snap = tts.getState();
          if (snap.status !== "idle" && (snap.currentId === res.key || snap.sectionId === "bookmarks")) {
            tts.stop();
          }
          state.cardCache.delete(res.key);
          const visible = renderLists();
          if (state.indicesLoaded) {
            hydrateVisibleEntries(visible);
          }
        }
      },
    }
  );

  // Sync from cloud merge or cross-tab storage edits
  onBookmarksChange((evt) => {
    if (evt.source === "local") return;
    syncCardCacheFromStore();
    const visible = renderLists();
    if (state.indicesLoaded) {
      hydrateVisibleEntries(visible);
    }
  });
}

/* ---------- Bootstrap (T=0 Preview -> Parallel Indices -> Concurrency-5 Hydration) ---------- */

function renderFooterSyncIndicator(syncState = getSyncState()) {
  const el = els.footerSync;
  if (!el) return;
  const textEl = el.querySelector(".bm-footer-sync-text");
  const accountName = syncState?.user?.name?.trim() || "";

  let cls = "is-signed-out";
  let text = "Not signed in · Stored locally in this browser";

  if (syncState?.signedIn) {
    if (syncState.status === "syncing") {
      cls = "is-syncing";
      text = accountName
        ? `Syncing bookmarks for ${accountName}…`
        : "Syncing bookmarks to your account…";
    } else if (syncState.status === "local" || syncState.status === "error" || syncState.dirty) {
      cls = "is-local";
      text = accountName
        ? `Saved locally · Pending sync for ${accountName}`
        : "Saved locally · Pending account sync";
    } else {
      cls = "is-synced";
      text = accountName
        ? `Bookmarks synced for ${accountName}`
        : "Bookmarks synced to your account";
    }
  }

  el.className = `bm-footer-sync ${cls}`;
  if (textEl) textEl.textContent = text;
}

async function bootstrap() {
  // 1. UI primitives & auth (zero cold-load requests when signed out)
  initMasthead({ currentPage: "bookmarks" });
  initPwa();
  initTts();
  state.showListen = Boolean(getLocalPreferences()?.show_listen);
  setTtsEnabled(state.showListen);
  const themeCtrl = initTheme(els.themeToggle, (_resolved, pref) => {
    setPreference("theme", pref);
  });

  const sectionSettings = initSectionSettings({
    prefKey: "bookmarks_settings",
    pageLabel: "Bookmarks",
    triggerBtn: els.btnSectionSettings,
    sections: [],
    sortConfig: {
      label: "Sort order",
      options: [
        { value: "saved_desc", label: "Newest Saved" },
        { value: "date_desc", label: "Edition Date" },
        { value: "expiry_asc", label: "Expiring Soonest" },
      ],
      defaultValue: "saved_desc",
      getValue: () => state.sort,
      onChange: (val) => {
        state.sort = val || "saved_desc";
        const visible = renderLists();
        if (state.indicesLoaded) {
          hydrateVisibleEntries(visible);
        }
      },
    },
    getShowListen: () => state.showListen,
    onShowListenChange: (nextOn) => {
      state.showListen = Boolean(nextOn);
      setPreference("show_listen", state.showListen);
      setTtsEnabled(state.showListen);
    },
  });

  initEntityOverlays({
    getCompanyFacts: () => state.companyFacts,
    getCountryLeaders: () => state.countryLeaders,
  });
  initAuth({
    mountEl: els.authMount,
    bookmarksHref: "/bookmarks/",
    onPreferencesApplied: (prefs) => {
      if (prefs?.theme) {
        themeCtrl.apply(prefs.theme, { silent: true, persist: true });
      }
      if (typeof prefs?.show_listen === "boolean") {
        state.showListen = prefs.show_listen;
        sectionSettings.syncShowListen(state.showListen);
        setTtsEnabled(state.showListen);
      }
    },
    onAuthChange: () => renderFooterSyncIndicator(),
  });
  renderFooterSyncIndicator();
  onSyncStatusChange((snapshot) => renderFooterSyncIndicator(snapshot));

  bindEvents();

  // 2. T=0 synchronous preview render from localStorage
  syncCardCacheFromStore();
  renderLists();

  // 3. Parallel fetch of indices + shared entity metadata (non-blocking)
  const [dailyIdxRes, weeklyIdxRes, entityData] = await Promise.all([
    fetchJson(`${BRIEFING_DATA}/index.json`, { cache: "no-cache" }).then(
      (value) => ({ ok: true, value }),
      () => ({ ok: false, value: null })
    ),
    fetchJson(`${WEEKLY_DATA}/index.json`, { cache: "no-cache" }).then(
      (value) => ({ ok: true, value }),
      () => ({ ok: false, value: null })
    ),
    loadSharedEntityData(BRIEFING_DATA, { cache: "no-cache" }),
  ]);

  state.companyFacts = entityData.companyFacts;
  state.countryLeaders = entityData.countryLeaders;

  if (dailyIdxRes.ok && dailyIdxRes.value) {
    const idx = dailyIdxRes.value;
    state.availableDates.daily = new Set(Array.isArray(idx.dates) ? idx.dates : []);
    state.latestDates.daily = idx.latest_date || idx.dates?.[0] || "";
    if (Number.isFinite(Number(idx.archive_ttl_days))) {
      state.ttlOverrides.daily = Number(idx.archive_ttl_days);
    }
  }

  if (weeklyIdxRes.ok && weeklyIdxRes.value) {
    const idx = weeklyIdxRes.value;
    state.availableDates.weekly = new Set(Array.isArray(idx.dates) ? idx.dates : []);
    state.latestDates.weekly = idx.latest_date || idx.dates?.[0] || "";
    if (Number.isFinite(Number(idx.archive_ttl_days))) {
      state.ttlOverrides.weekly = Number(idx.archive_ttl_days);
    }
  }

  state.indicesLoaded = true;
  refreshAllEntryTtls();
  const visible = renderLists();

  // 4. Hydrate visible available cards via concurrency-5 pool
  await hydrateVisibleEntries(visible);
}

bootstrap();

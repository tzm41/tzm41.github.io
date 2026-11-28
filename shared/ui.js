/**
 * Shared UI Primitives for colintan.dev Briefings (Daily, Weekly & Bookmarks)
 * - Re-exports pure utilities from ./utils.js
 * - 3-way Theme controller (Auto / Light / Dark)
 * - Toast notifications, segmented group sync, source health strip
 * - Sticky Section Nav Scroll-Spy
 * - Collapsible section wiring & Expand All / Collapse All sync
 * - Source bias & 7-level sentiment half-ring widgets
 */

import {
  THEME_COLORS,
  syncThemeColorMeta,
  escapeHtml,
  safeUrl,
  escapeRegex,
  fmtReadableDate,
  fmtShortDate,
  fmtCompactDate,
  fmtLocalTimestamp,
  fmtCoords,
  fetchJson,
  readJsonStorage,
  writeJsonStorage,
} from "./utils.js";

export {
  THEME_COLORS,
  syncThemeColorMeta,
  escapeHtml,
  safeUrl,
  escapeRegex,
  fmtReadableDate,
  fmtShortDate,
  fmtCompactDate,
  fmtLocalTimestamp,
  fmtCoords,
  fetchJson,
  readJsonStorage,
  writeJsonStorage,
};

/* ---------- 3-Way Theme Toggle (Auto / Light / Dark) ---------- */

const THEME_ORDER = ["system", "light", "dark"];

const THEME_ICONS = {
  system: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none"/></svg>`,
  light: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4.5"/><path d="M12 2.5v2M12 19.5v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2.5 12h2M19.5 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>`,
  dark: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`,
};

const THEME_LABELS = {
  system: "Theme: Auto (switch to Light)",
  light: "Theme: Light (switch to Dark)",
  dark: "Theme: Dark (switch to Auto)",
};

export function resolveTheme(pref) {
  if (pref === "light" || pref === "dark") return pref;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function initTheme(themeToggleEl, onThemeChange = null) {
  const apply = (pref, { silent = false, persist = false } = {}) => {
    const validPref = THEME_ORDER.includes(pref) ? pref : "system";
    if (persist) {
      try {
        localStorage.setItem("briefing-theme", validPref);
      } catch {
        // Ignore storage errors
      }
    }
    const resolved = resolveTheme(validPref);
    document.documentElement.setAttribute("data-theme", resolved);
    syncThemeColorMeta(resolved);

    if (themeToggleEl) {
      themeToggleEl.dataset.themePref = validPref;
      themeToggleEl.innerHTML = THEME_ICONS[validPref];
      const label = THEME_LABELS[validPref];
      themeToggleEl.setAttribute("aria-label", label);
      themeToggleEl.setAttribute("title", label);
    }

    if (!silent && typeof onThemeChange === "function") onThemeChange(resolved, validPref);
  };

  const media = window.matchMedia?.("(prefers-color-scheme: dark)");
  apply(localStorage.getItem("briefing-theme") || "system", { silent: true });

  themeToggleEl?.addEventListener("click", () => {
    const cur = localStorage.getItem("briefing-theme") || "system";
    const idx = THEME_ORDER.indexOf(cur);
    const nextPref = THEME_ORDER[(idx + 1) % THEME_ORDER.length];
    apply(nextPref, { persist: true });
  });

  media?.addEventListener?.("change", () => {
    if ((localStorage.getItem("briefing-theme") || "system") === "system") {
      apply("system", { silent: true });
    }
  });

  return { apply };
}

/* ---------- Toast Notifications, Segmented Sync & Source Health ---------- */

let sharedToastTimer = null;

export function showToast(msg, durationMs = 4000) {
  if (typeof document === "undefined") return;
  let el = document.querySelector(".auth-toast[data-shared-toast]");
  if (!el) {
    el = document.createElement("div");
    el.className = "auth-toast";
    el.dataset.sharedToast = "1";
    el.setAttribute("role", "status");
    document.body.appendChild(el);
  }
  el.textContent = String(msg ?? "");
  el.classList.remove("hidden");
  if (sharedToastTimer) window.clearTimeout(sharedToastTimer);
  sharedToastTimer = window.setTimeout(() => {
    el.classList.add("hidden");
  }, durationMs);
}

export function syncButtonGroup(containerOrNodes, isActiveFn, ariaAttr = "aria-pressed") {
  const nodes =
    containerOrNodes && typeof containerOrNodes.querySelectorAll === "function"
      ? containerOrNodes.querySelectorAll("button")
      : containerOrNodes || [];
  for (const btn of nodes) {
    const active = Boolean(isActiveFn(btn));
    btn.classList.toggle("active", active);
    if (ariaAttr) btn.setAttribute(ariaAttr, String(active));
  }
}

/* ---------- Shared Responsive Masthead Title & Top Nav ---------- */

const MASTHEAD_PAGES = {
  home: {
    label: "colintan.dev",
    shortLabel: "colintan.dev",
    href: "/",
    title: "Back to main site",
    prefix: "&larr; ",
  },
  daily: {
    label: "Daily Briefing",
    shortLabel: "Daily",
    href: "../briefing/?date=latest",
    title: "Open Daily Briefing",
    suffix: " &rarr;",
  },
  weekly: {
    label: "Weekly Briefing",
    shortLabel: "Weekly",
    href: "../weekly/?date=latest",
    title: "Open Weekly Briefing",
    suffix: " &rarr;",
  },
  bookmarks: {
    label: "Bookmarks",
    shortLabel: "Bookmarks",
    href: "../bookmarks/",
    title: "Open Saved Bookmarks",
    countId: "nav-bookmarks-count",
  },
};

const MASTHEAD_CRUMBS = {
  daily: ["home", "weekly", "bookmarks"],
  weekly: ["home", "daily", "bookmarks"],
  bookmarks: ["home", "daily", "weekly"],
};

export function renderResponsiveLabel(fullLabel, shortLabel = fullLabel) {
  const safeFull = escapeHtml(fullLabel);
  if (!shortLabel || shortLabel === fullLabel) return safeFull;
  return `<span class="label-full">${safeFull}</span><span class="label-short" aria-hidden="true">${escapeHtml(shortLabel)}</span>`;
}

const OVERFLOW_DOTS_SVG = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>`;

export function renderEditionDate(el, dateStr) {
  if (!el) return;
  const full = fmtReadableDate(dateStr);
  const compact = fmtCompactDate(dateStr);
  el.innerHTML = `<span class="date-full">${escapeHtml(full)}</span><span class="date-short" aria-hidden="true">${escapeHtml(compact)}</span>`;
}

/**
 * Hydrate the shared masthead breadcrumb row, responsive <h1> title,
 * sticky shrunken scroll titlebar (above section tab bar), and mobile portrait
 * three-dot overflow menu.
 */
export function initMasthead({
  currentPage,
  crumbRowEl = document.querySelector(".masthead-crumb-row"),
  titleEl = document.querySelector(".masthead .title-row h1"),
} = {}) {
  const page = MASTHEAD_PAGES[currentPage];
  if (titleEl && page) {
    titleEl.innerHTML = renderResponsiveLabel(page.label, page.shortLabel);
  }
  const crumbKeys = MASTHEAD_CRUMBS[currentPage];
  if (crumbRowEl && crumbKeys) {
    crumbRowEl.innerHTML = crumbKeys
      .map((key) => {
        const item = MASTHEAD_PAGES[key];
        const countHtml = item.countId
          ? `<span class="crumb-count hidden" id="${escapeHtml(item.countId)}"></span>`
          : "";
        return `<a href="${escapeHtml(item.href)}" class="back-home" title="${escapeHtml(item.title)}">${item.prefix || ""}${renderResponsiveLabel(item.label, item.shortLabel)}${countHtml}${item.suffix || ""}</a>`;
      })
      .join('<span class="crumb-sep" aria-hidden="true">&middot;</span>');
  }

  initStickyMasthead();
}

function initStickyMasthead() {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const masthead = document.querySelector(".masthead");
  const mastheadInner = masthead?.querySelector(".masthead-inner");
  const controls = masthead?.querySelector(".masthead-controls");
  if (!masthead || !mastheadInner || masthead.dataset.stickyBound === "1") return;
  masthead.dataset.stickyBound = "1";

  // Insert zero-layout-shift spacer immediately after masthead
  const spacer = document.createElement("div");
  spacer.className = "masthead-spacer";
  spacer.setAttribute("aria-hidden", "true");
  masthead.insertAdjacentElement("afterend", spacer);

  // Inject mobile-portrait three-dot overflow menu button (shown only when stuck in portrait)
  let overflowBtn = mastheadInner.querySelector(".masthead-overflow-btn");
  if (!overflowBtn && controls) {
    overflowBtn = document.createElement("button");
    overflowBtn.type = "button";
    overflowBtn.className = "masthead-icon-btn masthead-overflow-btn";
    overflowBtn.setAttribute("aria-label", "More actions");
    overflowBtn.setAttribute("aria-haspopup", "true");
    overflowBtn.setAttribute("aria-expanded", "false");
    overflowBtn.setAttribute("title", "More actions");
    overflowBtn.innerHTML = OVERFLOW_DOTS_SVG;
    mastheadInner.appendChild(overflowBtn);
  }

  const closeOverflow = () => {
    if (!masthead.classList.contains("is-overflow-open")) return;
    masthead.classList.remove("is-overflow-open");
    overflowBtn?.setAttribute("aria-expanded", "false");
  };

  overflowBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = masthead.classList.toggle("is-overflow-open");
    overflowBtn.setAttribute("aria-expanded", String(open));
  });

  // Close overflow menu after activating non-auth controls (e.g. Customize, Refresh, Expand All)
  controls?.addEventListener("click", (e) => {
    if (!masthead.classList.contains("is-overflow-open")) return;
    if (e.target.closest("#auth-mount, select")) return;
    if (e.target.closest("button")) {
      window.setTimeout(closeOverflow, 0);
    }
  });

  document.addEventListener("click", (e) => {
    if (!masthead.classList.contains("is-overflow-open")) return;
    if (masthead.contains(e.target)) return;
    closeOverflow();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeOverflow();
  });

  let fullHeight = Math.round(masthead.getBoundingClientRect().height);
  let stuck = false;

  const syncStickyHeightVar = () => {
    if (stuck) {
      const sh = Math.round(masthead.getBoundingClientRect().height);
      document.documentElement.style.setProperty("--sticky-masthead-h", `${sh}px`);
    } else {
      document.documentElement.style.setProperty("--sticky-masthead-h", "0px");
    }
  };

  const updateStuckState = () => {
    if (!stuck) {
      fullHeight = Math.round(masthead.getBoundingClientRect().height) || fullHeight;
    }
    const enterThreshold = Math.max(28, fullHeight - 48);
    const exitThreshold = Math.max(8, enterThreshold - 14);
    const y = window.scrollY;

    if (!stuck && y > enterThreshold) {
      stuck = true;
      spacer.style.height = `${fullHeight}px`;
      masthead.classList.add("is-stuck");
      syncStickyHeightVar();
    } else if (stuck && y <= exitThreshold) {
      stuck = false;
      closeOverflow();
      masthead.classList.remove("is-stuck");
      spacer.style.height = "0px";
      syncStickyHeightVar();
    }
  };

  let ticking = false;
  window.addEventListener(
    "scroll",
    () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(() => {
        updateStuckState();
        ticking = false;
      });
    },
    { passive: true }
  );

  window.addEventListener(
    "resize",
    () => {
      closeOverflow();
      if (!stuck) {
        fullHeight = Math.round(masthead.getBoundingClientRect().height) || fullHeight;
      } else {
        syncStickyHeightVar();
      }
      updateStuckState();
    },
    { passive: true }
  );

  syncStickyHeightVar();
  updateStuckState();
}

export function focusSharedCardFromUrl({ onBeforeFind = null } = {}) {
  if (typeof window === "undefined") return false;
  const cardId = new URLSearchParams(window.location.search).get("card");
  if (!cardId) return false;
  if (typeof onBeforeFind === "function") onBeforeFind(cardId);
  const esc = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(cardId) : cardId.replace(/"/g, '\\"');
  const el = document.querySelector(`[data-card-id="${esc}"]`);
  if (!el) return false;
  if (el.classList.contains("is-collapsed")) {
    el.classList.remove("is-collapsed");
    const btn = el.querySelector(".card-toggle-btn");
    if (btn) {
      btn.setAttribute("aria-expanded", "true");
      btn.innerHTML = "Collapse &#9652;";
    }
  }
  el.classList.remove("is-shared-target");
  void el.offsetWidth;
  el.classList.add("is-shared-target");
  window.requestAnimationFrame(() => {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  return true;
}

export function renderSourceHealth(el, entries = []) {
  if (!el) return;
  el.innerHTML = entries
    .map(([label, status]) => {
      const cls = status === "ok" ? "ok" : status === "partial" ? "partial" : "failed";
      const safeLabel = escapeHtml(label);
      const safeStatus = escapeHtml(status || "unknown");
      return `<span class="health-item" title="${safeLabel}: ${safeStatus}"><span class="health-dot ${cls}"></span>${safeLabel}</span>`;
    })
    .join("");
}

/* ---------- Sticky Section Nav Scroll-Spy ---------- */

export function initScrollSpy() {
  const nav = document.querySelector(".section-nav");
  const navInner = document.querySelector(".section-nav-inner");
  const syncNavHeight = () => {
    if (nav) {
      document.documentElement.style.setProperty(
        "--nav-height",
        `${Math.round(nav.getBoundingClientRect().height)}px`
      );
    }
  };
  syncNavHeight();
  window.addEventListener("resize", syncNavHeight, { passive: true });

  const links = [...document.querySelectorAll(".nav-links a[href^='#']")];
  const pairs = links
    .map((link) => {
      const id = link.getAttribute("href").slice(1);
      const section = document.getElementById(id);
      return section ? { link, section } : null;
    })
    .filter(Boolean);

  if (!pairs.length) return;

  let lastActiveLink = null;

  const updateActive = () => {
    const visiblePairs = pairs
      .filter(({ section }) => !section.classList.contains("hidden") && !section.classList.contains("section-user-hidden"))
      .sort((a, b) => a.section.getBoundingClientRect().top - b.section.getBoundingClientRect().top);
    if (!visiblePairs.length) return;

    const navH = nav ? nav.getBoundingClientRect().height : 44;
    const stickyH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sticky-masthead-h")) || 0;
    const atBottom =
      window.scrollY > 40 &&
      window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 40;

    let activePair = visiblePairs[0];
    if (atBottom) {
      activePair = visiblePairs[visiblePairs.length - 1];
    } else if (window.scrollY > 40) {
      const threshold = stickyH + navH + 36;
      for (const pair of visiblePairs) {
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

    if (activePair.link !== lastActiveLink) {
      lastActiveLink = activePair.link;
      if (navInner && navInner.scrollWidth > navInner.clientWidth) {
        const linkRect = activePair.link.getBoundingClientRect();
        const navRect = navInner.getBoundingClientRect();
        const targetLeft =
          navInner.scrollLeft + (linkRect.left - navRect.left) - (navRect.width - linkRect.width) / 2;
        navInner.scrollTo({ left: Math.max(0, targetLeft), behavior: "smooth" });
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

/* ---------- Collapsible Sections & Expand/Collapse All ---------- */

export function createCollapsibleManager(btnExpandAll, { extraIsOpen = null, extraSetOpen = null } = {}) {
  const controllers = [];

  const areAllExpanded = () => {
    const coreOpen = controllers.every((c) => !c.isVisible() || c.isOpen());
    return coreOpen && (typeof extraIsOpen === "function" ? extraIsOpen() : true);
  };

  const syncExpandAllButton = () => {
    if (!btnExpandAll) return;
    const allOpen = areAllExpanded();
    btnExpandAll.setAttribute("aria-expanded", String(allOpen));
    const lbl = btnExpandAll.querySelector(".collapse-label");
    if (lbl) lbl.textContent = allOpen ? "Collapse All" : "Expand All";
  };

  const wireCollapsible = (btnId, bodyId, navHash = null) => {
    const btn = document.getElementById(btnId);
    const body = document.getElementById(bodyId);
    if (!btn || !body) return null;
    const sectionEl = body.closest("section");

    const setOpen = (open) => {
      body.classList.toggle("hidden", !open);
      if (sectionEl) sectionEl.classList.toggle("is-section-collapsed", !open);
      btn.setAttribute("aria-expanded", String(open));
      const lbl = btn.querySelector(".collapse-label");
      if (lbl) lbl.textContent = open ? "Collapse" : "Expand";
      syncExpandAllButton();
    };
    const isOpen = () => !body.classList.contains("hidden");
    const isVisible = () =>
      !sectionEl ||
      (!sectionEl.classList.contains("hidden") && !sectionEl.classList.contains("section-user-hidden"));
    controllers.push({ setOpen, isOpen, isVisible });

    btn.addEventListener("click", () => {
      setOpen(body.classList.contains("hidden"));
    });
    const heading = btn.closest(".section-header, .sub-header")?.querySelector("h2, h3");
    if (heading) {
      heading.classList.add("collapsible-title");
      heading.addEventListener("click", () => setOpen(body.classList.contains("hidden")));
    }
    if (navHash) {
      document.querySelector(`.nav-links a[href="${navHash}"]`)?.addEventListener("click", () => {
        if (body.classList.contains("hidden")) setOpen(true);
      });
    }
    return setOpen;
  };

  const toggleAll = () => {
    const open = !areAllExpanded();
    controllers.forEach((c) => c.setOpen(open));
    if (typeof extraSetOpen === "function") extraSetOpen(open);
    syncExpandAllButton();
    return open;
  };

  btnExpandAll?.addEventListener("click", toggleAll);

  return { wireCollapsible, syncExpandAllButton, areAllExpanded, toggleAll };
}

/* ---------- Source Bias & 7-Level Sentiment Half-Ring Widgets ---------- */

export function buildHalfRingSvg(pos, dotColor) {
  const t = Math.max(0.05, Math.min(0.95, Number(pos ?? 0.5)));
  const angle = Math.PI * (1 - t);
  const cx = 12 + 9 * Math.cos(angle);
  const cy = 12 - 9 * Math.sin(angle);
  return `
    <svg class="half-ring-svg" viewBox="0 0 24 15" aria-hidden="true">
      <path class="half-ring-track" d="M 3 12 A 9 9 0 0 1 21 12"></path>
      <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="2.8" fill="${dotColor}" stroke="var(--surface)" stroke-width="1.1"></circle>
    </svg>
  `;
}

export const SOURCE_BIAS_RULES = [
  [/reuters|ap news|associated press/i, "Center · Wire", "center", 0.5],
  [/bloomberg|cnbc|financial times|ft中文网|wall street journal|wsj|marketplace/i, "Center · Business", "center", 0.5],
  [/quanta|nature|science|sciencedaily|nasa|space\.com|phys\.org|new scientist|scientific american|nautilus/i, "Center · Science", "center", 0.5],
  [/smithsonian|archaeology|history today|public domain review|open culture|aeon|psyche|atlas obscura|lapham|heritagedaily|works in progress|marginalian/i, "Center · History & Ideas", "center", 0.5],
  [/hyperallergic|colossal|dezeen|archdaily|literary hub|lithub|pitchfork|artnet/i, "Center · Arts & Culture", "center", 0.5],
  [/bbc/i, "Center-Left · Public", "left", 0.36],
  [/the hill|politico|courthouse news|stars and stripes|the economist/i, "Center", "center", 0.5],
  [/deutsche welle|rfi|al jazeera/i, "Center-Left · Int'l public", "left", 0.36],
  [/npr/i, "Lean Left · Public", "left", 0.24],
  [/new york times|纽约时报|washington post|sacramento bee|ktvu|abc news|the atlantic|new yorker/i, "Lean Left", "left", 0.24],
  [/guardian/i, "Left-Center", "left", 0.28],
  [/fox news|new york post/i, "Lean Right", "right", 0.78],
  [/arstechnica|ars technica|the verge|techcrunch|mit technology review|good news network|solidot/i, "Center · Tech / Specialty", "center", 0.5],
  [/中新网|新华社|人民日报|外交部|cgtn|global times/i, "State-affiliated (CN)", "state", 0.5],
  [/澎湃|thepaper/i, "State-owned (CN) · Urban", "state", 0.5],
  [/财新|caixin|第一财经|yicai|界面|jiemian/i, "Business / Market (CN)", "center", 0.5],
  [/google news/i, "Aggregator", "neutral", 0.5],
];

export const BIAS_TONE_COLOR = {
  center: "var(--bias-center)",
  left: "var(--bias-left)",
  right: "var(--bias-right)",
  state: "var(--bias-state)",
  neutral: "var(--ink-muted)",
};

export function lookupSourceBias(name) {
  const s = String(name || "").trim();
  if (!s) return null;
  for (const [re, label, tone, pos] of SOURCE_BIAS_RULES) {
    if (re.test(s)) return { text: label, tone, pos };
  }
  return null;
}

export function renderSourceChip(src) {
  const bias = lookupSourceBias(src.name);
  const biasAttr = bias
    ? ` data-bias="${escapeHtml(bias.text)}" data-bias-tone="${escapeHtml(bias.tone)}" data-bias-pos="${bias.pos}"`
    : "";
  return `<a class="source-chip"${biasAttr} href="${safeUrl(src.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(src.name)} &nearr;</a>`;
}

export const TAG_COLOR_COUNT = 48;

export function hashTagColorIndex(label, paletteSize = TAG_COLOR_COUNT) {
  const str = String(label ?? "").trim().toLowerCase();
  let hash = 0x811c9dc5; // FNV-1a 32-bit offset basis
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // Murmur3 32-bit avalanche finalizer for uniform spread across the hue wheel
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return (hash >>> 0) % paletteSize;
}

export function renderHashedTag(label, extraClass = "") {
  const text = String(label ?? "").trim();
  if (!text) return "";
  const idx = hashTagColorIndex(text, TAG_COLOR_COUNT);
  const hue = ((idx * 360) / TAG_COLOR_COUNT).toFixed(1);
  const cls = extraClass ? `cat-pill tag-hashed ${extraClass}` : "cat-pill tag-hashed";
  return `<span class="${cls}" style="--tag-h:${hue}">${escapeHtml(text)}</span>`;
}

export const SENTIMENT_META = {
  very_negative: { label: "Very Negative", pos: 0.06, color: "var(--sent-very-neg)" },
  negative: { label: "Negative", pos: 0.2, color: "var(--sent-neg)" },
  slightly_negative: { label: "Slightly Negative", pos: 0.35, color: "var(--sent-slight-neg)" },
  neutral: { label: "Neutral", pos: 0.5, color: "var(--sent-neutral)" },
  slightly_positive: { label: "Slightly Positive", pos: 0.65, color: "var(--sent-slight-pos)" },
  positive: { label: "Positive", pos: 0.8, color: "var(--sent-pos)" },
  very_positive: { label: "Very Positive", pos: 0.94, color: "var(--sent-very-pos)" },
};

export const SENTIMENT_LABELS = Object.fromEntries(
  Object.entries(SENTIMENT_META).map(([k, v]) => [k, v.label])
);

const NEGATIVE_SENTIMENT_RE =
  /\b(guilty|convict\w*|outage|code red|sell-?off|slump|plunge|slide[sd]?|drop(?:s|ped)?|fall(?:s|ing)?|fell|dead|death\w*|kill\w*|strike\w*|attack\w*|cyberattack\w*|hack\w*|war|blockade|paralys\w*|flood\w*|lawsuit|challenge|fakes?|smear|disinformation|scandal|resign\w*|tariff\w*|friction|scrutiny|probe|investigat\w*|deport\w*|crash|crisis|decline|violat\w*|sanction\w*)\b|加征关税|关税|攻击|抹黑|判死刑|窃取|摩擦|虚假信息|危机|冲突/gi;

const POSITIVE_SENTIMENT_RE =
  /\b(breakthrough|rally|rallies|surge[sd]?|gain\w*|advance[sd]?|recover\w*|success|milestone|celebrat\w*|award\w*|approv\w*|cure[sd]?|boost\w*|growth|record high|peace|ceasefire|accord|treaty|draw(?:s|ing)? crowds|reopen\w*|reduced the risk|durable|discover\w*|unearth\w*|restor\w*)\b|获批|突破|增长|里程碑|和平|停火|复苏|创新高/gi;

export function inferSentimentFromText(text) {
  const neg = (text.match(NEGATIVE_SENTIMENT_RE) || []).length;
  const pos = (text.match(POSITIVE_SENTIMENT_RE) || []).length;
  const score = pos - neg;
  if (score <= -4) return "very_negative";
  if (score <= -2) return "negative";
  if (score === -1) return "slightly_negative";
  if (score >= 4) return "very_positive";
  if (score >= 2) return "positive";
  if (score === 1) return "slightly_positive";
  return "neutral";
}

export function renderSentimentRing(sentiment, fallbackText = "", defaultKey = "neutral") {
  const key =
    sentiment && SENTIMENT_META[sentiment] && sentiment !== "neutral"
      ? sentiment
      : fallbackText
      ? inferSentimentFromText(fallbackText)
      : defaultKey;
  const meta = SENTIMENT_META[key] || SENTIMENT_META[defaultKey] || SENTIMENT_META.neutral;
  const tip = `Sentiment: ${meta.label}`;
  return `<span class="sentiment-gauge" tabindex="0" data-tooltip="${escapeHtml(tip)}" aria-label="${escapeHtml(tip)}">${buildHalfRingSvg(meta.pos, meta.color)}</span>`;
}

export function initSourceBiasPopover() {
  const pop = document.createElement("div");
  pop.className = "source-popover hidden";
  pop.setAttribute("role", "dialog");
  document.body.appendChild(pop);

  let lastPointerType = "mouse";
  let activeChip = null;

  const hide = () => {
    pop.classList.add("hidden");
    pop.classList.remove("is-hover");
    activeChip = null;
  };

  const showForChip = (chip, includeOpenLink) => {
    activeChip = chip;
    const bias = chip.dataset.bias || "";
    const tone = chip.dataset.biasTone || "neutral";
    const pos = Number(chip.dataset.biasPos ?? 0.5);
    const color = BIAS_TONE_COLOR[tone] || BIAS_TONE_COLOR.neutral;
    const href = chip.getAttribute("href") || "#";
    const gauge = buildHalfRingSvg(pos, color);
    const openLink = includeOpenLink
      ? `<a class="source-popover-link" href="${safeUrl(href)}" target="_blank" rel="noopener noreferrer">Open &nearr;</a>`
      : "";
    pop.classList.toggle("is-hover", !includeOpenLink);
    pop.innerHTML = `<span class="source-popover-bias" data-bias-tone="${escapeHtml(tone)}">${gauge}<span>${escapeHtml(bias)}</span></span>${openLink}`;
    pop.classList.remove("hidden");

    const rect = chip.getBoundingClientRect();
    const popRect = pop.getBoundingClientRect();
    const left = Math.max(
      12,
      Math.min(window.innerWidth - popRect.width - 12, rect.left + rect.width / 2 - popRect.width / 2)
    );
    const top = Math.max(12, rect.top - popRect.height - 8);
    pop.style.left = `${left.toFixed(1)}px`;
    pop.style.top = `${top.toFixed(1)}px`;
  };

  document.addEventListener("pointerover", (e) => {
    if (e.pointerType === "touch") return;
    const chip = e.target.closest(".source-chip[data-bias]");
    if (!chip) return;
    showForChip(chip, false);
  });

  document.addEventListener("pointerout", (e) => {
    if (e.pointerType === "touch") return;
    const chip = e.target.closest(".source-chip[data-bias]");
    if (chip && chip === activeChip && pop.classList.contains("is-hover")) {
      hide();
    }
  });

  document.addEventListener(
    "pointerdown",
    (e) => {
      lastPointerType = e.pointerType || "mouse";
      if (!pop.classList.contains("hidden") && !pop.contains(e.target) && !e.target.closest(".source-chip")) {
        hide();
      }
    },
    { passive: true }
  );

  document.addEventListener("click", (e) => {
    const chip = e.target.closest(".source-chip[data-bias]");
    if (!chip) return;
    const isTouch =
      lastPointerType === "touch" ||
      !window.matchMedia?.("(hover: hover) and (pointer: fine)").matches;
    if (!isTouch) return;

    e.preventDefault();
    if (activeChip === chip && !pop.classList.contains("hidden") && !pop.classList.contains("is-hover")) {
      hide();
      return;
    }
    showForChip(chip, true);
  });

  window.addEventListener("scroll", hide, { passive: true });
}

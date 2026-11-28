/**
 * Shared Section Layout Settings (Show/Hide, Expanded/Collapsed on load, Reorder)
 * Reusable across Daily Briefing and Weekly Briefing, with localStorage + logged-in cloud sync.
 */

import { escapeHtml } from "./utils.js";

const UP_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="18 15 12 9 6 15"/></svg>`;
const DOWN_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>`;
const EYE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
const EYE_OFF_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;

export function normalizeSectionLayout(raw, defs) {
  const validIds = defs.map((d) => d.id);
  const validSet = new Set(validIds);
  const defaultCollapsed = defs.filter((d) => d.defaultCollapsed).map((d) => d.id);

  if (!raw || typeof raw !== "object") {
    return {
      order: [...validIds],
      hidden: [],
      collapsed: [...defaultCollapsed],
    };
  }

  const seen = new Set();
  const order = [];
  if (Array.isArray(raw.order)) {
    for (const id of raw.order) {
      if (typeof id === "string" && validSet.has(id) && !seen.has(id)) {
        seen.add(id);
        order.push(id);
      }
    }
  }
  for (const id of validIds) {
    if (!seen.has(id)) order.push(id);
  }

  const hidden = Array.isArray(raw.hidden)
    ? [...new Set(raw.hidden.filter((id) => typeof id === "string" && validSet.has(id)))]
    : [];

  // Prevent hiding every section at once
  if (hidden.length >= validIds.length) {
    hidden.pop();
  }

  const collapsed = Array.isArray(raw.collapsed)
    ? [...new Set(raw.collapsed.filter((id) => typeof id === "string" && validSet.has(id)))]
    : [...defaultCollapsed];

  return { order, hidden, collapsed };
}

/**
 * Initialize a Section Settings controller for a briefing page.
 *
 * @param {object} opts
 * @param {string} opts.prefKey - Preference key ("daily_sections" | "weekly_sections")
 * @param {string} opts.pageLabel - Modal title suffix (e.g. "Daily Briefing")
 * @param {Array<{id: string, label: string, defaultCollapsed?: boolean, setOpen?: (open: boolean) => void}>} opts.sections
 * @param {HTMLElement|null} opts.triggerBtn
 * @param {() => object|null} opts.getInitialLayout
 * @param {(layout: {order: string[], hidden: string[], collapsed: string[]}) => void} opts.onSave
 * @param {() => void} [opts.onApplied]
 */
export function initSectionSettings({
  prefKey,
  pageLabel = "Sections",
  sections = [],
  triggerBtn = null,
  getInitialLayout = () => null,
  onSave = () => {},
  onApplied = null,
  getBriefStyle = null,
  onBriefStyleChange = null,
} = {}) {
  const sectionMap = new Map(sections.map((s) => [s.id, s]));
  let current = normalizeSectionLayout(getInitialLayout(), sections);
  let modalEl = null;

  const syncBriefStyleUi = (styleVal) => {
    if (!modalEl) return;
    const cur = styleVal === "bullets" ? "bullets" : "regular";
    modalEl.querySelectorAll("[data-ss-brief-style]").forEach((btn) => {
      const active = btn.dataset.ssBriefStyle === cur;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-pressed", String(active));
    });
  };

  const applyDomOrderAndVisibility = () => {
    const appRoot = document.getElementById("app-root");
    const navLinks = document.querySelector(".nav-links");
    const hiddenSet = new Set(current.hidden);

    for (const id of current.order) {
      const secEl = document.getElementById(id);
      if (secEl && appRoot) {
        appRoot.appendChild(secEl);
        secEl.classList.toggle("section-user-hidden", hiddenSet.has(id));
      }
      const navLink = navLinks?.querySelector(`a[href="#${CSS.escape(id)}"]`);
      if (navLink && navLinks) {
        navLinks.appendChild(navLink);
        navLink.classList.toggle("section-user-hidden", hiddenSet.has(id));
      }
    }
  };

  const applyCollapseStates = () => {
    const collapsedSet = new Set(current.collapsed);
    for (const def of sections) {
      if (typeof def.setOpen === "function") {
        def.setOpen(!collapsedSet.has(def.id));
      }
    }
  };

  const applyLayout = (rawLayout, { applyCollapse = true } = {}) => {
    current = normalizeSectionLayout(rawLayout, sections);
    applyDomOrderAndVisibility();
    if (applyCollapse) {
      applyCollapseStates();
    }
    if (typeof onApplied === "function") onApplied(current);
    if (modalEl && !modalEl.classList.contains("hidden")) {
      renderRows();
    }
  };

  const commit = ({ applyCollapseForId = null } = {}) => {
    current = normalizeSectionLayout(current, sections);
    applyDomOrderAndVisibility();
    if (applyCollapseForId) {
      const def = sectionMap.get(applyCollapseForId);
      if (def && typeof def.setOpen === "function") {
        def.setOpen(!current.collapsed.includes(applyCollapseForId));
      }
    } else {
      applyCollapseStates();
    }
    onSave({
      order: [...current.order],
      hidden: [...current.hidden],
      collapsed: [...current.collapsed],
    });
    if (typeof onApplied === "function") onApplied(current);
    renderRows();
  };

  const renderRows = () => {
    const listEl = modalEl?.querySelector("[data-section-settings-list]");
    if (!listEl) return;
    const hiddenSet = new Set(current.hidden);
    const collapsedSet = new Set(current.collapsed);
    const visibleCount = current.order.length - hiddenSet.size;

    listEl.innerHTML = current.order
      .map((id, idx) => {
        const def = sectionMap.get(id);
        if (!def) return "";
        const isHidden = hiddenSet.has(id);
        const isCollapsed = collapsedSet.has(id);
        const disableHide = !isHidden && visibleCount <= 1;
        return `
          <div class="ss-row${isHidden ? " is-hidden" : ""}" data-sec-id="${escapeHtml(id)}">
            <div class="ss-move-group">
              <button type="button" class="ss-icon-btn" data-ss-action="up" ${idx === 0 ? "disabled" : ""} aria-label="Move ${escapeHtml(def.label)} up" title="Move up">${UP_SVG}</button>
              <button type="button" class="ss-icon-btn" data-ss-action="down" ${idx === current.order.length - 1 ? "disabled" : ""} aria-label="Move ${escapeHtml(def.label)} down" title="Move down">${DOWN_SVG}</button>
            </div>
            <span class="ss-label">${escapeHtml(def.label)}</span>
            <div class="ss-controls">
              <button type="button" class="ss-pill-btn${isCollapsed ? " is-collapsed" : ""}" data-ss-action="toggle-collapse" ${isHidden ? "disabled" : ""} title="Default state on page load">
                ${isCollapsed ? "Collapsed" : "Expanded"}
              </button>
              <button type="button" class="ss-icon-btn ss-vis-btn${isHidden ? " is-off" : ""}" data-ss-action="toggle-hide" ${disableHide ? "disabled" : ""} aria-label="${isHidden ? "Show" : "Hide"} ${escapeHtml(def.label)}" title="${isHidden ? "Show section" : "Hide section"}">
                ${isHidden ? EYE_OFF_SVG : EYE_SVG}
              </button>
            </div>
          </div>
        `;
      })
      .join("");
  };

  const ensureModal = () => {
    if (modalEl) return modalEl;
    modalEl = document.createElement("div");
    modalEl.className = "ss-backdrop hidden";
    modalEl.setAttribute("role", "dialog");
    modalEl.setAttribute("aria-modal", "true");
    modalEl.setAttribute("aria-label", `${pageLabel} Customization`);
    const curStyle = typeof getBriefStyle === "function" && getBriefStyle() === "bullets" ? "bullets" : "regular";
    const briefStyleHtml =
      typeof onBriefStyleChange === "function"
        ? `
          <div class="ss-pref-row" role="group" aria-label="Brief display style">
            <div class="ss-pref-meta">
              <span class="ss-pref-label">Brief style</span>
              <span class="ss-pref-hint">Paragraphs or one news item per bullet</span>
            </div>
            <div class="ss-seg">
              <button type="button" class="ss-seg-btn${curStyle === "regular" ? " active" : ""}" data-ss-brief-style="regular" aria-pressed="${curStyle === "regular"}">Regular</button>
              <button type="button" class="ss-seg-btn${curStyle === "bullets" ? " active" : ""}" data-ss-brief-style="bullets" aria-pressed="${curStyle === "bullets"}">Bullets</button>
            </div>
          </div>
        `
        : "";
    modalEl.innerHTML = `
      <div class="ss-modal">
        <div class="ss-header">
          <div>
            <h3>Customize</h3>
            <p class="ss-sub">Adjust brief style, reorder sections, toggle visibility, or choose default collapse state.</p>
          </div>
          <button type="button" class="ss-close" data-ss-close aria-label="Close customization">&times;</button>
        </div>
        ${briefStyleHtml}
        <div class="ss-list" data-section-settings-list></div>
        <div class="ss-footer">
          <button type="button" class="ss-reset-btn" data-ss-reset>Reset to defaults</button>
          <button type="button" class="ss-done-btn" data-ss-close>Done</button>
        </div>
      </div>
    `;
    document.body.appendChild(modalEl);

    modalEl.addEventListener("click", (e) => {
      if (e.target === modalEl || e.target.closest("[data-ss-close]")) {
        closeModal();
        return;
      }
      const styleBtn = e.target.closest("[data-ss-brief-style]");
      if (styleBtn && typeof onBriefStyleChange === "function") {
        const nextStyle = styleBtn.dataset.ssBriefStyle === "bullets" ? "bullets" : "regular";
        syncBriefStyleUi(nextStyle);
        onBriefStyleChange(nextStyle);
        return;
      }
      if (e.target.closest("[data-ss-reset]")) {
        current = normalizeSectionLayout(null, sections);
        commit();
        if (typeof onBriefStyleChange === "function") {
          syncBriefStyleUi("regular");
          onBriefStyleChange("regular");
        }
        return;
      }
      const actionBtn = e.target.closest("[data-ss-action]");
      if (!actionBtn || actionBtn.disabled) return;
      const row = actionBtn.closest("[data-sec-id]");
      const id = row?.dataset?.secId;
      if (!id) return;
      const action = actionBtn.dataset.ssAction;

      if (action === "up" || action === "down") {
        const idx = current.order.indexOf(id);
        const swap = action === "up" ? idx - 1 : idx + 1;
        if (idx >= 0 && swap >= 0 && swap < current.order.length) {
          const nextOrder = [...current.order];
          [nextOrder[idx], nextOrder[swap]] = [nextOrder[swap], nextOrder[idx]];
          current.order = nextOrder;
          commit({ applyCollapseForId: "__none__" });
        }
      } else if (action === "toggle-hide") {
        const set = new Set(current.hidden);
        if (set.has(id)) {
          set.delete(id);
        } else if (set.size < current.order.length - 1) {
          set.add(id);
        }
        current.hidden = [...set];
        commit({ applyCollapseForId: "__none__" });
      } else if (action === "toggle-collapse") {
        const set = new Set(current.collapsed);
        if (set.has(id)) {
          set.delete(id);
        } else {
          set.add(id);
        }
        current.collapsed = [...set];
        commit({ applyCollapseForId: id });
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && modalEl && !modalEl.classList.contains("hidden")) {
        closeModal();
      }
    });

    return modalEl;
  };

  const openModal = () => {
    ensureModal();
    if (typeof getBriefStyle === "function") {
      syncBriefStyleUi(getBriefStyle());
    }
    renderRows();
    modalEl.classList.remove("hidden");
    modalEl.querySelector("[data-ss-close]")?.focus();
  };

  const closeModal = () => {
    if (!modalEl) return;
    modalEl.classList.add("hidden");
    triggerBtn?.focus();
  };

  triggerBtn?.addEventListener("click", openModal);

  // Initial apply on page boot
  applyLayout(current, { applyCollapse: true });

  return {
    prefKey,
    openModal,
    closeModal,
    applyLayout,
    syncBriefStyle: syncBriefStyleUi,
    getLayout: () => ({
      order: [...current.order],
      hidden: [...current.hidden],
      collapsed: [...current.collapsed],
    }),
  };
}

/**
 * Shared Section Layout Settings (Show/Hide, Expanded/Collapsed on load, Reorder)
 * Reusable across Daily Briefing and Weekly Briefing, with localStorage + logged-in cloud sync.
 */

import { escapeHtml } from "./utils.js";

const GRIP_SVG = `<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="5.5" cy="3.5" r="1.25"/><circle cx="10.5" cy="3.5" r="1.25"/><circle cx="5.5" cy="8" r="1.25"/><circle cx="10.5" cy="8" r="1.25"/><circle cx="5.5" cy="12.5" r="1.25"/><circle cx="10.5" cy="12.5" r="1.25"/></svg>`;
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
  getShowListen = null,
  onShowListenChange = null,
  sortConfig = null,
  areAllExpanded = null,
  onToggleAll = null,
} = {}) {
  const sectionMap = new Map(sections.map((s) => [s.id, s]));
  let current = normalizeSectionLayout(getInitialLayout(), sections);
  let modalEl = null;

  const syncSortUi = (val) => {
    if (!modalEl || !sortConfig) return;
    const sel = modalEl.querySelector("[data-ss-sort]");
    if (sel && sel.value !== val) sel.value = val;
  };

  const areVisibleSettingsExpanded = () => {
    const hiddenSet = new Set(current.hidden);
    const collapsedSet = new Set(current.collapsed);
    const visibleIds = current.order.filter((id) => !hiddenSet.has(id));
    return visibleIds.length > 0 && visibleIds.every((id) => !collapsedSet.has(id));
  };

  const syncExpandAllUi = () => {
    if (!modalEl) return;
    const btn = modalEl.querySelector("[data-ss-expand-all]");
    if (!btn) return;
    const allOpen = areVisibleSettingsExpanded();
    btn.setAttribute("aria-expanded", String(allOpen));
    btn.textContent = allOpen ? "Collapse All" : "Expand All";
  };

  const syncBriefStyleUi = (styleVal) => {
    if (!modalEl) return;
    const cur = styleVal === "bullets" ? "bullets" : "regular";
    modalEl.querySelectorAll("[data-ss-brief-style]").forEach((btn) => {
      const active = btn.dataset.ssBriefStyle === cur;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-pressed", String(active));
    });
  };

  const syncShowListenUi = (enabledVal) => {
    if (!modalEl) return;
    const cur = Boolean(enabledVal);
    modalEl.querySelectorAll("[data-ss-show-listen]").forEach((btn) => {
      const active = (btn.dataset.ssShowListen === "on") === cur;
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
    syncExpandAllUi();
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
    syncExpandAllUi();
    renderRows();
  };

  const renderRows = () => {
    const listEl = modalEl?.querySelector("[data-section-settings-list]");
    if (!listEl) return;
    const hiddenSet = new Set(current.hidden);
    const collapsedSet = new Set(current.collapsed);
    const visibleCount = current.order.length - hiddenSet.size;

    listEl.innerHTML = current.order
      .map((id) => {
        const def = sectionMap.get(id);
        if (!def) return "";
        const isHidden = hiddenSet.has(id);
        const isCollapsed = collapsedSet.has(id);
        const disableHide = !isHidden && visibleCount <= 1;
        return `
          <div class="ss-row${isHidden ? " is-hidden" : ""}" data-sec-id="${escapeHtml(id)}">
            <span class="ss-drag-handle" role="button" tabindex="0" aria-label="Drag to reorder ${escapeHtml(def.label)}" title="Drag to reorder (or use Arrow Up/Down)">${GRIP_SVG}</span>
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
    const curListen = typeof getShowListen === "function" && Boolean(getShowListen());
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
    const showListenHtml =
      typeof onShowListenChange === "function"
        ? `
          <div class="ss-pref-row tts-pref-only" role="group" aria-label="Show listen buttons">
            <div class="ss-pref-meta">
              <span class="ss-pref-label">Listen buttons</span>
              <span class="ss-pref-hint">Show text-to-speech playback controls on items</span>
            </div>
            <div class="ss-seg">
              <button type="button" class="ss-seg-btn${!curListen ? " active" : ""}" data-ss-show-listen="off" aria-pressed="${!curListen}">Off</button>
              <button type="button" class="ss-seg-btn${curListen ? " active" : ""}" data-ss-show-listen="on" aria-pressed="${curListen}">On</button>
            </div>
          </div>
        `
        : "";
    const sortHtml =
      sortConfig && Array.isArray(sortConfig.options) && sortConfig.options.length
        ? `
          <div class="ss-pref-row">
            <div class="ss-pref-meta">
              <span class="ss-pref-label">${escapeHtml(sortConfig.label || "Sort order")}</span>
              ${sortConfig.hint ? `<span class="ss-pref-hint">${escapeHtml(sortConfig.hint)}</span>` : ""}
            </div>
            <select class="ss-select" data-ss-sort aria-label="${escapeHtml(sortConfig.label || "Sort order")}">
              ${sortConfig.options
                .map((opt) => {
                  const curVal = typeof sortConfig.getValue === "function" ? sortConfig.getValue() : sortConfig.defaultValue;
                  return `<option value="${escapeHtml(opt.value)}"${opt.value === curVal ? " selected" : ""}>${escapeHtml(opt.label)}</option>`;
                })
                .join("")}
            </select>
          </div>
        `
        : "";
    const listHeadHtml =
      sections.length && typeof onToggleAll === "function"
        ? `
          <div class="ss-list-head">
            <span class="ss-list-title">Sections</span>
            <button type="button" class="ss-expand-all-btn" data-ss-expand-all aria-expanded="false">Expand All</button>
          </div>
        `
        : "";
    const listHtml = sections.length ? `<div class="ss-list" data-section-settings-list></div>` : "";
    modalEl.innerHTML = `
      <div class="ss-modal">
        <div class="ss-header">
          <h3>Customize</h3>
          <button type="button" class="ss-close" data-ss-close aria-label="Close customization">&times;</button>
        </div>
        ${sortHtml}
        ${briefStyleHtml}
        ${showListenHtml}
        ${listHeadHtml}
        ${listHtml}
        <div class="ss-footer">
          <button type="button" class="ss-reset-btn" data-ss-reset>Reset to defaults</button>
          <button type="button" class="ss-done-btn" data-ss-close>Done</button>
        </div>
      </div>
    `;
    document.body.appendChild(modalEl);

    modalEl.querySelector("[data-ss-sort]")?.addEventListener("change", (e) => {
      if (typeof sortConfig?.onChange === "function") {
        sortConfig.onChange(e.target.value);
      }
    });

    modalEl.addEventListener("click", (e) => {
      if (e.target === modalEl || e.target.closest("[data-ss-close]")) {
        closeModal();
        return;
      }
      if (e.target.closest("[data-ss-expand-all]")) {
        const hiddenSet = new Set(current.hidden);
        const visibleIds = current.order.filter((id) => !hiddenSet.has(id));
        const nextCollapsed = new Set(current.collapsed);
        if (areVisibleSettingsExpanded()) {
          for (const id of visibleIds) nextCollapsed.add(id);
        } else {
          for (const id of visibleIds) nextCollapsed.delete(id);
        }
        current.collapsed = [...nextCollapsed];
        commit();
        return;
      }
      const styleBtn = e.target.closest("[data-ss-brief-style]");
      if (styleBtn && typeof onBriefStyleChange === "function") {
        const nextStyle = styleBtn.dataset.ssBriefStyle === "bullets" ? "bullets" : "regular";
        syncBriefStyleUi(nextStyle);
        onBriefStyleChange(nextStyle);
        return;
      }
      const listenBtn = e.target.closest("[data-ss-show-listen]");
      if (listenBtn && typeof onShowListenChange === "function") {
        const nextOn = listenBtn.dataset.ssShowListen === "on";
        syncShowListenUi(nextOn);
        onShowListenChange(nextOn);
        return;
      }
      if (e.target.closest("[data-ss-reset]")) {
        if (sections.length) {
          current = normalizeSectionLayout(null, sections);
          commit();
        }
        if (sortConfig && typeof sortConfig.onChange === "function") {
          const defVal = sortConfig.defaultValue ?? sortConfig.options?.[0]?.value ?? "";
          syncSortUi(defVal);
          sortConfig.onChange(defVal);
        }
        if (typeof onBriefStyleChange === "function") {
          syncBriefStyleUi("regular");
          onBriefStyleChange("regular");
        }
        if (typeof onShowListenChange === "function") {
          syncShowListenUi(false);
          onShowListenChange(false);
        }
        return;
      }
      const actionBtn = e.target.closest("[data-ss-action]");
      if (!actionBtn || actionBtn.disabled) return;
      const row = actionBtn.closest("[data-sec-id]");
      const id = row?.dataset?.secId;
      if (!id) return;
      const action = actionBtn.dataset.ssAction;

      if (action === "toggle-hide") {
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

    // Pointer-based drag-and-drop reordering on left drag handle (works on desktop + touch)
    const listEl = modalEl.querySelector("[data-section-settings-list]");
    let dragState = null;

    listEl?.addEventListener("pointerdown", (e) => {
      const handle = e.target.closest(".ss-drag-handle");
      if (!handle || (e.pointerType === "mouse" && e.button !== 0)) return;
      const row = handle.closest(".ss-row");
      if (!row) return;
      e.preventDefault();
      try {
        handle.setPointerCapture(e.pointerId);
      } catch {
        // Ignore capture failures
      }
      row.classList.add("is-dragging");
      dragState = {
        pointerId: e.pointerId,
        handle,
        row,
        initialOrder: current.order.join(","),
      };
    });

    listEl?.addEventListener("pointermove", (e) => {
      if (!dragState || e.pointerId !== dragState.pointerId) return;
      e.preventDefault();
      const { row } = dragState;
      const siblings = [...listEl.querySelectorAll(".ss-row:not(.is-dragging)")];
      let insertBeforeEl = null;
      for (const sib of siblings) {
        const rect = sib.getBoundingClientRect();
        if (e.clientY < rect.top + rect.height / 2) {
          insertBeforeEl = sib;
          break;
        }
      }
      if (insertBeforeEl) {
        if (row.nextElementSibling !== insertBeforeEl) {
          listEl.insertBefore(row, insertBeforeEl);
        }
      } else if (listEl.lastElementChild !== row) {
        listEl.appendChild(row);
      }
    });

    const finishDrag = (e) => {
      if (!dragState || e.pointerId !== dragState.pointerId) return;
      const { handle, row, initialOrder } = dragState;
      dragState = null;
      try {
        handle.releasePointerCapture(e.pointerId);
      } catch {
        // Ignore
      }
      row.classList.remove("is-dragging");
      const nextOrder = [...listEl.querySelectorAll(".ss-row")]
        .map((el) => el.dataset.secId)
        .filter(Boolean);
      if (nextOrder.length === current.order.length && nextOrder.join(",") !== initialOrder) {
        current.order = nextOrder;
        commit({ applyCollapseForId: "__none__" });
      }
    };

    listEl?.addEventListener("pointerup", finishDrag);
    listEl?.addEventListener("pointercancel", finishDrag);

    // Keyboard ArrowUp / ArrowDown reordering on focused drag handle
    listEl?.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      const handle = e.target.closest(".ss-drag-handle");
      if (!handle) return;
      const row = handle.closest(".ss-row");
      const id = row?.dataset?.secId;
      if (!id) return;
      const idx = current.order.indexOf(id);
      const swap = e.key === "ArrowUp" ? idx - 1 : idx + 1;
      if (idx >= 0 && swap >= 0 && swap < current.order.length) {
        e.preventDefault();
        const nextOrder = [...current.order];
        [nextOrder[idx], nextOrder[swap]] = [nextOrder[swap], nextOrder[idx]];
        current.order = nextOrder;
        commit({ applyCollapseForId: "__none__" });
        listEl.querySelector(`.ss-row[data-sec-id="${CSS.escape(id)}"] .ss-drag-handle`)?.focus();
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
    if (typeof getShowListen === "function") {
      syncShowListenUi(getShowListen());
    }
    if (sortConfig && typeof sortConfig.getValue === "function") {
      syncSortUi(sortConfig.getValue());
    }
    syncExpandAllUi();
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
  if (sections.length) {
    applyLayout(current, { applyCollapse: true });
  }

  return {
    prefKey,
    openModal,
    closeModal,
    applyLayout,
    syncBriefStyle: syncBriefStyleUi,
    syncShowListen: syncShowListenUi,
    syncSort: syncSortUi,
    syncExpandAll: syncExpandAllUi,
    getLayout: () => ({
      order: [...current.order],
      hidden: [...current.hidden],
      collapsed: [...current.collapsed],
    }),
  };
}

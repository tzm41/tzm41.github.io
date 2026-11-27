/**
 * Shared Archive Date Navigation & Refresh Controller
 * Used by both Daily Briefing (/briefing/) and Weekly Briefing (/weekly/).
 */

import { fetchJson } from "./utils.js";

export function createArchiveController({
  dateSelectEl,
  prevBtnEl,
  nextBtnEl,
  refreshBtnEl,
  indexUrl,
  getDates,
  getCurrentDate,
  isViewingLatest,
  onIndexLoaded,
  onSelectDate,
  onRefresh,
}) {
  function populateDateSelect(dates = []) {
    if (!dateSelectEl) return;
    dateSelectEl.innerHTML = "";

    const latestOpt = document.createElement("option");
    latestOpt.value = "latest";
    latestOpt.textContent = "Latest";
    dateSelectEl.appendChild(latestOpt);

    for (const d of dates) {
      const opt = document.createElement("option");
      opt.value = d;
      opt.textContent = d;
      dateSelectEl.appendChild(opt);
    }
  }

  function updateControls() {
    const dates = getDates() || [];
    const currentDate = getCurrentDate();
    const idx = dates.indexOf(currentDate);
    if (dateSelectEl) {
      const targetVal = isViewingLatest() ? "latest" : currentDate || "latest";
      if (dateSelectEl.value !== targetVal) {
        dateSelectEl.value = targetVal;
      }
    }
    if (prevBtnEl) prevBtnEl.disabled = idx === -1 || idx >= dates.length - 1;
    if (nextBtnEl) nextBtnEl.disabled = idx <= 0;
  }

  function syncUrlDate(dateStr, isLatest) {
    const target = new URL(window.location.href);
    target.searchParams.set("date", isLatest ? "latest" : dateStr);
    window.history.replaceState(null, "", target);
  }

  function resolveRequestedDate(dates = []) {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("date");
    if (requested && requested !== "latest" && dates.includes(requested)) {
      return requested;
    }
    return "latest";
  }

  function bind() {
    dateSelectEl?.addEventListener("change", () => {
      onSelectDate(dateSelectEl.value);
    });

    prevBtnEl?.addEventListener("click", () => {
      const dates = getDates() || [];
      const idx = dates.indexOf(getCurrentDate());
      if (idx >= 0 && idx < dates.length - 1) {
        onSelectDate(dates[idx + 1]);
      }
    });

    nextBtnEl?.addEventListener("click", () => {
      const dates = getDates() || [];
      const idx = dates.indexOf(getCurrentDate());
      if (idx > 0) {
        onSelectDate(idx === 1 ? "latest" : dates[idx - 1]);
      }
    });

    refreshBtnEl?.addEventListener("click", async () => {
      if (refreshBtnEl.disabled) return;
      refreshBtnEl.disabled = true;
      refreshBtnEl.classList.add("is-spinning");
      try {
        try {
          const idxData = await fetchJson(indexUrl, { cache: "no-store" });
          onIndexLoaded?.(idxData);
          populateDateSelect(idxData?.dates || []);
        } catch {
          // Proceed with refresh even if index fetch fails
        }
        await onRefresh?.();
      } finally {
        refreshBtnEl.disabled = false;
        refreshBtnEl.classList.remove("is-spinning");
      }
    });
  }

  return {
    populateDateSelect,
    updateControls,
    syncUrlDate,
    resolveRequestedDate,
    bind,
  };
}

/**
 * Homepage Controller (/index.html)
 * External ES module under strict CSP — zero cold-load Worker/GIS calls when signed out.
 */

import { bindBookmarkCountBadge } from "./shared/bookmarks.js";
import { initAuth, setPreference } from "./shared/auth.js";

const switcher = document.getElementById("theme-switcher");
const countEl = document.getElementById("home-bookmarks-count");
const media = window.matchMedia?.("(prefers-color-scheme: dark)");

function resolveHomeTheme(pref) {
  if (pref === "light" || pref === "dark") return pref;
  return media && media.matches ? "dark" : "light";
}

function applyHomeTheme(pref, { persist = false } = {}) {
  const valid = ["system", "light", "dark"].includes(pref) ? pref : "system";
  if (persist) {
    try {
      localStorage.setItem("briefing-theme", valid);
    } catch {
      // Ignore storage errors
    }
  }
  document.documentElement.setAttribute("data-theme", resolveHomeTheme(valid));
  if (switcher) {
    switcher.querySelectorAll(".seg-btn").forEach((btn) => {
      const active = btn.dataset.themePref === valid;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-pressed", String(active));
    });
  }
}

applyHomeTheme(localStorage.getItem("briefing-theme") || "system");

switcher?.addEventListener("click", (e) => {
  const btn = e.target.closest(".seg-btn");
  if (!btn) return;
  const next = btn.dataset.themePref || "system";
  applyHomeTheme(next, { persist: true });
  setPreference("theme", next);
});

media?.addEventListener?.("change", () => {
  if ((localStorage.getItem("briefing-theme") || "system") === "system") {
    applyHomeTheme("system");
  }
});

bindBookmarkCountBadge(countEl, { format: (n) => String(n) });

initAuth({
  mountEl: document.getElementById("auth-mount"),
  bookmarksHref: "/bookmarks/",
  onPreferencesApplied(prefs) {
    if (prefs?.theme && ["system", "light", "dark"].includes(prefs.theme)) {
      applyHomeTheme(prefs.theme, { persist: true });
    }
  },
});

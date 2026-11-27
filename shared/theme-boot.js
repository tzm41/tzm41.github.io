/**
 * Synchronous FOUC-free theme boot script (CSP-safe external script for <head>).
 * Reads localStorage("briefing-theme") and sets documentElement[data-theme] before first paint.
 */
(function () {
  try {
    var pref = localStorage.getItem("briefing-theme") || "system";
    var resolved =
      pref === "light" || pref === "dark"
        ? pref
        : window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    document.documentElement.setAttribute("data-theme", resolved);
  } catch (e) {
    // Ignore storage access errors in restricted contexts
  }
})();

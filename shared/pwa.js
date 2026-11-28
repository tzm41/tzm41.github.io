/**
 * Shared PWA Controller for colintan.dev Briefings
 * - Registers root /sw.js with { scope: "/", updateViaCache: "none" }
 * - Throttled 30-minute SW update check on visibilitychange
 * - Graceful offline notice when mutable data is served from SW cache
 */

const UPDATE_THROTTLE_MS = 30 * 60 * 1000;
const OFFLINE_MESSAGE = "Offline — showing cached edition. Reconnect to refresh.";

let pwaInitialized = false;

function isSwEligible() {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  if (!("serviceWorker" in navigator)) return false;
  const proto = window.location.protocol;
  const host = window.location.hostname;
  return proto === "https:" || host === "localhost" || host === "127.0.0.1";
}

function showOfflineToast() {
  let el = document.querySelector(".auth-toast[data-pwa-offline-toast]");
  if (!el) {
    el = document.createElement("div");
    el.className = "auth-toast";
    el.dataset.pwaOfflineToast = "1";
    el.setAttribute("role", "status");
    document.body.appendChild(el);
  }
  el.textContent = OFFLINE_MESSAGE;
  el.classList.remove("hidden");
}

function hideOfflineNotice() {
  const banner = document.getElementById("status-banner");
  if (banner && banner.classList.contains("is-offline")) {
    banner.classList.add("hidden");
    banner.classList.remove("is-offline");
    banner.textContent = "";
  }
  const toast = document.querySelector(".auth-toast[data-pwa-offline-toast]");
  if (toast) {
    toast.classList.add("hidden");
  }
}

export function initPwa() {
  if (pwaInitialized || typeof window === "undefined") return;
  pwaInitialized = true;

  let offlinePendingRaf = 0;

  window.addEventListener("pwa:offline-data", () => {
    if (offlinePendingRaf) return;
    offlinePendingRaf = window.requestAnimationFrame(() => {
      offlinePendingRaf = 0;
      const banner = document.getElementById("status-banner");
      if (banner) {
        banner.textContent = OFFLINE_MESSAGE;
        banner.className = "status-banner is-offline";
      } else {
        showOfflineToast();
      }
    });
  });

  window.addEventListener("online", () => {
    hideOfflineNotice();
  });

  if (!isSwEligible()) return;

  let registration = null;
  let lastUpdateCheck = 0;

  const registerSw = async () => {
    try {
      registration = await navigator.serviceWorker.register("/sw.js", {
        scope: "/",
        updateViaCache: "none",
      });
      lastUpdateCheck = Date.now();
    } catch {
      // Ignore SW registration failures in restricted or unsupported contexts
    }
  };

  if (document.readyState === "complete") {
    registerSw();
  } else {
    window.addEventListener("load", registerSw, { once: true });
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || !registration) return;
    const now = Date.now();
    if (now - lastUpdateCheck < UPDATE_THROTTLE_MS) return;
    lastUpdateCheck = now;
    registration.update().catch(() => {});
  });
}

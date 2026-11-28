/**
 * Shared Google Identity Services (GIS) Auth, Account Menu & Cloud Sync Engine
 * - Zero cold-load network requests when signed out
 * - Lazy-loads Google GIS script only on click
 * - Debounced PUT /user/state with optimistic concurrency (409 merge + single retry)
 * - Keepalive flush on visibilitychange/pagehide with persistent dirty flag
 */

import {
  exportForSync,
  getBookmarks,
  mergeFromRemote,
  onBookmarksChange,
  registerSyncAdapter,
} from "./bookmarks.js";
import { escapeHtml } from "./utils.js";

export const API_BASE = "https://colintan.dev";
export const GOOGLE_CLIENT_ID =
  "860276707063-9giqi2mtolon02mntnh0vjmi1uos9sge.apps.googleusercontent.com";

const SESSION_KEY = "briefing-auth-session-v1";
const PREFS_KEY = "briefing-prefs-v1";
const DIRTY_KEY = "briefing-sync-dirty-v1";
const LAST_SYNC_SESSION_KEY = "briefing-last-sync-ms";
const THEME_KEY = "briefing-theme";

const GIS_SCRIPT_URL = "https://accounts.google.com/gsi/client";
const GIS_LOAD_TIMEOUT_MS = 8000;
const DEBOUNCE_PUSH_MS = 2000;
const FRESH_SYNC_SKIP_MS = 30000;
const KEEPALIVE_MAX_BYTES = 48 * 1024;

const PREF_SUBKEYS = [
  "local_region",
  "local_lang",
  "market_tf",
  "world_kind_filter",
  "brief_style",
  "show_listen",
  "daily_sections",
  "weekly_sections",
];

/* ---------- State ---------- */

let session = null; // { token, user, rev, hash, rev_sig, etag }
let syncStatus = "idle"; // "idle" | "syncing" | "synced" | "local" | "error"
let pushTimer = null;
let pushInFlight = false;
let pullInFlight = null;
let gisLoadPromise = null;
let gisInitialized = false;

let widgetMountEl = null;
let widgetBookmarksHref = "/bookmarks/";
let onPreferencesAppliedCb = null;
let onAuthChangeCb = null;
let globalEventsBound = false;
let bookmarksUnsub = null;
let popoverOpen = false;
let menuOpen = false;

/* ---------- Storage Helpers ---------- */

function readJson(storage, key) {
  try {
    const raw = storage?.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(storage, key, val) {
  try {
    storage?.setItem(key, JSON.stringify(val));
  } catch {
    // Ignore quota / private browsing errors
  }
}

function removeKey(storage, key) {
  try {
    storage?.removeItem(key);
  } catch {
    // Ignore
  }
}

function loadSessionFromStorage() {
  const raw = readJson(typeof localStorage !== "undefined" ? localStorage : null, SESSION_KEY);
  if (raw && typeof raw.token === "string" && raw.token && raw.user && typeof raw.user === "object") {
    return {
      token: raw.token,
      user: {
        uid: String(raw.user.uid || raw.user.sub || ""),
        name: String(raw.user.name || ""),
        picture: String(raw.user.picture || ""),
      },
      rev: Number.isFinite(Number(raw.rev)) ? Number(raw.rev) : 0,
      hash: String(raw.hash || ""),
      rev_sig: String(raw.rev_sig || ""),
      etag: String(raw.etag || ""),
    };
  }
  return null;
}

function saveSessionToStorage(nextSession) {
  session = nextSession;
  if (nextSession) {
    writeJson(localStorage, SESSION_KEY, nextSession);
  } else {
    removeKey(localStorage, SESSION_KEY);
  }
}

function isDirty() {
  try {
    return localStorage.getItem(DIRTY_KEY) === "1";
  } catch {
    return false;
  }
}

function setDirty(flag) {
  try {
    if (flag) localStorage.setItem(DIRTY_KEY, "1");
    else localStorage.removeItem(DIRTY_KEY);
  } catch {
    // Ignore
  }
  if (syncStatus !== "syncing") {
    updateSyncStatusUi();
  }
  emitSyncStatus();
}

function getLastSyncMs() {
  try {
    const v = Number(sessionStorage.getItem(LAST_SYNC_SESSION_KEY) || 0);
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}

function recordLastSyncNow() {
  try {
    sessionStorage.setItem(LAST_SYNC_SESSION_KEY, String(Date.now()));
  } catch {
    // Ignore
  }
}

/* ---------- Preferences API ---------- */

export function getLocalPreferences() {
  const blob = readJson(typeof localStorage !== "undefined" ? localStorage : null, PREFS_KEY) || {};
  let theme = "system";
  try {
    theme = localStorage.getItem(THEME_KEY) || "system";
  } catch {
    // Ignore
  }
  return {
    theme,
    local_region: blob.local_region ?? null,
    local_lang: blob.local_lang ?? null,
    market_tf: blob.market_tf ?? null,
    world_kind_filter: blob.world_kind_filter ?? null,
    brief_style: blob.brief_style ?? "regular",
    show_listen: blob.show_listen === true,
    daily_sections: blob.daily_sections ?? null,
    weekly_sections: blob.weekly_sections ?? null,
    updated_at: Number.isFinite(Number(blob.updated_at)) ? Math.floor(Number(blob.updated_at)) : 0,
  };
}

function persistLocalPreferencesRaw(prefs) {
  try {
    if (prefs.theme === "system" || prefs.theme === "light" || prefs.theme === "dark") {
      localStorage.setItem(THEME_KEY, prefs.theme);
    }
    const existing = readJson(localStorage, PREFS_KEY) || {};
    const nextBlob = {
      ...existing,
      local_region: prefs.local_region ?? existing.local_region ?? null,
      local_lang: prefs.local_lang ?? existing.local_lang ?? null,
      market_tf: prefs.market_tf ?? existing.market_tf ?? null,
      world_kind_filter: prefs.world_kind_filter ?? existing.world_kind_filter ?? null,
      brief_style: prefs.brief_style ?? existing.brief_style ?? "regular",
      show_listen:
        typeof prefs.show_listen === "boolean"
          ? prefs.show_listen
          : Boolean(existing.show_listen === true),
      daily_sections: prefs.daily_sections !== undefined ? prefs.daily_sections : (existing.daily_sections ?? null),
      weekly_sections: prefs.weekly_sections !== undefined ? prefs.weekly_sections : (existing.weekly_sections ?? null),
      updated_at: Number.isFinite(Number(prefs.updated_at))
        ? Math.floor(Number(prefs.updated_at))
        : Math.floor(Date.now() / 1000),
    };
    writeJson(localStorage, PREFS_KEY, nextBlob);
  } catch {
    // Ignore
  }
}

export function setPreference(key, value) {
  try {
    const nowSec = Math.floor(Date.now() / 1000);
    const blob = readJson(localStorage, PREFS_KEY) || {};
    if (key === "theme") {
      localStorage.setItem(THEME_KEY, String(value));
    } else if (PREF_SUBKEYS.includes(key)) {
      blob[key] = value;
    } else {
      return;
    }
    blob.updated_at = Math.max(nowSec, Number(blob.updated_at || 0));
    writeJson(localStorage, PREFS_KEY, blob);
  } catch {
    // Ignore
  }

  if (isSignedIn()) {
    setDirty(true);
    schedulePush();
  }
}

function mergePreferences(localPrefs, remotePrefs) {
  if (!remotePrefs || typeof remotePrefs !== "object") {
    return { merged: localPrefs, localChanged: false, differsFromRemote: true };
  }
  const localTs = Number(localPrefs?.updated_at || 0);
  const remoteTs = Number(remotePrefs?.updated_at || 0);
  const cloudWins = remoteTs > localTs;

  const keys = ["theme", ...PREF_SUBKEYS];
  const merged = { updated_at: Math.max(localTs, remoteTs) };
  for (const k of keys) {
    const lv = localPrefs?.[k] ?? null;
    const rv = remotePrefs?.[k] ?? null;
    if (cloudWins) {
      merged[k] = rv !== null && rv !== undefined && rv !== "" ? rv : lv;
    } else {
      merged[k] = lv !== null && lv !== undefined && lv !== "" ? lv : rv;
    }
  }
  if (!merged.theme) merged.theme = "system";

  const eq = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const localChanged = keys.some((k) => !eq(merged[k], localPrefs?.[k])) ||
    merged.updated_at !== localTs;
  const differsFromRemote = keys.some((k) => !eq(merged[k], remotePrefs?.[k]));

  return { merged, localChanged, differsFromRemote };
}

/* ---------- Avatar & Safety Helpers ---------- */

function safeGoogleAvatarUrl(raw) {
  if (typeof raw !== "string" || !raw || raw.length > 512) return "";
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:") return "";
    if (parsed.username || parsed.password) return "";
    const host = parsed.hostname.toLowerCase();
    const okHost =
      /^lh[3-6]\.googleusercontent\.com$/.test(host) ||
      host === "ggpht.com" ||
      host.endsWith(".ggpht.com");
    if (!okHost) return "";
    return escapeHtml(parsed.href);
  } catch {
    return "";
  }
}

function getUserInitials(user) {
  const src = String(user?.name || user?.email || "?").trim();
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }
  return src.slice(0, 2).toUpperCase() || "?";
}

function safeInternalHref(href) {
  if (typeof href !== "string") return "/bookmarks/";
  const trimmed = href.trim();
  if ((trimmed.startsWith("/") && !trimmed.startsWith("//")) || trimmed.startsWith("./") || trimmed.startsWith("../")) {
    return escapeHtml(trimmed);
  }
  return "/bookmarks/";
}

/* ---------- Auth Public Getters ---------- */

export function getUser() {
  return session?.user ? { ...session.user } : null;
}

export function isSignedIn() {
  return Boolean(session?.token && session?.user);
}

function clearSessionOnly({ notify = true } = {}) {
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  saveSessionToStorage(null);
  removeKey(typeof sessionStorage !== "undefined" ? sessionStorage : null, LAST_SYNC_SESSION_KEY);
  syncStatus = "idle";
  menuOpen = false;
  popoverOpen = false;
  renderWidget();
  emitSyncStatus();
  if (notify) {
    onAuthChangeCb?.(null);
  }
}

export function signOut() {
  try {
    window.google?.accounts?.id?.disableAutoSelect?.();
  } catch {
    // Ignore if GIS not loaded
  }
  setDirty(false);
  clearSessionOnly({ notify: true });
}

/* ---------- Cloud Sync Engine ---------- */

function captureRefreshedToken(resp) {
  if (!session || !resp?.headers) return;
  const refreshed = resp.headers.get("X-Refreshed-Token");
  if (refreshed && refreshed !== session.token) {
    saveSessionToStorage({ ...session, token: refreshed });
  }
}

const syncStatusListeners = new Set();

export function getSyncState() {
  const signedIn = isSignedIn();
  const dirty = isDirty();
  const { text, cls } = signedIn
    ? syncStatusMeta()
    : { text: "Not signed in", cls: "is-signed-out" };
  return {
    signedIn,
    status: signedIn ? syncStatus : "signed_out",
    dirty,
    text,
    cls,
    user: getUser(),
  };
}

export function onSyncStatusChange(listener) {
  if (typeof listener !== "function") return () => {};
  syncStatusListeners.add(listener);
  return () => {
    syncStatusListeners.delete(listener);
  };
}

function emitSyncStatus() {
  if (!syncStatusListeners.size) return;
  const snapshot = getSyncState();
  for (const fn of syncStatusListeners) {
    try {
      fn(snapshot);
    } catch {
      // Isolate listener errors
    }
  }
}

function setSyncStatus(next) {
  syncStatus = next;
  updateSyncStatusUi();
  emitSyncStatus();
}

function syncStatusMeta() {
  switch (syncStatus) {
    case "syncing":
      return { text: "Syncing…", cls: "is-syncing" };
    case "synced":
      return { text: "Synced", cls: "is-synced" };
    case "local":
    case "error":
      return { text: "Saved locally", cls: "is-local" };
    default:
      return isDirty()
        ? { text: "Saved locally", cls: "is-local" }
        : { text: "Synced", cls: "is-synced" };
  }
}

function updateSyncStatusUi() {
  if (!widgetMountEl) return;
  const el = widgetMountEl.querySelector(".auth-sync-status");
  if (!el) return;
  const { text, cls } = syncStatusMeta();
  el.className = `auth-sync-status ${cls}`;
  el.innerHTML = `<span class="auth-sync-dot" aria-hidden="true"></span><span>${escapeHtml(text)}</span>`;
}

function updateBookmarkCountUi() {
  if (!widgetMountEl) return;
  const badge = widgetMountEl.querySelector(".auth-menu-count");
  if (badge) {
    badge.textContent = String(getBookmarks().length);
  }
}

function buildStatePayload() {
  const { items, deleted } = exportForSync();
  return {
    schema_version: 1,
    base_rev: session?.rev ?? 0,
    base_hash: session?.hash ?? "",
    rev_sig: session?.rev_sig ?? "",
    preferences: getLocalPreferences(),
    bookmarks: items,
    deleted,
  };
}

function applyServerStateMeta(data, etagHeader = "") {
  if (!session || !data || typeof data !== "object") return;
  const next = {
    ...session,
    rev: Number.isFinite(Number(data.rev)) ? Number(data.rev) : session.rev,
    hash:
      typeof data.content_hash === "string" && data.content_hash
        ? data.content_hash
        : typeof data.hash === "string" && data.hash
        ? data.hash
        : session.hash,
    rev_sig: typeof data.rev_sig === "string" ? data.rev_sig : session.rev_sig,
    etag: etagHeader || session.etag,
  };
  saveSessionToStorage(next);
}

function reconcileRemoteState(remoteData, { isInitialSignIn = false } = {}) {
  const remoteBookmarks = remoteData?.bookmarks ?? remoteData?.items ?? [];
  const remoteDeleted = remoteData?.deleted ?? {};
  const bmResult = mergeFromRemote(remoteBookmarks, remoteDeleted);

  const localPrefs = getLocalPreferences();
  const prefResult = mergePreferences(localPrefs, remoteData?.preferences || null);
  if (prefResult.localChanged) {
    persistLocalPreferencesRaw(prefResult.merged);
    try {
      onPreferencesAppliedCb?.(prefResult.merged);
    } catch {
      // Isolate callback errors
    }
  }

  const needsPush =
    isDirty() ||
    (isInitialSignIn && (bmResult.differsFromRemote || prefResult.differsFromRemote));

  return { bmResult, prefResult, needsPush };
}

async function pullFromCloud({ isInitialSignIn = false, force = false } = {}) {
  if (!isSignedIn()) return { ok: false, reason: "signed_out" };
  if (!force && !isInitialSignIn && !isDirty()) {
    const last = getLastSyncMs();
    if (last && Date.now() - last < FRESH_SYNC_SKIP_MS) {
      setSyncStatus("synced");
      return { ok: true, skipped: true };
    }
  }
  if (pullInFlight) return pullInFlight;

  pullInFlight = (async () => {
    setSyncStatus("syncing");
    try {
      const headers = { Authorization: `Bearer ${session.token}` };
      if (!force && !isInitialSignIn && session.etag) {
        headers["If-None-Match"] = session.etag;
      }
      const resp = await fetch(`${API_BASE}/user/state`, {
        method: "GET",
        headers,
        cache: "no-store",
      });

      if (resp.status === 401) {
        clearSessionOnly({ notify: true });
        return { ok: false, status: 401 };
      }

      captureRefreshedToken(resp);

      if (resp.status === 304) {
        recordLastSyncNow();
        if (isDirty()) {
          return await pushToCloud(0);
        }
        setSyncStatus("synced");
        return { ok: true, status: 304 };
      }

      if (!resp.ok) {
        setSyncStatus("local");
        return { ok: false, status: resp.status };
      }

      const data = await resp.json();
      const etag = resp.headers.get("ETag") || "";
      applyServerStateMeta(data, etag);
      recordLastSyncNow();

      const { needsPush } = reconcileRemoteState(data, { isInitialSignIn });
      if (needsPush) {
        setDirty(true);
        return await pushToCloud(0);
      }

      setDirty(false);
      setSyncStatus("synced");
      return { ok: true, status: 200 };
    } catch {
      setSyncStatus("local");
      return { ok: false, status: 0 };
    } finally {
      pullInFlight = null;
    }
  })();

  return pullInFlight;
}

async function pushToCloud(retryCount = 0) {
  if (!isSignedIn()) return { ok: false, reason: "signed_out" };
  if (pushInFlight) return { ok: false, reason: "in_flight" };

  pushInFlight = true;
  setSyncStatus("syncing");

  try {
    const payload = buildStatePayload();
    const resp = await fetch(`${API_BASE}/user/state`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });

    if (resp.status === 401) {
      clearSessionOnly({ notify: true });
      return { ok: false, status: 401 };
    }

    captureRefreshedToken(resp);

    if (resp.status === 409) {
      let conflictData = null;
      try {
        const body = await resp.json();
        conflictData = body?.state || body?.current || body;
      } catch {
        conflictData = null;
      }

      if (!conflictData || (conflictData.rev == null && !conflictData.bookmarks && !conflictData.items)) {
        const getResp = await fetch(`${API_BASE}/user/state`, {
          method: "GET",
          headers: { Authorization: `Bearer ${session.token}` },
          cache: "no-store",
        });
        if (getResp.status === 401) {
          clearSessionOnly({ notify: true });
          return { ok: false, status: 401 };
        }
        captureRefreshedToken(getResp);
        if (getResp.ok) {
          conflictData = await getResp.json();
          applyServerStateMeta(conflictData, getResp.headers.get("ETag") || "");
        }
      } else {
        applyServerStateMeta(conflictData, resp.headers.get("ETag") || "");
      }

      if (conflictData) {
        reconcileRemoteState(conflictData, { isInitialSignIn: false });
      }

      if (retryCount < 1) {
        pushInFlight = false;
        return await pushToCloud(retryCount + 1);
      }
      setSyncStatus("local");
      return { ok: false, status: 409 };
    }

    if (!resp.ok) {
      setSyncStatus("local");
      return { ok: false, status: resp.status };
    }

    const resData = await resp.json().catch(() => ({}));
    applyServerStateMeta(resData, resp.headers.get("ETag") || "");
    setDirty(false);
    recordLastSyncNow();
    setSyncStatus("synced");
    return { ok: true, status: 200 };
  } catch {
    setSyncStatus("local");
    return { ok: false, status: 0 };
  } finally {
    pushInFlight = false;
  }
}

function schedulePush() {
  if (!isSignedIn()) return;
  setSyncStatus("local");
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    pushToCloud(0);
  }, DEBOUNCE_PUSH_MS);
}

function flushKeepalive() {
  if (!isSignedIn() || !isDirty()) return;
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  try {
    const body = JSON.stringify(buildStatePayload());
    const bytes =
      typeof TextEncoder !== "undefined" ? new TextEncoder().encode(body).length : body.length;
    if (bytes > KEEPALIVE_MAX_BYTES) return;
    // Keep dirty=1 until the unload request actually completes; if interrupted, next visit flushes.
    fetch(`${API_BASE}/user/state`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.token}`,
      },
      body,
      keepalive: true,
    })
      .then(async (resp) => {
        if (resp?.ok) {
          captureRefreshedToken(resp);
          const data = await resp.json().catch(() => null);
          if (data) applyServerStateMeta(data, resp.headers.get("ETag") || "");
          setDirty(false);
          recordLastSyncNow();
          setSyncStatus("synced");
        }
      })
      .catch(() => {
        // Remains dirty for next page visit
      });
  } catch {
    // Remains dirty for next page visit
  }
}

export async function forceSyncNow() {
  if (!isSignedIn()) return { ok: false, reason: "signed_out" };
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  if (isDirty()) {
    return pushToCloud(0);
  }
  return pullFromCloud({ force: true });
}

/* ---------- Lazy Google GIS Loader & Sign-In Flow ---------- */

function loadGisScript() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Browser environment required"));
  }
  if (window.google?.accounts?.id) {
    return Promise.resolve(window.google.accounts.id);
  }
  if (gisLoadPromise) return gisLoadPromise;

  gisLoadPromise = new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err, val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) {
        gisLoadPromise = null;
        reject(err);
      } else {
        resolve(val);
      }
    };

    const timer = setTimeout(() => {
      finish(new Error("Google Sign-In timed out. Please try again."));
    }, GIS_LOAD_TIMEOUT_MS);

    let script = document.querySelector(`script[src="${GIS_SCRIPT_URL}"]`);
    if (!script) {
      script = document.createElement("script");
      script.src = GIS_SCRIPT_URL;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }

    script.addEventListener(
      "load",
      () => {
        if (window.google?.accounts?.id) {
          finish(null, window.google.accounts.id);
        } else {
          finish(new Error("Google Sign-In unavailable."));
        }
      },
      { once: true }
    );

    script.addEventListener(
      "error",
      () => {
        finish(new Error("Could not load Google Sign-In. Check connection or content blockers."));
      },
      { once: true }
    );
  });

  return gisLoadPromise;
}

async function handleGoogleCredential(response) {
  const credential = response?.credential;
  if (!credential) return;

  const statusEl = widgetMountEl?.querySelector(".auth-popover-status");
  if (statusEl) {
    statusEl.textContent = "Signing in…";
    statusEl.classList.remove("is-error");
  }

  try {
    const resp = await fetch(`${API_BASE}/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential }),
      cache: "no-store",
    });

    if (!resp.ok) {
      const errBody = await resp.json().catch(() => ({}));
      throw new Error(errBody?.error || `Sign-in failed (HTTP ${resp.status})`);
    }

    const data = await resp.json();
    if (!data?.token || !data?.user) {
      throw new Error("Invalid authentication response.");
    }

    saveSessionToStorage({
      token: data.token,
      user: {
        uid: String(data.user.uid || data.user.sub || ""),
        name: String(data.user.name || ""),
        picture: String(data.user.picture || ""),
      },
      rev: Number.isFinite(Number(data.rev)) ? Number(data.rev) : 0,
      hash: String(data.content_hash || data.hash || ""),
      rev_sig: String(data.rev_sig || ""),
      etag: "",
    });

    popoverOpen = false;
    menuOpen = false;
    renderWidget();
    emitSyncStatus();
    onAuthChangeCb?.(getUser());

    if (data.state && typeof data.state === "object") {
      applyServerStateMeta(data.state);
      const { needsPush } = reconcileRemoteState(data.state, { isInitialSignIn: true });
      if (needsPush) {
        setDirty(true);
        pushToCloud(0);
      } else {
        setDirty(false);
        recordLastSyncNow();
        setSyncStatus("synced");
      }
    } else {
      await pullFromCloud({ isInitialSignIn: true, force: true });
    }
  } catch (err) {
    if (statusEl) {
      statusEl.textContent = err?.message || "Sign-in failed. Please try again.";
      statusEl.classList.add("is-error");
    }
  }
}

async function openSignInPopover() {
  if (!widgetMountEl) return;
  popoverOpen = true;
  const pop = widgetMountEl.querySelector(".auth-popover");
  const trigger = widgetMountEl.querySelector(".auth-signin-btn");
  if (!pop) return;

  pop.classList.remove("hidden");
  trigger?.setAttribute("aria-expanded", "true");

  const slot = pop.querySelector(".auth-gis-slot");
  const statusEl = pop.querySelector(".auth-popover-status");
  if (!slot) return;

  slot.innerHTML = "";
  if (statusEl) {
    statusEl.textContent = "Loading Google Sign-In…";
    statusEl.classList.remove("is-error");
  }

  try {
    const gisId = await loadGisScript();
    if (!popoverOpen) return;

    if (!gisInitialized) {
      gisId.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleGoogleCredential,
        auto_select: false,
        ux_mode: "popup",
      });
      gisInitialized = true;
    }

    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    slot.innerHTML = "";
    gisId.renderButton(slot, {
      type: "standard",
      theme: isDark ? "filled_black" : "outline",
      size: "large",
      text: "signin_with",
      shape: "rectangular",
      width: 240,
    });
    if (statusEl) {
      statusEl.textContent = "Syncs bookmarks & preferences across your devices.";
      statusEl.classList.remove("is-error");
    }
  } catch (err) {
    if (statusEl) {
      statusEl.textContent =
        err?.message || "Could not load Google Sign-In. Please check your connection.";
      statusEl.classList.add("is-error");
    }
    slot.innerHTML = `<button type="button" class="masthead-btn auth-retry-btn">Retry</button>`;
  }
}

function closePopovers() {
  popoverOpen = false;
  menuOpen = false;
  if (!widgetMountEl) return;
  widgetMountEl.querySelector(".auth-popover")?.classList.add("hidden");
  widgetMountEl.querySelector(".auth-menu")?.classList.add("hidden");
  widgetMountEl.querySelector(".auth-signin-btn")?.setAttribute("aria-expanded", "false");
  widgetMountEl.querySelector(".auth-avatar-btn")?.setAttribute("aria-expanded", "false");
}

/* ---------- Widget Rendering ---------- */

function renderWidget() {
  if (!widgetMountEl) return;

  if (!isSignedIn()) {
    widgetMountEl.innerHTML = `
      <div class="auth-widget">
        <button type="button" class="masthead-btn auth-signin-btn" aria-haspopup="dialog" aria-expanded="${popoverOpen ? "true" : "false"}">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          <span>Sign in</span>
        </button>
        <div class="auth-popover${popoverOpen ? "" : " hidden"}" role="dialog" aria-label="Sign in with Google">
          <p class="auth-popover-title">Sign in to sync</p>
          <div class="auth-gis-slot"></div>
          <p class="auth-popover-status">Syncs bookmarks &amp; preferences across your devices.</p>
        </div>
      </div>
    `;
    return;
  }

  const user = session.user;
  const avatarUrl = safeGoogleAvatarUrl(user.picture);
  const initials = escapeHtml(getUserInitials(user));
  const avatarInner = avatarUrl
    ? `<img class="auth-avatar-img" src="${avatarUrl}" alt="" width="32" height="32" referrerpolicy="no-referrer" decoding="async">`
    : `<span class="auth-avatar-initials">${initials}</span>`;
  const { text: statusText, cls: statusCls } = syncStatusMeta();
  const count = getBookmarks().length;

  widgetMountEl.innerHTML = `
    <div class="auth-widget">
      <button type="button" class="auth-avatar-btn" aria-haspopup="menu" aria-expanded="${menuOpen ? "true" : "false"}" aria-label="Account menu for ${escapeHtml(user.name || "user")}" title="${escapeHtml(user.name || user.email || "Account")}">
        ${avatarInner}
      </button>
      <div class="auth-menu${menuOpen ? "" : " hidden"}" role="menu">
        <div class="auth-menu-head">
          <div class="auth-menu-name">${escapeHtml(user.name || user.email || "Signed in")}</div>
          <div class="auth-sync-status ${statusCls}"><span class="auth-sync-dot" aria-hidden="true"></span><span>${escapeHtml(statusText)}</span></div>
        </div>
        <a class="auth-menu-item" role="menuitem" href="${safeInternalHref(widgetBookmarksHref)}">
          <span>Bookmarks</span>
          <span class="auth-menu-count">${count}</span>
        </a>
        <button type="button" class="auth-menu-item auth-signout-btn" role="menuitem">
          <span>Sign out</span>
        </button>
      </div>
    </div>
  `;

  // Graceful fallback to initials if avatar image fails to load
  const img = widgetMountEl.querySelector(".auth-avatar-img");
  if (img) {
    img.addEventListener("error", () => {
      img.replaceWith(
        Object.assign(document.createElement("span"), {
          className: "auth-avatar-initials",
          textContent: getUserInitials(user),
        })
      );
    });
  }
}

function bindWidgetListeners() {
  if (!widgetMountEl || widgetMountEl.dataset.authBound === "1") return;
  widgetMountEl.dataset.authBound = "1";

  widgetMountEl.addEventListener("click", (e) => {
    const signinBtn = e.target.closest?.(".auth-signin-btn");
    if (signinBtn) {
      e.stopPropagation();
      if (popoverOpen) {
        closePopovers();
      } else {
        openSignInPopover();
      }
      return;
    }

    const retryBtn = e.target.closest?.(".auth-retry-btn");
    if (retryBtn) {
      e.stopPropagation();
      openSignInPopover();
      return;
    }

    const avatarBtn = e.target.closest?.(".auth-avatar-btn");
    if (avatarBtn) {
      e.stopPropagation();
      menuOpen = !menuOpen;
      const menu = widgetMountEl.querySelector(".auth-menu");
      menu?.classList.toggle("hidden", !menuOpen);
      avatarBtn.setAttribute("aria-expanded", menuOpen ? "true" : "false");
      if (menuOpen) updateBookmarkCountUi();
      return;
    }

    const signoutBtn = e.target.closest?.(".auth-signout-btn");
    if (signoutBtn) {
      e.stopPropagation();
      signOut();
    }
  });
}

function bindGlobalListeners() {
  if (globalEventsBound || typeof window === "undefined") return;
  globalEventsBound = true;

  document.addEventListener("click", (e) => {
    if (!popoverOpen && !menuOpen) return;
    if (widgetMountEl && widgetMountEl.contains(e.target)) return;
    closePopovers();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && (popoverOpen || menuOpen)) {
      closePopovers();
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      flushKeepalive();
    }
  });

  window.addEventListener("pagehide", () => {
    flushKeepalive();
  });

  window.addEventListener("storage", (e) => {
    if (e.key === SESSION_KEY) {
      const prevUid = session?.user?.uid || "";
      const prevSignedIn = isSignedIn();
      session = loadSessionFromStorage();
      const nowSignedIn = isSignedIn();
      const nextUid = session?.user?.uid || "";
      if (prevSignedIn !== nowSignedIn || prevUid !== nextUid) {
        popoverOpen = false;
        menuOpen = false;
        renderWidget();
        emitSyncStatus();
        onAuthChangeCb?.(getUser());
      }
    } else if (e.key === PREFS_KEY || e.key === THEME_KEY || e.key === POSITIVE_POS_KEY) {
      try {
        onPreferencesAppliedCb?.(getLocalPreferences());
      } catch {
        // Isolate callback errors
      }
    }
  });
}

/* ---------- Public Init ---------- */

export function initAuth({
  mountEl,
  onPreferencesApplied = null,
  onAuthChange = null,
  bookmarksHref = "/bookmarks/",
} = {}) {
  widgetMountEl = mountEl || null;
  widgetBookmarksHref = bookmarksHref || "/bookmarks/";
  onPreferencesAppliedCb = typeof onPreferencesApplied === "function" ? onPreferencesApplied : null;
  onAuthChangeCb = typeof onAuthChange === "function" ? onAuthChange : null;

  session = loadSessionFromStorage();

  registerSyncAdapter({
    onLocalChange: () => {
      if (!isSignedIn()) return;
      setDirty(true);
      schedulePush();
    },
  });

  if (bookmarksUnsub) bookmarksUnsub();
  bookmarksUnsub = onBookmarksChange(() => {
    updateBookmarkCountUi();
  });

  bindWidgetListeners();
  bindGlobalListeners();
  renderWidget();

  if (isSignedIn()) {
    // Render immediately from local cache, then run a single background sync
    if (isDirty()) {
      if (!session.rev_sig) {
        pullFromCloud({ isInitialSignIn: false, force: true });
      } else {
        pushToCloud(0);
      }
    } else {
      pullFromCloud({ isInitialSignIn: false, force: false });
    }
  }

  return {
    getUser,
    isSignedIn,
    signOut,
    forceSyncNow,
  };
}

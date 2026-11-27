/**
 * Shared Bookmarks Store, TTL Engine, Sync LWW Merge & Button Helpers
 * Standalone pure JS module — ZERO external imports so index.html can import it lightly.
 */

export const BOOKMARKS_STORAGE_KEY = "briefing-bookmarks-v1";
export const MAX_BOOKMARKS = 100;
export const ARCHIVE_TTL_DAYS = Object.freeze({ daily: 60, weekly: 364 });
export const EXPIRING_SOON_DAYS = 7;
export const TOMBSTONE_MAX_AGE_SEC = 35 * 86400;
export const MAX_TOMBSTONES = 100;

const SHORT_DATE_FMT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function escapeAttr(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeSelectorVal(val) {
  const s = String(val ?? "");
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(s);
  }
  return s.replace(/["\\]/g, "\\$&");
}

function sanitizeBookmarkUrl(raw) {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 320) return "";
  try {
    const parsed = new URL(trimmed);
    if (parsed.username || parsed.password) return "";
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return parsed.href.length <= 320 ? parsed.href : "";
  } catch {
    return "";
  }
}

function safeReadStorage(key) {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function safeWriteStorage(key, value) {
  try {
    if (typeof localStorage === "undefined") return false;
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function makeBookmarkKey({ edition, date, section, id, region = null } = {}) {
  const ed = String(edition ?? "").trim();
  const dt = String(date ?? "").trim();
  const sec = String(section ?? "").trim();
  const itemId = String(id ?? "").trim();
  const reg = region ? String(region).trim() : "";
  if (sec === "local_news" && reg) {
    return `${ed}:${dt}:${sec}:${reg}:${itemId}`;
  }
  return `${ed}:${dt}:${sec}:${itemId}`;
}

function resolveKey(refOrKey) {
  if (typeof refOrKey === "string") return refOrKey.trim();
  if (refOrKey && typeof refOrKey === "object") return makeBookmarkKey(refOrKey);
  return "";
}

export function buildBookmarkRecord({
  edition,
  date,
  section,
  id,
  region = null,
  lang = null,
  kind = null,
  title = "",
  badge = "",
  source = "",
  url = "",
  saved_at = null,
} = {}) {
  const ed = edition === "weekly" ? "weekly" : "daily";
  const dt = String(date ?? "").trim().slice(0, 10);
  const sec = String(section ?? "").trim().slice(0, 32);
  const itemId = String(id ?? "").trim().slice(0, 80);
  const tsNum = Number(saved_at);
  const savedAt =
    Number.isFinite(tsNum) && tsNum > 0 ? Math.floor(tsNum) : Math.floor(Date.now() / 1000);
  const cleanTitle = String(title ?? "").trim().slice(0, 140) || itemId.slice(0, 140) || "Saved story";

  const record = {
    edition: ed,
    date: dt,
    section: sec,
    id: itemId,
    saved_at: savedAt,
    title: cleanTitle,
    badge: String(badge ?? "").trim().slice(0, 32),
    source: String(source ?? "").trim().slice(0, 40),
    url: sanitizeBookmarkUrl(url),
  };

  const reg = region ? String(region).trim().slice(0, 32) : "";
  const lg = lang ? String(lang).trim().slice(0, 16) : "";
  const kd = kind ? String(kind).trim().slice(0, 24) : "";
  if (reg) record.region = reg;
  if (lg) record.lang = lg;
  if (kd) record.kind = kd;

  return record;
}

function isValidRecord(rec) {
  return Boolean(
    rec &&
      (rec.edition === "daily" || rec.edition === "weekly") &&
      /^\d{4}-\d{2}-\d{2}$/.test(rec.date) &&
      rec.section &&
      rec.id
  );
}

export function computeBookmarkTtl(
  record,
  { nowMs = Date.now(), ttlOverrides = null, availableDatesSet = null } = {}
) {
  const edition = record?.edition === "weekly" ? "weekly" : "daily";
  const ttlDays = Number(ttlOverrides?.[edition] ?? ARCHIVE_TTL_DAYS[edition] ?? 60);
  const editionMs = Date.parse(`${record?.date || ""}T00:00:00Z`);

  if (Number.isNaN(editionMs)) {
    return {
      status: "expired",
      label: "Archive expired · Showing saved link",
      daysRemaining: -1,
      expiresDate: "",
      expiresReadable: "",
      expiresMs: 0,
      ttlDays,
    };
  }

  const todayUtcDay = Math.floor(nowMs / 86400000);
  const editionUtcDay = Math.floor(editionMs / 86400000);
  const expiresMs = (editionUtcDay + ttlDays) * 86400000;
  const expiresDate = new Date(expiresMs).toISOString().slice(0, 10);
  const daysRemaining = editionUtcDay + ttlDays - todayUtcDay;
  const expiresReadable = SHORT_DATE_FMT.format(new Date(expiresMs));

  let status;
  let label;

  if (availableDatesSet && !availableDatesSet.has(record.date)) {
    status = "expired";
    label = `Archive expired (${expiresReadable}) · Showing saved link`;
  } else if (daysRemaining > EXPIRING_SOON_DAYS) {
    status = "active";
    label = `Available for ${daysRemaining} days (until ${expiresReadable})`;
  } else if (daysRemaining >= 2) {
    status = "expiring_soon";
    label = `Expires in ${daysRemaining} days (until ${expiresReadable})`;
  } else if (daysRemaining === 1) {
    status = "expiring_soon";
    label = `Expires tomorrow (${expiresReadable})`;
  } else if (daysRemaining === 0) {
    status = "expiring_soon";
    label = `Expires today (${expiresReadable})`;
  } else {
    status = "expiring_soon";
    label = `Past ${ttlDays}-day window · May rotate out soon`;
  }

  return {
    status,
    label,
    daysRemaining,
    expiresDate,
    expiresReadable,
    expiresMs,
    ttlDays,
  };
}

/* ---------- Internal In-Memory Cache & Persistence ---------- */

let cacheMap = null; // Map<string, BookmarkRecord>
let deletedMap = null; // Map<string, number>
const changeListeners = new Set();
let syncAdapter = null;
let pendingStorageSync = false;

function pruneDeletedMap(map, nowSec = Math.floor(Date.now() / 1000)) {
  const cutoff = nowSec - TOMBSTONE_MAX_AGE_SEC;
  const entries = [];
  for (const [k, ts] of map.entries()) {
    const n = Math.floor(Number(ts));
    if (k && Number.isFinite(n) && n >= cutoff) {
      entries.push([k, n]);
    }
  }
  entries.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const capped = entries.slice(0, MAX_TOMBSTONES);
  return new Map(capped);
}

function capItemsMap(map) {
  if (map.size <= MAX_BOOKMARKS) return map;
  const entries = [...map.entries()].sort((a, b) => {
    const diff = (b[1].saved_at || 0) - (a[1].saved_at || 0);
    if (diff !== 0) return diff;
    return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
  });
  return new Map(entries.slice(0, MAX_BOOKMARKS));
}

function normalizeItemsInput(rawItems) {
  const list = Array.isArray(rawItems)
    ? rawItems
    : rawItems && typeof rawItems === "object"
    ? Object.values(rawItems)
    : [];
  const out = new Map();
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const rec = buildBookmarkRecord(raw);
    if (!isValidRecord(rec)) continue;
    const key = makeBookmarkKey(rec);
    const prev = out.get(key);
    if (!prev || rec.saved_at >= prev.saved_at) {
      out.set(key, rec);
    }
  }
  return out;
}

function loadFromStorage() {
  const raw = safeReadStorage(BOOKMARKS_STORAGE_KEY);
  const nextItems = normalizeItemsInput(raw?.items ?? raw?.bookmarks ?? []);
  const nextDeleted = new Map();
  if (raw?.deleted && typeof raw.deleted === "object") {
    for (const [k, ts] of Object.entries(raw.deleted)) {
      const n = Math.floor(Number(ts));
      if (k && Number.isFinite(n) && n > 0) {
        nextDeleted.set(k, n);
      }
    }
  }
  cacheMap = capItemsMap(nextItems);
  deletedMap = pruneDeletedMap(nextDeleted);
}

function ensureCache() {
  if (!cacheMap || !deletedMap) {
    loadFromStorage();
  }
}

function sortedItemsArray(map) {
  return [...map.values()]
    .sort((a, b) => {
      const diff = (b.saved_at || 0) - (a.saved_at || 0);
      if (diff !== 0) return diff;
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      const ka = makeBookmarkKey(a);
      const kb = makeBookmarkKey(b);
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    })
    .map((rec) => ({ ...rec }));
}

function persistCache(nowSec = Math.floor(Date.now() / 1000)) {
  ensureCache();
  deletedMap = pruneDeletedMap(deletedMap, nowSec);
  cacheMap = capItemsMap(cacheMap);
  const envelope = {
    version: 1,
    items: sortedItemsArray(cacheMap),
    deleted: Object.fromEntries(deletedMap.entries()),
  };
  safeWriteStorage(BOOKMARKS_STORAGE_KEY, envelope);
  return envelope;
}

function emitChange(payload) {
  for (const fn of changeListeners) {
    try {
      fn(payload);
    } catch {
      // Isolate listener errors
    }
  }
}

function notifyLocalMutation(meta = {}) {
  emitChange({ source: "local", count: cacheMap.size, ...meta });
  try {
    syncAdapter?.onLocalChange?.(meta);
  } catch {
    // Isolate adapter errors
  }
}

/* ---------- Public Store API ---------- */

export function getBookmarks() {
  ensureCache();
  return sortedItemsArray(cacheMap);
}

export function getBookmarkEnvelope() {
  ensureCache();
  return {
    version: 1,
    items: sortedItemsArray(cacheMap),
    deleted: Object.fromEntries(deletedMap.entries()),
  };
}

export function isBookmarked(refOrKey) {
  ensureCache();
  const key = resolveKey(refOrKey);
  return key ? cacheMap.has(key) : false;
}

export function addBookmark(input) {
  ensureCache();
  const record = buildBookmarkRecord(input);
  const key = makeBookmarkKey(record);
  if (!isValidRecord(record)) {
    return { ok: false, saved: false, reason: "invalid", key, count: cacheMap.size };
  }

  const alreadySaved = cacheMap.has(key);
  if (!alreadySaved && cacheMap.size >= MAX_BOOKMARKS) {
    return {
      ok: false,
      saved: false,
      reason: "limit_reached",
      limit: MAX_BOOKMARKS,
      key,
      count: cacheMap.size,
    };
  }

  const prevDel = deletedMap.get(key) || 0;
  if (prevDel >= record.saved_at) {
    record.saved_at = prevDel + 1;
  }

  cacheMap.set(key, record);
  deletedMap.delete(key);
  persistCache();
  notifyLocalMutation({ key, saved: true, record });
  return { ok: true, saved: true, key, record: { ...record }, count: cacheMap.size };
}

export function removeBookmark(refOrKey) {
  ensureCache();
  const key = resolveKey(refOrKey);
  if (!key || !cacheMap.has(key)) {
    return { ok: false, saved: false, reason: "not_found", key, count: cacheMap.size };
  }

  const existing = cacheMap.get(key);
  const nowSec = Math.floor(Date.now() / 1000);
  const delTs = Math.max(nowSec, (existing?.saved_at || 0) + 1);

  cacheMap.delete(key);
  deletedMap.set(key, delTs);
  persistCache();
  notifyLocalMutation({ key, saved: false });
  return { ok: true, saved: false, key, count: cacheMap.size };
}

export function toggleBookmark(input) {
  ensureCache();
  const key = resolveKey(input);
  if (!key) {
    return { ok: false, saved: false, reason: "invalid", key: "", count: cacheMap.size };
  }
  if (cacheMap.has(key)) {
    return removeBookmark(key);
  }
  return addBookmark(input);
}

export function clearExpiredBookmarks(
  availableDatesByEdition = null,
  { ttlOverrides = null, nowMs = Date.now() } = {}
) {
  ensureCache();
  const dateSets = {};
  for (const ed of ["daily", "weekly"]) {
    const raw = availableDatesByEdition?.[ed];
    if (raw instanceof Set) dateSets[ed] = raw;
    else if (Array.isArray(raw)) dateSets[ed] = new Set(raw);
  }

  const nowSec = Math.floor(nowMs / 1000);
  const removedKeys = [];
  for (const [key, rec] of cacheMap.entries()) {
    const availSet = dateSets[rec.edition] || null;
    const ttl = computeBookmarkTtl(rec, { nowMs, ttlOverrides, availableDatesSet: availSet });
    const isExpired = availSet ? ttl.status === "expired" : ttl.daysRemaining < 0;
    if (isExpired) {
      removedKeys.push(key);
      const delTs = Math.max(nowSec, (rec.saved_at || 0) + 1);
      cacheMap.delete(key);
      deletedMap.set(key, delTs);
    }
  }

  if (removedKeys.length > 0) {
    persistCache();
    notifyLocalMutation({ removedKeys, saved: false });
  }

  return { removedCount: removedKeys.length, removedKeys, count: cacheMap.size };
}

export function getBookmarkStats(
  ttlOverrides = null,
  availableDatesByEdition = null,
  nowMs = Date.now()
) {
  ensureCache();
  const dateSets = {};
  for (const ed of ["daily", "weekly"]) {
    const raw = availableDatesByEdition?.[ed];
    if (raw instanceof Set) dateSets[ed] = raw;
    else if (Array.isArray(raw)) dateSets[ed] = new Set(raw);
  }

  const stats = {
    total: cacheMap.size,
    daily: 0,
    weekly: 0,
    aroundTheWorld: 0,
    active: 0,
    expiringSoon: 0,
    expired: 0,
  };

  for (const rec of cacheMap.values()) {
    if (rec.edition === "daily") stats.daily += 1;
    else if (rec.edition === "weekly") stats.weekly += 1;
    if (rec.section === "around_the_world") stats.aroundTheWorld += 1;

    const availSet = dateSets[rec.edition] || null;
    const ttl = computeBookmarkTtl(rec, { nowMs, ttlOverrides, availableDatesSet: availSet });
    if (ttl.status === "expired") stats.expired += 1;
    else if (ttl.status === "expiring_soon") stats.expiringSoon += 1;
    else stats.active += 1;
  }

  return stats;
}

/* ---------- Sync & LWW Merge API ---------- */

export function registerSyncAdapter(adapter) {
  syncAdapter = adapter && typeof adapter.onLocalChange === "function" ? adapter : null;
}

export function onBookmarksChange(listener) {
  if (typeof listener !== "function") return () => {};
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
}

export function exportForSync() {
  ensureCache();
  deletedMap = pruneDeletedMap(deletedMap);
  return {
    items: sortedItemsArray(cacheMap),
    deleted: Object.fromEntries(deletedMap.entries()),
  };
}

function mapsEqualBookmarks(aMap, bMap) {
  if (aMap.size !== bMap.size) return false;
  for (const [k, a] of aMap.entries()) {
    const b = bMap.get(k);
    if (!b) return false;
    if (
      a.saved_at !== b.saved_at ||
      a.title !== b.title ||
      a.badge !== b.badge ||
      a.source !== b.source ||
      a.url !== b.url ||
      (a.region || "") !== (b.region || "") ||
      (a.lang || "") !== (b.lang || "") ||
      (a.kind || "") !== (b.kind || "")
    ) {
      return false;
    }
  }
  return true;
}

function mapsEqualDeleted(aMap, bMap) {
  if (aMap.size !== bMap.size) return false;
  for (const [k, ts] of aMap.entries()) {
    if (bMap.get(k) !== ts) return false;
  }
  return true;
}

export function mergeFromRemote(
  remoteItems = [],
  remoteDeleted = {},
  { nowSec = Math.floor(Date.now() / 1000) } = {}
) {
  ensureCache();

  const remoteItemMap = capItemsMap(normalizeItemsInput(remoteItems));
  const remoteDelRaw = new Map();
  if (remoteDeleted && typeof remoteDeleted === "object") {
    for (const [k, ts] of Object.entries(remoteDeleted)) {
      const n = Math.floor(Number(ts));
      if (k && Number.isFinite(n) && n > 0) {
        remoteDelRaw.set(k, n);
      }
    }
  }
  const remoteDelMap = pruneDeletedMap(remoteDelRaw, nowSec);
  const localDelPruned = pruneDeletedMap(deletedMap, nowSec);

  const allKeys = new Set([
    ...cacheMap.keys(),
    ...remoteItemMap.keys(),
    ...localDelPruned.keys(),
    ...remoteDelMap.keys(),
  ]);

  const mergedItems = new Map();
  const mergedDeleted = new Map();

  for (const key of allKeys) {
    const localItem = cacheMap.get(key) || null;
    const remoteItem = remoteItemMap.get(key) || null;
    let bestItem = null;
    if (localItem && remoteItem) {
      bestItem = remoteItem.saved_at >= localItem.saved_at ? remoteItem : localItem;
    } else {
      bestItem = remoteItem || localItem;
    }

    const lDel = localDelPruned.get(key) || 0;
    const rDel = remoteDelMap.get(key) || 0;
    const bestDel = Math.max(lDel, rDel);

    if (bestItem && bestItem.saved_at > bestDel) {
      mergedItems.set(key, bestItem);
    } else if (bestDel > 0) {
      mergedDeleted.set(key, bestDel);
    }
  }

  const finalItems = capItemsMap(mergedItems);
  const finalDeleted = pruneDeletedMap(mergedDeleted, nowSec);

  const localChanged =
    !mapsEqualBookmarks(cacheMap, finalItems) || !mapsEqualDeleted(deletedMap, finalDeleted);
  const differsFromRemote =
    !mapsEqualBookmarks(remoteItemMap, finalItems) || !mapsEqualDeleted(remoteDelMap, finalDeleted);

  cacheMap = finalItems;
  deletedMap = finalDeleted;

  if (localChanged) {
    persistCache(nowSec);
    emitChange({ source: "remote", count: cacheMap.size });
  }

  return {
    changed: localChanged,
    differsFromRemote,
    count: cacheMap.size,
    items: sortedItemsArray(cacheMap),
    deleted: Object.fromEntries(deletedMap.entries()),
  };
}

/* ---------- DOM Button Helpers ---------- */

const BOOKMARK_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4.5L5 21V4a1 1 0 0 1 1-1z"/></svg>`;

export function renderBookmarkButton(key, { saved = false, label = "story", extraClass = "" } = {}) {
  const safeKey = escapeAttr(key);
  const cleanLabel = String(label || "story").trim() || "story";
  const safeLabel = escapeAttr(cleanLabel);
  const ariaLabel = saved
    ? `Remove ${safeLabel} from bookmarks`
    : `Bookmark ${safeLabel}`;
  const title = saved ? "Saved in Bookmarks (click to remove)" : "Save to Bookmarks";
  const cls = `bookmark-btn${saved ? " is-saved" : ""}${extraClass ? ` ${escapeAttr(extraClass)}` : ""}`;
  return `<button type="button" class="${cls}" data-bookmark-key="${safeKey}" data-bookmark-label="${safeLabel}" aria-pressed="${saved ? "true" : "false"}" aria-label="${ariaLabel}" title="${title}">${BOOKMARK_SVG}</button>`;
}

function applyButtonNodeState(btn, saved) {
  const label = btn.dataset.bookmarkLabel || "story";
  btn.classList.toggle("is-saved", saved);
  btn.setAttribute("aria-pressed", saved ? "true" : "false");
  btn.setAttribute(
    "aria-label",
    saved ? `Remove ${label} from bookmarks` : `Bookmark ${label}`
  );
  btn.setAttribute(
    "title",
    saved ? "Saved in Bookmarks (click to remove)" : "Save to Bookmarks"
  );
}

export function updateBookmarkButtonNodes(key, saved, root = typeof document !== "undefined" ? document : null) {
  if (!root || !key) return;
  const sel = `[data-bookmark-key="${escapeSelectorVal(key)}"]`;
  root.querySelectorAll(sel).forEach((btn) => applyButtonNodeState(btn, Boolean(saved)));
}

export function syncBookmarkButtons(root = typeof document !== "undefined" ? document : null) {
  if (!root) return;
  ensureCache();
  root.querySelectorAll("[data-bookmark-key]").forEach((btn) => {
    const key = btn.dataset.bookmarkKey;
    if (key) applyButtonNodeState(btn, cacheMap.has(key));
  });
}

export function bindBookmarkToggle(
  root,
  resolveRecordByKey,
  { onToggle = null, onLimitReached = null } = {}
) {
  if (!root || typeof root.addEventListener !== "function") return () => {};

  const handler = (e) => {
    const btn = e.target?.closest?.(".bookmark-btn[data-bookmark-key]");
    if (!btn || !root.contains(btn)) return;
    e.preventDefault();
    e.stopPropagation();

    const key = btn.dataset.bookmarkKey;
    if (!key) return;

    let res;
    if (isBookmarked(key)) {
      res = removeBookmark(key);
    } else {
      const rec = typeof resolveRecordByKey === "function" ? resolveRecordByKey(key, btn) : null;
      if (!rec) return;
      res = addBookmark(rec);
    }

    if (res.reason === "limit_reached") {
      onLimitReached?.(res, btn);
      return;
    }

    if (res.ok) {
      updateBookmarkButtonNodes(key, res.saved, typeof document !== "undefined" ? document : root);
      onToggle?.(res, btn);
    }
  };

  root.addEventListener("click", handler);
  return () => root.removeEventListener("click", handler);
}

/* ---------- Cross-Tab Storage Reconciliation ---------- */

function reconcileFromStorage() {
  loadFromStorage();
  if (typeof document !== "undefined") {
    syncBookmarkButtons(document);
  }
  emitChange({ source: "storage", count: cacheMap.size });
}

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("storage", (e) => {
    if (e.key !== BOOKMARKS_STORAGE_KEY) return;
    if (typeof document !== "undefined" && document.hidden) {
      pendingStorageSync = true;
      return;
    }
    reconcileFromStorage();
  });
}

if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && pendingStorageSync) {
      pendingStorageSync = false;
      reconcileFromStorage();
    }
  });
}

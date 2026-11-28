/**
 * Unified v1 user state (preferences + bookmarks + tombstones) storage,
 * validation, KV eventual-consistency shadow cache, and quota guardrails.
 */

import { sha256Hex, signRev, verifyRevSig } from "./auth.js";

export const MAX_BODY_BYTES = 49152; // 48 KiB
export const MAX_BOOKMARKS = 100;
export const MAX_DELETED = 100;

const USER_READ_WINDOW_SEC = 300; // 5 min
const USER_READ_MAX = 60;
const USER_WRITE_SHORT_WINDOW_SEC = 600; // 10 min
const USER_WRITE_SHORT_MAX = 10;
const USER_WRITE_DAILY_WINDOW_SEC = 86400; // 24 h
const USER_WRITE_DAILY_MAX = 30;

const POP_GLOBAL_WRITE_CAP = 120; // per POP per UTC day
const KV_GLOBAL_WRITE_CAP = 400; // global across all POPs per UTC day (reserves 500+/day for MARKETS_KV)
const KV_GLOBAL_FLUSH_BATCH = 10;
const KV_GLOBAL_CACHE_TTL_SEC = 60;
const SHADOW_CACHE_TTL_SEC = 90;

const PREF_KEYS = new Set([
  "theme",
  "positive_pos",
  "local_region",
  "local_lang",
  "market_tf",
  "world_kind_filter",
  "brief_style",
  "daily_sections",
  "weekly_sections",
  "updated_at",
]);
const THEME_VALS = new Set(["system", "light", "dark"]);
const POSITIVE_POS_VALS = new Set(["bottom", "top"]);
const LANG_VALS = new Set(["native", "en"]);
const MARKET_TF_VALS = new Set(["1d", "5d", "30d"]);
const WORLD_KIND_VALS = new Set(["all", "geology", "cuisine"]);
const BRIEF_STYLE_VALS = new Set(["regular", "bullets"]);
const DAILY_SECTION_IDS = new Set(["executive", "news", "markets", "conflicts", "politics", "local-news", "positive"]);
const WEEKLY_SECTION_IDS = new Set(["overview", "science", "culture", "history", "around-world", "longreads", "pulse"]);
const SECTION_LAYOUT_KEYS = new Set(["order", "hidden", "collapsed"]);

const BOOKMARK_KEYS = new Set([
  "edition",
  "date",
  "section",
  "id",
  "region",
  "lang",
  "kind",
  "saved_at",
  "title",
  "badge",
  "source",
  "url",
]);
const TOP_LEVEL_KEYS = new Set([
  "schema_version",
  "base_rev",
  "base_hash",
  "rev_sig",
  "preferences",
  "bookmarks",
  "deleted",
]);

const DAILY_SECTIONS = new Set(["top_news", "local_news", "positive_news"]);
const WEEKLY_SECTIONS = new Set([
  "science",
  "culture",
  "history",
  "around_the_world",
  "long_reads",
  "this_week_in_history",
]);

const REGION_RE = /^[a-z0-9-]{1,32}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CARD_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
const KIND_RE = /^[a-z0-9_-]{1,24}$/;
const DELETED_KEY_RE = /^(daily|weekly):\d{4}-\d{2}-\d{2}:[a-z_]+(?::[a-z0-9-]+)?:[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
const HEX64_RE = /^[a-f0-9]{64}$/;
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const textDecoder = new TextDecoder("utf-8", { fatal: true });

// Isolate-local guardrails
let popWriteDay = "";
let popWriteCount = 0;
let popQuotaKillUntilMs = 0;
let globalCounterMem = {
  day: "",
  kvBaseCount: 0,
  pendingWrites: 0,
  fetchedAtMs: 0,
};

export function resetUserStateCachesForTest() {
  popWriteDay = "";
  popWriteCount = 0;
  popQuotaKillUntilMs = 0;
  globalCounterMem = {
    day: "",
    kvBaseCount: 0,
    pendingWrites: 0,
    fetchedAtMs: 0,
  };
}

function getDefaultCache() {
  if (typeof caches !== "undefined" && caches && caches.default) {
    return caches.default;
  }
  return null;
}

export function getUtcDayString(nowMs = Date.now()) {
  return new Date(nowMs).toISOString().slice(0, 10);
}

function nextUtcMidnightMs(nowMs = Date.now()) {
  const d = new Date(nowMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0);
}

function secondsUntilUtcMidnight(nowMs = Date.now()) {
  return Math.max(60, Math.ceil((nextUtcMidnightMs(nowMs) - nowMs) / 1000));
}

function isPlainObject(val) {
  if (!val || typeof val !== "object" || Array.isArray(val)) return false;
  const proto = Object.getPrototypeOf(val);
  return proto === Object.prototype || proto === null;
}

function isNonNegativeInt(val) {
  return typeof val === "number" && Number.isFinite(val) && Number.isSafeInteger(val) && val >= 0;
}

function isValidCalendarDate(dateStr) {
  if (!DATE_RE.test(dateStr)) return false;
  const [y, m, d] = dateStr.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function bookmarkCompositeKey(b) {
  const regionPart = b.section === "local_news" && b.region ? `:${b.region}` : "";
  return `${b.edition}:${b.date}:${b.section}${regionPart}:${b.id}`;
}

export function canonicalJson(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  const pairs = [];
  for (const k of keys) {
    if (value[k] === undefined) continue;
    pairs.push(`${JSON.stringify(k)}:${canonicalJson(value[k])}`);
  }
  return `{${pairs.join(",")}}`;
}

export async function computeContentHash({ preferences, bookmarks, deleted }) {
  const sortedBookmarks = [...bookmarks].sort((a, b) =>
    bookmarkCompositeKey(a).localeCompare(bookmarkCompositeKey(b))
  );
  const canonical = canonicalJson({
    preferences,
    bookmarks: sortedBookmarks,
    deleted,
  });
  return sha256Hex(canonical);
}

export function formatEtag(rev, contentHash) {
  return `"${rev}-${String(contentHash || "").slice(0, 12)}"`;
}

/**
 * Evaluate If-None-Match against a strong ETag (splitting commas, stripping W/ & quotes).
 */
export function etagMatches(ifNoneMatchHeader, currentEtag) {
  if (typeof ifNoneMatchHeader !== "string" || !ifNoneMatchHeader.trim()) return false;
  const normalize = (tag) => {
    let t = tag.trim();
    if (t.startsWith("W/") || t.startsWith("w/")) t = t.slice(2).trim();
    if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
      t = t.slice(1, -1);
    }
    return t;
  };
  const target = normalize(currentEtag);
  for (const rawPart of ifNoneMatchHeader.split(",")) {
    const part = rawPart.trim();
    if (!part) continue;
    if (part === "*") return true;
    if (normalize(part) === target) return true;
  }
  return false;
}

/**
 * Read and parse JSON body enforcing Content-Type: application/json and exact byte limit BEFORE decode/parse.
 */
export async function readJsonBody(request, maxBytes = MAX_BODY_BYTES) {
  const ct = request.headers.get("Content-Type") || "";
  const mediaType = ct.toLowerCase().split(";")[0].trim();
  if (mediaType !== "application/json") {
    return {
      ok: false,
      status: 415,
      error: "unsupported_media_type",
      message: "Content-Type must start with application/json.",
    };
  }

  let buf;
  try {
    buf = await request.arrayBuffer();
  } catch {
    return { ok: false, status: 400, error: "invalid_body", message: "Could not read request body." };
  }

  if (buf.byteLength > maxBytes) {
    return {
      ok: false,
      status: 413,
      error: "payload_too_large",
      message: `Payload exceeds maximum size of ${maxBytes} bytes.`,
    };
  }

  let text;
  try {
    text = textDecoder.decode(buf);
  } catch {
    return { ok: false, status: 400, error: "invalid_utf8", message: "Request body is not valid UTF-8." };
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, status: 400, error: "invalid_json", message: "Malformed JSON body." };
  }

  return { ok: true, data };
}

function validatePreferences(raw) {
  if (raw === undefined) return { ok: true, value: {} };
  if (!isPlainObject(raw)) {
    return { ok: false, message: "preferences must be a plain object." };
  }
  const out = {};
  for (const key of Object.keys(raw)) {
    if (FORBIDDEN_KEYS.has(key) || !PREF_KEYS.has(key)) {
      return { ok: false, message: `Unknown preference key: ${key}` };
    }
    const val = raw[key];
    if (val === undefined) continue;
    switch (key) {
      case "theme":
        if (val === null) continue;
        if (typeof val !== "string" || !THEME_VALS.has(val)) {
          return { ok: false, message: "Invalid preferences.theme." };
        }
        out.theme = val;
        break;
      case "positive_pos":
        if (val === null) continue;
        if (typeof val !== "string" || !POSITIVE_POS_VALS.has(val)) {
          return { ok: false, message: "Invalid preferences.positive_pos." };
        }
        out.positive_pos = val;
        break;
      case "local_region":
        if (val !== null && (typeof val !== "string" || !REGION_RE.test(val))) {
          return { ok: false, message: "Invalid preferences.local_region." };
        }
        out.local_region = val;
        break;
      case "local_lang":
        if (val === null) continue;
        if (typeof val !== "string" || !LANG_VALS.has(val)) {
          return { ok: false, message: "Invalid preferences.local_lang." };
        }
        out.local_lang = val;
        break;
      case "market_tf":
        if (val === null) continue;
        if (typeof val !== "string" || !MARKET_TF_VALS.has(val)) {
          return { ok: false, message: "Invalid preferences.market_tf." };
        }
        out.market_tf = val;
        break;
      case "world_kind_filter":
        if (val === null) continue;
        if (typeof val !== "string" || !WORLD_KIND_VALS.has(val)) {
          return { ok: false, message: "Invalid preferences.world_kind_filter." };
        }
        out.world_kind_filter = val;
        break;
      case "brief_style":
        if (val === null) continue;
        if (typeof val !== "string" || !BRIEF_STYLE_VALS.has(val)) {
          return { ok: false, message: "Invalid preferences.brief_style." };
        }
        out.brief_style = val;
        break;
      case "daily_sections":
      case "weekly_sections": {
        if (val === null) {
          out[key] = null;
          break;
        }
        if (!isPlainObject(val)) {
          return { ok: false, message: `Invalid preferences.${key}.` };
        }
        const allowedIds = key === "daily_sections" ? DAILY_SECTION_IDS : WEEKLY_SECTION_IDS;
        const cleanLayout = {};
        for (const sub of Object.keys(val)) {
          if (FORBIDDEN_KEYS.has(sub) || !SECTION_LAYOUT_KEYS.has(sub)) {
            return { ok: false, message: `Unknown key in preferences.${key}: ${sub}` };
          }
          const arr = val[sub];
          if (!Array.isArray(arr) || arr.length > allowedIds.size) {
            return { ok: false, message: `Invalid preferences.${key}.${sub}.` };
          }
          const deduped = [];
          const seen = new Set();
          for (const id of arr) {
            if (typeof id !== "string" || !allowedIds.has(id)) {
              return { ok: false, message: `Invalid section id in preferences.${key}.${sub}.` };
            }
            if (!seen.has(id)) {
              seen.add(id);
              deduped.push(id);
            }
          }
          cleanLayout[sub] = deduped;
        }
        out[key] = cleanLayout;
        break;
      }
      case "updated_at":
        if (!isNonNegativeInt(val)) {
          return { ok: false, message: "Invalid preferences.updated_at." };
        }
        out.updated_at = val;
        break;
    }
  }
  return { ok: true, value: out };
}

function validateBookmarkUrl(raw) {
  if (raw === undefined || raw === "") return { ok: true, value: "" };
  if (typeof raw !== "string") return { ok: false, message: "Bookmark url must be a string." };
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, value: "" };
  if (trimmed.length > 320) {
    return { ok: false, message: "Bookmark url exceeds 320 characters." };
  }
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, message: "Bookmark url is not a valid URL." };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, message: "Bookmark url must use http: or https:." };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, message: "Bookmark url must not contain credentials." };
  }
  return { ok: true, value: trimmed };
}

function validateBookmarks(raw) {
  if (raw === undefined) return { ok: true, value: [] };
  if (!Array.isArray(raw)) {
    return { ok: false, message: "bookmarks must be an array." };
  }
  if (raw.length > MAX_BOOKMARKS) {
    return { ok: false, message: `bookmarks exceeds limit of ${MAX_BOOKMARKS}.` };
  }

  const deduped = new Map();
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!isPlainObject(item)) {
      return { ok: false, message: `bookmarks[${i}] must be an object.` };
    }
    for (const k of Object.keys(item)) {
      if (FORBIDDEN_KEYS.has(k) || !BOOKMARK_KEYS.has(k)) {
        return { ok: false, message: `Unknown bookmark key: ${k}` };
      }
    }

    const { edition, date, section, id, region, lang, kind, saved_at, title, badge, source, url } = item;
    if (edition !== "daily" && edition !== "weekly") {
      return { ok: false, message: `bookmarks[${i}].edition must be 'daily' or 'weekly'.` };
    }
    if (typeof date !== "string" || !isValidCalendarDate(date)) {
      return { ok: false, message: `bookmarks[${i}].date must be YYYY-MM-DD.` };
    }
    const allowedSections = edition === "daily" ? DAILY_SECTIONS : WEEKLY_SECTIONS;
    if (typeof section !== "string" || !allowedSections.has(section)) {
      return { ok: false, message: `bookmarks[${i}].section is invalid for edition '${edition}'.` };
    }
    if (typeof id !== "string" || !CARD_ID_RE.test(id)) {
      return { ok: false, message: `bookmarks[${i}].id is invalid.` };
    }

    const clean = { edition, date, section, id };

    if (region !== undefined && region !== null && region !== "") {
      if (typeof region !== "string" || !REGION_RE.test(region)) {
        return { ok: false, message: `bookmarks[${i}].region is invalid.` };
      }
      clean.region = region;
    }
    if (lang !== undefined && lang !== null && lang !== "") {
      if (typeof lang !== "string" || !LANG_VALS.has(lang)) {
        return { ok: false, message: `bookmarks[${i}].lang must be 'native' or 'en'.` };
      }
      clean.lang = lang;
    }
    if (kind !== undefined && kind !== null && kind !== "") {
      if (typeof kind !== "string" || !KIND_RE.test(kind)) {
        return { ok: false, message: `bookmarks[${i}].kind is invalid.` };
      }
      clean.kind = kind;
    }

    if (!isNonNegativeInt(saved_at)) {
      return { ok: false, message: `bookmarks[${i}].saved_at must be a non-negative integer.` };
    }
    clean.saved_at = saved_at;

    if (typeof title !== "string") {
      return { ok: false, message: `bookmarks[${i}].title must be a string.` };
    }
    const trimmedTitle = title.trim();
    if (!trimmedTitle || trimmedTitle.length > 140) {
      return { ok: false, message: `bookmarks[${i}].title must be 1..140 characters.` };
    }
    clean.title = trimmedTitle;

    if (badge !== undefined) {
      if (typeof badge !== "string" || badge.trim().length > 32) {
        return { ok: false, message: `bookmarks[${i}].badge must be <= 32 characters.` };
      }
      clean.badge = badge.trim();
    } else {
      clean.badge = "";
    }

    if (source !== undefined) {
      if (typeof source !== "string" || source.trim().length > 40) {
        return { ok: false, message: `bookmarks[${i}].source must be <= 40 characters.` };
      }
      clean.source = source.trim();
    } else {
      clean.source = "";
    }

    const urlCheck = validateBookmarkUrl(url);
    if (!urlCheck.ok) {
      return { ok: false, message: `bookmarks[${i}]: ${urlCheck.message}` };
    }
    clean.url = urlCheck.value;

    const compKey = bookmarkCompositeKey(clean);
    const prev = deduped.get(compKey);
    if (!prev || clean.saved_at >= prev.saved_at) {
      deduped.set(compKey, clean);
    }
  }

  const normalized = Array.from(deduped.values()).sort((a, b) => {
    if (b.saved_at !== a.saved_at) return b.saved_at - a.saved_at;
    return bookmarkCompositeKey(a).localeCompare(bookmarkCompositeKey(b));
  });

  return { ok: true, value: normalized };
}

function validateDeleted(raw) {
  if (raw === undefined) return { ok: true, value: {} };
  if (!isPlainObject(raw)) {
    return { ok: false, message: "deleted must be a plain object." };
  }
  const keys = Object.keys(raw);
  if (keys.length > MAX_DELETED) {
    return { ok: false, message: `deleted exceeds limit of ${MAX_DELETED} entries.` };
  }
  const out = {};
  for (const key of keys) {
    if (FORBIDDEN_KEYS.has(key) || key.length > 160 || !DELETED_KEY_RE.test(key)) {
      return { ok: false, message: `Invalid deleted key: ${key}` };
    }
    const val = raw[key];
    if (!isNonNegativeInt(val)) {
      return { ok: false, message: `Invalid deleted timestamp for ${key}` };
    }
    out[key] = val;
  }
  return { ok: true, value: out };
}

/**
 * Validate unified v1 user state payload for PUT /user/state.
 */
export function validateUserStatePayload(raw) {
  if (!isPlainObject(raw)) {
    return { ok: false, message: "Payload must be a JSON object." };
  }
  for (const k of Object.keys(raw)) {
    if (FORBIDDEN_KEYS.has(k) || !TOP_LEVEL_KEYS.has(k)) {
      return { ok: false, message: `Unknown top-level field: ${k}` };
    }
  }

  if (raw.schema_version !== undefined && raw.schema_version !== 1 && raw.schema_version !== "1") {
    return { ok: false, message: "Unsupported schema_version (expected 1)." };
  }

  let baseRev = 0;
  if (raw.base_rev !== undefined) {
    if (!isNonNegativeInt(raw.base_rev)) {
      return { ok: false, message: "base_rev must be a non-negative integer." };
    }
    baseRev = raw.base_rev;
  }

  let baseHash = "";
  if (raw.base_hash !== undefined && raw.base_hash !== null && raw.base_hash !== "") {
    if (typeof raw.base_hash !== "string" || !HEX64_RE.test(raw.base_hash)) {
      return { ok: false, message: "base_hash must be a 64-char lowercase hex SHA-256." };
    }
    baseHash = raw.base_hash;
  }

  let revSig = "";
  if (raw.rev_sig !== undefined && raw.rev_sig !== null) {
    if (typeof raw.rev_sig !== "string" || raw.rev_sig.length > 128) {
      return { ok: false, message: "Invalid rev_sig." };
    }
    revSig = raw.rev_sig;
  }

  const prefRes = validatePreferences(raw.preferences);
  if (!prefRes.ok) return prefRes;

  const bmRes = validateBookmarks(raw.bookmarks);
  if (!bmRes.ok) return bmRes;

  const delRes = validateDeleted(raw.deleted);
  if (!delRes.ok) return delRes;

  return {
    ok: true,
    value: {
      schema_version: 1,
      base_rev: baseRev,
      base_hash: baseHash,
      rev_sig: revSig,
      preferences: prefRes.value,
      bookmarks: bmRes.value,
      deleted: delRes.value,
    },
  };
}

// --- Sliding-window rate limit helper backed by caches.default ---

export async function checkSlidingRateLimit(cacheKeyUrl, windowSec, maxCount, consume = true) {
  const cache = getDefaultCache();
  if (!cache) return { allowed: true, retryAfter: 0, count: 0 };

  const now = Date.now();
  const windowMs = windowSec * 1000;
  const req = new Request(cacheKeyUrl);

  let timestamps = [];
  try {
    const existing = await cache.match(req);
    if (existing) {
      const parsed = await existing.json();
      if (Array.isArray(parsed)) {
        timestamps = parsed.filter((t) => typeof t === "number" && now - t < windowMs);
      }
    }
  } catch {
    timestamps = [];
  }

  if (timestamps.length >= maxCount) {
    const oldest = Math.min(...timestamps);
    const retryAfter = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    return { allowed: false, retryAfter, count: timestamps.length };
  }

  if (consume) {
    timestamps.push(now);
    try {
      await cache.put(
        req,
        new Response(JSON.stringify(timestamps), {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": `public, max-age=${windowSec}`,
          },
        })
      );
    } catch {
      // Ignore cache put error
    }
  }

  return { allowed: true, retryAfter: 0, count: timestamps.length };
}

async function isPopQuotaKilled(nowMs = Date.now()) {
  if (popQuotaKillUntilMs > nowMs) return true;
  const cache = getDefaultCache();
  if (!cache) return false;
  try {
    const resp = await cache.match(new Request(`https://rl.internal/v1/kv-kill/${getUtcDayString(nowMs)}`));
    if (resp) {
      popQuotaKillUntilMs = nextUtcMidnightMs(nowMs);
      return true;
    }
  } catch {
    // Ignore
  }
  return false;
}

async function triggerPopQuotaKill(nowMs = Date.now()) {
  popQuotaKillUntilMs = nextUtcMidnightMs(nowMs);
  const cache = getDefaultCache();
  if (!cache) return;
  try {
    await cache.put(
      new Request(`https://rl.internal/v1/kv-kill/${getUtcDayString(nowMs)}`),
      new Response("1", {
        headers: {
          "Content-Type": "text/plain",
          "Cache-Control": `public, max-age=${secondsUntilUtcMidnight(nowMs)}`,
        },
      })
    );
  } catch {
    // Ignore
  }
}

async function checkPopDailyWriteCap(nowMs = Date.now()) {
  const day = getUtcDayString(nowMs);
  if (popWriteDay !== day) {
    popWriteDay = day;
    popWriteCount = 0;
  }
  const cache = getDefaultCache();
  let cachedCount = popWriteCount;
  if (cache) {
    try {
      const resp = await cache.match(new Request(`https://rl.internal/v1/pop-writes/${day}`));
      if (resp) {
        const val = Number(await resp.text());
        if (Number.isFinite(val) && val > cachedCount) {
          cachedCount = val;
          popWriteCount = val;
        }
      }
    } catch {
      // Ignore
    }
  }
  return cachedCount < POP_GLOBAL_WRITE_CAP;
}

async function incrementPopDailyWriteCount(nowMs = Date.now()) {
  const day = getUtcDayString(nowMs);
  if (popWriteDay !== day) {
    popWriteDay = day;
    popWriteCount = 0;
  }
  popWriteCount += 1;
  const cache = getDefaultCache();
  if (cache) {
    try {
      await cache.put(
        new Request(`https://rl.internal/v1/pop-writes/${day}`),
        new Response(String(popWriteCount), {
          headers: {
            "Content-Type": "text/plain",
            "Cache-Control": `public, max-age=${secondsUntilUtcMidnight(nowMs)}`,
          },
        })
      );
    } catch {
      // Ignore
    }
  }
}

async function checkGlobalKvWriteBudget(env, nowMs = Date.now()) {
  const day = getUtcDayString(nowMs);
  const cache = getDefaultCache();
  const cacheKey = new Request(`https://rl.internal/v1/global-writes/${day}`);
  const kvKey = `meta:writes:${day}`;

  if (globalCounterMem.day !== day) {
    globalCounterMem = { day, kvBaseCount: 0, pendingWrites: 0, fetchedAtMs: 0 };
  }

  const stale = nowMs - globalCounterMem.fetchedAtMs >= KV_GLOBAL_CACHE_TTL_SEC * 1000;
  if (stale) {
    let loaded = null;
    if (cache) {
      try {
        const cached = await cache.match(cacheKey);
        if (cached) {
          const n = Number(await cached.text());
          if (Number.isFinite(n)) loaded = n;
        }
      } catch {
        // Ignore
      }
    }
    if (loaded === null && env?.USER_PREFS_KV) {
      try {
        const raw = await env.USER_PREFS_KV.get(kvKey);
        loaded = raw ? Number(raw) || 0 : 0;
      } catch {
        loaded = globalCounterMem.kvBaseCount;
      }
      if (cache) {
        try {
          await cache.put(
            cacheKey,
            new Response(String(loaded), {
              headers: {
                "Content-Type": "text/plain",
                "Cache-Control": `public, max-age=${KV_GLOBAL_CACHE_TTL_SEC}`,
              },
            })
          );
        } catch {
          // Ignore
        }
      }
    }
    if (loaded !== null) {
      globalCounterMem.kvBaseCount = Math.max(globalCounterMem.kvBaseCount, loaded);
    }
    globalCounterMem.fetchedAtMs = nowMs;
  }

  return globalCounterMem.kvBaseCount + globalCounterMem.pendingWrites < KV_GLOBAL_WRITE_CAP;
}

async function recordGlobalKvWrite(env, nowMs = Date.now()) {
  const day = getUtcDayString(nowMs);
  if (globalCounterMem.day !== day) {
    globalCounterMem = { day, kvBaseCount: 0, pendingWrites: 0, fetchedAtMs: nowMs };
  }
  globalCounterMem.pendingWrites += 1;

  if (globalCounterMem.pendingWrites >= KV_GLOBAL_FLUSH_BATCH && env?.USER_PREFS_KV) {
    const kvKey = `meta:writes:${day}`;
    const delta = globalCounterMem.pendingWrites;
    globalCounterMem.pendingWrites = 0;
    try {
      const currentRaw = await env.USER_PREFS_KV.get(kvKey);
      const current = currentRaw ? Number(currentRaw) || 0 : 0;
      const next = Math.max(current, globalCounterMem.kvBaseCount) + delta;
      await env.USER_PREFS_KV.put(kvKey, String(next), { expirationTtl: 172800 });
      globalCounterMem.kvBaseCount = next;
      globalCounterMem.fetchedAtMs = nowMs;
      const cache = getDefaultCache();
      if (cache) {
        await cache.put(
          new Request(`https://rl.internal/v1/global-writes/${day}`),
          new Response(String(next), {
            headers: {
              "Content-Type": "text/plain",
              "Cache-Control": `public, max-age=${KV_GLOBAL_CACHE_TTL_SEC}`,
            },
          })
        );
      }
    } catch {
      // Never fail user response due to batched meta counter flush
      globalCounterMem.kvBaseCount += delta;
    }
  }
}

// --- Shadow-cached state reads & writes ---

function shadowCacheRequest(uid) {
  return new Request(`https://state-shadow.internal/v1/${uid}`);
}

async function emptyUserState() {
  const base = { preferences: {}, bookmarks: [], deleted: {} };
  return {
    schema_version: 1,
    rev: 0,
    updated_at: 0,
    content_hash: await computeContentHash(base),
    preferences: base.preferences,
    bookmarks: base.bookmarks,
    deleted: base.deleted,
  };
}

async function readShadowState(uid) {
  const cache = getDefaultCache();
  if (!cache) return null;
  try {
    const resp = await cache.match(shadowCacheRequest(uid));
    if (!resp) return null;
    const data = await resp.json();
    return data && typeof data === "object" && Number.isInteger(data.rev) ? data : null;
  } catch {
    return null;
  }
}

async function writeShadowState(uid, stateObj) {
  const cache = getDefaultCache();
  if (!cache) return;
  try {
    await cache.put(
      shadowCacheRequest(uid),
      new Response(JSON.stringify(stateObj), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": `public, max-age=${SHADOW_CACHE_TTL_SEC}`,
        },
      })
    );
  } catch {
    // Ignore cache put errors
  }
}

async function readEffectiveState(uid, env) {
  const [kvState, shadowState] = await Promise.all([
    env?.USER_PREFS_KV
      ? env.USER_PREFS_KV.get(`user:${uid}`, "json").catch(() => null)
      : Promise.resolve(null),
    readShadowState(uid),
  ]);

  const validKv = kvState && typeof kvState === "object" && Number.isInteger(kvState.rev) ? kvState : null;
  const validShadow =
    shadowState && typeof shadowState === "object" && Number.isInteger(shadowState.rev) ? shadowState : null;

  if (validKv && validShadow) {
    return validShadow.rev >= validKv.rev ? validShadow : validKv;
  }
  if (validShadow) return validShadow;
  if (validKv) return validKv;
  return emptyUserState();
}

function formatStatePayload(state, revSig) {
  return {
    schema_version: 1,
    rev: state.rev,
    updated_at: state.updated_at,
    content_hash: state.content_hash,
    hash: state.content_hash,
    rev_sig: revSig,
    preferences: state.preferences || {},
    bookmarks: Array.isArray(state.bookmarks) ? state.bookmarks : [],
    deleted: state.deleted || {},
  };
}

export function authSecurityHeaders(extraHeaders = {}) {
  return {
    "Cache-Control": "private, no-store",
    Pragma: "no-cache",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    ...extraHeaders,
  };
}

function buildJsonResponse(body, status, corsHeadersObj, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeadersObj,
      ...authSecurityHeaders(extraHeaders),
    },
  });
}

/**
 * Handle GET /user/state
 */
export async function handleGetUserState(request, env, session, refreshed, corsHeadersObj) {
  const extraHeaders = {};
  if (refreshed?.token) {
    extraHeaders["X-Refreshed-Token"] = refreshed.token;
  }

  const rl = await checkSlidingRateLimit(
    `https://rl.internal/v1/user-read/${session.uid}`,
    USER_READ_WINDOW_SEC,
    USER_READ_MAX,
    true
  );
  if (!rl.allowed) {
    return buildJsonResponse(
      { error: "rate_limited", retry_after: rl.retryAfter },
      429,
      corsHeadersObj,
      { ...extraHeaders, "Retry-After": String(rl.retryAfter) }
    );
  }

  const effective = await readEffectiveState(session.uid, env);
  const etag = formatEtag(effective.rev, effective.content_hash);
  const ifNoneMatch = request.headers.get("If-None-Match");

  if (etagMatches(ifNoneMatch, etag)) {
    return new Response(null, {
      status: 304,
      headers: {
        ...corsHeadersObj,
        ...authSecurityHeaders({ ...extraHeaders, ETag: etag }),
      },
    });
  }

  const revSig = await signRev(session.uid, effective.rev, effective.content_hash, env);
  return buildJsonResponse(formatStatePayload(effective, revSig), 200, corsHeadersObj, {
    ...extraHeaders,
    ETag: etag,
  });
}

/**
 * Handle PUT /user/state
 */
export async function handlePutUserState(request, env, session, refreshed, corsHeadersObj) {
  const extraHeaders = {};
  if (refreshed?.token) {
    extraHeaders["X-Refreshed-Token"] = refreshed.token;
  }

  if (env?.AUTH_SYNC_WRITES_ENABLED === "false") {
    return buildJsonResponse(
      { error: "sync_writes_paused", message: "Cloud sync writes are temporarily paused." },
      503,
      corsHeadersObj,
      extraHeaders
    );
  }

  if (!env?.USER_PREFS_KV) {
    return buildJsonResponse(
      { error: "storage_unavailable", message: "USER_PREFS_KV binding is not configured." },
      503,
      corsHeadersObj,
      extraHeaders
    );
  }

  const nowMs = Date.now();
  if (await isPopQuotaKilled(nowMs)) {
    return buildJsonResponse(
      { error: "sync_quota_exceeded", message: "Daily cloud sync write quota reached." },
      503,
      corsHeadersObj,
      { ...extraHeaders, "Retry-After": String(secondsUntilUtcMidnight(nowMs)) }
    );
  }

  const parsed = await readJsonBody(request, MAX_BODY_BYTES);
  if (!parsed.ok) {
    return buildJsonResponse(
      { error: parsed.error, message: parsed.message },
      parsed.status,
      corsHeadersObj,
      extraHeaders
    );
  }

  const validated = validateUserStatePayload(parsed.data);
  if (!validated.ok) {
    return buildJsonResponse(
      { error: "invalid_payload", message: validated.message },
      400,
      corsHeadersObj,
      extraHeaders
    );
  }

  const { base_rev: baseRev, base_hash: baseHash, rev_sig: clientRevSig, preferences, bookmarks, deleted } =
    validated.value;
  const newHash = await computeContentHash({ preferences, bookmarks, deleted });
  const effective = await readEffectiveState(session.uid, env);

  // Optimistic concurrency check with rev_sig cross-POP eventual-consistency handling
  if (effective.rev > baseRev) {
    const effectiveSig = await signRev(session.uid, effective.rev, effective.content_hash, env);
    return buildJsonResponse(
      {
        error: "conflict",
        state: formatStatePayload(effective, effectiveSig),
      },
      409,
      corsHeadersObj,
      { ...extraHeaders, ETag: formatEtag(effective.rev, effective.content_hash) }
    );
  }

  let nextRev = effective.rev + 1;
  let isNoop = newHash === effective.content_hash;

  if (baseRev > effective.rev) {
    const validProof = await verifyRevSig(session.uid, baseRev, baseHash, clientRevSig, env);
    if (!validProof) {
      const effectiveSig = await signRev(session.uid, effective.rev, effective.content_hash, env);
      return buildJsonResponse(
        {
          error: "conflict",
          state: formatStatePayload(effective, effectiveSig),
        },
        409,
        corsHeadersObj,
        { ...extraHeaders, ETag: formatEtag(effective.rev, effective.content_hash) }
      );
    }
    // Valid rev_sig: effective is a stale cross-POP KV read!
    if (baseHash && newHash === baseHash) {
      const etag = formatEtag(baseRev, newHash);
      return buildJsonResponse(
        {
          skipped: true,
          schema_version: 1,
          rev: baseRev,
          updated_at: effective.updated_at || Math.floor(nowMs / 1000),
          content_hash: newHash,
          hash: newHash,
          rev_sig: clientRevSig,
          preferences,
          bookmarks,
          deleted,
        },
        200,
        corsHeadersObj,
        { ...extraHeaders, ETag: etag }
      );
    }
    nextRev = baseRev + 1;
    isNoop = false;
  }

  // No-op skip: identical canonical content_hash -> avoid KV write
  if (isNoop) {
    const effectiveSig = await signRev(session.uid, effective.rev, effective.content_hash, env);
    return buildJsonResponse(
      {
        skipped: true,
        ...formatStatePayload(effective, effectiveSig),
      },
      200,
      corsHeadersObj,
      { ...extraHeaders, ETag: formatEtag(effective.rev, effective.content_hash) }
    );
  }

  // Per-user write rate limits (check both windows before consuming)
  const shortKey = `https://rl.internal/v1/user-write-10m/${session.uid}`;
  const dailyKey = `https://rl.internal/v1/user-write-24h/${session.uid}`;
  const [shortCheck, dailyCheck] = await Promise.all([
    checkSlidingRateLimit(shortKey, USER_WRITE_SHORT_WINDOW_SEC, USER_WRITE_SHORT_MAX, false),
    checkSlidingRateLimit(dailyKey, USER_WRITE_DAILY_WINDOW_SEC, USER_WRITE_DAILY_MAX, false),
  ]);
  if (!shortCheck.allowed || !dailyCheck.allowed) {
    const retryAfter = Math.max(shortCheck.retryAfter || 0, dailyCheck.retryAfter || 0, 1);
    return buildJsonResponse(
      { error: "rate_limited", retry_after: retryAfter },
      429,
      corsHeadersObj,
      { ...extraHeaders, "Retry-After": String(retryAfter) }
    );
  }

  // Per-POP and Global KV write guardrails
  const [popAllowed, globalAllowed] = await Promise.all([
    checkPopDailyWriteCap(nowMs),
    checkGlobalKvWriteBudget(env, nowMs),
  ]);
  if (!popAllowed || !globalAllowed) {
    return buildJsonResponse(
      { error: "sync_quota_exceeded", message: "Daily cloud sync write budget reached." },
      503,
      corsHeadersObj,
      { ...extraHeaders, "Retry-After": String(secondsUntilUtcMidnight(nowMs)) }
    );
  }

  const nowSec = Math.floor(nowMs / 1000);
  const nextState = {
    schema_version: 1,
    rev: nextRev,
    updated_at: nowSec,
    content_hash: newHash,
    preferences,
    bookmarks,
    deleted,
  };

  try {
    await env.USER_PREFS_KV.put(`user:${session.uid}`, JSON.stringify(nextState));
  } catch (err) {
    console.error("[user_state] USER_PREFS_KV.put failed:", err?.message || err);
    await triggerPopQuotaKill(nowMs);
    return buildJsonResponse(
      { error: "sync_quota_exceeded", message: "Cloud storage write failed or quota exceeded." },
      503,
      corsHeadersObj,
      { ...extraHeaders, "Retry-After": String(secondsUntilUtcMidnight(nowMs)) }
    );
  }

  // Write-through shadow cache + update rate limit & global write counters
  await Promise.all([
    writeShadowState(session.uid, nextState),
    checkSlidingRateLimit(shortKey, USER_WRITE_SHORT_WINDOW_SEC, USER_WRITE_SHORT_MAX, true),
    checkSlidingRateLimit(dailyKey, USER_WRITE_DAILY_WINDOW_SEC, USER_WRITE_DAILY_MAX, true),
    incrementPopDailyWriteCount(nowMs),
    recordGlobalKvWrite(env, nowMs),
  ]);

  const revSig = await signRev(session.uid, nextState.rev, nextState.content_hash, env);
  return buildJsonResponse(
    {
      skipped: false,
      ...formatStatePayload(nextState, revSig),
    },
    200,
    corsHeadersObj,
    { ...extraHeaders, ETag: formatEtag(nextState.rev, nextState.content_hash) }
  );
}

/**
 * Lightweight Shared Utilities for colintan.dev
 * Zero external imports — safe for index.html, shared/auth.js, and shared/bookmarks.js.
 */

export function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function safeUrl(url, maxLen = 2048) {
  if (typeof url !== "string") return "#";
  const trimmed = url.trim();
  if (!trimmed || trimmed.length > maxLen) return "#";
  try {
    const parsed = new URL(trimmed);
    if (parsed.username || parsed.password) return "#";
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "#";
    return escapeHtml(parsed.href);
  } catch {
    return "#";
  }
}

export function sanitizeHttpUrl(raw, maxLen = 320) {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > maxLen) return "";
  try {
    const parsed = new URL(trimmed);
    if (parsed.username || parsed.password) return "";
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return parsed.href.length <= maxLen ? parsed.href : "";
  } catch {
    return "";
  }
}

export function escapeRegex(str) {
  return String(str ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const READABLE_DATE_FMT = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

const SHORT_DATE_FMT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

export function fmtReadableDate(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = String(dateStr).split("-").map(Number);
  if (!y || !m || !d) return String(dateStr);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(dt.getTime())) return String(dateStr);
  return READABLE_DATE_FMT.format(dt);
}

export function fmtShortDate(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = String(dateStr).split("-").map(Number);
  if (!y || !m || !d) return String(dateStr);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(dt.getTime())) return String(dateStr);
  return SHORT_DATE_FMT.format(dt);
}

export function fmtLocalTimestamp(isoStr) {
  if (!isoStr) return "";
  const dt = new Date(isoStr);
  if (Number.isNaN(dt.getTime())) return isoStr;
  return dt.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export function fmtCoords(lat, lon) {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(1)}°${ns}, ${Math.abs(lon).toFixed(1)}°${ew}`;
}

export async function fetchJson(url, { cache = "no-store", signal } = {}) {
  const opts = { cache };
  if (signal) opts.signal = signal;
  const resp = await fetch(url, opts);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
  return resp.json();
}

export function readJsonStorage(key, storage = typeof localStorage !== "undefined" ? localStorage : null) {
  try {
    if (!storage) return null;
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writeJsonStorage(key, value, storage = typeof localStorage !== "undefined" ? localStorage : null) {
  try {
    if (!storage) return false;
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

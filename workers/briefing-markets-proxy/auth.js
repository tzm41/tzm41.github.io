/**
 * Zero-dependency Web Crypto authentication helpers for colintan.dev.
 *
 * - Verifies Google ID tokens (RS256) against https://www.googleapis.com/oauth2/v3/certs
 * - Derives stable, secret-independent KV user IDs from Google `sub`
 * - Mints & verifies zero-PII HS256 session JWTs with sliding refresh
 * - Signs & verifies HMAC `rev_sig` tokens for KV eventual-consistency conflict resolution
 */

export const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";

const JWKS_CACHE_KEY = "https://jwks-cache.internal/google-oauth2-v3-certs";
const JWKS_FORCE_LOCK_KEY = "https://jwks-cache.internal/google-force-refresh-lock";

const MAX_TOKEN_LEN = 8192;
const B64URL_PART_RE = /^[A-Za-z0-9_-]+$/;
const KID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const UID_RE = /^[a-f0-9]{64}$/;
const REV_SIG_RE = /^[A-Za-z0-9_-]{43}$/;

const GOOGLE_ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);
const CLOCK_SKEW_SEC = 60;
const MAX_GOOGLE_IAT_AGE_SEC = 3660;
const MIN_JWKS_TTL_SEC = 300;
const MAX_JWKS_TTL_SEC = 21600;
const DEFAULT_JWKS_TTL_SEC = 3600;
const FORCE_REFRESH_COOLDOWN_MS = 60_000;

export const SESSION_ISS = "colintan.dev";
export const SESSION_AUD = "colintan.dev";
export const SESSION_TTL_SEC = 30 * 86400;
export const SESSION_REFRESH_THRESHOLD_SEC = 7 * 86400;
export const SESSION_MAX_LIFETIME_SEC = 90 * 86400;

const ALLOWED_PIC_HOST_RE = /^(?:lh[3-6]\.googleusercontent\.com|(?:[a-z0-9-]+\.)+ggpht\.com)$/i;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

// Isolate-level caches
let jwksMemCache = {
  keysByKid: null,
  expiresAtMs: 0,
};
let lastForceRefreshMs = 0;

let cachedHmacSecret = null;
let cachedHmacKey = null;

export class AuthError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.name = "AuthError";
    this.status = status;
    this.code = code;
  }
}

function getDefaultCache() {
  if (typeof caches !== "undefined" && caches && caches.default) {
    return caches.default;
  }
  return null;
}

export function resetAuthCachesForTest() {
  jwksMemCache = { keysByKid: null, expiresAtMs: 0 };
  lastForceRefreshMs = 0;
  cachedHmacSecret = null;
  cachedHmacKey = null;
}

export function base64UrlEncodeBytes(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < arr.length; i += chunkSize) {
    binary += String.fromCharCode(...arr.subarray(i, i + chunkSize));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function base64UrlDecodeToBytes(str) {
  if (typeof str !== "string" || str.length === 0 || !B64URL_PART_RE.test(str) || str.length % 4 === 1) {
    throw new AuthError(401, "invalid_token", "Malformed base64url segment.");
  }
  let padded = str.replace(/-/g, "+").replace(/_/g, "/");
  while (padded.length % 4 !== 0) padded += "=";
  let binary;
  try {
    binary = atob(padded);
  } catch {
    throw new AuthError(401, "invalid_token", "Base64url decode failed.");
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function decodeJsonSegment(part) {
  const bytes = base64UrlDecodeToBytes(part);
  let parsed;
  try {
    parsed = JSON.parse(textDecoder.decode(bytes));
  } catch {
    throw new AuthError(401, "invalid_token", "Invalid JSON in JWT segment.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AuthError(401, "invalid_token", "JWT segment must be a JSON object.");
  }
  return parsed;
}

function splitStrictJwt(token) {
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LEN) {
    throw new AuthError(401, "invalid_token", "Invalid token length.");
  }
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new AuthError(401, "invalid_token", "JWT must have 3 parts.");
  }
  for (const part of parts) {
    if (!part || !B64URL_PART_RE.test(part)) {
      throw new AuthError(401, "invalid_token", "JWT segment contains invalid characters.");
    }
  }
  return parts;
}

export function sanitizeName(raw) {
  if (typeof raw !== "string") return "";
  return raw.replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, 80);
}

export function sanitizePicture(raw) {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 512) return "";
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return "";
  }
  if (parsed.protocol !== "https:") return "";
  if (parsed.username || parsed.password) return "";
  if (!ALLOWED_PIC_HOST_RE.test(parsed.hostname)) return "";
  return parsed.toString().slice(0, 512);
}

export async function sha256Hex(input) {
  const bytes = typeof input === "string" ? textEncoder.encode(input) : input;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const view = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < view.length; i++) {
    hex += view[i].toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * Derive a deterministic 64-hex KV user ID from Google `sub`.
 * Never mixes SESSION_SECRET so rotating SESSION_SECRET preserves user data.
 */
export async function deriveUid(sub) {
  if (typeof sub !== "string" || sub.length < 1 || sub.length > 255) {
    throw new AuthError(401, "invalid_token", "Invalid Google subject.");
  }
  return sha256Hex(`colintan.dev:google-sub:v1:${sub}`);
}

function parseMaxAgeSeconds(cacheControl) {
  if (typeof cacheControl !== "string") return DEFAULT_JWKS_TTL_SEC;
  const match = /max-age=(\d+)/i.exec(cacheControl);
  if (!match) return DEFAULT_JWKS_TTL_SEC;
  const raw = Number(match[1]);
  if (!Number.isFinite(raw)) return DEFAULT_JWKS_TTL_SEC;
  return Math.max(MIN_JWKS_TTL_SEC, Math.min(MAX_JWKS_TTL_SEC, Math.floor(raw)));
}

function indexJwks(keys) {
  const map = new Map();
  if (!Array.isArray(keys)) return map;
  for (const jwk of keys) {
    if (jwk && typeof jwk === "object" && typeof jwk.kid === "string" && KID_RE.test(jwk.kid)) {
      map.set(jwk.kid, jwk);
    }
  }
  return map;
}

async function getGoogleJwks(forceRefresh = false, fetchFn = fetch) {
  const nowMs = Date.now();
  const cache = getDefaultCache();

  if (!forceRefresh) {
    if (jwksMemCache.keysByKid && nowMs < jwksMemCache.expiresAtMs) {
      return jwksMemCache.keysByKid;
    }
    if (cache) {
      try {
        const cachedResp = await cache.match(new Request(JWKS_CACHE_KEY));
        if (cachedResp) {
          const payload = await cachedResp.json();
          if (payload && Array.isArray(payload.keys) && typeof payload.expiresAtMs === "number" && nowMs < payload.expiresAtMs) {
            const map = indexJwks(payload.keys);
            jwksMemCache = { keysByKid: map, expiresAtMs: payload.expiresAtMs };
            return map;
          }
        }
      } catch {
        // Cache miss / corrupt entry; fall through to network fetch
      }
    }
  } else {
    // Global unknown-kid force-refresh throttle: at most once per 60s across ALL unknown kids
    if (nowMs - lastForceRefreshMs < FORCE_REFRESH_COOLDOWN_MS) {
      return jwksMemCache.keysByKid || new Map();
    }
    if (cache) {
      try {
        const lockResp = await cache.match(new Request(JWKS_FORCE_LOCK_KEY));
        if (lockResp) {
          lastForceRefreshMs = nowMs;
          return jwksMemCache.keysByKid || new Map();
        }
      } catch {
        // Ignore cache error
      }
    }
    lastForceRefreshMs = nowMs;
    if (cache) {
      try {
        await cache.put(
          new Request(JWKS_FORCE_LOCK_KEY),
          new Response("1", {
            headers: {
              "Content-Type": "text/plain",
              "Cache-Control": `public, max-age=${Math.floor(FORCE_REFRESH_COOLDOWN_MS / 1000)}`,
            },
          })
        );
      } catch {
        // Ignore cache put errors
      }
    }
  }

  let resp;
  try {
    resp = await fetchFn(GOOGLE_JWKS_URL, {
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new AuthError(503, "jwks_unavailable", "Unable to reach Google JWKS endpoint.");
  }

  if (!resp || !resp.ok) {
    throw new AuthError(503, "jwks_unavailable", "Google JWKS endpoint returned an error.");
  }

  let body;
  try {
    body = await resp.json();
  } catch {
    throw new AuthError(503, "jwks_unavailable", "Invalid JSON from Google JWKS endpoint.");
  }

  if (!body || !Array.isArray(body.keys)) {
    throw new AuthError(503, "jwks_unavailable", "Missing keys array in Google JWKS.");
  }

  const ttlSec = parseMaxAgeSeconds(resp.headers?.get?.("Cache-Control"));
  const expiresAtMs = nowMs + ttlSec * 1000;
  const map = indexJwks(body.keys);
  jwksMemCache = { keysByKid: map, expiresAtMs };

  if (cache) {
    try {
      await cache.put(
        new Request(JWKS_CACHE_KEY),
        new Response(JSON.stringify({ keys: body.keys, expiresAtMs }), {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": `public, max-age=${ttlSec}`,
          },
        })
      );
    } catch {
      // Ignore cache put errors
    }
  }

  return map;
}

/**
 * Verify a Google Sign-In ID token using Web Crypto RS256.
 */
export async function verifyGoogleIdToken(idToken, env, options = {}) {
  const clientId = env?.GOOGLE_CLIENT_ID;
  if (typeof clientId !== "string" || !clientId.trim()) {
    throw new AuthError(500, "server_misconfigured", "GOOGLE_CLIENT_ID is not configured.");
  }

  const parts = splitStrictJwt(idToken);
  const header = decodeJsonSegment(parts[0]);
  const payload = decodeJsonSegment(parts[1]);

  if (header.alg !== "RS256") {
    throw new AuthError(401, "invalid_token", "Unsupported Google ID token alg.");
  }
  if (typeof header.kid !== "string" || !KID_RE.test(header.kid)) {
    throw new AuthError(401, "invalid_token", "Invalid Google ID token kid.");
  }

  const fetchFn = options.fetchFn || fetch;
  let keysByKid = await getGoogleJwks(false, fetchFn);
  let jwk = keysByKid.get(header.kid);
  if (!jwk) {
    keysByKid = await getGoogleJwks(true, fetchFn);
    jwk = keysByKid.get(header.kid);
  }
  if (!jwk) {
    throw new AuthError(401, "invalid_token", "Unknown signing key.");
  }

  if (
    jwk.kty !== "RSA" ||
    (jwk.use && jwk.use !== "sig") ||
    (jwk.alg && jwk.alg !== "RS256") ||
    typeof jwk.n !== "string" ||
    typeof jwk.e !== "string"
  ) {
    throw new AuthError(401, "invalid_token", "Invalid JWK parameters.");
  }

  let publicKey;
  try {
    publicKey = await crypto.subtle.importKey(
      "jwk",
      { kty: "RSA", n: jwk.n, e: jwk.e, ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );
  } catch {
    throw new AuthError(401, "invalid_token", "Failed to import Google JWK.");
  }

  const sigBytes = base64UrlDecodeToBytes(parts[2]);
  const signingInput = textEncoder.encode(`${parts[0]}.${parts[1]}`);
  const validSig = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, sigBytes, signingInput);
  if (!validSig) {
    throw new AuthError(401, "invalid_token", "Invalid Google ID token signature.");
  }

  // Claims validation
  const nowSec = options.nowSec ?? Math.floor(Date.now() / 1000);

  if (typeof payload.iss !== "string" || !GOOGLE_ISSUERS.has(payload.iss)) {
    throw new AuthError(401, "invalid_token", "Invalid token issuer.");
  }
  if (typeof payload.aud !== "string" || payload.aud !== clientId) {
    throw new AuthError(401, "invalid_token", "Invalid token audience.");
  }
  if (payload.azp !== undefined && payload.azp !== clientId) {
    throw new AuthError(401, "invalid_token", "Invalid authorized party.");
  }

  if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) {
    throw new AuthError(401, "invalid_token", "Missing or invalid exp.");
  }
  if (payload.exp <= nowSec - CLOCK_SKEW_SEC) {
    throw new AuthError(401, "token_expired", "Google ID token expired.");
  }

  if (typeof payload.iat !== "number" || !Number.isFinite(payload.iat)) {
    throw new AuthError(401, "invalid_token", "Missing or invalid iat.");
  }
  if (payload.iat > nowSec + CLOCK_SKEW_SEC) {
    throw new AuthError(401, "invalid_token", "Google ID token issued in the future.");
  }
  if (nowSec - payload.iat > MAX_GOOGLE_IAT_AGE_SEC) {
    throw new AuthError(401, "token_expired", "Google ID token is too old.");
  }

  if (payload.nbf !== undefined) {
    if (typeof payload.nbf !== "number" || !Number.isFinite(payload.nbf)) {
      throw new AuthError(401, "invalid_token", "Invalid nbf.");
    }
    if (payload.nbf > nowSec + CLOCK_SKEW_SEC) {
      throw new AuthError(401, "invalid_token", "Google ID token not yet valid.");
    }
  }

  if (typeof payload.sub !== "string" || payload.sub.length < 1 || payload.sub.length > 255) {
    throw new AuthError(401, "invalid_token", "Missing or invalid sub.");
  }

  if (payload.email_verified !== true) {
    throw new AuthError(403, "email_not_verified", "Google account email is not verified.");
  }

  return {
    sub: payload.sub,
    name: sanitizeName(payload.name),
    picture: sanitizePicture(payload.picture),
  };
}

async function getHmacKey(env) {
  const secret = env?.SESSION_SECRET;
  if (typeof secret !== "string" || secret.length < 32) {
    throw new AuthError(500, "server_misconfigured", "SESSION_SECRET is missing or too short.");
  }
  if (cachedHmacKey && cachedHmacSecret === secret) {
    return cachedHmacKey;
  }
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
  cachedHmacSecret = secret;
  cachedHmacKey = key;
  return key;
}

function getSessionVersion(env) {
  const v = Number(env?.SESSION_VERSION ?? 1);
  return Number.isInteger(v) && v >= 1 ? v : 1;
}

/**
 * Mint a zero-PII HS256 session JWT (no email stored).
 */
export async function mintSessionToken({ uid, name = "", picture = "", orig_iat }, env, nowSec) {
  if (typeof uid !== "string" || !UID_RE.test(uid)) {
    throw new AuthError(500, "invalid_uid", "Invalid uid format.");
  }
  const hmacKey = await getHmacKey(env);
  const now = nowSec ?? Math.floor(Date.now() / 1000);
  const origIat = typeof orig_iat === "number" && Number.isFinite(orig_iat) ? Math.floor(orig_iat) : now;
  const exp = now + SESSION_TTL_SEC;

  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    iss: SESSION_ISS,
    aud: SESSION_AUD,
    uid,
    v: getSessionVersion(env),
    iat: now,
    orig_iat: origIat,
    exp,
    name: sanitizeName(name),
    picture: sanitizePicture(picture),
  };

  const headerB64 = base64UrlEncodeBytes(textEncoder.encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncodeBytes(textEncoder.encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const sigBuf = await crypto.subtle.sign("HMAC", hmacKey, textEncoder.encode(signingInput));
  const sigB64 = base64UrlEncodeBytes(new Uint8Array(sigBuf));

  return {
    token: `${signingInput}.${sigB64}`,
    payload,
  };
}

/**
 * Verify an HS256 session JWT in constant time.
 */
export async function verifySessionToken(token, env, nowSec) {
  // Always fail closed if SESSION_SECRET is misconfigured.
  const hmacKey = await getHmacKey(env);

  const parts = splitStrictJwt(token);
  const header = decodeJsonSegment(parts[0]);
  const payload = decodeJsonSegment(parts[1]);

  if (header.alg !== "HS256" || header.typ !== "JWT") {
    throw new AuthError(401, "invalid_session", "Invalid session JWT header.");
  }

  const sigBytes = base64UrlDecodeToBytes(parts[2]);
  const signingInput = textEncoder.encode(`${parts[0]}.${parts[1]}`);
  const validSig = await crypto.subtle.verify("HMAC", hmacKey, sigBytes, signingInput);
  if (!validSig) {
    throw new AuthError(401, "invalid_session", "Invalid session signature.");
  }

  const now = nowSec ?? Math.floor(Date.now() / 1000);
  if (payload.iss !== SESSION_ISS || payload.aud !== SESSION_AUD) {
    throw new AuthError(401, "invalid_session", "Invalid session issuer or audience.");
  }
  if (payload.v !== getSessionVersion(env)) {
    throw new AuthError(401, "session_revoked", "Session version mismatch.");
  }
  if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp) || payload.exp <= now) {
    throw new AuthError(401, "session_expired", "Session expired.");
  }
  if (typeof payload.iat !== "number" || !Number.isFinite(payload.iat)) {
    throw new AuthError(401, "invalid_session", "Invalid session iat.");
  }
  if (typeof payload.orig_iat !== "number" || !Number.isFinite(payload.orig_iat)) {
    throw new AuthError(401, "invalid_session", "Invalid session orig_iat.");
  }
  if (typeof payload.uid !== "string" || !UID_RE.test(payload.uid)) {
    throw new AuthError(401, "invalid_session", "Invalid session uid.");
  }

  return {
    uid: payload.uid,
    v: payload.v,
    iat: payload.iat,
    orig_iat: payload.orig_iat,
    exp: payload.exp,
    name: sanitizeName(payload.name),
    picture: sanitizePicture(payload.picture),
  };
}

/**
 * Sliding session refresh:
 * If remaining TTL < 7 days AND total session age since orig_iat < 90 days,
 * mint a fresh 30-day JWT preserving orig_iat.
 */
export async function maybeRefreshSession(session, env, nowSec) {
  const now = nowSec ?? Math.floor(Date.now() / 1000);
  if (
    session.exp - now < SESSION_REFRESH_THRESHOLD_SEC &&
    now - session.orig_iat < SESSION_MAX_LIFETIME_SEC
  ) {
    const minted = await mintSessionToken(
      {
        uid: session.uid,
        name: session.name,
        picture: session.picture,
        orig_iat: session.orig_iat,
      },
      env,
      now
    );
    return { token: minted.token, exp: minted.payload.exp };
  }
  return null;
}

/**
 * Compute HMAC rev_sig proving the client previously observed (uid, rev, content_hash).
 */
export async function signRev(uid, rev, contentHash, env) {
  const hmacKey = await getHmacKey(env);
  const message = `rev:v1:${uid}:${rev}:${contentHash}`;
  const sigBuf = await crypto.subtle.sign("HMAC", hmacKey, textEncoder.encode(message));
  return base64UrlEncodeBytes(new Uint8Array(sigBuf));
}

/**
 * Constant-time verify of HMAC rev_sig.
 */
export async function verifyRevSig(uid, rev, contentHash, revSig, env) {
  if (
    typeof uid !== "string" ||
    !UID_RE.test(uid) ||
    !Number.isInteger(rev) ||
    rev < 0 ||
    typeof contentHash !== "string" ||
    typeof revSig !== "string" ||
    !REV_SIG_RE.test(revSig)
  ) {
    return false;
  }
  const hmacKey = await getHmacKey(env);
  let sigBytes;
  try {
    sigBytes = base64UrlDecodeToBytes(revSig);
  } catch {
    return false;
  }
  const message = `rev:v1:${uid}:${rev}:${contentHash}`;
  return crypto.subtle.verify("HMAC", hmacKey, sigBytes, textEncoder.encode(message));
}

export function extractBearerToken(request) {
  const authHeader = request.headers.get("Authorization") || "";
  const match = /^Bearer\s+([^\s]+)$/i.exec(authHeader.trim());
  return match ? match[1] : null;
}

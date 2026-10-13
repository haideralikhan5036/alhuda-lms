/**
 * ============================================================================
 * AL-HUDA ISLAMIC CENTRE LMS — WORKER AUTH HELPERS
 * File: cloudflare/auth.js
 * Purpose: HMAC-SHA256 signed session tokens (Web Crypto) for the Cloudflare
 *          Worker. Used by cloudflare/worker.js for login sessions and for
 *          gating /api/db and /api/storage.
 *
 * TOKEN FORMAT:  base64url(JSON payload) + "." + base64url(HMAC-SHA256 signature)
 * PAYLOAD:       { sub, role, iat, exp } — 8-hour expiry from issue time.
 *
 * REQUIRED ENV VARS (set with `wrangler secret put <NAME>` — never in code):
 *   WORKER_AUTH_SECRET  - Random 32+ byte secret used to HMAC-sign tokens.
 *                         Generate:  openssl rand -base64 48
 *   OWNER_USERNAME      - Owner login username (plaintext env var is fine).
 *   OWNER_PASSWORD_HASH - SHA-256 hex digest of the owner password.
 *                         NEVER store the plaintext password anywhere.
 *                         Generate:  echo -n 'your-strong-password' | sha256sum
 *   ALLOWED_ORIGINS     - Comma-separated list of allowed browser origins for
 *                         CORS (e.g. https://lms.example.com).
 * ============================================================================
 */

const te = new TextEncoder();
const SESSION_TTL_SECONDS = 8 * 60 * 60; // 8 hours

function base64UrlEncode(bytes) {
  let bin = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str) {
  let b64 = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4;
  if (pad) b64 += '='.repeat(4 - pad);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importHmacKey(secret) {
  if (!secret) throw new Error('WORKER_AUTH_SECRET is not configured');
  return crypto.subtle.importKey(
    'raw',
    te.encode(String(secret)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

// Constant-time byte comparison: no early exit on the first mismatch, so
// comparison time does not leak how many leading bytes matched.
export function constantTimeEqualBytes(a, b) {
  const x = a instanceof Uint8Array ? a : new Uint8Array(a || []);
  const y = b instanceof Uint8Array ? b : new Uint8Array(b || []);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', te.encode(String(text)));
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

// Create a signed session token. `payload` must carry { sub, role }.
// iat/exp are set here; tokens live SESSION_TTL_SECONDS (8h).
export async function createSessionToken(payload, secret) {
  const now = Math.floor(Date.now() / 1000);
  const full = {
    sub: String(payload.sub),
    role: String(payload.role),
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
  };
  const payloadB64 = base64UrlEncode(te.encode(JSON.stringify(full)));
  const key = await importHmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, te.encode(payloadB64));
  return payloadB64 + '.' + base64UrlEncode(sig);
}

// Verify a token. Returns the decoded payload on success, or null on ANY
// failure (bad shape, bad signature, expired token, missing secret).
// Fails closed: when in doubt, no access.
export async function verifySessionToken(token, secret) {
  try {
    if (typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
    const [payloadB64, sigB64] = parts;

    const key = await importHmacKey(secret);
    const expectedSig = await crypto.subtle.sign('HMAC', key, te.encode(payloadB64));
    const providedSig = base64UrlDecode(sigB64);
    if (!constantTimeEqualBytes(new Uint8Array(expectedSig), providedSig)) return null;

    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadB64)));
    if (!payload || typeof payload.exp !== 'number') return null;
    if (typeof payload.role !== 'string' || typeof payload.sub !== 'string') return null;
    const now = Math.floor(Date.now() / 1000);
    if (now >= payload.exp) return null; // expired
    if (payload.iat && now < payload.iat - 60) return null; // issued in the future (60s clock-skew tolerance)
    return payload;
  } catch (e) {
    return null;
  }
}

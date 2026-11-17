/**
 * ============================================================================
 * AL-HUDA ISLAMIC CENTRE LMS — CLOUDFLARE R2 FILE STORAGE ENGINE
 * File: functions/api/storage.js
 * Purpose: Handles uploading and serving Teacher Documents, Fee Receipts,
 *          Certificates, and Syllabus PDFs via Cloudflare R2 Object Storage.
 *
 * Security hardening (2026-10-14):
 *  - CORS restricted to an allowlist via env.ALLOWED_ORIGINS (comma-separated).
 *  - Uploads limited to a MIME allowlist (JPEG/PNG/WebP/PDF) verified by
 *    magic-byte sniffing — the client-supplied mimeType is IGNORED.
 *  - 10 MB upload cap (configurable via env.MAX_UPLOAD_BYTES).
 *  - Downloads served as attachments with no public caching, so uploaded
 *    content can never execute inline in the portal's origin.
 *  - Internal error details never leave the server (generic 500 responses).
 *  - Batch 7 Part B: onRequest refuses any call without the Worker's
 *    in-process __lmsInternal marker (403 before any bucket access or
 *    data path), so a standalone Cloudflare Pages deploy cannot expose
 *    this engine. OPTIONS preflights (headers only, no data) are carved
 *    out explicitly.
 *  - Course-book deletion (2026-11-06): DELETE removes ONE object and is
 *    scoped to the course_material/ prefix in this engine; the Worker
 *    admits it for the owner role only. R2 deletes are idempotent.
 * ============================================================================
 */

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf'
]);

const DEFAULT_MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Build CORS headers from an explicit allowlist.
 * env.ALLOWED_ORIGINS: comma-separated list of exact origins.
 * If unset or empty, cross-origin requests receive no ACAO header (denied).
 * Authorization is kept in allowed headers for bearer-token auth handled
 * upstream (cloudflare/worker.js).
 */
function buildCorsHeaders(request, env) {
  const raw = String((env && env.ALLOWED_ORIGINS) || '').trim();
  const allowed = raw.split(',').map(s => s.trim()).filter(Boolean);
  const origin = request.headers.get('Origin') || '';

  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };

  if (origin && allowed.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }

  return headers;
}

/**
 * Identify the real content type from magic bytes.
 * Returns the MIME string or null when unknown/unsupported.
 * Client-supplied mimeType values are never trusted.
 */
function sniffMimeType(bytes) {
  if (!(bytes instanceof Uint8Array)) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return 'image/png';
  }

  // JPEG: FF D8 FF
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }

  // WebP: RIFF .... WEBP
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return 'image/webp';
  }

  // PDF: %PDF
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46
  ) {
    return 'application/pdf';
  }

  return null;
}

function jsonResponse(obj, status, corsHeaders) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

function sanitizeFileName(name) {
  return String(name || 'document').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'document';
}

function sanitizeFolder(folder) {
  return String(folder || 'uploads').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60) || 'uploads';
}

export async function onRequest(context) {
  const { request, env } = context;
  const corsHeaders = buildCorsHeaders(request, env);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Batch 7 Part B: internal-invocation guard. This engine has no auth of
  // its own: it is safe ONLY behind the Worker, which delegates in-process
  // and stamps context.__lmsInternal (see cloudflare/worker.js). A remote
  // caller on a standalone Cloudflare Pages deploy can never set that
  // property (Pages builds context from the HTTP request), so any direct
  // call fails closed here with 403 — BEFORE any bucket access or data
  // path. The OPTIONS carve-out above returns headers only and never
  // touches data, so it stays exempt. Do NOT replace this with a header
  // check (any HTTP caller can send any header) and do NOT invent a
  // shared env secret for it.
  if (!context.__lmsInternal) {
    return jsonResponse(
      { ok: false, error: 'Forbidden' },
      403,
      corsHeaders
    );
  }

  const bucket = env.STORAGE || env.ALHUDA_STORAGE;
  const url = new URL(request.url);

  // GET /api/storage?key=folder/filename.ext -> Serve file from Cloudflare R2
  if (request.method === 'GET') {
    const key = url.searchParams.get('key');
    if (!key) {
      return jsonResponse(
        { ok: true, r2_bound: Boolean(bucket), engine: 'Cloudflare R2 Storage' },
        200,
        corsHeaders
      );
    }

    if (!bucket) {
      return new Response('R2 Storage bucket not bound yet', { status: 503, headers: corsHeaders });
    }

    try {
      const obj = await bucket.get(key);
      if (!obj) {
        return new Response('File not found', { status: 404, headers: corsHeaders });
      }

      const headers = new Headers(corsHeaders);
      // Serve only the content type that was verified at upload time.
      const storedType = obj.httpMetadata && obj.httpMetadata.contentType;
      headers.set('Content-Type', ALLOWED_MIME_TYPES.has(storedType) ? storedType : 'application/octet-stream');
      headers.set('etag', obj.httpEtag);
      // Force download: uploaded content must never execute inline in the
      // portal's origin (stored-XSS mitigation).
      const downloadName = sanitizeFileName(String(key).split('/').pop());
      headers.set('Content-Disposition', `attachment; filename="${downloadName}"`);
      // Never cache user-uploaded content publicly.
      headers.set('Cache-Control', 'private, no-store');
      return new Response(obj.body, { status: 200, headers });
    } catch (err) {
      console.error('[storage-api] download failed:', err);
      return new Response('internal_error', { status: 500, headers: corsHeaders });
    }
  }

  // POST /api/storage -> Upload file (JSON base64 or multipart FormData) to Cloudflare R2
  if (request.method === 'POST') {
    if (!bucket) {
      return jsonResponse(
        { ok: false, r2_bound: false, error: 'Cloudflare R2 bucket (STORAGE) not bound yet' },
        503,
        corsHeaders
      );
    }

    const maxBytes = parseInt(env.MAX_UPLOAD_BYTES, 10) || DEFAULT_MAX_UPLOAD_BYTES;

    try {
      const contentType = request.headers.get('Content-Type') || '';
      let key = '';
      let bytes = null;

      if (contentType.includes('multipart/form-data')) {
        const formData = await request.formData();
        const file = formData.get('file');
        if (!file) {
          return jsonResponse({ ok: false, error: 'no_file_provided' }, 400, corsHeaders);
        }
        const folder = sanitizeFolder(formData.get('folder'));
        const safeName = sanitizeFileName(file.name);
        key = `${folder}/${Date.now()}_${safeName}`;
        bytes = new Uint8Array(await file.arrayBuffer());
      } else {
        const body = await request.json();
        const folder = sanitizeFolder(body.folder);
        const safeName = sanitizeFileName(body.filename);
        key = `${folder}/${Date.now()}_${safeName}`;

        const base64Data = String(body.dataUrl || body.base64 || '').replace(/^data:[^;]+;base64,/, '');
        const binaryStr = atob(base64Data);
        bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }
      }

      // Size cap.
      if (bytes.byteLength > maxBytes) {
        return jsonResponse({ ok: false, error: 'file_too_large' }, 400, corsHeaders);
      }

      // Verify the real file type from magic bytes. The client-supplied
      // mimeType (file.type / body.mimeType) is intentionally IGNORED.
      const detected = sniffMimeType(bytes);
      if (!detected || !ALLOWED_MIME_TYPES.has(detected)) {
        return jsonResponse({ ok: false, error: 'unsupported_file_type' }, 400, corsHeaders);
      }

      await bucket.put(key, bytes.buffer, {
        httpMetadata: { contentType: detected }
      });

      const publicUrl = `/api/storage?key=${encodeURIComponent(key)}`;
      return jsonResponse({ ok: true, key, url: publicUrl }, 200, corsHeaders);
    } catch (err) {
      console.error('[storage-api] upload failed:', err);
      return jsonResponse({ ok: false, error: 'internal_error' }, 500, corsHeaders);
    }
  }

  // DELETE /api/storage?key=course_material/<file> -> Permanently remove an
  // object from Cloudflare R2 (added 2026-11-06 for course-book deletion).
  // Authorization is enforced upstream in cloudflare/worker.js
  // (handleScopedStorageRequest admits the OWNER role only); the
  // course_material/ prefix scope is enforced HERE as well, so this engine
  // can never serve as a general-purpose object delete even if a future
  // caller reaches it directly. R2 deletes are idempotent — removing a
  // key that does not exist succeeds — so a retried book deletion whose
  // first attempt partially completed is safe to run again.
  if (request.method === 'DELETE') {
    const key = url.searchParams.get('key');
    if (!key) {
      return jsonResponse({ ok: false, error: 'key_required' }, 400, corsHeaders);
    }
    if (!key.startsWith('course_material/')) {
      return jsonResponse({ ok: false, error: 'key_out_of_scope' }, 403, corsHeaders);
    }
    if (!bucket) {
      return jsonResponse(
        { ok: false, r2_bound: false, error: 'Cloudflare R2 bucket (STORAGE) not bound yet' },
        503,
        corsHeaders
      );
    }
    try {
      await bucket.delete(key);
      return jsonResponse({ ok: true, key, deleted: true }, 200, corsHeaders);
    } catch (err) {
      console.error('[storage-api] delete failed:', err);
      return jsonResponse({ ok: false, error: 'internal_error' }, 500, corsHeaders);
    }
  }

  return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
}

// ============================================================================
// FEE PDF DOCUMENTS (2026-11-17, Fee Upgrade Phase 5) — POST /api/fee-documents
// (routed + role-gated in cloudflare/worker.js; this engine only ever runs
// behind that gate, see the __lmsInternal check below, exactly like
// onRequest above).
//
// Every generated Official Receipt PDF and Fee Due Invoice PDF is ALSO
// stored in R2 under a DETERMINISTIC key so a re-upload of the same
// receipt overwrites the same object (idempotent — no duplicates, no
// timestamped copies):
//   fee-documents/receipts/<receiptNo>.pdf
//   fee-documents/due-invoices/<DUE-ref>.pdf
//
// Guards: owner/manager only (enforced in the Worker route AND here);
// PDF magic bytes only (client Content-Type is never trusted);
// 5 MB cap; the ref may only carry [A-Za-z0-9._-] (no slashes, so a key
// can never escape the fee-documents/ prefix). Download reuses the
// EXISTING GET /api/storage?key= read path — there is no second read
// endpoint. DELETE removes one fee-documents/ object (used by Undo
// Payment so an undone receipt leaves no stored PDF behind); R2 deletes
// are idempotent.
// ============================================================================
const FEE_DOC_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const FEE_DOC_PREFIX = 'fee-documents/';
const FEE_DOC_FOLDERS = { receipt: 'receipts', 'due-invoice': 'due-invoices' };
const FEE_DOC_REF_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;

function feeDocKeyFor(kind, ref) {
  const folder = FEE_DOC_FOLDERS[String(kind || '')];
  if (!folder) return null;
  if (!FEE_DOC_REF_RE.test(String(ref || ''))) return null;
  return FEE_DOC_PREFIX + folder + '/' + String(ref) + '.pdf';
}

export async function onFeeDocumentRequest(context, auth) {
  const { request, env } = context;
  const corsHeaders = buildCorsHeaders(request, env);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Same internal-invocation guard as onRequest above: this engine has
  // no auth of its own and is safe ONLY behind the Worker.
  if (!context.__lmsInternal) {
    return jsonResponse({ ok: false, error: 'Forbidden' }, 403, corsHeaders);
  }

  // Owner + manager only. Teachers/parents (and any other role) get a
  // flat 403 here; anonymous callers never reach this handler (the
  // Worker route answers 401 first).
  const role = auth && auth.role;
  if (role !== 'owner' && role !== 'manager') {
    return jsonResponse({ ok: false, error: 'Access denied.' }, 403, corsHeaders);
  }

  const bucket = env.STORAGE || env.ALHUDA_STORAGE;
  const url = new URL(request.url);

  // POST /api/fee-documents { kind, ref, base64 } -> store one PDF.
  if (request.method === 'POST') {
    if (!bucket) {
      return jsonResponse(
        { ok: false, r2_bound: false, error: 'Cloudflare R2 bucket (STORAGE) not bound yet' },
        503,
        corsHeaders
      );
    }
    let body = {};
    try {
      body = await request.json();
    } catch (e) {
      return jsonResponse({ ok: false, error: 'bad_json' }, 400, corsHeaders);
    }
    const key = feeDocKeyFor(body.kind, body.ref);
    if (!key) {
      const badKind = !Object.prototype.hasOwnProperty.call(FEE_DOC_FOLDERS, String((body && body.kind) || ''));
      return jsonResponse({ ok: false, error: badKind ? 'bad_kind' : 'bad_ref' }, 400, corsHeaders);
    }
    const raw = String(body.base64 || '').replace(/^data:[^;]+;base64,/, '');
    if (!raw) {
      return jsonResponse({ ok: false, error: 'empty_file' }, 400, corsHeaders);
    }
    let bytes = null;
    try {
      const binaryStr = atob(raw);
      bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
    } catch (e) {
      return jsonResponse({ ok: false, error: 'bad_base64' }, 400, corsHeaders);
    }
    if (bytes.byteLength > FEE_DOC_MAX_BYTES) {
      return jsonResponse({ ok: false, error: 'file_too_large' }, 400, corsHeaders);
    }
    // Magic-byte check: only a real PDF is stored, whatever the client claimed.
    if (sniffMimeType(bytes) !== 'application/pdf') {
      return jsonResponse({ ok: false, error: 'unsupported_file_type' }, 400, corsHeaders);
    }
    try {
      // Same ref re-uploaded = same key overwritten (idempotent).
      await bucket.put(key, bytes.buffer, {
        httpMetadata: { contentType: 'application/pdf' }
      });
    } catch (err) {
      console.error('[fee-documents] upload failed:', err);
      return jsonResponse({ ok: false, error: 'internal_error' }, 500, corsHeaders);
    }
    return jsonResponse(
      { ok: true, key, url: '/api/storage?key=' + encodeURIComponent(key) },
      200,
      corsHeaders
    );
  }

  // DELETE /api/fee-documents?key=fee-documents/... -> remove one stored PDF.
  if (request.method === 'DELETE') {
    const key = url.searchParams.get('key');
    if (!key) {
      return jsonResponse({ ok: false, error: 'key_required' }, 400, corsHeaders);
    }
    if (!key.startsWith(FEE_DOC_PREFIX) || !key.endsWith('.pdf')) {
      return jsonResponse({ ok: false, error: 'key_out_of_scope' }, 403, corsHeaders);
    }
    if (!bucket) {
      return jsonResponse(
        { ok: false, r2_bound: false, error: 'Cloudflare R2 bucket (STORAGE) not bound yet' },
        503,
        corsHeaders
      );
    }
    try {
      await bucket.delete(key);
      return jsonResponse({ ok: true, key, deleted: true }, 200, corsHeaders);
    } catch (err) {
      console.error('[fee-documents] delete failed:', err);
      return jsonResponse({ ok: false, error: 'internal_error' }, 500, corsHeaders);
    }
  }

  return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
}

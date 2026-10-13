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
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

  return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
}

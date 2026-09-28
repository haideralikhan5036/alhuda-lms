/**
 * ============================================================================
 * AL-HUDA ISLAMIC CENTRE LMS — CLOUDFLARE R2 FILE STORAGE ENGINE
 * File: functions/api/storage.js
 * Purpose: Handles uploading and serving Teacher Documents, Fee Receipts,
 *          Certificates, and Syllabus PDFs via Cloudflare R2 Object Storage.
 * ============================================================================
 */

export async function onRequest(context) {
  const { request, env } = context;
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const bucket = env.STORAGE || env.ALHUDA_STORAGE;
  const url = new URL(request.url);

  // GET /api/storage?key=folder/filename.ext -> Serve file from Cloudflare R2
  if (request.method === 'GET') {
    const key = url.searchParams.get('key');
    if (!key) {
      return new Response(
        JSON.stringify({ ok: true, r2_bound: Boolean(bucket), engine: 'Cloudflare R2 Storage' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!bucket) {
      return new Response('R2 Storage bucket not bound yet', { status: 503, headers: corsHeaders });
    }

    const obj = await bucket.get(key);
    if (!obj) {
      return new Response('File not found', { status: 404, headers: corsHeaders });
    }

    const headers = new Headers(corsHeaders);
    obj.writeHttpMetadata(headers);
    headers.set('etag', obj.httpEtag);
    headers.set('Cache-Control', 'public, max-age=31536000');
    return new Response(obj.body, { status: 200, headers });
  }

  // POST /api/storage -> Upload file (JSON base64 or multipart FormData) to Cloudflare R2
  if (request.method === 'POST') {
    if (!bucket) {
      return new Response(
        JSON.stringify({ ok: false, r2_bound: false, error: 'Cloudflare R2 bucket (STORAGE) not bound yet' }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    try {
      const contentType = request.headers.get('Content-Type') || '';
      let key = '';
      let fileBuffer = null;
      let mimeType = 'application/octet-stream';

      if (contentType.includes('multipart/form-data')) {
        const formData = await request.formData();
        const file = formData.get('file');
        const folder = String(formData.get('folder') || 'uploads').replace(/[^a-zA-Z0-9_-]/g, '');
        if (!file) throw new Error('No file provided');
        const safeName = String(file.name || 'document').replace(/[^a-zA-Z0-9._-]/g, '_');
        key = `${folder}/${Date.now()}_${safeName}`;
        mimeType = file.type || mimeType;
        fileBuffer = await file.arrayBuffer();
      } else {
        const body = await request.json();
        const folder = String(body.folder || 'uploads').replace(/[^a-zA-Z0-9_-]/g, '');
        const safeName = String(body.filename || 'document.bin').replace(/[^a-zA-Z0-9._-]/g, '_');
        key = `${folder}/${Date.now()}_${safeName}`;
        mimeType = body.mimeType || mimeType;

        const base64Data = String(body.dataUrl || body.base64 || '').replace(/^data:[^;]+;base64,/, '');
        const binaryStr = atob(base64Data);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }
        fileBuffer = bytes.buffer;
      }

      await bucket.put(key, fileBuffer, {
        httpMetadata: { contentType: mimeType }
      });

      const publicUrl = `/api/storage?key=${encodeURIComponent(key)}`;
      return new Response(
        JSON.stringify({ ok: true, key, url: publicUrl }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } catch (err) {
      return new Response(
        JSON.stringify({ ok: false, error: err.message || String(err) }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  }

  return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
}

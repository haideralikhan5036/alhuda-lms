// ============================================================================
// FEE UPGRADE PHASE 5 — PDF STORAGE IN R2 (#71)
// Every generated Official Receipt PDF and Fee Due Invoice PDF is ALSO
// uploaded to the Cloudflare R2 bucket under a deterministic key, so it
// can be opened later from any device:
//
//   fee-documents/receipts/<receiptNo>.pdf
//   fee-documents/due-invoices/<DUE-ref>.pdf
//
// The record carries the key as `pdfKey` (family notes fee_history is the
// source of truth for receipts; the payments table carries it in
// legacy_json + receipt_url). A record whose upload failed carries
// `pdfPending: true` (local-only flag, same convention as
// cloudSyncPending) and the Receipts tab offers a retry via the voucher.
//
// GRACEFUL DEGRADATION: the Vercel frontend deploys BEFORE the owner
// deploys the Worker. Every upload/delete/open helper below FAILS SOFT —
// it returns { ok: false, ... } and NEVER throws — so a 404 from a
// not-yet-deployed Worker can never block a local PDF download.
//
// Download reuses the EXISTING GET /api/storage?key= read path (Bearer
// token required); there is no second read endpoint.
// ============================================================================
(function () {
  'use strict';

  var WORKER_ORIGIN = 'https://alhuda-lms.ceoislamiccentre.workers.dev';
  var FEE_DOC_PREFIX = 'fee-documents/';
  var FEE_PDF_MAX_BYTES = 5 * 1024 * 1024; // 5 MB — same cap as the Worker
  var FEE_DOC_FOLDERS = { receipt: 'receipts', 'due-invoice': 'due-invoices' };
  var FEE_DOC_REF_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Deterministic R2 key for one fee PDF, or null when the kind/ref is
  // not a fee document reference (no slashes allowed — a key can never
  // escape the fee-documents/ prefix).
  function feePdfKeyFor(kind, ref) {
    var folder = FEE_DOC_FOLDERS[String(kind || '')];
    if (!folder) return null;
    if (!FEE_DOC_REF_RE.test(String(ref || ''))) return null;
    return FEE_DOC_PREFIX + folder + '/' + String(ref) + '.pdf';
  }

  // 'receipt' | 'due-invoice' | null — which kind of fee PDF a key is.
  function feePdfKindOfKey(key) {
    var k = String(key || '');
    if (k.indexOf(FEE_DOC_PREFIX + 'receipts/') === 0 && k.slice(-4) === '.pdf') return 'receipt';
    if (k.indexOf(FEE_DOC_PREFIX + 'due-invoices/') === 0 && k.slice(-4) === '.pdf') return 'due-invoice';
    return null;
  }

  function isFeePdfKey(key) {
    return feePdfKindOfKey(key) !== null;
  }

  // True when the bytes start with the PDF magic header (%PDF).
  function isPdfBytes(bytes) {
    if (!bytes || typeof bytes.length !== 'number' || bytes.length < 4) return false;
    return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
  }

  // Uint8Array -> base64, in 32 KB chunks (a single btoa() over megabytes
  // would blow the argument stack).
  function bytesToBase64(bytes) {
    var bin = '';
    var CHUNK = 0x8000;
    for (var i = 0; i < bytes.length; i += CHUNK) {
      var slice = bytes.subarray(i, i + CHUNK);
      bin += String.fromCharCode.apply(null, slice);
    }
    return btoa(bin);
  }

  // base64 (optionally data:application/pdf;base64, prefixed) -> Uint8Array.
  function base64ToBytes(b64) {
    var raw = String(b64 || '').replace(/^data:[^;]+;base64,/, '');
    if (!raw) return new Uint8Array(0);
    var bin = atob(raw);
    var bytes = new Uint8Array(bin.length);
    for (var j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j);
    return bytes;
  }

  // Same base rule as js/lesson-history.js apiBase(): an explicit
  // CLOUDFLARE_API_BASE_URL wins, a workers.dev origin uses a relative
  // path, everything else uses the production Worker origin.
  function feePdfApiBase() {
    try {
      if (typeof window !== 'undefined' && window.CLOUDFLARE_API_BASE_URL) {
        return String(window.CLOUDFLARE_API_BASE_URL).replace(/\/+$/, '');
      }
      if (typeof window !== 'undefined' && window.location && window.location.hostname &&
          String(window.location.hostname).endsWith('.workers.dev')) {
        return '';
      }
    } catch (e) { /* fall through to the default origin */ }
    return WORKER_ORIGIN;
  }

  // The existing storage read URL for a stored fee PDF.
  function storedFeePdfUrl(apiBase, key) {
    return String(apiBase || '') + '/api/storage?key=' + encodeURIComponent(String(key || ''));
  }

  // 'stored' | 'pending' | 'none' — what the Receipts / Due Invoices
  // list should show for one record.
  function feePdfStatus(record) {
    if (!record) return 'none';
    if (record.pdfKey && isFeePdfKey(record.pdfKey)) return 'stored';
    if (record.pdfPending) return 'pending';
    return 'none';
  }

  function receiptPdfStatus(record) {
    return feePdfStatus(record);
  }

  // Copy of the record with the stored key attached (and any pending
  // flag cleared). Never mutates the input.
  function withPdfKey(record, key) {
    var out = {};
    var src = record || {};
    for (var k in src) {
      if (Object.prototype.hasOwnProperty.call(src, k)) out[k] = src[k];
    }
    out.pdfKey = key;
    delete out.pdfPending;
    return out;
  }

  // Copy of the record marked "cloud save failed — retry on next
  // download". The flag is local-only (like cloudSyncPending): it is
  // stripped from the cloud copy by the sync path's own rules.
  function withPdfPending(record) {
    var out = {};
    var src = record || {};
    for (var k in src) {
      if (Object.prototype.hasOwnProperty.call(src, k)) out[k] = src[k];
    }
    delete out.pdfKey;
    out.pdfPending = true;
    return out;
  }

  // Upload one generated PDF. NEVER throws: every failure mode returns
  // { ok: false, error } so the caller can still hand the user the
  // local download and mark the record pdfPending. A 404 here is the
  // normal pre-deploy state (Worker not yet deployed) — not an error
  // the user must ever see as a crash.
  async function uploadFeePdf(fetchImpl, apiBase, authHeaders, kind, ref, bytes) {
    try {
      var key = feePdfKeyFor(kind, ref);
      if (!key) return { ok: false, error: 'bad_ref' };
      if (!bytes || typeof bytes.length !== 'number' || bytes.length === 0) {
        return { ok: false, error: 'empty_file' };
      }
      if (bytes.length > FEE_PDF_MAX_BYTES) return { ok: false, error: 'file_too_large' };
      if (!isPdfBytes(bytes)) return { ok: false, error: 'not_a_pdf' };
      if (typeof fetchImpl !== 'function') return { ok: false, error: 'no_fetch' };
      var res = await fetchImpl(String(apiBase || '') + '/api/fee-documents', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders || {}),
        body: JSON.stringify({ kind: kind, ref: ref, base64: bytesToBase64(bytes) })
      });
      var json = null;
      try { json = await res.json(); } catch (e) { json = null; }
      if (res.ok && json && json.ok && json.key) {
        return { ok: true, key: json.key, url: json.url || storedFeePdfUrl(apiBase, json.key) };
      }
      return { ok: false, error: (json && json.error) || 'upload_failed', status: res.status };
    } catch (e) {
      return { ok: false, error: 'network_error' };
    }
  }

  // Remove one stored fee PDF (Undo Payment). Idempotent server-side;
  // a missing key still succeeds. NEVER throws.
  async function deleteFeePdf(fetchImpl, apiBase, authHeaders, key) {
    try {
      if (!isFeePdfKey(key)) return { ok: false, error: 'bad_key' };
      if (typeof fetchImpl !== 'function') return { ok: false, error: 'no_fetch' };
      var res = await fetchImpl(
        String(apiBase || '') + '/api/fee-documents?key=' + encodeURIComponent(String(key)),
        { method: 'DELETE', headers: Object.assign({}, authHeaders || {}) }
      );
      var json = null;
      try { json = await res.json(); } catch (e) { json = null; }
      if (res.ok && json && json.ok) return { ok: true, key: key };
      return { ok: false, error: (json && json.error) || 'delete_failed', status: res.status };
    } catch (e) {
      return { ok: false, error: 'network_error' };
    }
  }

  // Open a stored fee PDF in a new tab. Fetches the bytes with the
  // session token (a plain window.open would carry no Authorization
  // header and get a 401), then opens a blob URL. When the popup is
  // blocked, falls back to a download link. `env` is injectable for
  // tests ({ window, document, URL }); it defaults to the globals.
  // NEVER throws — returns { ok: false, error } instead.
  async function openStoredFeePdf(fetchImpl, apiBase, authHeaders, key, env) {
    try {
      if (!isFeePdfKey(key)) return { ok: false, error: 'bad_key' };
      if (typeof fetchImpl !== 'function') return { ok: false, error: 'no_fetch' };
      var g = env || {};
      var win = g.window || (typeof window !== 'undefined' ? window : null);
      var doc = g.document || (typeof document !== 'undefined' ? document : null);
      var urlApi = g.URL || (typeof URL !== 'undefined' ? URL : null);
      if (!win || !doc || !urlApi || typeof urlApi.createObjectURL !== 'function') {
        return { ok: false, error: 'unavailable' };
      }
      var res = await fetchImpl(storedFeePdfUrl(apiBase, key), {
        method: 'GET',
        headers: Object.assign({}, authHeaders || {})
      });
      if (!res.ok) {
        return { ok: false, error: 'Could not open the stored PDF (HTTP ' + res.status + ').' };
      }
      var blob = await res.blob();
      var blobUrl = urlApi.createObjectURL(blob);
      var opened = null;
      try { opened = win.open(blobUrl, '_blank'); } catch (e) { opened = null; }
      if (!opened) {
        // Popup blocked — fall back to a download link click.
        var a = doc.createElement('a');
        a.href = blobUrl;
        a.download = String(key).split('/').pop() || 'fee-document.pdf';
        a.target = '_blank';
        if (doc.body && doc.body.appendChild) doc.body.appendChild(a);
        if (typeof a.click === 'function') a.click();
        if (doc.body && doc.body.removeChild) doc.body.removeChild(a);
      }
      return { ok: true, key: key };
    } catch (e) {
      return { ok: false, error: 'network_error' };
    }
  }

  if (typeof window !== 'undefined') {
    window.FeePhase5 = {
      WORKER_ORIGIN: WORKER_ORIGIN,
      FEE_DOC_PREFIX: FEE_DOC_PREFIX,
      FEE_PDF_MAX_BYTES: FEE_PDF_MAX_BYTES,
      esc: esc,
      feePdfKeyFor: feePdfKeyFor,
      feePdfKindOfKey: feePdfKindOfKey,
      isFeePdfKey: isFeePdfKey,
      isPdfBytes: isPdfBytes,
      bytesToBase64: bytesToBase64,
      base64ToBytes: base64ToBytes,
      feePdfApiBase: feePdfApiBase,
      storedFeePdfUrl: storedFeePdfUrl,
      feePdfStatus: feePdfStatus,
      receiptPdfStatus: receiptPdfStatus,
      withPdfKey: withPdfKey,
      withPdfPending: withPdfPending,
      uploadFeePdf: uploadFeePdf,
      deleteFeePdf: deleteFeePdf,
      openStoredFeePdf: openStoredFeePdf
    };
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = (typeof window !== 'undefined') ? window.FeePhase5 : {};
  }
})();

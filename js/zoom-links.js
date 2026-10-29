// Shared Zoom meeting-link validation (Phase 3, advance/Zoom commission).
// Loaded by index.html (admin) and teacher.html (teacher portal) BEFORE
// the feature modules that save links, so every save point uses the
// same rule. No other page saves a Zoom link (manager.html has no
// teacher-link editor; parent.html only reads links).
//
// Rule (save time only — already-stored values are NEVER re-validated
// or rewritten by this module; read-time resolution keeps accepting
// them, including scheme-less hosts, exactly as before):
//   - empty string: allowed (means "no link"); the caller decides
//     whether empty clears or preserves the stored value.
//   - a bare 8-11 digit meeting code: normalized to https://zoom.us/j/<code>
//     (matches the read-time normalizer in teacher.html).
//   - otherwise: must parse as https, hostname zoom.us or *.zoom.us,
//     and path /j/, /s/, /my/, or /w/. Anything else — non-https,
//     non-Zoom hosts, javascript:/data: URLs, malformed input — is
//     rejected with a plain-words error. Launch-time code keeps its
//     own https-only check as defence in depth.
(function () {
  const ZOOM_PATHS = ['/j/', '/s/', '/my/', '/w/'];

  function normalizeZoomInput(raw) {
    const value = String(raw == null ? '' : raw).trim();
    if (!value) return { ok: true, normalized: '', error: null };
    if (/^\d{8,11}$/.test(value)) {
      return { ok: true, normalized: 'https://zoom.us/j/' + value, error: null };
    }
    let url;
    try {
      url = new URL(value);
    } catch (e) {
      return { ok: false, normalized: '', error: 'That Zoom link is not a valid web address. Paste a full Zoom meeting link (https://zoom.us/j/…) or a meeting code.' };
    }
    if (url.protocol !== 'https:') {
      return { ok: false, normalized: '', error: 'A Zoom link must start with https:// — other link types are not accepted.' };
    }
    const host = url.hostname.toLowerCase();
    if (host !== 'zoom.us' && !host.endsWith('.zoom.us')) {
      return { ok: false, normalized: '', error: 'That link is not a Zoom meeting link. Paste a link from zoom.us.' };
    }
    const path = url.pathname || '/';
    if (!ZOOM_PATHS.some((p) => path === p || path.startsWith(p))) {
      return { ok: false, normalized: '', error: 'That Zoom link does not point to a meeting. Paste a meeting link (https://zoom.us/j/…).' };
    }
    return { ok: true, normalized: url.toString(), error: null };
  }

  function isValidZoomUrl(raw) {
    return normalizeZoomInput(raw).ok;
  }

  window.LmsZoomLinks = { normalizeZoomInput, isValidZoomUrl };
})();

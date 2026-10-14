/*
 * Al-Huda LMS — shared client-side output-encoding helpers.
 *
 * Purpose: defense-in-depth against stored/reflected XSS in the portal pages.
 * Every value interpolated into innerHTML, HTML attributes, or inline
 * event-handler code must pass through one of these helpers first.
 *
 * Load order: include with <script src="js/security.js"></script> BEFORE any
 * inline <script> block that calls these helpers.
 *
 * NOTE: these are output encoders only. They do not replace server-side
 * validation, authentication, or authorization.
 */
(function () {
  'use strict';

  /**
   * Escape a value for interpolation into HTML text content or into a
   * double-quoted HTML attribute value.
   * Encodes: & < > " ' `
   */
  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/`/g, '&#x60;');
  }

  /**
   * Escape a value for interpolation into a single-quoted JS string that
   * itself sits inside a double-quoted HTML event-handler attribute, e.g.
   *     onclick="openModal('${escapeJsAttr(name)}')"
   *
   * - HTML-escapes the attribute-boundary characters (& and ") so the
   *   attribute cannot be broken out of. The HTML parser decodes &quot;/&amp;
   *   before JS runs, so the callee still receives the exact original string.
   * - Backslash-escapes ' and \ so the JS string literal cannot be broken
   *   out of.
   * - Encodes < and > as a hardening measure against </script> sequences
   *   inside inline script blocks.
   */
  function escapeJsAttr(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'");
  }

  /**
   * Allow-list a book id before it is interpolated into inline handler code.
   * Returns the id unchanged when it matches ^[A-Za-z0-9_-]+$, otherwise
   * returns the supplied fallback.
   */
  function sanitizeBookId(id, fallback) {
    var v = String(id === null || id === undefined ? '' : id);
    return /^[A-Za-z0-9_-]+$/.test(v) ? v : (fallback || 'holy-quran-16-line');
  }

  window.escapeHtml = escapeHtml;
  window.escapeAttr = escapeHtml; // alias
  window.escapeJsAttr = escapeJsAttr;
  window.sanitizeBookId = sanitizeBookId;
})();

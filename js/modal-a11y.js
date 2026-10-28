/* ============================================================================
 * AL-HUDA LMS — Shared HTML-modal accessibility helper (Batch 3.6, audit P2-29)
 * Plain JS, no dependency. One system for every portal's HTML modals:
 *   - focus moves INTO the modal on open, and RETURNS to the opener on close
 *   - Tab is trapped inside the topmost open modal (Shift+Tab cycles back)
 *   - clicking the modal's own backdrop (the overlay itself) closes it
 * Deliberately NOT an Escape handler: index already closes modals on Escape
 * (js/navigation.js), teacher already does (its global Escape listener), and
 * the parent portal adds its own Escape listener for its registered modals.
 * Batch 8 ui-notify dialogs keep their own focus trap: this helper never
 * steals Tab when focus is inside a .lms-dialog.
 * Usage:
 *   ModalA11y.open(el, closeFn)   — register on open (closeFn closes it)
 *   ModalA11y.close(el)           — unregister on close (focus returns)
 *   ModalA11y.closeTop()          — close the topmost registered modal
 *   ModalA11y.watchAllModals(fn)  — MutationObserver: any div.fixed[id^="modal"]
 *                                   becoming visible auto-registers with
 *                                   closeFn = fn(el); hiding auto-unregisters.
 * Guarded for non-DOM/test environments.
 * ============================================================================ */
(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  var stack = []; // { el, closeFn, prev }
  var watched = []; // elements under MutationObserver
  var tabBound = false;
  var observer = null;

  function isFocusable(n) {
    if (!n || n.disabled) return false;
    var tag = (n.tagName || '').toLowerCase();
    if (tag === 'input' && n.type === 'hidden') return false;
    var cs = null;
    try { cs = window.getComputedStyle(n); } catch (e) { return false; }
    if (!cs || cs.display === 'none' || cs.visibility === 'hidden') return false;
    return true;
  }

  function focusables(el) {
    var out = [];
    var list = el.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    for (var i = 0; i < list.length; i++) {
      if (isFocusable(list[i])) out.push(list[i]);
    }
    return out;
  }

  function inNotifyDialog(node) {
    return !!(node && node.closest && node.closest('.lms-dialog'));
  }

  function onTab(e) {
    if (e.key !== 'Tab' || stack.length === 0) return;
    if (inNotifyDialog(e.target)) return; // Batch 8 dialog owns its trap
    var top = stack[stack.length - 1];
    var ae = document.activeElement;
    var list = focusables(top.el);
    if (!list.length) return;
    if (!ae || !top.el.contains(ae)) {
      // Focus escaped the modal (browser chrome, programmatic move) — pull back.
      e.preventDefault();
      list[0].focus();
      return;
    }
    var first = list[0];
    var last = list[list.length - 1];
    if (e.shiftKey && ae === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && ae === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function bindTab() {
    if (!tabBound) {
      document.addEventListener('keydown', onTab, true);
      tabBound = true;
    }
  }

  function unbindTab() {
    if (tabBound && stack.length === 0) {
      document.removeEventListener('keydown', onTab, true);
      tabBound = false;
    }
  }

  function onBackdrop(e) {
    if (e.target !== this) return; // clicks on the panel itself must not close
    var s = null;
    for (var i = 0; i < stack.length; i++) {
      if (stack[i].el === this) { s = stack[i]; break; }
    }
    if (s && s.closeFn) {
      try { s.closeFn(); } catch (err) { /* closing must never throw */ }
    }
  }

  function open(el, closeFn) {
    if (!el) return;
    for (var i = 0; i < stack.length; i++) {
      if (stack[i].el === el) return; // already tracked (observer + explicit)
    }
    var prev = document.activeElement;
    stack.push({ el: el, closeFn: closeFn || null, prev: prev });
    try {
      if (!el.hasAttribute('role')) el.setAttribute('role', 'dialog');
      if (!el.hasAttribute('aria-modal')) el.setAttribute('aria-modal', 'true');
    } catch (e) { /* attributes must never break the open */ }
    el.addEventListener('click', onBackdrop);
    var list = focusables(el);
    try {
      if (list.length > 0) {
        list[0].focus();
      } else {
        if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
        el.focus();
      }
    } catch (e) { /* focus must never break the open */ }
    bindTab();
  }

  function close(el) {
    if (!el) return;
    var idx = -1;
    for (var i = 0; i < stack.length; i++) {
      if (stack[i].el === el) { idx = i; break; }
    }
    if (idx < 0) return;
    var s = stack.splice(idx, 1)[0];
    try { el.removeEventListener('click', onBackdrop); } catch (e) {}
    try {
      if (s.prev && s.prev.focus && document.contains(s.prev)) s.prev.focus();
    } catch (e) { /* focus return must never throw */ }
    unbindTab();
  }

  function closeTop() {
    var s = stack[stack.length - 1];
    if (!s) return false;
    if (s.closeFn) {
      try { s.closeFn(); } catch (e) {}
    } else {
      close(s.el);
    }
    return true;
  }

  function watchAllModals(closeResolver) {
    if (typeof MutationObserver === 'undefined') return;
    var modals = document.querySelectorAll('div.fixed[id^="modal"]');
    if (!modals.length) return;
    if (!observer) {
      observer = new MutationObserver(function (mutations) {
        for (var m = 0; m < mutations.length; m++) {
          var target = mutations[m].target;
          if (!target || !target.id) continue;
          var visible = !target.classList.contains('hidden');
          if (visible) {
            var fn = null;
            try { fn = closeResolver ? closeResolver(target) : null; } catch (e) { fn = null; }
            open(target, fn);
          } else {
            close(target);
          }
        }
      });
    }
    for (var i = 0; i < modals.length; i++) {
      var el = modals[i];
      var seen = false;
      for (var j = 0; j < watched.length; j++) {
        if (watched[j] === el) { seen = true; break; }
      }
      if (seen) continue;
      watched.push(el);
      observer.observe(el, { attributes: true, attributeFilter: ['class'] });
    }
  }

  window.ModalA11y = {
    open: open,
    close: close,
    closeTop: closeTop,
    watchAllModals: watchAllModals
  };
})();

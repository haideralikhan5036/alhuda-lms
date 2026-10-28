/**
 * Al-Huda LMS — ONE shared notification system (Batch 8).
 *
 * Standalone: no dependency on js/config.js, Tailwind, or Font Awesome, so
 * every portal (index, teacher, parent, manager, tool pages) can load it
 * directly. It replaces ALL native browser popups:
 *   - Toasts for success / error / warning / info messages.
 *   - A Promise-based confirm dialog (replaces confirm()).
 *   - A Promise-based input dialog (replaces prompt()).
 *   - A read-carefully dialog (one-time password display, long notices).
 *
 * Public API (all on window):
 *   window.lmsNotify(message, options)   — legacy-compatible toast.
 *       options: string type, or { type, title, duration, actionText, onAction }
 *   window.lmsConfirm(optionsOrMessage)  — Promise<boolean>.
 *   window.lmsPrompt(message, defaultValue, options) — Promise<string|null>.
 *   window.LmsNotify                   — { toast, success, error, warning,
 *                                        info, confirm, prompt, dialog }
 *   window.LmsNotify.dialog({title, message, confirmText}) — Promise<void>.
 *
 * Safety net (documented fallback only — all migrated call sites use the
 * Promise APIs above): window.alert / window.confirm / window.prompt are
 * overridden to route into this system and log a console warning naming
 * the legacy call. window.confirm / window.prompt return Promises, so any
 * un-migrated synchronous caller would be a bug — the source-scan test
 * (test/batch8-notify.test.mjs) proves none remain.
 *
 * Presentation only: this module never reads or writes LMS data, never
 * calls the Worker, and never changes what any operation does.
 */
(function (global) {
  'use strict';

  var DOC = global.document;
  var STACK_ID = 'lms-notify-stack';
  var DIALOG_ID = 'lms-notify-dialog';
  var STYLE_ID = 'lms-notify-style';
  var MAX_VISIBLE = 3;

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function reducedMotion() {
    try {
      return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) { return false; }
  }

  function ensureStyle() {
    if (!DOC || DOC.getElementById(STYLE_ID)) return;
    var style = DOC.createElement('style');
    style.id = STYLE_ID;
    style.textContent =
      '#' + STACK_ID + '{position:fixed;top:calc(env(safe-area-inset-top,0px) + 16px);right:16px;z-index:11000;display:flex;flex-direction:column;gap:10px;width:calc(100vw - 32px);max-width:26rem;pointer-events:none;}' +
      '@media (max-width:640px){#' + STACK_ID + '{left:12px;right:12px;top:calc(env(safe-area-inset-top,0px) + 12px);width:auto;max-width:none;}}' +
      '.lms-toast{pointer-events:auto;display:flex;gap:12px;align-items:flex-start;background:#fff;border:1px solid #e2e8f0;border-left:4px solid #0f766e;border-radius:16px;box-shadow:0 20px 45px rgba(15,23,42,.18);padding:14px 14px 14px 12px;opacity:0;transform:translateY(-8px);transition:opacity .18s ease,transform .18s ease;}' +
      '.lms-toast.lms-toast-in{opacity:1;transform:translateY(0);}' +
      '.lms-toast-success{border-left-color:#059669;}.lms-toast-error{border-left-color:#e11d48;}.lms-toast-warning{border-left-color:#d97706;}.lms-toast-info{border-left-color:#0f766e;}' +
      '.lms-toast-icon{flex:none;width:32px;height:32px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:16px;}' +
      '.lms-toast-success .lms-toast-icon{background:#d1fae5;color:#047857;}.lms-toast-error .lms-toast-icon{background:#ffe4e6;color:#be123c;}.lms-toast-warning .lms-toast-icon{background:#fef3c7;color:#b45309;}.lms-toast-info .lms-toast-icon{background:#ccfbf1;color:#0f766e;}' +
      '.lms-toast-body{flex:1;min-width:0;}' +
      '.lms-toast-title{font-weight:800;font-size:13px;line-height:1.35;color:#0f172a;overflow-wrap:break-word;}' +
      '.lms-toast-text{margin-top:2px;font-size:12px;line-height:1.45;color:#475569;overflow-wrap:break-word;}' +
      '.lms-toast-action{margin-top:8px;background:none;border:none;padding:0;font-weight:800;font-size:12px;color:#0f766e;cursor:pointer;text-decoration:underline;}' +
      '.lms-toast-close{flex:none;width:32px;height:32px;border:none;border-radius:10px;background:transparent;color:#94a3b8;font-size:20px;line-height:1;cursor:pointer;}' +
      '.lms-toast-close:hover{background:#f1f5f9;color:#334155;}' +
      '@media (max-width:640px){.lms-toast-close{width:44px;height:44px;}}' +
      '#' + DIALOG_ID + '{position:fixed;inset:0;z-index:11001;display:flex;align-items:center;justify-content:center;padding:16px;padding-top:calc(env(safe-area-inset-top,0px) + 16px);padding-bottom:calc(env(safe-area-inset-bottom,0px) + 16px);background:rgba(15,23,42,.6);}' +
      '.lms-dialog{width:100%;max-width:28rem;max-height:calc(100dvh - 32px);overflow-y:auto;background:#fff;border:1px solid #e2e8f0;border-radius:20px;box-shadow:0 25px 60px rgba(15,23,42,.3);padding:20px;opacity:0;transform:translateY(8px);transition:opacity .18s ease,transform .18s ease;}' +
      '.lms-dialog.lms-dialog-in{opacity:1;transform:translateY(0);}' +
      '.lms-dialog-head{display:flex;gap:14px;align-items:flex-start;padding-bottom:14px;border-bottom:1px solid #f1f5f9;}' +
      '.lms-dialog-icon{flex:none;width:40px;height:40px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:18px;}' +
      '.lms-dialog-danger .lms-dialog-icon{background:#ffe4e6;color:#be123c;}.lms-dialog-warning .lms-dialog-icon{background:#fef3c7;color:#b45309;}.lms-dialog-success .lms-dialog-icon{background:#d1fae5;color:#047857;}.lms-dialog-info .lms-dialog-icon{background:#ccfbf1;color:#0f766e;}' +
      '.lms-dialog-title{font-weight:800;font-size:15px;line-height:1.35;color:#0f172a;overflow-wrap:break-word;}' +
      '.lms-dialog-text{margin-top:10px;font-size:13px;line-height:1.55;color:#475569;white-space:pre-line;overflow-wrap:break-word;}' +
      '.lms-dialog-input{width:100%;margin-top:12px;padding:12px;border:1px solid #cbd5e1;border-radius:12px;font-size:14px;color:#0f172a;box-sizing:border-box;}' +
      '.lms-dialog-input:focus{outline:2px solid #0f766e;outline-offset:1px;border-color:#0f766e;}' +
      '.lms-dialog-actions{display:flex;justify-content:flex-end;gap:10px;padding-top:16px;}' +
      '.lms-dialog-btn{min-height:40px;padding:10px 18px;border-radius:12px;font-weight:800;font-size:13px;cursor:pointer;}' +
      '@media (max-width:640px){.lms-dialog-btn{min-height:44px;}}' +
      '.lms-dialog-cancel{border:1px solid #cbd5e1;background:#fff;color:#334155;}' +
      '.lms-dialog-cancel:hover{background:#f8fafc;}' +
      '.lms-dialog-confirm{border:1px solid transparent;background:#0f766e;color:#fff;}' +
      '.lms-dialog-confirm:hover{background:#115e59;}' +
      '.lms-dialog-danger .lms-dialog-confirm{background:#e11d48;}.lms-dialog-danger .lms-dialog-confirm:hover{background:#be123c;}' +
      '.lms-dialog-warning .lms-dialog-confirm{background:#d97706;}.lms-dialog-warning .lms-dialog-confirm:hover{background:#b45309;}' +
      '.lms-dialog-success .lms-dialog-confirm{background:#059669;}.lms-dialog-success .lms-dialog-confirm:hover{background:#047857;}' +
      '@media (prefers-reduced-motion: reduce){.lms-toast,.lms-dialog{transition:none;}}';
    (DOC.head || DOC.getElementsByTagName('head')[0] || DOC.body).appendChild(style);
  }

  /* ---------------- Toasts ---------------- */

  var queue = [];
  var visibleCount = 0;
  var pendingEarly = []; // toasts requested before <body> exists

  function getStack() {
    if (!DOC || !DOC.body) return null;
    var stack = DOC.getElementById(STACK_ID);
    if (!stack) {
      stack = DOC.createElement('div');
      stack.id = STACK_ID;
      stack.setAttribute('role', 'region');
      stack.setAttribute('aria-label', 'Notifications');
      DOC.body.appendChild(stack);
    }
    return stack;
  }

  function inferType(message, explicit) {
    if (explicit && ['success', 'error', 'warning', 'info'].indexOf(explicit) !== -1) return explicit;
    var lower = String(message || '').toLowerCase();
    if (lower.indexOf('error') !== -1 || lower.indexOf('failed') !== -1 || lower.indexOf('failure') !== -1 ||
        lower.indexOf('access denied') !== -1 || lower.indexOf('unable to') !== -1 || lower.indexOf('invalid') !== -1 ||
        lower.indexOf('not found') !== -1 || lower.indexOf('could not') !== -1 || lower.indexOf('not saved') !== -1 ||
        lower.indexOf('was not') !== -1 || lower.indexOf('did not') !== -1) return 'error';
    if (lower.indexOf('please ') !== -1 || lower.indexOf('warning') !== -1 || lower.indexOf('already') !== -1 ||
        lower.indexOf('required') !== -1 || lower.indexOf('not provided') !== -1) return 'warning';
    if (lower.indexOf('success') !== -1 || lower.indexOf('saved') !== -1 || lower.indexOf('recorded') !== -1 ||
        lower.indexOf('submitted') !== -1 || lower.indexOf('added') !== -1 || lower.indexOf('created') !== -1 ||
        lower.indexOf('dispatched') !== -1 || lower.indexOf('sent') !== -1 || lower.indexOf('downloaded') !== -1 ||
        lower.indexOf('completed') !== -1 || lower.indexOf('updated') !== -1 || lower.indexOf('approved') !== -1 ||
        lower.indexOf('reactivated') !== -1 || lower.indexOf('enrolled') !== -1 || lower.indexOf('copied') !== -1) return 'success';
    return 'info';
  }

  function splitTitleBody(rawText, optsTitle) {
    var lines = String(rawText).split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    var title = optsTitle;
    var bodyLines = lines;
    if (!title) {
      title = (lines[0] || 'Notification').replace(/^[✅🎉🎓❌⚠️📅🕒🚨⚡🔑📧💰🌍👨‍👩‍👧👤]+\s*/, '').trim() || 'Notification';
      bodyLines = lines.slice(1);
    }
    return { title: title, body: bodyLines.join(' ').replace(/\s+/g, ' ').trim() };
  }

  var ICONS = { success: '✓', error: '!', warning: '!', info: 'i' };

  function showToastNow(item) {
    var stack = getStack();
    if (!stack) { pendingEarly.push(item); return; }
    ensureStyle();
    visibleCount++;
    var variant = item.variant;
    var card = DOC.createElement('div');
    card.className = 'lms-toast lms-toast-' + variant;
    card.setAttribute('role', variant === 'error' ? 'alert' : 'status');
    card.setAttribute('aria-live', variant === 'error' ? 'assertive' : 'polite');
    var icon = DOC.createElement('div');
    icon.className = 'lms-toast-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = ICONS[variant] || 'i';
    var body = DOC.createElement('div');
    body.className = 'lms-toast-body';
    var titleEl = DOC.createElement('div');
    titleEl.className = 'lms-toast-title';
    titleEl.textContent = item.title;
    body.appendChild(titleEl);
    if (item.body) {
      var textEl = DOC.createElement('div');
      textEl.className = 'lms-toast-text';
      textEl.textContent = item.body;
      body.appendChild(textEl);
    }
    if (item.actionText && typeof item.onAction === 'function') {
      var actionBtn = DOC.createElement('button');
      actionBtn.type = 'button';
      actionBtn.className = 'lms-toast-action';
      actionBtn.textContent = item.actionText;
      actionBtn.addEventListener('click', function () { try { item.onAction(); } catch (e) {} dismiss(); });
      body.appendChild(actionBtn);
    }
    var closeBtn = DOC.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'lms-toast-close';
    closeBtn.setAttribute('aria-label', 'Dismiss notification');
    closeBtn.textContent = '×';
    card.appendChild(icon);
    card.appendChild(body);
    card.appendChild(closeBtn);
    item.el = card;

    var remaining = null;
    var timer = null;
    var startedAt = 0;
    function clearTimer() { if (timer) { global.clearTimeout(timer); timer = null; } }
    function startTimer(ms) {
      clearTimer();
      if (ms == null) return;
      remaining = ms;
      startedAt = Date.now();
      timer = global.setTimeout(dismiss, ms);
    }
    function pauseTimer() {
      if (!timer) return;
      clearTimer();
      remaining = Math.max(0, remaining - (Date.now() - startedAt));
    }
    function resumeTimer() { if (remaining != null && remaining > 0) startTimer(remaining); }
    function dismiss() {
      clearTimer();
      if (card.parentNode) card.parentNode.removeChild(card);
      else if (card.remove) { try { card.remove(); } catch (e) {} }
      visibleCount = Math.max(0, visibleCount - 1);
      drainQueue();
    }
    closeBtn.addEventListener('click', dismiss);
    card.addEventListener('mouseenter', pauseTimer);
    card.addEventListener('mouseleave', resumeTimer);
    card.addEventListener('focusin', pauseTimer);
    card.addEventListener('focusout', resumeTimer);
    card.addEventListener('touchstart', pauseTimer, { passive: true });
    card.addEventListener('touchend', resumeTimer);
    item.dismiss = dismiss;
    stack.appendChild(card);
    if (reducedMotion()) { card.className += ' lms-toast-in'; }
    else if (global.requestAnimationFrame) { global.requestAnimationFrame(function () { card.className += ' lms-toast-in'; }); }
    else { card.className += ' lms-toast-in'; }
    var duration = item.duration;
    if (duration == null) duration = (variant === 'error') ? null : (variant === 'warning' ? 8000 : 3600);
    if (duration != null) startTimer(duration);
  }

  function drainQueue() {
    while (visibleCount < MAX_VISIBLE && queue.length > 0) {
      showToastNow(queue.shift());
    }
  }

  function toast(message, options) {
    if (message === undefined || message === null) return;
    var rawText = String(message).trim();
    if (!rawText) return;
    var opts = (typeof options === 'string') ? { type: options } : (options || {});
    var variant = inferType(rawText, opts.type);
    var parts = splitTitleBody(rawText, opts.title);
    var item = { variant: variant, title: parts.title, body: parts.body, duration: opts.duration,
                 actionText: opts.actionText, onAction: opts.onAction };
    if (!DOC || !DOC.body) {
      pendingEarly.push(item);
      if (DOC && DOC.addEventListener) {
        DOC.addEventListener('DOMContentLoaded', function flushEarly() {
          var waiting = pendingEarly; pendingEarly = [];
          waiting.forEach(function (it) { queue.push(it); });
          drainQueue();
        });
      }
      return;
    }
    if (visibleCount >= MAX_VISIBLE) queue.push(item);
    else showToastNow(item);
  }

  /* ---------------- Dialogs (confirm / prompt / read-carefully) ---------------- */

  var activeDialog = null; // { cleanup }

  function closeActiveDialog(result, kind) {
    if (!activeDialog) return;
    var dlg = activeDialog; activeDialog = null;
    dlg.cleanup(result, kind);
  }

  function buildDialog(opts) {
    ensureStyle();
    if (activeDialog) { try { activeDialog.forceClose(); } catch (e) {} activeDialog = null; }
    var prevActive = null;
    try { prevActive = DOC.activeElement; } catch (e) {}
    var backdrop = DOC.createElement('div');
    backdrop.id = DIALOG_ID;
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    var box = DOC.createElement('div');
    box.className = 'lms-dialog lms-dialog-' + (opts.variant || 'info');
    var head = DOC.createElement('div');
    head.className = 'lms-dialog-head';
    var icon = DOC.createElement('div');
    icon.className = 'lms-dialog-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = opts.variant === 'danger' || opts.variant === 'warning' ? '!' : (opts.variant === 'success' ? '✓' : 'i');
    var titleEl = DOC.createElement('div');
    titleEl.className = 'lms-dialog-title';
    titleEl.textContent = opts.title || 'Confirm';
    head.appendChild(icon);
    head.appendChild(titleEl);
    box.appendChild(head);
    if (opts.message) {
      var textEl = DOC.createElement('div');
      textEl.className = 'lms-dialog-text';
      textEl.textContent = opts.message;
      box.appendChild(textEl);
    }
    var inputEl = null;
    if (opts.input) {
      inputEl = DOC.createElement('input');
      inputEl.type = 'text';
      inputEl.className = 'lms-dialog-input';
      inputEl.value = opts.defaultValue || '';
      if (opts.inputLabel) inputEl.setAttribute('aria-label', opts.inputLabel);
      box.appendChild(inputEl);
    }
    var actions = DOC.createElement('div');
    actions.className = 'lms-dialog-actions';
    var cancelBtn = DOC.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'lms-dialog-btn lms-dialog-cancel';
    cancelBtn.textContent = opts.cancelText || 'Cancel';
    var confirmBtn = DOC.createElement('button');
    confirmBtn.type = opts.input ? 'submit' : 'button';
    confirmBtn.className = 'lms-dialog-btn lms-dialog-confirm';
    confirmBtn.textContent = opts.confirmText || 'Confirm';
    if (!opts.hideCancel) actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    box.appendChild(actions);
    backdrop.appendChild(box);
    DOC.body.appendChild(backdrop);
    if (!reducedMotion() && global.requestAnimationFrame) {
      global.requestAnimationFrame(function () { box.className += ' lms-dialog-in'; });
    } else { box.className += ' lms-dialog-in'; }

    var settled = false;
    function cleanup(result) {
      if (settled) return; settled = true;
      DOC.removeEventListener('keydown', onKey);
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
      else if (backdrop.remove) { try { backdrop.remove(); } catch (e) {} }
      if (prevActive && typeof prevActive.focus === 'function') { try { prevActive.focus(); } catch (e) {} }
      opts.resolve(result);
    }
    function focusables() {
      var els = [];
      try {
        var list = box.querySelectorAll('button, input, [tabindex]');
        for (var i = 0; i < list.length; i++) els.push(list[i]);
      } catch (e) {}
      if (els.length === 0) { if (confirmBtn) els.push(confirmBtn); if (cancelBtn) els.push(cancelBtn); }
      return els;
    }
    function onKey(ev) {
      if (ev.key === 'Escape') { ev.preventDefault(); cleanup(opts.cancelValue); return; }
      if (ev.key === 'Tab') {
        var els = focusables();
        if (els.length === 0) return;
        var idx = els.indexOf(DOC.activeElement);
        if (ev.shiftKey) { if (idx <= 0) { ev.preventDefault(); els[els.length - 1].focus(); } }
        else if (idx === els.length - 1 || idx === -1) { ev.preventDefault(); els[0].focus(); }
        return;
      }
      if (ev.key === 'Enter') {
        if (opts.input) { ev.preventDefault(); cleanup(inputEl ? inputEl.value : ''); return; }
        if (DOC.activeElement === cancelBtn) return; // native button activation handles it
        ev.preventDefault(); cleanup(opts.confirmValue);
      }
    }
    DOC.addEventListener('keydown', onKey);
    backdrop.addEventListener('click', function (ev) { if (ev.target === backdrop) cleanup(opts.cancelValue); });
    cancelBtn.addEventListener('click', function () { cleanup(opts.cancelValue); });
    confirmBtn.addEventListener('click', function () {
      cleanup(opts.input ? (inputEl ? inputEl.value : '') : opts.confirmValue);
    });
    var handle = { cleanup: cleanup, forceClose: function () { cleanup(opts.cancelValue); } };
    activeDialog = handle;
    if (inputEl) { try { inputEl.focus(); inputEl.select(); } catch (e) {} }
    else { try { confirmBtn.focus(); } catch (e) {} }
    return handle;
  }

  function inferConfirmVariant(raw, explicit) {
    if (explicit) return explicit;
    var lower = String(raw || '').toLowerCase();
    if (lower.indexOf('deactivate') !== -1 || lower.indexOf('delete') !== -1 || lower.indexOf('remove') !== -1 ||
        lower.indexOf('discontinue') !== -1 || lower.indexOf('unassign') !== -1) return 'danger';
    if (lower.indexOf('reactivate') !== -1 || lower.indexOf('return') !== -1 || lower.indexOf('unsuspend') !== -1) return 'success';
    if (lower.indexOf('suspend') !== -1 || lower.indexOf('leave') !== -1) return 'warning';
    return 'info';
  }

  function parseConfirmInput(optionsOrMessage) {
    if (optionsOrMessage && typeof optionsOrMessage === 'object') {
      return {
        title: optionsOrMessage.title || 'Confirm Action',
        message: optionsOrMessage.message || '',
        details: Array.isArray(optionsOrMessage.details) ? optionsOrMessage.details : [],
        confirmText: optionsOrMessage.confirmText || 'Confirm',
        cancelText: optionsOrMessage.cancelText || 'Cancel',
        variant: optionsOrMessage.variant || inferConfirmVariant(optionsOrMessage.message || optionsOrMessage.title || '')
      };
    }
    var raw = String(optionsOrMessage || 'Are you sure you want to proceed?').trim();
    var lines = raw.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    var title = lines[0] || 'Confirm Action';
    var message = lines.slice(1).join('\n');
    var lower = raw.toLowerCase();
    var confirmText = 'Confirm';
    if (lower.indexOf('deactivate the entire family') !== -1 || lower.indexOf('deactivate family') !== -1) confirmText = 'Deactivate Family';
    else if (lower.indexOf('reactivate the entire family') !== -1 || lower.indexOf('reactivate family') !== -1) confirmText = 'Reactivate Family';
    else if (lower.indexOf('reactivate') !== -1) confirmText = 'Reactivate';
    else if (lower.indexOf('deactivate') !== -1) confirmText = 'Deactivate';
    else if (lower.indexOf('delete') !== -1 || lower.indexOf('remove') !== -1) confirmText = 'Delete';
    else if (lower.indexOf('discontinue') !== -1) confirmText = 'Discontinue Trial';
    else if (lower.indexOf('unassign') !== -1) confirmText = 'Unassign';
    else if (lower.indexOf('unsuspend') !== -1) confirmText = 'Unsuspend Classes';
    else if (lower.indexOf('suspend') !== -1) confirmText = 'Suspend Classes';
    else if (lower.indexOf('leave') !== -1) confirmText = lower.indexOf('return') !== -1 ? 'Return to Active' : 'Confirm Leave';
    else if (lower.indexOf('remind all') !== -1) confirmText = 'Send Reminders';
    else if (lower.indexOf('sync') !== -1 || lower.indexOf('cascade') !== -1) confirmText = 'Sync Now';
    return { title: title, message: message, details: [], confirmText: confirmText, cancelText: 'Cancel',
             variant: inferConfirmVariant(raw, null) };
  }

  function confirmDialog(optionsOrMessage) {
    return new Promise(function (resolve) {
      var cfg = parseConfirmInput(optionsOrMessage);
      var message = cfg.message;
      if (cfg.details && cfg.details.length) message = (message ? message + '\n' : '') + cfg.details.join('\n');
      buildDialog({ title: cfg.title, message: message, confirmText: cfg.confirmText,
                    cancelText: cfg.cancelText, variant: cfg.variant === 'danger' ? 'danger' : cfg.variant,
                    confirmValue: true, cancelValue: false, resolve: resolve });
    });
  }

  function promptDialog(message, defaultValue, options) {
    return new Promise(function (resolve) {
      var opts = options || {};
      var raw = String(message || 'Enter value:').trim();
      var lines = raw.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
      var title = opts.title || lines[0] || 'Input Required';
      var desc = opts.title ? raw : lines.slice(1).join('\n');
      buildDialog({ title: title, message: desc, input: true, inputLabel: title,
                    defaultValue: (defaultValue == null ? '' : String(defaultValue)),
                    confirmText: opts.confirmText || 'Confirm', cancelText: 'Cancel',
                    variant: 'info', confirmValue: null, cancelValue: null,
                    resolve: function (val) { resolve(val); } });
      // buildDialog's confirm path resolves with the input value for input dialogs
      // (see confirmBtn handler); cancel/Escape/backdrop resolve null.
    });
  }

  function readDialog(opts) {
    return new Promise(function (resolve) {
      buildDialog({ title: (opts && opts.title) || 'Please read carefully',
                    message: (opts && opts.message) || '',
                    confirmText: (opts && opts.confirmText) || 'Done',
                    hideCancel: true, variant: (opts && opts.variant) || 'info',
                    confirmValue: undefined, cancelValue: undefined, resolve: resolve });
    });
  }

  /* ---------------- Public API + safety net ---------------- */

  var api = {
    toast: toast,
    success: function (m, o) { toast(m, Object.assign({}, o, { type: 'success' })); },
    error: function (m, o) { toast(m, Object.assign({}, o, { type: 'error' })); },
    warning: function (m, o) { toast(m, Object.assign({}, o, { type: 'warning' })); },
    info: function (m, o) { toast(m, Object.assign({}, o, { type: 'info' })); },
    confirm: confirmDialog,
    prompt: promptDialog,
    dialog: readDialog
  };
  // Test hook only (queue/visibility introspection for the automated suite).
  api.__test = { visibleCount: function () { return visibleCount; }, queueLength: function () { return queue.length; } };

  global.LmsNotify = api;
  global.lmsNotify = toast;
  global.lmsConfirm = confirmDialog;
  global.lmsPrompt = promptDialog;

  // Safety net: any missed legacy call routes here (and warns) instead of
  // ever showing a native browser popup. confirm/prompt are async-only:
  // all migrated call sites already await the Promise APIs.
  // The warning names the caller file (from the stack) so a missed call
  // site can be found and migrated.
  function legacyCallerHint() {
    try {
      var stack = new Error().stack || '';
      var lines = stack.split('\n');
      for (var i = 0; i < lines.length; i++) {
        if (lines[i].indexOf('ui-notify.js') !== -1) continue;
        var m = lines[i].match(/(https?:\/\/[^\s:)]+|[^\s()]+?\.(?:js|html))(?::\d+)?(?::\d+)?/);
        if (m) return ' (caller: ' + m[1] + ')';
      }
    } catch (e) {}
    return '';
  }
  global.alert = function (msg) {
    try { console.warn('[LmsNotify] legacy window.alert() routed to toast — migrate this call site to lmsNotify().' + legacyCallerHint()); } catch (e) {}
    toast(msg);
  };
  global.confirm = function (msg) {
    try { console.warn('[LmsNotify] legacy window.confirm() routed to lmsConfirm() — migrate this call site to await lmsConfirm().' + legacyCallerHint()); } catch (e) {}
    return confirmDialog(msg);
  };
  global.prompt = function (msg, def) {
    try { console.warn('[LmsNotify] legacy window.prompt() routed to lmsPrompt() — migrate this call site to await lmsPrompt().' + legacyCallerHint()); } catch (e) {}
    return promptDialog(msg, def);
  };

})(typeof window !== 'undefined' ? window : globalThis);

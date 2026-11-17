/**
 * ============================================================================
 * AL-HUDA ISLAMIC CENTRE LMS — FEE UPGRADE PHASE 4
 * File: js/fee-phase4.js
 * Purpose: 8 small wins for the LMS admin fee tab —
 *   #6  Universal search (families / fee records / receipts)
 *   #11 Currency drill-down (fee dashboard currency cards)
 *   #19 Remembered payment method per family (localStorage only)
 *   #42/#50 WhatsApp message builders (receipt + pending reminder)
 *   #31 Leave from inside the Collect Fee form
 *   #66 Families CSV export (manager contacts masked)
 *   #70 Custom currencies (localStorage, Add + Edit Family + fee grid)
 *   #9/#13 Due-date engine (Due Day + Fee Timing per family)
 *
 * NOTES — what already existed, and what this phase honestly adds:
 * - The receipt WhatsApp message, the pending WhatsApp reminder and the
 *   defaulter WhatsApp message ALREADY existed as inline template
 *   literals in js/fees.js (openFeeInvoiceModal, pending + defaulter row
 *   renderers). This phase extracts them VERBATIM into tested pure
 *   builders and rewires the three call sites to use them — behaviour
 *   is identical, the text is now covered by tests. The receipt message
 *   carries NO PDF link: LMS PDFs are generated client-side and never
 *   stored, so no link exists to include. Nothing is auto-sent; both
 *   builders only produce wa.me links.
 * - Custom currencies ALREADY existed for the Add Family modal
 *   (js/families.js, localStorage key 'alhuda_custom_currencies'). This
 *   phase extracts the list helpers into tested functions, wires the
 *   custom codes into the fee currency grid + the Edit Family currency
 *   field (which was a free-text input), and keeps the SAME storage key
 *   and 'CODE (CODE)' label format so existing saved codes keep working.
 * - Due Day + Fee Timing live in family.notes as `fee_due_day` /
 *   `fee_timing` (NO D1 column, NO Worker change). The engine itself
 *   lives in js/fee-phase1.js (getFeeDueDate / dueDayOf / feeTimingOf);
 *   this module only holds the form/storage helpers that read and
 *   write those two notes keys.
 * - Remembered payment methods live in localStorage under
 *   'alhuda_family_payment_methods' (fee-portal pattern) — device-only,
 *   never synced to the cloud.
 *
 * Pure functions take explicit inputs so the test suites can execute the
 * real logic without a browser. DOM helpers return strings only.
 * ============================================================================
 */
(function () {
  'use strict';

  var MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  var BUILT_IN_CURRENCIES = ['USD', 'GBP', 'CAD', 'EUR', 'AUD', 'PKR', 'AED', 'NZD'];

  var FEE_METHODS = [
    'Online / Bank Transfer', 'Zelle', 'PayPal', 'Stripe', 'Wise', 'Cash / Other'
  ];

  var CUSTOM_CURRENCIES_KEY = 'alhuda_custom_currencies';
  var REMEMBERED_METHODS_KEY = 'alhuda_family_payment_methods';

  function num(v, dflt) {
    var n = parseFloat(v);
    if (isNaN(n)) return (dflt == null ? 0 : dflt);
    return n;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function monthIdxOf(m) {
    if (typeof m === 'number') return (m >= 0 && m <= 11) ? m : -1;
    var s = String(m || '').trim().toLowerCase();
    for (var i = 0; i < MONTHS.length; i++) {
      if (MONTHS[i].toLowerCase() === s) return i;
      if (MONTHS[i].toLowerCase().slice(0, 3) === s) return i;
    }
    return -1;
  }

  function daysInMonth(y, m) {
    return new Date(y, m + 1, 0).getDate();
  }

  function pad2(n) {
    n = String(n);
    return n.length < 2 ? '0' + n : n;
  }

  function isCancelledRecord(r) {
    if (!r) return false;
    var s = String(r.status || '').toLowerCase();
    return s === 'cancelled' || s.indexOf('cancel') !== -1;
  }

  function isMonthStatusRow(r) {
    if (!r) return false;
    if (String(r.recordKind || '') === 'month_status') return true;
    return /^ADJ-\d{6}-/i.test(String(r.receiptNo || ''));
  }

  function isDueInvoiceRow(r) {
    if (!r) return false;
    if (String(r.recordKind || '') === 'due_invoice') return true;
    return /^DUE-\d{6}-/i.test(String(r.receiptNo || ''));
  }

  function safeStorage(storage) {
    try {
      if (storage && typeof storage.getItem === 'function') return storage;
    } catch (e) { /* fall through */ }
    return null;
  }

  // --------------------------------------------------------------------------
  // #6 — UNIVERSAL SEARCH. Frontend-only search across the LOADED families,
  // fee records and receipts (fee-portal openUniversalSearchModal pattern).
  // js/search.js is schedule search only and is untouched.
  // --------------------------------------------------------------------------
  function familySearchHaystack(fam) {
    var parts = [
      fam ? fam.id : '', fam ? fam.parent_name : '', fam ? fam.country : '',
      fam ? fam.whatsapp : '', fam ? fam.email : '', fam ? fam.parent_email : ''
    ];
    ((fam && fam.students) || []).forEach(function (s) {
      if (s && s.name) parts.push(s.name);
    });
    return parts.join(' ').toLowerCase();
  }

  function receiptSearchHaystack(r) {
    var parts = [
      r ? r.receiptNo : '', r ? r.parentName : '', r ? r.studentsNames : '',
      r ? r.month : '', r ? r.year : '', r ? r.familyId : '',
      r ? String(num(r.amountPaid)) : '', r ? String(num(r.totalPayable)) : ''
    ];
    return parts.join(' ').toLowerCase();
  }

  function universalSearch(input) {
    input = input || {};
    var q = String(input.query || '').trim().toLowerCase();
    var limit = parseInt(input.limit, 10);
    if (isNaN(limit) || limit < 1) limit = 8;
    if (!q) return { families: [], receipts: [], query: '' };
    var families = [];
    var receipts = [];
    (Array.isArray(input.families) ? input.families : []).forEach(function (fam) {
      if (!fam) return;
      if (familySearchHaystack(fam).indexOf(q) !== -1) families.push(fam);
    });
    (Array.isArray(input.records) ? input.records : []).forEach(function (r) {
      if (!r || isCancelledRecord(r) || isDueInvoiceRow(r) || isMonthStatusRow(r)) return;
      if (receiptSearchHaystack(r).indexOf(q) !== -1) receipts.push(r);
    });
    return {
      families: families.slice(0, limit),
      receipts: receipts.slice(0, limit),
      query: String(input.query || '').trim()
    };
  }

  function universalSearchFamilyRowHtml(fam) {
    var students = ((fam && fam.students) || []).map(function (s) { return s.name; }).filter(Boolean).join(', ');
    return '<button type="button" onclick="selectFeeFamilyFromSearch(\'' + esc(String(fam.id || '')) + '\')" class="w-full text-left px-3 py-2.5 rounded-xl hover:bg-emerald-50 border border-transparent hover:border-emerald-200 transition">' +
      '<span class="block text-xs font-extrabold text-slate-900">' + esc(fam.parent_name || 'Family') + ' <span class="font-mono text-emerald-800">' + esc(fam.id || '') + '</span></span>' +
      '<span class="block text-[11px] text-slate-500 font-bold mt-0.5">' + esc(students || 'Enrolled Student') + ' • ' + esc(fam.currency || 'USD') + ' ' + num(fam.monthly_fee).toFixed(2) + '/month</span>' +
      '</button>';
  }

  function universalSearchReceiptRowHtml(r) {
    return '<button type="button" onclick="openFeeReceiptFromSearch(\'' + esc(String(r.receiptNo || '')) + '\')" class="w-full text-left px-3 py-2.5 rounded-xl hover:bg-indigo-50 border border-transparent hover:border-indigo-200 transition">' +
      '<span class="block text-xs font-extrabold text-slate-900 font-mono">' + esc(r.receiptNo || '') + '</span>' +
      '<span class="block text-[11px] text-slate-500 font-bold mt-0.5">' + esc(r.parentName || '') + ' • ' + esc(r.month || '') + ' ' + esc(r.year || '') + ' • ' + esc(r.currency || 'USD') + ' ' + num(r.amountPaid).toFixed(2) + '</span>' +
      '</button>';
  }

  // --------------------------------------------------------------------------
  // #11 — CURRENCY DRILL-DOWN. Per-family rows for one currency + month,
  // plus a previous-months summary. feeForMonth(fam, monthIdx, year) is
  // supplied by the caller (fees.js passes feeFormApplicableFeeDetails).
  // --------------------------------------------------------------------------
  function paidForMonth(records, familyId, monthIdx, year) {
    var sum = 0;
    var fam = String(familyId || '').toUpperCase();
    (Array.isArray(records) ? records : []).forEach(function (r) {
      if (!r || isCancelledRecord(r) || isMonthStatusRow(r) || isDueInvoiceRow(r)) return;
      if (String(r.familyId || '').toUpperCase() !== fam) return;
      if (monthIdxOf(r.month) !== monthIdx) return;
      if (parseInt(r.year, 10) !== parseInt(year, 10)) return;
      sum += num(r.amountPaid);
    });
    return sum;
  }

  function isStatusPaidFromRecords(records, familyId, monthIdx, year) {
    var fam = String(familyId || '').toUpperCase();
    var hasStatus = false;
    var hasReal = false;
    (Array.isArray(records) ? records : []).forEach(function (r) {
      if (!r || isCancelledRecord(r)) return;
      if (String(r.familyId || '').toUpperCase() !== fam) return;
      if (monthIdxOf(r.month) !== monthIdx) return;
      if (parseInt(r.year, 10) !== parseInt(year, 10)) return;
      if (isMonthStatusRow(r)) hasStatus = true;
      else if (!isDueInvoiceRow(r)) hasReal = true;
    });
    return hasStatus && !hasReal;
  }

  function currencyDetailRowStatus(input) {
    if (input.isLeave) return 'On Leave';
    if (input.isStatusPaid) return 'Paid (Status)';
    if (input.paid + 0.01 >= input.fee && input.fee > 0) return 'Paid';
    if (input.paid > 0) return 'Partial';
    return 'Due';
  }

  function buildCurrencyDetailRows(input) {
    input = input || {};
    var cur = String(input.currency || '').toUpperCase();
    var monthIdx = parseInt(input.monthIdx, 10);
    var year = parseInt(input.year, 10);
    var feeForMonth = typeof input.feeForMonth === 'function' ? input.feeForMonth : function () { return 0; };
    var isLeave = typeof input.isLeave === 'function' ? input.isLeave : function () { return false; };
    var isNotEnrolled = typeof input.isNotEnrolled === 'function' ? input.isNotEnrolled : function () { return false; };
    var isPreAdmission = typeof input.isPreAdmission === 'function' ? input.isPreAdmission : function () { return false; };
    var rows = [];
    (Array.isArray(input.families) ? input.families : []).forEach(function (fam) {
      if (!fam) return;
      if (String(fam.currency || 'USD').toUpperCase() !== cur) return;
      if (isPreAdmission(fam, monthIdx, year) || isNotEnrolled(fam, monthIdx, year)) return;
      var fee = num(feeForMonth(fam, monthIdx, year));
      var paid = paidForMonth(input.records, fam.id, monthIdx, year);
      var onLeave = !!isLeave(fam, monthIdx, year);
      var statusPaid = isStatusPaidFromRecords(input.records, fam.id, monthIdx, year);
      var students = ((fam.students || []).filter(function (s) { return (s.status || '').toLowerCase() !== 'trial'; }).map(function (s) { return s.name; }).filter(Boolean).join(', ')) || 'Enrolled Student';
      rows.push({
        familyId: fam.id,
        parentName: fam.parent_name || '',
        studentsNames: students,
        fee: onLeave ? 0 : fee,
        paid: paid,
        remaining: onLeave ? 0 : Math.max(0, fee - paid),
        status: currencyDetailRowStatus({ isLeave: onLeave, isStatusPaid: statusPaid, paid: paid, fee: onLeave ? 0 : fee })
      });
    });
    return rows;
  }

  function buildCurrencyPrevMonths(input) {
    input = input || {};
    var cur = String(input.currency || '').toUpperCase();
    var monthIdx = parseInt(input.monthIdx, 10);
    var year = parseInt(input.year, 10);
    var feeForMonth = typeof input.feeForMonth === 'function' ? input.feeForMonth : function () { return 0; };
    var isLeave = typeof input.isLeave === 'function' ? input.isLeave : function () { return false; };
    var isNotEnrolled = typeof input.isNotEnrolled === 'function' ? input.isNotEnrolled : function () { return false; };
    var isPreAdmission = typeof input.isPreAdmission === 'function' ? input.isPreAdmission : function () { return false; };
    var out = [];
    for (var k = 1; k <= 3; k++) {
      var m = monthIdx - k;
      var y = year;
      while (m < 0) { m += 12; y -= 1; }
      var expected = 0;
      var received = 0;
      (Array.isArray(input.families) ? input.families : []).forEach(function (fam) {
        if (!fam) return;
        if (String(fam.currency || 'USD').toUpperCase() !== cur) return;
        if (isPreAdmission(fam, m, y) || isNotEnrolled(fam, m, y) || isLeave(fam, m, y)) return;
        expected += num(feeForMonth(fam, m, y));
        received += paidForMonth(input.records, fam.id, m, y);
      });
      out.push({
        month: MONTHS[m], year: y,
        expected: Math.round(expected * 100) / 100,
        received: Math.round(received * 100) / 100,
        pending: Math.round(Math.max(0, expected - received) * 100) / 100
      });
    }
    return out;
  }

  // --------------------------------------------------------------------------
  // #70 — CUSTOM CURRENCIES. Same localStorage key + 'CODE (CODE)' label
  // format as the Add Family modal (js/families.js), so saved codes keep
  // working. Codes are plain 3-letter (2-5 accepted) uppercase codes.
  // --------------------------------------------------------------------------
  function currencyCodeOf(label) {
    return String(label || '').trim().split(' ')[0].toUpperCase();
  }

  function getCustomCurrencies(storage) {
    var st = safeStorage(storage);
    if (!st) return [];
    try {
      var list = JSON.parse(st.getItem(CUSTOM_CURRENCIES_KEY) || '[]');
      if (!Array.isArray(list)) return [];
      return list.filter(function (c) { return typeof c === 'string' && c.trim() !== ''; });
    } catch (e) { return []; }
  }

  function addCustomCurrency(list, code) {
    var clean = String(code || '').trim().toUpperCase();
    if (!/^[A-Z]{2,5}$/.test(clean)) return { list: Array.isArray(list) ? list.slice() : [], code: '', added: false, error: 'Enter a 2-5 letter currency code (e.g. CHF).' };
    var next = (Array.isArray(list) ? list.slice() : []);
    var label = clean + ' (' + clean + ')';
    if (next.some(function (c) { return currencyCodeOf(c) === clean; })) {
      return { list: next, code: clean, added: false, error: '' };
    }
    next.push(label);
    return { list: next, code: clean, added: true, error: '' };
  }

  function saveCustomCurrencies(storage, list) {
    var st = safeStorage(storage);
    if (!st) return false;
    try {
      st.setItem(CUSTOM_CURRENCIES_KEY, JSON.stringify(Array.isArray(list) ? list : []));
      return true;
    } catch (e) { return false; }
  }

  function allFeeCurrencies(builtIns, customList) {
    var seen = {};
    var out = [];
    (Array.isArray(builtIns) ? builtIns : BUILT_IN_CURRENCIES).forEach(function (c) {
      var code = currencyCodeOf(c);
      if (code && !seen[code]) { seen[code] = true; out.push(code); }
    });
    (Array.isArray(customList) ? customList : []).forEach(function (c) {
      var code = currencyCodeOf(c);
      if (code && !seen[code]) { seen[code] = true; out.push(code); }
    });
    return out;
  }

  function currencySelectOptionsHtml(codes, selected) {
    var sel = String(selected || '').toUpperCase();
    var opts = (Array.isArray(codes) ? codes : BUILT_IN_CURRENCIES).map(function (c) {
      var code = currencyCodeOf(c);
      return '<option value="' + esc(code) + '"' + (code === sel ? ' selected' : '') + '>' + esc(code) + '</option>';
    }).join('');
    opts += '<option value="__NEW_CURR__" class="font-bold text-emerald-700">+ Add New Currency...</option>';
    return opts;
  }

  // --------------------------------------------------------------------------
  // #19 — REMEMBERED PAYMENT METHOD. localStorage only, fee-portal
  // pattern ('alhuda_family_payment_methods'): family id (uppercased)
  // -> method string. Never synced to the cloud.
  // --------------------------------------------------------------------------
  function loadRememberedMethods(storage) {
    var st = safeStorage(storage);
    if (!st) return {};
    try {
      var map = JSON.parse(st.getItem(REMEMBERED_METHODS_KEY) || '{}');
      return (map && typeof map === 'object' && !Array.isArray(map)) ? map : {};
    } catch (e) { return {}; }
  }

  function saveRememberedMethod(storage, familyId, method) {
    var st = safeStorage(storage);
    var map = loadRememberedMethods(st);
    var m = String(method || '').trim();
    if (!familyId || FEE_METHODS.indexOf(m) === -1) return map;
    map[String(familyId).toUpperCase()] = m;
    try { if (st) st.setItem(REMEMBERED_METHODS_KEY, JSON.stringify(map)); } catch (e) { /* device-only, never fatal */ }
    return map;
  }

  function rememberedMethodFor(map, familyId) {
    if (!map || !familyId) return null;
    var m = map[String(familyId).toUpperCase()];
    return (typeof m === 'string' && FEE_METHODS.indexOf(m) !== -1) ? m : null;
  }

  // --------------------------------------------------------------------------
  // #42 / #50 — WHATSAPP MESSAGE BUILDERS. Verbatim text from the three
  // inline builders in js/fees.js (receipt modal, pending rows,
  // defaulters rows) — extracted so they are tested, behaviour identical.
  // The receipt message carries NO PDF link: LMS PDFs are generated
  // client-side and never stored, so no link exists to include. These
  // builders only produce wa.me links; nothing is auto-sent.
  // --------------------------------------------------------------------------
  function waLink(phone, msg) {
    var clean = String(phone || '').replace(/[^0-9]/g, '');
    return 'https://wa.me/' + clean + '?text=' + encodeURIComponent(msg);
  }

  function buildReceiptWhatsAppMessage(r, opts) {
    r = r || {};
    opts = opts || {};
    var academy = String(opts.academyName || 'Al-Huda Islamic Centre');
    var cur = String(r.currency || 'USD');
    var creditAmt = num(opts.creditAmt);
    var excessAmt = num(opts.excessAmt);
    var remaining = (opts.remaining != null) ? num(opts.remaining) : Math.max(0, num(r.totalPayable) - num(r.amountPaid));
    var creditMsg = '';
    if (creditAmt > 0) creditMsg += 'Advance Credit Deducted: *- ' + cur + ' ' + creditAmt.toFixed(2) + '*\n';
    if (excessAmt > 0) creditMsg += 'Next Month Advance Credit: *+ ' + cur + ' ' + excessAmt.toFixed(2) + '*\n';
    return 'Assalam-o-Alaikum Respected ' + (r.parentName || '') + ',\n\n*OFFICIAL TUITION FEE RECEIPT - ' + academy.toUpperCase() + '*\n--------------------------------------\nReceipt No: *' + (r.receiptNo || '') + '*\nDate: *' + (r.date || '') + '*\nStudent(s): *' + (r.studentsNames || '') + '*\nBilling Period: *' + (r.month || '') + ' ' + (r.year || '') + '*\nTotal Due: *' + cur + ' ' + num(r.totalPayable).toFixed(2) + '*\n' + creditMsg + 'Amount Paid: *' + cur + ' ' + num(r.amountPaid).toFixed(2) + '*\nRemaining Balance: *' + cur + ' ' + remaining.toFixed(2) + '*\nStatus: *' + (r.status || '') + '*\n--------------------------------------\nJazakAllahu Khairan!\n*' + academy + ' Accounts*';
  }

  function buildPendingWhatsAppMessage(item, periodStr, academyName) {
    item = item || {};
    var academy = String(academyName || 'Al-Huda Islamic Centre');
    return 'Assalam-o-Alaikum Respected ' + (item.parentName || '') + ',\nThis is an official fee reminder from *' + academy + '*.\nOur records show that your tuition fee for the month of *' + (periodStr || '') + '* (*' + (item.currency || 'USD') + ' ' + num(item.dueAmount).toFixed(2) + '*) for enrolled student(s): *' + (item.studentsNames || '') + '* has not yet reached us.\nKindly pay your fee at the earliest. *If you have already paid, please share the payment screenshot or receipt with us so we can update your account immediately.*\nJazakAllahu Khairan!';
  }

  function buildDefaulterWhatsAppMessage(item, academyName) {
    item = item || {};
    // NOTE: the notice line is a hardcoded 'AL-HUDA ISLAMIC CENTRE' in the
    // original inline builder in js/fees.js — kept verbatim here so the
    // message text is identical; academyName is not used for that line.
    return 'Assalam-o-Alaikum Respected ' + (item.parentName || '') + ',\n*URGENT FEE NOTICE — AL-HUDA ISLAMIC CENTRE*\nYour tuition fee for enrolled student(s) *' + (item.studentsNames || '') + '* has been pending for *' + (item.unpaidMonthsCount || 0) + ' months* (' + (item.unpaidMonthsText || '') + ').\nTotal Outstanding Arrears: *' + (item.currency || 'USD') + ' ' + num(item.totalArrearsDue).toFixed(2) + '*.\nKindly submit your overdue tuition fee as soon as possible. If already paid, please share the payment screenshot or receipt.\nJazakAllahu Khairan!';
  }

  // --------------------------------------------------------------------------
  // #31 — LEAVE FROM INSIDE THE COLLECT FEE FORM. The leave window is the
  // fee form's selected month (1st -> last day). The run reuses the SAME
  // single-student leave core (applyStudentLeave, js/leaves.js) once per
  // student — same validation, same schedule/assignment clean-up. The
  // module only plans the run; the caller supplies applyLeave.
  // --------------------------------------------------------------------------
  function leaveWindowForMonth(monthIdx, year) {
    var m = parseInt(monthIdx, 10);
    if (isNaN(m) || m < 0) m = 0;
    if (m > 11) m = 11;
    var y = parseInt(year, 10) || new Date().getFullYear();
    return {
      startDate: y + '-' + pad2(m + 1) + '-01',
      returnDate: y + '-' + pad2(m + 1) + '-' + pad2(daysInMonth(y, m))
    };
  }

  function planFeeFormLeave(students, monthIdx, year, reason, stateOf) {
    var win = leaveWindowForMonth(monthIdx, year);
    var state = typeof stateOf === 'function' ? stateOf : function () { return 'ok'; };
    var todo = [];
    var skipped = [];
    (Array.isArray(students) ? students : []).forEach(function (s) {
      if (!s || !s.id) return;
      var st = state(s);
      if (st === 'ok') todo.push(s);
      else if (st === 'deactivated') skipped.push({ name: s.name || '', reason: 'Deactivated student — skipped' });
      else if (st === 'on-leave') skipped.push({ name: s.name || '', reason: 'Already on leave — skipped' });
      else skipped.push({ name: s.name || '', reason: 'Skipped' });
    });
    return {
      window: win,
      reason: String(reason || '').trim() || 'Leave',
      todo: todo,
      skipped: skipped
    };
  }

  async function runFeeFormLeave(plan, deps) {
    deps = deps || {};
    if (!plan || !plan.window || !plan.window.startDate || !plan.window.returnDate) {
      throw new Error('Leave from the fee form needs a leave month.');
    }
    if (typeof deps.applyLeave !== 'function') {
      throw new Error('Leave from the fee form needs the leave function.');
    }
    var applied = [];
    var failed = [];
    var todo = Array.isArray(plan.todo) ? plan.todo : [];
    for (var i = 0; i < todo.length; i++) {
      var st = todo[i];
      try {
        var res = await deps.applyLeave(st.id, { startDate: plan.window.startDate, returnDate: plan.window.returnDate, reason: plan.reason });
        if (res && res.ok) applied.push(st.name || st.id);
        else failed.push({ name: st.name || st.id, error: (res && res.error) || 'Leave could not be saved.' });
      } catch (e) {
        failed.push({ name: st.name || st.id, error: (e && e.message) || 'Leave could not be saved.' });
      }
    }
    return {
      applied: applied,
      failed: failed,
      skipped: Array.isArray(plan.skipped) ? plan.skipped : [],
      ok: failed.length === 0,
      window: plan.window
    };
  }

  // --------------------------------------------------------------------------
  // #66 — FAMILIES CSV EXPORT. Frontend-only, from loaded data. Manager
  // role gets contact columns MASKED as the literal string 'Hidden'
  // (managers see contacts as 'Hidden' everywhere in the portal).
  // --------------------------------------------------------------------------
  function notesTextOf(family) {
    if (!family) return '';
    var n = family.notes;
    if (typeof n === 'string') {
      try {
        var p = JSON.parse(n);
        if (p && typeof p === 'object') return String(p.custom_notes || '');
      } catch (e) { /* plain text notes */ }
      return n;
    }
    if (n && typeof n === 'object') return String(n.custom_notes || '');
    return '';
  }

  function csvEsc(v) {
    var s = String(v == null ? '' : v).replace(/\r\n/g, ' ').replace(/\n/g, ' ').replace(/\r/g, ' ');
    if (/[",]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function buildFamiliesCsv(families, opts) {
    opts = opts || {};
    var isManager = !!opts.isManager;
    var header = ['Family ID', 'Parent', 'Students', 'Country', 'WhatsApp', 'Parent Email', 'Monthly Fee', 'Currency', 'Billing Day', 'Status', 'Notes'];
    var lines = [header.map(csvEsc).join(',')];
    (Array.isArray(families) ? families : []).forEach(function (fam) {
      if (!fam) return;
      var students = ((fam.students || []).map(function (s) { return s.name; }).filter(Boolean).join('; '));
      var row = [
        fam.id || '',
        fam.parent_name || '',
        students,
        fam.country || '',
        isManager ? 'Hidden' : (fam.whatsapp || ''),
        isManager ? 'Hidden' : (fam.email || fam.parent_email || ''),
        num(fam.monthly_fee).toFixed(2),
        (fam.currency || 'USD').toUpperCase(),
        (fam.billing_day != null && fam.billing_day !== '') ? String(fam.billing_day) : '',
        fam.status || '',
        notesTextOf(fam)
      ];
      lines.push(row.map(csvEsc).join(','));
    });
    return lines.join('\n');
  }

  function familiesCsvFilename(today) {
    var d = today instanceof Date ? today : new Date();
    return 'alhuda_families_' + d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + '.csv';
  }

  // --------------------------------------------------------------------------
  // #9 / #13 — DUE-DATE FORM HELPERS. The engine lives in js/fee-phase1.js
  // (readFeeDueSettings / dueDayOf / feeTimingOf / getFeeDueDate). These
  // helpers only read the two Add/Edit Family form fields and normalise
  // them for the notes keys `fee_due_day` / `fee_timing`. Empty = unset
  // (defaults apply: dueDay = billing_day, timing = Advance).
  // --------------------------------------------------------------------------
  function parseDueDayInput(value, billingDay) {
    var raw = String(value == null ? '' : value).trim();
    if (raw === '') return null;
    var d = parseInt(raw, 10);
    if (isNaN(d)) return null;
    if (d < 1) d = 1;
    if (d > 31) d = 31;
    return d;
  }

  function parseFeeTimingInput(value) {
    var s = String(value || '').trim().toLowerCase();
    if (s === '') return null;
    if (s.indexOf('end') !== -1 || s.indexOf('after') !== -1 || s.indexOf('arrear') !== -1) return 'Arrears';
    return 'Advance';
  }

  // --------------------------------------------------------------------------
  // PUBLIC EXPORT
  // --------------------------------------------------------------------------
  if (typeof window !== 'undefined') {
    window.FeePhase4 = {
      MONTHS: MONTHS,
      BUILT_IN_CURRENCIES: BUILT_IN_CURRENCIES,
      FEE_METHODS: FEE_METHODS,
      CUSTOM_CURRENCIES_KEY: CUSTOM_CURRENCIES_KEY,
      REMEMBERED_METHODS_KEY: REMEMBERED_METHODS_KEY,
      esc: esc,
      monthIdxOf: monthIdxOf,
      daysInMonth: daysInMonth,
      universalSearch: universalSearch,
      universalSearchFamilyRowHtml: universalSearchFamilyRowHtml,
      universalSearchReceiptRowHtml: universalSearchReceiptRowHtml,
      paidForMonth: paidForMonth,
      isStatusPaidFromRecords: isStatusPaidFromRecords,
      buildCurrencyDetailRows: buildCurrencyDetailRows,
      buildCurrencyPrevMonths: buildCurrencyPrevMonths,
      currencyCodeOf: currencyCodeOf,
      getCustomCurrencies: getCustomCurrencies,
      addCustomCurrency: addCustomCurrency,
      saveCustomCurrencies: saveCustomCurrencies,
      allFeeCurrencies: allFeeCurrencies,
      currencySelectOptionsHtml: currencySelectOptionsHtml,
      loadRememberedMethods: loadRememberedMethods,
      saveRememberedMethod: saveRememberedMethod,
      rememberedMethodFor: rememberedMethodFor,
      waLink: waLink,
      buildReceiptWhatsAppMessage: buildReceiptWhatsAppMessage,
      buildPendingWhatsAppMessage: buildPendingWhatsAppMessage,
      buildDefaulterWhatsAppMessage: buildDefaulterWhatsAppMessage,
      leaveWindowForMonth: leaveWindowForMonth,
      planFeeFormLeave: planFeeFormLeave,
      runFeeFormLeave: runFeeFormLeave,
      notesTextOf: notesTextOf,
      buildFamiliesCsv: buildFamiliesCsv,
      familiesCsvFilename: familiesCsvFilename,
      parseDueDayInput: parseDueDayInput,
      parseFeeTimingInput: parseFeeTimingInput
    };
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = (typeof window !== 'undefined') ? window.FeePhase4 : {};
  }
})();

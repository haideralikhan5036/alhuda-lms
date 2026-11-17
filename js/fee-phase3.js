/**
 * ============================================================================
 * AL-HUDA ISLAMIC CENTRE LMS — FEE UPGRADE PHASE 3
 * File: js/fee-phase3.js
 * Purpose: One-tap Paid/Unpaid month statuses (#33, #36, #45) + Enrollment
 *   Cascade / "Not Enrolled Until This Month" (#32, #46, #47) for the LMS
 *   admin fee tab (Collect Fee, Ledger, Annual Matrix).
 *
 * MECHANISM — ADJ status rows (fee-portal updateFamilyMonthStatuses /
 * setMatrixMonthStatus, Batch 27):
 * - Paid = one ADJ-style status row per family + month, amount ZERO. It
 *   marks the month paid; it is NOT money. Receipt ref
 *   ADJ-YYYYMM-<FAMILYID>, record_kind 'month_status', status
 *   'Paid (Status)', paymentMethod 'One-Tap Quick Status'.
 * - Unpaid = that ADJ row is removed (local records + family-notes
 *   fee_history) and its payments-table row is CANCELLED with a reason —
 *   never hard-deleted, so the financial-row audit rule still holds.
 * - An ADJ row NEVER counts in any money total and NEVER renders as a
 *   receipt: every money reader filters it out (same pattern as the
 *   Phase 1 due-invoice rows). Month-status classification consults it
 *   through isMonthStatusPaid() below.
 * - Mark Paid is REFUSED when the month already has a real (non-ADJ,
 *   non-cancelled) payment — a status must never paper over money.
 *   Mark Unpaid is REFUSED when the month has a real payment — it only
 *   ever removes the ADJ row, never a real payment.
 * - A month is "status-paid" only when an ADJ row exists AND no real
 *   payment exists for that month (money always wins over a stale row).
 *
 * ENROLLMENT CASCADE — no new storage. The marker is the EXISTING
 * ADMISSION_<FAMILYID> entry in the cloud-synced matrix overrides
 * (family notes matrix_overrides + localStorage mirror), i.e. the same
 * admission date the Matrix "Student Admitted / Joined This Month" and
 * "Mark as Not Enrolled" actions already write. Months before the
 * admission month are Not Enrolled via the existing isFamilyPreAdmission
 * check — nothing is double-counted (a month is Not Enrolled when the
 * admission date OR a legacy not_enrolled override says so). The
 * Collect Fee switcher only exposes the same marker (set + clear).
 * Already-paid months stay paid: setting the marker never erases a
 * payment record, and the cascade only changes unpaid months.
 *
 * ROLE SCOPE — one-tap Paid/Unpaid follows the Collect Fee scope:
 * owner + manager (the fee tab and the matrix override actions have no
 * owner-only gate today; a status marker is not money, and the
 * payments-table row is cancelled-with-reason, never deleted).
 * Teachers / parents never reach these surfaces.
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

  function num(v, dflt) {
    var n = parseFloat(v);
    return isFinite(n) ? n : (dflt || 0);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function monthIdxOf(name) {
    if (name == null) return -1;
    if (typeof name === 'number') {
      var m = parseInt(name, 10);
      return (m >= 0 && m <= 11) ? m : -1;
    }
    var s = String(name).trim().toLowerCase();
    for (var i = 0; i < MONTHS.length; i++) {
      if (MONTHS[i].toLowerCase() === s) return i;
    }
    return -1;
  }

  function monthScore(year, monthIdx) {
    return (parseInt(year, 10) || 0) * 100 + monthIdx;
  }

  function isCancelledRecord(r) {
    if (!r) return false;
    var s = String(r.status || '');
    return /cancel/i.test(s) || !!(r.cancel_reason || r.cancelled_at);
  }

  // --------------------------------------------------------------------------
  // ADJ STATUS ROWS — identity + lookup
  // --------------------------------------------------------------------------

  // A status row is recognised by its record_kind first, and by its
  // ADJ-YYYYMM- receipt ref as a fallback (older rows, or rows that came
  // back through a reader that drops recordKind).
  function isMonthStatusRow(r) {
    if (!r) return false;
    if (String(r.recordKind || '') === 'month_status') return true;
    return /^ADJ-\d{6}-/i.test(String(r.receiptNo || ''));
  }

  // One ADJ row per family + month: ADJ-YYYYMM-<FAMILYID>.
  function monthStatusRef(familyId, monthIdx, year) {
    var y = parseInt(year, 10);
    var m = String((parseInt(monthIdx, 10) || 0) + 1).padStart(2, '0');
    return 'ADJ-' + y + m + '-' + String(familyId || '').toUpperCase();
  }

  function sameFamilyMonth(r, familyId, monthIdx, year) {
    return !!r &&
      String(r.familyId || '').toUpperCase() === String(familyId || '').toUpperCase() &&
      monthIdxOf(r.month) === monthIdx &&
      parseInt(r.year, 10) === parseInt(year, 10);
  }

  // The live (non-cancelled) ADJ row for one family + month, or null.
  function findMonthStatusRow(records, familyId, monthIdx, year) {
    var list = Array.isArray(records) ? records : [];
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (sameFamilyMonth(r, familyId, monthIdx, year) && isMonthStatusRow(r) && !isCancelledRecord(r)) return r;
    }
    return null;
  }

  // The live (non-cancelled) REAL payment for one family + month, or
  // null. ADJ rows never count here — money is what this answers.
  function findRealPaymentForMonth(records, familyId, monthIdx, year) {
    var list = Array.isArray(records) ? records : [];
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (sameFamilyMonth(r, familyId, monthIdx, year) && !isMonthStatusRow(r) && !isCancelledRecord(r)) return r;
    }
    return null;
  }

  // True only when an ADJ row exists AND no real payment exists for that
  // month. Money always wins over a stale status row.
  function isMonthStatusPaid(records, familyId, monthIdx, year) {
    return !!findMonthStatusRow(records, familyId, monthIdx, year) &&
      !findRealPaymentForMonth(records, familyId, monthIdx, year);
  }

  // --------------------------------------------------------------------------
  // ADJ RECORD BUILDER
  // --------------------------------------------------------------------------

  function buildMonthStatusRecord(family, monthIdx, year, fee, actorRole) {
    var famId = String((family && family.id) || '');
    var mIdx = parseInt(monthIdx, 10);
    var yInt = parseInt(year, 10);
    var today = new Date().toISOString().slice(0, 10);
    var students = '';
    try {
      students = ((family && family.students) || []).map(function (s) { return s.name; }).filter(Boolean).join(', ');
    } catch (e) { students = ''; }
    return {
      receiptNo: monthStatusRef(famId, mIdx, yInt),
      familyId: famId,
      parentName: (family && family.parent_name) || '',
      studentsNames: students,
      month: MONTHS[mIdx] || '',
      year: yInt,
      date: today,
      currency: (family && family.currency) || 'USD',
      amountPaid: 0,
      totalPayable: 0,
      remainingBalance: 0,
      discount: 0,
      previousBalance: 0,
      creditDeducted: 0,
      excessPaid: 0,
      monthlyFee: num(fee, 0),
      status: 'Paid (Status)',
      recordKind: 'month_status',
      paymentMethod: 'One-Tap Quick Status',
      transactionId: null,
      markedBy: actorRole || '',
      notes: 'Marked Paid via one-tap status (no payment recorded).'
    };
  }

  // --------------------------------------------------------------------------
  // VALIDATION — the safe behaviour for both directions
  // --------------------------------------------------------------------------

  function validateMarkPaid(ctx) {
    ctx = ctx || {};
    var fam = ctx.family || null;
    if (!fam || !fam.id) return { ok: false, code: 'no_family', error: 'Select a family first.' };
    var mIdx = parseInt(ctx.monthIdx, 10);
    var yInt = parseInt(ctx.year, 10);
    if (mIdx < 0 || mIdx > 11 || isNaN(yInt)) return { ok: false, code: 'bad_month', error: 'Choose a valid month.' };
    if (ctx.isPreAdmission) return { ok: false, code: 'pre_admission', error: 'This month is before the family joined — it is already Not Enrolled.' };
    if (ctx.isNotEnrolled) return { ok: false, code: 'not_enrolled', error: 'This month is marked Not Enrolled — clear that first to mark it Paid.' };
    if (ctx.isLeave) return { ok: false, code: 'leave', error: 'This month is on approved leave (fee waived) — it cannot be marked Paid.' };
    if (ctx.isFuture) return { ok: false, code: 'future', error: 'This month has not started yet — future months cannot be marked Paid.' };
    if (findRealPaymentForMonth(ctx.records, fam.id, mIdx, yInt)) return { ok: false, code: 'has_payment', error: 'This month already has a payment recorded — it is paid by that payment. Mark Paid never papers over money.' };
    if (findMonthStatusRow(ctx.records, fam.id, mIdx, yInt)) return { ok: false, code: 'already_paid', error: 'This month is already marked Paid.' };
    return { ok: true, code: '', error: '' };
  }

  function validateMarkUnpaid(ctx) {
    ctx = ctx || {};
    var fam = ctx.family || null;
    if (!fam || !fam.id) return { ok: false, code: 'no_family', error: 'Select a family first.' };
    var mIdx = parseInt(ctx.monthIdx, 10);
    var yInt = parseInt(ctx.year, 10);
    if (mIdx < 0 || mIdx > 11 || isNaN(yInt)) return { ok: false, code: 'bad_month', error: 'Choose a valid month.' };
    var row = findMonthStatusRow(ctx.records, fam.id, mIdx, yInt);
    if (!row) return { ok: false, code: 'not_marked', error: 'This month is not marked Paid by one-tap status.' };
    if (findRealPaymentForMonth(ctx.records, fam.id, mIdx, yInt)) return { ok: false, code: 'has_payment', error: 'This month has a real payment recorded — undo or cancel the payment first. Mark Unpaid never touches a real payment.' };
    return { ok: true, code: '', error: '', row: row };
  }

  // --------------------------------------------------------------------------
  // UI STATE — one shared reading of a matrix month object
  // --------------------------------------------------------------------------

  // m: a matrix month object { isPaid, isPartial, isLeave, isNotEnrolled,
  // isFuture, isStatusPaid, amountPaid }. Returns one of:
  // 'paid_receipt' | 'paid_status' | 'partial' | 'due' | 'leave' |
  // 'not_enrolled' | 'future'.
  function uiStateForMonth(m) {
    m = m || {};
    if (m.isPaid && m.isStatusPaid) return 'paid_status';
    if (m.isPaid) return 'paid_receipt';
    if (m.isPartial) return 'partial';
    if (m.isLeave) return 'leave';
    if (m.isNotEnrolled) return 'not_enrolled';
    if (m.isFuture) return 'future';
    return 'due';
  }

  // What a click on a cell of this state stages, or null when the cell
  // cannot be toggled at all (money months, leave, not-enrolled, future).
  function stagedToggleNext(uiState) {
    if (uiState === 'due') return 'paid';
    if (uiState === 'paid_status') return 'unpaid';
    return null;
  }

  function statusBadgeHtml(uiState, currency, amountPaid) {
    var amt = currency + ' ' + num(amountPaid, 0).toFixed(0);
    if (uiState === 'paid_receipt') return '<span class="text-emerald-800 font-extrabold text-[10px] block"><i class="fa-solid fa-check mr-0.5"></i>Paid</span><span class="text-emerald-700 font-bold font-mono text-[9px] block">' + esc(amt) + '</span>';
    if (uiState === 'paid_status') return '<span class="text-emerald-800 font-extrabold text-[10px] block"><i class="fa-solid fa-check mr-0.5"></i>Paid</span><span class="text-[9px] font-bold text-emerald-600 block">STATUS</span>';
    if (uiState === 'partial') return '<span class="text-amber-800 font-bold text-[10px] block">Part</span><span class="text-amber-700 font-mono text-[9px] block">' + esc(amt) + '</span>';
    if (uiState === 'leave') return '<span class="text-blue-700 font-bold text-[10px] block"><i class="fa-solid fa-plane-departure mr-0.5"></i>Leave</span>';
    if (uiState === 'not_enrolled') return '<span class="text-slate-400 font-bold text-[10px] block">N/A</span>';
    if (uiState === 'future') return '<span class="text-slate-300 text-[10px]">--</span>';
    return '<span class="text-rose-700 font-extrabold text-[10px] block"><i class="fa-solid fa-xmark mr-0.5"></i>Due</span>';
  }

  // --------------------------------------------------------------------------
  // STAGED SWITCHER (Collect Fee) — grid + enrollment row
  // --------------------------------------------------------------------------

  // months: the family's 12 matrix month objects for the year, in order.
  // staged: { [monthIdx]: 'paid' | 'unpaid' } — the toggles not yet saved.
  function switcherGridHtml(months, staged) {
    staged = staged || {};
    var list = Array.isArray(months) ? months : [];
    return list.map(function (m, idx) {
      var state = uiStateForMonth(m);
      var next = stagedToggleNext(state);
      var stagedTo = staged[idx] || null;
      var canToggle = !!next;
      var cellBg = 'bg-white';
      if (state === 'paid_receipt' || state === 'paid_status') cellBg = 'bg-emerald-50';
      else if (state === 'partial') cellBg = 'bg-amber-50';
      else if (state === 'leave') cellBg = 'bg-blue-50';
      else if (state === 'not_enrolled') cellBg = 'bg-slate-100';
      else if (state === 'due') cellBg = 'bg-rose-50';
      var ring = stagedTo ? ' ring-2 ring-amber-500' : '';
      var stagedTag = stagedTo
        ? '<span class="block text-[9px] font-black text-amber-700 mt-0.5">STAGED: ' + (stagedTo === 'paid' ? 'PAID' : 'UNPAID') + '</span>'
        : '';
      var hint = canToggle
        ? 'Click to mark ' + (next === 'paid' ? 'Paid' : 'Unpaid') + ' (staged — Save to apply)'
        : (state === 'paid_receipt' ? 'Paid by a recorded payment' : (state === 'partial' ? 'Partial payment recorded' : (state === 'leave' ? 'On approved leave' : (state === 'not_enrolled' ? 'Not enrolled' : 'Future month'))));
      return '<button type="button"' + (canToggle ? ' onclick="toggleStagedMonthStatus(' + idx + ')"' : ' disabled') +
        ' title="' + esc(hint) + '" class="' + cellBg + ring + ' p-2 border border-slate-200 rounded-xl text-left transition ' +
        (canToggle ? 'cursor-pointer hover:ring-2 hover:ring-emerald-500/50' : 'cursor-not-allowed opacity-80') + '">' +
        '<span class="text-[11px] font-extrabold text-slate-800 block">' + esc(m.month || MONTHS[idx] || '') + '</span>' +
        statusBadgeHtml(state, '', m.amountPaid || 0) + stagedTag +
        '</button>';
    }).join('');
  }

  // The "Not enrolled until" row under the grid. enrollInfo is the
  // getFamilyEnrollmentInfo result { year, monthIndex, monthName, source }.
  // formYear is the fee-form year the grid shows.
  function enrollmentRowHtml(enrollInfo, formYear) {
    var info = enrollInfo || { year: formYear, monthIndex: 0, monthName: 'January', source: 'default' };
    var isManual = info.source === 'manual_override';
    var opts = MONTHS.map(function (mn, i) {
      return '<option value="' + i + '"' + (i === info.monthIndex ? ' selected' : '') + '>' + mn + '</option>';
    }).join('');
    return '<div class="flex flex-wrap items-center gap-2">' +
      '<span class="text-[11px] font-bold text-slate-700">Not enrolled until:</span>' +
      '<select id="feeStatusEnrollMonth" class="p-2 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-800">' + opts + '</select>' +
      '<input type="number" id="feeStatusEnrollYear" value="' + parseInt(formYear, 10) + '" class="w-20 p-2 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-800">' +
      '<button type="button" onclick="applyFeeEnrollmentUntil()" class="px-3 py-2 bg-slate-700 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition">Apply</button>' +
      (isManual ? '<button type="button" onclick="clearFeeEnrollmentDate()" class="px-3 py-2 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 rounded-xl text-xs font-bold transition">Clear (back to joining date)</button>' : '') +
      '</div>' +
      '<p class="text-[11px] text-slate-500 mt-1.5">Enrolled from: <strong class="text-slate-700">' + esc(info.monthName) + ' ' + parseInt(info.year, 10) + '</strong>' +
      (isManual ? ' <span class="text-amber-700 font-bold">(set here)</span>' : ' <span>(from joining date)</span>') +
      ' — months before this become Not Enrolled (no fee, no arrears). Already-paid months stay paid.</p>';
  }

  // --------------------------------------------------------------------------
  // MATRIX MODAL + LEDGER — per-month action buttons
  // --------------------------------------------------------------------------

  // Buttons / note for the Matrix action modal, for one month state.
  // receiptNo is the real payment receipt when the month is paid by money.
  function matrixStatusButtonsHtml(uiState, receiptNo) {
    if (uiState === 'due') {
      return '<button type="button" onclick="applyMatrixAction(\'mark_paid\')" class="w-full p-3 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-left transition flex items-center justify-between shadow-2xs">' +
        '<span class="flex items-center gap-2.5"><span class="w-8 h-8 rounded-lg bg-white/20 text-white flex items-center justify-center text-sm font-bold"><i class="fa-solid fa-check"></i></span>' +
        '<span><strong class="text-xs text-white block">Mark Paid (One-Tap)</strong><span class="text-[10px] text-emerald-200 block">No payment recorded — marks this month settled by status</span></span></span>' +
        '<i class="fa-solid fa-arrow-right text-white text-xs"></i></button>';
    }
    if (uiState === 'paid_status') {
      return '<div class="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-[11px] text-emerald-900 font-bold">This month is marked Paid by one-tap status (no payment recorded).</div>' +
        '<button type="button" onclick="applyMatrixAction(\'mark_unpaid\')" class="w-full p-3 rounded-xl bg-white border-2 border-rose-300 hover:bg-rose-50 text-left transition flex items-center justify-between">' +
        '<span class="flex items-center gap-2.5"><span class="w-8 h-8 rounded-lg bg-rose-100 text-rose-700 flex items-center justify-center text-sm font-bold"><i class="fa-solid fa-rotate-left"></i></span>' +
        '<span><strong class="text-xs text-rose-900 block">Mark Unpaid</strong><span class="text-[10px] text-rose-700 block">Removes the status mark — the month becomes due again</span></span></span>' +
        '<i class="fa-solid fa-chevron-right text-rose-400 text-xs"></i></button>';
    }
    if (uiState === 'paid_receipt') {
      return '<div class="p-3 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-700 font-bold">Paid by a recorded payment' + (receiptNo ? ' (' + esc(receiptNo) + ')' : '') + ' — to change this month, cancel or undo the payment first. One-tap status never touches real money.</div>' +
        (receiptNo && window.FeePhase1 && typeof window.FeePhase1.requestUndoFeePayment === 'function'
          ? '<button type="button" onclick="window.FeePhase1.requestUndoFeePayment(\'' + String(receiptNo).replace(/'/g, "\\'") + '\')" class="w-full p-3 rounded-xl bg-amber-100 hover:bg-amber-200 border border-amber-300 text-left transition flex items-center justify-between">' +
            '<span class="flex items-center gap-2.5"><span class="w-8 h-8 rounded-lg bg-amber-200 text-amber-800 flex items-center justify-center text-sm font-bold"><i class="fa-solid fa-rotate-left"></i></span>' +
            '<span><strong class="text-xs text-amber-900 block">Undo Payment</strong><span class="text-[10px] text-amber-800 block">Only the newest payment can be undone</span></span></span>' +
            '<i class="fa-solid fa-chevron-right text-amber-600 text-xs"></i></button>'
          : '');
    }
    if (uiState === 'partial') {
      return '<div class="p-3 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-900 font-bold">A partial payment is recorded for this month — collect the balance, or cancel the payment first. One-tap Paid is not available while money is recorded.</div>';
    }
    if (uiState === 'leave') {
      return '<div class="p-3 rounded-xl bg-blue-50 border border-blue-200 text-[11px] text-blue-900 font-bold">This month is on approved leave (fee waived) — one-tap status does not apply.</div>';
    }
    if (uiState === 'not_enrolled') {
      return '<div class="p-3 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-700 font-bold">This month is Not Enrolled — one-tap status does not apply.</div>';
    }
    return '<div class="p-3 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-700 font-bold">This month has not started yet — one-tap status does not apply to future months.</div>';
  }

  // Small button for one Ledger month card, or '' when no action applies.
  function ledgerStatusButtonHtml(uiState, monthName) {
    var m = String(monthName || '').replace(/'/g, "\\'");
    if (uiState === 'due') {
      return '<button type="button" onclick="ledgerMarkMonthPaid(\'' + m + '\')" class="mt-1 px-2 py-1 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-[10px] font-bold transition">Mark Paid</button>';
    }
    if (uiState === 'paid_status') {
      return '<button type="button" onclick="ledgerMarkMonthUnpaid(\'' + m + '\')" class="mt-1 px-2 py-1 bg-white border border-rose-300 hover:bg-rose-50 text-rose-700 rounded-lg text-[10px] font-bold transition">Mark Unpaid</button>';
    }
    return '';
  }

  if (typeof window !== 'undefined') {
    window.FeePhase3 = {
      MONTHS: MONTHS,
      esc: esc,
      monthIdxOf: monthIdxOf,
      monthScore: monthScore,
      isCancelledRecord: isCancelledRecord,
      isMonthStatusRow: isMonthStatusRow,
      monthStatusRef: monthStatusRef,
      findMonthStatusRow: findMonthStatusRow,
      findRealPaymentForMonth: findRealPaymentForMonth,
      isMonthStatusPaid: isMonthStatusPaid,
      buildMonthStatusRecord: buildMonthStatusRecord,
      validateMarkPaid: validateMarkPaid,
      validateMarkUnpaid: validateMarkUnpaid,
      uiStateForMonth: uiStateForMonth,
      stagedToggleNext: stagedToggleNext,
      statusBadgeHtml: statusBadgeHtml,
      switcherGridHtml: switcherGridHtml,
      enrollmentRowHtml: enrollmentRowHtml,
      matrixStatusButtonsHtml: matrixStatusButtonsHtml,
      ledgerStatusButtonHtml: ledgerStatusButtonHtml
    };
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = (typeof window !== 'undefined') ? window.FeePhase3 : {};
  }
})();

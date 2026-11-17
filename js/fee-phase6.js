// ============================================================================
// FEE DASHBOARD + FORM IMPROVEMENTS — PHASE 6
//
// Pure logic for the 2026-11-17 dashboard + form brief. No DOM, no Worker,
// no storage access here — the glue in js/fees.js passes plain values in
// and renders what these helpers return, exactly like Phases 1-5.
//
//   Multi Month Payments (#4): the month selector options, the per-month
//     actual-fee total, the chronological waterfall allocation of the
//     amount paid, and the per-month record sequence (same shape as the
//     old advance sequence — receiptNo-1..N, first record carries the
//     previous balance / credit / discount / form totals).
//   Remind All two-step confirm (#7): the confirm dialog config — the
//     brief's exact question with explicit Cancel / Confirm & Send
//     Reminders buttons. The 4th-of-month auto trigger never asks.
//   Receipts month filter (#1): the Paid KPI opens Receipts filtered to
//     the selected billing month; only real payments match (cancelled
//     rows and ADJ status rows never do).
// ============================================================================
(function () {
  'use strict';

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function num(v) {
    var n = parseFloat(v || 0);
    return isNaN(n) ? 0 : n;
  }

  function monthIdxOf(name) {
    var n = String(name || '').trim().toLowerCase();
    for (var i = 0; i < MONTHS.length; i++) {
      if (MONTHS[i].toLowerCase() === n) return i;
    }
    return -1;
  }

  function monthScore(monthIdx, year) {
    return parseInt(year, 10) * 100 + parseInt(monthIdx, 10);
  }

  function monthKey(monthIdx, year) {
    return String(year) + '-' + ('0' + (parseInt(monthIdx, 10) + 1)).slice(-2);
  }

  function monthLabel(monthIdx, year) {
    return MONTHS[parseInt(monthIdx, 10)] + ' ' + year;
  }

  // ---- record predicates (mirrors of Phase 1 / Phase 3) --------------------

  // Cancelled means cancelled — a cancelled record is never money paid,
  // never a paid month, never a receipt.
  function isCancelledFeeRecord(r) {
    if (!r) return false;
    return String(r.status || '').toLowerCase().indexOf('cancel') !== -1;
  }

  // An ADJ status row (record_kind 'month_status', ref ADJ-YYYYMM-...) is
  // not a payment and must never count as money anywhere.
  function isMonthStatusRow(r) {
    if (!r) return false;
    if (String(r.recordKind || '') === 'month_status') return true;
    return /^ADJ-\d{6}-/i.test(String(r.receiptNo || ''));
  }

  // Real money paid for one family + month (amount + discount on live
  // records only; cancelled rows and ADJ status rows contribute nothing).
  function paidSoFarForMonth(records, familyId, monthIdx, year) {
    var fam = String(familyId || '').toUpperCase();
    var total = 0;
    (records || []).forEach(function (r) {
      if (!r || String(r.familyId || '').toUpperCase() !== fam) return;
      if (monthIdxOf(r.month) !== parseInt(monthIdx, 10)) return;
      if (parseInt(r.year, 10) !== parseInt(year, 10)) return;
      if (isCancelledFeeRecord(r)) return;
      if (isMonthStatusRow(r)) return;
      total += num(r.amountPaid) + num(r.discount);
    });
    return total;
  }

  // Settled by an ADJ status row with NO real payment (money always wins
  // over a stale status row — same rule as Phase 3 isMonthStatusPaid).
  function isMonthSettledByStatus(records, familyId, monthIdx, year) {
    var fam = String(familyId || '').toUpperCase();
    var hasStatus = false;
    var hasReal = false;
    (records || []).forEach(function (r) {
      if (!r || String(r.familyId || '').toUpperCase() !== fam) return;
      if (monthIdxOf(r.month) !== parseInt(monthIdx, 10)) return;
      if (parseInt(r.year, 10) !== parseInt(year, 10)) return;
      if (isCancelledFeeRecord(r)) return;
      if (isMonthStatusRow(r)) hasStatus = true; else hasReal = true;
    });
    return hasStatus && !hasReal;
  }

  // ---- Multi Month Payments -------------------------------------------------
  //
  // The selector window is anchored on the fee form month: 12 months back
  // to 12 months forward (25 boxes), driven by the family's real billing
  // facts — never a hardcoded month list. Each option carries its ACTUAL
  // applicable fee for that month (timeline-aware, via the caller), what
  // is already paid for it, and what is still outstanding.
  //
  // States:
  //   available    — can be picked; charge is the outstanding amount.
  //   paid         — already settled (real payment or ADJ status row);
  //                  shown with a Paid badge, picked only after the
  //                  caller confirms the explicit warning; charge is
  //                  the FULL fee (a deliberate second payment).
  //   not_enrolled — before admission (or an explicit not_enrolled
  //                  override); cannot be picked.
  //   leave        — approved leave for that month (fee waived); cannot
  //                  be picked.
  //   no_fee       — the applicable fee for the month is zero; cannot
  //                  be picked (a zero-amount record would be noise).
  //
  // The selector shows ONE year at a time (12 months) with a year
  // dropdown: build three full years around the form year so every
  // year in the dropdown has all 12 months. Each month is charged its
  // ACTUAL applicable fee for that month — never fee x N — and a
  // month that is already settled can still be picked (a deliberate
  // second payment), while leave / not-enrolled / no-fee months are
  // shown disabled, never charged.
  //
  // args: { fam, records, overrides, anchorMonthIdx, anchorYear,
  //         enrollment: { year, monthIndex },
  //         isLeaveMonth: function (monthIdx, year) -> bool,
  //         applicableFee: function (monthIdx, year) -> number }
  function buildMultiMonthOptions(args) {
    var a = args || {};
    var fam = a.fam || {};
    var records = a.records || [];
    var overrides = a.overrides || {};
    var anchorYear = parseInt(a.anchorYear, 10) || new Date().getFullYear();
    var enrollment = a.enrollment || null;
    var enrollScore = enrollment ? monthScore(enrollment.monthIndex, enrollment.year) : null;
    var famUpper = String(fam.id || '').toUpperCase();
    var options = [];
    for (var yr = anchorYear - 1; yr <= anchorYear + 1; yr++) {
      for (var mIdx = 0; mIdx < 12; mIdx++) {
      var key = monthKey(mIdx, yr);
      // No family picked yet: the fee is UNKNOWN, not zero — the month
      // stays selectable and shows a dash until a family is picked.
      var rawFee = (typeof a.applicableFee === 'function') ? a.applicableFee(mIdx, yr) : 0;
      var fee = (rawFee === null || rawFee === undefined) ? null : num(rawFee);
      var paidSoFar = paidSoFarForMonth(records, fam.id, mIdx, yr);
      var settledByStatus = isMonthSettledByStatus(records, fam.id, mIdx, yr);
      var overrideKey = famUpper + '_' + MONTHS[mIdx].toLowerCase() + '_' + yr;
      var manual = overrides[overrideKey];
      var manualStatus = manual ? String(manual.status || '').toLowerCase() : '';
      var score = monthScore(mIdx, yr);
      var opt = {
        monthIdx: mIdx, year: yr, key: key, label: monthLabel(mIdx, yr),
        fee: fee, paidSoFar: paidSoFar,
        outstanding: fee === null ? null : Math.max(0, fee - paidSoFar),
        state: 'available', reason: ''
      };
      if (enrollScore !== null && score < enrollScore) {
        opt.state = 'not_enrolled';
        opt.reason = 'Not enrolled yet';
      } else if (manualStatus === 'not_enrolled') {
        opt.state = 'not_enrolled';
        opt.reason = 'Not enrolled';
      } else if (manualStatus === 'leave' || (typeof a.isLeaveMonth === 'function' && a.isLeaveMonth(mIdx, yr))) {
        opt.state = 'leave';
        opt.reason = 'On leave — fee waived';
      } else if (fee === null) {
        // Fee unknown (no family yet) — stays available, shown as a dash.
      } else if (fee <= 0) {
        opt.state = 'no_fee';
        opt.reason = 'No fee due';
      } else if (manualStatus === 'paid' || settledByStatus || paidSoFar >= fee - 0.01) {
        opt.state = 'paid';
        opt.reason = settledByStatus || manualStatus === 'paid'
          ? 'Marked Paid (no payment)'
          : 'Paid — Receipt on file';
      }
      options.push(opt);
      }
    }
    return options;
  }

  // The review total for a selection: each month contributes its
  // outstanding amount, except a confirmed already-paid month, which
  // contributes its full fee (a deliberate second payment). Never
  // fee x N — every month pays its own actual fee.
  function multiMonthSelectionTotal(selected) {
    var rows = [];
    var total = 0;
    (selected || []).forEach(function (s) {
      var charge = s.state === 'paid' ? num(s.fee) : Math.max(0, num(s.fee) - num(s.paidSoFar));
      rows.push({
        key: s.key, monthIdx: s.monthIdx, year: s.year, label: s.label,
        fee: (s.fee === null || s.fee === undefined) ? null : num(s.fee), paidSoFar: num(s.paidSoFar), charge: charge, state: s.state
      });
      total += charge;
    });
    rows.sort(function (x, y) { return monthScore(x.monthIdx, x.year) - monthScore(y.monthIdx, y.year); });
    return { total: total, rows: rows };
  }

  // Waterfall: the amount actually paid now is spread across the
  // selected months in chronological order — the earliest month is
  // settled first, the rest take what is left. No month is ever
  // allocated more than its charge, and the allocation never exceeds
  // the amount paid.
  function allocateMultiMonthPayment(selected, amountPaid) {
    var calc = multiMonthSelectionTotal(selected);
    var remaining = Math.max(0, num(amountPaid));
    return calc.rows.map(function (r) {
      var alloc = Math.min(r.charge, remaining);
      remaining = Math.max(0, remaining - alloc);
      return {
        key: r.key, monthIdx: r.monthIdx, year: r.year, label: r.label,
        fee: r.fee, charge: r.charge, allocated: alloc
      };
    });
  }

  // Per-month records for a Multi Month payment, in the SAME shape as
  // the old advance sequence: receiptNo-1..N, the first record carries
  // the previous balance / credit / discount / form totals / status /
  // excess, later months carry only their own fee, charge and
  // allocation. The discount lives on the first record only (the old
  // advance spread copied it onto every record). A single selected
  // month saves as one plain record under the base receipt number.
  function buildMultiMonthSequence(paymentRecord, selected, allocation) {
    var calc = multiMonthSelectionTotal(selected);
    var rows = calc.rows;
    var base = paymentRecord || {};
    if (!rows || rows.length === 0) return [];
    var allocByKey = {};
    (allocation || []).forEach(function (x) { allocByKey[x.key] = x; });
    if (rows.length === 1) {
      var only = rows[0];
      var single = {};
      Object.keys(base).forEach(function (k) { single[k] = base[k]; });
      single.month = MONTHS[only.monthIdx];
      single.year = only.year;
      single.monthlyFee = only.fee;
      single.amountPaid = num(base.amountPaid);
      single.isAdvancePayment = false;
      single.advanceMonthsCount = 1;
      return [single];
    }
    return rows.map(function (r, i) {
      var alloc = allocByKey[r.key] || { allocated: 0 };
      var allocated = num(alloc.allocated);
      var rec = {};
      Object.keys(base).forEach(function (k) { rec[k] = base[k]; });
      rec.receiptNo = String(base.receiptNo || '') + '-' + (i + 1);
      rec.month = MONTHS[r.monthIdx];
      rec.year = r.year;
      rec.monthlyFee = r.fee;
      rec.previousBalance = i === 0 ? num(base.previousBalance) : 0;
      rec.creditDeducted = i === 0 ? num(base.creditDeducted) : 0;
      rec.totalPayable = i === 0 ? num(base.totalPayable) : r.charge;
      rec.amountPaid = allocated;
      rec.discount = i === 0 ? num(base.discount) : 0;
      rec.remainingBalance = i === 0
        ? num(base.remainingBalance)
        : Math.max(0, r.charge - allocated);
      rec.excessPaid = i === 0 ? num(base.excessPaid) : 0;
      rec.status = i === 0
        ? base.status
        : (allocated >= r.charge - 0.01 ? 'Paid in Advance' : 'Partial (Balance Remaining)');
      rec.isAdvancePayment = true;
      rec.advanceMonthsCount = rows.length;
      rec.isMultiMonthPayment = true;
      return rec;
    });
  }

  // ---- Remind All two-step confirm -------------------------------------------
  //
  // The brief's exact question, with explicit button labels. The details
  // (period, counts, quota notice) stay above the question so nothing
  // the old dialog told the user is lost. The caller still skips this
  // entirely when isAuto4thTrigger is true.
  var REMIND_ALL_QUESTION = 'Are you sure you want to send fee reminders to all eligible families?';

  function remindAllConfirmConfig(args) {
    var a = args || {};
    var kind = String(a.kind || 'pending');
    var period = String(a.period || '');
    var total = parseInt(a.total, 10) || 0;
    var withEmail = (a.withEmail === undefined || a.withEmail === null) ? null : parseInt(a.withEmail, 10);
    var lines = [];
    if (kind === 'defaulters') {
      lines.push('Remind All 3+ Month Defaulters' + (period ? ' — ' + period : ''));
      lines.push('');
      lines.push('Total 3+ Month Defaulter Families: ' + total);
      if (withEmail !== null) lines.push('Families with Valid Email: ' + withEmail);
      lines.push('');
      lines.push('The urgent 3+ Months Overdue Fee Reminder will be sent to each eligible family.');
    } else {
      lines.push('Remind All Parents' + (period ? ' — ' + period : ''));
      lines.push('');
      lines.push('Total Pending Families: ' + total);
      if (withEmail !== null) lines.push('Families with Valid Email: ' + withEmail);
      lines.push('');
      lines.push('The official ' + (period || 'selected month') + ' Pending Fee email will be sent to each eligible family.');
    }
    if (a.quotaNote) {
      lines.push('');
      lines.push(String(a.quotaNote));
    }
    lines.push('');
    lines.push(REMIND_ALL_QUESTION);
    return {
      title: kind === 'defaulters' ? 'Send Defaulter Reminders?' : 'Send Fee Reminders?',
      message: lines.join('\n'),
      confirmText: 'Confirm & Send Reminders',
      cancelText: 'Cancel',
      variant: 'warning'
    };
  }

  // ---- Receipts month filter ---------------------------------------------------
  //
  // The Paid KPI opens Receipts filtered to the selected BILLING month
  // (record month/year — the same fields the dashboard Paid count uses).
  // Only real payments match: cancelled rows and ADJ status rows never
  // appear as paid receipts.
  function isReceiptInMonth(r, monthIdx, year) {
    if (!r) return false;
    if (isCancelledFeeRecord(r)) return false;
    if (isMonthStatusRow(r)) return false;
    if (monthIdxOf(r.month) !== parseInt(monthIdx, 10)) return false;
    return parseInt(r.year, 10) === parseInt(year, 10);
  }

  function receiptsMonthFilterLabel(monthIdx, year) {
    return monthLabel(monthIdx, year);
  }

  window.FeePhase6 = {
    MONTHS: MONTHS,
    esc: esc,
    monthIdxOf: monthIdxOf,
    monthKey: monthKey,
    monthLabel: monthLabel,
    monthScore: monthScore,
    isCancelledFeeRecord: isCancelledFeeRecord,
    isMonthStatusRow: isMonthStatusRow,
    paidSoFarForMonth: paidSoFarForMonth,
    isMonthSettledByStatus: isMonthSettledByStatus,
    buildMultiMonthOptions: buildMultiMonthOptions,
    multiMonthSelectionTotal: multiMonthSelectionTotal,
    allocateMultiMonthPayment: allocateMultiMonthPayment,
    buildMultiMonthSequence: buildMultiMonthSequence,
    REMIND_ALL_QUESTION: REMIND_ALL_QUESTION,
    remindAllConfirmConfig: remindAllConfirmConfig,
    isReceiptInMonth: isReceiptInMonth,
    receiptsMonthFilterLabel: receiptsMonthFilterLabel
  };
})();

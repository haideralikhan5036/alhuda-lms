/**
 * ============================================================================
 * AL-HUDA ISLAMIC CENTRE LMS — FEE UPGRADE PHASE 1
 * File: js/fee-phase1.js
 * Purpose: Fee-history timeline + effective fee change date (fee-portal
 *   Batches 19-21), Undo Payment (Batch 17) and Fee Due Invoice
 *   (Batches 15-16) for the LMS admin fee tab.
 *
 * Design notes (adaptations from the fee portal, Batch 27):
 * - Fee revisions live in family.notes under the NEW key `fee_revisions`
 *   (an array). The LMS `notes.fee_history` holds PAYMENT records, never
 *   fee revisions, so the two are never mixed.
 * - The LMS has no per-family dueDay / feeTiming fields, so the due date
 *   is always Advance timing on the family's `billing_day` (default 1).
 * - LMS receipts are client-side (no stored PDF), so Undo has no PDF to
 *   trash; the payments-table row is CANCELLED, never hard-deleted
 *   (the Worker denies payments deletes for every role), and every Undo
 *   write is recorded in the server-side audit_log automatically.
 * - A due invoice is a payments-table row with record_kind =
 *   'due_invoice' and receipt_no = the DUE ref (server-side UNIQUE),
 *   kept out of every money reader by loadPaymentsForFamily, which
 *   filters that kind out.
 * - Pure functions take explicit inputs so the test suites can execute
 *   the real logic without a browser. DOM helpers guard on `document`.
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

  function daysInMonth(year, monthIdx) {
    var y = parseInt(year, 10) || 2000;
    if (monthIdx === 1) {
      var leap = (y % 4 === 0 && y % 100 !== 0) || (y % 400 === 0);
      return leap ? 29 : 28;
    }
    return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][monthIdx] || 30;
  }

  function todayStr() {
    try {
      return new Date().toISOString().slice(0, 10);
    } catch (e) {
      return '2026-11-17';
    }
  }

  function isCancelledRecord(r) {
    if (!r) return false;
    var s = String(r.status || '').toLowerCase();
    return s === 'cancelled' || s.indexOf('cancel') !== -1;
  }

  // Fee Upgrade Phase 3 — an ADJ status row (record_kind
  // 'month_status', ref ADJ-YYYYMM-...) is not a payment and must never
  // shadow a real payment here, or count as arrears below. Mirror of
  // FeePhase3.isMonthStatusRow — this file loads first, so the predicate
  // is duplicated here and pinned by tests on both sides.
  function isMonthStatusRow(r) {
    if (!r) return false;
    if (String(r.recordKind || '') === 'month_status') return true;
    return /^ADJ-\d{6}-/i.test(String(r.receiptNo || ''));
  }

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // --------------------------------------------------------------------------
  // FEE REVISIONS — the [FeeHistory] timeline, stored as notes.fee_revisions
  // --------------------------------------------------------------------------

  // Read the revision timeline from a family record, a notes object, or a
  // raw notes string. Always returns a sorted, normalised array (never
  // throws, never mutates the input).
  function parseFeeRevisions(input) {
    var raw = null;
    if (!input) return [];
    if (Array.isArray(input)) raw = input;
    else if (typeof input === 'object') {
      if (Array.isArray(input.fee_revisions)) raw = input.fee_revisions;
      else if (typeof input.notes === 'object' && input.notes && Array.isArray(input.notes.fee_revisions)) raw = input.notes.fee_revisions;
      else if (typeof input.notes === 'string') {
        try {
          var parsed = JSON.parse(input.notes);
          if (parsed && Array.isArray(parsed.fee_revisions)) raw = parsed.fee_revisions;
        } catch (e) { raw = null; }
      }
    } else if (typeof input === 'string') {
      try {
        var p2 = JSON.parse(input);
        if (p2 && Array.isArray(p2.fee_revisions)) raw = p2.fee_revisions;
      } catch (e) { raw = null; }
    }
    if (!Array.isArray(raw)) return [];
    var out = [];
    raw.forEach(function (r) {
      var n = normalizeFeeRevision(r);
      if (n) out.push(n);
    });
    out.sort(function (a, b) { return monthScore(a.effectiveYear, a.effectiveMonthIdx) - monthScore(b.effectiveYear, b.effectiveMonthIdx); });
    return out;
  }

  // Validate one revision (mirrors fee-portal normalizeFeeRevisionInternal_).
  // Returns the normalised revision or null when it cannot be used.
  function normalizeFeeRevision(r) {
    if (!r || typeof r !== 'object') return null;
    var monthIdx = (r.effectiveMonthIdx !== undefined && r.effectiveMonthIdx !== null && r.effectiveMonthIdx !== '')
      ? parseInt(r.effectiveMonthIdx, 10)
      : monthIdxOf(r.effectiveMonth);
    var year = parseInt(r.effectiveYear, 10);
    if (isNaN(monthIdx) || monthIdx < 0 || monthIdx > 11) return null;
    if (isNaN(year) || year < 2000 || year > 2100) return null;
    var newFee = num(r.newFee, NaN);
    var prevFee = num(r.prevFee, NaN);
    if (!isFinite(newFee) || newFee < 0) return null;
    if (!isFinite(prevFee) || prevFee < 0) return null;
    var reason = String(r.reason || '').trim().slice(0, 160);
    var addedStudent = String(r.addedStudent || '').trim().slice(0, 120);
    var joiningDate = String(r.joiningDate || '').trim().slice(0, 20);
    var revisedDate = String(r.revisedDate || '').trim().slice(0, 10) || todayStr();
    return {
      effectiveYear: year,
      effectiveMonth: MONTHS[monthIdx],
      effectiveMonthIdx: monthIdx,
      prevFee: prevFee,
      newFee: newFee,
      revisedDate: revisedDate,
      reason: reason,
      addedStudent: addedStudent,
      joiningDate: joiningDate
    };
  }

  // Upsert one revision: a revision for the same effective month REPLACES
  // the old one but PRESERVES the original prevFee / addedStudent /
  // joiningDate (fee-portal upsertFeeRevisionInternal_). Returns a NEW
  // sorted array; the input is not mutated.
  function upsertFeeRevision(revisions, rev) {
    var norm = normalizeFeeRevision(rev);
    if (!norm) return parseFeeRevisions(revisions);
    var list = parseFeeRevisions(revisions);
    var replaced = false;
    var out = list.map(function (r) {
      if (r.effectiveMonthIdx === norm.effectiveMonthIdx && r.effectiveYear === norm.effectiveYear) {
        replaced = true;
        return {
          effectiveYear: norm.effectiveYear,
          effectiveMonth: norm.effectiveMonth,
          effectiveMonthIdx: norm.effectiveMonthIdx,
          prevFee: r.prevFee,
          newFee: norm.newFee,
          revisedDate: norm.revisedDate,
          reason: norm.reason || r.reason || '',
          addedStudent: r.addedStudent || norm.addedStudent || '',
          joiningDate: r.joiningDate || norm.joiningDate || ''
        };
      }
      return r;
    });
    if (!replaced) out.push(norm);
    out.sort(function (a, b) { return monthScore(a.effectiveYear, a.effectiveMonthIdx) - monthScore(b.effectiveYear, b.effectiveMonthIdx); });
    return out;
  }

  function findFeeRevisionAt(revisions, monthIdx, year) {
    var list = parseFeeRevisions(revisions);
    for (var i = 0; i < list.length; i++) {
      if (list[i].effectiveMonthIdx === monthIdx && list[i].effectiveYear === year) return list[i];
    }
    return null;
  }

  // "Apply Fee Change From" presets (fee-portal feePresetTargetB19):
  // previous = last month, current = this month, next = next month,
  // prev3 = three months ago. Base date defaults to today.
  function feePresetTarget(preset, baseDate) {
    var base = baseDate instanceof Date ? baseDate : new Date();
    var d = new Date(base.getFullYear(), base.getMonth(), 1);
    if (preset === 'previous') d.setMonth(d.getMonth() - 1);
    else if (preset === 'next') d.setMonth(d.getMonth() + 1);
    else if (preset === 'prev3') d.setMonth(d.getMonth() - 3);
    return { monthIdx: d.getMonth(), year: d.getFullYear() };
  }

  // --------------------------------------------------------------------------
  // APPLICABLE FEE — the fee in force for one month (fee-portal
  // getHistoricalFeeForMonthInternal, adapted to LMS records).
  // opts.records: this family's payment records (any order); cancelled
  // rows are ignored. opts.masterFee overrides family.monthly_fee.
  // Returns { fee, source, nextRevision, timelineMismatch }.
  //   source: 'timeline' | 'previous-fee' | 'payment-record' | 'master'
  //   timelineMismatch: the timeline fee differs from the master fee and
  //   no later revision explains it (the red fee-form state).
  // --------------------------------------------------------------------------
  function getApplicableFeeForMonth(family, monthIdx, year, opts) {
    opts = opts || {};
    var master = (opts.masterFee !== undefined && opts.masterFee !== null)
      ? num(opts.masterFee)
      : num(family ? family.monthly_fee : 0);
    var targetScore = monthScore(year, monthIdx);
    var revisions = parseFeeRevisions(family);
    var nextRevision = null;
    var i;
    for (i = 0; i < revisions.length; i++) {
      if (monthScore(revisions[i].effectiveYear, revisions[i].effectiveMonthIdx) > targetScore) {
        nextRevision = revisions[i];
        break;
      }
    }

    // 1. Timeline.
    if (revisions.length > 0) {
      var first = revisions[0];
      var firstScore = monthScore(first.effectiveYear, first.effectiveMonthIdx);
      if (targetScore < firstScore) {
        if (num(first.prevFee) > 0) {
          return { fee: num(first.prevFee), source: 'previous-fee', nextRevision: nextRevision, timelineMismatch: false };
        }
      }
      var activeFee = null;
      for (i = 0; i < revisions.length; i++) {
        var rev = revisions[i];
        if (targetScore >= monthScore(rev.effectiveYear, rev.effectiveMonthIdx)) {
          activeFee = num(rev.newFee) > 0 ? num(rev.newFee) : master;
        }
      }
      if (activeFee !== null && activeFee > 0) {
        var mismatch = Math.abs(activeFee - master) > 0.01 &&
          !(nextRevision && Math.abs(num(nextRevision.newFee) - master) <= 0.01);
        return { fee: activeFee, source: 'timeline', nextRevision: nextRevision, timelineMismatch: mismatch };
      }
    }

    // 2. Receipts inference (no timeline covers the month).
    var records = Array.isArray(opts.records) ? opts.records : [];
    var live = records.filter(function (r) {
      return r && !isCancelledRecord(r) && num(r.monthlyFee) > 0 && monthIdxOf(r.month) !== -1 && !isNaN(parseInt(r.year, 10));
    });
    if (live.length > 0) {
      for (i = 0; i < live.length; i++) {
        if (monthIdxOf(live[i].month) === monthIdx && parseInt(live[i].year, 10) === parseInt(year, 10)) {
          return { fee: num(live[i].monthlyFee), source: 'payment-record', nextRevision: nextRevision, timelineMismatch: false };
        }
      }
      var newestScore = -1;
      var closest = null;
      var closestDist = Infinity;
      live.forEach(function (r) {
        var s = monthScore(r.year, monthIdxOf(r.month));
        if (s > newestScore) newestScore = s;
        if (s <= targetScore) {
          var d = targetScore - s;
          if (d < closestDist) { closestDist = d; closest = r; }
        }
      });
      // BATCH 20: never project an old receipt's fee into months AFTER
      // the family's newest payment record — use the master fee there.
      if (targetScore > newestScore) {
        return { fee: master, source: 'master', nextRevision: nextRevision, timelineMismatch: false };
      }
      if (closest) {
        return { fee: num(closest.monthlyFee), source: 'payment-record', nextRevision: nextRevision, timelineMismatch: false };
      }
    }

    // 3. Master fee.
    return { fee: master, source: 'master', nextRevision: nextRevision, timelineMismatch: false };
  }

  // --------------------------------------------------------------------------
  // DUE DATE — fee-portal getFeeDueDate_, adapted. Per-family Due Day +
  // Fee Timing live in family.notes under `fee_due_day` (1-31) and
  // `fee_timing` ('Advance' | 'Arrears'); NO D1 column, NO Worker
  // change. When unset, the defaults preserve the old behaviour
  // exactly: dueDay = billing_day (default 1), timing = Advance.
  // Advance: the fee is due inside the billing month, on the due day.
  // Arrears (fee-portal "End of Month"): the fee is due in the NEXT
  // month, on the due day. Returns 'YYYY-MM-DD'.
  // --------------------------------------------------------------------------
  function readFeeDueSettings(family) {
    var raw = null;
    try {
      if (!family) return { dueDay: null, timing: null };
      if (family.fee_due_day != null || family.fee_timing != null) {
        raw = { fee_due_day: family.fee_due_day, fee_timing: family.fee_timing };
      } else if (family.notes && typeof family.notes === 'object') {
        raw = family.notes;
      } else if (typeof family.notes === 'string' && family.notes) {
        raw = JSON.parse(family.notes);
      }
    } catch (e) { raw = null; }
    if (!raw || typeof raw !== 'object') return { dueDay: null, timing: null };
    var d = parseInt(raw.fee_due_day, 10);
    return { dueDay: isNaN(d) ? null : d, timing: raw.fee_timing != null ? String(raw.fee_timing) : null };
  }

  function normalizeFeeTiming(v) {
    var s = String(v || '').trim().toLowerCase();
    if (s.indexOf('end') !== -1 || s.indexOf('after') !== -1 || s.indexOf('arrear') !== -1) return 'Arrears';
    return 'Advance';
  }

  function dueDayOf(family) {
    var s = readFeeDueSettings(family);
    var d = s.dueDay;
    if (d == null || isNaN(d)) return billingDayOf(family);
    if (d < 1) d = 1;
    if (d > 31) d = 31;
    return d;
  }

  function feeTimingOf(family) {
    var s = readFeeDueSettings(family);
    if (!s.timing) return 'Advance';
    return normalizeFeeTiming(s.timing);
  }

  function billingDayOf(family) {
    var d = parseInt(family ? family.billing_day : NaN, 10);
    if (isNaN(d)) d = 1;
    if (d < 1) d = 1;
    if (d > 31) d = 31;
    return d;
  }

  function getFeeDueDate(family, monthIdx, year) {
    var y = parseInt(year, 10) || new Date().getFullYear();
    var m = parseInt(monthIdx, 10);
    if (isNaN(m) || m < 0) m = 0;
    if (m > 11) m = 11;
    if (feeTimingOf(family) === 'Arrears') {
      m = m + 1;
      if (m > 11) { m = 0; y = y + 1; }
    }
    var day = Math.min(dueDayOf(family), daysInMonth(y, m));
    var mm = String(m + 1);
    if (mm.length < 2) mm = '0' + mm;
    var dd = String(day);
    if (dd.length < 2) dd = '0' + dd;
    return y + '-' + mm + '-' + dd;
  }

  function dueInvoiceRef(familyId, monthIdx, year) {
    var y = parseInt(year, 10) || new Date().getFullYear();
    var mm = String(monthIdx + 1);
    if (mm.length < 2) mm = '0' + mm;
    var fam = String(familyId || '').toUpperCase().replace(/[^A-Z0-9-]/g, '');
    return 'DUE-' + y + mm + '-' + fam;
  }

  // --------------------------------------------------------------------------
  // ARREARS CLASSIFICATION — fee-portal classifyFamilyArrears_, adapted
  // to LMS inputs. ctx: {
  //   records: this family's payment records,
  //   enrollInfo: { year, monthIndex } (from getFamilyEnrollmentInfo),
  //   today: 'YYYY-MM-DD' (defaults to today),
  //   isLeave(monthName, year) -> { isLeave, reason },
  //   isNotEnrolled(monthName, year) -> boolean,
  //   isPreAdmission(monthIdx, year) -> boolean,
  //   feeForMonth(monthIdx, year) -> number (applicable fee)
  // }
  // --------------------------------------------------------------------------
  function classifyFeeArrears(family, monthIdx, year, ctx) {
    ctx = ctx || {};
    var monthName = MONTHS[monthIdx] || 'January';
    var today = ctx.today || todayStr();
    var records = Array.isArray(ctx.records) ? ctx.records : [];
    var feeForMonth = typeof ctx.feeForMonth === 'function'
      ? ctx.feeForMonth
      : function (m, y) { return getApplicableFeeForMonth(family, m, y, { records: records }).fee; };
    var isLeave = typeof ctx.isLeave === 'function' ? ctx.isLeave : function () { return { isLeave: false, reason: '' }; };
    var isNotEnrolled = typeof ctx.isNotEnrolled === 'function' ? ctx.isNotEnrolled : function () { return false; };
    var isPreAdmission = typeof ctx.isPreAdmission === 'function' ? ctx.isPreAdmission : function () { return false; };

    function monthRecords(mIdx, y) {
      return records.filter(function (r) {
        return r && !isCancelledRecord(r) &&
          monthIdxOf(r.month) === mIdx && parseInt(r.year, 10) === parseInt(y, 10);
      });
    }
    function paidPlusDiscount(list) {
      var s = 0;
      list.forEach(function (r) { s += num(r.amountPaid) + num(r.discount); });
      return s;
    }

    // Fee Upgrade Phase 3 — a month is status-paid when an ADJ row
    // exists for it AND no real payment exists (money always wins over
    // a stale status row). Uses the local isMonthStatusRow mirror above.
    function hasStatusRow(mIdx, y) {
      var famUpper = String(family ? family.id : '').toUpperCase();
      var statusRow = null;
      var realRow = null;
      records.forEach(function (r) {
        if (!r || isCancelledRecord(r)) return;
        if (String(r.familyId || '').toUpperCase() !== famUpper) return;
        if (monthIdxOf(r.month) !== mIdx || parseInt(r.year, 10) !== parseInt(y, 10)) return;
        if (isMonthStatusRow(r)) statusRow = r; else realRow = r;
      });
      return !!statusRow && !realRow;
    }

    // Current month.
    var curDueDate = getFeeDueDate(family, monthIdx, year);
    var curIsDue = today >= curDueDate;
    var curFee = feeForMonth(monthIdx, year);
    var curRecs = monthRecords(monthIdx, year);
    var curRemaining = Math.max(0, curFee - paidPlusDiscount(curRecs));
    var curLeave = isLeave(monthName, year);
    var currentStatus = 'unpaid';
    var currentDueAmount = curFee;
    if (curLeave && curLeave.isLeave) {
      currentStatus = 'leave';
      currentDueAmount = 0;
    } else if (isNotEnrolled(monthName, year)) {
      currentStatus = 'notEnrolled';
      currentDueAmount = 0;
    } else if (hasStatusRow(monthIdx, year)) {
      // Fee Upgrade Phase 3: marked Paid by one-tap status — settled,
      // no money recorded, nothing outstanding.
      currentStatus = 'paid';
      currentDueAmount = 0;
    } else if (curRecs.length > 0 && curRemaining <= 0.01) {
      currentStatus = 'paid';
      currentDueAmount = 0;
    } else if (curRecs.length > 0) {
      currentStatus = 'partial';
      currentDueAmount = curRemaining;
    } else {
      currentStatus = 'unpaid';
      currentDueAmount = curFee;
    }

    // Previous months, chronologically from enrollment.
    var enroll = ctx.enrollInfo || { year: year, monthIndex: 0 };
    var arrearsMonths = [];
    var arrearsAmount = 0;
    var eYear = parseInt(enroll.year, 10);
    var eMonth = parseInt(enroll.monthIndex, 10);
    if (!isNaN(eYear) && !isNaN(eMonth) && !(eYear > year || (eYear === year && eMonth >= monthIdx))) {
      var y = eYear;
      var m = eMonth;
      var guard = 0;
      while ((y < year || (y === year && m < monthIdx)) && guard < 120) {
        guard++;
        var mName = MONTHS[m];
        var leave = isLeave(mName, y);
        var dueDate = getFeeDueDate(family, m, y);
        var isDue = today >= dueDate;
        if ((!leave || !leave.isLeave) && !isNotEnrolled(mName, y) && !isPreAdmission(m, y) && !hasStatusRow(m, y) && isDue) {
          var mRecs = monthRecords(m, y);
          var mFee = feeForMonth(m, y);
          var mRemaining = Math.max(0, mFee - paidPlusDiscount(mRecs));
          if (mRecs.length > 0 && mRemaining <= 0.01) {
            // Paid in full: never counts.
          } else if (mRecs.length > 0) {
            if (mRemaining > 0) {
              arrearsMonths.push({ month: mName, year: y, shortfall: mRemaining, isPartial: true });
              arrearsAmount += mRemaining;
            }
          } else if (mFee > 0) {
            arrearsMonths.push({ month: mName, year: y, shortfall: mFee, isPartial: false });
            arrearsAmount += mFee;
          }
        }
        m++;
        if (m > 11) { m = 0; y++; }
      }
    }

    return {
      currentStatus: currentStatus,
      currentDueAmount: Math.round(currentDueAmount * 100) / 100,
      currentIsDue: curIsDue,
      currentDueDate: curDueDate,
      currentFee: curFee,
      arrearsMonths: arrearsMonths,
      arrearsAmount: Math.round(arrearsAmount * 100) / 100,
      arrearsCount: arrearsMonths.length
    };
  }

  // --------------------------------------------------------------------------
  // FEE DUE INVOICE — fee-portal buildFeeDueInvoiceDataInternal, adapted.
  // A payment REQUEST, not a receipt. Active families only.
  // ctx: same as classifyFeeArrears, plus familyStatus is read from the
  // family record itself. Returns { eligible, reason, ...data }.
  // --------------------------------------------------------------------------
  function buildFeeDueInvoiceData(family, monthIdx, year, ctx) {
    ctx = ctx || {};
    var result = { eligible: false, reason: '' };
    if (!family) {
      result.reason = 'No family selected.';
      return result;
    }
    var famStatus = String(family.status || 'Active').trim().toLowerCase();
    if (famStatus !== 'active') {
      result.reason = 'Family ' + family.id + ' is not Active (' + (family.status || 'unknown') + '), so no Fee Due Invoice can be issued.';
      return result;
    }
    if (monthIdx < 0 || monthIdx > 11 || isNaN(parseInt(year, 10))) {
      result.reason = 'Invalid billing month or year.';
      return result;
    }
    var yearInt = parseInt(year, 10);
    var monthName = MONTHS[monthIdx];
    var cls = classifyFeeArrears(family, monthIdx, yearInt, ctx);

    if (cls.currentStatus === 'leave') {
      result.reason = (family.parent_name || family.id) + ' is on Approved Leave for ' + monthName + ' ' + yearInt + '. No Fee Due Invoice can be issued.';
      return result;
    }
    if (cls.currentStatus === 'notEnrolled') {
      result.reason = (family.parent_name || family.id) + ' is marked Not Enrolled for ' + monthName + ' ' + yearInt + '. No Fee Due Invoice can be issued.';
      return result;
    }
    // The classification keeps the current month separate from arrears,
    // so the invoice total is the explicit sum: all due arrears + the
    // selected month's due amount when it is due.
    var currentDueAmount = (cls.currentIsDue && (cls.currentStatus === 'unpaid' || cls.currentStatus === 'partial'))
      ? cls.currentDueAmount : 0;
    var totalOwed = Math.round((cls.arrearsAmount + currentDueAmount) * 100) / 100;
    if (!(totalOwed > 0)) {
      result.reason = 'No outstanding payable fee for ' + (family.parent_name || family.id) + ' for ' + monthName + ' ' + yearInt + ' (fully paid or nothing due). No invoice was generated.';
      return result;
    }
    if (!cls.currentIsDue && !(cls.arrearsAmount > 0)) {
      result.reason = 'The fee for ' + monthName + ' ' + yearInt + ' is Not Yet Due for ' + (family.parent_name || family.id) + ' (due ' + cls.currentDueDate + '). No invoice was generated.';
      return result;
    }

    var records = Array.isArray(ctx.records) ? ctx.records : [];
    var discount = 0;
    var amountPaid = 0;
    records.forEach(function (r) {
      if (!r || isCancelledRecord(r)) return;
      if (monthIdxOf(r.month) !== monthIdx || parseInt(r.year, 10) !== yearInt) return;
      discount += num(r.discount);
      amountPaid += num(r.amountPaid);
    });

    var monthlyFee = cls.currentFee;
    var dueDate = cls.currentDueDate;
    var feeTiming = feeTimingOf(family);
    var timingMessage = feeTiming === 'Arrears'
      ? 'Fee plan: Arrears (end of month). The fee for ' + monthName + ' ' + yearInt + ' was due by ' + dueDate + '.'
      : 'Fee plan: Advance (start of month). The fee for ' + monthName + ' ' + yearInt + ' was due by ' + dueDate + '.';
    var arrearsLabels = cls.arrearsMonths.map(function (a) { return a.month + ' ' + a.year; });
    var studentsNames = '';
    if (Array.isArray(family.students)) {
      studentsNames = family.students
        .filter(function (s) { return (s.status || '').toLowerCase() !== 'trial'; })
        .map(function (s) { return s.name; })
        .join(', ');
    }
    if (!studentsNames && family.students_names) studentsNames = family.students_names;

    return {
      eligible: true,
      reason: '',
      invoiceRef: dueInvoiceRef(family.id, monthIdx, yearInt),
      familyId: family.id,
      parentName: family.parent_name || 'Guardian',
      studentsNames: studentsNames || 'Enrolled Student',
      country: family.country || 'International',
      email: family.parent_email || family.email || '',
      whatsapp: family.whatsapp || '',
      month: monthName,
      year: yearInt,
      currency: family.currency || 'USD',
      monthlyFee: Math.round(monthlyFee * 100) / 100,
      previousArrears: cls.arrearsAmount,
      arrearsCount: cls.arrearsCount,
      arrearsMonths: arrearsLabels,
      arrearsDetail: cls.arrearsMonths,
      discount: Math.round(discount * 100) / 100,
      totalPayable: Math.round((monthlyFee + cls.arrearsAmount) * 100) / 100,
      amountPaid: Math.round(amountPaid * 100) / 100,
      outstanding: totalOwed,
      dueDate: dueDate,
      feeTiming: feeTiming,
      timingMessage: timingMessage,
      statusLabel: cls.currentStatus,
      issueDate: todayStr()
    };
  }

  // --------------------------------------------------------------------------
  // UNDO PAYMENT — newest-only rule (fee-portal undoFeePayment, adapted).
  // A receipt group is one receipt, or all sub-rows of a multi-month
  // advance receipt (AH-REC-...-1, -2, ... share one base number).
  // Every row of the group must be the newest live (non-cancelled) row
  // for its family + month, or the undo is refused.
  // --------------------------------------------------------------------------
  function receiptBaseNo(receiptNo) {
    var s = String(receiptNo || '');
    var m = s.match(/^(AH-REC-[A-Za-z0-9-]+)-\d+$/);
    return m ? m[1] : s;
  }

  function receiptGroupRows(records, receiptNo) {
    var base = receiptBaseNo(receiptNo);
    return (Array.isArray(records) ? records : []).filter(function (r) {
      return r && receiptBaseNo(r.receiptNo) === base;
    });
  }

  function isNewestPaymentRow(records, receiptNo) {
    var all = Array.isArray(records) ? records : [];
    var group = receiptGroupRows(all, receiptNo).filter(function (r) { return !isCancelledRecord(r) && !isMonthStatusRow(r); });
    if (group.length === 0) {
      return { ok: false, reason: 'That payment could not be found, so nothing was undone.' };
    }
    var live = all.filter(function (r) { return r && !isCancelledRecord(r) && !isMonthStatusRow(r); });
    for (var g = 0; g < group.length; g++) {
      var row = group[g];
      var famUpper = String(row.familyId || '').toUpperCase();
      var mIdx = monthIdxOf(row.month);
      var yInt = parseInt(row.year, 10);
      var rowDate = String(row.date || '');
      var rowPos = all.indexOf(row);
      for (var i = 0; i < live.length; i++) {
        var other = live[i];
        if (other === row) continue;
        if (String(other.familyId || '').toUpperCase() !== famUpper) continue;
        if (monthIdxOf(other.month) !== mIdx || parseInt(other.year, 10) !== yInt) continue;
        var otherDate = String(other.date || '');
        var otherPos = all.indexOf(other);
        // Stored newest-first (unshift on save): an earlier position is
        // newer on the same date; a later date is always newer.
        if (otherDate > rowDate || (otherDate === rowDate && otherPos < rowPos)) {
          return {
            ok: false,
            reason: 'A newer payment was entered later for ' + row.month + ' ' + row.year + '. Please undo the newer payment first.'
          };
        }
      }
    }
    return { ok: true, reason: '' };
  }

  // --------------------------------------------------------------------------
  // ARREARS CONTEXT — builds the classify/build context for one family
  // from the live fees.js globals (defensive: every helper is optional).
  // --------------------------------------------------------------------------
  function buildArrearsContext(family) {
    var famId = String(family ? family.id : '').toUpperCase();
    var records = [];
    try {
      if (typeof getStoredFeeRecords === 'function') {
        records = (getStoredFeeRecords() || []).filter(function (r) {
          return r && String(r.familyId || '').toUpperCase() === famId;
        });
      }
    } catch (e) { records = []; }
    var overrides = {};
    try {
      if (typeof getStoredMatrixOverrides === 'function') overrides = getStoredMatrixOverrides() || {};
    } catch (e) { overrides = {}; }
    var enrollInfo = { year: new Date().getFullYear(), monthIndex: 0 };
    try {
      if (typeof getFamilyEnrollmentInfo === 'function') enrollInfo = getFamilyEnrollmentInfo(family) || enrollInfo;
    } catch (e) { /* keep default */ }
    return {
      records: records,
      overrides: overrides,
      enrollInfo: enrollInfo,
      today: todayStr(),
      isLeave: function (mName, y) {
        try {
          if (typeof checkFamilyLeaveInMonth === 'function') return checkFamilyLeaveInMonth(family.id, mName, y);
        } catch (e) { /* fall through */ }
        return { isLeave: false, reason: '' };
      },
      isNotEnrolled: function (mName, y) {
        var ov = overrides[famId + '_' + String(mName).toLowerCase() + '_' + y];
        return !!(ov && ov.status === 'not_enrolled');
      },
      isPreAdmission: function (mIdx, y) {
        try {
          if (typeof isFamilyPreAdmission === 'function') return isFamilyPreAdmission(family, mIdx, y);
        } catch (e) { /* fall through */ }
        return false;
      },
      feeForMonth: function (mIdx, y) {
        return getApplicableFeeForMonth(family, mIdx, y, { records: records }).fee;
      }
    };
  }

  // --------------------------------------------------------------------------
  // FEE-SOURCE NOTE — the fee-form note under the Monthly Fee field
  // (fee-portal renderFeeSourceInfoB20, same three states).
  // --------------------------------------------------------------------------
  function renderFeeSourceNote(family, monthIdx, year, details) {
    if (typeof document === 'undefined' || !document.getElementById) return;
    var masterLine = document.getElementById('feeFormMasterFeeLine');
    var noteEl = document.getElementById('feeFormFeeSourceNote');
    var cur = (family && family.currency) || 'USD';
    var masterFee = num(family ? family.monthly_fee : 0);
    if (masterLine) {
      masterLine.innerHTML = 'Current Agreed Monthly Fee: <strong>' + cur + ' ' + masterFee.toFixed(2) + '</strong> (the family\'s latest agreed fee)';
    }
    if (!noteEl) return;
    if (!details) { noteEl.style.display = 'none'; return; }
    var applicable = num(details.fee);
    if (Math.abs(applicable - masterFee) <= 0.01) { noteEl.style.display = 'none'; return; }
    var when = (MONTHS[monthIdx] || '') + ' ' + year;
    noteEl.style.display = 'block';
    if (details.timelineMismatch) {
      noteEl.style.background = '#fef2f2';
      noteEl.style.color = '#991b1b';
      noteEl.style.borderLeft = '4px solid #dc2626';
      noteEl.innerHTML = '<strong>Fee history does not match the Agreed Monthly Fee.</strong> The fee history in force for ' + when + ' is ' + cur + ' ' + applicable.toFixed(2) + ', but the family\'s current Agreed Monthly Fee is ' + cur + ' ' + masterFee.toFixed(2) + '. The amount above follows the fee history for the selected month. If the agreed fee is the correct one, open <strong>Edit Family</strong>, confirm the fee and its starting month, and save: that records the missing fee change. No payment records are affected.';
    } else if (details.nextRevision && Math.abs(num(details.nextRevision.newFee) - masterFee) <= 0.01) {
      noteEl.style.background = '#fffbeb';
      noteEl.style.color = '#92400e';
      noteEl.style.borderLeft = '4px solid #d97706';
      noteEl.innerHTML = '<strong>Scheduled fee change:</strong> ' + cur + ' ' + applicable.toFixed(2) + ' applies to ' + when + '. The agreed fee changes to ' + cur + ' ' + masterFee.toFixed(2) + ' from <strong>' + details.nextRevision.effectiveMonth + ' ' + details.nextRevision.effectiveYear + '</strong>.';
    } else if (details.source === 'payment-record') {
      noteEl.style.background = '#fffbeb';
      noteEl.style.color = '#92400e';
      noteEl.style.borderLeft = '4px solid #d97706';
      noteEl.innerHTML = 'No fee revision covers ' + when + '; the amount above is the fee from the family\'s recorded payments for that period.';
    } else if (details.source === 'previous-fee') {
      noteEl.style.background = '#fffbeb';
      noteEl.style.color = '#92400e';
      noteEl.style.borderLeft = '4px solid #d97706';
      noteEl.innerHTML = when + ' falls before the first recorded fee change' + (details.nextRevision ? ' (' + details.nextRevision.effectiveMonth + ' ' + details.nextRevision.effectiveYear + ')' : '') + ', so the previous fee of ' + cur + ' ' + applicable.toFixed(2) + ' applies to this month.';
    } else {
      noteEl.style.display = 'none';
    }
  }

  // --------------------------------------------------------------------------
  // EDIT FAMILY — fee-change section (fee-portal Batches 19-21).
  // The main Monthly Fee field is the new fee; this section adds the
  // Apply-From presets, the reason, the live protection notice and the
  // recorded timeline. Empty fee field = keep the current fee.
  // --------------------------------------------------------------------------
  function feeTimelineListHtml(family) {
    var revisions = parseFeeRevisions(family);
    var cur = (family && family.currency) || 'USD';
    if (revisions.length === 0) {
      return '<p class="text-[11px] text-slate-500">No fee changes recorded yet. The current agreed fee has applied since enrolment.</p>';
    }
    var rows = revisions.slice().reverse().map(function (r) {
      var label = r.effectiveMonth + ' ' + r.effectiveYear + ': ' + cur + ' ' + num(r.prevFee).toFixed(2) + ' &rarr; ' + cur + ' ' + num(r.newFee).toFixed(2);
      var extra = r.reason ? ' — ' + escHtml(r.reason) : '';
      return '<li class="flex items-start gap-1.5"><i class="fa-solid fa-clock-rotate-left text-emerald-700 mt-0.5"></i><span><strong>' + label + '</strong>' + extra + '</span></li>';
    }).join('');
    return '<ul class="space-y-1 text-[11px] text-slate-700">' + rows + '</ul>';
  }

  function toggleFeeRevisionSection(forceOpen) {
    if (typeof document === 'undefined' || !document.getElementById) return;
    var body = document.getElementById('feeRevisionBody');
    var chev = document.getElementById('feeRevisionChevron');
    var badge = document.getElementById('feeRevisionBadge');
    if (!body) return;
    var isOpen = body.style.display !== 'none';
    if (forceOpen === true) isOpen = false;
    else if (forceOpen === false) isOpen = true;
    if (isOpen) {
      body.style.display = 'none';
      if (chev) chev.style.transform = 'rotate(0deg)';
      if (badge) {
        badge.innerText = 'Click to Expand';
        badge.style.background = '#d1fae5';
      }
    } else {
      body.style.display = 'block';
      if (chev) chev.style.transform = 'rotate(180deg)';
      if (badge) {
        badge.innerText = 'Active / Expanded';
        badge.style.background = '#a7f3d0';
      }
      updateFeeProtectionNotice();
    }
  }

  function onFeeEffectivePresetChange() {
    if (typeof document === 'undefined' || !document.getElementById) return;
    var presetSel = document.getElementById('fwFeeEffectivePreset');
    var monthSel = document.getElementById('fwFeeEffectiveMonth');
    var yrInput = document.getElementById('fwFeeEffectiveYear');
    if (!presetSel || !monthSel || !yrInput) return;
    var preset = presetSel.value;
    if (preset !== 'custom') {
      var t = feePresetTarget(preset);
      monthSel.value = MONTHS[t.monthIdx];
      yrInput.value = t.year;
    }
    var isCustom = (preset === 'custom');
    monthSel.disabled = !isCustom;
    yrInput.disabled = !isCustom;
    updateFeeProtectionNotice();
  }

  function updateFeeProtectionNotice() {
    if (typeof document === 'undefined' || !document.getElementById) return;
    var noticeEl = document.getElementById('fwFeeRevisionNoticeText');
    if (!noticeEl) return;
    var feeEl = document.getElementById('fwEditFamFee');
    var mEl = document.getElementById('fwFeeEffectiveMonth');
    var yEl = document.getElementById('fwFeeEffectiveYear');
    var curEl = document.getElementById('fwEditFamCurr');
    var m = (mEl && mEl.value) || 'Current Month';
    var y = (yEl && yEl.value) || String(new Date().getFullYear());
    var newFee = num(feeEl ? feeEl.value : 0);
    var cur = (curEl && curEl.value) || 'USD';
    var prevFee = newFee;
    try {
      var famId = noticeEl.getAttribute('data-family-id') || '';
      var fam = null;
      if (typeof window !== 'undefined' && window.ALL_FAMILIES) {
        fam = window.ALL_FAMILIES.find(function (f) { return String(f.id).toUpperCase() === String(famId).toUpperCase(); });
      }
      if (fam) prevFee = num(fam.monthly_fee);
    } catch (e) { /* keep newFee */ }
    noticeEl.innerHTML =
      '<strong><i class="fa-solid fa-shield-halved" style="color:#047857;"></i> Historical Ledger Protection Active:</strong> ' +
      'Past months prior to <strong>' + escHtml(m) + ' ' + escHtml(y) + '</strong> will strictly remain evaluated at the original agreed fee of <strong>' + cur + ' ' + prevFee.toFixed(2) + '</strong>. ' +
      'All past settled months remain <strong>100% Paid in Full (0 arrears)</strong>. ' +
      'The revised fee of <strong>' + cur + ' ' + newFee.toFixed(2) + '</strong> will only apply from <strong>' + escHtml(m) + ' ' + escHtml(y) + '</strong> onward.';
    var prevEl = document.getElementById('fwFeeChangePreviewText');
    if (prevEl) {
      if (Math.abs(newFee - prevFee) <= 0.01) {
        prevEl.innerHTML = '<strong>Preview:</strong> The fee amount has not changed, so no fee revision will be recorded.';
      } else {
        var pv = '<strong>Preview:</strong> New fee: <strong>' + cur + ' ' + newFee.toFixed(2) + '</strong>, effective from <strong>' + escHtml(m) + ' ' + escHtml(y) + '</strong>.';
        try {
          var famId2 = noticeEl.getAttribute('data-family-id') || '';
          var fam2 = null;
          if (typeof window !== 'undefined' && window.ALL_FAMILIES) {
            fam2 = window.ALL_FAMILIES.find(function (f) { return String(f.id).toUpperCase() === String(famId2).toUpperCase(); });
          }
          var effIdx = monthIdxOf(m);
          var effYear = parseInt(y, 10);
          var clash = (fam2 && effIdx >= 0 && !isNaN(effYear)) ? findFeeRevisionAt(fam2, effIdx, effYear) : null;
          if (clash) {
            pv += ' <span style="color:#b45309; font-weight:700;">Warning: a fee change already exists for ' + escHtml(m) + ' ' + escHtml(y) + ' (' + cur + ' ' + num(clash.prevFee).toFixed(2) + ' &rarr; ' + cur + ' ' + num(clash.newFee).toFixed(2) + '). Saving will replace that entry.</span>';
          }
        } catch (e) { /* preview without the warning */ }
        prevEl.innerHTML = pv;
      }
    }
  }

  // Auto-open the fee-change section when the Monthly Fee field differs
  // from the stored fee (fee-portal checkFamilyFormChangesB21).
  function checkFamilyFeeChange(familyId) {
    if (typeof document === 'undefined' || !document.getElementById) return;
    var feeEl = document.getElementById('fwEditFamFee');
    if (!feeEl) return;
    var fam = null;
    try {
      if (typeof window !== 'undefined' && window.ALL_FAMILIES) {
        fam = window.ALL_FAMILIES.find(function (f) { return String(f.id).toUpperCase() === String(familyId).toUpperCase(); });
      }
    } catch (e) { fam = null; }
    if (!fam) return;
    var hint = document.getElementById('feeChangeDetectedHint');
    if (feeEl.value !== '' && Math.abs(num(feeEl.value) - num(fam.monthly_fee)) > 0.01) {
      toggleFeeRevisionSection(true);
      if (hint) hint.style.display = 'block';
    } else if (hint) {
      hint.style.display = 'none';
    }
    updateFeeProtectionNotice();
  }

  // Build the revision for an Edit Family save (Batch 21 rule): the
  // prevFee is the fee in force in the month BEFORE the effective
  // month. input: { newFee, preset, monthIdx, year, reason }.
  // Returns { revision } or { error }.
  function buildFeeRevisionForEdit(family, input) {
    input = input || {};
    var newFee = num(input.newFee, NaN);
    if (!isFinite(newFee) || newFee < 0) return { error: 'Please enter a valid monthly fee (0 or more).' };
    var eff;
    if (input.preset && input.preset !== 'custom') {
      eff = feePresetTarget(input.preset);
    } else {
      var mIdx = (input.monthIdx !== undefined && input.monthIdx !== null) ? parseInt(input.monthIdx, 10) : monthIdxOf(input.month);
      var y = parseInt(input.year, 10);
      if (isNaN(mIdx) || mIdx < 0 || mIdx > 11 || isNaN(y) || y < 2000 || y > 2100) {
        return { error: 'Please choose a valid month and year for the fee change.' };
      }
      eff = { monthIdx: mIdx, year: y };
    }
    var records = [];
    try {
      if (typeof getStoredFeeRecords === 'function') {
        var famUpper = String(family.id || '').toUpperCase();
        records = (getStoredFeeRecords() || []).filter(function (r) {
          return r && String(r.familyId || '').toUpperCase() === famUpper;
        });
      }
    } catch (e) { records = []; }
    // The month BEFORE the effective month (explicit rollover: the
    // month before January is December of the previous year).
    var prevMonthIdx = eff.monthIdx - 1;
    var prevYear = eff.year;
    if (prevMonthIdx < 0) { prevMonthIdx = 11; prevYear -= 1; }
    var prevFee = getApplicableFeeForMonth(family, prevMonthIdx, prevYear, { records: records }).fee;
    var reason = String(input.reason || '').trim().slice(0, 160);
    var revision = normalizeFeeRevision({
      effectiveYear: eff.year,
      effectiveMonth: MONTHS[eff.monthIdx],
      effectiveMonthIdx: eff.monthIdx,
      prevFee: prevFee,
      newFee: newFee,
      revisedDate: todayStr(),
      reason: reason
    });
    if (!revision) return { error: 'That fee change could not be recorded. Please check the fee and the starting month.' };
    return { revision: revision };
  }

  // --------------------------------------------------------------------------
  // UNDO PAYMENT — confirm + execute (fee-portal undoFeePayment).
  // The legacy mutation runs through deleteFamilyPaymentRecord in undo
  // mode (receipt-only, no deleted_payment_months marker, so the month
  // becomes due again); the payments-table row is cancelled by the
  // dual-write inside that same call. The server audit_log records
  // every write automatically.
  // --------------------------------------------------------------------------
  function notify(msg, type) {
    try {
      if (typeof window !== 'undefined' && typeof window.lmsNotify === 'function') window.lmsNotify(msg, type ? { type: type } : undefined);
      else if (typeof lmsNotify === 'function') lmsNotify(msg, type ? { type: type } : undefined);
    } catch (e) { /* toast unavailable — the caller still returns */ }
  }

  async function requestUndoFeePayment(receiptNo) {
    if (typeof getStoredFeeRecords !== 'function') {
      notify('Fee records are unavailable right now.', 'error');
      return false;
    }
    var records = getStoredFeeRecords() || [];
    var check = isNewestPaymentRow(records, receiptNo);
    if (!check.ok) {
      notify(check.reason, 'error');
      return false;
    }
    var group = receiptGroupRows(records, receiptNo).filter(function (r) { return !isCancelledRecord(r); });
    if (group.length === 0) {
      notify('That payment could not be found, so nothing was undone.', 'error');
      return false;
    }
    var first = group[0];
    var famId = first.familyId;
    var months = [];
    group.forEach(function (r) {
      var label = r.month + ' ' + r.year;
      if (months.indexOf(label) === -1) months.push(label);
    });
    var amount = 0;
    group.forEach(function (r) { amount += num(r.amountPaid); });
    var cur = first.currency || 'USD';
    var confirmed = false;
    try {
      if (typeof lmsConfirm === 'function') {
        confirmed = await lmsConfirm({
          title: 'Undo Payment',
          message: 'Receipt: ' + receiptNo + '\nFamily: ' + (first.parentName || famId) + ' (' + famId + ')\nMonth(s): ' + months.join(', ') + '\nAmount to remove: ' + cur + ' ' + amount.toFixed(2) + '\n\nThis cannot be undone. The payment will be removed and the month will become due again.',
          confirmText: 'Yes, Undo Payment',
          cancelText: 'Cancel',
          variant: 'warning'
        });
      }
    } catch (e) { confirmed = false; }
    if (!confirmed) return false;

    var done = false;
    if (typeof deleteFamilyPaymentRecord === 'function') {
      for (var i = 0; i < group.length; i++) {
        try {
          var r = await deleteFamilyPaymentRecord(famId, group[i].receiptNo, group[i].month, group[i].year, { undo: true, skipConfirm: true });
          if (r) done = true;
        } catch (e) { /* one row failing must not stop the rest */ }
      }
    }
    if (done) {
      // Fee Upgrade Phase 5: an undone payment leaves no stored PDF
      // behind (mirrors the fee portal trashing the receipt PDF on
      // undo). Best-effort only — a failed delete never blocks the
      // undo; the cancelled receipt simply never shows Open PDF again.
      try {
        if (typeof deleteStoredFeePdf === 'function') {
          var seenKeys = {};
          for (var k = 0; k < group.length; k++) {
            var pk = group[k] && group[k].pdfKey;
            if (pk && !seenKeys[pk]) {
              seenKeys[pk] = true;
              try { await deleteStoredFeePdf(pk); } catch (e) { /* best effort */ }
            }
          }
        }
      } catch (e) { /* best effort */ }
      notify('Payment undone. ' + months.join(', ') + ' is due again.');
      try { if (typeof loadFeeReceiptsHistory === 'function') loadFeeReceiptsHistory(); } catch (e) { /* refresh is best-effort */ }
      try { if (typeof loadFeeDueInvoicesList === 'function') loadFeeDueInvoicesList(); } catch (e) { /* refresh is best-effort */ }
    } else {
      notify('That payment could not be found, so nothing was undone.', 'error');
    }
    return done;
  }

  // --------------------------------------------------------------------------
  // FEE DUE INVOICE — modal orchestration.
  // --------------------------------------------------------------------------
  var CURRENT_DUE_INVOICE = null;
  if (typeof window !== 'undefined') window.CURRENT_FEE_DUE_INVOICE = null;

  function setCurrentDueInvoice(data) {
    CURRENT_DUE_INVOICE = data || null;
    if (typeof window !== 'undefined') window.CURRENT_FEE_DUE_INVOICE = CURRENT_DUE_INVOICE;
  }

  function setText(id, value) {
    if (typeof document === 'undefined' || !document.getElementById) return;
    var el = document.getElementById(id);
    if (el) el.innerText = value;
  }

  function renderFeeDueInvoiceModal(data, saved) {
    if (typeof document === 'undefined' || !document.getElementById) return;
    var cur = data.currency || 'USD';
    var isManager = (typeof CURRENT_ROLE !== 'undefined' && CURRENT_ROLE === 'manager') ||
      (typeof window !== 'undefined' && window.CURRENT_ROLE === 'manager');
    setText('feeDueRef', data.invoiceRef);
    setText('feeDueParentName', data.parentName || '--');
    setText('feeDueFamilyId', data.familyId || '--');
    setText('feeDueStudentsNames', data.studentsNames || '--');
    setText('feeDueIssueDate', data.issueDate || todayStr());
    setText('feeDuePeriod', data.month + ' ' + data.year);
    var emailEl = document.getElementById('feeDueParentEmail');
    if (emailEl) {
      emailEl.innerText = isManager && typeof maskStudentEmail === 'function'
        ? maskStudentEmail(data.email || '') : (data.email || '--');
    }
    var phoneEl = document.getElementById('feeDueWhatsAppNo');
    if (phoneEl) {
      phoneEl.innerText = isManager && typeof maskStudentPhone === 'function'
        ? maskStudentPhone(data.whatsapp || '') : (data.whatsapp || '--');
    }
    setText('feeDueDescription', 'Tuition Fee — ' + data.month + ' ' + data.year);
    setText('feeDueCurrentDue', cur + ' ' + num(data.monthlyFee).toFixed(2));

    var arrearsBody = document.getElementById('feeDueArrearsBody');
    var prevRow = document.getElementById('feeDuePrevBalanceRow');
    if (arrearsBody) {
      var detail = Array.isArray(data.arrearsDetail) ? data.arrearsDetail : [];
      if (detail.length > 0) {
        arrearsBody.innerHTML = detail.map(function (a) {
          return '<tr class="bg-amber-50/70"><td class="p-2.5 text-amber-900 font-bold">Arrears — ' + escHtml(a.month) + ' ' + escHtml(String(a.year)) + (a.isPartial ? ' (Partial)' : '') + '</td><td class="p-2.5 text-amber-800">' + escHtml(a.month) + ' ' + escHtml(String(a.year)) + '</td><td class="p-2.5 text-right font-mono font-bold text-amber-900">' + cur + ' ' + num(a.shortfall).toFixed(2) + '</td></tr>';
        }).join('');
        if (prevRow) prevRow.classList.remove('hidden');
        setText('feeDuePrevBalanceAmt', cur + ' ' + num(data.previousArrears).toFixed(2));
      } else {
        arrearsBody.innerHTML = '';
        if (prevRow) prevRow.classList.add('hidden');
      }
    }
    setText('feeDueGrossTotal', cur + ' ' + num(data.totalPayable).toFixed(2));
    var discRow = document.getElementById('feeDueDiscountRow');
    if (discRow) {
      if (num(data.discount) > 0) {
        discRow.classList.remove('hidden');
        setText('feeDueDiscountAmt', '- ' + cur + ' ' + num(data.discount).toFixed(2));
      } else {
        discRow.classList.add('hidden');
      }
    }
    setText('feeDueTotalPaid', cur + ' ' + num(data.amountPaid).toFixed(2));
    setText('feeDueOutstandingAmt', cur + ' ' + num(data.outstanding).toFixed(2));
    setText('feeDueDateText', data.dueDate || '--');
    setText('feeDueTimingText', data.timingMessage || '');

    var savedNote = document.getElementById('feeDueSavedNote');
    if (savedNote) savedNote.classList.toggle('hidden', !saved);
    var genBtn = document.getElementById('feeDueBtnGenerate');
    if (genBtn) {
      genBtn.disabled = !!saved;
      genBtn.innerHTML = saved
        ? '<i class="fa-solid fa-check mr-1"></i> Saved — ' + escHtml(data.invoiceRef)
        : '<i class="fa-solid fa-floppy-disk mr-1"></i> Generate &amp; Save Invoice';
    }
    var waBtn = document.getElementById('feeDueWhatsAppBtn');
    if (waBtn) {
      if (isManager) {
        waBtn.style.display = 'none';
      } else {
        waBtn.style.display = 'inline-flex';
        waBtn.href = feeDueInvoiceWhatsAppUrl(data);
      }
    }
  }

  function feeDueInvoiceWhatsAppUrl(data) {
    var cur = data.currency || 'USD';
    var academy = 'Al-Huda Islamic Centre';
    try { if (typeof academyName === 'function') academy = academyName(); } catch (e) { /* keep default */ }
    var msg = 'Assalam-o-Alaikum Respected ' + (data.parentName || 'Parent') + ',\n\n*OFFICIAL FEE DUE INVOICE - ' + academy.toUpperCase() + '*\n--------------------------------------\nInvoice Ref: *' + data.invoiceRef + '*\nDate: *' + (data.issueDate || '') + '*\nStudent(s): *' + (data.studentsNames || '') + '*\nBilling Period: *' + data.month + ' ' + data.year + '*\nMonthly Fee: *' + cur + ' ' + num(data.monthlyFee).toFixed(2) + '*\nPrevious Arrears: *' + cur + ' ' + num(data.previousArrears).toFixed(2) + '*\nDiscount: *' + cur + ' ' + num(data.discount).toFixed(2) + '*\nAmount Paid: *' + cur + ' ' + num(data.amountPaid).toFixed(2) + '*\nTOTAL OUTSTANDING DUE: *' + cur + ' ' + num(data.outstanding).toFixed(2) + '*\nDue Date: *' + (data.dueDate || '') + '*\n--------------------------------------\nThis is a payment request, not a payment receipt.\nJazakAllahu Khairan!\n*' + academy + ' Accounts*';
    var cleanPhone = String(data.whatsapp || '').replace(/[^0-9]/g, '');
    return 'https://wa.me/' + cleanPhone + '?text=' + encodeURIComponent(msg);
  }

  async function openFeeDueInvoiceModal(familyId, monthName, year) {
    var fam = null;
    try {
      var list = (typeof window !== 'undefined' && window.ALL_FAMILIES) ? window.ALL_FAMILIES : [];
      fam = list.find(function (f) { return String(f.id).toUpperCase() === String(familyId).toUpperCase(); });
    } catch (e) { fam = null; }
    if (!fam) {
      notify('Family not found.', 'error');
      return;
    }
    var mIdx = monthIdxOf(monthName);
    var y = parseInt(year, 10);
    if (mIdx < 0 || isNaN(y)) {
      notify('Please choose a valid billing month and year.', 'error');
      return;
    }
    var ctx = buildArrearsContext(fam);
    var data = buildFeeDueInvoiceData(fam, mIdx, y, ctx);
    if (!data.eligible) {
      notify(data.reason, 'info');
      return;
    }
    // Idempotent: an already-issued invoice for this ref opens saved.
    var saved = null;
    try {
      if (typeof window !== 'undefined' && window.FeeTables && typeof window.FeeTables.loadDueInvoicesForFamily === 'function') {
        var existing = await window.FeeTables.loadDueInvoicesForFamily(fam.id) || [];
        for (var i = 0; i < existing.length; i++) {
          if (existing[i] && existing[i].invoiceRef === data.invoiceRef) { saved = existing[i]; break; }
        }
      }
    } catch (e) { saved = null; }
    var toShow = saved || data;
    setCurrentDueInvoice(toShow);
    renderFeeDueInvoiceModal(toShow, !!saved);
    try { if (typeof openModal === 'function') openModal('modalFeeDueInvoice'); } catch (e) { /* modal helper unavailable */ }
  }

  async function openFeeDueInvoiceModalFromRef(ref) {
    var found = null;
    try {
      if (typeof window !== 'undefined' && window.FeeTables && typeof window.FeeTables.loadDueInvoicesForFamily === 'function') {
        var list = await window.FeeTables.loadDueInvoicesForFamily('') || [];
        for (var i = 0; i < list.length; i++) {
          if (list[i] && list[i].invoiceRef === ref) { found = list[i]; break; }
        }
      }
    } catch (e) { found = null; }
    if (!found) {
      notify('That due invoice could not be found.', 'error');
      return;
    }
    setCurrentDueInvoice(found);
    renderFeeDueInvoiceModal(found, true);
    try { if (typeof openModal === 'function') openModal('modalFeeDueInvoice'); } catch (e) { /* modal helper unavailable */ }
  }

  function openFeeDueInvoiceModalFromForm() {
    if (typeof document === 'undefined' || !document.getElementById) return;
    var famId = document.getElementById('feeFormFamilyId') ? document.getElementById('feeFormFamilyId').value : '';
    var month = document.getElementById('feeFormMonth') ? document.getElementById('feeFormMonth').value : '';
    var year = document.getElementById('feeFormYear') ? document.getElementById('feeFormYear').value : '';
    if (!famId) {
      notify('Please search and select a family account first.');
      return;
    }
    openFeeDueInvoiceModal(famId, month, year);
  }

  async function generateFeeDueInvoice() {
    var data = CURRENT_DUE_INVOICE;
    if (!data) {
      notify('No due invoice loaded.', 'error');
      return;
    }
    var btn = (typeof document !== 'undefined' && document.getElementById) ? document.getElementById('feeDueBtnGenerate') : null;
    var originalText = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Saving...';
    }
    try {
      if (!window.FeeTables || typeof window.FeeTables.insertDueInvoiceRow !== 'function') {
        throw new Error('Due invoice storage is unavailable.');
      }
      var res = await window.FeeTables.insertDueInvoiceRow(data);
      setCurrentDueInvoice(res && res.row ? res.row : data);
      renderFeeDueInvoiceModal(CURRENT_DUE_INVOICE, true);
      notify(res && res.existed
        ? 'Fee Due Invoice ' + data.invoiceRef + ' was already issued — showing the saved copy.'
        : 'Fee Due Invoice ' + data.invoiceRef + ' saved.');
      try { loadFeeDueInvoicesList(); } catch (e) { /* refresh is best-effort */ }
    } catch (err) {
      notify('Could not save the due invoice: ' + ((err && err.message) || err), 'error');
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = originalText;
      }
    }
  }

  async function downloadFeeDueInvoicePDF() {
    var data = CURRENT_DUE_INVOICE;
    if (!data) {
      notify('No due invoice loaded to download.');
      return;
    }
    if (typeof document === 'undefined' || !document.getElementById) return;
    var sourceCard = document.getElementById('feeDueInvCard') ||
      document.querySelector('#feeDuePrintArea > div') || document.getElementById('feeDuePrintArea');
    if (!sourceCard) return;
    var btn = document.getElementById('feeDueBtnDownloadPdf');
    var originalText = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Generating PDF...';
    }
    var sandbox = null;
    try {
      var cleanParent = (data.parentName || 'Family').replace(/[^a-zA-Z0-9_-]/g, '_');
      var filename = 'AlHuda-Due-Invoice-' + (data.invoiceRef || 'DUE') + '-' + cleanParent + '.pdf';
      var scrollArea = document.getElementById('feeDuePrintArea');
      if (scrollArea) scrollArea.scrollTop = 0;
      sandbox = document.createElement('div');
      sandbox.id = 'cleanDueInvoicePdfSandbox';
      sandbox.style.position = 'fixed';
      sandbox.style.top = '0';
      sandbox.style.left = '0';
      sandbox.style.width = '794px';
      sandbox.style.minHeight = '1050px';
      sandbox.style.backgroundColor = '#ffffff';
      sandbox.style.zIndex = '-100';
      sandbox.style.overflow = 'visible';
      sandbox.style.boxSizing = 'border-box';
      sandbox.style.padding = '16px';
      var cardClone = sourceCard.cloneNode(true);
      cardClone.style.width = '100%';
      cardClone.style.maxWidth = '100%';
      cardClone.style.margin = '0';
      cardClone.style.boxShadow = 'none';
      cardClone.style.backgroundColor = '#ffffff';
      var cloneLogo = cardClone.querySelector('#feeDueLogoImg') || cardClone.querySelector('img');
      var origLogo = sourceCard.querySelector('#feeDueLogoImg') || sourceCard.querySelector('img');
      if (cloneLogo && origLogo) {
        cloneLogo.crossOrigin = 'anonymous';
        if (origLogo.complete && origLogo.naturalWidth > 0) cloneLogo.src = origLogo.src;
      }
      sandbox.appendChild(cardClone);
      document.body.appendChild(sandbox);
      await new Promise(function (resolve) { setTimeout(resolve, 120); });
      var pdfGenerated = false;
      var hasHtml2Canvas = typeof html2canvas !== 'undefined';
      var hasJsPDF = typeof window.jspdf !== 'undefined' && window.jspdf.jsPDF;
      if (hasHtml2Canvas && hasJsPDF) {
        try {
          var canvas = await html2canvas(cardClone, {
            scale: 2, useCORS: true, allowTaint: true, scrollY: 0, scrollX: 0,
            backgroundColor: '#ffffff', logging: false, windowWidth: 794
          });
          if (canvas && canvas.width > 0 && canvas.height > 0) {
            var imgData = canvas.toDataURL('image/jpeg', 0.98);
            var jsPDF = window.jspdf.jsPDF;
            var pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
            var pageWidth = pdf.internal.pageSize.getWidth();
            var pageHeight = pdf.internal.pageSize.getHeight();
            var margin = 8;
            var maxContentWidth = pageWidth - (margin * 2);
            var maxContentHeight = pageHeight - (margin * 2);
            var renderWidth = maxContentWidth;
            var renderHeight = (canvas.height * renderWidth) / canvas.width;
            if (renderHeight > maxContentHeight) {
              var ratio = maxContentHeight / renderHeight;
              renderHeight = maxContentHeight;
              renderWidth = renderWidth * ratio;
            }
            var xPos = margin + ((maxContentWidth - renderWidth) / 2);
            pdf.addImage(imgData, 'JPEG', xPos, margin, renderWidth, renderHeight, undefined, 'FAST');
            pdf.save(filename);
            pdfGenerated = true;
            // Fee Upgrade Phase 5: the generated bytes are ALSO stored
            // in R2 (same DUE ref, same key). A failed upload never
            // blocks the local download — the invoice is marked
            // pdfPending and retries on the next download.
            var pdfBytes = null;
            try { pdfBytes = pdf.output('arraybuffer'); } catch (e) { pdfBytes = null; }
            if (pdfBytes) {
              var stored = await storeDueInvoicePdf(data, pdfBytes);
              notify(stored.ok
                ? 'Due Invoice PDF downloaded and saved to cloud.'
                : 'Due Invoice PDF downloaded. Cloud save did not complete — download again to retry.');
            } else {
              notify('Due Invoice PDF downloaded successfully!');
            }
          }
        } catch (canvasErr) {
          try { console.warn('[Due Invoice PDF] html2canvas+jsPDF notice:', canvasErr); } catch (e) { /* logging only */ }
        }
      }
      if (!pdfGenerated && typeof html2pdf !== 'undefined') {
        var opt = {
          margin: [8, 8, 8, 8], filename: filename,
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true, allowTaint: true, scrollY: 0, scrollX: 0, backgroundColor: '#ffffff', logging: false, windowWidth: 794 },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
          pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
        };
        // Fee Upgrade Phase 5: prefer outputPdf so the same bytes can
        // be downloaded AND stored in R2; fall back to the library's
        // own save() when outputPdf is unavailable (local download
        // only — the cloud copy retries on the next download).
        var pdfBytes2 = null;
        try {
          pdfBytes2 = await html2pdf().set(opt).from(cardClone).outputPdf('arraybuffer');
        } catch (e) { pdfBytes2 = null; }
        if (pdfBytes2) {
          var blob = new Blob([pdfBytes2], { type: 'application/pdf' });
          var blobUrl = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = blobUrl;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(function () { URL.revokeObjectURL(blobUrl); }, 1000);
          var stored2 = await storeDueInvoicePdf(data, pdfBytes2);
          notify(stored2.ok
            ? 'Due Invoice PDF downloaded and saved to cloud.'
            : 'Due Invoice PDF downloaded. Cloud save did not complete — download again to retry.');
        } else {
          await html2pdf().set(opt).from(cardClone).save();
          notify('Due Invoice PDF downloaded successfully!');
        }
        pdfGenerated = true;
      }
      if (!pdfGenerated) printFeeDueInvoice();
    } catch (err) {
      try { console.error('[Due Invoice PDF] Generation failed:', err); } catch (e) { /* logging only */ }
      notify('Opening print preview for PDF saving...');
      printFeeDueInvoice();
    } finally {
      if (sandbox && sandbox.parentNode) sandbox.parentNode.removeChild(sandbox);
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = originalText;
      }
    }
  }

  // Fee Upgrade Phase 5 — store one generated Due Invoice PDF in R2
  // and record its key on the payments-table row (legacy_json +
  // receipt_url, via FeeTables.updateDueInvoicePdfKey). The in-memory
  // CURRENT_DUE_INVOICE is updated too, so the open modal sees the
  // stored state at once. Returns { ok, key } or { ok: false, error }.
  // Never throws; a failed upload marks the invoice pdfPending and the
  // list offers a retry via the modal download.
  function feePdfAuthHeaders() {
    try {
      if (typeof window !== 'undefined' && typeof window.getLmsAuthHeaders === 'function') {
        return window.getLmsAuthHeaders() || {};
      }
    } catch (e) { /* no token available — upload reports it, never throws */ }
    return {};
  }

  async function storeDueInvoicePdf(data, bytes) {
    if (!data || !data.invoiceRef) return { ok: false, error: 'missing_ref' };
    if (String(data.status || '').toLowerCase().indexOf('cancel') !== -1) {
      return { ok: false, error: 'cancelled' };
    }
    if (typeof window === 'undefined' || !window.FeePhase5 ||
        typeof window.FeePhase5.uploadFeePdf !== 'function') {
      return { ok: false, error: 'module_missing' };
    }
    var res;
    try {
      res = await window.FeePhase5.uploadFeePdf(
        fetch, window.FeePhase5.feePdfApiBase(), feePdfAuthHeaders(),
        'due-invoice', data.invoiceRef, bytes
      );
    } catch (e) {
      res = { ok: false, error: 'network_error' };
    }
    if (res.ok) {
      data.pdfKey = res.key;
      delete data.pdfPending;
      try {
        if (window.FeeTables && typeof window.FeeTables.updateDueInvoicePdfKey === 'function') {
          await window.FeeTables.updateDueInvoicePdfKey(data.invoiceRef, res.key, false);
        }
      } catch (e) { /* in-memory key is kept; the table copy retries on next sync */ }
      try { loadFeeDueInvoicesList(); } catch (e) { /* refresh is best-effort */ }
      return { ok: true, key: res.key };
    }
    data.pdfPending = true;
    try {
      if (window.FeeTables && typeof window.FeeTables.updateDueInvoicePdfKey === 'function') {
        await window.FeeTables.updateDueInvoicePdfKey(data.invoiceRef, null, true);
      }
    } catch (e) { /* in-memory flag is kept */ }
    return { ok: false, error: res.error || 'upload_failed' };
  }

  // Open a stored Due Invoice PDF in a new tab (fetched with the
  // session token). Never throws.
  async function openStoredDueInvoicePdf(pdfKey) {
    if (!pdfKey) {
      notify('No stored PDF for this invoice yet.', 'error');
      return;
    }
    if (typeof window === 'undefined' || !window.FeePhase5 ||
        typeof window.FeePhase5.openStoredFeePdf !== 'function') {
      notify('Stored PDF is unavailable right now. Please reload the page.', 'error');
      return;
    }
    var res;
    try {
      res = await window.FeePhase5.openStoredFeePdf(
        fetch, window.FeePhase5.feePdfApiBase(), feePdfAuthHeaders(), pdfKey,
        { window: window, document: document, URL: URL }
      );
    } catch (e) {
      res = { ok: false, error: 'network_error' };
    }
    if (!res.ok) notify(res.error || 'Could not open the stored PDF.', 'error');
  }

  function printFeeDueInvoice() {
    if (typeof document === 'undefined' || !document.getElementById) return;
    var card = document.getElementById('feeDueInvCard') ||
      document.querySelector('#feeDuePrintArea > div') || document.getElementById('feeDuePrintArea');
    if (!card) return;
    var data = CURRENT_DUE_INVOICE;
    var printFrame = document.getElementById('feeDueInvoicePrintFrame');
    if (!printFrame) {
      printFrame = document.createElement('iframe');
      printFrame.id = 'feeDueInvoicePrintFrame';
      printFrame.style.position = 'fixed';
      printFrame.style.right = '0';
      printFrame.style.bottom = '0';
      printFrame.style.width = '0';
      printFrame.style.height = '0';
      printFrame.style.border = '0';
      document.body.appendChild(printFrame);
    }
    var frameDoc = printFrame.contentWindow.document;
    frameDoc.open();
    frameDoc.write('<!DOCTYPE html>\n<html>\n<head>\n  <title>Al-Huda Fee Due Invoice - ' + (data ? (data.invoiceRef || '') : '') + '</title>\n  <meta charset="UTF-8">\n  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">\n  <script src="https://cdn.tailwindcss.com"><\/script>\n  <style>\n    @page { size: A4 portrait; margin: 8mm; }\n    body { font-family: \'Plus Jakarta Sans\', system-ui, -apple-system, sans-serif; background: #ffffff; color: #0f172a; margin: 0; padding: 12px; }\n    table { width: 100% !important; border-collapse: collapse !important; }\n  </style>\n</head>\n<body class="p-2 bg-white">\n  ' + card.outerHTML + '\n</body>\n</html>');
    frameDoc.close();
    setTimeout(function () {
      try { printFrame.contentWindow.focus(); printFrame.contentWindow.print(); } catch (e) { /* print unavailable */ }
    }, 350);
  }

  async function sendFeeDueInvoiceEmail() {
    var data = CURRENT_DUE_INVOICE;
    if (!data) {
      notify('No due invoice loaded to email.');
      return;
    }
    var isManager = (typeof CURRENT_ROLE !== 'undefined' && CURRENT_ROLE === 'manager') ||
      (typeof window !== 'undefined' && window.CURRENT_ROLE === 'manager');
    var academy = 'Al-Huda Islamic Centre';
    try { if (typeof academyName === 'function') academy = academyName(); } catch (e) { /* keep default */ }
    var offEmail = '';
    try { if (typeof getOfficialAcademyEmail === 'function') offEmail = getOfficialAcademyEmail(); } catch (e) { /* keep blank */ }
    var cur = data.currency || 'USD';
    var money = function (v) { return cur + ' ' + num(v).toFixed(2); };
    var subject = 'Fee Due Invoice [' + data.invoiceRef + '] - ' + data.parentName + ' (' + data.month + ' ' + data.year + ') - ' + academy;
    var arrearsLines = (Array.isArray(data.arrearsDetail) ? data.arrearsDetail : []).map(function (a) {
      return '<tr><td style="padding:6px 8px;border-bottom:1px solid #eee;">Arrears — ' + escHtml(a.month) + ' ' + escHtml(String(a.year)) + '</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">' + money(a.shortfall) + '</td></tr>';
    }).join('');
    var html = '<div style="font-family:system-ui,Arial,sans-serif;color:#0f172a;max-width:640px;">' +
      '<h2 style="color:#065f46;margin:0 0 4px;">' + escHtml(academy) + '</h2>' +
      '<p style="margin:0 0 12px;color:#475569;">Official Tuition Fee Due Invoice — <strong>PAYMENT REQUEST, NOT A PAYMENT RECEIPT</strong></p>' +
      '<p><strong>Invoice Ref:</strong> ' + escHtml(data.invoiceRef) + '<br><strong>Issue Date:</strong> ' + escHtml(data.issueDate || '') + '<br><strong>Parent / Guardian:</strong> ' + escHtml(data.parentName) + '<br><strong>Family Account ID:</strong> ' + escHtml(data.familyId) + '<br><strong>Student(s):</strong> ' + escHtml(data.studentsNames) + '<br><strong>Billing Period:</strong> ' + escHtml(data.month) + ' ' + escHtml(String(data.year)) + '</p>' +
      '<table style="width:100%;border-collapse:collapse;font-size:14px;">' +
      '<tr><td style="padding:6px 8px;border-bottom:1px solid #eee;">Tuition Fee — ' + escHtml(data.month) + ' ' + escHtml(String(data.year)) + '</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">' + money(data.monthlyFee) + '</td></tr>' +
      arrearsLines +
      '<tr><td style="padding:6px 8px;border-bottom:1px solid #eee;"><strong>Net Total Payable</strong></td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;"><strong>' + money(data.totalPayable) + '</strong></td></tr>' +
      (num(data.discount) > 0 ? '<tr><td style="padding:6px 8px;border-bottom:1px solid #eee;">Fee Concession / Discount</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">- ' + money(data.discount) + '</td></tr>' : '') +
      '<tr><td style="padding:6px 8px;border-bottom:1px solid #eee;">Amount Paid (this month)</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">' + money(data.amountPaid) + '</td></tr>' +
      '<tr><td style="padding:6px 8px;"><strong style="color:#991b1b;">TOTAL OUTSTANDING DUE</strong></td><td style="padding:6px 8px;text-align:right;"><strong style="color:#991b1b;">' + money(data.outstanding) + '</strong></td></tr>' +
      '</table>' +
      '<p><strong>Due Date:</strong> ' + escHtml(data.dueDate || '') + '<br>' + escHtml(data.timingMessage || '') + '</p>' +
      '<p style="color:#475569;">Please arrange payment of the outstanding amount by the due date. This is a payment request, not a payment receipt. A receipt will be issued once the payment is received.</p>' +
      '<p>JazakAllahu Khairan!<br>' + escHtml(academy) + ' Accounts<br>Official Email: ' + escHtml(offEmail) + '</p></div>';
    var plainText = 'OFFICIAL FEE DUE INVOICE - ' + academy.toUpperCase() + '\n--------------------------------------\nInvoice Ref: ' + data.invoiceRef + '\nDate: ' + (data.issueDate || '') + '\nParent: ' + data.parentName + ' (' + data.familyId + ')\nStudent(s): ' + data.studentsNames + '\nBilling Period: ' + data.month + ' ' + data.year + '\nMonthly Fee: ' + money(data.monthlyFee) + '\nPrevious Arrears: ' + money(data.previousArrears) + '\nDiscount: ' + money(data.discount) + '\nAmount Paid: ' + money(data.amountPaid) + '\nTOTAL OUTSTANDING DUE: ' + money(data.outstanding) + '\nDue Date: ' + (data.dueDate || '') + '\n--------------------------------------\nThis is a payment request, not a payment receipt.\nJazakAllahu Khairan!\n' + academy + ' Accounts\nOfficial Email: ' + offEmail;

    var targetEmail = data.email || '';
    if (!targetEmail && !isManager) {
      try {
        var fam = null;
        if (typeof window !== 'undefined' && window.ALL_FAMILIES) {
          fam = window.ALL_FAMILIES.find(function (f) { return String(f.id).toUpperCase() === String(data.familyId).toUpperCase(); });
        }
        if (fam && (fam.parent_email || fam.email)) targetEmail = fam.parent_email || fam.email;
      } catch (e) { /* keep blank */ }
    }
    if (!isManager && (!targetEmail || !targetEmail.includes('@'))) {
      try {
        if (typeof lmsPrompt === 'function') {
          var promptEmail = await lmsPrompt('Please enter parent email address for ' + data.parentName + ' (' + data.familyId + '):', '', {
            title: 'Parent Email Required', subtitle: data.parentName + ' (' + data.familyId + ')', confirmText: 'Send Invoice'
          });
          if (promptEmail && promptEmail.includes('@')) targetEmail = promptEmail.trim();
        }
      } catch (e) { /* prompt unavailable */ }
    }
    if (!isManager && (!targetEmail || !targetEmail.includes('@'))) {
      notify('No valid parent email address found for ' + data.parentName + '. Please specify parent email.');
      return;
    }

    var dispatched = false;
    try {
      if (typeof window !== 'undefined' && typeof window.sendParentEmailViaNotify === 'function' && isManager) {
        var notifyRes = await window.sendParentEmailViaNotify({
          familyId: data.familyId, subject: subject, text: plainText, html: html
        });
        dispatched = !!(notifyRes && notifyRes.success);
        if (!dispatched) notify('Invoice email could NOT be sent — ' + ((notifyRes && notifyRes.error) || 'please send it manually.'), 'error');
      } else if (typeof window !== 'undefined' && typeof window.sendViaOfficialEmailRelay === 'function') {
        var relayRes = await window.sendViaOfficialEmailRelay({
          to: targetEmail, subject: subject, html: html, text: plainText, senderName: academy + ' (' + offEmail + ')'
        });
        dispatched = !!(relayRes && relayRes.success);
        if (!dispatched) notify('Invoice email could NOT be sent — ' + ((relayRes && relayRes.error) || 'please send it manually.'), 'error');
      } else if (typeof emailjs !== 'undefined' && typeof window !== 'undefined' && window.EMAILJS_PUBLIC_KEY) {
        await emailjs.send(window.EMAILJS_SERVICE_ID, window.EMAILJS_TEMPLATE_ID, {
          to_email: targetEmail, subject: subject, message: plainText,
          from_name: academy + ' (' + offEmail + ')'
        });
        dispatched = true;
      }
    } catch (err) {
      dispatched = false;
      notify('Invoice email could NOT be sent — the due invoice is still saved, please send it manually.', 'error');
    }
    if (dispatched) {
      notify('Due Invoice email dispatched to ' + (isManager ? 'the parent' : targetEmail) + '.');
      return;
    }
    if (!isManager && targetEmail) {
      var gmailUrl = 'https://mail.google.com/mail/?view=cm&fs=1&to=' + encodeURIComponent(targetEmail) +
        '&cc=' + encodeURIComponent(offEmail) + '&su=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(plainText);
      try { window.open(gmailUrl, '_blank'); } catch (e) { /* popup blocked */ }
      notify('Official Due Invoice Email prepared.');
    }
  }

  async function loadFeeDueInvoicesList() {
    if (typeof document === 'undefined' || !document.getElementById) return;
    var tbody = document.getElementById('feeDueInvoicesTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="8" class="p-8 text-center text-slate-400">Loading due invoices...</td></tr>';
    var list = [];
    try {
      if (typeof window !== 'undefined' && window.FeeTables && typeof window.FeeTables.loadDueInvoicesForFamily === 'function') {
        list = await window.FeeTables.loadDueInvoicesForFamily('') || [];
      }
    } catch (e) { list = []; }
    list = list.slice().sort(function (a, b) {
      var da = String((a && (a.issueDate || a.createdAt)) || '');
      var db = String((b && (b.issueDate || b.createdAt)) || '');
      return db < da ? -1 : (db > da ? 1 : 0);
    }).slice(0, 50);
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="p-8 text-center text-slate-400">No fee due invoices issued yet.</td></tr>';
      return;
    }
    tbody.innerHTML = list.map(function (d) {
      var cur = d.currency || 'USD';
      var status = String(d.status || 'Issued');
      var pill = status.toLowerCase() === 'cancelled'
        ? 'bg-slate-100 text-slate-600 border border-slate-200'
        : 'bg-amber-100 text-amber-800 border border-amber-200';
      return '<tr class="hover:bg-slate-50 transition">' +
        '<td class="p-3 font-mono font-bold text-slate-800">' + escHtml(d.invoiceRef || '') + '</td>' +
        '<td class="p-3 text-slate-500 font-mono">' + escHtml(d.issueDate || '') + '</td>' +
        '<td class="p-3 font-mono font-bold text-emerald-900">' + escHtml(d.familyId || '') + '</td>' +
        '<td class="p-3 font-bold text-slate-900">' + escHtml(d.parentName || '') + '</td>' +
        '<td class="p-3 font-medium text-slate-700">' + escHtml(d.month || '') + ' ' + escHtml(String(d.year || '')) + '</td>' +
        '<td class="p-3 font-mono font-bold text-rose-700">' + cur + ' ' + num(d.outstanding).toFixed(2) + '</td>' +
        '<td class="p-3"><span class="px-2 py-0.5 rounded-full text-[10px] font-bold ' + pill + '">' + escHtml(status) + '</span></td>' +
        '<td class="p-3 text-right"><button onclick="window.FeePhase1.openFeeDueInvoiceModalFromRef(\'' + escHtml(d.invoiceRef || '') + '\')" class="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition inline-flex items-center gap-1"><i class="fa-solid fa-file-invoice text-slate-500"></i> View</button>' +
        // Fee Upgrade Phase 5: "Open PDF" when a stored copy exists;
        // an honest retry note when the last upload failed. Cancelled
        // invoices never get an Open PDF button.
        (status.toLowerCase() === 'cancelled' ? '' :
          (d.pdfKey
            ? ' <button onclick="window.FeePhase1.openStoredDueInvoicePdf(\'' + escHtml(d.pdfKey) + '\')" class="px-3 py-1 bg-emerald-100 hover:bg-emerald-200 text-emerald-800 border border-emerald-300 rounded-xl text-xs font-bold transition inline-flex items-center gap-1" title="Open the PDF saved in the cloud"><i class="fa-solid fa-cloud-arrow-down"></i> Open PDF</button>'
            : (d.pdfPending
              ? ' <span class="block text-[10px] text-amber-600 mt-1">Cloud save pending — open and download again to retry.</span>'
              : ''))) +
        '</td>' +
        '</tr>';
    }).join('');
  }

  // --------------------------------------------------------------------------
  // PUBLIC EXPORT
  // --------------------------------------------------------------------------
  if (typeof window !== 'undefined') {
    window.FeePhase1 = {
      MONTHS: MONTHS,
      parseFeeRevisions: parseFeeRevisions,
      normalizeFeeRevision: normalizeFeeRevision,
      upsertFeeRevision: upsertFeeRevision,
      findFeeRevisionAt: findFeeRevisionAt,
      feePresetTarget: feePresetTarget,
      getApplicableFeeForMonth: getApplicableFeeForMonth,
      getFeeDueDate: getFeeDueDate,
      billingDayOf: billingDayOf,
      readFeeDueSettings: readFeeDueSettings,
      normalizeFeeTiming: normalizeFeeTiming,
      dueDayOf: dueDayOf,
      feeTimingOf: feeTimingOf,
      dueInvoiceRef: dueInvoiceRef,
      classifyFeeArrears: classifyFeeArrears,
      buildFeeDueInvoiceData: buildFeeDueInvoiceData,
      receiptBaseNo: receiptBaseNo,
      receiptGroupRows: receiptGroupRows,
      isNewestPaymentRow: isNewestPaymentRow,
      buildArrearsContext: buildArrearsContext,
      renderFeeSourceNote: renderFeeSourceNote,
      feeTimelineListHtml: feeTimelineListHtml,
      toggleFeeRevisionSection: toggleFeeRevisionSection,
      onFeeEffectivePresetChange: onFeeEffectivePresetChange,
      updateFeeProtectionNotice: updateFeeProtectionNotice,
      checkFamilyFeeChange: checkFamilyFeeChange,
      buildFeeRevisionForEdit: buildFeeRevisionForEdit,
      requestUndoFeePayment: requestUndoFeePayment,
      openFeeDueInvoiceModal: openFeeDueInvoiceModal,
      openFeeDueInvoiceModalFromRef: openFeeDueInvoiceModalFromRef,
      openFeeDueInvoiceModalFromForm: openFeeDueInvoiceModalFromForm,
      generateFeeDueInvoice: generateFeeDueInvoice,
      downloadFeeDueInvoicePDF: downloadFeeDueInvoicePDF,
      storeDueInvoicePdf: storeDueInvoicePdf,
      openStoredDueInvoicePdf: openStoredDueInvoicePdf,
      printFeeDueInvoice: printFeeDueInvoice,
      sendFeeDueInvoiceEmail: sendFeeDueInvoiceEmail,
      loadFeeDueInvoicesList: loadFeeDueInvoicesList
    };
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = (typeof window !== 'undefined') ? window.FeePhase1 : {};
  }
})();

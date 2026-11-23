/**
 * ============================================================================
 * AL-HUDA ISLAMIC CENTRE LMS — FEE UPGRADE PHASE 2
 * File: js/fee-phase2.js
 * Purpose: Bulk Collect (fee-portal #52) + Bulk Leave (fee-portal #55)
 *   for the LMS admin fee tab and Leave tab.
 *
 * Design notes (adaptations from the fee portal, Batch 27):
 * - Bulk Collect is month-scoped: it collects the due amount shown on the
 *   Pending view for the selected month. Each family goes through the
 *   EXISTING single-payment save path (same receipt numbering via
 *   generateReceiptNo, same record shape as handleFeePaymentSubmit, same
 *   cloud sync + dual-write in fees.js saveBulkFeePaymentRecord) — this
 *   module only builds the record and drives the loop; it never writes.
 * - Duplicate warn-and-ask in bulk form: the selection is pre-scanned
 *   against stored records (same rule as findFeeMonthDuplicate); the
 *   Pending bar warns live and skips already-paid families by default.
 *   Unchecking the skip box charges them again, exactly like the single
 *   form's "Save Anyway".
 * - A failed row never stops the run: the runner records the failure and
 *   continues with the next family, and already-paid rows in the run are
 *   never re-charged (they are skipped before the run starts).
 * - Bulk Leave reuses the single-student leave flow: leaves.js exposes
 *   applyStudentLeave (extracted from handleSaveStudentLeave) and the
 *   runner calls it once per student. A whole family goes on leave, so
 *   every non-deactivated, not-already-on-leave student of the family is
 *   put on leave; deactivated / already-on-leave students are skipped
 *   and reported, never failed.
 * - Leave months map to one date window: the 1st of the earliest month
 *   to the last day of the latest month (the LMS leave engine is
 *   date-window based; the fee portal's month list is the same idea).
 * - Pure functions take explicit inputs so the test suites can execute
 *   the real logic without a browser. DOM helpers return strings only.
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

  function round2(v) {
    return Math.round((num(v, 0) + Number.EPSILON) * 100) / 100;
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

  function lastDayOfMonth(year, monthIdx) {
    var y = parseInt(year, 10) || 2000;
    return new Date(y, monthIdx + 1, 0).getDate();
  }

  function isoDate(y, monthIdx, day) {
    var mm = String(monthIdx + 1).padStart(2, '0');
    var dd = String(day).padStart(2, '0');
    return y + '-' + mm + '-' + dd;
  }

  function todayIso() {
    return new Date().toISOString().slice(0, 10);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmtMoney(cur, amt) {
    return (cur || 'USD') + ' ' + round2(amt).toFixed(2);
  }

  // --------------------------------------------------------------------------
  // BULK COLLECT — pure selection / amounts / duplicates / record building
  // --------------------------------------------------------------------------

  // One Pending-view row, normalised. Returns null for rows that cannot be
  // collected (no family id, or a due amount that is not positive).
  function normalizePendingRow(item) {
    if (!item || !item.familyId) return null;
    var due = round2(num(item.dueAmount, 0));
    if (!(due > 0)) return null;
    var monthIdx = monthIdxOf(item.selectedMonth != null ? item.selectedMonth : item.month);
    var year = parseInt(item.selectedYear != null ? item.selectedYear : item.year, 10);
    if (isNaN(year)) year = new Date().getFullYear();
    return {
      familyId: String(item.familyId),
      parentName: item.parentName || '',
      studentsNames: item.studentsNames || '',
      country: item.country || 'International',
      whatsapp: item.whatsapp || '',
      email: item.email || '',
      currency: String(item.currency || 'USD').toUpperCase(),
      dueAmount: due,
      month: monthIdx >= 0 ? MONTHS[monthIdx] : String(item.selectedMonth || item.month || ''),
      monthIdx: monthIdx,
      year: year,
      isPartial: !!item.isPartial,
      status: item.status || 'Pending',
      family: item.family || null
    };
  }

  function bulkCollectRows(pendingList) {
    return (Array.isArray(pendingList) ? pendingList : [])
      .map(normalizePendingRow)
      .filter(function (r) { return r !== null; });
  }

  // Selected rows + per-currency totals. Families can bill in different
  // currencies, so totals are a map — never one summed number.
  function bulkCollectSelection(rows, selectedIds) {
    var wanted = {};
    (Array.isArray(selectedIds) ? selectedIds : []).forEach(function (id) {
      wanted[String(id).toUpperCase()] = true;
    });
    var selected = (Array.isArray(rows) ? rows : []).filter(function (r) {
      return !!wanted[String(r.familyId).toUpperCase()];
    });
    var totals = {};
    selected.forEach(function (r) {
      totals[r.currency] = round2((totals[r.currency] || 0) + r.dueAmount);
    });
    return { selected: selected, count: selected.length, totals: totals };
  }

  // Same rule as findFeeMonthDuplicate (fees.js): same family + month +
  // year, any status except Cancelled. Returns [{ row, existing }].
  function findBulkCollectDuplicates(records, rows) {
    var list = Array.isArray(records) ? records : [];
    var out = [];
    (Array.isArray(rows) ? rows : []).forEach(function (row) {
      var hit = list.find(function (r) {
        return r &&
          String(r.familyId || '').toUpperCase() === String(row.familyId).toUpperCase() &&
          String(r.month || '').trim().toLowerCase() === String(row.month).toLowerCase() &&
          parseInt(r.year, 10) === parseInt(row.year, 10) &&
          String(r.status || '').toLowerCase() !== 'cancelled';
      }) || null;
      if (hit) out.push({ row: row, existing: hit });
    });
    return out;
  }

  // The payment record for one bulk row — the SAME shape
  // handleFeePaymentSubmit builds for a single payment, so receipts,
  // ledger, matrix and the payments table treat it identically.
  // opts: receiptNo (required), paymentMethod, transactionId, notes,
  // dateStr, monthlyFee (the applicable fee for the month — the runner
  // reads it from feeFormApplicableFeeDetails), priorPaid (already paid
  // for this family+month; defaults to monthlyFee - dueAmount, which is
  // exactly how the Pending view computed the due amount).
  function buildBulkPaymentRecord(row, opts) {
    var o = opts || {};
    if (!o.receiptNo) throw new Error('Bulk payment record needs a receipt number.');
    var monthlyFee = num(o.monthlyFee, 0);
    if (!(monthlyFee > 0)) monthlyFee = row.dueAmount;
    monthlyFee = round2(monthlyFee);
    var priorPaid = (o.priorPaid != null)
      ? round2(Math.max(0, num(o.priorPaid, 0)))
      : round2(Math.max(0, monthlyFee - row.dueAmount));
    var amountPaid = row.dueAmount;
    var netDue = Math.max(0, round2(monthlyFee - priorPaid));
    var excessPaid = Math.max(0, round2(amountPaid - netDue));
    var remainingBalance = Math.max(0, round2(netDue - amountPaid));
    var status = remainingBalance > 0.005
      ? 'Partial (Balance Remaining)'
      : (excessPaid > 0.005 ? 'Paid in Full (Advance Credit)' : 'Paid in Full');
    return {
      receiptNo: String(o.receiptNo),
      date: o.dateStr || todayIso(),
      familyId: row.familyId,
      parentName: row.parentName,
      studentsNames: row.studentsNames,
      country: row.country,
      whatsapp: row.whatsapp,
      email: row.email,
      month: row.month,
      year: row.year,
      monthlyFee: monthlyFee,
      previousBalance: 0,
      creditDeducted: 0,
      totalPayable: monthlyFee,
      amountPaid: amountPaid,
      discount: 0,
      remainingBalance: remainingBalance,
      excessPaid: excessPaid,
      currency: row.currency,
      paymentMethod: o.paymentMethod || 'Online / Bank Transfer',
      transactionId: o.transactionId || 'N/A',
      notes: o.notes || '',
      status: status,
      isProrated: false,
      activeDays: 0,
      joiningDate: '',
      isAdvancePayment: false,
      advanceMonthsCount: 1
    };
  }

  // Runs the collect loop. deps: saveRecord(record) -> Promise<{ok,
  // receiptNo?, error?}>, generateReceiptNo() -> string, paymentMethod,
  // transactionId, notes, dateStr, emailReceipts (bool), sendEmail(record)
  // -> Promise, monthlyFeeForRow(row) -> number, priorPaidForRow(row) ->
  // number, onRow(index, total, outcome). A row failure never stops the
  // run; an email failure never fails the row (it is reported on it).
  // Runs the collect loop with BOUNDED CONCURRENCY (button-delay
  // build 2026-11-20, audit §5(ii)5): up to BULK_COLLECT_CONCURRENCY
  // families in flight instead of await-in-loop, so N families cost
  // ~N/5 round-trips of wall time. Receipt emails are sent AFTER all
  // saves finish (not interleaved), in input order, and an email
  // failure still never fails the row. Per-row progress (onRow) fires
  // as each save lands; results stay in input order.
  var BULK_COLLECT_CONCURRENCY = 5;
  async function runBulkCollect(rows, deps) {
    var list = Array.isArray(rows) ? rows : [];
    if (!deps || typeof deps.saveRecord !== 'function') {
      throw new Error('Bulk Collect needs a save function.');
    }
    if (typeof deps.generateReceiptNo !== 'function') {
      throw new Error('Bulk Collect needs a receipt-number generator.');
    }
    var results = new Array(list.length);
    var paid = 0;
    var failed = 0;
    var totalCollected = {};
    var nextIndex = 0;
    var emailQueue = [];
    async function collectOne(index) {
      var row = list[index];
      var record = null;
      var outcome = null;
      try {
        record = buildBulkPaymentRecord(row, {
          receiptNo: deps.generateReceiptNo(),
          paymentMethod: deps.paymentMethod,
          transactionId: deps.transactionId,
          notes: deps.notes,
          dateStr: deps.dateStr,
          monthlyFee: (typeof deps.monthlyFeeForRow === 'function') ? deps.monthlyFeeForRow(row) : row.dueAmount,
          priorPaid: (typeof deps.priorPaidForRow === 'function') ? deps.priorPaidForRow(row) : undefined
        });
        var saved = await deps.saveRecord(record);
        if (saved && saved.ok) {
          paid++;
          totalCollected[row.currency] = round2((totalCollected[row.currency] || 0) + row.dueAmount);
          if (deps.emailReceipts && typeof deps.sendEmail === 'function') emailQueue.push({ record: record, index: index });
          outcome = { row: row, ok: true, receiptNo: record.receiptNo, emailError: null };
        } else {
          failed++;
          outcome = { row: row, ok: false, receiptNo: record.receiptNo, error: (saved && saved.error) || 'Payment could not be saved.' };
        }
      } catch (e) {
        failed++;
        outcome = { row: row, ok: false, receiptNo: record ? record.receiptNo : null, error: (e && e.message) || 'Payment could not be saved.' };
      }
      results[index] = outcome;
      if (typeof deps.onRow === 'function') {
        try { deps.onRow(index, list.length, outcome); } catch (e) { /* progress must never break the run */ }
      }
    }
    async function worker() {
      while (nextIndex < list.length) {
        var index = nextIndex++;
        await collectOne(index);
      }
    }
    var workerCount = Math.min(BULK_COLLECT_CONCURRENCY, list.length);
    var workers = [];
    for (var w = 0; w < workerCount; w++) workers.push(worker());
    await Promise.all(workers);
    // Receipt emails after the loop, in input order.
    for (var e = 0; e < emailQueue.length; e++) {
      var queued = emailQueue[e];
      try { await deps.sendEmail(queued.record); }
      catch (err) {
        if (results[queued.index]) results[queued.index].emailError = 'Receipt email could not be sent.';
      }
    }
    return { paid: paid, failed: failed, totalCollected: totalCollected, results: results };
  }

  function bulkCollectRowResultHtml(outcome) {
    var row = outcome.row || {};
    if (outcome.ok) {
      return '<div class="flex items-start gap-2 text-[11px] py-1 border-b border-slate-100">' +
        '<i class="fa-solid fa-circle-check text-emerald-600 mt-0.5"></i>' +
        '<span class="flex-1"><strong>' + esc(row.parentName || row.familyId) + '</strong> <span class="font-mono text-slate-500">' + esc(row.familyId) + '</span> — ' + esc(fmtMoney(row.currency, row.dueAmount)) + ' paid' +
        (outcome.receiptNo ? ' <span class="font-mono text-slate-500">(' + esc(outcome.receiptNo) + ')</span>' : '') +
        (outcome.emailError ? ' <span class="text-amber-700 font-bold">— ' + esc(outcome.emailError) + '</span>' : '') +
        '</span></div>';
    }
    return '<div class="flex items-start gap-2 text-[11px] py-1 border-b border-slate-100">' +
      '<i class="fa-solid fa-circle-xmark text-rose-600 mt-0.5"></i>' +
      '<span class="flex-1"><strong>' + esc(row.parentName || row.familyId) + '</strong> <span class="font-mono text-slate-500">' + esc(row.familyId) + '</span> — <span class="text-rose-700 font-bold">' + esc(outcome.error || 'Payment could not be saved.') + '</span>' +
      (outcome.receiptNo ? ' <span class="font-mono text-slate-500">(' + esc(outcome.receiptNo) + ')</span>' : '') +
      '</span></div>';
  }

  function bulkCollectSummaryHtml(summary, skippedCount) {
    var s = summary || { paid: 0, failed: 0, totalCollected: {}, results: [] };
    var totals = Object.keys(s.totalCollected || {}).sort().map(function (cur) {
      return fmtMoney(cur, s.totalCollected[cur]);
    }).join(' + ') || '—';
    var skippedLine = (skippedCount > 0)
      ? '<p>Skipped (already paid this month): <strong>' + skippedCount + '</strong></p>' : '';
    return '<div class="mt-2 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-[11px] leading-relaxed text-emerald-950 space-y-0.5">' +
      '<p class="font-extrabold text-xs">Bulk Collect finished — ' + s.paid + ' paid, ' + s.failed + ' failed.</p>' +
      '<p>Total collected: <strong>' + esc(totals) + '</strong></p>' +
      skippedLine +
      (s.failed > 0 ? '<p class="text-rose-800 font-bold">Failed families are still pending — collect them one by one from the Pending list.</p>' : '') +
      '<p class="text-slate-600">Receipts are in Receipts &amp; History. The Pending list has been refreshed.</p>' +
      '</div>';
  }

  // --------------------------------------------------------------------------
  // BULK LEAVE — pure selection / months / validation / runner
  // --------------------------------------------------------------------------

  // One student's bulk-leave state, from the same signals the Leave tab
  // uses: deactivated (status / is_active), or already on leave
  // (notes meta on_leave). A student whose leave window already passed
  // is still on leave until reactivated, so it still counts as on-leave.
  function studentLeaveState(st, todayStr) {
    if (!st) return 'deactivated';
    if (st.is_active === false) return 'deactivated';
    var status = String(st.status || 'Active').trim().toLowerCase();
    if (status === 'inactive' || status === 'deactivated' || status === 'deleted' || status === 'left') {
      return 'deactivated';
    }
    var meta = null;
    try { meta = JSON.parse(st.notes || '{}'); } catch (e) { meta = null; }
    if (meta && meta.on_leave === true) return 'on-leave';
    return 'ok';
  }

  function normalizeBulkLeaveFamily(fam, todayStr) {
    if (!fam || !fam.id) return null;
    var students = (Array.isArray(fam.students) ? fam.students : [])
      .filter(function (s) { return s && s.id; })
      .map(function (s) {
        return {
          id: String(s.id),
          name: s.name || String(s.id),
          status: s.status || 'Active',
          family_id: s.family_id || fam.id,
          notes: (typeof s.notes === 'string') ? s.notes : '',
          state: studentLeaveState(s, todayStr)
        };
      });
    return {
      id: String(fam.id),
      parentName: fam.parent_name || fam.parentName || String(fam.id),
      status: String(fam.status || 'Active'),
      students: students
    };
  }

  function isFamilyPickable(fam) {
    return String(fam.status || 'Active').trim().toLowerCase() === 'active';
  }

  // Active families with at least one student. Families with no students
  // cannot go on leave and are left out of the picker.
  function bulkLeaveFamilies(families, todayStr) {
    var t = todayStr || todayIso();
    return (Array.isArray(families) ? families : [])
      .map(function (f) { return normalizeBulkLeaveFamily(f, t); })
      .filter(function (f) { return f !== null && isFamilyPickable(f) && f.students.length > 0; });
  }

  // Month picker options starting at the current month (default 6).
  function bulkLeaveMonthOptions(todayStr, count) {
    var t = String(todayStr || todayIso());
    var y = parseInt(t.substring(0, 4), 10);
    var m = parseInt(t.substring(5, 7), 10) - 1;
    if (isNaN(y) || isNaN(m) || m < 0 || m > 11) {
      var now = new Date();
      y = now.getFullYear();
      m = now.getMonth();
    }
    var n = parseInt(count, 10);
    if (isNaN(n) || n < 1) n = 6;
    if (n > 12) n = 12;
    var out = [];
    for (var i = 0; i < n; i++) {
      var idx = m + i;
      var yy = y + Math.floor(idx / 12);
      var mm = idx % 12;
      out.push({ year: yy, monthIdx: mm, month: MONTHS[mm], label: MONTHS[mm] + ' ' + yy });
    }
    return out;
  }

  // Selected months -> one leave window: 1st of the earliest month to
  // the last day of the latest month. Returns null for an empty/invalid
  // selection.
  function leaveWindowForMonths(months) {
    var list = (Array.isArray(months) ? months : [])
      .filter(function (m) {
        return m && !isNaN(parseInt(m.year, 10)) &&
          parseInt(m.monthIdx, 10) >= 0 && parseInt(m.monthIdx, 10) <= 11;
      })
      .map(function (m) { return { year: parseInt(m.year, 10), monthIdx: parseInt(m.monthIdx, 10) }; })
      .sort(function (a, b) { return monthScore(a.year, a.monthIdx) - monthScore(b.year, b.monthIdx); });
    if (list.length === 0) return null;
    var first = list[0];
    var last = list[list.length - 1];
    return {
      startDate: isoDate(first.year, first.monthIdx, 1),
      returnDate: isoDate(last.year, last.monthIdx, lastDayOfMonth(last.year, last.monthIdx)),
      startMonth: { year: first.year, monthIdx: first.monthIdx, month: MONTHS[first.monthIdx] },
      endMonth: { year: last.year, monthIdx: last.monthIdx, month: MONTHS[last.monthIdx] }
    };
  }

  function bulkLeaveSummary(families, months) {
    var fams = Array.isArray(families) ? families : [];
    var mons = Array.isArray(months) ? months : [];
    var students = 0;
    fams.forEach(function (f) {
      (f.students || []).forEach(function (s) { if (s.state === 'ok') students++; });
    });
    return {
      families: fams.length,
      months: mons.length,
      students: students,
      familyMonths: fams.length * mons.length
    };
  }

  // Validates the whole bulk-leave selection BEFORE any write.
  // input: { families (normalised), months ([{year, monthIdx}]), reason }.
  function validateBulkLeave(input, todayStr) {
    var t = todayStr || todayIso();
    var inp = input || {};
    var fams = Array.isArray(inp.families) ? inp.families : [];
    var months = Array.isArray(inp.months) ? inp.months : [];
    var reason = String(inp.reason || '').trim();
    var errors = [];
    if (fams.length === 0) errors.push('Select at least one family.');
    if (months.length === 0) errors.push('Select at least one leave month.');
    if (!reason) errors.push('Add a reason for the leave.');
    if (reason.length > 160) errors.push('Reason must be 160 characters or less.');
    var win = leaveWindowForMonths(months);
    if (months.length > 0 && !win) errors.push('Choose valid leave months.');
    if (win && win.returnDate < t) {
      errors.push('All selected months have already ended. Choose a current or future month.');
    }
    var summary = bulkLeaveSummary(fams, months);
    if (errors.length === 0 && summary.students === 0) {
      errors.push('Every selected student is already on leave or deactivated — there is nothing to apply.');
    }
    return { ok: errors.length === 0, errors: errors, window: win, summary: summary };
  }

  // Runs the leave loop. deps: applyLeave(studentId, {startDate,
  // returnDate, reason}) -> Promise<{ok, error?, failures?}>,
  // onFamily(index, total, famResult). Deactivated / already-on-leave
  // students are skipped and reported, never failed. A failed student
  // never stops the run.
  async function runBulkLeave(families, win, reason, deps) {
    var list = Array.isArray(families) ? families : [];
    if (!win || !win.startDate || !win.returnDate) {
      throw new Error('Bulk Leave needs a leave window.');
    }
    if (!deps || typeof deps.applyLeave !== 'function') {
      throw new Error('Bulk Leave needs a leave function.');
    }
    var results = [];
    var familiesDone = 0;
    var familiesFailed = 0;
    var studentsOnLeave = 0;
    var studentsSkipped = 0;
    var studentsFailed = 0;
    for (var i = 0; i < list.length; i++) {
      var fam = list[i];
      var applied = [];
      var failed = [];
      var skipped = [];
      var warnings = [];
      var students = fam.students || [];
      students.forEach(function (s) {
        if (s.state === 'deactivated') skipped.push({ name: s.name, reason: 'Deactivated student — skipped' });
        else if (s.state === 'on-leave') skipped.push({ name: s.name, reason: 'Already on leave — skipped' });
      });
      var todo = students.filter(function (s) { return s.state === 'ok'; });
      for (var j = 0; j < todo.length; j++) {
        var st = todo[j];
        try {
          var res = await deps.applyLeave(st.id, { startDate: win.startDate, returnDate: win.returnDate, reason: reason });
          if (res && res.ok) {
            applied.push(st.name);
            studentsOnLeave++;
            if (res.failures && res.failures.length > 0) {
              warnings.push(st.name + ': ' + res.failures.join('; '));
            }
          } else {
            var errText = (res && (res.error || (res.failures && res.failures.join('; ')))) || 'Leave could not be saved.';
            failed.push({ name: st.name, error: errText });
            studentsFailed++;
          }
        } catch (e) {
          failed.push({ name: st.name, error: (e && e.message) || 'Leave could not be saved.' });
          studentsFailed++;
        }
      }
      studentsSkipped += skipped.length;
      var famResult = {
        familyId: fam.id,
        parentName: fam.parentName,
        applied: applied,
        failed: failed,
        skipped: skipped,
        warnings: warnings,
        ok: failed.length === 0
      };
      if (famResult.ok) familiesDone++; else familiesFailed++;
      results.push(famResult);
      if (typeof deps.onFamily === 'function') {
        try { deps.onFamily(i, list.length, famResult); } catch (e) { /* progress must never break the run */ }
      }
    }
    return {
      familiesDone: familiesDone,
      familiesFailed: familiesFailed,
      studentsOnLeave: studentsOnLeave,
      studentsSkipped: studentsSkipped,
      studentsFailed: studentsFailed,
      results: results
    };
  }

  // --------------------------------------------------------------------------
  // BULK LEAVE — modal HTML (strings only; the Leave-tab glue in
  // leaves.js opens the modal and wires the buttons)
  // --------------------------------------------------------------------------

  var LEAVE_REASON_PRESETS = [
    'UK/Europe Summer Holidays',
    'Family Vacation / Traveling Abroad',
    'Umrah / Hajj Pilgrimage',
    'School Exams / Academic Preparation',
    'Medical / Health Issue',
    'Personal / Family Emergency',
    'Custom'
  ];

  function bulkLeaveModalHtml(families, months) {
    var fams = Array.isArray(families) ? families : [];
    var mons = Array.isArray(months) ? months : [];
    var familyRows = fams.map(function (f) {
      var okCount = 0;
      var onLeaveCount = 0;
      var deactCount = 0;
      (f.students || []).forEach(function (s) {
        if (s.state === 'ok') okCount++;
        else if (s.state === 'on-leave') onLeaveCount++;
        else deactCount++;
      });
      var sub = f.students.length + ' student' + (f.students.length === 1 ? '' : 's');
      if (okCount !== f.students.length) {
        var bits = [];
        if (onLeaveCount > 0) bits.push(onLeaveCount + ' already on leave');
        if (deactCount > 0) bits.push(deactCount + ' deactivated');
        sub += ' • ' + bits.join(' • ');
      }
      return '<label data-bulk-leave-family="' + esc(f.id) + '" data-bulk-leave-search="' + esc(f.parentName + ' ' + f.id) + '" class="flex items-start gap-2.5 px-3 py-2.5 hover:bg-slate-50 cursor-pointer">' +
        '<input type="checkbox" class="bulk-leave-family-check mt-0.5 w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500" value="' + esc(f.id) + '" onchange="syncBulkLeaveModalUi()">' +
        '<span class="flex-1 min-w-0">' +
        '<span class="block font-bold text-slate-900 truncate">' + esc(f.parentName) + ' <span class="font-mono text-slate-500 font-bold">' + esc(f.id) + '</span></span>' +
        '<span class="block text-[11px] text-slate-500">' + esc(sub) + '</span>' +
        '</span></label>';
    }).join('');
    var monthChecks = mons.map(function (m, i) {
      return '<label class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white cursor-pointer text-[11px] font-bold text-slate-700">' +
        '<input type="checkbox" class="bulk-leave-month-check w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500" value="' + m.year + '-' + m.monthIdx + '"' + (i === 0 ? ' checked' : '') + ' onchange="syncBulkLeaveModalUi()">' +
        esc(m.label) + '</label>';
    }).join('');
    var reasonOptions = LEAVE_REASON_PRESETS.map(function (r) {
      var label = (r === 'Custom') ? 'Other (Type custom reason below)' : r;
      return '<option value="' + esc(r) + '">' + esc(label) + '</option>';
    }).join('');
    return '<div id="bulkLeavePickArea" class="space-y-3.5">' +
      '<div>' +
      '<label class="block font-bold text-slate-700 mb-1">Select Families (Active only) *:</label>' +
      '<input type="text" placeholder="Search by parent name or Family ID..." oninput="filterBulkLeaveFamilies(this.value)" class="w-full p-2.5 border rounded-xl text-xs font-bold text-slate-800 mb-2">' +
      '<div class="max-h-56 overflow-y-auto touch-scroll border border-slate-200 rounded-xl divide-y divide-slate-100">' +
      (familyRows || '<p class="p-3 text-slate-500">No active families found.</p>') +
      '</div></div>' +
      '<div><label class="block font-bold text-slate-700 mb-1">Leave Months *:</label>' +
      '<div class="flex flex-wrap gap-2">' + (monthChecks || '<span class="text-slate-500">No months available.</span>') + '</div></div>' +
      '<div><label class="block font-bold text-slate-700 mb-1">Reason for Leave *:</label>' +
      '<select id="bulkLeaveReasonSelect" onchange="bulkLeaveReasonChange(this.value)" class="w-full p-2 border rounded-xl font-bold text-slate-700 mb-2">' + reasonOptions + '</select>' +
      '<input type="text" id="bulkLeaveCustomReason" placeholder="Enter custom reason..." maxlength="160" class="w-full p-2 border rounded-xl text-xs hidden">' +
      '</div>' +
      '<p id="bulkLeaveSummaryLine" class="text-[11px] font-bold text-indigo-900 bg-indigo-50 border border-indigo-200 rounded-xl px-2.5 py-2">Select at least one family and one month.</p>' +
      '</div>' +
      '<div id="bulkLeaveConfirmArea" style="display:none;" class="space-y-3"></div>' +
      '<div id="bulkLeaveProgressArea" style="display:none;" class="space-y-2"></div>' +
      '<div class="flex justify-end gap-2 pt-1">' +
      '<button id="btnBulkLeaveBack" style="display:none;" onclick="backToBulkLeavePick()" class="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition">Back</button>' +
      '<button id="btnBulkLeaveReview" onclick="reviewBulkLeave()" class="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black shadow-sm transition">Review &amp; Apply</button>' +
      '<button id="btnBulkLeaveApply" style="display:none;" onclick="startBulkLeaveFromModal()" class="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black shadow-sm transition"><i class="fa-solid fa-check"></i> Apply Bulk Leave</button>' +
      '</div>';
  }

  function bulkLeaveConfirmHtml(summary, win, reason) {
    var s = summary || { families: 0, months: 0, students: 0 };
    var w = win || {};
    return '<div class="p-3 bg-indigo-50 border border-indigo-200 rounded-xl text-indigo-950 space-y-1.5 text-[11px] leading-relaxed">' +
      '<p class="font-extrabold text-xs">Please confirm — ' + s.families + ' famil' + (s.families === 1 ? 'y' : 'ies') + ' × ' + s.months + ' month' + (s.months === 1 ? '' : 's') + '</p>' +
      '<p><strong>' + s.students + ' student' + (s.students === 1 ? '' : 's') + '</strong> will go on leave from <strong>' + esc(w.startDate || '') + '</strong> to <strong>' + esc(w.returnDate || '') + '</strong>.</p>' +
      '<p>Reason: <strong>' + esc(reason || '') + '</strong></p>' +
      '<p>Those months are excluded from billing, each student\u2019s timetable is ended, and the teacher is unassigned — exactly like marking leave one student at a time. Return them from the Leave tab when they come back.</p>' +
      '</div>';
  }

  function bulkLeaveFamilyResultHtml(famResult) {
    var f = famResult || {};
    var lines = [];
    (f.applied || []).forEach(function (n) { lines.push('On leave: ' + n); });
    (f.skipped || []).forEach(function (s) { lines.push(esc(s.name) + ' — ' + esc(s.reason)); });
    (f.warnings || []).forEach(function (w) { lines.push('<span class="text-amber-700 font-bold">Warning: ' + esc(w) + '</span>'); });
    (f.failed || []).forEach(function (x) { lines.push('<span class="text-rose-700 font-bold">' + esc(x.name) + ' — ' + esc(x.error) + '</span>'); });
    var icon = f.ok
      ? '<i class="fa-solid fa-circle-check text-emerald-600 mt-0.5"></i>'
      : '<i class="fa-solid fa-circle-xmark text-rose-600 mt-0.5"></i>';
    return '<div class="flex items-start gap-2 text-[11px] py-1 border-b border-slate-100">' + icon +
      '<span class="flex-1"><strong>' + esc(f.parentName || f.familyId) + '</strong> <span class="font-mono text-slate-500">' + esc(f.familyId) + '</span>' +
      (lines.length > 0 ? '<span class="block text-slate-600">' + lines.join('<br>') + '</span>' : '') +
      '</span></div>';
  }

  function bulkLeaveSummaryHtml(summary) {
    var s = summary || {};
    return '<div class="mt-2 p-3 bg-indigo-50 border border-indigo-200 rounded-xl text-[11px] leading-relaxed text-indigo-950 space-y-0.5">' +
      '<p class="font-extrabold text-xs">Bulk Leave finished — ' + (s.familiesDone || 0) + ' families done, ' + (s.familiesFailed || 0) + ' with errors.</p>' +
      '<p>Students on leave: <strong>' + (s.studentsOnLeave || 0) + '</strong> • Skipped: <strong>' + (s.studentsSkipped || 0) + '</strong> • Failed: <strong>' + (s.studentsFailed || 0) + '</strong></p>' +
      ((s.studentsFailed || 0) > 0 ? '<p class="text-rose-800 font-bold">Failed students are not on leave — mark them one by one from the Leave tab.</p>' : '') +
      '<p class="text-slate-600">The Leave roster has been refreshed.</p>' +
      '<div class="pt-1"><button onclick="closeModal(\'modalBulkLeave\')" class="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black transition">Done</button></div>' +
      '</div>';
  }

  // --------------------------------------------------------------------------
  // Exports
  // --------------------------------------------------------------------------
  if (typeof window !== 'undefined') {
    window.FeePhase2 = {
      MONTHS: MONTHS,
      esc: esc,
      monthIdxOf: monthIdxOf,
      monthScore: monthScore,
      lastDayOfMonth: lastDayOfMonth,
      normalizePendingRow: normalizePendingRow,
      bulkCollectRows: bulkCollectRows,
      bulkCollectSelection: bulkCollectSelection,
      findBulkCollectDuplicates: findBulkCollectDuplicates,
      buildBulkPaymentRecord: buildBulkPaymentRecord,
      runBulkCollect: runBulkCollect,
      bulkCollectConcurrency: BULK_COLLECT_CONCURRENCY,
      bulkCollectRowResultHtml: bulkCollectRowResultHtml,
      bulkCollectSummaryHtml: bulkCollectSummaryHtml,
      studentLeaveState: studentLeaveState,
      normalizeBulkLeaveFamily: normalizeBulkLeaveFamily,
      bulkLeaveFamilies: bulkLeaveFamilies,
      bulkLeaveMonthOptions: bulkLeaveMonthOptions,
      leaveWindowForMonths: leaveWindowForMonths,
      bulkLeaveSummary: bulkLeaveSummary,
      validateBulkLeave: validateBulkLeave,
      runBulkLeave: runBulkLeave,
      bulkLeaveModalHtml: bulkLeaveModalHtml,
      bulkLeaveConfirmHtml: bulkLeaveConfirmHtml,
      bulkLeaveFamilyResultHtml: bulkLeaveFamilyResultHtml,
      bulkLeaveSummaryHtml: bulkLeaveSummaryHtml
    };
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = (typeof window !== 'undefined') ? window.FeePhase2 : {};
  }
})();

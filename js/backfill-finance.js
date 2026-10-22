// ============================================================================
// Batch 6C — Backfill planner (FRONTEND, pure functions, no side effects)
//
// Plans the one-off copy of legacy fee / salary data into the Batch 6B
// finance tables (payments, salary_slips, salary_adjustments). This module
// ONLY plans: it never touches the database, the DOM, or localStorage. The
// backfill tool page loads the legacy sources, passes them in, shows the
// reconciliation report, and — only when the report reconciles — writes the
// planned rows itself.
//
// Every row is built through the Batch 6B builders in js/fee-tables.js
// (window.FeeTables), so dual-write and backfill share ONE field mapping and
// can never drift apart. Each planned row's legacy_json is stamped with
// `_backfill: { run, origin }` so a backfilled row is always traceable to the
// run and the copy it came from.
//
// Guarantees:
//  - Never throws on malformed input — problems are collected as warnings,
//    quarantine entries, or reconciliation diffs.
//  - Deterministic: same input produces the same rows in the same order and
//    the same report (stable iteration, no clocks, no randomness — the only
//    generated values come from the FeeTables builders themselves).
// ============================================================================
(function () {
  'use strict';

  var FT = (typeof window !== 'undefined' && window.FeeTables) ? window.FeeTables : null;

  var MONEY_TOLERANCE = 0.005;

  // --------------------------------------------------------------------------
  // Small defensive helpers
  // --------------------------------------------------------------------------
  function isObj(v) { return v != null && typeof v === 'object'; }

  function parseJsonMaybe(value) {
    if (isObj(value)) return { ok: true, value: value };
    if (typeof value === 'string') {
      var s = value.trim();
      if (!s) return { ok: true, value: null };
      try { return { ok: true, value: JSON.parse(s) }; } catch (e) { return { ok: false, value: null }; }
    }
    return { ok: true, value: value == null ? null : value };
  }

  function num(v) {
    var n = Number(v);
    return isFinite(n) ? n : 0;
  }

  // The money a source fee record represents, using the same precedence as
  // the FeeTables builder (amountPaid, then the manual-invoice `amount`).
  function recordAmount(rec) {
    if (!isObj(rec)) return 0;
    var a = rec.amountPaid != null ? rec.amountPaid : (rec.amount != null ? rec.amount : 0);
    return num(a);
  }

  function fmtNum(n) {
    var v = Math.round(num(n) * 100) / 100;
    return String(v);
  }

  function currencyKey(c) {
    return (c == null || String(c) === '') ? 'UNKNOWN' : String(c);
  }

  function familyKey(fid) {
    return fid == null ? '(unknown)' : String(fid);
  }

  function hasText(v) {
    return v != null && String(v).trim() !== '';
  }

  function hasReceiptNo(rec) {
    return isObj(rec) && hasText(rec.receiptNo);
  }

  function usableDate(rec) {
    if (!isObj(rec) || !hasText(rec.date)) return false;
    return !isNaN(Date.parse(String(rec.date)));
  }

  function addSum(map, fid, currency, amount) {
    if (!map[fid]) map[fid] = { count: 0, sums: {} };
    map[fid].count += 1;
    var cur = currencyKey(currency);
    map[fid].sums[cur] = (map[fid].sums[cur] || 0) + amount;
  }

  function stampBackfill(row, runId, origin, extra) {
    try {
      var parsed = JSON.parse(row.legacy_json || '{}');
      if (!isObj(parsed) || Array.isArray(parsed)) parsed = { _value: parsed };
      var stamp = { run: runId != null ? runId : null, origin: origin };
      if (extra) {
        for (var k in extra) {
          if (Object.prototype.hasOwnProperty.call(extra, k)) stamp[k] = extra[k];
        }
      }
      parsed._backfill = stamp;
      row.legacy_json = JSON.stringify(parsed);
    } catch (e) { /* leave legacy_json untouched if it cannot be re-stamped */ }
    return row;
  }

  function compareFamilyMaps(sourceMap, planMap, diffs) {
    var fids = {};
    Object.keys(sourceMap).forEach(function (f) { fids[f] = true; });
    Object.keys(planMap).forEach(function (f) { fids[f] = true; });
    Object.keys(fids).forEach(function (fid) {
      var s = sourceMap[fid] || { count: 0, sums: {} };
      var p = planMap[fid] || { count: 0, sums: {} };
      if (s.count !== p.count) {
        diffs.push('Family ' + fid + ': source count ' + s.count + ' vs plan count ' + p.count);
      }
      var curs = {};
      Object.keys(s.sums).forEach(function (c) { curs[c] = true; });
      Object.keys(p.sums).forEach(function (c) { curs[c] = true; });
      Object.keys(curs).forEach(function (cur) {
        var sv = s.sums[cur] || 0;
        var pv = p.sums[cur] || 0;
        if (Math.abs(sv - pv) > MONEY_TOLERANCE) {
          diffs.push('Family ' + fid + ' ' + cur + ': source ' + fmtNum(sv) + ' vs plan ' + fmtNum(pv));
        }
      });
    });
  }

  // --------------------------------------------------------------------------
  // planPayments — fee_history (D1) + the browser's flat local records
  // --------------------------------------------------------------------------
  function feeRecordKey(rec) {
    // Batch 3A identity: receipt number + family, from the record's own fields.
    return String(rec.receiptNo) + '|' + String(rec.familyId).toUpperCase();
  }

  function feeFingerprint(rec) {
    return [
      rec.month,
      rec.year,
      rec.amountPaid != null ? rec.amountPaid : rec.amount,
      rec.totalPayable,
      rec.date
    ].join('|');
  }

  function planPayments(input) {
    input = isObj(input) ? input : {};
    var families = Array.isArray(input.families) ? input.families : [];
    var localRecords = Array.isArray(input.localRecords) ? input.localRecords : [];
    var runId = input.runId;

    var report = {
      sourceCounts: { d1: 0, local: localRecords.length, localOnly: 0, conflictCopies: 0 },
      perFamily: {},
      planPerFamily: {},
      perPeriod: {},
      duplicates: [],
      quarantine: [],
      warnings: [],
      noReceiptNo: 0,
      noPeriod: 0,
      reconciled: false,
      diffs: []
    };
    var rows = [];

    if (!FT || typeof FT.paymentRowFromLegacy !== 'function') {
      report.warnings.push('FeeTables builders are not available; load js/fee-tables.js before js/backfill-finance.js.');
      report.diffs.push('Planner unavailable: no rows were planned.');
      return { rows: rows, report: report };
    }

    var knownFamilyIds = {};
    families.forEach(function (fam) {
      if (isObj(fam) && fam.id != null) knownFamilyIds[String(fam.id).toUpperCase()] = true;
    });

    // -- Collect D1 records (container family is authoritative) -------------
    var d1Entries = []; // { rec, familyId, index }
    families.forEach(function (fam) {
      if (!isObj(fam)) return;
      var containerId = fam.id != null ? String(fam.id) : null;
      var parsed = parseJsonMaybe(fam.notes);
      if (!parsed.ok) {
        report.warnings.push('Family ' + familyKey(containerId) + ': notes could not be parsed; its fee history was skipped.');
        return;
      }
      var notes = parsed.value;
      if (!isObj(notes)) return;
      if (notes.fee_history == null) return;
      if (!Array.isArray(notes.fee_history)) {
        report.warnings.push('Family ' + familyKey(containerId) + ': fee_history is not an array; it was skipped.');
        return;
      }
      notes.fee_history.forEach(function (rec, idx) {
        if (!isObj(rec)) {
          report.warnings.push('Family ' + familyKey(containerId) + ': fee_history entry ' + idx + ' is not an object; it was skipped.');
          return;
        }
        report.sourceCounts.d1 += 1;
        d1Entries.push({ rec: rec, familyId: containerId, index: idx });
      });
    });

    // Index D1 records by Batch 3A identity for the local merge. Only records
    // carrying a receipt number can be matched — numberless records never
    // merge, so a local copy can never silently swallow one.
    var d1ByKey = {};
    d1Entries.forEach(function (entry) {
      if (!hasReceiptNo(entry.rec)) return;
      var key = feeRecordKey(entry.rec);
      if (!d1ByKey[key]) d1ByKey[key] = [];
      d1ByKey[key].push(entry);
    });

    // -- Merge local records --------------------------------------------------
    var survivors = d1Entries.map(function (entry) {
      return { rec: entry.rec, origin: 'd1', familyId: entry.familyId, index: entry.index };
    });
    localRecords.forEach(function (rec, localIdx) {
      if (!isObj(rec)) {
        report.warnings.push('Local fee record ' + localIdx + ' is not an object; it was skipped.');
        return;
      }
      var statedFamily = rec.familyId != null ? String(rec.familyId) : null;
      var matched = false;
      var conflict = false;
      if (hasReceiptNo(rec)) {
        var candidates = d1ByKey[feeRecordKey(rec)] || [];
        if (candidates.length) {
          var fp = feeFingerprint(rec);
          matched = candidates.some(function (entry) { return feeFingerprint(entry.rec) === fp; });
          conflict = !matched;
        }
      }
      if (matched) return; // the D1 copy wins; the local duplicate is absorbed
      if (conflict) report.sourceCounts.conflictCopies += 1;
      else report.sourceCounts.localOnly += 1;
      survivors.push({ rec: rec, origin: 'local', familyId: statedFamily, index: localIdx });
      if (statedFamily == null || !knownFamilyIds[statedFamily.toUpperCase()]) {
        report.warnings.push('local record for unknown family ' + familyKey(statedFamily) +
          ' (receipt ' + (hasReceiptNo(rec) ? String(rec.receiptNo) : 'none') + ')');
      }
    });

    // -- Plan each surviving record -------------------------------------------
    survivors.forEach(function (surv) {
      var rec = surv.rec;
      var fid = surv.familyId;

      if (!hasReceiptNo(rec) && !usableDate(rec) && !hasText(rec.month)) {
        report.quarantine.push({
          familyId: fid,
          index: surv.origin === 'local' ? 'local' : surv.index,
          reason: 'missing receipt number and date/month'
        });
        return;
      }

      // Source side of the reconciliation (quarantined records excluded).
      addSum(report.perFamily, familyKey(fid), rec.currency, recordAmount(rec));

      var source = rec.isManualInvoice ? 'manual_invoice'
        : (surv.origin === 'local' ? 'backfill_local' : 'fee_history');
      var row;
      try {
        row = FT.paymentRowFromLegacy(rec, source);
      } catch (e) {
        report.warnings.push('Family ' + familyKey(fid) + ': a fee record could not be converted (' +
          (e && e.message ? e.message : 'unknown error') + '); it was not planned.');
        report.diffs.push('Family ' + familyKey(fid) + ': a source record was not planned.');
        return;
      }

      // The authoritative family always wins over the record's own field.
      row.family_id = fid;
      // A record that was already cancelled in the legacy store carries its
      // cancel details in fields the row builder does not map (it builds for
      // the save path); copy them onto the row so the migrated record keeps
      // its reason/by/at in the columns, not only inside legacy_json.
      if (rec.cancel_reason != null) row.cancel_reason = rec.cancel_reason;
      if (rec.cancelled_by != null) row.cancelled_by = rec.cancelled_by;
      if (rec.cancelled_at != null) row.cancelled_at = rec.cancelled_at;
      if (rec.familyId != null && fid != null &&
          String(rec.familyId).toUpperCase() !== String(fid).toUpperCase()) {
        report.warnings.push('Family id mismatch: record ' + (hasReceiptNo(rec) ? String(rec.receiptNo) : '(no receipt number)') +
          ' says ' + String(rec.familyId) + ' but is stored under ' + String(fid) + '; the stored family was used.');
      }

      if (!hasReceiptNo(rec)) {
        row.receipt_no = null;
        report.noReceiptNo += 1;
        report.warnings.push('Receipt number missing for a record in family ' + familyKey(fid) +
          ' (' + (hasText(rec.date) ? String(rec.date) : (hasText(rec.month) ? String(rec.month) : 'no date/month')) +
          '); it was planned without a receipt number.');
      }

      stampBackfill(row, runId, surv.origin);
      rows.push(row);

      addSum(report.planPerFamily, familyKey(row.family_id), row.currency, num(row.amount_paid));
      if (row.billing_period) {
        if (!report.perPeriod[row.billing_period]) report.perPeriod[row.billing_period] = {};
        var pCur = currencyKey(row.currency);
        report.perPeriod[row.billing_period][pCur] =
          (report.perPeriod[row.billing_period][pCur] || 0) + num(row.amount_paid);
      } else {
        report.noPeriod += 1;
      }
    });

    // -- Duplicate receipt numbers across ALL planned rows ---------------------
    var groups = []; // [{ receiptNo, members: [rowIndex...] }] in plan order
    rows.forEach(function (row, rowIdx) {
      if (row.receipt_no == null) return;
      var g = null;
      for (var i = 0; i < groups.length; i++) {
        if (groups[i].receiptNo === row.receipt_no) { g = groups[i]; break; }
      }
      if (!g) { g = { receiptNo: row.receipt_no, members: [] }; groups.push(g); }
      g.members.push(rowIdx);
    });
    groups.forEach(function (g) {
      if (g.members.length < 2) return;
      var ordered = g.members.slice().sort(function (a, b) {
        var da = rows[a].payment_date != null ? String(rows[a].payment_date) : '';
        var db = rows[b].payment_date != null ? String(rows[b].payment_date) : '';
        if (da < db) return -1;
        if (da > db) return 1;
        return a - b;
      });
      var keptIdx = ordered[0];
      var entry = { receiptNo: g.receiptNo, keptFamilyId: rows[keptIdx].family_id, suffixed: [] };
      for (var n = 1; n < ordered.length; n++) {
        var row = rows[ordered[n]];
        var newNo = g.receiptNo + '-DUP' + (n + 1);
        row.receipt_no = newNo;
        stampBackfill(row, runId, (function () {
          try { return JSON.parse(row.legacy_json)._backfill.origin; } catch (e) { return 'd1'; }
        })(), { duplicate_of: g.receiptNo });
        entry.suffixed.push({ familyId: row.family_id, receiptNo: newNo });
      }
      report.duplicates.push(entry);
    });

    compareFamilyMaps(report.perFamily, report.planPerFamily, report.diffs);
    report.reconciled = report.diffs.length === 0;
    return { rows: rows, report: report };
  }

  // --------------------------------------------------------------------------
  // planSalaries — three legacy copies merged, newest saved_at wins
  // --------------------------------------------------------------------------
  var ORIGIN_PRIORITY = { local: 1, carrier: 2, address: 3 };

  function savedAtTime(slip) {
    if (!isObj(slip) || slip.saved_at == null) return -Infinity;
    var t = Date.parse(String(slip.saved_at));
    return isNaN(t) ? -Infinity : t;
  }

  function keyLabelPart(slipKey) {
    var idx = slipKey.indexOf('_');
    if (idx === -1) return '';
    return slipKey.slice(idx + 1).replace(/_/g, ' ');
  }

  function keyPrefix(slipKey) {
    var idx = slipKey.indexOf('_');
    return idx === -1 ? slipKey : slipKey.slice(0, idx);
  }

  function periodFromKey(slipKey) {
    var label = keyLabelPart(slipKey);
    if (!label) return null;
    return FT && typeof FT.periodFromLabel === 'function' ? FT.periodFromLabel(label) : null;
  }

  function slipPeriod(slip, slipKey) {
    if (FT && typeof FT.periodFromLabel === 'function') {
      var p = FT.periodFromLabel(isObj(slip) ? slip.month : null);
      if (p) return p;
    }
    var pk = periodFromKey(slipKey);
    if (pk) return pk;
    if (isObj(slip) && slip.period != null && String(slip.period) !== '') {
      var pp = FT && typeof FT.periodFromLabel === 'function' ? FT.periodFromLabel(slip.period) : null;
      return pp || String(slip.period);
    }
    return null;
  }

  function buildDeletedSets(meta) {
    var periods = {};
    var raw = {};
    var list = isObj(meta) && Array.isArray(meta.deleted_salary_months) ? meta.deleted_salary_months : [];
    list.forEach(function (entry) {
      if (entry == null) return;
      var s = String(entry);
      raw[s] = true;
      raw[s.trim()] = true;
      if (FT && typeof FT.periodFromLabel === 'function') {
        var p1 = FT.periodFromLabel(s);
        if (p1) periods[p1] = true;
        var p2 = FT.periodFromLabel(s.replace(/_/g, ' '));
        if (p2) periods[p2] = true;
      }
    });
    return { periods: periods, raw: raw };
  }

  function isDeleted(deleted, slip, slipKey, period) {
    if (!deleted) return false;
    if (period && deleted.periods[period]) return true;
    if (isObj(slip) && slip.month != null) {
      if (deleted.raw[String(slip.month)] || deleted.raw[String(slip.month).trim()]) return true;
    }
    if (deleted.raw[slipKey]) return true;
    return false;
  }

  function determineTeacherId(slip, slipKey, hintTeacherId, knownTeacherIds) {
    if (isObj(slip) && slip.teacher_id != null && String(slip.teacher_id) !== '') {
      return String(slip.teacher_id);
    }
    var prefix = keyPrefix(slipKey);
    if (prefix) {
      if (knownTeacherIds[prefix]) return prefix;
      if (prefix.indexOf('TCH-') === 0 || prefix.indexOf('MGR-') === 0) return prefix;
    }
    if (hintTeacherId != null && String(hintTeacherId) !== '') return String(hintTeacherId);
    return null;
  }

  function planSalaries(input) {
    input = isObj(input) ? input : {};
    var teachers = Array.isArray(input.teachers) ? input.teachers : [];
    var localSalaries = isObj(input.localSalaries) ? input.localSalaries : {};
    var carrierSalaries = isObj(input.carrierSalaries) ? input.carrierSalaries : {};
    var runId = input.runId;

    var report = {
      sourceCounts: { local: 0, address: 0, carrier: 0, merged: 0 },
      perTeacher: {},
      planPerTeacher: {},
      suppressed: [],
      unparseable: [],
      adjustments: 0,
      warnings: [],
      reconciled: false,
      diffs: []
    };
    var slipRows = [];
    var adjustmentRows = [];

    if (!FT || typeof FT.slipRowFromLegacy !== 'function' || typeof FT.adjustmentRowFromLegacy !== 'function') {
      report.warnings.push('FeeTables builders are not available; load js/fee-tables.js before js/backfill-finance.js.');
      report.diffs.push('Planner unavailable: no rows were planned.');
      return { slipRows: slipRows, adjustmentRows: adjustmentRows, report: report };
    }

    // -- Per-teacher meta (slips live there too, plus deductions/deletions) ---
    var knownTeacherIds = {};
    var metaByTeacher = {}; // tid -> { meta, deleted }
    teachers.forEach(function (t) {
      if (!isObj(t) || t.id == null) return;
      var tid = String(t.id);
      knownTeacherIds[tid] = true;
      var parsed = parseJsonMaybe(t.address);
      var meta = null;
      if (!parsed.ok) {
        report.warnings.push('Teacher ' + tid + ': address could not be parsed; its stored salary data was skipped.');
      } else if (isObj(parsed.value)) {
        meta = parsed.value;
      }
      metaByTeacher[tid] = { meta: meta, deleted: buildDeletedSets(meta) };
    });

    // -- Gather candidates from the three copies -------------------------------
    var candidates = {}; // slipKey -> [{ slip, origin, hint }]
    var keyOrder = [];
    function addCandidate(slipKey, slip, origin, hint) {
      if (!candidates[slipKey]) { candidates[slipKey] = []; keyOrder.push(slipKey); }
      candidates[slipKey].push({ slip: slip, origin: origin, hint: hint != null ? hint : null });
    }
    Object.keys(localSalaries).forEach(function (k) {
      report.sourceCounts.local += 1;
      if (isObj(localSalaries[k])) addCandidate(k, localSalaries[k], 'local', null);
      else report.warnings.push('Local salary entry ' + k + ' is not an object; it was skipped.');
    });
    Object.keys(carrierSalaries).forEach(function (k) {
      report.sourceCounts.carrier += 1;
      if (isObj(carrierSalaries[k])) addCandidate(k, carrierSalaries[k], 'carrier', null);
      else report.warnings.push('Carrier salary entry ' + k + ' is not an object; it was skipped.');
    });
    teachers.forEach(function (t) {
      if (!isObj(t) || t.id == null) return;
      var tid = String(t.id);
      var meta = metaByTeacher[tid] ? metaByTeacher[tid].meta : null;
      if (!isObj(meta) || !isObj(meta.salary_slips)) return;
      Object.keys(meta.salary_slips).forEach(function (k) {
        report.sourceCounts.address += 1;
        if (isObj(meta.salary_slips[k])) addCandidate(k, meta.salary_slips[k], 'address', tid);
        else report.warnings.push('Stored salary entry ' + k + ' for teacher ' + tid + ' is not an object; it was skipped.');
      });
    });
    report.sourceCounts.merged = keyOrder.length;

    function addTeacherSum(map, tid, net) {
      if (!map[tid]) map[tid] = { slips: 0, sumNet: 0 };
      map[tid].slips += 1;
      map[tid].sumNet += net;
    }

    // -- Resolve, suppress, plan -----------------------------------------------
    keyOrder.forEach(function (slipKey) {
      var list = candidates[slipKey];
      var winner = null;
      list.forEach(function (cand) {
        if (!winner) { winner = cand; return; }
        var tNew = savedAtTime(cand.slip);
        var tWin = savedAtTime(winner.slip);
        if (tNew > tWin ||
            (tNew === tWin && ORIGIN_PRIORITY[cand.origin] > ORIGIN_PRIORITY[winner.origin])) {
          winner = cand;
        }
      });
      var slip = winner.slip;

      var teacherId = determineTeacherId(slip, slipKey, winner.hint, knownTeacherIds);
      if (teacherId == null) {
        report.unparseable.push({ slipKey: slipKey, reason: 'unknown teacher' });
        return;
      }
      var period = slipPeriod(slip, slipKey);
      if (period == null) {
        report.unparseable.push({ slipKey: slipKey, reason: 'unknown period' });
        return;
      }
      var teacherInfo = metaByTeacher[teacherId];
      if (teacherInfo && isDeleted(teacherInfo.deleted, slip, slipKey, period)) {
        report.suppressed.push({ teacherId: teacherId, month: slip.month != null ? slip.month : slipKey });
        return;
      }

      addTeacherSum(report.perTeacher, teacherId, num(slip.net_payable != null ? slip.net_payable : 0));

      var row;
      try {
        row = FT.slipRowFromLegacy(teacherId, slip);
      } catch (e) {
        report.warnings.push('Teacher ' + teacherId + ': a salary slip (' + slipKey + ') could not be converted (' +
          (e && e.message ? e.message : 'unknown error') + '); it was not planned.');
        report.diffs.push('Teacher ' + teacherId + ': a source slip was not planned.');
        return;
      }
      stampBackfill(row, runId, winner.origin);
      slipRows.push(row);
      addTeacherSum(report.planPerTeacher, teacherId, num(row.net_payable));
    });

    // -- Deduction records become adjustments (regardless of deleted months) ---
    teachers.forEach(function (t) {
      if (!isObj(t) || t.id == null) return;
      var tid = String(t.id);
      var meta = metaByTeacher[tid] ? metaByTeacher[tid].meta : null;
      if (!isObj(meta) || !Array.isArray(meta.deduction_records)) return;
      meta.deduction_records.forEach(function (rec, idx) {
        if (!isObj(rec)) {
          report.warnings.push('Teacher ' + tid + ': deduction record ' + idx + ' is not an object; it was skipped.');
          return;
        }
        try {
          var row = FT.adjustmentRowFromLegacy(tid, rec);
          stampBackfill(row, runId, 'address');
          adjustmentRows.push(row);
        } catch (e) {
          report.warnings.push('Teacher ' + tid + ': a deduction record could not be converted (' +
            (e && e.message ? e.message : 'unknown error') + '); it was not planned.');
        }
      });
    });
    report.adjustments = adjustmentRows.length;

    // -- Reconciliation ---------------------------------------------------------
    var tids = {};
    Object.keys(report.perTeacher).forEach(function (t) { tids[t] = true; });
    Object.keys(report.planPerTeacher).forEach(function (t) { tids[t] = true; });
    Object.keys(tids).forEach(function (tid) {
      var s = report.perTeacher[tid] || { slips: 0, sumNet: 0 };
      var p = report.planPerTeacher[tid] || { slips: 0, sumNet: 0 };
      if (s.slips !== p.slips) {
        report.diffs.push('Teacher ' + tid + ': source slips ' + s.slips + ' vs plan slips ' + p.slips);
      }
      if (Math.abs(s.sumNet - p.sumNet) > MONEY_TOLERANCE) {
        report.diffs.push('Teacher ' + tid + ' net: source ' + fmtNum(s.sumNet) + ' vs plan ' + fmtNum(p.sumNet));
      }
    });
    report.reconciled = report.diffs.length === 0;
    return { slipRows: slipRows, adjustmentRows: adjustmentRows, report: report };
  }

  window.BackfillFinance = {
    planPayments: planPayments,
    planSalaries: planSalaries
  };
})();


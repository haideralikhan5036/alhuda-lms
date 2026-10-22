// ============================================================================
// Batch 6B — Fee Tables dual-write (FRONTEND, flag-gated, shipped dark)
//
// When the owner-controlled system_settings flag `fee_tables_v1` is ON, the
// legacy fee / payroll write paths ALSO write a copy of each record into the
// new finance tables (payments, salary_slips, salary_adjustments). Reads are
// NOT switched: every screen keeps using the legacy stores exactly as before.
//
// Guarantees:
//  - Flag OFF (or unreadable): zero database calls, zero behaviour change.
//  - Hooks run AFTER the legacy write has succeeded and never throw, never
//    change legacy arguments, return values, or UI flow.
//  - A failed table write surfaces ONE truthful warning per page load; the
//    legacy record remains the source of truth until Batch 6D.
//  - Contact snapshots (whatsapp / email / parentName / country) are never
//    copied into table columns; they survive only inside legacy_json.
// ============================================================================
(function () {
  'use strict';

  var FEE_TABLES_FLAG_KEY = 'fee_tables_v1';
  var SLIP_RANDOM_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  var TABLE_WRITE_WARNING = 'The record was saved, but its copy in the new finance tables could not be written. Please inform the administrator.';

  var _enabledPromise = null;
  var _warned = false;

  // --------------------------------------------------------------------------
  // Client / session helpers (same mechanisms the portals already use)
  // --------------------------------------------------------------------------
  function getDb() {
    try {
      if (typeof db !== 'undefined' && db && typeof db.from === 'function') return db;
    } catch (e) { /* db global not initialised yet */ }
    try {
      if (window.db && typeof window.db.from === 'function') return window.db;
    } catch (e) { /* ignore */ }
    return null;
  }

  // Best-effort signed-in actor: owner username, else manager emp_id /
  // username / id from the per-tab manager session, else null.
  function currentActor() {
    try {
      if (typeof window.getAuthenticatedOwnerSession === 'function') {
        var owner = window.getAuthenticatedOwnerSession();
        if (owner) return owner.username || owner.id || 'owner';
      }
    } catch (e) { /* ignore */ }
    try {
      if (typeof window.getAuthenticatedManagerSession === 'function') {
        var mgr = window.getAuthenticatedManagerSession();
        if (mgr) return mgr.emp_id || mgr.username || mgr.id || 'manager';
      }
    } catch (e) { /* ignore */ }
    try {
      var raw = sessionStorage.getItem('alhuda_manager_session');
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed) return parsed.emp_id || parsed.username || parsed.id || null;
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  function currentActorRole() {
    try {
      if (typeof CURRENT_ROLE !== 'undefined' && CURRENT_ROLE) return String(CURRENT_ROLE);
    } catch (e) { /* ignore */ }
    try {
      var role = localStorage.getItem('alhuda_active_portal_role');
      if (role) return role;
    } catch (e) { /* ignore */ }
    return null;
  }

  function warnOnce(message) {
    if (_warned) return;
    _warned = true;
    var text = message || TABLE_WRITE_WARNING;
    try {
      if (typeof window.lmsNotify === 'function') {
        window.lmsNotify(text, { type: 'warning' });
        return;
      }
    } catch (e) { /* ignore */ }
    try {
      if (typeof window.showToastNotification === 'function') {
        window.showToastNotification(text);
        return;
      }
    } catch (e) { /* ignore */ }
    try { console.warn('[FeeTables] ' + text); } catch (e) { /* ignore */ }
  }

  // --------------------------------------------------------------------------
  // Feature flag — system_settings row `fee_tables_v1`, cached per page load.
  // Read exactly like the course-catalog index (js/curriculum.js): a plain
  // select on system_settings by key. ANY error or missing row means OFF.
  // NOTE: the Worker only lets manager sessions read catalog settings keys,
  // so a manager session sees this flag only if the Worker also allows the
  // fee_tables_v1 key (Batch 6B Worker part). Owner sessions always can.
  //
  // Batch 6D-1: the fetch + value normalisation now lives in
  // _fetchSettingValue so the read-mode flags below share the exact same
  // loader. isEnabled's behaviour is unchanged: it resolves true only for
  // the normalised values 'on' / 'true' / '1'.
  // --------------------------------------------------------------------------
  // Fetches one system_settings value and returns it normalised (trimmed,
  // JSON-unquoted when stored as a quoted string, lowercased). A stored
  // boolean true normalises to 'true'. Returns null on ANY problem: no db
  // client, query error, or missing row. Never throws, never rejects.
  function _fetchSettingValue(key) {
    return (async function () {
      try {
        var client = getDb();
        if (!client) return null;
        var res = await client.from('system_settings').select('value').eq('key', key).limit(1);
        if (!res || res.error) return null;
        var rows = res.data || [];
        if (!rows.length) return null;
        var raw = rows[0] ? rows[0].value : null;
        if (raw === true) return 'true';
        var v = String(raw == null ? '' : raw).trim();
        if (v.length >= 2 && v.charAt(0) === '"') {
          try { v = String(JSON.parse(v)).trim(); } catch (e) { /* keep raw */ }
        }
        return v.toLowerCase();
      } catch (e) {
        return null;
      }
    })();
  }

  function isEnabled() {
    if (_enabledPromise) return _enabledPromise;
    _enabledPromise = _fetchSettingValue(FEE_TABLES_FLAG_KEY).then(function (v) {
      return v === 'on' || v === 'true' || v === '1';
    }, function () { return false; });
    return _enabledPromise;
  }

  // --------------------------------------------------------------------------
  // Batch 6D-1 — read-mode flags. Each surface that will read from the new
  // tables gets its own system_settings key holding 'off' (default — legacy
  // reads), 'compare' (legacy renders, tables are read only to diff), or
  // 'on' (tables are the read source). Cached per key per page load; ANY
  // problem (absent key, junk value, query error) resolves to 'off'.
  // --------------------------------------------------------------------------
  var READ_FLAG_PARENT = 'fee_read_parent';
  var READ_FLAG_360 = 'fee_read_360';
  var READ_FLAG_SALARY = 'salary_read_v1';
  var _readModePromises = {};

  function getReadMode(flagKey) {
    var key = String(flagKey || '');
    if (!key) return Promise.resolve('off');
    if (_readModePromises[key]) return _readModePromises[key];
    _readModePromises[key] = (async function () {
      try {
        var v = await _fetchSettingValue(key);
        if (v === 'on') return 'on';
        if (v === 'compare') return 'compare';
        return 'off';
      } catch (e) {
        return 'off';
      }
    })();
    return _readModePromises[key];
  }

  // --------------------------------------------------------------------------
  // Period normalisation — 'YYYY-MM'
  // --------------------------------------------------------------------------
  var MONTH_NAMES = {
    january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3,
    april: 4, apr: 4, may: 5, june: 6, jun: 6, july: 7, jul: 7,
    august: 8, aug: 8, september: 9, sept: 9, sep: 9,
    october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12
  };

  function _period(year, month) {
    var y = parseInt(year, 10);
    var m = parseInt(month, 10);
    if (!isFinite(y) || y < 1900 || y > 2200) return null;
    if (!isFinite(m) || m < 1 || m > 12) return null;
    return y + '-' + String(m).padStart(2, '0');
  }

  function _monthNumber(month) {
    if (month == null) return null;
    if (typeof month === 'number') return isFinite(month) ? month : null;
    var s = String(month).trim().toLowerCase();
    if (/^\d{1,2}$/.test(s)) return parseInt(s, 10);
    if (MONTH_NAMES[s] != null) return MONTH_NAMES[s];
    var word = s.replace(/[^a-z]/g, '');
    if (MONTH_NAMES[word] != null) return MONTH_NAMES[word];
    return null;
  }

  function periodFromMonthYear(month, year) {
    if (month == null) return null;
    // Tolerate a combined 'YYYY-MM' / 'YYYY/MM' month argument.
    if (typeof month === 'string') {
      var combined = month.trim().match(/^(\d{4})[-/](\d{1,2})$/);
      if (combined) return _period(combined[1], combined[2]);
    }
    var m = _monthNumber(month);
    if (m == null) return null;
    if (year == null || year === '') return null;
    return _period(year, m);
  }

  function periodFromLabel(label) {
    if (label == null) return null;
    var s = String(label).trim();
    if (!s) return null;
    var iso = s.match(/^(\d{4})[-/](\d{1,2})(?:[-/](\d{1,2}))?$/);
    if (iso) return _period(iso[1], iso[2]);
    var monthFirst = s.match(/([A-Za-z]+)\s+(\d{4})/);
    if (monthFirst) {
      var p1 = periodFromMonthYear(monthFirst[1], monthFirst[2]);
      if (p1) return p1;
    }
    var yearFirst = s.match(/(\d{4})\s+([A-Za-z]+)/);
    if (yearFirst) {
      var p2 = periodFromMonthYear(yearFirst[2], yearFirst[1]);
      if (p2) return p2;
    }
    return null;
  }

  // Full English month names by number (index 0 = January) — used by the
  // Batch 6D-1 reverse translators to rebuild legacy month text.
  var MONTH_LABELS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  // 'YYYY-MM' → { year, monthNumber, monthName } or null.
  function _periodParts(period) {
    if (period == null) return null;
    var m = String(period).trim().match(/^(\d{4})-(\d{1,2})/);
    if (!m) return null;
    var mo = parseInt(m[2], 10);
    if (mo < 1 || mo > 12) return null;
    return { year: parseInt(m[1], 10), monthNumber: mo, monthName: MONTH_LABELS[mo - 1] };
  }

  // 'YYYY-MM' → 'Month YYYY' (e.g. '2026-09' → 'September 2026') or null.
  function _labelFromPeriod(period) {
    var parts = _periodParts(period);
    return parts ? (parts.monthName + ' ' + parts.year) : null;
  }

  // --------------------------------------------------------------------------
  // Status normalisation (status_label always keeps the verbatim legacy text)
  // --------------------------------------------------------------------------
  function normaliseFeeStatus(rec) {
    rec = rec || {};
    var statusText = String(rec.status || '');
    if (/cancel/i.test(statusText) || rec.cancel_reason || rec.cancelled_at) return 'Cancelled';
    if (rec.isAdvancePayment || statusText.trim() === 'Paid in Advance') return 'Advance';
    var remaining = parseFloat(rec.remainingBalance);
    if (/partial/i.test(statusText) || statusText.trim().toUpperCase() === 'UNPAID' || (isFinite(remaining) && remaining > 0)) return 'Partial';
    return 'Paid';
  }

  // --------------------------------------------------------------------------
  // Row builders — the complete original record is preserved in legacy_json.
  // Contact snapshots are deliberately NOT mapped to columns.
  // --------------------------------------------------------------------------
  function paymentRowFromLegacy(rec, source) {
    rec = rec || {};
    return {
      family_id: rec.familyId != null ? String(rec.familyId) : null,
      receipt_no: rec.receiptNo != null ? String(rec.receiptNo) : null,
      record_kind: rec.isManualInvoice ? 'manual_invoice' : 'payment',
      billing_period: periodFromMonthYear(rec.month, rec.year) || (rec.date ? String(rec.date).slice(0, 7) : null),
      month_label: rec.month != null ? String(rec.month) : null,
      payment_date: rec.date || null,
      amount_paid: rec.amountPaid != null ? rec.amountPaid : (rec.amount != null ? rec.amount : 0),
      discount: rec.discount != null ? rec.discount : 0,
      total_payable: rec.totalPayable != null ? rec.totalPayable : null,
      monthly_fee: rec.monthlyFee != null ? rec.monthlyFee : null,
      previous_balance: rec.previousBalance != null ? rec.previousBalance : 0,
      credit_deducted: rec.creditDeducted != null ? rec.creditDeducted : 0,
      remaining_balance: rec.remainingBalance != null ? rec.remainingBalance : null,
      excess_paid: rec.excessPaid != null ? rec.excessPaid : 0,
      currency: rec.currency || null,
      payment_method: rec.paymentMethod || null,
      transaction_id: rec.transactionId || null,
      status: normaliseFeeStatus(rec),
      status_label: rec.status || null,
      is_prorated: rec.isProrated ? 1 : 0,
      is_advance: rec.isAdvancePayment ? 1 : 0,
      advance_months_count: rec.advanceMonthsCount != null ? rec.advanceMonthsCount : 0,
      active_days: rec.activeDays != null ? rec.activeDays : 0,
      joining_date: rec.joiningDate || null,
      students_names: rec.studentsNames || null,
      notes: rec.notes != null ? rec.notes : (rec.remarks != null ? rec.remarks : null),
      created_by: currentActor(),
      legacy_json: JSON.stringify(rec),
      legacy_source: source || 'fee_form'
    };
  }

  function generateSlipNo(period) {
    var yyyymm = String(period || '').replace('-', '');
    var bytes = new Uint8Array(6);
    if (typeof crypto !== 'undefined' && crypto && typeof crypto.getRandomValues === 'function') {
      crypto.getRandomValues(bytes);
    } else {
      for (var i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    var suffix = '';
    for (var j = 0; j < 6; j++) suffix += SLIP_RANDOM_ALPHABET[bytes[j] % SLIP_RANDOM_ALPHABET.length];
    return 'AH-SAL-' + yyyymm + '-' + suffix;
  }

  function slipRowFromLegacy(teacherId, slip) {
    slip = slip || {};
    var period = periodFromLabel(slip.month) || slip.period || null;
    var cancelled = slip.status === 'Cancelled' || /cancel/i.test(String(slip.status || '')) || !!slip.cancelled_at;
    return {
      teacher_id: teacherId != null ? String(teacherId) : null,
      period: period,
      slip_no: slip.slip_no || generateSlipNo(period),
      month_label: slip.month != null ? String(slip.month) : null,
      base_subtotal: slip.base_subtotal != null ? slip.base_subtotal : null,
      bonus: slip.bonus != null ? slip.bonus : 0,
      deduction_total: slip.deduction != null ? slip.deduction : 0,
      advance_deducted: slip.advance_deducted != null ? slip.advance_deducted : 0,
      net_payable: slip.net_payable != null ? slip.net_payable : null,
      status: slip.status === 'Paid' ? 'Paid' : (cancelled ? 'Cancelled' : 'Pending'),
      paid_at: slip.paid_at || null,
      remarks: slip.remarks || null,
      student_items_snapshot: slip.student_items_snapshot ? JSON.stringify(slip.student_items_snapshot) : null,
      created_by: currentActor(),
      legacy_json: JSON.stringify(slip),
      legacy_key: slip.slip_key || (String(teacherId) + '_' + String(slip.month || '').replace(/\s+/g, '_'))
    };
  }

  function adjustmentRowFromLegacy(teacherId, adj) {
    adj = adj || {};
    var kindText = String(adj.type || adj.category || '').toLowerCase();
    return {
      teacher_id: teacherId != null ? String(teacherId) : null,
      period: periodFromLabel(adj.month) || periodFromMonthYear(adj.month, adj.year),
      kind: adj.kind || (kindText.indexOf('bonus') !== -1 ? 'bonus' : 'deduction'),
      category: adj.category || adj.type || null,
      amount: adj.amount != null ? adj.amount : 0,
      advance_remaining: adj.advance_remaining != null ? adj.advance_remaining : null,
      recovery_per_month: adj.recovery_per_month != null ? adj.recovery_per_month : null,
      reason: adj.reason || null,
      adjustment_date: adj.date || null,
      status: 'Applied',
      created_by: currentActor(),
      // The legacy record id stays inside legacy_json only; it is the match
      // key used later to find this row again for cancellation.
      legacy_json: JSON.stringify(adj)
    };
  }

  // --------------------------------------------------------------------------
  // Batch 6D-1 — REVERSE translators: rebuild a legacy-shaped record from a
  // finance-table row. The row's legacy_json holds the complete original
  // record, so it is the base; the row's own columns are authoritative and
  // overlay it wherever they carry a value (they reflect later changes —
  // cancels, edits — that the snapshot in legacy_json may predate). When
  // legacy_json is absent (e.g. nulled for manager sessions), the record is
  // built from columns alone and snapshot-only fields (whatsapp / email /
  // parentName / country) simply come out absent.
  // --------------------------------------------------------------------------
  function _parseLegacyJson(row) {
    if (!row || row.legacy_json == null) return {};
    try {
      var parsed = typeof row.legacy_json === 'string' ? JSON.parse(row.legacy_json) : row.legacy_json;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function paymentLegacyFromRow(row) {
    row = row || {};
    var base = _parseLegacyJson(row);
    var rec = Object.assign({}, base);

    // Scalar overlays — the row's columns win whenever they carry a value.
    if (row.receipt_no != null) rec.receiptNo = row.receipt_no;
    if (row.family_id != null) rec.familyId = row.family_id;
    if (row.amount_paid != null) rec.amountPaid = Number(row.amount_paid);
    if (row.total_payable != null) rec.totalPayable = Number(row.total_payable);
    if (row.discount != null) rec.discount = Number(row.discount);
    if (row.remaining_balance != null) rec.remainingBalance = Number(row.remaining_balance);
    if (row.currency != null) rec.currency = row.currency;
    if (row.payment_method != null) rec.paymentMethod = row.payment_method;
    if (row.transaction_id != null) rec.transactionId = row.transaction_id;
    if (!rec.date && row.payment_date != null) rec.date = row.payment_date;
    if (rec.notes == null && row.notes != null) rec.notes = row.notes;

    // Month / year — keep the original text when present; else derive from
    // the row's month_label, filling any gap from billing_period.
    if (rec.month == null || rec.month === '' || rec.year == null || rec.year === '') {
      var derivedMonth = null;
      var derivedYear = null;
      if (row.month_label != null) {
        var mn = _monthNumber(row.month_label);
        if (mn != null) derivedMonth = MONTH_LABELS[mn - 1];
        var ym = String(row.month_label).match(/\d{4}/);
        if (ym) derivedYear = parseInt(ym[0], 10);
      }
      var pp = _periodParts(row.billing_period);
      if (pp) {
        if (derivedMonth == null) derivedMonth = pp.monthName;
        if (derivedYear == null) derivedYear = pp.year;
      }
      if ((rec.month == null || rec.month === '') && derivedMonth != null) rec.month = derivedMonth;
      if ((rec.year == null || rec.year === '') && derivedYear != null) rec.year = derivedYear;
    }

    // Record kind — keep the table's classification on the record and restore
    // the legacy boolean flags the forward builder derived it from.
    if (row.record_kind != null) rec.recordKind = row.record_kind;
    if (row.record_kind === 'manual_invoice') rec.isManualInvoice = true;
    // Advances are marked by the is_advance column (the forward builder
    // never emits an 'advance_installment' record_kind).
    if (row.is_advance === 1 || row.is_advance === true || row.is_advance === '1') rec.isAdvancePayment = true;

    // Status — the careful part. A cancelled row always wins (its cancel
    // columns are the latest truth). Otherwise, if the money has not moved
    // since the snapshot, the snapshot's own status text is the most
    // faithful legacy value and is kept verbatim. Only when neither applies
    // do we translate the row's normalised status back to legacy text.
    if (row.status === 'Cancelled' || row.cancel_reason != null) {
      rec.status = 'Cancelled';
      rec.cancel_reason = row.cancel_reason != null ? row.cancel_reason : base.cancel_reason;
      rec.cancelled_by = row.cancelled_by != null ? row.cancelled_by : base.cancelled_by;
      rec.cancelled_at = row.cancelled_at != null ? row.cancelled_at : base.cancelled_at;
    } else if (typeof base.status === 'string' && base.status !== '' &&
        Number(base.amountPaid) === Number(row.amount_paid)) {
      rec.status = base.status;
    } else if (row.status === 'Paid') {
      rec.status = 'Paid in Full';
    } else if (row.status === 'Partial') {
      rec.status = 'Partial (Balance Remaining)';
    } else if (row.status === 'Advance') {
      rec.status = 'Paid in Advance';
    }
    return rec;
  }

  function slipLegacyFromRow(row) {
    row = row || {};
    var base = _parseLegacyJson(row);
    var rec = Object.assign({}, base);

    if (row.teacher_id != null) rec.teacher_id = row.teacher_id;
    if (row.slip_no != null) { rec.slip_no = row.slip_no; rec.slipNo = row.slip_no; }
    if (row.status != null) rec.status = row.status;
    if (row.paid_at != null) rec.paid_at = row.paid_at;
    if (row.base_subtotal != null) rec.base_subtotal = Number(row.base_subtotal);
    if (row.bonus != null) rec.bonus = Number(row.bonus);
    // The forward builder stored legacy `deduction` in `deduction_total`.
    if (row.deduction_total != null) rec.deduction = Number(row.deduction_total);
    if (row.net_payable != null) rec.net_payable = Number(row.net_payable);

    // Month — original label when present (month_label column holds it
    // verbatim), else the English label derived from the period.
    if (rec.month == null || rec.month === '') {
      if (row.month_label != null && row.month_label !== '') {
        rec.month = row.month_label;
      } else {
        var label = _labelFromPeriod(row.period);
        if (label) rec.month = label;
      }
    }

    // Slip key — the consumers' map key. Prefer the snapshot's own key,
    // then the row's stored legacy_key (the forward builder put the key
    // there), else rebuild it exactly as the forward builder does.
    if (rec.slip_key == null || rec.slip_key === '') {
      if (row.legacy_key != null && row.legacy_key !== '') {
        rec.slip_key = row.legacy_key;
      } else if (rec.teacher_id != null && rec.month) {
        rec.slip_key = String(rec.teacher_id) + '_' + String(rec.month).replace(/\s+/g, '_');
      }
    }
    return rec;
  }

  function adjustmentLegacyFromRow(row) {
    row = row || {};
    var base = _parseLegacyJson(row);
    var rec = Object.assign({}, base);
    // NOTE: base.id is deliberately kept — it is the original deduction
    // record id that consumers match on. The table row's own id is NOT a
    // legacy field and is never copied onto the record.

    if (row.teacher_id != null) rec.teacher_id = row.teacher_id;
    if (row.amount != null) rec.amount = Number(row.amount);
    // The forward builder mapped legacy `type` into the row's `kind`.
    if (row.kind != null) rec.type = row.kind;
    if (row.status === 'Cancelled') {
      rec.status = 'Cancelled';
      if (row.cancel_reason != null) rec.cancel_reason = row.cancel_reason;
    }
    if (rec.month == null || rec.month === '') {
      var label = _labelFromPeriod(row.period);
      if (label) rec.month = label;
    }
    return rec;
  }

  // --------------------------------------------------------------------------
  // Table helpers (throw on error — the public dual-write wrappers catch)
  // --------------------------------------------------------------------------
  function _requireDb() {
    var client = getDb();
    if (!client) throw new Error('Database client is not available.');
    return client;
  }

  function _errText(error, fallback) {
    if (error && error.message) return String(error.message);
    return fallback;
  }

  async function upsertPaymentRow(rec, source) {
    var client = _requireDb();
    var row = paymentRowFromLegacy(rec, source);
    if (!row.receipt_no) throw new Error('Fee record has no receipt number.');
    var sel = await client.from('payments').select('id').eq('receipt_no', row.receipt_no).limit(1);
    if (sel && sel.error) throw new Error(_errText(sel.error, 'payments lookup failed'));
    var existing = (sel && sel.data) || [];
    if (existing.length && existing[0].id) {
      var upd = await client.from('payments').update(row).eq('id', existing[0].id);
      if (upd && upd.error) throw new Error(_errText(upd.error, 'payments update failed'));
      return existing[0].id;
    }
    var ins = await client.from('payments').insert([row]);
    if (ins && ins.error) throw new Error(_errText(ins.error, 'payments insert failed'));
    var inserted = (ins && ins.data) || [];
    if (inserted.length && inserted[0].id) return inserted[0].id;
    var reSel = await client.from('payments').select('id').eq('receipt_no', row.receipt_no).limit(1);
    var reRows = (reSel && reSel.data) || [];
    return reRows.length ? reRows[0].id : null;
  }

  async function cancelPaymentRow(receiptNo, by, reason) {
    var client = _requireDb();
    if (!receiptNo) return false;
    var sel = await client.from('payments').select('id').eq('receipt_no', String(receiptNo)).limit(1);
    if (sel && sel.error) throw new Error(_errText(sel.error, 'payments lookup failed'));
    var rows = (sel && sel.data) || [];
    if (!rows.length) return false; // predates the flag — 6C backfill carries it
    var upd = await client.from('payments').update({
      status: 'Cancelled',
      cancelled_at: new Date().toISOString(),
      cancelled_by: by || currentActor(),
      cancel_reason: reason || null
    }).eq('id', rows[0].id);
    if (upd && upd.error) throw new Error(_errText(upd.error, 'payments cancel failed'));
    return true;
  }

  async function upsertSlipRow(teacherId, slip) {
    var client = _requireDb();
    var built = slipRowFromLegacy(teacherId, slip);
    if (!built.teacher_id) throw new Error('Salary slip has no teacher id.');
    if (!built.period) throw new Error('Could not determine the salary period.');
    var sel = await client.from('salary_slips').select('id, slip_no')
      .eq('teacher_id', built.teacher_id).eq('period', built.period).limit(1);
    if (sel && sel.error) throw new Error(_errText(sel.error, 'salary_slips lookup failed'));
    var existing = (sel && sel.data) || [];
    if (existing.length && existing[0].id) {
      // A slip keeps the number it was first minted with.
      var patch = Object.assign({}, built, { slip_no: existing[0].slip_no || built.slip_no });
      var upd = await client.from('salary_slips').update(patch).eq('id', existing[0].id);
      if (upd && upd.error) throw new Error(_errText(upd.error, 'salary_slips update failed'));
      return { row: Object.assign({}, existing[0], patch), slipNo: patch.slip_no };
    }
    var ins = await client.from('salary_slips').insert([built]);
    if (ins && ins.error) throw new Error(_errText(ins.error, 'salary_slips insert failed'));
    var inserted = (ins && ins.data) || [];
    return { row: inserted.length ? inserted[0] : built, slipNo: built.slip_no };
  }

  async function cancelSlipRow(teacherId, period) {
    var client = _requireDb();
    if (!teacherId || !period) return false;
    var sel = await client.from('salary_slips').select('id')
      .eq('teacher_id', String(teacherId)).eq('period', period).limit(1);
    if (sel && sel.error) throw new Error(_errText(sel.error, 'salary_slips lookup failed'));
    var rows = (sel && sel.data) || [];
    if (!rows.length) return false;
    var upd = await client.from('salary_slips').update({
      status: 'Cancelled',
      cancelled_at: new Date().toISOString(),
      cancelled_by: currentActor() || 'owner',
      cancel_reason: 'deleted by owner'
    }).eq('id', rows[0].id);
    if (upd && upd.error) throw new Error(_errText(upd.error, 'salary_slips cancel failed'));
    return true;
  }

  async function _findAdjustmentRow(client, teacherId, period, legacyId) {
    var sel = await client.from('salary_adjustments').select('id, legacy_json')
      .eq('teacher_id', String(teacherId)).eq('period', period);
    if (sel && sel.error) throw new Error(_errText(sel.error, 'salary_adjustments lookup failed'));
    var rows = (sel && sel.data) || [];
    if (!legacyId) return null;
    for (var i = 0; i < rows.length; i++) {
      try {
        var parsed = JSON.parse(rows[i].legacy_json || '{}');
        if (parsed && parsed.id != null && String(parsed.id) === String(legacyId)) return rows[i];
      } catch (e) { /* skip unparseable rows */ }
    }
    return null;
  }

  async function upsertAdjustmentRow(teacherId, adj) {
    var client = _requireDb();
    var built = adjustmentRowFromLegacy(teacherId, adj);
    if (!built.teacher_id) throw new Error('Salary adjustment has no teacher id.');
    if (!built.period) throw new Error('Could not determine the adjustment period.');
    var legacyId = adj && adj.id != null ? adj.id : null;
    var existing = await _findAdjustmentRow(client, built.teacher_id, built.period, legacyId);
    if (existing && existing.id) {
      var upd = await client.from('salary_adjustments').update(built).eq('id', existing.id);
      if (upd && upd.error) throw new Error(_errText(upd.error, 'salary_adjustments update failed'));
      return existing.id;
    }
    var ins = await client.from('salary_adjustments').insert([built]);
    if (ins && ins.error) throw new Error(_errText(ins.error, 'salary_adjustments insert failed'));
    var inserted = (ins && ins.data) || [];
    return inserted.length ? inserted[0].id : null;
  }

  async function cancelAdjustmentRow(teacherId, adj) {
    var client = _requireDb();
    if (!teacherId || !adj) return false;
    var period = periodFromLabel(adj.month) || periodFromMonthYear(adj.month, adj.year);
    if (!period) return false;
    var legacyId = adj.id != null ? adj.id : null;
    var existing = await _findAdjustmentRow(client, String(teacherId), period, legacyId);
    if (!existing) return false;
    var upd = await client.from('salary_adjustments').update({
      status: 'Cancelled',
      cancelled_at: new Date().toISOString(),
      cancelled_by: currentActorRole() || currentActor() || 'owner'
    }).eq('id', existing.id);
    if (upd && upd.error) throw new Error(_errText(upd.error, 'salary_adjustments cancel failed'));
    return true;
  }

  // --------------------------------------------------------------------------
  // Public dual-write API — flag check first, never throws to callers.
  // --------------------------------------------------------------------------
  async function dualWritePayment(rec, source) {
    try {
      if (!(await isEnabled())) return { skipped: true };
      if (!rec || !rec.receiptNo) return { ok: false, error: 'missing_receipt_no' };
      var id = await upsertPaymentRow(rec, source);
      return { ok: true, id: id };
    } catch (err) {
      warnOnce();
      return { ok: false, error: err };
    }
  }

  async function dualWritePaymentCancelled(rec, by, reason) {
    try {
      if (!(await isEnabled())) return { skipped: true };
      if (!rec || !rec.receiptNo) return { ok: false, error: 'missing_receipt_no' };
      var done = await cancelPaymentRow(rec.receiptNo, by, reason);
      return { ok: true, found: done };
    } catch (err) {
      warnOnce();
      return { ok: false, error: err };
    }
  }

  async function dualWriteSlip(teacherId, slip) {
    try {
      if (!(await isEnabled())) return { skipped: true };
      if (!teacherId || !slip) return { ok: false, error: 'missing_slip' };
      var result = await upsertSlipRow(teacherId, slip);
      return { ok: true, slipNo: result.slipNo, row: result.row };
    } catch (err) {
      warnOnce();
      return { ok: false, error: err };
    }
  }

  async function dualWriteSlipCancelled(teacherId, monthLabel) {
    try {
      if (!(await isEnabled())) return { skipped: true };
      var period = periodFromLabel(monthLabel);
      if (!period) return { ok: false, error: 'unknown_period' };
      var done = await cancelSlipRow(teacherId, period);
      return { ok: true, found: done };
    } catch (err) {
      warnOnce();
      return { ok: false, error: err };
    }
  }

  async function dualWriteAdjustment(teacherId, adj) {
    try {
      if (!(await isEnabled())) return { skipped: true };
      if (!teacherId || !adj) return { ok: false, error: 'missing_adjustment' };
      var id = await upsertAdjustmentRow(teacherId, adj);
      return { ok: true, id: id };
    } catch (err) {
      warnOnce();
      return { ok: false, error: err };
    }
  }

  async function dualWriteAdjustmentCancelled(teacherId, adj) {
    try {
      if (!(await isEnabled())) return { skipped: true };
      if (!teacherId || !adj) return { ok: false, error: 'missing_adjustment' };
      var done = await cancelAdjustmentRow(teacherId, adj);
      return { ok: true, found: done };
    } catch (err) {
      warnOnce();
      return { ok: false, error: err };
    }
  }

  window.FeeTables = {
    FEE_TABLES_FLAG_KEY: FEE_TABLES_FLAG_KEY,
    isEnabled: isEnabled,
    periodFromMonthYear: periodFromMonthYear,
    periodFromLabel: periodFromLabel,
    normaliseFeeStatus: normaliseFeeStatus,
    paymentRowFromLegacy: paymentRowFromLegacy,
    generateSlipNo: generateSlipNo,
    slipRowFromLegacy: slipRowFromLegacy,
    adjustmentRowFromLegacy: adjustmentRowFromLegacy,
    paymentLegacyFromRow: paymentLegacyFromRow,
    slipLegacyFromRow: slipLegacyFromRow,
    adjustmentLegacyFromRow: adjustmentLegacyFromRow,
    READ_FLAG_PARENT: READ_FLAG_PARENT,
    READ_FLAG_360: READ_FLAG_360,
    READ_FLAG_SALARY: READ_FLAG_SALARY,
    getReadMode: getReadMode,
    currentActor: currentActor,
    upsertPaymentRow: upsertPaymentRow,
    cancelPaymentRow: cancelPaymentRow,
    upsertSlipRow: upsertSlipRow,
    cancelSlipRow: cancelSlipRow,
    upsertAdjustmentRow: upsertAdjustmentRow,
    cancelAdjustmentRow: cancelAdjustmentRow,
    dualWritePayment: dualWritePayment,
    dualWritePaymentCancelled: dualWritePaymentCancelled,
    dualWriteSlip: dualWriteSlip,
    dualWriteSlipCancelled: dualWriteSlipCancelled,
    dualWriteAdjustment: dualWriteAdjustment,
    dualWriteAdjustmentCancelled: dualWriteAdjustmentCancelled,
    // Test support only: clears the per-page-load flag caches and warning latch.
    _resetForTests: function () { _enabledPromise = null; _readModePromises = {}; _warned = false; }
  };
})();

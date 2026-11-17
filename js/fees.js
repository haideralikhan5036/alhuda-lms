/**
 * ============================================================================
 * AL-HUDA ISLAMIC CENTRE LMS — MODULAR ARCHITECTURE
 * File: js/fees.js
 * Purpose: Native Fee Management, Cloud Billing Sync, Smart Arrears, Invoices, Defaulters & Annual Matrix
 * Extracted Line Range: 11088 – 13567 (2480 lines)
 * ============================================================================
 */

    // NATIVE AL-HUDA FEE MANAGEMENT & MASTER ANNUAL MATRIX ENGINE
    // 100% Native LMS Execution • Zero Google Sheets Dependence
    // ============================================================

    const FEE_CONFIG = {
      CURRENCIES: ["USD", "GBP", "CAD", "EUR", "AUD", "PKR", "AED", "NZD"],
      MONTHS: [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
      ],
      RECEIPT_PREFIX: "AH-REC-"
    };

    let CACHED_FEE_FAMILIES = [];
    // Phase 4 (audit P3-rr-e): null until the first successful load,
    // so an empty table can say "not loaded" instead of "all cleared".
    let CACHED_PENDING_FEE_LIST = null;
    // Fee Dashboard + Form Improvements (Phase 6) — shared UI state.
    let FEE_CURRENT_SUBTAB = 'fee-subtab-overview';
    let FEE_KPI_SELECTED = null;
    let FEE_KPI_COUNTS = { active: 0, paid: 0, pendings: 0, defaulters: 0, onLeave: 0 };
    let FEE_RECEIPTS_MONTH_FILTER = null; // { monthIdx, year } | null
    let FEE_MULTI_MONTH_SELECTED = []; // [{ monthIdx, year }] chronological
    let FEE_PENDING_REMIND_RUNNING = false;
    let FEE_DEFAULTER_REMIND_RUNNING = false;
    let CACHED_ANNUAL_FEE_MATRIX = [];
    let CURRENT_FEE_MODAL_RECEIPT = null;
    let CURRENT_MATRIX_ACTION_DATA = null;
    let CURRENT_LEDGER_FAMILY_ID = null;

    // ============================================================
    // REAL-TIME CLOUD FEE SYNC ENGINE (Supabase + Local Fallback)
    // Cross-device synchronization for Desktop PC & Mobile Phone
    // ============================================================
    let CLOUD_FEE_RECORDS_CACHE = null;
    let CLOUD_MATRIX_OVERRIDES_CACHE = null;
    let LAST_CLOUD_FEE_SYNC_TIME = null;
    // Batch 3.5 (audit P2-12): the current-month default below must be
    // applied exactly once per page load. loadFeeBillingLedger runs on
    // every fee-tab entry, so an unconditional set would snap a
    // deliberate earlier-month review back to the current month.
    let FEE_MONTH_DEFAULTS_APPLIED = false;

    // Batch 3.6 (audit P2-36): fee ledger pagination (default 25 rows
    // per page; 'All' restores the old unbounded render). Renders clamp
    // the page into range, so a narrowed list (new month, live search)
    // can never strand the view on an empty page.
    let FEE_PENDING_PAGE = 1;
    let FEE_PENDING_PAGE_SIZE = 25;
    let FEE_DEFAULTERS_PAGE = 1;
    let FEE_DEFAULTERS_PAGE_SIZE = 25;
    let FEE_MATRIX_PAGE = 1;
    let FEE_MATRIX_PAGE_SIZE = 25;
    // Fee Upgrade Phase 2 — Bulk Collect: selected pending families,
    // keyed by family id, and the rows of the last rendered pending
    // page (so Select All only touches what the user can see).
    // Amounts are month-specific, so the selection is cleared whenever
    // the pending list reloads (month change).
    let PENDING_BULK_SELECTED = {};
    let PENDING_BULK_LAST_RENDERED = [];
    function setFeePendingPage(p) { FEE_PENDING_PAGE = p; filterPendingDefaultersSearchLive(); }
    function setFeePendingPageSize(v) { FEE_PENDING_PAGE_SIZE = (v === 'all') ? Infinity : (parseInt(v, 10) || 25); FEE_PENDING_PAGE = 1; filterPendingDefaultersSearchLive(); }
    function setFeeDefaultersPage(p) { FEE_DEFAULTERS_PAGE = p; filterThreePlusDefaultersLive(); }
    function setFeeDefaultersPageSize(v) { FEE_DEFAULTERS_PAGE_SIZE = (v === 'all') ? Infinity : (parseInt(v, 10) || 25); FEE_DEFAULTERS_PAGE = 1; filterThreePlusDefaultersLive(); }
    function setFeeMatrixPage(p) { FEE_MATRIX_PAGE = p; filterAnnualFeeMatrixLive(); }
    function setFeeMatrixPageSize(v) { FEE_MATRIX_PAGE_SIZE = (v === 'all') ? Infinity : (parseInt(v, 10) || 25); FEE_MATRIX_PAGE = 1; filterAnnualFeeMatrixLive(); }
    window.setFeePendingPage = setFeePendingPage;
    window.setFeePendingPageSize = setFeePendingPageSize;
    window.setFeeDefaultersPage = setFeeDefaultersPage;
    window.setFeeDefaultersPageSize = setFeeDefaultersPageSize;
    window.setFeeMatrixPage = setFeeMatrixPage;
    window.setFeeMatrixPageSize = setFeeMatrixPageSize;

    function parseFamilyNotesData(notesRaw) {
      if (!notesRaw) return { fee_history: [], matrix_overrides: {} };
      if (typeof notesRaw === 'object') {
        return {
          ...notesRaw,
          fee_history: Array.isArray(notesRaw.fee_history) ? notesRaw.fee_history : [],
          matrix_overrides: (notesRaw.matrix_overrides && typeof notesRaw.matrix_overrides === 'object') ? notesRaw.matrix_overrides : {}
        };
      }
      if (typeof notesRaw === 'string') {
        try {
          const parsed = JSON.parse(notesRaw);
          if (parsed && typeof parsed === 'object') {
            return {
              ...parsed,
              fee_history: Array.isArray(parsed.fee_history) ? parsed.fee_history : [],
              matrix_overrides: (parsed.matrix_overrides && typeof parsed.matrix_overrides === 'object') ? parsed.matrix_overrides : {}
            };
          }
        } catch (e) {
          return {
            custom_notes: notesRaw,
            fee_history: [],
            matrix_overrides: {}
          };
        }
      }
      return { fee_history: [], matrix_overrides: {} };
    }

    function updateCloudSyncIndicator(status) {
      const icon = document.getElementById('feeCloudSyncIcon');
      const text = document.getElementById('feeCloudSyncText');
      const badge = document.getElementById('feeCloudSyncBadge');
      if (!badge) return;
      if (status === 'syncing') {
        if (icon) icon.className = "fa-solid fa-arrows-rotate fa-spin text-amber-600";
        if (text) text.innerText = "Syncing...";
      } else if (status === 'synced') {
        if (icon) icon.className = "fa-solid fa-cloud-check text-emerald-600";
        if (text) text.innerText = "Cloud Synced";
      } else if (status === 'offline') {
        if (icon) icon.className = "fa-solid fa-cloud text-slate-400";
        if (text) text.innerText = "Offline Cache";
      }
    }

    // ============================================================
    // Batch 3A (B9): COLLISION-PROOF RECEIPT NUMBERS + SAFE INGEST
    // Old format (stays valid forever, never renumbered):
    //   AH-REC-<year>-<sequence from array length>  e.g. AH-REC-2026-0007
    // New format:
    //   AH-REC-<YYYYMMDD>-<6 random chars>          e.g. AH-REC-20261021-K7QX3M
    // The full date keeps numbers readable and roughly sortable on the
    // printed receipt and in emails; the random suffix is drawn from a
    // 31-character unambiguous alphabet (no 0/O, 1/I/L — a parent can
    // read it over the phone), giving 31^6 ≈ 888 million combinations
    // per day. Two browsers minting in the same second, or a mint after
    // deletions, therefore cannot collide in practice — with no server
    // round-trip and no dependence on how many records exist.
    // ============================================================
    const RECEIPT_RANDOM_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

    function generateReceiptNo(when) {
      const d = (when instanceof Date) ? when : new Date();
      const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
      const bytes = new Uint8Array(6);
      if (typeof crypto !== 'undefined' && crypto && typeof crypto.getRandomValues === 'function') {
        crypto.getRandomValues(bytes);
      } else {
        for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
      }
      let suffix = '';
      for (let i = 0; i < 6; i++) suffix += RECEIPT_RANDOM_ALPHABET[bytes[i] % RECEIPT_RANDOM_ALPHABET.length];
      return `${FEE_CONFIG.RECEIPT_PREFIX}${ymd}-${suffix}`;
    }

    // Cloud ingest identity: a receipt number alone is NOT unique — the
    // same old-format number can legitimately exist for two families.
    function feeRecordKey(r) {
      return `${String((r && r.receiptNo) || '')}|${String((r && r.familyId) || '').toUpperCase()}`;
    }

    // Two records under one key are "the same record" (a fresher copy of
    // one receipt) only when their substance matches; otherwise they are
    // two different receipts that happen to share a number.
    function feeRecordFingerprint(r) {
      const x = r || {};
      return [x.month || '', x.year || '', (x.amountPaid ?? ''), (x.totalPayable ?? ''), x.date || ''].join('|');
    }

    // Insert into the ingest map WITHOUT ever silently overwriting a
    // different record. Returns 'added' | 'refreshed' | 'kept-both'.
    // Collisions are pushed onto `warnings` for the caller to surface.
    function ingestFeeRecord(map, record, warnings) {
      if (!record || !record.receiptNo) return 'skipped';
      const key = feeRecordKey(record);
      const existing = map.get(key);
      if (!existing) { map.set(key, record); return 'added'; }
      if (feeRecordFingerprint(existing) === feeRecordFingerprint(record)) {
        map.set(key, record);
        return 'refreshed';
      }
      let n = 2;
      while (map.has(`${key}#c${n}`)) n++;
      map.set(`${key}#c${n}`, record);
      if (Array.isArray(warnings)) {
        warnings.push(`Receipt ${record.receiptNo} (${record.familyId}) already exists with different details — both records were kept. Please check the Fee Ledger.`);
      }
      return 'kept-both';
    }

    // Batch 3A (B15): an existing fee record for the same family + month.
    // Cancelled records do not count — a cancelled month may be re-paid.
    function findFeeMonthDuplicate(records, familyId, month, year) {
      const fam = String(familyId || '').toUpperCase();
      const mon = String(month || '').trim().toLowerCase();
      const yr = parseInt(year, 10);
      return (records || []).find(r => r &&
        String(r.familyId || '').toUpperCase() === fam &&
        String(r.month || '').trim().toLowerCase() === mon &&
        parseInt(r.year, 10) === yr &&
        String(r.status || '').toLowerCase() !== 'cancelled') || null;
    }

    window.generateReceiptNo = generateReceiptNo;
    window.feeRecordKey = feeRecordKey;
    window.feeRecordFingerprint = feeRecordFingerprint;
    window.ingestFeeRecord = ingestFeeRecord;
    window.findFeeMonthDuplicate = findFeeMonthDuplicate;

    async function ingestFeeDataFromFamilies(families) {
      try {
        const cloudRecordsMap = new Map();
        const cloudOverrides = {};

        // 1. Read existing local storage records (for backwards-compatible auto-migration from PC)
        const localRecords = (() => {
          try { return JSON.parse(localStorage.getItem('alhuda_fee_records') || '[]'); } catch(e) { return []; }
        })();
        const localOverrides = (() => {
          try { return JSON.parse(localStorage.getItem('alhuda_fee_matrix_overrides') || '{}'); } catch(e) { return {}; }
        })();

        const familiesToMigrate = new Set();
        const ingestWarnings = [];

        (families || []).forEach(f => {
          if (!f || !f.id) return;
          const notesObj = parseFamilyNotesData(f.notes);

          // Ingest cloud fee receipts — keyed by receiptNo + familyId
          // (Batch 3A): the same number on two families, or two
          // different records sharing one number, can no longer
          // overwrite each other silently.
          if (Array.isArray(notesObj.fee_history)) {
            notesObj.fee_history.forEach(r => {
              if (r && r.receiptNo) {
                ingestFeeRecord(cloudRecordsMap, r, ingestWarnings);
              }
            });
          }

          // Ingest cloud matrix overrides
          if (notesObj.matrix_overrides && typeof notesObj.matrix_overrides === 'object') {
            Object.assign(cloudOverrides, notesObj.matrix_overrides);
          }

          // Check if local device has receipts for this family that aren't yet in the cloud!
          const fIdUpper = String(f.id).toUpperCase();
          const unmigratedLocal = localRecords.filter(r => String(r.familyId).toUpperCase() === fIdUpper && !cloudRecordsMap.has(feeRecordKey(r)));
          if (unmigratedLocal.length > 0) {
            unmigratedLocal.forEach(r => ingestFeeRecord(cloudRecordsMap, r, ingestWarnings));
            familiesToMigrate.add(f.id);
          }

          // Check if local device has matrix overrides not yet in cloud
          Object.keys(localOverrides).forEach(k => {
            if (k.toUpperCase().startsWith(fIdUpper + '_') || k.toUpperCase() === `ADM_${fIdUpper}`) {
              if (!(k in cloudOverrides)) {
                cloudOverrides[k] = localOverrides[k];
                familiesToMigrate.add(f.id);
              }
            }
          });
        });

        if (ingestWarnings.length > 0) {
          ingestWarnings.forEach(w => console.warn('[Cloud Fee Sync] ' + w));
          lmsNotify('Duplicate receipt numbers were found and kept safe. Please check the Fee Ledger.', { type: 'warning' });
        }

        // Sort all records descending by date / receipt
        const combinedRecords = Array.from(cloudRecordsMap.values()).sort((a, b) => {
          const da = new Date(a.date || a.created_at || 0).getTime();
          const db_ = new Date(b.date || b.created_at || 0).getTime();
          return db_ - da;
        });

        CLOUD_FEE_RECORDS_CACHE = combinedRecords;
        CLOUD_MATRIX_OVERRIDES_CACHE = cloudOverrides;
        LAST_CLOUD_FEE_SYNC_TIME = new Date();

        // Also mirror to localStorage for instant offline fallback
        try {
          localStorage.setItem('alhuda_fee_records', JSON.stringify(combinedRecords));
          localStorage.setItem('alhuda_fee_matrix_overrides', JSON.stringify(cloudOverrides));
        } catch(e) {}

        updateCloudSyncIndicator('synced');

        // Asynchronously migrate any un-synced families to Supabase
        if (familiesToMigrate.size > 0) {
          console.log(`[Cloud Fee Sync] Auto-migrating ${familiesToMigrate.size} families to Supabase...`);
          familiesToMigrate.forEach(async (famId) => {
            try {
              const famRecords = combinedRecords.filter(r => String(r.familyId).toUpperCase() === String(famId).toUpperCase());
              await syncPaymentRecordsBatchToCloud(famId, famRecords);
              await syncMatrixOverridesToCloud(famId, cloudOverrides);
            } catch (e) {
              console.warn("[Cloud Migration] Error uploading family:", famId, e);
            }
          });
        }
      } catch (err) {
        console.error("[Cloud Fee Sync] Ingestion error:", err);
      }
    }

    // Batch 3.5 (audit P2-16): this now REPORTS its outcome. The old
    // version returned undefined in every path and only console-logged
    // failures, so callers could not tell success from failure — and
    // the submit flow toasted success before the sync even finished.
    // Returns { ok: true } on a completed cloud write, { ok: false,
    // error } otherwise (fetch failure, update failure, exception).
    // The local retry flag `cloudSyncPending` is stripped from the
    // copy sent to the cloud, so cloud records stay clean.
    async function syncPaymentRecordsBatchToCloud(familyId, newRecords) {
      try {
        const fId = String(familyId).trim();
        if (!fId || !newRecords || newRecords.length === 0) return { ok: true };

        updateCloudSyncIndicator('syncing');

        // Fetch latest family notes from Supabase
        const { data: fam, error } = await db.from('families').select('id, notes').eq('id', fId).maybeSingle();
        if (error) {
          console.warn("[Cloud Fee Sync] Error fetching family:", error);
          updateCloudSyncIndicator('offline');
          return { ok: false, error: 'family fetch failed' };
        }

        const notesObj = parseFamilyNotesData(fam?.notes);
        if (!Array.isArray(notesObj.fee_history)) {
          notesObj.fee_history = [];
        }

        // Prepend new records (avoiding duplicates by receiptNo). Batch
        // 3A (B9): a matching receiptNo only replaces the stored record
        // when it is the SAME record (same fingerprint). A different
        // record carrying the same number is kept alongside — never
        // overwritten — and the collision is surfaced.
        newRecords.forEach(nr => {
          // Batch 3.5 (P2-16): strip the local retry flag from the
          // copy stored in the cloud. The local record keeps its flag
          // until a sync actually succeeds.
          const toStore = { ...nr };
          delete toStore.cloudSyncPending;
          const existsIdx = notesObj.fee_history.findIndex(r => r.receiptNo === toStore.receiptNo);
          if (existsIdx >= 0) {
            if (feeRecordFingerprint(notesObj.fee_history[existsIdx]) === feeRecordFingerprint(toStore)) {
              notesObj.fee_history[existsIdx] = toStore;
            } else {
              notesObj.fee_history.unshift(toStore);
              console.warn(`[Cloud Fee Sync] Receipt ${toStore.receiptNo} already exists with different details for ${fId} — both records kept.`);
              lmsNotify(`Receipt ${toStore.receiptNo} already exists with different details — both records were kept.`, { type: 'warning' });
            }
          } else {
            notesObj.fee_history.unshift(toStore);
          }
        });

        const { error: upErr } = await db.from('families').update({
          notes: JSON.stringify(notesObj)
        }).eq('id', fId);

        if (upErr) {
          console.error("[Cloud Fee Sync] Supabase update error:", upErr);
          updateCloudSyncIndicator('offline');
          return { ok: false, error: 'family update failed' };
        } else {
          console.log(`[Cloud Fee Sync] Successfully synced ${newRecords.length} fee records for ${fId} to Supabase`);
          updateCloudSyncIndicator('synced');
          // Batch 6B dual-write: with the fee_tables_v1 flag ON, each record
          // is also copied into the payments table (one row per record,
          // including every advance-split record). Flag OFF = no-op.
          try {
            if (window.FeeTables && typeof window.FeeTables.dualWritePayment === 'function') {
              newRecords.forEach(function (nr) { window.FeeTables.dualWritePayment(nr, 'fee_form'); });
            }
          } catch (e) { /* dual-write must never affect the legacy sync */ }
          return { ok: true };
        }
      } catch (e) {
        console.error("[Cloud Fee Sync] Fatal sync exception:", e);
        updateCloudSyncIndicator('offline');
        return { ok: false, error: 'sync exception' };
      }
    }

    async function syncMatrixOverridesToCloud(familyId, overrides) {
      try {
        const fId = String(familyId).trim();
        if (!fId) return;
        const fIdUpper = fId.toUpperCase();

        updateCloudSyncIndicator('syncing');

        const { data: fam, error } = await db.from('families').select('id, notes').eq('id', fId).maybeSingle();
        if (error) {
          console.warn("[Cloud Matrix Sync] Error fetching family:", error);
          return;
        }

        const notesObj = parseFamilyNotesData(fam?.notes);
        if (!notesObj.matrix_overrides || typeof notesObj.matrix_overrides !== 'object') {
          notesObj.matrix_overrides = {};
        }

        // Apply overrides for this family
        Object.keys(overrides || {}).forEach(k => {
          if (k.toUpperCase().startsWith(fIdUpper + '_') || k.toUpperCase() === `ADM_${fIdUpper}`) {
            notesObj.matrix_overrides[k] = overrides[k];
          }
        });

        // Remove deleted overrides for this family
        Object.keys(notesObj.matrix_overrides).forEach(k => {
          if ((k.toUpperCase().startsWith(fIdUpper + '_') || k.toUpperCase() === `ADM_${fIdUpper}`) && !(k in overrides)) {
            delete notesObj.matrix_overrides[k];
          }
        });

        const { error: upErr } = await db.from('families').update({
          notes: JSON.stringify(notesObj)
        }).eq('id', fId);

        if (upErr) {
          console.error("[Cloud Matrix Sync] Supabase update error:", upErr);
        } else {
          console.log(`[Cloud Matrix Sync] Synced matrix overrides for ${fId} to Supabase`);
          updateCloudSyncIndicator('synced');
        }
      } catch (e) {
        console.error("[Cloud Matrix Sync] Fatal sync exception:", e);
      }
    }

    // Batch 3.5 (audit P2-16): the old version toasted about cloud
    // sync while only reloading the ledger — it never sent anything.
    // This now actually retries every locally-marked unsynced record
    // (grouped per family, so one family write per family) and reports
    // the REAL outcome: how many synced, how many are still pending.
    // A reload alone can no longer claim a sync happened.
    async function manualFeeCloudSync() {
      updateCloudSyncIndicator('syncing');
      const localRecords = getStoredFeeRecords();
      const pendingByFamily = {};
      localRecords.forEach(rec => {
        if (rec && rec.cloudSyncPending) {
          const famId = String(rec.familyId || '');
          if (!famId) return;
          (pendingByFamily[famId] = pendingByFamily[famId] || []).push(rec);
        }
      });
      const pendingFamilies = Object.keys(pendingByFamily);
      let syncedCount = 0;
      let failedCount = 0;
      for (const famId of pendingFamilies) {
        const batch = pendingByFamily[famId];
        let res = null;
        try {
          res = await syncPaymentRecordsBatchToCloud(famId, batch);
        } catch (e) {
          res = { ok: false };
        }
        if (res && res.ok) {
          syncedCount += batch.length;
          batch.forEach(rec => { delete rec.cloudSyncPending; });
        } else {
          failedCount += batch.length;
        }
      }
      if (syncedCount > 0 || failedCount > 0) saveStoredFeeRecords(localRecords);
      await loadFeeBillingLedger(true);
      if (pendingFamilies.length === 0) {
        updateCloudSyncIndicator('synced');
        lmsNotify("No unsynced fee records — fee records reloaded.");
      } else if (failedCount === 0) {
        updateCloudSyncIndicator('synced');
        lmsNotify(`${syncedCount} unsynced fee record(s) synced to the cloud.`);
      } else {
        updateCloudSyncIndicator('offline');
        lmsNotify(`${failedCount} fee record(s) still unsynced — please try Sync again.`, { type: 'error' });
      }
    }

    // Persistent storage helpers (Hybrid Cloud Cache + Local Fallback)
    function getStoredFeeRecords() {
      if (CLOUD_FEE_RECORDS_CACHE !== null && Array.isArray(CLOUD_FEE_RECORDS_CACHE)) {
        return CLOUD_FEE_RECORDS_CACHE;
      }
      try {
        const local = JSON.parse(localStorage.getItem('alhuda_fee_records') || '[]');
        CLOUD_FEE_RECORDS_CACHE = local;
        return local;
      } catch (e) {
        return [];
      }
    }

    function saveStoredFeeRecords(records) {
      CLOUD_FEE_RECORDS_CACHE = records;
      try {
        localStorage.setItem('alhuda_fee_records', JSON.stringify(records));
      } catch (e) {
        console.error("Error saving fee records:", e);
      }
    }

    function getStoredMatrixOverrides() {
      if (CLOUD_MATRIX_OVERRIDES_CACHE !== null && typeof CLOUD_MATRIX_OVERRIDES_CACHE === 'object') {
        return CLOUD_MATRIX_OVERRIDES_CACHE;
      }
      try {
        const local = JSON.parse(localStorage.getItem('alhuda_fee_matrix_overrides') || '{}');
        CLOUD_MATRIX_OVERRIDES_CACHE = local;
        return local;
      } catch (e) {
        return {};
      }
    }

    function saveStoredMatrixOverrides(overrides) {
      CLOUD_MATRIX_OVERRIDES_CACHE = overrides;
      try {
        localStorage.setItem('alhuda_fee_matrix_overrides', JSON.stringify(overrides));
      } catch (e) {
        console.error("Error saving matrix overrides:", e);
      }
    }

    // Sub-tab switcher inside Fee Management
    function switchFeeSubTab(subTabId) {
      if (!isNavigatingHistory && typeof recordNavigation === 'function') {
        recordNavigation('tab-invoices', subTabId);
      }

      // Fee Dashboard + Form Improvements: the active sub-view is
      // tracked for Refresh (Pending / Defaulters have no top-bar
      // button any more), and any KPI-card selection ring is cleared —
      // a KPI click re-sets it after this call returns.
      FEE_CURRENT_SUBTAB = subTabId;
      clearFeeKpiSelection();

      document.querySelectorAll('.fee-subtab-btn').forEach(btn => {
        btn.classList.remove('bg-emerald-800', 'text-white', 'shadow-xs', 'active');
        btn.classList.add('text-slate-600', 'hover:bg-slate-100');
      });

      const activeBtn = document.getElementById(subTabId.replace('fee-subview-', 'btnFeeSubTab-').replace('fee-subtab-', 'btnFeeSubTab-'));
      if (activeBtn) {
        activeBtn.classList.remove('text-slate-600', 'hover:bg-slate-100');
        activeBtn.classList.add('bg-emerald-800', 'text-white', 'shadow-xs', 'active');
      }

      document.querySelectorAll('.fee-subview-panel').forEach(panel => panel.classList.add('hidden'));
      const targetView = document.getElementById(subTabId.replace('fee-subtab-', 'feeSubView-'));
      if (targetView) targetView.classList.remove('hidden');

      if (subTabId === 'fee-subtab-overview') loadFeeDashboardStats();
      if (subTabId === 'fee-subtab-pending') loadPendingDefaultersList();
      if (subTabId === 'fee-subtab-defaulters') loadThreePlusDefaultersList();
      if (subTabId === 'fee-subtab-matrix') loadMasterAnnualMatrix();
      if (subTabId === 'fee-subtab-receipts') loadFeeReceiptsHistory();
    }

    function refreshCurrentFeeView() {
      // Fee Dashboard + Form Improvements: Pending / Defaulters have no
      // top-bar button any more (they open from the KPI cards), so the
      // active-button lookup cannot find them — the tracked sub-tab can.
      const id = (typeof FEE_CURRENT_SUBTAB === 'string' && FEE_CURRENT_SUBTAB) ? FEE_CURRENT_SUBTAB : 'fee-subtab-overview';
      switchFeeSubTab(id);
    }

    // Main entrypoint when switching to tab-invoices
    async function loadFeeBillingLedger(forceRefresh = false) {
      try {
        updateCloudSyncIndicator('syncing');

        if (typeof ensureCoreLmsDataLoaded === 'function') {
          const core = await ensureCoreLmsDataLoaded({ force: Boolean(forceRefresh) });
          CACHED_FEE_FAMILIES = core.families || [];
          if (forceRefresh && typeof ingestFeeDataFromFamilies === 'function') {
            await ingestFeeDataFromFamilies(core.rawFamilies || core.families || []);
          }
        } else {
          const { data: families } = await db.from('families').select('*, students(*)').order('created_at', { ascending: false });
          await ingestFeeDataFromFamilies(families);
          CACHED_FEE_FAMILIES = (families || []).filter(f => {
            if ((f.status || '').toLowerCase() === 'trial') return false;
            if ((f.status || '').toLowerCase() === 'converted') return false;
            if ((f.id || '').toUpperCase().startsWith('TRL-')) return false;
            if (f.notes) {
              try {
                const p = JSON.parse(f.notes);
                if (p.is_trial && !p.converted_from_trial) return false;
              } catch(e) {}
            }
            return true;
          });
        }

        // Set default month/year in dropdowns, once per page load.
        // Batch 3.5 (audit P2-12): the old code set these only
        // `if (!mSel.value)`, which the hard-coded `selected` September
        // option in index.html defeated — the dashboard opened on last
        // month, and bulk Remind All targeted it, until the user changed
        // two dropdowns by hand. The first ledger load now always picks
        // the current month; later loads leave the user's choice alone
        // (see FEE_MONTH_DEFAULTS_APPLIED).
        const now = new Date();
        const curMonthName = FEE_CONFIG.MONTHS[now.getMonth()] || "September";
        const curYear = now.getFullYear();

        const mSel = document.getElementById('feeDashMonthSelect');
        const ySel = document.getElementById('feeDashYearSelect');
        if (!FEE_MONTH_DEFAULTS_APPLIED) {
          FEE_MONTH_DEFAULTS_APPLIED = true;
          if (mSel) mSel.value = curMonthName;
          if (ySel) ySel.value = String(curYear);
          // Same staleness in the pending filter (it follows the
          // dashboard on pending-tab load, but its own initial value
          // was September too) and the salary month (first option won
          // by default, which was September 2026).
          const pMSel = document.getElementById('feePendingMonthFilter');
          const pYSel = document.getElementById('feePendingYearFilter');
          if (pMSel) pMSel.value = curMonthName;
          if (pYSel) pYSel.value = String(curYear);
          const salMSel = document.getElementById('salaryMonthSelect');
          if (salMSel) {
            const curLabel = `${curMonthName} ${curYear}`;
            if ([...salMSel.options].some(o => o.value === curLabel)) salMSel.value = curLabel;
          }
        }

        const formMSel = document.getElementById('feeFormMonth');
        const formYSel = document.getElementById('feeFormYear');
        if (formMSel) formMSel.value = curMonthName;
        if (formYSel) formYSel.value = String(curYear);

        updateOfficialEmailUI();

        // Load overview stats by default
        await loadFeeDashboardStats();

      } catch (err) {
        console.error("Error initializing Fee Management Engine:", err);
      }
    }

    // Check if family has approved leave in target month & year (Unified with LMS Leave Tracker)
    function checkFamilyLeaveInMonth(familyId, monthName, year) {
      const famUpper = String(familyId || '').toUpperCase();
      const mLower = String(monthName || '').toLowerCase();
      const yInt = parseInt(year, 10);

      // 1. Check local matrix overrides
      const overrides = getStoredMatrixOverrides();
      const overrideKey = `${famUpper}_${mLower}_${yInt}`;
      if (overrides[overrideKey] && overrides[overrideKey].status === 'leave') {
        return { isLeave: true, reason: overrides[overrideKey].notes || 'Approved Leave (Fee Waived)' };
      }

      // 2. Check LMS Leave Records from tab-leaves
      if (ALL_LEAVE_RECORDS && ALL_LEAVE_RECORDS.length > 0) {
        const mIdx = FEE_CONFIG.MONTHS.findIndex(m => m.toLowerCase() === mLower);
        const match = ALL_LEAVE_RECORDS.find(rec => {
          const st = rec.student;
          if (!st || String(st.family_id).toUpperCase() !== famUpper) return false;
          if (!rec.isOnLeave) return false;

          const sDate = rec.meta?.leave_start_date;
          const rDate = rec.meta?.return_date;
          if (sDate) {
            const sY = parseInt(sDate.substring(0, 4), 10);
            const sM = parseInt(sDate.substring(5, 7), 10) - 1;
            if (sY === yInt && sM === mIdx) return true;
          }
          if (rDate) {
            const rY = parseInt(rDate.substring(0, 4), 10);
            const rM = parseInt(rDate.substring(5, 7), 10) - 1;
            if (rY === yInt && rM === mIdx) return true;
          }
          return false;
        });

        if (match) {
          return { isLeave: true, reason: match.meta?.leave_reason || 'Approved Leave (Fee Waived)' };
        }
      }

      return { isLeave: false, reason: '' };
    }

    // -------------------------------------------------------------
    // ENROLLMENT & JOINING DATE DETECTION ENGINE
    // Auto-detects student/family admission month from LMS data.
    // Pre-admission months are automatically $0 expected fee & zero arrears!
    // -------------------------------------------------------------
    function getFamilyEnrollmentInfo(fam) {
      if (!fam) return { year: 2026, monthIndex: 0, monthName: 'January', source: 'default' };
      const fIdUpper = String(fam.id || '').toUpperCase();

      // 1. Check manual enrollment override in local storage
      const overrides = getStoredMatrixOverrides();
      const admKey = `ADMISSION_${fIdUpper}`;
      if (overrides[admKey] && overrides[admKey].year !== undefined && overrides[admKey].monthIndex !== undefined) {
        const mi = parseInt(overrides[admKey].monthIndex, 10);
        const yr = parseInt(overrides[admKey].year, 10);
        return {
          year: yr,
          monthIndex: mi,
          monthName: FEE_CONFIG.MONTHS[mi] || 'January',
          source: 'manual_override'
        };
      }

      // 2. Check if any student in the family has joining_date or created_at
      let earliestDate = null;
      const regStus = (fam.students || []).filter(s => (s.status || '').toLowerCase() !== 'trial');
      const stusToCheck = regStus.length > 0 ? regStus : (fam.students || []);

      stusToCheck.forEach(s => {
        if (s.joining_date) {
          const d = new Date(s.joining_date);
          if (!isNaN(d.getTime())) {
            if (!earliestDate || d < earliestDate) earliestDate = d;
          }
        } else if (s.created_at) {
          const d = new Date(s.created_at);
          if (!isNaN(d.getTime())) {
            if (!earliestDate || d < earliestDate) earliestDate = d;
          }
        }
      });

      // 3. Check family created_at
      if (!earliestDate && fam.created_at) {
        const d = new Date(fam.created_at);
        if (!isNaN(d.getTime())) earliestDate = d;
      }

      // 4. Check family notes for joined/admission date string
      if (!earliestDate && fam.notes) {
        let noteStr = fam.notes;
        if (typeof fam.notes === 'string') {
          try {
            const p = JSON.parse(fam.notes);
            noteStr = p.admission_date || p.joined_date || p.custom_notes || (typeof p === 'string' ? p : '');
          } catch(e) {}
        }
        const m = String(noteStr).match(/joined:?\s*(\d{4})[-/](\d{1,2})/i) || String(noteStr).match(/(\d{4})[-/](\d{1,2})/);
        if (m) {
          const y = parseInt(m[1], 10);
          const mi = parseInt(m[2], 10) - 1;
          if (y >= 2020 && mi >= 0 && mi <= 11) {
            return {
              year: y,
              monthIndex: mi,
              monthName: FEE_CONFIG.MONTHS[mi],
              source: 'notes_detected'
            };
          }
        }
      }

      // 5. Also check earliest recorded fee payment
      const feeRecords = getStoredFeeRecords().filter(r => String(r.familyId).toUpperCase() === fIdUpper && parseFloat(r.amountPaid || 0) > 0);
      if (feeRecords.length > 0) {
        let earliestFeeScore = Infinity;
        let earliestFeeMonthIdx = 0;
        let earliestFeeYear = 2026;
        feeRecords.forEach(r => {
          const rY = parseInt(r.year, 10);
          const rMIdx = FEE_CONFIG.MONTHS.findIndex(m => m.toLowerCase() === String(r.month).toLowerCase());
          if (rY > 2020 && rMIdx !== -1) {
            const sc = rY * 100 + rMIdx;
            if (sc < earliestFeeScore) {
              earliestFeeScore = sc;
              earliestFeeMonthIdx = rMIdx;
              earliestFeeYear = rY;
            }
          }
        });
        if (earliestFeeScore < Infinity) {
          const feeDateObj = new Date(earliestFeeYear, earliestFeeMonthIdx, 1);
          if (!earliestDate || feeDateObj < earliestDate) {
            earliestDate = feeDateObj;
          }
        }
      }

      if (earliestDate) {
        const y = earliestDate.getFullYear();
        const mi = earliestDate.getMonth();
        return {
          year: y,
          monthIndex: mi,
          monthName: FEE_CONFIG.MONTHS[mi],
          source: 'lms_detected'
        };
      }

      return { year: 2026, monthIndex: 0, monthName: 'January', source: 'default' };
    }

    function isFamilyPreAdmission(fam, monthNameOrIdx, year) {
      if (!fam) return false;
      const enroll = getFamilyEnrollmentInfo(fam);
      const mIdx = typeof monthNameOrIdx === 'number'
        ? monthNameOrIdx
        : FEE_CONFIG.MONTHS.findIndex(m => m.toLowerCase() === String(monthNameOrIdx).toLowerCase());

      if (mIdx === -1) return false;
      const yInt = parseInt(year, 10);

      const targetScore = yInt * 100 + mIdx;
      const enrollScore = enroll.year * 100 + enroll.monthIndex;
      return targetScore < enrollScore;
    }

    // ============================================================
    // 1. DASHBOARD ANALYTICS & MULTI-CURRENCY STATS
    // ============================================================
    async function loadFeeDashboardStats() {
      // Fee Dashboard + Form Improvements: a new dashboard period makes
      // any KPI-card selection and any Receipts month filter stale.
      clearFeeKpiSelection();
      clearFeeReceiptsMonthFilter();
      const mSel = document.getElementById('feeDashMonthSelect');
      const ySel = document.getElementById('feeDashYearSelect');
      const selectedMonth = mSel ? mSel.value : (FEE_CONFIG.MONTHS[new Date().getMonth()] || 'September');
      const selectedYear = ySel ? parseInt(ySel.value, 10) : new Date().getFullYear();

      const badgePeriod = document.getElementById('feeDashActivePeriodBadge');
      if (badgePeriod) badgePeriod.innerText = `${selectedMonth} ${selectedYear}`;
      const headerBadge = document.getElementById('badgeFeeHeaderMonth');
      if (headerBadge) headerBadge.innerText = `${selectedMonth} ${selectedYear}`;
      const progLabel = document.getElementById('feeProgressMonthLabel');
      if (progLabel) progLabel.innerText = `${selectedMonth} ${selectedYear}`;

      const families = CACHED_FEE_FAMILIES || [];
      const records = getStoredFeeRecords();
      const overrides = getStoredMatrixOverrides();

      // Total students
      let totalStudentsCount = 0;
      families.forEach(f => {
        const regStus = (f.students || []).filter(s => (s.status || '').toLowerCase() !== 'trial');
        totalStudentsCount += (regStus.length > 0 ? regStus.length : 1);
      });

      // Currency breakdown map
      const currencyRevenue = {};
      FEE_CONFIG.CURRENCIES.forEach(cur => {
        currencyRevenue[cur] = { expected: 0, received: 0 };
      });

      families.forEach(f => {
        const cur = (f.currency || 'USD').toUpperCase();
        if (!currencyRevenue[cur]) currencyRevenue[cur] = { expected: 0, received: 0 };

        // If family was not admitted yet in selected month, expected tuition is 0
        const fUpper = String(f.id).toUpperCase();
        const mLower = selectedMonth.toLowerCase();
        const isPreAdm = isFamilyPreAdmission(f, selectedMonth, selectedYear);
        const isExplicitNotEnrolled = overrides[`${fUpper}_${mLower}_${selectedYear}`]?.status === 'not_enrolled';
        if (isPreAdm || isExplicitNotEnrolled) return;

        // Fee Upgrade Phase 3: a month settled by an ADJ status row is
        // NOT billed — its Expected is 0, so Pending (Expected minus
        // Received) is not overstated. The fee portal counts status-paid
        // months in Expected; the LMS cannot, because its Pending is
        // derived as Expected minus Received.
        const monthIdx3 = FEE_CONFIG.MONTHS.findIndex(m => m.toLowerCase() === selectedMonth.toLowerCase());
        if (isFamilyMonthStatusPaid(f.id, monthIdx3, selectedYear, records)) return;

        currencyRevenue[cur].expected += feeFormApplicableFeeDetails(f, FEE_CONFIG.MONTHS.findIndex(m => m.toLowerCase() === selectedMonth.toLowerCase()), selectedYear).fee;
      });

      // Track paid vs pending for selected month & year
      const paidMap = {};
      const partialMap = {};

      records.forEach(r => {
        if (String(r.month).toLowerCase() === selectedMonth.toLowerCase() && parseInt(r.year, 10) === selectedYear) {
          const famIdUpper = String(r.familyId).toUpperCase();
          // Fee Dashboard + Form Improvements: a cancelled record is
          // never a payment — it must not mark the family Paid.
          if (isFeeRecordCancelled(r)) return;
          // Fee Upgrade Phase 3: an ADJ status row is not money — it
          // never adds to Received. It only marks the month paid.
          if (isFeeStatusRowRecord(r)) {
            const monthIdx3 = FEE_CONFIG.MONTHS.findIndex(m => m.toLowerCase() === selectedMonth.toLowerCase());
            if (isFamilyMonthStatusPaid(r.familyId, monthIdx3, selectedYear, records)) {
              paidMap[famIdUpper] = true;
            }
            return;
          }
          const rPaid = parseFloat(r.amountPaid || 0);
          const rRem = parseFloat(r.remainingBalance || 0);
          const rCur = (r.currency || 'USD').toUpperCase();

          if (!currencyRevenue[rCur]) currencyRevenue[rCur] = { expected: 0, received: 0 };
          currencyRevenue[rCur].received += rPaid;

          if (rRem <= 0) {
            paidMap[famIdUpper] = true;
          } else {
            partialMap[famIdUpper] = rRem;
          }
        }
      });

      // Check leaves and pending families
      const pendingFamiliesList = [];
      let onLeaveCount = 0;
      let activeEnrolledThisMonth = 0;

      families.forEach(fam => {
        const famUpper = String(fam.id).toUpperCase();
        const mLower = selectedMonth.toLowerCase();
        const overrideKey = `${famUpper}_${mLower}_${selectedYear}`;
        const manualOverride = overrides[overrideKey];

        // Fee Dashboard + Form Improvements: a deactivated family is
        // never Active, never Pending and never On Leave — it belongs
        // to no KPI list.
        if (typeof isFamilyDeactivated === 'function' && isFamilyDeactivated(fam)) return;

        // 1. Skip pre-admission or explicitly not-enrolled families
        const isPreAdm = isFamilyPreAdmission(fam, selectedMonth, selectedYear);
        const isExplicitNotEnrolled = manualOverride && manualOverride.status === 'not_enrolled';
        if (isPreAdm || isExplicitNotEnrolled) {
          return;
        }

        activeEnrolledThisMonth++;

        // 2. Check approved leave
        const leaveCheck = checkFamilyLeaveInMonth(fam.id, selectedMonth, selectedYear);
        if (leaveCheck.isLeave || (manualOverride && manualOverride.status === 'leave')) {
          onLeaveCount++;
          return;
        }

        if (!paidMap[famUpper]) {
          const hasPartial = partialMap[famUpper] !== undefined;
          const dueAmt = hasPartial ? partialMap[famUpper] : feeFormApplicableFeeDetails(fam, FEE_CONFIG.MONTHS.findIndex(m => m.toLowerCase() === selectedMonth.toLowerCase()), selectedYear).fee;
          
          const regStus = (fam.students || []).filter(s => (s.status || '').toLowerCase() !== 'trial');
          const stuNames = regStus.map(s => s.name).join(', ') || 'Enrolled Student';

          const famEmail = getFamilyEmailAddress(fam);

          pendingFamiliesList.push({
            family: fam,
            familyId: fam.id,
            parentName: fam.parent_name,
            studentsNames: stuNames,
            country: fam.country || 'International',
            whatsapp: fam.whatsapp || '',
            email: famEmail,
            currency: fam.currency || 'USD',
            dueAmount: dueAmt,
            selectedMonth: selectedMonth,
            selectedYear: selectedYear,
            isPartial: hasPartial,
            status: hasPartial ? 'Partial (Balance Pending)' : 'Pending'
          });
        }
      });

      CACHED_PENDING_FEE_LIST = pendingFamiliesList;

      // Sync Pending Payments month/year dropdowns with Dashboard selection
      const pMSel = document.getElementById('feePendingMonthFilter');
      const pYSel = document.getElementById('feePendingYearFilter');
      if (pMSel && pMSel.value !== selectedMonth) pMSel.value = selectedMonth;
      if (pYSel && String(pYSel.value) !== String(selectedYear)) pYSel.value = String(selectedYear);

      const totalActive = activeEnrolledThisMonth > 0 ? activeEnrolledThisMonth : families.length;
      const paidCount = Object.keys(paidMap).length;
      const pendingCount = pendingFamiliesList.length;
      // Fee Dashboard + Form Improvements: Active and On Leave are the
      // Families-tab v3 partition (current status, not month-scoped),
      // so the card figures match the lists their clicks open exactly.
      // Paid / Pendings stay month-scoped; Defaulters is the 3+ list.
      const v3ActiveFams = (typeof getActiveFamilies === 'function') ? getActiveFamilies(families) : [];
      const v3LeaveFams = (typeof getOnLeaveFamilies === 'function') ? getOnLeaveFamilies(families, (typeof ALL_STUDENTS !== 'undefined' ? ALL_STUDENTS : [])) : [];
      const v3ActiveCount = v3ActiveFams.filter(f => !v3LeaveFams.includes(f)).length;
      const v3LeaveCount = v3LeaveFams.length;
      FEE_KPI_COUNTS = { active: v3ActiveCount, paid: paidCount, pendings: pendingCount, defaulters: (CACHED_THREE_MONTH_DEFAULTERS || []).length, onLeave: v3LeaveCount };
      const effectiveTotal = Math.max(1, totalActive - onLeaveCount);
      const pctPaid = Math.min(100, Math.round((paidCount / effectiveTotal) * 100));

      // Update KPI Counter DOM Elements
      const kpiFamilies = document.getElementById('kpiFeeTotalFamilies');
      if (kpiFamilies) kpiFamilies.innerText = v3ActiveCount;
      const kpiStudents = document.getElementById('kpiFeeTotalStudents');
      if (kpiStudents) kpiStudents.innerText = totalStudentsCount;
      const kpiPaid = document.getElementById('kpiFeePaidCount');
      if (kpiPaid) kpiPaid.innerText = paidCount;
      const kpiPending = document.getElementById('kpiFeePendingCount');
      if (kpiPending) kpiPending.innerText = pendingCount;
      const kpiDefaulters = document.getElementById('kpiFeeDefaultersCount');
      if (kpiDefaulters) kpiDefaulters.innerText = FEE_KPI_COUNTS.defaulters;
      const kpiLeave = document.getElementById('kpiFeeLeaveCount');
      if (kpiLeave) kpiLeave.innerText = v3LeaveCount;

      const kpiPaidPct = document.getElementById('kpiFeePaidPercent');
      if (kpiPaidPct) kpiPaidPct.innerText = `${pctPaid}%`;
      const kpiPaidRatio = document.getElementById('kpiFeePaidRatio');
      if (kpiPaidRatio) kpiPaidRatio.innerText = `${paidCount}/${effectiveTotal}`;
      const kpiPendingPct = document.getElementById('kpiFeePendingPercent');
      if (kpiPendingPct) kpiPendingPct.innerText = `${100 - pctPaid}%`;

      const kpiProgressText = document.getElementById('kpiFeeProgressPercent');
      if (kpiProgressText) kpiProgressText.innerText = `${pctPaid}% Collected`;
      const pBarPaid = document.getElementById('feeProgressBarPaid');
      if (pBarPaid) pBarPaid.style.width = `${pctPaid}%`;
      const pBarPending = document.getElementById('feeProgressBarPending');
      if (pBarPending) pBarPending.style.width = `${100 - pctPaid}%`;

      // Update badges
      const subBadge = document.getElementById('feeSubBadgePending');
      if (subBadge) subBadge.innerText = pendingCount;
      const navBadge = document.getElementById('navFeePendingBadge');
      if (navBadge) {
        navBadge.innerText = pendingCount;
        if (pendingCount > 0) navBadge.classList.remove('hidden');
        else navBadge.classList.add('hidden');
      }

      // Render currency breakdown cards
      renderFeeCurrencyGrid(currencyRevenue);

      // Compute 3+ Months Defaulters list and update its badge automatically
      // (and the Defaulters KPI card — the list above was the previous
      // run's, so the card is corrected here in the same tick).
      let defaulterListNow = CACHED_THREE_MONTH_DEFAULTERS || [];
      if (typeof calculateThreePlusMonthDefaulters === 'function') {
        defaulterListNow = calculateThreePlusMonthDefaulters(selectedMonth, selectedYear) || [];
      }
      FEE_KPI_COUNTS.defaulters = defaulterListNow.length;
      const kpiDefNow = document.getElementById('kpiFeeDefaultersCount');
      if (kpiDefNow) kpiDefNow.innerText = defaulterListNow.length;

      // Check and run 4th of Every Month Auto-Reminder if due
      if (typeof initAndCheckMonthly4thAutoReminder === 'function') {
        initAndCheckMonthly4thAutoReminder();
      }
    }

    // ============================================================
    // FEE DASHBOARD + FORM IMPROVEMENTS — CLICKABLE KPI CARDS (#1)
    //
    // Five cards, each opening the EXISTING view for its figure:
    //   Active     -> Families tab, v3 Active filter
    //   Paid       -> Receipts sub-view, filtered to the selected month
    //   Pendings   -> existing Pending sub-view (selected month)
    //   Defaulters -> existing 3+ Defaulters sub-view
    //   On Leave   -> Families tab, v3 On Leave filter
    // The counts come from the same lists the views render, so a card
    // figure and the list it opens can never drift apart.
    // ============================================================
    function syncFeeKpiCardsUI() {
      ['active', 'paid', 'pendings', 'defaulters', 'leave'].forEach(function (key) {
        const card = document.getElementById('feeKpiCard-' + key);
        if (!card) return;
        const selected = FEE_KPI_SELECTED === key;
        card.setAttribute('aria-pressed', selected ? 'true' : 'false');
        card.classList.toggle('fee-kpi-selected', selected);
      });
    }

    function clearFeeKpiSelection() {
      FEE_KPI_SELECTED = null;
      try { syncFeeKpiCardsUI(); } catch (e) {}
    }

    function feeKpiMonthYear() {
      const mSel = document.getElementById('feeDashMonthSelect');
      const ySel = document.getElementById('feeDashYearSelect');
      const monthName = mSel ? mSel.value : (FEE_CONFIG.MONTHS[new Date().getMonth()] || 'September');
      const year = ySel ? parseInt(ySel.value, 10) : new Date().getFullYear();
      return { monthName, monthIdx: FEE_CONFIG.MONTHS.findIndex(m => m.toLowerCase() === String(monthName).toLowerCase()), year };
    }

    function handleFeeKpiClick(key) {
      if (key === 'active' || key === 'leave') {
        if (typeof switchTab === 'function') switchTab('tab-families');
        if (typeof setDirectoryKpi === 'function') setDirectoryKpi(key === 'leave' ? 'leave' : 'active');
      } else if (key === 'paid') {
        const period = feeKpiMonthYear();
        setFeeReceiptsMonthFilter(period.monthIdx, period.year);
        switchFeeSubTab('fee-subtab-receipts');
      } else if (key === 'pendings') {
        switchFeeSubTab('fee-subtab-pending');
      } else if (key === 'defaulters') {
        switchFeeSubTab('fee-subtab-defaulters');
      } else {
        return;
      }
      FEE_KPI_SELECTED = key;
      syncFeeKpiCardsUI();
    }

    // ---- Receipts month filter (the Paid KPI target) ----
    // The filter is state, not a search: it is set by the Paid KPI
    // click, cleared by a dashboard month change or by typing in the
    // receipts search box, and cleared by its own chip button.
    function setFeeReceiptsMonthFilter(monthIdx, year) {
      FEE_RECEIPTS_MONTH_FILTER = { monthIdx: parseInt(monthIdx, 10), year: parseInt(year, 10) };
      syncFeeReceiptsMonthChip();
    }

    function clearFeeReceiptsMonthFilter() {
      FEE_RECEIPTS_MONTH_FILTER = null;
      try { syncFeeReceiptsMonthChip(); } catch (e) {}
    }

    function syncFeeReceiptsMonthChip() {
      const chip = document.getElementById('feeReceiptsMonthChip');
      if (!chip) return;
      if (!FEE_RECEIPTS_MONTH_FILTER) { chip.classList.add('hidden'); return; }
      const label = (window.FeePhase6 && typeof window.FeePhase6.receiptsMonthFilterLabel === 'function')
        ? window.FeePhase6.receiptsMonthFilterLabel(FEE_RECEIPTS_MONTH_FILTER.monthIdx, FEE_RECEIPTS_MONTH_FILTER.year)
        : (FEE_CONFIG.MONTHS[FEE_RECEIPTS_MONTH_FILTER.monthIdx] + ' ' + FEE_RECEIPTS_MONTH_FILTER.year);
      const records = (typeof getStoredFeeRecords === 'function') ? (getStoredFeeRecords() || []) : [];
      const inMonth = records.filter(r => {
        if (window.FeePhase6 && typeof window.FeePhase6.isReceiptInMonth === 'function') {
          return window.FeePhase6.isReceiptInMonth(r, FEE_RECEIPTS_MONTH_FILTER.monthIdx, FEE_RECEIPTS_MONTH_FILTER.year);
        }
        return String(r.month).toLowerCase() === (FEE_CONFIG.MONTHS[FEE_RECEIPTS_MONTH_FILTER.monthIdx] || '').toLowerCase()
          && parseInt(r.year, 10) === FEE_RECEIPTS_MONTH_FILTER.year
          && String(r.status || '').toLowerCase().indexOf('cancel') === -1;
      });
      const fams = {};
      inMonth.forEach(r => {
        const key = String(r.familyId || '').toUpperCase();
        if (!fams[key]) fams[key] = true;
      });
      // "Paid families" here means the same as the Paid KPI card: the
      // month's bill is settled in full — a record for the month has
      // remainingBalance <= 0. The bill includes any arrears, so paying
      // only the month's fee while arrears stand does NOT count (a
      // partial payer has receipts in the month but is NOT a paid
      // family); a credit-settled zero-amount record DOES count, exactly
      // as the dashboard's paidMap does. ADJ status-paid months have no
      // receipt, so they never enter this list — the count is the paid
      // families among the receipts shown.
      let famCount = 0;
      Object.keys(fams).forEach((key) => {
        const settled = records.some((r) => {
          if (String(r.familyId || '').toUpperCase() !== key) return false;
          if (window.FeePhase6 && typeof window.FeePhase6.isReceiptInMonth === 'function') {
            if (!window.FeePhase6.isReceiptInMonth(r, FEE_RECEIPTS_MONTH_FILTER.monthIdx, FEE_RECEIPTS_MONTH_FILTER.year)) return false;
          } else {
            if (String(r.month).toLowerCase() !== (FEE_CONFIG.MONTHS[FEE_RECEIPTS_MONTH_FILTER.monthIdx] || '').toLowerCase()) return false;
            if (parseInt(r.year, 10) !== FEE_RECEIPTS_MONTH_FILTER.year) return false;
            if (String(r.status || '').toLowerCase().indexOf('cancel') !== -1) return false;
          }
          return parseFloat(r.remainingBalance || 0) <= 0;
        });
        if (settled) famCount++;
      });
      const text = document.getElementById('feeReceiptsMonthChipText');
      if (text) text.innerText = 'Showing receipts for ' + label + ' — ' + famCount + ' paid famil' + (famCount === 1 ? 'y' : 'ies') + ' (' + inMonth.length + ' receipt' + (inMonth.length === 1 ? '' : 's') + ')';
      chip.classList.remove('hidden');
    }

    function renderFeeCurrencyGrid(currencyRevenue) {
      const container = document.getElementById('feeCurrencyGridContainer');
      if (!container) return;
      container.innerHTML = '';

      let hasData = false;
      // Fee Upgrade Phase 4 (#11, #70): the grid also shows custom
      // currencies saved on this device, and every card is clickable —
      // it opens the per-family drill-down for that currency + month.
      const gridCurrencies = (window.FeePhase4 && typeof window.FeePhase4.allFeeCurrencies === 'function')
        ? window.FeePhase4.allFeeCurrencies(FEE_CONFIG.CURRENCIES, window.FeePhase4.getCustomCurrencies(localStorage))
        : FEE_CONFIG.CURRENCIES.slice();
      for (const cur of gridCurrencies) {
        const data = currencyRevenue[cur] || { expected: 0, received: 0 };
        if (data.expected === 0 && data.received === 0) continue;
        hasData = true;

        const pct = data.expected > 0 ? Math.min(100, Math.round((data.received / data.expected) * 100)) : 0;
        const pendingAmt = Math.max(0, data.expected - data.received);
        const fmtAmt = (val) => typeof formatLmsCurrencyHtml === 'function'
          ? formatLmsCurrencyHtml(val, cur)
          : `${cur} ${Number(val || 0).toLocaleString()}`;

        const card = document.createElement('div');
        card.className = 'p-4 bg-white border border-slate-200/90 rounded-2xl shadow-2xs hover:shadow-md transition space-y-3 cursor-pointer';
        card.title = 'Click to see the families in ' + cur;
        card.addEventListener('click', () => openCurrencyDetailModal(cur));
        card.innerHTML = `
          <div class="flex justify-between items-center border-b border-slate-100 pb-2.5">
            <span class="px-2.5 py-1 rounded-lg bg-slate-900 text-white lms-num-id font-bold text-xs tracking-wide">${cur}</span>
            <span class="px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 lms-num-percent text-xs font-bold">${pct}% Paid</span>
          </div>
          <div>
            <span class="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">Received Revenue</span>
            <div class="text-2xl font-bold text-emerald-700 mt-0.5 lms-num-financial">${fmtAmt(data.received)}</div>
          </div>
          <div class="grid grid-cols-2 gap-2 pt-1">
            <div class="p-2 rounded-xl bg-slate-50 border border-slate-200/70">
              <span class="text-[10.5px] font-bold uppercase tracking-wider text-slate-400 block">Expected</span>
              <div class="text-sm font-bold text-slate-800 mt-0.5 lms-num-financial">${fmtAmt(data.expected)}</div>
            </div>
            <div class="p-2 rounded-xl ${pendingAmt > 0 ? 'bg-rose-50/70 border-rose-200/80' : 'bg-emerald-50/60 border-emerald-200/70'} border">
              <span class="text-[10.5px] font-bold uppercase tracking-wider ${pendingAmt > 0 ? 'text-rose-600' : 'text-emerald-700'} block">Pending</span>
              <div class="text-sm font-bold ${pendingAmt > 0 ? 'text-rose-700' : 'text-emerald-700'} mt-0.5 lms-num-financial">${fmtAmt(pendingAmt)}</div>
            </div>
          </div>
          <div class="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
            <div class="h-full bg-emerald-600 transition-all duration-300" style="width: ${pct}%;"></div>
          </div>
        `;
        container.appendChild(card);
      }

      if (!hasData) {
        container.innerHTML = `<div class="col-span-4 p-4 text-center text-xs text-slate-400 font-medium">No currency billing expected yet. Add family fee rates to see real-time breakdown.</div>`;
      }
    }

    // ============================================================
    // 2. COLLECT FEE, AUTO-SEARCH & SMART ARREARS ENGINE
    // ============================================================
    function handleFeeFamilySearch(query) {
      const dropdown = document.getElementById('feeSearchResultsDropdown');
      if (!dropdown) return;
      const q = (query || '').trim().toLowerCase();

      if (!q || q.length < 1) {
        dropdown.classList.add('hidden');
        return;
      }

      const families = CACHED_FEE_FAMILIES || [];
      const matches = families.filter(f => {
        const fId = String(f.id || '').toLowerCase();
        const pName = String(f.parent_name || '').toLowerCase();
        const regStus = (f.students || []).map(s => String(s.name || '').toLowerCase()).join(' ');
        return fId.includes(q) || pName.includes(q) || regStus.includes(q);
      });

      dropdown.innerHTML = '';
      if (matches.length === 0) {
        dropdown.innerHTML = '<div class="p-3 text-xs text-slate-400 text-center">No matching family found.</div>';
        dropdown.classList.remove('hidden');
        return;
      }

      matches.slice(0, 8).forEach(fam => {
        const regStus = (fam.students || []).filter(s => (s.status || '').toLowerCase() !== 'trial');
        const stuNames = regStus.map(s => s.name).join(', ') || 'Enrolled Student';

        const item = document.createElement('div');
        item.className = 'p-3 hover:bg-emerald-50 cursor-pointer transition flex justify-between items-center';
        item.innerHTML = `
          <div>
            <strong class="text-xs text-slate-900 block">${fam.parent_name} <span class="font-mono text-slate-400 font-bold">(${fam.id})</span></strong>
            <span class="text-[11px] text-emerald-800 font-medium block"><i class="fa-solid fa-graduation-cap text-emerald-600 mr-1"></i>${stuNames}</span>
          </div>
          <div class="text-right">
            <span class="text-xs font-bold font-mono text-emerald-700">${fam.currency || 'USD'} ${fam.monthly_fee || 0}</span>
            <span class="text-[10px] text-slate-400 block">${fam.country || 'International'}</span>
          </div>
        `;
        item.onclick = () => {
          selectFeeFamily(fam.id);
          dropdown.classList.add('hidden');
          const searchInput = document.getElementById('feeFamilySearchInput');
          if (searchInput) searchInput.value = '';
        };
        dropdown.appendChild(item);
      });

      dropdown.classList.remove('hidden');
    }

    function selectFeeFamily(familyId) {
      const fam = (CACHED_FEE_FAMILIES || []).find(f => String(f.id).toUpperCase() === String(familyId).toUpperCase());
      if (!fam) return;

      switchFeeSubTab('fee-subtab-collect');

      const regStus = (fam.students || []).filter(s => (s.status || '').toLowerCase() !== 'trial');
      const stuNames = regStus.map(s => s.name).join(', ') || 'Enrolled Student';

      document.getElementById('feeFormFamilyId').value = fam.id;
      document.getElementById('feeFormParentName').value = fam.parent_name || '';
      document.getElementById('feeFormStudentsNames').value = stuNames;
      document.getElementById('feeFormCountry').value = fam.country || '';
      document.getElementById('feeFormWhatsApp').value = fam.whatsapp || '';
      document.getElementById('feeFormParentEmail').value = fam.email || '';

      const fee = parseFloat(fam.monthly_fee || 0);
      document.getElementById('feeFormMonthlyFee').value = fee.toFixed(2);
      document.getElementById('feeFormCurrency').value = (fam.currency || 'USD').toUpperCase();

      // Fee Upgrade Phase 4 (#19): pre-select this family's remembered
      // payment method, if one is saved on this device.
      applyRememberedPaymentMethod(fam.id);

      // Reset proration and advance toggles
      const progToggle = document.getElementById('feeToggleProrated');
      if (progToggle) progToggle.checked = false;
      const pBox = document.getElementById('feeProrateBox');
      if (pBox) pBox.classList.add('hidden');

      const advToggle = document.getElementById('feeToggleAdvance');
      if (advToggle) advToggle.checked = false;
      const aBox = document.getElementById('feeAdvanceBox');
      if (aBox) aBox.classList.add('hidden');
      clearMultiMonthSelection();

      // Trigger Smart Arrears check
      triggerFeeBalanceRecalc();
    }

    // -------------------------------------------------------------
    // ADVANCE CREDIT & OVERPAYMENT ENGINE
    // Tracks extra / advance payments (surplus) from parents.
    // When a parent pays extra, it automatically carries forward as an
    // Advance Credit to deduct from the following month's billing.
    // -------------------------------------------------------------
    function getFamilyAvailableAdvanceCredit(familyId, upToMonthName, upToYear) {
      if (!familyId) return 0;
      const fIdUpper = String(familyId).toUpperCase();
      const records = getStoredFeeRecords().filter(r => String(r.familyId).toUpperCase() === fIdUpper);
      const overrides = getStoredMatrixOverrides();

      const upToMIdx = upToMonthName 
        ? FEE_CONFIG.MONTHS.findIndex(m => m.toLowerCase() === String(upToMonthName).toLowerCase())
        : 11;
      const upToYearInt = parseInt(upToYear || 2026, 10);
      const upToScore = upToYearInt * 100 + upToMIdx;

      let netCredit = 0;

      // 1. Check past payment records before this billing period
      records.forEach(r => {
        const rY = parseInt(r.year, 10);
        const rMIdx = FEE_CONFIG.MONTHS.findIndex(m => m.toLowerCase() === String(r.month).toLowerCase());
        const rScore = rY * 100 + rMIdx;

        if (rScore < upToScore) {
          const excess = parseFloat(r.excessPaid || 0);
          const used = parseFloat(r.creditDeducted || 0);
          netCredit += (excess - used);
        }
      });

      // 2. Check manual credit override if any
      const manCredit = parseFloat(overrides[`CREDIT_${fIdUpper}`] || 0);
      netCredit += manCredit;

      return Math.max(0, netCredit);
    }

    // Fee Upgrade Phase 3 — is this single record an ADJ status row
    // (record_kind 'month_status', ref ADJ-YYYYMM-...)? Delegates to
    // FeePhase3 when loaded; falls back to the same predicate inline so
    // the fee tab keeps working either way.
    // Fee Dashboard + Form Improvements: cancelled means cancelled.
    // Delegates to FeePhase6 when loaded; falls back to the same
    // predicate inline so the fee tab keeps working either way.
    function isFeeRecordCancelled(r) {
      if (window.FeePhase6 && typeof window.FeePhase6.isCancelledFeeRecord === 'function') {
        return window.FeePhase6.isCancelledFeeRecord(r);
      }
      if (!r) return false;
      return String(r.status || '').toLowerCase().indexOf('cancel') !== -1;
    }

    function isFeeStatusRowRecord(r) {
      if (window.FeePhase3 && typeof window.FeePhase3.isMonthStatusRow === 'function') {
        return window.FeePhase3.isMonthStatusRow(r);
      }
      if (!r) return false;
      if (String(r.recordKind || '') === 'month_status') return true;
      return /^ADJ-\d{6}-/i.test(String(r.receiptNo || ''));
    }

    // Fee Upgrade Phase 3 — is this family+month settled by an ADJ
    // status row with NO real payment (money always wins over a stale
    // status row)? Used by Expected, Defaulters, the fee-form arrears
    // list and the matrix — every place that must treat a status-paid
    // month as settled without counting money.
    function isFamilyMonthStatusPaid(familyId, monthIdx, year, records) {
      if (window.FeePhase3 && typeof window.FeePhase3.isMonthStatusPaid === 'function') {
        return window.FeePhase3.isMonthStatusPaid(records || getStoredFeeRecords(), familyId, monthIdx, year);
      }
      const list = records || getStoredFeeRecords();
      const fam = String(familyId || '').toUpperCase();
      let hasStatus = false;
      let hasReal = false;
      (list || []).forEach(r => {
        if (!r || String(r.familyId || '').toUpperCase() !== fam) return;
        if (FEE_CONFIG.MONTHS.findIndex(m => m.toLowerCase() === String(r.month || '').toLowerCase()) !== monthIdx) return;
        if (parseInt(r.year, 10) !== parseInt(year, 10)) return;
        const st = String(r.status || '').toLowerCase();
        if (st.indexOf('cancel') !== -1) return;
        if (isFeeStatusRowRecord(r)) hasStatus = true; else hasReal = true;
      });
      return hasStatus && !hasReal;
    }

    // Fee Upgrade Phase 1: the fee in force for one family + month.
    // Returns the FeePhase1 details object ({ fee, source, nextRevision,
    // timelineMismatch }); falls back to the master fee when the Phase 1
    // module is unavailable, so the fee tab keeps working either way.
    function feeFormApplicableFeeDetails(fam, monthIdx, year) {
      const master = parseFloat((fam && fam.monthly_fee) || 0);
      const fallback = { fee: master, source: 'master', nextRevision: null, timelineMismatch: false };
      if (!fam || !window.FeePhase1 || typeof window.FeePhase1.getApplicableFeeForMonth !== 'function') return fallback;
      try {
        let famRecs = [];
        if (typeof getStoredFeeRecords === 'function') {
          const fu = String(fam.id || '').toUpperCase();
          famRecs = (getStoredFeeRecords() || []).filter(r => r && String(r.familyId || '').toUpperCase() === fu);
        }
        return window.FeePhase1.getApplicableFeeForMonth(fam, monthIdx, year, { records: famRecs });
      } catch (e) {
        return fallback;
      }
    }

    function triggerFeeBalanceRecalc() {
      const famId = document.getElementById('feeFormFamilyId').value;
      const targetMonth = document.getElementById('feeFormMonth').value;
      const targetYear = parseInt(document.getElementById('feeFormYear').value, 10);
      if (!famId) return;

      const alertBox = document.getElementById('feeArrearsAlertBox');
      const alertTitle = document.getElementById('feeArrearsAlertTitle');
      const alertDesc = document.getElementById('feeArrearsAlertDesc');

      const fam = (CACHED_FEE_FAMILIES || []).find(f => String(f.id).toUpperCase() === String(famId).toUpperCase());
      if (!fam) return;

      const records = getStoredFeeRecords().filter(r => String(r.familyId).toUpperCase() === String(famId).toUpperCase());

      // Target month index
      const targetMonthIdx = FEE_CONFIG.MONTHS.findIndex(m => m.toLowerCase() === targetMonth.toLowerCase());
      const paidByMonth = {};
      let latestRemainingBalance = 0;

      records.forEach(r => {
        if (parseInt(r.year, 10) === targetYear) {
          // Fee Upgrade Phase 3: an ADJ status row is not money — it
          // never feeds the paid-by-month totals or the last remaining
          // balance (its remainingBalance is 0, which would hide a real
          // outstanding balance if it came after the real record).
          if (isFeeStatusRowRecord(r)) return;
          const k = String(r.month).toLowerCase();
          paidByMonth[k] = (paidByMonth[k] || 0) + parseFloat(r.amountPaid || 0);
          latestRemainingBalance = parseFloat(r.remainingBalance || 0);
        }
      });

      // Calculate previous arrears
      let totalPreviousArrears = 0;
      const unpaidDetails = [];
      const overrides = getStoredMatrixOverrides();
      const fIdUpper = String(famId).toUpperCase();
      const enrollInfo = getFamilyEnrollmentInfo(fam);

      for (let m = 0; m < targetMonthIdx; m++) {
        const mName = FEE_CONFIG.MONTHS[m];
        const mKey = mName.toLowerCase();
        const overrideKey = `${fIdUpper}_${mKey}_${targetYear}`;
        const manualOverride = overrides[overrideKey];

        // Fee Dashboard + Form Improvements: a month the family picked
        // in Multi Month Payments is charged through the selector, not
        // through the arrears total — never count it twice.
        if (isMultiMonthMode() && (FEE_MULTI_MONTH_SELECTED || []).some(s => s.monthIdx === m && s.year === targetYear)) {
          continue;
        }

        // 1. Skip Pre-Admission Months (Joined in later month: ZERO expected fee & ZERO arrears)
        const isPreAdm = isFamilyPreAdmission(fam, m, targetYear);
        const isExplicitNotEnrolled = manualOverride && manualOverride.status === 'not_enrolled';
        if (isPreAdm || isExplicitNotEnrolled) {
          continue;
        }

        // Fee Upgrade Phase 3: a month settled by an ADJ status row
        // carries no arrears — it was marked Paid without a payment.
        if (isFamilyMonthStatusPaid(famId, m, targetYear, records)) {
          continue;
        }

        // 2. Check if student was on approved leave in that past month
        const leaveCheck = checkFamilyLeaveInMonth(famId, mName, targetYear);
        if (leaveCheck.isLeave || (manualOverride && manualOverride.status === 'leave')) {
          unpaidDetails.push({ month: mName, isLeave: true, reason: leaveCheck.reason || manualOverride?.notes || 'Approved Leave' });
          continue;
        }

        const applicableForMonth = feeFormApplicableFeeDetails(fam, m, targetYear).fee;
        const amtPaid = paidByMonth[mKey] || 0;
        if (amtPaid < applicableForMonth) {
          const shortfall = applicableForMonth - amtPaid;
          totalPreviousArrears += shortfall;
          unpaidDetails.push({ month: mName, isLeave: false, shortfall });
        }
      }

      const finalPreviousBalance = totalPreviousArrears;
      document.getElementById('feeFormPreviousBalance').value = finalPreviousBalance.toFixed(2);

      // Fee Upgrade Phase 1: the fee in force for the selected month
      // (timeline-aware) drives the form, the arrears above, and the
      // fee-source note below — not the master fee.
      const targetFeeDetails = feeFormApplicableFeeDetails(fam, targetMonthIdx, targetYear);
      const targetFee = targetFeeDetails.fee;
      document.getElementById('feeFormMonthlyFee').value = targetFee.toFixed(2);

      // Re-evaluate proration if active
      if (document.getElementById('feeToggleProrated')?.checked) {
        calcProratedFeeFromDays();
      } else if (document.getElementById('feeToggleAdvance')?.checked) {
        renderMultiMonthSelector();
        calcMultiMonthFee();
      }

      // Check for available advance credit (extra paid in past months)
      const availableCredit = getFamilyAvailableAdvanceCredit(famId, targetMonth, targetYear);
      const creditBox = document.getElementById('feeAdvanceCreditAlertBox');
      const creditAmtEl = document.getElementById('feeAdvanceCreditAvailableAmt');
      const creditDeductedCol = document.getElementById('feeFormCreditDeductedCol');
      const creditDeductedInput = document.getElementById('feeFormCreditDeducted');
      const applyCreditToggle = document.getElementById('feeToggleApplyAdvanceCredit');

      let creditToApply = 0;
      if (availableCredit > 0) {
        if (creditBox) creditBox.classList.remove('hidden');
        if (creditAmtEl) creditAmtEl.innerText = `${fam.currency || 'USD'} ${availableCredit.toFixed(2)}`;
        
        if (applyCreditToggle && applyCreditToggle.checked) {
          creditToApply = Math.min(availableCredit, targetFee + finalPreviousBalance);
          if (creditDeductedCol) creditDeductedCol.classList.remove('hidden');
          if (creditDeductedInput) creditDeductedInput.value = creditToApply.toFixed(2);
        } else {
          if (creditDeductedCol) creditDeductedCol.classList.add('hidden');
          if (creditDeductedInput) creditDeductedInput.value = '0.00';
        }
      } else {
        if (creditBox) creditBox.classList.add('hidden');
        if (creditDeductedCol) creditDeductedCol.classList.add('hidden');
        if (creditDeductedInput) creditDeductedInput.value = '0.00';
      }

      recalcFeeTotalLive();

      // Fee-source note (timeline mismatch / scheduled change / none).
      if (window.FeePhase1 && typeof window.FeePhase1.renderFeeSourceNote === 'function') {
        window.FeePhase1.renderFeeSourceNote(fam, targetMonthIdx, targetYear, targetFeeDetails);
      }

      // Show/hide arrears alert banner
      if (finalPreviousBalance > 0) {
        alertTitle.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Outstanding Arrears: ${fam.currency || 'USD'} ${finalPreviousBalance.toFixed(2)}`;
        const unpaidStr = unpaidDetails.filter(u => !u.isLeave).map(u => `${u.month} (${fam.currency} ${u.shortfall.toFixed(2)})`).join(', ');
        alertDesc.innerHTML = `Unpaid balance detected from past months: <strong>${unpaidStr || 'Prior balance'}</strong>. This has been added to Total Payable below.`;
        alertBox.classList.remove('hidden');
      } else {
        const leavesPast = unpaidDetails.filter(u => u.isLeave);
        if (leavesPast.length > 0) {
          alertTitle.innerHTML = `<i class="fa-solid fa-circle-check text-emerald-600"></i> Prior Dues Cleared &amp; Leaves Waived`;
          const lStr = leavesPast.map(l => `${l.month} (${l.reason})`).join(', ');
          alertDesc.innerHTML = `All previous months cleared. Prior leaves waived: <strong>${lStr}</strong>. Pre-admission months excluded.`;
          alertBox.classList.remove('hidden');
        } else if (enrollInfo.monthIndex > 0) {
          alertTitle.innerHTML = `<i class="fa-solid fa-circle-check text-emerald-600"></i> Prior Dues Cleared (Admitted: ${enrollInfo.monthName} ${enrollInfo.year})`;
          alertDesc.innerHTML = `All pre-admission months before <strong>${enrollInfo.monthName} ${enrollInfo.year}</strong> are automatically excluded ($0 fee, 0 arrears). Zero overdue balance!`;
          alertBox.classList.remove('hidden');
        } else {
          alertBox.classList.add('hidden');
        }
      }

      // Fee Dashboard + Form Improvements: the Multi Month selector
      // follows the family + month chosen in the fee form (its window
      // is anchored on the form month).
      if (isMultiMonthMode()) renderMultiMonthSelector();
    }

    function recalcFeeTotalLive() {
      const curFee = parseFloat(document.getElementById('feeFormMonthlyFee')?.value || 0);
      const prevBal = parseFloat(document.getElementById('feeFormPreviousBalance')?.value || 0);
      
      const famId = document.getElementById('feeFormFamilyId')?.value;
      const targetMonth = document.getElementById('feeFormMonth')?.value;
      const targetYear = parseInt(document.getElementById('feeFormYear')?.value || 2026, 10);
      const availableCredit = getFamilyAvailableAdvanceCredit(famId, targetMonth, targetYear);
      const applyCreditToggle = document.getElementById('feeToggleApplyAdvanceCredit');
      const creditDeductedCol = document.getElementById('feeFormCreditDeductedCol');
      const creditDeductedInput = document.getElementById('feeFormCreditDeducted');

      let creditToApply = 0;
      if (availableCredit > 0 && applyCreditToggle && applyCreditToggle.checked) {
        creditToApply = Math.min(availableCredit, curFee + prevBal);
        if (creditDeductedCol) creditDeductedCol.classList.remove('hidden');
        if (creditDeductedInput) creditDeductedInput.value = creditToApply.toFixed(2);
      } else {
        if (creditDeductedCol) creditDeductedCol.classList.add('hidden');
        if (creditDeductedInput) creditDeductedInput.value = '0.00';
      }

      const totalPayable = Math.max(0, (prevBal + curFee) - creditToApply);
      
      const totalField = document.getElementById('feeFormTotalPayable');
      if (totalField) totalField.value = totalPayable.toFixed(2);

      const amtPaidInput = document.getElementById('feeFormAmountPaid');
      if (amtPaidInput && amtPaidInput.dataset.manualEdited !== 'true') {
        amtPaidInput.value = totalPayable.toFixed(2);
      }
      calculateFeeRemainingLive();
    }

    function calculateFeeRemainingLive() {
      const totalPayable = parseFloat(document.getElementById('feeFormTotalPayable')?.value || 0);
      const amountPaid = parseFloat(document.getElementById('feeFormAmountPaid')?.value || 0);
      const discount = parseFloat(document.getElementById('feeFormDiscount')?.value || 0);
      const cur = document.getElementById('feeFormCurrency')?.value || 'USD';

      const overpayBox = document.getElementById('feeOverpaymentNoticeBox');
      const overpayAmt = document.getElementById('feeOverpaymentNoticeAmt');

      const netDue = Math.max(0, totalPayable - discount);

      if (amountPaid > netDue) {
        const excess = amountPaid - netDue;
        const remField = document.getElementById('feeFormRemainingBalance');
        if (remField) remField.value = '0.00';

        if (overpayBox && overpayAmt) {
          overpayAmt.innerText = `${cur} ${excess.toFixed(2)}`;
          overpayBox.classList.remove('hidden');
        }
      } else {
        const remaining = Math.max(0, netDue - amountPaid);
        const remField = document.getElementById('feeFormRemainingBalance');
        if (remField) remField.value = remaining.toFixed(2);

        if (overpayBox) overpayBox.classList.add('hidden');
      }
    }

    function resetFeeForm() {
      const form = document.getElementById('feeCollectionForm');
      if (form) form.reset();
      document.getElementById('feeArrearsAlertBox')?.classList.add('hidden');
      document.getElementById('feeAdvanceCreditAlertBox')?.classList.add('hidden');
      document.getElementById('feeFormCreditDeductedCol')?.classList.add('hidden');
      document.getElementById('feeOverpaymentNoticeBox')?.classList.add('hidden');
      document.getElementById('feeProrateBox')?.classList.add('hidden');
      document.getElementById('feeAdvanceBox')?.classList.add('hidden');
      document.getElementById('feeFamilySearchInput').value = '';
      document.getElementById('feeFormPreviousBalance').value = '0.00';
      document.getElementById('feeFormCreditDeducted').value = '0.00';
      document.getElementById('feeFormTotalPayable').value = '0.00';
      document.getElementById('feeFormRemainingBalance').value = '0.00';
      const amtInput = document.getElementById('feeFormAmountPaid');
      if (amtInput) {
        amtInput.value = '';
        delete amtInput.dataset.manualEdited;
      }
      // Fee Dashboard + Form Improvements: the Multi Month selection
      // belongs to the cleared family — drop it with the form.
      clearMultiMonthSelection();
      if (amtInput) amtInput.required = true;
      const leaveSubmitBtn = document.getElementById('btnSubmitFeePayment');
      if (leaveSubmitBtn) leaveSubmitBtn.innerHTML = '<i class="fa-solid fa-file-invoice"></i> Save Payment &amp; Generate Official Invoice';
    }

    // Proration Toggle & Calculator
    function handleProrateFeeToggle() {
      const isChecked = document.getElementById('feeToggleProrated').checked;
      const box = document.getElementById('feeProrateBox');
      if (!box) return;

      if (isChecked) {
        box.classList.remove('hidden');
        // Uncheck advance toggle if active
        const advToggle = document.getElementById('feeToggleAdvance');
        if (advToggle) {
          advToggle.checked = false;
          document.getElementById('feeAdvanceBox')?.classList.add('hidden');
        }
        clearMultiMonthSelection();

        const m = document.getElementById('feeFormMonth').value;
        const y = parseInt(document.getElementById('feeFormYear').value, 10);
        const mIdx = FEE_CONFIG.MONTHS.findIndex(item => item.toLowerCase() === m.toLowerCase());
        const totalDays = new Date(y, mIdx + 1, 0).getDate();
        document.getElementById('feeProrateTotalDays').value = totalDays;

        const mNum = ("0" + (mIdx + 1)).slice(-2);
        document.getElementById('feeProrateStartDate').value = `${y}-${mNum}-08`;
        document.getElementById('feeProrateActiveDays').value = 22;
        calcProratedFeeFromDays();
      } else {
        box.classList.add('hidden');
        triggerFeeBalanceRecalc();
      }
    }

    function calcProratedFeeFromDate() {
      const dateStr = document.getElementById('feeProrateStartDate').value;
      if (!dateStr) return;
      const d = new Date(dateStr);
      const day = d.getDate();
      const m = document.getElementById('feeFormMonth').value;
      const y = parseInt(document.getElementById('feeFormYear').value, 10);
      const mIdx = FEE_CONFIG.MONTHS.findIndex(item => item.toLowerCase() === m.toLowerCase());
      const totalDays = new Date(y, mIdx + 1, 0).getDate();
      document.getElementById('feeProrateTotalDays').value = totalDays;

      let activeDays = totalDays - day + 1;
      if (activeDays < 1) activeDays = 1;
      document.getElementById('feeProrateActiveDays').value = activeDays;
      calcProratedFeeFromDays();
    }

    function calcProratedFeeFromDays() {
      const activeDays = parseInt(document.getElementById('feeProrateActiveDays')?.value, 10) || 0;
      const totalDays = parseInt(document.getElementById('feeProrateTotalDays')?.value, 10) || 30;

      const famId = document.getElementById('feeFormFamilyId').value;
      const fam = (CACHED_FEE_FAMILIES || []).find(f => String(f.id).toUpperCase() === String(famId).toUpperCase());
      const prMonthIdx = FEE_CONFIG.MONTHS.findIndex(m => m.toLowerCase() === String(document.getElementById('feeFormMonth')?.value || '').toLowerCase());
      const prYear = parseInt(document.getElementById('feeFormYear')?.value || new Date().getFullYear(), 10);
      const standardFee = feeFormApplicableFeeDetails(fam, prMonthIdx < 0 ? new Date().getMonth() : prMonthIdx, prYear).fee;

      const prorated = totalDays > 0 ? Math.round((standardFee / totalDays) * activeDays) : standardFee;
      const calcField = document.getElementById('feeProrateCalcAmount');
      if (calcField) calcField.value = prorated.toFixed(2);
    }

    function applyProratedFeeToForm() {
      const prorated = parseFloat(document.getElementById('feeProrateCalcAmount')?.value || 0);
      if (prorated <= 0) return;
      document.getElementById('feeFormMonthlyFee').value = prorated.toFixed(2);
      recalcFeeTotalLive();
      lmsNotify(`Prorated fee of ${prorated.toFixed(2)} applied for ${document.getElementById('feeProrateActiveDays').value} active days!`);
    }

    // Advance Payment Toggle & Calculator
    // ---- Multi Month Payments (Fee Dashboard + Form Improvements) ----
    // Replaces the old fixed 2/3/4/5/6/12-month "Multi-Month Advance
    // Payment" dropdown. The family picks individual months (previous,
    // current or future, non-consecutive) and each month is charged its
    // ACTUAL applicable fee — never fee x N. The save reuses the
    // existing per-month record creation + receipt shape.
    function isMultiMonthMode() {
      const t = document.getElementById('feeToggleAdvance');
      return !!(t && t.checked);
    }

    function multiMonthFormAnchor() {
      const mSel = document.getElementById('feeFormMonth');
      const ySel = document.getElementById('feeFormYear');
      const mName = mSel ? mSel.value : '';
      const mIdx = FEE_CONFIG.MONTHS.findIndex(m => m.toLowerCase() === String(mName).toLowerCase());
      return { monthIdx: mIdx >= 0 ? mIdx : new Date().getMonth(), year: ySel ? parseInt(ySel.value, 10) : new Date().getFullYear() };
    }

    function getMultiMonthSelection() {
      return (FEE_MULTI_MONTH_SELECTED || []).slice().sort((a, b) => (a.year * 100 + a.monthIdx) - (b.year * 100 + b.monthIdx));
    }

    function clearMultiMonthSelection() {
      FEE_MULTI_MONTH_SELECTED = [];
      const grid = document.getElementById('feeMultiMonthGrid');
      if (grid) grid.innerHTML = '';
      const rev = document.getElementById('feeMultiMonthReview');
      if (rev) rev.innerText = 'No months selected yet — pick months above.';
      const tot = document.getElementById('feeMultiMonthTotal');
      if (tot) tot.innerText = '';
    }

    function buildMultiMonthOptionsForForm() {
      const famId = document.getElementById('feeFormFamilyId') ? document.getElementById('feeFormFamilyId').value : '';
      const fam = (CACHED_FEE_FAMILIES || []).find(f => String(f.id).toUpperCase() === String(famId || '').toUpperCase()) || null;
      if (!window.FeePhase6) return [];
      // No family picked yet: the months still build (fees unknown,
      // shown as a dash) so the toggle never shows an empty box. The
      // family-dependent lookups below all guard on fam.
      const anchor = multiMonthFormAnchor();
      const records = (typeof getStoredFeeRecords === 'function') ? getStoredFeeRecords() : [];
      const overrides = (typeof getStoredMatrixOverrides === 'function') ? getStoredMatrixOverrides() : {};
      return window.FeePhase6.buildMultiMonthOptions({
        fam: fam,
        records: records,
        overrides: overrides,
        anchorMonthIdx: anchor.monthIdx,
        anchorYear: anchor.year,
        enrollment: (fam && typeof getFamilyEnrollmentInfo === 'function') ? getFamilyEnrollmentInfo(fam) : null,
        isLeaveMonth: function (mIdx, yr) {
          if (!fam) return false;
          try { return !!(typeof checkFamilyLeaveInMonth === 'function' && checkFamilyLeaveInMonth(fam.id, FEE_CONFIG.MONTHS[mIdx], yr).isLeave); } catch (e) { return false; }
        },
        applicableFee: function (mIdx, yr) {
          if (!fam) return null;
          try { return feeFormApplicableFeeDetails(fam, mIdx, yr).fee; } catch (e) { return parseFloat(fam.monthly_fee || 0); }
        }
      });
    }

    function renderMultiMonthSelector() {
      const box = document.getElementById('feeAdvanceBox');
      if (!box || box.classList.contains('hidden')) return;
      const grid = document.getElementById('feeMultiMonthGrid');
      if (!grid) return;
      const options = buildMultiMonthOptionsForForm();
      const selectedKeys = {};
      getMultiMonthSelection().forEach(function (s) { selectedKeys[s.monthIdx + '-' + s.year] = true; });
      const cur = document.getElementById('feeFormCurrency') ? document.getElementById('feeFormCurrency').value : 'USD';
      grid.innerHTML = options.map(function (o) {
        const sel = !!selectedKeys[o.monthIdx + '-' + o.year];
        const disabled = o.state === 'not_enrolled' || o.state === 'leave' || o.state === 'no_fee';
        let badge = '';
        if (o.state === 'paid') badge = '<span class="px-1.5 py-0.5 rounded-full text-[9px] font-black bg-emerald-600 text-white">Paid</span>';
        else if (o.state === 'leave') badge = '<span class="px-1.5 py-0.5 rounded-full text-[9px] font-black bg-blue-100 text-blue-800 border border-blue-200">Leave</span>';
        else if (o.state === 'not_enrolled') badge = '<span class="px-1.5 py-0.5 rounded-full text-[9px] font-black bg-slate-100 text-slate-500 border border-slate-200">Not enrolled</span>';
        else if (o.state === 'no_fee') badge = '<span class="px-1.5 py-0.5 rounded-full text-[9px] font-black bg-slate-100 text-slate-500 border border-slate-200">No fee</span>';
        const stateCls = sel
          ? 'border-emerald-600 bg-emerald-50 ring-2 ring-emerald-500'
          : (disabled ? 'border-slate-200 bg-slate-50 opacity-60 cursor-not-allowed' : 'border-blue-200 bg-white hover:border-blue-400 hover:shadow-sm');
        const title = disabled ? o.reason : (o.state === 'paid' ? 'Already paid — click to include as a second payment (you will be asked first)' : 'Click to ' + (sel ? 'remove ' : 'add ') + o.label);
        return '<button type="button" ' + (disabled ? 'disabled ' : '') + 'onclick="toggleMultiMonthSelection(' + o.monthIdx + ', ' + o.year + ')" title="' + title + '" class="fee-mm-box p-2 rounded-xl border text-left transition focus:outline-none focus:ring-2 focus:ring-emerald-500 ' + stateCls + '">' +
          '<span class="block text-[11px] font-extrabold text-slate-800">' + o.label + '</span>' +
          '<span class="block text-[11px] font-bold text-slate-600 font-num mt-0.5">' + (o.fee === null || o.fee === undefined ? '—' : cur + ' ' + o.fee.toFixed(2) + (o.paidSoFar > 0 ? ' <span class="text-emerald-700">(paid ' + o.paidSoFar.toFixed(2) + ')</span>' : '')) + '</span>' +
          '<span class="block mt-1">' + (sel ? '<span class="px-1.5 py-0.5 rounded-full text-[9px] font-black bg-emerald-600 text-white">Selected</span> ' : '') + badge + '</span>' +
          '</button>';
      }).join('');
      syncMultiMonthReview();
    }

    function syncMultiMonthReview() {
      const rev = document.getElementById('feeMultiMonthReview');
      const tot = document.getElementById('feeMultiMonthTotal');
      if (!rev && !tot) return;
      const options = buildMultiMonthOptionsForForm();
      const byKey = {};
      options.forEach(function (o) { byKey[o.monthIdx + '-' + o.year] = o; });
      const sel = getMultiMonthSelection().map(function (s) { return byKey[s.monthIdx + '-' + s.year]; }).filter(Boolean);
      if (!window.FeePhase6 || sel.length === 0) {
        if (rev) rev.innerText = 'No months selected yet — pick months above.';
        if (tot) tot.innerText = '';
        return;
      }
      const calc = window.FeePhase6.multiMonthSelectionTotal(sel);
      const cur = document.getElementById('feeFormCurrency') ? document.getElementById('feeFormCurrency').value : 'USD';
      const feesUnknown = calc.rows.some(function (r) { return r.fee === null || r.fee === undefined; });
      if (rev) {
        rev.innerText = feesUnknown
          ? calc.rows.map(function (r) { return r.label; }).join(', ') + ' — select a family above to see each month\u2019s fee.'
          : calc.rows.map(function (r) {
              return r.label + ' (' + cur + ' ' + r.charge.toFixed(2) + (r.state === 'paid' ? ' — second payment' : '') + ')';
            }).join(', ');
      }
      if (tot) tot.innerText = feesUnknown ? 'Select a family above to see the total.' : 'Total for selected months: ' + cur + ' ' + calc.total.toFixed(2);
    }

    async function toggleMultiMonthSelection(monthIdx, year) {
      const options = buildMultiMonthOptionsForForm();
      const opt = options.find(function (o) { return o.monthIdx === monthIdx && o.year === year; });
      if (!opt) return;
      if (opt.state === 'not_enrolled' || opt.state === 'leave' || opt.state === 'no_fee') return;
      const key = monthIdx + '-' + year;
      const existing = (FEE_MULTI_MONTH_SELECTED || []).findIndex(function (s) { return (s.monthIdx + '-' + s.year) === key; });
      if (existing >= 0) {
        FEE_MULTI_MONTH_SELECTED.splice(existing, 1);
      } else {
        if (opt.state === 'paid') {
          // Batch 3A warn-and-ask, at selection time: an already-paid
          // month is only included as a deliberate second payment.
          const cur = document.getElementById('feeFormCurrency') ? document.getElementById('feeFormCurrency').value : '';
          const proceed = await lmsConfirm({
            title: 'Month Already Paid',
            message: opt.label + ' is already settled for this family' + (opt.paidSoFar > 0 ? ' (' + cur + ' ' + opt.paidSoFar.toFixed(2) + ' paid)' : '') + '.\n\nIncluding it will record a SECOND payment for the same month. The original record is never overwritten.\n\nInclude ' + opt.label + ' anyway?',
            confirmText: 'Include Anyway',
            cancelText: 'Keep Unselected',
            variant: 'warning'
          });
          if (!proceed) return;
        }
        FEE_MULTI_MONTH_SELECTED.push({ monthIdx: monthIdx, year: year });
      }
      // Recompute arrears (a newly selected past month leaves the
      // previous-balance total) and the multi-month total.
      // Re-render directly too: without a family picked yet,
      // triggerFeeBalanceRecalc returns early and would leave the
      // clicked box + review unchanged.
      renderMultiMonthSelector();
      triggerFeeBalanceRecalc();
    }

    function calcMultiMonthFee() {
      const options = buildMultiMonthOptionsForForm();
      const byKey = {};
      options.forEach(function (o) { byKey[o.monthIdx + '-' + o.year] = o; });
      const sel = getMultiMonthSelection().map(function (s) { return byKey[s.monthIdx + '-' + s.year]; }).filter(Boolean);
      const total = (window.FeePhase6 && sel.length)
        ? window.FeePhase6.multiMonthSelectionTotal(sel).total
        : 0;
      const feeField = document.getElementById('feeFormMonthlyFee');
      if (feeField) feeField.value = total.toFixed(2);
      recalcFeeTotalLive();
    }

    function handleAdvanceFeeToggle() {
      const isChecked = document.getElementById('feeToggleAdvance').checked;
      const box = document.getElementById('feeAdvanceBox');
      if (!box) return;

      if (isChecked) {
        box.classList.remove('hidden');
        // Uncheck prorate toggle if active
        const progToggle = document.getElementById('feeToggleProrated');
        if (progToggle) {
          progToggle.checked = false;
          document.getElementById('feeProrateBox')?.classList.add('hidden');
        }
        renderMultiMonthSelector();
        triggerFeeBalanceRecalc();
      } else {
        box.classList.add('hidden');
        clearMultiMonthSelection();
        triggerFeeBalanceRecalc();
      }
    }

    // Submit Payment & Save Record
    async function handleFeePaymentSubmit(e) {
      e.preventDefault();
      const famId = document.getElementById('feeFormFamilyId').value;
      if (!famId) {
        lmsNotify("Please search and select a family account first.");
        return;
      }

      // Batch 3A (B15): warn — never hard-block — when a fee record for
      // this family and month already exists. A second payment in one
      // month can be legitimate; the user decides. Advance payments
      // check every month they will cover. Cancelled records (Batch 2)
      // do not count.
      {
        const existingRecords = getStoredFeeRecords();
        const formMonth = document.getElementById('feeFormMonth').value;
        const formYear = parseInt(document.getElementById('feeFormYear').value, 10);
        const advOn = document.getElementById('feeToggleAdvance')?.checked || false;
        // Fee Dashboard + Form Improvements: in Multi Month mode the
        // check covers the SELECTED months (not N consecutive months
        // from the form month). A paid month was already confirmed at
        // selection time; this is the backstop for anything recorded
        // since (for example in another tab).
        const dupMonths = advOn
          ? getMultiMonthSelection().map(s => ({ month: FEE_CONFIG.MONTHS[s.monthIdx], year: s.year }))
          : [{ month: formMonth, year: formYear }];
        let dupHit = null;
        for (let i = 0; i < dupMonths.length && !dupHit; i++) {
          dupHit = findFeeMonthDuplicate(existingRecords, famId, dupMonths[i].month, dupMonths[i].year);
        }
        if (dupHit) {
          const proceed = await lmsConfirm({
                title: 'Possible Duplicate Fee Record',
                message: `A fee record for this family already exists for ${dupHit.month} ${dupHit.year} (Receipt ${dupHit.receiptNo}, status: ${dupHit.status}).\n\nIf this is a separate payment, choose "Save Anyway". Otherwise choose "Cancel" and check the Fee Ledger first.`,
                confirmText: 'Save Anyway',
                cancelText: 'Cancel',
                variant: 'warning'
              })
          if (!proceed) return;
        }
      }

      // Fee Dashboard + Form Improvements: Multi Month Payments with
      // no month picked has a 0.00 fee — never save an empty payment.
      if (document.getElementById('feeToggleAdvance')?.checked && getMultiMonthSelection().length === 0) {
        lmsNotify('Select at least one month in Multi Month Payments first.');
        return;
      }

      const btn = document.getElementById('btnSubmitFeePayment');
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Saving Payment...';
      }

      const todayStr = new Date().toISOString().slice(0, 10);
      const records = getStoredFeeRecords();
      // Batch 3A (B9): collision-proof receipt number (date + random
      // suffix) — no longer derived from the record count, so deletions
      // and parallel browsers cannot mint the same number twice.
      const receiptNo = generateReceiptNo();

      const totalPayable = parseFloat(document.getElementById('feeFormTotalPayable').value || 0);
      const amountPaid = parseFloat(document.getElementById('feeFormAmountPaid').value || 0);
      const discount = parseFloat(document.getElementById('feeFormDiscount').value || 0);
      const remaining = parseFloat(document.getElementById('feeFormRemainingBalance').value || 0);
      const creditDeducted = parseFloat(document.getElementById('feeFormCreditDeducted')?.value || 0);

      const netDue = Math.max(0, totalPayable - discount);
      const excessPaid = amountPaid > netDue ? (amountPaid - netDue) : 0;

      const isProrated = document.getElementById('feeToggleProrated')?.checked || false;
      const isAdvance = document.getElementById('feeToggleAdvance')?.checked || false;
      const multiMonths = isAdvance ? getMultiMonthSelection() : [];
      const advanceCount = isAdvance ? multiMonths.length : 1;

      const paymentRecord = {
        receiptNo,
        date: todayStr,
        familyId: famId,
        parentName: document.getElementById('feeFormParentName').value,
        studentsNames: document.getElementById('feeFormStudentsNames').value,
        country: document.getElementById('feeFormCountry').value,
        whatsapp: document.getElementById('feeFormWhatsApp').value,
        email: document.getElementById('feeFormParentEmail').value,
        month: document.getElementById('feeFormMonth').value,
        year: parseInt(document.getElementById('feeFormYear').value, 10),
        monthlyFee: parseFloat(document.getElementById('feeFormMonthlyFee').value || 0),
        previousBalance: parseFloat(document.getElementById('feeFormPreviousBalance').value || 0),
        creditDeducted,
        totalPayable,
        amountPaid,
        discount,
        remainingBalance: remaining,
        excessPaid,
        currency: document.getElementById('feeFormCurrency').value,
        paymentMethod: document.getElementById('feeFormPaymentMethod').value,
        transactionId: document.getElementById('feeFormTxnId').value || 'N/A',
        notes: document.getElementById('feeFormNotes').value || '',
        status: remaining > 0 ? 'Partial (Balance Remaining)' : (excessPaid > 0 ? 'Paid in Full (Advance Credit)' : 'Paid in Full'),
        isProrated,
        activeDays: isProrated ? parseInt(document.getElementById('feeProrateActiveDays').value, 10) : 0,
        joiningDate: isProrated ? document.getElementById('feeProrateStartDate').value : '',
        isAdvancePayment: isAdvance,
        advanceMonthsCount: advanceCount
      };

      // Handle Multi Month Payments sequence records in storage
      // (Fee Dashboard + Form Improvements): each selected month gets
      // its own record at its ACTUAL applicable fee, with the amount
      // paid spread chronologically (earliest month first). The first
      // record carries the previous balance / credit / discount /
      // form totals, exactly like the old advance sequence did. A
      // single selected month saves as one plain record for that
      // month. Same record shape + receipt numbering as before.
      const addedBatch = [];
      if (isAdvance && multiMonths.length > 0) {
        const mmOptions = buildMultiMonthOptionsForForm();
        const mmByKey = {};
        mmOptions.forEach(o => { mmByKey[o.monthIdx + '-' + o.year] = o; });
        const mmSelected = multiMonths.map(s => mmByKey[s.monthIdx + '-' + s.year]).filter(Boolean);
        const mmAllocation = (window.FeePhase6 && typeof window.FeePhase6.allocateMultiMonthPayment === 'function')
          ? window.FeePhase6.allocateMultiMonthPayment(mmSelected, amountPaid)
          : [];
        const mmSequence = (window.FeePhase6 && typeof window.FeePhase6.buildMultiMonthSequence === 'function')
          ? window.FeePhase6.buildMultiMonthSequence(paymentRecord, mmSelected, mmAllocation)
          : [];
        mmSequence.forEach(rec => { records.unshift(rec); addedBatch.push(rec); });
        if (addedBatch.length === 0) {
          records.unshift(paymentRecord);
          addedBatch.push(paymentRecord);
        }
      } else {
        records.unshift(paymentRecord);
        addedBatch.push(paymentRecord);
      }

      saveStoredFeeRecords(records);

      // Batch 3.5 (audit P2-16): the cloud sync used to run unawaited
      // while the invoice modal and success toast already showed — so
      // a failed sync left the receipt only in this browser, silently.
      // The sync is now awaited BEFORE any success claim. On failure
      // the local receipt is marked unsynced (the Sync button retries
      // it), a persistent error toast says so plainly, and no success
      // toast shows. The invoice modal still opens: it renders the
      // LOCAL receipt the parent needs, and the error toast states it
      // is local-only. Auto-send still runs (it has its own P2-17 fix).
      const syncResult = await syncPaymentRecordsBatchToCloud(paymentRecord.familyId, addedBatch);

      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-file-invoice"></i> Save Payment &amp; Generate Official Invoice';
      }

      if (!syncResult || !syncResult.ok) {
        addedBatch.forEach(rec => { rec.cloudSyncPending = true; });
        saveStoredFeeRecords(records);
        lmsNotify('Fee saved on this device, but cloud sync failed — this receipt is marked unsynced. Use Sync to retry sending it to the cloud.', { type: 'error' });
      }

      // Fee Upgrade Phase 4 (#19): remember this family's payment
      // method on this device for the next fee form.
      rememberPaymentMethodForFamily(famId, paymentRecord.paymentMethod);

      // Open Official Printable Receipt Modal — for Multi Month
      // Payments the first sequence record (earliest selected month),
      // which carries the form totals.
      openFeeInvoiceModal((isAdvance && addedBatch.length > 0) ? addedBatch[0] : paymentRecord);

      // Auto-send official invoice email to parent & academy if toggle is checked
      const autoSendEmail = document.getElementById('feeToggleAutoSendEmail')?.checked;
      if (autoSendEmail && (paymentRecord.email || paymentRecord.parentEmail)) {
        sendFeeInvoiceEmailModal(paymentRecord, true);
      }

      // Refresh Overview, Defaulters and Matrix
      await loadFeeDashboardStats();
      resetFeeForm();
      if (syncResult && syncResult.ok) lmsNotify("Fee payment recorded successfully!");
    }

    // ============================================================
    // 3. OFFICIAL INVOICE RECEIPT MODAL & ACTIONS
    // ============================================================
    function openFeeInvoiceModal(r) {
      CURRENT_FEE_MODAL_RECEIPT = r;

      document.getElementById('feeInvReceiptNo').innerText = r.receiptNo || 'Not issued';
      document.getElementById('feeInvParentName').innerText = r.parentName || '--';
      document.getElementById('feeInvFamilyId').innerText = r.familyId || '--';
      document.getElementById('feeInvStudentsNames').innerText = r.studentsNames || '--';
      document.getElementById('feeInvIssueDate').innerText = r.date || new Date().toISOString().slice(0, 10);
      document.getElementById('feeInvPeriod').innerText = `${r.month} ${r.year}`;

      const emailEl = document.getElementById('feeInvParentEmail');
      if (emailEl) emailEl.innerText = (CURRENT_ROLE === 'manager') ? maskStudentEmail(r.email || r.parentEmail || '') : (r.email || r.parentEmail || '--');

      const phoneEl = document.getElementById('feeInvWhatsAppNo');
      if (phoneEl) phoneEl.innerText = (CURRENT_ROLE === 'manager') ? maskStudentPhone(r.whatsapp || '') : (r.whatsapp || '--');

      const cur = r.currency || 'USD';
      document.getElementById('feeInvCurrentDue').innerText = `${cur} ${parseFloat(r.monthlyFee || 0).toFixed(2)}`;

      const descEl = document.getElementById('feeInvDescription');
      if (r.isMultiMonthPayment && r.advanceMonthsCount > 1) {
        descEl.innerHTML = `Multi-Month Tuition Fee (${r.advanceMonthsCount} Months)`;
      } else if (r.isAdvancePayment && r.advanceMonthsCount > 1) {
        descEl.innerHTML = `Advance Tuition Fee (${r.advanceMonthsCount} Months Pre-Paid)`;
      } else if (r.isProrated) {
        descEl.innerHTML = `Tuition Fee (Mid-Month Admission: ${r.activeDays} Days Active)`;
      } else {
        descEl.innerText = 'Current Month Tuition Fee';
      }

      const prevRow = document.getElementById('feeInvPrevBalanceRow');
      const prevBal = parseFloat(r.previousBalance || 0);
      if (prevBal > 0) {
        prevRow.classList.remove('hidden');
        document.getElementById('feeInvPrevBalanceAmt').innerText = `${cur} ${prevBal.toFixed(2)}`;
      } else {
        prevRow.classList.add('hidden');
      }

      const credRow = document.getElementById('feeInvAdvanceCreditDeductedRow');
      const credAmt = parseFloat(r.creditDeducted || 0);
      if (credRow) {
        if (credAmt > 0) {
          credRow.classList.remove('hidden');
          document.getElementById('feeInvAdvanceCreditDeductedAmt').innerText = `- ${cur} ${credAmt.toFixed(2)}`;
        } else {
          credRow.classList.add('hidden');
        }
      }

      document.getElementById('feeInvGrossTotal').innerText = `${cur} ${parseFloat(r.totalPayable || 0).toFixed(2)}`;
      document.getElementById('feeInvTotalPaid').innerText = `${cur} ${parseFloat(r.amountPaid || 0).toFixed(2)}`;
      document.getElementById('feeInvPaymentMethod').innerText = r.paymentMethod || 'Online';

      const discRow = document.getElementById('feeInvDiscountRow');
      const discount = parseFloat(r.discount || 0);
      if (discount > 0) {
        discRow.classList.remove('hidden');
        document.getElementById('feeInvDiscountAmt').innerText = `- ${cur} ${discount.toFixed(2)}`;
      } else {
        discRow.classList.add('hidden');
      }

      const remaining = parseFloat(r.remainingBalance || 0);
      const carryBox = document.getElementById('feeInvCarryForwardBox');
      const stamp = document.getElementById('feeInvStatusStamp');

      if (remaining > 0) {
        carryBox.classList.remove('hidden');
        document.getElementById('feeInvCarryForwardAmt').innerText = `${cur} ${remaining.toFixed(2)}`;
        stamp.className = "inline-block px-3 py-1 rounded-md text-[11px] font-black border-2 border-amber-600 bg-amber-50 text-amber-800 tracking-wider";
        stamp.innerText = "PARTIAL PAYMENT (BALANCE PENDING)";
      } else {
        carryBox.classList.add('hidden');
        stamp.className = "inline-block px-3 py-1 rounded-md text-[11px] font-black border-2 border-emerald-600 bg-emerald-50 text-emerald-800 tracking-wider";
        stamp.innerText = "PAID IN FULL (ALL DUES CLEARED)";
      }

      const excessBox = document.getElementById('feeInvAdvanceCreditCarriedBox');
      const excessAmt = parseFloat(r.excessPaid || 0);
      if (excessBox) {
        if (excessAmt > 0) {
          excessBox.classList.remove('hidden');
          document.getElementById('feeInvAdvanceCreditCarriedAmt').innerText = `+ ${cur} ${excessAmt.toFixed(2)}`;
        } else {
          excessBox.classList.add('hidden');
        }
      }

      // Format WhatsApp Message link — Fee Upgrade Phase 4 (#42): the
      // message text now comes from the tested builder in js/fee-phase4.js
      // (identical text; the receipt carries no PDF link — LMS PDFs are
      // client-side and never stored).
      const cleanPhone = (r.whatsapp || '').replace(/[^0-9]/g, '');
      const waMsg = (window.FeePhase4 && typeof window.FeePhase4.buildReceiptWhatsAppMessage === 'function')
        ? window.FeePhase4.buildReceiptWhatsAppMessage(r, { academyName: academyName(), creditAmt: credAmt, excessAmt: excessAmt, remaining: remaining })
        : `Assalam-o-Alaikum Respected ${r.parentName},\n\nFee Receipt ${r.receiptNo} — ${cur} ${parseFloat(r.amountPaid || 0).toFixed(2)} for ${r.month} ${r.year}.`;
      const waBtn = document.getElementById('feeInvWhatsAppBtn');
      if (waBtn) {
        if (CURRENT_ROLE === 'manager') {
          waBtn.style.display = 'none';
        } else {
          waBtn.style.display = 'inline-flex';
          waBtn.href = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(waMsg)}`;
        }
      }

      openModal('modalFeeInvoice');
    }

    // 1-Click Client-Side High-Res PDF Download (Direct html2canvas + jsPDF with multi-engine fallback)
    async function downloadFeeInvoicePDF() {
      const r = CURRENT_FEE_MODAL_RECEIPT;
      if (!r) {
        lmsNotify("No active invoice receipt selected.");
        return;
      }

      const sourceCard = document.getElementById('feeInvoiceReceiptCard') || document.querySelector('#feeInvoicePrintArea > div') || document.getElementById('feeInvoicePrintArea');
      if (!sourceCard) return;

      const btn = document.getElementById('feeInvBtnDownloadPdf');
      const originalText = btn ? btn.innerHTML : '';
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Generating PDF...';
      }

      // Keep track of temporary sandbox DOM element
      let sandbox = null;

      try {
        const cleanParent = (r.parentName || 'Family').replace(/[^a-zA-Z0-9_-]/g, '_');
        const filename = `AlHuda-Invoice-${r.receiptNo || 'AH-REC'}-${cleanParent}.pdf`;

        // Reset scroll position on invoice scroll area
        const scrollArea = document.getElementById('feeInvoicePrintArea');
        if (scrollArea) scrollArea.scrollTop = 0;

        // Build clean dedicated A4 sandbox container (794px width at 96 DPI = 210mm A4 width)
        sandbox = document.createElement('div');
        sandbox.id = 'cleanInvoicePdfSandbox';
        sandbox.style.position = 'fixed';
        sandbox.style.top = '0';
        sandbox.style.left = '0';
        sandbox.style.width = '794px';
        sandbox.style.minHeight = '1050px';
        sandbox.style.backgroundColor = '#ffffff';
        sandbox.style.zIndex = '-100'; // Rendered in DOM tree behind view, 100% visible to html2canvas
        sandbox.style.overflow = 'visible';
        sandbox.style.boxSizing = 'border-box';
        sandbox.style.padding = '16px';

        // Deep clone the invoice card
        const cardClone = sourceCard.cloneNode(true);
        cardClone.style.width = '100%';
        cardClone.style.maxWidth = '100%';
        cardClone.style.margin = '0';
        cardClone.style.boxShadow = 'none';
        cardClone.style.backgroundColor = '#ffffff';

        // Ensure logo image is rendered and complete
        const cloneLogo = cardClone.querySelector('#feeInvLogoImg') || cardClone.querySelector('img');
        const origLogo = sourceCard.querySelector('#feeInvLogoImg') || sourceCard.querySelector('img');
        if (cloneLogo && origLogo) {
          cloneLogo.crossOrigin = 'anonymous';
          if (origLogo.complete && origLogo.naturalWidth > 0) {
            cloneLogo.src = origLogo.src;
          }
        }

        sandbox.appendChild(cardClone);
        document.body.appendChild(sandbox);

        // Give browser 120ms to compute layout and geometry
        await new Promise(resolve => setTimeout(resolve, 120));

        let pdfGenerated = false;

        // METHOD 1: Direct html2canvas + jsPDF (Single-Page Fit, Zero Blank Page Bug)
        const hasHtml2Canvas = typeof html2canvas !== 'undefined';
        const hasJsPDF = typeof window.jspdf !== 'undefined' && window.jspdf.jsPDF;

        if (hasHtml2Canvas && hasJsPDF) {
          try {
            const canvas = await html2canvas(cardClone, {
              scale: 2, // 2x resolution for crisp high-density print
              useCORS: true,
              allowTaint: true,
              scrollY: 0,
              scrollX: 0,
              backgroundColor: '#ffffff',
              logging: false,
              windowWidth: 794
            });

            if (canvas && canvas.width > 0 && canvas.height > 0) {
              const imgData = canvas.toDataURL('image/jpeg', 0.98);
              const { jsPDF } = window.jspdf;
              const pdf = new jsPDF({
                orientation: 'portrait',
                unit: 'mm',
                format: 'a4',
                compress: true
              });

              const pageWidth = pdf.internal.pageSize.getWidth(); // 210mm
              const pageHeight = pdf.internal.pageSize.getHeight(); // 297mm
              const margin = 8; // 8mm margins
              const maxContentWidth = pageWidth - (margin * 2); // 194mm
              const maxContentHeight = pageHeight - (margin * 2); // 281mm

              let renderWidth = maxContentWidth;
              let renderHeight = (canvas.height * renderWidth) / canvas.width;

              // Scale down proportionally if content exceeds 1 printable A4 page
              if (renderHeight > maxContentHeight) {
                const ratio = maxContentHeight / renderHeight;
                renderHeight = maxContentHeight;
                renderWidth = renderWidth * ratio;
              }

              // Center horizontally
              const xPos = margin + ((maxContentWidth - renderWidth) / 2);
              const yPos = margin;

              pdf.addImage(imgData, 'JPEG', xPos, yPos, renderWidth, renderHeight, undefined, 'FAST');
              pdf.save(filename);
              pdfGenerated = true;
              // Fee Upgrade Phase 5: the generated bytes are ALSO stored
              // in R2 (same receipt, same key — re-download overwrites).
              // A failed upload never blocks the local download: the
              // record is marked pdfPending and retries on next download.
              let pdfBytes = null;
              try { pdfBytes = pdf.output('arraybuffer'); } catch (e) { pdfBytes = null; }
              if (pdfBytes) {
                const stored = await storeFeePdfForReceipt(r, pdfBytes);
                lmsNotify(stored.ok
                  ? "✅ Official Invoice PDF downloaded and saved to cloud."
                  : "✅ Official Invoice PDF downloaded. Cloud save did not complete — download again to retry.");
              } else {
                lmsNotify("✅ Official Invoice PDF downloaded successfully!");
              }
            }
          } catch (canvasErr) {
            console.warn("[Invoice PDF] html2canvas+jsPDF direct render notice:", canvasErr);
          }
        }

        // METHOD 2: html2pdf fallback (with explicit scrollY: 0 & avoid-all pagebreak)
        if (!pdfGenerated && typeof html2pdf !== 'undefined') {
          const opt = {
            margin: [8, 8, 8, 8],
            filename: filename,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: {
              scale: 2,
              useCORS: true,
              allowTaint: true,
              scrollY: 0,
              scrollX: 0,
              backgroundColor: '#ffffff',
              logging: false,
              windowWidth: 794
            },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
            pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
          };

          // Fee Upgrade Phase 5: prefer outputPdf so the same bytes can
          // be downloaded AND stored in R2. If outputPdf is unavailable
          // in this html2pdf build, fall back to its own save() (local
          // download only — the cloud copy retries on the next download).
          let pdfBytes2 = null;
          try {
            pdfBytes2 = await html2pdf().set(opt).from(cardClone).outputPdf('arraybuffer');
          } catch (e) { pdfBytes2 = null; }
          if (pdfBytes2) {
            const blob = new Blob([pdfBytes2], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            const stored = await storeFeePdfForReceipt(r, pdfBytes2);
            lmsNotify(stored.ok
              ? "✅ Official Invoice PDF downloaded and saved to cloud."
              : "✅ Official Invoice PDF downloaded. Cloud save did not complete — download again to retry.");
          } else {
            await html2pdf().set(opt).from(cardClone).save();
            lmsNotify("✅ Official Invoice PDF downloaded successfully!");
          }
          pdfGenerated = true;
        }

        // METHOD 3: Fallback to pristine print preview if canvas libraries fail
        if (!pdfGenerated) {
          printFeeInvoiceReceipt();
        }

      } catch (err) {
        console.error("[Invoice PDF] Generation failed:", err);
        lmsNotify("Opening print preview for PDF saving...");
        printFeeInvoiceReceipt();
      } finally {
        if (sandbox && sandbox.parentNode) {
          sandbox.parentNode.removeChild(sandbox);
        }
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = originalText;
        }
      }
    }

    // Clean Isolated Printing & Trigger Email Integration
    function printFeeInvoiceReceipt() {
      const card = document.getElementById('feeInvoiceReceiptCard') || document.querySelector('#feeInvoicePrintArea > div') || document.getElementById('feeInvoicePrintArea');
      if (!card) return;

      const r = CURRENT_FEE_MODAL_RECEIPT;
      // Also trigger auto email dispatch if parent email is available
      if (r && (r.email || r.parentEmail)) {
        sendFeeInvoiceEmailModal(r, true);
      }

      // Create pristine isolated print iframe
      let printFrame = document.getElementById('feeInvoicePrintFrame');
      if (!printFrame) {
        printFrame = document.createElement('iframe');
        printFrame.id = 'feeInvoicePrintFrame';
        printFrame.style.position = 'fixed';
        printFrame.style.right = '0';
        printFrame.style.bottom = '0';
        printFrame.style.width = '0';
        printFrame.style.height = '0';
        printFrame.style.border = '0';
        document.body.appendChild(printFrame);
      }

      const frameDoc = printFrame.contentWindow.document;
      frameDoc.open();
      frameDoc.write(`<!DOCTYPE html>
<html>
<head>
  <title>Al-Huda Fee Invoice - ${r ? (r.receiptNo || 'Receipt') : ''}</title>
  <meta charset="UTF-8">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <script src="https://cdn.tailwindcss.com"><\/script>
  <style>
    @page { size: A4 portrait; margin: 8mm; }
    body { font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif; background: #ffffff; color: #0f172a; margin: 0; padding: 12px; }
    table { width: 100% !important; border-collapse: collapse !important; }
  </style>
</head>
<body class="p-2 bg-white">
  ${card.outerHTML}
</body>
</html>`);
      frameDoc.close();

      setTimeout(() => {
        try {
          printFrame.contentWindow.focus();
          printFrame.contentWindow.print();
        } catch (printErr) {
          window.print();
        }
      }, 600);
    }

    // Official Academy Email Configuration Helpers
    function getOfficialAcademyEmail() {
      if (window.AcademyProfile) { try { var _pe = AcademyProfile.get().email; if (_pe) return _pe; } catch (e) {} }
      return localStorage.getItem('alhuda_fee_official_email') || 'ceoislamiccentre@gmail.com';
    }

    async function promptChangeOfficialEmail() {
      // Batch 2: the official sender/CC email is email configuration —
      // owner-only. Managers see the current value but cannot change it.
      if (typeof CURRENT_ROLE !== 'undefined' && CURRENT_ROLE === 'manager') {
        lmsNotify('The official academy email can only be changed by the Owner.');
        return;
      }
      const current = getOfficialAcademyEmail();
      const entered = await lmsPrompt("Enter Official Academy Email Address (used for invoice sender & CC):", current, {
        title: 'Official Academy Email Address',
        subtitle: 'Used as sender & CC for official invoices and fee reminders',
        confirmText: 'Save Email'
      });
      if (entered !== null && entered.trim() !== '') {
        const clean = entered.trim().toLowerCase();
        localStorage.setItem('alhuda_fee_official_email', clean);
        updateOfficialEmailUI();
        lmsNotify(`Official Academy Email updated to: ${clean}`);
      }
    }

    function updateOfficialEmailUI() {
      const email = getOfficialAcademyEmail();
      const el = document.getElementById('feeOfficialEmailDisplay');
      if (el) el.innerText = email;
      // Batch 2: hide the email-config change control from managers.
      const chBtn = document.getElementById('btnChangeOfficialEmail');
      if (chBtn) chBtn.style.display = (typeof CURRENT_ROLE !== 'undefined' && CURRENT_ROLE === 'manager') ? 'none' : '';
    }

    // Official Invoice Email Dispatcher (Manual & Auto-Send)
    async function sendFeeInvoiceEmailModal(record, isSilent = false) {
      const r = record || CURRENT_FEE_MODAL_RECEIPT;
      if (!r) {
        lmsNotify("No active invoice loaded to email.");
        return;
      }

      const famEmail = r.email || r.parentEmail || '';
      let targetEmail = famEmail;

      if (!targetEmail) {
        const fam = CACHED_FEE_FAMILIES.find(f => f.familyId === r.familyId || f.id === r.familyId);
        if (fam && fam.email) targetEmail = fam.email;
      }

      if (!targetEmail && !isSilent && CURRENT_ROLE !== 'manager') {
        const promptEmail = await lmsPrompt(`Please enter parent email address for ${r.parentName} (${r.familyId}):`, "", {
          title: 'Parent Email Required',
          subtitle: `${r.parentName} (${r.familyId})`,
          confirmText: 'Send Invoice'
        });
        if (promptEmail && promptEmail.includes('@')) {
          targetEmail = promptEmail.trim();
          r.email = targetEmail;
          const emailEl = document.getElementById('feeInvParentEmail');
          if (emailEl) emailEl.innerText = targetEmail;
        }
      }

      if (CURRENT_ROLE !== 'manager' && (!targetEmail || !targetEmail.includes('@'))) {
        if (!isSilent) {
          lmsNotify(`No valid parent email address found for ${r.parentName}. Please specify parent email.`);
        }
        return;
      }

      const offEmail = getOfficialAcademyEmail();
      const cur = r.currency || 'USD';
      const rNo = r.receiptNo || 'Not issued';
      const monthlyFee = parseFloat(r.monthlyFee || 0).toFixed(2);
      const prevBal = parseFloat(r.previousBalance || 0).toFixed(2);
      const credAmt = parseFloat(r.creditDeducted || 0).toFixed(2);
      const totalPayable = parseFloat(r.totalPayable || 0).toFixed(2);
      const amountPaid = parseFloat(r.amountPaid || 0).toFixed(2);
      const discount = parseFloat(r.discount || 0).toFixed(2);
      const remaining = parseFloat(r.remainingBalance || 0).toFixed(2);
      const excessAmt = parseFloat(r.excessPaid || 0).toFixed(2);

      const subject = `Official Tuition Fee Receipt [${rNo}] - ${r.parentName} (${r.month} ${r.year}) - ${academyName()}`;

      let proratedNotice = '';
      if (r.isAdvancePayment && r.advanceMonthsCount > 1) {
        proratedNotice = ` (${r.advanceMonthsCount} Months Advance)`;
      } else if (r.isProrated) {
        proratedNotice = ` (Mid-Month Admission: ${r.activeDays || 'N/A'} Days Active)`;
      }

      let prevBalRow = '';
      if (parseFloat(prevBal) > 0) {
        prevBalRow = `<tr style="background:#fffbeb;"><td style="padding:10px 12px; border:1px solid #e2e8f0; font-weight:bold; color:#b45309;">Previous Overdue Arrears:</td><td style="padding:10px 12px; border:1px solid #e2e8f0; text-align:right; font-weight:bold; color:#b45309;">${cur} ${prevBal}</td></tr>`;
      }

      let creditRow = '';
      if (parseFloat(credAmt) > 0) {
        creditRow = `<tr style="background:#ecfdf5;"><td style="padding:10px 12px; border:1px solid #e2e8f0; font-weight:bold; color:#047857;">Less: Advance Credit (Pre-Paid):</td><td style="padding:10px 12px; border:1px solid #e2e8f0; text-align:right; font-weight:bold; color:#047857;">- ${cur} ${credAmt}</td></tr>`;
      }

      let discountRow = '';
      if (parseFloat(discount) > 0) {
        discountRow = `<tr><td style="padding:10px 12px; border:1px solid #e2e8f0; font-style:italic; color:#64748b;">Fee Discount / Concession:</td><td style="padding:10px 12px; border:1px solid #e2e8f0; text-align:right; color:#dc2626;">- ${cur} ${discount}</td></tr>`;
      }

      let carryNotice = '';
      if (parseFloat(remaining) > 0) {
        carryNotice = `<div style="background:#fffbeb; border:2px dashed #d97706; border-radius:8px; padding:14px; margin-top:16px;">
          <strong style="color:#92400e; font-size:14px;">Notice: Outstanding Remaining Balance: ${cur} ${remaining}</strong>
          <p style="color:#78350f; font-size:12px; margin:4px 0 0 0;">This balance has been carried forward and will be automatically added to your next billing statement.</p>
        </div>`;
      } else if (parseFloat(excessAmt) > 0) {
        carryNotice = `<div style="background:#ecfdf5; border:2px dashed #059669; border-radius:8px; padding:14px; margin-top:16px;">
          <strong style="color:#065f46; font-size:14px;">Advance Credit Carried Forward: + ${cur} ${excessAmt}</strong>
          <p style="color:#047857; font-size:12px; margin:4px 0 0 0;">Alhamdulillah! Extra payment has been credited to your account and will be automatically deducted from your next invoice.</p>
        </div>`;
      }

      const plainText = `Assalam-o-Alaikum Respected ${r.parentName},\n\n` +
        `AL-HUDA ISLAMIC CENTRE - OFFICIAL TUITION FEE RECEIPT\n` +
        `Receipt No: ${rNo}\n` +
        `Date: ${r.date}\n` +
        `Family Account ID: ${r.familyId}\n` +
        `Student(s): ${r.studentsNames}\n` +
        `Billing Period: ${r.month} ${r.year}\n` +
        `Tuition Fee: ${cur} ${monthlyFee}${proratedNotice}\n` +
        (parseFloat(prevBal) > 0 ? `Previous Overdue Arrears: ${cur} ${prevBal}\n` : '') +
        (parseFloat(credAmt) > 0 ? `Advance Credit Deducted: - ${cur} ${credAmt}\n` : '') +
        `Net Total Payable: ${cur} ${totalPayable}\n` +
        (parseFloat(discount) > 0 ? `Discount: - ${cur} ${discount}\n` : '') +
        `Amount Received: ${cur} ${amountPaid} (${r.paymentMethod || 'Online'})\n` +
        `Remaining Balance: ${cur} ${remaining}\n` +
        (parseFloat(excessAmt) > 0 ? `Advance Credit Carried Forward: + ${cur} ${excessAmt}\n` : '') +
        `\nJazakAllahu Khairan!\n${academyName()} Accounts\nOfficial Email: ${offEmail}`;

      const btn = document.getElementById('feeInvBtnSendEmail');
      const origHtml = btn ? btn.innerHTML : '';
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Sending...';
      }

      // Try background dispatch via Official Apps Script Relay (with EmailJS fallback)
      let dispatchedSuccessfully = false;
      let managerSendError = '';
      try {
        if (CURRENT_ROLE === 'manager') {
          // Batch 2 (B16): the manager never sees or supplies the parent's
          // address — the Worker resolves it server-side from the familyId.
          if (typeof window.sendParentEmailViaNotify === 'function') {
            const notifyRes = await window.sendParentEmailViaNotify({
              familyId: r.familyId,
              subject: subject,
              text: plainText,
              html: plainText.replace(/\n/g, '<br/>')
            });
            dispatchedSuccessfully = !!notifyRes.success;
            if (!notifyRes.success) managerSendError = notifyRes.error || 'Send failed';
          } else {
            managerSendError = 'Secure email service unavailable.';
          }
        } else if (typeof sendViaOfficialEmailRelay === 'function' || window.sendViaOfficialEmailRelay) {
          const fn = window.sendViaOfficialEmailRelay || sendViaOfficialEmailRelay;
          const relayRes = await fn({
            to: targetEmail,
            subject: subject,
            text: plainText,
            html: plainText.replace(/\n/g, '<br/>'),
            senderName: `${academyName()} (${offEmail})`
          });
          if (relayRes && relayRes.success) dispatchedSuccessfully = true;
        } else if (typeof emailjs !== 'undefined' && window.EMAILJS_PUBLIC_KEY) {
          await emailjs.send(window.EMAILJS_SERVICE_ID, window.EMAILJS_TEMPLATE_ID, {
            to_email: targetEmail,
            cc_email: offEmail,
            subject: subject,
            message: plainText,
            from_name: `${academyName()} (${offEmail})`
          });
          dispatchedSuccessfully = true;
        }
      } catch (eJsErr) {
        console.warn("Background email dispatch notice:", eJsErr);
      }

      if (btn) {
        btn.disabled = false;
        btn.innerHTML = origHtml;
      }

      if (CURRENT_ROLE === 'manager') {
        // Batch 2 (B16): no Gmail compose for managers (it would expose
        // the address), and the confirmation never names the recipient.
        lmsNotify(dispatchedSuccessfully
          ? '✅ Email sent to the parent.'
          : '❌ Email could not be sent. ' + managerSendError);
      } else if (!isSilent) {
        // Open Gmail compose with complete pre-filled details
        const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(targetEmail)}&cc=${encodeURIComponent(offEmail)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(plainText)}`;
        window.open(gmailUrl, '_blank');
        lmsNotify('Official Invoice Email prepared.');
      } else {
        // Silent path (auto-send): Batch 3.5 (audit P2-17) — the old
        // code toasted dispatch success here unconditionally, even
        // when every delivery path had failed. Success is now claimed
        // only on a real dispatch; a failure says plainly that the
        // receipt is still saved and must be sent manually.
        if (dispatchedSuccessfully) {
          lmsNotify('Official Invoice Email dispatched via Al-Huda Official Relay.');
        } else {
          lmsNotify('Invoice email could NOT be sent — the receipt is still saved, please send it manually.', { type: 'error' });
        }
      }
    }

    // ============================================================
    // 4. SELECTED MONTH PENDING PAYMENTS, REMIND ALL & 4TH AUTO-REMINDER
    // ============================================================
    let CACHED_THREE_MONTH_DEFAULTERS = [];

    function getFamilyEmailAddress(fam) {
      if (!fam) return '';
      if (fam.email && String(fam.email).includes('@')) return String(fam.email).trim();
      if (fam.notes) {
        try {
          const parsed = JSON.parse(fam.notes);
          if (parsed && parsed.email && String(parsed.email).includes('@')) return String(parsed.email).trim();
        } catch (e) {}
      }
      return '';
    }

    async function handlePendingMonthFilterChange() {
      const mSel = document.getElementById('feePendingMonthFilter');
      const ySel = document.getElementById('feePendingYearFilter');
      const dashM = document.getElementById('feeDashMonthSelect');
      const dashY = document.getElementById('feeDashYearSelect');

      if (mSel && dashM) dashM.value = mSel.value;
      if (ySel && dashY) dashY.value = ySel.value;

      await loadFeeDashboardStats();
      loadPendingDefaultersList();
    }

    function loadPendingDefaultersList() {
      const mSel = document.getElementById('feePendingMonthFilter');
      const ySel = document.getElementById('feePendingYearFilter');
      const targetMonth = mSel ? mSel.value : (FEE_CONFIG.MONTHS[new Date().getMonth()] || 'September');
      const targetYear = ySel ? parseInt(ySel.value, 10) : new Date().getFullYear();

      const pLabel = document.getElementById('feePendingPeriodLabel');
      if (pLabel) pLabel.innerText = `${targetMonth} ${targetYear}`;

      const tbody = document.getElementById('feePendingTableBody');
      if (!tbody) return;

      // Fee Upgrade Phase 2: the pending list just reloaded (new month),
      // so any month-specific selection is stale — clear it.
      PENDING_BULK_SELECTED = {};

      const list = CACHED_PENDING_FEE_LIST || [];
      const badge = document.getElementById('feePendingTotalBadge');
      if (badge) badge.innerText = `${list.length} Families Pending (${targetMonth} ${targetYear})`;

      initAndCheckMonthly4thAutoReminder();
      renderPendingDefaultersRows(list);
    }

    function renderPendingDefaultersRows(list) {
      const tbody = document.getElementById('feePendingTableBody');
      if (!tbody) return;

      // Fee Upgrade Phase 2: nothing rendered (yet) on this page.
      PENDING_BULK_LAST_RENDERED = [];

      const mSel = document.getElementById('feePendingMonthFilter');
      const ySel = document.getElementById('feePendingYearFilter');
      const targetMonth = mSel ? mSel.value : (FEE_CONFIG.MONTHS[new Date().getMonth()] || 'September');
      const targetYear = ySel ? parseInt(ySel.value, 10) : new Date().getFullYear();

      const pendPagerEl = document.getElementById('feePendingTablePager');
      if (!list || list.length === 0) {
        // Phase 4 (audit P3-rr-e): never claim "all cleared" when the
        // pending list simply has not loaded (or its load failed).
        if (CACHED_PENDING_FEE_LIST === null) {
          tbody.innerHTML = `
          <tr>
            <td colspan="8" class="p-8 text-center text-slate-500 font-bold">
              <i class="fa-solid fa-triangle-exclamation text-2xl text-amber-500 block mb-1"></i>
              The pending list has not loaded yet. Please reload the page to see the current pending fees.
            </td>
          </tr>
        `;
          if (pendPagerEl) pendPagerEl.innerHTML = '';
          return;
        }
        tbody.innerHTML = `
          <tr>
            <td colspan="8" class="p-8 text-center text-emerald-800 font-bold">
              <i class="fa-solid fa-circle-check text-2xl text-emerald-600 block mb-1"></i>
              SubhanAllah! Zero pending fees found for ${targetMonth} ${targetYear}. All family dues are cleared!
            </td>
          </tr>
        `;
        if (pendPagerEl) pendPagerEl.innerHTML = '';
        return;
      }

      // Batch 3.6 (audit P2-36): page the pending list (default 25).
      const pendPage = paginateList(list, FEE_PENDING_PAGE, FEE_PENDING_PAGE_SIZE);
      FEE_PENDING_PAGE = pendPage.safePage;
      // Fee Upgrade Phase 2: the rows actually on this page — Select
      // All only touches these.
      PENDING_BULK_LAST_RENDERED = pendPage.pageRows;

      tbody.innerHTML = pendPage.pageRows.map(item => {
        const cleanPhone = (item.whatsapp || '').replace(/[^0-9]/g, '');
        const periodStr = `${item.selectedMonth || targetMonth} ${item.selectedYear || targetYear}`;
        const waMsg = (window.FeePhase4 && typeof window.FeePhase4.buildPendingWhatsAppMessage === 'function')
          ? window.FeePhase4.buildPendingWhatsAppMessage(item, periodStr, academyName())
          : `Assalam-o-Alaikum Respected ${item.parentName},\nFee reminder for ${periodStr}: ${item.currency} ${item.dueAmount.toFixed(2)} is due.`;
        const waUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(waMsg)}`;

        const rawEmail = item.email || getFamilyEmailAddress(item.family);
        const displayedEmail = rawEmail
          ? ((typeof CURRENT_ROLE !== 'undefined' && CURRENT_ROLE === 'manager' && typeof maskStudentEmail === 'function') ? maskStudentEmail(rawEmail) : rawEmail)
          : '<span class="text-slate-400 italic text-[10px]">No Email on File</span>';

        return `
          <tr class="hover:bg-slate-50 transition">
            <td class="p-3 w-8"><input type="checkbox" class="pending-bulk-check w-4 h-4 rounded text-emerald-700 focus:ring-emerald-600" value="${item.familyId}" ${PENDING_BULK_SELECTED[item.familyId] ? 'checked' : ''} onchange="updatePendingBulkSelection(this)" title="Select for Bulk Collect"></td>
            <td class="p-3 font-mono font-bold text-slate-700">${item.familyId}</td>
            <td class="p-3">
              <div class="font-bold text-slate-900">${item.parentName}</div>
              <div class="text-[11px] text-slate-500 font-mono">${displayedEmail}</div>
            </td>
            <td class="p-3 font-medium text-emerald-900">${item.studentsNames}</td>
            <td class="p-3">
              <span class="px-2 py-0.5 rounded-md bg-amber-50 text-amber-900 border border-amber-200 font-bold text-[11px]">
                ${periodStr}
              </span>
            </td>
            <td class="p-3 font-bold font-mono text-rose-700 text-sm">${item.currency} ${item.dueAmount.toFixed(2)}</td>
            <td class="p-3">
              <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${item.isPartial ? 'bg-amber-100 text-amber-800 border border-amber-300' : 'bg-rose-100 text-rose-800 border border-rose-300'}">
                ${item.status}
              </span>
            </td>
            <td class="p-3 text-right space-x-1">
              <button onclick="selectFeeFamily('${item.familyId}')" class="px-2.5 py-1 bg-emerald-700 text-white rounded-lg text-xs font-bold hover:bg-emerald-800 transition" title="Collect Fee">
                <i class="fa-solid fa-cash-register mr-1"></i>Collect
              </button>
              <button onclick="sendSinglePendingFeeReminder('${item.familyId}')" class="px-2.5 py-1 bg-amber-600 text-white rounded-lg text-xs font-bold hover:bg-amber-700 transition inline-flex items-center gap-1" title="Send Official Email Reminder for ${periodStr}">
                <i class="fa-solid fa-envelope"></i> Email
              </button>
              ${CURRENT_ROLE !== 'manager' ? `
                <a href="${waUrl}" target="_blank" class="px-2.5 py-1 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-700 inline-flex items-center gap-1 transition">
                  <i class="fa-brands fa-whatsapp"></i>Remind
                </a>
              ` : `
                <span class="px-2 py-1 bg-amber-50 text-amber-800 border border-amber-200 rounded-lg text-[10px] font-bold inline-flex items-center gap-1" title="Protected Student Contact for Manager">
                  <i class="fa-solid fa-lock text-amber-500 text-[10px]"></i> Protected
                </span>
              `}
            </td>
          </tr>
        `;
      }).join('');
      if (pendPagerEl) {
        pendPagerEl.innerHTML = buildTablePagerHtml({
          page: FEE_PENDING_PAGE, totalPages: pendPage.totalPages, total: list.length,
          start: pendPage.start, end: pendPage.end,
          pageSize: FEE_PENDING_PAGE_SIZE === Infinity ? 'all' : String(FEE_PENDING_PAGE_SIZE),
          onPage: 'setFeePendingPage', onSize: 'setFeePendingPageSize'
        });
      }
      // Fee Upgrade Phase 2: keep the Bulk Collect bar in sync with the
      // rows just rendered (count, totals, duplicate warning).
      syncPendingBulkUi();
    }

    function filterPendingDefaultersSearchLive() {
      const q = (document.getElementById('feePendingSearchInput')?.value || '').trim().toLowerCase();
      const list = CACHED_PENDING_FEE_LIST || [];

      if (!q) {
        renderPendingDefaultersRows(list);
        return;
      }

      const filtered = list.filter(item => {
        return String(item.familyId).toLowerCase().includes(q) ||
               String(item.parentName).toLowerCase().includes(q) ||
               String(item.studentsNames).toLowerCase().includes(q) ||
               String(item.whatsapp).includes(q);
      });

      renderPendingDefaultersRows(filtered);
    }

    function buildPendingMonthReminderEmail(item, monthName, year) {
      const offEmail = getOfficialAcademyEmail();
      const periodStr = `${monthName} ${year}`;
      const subject = `Tuition Fee Reminder (${periodStr}) — ${item.studentsNames} | ${academyName()}`;

      const plainText =
`Assalam-o-Alaikum Respected ${item.parentName},

We pray that you and your family are in the best of health and Iman.

This is a polite official reminder from the Accounts Department of ${academyName()} regarding your monthly tuition fee for the month of ${periodStr}:

• Family ID: ${item.familyId}
• Enrolled Student(s): ${item.studentsNames}
• Billing Month: ${periodStr}
• Pending Fee Due: ${item.currency} ${Number(item.dueAmount || 0).toFixed(2)}

Our records indicate that your tuition fee for ${periodStr} has not yet reached us. Kindly arrange to submit your fee at your earliest convenience.

📌 ALREADY PAID?
If you have already paid the tuition fee for ${periodStr}, kindly share the payment screenshot or bank transfer receipt by replying to this email (${offEmail}) or via WhatsApp so our accounts team can verify and update your ledger immediately.

JazakAllahu Khairan for your continued trust and cooperation!

Warm Islamic Regards,
Finance & Accounts Department
${academyName()}
Official Email: ${offEmail}`;

      const htmlBody = `
        <div style="font-family:'Plus Jakarta Sans',Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;background:#ffffff;">
          <div style="background:linear-gradient(135deg,#022c22,#065f46);color:#ffffff;padding:22px 24px;border-bottom:4px solid #d97706;">
            <h2 style="margin:0;font-size:18px;letter-spacing:0.5px;">AL-HUDA ISLAMIC CENTRE</h2>
            <p style="margin:4px 0 0;font-size:12px;color:#fde68a;font-weight:700;">Official Tuition Fee Reminder — ${periodStr}</p>
          </div>
          <div style="padding:24px;color:#1e293b;font-size:13.5px;line-height:1.6;">
            <p style="margin-top:0;"><strong>Assalam-o-Alaikum Respected ${item.parentName},</strong></p>
            <p>We pray that you and your family are in the best of health and Iman.</p>
            <p>Our billing records show that your tuition fee for the month of <strong style="color:#b45309;text-decoration:underline;">${periodStr}</strong> has not yet reached us:</p>
            <div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:12px;padding:14px 16px;margin:16px 0;">
              <div style="margin-bottom:6px;"><strong>Family ID:</strong> <span style="font-family:monospace;">${item.familyId}</span></div>
              <div style="margin-bottom:6px;"><strong>Enrolled Student(s):</strong> <span style="color:#065f46;font-weight:700;">${item.studentsNames}</span></div>
              <div style="margin-bottom:6px;"><strong>Billing Month:</strong> <strong>${periodStr}</strong></div>
              <div style="font-size:15px;"><strong>Pending Amount Due:</strong> <span style="color:#be123c;font-weight:800;font-family:monospace;">${item.currency} ${Number(item.dueAmount || 0).toFixed(2)}</span></div>
            </div>
            <p>Kindly submit your pending tuition fee for <strong>${periodStr}</strong> as soon as possible.</p>
            <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:12px;padding:12px 16px;margin:16px 0;color:#14532d;font-size:12.5px;">
              <strong>📸 Already Paid? Share Screenshot / Receipt:</strong><br/>
              If you have already paid the fee for <strong>${periodStr}</strong>, kindly share the <strong>payment screenshot or transaction receipt</strong> with us via email (<a href="mailto:${offEmail}" style="color:#047857;font-weight:700;">${offEmail}</a>) or WhatsApp so we can immediately update your fee record.
            </div>
            <p style="margin-bottom:0;">JazakAllahu Khairan,<br/><strong>Finance &amp; Accounts Department</strong><br/>${academyName()}</p>
          </div>
        </div>
      `;

      return { subject, plainText, htmlBody, offEmail };
    }

    async function sendSinglePendingFeeReminder(familyId) {
      const list = CACHED_PENDING_FEE_LIST || [];
      const item = list.find(i => String(i.familyId).toUpperCase() === String(familyId).toUpperCase());
      if (!item) return;

      const mSel = document.getElementById('feePendingMonthFilter');
      const ySel = document.getElementById('feePendingYearFilter');
      const targetMonth = item.selectedMonth || (mSel ? mSel.value : (FEE_CONFIG.MONTHS[new Date().getMonth()] || 'September'));
      const targetYear = item.selectedYear || (ySel ? parseInt(ySel.value, 10) : new Date().getFullYear());
      const emailAddr = item.email || getFamilyEmailAddress(item.family);

      const { subject, plainText, htmlBody } = buildPendingMonthReminderEmail(item, targetMonth, targetYear);

      if (typeof openEmailPreviewModal === 'function') {
        openEmailPreviewModal({
          type: 'fee_reminder',
          familyId: item.familyId,
          toEmail: emailAddr,
          toPhone: item.whatsapp || '',
          recipientName: item.parentName,
          subject,
          plainText,
          htmlBody
        });
      } else if (emailAddr) {
        const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(emailAddr)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(plainText)}`;
        window.open(gmailUrl, '_blank');
      } else {
        lmsNotify(`No email address is saved for ${item.parentName} (${item.familyId}). Please add their email in Family Directory.`);
      }
    }

    // Fee Dashboard + Form Improvements (#7): a bulk send that is
    // already running cannot be started again — a double-click (or a
    // manual click racing the 4th-of-month auto trigger) sends once.
    async function sendBulkPendingFeeReminders(isAuto4thTrigger = false) {
      if (FEE_PENDING_REMIND_RUNNING) return;
      FEE_PENDING_REMIND_RUNNING = true;
      try {
        await sendBulkPendingFeeRemindersInner(isAuto4thTrigger);
      } finally {
        FEE_PENDING_REMIND_RUNNING = false;
      }
    }

    async function sendBulkPendingFeeRemindersInner(isAuto4thTrigger = false) {
      const list = CACHED_PENDING_FEE_LIST || [];
      const mSel = document.getElementById('feePendingMonthFilter');
      const ySel = document.getElementById('feePendingYearFilter');
      const targetMonth = mSel ? mSel.value : (FEE_CONFIG.MONTHS[new Date().getMonth()] || 'September');
      const targetYear = ySel ? parseInt(ySel.value, 10) : new Date().getFullYear();
      const periodStr = `${targetMonth} ${targetYear}`;

      if (list.length === 0) {
        if (!isAuto4thTrigger) {
          lmsNotify(`All clear! There are zero families with pending fees for ${periodStr}.`);
        }
        return;
      }

      // Batch 2 (B16): managers send per-family through the notify
      // endpoint. They cannot see which families have an email on file —
      // the Worker resolves each address server-side and reports only
      // success/failure per family.
      if (CURRENT_ROLE === 'manager') {
        if (!isAuto4thTrigger) {
          // Fee Dashboard + Form Improvements (#7): two-step confirm
          // with the brief's exact question + explicit button labels.
          // Managers never see addresses — the Worker resolves them.
          const cfgMgr = (window.FeePhase6 && typeof window.FeePhase6.remindAllConfirmConfig === 'function')
            ? window.FeePhase6.remindAllConfirmConfig({ kind: 'pending', period: periodStr, total: list.length, withEmail: null, quotaNote: 'Sent securely to each family saved email address. Addresses are never shown to managers.' })
            : { title: 'Send Fee Reminders?', message: 'Are you sure you want to send fee reminders to all eligible families?', confirmText: 'Confirm & Send Reminders', cancelText: 'Cancel', variant: 'warning' };
          if (!(await lmsConfirm(cfgMgr))) return;
        }
        const btnM = document.getElementById('btnRemindAllPendingMonth');
        const origHtmlM = btnM ? btnM.innerHTML : '';
        if (btnM) {
          btnM.disabled = true;
          btnM.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>Sending Reminders (0/${list.length})...</span>`;
        }
        let sentMgr = 0;
        let failedMgr = 0;
        let quotaStoppedMgr = false;
        const itemsMgr = list.slice(0, 85);
        for (let i = 0; i < itemsMgr.length; i++) {
          const item = itemsMgr[i];
          if (btnM) {
            btnM.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>Sending (${i + 1}/${itemsMgr.length})...</span>`;
          }
          try {
            const built = buildPendingMonthReminderEmail(item, targetMonth, targetYear);
            if (typeof window.sendParentEmailViaNotify === 'function') {
              const res = await window.sendParentEmailViaNotify({
                familyId: item.familyId,
                subject: built.subject,
                text: built.plainText,
                html: built.htmlBody || built.plainText.replace(/\n/g, '<br/>')
              });
              if (res.success) sentMgr++; else failedMgr++;
              if (res && (res.quotaExceeded === true || res.quotaRemaining === 0)) quotaStoppedMgr = true;
            } else {
              failedMgr++;
            }
          } catch (err) {
            failedMgr++;
          }
          if (quotaStoppedMgr) break;
        }
        if (btnM) {
          btnM.disabled = false;
          btnM.innerHTML = origHtmlM;
        }
        localStorage.setItem(`alhuda_bulk_pending_reminder_${targetYear}_${targetMonth}`, new Date().toISOString());
        if (!isAuto4thTrigger) {
          lmsNotify(`✅ Processed ${itemsMgr.length} pending fee reminders for ${periodStr}!`);
          lmsNotify(`✅ ${periodStr} Fee Reminders Processed!\n\n• Total Pending Families: ${list.length}\n• Emails Sent Securely: ${sentMgr}\n• Could Not Send (no email on file or an error): ${failedMgr}${quotaStoppedMgr ? '\n• ⚠️ Sending stopped early: the daily email limit was reached, so the remaining reminders were NOT sent.' : ''}`);
        }
        return;
      }

      const recipientsWithEmail = list.filter(item => {
        const em = item.email || getFamilyEmailAddress(item.family);
        return em && em.includes('@');
      });

      if (!isAuto4thTrigger) {
        // Fee Dashboard + Form Improvements (#7): two-step confirm
        // with the brief's exact question + explicit button labels.
        // The quota notice is preserved inside the dialog.
        const quotaNote = recipientsWithEmail.length > 85
          ? 'Safe Quota Notice: Free Gmail has a daily limit of 100 emails/day. To keep your official account safe, dispatching will process up to 85 emails in this batch.'
          : null;
        const cfg = (window.FeePhase6 && typeof window.FeePhase6.remindAllConfirmConfig === 'function')
          ? window.FeePhase6.remindAllConfirmConfig({ kind: 'pending', period: periodStr, total: list.length, withEmail: recipientsWithEmail.length, quotaNote: quotaNote })
          : { title: 'Send Fee Reminders?', message: 'Are you sure you want to send fee reminders to all eligible families?', confirmText: 'Confirm & Send Reminders', cancelText: 'Cancel', variant: 'warning' };
        if (!(await lmsConfirm(cfg))) return;
      }

      const btn = document.getElementById('btnRemindAllPendingMonth');
      const origHtml = btn ? btn.innerHTML : '';
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>Sending Reminders (0/${recipientsWithEmail.length || list.length})...</span>`;
      }

      let sentCount = 0;
      let failedCount = 0;
      let quotaStopped = false;
      const allBccEmails = [];
      const MAX_SAFE_BATCH = 85;
      const itemsToProcess = recipientsWithEmail.length > MAX_SAFE_BATCH ? recipientsWithEmail.slice(0, MAX_SAFE_BATCH) : recipientsWithEmail;

      for (let i = 0; i < itemsToProcess.length; i++) {
        const item = itemsToProcess[i];
        const emailAddr = item.email || getFamilyEmailAddress(item.family);
        if (!emailAddr || !emailAddr.includes('@')) continue;

        allBccEmails.push(emailAddr);
        const { subject, plainText, htmlBody, offEmail } = buildPendingMonthReminderEmail(item, targetMonth, targetYear);

        if (btn) {
          btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>Sending (${i + 1}/${itemsToProcess.length})...</span>`;
        }

        // Batch 5 (B10): count ONLY confirmed sends. A relay failure or
        // an exception is a failure, never a send. When the relay reports
        // the daily quota is exhausted, stop — the rest were NOT sent.
        let itemSent = false;
        let itemQuotaHit = false;
        try {
          if (typeof sendViaOfficialEmailRelay === 'function' || window.sendViaOfficialEmailRelay) {
            const fn = window.sendViaOfficialEmailRelay || sendViaOfficialEmailRelay;
            const relayRes = await fn({
              to: emailAddr,
              subject: subject,
              text: plainText,
              html: htmlBody || plainText.replace(/\n/g, '<br/>'),
              senderName: `${academyName()} (${offEmail})`
            });
            itemSent = !!(relayRes && relayRes.success === true);
            if (relayRes && (relayRes.quotaExceeded === true || relayRes.quotaRemaining === 0)) itemQuotaHit = true;
          } else if (window.emailjs) {
            await emailjs.send('service_alhuda_lms', 'template_fee_invoice', {
              to_email: emailAddr,
              cc_email: offEmail,
              reply_to: offEmail,
              to_name: item.parentName,
              subject: subject,
              message: plainText,
              html_content: htmlBody,
              from_name: `${academyName()} (${offEmail})`
            });
            itemSent = true;
          }
        } catch (err) {
          console.warn('[Remind All] Background dispatch notice for', emailAddr, err);
          itemSent = false;
        }
        if (itemSent) sentCount++; else failedCount++;
        if (itemQuotaHit) { quotaStopped = true; break; }
      }

      if (btn) {
        btn.disabled = false;
        btn.innerHTML = origHtml;
      }

      // Record dispatch log
      const logKey = `alhuda_bulk_pending_reminder_${targetYear}_${targetMonth}`;
      localStorage.setItem(logKey, new Date().toISOString());

      if (!isAuto4thTrigger) {
        if (allBccEmails.length > 0 && CURRENT_ROLE !== 'manager') {
          lmsNotify(`✅ Dispatched ${sentCount} Fee Reminders via Official Relay for ${periodStr}!`);
          lmsNotify(`✅ ${periodStr} Fee Reminder Emails Dispatched!\n\n• Total Pending Families: ${list.length}\n• Emails Sent via Official Relay: ${sentCount}\n• Not Sent: ${itemsToProcess.length - sentCount}${quotaStopped ? '\n• ⚠️ Sending stopped early: the daily email limit was reached, so the remaining reminders were NOT sent.' : ''}\n• Message Included: "${periodStr} fee has not reached us — kindly pay at earliest or share payment screenshot/receipt if already paid."`);
        } else {
          lmsNotify(`✅ Processed ${list.length} pending fee reminders for ${periodStr}!`);
          lmsNotify(`✅ ${periodStr} Fee Reminder Processed for ${list.length} Pending Families!`);
        }
      }
    }

    // ============================================================
    // Fee Upgrade Phase 2 — BULK COLLECT (#52)
    // Collects the Pending view's due amount for many families in one
    // run. Each family goes through the EXISTING single-payment save
    // path below (saveBulkFeePaymentRecord): same receipt numbering,
    // same record shape, same cloud sync + dual-write as
    // handleFeePaymentSubmit. The FeePhase2 module only builds the
    // record and drives the loop; it never writes.
    // ============================================================

    // One family's save, taken from handleFeePaymentSubmit's save
    // sequence (local unshift + save, then awaited cloud sync).
    // Returns { ok, receiptNo, error }. A failed cloud sync still
    // leaves the local receipt (marked unsynced, retried by the Sync
    // button), but the row reports as failed so the run summary stays
    // honest.
    async function saveBulkFeePaymentRecord(record) {
      const records = getStoredFeeRecords();
      records.unshift(record);
      saveStoredFeeRecords(records);
      const syncResult = await syncPaymentRecordsBatchToCloud(record.familyId, [record]);
      if (!syncResult || !syncResult.ok) {
        record.cloudSyncPending = true;
        saveStoredFeeRecords(records);
        return { ok: false, receiptNo: record.receiptNo, error: 'Cloud sync failed — receipt saved on this device only (marked unsynced). Use Sync to retry.' };
      }
      return { ok: true, receiptNo: record.receiptNo };
    }

    // ============================================================
    // Fee Upgrade Phase 3 — ONE-TAP PAID / UNPAID (#33, #36, #45)
    // + ENROLLMENT CASCADE (#32, #46, #47)
    //
    // Mechanism (fee-portal reference: updateFamilyMonthStatuses /
    // setMatrixMonthStatus): Paid appends one ADJ status row — amount
    // ZERO, ref ADJ-YYYYMM-<FAMILYID>, record_kind 'month_status'. It
    // marks the month paid; it is NOT money and is filtered out of
    // every money reader (same pattern as the Phase 1 due-invoice rows).
    // Unpaid removes that ADJ row only — it never touches, cancels or
    // hides a real payment. A month with a real payment cannot be
    // Mark-Unpaid at all (validateMarkUnpaid refuses it); the real
    // payment must be undone/cancelled first.
    //
    // Role scope: owner + manager — the same scope as Collect Fee and
    // the matrix overrides. A status marker is not money and the
    // payments-table row is cancelled-with-reason, never deleted, so
    // there is nothing owner-only to protect here. Teachers and
    // parents never reach these surfaces.
    // ============================================================

    // Shared write path for all three one-tap surfaces (Collect Fee
    // switcher, Ledger, Matrix modal). Returns { ok, record, error,
    // code, cloudPending }.
    async function markMonthPaid(familyId, monthIdx, year) {
      const fam = (CACHED_FEE_FAMILIES || []).find(f => String(f.id).toUpperCase() === String(familyId || '').toUpperCase());
      if (!fam) return { ok: false, code: 'no_family', error: 'Family not found.' };
      if (!window.FeePhase3 || typeof window.FeePhase3.validateMarkPaid !== 'function') {
        return { ok: false, code: 'module_missing', error: 'The fee module did not load. Please refresh and try again.' };
      }
      const now = new Date();
      const overrides = getStoredMatrixOverrides();
      const mLower = FEE_CONFIG.MONTHS[monthIdx] ? FEE_CONFIG.MONTHS[monthIdx].toLowerCase() : '';
      const manualOverride = overrides[`${String(familyId).toUpperCase()}_${mLower}_${parseInt(year, 10)}`];
      const check = window.FeePhase3.validateMarkPaid({
        family: fam,
        monthIdx: monthIdx,
        year: parseInt(year, 10),
        records: getStoredFeeRecords(),
        isPreAdmission: isFamilyPreAdmission(fam, monthIdx, parseInt(year, 10)),
        isNotEnrolled: !!(manualOverride && manualOverride.status === 'not_enrolled'),
        isLeave: !!(checkFamilyLeaveInMonth(familyId, FEE_CONFIG.MONTHS[monthIdx], parseInt(year, 10)).isLeave || (manualOverride && manualOverride.status === 'leave')),
        isFuture: (parseInt(year, 10) > now.getFullYear()) || (parseInt(year, 10) === now.getFullYear() && monthIdx > now.getMonth())
      });
      if (!check.ok) return check;

      const fee = feeFormApplicableFeeDetails(fam, monthIdx, parseInt(year, 10)).fee;
      const role = (typeof CURRENT_ROLE !== 'undefined' && CURRENT_ROLE) ? CURRENT_ROLE : 'owner';
      const rec = window.FeePhase3.buildMonthStatusRecord(fam, monthIdx, parseInt(year, 10), fee, role);
      const records = getStoredFeeRecords();
      records.unshift(rec);
      saveStoredFeeRecords(records);
      const syncResult = await syncPaymentRecordsBatchToCloud(familyId, [rec]);
      if (!syncResult || !syncResult.ok) {
        rec.cloudSyncPending = true;
        saveStoredFeeRecords(records);
        return { ok: true, cloudPending: true, record: rec };
      }
      return { ok: true, record: rec };
    }

    async function markMonthUnpaid(familyId, monthIdx, year) {
      const fam = (CACHED_FEE_FAMILIES || []).find(f => String(f.id).toUpperCase() === String(familyId || '').toUpperCase());
      if (!fam) return { ok: false, code: 'no_family', error: 'Family not found.' };
      if (!window.FeePhase3 || typeof window.FeePhase3.validateMarkUnpaid !== 'function') {
        return { ok: false, code: 'module_missing', error: 'The fee module did not load. Please refresh and try again.' };
      }
      const check = window.FeePhase3.validateMarkUnpaid({
        family: fam,
        monthIdx: monthIdx,
        year: parseInt(year, 10),
        records: getStoredFeeRecords()
      });
      if (!check.ok) return check;
      const row = check.row;
      const fIdUpper = String(familyId).toUpperCase();

      // 1. Remove locally (fail-closed: restored if the cloud step
      // fails, so the next ingest from family notes fee_history cannot
      // resurrect the row).
      const remaining = getStoredFeeRecords().filter(r => !(r && String(r.familyId || '').toUpperCase() === fIdUpper && String(r.receiptNo || '') === String(row.receiptNo || '')));
      saveStoredFeeRecords(remaining);

      // 2. Remove from the cloud source of truth (family notes
      // fee_history) and cancel the payments-table row.
      const notesRemoved = await removeFeeHistoryRecords(familyId, [row.receiptNo]);
      if (!notesRemoved) {
        const back = getStoredFeeRecords();
        back.unshift(row);
        saveStoredFeeRecords(back);
        return { ok: false, code: 'cloud_failed', error: 'Could not remove the status from the cloud — nothing was changed. Please try again.' };
      }
      try {
        if (window.FeeTables && typeof window.FeeTables.dualWritePaymentCancelled === 'function') {
          await window.FeeTables.dualWritePaymentCancelled(
            { receiptNo: row.receiptNo, familyId: familyId, month: FEE_CONFIG.MONTHS[monthIdx], year: parseInt(year, 10) },
            (typeof CURRENT_ROLE !== 'undefined' && CURRENT_ROLE) ? CURRENT_ROLE : 'owner',
            'status removed by one-tap Unpaid'
          );
        }
      } catch (e) { /* best effort — the notes removal above is the gate */ }
      return { ok: true, record: row };
    }

    // Remove fee_history records (by receiptNo) from one family's
    // notes. Returns true when the cloud copy no longer holds them
    // (or never did); false only on a real write/read failure.
    async function removeFeeHistoryRecords(familyId, receiptNos) {
      try {
        const fId = String(familyId || '').trim();
        if (!fId) return false;
        const { data: fam, error } = await db.from('families').select('id, notes').eq('id', fId).maybeSingle();
        if (error) return false;
        const notesObj = parseFamilyNotesData(fam ? fam.notes : null);
        if (!Array.isArray(notesObj.fee_history)) return true;
        const before = notesObj.fee_history.length;
        const set = {};
        (receiptNos || []).forEach(n => { set[String(n)] = true; });
        notesObj.fee_history = notesObj.fee_history.filter(r => !(r && set[String(r.receiptNo || '')]));
        if (notesObj.fee_history.length === before) return true;
        const { error: upErr } = await db.from('families').update({ notes: JSON.stringify(notesObj) }).eq('id', fId);
        return !upErr;
      } catch (e) {
        return false;
      }
    }

    // Re-render every fee surface a status change can affect.
    function refreshFeeViewsAfterStatusChange() {
      try { loadFeeDashboardStats(); } catch (e) {}
      try { loadMasterAnnualMatrix(); } catch (e) {}
      try { if (CURRENT_LEDGER_FAMILY_ID) reloadFamilyLedgerData(); } catch (e) {}
    }

    // ---- Enrollment marker (#32, #46, #47) ----
    // The marker IS the existing ADMISSION_<FAMILYID> entry in the
    // cloud-synced matrix overrides — the same admission date the
    // Matrix modal's set_admission_date / not_enrolled actions already
    // write. Months before it are Not Enrolled via the existing
    // isFamilyPreAdmission (no double-count, no new storage).
    function setFamilyAdmissionDate(familyId, monthIdx, year) {
      const fIdUpper = String(familyId || '').toUpperCase();
      const yInt = parseInt(year, 10);
      const overrides = getStoredMatrixOverrides();
      const admKey = `ADMISSION_${fIdUpper}`;
      overrides[admKey] = {
        year: yInt,
        monthIndex: monthIdx,
        monthName: FEE_CONFIG.MONTHS[monthIdx],
        updatedAt: new Date().toISOString()
      };
      // Clean up individual month overrides before this month in the
      // same year, so the enrollment engine auto-manages them as N/A.
      FEE_CONFIG.MONTHS.forEach((nm, idx) => {
        if (idx < monthIdx) {
          delete overrides[`${fIdUpper}_${nm.toLowerCase()}_${yInt}`];
        }
      });
      saveStoredMatrixOverrides(overrides);
      syncMatrixOverridesToCloud(familyId, overrides);
      return true;
    }

    function clearFamilyAdmissionDate(familyId) {
      const fIdUpper = String(familyId || '').toUpperCase();
      const overrides = getStoredMatrixOverrides();
      const had = !!overrides[`ADMISSION_${fIdUpper}`];
      delete overrides[`ADMISSION_${fIdUpper}`];
      saveStoredMatrixOverrides(overrides);
      syncMatrixOverridesToCloud(familyId, overrides);
      return had;
    }

    // ---- Ledger one-tap (#36) ----
    async function ledgerMarkMonthPaid(monthName) {
      if (!CURRENT_LEDGER_FAMILY_ID) return;
      const mIdx = FEE_CONFIG.MONTHS.findIndex(m => m.toLowerCase() === String(monthName || '').toLowerCase());
      if (mIdx < 0) return;
      const ySel = document.getElementById('ledgerYearSelect');
      const year = ySel ? parseInt(ySel.value, 10) : new Date().getFullYear();
      const res = await markMonthPaid(CURRENT_LEDGER_FAMILY_ID, mIdx, year);
      if (res && res.ok) {
        refreshFeeViewsAfterStatusChange();
        lmsNotify(`${monthName} ${year} marked Paid (status — no payment recorded).`);
      } else {
        lmsNotify((res && res.error) || 'Could not update the month status.', { type: 'error' });
      }
    }

    async function ledgerMarkMonthUnpaid(monthName) {
      if (!CURRENT_LEDGER_FAMILY_ID) return;
      const mIdx = FEE_CONFIG.MONTHS.findIndex(m => m.toLowerCase() === String(monthName || '').toLowerCase());
      if (mIdx < 0) return;
      const ySel = document.getElementById('ledgerYearSelect');
      const year = ySel ? parseInt(ySel.value, 10) : new Date().getFullYear();
      const res = await markMonthUnpaid(CURRENT_LEDGER_FAMILY_ID, mIdx, year);
      if (res && res.ok) {
        refreshFeeViewsAfterStatusChange();
        lmsNotify(`${monthName} ${year} marked Unpaid — the month is due again.`);
      } else {
        lmsNotify((res && res.error) || 'Could not update the month status.', { type: 'error' });
      }
    }

    // Already paid for this family + month (non-cancelled records), so
    // the bulk record's remaining balance is honest for partial months.
    function bulkCollectPriorPaidForRow(row, records) {
      let sum = 0;
      (records || []).forEach(function (r) {
        if (r &&
          String(r.familyId || '').toUpperCase() === String(row.familyId).toUpperCase() &&
          String(r.month || '').trim().toLowerCase() === String(row.month).toLowerCase() &&
          parseInt(r.year, 10) === parseInt(row.year, 10) &&
          String(r.status || '').toLowerCase() !== 'cancelled') {
          sum += parseFloat(r.amountPaid || 0);
        }
      });
      return sum;
    }

    function togglePendingBulkSelectAll(checked) {
      const pageRows = PENDING_BULK_LAST_RENDERED || [];
      pageRows.forEach(function (r) {
        if (checked) PENDING_BULK_SELECTED[r.familyId] = true;
        else delete PENDING_BULK_SELECTED[r.familyId];
      });
      renderPendingDefaultersRows(CACHED_PENDING_FEE_LIST || []);
    }

    function updatePendingBulkSelection(checkbox) {
      if (!checkbox) return;
      if (checkbox.checked) PENDING_BULK_SELECTED[checkbox.value] = true;
      else delete PENDING_BULK_SELECTED[checkbox.value];
      syncPendingBulkUi();
    }

    function syncPendingBulkUi() {
      const bar = document.getElementById('feeBulkCollectBar');
      if (!bar) return;
      const countEl = document.getElementById('feeBulkCollectCount');
      const totalEl = document.getElementById('feeBulkCollectTotal');
      const runBtn = document.getElementById('btnBulkCollectRun');
      const warnEl = document.getElementById('feeBulkCollectDupWarn');
      const selectAllEl = document.getElementById('feeBulkSelectAll');
      if (!window.FeePhase2) {
        if (runBtn) runBtn.disabled = true;
        return;
      }
      const rows = window.FeePhase2.bulkCollectRows(CACHED_PENDING_FEE_LIST || []);
      const selectedIds = Object.keys(PENDING_BULK_SELECTED).filter(function (id) { return PENDING_BULK_SELECTED[id]; });
      const sel = window.FeePhase2.bulkCollectSelection(rows, selectedIds);
      if (countEl) countEl.innerText = sel.count === 0 ? '0 selected' : sel.count + ' selected';
      if (totalEl) {
        const parts = Object.keys(sel.totals).sort().map(function (cur) { return cur + ' ' + sel.totals[cur].toFixed(2); });
        totalEl.innerText = sel.count === 0 ? 'Total due: —' : 'Total due: ' + parts.join(' + ');
      }
      if (runBtn) runBtn.disabled = sel.count === 0;
      if (selectAllEl) {
        const pageRows = PENDING_BULK_LAST_RENDERED || [];
        selectAllEl.checked = pageRows.length > 0 && pageRows.every(function (r) { return PENDING_BULK_SELECTED[r.familyId]; });
      }
      if (warnEl) {
        const dups = window.FeePhase2.findBulkCollectDuplicates(getStoredFeeRecords(), sel.selected);
        if (dups.length > 0) {
          warnEl.classList.remove('hidden');
          warnEl.innerText = '⚠ ' + dups.length + ' selected famil' + (dups.length === 1 ? 'y' : 'ies') + ' already ha' + (dups.length === 1 ? 's' : 've') + ' a payment for this month — skipped by default (uncheck "Skip families that already paid" to charge them again).';
        } else {
          warnEl.classList.add('hidden');
          warnEl.innerText = '';
        }
      }
    }

    async function startBulkCollect() {
      if (!window.FeePhase2) {
        lmsNotify('Bulk Collect is not available right now. Please reload the page.', { type: 'error' });
        return;
      }
      const rows = window.FeePhase2.bulkCollectRows(CACHED_PENDING_FEE_LIST || []);
      const selectedIds = Object.keys(PENDING_BULK_SELECTED).filter(function (id) { return PENDING_BULK_SELECTED[id]; });
      const sel = window.FeePhase2.bulkCollectSelection(rows, selectedIds);
      if (sel.selected.length === 0) {
        lmsNotify('Select at least one pending family first.', { type: 'error' });
        return;
      }
      const method = document.getElementById('feeBulkCollectMethod')?.value || 'Online / Bank Transfer';
      const emailReceipts = !!document.getElementById('feeBulkCollectEmail')?.checked;
      const skipDup = document.getElementById('feeBulkCollectSkipDup')?.checked !== false;
      const records = getStoredFeeRecords();
      const dups = window.FeePhase2.findBulkCollectDuplicates(records, sel.selected);
      let runRows = sel.selected;
      let skippedCount = 0;
      if (skipDup && dups.length > 0) {
        const dupIds = {};
        dups.forEach(function (d) { dupIds[d.row.familyId] = true; });
        skippedCount = sel.selected.filter(function (r) { return dupIds[r.familyId]; }).length;
        runRows = sel.selected.filter(function (r) { return !dupIds[r.familyId]; });
      }
      if (runRows.length === 0) {
        lmsNotify('Every selected family already has a payment for this month — nothing to collect. Uncheck "Skip families that already paid" to charge them again.', { type: 'error' });
        return;
      }
      const btn = document.getElementById('btnBulkCollectRun');
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Collecting...';
      }
      const progEl = document.getElementById('feeBulkCollectProgress');
      if (progEl) {
        progEl.classList.remove('hidden');
        progEl.innerHTML = '<p class="text-[11px] font-bold text-slate-500">Collecting ' + runRows.length + ' payment(s)...</p><div id="feeBulkCollectRows" class="mt-1"></div>';
      }
      const summary = await window.FeePhase2.runBulkCollect(runRows, {
        paymentMethod: method,
        emailReceipts: emailReceipts,
        generateReceiptNo: window.generateReceiptNo,
        saveRecord: saveBulkFeePaymentRecord,
        sendEmail: function (rec) { return sendFeeInvoiceEmailModal(rec, true); },
        monthlyFeeForRow: function (row) {
          try {
            if (!row.family) return row.dueAmount;
            const idx = FEE_CONFIG.MONTHS.findIndex(function (m) { return m.toLowerCase() === String(row.month).toLowerCase(); });
            return feeFormApplicableFeeDetails(row.family, idx, row.year).fee;
          } catch (e) { return row.dueAmount; }
        },
        priorPaidForRow: function (row) { return bulkCollectPriorPaidForRow(row, records); },
        onRow: function (i, total, outcome) {
          const box = document.getElementById('feeBulkCollectRows');
          if (box) box.insertAdjacentHTML('beforeend', window.FeePhase2.bulkCollectRowResultHtml(outcome));
        }
      });
      if (progEl) progEl.insertAdjacentHTML('beforeend', window.FeePhase2.bulkCollectSummaryHtml(summary, skippedCount));
      // Refresh the dashboard + pending list (the collected families
      // leave the pending list); the reload clears the selection.
      await loadFeeDashboardStats();
      loadPendingDefaultersList();
      syncPendingBulkUi();
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-layer-group"></i> Collect Selected';
      }
    }

    // ============================================================
    // 4B. AUTO-REMINDER ON 4TH OF EVERY MONTH ENGINE
    // ============================================================
    function isMonthly4thAutoReminderEnabled() {
      const val = localStorage.getItem('alhuda_auto_fee_reminder_4th_enabled');
      return val === null ? true : val === 'true';
    }

    function toggleMonthly4thAutoReminder(enabled) {
      localStorage.setItem('alhuda_auto_fee_reminder_4th_enabled', enabled ? 'true' : 'false');
      initAndCheckMonthly4thAutoReminder();
      lmsNotify(enabled
        ? '✅ 4th of Every Month Auto-Reminder Activated!'
        : '⏸️ 4th of Every Month Auto-Reminder Paused.');
    }

    function initAndCheckMonthly4thAutoReminder() {
      const enabled = isMonthly4thAutoReminderEnabled();
      const toggleEl = document.getElementById('toggleAutoFeeReminder4th');
      const badgeEl = document.getElementById('badgeAutoReminder4thState');
      const statusEl = document.getElementById('autoFeeReminder4thStatusText');

      if (toggleEl) toggleEl.checked = enabled;

      const now = new Date();
      const curDay = now.getDate();
      const curMonthName = FEE_CONFIG.MONTHS[now.getMonth()] || 'September';
      const curYear = now.getFullYear();
      const sentKey = `alhuda_auto_4th_dispatched_${curYear}_${curMonthName}`;
      const alreadySentAt = localStorage.getItem(sentKey);

      if (badgeEl) {
        if (enabled) {
          badgeEl.className = 'px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800 border border-emerald-300';
          badgeEl.innerText = alreadySentAt ? `SENT FOR ${curMonthName.toUpperCase()}` : 'ACTIVE (4TH OF MONTH)';
        } else {
          badgeEl.className = 'px-2 py-0.5 rounded-full text-[10px] font-black bg-slate-200 text-slate-600 border border-slate-300';
          badgeEl.innerText = 'PAUSED';
        }
      }

      if (statusEl) {
        if (!enabled) {
          statusEl.innerText = '4th of Every Month Auto-Reminder is currently paused. Enable the toggle to auto-send on the 4th.';
        } else if (alreadySentAt) {
          const dStr = new Date(alreadySentAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
          statusEl.innerText = `✅ ${curMonthName} ${curYear} Auto-Reminder (4th of Month) has been automatically dispatched to pending parents (${dStr}).`;
        } else {
          statusEl.innerText = `Armed: Automatically dispatches official tuition fee reminder & receipt request emails to all pending parents on the 4th of every month (${curMonthName} 4, ${curYear}).`;
        }
      }

      // Automatic trigger on or after the 4th of the current month
      if (enabled && curDay >= 4 && !alreadySentAt && (CACHED_PENDING_FEE_LIST || []).length > 0) {
        localStorage.setItem(sentKey, now.toISOString());
        setTimeout(() => {
          sendBulkPendingFeeReminders(true);
          lmsNotify(`⚡ 4th of Month Auto-Reminder sent to ${CACHED_PENDING_FEE_LIST.length} pending families for ${curMonthName} ${curYear}!`);
          initAndCheckMonthly4thAutoReminder();
        }, 1200);
      }
    }

    // ============================================================
    // 4C. SEPARATE 3+ MONTHS DEFAULTERS AUTO-DETECTION & BULK EMAIL
    // ============================================================
    function calculateThreePlusMonthDefaulters(upToMonthName = 'September', upToYear = 2026) {
      const families = CACHED_FEE_FAMILIES || [];
      const records = getStoredFeeRecords();
      const overrides = getStoredMatrixOverrides();
      const targetYearInt = parseInt(upToYear, 10) || new Date().getFullYear();
      const targetMonthIdx = Math.max(0, FEE_CONFIG.MONTHS.findIndex(m => m.toLowerCase() === String(upToMonthName).toLowerCase()));

      // Build lookup map of payments per family_month_year
      const paidAmountMap = {};
      records.forEach(r => {
        // Fee Dashboard + Form Improvements: a cancelled record paid
        // nothing — it must not shrink a defaulter's arrears.
        if (isFeeRecordCancelled(r)) return;
        const fKey = `${String(r.familyId).toUpperCase()}_${String(r.month).toLowerCase()}_${parseInt(r.year, 10)}`;
        paidAmountMap[fKey] = (paidAmountMap[fKey] || 0) + parseFloat(r.amountPaid || 0) + parseFloat(r.discount || 0);
      });

      const defaulters3Plus = [];

      families.forEach(fam => {
        const famUpper = String(fam.id).toUpperCase();
        // Fee Dashboard + Form Improvements: a deactivated family is
        // never a defaulter.
        if (typeof isFamilyDeactivated === 'function' && isFamilyDeactivated(fam)) return;
        const monthlyFee = parseFloat(fam.monthly_fee || 0);
        if (monthlyFee <= 0) return;

        const unpaidMonths = [];
        let totalArrearsDue = 0;

        // Scan across 2025..targetYearInt up to targetMonthIdx
        const enrollInfo = getFamilyEnrollmentInfo(fam);
        const startYear = Math.min(enrollInfo.year || targetYearInt, targetYearInt);

        for (let yr = startYear; yr <= targetYearInt; yr++) {
          const maxM = (yr === targetYearInt) ? targetMonthIdx : 11;
          for (let mIdx = 0; mIdx <= maxM; mIdx++) {
            const mName = FEE_CONFIG.MONTHS[mIdx];
            const mLower = mName.toLowerCase();
            const overrideKey = `${famUpper}_${mLower}_${yr}`;
            const manualOverride = overrides[overrideKey];

            if (isFamilyPreAdmission(fam, mIdx, yr)) continue;
            if (manualOverride && manualOverride.status === 'not_enrolled') continue;

            const leaveCheck = checkFamilyLeaveInMonth(fam.id, mName, yr);
            if (leaveCheck.isLeave || (manualOverride && manualOverride.status === 'leave')) continue;
            if (manualOverride && manualOverride.status === 'paid') continue;

            // Fee Upgrade Phase 3: a month settled by an ADJ status row
            // is not a defaulter month (no money is due for it).
            if (isFamilyMonthStatusPaid(famUpper, mIdx, yr, records)) continue;

            const pKey = `${famUpper}_${mLower}_${yr}`;
            const paidSoFar = paidAmountMap[pKey] || 0;
            const remainingForMonth = feeFormApplicableFeeDetails(fam, mIdx, yr).fee - paidSoFar;

            if (remainingForMonth > 0.01) {
              unpaidMonths.push({
                label: `${mName.slice(0, 3)} ${yr}`,
                fullLabel: `${mName} ${yr}`,
                due: remainingForMonth
              });
              totalArrearsDue += remainingForMonth;
            }
          }
        }

        // Automatically include ONLY families with 3 or more unpaid months
        if (unpaidMonths.length >= 3) {
          const regStus = (fam.students || []).filter(s => (s.status || '').toLowerCase() !== 'trial');
          const stuNames = regStus.map(s => s.name).join(', ') || 'Enrolled Student';

          defaulters3Plus.push({
            family: fam,
            familyId: fam.id,
            parentName: fam.parent_name,
            studentsNames: stuNames,
            country: fam.country || 'International',
            whatsapp: fam.whatsapp || '',
            email: getFamilyEmailAddress(fam),
            currency: fam.currency || 'USD',
            monthlyFee,
            unpaidMonthsCount: unpaidMonths.length,
            unpaidMonths,
            unpaidMonthsText: unpaidMonths.map(u => u.fullLabel).join(', '),
            totalArrearsDue
          });
        }
      });

      // Sort by highest number of unpaid months first
      defaulters3Plus.sort((a, b) => b.unpaidMonthsCount - a.unpaidMonthsCount || b.totalArrearsDue - a.totalArrearsDue);
      CACHED_THREE_MONTH_DEFAULTERS = defaulters3Plus;

      const badge = document.getElementById('feeSubBadgeDefaulters');
      if (badge) badge.innerText = defaulters3Plus.length;

      const totalBadge = document.getElementById('feeDefaulters3PlusTotalBadge');
      if (totalBadge) totalBadge.innerText = `${defaulters3Plus.length} Defaulters (3+ Months)`;

      return defaulters3Plus;
    }

    function loadThreePlusDefaultersList() {
      const mSel = document.getElementById('feeDashMonthSelect');
      const ySel = document.getElementById('feeDashYearSelect');
      const targetMonth = mSel ? mSel.value : (FEE_CONFIG.MONTHS[new Date().getMonth()] || 'September');
      const targetYear = ySel ? parseInt(ySel.value, 10) : new Date().getFullYear();

      const list = calculateThreePlusMonthDefaulters(targetMonth, targetYear);
      renderThreePlusDefaultersRows(list);
    }

    function renderThreePlusDefaultersRows(list) {
      const tbody = document.getElementById('feeDefaulters3PlusTableBody');
      if (!tbody) return;

      const defPagerEl = document.getElementById('feeDefaultersTablePager');
      if (!list || list.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="7" class="p-8 text-center text-emerald-800 font-bold">
              <i class="fa-solid fa-shield-heart text-2xl text-emerald-600 block mb-1"></i>
              Alhamdulillah! Zero families have 3 or more months of pending tuition fees right now.
            </td>
          </tr>
        `;
        if (defPagerEl) defPagerEl.innerHTML = '';
        return;
      }

      // Batch 3.6 (audit P2-36): page the defaulters list (default 25).
      const defPage = paginateList(list, FEE_DEFAULTERS_PAGE, FEE_DEFAULTERS_PAGE_SIZE);
      FEE_DEFAULTERS_PAGE = defPage.safePage;

      tbody.innerHTML = defPage.pageRows.map(item => {
        const cleanPhone = (item.whatsapp || '').replace(/[^0-9]/g, '');
        const waMsg = (window.FeePhase4 && typeof window.FeePhase4.buildDefaulterWhatsAppMessage === 'function')
          ? window.FeePhase4.buildDefaulterWhatsAppMessage(item, academyName())
          : `Assalam-o-Alaikum Respected ${item.parentName},\nFee notice: ${item.currency} ${item.totalArrearsDue.toFixed(2)} outstanding for ${item.unpaidMonthsCount} months.`;
        const waUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(waMsg)}`;

        const displayedEmail = item.email
          ? ((typeof CURRENT_ROLE !== 'undefined' && CURRENT_ROLE === 'manager' && typeof maskStudentEmail === 'function') ? maskStudentEmail(item.email) : item.email)
          : '<span class="text-slate-400 italic text-[10px]">No Email on File</span>';

        const monthPills = item.unpaidMonths.map(u =>
          `<span class="inline-block px-2 py-0.5 rounded bg-rose-100 text-rose-800 border border-rose-300 font-bold text-[10px] mr-1 mb-1">${u.label}</span>`
        ).join('');

        return `
          <tr class="hover:bg-rose-50/40 transition">
            <td class="p-3 font-mono font-bold text-slate-800">${item.familyId}</td>
            <td class="p-3">
              <div class="font-bold text-slate-900">${item.parentName}</div>
              <div class="text-[11px] text-slate-500 font-mono">${displayedEmail}</div>
            </td>
            <td class="p-3 font-bold text-emerald-900">${item.studentsNames}</td>
            <td class="p-3 max-w-[260px]">
              <div class="flex flex-wrap">${monthPills}</div>
            </td>
            <td class="p-3 font-black font-mono text-rose-700 text-sm">${item.currency} ${item.totalArrearsDue.toFixed(2)}</td>
            <td class="p-3">
              <span class="px-2.5 py-1 rounded-full text-[10px] font-black bg-rose-600 text-white shadow-2xs">
                ${item.unpaidMonthsCount} Months Pending
              </span>
            </td>
            <td class="p-3 text-right space-x-1">
              <button onclick="selectFeeFamily('${item.familyId}')" class="px-2.5 py-1 bg-emerald-700 text-white rounded-lg text-xs font-bold hover:bg-emerald-800 transition">
                <i class="fa-solid fa-cash-register mr-1"></i>Collect
              </button>
              <button onclick="sendSingleDefaulter3PlusReminder('${item.familyId}')" class="px-2.5 py-1 bg-rose-700 text-white rounded-lg text-xs font-bold hover:bg-rose-800 transition inline-flex items-center gap-1">
                <i class="fa-solid fa-envelope"></i> Email Notice
              </button>
              ${CURRENT_ROLE !== 'manager' ? `
                <a href="${waUrl}" target="_blank" class="px-2.5 py-1 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-700 inline-flex items-center gap-1 transition">
                  <i class="fa-brands fa-whatsapp"></i>WhatsApp
                </a>
              ` : `
                <span class="px-2 py-1 bg-amber-50 text-amber-800 border border-amber-200 rounded-lg text-[10px] font-bold inline-flex items-center gap-1">
                  <i class="fa-solid fa-lock text-amber-500 text-[10px]"></i> Protected
                </span>
              `}
            </td>
          </tr>
        `;
      }).join('');
      if (defPagerEl) {
        defPagerEl.innerHTML = buildTablePagerHtml({
          page: FEE_DEFAULTERS_PAGE, totalPages: defPage.totalPages, total: list.length,
          start: defPage.start, end: defPage.end,
          pageSize: FEE_DEFAULTERS_PAGE_SIZE === Infinity ? 'all' : String(FEE_DEFAULTERS_PAGE_SIZE),
          onPage: 'setFeeDefaultersPage', onSize: 'setFeeDefaultersPageSize'
        });
      }
    }

    function filterThreePlusDefaultersLive() {
      const q = (document.getElementById('feeDefaulters3PlusSearchInput')?.value || '').trim().toLowerCase();
      const list = CACHED_THREE_MONTH_DEFAULTERS || [];
      if (!q) {
        renderThreePlusDefaultersRows(list);
        return;
      }
      const filtered = list.filter(item =>
        String(item.familyId).toLowerCase().includes(q) ||
        String(item.parentName).toLowerCase().includes(q) ||
        String(item.studentsNames).toLowerCase().includes(q) ||
        String(item.unpaidMonthsText).toLowerCase().includes(q)
      );
      renderThreePlusDefaultersRows(filtered);
    }

    function buildDefaulter3PlusEmail(item) {
      const offEmail = getOfficialAcademyEmail();
      const subject = `URGENT: Tuition Fee Overdue (${item.unpaidMonthsCount} Months Pending) — ${item.studentsNames} | ${academyName()}`;

      const plainText =
`Assalam-o-Alaikum Respected ${item.parentName},

We hope you and your family are well.

This is an urgent fee reminder from the Accounts Department of ${academyName()}. According to our billing ledger, your tuition fee has been pending for ${item.unpaidMonthsCount} months:

• Family ID: ${item.familyId}
• Enrolled Student(s): ${item.studentsNames}
• Pending Billing Months (${item.unpaidMonthsCount} Months): ${item.unpaidMonthsText}
• Total Outstanding Balance: ${item.currency} ${Number(item.totalArrearsDue || 0).toFixed(2)}

Since your tuition fee has now been pending for 3 or more months, we kindly request you to submit the overdue amount as soon as possible so that your child's classes continue smoothly without interruption.

📌 ALREADY PAID?
If you have already transferred the payment, kindly share the payment screenshot or bank receipt immediately by replying to this email (${offEmail}) or via WhatsApp so our accounts department can reconcile your record.

JazakAllahu Khairan for your prompt attention!

Finance & Accounts Department
${academyName()}
Official Email: ${offEmail}`;

      const htmlBody = `
        <div style="font-family:'Plus Jakarta Sans',Arial,sans-serif;max-width:600px;margin:0 auto;border:2px solid #fda4af;border-radius:16px;overflow:hidden;background:#ffffff;">
          <div style="background:linear-gradient(135deg,#881337,#be123c);color:#ffffff;padding:22px 24px;border-bottom:4px solid #f59e0b;">
            <h2 style="margin:0;font-size:18px;">AL-HUDA ISLAMIC CENTRE</h2>
            <p style="margin:4px 0 0;font-size:12px;color:#fde68a;font-weight:700;">URGENT NOTICE: ${item.unpaidMonthsCount} Months Tuition Fee Pending</p>
          </div>
          <div style="padding:24px;color:#1e293b;font-size:13.5px;line-height:1.6;">
            <p style="margin-top:0;"><strong>Assalam-o-Alaikum Respected ${item.parentName},</strong></p>
            <p>Our accounts ledger shows that the tuition fee for enrolled student(s) <strong>${item.studentsNames}</strong> has been <strong>pending for ${item.unpaidMonthsCount} months</strong>:</p>
            <div style="background:#fff1f2;border:1px solid #fecdd3;border-radius:12px;padding:14px 16px;margin:16px 0;">
              <div style="margin-bottom:6px;"><strong>Family ID:</strong> <span style="font-family:monospace;">${item.familyId}</span></div>
              <div style="margin-bottom:6px;"><strong>Enrolled Student(s):</strong> <span style="color:#881337;font-weight:700;">${item.studentsNames}</span></div>
              <div style="margin-bottom:6px;"><strong>Unpaid Months (${item.unpaidMonthsCount}):</strong> <span style="color:#be123c;font-weight:700;">${item.unpaidMonthsText}</span></div>
              <div style="font-size:15px;"><strong>Total Overdue Balance:</strong> <span style="color:#be123c;font-weight:800;font-family:monospace;">${item.currency} ${Number(item.totalArrearsDue || 0).toFixed(2)}</span></div>
            </div>
            <p>Since your tuition fee is overdue by <strong>3+ months</strong>, kindly clear the pending balance as soon as possible to avoid any interruption in classes.</p>
            <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:12px;padding:12px 16px;margin:16px 0;color:#14532d;font-size:12.5px;">
              <strong>📸 Already Paid? Share Screenshot / Receipt:</strong><br/>
              If you have already submitted the payment, please share the <strong>payment screenshot or transaction receipt</strong> via email (<a href="mailto:${offEmail}" style="color:#047857;font-weight:700;">${offEmail}</a>) or WhatsApp right away.
            </div>
            <p style="margin-bottom:0;">JazakAllahu Khairan,<br/><strong>Finance &amp; Accounts Department</strong><br/>${academyName()}</p>
          </div>
        </div>
      `;

      return { subject, plainText, htmlBody, offEmail };
    }

    function sendSingleDefaulter3PlusReminder(familyId) {
      const list = CACHED_THREE_MONTH_DEFAULTERS || [];
      const item = list.find(i => String(i.familyId).toUpperCase() === String(familyId).toUpperCase());
      if (!item) return;

      const { subject, plainText, htmlBody } = buildDefaulter3PlusEmail(item);

      if (typeof openEmailPreviewModal === 'function') {
        openEmailPreviewModal({
          type: 'defaulter_3plus_reminder',
          familyId: item.familyId,
          toEmail: item.email || '',
          toPhone: item.whatsapp || '',
          recipientName: item.parentName,
          subject,
          plainText,
          htmlBody
        });
      }
    }

    // Fee Dashboard + Form Improvements (#7): same single-flight
    // guard as Remind All — a second click while a send is running
    // sends nothing.
    async function sendBulkDefaulterReminders3Plus() {
      if (FEE_DEFAULTER_REMIND_RUNNING) return;
      FEE_DEFAULTER_REMIND_RUNNING = true;
      try {
        await sendBulkDefaulterReminders3PlusInner();
      } finally {
        FEE_DEFAULTER_REMIND_RUNNING = false;
      }
    }

    async function sendBulkDefaulterReminders3PlusInner() {
      const list = CACHED_THREE_MONTH_DEFAULTERS || [];
      if (list.length === 0) {
        lmsNotify('All clear! There are currently zero families in the 3+ Months Defaulters list.');
        return;
      }

      // Batch 2 (B16): manager path — per-family notify endpoint. The
      // Worker resolves each address server-side; the manager only sees
      // aggregate counts, never an address or who has one on file.
      if (CURRENT_ROLE === 'manager') {
        {
          // Fee Dashboard + Form Improvements (#7): same two-step
          // confirm as Remind All, with the brief's exact question.
          const cfgM3 = (window.FeePhase6 && typeof window.FeePhase6.remindAllConfirmConfig === 'function')
            ? window.FeePhase6.remindAllConfirmConfig({ kind: 'defaulters', total: list.length, withEmail: null, quotaNote: 'Sent securely to each family saved email address. Addresses are never shown to managers.' })
            : { title: 'Send Defaulter Reminders?', message: 'Are you sure you want to send fee reminders to all eligible families?', confirmText: 'Confirm & Send Reminders', cancelText: 'Cancel', variant: 'warning' };
          if (!(await lmsConfirm(cfgM3))) return;
        }
        const btnM3 = document.getElementById('btnRemindAll3PlusDefaulters');
        const origHtmlM3 = btnM3 ? btnM3.innerHTML : '';
        if (btnM3) {
          btnM3.disabled = true;
          btnM3.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>Sending Defaulter Notices...</span>`;
        }
        let sentM3 = 0;
        let failedM3 = 0;
        let quotaStoppedM3 = false;
        for (let i = 0; i < list.length; i++) {
          const item = list[i];
          try {
            const built = buildDefaulter3PlusEmail(item);
            if (typeof window.sendParentEmailViaNotify === 'function') {
              const res = await window.sendParentEmailViaNotify({
                familyId: item.familyId,
                subject: built.subject,
                text: built.plainText,
                html: built.htmlBody || built.plainText.replace(/\n/g, '<br/>')
              });
              if (res.success) sentM3++; else failedM3++;
              if (res && (res.quotaExceeded === true || res.quotaRemaining === 0)) quotaStoppedM3 = true;
            } else {
              failedM3++;
            }
          } catch (err) {
            failedM3++;
          }
          if (quotaStoppedM3) break;
        }
        if (btnM3) {
          btnM3.disabled = false;
          btnM3.innerHTML = origHtmlM3;
        }
        lmsNotify(`🚨 Processed urgent 3+ month overdue notices for ${list.length} families!`);
        lmsNotify(`🚨 3+ Months Defaulters Reminder Processed!\n\n• Total 3+ Month Defaulters: ${list.length}\n• Urgent Emails Sent Securely: ${sentM3}\n• Could Not Send (no email on file or an error): ${failedM3}${quotaStoppedM3 ? '\n• ⚠️ Sending stopped early: the daily email limit was reached, so the remaining reminders were NOT sent.' : ''}`);
        return;
      }

      const withEmail = list.filter(i => i.email && i.email.includes('@'));
      {
        // Fee Dashboard + Form Improvements (#7): same two-step
        // confirm as Remind All, with the brief's exact question.
        const cfg3 = (window.FeePhase6 && typeof window.FeePhase6.remindAllConfirmConfig === 'function')
          ? window.FeePhase6.remindAllConfirmConfig({ kind: 'defaulters', total: list.length, withEmail: withEmail.length })
          : { title: 'Send Defaulter Reminders?', message: 'Are you sure you want to send fee reminders to all eligible families?', confirmText: 'Confirm & Send Reminders', cancelText: 'Cancel', variant: 'warning' };
        if (!(await lmsConfirm(cfg3))) return;
      }

      const btn = document.getElementById('btnRemindAll3PlusDefaulters');
      const origHtml = btn ? btn.innerHTML : '';
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>Sending Defaulter Notices...</span>`;
      }

      // Batch 5 (B10): same truthful counting and the same safe batch
      // cap as Remind All — count only confirmed sends, treat failures
      // and exceptions as NOT sent, and stop when the quota is reached.
      let sentCount = 0;
      let failedCount = 0;
      let quotaStopped = false;
      const MAX_SAFE_BATCH = 85;
      const itemsToProcess = withEmail.slice(0, MAX_SAFE_BATCH);
      for (let i = 0; i < itemsToProcess.length; i++) {
        const item = itemsToProcess[i];
        const { subject, plainText, htmlBody, offEmail } = buildDefaulter3PlusEmail(item);
        let itemSent = false;
        let itemQuotaHit = false;
        try {
          if (typeof sendViaOfficialEmailRelay === 'function' || window.sendViaOfficialEmailRelay) {
            const fn = window.sendViaOfficialEmailRelay || sendViaOfficialEmailRelay;
            const relayRes = await fn({
              to: item.email,
              subject,
              text: plainText,
              html: htmlBody || plainText.replace(/\n/g, '<br/>'),
              senderName: `${academyName()} (${offEmail})`
            });
            itemSent = !!(relayRes && relayRes.success === true);
            if (relayRes && (relayRes.quotaExceeded === true || relayRes.quotaRemaining === 0)) itemQuotaHit = true;
          } else if (window.emailjs) {
            await emailjs.send('service_alhuda_lms', 'template_fee_invoice', {
              to_email: item.email,
              cc_email: offEmail,
              reply_to: offEmail,
              to_name: item.parentName,
              subject,
              message: plainText,
              html_content: htmlBody,
              from_name: `${academyName()} (${offEmail})`
            });
            itemSent = true;
          }
        } catch (err) {
          console.warn('[3+ Months Defaulter Email]', err);
          itemSent = false;
        }
        if (itemSent) sentCount++; else failedCount++;
        if (itemQuotaHit) { quotaStopped = true; break; }
      }

      if (btn) {
        btn.disabled = false;
        btn.innerHTML = origHtml;
      }

      lmsNotify(`🚨 Dispatched urgent 3+ month overdue notices to ${sentCount} families via Official Relay!`);
      lmsNotify(`🚨 3+ Months Defaulters Reminder Sent!\n\n• Total 3+ Month Defaulters: ${list.length}\n• Urgent Emails Dispatched via Official Relay: ${sentCount}\n• Not Sent: ${itemsToProcess.length - sentCount}${quotaStopped ? '\n• ⚠️ Sending stopped early: the daily email limit was reached, so the remaining reminders were NOT sent.' : ''}`);
    }


    // ============================================================
    // 5. MASTER ANNUAL FEE MATRIX (12-MONTH VIEW)
    // ============================================================
    // Fee Upgrade Phase 3: the matrix DATA builder, split out of
    // loadMasterAnnualMatrix so the Collect Fee status switcher can
    // reuse the exact same month states for any year without touching
    // the rendered matrix or its cache.
    function buildAnnualMatrixData(targetYear) {
      const families = CACHED_FEE_FAMILIES || [];
      const records = getStoredFeeRecords();
      const overrides = getStoredMatrixOverrides();

      const now = new Date();
      const currentRealYear = now.getFullYear();
      const currentRealMonthIdx = now.getMonth();

      // Build payment lookups: { [famId]: { [monthLower]: { paid, remaining, date, isAdvance } } }
      const famMonthMap = {};
      records.forEach(r => {
        if (parseInt(r.year, 10) === targetYear) {
          const fIdUpper = String(r.familyId).toUpperCase();
          const mLower = String(r.month).toLowerCase();

          // Fee Upgrade Phase 3: an ADJ status row is not money — it
          // never feeds paid/remaining. It only sets the statusPaid
          // flag, consulted in the month mapping below.
          if (isFeeStatusRowRecord(r)) {
            if (!famMonthMap[fIdUpper]) famMonthMap[fIdUpper] = {};
            if (!famMonthMap[fIdUpper][mLower]) {
              famMonthMap[fIdUpper][mLower] = { paid: 0, remaining: null, date: '', isAdvance: false, statusPaid: true };
            } else {
              famMonthMap[fIdUpper][mLower].statusPaid = true;
            }
            return;
          }

          const isAdv = String(r.status).toLowerCase().includes('advance');

          if (!famMonthMap[fIdUpper]) famMonthMap[fIdUpper] = {};
          if (!famMonthMap[fIdUpper][mLower]) {
            famMonthMap[fIdUpper][mLower] = {
              paid: parseFloat(r.amountPaid || 0),
              remaining: parseFloat(r.remainingBalance || 0),
              date: r.date || '',
              isAdvance: isAdv,
              hasReal: true
            };
          } else {
            famMonthMap[fIdUpper][mLower].paid += parseFloat(r.amountPaid || 0);
            famMonthMap[fIdUpper][mLower].remaining = parseFloat(r.remainingBalance || 0);
            famMonthMap[fIdUpper][mLower].hasReal = true;
            if (isAdv) famMonthMap[fIdUpper][mLower].isAdvance = true;
          }
        }
      });

      const matrixRows = families.map(fam => {
        const fIdUpper = String(fam.id).toUpperCase();
        const regStus = (fam.students || []).filter(s => (s.status || '').toLowerCase() !== 'trial');
        const stuNames = regStus.map(s => s.name).join(', ') || 'Enrolled Student';

        const enrollInfo = getFamilyEnrollmentInfo(fam);

        const months = FEE_CONFIG.MONTHS.map((mName, mIdx) => {
          const mLower = mName.toLowerCase();
          const overrideKey = `${fIdUpper}_${mLower}_${targetYear}`;
          const manualOverride = overrides[overrideKey];
          const feeRec = famMonthMap[fIdUpper] ? famMonthMap[fIdUpper][mLower] : null;

          // 1. Payment recorded (always takes priority if money was paid)
          // Fee Upgrade Phase 3: an ADJ-only entry has no real payment,
          // so it does NOT take this branch — see step 5 below.
          if (feeRec && feeRec.hasReal) {
            const isFull = (feeRec.remaining <= 0);
            return {
              month: mName,
              isPaid: isFull,
              isPartial: !isFull,
              isAdvance: !!feeRec.isAdvance,
              amountPaid: feeRec.paid,
              paymentDate: feeRec.date || ''
            };
          }

          // 2. Pre-Admission Check (Student joined in a later month: AUTOMATICALLY N/A!)
          const isPreAdm = isFamilyPreAdmission(fam, mIdx, targetYear);
          if (isPreAdm) {
            return {
              month: mName,
              isNotEnrolled: true,
              isPreAdmission: true,
              reason: `Joined ${enrollInfo.monthName} ${enrollInfo.year}`
            };
          }

          // 3. Manual override: not enrolled
          if (manualOverride && manualOverride.status === 'not_enrolled') {
            return { month: mName, isNotEnrolled: true, isPreAdmission: false, reason: 'Manual Override: Not Enrolled' };
          }

          // 4. Approved Leave (Fee Waived)
          const leaveCheck = checkFamilyLeaveInMonth(fam.id, mName, targetYear);
          if (manualOverride && manualOverride.status === 'leave') {
            return { month: mName, isLeave: true, note: manualOverride.notes || 'Approved Leave' };
          }
          if (leaveCheck.isLeave) {
            return { month: mName, isLeave: true, note: leaveCheck.reason };
          }

          // 5. Fee Upgrade Phase 3 — marked Paid by one-tap status
          // (ADJ row, no money) or by a legacy 'paid' override, which
          // the Pending list and the 360 view already honour but the
          // matrix never displayed. Placed AFTER leave on purpose: a
          // leave month stays a leave month, never a status-paid one.
          // Money always wins — step 1 above took the real-payment
          // branch when a real record exists, so a stale ADJ row can
          // never hide a real payment here.
          if ((feeRec && feeRec.statusPaid) || (manualOverride && manualOverride.status === 'paid')) {
            return { month: mName, isPaid: true, isStatusPaid: true, amountPaid: 0 };
          }

          // 6. Future vs Due
          const isFuture = (targetYear > currentRealYear || (targetYear === currentRealYear && mIdx > currentRealMonthIdx));
          return { month: mName, isFuture, isDue: !isFuture };
        });

        return {
          familyId: fam.id,
          parentName: fam.parent_name || 'Guardian',
          studentsNames: stuNames,
          monthlyFee: parseFloat(fam.monthly_fee || 0),
          currency: fam.currency || 'USD',
          months
        };
      });

      return matrixRows;
    }

    function loadMasterAnnualMatrix() {
      const ySel = document.getElementById('feeMatrixYearSelect');
      const targetYear = ySel ? parseInt(ySel.value, 10) : new Date().getFullYear();
      const tbody = document.getElementById('feeMatrixTableBody');
      if (!tbody) return;

      const matrixRows = buildAnnualMatrixData(targetYear);
      CACHED_ANNUAL_FEE_MATRIX = matrixRows;
      renderAnnualFeeMatrix(matrixRows);
    }

    function renderAnnualFeeMatrix(rows) {
      const tbody = document.getElementById('feeMatrixTableBody');
      if (!tbody) return;

      const matPagerEl = document.getElementById('feeMatrixTablePager');
      if (!rows || rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="15" class="p-8 text-center text-slate-400">No enrolled families found.</td></tr>`;
        if (matPagerEl) matPagerEl.innerHTML = '';
        return;
      }

      // Batch 3.6 (audit P2-36): page the matrix rows (default 25).
      const matPage = paginateList(rows, FEE_MATRIX_PAGE, FEE_MATRIX_PAGE_SIZE);
      FEE_MATRIX_PAGE = matPage.safePage;

      tbody.innerHTML = matPage.pageRows.map(r => {
        const monthsHtml = r.months.map(m => {
          let cellBg = 'bg-white';
          let cellContent = '';

          if (m.isPaid) {
            cellBg = 'bg-emerald-50';
            // Fee Upgrade Phase 3: a status-paid month carries no money
            // — show "Status" instead of a zero amount.
            cellContent = m.isStatusPaid ? `
              <span class="text-emerald-800 font-extrabold text-[10px] block"><i class="fa-solid fa-check mr-0.5"></i>Paid</span>
              <span class="text-emerald-700 font-bold text-[9px] block">Status</span>
            ` : `
              <span class="text-emerald-800 font-extrabold text-[10px] block"><i class="fa-solid fa-check mr-0.5"></i>Paid</span>
              <span class="text-emerald-700 font-bold font-mono text-[9px] block">${r.currency} ${m.amountPaid.toFixed(0)}</span>
              ${m.isAdvance ? '<span class="text-[8px] font-black text-teal-700 block uppercase">ADV</span>' : ''}
            `;
          } else if (m.isLeave) {
            cellBg = 'bg-blue-50';
            cellContent = `<span class="text-blue-700 font-bold text-[10px] block"><i class="fa-solid fa-plane-departure mr-0.5"></i>Leave</span>`;
          } else if (m.isNotEnrolled) {
            cellBg = 'bg-slate-100';
            cellContent = `<span class="text-slate-400 font-bold text-[10px] block" title="${m.reason || 'Not Enrolled / Pre-Admission'}">N/A</span>`;
          } else if (m.isPartial) {
            cellBg = 'bg-amber-50';
            cellContent = `
              <span class="text-amber-800 font-bold text-[10px] block">Part</span>
              <span class="text-amber-700 font-mono text-[9px] block">${r.currency} ${m.amountPaid.toFixed(0)}</span>
            `;
          } else if (m.isFuture) {
            cellContent = `<span class="text-slate-300 text-[10px]">--</span>`;
          } else {
            cellBg = 'bg-rose-50';
            cellContent = `<span class="text-rose-700 font-extrabold text-[10px] block"><i class="fa-solid fa-xmark mr-0.5"></i>Due</span>`;
          }

          return `
            <td onclick="openMatrixActionModal('${r.familyId}', '${m.month}')" class="${cellBg} p-1.5 border border-slate-200 cursor-pointer hover:ring-2 hover:ring-emerald-500/50 transition" title="Click to override status or collect fee">
              ${cellContent}
            </td>
          `;
        }).join('');

        return `
          <tr class="hover:bg-slate-50 transition">
            <td class="p-2.5 text-left font-mono font-bold text-slate-800 bg-white sticky left-0 z-20 shadow-[2px_0_5px_rgba(0,0,0,0.06)]">
              <button onclick="openFamily360Profile('${r.familyId}')" class="hover:text-brandEmerald hover:underline font-black text-brandDark">${r.familyId}</button>
            </td>
            <td class="p-2.5 text-left bg-white sticky left-[90px] z-20 shadow-[2px_0_5px_rgba(0,0,0,0.06)]">
              <button onclick="openFamily360Profile('${r.familyId}')" class="text-slate-900 hover:text-brandEmerald hover:underline font-bold block truncate max-w-[130px] sm:max-w-none text-left">${r.studentsNames}</button>
              <button onclick="openFamily360Profile('${r.familyId}')" class="text-[10px] text-slate-500 hover:text-emerald-700 block truncate max-w-[130px] sm:max-w-none text-left">${r.parentName} (${r.currency} ${r.monthlyFee.toFixed(0)}/m)</button>
            </td>
            ${monthsHtml}
            <td class="p-2 text-center bg-slate-50/50">
              <div class="inline-flex items-center gap-1">
                <button onclick="openFamily360Profile('${r.familyId}')" class="px-2 py-1 bg-brandDark hover:bg-brandDarkest text-white rounded-lg text-[10px] font-bold transition shadow-2xs" title="Open Family 360° Profile">
                  360°
                </button>
                <button onclick="openFamilyAnnualLedgerModal('${r.familyId}')" class="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[10px] font-bold transition shadow-2xs" title="View Full 12-Month Ledger">
                  Ledger
                </button>
              </div>
            </td>
          </tr>
        `;
      }).join('');
      if (matPagerEl) {
        matPagerEl.innerHTML = buildTablePagerHtml({
          page: FEE_MATRIX_PAGE, totalPages: matPage.totalPages, total: rows.length,
          start: matPage.start, end: matPage.end,
          pageSize: FEE_MATRIX_PAGE_SIZE === Infinity ? 'all' : String(FEE_MATRIX_PAGE_SIZE),
          onPage: 'setFeeMatrixPage', onSize: 'setFeeMatrixPageSize'
        });
      }
    }

    function filterAnnualFeeMatrixLive() {
      const q = (document.getElementById('feeMatrixSearchInput')?.value || '').trim().toLowerCase();
      const rows = CACHED_ANNUAL_FEE_MATRIX || [];

      if (!q) {
        renderAnnualFeeMatrix(rows);
        return;
      }

      const filtered = rows.filter(r => {
        return String(r.familyId).toLowerCase().includes(q) ||
               String(r.parentName).toLowerCase().includes(q) ||
               String(r.studentsNames).toLowerCase().includes(q);
      });

      renderAnnualFeeMatrix(filtered);
    }

    // Matrix Quick Action Popover
    function openMatrixActionModal(famId, month) {
      const fam = (CACHED_FEE_FAMILIES || []).find(f => String(f.id).toUpperCase() === String(famId).toUpperCase());
      const row = (CACHED_ANNUAL_FEE_MATRIX || []).find(r => String(r.familyId).toUpperCase() === String(famId).toUpperCase());
      if (!row) return;

      const m = (row.months || []).find(item => item.month.toLowerCase() === month.toLowerCase()) || {};
      const yrSelect = document.getElementById('feeMatrixYearSelect');
      const year = yrSelect ? parseInt(yrSelect.value, 10) : new Date().getFullYear();
      const enrollInfo = getFamilyEnrollmentInfo(fam);

      let statusHtml = '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800">Due / Unpaid</span>';
      // Fee Upgrade Phase 3: a status-paid month carries no money — the
      // badge says so instead of showing a zero amount.
      if (m.isPaid && m.isStatusPaid) {
        statusHtml = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">Paid (Status — no payment recorded)</span>`;
      } else if (m.isPaid) {
        statusHtml = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">Paid (${row.currency} ${m.amountPaid || 0})</span>`;
      } else if (m.isLeave) {
        statusHtml = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800">Approved Leave</span>`;
      } else if (m.isNotEnrolled) {
        statusHtml = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-200 text-slate-700">Not Enrolled ${m.isPreAdmission ? '(Pre-Admission)' : ''}</span>`;
      } else if (m.isPartial) {
        statusHtml = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">Partial (${row.currency} ${m.amountPaid || 0})</span>`;
      } else if (m.isFuture) {
        statusHtml = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600">Upcoming Month</span>`;
      }

      CURRENT_MATRIX_ACTION_DATA = {
        familyId: row.familyId,
        month,
        year,
        studentName: row.studentsNames || row.parentName
      };

      document.getElementById('matrixActionStudentName').innerText = row.studentsNames || row.parentName;
      document.getElementById('matrixActionSubtitle').innerText = `Family ID: ${row.familyId} • ${month} ${year}`;
      const admInfoEl = document.getElementById('matrixActionAdmissionInfo');
      if (admInfoEl) {
        admInfoEl.innerHTML = `<i class="fa-solid fa-calendar-check mr-1"></i>Admitted: <strong>${enrollInfo.monthName} ${enrollInfo.year}</strong> ${enrollInfo.source === 'manual_override' ? '<span class="text-[9px] text-amber-700">(Custom)</span>' : '<span class="text-[9px] text-emerald-600">(LMS Date)</span>'}`;
      }
      document.getElementById('matrixActionStatusBadge').innerHTML = statusHtml;

      // Fee Upgrade Phase 3: one-tap Paid / Unpaid buttons for this
      // month. A real payment always wins — when one exists, the buttons
      // point at Undo Payment instead of offering a status toggle.
      const statusBtnsEl = document.getElementById('matrixActionStatusButtons');
      if (statusBtnsEl && window.FeePhase3) {
        let realReceiptNo = '';
        try {
          const mIdx = FEE_CONFIG.MONTHS.findIndex(mm => mm.toLowerCase() === month.toLowerCase());
          const realRec = window.FeePhase3.findRealPaymentForMonth(getStoredFeeRecords(), row.familyId, mIdx, year);
          realReceiptNo = realRec ? (realRec.receiptNo || '') : '';
        } catch (e) { realReceiptNo = ''; }
        statusBtnsEl.innerHTML = window.FeePhase3.matrixStatusButtonsHtml(window.FeePhase3.uiStateForMonth(m), realReceiptNo);
      }

      openModal('modalMatrixAction');
    }

    async function applyMatrixAction(actionType) {
      if (!CURRENT_MATRIX_ACTION_DATA) return;
      const { familyId, month, year } = CURRENT_MATRIX_ACTION_DATA;
      const fIdUpper = String(familyId).toUpperCase();
      const mLower = String(month).toLowerCase();
      const mIdx = FEE_CONFIG.MONTHS.findIndex(m => m.toLowerCase() === mLower);
      const targetYearInt = parseInt(year, 10);

      const overrides = getStoredMatrixOverrides();
      const overrideKey = `${fIdUpper}_${mLower}_${year}`;
      const admKey = `ADMISSION_${fIdUpper}`;

      // Fee Upgrade Phase 3: one-tap Paid / Unpaid for this month.
      if (actionType === 'mark_paid' || actionType === 'mark_unpaid') {
        const res = actionType === 'mark_paid'
          ? await markMonthPaid(familyId, mIdx, targetYearInt)
          : await markMonthUnpaid(familyId, mIdx, targetYearInt);
        closeModal('modalMatrixAction');
        if (res && res.ok) {
          refreshFeeViewsAfterStatusChange();
          lmsNotify(actionType === 'mark_paid'
            ? `${month} ${year} marked Paid (status — no payment recorded).`
            : `${month} ${year} marked Unpaid — the month is due again.`);
        } else {
          lmsNotify((res && res.error) || 'Could not update the month status.', { type: 'error' });
        }
        return;
      }

      if (actionType === 'set_admission_date') {
        // Sets this family's admission month & year to this selected
        // month (shared helper — the Collect Fee switcher uses it too).
        setFamilyAdmissionDate(familyId, mIdx, targetYearInt);
        closeModal('modalMatrixAction');
        loadMasterAnnualMatrix();
        loadFeeDashboardStats();
        lmsNotify(`Admission set to ${month} ${year}! All prior months are automatically N/A ($0 fee & 0 arrears).`);
        return;
      }

      if (actionType === 'not_enrolled') {
        // Mark this month as not enrolled. Also auto-exclude all prior months!
        overrides[overrideKey] = {
          familyId,
          month,
          year: targetYearInt,
          status: 'not_enrolled',
          notes: 'Not Enrolled (Joined Later)'
        };

        // Set admission date to the next month if this was on/after current admission date
        const famObj = (CACHED_FEE_FAMILIES || []).find(f => String(f.id).toUpperCase() === fIdUpper);
        const currentEnroll = getFamilyEnrollmentInfo(famObj);
        const currentEnrollScore = currentEnroll.year * 100 + currentEnroll.monthIndex;
        const thisScore = targetYearInt * 100 + mIdx;
        if (thisScore >= currentEnrollScore) {
          const nextIdx = (mIdx + 1) % 12;
          const nextYear = targetYearInt + Math.floor((mIdx + 1) / 12);
          overrides[admKey] = {
            year: nextYear,
            monthIndex: nextIdx,
            monthName: FEE_CONFIG.MONTHS[nextIdx],
            updatedAt: new Date().toISOString()
          };
        }

        // Auto-mark any months before this month as not_enrolled as well
        FEE_CONFIG.MONTHS.forEach((nm, idx) => {
          if (idx < mIdx) {
            overrides[`${fIdUpper}_${nm.toLowerCase()}_${targetYearInt}`] = {
              familyId,
              month: nm,
              year: targetYearInt,
              status: 'not_enrolled',
              notes: 'Not Enrolled (Prior to Admission)'
            };
          }
        });

        saveStoredMatrixOverrides(overrides);
        syncMatrixOverridesToCloud(familyId, overrides);
        closeModal('modalMatrixAction');
        loadMasterAnnualMatrix();
        loadFeeDashboardStats();
        lmsNotify(`${month} and all prior months marked as Not Enrolled (N/A)! Arrears cleared.`);
        return;
      }

      if (actionType === 'clear') {
        delete overrides[overrideKey];
        if (overrides[admKey] && overrides[admKey].year === targetYearInt && overrides[admKey].monthIndex === mIdx) {
          delete overrides[admKey];
        }
      } else if (actionType === 'leave') {
        overrides[overrideKey] = {
          familyId,
          month,
          year: targetYearInt,
          status: 'leave',
          notes: 'Approved Leave (Fee Waived)'
        };
      }

      saveStoredMatrixOverrides(overrides);
      syncMatrixOverridesToCloud(familyId, overrides);
      closeModal('modalMatrixAction');

      // Optimistic instant re-render of matrix & stats
      loadMasterAnnualMatrix();
      loadFeeDashboardStats();
      lmsNotify(`Status updated for ${month} ${year}!`);
    }

    function proceedToCollectFromMatrixModal() {
      if (!CURRENT_MATRIX_ACTION_DATA) return;
      const { familyId, month, year } = CURRENT_MATRIX_ACTION_DATA;
      closeModal('modalMatrixAction');
      selectFeeFamily(familyId);

      const mSelect = document.getElementById('feeFormMonth');
      if (mSelect) mSelect.value = month;
      const ySelect = document.getElementById('feeFormYear');
      if (ySelect) ySelect.value = String(year);
      triggerFeeBalanceRecalc();
    }

    // ============================================================
    // 6. FAMILY ANNUAL LEDGER MODAL
    // ============================================================
    function openFamilyAnnualLedgerModal(famId) {
      CURRENT_LEDGER_FAMILY_ID = famId;
      const fam = (CACHED_FEE_FAMILIES || []).find(f => String(f.id).toUpperCase() === String(famId).toUpperCase());
      if (!fam) return;

      const ySel = document.getElementById('ledgerYearSelect');
      const year = ySel ? parseInt(ySel.value, 10) : new Date().getFullYear();

      document.getElementById('familyLedgerSubtitle').innerText = `Family ID: ${fam.id} • Parent: ${fam.parent_name}`;
      document.getElementById('ledgerParentName').innerText = fam.parent_name || 'Parent / Guardian';
      
      const regStus = (fam.students || []).filter(s => (s.status || '').toLowerCase() !== 'trial');
      document.getElementById('ledgerStudentsNames').innerText = regStus.map(s => s.name).join(', ') || 'Enrolled Student';
      const availCredit = getFamilyAvailableAdvanceCredit(famId);
      const displayedPhone = (CURRENT_ROLE === 'manager') ? maskStudentPhone(fam.whatsapp || '') : (fam.whatsapp || '--');
      document.getElementById('ledgerContactInfo').innerHTML = `${fam.country || 'International'} • WhatsApp: ${displayedPhone} • <span class="text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200"><i class="fa-solid fa-wallet mr-1"></i>Advance Credit: ${fam.currency || 'USD'} ${availCredit.toFixed(2)}</span>`;
      document.getElementById('ledgerMonthlyFee').innerText = `${fam.currency || 'USD'} ${parseFloat(fam.monthly_fee || 0).toFixed(2)}`;

      // Render 12 months status cards
      const matrixRow = (CACHED_ANNUAL_FEE_MATRIX || []).find(r => String(r.familyId).toUpperCase() === String(famId).toUpperCase());
      const grid = document.getElementById('ledgerMonthsGrid');
      if (grid) {
        grid.innerHTML = '';
        const monthsList = matrixRow ? matrixRow.months : FEE_CONFIG.MONTHS.map(m => ({ month: m, isFuture: true }));
        
        monthsList.forEach(m => {
          const card = document.createElement('div');
          card.className = 'p-3 bg-white border border-slate-200 rounded-xl space-y-1 shadow-2xs';

          let statusBadge = '<span class="text-rose-700 font-bold text-[10px]"><i class="fa-solid fa-xmark mr-0.5"></i>Due</span>';
          // Fee Upgrade Phase 3: a status-paid month carries no money —
          // the badge and the line say so instead of showing zero.
          if (m.isPaid && m.isStatusPaid) statusBadge = '<span class="text-emerald-700 font-bold text-[10px]"><i class="fa-solid fa-check mr-0.5"></i>Paid (Status)</span>';
          else if (m.isPaid) statusBadge = '<span class="text-emerald-700 font-bold text-[10px]"><i class="fa-solid fa-check mr-0.5"></i>Paid</span>';
          else if (m.isLeave) statusBadge = '<span class="text-blue-700 font-bold text-[10px]"><i class="fa-solid fa-plane-departure mr-0.5"></i>Leave</span>';
          else if (m.isNotEnrolled) statusBadge = '<span class="text-slate-400 font-bold text-[10px]">N/A</span>';
          else if (m.isPartial) statusBadge = '<span class="text-amber-700 font-bold text-[10px]">Partial</span>';
          else if (m.isFuture) statusBadge = '<span class="text-slate-300 text-[10px]">Upcoming</span>';

          card.innerHTML = `
            <div class="flex justify-between items-center text-xs font-extrabold border-b border-slate-100 pb-1">
              <span class="text-slate-800">${m.month}</span>
              ${statusBadge}
            </div>
            <div class="text-[10px] text-slate-500 pt-0.5">
              ${m.isStatusPaid ? 'Marked Paid (status — no payment)' : (m.isPaid ? `Paid: <strong class="text-emerald-700">${fam.currency} ${m.amountPaid || 0}</strong>` : (m.isLeave ? 'Approved Leave' : (m.isNotEnrolled ? 'Not Enrolled' : 'Tuition Due')))}
            </div>
            ${window.FeePhase3 ? window.FeePhase3.ledgerStatusButtonHtml(window.FeePhase3.uiStateForMonth(m), m.month) : ''}
          `;
          grid.appendChild(card);
        });
      }

      // Render Transaction History
      // Fee Upgrade Phase 3: ADJ status rows are not receipts — they
      // never appear in the transaction list.
      const records = getStoredFeeRecords().filter(r => String(r.familyId).toUpperCase() === String(famId).toUpperCase() && !isFeeStatusRowRecord(r));
      const tbody = document.getElementById('ledgerTransactionsTableBody');
      if (tbody) {
        if (records.length === 0) {
          tbody.innerHTML = `<tr><td colspan="8" class="p-4 text-center text-slate-400 text-xs">No receipts recorded yet for this family.</td></tr>`;
        } else {
          tbody.innerHTML = records.map(r => `
            <tr class="hover:bg-slate-50 transition">
              <td class="p-2.5 font-mono font-bold text-slate-800">${r.receiptNo}</td>
              <td class="p-2.5 text-slate-500 font-mono">${r.date}</td>
              <td class="p-2.5 font-medium text-slate-800">${r.month} ${r.year}</td>
              <td class="p-2.5 font-bold font-mono text-emerald-700">${r.currency} ${parseFloat(r.amountPaid || 0).toFixed(2)}</td>
              <td class="p-2.5 font-mono text-rose-700">${r.currency} ${parseFloat(r.remainingBalance || 0).toFixed(2)}</td>
              <td class="p-2.5">
                <span class="px-1.5 py-0.5 rounded text-[9px] font-bold ${r.remainingBalance > 0 ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}">${r.status}</span>
                ${parseFloat(r.excessPaid || 0) > 0 ? `<span class="block text-[8px] font-bold text-cyan-700 mt-0.5">+${r.currency} ${parseFloat(r.excessPaid).toFixed(0)} Credit</span>` : ''}
                ${parseFloat(r.creditDeducted || 0) > 0 ? `<span class="block text-[8px] font-bold text-purple-700 mt-0.5">-${r.currency} ${parseFloat(r.creditDeducted).toFixed(0)} Used</span>` : ''}
              </td>
              <td class="p-2.5 text-slate-500">${r.paymentMethod || 'Online'}</td>
              <td class="p-2.5 text-right">
                <button onclick="openFeeInvoiceModal(${JSON.stringify(r).replace(/"/g, '&quot;')})" class="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[10px] font-bold">
                  Receipt
                </button>
              </td>
            </tr>
          `).join('');
        }
      }

      openModal('modalFamilyAnnualLedger');
    }

    function reloadFamilyLedgerData() {
      if (CURRENT_LEDGER_FAMILY_ID) {
        openFamilyAnnualLedgerModal(CURRENT_LEDGER_FAMILY_ID);
      }
    }

    function ledgerCollectFeeNow() {
      if (!CURRENT_LEDGER_FAMILY_ID) return;
      closeModal('modalFamilyAnnualLedger');
      selectFeeFamily(CURRENT_LEDGER_FAMILY_ID);
    }

    // ============================================================
    // 7. RECEIPTS LEDGER & HISTORY
    // ============================================================
    function loadFeeReceiptsHistory() {
      const records = getStoredFeeRecords();
      renderFeeReceiptsHistoryRows(records);
      syncFeeReceiptsMonthChip();
      if (window.FeePhase1 && typeof window.FeePhase1.loadFeeDueInvoicesList === 'function') {
        window.FeePhase1.loadFeeDueInvoicesList();
      }
    }

    // Fee Upgrade Phase 1 — Undo button for the newest payment row only.
    // Reads the FULL stored records (not the filtered view), so a search
    // filter can never make an older row look newest. Cancelled rows get
    // neither a button nor a hint.
    function feeReceiptUndoCellHtml(r) {
      if (!r || !r.receiptNo) return '';
      if (String(r.status || '').toLowerCase().indexOf('cancel') !== -1) return '';
      if (!window.FeePhase1 || typeof window.FeePhase1.isNewestPaymentRow !== 'function') return '';
      const all = (typeof getStoredFeeRecords === 'function') ? (getStoredFeeRecords() || []) : [];
      const chk = window.FeePhase1.isNewestPaymentRow(all, r.receiptNo);
      if (chk.ok) {
        return `<button onclick="window.FeePhase1.requestUndoFeePayment('${String(r.receiptNo).replace(/'/g, "\\'")}')" class="px-3 py-1 bg-amber-100 hover:bg-amber-200 text-amber-800 border border-amber-300 rounded-xl text-xs font-bold transition inline-flex items-center gap-1" title="Undo this payment"><i class="fa-solid fa-rotate-left"></i> Undo</button>`;
      }
      return `<span class="block text-[10px] text-slate-400 mt-1">Only the newest payment can be undone</span>`;
    }

    function renderFeeReceiptsHistoryRows(records) {
      const tbody = document.getElementById('feeReceiptsTableBody');
      if (!tbody) return;

      // Fee Upgrade Phase 3: ADJ status rows are not receipts — they
      // never appear in the Receipts list (same as the Phase 1
      // due-invoice rows, filtered one step earlier).
      const visible = (records || []).filter(r => {
        if (isFeeStatusRowRecord(r)) return false;
        if (FEE_RECEIPTS_MONTH_FILTER) {
          if (window.FeePhase6 && typeof window.FeePhase6.isReceiptInMonth === 'function') {
            return window.FeePhase6.isReceiptInMonth(r, FEE_RECEIPTS_MONTH_FILTER.monthIdx, FEE_RECEIPTS_MONTH_FILTER.year);
          }
          return String(r.month).toLowerCase() === (FEE_CONFIG.MONTHS[FEE_RECEIPTS_MONTH_FILTER.monthIdx] || '').toLowerCase()
            && parseInt(r.year, 10) === FEE_RECEIPTS_MONTH_FILTER.year
            && String(r.status || '').toLowerCase().indexOf('cancel') === -1;
        }
        return true;
      });

      if (!visible || visible.length === 0) {
        tbody.innerHTML = `<tr><td colspan="11" class="p-8 text-center text-slate-400">No payment receipts recorded yet.</td></tr>`;
        return;
      }

      tbody.innerHTML = visible.map(r => `
        <tr class="hover:bg-slate-50 transition">
          <td class="p-3 font-mono font-bold text-slate-800">${r.receiptNo}</td>
          <td class="p-3 text-slate-500 font-mono">${r.date}</td>
          <td class="p-3 font-mono font-bold text-emerald-900">${r.familyId}</td>
          <td class="p-3 font-bold text-slate-900">${r.parentName}</td>
          <td class="p-3 text-emerald-900 font-medium">${r.studentsNames}</td>
          <td class="p-3 font-medium text-slate-700">${r.month} ${r.year}</td>
          <td class="p-3 font-mono text-slate-600">${r.currency} ${parseFloat(r.totalPayable || 0).toFixed(2)}</td>
          <td class="p-3 font-mono font-bold text-emerald-700">${r.currency} ${parseFloat(r.amountPaid || 0).toFixed(2)}</td>
          <td class="p-3 font-mono font-bold text-rose-700">${r.currency} ${parseFloat(r.remainingBalance || 0).toFixed(2)}</td>
          <td class="p-3"><span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${r.remainingBalance > 0 ? 'bg-amber-100 text-amber-800 border border-amber-200' : 'bg-emerald-100 text-emerald-800 border border-emerald-200'}">${r.status}</span></td>
          <td class="p-3 text-right">
            <button onclick="openFeeInvoiceModal(${JSON.stringify(r).replace(/"/g, '&quot;')})" class="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition flex items-center gap-1 inline-flex">
              <i class="fa-solid fa-receipt text-slate-500"></i> Voucher
            </button>
            ${feeReceiptPdfCellHtml(r)}
            ${feeReceiptUndoCellHtml(r)}
          </td>
        </tr>
      `).join('');
    }

    function filterFeeReceiptsHistoryLive() {
      const q = (document.getElementById('feeReceiptsSearchInput')?.value || '').trim().toLowerCase();
      // Fee Dashboard + Form Improvements: a text search replaces the
      // Paid-KPI month filter instead of stacking on top of it.
      if (q) clearFeeReceiptsMonthFilter();
      const records = getStoredFeeRecords();

      if (!q) {
        renderFeeReceiptsHistoryRows(records);
        return;
      }

      const filtered = records.filter(r => {
        return String(r.receiptNo).toLowerCase().includes(q) ||
               String(r.familyId).toLowerCase().includes(q) ||
               String(r.parentName).toLowerCase().includes(q) ||
               String(r.studentsNames).toLowerCase().includes(q);
      });

      renderFeeReceiptsHistoryRows(filtered);
    }


    async function loadCourses() {
      const { data: courses } = await db.from('courses').select('*');
      const cSelect = document.getElementById('stuCourseId');
      if (cSelect) {
        cSelect.innerHTML = (courses || []).map(c => `<option value="${c.id}">${c.name}</option>`).join('');
      }
    }


    // ============================================================
    // FEE UPGRADE PHASE 4 — SMALL WINS (#6, #11, #19, #42/#50, #31, #66, #70)
    // ============================================================

    // ---- #6 — Universal search (families / fee records / receipts) ----
    function openUniversalSearchModal() {
      openModal('modalUniversalSearch');
      const input = document.getElementById('txtUniversalSearch');
      if (input) { input.value = ''; input.focus(); }
      const box = document.getElementById('universalSearchResults');
      if (box) box.innerHTML = '<p class="text-xs text-slate-500 font-semibold">Type at least 2 characters to search across loaded families, fee records and receipts.</p>';
    }

    function runUniversalSearch() {
      const box = document.getElementById('universalSearchResults');
      const q = (document.getElementById('txtUniversalSearch')?.value || '').trim();
      if (!box) return;
      if (!window.FeePhase4) {
        box.innerHTML = '<p class="text-xs text-rose-600 font-bold">Search is unavailable right now. Please reload the page.</p>';
        return;
      }
      if (q.length < 2) {
        box.innerHTML = '<p class="text-xs text-slate-500 font-semibold">Type at least 2 characters to search.</p>';
        return;
      }
      const res = window.FeePhase4.universalSearch({ families: CACHED_FEE_FAMILIES || [], records: getStoredFeeRecords(), query: q });
      if (res.families.length === 0 && res.receipts.length === 0) {
        box.innerHTML = '<p class="text-xs text-slate-500 font-semibold">No family or receipt matches "' + window.FeePhase4.esc(q) + '".</p>';
        return;
      }
      let html = '';
      if (res.families.length) {
        html += '<div><p class="text-[11px] font-extrabold uppercase tracking-wider text-slate-400 mb-1">Families (' + res.families.length + ')</p>' + res.families.map(f => window.FeePhase4.universalSearchFamilyRowHtml(f)).join('') + '</div>';
      }
      if (res.receipts.length) {
        html += '<div><p class="text-[11px] font-extrabold uppercase tracking-wider text-slate-400 mb-1">Receipts (' + res.receipts.length + ')</p>' + res.receipts.map(r => window.FeePhase4.universalSearchReceiptRowHtml(r)).join('') + '</div>';
      }
      box.innerHTML = html;
    }

    function selectFeeFamilyFromSearch(familyId) {
      closeModal('modalUniversalSearch');
      selectFeeFamily(familyId);
    }

    function openFeeReceiptFromSearch(receiptNo) {
      const rec = (getStoredFeeRecords() || []).find(r => String(r.receiptNo) === String(receiptNo));
      if (!rec) { lmsNotify('That receipt could not be found.'); return; }
      closeModal('modalUniversalSearch');
      openFeeInvoiceModal(rec);
    }

    // ---- #11 — Currency drill-down (per-family rows + previous months) ----
    function openCurrencyDetailModal(currency) {
      const cur = String(currency || '').toUpperCase();
      const mSel = document.getElementById('feeDashMonthSelect');
      const ySel = document.getElementById('feeDashYearSelect');
      const monthName = mSel ? mSel.value : (FEE_CONFIG.MONTHS[new Date().getMonth()] || 'September');
      const year = ySel ? parseInt(ySel.value, 10) : new Date().getFullYear();
      const monthIdx = FEE_CONFIG.MONTHS.findIndex(m => m.toLowerCase() === String(monthName).toLowerCase());
      const title = document.getElementById('currencyDetailTitle');
      if (title) title.innerHTML = '<i class="fa-solid fa-coins text-amber-600"></i> ' + cur + ' — ' + monthName + ' ' + year;
      const body = document.getElementById('currencyDetailBody');
      const prev = document.getElementById('currencyDetailPrev');
      openModal('modalCurrencyDetail');
      if (!window.FeePhase4 || !body) {
        if (body) body.innerHTML = '<p class="text-xs text-rose-600 font-bold">Currency detail is unavailable right now. Please reload the page.</p>';
        return;
      }
      const overrides = getStoredMatrixOverrides();
      const feeForMonth = (fam, m, y) => feeFormApplicableFeeDetails(fam, m, y).fee;
      const isLeave = (fam, m, y) => {
        const mn = FEE_CONFIG.MONTHS[m];
        const chk = (typeof checkFamilyLeaveInMonth === 'function') ? checkFamilyLeaveInMonth(fam.id, mn, y) : null;
        const ov = overrides[String(fam.id).toUpperCase() + '_' + mn.toLowerCase() + '_' + y];
        return !!(chk && chk.isLeave) || !!(ov && ov.status === 'leave');
      };
      const isNotEnrolled = (fam, m, y) => {
        const ov = overrides[String(fam.id).toUpperCase() + '_' + FEE_CONFIG.MONTHS[m].toLowerCase() + '_' + y];
        return !!(ov && ov.status === 'not_enrolled');
      };
      const isPreAdmission = (fam, m, y) => isFamilyPreAdmission(fam, m, y);
      const rows = window.FeePhase4.buildCurrencyDetailRows({
        families: CACHED_FEE_FAMILIES || [], records: getStoredFeeRecords(),
        currency: cur, monthIdx: monthIdx, year: year,
        feeForMonth: feeForMonth, isLeave: isLeave, isNotEnrolled: isNotEnrolled, isPreAdmission: isPreAdmission
      });
      const prevMonths = window.FeePhase4.buildCurrencyPrevMonths({
        families: CACHED_FEE_FAMILIES || [], records: getStoredFeeRecords(),
        currency: cur, monthIdx: monthIdx, year: year,
        feeForMonth: feeForMonth, isLeave: isLeave, isNotEnrolled: isNotEnrolled, isPreAdmission: isPreAdmission
      });
      const esc = window.FeePhase4.esc;
      const fmt = (val) => typeof formatLmsCurrencyHtml === 'function'
        ? formatLmsCurrencyHtml(val, cur)
        : cur + ' ' + Number(val || 0).toLocaleString();
      let totalFee = 0, totalPaid = 0, totalRem = 0;
      rows.forEach(r => { totalFee += r.fee; totalPaid += r.paid; totalRem += r.remaining; });
      const statusPill = (s) => s === 'Paid' ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
        : s === 'Partial' ? 'bg-amber-100 text-amber-800 border-amber-300'
        : s === 'On Leave' ? 'bg-slate-100 text-slate-600 border-slate-300'
        : s === 'Paid (Status)' ? 'bg-teal-100 text-teal-800 border-teal-300'
        : 'bg-rose-100 text-rose-800 border-rose-300';
      body.innerHTML = rows.length === 0
        ? '<p class="text-xs text-slate-500 font-semibold">No ' + cur + ' families are enrolled for ' + monthName + ' ' + year + '.</p>'
        : '<div class="overflow-x-auto"><table class="w-full text-xs">'
          + '<thead><tr class="text-left text-slate-500 border-b border-slate-200">'
          + '<th class="py-2 pr-2 font-extrabold">Family</th><th class="py-2 pr-2 font-extrabold">Students</th>'
          + '<th class="py-2 pr-2 font-extrabold text-right">Fee</th><th class="py-2 pr-2 font-extrabold text-right">Paid</th>'
          + '<th class="py-2 pr-2 font-extrabold text-right">Remaining</th><th class="py-2 font-extrabold">Status</th></tr></thead>'
          + '<tbody>' + rows.map(r =>
            '<tr class="border-b border-slate-100 hover:bg-slate-50">'
            + '<td class="py-2 pr-2"><button type="button" onclick="closeModal(\'modalCurrencyDetail\'); selectFeeFamily(\'' + esc(r.familyId) + '\')" class="font-extrabold text-emerald-800 hover:underline text-left">' + esc(r.parentName) + ' <span class="font-mono text-slate-500">' + esc(r.familyId) + '</span></button></td>'
            + '<td class="py-2 pr-2 font-semibold text-slate-600">' + esc(r.studentsNames) + '</td>'
            + '<td class="py-2 pr-2 font-bold text-right">' + fmt(r.fee) + '</td>'
            + '<td class="py-2 pr-2 font-bold text-right text-emerald-700">' + fmt(r.paid) + '</td>'
            + '<td class="py-2 pr-2 font-bold text-right ' + (r.remaining > 0 ? 'text-rose-700' : 'text-slate-500') + '">' + fmt(r.remaining) + '</td>'
            + '<td class="py-2"><span class="px-2 py-0.5 rounded-full border text-[10px] font-bold ' + statusPill(r.status) + '">' + esc(r.status) + '</span></td></tr>'
          ).join('') + '</tbody>'
          + '<tfoot><tr class="font-extrabold text-slate-900">'
          + '<td class="py-2 pr-2" colspan="2">Total (' + rows.length + ' families)</td>'
          + '<td class="py-2 pr-2 text-right">' + fmt(totalFee) + '</td>'
          + '<td class="py-2 pr-2 text-right text-emerald-700">' + fmt(totalPaid) + '</td>'
          + '<td class="py-2 pr-2 text-right ' + (totalRem > 0 ? 'text-rose-700' : '') + '">' + fmt(totalRem) + '</td><td></td></tr></tfoot>'
          + '</table></div>'
          + '<p class="text-[11px] text-slate-500 font-semibold mt-2">Click a family to open it in Collect Fee. Months settled by a one-tap status (no payment) show as "Paid (Status)".</p>';
      if (prev) {
        prev.innerHTML = '<h4 class="text-xs font-extrabold text-slate-900 mb-2">Previous Months — ' + cur + '</h4>'
          + '<div class="overflow-x-auto"><table class="w-full text-xs"><thead><tr class="text-left text-slate-500 border-b border-slate-200">'
          + '<th class="py-2 pr-2 font-extrabold">Month</th><th class="py-2 pr-2 font-extrabold text-right">Expected</th>'
          + '<th class="py-2 pr-2 font-extrabold text-right">Received</th><th class="py-2 font-extrabold text-right">Pending</th></tr></thead><tbody>'
          + prevMonths.map(pm =>
            '<tr class="border-b border-slate-100"><td class="py-2 pr-2 font-bold text-slate-700">' + esc(pm.month) + ' ' + pm.year + '</td>'
            + '<td class="py-2 pr-2 font-bold text-right">' + fmt(pm.expected) + '</td>'
            + '<td class="py-2 pr-2 font-bold text-right text-emerald-700">' + fmt(pm.received) + '</td>'
            + '<td class="py-2 font-bold text-right ' + (pm.pending > 0 ? 'text-rose-700' : 'text-slate-500') + '">' + fmt(pm.pending) + '</td></tr>'
          ).join('') + '</tbody></table></div>';
      }
    }

    // ---- #19 — Remembered payment method (localStorage only) ----
    function applyRememberedPaymentMethod(familyId) {
      if (!window.FeePhase4) return;
      const sel = document.getElementById('feeFormPaymentMethod');
      if (!sel) return;
      const m = window.FeePhase4.rememberedMethodFor(window.FeePhase4.loadRememberedMethods(localStorage), familyId);
      if (m) sel.value = m;
    }

    function rememberPaymentMethodForFamily(familyId, method) {
      if (!window.FeePhase4) return;
      try { window.FeePhase4.saveRememberedMethod(localStorage, familyId, method); } catch (e) { /* device-only, never fatal */ }
    }

    // ---- #31 — Leave from inside the Collect Fee form ----
    // ---- #66 — Families CSV export (manager contacts masked) ----
    function exportFamiliesCsv() {
      if (!window.FeePhase4) { lmsNotify('CSV export is unavailable right now. Please reload the page.'); return; }
      const families = (typeof ALL_FAMILIES !== 'undefined' && Array.isArray(ALL_FAMILIES) && ALL_FAMILIES.length)
        ? ALL_FAMILIES
        : (CACHED_FEE_FAMILIES || []);
      const csv = window.FeePhase4.buildFamiliesCsv(families, { isManager: (typeof CURRENT_ROLE !== 'undefined' && CURRENT_ROLE === 'manager') });
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = window.FeePhase4.familiesCsvFilename(new Date());
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    // ============================================================
    // FEE UPGRADE PHASE 5 — PDF STORAGE IN R2 (#71)
    //
    // After a receipt PDF is generated, its bytes are ALSO uploaded to
    // R2 under fee-documents/receipts/<receiptNo>.pdf (same key every
    // time — a re-download overwrites). The key is stored on the record
    // as `pdfKey` (family notes fee_history is the source of truth; the
    // payments-table dual-write carries it in legacy_json + receipt_url
    // via upsertPaymentRow). A failed upload marks the record
    // `pdfPending` (local-only flag) and NEVER blocks the local
    // download — the cloud copy retries on the next download. Before
    // the Worker is deployed, the endpoint 404s and every record just
    // stays pdfPending; nothing crashes.
    // ============================================================

    function feePdfAuthHeaders() {
      try {
        if (typeof window !== 'undefined' && typeof window.getLmsAuthHeaders === 'function') {
          return window.getLmsAuthHeaders() || {};
        }
      } catch (e) { /* no token available — upload reports it, never throws */ }
      return {};
    }

    // Store one generated receipt PDF in R2 and record its key on the
    // local + cloud copies of the record. Returns { ok, key } or
    // { ok: false, error }. Never throws.
    async function storeFeePdfForReceipt(record, bytes) {
      if (!record || !record.receiptNo) return { ok: false, error: 'missing_receipt' };
      if (String(record.status || '').toLowerCase().indexOf('cancel') !== -1) {
        return { ok: false, error: 'cancelled' };
      }
      if (!window.FeePhase5 || typeof window.FeePhase5.uploadFeePdf !== 'function') {
        return { ok: false, error: 'module_missing' };
      }
      let res;
      try {
        res = await window.FeePhase5.uploadFeePdf(
          fetch, window.FeePhase5.feePdfApiBase(), feePdfAuthHeaders(),
          'receipt', record.receiptNo, bytes
        );
      } catch (e) {
        res = { ok: false, error: 'network_error' };
      }
      const records = getStoredFeeRecords() || [];
      const idx = records.findIndex(rr => rr && String(rr.receiptNo) === String(record.receiptNo));
      if (idx < 0) return res;
      if (res.ok) {
        records[idx] = window.FeePhase5.withPdfKey(records[idx], res.key);
        saveStoredFeeRecords(records);
        // Cloud copy (family notes fee_history): the fingerprint does
        // not cover pdfKey, so this refreshes the same record instead
        // of creating a duplicate. The dual-write upsert carries the
        // key into the payments table (legacy_json + receipt_url).
        try {
          const sync = await syncPaymentRecordsBatchToCloud(record.familyId, [records[idx]]);
          if (!sync || !sync.ok) {
            records[idx].cloudSyncPending = true;
            saveStoredFeeRecords(records);
          }
        } catch (e) { /* local key is kept; the cloud copy retries on next sync */ }
        return { ok: true, key: res.key };
      }
      records[idx] = window.FeePhase5.withPdfPending(records[idx]);
      saveStoredFeeRecords(records);
      return { ok: false, error: res.error || 'upload_failed' };
    }

    // Remove one stored fee PDF (Undo Payment). Best-effort only — a
    // failed delete never blocks the undo; the cancelled receipt simply
    // never shows an Open PDF button again.
    async function deleteStoredFeePdf(key) {
      if (!key || !window.FeePhase5 || typeof window.FeePhase5.deleteFeePdf !== 'function') {
        return { ok: false, error: 'unavailable' };
      }
      try {
        return await window.FeePhase5.deleteFeePdf(
          fetch, window.FeePhase5.feePdfApiBase(), feePdfAuthHeaders(), key
        );
      } catch (e) {
        return { ok: false, error: 'network_error' };
      }
    }

    // Open a stored receipt PDF in a new tab (fetched with the session
    // token — a plain link would carry no Authorization header).
    async function openStoredFeePdf(key) {
      if (!key) {
        lmsNotify('No stored PDF for this receipt yet.');
        return;
      }
      if (!window.FeePhase5 || typeof window.FeePhase5.openStoredFeePdf !== 'function') {
        lmsNotify('Stored PDF is unavailable right now. Please reload the page.');
        return;
      }
      let res;
      try {
        res = await window.FeePhase5.openStoredFeePdf(
          fetch, window.FeePhase5.feePdfApiBase(), feePdfAuthHeaders(), key,
          { window: window, document: document, URL: URL }
        );
      } catch (e) {
        res = { ok: false, error: 'network_error' };
      }
      if (!res.ok) {
        lmsNotify(res.error || 'Could not open the stored PDF.', { type: 'error' });
      }
    }

    // Receipts-tab action cell for one record: "Open PDF" when a stored
    // copy exists, an honest retry note when the last upload failed,
    // nothing otherwise (the Voucher button still regenerates locally).
    // Cancelled rows never get an Open PDF button.
    function feeReceiptPdfCellHtml(r) {
      if (!r || !r.receiptNo) return '';
      if (String(r.status || '').toLowerCase().indexOf('cancel') !== -1) return '';
      const st = (window.FeePhase5 && typeof window.FeePhase5.receiptPdfStatus === 'function')
        ? window.FeePhase5.receiptPdfStatus(r)
        : (r.pdfKey ? 'stored' : (r.pdfPending ? 'pending' : 'none'));
      if (st === 'stored') {
        return `<button onclick="openStoredFeePdf('${String(r.pdfKey).replace(/'/g, "\\'")}')" class="px-3 py-1 bg-emerald-100 hover:bg-emerald-200 text-emerald-800 border border-emerald-300 rounded-xl text-xs font-bold transition inline-flex items-center gap-1" title="Open the PDF saved in the cloud"><i class="fa-solid fa-cloud-arrow-down"></i> Open PDF</button>`;
      }
      if (st === 'pending') {
        return `<span class="block text-[10px] text-amber-600 mt-1">Cloud save pending — open the voucher and download the PDF again to retry.</span>`;
      }
      return '';
    }

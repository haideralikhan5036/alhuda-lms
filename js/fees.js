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
    let CACHED_PENDING_FEE_LIST = [];
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

        (families || []).forEach(f => {
          if (!f || !f.id) return;
          const notesObj = parseFamilyNotesData(f.notes);

          // Ingest cloud fee receipts
          if (Array.isArray(notesObj.fee_history)) {
            notesObj.fee_history.forEach(r => {
              if (r && r.receiptNo) {
                cloudRecordsMap.set(r.receiptNo, r);
              }
            });
          }

          // Ingest cloud matrix overrides
          if (notesObj.matrix_overrides && typeof notesObj.matrix_overrides === 'object') {
            Object.assign(cloudOverrides, notesObj.matrix_overrides);
          }

          // Check if local device has receipts for this family that aren't yet in the cloud!
          const fIdUpper = String(f.id).toUpperCase();
          const unmigratedLocal = localRecords.filter(r => String(r.familyId).toUpperCase() === fIdUpper && !cloudRecordsMap.has(r.receiptNo));
          if (unmigratedLocal.length > 0) {
            unmigratedLocal.forEach(r => cloudRecordsMap.set(r.receiptNo, r));
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

    async function syncPaymentRecordsBatchToCloud(familyId, newRecords) {
      try {
        const fId = String(familyId).trim();
        if (!fId || !newRecords || newRecords.length === 0) return;

        updateCloudSyncIndicator('syncing');

        // Fetch latest family notes from Supabase
        const { data: fam, error } = await db.from('families').select('id, notes').eq('id', fId).maybeSingle();
        if (error) {
          console.warn("[Cloud Fee Sync] Error fetching family:", error);
          return;
        }

        const notesObj = parseFamilyNotesData(fam?.notes);
        if (!Array.isArray(notesObj.fee_history)) {
          notesObj.fee_history = [];
        }

        // Prepend new records (avoiding duplicates by receiptNo)
        newRecords.forEach(nr => {
          const existsIdx = notesObj.fee_history.findIndex(r => r.receiptNo === nr.receiptNo);
          if (existsIdx >= 0) {
            notesObj.fee_history[existsIdx] = nr;
          } else {
            notesObj.fee_history.unshift(nr);
          }
        });

        const { error: upErr } = await db.from('families').update({
          notes: JSON.stringify(notesObj)
        }).eq('id', fId);

        if (upErr) {
          console.error("[Cloud Fee Sync] Supabase update error:", upErr);
        } else {
          console.log(`[Cloud Fee Sync] Successfully synced ${newRecords.length} fee records for ${fId} to Supabase`);
          updateCloudSyncIndicator('synced');
        }
      } catch (e) {
        console.error("[Cloud Fee Sync] Fatal sync exception:", e);
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

    async function manualFeeCloudSync() {
      updateCloudSyncIndicator('syncing');
      showToastNotification("Syncing latest fee records with cloud...");
      await loadFeeBillingLedger();
      showToastNotification("Fee records 100% synchronized across all devices!");
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
      if (subTabId === 'fee-subtab-matrix') loadMasterAnnualMatrix();
      if (subTabId === 'fee-subtab-receipts') loadFeeReceiptsHistory();
    }

    function refreshCurrentFeeView() {
      const activeBtn = document.querySelector('.fee-subtab-btn.active');
      const id = activeBtn ? activeBtn.id.replace('btnFeeSubTab-', 'fee-subtab-') : 'fee-subtab-overview';
      switchFeeSubTab(id);
    }

    // Main entrypoint when switching to tab-invoices
    async function loadFeeBillingLedger() {
      try {
        updateCloudSyncIndicator('syncing');

        // 1. Fetch fresh regular families from Supabase
        const { data: families } = await db.from('families').select('*, students(*)').order('created_at', { ascending: false });

        // 2. Ingest cloud fee history and matrix overrides from Supabase into cache
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

        // Ensure Leave Tracker data is ready for leave-fee synchronization
        if (!ALL_LEAVE_RECORDS || ALL_LEAVE_RECORDS.length === 0) {
          try { await loadLeaveManagementData(); } catch(e){}
        }

        // Set default month/year in dropdowns if not already set
        const now = new Date();
        const curMonthName = FEE_CONFIG.MONTHS[now.getMonth()] || "September";
        const curYear = now.getFullYear();

        const mSel = document.getElementById('feeDashMonthSelect');
        const ySel = document.getElementById('feeDashYearSelect');
        if (mSel && !mSel.value) mSel.value = curMonthName;
        if (ySel && !ySel.value) ySel.value = String(curYear);

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
      const mSel = document.getElementById('feeDashMonthSelect');
      const ySel = document.getElementById('feeDashYearSelect');
      const selectedMonth = mSel ? mSel.value : 'September';
      const selectedYear = ySel ? parseInt(ySel.value, 10) : 2026;

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

        currencyRevenue[cur].expected += parseFloat(f.monthly_fee || 0);
      });

      // Track paid vs pending for selected month & year
      const paidMap = {};
      const partialMap = {};

      records.forEach(r => {
        if (String(r.month).toLowerCase() === selectedMonth.toLowerCase() && parseInt(r.year, 10) === selectedYear) {
          const famIdUpper = String(r.familyId).toUpperCase();
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
          const dueAmt = hasPartial ? partialMap[famUpper] : parseFloat(fam.monthly_fee || 0);
          
          const regStus = (fam.students || []).filter(s => (s.status || '').toLowerCase() !== 'trial');
          const stuNames = regStus.map(s => s.name).join(', ') || 'Enrolled Student';

          pendingFamiliesList.push({
            family: fam,
            familyId: fam.id,
            parentName: fam.parent_name,
            studentsNames: stuNames,
            country: fam.country || 'International',
            whatsapp: fam.whatsapp || '',
            email: fam.email || '',
            currency: fam.currency || 'USD',
            dueAmount: dueAmt,
            isPartial: hasPartial,
            status: hasPartial ? 'Partial (Balance Pending)' : 'Pending'
          });
        }
      });

      CACHED_PENDING_FEE_LIST = pendingFamiliesList;

      const totalActive = activeEnrolledThisMonth > 0 ? activeEnrolledThisMonth : families.length;
      const paidCount = Object.keys(paidMap).length;
      const pendingCount = pendingFamiliesList.length;
      const effectiveTotal = Math.max(1, totalActive - onLeaveCount);
      const pctPaid = Math.min(100, Math.round((paidCount / effectiveTotal) * 100));

      // Update KPI Counter DOM Elements
      const kpiFamilies = document.getElementById('kpiFeeTotalFamilies');
      if (kpiFamilies) kpiFamilies.innerText = totalActive;
      const kpiStudents = document.getElementById('kpiFeeTotalStudents');
      if (kpiStudents) kpiStudents.innerText = totalStudentsCount;
      const kpiPaid = document.getElementById('kpiFeePaidCount');
      if (kpiPaid) kpiPaid.innerText = paidCount;
      const kpiPending = document.getElementById('kpiFeePendingCount');
      if (kpiPending) kpiPending.innerText = pendingCount;
      const kpiLeave = document.getElementById('kpiFeeLeaveCount');
      if (kpiLeave) kpiLeave.innerText = onLeaveCount;

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
    }

    function renderFeeCurrencyGrid(currencyRevenue) {
      const container = document.getElementById('feeCurrencyGridContainer');
      if (!container) return;
      container.innerHTML = '';

      let hasData = false;
      for (const cur of FEE_CONFIG.CURRENCIES) {
        const data = currencyRevenue[cur] || { expected: 0, received: 0 };
        if (data.expected === 0 && data.received === 0) continue;
        hasData = true;

        const pct = data.expected > 0 ? Math.min(100, Math.round((data.received / data.expected) * 100)) : 0;

        const card = document.createElement('div');
        card.className = 'p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2';
        card.innerHTML = `
          <div class="flex justify-between items-center text-xs font-bold">
            <span class="text-brandDark font-black font-mono text-sm">${cur}</span>
            <span class="text-emerald-700 font-bold font-num">${pct}% Paid</span>
          </div>
          <div class="flex justify-between text-[11px] text-slate-500">
            <span>Expected:</span>
            <strong class="text-slate-800 font-num">${cur} ${data.expected.toLocaleString()}</strong>
          </div>
          <div class="flex justify-between text-[11px] text-slate-500">
            <span>Received:</span>
            <strong class="text-emerald-700 font-num font-bold">${cur} ${data.received.toLocaleString()}</strong>
          </div>
          <div class="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
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

      // Reset proration and advance toggles
      const progToggle = document.getElementById('feeToggleProrated');
      if (progToggle) progToggle.checked = false;
      const pBox = document.getElementById('feeProrateBox');
      if (pBox) pBox.classList.add('hidden');

      const advToggle = document.getElementById('feeToggleAdvance');
      if (advToggle) advToggle.checked = false;
      const aBox = document.getElementById('feeAdvanceBox');
      if (aBox) aBox.classList.add('hidden');

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

      const monthlyFee = parseFloat(fam.monthly_fee || 0);
      const records = getStoredFeeRecords().filter(r => String(r.familyId).toUpperCase() === String(famId).toUpperCase());

      // Target month index
      const targetMonthIdx = FEE_CONFIG.MONTHS.findIndex(m => m.toLowerCase() === targetMonth.toLowerCase());
      const paidByMonth = {};
      let latestRemainingBalance = 0;

      records.forEach(r => {
        if (parseInt(r.year, 10) === targetYear) {
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

        // 1. Skip Pre-Admission Months (Joined in later month: ZERO expected fee & ZERO arrears)
        const isPreAdm = isFamilyPreAdmission(fam, m, targetYear);
        const isExplicitNotEnrolled = manualOverride && manualOverride.status === 'not_enrolled';
        if (isPreAdm || isExplicitNotEnrolled) {
          continue;
        }

        // 2. Check if student was on approved leave in that past month
        const leaveCheck = checkFamilyLeaveInMonth(famId, mName, targetYear);
        if (leaveCheck.isLeave || (manualOverride && manualOverride.status === 'leave')) {
          unpaidDetails.push({ month: mName, isLeave: true, reason: leaveCheck.reason || manualOverride?.notes || 'Approved Leave' });
          continue;
        }

        const amtPaid = paidByMonth[mKey] || 0;
        if (amtPaid < monthlyFee) {
          const shortfall = monthlyFee - amtPaid;
          totalPreviousArrears += shortfall;
          unpaidDetails.push({ month: mName, isLeave: false, shortfall });
        }
      }

      const finalPreviousBalance = totalPreviousArrears;
      document.getElementById('feeFormPreviousBalance').value = finalPreviousBalance.toFixed(2);

      // Re-evaluate proration if active
      if (document.getElementById('feeToggleProrated')?.checked) {
        calcProratedFeeFromDays();
      } else if (document.getElementById('feeToggleAdvance')?.checked) {
        calcAdvancePaymentFee();
      } else {
        document.getElementById('feeFormMonthlyFee').value = monthlyFee.toFixed(2);
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
          creditToApply = Math.min(availableCredit, monthlyFee + finalPreviousBalance);
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
      const standardFee = parseFloat(fam?.monthly_fee || 0);

      const prorated = totalDays > 0 ? Math.round((standardFee / totalDays) * activeDays) : standardFee;
      const calcField = document.getElementById('feeProrateCalcAmount');
      if (calcField) calcField.value = prorated.toFixed(2);
    }

    function applyProratedFeeToForm() {
      const prorated = parseFloat(document.getElementById('feeProrateCalcAmount')?.value || 0);
      if (prorated <= 0) return;
      document.getElementById('feeFormMonthlyFee').value = prorated.toFixed(2);
      recalcFeeTotalLive();
      showToastNotification(`Prorated fee of ${prorated.toFixed(2)} applied for ${document.getElementById('feeProrateActiveDays').value} active days!`);
    }

    // Advance Payment Toggle & Calculator
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
        calcAdvancePaymentFee();
      } else {
        box.classList.add('hidden');
        triggerFeeBalanceRecalc();
      }
    }

    function calcAdvancePaymentFee() {
      const count = parseInt(document.getElementById('feeSelectAdvanceMonths')?.value, 10) || 1;
      const startMonth = document.getElementById('feeFormMonth').value;
      const startYear = parseInt(document.getElementById('feeFormYear').value, 10);

      const famId = document.getElementById('feeFormFamilyId').value;
      const fam = (CACHED_FEE_FAMILIES || []).find(f => String(f.id).toUpperCase() === String(famId).toUpperCase());
      const standardFee = parseFloat(fam?.monthly_fee || 0);

      const totalAdvance = standardFee * count;
      const calcField = document.getElementById('feeAdvanceCalcAmount');
      if (calcField) calcField.value = totalAdvance.toFixed(2);

      const mIdx = FEE_CONFIG.MONTHS.findIndex(m => m.toLowerCase() === startMonth.toLowerCase());
      const badgesContainer = document.getElementById('feeAdvanceMonthsBadges');
      if (badgesContainer) {
        badgesContainer.innerHTML = '';
        for (let i = 0; i < count; i++) {
          const curIdx = (mIdx + i) % 12;
          const curY = startYear + Math.floor((mIdx + i) / 12);
          const badge = document.createElement('span');
          badge.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-200';
          badge.innerHTML = `<i class="fa-solid fa-check mr-1"></i>${FEE_CONFIG.MONTHS[curIdx]} ${curY}`;
          badgesContainer.appendChild(badge);
        }
      }
    }

    function applyAdvancePaymentFeeToForm() {
      const advanceAmt = parseFloat(document.getElementById('feeAdvanceCalcAmount')?.value || 0);
      if (advanceAmt <= 0) return;
      document.getElementById('feeFormMonthlyFee').value = advanceAmt.toFixed(2);
      recalcFeeTotalLive();
      showToastNotification(`Advance payment fee of ${advanceAmt.toFixed(2)} applied!`);
    }

    // Submit Payment & Save Record
    async function handleFeePaymentSubmit(e) {
      e.preventDefault();
      const famId = document.getElementById('feeFormFamilyId').value;
      if (!famId) {
        alert("Please search and select a family account first.");
        return;
      }

      const btn = document.getElementById('btnSubmitFeePayment');
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Saving Payment...';
      }

      const todayStr = new Date().toISOString().slice(0, 10);
      const curYear = document.getElementById('feeFormYear').value;
      const records = getStoredFeeRecords();
      const receiptNo = `${FEE_CONFIG.RECEIPT_PREFIX}${curYear}-${String(records.length + 1).padStart(4, '0')}`;

      const totalPayable = parseFloat(document.getElementById('feeFormTotalPayable').value || 0);
      const amountPaid = parseFloat(document.getElementById('feeFormAmountPaid').value || 0);
      const discount = parseFloat(document.getElementById('feeFormDiscount').value || 0);
      const remaining = parseFloat(document.getElementById('feeFormRemainingBalance').value || 0);
      const creditDeducted = parseFloat(document.getElementById('feeFormCreditDeducted')?.value || 0);

      const netDue = Math.max(0, totalPayable - discount);
      const excessPaid = amountPaid > netDue ? (amountPaid - netDue) : 0;

      const isProrated = document.getElementById('feeToggleProrated')?.checked || false;
      const isAdvance = document.getElementById('feeToggleAdvance')?.checked || false;
      const advanceCount = isAdvance ? parseInt(document.getElementById('feeSelectAdvanceMonths').value, 10) : 1;

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

      // Handle multi-month advance sequence records in storage
      const addedBatch = [];
      if (isAdvance && advanceCount > 1) {
        const mIdx = FEE_CONFIG.MONTHS.findIndex(m => m.toLowerCase() === paymentRecord.month.toLowerCase());
        const singleFee = paymentRecord.monthlyFee / advanceCount;

        for (let i = 0; i < advanceCount; i++) {
          const curIdx = (mIdx + i) % 12;
          const curY = paymentRecord.year + Math.floor((mIdx + i) / 12);
          const advRec = {
            ...paymentRecord,
            receiptNo: `${receiptNo}-${i + 1}`,
            month: FEE_CONFIG.MONTHS[curIdx],
            year: curY,
            monthlyFee: singleFee,
            previousBalance: i === 0 ? paymentRecord.previousBalance : 0,
            creditDeducted: i === 0 ? paymentRecord.creditDeducted : 0,
            totalPayable: i === 0 ? paymentRecord.totalPayable : singleFee,
            amountPaid: i === 0 ? paymentRecord.amountPaid : singleFee,
            remainingBalance: i === 0 ? paymentRecord.remainingBalance : 0,
            excessPaid: i === 0 ? paymentRecord.excessPaid : 0,
            status: i === 0 ? paymentRecord.status : 'Paid in Advance'
          };
          records.unshift(advRec);
          addedBatch.push(advRec);
        }
      } else {
        records.unshift(paymentRecord);
        addedBatch.push(paymentRecord);
      }

      saveStoredFeeRecords(records);

      // Asynchronously sync payment records to Supabase Cloud for cross-device visibility
      syncPaymentRecordsBatchToCloud(paymentRecord.familyId, addedBatch);

      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-file-invoice"></i> Save Payment &amp; Generate Official Invoice';
      }

      // Open Official Printable Receipt Modal
      openFeeInvoiceModal(paymentRecord);

      // Auto-send official invoice email to parent & academy if toggle is checked
      const autoSendEmail = document.getElementById('feeToggleAutoSendEmail')?.checked;
      if (autoSendEmail && (paymentRecord.email || paymentRecord.parentEmail)) {
        sendFeeInvoiceEmailModal(paymentRecord, true);
      }

      // Refresh Overview, Defaulters and Matrix
      await loadFeeDashboardStats();
      resetFeeForm();
      showToastNotification("Fee payment recorded successfully!");
    }

    // ============================================================
    // 3. OFFICIAL INVOICE RECEIPT MODAL & ACTIONS
    // ============================================================
    function openFeeInvoiceModal(r) {
      CURRENT_FEE_MODAL_RECEIPT = r;

      document.getElementById('feeInvReceiptNo').innerText = r.receiptNo || 'AH-REC-OFFICIAL';
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
      if (r.isAdvancePayment && r.advanceMonthsCount > 1) {
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

      // Format WhatsApp Message link
      const cleanPhone = (r.whatsapp || '').replace(/[^0-9]/g, '');
      let creditMsg = '';
      if (credAmt > 0) creditMsg += `Advance Credit Deducted: *- ${cur} ${credAmt.toFixed(2)}*\n`;
      if (excessAmt > 0) creditMsg += `Next Month Advance Credit: *+ ${cur} ${excessAmt.toFixed(2)}*\n`;

      const waMsg = `Assalam-o-Alaikum Respected ${r.parentName},\n\n*OFFICIAL TUITION FEE RECEIPT - AL-HUDA ISLAMIC CENTRE*\n--------------------------------------\nReceipt No: *${r.receiptNo}*\nDate: *${r.date}*\nStudent(s): *${r.studentsNames}*\nBilling Period: *${r.month} ${r.year}*\nTotal Due: *${cur} ${parseFloat(r.totalPayable || 0).toFixed(2)}*\n${creditMsg}Amount Paid: *${cur} ${parseFloat(r.amountPaid || 0).toFixed(2)}*\nRemaining Balance: *${cur} ${remaining.toFixed(2)}*\nStatus: *${r.status}*\n--------------------------------------\nJazakAllahu Khairan!\n*Al-Huda Islamic Centre Accounts*`;
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
        alert("No active invoice receipt selected.");
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
              showToastNotification("✅ Official Invoice PDF downloaded successfully!");
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

          await html2pdf().set(opt).from(cardClone).save();
          pdfGenerated = true;
          showToastNotification("✅ Official Invoice PDF downloaded successfully!");
        }

        // METHOD 3: Fallback to pristine print preview if canvas libraries fail
        if (!pdfGenerated) {
          printFeeInvoiceReceipt();
        }

      } catch (err) {
        console.error("[Invoice PDF] Generation failed:", err);
        showToastNotification("Opening print preview for PDF saving...");
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
      return localStorage.getItem('alhuda_fee_official_email') || 'ceoislamiccentre@gmail.com';
    }

    function promptChangeOfficialEmail() {
      const current = getOfficialAcademyEmail();
      const entered = prompt("Enter Official Academy Email Address (used for invoice sender & CC):", current);
      if (entered !== null && entered.trim() !== '') {
        const clean = entered.trim().toLowerCase();
        localStorage.setItem('alhuda_fee_official_email', clean);
        updateOfficialEmailUI();
        showToastNotification(`Official Academy Email updated to: ${clean}`);
      }
    }

    function updateOfficialEmailUI() {
      const email = getOfficialAcademyEmail();
      const el = document.getElementById('feeOfficialEmailDisplay');
      if (el) el.innerText = email;
    }

    // Official Invoice Email Dispatcher (Manual & Auto-Send)
    async function sendFeeInvoiceEmailModal(record, isSilent = false) {
      const r = record || CURRENT_FEE_MODAL_RECEIPT;
      if (!r) {
        showToastNotification("No active invoice loaded to email.");
        return;
      }

      const famEmail = r.email || r.parentEmail || '';
      let targetEmail = famEmail;

      if (!targetEmail) {
        const fam = CACHED_FEE_FAMILIES.find(f => f.familyId === r.familyId || f.id === r.familyId);
        if (fam && fam.email) targetEmail = fam.email;
      }

      if (!targetEmail && !isSilent) {
        const promptEmail = prompt(`Please enter parent email address for ${r.parentName} (${r.familyId}):`, "");
        if (promptEmail && promptEmail.includes('@')) {
          targetEmail = promptEmail.trim();
          r.email = targetEmail;
          const emailEl = document.getElementById('feeInvParentEmail');
          if (emailEl) emailEl.innerText = targetEmail;
        }
      }

      if (!targetEmail || !targetEmail.includes('@')) {
        if (!isSilent) {
          alert(`No valid parent email address found for ${r.parentName}. Please specify parent email.`);
        }
        return;
      }

      const offEmail = getOfficialAcademyEmail();
      const cur = r.currency || 'USD';
      const rNo = r.receiptNo || 'AH-REC-OFFICIAL';
      const monthlyFee = parseFloat(r.monthlyFee || 0).toFixed(2);
      const prevBal = parseFloat(r.previousBalance || 0).toFixed(2);
      const credAmt = parseFloat(r.creditDeducted || 0).toFixed(2);
      const totalPayable = parseFloat(r.totalPayable || 0).toFixed(2);
      const amountPaid = parseFloat(r.amountPaid || 0).toFixed(2);
      const discount = parseFloat(r.discount || 0).toFixed(2);
      const remaining = parseFloat(r.remainingBalance || 0).toFixed(2);
      const excessAmt = parseFloat(r.excessPaid || 0).toFixed(2);

      const subject = `Official Tuition Fee Receipt [${rNo}] - ${r.parentName} (${r.month} ${r.year}) - Al-Huda Islamic Centre`;

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
        `\nJazakAllahu Khairan!\nAl-Huda Islamic Centre Accounts\nOfficial Email: ${offEmail}`;

      const btn = document.getElementById('feeInvBtnSendEmail');
      const origHtml = btn ? btn.innerHTML : '';
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Sending...';
      }

      // Try background dispatch via EmailJS if configured
      try {
        if (typeof emailjs !== 'undefined' && window.EMAILJS_PUBLIC_KEY) {
          await emailjs.send(window.EMAILJS_SERVICE_ID, window.EMAILJS_TEMPLATE_ID, {
            to_email: targetEmail,
            cc_email: offEmail,
            subject: subject,
            message: plainText,
            from_name: `Al-Huda Islamic Centre (${offEmail})`
          });
        }
      } catch (eJsErr) {
        console.warn("Background email dispatch notice:", eJsErr);
      }

      if (btn) {
        btn.disabled = false;
        btn.innerHTML = origHtml;
      }

      if (!isSilent) {
        // Open Gmail compose with complete pre-filled details
        const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(targetEmail)}&cc=${encodeURIComponent(offEmail)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(plainText)}`;
        window.open(gmailUrl, '_blank');
        showToastNotification(`Official Invoice Email prepared for ${targetEmail}`);
      } else {
        showToastNotification(`Official Invoice Email dispatched to ${targetEmail} (CC: ${offEmail})`);
      }
    }

    // ============================================================
    // 4. PENDING DEFAULTERS LIST
    // ============================================================
    function loadPendingDefaultersList() {
      const mSel = document.getElementById('feePendingMonthFilter');
      const ySel = document.getElementById('feePendingYearFilter');
      const targetMonth = mSel ? mSel.value : 'September';
      const targetYear = ySel ? parseInt(ySel.value, 10) : 2026;

      const pLabel = document.getElementById('feePendingPeriodLabel');
      if (pLabel) pLabel.innerText = `${targetMonth} ${targetYear}`;

      const tbody = document.getElementById('feePendingTableBody');
      if (!tbody) return;

      const list = CACHED_PENDING_FEE_LIST || [];
      const badge = document.getElementById('feePendingTotalBadge');
      if (badge) badge.innerText = `${list.length} Families Pending`;

      renderPendingDefaultersRows(list);
    }

    function renderPendingDefaultersRows(list) {
      const tbody = document.getElementById('feePendingTableBody');
      if (!tbody) return;

      if (!list || list.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="7" class="p-8 text-center text-emerald-800 font-bold">
              <i class="fa-solid fa-circle-check text-2xl text-emerald-600 block mb-1"></i>
              SubhanAllah! Zero pending fees found for this month. All family dues are cleared!
            </td>
          </tr>
        `;
        return;
      }

      tbody.innerHTML = list.map(item => {
        const cleanPhone = (item.whatsapp || '').replace(/[^0-9]/g, '');
        const waMsg = `Assalam-o-Alaikum Respected ${item.parentName},\nThis is a polite reminder from *Al-Huda Islamic Centre* regarding tuition fee for enrolled student(s): *${item.studentsNames}*.\nPending Due: *${item.currency} ${item.dueAmount.toFixed(2)}*.\nKindly arrange payment at your earliest convenience.\nJazakAllahu Khairan!`;
        const waUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(waMsg)}`;

        return `
          <tr class="hover:bg-slate-50 transition">
            <td class="p-3 font-mono font-bold text-slate-700">${item.familyId}</td>
            <td class="p-3 font-bold text-slate-900">${item.parentName}</td>
            <td class="p-3 font-medium text-emerald-900">${item.studentsNames}</td>
            <td class="p-3 text-slate-500">${item.country}</td>
            <td class="p-3 font-bold font-mono text-rose-700 text-sm">${item.currency} ${item.dueAmount.toFixed(2)}</td>
            <td class="p-3">
              <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${item.isPartial ? 'bg-amber-100 text-amber-800 border border-amber-300' : 'bg-rose-100 text-rose-800 border border-rose-300'}">
                ${item.status}
              </span>
            </td>
            <td class="p-3 text-right space-x-1.5">
              <button onclick="selectFeeFamily('${item.familyId}')" class="px-2.5 py-1 bg-emerald-700 text-white rounded-lg text-xs font-bold hover:bg-emerald-800 transition">
                <i class="fa-solid fa-cash-register mr-1"></i>Collect
              </button>
              ${CURRENT_ROLE !== 'manager' ? `
                <a href="${waUrl}" target="_blank" class="px-2.5 py-1 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-700 inline-flex items-center gap-1 transition">
                  <i class="fa-brands fa-whatsapp"></i>Remind
                </a>
              ` : `
                <span class="px-2.5 py-1 bg-amber-50 text-amber-800 border border-amber-200 rounded-lg text-[10px] font-bold inline-flex items-center gap-1" title="Protected Student Contact for Manager">
                  <i class="fa-solid fa-lock text-amber-500 text-[10px]"></i> Protected
                </span>
              `}
            </td>
          </tr>
        `;
      }).join('');
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

    // ============================================================
    // 5. MASTER ANNUAL FEE MATRIX (12-MONTH VIEW)
    // ============================================================
    function loadMasterAnnualMatrix() {
      const ySel = document.getElementById('feeMatrixYearSelect');
      const targetYear = ySel ? parseInt(ySel.value, 10) : 2026;
      const tbody = document.getElementById('feeMatrixTableBody');
      if (!tbody) return;

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
          const isAdv = String(r.status).toLowerCase().includes('advance');

          if (!famMonthMap[fIdUpper]) famMonthMap[fIdUpper] = {};
          if (!famMonthMap[fIdUpper][mLower]) {
            famMonthMap[fIdUpper][mLower] = {
              paid: parseFloat(r.amountPaid || 0),
              remaining: parseFloat(r.remainingBalance || 0),
              date: r.date || '',
              isAdvance: isAdv
            };
          } else {
            famMonthMap[fIdUpper][mLower].paid += parseFloat(r.amountPaid || 0);
            famMonthMap[fIdUpper][mLower].remaining = parseFloat(r.remainingBalance || 0);
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
          if (feeRec) {
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

          // 5. Future vs Due
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

      CACHED_ANNUAL_FEE_MATRIX = matrixRows;
      renderAnnualFeeMatrix(matrixRows);
    }

    function renderAnnualFeeMatrix(rows) {
      const tbody = document.getElementById('feeMatrixTableBody');
      if (!tbody) return;

      if (!rows || rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="15" class="p-8 text-center text-slate-400">No enrolled families found.</td></tr>`;
        return;
      }

      tbody.innerHTML = rows.map(r => {
        const monthsHtml = r.months.map(m => {
          let cellBg = 'bg-white';
          let cellContent = '';

          if (m.isPaid) {
            cellBg = 'bg-emerald-50';
            cellContent = `
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
            <td class="p-2.5 text-left font-mono font-bold text-slate-800 bg-white sticky left-0 z-20 shadow-[2px_0_5px_rgba(0,0,0,0.06)]">${r.familyId}</td>
            <td class="p-2.5 text-left bg-white sticky left-[90px] z-20 shadow-[2px_0_5px_rgba(0,0,0,0.06)]">
              <strong class="text-slate-900 font-bold block truncate max-w-[130px] sm:max-w-none">${r.studentsNames}</strong>
              <span class="text-[10px] text-slate-400 block truncate max-w-[130px] sm:max-w-none">${r.parentName} (${r.currency} ${r.monthlyFee.toFixed(0)}/m)</span>
            </td>
            ${monthsHtml}
            <td class="p-2 text-center bg-slate-50/50">
              <button onclick="openFamilyAnnualLedgerModal('${r.familyId}')" class="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[10px] font-bold transition shadow-2xs" title="View Full 12-Month Ledger">
                Ledger
              </button>
            </td>
          </tr>
        `;
      }).join('');
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
      const year = yrSelect ? parseInt(yrSelect.value, 10) : 2026;
      const enrollInfo = getFamilyEnrollmentInfo(fam);

      let statusHtml = '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800">Due / Unpaid</span>';
      if (m.isPaid) {
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

      openModal('modalMatrixAction');
    }

    function applyMatrixAction(actionType) {
      if (!CURRENT_MATRIX_ACTION_DATA) return;
      const { familyId, month, year } = CURRENT_MATRIX_ACTION_DATA;
      const fIdUpper = String(familyId).toUpperCase();
      const mLower = String(month).toLowerCase();
      const mIdx = FEE_CONFIG.MONTHS.findIndex(m => m.toLowerCase() === mLower);
      const targetYearInt = parseInt(year, 10);

      const overrides = getStoredMatrixOverrides();
      const overrideKey = `${fIdUpper}_${mLower}_${year}`;
      const admKey = `ADMISSION_${fIdUpper}`;

      if (actionType === 'set_admission_date') {
        // Sets this family's admission month & year to this selected month
        overrides[admKey] = {
          year: targetYearInt,
          monthIndex: mIdx,
          monthName: month,
          updatedAt: new Date().toISOString()
        };

        // Clean up individual month overrides before this month so enrollment engine auto-manages them as N/A
        FEE_CONFIG.MONTHS.forEach((nm, idx) => {
          if (idx < mIdx) {
            delete overrides[`${fIdUpper}_${nm.toLowerCase()}_${targetYearInt}`];
          }
        });

        saveStoredMatrixOverrides(overrides);
        syncMatrixOverridesToCloud(familyId, overrides);
        closeModal('modalMatrixAction');
        loadMasterAnnualMatrix();
        loadFeeDashboardStats();
        showToastNotification(`Admission set to ${month} ${year}! All prior months are automatically N/A ($0 fee & 0 arrears).`);
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
        showToastNotification(`${month} and all prior months marked as Not Enrolled (N/A)! Arrears cleared.`);
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
      showToastNotification(`Status updated for ${month} ${year}!`);
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
      const year = ySel ? parseInt(ySel.value, 10) : 2026;

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
          if (m.isPaid) statusBadge = '<span class="text-emerald-700 font-bold text-[10px]"><i class="fa-solid fa-check mr-0.5"></i>Paid</span>';
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
              ${m.isPaid ? `Paid: <strong class="text-emerald-700">${fam.currency} ${m.amountPaid || 0}</strong>` : (m.isLeave ? 'Approved Leave' : (m.isNotEnrolled ? 'Not Enrolled' : 'Tuition Due'))}
            </div>
          `;
          grid.appendChild(card);
        });
      }

      // Render Transaction History
      const records = getStoredFeeRecords().filter(r => String(r.familyId).toUpperCase() === String(famId).toUpperCase());
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
    }

    function renderFeeReceiptsHistoryRows(records) {
      const tbody = document.getElementById('feeReceiptsTableBody');
      if (!tbody) return;

      if (!records || records.length === 0) {
        tbody.innerHTML = `<tr><td colspan="11" class="p-8 text-center text-slate-400">No payment receipts recorded yet.</td></tr>`;
        return;
      }

      tbody.innerHTML = records.map(r => `
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
          </td>
        </tr>
      `).join('');
    }

    function filterFeeReceiptsHistoryLive() {
      const q = (document.getElementById('feeReceiptsSearchInput')?.value || '').trim().toLowerCase();
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

    // Generic Toast notification helper for fee engine
    function showToastNotification(message) {
      if (typeof showAttendanceToast === 'function') {
        showAttendanceToast(message);
      } else {
        alert(message);
      }
    }

    async function loadCourses() {
      const { data: courses } = await db.from('courses').select('*');
      const cSelect = document.getElementById('stuCourseId');
      if (cSelect) {
        cSelect.innerHTML = (courses || []).map(c => `<option value="${c.id}">${c.name}</option>`).join('');
      }
    }


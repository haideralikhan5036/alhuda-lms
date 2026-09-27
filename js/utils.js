/**
 * ============================================================================
 * AL-HUDA ISLAMIC CENTRE LMS — MODULAR ARCHITECTURE
 * File: js/utils.js
 * Purpose: Shared Modal Helpers (openModal/closeModal), Zero-Cache Enforcement & Supabase Realtime Sync
 * Extracted Line Range: 16424 – 16485 (62 lines)
 * ============================================================================
 */

    function openModal(id) {
      const m = document.getElementById(id);
      if (m) {
        m.classList.remove('hidden');
        m.classList.add('flex');
        try {
          window.history.pushState({ type: 'modal', modalId: id }, '', window.location.pathname);
        } catch (e) {}
        if (typeof updateBackBtnVisibility === 'function') updateBackBtnVisibility();
      }
    }
    function closeModal(id) {
      const m = document.getElementById(id);
      if (m) {
        m.classList.add('hidden');
        m.classList.remove('flex');
        if (window.history.state && window.history.state.type === 'modal' && window.history.state.modalId === id) {
          isProgrammaticModalBack = true;
          window.history.back();
        }
        if (typeof updateBackBtnVisibility === 'function') updateBackBtnVisibility();
      }
    }

    // ============================================================
    // ZERO-CACHE ENFORCEMENT: Unregister any service workers and clear all caches
    // ============================================================
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(registrations => {
        for (let reg of registrations) {
          reg.unregister().then(() => {
            console.log('[PWA] Unregistered service worker:', reg.scope);
          });
        }
      });
    }
    if ('caches' in window) {
      caches.keys().then(keys => {
        for (let k of keys) {
          caches.delete(k);
          console.log('[PWA] Cleared cache:', k);
        }
      });
    }

    // ============================================================================
    // UNIFIED CLOUD STATE & TWO-WAY REAL-TIME SYNC ENGINE (Desktop ↔ Mobile)
    // Ensures 100% data parity across Salaries, Accounts, Fees, Announcements,
    // Complaints, Teacher Requests, Families, Students, Schedules & Attendance
    // ============================================================================
    let IS_CLOUD_HYDRATING = false;
    let _realtimeRefreshDebounceTimer = null;
    let _lastCloudSyncTimestamp = 0;

    function parseTeacherCloudAddressMeta(rawAddr) {
      if (!rawAddr) return { residential_address: '' };
      if (typeof rawAddr === 'object') return rawAddr;
      const str = String(rawAddr).trim();
      if (str.startsWith('{') && str.endsWith('}')) {
        try {
          const parsed = JSON.parse(str);
          if (parsed && typeof parsed === 'object') {
            if (parsed.residential_address === undefined && typeof parsed.address === 'string') {
              parsed.residential_address = parsed.address;
            }
            return parsed;
          }
        } catch (e) {}
      }
      return { residential_address: str };
    }

    async function hydrateGlobalSharedStateFromCloud(familiesList, teachersList) {
      if (IS_CLOUD_HYDRATING) return;
      IS_CLOUD_HYDRATING = true;
      try {
        const families = Array.isArray(familiesList) ? familiesList : (typeof ALL_FAMILIES !== 'undefined' && Array.isArray(ALL_FAMILIES) ? ALL_FAMILIES : []);
        const teachers = Array.isArray(teachersList) ? teachersList : (typeof ALL_TEACHERS !== 'undefined' && Array.isArray(ALL_TEACHERS) ? ALL_TEACHERS : []);

        // 1. Always ingest Fee Records & Matrix Overrides from families.notes so Dashboard & Mobile are immediately synced
        if (typeof ingestFeeDataFromFamilies === 'function' && families.length > 0) {
          await ingestFeeDataFromFamilies(families);
        }

        // 2. Read current local storage state
        let localSalaries = {};
        let localTeacherAccs = {};
        let localParentAccs = {};
        let localAnnouncements = null;
        let localComplaints = null;
        let localTeacherReqs = [];

        try { localSalaries = JSON.parse(localStorage.getItem('alhuda_teacher_salaries') || '{}'); } catch (e) { localSalaries = {}; }
        try { localTeacherAccs = JSON.parse(localStorage.getItem('alhuda_teacher_accounts') || '{}'); } catch (e) { localTeacherAccs = {}; }
        try { localParentAccs = JSON.parse(localStorage.getItem('alhuda_parent_accounts') || '{}'); } catch (e) { localParentAccs = {}; }
        try { localAnnouncements = JSON.parse(localStorage.getItem('alhuda_official_announcements') || 'null'); } catch (e) { localAnnouncements = null; }
        try { localComplaints = JSON.parse(localStorage.getItem('alhuda_parent_complaints') || 'null'); } catch (e) { localComplaints = null; }
        try { localTeacherReqs = JSON.parse(localStorage.getItem('alhuda_local_teacher_requests') || '[]'); } catch (e) { localTeacherReqs = []; }

        let cloudSharedState = null;
        let cloudStateUpdatedAt = 0;

        // Find the newest lms_shared_sync payload across families.notes
        families.forEach(f => {
          if (!f || !f.notes) return;
          try {
            const nObj = typeof f.notes === 'object' ? f.notes : JSON.parse(f.notes);
            if (nObj && nObj.lms_shared_sync && typeof nObj.lms_shared_sync === 'object') {
              const ts = new Date(nObj.lms_shared_sync.updated_at || 0).getTime() || 0;
              if (ts >= cloudStateUpdatedAt) {
                cloudStateUpdatedAt = ts;
                cloudSharedState = nObj.lms_shared_sync;
              }
            }
          } catch (e) {}
        });

        let needsCloudMigrationPush = false;

        // 3. Hydrate & Merge Teacher Accounts and Salaries from both teachers.address and cloudSharedState
        const mergedSalaries = { ...(cloudSharedState?.teacher_salaries || {}), ...localSalaries };
        if (cloudSharedState?.teacher_salaries) {
          Object.entries(cloudSharedState.teacher_salaries).forEach(([k, cloudSlip]) => {
            const locSlip = localSalaries[k];
            if (!locSlip) {
              mergedSalaries[k] = cloudSlip;
            } else {
              const cTime = new Date(cloudSlip?.saved_at || 0).getTime() || 0;
              const lTime = new Date(locSlip?.saved_at || 0).getTime() || 0;
              mergedSalaries[k] = cTime >= lTime ? cloudSlip : locSlip;
            }
          });
        }

        const mergedTeacherAccs = { ...(cloudSharedState?.teacher_accounts || {}), ...localTeacherAccs };
        if (cloudSharedState?.teacher_accounts) {
          Object.entries(cloudSharedState.teacher_accounts).forEach(([tId, cAcc]) => {
            mergedTeacherAccs[tId] = { ...(localTeacherAccs[tId] || {}), ...cAcc };
          });
        }

        teachers.forEach(t => {
          if (!t || !t.id) return;
          const meta = parseTeacherCloudAddressMeta(t.address);
          if (meta.teacher_account && typeof meta.teacher_account === 'object') {
            mergedTeacherAccs[t.id] = { ...(mergedTeacherAccs[t.id] || {}), ...meta.teacher_account };
          } else if (meta.username || meta.emp_id || meta.joining_date) {
            mergedTeacherAccs[t.id] = {
              ...(mergedTeacherAccs[t.id] || {}),
              ...(meta.emp_id ? { teacher_id: meta.emp_id, emp_id: meta.emp_id } : {}),
              ...(meta.username ? { username: meta.username } : {}),
              ...(meta.password ? { password: meta.password } : {}),
              ...(meta.joining_date ? { joining_date: meta.joining_date } : {}),
              ...(meta.employee_type ? { employee_type: meta.employee_type } : {})
            };
          }

          if (meta.salary_slips && typeof meta.salary_slips === 'object') {
            Object.entries(meta.salary_slips).forEach(([sKey, sVal]) => {
              const existing = mergedSalaries[sKey];
              const cTime = new Date(sVal?.saved_at || 0).getTime() || 0;
              const eTime = new Date(existing?.saved_at || 0).getTime() || 0;
              if (!existing || cTime >= eTime) {
                mergedSalaries[sKey] = sVal;
              }
            });
          }
        });

        // Check if local device had salaries not yet in cloudSharedState
        if (Object.keys(localSalaries).length > 0 && (!cloudSharedState || !cloudSharedState.teacher_salaries || Object.keys(cloudSharedState.teacher_salaries).length < Object.keys(mergedSalaries).length)) {
          needsCloudMigrationPush = true;
        }

        localStorage.setItem('alhuda_teacher_salaries', JSON.stringify(mergedSalaries));
        localStorage.setItem('alhuda_teacher_accounts', JSON.stringify(mergedTeacherAccs));

        // 4. Hydrate & Merge Parent Accounts from families.notes + cloudSharedState
        const mergedParentAccs = { ...(cloudSharedState?.parent_accounts || {}), ...localParentAccs };
        families.forEach(f => {
          if (!f || !f.id || !f.notes) return;
          try {
            const nObj = typeof f.notes === 'object' ? f.notes : JSON.parse(f.notes);
            if (nObj && nObj.portal_credentials && nObj.portal_credentials.username) {
              mergedParentAccs[f.id] = nObj.portal_credentials;
            }
          } catch (e) {}
        });
        localStorage.setItem('alhuda_parent_accounts', JSON.stringify(mergedParentAccs));

        // 5. Hydrate Announcements, Parent Complaints & Teacher Requests
        if (cloudSharedState) {
          if (Array.isArray(cloudSharedState.announcements)) {
            localStorage.setItem('alhuda_official_announcements', JSON.stringify(cloudSharedState.announcements));
          }
          if (Array.isArray(cloudSharedState.parent_complaints)) {
            localStorage.setItem('alhuda_parent_complaints', JSON.stringify(cloudSharedState.parent_complaints));
          }
          if (Array.isArray(cloudSharedState.teacher_requests)) {
            localStorage.setItem('alhuda_local_teacher_requests', JSON.stringify(cloudSharedState.teacher_requests));
          }
        } else if (families.length > 0 && (localAnnouncements || localComplaints || Object.keys(mergedSalaries).length > 0)) {
          needsCloudMigrationPush = true;
        }

        if (needsCloudMigrationPush && families.length > 0) {
          setTimeout(() => {
            syncGlobalSharedStateToCloud().catch(() => {});
          }, 300);
        }
      } catch (err) {
        console.warn('[Cloud Sync Hydration] Notice:', err);
      } finally {
        IS_CLOUD_HYDRATING = false;
      }
    }

    async function syncGlobalSharedStateToCloud(options = {}) {
      if (IS_CLOUD_HYDRATING) return;
      try {
        if (typeof db === 'undefined' || !db) return;

        let salaries = {};
        let teacherAccs = {};
        let parentAccs = {};
        let announcements = [];
        let complaints = [];
        let teacherReqs = [];

        try { salaries = JSON.parse(localStorage.getItem('alhuda_teacher_salaries') || '{}'); } catch (e) {}
        try { teacherAccs = JSON.parse(localStorage.getItem('alhuda_teacher_accounts') || '{}'); } catch (e) {}
        try { parentAccs = JSON.parse(localStorage.getItem('alhuda_parent_accounts') || '{}'); } catch (e) {}
        try { announcements = JSON.parse(localStorage.getItem('alhuda_official_announcements') || '[]'); } catch (e) {}
        try { complaints = JSON.parse(localStorage.getItem('alhuda_parent_complaints') || '[]'); } catch (e) {}
        try { teacherReqs = JSON.parse(localStorage.getItem('alhuda_local_teacher_requests') || '[]'); } catch (e) {}

        // 1. If a specific teacherId was passed, also update that teacher's address JSON in Supabase
        if (options.teacherId) {
          try {
            const { data: tRow } = await db.from('teachers').select('id, address').eq('id', options.teacherId).maybeSingle();
            if (tRow) {
              const meta = parseTeacherCloudAddressMeta(tRow.address);
              if (teacherAccs[options.teacherId]) {
                meta.teacher_account = teacherAccs[options.teacherId];
              }
              const teacherSlips = {};
              Object.entries(salaries).forEach(([k, v]) => {
                if (k.startsWith(options.teacherId + '_') || (v && String(v.teacher_id) === String(options.teacherId))) {
                  teacherSlips[k] = v;
                }
              });
              meta.salary_slips = { ...(meta.salary_slips || {}), ...teacherSlips };
              await db.from('teachers').update({ address: JSON.stringify(meta) }).eq('id', options.teacherId);
            }
          } catch (e) {
            console.warn('[Cloud Teacher Sync] Notice:', e);
          }
        }

        // 2. Sync unified lms_shared_sync into primary carrier family row in Supabase
        let carrierFamilyId = null;
        if (typeof ALL_FAMILIES !== 'undefined' && Array.isArray(ALL_FAMILIES) && ALL_FAMILIES.length > 0) {
          const existingCarrier = ALL_FAMILIES.find(f => {
            try {
              const n = typeof f.notes === 'object' ? f.notes : JSON.parse(f.notes || '{}');
              return n && n.lms_shared_sync;
            } catch (e) { return false; }
          });
          carrierFamilyId = existingCarrier ? existingCarrier.id : ALL_FAMILIES[0].id;
        } else {
          const { data: fams } = await db.from('families').select('id, notes').order('created_at', { ascending: true }).limit(1);
          if (fams && fams.length > 0) carrierFamilyId = fams[0].id;
        }

        if (carrierFamilyId) {
          const { data: famRow } = await db.from('families').select('id, notes').eq('id', carrierFamilyId).maybeSingle();
          if (famRow) {
            let notesObj = {};
            try {
              notesObj = typeof famRow.notes === 'object' && famRow.notes !== null ? famRow.notes : JSON.parse(famRow.notes || '{}');
            } catch (e) {
              notesObj = { custom_notes: famRow.notes || '' };
            }
            notesObj.lms_shared_sync = {
              teacher_salaries: salaries,
              teacher_accounts: teacherAccs,
              parent_accounts: parentAccs,
              announcements: announcements,
              parent_complaints: complaints,
              teacher_requests: teacherReqs,
              updated_at: new Date().toISOString()
            };
            _lastCloudSyncTimestamp = Date.now();
            await db.from('families').update({ notes: JSON.stringify(notesObj) }).eq('id', carrierFamilyId);
          }
        }
      } catch (err) {
        console.warn('[Cloud Shared Sync] Notice:', err);
      }
    }

    async function triggerCrossDeviceLiveRefresh(sourceTable = 'all') {
      try {
        if (typeof db === 'undefined' || !db) return;

        if (typeof ensureCoreLmsDataLoaded === 'function') {
          await ensureCoreLmsDataLoaded({ force: true });
        } else {
          const [{ data: latestFamilies }, { data: latestTeachers }] = await Promise.all([
            db.from('families').select('*, students(*)').order('created_at', { ascending: false }),
            db.from('teachers').select('*').order('created_at', { ascending: false })
          ]);
          if (latestFamilies) window.ALL_FAMILIES = latestFamilies;
          if (latestTeachers) window.ALL_TEACHERS = latestTeachers;
          await hydrateGlobalSharedStateFromCloud(latestFamilies || [], latestTeachers || []);
        }

        if (typeof syncTopCircleNotificationDots === 'function') {
          syncTopCircleNotificationDots();
        }
        if (typeof renderPortalAnnouncementBanners === 'function') {
          renderPortalAnnouncementBanners();
        }

        // Avoid disrupting active typing inside an input/textarea/select
        const activeTag = document.activeElement ? document.activeElement.tagName : '';
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(activeTag) && document.activeElement.id !== 'globalPersistentTopSearchInput') {
          return;
        }

        // Refresh active view based on currently visible section
        const isVisible = (id) => {
          const el = document.getElementById(id);
          return el && !el.classList.contains('hidden');
        };

        if (isVisible('tab-dashboard') && typeof loadDashboardData === 'function') {
          await loadDashboardData();
        } else if (isVisible('tab-families') && typeof loadFamiliesAndStudents === 'function') {
          await loadFamiliesAndStudents();
        } else if (isVisible('tab-trials') && typeof loadTrials === 'function') {
          await loadTrials();
        } else if (isVisible('tab-teachers') && typeof loadTeachers === 'function') {
          await loadTeachers();
        } else if (isVisible('tab-salaries') && typeof calculateMonthlySalaries === 'function') {
          await calculateMonthlySalaries();
        } else if (isVisible('tab-invoices') && typeof loadFeeBillingLedger === 'function') {
          await loadFeeBillingLedger();
        } else if (isVisible('tab-leaves') && typeof loadLeaveManagementCenter === 'function') {
          await loadLeaveManagementCenter();
        } else if (isVisible('tab-profile-360')) {
          if (typeof CURRENT_360_FAMILY_ID !== 'undefined' && CURRENT_360_FAMILY_ID && typeof openFamily360Profile === 'function') {
            await openFamily360Profile(CURRENT_360_FAMILY_ID, window.CURRENT_360_STUDENT_ID || null);
          } else if (typeof CURRENT_360_TEACHER_ID !== 'undefined' && CURRENT_360_TEACHER_ID && typeof openTeacher360Profile === 'function') {
            await openTeacher360Profile(CURRENT_360_TEACHER_ID);
          }
        }
      } catch (e) {
        console.warn('[Live Refresh] Notice:', e);
      }
    }

    function scheduleDebouncedLiveRefresh(table) {
      if (Date.now() - _lastCloudSyncTimestamp < 900) return;
      if (_realtimeRefreshDebounceTimer) clearTimeout(_realtimeRefreshDebounceTimer);
      _realtimeRefreshDebounceTimer = setTimeout(() => {
        triggerCrossDeviceLiveRefresh(table);
      }, 450);
    }

    // Real-time Supabase Multi-Table Subscription + Mobile Visibility/Reconnect Resync
    try {
      if (typeof db !== 'undefined' && db && db.channel) {
        db.channel('alhuda-unified-realtime-sync')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'families' }, () => scheduleDebouncedLiveRefresh('families'))
          .on('postgres_changes', { event: '*', schema: 'public', table: 'students' }, () => scheduleDebouncedLiveRefresh('students'))
          .on('postgres_changes', { event: '*', schema: 'public', table: 'teachers' }, () => scheduleDebouncedLiveRefresh('teachers'))
          .on('postgres_changes', { event: '*', schema: 'public', table: 'class_schedules' }, () => scheduleDebouncedLiveRefresh('class_schedules'))
          .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance_logs' }, () => scheduleDebouncedLiveRefresh('attendance_logs'))
          .subscribe();
      }

      // Automatic Resync when Mobile device wakes up / switches tabs / reconnects to Wi-Fi or 4G
      window.addEventListener('online', () => {
        console.log('[Network Online] Re-synchronizing LMS state with Supabase...');
        scheduleDebouncedLiveRefresh('online');
      });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          scheduleDebouncedLiveRefresh('visibility');
        }
      });
    } catch (e) {
      console.warn("[Realtime Sync] Subscription notice:", e);
    }

    // ============================================================================
    // GLOBAL LMS NUMBER TYPOGRAPHY & CURRENCY PRESENTATION ENGINE
    // Presentation-only helpers (preserves 100% of underlying numerical data)
    // ============================================================================
    const LMS_CURRENCY_SYMBOLS = {
      USD: '$',
      GBP: '£',
      EUR: '€',
      CAD: 'CA$',
      AUD: 'A$',
      NZD: 'NZ$',
      PKR: 'PKR ',
      AED: 'AED ',
      SAR: 'SAR ',
      QAR: 'QAR ',
      KWD: 'KWD '
    };

    function formatLmsNumber(val, decimals = 0) {
      const num = parseFloat(val);
      if (isNaN(num)) return String(val ?? '0');
      return num.toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
      });
    }

    function formatLmsCurrencyHtml(amount, currencyCode = 'USD', sizeClass = '') {
      const num = parseFloat(amount);
      const cleanCur = String(currencyCode || 'USD').trim().toUpperCase();
      const sym = LMS_CURRENCY_SYMBOLS[cleanCur] || (cleanCur + ' ');
      const formattedNum = isNaN(num)
        ? String(amount ?? '0')
        : num.toLocaleString('en-US', {
            minimumFractionDigits: Number.isInteger(num) ? 0 : 2,
            maximumFractionDigits: 2
          });
      const isPrefixSymbol = ['$', '£', '€', 'CA$', 'A$', 'NZ$'].includes(sym);
      if (isPrefixSymbol) {
        return `<span class="lms-num-financial ${sizeClass}"><span class="lms-curr-sym">${sym}</span>${formattedNum}</span>`;
      }
      return `<span class="lms-num-financial ${sizeClass}"><span class="lms-curr-code">${cleanCur}</span> ${formattedNum}</span>`;
    }

    function enforceGlobalNumberTypographySystem() {
      let styleEl = document.getElementById('lms-global-number-design-system');
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'lms-global-number-design-system';
      }
      styleEl.textContent = `
        :root {
          --font-ui: 'Inter', 'Plus Jakarta Sans', 'Segoe UI', system-ui, -apple-system, sans-serif;
          --font-num: 'Plus Jakarta Sans', 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif;
        }

        /* Eliminate Courier/Monospace fallback across all elements and native OS dropdowns */
        .font-mono,
        .font-num,
        td.font-mono,
        span.font-mono,
        div.font-mono,
        button.font-mono,
        input.font-mono,
        select.font-mono {
          font-family: var(--font-num) !important;
          font-variant-numeric: tabular-nums lining-nums !important;
          font-feature-settings: 'tnum' 1, 'lnum' 1, 'cv01' 1, 'cv02' 1, 'zero' 0 !important;
        }

        select, option, optgroup, input, textarea {
          font-family: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif !important;
          font-variant-numeric: tabular-nums lining-nums !important;
          font-feature-settings: 'tnum' 1, 'lnum' 1, 'zero' 0 !important;
        }

        /* Tier 1: Dashboard KPI Hero Numbers */
        .lms-num-kpi,
        #statFamilies, #statStudents, #statRevenue, #statSalaries, #statTrials,
        #trialsKpiActive, #trialsKpiCompleted, #trialsKpiConverted, #trialsKpiTotal,
        #payrollKpiTotal, #payrollKpiTeachers, #payrollKpiStudents, #payrollKpiDisbursed,
        #kpiLeavesActive, #kpiLeavesReturningSoon, #kpiLeavesOverdue, #kpiLeavesTotal,
        #kpiFeeTotalFamilies, #kpiFeePaidCount, #kpiFeePendingCount, #kpiFeeLeaveCount,
        #statAssignedStudents, #statTodayClasses, #statCompleted, #statRemaining {
          font-family: var(--font-num) !important;
          font-size: clamp(1.65rem, 2vw, 2.05rem) !important;
          font-weight: 700 !important;
          line-height: 1.1 !important;
          letter-spacing: -0.025em !important;
          font-variant-numeric: tabular-nums lining-nums !important;
          font-feature-settings: 'tnum' 1, 'lnum' 1, 'zero' 0 !important;
          white-space: nowrap !important;
        }

        /* Compact 2x2 Dashboard Header Boxes (4 on Left + 4 on Right) */
        [id^="kpiDash"]:not([id*="Badge"]):not([id*="Box"]) {
          font-family: var(--font-num) !important;
          font-size: 1.25rem !important;
          font-weight: 800 !important;
          line-height: 1.1 !important;
          letter-spacing: -0.02em !important;
          font-variant-numeric: tabular-nums lining-nums !important;
          font-feature-settings: 'tnum' 1, 'lnum' 1, 'zero' 0 !important;
          white-space: nowrap !important;
        }

        /* Tier 2: Card & Summary Bar Statistics */
        .lms-num-stat,
        #famSummaryTotalFamilies, #famSummaryActiveFamilies,
        #famSummaryTotalStudents, #famSummaryActiveStudents {
          font-family: var(--font-num) !important;
          font-size: 1.35rem !important;
          font-weight: 700 !important;
          line-height: 1.15 !important;
          letter-spacing: -0.02em !important;
          font-variant-numeric: tabular-nums lining-nums !important;
          font-feature-settings: 'tnum' 1, 'lnum' 1, 'zero' 0 !important;
          white-space: nowrap !important;
        }

        /* Tier 3: Financial & Currency Numbers */
        .lms-num-financial {
          font-family: var(--font-num) !important;
          font-weight: 700 !important;
          letter-spacing: -0.015em !important;
          font-variant-numeric: tabular-nums lining-nums !important;
          font-feature-settings: 'tnum' 1, 'lnum' 1, 'zero' 0 !important;
          white-space: nowrap !important;
          display: inline-flex;
          align-items: baseline;
          gap: 0.12em;
        }
        .lms-num-financial .lms-curr-sym {
          font-weight: 600 !important;
          opacity: 0.9;
          margin-right: 0.06em;
        }
        .lms-num-financial .lms-curr-code {
          font-size: 0.82em !important;
          font-weight: 700 !important;
          opacity: 0.85;
          margin-right: 0.18em;
          letter-spacing: 0.02em;
        }

        /* Tier 4: Percentages */
        .lms-num-percent,
        #kpiFeePaidPercent, #kpiFeePendingPercent, #kpiFeeProgressPercent {
          font-family: var(--font-num) !important;
          font-weight: 700 !important;
          letter-spacing: -0.015em !important;
          font-variant-numeric: tabular-nums lining-nums !important;
          font-feature-settings: 'tnum' 1, 'lnum' 1, 'zero' 0 !important;
          white-space: nowrap !important;
        }

        /* Tier 5: Table Numbers, Time Slots & Dates */
        .lms-num-table,
        .lms-num-time,
        .lms-num-date {
          font-family: var(--font-num) !important;
          font-size: 0.875rem !important;
          font-weight: 600 !important;
          line-height: 1.35 !important;
          letter-spacing: -0.01em !important;
          font-variant-numeric: tabular-nums lining-nums !important;
          font-feature-settings: 'tnum' 1, 'lnum' 1, 'zero' 0 !important;
          white-space: nowrap !important;
        }

        /* Tier 6: Readable IDs & Reference Chips */
        .lms-num-id {
          font-family: var(--font-num) !important;
          font-size: 0.78rem !important;
          font-weight: 600 !important;
          letter-spacing: 0.01em !important;
          font-variant-numeric: tabular-nums lining-nums !important;
          font-feature-settings: 'tnum' 1, 'lnum' 1, 'zero' 0 !important;
          white-space: nowrap !important;
        }
      `;
      document.head.appendChild(styleEl);
    }

    // ============================================================================
    // GLOBAL MOBILE RESPONSIVE OPTIMIZATION ENGINE (320px - 767px Viewports)
    // Strictly scoped to @media (max-width: 767px) — 100% zero impact on Desktop
    // ============================================================================
    function enforceGlobalMobileResponsiveSystem() {
      let styleEl = document.getElementById('lms-global-mobile-responsive-system');
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'lms-global-mobile-responsive-system';
      }
      styleEl.textContent = `
        /* Global Desktop & Mobile Header Anti-Compression & Layout Stability Rules */
        #mainAppContainer > header h1 {
          white-space: nowrap !important;
          overflow: hidden !important;
          text-overflow: ellipsis !important;
          line-height: 1.2 !important;
        }
        #btnAppBack {
          flex-shrink: 0 !important;
          white-space: nowrap !important;
        }
        .no-scrollbar::-webkit-scrollbar {
          display: none !important;
        }
        .no-scrollbar {
          -ms-overflow-style: none !important;
          scrollbar-width: none !important;
        }

        /* Laptop & Mid-Desktop (1024px - 1279px) Anti-Overflow Safeguards */
        @media (min-width: 1024px) and (max-width: 1279px) {
          #globalPersistentTopSearchBar {
            gap: 0.5rem !important;
          }
          #dashGlobalSearchContainer {
            min-width: 220px !important;
            max-width: 320px !important;
          }
        }

        @media (max-width: 767px) {
          html, body {
            overflow-x: hidden !important;
            max-width: 100vw !important;
          }

          /* Persistent Top Search & Notification Action Bar Mobile Layout (Clean 2x2 Action Grid below Search) */
          #globalPersistentTopSearchBar {
            padding: 0.65rem 0.75rem !important;
            flex-direction: column !important;
            align-items: stretch !important;
            gap: 0.55rem !important;
          }
          #dashGlobalSearchContainer {
            width: 100% !important;
            max-width: 100% !important;
            min-width: 0 !important;
          }
          #globalPersistentTopSearchBar > div:last-child {
            display: grid !important;
            grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
            gap: 0.45rem !important;
            width: 100% !important;
          }
          #globalPersistentTopSearchBar > div:last-child > button {
            width: 100% !important;
            justify-content: space-between !important;
            padding: 0.42rem 0.6rem !important;
            min-width: 0 !important;
          }

          /* Global Search Results Dropdown Mobile Fit */
          #dashGlobalSearchResultsPanel,
          #globalPersistentTopSearchResults {
            left: 0 !important;
            right: 0 !important;
            width: 100% !important;
            max-height: 70dvh !important;
          }

          /* Mobile KPI Numbers Scaling to Prevent Clipping on 320px-375px */
          .lms-num-kpi,
          [id^="kpiDash"]:not([id*="Badge"]):not([id*="Box"]),
          #statFamilies, #statStudents, #statRevenue, #statSalaries, #statTrials,
          #trialsKpiActive, #trialsKpiCompleted, #trialsKpiConverted, #trialsKpiTotal,
          #payrollKpiTotal, #payrollKpiTeachers, #payrollKpiStudents, #payrollKpiDisbursed,
          #kpiLeavesActive, #kpiLeavesReturningSoon, #kpiLeavesOverdue, #kpiLeavesTotal,
          #kpiFeeTotalFamilies, #kpiFeePaidCount, #kpiFeePendingCount, #kpiFeeLeaveCount {
            font-size: 1.35rem !important;
          }

          /* Mobile Modals Viewport Fit & Internal Scroll */
          div.fixed[id^="modal"] > div,
          div.fixed[id*="Modal"] > div {
            max-width: calc(100vw - 16px) !important;
            max-height: 91dvh !important;
            overflow-y: auto !important;
            margin: 8px auto !important;
          }

          /* Tables Smooth Horizontal Scroll Without Breaking Page Width */
          .overflow-x-auto,
          .table-responsive {
            -webkit-overflow-scrolling: touch !important;
            overscroll-behavior-x: contain !important;
            max-width: 100% !important;
          }

          /* 360 Profile Workspace Mobile Stacking */
          #tab-profile-360 {
            padding-left: 0.25rem !important;
            padding-right: 0.25rem !important;
          }
        }
      `;
      document.head.appendChild(styleEl);
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        enforceGlobalNumberTypographySystem();
        enforceGlobalMobileResponsiveSystem();
        setTimeout(enforceGlobalNumberTypographySystem, 400);
      });
    } else {
      enforceGlobalNumberTypographySystem();
      enforceGlobalMobileResponsiveSystem();
      setTimeout(enforceGlobalNumberTypographySystem, 400);
    }


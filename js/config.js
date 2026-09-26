/**
 * ============================================================================
 * AL-HUDA ISLAMIC CENTRE LMS — MODULAR ARCHITECTURE
 * File: js/config.js
 * Purpose: Core Globals, Supabase Client Initialization, Role Privacy Masking & Master Boot Sequence
 * Extracted Line Range: 4864 – 4997 (134 lines)
 * ============================================================================
 */

    const SUPABASE_URL = "https://ldgzuyroejzrvktksugy.supabase.co";
    const SUPABASE_KEY = "sb_publishable_rP38XXgYoYBTPJlCxtwMUg_RPupFrKg";
    const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

    let ALL_TEACHERS = [];
    let ALL_STUDENTS = [];
    let ALL_FAMILIES = [];
    let CURRENT_ROLE = 'owner';
    let ACTIVE_MANAGER_ID = null;

    // STUDENT CONTACT PRIVACY GUARDS (MANDATORY FOR MANAGER ROLE)
    function maskStudentPhone(phone) {
      if (CURRENT_ROLE !== 'manager') return phone || '--';
      if (!phone) return '--';
      const clean = String(phone).trim();
      if (clean.length <= 5) return '••••••';
      return clean.slice(0, 4) + ' ••• ••••';
    }

    function maskStudentEmail(email) {
      if (CURRENT_ROLE !== 'manager') return email || '--';
      if (!email) return '--';
      const parts = String(email).trim().split('@');
      if (parts.length < 2) return '••••••';
      const name = parts[0];
      const domain = parts[1];
      const prefix = name.length > 2 ? name.slice(0, 2) : name.slice(0, 1);
      return `${prefix}•••••@${domain}`;
    }
    let CURRENT_MATRIX_TEACHER = null;
    let CURRENT_TEACHER_SCHEDULES = [];
    let CURRENT_MODAL_STUDENT_ID = null;
    let CURRENT_MODAL_TEACHER_ID = null;

    // TRIAL CLASSES MANAGEMENT STATE (Default to 'active' so Active Trials list shows current trials only)
    let ALL_TRIALS = [];
    let CURRENT_TRIAL_FILTER = 'active';
    let CURRENT_TRIAL_TEACHER_FILTER = 'all';

    // CANONICAL STATUS CLASSIFIERS (ONE SOURCE OF TRUTH FOR REGULAR VS TRIAL)
    function isRegularFamilyRecord(f) {
      if (!f) return false;
      const st = String(f.status || 'Active').trim().toLowerCase();
      if (st === 'trial' || st === 'converted' || st === 'discontinued' || st === 'deleted') return false;
      if (String(f.id || '').toUpperCase().startsWith('TRL-')) return false;
      if (f.notes) {
        try {
          const parsed = typeof f.notes === 'string' ? JSON.parse(f.notes) : f.notes;
          if (parsed && parsed.is_trial === true && !parsed.converted_to_regular && !parsed.converted_from_trial) {
            return false;
          }
        } catch (e) {}
      }
      return true;
    }

    function isRegularStudentRecord(s) {
      if (!s) return false;
      const st = String(s.status || 'Active').trim().toLowerCase();
      if (st === 'trial' || st === 'converted' || st === 'discontinued' || st === 'deleted') return false;
      if (String(s.id || '').toUpperCase().startsWith('TRL-')) return false;
      if (String(s.family_id || '').toUpperCase().startsWith('TRL-')) return false;
      if (s.notes) {
        try {
          const parsed = typeof s.notes === 'string' ? JSON.parse(s.notes) : s.notes;
          if (parsed && parsed.is_trial === true && !parsed.converted_to_regular && !parsed.converted_from_trial) {
            return false;
          }
        } catch (e) {}
      }
      return true;
    }

    let _CONSOLIDATION_PROMISE = null;
    async function consolidateDuplicateTrialAndRegularRecords() {
      if (_CONSOLIDATION_PROMISE) return _CONSOLIDATION_PROMISE;
      _CONSOLIDATION_PROMISE = (async () => {
        try {
          const { data: allFams } = await db.from('families').select('*, students(*)');
          const { data: allStus } = await db.from('students').select('*');
          if (!allFams || !allStus) return;

          const regularFams = allFams.filter(f => isRegularFamilyRecord(f));
          const legacyTrialFams = allFams.filter(f => !isRegularFamilyRecord(f));

          const normalizePhone = (p) => String(p || '').replace(/[^0-9]/g, '').slice(-10);
          const normalizeName = (n) => String(n || '').trim().toLowerCase().replace(/\s+/g, ' ');

          for (const trFam of legacyTrialFams) {
            const trStatus = String(trFam.status || '').toLowerCase();
            const isLegacyTrlId = String(trFam.id || '').toUpperCase().startsWith('TRL-');
            const trPhone = normalizePhone(trFam.whatsapp);
            const trName = normalizeName(trFam.parent_name);

            // Find if a matching Canonical Regular Family already exists for this Trial Family
            let canonicalFam = regularFams.find(rf => {
              const rfPhone = normalizePhone(rf.whatsapp);
              const rfName = normalizeName(rf.parent_name);
              if (trPhone && rfPhone && trPhone === rfPhone) return true;
              if (trName && rfName && trName === rfName) return true;
              if (rf.notes && String(rf.notes).includes(trFam.id)) return true;
              return false;
            });

            if (canonicalFam && (isLegacyTrlId || trStatus === 'converted')) {
              // Consolidate Trial Family history & students into canonicalFam
              const trStudents = allStus.filter(s => String(s.family_id) === String(trFam.id));
              const canonicalStudents = allStus.filter(s => String(s.family_id) === String(canonicalFam.id) && isRegularStudentRecord(s));
              const targetStu = canonicalStudents[0] || null;

              let famNotesObj = {};
              try {
                famNotesObj = typeof canonicalFam.notes === 'string' ? JSON.parse(canonicalFam.notes) : (canonicalFam.notes || {});
              } catch (e) {
                famNotesObj = { custom_notes: String(canonicalFam.notes || '') };
              }

              famNotesObj.converted_to_regular = true;
              famNotesObj.is_trial = false;
              famNotesObj.trial_history = {
                ...(famNotesObj.trial_history || {}),
                was_trial: true,
                previous_status: 'Trial',
                trial_status: 'Converted',
                legacy_trial_family_id: trFam.id,
                trial_start_date: (trFam.created_at || new Date().toISOString()).slice(0, 10),
                converted_at: famNotesObj.trial_history?.converted_at || (canonicalFam.created_at || new Date().toISOString()).slice(0, 10)
              };

              await db.from('families').update({
                status: canonicalFam.status === 'Trial' || canonicalFam.status === 'Converted' ? 'Active' : (canonicalFam.status || 'Active'),
                notes: JSON.stringify(famNotesObj)
              }).eq('id', canonicalFam.id);

              // Migrate attendance_logs & schedules from duplicate trial students and delete duplicate student rows
              for (const trStu of trStudents) {
                if (targetStu && String(trStu.id) !== String(targetStu.id)) {
                  let trStuNotes = {};
                  try { trStuNotes = JSON.parse(trStu.notes || '{}'); } catch (e) {}

                  let targetStuNotes = {};
                  try { targetStuNotes = JSON.parse(targetStu.notes || '{}'); } catch (e) {}
                  targetStuNotes.converted_to_regular = true;
                  targetStuNotes.trial_history = {
                    was_trial: true,
                    previous_status: 'Trial',
                    trial_status: 'Converted',
                    trial_course: trStuNotes.trial_course || targetStu.course_id || 'Quran Studies',
                    pkt_slot: trStuNotes.pkt_slot || '',
                    trial_start_date: trStu.joining_date || (trStu.created_at || '').slice(0, 10),
                    converted_at: trStuNotes.converted_at || targetStu.joining_date
                  };

                  await db.from('students').update({
                    notes: JSON.stringify(targetStuNotes)
                  }).eq('id', targetStu.id);

                  // Re-link any attendance_logs from trStu.id to targetStu.id
                  await db.from('attendance_logs').update({ student_id: targetStu.id }).eq('student_id', trStu.id);
                  await db.from('class_schedules').delete().eq('student_id', trStu.id);
                  await db.from('students').delete().eq('id', trStu.id);
                } else if (!targetStu) {
                  // Re-parent student to canonicalFam
                  await db.from('students').update({
                    family_id: canonicalFam.id,
                    status: 'Active'
                  }).eq('id', trStu.id);
                }
              }

              // Update localStorage trial records to reference canonical IDs with status='Converted'
              try {
                const storedTrials = JSON.parse(localStorage.getItem('alhuda_trial_classes') || '[]');
                let updatedLocal = false;
                storedTrials.forEach(t => {
                  if (t.family_id === trFam.id || normalizePhone(t.whatsapp) === trPhone) {
                    t.family_id = canonicalFam.id;
                    if (targetStu) t.student_id = targetStu.id;
                    t.status = 'Converted';
                    t.converted_family_id = canonicalFam.id;
                    if (targetStu) t.converted_student_id = targetStu.id;
                    updatedLocal = true;
                  }
                });
                if (updatedLocal) {
                  localStorage.setItem('alhuda_trial_classes', JSON.stringify(storedTrials));
                }
              } catch (e) {}

              // Remove the duplicate TRL-FAM record from Supabase
              await db.from('families').delete().eq('id', trFam.id);
            }
          }
        } catch (err) {
          console.warn('Duplicate trial/regular consolidation notice:', err);
        } finally {
          _CONSOLIDATION_PROMISE = null;
        }
      })();
      return _CONSOLIDATION_PROMISE;
    }

    // TEACHER SALARIES & PAYROLL STATE
    let ALL_TEACHER_SALARIES = {};
    let CURRENT_SLIP_TEACHER_ID = null;
    let CURRENT_SLIP_DATA = null;

    // MAIN EXECUTIVE DASHBOARD STATE
    let DASHBOARD_CLASSES = [];
    let CURRENT_DASH_FILTER = null;
    let DASH_STUDENT_CHART = null;
    let DASH_REVENUE_CHART = null;

    // LEAVE MANAGEMENT & TEACHER REQUESTS STATE
    let ALL_LEAVE_RECORDS = [];
    let OVERDUE_LEAVE_STUDENTS = [];
    let PENDING_TEACHER_REQUESTS = [];
    let CURRENT_LEAVES_FILTER = 'active';

    const DAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

    window.onload = async function() {
      if (typeof initRoleFromUrl === 'function') initRoleFromUrl();
      setInterval(() => {
        const now = new Date();
        const el = document.getElementById('liveClock');
        if (el) el.innerText = now.toLocaleTimeString('en-US', { timeZone: 'Asia/Karachi' }) + ' PKT';
      }, 1000);

      const today = new Date().toISOString().slice(0, 10);
      const attDateInput = document.getElementById('attendanceDateSelect');
      if (attDateInput) attDateInput.value = today;

      await consolidateDuplicateTrialAndRegularRecords();
      loadDashboardData();
      loadFamiliesAndStudents();
      loadTeachers();
      loadCourses();
      loadFeeBillingLedger();
      loadTrialClassesData();
      if (typeof loadCurriculumLibrary === 'function') loadCurriculumLibrary();
      if (typeof updateBackBtnVisibility === 'function') updateBackBtnVisibility();

      setInterval(loadDashboardData, 30000);
    };

    function toggleSidebar() {
      const sidebar = document.getElementById('mainAppSidebar');
      const content = document.getElementById('mainContentArea');
      const backdrop = document.getElementById('sidebarBackdrop');

      if (window.innerWidth < 1024) {
        // Mobile off-canvas drawer mode
        const isOpen = sidebar.classList.contains('sidebar-mobile-open');
        if (isOpen) {
          sidebar.classList.remove('sidebar-mobile-open');
          if (backdrop) backdrop.classList.add('hidden');
        } else {
          sidebar.classList.add('sidebar-mobile-open');
          if (backdrop) backdrop.classList.remove('hidden');
        }
      } else {
        // Desktop collapse mode
        const isCollapsed = sidebar.classList.contains('sidebar-collapsed');
        if (isCollapsed) {
          sidebar.classList.remove('sidebar-collapsed');
          content?.classList.remove('sidebar-collapsed');
          localStorage.setItem('alhuda_sidebar_collapsed', 'false');
        } else {
          sidebar.classList.add('sidebar-collapsed');
          content?.classList.add('sidebar-collapsed');
          localStorage.setItem('alhuda_sidebar_collapsed', 'true');
        }
      }
    }

    // Restore sidebar state from localStorage (desktop only)
    (function() {
      if (window.innerWidth >= 1024) {
        const saved = localStorage.getItem('alhuda_sidebar_collapsed');
        if (saved === 'true') {
          const sidebar = document.getElementById('mainAppSidebar');
          const content = document.getElementById('mainContentArea');
          if (sidebar) sidebar.classList.add('sidebar-collapsed');
          if (content) content.classList.add('sidebar-collapsed');
        }
      }
    })();

    window.addEventListener('resize', () => {
      if (window.innerWidth >= 1024) {
        const sidebar = document.getElementById('mainAppSidebar');
        const backdrop = document.getElementById('sidebarBackdrop');
        if (sidebar) sidebar.classList.remove('sidebar-mobile-open');
        if (backdrop) backdrop.classList.add('hidden');
      }
    });


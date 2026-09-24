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

    // TRIAL CLASSES MANAGEMENT STATE
    let ALL_TRIALS = [];
    let CURRENT_TRIAL_FILTER = 'all';
    let CURRENT_TRIAL_TEACHER_FILTER = 'all';

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

    window.onload = function() {
      if (typeof initRoleFromUrl === 'function') initRoleFromUrl();
      setInterval(() => {
        const now = new Date();
        const el = document.getElementById('liveClock');
        if (el) el.innerText = now.toLocaleTimeString('en-US', { timeZone: 'Asia/Karachi' }) + ' PKT';
      }, 1000);

      const today = new Date().toISOString().slice(0, 10);
      const attDateInput = document.getElementById('attendanceDateSelect');
      if (attDateInput) attDateInput.value = today;

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


/**
 * ============================================================================
 * AL-HUDA ISLAMIC CENTRE LMS — MODULAR ARCHITECTURE
 * File: js/navigation.js
 * Purpose: Smart SPA Navigation History, Hardware Back Button Engine & Sidebar Controller
 * Extracted Line Range: 4998 – 5314 (317 lines)
 * ============================================================================
 */

    // ============================================================
    // SMART IN-APP NAVIGATION HISTORY & BACK BUTTON ENGINE
    // ============================================================
    const NAV_FEATURE_LABELS = {
      'tab-dashboard': 'Dashboard',
      'tab-families': 'Families & Students',
      'tab-teachers': 'Teachers & Staff',
      'tab-trials': 'Trial Classes',
      'tab-attendance': 'Live Attendance',
      'tab-salaries': 'Payroll & Salaries',
      'tab-leaves': 'Leaves & Exceptions',
      'tab-invoices': 'Fee Management',
      'tab-curriculum': 'Islamic Curriculum',
      'tab-schedule-search': 'Schedule Search',
      'fee-subtab-overview': 'Fee Overview',
      'fee-subtab-collect': 'Collect Fee',
      'fee-subtab-pending': 'Pending Payments',
      'fee-subtab-defaulters': 'Defaulters (3+ Months)',
      'fee-subtab-matrix': 'Annual Matrix',
      'fee-subtab-receipts': 'Receipts'
    };

    const appNavHistory = [];
    let currentNavState = {
      tabId: 'tab-dashboard',
      subTabId: null,
      label: 'Dashboard'
    };
    let isNavigatingHistory = false;
    let isProgrammaticModalBack = false;

    // Helper to get currently active modal overlay container
    function getActiveModalOverlay() {
      const modals = Array.from(document.querySelectorAll('div.fixed[id^="modal"]:not(.hidden), div.fixed[id*="Modal"]:not(.hidden)'));
      return modals.reverse().find(m => {
        const style = window.getComputedStyle(m);
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
      });
    }

    function updateBackBtnVisibility() {
      const btn = document.getElementById('btnAppBack');
      const lbl = document.getElementById('lblBackTarget');
      if (!btn) return;

      const visibleModal = getActiveModalOverlay();
      const isNotDashboard = currentNavState.tabId !== 'tab-dashboard';
      const hasHistory = appNavHistory.length > 0 || isNotDashboard || !!visibleModal;

      if (hasHistory) {
        btn.classList.remove('hidden');
        btn.classList.add('flex');

        let prevLabel = 'Dashboard';
        if (visibleModal) {
          prevLabel = 'Close';
        } else if (appNavHistory.length > 0) {
          const prev = appNavHistory[appNavHistory.length - 1];
          prevLabel = prev.label || (NAV_FEATURE_LABELS[prev.subTabId] || NAV_FEATURE_LABELS[prev.tabId] || 'Dashboard');
        } else if (isNotDashboard) {
          prevLabel = 'Dashboard';
        }

        if (lbl) lbl.textContent = `(${prevLabel})`;
        btn.setAttribute('title', visibleModal ? 'Close current dialog' : `Back to ${prevLabel}`);
      } else {
        btn.classList.add('hidden');
        btn.classList.remove('flex');
      }
    }

    function recordNavigation(targetTabId, targetSubTabId = null) {
      if (isNavigatingHistory) return;

      const effectiveSubTab = (targetTabId === 'tab-invoices' && !targetSubTabId) ? 'fee-subtab-overview' : targetSubTabId;

      const isSameTab = currentNavState.tabId === targetTabId;
      const isSameSubTab = currentNavState.subTabId === effectiveSubTab;
      if (isSameTab && isSameSubTab) return;

      // Push current state to navigation stack before switching
      appNavHistory.push({
        tabId: currentNavState.tabId,
        subTabId: currentNavState.subTabId,
        label: currentNavState.label || NAV_FEATURE_LABELS[currentNavState.subTabId] || NAV_FEATURE_LABELS[currentNavState.tabId] || 'Dashboard'
      });

      if (appNavHistory.length > 50) {
        appNavHistory.shift();
      }

      const newLabel = effectiveSubTab ? (NAV_FEATURE_LABELS[effectiveSubTab] || effectiveSubTab) : (NAV_FEATURE_LABELS[targetTabId] || targetTabId);
      currentNavState = {
        tabId: targetTabId,
        subTabId: effectiveSubTab,
        label: newLabel
      };

      try {
        window.history.pushState({ type: 'tab', tabId: targetTabId, subTabId: effectiveSubTab, depth: appNavHistory.length }, '', window.location.pathname);
      } catch (e) {}

      updateBackBtnVisibility();
    }

    function navigateAppBack() {
      // 1. Check if any active modal or drawer is open; close it first
      const visibleModal = getActiveModalOverlay();
      if (visibleModal) {
        if (typeof closeModal === 'function') {
          closeModal(visibleModal.id);
        } else {
          visibleModal.classList.add('hidden');
          visibleModal.classList.remove('flex');
        }
        updateBackBtnVisibility();
        return;
      }

      // Check if mobile sidebar drawer is open
      const mobileSidebar = document.getElementById('mainAppSidebar');
      if (mobileSidebar && mobileSidebar.classList.contains('sidebar-mobile-open')) {
        mobileSidebar.classList.remove('sidebar-mobile-open');
        document.getElementById('sidebarBackdrop')?.classList.add('hidden');
        return;
      }

      // 2. Use browser history if available to keep URL state and JS state in sync
      if (window.history.state && window.history.state.depth > 0) {
        window.history.back();
        return;
      }

      // 3. Fallback: Pop and restore from history stack
      if (appNavHistory.length > 0) {
        isNavigatingHistory = true;
        const prevState = appNavHistory.pop();

        if (prevState.tabId) {
          switchTab(prevState.tabId);
        }

        if (prevState.subTabId && prevState.tabId === 'tab-invoices') {
          if (typeof switchFeeSubTab === 'function') {
            switchFeeSubTab(prevState.subTabId);
          }
        }

        currentNavState = {
          tabId: prevState.tabId || 'tab-dashboard',
          subTabId: prevState.subTabId || null,
          label: prevState.label || NAV_FEATURE_LABELS[prevState.subTabId] || NAV_FEATURE_LABELS[prevState.tabId] || 'Dashboard'
        };

        isNavigatingHistory = false;
        updateBackBtnVisibility();
      } else if (currentNavState.tabId !== 'tab-dashboard') {
        // Fallback to Dashboard
        isNavigatingHistory = true;
        switchTab('tab-dashboard');
        currentNavState = { tabId: 'tab-dashboard', subTabId: null, label: 'Dashboard' };
        isNavigatingHistory = false;
        updateBackBtnVisibility();
      }
    }

    // Hardware / Browser Back button and gesture listener
    window.addEventListener('popstate', (e) => {
      // If modal programmatic back was triggered, ignore this pop
      if (isProgrammaticModalBack) {
        isProgrammaticModalBack = false;
        return;
      }

      // 1. If an active modal is open, closing it is the top priority!
      const visibleModal = getActiveModalOverlay();
      if (visibleModal) {
        if (typeof closeModal === 'function') {
          closeModal(visibleModal.id);
        } else {
          visibleModal.classList.add('hidden');
          visibleModal.classList.remove('flex');
        }
        updateBackBtnVisibility();
        return;
      }

      // 2. If mobile sidebar is open, close it
      const mobileSidebar = document.getElementById('mainAppSidebar');
      if (mobileSidebar && mobileSidebar.classList.contains('sidebar-mobile-open')) {
        mobileSidebar.classList.remove('sidebar-mobile-open');
        document.getElementById('sidebarBackdrop')?.classList.add('hidden');
        return;
      }

      // 3. Navigate back through tabs
      if (e.state && e.state.type === 'tab') {
        isNavigatingHistory = true;
        if (appNavHistory.length > 0) {
          appNavHistory.pop();
        }
        switchTab(e.state.tabId);
        if (e.state.subTabId && e.state.tabId === 'tab-invoices' && typeof switchFeeSubTab === 'function') {
          switchFeeSubTab(e.state.subTabId);
        }
        currentNavState = {
          tabId: e.state.tabId,
          subTabId: e.state.subTabId || null,
          label: NAV_FEATURE_LABELS[e.state.subTabId] || NAV_FEATURE_LABELS[e.state.tabId] || 'Dashboard'
        };
        isNavigatingHistory = false;
        updateBackBtnVisibility();
      } else if (appNavHistory.length > 0) {
        isNavigatingHistory = true;
        const prevState = appNavHistory.pop();
        if (prevState.tabId) switchTab(prevState.tabId);
        if (prevState.subTabId && prevState.tabId === 'tab-invoices' && typeof switchFeeSubTab === 'function') {
          switchFeeSubTab(prevState.subTabId);
        }
        currentNavState = {
          tabId: prevState.tabId || 'tab-dashboard',
          subTabId: prevState.subTabId || null,
          label: prevState.label || NAV_FEATURE_LABELS[prevState.subTabId] || NAV_FEATURE_LABELS[prevState.tabId] || 'Dashboard'
        };
        isNavigatingHistory = false;
        updateBackBtnVisibility();
      } else if (currentNavState.tabId !== 'tab-dashboard') {
        isNavigatingHistory = true;
        switchTab('tab-dashboard');
        currentNavState = { tabId: 'tab-dashboard', subTabId: null, label: 'Dashboard' };
        isNavigatingHistory = false;
        updateBackBtnVisibility();
      }
    });

    // Keyboard shortcut Alt + Left Arrow for desktop back, and Escape for modals
    window.addEventListener('keydown', (e) => {
      if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        navigateAppBack();
      } else if (e.key === 'Escape') {
        const visibleModal = getActiveModalOverlay();
        if (visibleModal) {
          e.preventDefault();
          if (typeof closeModal === 'function') {
            closeModal(visibleModal.id);
          } else {
            visibleModal.classList.add('hidden');
            visibleModal.classList.remove('flex');
          }
          updateBackBtnVisibility();
        }
      }
    });

    function switchTab(tabId) {
      const targetId = (tabId === 'tab-live-monitor') ? 'tab-dashboard' : tabId;

      if (!isNavigatingHistory) {
        recordNavigation(targetId, null);
      }

      // Auto-close mobile drawer when user navigates on small screens
      if (window.innerWidth < 1024) {
        const sidebar = document.getElementById('mainAppSidebar');
        const backdrop = document.getElementById('sidebarBackdrop');
        if (sidebar) sidebar.classList.remove('sidebar-mobile-open');
        if (backdrop) backdrop.classList.add('hidden');
      }

      // Reset all sidebar nav buttons
      document.querySelectorAll('.sidebar-nav-btn').forEach(btn => {
        btn.classList.remove('active', 'bg-brandDark', 'text-white', 'shadow');
        btn.classList.add('text-slate-700');
        btn.classList.remove('text-white');
      });

      // Highlight the active sidebar button using data-tab attribute
      const activeBtn = document.querySelector(`.sidebar-nav-btn[data-tab="${tabId}"]`);
      if (activeBtn) {
        activeBtn.classList.add('active', 'bg-brandDark', 'text-white', 'shadow');
        activeBtn.classList.remove('text-slate-700');
      }

      document.querySelectorAll('.tab-content').forEach(el => {
        el.classList.add('hidden');
        el.classList.remove('block');
      });

      const target = document.getElementById(targetId);
      if (target) {
        target.classList.remove('hidden');
        target.classList.add('block');
      }

      if (targetId === 'tab-dashboard') {
        if (typeof playDashboardGraphsEntranceAnimation === 'function') playDashboardGraphsEntranceAnimation();
        loadDashboardData();
      }
      if (tabId === 'tab-attendance') loadAttendanceList();
      if (tabId === 'tab-families') loadFamiliesAndStudents();
      if (tabId === 'tab-teachers') loadTeachers();
      if (tabId === 'tab-salaries') calculateMonthlySalaries();
      if (tabId === 'tab-invoices') loadFeeBillingLedger();
      if (tabId === 'tab-trials') loadTrialClassesData();
      if (tabId === 'tab-leaves') loadLeaveManagementData();
      if (tabId === 'tab-curriculum') loadCurriculumLibrary();
      if (tabId === 'tab-schedule-search') initScheduleSearch();

      // Close sidebar on mobile after navigation
      if (window.innerWidth < 1024) {
        const sidebar = document.getElementById('mainAppSidebar');
        const backdrop = document.getElementById('sidebarBackdrop');
        if (sidebar && !sidebar.classList.contains('sidebar-collapsed')) {
          sidebar.classList.add('sidebar-collapsed');
          document.getElementById('mainContentArea')?.classList.add('sidebar-collapsed');
          if (backdrop) backdrop.classList.add('hidden');
        }
      }
    }


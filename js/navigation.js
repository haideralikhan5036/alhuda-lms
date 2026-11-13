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
      'tab-families': 'Families',
      'tab-teachers': 'Employees',
      'tab-trials': 'Trials',
      'tab-attendance': 'Attendance',
      'tab-salaries': 'Salaries',
      'tab-leaves': 'Leaves',
      'tab-invoices': 'Fee Invoices',
      'tab-curriculum': 'Curriculum',
      'tab-schedule-search': 'Slot Finder',
      'tab-reports': 'Reports',
      'tab-activity': 'Audit Logs',
      'tab-teacher-portal': 'Teacher Portal',
      'tab-student-portal': 'Parent Portal',
      'tab-owner-managers': 'Managers',
      'tab-profile-360': 'Profile',
      'fee-subtab-overview': 'Fee Overview',
      'fee-subtab-collect': 'Collect Fee',
      'fee-subtab-pending': 'Pending Fees',
      'fee-subtab-defaulters': 'Defaulters',
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
      const profTab = document.getElementById('tab-profile-360');
      const isProfile360Open = profTab && !profTab.classList.contains('hidden');
      const isNotDashboard = currentNavState.tabId !== 'tab-dashboard' || isProfile360Open;
      const hasHistory = appNavHistory.length > 0 || isNotDashboard || !!visibleModal;

      if (hasHistory) {
        btn.classList.remove('hidden');
        btn.classList.add('flex');

        let prevLabel = 'Dashboard';
        if (visibleModal) {
          prevLabel = 'Close';
        } else if (isProfile360Open) {
          prevLabel = (typeof _ORIGIN_TAB_BEFORE_360 !== 'undefined' && NAV_FEATURE_LABELS[_ORIGIN_TAB_BEFORE_360])
            ? NAV_FEATURE_LABELS[_ORIGIN_TAB_BEFORE_360]
            : 'Directory';
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

      // 2. Check if mobile sidebar drawer is open
      const mobileSidebar = document.getElementById('mainAppSidebar');
      if (mobileSidebar && mobileSidebar.classList.contains('sidebar-mobile-open')) {
        mobileSidebar.classList.remove('sidebar-mobile-open');
        document.getElementById('sidebarBackdrop')?.classList.add('hidden');
        return;
      }

      // 3. Check if Full-Screen 360° Profile Workspace is open
      const profTab = document.getElementById('tab-profile-360');
      if (profTab && !profTab.classList.contains('hidden') && typeof navigateBack360Profile === 'function') {
        navigateBack360Profile();
        updateBackBtnVisibility();
        return;
      }

      // 4. Use browser history if available to keep URL state and JS state in sync
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

    // Keyboard shortcut Ctrl+K / Cmd+K for Global Search, Alt + Left Arrow for back, and Escape for modals
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const searchInput = document.getElementById('dashGlobalSearchInput');
        if (searchInput) {
          searchInput.focus();
          searchInput.select();
        }
        return;
      }
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

    // Batch 2: owner-only destinations. The app has no Settings/Backup
    // tab UI; the one owner-only area is Managers (manager accounts are
    // created and managed by the Owner only). The Worker enforces every
    // restriction server-side — this guard is defense in depth so the
    // tab cannot be opened by calling switchTab() directly or by
    // flipping the CURRENT_ROLE global in the console.
    const OWNER_ONLY_TABS = ['tab-owner-managers'];

    // Sidebar Settings group (bottom of the nav): expand/collapse the
    // sub-options. New settings screens join the group as sub-buttons.
    function toggleSettingsGroup() {
      const group = document.getElementById('sidebarSettingsGroup');
      if (!group) return;
      const nowHidden = group.classList.toggle('hidden');
      const chev = document.getElementById('sidebarSettingsChevron');
      if (chev) chev.style.transform = nowHidden ? '' : 'rotate(180deg)';
    }
    window.toggleSettingsGroup = toggleSettingsGroup;

    // Refresh restore (owner 2026-11-07): the active top-level tab is
    // mirrored into the URL hash so a browser refresh reopens the same
    // tab instead of the Dashboard. The hash is written with
    // replaceState AFTER recordNavigation's own pushState, so the
    // in-app history stack and Back behaviour stay exactly as they
    // were. Only genuine top-level tabs participate — the sidebar
    // destinations plus the tab-content sections — and the 360°
    // profile workspace is deliberately excluded: a refresh from a
    // profile returns to the last real tab, never into the profile.
    function adminTopLevelTabIds() {
      const ids = new Set();
      document.querySelectorAll('.sidebar-nav-btn[data-tab]').forEach(btn => {
        const t = btn.getAttribute('data-tab');
        if (t) ids.add(t);
      });
      document.querySelectorAll('.tab-content').forEach(el => {
        if (el.id) ids.add(el.id);
      });
      ids.delete('tab-profile-360');
      return ids;
    }
    let lastAdminTopLevelTab = null;
    function recordAdminTabInHash(tabId) {
      try {
        if (typeof window === 'undefined' || !window.history || typeof window.history.replaceState !== 'function' || !window.location) return;
        lastAdminTopLevelTab = tabId;
        window.history.replaceState(window.history.state, document.title, window.location.pathname + '#' + tabId);
      } catch (e) {}
    }
    function adminTabKeyFromHash() {
      try {
        if (typeof window === 'undefined' || !window.location) return '';
        return String(window.location.hash || '').replace(/^#/, '');
      } catch (e) { return ''; }
    }
    function restoreAdminTabFromHash() {
      const key = adminTabKeyFromHash();
      if (!key || key === 'tab-dashboard') return;
      if (!adminTopLevelTabIds().has(key)) return;
      // Respect the owner-only guard silently at boot — switchTab
      // would bounce a manager with an "Access Denied" notice, which
      // must not fire just because a stale hash survived a role change.
      if (typeof CURRENT_ROLE !== 'undefined' && CURRENT_ROLE === 'manager' && OWNER_ONLY_TABS.includes(key)) return;
      switchTab(key);
    }
    window.restoreAdminTabFromHash = restoreAdminTabFromHash;

    function switchTab(tabId) {
      if (typeof CURRENT_ROLE !== 'undefined' && CURRENT_ROLE === 'manager' && OWNER_ONLY_TABS.includes(tabId)) {
        lmsNotify('Access Denied: This area is available to the Owner only.');
        tabId = 'tab-dashboard';
      }
      const targetId = (tabId === 'tab-live-monitor') ? 'tab-dashboard' : tabId;

      const chartTooltip = document.getElementById('lmsModernChartTooltip');
      if (chartTooltip) chartTooltip.style.opacity = '0';
      const searchPanel = document.getElementById('dashGlobalSearchResultsPanel');
      if (searchPanel) searchPanel.classList.add('hidden');

      if (!isNavigatingHistory) {
        recordNavigation(targetId, null);
      }

      // Refresh restore: mirror the tab into the hash AFTER
      // recordNavigation (its pushState resets the URL to the bare
      // pathname, which would wipe a hash written any earlier). A
      // non-top-level destination (the 360° workspace) gets the last
      // real tab's hash re-asserted onto its pushed entry, so a
      // refresh from a profile returns to that tab — the hash itself
      // still never names the profile.
      if (adminTopLevelTabIds().has(targetId)) {
        recordAdminTabInHash(targetId);
      } else if (lastAdminTopLevelTab) {
        recordAdminTabInHash(lastAdminTopLevelTab);
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
      });

      // Highlight the active sidebar button using data-tab attribute
      const activeBtn = document.querySelector(`.sidebar-nav-btn[data-tab="${tabId}"]`);
      if (activeBtn) {
        activeBtn.classList.add('active');
      }

      // Settings group: if the active button lives inside the sidebar
      // Settings group, expand the group so the highlight is visible.
      const settingsGroup = document.getElementById('sidebarSettingsGroup');
      if (settingsGroup && activeBtn && settingsGroup.contains(activeBtn)) {
        settingsGroup.classList.remove('hidden');
        const chev = document.getElementById('sidebarSettingsChevron');
        if (chev) chev.style.transform = 'rotate(180deg)';
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
        if ((!DASH_STUDENT_CHART || !DASH_REVENUE_CHART) && typeof playDashboardGraphsEntranceAnimation === 'function') {
          playDashboardGraphsEntranceAnimation();
        } else {
          try { if (DASH_STUDENT_CHART) DASH_STUDENT_CHART.resize(); } catch (e) {}
          try { if (DASH_REVENUE_CHART) DASH_REVENUE_CHART.resize(); } catch (e) {}
        }
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

    // OFFLINE-COPY SELF-HEAL (2026-11-13): reload the CURRENTLY
    // ACTIVE admin tab's data — the same loader switchTab runs for
    // that tab, without any navigation side effects (no hash, no
    // sidebar moves, no tab switch). Used by the dashboard heartbeat
    // and the online/visibility/d1-live recovery in dashboard.js,
    // which used to refetch the dashboard tab only — a stale banner
    // on e.g. the Families tab healed only on the next tab switch
    // or manual refresh. Returns true when a loader ran, false
    // otherwise. The session guard lives at the call sites (same
    // hasSession check as the heartbeat); this helper never loads
    // on its own authority.
    function reloadActiveAdminTab() {
      try {
        let tabId = null;
        const activeBtn = document.querySelector('.sidebar-nav-btn.active');
        if (activeBtn && activeBtn.getAttribute('data-tab')) tabId = activeBtn.getAttribute('data-tab');
        if (!tabId) {
          const visible = document.querySelector('.tab-content:not(.hidden)');
          if (visible && visible.id) tabId = visible.id;
        }
        if (!tabId) return false;
        if (tabId === 'tab-dashboard') {
          if (typeof loadDashboardData === 'function') { loadDashboardData(); return true; }
          return false;
        }
        if (tabId === 'tab-attendance' && typeof loadAttendanceList === 'function') { loadAttendanceList(); return true; }
        if (tabId === 'tab-families' && typeof loadFamiliesAndStudents === 'function') { loadFamiliesAndStudents(); return true; }
        if (tabId === 'tab-teachers' && typeof loadTeachers === 'function') { loadTeachers(); return true; }
        if (tabId === 'tab-salaries' && typeof calculateMonthlySalaries === 'function') { calculateMonthlySalaries(); return true; }
        if (tabId === 'tab-invoices' && typeof loadFeeBillingLedger === 'function') { loadFeeBillingLedger(); return true; }
        if (tabId === 'tab-trials' && typeof loadTrialClassesData === 'function') { loadTrialClassesData(); return true; }
        if (tabId === 'tab-leaves' && typeof loadLeaveManagementData === 'function') { loadLeaveManagementData(); return true; }
        if (tabId === 'tab-curriculum' && typeof loadCurriculumLibrary === 'function') { loadCurriculumLibrary(); return true; }
        if (tabId === 'tab-schedule-search' && typeof initScheduleSearch === 'function') { initScheduleSearch(); return true; }
        return false;
      } catch (e) { return false; }
    }
    if (typeof window !== 'undefined') window.reloadActiveAdminTab = reloadActiveAdminTab;


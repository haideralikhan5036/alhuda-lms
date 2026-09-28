/**
 * ============================================================================
 * AL-HUDA ISLAMIC CENTRE LMS — MODULAR ARCHITECTURE
 * File: js/auth.js
 * Purpose: Role-Based Access Control (RBAC), Manager/Owner Security Switcher & Teacher Login
 * Extracted Line Range: 9858 – 10041 (184 lines)
 * ============================================================================
 */

    // TEACHER & MANAGER PORTAL ROLE & SESSION MANAGEMENT
    function getAuthenticatedManagerSession() {
      const activePortalRole = (localStorage.getItem('alhuda_active_portal_role') || '').toLowerCase();
      if (activePortalRole !== 'manager') return null;
      const raw = sessionStorage.getItem('alhuda_manager_session') || localStorage.getItem('alhuda_logged_in_manager');
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.id && parsed.emp_id) {
          return parsed;
        }
      } catch (e) {}
      return null;
    }

    function logoutManagerPortal() {
      localStorage.removeItem('alhuda_logged_in_manager');
      sessionStorage.removeItem('alhuda_manager_session');
      if (localStorage.getItem('alhuda_active_portal_role') === 'manager') {
        localStorage.removeItem('alhuda_active_portal_role');
      }
      ACTIVE_MANAGER_ID = null;
      window.ACTIVE_MANAGER_NAME = null;
      window.location.replace('manager.html');
    }
    window.getAuthenticatedManagerSession = getAuthenticatedManagerSession;
    window.logoutManagerPortal = logoutManagerPortal;

    function switchUserRole(role) {
      const activePortalRole = (localStorage.getItem('alhuda_active_portal_role') || '').toLowerCase();

      // Prevent role escalation if locked into a specific authenticated portal session
      if (activePortalRole === 'teacher') {
        window.location.replace('teacher.html');
        return;
      }
      if (activePortalRole === 'parent') {
        window.location.replace('parent.html');
        return;
      }
      if (activePortalRole === 'manager') {
        role = 'manager';
      }

      if (role === 'manager') {
        const mgrSession = getAuthenticatedManagerSession();
        if (!mgrSession) {
          window.location.replace('manager.html');
          return;
        }
        ACTIVE_MANAGER_ID = mgrSession.emp_id;
        window.ACTIVE_MANAGER_NAME = mgrSession.full_name || '';
      } else if (role === 'teacher') {
        window.location.replace('teacher.html');
        return;
      } else if (role === 'student' || role === 'parent') {
        window.location.replace('parent.html');
        return;
      }

      CURRENT_ROLE = role;

      const sessionPill = document.getElementById('teacherSessionPill');
      if (sessionPill) {
        sessionPill.classList.add('hidden');
        sessionPill.classList.remove('flex');
      }

      // Owner and Manager get access to ALL tabs and features
      const canAccessAllTabs = (role === 'owner' || role === 'manager');
      document.querySelectorAll('.role-owner, .role-admin').forEach(el => {
        el.style.display = canAccessAllTabs ? 'flex' : 'none';
      });

      // Synchronize role selector dropdown
      const rSel = document.getElementById('userRoleSelect');
      if (rSel && rSel.value !== role) rSel.value = role;

      // Update Header Indicator / Badge
      updateRoleHeaderBadge(role);

      // Re-render UI components to reflect role permissions (deletion buttons & masked student contacts)
      if (typeof renderFamiliesCards === 'function') renderFamiliesCards();
      if (typeof renderFamiliesMasterTable === 'function') renderFamiliesMasterTable();
      if (typeof renderAllStudentsListTable === 'function') renderAllStudentsListTable();
      if (typeof renderTrialCards === 'function' && typeof CURRENT_TRIAL_FILTER !== 'undefined') renderTrialCards(CURRENT_TRIAL_FILTER);
      if (typeof loadTeachers === 'function' && ALL_TEACHERS.length > 0) loadTeachers();
    }

    function updateRoleHeaderBadge(role) {
      let badge = document.getElementById('headerRoleSecurityBadge');
      if (!badge) {
        const container = document.getElementById('userRoleSelect')?.parentElement;
        if (container) {
          badge = document.createElement('div');
          badge.id = 'headerRoleSecurityBadge';
          container.parentElement.insertBefore(badge, container.nextSibling);
        }
      }
      if (!badge) return;

      if (role === 'manager') {
        const mgrSession = getAuthenticatedManagerSession();
        const mgrId = mgrSession?.emp_id || ACTIVE_MANAGER_ID || 'Manager';
        const mgrName = mgrSession?.full_name ? ` &bull; ${mgrSession.full_name}` : '';
        badge.className = 'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-indigo-950/80 border border-indigo-400/50 text-indigo-200 shadow-2xs whitespace-nowrap shrink-0';
        badge.innerHTML = `<i class="fa-solid fa-user-shield text-amber-400"></i> <span>${mgrId}${mgrName}</span> <button onclick="logoutManagerPortal()" class="ml-1.5 px-2 py-0.5 rounded-full bg-rose-600/80 hover:bg-rose-700 text-[10px] text-white font-extrabold transition cursor-pointer" title="Logout Manager"><i class="fa-solid fa-power-off"></i> Logout</button>`;
      } else if (role === 'owner') {
        badge.className = 'hidden xl:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-950/60 border border-amber-400/50 text-amber-200 shadow-2xs whitespace-nowrap shrink-0';
        badge.innerHTML = `<i class="fa-solid fa-crown text-brandGold"></i> <span>Owner &amp; Director</span>`;
      } else {
        badge.className = 'hidden';
      }
    }

    function initRoleFromUrl() {
      const params = new URLSearchParams(window.location.search);
      const urlRole = (params.get('role') || '').toLowerCase();
      const mgrParam = params.get('m') || params.get('mgr') || params.get('id');
      const activePortalRole = (localStorage.getItem('alhuda_active_portal_role') || '').toLowerCase();

      if (activePortalRole === 'teacher' || urlRole === 'teacher') {
        window.location.replace('teacher.html');
        return;
      }

      if (activePortalRole === 'parent' || urlRole === 'student' || urlRole === 'parent') {
        window.location.replace('parent.html');
        return;
      }

      if (urlRole === 'manager' || mgrParam || activePortalRole === 'manager') {
        const mgrSession = getAuthenticatedManagerSession();
        if (!mgrSession) {
          window.location.replace('manager.html');
          return;
        }
        // Authoritative identity comes ONLY from the authenticated Manager session, never from ?m=... URL parameters
        ACTIVE_MANAGER_ID = mgrSession.emp_id;
        window.ACTIVE_MANAGER_NAME = mgrSession.full_name || '';
        if (mgrParam) {
          try {
            window.history.replaceState({}, document.title, window.location.pathname + '?role=manager');
          } catch (e) {}
        }
        switchUserRole('manager');
        return;
      }

      switchUserRole('owner');
    }

    function openTeacherLoginModal() {
      const err = document.getElementById('teacherLoginError');
      if (err) err.classList.add('hidden');
      const quickList = document.getElementById('quickTeacherLoginsList');
      if (quickList) quickList.innerHTML = '';
      openModal('modalTeacherLogin');
    }

    function fillTeacherLogin(user, pass) {
      document.getElementById('tLoginUser').value = user;
      document.getElementById('tLoginPass').value = pass;
    }

    function handleTeacherLoginSubmit(e) {
      e.preventDefault();
      const user = document.getElementById('tLoginUser').value.trim();
      const pass = document.getElementById('tLoginPass').value.trim();
      const err = document.getElementById('teacherLoginError');

      const eligibleTeachers = (typeof getEligibleTeachers === 'function')
        ? getEligibleTeachers(ALL_TEACHERS)
        : (ALL_TEACHERS || []);

      let matchedTeacher = null;
      for (let t of eligibleTeachers) {
        const creds = getTeacherCreds(t);
        if (
          (creds.username.toLowerCase() === user.toLowerCase() || creds.teacher_id.toLowerCase() === user.toLowerCase() || (t.phone && t.phone === user)) &&
          (creds.password === pass)
        ) {
          matchedTeacher = t;
          break;
        }
      }

      if (matchedTeacher) {
        localStorage.setItem('alhuda_logged_in_teacher', JSON.stringify(matchedTeacher));
        sessionStorage.setItem('alhuda_teacher_session', JSON.stringify(matchedTeacher));
        localStorage.setItem('alhuda_active_portal_role', 'teacher');
        closeModal('modalTeacherLogin');
        window.location.replace('teacher.html');
      } else {
        if (err) {
          err.innerText = "Invalid username or password.";
          err.classList.remove('hidden');
        }
      }
    }

    function setTeacherSessionActive(teacher) {
      const sessionPill = document.getElementById('teacherSessionPill');
      if (sessionPill) {
        sessionPill.classList.remove('hidden');
        sessionPill.classList.add('flex');
        document.getElementById('teacherActiveName').innerText = teacher.full_name;
      }
      const roleSelect = document.getElementById('userRoleSelect');
      if (roleSelect) roleSelect.value = 'teacher';
    }

    function logoutTeacherPortal() {
      localStorage.removeItem('alhuda_logged_in_teacher');
      localStorage.removeItem('bqi_logged_in_teacher');
      sessionStorage.removeItem('alhuda_teacher_session');
      if (localStorage.getItem('alhuda_active_portal_role') === 'teacher') {
        localStorage.removeItem('alhuda_active_portal_role');
      }
      window.location.replace('teacher.html');
    }

    function loginDirectAsTeacher() {
      window.open('teacher.html', '_blank');
    }


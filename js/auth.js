/**
 * ============================================================================
 * AL-HUDA ISLAMIC CENTRE LMS — MODULAR ARCHITECTURE
 * File: js/auth.js
 * Purpose: Role-Based Access Control (RBAC), Manager/Owner Security Switcher & Teacher Login
 * Extracted Line Range: 9858 â 10041 (184 lines)
 * ============================================================================
 */

    // ============================================================
    // OWNER / ADMIN PORTAL ROLE & SESSION MANAGEMENT
    // SECURITY (2026-10-14): Owner authentication is verified SERVER-SIDE by
    // the Cloudflare Worker (POST /api/auth/login). The browser only holds a
    // signed, expiring session token in sessionStorage. There are NO
    // hardcoded credentials in this file anymore, and no client-side session
    // can be forged from DevTools. The worker is the real enforcer: every
    // /api/db and /api/storage call re-validates the token server-side.
    // If the worker is not deployed / not configured, owner login FAILS
    // CLOSED with an explanatory message (see SECURITY-SETUP.md).
    // ============================================================

    function getWorkerBase() {
      try {
        if (window.CLOUDFLARE_API_BASE_URL) {
          return String(window.CLOUDFLARE_API_BASE_URL).replace(/\/+$/, '');
        }
        if (window.location && window.location.hostname.endsWith('.workers.dev')) {
          return '';
        }
      } catch (e) {}
      return 'https://alhuda-lms.ceoislamiccentre.workers.dev';
    }

    // Batch 7A: server-side logout. Best-effort with a 5-second cap: a
    // reachable server revokes the token, but a failed call never blocks
    // the local logout — the caller tells the user the server session
    // may last until it expires. Returns true when the server confirmed.
    async function callServerLogout(token) {
      if (!token) return false;
      try {
        const controller = new AbortController();
        const timer = setTimeout(function () { controller.abort(); }, 5000);
        const res = await fetch(getWorkerBase() + '/api/auth/logout', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + token },
          signal: controller.signal,
        });
        clearTimeout(timer);
        return !!res.ok;
      } catch (e) { return false; }
    }

    function getOwnerToken() {
      try {
        return sessionStorage.getItem('alhuda_owner_token') || null;
      } catch (e) {
        return null;
      }
    }

    // ============================================================
    // AUTH HARDENING (Batch 1, 2026-10-21): account passwords live ONLY as
    // salted hashes written by the owner-only Worker endpoint
    // POST /api/auth/set-password. Frontend code must never embed a
    // password in teachers.address / families.notes JSON, in a
    // localStorage account map, or in the shared-state blob. UI save flows
    // call this helper AFTER the record itself has been saved.
    // Resolves { ok: true } on success; throws Error with a readable
    // message otherwise (the caller must surface it to the owner).
    // ============================================================
    async function setAccountPasswordViaWorker(role, identifier, newPassword) {
      const pw = String(newPassword || '');
      if (pw.length < 10) {
        throw new Error('Password must be at least 10 characters long.');
      }
      let token = null;
      try {
        if (typeof window.getLmsAuthToken === 'function') token = window.getLmsAuthToken();
      } catch (e) {}
      if (!token) token = getOwnerToken();
      // Batch 2: a signed-in MANAGER may also set/reset TEACHER and
      // PARENT passwords through this helper (never manager/owner
      // passwords — the Worker authorises the caller's role server-side
      // and denies anything beyond it). Fall back to the manager token.
      if (!token) {
        try { token = sessionStorage.getItem('alhuda_manager_token') || null; } catch (e) {}
      }
      if (!token) {
        throw new Error('Owner session not found. Please log in as the owner and try again.');
      }
      let res;
      try {
        res = await fetch(getWorkerBase() + '/api/auth/set-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify({ role: role, identifier: identifier, newPassword: pw })
        });
      } catch (err) {
        throw new Error('Cannot reach the server. The password was NOT set.');
      }
      let data = null;
      try { data = await res.json(); } catch (e) {}
      if (!res.ok || !data || data.ok === false) {
        throw new Error((data && (data.error || data.message)) || ('Password service error (HTTP ' + res.status + ').'));
      }
      return { ok: true };
    }
    window.setAccountPasswordViaWorker = setAccountPasswordViaWorker;

    // ============================================================
    // Batch 2: SHOW-ONCE password display. After a password is set or
    // reset, the new password may be shown exactly ONCE on screen (with
    // a Copy button) so it can be handed to the person. It is NEVER
    // written to localStorage/sessionStorage or the console, and
    // closing the modal wipes the field and removes the whole overlay
    // from the DOM, so it cannot be seen again.
    // ============================================================
    function showPasswordOnce(opts) {
      const o = opts || {};
      const label = String(o.label || 'Portal password');
      const username = String(o.username || '');
      const password = String(o.password || '');
      const prev = document.getElementById('lmsShowPasswordOnceOverlay');
      if (prev) prev.remove();
      const overlay = document.createElement('div');
      overlay.id = 'lmsShowPasswordOnceOverlay';
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(2,32,22,0.72);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;';
      overlay.innerHTML = `
        <div class="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden">
          <div class="px-5 py-4 bg-gradient-to-r from-[#022c22] to-[#064e3b] text-white">
            <h3 class="font-extrabold text-sm flex items-center gap-2"><i class="fa-solid fa-key text-amber-300"></i> Password set — shown only once</h3>
            <p class="text-[11px] text-emerald-100/80 mt-0.5">${label}</p>
          </div>
          <div class="p-5 space-y-3 text-xs">
            <div>
              <span class="text-slate-400 text-[10px] font-bold uppercase tracking-wide block">Username</span>
              <strong class="text-slate-900 font-mono text-sm" id="lmsShowOnceUser"></strong>
            </div>
            <div>
              <span class="text-slate-400 text-[10px] font-bold uppercase tracking-wide block">New Password</span>
              <div class="flex items-center gap-2 mt-1">
                <input id="lmsShowOncePass" type="text" readonly class="flex-1 p-2.5 bg-slate-50 border border-slate-300 rounded-lg font-mono font-bold text-slate-900 text-sm">
                <button type="button" id="lmsShowOnceCopy" class="px-3 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-extrabold text-xs transition flex items-center gap-1.5"><i class="fa-regular fa-copy"></i> Copy</button>
              </div>
            </div>
            <p class="text-slate-500 leading-relaxed">Give this password to them in person or by phone. It will not be shown again.</p>
            <button type="button" id="lmsShowOnceClose" class="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-extrabold text-xs transition">Done — Close</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      // Values are set via DOM properties, never interpolated into HTML.
      const userEl = overlay.querySelector('#lmsShowOnceUser');
      if (userEl) userEl.textContent = username;
      const passEl = overlay.querySelector('#lmsShowOncePass');
      if (passEl) passEl.value = password;
      function closeOnce() {
        if (passEl) passEl.value = '';
        overlay.remove();
      }
      const copyBtn = overlay.querySelector('#lmsShowOnceCopy');
      if (copyBtn) copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(password);
          copyBtn.innerHTML = '<i class="fa-solid fa-check"></i> Copied';
        } catch (e) {
          if (passEl) { passEl.focus(); passEl.select(); }
          if (typeof window.LmsNotify !== 'undefined' && window.LmsNotify.dialog) { window.LmsNotify.dialog({ title: 'Copy this password now', message: 'It will not be shown again:\n\n' + password, confirmText: 'Done' }); }
        }
      });
      const closeBtn = overlay.querySelector('#lmsShowOnceClose');
      if (closeBtn) closeBtn.addEventListener('click', closeOnce);
      overlay.addEventListener('click', (ev) => { if (ev.target === overlay) closeOnce(); });
    }
    window.showPasswordOnce = showPasswordOnce;

    function decodeTokenPayload(token) {
      try {
        const parts = String(token).split('.');
        if (parts.length !== 2 || !parts[0]) return null;
        let b64 = parts[0].replace(/-/g, '+').replace(/_/g, '/');
        const pad = b64.length % 4;
        if (pad) b64 += '='.repeat(4 - pad);
        return JSON.parse(atob(b64));
      } catch (e) {
        return null;
      }
    }

    function getAuthenticatedOwnerSession() {
      // Remove legacy forgeable session keys once (they must never be trusted again).
      try {
        localStorage.removeItem('alhuda_logged_in_owner');
        localStorage.removeItem('alhuda_admin_account');
      } catch (e) {}
      const token = getOwnerToken();
      if (!token) return null;
      const payload = decodeTokenPayload(token);
      if (!payload || payload.role !== 'owner') return null;
      if (typeof payload.exp !== 'number' || Date.now() / 1000 >= payload.exp) {
        try { sessionStorage.removeItem('alhuda_owner_token'); } catch (e) {}
        return null;
      }
      // NOTE: expiry/role here is UX-only. The worker re-verifies the token
      // signature on every privileged API call.
      return { id: 'OWN-001', username: payload.sub, full_name: 'Owner', role: 'owner', token };
    }

    function showOwnerLoginView() {
      const loginView = document.getElementById('ownerLoginView');
      const mainApp = document.getElementById('mainAppWrapper');
      if (loginView) {
        loginView.classList.remove('hidden');
        loginView.classList.add('flex');
      }
      if (mainApp) {
        mainApp.classList.add('hidden');
        mainApp.classList.remove('flex');
      }
    }

    function showMainAppView() {
      const loginView = document.getElementById('ownerLoginView');
      const mainApp = document.getElementById('mainAppWrapper');
      if (loginView) {
        loginView.classList.add('hidden');
        loginView.classList.remove('flex');
      }
      if (mainApp) {
        mainApp.classList.remove('hidden');
        mainApp.classList.add('flex');
      }
    }

    function toggleOwnerPassVisibility() {
      const p = document.getElementById('ownerLoginPassword');
      const icon = document.getElementById('ownerPassToggleIcon');
      if (!p) return;
      if (p.type === 'password') {
        p.type = 'text';
        if (icon) icon.className = 'fa-regular fa-eye-slash';
      } else {
        p.type = 'password';
        if (icon) icon.className = 'fa-regular fa-eye';
      }
    }

    async function handleOwnerSignIn(e) {
      if (e && e.preventDefault) e.preventDefault();
      const user = (document.getElementById('ownerLoginUsername')?.value || '').trim();
      const pass = (document.getElementById('ownerLoginPassword')?.value || '').trim();
      const errBox = document.getElementById('ownerLoginErrorMsg');
      const errText = document.getElementById('ownerLoginErrorText');

      if (errBox) errBox.classList.add('hidden');

      function showError(msg) {
        if (errBox && errText) {
          errText.innerText = msg;
          errBox.classList.remove('hidden');
        }
      }

      if (!user || !pass) {
        showError('Please enter both username and password.');
        return;
      }

      // Server-side verification. NEVER check credentials in the browser.
      let result;
      try {
        const res = await fetch(getWorkerBase() + '/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: user, password: pass })
        });
        if (res.status === 404 || res.status === 503) {
          showError('Authentication server is not available. Please deploy the Cloudflare Worker first (see SECURITY-SETUP.md).');
          return;
        }
        result = await res.json();
      } catch (err) {
        showError('Authentication server is not available. Please deploy the Cloudflare Worker first (see SECURITY-SETUP.md).');
        return;
      }

      if (result && result.ok && result.token) {
        try {
          // Use the resilient setter (memory + sessionStorage) so the book
          // reader can always access the token, even if storage is blocked.
          if (typeof window.setLmsAuthToken === 'function') {
            window.setLmsAuthToken(result.token);
          } else {
            sessionStorage.setItem('alhuda_owner_token', result.token);
          }
        } catch (err) {}
        // Fresh token: forget any pre-login "D1 unavailable" probe result
        // so the next data call re-checks D1 WITH this token.
        try {
          if (typeof window.resetCloudflareD1Availability === 'function') {
            window.resetCloudflareD1Availability();
          }
        } catch (err) {}
        try {
          localStorage.setItem('alhuda_active_portal_role', 'owner');
        } catch (err) {}

        showMainAppView();
        switchUserRole('owner');

        if (typeof ensureCoreLmsDataLoaded === 'function') {
          ensureCoreLmsDataLoaded().then(() => {
            if (typeof loadDashboardData === 'function') loadDashboardData();
          });
        }
      } else {
        showError('Invalid username or password.');
      }
    }

    async function logoutOwnerPortal() {
      let ownerToken = null;
      try { ownerToken = sessionStorage.getItem('alhuda_owner_token'); } catch (e) {}
      const serverOk = await callServerLogout(ownerToken);
      try {
        sessionStorage.removeItem('alhuda_owner_token');
        sessionStorage.removeItem('alhuda_owner_session');
        localStorage.removeItem('alhuda_logged_in_owner');
        localStorage.removeItem('alhuda_admin_account');
        if (localStorage.getItem('alhuda_active_portal_role') === 'owner') {
          localStorage.removeItem('alhuda_active_portal_role');
        }
        // AUTH HARDENING (S5): also wipe the local DB mirror and every
        // account/session key, so no dataset or credential material
        // lingers in this browser after logout. Data caches that may hold
        // the only copy of a record (fees, salaries, books) are NOT ours
        // to clear here — clearAllLmsLocalState preserves them by design.
        if (typeof window.clearAllLmsLocalState === 'function') {
          window.clearAllLmsLocalState();
        } else {
          localStorage.removeItem('alhuda_cloudflare_local_db_v1');
        }
      } catch (e) {}
      showOwnerLoginView();
      const userInp = document.getElementById('ownerLoginUsername');
      const passInp = document.getElementById('ownerLoginPassword');
      if (userInp) userInp.value = '';
      if (passInp) passInp.value = '';
      // Batch 7A, truthful logout: local state is wiped either way, but
      // if the server call failed the token may live until its expiry.
      if (ownerToken && !serverOk) {
        if (typeof showError === 'function') showError('Signed out on this device. Your server session may remain valid until it expires.');
        else lmsNotify('Signed out on this device. Your server session may remain valid until it expires.');
      }
    }

    window.getAuthenticatedOwnerSession = getAuthenticatedOwnerSession;
    window.showOwnerLoginView = showOwnerLoginView;
    window.showMainAppView = showMainAppView;
    window.toggleOwnerPassVisibility = toggleOwnerPassVisibility;
    window.handleOwnerSignIn = handleOwnerSignIn;
    window.logoutOwnerPortal = logoutOwnerPortal;

    // TEACHER & MANAGER PORTAL ROLE & SESSION MANAGEMENT
    function getAuthenticatedManagerSession() {
      // Per-tab session only (sessionStorage): a new tab must never inherit
      // another tab's manager session via shared localStorage.
      const raw = sessionStorage.getItem('alhuda_manager_session');
      if (!raw) return null;
      let parsed = null;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {}
      if (!parsed || !parsed.id || !parsed.emp_id) return null;
      // Batch 7 (F3.7): the session object alone is NOT enough — the
      // manager TOKEN must also be present, carry the manager role, and
      // be unexpired (the same check the owner gate above and the
      // manager.html restore already apply). Without it, an expired or
      // cleared token left the portal sitting on stale local-mirror data
      // with no route back to the login.
      let token = null;
      try {
        token = sessionStorage.getItem('alhuda_manager_token') || null;
      } catch (e) {}
      if (!token) return null;
      const payload = decodeTokenPayload(token);
      if (!payload || payload.role !== 'manager') return null;
      if (typeof payload.exp !== 'number' || Date.now() / 1000 >= payload.exp) return null;
      return parsed;
    }

    async function logoutManagerPortal() {
      let managerToken = null;
      try { managerToken = sessionStorage.getItem('alhuda_manager_token'); } catch (e) {}
      const serverOk = await callServerLogout(managerToken);
      localStorage.removeItem('alhuda_logged_in_manager');
      sessionStorage.removeItem('alhuda_manager_session');
      if (localStorage.getItem('alhuda_active_portal_role') === 'manager') {
        localStorage.removeItem('alhuda_active_portal_role');
      }
      // AUTH HARDENING (S5): also wipe the local DB mirror and every
      // account/session key (see logoutOwnerPortal).
      try {
        if (typeof window.clearAllLmsLocalState === 'function') {
          window.clearAllLmsLocalState();
        } else {
          localStorage.removeItem('alhuda_cloudflare_local_db_v1');
        }
      } catch (e) {}
      ACTIVE_MANAGER_ID = null;
      window.ACTIVE_MANAGER_NAME = null;
      if (managerToken && !serverOk) lmsNotify('Signed out on this device. Your server session may remain valid until it expires.');
      window.location.replace('manager.html');
    }
    window.getAuthenticatedManagerSession = getAuthenticatedManagerSession;
    window.logoutManagerPortal = logoutManagerPortal;

    function switchUserRole(role) {
      if (role === 'manager') {
        const mgrSession = getAuthenticatedManagerSession();
        if (!mgrSession) {
          window.location.replace('manager.html');
          return;
        }
        ACTIVE_MANAGER_ID = mgrSession.emp_id;
        window.ACTIVE_MANAGER_NAME = mgrSession.full_name || '';
        localStorage.setItem('alhuda_active_portal_role', 'manager');
      } else if (role === 'teacher') {
        window.location.replace('teacher.html');
        return;
      } else if (role === 'student' || role === 'parent') {
        window.location.replace('parent.html');
        return;
      } else {
        // SECURITY: the owner role now REQUIRES a valid worker-issued token.
        // There is no unauthenticated path to owner privileges anymore.
        const ownerSession = getAuthenticatedOwnerSession();
        if (!ownerSession) {
          showOwnerLoginView();
          return;
        }
        localStorage.setItem('alhuda_active_portal_role', 'owner');
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
        badge.className = 'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-950/60 border border-amber-400/50 text-amber-200 shadow-2xs whitespace-nowrap shrink-0';
        badge.innerHTML = `<i class="fa-solid fa-crown text-brandGold"></i> <span>Owner &amp; Director</span> <button onclick="logoutOwnerPortal()" class="ml-1.5 px-2 py-0.5 rounded-full bg-rose-600/80 hover:bg-rose-700 text-[10px] text-white font-extrabold transition cursor-pointer" title="Logout Owner"><i class="fa-solid fa-power-off"></i> Logout</button>`;
      } else {
        badge.className = 'hidden';
      }
    }

    function initRoleFromUrl() {
      const params = new URLSearchParams(window.location.search);
      const urlRole = (params.get('role') || '').toLowerCase();
      const mgrParam = params.get('m') || params.get('mgr') || params.get('id');

      // 1. Explicit Teacher & Parent/Student Redirects
      if (urlRole === 'teacher') {
        window.location.replace('teacher.html');
        return false;
      }

      if (urlRole === 'student' || urlRole === 'parent') {
        window.location.replace('parent.html');
        return false;
      }

      // 2. Manager Role: requires authenticated manager session
      if (urlRole === 'manager' || mgrParam) {
        const mgrSession = getAuthenticatedManagerSession();
        if (!mgrSession) {
          window.location.replace('manager.html');
          return false;
        }
        ACTIVE_MANAGER_ID = mgrSession.emp_id;
        window.ACTIVE_MANAGER_NAME = mgrSession.full_name || '';
        if (mgrParam) {
          try {
            window.history.replaceState({}, document.title, window.location.pathname + '?role=manager');
          } catch (e) {}
        }
        showMainAppView();
        switchUserRole('manager');
        return true;
      }

      // 3. Default Owner / Admin Route (index.html, /admin, /)
      const ownerSession = getAuthenticatedOwnerSession();
      if (!ownerSession) {
        showOwnerLoginView();
        return false;
      }

      showMainAppView();
      switchUserRole('owner');
      return true;
    }

    function openTeacherLoginModal() {
      const err = document.getElementById('teacherLoginError');
      if (err) err.classList.add('hidden');
      const quickList = document.getElementById('quickTeacherLoginsList');
      if (quickList) quickList.innerHTML = '';
      openModal('modalTeacherLogin');
    }

    function fillTeacherLogin(user) {
      // AUTH HARDENING (Batch 1): quick entries may fill the USERNAME only.
      // Nothing in this portal may fill or display a password anymore, and
      // the quick-logins list is intentionally kept empty (see
      // openTeacherLoginModal) because it existed only to share credentials.
      document.getElementById('tLoginUser').value = user || '';
      const passEl = document.getElementById('tLoginPass');
      if (passEl) passEl.value = '';
    }

    async function handleTeacherLoginSubmit(e) {
      e.preventDefault();
      const user = document.getElementById('tLoginUser').value.trim();
      const pass = document.getElementById('tLoginPass').value.trim();
      const err = document.getElementById('teacherLoginError');

      function showErr(msg) {
        if (err) {
          err.innerText = msg;
          err.classList.remove('hidden');
        }
      }
      if (err) err.classList.add('hidden');

      if (!user || !pass) {
        showErr('Please enter both username and password.');
        return;
      }

      // AUTH HARDENING (Batch 1): server-side verification ONLY. The old
      // in-browser plaintext comparison against locally mirrored records
      // (which accepted the well-known default password) is removed. If the
      // Worker cannot be reached, login fails closed with a clear message.
      let res;
      let data = null;
      try {
        res = await fetch(getWorkerBase() + '/api/auth/staff-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'teacher', identifier: user, password: pass })
        });
        try { data = await res.json(); } catch (e2) {}
      } catch (netErr) {
        showErr('Cannot reach the server. Please try again.');
        return;
      }

      if (res.ok && data && data.ok && data.token) {
        try {
          sessionStorage.setItem('alhuda_teacher_token', data.token);
          sessionStorage.setItem('alhuda_teacher_session', JSON.stringify({ id: data.id }));
          localStorage.setItem('alhuda_active_portal_role', 'teacher');
        } catch (e3) {}
        closeModal('modalTeacherLogin');
        window.location.replace('teacher.html');
        return;
      }

      if (res.status === 401 && data && data.error === 'account_deactivated') {
        showErr('This account is deactivated. Please contact the administrator.');
        return;
      }
      if (res.status === 401 && data && data.error === 'no_password_set') {
        showErr('No password set. Ask the administrator to set one.');
        return;
      }
      if (res.status === 401) {
        showErr('Invalid username or password.');
        return;
      }
      showErr('Cannot reach the server. Please try again.');
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

    async function logoutTeacherPortal() {
      let teacherToken = null;
      try { teacherToken = sessionStorage.getItem('alhuda_teacher_token'); } catch (e) {}
      const serverOk = await callServerLogout(teacherToken);
      localStorage.removeItem('alhuda_logged_in_teacher');
      sessionStorage.removeItem('alhuda_teacher_session');
      if (localStorage.getItem('alhuda_active_portal_role') === 'teacher') {
        localStorage.removeItem('alhuda_active_portal_role');
      }
      // Batch 7A: wipe the local DB mirror and every account/session key
      // like every other portal logout does (this function previously
      // skipped that step).
      try {
        if (typeof window.clearAllLmsLocalState === 'function') {
          window.clearAllLmsLocalState();
        } else {
          localStorage.removeItem('alhuda_cloudflare_local_db_v1');
        }
      } catch (e) {}
      if (teacherToken && !serverOk) lmsNotify('Signed out on this device. Your server session may remain valid until it expires.');
      window.location.replace('teacher.html');
    }

    function loginDirectAsTeacher() {
      window.open('teacher.html', '_blank');
    }


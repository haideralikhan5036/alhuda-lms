/**
 * ============================================================================
 * AL-HUDA ISLAMIC CENTRE LMS — UNIVERSAL CLOUDFLARE D1 & R2 CLIENT ENGINE
 * File: js/cloudflare-db.js
 * Purpose: Drop-in replacement for window.supabase.createClient that connects
 *          all 4 portals (Admin, Manager, Teacher, Parent) to Cloudflare D1
 *          (/api/db) and Cloudflare R2 (/api/storage), with automatic local
 *          persistence and one-time auto-migration into Cloudflare D1.
 * ============================================================================
 */

(function () {
  const LOCAL_DB_STORAGE_KEY = 'alhuda_cloudflare_local_db_v1';
  const LEGACY_CORE_CACHE_KEY = 'alhuda_lms_core_cache_v2';
  const D1_MIGRATED_FLAG_KEY = 'alhuda_d1_initial_sync_done_v1';

  const TABLES = [
    'families',
    'students',
    'teachers',
    'class_schedules',
    'attendance_logs',
    'payments',
    'salary_slips',
    'salary_adjustments',
    'leave_requests',
    'trial_students',
    'system_settings'
  ];

  const DEFAULT_CLOUDFLARE_BACKEND_URL = 'https://alhuda-lms.ceoislamiccentre.workers.dev';

  let _d1Status = null; // null = unknown, true = Cloudflare D1 live, false = Local mirror mode
  let _d1CheckPromise = null;

  function getApiBase() {
    if (window.CLOUDFLARE_API_BASE_URL) {
      return String(window.CLOUDFLARE_API_BASE_URL).replace(/\/+$/, '');
    }
    if (typeof window !== 'undefined' && window.location && window.location.hostname.endsWith('.workers.dev')) {
      return '';
    }
    return DEFAULT_CLOUDFLARE_BACKEND_URL;
  }

  // SECURITY (2026-10-14): the worker now requires a signed session token
  // for /api/db and /api/storage. Portal login handlers store the token in
  // sessionStorage after a successful server-side login; every API call
  // below attaches it. No token (or an expired one) -> the worker answers
  // 401 and the wrapper safely falls back to the local mirror.
  //
  // RESILIENCE (2026-10-15): some browsers block sessionStorage (privacy
  // mode, extensions, cookie blocking). Keep an in-memory cache as well,
  // so the token survives even when storage is unavailable.
  let _memoryTokenCache = null;
  function getWorkerToken() {
    if (_memoryTokenCache) return _memoryTokenCache;
    try {
      return sessionStorage.getItem('alhuda_owner_token')
        || sessionStorage.getItem('alhuda_manager_token')
        || sessionStorage.getItem('alhuda_teacher_token')
        || sessionStorage.getItem('alhuda_parent_token')
        || null;
    } catch (e) {
      return null;
    }
  }

  // Saves the token to memory AND sessionStorage (best effort).
  // Call this after login instead of writing sessionStorage directly.
  function setWorkerToken(token) {
    _memoryTokenCache = token || null;
    try {
      if (token) sessionStorage.setItem('alhuda_owner_token', token);
      else sessionStorage.removeItem('alhuda_owner_token');
    } catch (e) {}
  }

  function authHeaders() {
    const t = getWorkerToken();
    return t ? { 'Authorization': 'Bearer ' + t } : {};
  }

  function clearWorkerTokens() {
    // PR #11 follow-up (Batch 1): the in-memory token cache must be
    // dropped too, or a dead token keeps being offered until reload.
    _memoryTokenCache = null;
    try {
      ['alhuda_owner_token', 'alhuda_manager_token', 'alhuda_teacher_token', 'alhuda_parent_token']
        .forEach(function (k) { sessionStorage.removeItem(k); });
    } catch (e) {}
  }

  function generateLocalId(table) {
    const prefixMap = {
      families: 'FAM-',
      students: 'STU-',
      teachers: 'TCH-',
      class_schedules: 'SCH-',
      attendance_logs: 'ATT-',
      payments: 'PAY-',
      salary_slips: 'SAL-',
      salary_adjustments: 'ADJ-',
      leave_requests: 'LVR-',
      trial_students: 'TRL-',
      system_settings: 'SYS-'
    };
    const prefix = prefixMap[table] || 'ID-';
    return prefix + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
  }

  function loadLocalDbStore() {
    let store = null;
    try {
      const raw = localStorage.getItem(LOCAL_DB_STORAGE_KEY);
      if (raw) store = JSON.parse(raw);
    } catch (e) {
      store = null;
    }

    if (!store || typeof store !== 'object') {
      store = {};
    }

    TABLES.forEach(t => {
      if (!Array.isArray(store[t])) store[t] = [];
    });

    // Hydrate from legacy cache if local store is empty
    try {
      const legacyRaw = localStorage.getItem(LEGACY_CORE_CACHE_KEY);
      if (legacyRaw) {
        const legacy = JSON.parse(legacyRaw);
        if (store.families.length === 0 && Array.isArray(legacy.families) && legacy.families.length > 0) {
          store.families = legacy.families.map(f => {
            const copy = { ...f };
            delete copy.students;
            return copy;
          });
        }
        if (store.students.length === 0 && Array.isArray(legacy.students) && legacy.students.length > 0) {
          store.students = legacy.students;
        }
        if (store.teachers.length === 0 && Array.isArray(legacy.teachers) && legacy.teachers.length > 0) {
          store.teachers = legacy.teachers;
        }
        if (store.class_schedules.length === 0 && Array.isArray(legacy.schedules) && legacy.schedules.length > 0) {
          store.class_schedules = legacy.schedules;
        }
      }
    } catch (e) {}

    return store;
  }

  function saveLocalDbStore(store) {
    try {
      localStorage.setItem(LOCAL_DB_STORAGE_KEY, JSON.stringify(store));
    } catch (e) {
      console.warn('[Cloudflare DB] Local mirror save notice:', e);
    }
  }

  function matchFilter(row, f) {
    let val = row ? row[f.column] : undefined;
    if (val === undefined && f.column === 'date') val = row ? row.class_date : undefined;
    if (val === undefined && f.column === 'class_date') val = row ? row.date : undefined;
    if (val === undefined && f.column === 'lesson_notes') val = row ? row.remarks : undefined;
    if (val === undefined && f.column === 'remarks') val = row ? row.lesson_notes : undefined;
    const target = f.value;
    const op = f.op;

    if (op === 'eq') {
      if (target === null) return val === null || val === undefined;
      return String(val ?? '') === String(target ?? '');
    }
    if (op === 'neq') {
      if (target === null) return val !== null && val !== undefined;
      return String(val ?? '') !== String(target ?? '');
    }
    if (op === 'gt') return val > target;
    if (op === 'gte') return val >= target;
    if (op === 'lt') return val < target;
    if (op === 'lte') return val <= target;
    if (op === 'in' && Array.isArray(target)) {
      const strSet = new Set(target.map(x => String(x)));
      return strSet.has(String(val ?? ''));
    }
    if (op === 'like' || op === 'ilike') {
      const pattern = String(target || '').toLowerCase().replace(/%/g, '.*');
      return new RegExp(`^${pattern}$`, 'i').test(String(val || ''));
    }
    return true;
  }

  function hydrateLocalJoins(store, table, rows, selectStr = '*') {
    const sel = String(selectStr || '*');
    const cloned = rows.map(r => ({ ...r }));

    if (table === 'families' && /students\s*\(/i.test(sel)) {
      const stuByFam = new Map();
      (store.students || []).forEach(s => {
        const fId = String(s.family_id || '');
        if (!stuByFam.has(fId)) stuByFam.set(fId, []);
        stuByFam.get(fId).push({ ...s });
      });
      cloned.forEach(f => {
        f.students = stuByFam.get(String(f.id || '')) || [];
      });
    }

    if ((table === 'students' || table === 'class_schedules' || table === 'payments') && /families\s*\(/i.test(sel)) {
      const famMap = new Map((store.families || []).map(f => [String(f.id), { ...f }]));
      cloned.forEach(r => {
        r.families = famMap.get(String(r.family_id || '')) || null;
      });
    }

    if ((table === 'class_schedules' || table === 'attendance_logs') && /students\s*\(/i.test(sel)) {
      const stuMap = new Map((store.students || []).map(s => [String(s.id), { ...s }]));
      cloned.forEach(r => {
        r.students = stuMap.get(String(r.student_id || '')) || null;
      });
    }

    if ((table === 'students' || table === 'class_schedules' || table === 'attendance_logs') && /teachers\s*\(/i.test(sel)) {
      const tchMap = new Map((store.teachers || []).map(t => [String(t.id), { ...t }]));
      cloned.forEach(r => {
        const tKey = r.teacher_id || r.assigned_teacher_id;
        r.teachers = tchMap.get(String(tKey || '')) || null;
      });
    }

    return cloned;
  }

  function executeLocalQuery(payload) {
    const { table, action, select = '*', filters = [], orders = [], limit = null, values = null, single = false } = payload;
    const store = loadLocalDbStore();
    if (!Array.isArray(store[table])) store[table] = [];

    if (action === 'select') {
      let rows = store[table].filter(r => filters.every(f => matchFilter(r, f)));
      if (Array.isArray(orders) && orders.length > 0) {
        rows.sort((a, b) => {
          for (const o of orders) {
            const va = a[o.column] ?? '';
            const vb = b[o.column] ?? '';
            if (va < vb) return o.ascending === false ? 1 : -1;
            if (va > vb) return o.ascending === false ? -1 : 1;
          }
          return 0;
        });
      }
      if (limit) rows = rows.slice(0, Number(limit) || 100);
      const hydrated = hydrateLocalJoins(store, table, rows, select);
      if (table === 'families') {
        hydrated.forEach(f => {
          const em = String(f.email || f.parent_email || '').trim();
          f.email = em;
          f.parent_email = em;
        });
      }
      if (table === 'attendance_logs') {
        hydrated.forEach(l => {
          const dt = String(l.date || l.class_date || '').trim();
          l.date = dt;
          l.class_date = dt;
          const notes = String(l.lesson_notes || l.remarks || '').trim();
          l.lesson_notes = notes;
          l.remarks = notes;
        });
      }
      return { data: single ? (hydrated[0] || null) : hydrated, error: null };
    }

    if (action === 'insert' || action === 'upsert') {
      const inputRows = Array.isArray(values) ? values : [values || {}];
      const inserted = [];
      inputRows.forEach(raw => {
        const row = { ...raw };
        if (!row.id) row.id = generateLocalId(table);
        if (!row.created_at) row.created_at = new Date().toISOString();
        if (table === 'families') {
          const em = String(row.email || row.parent_email || '').trim();
          if (em) {
            row.email = em;
            row.parent_email = em;
          }
        }
        if (table === 'attendance_logs') {
          const dt = String(row.date || row.class_date || '').trim();
          if (dt) {
            row.date = dt;
            row.class_date = dt;
          }
          const notes = String(row.lesson_notes || row.remarks || '').trim();
          if (notes) {
            row.lesson_notes = notes;
            row.remarks = notes;
          }
        }
        const idx = store[table].findIndex(existing => String(existing.id) === String(row.id));
        if (idx >= 0) {
          store[table][idx] = { ...store[table][idx], ...row };
        } else {
          store[table].unshift(row);
        }
        inserted.push(row);
      });
      saveLocalDbStore(store);
      return { data: single ? (inserted[0] || null) : inserted, error: null };
    }

    if (action === 'update') {
      const patch = { ...(values || {}) };
      if (table === 'families') {
        const em = String(patch.email || patch.parent_email || '').trim();
        if (em) {
          patch.email = em;
          patch.parent_email = em;
        }
      }
      const updated = [];
      store[table] = store[table].map(r => {
        if (filters.every(f => matchFilter(r, f))) {
          const next = { ...r, ...patch };
          updated.push(next);
          return next;
        }
        return r;
      });
      saveLocalDbStore(store);
      return { data: single ? (updated[0] || null) : updated, error: null };
    }

    if (action === 'delete') {
      store[table] = store[table].filter(r => !filters.every(f => matchFilter(r, f)));
      saveLocalDbStore(store);
      return { data: [], error: null };
    }

    return { data: null, error: { message: `Unsupported action: ${action}` } };
  }

  async function checkCloudflareD1Available() {
    if (_d1Status !== null) return _d1Status;
    if (_d1CheckPromise) return _d1CheckPromise;

    _d1CheckPromise = (async () => {
      try {
        const res = await fetch(`${getApiBase()}/api/db`, {
          method: 'GET',
          headers: Object.assign({ 'Accept': 'application/json' }, authHeaders())
        });
        if (!res.ok) {
          // 401 = probe ran before login (no token yet). Do NOT cache this:
          // after login the next probe retries WITH the token. Caching it
          // (pre-fix behaviour) trapped the portal in local-mirror mode
          // with 0 rows even after a successful login (caught 2026-10-14).
          if (res.status !== 401) _d1Status = false;
          return false;
        }
        const json = await res.json();
        _d1Status = Boolean(json && json.ok && json.d1_bound);
        if (_d1Status) {
          syncLocalStoreToD1Once();
        }
        return _d1Status;
      } catch (err) {
        _d1Status = false;
        return false;
      } finally {
        _d1CheckPromise = null;
      }
    })();

    return _d1CheckPromise;
  }

  // Called after any successful portal login: forget the old probe result
  // so the next data call re-checks D1 WITH the fresh token.
  window.resetCloudflareD1Availability = function () {
    _d1Status = null;
    _d1CheckPromise = null;
  };

  async function syncLocalStoreToD1Once(force = false) {
    try {
      const store = loadLocalDbStore();
      const hasLocalData = TABLES.some(t => Array.isArray(store[t]) && store[t].length > 0);
      if (!hasLocalData) return false;

      if (!force && localStorage.getItem(D1_MIGRATED_FLAG_KEY) === 'true') {
        return false;
      }

      for (const table of TABLES) {
        const rows = store[table] || [];
        if (rows.length > 0) {
          await fetch(`${getApiBase()}/api/db`, {
            method: 'POST',
            headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
            body: JSON.stringify({ table, action: 'upsert', values: rows })
          });
        }
      }
      localStorage.setItem(D1_MIGRATED_FLAG_KEY, 'true');
      console.log('[Cloudflare D1] Local records automatically synced to Cloudflare D1!');
      return true;
    } catch (e) {
      console.warn('[Cloudflare D1] Initial sync notice:', e);
      return false;
    }
  }

  // Export all local browser cache + DB data to a downloadable JSON file (so user can transfer from old URL to Cloudflare URL in 1 click)
  window.exportLmsFullBackupJson = function () {
    const store = loadLocalDbStore();
    const fullBackup = {
      exported_at: new Date().toISOString(),
      tables: store,
      localStorage_keys: {}
    };
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('alhuda_')) {
        fullBackup.localStorage_keys[k] = localStorage.getItem(k);
      }
    }
    const blob = new Blob([JSON.stringify(fullBackup, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `AlHuda_LMS_Backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };

  // Import a backup JSON file directly into Cloudflare D1 + localStorage
  window.importLmsFullBackupJson = async function (file) {
    if (!file) return;
    const text = await file.text();
    const parsed = JSON.parse(text);

    if (parsed.localStorage_keys && typeof parsed.localStorage_keys === 'object') {
      Object.entries(parsed.localStorage_keys).forEach(([k, v]) => {
        if (typeof v === 'string') localStorage.setItem(k, v);
      });
    }

    const store = loadLocalDbStore();
    if (parsed.tables && typeof parsed.tables === 'object') {
      TABLES.forEach(t => {
        if (Array.isArray(parsed.tables[t]) && parsed.tables[t].length > 0) {
          store[t] = parsed.tables[t];
        }
      });
    }
    saveLocalDbStore(store);
    localStorage.removeItem(D1_MIGRATED_FLAG_KEY);
    await syncLocalStoreToD1Once(true);
    window.location.reload();
  };

  async function executeCloudflareOrLocal(payload) {
    const isD1Live = await checkCloudflareD1Available();
    if (isD1Live) {
      try {
        const res = await fetch(`${getApiBase()}/api/db`, {
          method: 'POST',
          headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
          body: JSON.stringify(payload)
        });
        if (res.status === 401) {
          // Token invalid/expired: drop it so we stop sending a bad token,
          // then fall through to the local mirror below.
          clearWorkerTokens();
        }
        if (res.ok) {
          const result = await res.json();
          // Also mirror writes into local store for instant offline backup
          if (payload.action !== 'select') {
            executeLocalQuery(payload);
          } else if (Array.isArray(result.data) && (!payload.filters || payload.filters.length === 0)) {
            const store = loadLocalDbStore();
            store[payload.table] = result.data.map(r => {
              const clean = { ...r };
              delete clean.students;
              delete clean.families;
              delete clean.teachers;
              if (payload.table === 'families') {
                const em = String(clean.email || clean.parent_email || '').trim();
                clean.email = em;
                clean.parent_email = em;
              }
              return clean;
            });
            saveLocalDbStore(store);
          }
          if (payload.table === 'families' && result && result.data) {
            const list = Array.isArray(result.data) ? result.data : [result.data];
            list.forEach(f => {
              if (f) {
                const em = String(f.email || f.parent_email || '').trim();
                f.email = em;
                f.parent_email = em;
              }
            });
          }
          return result;
        }
      } catch (err) {
        console.warn('[Cloudflare D1] Falling back to local mirror:', err);
      }
    }

    // === WRITE GUARD (new): writes must never silently land in the local
    // mirror while the UI reports success. Reads keep the offline fallback.
    const isWrite = payload && payload.action && payload.action !== 'select';
    if (isWrite) {
      const reason = isD1Live ? 'session expired' : 'server unreachable';
      console.error('[Cloudflare D1] WRITE blocked (' + reason + ') — refusing local fallback for',
        payload.table, payload.action);
      // Alert at most once per 10s so multi-row writes (e.g. family
      // deactivation) don't spam the screen.
      if (typeof window !== 'undefined') {
        const lastAlert = window.__lmsWriteBlockedAlertAt || 0;
        if (Date.now() - lastAlert > 10000) {
          window.__lmsWriteBlockedAlertAt = Date.now();
          alert('Session expired — please log in again. Aap ka change SAVE NAHI hua (koi data kharaab nahi hua).');
        }
      }
      return { data: null, error: { message: 'Session expired — please log in again. Change was NOT saved.' } };
    }

    return executeLocalQuery(payload);
  }

  class CloudflareQueryBuilder {
    constructor(table) {
      this.table = table;
      this.action = 'select';
      this.selectColumns = '*';
      this.filters = [];
      this.orders = [];
      this.limitCount = null;
      this.values = null;
      this.isSingle = false;
    }

    select(columns = '*') {
      this.selectColumns = columns || '*';
      return this;
    }

    insert(values) {
      this.action = 'insert';
      this.values = values;
      return this;
    }

    upsert(values) {
      this.action = 'upsert';
      this.values = values;
      return this;
    }

    update(values) {
      this.action = 'update';
      this.values = values;
      return this;
    }

    delete() {
      this.action = 'delete';
      return this;
    }

    eq(column, value) {
      this.filters.push({ column, op: 'eq', value });
      return this;
    }

    neq(column, value) {
      this.filters.push({ column, op: 'neq', value });
      return this;
    }

    gt(column, value) {
      this.filters.push({ column, op: 'gt', value });
      return this;
    }

    gte(column, value) {
      this.filters.push({ column, op: 'gte', value });
      return this;
    }

    lt(column, value) {
      this.filters.push({ column, op: 'lt', value });
      return this;
    }

    lte(column, value) {
      this.filters.push({ column, op: 'lte', value });
      return this;
    }

    in(column, valueArray) {
      this.filters.push({ column, op: 'in', value: Array.isArray(valueArray) ? valueArray : [] });
      return this;
    }

    like(column, pattern) {
      this.filters.push({ column, op: 'like', value: pattern });
      return this;
    }

    ilike(column, pattern) {
      this.filters.push({ column, op: 'ilike', value: pattern });
      return this;
    }

    order(column, options = { ascending: true }) {
      this.orders.push({ column, ascending: options?.ascending !== false });
      return this;
    }

    limit(count) {
      this.limitCount = count;
      return this;
    }

    single() {
      this.isSingle = true;
      return this;
    }

    maybeSingle() {
      this.isSingle = true;
      return this;
    }

    then(onFulfilled, onRejected) {
      const payload = {
        table: this.table,
        action: this.action,
        select: this.selectColumns,
        filters: this.filters,
        orders: this.orders,
        limit: this.limitCount,
        values: this.values,
        single: this.isSingle
      };
      return executeCloudflareOrLocal(payload).then(onFulfilled, onRejected);
    }
  }

  const cloudflareDbClient = {
    from(table) {
      return new CloudflareQueryBuilder(table);
    },
    storage: {
      from(bucketName) {
        return {
          async upload(path, file) {
            const url = await window.uploadToCloudflareR2(file, bucketName, path);
            return { data: { path, publicUrl: url }, error: null };
          },
          getPublicUrl(path) {
            return { data: { publicUrl: `${getApiBase()}/api/storage?key=${encodeURIComponent(path)}` } };
          }
        };
      }
    }
  };

  // Global helper to upload files/Base64 to Cloudflare R2 Storage (with dataUrl fallback if R2 not yet bound)
  // Exposes the current portal's auth headers so the book reader can fetch
  // protected storage URLs (plain <img> tags cannot send Authorization headers).
  window.getLmsAuthHeaders = function () { return authHeaders(); };
  window.setLmsAuthToken = function (token) { setWorkerToken(token); };
  window.uploadToCloudflareR2 = async function (fileOrDataUrl, folder = 'documents', filename = 'file.bin') {
    const base = getApiBase() || DEFAULT_CLOUDFLARE_BACKEND_URL;
    const normalizeUrl = (u) => {
      if (!u) return '';
      if (u.startsWith('/')) return `${base}${u}`;
      return u;
    };
    try {
      if (typeof fileOrDataUrl === 'string' && fileOrDataUrl.startsWith('data:')) {
        const res = await fetch(`${base}/api/storage`, {
          method: 'POST',
          headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
          body: JSON.stringify({ folder, filename, dataUrl: fileOrDataUrl })
        });
        if (res.ok) {
          const json = await res.json();
          if (json && json.ok && json.url) return normalizeUrl(json.url);
        }
        return fileOrDataUrl;
      } else if (fileOrDataUrl instanceof Blob || fileOrDataUrl instanceof File) {
        const formData = new FormData();
        formData.append('file', fileOrDataUrl);
        formData.append('folder', folder);
        const res = await fetch(`${base}/api/storage`, {
          method: 'POST',
          headers: authHeaders(),
          body: formData
        });
        if (res.ok) {
          const json = await res.json();
          if (json && json.ok && json.url) return normalizeUrl(json.url);
        }
        return await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.readAsDataURL(fileOrDataUrl);
        });
      }
    } catch (e) {}
    return typeof fileOrDataUrl === 'string' ? fileOrDataUrl : '';
  };

  window.createCloudflareLmsClient = function () {
    return cloudflareDbClient;
  };

  // Exposed so portal logout handlers can drop worker session tokens.
  window.clearWorkerTokens = clearWorkerTokens;

  // Batch 1 hardening (S5): full local sign-out wipe, called by the portal
  // logout handlers. Removes the data mirror and every auth/session key
  // from BOTH storages, and drops the in-memory token + D1 probe caches.
  // Data caches that re-sync from D1 are intentionally NOT removed:
  // alhuda_fee_records, alhuda_teacher_salaries, alhuda_custom_books,
  // alhuda_official_announcements (a browser copy may be the only copy).
  window.clearAllLmsLocalState = function () {
    _memoryTokenCache = null;
    _d1Status = null;
    _d1CheckPromise = null;
    const exactKeys = [
      'alhuda_owner_token', 'alhuda_manager_token', 'alhuda_teacher_token', 'alhuda_parent_token',
      'alhuda_logged_in_owner', 'alhuda_logged_in_manager', 'alhuda_logged_in_teacher', 'alhuda_logged_in_parent',
      'alhuda_admin_account', 'alhuda_teacher_accounts', 'alhuda_parent_accounts',
      'alhuda_active_portal_role', 'alhuda_selected_student_id'
    ];
    function wipe(storage) {
      if (!storage) return;
      try {
        const keys = [];
        for (let i = 0; i < storage.length; i++) {
          const k = storage.key(i);
          if (k) keys.push(k);
        }
        keys.forEach(function (k) {
          if (k === LOCAL_DB_STORAGE_KEY || exactKeys.indexOf(k) !== -1 ||
              (k.indexOf('alhuda_') === 0 && k.indexOf('_session') !== -1)) {
            try { storage.removeItem(k); } catch (e) {}
          }
        });
      } catch (e) {}
    }
    try { wipe(localStorage); } catch (e) {}
    try { wipe(sessionStorage); } catch (e) {}
  };

  // Override window.supabase.createClient so all portals (Admin, Manager, Teacher, Parent) automatically use Cloudflare D1 + R2
  window.supabase = {
    createClient: function () {
      return cloudflareDbClient;
    }
  };

  window.db = cloudflareDbClient;
})();

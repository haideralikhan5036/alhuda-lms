/**
 * ============================================================================
 * AL-HUDA ISLAMIC CENTRE LMS — MODULAR ARCHITECTURE
 * File: js/academy-profile.js
 * Purpose: Academy Profile settings — the academy's name, official email,
 *          phone and address, edited in ONE place (Settings > Academy
 *          Profile) and used on every document and message the admin
 *          portal generates: salary slips, fee receipts, reminders,
 *          welcome emails and credential messages.
 * Storage: one system_settings row (key 'academy_profile_v1', id
 *          'SYS-ACADEMY-PROFILE'), localStorage mirror for instant load.
 *          Owner edits; managers get a read-only view (the Worker lets
 *          managers READ this key only). Portal screen headers/titles
 *          are static branding and do NOT come from here.
 * ============================================================================
 */
(function () {
  'use strict';

  var SETTINGS_KEY = 'academy_profile_v1';
  var SETTINGS_ROW_ID = 'SYS-ACADEMY-PROFILE';
  var LS_KEY = 'alhuda_academy_profile_v1';

  var DEFAULT_PROFILE = {
    name: 'Al-Huda Islamic Centre',
    email: 'ceoislamiccentre@gmail.com',
    phone: '',
    address: ''
  };

  var _profile = null;
  var _seedPushDone = false;

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function normalizeProfile(p) {
    var out = clone(DEFAULT_PROFILE);
    if (p && typeof p === 'object') {
      if (typeof p.name === 'string' && p.name.trim()) out.name = p.name.trim();
      if (typeof p.email === 'string' && p.email.trim()) out.email = p.email.trim();
      if (typeof p.phone === 'string') out.phone = p.phone.trim();
      if (typeof p.address === 'string') out.address = p.address.trim();
      if (p.updated_at) out.updated_at = p.updated_at;
      if (p.updated_by) out.updated_by = p.updated_by;
    }
    return out;
  }

  function isOwnerSession() {
    try {
      return typeof CURRENT_ROLE === 'undefined' || !CURRENT_ROLE || CURRENT_ROLE === 'owner';
    } catch (e) { return false; }
  }

  function getProfile() {
    if (_profile) return _profile;
    try {
      var cached = localStorage.getItem(LS_KEY);
      if (cached) { _profile = normalizeProfile(JSON.parse(cached)); return _profile; }
    } catch (e) {}
    _profile = clone(DEFAULT_PROFILE);
    return _profile;
  }

  function applyProfile(p) {
    _profile = normalizeProfile(p);
    try { localStorage.setItem(LS_KEY, JSON.stringify(_profile)); } catch (e) {}
    // email.js keeps module-level identity constants; refresh them so
    // every template built after this point uses the profile values.
    try {
      if (typeof window.__setAcademyIdentity === 'function') {
        window.__setAcademyIdentity(_profile.name, _profile.email, _profile.phone);
      }
    } catch (e) {}
  }

  function upsertProfileRow(profile) {
    if (typeof db === 'undefined' || !db) return Promise.resolve({ error: new Error('no db client') });
    return Promise.resolve(db.from('system_settings').upsert({
      id: SETTINGS_ROW_ID,
      key: SETTINGS_KEY,
      value: JSON.stringify(profile),
      updated_at: new Date().toISOString()
    })).then(function (res) {
      if (res && res.error) return { error: res.error };
      return { error: null };
    }).catch(function (err) { return { error: err }; });
  }

  function loadAcademyProfile() {
    getProfile();
    // Apply the cached/default identity immediately so templates built
    // before the fetch returns still use the freshest known values.
    try {
      if (typeof window.__setAcademyIdentity === 'function') {
        var p0 = getProfile();
        window.__setAcademyIdentity(p0.name, p0.email, p0.phone);
      }
    } catch (e) {}
    try {
      if (typeof db === 'undefined' || !db) return;
      var p = db.from('system_settings').select('value').eq('key', SETTINGS_KEY).limit(1);
      Promise.resolve(p).then(function (res) {
        if (!res || res.error) return;
        var rows = res.data || [];
        if (rows.length && rows[0] && rows[0].value) {
          try { applyProfile(JSON.parse(rows[0].value)); } catch (e) {}
          return;
        }
        if (!_seedPushDone && isOwnerSession()) {
          _seedPushDone = true;
          upsertProfileRow(getProfile());
        }
      }).catch(function () {});
    } catch (e) {}
  }

  // Convenience helpers for template builders across the admin portal.
  window.academyName = function () { return getProfile().name; };
  window.academyEmail = function () { return getProfile().email; };
  window.academyPhone = function () { return getProfile().phone; };

  // ---------------------------------------------------------------------
  // Academy Profile screen (Settings > Academy Profile)
  // ---------------------------------------------------------------------
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderAcademyProfileSettings() {
    var nameEl = document.getElementById('academyNameInput');
    if (!nameEl) return;
    var p = getProfile();
    var owner = isOwnerSession();
    document.getElementById('academyNameInput').value = p.name;
    document.getElementById('academyEmailInput').value = p.email;
    document.getElementById('academyPhoneInput').value = p.phone;
    document.getElementById('academyAddressInput').value = p.address;
    ['academyNameInput', 'academyEmailInput', 'academyPhoneInput', 'academyAddressInput'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.disabled = !owner;
    });
    var saveBtn = document.getElementById('btnSaveAcademyProfile');
    if (saveBtn) saveBtn.style.display = owner ? '' : 'none';
    var note = document.getElementById('academyProfileRoleNote');
    if (note) note.textContent = owner ? '' : 'Only the Owner can change the academy profile.';
    var meta = document.getElementById('academyProfileMeta');
    if (meta) {
      meta.textContent = p.updated_at
        ? 'Last updated ' + new Date(p.updated_at).toLocaleString() + (p.updated_by ? ' by ' + p.updated_by : '')
        : '';
    }
  }

  function saveAcademyProfileSettings() {
    if (!isOwnerSession()) {
      if (typeof lmsNotify === 'function') lmsNotify('Only the Owner can change the academy profile.');
      return Promise.resolve(false);
    }
    var name = (document.getElementById('academyNameInput').value || '').trim();
    var email = (document.getElementById('academyEmailInput').value || '').trim();
    var phone = (document.getElementById('academyPhoneInput').value || '').trim();
    var address = (document.getElementById('academyAddressInput').value || '').trim();
    if (!name) {
      if (typeof lmsNotify === 'function') lmsNotify('Academy name cannot be empty.');
      return Promise.resolve(false);
    }
    if (email && email.indexOf('@') < 1) {
      if (typeof lmsNotify === 'function') lmsNotify('Please enter a valid official email.');
      return Promise.resolve(false);
    }
    var next = normalizeProfile({
      name: name, email: email || DEFAULT_PROFILE.email, phone: phone, address: address,
      updated_at: new Date().toISOString(),
      updated_by: (typeof CURRENT_USER !== 'undefined' && CURRENT_USER) ? String(CURRENT_USER) : 'owner'
    });
    return upsertProfileRow(next).then(function (res) {
      if (res && res.error) {
        if (typeof lmsNotify === 'function') lmsNotify('Could not save the academy profile. Please try again.');
        return false;
      }
      applyProfile(next);
      renderAcademyProfileSettings();
      if (typeof lmsNotify === 'function') lmsNotify('Academy profile saved. New documents and messages will use these details.');
      return true;
    });
  }

  window.AcademyProfile = {
    get: getProfile,
    load: loadAcademyProfile,
    render: renderAcademyProfileSettings,
    save: saveAcademyProfileSettings,
    _normalize: normalizeProfile,
    _defaults: clone(DEFAULT_PROFILE)
  };
  window.renderAcademyProfileSettings = renderAcademyProfileSettings;
  window.saveAcademyProfileSettings = saveAcademyProfileSettings;

  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('DOMContentLoaded', loadAcademyProfile);
  }
})();

// ============================================================================
// Course Catalogue + Course Payment Settings (Phase 1 — 2026-11-03)
// ----------------------------------------------------------------------------
// Single source of truth for the academy's course list and the monthly
// teacher payment rate per assigned student for each course.
//
// Storage: one row in D1 `system_settings` (id 'SYS-COURSE-RATES',
// key 'course_rates_v1', value = JSON). The owner writes it; managers may
// read it (Worker allowlist) so the manager portal's dropdowns and the
// settings view work there too. A localStorage mirror gives instant paint
// on the admin's own device. When no stored row exists yet, the built-in
// defaults below apply — these are the administrator-confirmed seed rates
// (design proposal SALARY-ASSIGNMENT-DESIGN-PROPOSAL-2026-11-03, updated
// by the owner 2026-11-03: Tajweed 2500; the generic "Tafseer-ul-Quran"
// entry was removed by the owner and its name maps to English Tafseer,
// which carries the same 4500 the old rule produced).
//
// Phase 1 scope: the settings screen + one unified course list feeding the
// Add Student, Trial and Family-360 Edit dropdowns. Student records keep
// storing the course NAME exactly as before, so nothing about existing
// records changes. The payroll engine starts reading these rates in
// Phase 2 (assignment-based engine); until then the settings are the
// authoritative record the engine will adopt.
// ============================================================================
(function () {
  'use strict';

  var SETTINGS_KEY = 'course_rates_v1';
  var SETTINGS_ROW_ID = 'SYS-COURSE-RATES';
  var LS_KEY = 'alhuda_course_rates_v1';

  var DEFAULT_SETTINGS = {
    version: 1,
    weekend_rate: 3200,
    basic_salary_pkr: 20000,
    courses: [
      { id: 'crs-noorani-qaida', name: 'Noorani Qaida', monthly_rate: 2200, active: true, aliases: ['Noorani Qaida & Basic Arabic', 'Noorani Qaida & Basic Quran'] },
      { id: 'crs-quran-reading', name: 'Quran Reading with Tajweed', monthly_rate: 2200, active: true, aliases: ['Nazra Quran with Tajweed', 'Nazra Quran', 'Quran Reading'] },
      { id: 'crs-hifz', name: 'Quran Memorization / Hifz', monthly_rate: 2200, active: true, aliases: ['Quran Memorization (Hifz-ul-Quran)', 'Quran Memorization', 'Hifz'] },
      { id: 'crs-tajweed', name: 'Advanced Tajweed Rules', monthly_rate: 2500, active: true, aliases: ['Advanced Tajweed & Tarteel', 'Tajweed'] },
      { id: 'crs-tafseer-english', name: 'English Translation & Tafseer', monthly_rate: 4500, active: true, weekend_eligible: false, aliases: ['Tafseer-ul-Quran', 'Tafseer & Translation', 'English Tafseer', 'English Translation'] },
      { id: 'crs-tafseer-urdu', name: 'Urdu Translation & Tafseer', monthly_rate: 3500, active: true, weekend_eligible: false, aliases: ['Urdu Tafseer', 'Urdu Translation'] },
      { id: 'crs-islamic-studies', name: 'Islamic Studies & Tarbiyah', monthly_rate: 3500, active: true, weekend_eligible: false, aliases: ['Islamic Studies & Daily Duas', 'Islamic Studies & Duas', 'Islamic Studies'] },
      { id: 'crs-arabic', name: 'Arabic Language & Grammar', monthly_rate: 2200, active: true, aliases: ['Arabic Language', 'Arabic'] }
    ],
    updated_at: null,
    updated_by: null
  };

  var _settings = null;
  var _seedPushDone = false;

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function isOwnerSession() {
    try {
      return typeof CURRENT_ROLE === 'undefined' || !CURRENT_ROLE || CURRENT_ROLE === 'owner';
    } catch (e) { return true; }
  }

  function normalizeSettings(raw) {
    var s = clone(DEFAULT_SETTINGS);
    if (!raw || typeof raw !== 'object') return s;
    if (Array.isArray(raw.courses) && raw.courses.length) {
      s.courses = raw.courses.map(function (c, i) {
        c = c || {};
        var cid = String(c.id || ('crs-custom-' + i));
        return {
          id: cid,
          name: String(c.name || '').trim(),
          monthly_rate: Math.max(0, parseInt(c.monthly_rate, 10) || 0),
          active: c.active !== false,
          // Weekend-rate eligibility (Phase 2): the legacy engine never
          // let the weekend programme rate override Tafseer or Islamic
          // Studies, so those catalogue rows carry weekend_eligible:false.
          // Rows saved before this field existed get the same default by
          // id; every other course is weekend-eligible.
          weekend_eligible: c.weekend_eligible != null ? !!c.weekend_eligible
            : !(cid === 'crs-tafseer-english' || cid === 'crs-tafseer-urdu' || cid === 'crs-islamic-studies'),
          aliases: Array.isArray(c.aliases) ? c.aliases.map(function (a) { return String(a); }) : [],
          updated_at: c.updated_at || null,
          updated_by: c.updated_by || null
        };
      }).filter(function (c) { return c.name; });
      if (!s.courses.length) s.courses = clone(DEFAULT_SETTINGS.courses);
    }
    if (raw.weekend_rate != null) s.weekend_rate = Math.max(0, parseInt(raw.weekend_rate, 10) || 0);
    if (raw.basic_salary_pkr != null) s.basic_salary_pkr = Math.max(0, parseInt(raw.basic_salary_pkr, 10) || 0);
    s.updated_at = raw.updated_at || null;
    s.updated_by = raw.updated_by || null;
    return s;
  }

  function getSettings() {
    if (_settings) return _settings;
    try {
      var cached = localStorage.getItem(LS_KEY);
      if (cached) { _settings = normalizeSettings(JSON.parse(cached)); return _settings; }
    } catch (e) {}
    _settings = clone(DEFAULT_SETTINGS);
    return _settings;
  }

  function applySettings(s) {
    _settings = normalizeSettings(s);
    try { localStorage.setItem(LS_KEY, JSON.stringify(_settings)); } catch (e) {}
    populateCourseSelects();
  }

  function resolveByName(name) {
    var target = String(name || '').trim().toLowerCase();
    if (!target) return null;
    var list = getSettings().courses;
    for (var i = 0; i < list.length; i++) {
      if (list[i].name.toLowerCase() === target) return list[i];
    }
    for (var j = 0; j < list.length; j++) {
      var aliases = list[j].aliases || [];
      for (var k = 0; k < aliases.length; k++) {
        if (String(aliases[k]).trim().toLowerCase() === target) return list[j];
      }
    }
    return null;
  }

  function activeCourses() {
    return getSettings().courses.filter(function (c) { return c.active; });
  }

  // Rebuild one <select> from the active catalogue. The option VALUE is the
  // canonical course name (student records keep storing names, as before).
  // A current value that is an alias selects its canonical entry; a value
  // that matches nothing is preserved as an extra option so an existing
  // record's course is never silently lost.
  function fillSelect(sel, currentValue) {
    if (!sel) return;
    var prev = (currentValue != null ? String(currentValue) : (sel.value || '')).trim();
    var resolved = prev ? resolveByName(prev) : null;
    sel.innerHTML = '';
    activeCourses().forEach(function (c) {
      var opt = document.createElement('option');
      opt.value = c.name;
      opt.textContent = c.name;
      sel.appendChild(opt);
    });
    if (resolved) {
      sel.value = resolved.name;
    } else if (prev) {
      var extra = document.createElement('option');
      extra.value = prev;
      extra.textContent = prev;
      sel.appendChild(extra);
      sel.value = prev;
    }
  }

  function populateCourseSelects() {
    fillSelect(document.getElementById('stuCourseSelect'));
    fillSelect(document.getElementById('trialCourse'));
  }

  function populate360CourseSelect(currentCourseName) {
    fillSelect(document.getElementById('fwEditStuCourse'), currentCourseName || '');
  }

  function upsertSettingsRow(settings) {
    // Mirrors pushAnnouncementsToSettings (dashboard.js): the db shim's
    // upsert returns a promise; failures surface via res.error / rejection.
    if (typeof db === 'undefined' || !db) return Promise.resolve({ error: new Error('no db client') });
    return Promise.resolve(db.from('system_settings').upsert({
      id: SETTINGS_ROW_ID,
      key: SETTINGS_KEY,
      value: JSON.stringify(settings),
      updated_at: new Date().toISOString()
    })).then(function (res) {
      if (res && res.error) return { error: res.error };
      return { error: null };
    }).catch(function (err) { return { error: err }; });
  }

  function loadCourseCatalogue() {
    getSettings();
    populateCourseSelects();
    try {
      if (typeof db === 'undefined' || !db) return;
      var p = db.from('system_settings').select('value').eq('key', SETTINGS_KEY).limit(1);
      Promise.resolve(p).then(function (res) {
        if (!res || res.error) return;
        var rows = res.data || [];
        if (rows.length && rows[0] && rows[0].value) {
          try { applySettings(JSON.parse(rows[0].value)); } catch (e) {}
          return;
        }
        // No stored row yet: the owner seeds the defaults once so every
        // device (and the manager portal) reads the same catalogue.
        if (!_seedPushDone && isOwnerSession()) {
          _seedPushDone = true;
          upsertSettingsRow(getSettings());
        }
      }).catch(function () {});
    } catch (e) {}
  }

  // ---------------------------------------------------------------------
  // Course Payment Settings screen (tab-settings)
  // ---------------------------------------------------------------------
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtWhen(c) {
    if (!c.updated_at) return '—';
    try {
      var d = new Date(c.updated_at);
      return d.toLocaleDateString() + (c.updated_by ? ' · ' + esc(c.updated_by) : '');
    } catch (e) { return '—'; }
  }

  function renderCoursePaymentSettings() {
    var body = document.getElementById('courseRatesTableBody');
    if (!body) return;
    var s = getSettings();
    var owner = isOwnerSession();
    var dis = owner ? '' : ' disabled';

    body.innerHTML = s.courses.map(function (c, i) {
      return '<tr class="border-t border-slate-100">' +
        '<td class="py-3 pr-3 font-bold text-slate-800">' + esc(c.name) +
          '<input type="hidden" class="cr-course-id" value="' + esc(c.id) + '">' +
          '<input type="hidden" class="cr-course-name" value="' + esc(c.name) + '">' +
          '<input type="hidden" class="cr-course-aliases" value="' + esc((c.aliases || []).join('|')) + '">' +
        '</td>' +
        '<td class="py-3 pr-3"><input type="number" min="0" step="1" class="cr-course-rate w-32 p-2 border border-slate-300 rounded-lg font-bold text-slate-900" value="' + c.monthly_rate + '"' + dis + '></td>' +
        '<td class="py-3 pr-3 text-center"><input type="checkbox" class="cr-course-active w-5 h-5 accent-emerald-600" ' + (c.active ? 'checked' : '') + dis + '></td>' +
        '<td class="py-3 text-sm text-slate-500">' + fmtWhen(c) + '</td>' +
      '</tr>';
    }).join('');

    var wk = document.getElementById('weekendRateInput');
    if (wk) { wk.value = s.weekend_rate; wk.disabled = !owner; }
    var bs = document.getElementById('basicSalaryInput');
    if (bs) { bs.value = s.basic_salary_pkr; bs.disabled = !owner; }

    var saveBtn = document.getElementById('btnSaveCourseRates');
    if (saveBtn) saveBtn.style.display = owner ? '' : 'none';
    var addWrap = document.getElementById('courseRatesAddWrap');
    if (addWrap) addWrap.style.display = owner ? '' : 'none';
    var note = document.getElementById('courseRatesRoleNote');
    if (note) note.textContent = owner ? '' : 'You are viewing as Manager — rates can be viewed here; only the Owner can change them.';

    var info = document.getElementById('courseRatesUpdatedInfo');
    if (info) {
      info.textContent = s.updated_at
        ? ('Last saved: ' + new Date(s.updated_at).toLocaleString() + (s.updated_by ? ' by ' + s.updated_by : ''))
        : 'Not saved yet — the rates below are the current defaults. Press Save to store them.';
    }
    updateRatesWarning();
  }

  function collectSettingsFromForm() {
    var s = getSettings();
    var byId = {};
    s.courses.forEach(function (c) { byId[c.id] = c; });
    var courses = [];
    var rows = document.querySelectorAll('#courseRatesTableBody tr');
    rows.forEach(function (tr) {
      var id = tr.querySelector('.cr-course-id').value;
      var prev = byId[id] || {};
      courses.push({
        id: id,
        name: tr.querySelector('.cr-course-name').value,
        monthly_rate: Math.max(0, parseInt(tr.querySelector('.cr-course-rate').value, 10) || 0),
        active: !!tr.querySelector('.cr-course-active').checked,
        aliases: (tr.querySelector('.cr-course-aliases').value || '').split('|').filter(Boolean),
        updated_at: prev.updated_at || null,
        updated_by: prev.updated_by || null
      });
    });
    var out = clone(s);
    out.courses = courses.length ? courses : s.courses;
    var wk = document.getElementById('weekendRateInput');
    if (wk) out.weekend_rate = Math.max(0, parseInt(wk.value, 10) || 0);
    var bs = document.getElementById('basicSalaryInput');
    if (bs) out.basic_salary_pkr = Math.max(0, parseInt(bs.value, 10) || 0);
    return out;
  }

  function updateRatesWarning() {
    var warn = document.getElementById('courseRatesWarning');
    if (!warn) return;
    var draft = document.getElementById('courseRatesTableBody') ? collectSettingsFromForm() : getSettings();
    var bad = draft.courses.filter(function (c) { return c.active && !(c.monthly_rate > 0); });
    if (bad.length) {
      warn.classList.remove('hidden');
      warn.textContent = '⚠ These active courses have no valid rate: ' + bad.map(function (c) { return c.name; }).join(', ') + '. A rate is required before a course can stay active.';
    } else {
      warn.classList.add('hidden');
      warn.textContent = '';
    }
  }

  function currentUserLabel() {
    try {
      return (typeof CURRENT_USER_NAME !== 'undefined' && CURRENT_USER_NAME) ||
        (typeof CURRENT_USERNAME !== 'undefined' && CURRENT_USERNAME) || 'Owner';
    } catch (e) { return 'Owner'; }
  }

  async function saveCoursePaymentSettings() {
    if (!isOwnerSession()) {
      if (typeof lmsNotify === 'function') lmsNotify('Only the Owner can change course payment rates.');
      return;
    }
    var next = collectSettingsFromForm();
    var bad = next.courses.filter(function (c) { return c.active && !(c.monthly_rate > 0); });
    if (bad.length) {
      if (typeof lmsNotify === 'function') lmsNotify('These active courses need a rate above 0: ' + bad.map(function (c) { return c.name; }).join(', '));
      updateRatesWarning();
      return;
    }
    var now = new Date().toISOString();
    var by = currentUserLabel();
    // Stamp changed courses so "Last changed" is meaningful per course.
    var prev = getSettings();
    var prevById = {};
    prev.courses.forEach(function (c) { prevById[c.id] = c; });
    next.courses.forEach(function (c) {
      var p = prevById[c.id];
      if (!p || p.monthly_rate !== c.monthly_rate || p.active !== c.active || p.name !== c.name) {
        c.updated_at = now; c.updated_by = by;
      }
    });
    next.updated_at = now;
    next.updated_by = by;

    var res = await upsertSettingsRow(next);
    if (res && res.error) {
      if (typeof lmsNotify === 'function') lmsNotify('Could not save to the server — your changes were kept on this device only. Please try again.');
      applySettings(next);
      return;
    }
    applySettings(next);
    renderCoursePaymentSettings();
    if (typeof lmsNotify === 'function') lmsNotify('Course payment settings saved. New rates apply to salary months that are not yet saved.');
  }

  function addCatalogueCourse() {
    if (!isOwnerSession()) return;
    var nameEl = document.getElementById('newCourseName');
    var rateEl = document.getElementById('newCourseRate');
    var name = (nameEl.value || '').trim();
    var rate = parseInt(rateEl.value, 10) || 0;
    if (!name) { if (typeof lmsNotify === 'function') lmsNotify('Please enter the new course name.'); return; }
    if (!(rate > 0)) { if (typeof lmsNotify === 'function') lmsNotify('A new course needs a monthly rate above 0.'); return; }
    var draft = collectSettingsFromForm();
    if (resolveByNameIn(draft, name)) { if (typeof lmsNotify === 'function') lmsNotify('A course with this name already exists.'); return; }
    var slug = 'crs-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    var id = slug, n = 2;
    while (draft.courses.some(function (c) { return c.id === id; })) { id = slug + '-' + (n++); }
    draft.courses.push({ id: id, name: name, monthly_rate: rate, active: true, aliases: [], updated_at: null, updated_by: null });
    applySettings(draft);
    renderCoursePaymentSettings();
    nameEl.value = ''; rateEl.value = '';
    if (typeof lmsNotify === 'function') lmsNotify('Course added to the list — press Save to store it for all devices.');
  }

  function resolveByNameIn(settings, name) {
    var target = String(name || '').trim().toLowerCase();
    if (!target) return null;
    for (var i = 0; i < settings.courses.length; i++) {
      var c = settings.courses[i];
      if (c.name.toLowerCase() === target) return c;
      if ((c.aliases || []).some(function (a) { return String(a).trim().toLowerCase() === target; })) return c;
    }
    return null;
  }

  // ---------------------------------------------------------------------
  window.CourseCatalogue = {
    getSettings: getSettings,
    resolveByName: resolveByName,
    activeCourses: activeCourses,
    load: loadCourseCatalogue,
    SETTINGS_KEY: SETTINGS_KEY
  };
  window.populateCourseSelects = populateCourseSelects;
  window.populate360CourseSelect = populate360CourseSelect;
  window.renderCoursePaymentSettings = renderCoursePaymentSettings;
  window.saveCoursePaymentSettings = saveCoursePaymentSettings;
  window.addCatalogueCourse = addCatalogueCourse;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadCourseCatalogue);
  } else {
    loadCourseCatalogue();
  }
  // Rates form warning stays live while the owner edits.
  document.addEventListener('input', function (e) {
    if (e && e.target && e.target.classList && e.target.classList.contains('cr-course-rate')) updateRatesWarning();
  });
  document.addEventListener('change', function (e) {
    if (e && e.target && e.target.classList && e.target.classList.contains('cr-course-active')) updateRatesWarning();
  });
})();

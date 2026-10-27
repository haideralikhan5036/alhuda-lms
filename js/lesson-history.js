// ============================================================================
// Unified Lesson History — shared reader (Batch: Lesson History, 2026-10-28)
// ----------------------------------------------------------------------------
// SINGLE SOURCE OF TRUTH: the existing attendance_logs table + its free-form
// lesson_notes JSON column. This module is a READER ONLY — it creates no new
// history store, no duplicate storage, and no dummy entries.
//
// Every portal (Student 360, Family 360, Teacher, Parent, Owner/Manager
// dashboard-via-360) must call getLessonHistory() instead of parsing
// lesson_notes with its own copy of the logic.
//
// Normalization rules (from the 2026-10-28 audits):
//  - Date filter = exact match on the STORED date string. No timezone
//    re-conversion in the UI (writers now stamp the PKT date; legacy rows
//    keep whatever date they were written with).
//  - Order: date DESC, then created_at DESC. ALL same-day multiples are
//    returned — never find-first.
//  - READ-SIDE DEDUPE: rows sharing (schedule_id, date) collapse to ONE
//    display entry — the latest created_at row supplies the lesson payload,
//    while started_at/completed_at are PAIRED across the group (earliest
//    started_at, latest completed_at), because the start transition and the
//    lesson save live on different rows (no UNIQUE index exists, and adding
//    one would make INSERT OR REPLACE wipe omitted columns). Rows WITHOUT
//    a schedule_id are never deduped against each other (a 360-form row and
//    a modal row for the same date may be genuinely different lessons).
//  - Missing optionals -> null/omitted. NEVER "Page 1", NEVER a fallback
//    book. A missing page renders as no page, not page 1.
//  - Actual duration = completed_at - started_at, ONLY when both exist
//    (after pairing). Otherwise durationMins is null and the UI MUST show
//    the exact text "not recorded" — never the scheduled length as actual.
//  - additional_lesson is the ONE supplementary-lesson key (Namaz, Duas,
//    Islamic Studies, ...). It is distinct from the Additional Course
//    lesson_name field and must never be conflated with it.
//  - image_key is the authoritative lesson-image reference (R2 key). The
//    image itself is fetched with auth headers and rendered via a blob URL
//    (plain <img> tags cannot send Authorization headers, and storage GET
//    serves Content-Disposition: attachment).
// Authorization is enforced server-side (Worker role scoping); this module
// never invents scope. Teacher scope is the UNION from the 2026-10-28 owner
// correction: logs the teacher personally recorded (teacher_id = sub) OR
// logs of students currently assigned to that teacher.
// ============================================================================
(function (global) {
  'use strict';

  var WORKER_ORIGIN = 'https://alhuda-lms.ceoislamiccentre.workers.dev';

  function apiBase() {
    try {
      if (global.CLOUDFLARE_API_BASE_URL) return String(global.CLOUDFLARE_API_BASE_URL).replace(/\/+$/, '');
      if (global.location && global.location.hostname && String(global.location.hostname).endsWith('.workers.dev')) return '';
    } catch (e) {}
    return WORKER_ORIGIN;
  }

  function authHeaders() {
    try {
      if (typeof global.getLmsAuthHeaders === 'function') return global.getLmsAuthHeaders() || {};
    } catch (e) {}
    return {};
  }

  function toStr(v) {
    return v === undefined || v === null ? '' : String(v);
  }

  function toNumOrNull(v) {
    if (v === undefined || v === null || v === '') return null;
    var n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  // Parse the lesson_notes payload (JSON object, or legacy plain text).
  // Returns null only when there is no payload at all.
  function parseLessonNotes(raw) {
    if (raw === undefined || raw === null || raw === '') return null;
    var parsed = raw;
    if (typeof raw === 'string') {
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        // Legacy plain-text note (schedule.js / trials.js writers).
        return {
          hasLesson: true,
          bookId: null,
          bookTitle: null,
          para: null,
          page: null,
          lineRange: null,
          result: null,
          remarks: String(raw),
          additionalLesson: null,
          lessonName: null,
          imageKey: null,
          isAdditionalCourse: false,
          raw: raw
        };
      }
    }
    if (!parsed || typeof parsed !== 'object') return null;
    var page = toNumOrNull(parsed.page);
    return {
      hasLesson: true,
      bookId: parsed.book_id || null,
      bookTitle: parsed.book_title || parsed.sabaq || parsed.course || null,
      para: toNumOrNull(parsed.para),
      page: page,
      lineRange: parsed.line_range || null,
      result: parsed.status || parsed.result || null,
      remarks: parsed.remarks || parsed.notes || null,
      additionalLesson: parsed.additional_lesson || null,
      lessonName: parsed.lesson_name || null,
      imageKey: parsed.image_key || null,
      isAdditionalCourse: parsed.book_id === 'additional-course',
      raw: raw
    };
  }

  // Normalize ONE attendance_logs row into a LessonEntry. teacherName may
  // be supplied by the caller (joined teachers(full_name) or a local map);
  // when unknown it stays null — never invented.
  function normalizeLessonRow(log, teacherName) {
    if (!log || typeof log !== 'object') return null;
    var p = parseLessonNotes(log.lesson_notes !== undefined ? log.lesson_notes : log.remarks);
    var joinedName = null;
    try {
      joinedName = (log.teachers && log.teachers.full_name) || (log.teacher && log.teacher.full_name) || null;
    } catch (e) {}
    return {
      id: log.id || null,
      date: log.date || log.class_date || null,
      status: log.status || null,
      teacherId: log.teacher_id || null,
      teacherName: teacherName || joinedName || null,
      scheduleId: log.schedule_id || null,
      studentId: log.student_id || null,
      bookId: p ? p.bookId : null,
      bookTitle: p ? p.bookTitle : null,
      para: p ? p.para : null,
      page: p ? p.page : null,
      lineRange: p ? p.lineRange : null,
      result: p ? p.result : null,
      remarks: p ? p.remarks : null,
      additionalLesson: p ? p.additionalLesson : null,
      lessonName: p ? p.lessonName : null,
      imageKey: p ? p.imageKey : null,
      isAdditionalCourse: p ? p.isAdditionalCourse : false,
      hasLesson: !!p,
      startedAt: log.started_at || null,
      completedAt: log.completed_at || null,
      createdAt: log.created_at || null,
      // durationMins is filled by dedupeLessonRows (paired timestamps).
      durationMins: null,
      raw: log
    };
  }

  function cmpCreatedDesc(a, b) {
    var ca = a.createdAt || '';
    var cb = b.createdAt || '';
    if (ca < cb) return 1;
    if (ca > cb) return -1;
    return 0;
  }

  // Read-side dedupe (see header). Input: raw attendance_logs rows.
  // Output: normalized entries, date DESC, then created_at DESC.
  function dedupeLessonRows(rows, teacherNameById) {
    var map = teacherNameById || {};
    var normalized = [];
    (rows || []).forEach(function (log) {
      var e = normalizeLessonRow(log, log && log.teacher_id ? (map[String(log.teacher_id)] || null) : null);
      if (e) normalized.push(e);
    });

    var groups = new Map();
    normalized.forEach(function (e) {
      var key = (e.scheduleId && e.date) ? ('s:' + String(e.scheduleId) + '|' + String(e.date)) : null;
      if (!key) return; // schedule-less rows are never grouped (see below)
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    });

    // Deterministic pass: emit the merged entry at the position of the
    // group's FIRST row; schedule-less rows pass through untouched.
    var result = [];
    var emitted = new Set();
    normalized.forEach(function (e) {
      var key = (e.scheduleId && e.date) ? ('s:' + String(e.scheduleId) + '|' + String(e.date)) : null;
      if (!key) { result.push(e); return; }
      if (emitted.has(key)) return;
      emitted.add(key);
      var members = groups.get(key) || [e];
      var sorted = members.slice().sort(cmpCreatedDesc);
      var latest = sorted[0];
      var started = null;
      var completed = null;
      members.forEach(function (m) {
        if (m.startedAt && (!started || m.startedAt < started)) started = m.startedAt;
        if (m.completedAt && (!completed || m.completedAt > completed)) completed = m.completedAt;
      });
      var durationMins = null;
      if (started && completed) {
        var ms = Date.parse(completed) - Date.parse(started);
        if (Number.isFinite(ms) && ms >= 0) durationMins = Math.round(ms / 60000);
      }
      var merged = Object.assign({}, latest, { startedAt: started, completedAt: completed, durationMins: durationMins });
      result.push(merged);
    });
    // Sort final output date DESC, then created_at DESC.
    result.sort(function (a, b) {
      var da = a.date || '';
      var db = b.date || '';
      if (da < db) return 1;
      if (da > db) return -1;
      return cmpCreatedDesc(a, b);
    });
    return result;
  }

  // Exact stored-date match. date === null/undefined/'' means "all dates".
  function filterLessonEntries(entries, date) {
    if (!date) return (entries || []).slice();
    var d = String(date);
    return (entries || []).filter(function (e) { return String(e.date) === d; });
  }

  // Display rule for actual duration — the ONLY place this text is minted.
  function formatActualDuration(entry) {
    if (!entry || entry.durationMins === null || entry.durationMins === undefined) return 'not recorded';
    return entry.durationMins + ' min';
  }

  // Human title for an entry: course/lesson, never a fallback book.
  function entryTitle(entry) {
    if (!entry) return '';
    if (entry.isAdditionalCourse) {
      var t = entry.bookTitle || 'Additional Course';
      return entry.lessonName ? (t + ' — ' + entry.lessonName) : t;
    }
    return entry.bookTitle || '';
  }

  // Fetch normalized, deduped history for ONE student. dbClient defaults to
  // the portal's global db shim; tests inject a stub. limit is per-student.
  async function getLessonHistory(opts) {
    var o = opts || {};
    if (!o.studentId) throw new Error('getLessonHistory: studentId is required');
    var client = o.dbClient || (typeof global.db !== 'undefined' ? global.db : null);
    if (!client) throw new Error('getLessonHistory: no db client available');
    var limit = (typeof o.limit === 'number' && o.limit > 0) ? o.limit : 500;
    var res = await client.from('attendance_logs')
      .select('*, teachers(full_name)')
      .eq('student_id', o.studentId)
      .order('date', { ascending: false })
      .limit(limit);
    var rows = (res && res.data) || [];
    var entries = dedupeLessonRows(rows, o.teacherNameById || null);
    return filterLessonEntries(entries, o.date || null);
  }

  // Upload a lesson image via the EXISTING /api/storage path (R2). LOUD
  // failure: on any non-OK response or missing key this THROWS. It must
  // never fall back to storing a dataUrl blob in lesson_notes (the trap in
  // window.uploadToCloudflareR2). Returns the R2 key (authoritative).
  async function uploadLessonImageOrThrow(file) {
    if (!file) throw new Error('No image file provided');
    var formData = new FormData();
    formData.append('file', file);
    formData.append('folder', 'lesson_images'); // ignored server-side for restricted roles (scoped prefix forced)
    var res = await fetch(apiBase() + '/api/storage', {
      method: 'POST',
      headers: authHeaders(),
      body: formData
    });
    var json = null;
    try { json = await res.json(); } catch (e) {}
    if (!res.ok || !json || !json.ok || !json.key) {
      throw new Error('Lesson image upload failed' + (json && json.error ? (': ' + json.error) : ' (HTTP ' + res.status + ')'));
    }
    return json.key;
  }

  // Fetch a lesson image with auth headers and render via blob URL.
  // Returns a blob: URL string, or null when the key is absent/unreadable.
  // Callers MUST revoke the URL when the view is torn down.
  async function loadLessonImageBlobUrl(key) {
    if (!key) return null;
    try {
      var res = await fetch(apiBase() + '/api/storage?key=' + encodeURIComponent(key), {
        headers: authHeaders()
      });
      if (!res.ok) return null;
      var blob = await res.blob();
      return URL.createObjectURL(blob);
    } catch (e) {
      return null;
    }
  }

  var api = {
    parseLessonNotes: parseLessonNotes,
    normalizeLessonRow: normalizeLessonRow,
    dedupeLessonRows: dedupeLessonRows,
    filterLessonEntries: filterLessonEntries,
    formatActualDuration: formatActualDuration,
    entryTitle: entryTitle,
    getLessonHistory: getLessonHistory,
    uploadLessonImageOrThrow: uploadLessonImageOrThrow,
    loadLessonImageBlobUrl: loadLessonImageBlobUrl
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.LessonHistory = api;
})(typeof window !== 'undefined' ? window : globalThis);

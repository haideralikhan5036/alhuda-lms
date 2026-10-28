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
          language: null,
          lineRange: null,
          result: null,
          remarks: String(raw),
          additionalLesson: null,
          lessonName: null,
          imageKey: null,
          isAdditionalCourse: false,
          isAdvanceClass: false,
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
      language: parsed.language || null,
      lineRange: parsed.line_range || null,
      result: parsed.status || parsed.result || null,
      remarks: parsed.remarks || parsed.notes || null,
      additionalLesson: parsed.additional_lesson || null,
      lessonName: parsed.lesson_name || null,
      imageKey: parsed.image_key || null,
      isAdditionalCourse: parsed.book_id === 'additional-course',
      // Batch 3.3 (audit P2-19): an advance lesson is a lesson FOR A
      // FUTURE DATE recorded today (advance_target_date). It must never
      // mask the regular lesson for the same slot/day in deduped views,
      // so dedupeLessonRows groups advance entries separately (see below).
      isAdvanceClass: parsed.is_advance_class === true,
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
      language: p ? p.language : null,
      lineRange: p ? p.lineRange : null,
      result: p ? p.result : null,
      remarks: p ? p.remarks : null,
      additionalLesson: p ? p.additionalLesson : null,
      lessonName: p ? p.lessonName : null,
      imageKey: p ? p.imageKey : null,
      isAdditionalCourse: p ? p.isAdditionalCourse : false,
      // Batch 3.3 (audit P2-19): advance by stored status OR by payload
      // flag — both teacher writers set both, but either alone marks the
      // row as an advance lesson for dedupe purposes.
      isAdvanceClass: log.status === 'Advance Class' || (p ? p.isAdvanceClass === true : false),
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
  // Batch 3.3 (audit P2-19) — dedupe key. An advance lesson is a lesson
  // FOR A FUTURE DATE recorded today (status 'Advance Class' /
  // is_advance_class payload), NOT the regular lesson for that slot/day.
  // The old key (schedule + date) merged the two, and the latest-created
  // row won — so an advance save hid the regular lesson in every deduped
  // view (teacher history, parent history, admin 360). Advance entries
  // now form their own group ('|adv' suffix): re-saves of the SAME
  // advance class still collapse to the latest, and re-saves of the
  // regular lesson still collapse to the latest, but neither can mask
  // the other. Schedule-less rows are never grouped (key null).
  function dedupeKey(e) {
    if (!e || !e.scheduleId || !e.date) return null;
    return 's:' + String(e.scheduleId) + '|' + String(e.date) + (e.isAdvanceClass ? '|adv' : '');
  }

  function dedupeLessonRows(rows, teacherNameById) {
    var map = teacherNameById || {};
    var normalized = [];
    (rows || []).forEach(function (log) {
      var e = normalizeLessonRow(log, log && log.teacher_id ? (map[String(log.teacher_id)] || null) : null);
      if (e) normalized.push(e);
    });

    var groups = new Map();
    normalized.forEach(function (e) {
      var key = dedupeKey(e);
      if (!key) return; // schedule-less rows are never grouped (see below)
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    });

    // Deterministic pass: emit the merged entry at the position of the
    // group's FIRST row; schedule-less rows pass through untouched.
    var result = [];
    var emitted = new Set();
    normalized.forEach(function (e) {
      var key = dedupeKey(e);
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

  // ==========================================================================
  // Canonical lesson-page resolver (Lesson History page links, 2026-10-28).
  // ONE place decides whether a saved lesson record can open its exact
  // course-material page, and which page that is. Every portal routes its
  // history Read buttons through resolveLessonPage() — no caller may pass
  // raw record fields straight to a reader anymore.
  //
  // Contract:
  //   resolveLessonPage(entry, availableBooks)
  //     entry: a normalized history entry (bookId, bookTitle, para, page,
  //       language, isAdditionalCourse — exactly what parseLessonNotes
  //       produces). Callers pass the entry they already render.
  //     availableBooks: the CALLING portal's catalog list, evaluated at
  //       click time. The caller supplies its catalog WITHOUT the
  //       library-browsing course/title filter: a saved lesson is not
  //       browsing, so a shifted student's old book must still resolve.
  //       Allowlist + tombstone gates still apply (they are part of the
  //       catalog itself), and role authorization is enforced at the
  //       gate: history entries are only ever shown for in-scope
  //       students (Worker teacher-UNION / parent-own-family scope), and
  //       /api/storage stays Bearer-gated server-side. The resolver
  //       itself never title-matches, never guesses a para, and never
  //       substitutes another book or page 1.
  //   Returns { ok: true, book, displayPage, pageIndex, para, url,
  //     viewerMode, language } or { ok: false, reason }.
  //   Reasons: ADDITIONAL_COURSE, NO_BOOK_ID, BOOK_NOT_FOUND,
  //     PAGE_MISSING, PARA_REQUIRED, PAGE_OUT_OF_RANGE, PAGE_NOT_AVAILABLE.
  //
  // Index rule, stated once: saved/display pages are 1-based everywhere
  // (form dropdowns, lesson_notes, history entries); pages[] /
  // paraPages[] / BOOK_PAGE_<id>_<i> are 0-based. The resolver converts
  // exactly once: pageIndex = displayPage - 1. No other layer converts.
  // Quran/Tafseer saved pages are PARA-RELATIVE: a para-based book with
  // a page but no para is PARA_REQUIRED, never treated as a global page.
  // Interactive Qaida: page = lesson number 1..49, viewerMode
  // 'interactive', url null (it renders from the lesson registry, not a
  // storage URL). A resolved storage URL is returned as-is for the
  // portal reader's existing auth-fetch -> blob URL render; it is never
  // a public bucket URL and never a signed URL stored in the record.
  // ==========================================================================
  function isParaBasedBook(book) {
    if (!book) return false;
    return book.category === 'quran' || book.category === 'tafseer' || !!book.paras_data || !!book.paras;
  }

  // Default 30-para registry (mirrors curriculum_data.js QURAN_PARAS_INFO:
  // 18 pages per para, except para 29 with 20 and para 30 with 24). Used
  // only when the book carries no paras_data and no paras array.
  function defaultParaRange(para) {
    var p = Number(para) || 1;
    if (p === 29) return { page_start: 505, page_end: 524, total_pages: 20 };
    if (p === 30) return { page_start: 525, page_end: 548, total_pages: 24 };
    return { page_start: (p - 1) * 18 + 1, page_end: p * 18, total_pages: 18 };
  }

  // Mirror of curriculum_data.js getBookParaPages, self-contained so the
  // resolver works in tests without the curriculum globals: paras_data
  // first, then the paras array (explicit pages, else a slice of
  // book.pages), else the default registry slice of book.pages.
  function paraPagesFor(book, para) {
    var p = Number(para) || 1;
    if (book.paras_data) {
      if (Array.isArray(book.paras_data[p])) return book.paras_data[p];
      if (Array.isArray(book.paras_data[String(p)])) return book.paras_data[String(p)];
    }
    var match = null;
    if (Array.isArray(book.paras)) {
      for (var i = 0; i < book.paras.length; i++) {
        if (Number(book.paras[i].para) === p) { match = book.paras[i]; break; }
      }
    }
    if (!match) match = defaultParaRange(p);
    if (Array.isArray(match.pages) && match.pages.length > 0) return match.pages;
    if (Array.isArray(book.pages) && book.pages.length > 0) {
      var start = (Number(match.page_start) || 1) - 1;
      var count = Number(match.total_pages) || (match.page_end ? (Number(match.page_end) - Number(match.page_start) + 1) : 18);
      return book.pages.slice(start, start + count);
    }
    return [];
  }

  function isPlaceholderSvgUrl(url) {
    return typeof url === 'string' && url.indexOf('data:image/svg') === 0;
  }

  var LESSON_PAGE_REASON_MESSAGES = {
    ADDITIONAL_COURSE: 'This lesson has no course page to open (Additional Course).',
    NO_BOOK_ID: 'This lesson record has no course saved, so its page cannot be opened.',
    BOOK_NOT_FOUND: 'Course book not found.',
    PAGE_MISSING: 'This lesson record has no page saved, so its page cannot be opened.',
    PARA_REQUIRED: 'This lesson record has no Para saved, so its Quran page cannot be identified.',
    PAGE_OUT_OF_RANGE: 'The saved page is outside this course book.',
    PAGE_NOT_AVAILABLE: 'This course page is not available.'
  };

  function lessonPageReasonMessage(reason) {
    return LESSON_PAGE_REASON_MESSAGES[reason] || 'This lesson page cannot be opened.';
  }

  function resolveLessonPage(entry, availableBooks) {
    if (!entry || entry.isAdditionalCourse || entry.bookId === 'additional-course') {
      return { ok: false, reason: 'ADDITIONAL_COURSE' };
    }
    var bookId = entry.bookId;
    if (!bookId) return { ok: false, reason: 'NO_BOOK_ID' };
    var books = Array.isArray(availableBooks) ? availableBooks : [];
    var book = null;
    for (var i = 0; i < books.length; i++) {
      if (books[i] && books[i].id === bookId) { book = books[i]; break; }
    }
    if (!book) return { ok: false, reason: 'BOOK_NOT_FOUND' };
    var page = toNumOrNull(entry.page);
    if (page === null) return { ok: false, reason: 'PAGE_MISSING' };
    var para = toNumOrNull(entry.para);
    var language = entry.language || null;
    // Interactive Qaida: page IS the lesson number; range-checked, never
    // silently clamped — a clamp would open a different lesson.
    if (book.is_interactive || book.id === 'interactive-madani-qaida') {
      var total = Number(book.total_pages) || 49;
      if (page < 1 || page > total) return { ok: false, reason: 'PAGE_OUT_OF_RANGE' };
      return { ok: true, book: book, displayPage: page, pageIndex: page - 1, para: null, url: null, viewerMode: 'interactive', language: language };
    }
    if (isParaBasedBook(book)) {
      if (para === null) return { ok: false, reason: 'PARA_REQUIRED' };
      var paraPages = paraPagesFor(book, para);
      if (paraPages.length === 0) return { ok: false, reason: 'PAGE_NOT_AVAILABLE' };
      if (page < 1 || page > paraPages.length) return { ok: false, reason: 'PAGE_OUT_OF_RANGE' };
      var paraUrl = paraPages[page - 1];
      if (!paraUrl || isPlaceholderSvgUrl(paraUrl)) return { ok: false, reason: 'PAGE_NOT_AVAILABLE' };
      return { ok: true, book: book, displayPage: page, pageIndex: page - 1, para: para, url: paraUrl, viewerMode: 'image', language: language };
    }
    if (page < 1) return { ok: false, reason: 'PAGE_OUT_OF_RANGE' };
    var bookTotal = Number(book.total_pages) || (Array.isArray(book.pages) ? book.pages.length : 0) || 0;
    if (bookTotal > 0 && page > bookTotal) return { ok: false, reason: 'PAGE_OUT_OF_RANGE' };
    if (!Array.isArray(book.pages) || book.pages.length === 0) return { ok: false, reason: 'PAGE_NOT_AVAILABLE' };
    var url = book.pages[page - 1];
    if (!url || isPlaceholderSvgUrl(url)) return { ok: false, reason: 'PAGE_NOT_AVAILABLE' };
    return { ok: true, book: book, displayPage: page, pageIndex: page - 1, para: null, url: url, viewerMode: (book.is_text_viewer ? 'text' : 'image'), language: language };
  }

  // Stale-catalog cure: the per-browser catalog is hydrated from D1 into
  // localStorage, and a book whose pages[] is missing/empty (or a book
  // absent from the list because hydration never ran, e.g. a parent-only
  // device) must get ONE on-demand re-hydration before the click is
  // judged. getBooks() re-reads the caller's list after hydration.
  // A failed re-hydration yields the honest final reason — never a
  // stale page, never a fallback book. Bounded: at most one refresh.
  async function resolveLessonPageWithRefresh(entry, getBooks, hydrateFn) {
    var first = resolveLessonPage(entry, typeof getBooks === 'function' ? getBooks() : []);
    if (first.ok) return first;
    if ((first.reason === 'PAGE_NOT_AVAILABLE' || first.reason === 'BOOK_NOT_FOUND') && typeof hydrateFn === 'function') {
      try { await hydrateFn(); } catch (e) {}
      return resolveLessonPage(entry, typeof getBooks === 'function' ? getBooks() : []);
    }
    return first;
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

  // Batch 3.2 (audit P1-6) — attended-status semantics, shared by the
  // parent portal. Teachers store 'Completed' for a held class (the modal
  // 'Present' is mapped to 'Completed' at save time); 'Present' itself is
  // only ever a legacy stored value. Every other stored status — Absent,
  // Leave, Running, Waiting, anything else — is NOT attended.
  function isAttendedStatus(status) {
    var s = String(status == null ? '' : status).trim();
    return s === 'Completed' || s === 'Present';
  }

  // Batch 3.2 (audit P1-6) — attendance rate over ALREADY-DEDUPED entries
  // (one per class instance; callers must pass the dedupeLessonRows output,
  // never raw logs, or re-saves inflate the denominator). Denominator =
  // every deduped entry, including Absent/Leave/Running/Waiting (a class
  // that was scheduled and logged but not attended counts against the
  // rate; only genuinely attended classes count for it). No records →
  // 0%, never NaN.
  function attendanceRate(entries) {
    var list = Array.isArray(entries) ? entries : [];
    var present = 0;
    list.forEach(function (e) {
      if (e && isAttendedStatus(e.status)) present++;
    });
    var total = list.length;
    return { present: present, total: total,
             percent: total > 0 ? Math.round((present / total) * 100) : 0 };
  }

  var api = {
    parseLessonNotes: parseLessonNotes,
    normalizeLessonRow: normalizeLessonRow,
    dedupeLessonRows: dedupeLessonRows,
    isAttendedStatus: isAttendedStatus,
    attendanceRate: attendanceRate,
    filterLessonEntries: filterLessonEntries,
    formatActualDuration: formatActualDuration,
    resolveLessonPage: resolveLessonPage,
    resolveLessonPageWithRefresh: resolveLessonPageWithRefresh,
    lessonPageReasonMessage: lessonPageReasonMessage,
    entryTitle: entryTitle,
    getLessonHistory: getLessonHistory,
    uploadLessonImageOrThrow: uploadLessonImageOrThrow,
    loadLessonImageBlobUrl: loadLessonImageBlobUrl
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.LessonHistory = api;
})(typeof window !== 'undefined' ? window : globalThis);

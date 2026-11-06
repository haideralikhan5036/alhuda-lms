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
//  - annotated_pages (2026-11-06) is the multi-page sibling of image_key:
//    an array of { key, para, page, orig_page, seq } — flattened images of
//    book pages the teacher marked in the reader, uploaded to R2 and
//    attached to this same lesson record. `page` is para-relative (the
//    record convention); `orig_page` is the printed page number captured
//    at save time so viewers never need a book lookup. Parsed entries are
//    exposed as annotatedPages with camelCase fields, sorted by seq with
//    seq renumbered 1..n; absent/invalid -> null, exactly like image_key.
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

  // Normalize the raw annotated_pages array from a lesson payload.
  // Entries without a usable storage key are dropped (a page reference
  // with no image is meaningless); the rest are ordered by their stored
  // seq (falling back to array order) and renumbered 1..n so every
  // consumer can rely on seq as the display order. Returns null when
  // nothing usable remains — the same "absent" signal as image_key.
  function normalizeAnnotatedPages(raw) {
    if (!Array.isArray(raw)) return null;
    var usable = [];
    raw.forEach(function (e, idx) {
      if (!e || typeof e !== 'object') return;
      var key = typeof e.key === 'string' ? e.key : '';
      if (!key) return;
      usable.push({
        key: key,
        para: toNumOrNull(e.para),
        page: toNumOrNull(e.page),
        origPage: toNumOrNull(e.orig_page != null ? e.orig_page : e.origPage),
        seq: toNumOrNull(e.seq),
        _idx: idx
      });
    });
    if (usable.length === 0) return null;
    usable.sort(function (a, b) {
      var sa = a.seq === null ? a._idx + 1000000 : a.seq;
      var sb = b.seq === null ? b._idx + 1000000 : b.seq;
      if (sa !== sb) return sa - sb;
      return a._idx - b._idx;
    });
    return usable.map(function (e, i) {
      return { key: e.key, para: e.para, page: e.page, origPage: e.origPage, seq: i + 1 };
    });
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
          lineBox: null,
          result: null,
          remarks: String(raw),
          additionalLesson: null,
          lessonName: null,
          pageReference: null,
          imageKey: null,
          annotatedPages: null,
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
      lineBox: parsed.line_box || null,
      result: parsed.status || parsed.result || null,
      remarks: parsed.remarks || parsed.notes || null,
      additionalLesson: parsed.additional_lesson || null,
      lessonName: parsed.lesson_name || null,
      pageReference: parsed.page_reference || null,
      imageKey: parsed.image_key || null,
      annotatedPages: normalizeAnnotatedPages(parsed.annotated_pages),
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
      lineBox: p ? p.lineBox : null,
      result: p ? p.result : null,
      remarks: p ? p.remarks : null,
      additionalLesson: p ? p.additionalLesson : null,
      lessonName: p ? p.lessonName : null,
      pageReference: p ? p.pageReference : null,
      imageKey: p ? p.imageKey : null,
      annotatedPages: p ? p.annotatedPages : null,
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

  // ==========================================================================
  // Original (printed) page numbers for para-based books (2026-11-06).
  // --------------------------------------------------------------------------
  // Saved lesson records keep their exact semantics: `page` is
  // PARA-RELATIVE and the resolver above is unchanged. What the student
  // sees in the printed mushaf, however, is a continuous ORIGINAL page
  // number. Each para entry in book.paras may carry an optional
  // `orig_start` — the original (printed) page number of that para's
  // FIRST page, anchored by the admin against the physical book (the
  // stored R2 filenames are positional/para-relative and do NOT carry
  // the printed number). When `orig_start` is absent it defaults to the
  // para's existing global `page_start`, so un-anchored books behave
  // exactly as "printed = global position" with zero migration.
  // Conversion: original = orig_start + (para-relative page - 1).
  // All lookups key off book.paras — NEVER the hardcoded registries
  // (QURAN_PARAS_INFO / QURAN_PARAS_LIST / defaultParaRange), whose
  // ranges match no real book. A para with no entry in book.paras
  // converts to null and callers fall back to the stored page display.
  // ==========================================================================
  function origParaEntry(book, paraNum) {
    if (!book || !Array.isArray(book.paras)) return null;
    var p = Number(paraNum);
    if (!Number.isFinite(p)) return null;
    for (var i = 0; i < book.paras.length; i++) {
      if (book.paras[i] && Number(book.paras[i].para) === p) return book.paras[i];
    }
    return null;
  }

  function origPositiveOrNull(v) {
    var n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  // Length of one para: the paras_data slice is authoritative where it
  // exists, then the entry's own total_pages, then its global range.
  function origParaLength(book, paraNum) {
    var p = Number(paraNum);
    if (book && book.paras_data) {
      if (Array.isArray(book.paras_data[p])) return book.paras_data[p].length;
      if (Array.isArray(book.paras_data[String(p)])) return book.paras_data[String(p)].length;
    }
    var entry = origParaEntry(book, paraNum);
    if (!entry) return null;
    var total = origPositiveOrNull(entry.total_pages);
    if (total !== null) return total;
    var start = origPositiveOrNull(entry.page_start);
    var end = origPositiveOrNull(entry.page_end);
    if (start !== null && end !== null && end >= start) return end - start + 1;
    return null;
  }

  // The original page number of a para's first page: the stored anchor
  // when present, else the para's global page_start (the default).
  function origStartFor(book, paraNum) {
    var entry = origParaEntry(book, paraNum);
    if (!entry) return null;
    var anchored = origPositiveOrNull(entry.orig_start);
    if (anchored !== null) return anchored;
    return origPositiveOrNull(entry.page_start);
  }

  // [firstOriginal, lastOriginal] for one para, or null when either end
  // cannot be determined from book.paras.
  function origRangeFor(book, paraNum) {
    var start = origStartFor(book, paraNum);
    var len = origParaLength(book, paraNum);
    if (start === null || len === null) return null;
    return [start, start + len - 1];
  }

  // Para-relative page -> original page number (null when out of the
  // para's original range or not convertible).
  function origPageFor(book, paraNum, relPage) {
    var rel = Number(relPage);
    if (!Number.isFinite(rel) || rel < 1) return null;
    var range = origRangeFor(book, paraNum);
    if (!range) return null;
    var orig = range[0] + rel - 1;
    return orig <= range[1] ? orig : null;
  }

  // Original page number -> para-relative page (null when the original
  // number lies outside this para's original range).
  function relPageForOrig(book, paraNum, orig) {
    var o = Number(orig);
    if (!Number.isFinite(o)) return null;
    var range = origRangeFor(book, paraNum);
    if (!range) return null;
    if (o < range[0] || o > range[1]) return null;
    return o - range[0] + 1;
  }

  // The book's last original page number (the "of N" total readers
  // show): the greatest original range end across book.paras.
  function lastOrigPageFor(book) {
    if (!book || !Array.isArray(book.paras) || book.paras.length === 0) return null;
    var last = null;
    for (var i = 0; i < book.paras.length; i++) {
      var range = origRangeFor(book, book.paras[i] && book.paras[i].para);
      if (range && (last === null || range[1] > last)) last = range[1];
    }
    return last;
  }

  // The orig_page a record itself stored, if any. New teacher writers
  // save `orig_page` additively in the lesson_notes payload; it may sit
  // on the entry (origPage / orig_page), on entry.raw as the payload
  // object or the notes string, or on the raw attendance row
  // ({ lesson_notes }). Returns null when the record predates the field.
  function storedOrigPageOf(entry) {
    if (!entry || typeof entry !== 'object') return null;
    var direct = toNumOrNull(entry.origPage != null ? entry.origPage : entry.orig_page);
    if (direct !== null) return direct;
    var raw = entry.raw;
    for (var depth = 0; depth < 3 && raw !== null && raw !== undefined; depth++) {
      if (typeof raw === 'string') {
        try { raw = JSON.parse(raw); } catch (e) { return null; }
        continue;
      }
      if (typeof raw === 'object') {
        var v = toNumOrNull(raw.orig_page != null ? raw.orig_page : raw.origPage);
        if (v !== null) return v;
        raw = raw.lesson_notes;
        continue;
      }
      return null;
    }
    return null;
  }

  // The original page number a history entry should DISPLAY: the
  // record's own stored orig_page when present, otherwise the number
  // converted from its stored (book, para, para-relative page) through
  // the book's anchors at render time. Null means "not convertible —
  // show the stored page as before" (flat books, missing book/para).
  function origPageForEntry(entry, availableBooks) {
    if (!entry) return null;
    var stored = storedOrigPageOf(entry);
    if (stored !== null) return stored;
    var page = toNumOrNull(entry.page);
    var para = toNumOrNull(entry.para);
    if (page === null || para === null || !entry.bookId) return null;
    var books = Array.isArray(availableBooks) ? availableBooks : [];
    var book = null;
    for (var i = 0; i < books.length; i++) {
      if (books[i] && books[i].id === entry.bookId) { book = books[i]; break; }
    }
    if (!book) return null;
    return origPageFor(book, para, page);
  }

  var origPagesApi = {
    origStartFor: origStartFor,
    origRangeFor: origRangeFor,
    origPageFor: origPageFor,
    relPageForOrig: relPageForOrig,
    lastOrigPageFor: lastOrigPageFor,
    origPageForEntry: origPageForEntry
  };

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

  // ---------------------------------------------------------------
  // Annotated pages viewer (read-only; shared by Teacher history,
  // Parent lesson cards and the Admin/Manager Student 360). Shows a
  // lesson's saved annotated page images in seq order with captions
  // carrying the ORIGINAL page number from the record itself (no book
  // lookup), prev/next + keyboard navigation, and layout zoom in the
  // viewer's own scroll stage using the safe-centre pattern (the
  // zoomed page's top stays reachable — the PR #95/#98 reader fix,
  // applied to this overlay only; reader globals are untouched). The
  // record's legacy single image, when present, is shown first as
  // "Lesson image". Images load through loadLessonImageBlobUrl
  // (authenticated fetch) — never a raw storage URL — and every blob
  // URL is revoked on close. A page that fails to load shows an error
  // in place; the other pages stay navigable. No editing is possible.
  // ---------------------------------------------------------------
  var _apv = null; // { items, idx, zoomIdx, baseW, urls, cache, els }

  function annotatedPageCaption(entry, position) {
    if (!entry) return '';
    if (entry.origPage !== null && entry.origPage !== undefined && entry.origPage !== '') return 'Page ' + entry.origPage;
    if (entry.page !== null && entry.page !== undefined && entry.page !== '') return 'Page ' + entry.page;
    return 'Page ' + ((position || 0) + 1);
  }

  function _apvEl(tag, cssText, text) {
    var el = document.createElement(tag);
    if (cssText) el.style.cssText = cssText;
    if (text !== undefined && text !== null) el.textContent = text;
    return el;
  }

  function _apvApplyZoom() {
    if (!_apv) return;
    var steps = [1, 1.5, 2, 2.5, 3];
    var z = steps[_apv.zoomIdx] || 1;
    var img = _apv.els.img;
    _apv.els.zoomLabel.textContent = Math.round(z * 100) + '%';
    if (z <= 1) {
      img.style.width = '';
      img.style.maxWidth = '100%';
    } else {
      var base = _apv.baseW || img.clientWidth || img.naturalWidth || 0;
      if (base > 0) {
        img.style.maxWidth = 'none';
        img.style.width = Math.round(base * z) + 'px';
      }
    }
  }

  function _apvShow(idx) {
    if (!_apv) return;
    var items = _apv.items;
    var i = Math.max(0, Math.min(items.length - 1, idx));
    _apv.idx = i;
    _apv.zoomIdx = 0;
    _apv.baseW = 0;
    var item = items[i];
    var els = _apv.els;
    els.counter.textContent = (i + 1) + ' / ' + items.length;
    els.caption.textContent = item.caption;
    els.prev.disabled = i <= 0;
    els.next.disabled = i >= items.length - 1;
    els.prev.style.opacity = i <= 0 ? '0.4' : '1';
    els.next.style.opacity = i >= items.length - 1 ? '0.4' : '1';
    els.img.style.display = 'none';
    els.msg.style.display = '';
    els.msg.textContent = 'Loading page…';
    _apvApplyZoom();
    var finish = function (url) {
      if (!_apv || _apv.idx !== i) return;
      if (!url) {
        els.msg.textContent = 'This page could not be loaded. Use Prev / Next to view the other pages.';
        return;
      }
      els.img.onload = function () {
        if (!_apv || _apv.idx !== i) return;
        _apv.baseW = els.img.clientWidth || 0;
        els.msg.style.display = 'none';
        els.img.style.display = '';
        _apvApplyZoom();
      };
      els.img.onerror = function () {
        if (!_apv || _apv.idx !== i) return;
        els.msg.style.display = '';
        els.msg.textContent = 'This page could not be loaded. Use Prev / Next to view the other pages.';
      };
      els.img.src = url;
    };
    if (_apv.cache[i]) { finish(_apv.cache[i]); return; }
    loadLessonImageBlobUrl(item.key).then(function (url) {
      if (url && _apv) _apv.cache[i] = url;
      finish(url);
    }).catch(function () { finish(null); });
  }

  function _apvNav(dir) {
    if (!_apv) return;
    _apvShow(_apv.idx + (dir < 0 ? -1 : 1));
  }

  function _apvKeyHandler(ev) {
    if (!_apv) return;
    var t = ev && ev.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (ev.key === 'Escape') closeAnnotatedPagesViewer();
    else if (ev.key === 'ArrowRight') _apvNav(1);
    else if (ev.key === 'ArrowLeft') _apvNav(-1);
  }

  function openAnnotatedPagesViewer(pages, opts) {
    opts = opts || {};
    var items = [];
    if (opts.imageKey) items.push({ key: String(opts.imageKey), caption: 'Lesson image' });
    var list = normalizeAnnotatedPages(pages) || [];
    list.forEach(function (p, i) {
      items.push({ key: p.key, caption: annotatedPageCaption(p, i) });
    });
    if (!items.length) return false;
    if (typeof document === 'undefined' || !document.body || !document.createElement) return false;
    closeAnnotatedPagesViewer();

    var btnCss = 'background:#065f46;color:#fff;border:1px solid #047857;border-radius:9px;padding:7px 14px;font-size:12px;font-weight:800;cursor:pointer;';
    var overlay = _apvEl('div', 'position:fixed;inset:0;z-index:130;background:rgba(2,6,23,0.94);display:flex;flex-direction:column;font-family:inherit;');
    var header = _apvEl('div', 'display:flex;align-items:center;gap:10px;padding:10px 14px;background:#022c22;color:#fff;');
    var titleEl = _apvEl('div', 'flex:1;font-size:13px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;', opts.title || 'Annotated pages');
    var counterEl = _apvEl('div', 'font-size:12px;font-weight:700;color:#a7f3d0;');
    var closeBtn = _apvEl('button', btnCss, '✕ Close');
    closeBtn.type = 'button';
    closeBtn.addEventListener('click', function () { closeAnnotatedPagesViewer(); });
    header.appendChild(titleEl);
    header.appendChild(counterEl);
    header.appendChild(closeBtn);

    var stage = _apvEl('div', 'flex:1;overflow:auto;display:flex;align-items:safe center;justify-content:safe center;padding:14px;');
    var img = _apvEl('img', 'max-width:100%;height:auto;border-radius:10px;background:#fff;display:none;');
    img.alt = 'Annotated lesson page';
    var msg = _apvEl('div', 'color:#e2e8f0;font-size:13px;font-weight:600;text-align:center;max-width:420px;', 'Loading page…');
    stage.appendChild(img);
    stage.appendChild(msg);

    var footer = _apvEl('div', 'display:flex;align-items:center;justify-content:center;gap:10px;padding:10px;background:#022c22;flex-wrap:wrap;');
    var prevBtn = _apvEl('button', btnCss, '‹ Prev');
    prevBtn.type = 'button';
    prevBtn.addEventListener('click', function () { _apvNav(-1); });
    var captionEl = _apvEl('div', 'min-width:90px;text-align:center;color:#fde68a;font-size:13px;font-weight:800;');
    var zoomOutBtn = _apvEl('button', btnCss, '−');
    zoomOutBtn.type = 'button';
    zoomOutBtn.addEventListener('click', function () { if (_apv && _apv.zoomIdx > 0) { _apv.zoomIdx--; _apvApplyZoom(); } });
    var zoomLabel = _apvEl('div', 'color:#d1fae5;font-size:12px;font-weight:700;min-width:44px;text-align:center;', '100%');
    var zoomInBtn = _apvEl('button', btnCss, '+');
    zoomInBtn.type = 'button';
    zoomInBtn.addEventListener('click', function () { if (_apv && _apv.zoomIdx < 4) { _apv.zoomIdx++; _apvApplyZoom(); } });
    var nextBtn = _apvEl('button', btnCss, 'Next ›');
    nextBtn.type = 'button';
    nextBtn.addEventListener('click', function () { _apvNav(1); });
    footer.appendChild(prevBtn);
    footer.appendChild(captionEl);
    footer.appendChild(zoomOutBtn);
    footer.appendChild(zoomLabel);
    footer.appendChild(zoomInBtn);
    footer.appendChild(nextBtn);

    overlay.appendChild(header);
    overlay.appendChild(stage);
    overlay.appendChild(footer);
    document.body.appendChild(overlay);
    if (document.addEventListener) document.addEventListener('keydown', _apvKeyHandler);

    _apv = {
      items: items, idx: 0, zoomIdx: 0, baseW: 0, cache: {},
      els: { overlay: overlay, img: img, msg: msg, counter: counterEl, caption: captionEl, prev: prevBtn, next: nextBtn, zoomLabel: zoomLabel }
    };
    _apvShow(0);
    return true;
  }

  function closeAnnotatedPagesViewer() {
    if (!_apv) return;
    var state = _apv;
    _apv = null;
    Object.keys(state.cache).forEach(function (k) { try { URL.revokeObjectURL(state.cache[k]); } catch (e) {} });
    if (typeof document !== 'undefined' && document.removeEventListener) document.removeEventListener('keydown', _apvKeyHandler);
    var ov = state.els && state.els.overlay;
    if (ov) {
      if (typeof ov.remove === 'function') ov.remove();
      else if (ov.parentNode && ov.parentNode.removeChild) ov.parentNode.removeChild(ov);
    }
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
    origStartFor: origStartFor,
    origRangeFor: origRangeFor,
    origPageFor: origPageFor,
    relPageForOrig: relPageForOrig,
    lastOrigPageFor: lastOrigPageFor,
    origPageForEntry: origPageForEntry,
    lessonPageReasonMessage: lessonPageReasonMessage,
    entryTitle: entryTitle,
    getLessonHistory: getLessonHistory,
    uploadLessonImageOrThrow: uploadLessonImageOrThrow,
    loadLessonImageBlobUrl: loadLessonImageBlobUrl,
    openAnnotatedPagesViewer: openAnnotatedPagesViewer,
    closeAnnotatedPagesViewer: closeAnnotatedPagesViewer,
    annotatedPageCaption: annotatedPageCaption,
    normalizeAnnotatedPages: normalizeAnnotatedPages
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.LessonHistory = api;
  global.OrigPages = origPagesApi;
})(typeof window !== 'undefined' ? window : globalThis);

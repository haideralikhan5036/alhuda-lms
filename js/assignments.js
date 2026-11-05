// ============================================================================
// Student Assignments ledger (Phase 2 PR-A — 2026-11-03)
// ----------------------------------------------------------------------------
// Dated student→teacher→course assignment history in the D1 table
// `student_assignments`. Rows are OPENED by the normal admin flows (Add
// Student, trial conversion, shift, 360 edit, reactivation) and CLOSED by
// setting end_date + end_reason — never deleted (the Worker denies
// deletes for every role; teachers/parents have no access at all).
//
// Every write here is fire-and-forget and fully guarded: a failed ledger
// write must never break the student save that triggered it. The payroll
// engine (PR-B) reads real rows where they exist and falls back to
// deriveFor() — a synthetic assignment built from the student's CURRENT
// record — for students who have no rows yet, so no bulk backfill write
// to live data ever happens; real rows take over organically as records
// are edited through the hooked flows.
// ============================================================================
(function () {
  'use strict';

  var _cache = null; // null = not loaded yet; otherwise an array of rows

  function todayStr() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function dayBefore(dateStr) {
    var d = new Date(String(dateStr || '') + 'T00:00:00');
    if (isNaN(d.getTime())) return todayStr();
    d.setDate(d.getDate() - 1);
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function genId() {
    return 'ASG-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 8).toUpperCase();
  }

  function currentUserLabel() {
    try {
      return (typeof CURRENT_USER_NAME !== 'undefined' && CURRENT_USER_NAME) ||
        (typeof CURRENT_USERNAME !== 'undefined' && CURRENT_USERNAME) || null;
    } catch (e) { return null; }
  }

  function hasDb() {
    try { return typeof db !== 'undefined' && !!db; } catch (e) { return false; }
  }

  function loadAll() {
    if (!hasDb()) { _cache = []; return Promise.resolve(_cache); }
    return Promise.resolve(db.from('student_assignments').select('*'))
      .then(function (res) {
        if (res && !res.error && Array.isArray(res.data)) {
          _cache = res.data;
        } else if (_cache === null) {
          _cache = [];
        }
        try { window.ALL_ASSIGNMENTS = _cache; } catch (e) {}
        return _cache;
      })
      .catch(function () {
        if (_cache === null) _cache = [];
        return _cache;
      });
  }

  function openRowsFor(studentId) {
    return (_cache || []).filter(function (r) {
      return String(r.student_id) === String(studentId) && !r.end_date;
    });
  }

  // ------------------------------------------------------------------
  // Commission #2 Phase 3 (2026-11-05): the cross-portal consistency
  // stamp. Teachers cannot read this ledger (the Worker denies it), so
  // the teacher portal compiles from DERIVED periods — a Phase 2 end
  // recorded only here would be invisible there and the two portals
  // would disagree. endAssignment therefore ALSO stamps the student
  // record: `assignment_end_date` (+ reason) merged into the student's
  // notes JSON, which the payroll engine honours as a segment bound in
  // every compile (js/payroll.js assignmentSegmentProration). The
  // ledger close remains the system of record; the stamp is its
  // student-visible mirror. open() clears the stamp when a fresh
  // segment is created, so a re-booking restarts accrual cleanly.
  // Both helpers are fire-and-forget and fully guarded: a failed stamp
  // write must never break the ledger action that triggered it.
  // ------------------------------------------------------------------
  function findLoadedStudent(studentId) {
    try {
      var list = (typeof window !== 'undefined' && window.ALL_STUDENTS) || [];
      for (var i = 0; i < list.length; i++) {
        if (list[i] && String(list[i].id) === String(studentId)) return list[i];
      }
    } catch (e) {}
    return null;
  }

  function parseStudentNotes(stu) {
    if (!stu) return {};
    if (stu.notes && typeof stu.notes === 'string') {
      // Legacy free-text notes (non-JSON) are preserved under `text`,
      // the same defence js/leaves.js uses — a stamp merge must never
      // silently drop the original note text.
      try { return JSON.parse(stu.notes) || {}; } catch (e) { return { text: stu.notes }; }
    }
    if (stu.notes && typeof stu.notes === 'object') return Object.assign({}, stu.notes);
    return {};
  }

  function writeStudentNotes(studentId, notesObj) {
    try {
      if (!hasDb()) return;
      var notesStr = JSON.stringify(notesObj);
      var stu = findLoadedStudent(studentId);
      if (stu) stu.notes = notesStr;
      Promise.resolve(db.from('students').update({ notes: notesStr }).eq('id', String(studentId)))
        .catch(function () {});
    } catch (e) {}
  }

  function stampStudentAssignmentEnd(studentId, endDateStr, reason) {
    try {
      if (!endDateStr) return;
      var stu = findLoadedStudent(studentId);
      if (stu) {
        var notes = parseStudentNotes(stu);
        notes.assignment_end_date = String(endDateStr).slice(0, 10);
        notes.assignment_end_reason = reason || null;
        writeStudentNotes(studentId, notes);
        return;
      }
      // Student record not loaded in this session: fall back to a db
      // read, and stamp ONLY when a current notes value actually comes
      // back (a row carrying the notes key) — never overwrite blind.
      if (!hasDb()) return;
      Promise.resolve(db.from('students').select('notes').eq('id', String(studentId)))
        .then(function (res) {
          if (!res || res.error || !Array.isArray(res.data) || !res.data.length) return;
          var row = res.data[0];
          if (!row || !('notes' in row)) return;
          var merged = parseStudentNotes(row);
          merged.assignment_end_date = String(endDateStr).slice(0, 10);
          merged.assignment_end_reason = reason || null;
          try {
            Promise.resolve(db.from('students').update({ notes: JSON.stringify(merged) }).eq('id', String(studentId)))
              .catch(function () {});
          } catch (e) {}
        })
        .catch(function () {});
    } catch (e) {}
  }

  function clearStudentAssignmentEndStamp(studentId) {
    try {
      var stu = findLoadedStudent(studentId);
      if (!stu) return;
      var notes = parseStudentNotes(stu);
      // Only act when the loaded record actually carries the stamp.
      if (!notes.assignment_end_date && !stu.assignment_end_date) return;
      delete notes.assignment_end_date;
      delete notes.assignment_end_reason;
      writeStudentNotes(studentId, notes);
    } catch (e) {}
  }

  // Open a new assignment row. Skips when an identical open row already
  // exists (double-saves, repeat modal opens) — the ledger records
  // periods, not clicks.
  function open(opts) {
    try {
      opts = opts || {};
      if (!opts.student_id || !opts.teacher_id) return Promise.resolve(false);
      var start = opts.start_date || todayStr();
      var dup = openRowsFor(opts.student_id).some(function (r) {
        return String(r.teacher_id) === String(opts.teacher_id) &&
          String(r.course_name || '') === String(opts.course_name || '');
      });
      if (dup) return Promise.resolve(false);
      // Commission #2 Phase 1: a segment may carry its slot count
      // (opts.slots — schedule duration changes record it so the
      // segment prices by its own slots, not by today's schedule).
      // The key is included only when a valid value is supplied, so
      // every existing caller's insert is byte-identical to before.
      var slotsVal = parseFloat(opts.slots);
      var hasSlots = !isNaN(slotsVal) && slotsVal > 0;
      var row = {
        id: genId(),
        student_id: String(opts.student_id),
        teacher_id: String(opts.teacher_id),
        course_id: opts.course_id || null,
        course_name: opts.course_name || null,
        start_date: start,
        end_date: null,
        end_reason: null,
        created_by: opts.created_by || currentUserLabel()
      };
      if (hasSlots) row.slots = slotsVal;
      if (_cache) _cache.push(row);
      // Phase 3: a fresh segment restarts accrual — clear any
      // assignment-end stamp a previous end left on the student
      // record. Runs only on this path (a row is actually being
      // created), never on the duplicate-guard return above, so the
      // stop flows that MATERIALISE a segment and then end it
      // (open() first, endAssignment() second — the Phase 2 order in
      // the 360 action and the schedule-delete hook) still finish
      // stamped: this clear is initiated and applied to the loaded
      // record synchronously here, strictly before any later
      // endAssignment call can stamp again.
      clearStudentAssignmentEndStamp(opts.student_id);
      if (!hasDb()) return Promise.resolve(true);
      return Promise.resolve(db.from('student_assignments').insert(row))
        .then(function (res) {
          if (res && res.error && hasSlots) {
            // The slots column arrives with schema v5, which deploys
            // in a later batch than this frontend: until then the live
            // Worker rejects the unknown column. Retry WITHOUT the new
            // field so the ledger write itself never starts failing
            // (the in-cache row keeps its slots for this session, and
            // the compile falls back to computing slots live).
            var bare = Object.assign({}, row);
            delete bare.slots;
            return Promise.resolve(db.from('student_assignments').insert(bare))
              .then(function (res2) { return !(res2 && res2.error); })
              .catch(function () { return false; });
          }
          return !(res && res.error);
        })
        .catch(function () { return false; });
    } catch (e) { return Promise.resolve(false); }
  }

  // Close every open row for a student (optionally sparing one teacher's
  // row). Closing writes end_date + end_reason; rows are never deleted.
  function closeCurrent(studentId, opts) {
    try {
      opts = opts || {};
      var end = opts.end_date || todayStr();
      var rows = openRowsFor(studentId).filter(function (r) {
        return !opts.except_teacher_id || String(r.teacher_id) !== String(opts.except_teacher_id);
      });
      rows.forEach(function (r) { r.end_date = end; r.end_reason = opts.end_reason || 'closed'; });
      if (!hasDb() || !rows.length) return Promise.resolve(rows.length);
      return Promise.all(rows.map(function (r) {
        return Promise.resolve(db.from('student_assignments')
          .update({ end_date: r.end_date, end_reason: r.end_reason })
          .eq('id', r.id))
          .then(function (res) { return !(res && res.error); })
          .catch(function () { return false; });
      })).then(function () { return rows.length; });
    } catch (e) { return Promise.resolve(0); }
  }

  // Commission #2 Phase 2 (2026-11-05): the named stop-accrual action
  // (audit §3.3, owner decision D6). Closes the student's open
  // assignment period with end_date = the LAST PAYABLE DAY — the
  // engine's proration treats end_date inclusively, so salary
  // continues up to and including that day and stops from the next.
  // With opts.teacher_id, only that teacher's open rows close;
  // without it, every open row closes (delegated to closeCurrent,
  // which stays the single writer for the unscoped case and is
  // itself untouched). Resolves to the number of rows closed.
  function endAssignment(studentId, opts) {
    try {
      opts = opts || {};
      var end = opts.last_payable_date || todayStr();
      var reason = opts.end_reason || 'schedule_ended';
      // Phase 3 consistency stamp: mirror this end onto the student
      // record so the teacher portal's derived compile stops on the
      // same day — but only when this end leaves the student with NO
      // open segment at all. A teacher-scoped end while another
      // teacher's segment stays open must not bound that segment.
      var remainingOpen = opts.teacher_id
        ? openRowsFor(studentId).filter(function (r) { return String(r.teacher_id) !== String(opts.teacher_id); })
        : [];
      if (!remainingOpen.length) stampStudentAssignmentEnd(studentId, end, reason);
      if (!opts.teacher_id) {
        return closeCurrent(studentId, { end_date: end, end_reason: reason });
      }
      var rows = openRowsFor(studentId).filter(function (r) {
        return String(r.teacher_id) === String(opts.teacher_id);
      });
      rows.forEach(function (r) { r.end_date = end; r.end_reason = reason; });
      if (!hasDb() || !rows.length) return Promise.resolve(rows.length);
      return Promise.all(rows.map(function (r) {
        return Promise.resolve(db.from('student_assignments')
          .update({ end_date: r.end_date, end_reason: r.end_reason })
          .eq('id', r.id))
          .then(function (res) { return !(res && res.error); })
          .catch(function () { return false; });
      })).then(function () { return rows.length; });
    } catch (e) { return Promise.resolve(0); }
  }

  // Transfer / course change: close the current period the day BEFORE the
  // new one starts, then open the new period. This is what makes a month
  // split cleanly between two teachers (or two courses) in the engine.
  function transition(opts) {
    opts = opts || {};
    var start = opts.start_date || todayStr();
    return closeCurrent(opts.student_id, {
      end_date: dayBefore(start),
      end_reason: opts.end_reason || 'transferred',
      except_teacher_id: null
    }).then(function () {
      return open({
        student_id: opts.student_id,
        teacher_id: opts.teacher_id,
        course_name: opts.course_name,
        course_id: opts.course_id || null,
        slots: opts.slots,
        start_date: start,
        created_by: opts.created_by || null
      });
    });
  }

  function studentCourseName(student) {
    if (!student) return '';
    var name = '';
    if (student.notes) {
      try {
        var n = typeof student.notes === 'string' ? JSON.parse(student.notes) : student.notes;
        name = (n && (n.course_name || n.course || n.trial_course)) || '';
      } catch (e) {}
    }
    if (!name && student.course_id && typeof student.course_id === 'string' && !/^[0-9a-f-]{20,}$/i.test(student.course_id)) {
      name = student.course_id;
    }
    return String(name || '');
  }

  // Synthetic assignments for students with NO real rows: one open period
  // from the student's joining date under their current teacher + course.
  // The engine additionally bounds eligibility by the student's own
  // joining/deactivation dates (as today's proration does), so the
  // synthetic row only supplies WHO + WHICH COURSE + FROM WHEN.
  function deriveFor(students, realRows, schedules) {
    var withReal = {};
    (realRows || _cache || []).forEach(function (r) { withReal[String(r.student_id)] = true; });
    var out = [];
    var derivedForStudent = {};
    (students || []).forEach(function (s) {
      if (!s || !s.id || withReal[String(s.id)]) return;
      if (String(s.status || '').toLowerCase() === 'trial') return;
      var start = null;
      if (s.joining_date) start = String(s.joining_date).slice(0, 10);
      else if (s.created_at) start = String(s.created_at).slice(0, 10);
      if (s.assigned_teacher_id) {
        var open = {
          id: 'DERIVED-' + s.id,
          student_id: String(s.id),
          teacher_id: String(s.assigned_teacher_id),
          course_id: null,
          course_name: studentCourseName(s) || null,
          start_date: start,
          end_date: null,
          end_reason: null,
          synthetic: true
        };
        out.push(open);
        derivedForStudent[String(s.id)] = open;
        return;
      }
      // Deactivated with no current teacher: a CLOSED synthetic period
      // to the teacher held before deactivation, ending on the
      // deactivation date — the final month's claim, exactly bounded
      // (the old payroll union claimed it with no end date at all).
      var notes = {};
      try { notes = typeof s.notes === 'string' ? (JSON.parse(s.notes) || {}) : (s.notes || {}); } catch (e) { notes = {}; }
      var prevTeacher = s.previous_teacher_id_before_deactivation || notes.previous_teacher_id_before_deactivation || null;
      var deactDate = s.deactivation_date || notes.deactivation_date || null;
      if (prevTeacher && deactDate && /^\d{4}-\d{2}-\d{2}/.test(String(deactDate))) {
        var closed = {
          id: 'DERIVED-PREV-' + s.id,
          student_id: String(s.id),
          teacher_id: String(prevTeacher),
          course_id: null,
          course_name: studentCourseName(s) || null,
          start_date: start,
          end_date: String(deactDate).slice(0, 10),
          end_reason: 'deactivated',
          synthetic: true
        };
        out.push(closed);
        derivedForStudent[String(s.id)] = closed;
      }
    });
    // Schedule-only legacy links: no assigned teacher and no derived
    // period, but the student sits in a teacher's schedule.
    (schedules || []).forEach(function (sch) {
      if (!sch || !sch.student_id || !sch.teacher_id) return;
      var stu = null;
      (students || []).forEach(function (s) { if (String(s.id) === String(sch.student_id)) stu = s; });
      if (!stu || withReal[String(stu.id)] || derivedForStudent[String(stu.id)]) return;
      if (stu.assigned_teacher_id) return;
      if (String(stu.status || '').toLowerCase() === 'trial') return;
      var start = null;
      if (stu.joining_date) start = String(stu.joining_date).slice(0, 10);
      else if (stu.created_at) start = String(stu.created_at).slice(0, 10);
      var row = {
        id: 'DERIVED-SCHED-' + stu.id,
        student_id: String(stu.id),
        teacher_id: String(sch.teacher_id),
        course_id: null,
        course_name: studentCourseName(stu) || null,
        start_date: start,
        end_date: null,
        end_reason: null,
        synthetic: true
      };
      out.push(row);
      derivedForStudent[String(stu.id)] = row;
    });
    return out;
  }

  window.Assignments = {
    loadAll: loadAll,
    open: open,
    closeCurrent: closeCurrent,
    endAssignment: endAssignment,
    transition: transition,
    deriveFor: deriveFor,
    studentCourseName: studentCourseName,
    todayStr: todayStr,
    dayBefore: dayBefore
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { loadAll(); });
  } else {
    loadAll();
  }
})();

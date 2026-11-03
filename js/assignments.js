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
      if (_cache) _cache.push(row);
      if (!hasDb()) return Promise.resolve(true);
      return Promise.resolve(db.from('student_assignments').insert(row))
        .then(function (res) { return !(res && res.error); })
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

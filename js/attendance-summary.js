// ============================================================================
// Student attendance summary (Batch C1) — ONE canonical calculation shared
// by the 360 student workspace (history strip + Progress Report tab).
//
// Source of truth: attendance_logs rows (already deduped upstream by
// LessonHistory.dedupeLessonRows — a re-saved lesson counts once).
// Status mapping (established by js/lesson-history.js + parent.html):
//   attended = 'Completed' (what teachers store for a held class) or
//              'Present' (legacy value, still counted).
//   absent   = 'Absent'; leave = 'Leave'.
// Eligibility: only FINAL session outcomes count. 'Running' / 'Waiting'
// (a class in progress or not yet started) and 'Reschedule' (the class
// moved — its replacement session gets its own row) are excluded, so a
// class is never counted twice and an unfinished class is never counted
// as missed.
// Leave policy (established, NOT invented here): every existing
// calculation in the app (360 strip, teacher rate, parent portal) puts
// approved leave in the denominator, i.e.
//   percentage = Present / (Present + Absent + Leave) * 100.
// The three counts are always shown alongside the percentage so the
// maths reconciles at a glance.
// Zero denominator: percentage is null (rendered as '—' with a
// "No eligible classes" note) — never NaN, Infinity, or a misleading 0%
// or 100%.
// Month filtering: log.date is a PKT-stamped 'YYYY-MM-DD' string, so a
// log belongs to a month by its first 7 characters. No timezone
// conversion is needed or applied.
// Pure module: no DOM, no network. Loaded as a classic script before
// js/profiles360.js; also loaded in a vm by the test suite.
// ============================================================================
(function () {
  'use strict';

  var MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  function normStatus(s) {
    return String(s == null ? '' : s).trim().toLowerCase();
  }

  function isAttendedStatus(s) {
    s = normStatus(s);
    return s === 'completed' || s === 'present';
  }

  // logs: attendance_logs rows (deduped by the caller). yearMonth:
  // 'YYYY-MM'. Returns { present, absent, leave, eligible, percentage }.
  function summarize(logs, yearMonth) {
    var present = 0, absent = 0, leave = 0;
    if (!yearMonth) return { present: 0, absent: 0, leave: 0, eligible: 0, percentage: null };
    (Array.isArray(logs) ? logs : []).forEach(function (l) {
      if (!l || typeof l.date !== 'string' || l.date.slice(0, 7) !== yearMonth) return;
      var s = normStatus(l.status);
      if (s === 'completed' || s === 'present') present++;
      else if (s === 'absent') absent++;
      else if (s === 'leave') leave++;
      // Anything else (Running / Waiting / Reschedule / unknown) is not
      // a final session outcome and is excluded from every count.
    });
    var eligible = present + absent + leave;
    return {
      present: present,
      absent: absent,
      leave: leave,
      eligible: eligible,
      percentage: eligible > 0 ? Math.round((present / eligible) * 100) : null
    };
  }

  // Current month in Asia/Karachi (the academy's timezone), 'YYYY-MM'.
  // Same Intl pattern as js/config.js's PKT clock.
  function currentPktMonth() {
    try {
      var parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit'
      }).formatToParts(new Date());
      var y = '', m = '';
      parts.forEach(function (p) {
        if (p.type === 'year') y = p.value;
        if (p.type === 'month') m = p.value;
      });
      if (y && m) return y + '-' + m;
    } catch (e) { /* fall through to local date */ }
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  // 'YYYY-MM' -> 'Month YYYY' (e.g. '2026-10' -> 'October 2026'), or the
  // input back when it does not parse.
  function labelOfMonth(yearMonth) {
    if (typeof yearMonth !== 'string') return yearMonth;
    var m = yearMonth.match(/^(\d{4})-(\d{1,2})$/);
    if (!m) return yearMonth;
    var mo = parseInt(m[2], 10);
    if (mo < 1 || mo > 12) return yearMonth;
    return MONTH_NAMES[mo - 1] + ' ' + m[1];
  }

  window.AttendanceSummary = {
    summarize: summarize,
    currentPktMonth: currentPktMonth,
    labelOfMonth: labelOfMonth,
    isAttendedStatus: isAttendedStatus
  };
})();

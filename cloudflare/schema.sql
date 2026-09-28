-- ============================================================================
-- AL-HUDA ISLAMIC CENTRE LMS — CLOUDFLARE D1 (SQLite) DATABASE SCHEMA
-- Automatically applied by functions/api/db.js or via Wrangler D1
-- ============================================================================

CREATE TABLE IF NOT EXISTS families (
  id TEXT PRIMARY KEY,
  parent_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  whatsapp TEXT,
  country TEXT DEFAULT 'United Kingdom',
  timezone TEXT DEFAULT 'Europe/London',
  currency TEXT DEFAULT 'GBP',
  monthly_fee REAL DEFAULT 0,
  billing_day INTEGER DEFAULT 1,
  status TEXT DEFAULT 'Active',
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS teachers (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  father_name TEXT,
  phone TEXT,
  cnic TEXT,
  email TEXT,
  address TEXT,
  witness_name TEXT,
  witness_phone TEXT,
  working_shift TEXT DEFAULT '10 Hours Shift (02:00 PM - 12:00 AM PKT)',
  rate_per_slot REAL DEFAULT 2200,
  joining_date TEXT,
  zoom_link TEXT,
  status TEXT DEFAULT 'Active',
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS students (
  id TEXT PRIMARY KEY,
  family_id TEXT,
  name TEXT NOT NULL,
  age INTEGER DEFAULT 8,
  gender TEXT DEFAULT 'Male',
  course_id TEXT DEFAULT 'Nazra Quran',
  assigned_teacher_id TEXT,
  joining_date TEXT,
  days_per_week TEXT DEFAULT '5 Days (Mon-Fri)',
  status TEXT DEFAULT 'Active',
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS class_schedules (
  id TEXT PRIMARY KEY,
  student_id TEXT,
  teacher_id TEXT,
  day_of_week INTEGER NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  duration_mins INTEGER DEFAULT 30,
  course_name TEXT,
  meeting_link TEXT,
  status TEXT DEFAULT 'Active',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS attendance_logs (
  id TEXT PRIMARY KEY,
  schedule_id TEXT,
  student_id TEXT,
  teacher_id TEXT,
  class_date TEXT NOT NULL,
  status TEXT NOT NULL,
  remarks TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  family_id TEXT,
  amount REAL DEFAULT 0,
  currency TEXT DEFAULT 'GBP',
  payment_month TEXT,
  payment_date TEXT,
  payment_method TEXT DEFAULT 'Bank Transfer',
  status TEXT DEFAULT 'Paid',
  receipt_url TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id TEXT PRIMARY KEY,
  teacher_id TEXT,
  student_id TEXT,
  leave_date TEXT,
  end_date TEXT,
  reason TEXT,
  status TEXT DEFAULT 'Pending',
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS trial_students (
  id TEXT PRIMARY KEY,
  student_id TEXT,
  family_id TEXT,
  student_name TEXT,
  student_age INTEGER,
  student_gender TEXT,
  parent_name TEXT,
  whatsapp TEXT,
  country TEXT,
  timezone TEXT,
  course TEXT,
  teacher_id TEXT,
  trial_date TEXT,
  trial_time TEXT,
  zoom_link TEXT,
  status TEXT DEFAULT 'Scheduled',
  feedback TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS system_settings (
  id TEXT PRIMARY KEY,
  key TEXT UNIQUE,
  value TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_students_family ON students(family_id);
CREATE INDEX IF NOT EXISTS idx_students_teacher ON students(assigned_teacher_id);
CREATE INDEX IF NOT EXISTS idx_schedules_teacher ON class_schedules(teacher_id);
CREATE INDEX IF NOT EXISTS idx_schedules_student ON class_schedules(student_id);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance_logs(class_date);
CREATE INDEX IF NOT EXISTS idx_attendance_student ON attendance_logs(student_id);
CREATE INDEX IF NOT EXISTS idx_payments_family ON payments(family_id);

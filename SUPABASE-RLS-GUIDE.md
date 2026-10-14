# Supabase RLS Guide — Al-Huda LMS

**Read this first:** the LMS now runs on **Cloudflare D1 + R2** (see `js/cloudflare-db.js`).
Supabase is no longer used by the app. The old Supabase project
(`ldgzuyroejzrvktksugy.supabase.co`) may still exist, and its publishable key
was previously hardcoded in the portal pages. Follow the steps below **only if
that Supabase project is still live**. If you already deleted the project,
you can ignore this file.

## Why this matters

A Supabase "publishable" key is safe to expose **only** when Row Level
Security (RLS) is switched on with deny-by-default policies. Without RLS,
anyone holding the old key can read and write every table directly,
bypassing all the login security added in Phase 1/2.

## Option A (recommended): shut the old project down

1. Open [supabase.com](https://supabase.com) → your project.
2. Go to **Settings → General → Delete project**.
3. Type the project name to confirm.

This is the cleanest option — the app does not need Supabase at all.

## Option B: keep the project, lock it down

Run the steps below in **SQL Editor → New query** in the Supabase dashboard.
They turn RLS on for every LMS table and create **zero** permissive policies,
which means: all access through the Supabase API is denied by default. The
app keeps working because it uses Cloudflare D1, not Supabase.

```sql
-- 1. Enable RLS (deny-by-default) on every LMS table.
--    Repeat for any extra tables you see in Table Editor.
ALTER TABLE families          ENABLE ROW LEVEL SECURITY;
ALTER TABLE students          ENABLE ROW LEVEL SECURITY;
ALTER TABLE teachers          ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_schedules   ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_logs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_requests    ENABLE ROW LEVEL SECURITY;
ALTER TABLE trial_students    ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_settings   ENABLE ROW LEVEL SECURITY;

-- 2. Remove any permissive policies left over from development, e.g.:
--    DROP POLICY IF EXISTS "public read" ON families;
--    (Check: Authentication → Policies. Every table should show
--     "No policies created" after this.)
```

### Verify it worked

```sql
-- Every LMS table should return t (RLS on). Any f = fix it with the
-- ALTER TABLE above.
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

-- Policies should be empty (deny-by-default).
SELECT tablename, policyname
FROM pg_policies
WHERE schemaname = 'public';
```

### Also rotate the old key

1. **Settings → API → API Keys**: roll/regenerate the `publishable` key.
2. The portal pages no longer contain any Supabase key (removed 2026-10-14),
   so rotation breaks nothing.

## What "done" looks like

- [ ] Old project deleted (Option A), **or** RLS enabled on all tables with no permissive policies (Option B).
- [ ] Old publishable key rotated.
- [ ] Verification queries above show `rowsecurity = t` on every table and no policies.

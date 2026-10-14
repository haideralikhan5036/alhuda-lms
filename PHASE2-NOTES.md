# PHASE 2 — P1 Hardening Notes (staged 2026-10-14, not pushed)

Staged files (in this directory):
- `worker.js` — the hardened worker with per-role scoping + password hashing.
  Deploy source for `cloudflare/worker.js` on branch `security/p0-hardening`.
- `SUPABASE-RLS-GUIDE.md` — owner guide for the retired Supabase project.
- `test/worker_testable.mjs` — logic tests (53 assertions, all passing).
- Reference copies: `functions_api_db.js`, `functions_api_storage.js`
  (fetched from the branch; used for schema verification only).

Also patched (bonus P0 leftover found during research):
- `../phase1b/teacher.html`, `../phase1b/parent.html` — removed the hardcoded
  legacy Supabase URL + publishable key (`sb_publishable_…`). The values were
  dead (js/cloudflare-db.js overrides `createClient`), but the key was still
  a live credential in a public file. Both files re-validated with node.

## 1. What was scoped (per role)

**Owner** — full access, unchanged.

**Manager** — full read/write on operational tables; `system_settings`
writes denied (verified: manager portal never writes it); password fields
stripped on read AND write for every non-owner role (a manager token can no
longer harvest or overwrite stored passwords; the owner uses
`/api/auth/set-password`).

**Teacher** (sub = teacher record id)
- `students`: select + update own students only (update restricted to the
  `notes` field — the leave/reschedule/time-change requests live there).
- `teachers`: select own record only.
- `class_schedules`: select/insert/delete own (insert forces
  `teacher_id = sub`; delete keeps the client's id filter ANDed with it).
- `attendance_logs`: select/insert/upsert/update own (`teacher_id` forced).
- `leave_requests`: select/insert own. `trial_students`: select own.
- DENIED: `families`, `payments`, `system_settings`, everything else.

**Parent** (sub = family id)
- Read-only except: may UPDATE own children's `students` rows, restricted to
  the `status` + `notes` fields (the "mark on leave" flow, verified in
  parent.html).
- `families` (own), `students`/`payments`/`trial_students` (own family),
  `attendance_logs`/`leave_requests`/`class_schedules` (own students).
- `teachers`: readable but reduced to `{id, full_name, zoom_link}` —
  parent.html renders teacher names for the child's classes.
- DENIED: `system_settings`, all other writes.

**How it works:** `handleScopedDbRequest` wraps the D1 handler —
pre-check table/action → inject server-side filters (never trusts the
client) → delegate → post-process (strip credential fields, drop
out-of-scope rows, re-scope hydrated joins). Scope denial → generic
`403 { ok:false, error:'Access denied.' }`.

**Storage:** restricted roles get a server-forced folder
`scoped-<role>-<sub>/`; reads limited to that prefix. Uploads keep the
existing 10 MB cap + magic-byte MIME allowlist.

## 2. Field names verified (where)

From `functions/api/db.js` SCHEMA_STATEMENTS (D1, authoritative):
- `students.family_id`, `students.assigned_teacher_id`
- `teachers.address` JSON: `username`, `password`, `emp_id`, `teacher_id`,
  `teacher_account{username,password,emp_id}`; `teachers.notes` JSON:
  `username`, `password`
- `families.notes` JSON: `portal_credentials{username,password}`
- `class_schedules.{student_id,teacher_id}`, `attendance_logs.{student_id,teacher_id}`,
  `payments.family_id`, `leave_requests.{teacher_id,student_id}`,
  `trial_students.{student_id,family_id,teacher_id}`
- There is NO `lesson_logs` / `fee_records` / `notices` table in D1
  (lessons live in `attendance_logs.lesson_notes`; fees in `payments`).

Portal behavior verified in staged `phase1b/orig_*.html`:
- teacher.html updates `students.notes` (3 flows), inserts/deletes
  `class_schedules`, upserts `attendance_logs`, never touches
  `trial_students`/`payments` writes.
- parent.html updates `students.{status,notes}` (leave flow) only.
- manager.html never writes `system_settings`.

## 3. Password hashing

- New format: `sha256$<salt-hex>$<hash-hex>`, hash = SHA-256(salt + ':' + password).
- `verifyPassword` accepts new hashes AND legacy plaintext (migration
  period); the `12345678` default and empty passwords NEVER verify.
- `POST /api/auth/set-password` (owner Bearer token only):
  `{role, identifier, newPassword}` → validates (≥10 chars, not default) →
  writes the hash to the canonical slot (`families.notes →
  portal_credentials.password` for parents; `teachers.address → password`
  for staff). Same identifier matching as login. Rate-limited.

## 4. Deliberately NOT changed

- Login endpoints, rate limiting, CORS allowlist, token format/expiry.
- The D1 handler (`functions/api/db.js`) and R2 handler
  (`functions/api/storage.js`) themselves — scoping lives in the worker
  wrapper so the functions stay reusable.
- Manager full operational access (per brief); owner flows untouched.

## 5. Owner decisions needed

1. **Manager write scope on staff records** — managers can currently
   create/update/delete teacher records (password fields stripped). If
   managers should be read-only on staff, say so and it becomes a 3-line
   change in `checkTableAccess`.
2. **Legacy R2 files** — uploads before this change (e.g. under
   `documents/`) are outside the scoped prefixes, so teachers/parents can
   no longer read them directly (manager/owner can). One-time fix: move old
   keys under `scoped-<role>-<id>/` in the R2 dashboard, or accept
   manager/owner-only access to legacy files.
3. **Password migration** — after deploy, use `/api/auth/set-password`
   (owner portal UI still to be built, or call the endpoint directly) to
   hash every account; then the plaintext era is over.
4. **Supabase** — follow `SUPABASE-RLS-GUIDE.md` (delete the retired
   project, or enable deny-by-default RLS + rotate the old key).
5. **Deploy checklist** — same as Phase 1: set `WORKER_AUTH_SECRET`,
   `OWNER_USERNAME`, `OWNER_PASSWORD_HASH`, `ALLOWED_ORIGINS`; deploy;
   test one login per role before merging the branch.

## 6. Validation

- `node --check worker.js` — passes.
- 53 logic assertions in `test/worker_testable.mjs` — all passing
  (access matrix, filter injection, patch whitelisting, credential
  stripping, relation scrubbing, hash round-trip, legacy/default rejection,
  storage prefix sanitization).

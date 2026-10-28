# LMS Security Setup — Step-by-Step Checklist

This guide is for the site owner (no coding needed — just follow the steps in order).
It finishes the security work that was prepared in the code. Nothing here contains
real passwords or secrets — you will create your own in the steps below.

**What is being fixed, in plain words:** right now the website trusts everything
the browser tells it, the email system can be used by strangers, and some server
files are downloadable from the website. The steps below close those holes.

---

## Step 1 — Create the secret values (do this first)

You need 4 values. Write them down privately (a password manager is ideal —
never email them or paste them into chat).

1. **WORKER_AUTH_SECRET** — a long random password for the server.
   Open a terminal (Mac: Terminal app, Windows: PowerShell) and run:
   - Mac/Linux: `openssl rand -hex 32`
   - Windows PowerShell: `-join ((48..57)+(65..90)+(97..122) | Get-Random -Count 40 | ForEach-Object {[char]$_})`
   
   Copy the result. This is your WORKER_AUTH_SECRET.

2. **OWNER_USERNAME** — pick the admin login name, e.g. `alhuda_admin`.

3. **OWNER_PASSWORD_HASH** — this is your new admin password, stored as a scrambled
   code (so the real password never sits in a file). Run:
   - Mac: `echo -n "YOUR-NEW-PASSWORD" | shasum -a 256`
   - Linux: `echo -n "YOUR-NEW-PASSWORD" | sha256sum`
   - Windows PowerShell:
     `[System.BitConverter]::ToString((New-Object Security.Cryptography.SHA256Managed).ComputeHash([Text.Encoding]::UTF8.GetBytes("YOUR-NEW-PASSWORD"))).Replace("-","").ToLower()`
   
   Replace `YOUR-NEW-PASSWORD` with a strong new admin password.
   **Important:** type `echo -n` exactly (the `-n` matters). Copy only the long
   code of letters/numbers at the start of the output — that is your
   OWNER_PASSWORD_HASH.

4. **ALLOWED_ORIGINS** — the web address of your live site, e.g.
   `https://alhuda-lms.vercel.app`
   (If you later add your own domain name, add it here too, separated by a comma.)

---

## Step 2 — Save the secrets in Cloudflare and deploy the worker

1. On your computer, open a terminal in the project folder and install the
   Cloudflare tool once: `npm install -g wrangler`
2. Log in: `wrangler login` (a browser window will ask you to approve).
3. Save each secret (paste the values from Step 1 when asked):
   - `wrangler secret put WORKER_AUTH_SECRET`
   - `wrangler secret put OWNER_USERNAME`
   - `wrangler secret put OWNER_PASSWORD_HASH`
   
   (`wrangler secret put` stores them safely on Cloudflare's side — they never
   go into your code files.)
4. Open `wrangler.toml` in the project and make sure it contains:
   `ALLOWED_ORIGINS = "https://alhuda-lms.vercel.app"`
   (use your real site address from Step 1).
5. Deploy: `wrangler deploy`
6. Done when you see "Deployed successfully". The worker now requires the
   secret for database and file operations.

---

## Step 3 — Lock the email relay (Apps Script) — updated for Batch 5

**The problem:** the website sends emails through a Google Apps Script web
address. Without a secret check, that address accepts email requests from
*anyone*, so a stranger could send emails pretending to be the academy.

**How it works now (read this first):** the secret is **never** stored in any
website file. It lives in exactly two places, and both must hold the *same*
value:

1. The Cloudflare Worker secret named `RELAY_SECRET` (the Worker also holds
   `RELAY_URL` — the Apps Script web address itself).
2. The Apps Script **Script Property** named `RELAY_SECRET`.

For every email, the Worker sends a JSON body like
`{ to, subject, html, text, secret }` — the secret travels in the field named
**`secret`**. The script compares `body.secret` with its `RELAY_SECRET`
property and only then sends. The script answers with JSON —
`{ success: true, quotaRemaining: N }` or
`{ success: false, error: "…", quotaRemaining: 0 }` — and the LMS reads that
answer, so a rejected or over-quota email is reported in the portal as
**not sent**, never as sent. (Apps Script always replies with HTTP status
200; success and failure travel in the JSON body, not the status.)

**Half A — the Worker secrets (once; use Anti Gravity or a terminal in the
project folder):**
1. `npx wrangler secret put RELAY_URL` → paste the Apps Script **/exec** web
   address → Enter.
2. Make up a long random secret (32+ characters). Keep it somewhere safe —
   you will type the *same* value into the Apps Script in Half B. Never
   paste it into a website file, a chat, or an email.
3. `npx wrangler secret put RELAY_SECRET` → paste that secret → Enter.
4. `npx wrangler deploy`

**Half B — the Apps Script (once):**
1. Go to https://script.google.com and open the project behind the email
   relay (the one whose /exec address you saved as `RELAY_URL`).
2. Store the secret: left sidebar → **Project Settings** → **Script
   properties** → **Add script property** → name: `RELAY_SECRET`, value:
   *the exact same secret as Half A* → **Save script properties**.
3. Make `doPost(e)` follow this shape (keep your existing sending lines if
   they differ — what matters is the secret check at the top and the JSON
   answers):

```javascript
function doPost(e) {
  var out = { success: false };
  try {
    var body = JSON.parse(e.postData.contents);
    var SECRET = PropertiesService.getScriptProperties().getProperty('RELAY_SECRET');
    if (!SECRET || body.secret !== SECRET) {
      out.error = 'Forbidden: bad or missing relay secret';
      return reply_(out);
    }
    if (MailApp.getRemainingDailyQuota() <= 0) {
      out.error = 'Daily email limit reached';
      out.quotaRemaining = 0;
      return reply_(out);
    }
    MailApp.sendEmail({
      to: body.to,
      subject: body.subject,
      body: body.text || body.message || '',
      htmlBody: body.html || body.message || ''
    });
    out.success = true;
    out.quotaRemaining = MailApp.getRemainingDailyQuota();
    return reply_(out);
  } catch (err) {
    out.error = String((err && err.message) || err);
    return reply_(out);
  }
}
function reply_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
```

   The script may read: `body.secret`, `body.to`, `body.subject`,
   `body.html` (or `body.message`), `body.text`.
4. Save the script (**💾 Save**).
5. Publish the change **without changing the web address**: **Deploy** →
   **Manage deployments** → ✏️ edit the active deployment → **Version:
   New version** → **Deploy**. ⚠️ Do **not** create a *new deployment* —
   that makes a new /exec address and emails break until `RELAY_URL` is
   updated too.

**Live tests (after both halves):**
1. **Owner:** send one welcome email from the Owner portal → it arrives and
   the portal reports success.
2. **Manager:** send one fee reminder from the Manager portal → it arrives.
3. **Teacher:** complete an advance class in the Teacher portal → the parent
   receives the advance-class email; the portal claims success only if the
   email really went.
4. **Wrong-secret test:** in Script Properties, change ONE character of
   `RELAY_SECRET` → send a test email from the LMS → the portal must report
   that the email was **NOT** sent. Restore the correct value (script
   properties take effect immediately — no redeploy needed for this test).
5. **Bulk test:** use *Remind All* for a month in the Owner portal → the
   final message reports "X sent, Y not sent", and the numbers match what
   actually arrived.

---

## Step 4 — Supabase: lock the database (Phase 2)

1. Open https://supabase.com → your project → **Authentication** →
   **Policies**.
2. For **every table**, turn on **Row Level Security (RLS)** and make sure
   there is **no** policy that says "allow all" / "public read-write".
   The goal: by default nobody can read or write anything (deny-by-default);
   only the website's server key may access data.
3. Double-check the tables holding student, family, fee/invoice and salary
   data — these must not be publicly readable.

## Step 5 — Reset all passwords (Phase 2)

1. In the LMS database (or admin panel), force-reset the password of **every**
   staff account (owner, manager, teachers) and every parent account.
2. Remove the universal default password `12345678` from the code and the
   database — no new account may ever be created with a predictable password.
3. Give each user their new password privately (in person or by phone —
   **not** by email, see Step 7).

## Step 6 — Rotate the Supabase key (do AFTER Step 4)

1. In Supabase → **Project Settings** → **API**, generate a **new**
   publishable/anon key (this invalidates the old one).
2. Put the new key in the website's configuration wherever the old key was.
3. Deploy the website again so the live site uses the new key.
4. The old key is now useless even if someone copied it earlier.

## Step 7 — Stop emailing passwords (Phase 2)

Welcome emails currently include the parent's login **password in plain text**.
Change the welcome email so it contains a **one-time setup link** instead of
a password (the link lets the parent choose their own password on first login).
Until this is built, hand out initial passwords in person or by phone.

---

## Step 8 — Merge checklist (before this goes live)

Work through this list top to bottom before merging the security branch:

- [ ] All code changes reviewed (no stray test code, no secrets in files)
- [ ] Worker secrets `RELAY_URL` and `RELAY_SECRET` are set (`wrangler secret list`), and the Apps Script `RELAY_SECRET` script property matches the Worker secret
- [ ] Apps Script updated, `RELAY_SECRET` script property set, new version deployed
- [ ] Cloudflare secrets saved (`wrangler secret put` × 3) and worker deployed
- [ ] `wrangler.toml` has the correct `ALLOWED_ORIGINS`
- [ ] Test on the Vercel preview link first: portals load normally, login works,
      a welcome email sends and arrives, attendance/fee pages work
- [ ] Open `https://<your-site>/functions/api/db` in a browser — it must show
      a **404** page, not code
- [ ] Check the browser console on each portal — no new red errors
      (if emails report failure right after the relay is locked, the two
      `RELAY_SECRET` values do not match — see Step 3)
- [ ] Merge the branch into `main`, wait for Vercel to deploy, and repeat the
      checks on the live site

---

## Backup and restore

Backups are taken **before any change that touches how money or course
material is stored**, and are kept in a dated folder **outside the git
repository** (convention: `LMS-Backups/<YYYY-MM-DD>/` on the owner's
computer, or `~/workspace/backups/<YYYY-MM-DD>-<batch>/` on the assistant's
machine). A backup is never committed to the repository and never uploaded
to a third-party file host: it contains student data and password hashes.

A complete backup has three parts:

1. **The D1 database** — either a `wrangler d1 export` SQL file or a full
   dump of every table (all rows, taken with SELECT queries). Verify before
   proceeding: the file is larger than zero bytes, and the row count of
   every table in the backup equals the live count.
2. **Snapshots of the JSON stores** — one JSON file with every family's
   `notes` field and one with every teacher's `address` field. These two
   fields hold the legacy fee history, salary records, and account metadata,
   so they can be restored on their own without touching anything else.
3. **The R2 bucket** (course material files) — a manifest of every object
   (key, size, last modified) plus a full local copy of the objects with
   their keys preserved (for example with `rclone copy`). Verify the local
   copy by file count and total bytes against the manifest.

**To restore:**

- **Whole database:** apply the export/dump SQL to an *empty* database with
  `npx wrangler d1 execute alhuda-lms-db --remote --file=<backup>.sql`, or
  use D1 Time Travel to return the database to a recorded bookmark:
  `npx wrangler d1 time-travel restore alhuda-lms-db --bookmark=<bookmark>`
  (Time Travel retains 30 days of history; the bookmark for a backup is
  recorded in that backup folder's README at backup time).
- **One family's notes / one teacher's address:** run a single-row
  `UPDATE` that sets the field back to the JSON string stored in the
  snapshot file for that row's id.
- **R2 bucket:** upload the local copy back with the keys unchanged, for
  example `rclone copy <local-folder> r2:alhuda-islamic-centre-storage`,
  or per file with `npx wrangler r2 object put`.

After any restore, sign in to each portal and confirm the dashboard, fees,
payroll, and course material all load before telling users the system is
back.

## Finance tables flags (owner reference)

The finance tables migration (Batches 6B–6D) is controlled by four switches
stored in `system_settings`. Manage all of them from the owner tool page
`backfill-finance-tables.html` — never from the browser console.

- `fee_tables_v1` (Step "Finance tables flag" on the tool page): when `on`,
  every new fee and salary slip also writes a copy into the `payments`,
  `salary_slips`, and `salary_adjustments` tables. Keep it OFF while running
  a backfill.
- `fee_read_parent` (Step 5 switch): when `on`, the parent portal's fee
  history reads from the `payments` table instead of the legacy stores.
- `fee_read_360` (Step 5 switch): when `on`, the Family 360 payments list
  reads its real records from the `payments` table.
- `salary_read_v1` (Step 5 switch): reserved for the salary read switch
  (Batch 6D-3).

Read flags accept `off` / `compare` / `on`. Turning any flag back to `off`
restores the previous behaviour immediately; portals read the flags once
when they load, so refresh an open portal page after changing one.

## Batch 7A — login throttling, session revocation, PBKDF2 passwords

### Login throttling and lockout (what users see)

Failed logins are counted per account and per IP address in the D1
table `auth_throttle` (keys are HMAC hashes — no username or IP address
is stored in plain text). The policy is:

- **Per account:** 5 failed attempts in 15 minutes locks that account
  for 15 minutes. A further failure cycle after the lock expires locks
  it for 30 minutes, then 60 minutes (the cap). After 15 quiet minutes
  the progression resets.
- **Per IP address:** 20 failed attempts in 15 minutes blocks that IP
  address for 15 minutes (fixed, never progressive — a shared network
  address must not be blocked for an hour).
- A successful login resets the account counter only, never the IP
  counter. **Locks always expire** — no account can be locked forever
  by this mechanism.
- While locked, login answers `429` with a `Retry-After` header and the
  message "Too many attempts. Please try again in N minutes."
- Unknown usernames and wrong passwords give identical `401` answers
  (no way to probe which accounts exist), except the deliberate
  "No password set. Ask the administrator to set one." message when an
  account exists but has no hashed password yet.
- Set-password calls are rate-limited separately: 30 calls per IP
  address per 15 minutes (every authenticated call counts), with a
  15-minute fixed lock. A locked-out IP cannot set passwords either.

**Lockout risk, stated plainly.** An attacker who knows a username can
lock that account for up to 60 minutes at a time by failing 5 logins —
that is the unavoidable trade of any lockout. The damage is bounded:
locks are short and capped; a lock never ends an already-valid session
(the person already signed in keeps working); the per-IP block engages
before one address can sustain an account lock indefinitely; and the
owner can clear any lock immediately (below). The alternative — no
lockout — would let an attacker guess passwords forever.

### Unlocking an account (owner only)

Open the owner tool page `set-teacher-passwords.html`, sign in, and use
**Step 3 — Unlock an account or sign out everywhere**:

- **Unlock account:** pick the portal role, enter the username or ID
  exactly as used at login, press "Unlock account". The server answers
  success whether or not a lock existed (so nobody can probe for locked
  accounts).
- **Unblock IP:** enter the IP address and press "Unblock IP".
- A manager can never unlock anyone — the server enforces owner-only
  (`POST /api/auth/unlock` returns 403 for any other role).

### Emergency: if nobody can log in at all

If the owner account itself is locked and the tool page cannot be
reached, rotate the `WORKER_AUTH_SECRET` secret (Cloudflare dashboard
or Anti Gravity) and redeploy the Worker. Because throttle keys are
HMACs under that secret, rotation effectively clears all throttle
state. **Be honest about the cost: rotation signs everyone out** —
every existing token stops verifying, and every user must log in again.
This is the emergency path only, never routine administration.

### Session revocation (logout, password change, deactivation)

**What happened before this batch:** there was no server-side logout.
Signing out only cleared the browser. A deactivated teacher or family
kept working until their 8-hour token expired, and could even log in
again while deactivated. A password change did not invalidate old
tokens either.

**After this batch:**

- Every portal's logout calls `POST /api/auth/logout` first, which
  records the token's hash in `auth_revoked_tokens`. That token stops
  working on the very next request. If the call fails (offline), the
  local logout still happens and the user is told the server session
  may last until it expires.
- Password set/reset, teacher/manager/family deactivation and deletion,
  and the owner "sign out everywhere" action (`POST
  /api/auth/sign-out-everywhere`, subject = teacher/family ID or the
  owner username) bump a per-account marker in
  `auth_subject_valid_after`. Tokens issued before the marker are
  rejected. The marker check is cached per Worker isolate for 60
  seconds, so the **maximum revocation delay across isolates is 60
  seconds** (immediate within the isolate that made the change); the
  single-token logout has no such delay.
- **Still not blocked:** a fresh login made *after* a deactivation is
  not rejected by this batch — deactivation ends existing sessions,
  but the login gate itself was deliberately left unchanged (that
  would be a separate product decision: what a deactivated account's
  login screen should say).

### Password hashing: PBKDF2 (10,000 iterations)

New passwords are stored as
`pbkdf2$<iterations>$<salt-hex>$<hash-hex>` (16 random salt bytes,
32-byte output, constant-time comparison). **Why 10,000:** the official
Cloudflare Workers limits documentation gives Workers Free 10 ms of
CPU per invocation and Workers Paid (Standard) 30 seconds by default.
This account's Workers plan is **unverified** (plan is dashboard-only,
nothing in the repository states it), so the count must be safe even
on the Free plan. Measured on this machine (PBKDF2-HMAC-SHA-256,
32-byte output): 100,000 iterations ≈ 24–28 ms, 210,000 ≈ 54–60 ms,
600,000 ≈ 158–162 ms. 10,000 iterations (≈ 2.7 ms) leaves headroom on
Free; 100,000 would already exceed a Free CPU budget. 10,000 is below
OWASP's 600,000 recommendation — stated honestly. It is a large step
up from single SHA-256, and the format carries its iteration count, so
if the account is confirmed on Workers Paid, raise
`PBKDF2_ITERATIONS` in `cloudflare/worker.js` to 210,000 (≈ 57 ms) or
600,000 (≈ 160 ms) and redeploy — no migration needed. Existing hashes
keep verifying, and logins transparently upgrade.

**Compatibility:** the login still verifies every older format — the
salted `sha256$` format, and the owner environment credential
(`OWNER_PASSWORD_HASH`, unsalted SHA-256 hex, or a future `pbkdf2$`
value by format prefix). On a successful login with an older format,
the stored hash is transparently upgraded to PBKDF2 in the same slot.
The owner environment credential is **never** rehashed by the app (no
owner database row exists, and set-password rejects the owner role).

**Owner environment migration (optional, one-time):** generate a
`pbkdf2$` hash offline, set it with
`wrangler secret put OWNER_PASSWORD_HASH`, redeploy, and verify the
owner login. Until then the owner credential stays on unsalted SHA-256
by design — the app verifies it, it just cannot upgrade it on its own.

**If logins ever fail with CPU errors after deploy:** lower
`PBKDF2_ITERATIONS` and redeploy. Old hashes still verify, and new
logins re-hash at the lowered count. No data migration is involved.

### Rollback

Revert the merge commit (or redeploy the previous Worker version) and
the old behaviour returns: logins work exactly as before, including
all legacy hash formats. The three new D1 tables (`auth_throttle`,
`auth_revoked_tokens`, `auth_subject_valid_after`) are additive and
harmless if left behind; they are created lazily by the Worker and by
the schema marker `2026-10-28-v2` in `functions/api/db.js`.

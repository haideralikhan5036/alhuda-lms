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

## Step 3 — Lock the email relay (Apps Script)

**The problem:** the website sends emails through a Google Apps Script web
address. That address currently accepts email requests from *anyone*, so a
stranger could send emails pretending to be the academy.

**Fix it in two halves (both halves must match):**

**Half A — the website (already prepared in the code):**
1. Open `js/email.js` and find the line `const EMAIL_RELAY_SECRET = '';`
2. Make up a long random secret (different from Step 1 — e.g. 32+ random
   characters) and paste it between the quotes.
3. Save the file. (Until you finish Half B, emails keep working as before —
   the website just warns in the browser console that the secret is empty.)

**Half B — the Apps Script (you do this once):**
1. Go to https://script.google.com and open the project behind the email relay
   (the one whose web address is saved as `OFFICIAL_APPS_SCRIPT_EMAIL_RELAY`
   in `js/email.js`).
2. At the very top of the `doPost(e)` function, paste this check:

```javascript
function doPost(e) {
  var SECRET = PropertiesService.getScriptProperties().getProperty('RELAY_SECRET');
  var body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) { /* not JSON, reject below */ }

  if (!SECRET || body.relaySecret !== SECRET) {
    // NOTE: Apps Script always replies with HTTP 200, so a real "403 status"
    // is not possible here. We reject by sending an error message instead —
    // the website treats this reply as a failed send.
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: 'Forbidden: bad or missing relay secret' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // ---- your existing email-sending code continues below ----
  // it can use: body.to, body.subject, body.html, body.text, body.senderName
```

3. Save the script (**💾 Save**).
4. Store the secret: left sidebar → **Project Settings** → **Script properties**
   → **Add script property** → name: `RELAY_SECRET`, value: *the exact same
   secret you pasted in `js/email.js`* → **Save script properties**.
5. Publish the change: **Deploy** → **Manage deployments** → ✏️ edit the active
   deployment → **Version: New version** → **Deploy**.
6. Test: send a welcome email from the LMS. It should arrive normally. (If
   emails stop, the two secrets don't match — compare them character by
   character.)

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
- [ ] `js/email.js` has the real `EMAIL_RELAY_SECRET` filled in (not empty)
- [ ] Apps Script updated, `RELAY_SECRET` script property set, new version deployed
- [ ] Cloudflare secrets saved (`wrangler secret put` × 3) and worker deployed
- [ ] `wrangler.toml` has the correct `ALLOWED_ORIGINS`
- [ ] Test on the Vercel preview link first: portals load normally, login works,
      a welcome email sends and arrives, attendance/fee pages work
- [ ] Open `https://<your-site>/functions/api/db` in a browser — it must show
      a **404** page, not code
- [ ] Check the browser console on each portal — no new red errors
      (a yellow "EMAIL_RELAY_SECRET is empty" warning means Step 3 Half A
      isn't done yet)
- [ ] Merge the branch into `main`, wait for Vercel to deploy, and repeat the
      checks on the live site

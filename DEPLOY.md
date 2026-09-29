# Putting Triplet online

One server runs both halves: the API at `/api` and the website at `/` (`serve.py`). Keeping them on
one address lets the website's sign-in cookie work (it's first-party and `SameSite=Strict`), so
the website and API must not live on different hosts.

The setup below is free: [Render](https://render.com) runs the server and [Neon](https://neon.tech)
holds the database. Render's free server sleeps after 15 idle minutes and takes about a minute to
wake; a paid plan ($7/month) stays awake.

Do the steps in order. Each ends with a value to keep; write them in a scratch note (not in the
repository) as you go:

| Step | You end up with |
| --- | --- |
| 1. Database | `DB_SETTINGS` |
| 2. Email | `BREVO_API_KEY` and `SMTP_FROM` |
| 3. Gemini | `GEMINI_API_KEY` |
| 4. Server | the site's address, e.g. `https://triplet.onrender.com` |
| 5. Phone app | an APK that talks to the server |
| 6. Your own domain (optional) | e.g. `https://triplet.me` |

Screens on these sites change now and then; if a button has moved, look for one with a similar name.

## 1. Database (Neon)

1. Go to [neon.tech](https://neon.tech) and sign up (signing in with GitHub is quickest).
2. Create a project:
   - **Name:** `triplet`
   - **Postgres version:** the default
   - **Region:** the one nearest your users, and remember it; pick the nearest Render region in step 4
3. On the project's dashboard, click **Connect**. In the box that opens:
   - **Database:** `neondb` (the default)
   - Turn **Connection pooling** off, so you get the direct address
   - Copy the connection string. It looks like
     `postgresql://neondb_owner:abc123@ep-cool-name-123456.eu-central-1.aws.neon.tech/neondb?sslmode=require`
4. Put `+psycopg` right after `postgresql`, so it starts `postgresql+psycopg://`:

   ```
   postgresql+psycopg://neondb_owner:abc123@ep-cool-name-123456.eu-central-1.aws.neon.tech/neondb?sslmode=require
   ```

   This whole line is **`DB_SETTINGS`**. It contains the database password: don't commit it or share it.

You don't create any tables: the server does that itself each time it starts (`alembic upgrade head`).

## 2. Email (for sign-up codes and password resets)

Nobody can finish signing up without receiving their code, so this step matters. Pick one service.

Render's free plan blocks email ports (25, 465 and 587, and the connection can time out on others
too), so on Render send through **Brevo's API**, which uses ordinary HTTPS. Gmail only offers email
ports, so it only works on your own computer. If codes don't arrive, Render's **Logs** show
`Failed to send email` with the reason.

### Option A: Brevo (recommended, 300 emails a day free)

1. Sign up at [brevo.com](https://www.brevo.com). It asks a few questions about your business;
   anything reasonable is fine.
2. Add the address emails come from:
   - Open the account menu (top right) > **Senders, Domains & Dedicated IPs** > **Senders** >
     **Add a sender**
   - **From name:** `Triplet`; **From email:** your email address
   - Brevo emails that address a confirmation link: click it
3. Get an API key:
   - Account menu > **SMTP & API** > **API Keys** tab
   - Click **Generate a new API key**, name it `triplet`, and copy the key (it starts `xkeysib-`
     and is shown once). It's a different key from the SMTP key on the tab next to it.
4. Your values:

   | Setting | Value |
   | --- | --- |
   | `BREVO_API_KEY` | the API key from step 3 |
   | `SMTP_FROM` | `Triplet <the sender address from step 2>` |

   With `BREVO_API_KEY` set, the `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME` and `SMTP_PASSWORD`
   settings aren't used; leave them empty.

If the log says Brevo refused an **unrecognised IP address**: in Brevo, open the account menu >
**Security** > **Authorised IPs** and turn off blocking unknown IPs (Render's addresses change, so
they can't be listed one by one).

Emails from a Gmail or Outlook sender address may land in spam. Adding your own domain (step 6)
fixes that.

### Option B: Gmail (testing on your own computer only)

Gmail only takes ports 465 and 587, which Render's free plan blocks.

1. Turn on 2-Step Verification for the Google account: [myaccount.google.com/security](https://myaccount.google.com/security).
2. Go to [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords), name it
   `triplet` and click **Create**. Copy the 16-letter password (the spaces don't matter).
3. Your values:

   | Setting | Value |
   | --- | --- |
   | `SMTP_HOST` | `smtp.gmail.com` |
   | `SMTP_PORT` | `587` |
   | `SMTP_USERNAME` | your Gmail address |
   | `SMTP_PASSWORD` | the app password |
   | `SMTP_FROM` | `Triplet <your Gmail address>` |

### Option C: Resend (100 a day free, needs your own domain; not on Render's free plan)

Do step 6 first, then add and verify the domain in Resend. `SMTP_HOST` is `smtp.resend.com`,
`SMTP_USERNAME` is `resend`, `SMTP_PASSWORD` is an API key, and `SMTP_FROM` is an address on your domain.
This goes over email ports, so like Gmail it doesn't work on Render's free plan.

### Try it locally first (optional)

Put the five values in your local `.env`, start the backend, and sign up with a real address. The
code should arrive by email instead of printing in the terminal. If it doesn't, the terminal shows why.

## 3. Gemini key

Reading videos, screenshots and blog posts, and trip Q&A, use Gemini.

1. Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey) and sign in.
2. Click **Create API key** and copy it. This is **`GEMINI_API_KEY`**.

You can reuse the key from your local `.env`.

## 4. Server (Render)

Render's free build machine doesn't have enough memory to bundle the website, so GitHub builds the
server image instead (`.github/workflows/deploy.yml`, free for public repositories) and Render only
runs it. Every push to `main` builds a new image and tells Render to deploy it.

### 4a. Build the image on GitHub

1. Make sure what you want online is on `main` on GitHub. In `D:\Triplet`: `git pull`, then `git push`.
2. On GitHub, open the repository's **Actions** tab. A **Deploy** run starts for each push to
   `main`; if none has run yet, click **Deploy** > **Run workflow**.
3. Wait for the green tick: about 10 minutes the first time, a few minutes after that. The last
   step says `No RENDER_DEPLOY_HOOK_URL secret yet`: that's expected until 4d.
4. Make the image public, so Render can download it without a password (it contains only what's
   already in this public repository; `.env` files are never included):
   - On your GitHub profile, open **Packages** > **triplet** > **Package settings**
   - Under **Danger Zone**, click **Change visibility** > **Public**, and type the name to confirm

### 4b. If you already created a service that failed

A service that builds from the repository can't be switched to running an image, so remove it:

1. In Render, open the old `triplet` service > **Settings** > **Delete Web Service** (at the bottom).
2. If you made it with a Blueprint, open **Blueprints** and delete that one too.

Copy your settings from its **Environment** page first if you don't have them noted: you enter
them again below.

### 4c. Create the service

1. Sign up at [render.com](https://render.com) with **GitHub**, and allow it access to the Triplet
   repository (all repositories, or just this one).
2. In the dashboard, click **New** > **Blueprint**.
3. Pick the **Triplet** repository. Render reads `render.yaml` and shows one web service, `triplet`,
   that runs `ghcr.io/uwuexdeemeow/triplet:latest`.
4. **Blueprint name:** `triplet`. **Branch:** `main`.
5. It asks for each setting marked `sync: false`. Fill them in:

   | Setting | Value |
   | --- | --- |
   | `DB_SETTINGS` | from step 1 |
   | `GEMINI_API_KEY` | from step 3 |
   | `BREVO_API_KEY`, `SMTP_FROM` | from step 2 |

   The rest (`ENVIRONMENT`, `API_PATH_PREFIX`, `TRUSTED_PROXY_HOPS`) are already set,
   and `SECRET_KEY` is generated for you. Keep that key as it is: changing it signs everyone out.
   The site's address isn't needed: the server reads the one Render gives it, for links in emails.
6. Click **Deploy Blueprint** (or **Apply**).

### 4d. Let GitHub deploy new versions

1. In Render: the `triplet` service > **Settings** > **Deploy Hook**. Copy the address (it starts
   `https://api.render.com/deploy/`). Treat it like a password: anyone with it can redeploy the site.
2. On GitHub: the repository's **Settings** > **Secrets and variables** > **Actions** >
   **New repository secret**.
   - **Name:** `RENDER_DEPLOY_HOOK_URL`
   - **Secret:** the address
3. From now on, every push to `main` builds and deploys by itself. To redeploy without changes:
   **Actions** > **Deploy** > **Run workflow**.

### 4e. Watch it start

1. Open the `triplet` service's **Logs**. Starting takes a minute or two: Render downloads the
   image, then the server updates the database and starts.
2. When it's ready, the log shows lines like:

   ```
   INFO  [alembic.runtime.migration] Running upgrade ... -> e6b3c1d8f027, email codes
   INFO:     Uvicorn running on http://0.0.0.0:10000
   ```

   and the service shows **Live**.

### 4f. Find the address

The site's address is at the top of the service page, under its name. If `triplet` was taken, it
has something added, like `https://triplet-a1b2.onrender.com`. You need it for the checks below and
for the phone app in step 5.

### 4g. Check it works

1. Open `https://<your address>/api/` and you should see `{"message":"Triplet API is running"}`.
2. Open `https://<your address>/`: the sign-in screen.
3. Sign up with a real email address. The code should arrive within a minute; enter it and you're
   signed in.
4. Save a TikTok or YouTube link to a trip, to check Gemini works.
5. Reload the page on a trip (e.g. `/trips/1`): you stay signed in and on that page.

### 4h. Tests before deploy

The **Tests** workflow (`.github/workflows/tests.yml`) runs the server's tests, and the app's typecheck
and lint, on every push and pull request. To make Render wait for it:

1. In Render: the `triplet` service > **Settings** > **Build & Deploy** > **Auto-Deploy**, choose
   **After CI Checks Pass**.

Render then deploys a commit on `main` only once every check on it is green. A red **Tests** run
means that commit is **not** online: open the run under **Actions**, read the failing step, fix it and
push again. To put a commit online anyway, use **Manual Deploy** on the service page.

Render waits for *every* check on the commit, so nothing slow or optional should run on push. That's
why **Audit** (section 8b) is started on a schedule instead, and why **Deploy** (the image build in
4a) only runs by hand: Render builds the repository's `Dockerfile` itself, so the image isn't needed.

## 5. The phone app

The app is built with its server address baked in, so it needs a build that knows the new one.

1. In `D:\Triplet\mobile`, sign in to Expo if you haven't: `npx eas-cli@latest login`
2. Store the address for the build profiles you use (replace the address with yours):

   ```
   npx eas-cli@latest env:create --name EXPO_PUBLIC_API_URL --value https://triplet.onrender.com/api --environment preview --visibility plaintext
   npx eas-cli@latest env:create --name EXPO_PUBLIC_API_URL --value https://triplet.onrender.com/api --environment production --visibility plaintext
   ```

   If it says the variable already exists, use `env:update` with the same options instead.
3. Build the APK: `npx eas-cli@latest build --profile preview --platform android`. It takes 10–20
   minutes; the link it prints (also on expo.dev) downloads the APK.
4. On the phone: uninstall the old Triplet, install the new APK, and sign in. Use mobile data rather
   than Wi-Fi to be sure it reaches the server on the internet, not your computer.

After this one build, JavaScript changes don't need a new APK:

```
npx eas-cli@latest update --channel preview --environment preview --message "What changed"
```

The app downloads the update in the background and uses it from the next launch. A new build is
only needed when native parts change (a new library with native code, or `app.json` changes); see
*Shipping updates* in `mobile/README.md`.

## 6. Your own domain (optional, free with the GitHub Student Pack)

The Student Pack's offers change, so check [education.github.com/pack](https://education.github.com/pack)
for the current ones. It has usually included a free domain for a year from Namecheap (`.me`),
get.tech (`.tech`) or Name.com. After the first year it costs roughly $10–20 a year to renew.

### 6a. Get the domain

1. On the Student Pack page, find the domain offer (e.g. **Namecheap**) and click through to claim it.
2. Search for a name (e.g. `triplet.me`), add it to the cart at $0, and check out.

### 6b. Point it at Render

1. In Render: the `triplet` service > **Settings** > **Custom Domains** > **Add Custom Domain**.
   Add `triplet.me` (Render may offer to add `www.triplet.me` too; accept).
2. Render shows the DNS records to create, usually an **A** record for `triplet.me` and a **CNAME**
   for `www`.
3. In Namecheap: **Domain List** > **Manage** next to the domain > **Advanced DNS**.
   - Delete the parking-page records Namecheap added (the `CNAME www` and `URL Redirect` ones)
   - Add each record exactly as Render shows it (**Host** `@` means the bare domain)
4. Back in Render, click **Verify**. DNS can take from minutes to a few hours; Render then sets
   up HTTPS by itself.

### 6c. Switch everything to the new address

1. Render > **Environment**: add `APP_URL` with the value `https://triplet.me`, so links in emails
   use the new address, and save (it redeploys).
2. Point the app at it, then ship an update (no new build needed, since only the address changed):

   ```
   npx eas-cli@latest env:update --name EXPO_PUBLIC_API_URL --value https://triplet.me/api --environment preview
   npx eas-cli@latest update --channel preview --environment preview --message "New address"
   ```

   Keep the old `onrender.com` address working in the meantime: phones that haven't picked up the
   update yet still use it.

### 6d. Send email from the domain

Mail from your own domain is much less likely to land in spam.

1. In Brevo: account menu > **Senders, Domains & Dedicated IPs** > **Domains** > **Add a domain**,
   and enter `triplet.me`.
2. Brevo lists some DNS records (a code for Brevo, DKIM and DMARC). Add each one in Namecheap's
   **Advanced DNS**, as in 6b.
3. Click **Authenticate** in Brevo once they're in.
4. Add a sender like `codes@triplet.me` (**Senders** > **Add a sender**), then in Render change
   `SMTP_FROM` to `Triplet <codes@triplet.me>`.

## 7. Database backups

Two layers, so a bad change or a mistake can be undone:

- **Neon's own history** lets you rewind the whole database to a moment in the recent past. How far
  back depends on your plan: in the Neon console, open the project > **Settings** > **Instant restore**
  (or **History retention**) to see it. Rewinding is under **Backup & Restore**.
- **A nightly copy** made by GitHub Actions (`.github/workflows/backup.yml`) and kept for 30 days.
  It's encrypted first, since the repository is public.

### 7a. Turn on the nightly copy

GitHub runs the copy; [cron-job.org](https://cron-job.org) starts it each night, since GitHub's own
schedules can run late or be skipped.

1. Make a passphrase: a long random one, e.g. from `python -c "import secrets; print(secrets.token_urlsafe(32))"`.
   Keep it in your password manager. **Without it no copy can be opened**, and it can't be recovered.
2. On GitHub: the repository's **Settings** > **Secrets and variables** > **Actions** >
   **New repository secret**, twice:
   - `BACKUP_DATABASE_URL`: the same address as `DB_SETTINGS` on Render (either the
     `postgresql+psycopg://` or the `postgresql://` form works)
   - `BACKUP_PASSPHRASE`: the passphrase from step 1
3. **Actions** > **Backup** > **Run workflow**, to check it works now rather than tonight. A green run
   has a `database-...` file under **Artifacts** at the bottom of its page.

4. Make a GitHub token cron-job.org can start it with: your profile's **Settings** > **Developer
   settings** > **Personal access tokens** > **Fine-grained tokens** > **Generate new token**, signed
   in as the account that owns the repository. **Repository access**: only `Triplet`. **Repository
   permissions** > **Actions**: Read and write. Note when it expires, and renew it before then.
5. In cron-job.org, create a job:
   - **URL**: `https://api.github.com/repos/uwuexdeemeow/Triplet/actions/workflows/backup.yml/dispatches`
   - **Schedule**: every day at 02:00, time zone Asia/Singapore
   - **Advanced** > **Request method**: `POST`; **Request body**: `{"ref":"main"}`
   - **Advanced** > **Headers**: `Authorization` = `Bearer ` and the token; `Accept` =
     `application/vnd.github+json`; `X-GitHub-Api-Version` = `2022-11-28`; `Content-Type` =
     `application/json`
   - **Test run** should answer `204`, and a new **Backup** run appears under **Actions**. `401` means
     the token is wrong or the header isn't exactly `Bearer <token>`; `403` means it lacks the Actions
     permission or access to the repository.

Turn on cron-job.org's failure notifications, so you hear if GitHub stops accepting the token (e.g.
when it expires). A run that starts but fails, for example if the database address changes, emails
you like any failed GitHub Action.

### 7b. Bring a copy back

Download the `database-...` file from the run you want (**Actions** > **Backup** > the run >
**Artifacts**) and unzip it. With PostgreSQL's tools installed (`C:\Program Files\PostgreSQL\18\bin`):

```
gpg --decrypt --output triplet.dump triplet-2026-10-01.dump.gpg
pg_restore --list triplet.dump
```

`gpg` asks for the passphrase (Git Bash includes `gpg`). The list shows what's inside. Then restore into
a **new, empty** Neon database first and check it, rather than straight over the live one:

```
pg_restore --no-owner --no-privileges --dbname "postgresql://...the new database..." triplet.dump
```

Once it looks right, point `DB_SETTINGS` on Render at the new database. To restore just one table,
add `--table=trips` (for example) to the `pg_restore` line.

## 8. Other scheduled jobs

Both use [cron-job.org](https://cron-job.org), like the nightly copy in 7a.

### 8a. Keep the server awake

Render's free plan puts the server to sleep after 15 idle minutes, and the next visit (including a
sign-up code) waits about 50 seconds. A ping every 10 minutes keeps it awake. In cron-job.org, create a job:

- **URL**: `https://triplet-ikz2.onrender.com/api/health` (your site's address, then `/api/health`)
- **Schedule**: every 10 minutes
- **Request method**: `GET`. No token is needed.
- Turn on failure notifications. **Test run** should answer `200` with `{"status":"ok"}`.

Render's free plan gives 750 instance hours a month, and one always-on service uses about 730. The
ping doesn't touch the database, so Neon still suspends when idle (it wakes in about a second).

### 8b. Weekly package audit

The **Audit** workflow (`.github/workflows/audit.yml`) checks the server's and the app's packages for
known security problems. It doesn't run on push, so it never holds up a deploy; cron-job.org starts it
once a week, since new problems are published about packages that haven't changed. Use the token from
7a and create another job the same way, with:

- **URL**: `https://api.github.com/repos/uwuexdeemeow/Triplet/actions/workflows/audit.yml/dispatches`
- **Schedule**: every Monday at 09:00, time zone Asia/Singapore
- The same request method, body and headers as the backup job. **Test run** should answer `204`.

A red run names the package and the version that fixes it, and GitHub emails you.

## If something goes wrong

- **The build fails**: it runs on GitHub, under **Actions** > **Deploy**; the log shows which step.
  A problem in the `web` stage is the website build: try `npx expo export --platform web` in
  `mobile/` on your computer to see the same error.
- **Render says it can't pull the image**: the package isn't public yet (step 4a.4).
- **The log says `SECRET_KEY must be at least 32 random characters`** or another setting is
  missing or invalid: fix it under **Environment**.
- **`could not translate host name` or `password authentication failed`**: `DB_SETTINGS` is wrong.
  Copy it from Neon again and check it starts `postgresql+psycopg://`.
- **No code arrives**: check spam first. Then look in the Render logs for `Failed to send email`:
  - `timed out` or `Network is unreachable`: Render blocked the email port. Use `BREVO_API_KEY`
    instead of the `SMTP_*` settings (step 2, Option A)
  - `Brevo said 401`: the API key is wrong, or Brevo blocked Render's address (see the end of
    Option A); `Brevo said 400`: usually `SMTP_FROM` isn't a verified sender
  - `Authentication` errors: check `SMTP_USERNAME` and `SMTP_PASSWORD` (a Brevo login is the
    `...@smtp-brevo.com` address, not your own email)
  - `Sender` errors: `SMTP_FROM` must be a sender you verified in Brevo
  - No error and an `--- Email to` block instead: neither `BREVO_API_KEY` nor `SMTP_HOST` is set, so the code went to the log
- **The website loads but you're signed out on every reload**: check `API_PATH_PREFIX` is `/api`
  (the sign-in cookie only reaches the API at that path). Leave `CORS_ORIGINS` unset: the website
  and API share one address, so it isn't needed.
- **The app says it can't reach the server**: the APK was built before step 5.2, or with the wrong
  address. Check with `npx eas-cli@latest env:list --environment preview`, then rebuild.
- **The first request after a while is slow**: the free server was asleep; it wakes in about a minute.

## Trying the image on your own computer (optional)

With [Docker](https://www.docker.com/products/docker-desktop/) installed, in `D:\Triplet`:

```
docker build -t triplet .
docker run -p 8000:8000 --env-file .env -e API_PATH_PREFIX=/api triplet
```

Then open http://localhost:8000. `DB_SETTINGS` in `.env` must reach the database from inside
Docker: use `host.docker.internal` instead of `localhost`.

## Settings the server uses

`render.yaml` sets these for you:

- `ENVIRONMENT=production` hides the API docs and turns on HTTPS-only headers.
- `API_PATH_PREFIX=/api` matches the sign-in cookie's path to where `serve.py` mounts the API.
- `TRUSTED_PROXY_HOPS=1` reads visitors' real addresses (for rate limits) from the one proxy in front
  of Render's servers. Set it to 0 if nothing sits in front of the server, or else anyone could
  pretend to be any address.

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
| 2. Email | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM` |
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

### Option A: Brevo (recommended, 300 emails a day free)

1. Sign up at [brevo.com](https://www.brevo.com). It asks a few questions about your business;
   anything reasonable is fine.
2. Add the address emails come from:
   - Open the account menu (top right) > **Senders, Domains & Dedicated IPs** > **Senders** >
     **Add a sender**
   - **From name:** `Triplet`; **From email:** your email address
   - Brevo emails that address a confirmation link: click it
3. Get the SMTP login:
   - Account menu > **SMTP & API** > **SMTP** tab
   - Click **Generate a new SMTP key**, name it `triplet`, and copy the key (it's shown once)
4. Your values:

   | Setting | Value |
   | --- | --- |
   | `SMTP_HOST` | `smtp-relay.brevo.com` |
   | `SMTP_PORT` | `587` |
   | `SMTP_USERNAME` | the **Login** shown on that page (looks like `8a1b2c001@smtp-brevo.com`) |
   | `SMTP_PASSWORD` | the SMTP key from step 3 |
   | `SMTP_FROM` | `Triplet <the sender address from step 2>` |

Emails from a Gmail or Outlook sender address may land in spam. Adding your own domain (step 6)
fixes that.

### Option B: Gmail (fine for testing)

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

### Option C: Resend (100 a day free, needs your own domain)

Do step 6 first, then add and verify the domain in Resend. `SMTP_HOST` is `smtp.resend.com`,
`SMTP_USERNAME` is `resend`, `SMTP_PASSWORD` is an API key, and `SMTP_FROM` is an address on your domain.

### Try it locally first (optional)

Put the five values in your local `.env`, start the backend, and sign up with a real address. The
code should arrive by email instead of printing in the terminal. If it doesn't, the terminal shows why.

## 3. Gemini key

Reading videos, screenshots and blog posts, and trip Q&A, use Gemini.

1. Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey) and sign in.
2. Click **Create API key** and copy it. This is **`GEMINI_API_KEY`**.

You can reuse the key from your local `.env`.

## 4. Server (Render)

### 4a. Check the code is on GitHub

Render builds from GitHub, so the version you want online must be on the `main` branch there. In
`D:\Triplet`:

```
git status
git pull
git push
```

### 4b. Create the service

1. Sign up at [render.com](https://render.com) with **GitHub**, and allow it access to the Triplet
   repository (all repositories, or just this one).
2. In the dashboard, click **New** > **Blueprint**.
3. Pick the **Triplet** repository. Render reads `render.yaml` and shows one web service, `triplet`.
4. **Blueprint name:** `triplet`. **Branch:** `main`.
5. It asks for each setting marked `sync: false`. Fill them in:

   | Setting | Value |
   | --- | --- |
   | `DB_SETTINGS` | from step 1 |
   | `APP_URL` | `https://triplet.onrender.com` (a guess for now: fixed in 4d) |
   | `CORS_ORIGINS` | `["https://triplet.onrender.com"]` (with the brackets and quotes) |
   | `GEMINI_API_KEY` | from step 3 |
   | `SMTP_HOST`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM` | from step 2 |

   The rest (`ENVIRONMENT`, `API_PATH_PREFIX`, `TRUSTED_PROXY_HOPS`, `SMTP_PORT`) are already set,
   and `SECRET_KEY` is generated for you. Keep that key as it is: changing it signs everyone out.
6. Click **Deploy Blueprint** (or **Apply**).

### 4c. Watch the first build

1. Open the `triplet` service and its **Logs** (or **Events**) tab. The first build takes about
   5–10 minutes: it builds the website, then installs the server.
2. When it's done, the log ends with lines like:

   ```
   INFO  [alembic.runtime.migration] Running upgrade ... -> e6b3c1d8f027, email codes
   INFO:     Uvicorn running on http://0.0.0.0:10000
   ```

   and the service shows **Live**.

### 4d. Fix the address

1. The site's real address is at the top of the service page, under its name. If `triplet` was
   taken, it has something added, like `https://triplet-a1b2.onrender.com`.
2. If it differs from your guess: open **Environment**, change `APP_URL` and `CORS_ORIGINS` to the
   real address, and click **Save, rebuild, and deploy** (or **Save and deploy**).

### 4e. Check it works

1. Open `https://<your address>/api/` and you should see `{"message":"Triplet API is running"}`.
2. Open `https://<your address>/`: the sign-in screen.
3. Sign up with a real email address. The code should arrive within a minute; enter it and you're
   signed in.
4. Save a TikTok or YouTube link to a trip, to check Gemini works.
5. Reload the page on a trip (e.g. `/trips/1`): you stay signed in and on that page.

From now on, every push to `main` redeploys automatically.

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

1. Render > **Environment**: set `APP_URL` to `https://triplet.me` and `CORS_ORIGINS` to
   `["https://triplet.me"]`, and save (it redeploys).
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

## If something goes wrong

- **The build fails.** The log shows which step. A problem in the `web` stage is the website
  build; try `npx expo export --platform web` in `mobile/` on your computer to see the same error.
- **The log says `SECRET_KEY must be at least 32 random characters`** or another setting is
  missing or invalid: fix it under **Environment**.
- **`could not translate host name` or `password authentication failed`**: `DB_SETTINGS` is wrong.
  Copy it from Neon again and check it starts `postgresql+psycopg://`.
- **No code arrives**: check spam first. Then look in the Render logs for an email error, and check
  the `SMTP_*` values (a Brevo login is the `...@smtp-brevo.com` address, not your own email).
- **The website loads but signing in fails or you're signed out on reload**: `APP_URL` and
  `CORS_ORIGINS` must match the address in the browser exactly, with `https://` and no `/` at the end.
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

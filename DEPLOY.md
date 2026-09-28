# Putting Triplet online

One server runs both halves: the API at `/api` and the website at `/` (`serve.py`). Keeping them on
one address lets the website's sign-in cookie work (it's first-party and `SameSite=Strict`), so
the website and API must not live on different hosts.

The setup below is free: [Render](https://render.com) runs the server and [Neon](https://neon.tech)
holds the database. Render's free server sleeps after 15 idle minutes and takes about a minute to
wake; a paid plan ($7/month) stays awake.

## 1. Database (Neon)

1. Sign up at neon.tech and create a project (pick the region nearest your users).
2. Copy the connection string. It looks like
   `postgresql://user:password@ep-xxx.region.aws.neon.tech/neondb?sslmode=require`.
3. Put `+psycopg` after `postgresql`, giving
   `postgresql+psycopg://user:password@ep-xxx.region.aws.neon.tech/neondb?sslmode=require`.
   This is `DB_SETTINGS`.

The server creates the tables itself when it starts (`alembic upgrade head`).

## 2. Email (for sign-up codes and password resets)

Any SMTP service works. Without one, nobody can confirm their email and sign in. Free options:

- **Brevo**: 300 emails a day. Verify your sender address, then use SMTP host `smtp-relay.brevo.com`,
  port 587, and the SMTP login and key from *SMTP & API*.
- **Resend**: 100 a day, needs a domain you own. Host `smtp.resend.com`, username `resend`,
  password is an API key.
- **Gmail**: turn on 2-step verification, create an app password, then host `smtp.gmail.com` with your
  address and the app password. Fine for testing, but mail may land in spam.

`SMTP_FROM` must be an address the service lets you send from, e.g. `Triplet <you@example.com>`.

## 3. Server (Render)

1. Push this repository to GitHub.
2. In Render: **New > Blueprint**, pick the repository. It reads `render.yaml`.
3. Fill in the values it asks for. Render names the site after the service, e.g.
   `https://triplet.onrender.com` (check the name it shows), so:

   | Setting | Value |
   | --- | --- |
   | `DB_SETTINGS` | from step 1 |
   | `APP_URL` | `https://triplet.onrender.com` |
   | `CORS_ORIGINS` | `["https://triplet.onrender.com"]` |
   | `GEMINI_API_KEY` | your key from Google AI Studio |
   | `SMTP_*` | from step 2 |

   `SECRET_KEY` is generated for you. Keep it: changing it signs everyone out.
4. The first build takes several minutes. Then open the site, sign up, and enter the emailed code.

Every push to the main branch redeploys. To try the image locally first:

```
docker build -t triplet .
docker run -p 8000:8000 --env-file .env -e API_PATH_PREFIX=/api triplet
```

### Your own domain

In Render: the service's **Settings > Custom Domains**, then add the DNS record it shows. Update
`APP_URL` and `CORS_ORIGINS` to the new address.

## 4. The phone app

The app has to know where the API is. Store it in EAS for each build profile you use:

```
cd mobile
npx eas-cli@latest env:create --name EXPO_PUBLIC_API_URL --value https://triplet.onrender.com/api --environment preview --visibility plaintext
npx eas-cli@latest env:create --name EXPO_PUBLIC_API_URL --value https://triplet.onrender.com/api --environment production --visibility plaintext
```

Then build once (`npx eas-cli@latest build --profile preview --platform android`). After that,
JavaScript changes go out as updates without a new build; see *Shipping updates* in
`mobile/README.md`.

## Settings the server uses

`render.yaml` sets these for you:

- `ENVIRONMENT=production` hides the API docs and turns on HTTPS-only headers.
- `API_PATH_PREFIX=/api` matches the sign-in cookie's path to where `serve.py` mounts the API.
- `TRUSTED_PROXY_HOPS=1` reads visitors' real addresses (for rate limits) from the one proxy in front
  of Render's servers. Set it to 0 if nothing sits in front of the server, or else anyone could
  pretend to be any address.

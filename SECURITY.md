# Security

How Triplet protects accounts and data, what to set when deploying, and the risks we've accepted for now.

## What's in place

**Accounts**
- Passwords are hashed with Argon2 and must pass a strength check (zxcvbn, score 3+).
- Access tokens last 30 minutes. Refresh tokens are random, stored only as hashes, single-use, and reusing an old one signs the account out everywhere.
- Password reset links expire after 30 minutes, work once, and don't reveal whether an email has an account.
- Changing your email or password, or deleting your account, needs your current password.
- Emails are stored and compared lowercase. An unknown email takes as long to reject as a wrong password.

**Limits** (`rate_limit.py`, kept in the database so they survive restarts)

| What | Limit |
| --- | --- |
| Wrong passwords | 5 per email, 30 per network, per 15 min |
| New accounts | 5 per network per hour |
| Reset emails | 3 per address per hour (extras are silently not sent) |
| Token refreshes and reset-link checks | 60 per network per 5 min |
| Wrong guest PINs | 5 per trip code, 20 per network, per 15 min |
| Map searches | 120 per person per minute |
| Invites | 30 per person per hour |
| Saving or re-checking posts | 40 per person per day (`LINK_SAVES_DAILY_LIMIT`) |

**Data access**
- Every trip endpoint checks membership. Non-members get 404, so they can't tell a trip exists. Viewers can't change anything.
- Saving a link only downloads from TikTok, YouTube and Instagram (matched by exact domain), so the server can't be pointed at other addresses.

**Server**
- Every input has a length or size limit; requests over 1 MB are refused.
- Responses carry `nosniff`, `DENY` framing, `no-referrer` and `no-store`; production adds HSTS.
- The server refuses to start with a short or well-known `SECRET_KEY`.

**Website**
- `mobile/public/_headers` sets a Content Security Policy: only the site's own scripts run, which protects the sign-in token the website keeps in browser storage.

## Deploying checklist

- [ ] `ENVIRONMENT=production` (hides `/docs`, adds HSTS)
- [ ] A fresh `SECRET_KEY` from `python secret.py`, never reused from development
- [ ] `SQL_ECHO=false` (the default)
- [ ] `CORS_ORIGINS` set to the website's real address only
- [ ] `PASSWORD_RESET_URL` pointing at the real website
- [ ] Run uvicorn with `--proxy-headers --forwarded-allow-ips="*"` behind the host's proxy, so rate limits see real client addresses
- [ ] HTTPS only, for both the API and the website
- [ ] Host the website somewhere that applies `_headers` (Cloudflare Pages, Netlify), or copy those headers into the host's settings
- [ ] `alembic upgrade head` before starting the new version
- [ ] Database backups turned on at the host

## Accepted risks

- **Sign-up and invites reveal whether an email has an account.** They're rate-limited; hiding it fully needs email verification.
- **The website keeps its refresh token in browser storage** (the phone app uses the Keychain/Keystore). The Content Security Policy is the main protection. Moving it to an HttpOnly cookie needs the website and API on the same site (e.g. app.example.com and api.example.com).
- **npm audit shows moderate issues in `decode-uri-component` (via Expo Router) and `uuid` (via Expo's iOS build tools).** The first could at most slow the app on the user's own device with a crafted link; the second isn't used in the running app. Both clear up with Expo updates; forcing them now could break navigation.

## Checking dependencies

```bash
venv/Scripts/python -m pip_audit -r requirements.txt   # Python
cd mobile && npm audit --omit=dev                      # app
```

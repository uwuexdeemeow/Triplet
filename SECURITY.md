# Security

How Triplet protects accounts and data, what to set when deploying, and what's still open.

## What's in place

**Accounts**
- Passwords are hashed with Argon2 and must pass a strength check (zxcvbn, score 3+).
- Access tokens last 30 minutes. Refresh tokens are random, stored only as hashes, single-use, and reusing an old one signs the account out everywhere.
- An account is only created once its emailed six-digit code is entered; until then the sign-up waits in `pending_signups` and holds nothing. The code only works together with a token the sign-up screen got back, so someone who signs up first with your address (and a password they know) can't end up owning your account. Codes last 15 minutes, lock after 5 wrong tries, and a new one replaces the old. A new email address only takes effect once its inbox confirms it.
- Nothing reveals whether an email has an account: sign-up, "send a new code" and password reset answer the same either way (the real owner gets an email instead), and invites look the same whether or not the person is on Triplet. Names only show once someone joins a trip.
- People search only finds people you already share a trip with, by name.
- Password reset links expire after 30 minutes and work once.
- Changing your email or password, or deleting your account, needs your current password.
- Emails are stored and compared lowercase. An unknown email takes as long to reject as a wrong password.

**Limits** (`rate_limit.py`, kept in the database so they survive restarts)

| What | Limit |
| --- | --- |
| Wrong passwords | 5 per email, 30 per network, per 15 min |
| New accounts | 5 per network per hour |
| Reset emails | 3 per address per hour (extras are silently not sent) |
| Confirmation emails | 3 per address per hour (extras are silently not sent) |
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
- The website's refresh token is in an HttpOnly, `SameSite=Strict` cookie scoped to `/auth`, so page scripts can't read it. Only requests with the `X-Refresh-Cookie: 1` header use it, which browsers only send cross-origin after the API approves it (CORS), so other sites can't make use of the cookie. Phones keep theirs in the Keychain/Keystore.
- `mobile/public/_headers` sets a Content Security Policy: only the site's own scripts run.

## Deploying checklist

- [ ] `ENVIRONMENT=production` (hides `/docs`, adds HSTS)
- [ ] A fresh `SECRET_KEY` from `python secret.py`, never reused from development
- [ ] `SQL_ECHO=false` (the default)
- [ ] `CORS_ORIGINS` set to the website's real address only (exact origins; `*` is refused)
- [ ] The website and API on the same site, e.g. `triplet.app` and `api.triplet.app`. The sign-in cookie is `SameSite=Strict`, so a website on another domain can't keep people signed in
- [ ] `APP_URL` and `PASSWORD_RESET_URL` pointing at the real website (used in email links)
- [ ] SMTP settings filled in: without email, nobody can confirm their account
- [ ] Run uvicorn with `--proxy-headers --forwarded-allow-ips="*"` behind the host's proxy, so rate limits see real client addresses
- [ ] HTTPS only, for both the API and the website
- [ ] Host the website somewhere that applies `_headers` (Cloudflare Pages, Netlify), or copy those headers into the host's settings
- [ ] `alembic upgrade head` before starting the new version
- [ ] Database backups turned on at the host

## Accepted risks

None open right now. Closed:
- ~~Sign-up and invites revealed whether an email has an account~~: fixed by email confirmation (see Accounts).
- ~~The website kept its refresh token in browser storage~~: now an HttpOnly cookie.
- ~~npm audit issues in `decode-uri-component` and `uuid`~~: `mobile/package.json` overrides `uuid` to 11 for Expo's iOS build tools, and swaps `decode-uri-component` for a small linear-time version in `mobile/shims/`. Drop both overrides once Expo ships fixed versions.

## Checking dependencies

```bash
venv/Scripts/python -m pip_audit -r requirements.txt   # Python
cd mobile && npm audit --omit=dev                      # app
```

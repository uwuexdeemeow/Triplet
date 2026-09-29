# Triplet mobile app

Expo (React Native) app for iOS, Android and the web. It talks to the FastAPI backend in the parent folder.

## Run it on your computer

### 1. The backend (FastAPI, in the repo root)

One-time setup, from the repo root (Windows commands; on a Mac use `venv/bin/...` and `cp`):

```bash
python -m venv venv
venv\Scripts\pip install -r requirements.txt
copy .env.example .env
```

Then fill in `.env`: a PostgreSQL database in `DB_SETTINGS`, a `SECRET_KEY`, and email settings so
sign-up codes can be sent (`DEPLOY.md` explains each).

Each time you start it:

```bash
venv\Scripts\alembic upgrade head
venv\Scripts\uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

- `alembic upgrade head` brings the database up to date. Run it again after pulling changes that add a
  file to `alembic/versions`.
- `--host 0.0.0.0` lets a real phone on the same Wi-Fi reach it; leave it off if you only use the
  simulator or the website.
- `--reload` restarts it when you save a file. If a restart ever hangs (it can when started from a
  background shell on Windows), run it without `--reload` and restart it by hand.
- Check it's up at <http://localhost:8000/docs>.

### 2. The app (this folder)

1. Copy `.env.example` to `.env.local` and set `EXPO_PUBLIC_API_URL` for where you're running the app
   (the file lists the address for the website, the simulators and a real phone).
2. `npm install`
3. `npm run web`, `npm run android` or `npm run ios`.

Expo Go runs everything except **sharing into Triplet** from TikTok, which needs the app's own build (below).
Because the project includes `expo-dev-client`, `npx expo start` expects that build; start with `npx expo start --go` to keep using Expo Go.

## Builds (EAS)

Builds run in Expo's cloud, so no Xcode or Android Studio is needed. One-time setup:

```bash
npx eas-cli@latest login          # your Expo account
npx eas-cli@latest init           # links this folder to an Expo project (adds its id to app.json)
```

Builds draw maps with MapLibre and free OpenFreeMap tiles, like the website, so no Google Maps key or billing is needed. Expo Go keeps using its built-in Google and Apple maps (see `src/components/place-map.tsx`).

| Profile | For | Command |
| --- | --- | --- |
| `development` | Your phone, loading code from `npx expo start` like Expo Go, plus sharing | `npx eas-cli@latest build --profile development --platform android` |
| `development-simulator` | The iOS simulator | `npx eas-cli@latest build --profile development-simulator --platform ios` |
| `preview` | A standalone app to hand to testers | `npx eas-cli@latest build --profile preview --platform android` |
| `production` | The App Store, TestFlight and Google Play | `npx eas-cli@latest build --profile production --platform all` |

- After installing a development build, run `npx expo start` (add `--dev-client` if it opens Expo Go) and open the project from the Triplet app instead of Expo Go.
- The app ids are `com.uwuexdeemeow.triplet` (iOS and Android). Change them before the first store upload if you want different ones; after that they're fixed.

### Point tester builds at the online backend

`preview` and `production` builds have no dev server, and a tester's phone can't reach your computer, so
they need the backend online (set it up with `DEPLOY.md` in the repo root). Tell each EAS environment
where it is, once, using your own server's address:

```bash
npx eas-cli@latest env:create --name EXPO_PUBLIC_API_URL --value https://triplet.onrender.com/api --environment preview --visibility plaintext
npx eas-cli@latest env:create --name EXPO_PUBLIC_API_URL --value https://triplet.onrender.com/api --environment production --visibility plaintext
```

The address is baked into each build, so after changing it, rebuild or publish an update (below).

## Android: an APK for testers

The `preview` profile builds an `.apk`, which installs on any Android phone without Google Play.

```bash
npx eas-cli@latest build --profile preview --platform android
```

1. The first time, let EAS create the signing key when it asks. EAS keeps it, so always build from the
   same Expo account; that way new builds install over the old app.
2. The build takes about 10–20 minutes, then EAS prints a link and a QR code. The `.apk` can also be
   downloaded from the build's page on [expo.dev](https://expo.dev).
3. Send testers the link. They open it on the phone, download the file and tap it. Android asks once to
   allow installing apps from the browser (or the Files app).

Building on your own computer (`--local`) isn't supported on Windows, so use the cloud build.

## iPhone: a test app for chosen people

Apple doesn't allow installing an app file the way Android does, so every option needs a paid
[Apple Developer account](https://developer.apple.com/programs/) (US$99 a year). When EAS asks, sign in
with that Apple ID and let it create the certificates and profiles. There are two ways to share a build.

### Option A: TestFlight (recommended)

Testers install Apple's free TestFlight app and get Triplet from there. They don't need to send you
anything first.

```bash
npx eas-cli@latest build --profile production --platform ios --auto-submit
```

1. `--auto-submit` uploads the finished build to App Store Connect. The first time, it also creates the
   app there (the name can't already be taken on the App Store). Apple then processes the build for
   10–30 minutes. To upload an existing build instead: `npx eas-cli@latest submit --platform ios --latest`.
2. In [App Store Connect](https://appstoreconnect.apple.com) → your app → **TestFlight**, add testers:
   - **Internal testers** (up to 100): people you've added to your team under **Users and Access**.
     They can test straight away, with no review.
   - **External testers** (up to 10,000): make a group, then add people by email or turn on a
     **public link**. The first build for external testers needs a short Beta App Review (usually
     within a day).
3. Testers get an email or open the link, install **TestFlight**, and install Triplet from there.
   TestFlight tells them when there's a new build.

- Each build works for 90 days. `autoIncrement` in `eas.json` gives every production build a new build
  number, which Apple requires.
- App Store Connect asks about encryption for each build. Triplet only uses standard HTTPS, so the
  answer is "None of the algorithms mentioned above". To stop the question, add
  `"infoPlist": { "ITSAppUsesNonExemptEncryption": false }` under `ios` in `app.json`.

### Option B: Direct install (ad hoc)

Quicker for a few people you can reach directly, and no App Store Connect setup. But each iPhone must be
registered **before** the build, and a build only installs on the phones registered at the time. The
limit is 100 iPhones a year.

1. Register each tester's phone:
   ```bash
   npx eas-cli@latest device:create
   ```
   Choose the website link and send it to the tester. They open it in Safari on their iPhone and install
   the profile it offers (**Settings** → **Profile Downloaded** → **Install**), which tells EAS their
   phone's id.
2. Build, and include the registered phones when EAS asks:
   ```bash
   npx eas-cli@latest build --profile preview --platform ios
   ```
3. Send testers the link EAS prints. They open it in Safari on the iPhone and tap **Install**.
4. On iOS 16 and later, testers also turn on **Settings** → **Privacy & Security** → **Developer Mode**
   once (the phone restarts) before the app will open.

To add a phone after a build, register it, then run `npx eas-cli@latest build:resign` on that build (or
build again).

## Sign in with Google and Apple

The log-in and sign-up screens show **Continue with Google** (website, Android, iPhone) and
**Continue with Apple** (iPhone) once each is set up; until then they stay hidden.

| | Website | Android | iPhone |
| --- | --- | --- | --- |
| Google | as soon as `GOOGLE_CLIENT_IDS` is set on Render | new build | new build, only if the iOS client id is set |
| Apple | not set up | not available | new build |

How it works: the website (with Google's own button) or the phone signs in with Google or Apple and
sends the token they give it to the server (`/auth/social`), which checks it was signed by them, for
this app, with a confirmed email. The first time, it links to the Triplet account with that email,
or makes a new one. The website asks the server which Google client to use
(`/auth/sign-in-options`), so turning it on or off needs no rebuild.

### Apple

1. Needs the paid Apple Developer account (the same one as for TestFlight).
2. Nothing else to set up: `expo-apple-authentication` in `app.json` asks for the "Sign in with Apple"
   capability, and EAS turns it on for the app when it builds. The server accepts tokens for the
   bundle id `com.uwuexdeemeow.triplet` (`APPLE_CLIENT_IDS` in `config.py`; change it there if the
   bundle id ever changes).
3. Build for iPhone again (`build --profile preview --platform ios`, or TestFlight).

Apple lets people hide their email; their account then uses an `@privaterelay.appleid.com` address.
Apple only forwards mail to those from sender domains registered in the Apple Developer account
(**Certificates, Identifiers & Profiles** > **Services** > **Sign in with Apple for Email
Communication**), and a Gmail sender can't be registered. So until codes are sent from your own
domain, people who hide their email can sign in with Apple but won't get reset codes or invite
emails. Invites inside the app still show up.

### Google

1. In the [Google Cloud console](https://console.cloud.google.com), make a project (e.g. "Triplet"),
   then open **Google Auth Platform**:
   - **Branding**: app name Triplet, your support email.
   - **Audience**: External. While it says **Testing**, only the test users you list can sign in; click
     **Publish app** when you want anyone to (basic sign-in needs no review from Google).
2. **Clients** > **Create client**, three times:
   - **Web application**, named e.g. "Triplet". This is the one tokens are issued for, and the
     website's button uses it: copy its client id. Under **Authorized JavaScript origins**, add every
     address the website is opened at:
     - `https://triplet-ikz2.onrender.com` (and your own domain later)
     - `http://localhost` and `http://localhost:8081`, for `npm run web` on your computer

     No redirect addresses are needed. New origins can take a few minutes to start working.
   - **iOS**, bundle id `com.uwuexdeemeow.triplet`. Copy its client id.
   - **Android**, package name `com.uwuexdeemeow.triplet`, and the **SHA-1** of the app's signing key:
     run `npx eas-cli@latest credentials --platform android`, pick the profile, and copy the SHA-1
     it shows. (Once the app is on Google Play, add a second Android client with the SHA-1 from Play
     Console > **App signing**.)
3. Give the app the two ids, for each environment you build with:
   ```bash
   npx eas-cli@latest env:create --name EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID --value 1234-web.apps.googleusercontent.com --environment preview --visibility plaintext
   npx eas-cli@latest env:create --name EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID --value 1234-ios.apps.googleusercontent.com --environment preview --visibility plaintext
   ```
   Repeat with `--environment production` (and `development`), and put the same two lines in
   `.env.local` to try it from `npx expo start` on a development build.
4. Tell the server which tokens to accept: on Render, **Environment** > add `GOOGLE_CLIENT_IDS` with
   the **web** client id, e.g. `1234-web.apps.googleusercontent.com` (`["1234-web..."]` works too).
   If there are ever several, separate them with commas and put the web client first.
5. The website's button appears once Render has restarted with it. The phones need a new build.

**Google on Android only, not iPhone:** leave out `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` (and skip the iOS
client in step 2). The iPhone build then has no Google button, and Apple's rule that an iPhone app
offering Google sign-in must also offer Sign in with Apple doesn't apply. Android and the website are
unaffected.

### Accounts made this way

They have no password at first. Changing email or deleting the account asks for the current
password, so people add one with **Forgot password?** on the log-in screen: the emailed code proves
it's their inbox, the same as signing up. Signing in with Google or Apple keeps working either way.

## Shipping updates without a new build (EAS Update)

Most changes (screens, text, logic) can reach installed apps without reinstalling. Each build profile has a
channel of the same name in `eas.json`, and an installed app downloads the newest update on its channel when it
opens (it takes effect the next time it's opened).

```bash
# Publish what's in this folder to phones running a preview build
npx eas-cli@latest update --channel preview --environment preview --message "Fix the pull-down on the trips list"
```

- **A new build is still needed** after adding or upgrading a package with native code (like `expo-image-picker`),
  or changing `app.json` plugins or permissions. `runtimeVersion` uses the `fingerprint` policy, so an update is
  only offered to builds with the same native code; the rest keep what they have until they're rebuilt.
- The first build with `expo-updates` has to be made and installed once before updates can reach it.
- Updates use the same `EXPO_PUBLIC_*` variables as builds, from the EAS environment you name with
  `--environment` (set them with `eas env:create`), so point `EXPO_PUBLIC_API_URL` at the online backend.
- A bad update can be undone from the Expo dashboard or with `npx eas-cli@latest update:rollback`.

## Sharing into Triplet

In a development or store build, Triplet appears in the share menu: TikTok's **Share** button → **Triplet** (under "More" on iOS the first time) → pick a trip. The post is saved to that trip's Saved tab and its places are looked up as usual. If you're signed out, the share waits until you sign in.

How it works: `expo-share-intent` receives the share (iOS share extension, Android intent filter), `src/share/share-intent.tsx` opens `src/app/(app)/share.tsx`, and `src/app/+native-intent.tsx` routes the iOS share link there. In Expo Go and on the website it's switched off.

## Checks

```bash
npm run typecheck
npx expo lint
```

## API types

`src/api/schema.d.ts` is generated from the backend, so types always match its schemas.
After changing the backend's schemas, regenerate them:

```bash
# from the repo root: export the API description
venv/Scripts/python -c "import json, main; print(json.dumps(main.app.openapi(), indent=1))" > mobile/openapi.json
# from this folder
npm run api:types
```

## Layout

- `src/app/`: screens (Expo Router, one file per screen). `(auth)` is signed out, `(app)` is signed in.
- `src/api/`: API client (adds the access token and renews it when it expires) and generated types.
- `src/auth/`: session, token storage (Keychain/Keystore on phones, an HttpOnly cookie set by the API on web), form rules.
- `src/components/`: shared UI. `src/theme/tokens.ts`: colours, fonts and spacing from the design.

# Triplet mobile app

Expo (React Native) app for iOS, Android and the web. It talks to the FastAPI backend in the parent folder.

## Run it

1. Start the backend from the repo root: `uvicorn main:app --reload`
   (add `--host 0.0.0.0` when testing on a real phone).
2. Copy `.env.example` to `.env.local` and set `EXPO_PUBLIC_API_URL` for where you're running the app.
3. In this folder: `npm install`, then `npm run web`, `npm run android` or `npm run ios`.

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
| `production` | The App Store and Google Play | `npx eas-cli@latest build --profile production --platform all` |

- **Android** builds install straight from the link EAS prints.
- **iPhone** builds need an Apple Developer account, and each test phone registered once with `npx eas-cli@latest device:create`.
- After installing a development build, run `npx expo start` (add `--dev-client` if it opens Expo Go) and open the project from the Triplet app instead of Expo Go.
- `preview` and `production` builds have no dev server, so they need the backend online: set `EXPO_PUBLIC_API_URL` for those environments with `eas env:create`.

The app ids are `com.uwuexdeemeow.triplet` (iOS and Android). Change them before the first store upload if you want different ones; after that they're fixed.

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
- `src/auth/`: session, token storage (Keychain/Keystore on phones, localStorage on web), form rules.
- `src/components/`: shared UI. `src/theme/tokens.ts`: colours, fonts and spacing from the design.

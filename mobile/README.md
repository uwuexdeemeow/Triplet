# Triplet mobile app

Expo (React Native) app for iOS, Android and the web. It talks to the FastAPI backend in the parent folder.

## Run it

1. Start the backend from the repo root: `uvicorn main:app --reload`
   (add `--host 0.0.0.0` when testing on a real phone).
2. Copy `.env.example` to `.env.local` and set `EXPO_PUBLIC_API_URL` for where you're running the app.
3. In this folder: `npm install`, then `npm run web`, `npm run android` or `npm run ios`.

Sharing from TikTok and maps need a development build (`npx expo run:android`), not Expo Go.

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

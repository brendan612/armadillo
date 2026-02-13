# armadillo

Armadillo is a local-first encrypted password vault.

- Canonical storage is an encrypted `.armadillo` vault file per device.
- Master password unlock is required.
- Optional cloud sync replicates encrypted saves only.

## What is implemented

- Encrypted vault file format (`armadillo-v1`) with wrapped vault keys.
- Master-password create/unlock flows.
- Import/export transferable `.armadillo` files.
- Credential CRUD in decrypted in-memory session only.
- Optional cloud sync over Convex HTTP actions:
  - `POST /api/sync/pull`
  - `POST /api/sync/push`
- Convex Auth routes enabled with Google OAuth provider wiring.
- Optional passkey identity binding for owner hinting.
- Biometric quick-unlock adapter (device-bound, local only) for supported platforms.

## Run web

```bash
npm install
npm run dev
```

## Run Electron desktop

```bash
npm run dev:electron
```

## Build Windows installer (.exe)

```bash
npm install
npm run dist:win
```

Output:

- `release/Armadillo-Setup-<version>-x64.exe`

Notes:

- This build is unsigned in the current setup, so Windows SmartScreen warnings are expected.

## Build Android APK (.apk)

Prerequisites:

- Android SDK + Android command-line tools
- JDK 17

First-time Android project setup:

```bash
npx cap add android
```

Build a sideloadable debug APK:

```bash
npm install
npm run apk:debug
```

Output:

- `android/app/build/outputs/apk/debug/app-debug.apk`

Optional release APK (unsigned):

```bash
npm run apk:release
```

## Convex setup

```bash
npx convex dev
```

Client `.env` values:

```bash
VITE_CONVEX_URL=https://<your-deployment>.convex.cloud
VITE_CONVEX_HTTP_URL=https://<your-deployment>.convex.site
```

Convex Auth Google provider env values (set in Convex deployment env):

```bash
AUTH_GOOGLE_ID=<google-oauth-client-id>
AUTH_GOOGLE_SECRET=<google-oauth-client-secret>
```

## Security notes

- Local vault KDF now uses Argon2id parameters embedded per vault file.
- Existing legacy PBKDF2 vaults remain unlockable (compat fallback).
- Cloud stores only encrypted vault saves; decryption is client-side only.
- Biometric quick-unlock is device-local and requires prior master-password unlock/enrollment.


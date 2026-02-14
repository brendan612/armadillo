# armadillo

Armadillo is an encrypted password vault with selectable local-first or cloud-only storage modes.

- Local-file mode stores an encrypted `.armadillo` file per device.
- Cloud-only mode stores no permanent local vault file; it keeps an encrypted cache with TTL.
- Master password unlock is required.
- Optional cloud sync replicates encrypted saves only (client-side decryption).

## What is implemented

- Encrypted vault file format (`armadillo-v1`) with wrapped vault keys.
- Storage mode switch: `Local File` or `Cloud Only`.
- Master-password create/unlock flows.
- Import/export transferable `.armadillo` files.
- Import credentials from Google Password Manager CSV exports (`name,url,username,password,note`).
- Auto-folder unfiled credentials with an explainable preview/apply workflow, editable assignments, exclusions/locks, and saved grouping preferences.
- Credential CRUD in decrypted in-memory session only.
- Optional sync-provider abstraction:
  - `convex` provider (existing Convex HTTP actions)
  - `self_hosted` provider (expected endpoints):
    - `POST /v1/auth/status`
    - `POST /v1/vaults/pull-by-owner`
    - `POST /v1/vaults/list-by-owner`
    - `POST /v1/vaults/:vaultId/pull`
    - `POST /v1/vaults/:vaultId/push`
    - `POST /v1/events/token` + `GET /v1/events/stream` (SSE push updates with short-lived signed stream tokens)
    - `GET /v1/orgs`
    - `POST /v1/orgs`
    - `POST /v1/vaults/:vaultId/members`
    - `DELETE /v1/vaults/:vaultId/members/:memberId`
    - `POST /v1/vaults/:vaultId/rekey`
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
VITE_SYNC_PROVIDER=convex
VITE_SYNC_BASE_URL=
VITE_SYNC_AUTH_TOKEN=
```

`VITE_SYNC_PROVIDER` values:

- `convex` (default): uses Convex auth + sync endpoints
- `self_hosted`: uses `VITE_SYNC_BASE_URL` endpoints and optional bearer token

Convex Auth Google provider env values (set in Convex deployment env):

```bash
AUTH_GOOGLE_ID=<google-oauth-client-id>
AUTH_GOOGLE_SECRET=<google-oauth-client-secret>
```

## Self-hosted sync gateway (local baseline)

```bash
npm run sync:selfhost:dev
```

Then set:

```bash
VITE_SYNC_PROVIDER=self_hosted
VITE_SYNC_BASE_URL=http://localhost:8787
```

## Security notes

- Local vault KDF now uses Argon2id parameters embedded per vault file.
- Existing legacy PBKDF2 vaults remain unlockable (compat fallback).
- Cloud stores only encrypted vault saves; decryption is client-side only.
- Cloud-only mode keeps an encrypted cache with configurable TTL for offline unlock.
- Biometric quick-unlock is device-local and requires prior master-password unlock/enrollment.


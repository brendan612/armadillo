# Armadillo

![Armadillo hero placeholder](docs/assets/readme/hero-placeholder.svg)

Armadillo is a secure, cross-platform password vault focused on fast local unlock, encrypted cloud sync, and practical enterprise controls.

Current version: `1.0.0-beta.1`

## Product Snapshot

- End-to-end encrypted vault data (decrypts client-side only)
- Local-file mode or cloud-only mode
- Desktop (Electron), Web (Vite), and Android support
- Import support for Google Password CSV + KeePass XML/CSV
- Biometric unlock + Android autofill bridge
- Enterprise-ready foundations: org-scoped auth context, RBAC, audit endpoints, health/metrics endpoints

## App Preview

### Desktop Experience

![Desktop placeholder](docs/assets/readme/desktop-placeholder.svg)

### Mobile Experience

![Mobile placeholder](docs/assets/readme/mobile-placeholder.svg)

## Why Armadillo

- Private by default: encrypted snapshots only, no plaintext vault storage in sync backends
- Flexible deployment: managed sync provider or self-hosted gateway
- Fast workflow: quick search, folder organization, import/export, and mobile navigation
- Upgrade path for teams: entitlement tiers and enterprise capability gates

## Platform Support

- Web app
- Windows desktop installer (`.exe`)
- Android APK

## Quick Start

```bash
npm install
npm run dev
```

Web dev server runs with Vite.

## Desktop Run

```bash
npm run dev:electron
```

## Build Artifacts

### Windows Installer

```bash
npm run dist:win
```

Output:

- `release/Armadillo-Setup-<version>-x64.exe`

Signing:

- Set `CSC_LINK` and `CSC_KEY_PASSWORD` for signed release artifacts.
- Validate signing env locally with:

```bash
npm run release:check-signing
```

### Android APK

```bash
npm run apk:debug
npm run apk:release
```

Output:

- `android/app/build/outputs/apk/...`

## Cloud + Sync Setup

Client env example:

```bash
VITE_CONVEX_URL=https://<your-deployment>.convex.cloud
VITE_CONVEX_HTTP_URL=https://<your-deployment>.convex.site
VITE_SYNC_PROVIDER=convex
VITE_SYNC_BASE_URL=
VITE_SYNC_AUTH_TOKEN=
VITE_BILLING_URL=https://example.com/upgrade
VITE_ENTITLEMENT_JWKS={"keys":[{"kty":"OKP","crv":"Ed25519","x":"<public-x>","kid":"dev-key","alg":"EdDSA","use":"sig"}]}
```

`VITE_SYNC_PROVIDER`:

- `convex` (default)
- `self_hosted`

## Self-Hosted Gateway

Run local gateway:

```bash
npm run sync:selfhost:dev
```

Set client env:

```bash
VITE_SYNC_PROVIDER=self_hosted
VITE_SYNC_BASE_URL=http://localhost:8787
```

Optional Postgres migration bootstrap:

```bash
SYNC_DATABASE_URL=postgres://<user>:<pass>@<host>:5432/<db> npm run sync:selfhost:migrate
```

## Entitlements

Generate local signing keys:

```bash
npm run entitlement:keygen
```

Sign a development entitlement token:

```bash
ENTITLEMENT_DEV_PRIVATE_JWK='<private-jwk-json>' npm run entitlement:sign -- --tier enterprise --sub dev-user --days 30
```

Manual signed token input is kept as a break-glass/admin path in settings.

## Security Notes

- Local vault KDF: Argon2id (legacy PBKDF2 unlock compatibility retained)
- Cloud stores encrypted saves only
- Biometric quick unlock is device-local
- Self-hosted v2 API includes org-scoped auth context, RBAC, audit, and ops endpoints

## Quality Gate

```bash
npm run ci:check
```

Includes lint, typecheck, tests, and production web build.

## Documentation

- `services/sync-gateway/README.md` for self-hosted endpoint and env details
- `docs/security/*` for security policies/runbooks
- `docs/compliance/*` for SOC2/GDPR readiness drafts
- `docs/operations/*` for SLO and backup drill baselines

## Art Placeholders To Replace

- `docs/assets/readme/hero-placeholder.svg`
- `docs/assets/readme/desktop-placeholder.svg`
- `docs/assets/readme/mobile-placeholder.svg`

Recommended replacements:

- Hero art: 1600x900
- Desktop screenshot: 1200x760
- Mobile screenshot: 900x1200

# AGENTS.md

## Purpose
This file is the stable engineering context for Armadillo.
Use it for architecture, design intent, and implementation conventions.

Do not use this file as a chronological patch log.
Rely on Git history for detailed per-change records.

## Update Policy
- Keep this file concise and durable.
- Update only when core architecture, key workflows, or design conventions change.
- Prefer summaries of long-term decisions over task-by-task notes.

## Product Direction
Armadillo is a cross-platform secure vault with:
- Local encrypted vault files (`.armadillo`) and optional cloud sync.
- Desktop (Electron), Web (Vite), and Android support.
- Fast unlock, strong offline behavior, and practical enterprise controls.

## High-Level Architecture
- App state orchestration: `src/app/hooks/useVaultApp.ts`
- View routing by app phase (`create` / `unlock` / `ready`): `src/app/AppRouter.tsx`
- Main shell and panes: `src/app/AppShell.tsx`
- Shared state access via context: `src/app/contexts/VaultAppContext.tsx`

## Core Domains

### Vault File + Crypto
- Local vault file utilities: `src/lib/vaultFile.ts`
- Encryption/KDF primitives: `src/lib/crypto.ts`
- Vault payload/types: `src/types/vault.ts`
- Optional offline Recovery Kit:
  - Recovery key wraps the vault key with a separate Argon2id config.
  - Recovery metadata is persisted inside the `.armadillo` file as an optional `recovery` block.
  - Recovery key plaintext is one-time display only and must not be persisted to local storage.
- Local vault selection metadata:
  - Active local path is stored separately from vault data.
  - Recent local paths are tracked for quick reselect.

### Sync + Cloud
- Sync abstraction entrypoint: `src/lib/syncClient.ts`
- Provider adapters:
  - Convex: `src/lib/providers/convexProvider.ts`
  - Self-hosted: `src/lib/providers/selfHostedProvider.ts`
- Auth/sync status and gating are resolved in `useVaultApp`.

### Entitlements + Feature Flags
- Entitlement resolution and capability checks live in `useVaultApp` and flags modules:
  - `src/features/flags/*`
- UI should respect capability gates before rendering privileged controls.

## Locked/Unlock UX Conventions
- Locked-state vault loading is handled in a unified selector card.
- Local and cloud sources share the same visual footprint via tabs.
- Cloud tab defaults to latest snapshot selection.
- Creating a named local vault should not be treated as an error state while pre-file-creation is expected.
- Quick unlock supports passkeys on desktop/web and biometrics on Android; enrollment is manual per device and requires one successful master-password unlock first.

## Home / At-a-Glance Conventions
- If vault is empty, show a welcome-first state.
- Provide a quick "New Entry" flow with entry-type selection.
- For non-empty vaults, show search, risk summary, and recent updates.

## UI Design Principles
- Keep auth and first-run surfaces compact and task-focused.
- Prefer clear, minimal controls over stacked heavy cards.
- Use consistent component styling for primary auth actions.
- Keep cloud-auth actions capability-aware and sync-mode-aware.

## Electron Integration Notes
- Desktop bridge lives in:
  - Main process: `electron/main.cjs`
  - Preload bridge: `electron/preload.cjs`
- Vault path chooser operations are desktop-specific and exposed via `window.armadilloShell`.

## Testing + Quality
- Type check: `npm run typecheck`
- Lint: `npm run lint`
- Full CI check: `npm run ci:check`

## Source of Truth for Change History
- Use Git commits / PRs for detailed patch chronology.
- Keep this file focused on persistent architecture and design guidance.

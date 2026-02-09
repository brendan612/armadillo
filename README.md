# armadillo

Armadillo is a cross-platform password manager frontend prototype with an Electron desktop shell and Convex-backed sync endpoints.

## What is implemented

- Distinctive Armadillo design system across web, desktop, and mobile modes
- 3-pane desktop/web workspace + progressive mobile panes
- Platform preview switch (`Auto`, `Web`, `Desktop`, `Mobile`)
- Electron shell integration via preload bridge
- Convex backend schema + HTTP endpoints for vault item list/upsert/delete
- Functional CRUD (create, edit, delete) with local-storage fallback when Convex is unavailable

## Run web

```bash
npm install
npm run dev
```

## Run Electron desktop

```bash
npm run dev:electron
```

## Convex setup

1. Log in and create/link a Convex project:

```bash
npx convex dev
```

2. Add env vars to `.env` (use `.env.example` as template):

```bash
VITE_CONVEX_URL=https://<your-deployment>.convex.cloud
VITE_CONVEX_HTTP_URL=https://<your-deployment>.convex.site
```

3. Restart `npm run dev`.

## Convex endpoints used by the UI

- `POST /api/items/list`
- `POST /api/items/upsert`
- `POST /api/items/delete`

Owner resolution is automatic:
- Uses authenticated user subject when auth is configured/present.
- Falls back to an anonymous device owner key via `x-armadillo-owner`.

## Build

```bash
npm run build
```

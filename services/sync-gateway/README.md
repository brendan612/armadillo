# Self-Hosted Sync Gateway

Self-hosted sync gateway for Armadillo `VITE_SYNC_PROVIDER=self_hosted` with:
- v2 org-scoped auth context
- role-based access control (`owner`, `admin`, `editor`, `viewer`)
- audit log endpoints
- health/readiness/metrics endpoints
- rate limiting, request-size limits, and idempotent push support
- backward-compatible v1 routes for older clients

## Run

```bash
npm run sync:selfhost:dev
```

Optional environment variables:

```bash
PORT=8787
SYNC_DATA_FILE=services/sync-gateway/data.json
SYNC_DATABASE_URL=
SYNC_ENTERPRISE_MODE=false
SYNC_CORS_ORIGINS=http://localhost:5173,http://localhost:4000
SYNC_STREAM_TOKEN_SECRET=<secret>
SYNC_SESSION_TOKEN_SECRET=<secret>
SYNC_STREAM_TOKEN_TTL_MS=120000
SYNC_MAX_REQUEST_BYTES=1048576
SYNC_RATE_LIMIT_WINDOW_MS=60000
SYNC_RATE_LIMIT_MAX=300
SYNC_ENTITLEMENT_TOKEN=<signed-jwt>
```

## Client `.env` example

```bash
VITE_SYNC_PROVIDER=self_hosted
VITE_SYNC_BASE_URL=http://localhost:8787
VITE_SYNC_AUTH_TOKEN=
```

## Optional Postgres migration bootstrap

```bash
SYNC_DATABASE_URL=postgres://<user>:<pass>@<host>:5432/<db> npm run sync:selfhost:migrate
```

## Core v2 endpoints

- `POST /v2/auth/status`
- `GET /v2/entitlements/me`
- `POST /v2/vaults/pull-by-owner`
- `POST /v2/vaults/list-by-owner`
- `POST /v2/vaults/:vaultId/pull`
- `POST /v2/vaults/:vaultId/push` (`Idempotency-Key` supported)
- `POST /v2/events/token`
- `GET /v2/vaults/:vaultId/events?streamToken=<token>`
- `GET /v2/orgs/:orgId/audit`
- `POST /v2/orgs/:orgId/members`
- `DELETE /v2/orgs/:orgId/members/:memberId`
- `GET /healthz`
- `GET /readyz`
- `GET /metrics`

## Legacy v1 compatibility endpoints

- `POST /v1/auth/status`
- `POST /v1/vaults/pull-by-owner`
- `POST /v1/vaults/list-by-owner`
- `POST /v1/vaults/:vaultId/pull`
- `POST /v1/vaults/:vaultId/push`
- `POST /v1/events/token`
- `GET /v1/events/stream?streamToken=<token>`
- `GET /v1/orgs`
- `POST /v1/orgs`

## Notes

- This gateway stores encrypted snapshots only; decryption remains client-side.
- In enterprise mode (`SYNC_ENTERPRISE_MODE=true`), v2 endpoints require authenticated org-scoped context.
- v1 routes remain available for migration compatibility.

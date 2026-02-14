# Self-Hosted Sync Gateway

Minimal self-hosted sync gateway for Armadillo `VITE_SYNC_PROVIDER=self_hosted`.

## Run

```bash
npm run sync:selfhost:dev
```

Optional environment variables:

```bash
PORT=8787
SYNC_DATA_FILE=services/sync-gateway/data.json
```

## Client `.env` example

```bash
VITE_SYNC_PROVIDER=self_hosted
VITE_SYNC_BASE_URL=http://localhost:8787
VITE_SYNC_AUTH_TOKEN=
```

## Implemented endpoints

- `POST /v1/auth/status`
- `POST /v1/vaults/pull-by-owner`
- `POST /v1/vaults/list-by-owner`
- `POST /v1/vaults/:vaultId/pull`
- `POST /v1/vaults/:vaultId/push`
- `POST /v1/events/token` (mints short-lived signed SSE token for a vault)
- `GET /v1/events/stream?streamToken=<token>`
- `GET /v1/orgs`
- `POST /v1/orgs`
- `POST /v1/vaults/:vaultId/members`
- `DELETE /v1/vaults/:vaultId/members/:memberId?orgId=<orgId>`
- `POST /v1/vaults/:vaultId/rekey`

## Notes

- This gateway stores encrypted snapshots only. Decryption remains client-side.
- Authentication in this minimal server is token/header-based and intended as a local/dev baseline.
- SSE stream auth is hardened with short-lived signed stream tokens (clients no longer pass raw auth tokens in SSE URLs).

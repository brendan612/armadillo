# Key Management Notes

## Current model
- Vault encryption keys are generated client-side.
- Vault keys are wrapped with master-derived keys.
- Sync backends persist encrypted data only.

## Entitlement signing
- Entitlement JWTs are verified against configured JWKS.
- Manual entitlement entry is break-glass/admin-oriented.

## Operational requirements
- Rotate signing and stream-token secrets on schedule.
- Store secrets in managed secret vaults (not repo/env files in production).

# Security Overview

## Data model
- Vault payloads are encrypted client-side before sync.
- Sync services persist encrypted blobs only.
- Decryption keys are not sent to sync backends.

## Identity and access
- v2 sync endpoints use org-scoped auth context (`subject`, `orgId`, `roles`, `sessionId`).
- Role enforcement levels: `viewer`, `editor`, `admin`, `owner`.
- Enterprise mode can require authenticated context for all v2 routes.

## Controls
- Request size limits
- Rate limiting
- Signed short-lived SSE stream tokens
- Audit event capture for auth/admin/vault writes

## Next controls in roadmap
- External key management integration
- Formal threat model publication
- Third-party penetration testing cadence

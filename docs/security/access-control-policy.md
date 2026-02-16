# Access Control Policy

## Principles
- Least privilege by default.
- Role-based authorization enforced server-side.
- Administrative actions must be auditable.

## Roles
- `viewer`: read-only vault access.
- `editor`: create/update vault snapshots.
- `admin`: member management and audit access.
- `owner`: full organizational control.

## Session requirements
- Session context includes `subject`, `orgId`, `roles`, and `sessionId`.
- Session expiration is mandatory in enterprise mode.

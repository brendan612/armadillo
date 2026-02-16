# Backup and Restore Drill (Draft)

## Backup scope
- Sync gateway data store (`services/sync-gateway/data.json` in file mode)
- Secret material references (not plaintext secrets)

## Drill steps
1. Capture pre-drill checksum
2. Create backup artifact
3. Simulate corruption/loss
4. Restore backup artifact
5. Validate endpoint health and sample tenant data retrieval

## Evidence
- Drill date/time
- Operator
- Restore duration
- Verification outcome

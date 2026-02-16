# Incident Response Runbook

## Severity levels
- `SEV-1`: Active data exposure or systemic service outage.
- `SEV-2`: Major degradation with customer impact.
- `SEV-3`: Limited impact or contained fault.

## Response flow
1. Triage and assign incident commander.
2. Contain impact (disable affected endpoints, revoke tokens, isolate tenants if required).
3. Preserve evidence (logs, audit records, deployment metadata).
4. Mitigate and verify recovery.
5. Publish postmortem and corrective actions.

## Required artifacts
- Timeline of events (UTC)
- Root cause statement
- Customer impact summary
- Mitigation and permanent fix list

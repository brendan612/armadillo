# SLO and On-Call Baseline

## SLO targets (pilot)
- API availability: 99.5% monthly
- P95 sync API latency: < 500 ms (steady state)
- SSE reconnect success: > 99%

## Alert triggers
- 5xx error rate spike
- sustained auth failures
- push conflict anomaly
- SSE disconnect anomaly

## On-call actions
1. Acknowledge alert
2. Assess blast radius
3. Mitigate and communicate
4. Post-incident review

import test from 'node:test'
import assert from 'node:assert/strict'
import { createAdminClient, providerBasePath } from './index.ts'

test('providerBasePath returns provider-specific admin roots', () => {
  assert.equal(providerBasePath('convex'), '/api/v2/admin')
  assert.equal(providerBasePath('self_hosted'), '/v2/admin')
})

test('convex client normalizes trailing slashes and query params', async (t) => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    return new Response(JSON.stringify({ vaults: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch

  t.after(() => {
    globalThis.fetch = originalFetch
  })

  const client = createAdminClient({
    provider: 'convex',
    baseUrl: 'https://example.convex.site/',
    getAuthToken: () => 'token-123',
    getOrgId: () => 'org_alpha',
  })

  const response = await client.listVaults('org_alpha')
  assert.deepEqual(response.vaults, [])
  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.url, 'https://example.convex.site/api/v2/admin/vaults?orgId=org_alpha')
  assert.equal((calls[0]?.init?.headers as Record<string, string>).Authorization, 'Bearer token-123')
  assert.equal((calls[0]?.init?.headers as Record<string, string>)['x-armadillo-org'], 'org_alpha')
})

test('self-hosted client normalizes subscription responses', async (t) => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response(JSON.stringify({
    subscription: {
      id: 'subscription_1',
      scopeType: 'org',
      scopeId: 'org_ops',
      tier: 'premium',
      status: 'active',
      billingMode: 'manual',
      seatLimit: 8,
      storageLimitBytes: 4096,
      renewalAt: '2026-04-01T00:00:00.000Z',
      endAt: null,
      note: 'renews monthly',
      updatedAt: '2026-03-06T00:00:00.000Z',
      updatedBy: 'user:admin',
    },
    effective: {
      source: 'subscription',
      tier: 'premium',
      capabilities: ['cloud.sync', 'vault.storage'],
      flags: { 'billing.plans_section': true },
      reason: 'premium subscription',
      seatLimit: 8,
      storageLimitBytes: 4096,
    },
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })) as typeof fetch

  t.after(() => {
    globalThis.fetch = originalFetch
  })

  const client = createAdminClient({
    provider: 'self_hosted',
    baseUrl: 'http://localhost:8787/',
    getAuthToken: () => 'operator-token',
  })

  const response = await client.getSubscription('org', 'org_ops')
  assert.equal(response.subscription?.scopeId, 'org_ops')
  assert.equal(response.subscription?.tier, 'premium')
  assert.equal(response.effective.source, 'subscription')
  assert.equal(response.effective.storageLimitBytes, 4096)
})

test('client normalizes derived entitlement overrides', async (t) => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response(JSON.stringify({
    ok: true,
    override: {
      id: 'override_1',
      targetType: 'email',
      targetValue: 'user@example.com',
      mode: 'derived',
      tier: 'premium',
      capabilities: ['cloud.sync', 'vault.storage'],
      note: 'support override',
      updatedAt: '2026-03-06T00:00:00.000Z',
      updatedBy: 'user:admin',
    },
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })) as typeof fetch

  t.after(() => {
    globalThis.fetch = originalFetch
  })

  const client = createAdminClient({
    provider: 'convex',
    baseUrl: 'https://example.convex.site',
    getAuthToken: () => 'token-123',
  })

  const response = await client.upsertOverride({
    targetType: 'email',
    targetValue: 'user@example.com',
    tier: 'premium',
    capabilities: ['cloud.sync', 'vault.storage'],
  })

  assert.equal(response.ok, true)
  assert.equal(response.override?.mode, 'derived')
  assert.equal(response.override?.tier, 'premium')
  assert.deepEqual(response.override?.capabilities, ['cloud.sync', 'vault.storage'])
})

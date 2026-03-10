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

test('client sends org update and member email payloads', async (t) => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    return new Response(JSON.stringify({ ok: true, org: { id: 'org_alpha', name: 'Alpha', createdAt: '2026-03-06T00:00:00.000Z' } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch

  t.after(() => {
    globalThis.fetch = originalFetch
  })

  const client = createAdminClient({
    provider: 'self_hosted',
    baseUrl: 'http://localhost:8787',
    getAuthToken: () => 'operator-token',
  })

  await client.updateOrg('org_alpha', { name: 'Alpha' })
  await client.upsertMember('org_alpha', { memberId: 'user:alpha', email: 'alpha@example.com', role: 'admin' })

  assert.equal(calls[0]?.url, 'http://localhost:8787/v2/admin/orgs/org_alpha')
  assert.equal(calls[0]?.init?.method, 'PUT')
  assert.equal(calls[0]?.init?.body, JSON.stringify({ name: 'Alpha' }))
  assert.equal(calls[1]?.url, 'http://localhost:8787/v2/admin/orgs/org_alpha/members')
  assert.equal(calls[1]?.init?.method, 'POST')
  assert.equal(calls[1]?.init?.body, JSON.stringify({ memberId: 'user:alpha', email: 'alpha@example.com', role: 'admin' }))
})

test('convex client sends invites to the dedicated invites endpoint', async (t) => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    return new Response(JSON.stringify({
      member: {
        memberId: 'invite:member@example.com',
        email: 'member@example.com',
        role: 'viewer',
        addedAt: '2026-03-10T00:00:00.000Z',
      },
      emailSent: true,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch

  t.after(() => {
    globalThis.fetch = originalFetch
  })

  const client = createAdminClient({
    provider: 'convex',
    baseUrl: 'https://example.convex.site',
    getAuthToken: () => 'token-123',
    getOrgId: () => 'org_alpha',
  })

  const response = await client.inviteMember('org_alpha', { email: 'member@example.com', role: 'viewer' })
  assert.equal(response.emailSent, true)
  assert.equal(calls[0]?.url, 'https://example.convex.site/api/v2/admin/invites')
  assert.equal(calls[0]?.init?.method, 'POST')
  assert.equal(calls[0]?.init?.body, JSON.stringify({ orgId: 'org_alpha', email: 'member@example.com', role: 'viewer' }))
})

test('self-hosted client rejects invite email delivery', async () => {
  const client = createAdminClient({
    provider: 'self_hosted',
    baseUrl: 'http://localhost:8787',
    getAuthToken: () => 'operator-token',
  })

  await assert.rejects(
    () => client.inviteMember('org_alpha', { email: 'member@example.com', role: 'viewer' }),
    /not supported on the self-hosted provider/i,
  )
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'

function randomPort() {
  return 30000 + Math.floor(Math.random() * 20000)
}

async function waitForReady(baseUrl, timeoutMs = 10000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/healthz`)
      if (response.ok) {
        return
      }
    } catch {
      // Retry until timeout.
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error('Timed out waiting for sync-gateway to become ready')
}

function createSignedEntitlementToken() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
  const now = Math.floor(Date.now() / 1000)
  const kid = 'test-admin-key'
  const header = { alg: 'EdDSA', typ: 'JWT', kid }
  const payload = {
    iss: 'armadillo-tests',
    sub: 'test-admin',
    aud: 'armadillo',
    iat: now,
    exp: now + 60 * 60,
    tier: 'enterprise',
    capabilities: ['enterprise.org_admin'],
  }
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url')
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signingInput = `${encodedHeader}.${encodedPayload}`
  const signature = crypto.sign(null, Buffer.from(signingInput, 'utf8'), privateKey).toString('base64url')
  const token = `${encodedHeader}.${encodedPayload}.${signature}`

  const publicJwk = publicKey.export({ format: 'jwk' })
  return {
    token,
    jwks: {
      keys: [{ ...publicJwk, kid, alg: 'EdDSA', use: 'sig' }],
    },
  }
}

function spawnServer(envOverrides = {}) {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'armadillo-sync-test-'))
  const port = randomPort()
  const dataFile = path.join(tempDir, 'data.json')
  const child = spawn(
    process.execPath,
    ['services/sync-gateway/server.mjs'],
    {
      env: {
        ...process.env,
        PORT: String(port),
        SYNC_DATA_FILE: dataFile,
        SYNC_ENTITLEMENT_TOKEN: 'signed-test-token',
        ...envOverrides,
      },
      stdio: 'ignore',
      windowsHide: true,
    },
  )
  const baseUrl = `http://127.0.0.1:${port}`

  async function cleanup() {
    if (!child.killed) {
      child.kill()
    }
    rmSync(tempDir, { recursive: true, force: true })
  }

  return { child, baseUrl, cleanup }
}

async function fetchJson(url, init = {}) {
  const response = await fetch(url, init)
  const text = await response.text()
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
  }
}

test('v2 auth status and entitlement endpoints respond', async (t) => {
  const server = spawnServer()
  t.after(async () => {
    await server.cleanup()
  })

  await waitForReady(server.baseUrl)

  const authStatus = await fetch(`${server.baseUrl}/v2/auth/status`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-armadillo-owner': 'test-device',
    },
    body: '{}',
  }).then((res) => res.json())

  assert.equal(authStatus.authenticated, true)
  assert.equal(typeof authStatus.authContext?.orgId, 'string')
  assert.equal(authStatus.authContext?.subject, 'anon:test-device')

  const entitlement = await fetch(`${server.baseUrl}/v2/entitlements/me`, {
    headers: {
      'x-armadillo-owner': 'test-device',
    },
  }).then((res) => res.json())

  assert.equal(entitlement.ok, true)
  assert.equal(entitlement.token, 'signed-test-token')
})

test('v2 push and pull round-trip snapshot', async (t) => {
  const server = spawnServer()
  t.after(async () => {
    await server.cleanup()
  })

  await waitForReady(server.baseUrl)

  const snapshot = {
    format: 'armadillo-v1',
    vaultId: 'vault-test',
    revision: 2,
    updatedAt: new Date().toISOString(),
    kdf: {
      algorithm: 'ARGON2ID',
      iterations: 3,
      memoryKiB: 65536,
      parallelism: 1,
      salt: 'c2FsdA==',
    },
    wrappedVaultKey: {
      nonce: 'bm9uY2U=',
      ciphertext: 'Y2lwaGVy',
    },
    vaultData: {
      nonce: 'bm9uY2U=',
      ciphertext: 'Y2lwaGVy',
    },
  }

  const pushResponse = await fetch(`${server.baseUrl}/v2/vaults/${encodeURIComponent(snapshot.vaultId)}/push`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-armadillo-owner': 'test-device',
      'Idempotency-Key': 'test-idempotency-key',
    },
    body: JSON.stringify({
      revision: snapshot.revision,
      encryptedFile: JSON.stringify(snapshot),
      updatedAt: snapshot.updatedAt,
    }),
  }).then((res) => res.json())

  assert.equal(pushResponse.ok, true)
  assert.equal(pushResponse.accepted, true)

  const pullResponse = await fetch(`${server.baseUrl}/v2/vaults/${encodeURIComponent(snapshot.vaultId)}/pull`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-armadillo-owner': 'test-device',
    },
    body: '{}',
  }).then((res) => res.json())

  assert.equal(pullResponse.snapshot?.vaultId, snapshot.vaultId)
  assert.equal(pullResponse.snapshot?.revision, snapshot.revision)
})

test('v2 blob put/get/delete round-trip', async (t) => {
  const server = spawnServer()
  t.after(async () => {
    await server.cleanup()
  })

  await waitForReady(server.baseUrl)

  const vaultId = 'vault-blob-test'
  const blobId = 'blob-test-1'
  const body = {
    blobId,
    vaultId,
    nonce: 'bm9uY2U=',
    ciphertext: 'Y2lwaGVy',
    sizeBytes: 6,
    sha256: 'c2hh',
    mimeType: 'text/plain',
    fileName: 'secret.txt',
    updatedAt: new Date().toISOString(),
  }

  const put = await fetch(`${server.baseUrl}/v2/vaults/${encodeURIComponent(vaultId)}/blobs/${encodeURIComponent(blobId)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'x-armadillo-owner': 'test-device',
    },
    body: JSON.stringify(body),
  }).then((res) => res.json())
  assert.equal(put.ok, true)
  assert.equal(put.accepted, true)

  const get = await fetch(`${server.baseUrl}/v2/vaults/${encodeURIComponent(vaultId)}/blobs/${encodeURIComponent(blobId)}`, {
    method: 'GET',
    headers: {
      'x-armadillo-owner': 'test-device',
    },
  }).then((res) => res.json())
  assert.equal(get.blob?.blobId, blobId)
  assert.equal(get.blob?.fileName, 'secret.txt')

  const del = await fetch(`${server.baseUrl}/v2/vaults/${encodeURIComponent(vaultId)}/blobs/${encodeURIComponent(blobId)}`, {
    method: 'DELETE',
    headers: {
      'x-armadillo-owner': 'test-device',
    },
  }).then((res) => res.json())
  assert.equal(del.ok, true)
  assert.equal(del.deleted, true)
})

test('v2 delete vault removes snapshot', async (t) => {
  const server = spawnServer()
  t.after(async () => {
    await server.cleanup()
  })

  await waitForReady(server.baseUrl)

  const vaultId = 'vault-delete-test'
  const snapshot = {
    format: 'armadillo-v1',
    vaultId,
    revision: 1,
    updatedAt: new Date().toISOString(),
    kdf: {
      algorithm: 'ARGON2ID',
      iterations: 3,
      memoryKiB: 65536,
      parallelism: 1,
      salt: 'c2FsdA==',
    },
    wrappedVaultKey: {
      nonce: 'bm9uY2U=',
      ciphertext: 'Y2lwaGVy',
    },
    vaultData: {
      nonce: 'bm9uY2U=',
      ciphertext: 'Y2lwaGVy',
    },
  }

  await fetch(`${server.baseUrl}/v2/vaults/${encodeURIComponent(vaultId)}/push`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-armadillo-owner': 'test-device',
    },
    body: JSON.stringify({
      revision: snapshot.revision,
      encryptedFile: JSON.stringify(snapshot),
      updatedAt: snapshot.updatedAt,
    }),
  }).then((res) => res.json())

  const deleted = await fetch(`${server.baseUrl}/v2/vaults/${encodeURIComponent(vaultId)}`, {
    method: 'DELETE',
    headers: {
      'x-armadillo-owner': 'test-device',
    },
  }).then((res) => res.json())

  assert.equal(deleted.ok, true)
  assert.equal(deleted.deleted, true)

  const pulled = await fetch(`${server.baseUrl}/v2/vaults/${encodeURIComponent(vaultId)}/pull`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-armadillo-owner': 'test-device',
    },
    body: '{}',
  }).then((res) => res.json())

  assert.equal(pulled.snapshot, null)
})

test('v2 admin endpoints enforce allowlist+capability and support overrides', async (t) => {
  const entitlement = createSignedEntitlementToken()
  const bearer = 'admin-seed-token'
  const server = spawnServer({
    SYNC_ENTITLEMENT_TOKEN: entitlement.token,
    SYNC_ENTITLEMENT_VERIFY_JWKS: JSON.stringify(entitlement.jwks),
    SYNC_ADMIN_ALLOWLIST_SUBJECTS: `user:${bearer}`,
  })
  t.after(async () => {
    await server.cleanup()
  })

  await waitForReady(server.baseUrl)

  const me = await fetch(`${server.baseUrl}/v2/admin/me`, {
    headers: {
      Authorization: `Bearer ${bearer}`,
    },
  }).then((res) => res.json())

  assert.equal(me.authenticated, true)
  assert.equal(me.permissions.allowed, true)
  assert.equal(me.permissions.superAdmin, true)
  assert.equal(typeof me.identity?.orgId, 'string')

  const orgId = me.identity.orgId
  const orgs = await fetch(`${server.baseUrl}/v2/admin/orgs`, {
    headers: {
      Authorization: `Bearer ${bearer}`,
    },
  }).then((res) => res.json())
  assert.equal(Array.isArray(orgs.orgs), true)
  assert.equal(orgs.orgs.some((row) => row.id === orgId), true)

  const createdOrg = await fetch(`${server.baseUrl}/v2/admin/orgs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify({ orgId: 'org_test_admin', name: 'Test Admin Org' }),
  }).then((res) => res.json())
  assert.equal(createdOrg.org?.id, 'org_test_admin')

  const renamedOrg = await fetch(`${server.baseUrl}/v2/admin/orgs/org_test_admin`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify({ name: 'Renamed Test Admin Org' }),
  }).then((res) => res.json())
  assert.equal(renamedOrg.org?.name, 'Renamed Test Admin Org')

  const upsertMember = await fetch(`${server.baseUrl}/v2/admin/orgs/${encodeURIComponent(orgId)}/members`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify({ memberId: 'member-1', email: 'member-1@example.com', role: 'viewer' }),
  }).then((res) => res.json())
  assert.equal(upsertMember.member?.memberId, 'member-1')
  assert.equal(upsertMember.member?.email, 'member-1@example.com')

  const members = await fetch(`${server.baseUrl}/v2/admin/orgs/${encodeURIComponent(orgId)}/members`, {
    headers: {
      Authorization: `Bearer ${bearer}`,
    },
  }).then((res) => res.json())
  assert.equal(Array.isArray(members.members), true)
  assert.equal(members.members.some((row) => row.memberId === 'member-1'), true)
  assert.equal(members.members.some((row) => row.email === 'member-1@example.com'), true)

  const upsertOverride = await fetch(`${server.baseUrl}/v2/admin/entitlements/overrides`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify({
      targetType: 'email',
      targetValue: 'Admin@Example.com',
      token: entitlement.token,
      note: 'test override',
    }),
  }).then((res) => res.json())
  assert.equal(upsertOverride.ok, true)
  assert.equal(upsertOverride.override?.targetValue, 'admin@example.com')

  const overrides = await fetch(`${server.baseUrl}/v2/admin/entitlements/overrides`, {
    headers: {
      Authorization: `Bearer ${bearer}`,
    },
  }).then((res) => res.json())
  assert.equal(Array.isArray(overrides.overrides), true)
  assert.equal(overrides.overrides.length > 0, true)
})

test('v2 operator endpoints expose vaults, usage, overview, and customer search', async (t) => {
  const entitlement = createSignedEntitlementToken()
  const bearer = 'admin-seed-token'
  const orgMemberToken = 'member-1'
  const server = spawnServer({
    SYNC_ENTITLEMENT_TOKEN: entitlement.token,
    SYNC_ENTITLEMENT_VERIFY_JWKS: JSON.stringify(entitlement.jwks),
    SYNC_ADMIN_ALLOWLIST_SUBJECTS: `user:${bearer}`,
  })
  t.after(async () => {
    await server.cleanup()
  })

  await waitForReady(server.baseUrl)

  const createdOrg = await fetchJson(`${server.baseUrl}/v2/admin/orgs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify({ orgId: 'org_customer_ops', name: 'Customer Ops' }),
  })
  assert.equal(createdOrg.status, 200)
  assert.equal(createdOrg.body.org?.id, 'org_customer_ops')

  const memberUpsert = await fetchJson(`${server.baseUrl}/v2/admin/orgs/org_customer_ops/members`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify({ memberId: `user:${orgMemberToken}`, email: 'member-1@example.com', role: 'owner' }),
  })
  assert.equal(memberUpsert.status, 200)

  const snapshot = {
    format: 'armadillo-v1',
    vaultId: 'vault-customer-1',
    revision: 3,
    updatedAt: new Date().toISOString(),
    kdf: {
      algorithm: 'ARGON2ID',
      iterations: 3,
      memoryKiB: 65536,
      parallelism: 1,
      salt: 'c2FsdA==',
    },
    wrappedVaultKey: {
      nonce: 'bm9uY2U=',
      ciphertext: 'Y2lwaGVy',
    },
    vaultData: {
      nonce: 'bm9uY2U=',
      ciphertext: 'Y2lwaGVy',
    },
  }

  const pushResponse = await fetchJson(`${server.baseUrl}/v2/vaults/${encodeURIComponent(snapshot.vaultId)}/push`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${orgMemberToken}`,
      'x-armadillo-org': 'org_customer_ops',
    },
    body: JSON.stringify({
      revision: snapshot.revision,
      encryptedFile: JSON.stringify(snapshot),
      updatedAt: snapshot.updatedAt,
    }),
  })
  assert.equal(pushResponse.status, 200)
  assert.equal(pushResponse.body.accepted, true)

  const blobPut = await fetchJson(`${server.baseUrl}/v2/vaults/${encodeURIComponent(snapshot.vaultId)}/blobs/blob-1`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${orgMemberToken}`,
      'x-armadillo-org': 'org_customer_ops',
    },
    body: JSON.stringify({
      blobId: 'blob-1',
      vaultId: snapshot.vaultId,
      nonce: 'bm9uY2U=',
      ciphertext: 'Y2lwaGVy',
      sizeBytes: 6,
      sha256: 'c2hh',
      mimeType: 'text/plain',
      fileName: 'ops.txt',
      updatedAt: snapshot.updatedAt,
    }),
  })
  assert.equal(blobPut.status, 200)

  const vaults = await fetchJson(`${server.baseUrl}/v2/admin/orgs/org_customer_ops/vaults`, {
    headers: {
      Authorization: `Bearer ${bearer}`,
    },
  })
  assert.equal(vaults.status, 200)
  assert.equal(vaults.body.vaults.length, 1)
  assert.equal(vaults.body.vaults[0]?.vaultId, 'vault-customer-1')
  assert.equal(vaults.body.vaults[0]?.storageBytes, 6)

  const usage = await fetchJson(`${server.baseUrl}/v2/admin/orgs/org_customer_ops/usage`, {
    headers: {
      Authorization: `Bearer ${bearer}`,
    },
  })
  assert.equal(usage.status, 200)
  assert.equal(usage.body.memberCount >= 1, true)
  assert.equal(usage.body.vaultCount, 1)
  assert.equal(usage.body.storageBytes, 6)

  const overview = await fetchJson(`${server.baseUrl}/v2/admin/overview`, {
    headers: {
      Authorization: `Bearer ${bearer}`,
    },
  })
  assert.equal(overview.status, 200)
  assert.equal(overview.body.provider, 'self_hosted')
  assert.equal(overview.body.totalVaults >= 1, true)
  assert.equal(overview.body.totalOrgs >= 1, true)

  const search = await fetchJson(`${server.baseUrl}/v2/admin/customers/search?q=member-1@example.com`, {
    headers: {
      Authorization: `Bearer ${bearer}`,
    },
  })
  assert.equal(search.status, 200)
  assert.equal(search.body.results.some((row) => row.orgId === 'org_customer_ops'), true)

  const removed = await fetchJson(`${server.baseUrl}/v2/admin/orgs/org_customer_ops/vaults/vault-customer-1`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${bearer}`,
    },
  })
  assert.equal(removed.status, 200)
  assert.equal(removed.body.deleted, true)
})

test('v2 subscription precedence prefers manual override over subscription and restricts enterprise writes', async (t) => {
  const entitlement = createSignedEntitlementToken()
  const bearer = 'admin-seed-token'
  const orgMemberToken = 'member-1'
  const server = spawnServer({
    SYNC_ENTITLEMENT_TOKEN: entitlement.token,
    SYNC_ENTITLEMENT_VERIFY_JWKS: JSON.stringify(entitlement.jwks),
    SYNC_ADMIN_ALLOWLIST_SUBJECTS: `user:${bearer}`,
  })
  t.after(async () => {
    await server.cleanup()
  })

  await waitForReady(server.baseUrl)

  await fetchJson(`${server.baseUrl}/v2/admin/orgs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify({ orgId: 'org_subscription_ops', name: 'Subscription Ops' }),
  })

  await fetchJson(`${server.baseUrl}/v2/admin/orgs/org_subscription_ops/members`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify({ memberId: `user:${orgMemberToken}`, role: 'owner' }),
  })

  const savedSubscription = await fetchJson(`${server.baseUrl}/v2/admin/subscriptions`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify({
      scopeType: 'org',
      scopeId: 'org_subscription_ops',
      tier: 'premium',
      status: 'active',
      billingMode: 'manual',
      seatLimit: 8,
      storageLimitBytes: 4096,
      note: 'premium org plan',
    }),
  })
  assert.equal(savedSubscription.status, 200)
  assert.equal(savedSubscription.body.subscription?.tier, 'premium')

  const memberSubscriptionRead = await fetchJson(`${server.baseUrl}/v2/admin/subscriptions?scopeType=org&scopeId=org_subscription_ops`, {
    headers: {
      Authorization: `Bearer ${orgMemberToken}`,
      'x-armadillo-org': 'org_subscription_ops',
    },
  })
  assert.equal(memberSubscriptionRead.status, 200)
  assert.equal(memberSubscriptionRead.body.effective.tier, 'premium')

  const memberEnterpriseWrite = await fetchJson(`${server.baseUrl}/v2/admin/subscriptions`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${orgMemberToken}`,
      'x-armadillo-org': 'org_subscription_ops',
    },
    body: JSON.stringify({
      scopeType: 'org',
      scopeId: 'org_subscription_ops',
      tier: 'enterprise',
      status: 'active',
      billingMode: 'manual',
    }),
  })
  assert.equal(memberEnterpriseWrite.status, 403)

  const entitlementFromSubscription = await fetchJson(`${server.baseUrl}/v2/entitlements/me`, {
    headers: {
      Authorization: `Bearer ${orgMemberToken}`,
      'x-armadillo-org': 'org_subscription_ops',
    },
  })
  assert.equal(entitlementFromSubscription.status, 200)
  assert.equal(entitlementFromSubscription.body.token, null)
  assert.equal(entitlementFromSubscription.body.derived?.source, 'subscription')
  assert.equal(entitlementFromSubscription.body.derived?.tier, 'premium')

  const overrideSaved = await fetchJson(`${server.baseUrl}/v2/admin/entitlements/overrides`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify({
      targetType: 'subject',
      targetValue: `user:${orgMemberToken}`,
      tier: 'enterprise',
      capabilities: ['cloud.sync', 'vault.storage', 'enterprise.org_admin'],
      note: 'manual enterprise override',
    }),
  })
  assert.equal(overrideSaved.status, 200)
  assert.equal(overrideSaved.body.override?.mode, 'derived')
  assert.equal(overrideSaved.body.override?.tier, 'enterprise')

  const entitlementFromOverride = await fetchJson(`${server.baseUrl}/v2/entitlements/me`, {
    headers: {
      Authorization: `Bearer ${orgMemberToken}`,
      'x-armadillo-org': 'org_subscription_ops',
    },
  })
  assert.equal(entitlementFromOverride.status, 200)
  assert.equal(entitlementFromOverride.body.token, null)
  assert.equal(entitlementFromOverride.body.derived?.source, 'override')
  assert.equal(entitlementFromOverride.body.derived?.tier, 'enterprise')
})

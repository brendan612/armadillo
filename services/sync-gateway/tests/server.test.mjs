import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

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

function spawnServer() {
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

import { Capacitor } from '@capacitor/core'
import BiometricBridge from '../plugins/biometricBridge'

type OrgAccessPlatform = 'web' | 'desktop' | 'android'

type WrappedBytes = {
  nonce: string
  ciphertext: string
}

type StoredOrgAccessMetaBase = {
  orgId: string
  deviceId: string
  platform: OrgAccessPlatform
  publicKeyJwk: JsonWebKey
}

type StoredWebOrgAccessMeta = StoredOrgAccessMetaBase & {
  provider: 'webauthn'
  credentialId: string
  keyId: string
  wrappedPrivateKey: WrappedBytes
}

type StoredNativeOrgAccessMeta = StoredOrgAccessMetaBase & {
  provider: 'android-native'
  keyAlias: string
  wrappedPrivateKey: WrappedBytes
}

type StoredOrgAccessMeta = StoredWebOrgAccessMeta | StoredNativeOrgAccessMeta

const META_PREFIX = 'armadillo.org_access.'
const DB_NAME = 'armadillo-secure-keys'
const STORE_NAME = 'keys'

function metaKey(orgId: string) {
  return `${META_PREFIX}${orgId}`
}

function toBase64(bytes: Uint8Array) {
  let binary = ''
  for (const value of bytes) {
    binary += String.fromCharCode(value)
  }
  return btoa(binary)
}

function fromBase64(encoded: string) {
  const binary = atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function toBase64Url(bytes: Uint8Array) {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromBase64Url(encoded: string) {
  const padded = encoded.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((encoded.length + 3) % 4)
  return fromBase64(padded)
}

function randomBytes(length: number) {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytes
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

function isNativeAndroidRuntime() {
  return Capacitor.getPlatform() === 'android'
}

function isWebAuthnPlatformSupported() {
  if (typeof window === 'undefined') return false
  return Boolean(window.isSecureContext)
    && Boolean(window.PublicKeyCredential)
    && typeof indexedDB !== 'undefined'
    && typeof navigator !== 'undefined'
    && 'credentials' in navigator
}

async function ensureUserVerifyingPlatformAuthenticatorAvailable() {
  if (!isWebAuthnPlatformSupported()) {
    throw new Error('Shared vault device access requires a secure context with platform passkeys.')
  }
  if (typeof PublicKeyCredential === 'undefined' || typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable !== 'function') {
    return
  }
  const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
  if (!available) {
    throw new Error('Platform passkeys or Windows Hello are not available on this device.')
  }
}

function normalizeWebAuthnError(error: unknown, fallback: string) {
  if (!(error instanceof DOMException)) {
    return new Error(fallback)
  }
  switch (error.name) {
    case 'NotAllowedError':
      return new Error('Device authentication was canceled.')
    case 'InvalidStateError':
      return new Error('Device authentication is unavailable in this app context.')
    case 'SecurityError':
      return new Error('Device authentication requires a secure app context.')
    default:
      return new Error(error.message || fallback)
  }
}

function loadMeta(orgId: string): StoredOrgAccessMeta | null {
  const raw = localStorage.getItem(metaKey(orgId))
  if (!raw) return null
  try {
    return JSON.parse(raw) as StoredOrgAccessMeta
  } catch {
    return null
  }
}

function saveMeta(meta: StoredOrgAccessMeta) {
  localStorage.setItem(metaKey(meta.orgId), JSON.stringify(meta))
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function putDeviceKey(id: string, key: CryptoKey) {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put({ id, key })
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

async function getDeviceKey(id: string): Promise<CryptoKey | null> {
  const db = await openDb()
  const value = await new Promise<{ id: string; key: CryptoKey } | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const request = tx.objectStore(STORE_NAME).get(id)
    request.onsuccess = () => resolve((request.result as { id: string; key: CryptoKey } | undefined) ?? null)
    request.onerror = () => reject(request.error)
  })
  db.close()
  return value?.key ?? null
}

async function encryptBytesWithDeviceKey(deviceKey: CryptoKey, bytes: Uint8Array): Promise<WrappedBytes> {
  const nonce = randomBytes(12)
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: toArrayBuffer(nonce) }, deviceKey, toArrayBuffer(bytes))
  return {
    nonce: toBase64(nonce),
    ciphertext: toBase64(new Uint8Array(encrypted)),
  }
}

async function decryptBytesWithDeviceKey(deviceKey: CryptoKey, wrapped: WrappedBytes): Promise<Uint8Array> {
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(fromBase64(wrapped.nonce)) },
    deviceKey,
    toArrayBuffer(fromBase64(wrapped.ciphertext)),
  )
  return new Uint8Array(decrypted)
}

async function createCredential(label: string) {
  await ensureUserVerifyingPlatformAuthenticatorAvailable()
  try {
    const credential = await navigator.credentials.create({
      publicKey: {
        challenge: randomBytes(32),
        rp: { name: 'Armadillo' },
        user: {
          id: randomBytes(16),
          name: label,
          displayName: label,
        },
        pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
        timeout: 60_000,
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'preferred',
        },
        attestation: 'none',
      },
    })
    if (!(credential instanceof PublicKeyCredential)) {
      throw new Error('Failed to create device credential')
    }
    return toBase64Url(new Uint8Array(credential.rawId))
  } catch (error) {
    throw normalizeWebAuthnError(error, 'Failed to enroll device access.')
  }
}

async function authenticateCredential(credentialId: string) {
  await ensureUserVerifyingPlatformAuthenticatorAvailable()
  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: randomBytes(32),
        timeout: 60_000,
        userVerification: 'required',
        allowCredentials: [{ id: fromBase64Url(credentialId), type: 'public-key' }],
      },
    })
    if (!(assertion instanceof PublicKeyCredential)) {
      throw new Error('Device authentication failed')
    }
  } catch (error) {
    throw normalizeWebAuthnError(error, 'Device authentication failed.')
  }
}

function sanitizeForAlias(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 24) || 'org'
}

async function exportPrivateKeyBytes(privateKey: CryptoKey) {
  const jwk = await crypto.subtle.exportKey('jwk', privateKey)
  return new TextEncoder().encode(JSON.stringify(jwk))
}

async function importPrivateKeyFromBytes(bytes: Uint8Array) {
  const jwk = JSON.parse(new TextDecoder().decode(bytes)) as JsonWebKey
  return crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['decrypt'],
  )
}

export function getRegisteredOrgDevice(orgId: string) {
  const meta = loadMeta(orgId)
  if (!meta) return null
  return {
    orgId: meta.orgId,
    deviceId: meta.deviceId,
    platform: meta.platform,
    publicKeyJwk: meta.publicKeyJwk,
  }
}

export async function ensureOrgAccessDeviceRegistration(input: { orgId: string; platform: OrgAccessPlatform }) {
  const existing = loadMeta(input.orgId)
  if (existing) {
    return {
      orgId: existing.orgId,
      deviceId: existing.deviceId,
      platform: existing.platform,
      publicKeyJwk: existing.publicKeyJwk,
      created: false,
    }
  }

  const deviceId = `orgdev_${crypto.randomUUID()}`
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['encrypt', 'decrypt'],
  ) as CryptoKeyPair
  const publicKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey)
  const privateKeyBytes = await exportPrivateKeyBytes(keyPair.privateKey)

  if (isNativeAndroidRuntime() || input.platform === 'android') {
    const keyAlias = `arm_org_${sanitizeForAlias(input.orgId)}_${deviceId.slice(-8)}`
    const wrapped = await BiometricBridge.wrapVaultKey({
      keyAlias,
      rawVaultKeyBase64: toBase64(privateKeyBytes),
    })
    saveMeta({
      provider: 'android-native',
      orgId: input.orgId,
      deviceId,
      platform: 'android',
      keyAlias: wrapped.keyAlias,
      wrappedPrivateKey: {
        nonce: wrapped.ivBase64,
        ciphertext: wrapped.ciphertextBase64,
      },
      publicKeyJwk,
    })
  } else {
    const credentialId = await createCredential(`armadillo-org-${input.orgId}`)
    await authenticateCredential(credentialId)
    const deviceKey = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    )
    const wrappedPrivateKey = await encryptBytesWithDeviceKey(deviceKey, privateKeyBytes)
    const keyId = `org_access_${crypto.randomUUID()}`
    await putDeviceKey(keyId, deviceKey)
    saveMeta({
      provider: 'webauthn',
      orgId: input.orgId,
      deviceId,
      platform: input.platform,
      credentialId,
      keyId,
      wrappedPrivateKey,
      publicKeyJwk,
    })
  }

  return {
    orgId: input.orgId,
    deviceId,
    platform: isNativeAndroidRuntime() || input.platform === 'android' ? 'android' as const : input.platform,
    publicKeyJwk,
    created: true,
  }
}

async function loadPrivateKey(orgId: string) {
  const meta = loadMeta(orgId)
  if (!meta) {
    throw new Error('This device is not registered for shared org vault access.')
  }

  if (meta.provider === 'android-native') {
    const result = await BiometricBridge.unwrapVaultKey({
      keyAlias: meta.keyAlias,
      ivBase64: meta.wrappedPrivateKey.nonce,
      ciphertextBase64: meta.wrappedPrivateKey.ciphertext,
    })
    return importPrivateKeyFromBytes(fromBase64(result.rawVaultKeyBase64))
  }

  await authenticateCredential(meta.credentialId)
  const deviceKey = await getDeviceKey(meta.keyId)
  if (!deviceKey) {
    throw new Error('This device registration is unavailable. Re-register this device for org access.')
  }
  const privateKeyBytes = await decryptBytesWithDeviceKey(deviceKey, meta.wrappedPrivateKey)
  return importPrivateKeyFromBytes(privateKeyBytes)
}

export async function wrapVaultKeyForOrgDevice(publicKeyJwk: JsonWebKey, vaultKey: CryptoKey) {
  const publicKey = await crypto.subtle.importKey(
    'jwk',
    publicKeyJwk,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt'],
  )
  const rawVaultKey = new Uint8Array(await crypto.subtle.exportKey('raw', vaultKey))
  const ciphertext = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, toArrayBuffer(rawVaultKey))
  return {
    alg: 'RSA-OAEP-256',
    ciphertextBase64: toBase64(new Uint8Array(ciphertext)),
  }
}

export async function unwrapOrgVaultKey(orgId: string, wrappedVaultKey: { alg: string; ciphertextBase64: string }) {
  const privateKey = await loadPrivateKey(orgId)
  const rawVaultKey = await crypto.subtle.decrypt(
    { name: 'RSA-OAEP' },
    privateKey,
    toArrayBuffer(fromBase64(wrappedVaultKey.ciphertextBase64)),
  )
  return crypto.subtle.importKey('raw', rawVaultKey, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt'])
}

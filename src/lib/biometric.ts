import { decryptJsonWithKey } from './crypto'
import type { ArmadilloVaultFile, VaultPayload, VaultSession } from '../types/vault'

type WrappedKey = {
  nonce: string
  ciphertext: string
}

type BiometricMeta = {
  credentialId: string
  keyId: string
  wrappedVaultKey: WrappedKey
}

const META_KEY = 'armadillo.biometric.meta'
const DB_NAME = 'armadillo-secure-keys'
const STORE_NAME = 'keys'

function toBase64Url(bytes: Uint8Array) {
  let binary = ''
  for (const value of bytes) {
    binary += String.fromCharCode(value)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromBase64Url(encoded: string) {
  const padded = encoded.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((encoded.length + 3) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
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

function loadMeta(): BiometricMeta | null {
  const raw = localStorage.getItem(META_KEY)
  if (!raw) {
    return null
  }

  try {
    return JSON.parse(raw) as BiometricMeta
  } catch {
    return null
  }
}

export function biometricEnrollmentExists() {
  return Boolean(loadMeta())
}

function saveMeta(meta: BiometricMeta) {
  localStorage.setItem(META_KEY, JSON.stringify(meta))
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
    const store = tx.objectStore(STORE_NAME)
    store.put({ id, key })
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

async function getDeviceKey(id: string): Promise<CryptoKey | null> {
  const db = await openDb()
  const value = await new Promise<{ id: string; key: CryptoKey } | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const request = store.get(id)
    request.onsuccess = () => resolve((request.result as { id: string; key: CryptoKey } | undefined) ?? null)
    request.onerror = () => reject(request.error)
  })
  db.close()
  return value?.key ?? null
}

async function wrapRawVaultKeyWithDeviceKey(deviceKey: CryptoKey, rawVaultKey: Uint8Array): Promise<WrappedKey> {
  const nonce = randomBytes(12)
  const encrypted = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(nonce),
    },
    deviceKey,
    toArrayBuffer(rawVaultKey),
  )

  return {
    nonce: toBase64(nonce),
    ciphertext: toBase64(new Uint8Array(encrypted)),
  }
}

async function unwrapRawVaultKeyWithDeviceKey(deviceKey: CryptoKey, wrapped: WrappedKey): Promise<Uint8Array> {
  const nonce = fromBase64(wrapped.nonce)
  const ciphertext = fromBase64(wrapped.ciphertext)
  const decrypted = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(nonce),
    },
    deviceKey,
    toArrayBuffer(ciphertext),
  )

  return new Uint8Array(decrypted)
}

async function getOrCreateBiometricCredential() {
  const existing = loadMeta()
  if (existing) {
    return existing.credentialId
  }

  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: randomBytes(32),
      rp: { name: 'Armadillo' },
      user: {
        id: randomBytes(16),
        name: 'armadillo-biometric',
        displayName: 'Armadillo Biometric Unlock',
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
    throw new Error('Failed to create biometric credential')
  }

  return toBase64Url(new Uint8Array(credential.rawId))
}

async function authenticateCredential(credentialId: string) {
  const rawId = fromBase64Url(credentialId)
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: randomBytes(32),
      timeout: 60_000,
      userVerification: 'required',
      allowCredentials: [{ id: rawId, type: 'public-key' }],
    },
  })

  if (!(assertion instanceof PublicKeyCredential)) {
    throw new Error('Biometric assertion failed')
  }
}

export function biometricSupported() {
  return typeof window !== 'undefined' && Boolean(window.PublicKeyCredential) && typeof indexedDB !== 'undefined'
}

export async function enrollBiometricQuickUnlock(session: VaultSession) {
  if (!biometricSupported()) {
    throw new Error('Biometric quick unlock is not supported on this device')
  }

  const credentialId = await getOrCreateBiometricCredential()
  await authenticateCredential(credentialId)

  const deviceKey = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )

  const rawVaultKey = new Uint8Array(await crypto.subtle.exportKey('raw', session.vaultKey))
  const wrappedVaultKey = await wrapRawVaultKeyWithDeviceKey(deviceKey, rawVaultKey)
  const keyId = `key_${crypto.randomUUID()}`

  await putDeviceKey(keyId, deviceKey)
  saveMeta({ credentialId, keyId, wrappedVaultKey })
}

export async function unlockWithBiometric(file: ArmadilloVaultFile): Promise<VaultSession> {
  const meta = loadMeta()
  if (!meta) {
    throw new Error('Biometric quick unlock is not enrolled for this vault')
  }

  await authenticateCredential(meta.credentialId)
  const deviceKey = await getDeviceKey(meta.keyId)
  if (!deviceKey) {
    throw new Error('Biometric device key is unavailable')
  }

  const rawVaultKey = await unwrapRawVaultKeyWithDeviceKey(deviceKey, meta.wrappedVaultKey)
  const vaultKey = await crypto.subtle.importKey('raw', toArrayBuffer(rawVaultKey), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
  const payload = await decryptJsonWithKey<VaultPayload>(vaultKey, file.vaultData)

  return {
    file,
    payload,
    vaultKey,
  }
}

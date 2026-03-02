import { argon2id } from '@noble/hashes/argon2.js'
import { utf8ToBytes } from '@noble/hashes/utils.js'
import type { EncryptedBlob, RecoveryKdfConfig } from '../types/vault'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function requireWebCrypto() {
  if (typeof crypto === 'undefined') {
    throw new Error('Web Crypto API is unavailable in this browser context. Use HTTPS/localhost or the desktop app.')
  }
  return crypto
}

function requireSubtleCrypto() {
  const webCrypto = requireWebCrypto()
  if (!webCrypto.subtle) {
    throw new Error('crypto.subtle is unavailable. Open Armadillo over HTTPS/localhost, or use the desktop app.')
  }
  return webCrypto.subtle
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

export function bytesToBase64(bytes: Uint8Array) {
  return toBase64(bytes)
}

export function base64ToBytes(encoded: string) {
  return fromBase64(encoded)
}

function randomBytes(length: number) {
  const bytes = new Uint8Array(length)
  requireWebCrypto().getRandomValues(bytes)
  return bytes
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

async function deriveKeyBytesArgon2id(password: string, salt: Uint8Array, iterations: number, memoryKiB: number, parallelism: number) {
  return argon2id(utf8ToBytes(password), salt, {
    t: iterations,
    m: memoryKiB,
    p: parallelism,
    dkLen: 32,
  })
}

async function deriveKeyBytesArgon2idFromBytes(secret: Uint8Array, salt: Uint8Array, iterations: number, memoryKiB: number, parallelism: number) {
  return argon2id(secret, salt, {
    t: iterations,
    m: memoryKiB,
    p: parallelism,
    dkLen: 32,
  })
}

async function deriveLegacyKeyBytesPbkdf2(password: string, salt: Uint8Array, iterations: number) {
  const subtle = requireSubtleCrypto()
  const passwordKey = await subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: toArrayBuffer(salt),
      iterations,
      hash: 'SHA-256',
    },
    passwordKey,
    256,
  )
  return new Uint8Array(bits)
}

async function deriveMasterKeyRawBytes(params: {
  password: string
  saltBase64: string
  algorithm: 'ARGON2ID' | 'PBKDF2-SHA256'
  iterations: number
  memoryKiB?: number
  parallelism?: number
}) {
  const salt = fromBase64(params.saltBase64)

  if (params.algorithm === 'ARGON2ID') {
    return deriveKeyBytesArgon2id(
      params.password,
      salt,
      params.iterations,
      params.memoryKiB ?? 64 * 1024,
      params.parallelism ?? 1,
    )
  }

  return deriveLegacyKeyBytesPbkdf2(params.password, salt, params.iterations)
}

async function importAesKeyFromBytes(bytes: Uint8Array) {
  return requireSubtleCrypto().importKey('raw', toArrayBuffer(bytes), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

async function encryptBytesWithKey(key: CryptoKey, bytes: Uint8Array) {
  const subtle = requireSubtleCrypto()
  const nonce = randomBytes(12)
  const encrypted = await subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(nonce),
    },
    key,
    toArrayBuffer(bytes),
  )
  return {
    nonce: toBase64(nonce),
    ciphertext: toBase64(new Uint8Array(encrypted)),
  }
}

async function decryptBytesWithKey(key: CryptoKey, encrypted: { nonce: string; ciphertext: string }) {
  const subtle = requireSubtleCrypto()
  const nonce = fromBase64(encrypted.nonce)
  const ciphertext = fromBase64(encrypted.ciphertext)
  const decrypted = await subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(nonce),
    },
    key,
    toArrayBuffer(ciphertext),
  )
  return new Uint8Array(decrypted)
}

export async function encryptBytesWithVaultKey(key: CryptoKey, bytes: Uint8Array): Promise<EncryptedBlob> {
  return encryptBytesWithKey(key, bytes)
}

export async function decryptBytesWithVaultKey(key: CryptoKey, encrypted: EncryptedBlob) {
  return decryptBytesWithKey(key, encrypted)
}

export async function sha256Base64(bytes: Uint8Array) {
  const subtle = requireSubtleCrypto()
  const hash = await subtle.digest('SHA-256', toArrayBuffer(bytes))
  return toBase64(new Uint8Array(hash))
}

export async function createVaultKey() {
  return requireSubtleCrypto().generateKey(
    {
      name: 'AES-GCM',
      length: 256,
    },
    true,
    ['encrypt', 'decrypt'],
  )
}

export async function wrapVaultKey(masterKey: CryptoKey, vaultKey: CryptoKey) {
  const rawVaultKey = await requireSubtleCrypto().exportKey('raw', vaultKey)
  return encryptBytesWithKey(masterKey, new Uint8Array(rawVaultKey))
}

export async function unwrapVaultKey(masterKey: CryptoKey, wrapped: { nonce: string; ciphertext: string }) {
  const rawKey = await decryptBytesWithKey(masterKey, wrapped)
  // Keep vault keys extractable after unlock so biometric enrollment can wrap them.
  return requireSubtleCrypto().importKey('raw', toArrayBuffer(rawKey), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt'])
}

export async function encryptJsonWithKey<T>(key: CryptoKey, value: T) {
  const raw = encoder.encode(JSON.stringify(value))
  return encryptBytesWithKey(key, raw)
}

export async function decryptJsonWithKey<T>(key: CryptoKey, value: { nonce: string; ciphertext: string }) {
  const raw = await decryptBytesWithKey(key, value)
  return JSON.parse(decoder.decode(raw)) as T
}

export async function deriveMasterKeyFromPassword(params: {
  password: string
  saltBase64: string
  algorithm: 'ARGON2ID' | 'PBKDF2-SHA256'
  iterations: number
  memoryKiB?: number
  parallelism?: number
}) {
  const rawBytes = await deriveMasterKeyRawBytes(params)
  return importAesKeyFromBytes(rawBytes)
}

export function createKdfConfig() {
  const salt = randomBytes(16)
  return {
    algorithm: 'ARGON2ID' as const,
    iterations: 3,
    memoryKiB: 64 * 1024,
    parallelism: 1,
    salt: toBase64(salt),
  }
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes).map((value) => value.toString(16).padStart(2, '0')).join('')
}

function hexToBytes(hex: string) {
  if (hex.length % 2 !== 0) {
    throw new Error('Invalid recovery key')
  }
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i += 1) {
    const offset = i * 2
    const pair = hex.slice(offset, offset + 2)
    const value = Number.parseInt(pair, 16)
    if (!Number.isFinite(value)) {
      throw new Error('Invalid recovery key')
    }
    bytes[i] = value
  }
  return bytes
}

function formatHexGroups(hex: string) {
  const groups: string[] = []
  for (let i = 0; i < hex.length; i += 4) {
    groups.push(hex.slice(i, i + 4))
  }
  return groups.join('-').toUpperCase()
}

async function recoveryKeyChecksumHex(bytes: Uint8Array) {
  const subtle = requireSubtleCrypto()
  const hash = await subtle.digest('SHA-256', toArrayBuffer(bytes))
  return bytesToHex(new Uint8Array(hash).slice(0, 2))
}

export function generateRecoveryKey() {
  return randomBytes(32)
}

export async function formatRecoveryKeyForDisplay(bytes: Uint8Array) {
  if (bytes.length !== 32) {
    throw new Error('Recovery key must be 32 bytes')
  }
  const checksum = await recoveryKeyChecksumHex(bytes)
  return formatHexGroups(`${bytesToHex(bytes)}${checksum}`)
}

export async function parseRecoveryKeyFromDisplay(input: string) {
  const compact = input.replace(/[^a-fA-F0-9]/g, '').toLowerCase()
  if (compact.length !== 68) {
    throw new Error('Invalid recovery key')
  }
  const secretHex = compact.slice(0, 64)
  const checksumHex = compact.slice(64)
  const bytes = hexToBytes(secretHex)
  const expectedChecksum = await recoveryKeyChecksumHex(bytes)
  if (checksumHex !== expectedChecksum) {
    bytes.fill(0)
    throw new Error('Invalid recovery key')
  }
  return bytes
}

export function createRecoveryKdfConfig(): RecoveryKdfConfig {
  const salt = randomBytes(16)
  return {
    algorithm: 'ARGON2ID',
    iterations: 3,
    memoryKiB: 64 * 1024,
    parallelism: 1,
    salt: toBase64(salt),
  }
}

export async function deriveRecoveryKeyEncryptionKey(params: {
  recoveryKeyBytes: Uint8Array
  kdf: RecoveryKdfConfig
}) {
  const salt = fromBase64(params.kdf.salt)
  const rawBytes = await deriveKeyBytesArgon2idFromBytes(
    params.recoveryKeyBytes,
    salt,
    params.kdf.iterations,
    params.kdf.memoryKiB,
    params.kdf.parallelism,
  )
  try {
    return await importAesKeyFromBytes(rawBytes)
  } finally {
    rawBytes.fill(0)
  }
}

export async function fingerprintRecoveryKey(recoveryKeyBytes: Uint8Array) {
  const subtle = requireSubtleCrypto()
  const hash = await subtle.digest('SHA-256', toArrayBuffer(recoveryKeyBytes))
  return toBase64(new Uint8Array(hash))
}

export async function wrapVaultKeyWithRecoveryKey(params: {
  vaultKey: CryptoKey
  recoveryKeyBytes: Uint8Array
  kdf?: RecoveryKdfConfig
}) {
  const kdf = params.kdf ?? createRecoveryKdfConfig()
  const recoveryWrapKey = await deriveRecoveryKeyEncryptionKey({
    recoveryKeyBytes: params.recoveryKeyBytes,
    kdf,
  })
  const wrappedVaultKeyRecovery = await wrapVaultKey(recoveryWrapKey, params.vaultKey)
  const recoveryKeyFingerprint = await fingerprintRecoveryKey(params.recoveryKeyBytes)
  return { kdf, wrappedVaultKeyRecovery, recoveryKeyFingerprint }
}

export async function unwrapVaultKeyWithRecoveryKey(params: {
  recoveryKeyBytes: Uint8Array
  kdf: RecoveryKdfConfig
  wrappedVaultKeyRecovery: EncryptedBlob
}) {
  const recoveryWrapKey = await deriveRecoveryKeyEncryptionKey({
    recoveryKeyBytes: params.recoveryKeyBytes,
    kdf: params.kdf,
  })
  return unwrapVaultKey(recoveryWrapKey, params.wrappedVaultKeyRecovery)
}


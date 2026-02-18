import { argon2id } from '@noble/hashes/argon2.js'
import { utf8ToBytes } from '@noble/hashes/utils.js'
import type { EncryptedBlob } from '../types/vault'

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


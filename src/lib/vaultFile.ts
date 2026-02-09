import {
  createKdfConfig,
  createVaultKey,
  decryptJsonWithKey,
  deriveMasterKeyFromPassword,
  encryptJsonWithKey,
  unwrapVaultKey,
  wrapVaultKey,
} from './crypto'
import type { ArmadilloVaultFile, VaultPayload, VaultSession } from '../types/vault'

const LOCAL_VAULT_FILE_KEY = 'armadillo.local.vault.file'

export function defaultVaultPayload(): VaultPayload {
  return { items: [] }
}

export function loadLocalVaultFile(): ArmadilloVaultFile | null {
  const raw = localStorage.getItem(LOCAL_VAULT_FILE_KEY)
  if (!raw) {
    return null
  }

  try {
    return JSON.parse(raw) as ArmadilloVaultFile
  } catch {
    return null
  }
}

export function saveLocalVaultFile(file: ArmadilloVaultFile) {
  localStorage.setItem(LOCAL_VAULT_FILE_KEY, JSON.stringify(file))
}

export function clearLocalVaultFile() {
  localStorage.removeItem(LOCAL_VAULT_FILE_KEY)
}

export function parseVaultFileFromText(text: string) {
  const parsed = JSON.parse(text) as ArmadilloVaultFile
  if (parsed.format !== 'armadillo-v1') {
    throw new Error('Unsupported vault file format')
  }
  return parsed
}

export function serializeVaultFile(file: ArmadilloVaultFile) {
  return JSON.stringify(file)
}

export async function createVaultFile(masterPassword: string): Promise<VaultSession> {
  const kdf = createKdfConfig()
  const vaultKey = await createVaultKey()
  const masterKey = await deriveMasterKeyFromPassword({
    password: masterPassword,
    saltBase64: kdf.salt,
    algorithm: kdf.algorithm,
    iterations: kdf.iterations,
    memoryKiB: 'memoryKiB' in kdf ? kdf.memoryKiB : undefined,
    parallelism: 'parallelism' in kdf ? kdf.parallelism : undefined,
  })
  const wrappedVaultKey = await wrapVaultKey(masterKey, vaultKey)
  const payload = defaultVaultPayload()
  const vaultData = await encryptJsonWithKey(vaultKey, payload)

  const file: ArmadilloVaultFile = {
    format: 'armadillo-v1',
    vaultId: crypto.randomUUID(),
    revision: 1,
    updatedAt: new Date().toISOString(),
    kdf,
    wrappedVaultKey,
    vaultData,
  }

  return {
    file,
    payload,
    vaultKey,
  }
}

export async function unlockVaultFile(file: ArmadilloVaultFile, masterPassword: string): Promise<VaultSession> {
  const masterKey = await deriveMasterKeyFromPassword({
    password: masterPassword,
    saltBase64: file.kdf.salt,
    algorithm: file.kdf.algorithm,
    iterations: file.kdf.iterations,
    memoryKiB: 'memoryKiB' in file.kdf ? file.kdf.memoryKiB : undefined,
    parallelism: 'parallelism' in file.kdf ? file.kdf.parallelism : undefined,
  })
  const vaultKey = await unwrapVaultKey(masterKey, file.wrappedVaultKey)
  const payload = await decryptJsonWithKey<VaultPayload>(vaultKey, file.vaultData)

  return {
    file,
    payload,
    vaultKey,
  }
}

export async function rewriteVaultFile(session: VaultSession, payload: VaultPayload): Promise<VaultSession> {
  const vaultData = await encryptJsonWithKey(session.vaultKey, payload)

  const nextFile: ArmadilloVaultFile = {
    ...session.file,
    revision: session.file.revision + 1,
    updatedAt: new Date().toISOString(),
    vaultData,
  }

  return {
    file: nextFile,
    payload,
    vaultKey: session.vaultKey,
  }
}

export async function readPayloadWithSessionKey(session: VaultSession, file: ArmadilloVaultFile): Promise<VaultPayload> {
  return decryptJsonWithKey<VaultPayload>(session.vaultKey, file.vaultData)
}

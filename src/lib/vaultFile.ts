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
const LOCAL_VAULT_PATH_KEY = 'armadillo.local.vault.path'

export function defaultVaultPayload(): VaultPayload {
  return { items: [] }
}

export function loadLocalVaultFile(): ArmadilloVaultFile | null {
  const shell = window.armadilloShell
  if (shell?.isElectron && shell.readVaultFile) {
    const knownPath = localStorage.getItem(LOCAL_VAULT_PATH_KEY) || shell.getDefaultVaultPath?.()
    if (knownPath) {
      const rawFromFile = shell.readVaultFile(knownPath)
      if (rawFromFile) {
        try {
          const parsed = JSON.parse(rawFromFile) as ArmadilloVaultFile
          localStorage.setItem(LOCAL_VAULT_FILE_KEY, rawFromFile)
          localStorage.setItem(LOCAL_VAULT_PATH_KEY, knownPath)
          return parsed
        } catch {
          // Fall back to localStorage copy.
        }
      }
    }
  }

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

export function getLocalVaultPath() {
  const shell = window.armadilloShell
  return localStorage.getItem(LOCAL_VAULT_PATH_KEY) || shell?.getDefaultVaultPath?.() || ''
}

export function setLocalVaultPath(path: string) {
  if (!path) return
  localStorage.setItem(LOCAL_VAULT_PATH_KEY, path)
}

export function saveLocalVaultFile(file: ArmadilloVaultFile) {
  const raw = JSON.stringify(file)
  localStorage.setItem(LOCAL_VAULT_FILE_KEY, raw)

  const shell = window.armadilloShell
  if (shell?.isElectron && shell.writeVaultFile) {
    const knownPath = getLocalVaultPath()
    if (knownPath && shell.writeVaultFile(raw, knownPath)) {
      localStorage.setItem(LOCAL_VAULT_PATH_KEY, knownPath)
    }
  }
}

export function clearLocalVaultFile() {
  localStorage.removeItem(LOCAL_VAULT_FILE_KEY)
  const shell = window.armadilloShell
  const knownPath = localStorage.getItem(LOCAL_VAULT_PATH_KEY) || shell?.getDefaultVaultPath?.()
  if (shell?.isElectron && shell.deleteVaultFile && knownPath) {
    shell.deleteVaultFile(knownPath)
  }
  localStorage.removeItem(LOCAL_VAULT_PATH_KEY)
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

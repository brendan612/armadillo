import {
  createKdfConfig,
  createVaultKey,
  decryptJsonWithKey,
  deriveMasterKeyFromPassword,
  encryptJsonWithKey,
  unwrapVaultKey,
  wrapVaultKey,
} from './crypto'
import { VAULT_SCHEMA_VERSION, type ArmadilloVaultFile, type VaultCategory, type VaultFolder, type VaultPayload, type VaultSettings, type VaultSession, type VaultTrashEntry } from '../types/vault'

const LOCAL_VAULT_FILE_KEY = 'armadillo.local.vault.file'
const LOCAL_VAULT_PATH_KEY = 'armadillo.local.vault.path'

export function defaultVaultPayload(): VaultPayload {
  return {
    schemaVersion: VAULT_SCHEMA_VERSION,
    items: [],
    folders: [],
    categories: [],
    trash: [],
    settings: defaultVaultSettings(),
  }
}

export function defaultVaultSettings(): VaultSettings {
  return {
    trashRetentionDays: 30,
    generatorPresets: [],
  }
}

function toIso(value: unknown, fallback: string) {
  return typeof value === 'string' && value ? value : fallback
}

function uniqueByName<T extends { name: string }>(values: T[]) {
  const seen = new Set<string>()
  return values.filter((value) => {
    const key = value.name.trim().toLowerCase()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function safeRetentionDays(input: unknown) {
  const numeric = Number(input)
  if (!Number.isFinite(numeric)) return 30
  const rounded = Math.round(numeric)
  return Math.min(3650, Math.max(1, rounded))
}

function ensureTrashRetention(payload: VaultPayload) {
  const now = Date.now()
  payload.trash = payload.trash.filter((entry) => {
    const purgeAt = Date.parse(entry.purgeAt)
    if (!Number.isFinite(purgeAt)) {
      return true
    }
    return purgeAt > now
  })
}

export function normalizeVaultPayload(raw: unknown): VaultPayload {
  const now = new Date().toISOString()
  const base = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const rawItems = Array.isArray(base.items) ? base.items : []

  const migratedItems = rawItems.map((item): VaultPayload['items'][number] => {
    const source = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
    return {
      id: typeof source.id === 'string' && source.id ? source.id : crypto.randomUUID(),
      title: typeof source.title === 'string' ? source.title : 'Untitled',
      username: typeof source.username === 'string' ? source.username : '',
      passwordMasked: typeof source.passwordMasked === 'string' ? source.passwordMasked : '',
      urls: Array.isArray(source.urls) ? source.urls.filter((v): v is string => typeof v === 'string') : [],
      category: typeof source.category === 'string' ? source.category : '',
      folder: typeof source.folder === 'string' ? source.folder : '',
      categoryId: typeof source.categoryId === 'string' ? source.categoryId : null,
      folderId: typeof source.folderId === 'string' ? source.folderId : null,
      tags: Array.isArray(source.tags) ? source.tags.filter((v): v is string => typeof v === 'string') : [],
      risk: source.risk === 'weak' || source.risk === 'reused' || source.risk === 'exposed' || source.risk === 'stale' ? source.risk : 'safe',
      updatedAt: typeof source.updatedAt === 'string' && source.updatedAt ? source.updatedAt : new Date().toLocaleString(),
      note: typeof source.note === 'string' ? source.note : '',
      securityQuestions: Array.isArray(source.securityQuestions)
        ? source.securityQuestions
            .map((entry) => {
              const row = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>
              return {
                question: typeof row.question === 'string' ? row.question : '',
                answer: typeof row.answer === 'string' ? row.answer : '',
              }
            })
            .filter((entry) => entry.question || entry.answer)
        : [],
    }
  })

  const rawFolders = Array.isArray(base.folders) ? base.folders : []
  const rawCategories = Array.isArray(base.categories) ? base.categories : []

  let folders: VaultFolder[] = rawFolders
    .map((folder) => {
      const source = (folder && typeof folder === 'object' ? folder : {}) as Record<string, unknown>
      const name = typeof source.name === 'string' ? source.name.trim() : ''
      if (!name) return null
      const id = typeof source.id === 'string' && source.id ? source.id : crypto.randomUUID()
      return {
        id,
        name,
        parentId: typeof source.parentId === 'string' ? source.parentId : null,
        color: typeof source.color === 'string' && source.color ? source.color : '#7f9cff',
        icon: typeof source.icon === 'string' && source.icon ? source.icon : 'folder',
        notes: typeof source.notes === 'string' ? source.notes : '',
        createdAt: toIso(source.createdAt, now),
        updatedAt: toIso(source.updatedAt, now),
      }
    })
    .filter((entry): entry is VaultFolder => Boolean(entry))

  let categories: VaultCategory[] = rawCategories
    .map((category) => {
      const source = (category && typeof category === 'object' ? category : {}) as Record<string, unknown>
      const name = typeof source.name === 'string' ? source.name.trim() : ''
      if (!name) return null
      return {
        id: typeof source.id === 'string' && source.id ? source.id : crypto.randomUUID(),
        name,
        createdAt: toIso(source.createdAt, now),
        updatedAt: toIso(source.updatedAt, now),
      }
    })
    .filter((entry): entry is VaultCategory => Boolean(entry))

  // Migrate legacy folder/category strings into structured records.
  if (folders.length === 0) {
    const legacyFolders = uniqueByName(
      migratedItems
        .map((item) => item.folder.trim())
        .filter(Boolean)
        .map((name) => ({
          id: crypto.randomUUID(),
          name,
          parentId: null,
          color: '#7f9cff',
          icon: 'folder',
          notes: '',
          createdAt: now,
          updatedAt: now,
        })),
    )
    folders = legacyFolders
  }

  if (categories.length === 0) {
    const legacyCategories = uniqueByName(
      migratedItems
        .map((item) => item.category.trim())
        .filter(Boolean)
        .map((name) => ({
          id: crypto.randomUUID(),
          name,
          createdAt: now,
          updatedAt: now,
        })),
    )
    categories = legacyCategories
  }

  const folderByName = new Map(folders.map((folder) => [folder.name.trim().toLowerCase(), folder.id]))
  const categoryByName = new Map(categories.map((category) => [category.name.trim().toLowerCase(), category.id]))
  const validFolderIds = new Set(folders.map((folder) => folder.id))
  const validCategoryIds = new Set(categories.map((category) => category.id))

  const items = migratedItems.map((item) => {
    const nextFolderId = item.folderId && validFolderIds.has(item.folderId)
      ? item.folderId
      : folderByName.get(item.folder.trim().toLowerCase()) ?? null
    const nextCategoryId = item.categoryId && validCategoryIds.has(item.categoryId)
      ? item.categoryId
      : categoryByName.get(item.category.trim().toLowerCase()) ?? null
    const folderName = nextFolderId ? (folders.find((folder) => folder.id === nextFolderId)?.name ?? item.folder) : item.folder
    const categoryName = nextCategoryId ? (categories.find((category) => category.id === nextCategoryId)?.name ?? item.category) : item.category
    return {
      ...item,
      folderId: nextFolderId,
      categoryId: nextCategoryId,
      folder: folderName || '',
      category: categoryName || '',
    }
  })

  const settingsSource = (base.settings && typeof base.settings === 'object' ? base.settings : {}) as Record<string, unknown>
  const settings: VaultSettings = {
    trashRetentionDays: safeRetentionDays(settingsSource.trashRetentionDays),
    generatorPresets: Array.isArray(settingsSource.generatorPresets) ? settingsSource.generatorPresets : [],
  }

  const trashSource = Array.isArray(base.trash) ? base.trash : []
  const trash: VaultTrashEntry[] = []
  for (const entry of trashSource) {
    const source = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>
    if (source.kind !== 'folderTreeSnapshot' && source.kind !== 'itemSnapshot') {
      continue
    }
    const deletedAt = toIso(source.deletedAt, now)
    const retentionMs = settings.trashRetentionDays * 24 * 60 * 60 * 1000
    const fallbackPurgeAt = new Date(Date.parse(deletedAt) + retentionMs).toISOString()
    trash.push({
      id: typeof source.id === 'string' && source.id ? source.id : crypto.randomUUID(),
      kind: source.kind,
      payload: source.payload ?? null,
      deletedAt,
      purgeAt: toIso(source.purgeAt, fallbackPurgeAt),
    })
  }

  const normalized: VaultPayload = {
    schemaVersion: VAULT_SCHEMA_VERSION,
    items,
    folders,
    categories,
    trash,
    settings,
  }
  ensureTrashRetention(normalized)
  return normalized
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
  const rawPayload = await decryptJsonWithKey<unknown>(vaultKey, file.vaultData)
  const payload = normalizeVaultPayload(rawPayload)

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
  const payload = await decryptJsonWithKey<unknown>(session.vaultKey, file.vaultData)
  return normalizeVaultPayload(payload)
}

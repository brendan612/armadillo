import {
  createKdfConfig,
  createVaultKey,
  decryptJsonWithKey,
  deriveMasterKeyFromPassword,
  encryptJsonWithKey,
  unwrapVaultKeyWithRecoveryKey,
  unwrapVaultKey,
  wrapVaultKey,
} from './crypto'
import {
  VAULT_SCHEMA_VERSION,
  type ArmadilloVaultFile,
  type RecoveryKdfConfig,
  type VaultRecoveryConfig,
  type AutoFolderCustomMapping,
  type VaultFolder,
  type VaultPayload,
  type VaultSettings,
  type VaultStorageItem,
  type VaultStorageMode,
  type VaultSession,
  type VaultTrashEntry,
} from '../types/vault'
import { defaultThemeSettings, normalizeThemeSettings } from '../shared/utils/theme'

const LOCAL_VAULT_FILE_KEY = 'armadillo.local.vault.file'
const LOCAL_VAULT_PATH_KEY = 'armadillo.local.vault.path'
const LOCAL_VAULT_RECENT_PATHS_KEY = 'armadillo.local.vault.recent_paths'
const VAULT_STORAGE_MODE_KEY = 'armadillo.vault.storage_mode'
const CLOUD_CACHE_FILE_KEY = 'armadillo.cloud.cache.file'
const CLOUD_CACHE_EXPIRES_AT_KEY = 'armadillo.cloud.cache.expires_at'
const CLOUD_CACHE_TTL_HOURS_KEY = 'armadillo.cloud.cache.ttl_hours'
const DEFAULT_CLOUD_CACHE_TTL_HOURS = 72
const MAX_RECENT_LOCAL_VAULT_PATHS = 10

export type RecentLocalVaultEntry = {
  path: string
  lastUsedAt: string
}

export type LocalVaultPathStatus = 'exists' | 'missing' | 'unknown'
export type LocalVaultFileMeta = {
  vaultId: string
  revision: number
  updatedAt: string
}

export function defaultVaultPayload(): VaultPayload {
  return {
    schemaVersion: VAULT_SCHEMA_VERSION,
    items: [],
    storageItems: [],
    folders: [],
    trash: [],
    settings: defaultVaultSettings(),
  }
}

export function defaultVaultSettings(): VaultSettings {
  return {
    trashRetentionDays: 30,
    generatorPresets: [],
    autoFolderExcludedItemIds: [],
    autoFolderLockedFolderPaths: [],
    autoFolderCustomMappings: [],
    theme: defaultThemeSettings(),
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

function safeCacheTtlHours(input: unknown) {
  const numeric = Number(input)
  if (!Number.isFinite(numeric)) return DEFAULT_CLOUD_CACHE_TTL_HOURS
  const rounded = Math.round(numeric)
  return Math.min(24 * 30, Math.max(1, rounded))
}

function normalizeStringArray(input: unknown) {
  if (!Array.isArray(input)) return []
  const deduped = new Set<string>()
  for (const value of input) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (!trimmed) continue
    deduped.add(trimmed)
  }
  return Array.from(deduped)
}

function normalizeTagValues(tagsInput: unknown, legacyCategoryInput: unknown) {
  const deduped = new Map<string, string>()
  const push = (value: unknown) => {
    if (typeof value !== 'string') return
    const trimmed = value.trim()
    if (!trimmed) return
    const key = trimmed.toLowerCase()
    if (deduped.has(key)) return
    deduped.set(key, trimmed)
  }

  if (Array.isArray(tagsInput)) {
    for (const tag of tagsInput) {
      push(tag)
    }
  }
  push(legacyCategoryInput)

  return Array.from(deduped.values())
}

function normalizeLinkedAndroidPackages(input: unknown) {
  if (!Array.isArray(input)) return []
  const deduped = new Set<string>()
  const values: string[] = []
  for (const value of input) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim().toLowerCase()
    if (!trimmed || deduped.has(trimmed)) continue
    deduped.add(trimmed)
    values.push(trimmed)
  }
  return values
}

function normalizeAutoFolderCustomMappings(input: unknown): AutoFolderCustomMapping[] {
  if (!Array.isArray(input)) return []
  const deduped = new Set<string>()
  const rows: AutoFolderCustomMapping[] = []
  for (const entry of input) {
    const source = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>
    const matchType = source.matchType === 'domain' || source.matchType === 'titleToken' || source.matchType === 'tag'
      ? source.matchType
      : null
    const matchValue = typeof source.matchValue === 'string' ? source.matchValue.trim() : ''
    const targetPath = typeof source.targetPath === 'string' ? source.targetPath.trim() : ''
    if (!matchType || !matchValue || !targetPath) continue
    const key = `${matchType}:${matchValue.toLowerCase()}=>${targetPath.toLowerCase()}`
    if (deduped.has(key)) continue
    deduped.add(key)
    rows.push({
      id: typeof source.id === 'string' && source.id ? source.id : crypto.randomUUID(),
      matchType,
      matchValue,
      targetPath,
    })
  }
  return rows
}

function normalizeStorageKind(input: unknown): VaultStorageItem['kind'] {
  if (input === 'document' || input === 'image' || input === 'key' || input === 'token' || input === 'secret') {
    return input
  }
  return 'other'
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
  const rawStorageItems = Array.isArray(base.storageItems) ? base.storageItems : []

  const migratedItems = rawItems.map((item): VaultPayload['items'][number] => {
    const source = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
    return {
      id: typeof source.id === 'string' && source.id ? source.id : crypto.randomUUID(),
      title: typeof source.title === 'string' ? source.title : 'Untitled',
      username: typeof source.username === 'string' ? source.username : '',
      passwordMasked: typeof source.passwordMasked === 'string' ? source.passwordMasked : '',
      urls: Array.isArray(source.urls) ? source.urls.filter((v): v is string => typeof v === 'string') : [],
      linkedAndroidPackages: normalizeLinkedAndroidPackages(source.linkedAndroidPackages),
      folder: typeof source.folder === 'string' ? source.folder : '',
      folderId: typeof source.folderId === 'string' ? source.folderId : null,
      tags: normalizeTagValues(source.tags, source.category),
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
      excludeFromCloudSync: source.excludeFromCloudSync === true,
    }
  })

  const migratedStorageItems = rawStorageItems.map((item): VaultStorageItem | null => {
    const source = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
    const id = typeof source.id === 'string' && source.id ? source.id : crypto.randomUUID()
    const title = typeof source.title === 'string' ? source.title : 'Untitled Storage'
    const folder = typeof source.folder === 'string' ? source.folder : ''
    const folderId = typeof source.folderId === 'string' ? source.folderId : null
    const updatedAt = typeof source.updatedAt === 'string' && source.updatedAt ? source.updatedAt : new Date().toLocaleString()
    const blobRefSource = (source.blobRef && typeof source.blobRef === 'object' ? source.blobRef : null) as Record<string, unknown> | null
    const blobRef = blobRefSource && typeof blobRefSource.blobId === 'string' && blobRefSource.blobId
      ? {
          blobId: blobRefSource.blobId,
          fileName: typeof blobRefSource.fileName === 'string' ? blobRefSource.fileName : 'file',
          mimeType: typeof blobRefSource.mimeType === 'string' ? blobRefSource.mimeType : 'application/octet-stream',
          sizeBytes: Number.isFinite(Number(blobRefSource.sizeBytes)) ? Math.max(0, Number(blobRefSource.sizeBytes)) : 0,
          sha256: typeof blobRefSource.sha256 === 'string' ? blobRefSource.sha256 : '',
        }
      : null

    return {
      id,
      title,
      kind: normalizeStorageKind(source.kind),
      folder,
      folderId,
      tags: normalizeTagValues(source.tags, undefined),
      note: typeof source.note === 'string' ? source.note : '',
      updatedAt,
      excludeFromCloudSync: source.excludeFromCloudSync === true,
      textValue: typeof source.textValue === 'string' ? source.textValue : '',
      blobRef,
    }
  }).filter((entry): entry is VaultStorageItem => Boolean(entry))

  const rawFolders = Array.isArray(base.folders) ? base.folders : []

  let folders: VaultFolder[] = rawFolders
    .map((folder): VaultFolder | null => {
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
        excludeFromCloudSync: source.excludeFromCloudSync === true,
      }
    })
    .filter((entry): entry is VaultFolder => Boolean(entry))

  // Migrate legacy folder strings into structured records.
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

  const folderByName = new Map(folders.map((folder) => [folder.name.trim().toLowerCase(), folder.id]))
  const validFolderIds = new Set(folders.map((folder) => folder.id))

  const items = migratedItems.map((item) => {
    const nextFolderId = item.folderId && validFolderIds.has(item.folderId)
      ? item.folderId
      : folderByName.get(item.folder.trim().toLowerCase()) ?? null
    const folderName = nextFolderId ? (folders.find((folder) => folder.id === nextFolderId)?.name ?? item.folder) : item.folder
    return {
      ...item,
      folderId: nextFolderId,
      folder: folderName || '',
    }
  })

  const storageItems = migratedStorageItems.map((item) => {
    const nextFolderId = item.folderId && validFolderIds.has(item.folderId)
      ? item.folderId
      : folderByName.get(item.folder.trim().toLowerCase()) ?? null
    const folderName = nextFolderId ? (folders.find((folder) => folder.id === nextFolderId)?.name ?? item.folder) : item.folder
    return {
      ...item,
      folderId: nextFolderId,
      folder: folderName || '',
    }
  })

  const settingsSource = (base.settings && typeof base.settings === 'object' ? base.settings : {}) as Record<string, unknown>
  const settings: VaultSettings = {
    trashRetentionDays: safeRetentionDays(settingsSource.trashRetentionDays),
    generatorPresets: Array.isArray(settingsSource.generatorPresets) ? settingsSource.generatorPresets : [],
    autoFolderExcludedItemIds: normalizeStringArray(settingsSource.autoFolderExcludedItemIds),
    autoFolderLockedFolderPaths: normalizeStringArray(settingsSource.autoFolderLockedFolderPaths),
    autoFolderCustomMappings: normalizeAutoFolderCustomMappings(settingsSource.autoFolderCustomMappings),
    theme: normalizeThemeSettings(settingsSource.theme),
  }

  const trashSource = Array.isArray(base.trash) ? base.trash : []
  const trash: VaultTrashEntry[] = []
  for (const entry of trashSource) {
    const source = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>
    if (source.kind !== 'folderTreeSnapshot' && source.kind !== 'itemSnapshot' && source.kind !== 'storageItemSnapshot') {
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
    storageItems,
    folders,
    trash,
    settings,
  }
  ensureTrashRetention(normalized)
  return normalized
}

function parseVaultFileJson(raw: string | null): ArmadilloVaultFile | null {
  if (!raw) return null
  try {
    return normalizeVaultFileShape(JSON.parse(raw))
  } catch {
    return null
  }
}

function normalizeRecoveryKdf(raw: unknown): RecoveryKdfConfig | null {
  const source = (raw && typeof raw === 'object' ? raw : null) as Record<string, unknown> | null
  if (!source || source.algorithm !== 'ARGON2ID') return null
  const iterations = Number(source.iterations)
  const memoryKiB = Number(source.memoryKiB)
  const parallelism = Number(source.parallelism)
  const salt = typeof source.salt === 'string' ? source.salt : ''
  if (!Number.isFinite(iterations) || iterations < 1) return null
  if (!Number.isFinite(memoryKiB) || memoryKiB < 8 * 1024) return null
  if (!Number.isFinite(parallelism) || parallelism < 1) return null
  if (!salt) return null
  return {
    algorithm: 'ARGON2ID',
    iterations: Math.round(iterations),
    memoryKiB: Math.round(memoryKiB),
    parallelism: Math.round(parallelism),
    salt,
  }
}

function normalizeRecoveryConfig(raw: unknown): VaultRecoveryConfig | undefined {
  const source = (raw && typeof raw === 'object' ? raw : null) as Record<string, unknown> | null
  if (!source || Number(source.version) !== 1) return undefined
  const kdf = normalizeRecoveryKdf(source.kdf)
  if (!kdf) return undefined
  const wrappedSource = (source.wrappedVaultKeyRecovery && typeof source.wrappedVaultKeyRecovery === 'object'
    ? source.wrappedVaultKeyRecovery
    : null) as Record<string, unknown> | null
  if (!wrappedSource || typeof wrappedSource.nonce !== 'string' || typeof wrappedSource.ciphertext !== 'string') {
    return undefined
  }
  const enabledAt = typeof source.enabledAt === 'string' ? source.enabledAt : ''
  const recoveryKeyFingerprint = typeof source.recoveryKeyFingerprint === 'string' ? source.recoveryKeyFingerprint : ''
  if (!enabledAt || !recoveryKeyFingerprint) return undefined
  const rotatedAt = typeof source.rotatedAt === 'string' && source.rotatedAt ? source.rotatedAt : undefined
  return {
    version: 1,
    kdf,
    wrappedVaultKeyRecovery: {
      nonce: wrappedSource.nonce,
      ciphertext: wrappedSource.ciphertext,
    },
    recoveryKeyFingerprint,
    enabledAt,
    ...(rotatedAt ? { rotatedAt } : {}),
  }
}

function normalizeVaultFileShape(raw: unknown): ArmadilloVaultFile {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  if (source.format !== 'armadillo-v1') {
    throw new Error('Unsupported vault file format')
  }
  const kdfSource = source.kdf as Record<string, unknown> | undefined
  if (!kdfSource || typeof kdfSource !== 'object' || typeof kdfSource.algorithm !== 'string') {
    throw new Error('Unsupported vault file format')
  }
  const normalizedKdf = kdfSource.algorithm === 'ARGON2ID'
    ? {
        algorithm: 'ARGON2ID' as const,
        iterations: Number(kdfSource.iterations),
        memoryKiB: Number(kdfSource.memoryKiB),
        parallelism: Number(kdfSource.parallelism),
        salt: typeof kdfSource.salt === 'string' ? kdfSource.salt : '',
      }
    : {
        algorithm: 'PBKDF2-SHA256' as const,
        iterations: Number(kdfSource.iterations),
        salt: typeof kdfSource.salt === 'string' ? kdfSource.salt : '',
      }
  if (!normalizedKdf.salt || !Number.isFinite(normalizedKdf.iterations) || normalizedKdf.iterations < 1) {
    throw new Error('Unsupported vault file format')
  }
  if (normalizedKdf.algorithm === 'ARGON2ID' && (
    !Number.isFinite(normalizedKdf.memoryKiB)
    || normalizedKdf.memoryKiB < 8 * 1024
    || !Number.isFinite(normalizedKdf.parallelism)
    || normalizedKdf.parallelism < 1
  )) {
    throw new Error('Unsupported vault file format')
  }
  const wrappedVaultKey = (source.wrappedVaultKey && typeof source.wrappedVaultKey === 'object'
    ? source.wrappedVaultKey
    : null) as Record<string, unknown> | null
  const vaultData = (source.vaultData && typeof source.vaultData === 'object'
    ? source.vaultData
    : null) as Record<string, unknown> | null
  if (
    !wrappedVaultKey
    || !vaultData
    || typeof wrappedVaultKey.nonce !== 'string'
    || typeof wrappedVaultKey.ciphertext !== 'string'
    || typeof vaultData.nonce !== 'string'
    || typeof vaultData.ciphertext !== 'string'
  ) {
    throw new Error('Unsupported vault file format')
  }
  return {
    ...source,
    format: 'armadillo-v1',
    vaultId: typeof source.vaultId === 'string' && source.vaultId ? source.vaultId : crypto.randomUUID(),
    revision: Number.isFinite(Number(source.revision)) ? Number(source.revision) : 1,
    updatedAt: typeof source.updatedAt === 'string' && source.updatedAt ? source.updatedAt : new Date().toISOString(),
    kdf: normalizedKdf,
    wrappedVaultKey: {
      nonce: wrappedVaultKey.nonce,
      ciphertext: wrappedVaultKey.ciphertext,
    },
    vaultData: {
      nonce: vaultData.nonce,
      ciphertext: vaultData.ciphertext,
    },
    recovery: normalizeRecoveryConfig(source.recovery),
  } as ArmadilloVaultFile
}

export function getVaultStorageMode(): VaultStorageMode {
  const raw = localStorage.getItem(VAULT_STORAGE_MODE_KEY)
  return raw === 'cloud_only' ? 'cloud_only' : 'local_file'
}

export function setVaultStorageMode(mode: VaultStorageMode) {
  localStorage.setItem(VAULT_STORAGE_MODE_KEY, mode)
}

export function getCloudCacheTtlHours() {
  return safeCacheTtlHours(localStorage.getItem(CLOUD_CACHE_TTL_HOURS_KEY))
}

export function setCloudCacheTtlHours(hours: number) {
  localStorage.setItem(CLOUD_CACHE_TTL_HOURS_KEY, String(safeCacheTtlHours(hours)))
}

export function getCachedVaultStatus(): 'missing' | 'expired' | 'valid' {
  const raw = localStorage.getItem(CLOUD_CACHE_FILE_KEY)
  if (!raw) return 'missing'

  const expiresAt = localStorage.getItem(CLOUD_CACHE_EXPIRES_AT_KEY)
  if (!expiresAt) return 'valid'

  const expiresAtMs = Date.parse(expiresAt)
  if (Number.isFinite(expiresAtMs) && Date.now() > expiresAtMs) {
    return 'expired'
  }
  return 'valid'
}

export function getCachedVaultExpiresAt() {
  return localStorage.getItem(CLOUD_CACHE_EXPIRES_AT_KEY) || ''
}

export function loadCachedVaultSnapshot(includeExpired = false): ArmadilloVaultFile | null {
  const status = getCachedVaultStatus()
  if (status === 'missing') {
    return null
  }
  if (status === 'expired' && !includeExpired) {
    return null
  }

  return parseVaultFileJson(localStorage.getItem(CLOUD_CACHE_FILE_KEY))
}

export function saveCachedVaultSnapshot(file: ArmadilloVaultFile, ttlHours = getCloudCacheTtlHours()) {
  const safeTtlHours = safeCacheTtlHours(ttlHours)
  localStorage.setItem(CLOUD_CACHE_FILE_KEY, JSON.stringify(file))
  localStorage.setItem(CLOUD_CACHE_TTL_HOURS_KEY, String(safeTtlHours))
  localStorage.setItem(CLOUD_CACHE_EXPIRES_AT_KEY, new Date(Date.now() + safeTtlHours * 60 * 60 * 1000).toISOString())
}

export function clearCachedVaultSnapshot() {
  localStorage.removeItem(CLOUD_CACHE_FILE_KEY)
  localStorage.removeItem(CLOUD_CACHE_EXPIRES_AT_KEY)
}

function isWindowsPathMode() {
  return window.armadilloShell?.isElectron && window.armadilloShell.platform === 'win32'
}

function normalizeVaultPathKey(path: string) {
  const trimmed = path.trim()
  if (!trimmed) return ''
  return isWindowsPathMode() ? trimmed.toLowerCase() : trimmed
}

function readRecentLocalVaultEntriesFromStorage(): RecentLocalVaultEntry[] {
  const raw = localStorage.getItem(LOCAL_VAULT_RECENT_PATHS_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const deduped = new Set<string>()
    const rows: RecentLocalVaultEntry[] = []
    for (const entry of parsed) {
      const source = (entry && typeof entry === 'object' ? entry : null) as Record<string, unknown> | null
      if (!source || typeof source.path !== 'string') continue
      const path = source.path.trim()
      if (!path) continue
      const key = normalizeVaultPathKey(path)
      if (!key || deduped.has(key)) continue
      deduped.add(key)
      const lastUsedAt = typeof source.lastUsedAt === 'string' && source.lastUsedAt
        ? source.lastUsedAt
        : new Date().toISOString()
      rows.push({ path, lastUsedAt })
    }
    return rows.slice(0, MAX_RECENT_LOCAL_VAULT_PATHS)
  } catch {
    return []
  }
}

function writeRecentLocalVaultEntriesToStorage(entries: RecentLocalVaultEntry[]) {
  localStorage.setItem(
    LOCAL_VAULT_RECENT_PATHS_KEY,
    JSON.stringify(entries.slice(0, MAX_RECENT_LOCAL_VAULT_PATHS)),
  )
}

function seedRecentLocalVaultsFromActivePath() {
  const recents = readRecentLocalVaultEntriesFromStorage()
  if (recents.length > 0) return recents
  const activePath = localStorage.getItem(LOCAL_VAULT_PATH_KEY)?.trim()
  if (!activePath) return recents
  const seeded = [{ path: activePath, lastUsedAt: new Date().toISOString() }]
  writeRecentLocalVaultEntriesToStorage(seeded)
  return seeded
}

export function listRecentLocalVaultPaths(): RecentLocalVaultEntry[] {
  return seedRecentLocalVaultsFromActivePath()
}

export function rememberLocalVaultPath(path: string) {
  const trimmed = path.trim()
  if (!trimmed) return
  const key = normalizeVaultPathKey(trimmed)
  if (!key) return
  const nowIso = new Date().toISOString()
  const existing = listRecentLocalVaultPaths().filter((entry) => normalizeVaultPathKey(entry.path) !== key)
  writeRecentLocalVaultEntriesToStorage([{ path: trimmed, lastUsedAt: nowIso }, ...existing])
}

export function removeRecentLocalVaultPath(path: string) {
  const key = normalizeVaultPathKey(path)
  if (!key) return
  const filtered = listRecentLocalVaultPaths().filter((entry) => normalizeVaultPathKey(entry.path) !== key)
  writeRecentLocalVaultEntriesToStorage(filtered)

  const activePath = getActiveLocalVaultPath()
  if (normalizeVaultPathKey(activePath) === key) {
    if (filtered[0]?.path) {
      setActiveLocalVaultPath(filtered[0].path)
    } else {
      localStorage.removeItem(LOCAL_VAULT_PATH_KEY)
    }
  }
}

export function getActiveLocalVaultPath() {
  return localStorage.getItem(LOCAL_VAULT_PATH_KEY) || ''
}

export function setActiveLocalVaultPath(path: string) {
  const trimmed = path.trim()
  if (!trimmed) {
    localStorage.removeItem(LOCAL_VAULT_PATH_KEY)
    return
  }
  localStorage.setItem(LOCAL_VAULT_PATH_KEY, trimmed)
}

export function getLocalVaultPathStatus(path: string): LocalVaultPathStatus {
  const trimmed = path.trim()
  if (!trimmed) return 'unknown'
  const shell = window.armadilloShell
  if (shell?.isElectron && shell.readVaultFile) {
    const raw = shell.readVaultFile(trimmed)
    return raw ? 'exists' : 'missing'
  }
  return 'unknown'
}

export function loadLocalVaultFileAtPath(path: string): ArmadilloVaultFile | null {
  const trimmed = path.trim()
  if (!trimmed) return null
  const shell = window.armadilloShell
  if (shell?.isElectron && shell.readVaultFile) {
    const rawFromFile = shell.readVaultFile(trimmed)
    if (!rawFromFile) {
      return null
    }
    try {
      const parsed = normalizeVaultFileShape(JSON.parse(rawFromFile))
      localStorage.setItem(LOCAL_VAULT_FILE_KEY, rawFromFile)
      setActiveLocalVaultPath(trimmed)
      rememberLocalVaultPath(trimmed)
      return parsed
    } catch {
      return null
    }
  }
  return null
}

export function readLocalVaultFileMeta(path: string): LocalVaultFileMeta | null {
  const trimmed = path.trim()
  if (!trimmed) return null
  const shell = window.armadilloShell
  if (!shell?.isElectron || !shell.readVaultFile) return null
  const raw = shell.readVaultFile(trimmed)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as ArmadilloVaultFile
    if (parsed.format !== 'armadillo-v1' || typeof parsed.vaultId !== 'string' || !parsed.vaultId) {
      return null
    }
    return {
      vaultId: parsed.vaultId,
      revision: Number.isFinite(parsed.revision) ? parsed.revision : 0,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
    }
  } catch {
    return null
  }
}

export function loadLocalVaultFile(): ArmadilloVaultFile | null {
  const shell = window.armadilloShell
  const activePath = getActiveLocalVaultPath()
  if (activePath) {
    const loaded = loadLocalVaultFileAtPath(activePath)
    if (loaded) return loaded
  }
  if (shell?.isElectron) {
    return null
  }
  return parseVaultFileJson(localStorage.getItem(LOCAL_VAULT_FILE_KEY))
}

export function getLocalVaultPath() {
  const shell = window.armadilloShell
  const activePath = getActiveLocalVaultPath()
  if (activePath) return activePath
  const fallbackPath = shell?.getDefaultVaultPath?.() || ''
  if (fallbackPath) {
    setActiveLocalVaultPath(fallbackPath)
    rememberLocalVaultPath(fallbackPath)
  }
  return fallbackPath
}

export function setLocalVaultPath(path: string) {
  const trimmed = path.trim()
  if (!trimmed) {
    setActiveLocalVaultPath('')
    return
  }
  setActiveLocalVaultPath(trimmed)
  rememberLocalVaultPath(trimmed)
}

export function saveLocalVaultFile(file: ArmadilloVaultFile) {
  const raw = JSON.stringify(file)
  localStorage.setItem(LOCAL_VAULT_FILE_KEY, raw)

  const shell = window.armadilloShell
  if (shell?.isElectron && shell.writeVaultFile) {
    const knownPath = getLocalVaultPath()
    if (knownPath && shell.writeVaultFile(raw, knownPath)) {
      setActiveLocalVaultPath(knownPath)
      rememberLocalVaultPath(knownPath)
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
  return normalizeVaultFileShape(JSON.parse(text))
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

export async function unlockVaultFileWithRecoveryKey(file: ArmadilloVaultFile, recoveryKeyBytes: Uint8Array): Promise<VaultSession> {
  if (!file.recovery) {
    throw new Error('Recovery kit is not enabled for this vault')
  }
  const vaultKey = await unwrapVaultKeyWithRecoveryKey({
    recoveryKeyBytes,
    kdf: file.recovery.kdf,
    wrappedVaultKeyRecovery: file.recovery.wrappedVaultKeyRecovery,
  })
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

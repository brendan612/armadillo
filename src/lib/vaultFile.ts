import {
  createKdfConfig,
  createVaultKey,
  decryptJsonWithKey,
  deriveMasterKeyFromPassword,
  encryptJsonWithKey,
  unwrapVaultKey,
  wrapVaultKey,
} from './crypto'
import {
  VAULT_SCHEMA_VERSION,
  type ArmadilloVaultFile,
  type AutoFolderCustomMapping,
  type VaultFolder,
  type VaultPayload,
  type VaultSettings,
  type VaultStorageMode,
  type VaultSession,
  type VaultTrashEntry,
} from '../types/vault'

const LOCAL_VAULT_FILE_KEY = 'armadillo.local.vault.file'
const LOCAL_VAULT_PATH_KEY = 'armadillo.local.vault.path'
const VAULT_STORAGE_MODE_KEY = 'armadillo.vault.storage_mode'
const CLOUD_CACHE_FILE_KEY = 'armadillo.cloud.cache.file'
const CLOUD_CACHE_EXPIRES_AT_KEY = 'armadillo.cloud.cache.expires_at'
const CLOUD_CACHE_TTL_HOURS_KEY = 'armadillo.cloud.cache.ttl_hours'
const DEFAULT_CLOUD_CACHE_TTL_HOURS = 72

export function defaultVaultPayload(): VaultPayload {
  return {
    schemaVersion: VAULT_SCHEMA_VERSION,
    items: [],
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
    }
  })

  const rawFolders = Array.isArray(base.folders) ? base.folders : []

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

  const settingsSource = (base.settings && typeof base.settings === 'object' ? base.settings : {}) as Record<string, unknown>
  const settings: VaultSettings = {
    trashRetentionDays: safeRetentionDays(settingsSource.trashRetentionDays),
    generatorPresets: Array.isArray(settingsSource.generatorPresets) ? settingsSource.generatorPresets : [],
    autoFolderExcludedItemIds: normalizeStringArray(settingsSource.autoFolderExcludedItemIds),
    autoFolderLockedFolderPaths: normalizeStringArray(settingsSource.autoFolderLockedFolderPaths),
    autoFolderCustomMappings: normalizeAutoFolderCustomMappings(settingsSource.autoFolderCustomMappings),
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
    trash,
    settings,
  }
  ensureTrashRetention(normalized)
  return normalized
}

function parseVaultFileJson(raw: string | null): ArmadilloVaultFile | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as ArmadilloVaultFile
  } catch {
    return null
  }
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

  return parseVaultFileJson(localStorage.getItem(LOCAL_VAULT_FILE_KEY))
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

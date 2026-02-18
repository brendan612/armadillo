export type RiskState = 'safe' | 'weak' | 'reused' | 'exposed' | 'stale'
export const VAULT_SCHEMA_VERSION = 5 as const

export type SecurityQuestion = {
  question: string
  answer: string
}

export type VaultItem = {
  id: string
  title: string
  username: string
  passwordMasked: string
  urls: string[]
  linkedAndroidPackages?: string[]
  folder: string
  folderId?: string | null
  tags: string[]
  risk: RiskState
  updatedAt: string
  note: string
  securityQuestions: SecurityQuestion[]
  passwordExpiryDate?: string | null
  excludeFromCloudSync?: boolean
}

export type VaultFolder = {
  id: string
  name: string
  parentId: string | null
  color: string
  icon: string
  notes: string
  createdAt: string
  updatedAt: string
  excludeFromCloudSync?: boolean
}

export type StorageKind = 'document' | 'image' | 'key' | 'token' | 'secret' | 'other'

export type VaultStorageBlobRef = {
  blobId: string
  fileName: string
  mimeType: string
  sizeBytes: number
  sha256: string
}

export type VaultStorageItem = {
  id: string
  title: string
  kind: StorageKind
  folder: string
  folderId?: string | null
  tags: string[]
  note: string
  updatedAt: string
  excludeFromCloudSync?: boolean
  textValue?: string
  blobRef?: VaultStorageBlobRef | null
}

export type VaultTrashKind = 'folderTreeSnapshot' | 'itemSnapshot' | 'storageItemSnapshot'

export type VaultTrashEntry = {
  id: string
  kind: VaultTrashKind
  payload: unknown
  deletedAt: string
  purgeAt: string
}

export type GeneratorPreset = {
  id: string
  name: string
  length: number
  uppercase: boolean
  lowercase: boolean
  digits: boolean
  symbols: boolean
}

export type BuiltInThemeId = 'midnight' | 'daylight' | 'void' | 'ember'
export type ThemeMotionLevel = 'normal' | 'reduced'

export type ThemeEditableTokenKey =
  | 'accent'
  | 'bg-0'
  | 'bg-1'
  | 'bg-2'
  | 'bg-3'
  | 'surface-solid'
  | 'ink'
  | 'ink-secondary'
  | 'ink-muted'
  | 'line-strong'
  | 'safe'
  | 'weak'
  | 'reused'
  | 'exposed'
  | 'stale'
  | 'blur'
  | 'noise-opacity'

export type ThemeTokenOverrides = Partial<Record<ThemeEditableTokenKey, string>>

export type ThemeCustomPreset = {
  id: string
  name: string
  baseThemeId: BuiltInThemeId
  overrides: ThemeTokenOverrides
  createdAt: string
  updatedAt: string
}

export type VaultThemeSettings = {
  activeBaseThemeId: BuiltInThemeId
  activeOverrides: ThemeTokenOverrides
  selectedPresetId: string
  customPresets: ThemeCustomPreset[]
  motionLevel: ThemeMotionLevel
}

export type AutoFolderMatchType = 'domain' | 'titleToken' | 'tag'

export type AutoFolderCustomMapping = {
  id: string
  matchType: AutoFolderMatchType
  matchValue: string
  targetPath: string
}

export type VaultSettings = {
  trashRetentionDays: number
  generatorPresets: GeneratorPreset[]
  autoFolderExcludedItemIds?: string[]
  autoFolderLockedFolderPaths?: string[]
  autoFolderCustomMappings?: AutoFolderCustomMapping[]
  theme?: VaultThemeSettings
}

export type VaultPayload = {
  schemaVersion: number
  items: VaultItem[]
  storageItems: VaultStorageItem[]
  folders: VaultFolder[]
  trash: VaultTrashEntry[]
  settings: VaultSettings
}

export type EncryptedBlob = {
  nonce: string
  ciphertext: string
}

export type ArmadilloVaultFile = {
  format: 'armadillo-v1'
  vaultId: string
  revision: number
  updatedAt: string
  kdf:
    | {
        algorithm: 'ARGON2ID'
        iterations: number
        memoryKiB: number
        parallelism: number
        salt: string
      }
    | {
        algorithm: 'PBKDF2-SHA256'
        iterations: number
        salt: string
      }
  wrappedVaultKey: EncryptedBlob
  vaultData: EncryptedBlob
}

export type VaultSession = {
  file: ArmadilloVaultFile
  payload: VaultPayload
  vaultKey: CryptoKey
}

export type SyncIdentitySource = 'auth' | 'anonymous'

export type VaultStorageMode = 'local_file' | 'cloud_only'
export type SyncProvider = 'convex' | 'self_hosted'

export type WorkspaceScope = {
  orgId: string
  vaultId: string
}

export type MembershipRole = 'owner' | 'admin' | 'editor' | 'viewer'

export type WrappedVaultKeyForMember = {
  memberId: string
  alg: string
  wrappedKey: string
  createdAt: string
  revokedAt?: string
}

export type OrgRecoveryPolicy = {
  enabled: boolean
  wrappedKeyForOrg?: string
}

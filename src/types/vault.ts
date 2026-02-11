export type RiskState = 'safe' | 'weak' | 'reused' | 'exposed' | 'stale'
export const VAULT_SCHEMA_VERSION = 2 as const

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
  category: string
  folder: string
  categoryId?: string | null
  folderId?: string | null
  tags: string[]
  risk: RiskState
  updatedAt: string
  note: string
  securityQuestions: SecurityQuestion[]
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
}

export type VaultCategory = {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

export type VaultTrashKind = 'folderTreeSnapshot' | 'itemSnapshot'

export type VaultTrashEntry = {
  id: string
  kind: VaultTrashKind
  payload: unknown
  deletedAt: string
  purgeAt: string
}

export type VaultSettings = {
  trashRetentionDays: number
}

export type VaultPayload = {
  schemaVersion: number
  items: VaultItem[]
  folders: VaultFolder[]
  categories: VaultCategory[]
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

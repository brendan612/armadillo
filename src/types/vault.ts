export type RiskState = 'safe' | 'weak' | 'reused' | 'exposed' | 'stale'

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
  tags: string[]
  risk: RiskState
  updatedAt: string
  note: string
  securityQuestions: SecurityQuestion[]
}

export type VaultPayload = {
  items: VaultItem[]
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

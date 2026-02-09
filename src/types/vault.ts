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

export type SaveVaultItemInput = Omit<VaultItem, 'updatedAt'> & { updatedAt?: string }

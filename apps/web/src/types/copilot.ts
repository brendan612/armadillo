import type { RiskState } from './vault'

export type VaultAiMode = 'local_only'

export type VaultAiSettings = {
  enabled: boolean
  mode: VaultAiMode
  allowSelectedNoteAnalysis: boolean
}

export type CopilotSmartView = 'weak' | 'reused' | 'exposed' | 'stale' | 'unfiled'
export type VaultSuggestionPriority = 'critical' | 'high' | 'medium' | 'low'

export type VaultSuggestionKind =
  | 'review_exposed_password'
  | 'review_reused_password'
  | 'review_weak_password'
  | 'review_stale_entry'
  | 'rotate_password'
  | 'move_to_folder'
  | 'add_tags'
  | 'normalize_title'
  | 'set_expiry_date'
  | 'review_duplicates'

export type VaultSuggestionTarget =
  | { scope: 'item'; itemId: string }
  | { scope: 'items'; itemIds: string[] }
  | { scope: 'vault' }

export type VaultSuggestionAction =
  | { type: 'open_item'; itemId: string }
  | { type: 'open_smart_view'; view: CopilotSmartView }

export type VaultSuggestionPayload = {
  relatedItemIds?: string[]
  suggestedExpiryDate?: string
  suggestedFolder?: string
  suggestedTags?: string[]
  suggestedTitle?: string
}

export type VaultSuggestion = {
  id: string
  itemId?: string
  kind: VaultSuggestionKind
  priority: VaultSuggestionPriority
  title: string
  detail: string
  rationale: string
  target: VaultSuggestionTarget
  action?: VaultSuggestionAction
  payload?: VaultSuggestionPayload
}

export type VaultAiInputSnapshot = {
  itemId: string
  title: string
  username: string
  urlHosts: string[]
  tags: string[]
  folderPath: string
  updatedAt: string
  risk: RiskState
  passwordExpiryDate: string | null
  reuseCount: number
  breachDetected: boolean
  staleCandidate: boolean
  duplicateCandidateIds: string[]
  noteAnalysisAllowed: boolean
}

export type VaultCopilotModel = {
  vaultSuggestions: VaultSuggestion[]
  itemSuggestionsById: Map<string, VaultSuggestion[]>
  aiInputsByItemId: Map<string, VaultAiInputSnapshot>
}

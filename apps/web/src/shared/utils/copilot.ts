import type { VaultFolder, VaultItem } from '../../types/vault'
import type {
  VaultAiInputSnapshot,
  VaultAiSettings,
  VaultCopilotModel,
  VaultSuggestion,
  VaultSuggestionPriority,
} from '../../types/copilot'
import { isPasswordCredential } from './credentialKinds.ts'

const STALE_ENTRY_DAYS = 180
const EXPIRY_SUGGESTION_DAYS = 90
const GENERIC_TITLE_TOKENS = new Set([
  '',
  'new credential',
  'captured credential',
  'new login',
  'untitled',
  'untitled credential',
])

const PRIORITY_RANK: Record<VaultSuggestionPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
}

export const AI_INCLUDED_FIELD_LABELS = [
  'title',
  'username',
  'url hostnames',
  'tags',
  'folder path',
  'updated timestamp',
  'risk state',
  'password expiry metadata',
  'breach metadata',
  'password reuse counts',
] as const

export const AI_EXCLUDED_FIELD_LABELS = [
  'password value',
  'secure note contents',
  'security question answers',
  'recovery key plaintext',
  'wrapped vault keys',
  'recovery wrapping metadata',
] as const

export function defaultAiSettings(): VaultAiSettings {
  return {
    enabled: true,
    mode: 'local_only',
    allowSelectedNoteAnalysis: false,
  }
}

export function normalizeAiSettings(settings: VaultAiSettings | null | undefined): VaultAiSettings {
  const defaults = defaultAiSettings()
  if (!settings || typeof settings !== 'object') {
    return defaults
  }
  return {
    enabled: settings.enabled !== false,
    mode: settings.mode === 'local_only' ? 'local_only' : defaults.mode,
    allowSelectedNoteAnalysis: settings.allowSelectedNoteAnalysis === true,
  }
}

function computePasswordReuseCounts(items: VaultItem[]) {
  const counts = new Map<string, number>()
  for (const item of items) {
    if (!isPasswordCredential(item)) continue
    const password = item.passwordMasked ?? ''
    if (!password) continue
    counts.set(password, (counts.get(password) ?? 0) + 1)
  }
  return counts
}

function normalizeTitleToken(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
}

function toTitleCase(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0] ? `${part[0].toUpperCase()}${part.slice(1)}` : part)
    .join(' ')
}

function extractUrlHost(rawUrl: string) {
  const value = rawUrl.trim()
  if (!value) return ''
  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`)
    return url.hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

function buildServiceLabel(item: VaultItem) {
  const firstHost = item.urls.map(extractUrlHost).find(Boolean)
  if (firstHost) {
    const mainToken = firstHost.split('.').filter(Boolean)[0] ?? firstHost
    return toTitleCase(normalizeTitleToken(mainToken))
  }
  if (item.title.trim()) {
    return toTitleCase(normalizeTitleToken(item.title))
  }
  return 'Account'
}

function chooseFolderSuggestion(label: string, folderPathById: Map<string, string>, folders: VaultFolder[]) {
  const normalizedLabel = label.trim().toLowerCase()
  for (const folder of folders) {
    const path = folderPathById.get(folder.id) ?? folder.name
    const leaf = path.split('/').filter(Boolean).at(-1) ?? path
    if (path.trim().toLowerCase() === normalizedLabel || leaf.trim().toLowerCase() === normalizedLabel) {
      return path
    }
  }
  return label
}

function parseUpdatedAt(updatedAt: string) {
  const parsed = Date.parse(updatedAt)
  return Number.isFinite(parsed) ? parsed : null
}

function isStaleCandidate(updatedAt: string, now = Date.now()) {
  const parsed = parseUpdatedAt(updatedAt)
  if (!parsed) return false
  return now - parsed >= STALE_ENTRY_DAYS * 24 * 60 * 60 * 1000
}

function normalizeDuplicateKey(item: VaultItem) {
  const host = item.urls.map(extractUrlHost).find(Boolean) ?? ''
  const username = item.username.trim().toLowerCase()
  const title = normalizeTitleToken(item.title)
  if (host && username) {
    return `${host}|${username}`
  }
  const genericTitle = GENERIC_TITLE_TOKENS.has(title)
  const parts = [username, genericTitle ? '' : title].filter(Boolean)
  if (parts.length < 2) return ''
  return parts.join('|')
}

function buildDuplicateMap(items: VaultItem[]) {
  const grouped = new Map<string, string[]>()
  for (const item of items) {
    const key = normalizeDuplicateKey(item)
    if (!key) continue
    const current = grouped.get(key) ?? []
    current.push(item.id)
    grouped.set(key, current)
  }

  const duplicates = new Map<string, string[]>()
  for (const ids of grouped.values()) {
    if (ids.length < 2) continue
    for (const itemId of ids) {
      duplicates.set(itemId, ids.filter((candidate) => candidate !== itemId))
    }
  }
  return duplicates
}

function createExpirySuggestionDate(now = new Date()) {
  const next = new Date(now)
  next.setDate(next.getDate() + EXPIRY_SUGGESTION_DAYS)
  return next.toISOString().slice(0, 10)
}

function buildSuggestionId(itemId: string | null, kind: VaultSuggestion['kind'], suffix = '') {
  return [itemId ?? 'vault', kind, suffix].filter(Boolean).join(':')
}

function compareSuggestions(a: VaultSuggestion, b: VaultSuggestion) {
  const priorityDelta = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
  if (priorityDelta !== 0) return priorityDelta
  return a.title.localeCompare(b.title)
}

export function buildItemAiInputSnapshot(
  item: VaultItem,
  options: {
    folderPath?: string
    reuseCount?: number
    duplicateCandidateIds?: string[]
    noteAnalysisAllowed?: boolean
    staleCandidate?: boolean
  } = {},
): VaultAiInputSnapshot {
  const hosts = item.urls
    .map(extractUrlHost)
    .filter(Boolean)
    .filter((host, index, all) => all.indexOf(host) === index)

  return {
    itemId: item.id,
    title: item.title.trim(),
    username: item.username.trim(),
    urlHosts: hosts,
    tags: item.tags.map((tag) => tag.trim()).filter(Boolean),
    folderPath: options.folderPath ?? item.folder,
    updatedAt: item.updatedAt,
    risk: item.risk,
    passwordExpiryDate: item.passwordExpiryDate ?? null,
    reuseCount: Math.max(0, options.reuseCount ?? 0),
    breachDetected: item.risk === 'exposed',
    staleCandidate: options.staleCandidate ?? isStaleCandidate(item.updatedAt),
    duplicateCandidateIds: options.duplicateCandidateIds ?? [],
    noteAnalysisAllowed: options.noteAnalysisAllowed === true,
  }
}

export function buildItemRiskNarrative(input: VaultAiInputSnapshot) {
  const lines: string[] = []

  if (input.breachDetected) {
    lines.push('This password is already marked as exposed, so rotation should come first.')
  } else if (input.reuseCount > 1) {
    lines.push(`This password is reused across ${input.reuseCount} vault entries.`)
  } else if (input.risk === 'weak') {
    lines.push('The saved password looks weak against Armadillo strength heuristics.')
  }

  if (input.staleCandidate) {
    lines.push('This entry has not been updated recently, so its details may be stale.')
  }

  if (!input.folderPath) {
    lines.push('It is still unfiled, which makes cleanup and review slower.')
  }

  if (input.duplicateCandidateIds.length > 0) {
    lines.push('A similar credential already exists, so this may be a duplicate import.')
  }

  if (lines.length === 0) {
    lines.push('This item looks structurally healthy. Copilot is only suggesting light cleanup.')
  }

  return lines.slice(0, 4)
}

export function buildCopilotModel({
  items,
  folders,
  folderPathById,
  aiSettings,
  now = new Date(),
}: {
  items: VaultItem[]
  folders: VaultFolder[]
  folderPathById: Map<string, string>
  aiSettings: VaultAiSettings | null | undefined
  now?: Date
}): VaultCopilotModel {
  const settings = normalizeAiSettings(aiSettings)
  const nowMs = now.getTime()
  const reuseCounts = computePasswordReuseCounts(items)
  const duplicateMap = buildDuplicateMap(items)
  const itemSuggestionsById = new Map<string, VaultSuggestion[]>()
  const aiInputsByItemId = new Map<string, VaultAiInputSnapshot>()

  const exposedIds: string[] = []
  const reusedIds: string[] = []
  const weakIds: string[] = []
  const staleIds: string[] = []
  const cleanupIds: string[] = []

  for (const item of items) {
    const passwordEligible = isPasswordCredential(item)
    const folderPath = item.folderId ? (folderPathById.get(item.folderId) ?? item.folder) : item.folder
    const reuseCount = passwordEligible ? (reuseCounts.get(item.passwordMasked ?? '') ?? 0) : 0
    const duplicateCandidateIds = duplicateMap.get(item.id) ?? []
    const staleCandidate = isStaleCandidate(item.updatedAt, nowMs)
    const aiInput = buildItemAiInputSnapshot(item, {
      folderPath,
      reuseCount,
      duplicateCandidateIds,
      staleCandidate,
      noteAnalysisAllowed: settings.allowSelectedNoteAnalysis,
    })
    aiInputsByItemId.set(item.id, aiInput)

    if (!settings.enabled) {
      continue
    }

    const serviceLabel = buildServiceLabel(item)
    const titleToken = normalizeTitleToken(item.title)
    const folderSuggestion = !item.folderId && serviceLabel
      ? chooseFolderSuggestion(serviceLabel, folderPathById, folders)
      : ''
    const tagSuggestion = aiInput.tags.length === 0 && aiInput.urlHosts[0]
      ? [aiInput.urlHosts[0].split('.').filter(Boolean)[0] ?? aiInput.urlHosts[0]].filter(Boolean)
      : []
    const normalizedTitle = (GENERIC_TITLE_TOKENS.has(titleToken) || titleToken === normalizeTitleToken(item.username) || aiInput.urlHosts.includes(titleToken))
      ? serviceLabel
      : ''
    const itemSuggestions: VaultSuggestion[] = []

    if (passwordEligible && item.risk === 'exposed') {
      exposedIds.push(item.id)
      itemSuggestions.push({
        id: buildSuggestionId(item.id, 'rotate_password'),
        itemId: item.id,
        kind: 'rotate_password',
        priority: 'critical',
        title: 'Rotate this exposed password',
        detail: 'Generate a fresh password and save the credential again.',
        rationale: 'This entry is already flagged as exposed.',
        target: { scope: 'item', itemId: item.id },
        action: { type: 'open_item', itemId: item.id },
      })
    } else if (passwordEligible && reuseCount > 1 && item.passwordMasked) {
      reusedIds.push(item.id)
      itemSuggestions.push({
        id: buildSuggestionId(item.id, 'review_reused_password'),
        itemId: item.id,
        kind: 'review_reused_password',
        priority: 'high',
        title: 'Replace this reused password',
        detail: `This password appears in ${reuseCount} vault entries.`,
        rationale: 'A breach in one service would affect the others.',
        target: { scope: 'item', itemId: item.id },
        action: { type: 'open_item', itemId: item.id },
      })
      itemSuggestions.push({
        id: buildSuggestionId(item.id, 'rotate_password', 'reuse'),
        itemId: item.id,
        kind: 'rotate_password',
        priority: 'high',
        title: 'Generate a unique replacement',
        detail: 'Use a strong new password here and keep it unique.',
        rationale: 'Rotation is the fastest way to break password reuse.',
        target: { scope: 'item', itemId: item.id },
        action: { type: 'open_item', itemId: item.id },
      })
    } else if (passwordEligible && item.risk === 'weak' && item.passwordMasked) {
      weakIds.push(item.id)
      itemSuggestions.push({
        id: buildSuggestionId(item.id, 'review_weak_password'),
        itemId: item.id,
        kind: 'review_weak_password',
        priority: 'high',
        title: 'Strengthen this password',
        detail: 'Armadillo currently considers this password weak.',
        rationale: 'A longer random password would reduce guessing risk.',
        target: { scope: 'item', itemId: item.id },
        action: { type: 'open_item', itemId: item.id },
      })
      itemSuggestions.push({
        id: buildSuggestionId(item.id, 'rotate_password', 'weak'),
        itemId: item.id,
        kind: 'rotate_password',
        priority: 'high',
        title: 'Generate a stronger replacement',
        detail: 'Swap in a long random password before your next save.',
        rationale: 'The current password is weaker than Armadillo recommends.',
        target: { scope: 'item', itemId: item.id },
        action: { type: 'open_item', itemId: item.id },
      })
    }

    if (staleCandidate) {
      staleIds.push(item.id)
      itemSuggestions.push({
        id: buildSuggestionId(item.id, 'review_stale_entry'),
        itemId: item.id,
        kind: 'review_stale_entry',
        priority: 'medium',
        title: 'Review this stale entry',
        detail: 'It has not been updated in roughly six months or more.',
        rationale: 'Old credentials often keep outdated usernames, URLs, or recovery details.',
        target: { scope: 'item', itemId: item.id },
        action: { type: 'open_item', itemId: item.id },
      })
    }

    if (passwordEligible && !item.passwordExpiryDate && item.passwordMasked && item.risk !== 'safe') {
      itemSuggestions.push({
        id: buildSuggestionId(item.id, 'set_expiry_date'),
        itemId: item.id,
        kind: 'set_expiry_date',
        priority: 'low',
        title: 'Add a review date',
        detail: 'Set a follow-up date so this credential is revisited soon.',
        rationale: 'A review date helps keep high-risk credentials from lingering.',
        target: { scope: 'item', itemId: item.id },
        action: { type: 'open_item', itemId: item.id },
        payload: { suggestedExpiryDate: createExpirySuggestionDate(now) },
      })
    }

    if (folderSuggestion) {
      cleanupIds.push(item.id)
      itemSuggestions.push({
        id: buildSuggestionId(item.id, 'move_to_folder'),
        itemId: item.id,
        kind: 'move_to_folder',
        priority: 'medium',
        title: `File this under ${folderSuggestion}`,
        detail: 'A service-based folder would make it easier to find later.',
        rationale: 'This entry is still unfiled.',
        target: { scope: 'item', itemId: item.id },
        action: { type: 'open_item', itemId: item.id },
        payload: { suggestedFolder: folderSuggestion },
      })
    }

    if (tagSuggestion.length > 0) {
      cleanupIds.push(item.id)
      itemSuggestions.push({
        id: buildSuggestionId(item.id, 'add_tags'),
        itemId: item.id,
        kind: 'add_tags',
        priority: 'low',
        title: `Add ${tagSuggestion.join(', ')} as a tag`,
        detail: 'A tag would make search and grouping work better.',
        rationale: 'This entry has enough URL context for a simple tag suggestion.',
        target: { scope: 'item', itemId: item.id },
        action: { type: 'open_item', itemId: item.id },
        payload: { suggestedTags: tagSuggestion },
      })
    }

    if (normalizedTitle && normalizedTitle !== item.title.trim()) {
      cleanupIds.push(item.id)
      itemSuggestions.push({
        id: buildSuggestionId(item.id, 'normalize_title'),
        itemId: item.id,
        kind: 'normalize_title',
        priority: 'medium',
        title: `Rename to ${normalizedTitle}`,
        detail: 'Use a cleaner service name so the item is easier to scan.',
        rationale: 'The current title looks generic or import-generated.',
        target: { scope: 'item', itemId: item.id },
        action: { type: 'open_item', itemId: item.id },
        payload: { suggestedTitle: normalizedTitle },
      })
    }

    if (duplicateCandidateIds.length > 0) {
      cleanupIds.push(item.id)
      itemSuggestions.push({
        id: buildSuggestionId(item.id, 'review_duplicates'),
        itemId: item.id,
        kind: 'review_duplicates',
        priority: 'medium',
        title: 'Review likely duplicate entries',
        detail: `Found ${duplicateCandidateIds.length} similar ${duplicateCandidateIds.length === 1 ? 'entry' : 'entries'}.`,
        rationale: 'Imports often create duplicate credentials with slightly different labels.',
        target: { scope: 'item', itemId: item.id },
        action: { type: 'open_item', itemId: item.id },
        payload: { relatedItemIds: duplicateCandidateIds },
      })
    }

    if (itemSuggestions.length > 0) {
      itemSuggestions.sort(compareSuggestions)
      itemSuggestionsById.set(item.id, itemSuggestions)
    }
  }

  const uniqueCleanupIds = Array.from(new Set(cleanupIds))
  const vaultSuggestions: VaultSuggestion[] = []

  if (!settings.enabled) {
    return {
      vaultSuggestions: [],
      itemSuggestionsById,
      aiInputsByItemId,
    }
  }

  if (exposedIds.length > 0) {
    vaultSuggestions.push({
      id: buildSuggestionId(null, 'review_exposed_password', exposedIds.join(',')),
      kind: 'review_exposed_password',
      priority: 'critical',
      title: `${exposedIds.length} exposed ${exposedIds.length === 1 ? 'password needs' : 'passwords need'} rotation`,
      detail: 'Start with credentials already flagged as exposed.',
      rationale: 'These are the highest-risk items in the vault.',
      target: { scope: 'items', itemIds: exposedIds },
      action: { type: 'open_smart_view', view: 'exposed' },
    })
  }

  if (reusedIds.length > 0) {
    vaultSuggestions.push({
      id: buildSuggestionId(null, 'review_reused_password', reusedIds.join(',')),
      kind: 'review_reused_password',
      priority: 'high',
      title: `${reusedIds.length} reused ${reusedIds.length === 1 ? 'password needs' : 'passwords need'} cleanup`,
      detail: 'Review entries that still share the same password.',
      rationale: 'Reused credentials multiply the impact of a single leak.',
      target: { scope: 'items', itemIds: reusedIds },
      action: { type: 'open_smart_view', view: 'reused' },
    })
  }

  if (weakIds.length > 0) {
    vaultSuggestions.push({
      id: buildSuggestionId(null, 'review_weak_password', weakIds.join(',')),
      kind: 'review_weak_password',
      priority: 'high',
      title: `${weakIds.length} weak ${weakIds.length === 1 ? 'password needs' : 'passwords need'} strengthening`,
      detail: 'Review the weakest saved credentials next.',
      rationale: 'These passwords are below Armadillo strength targets.',
      target: { scope: 'items', itemIds: weakIds },
      action: { type: 'open_smart_view', view: 'weak' },
    })
  }

  if (staleIds.length > 0) {
    vaultSuggestions.push({
      id: buildSuggestionId(null, 'review_stale_entry', staleIds.join(',')),
      kind: 'review_stale_entry',
      priority: 'medium',
      title: `${staleIds.length} ${staleIds.length === 1 ? 'entry looks' : 'entries look'} stale`,
      detail: 'Review older credentials that have not been updated in a while.',
      rationale: 'Stale entries often keep outdated recovery details or URLs.',
      target: { scope: 'items', itemIds: staleIds },
      action: { type: 'open_smart_view', view: 'stale' },
    })
  }

  if (uniqueCleanupIds.length > 0) {
    const unfiledCleanupIds = uniqueCleanupIds.filter((itemId) => {
      const input = aiInputsByItemId.get(itemId)
      return input && !input.folderPath
    })
    vaultSuggestions.push({
      id: buildSuggestionId(null, 'move_to_folder', uniqueCleanupIds.join(',')),
      kind: 'move_to_folder',
      priority: 'low',
      title: `${uniqueCleanupIds.length} ${uniqueCleanupIds.length === 1 ? 'entry could use' : 'entries could use'} cleanup`,
      detail: unfiledCleanupIds.length > 0
        ? `${unfiledCleanupIds.length} ${unfiledCleanupIds.length === 1 ? 'item is' : 'items are'} still unfiled.`
        : 'Several entries have title, tag, or duplicate cleanup suggestions.',
      rationale: 'Small cleanup work improves search, filing, and review speed.',
      target: { scope: 'items', itemIds: uniqueCleanupIds },
      action: unfiledCleanupIds.length > 0
        ? { type: 'open_smart_view', view: 'unfiled' }
        : { type: 'open_item', itemId: uniqueCleanupIds[0]! },
    })
  }

  vaultSuggestions.sort(compareSuggestions)

  return {
    vaultSuggestions,
    itemSuggestionsById,
    aiInputsByItemId,
  }
}

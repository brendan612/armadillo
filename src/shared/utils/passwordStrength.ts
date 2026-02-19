import { zxcvbn, zxcvbnOptions } from '@zxcvbn-ts/core'
import {
  adjacencyGraphs as commonAdjacencyGraphs,
  dictionary as commonDictionary,
} from '@zxcvbn-ts/language-common'
import {
  dictionary,
  translations,
} from '@zxcvbn-ts/language-en'
import type { RiskState, VaultItem } from '../../types/vault'

export type PasswordStrengthScore = 0 | 1 | 2 | 3 | 4
export type PasswordStrengthLevel = 'very-weak' | 'weak' | 'fair' | 'good' | 'strong'

export type PasswordAnalysis = {
  score: PasswordStrengthScore
  label: string
  level: PasswordStrengthLevel
  entropyBits: number
  feedback: string[]
  matchKinds: string[]
  crackTimeDisplay: string
}

export type PasswordStrengthContext = {
  title?: string
  username?: string
  urls?: string[]
  tags?: string[]
}

const WEAK_SCORE_THRESHOLD: PasswordStrengthScore = 2
const LOG2_10 = Math.log2(10)
const MAX_CACHE_SIZE = 800

const scoreToLabel: Record<PasswordStrengthScore, { label: string; level: PasswordStrengthLevel }> = {
  0: { label: 'Very weak', level: 'very-weak' },
  1: { label: 'Weak', level: 'weak' },
  2: { label: 'Fair', level: 'fair' },
  3: { label: 'Good', level: 'good' },
  4: { label: 'Strong', level: 'strong' },
}

let initialized = false
const analysisCache = new Map<string, PasswordAnalysis>()

function ensureInitialized() {
  if (initialized) return

  zxcvbnOptions.setOptions({
    dictionary: {
      ...commonDictionary,
      ...dictionary,
    },
    graphs: {
      ...commonAdjacencyGraphs,
    },
    translations: {
      ...translations,
    },
  })

  initialized = true
}

function normalizeToken(token: string) {
  return token.trim().toLowerCase()
}

function splitAlphaNumericTokens(value: string) {
  return value
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2)
}

function buildContextTokens(context: PasswordStrengthContext = {}) {
  const raw = new Set<string>()

  const include = (value: string) => {
    const normalized = normalizeToken(value)
    if (normalized.length >= 2) {
      raw.add(normalized)
    }
    for (const piece of splitAlphaNumericTokens(value)) {
      raw.add(piece)
    }
  }

  if (context.title) include(context.title)
  if (context.username) include(context.username)
  for (const tag of context.tags ?? []) {
    if (tag) include(tag)
  }

  for (const rawUrl of context.urls ?? []) {
    const value = rawUrl.trim()
    if (!value) continue
    include(value)

    try {
      const url = new URL(value.includes('://') ? value : `https://${value}`)
      const host = url.hostname.toLowerCase().trim()
      if (host) {
        raw.add(host)
        for (const hostPart of host.split('.')) {
          if (hostPart.length >= 2) {
            raw.add(hostPart)
          }
        }
      }
    } catch {
      // Ignore malformed URLs; raw token splitting already handled above.
    }
  }

  return Array.from(raw).sort((a, b) => a.localeCompare(b))
}

function normalizeFeedback(warning: string, suggestions: string[]) {
  const all = [warning, ...suggestions]
    .map((entry) => entry.trim())
    .filter(Boolean)

  return Array.from(new Set(all)).slice(0, 6)
}

export function estimateEntropyBitsFromAnalysis(guessesLog10: number) {
  if (!Number.isFinite(guessesLog10) || guessesLog10 <= 0) return 0
  return Number((guessesLog10 * LOG2_10).toFixed(1))
}

function clampScore(score: number): PasswordStrengthScore {
  if (score <= 0) return 0
  if (score >= 4) return 4
  if (score <= 1) return 1
  if (score <= 2) return 2
  return 3
}

export function analyzePassword(password: string, context: PasswordStrengthContext = {}): PasswordAnalysis {
  ensureInitialized()

  const pwd = password ?? ''
  const userInputs = buildContextTokens(context)
  const cacheKey = `${pwd}\u001f${userInputs.join('\u001e')}`
  const cached = analysisCache.get(cacheKey)
  if (cached) {
    return cached
  }

  const result = zxcvbn(pwd, userInputs)
  const score = clampScore(result.score)
  const mapped = scoreToLabel[score]
  const analysis: PasswordAnalysis = {
    score,
    label: mapped.label,
    level: mapped.level,
    entropyBits: estimateEntropyBitsFromAnalysis(result.guessesLog10),
    feedback: normalizeFeedback(result.feedback.warning || '', result.feedback.suggestions || []),
    matchKinds: Array.from(new Set((result.sequence ?? []).map((sequence) => sequence.pattern))).sort((a, b) => a.localeCompare(b)),
    crackTimeDisplay: result.crackTimesDisplay?.offlineSlowHashing1e4PerSecond || 'unknown',
  }

  analysisCache.set(cacheKey, analysis)
  if (analysisCache.size > MAX_CACHE_SIZE) {
    const firstKey = analysisCache.keys().next().value
    if (firstKey) analysisCache.delete(firstKey)
  }

  return analysis
}

export function mapAnalysisToRisk(analysis: PasswordAnalysis, isReused: boolean): RiskState {
  if (isReused) return 'reused'
  return analysis.score <= WEAK_SCORE_THRESHOLD ? 'weak' : 'safe'
}

export function buildPasswordStrengthContextFromItem(item: Pick<VaultItem, 'title' | 'username' | 'urls' | 'tags'>): PasswordStrengthContext {
  return {
    title: item.title,
    username: item.username,
    urls: item.urls,
    tags: item.tags,
  }
}

export function computePasswordReuseCounts(items: VaultItem[]) {
  const counts = new Map<string, number>()
  for (const item of items) {
    const pwd = item.passwordMasked || ''
    if (!pwd) continue
    counts.set(pwd, (counts.get(pwd) ?? 0) + 1)
  }
  return counts
}

export function recomputeItemRisks(items: VaultItem[]) {
  const reuseCounts = computePasswordReuseCounts(items)
  let changed = false
  const nextItems = items.map((item) => {
    if (item.risk === 'exposed' || item.risk === 'stale') {
      return item
    }
    const analysis = analyzePassword(item.passwordMasked ?? '', buildPasswordStrengthContextFromItem(item))
    const nextRisk = mapAnalysisToRisk(analysis, (reuseCounts.get(item.passwordMasked || '') ?? 0) > 1)
    if (nextRisk !== item.risk) {
      changed = true
      return { ...item, risk: nextRisk }
    }
    return item
  })

  return { nextItems, changed }
}

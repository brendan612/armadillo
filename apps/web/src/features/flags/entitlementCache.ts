import type { CapabilityKey, DevFlagOverride, PlanTier, RolloutFlagMap } from '../../types/entitlements'
import { isCapabilityKey, normalizeTier } from './registry'

export const ENTITLEMENT_CACHE_TOKEN_KEY = 'armadillo.entitlement.cache.token'
export const ENTITLEMENT_CACHE_LAST_REFRESH_KEY = 'armadillo.entitlement.cache.last_refresh_at'
export const ENTITLEMENT_MANUAL_TOKEN_KEY = 'armadillo.entitlement.manual.token'
export const DEV_FLAG_OVERRIDE_KEY = 'armadillo.flags.dev_override'
export const ENTITLEMENT_STALE_WINDOW_DAYS = 30
export const ENTITLEMENT_STALE_WINDOW_MS = ENTITLEMENT_STALE_WINDOW_DAYS * 24 * 60 * 60 * 1000

type StoredDevOverride = {
  tier?: PlanTier
  capabilities?: CapabilityKey[]
  flags?: RolloutFlagMap
}

function readString(key: string): string | null {
  try {
    const value = localStorage.getItem(key)
    if (!value) return null
    const trimmed = value.trim()
    return trimmed ? trimmed : null
  } catch {
    return null
  }
}

function writeString(key: string, value: string | null) {
  try {
    if (!value) {
      localStorage.removeItem(key)
      return
    }
    localStorage.setItem(key, value)
  } catch {
    // Non-blocking persistence.
  }
}

function normalizeIso(value: string | null) {
  if (!value) return null
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return null
  return new Date(parsed).toISOString()
}

function normalizeCapabilityList(input: unknown) {
  if (!Array.isArray(input)) return []
  const deduped = new Set<CapabilityKey>()
  for (const value of input) {
    if (!isCapabilityKey(value)) continue
    deduped.add(value)
  }
  return Array.from(deduped)
}

function normalizeFlags(input: unknown): RolloutFlagMap {
  const flags: RolloutFlagMap = {}
  if (!input || typeof input !== 'object') return flags
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!key || typeof value !== 'boolean') continue
    flags[key] = value
  }
  return flags
}

function normalizeDevOverride(input: unknown): DevFlagOverride | null {
  if (!input || typeof input !== 'object') return null
  const row = input as Record<string, unknown>
  const tier = row.tier === undefined ? undefined : normalizeTier(row.tier)
  const capabilities = normalizeCapabilityList(row.capabilities)
  const flags = normalizeFlags(row.flags)
  const normalized: StoredDevOverride = {
    ...(tier ? { tier } : {}),
    ...(capabilities.length > 0 ? { capabilities } : {}),
    ...(Object.keys(flags).length > 0 ? { flags } : {}),
  }
  if (!normalized.tier && !normalized.capabilities && !normalized.flags) {
    return null
  }
  return normalized
}

export function getCachedEntitlementToken() {
  return readString(ENTITLEMENT_CACHE_TOKEN_KEY)
}

export function setCachedEntitlementToken(token: string | null) {
  writeString(ENTITLEMENT_CACHE_TOKEN_KEY, token)
}

export function getManualEntitlementToken() {
  return readString(ENTITLEMENT_MANUAL_TOKEN_KEY)
}

export function setManualEntitlementToken(token: string | null) {
  writeString(ENTITLEMENT_MANUAL_TOKEN_KEY, token)
}

export function getEntitlementLastRefreshAt() {
  return normalizeIso(readString(ENTITLEMENT_CACHE_LAST_REFRESH_KEY))
}

export function setEntitlementLastRefreshAt(iso: string | null) {
  writeString(ENTITLEMENT_CACHE_LAST_REFRESH_KEY, normalizeIso(iso))
}

export function getEntitlementStaleAt(lastRefreshAt: string | null) {
  if (!lastRefreshAt) return null
  const parsed = Date.parse(lastRefreshAt)
  if (!Number.isFinite(parsed)) return null
  return new Date(parsed + ENTITLEMENT_STALE_WINDOW_MS).toISOString()
}

export function isEntitlementStale(lastRefreshAt: string | null, nowMs = Date.now()) {
  if (!lastRefreshAt) return true
  const parsed = Date.parse(lastRefreshAt)
  if (!Number.isFinite(parsed)) return true
  return nowMs > parsed + ENTITLEMENT_STALE_WINDOW_MS
}

export function getDevFlagOverride() {
  if (!import.meta.env.DEV) return null
  const raw = readString(DEV_FLAG_OVERRIDE_KEY)
  if (!raw) return null
  try {
    return normalizeDevOverride(JSON.parse(raw))
  } catch {
    return null
  }
}

export function setDevFlagOverride(override: DevFlagOverride | null) {
  if (!import.meta.env.DEV) return
  if (!override) {
    writeString(DEV_FLAG_OVERRIDE_KEY, null)
    return
  }
  const normalized = normalizeDevOverride(override)
  if (!normalized) {
    writeString(DEV_FLAG_OVERRIDE_KEY, null)
    return
  }
  writeString(DEV_FLAG_OVERRIDE_KEY, JSON.stringify(normalized))
}

export function clearDevFlagOverride() {
  if (!import.meta.env.DEV) return
  writeString(DEV_FLAG_OVERRIDE_KEY, null)
}

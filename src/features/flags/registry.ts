import type { CapabilityKey, PlanTier, RolloutFlagMap } from '../../types/entitlements'

export const ALL_CAPABILITIES: CapabilityKey[] = [
  'cloud.sync',
  'cloud.cloud_only',
  'vault.storage',
  'vault.storage.blobs',
  'enterprise.self_hosted',
  'enterprise.org_admin',
]

export const PLAN_CAPABILITIES: Record<PlanTier, CapabilityKey[]> = {
  free: [],
  premium: ['cloud.sync', 'cloud.cloud_only', 'vault.storage', 'vault.storage.blobs'],
  enterprise: ['cloud.sync', 'cloud.cloud_only', 'vault.storage', 'vault.storage.blobs', 'enterprise.self_hosted', 'enterprise.org_admin'],
}

export const DEFAULT_ROLLOUT_FLAGS: RolloutFlagMap = {
  'billing.plans_section': true,
  'billing.manual_token_entry': true,
  'experiments.enterprise_team_ui': false,
  'experiments.storage_tab': true,
}

export const CAPABILITY_MIN_TIER: Record<CapabilityKey, PlanTier> = {
  'cloud.sync': 'premium',
  'cloud.cloud_only': 'premium',
  'vault.storage': 'premium',
  'vault.storage.blobs': 'premium',
  'enterprise.self_hosted': 'enterprise',
  'enterprise.org_admin': 'enterprise',
}

export function normalizeTier(input: unknown): PlanTier {
  if (input === 'premium' || input === 'enterprise') return input
  return 'free'
}

export function isCapabilityKey(input: unknown): input is CapabilityKey {
  return typeof input === 'string' && ALL_CAPABILITIES.includes(input as CapabilityKey)
}

export function getCapabilitiesForTier(tier: PlanTier): CapabilityKey[] {
  return [...PLAN_CAPABILITIES[tier]]
}

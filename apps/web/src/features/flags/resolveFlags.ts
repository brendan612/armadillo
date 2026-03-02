import type { CapabilityKey, DevFlagOverride, EntitlementState, PlanTier, RolloutFlagMap } from '../../types/entitlements'
import { CAPABILITY_MIN_TIER, DEFAULT_ROLLOUT_FLAGS, ALL_CAPABILITIES, getCapabilitiesForTier, isCapabilityKey, normalizeTier } from './registry'

type ResolveFlagsInput = {
  entitlement: EntitlementState
  devOverride?: DevFlagOverride | null
  allowDevOverride?: boolean
}

export type ResolvedFlags = {
  source: EntitlementState['source']
  effectiveTier: PlanTier
  effectiveCapabilities: CapabilityKey[]
  effectiveFlags: RolloutFlagMap
  lockReasons: Record<CapabilityKey, string>
}

function normalizeOverride(override: DevFlagOverride | null | undefined): DevFlagOverride | null {
  if (!override || typeof override !== 'object') return null
  const tier = override.tier ? normalizeTier(override.tier) : undefined
  const capabilities = Array.isArray(override.capabilities)
    ? Array.from(new Set(override.capabilities.filter(isCapabilityKey)))
    : undefined

  const flags: RolloutFlagMap = {}
  if (override.flags && typeof override.flags === 'object') {
    for (const [key, value] of Object.entries(override.flags)) {
      if (!key || typeof value !== 'boolean') continue
      flags[key] = value
    }
  }

  return {
    ...(tier ? { tier } : {}),
    ...(capabilities ? { capabilities } : {}),
    ...(Object.keys(flags).length > 0 ? { flags } : {}),
  }
}

function getRequiredTierCopy(tier: PlanTier) {
  return tier === 'enterprise' ? 'Requires Enterprise plan' : 'Requires Premium plan'
}

export function resolveFlags(input: ResolveFlagsInput): ResolvedFlags {
  const normalizedOverride = input.allowDevOverride ? normalizeOverride(input.devOverride) : null
  const entitlementUsable = input.entitlement.status === 'verified'

  const baseTier = entitlementUsable ? input.entitlement.tier : 'free'
  const tier = normalizedOverride?.tier ?? baseTier

  const capabilities = new Set<CapabilityKey>([
    ...getCapabilitiesForTier(tier),
    ...(entitlementUsable ? input.entitlement.capabilities : []),
    ...(normalizedOverride?.capabilities ?? []),
  ])

  const flags: RolloutFlagMap = {
    ...DEFAULT_ROLLOUT_FLAGS,
    ...(entitlementUsable ? input.entitlement.flags : {}),
    ...(normalizedOverride?.flags ?? {}),
  }

  const lockReasons = {} as Record<CapabilityKey, string>
  for (const capability of ALL_CAPABILITIES) {
    if (capabilities.has(capability)) continue
    lockReasons[capability] = getRequiredTierCopy(CAPABILITY_MIN_TIER[capability])
  }

  return {
    source: normalizedOverride ? 'dev_override' : input.entitlement.source,
    effectiveTier: tier,
    effectiveCapabilities: Array.from(capabilities),
    effectiveFlags: flags,
    lockReasons,
  }
}

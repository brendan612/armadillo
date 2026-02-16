export type PlanTier = 'free' | 'premium' | 'enterprise'

export type CapabilityKey =
  | 'cloud.sync'
  | 'cloud.cloud_only'
  | 'enterprise.self_hosted'
  | 'enterprise.org_admin'

export type RolloutFlagKey = string
export type RolloutFlagMap = Record<RolloutFlagKey, boolean>

export type EntitlementClaims = {
  iss: string
  sub: string
  aud: string | string[]
  iat: number
  nbf?: number
  exp: number
  tier: PlanTier
  capabilities?: CapabilityKey[]
  flags?: RolloutFlagMap
}

export type EntitlementSource = 'free' | 'manual' | 'cache' | 'remote' | 'dev_override'
export type EntitlementStatus = 'free' | 'verified' | 'stale' | 'invalid' | 'expired'

export type EntitlementState = {
  source: EntitlementSource
  status: EntitlementStatus
  tier: PlanTier
  capabilities: CapabilityKey[]
  flags: RolloutFlagMap
  expiresAt: string | null
  lastRefreshAt: string | null
  staleAt: string | null
  reason: string
  issuer?: string
  subject?: string
  kid?: string
}

export type DevFlagOverride = {
  tier?: PlanTier
  capabilities?: CapabilityKey[]
  flags?: RolloutFlagMap
}

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuthActions, useAuthToken } from '@convex-dev/auth/react'
import {
  Activity,
  Database,
  Globe,
  Layers3,
  Lock,
  LogOut,
  Mail,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Sparkles,
  Users,
  Zap,
} from 'lucide-react'
import {
  createAdminClient,
  type AdminAuditEvent,
  type AdminMeResponse,
  type AdminOrg,
  type AdminOrgMember,
  type BillingMode,
  type CustomerSearchResult,
  type EntitlementOverrideRow,
  type OperatorOverview,
  type PlanTier,
  type Role,
  type SubscriptionResponse,
  type SubscriptionScopeType,
  type SubscriptionStatus,
  type SyncProvider,
  type SystemStatus,
  type VaultSummary,
  type OrgUsageSummary,
} from '@armadillo/shared-admin-client'
import { Badge } from './components/ui/badge'
import { Button } from './components/ui/button'
import { Input } from './components/ui/input'
import { Textarea } from './components/ui/textarea'
import { cn } from './lib/utils'

type Section = 'overview' | 'customers' | 'subscriptions' | 'vaults' | 'system'
type StatusTone = 'neutral' | 'success' | 'error'

const DEFAULT_AUDIT_LIMIT = 30
const DEFAULT_OVERRIDE_LIMIT = 50
const CAPABILITY_OPTIONS = [
  { value: 'cloud.sync', label: 'Cloud Sync' },
  { value: 'cloud.cloud_only', label: 'Cloud-Only Mode' },
  { value: 'vault.storage', label: 'Storage Tab' },
  { value: 'vault.storage.blobs', label: 'Blob Attachments' },
  { value: 'security.breach_scan', label: 'Breach Scan' },
  { value: 'enterprise.self_hosted', label: 'Self-Hosted Sync' },
  { value: 'enterprise.org_admin', label: 'Org Admin' },
] as const

function normalizeBaseUrl(url: string) {
  return url.replace(/\/$/, '')
}

function resolveConvexHttpBaseUrl() {
  const siteUrl = (import.meta.env.VITE_CONVEX_SITE_URL || '').trim()
  if (siteUrl) return normalizeBaseUrl(siteUrl)
  const deploymentUrl = (import.meta.env.VITE_CONVEX_URL || '').trim()
  if (deploymentUrl) return normalizeBaseUrl(deploymentUrl.replace('.convex.cloud', '.convex.site'))
  const explicitHttpUrl = (import.meta.env.VITE_CONVEX_HTTP_URL || '').trim()
  if (explicitHttpUrl) return normalizeBaseUrl(explicitHttpUrl)
  return ''
}

function resolveProvider() {
  return ((import.meta.env.VITE_SYNC_PROVIDER || 'convex').toLowerCase() === 'self_hosted'
    ? 'self_hosted'
    : 'convex') as SyncProvider
}

function formatBytes(value: number | null | undefined) {
  const bytes = typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return value
  return new Date(parsed).toLocaleString()
}

function normalizeRoleSummary(roles: Role[] | undefined) {
  if (!roles || roles.length === 0) return '—'
  return roles.join(', ')
}

function defaultCapabilitiesForTier(tier: PlanTier) {
  if (tier === 'enterprise') {
    return CAPABILITY_OPTIONS.map((option) => option.value)
  }
  if (tier === 'premium') {
    return CAPABILITY_OPTIONS
      .filter((option) => !option.value.startsWith('enterprise.'))
      .map((option) => option.value)
  }
  return [] as string[]
}

// ─── Shared UI primitives ───────────────────────────────────────────────────

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="grid gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">{label}</span>
      {children}
      {hint && <span className="text-xs text-[var(--ink-muted)] leading-relaxed">{hint}</span>}
    </label>
  )
}

function StatusBanner({ tone, message }: { tone: StatusTone; message: string }) {
  if (!message) return null
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-[var(--radius-md)] border px-4 py-3 text-sm',
        tone === 'error' && 'border-[color:color-mix(in_srgb,var(--exposed)_30%,transparent)] bg-[var(--exposed-soft)] text-[#ffd7d1]',
        tone === 'success' && 'border-[color:color-mix(in_srgb,var(--safe)_28%,transparent)] bg-[var(--safe-soft)] text-[var(--ink)]',
        tone === 'neutral' && 'border-[var(--line-medium)] bg-[var(--surface)] text-[var(--ink-secondary)]',
      )}
    >
      <div className={cn(
        'h-1.5 w-1.5 shrink-0 rounded-full',
        tone === 'error' && 'bg-[var(--exposed)]',
        tone === 'success' && 'bg-[var(--safe)]',
        tone === 'neutral' && 'bg-[var(--ink-muted)]',
      )} />
      {message}
    </div>
  )
}

function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn(
      'rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)]',
      className,
    )}>
      {children}
    </div>
  )
}

function PanelHeader({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[var(--line)] px-6 py-5">
      <div className="grid gap-0.5">
        <h2 className="text-sm font-semibold text-[var(--ink)]">{title}</h2>
        {description && <p className="text-xs text-[var(--ink-muted)]">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

function StatCard({ label, value, sub, accent }: { label: string; value: React.ReactNode; sub?: string; accent?: boolean }) {
  return (
    <div className={cn(
      'rounded-[var(--radius-md)] border p-4',
      accent
        ? 'border-[color:color-mix(in_srgb,var(--accent)_20%,transparent)] bg-[var(--accent-soft)]'
        : 'border-[var(--line)] bg-[var(--bg-3)]',
    )}>
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">{label}</div>
      <div className={cn('mt-2 text-2xl font-semibold tabular-nums', accent ? 'text-[var(--accent)]' : 'text-[var(--ink)]')}>{value}</div>
      {sub && <div className="mt-1 text-xs text-[var(--ink-muted)]">{sub}</div>}
    </div>
  )
}

function HealthDot({ ok }: { ok: boolean | undefined }) {
  return (
    <span className={cn(
      'inline-block h-1.5 w-1.5 rounded-full',
      ok === true ? 'bg-[var(--safe)] status-dot-live' : ok === false ? 'bg-[var(--exposed)]' : 'bg-[var(--ink-muted)]',
    )} />
  )
}

function SectionRow({ label, value, mono }: { label: React.ReactNode; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--line)] px-6 py-3.5 last:border-0">
      <span className="text-xs text-[var(--ink-muted)]">{label}</span>
      <span className={cn('text-sm text-[var(--ink)]', mono && 'font-mono text-xs')}>{value}</span>
    </div>
  )
}

function ControlSelect({ value, onChange, children, className }: {
  value: string
  onChange: (v: string) => void
  children: React.ReactNode
  className?: string
}) {
  return (
    <select
      className={cn(
        'h-9 rounded-[var(--radius-md)] border border-[var(--line-medium)] bg-[var(--bg-3)] px-3 text-sm text-[var(--ink)] transition-colors',
        'focus:border-[color:color-mix(in_srgb,var(--accent)_50%,transparent)] focus:outline-none',
        className,
      )}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {children}
    </select>
  )
}

// ─── App ───────────────────────────────────────────────────────────────────

export default function App() {
  const provider = resolveProvider()
  const convexAuthToken = useAuthToken()
  const { signIn, signOut } = useAuthActions()

  const [section, setSection] = useState<Section>('overview')
  const [selfHostedTokenInput, setSelfHostedTokenInput] = useState((import.meta.env.VITE_SYNC_AUTH_TOKEN || '').trim())
  const [selfHostedToken, setSelfHostedToken] = useState((import.meta.env.VITE_SYNC_AUTH_TOKEN || '').trim())
  const [statusMessage, setStatusMessage] = useState('')
  const [statusTone, setStatusTone] = useState<StatusTone>('neutral')
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const [adminMe, setAdminMe] = useState<AdminMeResponse | null>(null)
  const [overview, setOverview] = useState<OperatorOverview | null>(null)
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null)
  const [orgs, setOrgs] = useState<AdminOrg[]>([])
  const [searchResults, setSearchResults] = useState<CustomerSearchResult[]>([])
  const [selectedOrgId, setSelectedOrgId] = useState('')
  const [selectedOrg, setSelectedOrg] = useState<AdminOrg | null>(null)
  const [members, setMembers] = useState<AdminOrgMember[]>([])
  const [usage, setUsage] = useState<OrgUsageSummary | null>(null)
  const [vaults, setVaults] = useState<VaultSummary[]>([])
  const [auditEvents, setAuditEvents] = useState<AdminAuditEvent[]>([])
  const [subscription, setSubscription] = useState<SubscriptionResponse | null>(null)
  const [overrides, setOverrides] = useState<EntitlementOverrideRow[]>([])

  const [scopeType, setScopeType] = useState<SubscriptionScopeType>('org')
  const [scopeId, setScopeId] = useState('')
  const [planTier, setPlanTier] = useState<PlanTier>('free')
  const [subscriptionStatus, setSubscriptionStatus] = useState<SubscriptionStatus>('active')
  const [billingMode, setBillingMode] = useState<BillingMode>('manual')
  const [seatLimit, setSeatLimit] = useState('')
  const [storageLimitBytes, setStorageLimitBytes] = useState('')
  const [renewalAt, setRenewalAt] = useState('')
  const [endAt, setEndAt] = useState('')
  const [subscriptionNote, setSubscriptionNote] = useState('')

  const [overrideEmail, setOverrideEmail] = useState('')
  const [overrideTier, setOverrideTier] = useState<PlanTier>('premium')
  const [overrideCapabilities, setOverrideCapabilities] = useState<string[]>(defaultCapabilitiesForTier('premium'))
  const [overrideNote, setOverrideNote] = useState('')

  const activeToken = provider === 'convex' ? (convexAuthToken || '') : selfHostedToken
  const baseUrl = provider === 'convex'
    ? resolveConvexHttpBaseUrl()
    : normalizeBaseUrl(import.meta.env.VITE_SYNC_BASE_URL || '')

  const client = useMemo(() => createAdminClient({
    provider,
    baseUrl,
    getAuthToken: () => activeToken || null,
    getOrgId: () => selectedOrgId || null,
  }), [provider, baseUrl, activeToken, selectedOrgId])

  const canAttemptLoad = Boolean(baseUrl && activeToken)
  const superAdmin = Boolean(adminMe?.permissions.superAdmin)
  const noOperatorAccess = Boolean(adminMe && !adminMe.permissions.superAdmin)
  const customerRows: CustomerSearchResult[] = searchResults.length > 0
    ? searchResults
    : orgs.map((org) => ({
      orgId: org.id,
      orgName: org.name,
      memberCount: org.memberCount ?? 0,
      matchedMembers: [],
      subscriptionTier: null,
      lastActivityAt: null,
    }))

  const setFeedback = useCallback((message: string, tone: StatusTone) => {
    setStatusMessage(message)
    setStatusTone(tone)
  }, [])

  const loadSelectedCustomer = useCallback(async (orgId: string) => {
    if (!orgId) return
    const [memberResponse, usageResponse, vaultResponse, auditResponse, subscriptionResponse] = await Promise.all([
      client.listMembers(orgId),
      client.getOrgUsage(orgId),
      client.listVaults(orgId),
      client.listAudit(orgId, { limit: DEFAULT_AUDIT_LIMIT }),
      client.getSubscription('org', orgId),
    ])
    setMembers(memberResponse.members)
    setUsage(usageResponse)
    setVaults(vaultResponse.vaults)
    setAuditEvents(auditResponse.events)
    setSubscription(subscriptionResponse)
    setPlanTier(subscriptionResponse.subscription?.tier || subscriptionResponse.effective.tier)
    setSubscriptionStatus(subscriptionResponse.subscription?.status || 'active')
    setBillingMode(subscriptionResponse.subscription?.billingMode || 'manual')
    setSeatLimit(subscriptionResponse.subscription?.seatLimit != null ? String(subscriptionResponse.subscription.seatLimit) : '')
    setStorageLimitBytes(
      subscriptionResponse.subscription?.storageLimitBytes != null ? String(subscriptionResponse.subscription.storageLimitBytes) : '',
    )
    setRenewalAt(subscriptionResponse.subscription?.renewalAt || '')
    setEndAt(subscriptionResponse.subscription?.endAt || '')
    setSubscriptionNote(subscriptionResponse.subscription?.note || '')
    if (scopeType === 'org') {
      setScopeId(orgId)
    }
  }, [client, scopeType])

  const loadOverrides = useCallback(async () => {
    const response = await client.listOverrides({ limit: DEFAULT_OVERRIDE_LIMIT })
    setOverrides(response.overrides)
  }, [client])

  const refreshAll = useCallback(async () => {
    if (!canAttemptLoad) {
      setAdminMe(null)
      setOverview(null)
      setSystemStatus(null)
      setOrgs([])
      setSearchResults([])
      setSelectedOrgId('')
      setSelectedOrg(null)
      setMembers([])
      setUsage(null)
      setVaults([])
      setAuditEvents([])
      setSubscription(null)
      setOverrides([])
      return
    }

    setLoading(true)
    setFeedback('', 'neutral')
    try {
      const me = await client.getMe()
      setAdminMe(me)
      if (!me.permissions.allowed) {
        setOverview(null)
        setSystemStatus(null)
        setOrgs([])
        setSearchResults([])
        return
      }
      if (!me.permissions.superAdmin) {
        return
      }

      const [orgResponse, overviewResponse, systemResponse, overrideResponse] = await Promise.all([
        client.listOrgs(),
        client.getOverview(),
        client.getSystemStatus(),
        client.listOverrides({ limit: DEFAULT_OVERRIDE_LIMIT }),
      ])

      setOrgs(orgResponse.orgs)
      setOverview(overviewResponse)
      setSystemStatus(systemResponse)
      setOverrides(overrideResponse.overrides)

      const nextOrgId = selectedOrgId && orgResponse.orgs.some((org) => org.id === selectedOrgId)
        ? selectedOrgId
        : orgResponse.orgs[0]?.id || me.identity?.orgId || ''

      setSelectedOrgId(nextOrgId)
      setSelectedOrg(orgResponse.orgs.find((org) => org.id === nextOrgId) || null)

      if (nextOrgId) {
        await loadSelectedCustomer(nextOrgId)
      }
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Failed to load operator console', 'error')
    } finally {
      setLoading(false)
    }
  }, [canAttemptLoad, client, loadSelectedCustomer, selectedOrgId, setFeedback])

  useEffect(() => { void refreshAll() }, [refreshAll])

  useEffect(() => {
    if (!superAdmin || !selectedOrgId) return
    setSelectedOrg(orgs.find((org) => org.id === selectedOrgId) || null)
  }, [orgs, selectedOrgId, superAdmin])

  useEffect(() => {
    if (!superAdmin || !selectedOrgId) return
    void loadSelectedCustomer(selectedOrgId).catch((error) => {
      setFeedback(error instanceof Error ? error.message : 'Failed to load customer context', 'error')
    })
  }, [superAdmin, selectedOrgId, loadSelectedCustomer, setFeedback])

  useEffect(() => {
    if (scopeType === 'org' && selectedOrgId) {
      setScopeId(selectedOrgId)
    }
  }, [scopeType, selectedOrgId])

  useEffect(() => {
    setOverrideCapabilities(defaultCapabilitiesForTier(overrideTier))
  }, [overrideTier])

  function toggleOverrideCapability(capability: string) {
    setOverrideCapabilities((current) => (
      current.includes(capability)
        ? current.filter((value) => value !== capability)
        : [...current, capability]
    ))
  }

  async function handleGoogleSignIn() {
    setFeedback('', 'neutral')
    try {
      await signIn('google', { redirectTo: window.location.origin })
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Google sign-in failed', 'error')
    }
  }

  async function handleGoogleSignOut() {
    setFeedback('', 'neutral')
    try {
      await signOut()
      setAdminMe(null)
      setOverview(null)
      setSystemStatus(null)
      setOrgs([])
      setSearchResults([])
      setSelectedOrgId('')
      setSelectedOrg(null)
      setMembers([])
      setUsage(null)
      setVaults([])
      setAuditEvents([])
      setSubscription(null)
      setOverrides([])
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Sign out failed', 'error')
    }
  }

  async function handleSearchCustomers() {
    if (!searchQuery.trim()) {
      setSearchResults([])
      return
    }
    setLoading(true)
    setFeedback('', 'neutral')
    try {
      const response = await client.searchCustomers(searchQuery.trim())
      setSearchResults(response.results)
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Customer search failed', 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleSelectOrg(orgId: string) {
    setSelectedOrgId(orgId)
    setSection('customers')
    setLoading(true)
    setFeedback('', 'neutral')
    try {
      await loadSelectedCustomer(orgId)
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Failed to load customer context', 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleDeleteVault(vaultId: string) {
    if (!selectedOrgId) return
    if (!window.confirm(`Delete org-scoped vault ${vaultId}?`)) return
    setLoading(true)
    setFeedback('', 'neutral')
    try {
      await client.deleteVault(selectedOrgId, vaultId)
      await loadSelectedCustomer(selectedOrgId)
      setFeedback(`Deleted ${vaultId}`, 'success')
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Failed to delete vault', 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleSaveSubscription() {
    if (!scopeId.trim()) return
    setLoading(true)
    setFeedback('', 'neutral')
    try {
      const response = await client.upsertSubscription({
        scopeType,
        scopeId: scopeId.trim(),
        tier: planTier,
        status: subscriptionStatus,
        billingMode,
        seatLimit: seatLimit.trim() ? Number(seatLimit) : null,
        storageLimitBytes: storageLimitBytes.trim() ? Number(storageLimitBytes) : null,
        renewalAt: renewalAt.trim() || null,
        endAt: endAt.trim() || null,
        note: subscriptionNote.trim(),
      })
      if (scopeType === 'org' && scopeId.trim() === selectedOrgId) {
        setSubscription(response)
        await loadSelectedCustomer(selectedOrgId)
      } else {
        setSubscription(response)
      }
      setFeedback('Subscription saved', 'success')
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Failed to save subscription', 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleLoadSubscriptionTarget() {
    if (!scopeId.trim()) return
    setLoading(true)
    setFeedback('', 'neutral')
    try {
      const response = await client.getSubscription(scopeType, scopeId.trim())
      setSubscription(response)
      setPlanTier(response.subscription?.tier || response.effective.tier)
      setSubscriptionStatus(response.subscription?.status || 'active')
      setBillingMode(response.subscription?.billingMode || 'manual')
      setSeatLimit(response.subscription?.seatLimit != null ? String(response.subscription.seatLimit) : '')
      setStorageLimitBytes(response.subscription?.storageLimitBytes != null ? String(response.subscription.storageLimitBytes) : '')
      setRenewalAt(response.subscription?.renewalAt || '')
      setEndAt(response.subscription?.endAt || '')
      setSubscriptionNote(response.subscription?.note || '')
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Failed to load subscription', 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleUpsertOverride() {
    if (!overrideEmail.trim()) return
    setLoading(true)
    setFeedback('', 'neutral')
    try {
      await client.upsertOverride({
        targetType: 'email',
        targetValue: overrideEmail.trim(),
        tier: overrideTier,
        capabilities: overrideCapabilities,
        note: overrideNote.trim() || undefined,
      })
      setOverrideEmail('')
      setOverrideNote('')
      setOverrideTier('premium')
      setOverrideCapabilities(defaultCapabilitiesForTier('premium'))
      await loadOverrides()
      setFeedback('Entitlement override saved', 'success')
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Failed to save override', 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleDeleteOverride(row: EntitlementOverrideRow) {
    if (!window.confirm(`Delete override for ${row.targetValue}?`)) return
    setLoading(true)
    setFeedback('', 'neutral')
    try {
      await client.clearOverride({ targetType: row.targetType, targetValue: row.targetValue })
      await loadOverrides()
      setFeedback('Entitlement override removed', 'success')
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Failed to delete override', 'error')
    } finally {
      setLoading(false)
    }
  }

  // ─── Nav config ─────────────────────────────────────────────────────────

  const navItems = [
    { id: 'overview' as Section, label: 'Overview', icon: Sparkles },
    { id: 'customers' as Section, label: 'Customers', icon: Users },
    { id: 'subscriptions' as Section, label: 'Subscriptions', icon: ShieldCheck },
    { id: 'vaults' as Section, label: 'Vaults', icon: Layers3 },
    { id: 'system' as Section, label: 'System', icon: Server },
  ]

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg-0)] text-[var(--ink)]">

      {/* ── Sidebar ── */}
      <aside
        style={{ width: 'var(--sidebar-width)', minWidth: 'var(--sidebar-width)' }}
        className="flex flex-col border-r border-[var(--sidebar-border)] bg-[var(--sidebar-bg)]"
      >
        {/* Logo / wordmark */}
        <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-[var(--line)] px-5">
          <div className="flex h-6 w-6 items-center justify-center rounded-[6px] bg-[var(--accent)] text-[var(--accent-contrast)]">
            <Lock size={12} strokeWidth={2.5} />
          </div>
          <span className="font-display text-[13px] font-semibold tracking-tight text-[var(--ink)]">Armadillo</span>
          <span className="ml-auto font-mono text-[10px] text-[var(--ink-muted)]">ops</span>
        </div>

        {/* Nav items */}
        <nav className="flex flex-1 flex-col overflow-y-auto px-4 py-3">
          {navItems.map((item) => {
            const Icon = item.icon
            const active = section === item.id
            return (
              <button
                key={item.id}
                onClick={() => setSection(item.id)}
                className={cn(
                  'group flex w-full items-center gap-2.5 border-l-2 px-3 py-[6px] text-left text-[13px] transition-colors',
                  active
                    ? 'border-[var(--accent)] text-[var(--ink)]'
                    : 'border-transparent text-[var(--ink-muted)] hover:text-[var(--ink-secondary)]',
                )}
              >
                <Icon size={14} strokeWidth={1.8} className={active ? 'text-[var(--accent)]' : ''} />
                <span className={active ? 'font-medium' : ''}>{item.label}</span>
              </button>
            )
          })}
        </nav>

        {/* Identity footer */}
        <div className="shrink-0 border-t border-[var(--line)] px-5 py-3">
          {provider === 'convex' && activeToken ? (
            <div className="grid gap-2.5">
              <div>
                <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">Signed in as</div>
                <div className="mt-1 truncate text-[12px] text-[var(--ink)]">{adminMe?.identity?.email || adminMe?.identity?.subject || '…'}</div>
                <div className="mt-0.5 text-[10px] text-[var(--ink-muted)]">{normalizeRoleSummary(adminMe?.identity?.roles)}</div>
              </div>
              <button
                onClick={() => void handleGoogleSignOut()}
                className="flex items-center gap-1.5 text-[12px] text-[var(--ink-muted)] transition-colors hover:text-[var(--exposed)]"
              >
                <LogOut size={11} />
                Sign out
              </button>
            </div>
          ) : provider === 'convex' ? (
            <Button className="w-full" onClick={() => void handleGoogleSignIn()}>
              Sign in with Google
            </Button>
          ) : (
            <div className="grid gap-2">
              <Field label="Bearer token">
                <Input
                  value={selfHostedTokenInput}
                  onChange={(e) => setSelfHostedTokenInput(e.target.value)}
                  placeholder="Paste token…"
                  className="text-xs"
                />
              </Field>
              <Button variant="secondary" size="sm" onClick={() => setSelfHostedToken(selfHostedTokenInput.trim())}>
                Apply token
              </Button>
            </div>
          )}
        </div>
      </aside>

      {/* ── Main area ── */}
      <div className="flex flex-1 flex-col overflow-hidden">

        {/* Top bar */}
        <header className="flex h-14 shrink-0 items-center gap-4 border-b border-[var(--line)] bg-[var(--bg-1)] px-6">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <HealthDot ok={systemStatus?.health?.ok} />
              <span className="text-xs text-[var(--ink-muted)]">
                {systemStatus?.health?.ok ? 'Healthy' : systemStatus ? 'Degraded' : 'Connecting…'}
              </span>
            </div>
            <span className="text-[var(--line-strong)]">·</span>
            <span className="font-mono text-[10px] text-[var(--ink-muted)]">
              {overview?.provider || provider}
            </span>
          </div>

          <div className="ml-auto flex items-center gap-3">
            {superAdmin && (
              <div className="flex items-center gap-4 text-xs text-[var(--ink-muted)]">
                <span><strong className="font-semibold text-[var(--ink)]">{overview?.totalOrgs ?? '—'}</strong> orgs</span>
                <span><strong className="font-semibold text-[var(--ink)]">{overview?.totalMembers ?? '—'}</strong> users</span>
                <span><strong className="font-semibold text-[var(--ink)]">{formatBytes(overview?.totalStorageBytes)}</strong> storage</span>
              </div>
            )}

            {superAdmin && (
              <div className={cn(
                'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.12em]',
                'border-[color:color-mix(in_srgb,var(--accent)_30%,transparent)] text-[var(--accent)]',
              )}>
                <Zap size={10} />
                Superadmin
              </div>
            )}

            <button
              onClick={() => void refreshAll()}
              disabled={!canAttemptLoad || loading}
              className="flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--line-medium)] bg-[var(--bg-2)] px-3 py-1.5 text-xs text-[var(--ink-secondary)] transition-colors hover:border-[var(--line-strong)] hover:text-[var(--ink)] disabled:opacity-40"
            >
              <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
              {loading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
        </header>

        {/* Content scroll area */}
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1280px] px-6 py-6 space-y-4">

            {/* Status banner */}
            <StatusBanner tone={statusTone} message={statusMessage} />

            {/* Auth required */}
            {!activeToken && (
              <Panel>
                <div className="flex flex-col items-center gap-4 px-8 py-16 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--bg-3)]">
                    <Lock size={20} className="text-[var(--ink-muted)]" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-[var(--ink)]">Authentication required</h2>
                    <p className="mt-1 text-xs text-[var(--ink-muted)]">
                      {provider === 'convex'
                        ? 'Sign in with Google using the sidebar to access the operator console.'
                        : 'Provide a self-hosted operator token in the sidebar to continue.'}
                    </p>
                  </div>
                </div>
              </Panel>
            )}

            {/* Access denied */}
            {activeToken && noOperatorAccess && (
              <Panel className="border-[color:color-mix(in_srgb,var(--exposed)_24%,transparent)]">
                <div className="flex flex-col items-center gap-4 px-8 py-12 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--exposed-soft)]">
                    <ShieldCheck size={20} className="text-[var(--exposed)]" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-[var(--ink)]">Operator console denied</h2>
                    <p className="mt-1 max-w-sm text-xs text-[var(--ink-muted)]">
                      This surface is reserved for superAdmin operators. Org-scoped admins should use the Admin Center in the main app.
                    </p>
                  </div>
                  {adminMe?.permissions.reasons.length ? (
                    <ul className="mt-2 grid gap-1 text-left text-xs text-[var(--ink-muted)]">
                      {adminMe.permissions.reasons.map((reason) => (
                        <li key={reason} className="flex items-start gap-2">
                          <span className="mt-0.5 text-[var(--exposed)]">·</span>
                          {reason}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </Panel>
            )}

            {/* ── Overview ── */}
            {activeToken && superAdmin && section === 'overview' && (
              <div className="grid gap-4">
                {/* KPI row */}
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <StatCard label="Organizations" value={overview?.totalOrgs ?? '—'} accent />
                  <StatCard label="Total users" value={overview?.totalMembers ?? '—'} />
                  <StatCard label="Total vaults" value={overview?.totalVaults ?? '—'} />
                  <StatCard label="Storage footprint" value={formatBytes(overview?.totalStorageBytes)} />
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  {/* Subscriptions breakdown */}
                  <Panel>
                    <PanelHeader title="Subscriptions by tier" description="Current distribution across plan tiers" />
                    <div className="px-6 py-4 grid gap-3">
                      {(['free', 'premium', 'enterprise'] as const).map((tier) => {
                        const count = overview?.subscriptionsByTier[tier] ?? 0
                        const total = (overview?.totalOrgs || 1)
                        const pct = Math.round((count / total) * 100)
                        return (
                          <div key={tier} className="grid gap-1.5">
                            <div className="flex items-center justify-between text-xs">
                              <span className="capitalize text-[var(--ink-secondary)]">{tier}</span>
                              <strong className="tabular-nums text-[var(--ink)]">{count}</strong>
                            </div>
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-3)]">
                              <div
                                className={cn(
                                  'h-full rounded-full transition-all',
                                  tier === 'enterprise' ? 'bg-[var(--accent)]' : tier === 'premium' ? 'bg-[var(--safe)]' : 'bg-[var(--ink-muted)]',
                                )}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </Panel>

                  {/* Subscriptions by status */}
                  <Panel>
                    <PanelHeader title="Subscriptions by status" description="Health of current subscription records" />
                    <div>
                      {[
                        { key: 'active', label: 'Active', color: 'var(--safe)' },
                        { key: 'trialing', label: 'Trialing', color: 'var(--info)' },
                        { key: 'paused', label: 'Paused', color: 'var(--weak)' },
                        { key: 'past_due', label: 'Past due', color: 'var(--exposed)' },
                        { key: 'canceled', label: 'Canceled', color: 'var(--ink-muted)' },
                      ].map(({ key, label, color }) => (
                        <SectionRow
                          key={key}
                          label={
                            <span className="flex items-center gap-2">
                              <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: color }} />
                              {label}
                            </span>
                          }
                          value={<strong className="tabular-nums">{(overview?.subscriptionsByStatus as Record<string, number>)?.[key] ?? 0}</strong>}
                        />
                      ))}
                    </div>
                  </Panel>
                </div>

                {/* Selected org quick view */}
                {selectedOrg && (
                  <Panel>
                    <PanelHeader
                      title="Active context"
                      description="Currently selected organization for detail views"
                      action={
                        <button
                          onClick={() => setSection('customers')}
                          className="text-xs text-[var(--accent)] hover:underline"
                        >
                          Inspect →
                        </button>
                      }
                    />
                    <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
                      <StatCard label="Org name" value={<span className="text-base">{selectedOrg.name}</span>} />
                      <StatCard label="Members" value={usage?.memberCount ?? members.length} />
                      <StatCard label="Vaults" value={usage?.vaultCount ?? vaults.length} />
                      <StatCard label="Storage" value={formatBytes(usage?.storageBytes)} />
                    </div>
                  </Panel>
                )}
              </div>
            )}

            {/* ── Customers ── */}
            {activeToken && superAdmin && section === 'customers' && (
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_380px]">
                {/* Search & list */}
                <Panel>
                  <PanelHeader
                    title="Customers"
                    description="Search by org name, org ID, member ID, or email fragment"
                    action={
                      <div className="flex items-center gap-2">
                        <div className="relative">
                          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ink-muted)]" />
                          <Input
                            className="h-8 pl-8 text-xs"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && void handleSearchCustomers()}
                            placeholder="Search…"
                          />
                        </div>
                        <Button variant="secondary" size="sm" onClick={() => void handleSearchCustomers()}>
                          Search
                        </Button>
                      </div>
                    }
                  />
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-left">
                      <thead>
                        <tr className="border-b border-[var(--line)]">
                          {['Organization', 'Members', 'Plan', 'Last activity', ''].map((h) => (
                            <th key={h} className="px-6 pb-3 pt-4 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {customerRows.map((row) => (
                          <tr
                            key={row.orgId}
                            className={cn(
                              'border-b border-[var(--line)] transition-colors last:border-0',
                              row.orgId === selectedOrgId ? 'bg-[var(--bg-3)]' : 'hover:bg-[var(--bg-2)]',
                            )}
                          >
                            <td className="px-6 py-4">
                              <div className="text-sm font-medium text-[var(--ink)]">{row.orgName}</div>
                              <div className="mt-0.5 font-mono text-[10px] text-[var(--ink-muted)]">{row.orgId}</div>
                              {row.matchedMembers.length > 0 && (
                                <div className="mt-1 text-[10px] text-[var(--info)]">Matched: {row.matchedMembers.join(', ')}</div>
                              )}
                            </td>
                            <td className="px-6 py-4 text-sm tabular-nums text-[var(--ink-secondary)]">{row.memberCount}</td>
                            <td className="px-6 py-4">
                              {row.subscriptionTier ? (
                                <Badge variant={row.subscriptionTier === 'enterprise' ? 'default' : row.subscriptionTier === 'premium' ? 'success' : 'muted'}>
                                  {row.subscriptionTier}
                                </Badge>
                              ) : (
                                <span className="text-xs text-[var(--ink-muted)]">—</span>
                              )}
                            </td>
                            <td className="px-6 py-4 text-xs text-[var(--ink-muted)]">{formatDate(row.lastActivityAt)}</td>
                            <td className="px-6 py-4 text-right">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => void handleSelectOrg(row.orgId)}
                              >
                                Inspect
                              </Button>
                            </td>
                          </tr>
                        ))}
                        {customerRows.length === 0 && (
                          <tr>
                            <td colSpan={5} className="px-6 py-8 text-center text-xs text-[var(--ink-muted)]">
                              No customers found.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </Panel>

                {/* Detail pane */}
                <div className="grid gap-4 self-start">
                  {/* Usage */}
                  <Panel>
                    <PanelHeader
                      title={selectedOrg ? selectedOrg.name : 'Customer detail'}
                      description={selectedOrg?.id || 'Select a customer to inspect'}
                    />
                    <div className="grid grid-cols-2 gap-2 p-4">
                      <StatCard label="Members" value={usage?.memberCount ?? members.length} />
                      <StatCard label="Vaults" value={usage?.vaultCount ?? vaults.length} />
                      <StatCard label="Storage" value={formatBytes(usage?.storageBytes)} />
                      <StatCard label="Last active" value={<span className="text-sm">{formatDate(usage?.lastVaultActivityAt)}</span>} />
                    </div>
                  </Panel>

                  {/* Members */}
                  <Panel>
                    <PanelHeader title="Members" />
                    <div className="px-5 py-4">
                      {members.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {members.map((member) => (
                            <Badge key={member.memberId} variant="muted">
                              {member.role}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-[var(--ink-muted)]">No members yet.</p>
                      )}
                    </div>
                  </Panel>

                  {/* Audit */}
                  <Panel>
                    <PanelHeader title="Recent audit" />
                    <div className="divide-y divide-[var(--line)]">
                      {auditEvents.slice(0, 6).map((event) => (
                        <div key={event.id} className="px-5 py-3">
                          <div className="text-xs font-medium text-[var(--ink)]">{event.action}</div>
                          <div className="mt-0.5 text-[10px] text-[var(--ink-secondary)]">{event.target}</div>
                          <div className="mt-1 text-[10px] text-[var(--ink-muted)]">{formatDate(event.createdAt)}</div>
                        </div>
                      ))}
                      {auditEvents.length === 0 && (
                        <div className="px-5 py-4 text-xs text-[var(--ink-muted)]">No recent audit events.</div>
                      )}
                    </div>
                  </Panel>
                </div>
              </div>
            )}

            {/* ── Subscriptions ── */}
            {activeToken && superAdmin && section === 'subscriptions' && (
              <div className="grid gap-4 xl:grid-cols-2">
                {/* Editor */}
                <Panel>
                  <PanelHeader title="Subscription editor" description="Adjust org- or user-scoped subscriptions" />
                  <div className="grid gap-4 p-6">
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Scope">
                        <ControlSelect value={scopeType} onChange={(v) => setScopeType(v as SubscriptionScopeType)}>
                          <option value="org">org</option>
                          <option value="user">user</option>
                        </ControlSelect>
                      </Field>
                      <Field label="Scope ID">
                        <Input value={scopeId} onChange={(e) => setScopeId(e.target.value)} placeholder="org_x or user subject" />
                      </Field>
                      <Field label="Tier">
                        <ControlSelect value={planTier} onChange={(v) => setPlanTier(v as PlanTier)}>
                          <option value="free">free</option>
                          <option value="premium">premium</option>
                          <option value="enterprise">enterprise</option>
                        </ControlSelect>
                      </Field>
                      <Field label="Status">
                        <ControlSelect value={subscriptionStatus} onChange={(v) => setSubscriptionStatus(v as SubscriptionStatus)}>
                          <option value="active">active</option>
                          <option value="trialing">trialing</option>
                          <option value="paused">paused</option>
                          <option value="past_due">past_due</option>
                          <option value="canceled">canceled</option>
                        </ControlSelect>
                      </Field>
                      <Field label="Billing mode">
                        <ControlSelect value={billingMode} onChange={(v) => setBillingMode(v as BillingMode)}>
                          <option value="manual">manual</option>
                          <option value="external">external</option>
                        </ControlSelect>
                      </Field>
                      <Field label="Seat limit">
                        <Input value={seatLimit} onChange={(e) => setSeatLimit(e.target.value)} inputMode="numeric" placeholder="unlimited" />
                      </Field>
                      <Field label="Storage limit (bytes)">
                        <Input value={storageLimitBytes} onChange={(e) => setStorageLimitBytes(e.target.value)} inputMode="numeric" placeholder="unlimited" />
                      </Field>
                      <Field label="Renewal at">
                        <Input value={renewalAt} onChange={(e) => setRenewalAt(e.target.value)} placeholder="2026-04-01T00:00:00Z" />
                      </Field>
                      <Field label="End at" >
                        <Input value={endAt} onChange={(e) => setEndAt(e.target.value)} placeholder="2026-05-01T00:00:00Z" />
                      </Field>
                    </div>
                    <Field label="Internal note">
                      <Textarea
                        className="min-h-[80px]"
                        value={subscriptionNote}
                        onChange={(e) => setSubscriptionNote(e.target.value)}
                        placeholder="Billing or support context"
                      />
                    </Field>
                    <div className="flex gap-2">
                      <Button variant="secondary" onClick={() => void handleLoadSubscriptionTarget()} disabled={!scopeId.trim()}>
                        Load record
                      </Button>
                      <Button onClick={() => void handleSaveSubscription()} disabled={!scopeId.trim()}>
                        Save subscription
                      </Button>
                    </div>
                  </div>

                  {/* Effective entitlement */}
                  {subscription && (
                    <div className="border-t border-[var(--line)]">
                      <PanelHeader title="Effective entitlement" description="Resolved from record + overrides" />
                      <div>
                        <SectionRow label="Stored record" value={subscription.subscription ? `${subscription.subscription.tier} / ${subscription.subscription.status}` : 'none'} />
                        <SectionRow label="Effective tier" value={<Badge variant={subscription.effective.tier === 'enterprise' ? 'default' : subscription.effective.tier === 'premium' ? 'success' : 'muted'}>{subscription.effective.tier || '—'}</Badge>} />
                        <SectionRow label="Source" value={subscription.effective.source || '—'} mono />
                        <SectionRow label="Capabilities" value={<span className="text-right text-[10px] text-[var(--ink-secondary)]">{subscription.effective.capabilities.join(', ') || 'none'}</span>} />
                      </div>
                    </div>
                  )}
                </Panel>

                {/* Overrides */}
                <div className="grid gap-4 self-start">
                  <Panel>
                    <PanelHeader
                      title="Email entitlement overrides"
                      description="Per-email capability grants independent of org subscription"
                      action={<Mail size={14} className="text-[var(--accent)]" />}
                    />
                    <div className="grid gap-4 p-6">
                      <Field label="Registered email" hint="Matched against identity email in auth context">
                        <Input type="email" value={overrideEmail} onChange={(e) => setOverrideEmail(e.target.value)} placeholder="customer@company.com" />
                      </Field>
                      <Field label="Plan baseline">
                        <ControlSelect value={overrideTier} onChange={(v) => setOverrideTier(v as PlanTier)}>
                          <option value="free">free</option>
                          <option value="premium">premium</option>
                          <option value="enterprise">enterprise</option>
                        </ControlSelect>
                      </Field>
                      <div className="grid gap-2">
                        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">Permission toggles</div>
                        <div className="flex flex-wrap gap-1.5">
                          {CAPABILITY_OPTIONS.map((option) => {
                            const active = overrideCapabilities.includes(option.value)
                            return (
                              <button
                                key={option.value}
                                type="button"
                                onClick={() => toggleOverrideCapability(option.value)}
                                className={cn(
                                  'rounded-full border px-3 py-1 text-xs transition-colors',
                                  active
                                    ? 'border-[color:color-mix(in_srgb,var(--accent)_40%,transparent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                                    : 'border-[var(--line-medium)] bg-[var(--bg-3)] text-[var(--ink-muted)] hover:border-[var(--line-strong)] hover:text-[var(--ink-secondary)]',
                                )}
                              >
                                {option.label}
                              </button>
                            )
                          })}
                        </div>
                        <div className="text-[10px] text-[var(--ink-muted)]">{overrideCapabilities.length} of {CAPABILITY_OPTIONS.length} selected</div>
                      </div>
                      <Field label="Support note">
                        <Textarea
                          className="min-h-[80px]"
                          value={overrideNote}
                          onChange={(e) => setOverrideNote(e.target.value)}
                          placeholder="Why this override exists and when to remove it"
                        />
                      </Field>
                      <Button onClick={() => void handleUpsertOverride()} disabled={!overrideEmail.trim()}>
                        Save entitlement override
                      </Button>
                    </div>
                  </Panel>

                  {/* Override table */}
                  <Panel>
                    <PanelHeader title="Active overrides" description={`${overrides.length} record${overrides.length !== 1 ? 's' : ''}`} />
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[520px] text-left">
                        <thead>
                          <tr className="border-b border-[var(--line)]">
                            {['Target', 'Tier', 'Perms', 'Updated', ''].map((h) => (
                              <th key={h} className="px-4 pb-3 pt-4 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {overrides.map((row) => (
                            <tr key={row.id} className="border-b border-[var(--line)] last:border-0 hover:bg-[var(--bg-2)]">
                              <td className="px-4 py-3">
                                <div className="text-xs font-medium text-[var(--ink)]">{row.targetValue}</div>
                                <div className="text-[10px] text-[var(--ink-muted)]">{row.targetType}</div>
                              </td>
                              <td className="px-4 py-3">
                                <Badge variant={row.tier === 'enterprise' ? 'default' : row.tier === 'premium' ? 'success' : 'muted'}>
                                  {row.tier || '—'}
                                </Badge>
                              </td>
                              <td className="px-4 py-3 text-[10px] text-[var(--ink-muted)]">{row.capabilities.length || '—'}</td>
                              <td className="px-4 py-3 text-[10px] text-[var(--ink-muted)]">{formatDate(row.updatedAt)}</td>
                              <td className="px-4 py-3 text-right">
                                <button
                                  onClick={() => void handleDeleteOverride(row)}
                                  className="text-[10px] text-[var(--ink-muted)] transition-colors hover:text-[var(--exposed)]"
                                >
                                  Remove
                                </button>
                              </td>
                            </tr>
                          ))}
                          {overrides.length === 0 && (
                            <tr>
                              <td colSpan={5} className="px-4 py-6 text-center text-xs text-[var(--ink-muted)]">No active overrides.</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </Panel>
                </div>
              </div>
            )}

            {/* ── Vaults ── */}
            {activeToken && superAdmin && section === 'vaults' && (
              <Panel>
                <PanelHeader
                  title="Vault inventory"
                  description={selectedOrg ? `${selectedOrg.name} · ${selectedOrg.id}` : 'Select a customer from Customers to view their vaults'}
                  action={
                    <div className="flex items-center gap-2 text-xs text-[var(--ink-muted)]">
                      <Database size={12} />
                      {vaults.length} vault{vaults.length !== 1 ? 's' : ''}
                    </div>
                  }
                />
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-left">
                    <thead>
                      <tr className="border-b border-[var(--line)]">
                        {['Vault ID', 'Owner', 'Revision', 'Blobs', 'Storage', 'Updated', ''].map((h) => (
                          <th key={h} className="px-6 pb-3 pt-4 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {vaults.map((vault) => (
                        <tr key={vault.vaultId} className="border-b border-[var(--line)] last:border-0 hover:bg-[var(--bg-2)]">
                          <td className="px-6 py-4">
                            <div className="font-mono text-xs text-[var(--ink)]">{vault.vaultId}</div>
                          </td>
                          <td className="px-6 py-4 text-xs text-[var(--ink-muted)]">{vault.ownerId || <span className="text-[var(--ink-faint)] italic">org-scoped</span>}</td>
                          <td className="px-6 py-4 text-sm tabular-nums text-[var(--ink-secondary)]">{vault.revision}</td>
                          <td className="px-6 py-4 text-sm tabular-nums text-[var(--ink-secondary)]">{vault.blobCount}</td>
                          <td className="px-6 py-4 text-sm text-[var(--ink-secondary)]">{formatBytes(vault.storageBytes)}</td>
                          <td className="px-6 py-4 text-xs text-[var(--ink-muted)]">{formatDate(vault.updatedAt)}</td>
                          <td className="px-6 py-4 text-right">
                            <button
                              onClick={() => void handleDeleteVault(vault.vaultId)}
                              className="rounded-[var(--radius-sm)] border border-[color:color-mix(in_srgb,var(--exposed)_24%,transparent)] bg-[var(--exposed-soft)] px-2.5 py-1 text-[10px] text-[var(--exposed)] transition-colors hover:bg-[color:color-mix(in_srgb,var(--exposed)_20%,transparent)]"
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                      {vaults.length === 0 && (
                        <tr>
                          <td colSpan={7} className="px-6 py-10 text-center text-xs text-[var(--ink-muted)]">
                            No org-scoped vaults for the selected customer.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Panel>
            )}

            {/* ── System ── */}
            {activeToken && superAdmin && section === 'system' && (
              <div className="grid gap-4 xl:grid-cols-2">
                {/* Service status */}
                <Panel>
                  <PanelHeader
                    title="Service status"
                    description="Health and readiness for the active provider"
                    action={
                      <div className="flex items-center gap-1.5 text-xs text-[var(--ink-muted)]">
                        <Activity size={12} />
                        Live
                      </div>
                    }
                  />
                  <div className="divide-y divide-[var(--line)]">
                    <SectionRow
                      label="Provider"
                      value={<span className="font-mono text-xs">{systemStatus?.provider || provider}</span>}
                    />
                    <SectionRow
                      label="Health"
                      value={
                        <span className="flex items-center gap-2">
                          <HealthDot ok={systemStatus?.health?.ok} />
                          <span>{systemStatus?.health?.ok ? 'OK' : systemStatus ? 'Degraded' : 'Unknown'}</span>
                        </span>
                      }
                    />
                    <SectionRow
                      label="Readiness"
                      value={
                        <span className="flex items-center gap-2">
                          <HealthDot ok={systemStatus?.readiness?.ok} />
                          <span>{systemStatus?.readiness?.ok ? 'Ready' : systemStatus?.readiness ? 'Not ready' : 'Unavailable'}</span>
                        </span>
                      }
                    />
                    {systemStatus?.note && (
                      <div className="px-6 py-4 text-xs text-[var(--ink-secondary)]">{systemStatus.note}</div>
                    )}
                  </div>
                </Panel>

                {/* Metrics */}
                <Panel>
                  <PanelHeader
                    title="Metrics"
                    description="Live counters when supported by the active backend"
                    action={<Globe size={14} className="text-[var(--ink-muted)]" />}
                  />
                  {systemStatus?.metrics ? (
                    <div className="divide-y divide-[var(--line)]">
                      {Object.entries(systemStatus.metrics).map(([key, value]) => (
                        <SectionRow key={key} label={key} value={<strong className="tabular-nums">{String(value)}</strong>} mono />
                      ))}
                    </div>
                  ) : (
                    <div className="px-6 py-8 text-center text-xs text-[var(--ink-muted)]">
                      Metrics are unavailable on this provider.
                    </div>
                  )}
                </Panel>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}

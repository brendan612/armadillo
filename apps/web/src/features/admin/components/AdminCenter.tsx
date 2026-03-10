import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuthToken } from '@convex-dev/auth/react'
import {
  createAdminClient,
  type AdminAuditEvent,
  type AdminMeResponse,
  type AdminOrg,
  type AdminOrgMember,
  type BillingMode,
  type PlanTier,
  type Role,
  type SubscriptionResponse,
  type SubscriptionStatus,
  type SyncProvider,
  type VaultSummary,
  type OrgUsageSummary,
} from '@armadillo/shared-admin-client'
import { useVaultAppActions, useVaultAppState } from '../../../app/contexts/VaultAppContext'
import { getSyncAuthToken, syncProvider as activeSyncProvider } from '../../../lib/syncClient'
import './AdminCenter.css'

type AdminTab = 'overview' | 'users' | 'vaults' | 'subscription' | 'audit'

function normalizeBaseUrl(url: string) {
  return url.replace(/\/$/, '')
}

function resolveBaseUrl(provider: SyncProvider) {
  if (provider === 'convex') {
    const siteUrl = (import.meta.env.VITE_CONVEX_SITE_URL || '').trim()
    if (siteUrl) return normalizeBaseUrl(siteUrl)
    const deploymentUrl = (import.meta.env.VITE_CONVEX_URL || '').trim()
    if (deploymentUrl) return normalizeBaseUrl(deploymentUrl.replace('.convex.cloud', '.convex.site'))
    const explicitHttpUrl = (import.meta.env.VITE_CONVEX_HTTP_URL || '').trim()
    if (explicitHttpUrl) return normalizeBaseUrl(explicitHttpUrl)
    return ''
  }
  return normalizeBaseUrl(import.meta.env.VITE_SYNC_BASE_URL || '')
}

function formatBytes(value: number | null | undefined) {
  const bytes = typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

function formatDate(value: string | null | undefined) {
  if (!value) return '-'
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return value
  return new Date(parsed).toLocaleString()
}

export function AdminCenter() {
  const provider = (activeSyncProvider === 'self_hosted' ? 'self_hosted' : 'convex') as SyncProvider
  const convexAuthToken = useAuthToken()
  const { entitlementState, entitlementStatusMessage, billingUrl } = useVaultAppState()
  const { refreshEntitlements } = useVaultAppActions()

  const [tab, setTab] = useState<AdminTab>('overview')
  const [statusMessage, setStatusMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [adminMe, setAdminMe] = useState<AdminMeResponse | null>(null)
  const [orgs, setOrgs] = useState<AdminOrg[]>([])
  const [selectedOrgId, setSelectedOrgId] = useState('')
  const [members, setMembers] = useState<AdminOrgMember[]>([])
  const [vaults, setVaults] = useState<VaultSummary[]>([])
  const [usage, setUsage] = useState<OrgUsageSummary | null>(null)
  const [subscription, setSubscription] = useState<SubscriptionResponse | null>(null)
  const [auditEvents, setAuditEvents] = useState<AdminAuditEvent[]>([])
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<Role>('viewer')
  const [selectedPlan, setSelectedPlan] = useState<PlanTier>('free')
  const [subscriptionStatus, setSubscriptionStatus] = useState<SubscriptionStatus>('active')
  const [billingMode, setBillingMode] = useState<BillingMode>('manual')
  const [subscriptionNote, setSubscriptionNote] = useState('')

  const activeToken = provider === 'convex' ? (convexAuthToken || getSyncAuthToken() || '') : (getSyncAuthToken() || '')
  const baseUrl = resolveBaseUrl(provider)
  const effectiveOrgId = selectedOrgId || adminMe?.identity?.orgId || ''
  const client = useMemo(() => createAdminClient({
    provider,
    baseUrl,
    getAuthToken: () => activeToken || null,
    getOrgId: () => effectiveOrgId || null,
  }), [provider, baseUrl, activeToken, effectiveOrgId])

  const loadOrgData = useCallback(async (orgId: string) => {
    if (!orgId) return
    const [memberResponse, vaultResponse, usageResponse, subscriptionResponse, auditResponse] = await Promise.all([
      client.listMembers(orgId),
      client.listVaults(orgId),
      client.getOrgUsage(orgId),
      client.getSubscription('org', orgId),
      client.listAudit(orgId, { limit: 25 }),
    ])
    setMembers(memberResponse.members)
    setVaults(vaultResponse.vaults)
    setUsage(usageResponse)
    setSubscription(subscriptionResponse)
    setAuditEvents(auditResponse.events)
    if (subscriptionResponse.subscription) {
      setSelectedPlan(subscriptionResponse.subscription.tier)
      setSubscriptionStatus(subscriptionResponse.subscription.status)
      setBillingMode(subscriptionResponse.subscription.billingMode)
      setSubscriptionNote(subscriptionResponse.subscription.note)
    } else {
      setSelectedPlan(subscriptionResponse.effective.tier)
      setSubscriptionStatus('active')
      setBillingMode('manual')
      setSubscriptionNote('')
    }
  }, [client])

  const refreshAll = useCallback(async () => {
    if (!baseUrl || !activeToken) {
      setAdminMe(null)
      setOrgs([])
      setSelectedOrgId('')
      setMembers([])
      setVaults([])
      setUsage(null)
      setSubscription(null)
      setAuditEvents([])
      return
    }
    setLoading(true)
    setStatusMessage('')
    try {
      const me = await client.getMe()
      setAdminMe(me)
      if (!me.permissions.allowed || !me.identity?.orgId) {
        setOrgs([])
        setSelectedOrgId('')
        return
      }
      const orgResponse = await client.listOrgs()
      setOrgs(orgResponse.orgs)
      const nextOrgId = selectedOrgId && orgResponse.orgs.some((org) => org.id === selectedOrgId)
        ? selectedOrgId
        : me.identity.orgId
      setSelectedOrgId(nextOrgId)
      await loadOrgData(nextOrgId)
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Failed to load admin center')
    } finally {
      setLoading(false)
    }
  }, [activeToken, baseUrl, client, loadOrgData, selectedOrgId])

  useEffect(() => {
    void refreshAll()
  }, [refreshAll])

  useEffect(() => {
    if (!effectiveOrgId || !adminMe?.permissions.allowed) return
    void loadOrgData(effectiveOrgId).catch((error) => {
      setStatusMessage(error instanceof Error ? error.message : 'Failed to load org data')
    })
  }, [adminMe?.permissions.allowed, effectiveOrgId, loadOrgData])

  async function handleInviteMember() {
    const email = inviteEmail.trim().toLowerCase()
    if (!effectiveOrgId || !email) return
    setLoading(true)
    setStatusMessage('')
    try {
      if (provider === 'convex') {
        const response = await client.inviteMember(effectiveOrgId, {
          email,
          role: inviteRole,
        })
        if (response.emailSent) {
          setInviteEmail('')
          setStatusMessage('Invite email sent')
        } else {
          setStatusMessage(response.deliveryError
            ? `Pending invite saved, but email delivery failed: ${response.deliveryError}`
            : 'Pending invite saved, but email delivery failed')
        }
      } else {
        await client.upsertMember(effectiveOrgId, {
          memberId: `invite:${email}`,
          email,
          role: inviteRole,
        })
        setInviteEmail('')
        setStatusMessage('Pending invite added without email delivery')
      }
      await loadOrgData(effectiveOrgId)
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Failed to invite member')
    } finally {
      setLoading(false)
    }
  }

  function memberDisplayName(member: AdminOrgMember) {
    return member.email || member.memberId.slice(0, 20) + (member.memberId.length > 20 ? '\u2026' : '')
  }

  async function handleRemoveMember(member: AdminOrgMember) {
    if (!effectiveOrgId) return
    if (!window.confirm(`Remove ${memberDisplayName(member)} from the org?`)) return
    const memberId = member.memberId
    setLoading(true)
    setStatusMessage('')
    try {
      await client.removeMember(effectiveOrgId, memberId)
      await loadOrgData(effectiveOrgId)
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Failed to remove member')
    } finally {
      setLoading(false)
    }
  }

  async function handleDeleteVault(vaultId: string) {
    if (!effectiveOrgId) return
    if (!window.confirm(`Delete remote vault ${vaultId}? This removes the org-scoped cloud copy.`)) return
    setLoading(true)
    setStatusMessage('')
    try {
      await client.deleteVault(effectiveOrgId, vaultId)
      await loadOrgData(effectiveOrgId)
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Failed to delete vault')
    } finally {
      setLoading(false)
    }
  }

  async function handleSaveSubscription() {
    if (!effectiveOrgId) return
    setLoading(true)
    setStatusMessage('')
    try {
      await client.upsertSubscription({
        scopeType: 'org',
        scopeId: effectiveOrgId,
        tier: selectedPlan,
        status: subscriptionStatus,
        billingMode,
        note: subscriptionNote.trim(),
      })
      await Promise.all([loadOrgData(effectiveOrgId), refreshEntitlements()])
      setStatusMessage('Subscription saved')
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Failed to save subscription')
    } finally {
      setLoading(false)
    }
  }

  const noAccess = Boolean(adminMe && !adminMe.permissions.allowed)
  const currentRole = adminMe?.identity?.roles[0] || null

  return (
    <section className="pane pane-admin admin-center-pane">
      <div className="admin-center-shell">
        <header className="admin-center-header">
          <div>
            <div className="admin-center-kicker">Customer Admin Center</div>
            <h2>Manage your org</h2>
            <p>Users, vaults, subscription state, and recent org activity.</p>
          </div>
          <div className="admin-center-controls">
            {effectiveOrgId && orgs.length > 0 && (
              <select value={effectiveOrgId} onChange={(event) => setSelectedOrgId(event.target.value)} aria-label="Selected organization">
                {orgs.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name} ({org.id})
                  </option>
                ))}
              </select>
            )}
            <button className="ghost" onClick={() => void refreshAll()} disabled={loading || !activeToken}>Refresh</button>
          </div>
        </header>

        <nav className="admin-center-tabs">
          <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>Overview</button>
          <button className={tab === 'users' ? 'active' : ''} onClick={() => setTab('users')}>Users</button>
          <button className={tab === 'vaults' ? 'active' : ''} onClick={() => setTab('vaults')}>Vaults</button>
          <button className={tab === 'subscription' ? 'active' : ''} onClick={() => setTab('subscription')}>Subscription</button>
          <button className={tab === 'audit' ? 'active' : ''} onClick={() => setTab('audit')}>Audit</button>
        </nav>

        {statusMessage && <p className="admin-center-status admin-center-status-error">{statusMessage}</p>}
        {loading && <p className="admin-center-status">Loading...</p>}

        {!activeToken && (
          <section className="admin-center-card">
            <h3>Authentication required</h3>
            <p>Connect your cloud account before managing org settings.</p>
          </section>
        )}

        {activeToken && noAccess && (
          <section className="admin-center-card">
            <h3>No org admin access</h3>
            <p>Your current role cannot access the Admin Center.</p>
          </section>
        )}

        {activeToken && !noAccess && tab === 'overview' && (
          <div className="admin-center-grid">
            <section className="admin-center-card admin-center-card-hero">
              <div className="admin-center-meta">Current role</div>
              <h3>{currentRole || '-'}</h3>
              <p>{adminMe?.identity?.email || adminMe?.identity?.subject || '-'}</p>
            </section>
            <section className="admin-center-card">
              <div className="admin-center-stat">{usage?.memberCount ?? members.length}</div>
              <p>Members</p>
            </section>
            <section className="admin-center-card">
              <div className="admin-center-stat">{usage?.vaultCount ?? vaults.length}</div>
              <p>Vaults</p>
            </section>
            <section className="admin-center-card">
              <div className="admin-center-stat">{formatBytes(usage?.storageBytes)}</div>
              <p>Storage used</p>
            </section>
            <section className="admin-center-card admin-center-card-wide">
              <h3>Subscription</h3>
              <p>Plan: {subscription?.subscription?.tier || subscription?.effective.tier || entitlementState.tier}</p>
              <p>Effective source: {entitlementState.source}</p>
              <p>Status: {entitlementState.status}</p>
              <p>{entitlementStatusMessage}</p>
            </section>
            <section className="admin-center-card admin-center-card-wide">
              <h3>Recent activity</h3>
              <ul className="admin-center-list">
                {auditEvents.slice(0, 6).map((event) => (
                  <li key={event.id}>
                    <strong>{event.action}</strong>
                    <span>{event.target}</span>
                    <time>{formatDate(event.createdAt)}</time>
                  </li>
                ))}
                {auditEvents.length === 0 && <li>No recent admin activity yet.</li>}
              </ul>
            </section>
          </div>
        )}

        {activeToken && !noAccess && tab === 'users' && (
          <section className="admin-center-card">
            <h3>Invite a member</h3>
            <p>Add someone to this org by email. They&rsquo;ll get access when they sign in.</p>
            <div className="admin-center-invite-row">
              <input
                type="email"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                placeholder="email@example.com"
                onKeyDown={(event) => { if (event.key === 'Enter') void handleInviteMember() }}
              />
              <select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as Role)}>
                <option value="viewer">viewer</option>
                <option value="editor">editor</option>
                <option value="admin">admin</option>
                <option value="owner">owner</option>
              </select>
              <button onClick={() => void handleInviteMember()} disabled={!inviteEmail.trim()}>Send Invite</button>
            </div>
            <table className="admin-center-table">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Role</th>
                  <th>Added</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.memberId}>
                    <td>
                      <span>{memberDisplayName(member)}</span>
                      {member.memberId.startsWith('invite:') && (
                        <span className="admin-center-invite-badge">Pending</span>
                      )}
                    </td>
                    <td>{member.role}</td>
                    <td>{formatDate(member.addedAt)}</td>
                    <td><button className="ghost" onClick={() => void handleRemoveMember(member)}>Remove</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {activeToken && !noAccess && tab === 'vaults' && (
          <section className="admin-center-card">
            <table className="admin-center-table">
              <thead>
                <tr>
                  <th>Vault</th>
                  <th>Revision</th>
                  <th>Updated</th>
                  <th>Blobs</th>
                  <th>Storage</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {vaults.map((vault) => (
                  <tr key={vault.vaultId}>
                    <td>{vault.vaultId}</td>
                    <td>{vault.revision}</td>
                    <td>{formatDate(vault.updatedAt)}</td>
                    <td>{vault.blobCount}</td>
                    <td>{formatBytes(vault.storageBytes)}</td>
                    <td><button className="ghost" onClick={() => void handleDeleteVault(vault.vaultId)}>Delete</button></td>
                  </tr>
                ))}
                {vaults.length === 0 && (
                  <tr>
                    <td colSpan={6}>No org-scoped vault snapshots found yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        )}

        {activeToken && !noAccess && tab === 'subscription' && (
          <section className="admin-center-card">
            <div className="admin-center-subscription-grid">
              <label>
                Plan
                <select value={selectedPlan} onChange={(event) => setSelectedPlan(event.target.value as PlanTier)}>
                  <option value="free">free</option>
                  <option value="premium">premium</option>
                  <option value="enterprise" disabled>enterprise (operator-managed)</option>
                </select>
              </label>
              <label>
                Status
                <select value={subscriptionStatus} onChange={(event) => setSubscriptionStatus(event.target.value as SubscriptionStatus)}>
                  <option value="active">active</option>
                  <option value="trialing">trialing</option>
                  <option value="paused">paused</option>
                  <option value="canceled">canceled</option>
                </select>
              </label>
              <label>
                Billing Mode
                <select value={billingMode} onChange={(event) => setBillingMode(event.target.value as BillingMode)}>
                  <option value="manual">manual</option>
                  <option value="external">external</option>
                </select>
              </label>
              <label className="admin-center-wide-field">
                Note
                <input value={subscriptionNote} onChange={(event) => setSubscriptionNote(event.target.value)} placeholder="Internal note or renewal context" />
              </label>
            </div>
            <div className="admin-center-subscription-summary">
              <p>Effective plan: {subscription?.effective.tier || entitlementState.tier}</p>
              <p>Entitlement source: {entitlementState.source}</p>
              <p>Capabilities: {(subscription?.effective.capabilities || entitlementState.capabilities).join(', ') || 'none'}</p>
              <p>Storage limit: {formatBytes(subscription?.effective.storageLimitBytes)}</p>
            </div>
            <div className="admin-center-inline-form">
              <button onClick={() => void handleSaveSubscription()} disabled={selectedPlan === 'enterprise'}>Save Subscription</button>
              <button className="ghost" onClick={() => void refreshEntitlements()}>Refresh Entitlements</button>
              {billingUrl && <button className="ghost" onClick={() => window.open(billingUrl, '_blank', 'noopener,noreferrer')}>Open Billing Link</button>}
            </div>
          </section>
        )}

        {activeToken && !noAccess && tab === 'audit' && (
          <section className="admin-center-card">
            <table className="admin-center-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Action</th>
                  <th>Target</th>
                  <th>Actor</th>
                </tr>
              </thead>
              <tbody>
                {auditEvents.map((event) => (
                  <tr key={event.id}>
                    <td>{formatDate(event.createdAt)}</td>
                    <td>{event.action}</td>
                    <td>{event.target}</td>
                    <td>{event.actorSubject}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>
    </section>
  )
}

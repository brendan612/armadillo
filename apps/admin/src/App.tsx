import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuthActions, useAuthToken } from '@convex-dev/auth/react'
import {
  createAdminClient,
  type AdminAuditEvent,
  type AdminMeResponse,
  type AdminOrg,
  type AdminOrgMember,
  type EntitlementOverrideRow,
  type OverrideTargetType,
  type Role,
  type SyncProvider,
} from '@armadillo/shared-admin-client'

type Section = 'overview' | 'organizations' | 'entitlements' | 'members' | 'audit'

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

const DEFAULT_AUDIT_LIMIT = 50
const DEFAULT_OVERRIDE_LIMIT = 50

export default function App() {
  const provider = resolveProvider()
  const convexAuthToken = useAuthToken()
  const { signIn, signOut } = useAuthActions()
  const [section, setSection] = useState<Section>('overview')
  const [selfHostedTokenInput, setSelfHostedTokenInput] = useState((import.meta.env.VITE_SYNC_AUTH_TOKEN || '').trim())
  const [selfHostedToken, setSelfHostedToken] = useState((import.meta.env.VITE_SYNC_AUTH_TOKEN || '').trim())
  const [statusMessage, setStatusMessage] = useState('')
  const [loading, setLoading] = useState(false)

  const [adminMe, setAdminMe] = useState<AdminMeResponse | null>(null)
  const [orgs, setOrgs] = useState<AdminOrg[]>([])
  const [selectedOrgId, setSelectedOrgId] = useState('')
  const [members, setMembers] = useState<AdminOrgMember[]>([])
  const [auditEvents, setAuditEvents] = useState<AdminAuditEvent[]>([])
  const [auditCursor, setAuditCursor] = useState<string | null>(null)
  const [overrides, setOverrides] = useState<EntitlementOverrideRow[]>([])
  const [overrideCursor, setOverrideCursor] = useState<string | null>(null)

  const [newMemberId, setNewMemberId] = useState('')
  const [newMemberRole, setNewMemberRole] = useState<Role>('viewer')
  const [newOrgId, setNewOrgId] = useState('')
  const [newOrgName, setNewOrgName] = useState('')
  const [targetType, setTargetType] = useState<OverrideTargetType>('email')
  const [targetValue, setTargetValue] = useState('')
  const [overrideToken, setOverrideToken] = useState('')
  const [overrideNote, setOverrideNote] = useState('')

  const activeToken = provider === 'convex' ? (convexAuthToken || '') : selfHostedToken
  const effectiveOrgId = selectedOrgId || adminMe?.identity?.orgId || ''

  const baseUrl = provider === 'convex'
    ? resolveConvexHttpBaseUrl()
    : normalizeBaseUrl(import.meta.env.VITE_SYNC_BASE_URL || '')

  const client = useMemo(() => createAdminClient({
    provider,
    baseUrl,
    getAuthToken: () => activeToken || null,
    getOrgId: () => effectiveOrgId || null,
  }), [provider, baseUrl, activeToken, effectiveOrgId])

  const canAttemptLoad = Boolean(baseUrl && activeToken)

  const loadMembers = useCallback(async (targetOrgId?: string) => {
    const orgId = targetOrgId || effectiveOrgId
    if (!orgId) return
    const result = await client.listMembers(orgId)
    setMembers(result.members)
  }, [client, effectiveOrgId])

  const loadAudit = useCallback(async (cursor = '', targetOrgId?: string) => {
    const orgId = targetOrgId || effectiveOrgId
    if (!orgId) return
    const result = await client.listAudit(orgId, {
      limit: DEFAULT_AUDIT_LIMIT,
      cursor: cursor || undefined,
    })
    setAuditEvents((prev) => (cursor ? [...prev, ...result.events] : result.events))
    setAuditCursor(result.nextCursor)
  }, [client, effectiveOrgId])

  const loadOverrides = useCallback(async (cursor = '') => {
    const result = await client.listOverrides({
      limit: DEFAULT_OVERRIDE_LIMIT,
      cursor: cursor || undefined,
    })
    setOverrides((prev) => (cursor ? [...prev, ...result.overrides] : result.overrides))
    setOverrideCursor(result.nextCursor)
  }, [client])

  const refreshAll = useCallback(async () => {
    if (!canAttemptLoad) {
      setAdminMe(null)
      setOrgs([])
      setSelectedOrgId('')
      setMembers([])
      setAuditEvents([])
      setOverrides([])
      return
    }
    setLoading(true)
    setStatusMessage('')
    try {
      const me = await client.getMe()
      setAdminMe(me)
      const meOrgId = me.identity?.orgId || ''
      if (!me.permissions.allowed || !meOrgId) {
        setOrgs([])
        setSelectedOrgId('')
        setMembers([])
        setAuditEvents([])
        setOverrides([])
        return
      }

      const orgResponse = await client.listOrgs()
      const orgRows = orgResponse.orgs || []
      setOrgs(orgRows)

      const fromCurrent = selectedOrgId && orgRows.some((org) => org.id === selectedOrgId) ? selectedOrgId : ''
      const fromMe = orgRows.some((org) => org.id === meOrgId) ? meOrgId : ''
      const nextOrgId = fromCurrent || fromMe || orgRows[0]?.id || meOrgId
      setSelectedOrgId(nextOrgId)

      await Promise.all([loadMembers(nextOrgId), loadAudit('', nextOrgId), loadOverrides()])
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Failed to load admin data')
    } finally {
      setLoading(false)
    }
  }, [canAttemptLoad, client, loadAudit, loadMembers, loadOverrides, selectedOrgId])

  useEffect(() => {
    void refreshAll()
  }, [refreshAll])

  useEffect(() => {
    if (!activeToken || !adminMe?.permissions.allowed || !effectiveOrgId) return
    void (async () => {
      try {
        setLoading(true)
        setStatusMessage('')
        await Promise.all([loadMembers(effectiveOrgId), loadAudit('', effectiveOrgId)])
      } catch (error) {
        setStatusMessage(error instanceof Error ? error.message : 'Failed to load org data')
      } finally {
        setLoading(false)
      }
    })()
  }, [activeToken, adminMe?.permissions.allowed, effectiveOrgId, loadAudit, loadMembers])

  async function handleGoogleSignIn() {
    setStatusMessage('')
    try {
      await signIn('google', { redirectTo: window.location.origin })
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Google sign-in failed')
    }
  }

  async function handleGoogleSignOut() {
    setStatusMessage('')
    try {
      await signOut()
      setAdminMe(null)
      setOrgs([])
      setSelectedOrgId('')
      setMembers([])
      setAuditEvents([])
      setOverrides([])
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Sign out failed')
    }
  }

  async function handleCreateOrg() {
    if (!newOrgName.trim()) return
    setLoading(true)
    setStatusMessage('')
    try {
      const created = await client.createOrg({
        name: newOrgName.trim(),
        orgId: newOrgId.trim() || undefined,
      })
      const orgResponse = await client.listOrgs()
      setOrgs(orgResponse.orgs || [])
      const createdOrgId = created.org?.id || ''
      if (createdOrgId) {
        setSelectedOrgId(createdOrgId)
        await Promise.all([loadMembers(createdOrgId), loadAudit('', createdOrgId)])
      }
      setNewOrgId('')
      setNewOrgName('')
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Failed to create org')
    } finally {
      setLoading(false)
    }
  }

  async function handleUpsertMember() {
    if (!effectiveOrgId || !newMemberId.trim()) return
    setLoading(true)
    setStatusMessage('')
    try {
      await client.upsertMember(effectiveOrgId, { memberId: newMemberId.trim(), role: newMemberRole })
      setNewMemberId('')
      await loadMembers()
      await loadAudit()
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Failed to save member')
    } finally {
      setLoading(false)
    }
  }

  async function handleRemoveMember(memberId: string) {
    if (!effectiveOrgId) return
    const confirmed = window.confirm(`Remove member ${memberId}?`)
    if (!confirmed) return
    setLoading(true)
    setStatusMessage('')
    try {
      await client.removeMember(effectiveOrgId, memberId)
      await loadMembers()
      await loadAudit()
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Failed to remove member')
    } finally {
      setLoading(false)
    }
  }

  async function handleUpsertOverride() {
    if (!targetValue.trim() || !overrideToken.trim()) return
    setLoading(true)
    setStatusMessage('')
    try {
      await client.upsertOverride({
        targetType,
        targetValue: targetValue.trim(),
        token: overrideToken.trim(),
        note: overrideNote.trim() || undefined,
      })
      setTargetValue('')
      setOverrideToken('')
      setOverrideNote('')
      await loadOverrides()
      await loadAudit()
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Failed to save override')
    } finally {
      setLoading(false)
    }
  }

  async function handleDeleteOverride(row: EntitlementOverrideRow) {
    const confirmed = window.confirm(`Delete override for ${row.targetType}:${row.targetValue}?`)
    if (!confirmed) return
    setLoading(true)
    setStatusMessage('')
    try {
      await client.clearOverride({ targetType: row.targetType, targetValue: row.targetValue })
      await loadOverrides()
      await loadAudit()
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Failed to delete override')
    } finally {
      setLoading(false)
    }
  }

  const noAccess = Boolean(adminMe && !adminMe.permissions.allowed)

  return (
    <div className="admin-root">
      <header className="admin-header">
        <div>
          <h1>Armadillo Admin</h1>
          <p>Version {__APP_VERSION__}</p>
        </div>
        <div className="admin-auth-row">
          <span className={`pill ${provider === 'convex' ? 'ok' : 'warn'}`}>
            Provider: {provider === 'convex' ? 'Convex' : 'Self-hosted'}
          </span>
          {activeToken && !noAccess && (
            <select
              value={effectiveOrgId}
              onChange={(event) => setSelectedOrgId(event.target.value)}
              aria-label="Selected organization"
            >
              {orgs.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name} ({org.id})
                </option>
              ))}
            </select>
          )}
          {provider === 'convex' ? (
            activeToken ? (
              <button onClick={() => void handleGoogleSignOut()}>Sign Out</button>
            ) : (
              <button onClick={() => void handleGoogleSignIn()}>Sign In with Google</button>
            )
          ) : (
            <div className="inline-form">
              <input
                value={selfHostedTokenInput}
                onChange={(event) => setSelfHostedTokenInput(event.target.value)}
                placeholder="Bearer token"
              />
              <button
                onClick={() => {
                  setSelfHostedToken(selfHostedTokenInput.trim())
                }}
              >
                Use Token
              </button>
            </div>
          )}
          <button onClick={() => void refreshAll()} disabled={!canAttemptLoad || loading}>Refresh</button>
        </div>
      </header>

      <nav className="admin-nav">
        <button className={section === 'overview' ? 'active' : ''} onClick={() => setSection('overview')}>Overview</button>
        <button className={section === 'organizations' ? 'active' : ''} onClick={() => setSection('organizations')}>Organizations</button>
        <button className={section === 'entitlements' ? 'active' : ''} onClick={() => setSection('entitlements')}>Entitlements</button>
        <button className={section === 'members' ? 'active' : ''} onClick={() => setSection('members')}>Members</button>
        <button className={section === 'audit' ? 'active' : ''} onClick={() => setSection('audit')}>Audit</button>
      </nav>

      {statusMessage && <p className="status error">{statusMessage}</p>}
      {loading && <p className="status">Loading...</p>}

      {!activeToken && (
        <section className="panel">
          <h2>Authentication Required</h2>
          <p>{provider === 'convex' ? 'Sign in with Google to continue.' : 'Paste a self-hosted bearer token to continue.'}</p>
        </section>
      )}

      {activeToken && noAccess && (
        <section className="panel">
          <h2>No Admin Access</h2>
          <p>Your account is authenticated but not authorized for admin operations.</p>
          <ul>
            {adminMe?.permissions.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </section>
      )}

      {activeToken && !noAccess && section === 'overview' && (
        <section className="panel">
          <h2>Overview</h2>
          <dl>
            <dt>Subject</dt>
            <dd>{adminMe?.identity?.subject || '-'}</dd>
            <dt>Email</dt>
            <dd>{adminMe?.identity?.email || '-'}</dd>
            <dt>Org</dt>
            <dd>{effectiveOrgId || adminMe?.identity?.orgId || '-'}</dd>
            <dt>Roles</dt>
            <dd>{adminMe?.identity?.roles.join(', ') || '-'}</dd>
            <dt>Permissions</dt>
            <dd>{adminMe?.permissions.allowed ? 'Allowed' : 'Denied'}</dd>
            <dt>Super Admin</dt>
            <dd>{adminMe?.permissions.superAdmin ? 'Yes' : 'No'}</dd>
          </dl>
        </section>
      )}

      {activeToken && !noAccess && section === 'organizations' && (
        <section className="panel">
          <h2>Organizations</h2>
          <div className="inline-form">
            <input
              value={newOrgName}
              onChange={(event) => setNewOrgName(event.target.value)}
              placeholder="Organization name"
            />
            <input
              value={newOrgId}
              onChange={(event) => setNewOrgId(event.target.value)}
              placeholder="org_id (optional)"
            />
            <button onClick={() => void handleCreateOrg()} disabled={!newOrgName.trim()}>
              Create Org
            </button>
          </div>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Org ID</th>
                <th>Role</th>
                <th>Members</th>
                <th>Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {orgs.map((org) => (
                <tr key={org.id}>
                  <td>{org.name}</td>
                  <td>{org.id}</td>
                  <td>{org.myRole || '-'}</td>
                  <td>{org.memberCount ?? '-'}</td>
                  <td>{org.createdAt}</td>
                  <td>
                    <button onClick={() => setSelectedOrgId(org.id)} disabled={effectiveOrgId === org.id}>
                      {effectiveOrgId === org.id ? 'Active' : 'Manage'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {activeToken && !noAccess && section === 'members' && (
        <section className="panel">
          <h2>Members ({effectiveOrgId || 'No org selected'})</h2>
          <div className="inline-form">
            <input
              value={newMemberId}
              onChange={(event) => setNewMemberId(event.target.value)}
              placeholder="memberId"
            />
            <select value={newMemberRole} onChange={(event) => setNewMemberRole(event.target.value as Role)}>
              <option value="viewer">viewer</option>
              <option value="editor">editor</option>
              <option value="admin">admin</option>
              <option value="owner">owner</option>
            </select>
            <button onClick={() => void handleUpsertMember()} disabled={!effectiveOrgId || !newMemberId.trim()}>Save Member</button>
          </div>
          <table>
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
                  <td>{member.memberId}</td>
                  <td>{member.role}</td>
                  <td>{member.addedAt}</td>
                  <td>
                    <button onClick={() => void handleRemoveMember(member.memberId)}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {activeToken && !noAccess && section === 'entitlements' && (
        <section className="panel">
          <h2>Entitlement Overrides</h2>
          <div className="form-grid">
            <label>
              Target Type
              <select value={targetType} onChange={(event) => setTargetType(event.target.value as OverrideTargetType)}>
                <option value="email">email</option>
                <option value="subject">subject</option>
                <option value="userId">userId</option>
                <option value="tokenIdentifier">tokenIdentifier</option>
              </select>
            </label>
            <label>
              Target Value
              <input value={targetValue} onChange={(event) => setTargetValue(event.target.value)} />
            </label>
            <label>
              Signed Token
              <textarea value={overrideToken} onChange={(event) => setOverrideToken(event.target.value)} rows={3} />
            </label>
            <label>
              Note
              <input value={overrideNote} onChange={(event) => setOverrideNote(event.target.value)} />
            </label>
            <button onClick={() => void handleUpsertOverride()} disabled={!targetValue.trim() || !overrideToken.trim()}>
              Save Override
            </button>
          </div>
          <table>
            <thead>
              <tr>
                <th>Target</th>
                <th>Updated</th>
                <th>Actor</th>
                <th>Note</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {overrides.map((row) => (
                <tr key={row.id}>
                  <td>{row.targetType}:{row.targetValue}</td>
                  <td>{row.updatedAt}</td>
                  <td>{row.updatedBy}</td>
                  <td>{row.note || '-'}</td>
                  <td>
                    <button onClick={() => void handleDeleteOverride(row)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {overrideCursor && <button onClick={() => void loadOverrides(overrideCursor)}>Load More</button>}
        </section>
      )}

      {activeToken && !noAccess && section === 'audit' && (
        <section className="panel">
          <h2>Audit Log ({effectiveOrgId || 'No org selected'})</h2>
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Target</th>
              </tr>
            </thead>
            <tbody>
              {auditEvents.map((event) => (
                <tr key={event.id}>
                  <td>{event.createdAt}</td>
                  <td>{event.actorSubject}</td>
                  <td>{event.action}</td>
                  <td>{event.target}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {auditCursor && <button onClick={() => void loadAudit(auditCursor)}>Load More</button>}
        </section>
      )}
    </div>
  )
}

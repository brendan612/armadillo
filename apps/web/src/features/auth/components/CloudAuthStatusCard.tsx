import { syncConfigured } from '../../../lib/syncClient'
import { useVaultAppActions, useVaultAppDerived, useVaultAppState } from '../../../app/contexts/VaultAppContext'
import { GoogleSignInButton } from './GoogleSignInButton'

type CloudAuthStatusCardProps = {
  variant?: 'card' | 'inline'
}

export function CloudAuthStatusCard({ variant = 'card' }: CloudAuthStatusCardProps) {
  const { cloudConnected, authStatus, hasCapability } = useVaultAppDerived()
  const { cloudAuthState, syncProvider, cloudSyncEnabled } = useVaultAppState()
  const { signInWithGoogle, signOutCloud } = useVaultAppActions()
  const cloudSyncAllowed = hasCapability('cloud.sync') && (syncProvider !== 'self_hosted' || hasCapability('enterprise.self_hosted'))
  const showSignIn = syncProvider === 'convex'
    ? true
    : cloudSyncEnabled && cloudSyncAllowed
  const action = !syncConfigured()
    ? null
    : (!cloudConnected
      ? (showSignIn
        ? {
          label: syncProvider === 'self_hosted'
            ? (cloudAuthState === 'checking' ? 'Checking session...' : 'Authenticate')
            : (cloudAuthState === 'checking' ? 'Checking session...' : 'Sign in with Google'),
          disabled: cloudAuthState === 'checking',
          onClick: () => void signInWithGoogle(),
        }
        : null)
      : {
        label: 'Sign out',
        disabled: false,
        onClick: () => void signOutCloud(),
      })

  if (variant === 'inline') {
    return (
      <div className="auth-inline-meta">
        <p className="muted" style={{ margin: 0 }}>{authStatus}</p>
        {action && (
          <button
            className="auth-link-btn"
            type="button"
            onClick={action.onClick}
            disabled={action.disabled}
          >
            {action.label}
          </button>
        )}
      </div>
    )
  }

  return (
    <section className="auth-status-card">
      <p className="muted" style={{ margin: 0 }}>{authStatus}</p>
      {action && (
        <div className="auth-status-actions">
          {!cloudConnected && syncProvider !== 'self_hosted' ? (
            <GoogleSignInButton
              onClick={action.onClick}
              disabled={action.disabled}
              label={action.label}
            />
          ) : (
            <button className="ghost" onClick={action.onClick} disabled={action.disabled}>{action.label}</button>
          )}
        </div>
      )}
    </section>
  )
}

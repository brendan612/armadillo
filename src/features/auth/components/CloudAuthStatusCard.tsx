import { syncConfigured } from '../../../lib/syncClient'
import { useVaultAppActions, useVaultAppDerived, useVaultAppState } from '../../../app/contexts/VaultAppContext'

export function CloudAuthStatusCard() {
  const { cloudConnected, authStatus, hasCapability } = useVaultAppDerived()
  const { cloudAuthState, syncProvider, cloudSyncEnabled } = useVaultAppState()
  const { signInWithGoogle, signOutCloud } = useVaultAppActions()
  const cloudSyncAllowed = hasCapability('cloud.sync') && (syncProvider !== 'self_hosted' || hasCapability('enterprise.self_hosted'))
  const showSignIn = cloudSyncEnabled && cloudSyncAllowed

  return (
    <section className="auth-status-card">
      <p className="muted" style={{ margin: 0 }}>{authStatus}</p>
      {syncConfigured() && (
        <div className="auth-status-actions">
          {!cloudConnected ? (
            showSignIn ? (
              <button className="ghost" onClick={() => void signInWithGoogle()} disabled={cloudAuthState === 'checking'}>
                {cloudAuthState === 'checking' ? 'Checking Session...' : (syncProvider === 'self_hosted' ? 'Authenticate' : 'Sign in with Google')}
              </button>
            ) : null
          ) : (
            <button className="ghost" onClick={() => void signOutCloud()}>Sign out</button>
          )}
        </div>
      )}
    </section>
  )
}

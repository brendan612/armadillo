import { syncConfigured } from '../../../lib/syncClient'
import { useVaultAppActions, useVaultAppDerived, useVaultAppState } from '../../../app/contexts/VaultAppContext'

export function CloudAuthStatusCard() {
  const { cloudConnected, authStatus } = useVaultAppDerived()
  const { cloudAuthState, syncProvider } = useVaultAppState()
  const { signInWithGoogle, signOutCloud } = useVaultAppActions()

  return (
    <section className="auth-status-card">
      <p className="muted" style={{ margin: 0 }}>{authStatus}</p>
      {syncConfigured() && (
        <div className="auth-status-actions">
          {!cloudConnected ? (
            <button className="ghost" onClick={() => void signInWithGoogle()} disabled={cloudAuthState === 'checking'}>
              {cloudAuthState === 'checking' ? 'Checking Session...' : (syncProvider === 'self_hosted' ? 'Authenticate' : 'Sign in with Google')}
            </button>
          ) : (
            <button className="ghost" onClick={() => void signOutCloud()}>Sign out</button>
          )}
        </div>
      )}
    </section>
  )
}

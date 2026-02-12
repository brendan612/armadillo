import { convexConfigured } from '../../../lib/convexApi'
import { useVaultAppActions, useVaultAppDerived, useVaultAppState } from '../../../app/contexts/VaultAppContext'

export function CloudAuthStatusCard() {
  const { cloudConnected, authStatus } = useVaultAppDerived()
  const { cloudAuthState } = useVaultAppState()
  const { signInWithGoogle, signOutCloud } = useVaultAppActions()

  return (
    <section className="auth-status-card">
      <p className="muted" style={{ margin: 0 }}>{authStatus}</p>
      {convexConfigured() && (
        <div className="auth-status-actions">
          {!cloudConnected ? (
            <button className="ghost" onClick={() => void signInWithGoogle()} disabled={cloudAuthState === 'checking'}>
              {cloudAuthState === 'checking' ? 'Checking Session...' : 'Sign in with Google'}
            </button>
          ) : (
            <button className="ghost" onClick={() => void signOutCloud()}>Sign out</button>
          )}
        </div>
      )}
    </section>
  )
}

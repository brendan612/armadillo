import { syncConfigured } from '../../../lib/syncClient'
import { useVaultAppActions, useVaultAppDerived, useVaultAppState } from '../../../app/contexts/VaultAppContext'
import { GoogleSignInButton } from './GoogleSignInButton'

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
              syncProvider === 'self_hosted' ? (
                <button className="ghost" onClick={() => void signInWithGoogle()} disabled={cloudAuthState === 'checking'}>
                  {cloudAuthState === 'checking' ? 'Checking Session...' : 'Authenticate'}
                </button>
              ) : (
                <GoogleSignInButton
                  onClick={() => void signInWithGoogle()}
                  disabled={cloudAuthState === 'checking'}
                  label={cloudAuthState === 'checking' ? 'Checking Session...' : 'Sign in with Google'}
                />
              )
            ) : null
          ) : (
            <button className="ghost" onClick={() => void signOutCloud()}>Sign out</button>
          )}
        </div>
      )}
    </section>
  )
}

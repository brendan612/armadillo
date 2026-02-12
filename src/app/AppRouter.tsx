import { useVaultAppState } from './contexts/VaultAppContext'
import { CreateVaultScreen } from '../features/auth/components/CreateVaultScreen'
import { UnlockVaultScreen } from '../features/auth/components/UnlockVaultScreen'
import { AppShell } from './AppShell'

export function AppRouter() {
  const { phase } = useVaultAppState()

  if (phase === 'create') {
    return <CreateVaultScreen />
  }

  if (phase === 'unlock') {
    return <UnlockVaultScreen />
  }

  return <AppShell />
}

import { useVaultApp } from './app/hooks/useVaultApp'
import { VaultAppProvider } from './app/contexts/VaultAppContext'
import { AppRouter } from './app/AppRouter'

function App() {
  const app = useVaultApp()

  return (
    <VaultAppProvider value={app}>
      <AppRouter />
    </VaultAppProvider>
  )
}

export default App

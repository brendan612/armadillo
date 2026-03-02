/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, type ReactNode } from 'react'
import type { VaultAppModel } from '../hooks/useVaultApp'

const VaultAppStateContext = createContext<VaultAppModel['state'] | null>(null)
const VaultAppDerivedContext = createContext<VaultAppModel['derived'] | null>(null)
const VaultAppActionsContext = createContext<VaultAppModel['actions'] | null>(null)
const VaultAppRefsContext = createContext<VaultAppModel['refs'] | null>(null)

export function VaultAppProvider({ value, children }: { value: VaultAppModel; children: ReactNode }) {
  return (
    <VaultAppStateContext.Provider value={value.state}>
      <VaultAppDerivedContext.Provider value={value.derived}>
        <VaultAppActionsContext.Provider value={value.actions}>
          <VaultAppRefsContext.Provider value={value.refs}>{children}</VaultAppRefsContext.Provider>
        </VaultAppActionsContext.Provider>
      </VaultAppDerivedContext.Provider>
    </VaultAppStateContext.Provider>
  )
}

export function useVaultAppState() {
  const ctx = useContext(VaultAppStateContext)
  if (!ctx) throw new Error('useVaultAppState must be used inside VaultAppProvider')
  return ctx
}

export function useVaultAppDerived() {
  const ctx = useContext(VaultAppDerivedContext)
  if (!ctx) throw new Error('useVaultAppDerived must be used inside VaultAppProvider')
  return ctx
}

export function useVaultAppActions() {
  const ctx = useContext(VaultAppActionsContext)
  if (!ctx) throw new Error('useVaultAppActions must be used inside VaultAppProvider')
  return ctx
}

export function useVaultAppRefs() {
  const ctx = useContext(VaultAppRefsContext)
  if (!ctx) throw new Error('useVaultAppRefs must be used inside VaultAppProvider')
  return ctx
}

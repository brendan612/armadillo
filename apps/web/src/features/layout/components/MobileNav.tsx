import { House, KeyRound, PenSquare, Shield } from 'lucide-react'
import { useVaultAppActions, useVaultAppDerived, useVaultAppState } from '../../../app/contexts/VaultAppContext'

export function MobileNav() {
  const { mobileStep, selectedNode, workspaceSection } = useVaultAppState()
  const { adminCenterEnabled } = useVaultAppDerived()
  const { setMobileStep, setSelectedNode, openHome, openStorageWorkspace, openAdminWorkspace } = useVaultAppActions()

  return (
    <>
      <div className="mobile-nav">
        <button className={mobileStep === 'home' ? 'active' : ''} onClick={openHome}>
          <House size={20} strokeWidth={1.8} aria-hidden="true" />
          Home
        </button>
        <button
          className={mobileStep === 'list' ? 'active' : ''}
          onClick={() => {
            if (workspaceSection === 'storage') {
              openStorageWorkspace()
            } else if (selectedNode === 'home') {
              setSelectedNode('all')
            }
            setMobileStep('list')
          }}
        >
          <KeyRound size={20} strokeWidth={1.8} aria-hidden="true" />
          {workspaceSection === 'storage' ? 'Storage' : 'Vault'}
        </button>
        {adminCenterEnabled ? (
          <button className={workspaceSection === 'admin' ? 'active' : ''} onClick={openAdminWorkspace}>
            <Shield size={20} strokeWidth={1.8} aria-hidden="true" />
            Admin
          </button>
        ) : (
          <button className={mobileStep === 'detail' ? 'active' : ''} onClick={() => setMobileStep('detail')}>
            <PenSquare size={20} strokeWidth={1.8} aria-hidden="true" />
            Detail
          </button>
        )}
      </div>
      <div className="mobile-nav-spacer" />
    </>
  )
}

import { House, KeyRound, PenSquare } from 'lucide-react'
import { useVaultAppActions, useVaultAppState } from '../../../app/contexts/VaultAppContext'

export function MobileNav() {
  const { mobileStep, selectedNode } = useVaultAppState()
  const { setMobileStep, setSelectedNode, openHome } = useVaultAppActions()

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
            if (selectedNode === 'home') {
              setSelectedNode('all')
            }
            setMobileStep('list')
          }}
        >
          <KeyRound size={20} strokeWidth={1.8} aria-hidden="true" />
          Vault
        </button>
        <button className={mobileStep === 'detail' ? 'active' : ''} onClick={() => setMobileStep('detail')}>
          <PenSquare size={20} strokeWidth={1.8} aria-hidden="true" />
          Detail
        </button>
      </div>
      <div className="mobile-nav-spacer" />
    </>
  )
}

import { FolderOpen, KeyRound, PenSquare } from 'lucide-react'
import { useVaultAppActions, useVaultAppState } from '../../../app/contexts/VaultAppContext'

export function MobileNav() {
  const { mobileStep } = useVaultAppState()
  const { setMobileStep } = useVaultAppActions()

  return (
    <>
      <div className="mobile-nav">
        <button className={mobileStep === 'nav' ? 'active' : ''} onClick={() => setMobileStep('nav')}>
          <FolderOpen size={20} strokeWidth={1.8} aria-hidden="true" />
          Menu
        </button>
        <button className={mobileStep === 'list' ? 'active' : ''} onClick={() => setMobileStep('list')}>
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

import { useVaultAppActions, useVaultAppState } from '../../../app/contexts/VaultAppContext'

export function MobileNav() {
  const { mobileStep } = useVaultAppState()
  const { setMobileStep } = useVaultAppActions()

  return (
    <>
      <div className="mobile-nav">
        <button className={mobileStep === 'nav' ? 'active' : ''} onClick={() => setMobileStep('nav')}>Menu</button>
        <button className={mobileStep === 'list' ? 'active' : ''} onClick={() => setMobileStep('list')}>Vault</button>
        <button className={mobileStep === 'detail' ? 'active' : ''} onClick={() => setMobileStep('detail')}>Detail</button>
      </div>
      <div className="mobile-nav-spacer" />
    </>
  )
}

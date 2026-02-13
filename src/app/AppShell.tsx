import { AlertTriangle, X } from 'lucide-react'
import { useVaultAppActions, useVaultAppDerived, useVaultAppRefs, useVaultAppState } from './contexts/VaultAppContext'
import { DesktopTitlebar } from '../features/layout/components/DesktopTitlebar'
import { Topbar } from '../features/layout/components/Topbar'
import { SidebarPane } from '../features/nav/components/SidebarPane'
import { ItemListPane } from '../features/items/components/ItemListPane'
import { ItemDetailPane } from '../features/items/components/ItemDetailPane'
import { FolderContextMenu } from '../features/nav/components/FolderContextMenu'
import { TreeContextMenu } from '../features/nav/components/TreeContextMenu'
import { ItemContextMenu } from '../features/items/components/ItemContextMenu'
import { EditFolderModal } from '../features/folders/components/EditFolderModal'
import { SettingsModal } from '../features/settings/components/SettingsModal'
import { MobileNav } from '../features/layout/components/MobileNav'

export function AppShell() {
  const { effectivePlatform } = useVaultAppDerived()
  const { expiryAlerts, expiryAlertsDismissed } = useVaultAppState()
  const { importFileInputRef } = useVaultAppRefs()
  const { onImportFileSelected, dismissExpiryAlerts } = useVaultAppActions()

  const expiredCount = expiryAlerts.filter((a) => a.status === 'expired').length
  const expiringCount = expiryAlerts.filter((a) => a.status === 'expiring').length
  const showExpiryBar = expiryAlerts.length > 0 && !expiryAlertsDismissed

  return (
    <div className={`app-shell platform-${effectivePlatform}`}>
      <div className="shell-noise" aria-hidden="true" />
      <DesktopTitlebar />
      <Topbar />

      {showExpiryBar && (
        <div className="expiry-alert-bar">
          <AlertTriangle size={16} className="alert-icon" />
          <span className="alert-text">
            {expiredCount > 0 && <strong>{expiredCount} expired</strong>}
            {expiredCount > 0 && expiringCount > 0 && ', '}
            {expiringCount > 0 && `${expiringCount} expiring soon`}
          </span>
          <button className="alert-dismiss" onClick={dismissExpiryAlerts} title="Dismiss">
            <X size={14} />
          </button>
        </div>
      )}

      <main className="workspace density-compact">
        <SidebarPane />
        <ItemListPane />
        <ItemDetailPane />
      </main>

      <FolderContextMenu />
      <TreeContextMenu />
      <ItemContextMenu />
      <EditFolderModal />

      <MobileNav />

      <input
        ref={importFileInputRef}
        type="file"
        accept=".armadillo,application/octet-stream,application/json"
        style={{ display: 'none' }}
        onChange={(event) => void onImportFileSelected(event)}
      />

      <SettingsModal />
    </div>
  )
}

import { useVaultAppActions, useVaultAppDerived, useVaultAppRefs } from './contexts/VaultAppContext'
import { DesktopTitlebar } from '../features/layout/components/DesktopTitlebar'
import { Topbar } from '../features/layout/components/Topbar'
import { SidebarPane } from '../features/nav/components/SidebarPane'
import { ItemListPane } from '../features/items/components/ItemListPane'
import { ItemDetailPane } from '../features/items/components/ItemDetailPane'
import { FolderContextMenu } from '../features/nav/components/FolderContextMenu'
import { ItemContextMenu } from '../features/items/components/ItemContextMenu'
import { CreateFolderModal } from '../features/folders/components/CreateFolderModal'
import { EditFolderModal } from '../features/folders/components/EditFolderModal'
import { SettingsModal } from '../features/settings/components/SettingsModal'
import { MobileNav } from '../features/layout/components/MobileNav'

export function AppShell() {
  const { effectivePlatform } = useVaultAppDerived()
  const { importFileInputRef } = useVaultAppRefs()
  const { onImportFileSelected } = useVaultAppActions()

  return (
    <div className={`app-shell platform-${effectivePlatform}`}>
      <div className="shell-noise" aria-hidden="true" />
      <DesktopTitlebar />
      <Topbar />

      <main className="workspace density-compact">
        <SidebarPane />
        <ItemListPane />
        <ItemDetailPane />
      </main>

      <FolderContextMenu />
      <ItemContextMenu />
      <CreateFolderModal />
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

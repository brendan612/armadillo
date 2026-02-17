import { useRef, type TouchEvent } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { useVaultAppActions, useVaultAppDerived, useVaultAppRefs, useVaultAppState } from './contexts/VaultAppContext'
import { DesktopTitlebar } from '../features/layout/components/DesktopTitlebar'
import { Topbar } from '../features/layout/components/Topbar'
import { SidebarPane } from '../features/nav/components/SidebarPane'
import { ItemListPane } from '../features/items/components/ItemListPane'
import { ItemDetailPane } from '../features/items/components/ItemDetailPane'
import { HomePane } from '../features/home/components/HomePane'
import { StorageListPane } from '../features/storage/components/StorageListPane'
import { StorageDetailPane } from '../features/storage/components/StorageDetailPane'
import { FolderContextMenu } from '../features/nav/components/FolderContextMenu'
import { TreeContextMenu } from '../features/nav/components/TreeContextMenu'
import { ItemContextMenu } from '../features/items/components/ItemContextMenu'
import { StorageContextMenu } from '../features/storage/components/StorageContextMenu'
import { EditFolderModal } from '../features/folders/components/EditFolderModal'
import { SettingsPage } from '../features/settings/components/SettingsPage'
import { MobileNav } from '../features/layout/components/MobileNav'

const PULL_TO_REFRESH_THRESHOLD_PX = 88
const HORIZONTAL_DRAG_CANCEL_PX = 28

type PullRefreshGesture = {
  startX: number
  startY: number
  allow: boolean
  triggered: boolean
  scrollEl: HTMLElement | null
}

function findScrollableAncestor(target: EventTarget | null): HTMLElement | null {
  let current = target instanceof HTMLElement ? target : null
  while (current && current !== document.body) {
    const style = window.getComputedStyle(current)
    const canScrollY = style.overflowY === 'auto' || style.overflowY === 'scroll' || style.overflowY === 'overlay'
    if (canScrollY && current.scrollHeight > current.clientHeight) {
      return current
    }
    current = current.parentElement
  }
  return null
}

export function AppShell() {
  const { effectivePlatform } = useVaultAppDerived()
  const { expiryAlerts, expiryAlertsDismissed, syncState, selectedNode, workspaceSection, showSettings, appBuildInfo, updateCheckResult } = useVaultAppState()
  const { importFileInputRef, backupImportInputRef, googlePasswordImportInputRef, keepassImportInputRef } = useVaultAppRefs()
  const {
    onImportFileSelected,
    onBackupBundleSelected,
    onGooglePasswordCsvSelected,
    onKeePassCsvSelected,
    dismissExpiryAlerts,
    refreshVaultFromCloudNow,
    openSettings,
  } = useVaultAppActions()
  const pullRefreshRef = useRef<PullRefreshGesture | null>(null)

  const expiredCount = expiryAlerts.filter((a) => a.status === 'expired').length
  const expiringCount = expiryAlerts.filter((a) => a.status === 'expiring').length
  const showExpiryBar = expiryAlerts.length > 0 && !expiryAlertsDismissed
  const showHomePane = workspaceSection === 'passwords' && selectedNode === 'home'
  const showDetailPane = !showHomePane
  const updateRequired = appBuildInfo.channel === 'production' && updateCheckResult.status === 'required'

  function resetPullRefreshGesture() {
    pullRefreshRef.current = null
  }

  function handleWorkspaceTouchStart(event: TouchEvent<HTMLElement>) {
    if (effectivePlatform !== 'mobile' || syncState === 'syncing') return
    const touch = event.touches[0]
    if (!touch) return
    const scrollEl = findScrollableAncestor(event.target)
    const startsNearTop = touch.clientY <= (scrollEl?.getBoundingClientRect().top ?? 0) + 120
    const atTop = scrollEl ? scrollEl.scrollTop <= 0 : window.scrollY <= 0

    pullRefreshRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      allow: atTop && startsNearTop,
      triggered: false,
      scrollEl,
    }
  }

  function handleWorkspaceTouchMove(event: TouchEvent<HTMLElement>) {
    if (effectivePlatform !== 'mobile' || syncState === 'syncing') return
    const state = pullRefreshRef.current
    if (!state || !state.allow || state.triggered) return

    const touch = event.touches[0]
    if (!touch) return

    if (state.scrollEl && state.scrollEl.scrollTop > 0) {
      state.allow = false
      return
    }

    const deltaX = touch.clientX - state.startX
    const deltaY = touch.clientY - state.startY
    if (Math.abs(deltaX) > HORIZONTAL_DRAG_CANCEL_PX && Math.abs(deltaX) > Math.abs(deltaY)) {
      state.allow = false
      return
    }

    if (deltaY >= PULL_TO_REFRESH_THRESHOLD_PX) {
      state.triggered = true
      void refreshVaultFromCloudNow()
    }
  }

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

      {updateRequired ? (
        <section className="update-required-gate" aria-live="assertive">
          <div className="update-required-card">
            <AlertTriangle size={22} className="alert-icon" />
            <h2>Update required</h2>
            <p>{updateCheckResult.message}</p>
            <button className="solid" onClick={() => openSettings('general')}>
              Open Update Details
            </button>
          </div>
        </section>
      ) : !showSettings && (
        <main
          className={`workspace density-compact ${showHomePane ? 'workspace-home' : ''}`}
          onTouchStart={effectivePlatform === 'mobile' ? handleWorkspaceTouchStart : undefined}
          onTouchMove={effectivePlatform === 'mobile' ? handleWorkspaceTouchMove : undefined}
          onTouchEnd={effectivePlatform === 'mobile' ? resetPullRefreshGesture : undefined}
          onTouchCancel={effectivePlatform === 'mobile' ? resetPullRefreshGesture : undefined}
        >
          <SidebarPane />
          {showHomePane ? <HomePane /> : workspaceSection === 'storage' ? <StorageListPane /> : <ItemListPane />}
          {showDetailPane && (workspaceSection === 'storage' ? <StorageDetailPane /> : <ItemDetailPane />)}
        </main>
      )}
      <SettingsPage />

      <FolderContextMenu />
      <TreeContextMenu />
      <ItemContextMenu />
      <StorageContextMenu />
      <EditFolderModal />

      {!showSettings && !updateRequired && <MobileNav />}

      <input
        ref={importFileInputRef}
        type="file"
        accept=".armadillo,application/octet-stream,application/json"
        style={{ display: 'none' }}
        onChange={(event) => void onImportFileSelected(event)}
      />
      <input
        ref={backupImportInputRef}
        type="file"
        accept=".zip,.armadillo-backup.zip,application/zip"
        style={{ display: 'none' }}
        onChange={(event) => void onBackupBundleSelected(event)}
      />
      <input
        ref={googlePasswordImportInputRef}
        type="file"
        accept=".csv,text/csv"
        style={{ display: 'none' }}
        onChange={(event) => void onGooglePasswordCsvSelected(event)}
      />
      <input
        ref={keepassImportInputRef}
        type="file"
        accept=".csv,.xml,text/csv,text/xml,application/xml"
        style={{ display: 'none' }}
        onChange={(event) => void onKeePassCsvSelected(event)}
      />
    </div>
  )
}

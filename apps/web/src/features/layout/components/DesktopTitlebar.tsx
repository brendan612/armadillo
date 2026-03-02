import { useVaultAppActions, useVaultAppDerived, useVaultAppState } from '../../../app/contexts/VaultAppContext'

export function DesktopTitlebar() {
  const { effectivePlatform, vaultTitle } = useVaultAppDerived()
  const { windowMaximized } = useVaultAppState()
  const { minimizeDesktopWindow, toggleMaximizeDesktopWindow, closeDesktopWindow } = useVaultAppActions()

  if (effectivePlatform !== 'desktop') {
    return null
  }

  return (
    <div className="desktop-titlebar">
      <div className="desktop-titlebar-left">Armadillo</div>
      <div className="desktop-titlebar-center">{vaultTitle}</div>
      <div className="desktop-window-controls">
        <button className="window-control" onClick={() => void minimizeDesktopWindow()} aria-label="Minimize" title="Minimize">
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path d="M1 5h8" />
          </svg>
        </button>
        <button
          className="window-control"
          onClick={() => void toggleMaximizeDesktopWindow()}
          aria-label={windowMaximized ? 'Restore' : 'Maximize'}
          title={windowMaximized ? 'Restore' : 'Maximize'}
        >
          {windowMaximized ? (
            <svg viewBox="0 0 10 10" aria-hidden="true">
              <path d="M2 4h4v4H2z" />
              <path d="M4 2h4v4" />
            </svg>
          ) : (
            <svg viewBox="0 0 10 10" aria-hidden="true">
              <rect x="2" y="2" width="6" height="6" />
            </svg>
          )}
        </button>
        <button className="window-control close" onClick={() => void closeDesktopWindow()} aria-label="Close" title="Close">
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2 2l6 6M8 2L2 8" />
          </svg>
        </button>
      </div>
    </div>
  )
}

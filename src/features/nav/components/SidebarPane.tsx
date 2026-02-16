import { FolderTree } from './FolderTree'
import { useVaultAppActions, useVaultAppDerived, useVaultAppState } from '../../../app/contexts/VaultAppContext'

export function SidebarPane() {
  const { items, trash, selectedNode, mobileStep } = useVaultAppState()
  const { expiredItems, expiringSoonItems } = useVaultAppDerived()
  const { setSelectedNode, setMobileStep, createSubfolder, setTreeContextMenu, openHome, openSmartView } = useVaultAppActions()

  function handleTreeContextMenu(event: React.MouseEvent) {
    // Only show tree context menu when clicking empty area (not on a folder node)
    const target = event.target as HTMLElement
    if (target.closest('.folder-tree-node')) return
    event.preventDefault()
    setTreeContextMenu({ x: event.clientX, y: event.clientY })
  }

  return (
    <aside className={`pane pane-left ${mobileStep === 'nav' ? 'mobile-active' : ''}`}>
      <div className="sidebar-header">
        <h2>Vault</h2>
        <span className="sidebar-count">{items.length} items</span>
      </div>

      <nav className="sidebar-nav">
        <button
          className={`sidebar-nav-item ${selectedNode === 'home' ? 'active' : ''}`}
          onClick={openHome}
        >
          <span>Home</span>
        </button>
        <button
          className={`sidebar-nav-item ${selectedNode === 'all' ? 'active' : ''}`}
          onClick={() => {
            setSelectedNode('all')
            setMobileStep('list')
          }}
        >
          <span>All Items</span>
          <span className="sidebar-badge">{items.length}</span>
        </button>
        <button
          className={`sidebar-nav-item ${selectedNode === 'expiring' ? 'active' : ''}`}
          onClick={() => openSmartView('expiring')}
        >
          <span>Expiring Soon</span>
          <span className="sidebar-badge">{expiringSoonItems.length}</span>
        </button>
        <button
          className={`sidebar-nav-item ${selectedNode === 'expired' ? 'active' : ''}`}
          onClick={() => openSmartView('expired')}
        >
          <span>Expired</span>
          <span className="sidebar-badge">{expiredItems.length}</span>
        </button>
        <button
          className={`sidebar-nav-item ${selectedNode === 'unfiled' ? 'active' : ''}`}
          onClick={() => {
            setSelectedNode('unfiled')
            setMobileStep('list')
          }}
        >
          <span>Unfiled</span>
          <span className="sidebar-badge">{items.filter((item) => !item.folderId).length}</span>
        </button>
        <button
          className={`sidebar-nav-item ${selectedNode === 'trash' ? 'active' : ''}`}
          onClick={() => {
            setSelectedNode('trash')
            setMobileStep('list')
          }}
        >
          <span>Trash</span>
          <span className="sidebar-badge">{trash.length}</span>
        </button>
        <button className="sidebar-nav-item" onClick={() => createSubfolder(null)}>
          <span>+ New Folder</span>
        </button>
      </nav>

      <div className="sidebar-section">
        <h3>Folders</h3>
        <div className="folder-tree" onContextMenu={handleTreeContextMenu}>
          <FolderTree parentId={null} />
        </div>
      </div>
    </aside>
  )
}

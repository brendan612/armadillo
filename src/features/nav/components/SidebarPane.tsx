import { FolderTree } from './FolderTree'
import { useVaultAppActions, useVaultAppState } from '../../../app/contexts/VaultAppContext'

export function SidebarPane() {
  const { items, trash, selectedNode, mobileStep } = useVaultAppState()
  const { setSelectedNode, setMobileStep, createSubfolder } = useVaultAppActions()

  return (
    <aside className={`pane pane-left ${mobileStep === 'nav' ? 'mobile-active' : ''}`}>
      <div className="sidebar-header">
        <h2>Vault</h2>
        <span className="sidebar-count">{items.length} items</span>
      </div>

      <nav className="sidebar-nav">
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
        <div className="folder-tree mt-5"><FolderTree parentId={null} /></div>
      </div>
    </aside>
  )
}

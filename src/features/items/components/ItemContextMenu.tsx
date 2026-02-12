import { useVaultAppActions, useVaultAppState } from '../../../app/contexts/VaultAppContext'

export function ItemContextMenu() {
  const { itemContextMenu, items } = useVaultAppState()
  const { setSelectedId, setMobileStep, setItemContextMenu, duplicateItem, copyToClipboard, autofillItem, removeItemById } = useVaultAppActions()

  if (!itemContextMenu) return null

  return (
    <div
      className="folder-context-menu item-context-menu"
      style={{ left: itemContextMenu.x, top: itemContextMenu.y }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        className="ghost"
        onClick={() => {
          setSelectedId(itemContextMenu.itemId)
          setMobileStep('detail')
          setItemContextMenu(null)
        }}
      >
        Open Item
      </button>
      <button className="ghost" onClick={() => void duplicateItem(itemContextMenu.itemId)}>Duplicate</button>
      <button
        className="ghost"
        onClick={() => {
          const item = items.find((row) => row.id === itemContextMenu.itemId)
          if (item?.username) {
            void copyToClipboard(item.username, 'Username copied to clipboard', 'Clipboard copy failed')
          }
          setItemContextMenu(null)
        }}
      >
        Copy Username
      </button>
      <button
        className="ghost"
        onClick={() => {
          const item = items.find((row) => row.id === itemContextMenu.itemId)
          if (item?.passwordMasked) {
            void copyToClipboard(item.passwordMasked, 'Password copied to clipboard', 'Clipboard copy failed')
          }
          setItemContextMenu(null)
        }}
      >
        Copy Password
      </button>
      <button
        className="ghost"
        onClick={() => {
          const item = items.find((row) => row.id === itemContextMenu.itemId)
          if (item) {
            void autofillItem(item)
          }
          setItemContextMenu(null)
        }}
      >
        Autofill Previous App
      </button>
      <button className="ghost" onClick={() => void removeItemById(itemContextMenu.itemId)}>Delete Item</button>
    </div>
  )
}

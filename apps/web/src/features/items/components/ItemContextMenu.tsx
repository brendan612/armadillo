import { useEffect, useRef } from 'react'
import {
  Cloud,
  CloudOff,
  ExternalLink,
  KeyRound,
  ShieldCheck,
  UserRound,
  ClipboardPaste,
  CopyPlus,
  Trash2,
} from 'lucide-react'
import { useVaultAppActions, useVaultAppDerived, useVaultAppState } from '../../../app/contexts/VaultAppContext'
import { getCredentialKindMeta, isPasswordCredential } from '../../../shared/utils/credentialKinds'
import { formatShortcutLabel, matchShortcut } from '../../../shared/utils/keybinds'
import type { VaultCredentialKind, VaultItem } from '../../../types/vault'

export function ItemContextMenu() {
  const { itemContextMenu, items, syncProvider, vaultSettings } = useVaultAppState()
  const { hasCapability, canEditActiveVault } = useVaultAppDerived()
  const {
    setSelectedId,
    setMobileStep,
    setItemContextMenu,
    duplicateItem,
    changeItemCredentialKind,
    copyToClipboard,
    autofillItem,
    scanItemForBreach,
    removeItemById,
    setItemCloudSyncExcluded,
  } = useVaultAppActions()

  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!itemContextMenu || !menuRef.current) return
    const el = menuRef.current
    const rect = el.getBoundingClientRect()
    const pad = 8
    let x = itemContextMenu.x
    let y = itemContextMenu.y

    if (x + rect.width > window.innerWidth - pad) {
      x = window.innerWidth - rect.width - pad
    }
    if (y + rect.height > window.innerHeight - pad) {
      y = window.innerHeight - rect.height - pad
    }
    if (x < pad) x = pad
    if (y < pad) y = pad

    el.style.left = `${x}px`
    el.style.top = `${y}px`
    el.style.opacity = '1'
  }, [itemContextMenu])

  const itemId = itemContextMenu?.itemId ?? ''
  const item = items.find((row) => row.id === itemId)
  const kindMeta = item ? getCredentialKindMeta(item.credentialKind) : null
  const passwordEligible = item ? isPasswordCredential(item) : false
  const credentialKinds: VaultCredentialKind[] = ['password', 'pin', 'secret', 'number']
  const recategorizeOptions: VaultItem['credentialKind'][] = item
    ? credentialKinds.filter((kind) => kind !== item.credentialKind)
    : []
  const isLocalOnly = item?.excludeFromCloudSync === true
  const canManageCloudSyncExclusions = hasCapability('cloud.sync')
    && (syncProvider !== 'self_hosted' || hasCapability('enterprise.self_hosted'))

  function dismiss() {
    setItemContextMenu(null)
  }

  function copyUsernameFromMenu() {
    if (!item?.username) return
    void copyToClipboard(item.username, 'Username copied', 'Copy failed')
  }

  function copyPasswordFromMenu() {
    if (!item?.passwordMasked) return
    void copyToClipboard(item.passwordMasked, kindMeta?.copySuccessMessage || 'Secret copied', 'Copy failed', {
      clearAfterMs: (vaultSettings.clipboard?.passwordClearSeconds ?? 20) * 1000,
      sensitive: true,
    })
  }

  function autofillFromMenu() {
    if (!item) return
    void autofillItem(item)
  }

  useEffect(() => {
    if (!itemContextMenu) return
    function onKeyDown(event: KeyboardEvent) {
      if (matchShortcut(event, vaultSettings.keybinds?.copyUsername ?? null)) {
        event.preventDefault()
        if (item?.username) {
          void copyToClipboard(item.username, 'Username copied', 'Copy failed')
        }
        setItemContextMenu(null)
        return
      }
      if (matchShortcut(event, vaultSettings.keybinds?.copyPassword ?? null)) {
        event.preventDefault()
        if (item?.passwordMasked) {
          void copyToClipboard(item.passwordMasked, kindMeta?.copySuccessMessage || 'Secret copied', 'Copy failed', {
            clearAfterMs: (vaultSettings.clipboard?.passwordClearSeconds ?? 20) * 1000,
            sensitive: true,
          })
        }
        setItemContextMenu(null)
        return
      }
      if (matchShortcut(event, vaultSettings.keybinds?.autofillItem ?? null)) {
        event.preventDefault()
        if (item && passwordEligible) {
          void autofillItem(item)
        }
        setItemContextMenu(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [itemContextMenu, item, kindMeta?.copySuccessMessage, passwordEligible, copyToClipboard, autofillItem, setItemContextMenu, vaultSettings.clipboard?.passwordClearSeconds, vaultSettings.keybinds])

  if (!itemContextMenu) return null

  return (
    <div
      ref={menuRef}
      className="ctx-menu"
      style={{ left: itemContextMenu.x, top: itemContextMenu.y, opacity: 0 }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        className="ctx-menu-item"
        onClick={() => {
          setSelectedId(itemId)
          setMobileStep('detail')
          dismiss()
        }}
      >
        <ExternalLink className="ctx-menu-icon" />
        <span className="ctx-menu-label">Open Item</span>
      </button>

      <button
        className="ctx-menu-item"
        disabled={!canEditActiveVault}
        onClick={() => {
          void duplicateItem(itemId)
          dismiss()
        }}
      >
        <CopyPlus className="ctx-menu-icon" />
        <span className="ctx-menu-label">Duplicate</span>
      </button>

      <div className="ctx-menu-divider" />

      <button
        className="ctx-menu-item"
        onClick={() => {
          copyUsernameFromMenu()
          dismiss()
        }}
      >
        <UserRound className="ctx-menu-icon" />
        <span className="ctx-menu-label">Copy Username</span>
        <kbd className="ctx-menu-shortcut">{formatShortcutLabel(vaultSettings.keybinds?.copyUsername ?? null)}</kbd>
      </button>

      <button
        className="ctx-menu-item"
        onClick={() => {
          copyPasswordFromMenu()
          dismiss()
        }}
      >
        <KeyRound className="ctx-menu-icon" />
        <span className="ctx-menu-label">{kindMeta?.copyLabel || 'Copy Secret'}</span>
        <kbd className="ctx-menu-shortcut">{formatShortcutLabel(vaultSettings.keybinds?.copyPassword ?? null)}</kbd>
      </button>

      {passwordEligible && (
        <button
          className="ctx-menu-item"
          onClick={() => {
            autofillFromMenu()
            dismiss()
          }}
        >
          <ClipboardPaste className="ctx-menu-icon" />
          <span className="ctx-menu-label">Autofill</span>
          <kbd className="ctx-menu-shortcut">{formatShortcutLabel(vaultSettings.keybinds?.autofillItem ?? null)}</kbd>
        </button>
      )}

      {passwordEligible && (
        <button
          className="ctx-menu-item"
          onClick={() => {
            void scanItemForBreach(itemId)
            dismiss()
          }}
        >
          <ShieldCheck className="ctx-menu-icon" />
          <span className="ctx-menu-label">Scan for Breach</span>
        </button>
      )}

      {recategorizeOptions.length > 0 && (
        <>
          <div className="ctx-menu-divider" />
          {recategorizeOptions.map((kind) => (
            <button
              key={kind}
              className="ctx-menu-item"
              disabled={!canEditActiveVault}
              onClick={() => {
                void changeItemCredentialKind(itemId, kind)
                dismiss()
              }}
            >
              <KeyRound className="ctx-menu-icon" />
              <span className="ctx-menu-label">{`Convert to ${getCredentialKindMeta(kind).label}`}</span>
            </button>
          ))}
        </>
      )}

      {canManageCloudSyncExclusions && (
        <button
          className="ctx-menu-item"
          disabled={!canEditActiveVault}
          onClick={() => {
            void setItemCloudSyncExcluded(itemId, !isLocalOnly)
            dismiss()
          }}
        >
          {isLocalOnly ? <Cloud className="ctx-menu-icon" /> : <CloudOff className="ctx-menu-icon" />}
          <span className="ctx-menu-label">{isLocalOnly ? 'Include in Cloud Sync' : 'Exclude from Cloud Sync'}</span>
        </button>
      )}

      <div className="ctx-menu-divider" />

      <button
        className="ctx-menu-item danger"
        disabled={!canEditActiveVault}
        onClick={() => {
          if (window.confirm(`Move "${item?.title || 'this item'}" to trash?`)) {
            void removeItemById(itemId)
          }
          dismiss()
        }}
      >
        <Trash2 className="ctx-menu-icon" />
        <span className="ctx-menu-label">Delete Item</span>
      </button>
    </div>
  )
}

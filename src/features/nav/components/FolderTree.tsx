import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Folder } from 'lucide-react'
import type { VaultFolder } from '../../../types/vault'
import { useVaultAppActions, useVaultAppRefs, useVaultAppState } from '../../../app/contexts/VaultAppContext'

type FolderTreeProps = {
  parentId: string | null
}

type DropTarget = 'root' | `before:${string}` | `inside:${string}` | `after:${string}` | null

type DragState = {
  folderId: string
  x: number
  y: number
  target: DropTarget
}

function isTouchPointer() {
  return window.matchMedia('(pointer: coarse)').matches
}

export function FolderTree({ parentId }: FolderTreeProps) {
  const { items, folders, selectedNode, folderInlineEditor } = useVaultAppState()
  const { folderLongPressTimerRef } = useVaultAppRefs()
  const {
    getChildrenFolders,
    setSelectedNode,
    setMobileStep,
    setContextMenu,
    updateFolderInlineEditorValue,
    cancelFolderInlineEditor,
    commitFolderInlineEditor,
    moveFolder,
  } = useVaultAppActions()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [dragOverTarget, setDragOverTarget] = useState<DropTarget>(null)
  const [touchDrag, setTouchDrag] = useState<DragState | null>(null)
  const [pointerDrag, setPointerDrag] = useState<DragState | null>(null)
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set())
  const touchDragRef = useRef<DragState | null>(null)
  const pointerDragRef = useRef<DragState | null>(null)
  const pointerPendingRef = useRef<{ folderId: string; startX: number; startY: number } | null>(null)
  const suppressClickRef = useRef(false)
  const touching = useMemo(() => isTouchPointer(), [])
  const activeDrag = pointerDrag ?? touchDrag

  const inlineEditorKey = folderInlineEditor
    ? `${folderInlineEditor.mode}:${folderInlineEditor.mode === 'rename' ? folderInlineEditor.folderId : folderInlineEditor.parentId}`
    : null

  useEffect(() => {
    if (!inlineEditorKey) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [inlineEditorKey])

  function openMenuAtElement(folderId: string, element: HTMLElement) {
    const rect = element.getBoundingClientRect()
    setContextMenu({ folderId, x: rect.right, y: rect.bottom })
  }

  const resolveDropTarget = useCallback((clientX: number, clientY: number): DropTarget => {
    const element = document.elementFromPoint(clientX, clientY)
    if (!element) return null
    const lane = element.closest<HTMLElement>('[data-folder-drop-before-id]')
    if (lane) {
      const beforeId = lane.dataset.folderDropBeforeId
      if (beforeId) return `before:${beforeId}`
    }
    const row = element.closest<HTMLElement>('[data-folder-drop-id]')
    if (row) {
      const rowId = row.dataset.folderDropId
      if (!rowId) return null
      const rect = row.getBoundingClientRect()
      const ratio = (clientY - rect.top) / Math.max(rect.height, 1)
      if (ratio < 0.28) return `before:${rowId}`
      if (ratio > 0.72) return `after:${rowId}`
      return `inside:${rowId}`
    }
    const root = element.closest<HTMLElement>('[data-folder-drop-root]')
    if (root) {
      return 'root'
    }
    return null
  }, [])

  async function handleInlineEditorSubmit() {
    await commitFolderInlineEditor()
  }

  const dropFolder = useCallback(async (folderId: string | null, target: DropTarget) => {
    if (!folderId || !target) return
    const sourceFolder = folders.find((folder) => folder.id === folderId)
    if (!sourceFolder) return
    if (target === 'root') {
      const firstRoot = folders.find((f) => f.parentId === null && f.id !== folderId)
      await moveFolder(folderId, null, firstRoot?.id)
      return
    }
    if (target.startsWith('inside:')) {
      const parentId = target.slice('inside:'.length)
      if (!parentId || parentId === folderId) return
      await moveFolder(folderId, parentId)
      return
    }
    if (target.startsWith('before:')) {
      const beforeFolderId = target.slice('before:'.length)
      const beforeFolder = folders.find((folder) => folder.id === beforeFolderId)
      if (!beforeFolder) return
      await moveFolder(folderId, beforeFolder.parentId, beforeFolder.id)
      return
    }
    if (target.startsWith('after:')) {
      const afterFolderId = target.slice('after:'.length)
      const anchor = folders.find((folder) => folder.id === afterFolderId)
      if (!anchor || anchor.id === folderId) return
      const siblings = folders.filter((folder) => folder.parentId === anchor.parentId && folder.id !== folderId)
      const anchorIndex = siblings.findIndex((folder) => folder.id === anchor.id)
      if (anchorIndex < 0) return
      const nextSibling = siblings[anchorIndex + 1]
      await moveFolder(folderId, anchor.parentId, nextSibling?.id)
      return
    }
  }, [moveFolder, folders])

  function toggleCollapsed(folderId: string) {
    setCollapsedIds((prev) => {
      const next = new Set(prev)
      if (next.has(folderId)) {
        next.delete(folderId)
      } else {
        next.add(folderId)
      }
      return next
    })
  }

  useEffect(() => {
    touchDragRef.current = touchDrag
  }, [touchDrag])

  useEffect(() => {
    pointerDragRef.current = pointerDrag
  }, [pointerDrag])

  useEffect(() => {
    if (!activeDrag) {
      document.body.classList.remove('folder-dragging')
      return
    }
    document.body.classList.add('folder-dragging')
    return () => document.body.classList.remove('folder-dragging')
  }, [activeDrag])

  useEffect(() => {
    if (!touchDrag) return

    function handleTouchMove(event: TouchEvent) {
      const touch = event.touches[0]
      if (!touch) return
      event.preventDefault()
      const nextTarget = resolveDropTarget(touch.clientX, touch.clientY)
      setDragOverTarget(nextTarget)
      setTouchDrag((prev) => (prev
        ? {
            ...prev,
            x: touch.clientX,
            y: touch.clientY,
            target: nextTarget,
          }
        : prev))
    }

    function handleTouchEnd() {
      const latest = touchDragRef.current
      setTouchDrag(null)
      setDragOverTarget(null)
      if (!latest) return
      void dropFolder(latest.folderId, latest.target)
    }

    function handleTouchCancel() {
      setTouchDrag(null)
      setDragOverTarget(null)
    }

    window.addEventListener('touchmove', handleTouchMove, { passive: false })
    window.addEventListener('touchend', handleTouchEnd)
    window.addEventListener('touchcancel', handleTouchCancel)
    return () => {
      window.removeEventListener('touchmove', handleTouchMove)
      window.removeEventListener('touchend', handleTouchEnd)
      window.removeEventListener('touchcancel', handleTouchCancel)
    }
  }, [dropFolder, resolveDropTarget, touchDrag])

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      if (event.pointerType !== 'mouse') return
      const active = pointerDragRef.current
      if (active) {
        event.preventDefault()
        const nextTarget = resolveDropTarget(event.clientX, event.clientY)
        setDragOverTarget(nextTarget)
        setPointerDrag({
          ...active,
          x: event.clientX,
          y: event.clientY,
          target: nextTarget,
        })
        return
      }
      const pending = pointerPendingRef.current
      if (!pending) return
      const dx = event.clientX - pending.startX
      const dy = event.clientY - pending.startY
      if (Math.hypot(dx, dy) < 4) return
      event.preventDefault()
      suppressClickRef.current = true
      const nextTarget = resolveDropTarget(event.clientX, event.clientY)
      setDragOverTarget(nextTarget)
      setPointerDrag({
        folderId: pending.folderId,
        x: event.clientX,
        y: event.clientY,
        target: nextTarget,
      })
    }

    function handlePointerUp(event: PointerEvent) {
      if (event.pointerType !== 'mouse') return
      pointerPendingRef.current = null
      const latest = pointerDragRef.current
      setPointerDrag(null)
      setDragOverTarget(null)
      if (!latest) return
      void dropFolder(latest.folderId, latest.target)
    }

    function handlePointerCancel(event: PointerEvent) {
      if (event.pointerType !== 'mouse') return
      pointerPendingRef.current = null
      setPointerDrag(null)
      setDragOverTarget(null)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerCancel)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerCancel)
    }
  }, [dropFolder, resolveDropTarget])

  function renderNodes(nextParentId: string | null, depth: number) {
    const rows = getChildrenFolders(nextParentId)
    const showingInlineCreate = folderInlineEditor?.mode === 'create' && folderInlineEditor.parentId === nextParentId
    const dragSourceId = activeDrag?.folderId ?? null

    if (rows.length === 0 && !showingInlineCreate) return null

    return (
      <ul className="folder-tree-list">
        {rows.map((folder: VaultFolder) => {
          const nodeKey = `folder:${folder.id}` as const
          const childCount = getChildrenFolders(folder.id).length
          const isCollapsed = collapsedIds.has(folder.id)
          const directCount = items.filter((item) => item.folderId === folder.id).length
          const isEditing = folderInlineEditor?.mode === 'rename' && folderInlineEditor.folderId === folder.id
          const isDragOverInside = dragOverTarget === `inside:${folder.id}`
          const isDragOverAfter = dragOverTarget === `after:${folder.id}`
          const isDragging = dragSourceId === folder.id
          const showTouchMenu = touching && !activeDrag

          return (
            <li key={folder.id}>
              {dragSourceId && dragSourceId !== folder.id && (
                <div
                  className={`folder-drop-insert-lane ${dragOverTarget === `before:${folder.id}` ? 'drop-target' : ''}`}
                  data-folder-drop-before-id={folder.id}
                />
              )}
              <div
                className={`folder-tree-node-wrap ${isDragOverInside ? 'drop-target drop-target-inside' : ''} ${isDragging ? 'dragging' : ''}`}
                data-folder-drop-id={folder.id}
              >
                <div
                  className={`folder-tree-node ${selectedNode === nodeKey ? 'active' : ''}`}
                  style={{ paddingLeft: `${0.55 + depth * 0.7}rem`, paddingRight: showTouchMenu ? '2rem' : undefined }}
                  role="button"
                  tabIndex={0}
                  onClick={(event) => {
                    if (isEditing) return
                    if (suppressClickRef.current) {
                      suppressClickRef.current = false
                      return
                    }
                    if (event.target instanceof HTMLElement && event.target.closest('input,textarea')) return
                    setSelectedNode(nodeKey)
                    setMobileStep('list')
                  }}
                  onDoubleClick={(event) => {
                    if (isEditing || childCount === 0) return
                    if (event.target instanceof HTMLElement && event.target.closest('input,textarea,button')) return
                    toggleCollapsed(folder.id)
                  }}
                  onKeyDown={(event) => {
                    if (isEditing) return
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      setSelectedNode(nodeKey)
                      setMobileStep('list')
                    }
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    setContextMenu({ folderId: folder.id, x: event.clientX, y: event.clientY })
                  }}
                  onTouchStart={(event) => {
                    if (folderLongPressTimerRef.current) {
                      window.clearTimeout(folderLongPressTimerRef.current)
                    }
                    const touch = event.touches[0]
                    folderLongPressTimerRef.current = window.setTimeout(() => {
                      setTouchDrag({
                        folderId: folder.id,
                        x: touch.clientX,
                        y: touch.clientY,
                        target: resolveDropTarget(touch.clientX, touch.clientY),
                      })
                      setDragOverTarget(resolveDropTarget(touch.clientX, touch.clientY))
                    }, 420)
                  }}
                  onTouchEnd={() => {
                    if (folderLongPressTimerRef.current) {
                      window.clearTimeout(folderLongPressTimerRef.current)
                      folderLongPressTimerRef.current = null
                    }
                  }}
                  onTouchCancel={() => {
                    if (folderLongPressTimerRef.current) {
                      window.clearTimeout(folderLongPressTimerRef.current)
                      folderLongPressTimerRef.current = null
                    }
                  }}
                  onPointerDown={(event) => {
                    if (event.pointerType !== 'mouse' || event.button !== 0 || isEditing) return
                    if (event.target instanceof HTMLElement && event.target.closest('button,input,textarea')) return
                    pointerPendingRef.current = {
                      folderId: folder.id,
                      startX: event.clientX,
                      startY: event.clientY,
                    }
                    suppressClickRef.current = false
                  }}
                >
                  <span className="folder-tree-label">
                    <button
                      className={`folder-tree-collapse-btn ${childCount === 0 ? 'no-children' : ''}`}
                      onClick={(event) => {
                        event.stopPropagation()
                        if (childCount > 0) {
                          toggleCollapsed(folder.id)
                        }
                      }}
                      title={childCount > 0 ? (isCollapsed ? 'Expand folder' : 'Collapse folder') : 'No subfolders'}
                    >
                      {childCount > 0 ? (isCollapsed ? '>' : 'v') : ' '}
                    </button>
                    {folder.icon === 'folder' ? <Folder size={13} strokeWidth={1.9} className="folder-tree-icon" style={{ color: folder.color }} /> : folder.icon}
                    {' '}
                    {isEditing ? (
                      <input
                        ref={inputRef}
                        className="folder-tree-inline-input"
                        value={folderInlineEditor.value}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => updateFolderInlineEditorValue(event.target.value)}
                        onBlur={() => void handleInlineEditorSubmit()}
                        onKeyDown={(event) => {
                          event.stopPropagation()
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            void handleInlineEditorSubmit()
                          }
                          if (event.key === 'Escape') {
                            event.preventDefault()
                            cancelFolderInlineEditor()
                          }
                        }}
                      />
                    ) : (
                      folder.name
                    )}
                  </span>
                  <span className="folder-tree-count">{directCount}</span>
                </div>
                {showTouchMenu && (
                  <button
                    className="folder-tree-menu-btn"
                    onClick={(event) => {
                      event.stopPropagation()
                      openMenuAtElement(folder.id, event.currentTarget)
                    }}
                  >
                    ...
                  </button>
                )}
                {isDragOverAfter && !isDragging && (
                  <div className="folder-drop-placeholder" />
                )}
                {isDragOverInside && !isDragging && <div className="folder-drop-inside-ring" />}
              </div>
              {!isCollapsed && renderNodes(folder.id, depth + 1)}
            </li>
          )
        })}
        {showingInlineCreate && (
          <li key={`create:${nextParentId ?? 'root'}`}>
            <div className="folder-tree-node-wrap draft-node">
              <div
                className="folder-tree-node"
                style={{ paddingLeft: `${0.55 + depth * 0.7}rem` }}
              >
                <span className="folder-tree-label">
                  <span className="folder-tree-collapse-btn no-children" aria-hidden="true"> </span>
                  <Folder size={13} strokeWidth={1.9} className="folder-tree-icon" />
                  {' '}
                  <input
                    ref={inputRef}
                    className="folder-tree-inline-input"
                    value={folderInlineEditor.value}
                    onChange={(event) => updateFolderInlineEditorValue(event.target.value)}
                    onBlur={() => void handleInlineEditorSubmit()}
                    onKeyDown={(event) => {
                      event.stopPropagation()
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        void handleInlineEditorSubmit()
                      }
                      if (event.key === 'Escape') {
                        event.preventDefault()
                        cancelFolderInlineEditor()
                      }
                    }}
                  />
                </span>
              </div>
            </div>
          </li>
        )}
      </ul>
    )
  }

  const draggingActive = Boolean(activeDrag)
  const rootDropActive = dragOverTarget === 'root'
  const dragPreview = activeDrag
  const dragPreviewFolder = dragPreview ? folders.find((folder) => folder.id === dragPreview.folderId) : null

  return (
    <div className="folder-tree-root">
      <div
        className={`folder-tree-root-drop-lane ${draggingActive ? 'visible' : ''} ${rootDropActive ? 'drop-target' : ''}`}
        data-folder-drop-root="true"
      >
      </div>
      {renderNodes(parentId, 0)}
      {dragPreview && createPortal(
        <div className="folder-tree-touch-preview" style={{ left: dragPreview.x + 2, top: dragPreview.y + 2 }}>
          <Folder size={13} strokeWidth={1.9} className="folder-tree-icon" />
          <span>{dragPreviewFolder?.name ?? 'Moving folder'}</span>
        </div>,
        document.body,
      )}
    </div>
  )
}

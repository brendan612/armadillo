import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, Download, Trash2, Upload } from 'lucide-react'
import type { StorageKind } from '../../../types/vault'
import { useVaultAppActions, useVaultAppDerived, useVaultAppState } from '../../../app/contexts/VaultAppContext'

const KIND_OPTIONS: Array<{ value: StorageKind; label: string }> = [
  { value: 'document', label: 'Document' },
  { value: 'image', label: 'Image' },
  { value: 'key', label: 'Key' },
  { value: 'token', label: 'Token' },
  { value: 'secret', label: 'Secret' },
  { value: 'other', label: 'Other' },
]

export function StorageDetailPane() {
  const {
    mobileStep,
    storageDraft,
    newStorageFolderValue,
    isSaving,
    storageFileBusy,
    syncProvider,
    workspaceSection,
  } = useVaultAppState()
  const { folderOptions, hasCapability } = useVaultAppDerived()
  const {
    closeOpenItem,
    setStorageDraftField,
    setNewStorageFolderValue,
    saveCurrentStorageItem,
    removeCurrentStorageItem,
    setMobileStep,
    attachFileToStorageDraft,
    downloadStorageFile,
    loadStorageBlobFile,
  } = useVaultAppActions()

  const [previewUrl, setPreviewUrl] = useState('')
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const canManageCloudSyncExclusions = hasCapability('cloud.sync')
    && (syncProvider !== 'self_hosted' || hasCapability('enterprise.self_hosted'))
  const hasUnsavedChanges = useMemo(() => Boolean(storageDraft), [storageDraft])

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  async function refreshPreview() {
    if (!storageDraft?.blobRef || storageDraft.kind !== 'image') return
    const loaded = await loadStorageBlobFile(storageDraft.id)
    if (!loaded) return
    const blob = new Blob([loaded.bytes], { type: loaded.mimeType || 'application/octet-stream' })
    const nextUrl = URL.createObjectURL(blob)
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current)
      return nextUrl
    })
  }

  return (
    <section className={`pane pane-right ${mobileStep === 'detail' ? 'mobile-active' : ''}`} hidden={workspaceSection !== 'storage'}>
      <div className="detail-head">
        <button className="mobile-back-btn" onClick={() => setMobileStep('list')}>
          <ChevronLeft size={16} strokeWidth={2.2} aria-hidden="true" />
          Storage
        </button>
        <div>
          <p className="kicker">Storage Detail</p>
          <h2>{storageDraft?.title ?? 'No item selected'}</h2>
        </div>
        <div className="detail-head-actions">
          {storageDraft && (
            <>
              <button className="solid detail-save-btn" onClick={() => void saveCurrentStorageItem()} disabled={isSaving}>
                {isSaving ? 'Saving...' : 'Save'}
              </button>
              <button className="ghost detail-delete-btn" onClick={() => void removeCurrentStorageItem()} disabled={isSaving} title="Delete item">
                <Trash2 size={14} /> Delete
              </button>
              <button className="ghost detail-close-btn" onClick={closeOpenItem} disabled={isSaving || (hasUnsavedChanges && storageFileBusy)} title="Close item">
                Close
              </button>
            </>
          )}
        </div>
      </div>

      {storageDraft && canManageCloudSyncExclusions && (
        <div className="detail-head-toggle">
          <label className="detail-toggle-row">
            <input
              type="checkbox"
              className="detail-toggle-input"
              checked={Boolean(storageDraft.excludeFromCloudSync)}
              onChange={(event) => setStorageDraftField('excludeFromCloudSync', event.target.checked)}
            />
            <span className="detail-toggle-control" aria-hidden="true">
              <span className="detail-toggle-thumb" />
            </span>
            <span className="detail-toggle-label">Exclude from Cloud Sync</span>
          </label>
        </div>
      )}

      {storageDraft && (
        <div className="detail-grid">
          <label>
            Title
            <input value={storageDraft.title} onChange={(event) => setStorageDraftField('title', event.target.value)} />
          </label>
          <label>
            Kind
            <select value={storageDraft.kind} onChange={(event) => setStorageDraftField('kind', event.target.value as StorageKind)}>
              {KIND_OPTIONS.map((row) => (
                <option key={row.value} value={row.value}>{row.label}</option>
              ))}
            </select>
          </label>
          <div className="compact-meta-row">
            <label>
              Folder
              <input
                list="storage-folder-options"
                value={newStorageFolderValue}
                onChange={(event) => {
                  setNewStorageFolderValue(event.target.value)
                  setStorageDraftField('folder', event.target.value)
                }}
                placeholder="Select or create folder path"
              />
              <datalist id="storage-folder-options">
                {folderOptions.map((option) => (
                  <option key={option.id} value={option.label} />
                ))}
              </datalist>
            </label>
          </div>
          <label>
            Tags (comma separated)
            <input
              value={storageDraft.tags.join(', ')}
              onChange={(event) =>
                setStorageDraftField(
                  'tags',
                  event.target.value
                    .split(',')
                    .map((tag) => tag.trim())
                    .filter(Boolean),
                )
              }
            />
          </label>
          <label>
            Notes
            <textarea value={storageDraft.note} onChange={(event) => setStorageDraftField('note', event.target.value)} rows={3} />
          </label>
          <label>
            Secret/Text Value
            <textarea
              value={storageDraft.textValue ?? ''}
              onChange={(event) => setStorageDraftField('textValue', event.target.value)}
              rows={4}
              placeholder="Paste private text, key material, or token payload"
            />
          </label>

          <div className="group-block">
            <h3>File Attachment</h3>
            {storageDraft.blobRef ? (
              <p className="muted" style={{ marginTop: 0 }}>
                {storageDraft.blobRef.fileName} ({Math.max(1, Math.round(storageDraft.blobRef.sizeBytes / 1024))} KB)
              </p>
            ) : (
              <p className="muted" style={{ marginTop: 0 }}>No file attached.</p>
            )}
            <div className="settings-action-list">
              <button
                className="ghost"
                disabled={storageFileBusy}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload size={14} /> {storageFileBusy ? 'Encrypting...' : 'Attach / Replace File'}
              </button>
              <button
                className="ghost"
                disabled={!storageDraft.blobRef}
                onClick={() => void downloadStorageFile(storageDraft.id)}
              >
                <Download size={14} /> Download File
              </button>
              {storageDraft.kind === 'image' && (
                <button className="ghost" disabled={!storageDraft.blobRef} onClick={() => void refreshPreview()}>
                  Preview Image
                </button>
              )}
            </div>
            {previewUrl && (
              <div className="group-block" style={{ marginTop: '0.65rem' }}>
                <img src={previewUrl} alt="Storage preview" style={{ maxWidth: '100%', borderRadius: '10px' }} />
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              style={{ display: 'none' }}
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) {
                  void attachFileToStorageDraft(file)
                }
                event.currentTarget.value = ''
              }}
            />
          </div>
        </div>
      )}
    </section>
  )
}

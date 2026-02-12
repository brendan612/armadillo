import { useState } from 'react'
import { Folder, X } from 'lucide-react'
import { useVaultAppActions, useVaultAppDerived, useVaultAppState } from '../../../app/contexts/VaultAppContext'

const PRESET_COLORS = [
  '#7f9cff', '#6366f1', '#8b5cf6', '#a855f7',
  '#d946ef', '#ec4899', '#f43f5e', '#ef4444',
  '#f97316', '#d4854a', '#eab308', '#84cc16',
  '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6',
  '#64748b', '#78716c',
]

const ICON_OPTIONS = [
  { value: 'folder', label: 'Default' },
  { value: '🔒', label: '🔒' },
  { value: '🏦', label: '🏦' },
  { value: '💳', label: '💳' },
  { value: '🌐', label: '🌐' },
  { value: '📧', label: '📧' },
  { value: '🛒', label: '🛒' },
  { value: '💼', label: '💼' },
  { value: '🎮', label: '🎮' },
  { value: '📱', label: '📱' },
  { value: '🏠', label: '🏠' },
  { value: '🔑', label: '🔑' },
  { value: '⭐', label: '⭐' },
  { value: '🗂️', label: '🗂️' },
  { value: '📁', label: '📁' },
  { value: '🛡️', label: '🛡️' },
  { value: '👤', label: '👤' },
  { value: '🏢', label: '🏢' },
  { value: '📚', label: '📚' },
  { value: '🔧', label: '🔧' },
]

export function EditFolderModal() {
  const { folderEditorOpen, folderEditor, folders } = useVaultAppState()
  const { folderPathById } = useVaultAppDerived()
  const { setFolderEditorOpen, setFolderEditor, saveFolderEditor } = useVaultAppActions()
  const [showCustomColor, setShowCustomColor] = useState(false)

  if (!folderEditorOpen || !folderEditor) return null

  const isPresetColor = PRESET_COLORS.includes(folderEditor.color)

  return (
    <div className="settings-overlay">
      <div className="settings-backdrop" onClick={() => setFolderEditorOpen(false)} />
      <div className="settings-panel">
        <div className="settings-header">
          <h2>Folder Properties</h2>
          <button className="icon-btn" onClick={() => setFolderEditorOpen(false)}>
            <X size={18} />
          </button>
        </div>
        <div className="settings-body">
          {/* Preview */}
          <div className="fp-preview">
            <span className="fp-preview-icon" style={{ color: folderEditor.color }}>
              {folderEditor.icon === 'folder' ? (
                <Folder size={28} fill={folderEditor.color} stroke={folderEditor.color} />
              ) : (
                <span className="fp-preview-emoji">{folderEditor.icon}</span>
              )}
            </span>
            <span className="fp-preview-name">{folderEditor.name || 'Untitled'}</span>
          </div>

          {/* Name */}
          <section className="settings-section">
            <h3>Name</h3>
            <input
              value={folderEditor.name}
              placeholder="Folder name"
              autoFocus
              onChange={(e) => setFolderEditor((prev) => (prev ? { ...prev, name: e.target.value } : prev))}
            />
          </section>

          {/* Location */}
          <section className="settings-section">
            <h3>Location</h3>
            <select
              value={folderEditor.parentId ?? ''}
              onChange={(e) =>
                setFolderEditor((prev) => (prev ? { ...prev, parentId: e.target.value || null } : prev))
              }
            >
              <option value="">(Root)</option>
              {folders
                .filter((f) => f.id !== folderEditor.id)
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {folderPathById.get(f.id) ?? f.name}
                  </option>
                ))}
            </select>
          </section>

          {/* Icon */}
          <section className="settings-section">
            <h3>Icon</h3>
            <div className="fp-icon-grid">
              {ICON_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  className={`fp-icon-option${folderEditor.icon === opt.value ? ' active' : ''}`}
                  onClick={() =>
                    setFolderEditor((prev) => (prev ? { ...prev, icon: opt.value } : prev))
                  }
                  title={opt.value === 'folder' ? 'Default folder' : opt.value}
                >
                  {opt.value === 'folder' ? (
                    <Folder size={16} />
                  ) : (
                    <span>{opt.label}</span>
                  )}
                </button>
              ))}
            </div>
          </section>

          {/* Color */}
          <section className="settings-section">
            <h3>Color</h3>
            <div className="fp-color-grid">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  className={`fp-color-swatch${folderEditor.color === c ? ' active' : ''}`}
                  style={{ background: c }}
                  onClick={() => {
                    setFolderEditor((prev) => (prev ? { ...prev, color: c } : prev))
                    setShowCustomColor(false)
                  }}
                />
              ))}
              <button
                className={`fp-color-swatch fp-color-custom${!isPresetColor || showCustomColor ? ' active' : ''}`}
                style={{
                  background: !isPresetColor ? folderEditor.color : undefined,
                }}
                onClick={() => setShowCustomColor((v) => !v)}
                title="Custom color"
              >
                {isPresetColor && !showCustomColor && '?'}
              </button>
            </div>
            {(showCustomColor || !isPresetColor) && (
              <div className="fp-custom-color-row">
                <input
                  type="color"
                  className="fp-color-input"
                  value={folderEditor.color}
                  onChange={(e) => setFolderEditor((prev) => (prev ? { ...prev, color: e.target.value } : prev))}
                />
                <span className="fp-color-hex">{folderEditor.color}</span>
              </div>
            )}
          </section>

          {/* Notes */}
          <section className="settings-section">
            <h3>Notes</h3>
            <textarea
              rows={3}
              placeholder="Optional notes about this folder..."
              value={folderEditor.notes}
              onChange={(e) => setFolderEditor((prev) => (prev ? { ...prev, notes: e.target.value } : prev))}
            />
          </section>

          {/* Actions */}
          <div className="fp-actions">
            <button className="solid" onClick={() => void saveFolderEditor()}>Save</button>
            <button className="ghost" onClick={() => setFolderEditorOpen(false)}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  )
}

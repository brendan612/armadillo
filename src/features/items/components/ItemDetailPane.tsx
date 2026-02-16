import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, Copy, Dices, Eye, EyeOff, RefreshCw, Save, X, Trash2 } from 'lucide-react'
import { generatePassword, DEFAULT_GENERATOR_CONFIG, type GeneratorConfig } from '../../../shared/utils/passwordGen'
import { getPasswordExpiryStatus } from '../../../shared/utils/passwordExpiry'
import type { VaultItem } from '../../../types/vault'
import { useVaultAppActions, useVaultAppDerived, useVaultAppState } from '../../../app/contexts/VaultAppContext'

function snapshotItemForDirtyCheck(item: VaultItem | null) {
  if (!item) return null
  return {
    id: item.id,
    title: item.title,
    username: item.username,
    passwordMasked: item.passwordMasked,
    urls: [...item.urls],
    folder: item.folder,
    folderId: item.folderId,
    tags: [...item.tags],
    risk: item.risk,
    updatedAt: item.updatedAt,
    note: item.note,
    securityQuestions: item.securityQuestions.map((entry) => ({
      question: entry.question,
      answer: entry.answer,
    })),
    passwordExpiryDate: item.passwordExpiryDate,
  }
}

export function ItemDetailPane() {
  const {
    mobileStep,
    draft,
    showPassword,
    newFolderValue,
    isSaving,
    vaultSettings,
  } = useVaultAppState()
  const { selected, folderOptions } = useVaultAppDerived()
  const {
    closeOpenItem,
    setDraftField,
    setShowPassword,
    copyPassword,
    setNewFolderValue,
    updateSecurityQuestion,
    saveCurrentItem,
    removeCurrentItem,
    setMobileStep,
    addGeneratorPreset,
    removeGeneratorPreset,
  } = useVaultAppActions()

  // Generator popover state
  const [showGenerator, setShowGenerator] = useState(false)
  const [genConfig, setGenConfig] = useState<GeneratorConfig>({ ...DEFAULT_GENERATOR_CONFIG })
  const [genPreview, setGenPreview] = useState(() => generatePassword(DEFAULT_GENERATOR_CONFIG))
  const [showGenEditor, setShowGenEditor] = useState(false)
  const [presetName, setPresetName] = useState('')
  const [showPresetSave, setShowPresetSave] = useState(false)
  const genPopoverRef = useRef<HTMLDivElement>(null)

  // Password confirm/save-error state keyed by item id to avoid effect-driven state resets.
  const [passwordConfirmById, setPasswordConfirmById] = useState<Record<string, string>>({})
  const [saveErrorById, setSaveErrorById] = useState<Record<string, string>>({})

  // Close popover on outside click
  useEffect(() => {
    if (!showGenerator) return
    function handlePointerDown(event: PointerEvent) {
      if (genPopoverRef.current && !genPopoverRef.current.contains(event.target as Node)) {
        setShowGenerator(false)
        setShowGenEditor(false)
        setShowPresetSave(false)
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [showGenerator])

  function regenerate(config: GeneratorConfig) {
    setGenPreview(generatePassword(config))
  }

  function updateConfig(patch: Partial<GeneratorConfig>) {
    const next = { ...genConfig, ...patch }
    setGenConfig(next)
    regenerate(next)
  }

  function applyGeneratedPassword(password: string) {
    if (draft) {
      setDraftField('passwordMasked', password)
      setPasswordConfirmById((current) => ({ ...current, [draft.id]: password }))
    }
    setShowGenerator(false)
    setShowGenEditor(false)
    setShowPresetSave(false)
  }

  function handleQuickGenerate(preset: { length: number; uppercase: boolean; lowercase: boolean; digits: boolean; symbols: boolean }) {
    const config: GeneratorConfig = {
      length: preset.length,
      uppercase: preset.uppercase,
      lowercase: preset.lowercase,
      digits: preset.digits,
      symbols: preset.symbols,
    }
    const password = generatePassword(config)
    applyGeneratedPassword(password)
  }

  async function handleSavePreset() {
    const name = presetName.trim()
    if (!name) return
    await addGeneratorPreset({
      id: crypto.randomUUID(),
      name,
      length: genConfig.length,
      uppercase: genConfig.uppercase,
      lowercase: genConfig.lowercase,
      digits: genConfig.digits,
      symbols: genConfig.symbols,
    })
    setPresetName('')
    setShowPresetSave(false)
  }

  async function handleSave() {
    if (draft) {
      setSaveErrorById((current) => ({ ...current, [draft.id]: '' }))
    }
    if (passwordConfirm && draft && passwordConfirm !== draft.passwordMasked) {
      setSaveErrorById((current) => ({ ...current, [draft.id]: 'Passwords do not match' }))
      return false
    }
    try {
      await saveCurrentItem()
      return true
    } catch {
      if (draft) {
        setSaveErrorById((current) => ({ ...current, [draft.id]: 'Failed to save item' }))
      }
      return false
    }
  }

  const passwordConfirm = draft ? (passwordConfirmById[draft.id] ?? draft.passwordMasked ?? '') : ''
  const saveError = draft ? (saveErrorById[draft.id] ?? '') : ''
  const passwordMismatch = passwordConfirm.length > 0 && draft && passwordConfirm !== draft.passwordMasked
  const expiryStatus = draft ? getPasswordExpiryStatus(draft.passwordExpiryDate, { expiringWithinDays: 7 }) : 'none'
  const passwordInputId = draft ? `item-password-${draft.id}` : 'item-password'
  const hasUnsavedChanges = useMemo(() => {
    if (!draft || !selected) return false
    return JSON.stringify(snapshotItemForDirtyCheck(draft)) !== JSON.stringify(snapshotItemForDirtyCheck(selected))
  }, [draft, selected])

  async function handleCloseWithUnsavedPrompt() {
    if (isSaving) return
    if (!hasUnsavedChanges) {
      closeOpenItem()
      return
    }

    const shouldSave = window.confirm(
      'You have unsaved changes.\nPress OK to save and close.\nPress Cancel to choose discard.',
    )
    if (shouldSave) {
      const saved = await handleSave()
      if (!saved) return
      closeOpenItem()
      return
    }

    const shouldDiscard = window.confirm('Discard unsaved changes and close this item?')
    if (shouldDiscard) {
      closeOpenItem()
    }
  }

  return (
    <section className={`pane pane-right ${mobileStep === 'detail' ? 'mobile-active' : ''}`}>
      <div className="detail-head">
        <button className="mobile-back-btn" onClick={() => setMobileStep('list')}>
          <ChevronLeft size={16} strokeWidth={2.2} aria-hidden="true" />
          Vault
        </button>
        <div>
          <p className="kicker">Credential Detail</p>
          <h2>{selected?.title ?? 'No item selected'}</h2>
        </div>
        <div className="detail-head-actions">
          {selected && (
            <>
              <button className="solid detail-save-btn" onClick={() => void handleSave()} disabled={isSaving}>
                {isSaving ? 'Saving...' : 'Save'}
              </button>
              <button className="ghost detail-delete-btn" onClick={() => void removeCurrentItem()} disabled={isSaving} title="Delete item">
                <Trash2 size={14} /> Delete
              </button>
              <button className="ghost detail-close-btn" onClick={() => void handleCloseWithUnsavedPrompt()} disabled={isSaving} title="Close item">
                Close
              </button>
            </>
          )}
        </div>
      </div>

      {draft && (
        <div className="detail-grid">
          <label>
            Title
            <input value={draft.title} onChange={(event) => setDraftField('title', event.target.value)} />
          </label>
          <label>
            Username
            <input value={draft.username} onChange={(event) => setDraftField('username', event.target.value)} />
          </label>

          {/* Password + Generator */}
          <div className="detail-field">
            <label htmlFor={passwordInputId}>Password</label>
            <div className="inline-field">
              <input
                id={passwordInputId}
                type={showPassword ? 'text' : 'password'}
                value={draft.passwordMasked}
                onChange={(event) => setDraftField('passwordMasked', event.target.value)}
              />
              <div className="inline-field-actions">
                <button
                  className="inline-icon-btn"
                  type="button"
                  title={showPassword ? 'Hide password' : 'Reveal password'}
                  onClick={() => setShowPassword((current) => !current)}
                >
                  {showPassword ? <EyeOff size={15} strokeWidth={2} /> : <Eye size={15} strokeWidth={2} />}
                </button>
                <button className="inline-icon-btn" type="button" title="Copy password" onClick={() => void copyPassword()}>
                  <Copy size={15} strokeWidth={2} />
                </button>
                <div className="gen-popover-anchor" ref={genPopoverRef}>
                  <button
                    className="inline-icon-btn"
                    type="button"
                    title="Generate password"
                    onClick={() => {
                      setShowGenerator((prev) => !prev)
                      if (!showGenerator) {
                        regenerate(genConfig)
                        setShowGenEditor(false)
                        setShowPresetSave(false)
                      }
                    }}
                  >
                    <Dices size={15} strokeWidth={2} />
                  </button>

                {showGenerator && (
                  <div className="gen-popover">
                    <h4>Password Generator</h4>

                    {/* Presets */}
                    {vaultSettings.generatorPresets.length > 0 && (
                      <>
                        <div className="gen-preset-list">
                          {vaultSettings.generatorPresets.map((preset) => (
                            <div key={preset.id} className="gen-preset-item">
                              <div style={{ flex: 1, cursor: 'pointer' }} onClick={() => handleQuickGenerate(preset)}>
                                <span className="gen-preset-name">{preset.name}</span>
                                <span className="gen-preset-meta">
                                  {' '}{preset.length}ch
                                  {preset.uppercase ? ' A-Z' : ''}
                                  {preset.lowercase ? ' a-z' : ''}
                                  {preset.digits ? ' 0-9' : ''}
                                  {preset.symbols ? ' !@#' : ''}
                                </span>
                              </div>
                              <button
                                className="gen-preset-delete"
                                title="Delete preset"
                                onClick={(e) => { e.stopPropagation(); void removeGeneratorPreset(preset.id) }}
                              >
                                <X size={12} />
                              </button>
                            </div>
                          ))}
                        </div>
                        <div className="gen-popover-divider" />
                      </>
                    )}

                    {/* Toggle editor */}
                    {!showGenEditor ? (
                      <button className="ghost" onClick={() => { setShowGenEditor(true); regenerate(genConfig) }}>
                        Custom Generator
                      </button>
                    ) : (
                      <div className="gen-config-panel">
                        <label>
                          Length: {genConfig.length}
                          <input
                            type="range"
                            min={8}
                            max={64}
                            value={genConfig.length}
                            onChange={(e) => updateConfig({ length: Number(e.target.value) })}
                          />
                        </label>

                        <div className="gen-toggles">
                          <label className={`gen-toggle ${genConfig.uppercase ? 'active' : ''}`}>
                            <input type="checkbox" checked={genConfig.uppercase} onChange={(e) => updateConfig({ uppercase: e.target.checked })} />
                            A-Z
                          </label>
                          <label className={`gen-toggle ${genConfig.lowercase ? 'active' : ''}`}>
                            <input type="checkbox" checked={genConfig.lowercase} onChange={(e) => updateConfig({ lowercase: e.target.checked })} />
                            a-z
                          </label>
                          <label className={`gen-toggle ${genConfig.digits ? 'active' : ''}`}>
                            <input type="checkbox" checked={genConfig.digits} onChange={(e) => updateConfig({ digits: e.target.checked })} />
                            0-9
                          </label>
                          <label className={`gen-toggle ${genConfig.symbols ? 'active' : ''}`}>
                            <input type="checkbox" checked={genConfig.symbols} onChange={(e) => updateConfig({ symbols: e.target.checked })} />
                            !@#$
                          </label>
                        </div>

                        <div className="gen-preview">{genPreview}</div>

                        <div className="gen-popover-actions">
                          <button className="ghost" onClick={() => regenerate(genConfig)}>
                            <RefreshCw size={13} /> Regenerate
                          </button>
                          <button className="solid" onClick={() => applyGeneratedPassword(genPreview)}>
                            Use Password
                          </button>
                        </div>

                        {!showPresetSave ? (
                          <button className="ghost" onClick={() => setShowPresetSave(true)}>
                            <Save size={13} /> Save as Preset
                          </button>
                        ) : (
                          <div className="gen-save-row">
                            <input
                              placeholder="Preset name"
                              value={presetName}
                              onChange={(e) => setPresetName(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') void handleSavePreset() }}
                              autoFocus
                            />
                            <button className="solid" onClick={() => void handleSavePreset()}>Save</button>
                            <button className="ghost" onClick={() => setShowPresetSave(false)}>Cancel</button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
                </div>
              </div>
            </div>
          </div>

          {/* Password Confirm */}
          <div className={`password-confirm-row ${passwordMismatch ? 'password-mismatch' : ''}`}>
            <label>
              Confirm Password
              <input
                type={showPassword ? 'text' : 'password'}
                value={passwordConfirm}
                onChange={(e) => {
                  if (!draft) return
                  const nextValue = e.target.value
                  setPasswordConfirmById((current) => ({ ...current, [draft.id]: nextValue }))
                  setSaveErrorById((current) => ({ ...current, [draft.id]: '' }))
                }}
                placeholder="Retype password to verify"
              />
            </label>
            {passwordMismatch && <span className="password-mismatch-msg">Passwords do not match</span>}
          </div>

          <label>
            URLs (one per line)
            <textarea
              value={draft.urls.join('\n')}
              onChange={(event) =>
                setDraftField(
                  'urls',
                  event.target.value.split(/\r?\n/),
                )
              }
              rows={3}
            />
          </label>
          <div className="compact-meta-row">
            <label>
              Folder
              <input
                list="folder-options"
                value={newFolderValue}
                onChange={(event) => {
                  setNewFolderValue(event.target.value)
                  setDraftField('folder', event.target.value)
                }}
                placeholder="Select or create folder path"
              />
              <datalist id="folder-options">
                {folderOptions.map((option) => (
                  <option key={option.id} value={option.label} />
                ))}
              </datalist>
            </label>
          </div>
          <label>
            Tags (comma separated)
            <input
              value={draft.tags.join(', ')}
              onChange={(event) =>
                setDraftField(
                  'tags',
                  event.target.value
                    .split(',')
                    .map((tag) => tag.trim())
                    .filter(Boolean),
                )
              }
            />
          </label>

          {/* Password Expiry Date */}
          <label>
            Password Expiry Date
            <div className="expiry-field">
              <input
                type="date"
                value={draft.passwordExpiryDate ?? ''}
                onChange={(e) => setDraftField('passwordExpiryDate', e.target.value || null)}
              />
              {draft.passwordExpiryDate && (
                <button
                  className="expiry-clear-btn"
                  title="Clear expiry date"
                  onClick={() => setDraftField('passwordExpiryDate', null)}
                >
                  <X size={14} />
                </button>
              )}
              {expiryStatus === 'expired' && <span className="expiry-badge expired">Expired</span>}
              {expiryStatus === 'expiring' && <span className="expiry-badge expiring-soon">Expiring Soon</span>}
            </div>
          </label>

          <label>
            Notes
            <textarea value={draft.note} onChange={(event) => setDraftField('note', event.target.value)} rows={3} />
          </label>

          <div className="group-block">
            <h3>Security Questions</h3>
            {draft.securityQuestions.length === 0 ? (
              <p className="muted">No security questions saved.</p>
            ) : (
              draft.securityQuestions.map((entry, index) => (
                <div key={`${entry.question}-${index}`} className="qa-row">
                  <input value={entry.question} onChange={(event) => updateSecurityQuestion(index, 'question', event.target.value)} />
                  <input type="password" value={entry.answer} onChange={(event) => updateSecurityQuestion(index, 'answer', event.target.value)} />
                </div>
              ))
            )}
            <button className="ghost" onClick={() => setDraftField('securityQuestions', [...draft.securityQuestions, { question: '', answer: '' }])}>
              + Add Security Question
            </button>
          </div>

          <div className="meta-strip">
            <span>Updated: {draft.updatedAt}</span>
          </div>

          {saveError && <p className="password-mismatch-msg">{saveError}</p>}
        </div>
      )}
    </section>
  )
}

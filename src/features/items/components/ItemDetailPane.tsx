import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, CircleHelp, Copy, Dices, Eye, EyeOff, RefreshCw, Save, X, Trash2 } from 'lucide-react'
import { generatePassword, DEFAULT_GENERATOR_CONFIG, type GeneratorConfig } from '../../../shared/utils/passwordGen'
import { getPasswordExpiryStatus } from '../../../shared/utils/passwordExpiry'
import { analyzePassword, buildPasswordStrengthContextFromItem } from '../../../shared/utils/passwordStrength'
import type { VaultItem } from '../../../types/vault'
import { useVaultAppActions, useVaultAppDerived, useVaultAppState } from '../../../app/contexts/VaultAppContext'

const GENERATOR_MIN_LENGTH = 8
const GENERATOR_MAX_LENGTH = 256

function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debouncedValue, setDebouncedValue] = useState(value)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedValue(value), delayMs)
    return () => window.clearTimeout(timer)
  }, [value, delayMs])

  return debouncedValue
}

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
    excludeFromCloudSync: item.excludeFromCloudSync === true,
  }
}

export function ItemDetailPane() {
  const {
    mobileStep,
    draft,
    items,
    showPassword,
    newFolderValue,
    isSaving,
    vaultSettings,
    syncProvider,
  } = useVaultAppState()
  const { selected, folderOptions, hasCapability } = useVaultAppDerived()
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
  const [genLengthInput, setGenLengthInput] = useState(() => String(DEFAULT_GENERATOR_CONFIG.length))
  const [showGenEditor, setShowGenEditor] = useState(false)
  const [presetName, setPresetName] = useState('')
  const [showPresetSave, setShowPresetSave] = useState(false)
  const genPopoverRef = useRef<HTMLDivElement>(null)
  const [showEntropyInfo, setShowEntropyInfo] = useState(false)
  const entropyInfoRef = useRef<HTMLDivElement>(null)

  // Password confirm/save-error state keyed by item id to avoid effect-driven state resets.
  const [passwordConfirmById, setPasswordConfirmById] = useState<Record<string, string>>({})
  const [saveErrorById, setSaveErrorById] = useState<Record<string, string>>({})

  // Close popover on outside click
  useEffect(() => {
    if (!showGenerator && !showEntropyInfo) return
    function handlePointerDown(event: PointerEvent) {
      if (showGenerator && genPopoverRef.current && !genPopoverRef.current.contains(event.target as Node)) {
        setShowGenerator(false)
        setShowGenEditor(false)
        setShowPresetSave(false)
      }
      if (showEntropyInfo && entropyInfoRef.current && !entropyInfoRef.current.contains(event.target as Node)) {
        setShowEntropyInfo(false)
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [showGenerator, showEntropyInfo])

  function regenerate(config: GeneratorConfig) {
    setGenPreview(generatePassword(config))
  }

  function updateConfig(patch: Partial<GeneratorConfig>) {
    const next = { ...genConfig, ...patch }
    setGenConfig(next)
    regenerate(next)
  }

  function clampGeneratorLength(value: number) {
    return Math.min(GENERATOR_MAX_LENGTH, Math.max(GENERATOR_MIN_LENGTH, value))
  }

  function updateLength(value: number) {
    if (!Number.isFinite(value)) return
    const next = clampGeneratorLength(Math.round(value))
    updateConfig({ length: next })
    setGenLengthInput(String(next))
  }

  function updateLengthFromInput(raw: string) {
    setGenLengthInput(raw)
    if (raw.trim() === '') return
    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) return
    const nextLength = Math.min(GENERATOR_MAX_LENGTH, Math.max(1, Math.round(parsed)))
    setGenConfig((current) => {
      const next = { ...current, length: nextLength }
      setGenPreview(generatePassword(next))
      return next
    })
  }

  function commitLengthInput() {
    const parsed = Number(genLengthInput)
    if (!Number.isFinite(parsed)) {
      setGenLengthInput(String(genConfig.length))
      return
    }
    updateLength(parsed)
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
  const passwordStrengthContext = useMemo(() => (
    draft ? buildPasswordStrengthContextFromItem(draft) : {}
  ), [draft])
  const debouncedPassword = useDebouncedValue(draft?.passwordMasked ?? '', 150)
  const passwordStrength = useMemo(() => (
    analyzePassword(debouncedPassword, passwordStrengthContext)
  ), [debouncedPassword, passwordStrengthContext])
  const reusedPasswordItems = useMemo(() => {
    if (!draft?.passwordMasked) return []
    return items.filter((item) => item.id !== draft.id && item.passwordMasked === draft.passwordMasked)
  }, [draft, items])
  const hasReusedPassword = reusedPasswordItems.length > 0
  const debouncedGeneratorPreview = useDebouncedValue(genPreview, 150)
  const generatorStrength = useMemo(() => (
    analyzePassword(debouncedGeneratorPreview, passwordStrengthContext)
  ), [debouncedGeneratorPreview, passwordStrengthContext])
  const weakFeedback = useMemo(() => (
    passwordStrength.score <= 2 ? passwordStrength.feedback.slice(0, 3) : []
  ), [passwordStrength])
  const canManageCloudSyncExclusions = hasCapability('cloud.sync')
    && (syncProvider !== 'self_hosted' || hasCapability('enterprise.self_hosted'))
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

      {draft && canManageCloudSyncExclusions && (
        <div className="detail-head-toggle">
          <label className="detail-toggle-row">
            <input
              type="checkbox"
              className="detail-toggle-input"
              checked={Boolean(draft.excludeFromCloudSync)}
              onChange={(event) => setDraftField('excludeFromCloudSync', event.target.checked)}
            />
            <span className="detail-toggle-control" aria-hidden="true">
              <span className="detail-toggle-thumb" />
            </span>
            <span className="detail-toggle-label">Exclude from Cloud Sync</span>
          </label>
        </div>
      )}

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
                        <div className="gen-length-row">
                          <span className="gen-length-title">Length</span>
                          <div className="gen-length-stepper">
                            <button type="button" className="gen-stepper-btn" onClick={() => updateLength(genConfig.length - 1)} disabled={genConfig.length <= GENERATOR_MIN_LENGTH} aria-label="Decrease length">&minus;</button>
                            <input
                              type="number"
                              className="gen-length-input"
                              min={GENERATOR_MIN_LENGTH}
                              max={GENERATOR_MAX_LENGTH}
                              step={1}
                              value={genLengthInput}
                              onChange={(e) => updateLengthFromInput(e.target.value)}
                              onBlur={commitLengthInput}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault()
                                  commitLengthInput()
                                }
                              }}
                            />
                            <button type="button" className="gen-stepper-btn" onClick={() => updateLength(genConfig.length + 1)} disabled={genConfig.length >= GENERATOR_MAX_LENGTH} aria-label="Increase length">+</button>
                          </div>
                        </div>
                        <input
                          type="range"
                          min={GENERATOR_MIN_LENGTH}
                          max={GENERATOR_MAX_LENGTH}
                          value={genConfig.length}
                          onChange={(e) => updateLength(Number(e.target.value))}
                        />

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
                        <div className={`gen-strength-hint ${generatorStrength.score <= 2 ? 'weak' : 'ok'}`}>
                          Preview strength: {generatorStrength.label} ({generatorStrength.entropyBits} bits)
                          {generatorStrength.score <= 2 ? `, est. crack time: ${generatorStrength.crackTimeDisplay}` : ''}
                        </div>

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
            <div className="password-strength-meter" aria-live="polite">
              <div className="password-strength-label-row">
                <span>Password strength</span>
                <div className="password-strength-meta">
                  <strong className={`password-strength-label ${passwordStrength.level}`}>
                    {passwordStrength.label} ({passwordStrength.entropyBits} bits)
                  </strong>
                  <div className="entropy-info-wrap" ref={entropyInfoRef}>
                    <button
                      type="button"
                      className="entropy-info-trigger"
                      aria-label="About entropy bits"
                      aria-expanded={showEntropyInfo}
                      onClick={() => setShowEntropyInfo((current) => !current)}
                    >
                      <CircleHelp size={13} strokeWidth={2.2} />
                    </button>
                    {showEntropyInfo && (
                      <div className="entropy-info-popover" role="dialog" aria-label="Entropy bits help">
                        <p>
                          Entropy bits estimate how hard a password is to guess. Higher bits means more possible combinations.
                        </p>
                        <p>
                          Each extra bit roughly doubles attacker work, so longer and more varied passwords are much stronger.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="password-strength-track" role="progressbar" aria-valuemin={0} aria-valuemax={4} aria-valuenow={passwordStrength.score}>
                <span className={`password-strength-fill ${passwordStrength.level}`} style={{ width: `${(passwordStrength.score / 4) * 100}%` }} />
              </div>
              {weakFeedback.length > 0 && (
                <ul className="password-strength-feedback">
                  {weakFeedback.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              )}
              {hasReusedPassword && (
                <p className="password-reuse-warning">
                  Password already used in {reusedPasswordItems.length} other {reusedPasswordItems.length === 1 ? 'item' : 'items'}.
                </p>
              )}
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
                <div key={`security-question-${index}`} className="qa-row">
                  <input
                    value={entry.question}
                    placeholder="Question"
                    onChange={(event) => updateSecurityQuestion(index, 'question', event.target.value)}
                  />
                  <input
                    type="password"
                    value={entry.answer}
                    placeholder="Answer"
                    onChange={(event) => updateSecurityQuestion(index, 'answer', event.target.value)}
                  />
                  <button
                    type="button"
                    className="qa-remove-btn"
                    title="Remove security question"
                    onClick={() => setDraftField('securityQuestions', draft.securityQuestions.filter((_, i) => i !== index))}
                  >
                    <X size={14} />
                  </button>
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

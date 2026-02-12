import { generatePassword } from '../../../shared/utils/passwordGen'
import { useVaultAppActions, useVaultAppDerived, useVaultAppState } from '../../../app/contexts/VaultAppContext'

export function ItemDetailPane() {
  const {
    activePanel,
    mobileStep,
    draft,
    showPassword,
    newCategoryValue,
    newFolderValue,
    isSaving,
    genLength,
    includeSymbols,
    excludeAmbiguous,
    generatedPreview,
  } = useVaultAppState()
  const { selected, categoryOptions, folderOptions } = useVaultAppDerived()
  const {
    setActivePanel,
    closeOpenItem,
    setDraftField,
    setShowPassword,
    copyPassword,
    setNewCategoryValue,
    setNewFolderValue,
    updateSecurityQuestion,
    saveCurrentItem,
    removeCurrentItem,
    setGenLength,
    setIncludeSymbols,
    setExcludeAmbiguous,
    setGeneratedPreview,
  } = useVaultAppActions()

  return (
    <section className={`pane pane-right ${mobileStep === 'detail' ? 'mobile-active' : ''}`}>
      <div className="detail-head">
        <div>
          <p className="kicker">Credential Detail</p>
          <h2>{selected?.title ?? 'No item selected'}</h2>
        </div>
        <div className="detail-head-actions">
          <div className="tab-row">
            <button className={activePanel === 'details' ? 'active' : ''} onClick={() => setActivePanel('details')}>Details</button>
            <button className={activePanel === 'generator' ? 'active' : ''} onClick={() => setActivePanel('generator')}>Generator</button>
          </div>
          {selected && (
            <button className="ghost detail-close-btn" onClick={closeOpenItem} title="Close item">
              Close
            </button>
          )}
        </div>
      </div>

      {activePanel === 'details' && draft && (
        <div className="detail-grid">
          <label>
            Title
            <input value={draft.title} onChange={(event) => setDraftField('title', event.target.value)} />
          </label>
          <label>
            Username
            <input value={draft.username} onChange={(event) => setDraftField('username', event.target.value)} />
          </label>
          <label>
            Password
            <div className="inline-field">
              <input
                type={showPassword ? 'text' : 'password'}
                value={draft.passwordMasked}
                onChange={(event) => setDraftField('passwordMasked', event.target.value)}
              />
              <button onClick={() => setShowPassword((current) => !current)}>{showPassword ? 'Hide' : 'Reveal'}</button>
              <button onClick={() => void copyPassword()}>Copy</button>
            </div>
          </label>
          <label>
            URLs (one per line)
            <textarea
              value={draft.urls.join('\n')}
              onChange={(event) =>
                setDraftField(
                  'urls',
                  event.target.value
                    .split('\n')
                    .map((line) => line.trim())
                    .filter(Boolean),
                )
              }
              rows={3}
            />
          </label>
          <div className="compact-meta-row">
            <label>
              Category
              <input
                list="category-options"
                value={newCategoryValue}
                onChange={(event) => {
                  setNewCategoryValue(event.target.value)
                  setDraftField('category', event.target.value)
                }}
                placeholder="Select or create category"
              />
              <datalist id="category-options">
                {categoryOptions.map((option) => (
                  <option key={option.id} value={option.label} />
                ))}
              </datalist>
            </label>
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

          <div className="save-row">
            <button className="solid" onClick={() => void saveCurrentItem()} disabled={isSaving}>{isSaving ? 'Saving...' : 'Save Item'}</button>
            <button className="ghost" onClick={() => void removeCurrentItem()} disabled={isSaving}>Delete Item</button>
          </div>
        </div>
      )}

      {activePanel === 'generator' && (
        <div className="generator-panel">
          <h3>Password Generator</h3>
          <p className="muted">Policy-aware generation with ambiguity controls.</p>
          <label>
            Length: {genLength}
            <input
              type="range"
              min={12}
              max={48}
              value={genLength}
              onChange={(event) => {
                const nextLength = Number(event.target.value)
                setGenLength(nextLength)
                setGeneratedPreview(generatePassword(nextLength, includeSymbols, excludeAmbiguous))
              }}
            />
          </label>
          <div className="switches">
            <label>
              <input
                type="checkbox"
                checked={includeSymbols}
                onChange={(event) => {
                  const next = event.target.checked
                  setIncludeSymbols(next)
                  setGeneratedPreview(generatePassword(genLength, next, excludeAmbiguous))
                }}
              />
              Include symbols
            </label>
            <label>
              <input
                type="checkbox"
                checked={excludeAmbiguous}
                onChange={(event) => {
                  const next = event.target.checked
                  setExcludeAmbiguous(next)
                  setGeneratedPreview(generatePassword(genLength, includeSymbols, next))
                }}
              />
              Exclude ambiguous chars
            </label>
          </div>
          <div className="preview">{generatedPreview}</div>
          <div className="gen-actions">
            <button
              className="ghost"
              onClick={() => {
                setGeneratedPreview(generatePassword(genLength, includeSymbols, excludeAmbiguous))
              }}
            >
              Regenerate
            </button>
            <button className="solid" onClick={() => { if (draft) { setDraftField('passwordMasked', generatedPreview); setActivePanel('details') } }}>
              Use Password
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

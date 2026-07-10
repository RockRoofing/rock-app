import { useState, useEffect } from 'react'
import OperationsShell from '../../components/AdminShell'
import { PageHeading } from '../../components/OperationsShell'
import { INK, GOLD, Loading, EmptyCard, Modal, Lbl, inp2, primaryBtn, ghostBtn, linkBtn } from '../../components/opsUI'

const CATEGORIES = [
  { id: 'project', label: 'Project Forms' },
  { id: 'company', label: 'Company Information' },
  { id: 'guidance', label: 'Operative Guidance' },
]

const FIELD_TYPES = [
  { id: 'section', label: 'Section heading' },
  { id: 'shorttext', label: 'Short text' },
  { id: 'longtext', label: 'Long text' },
  { id: 'date', label: 'Date' },
  { id: 'single', label: 'Single choice' },
  { id: 'multi', label: 'Multiple choice' },
  { id: 'yesno', label: 'Yes / No' },
  { id: 'photos', label: 'Photos' },
  { id: 'signature', label: 'Signature' },
  { id: 'note', label: 'Guidance note' },
]
const HAS_OPTIONS = ['single', 'multi']
const NEEDS_LABEL_ONLY = ['section', 'note']

export default function FormsBuilder() {
  const [forms, setForms] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)   // the form being edited (deep copy)
  const [saving, setSaving] = useState(false)

  useEffect(() => { load() }, [])
  async function load() {
    try { const r = await fetch('/api/forms'); const d = await r.json(); setForms(d.forms || []) } catch {}
    setLoading(false)
  }

  function newForm() {
    setEditing({ id: '', title: '', short: '', category: 'project', fields: [] })
  }
  async function reseed() {
    if (!confirm('Reset all forms to the latest built-in defaults? This replaces the current form set (any manual edits to forms will be lost).')) return
    try {
      const r = await fetch('/api/forms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reseed' }) })
      if (r.ok) load()
    } catch {}
  }
  function editForm(f) {
    setEditing(JSON.parse(JSON.stringify(f)))  // deep copy so cancel is safe
  }
  async function saveForm() {
    if (!editing.title.trim()) { alert('Give the form a title.'); return }
    setSaving(true)
    try {
      const r = await fetch('/api/forms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ form: editing }) })
      const d = await r.json()
      if (d.forms) setForms(d.forms)
      setEditing(null)
    } catch { alert('Could not save.') }
    setSaving(false)
  }
  async function deleteForm(id) {
    if (!confirm('Delete this form? It will disappear from the Forms App.')) return
    await fetch('/api/forms', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    load()
  }

  if (editing) {
    return <Editor form={editing} setForm={setEditing} onSave={saveForm} onCancel={() => setEditing(null)} saving={saving} />
  }

  return (
    <OperationsShell active="/operations/forms-builder" title="Form Builder">
      <PageHeading title="Form Builder" sub="Create and edit the forms operatives fill in the Forms App"
        action={<div style={{ display: 'flex', gap: 8 }}>
          <button onClick={reseed} style={ghostBtn}>Reset to latest defaults</button>
          <button onClick={newForm} style={primaryBtn}>+ New form</button>
        </div>} />
      {loading ? <Loading /> : !forms.length ? <EmptyCard title="No forms yet" body="Create your first form." /> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 14 }}>
          {forms.map(f => {
            const cat = CATEGORIES.find(c => c.id === f.category)
            const qCount = (f.fields || []).filter(x => !NEEDS_LABEL_ONLY.includes(x.type)).length
            return (
              <div key={f.id} style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, padding: 18 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: INK }}>{f.title}</div>
                  <span style={{ fontSize: 11, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 20, padding: '2px 8px', whiteSpace: 'nowrap' }}>{cat?.label || f.category}</span>
                </div>
                <div style={{ fontSize: 13, color: '#999', margin: '6px 0 12px' }}>{f.short}</div>
                <div style={{ fontSize: 12, color: '#bbb', marginBottom: 12 }}>{qCount} questions</div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button onClick={() => editForm(f)} style={linkBtn}>Edit</button>
                  <button onClick={() => deleteForm(f.id)} style={{ ...linkBtn, color: '#dc2626' }}>Delete</button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </OperationsShell>
  )
}

// ── Form editor ─────────────────────────────────────────────────────────────
function Editor({ form, setForm, onSave, onCancel, saving }) {
  const [fieldModal, setFieldModal] = useState(null)  // { index, field } or { index:-1, field } for new

  function update(patch) { setForm({ ...form, ...patch }) }
  function moveField(i, dir) {
    const fields = [...form.fields]
    const j = i + dir
    if (j < 0 || j >= fields.length) return
    ;[fields[i], fields[j]] = [fields[j], fields[i]]
    update({ fields })
  }
  function removeField(i) {
    if (!confirm('Remove this field?')) return
    update({ fields: form.fields.filter((_, idx) => idx !== i) })
  }
  function saveField(field, index) {
    const fields = [...form.fields]
    if (index === -1) fields.push(field)
    else fields[index] = field
    update({ fields })
    setFieldModal(null)
  }

  return (
    <OperationsShell active="/operations/forms-builder" title="Form Builder">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <button onClick={onCancel} style={{ background: 'transparent', border: 'none', color: '#888', fontSize: 14, cursor: 'pointer', padding: 0 }}>‹ All forms</button>
      </div>
      <PageHeading title={form.id ? 'Edit form' : 'New form'} />

      {/* Form meta */}
      <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, padding: 18, marginBottom: 18 }}>
        <Lbl>Form title</Lbl>
        <input value={form.title} onChange={e => update({ title: e.target.value })} style={inp2} placeholder="e.g. Daily Site Diary" />
        <Lbl>Short description</Lbl>
        <input value={form.short || ''} onChange={e => update({ short: e.target.value })} style={inp2} placeholder="One line shown under the form name" />
        <Lbl>Category</Lbl>
        <select value={form.category} onChange={e => update({ category: e.target.value })} style={inp2}>
          {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </div>

      {/* Fields */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: INK }}>Fields</div>
        <button onClick={() => setFieldModal({ index: -1, field: { id: 'f' + Date.now().toString(36), type: 'shorttext', label: '', required: false } })} style={primaryBtn}>+ Add field</button>
      </div>

      {!form.fields.length ? (
        <EmptyCard title="No fields yet" body="Add your first field or section heading." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {form.fields.map((f, i) => (
            <div key={f.id || i} style={{
              background: f.type === 'section' ? '#fffbeb' : '#fff',
              border: `1px solid ${f.type === 'section' ? '#fde68a' : '#ececec'}`,
              borderRadius: 10, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <button onClick={() => moveField(i, -1)} disabled={i === 0} style={arrowBtn(i === 0)}>▲</button>
                <button onClick={() => moveField(i, 1)} disabled={i === form.fields.length - 1} style={arrowBtn(i === form.fields.length - 1)}>▼</button>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, color: INK, fontWeight: f.type === 'section' ? 700 : 500 }}>
                  {f.label || <span style={{ color: '#c00' }}>(no label)</span>}
                  {f.required && <span style={{ color: '#dc2626', marginLeft: 4 }}>*</span>}
                </div>
                <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>
                  {FIELD_TYPES.find(t => t.id === f.type)?.label || f.type}
                  {HAS_OPTIONS.includes(f.type) && f.options ? ` · ${f.options.length} options` : ''}
                  {f.notifyOn ? ' · notifies office' : ''}
                </div>
              </div>
              <button onClick={() => setFieldModal({ index: i, field: JSON.parse(JSON.stringify(f)) })} style={linkBtn}>Edit</button>
              <button onClick={() => removeField(i)} style={{ ...linkBtn, color: '#dc2626' }}>Remove</button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 24 }}>
        <button onClick={onSave} disabled={saving} style={primaryBtn}>{saving ? 'Saving…' : 'Save form'}</button>
        <button onClick={onCancel} style={ghostBtn}>Cancel</button>
      </div>

      {fieldModal && <FieldEditor init={fieldModal.field} index={fieldModal.index} onSave={saveField} onClose={() => setFieldModal(null)} />}
    </OperationsShell>
  )
}

// ── Field editor modal ──────────────────────────────────────────────────────
function FieldEditor({ init, index, onSave, onClose }) {
  const [f, setF] = useState(init)
  const [optsText, setOptsText] = useState((init.options || []).join('\n'))

  function set(patch) { setF({ ...f, ...patch }) }
  function commit() {
    const out = { ...f }
    if (HAS_OPTIONS.includes(f.type)) {
      out.options = optsText.split('\n').map(s => s.trim()).filter(Boolean)
    } else {
      delete out.options
      delete out.notifyOn
    }
    if (NEEDS_LABEL_ONLY.includes(f.type)) { delete out.required; delete out.options; delete out.notifyOn }
    if (!out.id) out.id = 'f' + Date.now().toString(36)
    onSave(out, index)
  }

  const showOptions = HAS_OPTIONS.includes(f.type)
  const showRequired = !NEEDS_LABEL_ONLY.includes(f.type)

  return (
    <Modal onClose={onClose} title={index === -1 ? 'Add field' : 'Edit field'}>
      <Lbl>Field type</Lbl>
      <select value={f.type} onChange={e => set({ type: e.target.value })} style={inp2}>
        {FIELD_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
      </select>

      <Lbl>{f.type === 'section' ? 'Section title' : f.type === 'note' ? 'Note text' : 'Question / label'}</Lbl>
      {f.type === 'note'
        ? <textarea value={f.label} onChange={e => set({ label: e.target.value })} rows={3} style={{ ...inp2, resize: 'vertical' }} />
        : <input value={f.label} onChange={e => set({ label: e.target.value })} style={inp2} />}

      {f.type !== 'section' && f.type !== 'note' && (
        <>
          <Lbl>Help text (optional)</Lbl>
          <input value={f.help || ''} onChange={e => set({ help: e.target.value })} style={inp2} placeholder="Shown under the question" />
        </>
      )}

      {showOptions && (
        <>
          <Lbl>Options (one per line)</Lbl>
          <textarea value={optsText} onChange={e => setOptsText(e.target.value)} rows={5} style={{ ...inp2, resize: 'vertical' }} placeholder={'Yes\nNo'} />
          <Lbl>Notify office when this answer is chosen (optional)</Lbl>
          <select value={f.notifyOn || ''} onChange={e => set({ notifyOn: e.target.value || undefined })} style={inp2}>
            <option value="">Never</option>
            {optsText.split('\n').map(s => s.trim()).filter(Boolean).map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </>
      )}

      {showRequired && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, fontSize: 14 }}>
          <input type="checkbox" checked={!!f.required} onChange={e => set({ required: e.target.checked })} /> Required
        </label>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
        <button onClick={commit} style={primaryBtn}>{index === -1 ? 'Add field' : 'Save field'}</button>
        <button onClick={onClose} style={ghostBtn}>Cancel</button>
      </div>
    </Modal>
  )
}

const arrowBtn = (disabled) => ({ background: 'transparent', border: 'none', color: disabled ? '#ddd' : '#999', cursor: disabled ? 'default' : 'pointer', fontSize: 10, padding: 0, lineHeight: 1 })

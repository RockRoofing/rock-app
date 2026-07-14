import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'

const TEMPLATES = [
  { key: 'prestart', label: 'Pre-Start Meeting Minutes' },
  { key: 'ihm', label: 'Internal Handover Minutes' },
]
// Field types offered in the editor. (Structural types like team/attendees/files
// are preserved if present but not added by hand here to avoid breaking wiring.)
const ADDABLE_TYPES = [
  { v: 'qrow', label: 'Question (resolved + comments)' },
  { v: 'text', label: 'Short text' },
  { v: 'long', label: 'Long text' },
  { v: 'date', label: 'Date' },
  { v: 'note', label: 'Guidance note (read-only)' },
]

const uid = (p) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`

export default function TemplatesAdmin() {
  const router = useRouter()
  const [me, setMe] = useState(null)
  const [key, setKey] = useState(null)             // null = show card list
  const [sections, setSections] = useState([])
  const [original, setOriginal] = useState('[]')   // snapshot for dirty check
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [isCustom, setIsCustom] = useState(false)
  const [customFlags, setCustomFlags] = useState({}) // key -> isCustom for cards

  const dirty = JSON.stringify(sections) !== original

  useEffect(() => {
    fetch('/api/portal-auth?action=me').then(r => r.json()).then(d => {
      if (!d.user) { router.replace('/login'); return }
      if (d.user.role !== 'admin') { router.replace('/'); return }
      setMe(d.user)
    })
  }, [])

  // Load custom flags for the card list
  useEffect(() => {
    if (!me) return
    Promise.all(TEMPLATES.map(t => fetch(`/api/templates?key=${t.key}`).then(r => r.json()).then(d => [t.key, !!d.isCustom]).catch(() => [t.key, false])))
      .then(pairs => setCustomFlags(Object.fromEntries(pairs)))
  }, [me])

  async function openTemplate(k) {
    setLoading(true); setNotice(''); setKey(k)
    try {
      const r = await fetch(`/api/templates?key=${k}`); const d = await r.json()
      const secs = JSON.parse(JSON.stringify(d.sections || []))
      setSections(secs); setOriginal(JSON.stringify(secs)); setIsCustom(!!d.isCustom)
    } catch {}
    setLoading(false)
  }

  function backToList() {
    if (dirty && !confirm('You have unsaved changes. Leave without saving?')) return
    setKey(null); setSections([]); setOriginal('[]'); setNotice('')
  }

  function discard() {
    if (!confirm('Discard all unsaved changes and revert to the last saved version?')) return
    setSections(JSON.parse(original)); setNotice('')
  }

  async function save() {
    if (!confirm('Save this template? The previous version will be replaced and cannot be recovered. New forms will use this version. Are you sure?')) return
    setSaving(true); setNotice('')
    try {
      const r = await fetch('/api/templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, sections }) })
      const d = await r.json()
      if (r.ok) {
        setNotice('Template saved. This applies to new forms from now on.')
        setIsCustom(true); setOriginal(JSON.stringify(sections))
        setCustomFlags(f => ({ ...f, [key]: true }))
      } else setNotice(d.error || 'Save failed')
    } catch (e) { setNotice(e?.message || 'Save failed') }
    setSaving(false)
  }
  async function _unusedReset() {
    // We approximate by clearing: POST an empty marker isn't supported, so we reload from a fresh GET after deleting is not built.
    // Instead: just reload the current default sections by re-fetching (still returns custom). So we warn this needs redeploy-free reset:
    setNotice('To fully reset to default, contact your developer — or overwrite sections manually. (Reset endpoint can be added.)')
  }

  // ── mutators ──
  const upd = (next) => setSections(next)
  const moveSection = (i, dir) => {
    const j = i + dir; if (j < 0 || j >= sections.length) return
    const n = [...sections];[n[i], n[j]] = [n[j], n[i]]; upd(n)
  }
  const editSectionTitle = (i, title) => { const n = [...sections]; n[i] = { ...n[i], title }; upd(n) }
  const removeSection = (i) => { if (!confirm('Remove this whole section?')) return; upd(sections.filter((_, x) => x !== i)) }
  const addSection = () => upd([...sections, { id: uid('sec'), title: 'New Section', fields: [] }])

  const editField = (si, fi, patch) => {
    const n = [...sections]; const fields = [...n[si].fields]; fields[fi] = { ...fields[fi], ...patch }; n[si] = { ...n[si], fields }; upd(n)
  }
  const moveField = (si, fi, dir) => {
    const fields = [...sections[si].fields]; const j = fi + dir; if (j < 0 || j >= fields.length) return
    ;[fields[fi], fields[j]] = [fields[j], fields[fi]]; const n = [...sections]; n[si] = { ...n[si], fields }; upd(n)
  }
  const removeField = (si, fi) => { const n = [...sections]; n[si] = { ...n[si], fields: n[si].fields.filter((_, x) => x !== fi) }; upd(n) }
  const addField = (si) => { const n = [...sections]; n[si] = { ...n[si], fields: [...n[si].fields, { id: uid('f'), label: 'New question', type: 'qrow' }] }; upd(n) }

  if (!me) return null

  return (
    <>
      <Head><title>Rock Roofing — Admin Templates</title></Head>
      <div style={{ fontFamily: 'system-ui,-apple-system,sans-serif', minHeight: '100vh', background: '#fafaf9' }}>
        <div style={{ background: '#1a1a19', padding: '0 24px', height: 56, display: 'flex', alignItems: 'center', gap: 12 }}>
          <a href="/" style={{ color: '#888', fontSize: 13, textDecoration: 'none' }}>← Portal</a>
          <span style={{ color: '#3a3a38' }}>|</span>
          <span style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>Admin</span>
        </div>
        <div style={{ background: '#232321', padding: '0 24px', display: 'flex', gap: 4, height: 44, alignItems: 'center', overflowX: 'auto' }}>
          {[['Portal Users', '/admin'], ['Templates', '/admin/templates'], ['Form Builder', '/operations/forms-builder'], ['Site App Users', '/operations/users'], ['Documents', '/admin/documents'], ['App Improvements', '/admin/problem-reports']].map(([label, href]) => (
            <a key={href} href={href} style={{ fontSize: 13, textDecoration: 'none', padding: '8px 14px', whiteSpace: 'nowrap', color: href === '/admin/templates' ? '#fff' : '#bbb', fontWeight: href === '/admin/templates' ? 600 : 400, borderBottom: href === '/admin/templates' ? '2px solid #ca8a04' : '2px solid transparent' }}>{label}</a>
          ))}
        </div>

        <div style={{ maxWidth: 900, margin: '0 auto', padding: 24 }}>
          {!key ? (
            // ── Card list to choose a template ──
            <>
              <div style={{ marginBottom: 18 }}>
                <h1 style={{ margin: 0, fontSize: 22, color: '#1a1a19' }}>Templates</h1>
                <div style={{ color: '#999', fontSize: 13, marginTop: 2 }}>Edit the structure of company forms. Changes apply to <strong>new forms only</strong>.</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 16 }}>
                {TEMPLATES.map(t => (
                  <div key={t.key} onClick={() => openTemplate(t.key)} style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, padding: 20, cursor: 'pointer' }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = '#ca8a04'; e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.06)' }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = '#ececec'; e.currentTarget.style.boxShadow = 'none' }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#1a1a19' }}>{t.label}</div>
                    <div style={{ marginTop: 8 }}>
                      {customFlags[t.key]
                        ? <span style={{ fontSize: 11, background: '#fffbeb', color: '#92400e', border: '1px solid #fde68a', borderRadius: 20, padding: '2px 10px', fontWeight: 600 }}>Customised</span>
                        : <span style={{ fontSize: 11, background: '#f3f4f6', color: '#888', borderRadius: 20, padding: '2px 10px' }}>Default</span>}
                    </div>
                    <div style={{ marginTop: 14, color: '#ca8a04', fontSize: 13, fontWeight: 600 }}>Edit template →</div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            // ── Editor for the selected template ──
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <button onClick={backToList} style={{ background: 'none', border: 'none', color: '#888', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 4 }}>‹ All templates</button>
                  <h1 style={{ margin: 0, fontSize: 22, color: '#1a1a19' }}>{TEMPLATES.find(t => t.key === key)?.label}</h1>
                  <div style={{ color: '#999', fontSize: 13, marginTop: 2 }}>Changes apply to <strong>new forms only</strong>.</div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {dirty && <button onClick={discard} disabled={saving} style={ghost}>Discard changes</button>}
                  <button onClick={save} disabled={saving || !dirty} style={{ ...btn, opacity: (!dirty && !saving) ? 0.5 : 1 }}>{saving ? 'Saving…' : 'Save template'}</button>
                </div>
              </div>

              {isCustom && <div style={{ fontSize: 12, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 12px', marginBottom: 12 }}>This template has been customised from the built-in default.</div>}
              {dirty && <div style={{ fontSize: 12, color: '#3730a3', background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 8, padding: '8px 12px', marginBottom: 12 }}>You have unsaved changes.</div>}
              {notice && <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#065f46', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 14 }}>{notice}</div>}

              {loading ? <div style={{ color: '#999', padding: 30 }}>Loading…</div> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {sections.map((sec, si) => (
                <div key={sec.id || si} style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, padding: 16 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                    <input value={sec.title || ''} onChange={e => editSectionTitle(si, e.target.value)} style={{ ...inp, fontWeight: 700, flex: 1 }} />
                    <button onClick={() => moveSection(si, -1)} disabled={si === 0} style={iconBtn}>↑</button>
                    <button onClick={() => moveSection(si, 1)} disabled={si === sections.length - 1} style={iconBtn}>↓</button>
                    <button onClick={() => removeSection(si)} style={{ ...iconBtn, color: '#dc2626' }}>✕</button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 8 }}>
                    {(sec.fields || []).map((f, fi) => (
                      <div key={f.id || fi} style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 10, background: '#fcfcfb' }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                          <textarea value={f.label || ''} onChange={e => editField(si, fi, { label: e.target.value })} style={{ ...inp, flex: 1, minHeight: 38, fontFamily: 'inherit' }} />
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <button onClick={() => moveField(si, fi, -1)} disabled={fi === 0} style={iconBtn}>↑</button>
                            <button onClick={() => moveField(si, fi, 1)} disabled={fi === sec.fields.length - 1} style={iconBtn}>↓</button>
                            <button onClick={() => removeField(si, fi)} style={{ ...iconBtn, color: '#dc2626' }}>✕</button>
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          {ADDABLE_TYPES.some(t => t.v === f.type) ? (
                            <select value={f.type || 'qrow'} onChange={e => editField(si, fi, { type: e.target.value })} style={{ ...inp, width: 'auto', fontSize: 12 }}>
                              {ADDABLE_TYPES.map(t => <option key={t.v} value={t.v}>{t.label}</option>)}
                            </select>
                          ) : (
                            <span title="This is a special field wired to the app. Its type can't be changed here, but you can edit its label and reorder it." style={{ fontSize: 12, fontWeight: 600, color: '#3730a3', background: '#eef2ff', borderRadius: 20, padding: '4px 12px' }}>
                              {f.type} · structural (locked)
                            </span>
                          )}
                          {(f.type === 'qrow') && (
                            <input value={f.default || ''} onChange={e => editField(si, fi, { default: e.target.value })} placeholder="Default guidance text (optional)" style={{ ...inp, flex: 1, minWidth: 200, fontSize: 12 }} />
                          )}
                        </div>
                      </div>
                    ))}
                    <button onClick={() => addField(si)} style={ghost}>+ Add question</button>
                  </div>
                </div>
              ))}
              <button onClick={addSection} style={{ ...btn, alignSelf: 'flex-start' }}>+ Add section</button>
            </div>
          )}
            </>
          )}
        </div>
      </div>
    </>
  )
}

const inp = { boxSizing: 'border-box', padding: '9px 11px', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 13.5, background: '#fff' }
const btn = { background: '#ca8a04', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }
const ghost = { background: '#f2f2f0', color: '#555', border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 13, cursor: 'pointer', alignSelf: 'flex-start' }
const iconBtn = { background: '#f2f2f0', border: 'none', borderRadius: 6, width: 28, height: 28, cursor: 'pointer', fontSize: 13, color: '#666' }

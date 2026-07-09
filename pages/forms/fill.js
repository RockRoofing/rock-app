import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/router'
import { Shell, bigBtn } from './index'

const INK = '#1a1a19', BRAND = '#ca8a04'

export default function Fill() {
  const router = useRouter()
  const { form: formId } = router.query
  const [user, setUser] = useState(null)
  const [form, setForm] = useState(null)
  const [answers, setAnswers] = useState({})
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [errors, setErrors] = useState({})
  const [projects, setProjects] = useState([])
  const [projectId, setProjectId] = useState('')
  const [team, setTeam] = useState([])

  useEffect(() => {
    try {
      const s = sessionStorage.getItem('ops_operative')
      if (!s) { router.replace('/forms'); return }
      setUser(JSON.parse(s))
    } catch { router.replace('/forms') }
  }, [])

  useEffect(() => {
    if (!formId) return
    ;(async () => {
      setLoading(true)
      try {
        const [rf, rp] = await Promise.all([
          fetch(`/api/forms?id=${formId}`),
          fetch('/api/dashboard'),
        ])
        const d = await rf.json()
        setForm(d.form)
        const dp = await rp.json()
        setProjects((dp.projects || [])
          .filter(p => p.status === 'INPROGRESS')
          .map(p => ({ id: p.xeroId, jobNo: p.jobNo, name: p.name }))
          .sort((a, b) => (a.jobNo || '').localeCompare(b.jobNo || '')))
        try {
          const rt = await fetch('/api/team'); const dt = await rt.json()
          setTeam((dt.members || []).filter(m => m.active !== false)
            .map(m => [m.firstName, m.lastName].filter(Boolean).join(' ') || m.name || '').filter(Boolean))
        } catch {}
      } catch (e) { console.error(e) }
      setLoading(false)
    })()
  }, [formId])

  const selectedProject = projects.find(p => p.id === projectId)
  const projectLabel = selectedProject ? `${selectedProject.jobNo ? selectedProject.jobNo + ' — ' : ''}${selectedProject.name}` : ''

  function set(id, val) {
    setAnswers(a => ({ ...a, [id]: val }))
    setErrors(e => { const n = { ...e }; delete n[id]; return n })
  }

  // Collect fields that trigger a "call a manager" notify flag.
  function computeFlags() {
    const flags = []
    for (const f of form.fields) {
      if (f.notifyOn && answers[f.id] === f.notifyOn) {
        flags.push({ field: f.label, value: answers[f.id] })
      }
    }
    return flags
  }

  function validate() {
    const errs = {}
    if (!projectId) errs.__project = 'Required'
    for (const f of form.fields) {
      if (f.type === 'section' || f.type === 'note') continue
      if (!f.required) continue
      const v = answers[f.id]
      const empty = v == null || v === '' || (Array.isArray(v) && v.length === 0) ||
        (f.type === 'signature' && (!v || !v.name))
      if (empty) errs[f.id] = 'Required'
    }
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  async function submit() {
    if (!validate()) {
      // Scroll to first error (project first if missing)
      const firstId = !projectId ? '__project' : (Object.keys(errors)[0] || form.fields.find(f => errors[f.id])?.id)
      const el = firstId && document.getElementById('f_' + firstId)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    setSubmitting(true)
    try {
      const flags = computeFlags()
      const r = await fetch('/api/submissions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          submission: {
            formId: form.id, formTitle: form.title,
            projectId: projectId, projectName: projectLabel,
            operative: user?.name || '', answers, flags,
          },
        }),
      })
      if (!r.ok) {
        let detail = `Error ${r.status}`
        try { const e = await r.json(); if (e?.error) detail = e.error } catch {}
        throw new Error(detail)
      }
      setDone(true)
      window.scrollTo(0, 0)
    } catch (e) {
      alert(`Could not submit: ${e.message || 'unknown error'}. If this keeps happening, screenshot this and send to the office.`)
    }
    setSubmitting(false)
  }

  if (loading || !form) {
    return <Shell user={user}><div style={{ textAlign: 'center', color: '#999', paddingTop: 40 }}>Loading form…</div></Shell>
  }

  if (done) {
    const flags = computeFlags()
    return (
      <Shell user={user}>
        <div style={{ maxWidth: 480, margin: '0 auto', textAlign: 'center', paddingTop: 32 }}>
          <div style={{ fontSize: 56 }}>✅</div>
          <h2 style={{ color: INK, margin: '12px 0 6px' }}>Submitted</h2>
          <p style={{ color: '#777', fontSize: 15 }}>{form.title} sent to the office.</p>
          {flags.length > 0 && (
            <div style={{ background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 12, padding: 16, margin: '16px 0', textAlign: 'left' }}>
              <div style={{ fontWeight: 700, color: '#92400e', marginBottom: 6 }}>⚠️ Action needed — call your manager now</div>
              <ul style={{ margin: 0, paddingLeft: 18, color: '#92400e', fontSize: 14 }}>
                {flags.map((fl, i) => <li key={i}>{fl.field}</li>)}
              </ul>
            </div>
          )}
          <button onClick={() => router.push('/forms')} style={bigBtn(false)}>Done</button>
        </div>
      </Shell>
    )
  }

  return (
    <Shell user={user} onLogout={() => { sessionStorage.removeItem('ops_operative'); router.push('/forms') }}>
      <div style={{ maxWidth: 620, margin: '0 auto' }}>
        <button onClick={() => router.push('/forms')} style={{ background: 'transparent', border: 'none', color: '#888', fontSize: 14, cursor: 'pointer', padding: 0 }}>‹ Back to forms</button>
        <h1 style={{ fontSize: 21, color: INK, margin: '10px 0 16px' }}>{form.title}</h1>

        {/* Built-in first question: which project is this form for? */}
        <div id="f___project" style={{ margin: '16px 0' }}>
          <label style={{ display: 'block', fontSize: 15, fontWeight: 600, color: INK, marginBottom: 8 }}>
            Project <span style={{ color: '#dc2626' }}>*</span>
          </label>
          <select value={projectId} onChange={e => { setProjectId(e.target.value); setErrors(er => { const n = { ...er }; delete n.__project; return n }) }}
            style={{
              width: '100%', boxSizing: 'border-box', padding: '13px 14px', fontSize: 15,
              border: `2px solid ${errors.__project ? '#dc2626' : '#e3e0d9'}`, borderRadius: 12, background: '#fff', outline: 'none',
            }}>
            <option value="">Select the project…</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.jobNo ? p.jobNo + ' — ' : ''}{p.name}</option>
            ))}
          </select>
          {errors.__project && <div style={{ color: '#dc2626', fontSize: 13, marginTop: 6 }}>Please select the project</div>}
        </div>

        {form.fields.map(f => (
          <Field key={f.id} f={f} value={answers[f.id]} onChange={v => set(f.id, v)} error={errors[f.id]} team={team} />
        ))}

        <button onClick={submit} disabled={submitting} style={{ ...bigBtn(submitting), marginTop: 20 }}>
          {submitting ? 'Submitting…' : 'Submit & notify office'}
        </button>
        <div style={{ height: 40 }} />
      </div>
    </Shell>
  )
}

// ── Field renderer ──────────────────────────────────────────────────────────
function Field({ f, value, onChange, error, team }) {
  if (f.type === 'section') {
    return <div style={{ margin: '26px 0 4px', paddingBottom: 6, borderBottom: '2px solid #ece8df' }}>
      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: BRAND }}>{f.label}</div>
    </div>
  }
  if (f.type === 'note') {
    return <div style={{ background: '#f2efe8', borderRadius: 10, padding: 12, fontSize: 13, color: '#666', margin: '8px 0' }}>{f.label}</div>
  }

  const notify = f.notifyOn && value === f.notifyOn
  return (
    <div id={'f_' + f.id} style={{ margin: '16px 0' }}>
      <label style={{ display: 'block', fontSize: 15, fontWeight: 600, color: INK, marginBottom: 8 }}>
        {f.label} {f.required && <span style={{ color: '#dc2626' }}>*</span>}
      </label>
      {f.help && <div style={{ fontSize: 12, color: '#999', marginTop: -4, marginBottom: 8 }}>{f.help}</div>}

      {f.type === 'shorttext' && <input value={value || ''} onChange={e => onChange(e.target.value)} style={inp} />}
      {f.type === 'longtext' && <textarea value={value || ''} onChange={e => onChange(e.target.value)} rows={3} style={{ ...inp, resize: 'vertical' }} />}
      {f.type === 'date' && <input type="date" value={value || ''} onChange={e => onChange(e.target.value)} style={inp} />}

      {(f.type === 'single' || f.type === 'yesno') && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(f.type === 'yesno' ? ['Yes', 'No'] : f.options).map(opt => (
            <Choice key={opt} label={opt} selected={value === opt} onClick={() => onChange(opt)} />
          ))}
        </div>
      )}

      {f.type === 'multi' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {f.options.map(opt => {
            const arr = Array.isArray(value) ? value : []
            const on = arr.includes(opt)
            return <Choice key={opt} label={opt} selected={on} check
              onClick={() => onChange(on ? arr.filter(x => x !== opt) : [...arr, opt])} />
          })}
        </div>
      )}

      {f.type === 'photos' && <PhotoField value={value} onChange={onChange} />}
      {f.type === 'signature' && <Signature value={value} onChange={onChange} />}

      {f.type === 'members' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(team || []).length === 0 && <div style={{ fontSize: 13, color: '#aaa' }}>No team members yet — add them in Operations → Team Members.</div>}
          {(team || []).map(nm => {
            const arr = Array.isArray(value) ? value : (value ? [value] : [])
            const on = arr.includes(nm)
            return <Choice key={nm} label={nm} selected={on} check
              onClick={() => onChange(on ? arr.filter(x => x !== nm) : [...arr, nm])} />
          })}
        </div>
      )}

      {notify && (
        <div style={{ marginTop: 8, background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 10, padding: '10px 12px', fontSize: 13, color: '#92400e', fontWeight: 600 }}>
          ⚠️ This will notify the office to call you.
        </div>
      )}
      {error && <div style={{ color: '#dc2626', fontSize: 13, marginTop: 6 }}>{error}</div>}
    </div>
  )
}

function Choice({ label, selected, onClick, check }) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', width: '100%',
      background: selected ? '#fffbeb' : '#fff',
      border: `2px solid ${selected ? BRAND : '#e3e0d9'}`,
      borderRadius: 12, padding: '13px 14px', cursor: 'pointer', fontSize: 14, color: INK,
    }}>
      <span style={{
        width: 22, height: 22, flexShrink: 0, borderRadius: check ? 6 : '50%',
        border: `2px solid ${selected ? BRAND : '#c9c4ba'}`,
        background: selected ? BRAND : '#fff', color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14,
      }}>{selected ? '✓' : ''}</span>
      <span>{label}</span>
    </button>
  )
}

function PhotoField({ value, onChange }) {
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef()
  const photos = Array.isArray(value) ? value : []

  async function handleFiles(files) {
    setUploading(true)
    const next = [...photos]
    for (const file of Array.from(files)) {
      try {
        const dataUrl = await readAsDataURL(file)
        const r = await fetch('/api/upload-photo', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: file.name, dataUrl }),
        })
        const d = await r.json()
        if (d.url) next.push(d.url)
      } catch (e) { console.error(e) }
    }
    onChange(next)
    setUploading(false)
  }

  return (
    <div>
      <input ref={inputRef} type="file" accept="image/*" capture="environment" multiple
        style={{ display: 'none' }} onChange={e => handleFiles(e.target.files)} />
      <button onClick={() => inputRef.current?.click()} disabled={uploading} style={{
        width: '100%', padding: '14px', border: '2px dashed #d9d5cc', borderRadius: 12,
        background: '#fff', cursor: 'pointer', color: '#666', fontSize: 15,
      }}>
        {uploading ? 'Uploading…' : '📷 Add photos'}
      </button>
      {photos.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginTop: 10 }}>
          {photos.map((url, i) => (
            <div key={i} style={{ position: 'relative' }}>
              <img src={url} alt="" style={{ width: '100%', height: 90, objectFit: 'cover', borderRadius: 8 }} />
              <button onClick={() => onChange(photos.filter((_, j) => j !== i))} style={{
                position: 'absolute', top: 4, right: 4, background: 'rgba(0,0,0,0.6)', color: '#fff',
                border: 'none', borderRadius: '50%', width: 22, height: 22, cursor: 'pointer', fontSize: 12,
              }}>×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Signature({ value, onChange }) {
  const v = value || {}
  const today = new Date().toISOString().split('T')[0]
  useEffect(() => { if (!v.date) onChange({ ...v, date: today }) }, [])
  return (
    <div style={{ background: '#fff', border: '1px solid #e3e0d9', borderRadius: 12, padding: 14 }}>
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 12, color: '#999', marginBottom: 4 }}>Full name</div>
        <input value={v.name || ''} onChange={e => onChange({ ...v, name: e.target.value })} style={inp} placeholder="Type your full name" />
      </div>
      <div>
        <div style={{ fontSize: 12, color: '#999', marginBottom: 4 }}>Date</div>
        <input type="date" value={v.date || today} onChange={e => onChange({ ...v, date: e.target.value })} style={inp} />
      </div>
      <div style={{ fontSize: 11, color: '#aaa', marginTop: 8 }}>Typing your name acts as your digital signature.</div>
    </div>
  )
}

function readAsDataURL(file) {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(r.result)
    r.onerror = rej
    r.readAsDataURL(file)
  })
}

const inp = {
  width: '100%', boxSizing: 'border-box', padding: '12px 14px', fontSize: 15,
  border: '2px solid #e3e0d9', borderRadius: 12, background: '#fff', outline: 'none',
}

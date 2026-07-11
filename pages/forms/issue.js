import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/router'
import { Shell, bigBtn } from './index'

const INK = '#1a1a19'
const BRAND = '#ca8a04'
const ISSUE_TYPES = ['Design', 'Quality', 'Health & Safety', 'Delay / Programme', 'Deliveries / Materials', 'Water ingress', 'Damage to our works', 'Interface issue', 'Access', 'Weather', 'Customer / Main Contractor', 'Workmanship', 'Other']

export default function RaiseIssue() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [projects, setProjects] = useState([])
  const [projectId, setProjectId] = useState('')
  const [issueName, setIssueName] = useState('')
  const [types, setTypes] = useState([])
  const [otherText, setOtherText] = useState('')
  const [description, setDescription] = useState('')
  const [photos, setPhotos] = useState([])
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    const s = sessionStorage.getItem('ops_operative')
    if (!s) { router.replace('/forms'); return }
    try { setUser(JSON.parse(s)) } catch {}
    fetch('/api/ops-projects').then(r => r.json()).then(d => {
      setProjects((d.projects || []).filter(p => p.status === 'active')
        .map(p => ({ id: p.projectNo, jobNo: p.projectNo, name: p.projectName, address: p.location || '' })))
    }).catch(() => {})
  }, [])

  const selected = projects.find(p => p.id === projectId)
  const projectLabel = selected ? `${selected.jobNo ? selected.jobNo + ' — ' : ''}${selected.name}` : ''

  function toggleType(t) {
    setTypes(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t])
  }

  function validate() {
    const e = {}
    if (!projectId) e.project = 'Required'
    if (!issueName.trim()) e.issueName = 'Required'
    if (!types.length) e.types = 'Select at least one'
    if (types.includes('Other') && !otherText.trim()) e.other = 'Describe the other issue type'
    if (!description.trim()) e.description = 'Required'
    if (!photos.length) e.photos = 'Attach at least one photo'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function submit() {
    if (!validate()) return
    setSubmitting(true)
    try {
      const issue = {
        projectNo: projectId, projectName: selected?.name || '', projectAddress: selected?.address || '',
        createdBy: user?.name || '', issueName: issueName.trim(),
        issueTypes: types, issueOther: types.includes('Other') ? otherText.trim() : '',
        description: description.trim(), photos,
      }
      const r = await fetch('/api/issues', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ issue }) })
      const d = await r.json()
      if (!r.ok || !d.issue) throw new Error(d.error || 'Save failed')
      // Fire the CM/Ops/QS notification (best effort — don't block the operative)
      fetch('/api/issue-notify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: d.issue.id }) }).catch(() => {})
      setDone(true)
    } catch (e) {
      alert(`Could not submit the issue: ${e.message || 'unknown error'}. Please try again.`)
    }
    setSubmitting(false)
  }

  if (!user) return <Shell user={user}><div style={{ textAlign: 'center', color: '#999', paddingTop: 40 }}>Loading…</div></Shell>

  if (done) return (
    <Shell user={user} onLogout={() => { sessionStorage.removeItem('ops_operative'); router.push('/forms') }}>
      <div style={{ textAlign: 'center', padding: '48px 16px' }}>
        <div style={{ fontSize: 54 }}>✅</div>
        <h2 style={{ color: INK, margin: '12px 0 4px' }}>Issue raised</h2>
        <p style={{ color: '#777', fontSize: 14 }}>The office has been notified.</p>
        <button onClick={() => router.push('/forms')} style={{ ...bigBtn(false), marginTop: 20 }}>Back to home</button>
      </div>
    </Shell>
  )

  const label = { fontSize: 14, fontWeight: 700, color: INK, margin: '18px 0 6px' }
  const star = <span style={{ color: '#dc2626' }}> *</span>
  const input = { width: '100%', boxSizing: 'border-box', padding: '13px', border: '1px solid #d9d5cc', borderRadius: 12, fontSize: 15, fontFamily: 'inherit', background: '#fff' }
  const errStyle = { color: '#dc2626', fontSize: 12, marginTop: 4 }

  return (
    <Shell user={user} onLogout={() => { sessionStorage.removeItem('ops_operative'); router.push('/forms') }}>
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        <button onClick={() => router.push('/forms')} style={{ background: 'none', border: 'none', color: BRAND, fontSize: 14, cursor: 'pointer', padding: '8px 0' }}>‹ Back</button>
        <h1 style={{ fontSize: 22, color: INK, margin: '4px 0 2px' }}>Raise an Issue</h1>
        <p style={{ color: '#888', fontSize: 13, margin: 0 }}>Report a site issue with photos. This goes to the office, not the normal forms list.</p>

        <div style={label}>Project{star}</div>
        <select value={projectId} onChange={e => setProjectId(e.target.value)} style={input}>
          <option value="">Select project…</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.jobNo ? p.jobNo + ' — ' : ''}{p.name}</option>)}
        </select>
        {errors.project && <div style={errStyle}>{errors.project}</div>}

        {selected && (
          <div style={{ marginTop: 10, padding: 12, background: '#faf9f7', borderRadius: 10, fontSize: 13, color: '#666' }}>
            <div>Created: {new Date().toLocaleDateString('en-GB')}</div>
            {selected.address && <div>Address: {selected.address}</div>}
            <div>Raised by: {user.name}</div>
          </div>
        )}

        <div style={label}>Issue name{star}</div>
        <input value={issueName} onChange={e => setIssueName(e.target.value)} style={input} placeholder="Short title for the issue" />
        {errors.issueName && <div style={errStyle}>{errors.issueName}</div>}

        <div style={label}>Issue type{star} <span style={{ fontWeight: 400, color: '#999', fontSize: 12 }}>(select all that apply)</span></div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {ISSUE_TYPES.map(t => {
            const on = types.includes(t)
            return (
              <button key={t} onClick={() => toggleType(t)}
                style={{ padding: '9px 14px', borderRadius: 20, border: on ? `2px solid ${BRAND}` : '1px solid #d9d5cc', background: on ? '#fffbeb' : '#fff', color: on ? '#92400e' : '#555', fontSize: 13, fontWeight: on ? 700 : 500, cursor: 'pointer' }}>
                {on ? '✓ ' : ''}{t}
              </button>
            )
          })}
        </div>
        {errors.types && <div style={errStyle}>{errors.types}</div>}
        {types.includes('Other') && (
          <div style={{ marginTop: 10 }}>
            <input value={otherText} onChange={e => setOtherText(e.target.value)} style={input} placeholder="Describe the other issue type" />
            {errors.other && <div style={errStyle}>{errors.other}</div>}
          </div>
        )}

        <div style={label}>Issue description{star}</div>
        <textarea value={description} onChange={e => setDescription(e.target.value)} style={{ ...input, minHeight: 110, resize: 'vertical' }} placeholder="Describe the issue" />
        {errors.description && <div style={errStyle}>{errors.description}</div>}

        <div style={label}>Photos{star}</div>
        <PhotoField value={photos} onChange={setPhotos} />
        {errors.photos && <div style={errStyle}>{errors.photos}</div>}

        <button onClick={submit} disabled={submitting} style={{ ...bigBtn(submitting), marginTop: 24 }}>
          {submitting ? 'Submitting…' : 'Submit issue'}
        </button>
      </div>
    </Shell>
  )
}

// Photo uploader (same behaviour as the forms PhotoField)
function PhotoField({ value, onChange }) {
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState('')
  const galleryRef = useRef()
  const cameraRef = useRef()
  const photos = Array.isArray(value) ? value : []

  async function handleFiles(files) {
    if (!files || !files.length) return
    setErr(''); setUploading(true)
    const next = [...photos]; let failed = 0
    for (const file of Array.from(files)) {
      try {
        const up = await fetch('/api/upload-file', {
          method: 'POST',
          headers: { 'Content-Type': file.type || 'application/octet-stream', 'x-filename': encodeURIComponent(file.name || `photo-${Date.now()}.jpg`), 'x-content-type': file.type || 'image/jpeg' },
          body: file,
        })
        const d = await up.json()
        if (up.ok && d.url) next.push(d.url); else failed++
      } catch (e) { failed++ }
    }
    onChange(next); setUploading(false)
    if (failed) setErr(`${failed} photo${failed > 1 ? 's' : ''} failed to upload — please try again.`)
    if (galleryRef.current) galleryRef.current.value = ''
    if (cameraRef.current) cameraRef.current.value = ''
  }

  const btn = { flex: 1, padding: '14px', border: '2px dashed #d9d5cc', borderRadius: 12, background: '#fff', cursor: 'pointer', color: '#666', fontSize: 15 }

  return (
    <div>
      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={() => cameraRef.current?.click()} style={btn}>📷 Take photo</button>
        <button onClick={() => galleryRef.current?.click()} style={btn}>🖼️ Choose</button>
      </div>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={e => handleFiles(e.target.files)} />
      <input ref={galleryRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={e => handleFiles(e.target.files)} />
      {uploading && <div style={{ color: '#888', fontSize: 13, marginTop: 8 }}>Uploading…</div>}
      {err && <div style={{ color: '#dc2626', fontSize: 12, marginTop: 6 }}>{err}</div>}
      {photos.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
          {photos.map((p, i) => (
            <div key={i} style={{ position: 'relative' }}>
              <img src={p} alt="" style={{ width: 84, height: 84, objectFit: 'cover', borderRadius: 10, border: '1px solid #eee' }} />
              <button onClick={() => onChange(photos.filter((_, j) => j !== i))}
                style={{ position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: 11, border: 'none', background: '#dc2626', color: '#fff', cursor: 'pointer', fontSize: 13, lineHeight: '22px', padding: 0 }}>×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

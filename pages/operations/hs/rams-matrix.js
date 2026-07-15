import { useState, useEffect, useMemo } from 'react'
import OperationsShell, { PageHeading } from '../../../components/OperationsShell'
import { INK, GOLD, Loading, ghostBtn } from '../../../components/opsUI'

const NAME_W = 300, CELL_W = 40, ROW_H = 34
const HEADER_ORANGE = '#f5c77e'
const ROW_ALT = '#f7f6f3'

export default function RamsMatrixPage() {
  const [projects, setProjects] = useState([])
  const [ops, setOps] = useState([])
  const [signoffs, setSignoffs] = useState({})
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState({ project: '', operative: '', company: '', trade: '' })
  const [resendOpen, setResendOpen] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const [m, opr] = await Promise.all([
        fetch('/api/rams-matrix').then(r => r.json()).catch(() => ({})),
        fetch('/api/operatives').then(r => r.json()).catch(() => ({})),
      ])
      setProjects(m.projects || [])
      setSignoffs(m.signoffs || {})
      setOps((opr.operatives || []).slice().sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`)))
    } catch {}
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const companies = useMemo(() => [...new Set(ops.map(o => o.company).filter(Boolean))].sort(), [ops])
  const trades = useMemo(() => [...new Set(ops.flatMap(o => (o.trades || [])))].filter(Boolean).sort(), [ops])

  const shownOps = useMemo(() => ops.filter(o => {
    if (filters.operative && o.id !== filters.operative) return false
    if (filters.company && o.company !== filters.company) return false
    if (filters.trade && !(o.trades || []).includes(filters.trade)) return false
    return true
  }), [ops, filters])

  const shownProjects = useMemo(() => projects.filter(p => !filters.project || p.key === filters.project), [projects, filters])

  if (loading) return (
    <OperationsShell active="hs:rams-matrix" section="hs" title="RAMS Matrix" wide><PageHeading title="RAMS Matrix" /><Loading /></OperationsShell>
  )

  const opName = (o) => `${o.firstName} ${o.lastName}`

  // Approval-stage pipeline shown under each project name.
  const STAGE_ORDER = ['cm', 'director', 'site-manager', 'operatives']
  const StageLine = ({ stage }) => {
    const labels = [['cm', 'CM'], ['director', 'Director'], ['site-manager', 'Site Manager'], ['operatives', 'Operatives']]
    const isRejected = stage === 'rejected'
    const curIdx = stage === 'complete' ? labels.length : isRejected ? 2 : STAGE_ORDER.indexOf(stage)
    return (
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'nowrap', gap: 3, marginTop: 2, fontSize: 10, whiteSpace: 'nowrap' }}>
        {isRejected && <span style={{ color: '#dc2626', fontWeight: 800, marginRight: 4 }}>✗ Edits required —</span>}
        {labels.map(([k, label], i) => {
          const done = i < curIdx, current = i === curIdx && stage !== 'complete'
          const rejectedNode = isRejected && k === 'site-manager'
          const colour = rejectedNode ? '#dc2626' : done ? '#16a34a' : current ? '#dc2626' : '#bbb'
          return (
            <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
              <span style={{ color: colour, fontWeight: (current || rejectedNode) ? 800 : 600 }}>{rejectedNode ? '✗ ' : done ? '✓ ' : ''}{label}</span>
              {i < labels.length - 1 && <span style={{ color: '#ccc' }}>›</span>}
            </span>
          )
        })}
      </div>
    )
  }

  return (
    <OperationsShell active="hs:rams-matrix" section="hs" title="RAMS Matrix" wide>
      <PageHeading title="RAMS Matrix" sub="Which installers have signed onto each project's RAMS. Projects down the side, installers across the top." />

      {/* Key */}
      <div style={{ display: 'flex', gap: 18, alignItems: 'center', marginBottom: 12, fontSize: 12.5, flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 18, height: 18, borderRadius: 4, background: '#dcfce7', color: '#166534', fontWeight: 700, fontSize: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>Yes</span> Signed RAMS</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 18, height: 18, borderRadius: 4, background: '#fed7aa', color: '#9a3412', fontWeight: 700, fontSize: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>PS</span> Pending Signature</span>
        <button onClick={() => setResendOpen(true)} style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #e6b567', background: '#fff7ec', color: '#92400e', fontWeight: 600, fontSize: 12.5, cursor: 'pointer' }}>✉ Resend RAMS to Site Manager</button>
        <button onClick={load} style={{ ...ghostBtn, padding: '6px 12px', marginLeft: 'auto' }}>↻ Refresh</button>
      </div>

      {resendOpen && <ResendSiteManagerModal projects={projects} onClose={() => setResendOpen(false)} onSent={() => { setResendOpen(false); load() }} />}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end', marginBottom: 12 }}>
        <div><div style={lbl}>Project</div>
          <select value={filters.project} onChange={e => setFilters(f => ({ ...f, project: e.target.value }))} style={{ ...fInput, minWidth: 180, fontFamily: 'inherit' }}>
            <option value="">All projects</option>
            {projects.map(p => <option key={p.key} value={p.key}>{p.name}</option>)}
          </select>
        </div>
        <div><div style={lbl}>Operative</div>
          <select value={filters.operative} onChange={e => setFilters(f => ({ ...f, operative: e.target.value }))} style={{ ...fInput, minWidth: 160, fontFamily: 'inherit' }}>
            <option value="">All operatives</option>
            {ops.map(o => <option key={o.id} value={o.id}>{opName(o)}</option>)}
          </select>
        </div>
        <div><div style={lbl}>Company</div>
          <select value={filters.company} onChange={e => setFilters(f => ({ ...f, company: e.target.value }))} style={{ ...fInput, minWidth: 150, fontFamily: 'inherit' }}>
            <option value="">All companies</option>
            {companies.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div><div style={lbl}>Trade</div>
          <select value={filters.trade} onChange={e => setFilters(f => ({ ...f, trade: e.target.value }))} style={{ ...fInput, minWidth: 140, fontFamily: 'inherit' }}>
            <option value="">All trades</option>
            {trades.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        {(filters.project || filters.operative || filters.company || filters.trade) &&
          <button onClick={() => setFilters({ project: '', operative: '', company: '', trade: '' })} style={{ ...ghostBtn, padding: '7px 12px' }}>Clear</button>}
      </div>

      {ops.length === 0 ? (
        <div style={{ padding: 20, fontSize: 13, color: '#888', background: '#faf9f7', borderRadius: 10 }}>No operatives yet. Add them under H&S → Operatives first.</div>
      ) : (
        <div style={{ border: '1px solid #ececec', borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
          <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 260px)' }}>
            <div style={{ minWidth: NAME_W + shownOps.length * CELL_W }}>
              {/* header: operative names, rotated — frozen to the top on vertical scroll */}
              <div style={{ display: 'flex', borderBottom: '2px solid #e6b567', background: HEADER_ORANGE, alignItems: 'flex-end', position: 'sticky', top: 0, zIndex: 5 }}>
                <div style={{ width: NAME_W, minWidth: NAME_W, position: 'sticky', left: 0, zIndex: 6, background: HEADER_ORANGE, padding: '8px', fontSize: 12, fontWeight: 700, color: '#3a2e12', alignSelf: 'flex-end' }}>Project RAMS</div>
                {shownOps.map(o => (
                  <div key={o.id} title={`${opName(o)}${o.company ? ` · ${o.company}` : ''}`} style={{ width: CELL_W, minWidth: CELL_W, height: 130, position: 'relative', borderLeft: '1px solid #eab968' }}>
                    <div style={{ position: 'absolute', bottom: 8, left: '50%', transformOrigin: 'left bottom', transform: 'rotate(-60deg)', whiteSpace: 'nowrap', fontSize: 10.5, color: '#3a2e12', fontWeight: 600 }}>{opName(o)}</div>
                  </div>
                ))}
              </div>

              {/* rows */}
              {shownProjects.map((p, ri) => {
                const rowBg = ri % 2 === 1 ? ROW_ALT : '#fff'
                // Chain has reached operatives → everyone not-yet-signed shows PS.
                const opsReached = p.stage === 'operatives' || p.stage === 'complete'
                const signerSet = new Set(p.signerKeys || [])
                const approverSet = new Set(p.approverKeys || [])
                const hasSigned = (o) => { const k = opName(o).trim().toLowerCase(); return signerSet.has(k) || approverSet.has(k) }
                const allSigned = opsReached && shownOps.length > 0 && shownOps.every(hasSigned)
                return (
                <div key={p.key} style={{ display: 'flex', borderBottom: '1px solid #f2f2f2', minHeight: ROW_H, alignItems: 'stretch', background: rowBg }}>
                  <div style={{ width: NAME_W, minWidth: NAME_W, position: 'sticky', left: 0, zIndex: 2, background: rowBg, borderRight: '1px solid #f0f0f0', padding: '6px 8px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: INK }}>{p.name}</div>
                    {p.hasRams
                      ? <StageLine stage={allSigned ? 'complete' : p.stage} />
                      : <div style={{ fontSize: 10, color: '#bbb', marginTop: 2 }}>No RAMS uploaded</div>}
                  </div>
                  {shownOps.map(o => {
                    const key = opName(o).trim().toLowerCase()
                    // "Yes" if they signed as an operative OR they signed via CM/Director
                    // approval. PS only if the chain has reached operatives and they
                    // haven't signed in either capacity.
                    const signed = signerSet.has(key) || approverSet.has(key)
                    const state = signed ? 'yes' : (opsReached ? 'ps' : '')
                    const bg = state === 'yes' ? '#dcfce7' : state === 'ps' ? '#fed7aa' : 'transparent'
                    const fg = state === 'yes' ? '#166534' : state === 'ps' ? '#9a3412' : '#ddd'
                    return (
                      <div key={o.id} title={`${p.name} — ${opName(o)}`}
                        style={{ width: CELL_W, minWidth: CELL_W, borderLeft: '1px solid #f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center', background: bg, fontSize: 11, fontWeight: 700, color: fg }}>
                        {state === 'yes' ? 'Yes' : state === 'ps' ? 'PS' : ''}
                      </div>
                    )
                  })}
                </div>
                )
              })}
              {shownProjects.length === 0 && <div style={{ padding: 14, fontSize: 12.5, color: '#aaa' }}>No projects match.</div>}
            </div>
          </div>
        </div>
      )}
      <div style={{ fontSize: 11.5, color: '#999', marginTop: 8 }}>Cells update automatically as operatives sign in the Site App. <strong>Yes</strong> = signed all current RAMS; <strong>PS</strong> = RAMS approved through to operatives and awaiting their signature. The line under each project shows the approval stage (current stage in red, completed stages in green).</div>
    </OperationsShell>
  )
}

const lbl = { fontSize: 11, color: '#888', marginBottom: 3 }
const fInput = { padding: '7px 9px', borderRadius: 8, border: '1px solid #e0e0e0', fontSize: 12.5 }

function ResendSiteManagerModal({ projects, onClose, onSent }) {
  // A Site Manager exists once the Director has signed — so a project can be
  // (re)sent when its current RAMS is at the Site Manager stage or beyond.
  const eligible = (projects || []).filter(p => p.hasRams && ['site-manager', 'operatives', 'complete'].includes(p.stage))
  const [projKey, setProjKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [fileId, setFileId] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [contacts, setContacts] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [okMsg, setOkMsg] = useState('')

  async function pickProject(key) {
    setProjKey(key); setErr(''); setOkMsg(''); setFileId(''); setName(''); setEmail(''); setContacts([])
    if (!key) return
    setLoading(true)
    try {
      const [filesRes, apprRes, projRes] = await Promise.all([
        fetch(`/api/project-files?no=${encodeURIComponent(key)}&cat=rams`).then(r => r.json()).catch(() => ({})),
        fetch(`/api/rams-approvals?no=${encodeURIComponent(key)}`).then(r => r.json()).catch(() => ({})),
        fetch(`/api/ops-projects?no=${encodeURIComponent(key)}`).then(r => r.json()).catch(() => ({})),
      ])
      const files = (filesRes.files || []).slice().sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0))
      const current = files[0]
      if (!current) { setErr('No RAMS file found for this project.'); setLoading(false); return }
      setFileId(current.id)
      const rec = (apprRes.approvals || {})[current.id] || {}
      setName(rec.siteManagerName || '')
      setEmail(rec.siteManagerEmail || '')
      const sc = projRes?.project?.data?.siteContacts || projRes?.project?.siteContacts || []
      setContacts(Array.isArray(sc) ? sc.filter(c => c.email) : [])
    } catch { setErr('Could not load this project.') }
    setLoading(false)
  }

  async function send() {
    setErr(''); setOkMsg('')
    if (!projKey || !fileId) { setErr('Please select a project.'); return }
    if (!name.trim()) { setErr('Please enter the Site Manager name.'); return }
    if (!email.trim() || !/.+@.+\..+/.test(email)) { setErr('Please enter a valid Site Manager email.'); return }
    setBusy(true)
    try {
      const r = await fetch('/api/rams-approvals', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set-site-manager', projectNo: projKey, fileId, name: name.trim(), email: email.trim() }),
      })
      let d = {}; try { d = await r.json() } catch {}
      if (!r.ok || !d.ok) { setErr(d.error || 'Could not resend.'); setBusy(false); return }
      setOkMsg(`RAMS approval email resent to ${email.trim()}.`); setBusy(false)
    } catch (e) { setErr(e?.message || 'Could not resend.'); setBusy(false) }
  }

  const input = { width: '100%', boxSizing: 'border-box', padding: '10px 12px', border: '1px solid #d9d5cc', borderRadius: 10, fontSize: 14, fontFamily: 'inherit' }
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '6vh 2vw', overflowY: 'auto' }}>
      <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 480 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 22px', borderBottom: '1px solid #eee' }}>
          <h2 style={{ margin: 0, fontSize: 16, color: INK }}>Resend RAMS to Site Manager</h2>
          <button onClick={onClose} style={{ fontSize: 24, border: 'none', background: 'none', cursor: 'pointer', color: '#999' }}>×</button>
        </div>
        <div style={{ padding: '18px 22px' }}>
          {okMsg ? (
            <div style={{ textAlign: 'center', padding: '10px 0' }}>
              <div style={{ fontSize: 34, marginBottom: 6 }}>✅</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: INK }}>{okMsg}</div>
              <button onClick={onSent} style={{ marginTop: 18, padding: '10px 18px', fontSize: 14, fontWeight: 700, color: '#fff', background: GOLD, border: 'none', borderRadius: 10, cursor: 'pointer' }}>Done</button>
            </div>
          ) : (
            <>
              <div style={lbl}>Project</div>
              <select value={projKey} onChange={e => pickProject(e.target.value)} style={{ ...input, fontFamily: 'inherit', marginBottom: 14 }}>
                <option value="">Select a project…</option>
                {eligible.map(p => <option key={p.key} value={p.key}>{p.name}</option>)}
              </select>
              {eligible.length === 0 && <div style={{ fontSize: 12.5, color: '#999', marginTop: -8, marginBottom: 12 }}>No projects are ready to send to a Site Manager yet — the Director must sign the RAMS first.</div>}

              {loading ? <div style={{ fontSize: 13, color: '#999', padding: '10px 0' }}>Loading…</div> : projKey && fileId && (
                <>
                  {contacts.length > 0 && (
                    <>
                      <div style={lbl}>Reconfirm the Site Manager</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                        {contacts.map((c, i) => {
                          const on = email === c.email
                          return (
                            <button key={i} onClick={() => { setName(c.name || ''); setEmail(c.email || '') }}
                              style={{ textAlign: 'left', border: '1px solid ' + (on ? GOLD : '#e0e0e0'), background: on ? '#fffbeb' : '#fff', borderRadius: 10, padding: '8px 11px', cursor: 'pointer' }}>
                              <div style={{ fontSize: 13.5, fontWeight: 600, color: INK }}>{on ? '✓ ' : ''}{c.name || c.email}{c.title ? <span style={{ color: '#888', fontWeight: 400 }}> · {c.title}</span> : ''}</div>
                              <div style={{ fontSize: 12, color: '#888' }}>{c.email}</div>
                            </button>
                          )
                        })}
                      </div>
                    </>
                  )}
                  <div style={lbl}>Site Manager name</div>
                  <input value={name} onChange={e => setName(e.target.value)} style={{ ...input, marginBottom: 12 }} placeholder="Full name" />
                  <div style={lbl}>Site Manager email</div>
                  <input value={email} onChange={e => setEmail(e.target.value)} style={input} placeholder="name@company.com" inputMode="email" />
                </>
              )}

              {err && <div style={{ color: '#dc2626', fontSize: 13, marginTop: 12 }}>{err}</div>}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
                <button onClick={onClose} style={ghostBtn}>Cancel</button>
                <button onClick={send} disabled={busy || !fileId} style={{ padding: '10px 18px', fontSize: 14, fontWeight: 700, color: '#fff', background: (busy || !fileId) ? '#c9c4ba' : GOLD, border: 'none', borderRadius: 10, cursor: (busy || !fileId) ? 'default' : 'pointer' }}>{busy ? 'Sending…' : 'Send'}</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

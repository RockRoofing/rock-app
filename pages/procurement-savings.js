import Head from 'next/head'
import { useState, useEffect, useMemo } from 'react'
import PreContractNav from '../components/PreContractNav'
import ProcurementSavings from '../components/ProcurementSavings'
import { INK, GOLD } from '../components/opsUI'

// Pre-Contract Procurement Savings page. Shows a "needs finalising" worklist
// at the top, then a project selector + the shared editable savings grid.
export default function ProcurementSavingsPage() {
  const [projects, setProjects] = useState([])
  const [summary, setSummary] = useState({})       // { projectNo: {total, incomplete} }
  const [projectNo, setProjectNo] = useState('')
  const [projectName, setProjectName] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [])
  async function load() {
    try {
      const [p, s] = await Promise.all([
        fetch('/api/ops-projects').then(r => r.json()).catch(() => ({})),
        fetch('/api/procurement-savings?summary=true').then(r => r.json()).catch(() => ({})),
      ])
      setProjects((p.projects || []).map(x => ({ no: x.projectNo, name: x.projectName || x.name || '' })).filter(x => x.no))
      setSummary(s.started || {})
    } catch {}
    setLoading(false)
  }

  // "Needs finalising": projects with NO procurement savings document started
  // at all. Shown with a warning. (Started-but-unfinished ones are not listed
  // here — the amber row highlighting inside each doc flags those.)
  const needsFinalising = useMemo(() => {
    return projects.filter(p => !summary[p.no]).map(p => ({ ...p }))
  }, [projects, summary])

  function pick(no) {
    const proj = projects.find(p => p.no === no)
    setProjectNo(no); setProjectName(proj?.name || '')
  }

  return (
    <>
      <Head><title>Rock Roofing — Procurement Savings</title></Head>
      <div style={{ fontFamily: 'system-ui,-apple-system,sans-serif', minHeight: '100vh', background: '#fafaf9' }}>
        <PreContractNav active="procurement-savings" />
        <div style={{ maxWidth: 1600, margin: '0 auto', padding: '24px 28px' }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: INK, margin: '0 0 4px' }}>Procurement Savings</h1>
          <p style={{ fontSize: 14, color: '#777', margin: '0 0 22px' }}>Tendered vs buying rates and resulting savings, per project. Also available under each project in the Projects area.</p>

          {/* Needs finalising worklist — projects with no savings doc started */}
          <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, padding: 18, marginBottom: 22 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: INK, marginBottom: 4 }}>Needs finalising</div>
            <div style={{ fontSize: 12.5, color: '#999', marginBottom: 12 }}>Projects with no procurement savings document started yet.</div>
            {loading ? <div style={{ color: '#999', fontSize: 13 }}>Loading…</div>
              : needsFinalising.length === 0 ? <div style={{ color: '#16a34a', fontSize: 13, fontWeight: 600 }}>✓ Every project has a procurement savings document started.</div>
              : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {needsFinalising.map(p => (
                    <button key={p.no} onClick={() => pick(p.no)}
                      style={{ textAlign: 'left', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '10px 14px', cursor: 'pointer', minWidth: 220 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: INK }}>{[p.no, p.name].filter(Boolean).join(' — ')}</div>
                      <div style={{ fontSize: 11.5, color: '#dc2626', marginTop: 2, fontWeight: 600 }}>⚠ Not started</div>
                    </button>
                  ))}
                </div>
              )}
          </div>

          {/* Project selector */}
          <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, padding: 14, marginBottom: 18, display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 11, color: '#999', marginBottom: 4 }}>Project</div>
              <select value={projectNo} onChange={e => pick(e.target.value)} style={{ padding: '9px 12px', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 13, background: '#fff', minWidth: 300 }}>
                <option value="">Select a project…</option>
                {projects.map(p => <option key={p.no} value={p.no}>{[p.no, p.name].filter(Boolean).join(' — ')}</option>)}
              </select>
            </div>
            {projectName && <div style={{ fontSize: 13, color: '#777', alignSelf: 'center' }}>{projectName}</div>}
          </div>

          {projectNo
            ? <ProcurementSavings key={projectNo} projectNo={projectNo} projectName={projectName} />
            : <div style={{ background: '#fff', border: '1px dashed #ddd', borderRadius: 12, padding: 40, textAlign: 'center', color: '#999', fontSize: 14 }}>Select a project above, or pick one from “Needs finalising”, to view or edit its procurement savings.</div>}
        </div>
      </div>
    </>
  )
}

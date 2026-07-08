import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import PreContractNav from '../../components/PreContractNav'
import { INK, th, td, Loading, EmptyCard, primaryBtn, linkBtn, fmtDate } from '../../components/opsUI'

export default function HandoverList() {
  const router = useRouter()
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { (async () => {
    try { const r = await fetch('/api/ops-projects'); const d = await r.json(); setProjects(d.projects || []) } catch {}
    setLoading(false)
  })() }, [])

  // Newest first by created date. The API already sorts by updatedAt, but we
  // want created order for this table — sort defensively here too.
  const rows = [...projects].sort((a, b) => (b.createdAt || b.updatedAt || 0) - (a.createdAt || a.updatedAt || 0))

  async function del(no, name) {
    if (!confirm(`Delete the handover for ${no}${name ? ' — ' + name : ''}? This removes the project.`)) return
    await fetch('/api/ops-projects', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectNo: no }) })
    const r = await fetch('/api/ops-projects'); const d = await r.json(); setProjects(d.projects || [])
  }

  return (
    <>
      <Head><title>Rock Roofing — Internal Handover Minutes</title></Head>
      <div style={{ fontFamily: 'system-ui,-apple-system,sans-serif', minHeight: '100vh', background: '#fafaf9' }}>
        <PreContractNav active="handover" />
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 22, color: INK }}>Internal Handover Minutes</h1>
              <div style={{ color: '#999', fontSize: 13, marginTop: 2 }}>Completing a handover creates the operations project</div>
            </div>
            <button onClick={() => router.push('/handover/form')} style={primaryBtn}>+ Add new</button>
          </div>

          {loading ? <Loading /> : !rows.length ? (
            <EmptyCard title="No handovers yet" body="Create your first Internal Handover to set up a project." />
          ) : (
            <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr style={{ background: '#faf9f7' }}>
                  {['Project No.', 'Project', 'Customer', 'Contracts Mgr', 'Created', 'Status', ''].map(h => <th key={h} style={th}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {rows.map(p => (
                    <tr key={p.projectNo} style={{ borderTop: '1px solid #f0f0f0' }}>
                      <td style={td}><strong style={{ color: INK }}>{p.projectNo}</strong></td>
                      <td style={td}>{p.projectName || '—'}</td>
                      <td style={td}>{p.customer || '—'}</td>
                      <td style={td}>{p.contractsManager || '—'}</td>
                      <td style={{ ...td, color: '#999', whiteSpace: 'nowrap' }}>{fmtDate(p.createdAt)}</td>
                      <td style={td}>{p.status === 'draft'
                        ? <span style={{ background: '#fef3c7', color: '#92400e', borderRadius: 20, padding: '2px 10px', fontSize: 12, fontWeight: 600 }}>Draft</span>
                        : <span style={{ background: '#ecfdf5', color: '#065f46', borderRadius: 20, padding: '2px 10px', fontSize: 12 }}>Complete</span>}</td>
                      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button onClick={() => router.push(`/handover/form?no=${encodeURIComponent(p.projectNo)}`)} style={linkBtn}>Edit</button>
                        <button onClick={() => del(p.projectNo, p.projectName)} style={{ ...linkBtn, color: '#dc2626' }}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

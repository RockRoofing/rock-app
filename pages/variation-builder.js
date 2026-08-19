import { useState, useEffect } from 'react'
import Head from 'next/head'
import { useRouter } from 'next/router'
import PreContractNav from '../components/PreContractNav'
import VariationBuilder from '../components/VariationBuilder'

// The Variation Builder for the pre-contract team.
//
// The SAME component the Commercial tracker uses - not a copy. A second copy would have
// drifted within a fortnight, and a variation raised here has to behave identically to
// one raised there: same numbering off the tracker, same workings, same PDF, same
// instruction link.
export default function PreContractVariationBuilder() {
  const router = useRouter()
  const [ok, setOk] = useState(false)
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/portal-auth?action=me').then(r => r.json()).then(d => {
      if (!d.user) { router.replace('/login'); return }
      // Pre-contract as well as the commercial roles. Variations belong to a live project,
      // so the people who won it can raise one against it.
      if (!['pre-contract', 'post-contract', 'management', 'admin'].includes(d.user.role)) { router.replace('/'); return }
      setOk(true)
    }).catch(() => router.replace('/login'))
  }, [])

  async function load() {
    setLoading(true)
    try {
      const [d, hiddenRes] = await Promise.all([
        fetch('/api/dashboard').then(r => r.json()).catch(() => ({})),
        fetch('/api/hidden-projects').then(r => r.json()).catch(() => ({})),
      ])
      const hidden = new Set((hiddenRes.hidden || []).map(String))
      // Live projects only, sorted by job number - the same set the Commercial tracker
      // builds against.
      setProjects((d.projects || [])
        .filter(p => p.status === 'INPROGRESS' && !hidden.has(String(p.xeroId)))
        .sort((a, b) => String(a.jobNo || '').localeCompare(String(b.jobNo || ''), undefined, { numeric: true })))
    } catch {}
    setLoading(false)
  }
  useEffect(() => { if (ok) load() }, [ok])

  if (!ok) return null

  return (
    <>
      <Head><title>Variation Builder · Rock Roofing</title></Head>
      <div style={{ fontFamily: 'system-ui,-apple-system,sans-serif', minHeight: '100vh', background: '#f0f2f5' }}>
        <PreContractNav active="variation-builder" />
        <div style={{ padding: 24 }}>
          <h1 style={{ margin: '0 0 18px', fontSize: 20, fontWeight: 700, color: '#1a1a2e' }}>Variation Builder</h1>
          {loading
            ? <div style={{ color: '#aaa', padding: 40 }}>Loading projects…</div>
            : <VariationBuilder projects={projects} onSaved={load} />}
        </div>
      </div>
    </>
  )
}

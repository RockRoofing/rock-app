import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { canAccessArea, normRole } from './roles'

export const PURPLE = '#7c3aed'
export const INK = '#1a1a19'

// Design portal pages (per-project). internalOnly = builder tools hidden from
// customers and non-internal users. Order drives the sub-nav.
export const DESIGN_PAGES = [
  { key: 'rfis', label: 'RFIs', slug: 'rfis' },
  { key: 'tech-sub-builder', label: 'Tech Sub Builder', slug: 'tech-sub-builder', internalOnly: true },
  { key: 'tech-sub', label: 'Tech Sub', slug: 'tech-sub' },
  { key: 'contract-drawings', label: 'Contract Drawings', slug: 'contract-drawings' },
  { key: 'rock-drawings', label: 'Rock Drawings', slug: 'rock-drawings' },
  { key: 'calculations', label: 'Calculations', slug: 'calculations' },
  { key: 'leak-test-builder', label: 'Leak Test Cert Builder', slug: 'leak-test-builder', internalOnly: true },
  { key: 'leak-test-certs', label: 'Leak Test Certs', slug: 'leak-test-certs' },
  { key: 'warranties', label: 'Warranties', slug: 'warranties' },
  { key: 'oms', label: 'O&Ms', slug: 'oms' },
]

export function isInternalRole(role) {
  return ['designer', 'post-contract', 'management', 'admin'].includes(normRole(role))
}
export const designHref = (projectNo, slug) => `/design/${encodeURIComponent(projectNo)}/${slug}`

// Log the current user out and send them to the login page.
export async function designLogout() {
  try { await fetch('/api/portal-auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'logout' }) }) } catch {}
  window.location.href = '/login'
}

// Auth hook for the project card list (no project chosen yet).
export function useDesignAuth() {
  const router = useRouter()
  const [state, setState] = useState({ ready: false, user: null, isExternal: false, isInternal: false, projects: [] })
  useEffect(() => { (async () => {
    try {
      const me = await fetch('/api/portal-auth?action=me').then(r => r.json()).catch(() => null)
      if (!me || !me.user) { router.replace('/login'); return }
      const u = me.user
      const isExternal = u.role === 'external' || u.external
      if (!isExternal && !canAccessArea(u.role, 'design')) { router.replace('/'); return }
      const projects = await loadScopedProjects(u, isExternal)
      setState({ ready: true, user: u, isExternal, isInternal: isInternalRole(u.role), projects })
    } catch { router.replace('/') }
  })() }, [])
  return state
}

// Auth hook for a specific project page. Verifies the user may access THIS project.
export function useDesignProjectAuth(projectNo) {
  const router = useRouter()
  const [state, setState] = useState({ ready: false, user: null, isExternal: false, isInternal: false, project: null, projects: [] })
  useEffect(() => { (async () => {
    if (!projectNo) return
    try {
      const me = await fetch('/api/portal-auth?action=me').then(r => r.json()).catch(() => null)
      if (!me || !me.user) { router.replace('/login'); return }
      const u = me.user
      const isExternal = u.role === 'external' || u.external
      if (!isExternal && !canAccessArea(u.role, 'design')) { router.replace('/'); return }
      const projects = await loadScopedProjects(u, isExternal)
      const project = projects.find(p => String(p.projectNo) === String(projectNo))
      if (!project) { router.replace('/design'); return }
      setState({ ready: true, user: u, isExternal, isInternal: isInternalRole(u.role), project, projects })
    } catch { router.replace('/design') }
  })() }, [projectNo])
  return state
}

async function loadScopedProjects(u, isExternal) {
  try {
    const d = await fetch('/api/planning').then(r => r.json())
    const byNo = {}
    const all = []
    const seen = new Set()
    for (const p of (d.projects || [])) {
      const no = String(p.projectNo || p.jobNo || '')
      if (!no) continue
      byNo[no] = { projectNo: no, name: p.name || '', customer: p.customer || '', location: p.location || '' }
      if (!seen.has(no)) { seen.add(no); all.push(byNo[no]) }
    }
    if (isExternal) {
      const nos = Array.isArray(u.projects) ? u.projects.map(String) : []
      return nos.map(no => byNo[no] || { projectNo: no, name: '', customer: '', location: '' })
    }
    all.sort((a, b) => String(b.projectNo).localeCompare(String(a.projectNo), undefined, { numeric: true }))
    return all
  } catch { return [] }
}

// Ops-style two-tier nav for the Design portal.
export function DesignNav({ active, projectNo, projectName, isInternal }) {
  const pages = DESIGN_PAGES.filter(p => !p.internalOnly || isInternal)
  return (
    <div>
      <div style={{ background: '#1a1a19', padding: '0 20px', display: 'flex', alignItems: 'center', height: 52, overflowX: 'auto' }}>
        <img src="/rock-logo.jpg" alt="Rock Roofing" style={{ height: 30, width: 30, borderRadius: 4, marginRight: 8, flexShrink: 0 }} />
        <a href="/design" style={link}>&lt;- Design</a>
        <Divider />
        <span style={active2}>{projectName ? `${projectNo} - ${projectName}` : projectNo}</span>
        <div style={{ flex: 1, minWidth: 16 }} />
        <button onClick={() => window.dispatchEvent(new CustomEvent('open-report-problem'))}
          style={{ ...link, color: '#ca8a04', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>Report app improvement</button>
        <button onClick={designLogout}
          style={{ ...link, color: '#bbb', background: 'none', border: '1px solid #3a3a38', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', marginLeft: 8 }}>Log out</button>
      </div>
      <div style={{ background: '#fff', borderBottom: '1px solid #ececec', padding: '0 24px', display: 'flex', gap: 4, overflowX: 'auto', height: 46, alignItems: 'center' }}>
        {pages.map(p => {
          const on = active === p.key
          return (
            <a key={p.key} href={designHref(projectNo, p.slug)} style={{
              fontSize: 13.5, textDecoration: 'none', padding: '8px 14px', whiteSpace: 'nowrap',
              color: on ? PURPLE : '#888', fontWeight: on ? 700 : 400,
              borderBottom: on ? `2px solid ${PURPLE}` : '2px solid transparent', marginBottom: -1,
            }}>{p.label}</a>
          )
        })}
      </div>
    </div>
  )
}

const Divider = () => <span style={{ color: '#3a3a38', fontSize: 14, padding: '0 2px' }}>|</span>
const link = { color: '#888', fontSize: 13, textDecoration: 'none', padding: '4px 10px', borderRadius: 6, whiteSpace: 'nowrap', cursor: 'pointer' }
const active2 = { color: '#fff', fontSize: 13, fontWeight: 600, padding: '4px 10px', borderRadius: 6, background: '#2a2a28', whiteSpace: 'nowrap' }

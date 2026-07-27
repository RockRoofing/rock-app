import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { canAccessArea, normRole } from './roles'

export const PURPLE = '#7c3aed'
export const INK = '#1a1a19'

// Pages in the Design portal + who sees them. internalOnly = builder tools hidden from
// customers and non-internal. Order here drives the sub-nav.
export const DESIGN_PAGES = [
  { key: 'rfis', label: 'RFIs', href: '/design/rfis' },
  { key: 'tech-sub-builder', label: 'Tech Sub Builder', href: '/design/tech-sub-builder', internalOnly: true },
  { key: 'tech-sub', label: 'Tech Sub', href: '/design/tech-sub' },
  { key: 'contract-drawings', label: 'Contract Drawings', href: '/design/contract-drawings' },
  { key: 'rock-drawings', label: 'Rock Drawings', href: '/design/rock-drawings' },
  { key: 'calculations', label: 'Calculations', href: '/design/calculations' },
  { key: 'leak-test-builder', label: 'Leak Test Cert Builder', href: '/design/leak-test-builder', internalOnly: true },
  { key: 'leak-test-certs', label: 'Leak Test Certs', href: '/design/leak-test-certs' },
  { key: 'warranties', label: 'Warranties', href: '/design/warranties' },
  { key: 'oms', label: 'O&Ms', href: '/design/oms' },
]

export function isInternalRole(role) {
  return ['designer', 'post-contract', 'management', 'admin'].includes(normRole(role))
}

// Hook: authenticate, load the user, and resolve the projects they may pick.
// Internal users get all live/ops projects; external users get only their scoped list.
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

      let projects = []
      if (isExternal) {
        // Only the projects this customer is scoped to.
        const nos = Array.isArray(u.projects) ? u.projects : []
        try {
          const d = await fetch('/api/planning').then(r => r.json())
          const byNo = {}
          for (const p of (d.projects || [])) byNo[String(p.projectNo || p.jobNo)] = p.name || ''
          projects = nos.map(no => ({ projectNo: String(no), name: byNo[String(no)] || '' }))
        } catch { projects = nos.map(no => ({ projectNo: String(no), name: '' })) }
      } else {
        try {
          const d = await fetch('/api/planning').then(r => r.json())
          const seen = new Set(); const list = []
          for (const p of (d.projects || [])) {
            const no = String(p.projectNo || p.jobNo || '')
            if (!no || seen.has(no)) continue
            seen.add(no); list.push({ projectNo: no, name: p.name || '' })
          }
          list.sort((a, b) => String(b.projectNo).localeCompare(String(a.projectNo), undefined, { numeric: true }))
          projects = list
        } catch {}
      }
      setState({ ready: true, user: u, isExternal, isInternal: isInternalRole(u.role), projects })
    } catch { router.replace('/') }
  })() }, [])

  return state
}

// Purple sub-nav across the Design pages (filtered to what the user can see).
export function DesignNav({ active, isInternal }) {
  const pages = DESIGN_PAGES.filter(p => !p.internalOnly || isInternal)
  return (
    <div style={{ background: '#faf9fd', borderBottom: '1px solid #ece9f5' }}>
      <div style={{ maxWidth: 1300, margin: '0 auto', padding: '0 20px', display: 'flex', gap: 2, height: 46, alignItems: 'center', overflowX: 'auto' }}>
        <Link href="/design" style={{ fontSize: 13, color: '#8a857c', textDecoration: 'none', paddingRight: 12, whiteSpace: 'nowrap' }}>‹ Design</Link>
        {pages.map(p => (
          <Link key={p.key} href={p.href} style={{
            fontSize: 13, textDecoration: 'none', padding: '8px 12px', whiteSpace: 'nowrap',
            color: active === p.key ? PURPLE : '#666', fontWeight: active === p.key ? 700 : 400,
            borderBottom: active === p.key ? `2px solid ${PURPLE}` : '2px solid transparent',
          }}>{p.label}</Link>
        ))}
      </div>
    </div>
  )
}

// A project picker (scoped list). Shows a select; remembers selection in the URL query.
export function DesignProjectPicker({ projects, value, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <label style={{ fontSize: 13, color: '#8a857c', fontWeight: 600 }}>Project</label>
      <select value={value || ''} onChange={e => onChange(e.target.value)}
        style={{ padding: '8px 11px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14, minWidth: 260 }}>
        <option value="">Select a project…</option>
        {projects.map(p => <option key={p.projectNo} value={p.projectNo}>{p.name ? `${p.projectNo} — ${p.name}` : p.projectNo}</option>)}
      </select>
    </div>
  )
}

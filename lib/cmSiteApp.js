import { useState, useEffect } from 'react'

// Shared helpers for the Contracts Manager area of the Site App.
// A user is treated as a CM (for gating the CM sections) if their name matches
// the Contracts Manager field on at least one Ops project. "My projects" are the
// projects whose Contracts Manager is this user.

const norm = (s) => (s || '').trim().toLowerCase()

export function nameMatches(userName, cmField) {
  const a = norm(userName), b = norm(cmField)
  if (!a || !b) return false
  if (a === b) return true
  // tolerate "first last" vs "last, first" and partial (first-name) matches on full names
  const at = a.split(/\s+/), bt = b.split(/\s+/)
  if (at.length >= 2 && bt.length >= 2) return at[0] === bt[0] && at[at.length - 1] === bt[bt.length - 1]
  return false
}

// Loads all Ops projects and returns { projects, myProjects, isCM, loading }.
export function useMyProjects(user) {
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    (async () => {
      try {
        const d = await fetch('/api/ops-projects').then(r => r.json())
        setProjects(d.projects || [])
      } catch {}
      setLoading(false)
    })()
  }, [])
  const myProjects = (projects || []).filter(p => nameMatches(user?.name, p.contractsManager))
  const isCM = myProjects.length > 0
  return { projects, myProjects, isCM, loading }
}

export const INK = '#1a1a19'
export const BRAND = '#ca8a04'
export const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
export const fmtDateTime = (t) => t ? new Date(t).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'

// A project picker used by the project-first CM screens.
export function ProjectPicker({ projects, onPick, subtitle }) {
  const list = [...(projects || [])].sort((a, b) => (a.projectNo || '').localeCompare(b.projectNo || '', undefined, { numeric: true }))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {subtitle && <p style={{ color: '#777', fontSize: 14, margin: '0 0 4px' }}>{subtitle}</p>}
      {list.length === 0 && <div style={{ background: '#fff', border: '1px dashed #d9d5cc', borderRadius: 14, padding: 24, textAlign: 'center', color: '#999', fontSize: 14 }}>No projects.</div>}
      {list.map(p => (
        <button key={p.projectNo} onClick={() => onPick(p)}
          style={{ display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', background: '#fff', border: '1px solid #e3e0d9', borderRadius: 14, padding: '16px', cursor: 'pointer', width: '100%' }}>
          <div style={{ fontSize: 22 }}>📁</div>
          <div style={{ flex: 1 }}><div style={{ fontSize: 15, fontWeight: 600, color: INK }}>{p.projectNo}{p.projectName && p.projectName !== p.projectNo ? ` — ${p.projectName}` : ''}</div></div>
          <div style={{ color: BRAND, fontSize: 20 }}>›</div>
        </button>
      ))}
    </div>
  )
}

// Header shown at the top of a project-first screen once a project is chosen.
export function ProjectHeader({ project, onBack, backLabel = '‹ Projects' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '4px 0 14px' }}>
      <button onClick={onBack} style={{ background: '#f2f2f0', border: 'none', borderRadius: 8, padding: '6px 12px', fontSize: 13, cursor: 'pointer', color: '#555' }}>{backLabel}</button>
      <div style={{ fontWeight: 700, color: INK, fontSize: 15 }}>{project.projectNo}{project.projectName && project.projectName !== project.projectNo ? ` — ${project.projectName}` : ''}</div>
    </div>
  )
}

export const inp = { width: '100%', boxSizing: 'border-box', padding: '11px 12px', border: '2px solid #e3e0d9', borderRadius: 12, fontSize: 15, fontFamily: 'inherit', outline: 'none' }
export const chipBtn = (active) => ({ padding: '8px 12px', borderRadius: 20, border: active ? `2px solid ${BRAND}` : '1px solid #e3e0d9', background: active ? '#fffbeb' : '#fff', color: active ? INK : '#777', fontWeight: active ? 700 : 500, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' })

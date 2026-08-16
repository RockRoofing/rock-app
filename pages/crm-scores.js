import { useState } from 'react'
import Head from 'next/head'
import * as XLSX from 'xlsx'

// ONE-OFF TOOL. Reads the Pipedrive Deals export and writes ONLY the "Label" column
// (Pipedrive's name for the project score) onto deals that already exist in the CRM.
//
// Why this is not just a re-import: a full import is wipe-and-replace. The CRM now holds
// things the export never had - filed email, conversation links, activities and notes
// created here, corrections made by hand. Recovering one dropped column is not worth
// losing those, so this touches the score and nothing else.
//
// Safe to run twice. It never overwrites a score already in the CRM, because the export
// is older than the CRM and what is here is the newer fact.

const INK = '#1a1a19'
const BRAND = '#1c704f'
const CHUNK = 2000

// Headers arrive either as "Deal - ID" or bare "ID" depending on how the export was
// taken. Both are accepted rather than making you care which you have.
function pick(row, ...names) {
  for (const n of names) {
    if (row[n] !== undefined && row[n] !== null && row[n] !== '') return row[n]
  }
  return null
}

export default function CrmScoreImport() {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [preview, setPreview] = useState(null)
  const [result, setResult] = useState(null)
  const [repaired, setRepaired] = useState(null)

  async function readFile(file) {
    if (!file) return
    setBusy(true); setMsg('Reading the file...'); setPreview(null); setResult(null)
    let rows
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null })
    } catch {
      setMsg('Could not read that file. It needs to be the Pipedrive Deals export (.xlsx or .csv), and not open in Excel at the same time.')
      setBusy(false); return
    }
    if (!rows || !rows.length) { setMsg('That file has no rows.'); setBusy(false); return }

    const headers = Object.keys(rows[0])
    const hasId = headers.some((h) => h === 'ID' || h === 'Deal - ID')
    const hasLabel = headers.some((h) => h === 'Label' || h === 'Deal - Label')
    if (!hasId || !hasLabel) {
      setMsg(`That does not look like the Deals export - it needs an ID column and a Label column. Found ${headers.length} columns, no ${!hasId ? 'ID' : 'Label'}.`)
      setBusy(false); return
    }

    const scores = []
    const dist = {}
    for (const r of rows) {
      const id = pick(r, 'ID', 'Deal - ID')
      const score = pick(r, 'Label', 'Deal - Label')
      if (id == null || score == null) continue
      const s = String(score).trim()
      if (!s) continue
      scores.push({ id: String(id).trim(), score: s })
      dist[s] = (dist[s] || 0) + 1
    }

    setPreview({ totalRows: rows.length, withScore: scores.length, dist, scores })
    setMsg('')
    setBusy(false)
  }

  async function apply() {
    if (!preview || !preview.scores.length) return
    setBusy(true); setResult(null)
    const totals = { updated: 0, unchanged: 0, notFound: 0, seen: 0 }
    try {
      // Chunked so the request body stays small, whatever the size of the export.
      for (let i = 0; i < preview.scores.length; i += CHUNK) {
        const batch = preview.scores.slice(i, i + CHUNK)
        setMsg(`Writing ${Math.min(i + batch.length, preview.scores.length)} of ${preview.scores.length}...`)
        const d = await fetch('/api/crm', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'patch-project-scores', scores: batch }),
        }).then((r) => r.json())
        if (!d || !d.ok) throw new Error(d?.error || 'Write failed')
        totals.updated += d.updated; totals.unchanged += d.unchanged
        totals.notFound += d.notFound; totals.seen += d.seen
      }
      setResult(totals); setMsg('')
    } catch (e) {
      setMsg(`Stopped: ${e.message || 'that did not save'}. Anything already written stays written - run it again and it will pick up where it left off.`)
    }
    setBusy(false)
  }

  async function repair() {
    setBusy(true); setRepaired(null); setMsg('Checking every won and lost deal...')
    try {
      const d = await fetch('/api/crm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'repair-close-dates' }),
      }).then((r) => r.json())
      if (!d || !d.ok) throw new Error(d?.error || 'Failed')
      setRepaired(d); setMsg('')
    } catch (e) {
      setMsg(`Could not repair: ${e.message || 'that did not work'}`)
    }
    setBusy(false)
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f7f6f2', fontFamily: 'ui-sans-serif, system-ui, sans-serif', color: INK }}>
      <Head><title>Rock Roofing — Project Scores</title></Head>

      <div style={{ background: '#1a1a19', color: '#fff', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 17, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
          <img src="/rock-logo.jpg" alt="Rock Roofing" style={{ height: 32, width: 32, borderRadius: 4 }} />Rock Roofing
        </span>
        <a href="/crm" style={{ color: '#fff', border: '1px solid #444', borderRadius: 6, padding: '5px 12px', fontSize: 13, textDecoration: 'none' }}>&larr; CRM</a>
      </div>

      <div style={{ maxWidth: 760, margin: '0 auto', padding: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>Project scores from the Pipedrive export</h1>
        <p style={{ fontSize: 14, color: '#555', lineHeight: 1.55, marginTop: 0 }}>
          Pipedrive calls the project score <strong>Label</strong>. It was in the export but the original
          import never read it, so every score was dropped. This puts them back &mdash; and <strong>only</strong> them.
          Nothing else on any deal is touched: not the stage, not the value, not filed email, not activities.
        </p>
        <p style={{ fontSize: 13, color: '#555', lineHeight: 1.55, background: '#fff', border: '1px solid #e1e0d9', borderRadius: 8, padding: 12 }}>
          Safe to run more than once. A score already typed into the CRM is never overwritten &mdash; the
          export is older than the CRM, so what is here is the newer fact.
        </p>

        <div style={{ background: '#fff', border: '1px solid #e1e0d9', borderRadius: 10, padding: 18, marginTop: 16 }}>
          <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 8 }}>Pipedrive Deals export (.xlsx or .csv)</label>
          <input type="file" accept=".xlsx,.xls,.csv" disabled={busy}
            onChange={(e) => readFile(e.target.files && e.target.files[0])}
            style={{ fontSize: 13 }} />
          {msg && <div style={{ fontSize: 13, color: '#555', marginTop: 12 }}>{msg}</div>}
        </div>

        {preview && (
          <div style={{ background: '#fff', border: '1px solid #e1e0d9', borderRadius: 10, padding: 18, marginTop: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>What is in the file</div>
            <div style={{ fontSize: 13.5, marginBottom: 12 }}>
              {preview.totalRows.toLocaleString()} rows, <strong>{preview.withScore.toLocaleString()}</strong> carrying a score.
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
              {Object.keys(preview.dist).sort((a, b) => Number(a) - Number(b)).map((k) => (
                <span key={k} style={{ fontSize: 12, background: '#f3f4f6', borderRadius: 5, padding: '3px 9px' }}>
                  scored {k}: <strong>{preview.dist[k]}</strong>
                </span>
              ))}
            </div>
            <button onClick={apply} disabled={busy || !preview.withScore}
              style={{ background: BRAND, color: '#fff', border: 'none', borderRadius: 7, padding: '9px 18px', fontSize: 14, fontWeight: 600, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.5 : 1, fontFamily: 'inherit' }}>
              {busy ? 'Writing...' : `Write ${preview.withScore.toLocaleString()} scores to the CRM`}
            </button>
          </div>
        )}

        <div style={{ background: '#fff', border: '1px solid #e1e0d9', borderRadius: 10, padding: 18, marginTop: 24 }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Repair missing close dates</div>
          <p style={{ fontSize: 13, color: '#555', lineHeight: 1.55, marginTop: 0 }}>
            Separate job, no file needed. Marking a deal Won or Lost in the CRM did not stamp the date
            it happened, so those deals had no close date and dropped out of every date-filtered view on
            the dashboard and scorecards. The history recorded the date at the time, so this recovers it.
            Only fills blanks &mdash; never changes a date that is already there. Safe to run twice.
          </p>
          <button onClick={repair} disabled={busy}
            style={{ background: '#1a1a19', color: '#fff', border: 'none', borderRadius: 7, padding: '9px 18px', fontSize: 14, fontWeight: 600, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.5 : 1, fontFamily: 'inherit' }}>
            {busy ? 'Working...' : 'Repair close dates'}
          </button>
          {repaired && (
            <div style={{ fontSize: 13.5, lineHeight: 1.7, marginTop: 12 }}>
              <div><strong>{repaired.fixed}</strong> close dates recovered</div>
              <div><strong>{repaired.alreadyOk}</strong> already had one</div>
              <div><strong>{repaired.noHistory}</strong> decided with no history entry to date them from</div>
            </div>
          )}
        </div>

        {result && (
          <div style={{ background: '#e8f5ee', border: `1px solid ${BRAND}`, borderRadius: 10, padding: 18, marginTop: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Done</div>
            <div style={{ fontSize: 13.5, lineHeight: 1.7 }}>
              <div><strong>{result.updated.toLocaleString()}</strong> scores written</div>
              <div><strong>{result.unchanged.toLocaleString()}</strong> already had a score, left alone</div>
              <div><strong>{result.notFound.toLocaleString()}</strong> not in the CRM (deleted, or a non-Project pipeline)</div>
            </div>
            <div style={{ fontSize: 12.5, color: '#555', marginTop: 12 }}>
              Open any scored project and the score is on it, under Project Score. Note that this does
              not make the &ldquo;Glenigan scored 5 or more&rdquo; card move for past months &mdash; that
              needs the date each project entered Received, which the export does not contain. It does
              mean anything entering Received from now on already carries its score.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

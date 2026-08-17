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
  const [dupes, setDupes] = useState(null)
  const [actDates, setActDates] = useState(null)
  const [mention, setMention] = useState(null)
  const [testResult, setTestResult] = useState(null)
  const [testTo, setTestTo] = useState('')

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

  // One-off: give every activity the same date under both field names.
  async function repairActivityDates() {
    setBusy(true); setActDates(null); setMsg('Checking every activity...')
    try {
      const d = await fetch('/api/crm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'repair-activity-dates' }),
      }).then((r) => r.json())
      setActDates(d); setMsg('')
    } catch (e) { setMsg(`Could not run: ${e.message || 'failed'}`) }
    setBusy(false)
  }

  async function checkDupes(fix) {
    setBusy(true); setDupes(null); setMsg(fix ? 'Renumbering...' : 'Checking...')
    try {
      const d = await fetch('/api/crm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: fix ? 'fix-duplicate-ids' : 'find-duplicate-ids' }),
      }).then((r) => r.json())
      setDupes(d); setMsg('')
    } catch (e) { setMsg(`Could not run: ${e.message || 'failed'}`) }
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

  // Reports why an @mention email did or did not go, without sending one.
  async function checkMentions() {
    setBusy(true); setMention(null); setMsg('Checking...')
    try {
      const d = await fetch('/api/crm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mention-diagnose', body: '@' }),
      }).then((r) => r.json())
      setMention(d); setMsg('')
    } catch (e) { setMsg(`Could not check: ${e.message || 'failed'}`) }
    setBusy(false)
  }

  // Sends a real email down the identical path a mention uses.
  async function sendTest() {
    setBusy(true); setTestResult(null); setMsg('Sending...')
    try {
      const d = await fetch('/api/crm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mention-test-send', to: testTo.trim() || undefined }),
      }).then((r) => r.json())
      setTestResult(d); setMsg('')
    } catch (e) { setTestResult({ ok: false, error: e.message || 'failed' }); setMsg('') }
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

        <div style={{ background: '#fff', border: '2px solid #b91c1c', borderRadius: 10, padding: 18, marginTop: 24 }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6, color: '#b91c1c' }}>Duplicate project ids</div>
          <p style={{ fontSize: 13, color: '#555', lineHeight: 1.55, marginTop: 0 }}>
            New projects took their id from a counter that restarted at 900000 every browser session,
            so projects created on different days could share one. The CRM opens the FIRST project with
            a given id &mdash; which is why clicking one project opened another. Check first; it lists
            them without changing anything.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => checkDupes(false)} disabled={busy}
              style={{ background: '#1a1a19', color: '#fff', border: 'none', borderRadius: 7, padding: '9px 16px', fontSize: 13.5, fontWeight: 600, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.5 : 1, fontFamily: 'inherit' }}>
              Check for duplicates
            </button>
            {dupes && dupes.duplicates && dupes.duplicates.length > 0 && (
              <button onClick={() => { if (window.confirm('Renumber the duplicates? The first project with each id keeps it; later ones get a new id. Their activities and notes move with them.')) checkDupes(true) }} disabled={busy}
                style={{ background: '#b91c1c', color: '#fff', border: 'none', borderRadius: 7, padding: '9px 16px', fontSize: 13.5, fontWeight: 600, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.5 : 1, fontFamily: 'inherit' }}>
                Renumber {dupes.duplicates.length}
              </button>
            )}
          </div>
          {dupes && (
            <div style={{ fontSize: 13, marginTop: 12, lineHeight: 1.7 }}>
              {dupes.duplicates && (dupes.duplicates.length
                ? <>
                    <div style={{ color: '#b91c1c', fontWeight: 600 }}>{dupes.duplicates.length} duplicate id{dupes.duplicates.length === 1 ? '' : 's'} of {dupes.total} projects</div>
                    <ul style={{ paddingLeft: 18, color: '#555' }}>
                      {dupes.duplicates.map((x, i) => <li key={i}>id {x.id}: &ldquo;{x.duplicate}&rdquo; is hidden behind &ldquo;{x.keeps}&rdquo;</li>)}
                    </ul>
                  </>
                : <div style={{ color: '#15803d' }}>No duplicates. {dupes.total} projects checked.</div>)}
              {dupes.moved && <div style={{ color: '#15803d' }}>Renumbered {dupes.moved.length}. {dupes.note}</div>}
            </div>
          )}
        </div>

        <div style={{ background: '#fff', border: '1px solid #e1e0d9', borderRadius: 10, padding: 18, marginTop: 24 }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Repair activity due dates</div>
          <p style={{ fontSize: 13, color: '#555', lineHeight: 1.55, marginTop: 0 }}>
            Activities created in the CRM stored their date under one field name and the deal view
            read another, so the date showed on the Activities list and the deal said &ldquo;No due
            date&rdquo;. Fixed going forward &mdash; this brings existing activities into line.
            Changes nothing that is already correct. Safe to run twice.
          </p>
          <button onClick={repairActivityDates} disabled={busy}
            style={{ background: '#1a1a19', color: '#fff', border: 'none', borderRadius: 7, padding: '9px 18px', fontSize: 14, fontWeight: 600, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.5 : 1, fontFamily: 'inherit' }}>
            {busy ? 'Working...' : 'Repair activity dates'}
          </button>
          {actDates && (
            <div style={{ fontSize: 13.5, lineHeight: 1.7, marginTop: 12, color: '#15803d' }}>
              <strong>{actDates.recordsFixed}</strong> activities repaired across <strong>{actDates.dealsTouched}</strong> projects.
            </div>
          )}
        </div>

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

        <div style={{ background: '#fff', border: '1px solid #e1e0d9', borderRadius: 10, padding: 18, marginTop: 24 }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Check @mention email</div>
          <p style={{ fontSize: 13, color: '#555', lineHeight: 1.55, marginTop: 0 }}>
            Sends nothing. Reports who can be mentioned, whether the mail service is configured, and
            which address it would send from &mdash; which is usually where the answer is.
          </p>
          <button onClick={checkMentions} disabled={busy}
            style={{ background: '#1a1a19', color: '#fff', border: 'none', borderRadius: 7, padding: '9px 18px', fontSize: 14, fontWeight: 600, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.5 : 1, fontFamily: 'inherit' }}>
            {busy ? 'Checking...' : 'Check mention email'}
          </button>
          {mention && (
            <div style={{ fontSize: 13, lineHeight: 1.8, marginTop: 12 }}>
              <div>Email service configured: <strong style={{ color: mention.resendConfigured ? '#15803d' : '#b91c1c' }}>{mention.resendConfigured ? 'yes' : 'NO - RESEND_API_KEY is missing'}</strong></div>
              <div>Sending from: <strong style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>{mention.from}</strong></div>
              {String(mention.from || '').includes('resend.dev') && (
                <div style={{ color: '#b45309', marginTop: 6 }}>
                  That is Resend&rsquo;s test sender. It only delivers to the address that owns the Resend
                  account &mdash; everyone else is rejected, silently as far as the CRM is concerned.
                  Set <strong>FORMS_FROM_EMAIL</strong> in Vercel to a verified rockroofing.co.uk address.
                </div>
              )}
              <div style={{ marginTop: 8 }}>People who can be mentioned: <strong>{(mention.mentionableUsers || []).length}</strong></div>
              {!(mention.mentionableUsers || []).length && (
                <div style={{ color: '#b91c1c' }}>
                  Nobody. A user needs an email address on their portal account AND a pre-contract or
                  admin role. Without an address there is nowhere to send.
                </div>
              )}
              <ul style={{ margin: '6px 0 0', paddingLeft: 18, color: '#555' }}>
                {(mention.mentionableUsers || []).map((u) => <li key={u.email}>{u.name} &mdash; {u.email}</li>)}
              </ul>
            </div>
          )}

          <div style={{ borderTop: '1px solid #eee', marginTop: 16, paddingTop: 14 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 6 }}>Send a real test email</div>
            <p style={{ fontSize: 12.5, color: '#555', marginTop: 0, lineHeight: 1.5 }}>
              Uses the identical path a mention uses. If this arrives, the email chain is sound and
              anything still missing is about who got matched, not about email. Blank sends to you.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@rockroofing.co.uk"
                style={{ flex: 1, minWidth: 220, padding: '8px 10px', fontSize: 13, border: '1px solid #d9d9d4', borderRadius: 6, fontFamily: 'inherit' }} />
              <button onClick={sendTest} disabled={busy}
                style={{ background: BRAND, color: '#fff', border: 'none', borderRadius: 7, padding: '9px 16px', fontSize: 13.5, fontWeight: 600, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.5 : 1, fontFamily: 'inherit' }}>
                Send test
              </button>
            </div>
            {testResult && (
              <div style={{ fontSize: 13, marginTop: 10, color: testResult.ok ? '#15803d' : '#b91c1c', lineHeight: 1.6 }}>
                {testResult.ok
                  ? `Sent to ${testResult.to}. Check that inbox, and the spam folder.`
                  : `Not sent. ${testResult.error || 'Unknown reason.'}`}
              </div>
            )}
          </div>
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

import { useState, useEffect, useMemo } from 'react'
import OperationsShell, { PageHeading } from '../../components/OperationsShell'
import { INK, GOLD, Loading, ghostBtn, th, td } from '../../components/opsUI'

const DAY = 86400000
const parseISO = (s) => { if (!s) return null; const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1) }
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const mondayOf = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); const wd = (x.getDay() + 6) % 7; return new Date(x.getTime() - wd * DAY) }
const wcLabel = (m) => `W/C ${parseISO(m).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`

const FORM_ORDER = ['Pre-Start', 'Start on Site Checklist', 'Daily Site Diary', 'Works Area Handover', 'Water Ingress Report']

export default function FormsMissingPage() {
  const thisMon = iso(mondayOf(new Date()))
  const [fromMon, setFromMon] = useState(thisMon)
  const [toMon, setToMon] = useState(thisMon)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showOnly, setShowOnly] = useState('all')   // all | missing | done
  const [fForm, setFForm] = useState('')
  const [fPerson, setFPerson] = useState('')

  const wcOptions = useMemo(() => {
    const base = mondayOf(new Date()); const opts = []
    for (let i = -104; i <= 52; i++) opts.push(iso(new Date(base.getTime() + i * 7 * DAY)))
    return opts
  }, [])

  async function load() {
    setLoading(true)
    try {
      const d = await fetch(`/api/forms-missing?from=${encodeURIComponent(fromMon)}&to=${encodeURIComponent(toMon)}`).then(r => r.json())
      setData(d)
    } catch { setData({ rows: [], summary: { required: 0, completed: 0, pct: 100 }, byForm: {} }) }
    setLoading(false)
  }
  useEffect(() => { load() }, [fromMon, toMon])

  const people = useMemo(() => data ? [...new Set(data.rows.map(r => r.responsible).filter(v => v && v !== '—'))].sort() : [], [data])

  const rows = useMemo(() => {
    if (!data) return []
    return data.rows.filter(r => {
      if (showOnly === 'missing' && (r.done || r.upcoming)) return false
      if (showOnly === 'done' && !r.done) return false
      if (fForm && r.formType !== fForm) return false
      if (fPerson && r.responsible !== fPerson) return false
      return true
    }).sort((a, b) => a.week.localeCompare(b.week) || a.projectNo.localeCompare(b.projectNo, undefined, { numeric: true }) || FORM_ORDER.indexOf(a.formType) - FORM_ORDER.indexOf(b.formType))
  }, [data, showOnly, fForm, fPerson])

  return (
    <OperationsShell active="forms:missing" section="forms" title="Forms — Missing" wide>
      <PageHeading title="Forms — Missing" sub="Required vs completed tracked forms for the selected weeks, with the person responsible." />

      {/* range */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
        <div><div style={lbl}>From</div>
          <select value={fromMon} onChange={e => { const v = e.target.value; setFromMon(v); if (parseISO(v) > parseISO(toMon)) setToMon(v) }} style={{ ...fInput, minWidth: 180, fontFamily: 'inherit' }}>
            {wcOptions.map(m => <option key={m} value={m}>{wcLabel(m)}</option>)}
          </select>
        </div>
        <div><div style={lbl}>To</div>
          <select value={toMon} onChange={e => setToMon(e.target.value)} style={{ ...fInput, minWidth: 180, fontFamily: 'inherit' }}>
            {wcOptions.filter(m => parseISO(m) >= parseISO(fromMon)).map(m => <option key={m} value={m}>{wcLabel(m)}</option>)}
          </select>
        </div>
      </div>

      {loading || !data ? <Loading /> : (
        <>
          {/* summary cards */}
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 16 }}>
            <Card>
              <div style={cardNum}>{data.summary.pct}%</div>
              <div style={cardLbl}>Completed</div>
              <Bar pct={data.summary.pct} />
              <div style={{ fontSize: 12, color: '#666', marginTop: 6 }}>{data.summary.completed} of {data.summary.required} required forms</div>
            </Card>
            {FORM_ORDER.map(ft => {
              const b = data.byForm[ft] || { required: 0, completed: 0 }
              const pct = b.required ? Math.round((b.completed / b.required) * 100) : 100
              return (
                <Card key={ft} small>
                  <div style={{ fontSize: 13, fontWeight: 700, color: INK, marginBottom: 4 }}>{ft}</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: pct === 100 ? '#16a34a' : (pct >= 50 ? '#ca8a04' : '#dc2626') }}>{pct}%</div>
                  <div style={{ fontSize: 12, color: '#666' }}>{b.completed}/{b.required} done{b.required - b.completed > 0 ? ` · ${b.required - b.completed} missing` : ''}</div>
                </Card>
              )
            })}
          </div>

          {/* filters */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 10 }}>
            <div><div style={lbl}>Status</div>
              <select value={showOnly} onChange={e => setShowOnly(e.target.value)} style={{ ...fInput, fontFamily: 'inherit' }}>
                <option value="all">All statuses</option>
                <option value="missing">Missing</option>
                <option value="done">Completed</option>
              </select>
            </div>
            <div><div style={lbl}>Form</div>
              <select value={fForm} onChange={e => setFForm(e.target.value)} style={{ ...fInput, fontFamily: 'inherit' }}>
                <option value="">All forms</option>
                {FORM_ORDER.map(ft => <option key={ft} value={ft}>{ft}</option>)}
              </select>
            </div>
            <div><div style={lbl}>Responsible</div>
              <select value={fPerson} onChange={e => setFPerson(e.target.value)} style={{ ...fInput, minWidth: 150, fontFamily: 'inherit' }}>
                <option value="">Anyone</option>
                {people.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            {(showOnly !== 'all' || fForm || fPerson) && <button onClick={() => { setShowOnly('all'); setFForm(''); setFPerson('') }} style={{ ...ghostBtn, padding: '7px 12px' }}>Clear</button>}
            <div style={{ marginLeft: 'auto', fontSize: 12.5, color: '#666', alignSelf: 'center' }}>{rows.length} row{rows.length === 1 ? '' : 's'}</div>
          </div>

          {/* table */}
          <div style={{ border: '1px solid #ececec', borderRadius: 12, overflow: 'auto', background: '#fff' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
              <thead>
                <tr style={{ background: '#faf9f7' }}>
                  <th style={{ ...th, textAlign: 'left' }}>Week</th>
                  <th style={{ ...th, textAlign: 'left' }}>Project</th>
                  <th style={{ ...th, textAlign: 'left' }}>Form</th>
                  <th style={{ ...th, textAlign: 'left' }}>Responsible</th>
                  <th style={{ ...th, textAlign: 'center' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={5} style={{ ...td, color: '#aaa', textAlign: 'center', padding: 20 }}>No required forms for this range/filters.</td></tr>}
                {rows.map((r, i) => (
                  <tr key={i} style={{ borderTop: '1px solid #f2f2f2', background: r.upcoming ? '#f5fbff' : (r.done ? '#fff' : '#fffaf7') }}>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{parseISO(r.week).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })}</td>
                    <td style={td}>{r.projectNo}{r.projectName && r.projectName !== r.projectNo ? ` — ${r.projectName}` : ''}</td>
                    <td style={td}>{r.formType}{r.day ? <span style={{ color: '#999', fontSize: 11 }}> · {parseISO(r.day).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' })}</span> : ''}</td>
                    <td style={td}>{r.responsible}{r.role ? <span style={{ color: '#aaa', fontSize: 11 }}> ({r.role})</span> : ''}</td>
                    <td style={{ ...td, textAlign: 'center' }}>
                      {r.upcoming
                        ? <span style={{ fontSize: 11.5, color: '#0369a1', background: '#e0f2fe', padding: '2px 10px', borderRadius: 12, fontWeight: 600 }} title="Water-ingress visit within the next 2 weeks — will be required once marked Actual on the Gantt">Upcoming</span>
                        : r.done
                        ? <span style={{ fontSize: 11.5, color: '#16a34a', background: '#dcfce7', padding: '2px 10px', borderRadius: 12, fontWeight: 600 }}>Completed</span>
                        : <span style={{ fontSize: 11.5, color: '#b91c1c', background: '#fee2e2', padding: '2px 10px', borderRadius: 12, fontWeight: 600 }}>Missing</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11.5, color: '#999', marginTop: 8 }}>“Responsible” is who receives the Monday notification: the Contracts Manager for Pre-Start, and the designated Site Supervisor (or the qualified supervisor allocated on the Gantt) for the other forms.</div>
        </>
      )}
    </OperationsShell>
  )
}

const Card = ({ children, small }) => <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, padding: 16, minWidth: small ? 150 : 210, flex: small ? '0 0 auto' : '0 0 auto' }}>{children}</div>
const Bar = ({ pct }) => (
  <div style={{ height: 8, background: '#f0efe9', borderRadius: 6, overflow: 'hidden', marginTop: 8 }}>
    <div style={{ width: `${pct}%`, height: '100%', background: pct === 100 ? '#16a34a' : (pct >= 50 ? GOLD : '#dc2626') }} />
  </div>
)
const cardNum = { fontSize: 34, fontWeight: 800, color: INK, lineHeight: 1 }
const cardLbl = { fontSize: 12, color: '#888', marginTop: 2 }
const lbl = { fontSize: 11, color: '#888', marginBottom: 3 }
const fInput = { padding: '7px 9px', borderRadius: 8, border: '1px solid #e0e0e0', fontSize: 12.5 }

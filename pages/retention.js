import { useState, useEffect, useRef, useMemo } from 'react'
import * as XLSX from 'xlsx'
import Head from 'next/head'
import Link from 'next/link'
import CommercialNav from '../components/CommercialNav'
import SyncBar from '../components/SyncBar'

// The register is ~26 columns wide. The table used width:100%, which made it SHRINK to
// fit its container rather than overflow it - so there was nothing to scroll, columns
// just squeezed until they were unreadable, and a scrollbar only appeared once zooming
// out made the viewport narrower than the content itself. TABLE_MIN_WIDTH forces the
// overflow so the bar is there whenever it is needed.
const TABLE_MIN_WIDTH = 2400
const naCell = { padding: '8px 10px', whiteSpace: 'nowrap', color: '#bbb', textAlign: 'center' }

const fmt = (n) => n == null || n === '' ? '—' : new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
// Module scope, beside the other formatters. This file has no date formatter of its own
// and gbp/fmtD live on OTHER pages - referencing one here compiles and then throws on
// render, which is exactly how the tracker went down a moment ago.
const fmtD = (iso) => { if (!iso) return '-'; const [y, m, d] = String(iso).split('-'); return `${d}/${m}/${String(y).slice(2)}` }

const fmtC = (n) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0)

const EMPTY_ENTRY = {
  ourRef: '', customerName: '', projectName: '', projectValue: '', finalAccount: '',
  retentionPct: '', completionDate: '', pcType: '',
  qsName: '', qsEmail: '',
  certified: '',
  release1Value: '', release1Date: '', release1Received: false,
  release2Value: '', release2Date: '', release2Received: false,
  comments: '',
  trackerOnly: true,   // entries created via the Add form live ONLY in the tracker
}

// Parse a numeric VAT rate from a VAT-type label. Reverse charge / zero-rated /
// exempt / no-VAT all = 0. "20%" -> 0.20, "5%" -> 0.05.
// INLINE EDITABLE NUMBER CELL.
//
// Defined at MODULE scope on purpose. A component declared inside another component
// is a new type on every render, so React unmounts and remounts the subtree - which
// is the classic "input loses focus after one keystroke" bug.
//
// Local state while typing, committed on blur or Enter, abandoned on Escape. The value
// only goes through the page's existing saveEntry path, so a Xero-derived row still
// becomes a manual override in the normal way rather than taking a second code path.
function InlineNumberCell({ value, onCommit, disabled, note, title }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [hover, setHover] = useState(false)
  const start = () => {
    if (disabled) return
    setDraft(value == null || value === '' ? '' : String(value))
    setEditing(true)
  }
  const commit = () => {
    setEditing(false)
    const before = value == null || value === '' ? '' : String(value)
    if (draft === before) return
    onCommit(draft === '' ? '' : String(parseFloat(draft) || 0))
  }
  if (editing) {
    return (
      <td style={{ padding: '4px 6px', textAlign: 'right', whiteSpace: 'nowrap' }}>
        <input
          type="number" autoFocus value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() }
            if (e.key === 'Escape') { e.preventDefault(); setEditing(false) }
          }}
          style={{ width: 100, padding: '3px 5px', fontSize: 12, textAlign: 'right', border: '1px solid #1c704f', borderRadius: 4 }}
        />
      </td>
    )
  }
  const empty = value == null || value === ''
  // The affordance has to read as editable WITHOUT being clicked. A dashed underline
  // alone was too quiet - it looks like every other tooltip hint on the page. So:
  // a boxed cell, a pencil that darkens on hover, and the word "Add" where it is empty.
  return (
    <td onClick={start}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={title || (disabled ? '' : 'Click to edit. Enter saves, Escape cancels.')}
      style={{ padding: '5px 6px', textAlign: 'right', whiteSpace: 'nowrap', cursor: disabled ? 'default' : 'pointer' }}>
      {disabled ? (
        <span style={{ color: '#555' }} >{empty ? '\u2014' : fmt(parseFloat(value))}</span>
      ) : (
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 5, justifyContent: 'flex-end',
          minWidth: 92, padding: '3px 6px', borderRadius: 4,
          border: `1px solid ${hover ? '#1c704f' : '#e2e8f0'}`,
          background: hover ? '#f0fdf4' : '#fcfcfd',
          transition: 'background .1s, border-color .1s',
        }}>
          <span style={{ color: empty ? '#9aa5b1' : '#555', fontStyle: empty ? 'italic' : 'normal' }}>
            {empty ? 'Add' : fmt(parseFloat(value))}
          </span>
          <span aria-hidden="true" style={{ fontSize: 10, lineHeight: 1, color: hover ? '#1c704f' : '#c3cbd4' }}>&#9998;</span>
        </span>
      )}
      {note ? <div style={{ fontSize: 9, color: '#bbb', paddingRight: 2 }}>{note}</div> : null}
    </td>
  )
}

// ONE ACCOUNT BASE FOR EVERY DERIVED FIGURE ON THIS PAGE.
//
// Six functions each wrote `entry.finalAccount || entry.projectValue`, and that
// fallback is a PRE-MCD figure: projectValue is p.contractValue on project-derived
// rows - the original contract value, before MCD and before variations - and the
// imported "Gross AFA" column on imported ones.
//
// So wherever Final Account was blank, VAT, Total Due, Account Remaining, the
// final-account balance and the retention-closing check were all computed on the
// gross and came out high by the whole discount.
//
// Falls back to gross LESS the MCD actually recorded, and only to the raw gross when
// no MCD is known - in which case there is genuinely no discount to apply.
// EVERY DASHBOARD-DERIVED FIELD, IN ONE PLACE.
//
// A tracker row is built TWICE - once from a project that has no saved entry, and
// once by merging a saved entry with live data - and the two field lists had drifted
// apart. appliedForDetail, certifiedSetOnApp, mcdBasis, afaFromApp and the stamp
// fields were added to the merge only.
//
// So on every row WITHOUT a saved entry the Applied for drill-down received nothing
// and reported "No application data for this project" on projects that plainly had
// sent applications - which is exactly what made the last three diagnoses guesswork.
// The diagnostic was blind, and it was blind in a way that looked like an answer.
function dashFields(p) {
  return {
    appliedForLatest: p.appliedForLatest || 0,
    certifiedGross: p.certifiedGross,
    certifiedSetOnApp: !!p.certifiedSetOnApp,
    // The application only OWNS this cell when its box holds a real figure. A first
    // application carries 0, which tells you nothing and must not lock the cell.
    certifiedLocked: !!(p.certifiedSetOnApp && Number(p.certifiedGross)),
    certifiedFromApp: p.certifiedFromApp || '',
    appliedForDetail: p.appliedForDetail || null,
    afaGross: p.afaGross != null ? p.afaGross : null,
    afaSource: p.afaSource || '',
    afaOverrideIgnored: !!p.afaOverrideIgnored,
    afaStampStale: !!p.afaStampStale,
    afaStamped: p.afaStamped != null ? p.afaStamped : null,
    afaStampedFromApp: !!p.afaStampedFromApp,
    afaStampedAppSeq: p.afaStampedAppSeq || null,
    afaShown: p.afaShown != null ? p.afaShown : null,
    afaUsedStamp: !!p.afaUsedStamp,
    afaFromApp: !!p.afaFromApp,
    mcdBasis: p.mcdBasis || '',
    mcdPct: p.mcdPct != null ? p.mcdPct : 0,
    mcdRecorded: !!p.mcdRecorded,
    mcdValue: p.mcdValue || 0,
  }
}

function accountValue(entry) {
  const fa = parseFloat(entry.finalAccount || 0) || 0
  if (fa) return fa
  const gross = parseFloat(entry.afaGross || entry.projectValue || 0) || 0
  const mcd = parseFloat(entry.mcdValue || 0) || 0
  return mcd ? gross - mcd : gross
}

function vatRateFromLabel(label) {
  const s = (label || '').toLowerCase()
  if (s.includes('reverse charge') || s.includes('zero') || s.includes('exempt') || s.includes('no vat')) return 0
  const m = /(\d+(?:\.\d+)?)\s*%/.exec(label || '')
  return m ? parseFloat(m[1]) / 100 : 0
}
// VAT = Final Account × rate (per the VAT type). Reverse charge / 0% = £0.
// If the VAT type is "Mixed" (invoices carry different treatments), a single rate
// can't be applied — VAT must be entered manually (vatManual).
function vatIsMixed(entry) {
  return (entry.vatRateLabel || '').toLowerCase() === 'mixed'
}
function vatNeedsManual(entry) {
  // Mixed, or a VAT type we can't turn into a rate, with no manual figure yet.
  if (entry.vatManual != null && entry.vatManual !== '') return false
  return vatIsMixed(entry)
}
function calcVat(entry) {
  // A manual VAT figure always wins (used for Mixed, or to override).
  if (entry.vatManual != null && entry.vatManual !== '' && !isNaN(parseFloat(entry.vatManual))) {
    return parseFloat(entry.vatManual)
  }
  if (vatIsMixed(entry)) return 0   // unknown until entered manually
  const fa = accountValue(entry)
  return fa * vatRateFromLabel(entry.vatRateLabel)
}
// Total Due = Final Account + VAT.
function calcTotalDue(entry) {
  const fa = accountValue(entry)
  return fa + calcVat(entry)
}
// Account Remaining = Final Account - APPLIED FOR (ex-VAT).
//
// It measured against INVOICED, which answers a different question. Invoicing lags the
// application by weeks, so a project that had applied for everything still read as having
// value left to claim purely because the invoice had not been raised.
//
// What is left to CLAIM is measured against what has been applied for. Falls back to
// invoiced only where there is no application - the same rule the retention figures use.
// RETENTION OWED = APPLIED FOR x RET %.
//
// Exactly the two columns beside it, and nothing else. It was being built in two
// different places - once for project-derived rows and once when a saved entry is merged
// with live data - each from its own set of external fields, and neither agreed with what
// was on screen. J109 read 5% and £112,263.79 in two columns and £0.00 in the third.
//
// Both figures are already resolved by the time a row is rendered. Deriving from them
// means the three cells can be read across, and there is one rule instead of two.
export function calcRetentionOwed(entry) {
  const pct = parseFloat(entry.retentionPct || 0) || 0
  const base = parseFloat(entry.appliedFor || 0) || 0
  if (pct <= 0 || base <= 0) return 0
  // Whole numbers on tracker rows (5), fractions on project records (0.05).
  return base * (pct > 1 ? pct / 100 : pct)
}

// EACH RELEASE HALF = HALF THE RETENTION OWED.
//
// The imported spreadsheet values were stale: J147 carried 289.03 a half, which is half
// of the App 1 deduction of 578.05 - the only application that existed when the sheet was
// built. Nothing recalculated them as later applications added retention, and an imported
// value beat the computed one because release1Value was never in the merge's override
// list.
//
// Computed from the row now, so the two halves always sum to Retention Owed. J147 becomes
// 559.09 each against 1,118.19 owed.
// FLAGGED, NOT CHANGED - the basis here contradicts the column tooltip.
//
// This returns half of retention on APPLIED FOR (work certified to date). The tooltip
// on both release columns says "half of the retention on the FINAL ACCOUNT", and
// lib/applications.js computes halfRetention = finalSubTotal x ret% / 2, which is what
// the certificate releases. pkg782 set the final-account basis deliberately; pkg785-787
// rebased Retention Owed onto Applied for and this followed it, which reverted that
// decision as a side effect rather than as a choice.
//
// Both are MCD-correct - Applied for and finalSubTotal each honour the placement flags -
// so this is not an MCD fault. It is a base fault, and it only shows mid-contract: the
// two converge once the job is fully applied for.
//
// The final-account figure is already on the row as entry.retentionOnFinalAccount, so
// switching is one line. Not done unasked, because it moves the halves on every live
// project.
export function calcReleaseHalf(entry) {
  return calcRetentionOwed(entry) / 2
}

function calcAccountRemaining(entry) {
  const fa = accountValue(entry)
  // READ THE COLUMN, NOT A PARALLEL FIELD.
  //
  // This read entry.appliedForLatest, which the merge never carries onto a saved row -
  // only project-derived rows had it. On every saved row it was undefined, so Account
  // Remaining silently measured against INVOICED, which is the exact thing the comment
  // above says it must not do. entry.appliedFor is the resolved value on screen.
  const applied = parseFloat(entry.appliedFor || entry.appliedForLatest || 0) || 0
  const invNet = parseFloat(entry.invoicedNet != null ? entry.invoicedNet : entry.invoiced || 0) || 0
  return fa - (applied > 0 ? applied : invNet)
}
// Total Remaining (Check) = Total Due (inc VAT) − Total Paid (inc VAT).
// Hits £0 when everything (incl. VAT) has been paid → retention closed.
function calcTotalRemaining(entry) {
  return calcTotalDue(entry) - (parseFloat(entry.paid || 0) || 0)
}
// Retention lifecycle status: 'live' -> 'defects' -> 'complete' (all manual, gated).
// Older records used a markedComplete boolean; treat that as 'complete'.
const retStatusOf = (entry) => entry.retStatus || (entry.markedComplete ? 'complete' : 'live')
const isClosed = (entry) => retStatusOf(entry) === 'complete'

// IS A HALF RELEASED?
//
// Two ways, and both are needed. A project run through the app ticks its retention
// halves on an APPLICATION, and that should mark the register off by itself. A project
// added from the old spreadsheet has no applications and never will, so it needs a
// manual mark.
//
// The manual mark is an explicit true/false, so it can also UNDO an automatic one - if
// the application says released and it never actually was, somebody has to be able to
// say so. undefined means "nobody has said", and only then does the application decide.
function released1(entry) {
  if (entry.release1Manual === true) return true
  if (entry.release1Manual === false) return false
  return !!entry.appRelease1
}
function released2(entry) {
  if (entry.release2Manual === true) return true
  if (entry.release2Manual === false) return false
  return !!entry.appRelease2
}
function releaseSource(entry, half) {
  const man = half === 1 ? entry.release1Manual : entry.release2Manual
  const app = half === 1 ? entry.appRelease1 : entry.appRelease2
  if (man === true) return 'manual'
  if (man === false) return app ? 'overridden' : 'none'
  return app ? 'application' : 'none'
}

function calcBalance(entry) {
  const r1 = calcReleaseHalf(entry)
  const r2 = calcReleaseHalf(entry)
  const total = r1 + r2
  const received = (released1(entry) ? r1 : 0) + (released2(entry) ? r2 : 0)
  return total - received
}

// Final-account balance = Final Account (ex-VAT) minus amount paid (ex-VAT).
// Reaches £0 once the whole final account has been paid. VAT sits outside the
// Final Account, so we compare paid ex-VAT (paid inc-VAT minus VAT charged).
function calcFinalBalance(entry) {
  const fa = accountValue(entry)
  const paidIncVat = parseFloat(entry.paid || 0) || 0
  const vat = parseFloat(entry.vat || 0) || 0
  const paidExVat = paidIncVat - vat
  return fa - paidExVat
}

// Warning banner listing the projects behind a headline figure.
//
// Collapsed by default: on a register this size an always-open list of twenty projects
// pushes the table off screen, and a warning you scroll past is a warning you ignore.
// The count and the money are in the heading, so it is actionable closed.
//
// Module scope - a component declared inside another remounts on every render, losing
// the open/closed state on every keystroke in the filters.
function AttentionBanner({ tone, title, note, items }) {
  const [open, setOpen] = useState(false)
  const c = tone === 'red'
    ? { bg: '#fef2f2', border: '#fecaca', text: '#b91c1c' }
    : { bg: '#fffbeb', border: '#fde68a', text: '#92400e' }
  return (
    <div style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 8, padding: '10px 14px', marginBottom: 12, flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: c.text }}>{title}</span>
        <button onClick={() => setOpen(o => !o)}
          style={{ background: 'none', border: 'none', padding: 0, fontSize: 11.5, fontWeight: 700, color: c.text, textDecoration: 'underline', cursor: 'pointer' }}>
          {open ? 'hide' : `show ${items.length}`}
        </button>
      </div>
      <div style={{ fontSize: 11.5, color: c.text, opacity: 0.85, marginTop: 2 }}>{note}</div>
      {open && (
        <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12, color: c.text, maxHeight: 190, overflowY: 'auto' }}>
          {items.map((t, i) => <li key={i} style={{ marginBottom: 2 }}>{t}</li>)}
        </ul>
      )}
    </div>
  )
}

function statusBadge(entry) {
  const now = new Date().toISOString().split('T')[0]
  const r1Due = entry.release1Date && !released1(entry) && entry.release1Date < now
  const r2Due = entry.release2Date && !released2(entry) && entry.release2Date < now
  if (r1Due || r2Due) return { label: 'Overdue', bg: '#fef2f2', color: '#e63946' }
  if (released1(entry) && released2(entry)) return { label: 'Released', bg: '#f0fdf4', color: '#16a34a' }
  if (released1(entry)) return { label: 'Part released', bg: '#fffbeb', color: '#ca8a04' }
  return { label: 'Pending', bg: '#f0f2f5', color: '#888' }
}

export default function RetentionPage() {
  const [entries, setEntries] = useState([])
  // Read-only embed mode (?embed=1): renders the page content only (cards, table,
  // filters) with NO navigation and no edit controls — for the Bookkeeping Portal.
  const [embed, setEmbed] = useState(false)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const q = new URLSearchParams(window.location.search)
      setEmbed(q.get('embed') === '1' || q.get('embed') === 'true')
    }
  }, [])
  const [xeroEntries, setXeroEntries] = useState([])
  const [hiddenIds, setHiddenIds] = useState([])
  const [loading, setLoading] = useState(true)
  const [ret612For, setRet612For] = useState(null)
  const [appliedForFor, setAppliedForFor] = useState(null)
  // Modals close on the x and Escape only, never a backdrop click. Neither modal on
  // this page had an Escape handler at all.
  useEffect(() => {
    if (!ret612For && !appliedForFor) return undefined
    const onKey = (e) => { if (e.key === 'Escape') { setRet612For(null); setAppliedForFor(null) } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ret612For, appliedForFor])
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState(EMPTY_ENTRY)
  const [showAddForm, setShowAddForm] = useState(false)
  const [addForm, setAddForm] = useState(EMPTY_ENTRY)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  // The scroll box sizes itself through flex now - see the page wrapper. An earlier
  // version measured its offset and set maxHeight; two mechanisms doing one job is how
  // they end up disagreeing, so the measuring has gone.
  const scrollBoxRef = useRef(null)
  const [importMsg, setImportMsg] = useState('')

  // IMPORT FROM A SPREADSHEET.
  //
  // Column headings are matched by NAME, so the file can be in any column order and extra
  // columns are ignored - the export people actually have is never the shape you would
  // design. Ref is the only required one: it is what a re-upload matches on, so a
  // corrected figure updates the row rather than creating a second copy of it.
  async function importFile(file) {
    if (!file) return
    setUploading(true); setImportMsg('')
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true })
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null })
      if (!rows.length) { setImportMsg('That file has no rows.'); setUploading(false); return }

      // WHOLE PERCENTAGES, not fractions.
      //
      // The register stores 5 for 5% - Xero rows are converted on the way in with
      // retentionPct * 100, and the cell renders with toFixed(0). I stored 0.05, which
      // rounds to "0%", and worse, 0 is the value that means "no retention" and switches
      // the release columns to N/A.
      //
      // Your sheet uses fractions, others use whole numbers, so both are accepted:
      // anything at or below 1 is a fraction and multiplied up.
      const pct = (v) => {
        const n = parseFloat(v); if (isNaN(n)) return ''
        return n <= 1 ? n * 100 : n
      }
      const num = (v) => { const n = parseFloat(v); return isNaN(n) ? '' : n }
      // Dates arrive three ways and only one of them is a Date:
      //   a real Date          when the cell is formatted as a date and cellDates is on
      //   an EXCEL SERIAL      45356 - days since 1899-12-30. new Date(45356) gives the
      //                        year 45356, which is how "+045356-01-01" got into the
      //                        first version of this
      //   the text "TBC"       a real answer in these sheets, and not a date at all
      // NEVER toISOString() ON A DATE FROM A SPREADSHEET.
      //
      // SheetJS builds these in LOCAL time, so 30/04/2026 becomes midnight local. In BST
      // that is 23:00 UTC the previous day, and toISOString() then returns 2026-04-29 -
      // every date landed a day early. It looked right in testing here only because this
      // machine runs on UTC.
      //
      // Read off the local calendar fields instead. A date in a spreadsheet has no
      // timezone; it is just a day.
      const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const dat = (v) => {
        if (v == null || v === '') return ''
        if (v instanceof Date) return isNaN(v) ? '' : ymd(v)
        const t = String(v).trim()
        if (!t || /^tbc$/i.test(t)) return ''
        // Excel serial. Bounded so a stray number in a date column is not read as one:
        // 20000 is 1954, 60000 is 2064. Built from UTC parts then read as calendar
        // fields, so no shift either way.
        const n = Number(t)
        if (!isNaN(n) && n > 20000 && n < 60000) {
          const base = new Date(Date.UTC(1899, 11, 30) + n * 86400000)
          return `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, '0')}-${String(base.getUTCDate()).padStart(2, '0')}`
        }
        const d = new Date(t)
        return isNaN(d) ? '' : ymd(d)
      }
      const pick = (r, ...names) => { for (const n of names) if (r[n] != null && r[n] !== '') return r[n]; return null }

      const entries = rows
        .filter((r) => pick(r, 'Ref', 'ourRef'))
        .map((r) => ({
          ourRef: String(pick(r, 'Ref', 'ourRef')).trim(),
          customerName: String(pick(r, 'Customer', 'customerName') || '').trim(),
          projectName: String(pick(r, 'Project', 'projectName') || '').trim(),
          finalAccount: num(pick(r, 'Final Account', 'finalAccount')),
          // FIELD NAMES MATTER MORE THAN LABELS. These three were written under names the
          // page does not read - projectValue, appliedFor and totalPaid - so the values
          // imported fine and displayed as blank.
          //   Gross AFA  -> afaGross      (was projectValue)
          //   Invoiced   -> invoicedNet   (was not mapped at all)
          //   Total Paid -> paid          (was totalPaid)
          afaGross: num(pick(r, 'Gross AFA', 'afaGross')),
          projectValue: num(pick(r, 'Gross AFA', 'Final Account')),
          appliedFor: num(pick(r, 'Applied for')),
          certified: num(pick(r, 'Certified')),
          invoicedNet: num(pick(r, 'Invoiced', 'invoicedNet')),
          invoiced: num(pick(r, 'Invoiced', 'invoicedNet')),
          retentionPct: pct(pick(r, 'Ret %', 'retentionPct')),
          pcType: String(pick(r, 'PC Type') || '').trim(),
          qsName: String(pick(r, 'QS', 'qsName') || '').trim(),
          release1Value: num(pick(r, '1st Value')),
          release1Date: dat(pick(r, '1st Date')),
          release2Value: num(pick(r, '2nd Value')),
          release2Date: dat(pick(r, '2nd Date')),
          // The column is read as vatRateLabel, not vatType. Same mistake as Gross AFA and
          // Total Paid: written under a name nothing reads, so it imported and showed as
          // a dash. Both names are written so either reader finds it.
          vatRateLabel: String(pick(r, 'VAT Type', 'vatRateLabel') || '').trim(),
          vatType: String(pick(r, 'VAT Type', 'vatRateLabel') || '').trim(),
          // Retention owed on a tracker-only row: the two release values are the whole of
          // it, and there is no Xero project to compute it from.
          retentionOwed: (num(pick(r, '1st Value')) || 0) + (num(pick(r, '2nd Value')) || 0),
          // Imported rows have no Xero 612 lines, so the reconciliation has nothing to
          // work with and shows a dash. An imported "612 Allocated" figure is kept on the
          // record but NOT mapped to retention612Deducted - the spreadsheet column was
          // the net, and feeding a net into a gross field would flag every imported row.
          retention612Allocated: num(pick(r, '612 Allocated')),
          paid: num(pick(r, 'Total Paid', 'paid')),
          comments: String(pick(r, 'Comments') || '').trim(),
          trackerOnly: true,
        }))

      if (!entries.length) { setImportMsg('No rows with a Ref were found - that column is required.'); setUploading(false); return }

      const res = await fetch('/api/retention', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Import failed')
      setEntries(d.entries || [])
      setImportMsg(`Imported ${entries.length} row${entries.length === 1 ? '' : 's'} — ${d.added} added, ${d.updated} updated.`)
    } catch (e) {
      setImportMsg(`Could not import that file. ${e.message || ''}`.trim())
    }
    setUploading(false)
  }
  const [sortKey, setSortKey] = useState('ref')   // default sort by Ref
  const [sortDir, setSortDir] = useState('asc')
  const [filter, setFilter] = useState(() => new Set(['live'])) // multi-select: live | defects | complete
  const [qsOptions, setQsOptions] = useState([])
  const [allProjects, setAllProjects] = useState([])   // for the "add existing project" picker

  const [search, setSearch] = useState('')

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    try {
      // QS dropdown options: portal users with post-contract / management / admin access.
      try {
        const rt = await fetch('/api/team'); const dt = await rt.json()
        const allowed = ['post-contract', 'management', 'admin']
        setQsOptions((dt.members || []).filter(m => m.active !== false && allowed.includes(m.accessRole) && m.name).map(m => m.name).sort((a, b) => a.localeCompare(b)))
      } catch {}
      // Load manual entries
      const r1 = await fetch('/api/retention')
      const d1 = await r1.json()
      setEntries(d1.entries || [])

      // Load Xero projects with retention
      const r2 = await fetch('/api/dashboard')
      const d2 = await r2.json()
      // Shared hidden-projects list (set on Project Financials) — applied here too.
      let hiddenIds = []
      try { hiddenIds = (await fetch('/api/hidden-projects').then(r => r.json())).hidden || [] } catch {}
      setHiddenIds(hiddenIds)
      const hiddenSet = new Set(hiddenIds.map(String))
      const visibleProjects = (d2.projects || []).filter(p => !hiddenSet.has(String(p.xeroId)))
      // Full project list for the "add existing project" picker (all projects,
      // regardless of retention filter, so you can add one before it's invoiced).
      setAllProjects(visibleProjects.map(p => ({
        xeroId: p.xeroId,
        ourRef: p.jobNo || '',
        customerName: p.customer || '',
        projectName: p.name || '',
        projectValue: p.contractValue || 0,
        finalAccount: p.afa || 0,
        retentionPct: (p.retentionPct || 0) * 100,
        completionDate: p.completionDate || p.pcDate || '',
        // Same as the main list below - no estimator fallback.
        qsName: p.qsName || '',
        comments: p.retentionComments || '',
      })).sort((a, b) => (a.ourRef || '').localeCompare(b.ourRef || '', undefined, { numeric: true })))
      // (a retention % set), plus any that already have retention outstanding or
      // invoicing under way. This mirrors the project details / EOM data rather
      // than waiting for a project to be invoiced.
      // Show EVERY in-progress project on the register — even before anything is
      // invoiced (values show £0), so it's a complete list. Closed/defects still
      // included so nothing disappears.
      const withRetention = visibleProjects
        .map(p => ({
          id: p.xeroId,
          xeroId: p.xeroId,
          ourRef: p.jobNo || '',
          customerName: p.customer || '',
          projectName: p.name || '',
          // False once the Xero tracking option has been DELETED. The row stays -
          // the retention still has to be chased - but its invoiced/paid figures
          // are frozen at the last sync, so the badge says so.
          inXero: p.inXero !== false,
          projectValue: p.contractValue || 0,
          finalAccount: p.afa || 0,
          retentionPct: (p.retentionPct || 0) * 100,
          completionDate: p.completionDate || p.pcDate || '',
          pcType: p.pcType || '',
          // NO fallback to the estimator. It used to read `p.qsName || p.estimator`,
          // so any project without a QS quietly showed the estimator's name in the QS
          // column - indistinguishable from a correct one. Blank is honest: it means
          // nobody has set a QS on Edit Project Details, and it can be fixed there.
          qsName: p.qsName || '',
          qsEmail: p.qsEmail || p.qsEmailSetting || '',
          comments: p.retentionComments || p.comment || '',
          invoiced: p.totalInvoiced || 0,
          invoicedNet: p.grossInvoiced || p.invoicedExVat || 0,
          vat: p.vat || 0,
          vatRateLabel: p.vatRateLabel || '—',
          paid: p.paid || 0,
          ...dashFields(p),
          appliedFor: p.appliedForLatest ? String(p.appliedForLatest) : '',
          // A real figure from the application wins. A zero does not - see the merge.
          certified: (p.certifiedSetOnApp && Number(p.certifiedGross)) ? String(p.certifiedGross)
            : (p.certifiedSetOnApp ? '0' : ''),
          // Still HELD: retention on the invoiced value, less anything already claimed
          // back through an application's Retention section. Without the deduction the
          // register keeps chasing money that has been applied for.
          // Derived by calcRetentionOwed from appliedFor x retentionPct once the row is
          // assembled - see the note on that function. Kept here only as a fallback for
          // rows that never get a percentage or an applied-for figure.
          retentionOwed: Math.max(0, (p.totalRetention || 0) - (p.retentionClaimed || 0)),
          retentionClaimed: p.retentionClaimed || 0,
          // From the retention section on the project's latest application - this is
          // what marks a new project off without anybody touching the register.
          appRelease1: !!p.appRelease1,
          appRelease2: !!p.appRelease2,
          retention612Allocated: p.retention612Allocated || 0, // deducted less released
          retention612Deducted: p.retention612Deducted || 0,
          retention612Released: p.retention612Released || 0,
          retention612ReleasedPaid: p.retention612ReleasedPaid || 0,
          ret612Detail: p.ret612Detail || [],
          ret612Lines: p.ret612Lines || 0,
          ret612From: p.ret612From || '',
          detailsMissing: p.detailsMissing || [],
          pcDateTBC: !!p.pcDateTBC,
          defectsDateTBC: !!p.defectsDateTBC,
          // HALF THE RETENTION ON THE FINAL ACCOUNT, not half of what has accrued so far.
          // A release is contractual - half at practical completion, half at the end of
          // defects, both measured against the final account. This read totalRetention,
          // which is retention on work APPLIED FOR to date, so on a part-complete job it
          // showed less than the application certificate actually releases.
          release1Value: (p.retentionHalf != null ? p.retentionHalf : (p.totalRetention || 0) / 2) || 0,
          release1Date: '',
          release1Received: false,
          release2Value: (p.retentionHalf != null ? p.retentionHalf : (p.totalRetention || 0) / 2) || 0,
          release2Date: '',
          release2Received: false,
          manual: false,
          status: p.status,
        }))
      setXeroEntries(withRetention)
    } catch (e) { console.error(e) }
    setLoading(false)
  }



  async function saveEntry(entry) {
    setSaving(true)
    try {
      // A Xero-derived row has manual:false and its id set to the xeroId. Editing
      // it must create/update a MANUAL OVERRIDE keyed by xeroId, not try to update
      // a record by that id (which doesn't exist in the manual store). Find any
      // existing override for this xeroId and reuse its real id; otherwise create
      // a new override (drop the id so the server generates one) but keep xeroId.
      let toSave = entry
      if (entry.manual === false) {
        const existingOverride = entries.find(e => e.xeroId === entry.xeroId)
        toSave = {
          ...entry,
          id: existingOverride ? existingOverride.id : undefined,
          xeroId: entry.xeroId || entry.id,
          manual: false,        // still sourced from Xero, but now has manual overrides
        }
      }
      const res = await fetch('/api/retention', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entry: toSave })
      })
      const data = await res.json()
      setEntries(data.entries || [])
      setEditingId(null)
      setShowAddForm(false)
      setAddForm(EMPTY_ENTRY)
    } catch (e) { console.error(e) }
    setSaving(false)
  }

  // Retention lifecycle transitions (all manual, gated):
  //  • live -> defects: only when Final Account reconciles with invoiced value.
  //  • defects -> complete: only from defects (can't skip the defects period).
  //  • re-open steps back one stage.
  async function setRetStatus(entry, next) {
    const fa = accountValue(entry)
    const invNet = entry.invoicedNet != null ? parseFloat(entry.invoicedNet) : (entry.invoiced != null ? parseFloat(entry.invoiced) : null)
    const faMatches = fa > 0 && invNet != null && Math.abs(fa - (invNet || 0)) < 1
    if (next === 'defects') {
      if (!faMatches) { alert('Cannot move to Defects Liability: the Final Account and the invoiced value must match first. Reconcile them, then try again.'); return }
      if (!confirm(`Move ${entry.ourRef || 'this project'} to Defects Liability? (Waiting for the final retention release.)`)) return
    }
    if (next === 'complete') {
      if (retStatusOf(entry) !== 'defects') { alert('A project must go through Defects Liability before it can be marked Complete.'); return }
      if (!confirm(`Mark ${entry.ourRef || 'this project'} as Complete?`)) return
    }
    if (next === 'live') {
      if (!confirm(`Move ${entry.ourRef || 'this project'} back to ${retStatusOf(entry) === 'complete' ? 'Defects Liability' : 'Live Project'}?`)) return
    }
    await saveEntry({ ...entry, retStatus: next, markedComplete: next === 'complete', completedAt: next === 'complete' ? Date.now() : null })
  }

  // Mark a half released, or undo it. Writes an EXPLICIT true/false rather than
  // deleting the flag, so it can also override an application that says released when it
  // was not - clicking a green "released (app)" cell sets false and it stays false.
  async function toggleRelease(entry, half) {
    const key = half === 1 ? 'release1Manual' : 'release2Manual'
    const dateKey = half === 1 ? 'release1MarkedAt' : 'release2MarkedAt'
    const now = half === 1 ? released1(entry) : released2(entry)
    await saveEntry({ ...entry, [key]: !now, [dateKey]: !now ? new Date().toISOString() : null })
  }

  async function deleteEntry(id) {
    if (!confirm('Delete this entry?')) return
    try {
      const res = await fetch('/api/retention', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      })
      const data = await res.json()
      setEntries(data.entries || [])
    } catch (e) { console.error(e) }
  }

  // Merge xero + manual. A manual OVERRIDE (entry with an xeroId) keeps the
  // manual fields (received flags, dates, comments) but the live Xero financials
  // (invoiced/vat/vatRateLabel/paid/final account etc.) are always layered on top
  // so they stay current after each sync and never show stale/zero values.
  const xeroByXid = new Map(xeroEntries.map(x => [x.xeroId, x]))
  const mergedEntries = entries.map(e => {
    if (e.xeroId && xeroByXid.has(e.xeroId)) {
      const x = xeroByXid.get(e.xeroId)
      return {
        ...e,
        inXero: x.inXero !== false,
        invoiced: x.invoiced, invoicedNet: x.invoicedNet, vat: x.vat, vatRateLabel: x.vatRateLabel, paid: x.paid,
        retentionClaimed: x.retentionClaimed, retention612Allocated: x.retention612Allocated,
        // Live Xero figures - must be layered on like the rest, or an edited row shows
        // blanks where an untouched one shows the numbers.
        appRelease1: x.appRelease1, appRelease2: x.appRelease2,
        retention612Deducted: x.retention612Deducted, retention612Released: x.retention612Released,
        retention612ReleasedPaid: x.retention612ReleasedPaid, ret612Lines: x.ret612Lines, ret612From: x.ret612From,
        ret612Detail: x.ret612Detail,
        // One list, shared with the project-derived builder above.
        ...dashFields(x),
        // THE APPLICATION WINS ON BOTH ACCOUNT COLUMNS.
        //
        // Final Account read `e.finalAccount || x.finalAccount`, so a figure typed once
        // sat on top of a sent application for good and nothing moved when the
        // application changed - the same fault Applied for had. A typed value is now
        // only used where no sent application exists.
        afaGross: x.afaFromApp ? x.afaGross : ((e.afaGross != null && e.afaGross !== '') ? e.afaGross : x.afaGross),
        finalAccount: x.afaFromApp ? x.finalAccount : (e.finalAccount || x.finalAccount),
        projectValue: e.projectValue || x.projectValue,
        retentionPct: e.retentionPct || x.retentionPct,
        completionDate: e.completionDate || x.completionDate,
        qsName: e.qsName || x.qsName,
        // Applied-for auto-populates from the latest application; a manually typed
        // value on the saved entry still wins.
        // THE SENT APPLICATION WINS.
        //
        // A typed value used to beat it, so an override entered once sat there for good
        // and every later application was ignored - which is why some rows did not match
        // their latest certificate. A manual figure is now only used where there is no
        // sent application to take it from.
        appliedFor: x.appliedForLatest ? String(x.appliedForLatest) : (e.appliedFor || ''),
        // CERTIFIED = the "Previously certified (gross)" box on the latest SENT
        // application. Tested on certifiedSetOnApp, not on the value being truthy: a
        // first application legitimately holds 0 and must show 0.00 rather than falling
        // through to whatever was typed on this row.
        // A TYPED VALUE BEATS AN APPLICATION ZERO.
        //
        // certifiedSetOnApp is true on a first application, where prevCertGross is
        // legitimately 0. Because the application always won, anything typed into the
        // cell was thrown away and the zero put straight back - you pressed Enter and
        // watched your number turn into 0. On any project whose latest sent application
        // is App 1, Certified was simply not editable, however editable it looked.
        //
        // A real figure from the application still wins. A zero does not.
        certified: (x.certifiedSetOnApp && Number(x.certifiedGross)) ? String(x.certifiedGross)
          : ((e.certified != null && e.certified !== '') ? e.certified : (x.certifiedSetOnApp ? '0' : '')),
        comments: x.comments != null && x.comments !== '' ? x.comments : e.comments,
        // markedComplete is a manual saved flag on `e` — keep it.
      }
    }
    return e
  })
  const manualIds = new Set(entries.map(e => e.xeroId).filter(Boolean))
  const hiddenEntrySet = new Set(hiddenIds.map(String))
  // EVERY row on the register, before the status filter and the search. The counts on two
  // of the summary cards are about the business, not about what is currently on screen -
  // "how many projects are live" should not change because somebody ticked a filter.
  const everyEntry = [
    ...xeroEntries.filter(x => !manualIds.has(x.xeroId) && !entries.find(e => e.id === x.xeroId)),
    ...mergedEntries
  ].filter(e => !(e.xeroId && hiddenEntrySet.has(String(e.xeroId))))

  const allEntries = everyEntry.filter(e => {
    // Multi-select status filter: show a row if its status is among the ticked
    // filters. No filters ticked -> show nothing (prompt shown separately).
    if (!filter || filter.size === 0) return true
    return filter.has(retStatusOf(e))
  }).filter(e => {
    if (!search) return true
    const q = search.toLowerCase()
    return e.ourRef?.toLowerCase().includes(q) || e.customerName?.toLowerCase().includes(q) || e.projectName?.toLowerCase().includes(q)
  })

  // Sortable columns. Each key maps to a value getter; strings sort case-insensitively
  // (numeric-aware for refs), numbers/dates naturally.
  const sortVal = (e, key) => {
    switch (key) {
      case 'ref': return e.ourRef || ''
      case 'customer': return e.customerName || ''
      case 'project': return e.projectName || ''
      case 'finalAccount': return parseFloat(e.finalAccount || 0) || 0
      case 'appliedFor': return parseFloat(e.appliedFor || 0) || 0
      case 'invoiced': return parseFloat(e.invoicedNet != null ? e.invoicedNet : e.invoiced || 0) || 0
      case 'retentionOwed': return calcRetentionOwed(e)
      case 'r612': return parseFloat(e.retention612Allocated || 0) || 0
      case 'r612ded': return parseFloat(e.retention612Deducted || 0) || 0
      case 'r612rel': return parseFloat(e.retention612Released || 0) || 0
      case 'afaGross': return parseFloat(e.afaGross || 0) || 0
      case 'mcdValue': return parseFloat(e.mcdValue || 0) || 0
      case 'retPct': return parseFloat(e.retentionPct || 0) || 0
      case 'pcType': return e.pcType || ''
      case 'qs': return e.qsName || ''
      case 'paid': return parseFloat(e.paid || 0) || 0
      case 'r1date': return e.release1Date || ''
      case 'r2date': return e.release2Date || ''
      default: return e.ourRef || ''
    }
  }
  const sortedEntries = [...allEntries].sort((a, b) => {
    const va = sortVal(a, sortKey), vb = sortVal(b, sortKey)
    let cmp
    if (typeof va === 'number' && typeof vb === 'number') cmp = va - vb
    else cmp = String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: 'base' })
    return sortDir === 'asc' ? cmp : -cmp
  })
  const toggleSort = (key) => {
    if (!key) return
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  // PROJECTS THAT NEED ATTENTION.
  //
  // Both are computed over allEntries - the FILTERED view - so a banner never claims a
  // problem you have filtered away, and clearing the filters shows the true picture.
  //
  // Complete projects are excluded: retention on a closed job is not being chased.
  const attention = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    const noDate = [], overdue = []
    for (const e of allEntries) {
      if (retStatusOf(e) === 'complete') continue
      const r1 = calcReleaseHalf(e)
      const r2 = calcReleaseHalf(e)
      const label = [e.ourRef, e.projectName || e.customerName].filter(Boolean).join(' - ') || 'Unnamed'

      // A half with money against it but NO date is invisible everywhere else: it never
      // goes overdue, and it never reaches the cash flow, which only schedules dated
      // releases. It just sits there.
      const miss = []
      if (r1 > 0 && !released1(e) && !e.release1Date) miss.push('1st')
      if (r2 > 0 && !released2(e) && !e.release2Date) miss.push('2nd')
      if (miss.length) noDate.push({ label, which: miss.join(' and '), amount: (miss.includes('1st') ? r1 : 0) + (miss.includes('2nd') ? r2 : 0) })

      // Past its release date and still not confirmed - the money that should be in.
      const late = []
      let lateAmt = 0
      if (r1 > 0 && !released1(e) && e.release1Date && e.release1Date < today) { late.push('1st'); lateAmt += r1 }
      if (r2 > 0 && !released2(e) && e.release2Date && e.release2Date < today) { late.push('2nd'); lateAmt += r2 }
      if (late.length) overdue.push({ label, which: late.join(' and '), amount: lateAmt, date: e.release1Date && e.release1Date < today ? e.release1Date : e.release2Date })
    }
    overdue.sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    noDate.sort((a, b) => b.amount - a.amount)
    return { noDate, overdue,
      noDateTotal: noDate.reduce((t, x) => t + x.amount, 0),
      overdueTotal: overdue.reduce((t, x) => t + x.amount, 0) }
  }, [allEntries])

  const totals = {
    // STILL TO COME IN: the release halves, less any confirmed released. calcBalance()
    // had been sitting in this file unused since it was written - it is exactly this, and
    // it is what "how much retention are we chasing" actually means. The gross figure it
    // replaced took no account of anything having been released.
    // LIVE AND DEFECTS LIABILITY ONLY, off the Retention Owed column.
    //
    // It summed calcBalance across EVERY row, completed jobs included. A completed
    // project has had its retention released - carrying it in "outstanding" is chasing
    // money that has already arrived, and on a register this old that is most of the rows.
    //
    // It also reads the same retentionOwed the column shows, so the card and the column
    // it sits above cannot disagree. calcBalance was a second calculation of the same
    // thing, which is how the two came to differ in the first place.
    // OWED, LESS EVERY HALF ALREADY RELEASED.
    //
    // Total Retention Owed across ALL projects, minus the 1st and 2nd Value of any half
    // marked released - whether that was a click on the cell or a half ticked in an
    // application's retention section. released1/released2 already answer that, and they
    // are the same functions the cell colours use, so the card and the row agree.
    //
    // Not filtered by status: a completed project with an unreleased half is still money
    // being held, and dropping it hides exactly the sort of forgotten retention this
    // register exists to catch.
    //
    // NO PER-PROJECT FLOOR.
    //
    // It used max(0, owed - released), so a row whose released halves exceeded its
    // Retention Owed contributed nothing instead of a negative - and the card then could
    // not be reconciled against the column totals underneath it. One row with 0.00 owed
    // and a 2,766.97 first release put the card 2,766.97 above the arithmetic, with
    // nothing on screen to explain the gap.
    //
    // Straight subtraction now: Retention Owed less the halves released. A card you can
    // check against the totals row is worth more than one that quietly absorbs an odd
    // row, and where the releases are right the two agree by definition.
    outstanding: allEntries.reduce((s, e) => {
      const owed = calcRetentionOwed(e)
      const rel = (released1(e) ? calcReleaseHalf(e) : 0) + (released2(e) ? calcReleaseHalf(e) : 0)
      return s + (owed - rel)
    }, 0),
    // REMAINING TO BE CLAIMED, ex VAT: Final Account minus Invoiced.
    //
    // It was Total Due minus Total Paid - inc VAT, and measuring what had been RECEIVED
    // rather than what is left to claim. That made it depend on the manual Total Paid
    // column, so a project nobody had updated read as fully outstanding.
    //
    // Final Account minus Invoiced comes from Xero on one side and the application on the
    // other, so it is live without anybody maintaining it. Same figure as the Account
    // Remaining column, summed.
    remaining: allEntries.reduce((s, e) => s + calcAccountRemaining(e), 0),
    // These two count the whole register, NOT the filtered view - see everyEntry above.
    defects: everyEntry.filter(e => retStatusOf(e) === 'defects').length,
    live: everyEntry.filter(e => retStatusOf(e) === 'live').length,
  }

  const inputStyle = { padding: '5px 8px', border: '1px solid #e5e5e5', borderRadius: 6, fontSize: 12, width: '100%', boxSizing: 'border-box' }

  // Projects already present in the tracker (so the "add existing project"
  // autocomplete won't offer duplicates). Match on xeroId for auto/linked rows,
  // and on ref/name for manual rows (which carry no xeroId).
  const existingXeroIds = new Set(allEntries.map(e => e.xeroId).filter(Boolean))
  const existingKeys = new Set(
    allEntries.flatMap(e => [
      (e.ourRef || '').trim().toLowerCase(),
      (e.projectName || '').trim().toLowerCase(),
    ].filter(Boolean))
  )

  return (
    <>
      <Head><title>Rock Roofing — Retention Tracker</title></Head>
      {/* THE PAGE ITSELF DOES NOT SCROLL.
          Measuring the table's height was not enough on its own: while the page could
          scroll, scrolling down moved the box - and its horizontal bar - out of view,
          which is exactly the symptom. Locking the page to the viewport and letting only
          the table scroll means the bar is always where you left it. */}
      <div style={embed
        // EMBEDDED (?embed=1) this page sits in an iframe on Project Financials, which
        // sizes itself to the content. Locking it to 100vh there would cap the table at
        // the iframe's height and clip it, so the embed keeps the old behaviour and lets
        // the host page do the scrolling.
        ? { minHeight: '100vh', background: '#f0f2f5' }
        : { height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#f0f2f5' }}>
        {appliedForFor && (() => {
          const d = appliedForFor.appliedForDetail || null
          const th3 = { padding: '6px 8px', textAlign: 'left', fontSize: 10.5, color: '#888', textTransform: 'uppercase', letterSpacing: 0.4, borderBottom: '1px solid #e5e7eb' }
          const td3 = { padding: '6px 8px', fontSize: 12, borderBottom: '1px solid #f3f4f6' }
          const row = (label, value, hint) => (
            <tr>
              <td style={td3}>{label}</td>
              <td style={{ ...td3, textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>{value}</td>
              <td style={{ ...td3, color: '#94a3b8', fontSize: 11 }}>{hint || ''}</td>
            </tr>
          )
          return (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
              <div style={{ background: '#fff', borderRadius: 10, width: '100%', maxWidth: 760, maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div style={{ padding: '12px 16px', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 15, fontWeight: 700 }}>Applied for / Certified &mdash; {appliedForFor.project || appliedForFor.ref} <span style={{ fontWeight: 400, fontSize: 11, color: '#94a3b8' }}>v843</span></span>
                  <button onClick={() => setAppliedForFor(null)} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#888' }}>&times;</button>
                </div>
                <div style={{ overflow: 'auto', padding: '10px 16px' }}>
                  {!d ? (
                    <div style={{ fontSize: 12, color: '#555' }}>
                      The dashboard returned no application data for this project. That means
                      either the project genuinely has no applications, or none were found on
                      its settings records. Applied for is showing whatever was typed on the
                      row, and Certified will be blank unless it was typed too.
                      <div style={{ marginTop: 6, color: '#94a3b8' }}>
                        If Gross AFA above names an application, the two disagree and that is
                        itself the fault - send this screen over.
                      </div>
                    </div>
                  ) : (
                    <>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead><tr><th style={th3}>What</th><th style={{ ...th3, textAlign: 'right' }}>Value</th><th style={th3}>Where it comes from</th></tr></thead>
                        <tbody>
                          {row('Applications on this project', String(d.appCount), `${d.sentCount} sent, ${d.appCount - d.sentCount} draft`)}
                          {row('Where the records live', `${d.appsFromId || 0} on id, ${d.appsFromJob || 0} on job no`,
                            d.appsDuplicated ? `${d.appsDuplicated} held on BOTH - the id record's copy is used, same as the applications page` : 'no duplicates')}
                          {row('Latest application', d.latestApp ? `app ${d.latestApp}` : '-', d.latestStatus)}
                          {row('Latest SENT application', d.sentApp ? `app ${d.sentApp}` : 'none', 'both columns read this one')}
                          {row('Applied for (shown)', d.sentNetBeforeRet == null ? '-' : fmtC(d.sentNetBeforeRet), 'sent app: gross less MCD, retention still in')}
                          {row('Certified (shown)', d.prevCertTyped == null ? 'not set' : fmtC(d.prevCertTyped), 'the "Previously certified (gross)" box on the sent app')}
                          {row('Gross on the sent application', d.sentGross == null ? '-' : fmtC(d.sentGross), 'current - this is what THIS certificate applies for, cumulative')}
                          {row('This certificate', (d.sentGross == null || d.prevCertTyped == null) ? '-' : fmtC(d.sentGross - d.prevCertTyped), 'current less previously certified')}
                          {row('Certificate fallback if box empty', d.prevCertComputed == null ? '-' : fmtC(d.prevCertComputed), 'the preceding application - NOT used by this column')}
                          {row('Final Account basis', appliedForFor.mcdBasis || '-', 'where MCD is taken off')}
                          {row('Account columns source', appliedForFor.afaFromApp ? 'sent application' : (appliedForFor.afaSource || 'project details'), appliedForFor.afaFromApp ? 'a typed value cannot override this' : 'no sent application, so a typed value is used')}
                          {row('Typed on this row', appliedForFor.certified ? fmtC(parseFloat(appliedForFor.certified)) : 'not set', 'only used where there is no sent application')}
                        </tbody>
                      </table>
                      <div style={{ marginTop: 14, fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.4 }}>Gross AFA - where it comes from</div>
                      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 4 }}>
                        <tbody>
                          {row('SHOWN ON THE ROW', appliedForFor.afaShown == null ? '-' : fmtC(appliedForFor.afaShown), appliedForFor.afaSource || '')}
                          {row('Measured contract sum (app)', d.afaAppMeasured == null ? '-' : fmtC(d.afaAppMeasured), 'the contract works schedule ON the application')}
                          {row('Variations at final value (app)', d.afaAppVariations == null ? '-' : fmtC(d.afaAppVariations), `${d.appVarInstructed} instructed of ${d.appVarCount} on the application`)}
                          {row('= Gross AFA from the application', d.afaApp == null ? '-' : fmtC(d.afaApp), 'frozen when the application was sent')}
                          {row('Contract value (project details)', d.afaSettingsContract == null ? '-' : fmtC(d.afaSettingsContract), '')}
                          {row('Instructed variations (project details)', d.afaSettingsVariations == null ? '-' : fmtC(d.afaSettingsVariations), `${d.settingsVarInstructed} instructed of ${d.settingsVarCount} on the project`)}
                          {row('= Gross AFA from project details', d.afaSettings == null ? '-' : fmtC(d.afaSettings), 'used only where there is no sent application')}
                          {row('Figure saved when it was sent', appliedForFor.afaStamped == null ? 'none' : fmtC(appliedForFor.afaStamped),
                            appliedForFor.afaUsedStamp
                              ? 'used - the application could not be recomputed'
                              : (appliedForFor.afaStamped == null
                                  ? 'nothing saved - predates this, so the application is recomputed'
                                  : (appliedForFor.afaStampStale
                                      ? 'NOT used. Out of date - the application was edited after sending. Re-send to bring it back into line.'
                                      : 'not used - the application is read directly')))}
                        </tbody>
                      </table>
                      {(() => {
                        if (d.afaApp == null || d.afaSettings == null) return null
                        const gap = d.afaApp - d.afaSettings
                        if (Math.abs(gap) < 1) return null
                        const measGap = (d.afaAppMeasured || 0) - (d.afaSettingsContract || 0)
                        const varGap = (d.afaAppVariations || 0) - (d.afaSettingsVariations || 0)
                        const blame = Math.abs(measGap) >= Math.abs(varGap)
                          ? `mostly the measured contract sum: the schedule on the application comes to ${fmtC(d.afaAppMeasured)} against a contract value of ${fmtC(d.afaSettingsContract)}, a difference of ${fmtC(measGap)}`
                          : `mostly the variations: the application carries ${fmtC(d.afaAppVariations)} against ${fmtC(d.afaSettingsVariations)} on the project, a difference of ${fmtC(varGap)} - usually a variation instructed AFTER the last application went out`
                        return (
                          <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 6, background: '#fff7ed', border: '1px solid #fed7aa', fontSize: 12, color: '#7c2d12' }}>
                            Gross AFA is {fmtC(gap)} {gap > 0 ? 'above' : 'below'} the project-details final account. It is {blame}.
                            The application always wins, so the figure shown is the application&apos;s.
                          </div>
                        )
                      })()}
                      {d.draftSupersedes ? (
                        <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 6, background: '#fff7ed', border: '1px solid #fed7aa', fontSize: 12, color: '#7c2d12' }}>
                          There is a later DRAFT application (app {d.latestApp}). It is ignored - both
                          columns read the sent one. Before pkg795 the draft set Applied for, which
                          is why this row did not match its certificate. The draft would have shown{' '}
                          {d.anyNetBeforeRet == null ? '-' : fmtC(d.anyNetBeforeRet)}.
                        </div>
                      ) : null}
                      {d.sentCount === 0 ? (
                        <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 6, background: '#fff7ed', border: '1px solid #fed7aa', fontSize: 12, color: '#7c2d12' }}>
                          No SENT application on this project - every application here is still a
                          draft. Both columns fall back to whatever is typed on the row.
                        </div>
                      ) : null}
                      {d.sentCount > 0 && d.prevCertTyped == null ? (
                        <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 6, background: '#eff6ff', border: '1px solid #bfdbfe', fontSize: 12, color: '#1e3a5f' }}>
                          The "Previously certified (gross)" box on app {d.sentApp} is empty, so
                          Certified is blank. Fill it in on the application, or type it straight into
                          the cell on this row. The certificate itself would fall back to{' '}
                          {d.prevCertComputed == null ? '-' : fmtC(d.prevCertComputed)} - this column
                          deliberately does not, so an unfilled box is visible rather than papered over.
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
                <div style={{ padding: '10px 16px', borderTop: '1px solid #e5e7eb', fontSize: 12, color: '#555' }}>
                  Certified is editable inline on the row - click the value, Enter saves, Escape cancels.
                  The next application sent overwrites it.
                </div>
              </div>
            </div>
          )
        })()}

        {ret612For && (() => {
          const rows = ret612For.ret612Detail || []
          const d = rows.filter(r => r.side === 'deducted').reduce((t, r) => t + Math.abs(r.used), 0)
          const rl = rows.filter(r => r.side === 'released').reduce((t, r) => t + r.used, 0)
          const th2 = { padding: '6px 8px', textAlign: 'left', fontSize: 10.5, color: '#888', textTransform: 'uppercase', letterSpacing: 0.4, borderBottom: '1px solid #e5e7eb', whiteSpace: 'nowrap' }
          const td2 = { padding: '6px 8px', fontSize: 12, borderBottom: '1px solid #f3f4f6', whiteSpace: 'nowrap' }
          return (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
              <div style={{ background: '#fff', borderRadius: 10, width: '100%', maxWidth: 900, maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div style={{ padding: '12px 16px', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 15, fontWeight: 700 }}>612 lines &mdash; {ret612For.project || ret612For.ref} <span style={{ fontWeight: 400, fontSize: 11, color: '#94a3b8' }}>v843</span></span>
                  <button onClick={() => setRet612For(null)} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#888' }}>&times;</button>
                </div>
                <div style={{ padding: '10px 16px', fontSize: 12, color: '#555', borderBottom: '1px solid #f3f4f6' }}>
                  Every account-612 line the app holds for this project. <strong>Raw</strong> is what came from Xero;
                  <strong> Used</strong> is after a credit note has been cancelled against the invoice it reverses.
                  Read it straight against your Xero account-transactions export.
                  <strong> Match</strong> shows how each credit note was paired to the invoice it
                  reverses, or why it could not be - so a pair left uncancelled says why on the row.
                </div>
                <div style={{ overflow: 'auto', padding: '0 16px' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr>
                      <th style={th2}>Date</th><th style={th2}>Reference</th><th style={th2}>Type</th>
                      <th style={{ ...th2, textAlign: 'right' }}>Raw</th>
                      <th style={{ ...th2, textAlign: 'right' }}>Used</th>
                      <th style={th2}>Side</th><th style={th2}>Netted</th><th style={th2}>Allocs</th>
                      <th style={th2}>Match</th>
                    </tr></thead>
                    <tbody>
                      {rows.length === 0 && <tr><td style={td2} colSpan={9}>No 612 lines stored. If Xero shows some, they are not reaching this project - check the tracking category on those invoices.</td></tr>}
                      {rows.map((r, i) => (
                        <tr key={i} style={{ background: r.netted ? '#fffbeb' : undefined }}>
                          <td style={td2}>{r.date || '-'}</td>
                          <td style={{ ...td2, whiteSpace: 'normal' }}>{r.ref || '-'}</td>
                          <td style={td2}>{r.creditNote ? 'Credit note' : 'Invoice'}</td>
                          <td style={{ ...td2, textAlign: 'right' }}>{fmt(r.raw)}</td>
                          <td style={{ ...td2, textAlign: 'right', fontWeight: r.netted ? 700 : 400 }}>{fmt(r.used)}</td>
                          <td style={{ ...td2, color: r.side === 'deducted' ? '#dc2626' : r.side === 'released' ? '#16a34a' : '#bbb' }}>{r.side}</td>
                          <td style={td2}>{r.netted ? 'cancelled' : ''}</td>
                          <td style={td2}>{r.allocs || ''}</td>
                          <td style={{ ...td2, whiteSpace: 'normal', fontSize: 11, color: r.netted ? '#16a34a' : '#94a3b8' }}>{r.match || ''}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot><tr style={{ fontWeight: 700, background: '#f8fafc' }}>
                      <td style={td2} colSpan={4}>Totals from these lines</td>
                      <td style={{ ...td2, textAlign: 'right' }} colSpan={5}>
                        deducted {fmt(d)} &nbsp;&middot;&nbsp; released {fmt(rl)}
                      </td>
                    </tr></tfoot>
                  </table>
                </div>
                <div style={{ padding: '10px 16px', borderTop: '1px solid #e5e7eb', fontSize: 12, color: '#555' }}>
                  Retention Owed <strong>{fmt(calcRetentionOwed(ret612For))}</strong> is the source of truth. Deducted should match it.
                </div>
              </div>
            </div>
          )
        })()}

        {importMsg && (
          <div style={{ margin: '10px 0', padding: '8px 12px', borderRadius: 8, fontSize: 13, background: importMsg.startsWith('Imported') ? '#e8f5ee' : '#fff4e5', border: `1px solid ${importMsg.startsWith('Imported') ? '#1c704f' : '#f0c98a'}`, color: '#1a1a2e' }}>
            {importMsg}
            <button onClick={() => setImportMsg('')} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: '#888', fontSize: 15, lineHeight: 1 }}>&times;</button>
          </div>
        )}
        {!embed && (
        <CommercialNav active="/retention" right={<>
          <SyncBar show={['invoices']} months={12} onDone={() => loadAll()} />
          {/* Add and Import have moved down beside the summary cards - they are actions
              on this page, not navigation, and the nav bar is shared. */}
        </>} />
        )}

        <div style={embed ? { padding: 24 } : { padding: 24, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {/* Summary cards and the page's own actions. Hidden in the EMBED: Bookkeeping
              wants the register itself, and four tiles above it eat the height the table
              needs inside a frame. */}
          {/* NEEDS ATTENTION. Two different problems, deliberately two banners: one is
              money that should already be in, the other is money with no date that will
              never become overdue and never reach the cash flow. Hidden in the embed -
              Bookkeeping reads this register, it does not chase it. */}
          {!embed && attention.overdue.length > 0 && (
            <AttentionBanner
              tone="red"
              title={`${attention.overdue.length} retention release${attention.overdue.length === 1 ? '' : 's'} past its due date and not marked released - ${fmtC(attention.overdueTotal)}`}
              note="Chase these, or confirm the release by clicking the 1st / 2nd Value cell on the row."
              items={attention.overdue.map(x => `${x.label} - ${x.which} half, due ${fmtD(x.date)}, ${fmtC(x.amount)}`)}
            />
          )}
          {!embed && attention.noDate.length > 0 && (
            <AttentionBanner
              tone="amber"
              title={`${attention.noDate.length} retention${attention.noDate.length === 1 ? '' : 's'} with no release date - ${fmtC(attention.noDateTotal)}`}
              note="With no date these never show as overdue and never reach the Cash Flow, which only schedules dated releases. Set the date on the row."
              items={attention.noDate.map(x => `${x.label} - ${x.which} half, ${fmtC(x.amount)}`)}
            />
          )}

          {/* THE EMBED GETS THIS ONE FIGURE. The full tile row is hidden in Bookkeeping
              because four cards eat the height the register needs inside a frame - but
              the total outstanding is the number Bookkeeping is there for, so it is shown
              on its own line rather than being lost with the rest. */}
          {embed && (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 14 }}
              title="Total Retention Owed across all projects, less any half marked released.">
              <span style={{ fontSize: 11, color: '#888' }}>Retention outstanding</span>
              <span style={{ fontSize: 20, fontWeight: 700, color: totals.outstanding > 1 ? '#dc2626' : '#16a34a' }}>{fmtC(totals.outstanding)}</span>
              <span style={{ fontSize: 11, color: '#aaa' }}>Owed less halves already released</span>
            </div>
          )}

          {!embed && (
          <div style={{ display: 'flex', gap: 12, marginBottom: 20, alignItems: 'stretch', flexShrink: 0 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, flex: 1 }}>
              {[
                { label: 'Retention Outstanding', value: fmtC(totals.outstanding), color: totals.outstanding > 1 ? '#dc2626' : '#16a34a',
                  tip: 'Total Retention Owed across all projects, less any 1st or 2nd Value marked released - by clicking the cell or by a half ticked on an application. Ties to the totals row when all three status filters are on.' },
                { label: 'Remaining to Claim', value: fmtC(totals.remaining), color: totals.remaining > 1 ? '#dc2626' : '#16a34a',
                  tip: 'Final Account minus Applied for, excluding VAT, across the projects shown. What is still to be claimed - the sum of the Account Remaining column.' },
                { label: 'In Defects Liability', value: totals.defects, raw: true, color: '#ca8a04',
                  tip: 'Every project on the register at Defects Liability. Does not change with the filters.' },
                { label: 'Live Projects', value: totals.live, raw: true,
                  tip: 'Every project on the register still Live. Does not change with the filters.' },
              ].map(card => (
                <div key={card.label} title={card.tip || undefined} style={{ background: '#fff', borderRadius: 8, padding: '10px 14px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', cursor: card.tip ? 'help' : 'default' }}>
                  <div style={{ fontSize: 10.5, color: '#888', marginBottom: 2 }}>{card.label}</div>
                  <div style={{ fontSize: card.raw ? 20 : 16, fontWeight: 700, color: card.color }}>{card.value}</div>
                </div>
              ))}
            </div>
            {/* READ-ONLY IN THE EMBED. Bookkeeping views this register; it does not
                maintain it. Adding a manual row or importing a spreadsheet from there
                would put commercial data in without the commercial team knowing. */}
            {!embed && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0, minWidth: 168 }}>
              <button onClick={() => { setShowAddForm(true); setAddForm(EMPTY_ENTRY) }}
                style={{ background: '#e63946', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>+ Add Manual Entry</button>
              <label style={{ background: '#1a1a2e', color: '#fff', borderRadius: 8, padding: '9px 14px', cursor: uploading ? 'default' : 'pointer', fontSize: 13, fontWeight: 600, opacity: uploading ? 0.5 : 1, whiteSpace: 'nowrap', textAlign: 'center' }}>
                {uploading ? 'Importing…' : 'Import spreadsheet'}
                <input type="file" accept=".xlsx,.xls,.csv" disabled={uploading}
                  onChange={(e) => { importFile(e.target.files && e.target.files[0]); e.target.value = '' }}
                  style={{ display: 'none' }} />
              </label>
            </div>
            )}
          </div>
          )}

          {/* Add form */}
          {showAddForm && (
            <EntryForm form={addForm} setForm={setAddForm}
              onSave={saveEntry} saving={saving} qsOptions={qsOptions} allProjects={allProjects} inputStyle={inputStyle}
              existingXeroIds={existingXeroIds} existingKeys={existingKeys}
              onCancel={() => { setShowAddForm(false); setAddForm(EMPTY_ENTRY) }} />
          )}

          {/* Project details incomplete banner */}
          {(() => {
            const seen = new Set()
            const incomplete = allEntries.filter(e => {
              if (!e.xeroId) return false
              const m = Array.isArray(e.detailsMissing) ? e.detailsMissing : []
              if (m.length === 0) return false
              if (seen.has(e.xeroId)) return false
              seen.add(e.xeroId); return true
            })
            if (incomplete.length === 0) return null
            // Hidden in the embed. It is a row of links INTO projects, prompting somebody
            // to go and fix them - which is work for the commercial team, not for
            // Bookkeeping, and every one of them is a way out of the read-only view.
            if (embed) return null
            return (
              <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 14px', marginBottom: 16, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: '#92400e', fontWeight: 600 }}>⚠ Project details incomplete — update in all locations:</span>
                {incomplete.map(e => (
                  <Link key={e.xeroId} href={`/project/${e.xeroId}`}
                    title={`Missing: ${(e.detailsMissing || []).join(', ')}`}
                    style={{ fontSize: 12, color: '#92400e', cursor: 'pointer', textDecoration: 'underline' }}>
                    {e.ourRef || e.projectName}{e.ourRef && e.projectName ? ` — ${e.projectName}` : ''}
                  </Link>
                ))}
              </div>
            )
          })()}

          {/* Filters */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', background: '#fff', borderRadius: 10, padding: '12px 16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', background: '#f0f2f5', borderRadius: 8, overflow: 'hidden' }}>
              {[['live', 'Live Project'], ['defects', 'Defects Liability'], ['complete', 'Complete']].map(([key, label]) => {
                const on = filter.has(key)
                return (
                  <button key={key} onClick={() => setFilter(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })}
                    title="Tick any combination"
                    style={{ padding: '6px 16px', border: 'none', background: on ? '#1a1a2e' : 'transparent', color: on ? '#fff' : '#555', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                    {on ? '✓ ' : ''}{label}
                  </button>
                )
              })}
            </div>
            <input placeholder="Search ref, customer, project..." value={search} onChange={e => setSearch(e.target.value)}
              style={{ flex: 1, minWidth: 200, padding: '7px 12px', border: '1px solid #e5e5e5', borderRadius: 8, fontSize: 12 }} />
            <span style={{ fontSize: 12, color: '#888' }}>{allEntries.length} entries</span>
            {/* Colour key */}
            <div style={{ display: 'flex', gap: 14, alignItems: 'center', fontSize: 11, color: '#666', width: '100%', marginTop: 4 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 12, height: 12, borderRadius: 3, background: '#fff3e0', border: '1px solid #ffb74d' }} /> Release due — not yet paid</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 12, height: 12, borderRadius: 3, background: '#e8f5e9', border: '1px solid #66bb6a' }} /> Release paid (amount paid covers it & FA reconciles)</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 12, height: 12, borderRadius: 3, background: '#dcfce7', border: '1px solid #16a34a' }} /> Row green = marked Complete (manual)</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 12, height: 12, borderRadius: 3, background: '#e0f2fe', border: '1px solid #0369a1' }} /> Live</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 12, height: 12, borderRadius: 3, background: '#fef9c3', border: '1px solid #a16207' }} /> Defects Liability (awaiting final retention)</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: '#a16207' }}>⚠ check FA = paid but Final Account ≠ invoiced (won’t go green until reconciled)</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: '#c77700' }}>⚠ TBC = release date not confirmed</span>
            </div>
          </div>

          {/* Table */}
          {/* overflow:hidden stays. It rounds the corners, and it does NOT interfere with
              the sticky header: the scroll box below has overflow:auto, so that is the
              nearest scrollport and the header sticks to it, not to this. */}
          <div style={embed
            ? { background: '#fff', borderRadius: 10, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', overflow: 'hidden' }
            : { background: '#fff', borderRadius: 10, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', overflow: 'hidden', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {loading ? (
              <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>Loading...</div>
            ) : allEntries.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>{filter.size === 0 ? 'No status filters selected — tick Live Project, Defects Liability or Complete above.' : 'No retention entries match the current filters.'}</div>
            ) : (
              // A BOUNDED SCROLL BOX, not a container that grows with the table.
              //
              // It had no height limit, so the table ran to whatever length it needed and
              // the page scrolled instead. The horizontal bar therefore sat at the very
              // bottom of the table - you had to scroll past every row to reach it, then
              // scroll back up to see what you had moved.
              //
              // Capping the height makes the box scroll internally in both directions:
              // the horizontal bar stays pinned at the bottom of the visible area, and
              // the header can be made sticky against the top of the box rather than the
              // page.
              //
              // MEASURED, NOT GUESSED. This was a flat "100vh - 300px". 300 was my estimate
              // of the page header, filters and summary cards above it - and it was too
              // small, so the bottom of the box (and its scrollbar with it) sat below the
              // fold and you had to scroll the page down to reach it.
              //
              // tableTop is the box's real distance from the top of the window, remeasured
              // on load, on resize, and whenever the filters change height. No estimate to
              // get wrong, and it stays right if anything is ever added above.
              <div ref={scrollBoxRef} style={embed
                ? { maxHeight: '70vh', overflow: 'auto', WebkitOverflowScrolling: 'touch', position: 'relative' }
                : { flex: 1, minHeight: 0, overflow: 'auto', WebkitOverflowScrolling: 'touch', position: 'relative' }}>
                <table style={{ minWidth: TABLE_MIN_WIDTH, width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#f8f9fa', borderBottom: '2px solid #eee' }}>
                      {[
                        ['Ref', 'left', 'Project reference (job number) from project details.', 'ref'],
                        ['Customer', 'left', 'Customer name from project details.', 'customer'],
                        ['Project', 'left', 'Project name from project details.', 'project'],
                        ['Gross AFA', 'right', 'Final account BEFORE Main Contractor\u2019s Discount: measured contract sum + variations at final value. The latest SENT application always wins - a typed value or an override is only used where the project has no sent application.', 'afaGross'],
                        ['MCD', 'right', 'Main Contractor\u2019s Discount deducted from the gross. Set on the IHM and editable in Edit Project Details.', 'mcdValue'],
                        ['Final Account', 'right', 'Gross AFA less MCD, retention included. MCD comes off only what Edit Project Details says it comes off - measured works only, or measured plus variations and materials - so a project that excludes variations from MCD is no longer over-discounted. Taken from the latest SENT application, which has already done this arithmetic; a typed value is only used where there is no sent application. This is the figure retention is calculated on.', 'finalAccount'],
                        ['Applied for', 'right', 'The sub-total on the latest SENT application: gross measured works less MCD, plus variations. The application always wins - a typed value is only used where a project has no sent application. A warning triangle means it does not agree with Certified.', 'appliedFor'],
                        ['Certified', 'right', 'The "Previously certified (gross)" box on the latest SENT application - the typed figure, used as the Previously Cert. column on the certificate, where This Certificate = current less previously. Blank means the box has not been filled in. Editable inline, but the next application sent overwrites it.', 'certified'],
                        ['Invoiced', 'right', 'Total invoiced on the project: sum of the Sales (account code 200) lines from Xero. NET of VAT, and INCLUDING retention (retention is posted to a separate account, so the Sales total already includes it). From Xero for synced projects, or the imported Xero CSV.', 'invoiced'],
                        ['✓', 'center', 'Match check: green tick when Applied for equals Invoiced, red flag when they differ.', null],
                        ['Account Remaining', 'right', 'Final Account − Applied for. What is still to be CLAIMED against the final account. Falls back to invoiced only where a project has no application.', null],
                        ['Retention Owed', 'right', 'Applied for \u00d7 Ret % - exactly the two columns to the left. Nothing else feeds it.', 'retentionOwed'],
                        ['612 Deducted', 'right', 'Retention withheld on invoices under account code 612 - the GROSS figure, before any release. Sum of the negative 612 lines. NOTE: the old "612 Allocated" column was the NET (deducted less released), which is a different number.', 'r612ded'],
                        ['612 Released', 'right', 'Retention invoiced back out - the POSITIVE account 612 lines. WARNING: a release posted as a plain sales invoice with no 612 line does not appear here, which is common on older projects. A dash means no 612 movement was found at all, which is NOT the same as nothing released.', 'r612rel'],
                        ['\u2713', 'center', 'Reconciliation: retention is released in halves, so 612 Released should be NOTHING, HALF of 612 Deducted, or ALL of it. Green on any of those three, with which one shown underneath. Red flag on anything else, with how far out it is - usually a part-release, or a deduction still growing because the job is not fully invoiced. A dash means no 612 lines at all.', null],
                        ['Ret %', 'center', 'Retention percentage from project details.', 'retPct'],
                        ['PC Type', 'left', 'Main PC or Sub PC, from Edit Project Details.', 'pcType'],
                        ['QS', 'left', 'Quantity Surveyor from Edit Project Details. Blank means none has been set on that project.', 'qs'],
                        ['1st Value \u2013 click to release', 'right', 'First retention release - half of the retention on the FINAL ACCOUNT (Gross AFA less MCD x retention %), which is what the contract holds and what an application certificate releases. CLICK THE CELL to confirm this half has been released; click again to undo. A half ticked in the retention section of an application marks itself. Amber = still to confirm, blue = Xero looks paid so it probably has been, green = released.', null],
                        ['1st Date', 'left', 'Due date of the first retention release (manual).', 'r1date'],
                        ['2nd Value \u2013 click to release', 'right', 'Second retention release - half of the retention on the FINAL ACCOUNT (Gross AFA less MCD x retention %), which is what the contract holds and what an application certificate releases. CLICK THE CELL to confirm this half has been released; click again to undo. A half ticked in the retention section of an application marks itself. Amber = still to confirm, blue = Xero looks paid so it probably has been, green = released.', null],
                        ['2nd Date', 'left', 'Due date of the second retention release (manual).', 'r2date'],
                        ['VAT', 'right', 'VAT on the Final Account = Final Account × VAT-type rate. Reverse charge / 0% = £0.', null],
                        ['VAT Type', 'left', 'VAT treatment from Xero: reverse charge, 5%, 20%, zero-rated, etc.', null],
                        ['Total Due', 'right', 'Final Account + VAT. The full amount due including VAT.', null],
                        ['Total Paid', 'right', 'Total received from the customer (including VAT). From Xero / the imported CSV.', 'paid'],
                        ['Total Remaining (Check)', 'right', 'Total Due − Total Paid.', null],
                        ['Comments', 'left', 'Synced with the retention release date comments box in Project Details.', null],
                        ['', 'left', '', null],
                      ].map(([h, align, tip, key]) => (
                        <th key={(h || 'actions') + (key || '')} title={tip || undefined}
                          onClick={() => key && toggleSort(key)}
                          style={{
                            padding: '9px 10px', textAlign: align, fontWeight: 600,
                            color: sortKey === key ? '#1a1a2e' : '#555', whiteSpace: 'nowrap',
                            cursor: key ? 'pointer' : (tip ? 'help' : 'default'), userSelect: 'none',
                            // Sticky per CELL, not on the row: with borderCollapse the row's
                            // background does not travel with a sticky cell, so each th
                            // carries its own or the data scrolls through it.
                            position: 'sticky', top: 0, zIndex: 2,
                            background: '#f8f9fa',
                            // Same reason - a collapsed border is painted by the table and
                            // scrolls away with it. This one is part of the cell.
                            boxShadow: 'inset 0 -2px 0 #eee',
                          }}>
                          {h}{key && sortKey === key ? <span style={{ marginLeft: 3, fontSize: 10 }}>{sortDir === 'asc' ? '▲' : '▼'}</span> : (tip ? <span style={{ color: '#bbb', marginLeft: 3, fontSize: 10 }}>ⓘ</span> : null)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedEntries.map((entry, i) => {
                      const isEditing = editingId === entry.id
                      const closed = isClosed(entry)
                      // 0% retention. Explicit zero only - a BLANK retention means nobody
                      // has set it yet, which is a different thing and still needs
                      // chasing. Treating blank as zero would hide the projects that
                      // actually need attention.
                      const noRetention = entry.retentionPct !== '' && entry.retentionPct != null
                        && parseFloat(entry.retentionPct) === 0
                      const rowBg = closed ? '#dcfce7' : (i % 2 === 0 ? '#fff' : '#fafafa')
                      const fa = accountValue(entry)
                      const invNet = entry.invoicedNet != null ? parseFloat(entry.invoicedNet) : (entry.invoiced != null ? parseFloat(entry.invoiced) : null)
                      const accRemaining = fa ? fa - (invNet || 0) : null
                      const vatVal = calcVat(entry)
                      const totalDue = calcTotalDue(entry)
                      const totalRemaining = calcTotalRemaining(entry)
                      const hasPaid = entry.paid != null && entry.paid !== ''
                      // Release "received" is now DERIVED from what's actually been paid
                      // (no manual tick box):
                      //  • 1st release is settled once only the 2nd half remains to pay
                      //    (remaining <= 2nd release value).
                      //  • 2nd release is settled once the account is paid in full.
                      const r1v = calcReleaseHalf(entry)
                      const r2v = calcReleaseHalf(entry)
                      const paidKnown = hasPaid && fa
                      // Final Account vs Invoiced. Releases should only go green once the
                      // FA and the invoiced value reconcile; if invoiced exceeds FA the
                      // FA is understated (warning shown on the FA cell).
                      const faKnown = fa > 0 && invNet != null
                      const faMatchesInvoiced = faKnown && Math.abs(fa - (invNet || 0)) < 1
                      const faBelowInvoiced = faKnown && (invNet || 0) - fa > 1
                      // The paid balance used to DECIDE whether a half was released. It no
                      // longer does - releases are marked by hand or by an application -
                      // but it is still a useful hint, so it is offered as a suggestion on
                      // an unmarked cell rather than turning it green on its own.
                      const settledSecond = paidKnown ? (totalRemaining < 1) : false
                      const settledFirst = paidKnown ? (settledSecond || totalRemaining <= r2v + 1) : false
                      const paidSuggests = { 1: settledFirst && faMatchesInvoiced, 2: settledSecond && faMatchesInvoiced }
                      // Release cell: green when settled AND FA reconciles; amber warning
                      // when settled but FA≠Invoiced; orange "due" otherwise.
                      // Release cell. CLICK TO TOGGLE - the whole point, since a project
                      // added from the old spreadsheet has no application to mark it off.
                      //
                      // Was derived from the paid balance reaching zero, gated on Final
                      // Account matching invoiced to within a pound. That could never
                      // settle an old project whose release went out uncoded, and there
                      // was no way to say so by hand.
                      const releaseCell = (val, half) => {
                        const has = val != null && val !== '' && !isNaN(parseFloat(val))
                        if (!has) return <td style={{ padding: '8px 10px', textAlign: 'right', color: '#bbb' }}>—</td>
                        const on = half === 1 ? released1(entry) : released2(entry)
                        const src = releaseSource(entry, half)
                        // Xero says this looks paid off but nobody has marked it. Prompt,
                        // do not decide - that guess is exactly what could never work on
                        // an old project whose release went out uncoded.
                        const hint = !on && src !== 'overridden' && paidSuggests[half]
                        // An unmarked cell says what to DO, not just what it is. "due" on
                        // its own gave no clue that the cell was the control - the whole
                        // point of the change is that somebody has to confirm the release.
                        const tag = on
                          ? (src === 'application' ? '\u2713 released (app)' : '\u2713 released')
                          : (src === 'overridden' ? 'not released \u2013 click to accept' : (hint ? 'looks paid \u2013 click to confirm' : 'click to confirm released'))
                        return (
                          <td onClick={() => toggleRelease(entry, half)}
                            title={on
                              ? (src === 'application' ? 'Marked released by the retention section on an application. Click to override.' : 'Marked released by hand. Click to undo.')
                              : (src === 'overridden' ? 'An application says this was released, but it has been overridden here. Click to accept the application.' : 'Click to mark this half released.')}
                            style={{
                              padding: '6px 10px', textAlign: 'right', whiteSpace: 'nowrap', cursor: 'pointer',
                              background: on ? '#e8f5e9' : (src === 'overridden' ? '#fef9c3' : (hint ? '#eff6ff' : '#fff3e0')),
                              // A dashed outline on anything still to confirm, so the
                              // clickable cells read as buttons at a glance down the column
                              // rather than as another money column.
                              outline: on ? 'none' : '1px dashed ' + (src === 'overridden' ? '#d1a441' : (hint ? '#93c5fd' : '#e6b980')),
                              outlineOffset: -3,
                            }}>
                            <div style={{ fontWeight: 600, color: on ? '#166534' : (src === 'overridden' ? '#a16207' : '#b26a00') }}>{fmt(parseFloat(val))}</div>
                            <div style={{ fontSize: 9, color: on ? '#16a34a' : (src === 'overridden' ? '#a16207' : (hint ? '#2563eb' : '#c77700')), fontWeight: 700, textDecoration: on ? 'none' : 'underline', textUnderlineOffset: 2 }}>{tag}</div>
                          </td>
                        )
                      }
                      // Match indicator: green tick when the two values agree (within
                      // £1), red flag when they differ. Grey dash if either is missing.
                      const matchCell = (a, b, hasBoth, mismatchTip) => {
                        if (!hasBoth) return <td style={{ padding: '8px 6px', textAlign: 'center', color: '#cbd5e1' }}>—</td>
                        const ok = Math.abs((parseFloat(a) || 0) - (parseFloat(b) || 0)) < 1
                        return <td style={{ padding: '8px 6px', textAlign: 'center' }} title={ok ? 'Match' : (mismatchTip || 'Mismatch — figures differ')}>
                          <span style={{ fontSize: 14, color: ok ? '#16a34a' : '#dc2626' }}>{ok ? '✓' : '🚩'}</span>
                        </td>
                      }
                      return (
                        <>
                          <tr key={entry.id} style={{ borderBottom: '1px solid #f0f0f0', background: rowBg }}>
                            {/* Ref */}
                            <td style={{ padding: '8px 10px', fontWeight: 600, color: '#1a1a2e', whiteSpace: 'nowrap' }}>
                              {entry.manual === false && entry.xeroId
                                ? (embed
                                    // No route out of the embed: Bookkeeping should not
                                    // land in Project Financials from here.
                                    ? <span>{entry.ourRef}</span>
                                    : <Link href={`/project/${entry.xeroId}`} style={{ color: '#2563eb' }}>{entry.ourRef}</Link>)
                                : entry.ourRef || '—'}
                              {!entry.manual && (entry.inXero === false
                                ? <span title="This project's tracking category has been deleted in Xero. Everything here is kept - applications, contracted rates, variations, retention - but the invoiced and paid figures are frozen at the last sync." style={{ marginLeft: 4, fontSize: 9, background: '#ffedd5', color: '#c2410c', borderRadius: 4, padding: '1px 4px', fontWeight: 700 }}>Not in Xero</span>
                                : <span style={{ marginLeft: 4, fontSize: 9, background: '#eef2ff', color: '#4f46e5', borderRadius: 4, padding: '1px 4px' }}>Xero</span>)}
                              {(() => {
                                const st = retStatusOf(entry)
                                const meta = st === 'complete' ? { t: 'Complete', bg: '#dcfce7', c: '#166534' }
                                  : st === 'defects' ? { t: 'Defects', bg: '#fef9c3', c: '#a16207' }
                                  : { t: 'Live', bg: '#e0f2fe', c: '#0369a1' }
                                return <span style={{ marginLeft: 4, fontSize: 9, background: meta.bg, color: meta.c, borderRadius: 4, padding: '1px 5px', fontWeight: 700 }}>{meta.t}</span>
                              })()}
                            </td>
                            {/* Customer */}
                            <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{entry.customerName || '—'}</td>
                            {/* Project */}
                            <td style={{ padding: '8px 10px', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.projectName || '—'}</td>
                            {/* Gross AFA - before MCD */}
                            <td style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap', color: '#666' }}>
                              {entry.afaGross != null ? fmt(parseFloat(entry.afaGross)) : '\u2014'}
                              {entry.afaSource && <div style={{ fontSize: 9.5, color: entry.afaSource === 'manual override' ? '#b45309' : '#bbb' }}>{entry.afaSource}</div>}
                              {/* Two different notes, and the old one fired for both.
                                  "stale override saved" was showing on rows where the
                                  stamp WAS the figure on screen, which read as a
                                  contradiction next to "sent, as issued". */}
                              {entry.afaStampStale ? (
                                <div style={{ fontSize: 9, color: '#b45309' }} title="This application was edited after it was sent. The figure shown is the application as it stands now; the figure saved when it was sent is different. Re-send the application to bring them back into line.">
                                  edited since sent
                                </div>
                              ) : entry.afaOverrideIgnored ? (
                                <div style={{ fontSize: 9, color: '#b45309' }} title="A figure left on this project by an EARLIER application is still saved but is not used - the latest sent application takes precedence.">
                                  older figure saved
                                </div>
                              ) : null}
                            </td>
                            {/* MCD deducted. A missing percentage is shown, not hidden -
                                a blank here means nobody has recorded one and the Final
                                Account is therefore the gross. */}
                            <td style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap', color: '#666' }}>
                              {fmt(parseFloat(entry.mcdValue || 0))}
                              <div style={{ fontSize: 9.5, color: entry.mcdRecorded ? '#999' : '#bbb' }}
                                title={entry.mcdRecorded ? '' : 'No MCD recorded - treated as 0%'}>
                                {parseFloat(entry.mcdPct || 0).toFixed(2)}%{!entry.mcdRecorded && ' (default)'}
                              </div>
                            </td>
                            {/* Final Account - net of MCD, the base for retention */}
                            <td style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap', color: faBelowInvoiced ? '#dc2626' : undefined, fontWeight: faBelowInvoiced ? 700 : undefined }}>
                              {fmt(fa || null)}
                              {faBelowInvoiced && <div style={{ fontSize: 9.5, color: '#dc2626', fontWeight: 600 }}>⚠ FA lower than invoiced</div>}
                            </td>
                            {/* Applied for (manual override) */}
                            {/* Click to see WHERE this number came from - which
                                application, its status, and every candidate figure. */}
                            <td onClick={() => setAppliedForFor(entry)}
                              title="Click to see which application this came from."
                              style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap', color: '#555', cursor: 'pointer' }}>
                              <span style={{ borderBottom: '1px dashed #d1d5db' }}>
                                {entry.appliedFor != null && entry.appliedFor !== '' ? fmt(parseFloat(entry.appliedFor)) : '\u2014'}
                              </span>
                              {entry.appliedForDetail && entry.appliedForDetail.sentApp
                                ? <div style={{ fontSize: 9, color: '#bbb' }}>app {entry.appliedForDetail.sentApp}</div> : null}
                              {(() => {
                                const a = parseFloat(entry.appliedFor || 0) || 0
                                const c = parseFloat(entry.certified || 0) || 0
                                if (!a || !c || Math.abs(a - c) < 1) return null
                                return <span title={`Applied for ${fmtC(a)} does not match Certified ${fmtC(c)} - out by ${fmtC(a - c)}. Usually the latest application is not yet certified.`}
                                  style={{ marginLeft: 5, color: '#b45309', fontSize: 12 }}>&#9888;</span>
                              })()}
                            </td>
                            {/* Certified - inline editable, overwritten by the next sent application */}
                            <InlineNumberCell
                              value={entry.certified}
                              note={entry.certifiedFromApp ? `app ${entry.certifiedFromApp}` : ''}
                              disabled={!!entry.certifiedLocked}
                              title={entry.certifiedLocked
                                ? `From the "Previously certified (gross)" box on application ${entry.certifiedFromApp}. Change it there, not here - a value typed on this row would be discarded.`
                                : undefined}
                              onCommit={(v) => { const { appliedForDetail, ...rest } = entry; saveEntry({ ...rest, certified: v }) }}
                            />
                            {/* Invoiced Net */}
                            <td style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap', color: '#555' }}>{invNet != null ? fmt(invNet) : '—'}</td>
                            {/* Applied-for vs Invoiced match (right of Invoiced) */}
                            {matchCell(entry.certified, invNet, entry.certified != null && entry.certified !== '' && invNet != null, 'Mismatch - certified and invoiced differ. Either something certified has not been invoiced, or an invoice has gone out for something not certified.')}
                            {/* Account Remaining */}
                            <td style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600, color: accRemaining == null ? '#bbb' : Math.abs(accRemaining) < 1 ? '#16a34a' : '#2563eb' }}>{accRemaining == null ? '—' : fmtC(accRemaining)}</td>
                            {/* Retention Owed (invoiced × ret %) */}
                            <td style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600 }}>{fmt(calcRetentionOwed(entry))}</td>
                            {/* 612 Allocated (gross deducted) and 612 Released. A dash
                                rather than a zero where no 612 movement exists at all -
                                "no evidence" and "nothing released" are different
                                answers, and older projects give the first. */}
                            {/* CLICK FOR THE WORKING. Four attempts at the 612 figures
                                were made by inferring from totals; this shows the stored
                                lines so they can be read straight against Xero. */}
                            <td onClick={() => entry.ret612Lines && setRet612For(entry)}
                              title={entry.ret612Lines ? 'Click for every 612 line on this project' : undefined}
                              style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap', color: '#555', cursor: entry.ret612Lines ? 'pointer' : 'default', textDecoration: entry.ret612Lines ? 'underline dotted' : 'none' }}>{entry.ret612Lines ? fmt(parseFloat(entry.retention612Deducted || 0)) : '\u2014'}</td>
                            <td style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap', color: (parseFloat(entry.retention612Released) || 0) > 0 ? '#16a34a' : '#bbb' }}
                              title={entry.ret612Lines ? `${entry.ret612Lines} account 612 line${entry.ret612Lines === 1 ? '' : 's'}${entry.ret612From ? ` from ${entry.ret612From}` : ''}${(parseFloat(entry.retention612ReleasedPaid) || 0) > 0 ? ` - ${fmtC(parseFloat(entry.retention612ReleasedPaid))} of it on invoices now paid` : ''}` : 'No account 612 lines found on this project - either none synced yet, or releases were posted straight to sales.'}>
                              {entry.ret612Lines ? fmt(parseFloat(entry.retention612Released || 0)) : '\u2014'}</td>
                            {/* RECONCILIATION.
                                Releases happen in halves, so what Xero has released
                                against a project should be one of exactly three figures:
                                nothing, half the retention withheld, or all of it.

                                Measured against 612 DEDUCTED - Xero's own gross - so the
                                check is self-contained and does not depend on whether an
                                application or a manual mark recorded the release.

                                The previous version compared Retention Owed against 612,
                                but Owed only deducts what an APPLICATION claimed. Since
                                releases are now marked by hand on this page, a hand-marked
                                release left Owed untouched and the row flagged even when
                                Xero and the register agreed perfectly. It also ticked rows
                                releasing odd part-amounts, which are the ones actually
                                worth looking at. */}
                            {(() => {
                              const ded = parseFloat(entry.retention612Deducted) || 0
                              const rel = parseFloat(entry.retention612Released) || 0
                              if (!entry.ret612Lines) return <td style={{ padding: '8px 6px', textAlign: 'center', color: '#cbd5e1' }} title="No account 612 lines on this project, so there is nothing to reconcile against.">&mdash;</td>
                              // DOES XERO AGREE WITH THE REGISTER?
                              //
                              // This compared 612 Released against 612 Deducted and
                              // printed "both halves" when they matched - the language of
                              // the release cells beside it, for a test that never looked
                              // at them. Unticking a release changed nothing, because the
                              // column was not reading your marks at all.
                              //
                              // Retention Owed is the source of truth. Xero should show
                              // that much deducted, and should show released whatever you
                              // have marked released. Two comparisons, both stated.
                              const owed = calcRetentionOwed(entry)
                              const markedRel = (released1(entry) ? calcReleaseHalf(entry) : 0)
                                + (released2(entry) ? calcReleaseHalf(entry) : 0)
                              // A pound of tolerance - retention halves round.
                              const dedOk = Math.abs(ded - owed) < 1
                              const relOk = Math.abs(rel - markedRel) < 1
                              const ok = dedOk && relOk
                              const label = ok ? 'ties' : !dedOk && !relOk ? 'both out' : !dedOk ? 'deducted out' : 'released out'
                              // Distance to whichever expected figure is nearest, so a flag
                              // says HOW FAR out rather than only that it is out.
                              // The bigger of the two gaps, so the number under the flag
                              // says how far out the worse side is.
                              const dedGap = ded - owed, relGap = rel - markedRel
                              const worst = Math.abs(dedGap) >= Math.abs(relGap) ? dedGap : relGap
                              return (
                                <td style={{ padding: '6px 6px', textAlign: 'center', whiteSpace: 'nowrap' }}
                                  title={`Retention Owed ${fmtC(owed)} vs 612 Deducted ${fmtC(ded)}${dedOk ? ' - ties' : ` - out by ${fmtC(dedGap)}`}.\n`
                                    + `Marked released ${fmtC(markedRel)} vs 612 Released ${fmtC(rel)}${relOk ? ' - ties' : ` - out by ${fmtC(relGap)}`}.\n\n`
                                    + `Retention Owed is the source of truth; Xero should match it. A gap usually means a 612 line coded to the wrong project, a release invoiced without a 612 line, or a credit note that has not synced.`}>
                                  <div style={{ color: ok ? '#16a34a' : '#dc2626', fontWeight: 700 }}>{ok ? '\u2713' : '\u2691'}</div>
                                  <div style={{ fontSize: 8.5, color: ok ? '#9ca3af' : '#dc2626', fontWeight: 600 }}>{ok ? label : fmtC(worst)}</div>
                                </td>
                              )
                            })()}
                            {/* Ret % */}
                            <td style={{ padding: '8px 10px', textAlign: 'center' }}>{entry.retentionPct ? `${parseFloat(entry.retentionPct).toFixed(0)}%` : '—'}</td>
                            {/* PC Type */}
                            <td style={{ padding: '8px 10px', color: '#555' }}>{entry.pcType || '—'}</td>
                            {/* QS */}
                            <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{entry.qsName || '—'}</td>
                            {/* Retention releases. At 0% retention there is nothing to
                                release, so chasing a release date is chasing something
                                that does not exist - the row showed an amber "TBC"
                                warning for ever on projects that were never going to
                                have one. N/A, greyed, and no warning. */}
                            {/* 1st Value (coloured) */}
                            {noRetention
                              ? <td style={naCell} title="Retention is 0% on this project - nothing to release.">N/A</td>
                              : releaseCell(calcReleaseHalf(entry), 1)}
                            {/* 1st Date */}
                            {noRetention
                              ? <td style={naCell} title="Retention is 0% on this project - nothing to release.">N/A</td>
                              : <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', color: entry.release1Date ? '#555' : '#c77700' }}>{entry.release1Date || (entry.pcDateTBC ? <span title="PC date marked TBC in project details.">⚠ TBC</span> : (closed ? '—' : <span title="Retention release date not confirmed — set it in Edit / project details.">⚠ TBC</span>))}</td>}
                            {/* 2nd Value (coloured) */}
                            {noRetention
                              ? <td style={naCell} title="Retention is 0% on this project - nothing to release.">N/A</td>
                              : releaseCell(calcReleaseHalf(entry), 2)}
                            {/* 2nd Date */}
                            {noRetention
                              ? <td style={naCell} title="Retention is 0% on this project - nothing to release.">N/A</td>
                              : <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', color: entry.release2Date ? '#555' : '#c77700' }}>{entry.release2Date || (entry.defectsDateTBC ? <span title="Defects date marked TBC in project details.">⚠ TBC</span> : (closed ? '—' : <span title="Retention release date not confirmed — set it in Edit / project details.">⚠ TBC</span>))}</td>}
                            {/* VAT */}
                            {vatNeedsManual(entry)
                              ? <td style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                  <span title="This project has mixed VAT treatments across its invoices, so VAT can't be auto-calculated. Enter it manually in Edit." style={{ color: '#dc2626', fontSize: 12.5, fontWeight: 600, cursor: 'help' }}>⚠ enter manually</span>
                                </td>
                              : <td style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap', color: '#555' }}>{fa ? fmtC(vatVal) : '—'}</td>}
                            {/* VAT Type */}
                            <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', color: '#555', fontSize: 11.5 }}>{entry.vatRateLabel && entry.vatRateLabel !== '—' ? entry.vatRateLabel : '—'}</td>
                            {/* Total Due */}
                            <td style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600 }}>{fa ? fmtC(totalDue) : '—'}</td>
                            {/* Total Paid */}
                            <td style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap', color: '#555' }}>{hasPaid ? fmt(parseFloat(entry.paid)) : '—'}</td>
                            {/* Total Remaining (Check) */}
                            <td style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 700, color: !fa ? '#bbb' : closed ? '#16a34a' : '#dc2626' }}>{fa ? fmtC(totalRemaining) : '—'}</td>
                            {/* Comments */}
                            <td style={{ padding: '8px 10px', color: '#555', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={entry.comments || ''}>{entry.comments || '—'}</td>
                            {/* Actions */}
                            <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                              {embed ? <span style={{ color: '#bbb', fontSize: 11 }}>—</span> : <>
                              <button onClick={() => { setEditingId(entry.id); setEditForm({ ...entry }) }}
                                style={{ background: '#f0f2f5', border: '1px solid #e5e5e5', borderRadius: 6, padding: '3px 8px', fontSize: 11, cursor: 'pointer', color: '#333', marginRight: 4 }}>Edit</button>
                              {(() => {
                                const st = retStatusOf(entry)
                                if (st === 'live') return (
                                  <button onClick={() => setRetStatus(entry, 'defects')}
                                    title="Move to Defects Liability (requires Final Account = Invoiced)"
                                    style={{ background: '#fff', border: '1px solid #cbd5e1', borderRadius: 6, padding: '3px 8px', fontSize: 11, cursor: 'pointer', color: '#333', marginRight: 4, fontWeight: 600 }}>→ Defects Liability</button>
                                )
                                if (st === 'defects') return (
                                  <>
                                    <button onClick={() => setRetStatus(entry, 'complete')}
                                      title="Mark project Complete"
                                      style={{ background: '#dcfce7', border: '1px solid #16a34a', borderRadius: 6, padding: '3px 8px', fontSize: 11, cursor: 'pointer', color: '#166534', marginRight: 4, fontWeight: 600 }}>✓ Complete</button>
                                    <button onClick={() => setRetStatus(entry, 'live')}
                                      title="Move back to Live Project"
                                      style={{ background: '#fff', border: '1px solid #cbd5e1', borderRadius: 6, padding: '3px 8px', fontSize: 11, cursor: 'pointer', color: '#666', marginRight: 4 }}>↩ Live</button>
                                  </>
                                )
                                return (
                                  <button onClick={() => setRetStatus(entry, 'defects')}
                                    title="Re-open — back to Defects Liability"
                                    style={{ background: '#fff', border: '1px solid #cbd5e1', borderRadius: 6, padding: '3px 8px', fontSize: 11, cursor: 'pointer', color: '#666', marginRight: 4 }}>↩ Re-open</button>
                                )
                              })()}
                              {entry.manual !== false && (
                                <button onClick={() => deleteEntry(entry.id)}
                                  style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '3px 8px', fontSize: 11, cursor: 'pointer', color: '#e63946' }}>Del</button>
                              )}
                              </>}
                            </td>
                          </tr>
                          {isEditing && (
                            <tr key={`edit-${entry.id}`}>
                              <td colSpan={26} style={{ padding: '0 10px 10px' }}>
                                <EntryForm form={editForm} setForm={setEditForm}
                                  onSave={saveEntry} saving={saving} qsOptions={qsOptions} allProjects={allProjects} inputStyle={inputStyle}
                                  onCancel={() => setEditingId(null)} />
                              </td>
                            </tr>
                          )}
                        </>
                      )
                    })}
                    {/* TOTALS. Sums the rows CURRENTLY SHOWN, so it answers the filter you
                        have applied rather than always reporting the whole register - and
                        the count says how many rows are behind it, so a filtered total
                        cannot be mistaken for the lot.

                        Sticky at the foot, because a total you have to scroll 200 rows to
                        reach is a total nobody reads. */}
                    {sortedEntries.length > 0 && (() => {
                      const sum = (fn) => sortedEntries.reduce((t, e) => t + (Number(fn(e)) || 0), 0)
                      const n = (k) => sum((e) => parseFloat(e[k] || 0) || 0)
                      const relSum = (which) => sum((e) => (which === 1 ? released1(e) : released2(e)) ? calcReleaseHalf(e) : 0)
                      const tdT = { padding: '9px 10px', textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap',
                        position: 'sticky', bottom: 0, zIndex: 2, background: '#f1f5f9', borderTop: '2px solid #cbd5e1' }
                      const tdL = { ...tdT, textAlign: 'left' }
                      return (
                        <tr>
                          <td style={tdL}>Totals</td>
                          <td style={tdL} />
                          <td style={tdL}>{sortedEntries.length} shown</td>
                          <td style={tdT}>{fmtC(n('afaGross'))}</td>
                          <td style={tdT}>{fmtC(n('mcdValue'))}</td>
                          <td style={tdT}>{fmtC(sum((e) => parseFloat(e.finalAccount || e.projectValue || 0) || 0))}</td>
                          <td style={tdT}>{fmtC(n('appliedFor'))}</td>
                          <td style={tdT}>{fmtC(n('certified'))}</td>
                          <td style={tdT}>{fmtC(sum((e) => parseFloat(e.invoicedNet != null ? e.invoicedNet : e.invoiced || 0) || 0))}</td>
                          <td style={tdT} />
                          <td style={tdT}>{fmtC(sum(calcAccountRemaining))}</td>
                          <td style={tdT}>{fmtC(sum(calcRetentionOwed))}</td>
                          <td style={tdT}>{fmtC(n('retention612Deducted'))}</td>
                          <td style={tdT}>{fmtC(n('retention612Released'))}</td>
                          <td style={tdT} />
                          <td style={tdT} />
                          <td style={tdL} />
                          <td style={tdL} />
                          {/* Only the halves actually RELEASED, matching the card. */}
                          <td style={tdT}>{fmtC(relSum(1))}</td>
                          <td style={tdL} />
                          <td style={tdT}>{fmtC(relSum(2))}</td>
                          <td style={tdL} />
                          <td style={tdT}>{fmtC(sum(calcVat))}</td>
                          <td style={tdL} />
                          <td style={tdT}>{fmtC(sum(calcTotalDue))}</td>
                          <td style={tdT}>{fmtC(n('paid'))}</td>
                          <td style={tdT}>{fmtC(sum(calcTotalRemaining))}</td>
                          <td style={tdL} />
                          <td style={tdL} />
                        </tr>
                      )
                    })()}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

// Top-level so it isn't recreated on every keystroke of the parent (which would
// steal focus from inputs). Project Name is an autocomplete: typing suggests
// matching existing projects; picking one auto-fills and links the entry.
function EntryForm({ form, setForm, onSave, onCancel, saving, qsOptions = [], allProjects = [], inputStyle, existingXeroIds = new Set(), existingKeys = new Set() }) {
  const f = field => e => setForm({ ...form, [field]: e.target.value })
  const fb = field => e => setForm({ ...form, [field]: e.target.checked })
  const [showSuggest, setShowSuggest] = useState(false)
  const suggestRef = useRef(null)

  useEffect(() => {
    if (!showSuggest) return
    const onDown = (e) => { if (suggestRef.current && !suggestRef.current.contains(e.target)) setShowSuggest(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [showSuggest])

  const applyProject = (p) => {
    // Auto-fill the details but DO NOT link (no xeroId): a manual entry lives only
    // in the Retention Tracker and must never write back to / appear in Project
    // Financials. It's a standalone snapshot of the values at time of adding.
    setForm({
      ...form,
      ourRef: p.ourRef || '',
      customerName: p.customerName || '',
      projectName: p.projectName || '',
      projectValue: p.projectValue || '',
      finalAccount: p.finalAccount || '',
      retentionPct: p.retentionPct || '',
      completionDate: p.completionDate || '',
      qsName: p.qsName || '',
      comments: p.comments || form.comments || '',
      trackerOnly: true,
    })
    setShowSuggest(false)
  }

  const q = (form.projectName || '').trim().toLowerCase()
  // Only suggest for NEW entries and when the row isn't already linked to a project.
  const canSuggest = !form.id && !form.xeroId
  const matches = canSuggest && q.length >= 1
    ? allProjects.filter(p => {
        // Skip any project already in the tracker (by xeroId, ref or name).
        if (existingXeroIds.has(p.xeroId)) return false
        if (existingKeys.has((p.ourRef || '').trim().toLowerCase())) return false
        if (existingKeys.has((p.projectName || '').trim().toLowerCase())) return false
        return (p.projectName || '').toLowerCase().includes(q) ||
               (p.ourRef || '').toLowerCase().includes(q) ||
               (p.customerName || '').toLowerCase().includes(q)
      }).slice(0, 8)
    : []

  return (
    <div style={{ background: '#f8f9fa', border: '1px solid #e5e5e5', borderRadius: 10, padding: 20, marginBottom: 16 }}>
      {!form.id && (
        <div style={{ fontSize: 10.5, color: '#0f766e', marginBottom: 10 }}>
          Tip: start typing a <strong>Project Name</strong> (or ref/customer) below to pull up an existing project and auto-fill its details — or just type everything in manually.
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 10, color: '#888', marginBottom: 3 }}>Our Ref</div>
          <input value={form.ourRef || ''} onChange={f('ourRef')} style={inputStyle} />
        </div>
        <div>
          <div style={{ fontSize: 10, color: '#888', marginBottom: 3 }}>Customer</div>
          <input value={form.customerName || ''} onChange={f('customerName')} style={inputStyle} />
        </div>
        <div style={{ position: 'relative' }} ref={suggestRef}>
          <div style={{ fontSize: 10, color: '#888', marginBottom: 3 }}>Project Name</div>
          <input value={form.projectName || ''} autoComplete="off"
            onChange={e => { setForm({ ...form, projectName: e.target.value }); setShowSuggest(true) }}
            onFocus={() => setShowSuggest(true)}
            style={inputStyle} placeholder="Start typing to search…" />
          {showSuggest && matches.length > 0 && (
            <div style={{ position: 'absolute', zIndex: 30, top: '100%', left: 0, right: 0, marginTop: 4, background: '#fff', border: '1px solid #ddd', borderRadius: 8, boxShadow: '0 6px 20px rgba(0,0,0,0.12)', maxHeight: 240, overflowY: 'auto' }}>
              <div style={{ fontSize: 10, color: '#999', padding: '6px 10px 2px' }}>Existing projects</div>
              {matches.map(p => (
                <button key={p.xeroId} type="button" onClick={() => applyProject(p)}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '7px 10px', border: 'none', background: '#fff', cursor: 'pointer', fontSize: 12.5, color: '#1a1a19' }}>
                  <span style={{ fontWeight: 600 }}>{p.projectName || '(no name)'}</span>
                  <span style={{ color: '#888' }}>{p.ourRef ? `  ·  ${p.ourRef}` : ''}{p.customerName ? `  ·  ${p.customerName}` : ''}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div>
          <div style={{ fontSize: 10, color: '#888', marginBottom: 3 }}>PC Type (Main/Sub)</div>
          <select value={form.pcType || ''} onChange={f('pcType')} style={inputStyle}>
            <option value="">— Select —</option>
            <option value="Main PC">Main PC</option>
            <option value="Sub PC">Sub PC</option>
          </select>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 12 }}>
        {[['projectValue', 'Project Value £'], ['finalAccount', 'Final Account £'], ['retentionPct', 'Retention %'], ['completionDate', 'Completion Date']].map(([key, label]) => (
          <div key={key}>
            <div style={{ fontSize: 10, color: '#888', marginBottom: 3 }}>{label}</div>
            <input type={key.includes('Date') ? 'date' : key.includes('Value') || key.includes('Pct') || key.includes('pct') ? 'number' : 'text'}
              value={form[key] || ''} onChange={f(key)} style={inputStyle} />
          </div>
        ))}
        <div>
          <div style={{ fontSize: 10, color: '#888', marginBottom: 3 }}>QS</div>
          <select value={form.qsName || ''} onChange={f('qsName')} style={inputStyle}>
            <option value="">— select QS —</option>
            {qsOptions.map(name => <option key={name} value={name}>{name}</option>)}
            {form.qsName && !qsOptions.includes(form.qsName) && <option value={form.qsName}>{form.qsName}</option>}
          </select>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 10, color: '#888', marginBottom: 3 }}>Applied for £ <span style={{ color: '#bbb' }}>(sent application wins)</span></div>
          <input type="number" value={form.appliedFor || ''} onChange={f('appliedFor')} style={inputStyle} />
        </div>
        <div>
          <div style={{ fontSize: 10, color: '#888', marginBottom: 3 }}>Certified £ <span style={{ color: '#bbb' }}>(next application overwrites)</span></div>
          <input type="number" value={form.certified || ''} onChange={f('certified')} style={inputStyle} />
        </div>
        <div>
          <div style={{ fontSize: 10, color: '#888', marginBottom: 3 }}>Invoiced Net £ <span style={{ color: '#bbb' }}>(ex-VAT)</span></div>
          <input type="number" value={form.invoicedNet != null ? form.invoicedNet : (form.invoiced || '')} onChange={f('invoicedNet')} style={inputStyle} />
        </div>
        <div>
          <div style={{ fontSize: 10, color: '#888', marginBottom: 3 }}>VAT Type</div>
          <select value={form.vatRateLabel || ''} onChange={f('vatRateLabel')} style={inputStyle}>
            <option value="">— select —</option>
            {['20%', '5%', '0% reverse charge', '0% zero-rated', 'Exempt', 'No VAT', 'Mixed'].map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div>
          <div style={{ fontSize: 10, color: '#888', marginBottom: 3 }}>
            Manual VAT £ {(form.vatRateLabel || '').toLowerCase() === 'mixed' && <span style={{ color: '#c77700' }}>(required — mixed)</span>}
          </div>
          <input type="number" value={form.vatManual || ''} onChange={f('vatManual')} placeholder={(form.vatRateLabel || '').toLowerCase() === 'mixed' ? 'Enter VAT' : 'auto'} style={inputStyle} />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 12 }}>
        <div style={{ background: '#eef2ff', borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#4f46e5', marginBottom: 8 }}>1st Retention Release</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 10, color: '#888', marginBottom: 3 }}>Release Value £</div>
              <input type="number" value={form.release1Value || ''} onChange={f('release1Value')} style={inputStyle} />
            </div>
            <div>
              <div style={{ fontSize: 10, color: '#888', marginBottom: 3 }}>Release Date</div>
              <input type="date" value={form.release1Date || ''} onChange={f('release1Date')} style={inputStyle} />
            </div>
          </div>
          <div style={{ fontSize: 10.5, color: '#16a34a', fontStyle: 'italic' }}>To mark this half released, close this form and CLICK the value in the 1st / 2nd Value column on the row. Ticking the half on an application's retention section does it automatically.</div>
        </div>
        <div style={{ background: '#f0fdf4', borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#16a34a', marginBottom: 8 }}>2nd Retention Release</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 10, color: '#888', marginBottom: 3 }}>Release Value £</div>
              <input type="number" value={form.release2Value || ''} onChange={f('release2Value')} style={inputStyle} />
            </div>
            <div>
              <div style={{ fontSize: 10, color: '#888', marginBottom: 3 }}>Release Date</div>
              <input type="date" value={form.release2Date || ''} onChange={f('release2Date')} style={inputStyle} />
            </div>
          </div>
          <div style={{ fontSize: 10.5, color: '#16a34a', fontStyle: 'italic' }}>To mark this half released, close this form and CLICK the value in the 1st / 2nd Value column on the row. Ticking the half on an application's retention section does it automatically.</div>
        </div>
      </div>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 10, color: '#888', marginBottom: 3 }}>Comments</div>
        <input value={form.comments || ''} onChange={f('comments')} style={inputStyle} placeholder="Any notes..." />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => onSave(form)} disabled={saving}
          style={{ background: '#1a1a2e', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 16px', cursor: 'pointer', fontSize: 12 }}>
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button onClick={onCancel}
          style={{ background: '#f0f2f5', color: '#555', border: 'none', borderRadius: 6, padding: '7px 16px', cursor: 'pointer', fontSize: 12 }}>
          Cancel
        </button>
      </div>
    </div>
  )
}

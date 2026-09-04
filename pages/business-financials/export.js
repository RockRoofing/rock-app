import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { INK } from '../../components/BizNav'
import PageErrorBoundary from '../../components/PageErrorBoundary'

// PDF EXPORT OF THE BUSINESS FINANCIALS TABS.
//
// This page mounts the REAL page components. It does not rebuild any of them.
//
// The obvious approach - generate the PDF server-side with pdf-lib - would mean a second
// implementation of all seventeen models. Every time this codebase has held two
// implementations of one rule they have drifted: the Budgets page against the API, the
// P&L against the balance sheet, the cash flow against its own fallback. A PDF that
// quietly disagreed with the screen would be worse than no PDF, because nobody would
// know which one was wrong.
//
// So the export renders the same components, fetching the same endpoints, and hands the
// result to the browser's print engine. What you get is what the page computes.

import Summary from '../business-financials'
import Sales from './sales'
import Margin from './margin'
import Bills from './bills'
import Invoices from './invoices'
import PaymentPerformance from './payment-performance'
import Reconciliation from './reconciliation'
import RetentionsDue from './retentions-due'
import VatRefund from './vat-refund'
import Budgets from './budgets'
import CashSchedule from './cash-schedule'
import InvoiceFinance from './invoice-finance'
import BalanceSheet from './balance-sheet'
import CashFlow from './cashflow'
import Monthly from './monthly'
import ForecastPL from './forecast-pl'
import ForecastBS from './forecast-balance-sheet'

const TABS = [
  ['summary', 'Summary', Summary],
  ['sales', 'Sales', Sales],
  ['margin', 'Margin', Margin],
  ['bills', 'Bills to Pay', Bills],
  ['invoices', 'Invoices Owed', Invoices],
  ['payment-performance', 'Payment Performance', PaymentPerformance],
  ['reconciliation', 'Reconciliation', Reconciliation],
  ['retentions-due', 'Retentions Due', RetentionsDue],
  ['vat-refund', 'VAT Refund', VatRefund],
  ['budgets', 'Budgets', Budgets],
  ['cash-schedule', 'Cash Schedule', CashSchedule],
  ['invoice-finance', 'Invoice Finance', InvoiceFinance],
  ['balance-sheet', 'Balance Sheet', BalanceSheet],
  ['cashflow', '13-Week Cash Flow', CashFlow],
  ['monthly', '12-Month Cash Flow', Monthly],
  ['forecast-pl', 'Forecast P&L', ForecastPL],
  ['forecast-balance-sheet', 'Forecast Balance Sheet', ForecastBS],
]

const btn = { background: '#fff', border: '1px solid #ddd9d2', borderRadius: 6, padding: '6px 12px', fontSize: 12.5, cursor: 'pointer', color: '#57534e' }
const btnMain = { ...btn, background: INK, color: '#fff', border: `1px solid ${INK}`, fontWeight: 600, padding: '8px 18px', fontSize: 13 }

export default function ExportFinancials() {
  const router = useRouter()
  const [ok, setOk] = useState(false)
  const [picked, setPicked] = useState({})
  const [rendered, setRendered] = useState(false)
  const [size, setSize] = useState('A3')

  useEffect(() => {
    fetch('/api/portal-auth?action=me').then(r => r.json()).then(d => {
      if (!d.user) { router.replace('/login'); return }
      if (d.user.role !== 'admin') { router.replace('/'); return }
      setOk(true)
      // Nothing ticked to start with. Mounting all seventeen unasked would fire well over
      // a hundred requests at Xero and Redis just for opening the page.
      const q = String(router.asPath.split('?')[1] || '')
      if (q.includes('tabs=')) {
        const want = new Set(decodeURIComponent(q.split('tabs=')[1].split('&')[0]).split(','))
        const next = {}
        for (const t of TABS) if (want.has(t[0])) next[t[0]] = true
        setPicked(next)
      }
    })
  }, [])

  if (!ok) return null

  const chosen = TABS.filter(t => picked[t[0]])
  const setAll = (v) => {
    const next = {}
    if (v) for (const t of TABS) next[t[0]] = true
    setPicked(next)
    setRendered(false)
  }
  const toggle = (k) => { setPicked(p => ({ ...p, [k]: !p[k] })); setRendered(false) }

  return (
    <div style={{ minHeight: '100vh', background: '#f7f6f3' }}>
      <Head><title>Export - Business Financials</title></Head>

      {/* Everything in here is screen-only. The print stylesheet removes it so the PDF
          starts at the first report page. */}
      <div className="rr-noprint" style={{ background: '#fff', borderBottom: '1px solid #e6e3dc', padding: '16px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <a href="/business-financials" style={{ color: '#8a857c', fontSize: 13, textDecoration: 'none' }}>&larr; Business Financials</a>
          <h1 style={{ fontSize: 20, color: INK, margin: 0 }}>Export to PDF</h1>
        </div>
        <div style={{ fontSize: 12.5, color: '#8a857c', marginTop: 6, maxWidth: 880, lineHeight: 1.5 }}>
          Tick the tabs you want, load them, then download. Each tab starts on a new page. The pages here are the
          real ones - the same code and the same figures as the tabs themselves, not a separate copy - so anything
          you change on a tab shows up here without me having to keep two versions in step.
        </div>

        <div style={{ display: 'flex', gap: 8, margin: '14px 0 10px', flexWrap: 'wrap' }}>
          <button onClick={() => setAll(true)} style={btn}>Select all</button>
          <button onClick={() => setAll(false)} style={btn}>Clear</button>
          <span style={{ fontSize: 12.5, color: '#8a857c', alignSelf: 'center', marginLeft: 4 }}>
            {chosen.length} of {TABS.length} selected
          </span>
          <span style={{ fontSize: 12.5, color: '#8a857c', alignSelf: 'center', marginLeft: 12 }}>Paper</span>
          <select value={size} onChange={e => setSize(e.target.value)} style={{ ...btn, cursor: 'pointer' }}>
            <option value="A3">A3 landscape (wide tables fit)</option>
            <option value="A4">A4 landscape</option>
          </select>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: '6px 16px', marginBottom: 14 }}>
          {TABS.map(t => (
            <label key={t[0]} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: '#44403c', cursor: 'pointer' }}>
              <input type="checkbox" checked={!!picked[t[0]]} onChange={() => toggle(t[0])} />
              {t[1]}
            </label>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={() => setRendered(true)} disabled={!chosen.length}
            style={{ ...btnMain, opacity: chosen.length ? 1 : 0.4, cursor: chosen.length ? 'pointer' : 'not-allowed' }}>
            Load {chosen.length || ''} {chosen.length === 1 ? 'page' : 'pages'}
          </button>
          <button onClick={() => window.print()} disabled={!rendered}
            style={{ ...btn, opacity: rendered ? 1 : 0.4, cursor: rendered ? 'pointer' : 'not-allowed', padding: '8px 18px', fontSize: 13 }}>
            Download PDF
          </button>
          {rendered ? (
            <span style={{ fontSize: 11.5, color: '#8a857c' }}>
              <strong>Wait for every section to finish loading before you press it</strong> - anything still saying
              &quot;Loading...&quot; prints exactly that. The Forecast P&amp;L and Forecast Balance Sheet are the slowest,
              because they each compose three endpoints.
              In the print dialog choose <strong>Save as PDF</strong>, and turn on background graphics to keep the shading.
            </span>
          ) : null}
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .rr-pg { background: #fff; }
        @media print {
          @page { size: ${size} landscape; margin: 10mm; }
          .rr-noprint { display: none !important; }
          /* Each page component sets its own full-height tinted frame. In print that
             forces a mostly empty sheet before the content, so it is overridden here
             rather than by editing seventeen files. */
          .rr-pg > div { min-height: 0 !important; background: #fff !important; }
          /* Wide financial tables live in horizontal scrollers on screen. Printed, the
             scroller clips them - the columns past the edge simply vanish.
             THE HEIGHT MUST GO WITH IT. The resizable lists carry a fixed height, and a
             fixed-height box with visible overflow spills its rows straight out of the
             box and onto whatever section follows - which is why Bills to pay was
             printing on top of the Forecast P&L. */
          .rr-pg div { overflow: visible !important; }
          .rr-pg div { height: auto !important; max-height: none !important; resize: none !important; }
          .rr-pg table { page-break-inside: auto; }
          .rr-pg tr { page-break-inside: avoid; }
          /* Controls are meaningless on paper. Inputs and selects are KEPT because they
             carry values you need to read - debtor days, retention %, manual figures. */
          .rr-pg button { display: none !important; }
          .rr-brk { page-break-before: always; }
          /* The cover is the first sheet, so nothing before it may force a break. */
          .rr-cover { page-break-before: avoid; }
          .rr-brk:first-child { page-break-before: avoid; }
          /* Divider sheets are vertically centred blocks; without this they collapse to
             the top of the page and the effect is lost. */
          .rr-pg img { max-width: 60mm; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      ` }} />

      {rendered ? (
        <>
          {/* COVER. Its own sheet - page-break-after on the section below it. */}
          <div className="rr-pg rr-cover">
            <div style={{ minHeight: '150mm', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 30mm' }}>
              <img src="/rock-logo.jpg" alt="Rock Roofing" style={{ height: 74, width: 'auto', objectFit: 'contain', marginBottom: 34 }} />
              <div style={{ fontSize: 34, fontWeight: 800, color: INK, letterSpacing: -0.5 }}>Business Financials</div>
              <div style={{ fontSize: 17, color: '#8a857c', marginTop: 6 }}>Rock Roofing Limited</div>
              <div style={{ height: 3, width: 90, background: INK, margin: '22px 0' }} />
              <div style={{ fontSize: 13, color: '#57534e', lineHeight: 1.7 }}>
                <div><strong>Prepared</strong> {new Date().toLocaleString('en-GB', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
                <div><strong>Sections</strong> {chosen.length} of {TABS.length}</div>
                <div><strong>Financial year</strong> 1 December to 30 November</div>
              </div>
              <div style={{ fontSize: 10.5, color: '#a8a49c', marginTop: 30, maxWidth: '120mm', lineHeight: 1.5 }}>
                Figures are as at the moment this was produced and include forecasts, which are estimates rather than
                commitments. Each section states its own basis and the date its data was last synced from Xero.
              </div>
            </div>
          </div>

          {/* CONTENTS. Numbered to match the section dividers. */}
          <div className="rr-pg rr-brk">
            <div style={{ padding: '0 30mm' }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: INK, marginBottom: 4 }}>Contents</div>
              <div style={{ height: 3, width: 60, background: INK, margin: '10px 0 22px' }} />
              {chosen.map((t, i) => (
                <div key={t[0]} style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '7px 0', borderBottom: '1px solid #f0eee9' }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#a8a49c', width: 26 }}>{String(i + 1).padStart(2, '0')}</span>
                  <span style={{ fontSize: 14, color: INK }}>{t[1]}</span>
                </div>
              ))}
            </div>
          </div>

          {chosen.map((t, i) => {
            const Comp = t[2]
            return (
              <div key={t[0]}>
                {/* SECTION DIVIDER, its own sheet. Makes a 16-page pack navigable and
                    stops one section's last table running into the next one's heading. */}
                <div className="rr-pg rr-brk">
                  <div style={{ minHeight: '120mm', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 30mm' }}>
                    <div style={{ fontSize: 60, fontWeight: 800, color: '#eceae5', lineHeight: 1 }}>{String(i + 1).padStart(2, '0')}</div>
                    <div style={{ fontSize: 30, fontWeight: 800, color: INK, marginTop: 6 }}>{t[1]}</div>
                    <div style={{ height: 3, width: 70, background: INK, marginTop: 16 }} />
                    <div style={{ fontSize: 11.5, color: '#a8a49c', marginTop: 14 }}>
                      Rock Roofing Limited &middot; Business Financials &middot; section {i + 1} of {chosen.length}
                    </div>
                  </div>
                </div>
                <div className="rr-pg rr-brk">
                  <div style={{ padding: '10px 24px 0', fontSize: 15, fontWeight: 700, color: INK, background: '#fff' }}>
                    {t[1]}
                    <span style={{ fontWeight: 400, fontSize: 11.5, color: '#a8a49c', marginLeft: 10 }}>
                      {new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
            {/* One boundary per tab. A single page throwing should cost you that page,
                not the whole export. */}
                  <PageErrorBoundary>
                    <Comp />
                  </PageErrorBoundary>
                </div>
              </div>
            )
          })}
        </>
      ) : (
        <div className="rr-noprint" style={{ padding: 40, color: '#a8a49c', fontSize: 13 }}>
          Nothing loaded yet. Tick the tabs you want and press Load.
        </div>
      )}
    </div>
  )
}

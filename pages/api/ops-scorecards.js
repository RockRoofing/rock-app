import { requireRole } from '../../lib/portalAuth'
import { get, set, getSubmissionIndex, getSubmission, getOpsProjects, getLiveTasks } from '../../lib/db'

// GET /api/ops-scorecards?from=YYYY-MM-DD&to=YYYY-MM-DD
//   Returns a MONTHLY SERIES so the UI can draw trend lines, matching the
//   pre-contract scorecard. Shape:
//     { months:[YYYY-MM],
//       cms:   { [cmName]: { series:[{month, ...metrics}], latest:{...} } },
//       ops:   { series:[{month, ...metrics}], latest:{...} },
//       cmNames:[...] }
//
// POST /api/ops-scorecards { month, toolbox:true|false }  -> save Toolbox Yes/No.

const DAY = 86400000
const pad = (n) => String(n).padStart(2, '0')
const monthOf = (d) => { const x = new Date(d); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}` }
const inMonth = (t, month) => t && monthOf(t) === month
const norm = (s) => (s || '').trim().toLowerCase()

function monthsBetween(fromStr, toStr) {
  const [fy, fm] = fromStr.substring(0, 7).split('-').map(Number)
  const [ty, tm] = toStr.substring(0, 7).split('-').map(Number)
  const out = []
  let y = fy, m = fm
  while (y < ty || (y === ty && m <= tm)) { out.push(`${y}-${pad(m)}`); m++; if (m > 12) { m = 1; y++ } }
  return out
}
const weekToMonth = (weekMon) => (weekMon || '').substring(0, 7)

const INCIDENCE_FORM_IDS = ['accident-book', 'hs-accident-incident-report']
const INCIDENCE_TITLE_RX = /(accident book|accident and incident report|accident & incident report)/i
const isWaterIngress = (s) => (s.formId === 'water-ingress-report') || /water ingress/i.test(s.formTitle || '')
const isPSN = (s) => (s.formId === 'pre-start-notification') || /pre-?start notification/i.test(s.formTitle || '')

export default async function handler(req, res) {
  if (!requireRole(req, res, ['post-contract', 'management', 'admin'])) return

  if (req.method === 'POST') {
    const { month, toolbox } = req.body || {}
    if (!month) return res.status(400).json({ error: 'Missing month' })
    await set(`scorecard:toolbox:${month}`, toolbox === true || toolbox === 'yes')
    return res.status(200).json({ ok: true })
  }

  try {
    const now = new Date()
    const from = req.query.from || new Date(now.getFullYear() - 1, now.getMonth(), 1).toISOString().slice(0, 10)
    const to = req.query.to || now.toISOString().slice(0, 10)
    const months = monthsBetween(from, to)

    const [projects, index, liveTasks, risks, dashCache] = await Promise.all([
      getOpsProjects(),
      getSubmissionIndex(),
      getLiveTasks(),
      get('ops:risks').then(r => r || []),
      get('dashboard:cache').then(c => c || []),
    ])
    const issues = (await get('ops:issues')) || []

    // projectNo -> CM (from IHM/Ops project)
    const projCM = {}
    for (const p of projects) projCM[p.projectNo] = p.data?.contractsManager || ''

    // Pull the forms-missing rows for the whole range (same engine the portal uses).
    // Each row: { week, projectNo, projectName, formType, responsible, role, done }
    let missingRows = []
    try {
      const origin = `https://${req.headers.host}`
      const cookie = req.headers.cookie || ''
      const fm = await fetch(`${origin}/api/forms-missing?from=${from}&to=${to}`, { headers: { cookie } }).then(r => r.json())
      missingRows = fm.rows || []
    } catch {}

    // Full submissions we need for incidence / WI / PSN metrics.
    const relevant = index.filter(s =>
      INCIDENCE_FORM_IDS.includes(s.formId) || INCIDENCE_TITLE_RX.test(s.formTitle || '') ||
      isWaterIngress(s) || isPSN(s))
    const full = await Promise.all(relevant.map(s => getSubmission(s.id).catch(() => null)))
    const subs = full.filter(Boolean)
    const projNoForSub = (s) => { const m = (s.projectName || '').match(/([A-Za-z]?\d{2,})/); return m ? m[1] : (s.projectName || '') }
    const cmForSub = (s) => projCM[projNoForSub(s)] || ''

    // Pre-fetch procurement docs for closed projects (used per-month by completion date).
    // We approximate the "completed in month" by the dashboard CLOSED stage; procurement
    // completeness is point-in-time (latest), so we attribute it to the latest month.
    const pct = (completed, required) => required > 0 ? completed / required : null

    // ── Contracts Managers ──────────────────────────────────────────────────
    const cmNames = [...new Set(projects.map(p => p.data?.contractsManager).filter(Boolean))]
    const cms = {}
    for (const cm of cmNames) {
      const mineSub = (s) => norm(cmForSub(s)) === norm(cm)
      const series = months.map(month => {
        // Pre-Start %: rows for this CM, Pre-Start form, in this month.
        const psnRows = missingRows.filter(r => r.formType === 'Pre-Start' && weekToMonth(r.week) === month && norm(r.responsible) === norm(cm))
        const psnReq = psnRows.length
        const psnDone = psnRows.filter(r => r.done).length
        const psnPct = pct(psnDone, psnReq)

        // H&S incidences (dedup per project per month).
        const incidentProjects = new Set(subs.filter(s => mineSub(s) && inMonth(s.submittedAt, month) &&
          (INCIDENCE_FORM_IDS.includes(s.formId) || INCIDENCE_TITLE_RX.test(s.formTitle || ''))).map(projNoForSub))
        const hsIncidences = incidentProjects.size

        // Water Ingress — Rock at fault, reports surveyed in this month, their projects.
        const wiRockFault = subs.filter(s => mineSub(s) && isWaterIngress(s) && inMonth(s.submittedAt, month) && norm(s.answers?.f_13) === 'rock').length

        // Issues resolved on-time %: of this CM's issues RESOLVED in the month,
        // the share resolved on/before the required date.
        const resolvedThisMonth = issues.filter(i => norm(projCM[i.projectNo]) === norm(cm) && i.resolvedDate && monthOf(i.resolvedDate) === month)
        const onTime = resolvedThisMonth.filter(i => !i.requiredDate || new Date(i.resolvedDate) <= new Date(i.requiredDate)).length
        const issuesOnTimePct = pct(onTime, resolvedThisMonth.length)

        return { month, gpMargin: null, psnPct, hsIncidences, wiRockFault, issuesOnTimePct, procPct: null }
      })

      // Point-in-time metrics attributed to the latest month:
      // Gross margin — live + defects projects for this CM (commercial designation).
      const myCommercial = dashCache.filter(p => norm(p.contractsManager) === norm(cm) && (p.status === 'INPROGRESS' || p.status === 'DEFECTS'))
      let gInv = 0, gCost = 0, gCount = 0
      for (const p of myCommercial) { if (p.grossInvoiced != null && p.totalCosts != null) { gInv += p.grossInvoiced || 0; gCost += p.totalCosts || 0; gCount++ } }
      const gpMargin = gInv > 0 ? (gInv - gCost) / gInv : null

      // Procurement savings %: of this CM's CLOSED projects, share with a fully
      // complete savings doc. N/A if none closed in range.
      const myClosed = dashCache.filter(p => norm(p.contractsManager) === norm(cm) && p.status === 'CLOSED')
      let procTotal = 0, procComplete = 0
      for (const p of myClosed) {
        try {
          const rows = (await get(`ops:procurement-savings:${p.jobNo}`)) || []
          const meaningful = rows.filter(r => (r.tenderedRate || r.tenderedTotal))
          procTotal++
          if (meaningful.length && !meaningful.some(r => !(r.buyingRate || r.buyingTotal))) procComplete++
        } catch {}
      }
      const procPct = procTotal > 0 ? procComplete / procTotal : null

      if (series.length) {
        series[series.length - 1].gpMargin = gpMargin
        series[series.length - 1].procPct = procPct
        series[series.length - 1]._gpTotals = { totalProfit: gInv - gCost, totalGrossInvoiced: gInv, totalCosts: gCost, count: gCount }
      }
      cms[cm] = { series, latest: series[series.length - 1] || {} }
    }

    // ── Operations Manager (Dori) ───────────────────────────────────────────
    const opsSeries = []
    for (const month of months) {
      const rowsIn = (formType) => missingRows.filter(r => r.formType === formType && weekToMonth(r.week) === month)
      const pctOf = (formType) => { const rr = rowsIn(formType); return pct(rr.filter(r => r.done).length, rr.length) }

      // Tasks completed on-time % — tasks with a target date whose (closed) items
      // were closed on/before target. We don't store resolvedAt, so on-time =
      // closed && not past-due; total = closed tasks with a target date, this month
      // (by createdAt as a stable month bucket).
      const monthTasks = liveTasks.filter(t => t.closeOutDate && t.createdAt && monthOf(t.createdAt) === month && t.closed)
      const tasksOnTime = monthTasks.filter(t => { const due = new Date(t.closeOutDate); due.setHours(0,0,0,0); const today = new Date(); today.setHours(0,0,0,0); return due >= today }).length
      const tasksPct = pct(tasksOnTime, monthTasks.length)

      // Risk log completed on-time % — risks resolved this month, share resolved
      // on/before the target resolution date.
      const monthRisks = risks.filter(r => r.resolvedDate && monthOf(r.resolvedDate) === month)
      const risksOnTime = monthRisks.filter(r => !r.closeOutDate || new Date(r.resolvedDate) <= new Date(r.closeOutDate)).length
      const risksPct = pct(risksOnTime, monthRisks.length)

      const toolbox = await get(`scorecard:toolbox:${month}`)
      opsSeries.push({
        month,
        sosPct: pctOf('Start on Site Checklist'),
        diaryPct: pctOf('Daily Site Diary'),
        wahPct: pctOf('Works Area Handover'),
        toolbox: toolbox === true ? 1 : (toolbox === false ? 0 : null),
        tasksPct, risksPct,
      })
    }

    return res.status(200).json({ months, cms, ops: { series: opsSeries, latest: opsSeries[opsSeries.length - 1] || {} }, cmNames })
  } catch (e) {
    console.error('ops-scorecards error:', e)
    return res.status(500).json({ error: e.message || 'Failed to compute scorecards' })
  }
}

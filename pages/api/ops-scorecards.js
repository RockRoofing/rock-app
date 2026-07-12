import { requireRole } from '../../lib/portalAuth'
import { get, getSubmissionIndex, getSubmission, getOpsProjects, getLiveTasks } from '../../lib/db'

// GET /api/ops-scorecards?month=YYYY-MM
// Computes operations scorecard metrics for the Contracts Managers (Will/Mike)
// and the Operations Manager (Dori) for the given month.
//
// Returns { month, cms:{ [cmName]: {metrics} }, ops:{metrics}, meta:{...} }.
// Toolbox-talk Yes/No is stored manually under scorecard:toolbox:{YYYY-MM}.

const monthOf = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}` }
const inMonth = (d, month) => d && monthOf(d) === month
const norm = (s) => (s || '').trim().toLowerCase()

// H&S incidence forms that count as an "incidence".
const INCIDENCE_FORM_IDS = ['accident-book', 'hs-accident-incident-report']
const INCIDENCE_TITLE_RX = /(accident book|accident and incident report|accident & incident report)/i

// Form matchers by title (submissions carry formId + formTitle).
const isStartOnSite = (s) => /start on site/i.test(s.formTitle || '')
const isDailyDiary = (s) => /daily site diary/i.test(s.formTitle || '')
const isWAH = (s) => /work area handover|works area handover/i.test(s.formTitle || '')
const isWaterIngress = (s) => (s.formId === 'water-ingress-report') || /water ingress/i.test(s.formTitle || '')
const isPSN = (s) => (s.formId === 'pre-start-notification') || /pre-?start notification/i.test(s.formTitle || '')

export default async function handler(req, res) {
  if (!requireRole(req, res, ['post-contract', 'management', 'admin'])) return

  // Manual Toolbox-talk Yes/No per month.
  if (req.method === 'POST') {
    const { month, toolbox } = req.body || {}
    if (!month) return res.status(400).json({ error: 'Missing month' })
    const { set } = await import('../../lib/db')
    await set(`scorecard:toolbox:${month}`, toolbox === true || toolbox === 'yes')
    return res.status(200).json({ ok: true })
  }

  try {
    const month = req.query.month || monthOf(new Date())

    const [projects, index, liveTasks, risks, toolbox, dashCache] = await Promise.all([
      getOpsProjects(),
      getSubmissionIndex(),
      getLiveTasks(),
      get('ops:risks').then(r => r || []),
      get(`scorecard:toolbox:${month}`),
      get('dashboard:cache').then(c => c || []),
    ])

    // Map projectNo -> Contracts Manager (from Ops project / IHM).
    const projCM = {}
    for (const p of projects) projCM[p.projectNo] = p.data?.contractsManager || ''
    // Commercial CM + stage + gpMargin come from the dashboard cache (jobNo-keyed).
    const commercialByJob = {}
    for (const p of dashCache) commercialByJob[String(p.jobNo)] = p

    // Pull the full submissions we need (incidence, WI, PSN, SOS, diary, WAH) for this month.
    const relevant = index.filter(s =>
      INCIDENCE_FORM_IDS.includes(s.formId) || INCIDENCE_TITLE_RX.test(s.formTitle || '') ||
      isWaterIngress(s) || isPSN(s) || isStartOnSite(s) || isDailyDiary(s) || isWAH(s))
    const full = await Promise.all(relevant.map(s => getSubmission(s.id).catch(() => null)))
    const subs = full.filter(Boolean)

    // Resolve a submission's project + CM (submissions store projectName as a label
    // like "J247 — Name"; match the leading project number).
    const cmForSub = (s) => {
      const label = s.projectName || ''
      const noMatch = label.match(/([A-Za-z]?\d{2,})/)
      const no = noMatch ? noMatch[1] : label
      return projCM[no] || projCM[label] || ''
    }
    const projNoForSub = (s) => {
      const label = s.projectName || ''
      const m = label.match(/([A-Za-z]?\d{2,})/)
      return m ? m[1] : label
    }

    // ── Contracts Manager metrics (per CM name) ────────────────────────────
    const cmNames = [...new Set(projects.map(p => p.data?.contractsManager).filter(Boolean))]
    const cms = {}
    for (const cm of cmNames) {
      const mine = (s) => norm(cmForSub(s)) === norm(cm)

      // Gross margin — live + defects projects where commercial CM == this CM.
      const myCommercial = dashCache.filter(p => norm(p.contractsManager) === norm(cm) && (p.status === 'INPROGRESS' || p.status === 'DEFECTS'))
      let totalProfit = 0, totalGrossInvoiced = 0, totalCosts = 0, gpCount = 0
      for (const p of myCommercial) {
        if (p.grossInvoiced != null && p.totalCosts != null) {
          totalGrossInvoiced += p.grossInvoiced || 0
          totalCosts += p.totalCosts || 0
          gpCount++
        }
      }
      totalProfit = totalGrossInvoiced - totalCosts
      const gpMargin = totalGrossInvoiced > 0 ? totalProfit / totalGrossInvoiced : null

      // H&S incidences — accident book / accident & incident report submitted this
      // month; if both exist for the same project in the month, count once.
      const incidentProjectsThisMonth = new Set(
        subs.filter(s => mine(s) && inMonth(s.submittedAt, month) &&
          (INCIDENCE_FORM_IDS.includes(s.formId) || INCIDENCE_TITLE_RX.test(s.formTitle || '')))
          .map(s => projNoForSub(s)))
      const hsIncidences = incidentProjectsThisMonth.size

      // Water Ingress reports marked as Rock's fault (all time, this CM's projects).
      const wiRockFault = subs.filter(s => mine(s) && isWaterIngress(s) && norm(s.answers?.f_13) === 'rock').length

      // PSNs sent vs required is hard to derive precisely; report the count of PSNs
      // this CM has submitted this month (actual submitted), plus all-time.
      const psnThisMonth = subs.filter(s => mine(s) && isPSN(s) && inMonth(s.submittedAt, month)).length

      // Procurement savings incomplete on completed projects this month.
      // (Count of this CM's projects completed in the month whose procurement
      //  savings doc is not fully complete.)
      const myClosed = dashCache.filter(p => norm(p.contractsManager) === norm(cm) && p.status === 'CLOSED')
      let procIncomplete = 0
      for (const p of myClosed) {
        try {
          const rows = (await get(`ops:procurement-savings:${p.jobNo}`)) || []
          const meaningful = rows.filter(r => (r.tenderedRate || r.tenderedTotal))
          if (!meaningful.length) { procIncomplete++; continue }
          if (meaningful.some(r => !(r.buyingRate || r.buyingTotal))) procIncomplete++
        } catch {}
      }

      // Issues where the required resolution date is before the resolved date.
      // (Issues live in ops:issues; match by this CM's projects.)
      cms[cm] = {
        gpMargin, _gpTotals: { totalProfit, totalGrossInvoiced, totalCosts, count: gpCount },
        hsIncidences,
        wiRockFault,
        psnSubmitted: psnThisMonth,
        procIncomplete,
        issuesLateResolved: 0, // filled below
      }
    }

    // Issues late-resolved, per CM.
    const issues = (await get('ops:issues')) || []
    for (const cm of cmNames) {
      const late = issues.filter(i => {
        if (norm(projCM[i.projectNo]) !== norm(cm)) return false
        if (!i.requiredDate || !i.resolvedDate) return false
        return new Date(i.requiredDate) < new Date(i.resolvedDate)
      }).length
      if (cms[cm]) cms[cm].issuesLateResolved = late
    }

    // ── Operations Manager (Dori) metrics ──────────────────────────────────
    // Start on Site / Daily Diary / WAH completion % — completed this month vs a
    // simple denominator (required = completed + missing from forms-missing engine
    // is heavy; here we report completed counts and a % vs live projects active).
    const sosDone = subs.filter(s => isStartOnSite(s) && inMonth(s.submittedAt, month)).length
    const diaryDone = subs.filter(s => isDailyDiary(s) && inMonth(s.submittedAt, month)).length
    const wahDone = subs.filter(s => isWAH(s) && inMonth(s.submittedAt, month)).length

    // Tasks resolved-but-overdue: closed tasks whose closeOutDate is before the
    // date they were resolved. We don't store resolvedAt, so use: closed && past due.
    const tasksResolvedOverdue = liveTasks.filter(t => {
      if (!t.closed || !t.closeOutDate) return false
      const due = new Date(t.closeOutDate); due.setHours(0, 0, 0, 0)
      const today = new Date(); today.setHours(0, 0, 0, 0)
      return due < today
    }).length

    // Risk log items resolved after target resolution date.
    const risksLate = risks.filter(r => {
      if (!r.closeOutDate || !r.resolvedDate) return false
      return new Date(r.resolvedDate) > new Date(r.closeOutDate)
    }).length

    const ops = {
      sosDone, diaryDone, wahDone,
      toolbox: toolbox === true || toolbox === 'yes' ? 1 : (toolbox === false || toolbox === 'no' ? 0 : null),
      tasksResolvedOverdue,
      risksLate,
    }

    return res.status(200).json({ month, cms, ops, cmNames })
  } catch (e) {
    console.error('ops-scorecards error:', e)
    return res.status(500).json({ error: e.message || 'Failed to compute scorecards' })
  }
}

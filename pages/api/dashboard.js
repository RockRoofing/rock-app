import { getAllProjectSettings, getOpsProjects } from '../../lib/db'
import { computeApplicationSummary } from '../../lib/applications'
import { missingProjectFields } from '../../lib/projectComplete'
import { getProjectsFromCategories } from '../../lib/xero'
import { syncRegistry, ghostsFromRegistry } from '../../lib/projectRegistry'
import { getTokens, saveTokens } from '../../lib/db'
import { refreshXeroToken } from '../../lib/xero'

async function getRedis() {
  try {
    const { Redis } = await import('@upstash/redis')
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
    if (!url || !token) return null
    return new Redis({ url, token })
  } catch { return null }
}

// Calculate valuation date for a given month key (YYYY-MM) and valuation day
function getValuationDateForMonth(monthKey, valuationDay) {
  if (!valuationDay || !monthKey) return null
  const [year, month] = monthKey.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, parseInt(valuationDay)))
}

export default async function handler(req, res) {
  const redis = await getRedis()
  if (!redis) return res.status(500).json({ error: 'No Redis' })

  // Try cache first unless sync=true. Ignore a cache built before the completeness
  // field existed (so the "details incomplete" banner works without a manual sync).
  if (req.query.sync !== 'true') {
    try {
      const cached = await redis.get('dashboard:cache')
      if (cached && Array.isArray(cached) && cached.length > 0 && cached[0] && 'detailsMissing' in cached[0] && cached[0].completeV6 === true && 'hasContractedRates' in cached[0] && 'wipAdjustments' in cached[0] && cached[0].stageSource === 'retention' && 'appliedForLatest' in cached[0] && cached[0].cmResolved === true && cached[0].estimatorResolved === true && cached[0].qsResolved === true && 'pcType' in cached[0] && 'inXero' in cached[0] && 'retention612Released' in cached[0] && 'appRelease1' in cached[0] && 'latestAppEnd' in cached[0] && cached[0].certifiedPrevCert_v2 === true && cached[0].ret612Match_v1 === true && cached[0].appliedForSent_v1 === true && cached[0].certifiedTypedBox_v1 === true && cached[0].appsBothRecords_v1 === true && cached[0].finalAccountMcdPlacement_v1 === true && cached[0].accountBaseNetOfMcd_v1 === true) {
        // Overlay the WIP-relevant fields from LIVE settings/adjustments so a margin
        // override, manual adjustment, or valuation-date change made on the WIP page
        // is reflected immediately even while the rest of the cache is still warm.
        try {
          const liveSettings = await getAllProjectSettings()
          // Also refresh the Contracts Manager live. Editing Project Details in the
          // COMMERCIAL portal clears this cache, but editing them in the OPS portal does
          // not - so without this an Ops change to the CM would not reach Project
          // Financials until the cache expired (up to 4 hours). Resolved with the same
          // resolver Edit Project Details uses, so they always agree.
          let liveOps = [], livePortalUsers = [], resolvePeople = null
          try {
            liveOps = (await redis.get('ops:projects')) || []
            const { getPortalUsers } = await import('../../lib/db')
            livePortalUsers = await getPortalUsers()
            resolvePeople = (await import('../../lib/projectPeople')).resolveProjectPeople
          } catch {}

          const withLive = await Promise.all(cached.map(async (p) => {
            if (!p || !p.xeroId) return p
            const s = liveSettings[String(p.xeroId)] || {}
            let adj = p.wipAdjustments
            try { adj = (await redis.get(`wip:adjustments:${p.xeroId}`)) || [] } catch {}
            let cm = p.contractsManager
            if (resolvePeople) {
              try {
                const rp = resolvePeople({ jobNo: p.jobNo, opsProjects: liveOps, users: livePortalUsers, override: s.peopleOverride || {} })
                cm = rp?.team?.contractsManager?.name || cm
              } catch {}
            }
            return {
              ...p,
              contractsManager: cm,
              wipMarginOverride: (s.wipMarginOverride != null && s.wipMarginOverride !== '') ? s.wipMarginOverride : null,
              dateOverrides: s.dateOverrides || p.dateOverrides || {},
              wipAdjustments: adj,
            }
          }))
          return res.json({ projects: withLive })
        } catch {
          return res.json({ projects: cached })
        }
      }
    } catch {}
  }

  try {
    let tokens = await getTokens()
    if (!tokens) return res.status(401).json({ error: 'Not connected to Xero' })
    try {
      const newTokens = await refreshXeroToken(tokens.refresh_token)
      tokens = { ...tokens, ...newTokens }
      await saveTokens(tokens)
    } catch {}

    const categoryProjects = await getProjectsFromCategories(tokens.access_token, tokens.tenant_id)

    // PROJECT IDENTITY IS OURS, NOT XERO'S.
    //
    // This list used to BE the Xero tracking options and nothing else, so deleting
    // an option in Xero deleted the project from every commercial surface - the data
    // survived in Redis but nothing could list it. Record every project we see, then
    // carry forward anything Xero has stopped returning as a GHOST (inXero: false).
    // Its cost/invoice caches simply stop moving, which is right - there is nothing
    // left in Xero to sync against.
    let registry = {}
    try { registry = await syncRegistry(redis, categoryProjects) } catch {}
    const ghostProjects = ghostsFromRegistry(registry, categoryProjects)
    const allCategoryProjects = [
      ...categoryProjects.map(cp => ({ ...cp, inXero: true, lastSeenInXero: null })),
      ...ghostProjects,
    ]

    const allSettings = await getAllProjectSettings()

    // For resolving project people (team roles + customer contacts) from the IHM.
    let opsProjects = [], portalUsers = []
    try { opsProjects = (await redis.get('ops:projects')) || [] } catch {}
    // Lookup IHM data by project number, so people fields (CM etc.) come from the
    // IHM - the same source as Ops -> Edit Project Details - not project settings.
    const ihmByNo = {}
    for (const op of (opsProjects || [])) { if (op && op.projectNo) ihmByNo[String(op.projectNo).trim()] = op.data || {} }
    try { const { getPortalUsers } = await import('../../lib/db'); portalUsers = await getPortalUsers() } catch {}
    const { resolveProjectPeople } = await import('../../lib/projectPeople')

    // Manual retention status per project (the Retention Tracker is the source of
    // truth for live → defects → complete). Keyed by xeroId. A manual override row
    // (manual !== false) wins over a Xero-derived row for the same project.
    const retStatusByXeroId = {}
    try {
      const retEntries = (await redis.get('retention:entries')) || []
      for (const e of retEntries) {
        if (!e || !e.xeroId) continue
        const st = e.retStatus || (e.markedComplete ? 'complete' : 'live')
        const key = String(e.xeroId)
        // Prefer an explicit manual entry if one exists for this project.
        if (!(key in retStatusByXeroId) || e.manual !== false) retStatusByXeroId[key] = st
      }
    } catch {}

    const projects = await Promise.all(allCategoryProjects.map(async (cp) => {
      const id = cp.trackingOptionId
      const settings = allSettings[id] || allSettings[cp.jobNo] || {}

      // ── Read all-time cost totals from Redis ──────────────────────────────
      let labourSpend = 0, materialsSpend = 0, totalCosts = 0
      let costLines = []
      try {
        const costCache = await redis.get(`costs:latest:${id}`)
        if (costCache) {
          labourSpend = costCache.labourSpend || 0
          materialsSpend = costCache.materialsSpend || 0
          totalCosts = costCache.totalCosts || (labourSpend + materialsSpend)
        }
        const lines = await redis.get(`costs:lines:${id}`)
        if (lines) costLines = lines
      } catch {}

      // ── Read invoice lines from Redis ─────────────────────────────────────
      let totalInvoiced = 0, invoiceLines = []
      let invoicedExVat = 0, invoicedSales200 = 0, vatTotal = 0, paidTotal = 0, vatRateLabel = '—', retention612 = 0
      let retention612Deducted = 0, retention612Released = 0, retention612ReleasedPaid = 0
      let ret612Lines = 0, ret612First = ''
      const ret612Detail = []
      try {
        const invCache = await redis.get(`invoiced:latest:${id}`)
        if (invCache) {
          totalInvoiced = invCache.totalInvoiced || 0
          invoicedExVat = invCache.invoicedExVat || 0
          invoicedSales200 = invCache.invoicedSales200 || 0
          retention612 = invCache.retention612 || 0
          vatTotal = invCache.vatTotal || 0
          paidTotal = invCache.paidTotal || 0
          vatRateLabel = invCache.vatRateLabel || '—'
        }
        const lines = await redis.get(`invoiced:lines:${id}`)
        if (lines) invoiceLines = lines
      } catch {}

      // Resilient fallback: if the aggregate cache predates the VAT/paid fields,
      // derive them from the per-invoice lines (which carry total/subTotal/
      // totalTax/amountPaid). This means values appear even before a full re-sync.
      if (invoiceLines.length) {
        if (!paidTotal) paidTotal = invoiceLines.reduce((s, l) => s + (l.amountPaid || 0), 0)
        if (!vatTotal) vatTotal = invoiceLines.reduce((s, l) => s + (l.totalTax || 0), 0)
        if (!invoicedExVat) invoicedExVat = invoiceLines.reduce((s, l) => s + (l.subTotal || 0), 0)
        if (!invoicedSales200) invoicedSales200 = invoiceLines.reduce((s, l) => s + (l.sales200 || 0), 0)
        if (!retention612) retention612 = invoiceLines.reduce((s, l) => s + (l.retention612 || 0), 0)
        // SPLIT THE 612 MOVEMENT, rather than reporting one netted number.
        //
        // A deduction posts a NEGATIVE 612 line, a release posts a POSITIVE one. Summing
        // them and taking the absolute value - which is what happened until now - makes
        // 10,000 deducted with 5,000 released indistinguishable from 5,000 never
        // deducted. That single figure is the reason the register will not reconcile.
        //
        // Derived from the stored lines, so it works without waiting for a resync.
        // CANCEL A CREDIT NOTE AGAINST THE INVOICE IT REVERSES.
        //
        // A credited-and-reissued application posts its retention twice - once on the
        // original invoice and once, opposite, on the credit note. Counting both inflates
        // BOTH columns by the same amount and the account still nets to zero, so nothing
        // looks wrong until you compare against Retention Owed.
        //
        // J147: gross 1,760.38 deducted / 1,760.39 released. Cancel the 642.20 reversal
        // pair and it is 1,118.18 / 1,118.19 - against Retention Owed of 1,118.19.
        // Everything ties. That is the test that says this rule is right.
        //
        // Matched through allocatedTo, which the sync keeps from Xero's Allocations. Only
        // the overlapping amount is cancelled, so a partial credit leaves the remainder.
        // ONE KEY FOR A DOCUMENT, EVERYWHERE.
        //
        // The cancel set keyed on `xeroInvoiceId || invoiceNumber` while the offset map
        // keyed on `String(xeroInvoiceId)` alone. Where an id is null those are 'null'
        // for EVERY such line, so one cancellation could reduce an unrelated invoice.
        const lineKey = (l) => String(l.xeroInvoiceId || l.invoiceNumber || `${l.date || ''}#${l.retention612 || 0}`)

        const adj = new Map()          // document key -> amount of 612 already cancelled
        const cancelled = new Set()    // credit notes fully absorbed
        const matchNote = new Map()    // document key -> how it was paired, or why it was not

        for (const cn of invoiceLines) {
          if (!cn.creditNote || !(cn.retention612 || 0)) continue
          const cnKey = lineKey(cn)

          // TWO WAYS TO FIND THE INVOICE A CREDIT NOTE REVERSES, AND BOTH ALWAYS RUN.
          //
          // Xero's own allocation is the better evidence, so it is tried first. But an
          // allocation can resolve to a document that CANNOT be the reversal - one with
          // no 612 line of its own, or a 612 line the same way up as the credit note.
          // Until now a resolved-but-unusable allocation suppressed the reference
          // fallback entirely (`byAlloc.length ? [] : ...`), so the pair was left
          // uncancelled and both columns stayed inflated by the same amount.
          //
          // J147 is exactly that: the App 2 note carries one allocation, it points at a
          // document that is not the invoice it reverses, and the reference match that
          // would have paired it never got the chance to run.
          const byAlloc = (cn.allocatedTo || [])
            .map(id => invoiceLines.find(l => !l.creditNote && l.xeroInvoiceId && String(l.xeroInvoiceId) === String(id)))
            .filter(Boolean)
          // Same reference and an exact equal-and-opposite 612 amount. A credit note
          // reversing an application carries that application's reference, and an exact
          // opposite to the penny is not a coincidence.
          const byRef = invoiceLines.filter(l => !l.creditNote
            && (l.retention612 || 0)
            && String(l.reference || '').trim().toLowerCase() === String(cn.reference || '').trim().toLowerCase()
            && Math.abs((l.retention612 || 0) + (cn.retention612 || 0)) < 0.01)

          const allocKeys = new Set(byAlloc.map(lineKey))
          const seen = new Set()
          const candidates = [...byAlloc, ...byRef].filter(l => {
            const k = lineKey(l)
            if (seen.has(k)) return false
            seen.add(k)
            return true
          })

          let why = candidates.length ? '' : 'no candidate found'
          for (const inv of candidates) {
            const invKey = lineKey(inv)
            const via = allocKeys.has(invKey) ? 'alloc' : 'ref'
            if (!(inv.retention612 || 0)) { why = why || `${via}: candidate carries no 612 line`; continue }
            // Opposite signs only - a credit note reinforcing a deduction is not a reversal.
            if (Math.sign(inv.retention612) === Math.sign(cn.retention612)) { why = why || `${via}: candidate 612 same sign`; continue }
            const already = adj.get(invKey) || 0
            const room = Math.abs(inv.retention612) - already
            const take = Math.min(room, Math.abs(cn.retention612))
            if (take <= 0) { why = why || `${via}: candidate already fully cancelled`; continue }
            adj.set(invKey, already + take)
            cancelled.add(cnKey)
            matchNote.set(invKey, `reversed by ${cn.reference || cn.invoiceNumber || 'credit note'}`)
            why = `${via} -> ${inv.reference || inv.invoiceNumber || inv.date || 'invoice'}`
            break
          }
          matchNote.set(cnKey, why)
        }

        for (const l of invoiceLines) {
          const key = lineKey(l)
          let v = l.retention612 || 0
          // A fully cancelled credit note contributes nothing, and the invoice it
          // reversed is reduced by the same amount.
          if (l.creditNote && cancelled.has(key)) v = 0
          else if (!l.creditNote && adj.has(key)) {
            const off = adj.get(key)
            v = v > 0 ? Math.max(0, v - off) : Math.min(0, v + off)
          }
          if (v < 0) retention612Deducted += -v
          else if (v > 0) retention612Released += v
          // WHAT THIS PROJECT ACTUALLY HOLDS, line by line.
          //
          // Four attempts at this have been made by inferring from totals. This carries
          // the working so it can be read against Xero directly - the raw amount, what
          // the netting did to it, and which column it ended in.
          ret612Detail.push({
            date: l.date || '', ref: l.reference || l.invoiceNumber || '',
            creditNote: !!l.creditNote,
            raw: Math.round((l.retention612 || 0) * 100) / 100,
            used: Math.round(v * 100) / 100,
            netted: Math.abs((l.retention612 || 0) - v) > 0.005,
            allocs: (l.allocatedTo || []).length,
            side: v < 0 ? 'deducted' : v > 0 ? 'released' : '-',
            // ALWAYS-ON WORKING. A diagnostic that only renders on failure cannot tell
            // 'nothing wrong' from 'not running', so every line carries how it paired.
            match: matchNote.get(key) || '',
          })
          if (v !== 0) {
            ret612Lines += 1
            if (!ret612First || (l.date && l.date < ret612First)) ret612First = l.date || ret612First
            // A release only counts as RECEIVED once the invoice carrying it is paid.
            // Until then it has left retention and become an ordinary debtor.
            if (v > 0 && (l.amountDue || 0) <= 0.01) retention612ReleasedPaid += v
          }
        }
        if (!totalInvoiced) totalInvoiced = invoiceLines.reduce((s, l) => s + (l.total || 0), 0)
        if (vatRateLabel === '—') {
          const labels = [...new Set(invoiceLines.map(l => l.vatLabel).filter(x => x && x !== '—'))]
          if (labels.length === 1) vatRateLabel = labels[0]
          else if (labels.length > 1) vatRateLabel = 'Mixed'
          else {
            const net = invoicedExVat, tax = vatTotal
            if (net > 0 && tax > 0) vatRateLabel = `${Math.round((tax / net) * 100)}%`
            else if (net > 0 && tax === 0) vatRateLabel = '0%'
          }
        }
      }

      // Last invoice date
      const lastInvoiceDate = invoiceLines.length > 0
        ? invoiceLines.reduce((latest, inv) => inv.date > latest ? inv.date : latest, invoiceLines[0].date)
        : null

      // Payment status
      const allPaid = invoiceLines.length > 0 && invoiceLines.every(inv => (inv.amountDue || 0) === 0)
      const amountOutstanding = invoiceLines.reduce((s, inv) => s + (inv.amountDue || 0), 0)

      // ── Latest application "applied for" (gross) ──────────────────────────
      // The retention register's "Applied for" auto-populates from the newest
      // application on this project (by sequence). Gross = the application total
      // before MCD/retention deductions.
      let appliedForLatest = 0
      let latestAppEnd = ''
      let retentionClaimed = 0
      let appRelease1 = false, appRelease2 = false
      // FINAL ACCOUNT FROM THE APPLICATION.
      //
      // The application is the better source: it holds the measured contract sum and the
      // variations at FINAL value, which is what the final account actually is. Project
      // details only holds the original contract value plus whatever variations happen to
      // have been ticked as instructed.
      //
      // Null when there are no applications - the caller then falls back to project
      // details. Zero would be indistinguishable from a real zero.
      let certifiedGross = 0, certifiedFromApp = ''
      let certifiedSetOnApp = false
      let appliedForDetail = null
      let afaFromApplication = null
      let finalAccountFromApplication = null
      let mcdOnVarsApp = null, mcdOnMosApp = null
      let afaSource = 'project details'
      try {
        // APPLICATIONS LIVE ON EITHER SETTINGS RECORD, AND WE MUST READ BOTH.
        //
        // Project settings are keyed by tracking option id OR by job number, and two
        // records can exist for one project. `settings` above resolves to whichever
        // matched FIRST, so applications written against the job-number record are
        // invisible whenever an id record also exists.
        //
        // That is the same fault as "V01 and V02 are not showing", which was fixed for
        // variations lower down this file and never for applications. It explains why
        // Certified was blank, why Applied for fell back to a typed value, and why the
        // Final Account came from project details instead of the application - all on
        // SOME projects only, which is exactly the pattern reported.
        //
        // Nothing was lost. We were reading the wrong record.
        const apps = (() => {
          const byId = Array.isArray(allSettings[id]?.applications) ? allSettings[id].applications : []
          const byJob = Array.isArray(allSettings[cp.jobNo]?.applications) ? allSettings[cp.jobNo].applications : []
          if (!byJob.length) return byId.slice()
          if (!byId.length) return byJob.slice()
          // Both hold applications: merge so neither is dropped. Keyed on the permanent
          // appNumber where there is one, otherwise seq, otherwise id.
          const seen = new Map()
          for (const a of [...byJob, ...byId]) {
            if (!a) continue
            const k = String(a.appNumber != null ? `n${a.appNumber}` : (a.seq != null ? `s${a.seq}` : `i${a.id}`))
            const prev = seen.get(k)
            // A SENT application beats a draft of the same number - it is the one that
            // went to the customer.
            const better = !prev
              || (a.status === 'sent' && prev.status !== 'sent')
              || (a.status === prev.status && (a.contractWorks || []).length > (prev.contractWorks || []).length)
            if (better) seen.set(k, a)
          }
          return [...seen.values()]
        })()
        if (apps.length) {
          apps.sort((a, b) => (a.seq || 0) - (b.seq || 0))
          const latest = apps[apps.length - 1]
          // A missing status counts as draft, which is how application-send.js and
          // applications.js both treat it.
          const sentApps = apps.filter(a => a && a.status === 'sent')
          const latestSent = sentApps.length ? sentApps[sentApps.length - 1] : null

          // ONE RULE FOR PREVIOUSLY-CERTIFIED, USED BY EVERY CONSUMER.
          //
          // The application's OWN stored prevCertGross first - that is what the
          // certificate prints and what somebody typed where a job was part-certified
          // before it came into the app. Only where it is absent do we recompute from
          // the preceding application. This was written twice with two different rules;
          // now it is written once.
          const prevGrossFor = (app) => {
            if (!app) return 0
            if (app.prevCertGross != null) return Number(app.prevCertGross) || 0
            let g = 0
            for (const a of apps) { if ((a.seq || 0) < (app.seq || 0)) g = computeApplicationSummary(a, 0).grossCurrent || 0 }
            return g
          }

          const sum = computeApplicationSummary(latest, prevGrossFor(latest))
          const sentSum = latestSent ? computeApplicationSummary(latestSent, prevGrossFor(latestSent)) : null
          // APPLIED FOR = GROSS, LESS MCD, INCLUDING RETENTION.
          //
          // This read grossCurrent, which is the account BEFORE main contractor's
          // discount. Retention is not charged on that - it is charged on the sub-total
          // after MCD - so the Applied for column was overstated by the discount and the
          // retention calculated from it was overstated by the same proportion.
          //
          // netBeforeRet is exactly the right figure: MCD taken off whatever it applies
          // to, retention still inside it. It is the number the certificate itself shows
          // on the line above the retention deduction, so the tracker and the application
          // now agree.
          // APPLIED FOR COMES FROM THE LATEST *SENT* APPLICATION.
          //
          // It read `latest` - the latest application of ANY status - so a draft that
          // somebody had started but never issued silently superseded the sent one, and
          // the tracker showed a figure that appears on no certificate. That is the
          // "Applied for does not match on some rows" case: it only shows up on projects
          // where a draft exists, which is why it looked intermittent.
          //
          // The column tooltip has claimed "the sent application wins" since pkg792.
          // The code did not do it. Certified was already sent-only, so the two columns
          // were being sourced from two different applications.
          appliedForLatest = sentSum ? ((sentSum.current && sentSum.current.netBeforeRet) || 0) : 0
          // The PERIOD END of the latest application. The 13-week cash flow uses this to
          // drop project forecasts for periods already applied for - that money is now a
          // real invoice, and counting the forecast as well double-counts it.
          latestAppEnd = latest.periodTo || latest.valDate || latest.appDate
            || (latest.monthKey ? `${latest.monthKey}-28` : '')
          // Retention CLAIMED BACK on applications - the halves ticked in the Retention
          // section. Deliberately NOT called retentionReleased: that name is already used
          // further down for something different, retention DUE by date (PC + defects
          // passed). Due and claimed are not the same thing, and conflating them would
          // have quietly written one over the other.
          retentionClaimed = sum.releasedTotal || 0
          // WHICH HALF was released on an application, so the Retention Tracker can mark
          // itself off automatically for projects run through the app. Cumulative - the
          // flag is carried forward from earlier applications, so the latest one holds
          // the whole picture.
          appRelease1 = !!(sum.release1Value > 0)
          appRelease2 = !!(sum.release2Value > 0)
          // GROSS AFA COMES FROM THE LATEST *SENT* APPLICATION.
          //
          // This read the latest application of any status, so a draft that had been
          // started but not issued could set the Gross AFA - and with it the Final
          // Account and the retention calculated on it. A draft is a working document;
          // it is not a figure that has been put to the customer.
          //
          if (latestSent && sentSum) {
            // CERTIFIED = THE "PREVIOUSLY CERTIFIED (GROSS)" BOX ON THE LATEST SENT
            // APPLICATION. The typed figure, nothing derived.
            //
            // That box is prevCertGross, written by pages/applications.js as a number
            // when it is filled in and null when it is not (0 on a first application,
            // where nothing has been certified before).
            //
            // Deliberately NO fallback to recomputing it from the preceding application.
            // The certificate does fall back, but here a blank means "nobody has entered
            // it", which is a thing worth seeing and can be fixed by typing it into the
            // cell. Silently substituting a computed number hides that.
            certifiedGross = latestSent.prevCertGross != null ? (Number(latestSent.prevCertGross) || 0) : 0
            // Whether the box is SET, as distinct from set to zero. A first application
            // legitimately carries 0 and should show as 0.00, not fall through to a
            // value typed on the tracker row.
            certifiedSetOnApp = latestSent.prevCertGross != null
            certifiedFromApp = latestSent.appNumber || latestSent.seq || ''
            const afaApp = sentSum.anticipatedFinalAccount
            if (afaApp != null && isFinite(afaApp) && afaApp > 0) {
              afaFromApplication = afaApp
              // THE FINAL ACCOUNT AFTER MCD, taken from the application rather than
              // recomputed. The application knows where MCD applies; the register was
              // taking it off the whole account, which overstates the discount on any
              // project where MCD excludes variations or materials.
              finalAccountFromApplication = (sentSum.finalSubTotal != null && isFinite(sentSum.finalSubTotal))
                ? sentSum.finalSubTotal : null
              mcdOnVarsApp = sentSum.mcdOnVars
              mcdOnMosApp = sentSum.mcdOnMos
              afaSource = `application ${latestSent.appNumber || latestSent.seq || ''} (sent)`.trim()
            }
          }

          // ALWAYS-ON WORKING FOR THE APPLIED-FOR AND CERTIFIED COLUMNS.
          //
          // Four attempts at the 612 figures were made by inference and all four failed.
          // The pattern that worked was showing the stored values. Same shape here: every
          // candidate figure for this project, so a wrong number can be read rather than
          // guessed at. Carried whether or not anything looks wrong.
          const r2 = (n) => (n == null || !isFinite(n)) ? null : Math.round(n * 100) / 100
          appliedForDetail = {
            appCount: apps.length,
            sentCount: sentApps.length,
            latestApp: String(latest.appNumber || latest.seq || ''),
            latestStatus: String(latest.status || 'draft'),
            sentApp: latestSent ? String(latestSent.appNumber || latestSent.seq || '') : '',
            draftSupersedes: !!(latestSent && latest !== latestSent),
            // From the SENT application - what the columns now use.
            sentNetBeforeRet: sentSum ? r2(sentSum.current && sentSum.current.netBeforeRet) : null,
            sentGross: sentSum ? r2(sentSum.current && sentSum.current.gross) : null,
            sentPrevGross: sentSum ? r2(sentSum.previously && sentSum.previously.gross) : null,
            // The typed previously-certified on the application, if there is one.
            prevCertTyped: (latestSent && latestSent.prevCertGross != null) ? r2(Number(latestSent.prevCertGross)) : null,
            // What the certificate would fall back to where the box is empty. Shown for
            // information only - the column does not use it.
            prevCertComputed: latestSent ? r2(prevGrossFor({ ...latestSent, prevCertGross: null })) : null,
            // What the LATEST application of any status would have given - the old
            // behaviour, kept so a changed figure can be explained.
            anyNetBeforeRet: r2(sum.current && sum.current.netBeforeRet),
          }
        }
      } catch {}

      // Resolved BEFORE the AFA block, which needs mcdPct from it. It used to sit lower
      // down; reading it above its own declaration is a ReferenceError, not undefined,
      // and would have taken the whole dashboard out.
      const resolvedPeople = resolveProjectPeople({
        jobNo: cp.jobNo,
        opsProjects,
        users: portalUsers,
        override: settings.peopleOverride || {},
      })

      // ── Contract / AFA ────────────────────────────────────────────────────
      const contractValue = parseFloat(settings.contractValue || 0)
      const instructedVars = (settings.variations || [])
        .filter(v => v.instructed)
        .reduce((s, v) => s + (parseFloat(v.materials || 0) + parseFloat(v.labour || 0) + parseFloat(v.profit || 0)), 0)
      // ORDER OF PREFERENCE: latest SENT application -> manual override -> project details.
      //
      // The override used to win over everything, so a figure typed once could sit on top
      // of a real issued application indefinitely and nothing downstream would move when
      // the application changed. A sent application is a figure that has gone to the
      // customer; nothing typed in settings should quietly contradict it.
      //
      // The override is kept as a fallback for projects with no sent application - which
      // is the case it was added for - and the row still says when one is in use.
      const afaFromSettings = contractValue + instructedVars
      const hasOverride = settings.afaOverride != null && isFinite(settings.afaOverride)
      let afaBeforeMcd
      if (afaFromApplication != null) {
        afaBeforeMcd = afaFromApplication
        // afaSource already names the application
      } else if (hasOverride) {
        afaBeforeMcd = Number(settings.afaOverride)
        afaSource = 'manual override'
      } else {
        afaBeforeMcd = afaFromSettings
        afaSource = 'project details'
      }
      // Flagged so a stale override sitting behind a sent application is visible rather
      // than silently ignored.
      const afaOverrideIgnored = hasOverride && afaFromApplication != null
      const grossAfa = afaBeforeMcd

      // MCD, DEDUCTED FROM THE FINAL ACCOUNT.
      //
      // Every application computes  gross -> minus MCD -> subTotal -> retention on the
      // SUBTOTAL. So the figure retention is applied to is net of MCD, and the Final
      // Account on the retention register has to be the same or the whole register is
      // overstated - Account Remaining, Total Due and the final-account balance all read
      // high by the value of the discount.
      //
      // NOT applied to the whole account. MCD comes off only what Edit Project Details
      // says it comes off - see the placement block below. The old comment here claimed
      // the applications charge MCD on measured + variations + materials, which is only
      // true when both placement flags are on.
      // DEFAULTS TO 0, deliberately.
      //
      // Nothing recorded means no discount, not "unknown". So the Final Account equals
      // the gross, nothing is deducted, and no project is ever flagged incomplete for
      // it - which is what you asked for.
      //
      // The trade-off, stated plainly: a project where somebody simply forgot to ask is
      // indistinguishable from one with genuinely no discount. Both read 0%. The
      // register no longer nags, and it also cannot tell you which is which.
      const mcdRaw = (settings.mcdPct != null && settings.mcdPct !== '' && isFinite(parseFloat(settings.mcdPct)))
        ? parseFloat(settings.mcdPct)
        : (resolvedPeople?.mcdPct != null ? resolvedPeople.mcdPct : null)
      const mcdPct = mcdRaw != null ? mcdRaw : 0
      const mcdRecorded = mcdRaw != null          // whether anyone actually set it
      // FINAL ACCOUNT = GROSS AFA LESS MCD, WITH MCD WHERE PROJECT DETAILS PUTS IT.
      //
      // This read `afaBeforeMcd * mcdPct`, taking the discount off the WHOLE account
      // including variations and materials. That is only correct where MCD applies to
      // everything. Where Edit Project Details says MCD comes off measured works only,
      // it overstated the discount and understated the Final Account - and with it
      // Account Remaining, Total Due and the retention charged on the account.
      //
      // Preference, matching Gross AFA: the sent APPLICATION first. It has already done
      // this arithmetic on its own basis, so taking its figure means the register and
      // the certificate cannot drift. Only where there is no application do we compute
      // it here, and then we use the placement flags from project details.
      const mcdOnVarsSet = settings.mcdOnVariations === true
      const mcdOnMosSet = settings.mcdOnMaterials === true
      let afa, mcdValue, mcdBasis
      if (finalAccountFromApplication != null) {
        afa = finalAccountFromApplication
        mcdValue = afaBeforeMcd - afa
        mcdBasis = `application (MCD on ${mcdOnVarsApp ? 'variations' : 'measured only'}${mcdOnMosApp ? ' + materials' : ''})`
      } else {
        // No application. Split the account the same way the certificate would.
        const varsPart = instructedVars
        const basePart = Math.max(0, afaBeforeMcd - varsPart)
        const mcdBase = basePart + (mcdOnVarsSet ? varsPart : 0)
        const afterPart = mcdOnVarsSet ? 0 : varsPart
        mcdValue = mcdBase * (mcdPct / 100)
        afa = (mcdBase - mcdValue) + afterPart
        mcdBasis = `project details (MCD on ${mcdOnVarsSet ? 'measured + variations' : 'measured only'})`
      }

      // ── Invoiced value & retention ────────────────────────────────────────
      // invoicedSales200 = sum of account-code-200 (Sales) lines: NET of VAT and
      // INCLUDING retention (retention is moved to a separate 612 line, so it's
      // already part of the 200 total). This is the accurate "invoiced" figure.
      // Fall back to the older ex-VAT+retention reconstruction only if 200 data
      // isn't present yet (pre-resync).
      const retPct = parseFloat(settings.retentionPct || 0)
      // Net value EXCLUDING retention (what's on the invoices' SubTotal after the
      // 612 deduction) — used to derive retention amounts for display.
      const netExRetention = invoicedSales200 > 0 ? invoicedSales200 * (1 - retPct) : invoicedExVat
      // RETENTION IS HELD ON WHAT HAS BEEN APPLIED FOR, NOT WHAT HAS BEEN INVOICED.
      //
      // This read invoicedSales200 - Xero sales - so retention on a certified application
      // did not exist until the invoice was raised. On a job applying monthly that left a
      // month of retention missing from the register every month, and understated the
      // total by whatever was sitting between application and invoice.
      //
      // The customer holds it from the moment they certify. Applied for is the right base.
      // Falls back to the invoiced figure where there are no applications - a legacy or
      // tracker-only project still needs a number.
      const retentionBase = appliedForLatest > 0
        ? appliedForLatest
        : (invoicedSales200 > 0 ? invoicedSales200 : (retPct > 0 ? invoicedExVat / (1 - retPct) : 0))
      const totalRetention = retentionBase * retPct

      // RETENTION ON THE FINAL ACCOUNT, and each contractual half.
      //
      // Separate from totalRetention, which is retention ACCRUED on what has been applied
      // for so far. The two answer different questions and the register needs both.
      //
      // A release is contractual: half the pot at practical completion, half at the end
      // of defects, both measured against the final account. A half falling due at 70%
      // applied for is still half of the WHOLE retention - which is what the application
      // certificate releases, and the tracker was showing half of retention-to-date
      // instead. On a 580k account at 5% MCD and 3% retention that was 6,227 a half
      // against the 8,265 the application actually claims.
      //
      // `afa` here is Gross AFA less MCD - the Final Account column on the register, and
      // the same base retention is charged on everywhere else.
      const retentionOnFinalAccount = afa * retPct
      const retentionHalf = retentionOnFinalAccount / 2
      const retentionBasis = appliedForLatest > 0 ? 'applied for' : 'invoiced'
      const now = new Date()
      const pc1 = settings.pcDate ? new Date(settings.pcDate) : null
      const pc2 = settings.defectsDate ? new Date(settings.defectsDate) : null
      const retentionReleased = (pc1 && pc1 <= now ? totalRetention / 2 : 0) + (pc2 && pc2 <= now ? totalRetention / 2 : 0)
      const retentionOutstanding = totalRetention - retentionReleased
      // Gross Invoiced = net-of-VAT invoiced value INCLUDING retention. When we
      // have the 200 total that's exactly it; otherwise reconstruct.
      const grossInvoiced = invoicedSales200 > 0 ? invoicedSales200 : (invoicedExVat + retentionOutstanding)
      const currentMargin = grossInvoiced > 0 ? (grossInvoiced - totalCosts) / grossInvoiced : null

      // ── WIP ───────────────────────────────────────────────────────────────
      let wip = 0, wipMarginOverride = (settings.wipMarginOverride != null && settings.wipMarginOverride !== '') ? settings.wipMarginOverride : null
      try {
        const wipCache = await redis.get(`wip:latest:${id}`)
        if (wipCache) wip = wipCache.wip || 0
      } catch {}
      // Per-project manual WIP adjustments (so the dashboard/EOM WIP can match the
      // WIP page exactly, incl. this-month adjustments).
      let wipAdjustments = []
      try { wipAdjustments = (await redis.get(`wip:adjustments:${id}`)) || [] } catch {}

      // Remaining to claim = AFA − what's already accounted for (invoiced + WIP,
      // where WIP is work done but not yet invoiced). Never below 0.
      const remainingToClaim = Math.max(0, afa - grossInvoiced - wip)

      // ── Budgets (inc. instructed variations) ─────────────────────────────
      const labourBudget = parseFloat(settings.labourBudget || 0) +
        (settings.variations || []).filter(v => v.instructed).reduce((s, v) => s + parseFloat(v.labour || 0), 0)
      const materialsBudget = parseFloat(settings.materialsBudget || 0) +
        (settings.variations || []).filter(v => v.instructed).reduce((s, v) => s + parseFloat(v.materials || 0), 0)
      const totalBudget = labourBudget + materialsBudget

      // ── Comment ───────────────────────────────────────────────────────────
      let comment = ''
      try {
        const c = await redis.get(`comment:${id}`)
        if (c) comment = c
      } catch {}

      // ── Project stage ─────────────────────────────────────────────────────
      // The RETENTION TRACKER is the single source of truth for a project's
      // live → defects → complete movement. We map its manual retStatus onto the
      // Project Financials stage. No automatic date/financial-based movement.
      //   retStatus 'live'|undefined -> INPROGRESS
      //   retStatus 'defects'        -> DEFECTS
      //   retStatus 'complete'       -> CLOSED
      const rs = retStatusByXeroId[String(id)]
      let stage = 'INPROGRESS'
      if (rs === 'complete') stage = 'CLOSED'
      else if (rs === 'defects') stage = 'DEFECTS'

      return {
        xeroId: id,
        trackingOptionId: id,
        trackingCategoryId: cp.trackingCategoryId,
        jobNo: cp.jobNo,
        name: cp.name,
        // Still in the Xero tracking category, or carried forward from our own
        // register because the option was deleted there. A ghost keeps all of its
        // applications, contracted rates, variations, retention and financials -
        // its Xero-derived costs and invoices are simply frozen at the last sync.
        inXero: cp.inXero !== false,
        lastSeenInXero: cp.lastSeenInXero || null,
        status: stage,
        stageSource: 'retention',   // marker: stage now driven by Retention Tracker
        // Customer, PC type and the QS email all exist in Edit Project Details but were
        // never returned here, so the retention register showed them blank or fell back
        // to something else.
        //
        // Customer prefers the RESOLVED company name - override -> IHM -> nothing - and
        // only falls back to the free-text customerName typed on the commercial side.
        // The two disagreed on any project where the IHM had the proper company name and
        // somebody had typed a shorthand into Commercial.
        customer: resolvedPeople?.customerCompany || settings.customerName || '',
        pcType: settings.pcType || '',
        qsEmailSetting: settings.qsEmail || '',
        // Use the SAME resolver Edit Project Details uses, so the two always agree:
        //   commercial override -> Ops/IHM -> blank.
        // Previously this read ihmByNo directly, which (a) ignored a commercial override
        // entirely, so an overridden CM showed here as the Ops value, and (b) matched the
        // job number by exact string, where the resolver matches tolerantly ("J203"/"203").
        contractsManager: resolvedPeople?.team?.contractsManager?.name
          || (ihmByNo[String(cp.jobNo).trim()]?.contractsManager) || settings.contractsManager || '',
        // Cache-validity markers: force one rebuild so old snapshots do not keep serving
        // the pre-resolver values. Without a NEW marker the estimator fix would sit in the
        // code doing nothing, because the cached snapshot already satisfies every existing
        // condition above.
        cmResolved: true,
        estimatorResolved: true,
        qsResolved: true,
        appliedForLatest,
        certifiedGross,
        certifiedSetOnApp,
        certifiedFromApp,
        appliedForDetail,
        mcdBasis,
        finalAccountFromApplication,
        // Whether BOTH account columns came from a sent application. The tracker uses
        // this to stop a typed value overriding one.
        afaFromApp: afaFromApplication != null,
        latestAppEnd,
        retentionClaimed,
        appRelease1,
        appRelease2,
        // Same fix as contractsManager above, which was done and this was not.
        // It read settings.estimator only - a legacy flat field almost nothing writes
        // any more. Edit Project Details writes to peopleOverride.estimator and falls
        // back to the IHM, so the two disagreed: the name was on the project details
        // screen and blank on Project Financials.
        estimator: resolvedPeople?.team?.estimator?.name || settings.estimator || '',
        // Same fix again, third time. QS was left on the legacy flat settings.qsName,
        // which almost nothing writes any more - Edit Project Details writes to
        // peopleOverride.quantitySurveyor and falls back to the IHM. So qsName came
        // back blank on most projects, and the Retention Tracker then fell back to the
        // ESTIMATOR, showing the wrong person in the QS column.
        qsName: resolvedPeople?.team?.quantitySurveyor?.name || settings.qsName || '',
        // The sub-contract / order reference, resolved from the handover the same way
        // Outstanding Invoices resolves it for [Sub-Contract Ref]. It was never on the
        // project record under that name, which is why the Variation Builder found
        // nothing to pull through.
        orderRef: resolvedPeople?.orderRef || settings.orderRef || settings.customerOrderRef || '',
        // The customer's own people, from the handover. Needed by the Variation Builder
        // so "Requested by" offers who actually asked, rather than only the company.
        customerContacts: Array.isArray(resolvedPeople?.customerContacts)
          ? resolvedPeople.customerContacts.map(c => ({ name: c.name || '', title: c.title || '', email: c.email || '' })).filter(c => c.name)
          : [],
        // Must follow the NAME above. Falling back to settings.qsEmail whenever the
        // resolver has a QS would pair the shown name with a different person's
        // address - the legacy flat pair is only used when the resolver has nobody.
        qsEmail: resolvedPeople?.team?.quantitySurveyor?.name
          ? (resolvedPeople.team.quantitySurveyor.email || '')
          : (settings.qsEmail || ''),
        customerEmail: settings.customerEmail || '',
        customerContact: settings.customerContact || '',
        people: resolvedPeople,
        highRisk: settings.highRiskCustomer === true,
        pcDate: settings.pcDate || '',
        defectsDate: settings.defectsDate || '',
        completionDate: settings.completionDate || settings.pcDate || '',
        retentionComments: settings.retentionComments || '',
        // BOTH COPIES, fuller one wins.
        //
        // This sent settings.variations only. Variations have historically been written
        // to two places - settings.variations and project.variations - so where the
        // settings copy was overwritten, the client received the short list and the
        // originals looked lost while sitting intact on the project record.
        //
        // Resolved here rather than on the client, because the client never receives the
        // second copy to compare against.
        // BOTH RECORDS, fuller list wins.
        //
        // Project settings are looked up by tracking option id OR by job number:
        //   allSettings[id] || allSettings[cp.jobNo]
        //
        // Two records can therefore exist for one project, and this returned whichever
        // matched FIRST. A variation written against the job-number record is invisible
        // if an id record also exists - which is what "V01 and V02 are not showing" is.
        //
        // Nothing was lost. It was reading the wrong one.
        variations: (() => {
          const byId = Array.isArray(allSettings[id]?.variations) ? allSettings[id].variations : []
          const byJob = Array.isArray(allSettings[cp.jobNo]?.variations) ? allSettings[cp.jobNo].variations : []
          if (!byJob.length) return byId
          if (!byId.length) return byJob
          // Both hold rows: merge on variation number so neither is dropped.
          const seen = new Map()
          for (const v of [...byJob, ...byId]) {
            const k = String(v.varNumber || '').trim().toUpperCase() || Math.random()
            const prev = seen.get(k)
            // Prefer the richer record - one built in the builder carries its workings.
            if (!prev || (!prev.builder && v.builder)) seen.set(k, v)
          }
          return [...seen.values()].sort((a, b) =>
            String(a.varNumber || '').localeCompare(String(b.varNumber || ''), undefined, { numeric: true }))
        })(),
        applicationDay: settings.applicationDay || null,
        paymentDay: settings.paymentDay || null,
        dateOverrides: settings.dateOverrides || {},
        valuationDay: settings.valuationDay || null,
        contractValue,
        afa,
        afaGross: afaBeforeMcd,
        retentionOnFinalAccount,
        retentionHalf,
        afaSource,
        afaOverrideIgnored,
        mcdPct,
        mcdRecorded,
        mcdValue,
        // All-time figures
        totalInvoiced,
        invoicedExVat,
        invoicedSales200,
        vat: vatTotal,
        paid: paidTotal,
        vatRateLabel,
        remainingToClaim,
        totalCosts,
        labourSpend,
        materialsSpend,
        totalBudget,
        labourBudget,
        materialsBudget,
        retentionOutstanding,
        totalRetention,
        retentionBasis,
        // Kept for anything still reading it: retention still HELD per Xero, i.e.
        // deducted less released. Was Math.abs(retention612), which read a net credit as
        // if it were retention held.
        retention612Allocated: Math.max(0, retention612Deducted - retention612Released),
        retention612Deducted,
        retention612Released,
        retention612ReleasedPaid,
        // How much 612 activity was actually found, and how far back it goes. Historic
        // releases were often posted as a plain sales invoice with no 612 line at all, so
        // a zero here means "no evidence", NOT "nothing released".
        ret612Lines,
        ret612Detail: ret612Detail.slice(0, 60),
        ret612From: ret612First || '',
        grossInvoiced,
        currentMargin,
        wip,
        wipMarginOverride,
        wipAdjustments,
        allPaid,
        amountOutstanding,
        lastInvoiceDate,
        retentionPct: parseFloat(settings.retentionPct || 0),
        hasContractedRates: !!(settings.contractedRates && Array.isArray(settings.contractedRates.items) && settings.contractedRates.items.length > 0),
        contractedRatesLocked: !!(settings.contractedRates && settings.contractedRates.locked),
        retStatus: rs || 'live',
        // Edit-details completeness (for the "project details not complete" banner).
        // Use the effective retention (settings, else derived) but PRESERVE a real 0.
        detailsMissing: missingProjectFields({
          ...settings,
          retentionPct: (settings.retentionPct != null && settings.retentionPct !== '' && !isNaN(parseFloat(settings.retentionPct)))
            ? parseFloat(settings.retentionPct)
            : (retPct != null && !isNaN(retPct) ? retPct : ''),
        }, resolvedPeople),
        completeV6: true,
        // Bumped when Applied for moved from gross to net-of-MCD. Without a new marker a
        // cache written by the old code keeps serving the old figures for four hours,
        // and the fix looks like it did not deploy.
        appliedForNetOfMcd: true,
        // Bumped again: the release halves moved to the final-account basis.
        retentionHalfOnFinal: true,
        // Bumped again: 612 now nets credit note reversals.
        ret612Netted: true,
        ret612NettedV2: true,
        ret612Detail_v1: true,
        certifiedGross_v1: true,
        certifiedPrevCert_v2: true,
        appliedForSent_v1: true,
        certifiedTypedBox_v1: true,
        appsBothRecords_v1: true,
        finalAccountMcdPlacement_v1: true,
        accountBaseNetOfMcd_v1: true,
        ret612Match_v1: true,
        pcDateTBC: !!settings.pcDateTBC,
        defectsDateTBC: !!settings.defectsDateTBC,
        comment,
        // Raw lines for EOM calculations on the frontend
        _costLines: costLines,
        _invoiceLines: invoiceLines,
      }
    }))

    // Append a pseudo-project holding invoices that had no Projects tag in Xero,
    // so they surface (e.g. in Outstanding Invoices) rather than disappearing.
    try {
      const unLines = await redis.get('invoiced:lines:__UNASSIGNED__')
      if (Array.isArray(unLines) && unLines.length) {
        const totalInvoiced = unLines.reduce((s, l) => s + (l.total || 0), 0)
        const paidTotal = unLines.reduce((s, l) => s + (l.amountPaid || 0), 0)
        const dueTotal = unLines.reduce((s, l) => s + (l.amountDue || 0), 0)
        projects.push({
          id: '__UNASSIGNED__',
          jobNo: '',
          name: 'Unassigned (no project tag in Xero)',
          projectName: 'Unassigned (no project tag in Xero)',
          unassigned: true,
          totalInvoiced,
          allPaid: paidTotal,
          amountOutstanding: dueTotal,
          _costLines: [],
          _invoiceLines: unLines,
        })
      }
    } catch {}

    await redis.set('dashboard:cache', projects, { ex: 60 * 60 * 4 })
    res.json({ projects })

  } catch (e) {
    console.error('Dashboard error:', e)
    res.status(500).json({ error: e.message })
  }
}

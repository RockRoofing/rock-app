import { getAllProjectSettings, getOpsProjects } from '../../lib/db'
import { computeApplicationSummary } from '../../lib/applications'
import { missingProjectFields } from '../../lib/projectComplete'
import { getProjectsFromCategories } from '../../lib/xero'
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
      if (cached && Array.isArray(cached) && cached.length > 0 && cached[0] && 'detailsMissing' in cached[0] && cached[0].completeV6 === true && 'hasContractedRates' in cached[0] && 'wipAdjustments' in cached[0] && cached[0].stageSource === 'retention' && 'appliedForLatest' in cached[0] && cached[0].cmResolved === true && cached[0].estimatorResolved === true && 'pcType' in cached[0]) {
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

    const projects = await Promise.all(categoryProjects.map(async (cp) => {
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
      let retentionClaimed = 0
      // FINAL ACCOUNT FROM THE APPLICATION.
      //
      // The application is the better source: it holds the measured contract sum and the
      // variations at FINAL value, which is what the final account actually is. Project
      // details only holds the original contract value plus whatever variations happen to
      // have been ticked as instructed.
      //
      // Null when there are no applications - the caller then falls back to project
      // details. Zero would be indistinguishable from a real zero.
      let afaFromApplication = null
      let afaSource = 'project details'
      try {
        const apps = Array.isArray(settings.applications) ? settings.applications.slice() : []
        if (apps.length) {
          apps.sort((a, b) => (a.seq || 0) - (b.seq || 0))
          const latest = apps[apps.length - 1]
          let prevGross = 0
          for (const a of apps) { if ((a.seq || 0) < (latest.seq || 0)) prevGross = computeApplicationSummary(a, 0).grossCurrent }
          const sum = computeApplicationSummary(latest, prevGross)
          appliedForLatest = sum.grossCurrent || sum.applicationTotal || 0
          // Retention CLAIMED BACK on applications - the halves ticked in the Retention
          // section. Deliberately NOT called retentionReleased: that name is already used
          // further down for something different, retention DUE by date (PC + defects
          // passed). Due and claimed are not the same thing, and conflating them would
          // have quietly written one over the other.
          retentionClaimed = sum.releasedTotal || 0
          // measured contract sum + variations at final value, GROSS of MCD.
          const afaApp = sum.anticipatedFinalAccount
          if (afaApp != null && isFinite(afaApp) && afaApp > 0) {
            afaFromApplication = afaApp
            afaSource = `application ${latest.appNumber || latest.seq || ''}`.trim()
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
      // A sent application's Anticipated Final Account is the source of truth when set;
      // otherwise fall back to contract value + instructed variations.
      // Order of preference: manual override -> latest application -> project details.
      const afaFromSettings = contractValue + instructedVars
      const grossAfa = afaFromApplication != null ? afaFromApplication : afaFromSettings
      const afaBeforeMcd = (settings.afaOverride != null && isFinite(settings.afaOverride)) ? Number(settings.afaOverride) : grossAfa
      if (settings.afaOverride != null && isFinite(settings.afaOverride)) afaSource = 'manual override'

      // MCD, DEDUCTED FROM THE FINAL ACCOUNT.
      //
      // Every application computes  gross -> minus MCD -> subTotal -> retention on the
      // SUBTOTAL. So the figure retention is applied to is net of MCD, and the Final
      // Account on the retention register has to be the same or the whole register is
      // overstated - Account Remaining, Total Due and the final-account balance all read
      // high by the value of the discount.
      //
      // Applied to the whole account including variations, because that is exactly what
      // the applications do: mcd = (measured + variations + materials) x mcdPct.
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
      const mcdValue = afaBeforeMcd * (mcdPct / 100)
      const afa = afaBeforeMcd - mcdValue

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
      const totalRetention = invoicedSales200 > 0 ? invoicedSales200 * retPct : (retPct > 0 ? invoicedExVat * retPct / (1 - retPct) : 0)
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
        appliedForLatest,
        retentionClaimed,
        // Same fix as contractsManager above, which was done and this was not.
        // It read settings.estimator only - a legacy flat field almost nothing writes
        // any more. Edit Project Details writes to peopleOverride.estimator and falls
        // back to the IHM, so the two disagreed: the name was on the project details
        // screen and blank on Project Financials.
        estimator: resolvedPeople?.team?.estimator?.name || settings.estimator || '',
        qsName: settings.qsName || '',
        qsEmail: settings.qsEmail || '',
        customerEmail: settings.customerEmail || '',
        customerContact: settings.customerContact || '',
        people: resolvedPeople,
        highRisk: settings.highRiskCustomer === true,
        pcDate: settings.pcDate || '',
        defectsDate: settings.defectsDate || '',
        completionDate: settings.completionDate || settings.pcDate || '',
        retentionComments: settings.retentionComments || '',
        variations: settings.variations || [],
        applicationDay: settings.applicationDay || null,
        paymentDay: settings.paymentDay || null,
        dateOverrides: settings.dateOverrides || {},
        valuationDay: settings.valuationDay || null,
        contractValue,
        afa,
        afaGross: afaBeforeMcd,
        afaSource,
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
        retention612Allocated: Math.abs(retention612),
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

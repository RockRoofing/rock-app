import { getValueChanges, saveValueChanges, getCachedDeals, saveCachedDeals, set } from '../../lib/db'

const TRACKED_STAGES = ['MC Unsecured', 'MC Secured', 'Negotiating', 'Variations']
const BASE = 'https://api.pipedrive.com/v1'
const KEY = () => process.env.PIPEDRIVE_API_KEY || process.env.Pipedrive_API_Key

async function fetchDeal(dealId) {
  try {
    const res = await fetch(`${BASE}/deals/${dealId}?api_token=${KEY()}`)
    const data = await res.json()
    return data.data || null
  } catch { return null }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  try {
    const body = req.body
    const meta = body.meta || {}

    if (meta.entity !== 'deal') return res.status(200).json({ ok: true, reason: 'not a deal' })

    const dealId = String(meta.entity_id)
    const now = new Date().toISOString()
    const changeDate = now.split('T')[0]
    const action = meta.action // 'change', 'add', etc.

    // Fetch current deal state from Pipedrive API
    const deal = await fetchDeal(dealId)
    if (!deal) return res.status(200).json({ ok: true, reason: 'deal not found' })

    const dealTitle = deal.title || ''
    const organizationName = deal.org_name || deal.org_id?.name || ''
    const currentStageId = deal.stage_id
    const currentValue = parseFloat(deal.value) || 0

    // Get cached deals for estimator
    const deals = await getCachedDeals() || []
    const cachedDeal = deals.find(d => String(d.id) === dealId)
    const estimator = cachedDeal?.estimator || ''

    // Get previous value from meta
    const previousValue = body.meta?.previous_value != null 
      ? parseFloat(body.meta.previous_value) 
      : body.previous?.value != null 
        ? parseFloat(body.previous.value) 
        : null

    // Get stage info
    const currentStage = deal.stage_name || cachedDeal?.stageName || ''
    const previousStageId = body.previous?.stage_id
    const previousStage = body.previous?.stage_name || ''

    console.log('Webhook:', JSON.stringify({ dealId, dealTitle, currentValue, previousValue, currentStage, previousStage }))

    const changes = await getValueChanges()
    const newEntries = []

    // 1. VALUE CHANGE — previous value exists and is different from current
    if (previousValue !== null && currentValue !== previousValue) {
      const alreadyLogged = changes.some(c =>
        c.dealId === dealId &&
        c.oldValue === previousValue &&
        c.newValue === currentValue &&
        c.changeDate === changeDate
      )
      if (!alreadyLogged) {
        newEntries.push({
          id: `vc-${dealId}-${Date.now()}`,
          type: 'value_change',
          dealId,
          dealTitle,
          organizationName,
          estimator,
          oldValue: previousValue,
          newValue: currentValue,
          valueChange: currentValue - previousValue,
          changeDate,
          stage: currentStage,
          notes: 'Value change via Pipedrive',
          createdAt: now,
          source: 'webhook'
        })
      }
    }

    // 2. STAGE CHANGE
    if (previousStageId && currentStageId && currentStageId !== previousStageId) {
      const hasEverBeenInTrackedStage = changes.some(c => c.dealId === dealId) ||
        TRACKED_STAGES.includes(previousStage) ||
        TRACKED_STAGES.includes(currentStage)

      if (hasEverBeenInTrackedStage) {
        const alreadyLogged = changes.some(c =>
          c.dealId === dealId &&
          c.type === 'stage_change' &&
          c.fromStage === previousStage &&
          c.toStage === currentStage &&
          c.changeDate === changeDate
        )
        if (!alreadyLogged) {
          newEntries.push({
            id: `sc-${dealId}-${Date.now()}`,
            type: 'stage_change',
            dealId,
            dealTitle,
            organizationName,
            estimator,
            fromStage: previousStage,
            toStage: currentStage,
            currentValue,
            changeDate,
            stage: currentStage,
            notes: `Stage: ${previousStage} → ${currentStage}`,
            createdAt: now,
            source: 'webhook'
          })
        }

        // Entering a tracked stage
        if (TRACKED_STAGES.includes(currentStage) && !TRACKED_STAGES.includes(previousStage)) {
          const lastValueEntry = changes
            .filter(c => c.dealId === dealId && c.type === 'value_change')
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0]
          const lastLoggedValue = lastValueEntry?.newValue

          if (!currentValue || currentValue === 0) {
            newEntries.push({
              id: `se-${dealId}-${Date.now() + 1}`,
              type: 'stage_entry',
              dealId,
              dealTitle,
              organizationName,
              estimator,
              oldValue: null,
              newValue: 0,
              valueChange: 0,
              changeDate,
              stage: currentStage,
              noValue: true,
              notes: `Entered ${currentStage} with no value`,
              createdAt: now,
              source: 'webhook'
            })
          } else if (currentValue !== lastLoggedValue) {
            newEntries.push({
              id: `se-${dealId}-${Date.now() + 1}`,
              type: 'stage_entry',
              dealId,
              dealTitle,
              organizationName,
              estimator,
              oldValue: lastLoggedValue || 0,
              newValue: currentValue,
              valueChange: currentValue - (lastLoggedValue || 0),
              changeDate,
              stage: currentStage,
              notes: `Entered ${currentStage}`,
              createdAt: now,
              source: 'webhook'
            })
          }
        }
      }
    }

    const FIRST_CONTACT_STAGE_ID = 45
    const RECEIVED_STAGE_ID = 47
    let firstContactUpdate = {}
    const existingDeal = deals.find(d => String(d.id) === dealId)
    const isNewDeal = meta.action === 'added'

    // Check 1st Contact
    const movedIntoFirstContact = currentStageId === FIRST_CONTACT_STAGE_ID && previousStageId !== FIRST_CONTACT_STAGE_ID
    const createdInFirstContact = isNewDeal && currentStageId === FIRST_CONTACT_STAGE_ID
    if ((movedIntoFirstContact || createdInFirstContact) && !existingDeal?.firstContactDate) {
      firstContactUpdate = { ...firstContactUpdate, firstContactDate: changeDate, everIn1stContact: true }
      console.log('First contact date set for deal', dealId, changeDate, isNewDeal ? '(created)' : '(moved)')
    }

    // Check Received stage
    const movedIntoReceived = currentStageId === RECEIVED_STAGE_ID && previousStageId !== RECEIVED_STAGE_ID
    const createdInReceived = isNewDeal && currentStageId === RECEIVED_STAGE_ID
    if ((movedIntoReceived || createdInReceived) && !existingDeal?.receivedDate) {
      firstContactUpdate = { ...firstContactUpdate, receivedDate: changeDate, everInReceived: true }
      console.log('Received date set for deal', dealId, changeDate, isNewDeal ? '(created)' : '(moved)')
    }

    if (newEntries.length > 0 || Object.keys(firstContactUpdate).length > 0 || !existingDeal) {
      if (newEntries.length > 0) await saveValueChanges([...changes, ...newEntries])
      
      if (existingDeal) {
        // Update existing cached deal
        const updated = deals.map(d =>
          String(d.id) === dealId ? { ...d, value: currentValue, stageName: currentStage, ...firstContactUpdate } : d
        )
        await saveCachedDeals(updated)
      } else {
        // New deal not in cache yet — add a basic entry so firstContactDate is preserved
        console.log('Adding new deal to cache:', dealId, 'firstContactUpdate:', JSON.stringify(firstContactUpdate), 'deal:', deal?.id)
        const newDealEntry = {
          id: parseInt(dealId),
          title: dealTitle || deal?.title || '',
          organizationName: organizationName || deal?.org_name || '',
          value: currentValue,
          status: deal?.status || 'open',
          createdDate: deal?.add_time || now,
          stageName: currentStage || '',
          estimator,
          customerType: null,
          leadSource: null,
          region: null,
          over200k: currentValue >= 200000,
          ...firstContactUpdate,
        }
        await saveCachedDeals([...deals, newDealEntry])
        console.log('New deal added to cache successfully:', dealId)
      }
    }

    return res.status(200).json({ ok: true, logged: newEntries.length })
  } catch (err) {
    console.error('Webhook error:', err)
    return res.status(500).json({ error: err.message })
  }
}

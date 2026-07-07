const BASE = 'https://api.pipedrive.com/v1'
const KEY = () => process.env.PIPEDRIVE_API_KEY || process.env.Pipedrive_API_Key

// Pipeline stage ID to name map for Project pipeline (ID 8)
const STAGE_MAP = {
  44: 'Project In',
  45: '1st Contact',
  121: 'Calls x 3',
  65: 'In Abeyance',
  46: 'TBF',
  115: 'Variations',
  91: 'Info Pending',
  47: 'Received',
  48: 'Stage 1',
  49: 'Stage 2',
  81: 'Review',
  123: 'MC Unsecured - Not Priced',
  64: 'MC Unsecured',
  50: 'MC Secured',
  51: 'Negotiating',
}

// Fetch all deals from the Project pipeline with pagination
export async function fetchAllDeals(fieldMap = {}) {
  const allDeals = []
  let start = 0
  const limit = 100

  const pipelineId = await getProjectPipelineId()

  while (true) {
    const url = `${BASE}/deals?api_token=${KEY()}&limit=${limit}&start=${start}&status=all`
    const res = await fetch(url)
    const data = await res.json()
    if (!data.success || !data.data) break

    const deals = data.data.filter(d => d.pipeline_id && d.pipeline_id === pipelineId)
    allDeals.push(...deals)

    if (!data.additional_data?.pagination?.more_items_in_collection) break
    start += limit
  }

  // Build map of org names to won deal count
  const wonOrgCounts = {}
  allDeals
    .filter(d => d.status === 'won')
    .forEach(d => {
      const org = d.org_name || (typeof d.org_id === 'object' ? d.org_id?.name : '') || ''
      if (org) wonOrgCounts[org] = (wonOrgCounts[org] || 0) + 1
    })

  return allDeals.map(d => normaliseDeal(d, fieldMap, wonOrgCounts))
}

let _pipelineId = null
export async function getProjectPipelineId() {
  if (_pipelineId) return _pipelineId
  const res = await fetch(`${BASE}/pipelines?api_token=${KEY()}`)
  const data = await res.json()
  const pipeline = data.data?.find(p => p.name.trim() === 'Project')
  _pipelineId = pipeline?.id || null
  return _pipelineId
}

// Auto-discover custom field keys by fetching deal fields
export async function discoverFieldMap() {
  const res = await fetch(`${BASE}/dealFields?api_token=${KEY()}&limit=200`)
  const data = await res.json()
  if (!data.success) return {}

  const map = {}
  const targets = {
    'Estimator Responsible': 'estimator',
    'Project Stage': 'projectStage',
    'Sales Person': 'salesPersonField',
    'Lead Source': 'leadSource',
    'Systems Priced': 'systemPriced',
    'Project Type': 'projectType',
    'Region': 'region',
    'Lost reason': 'lostReason',
    'Lost Reason': 'lostReason',
  }

  for (const field of data.data || []) {
    for (const [name, key] of Object.entries(targets)) {
      if (field.name.toLowerCase() === name.toLowerCase()) {
        map[key] = { key: field.key, options: {} }
        if (field.options) {
          for (const opt of field.options) {
            map[key].options[opt.id] = opt.label
          }
        }
      }
    }
  }

  return map
}

function resolveField(deal, fieldInfo) {
  if (!fieldInfo) return null
  const raw = deal[fieldInfo.key]
  if (raw == null) return null
  if (typeof raw === 'object' && raw.label) return raw.label
  if (Array.isArray(raw)) return raw.map(v => lookupOption(fieldInfo.options, v) || v).join(', ')
  // Handle comma-separated IDs (Pipedrive set fields)
  if (typeof raw === 'string' && raw.includes(',')) {
    return raw.split(',').map(id => lookupOption(fieldInfo.options, id.trim()) || id.trim()).join(', ')
  }
  if (fieldInfo.options) {
    const found = lookupOption(fieldInfo.options, raw)
    if (found != null) return found
  }
  return raw
}

function lookupOption(options, val) {
  if (!options) return null
  // Try as-is, as string, as number
  if (options[val] != null) return options[val]
  if (options[String(val)] != null) return options[String(val)]
  if (options[parseInt(val)] != null) return options[parseInt(val)]
  // Try converting options keys to strings
  const strKey = String(val)
  for (const [k, v] of Object.entries(options)) {
    if (String(k) === strKey) return v
  }
  return null
}

// Calculate when deal first entered a specific stage using stay_in_pipeline_stages
function calcFirstEntryDate(d, targetStageId) {
  try {
    const stageData = d.stay_in_pipeline_stages
    if (!stageData || !stageData.order_of_stages || !stageData.times_in_stages) return null
    
    const order = stageData.order_of_stages
    const times = stageData.times_in_stages
    
    const idx = order.indexOf(targetStageId)
    if (idx === -1) return null // never entered this stage
    
    // Work forward from created date
    const created = new Date(d.add_time)
    let elapsed = 0
    
    // Sum time spent in all stages before targetStage
    for (let i = 0; i < idx; i++) {
      const stageId = order[i]
      elapsed += (times[stageId] || 0) * 1000 // seconds to ms
    }
    
    const entryDate = new Date(created.getTime() + elapsed)
    return entryDate.toISOString().split('T')[0]
  } catch(e) {
    return null
  }
}

// Determine customer type based on won deal count
// wonOrgCounts is a map of org name -> number of won deals
// Prospect = 0 wins, New Customer = 1 win, Existing Customer = 2+ wins
// Normalise sales person name variations to a single canonical name
function normaliseSalesPerson(name) {
  if (!name) return name
  const map = {
    'Edita Durikova': 'Edita',
    'Edita': 'Edita',
    'Roman Jarosz': 'Roman',
    'Roman': 'Roman',
    'James McVeigh': 'James',
    'William McVeigh': 'William',
  }
  return map[name] || name
}

function resolveCustomerType(d, wonOrgCounts) {
  const org = d.org_name || (typeof d.org_id === 'object' ? d.org_id?.name : '') || ''
  if (!org) return null
  const count = wonOrgCounts[org] || 0
  if (count === 0) return 'Prospect'
  if (count === 1) return 'New Customer'
  return 'Existing Customer'
}

export function normaliseDeal(d, fieldMap, wonOrgCounts = {}) {
  // stage_id for 1st Contact = 45, Received = 47
  // stay_in_pipeline_stages is only available on single deal fetch, not bulk
  // So we use createdDate as approximation for firstContactDate on historical deals
  // Webhook will capture accurate dates going forward
  
  return {
    id: d.id,
    title: d.title,
    value: d.value || 0,
    currency: d.currency,
    status: d.status,
    createdDate: d.add_time,
    closeTime: d.close_time,
    wonTime: d.won_time,
    lostTime: d.lost_time,
    expectedCloseDate: d.expected_close_date,
    organizationName: d.org_name || (typeof d.org_id === 'object' ? d.org_id?.name : '') || '',
    ownerName: d.owner_name || d.user_id?.name || '',
    stageId: d.stage_id,
    stageName: STAGE_MAP[d.stage_id] || d.stage_name || '',
    pipelineId: d.pipeline_id,
    estimator: resolveField(d, fieldMap.estimator),
    projectStage: resolveField(d, fieldMap.projectStage),
    customerType: resolveCustomerType(d, wonOrgCounts),
    wonCount: wonOrgCounts[d.org_name || (typeof d.org_id === 'object' ? d.org_id?.name : '') || ''] || 0,
    leadSource: resolveField(d, fieldMap.leadSource),
    systemPriced: resolveField(d, fieldMap.systemPriced),
    projectType: resolveField(d, fieldMap.projectType),
    region: resolveField(d, fieldMap.region),
    lostReason: resolveField(d, fieldMap.lostReason),
    salesPerson: normaliseSalesPerson(resolveField(d, fieldMap.salesPersonField) || d.user_id?.name || d.owner_name || ''),
    label: d.label || null,
    over200k: (d.value || 0) >= 200000,
    // firstContactDate only set by webhook when deal enters 1st Contact
    // No approximation — data builds up accurately from webhook going forward
    firstContactDate: d.firstContactDate || null,
    roofingWorksOnSite: d['90c55b79c62d6d9b63ab0a0172ff7c2032b038be'] || null,
    everIn1stContact: !!d.firstContactDate,
  }
}

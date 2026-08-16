import { get, set, getPortalUsers } from './db'

// OUTBOUND CALL VOLUME from 8x8 Work, per person per month.
//
// Same shape as lib/crmEmailVolume.js on purpose: a per-month tally, recounted nightly for
// the recent window, overwritten rather than added to so a re-run cannot double-count.
//
// COUNTS: outbound calls only. Every one of them - answered or not, however short.
// That is the agreed definition. If you later decide a four-second misdial should not
// count, MIN_SECONDS below is the only line to change.
//
// A WARNING WORTH READING ONCE
// ----------------------------
// I could not check 8x8's current API documentation while building this. The endpoint,
// the auth flow and the field names below are my best understanding and may be wrong or
// out of date. Everything that touches their response is therefore TOLERANT - it looks
// for several plausible field names rather than one - and there is a diagnostic
// (fetchRawSample) that returns one untouched record so the real shape can be seen and
// this file corrected. Expect one round of that before it works.

const KEY = 'crm:call-volume'

const TOKEN_URL = process.env.EIGHTX8_TOKEN_URL || 'https://api.8x8.com/oauth/v2/token'
const RECORDS_URL = process.env.EIGHTX8_RECORDS_URL || 'https://api.8x8.com/analytics/work/v2/call-records'
const CLIENT_ID = process.env.EIGHTX8_CLIENT_ID || ''
const CLIENT_SECRET = process.env.EIGHTX8_CLIENT_SECRET || ''

// Only used if 8x8 identifies people by extension rather than email address.
// Format: "1234=edita@rockroofing.co.uk,1235=niall@rockroofing.co.uk"
const EXT_MAP = String(process.env.EIGHTX8_EXTENSION_MAP || '')

// Outbound only, no duration floor. Set to e.g. 30 to ignore anything shorter.
const MIN_SECONDS = Number(process.env.EIGHTX8_MIN_SECONDS || 0)

export function callsConfigured() {
  return !!(CLIENT_ID && CLIENT_SECRET)
}

let cachedToken = null
async function getToken() {
  if (cachedToken && cachedToken.expires > Date.now() + 60000) return cachedToken.value
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  })
  if (!res.ok) throw new Error(`8x8 auth failed (${res.status}): ${(await res.text()).slice(0, 300)}`)
  const data = await res.json()
  const token = data.access_token
  if (!token) throw new Error('8x8 auth returned no access_token')
  cachedToken = { value: token, expires: Date.now() + ((data.expires_in || 3600) * 1000) }
  return token
}

// TOLERANT FIELD READING. Each of these tries the names I believe 8x8 uses, then several
// near-neighbours. If a record comes back with none of them the diagnostic will show it.
const pick = (o, ...names) => {
  for (const n of names) {
    const v = n.split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), o)
    if (v != null && v !== '') return v
  }
  return null
}

const isOutbound = (r) => {
  const dir = String(pick(r, 'direction', 'callDirection', 'legDirection', 'type') || '').toLowerCase()
  if (!dir) return null                      // unknown - counted, and flagged by the diagnostic
  return dir.includes('out') || dir === 'originating' || dir === 'placed'
}

const secondsOf = (r) => {
  const v = pick(r, 'durationSeconds', 'duration', 'callDuration', 'talkTime', 'talkTimeSeconds')
  const n = Number(v)
  return isNaN(n) ? 0 : n
}

const whenOf = (r) => pick(r, 'startTime', 'callStartTime', 'timestamp', 'startedAt', 'callTime', 'date')

const callerOf = (r) => pick(r,
  'userEmail', 'callerEmail', 'user.email', 'agentEmail', 'ownerEmail',
  'extension', 'callerExtension', 'callerNumber', 'fromExtension', 'user.extension')

function buildExtensionMap() {
  const map = new Map()
  for (const pair of EXT_MAP.split(',')) {
    const [ext, email] = pair.split('=').map((x) => (x || '').trim())
    if (ext && email) map.set(ext.toLowerCase(), email.toLowerCase())
  }
  return map
}

// Resolve whatever 8x8 gives us to a portal user's email address.
async function buildResolver() {
  const users = await getPortalUsers()
  const byEmail = new Set((users || []).map((u) => String(u.email || '').toLowerCase()).filter(Boolean))
  const extMap = buildExtensionMap()
  return (raw) => {
    const v = String(raw || '').trim().toLowerCase()
    if (!v) return null
    if (v.includes('@')) return byEmail.has(v) ? v : null
    // Not an address - treat as an extension and look it up.
    return extMap.get(v) || null
  }
}

export async function getCallVolume() {
  const v = await get(KEY)
  return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {}
}

async function fetchPage(url, token) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })
  if (!res.ok) throw new Error(`8x8 records failed (${res.status}): ${(await res.text()).slice(0, 300)}`)
  return res.json()
}

// Returns ONE untouched record so the real field names can be read off it. Sends nothing
// to the store. This is how we correct the guesses above.
export async function fetchRawSample() {
  if (!callsConfigured()) return { ok: false, error: 'EIGHTX8_CLIENT_ID / EIGHTX8_CLIENT_SECRET are not set.' }
  const token = await getToken()
  const to = new Date().toISOString()
  const from = new Date(Date.now() - 7 * 86400000).toISOString()
  const url = `${RECORDS_URL}?startTime=${encodeURIComponent(from)}&endTime=${encodeURIComponent(to)}&pageSize=1`
  try {
    const data = await fetchPage(url, token)
    const rows = data.data || data.records || data.items || data.content || (Array.isArray(data) ? data : [])
    return {
      ok: true,
      url,
      topLevelKeys: Object.keys(data || {}),
      sample: rows[0] || null,
      sampleKeys: rows[0] ? Object.keys(rows[0]) : [],
      note: 'Send me sampleKeys and sample and I will correct the field names in lib/crm8x8.js.',
    }
  } catch (e) {
    return { ok: false, error: e.message, url }
  }
}

export async function refreshCallVolume({ months = 2, max = 50000 } = {}) {
  if (!callsConfigured()) return { ok: false, error: 'EIGHTX8_CLIENT_ID / EIGHTX8_CLIENT_SECRET are not set.' }

  const token = await getToken()
  const resolve = await buildResolver()
  const now = new Date()
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  const fromD = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1))

  const tally = {}          // email -> { 'YYYY-MM': n }
  let scanned = 0, outbound = 0, unresolved = 0, unknownDirection = 0, truncated = false

  let url = `${RECORDS_URL}?startTime=${encodeURIComponent(fromD.toISOString())}`
    + `&endTime=${encodeURIComponent(to.toISOString())}&pageSize=500`

  while (url) {
    if (scanned >= max) { truncated = true; break }
    const data = await fetchPage(url, token)
    const rows = data.data || data.records || data.items || data.content || (Array.isArray(data) ? data : [])
    for (const r of rows) {
      scanned++
      const out = isOutbound(r)
      if (out === null) unknownDirection++
      if (out === false) continue
      if (MIN_SECONDS > 0 && secondsOf(r) < MIN_SECONDS) continue
      const email = resolve(callerOf(r))
      if (!email) { unresolved++; continue }
      const when = whenOf(r)
      const month = String(when || '').slice(0, 7)
      if (!/^\d{4}-\d{2}$/.test(month)) continue
      tally[email] = tally[email] || {}
      tally[email][month] = (tally[email][month] || 0) + 1
      outbound++
    }
    url = data.nextPageUrl || data.next || (data.paging && data.paging.next) || null
  }

  // Same rule as the email volume job: only fill zeros for months we actually COVERED.
  // A month we never reached is unknown, not empty.
  const store = await getCallVolume()
  for (const [email, months_] of Object.entries(tally)) {
    const existing = store[email] || {}
    for (const k of Object.keys(months_)) existing[k] = months_[k]
    store[email] = existing
  }
  if (!truncated) {
    for (const email of Object.keys(store)) {
      const cursor = new Date(fromD)
      while (cursor < to) {
        const k = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`
        if (store[email][k] == null) store[email][k] = 0
        cursor.setUTCMonth(cursor.getUTCMonth() + 1)
      }
    }
  }
  await set(KEY, store)

  const result = { ok: true, scanned, outboundCounted: outbound, unresolvedCaller: unresolved, tally }
  if (truncated) result.truncated = `Stopped at the ${max} record cap - re-run with a higher ?max=.`
  if (unknownDirection) result.warning = `${unknownDirection} records had no recognisable direction field - every call was counted. Run ?sample=1 and send me the field names.`
  if (unresolved) result.unresolvedNote = 'Callers that matched no portal user. If 8x8 reports extensions rather than emails, set EIGHTX8_EXTENSION_MAP.'
  return result
}

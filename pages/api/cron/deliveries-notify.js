import { get, getOpsProjects, getTeamMembers } from '../../../lib/db'

// Daily 7am deliveries notification.
// For each project with a delivery whose REQUIRED delivery date is today (and not
// yet marked delivered), email the effective site supervisor:
//   - the list of expected deliveries (PO, supplier, items),
//   - a note to call the Rock Roofing Operations Manager (with their details) for more info,
//   - a reminder to mark the delivery as delivered in the Site App and attach the
//     delivery note + photos.
// Called from the daily dispatcher (hs-expiry-email) so we stay within Hobby's 2-cron limit.

const DAY = 86400000
const parseISO = (s) => { if (!s) return null; const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1) }
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const fmt = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '')

export async function runDeliveriesNotify({ force = false } = {}) {
  const RESEND_KEY = process.env.RESEND_API_KEY
  const FROM = process.env.FORMS_FROM_EMAIL || 'Rock Roofing <onboarding@resend.dev>'
  if (!RESEND_KEY) return { ok: false, reason: 'email not configured' }

  const [deliveries, alloc, ops, team, roster, hsCols, hsData] = await Promise.all([
    get('ops:deliveries').then(v => v || []),
    get('ops:planning-allocations').then(v => v || {}),
    getOpsProjects(),
    getTeamMembers(),
    get('ops:operatives-roster').then(v => v || []),
    get('ops:hs-matrix-columns').then(v => v || []),
    get('ops:hs-matrix-data').then(v => v || {}),
  ])

  const todayKey = iso(new Date())

  // Deliveries due today, not yet delivered, grouped by project key.
  const byProject = {}
  for (const d of deliveries) {
    if (d.actualDeliveryDate) continue
    if (!d.requiredDeliveryDate || iso(parseISO(d.requiredDeliveryDate)) !== todayKey) continue
    const key = d.projectNo || d.projectName || ''
    if (!key) continue
    ;(byProject[key] = byProject[key] || []).push(d)
  }
  if (!Object.keys(byProject).length) return { ok: true, sent: [], note: 'no deliveries due today' }

  // Supervisor competency (in-date supervisor ticket) for effective-supervisor resolution.
  const nowMid = new Date(); nowMid.setHours(0, 0, 0, 0)
  const validCell = (c) => c && (c.noExpiry || (c.date && parseISO(c.date) >= nowMid))
  const supColIds = (hsCols || []).filter(c => ['internal supervisor', 'sssts', 'smsts', 'iosh managing safely'].some(m => (c.label || '').toLowerCase().includes(m))).map(c => c.id)
  const isSup = (opId) => { const cols = hsData[`op:${opId}`] || {}; return supColIds.some(id => validCell(cols[id])) }
  const rosterNameById = {}; const supEmailByName = {}
  for (const o of roster) { const nm = `${o.firstName || ''} ${o.lastName || ''}`.trim(); if (nm) { rosterNameById[o.id] = nm; supEmailByName[nm.toLowerCase()] = o.email || '' } }
  const emailByName = {}
  for (const m of (team || [])) { const nm = m.name || [m.firstName, m.lastName].filter(Boolean).join(' '); if (nm) emailByName[nm.toLowerCase()] = m.email || '' }

  // Ops Manager contact (name / phone / email) for the "call for more info" note.
  const opsMgr = (team || []).find(m => m.active !== false && /operations manager/i.test(m.jobRole || m.role || ''))
  const opsMgrName = opsMgr ? (opsMgr.name || [opsMgr.firstName, opsMgr.lastName].filter(Boolean).join(' ')) : 'the Operations Manager'
  const opsMgrPhone = opsMgr?.phone || opsMgr?.mobile || ''
  const opsMgrEmail = opsMgr?.email || process.env.ALERT_EMAIL || ''

  // Effective supervisor per project (Details supervisor if on the Gantt, else first Gantt supervisor).
  function effectiveSupervisor(projectKey) {
    const p = (ops || []).find(x => x.projectNo === projectKey)
    const key = `L:${projectKey}`
    const dayCells = Object.values(alloc[key] || {})
    const allocOpIds = new Set()
    for (const c of dayCells) { const entries = Array.isArray(c) ? c : (c.entries || []); for (const e of entries) if (e.opId) allocOpIds.add(e.opId) }
    const detailsSup = p?.data?.siteSupervisor || ''
    const onGantt = detailsSup && [...allocOpIds].some(id => rosterNameById[id] && rosterNameById[id].toLowerCase() === detailsSup.toLowerCase())
    const ganttSups = [...allocOpIds].filter(id => isSup(id)).map(id => rosterNameById[id]).filter(Boolean)
    return onGantt ? detailsSup : (ganttSups[0] || detailsSup)
  }

  async function sendMail(to, subject, html) {
    if (!to) return false
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [to], subject, html }),
    })
    return r.ok
  }

  const sent = []; const skipped = []
  for (const [projectKey, dels] of Object.entries(byProject)) {
    const p = (ops || []).find(x => x.projectNo === projectKey)
    const projectName = p?.data?.projectName || dels[0].projectName || projectKey
    const supName = effectiveSupervisor(projectKey)
    const to = supName ? (supEmailByName[supName.toLowerCase()] || emailByName[supName.toLowerCase()]) : ''
    if (!to) { skipped.push(`${projectKey} (no supervisor email)`); continue }

    const rows = dels.map(d => {
      const items = (d.lineItems || []).map(li => `${li.description || li.item || ''}${li.quantity ? ` ×${li.quantity}` : ''}`.trim()).filter(Boolean)
      return `<li style="margin-bottom:10px">
        <strong>${d.poNumber || 'PO'}</strong> — ${d.supplier || 'Supplier'}
        ${items.length ? `<ul style="margin:4px 0 0;padding-left:18px;color:#555">${items.map(t => `<li>${t}</li>`).join('')}</ul>` : ''}
      </li>`
    }).join('')

    const opsLine = `Call ${opsMgrName}${opsMgrPhone ? ` on <strong>${opsMgrPhone}</strong>` : ''}${opsMgrEmail ? ` (${opsMgrEmail})` : ''} if you need any more information.`

    const html = `<div style="font-family:system-ui,Arial,sans-serif;max-width:620px">
      <h2 style="color:#1a1a19;margin:0 0 6px">Deliveries expected today — ${projectKey}${projectName && projectName !== projectKey ? ` (${projectName})` : ''}</h2>
      <p style="color:#666;margin:0 0 12px">Hi ${(supName || '').split(' ')[0] || 'there'}, the following deliveries are expected on site today (${fmt(new Date())}):</p>
      <ul style="font-size:14px;padding-left:18px;margin:0 0 14px">${rows}</ul>
      <p style="font-size:14px;color:#333;margin:0 0 10px">${opsLine}</p>
      <div style="background:#f2efe8;border-radius:10px;padding:12px 14px;font-size:14px;color:#444">
        📱 <strong>Reminder:</strong> once each delivery arrives, mark it as delivered in the Site App (Deliveries),
        and attach the <strong>delivery note</strong> and <strong>photos</strong> of the delivery.
      </div>
    </div>`

    if (await sendMail(to, `Rock Roofing — Deliveries expected today (${projectKey})`, html)) sent.push(to); else skipped.push(`${projectKey} (send failed)`)
  }

  return { ok: true, sent, skipped }
}

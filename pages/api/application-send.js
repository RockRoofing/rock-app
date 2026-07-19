import { requireRole } from '../../lib/portalAuth'
import { getProject, get, saveProject } from '../../lib/db'
import { buildApplicationPDF } from '../../lib/applicationPdf'
import { computeApplicationSummary } from '../../lib/applications'

// POST /api/application-send
// Body: { projectId, appId, to:[..], cc:[..], replyTo, subject, text, markSent }
// Builds the customer-copy Application PDF, attaches it, and emails via Resend.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!requireRole(req, res, ['post-contract', 'management', 'admin'])) return

  const { projectId, appId, to, cc, replyTo, subject, text, markSent } = req.body || {}
  if (!projectId || !appId) return res.status(400).json({ error: 'projectId and appId are required' })
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean)
  if (!recipients.length) return res.status(400).json({ error: 'At least one recipient is required' })
  if (!subject) return res.status(400).json({ error: 'Subject is required' })

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'Email is not configured (RESEND_API_KEY missing).' })

  try {
    const project = (await getProject(projectId)) || {}
    const apps = Array.isArray(project.applications) ? project.applications : []
    const idx = apps.findIndex(a => a.id === appId)
    if (idx === -1) return res.status(404).json({ error: 'Application not found' })
    const app = apps[idx]

    const sorted = apps.slice().sort((a, b) => (a.seq || 0) - (b.seq || 0))
    let prev = null
    for (const a of sorted) { if ((a.seq || 0) < (app.seq || 0)) prev = a }
    const prevGross = prev ? computeApplicationSummary(prev, 0).grossCurrent : 0

    let jobNo = '', name = ''
    try {
      const cache = await get('dashboard:cache')
      const row = Array.isArray(cache) ? cache.find(p => String(p.xeroId) === String(projectId)) : null
      jobNo = row?.jobNo || ''; name = row?.name || ''
    } catch {}

    const origin = `https://${req.headers.host}`
    const bytes = await buildApplicationPDF({
      app, prevGross,
      trackerVariations: project.variations || [],
      project: { jobNo, name, customerName: project.customerName || '' },
      logoUrl: `${origin}/rock-logo.jpg`,
    })
    const b64 = Buffer.from(bytes).toString('base64')
    const fname = `Application ${app.seq || ''} - ${(jobNo || name || 'application')}.pdf`.replace(/[^a-zA-Z0-9 .-]/g, '')

    const FROM = process.env.ACCOUNTS_FROM_EMAIL || process.env.FORMS_FROM_EMAIL || 'Rock Roofing Accounts <onboarding@resend.dev>'
    const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;line-height:1.5">${esc(text).replace(/\n/g, '<br>')}</div>`

    const payload = {
      from: FROM, to: recipients, subject,
      html, text: String(text || ''),
      attachments: [{ filename: fname, content: b64 }],
    }
    const ccList = (Array.isArray(cc) ? cc : [cc]).filter(Boolean)
    if (ccList.length) payload.cc = ccList
    if (replyTo) payload.reply_to = replyTo

    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(payload),
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) return res.status(502).json({ error: data?.message || 'Resend rejected the email', detail: data })

    // Record the send + optionally mark as sent (freezing variations).
    const nowSend = { at: Date.now(), to: recipients, cc: ccList, by: req.body.author || '' }
    apps[idx].sends = [...(apps[idx].sends || []), nowSend]
    if (markSent && (!apps[idx].status || apps[idx].status === 'draft')) {
      const { buildAppVariations } = await import('../../lib/applications')
      apps[idx].variations = buildAppVariations(apps[idx], project.variations || [])
      apps[idx].status = 'sent'; apps[idx].sentAt = Date.now(); apps[idx].sentBy = req.body.author || ''
    }
    project.applications = apps
    await saveProject(projectId, project)

    return res.json({ ok: true, id: data?.id || null, application: apps[idx] })
  } catch (e) {
    console.error('application-send error:', e)
    return res.status(500).json({ error: e.message || 'Send failed' })
  }
}

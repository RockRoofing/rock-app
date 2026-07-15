import {
  getRamsApprovals, saveRamsApprovals,
  getRamsSignatures, saveRamsSignatures,
  getRamsToken, saveRamsToken,
  getOpsProject, getProjectFiles, get,
} from '../../lib/db'
import crypto from 'crypto'

// RAMS approval chain (per RAMS document). Strict sequential order:
//   CM (Site App) -> Director/Carl (Portal) -> Customer Site Manager (email) -> Operatives
//
// GET  /api/rams-approvals?no=<projectNo>            -> { approvals }
//
// POST actions:
//   { action:'cm-approve',       projectNo, fileId, name, signatureImg }
//   { action:'director-approve', projectNo, fileId, name, signatureImg }
//   { action:'set-site-manager', projectNo, fileId, email }   -> saves recipient + sends email
//   { action:'sm-approve',       token, name }                -> Site Manager approves (no login)
//
// CM & Director approvals ALSO write a signature into ops:rams-signatures
// (they sign onto the RAMS with the operative statement), so they appear on the
// signature page and the matrix.
export const config = { api: { bodyParser: { sizeLimit: '2mb' } } }

const STATEMENT = 'I confirm I have read, fully understood and will work to this and any other documents relating to this method statement. If at any point I feel it is unsafe to continue I will stop works and contact my supervisor. Any amendments to this method statement must be made by the person who originally completed it. It must then be communicated to the relevant persons.'

const STAGES = ['cm', 'director', 'site-manager', 'operatives', 'complete']

function blankRecord() {
  return { stage: 'cm', cm: null, director: null, siteManager: null, siteManagerEmail: '', token: '', startedAt: Date.now(), updatedAt: Date.now() }
}

// CM/Director auto-sign onto the RAMS (same statement as operatives).
async function autoSign(projectNo, fileId, opId, name, signatureImg) {
  const sigs = await getRamsSignatures(projectNo)
  sigs[fileId] = sigs[fileId] || {}
  sigs[fileId][opId] = {
    name, date: new Date().toISOString().slice(0, 10), signedAt: Date.now(),
    statement: STATEMENT, signatureImg: signatureImg || '', role: opId.startsWith('cm:') ? 'Contracts Manager' : 'Director',
  }
  await saveRamsSignatures(projectNo, sigs)
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      // List all RAMS awaiting Director approval across active projects.
      if (req.query.pending === 'director') {
        const { getOpsProjects, getProjectFiles } = await import('../../lib/db')
        const projects = (await getOpsProjects()).filter(p => (p.status || 'active') === 'active')
        const items = []
        for (const p of projects) {
          const appr = await getRamsApprovals(p.projectNo)
          const files = await getProjectFiles(p.projectNo)
          for (const fileId of Object.keys(appr)) {
            const rec = appr[fileId]
            if (rec.stage !== 'director') continue
            const f = (files || []).find(x => x.id === fileId)
            if (!f) continue   // file removed
            items.push({
              projectNo: p.projectNo,
              projectName: p.data?.projectName || '',
              fileId, fileName: f.name || 'RAMS', fileUrl: f.url || '',
              cmName: rec.cm?.name || '', cmDate: rec.cm?.date || '',
            })
          }
        }
        return res.json({ items })
      }
      const { no } = req.query
      if (!no) return res.status(400).json({ error: 'Project number required' })
      const approvals = await getRamsApprovals(no)
      return res.json({ approvals })
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    const body = req.body || {}
    const { action } = body

    // ── Site Manager approval via token (no login) ──
    if (action === 'sm-approve') {
      const { token, name } = body
      if (!token) return res.status(400).json({ error: 'Missing token' })
      const ref = await getRamsToken(token)
      if (!ref) return res.status(404).json({ error: 'This approval link is invalid or has expired.' })
      const approvals = await getRamsApprovals(ref.projectNo)
      const rec = approvals[ref.fileId]
      if (!rec) return res.status(404).json({ error: 'This RAMS is no longer awaiting approval.' })
      if (rec.stage === 'operatives' || rec.stage === 'complete' || rec.siteManager) {
        return res.json({ ok: true, already: true })
      }
      if (rec.stage !== 'site-manager') {
        return res.status(409).json({ error: 'This RAMS is not yet ready for your approval.' })
      }
      const signerName = (name || rec.siteManagerName || '').trim()
      if (!signerName) return res.status(400).json({ error: 'Please enter your name.' })
      rec.siteManager = { name: signerName, date: new Date().toISOString().slice(0, 10), signedAt: Date.now() }
      rec.stage = 'operatives'
      rec.updatedAt = Date.now()
      approvals[ref.fileId] = rec
      await saveRamsApprovals(ref.projectNo, approvals)
      try {
        const { notifyOperativesToSign } = await import('../../lib/ramsNotify')
        const files = await getProjectFiles(ref.projectNo)
        const f = (files || []).find(x => x.id === ref.fileId)
        notifyOperativesToSign({ projectNo: ref.projectNo, fileName: f?.name || '' })
      } catch {}
      return res.json({ ok: true })
    }

    // All other actions need projectNo + fileId.
    const { projectNo, fileId } = body
    if (!projectNo || !fileId) return res.status(400).json({ error: 'Missing projectNo/fileId' })
    const approvals = await getRamsApprovals(projectNo)
    let rec = approvals[fileId] || blankRecord()

    if (action === 'cm-approve') {
      if (rec.stage !== 'cm') return res.status(409).json({ error: 'This RAMS is past the CM stage.' })
      const { name, signatureImg } = body
      if (!name) return res.status(400).json({ error: 'Missing name' })
      if (!signatureImg) return res.status(400).json({ error: 'A signature is required' })
      rec.cm = { name, date: new Date().toISOString().slice(0, 10), signedAt: Date.now(), signatureImg }
      rec.stage = 'director'
      rec.updatedAt = Date.now()
      approvals[fileId] = rec
      await saveRamsApprovals(projectNo, approvals)
      await autoSign(projectNo, fileId, `cm:${name}`, name, signatureImg)
      try {
        const { notifyDirectorToApprove } = await import('../../lib/ramsNotify')
        const files = await getProjectFiles(projectNo)
        const f = (files || []).find(x => x.id === fileId)
        notifyDirectorToApprove({ projectNo, fileName: f?.name || '' })
      } catch {}
      return res.json({ ok: true, approval: rec })
    }

    if (action === 'director-approve') {
      // Now signed in the SITE APP by the designated RAMS Director. Verify the
      // caller's email matches the designated Director (set in Admin).
      if (rec.stage !== 'director') return res.status(409).json({ error: 'This RAMS is not awaiting Director approval.' })
      const { name, signatureImg, email } = body
      if (!name) return res.status(400).json({ error: 'Missing name' })
      if (!signatureImg) return res.status(400).json({ error: 'A signature is required' })
      const designated = (await get('ops:rams-director')) || null
      if (!designated?.email) return res.status(409).json({ error: 'No RAMS Director has been set in Admin yet.' })
      const emailMatch = (email || '').trim().toLowerCase() === designated.email.trim().toLowerCase()
      const nameMatch = !!name && !!designated.name && name.trim().toLowerCase() === designated.name.trim().toLowerCase()
      if (!emailMatch && !nameMatch) {
        return res.status(403).json({ error: 'Only the designated RAMS Director can approve at this stage.' })
      }
      rec.director = { name, date: new Date().toISOString().slice(0, 10), signedAt: Date.now(), signatureImg }
      rec.stage = 'site-manager'
      rec.updatedAt = Date.now()
      approvals[fileId] = rec
      await saveRamsApprovals(projectNo, approvals)
      await autoSign(projectNo, fileId, `director:${name}`, name, signatureImg)
      try {
        const { notifyCmToSendSiteManager } = await import('../../lib/ramsNotify')
        const files = await getProjectFiles(projectNo)
        const f = (files || []).find(x => x.id === fileId)
        notifyCmToSendSiteManager({ projectNo, fileName: f?.name || '' })
      } catch {}
      return res.json({ ok: true, approval: rec })
    }

    if (action === 'set-site-manager') {
      if (rec.stage !== 'site-manager') return res.status(409).json({ error: 'This RAMS is not at the Site Manager stage yet.' })
      const email = (body.email || '').trim()
      const smName = (body.name || '').trim()
      if (!smName) return res.status(400).json({ error: 'Site Manager name is required.' })
      if (!email || !/.+@.+\..+/.test(email)) return res.status(400).json({ error: 'A valid email address is required.' })

      // Mint a fresh token each time a recipient is set (invalidates any old link).
      const token = crypto.randomBytes(24).toString('base64url')
      rec.siteManagerEmail = email
      rec.siteManagerName = smName
      rec.token = token
      rec.updatedAt = Date.now()

      // Guard against a duplicate send (double request / retry): if we sent to
      // this same email for this file in the last 30s, don't send again.
      const now = Date.now()
      const recentlySent = rec.lastSmEmailTo === email.toLowerCase() && rec.lastSmEmailAt && (now - rec.lastSmEmailAt < 30000)

      approvals[fileId] = rec
      await saveRamsApprovals(projectNo, approvals)
      await saveRamsToken(token, { projectNo, fileId })

      let sent = false
      if (!recentlySent) {
        sent = await sendSiteManagerEmail({ req, projectNo, fileId, email, smName, token })
        rec.lastSmEmailTo = email.toLowerCase()
        rec.lastSmEmailAt = now
        approvals[fileId] = rec
        await saveRamsApprovals(projectNo, approvals)
      }
      return res.json({ ok: true, approval: rec, emailSent: sent, skipped: recentlySent })
    }

    return res.status(400).json({ error: 'Unknown action' })
  } catch (e) {
    console.error('rams-approvals error:', e)
    return res.status(500).json({ error: e.message || 'Failed' })
  }
}

async function sendSiteManagerEmail({ req, projectNo, fileId, email, smName, token }) {
  const RESEND_KEY = process.env.RESEND_API_KEY
  const FROM = process.env.FORMS_FROM_EMAIL || 'Rock Roofing <onboarding@resend.dev>'
  if (!RESEND_KEY) return false

  // The approval page is a no-login page that lives on the MAIN PORTAL domain.
  // The CM usually triggers this from the Site App (siteapp.*), whose host must
  // NOT be used or the Site Manager would hit a login wall. Always use the portal
  // domain (override with RAMS_APPROVE_ORIGIN if needed).
  const origin = process.env.RAMS_APPROVE_ORIGIN || 'https://app.rockroofing.co.uk'
  const approveUrl = `${origin}/rams-approve?token=${encodeURIComponent(token)}`

  let projName = projectNo
  try { const p = await getOpsProject(projectNo); if (p?.data?.projectName) projName = `${projectNo} — ${p.data.projectName}` } catch {}

  // Attach the current RAMS PDF (fetch the file record for its URL).
  let attachments = []
  try {
    const { getProjectFiles } = await import('../../lib/db')
    const files = await getProjectFiles(projectNo)
    const f = (files || []).find(x => x.id === fileId)
    if (f?.url) {
      const r = await fetch(f.url)
      if (r.ok) {
        const buf = Buffer.from(await r.arrayBuffer())
        attachments = [{ filename: f.name || 'RAMS.pdf', content: buf.toString('base64') }]
      }
    }
  } catch {}

  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;color:#1a1a19">
      <h2 style="color:#1a1a19">RAMS approval requested</h2>
      <p style="font-size:15px">Hi ${smName ? smName.split(' ')[0] : 'there'},</p>
      <p style="font-size:15px">Rock Roofing has prepared the RAMS (Risk Assessment &amp; Method Statement) for
        <strong>${projName}</strong> and would like your approval as the customer's Site Manager.</p>
      <p style="font-size:15px">The RAMS document is attached to this email. Please review it, then click below to approve:</p>
      <p style="text-align:center;margin:28px 0">
        <a href="${approveUrl}" style="background:#ca8a04;color:#fff;text-decoration:none;padding:14px 28px;border-radius:10px;font-weight:600;font-size:16px;display:inline-block">Review &amp; approve RAMS</a>
      </p>
      <p style="font-size:13px;color:#777">This link is unique to you — please don't forward it. If you weren't expecting this, you can ignore this email.</p>
    </div>`

  try {
    const payload = { from: FROM, to: email, subject: `RAMS approval requested — ${projName}`, html }
    if (attachments.length) payload.attachments = attachments
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    return resp.ok
  } catch { return false }
}

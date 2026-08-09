import crypto from 'crypto'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { get, set } from './db'
import { put } from '@vercel/blob'

// Append-only audit log of every approval (and supersede) event. This is deliberately a
// SEPARATE store from the drawing/tech-sub records, so that even if a drawing is later
// edited or deleted, the evidence that it was approved survives. Entries are only ever
// appended - nothing here is edited or removed.
//   design:approval-audit:<projectNo> = [ entry, ... ]  (newest last)
const AUDIT_KEY = (no) => `design:approval-audit:${no}`

const INK = rgb(0.1, 0.1, 0.1)
const GREY = rgb(0.45, 0.45, 0.45)
const GREEN = rgb(0.08, 0.5, 0.2)
const PURPLE = rgb(0.486, 0.227, 0.929)

// SHA-256 of the actual file bytes, so we can prove WHICH version was approved.
export async function hashFileAtUrl(url) {
  try {
    const r = await fetch(url)
    if (!r.ok) return ''
    const buf = Buffer.from(await r.arrayBuffer())
    return 'sha256:' + crypto.createHash('sha256').update(buf).digest('hex')
  } catch { return '' }
}

// Append an approval event to the immutable audit log. Returns the stored entry.
export async function recordApprovalEvent(projectNo, entry) {
  const key = AUDIT_KEY(projectNo)
  const log = (await get(key)) || []
  const full = {
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    ts: Date.now(),
    ...entry,
  }
  log.push(full)
  await set(key, log)
  return full
}

export async function getApprovalAudit(projectNo) {
  return (await get(AUDIT_KEY(projectNo))) || []
}

// Build a timestamped approval CERTIFICATE PDF for one approval event.
export async function buildApprovalCertificate({ kind, projectNo, projectName, item, revision, fileName, fileHash, approver, atText, ts, eventId }) {
  const A4 = [595.28, 841.89]
  const M = 54
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const page = pdf.addPage(A4)
  const W = A4[0], H = A4[1]
  let y = H - M

  const text = (s, { f = font, size = 10, color = INK, x = M, gap = 6 } = {}) => { page.drawText(String(s == null ? '' : s), { x, y: y - size, size, font: f, color }); y -= size + gap }
  const wrapText = (s, { f = font, size = 10, color = INK, x = M, maxW = W - M * 2, gap = 4 } = {}) => {
    const words = String(s == null ? '' : s).split(/\s+/); let line = ''
    const flush = () => { if (line) { page.drawText(line, { x, y: y - size, size, font: f, color }); y -= size + gap; line = '' } }
    for (const w of words) { const t = line ? line + ' ' + w : w; if (f.widthOfTextAtSize(t, size) > maxW) { flush(); line = w } else line = t }
    flush()
  }

  // Header
  page.drawRectangle({ x: 0, y: H - 8, width: W, height: 8, color: PURPLE })
  text('Rock Roofing Ltd', { f: bold, size: 16 })
  text('Digital Approval Certificate', { f: bold, size: 20, color: PURPLE, gap: 4 })
  text(kind === 'tech-sub' ? 'Technical Submittal' : kind === 'calculation' ? 'Calculation' : 'Drawing', { size: 11, color: GREY, gap: 16 })

  // Big confirmation line
  text('This document certifies that the item below was formally approved.', { size: 11, gap: 14 })

  const row = (label, value, opts = {}) => {
    const lx = M, vx = M + 150
    page.drawText(label, { x: lx, y: y - 11, size: 10, font: bold, color: GREY })
    const words = String(value == null || value === '' ? '-' : value)
    // simple wrap for value column
    const maxW = W - vx - M
    const parts = words.split(/\s+/); let line = ''; let first = true
    const flush = () => { if (line) { page.drawText(line, { x: vx, y: y - 11, size: 10, font: opts.f || font, color: opts.color || INK }); y -= 16; line = ''; first = false } }
    for (const w of parts) { const t = line ? line + ' ' + w : w; if ((opts.f || font).widthOfTextAtSize(t, 10) > maxW) { flush() } line = line ? line + ' ' + w : w }
    flush()
    y -= 4
  }

  page.drawRectangle({ x: M - 10, y: y - 6, width: W - (M - 10) * 2, height: 2, color: rgb(0.9, 0.9, 0.9) })
  y -= 16

  row('Project', `${projectName || ''} ${projectName && projectNo ? '(' + projectNo + ')' : projectNo || ''}`.trim())
  row('Item', item)
  row('Revision', revision ? `Rev ${revision}` : '-')
  row('File', fileName)
  row('File fingerprint', fileHash || '(not captured)', { f: font, color: GREY })
  y -= 6
  page.drawRectangle({ x: M - 10, y: y - 6, width: W - (M - 10) * 2, height: 2, color: rgb(0.9, 0.9, 0.9) })
  y -= 16

  text('Approved by', { f: bold, size: 12, color: GREEN, gap: 8 })
  row('Name', approver.name)
  row('Company', approver.company)
  row('Role', approver.role || 'Customer')
  row('Email', approver.email)
  row('Phone', approver.phone)
  row('Account ID', approver.userId, { color: GREY })
  y -= 6
  page.drawRectangle({ x: M - 10, y: y - 6, width: W - (M - 10) * 2, height: 2, color: rgb(0.9, 0.9, 0.9) })
  y -= 16

  row('Approved at', atText, { f: bold })
  row('Timestamp (UTC ms)', String(ts), { color: GREY })
  row('Certificate ref', eventId, { color: GREY })

  y -= 20
  wrapText('This certificate was generated automatically by the Rock Roofing Design Portal at the moment of approval. The file fingerprint (SHA-256) identifies the exact version of the file that was approved; any change to the file would produce a different fingerprint. A corresponding entry is held in the portal\'s append-only approval audit log.', { size: 8.5, color: GREY, gap: 3 })

  // Footer
  page.drawText('Rock Roofing Ltd - Digital Approval Certificate', { x: M, y: M - 20, size: 8, font, color: GREY })

  return await pdf.save()
}

// Generate the certificate, upload it to Blob, and return its URL (best-effort).
export async function generateAndStoreCertificate(payload) {
  try {
    const bytes = await buildApprovalCertificate(payload)
    const safe = `${payload.projectNo}-${(payload.item || 'item').replace(/[^\w.\- ]+/g, '_')}-Rev${payload.revision || ''}-approval-${payload.eventId}.pdf`
    const blob = await put(`approvals/${safe}`, Buffer.from(bytes), { access: 'public', contentType: 'application/pdf', addRandomSuffix: true })
    return blob.url
  } catch (e) { return '' }
}

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

const A4 = [595.28, 841.89]
const M = 48
const GOLD = rgb(0.79, 0.54, 0.02)
const INK = rgb(0.1, 0.1, 0.1)
const GREY = rgb(0.5, 0.5, 0.5)
const GREEN = rgb(0.06, 0.55, 0.25)
const RED = rgb(0.72, 0.11, 0.11)
const LINE = rgb(0.85, 0.85, 0.85)

const fmtDateTime = (ms) => {
  if (!ms) return '—'
  try {
    return new Date(ms).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    })
  } catch { return '—' }
}
const fmtDMY = (d) => { if (!d) return '—'; const [y, m, day] = String(d).split('-'); return day ? `${day}/${m}/${y}` : d }

// Build the fully-signed RAMS: the original document with an appended audit trail
// (approval workflow + every signature with name, date/time and signature image).
//
// Args:
//   ramsBytes   Uint8Array of the original RAMS PDF (may be null if unreadable)
//   fileName    original filename
//   project     { projectNo, projectName }
//   approval    ops:rams-approvals record for this file (cm, director, siteManager,
//               siteManagerRejection, stage, startedAt, updatedAt)
//   signatures  { [opId]: { name, date, signedAt, statement, signatureImg, role } }
//   logoUrl     optional
export async function buildSignedRamsPDF({ ramsBytes, fileName, project, approval, signatures, logoUrl }) {
  const out = await PDFDocument.create()
  const font = await out.embedFont(StandardFonts.Helvetica)
  const bold = await out.embedFont(StandardFonts.HelveticaBold)
  const italic = await out.embedFont(StandardFonts.HelveticaOblique)

  // 1) Copy the original RAMS pages in first (if we could read it).
  let originalPages = 0
  if (ramsBytes) {
    try {
      const src = await PDFDocument.load(ramsBytes, { ignoreEncryption: true })
      const copied = await out.copyPages(src, src.getPageIndices())
      copied.forEach(p => out.addPage(p))
      originalPages = copied.length
    } catch { originalPages = 0 }
  }

  // 2) Append the audit-trail page(s).
  let page = out.addPage(A4)
  let y = A4[1] - M
  const width = A4[0] - M * 2

  let logoImg = null
  if (logoUrl) { try { const b = new Uint8Array(await (await fetch(logoUrl)).arrayBuffer()); logoImg = /\.png$/i.test(logoUrl) ? await out.embedPng(b) : await out.embedJpg(b) } catch {} }

  const newPage = () => { page = out.addPage(A4); y = A4[1] - M }
  const ensure = (h) => { if (y - h < M) newPage() }
  // WinAnsi (Helvetica) can't encode ✓/✗, so draw markers instead.
  const marker = (state) => {
    // state: 'done' | 'no' | 'pending' — drawn at the current line, left margin.
    const cy = y - 9
    if (state === 'done') { page.drawCircle({ x: M + 5, y: cy, size: 5, color: GREEN }) }
    else if (state === 'no') { page.drawCircle({ x: M + 5, y: cy, size: 5, color: RED }) }
    else { page.drawCircle({ x: M + 5, y: cy, size: 5, borderColor: GREY, borderWidth: 1 }) }
  }
  const wrap = (text, size, f) => {
    const words = String(text ?? '').split(/\s+/); const lines = []; let line = ''
    for (const w of words) { const t = line ? line + ' ' + w : w; if (f.widthOfTextAtSize(t, size) > width) { if (line) lines.push(line); line = w } else line = t }
    if (line) lines.push(line); return lines.length ? lines : ['']
  }
  const text = (t, { f = font, size = 10, color = INK, indent = 0, gap = 4 } = {}) => {
    for (const line of wrap(t, size, f)) { ensure(size + gap); page.drawText(line, { x: M + indent, y: y - size, size, font: f, color }); y -= size + gap }
  }
  const gap = (n = 6) => { y -= n }
  const heading = (t) => { gap(8); ensure(22); page.drawText(t.toUpperCase(), { x: M, y: y - 12, size: 11, font: bold, color: GOLD }); y -= 18; page.drawLine({ start: { x: M, y }, end: { x: A4[0] - M, y }, thickness: 0.6, color: LINE }); gap(8) }

  // Header
  const lh = 40
  if (logoImg) page.drawImage(logoImg, { x: M, y: y - lh, width: lh, height: lh })
  page.drawText('RAMS — Signature & Approval Record', { x: M + (logoImg ? 56 : 0), y: y - 24, size: 18, font: bold, color: INK })
  y -= lh + 6
  page.drawLine({ start: { x: M, y }, end: { x: A4[0] - M, y }, thickness: 1, color: GOLD }); gap(12)

  text(`${project.projectName || ''}${project.projectNo ? ` — ${project.projectNo}` : ''}`, { f: bold, size: 13 })
  text(`Document: ${fileName || 'RAMS'}`, { color: GREY, size: 9.5 })
  text(`Generated: ${fmtDateTime(Date.now())}`, { color: GREY, size: 9.5 })
  if (!originalPages) text('(The original RAMS PDF could not be embedded automatically — this record documents the approvals and signatures for it.)', { color: RED, size: 9, f: italic })

  // Overall status
  gap(4); ensure(26)
  const complete = approval?.stage === 'complete' || approval?.stage === 'operatives'
  const rejected = approval?.stage === 'rejected'
  const pillC = rejected ? RED : complete ? GREEN : GOLD
  const label = rejected ? 'STATUS: EDITS REQUIRED (NOT APPROVED)' : `STATUS: ${String(approval?.stage || 'in progress').toUpperCase()}`
  page.drawRectangle({ x: M, y: y - 22, width: 260, height: 22, borderColor: pillC, borderWidth: 1 })
  page.drawText(label, { x: M + 8, y: y - 15, size: 9.5, font: bold, color: pillC })
  y -= 30

  // ── Approval chain ──
  heading('Approval workflow')

  async function drawSig(dataUrl) {
    try {
      const m = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(dataUrl || '')
      if (!m) return
      const bytes = Uint8Array.from(Buffer.from(m[2], 'base64'))
      const img = /png/i.test(m[1]) ? await out.embedPng(bytes) : await out.embedJpg(bytes)
      const w = 150, h = (img.height / img.width) * w
      ensure(h + 6)
      page.drawImage(img, { x: M + 18, y: y - h, width: w, height: Math.min(h, 60) })
      y -= Math.min(h, 60) + 6
    } catch {}
  }

  // These are awaited sequentially so signature images embed in order.
  await (async () => {
    // CM
    { const rec = approval?.cm
      ensure(64)
      marker(rec ? 'done' : 'pending')
      page.drawText('1. Contracts Manager', { x: M + 18, y: y - 11, size: 11, font: bold, color: INK }); y -= 16
      if (rec) { text(`Name: ${rec.name || '—'}`, { indent: 18, size: 9.5, color: GREY, gap: 3 }); text(`Signed: ${fmtDateTime(rec.signedAt)}`, { indent: 18, size: 9.5, color: GREY, gap: 3 }); if (rec.signatureImg) await drawSig(rec.signatureImg) }
      else text('Not yet completed', { indent: 18, size: 9.5, color: GREY, gap: 3 })
      gap(6)
    }
    // Director
    { const rec = approval?.director
      ensure(64)
      marker(rec ? 'done' : 'pending')
      page.drawText('2. Director', { x: M + 18, y: y - 11, size: 11, font: bold, color: INK }); y -= 16
      if (rec) { text(`Name: ${rec.name || '—'}`, { indent: 18, size: 9.5, color: GREY, gap: 3 }); text(`Signed: ${fmtDateTime(rec.signedAt)}`, { indent: 18, size: 9.5, color: GREY, gap: 3 }); if (rec.signatureImg) await drawSig(rec.signatureImg) }
      else text('Not yet completed', { indent: 18, size: 9.5, color: GREY, gap: 3 })
      gap(6)
    }
    // Site Manager (customer) — typed approval, no signature image
    { const rec = approval?.siteManager, rej = approval?.siteManagerRejection
      ensure(60)
      const ok = !!rec
      marker(ok ? 'done' : (rej ? 'no' : 'pending'))
      page.drawText('3. Customer Site Manager', { x: M + 18, y: y - 11, size: 11, font: bold, color: INK }); y -= 16
      if (ok) {
        text(`Name: ${rec.name || approval?.siteManagerName || '—'}`, { indent: 18, size: 9.5, color: GREY, gap: 3 })
        if (approval?.siteManagerEmail) text(`Email: ${approval.siteManagerEmail}`, { indent: 18, size: 9.5, color: GREY, gap: 3 })
        text(`Approved: ${fmtDateTime(rec.signedAt)}`, { indent: 18, size: 9.5, color: GREY, gap: 3 })
        text('Approved online via a secure, tokenised link (no login).', { indent: 18, size: 8.5, color: GREY, f: italic, gap: 3 })
      } else if (rej) {
        text(`Not approved — edits requested by ${rej.name || approval?.siteManagerName || 'Site Manager'} on ${fmtDateTime(rej.at)}`, { indent: 18, size: 9.5, color: RED, gap: 3 })
        if (rej.notes) text(`Comments: ${rej.notes}`, { indent: 18, size: 9.5, color: RED, gap: 3 })
      } else {
        text(approval?.siteManagerName ? `Allocated: ${approval.siteManagerName}${approval.siteManagerEmail ? ` (${approval.siteManagerEmail})` : ''} — awaiting approval` : 'Not yet completed', { indent: 18, size: 9.5, color: GREY, gap: 3 })
      }
      gap(6)
    }
  })()

  // ── Operative signatures ──
  const opEntries = Object.entries(signatures || {})
    .filter(([opId, r]) => !(opId.startsWith('cm:') || opId.startsWith('director:') || r.role === 'Contracts Manager' || r.role === 'Director'))
    .map(([opId, r]) => r)
    .sort((a, b) => (a.signedAt || 0) - (b.signedAt || 0))

  heading(`Operative signatures (${opEntries.length})`)
  if (!opEntries.length) {
    text('No operatives have signed onto this RAMS yet.', { color: GREY, size: 9.5 })
  } else {
    // The statement they all agreed to (shown once).
    const stmt = opEntries.find(o => o.statement)?.statement
    if (stmt) { text('Each operative confirmed the following on signing:', { size: 9, color: GREY, f: italic, gap: 3 }); text(`"${stmt}"`, { size: 8.5, color: GREY, f: italic }); gap(6) }
    for (const o of opEntries) {
      ensure(78)
      marker('done')
      page.drawText(o.name || '—', { x: M + 18, y: y - 11, size: 11, font: bold, color: INK }); y -= 16
      text(`Signed: ${fmtDateTime(o.signedAt)}${o.date ? `  (dated ${fmtDMY(o.date)})` : ''}`, { indent: 18, size: 9.5, color: GREY, gap: 3 })
      if (o.signatureImg) {
        try {
          const m = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(o.signatureImg)
          if (m) {
            const bytes = Uint8Array.from(Buffer.from(m[2], 'base64'))
            const img = /png/i.test(m[1]) ? await out.embedPng(bytes) : await out.embedJpg(bytes)
            const w = 150, h = Math.min((img.height / img.width) * w, 55)
            ensure(h + 6)
            page.drawImage(img, { x: M + 18, y: y - h, width: w, height: h })
            y -= h + 6
          }
        } catch {}
      }
      page.drawLine({ start: { x: M, y: y - 2 }, end: { x: A4[0] - M, y: y - 2 }, thickness: 0.4, color: LINE })
      gap(10)
    }
  }

  // Footer note on every page
  const pages = out.getPages()
  pages.forEach((p, i) => {
    p.drawText(`Rock Roofing — RAMS signature record · Page ${i + 1} of ${pages.length} · Generated ${fmtDateTime(Date.now())}`,
      { x: M, y: 24, size: 7.5, font, color: GREY })
  })

  return await out.save()
}

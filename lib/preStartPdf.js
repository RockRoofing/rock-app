import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { PRESTART_SECTIONS } from './preStartSchema'

// Builds the Pre-Start Meeting Minutes as a real PDF (Uint8Array) server-side,
// so it can be emailed as an attachment. Embeds uploaded drawing PDFs as
// viewable pages, and appends a timestamped send-proof page when provided.

const GOLD = rgb(0.79, 0.54, 0.02)
const INK = rgb(0.1, 0.1, 0.1)
const GREY = rgb(0.5, 0.5, 0.5)
const A4 = [595.28, 841.89]
const M = 48 // margin

async function fetchBytes(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`fetch ${url} -> ${r.status}`)
  return new Uint8Array(await r.arrayBuffer())
}

export async function buildPreStartPDF({ project, data, logoUrl, proof }) {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)

  let page = pdf.addPage(A4)
  let y = A4[1] - M

  // Try to embed the logo (jpg/png)
  let logoImg = null
  if (logoUrl) {
    try {
      const bytes = await fetchBytes(logoUrl)
      logoImg = /\.png$/i.test(logoUrl) ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes)
    } catch {}
  }

  const newPage = () => { page = pdf.addPage(A4); y = A4[1] - M }
  const ensure = (h) => { if (y - h < M) newPage() }

  const wrap = (text, f, size, maxW) => {
    const words = String(text ?? '').replace(/\r/g, '').split(/\n/).flatMap((line, i, arr) => {
      const w = line.split(' ')
      const out = []; let cur = ''
      for (const word of w) {
        const test = cur ? cur + ' ' + word : word
        if (f.widthOfTextAtSize(test, size) > maxW && cur) { out.push(cur); cur = word } else cur = test
      }
      if (cur) out.push(cur)
      if (i < arr.length - 1) out.push('') // preserve blank lines
      return out.length ? out : ['']
    })
    return words
  }
  const drawText = (text, { f = font, size = 10, color = INK, indent = 0, gap = 4 } = {}) => {
    const maxW = A4[0] - M * 2 - indent
    for (const line of wrap(text, f, size, maxW)) {
      ensure(size + gap)
      page.drawText(line, { x: M + indent, y: y - size, size, font: f, color })
      y -= size + gap
    }
  }
  const rule = (color = GOLD, thickness = 2) => { ensure(10); page.drawLine({ start: { x: M, y }, end: { x: A4[0] - M, y }, thickness, color }); y -= 12 }
  const gap = (h = 8) => { y -= h }

  // ── Header ──
  if (logoImg) {
    const lw = 46, lh = (logoImg.height / logoImg.width) * lw
    page.drawImage(logoImg, { x: M, y: y - lh, width: lw, height: lh })
  }
  page.drawText('Pre-Start Meeting Minutes', { x: M + (logoImg ? 60 : 0), y: y - 22, size: 20, font: bold, color: INK })
  y -= 34
  drawText(`${project?.projectName || ''}${project?.projectNo ? ` — ${project.projectNo}` : ''}`, { f: bold, size: 12 })
  if (data?.meetingDate) drawText(`Date of Meeting: ${data.meetingDate}`, { color: GREY, size: 9.5 })
  if (data?.completedBy) drawText(`Completed by: ${data.completedBy}`, { color: GREY, size: 9.5 })
  drawText(`Status: ${data?.stage === 'sent' ? 'SENT' : 'DRAFT'}`, { color: GREY, size: 9.5 })
  gap(4); rule()

  const resolvedLabel = (r) => r === 'Y' ? 'Resolved' : r === 'N' ? 'Outstanding' : r === 'NA' ? 'N/A' : '—'

  // ── Sections ──
  for (const sec of PRESTART_SECTIONS) {
    ensure(30)
    gap(6)
    drawText(sec.title.toUpperCase(), { f: bold, size: 11, color: GOLD })
    gap(2)

    for (const f of sec.fields) {
      const v = data?.[f.id]
      if (f.type === 'qrow') {
        const val = v || {}
        drawText(f.label, { f: bold, size: 9.5 })
        drawText(`[${resolvedLabel(val.resolved)}]  ${val.comments || '—'}`, { size: 9.5, indent: 8, color: val.comments ? INK : GREY })
        gap(3)
      } else if (f.type === 'files') {
        // handled via embedded pages later; just note names here
        const own = Array.isArray(v) ? v : []
        if (own.length) drawText('Documents: ' + own.map(x => x.name).join(', '), { size: 9, color: GREY })
      } else if (f.type === 'attendeesRock' || f.type === 'attendees') {
        const rows = Array.isArray(v) ? v : []
        if (rows.length) {
          drawText(f.label, { f: bold, size: 9.5 })
          for (const r of rows) drawText('• ' + [r.role, r.name, r.email, r.phone].filter(Boolean).join(' · '), { size: 9.5, indent: 8 })
          gap(2)
        }
      } else if (f.type === 'team' || f.type === 'text' || f.type === 'long' || f.type === 'date') {
        if (v) { drawText(f.label + ':', { f: bold, size: 9.5 }); drawText(String(v), { size: 9.5, indent: 8 }); gap(2) }
      }
    }

    // Custom rows for this section
    const custom = (data?.customRows && data.customRows[sec.id]) || []
    for (const r of custom) {
      if (!r.label && !r.comments) continue
      drawText(r.label || '(item)', { f: bold, size: 9.5 })
      drawText(`[${resolvedLabel(r.resolved)}]  ${r.comments || '—'}`, { size: 9.5, indent: 8, color: r.comments ? INK : GREY })
      gap(3)
    }
  }

  // ── Embed uploaded drawing PDFs / images as viewable pages ──
  const scopeFiles = Array.isArray(data?.scopeFiles) ? data.scopeFiles : []
  const ihmFiles = Array.isArray(project?.scopeFiles) ? project.scopeFiles : []
  const allDocs = [...scopeFiles, ...ihmFiles]
  for (const f of allDocs) {
    try {
      const isPdf = /\.pdf$/i.test(f.name || f.url || '') || (f.type || '') === 'application/pdf'
      const isImg = (f.type || '').startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(f.name || f.url || '')
      if (isPdf) {
        const bytes = await fetchBytes(f.url)
        const src = await PDFDocument.load(bytes, { ignoreEncryption: true })
        const pages = await pdf.copyPages(src, src.getPageIndices())
        // Section separator page label
        const sep = pdf.addPage(A4); sep.drawText(`Attached: ${f.name || 'Document'}`, { x: M, y: A4[1] - M - 14, size: 12, font: bold, color: INK })
        for (const p of pages) pdf.addPage(p)
      } else if (isImg) {
        const bytes = await fetchBytes(f.url)
        const img = /\.png$/i.test(f.name || f.url || '') ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes)
        const ip = pdf.addPage(A4)
        ip.drawText(`Attached: ${f.name || 'Image'}`, { x: M, y: A4[1] - M - 14, size: 12, font: bold, color: INK })
        const maxW = A4[0] - M * 2, maxH = A4[1] - M * 2 - 30
        const scale = Math.min(maxW / img.width, maxH / img.height, 1)
        const w = img.width * scale, h = img.height * scale
        ip.drawImage(img, { x: (A4[0] - w) / 2, y: (A4[1] - M - 30 - h), width: w, height: h })
      }
    } catch (e) { /* skip unembeddable doc */ }
  }

  // ── Send-proof page ──
  if (proof) {
    const pp = pdf.addPage(A4)
    let py = A4[1] - M
    pp.drawText('Delivery Record', { x: M, y: py - 20, size: 18, font: bold, color: INK }); py -= 40
    pp.drawLine({ start: { x: M, y: py }, end: { x: A4[0] - M, y: py }, thickness: 2, color: GOLD }); py -= 20
    const line = (t, f = font, s = 10, c = INK) => { pp.drawText(t, { x: M, y: py - s, size: s, font: f, color: c }); py -= s + 6 }
    line(`Sent: ${proof.sentAt ? new Date(proof.sentAt).toLocaleString('en-GB') : '—'}`, bold, 11)
    if (proof.sentBy) line(`Sent by: ${proof.sentBy}`)
    line('Recipients:', bold, 10)
    for (const r of (proof.recipients || [])) {
      const st = proof.statuses && proof.statuses[r.email] ? proof.statuses[r.email] : 'sent'
      line(`   • ${r.name ? r.name + ' — ' : ''}${r.email}   [${st}]`, font, 10, GREY)
    }
    py -= 8
    line('This page is an automated record that the document was issued via email to the', font, 8.5, GREY)
    line('above recipients at the time stated. Delivery status is reported by the email provider.', font, 8.5, GREY)
  }

  return await pdf.save()
}

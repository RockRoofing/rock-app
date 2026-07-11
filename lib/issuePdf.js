import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

const A4 = [595.28, 841.89]
const M = 48
const GOLD = rgb(0.79, 0.54, 0.02)
const INK = rgb(0.1, 0.1, 0.1)
const GREY = rgb(0.5, 0.5, 0.5)

export async function buildIssuePDF({ issue, project, logoUrl }) {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  let page = pdf.addPage(A4)
  let y = A4[1] - M

  let logoImg = null
  if (logoUrl) {
    try {
      const bytes = new Uint8Array(await (await fetch(logoUrl)).arrayBuffer())
      logoImg = /\.png$/i.test(logoUrl) ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes)
    } catch {}
  }

  const width = A4[0] - M * 2
  const newPage = () => { page = pdf.addPage(A4); y = A4[1] - M }
  const ensure = (h) => { if (y - h < M) newPage() }
  const wrap = (text, size, f) => {
    const words = String(text || '').split(/\s+/)
    const lines = []; let line = ''
    for (const w of words) {
      const t = line ? line + ' ' + w : w
      if (f.widthOfTextAtSize(t, size) > width) { if (line) lines.push(line); line = w } else line = t
    }
    if (line) lines.push(line)
    return lines.length ? lines : ['']
  }
  const drawText = (text, { f = font, size = 10, color = INK, indent = 0, gap = 4 } = {}) => {
    for (const line of wrap(text, size, f)) {
      ensure(size + gap)
      page.drawText(line, { x: M + indent, y: y - size, size, font: f, color })
      y -= size + gap
    }
  }
  const gap = (n = 6) => { y -= n }

  // Header
  const lh = 40, lw = 40
  if (logoImg) page.drawImage(logoImg, { x: M, y: y - lh, width: lw, height: lh })
  page.drawText('Site Issue Report', { x: M + (logoImg ? 56 : 0), y: y - 24, size: 20, font: bold, color: INK })
  y -= lh + 8
  page.drawLine({ start: { x: M, y }, end: { x: A4[0] - M, y }, thickness: 1, color: GOLD })
  gap(14)

  drawText(`${project?.projectName || issue.projectName || ''}${issue.projectNo ? ` — ${issue.projectNo}` : ''}`, { f: bold, size: 13 })
  if (issue.projectAddress) drawText(issue.projectAddress, { color: GREY, size: 9.5 })
  if (issue.issueId) drawText(`Issue ID: ${issue.issueId}`, { color: GREY, size: 9.5 })
  if (issue.createdBy) drawText(`Raised by: ${issue.createdBy}`, { color: GREY, size: 9.5 })
  if (issue.createdAt) drawText(`Date raised: ${new Date(issue.createdAt).toLocaleDateString('en-GB')}`, { color: GREY, size: 9.5 })
  gap(10)

  drawText('ISSUE', { f: bold, size: 11, color: GOLD }); gap(2)
  drawText(issue.issueName || '', { f: bold, size: 12 }); gap(4)

  const types = [...(issue.issueTypes || [])]
  if (issue.issueOther) types.push(`Other: ${issue.issueOther}`)
  if (types.length) { drawText('Type:', { f: bold, size: 9.5 }); drawText(types.join(', '), { size: 10, indent: 8 }); gap(4) }

  drawText('Description:', { f: bold, size: 9.5 })
  drawText(issue.description || '—', { size: 10, indent: 8 })
  gap(12)

  // Photos
  const photos = (issue.photos || []).filter(p => typeof p === 'string' && /^https?:|^data:/.test(p))
  if (photos.length) {
    drawText('PHOTOS', { f: bold, size: 11, color: GOLD }); gap(6)
    for (const p of photos) {
      try {
        let bytes
        if (p.startsWith('data:')) {
          const b64 = p.split(',')[1]; bytes = Uint8Array.from(Buffer.from(b64, 'base64'))
        } else {
          bytes = new Uint8Array(await (await fetch(p)).arrayBuffer())
        }
        let img
        try { img = await pdf.embedJpg(bytes) } catch { img = await pdf.embedPng(bytes) }
        const maxW = width, maxH = 300
        let iw = img.width, ih = img.height
        const scale = Math.min(maxW / iw, maxH / ih, 1)
        iw = iw * scale; ih = ih * scale
        ensure(ih + 10)
        page.drawImage(img, { x: M, y: y - ih, width: iw, height: ih })
        y -= ih + 12
      } catch (e) { /* skip bad image */ }
    }
  }

  return await pdf.save()
}

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

// THE INTERNAL HANDOVER MINUTES, AS A PDF.
//
// Built from the SAME schema the form renders from, not from a hand-written list of
// fields. A field added to lib/ihmSchema.js - or to the custom template in
// admin/templates - appears here on its own. A separate list would go stale the first
// time somebody added a question, and nobody would notice until a handover went out
// missing a section.
//
// Empty fields are kept, not skipped. This is a record of a meeting: "Warranty period
// confirmed - not answered" is a finding. Silently dropping it reads as though the
// question was never asked.

const A4 = [595.28, 841.89]
const M = 40
const INK = rgb(0.10, 0.10, 0.18)
const GREY = rgb(0.45, 0.45, 0.48)
const LINE = rgb(0.85, 0.85, 0.87)
const GOLD = rgb(0.62, 0.48, 0.15)

// Strip anything WinAnsi cannot encode. pdf-lib throws on the rest, and a smart quote
// pasted out of Word should not fail a download.
const san = (s) => String(s == null ? '' : s)
  .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
  .replace(/[\u201C\u201D\u201E]/g, '"')
  .replace(/[\u2013\u2014]/g, '-')
  .replace(/\u2026/g, '...')
  .replace(/[^\x20-\x7E\n]/g, '')

function wrap(text, font, size, maxW) {
  const out = []
  for (const para of san(text).split(/\r?\n/)) {
    const words = para.split(/\s+/).filter(Boolean)
    if (!words.length) { out.push(''); continue }
    let line = ''
    for (const w of words) {
      const test = line ? `${line} ${w}` : w
      if (font.widthOfTextAtSize(test, size) <= maxW) { line = test; continue }
      if (line) out.push(line)
      let rest = w
      while (font.widthOfTextAtSize(rest, size) > maxW) {
        let cut = rest.length
        while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > maxW) cut--
        out.push(rest.slice(0, cut)); rest = rest.slice(cut)
      }
      line = rest
    }
    if (line) out.push(line)
  }
  return out.length ? out : ['']
}

const dmy = (v) => {
  if (!v) return ''
  const d = new Date(v)
  return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString('en-GB')
}

// Turn whatever is stored for a field into lines of text. The repeatable types -
// contacts, roof types, the risk log, checklists - each have their own shape.
function valueLines(field, value) {
  const t = field.type
  if (value == null || value === '') return ['-']

  if (t === 'date') return [dmy(value)]

  if (t === 'checklist') {
    if (typeof value !== 'object') return [String(value)]
    const items = Array.isArray(field.items) ? field.items : Object.keys(value)
    return items.map(it => `${it}: ${value[it] || 'not answered'}`)
  }

  if (t === 'contacts') {
    if (!Array.isArray(value) || !value.length) return ['-']
    return value.map(c => [c.name, c.role, c.company, c.phone, c.email].filter(Boolean).join('  |  ') || '-')
  }

  if (t === 'risklog') {
    if (!Array.isArray(value) || !value.length) return ['-']
    return value.map((r, i) => `${i + 1}. ${[r.risk, r.mitigation, r.owner].filter(Boolean).join('  |  ') || '-'}`)
  }

  if (t === 'rooftypes') {
    if (!Array.isArray(value) || !value.length) return ['-']
    const out = []
    value.forEach((rt, i) => {
      out.push(`Roof type ${i + 1}${rt.name ? `: ${rt.name}` : ''}`)
      for (const [k, v] of Object.entries(rt)) {
        if (k === 'name' || v == null || v === '') continue
        out.push(`   ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
      }
    })
    return out
  }

  if (Array.isArray(value)) return value.length ? value.map(v => (typeof v === 'object' ? JSON.stringify(v) : String(v))) : ['-']
  if (typeof value === 'object') {
    const parts = Object.entries(value).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}: ${v}`)
    return parts.length ? parts : ['-']
  }
  return [String(value)]
}

export async function buildHandoverPDF({ sections, data, projectNo, projectName, logoUrl }) {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const [W, H] = A4
  const width = W - M * 2

  let page = pdf.addPage([W, H])
  let y = H - M

  const newPage = () => { page = pdf.addPage([W, H]); y = H - M }
  const need = (h) => { if (y - h < M + 24) newPage() }

  // Header.
  if (logoUrl) {
    try {
      const bytes = new Uint8Array(await (await fetch(logoUrl)).arrayBuffer())
      let img; try { img = await pdf.embedPng(bytes) } catch { img = await pdf.embedJpg(bytes) }
      const w = 74, h = img.height * (w / img.width)
      page.drawImage(img, { x: W - M - w, y: y - h + 8, width: w, height: h })
    } catch { /* a missing logo is not a reason to fail the download */ }
  }
  page.drawText('Internal Handover Minutes', { x: M, y: y - 10, size: 15, font: bold, color: INK })
  y -= 28
  page.drawText(san([projectNo, projectName].filter(Boolean).join(' - ')), { x: M, y, size: 10.5, font: bold, color: GOLD })
  y -= 14
  page.drawText(`Produced ${new Date().toLocaleDateString('en-GB')}`, { x: M, y, size: 8, font, color: GREY })
  y -= 18
  page.drawLine({ start: { x: M, y }, end: { x: M + width, y }, thickness: 0.8, color: LINE })
  y -= 18

  const LABEL_W = 168
  const VAL_X = M + LABEL_W + 8
  const VAL_W = width - LABEL_W - 8

  for (const section of (sections || [])) {
    need(40)
    page.drawText(san((section.title || '').toUpperCase()), { x: M, y, size: 10, font: bold, color: GOLD })
    y -= 6
    page.drawLine({ start: { x: M, y }, end: { x: M + width, y }, thickness: 0.6, color: LINE })
    y -= 14

    for (const field of (section.fields || [])) {
      const lines = valueLines(field, data ? data[field.id] : null)
      const labelLines = wrap(field.label || field.id, bold, 8.5, LABEL_W)
      // Wrap every value line to the value column, so a long address or a paragraph of
      // notes stays inside it rather than running across the page.
      const valueWrapped = []
      for (const l of lines) for (const w of wrap(l, font, 8.5, VAL_W)) valueWrapped.push(w)
      const rows = Math.max(labelLines.length, valueWrapped.length)
      need(rows * 11 + 6)
      const top = y
      labelLines.forEach((l, i) => page.drawText(l, { x: M, y: top - i * 11, size: 8.5, font: bold, color: INK }))
      valueWrapped.forEach((l, i) => page.drawText(l, { x: VAL_X, y: top - i * 11, size: 8.5, font, color: l === '-' ? GREY : INK }))
      y = top - rows * 11 - 5
    }
    y -= 8
  }

  // Page numbers, added at the end because the count is not known until now.
  const pages = pdf.getPages()
  pages.forEach((p, i) => {
    p.drawText(`Page ${i + 1} of ${pages.length}`, { x: M, y: 22, size: 7.5, font, color: GREY })
    p.drawText(san([projectNo, projectName].filter(Boolean).join(' - ')), { x: W - M - 220, y: 22, size: 7.5, font, color: GREY })
  })

  return await pdf.save()
}

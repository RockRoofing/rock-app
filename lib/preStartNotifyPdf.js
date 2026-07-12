import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

const A4 = [595.28, 841.89]
const M = 48
const GOLD = rgb(0.79, 0.54, 0.02)
const INK = rgb(0.1, 0.1, 0.1)
const GREY = rgb(0.5, 0.5, 0.5)

const fmtDate = (s) => {
  if (!s) return ''
  const [y, m, d] = String(s).split('-')
  return d ? `${d}/${m}/${y}` : String(s)
}

// Format an answer value for display, using the field definition where helpful.
function formatAnswer(field, value) {
  if (value == null || value === '') return ''
  if (Array.isArray(value)) {
    // members / multi-select / photos
    if (field?.type === 'photos') return `${value.length} photo${value.length !== 1 ? 's' : ''} attached`
    return value.map(v => (typeof v === 'object' ? (v.name || '') : v)).filter(Boolean).join(', ')
  }
  if (typeof value === 'object') return value.name || ''   // signature
  if (field?.type === 'date') return fmtDate(value)
  return String(value)
}

// Build a branded Pre-Start Notification PDF from a form submission.
//   submission: { formTitle, projectName, operative, submittedAt, answers }
//   form:       the form definition (fields[] with id/type/label/section)
//   project:    ops project data (for name/address)
export async function buildPsnPDF({ submission, form, project, logoUrl }) {
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
  page.drawText('Pre-Start Notification', { x: M + (logoImg ? 56 : 0), y: y - 24, size: 20, font: bold, color: INK })
  y -= lh + 8
  page.drawLine({ start: { x: M, y }, end: { x: A4[0] - M, y }, thickness: 1, color: GOLD })
  gap(14)

  const projName = project?.projectName || submission.projectName || ''
  drawText(projName, { f: bold, size: 13 })
  if (project?.projectAddress || project?.siteLocation) drawText(project.projectAddress || project.siteLocation, { color: GREY, size: 9.5 })
  if (submission.operative) drawText(`Prepared by: ${submission.operative}`, { color: GREY, size: 9.5 })
  if (submission.submittedAt) drawText(`Date: ${new Date(submission.submittedAt).toLocaleDateString('en-GB')}`, { color: GREY, size: 9.5 })
  gap(12)

  // Body — walk the form fields in order. Sections become headings; notes are
  // shown as guidance text; question/answer pairs are rendered with real labels.
  const fields = form?.fields || []
  const answers = submission.answers || {}

  if (!fields.length) {
    // Fallback: no form def — just list answers we have.
    for (const [k, v] of Object.entries(answers)) {
      const val = formatAnswer(null, v)
      if (!val) continue
      drawText(`${k}:`, { f: bold, size: 9.5 })
      drawText(val, { size: 10, indent: 8 }); gap(4)
    }
  } else {
    for (const f of fields) {
      if (f.id === 'f_4') continue // removed field (email of requester)
      if (f.type === 'section') {
        gap(6)
        drawText(f.label || '', { f: bold, size: 11.5, color: GOLD }); gap(2)
        continue
      }
      if (f.type === 'note') {
        drawText(f.label || '', { size: 8.5, color: GREY }); gap(3)
        continue
      }
      const val = formatAnswer(f, answers[f.id])
      if (val === '' && !f.required) continue
      drawText(f.label || f.id, { f: bold, size: 9.5 })
      drawText(val || '—', { size: 10, indent: 8 })
      gap(5)
    }
  }

  gap(10)
  ensure(30)
  page.drawLine({ start: { x: M, y }, end: { x: A4[0] - M, y }, thickness: 0.5, color: rgb(0.85, 0.85, 0.85) })
  gap(8)
  drawText('Rock Roofing Ltd', { f: bold, size: 9, color: GREY })

  return await pdf.save()
}

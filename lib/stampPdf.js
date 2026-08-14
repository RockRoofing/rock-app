import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib'
import { put } from '@vercel/blob'

// Bakes semi-translucent APPROVED / CONSTRUCTION ISSUE stamps onto page 1 (top-right,
// stacked) of a PDF and stores the result as a SEPARATE blob. The original file is never
// touched, so un-approving / un-flagging simply drops back to the original url.
//
// Usage in an API handler, after changing approval / construction-issue state:
//   doc.stampedUrl = await buildStampedCopy(doc, { projectNo: no })
// Consumers (viewer, download link, zip, email link) then use: doc.stampedUrl || doc.url
//
// Handles all three document shapes in the Design portal:
//   calculations / rock drawings - status:'approved' + constructionIssue:bool
//   tech subs                    - approvalStatus:'approved' (no construction issue)
//   drawings                     - status:'approved' | 'construction-issue' (exclusive)

const GREEN = rgb(0.05, 0.45, 0.18)
const BLUE = rgb(0.11, 0.35, 0.79)

// Fill / border / text opacity - readable but you can still see the drawing underneath.
const FILL_OPACITY = 0.12
const LINE_OPACITY = 0.75
const TEXT_OPACITY = 0.85

const ukDateTime = (ts) => {
  if (!ts) return ''
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(ts)).replace(',', '')
  } catch { return '' }
}

export const isPdfDoc = (d) =>
  (d && d.contentType) === 'application/pdf' || /\.pdf(\?|$)/i.test(String((d && (d.url || d.name)) || ''))

// Which stamps does this document need? Returns [] when it needs none.
export function stampsForDoc(doc) {
  const d = doc || {}
  const out = []
  const approved = d.status === 'approved' || d.approvalStatus === 'approved'
  const construction = d.constructionIssue === true || d.status === 'construction-issue'
  if (approved) out.push({ label: 'APPROVED', at: d.approvedAt || 0, color: GREEN })
  if (construction) out.push({ label: 'CONSTRUCTION ISSUE', at: d.constructionIssueAt || 0, color: BLUE })
  return out
}

// Map a point in "visual" stamp-box space (origin at the box's on-screen bottom-left,
// +x right, +y up as the reader sees it) into PDF page coordinates, honouring /Rotate.
function localToPage(rot, ax, ay, lx, ly) {
  if (rot === 90) return { x: ax - ly, y: ay + lx }
  if (rot === 180) return { x: ax - lx, y: ay - ly }
  if (rot === 270) return { x: ax + ly, y: ay - lx }
  return { x: ax + lx, y: ay + ly }
}

// Anchor = page coords of the stamp block's on-screen bottom-left corner, given the
// block's on-screen size and the page rotation.
function anchorFor(rot, W, H, margin, bw, bh) {
  if (rot === 90) return { ax: margin + bh, ay: H - margin - bw }
  if (rot === 180) return { ax: margin + bw, ay: margin + bh }
  if (rot === 270) return { ax: W - margin - bh, ay: margin + bw }
  return { ax: W - margin - bw, ay: H - margin - bh }
}

// Draw the stamps on page 1 of the supplied PDF bytes. Returns new PDF bytes (Uint8Array).
export async function stampPdfBytes(srcBytes, stamps) {
  const list = (stamps || []).filter(Boolean)
  if (!list.length) return null

  const pdf = await PDFDocument.load(srcBytes, { ignoreEncryption: true })
  const pages = pdf.getPages()
  if (!pages.length) return null
  const page = pages[0]

  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const font = await pdf.embedFont(StandardFonts.Helvetica)

  const { width: W, height: H } = page.getSize()
  const rot = ((page.getRotation().angle % 360) + 360) % 360
  // On-screen page size (swapped when the page is rotated a quarter turn).
  const Wv = (rot === 90 || rot === 270) ? H : W
  const Hv = (rot === 90 || rot === 270) ? W : H

  // Scale the stamp with the sheet so it reads the same on A4 and A0.
  const scale = Math.max(1, Math.min(3, Wv / 595.28))
  const pad = 9 * scale
  const labelSize = 13 * scale
  const dateSize = 8.5 * scale
  const lineGap = 4 * scale
  const stackGap = 8 * scale
  const margin = 18 * scale
  const border = 1.5 * scale

  // Measure every stamp box first so they can share one right-aligned block width.
  const boxes = list.map(s => {
    const dateText = ukDateTime(s.at)
    const wLabel = bold.widthOfTextAtSize(s.label, labelSize)
    const wDate = dateText ? font.widthOfTextAtSize(dateText, dateSize) : 0
    const w = Math.max(wLabel, wDate) + pad * 2
    const h = labelSize + (dateText ? lineGap + dateSize : 0) + pad * 2
    return { ...s, dateText, w, h, wLabel, wDate }
  })

  const blockW = Math.max(...boxes.map(b => b.w))
  const blockH = boxes.reduce((t, b) => t + b.h, 0) + stackGap * (boxes.length - 1)

  // Never let an oversized stamp run off a small sheet.
  if (blockW + margin * 2 > Wv || blockH + margin * 2 > Hv) return null

  const { ax, ay } = anchorFor(rot, W, H, margin, blockW, blockH)
  const rotate = degrees(rot)

  // Walk down the block from its top edge.
  let cursorY = blockH
  for (const b of boxes) {
    const boxTop = cursorY
    const boxBottom = boxTop - b.h
    const boxLeft = blockW - b.w   // right-align the boxes within the block

    const bl = localToPage(rot, ax, ay, boxLeft, boxBottom)
    page.drawRectangle({
      x: bl.x, y: bl.y, width: b.w, height: b.h, rotate,
      color: b.color, opacity: FILL_OPACITY,
      borderColor: b.color, borderWidth: border, borderOpacity: LINE_OPACITY,
    })

    // Label sits on the upper line, date underneath, both centred in the box.
    const labelBaseline = boxBottom + b.h - pad - labelSize
    const lp = localToPage(rot, ax, ay, boxLeft + (b.w - b.wLabel) / 2, labelBaseline)
    page.drawText(b.label, { x: lp.x, y: lp.y, size: labelSize, font: bold, color: b.color, opacity: TEXT_OPACITY, rotate })

    if (b.dateText) {
      const dateBaseline = labelBaseline - lineGap - dateSize
      const dp = localToPage(rot, ax, ay, boxLeft + (b.w - b.wDate) / 2, dateBaseline)
      page.drawText(b.dateText, { x: dp.x, y: dp.y, size: dateSize, font, color: b.color, opacity: TEXT_OPACITY, rotate })
    }

    cursorY = boxBottom - stackGap
  }

  return await pdf.save()
}

// Fetch the original, stamp it, store the stamped copy, return its url.
// Returns '' for non-PDFs, unstamped documents, or any failure - callers store that as
// stampedUrl and every consumer falls back to the original url.
export async function buildStampedCopy(doc, { projectNo = '', prefix = 'stamped' } = {}) {
  try {
    const d = doc || {}
    if (!d.url) return ''
    const stamps = stampsForDoc(d)
    if (!stamps.length) return ''
    if (!isPdfDoc(d)) return ''

    const r = await fetch(d.url)
    if (!r.ok) return ''
    const src = Buffer.from(await r.arrayBuffer())

    const out = await stampPdfBytes(src, stamps)
    if (!out) return ''

    const base = String(d.name || 'document').replace(/\.pdf$/i, '').replace(/[^\w.\- ]+/g, '_').slice(0, 60)
    const rev = d.revision ? `-Rev${String(d.revision).replace(/[^\w]+/g, '')}` : ''
    const safe = `${projectNo ? projectNo + '-' : ''}${base}${rev}-stamped.pdf`
    const blob = await put(`${prefix}/${safe}`, Buffer.from(out), {
      access: 'public', contentType: 'application/pdf', addRandomSuffix: true,
    })
    return blob.url
  } catch (e) { return '' }
}

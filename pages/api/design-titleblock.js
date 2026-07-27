import { verifySessionToken, SESSION_COOKIE } from '../../lib/portalAuth'
import { canAccessArea } from '../../lib/roles'

// Best-effort extraction of drawing title-block fields from a PDF. Title blocks vary
// wildly between architects, so this pattern-matches common labels and ALWAYS returns
// editable fields - the user confirms/corrects on upload.
//
// POST { url }  ->  { meta: { architect, reference, project, revision, status, date } }

function readCookie(req, name) {
  const raw = req.headers.cookie || ''
  const m = raw.split(';').map(s => s.trim()).find(s => s.startsWith(name + '='))
  return m ? decodeURIComponent(m.split('=').slice(1).join('=')) : null
}

// Pull "Label: value" style fields out of the extracted text.
function grab(text, labels) {
  for (const label of labels) {
    // e.g. "Revision: P03", "Rev  P03", "Drawing No. 1234-A-001"
    const re = new RegExp(`${label}\\s*[:.#-]?\\s*([A-Za-z0-9][A-Za-z0-9 ./_-]{0,40})`, 'i')
    const m = re.exec(text)
    if (m && m[1]) {
      const v = m[1].trim().replace(/\s{2,}/g, ' ')
      if (v && !/^(no|n\/a|tbc)$/i.test(v)) return v
    }
  }
  return ''
}
function grabDate(text) {
  const m = /(\b\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}\b)/.exec(text) || /(\b\d{4}[\/.\-]\d{1,2}[\/.\-]\d{1,2}\b)/.exec(text)
  return m ? m[1] : ''
}

async function extractText(url) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const resp = await fetch(url)
  const data = new Uint8Array(await resp.arrayBuffer())
  const doc = await pdfjs.getDocument({ data, disableWorker: true }).promise
  const pages = []
  const idxs = new Set([1, doc.numPages]) // first + last page (title block usually here)
  for (const i of idxs) {
    if (i < 1 || i > doc.numPages) continue
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    pages.push(content.items.map(it => it.str).join(' '))
  }
  return pages.join('\n')
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const u = verifySessionToken(readCookie(req, SESSION_COOKIE))
  if (!u || u.role === 'external' || !canAccessArea(u.role, 'design')) return res.status(403).json({ error: 'No access' })

  const url = String((req.body || {}).url || '')
  if (!/\.blob\.vercel-storage\.com\//i.test(url)) return res.status(400).json({ error: 'Bad url' })

  try {
    const text = await extractText(url)
    const meta = {
      architect: grab(text, ['Architect', 'Drawn by', 'Author', 'Originator', 'Practice']),
      reference: grab(text, ['Drawing No', 'Drawing Number', 'Dwg No', 'Drawing Ref', 'Reference', 'Ref']),
      project: grab(text, ['Project', 'Job', 'Site', 'Development']),
      revision: grab(text, ['Revision', 'Rev']),
      status: grab(text, ['Status', 'Suitability', 'Purpose of Issue']),
      date: grab(text, ['Date']) || grabDate(text),
    }
    return res.json({ meta, ok: true })
  } catch (e) {
    // Extraction failed (scanned/flattened PDF etc.) - return blank editable fields.
    return res.json({ meta: { architect: '', reference: '', project: '', revision: '', status: '', date: '' }, ok: false, error: e?.message || 'Could not read title block' })
  }
}

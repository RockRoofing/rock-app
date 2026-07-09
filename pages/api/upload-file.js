import { put } from '@vercel/blob'

// Server-side upload. The browser POSTs the RAW file bytes as the request body
// (no base64, no JSON wrapper), with the filename/type in headers. Raw bytes
// mean no 33% base64 inflation, so real files up to ~4MB work within Vercel's
// limit — covers photos and most documents. We stream straight to Vercel Blob.
export const config = { api: { bodyParser: false } }

function readRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const token = process.env.BLOB_READ_WRITE_TOKEN
  if (!token) return res.status(500).json({ error: 'File storage not configured (BLOB_READ_WRITE_TOKEN missing).' })
  try {
    const filename = decodeURIComponent(req.headers['x-filename'] || `file-${Date.now()}`)
    const contentType = req.headers['x-content-type'] || req.headers['content-type'] || 'application/octet-stream'
    const buffer = await readRaw(req)
    if (!buffer.length) return res.status(400).json({ error: 'Empty file' })
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_')
    const key = `project-files/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`
    const blob = await put(key, buffer, { access: 'public', contentType, token })
    return res.status(200).json({ url: blob.url, contentType, size: buffer.length })
  } catch (e) {
    console.error('upload-file error:', e)
    return res.status(400).json({ error: e?.message || 'Upload failed' })
  }
}

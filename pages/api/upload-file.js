// Generic file upload (PDFs and images) for project documents — drawings,
// RAMS, handover docs. Stores on Vercel Blob and returns a permanent URL.
export const config = {
  api: { bodyParser: { sizeLimit: '25mb' } },
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const { filename, dataUrl } = req.body || {}
  if (!dataUrl) return res.status(400).json({ error: 'Missing file data' })

  const m = /^data:(.+?);base64,(.*)$/.exec(dataUrl)
  if (!m) return res.status(400).json({ error: 'Invalid file data' })
  const contentType = m[1]
  const buffer = Buffer.from(m[2], 'base64')

  const token = process.env.BLOB_READ_WRITE_TOKEN
  if (!token) {
    return res.status(500).json({ error: 'File storage is not configured (BLOB_READ_WRITE_TOKEN missing).' })
  }
  try {
    const { put } = await import('@vercel/blob')
    const safeName = (filename || `file-${Date.now()}`).replace(/[^a-zA-Z0-9._-]/g, '_')
    const key = `project-files/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`
    const blob = await put(key, buffer, { access: 'public', contentType, token })
    return res.json({ url: blob.url, contentType, size: buffer.length })
  } catch (e) {
    console.error('File upload failed:', e)
    return res.status(500).json({ error: 'Upload failed. Please try again.' })
  }
}

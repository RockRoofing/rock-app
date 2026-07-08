// Photo upload for form submissions.
// Uses Vercel Blob (works on Hobby) when BLOB_READ_WRITE_TOKEN is set,
// returning a permanent https URL that can be viewed on a phone without
// downloading. Falls back to returning the data URL inline if Blob isn't
// configured (useful for local dev), so the UI never hard-fails.

export const config = {
  api: { bodyParser: { sizeLimit: '12mb' } },
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const { filename, dataUrl } = req.body || {}
  if (!dataUrl) return res.status(400).json({ error: 'Missing image data' })

  // Parse the data URL into a buffer.
  const m = /^data:(.+?);base64,(.*)$/.exec(dataUrl)
  if (!m) return res.status(400).json({ error: 'Invalid image data' })
  const contentType = m[1]
  const buffer = Buffer.from(m[2], 'base64')

  const token = process.env.BLOB_READ_WRITE_TOKEN
  if (token) {
    try {
      const { put } = await import('@vercel/blob')
      const safeName = (filename || `photo-${Date.now()}.jpg`).replace(/[^a-zA-Z0-9._-]/g, '_')
      const key = `submissions/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`
      const blob = await put(key, buffer, { access: 'public', contentType, token })
      return res.json({ url: blob.url })
    } catch (e) {
      console.error('Blob upload failed:', e)
      // fall through to inline fallback
    }
  }

  // Fallback: return the data URL so the flow still works without Blob.
  return res.json({ url: dataUrl, inline: true })
}

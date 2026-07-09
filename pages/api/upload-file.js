import { handleUpload } from '@vercel/blob/client'

// Client-direct upload handler. The browser uploads file bytes STRAIGHT to
// Vercel Blob (up to 5GB) — this endpoint only issues a short-lived signed
// token, so we never route large files through the serverless function and
// avoid Vercel's 4.5MB request-body limit (the cause of 413 / "failed to upload").
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  try {
    const body = req.body
    const jsonResponse = await handleUpload({
      body,
      request: req,
      token: process.env.BLOB_READ_WRITE_TOKEN,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/*'],
        maximumSizeInBytes: 50 * 1024 * 1024, // 50MB per file
        addRandomSuffix: true,
      }),
      onUploadCompleted: async () => {},
    })
    return res.status(200).json(jsonResponse)
  } catch (e) {
    console.error('upload token error:', e)
    return res.status(400).json({ error: e.message || 'Upload failed' })
  }
}

import { handleUpload } from '@vercel/blob/client'

// Client-direct upload handler. The browser uploads file bytes STRAIGHT to
// Vercel Blob — this endpoint only issues a short-lived signed token, so we
// never route large files through the function (avoids the 4.5MB limit / 413).
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  try {
    const jsonResponse = await handleUpload({
      body: req.body,
      request: req,
      token: process.env.BLOB_READ_WRITE_TOKEN,
      onBeforeGenerateToken: async () => ({
        // No content-type restriction — accept PDFs and any image type
        // (phones send image/jpeg, image/heic, etc.). Restricting with a
        // wildcard was rejecting valid uploads.
        addRandomSuffix: true,
        maximumSizeInBytes: 50 * 1024 * 1024,
      }),
      onUploadCompleted: async () => { /* no-op */ },
    })
    return res.status(200).json(jsonResponse)
  } catch (e) {
    console.error('upload-file token error:', e)
    return res.status(400).json({ error: e?.message || 'Upload failed' })
  }
}

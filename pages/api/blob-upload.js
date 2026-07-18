import { handleUpload } from '@vercel/blob/client'

// Token endpoint for direct browser -> Vercel Blob uploads. This bypasses the
// ~4.5MB serverless request-body limit that /api/upload-file hits, so large
// photos and documents upload fine.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const token = process.env.BLOB_READ_WRITE_TOKEN
  if (!token) return res.status(500).json({ error: 'File storage not configured (BLOB_READ_WRITE_TOKEN missing).' })
  try {
    const jsonResponse = await handleUpload({
      token,
      request: req,
      body: req.body,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: [
          'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif',
          'application/pdf',
          'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-excel.sheet.macroEnabled.12',
          'application/vnd.ms-excel.sheet.macroenabled.12',
          'application/octet-stream',
          'text/plain', 'text/csv',
        ],
        maximumSizeInBytes: 50 * 1024 * 1024, // 50MB
        addRandomSuffix: true,
      }),
      onUploadCompleted: async () => {},
    })
    return res.status(200).json(jsonResponse)
  } catch (e) {
    console.error('blob-upload error:', e)
    return res.status(400).json({ error: e?.message || 'Upload failed' })
  }
}

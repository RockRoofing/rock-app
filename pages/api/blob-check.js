// TEMPORARY DIAGNOSTIC — visit /api/blob-check in a browser.
// Tells us plainly whether Blob is configured and whether a tiny server-side
// upload works, so we can isolate upload failures. Remove after debugging.
export default async function handler(req, res) {
  const hasToken = !!process.env.BLOB_READ_WRITE_TOKEN
  const result = { hasToken, tokenPrefix: hasToken ? process.env.BLOB_READ_WRITE_TOKEN.slice(0, 22) + '…' : null }
  if (!hasToken) {
    result.verdict = 'NO TOKEN — BLOB_READ_WRITE_TOKEN is not set in this environment. This is why uploads fail.'
    return res.status(200).json(result)
  }
  try {
    const { put } = await import('@vercel/blob')
    const blob = await put(`diagnostic/test-${Date.now()}.txt`, 'hello from blob-check', {
      access: 'public', token: process.env.BLOB_READ_WRITE_TOKEN, addRandomSuffix: true,
    })
    result.uploadWorked = true
    result.testUrl = blob.url
    result.verdict = 'BLOB WORKS server-side. If client uploads still fail, the issue is the client token handshake / callback URL.'
  } catch (e) {
    result.uploadWorked = false
    result.error = e?.message || String(e)
    result.verdict = 'Token is set but the upload FAILED — see error. Likely an invalid/expired token or store not linked.'
  }
  return res.status(200).json(result)
}

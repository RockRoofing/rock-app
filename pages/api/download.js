// Streams a stored file back through our own origin with a proper filename and
// Content-Disposition so browsers save it with the correct name/extension
// (Vercel Blob URLs are a different origin and ignore the <a download> name).
//
// GET /api/download?url=<encoded blob url>&name=<filename>
export default async function handler(req, res) {
  const { url, name } = req.query
  if (!url) return res.status(400).json({ error: 'Missing url' })
  // Only allow proxying Vercel Blob URLs (safety: no arbitrary SSRF targets).
  let target
  try { target = new URL(url) } catch { return res.status(400).json({ error: 'Bad url' }) }
  if (!/\.blob\.vercel-storage\.com$/i.test(target.hostname)) {
    return res.status(400).json({ error: 'Unsupported host' })
  }
  try {
    const upstream = await fetch(target.toString())
    if (!upstream.ok) return res.status(upstream.status).end()
    const buf = Buffer.from(await upstream.arrayBuffer())
    let ct = upstream.headers.get('content-type') || 'application/octet-stream'
    const safeName = String(name || target.pathname.split('/').pop() || 'download').replace(/[^\w.\- ]+/g, '_')
    // If the blob was stored as octet-stream (common when the browser sent no type
    // on upload), derive a proper MIME type from the extension so <img>/<iframe>
    // will render it inline.
    if (!/^image\//.test(ct) && ct !== 'application/pdf') {
      const ext = (target.pathname.split('.').pop() || '').toLowerCase()
      const map = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', heic: 'image/heic', heif: 'image/heif', pdf: 'application/pdf' }
      if (map[ext]) ct = map[ext]
    }
    res.setHeader('Content-Type', ct)
    // inline=1 -> render in the browser (img/iframe); otherwise force a download.
    const disposition = req.query.inline ? 'inline' : 'attachment'
    res.setHeader('Content-Disposition', `${disposition}; filename="${safeName}"`)
    res.setHeader('Content-Length', buf.length)
    res.setHeader('Cache-Control', 'private, max-age=0, no-store')
    return res.status(200).send(buf)
  } catch (e) {
    return res.status(502).json({ error: 'Fetch failed' })
  }
}

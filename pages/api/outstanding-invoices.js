import { requireRole } from '../../lib/portalAuth'
import { gatherOutstandingInvoices, getWeeklyRecipients, setWeeklyRecipients, sendWeeklyOverdueReport } from '../../lib/outstandingInvoicesReport'
import { buildOutstandingInvoicesPDF } from '../../lib/outstandingInvoicesPdf'

async function getRedis() {
  try {
    const { Redis } = await import('@upstash/redis')
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
    if (!url || !token) return null
    return new Redis({ url, token })
  } catch { return null }
}

const META_KEY = 'invoice:meta'   // { [invoiceNumber]: { expectedDate, comments:[{id,text,author,at,mentions:[]}] } }

export default async function handler(req, res) {
  if (!requireRole(req, res, ['post-contract', 'management', 'admin'])) return
  const redis = await getRedis()
  if (!redis) return res.status(500).json({ error: 'No Redis' })

  // Return the manual meta map (expected dates + comments) for all invoices.
  if (req.method === 'GET') {
    const { action } = req.query
    if (action === 'recipients') {
      try { return res.json({ recipients: await getWeeklyRecipients() }) } catch { return res.json({ recipients: [] }) }
    }
    if (action === 'download') {
      // Stream the full outstanding list as a PDF. ?comments=1 appends per-invoice pages.
      try {
        const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0]
        const host = req.headers['x-forwarded-host'] || req.headers.host
        const baseUrl = host ? `${proto}://${host}` : null
        const invoices = await gatherOutstandingInvoices({ baseUrl })
        const includeComments = req.query.comments === '1'
        const pdfBytes = await buildOutstandingInvoicesPDF({ invoices, includeComments, logoUrl: baseUrl ? `${baseUrl}/rock-logo.jpg` : null })
        res.setHeader('Content-Type', 'application/pdf')
        res.setHeader('Content-Disposition', `attachment; filename="Outstanding-Invoices-${new Date().toISOString().slice(0, 10)}.pdf"`)
        res.setHeader('Cache-Control', 'no-store')
        return res.send(Buffer.from(pdfBytes))
      } catch (e) { console.error('download failed:', e); return res.status(500).json({ error: e.message }) }
    }
    try {
      const meta = (await redis.get(META_KEY)) || {}
      return res.json({ meta })
    } catch { return res.json({ meta: {} }) }
  }

  if (req.method === 'POST') {
    const { action, invoiceNumber } = req.body || {}

    // ── Weekly-report recipients + manual send (no invoiceNumber needed) ──
    if (action === 'get-recipients') {
      return res.json({ recipients: await getWeeklyRecipients() })
    }
    if (action === 'set-recipients') {
      const list = Array.isArray(req.body.recipients) ? req.body.recipients.map(s => String(s).trim()).filter(Boolean) : []
      await setWeeklyRecipients([...new Set(list)])
      return res.json({ ok: true, recipients: list })
    }
    if (action === 'send-report-now') {
      const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0]
      const host = req.headers['x-forwarded-host'] || req.headers.host
      const baseUrl = host ? `${proto}://${host}` : null
      const result = await sendWeeklyOverdueReport({ baseUrl })
      return res.json(result)
    }

    if (!invoiceNumber) return res.status(400).json({ error: 'invoiceNumber required' })
    let meta = {}
    try { meta = (await redis.get(META_KEY)) || {} } catch {}
    if (!meta[invoiceNumber]) meta[invoiceNumber] = { expectedDate: '', comments: [] }

    if (action === 'set-expected') {
      meta[invoiceNumber].expectedDate = req.body.expectedDate || ''
      await redis.set(META_KEY, meta)
      return res.json({ ok: true, meta: meta[invoiceNumber] })
    }

    if (action === 'add-comment') {
      const { text, author, mentions } = req.body
      if (!text || !text.trim()) return res.status(400).json({ error: 'Empty comment' })
      const comment = {
        id: `c_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
        text: text.trim(),
        author: author || 'Unknown',
        at: Date.now(),
        mentions: Array.isArray(mentions) ? mentions : [],
        source: req.body.source || 'user',   // 'user' | 'email-bcc'
      }
      meta[invoiceNumber].comments = [...(meta[invoiceNumber].comments || []), comment]
      await redis.set(META_KEY, meta)
      // Notify @mentioned portal users.
      try {
        if (comment.mentions.length) await notifyMentions(comment.mentions, invoiceNumber, comment)
      } catch (e) { console.error('mention notify failed:', e) }
      return res.json({ ok: true, comment, meta: meta[invoiceNumber] })
    }

    if (action === 'edit-comment') {
      const { commentId, text } = req.body
      meta[invoiceNumber].comments = (meta[invoiceNumber].comments || []).map(c =>
        c.id === commentId ? { ...c, text: (text || '').trim(), editedAt: Date.now() } : c)
      await redis.set(META_KEY, meta)
      return res.json({ ok: true, meta: meta[invoiceNumber] })
    }

    if (action === 'delete-comment') {
      const { commentId } = req.body
      meta[invoiceNumber].comments = (meta[invoiceNumber].comments || []).filter(c => c.id !== commentId)
      await redis.set(META_KEY, meta)
      return res.json({ ok: true, meta: meta[invoiceNumber] })
    }

    return res.status(400).json({ error: 'Unknown action' })
  }

  res.status(405).end()
}

// Drop an in-app notification for each mentioned user (by portal user id).
async function notifyMentions(userIds, invoiceNumber, comment) {
  const redis = await getRedis()
  if (!redis) return
  for (const uid of userIds) {
    const key = `notifications:${uid}`
    let list = []
    try { list = (await redis.get(key)) || [] } catch {}
    list.unshift({
      id: `n_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      type: 'invoice-mention',
      text: `${comment.author} mentioned you on invoice ${invoiceNumber}`,
      invoiceNumber,
      at: Date.now(),
      read: false,
    })
    await redis.set(key, list.slice(0, 100))
  }
}

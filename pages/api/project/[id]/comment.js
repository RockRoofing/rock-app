import { saveComment } from '../../../../lib/db'

export default async function handler(req, res) {
  const { id } = req.query
  if (req.method === 'POST') {
    const { comment } = req.body
    await saveComment(id, comment)
    res.json({ ok: true })
  } else {
    res.status(405).end()
  }
}

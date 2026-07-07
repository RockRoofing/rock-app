import { set } from '../../lib/db'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  
  const body = req.body
  const debug = {
    event: body.event,
    meta: body.meta,
    current_value: body.current?.value,
    previous_value: body.previous?.value,
    current_stage_id: body.current?.stage_id,
    previous_stage_id: body.previous?.stage_id,
    current_stage_name: body.current?.stage_name,
    previous_stage_name: body.previous?.stage_name,
    current_title: body.current?.title,
    current_id: body.current?.id,
  }
  
  await set('webhook:last_debug', JSON.stringify(debug))
  return res.status(200).json({ ok: true })
}

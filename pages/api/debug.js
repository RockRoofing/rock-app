import { set } from '../../lib/db'
 
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  
  const body = req.body
  // Only save the structure we need to understand
  const debug = {
    event: body.event,
    meta: body.meta,
    current_keys: body.current ? Object.keys(body.current) : [],
    previous_keys: body.previous ? Object.keys(body.previous) : [],
    current_value: body.current?.value,
    previous_value: body.previous?.value,
    current_stage_id: body.current?.stage_id,
    previous_stage_id: body.previous?.stage_id,
    current_stage_name: body.current?.stage_name,
    previous_stage_name: body.previous?.stage_name,
    current_title: body.current?.title,
    current_id: body.current?.id,
  }
  
  await set('webhook_last_debug', JSON.stringify(debug))
  return res.status(200).json({ ok: true })
}
 

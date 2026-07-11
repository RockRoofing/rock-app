import { requireRole } from '../../lib/portalAuth'
export default async function handler(req, res) {
  if (!requireRole(req, res, ['post-contract','management','admin'])) return;
  const KEY = process.env.PIPEDRIVE_API_KEY || process.env.Pipedrive_API_Key
  const pRes = await fetch(`https://api.pipedrive.com/v1/stages?api_token=${KEY}`)
  const data = await pRes.json()
  const stages = data.data?.map(s => ({ id: s.id, name: s.name, pipeline_id: s.pipeline_id })) || []
  return res.status(200).json({ stages })
}

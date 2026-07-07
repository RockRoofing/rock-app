export default async function handler(req, res) {
  const KEY = process.env.PIPEDRIVE_API_KEY || process.env.Pipedrive_API_Key
  const { id } = req.query
  if (!id) return res.status(400).json({ error: 'Need ?id=dealId' })
  
  const response = await fetch(`https://api.pipedrive.com/v1/deals/${id}?api_token=${KEY}`)
  const data = await response.json()
  const deal = data.data
  
  // Show custom fields and key fields
  const relevant = {}
  for (const [key, val] of Object.entries(deal || {})) {
    if (val !== null && val !== '' && val !== 0) {
      relevant[key] = val
    }
  }
  
  return res.status(200).json({ relevant })
}

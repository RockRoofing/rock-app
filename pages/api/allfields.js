export default async function handler(req, res) {
  const KEY = process.env.PIPEDRIVE_API_KEY || process.env.Pipedrive_API_Key
  const response = await fetch(`https://api.pipedrive.com/v1/dealFields?api_token=${KEY}&limit=200`)
  const data = await response.json()
  const fields = data.data?.map(f => ({ name: f.name, key: f.key, type: f.field_type })) || []
  return res.status(200).json({ fields })
}

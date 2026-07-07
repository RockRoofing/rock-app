import { getFieldMap } from '../../lib/db'

export default async function handler(req, res) {
  const fieldMap = await getFieldMap()
  return res.status(200).json({ fieldMap })
}

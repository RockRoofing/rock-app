import { getFieldMap } from '../../lib/db'
import withTenant from '../../lib/withTenant'

async function handler(req, res) {
  const fieldMap = await getFieldMap()
  return res.status(200).json({ fieldMap })
}

export default withTenant(handler)

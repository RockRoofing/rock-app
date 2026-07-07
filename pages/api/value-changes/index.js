import { getValueChanges, saveValueChanges } from '../../../lib/db'

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const changes = await getValueChanges()
    return res.status(200).json({ changes })
  }

  if (req.method === 'POST') {
    const { dealId, dealTitle, organizationName, oldValue, newValue, changeDate, estimator, notes } = req.body
    if (!dealId || newValue == null) return res.status(400).json({ error: 'Missing fields' })

    const changes = await getValueChanges()
    const entry = {
      id: Date.now().toString(),
      dealId,
      dealTitle,
      organizationName,
      oldValue: oldValue || 0,
      newValue,
      valueChange: newValue - (oldValue || 0),
      changeDate: changeDate || new Date().toISOString().split('T')[0],
      estimator: estimator || '',
      notes: notes || '',
      createdAt: new Date().toISOString(),
    }
    changes.push(entry)
    await saveValueChanges(changes)
    return res.status(200).json({ success: true, entry })
  }

  if (req.method === 'DELETE') {
    const { id } = req.body
    const changes = await getValueChanges()
    await saveValueChanges(changes.filter(c => c.id !== id))
    return res.status(200).json({ success: true })
  }

  res.status(405).end()
}

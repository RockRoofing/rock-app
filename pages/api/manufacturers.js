import { getManufacturerContacts, saveManufacturerContacts } from '../../lib/db'

// Reusable manufacturer contacts. Saved when entered on an IHM so they can be
// searched and selected on future handovers.
//
// GET    /api/manufacturers            -> { contacts }
// POST   /api/manufacturers { contact }-> add/update (dedupe by email or name+company)
// DELETE /api/manufacturers { id }     -> remove
export default async function handler(req, res) {
  if (req.method === 'GET') {
    return res.json({ contacts: await getManufacturerContacts() })
  }
  if (req.method === 'POST') {
    const { contact } = req.body || {}
    if (!contact || !contact.name) return res.status(400).json({ error: 'Name required' })
    let contacts = await getManufacturerContacts()
    // Dedupe: same email, or same name+company
    const key = (c) => (c.email || '').toLowerCase() || `${(c.name || '').toLowerCase()}|${(c.company || '').toLowerCase()}`
    const existingIdx = contacts.findIndex(c => key(c) === key(contact))
    if (contact.id) {
      const idx = contacts.findIndex(c => c.id === contact.id)
      if (idx >= 0) contacts[idx] = { ...contacts[idx], ...contact }
      else contacts.push(contact)
    } else if (existingIdx >= 0) {
      contacts[existingIdx] = { ...contacts[existingIdx], ...contact, id: contacts[existingIdx].id }
    } else {
      contact.id = `mfr_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`
      contacts.push(contact)
    }
    await saveManufacturerContacts(contacts)
    return res.json({ contacts })
  }
  if (req.method === 'DELETE') {
    const { id } = req.body || {}
    let contacts = await getManufacturerContacts()
    contacts = contacts.filter(c => c.id !== id)
    await saveManufacturerContacts(contacts)
    return res.json({ contacts })
  }
  res.status(405).end()
}

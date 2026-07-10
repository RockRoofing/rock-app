import { get, set } from '../../lib/db'

// Global supplier/contact directory, usable anywhere in the portal.
// Contact: { id, firstName, lastName, company, phone, email }
//
// GET    /api/contacts            -> { contacts }
// GET    /api/contacts?q=term     -> { contacts } filtered (name/company/email)
// POST   /api/contacts { contact }-> add/update one, returns { contact }
// DELETE /api/contacts { id }     -> remove

async function getContacts() { return (await get('contacts')) || [] }
async function saveContacts(v) { await set('contacts', v) }

export default async function handler(req, res) {
  if (req.method === 'GET') {
    let contacts = await getContacts()
    const q = (req.query.q || '').trim().toLowerCase()
    if (q) {
      contacts = contacts.filter(c => {
        const hay = `${c.firstName || ''} ${c.lastName || ''} ${c.company || ''} ${c.email || ''} ${c.phone || ''}`.toLowerCase()
        return hay.includes(q)
      })
    }
    contacts.sort((a, b) => `${a.company || ''} ${a.lastName || ''}`.localeCompare(`${b.company || ''} ${b.lastName || ''}`))
    return res.json({ contacts })
  }

  if (req.method === 'POST') {
    const { contact } = req.body || {}
    if (!contact) return res.status(400).json({ error: 'contact required' })
    let contacts = await getContacts()
    if (!contact.id) {
      contact.id = `c_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      contacts.push(contact)
    } else {
      const idx = contacts.findIndex(c => c.id === contact.id)
      if (idx >= 0) contacts[idx] = { ...contacts[idx], ...contact }
      else contacts.push(contact)
    }
    await saveContacts(contacts)
    return res.json({ ok: true, contact })
  }

  if (req.method === 'DELETE') {
    const { id } = req.body || {}
    let contacts = await getContacts()
    contacts = contacts.filter(c => c.id !== id)
    await saveContacts(contacts)
    return res.json({ ok: true })
  }

  res.status(405).end()
}

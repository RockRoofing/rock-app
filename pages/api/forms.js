import { getForms, saveForms } from '../../lib/db'
import { SEED_FORMS } from '../../lib/formDefs'

// GET    /api/forms            -> { forms }  (saved forms, or seed on first run)
// GET    /api/forms?id=...     -> { form }
// POST   /api/forms  { form }  -> upsert one form, returns { forms }
// DELETE /api/forms  { id }    -> remove, returns { forms }
export default async function handler(req, res) {
  if (req.method === 'GET') {
    let forms = await getForms()
    if (!forms || !forms.length) {
      forms = SEED_FORMS
      // Persist the seed so the builder can edit them going forward.
      try { await saveForms(forms) } catch {}
    }
    const { id } = req.query
    if (id) {
      const form = forms.find(f => f.id === id)
      if (!form) return res.status(404).json({ error: 'Form not found' })
      return res.json({ form })
    }
    return res.json({ forms })
  }

  if (req.method === 'POST') {
    const body = req.body || {}
    // One-time / on-demand: replace all forms with the current seed definitions.
    // Use when the seeded forms have been updated in code and you want them live.
    if (body.action === 'reseed') {
      await saveForms([...SEED_FORMS])
      return res.json({ ok: true, forms: SEED_FORMS })
    }
    const { form } = body
    if (!form || !form.title) return res.status(400).json({ error: 'Missing form' })
    let forms = await getForms()
    if (!forms || !forms.length) forms = [...SEED_FORMS]
    if (!form.id) {
      form.id = form.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + Date.now().toString(36)
    }
    const idx = forms.findIndex(f => f.id === form.id)
    if (idx >= 0) forms[idx] = form
    else forms.push(form)
    await saveForms(forms)
    return res.json({ forms, form })
  }

  if (req.method === 'DELETE') {
    const { id } = req.body || {}
    let forms = await getForms()
    if (!forms || !forms.length) forms = [...SEED_FORMS]
    forms = forms.filter(f => f.id !== id)
    await saveForms(forms)
    return res.json({ forms })
  }

  res.status(405).end()
}

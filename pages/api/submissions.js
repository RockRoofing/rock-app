import {
  getSubmissionIndex, saveSubmissionIndex,
  getSubmission, saveSubmission,
} from '../../lib/db'

// Allow larger bodies (photos are URLs, but signatures/answers can add up).
export const config = { api: { bodyParser: { sizeLimit: '4mb' } } }

// GET    /api/submissions              -> { submissions: [index] }
// GET    /api/submissions?id=...       -> { submission }
// POST   /api/submissions { submission } -> save, returns { submission }
export default async function handler(req, res) {
  if (req.method === 'GET') {
    const { id } = req.query
    if (id) {
      const submission = await getSubmission(id)
      if (!submission) return res.status(404).json({ error: 'Not found' })
      return res.json({ submission })
    }
    const idx = await getSubmissionIndex()
    // newest first
    idx.sort((a, b) => (b.submittedAt || 0) - (a.submittedAt || 0))
    return res.json({ submissions: idx })
  }

  if (req.method === 'POST') {
    const { submission } = req.body || {}
    if (!submission || !submission.formId) {
      return res.status(400).json({ error: 'Missing submission' })
    }
    try {
      const id = `sub_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      const now = Date.now()
      const full = {
        id,
        formId: submission.formId,
        formTitle: submission.formTitle || '',
        projectId: submission.projectId || '',
        projectName: submission.projectName || '',
        operative: submission.operative || '',
        answers: submission.answers || {},
        flags: submission.flags || [],   // manager-notify triggers captured at fill time
        submittedAt: now,
      }
      await saveSubmission(id, full)

      // Lightweight index entry (no answers) so listing is cheap.
      const idx = await getSubmissionIndex()
      idx.push({
        id,
        formId: full.formId,
        formTitle: full.formTitle,
        projectId: full.projectId,
        projectName: full.projectName,
        operative: full.operative,
        flagCount: (full.flags || []).length,
        submittedAt: now,
      })
      await saveSubmissionIndex(idx)

      return res.json({ submission: full })
    } catch (e) {
      console.error('submission save failed:', e)
      return res.status(500).json({ error: `Save failed: ${e.message || 'server error'}` })
    }
  }

  if (req.method === 'PUT') {
    const { id, answers } = req.body || {}
    if (!id) return res.status(400).json({ error: 'Missing id' })
    try {
      const full = await getSubmission(id)
      if (!full) return res.status(404).json({ error: 'Not found' })
      full.answers = answers || full.answers
      full.editedAt = Date.now()
      await saveSubmission(id, full)
      return res.json({ submission: full })
    } catch (e) {
      console.error('submission update failed:', e)
      return res.status(500).json({ error: `Update failed: ${e.message || 'server error'}` })
    }
  }

  res.status(405).end()
}

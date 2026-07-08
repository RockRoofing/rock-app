import {
  getSubmissionIndex, saveSubmissionIndex,
  getSubmission, saveSubmission,
} from '../../lib/db'

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
  }

  res.status(405).end()
}

import { get, set, getPortalUsers } from '../../lib/db'
import { getSubmissionIndex, saveSubmissionIndex, saveSubmission } from '../../lib/db'

// Issues — raised from the Site App, tracked under Project Management → Issues.
// Issues are NOT normal forms: they do not appear in the Forms list or the
// per-project Project Forms tab. Their photos DO appear in Project Images
// (we write a companion submission tagged isIssue so the gallery picks them up,
// while the Project Forms tab filters isIssue submissions out).
//
// Issue record:
// { id, issueId, projectNo, projectName, projectAddress, createdBy, createdAt,
//   issueName, issueTypes[], issueOther, description, photos[],
//   sendToCustomer: '' | 'send' | 'edits' | 'nosend',
//   sentToCustomer: false, sentAt, sentTo[], sentManually: false,
//   resolvedDate: '', comments: '', submissionId }
//
// GET    /api/issues                 -> { issues }
// GET    /api/issues?id=...          -> { issue }
// POST   /api/issues { issue }       -> create/update
// DELETE /api/issues { id }          -> remove

export const config = { api: { bodyParser: { sizeLimit: '8mb' } } }

const KEY = 'ops:issues'
async function getIssues() { return (await get(KEY)) || [] }
async function saveIssues(v) { await set(KEY, v) }

function nextIssueId(issues) {
  // ISS-0001 style, sequential
  let max = 0
  for (const i of issues) {
    const m = /ISS-(\d+)/.exec(i.issueId || '')
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return `ISS-${String(max + 1).padStart(4, '0')}`
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const { id } = req.query
    const issues = await getIssues()
    if (id) {
      const issue = issues.find(i => i.id === id)
      if (!issue) return res.status(404).json({ error: 'Not found' })
      return res.json({ issue })
    }
    issues.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    return res.json({ issues })
  }

  if (req.method === 'POST') {
    try {
    const { issue } = req.body || {}
    if (!issue) return res.status(400).json({ error: 'Missing issue' })
    let issues = await getIssues()

    if (!issue.id) {
      // ── Create ──────────────────────────────────────────────────────────
      issue.id = `iss_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`
      issue.issueId = nextIssueId(issues)
      issue.createdAt = Date.now()
      issue.sendToCustomer = issue.sendToCustomer || ''
      issue.sentToCustomer = false
      issue.sentManually = false
      issue.resolvedDate = issue.resolvedDate || ''
      issue.comments = issue.comments || ''

      // Companion submission so photos show in Project Images (tagged isIssue so
      // the Forms tab / Project Forms tab can filter it out). Best-effort only.
      try {
        const photos = issue.photos || []
        if (photos.length) {
          const subId = `sub_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
          const answers = { 'Issue Name': issue.issueName, 'Issue Photos': photos }
          await saveSubmission(subId, {
            id: subId, formId: '__issue__', formTitle: `Issue: ${issue.issueName || ''}`,
            projectId: issue.projectNo, projectName: issue.projectName,
            operative: issue.createdBy || '', answers, flags: [], isIssue: true,
            submittedAt: Date.now(),
          })
          const idx = await getSubmissionIndex()
          idx.push({ id: subId, formId: '__issue__', formTitle: `Issue: ${issue.issueName || ''}`,
            projectId: issue.projectNo, projectName: issue.projectName, operative: issue.createdBy || '',
            flagCount: 0, isIssue: true, submittedAt: Date.now() })
          await saveSubmissionIndex(idx)
          issue.submissionId = subId
        }
      } catch (e) { console.error('issue companion submission failed', e) }

      issues.push(issue)
      await saveIssues(issues)
      return res.json({ ok: true, issue })
    }

    // ── Update ────────────────────────────────────────────────────────────
    const uidx = issues.findIndex(i => i.id === issue.id)
    if (uidx >= 0) issues[uidx] = { ...issues[uidx], ...issue }
    else issues.push(issue)
    await saveIssues(issues)
    return res.json({ ok: true, issue: issues[uidx >= 0 ? uidx : issues.length - 1] })
    } catch (e) {
      console.error('issues POST failed:', e)
      return res.status(500).json({ error: `Save failed: ${e.message || 'server error'}` })
    }
  }

  if (req.method === 'DELETE') {
    const { id } = req.body || {}
    let issues = await getIssues()
    issues = issues.filter(i => i.id !== id)
    await saveIssues(issues)
    return res.json({ ok: true })
  }

  res.status(405).end()
}

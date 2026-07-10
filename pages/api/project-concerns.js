import { get, set } from '../../lib/db'

// Project Concern Meetings, stored per project under ops:concerns:{projectNo}.
// Each meeting keeps its own fields PLUS references (IDs) to the Live Tasks and
// Risk Log entries it created — so those stay in true two-way sync with their
// own pages (the meeting renders the live records by ID; edits either side show
// in both).
//
// Meeting shape:
// { id, projectNo, projectName, date, attendees:[], recordingLink,
//   issues:[], issueOther, description, mitigation,
//   actionTaskIds:[], riskIds:[],
//   anotherMeeting:'yes'|'no', nextMeetingDate, nextMeetingDismissed:bool,
//   createdAt }
//
// GET    /api/project-concerns?projectNo=XXX   -> { meetings }
// POST   /api/project-concerns { projectNo, meeting }  -> add/update one
// DELETE /api/project-concerns { projectNo, id }       -> remove

const keyFor = (p) => `ops:concerns:${p}`

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const { projectNo } = req.query
    if (!projectNo) return res.status(400).json({ error: 'projectNo required' })
    const meetings = (await get(keyFor(projectNo))) || []
    meetings.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    return res.json({ meetings })
  }

  if (req.method === 'POST') {
    const { projectNo, meeting } = req.body || {}
    if (!projectNo || !meeting) return res.status(400).json({ error: 'projectNo and meeting required' })
    let meetings = (await get(keyFor(projectNo))) || []
    if (!meeting.id) {
      meeting.id = `pcm_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`
      meeting.createdAt = Date.now()
      meetings.push(meeting)
    } else {
      const idx = meetings.findIndex(m => m.id === meeting.id)
      if (idx >= 0) meetings[idx] = { ...meetings[idx], ...meeting }
      else meetings.push(meeting)
    }
    await set(keyFor(projectNo), meetings)
    return res.json({ ok: true, id: meeting.id })
  }

  if (req.method === 'DELETE') {
    const { projectNo, id } = req.body || {}
    let meetings = (await get(keyFor(projectNo))) || []
    meetings = meetings.filter(m => m.id !== id)
    await set(keyFor(projectNo), meetings)
    return res.json({ ok: true })
  }

  res.status(405).end()
}

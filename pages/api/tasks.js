import { getLiveTasks, saveLiveTasks } from '../../lib/db'

// Live Project Tasks. Can be added manually or auto-created from an IHM.
// IHM-created tasks carry sourceIhm = projectNo and a stable key so re-finalising
// updates rather than duplicates.
//
// GET    /api/tasks                 -> { tasks }
// POST   /api/tasks { task }        -> add/update one
// POST   /api/tasks { action:'sync-ihm', projectNo, projectName, tasks:[...] }
//        -> replace all IHM tasks for that project with the given set
// DELETE /api/tasks { id }          -> remove
export default async function handler(req, res) {
  if (req.method === 'GET') {
    const tasks = await getLiveTasks()
    tasks.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    return res.json({ tasks })
  }

  if (req.method === 'POST') {
    const body = req.body || {}

    // Sync a project's IHM-derived tasks (called on "Meeting Complete").
    // COPY ONCE: only add tasks not already copied; never overwrite the live
    // version once it exists (the live page is master).
    if (body.action === 'sync-ihm') {
      const { projectNo, projectName, tasks: incoming } = body
      let tasks = await getLiveTasks()
      const existingIds = new Set(tasks.map(t => t.id))
      ;(incoming || []).forEach((t, i) => {
        if (!t || !t.description) return
        const id = `ihmtask_${projectNo}_${i}`
        if (existingIds.has(id)) return
        tasks.push({
          id,
          sourceIhm: projectNo,
          projectNo,
          projectName: projectName || '',
          description: t.description || '',
          assignee: t.assignee || '',
          closeOutDate: t.closeOutDate || '',
          closed: !!t.closed,
          comments: t.comments || '',
          attachments: [],
          createdAt: Date.now(),
        })
      })
      await saveLiveTasks(tasks)
      return res.json({ ok: true })
    }

    // Add / update a single task
    const { task } = body
    if (!task) return res.status(400).json({ error: 'Missing task' })
    let tasks = await getLiveTasks()
    if (!task.id) {
      task.id = `task_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`
      task.createdAt = Date.now()
      tasks.push(task)
    } else {
      const idx = tasks.findIndex(t => t.id === task.id)
      if (idx >= 0) tasks[idx] = { ...tasks[idx], ...task }
      else tasks.push(task)
    }
    await saveLiveTasks(tasks)
    return res.json({ ok: true, id: task.id })
  }

  if (req.method === 'DELETE') {
    const { id } = req.body || {}
    let tasks = await getLiveTasks()
    tasks = tasks.filter(t => t.id !== id)
    await saveLiveTasks(tasks)
    return res.json({ ok: true })
  }

  res.status(405).end()
}

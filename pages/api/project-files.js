import { getProjectFiles, saveProjectFiles } from '../../lib/db'

// Project files — drawings, RAMS, handover docs. Keyed per project number.
//
// GET    /api/project-files?no=J247            -> { files }        (all)
// GET    /api/project-files?no=J247&cat=drawing-> { files }        (filtered)
// POST   { projectNo, file:{ category,name,url,contentType,size } } -> add
// DELETE { projectNo, id }                     -> remove one
export default async function handler(req, res) {
  if (req.method === 'GET') {
    const { no, cat } = req.query
    if (!no) return res.status(400).json({ error: 'Project number required' })
    let files = await getProjectFiles(no)
    if (cat) files = files.filter(f => f.category === cat)
    files.sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0))
    return res.json({ files })
  }

  if (req.method === 'POST') {
    const { projectNo, file } = req.body || {}
    if (!projectNo || !file || !file.url) return res.status(400).json({ error: 'Missing file' })
    const files = await getProjectFiles(projectNo)
    files.push({
      id: 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      category: file.category || 'drawing',
      name: file.name || 'Untitled',
      url: file.url,
      contentType: file.contentType || '',
      size: file.size || 0,
      uploadedAt: Date.now(),
    })
    await saveProjectFiles(projectNo, files)
    return res.json({ ok: true, files })
  }

  if (req.method === 'DELETE') {
    const { projectNo, id } = req.body || {}
    if (!projectNo || !id) return res.status(400).json({ error: 'Missing id' })
    let files = await getProjectFiles(projectNo)
    files = files.filter(f => f.id !== id)
    await saveProjectFiles(projectNo, files)
    return res.json({ ok: true, files })
  }

  res.status(405).end()
}

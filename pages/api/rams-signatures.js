import { getRamsSignatures, saveRamsSignatures } from '../../lib/db'

// Per-document RAMS signatures for one project.
//
// GET  /api/rams-signatures?no=<projectNo>
//   -> { signatures: { [fileId]: { [opId]: { name, date, signedAt, statement, signatureImg } } } }
//
// POST /api/rams-signatures
//   body: { projectNo, fileId, opId, name, signatureImg, statement }
//   -> { ok:true, signature }
//   Records one operative's signature onto one RAMS document (version = fileId).
//   Re-uploading a RAMS mints a new fileId, so signatures don't carry over.
export const config = { api: { bodyParser: { sizeLimit: '2mb' } } }  // signature PNG data-URL

const STATEMENT = 'I confirm I have read, fully understood and will work to this and any other documents relating to this method statement. If at any point I feel it is unsafe to continue I will stop works and contact my supervisor. Any amendments to this method statement must be made by the person who originally completed it. It must then be communicated to the relevant persons.'

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const { no } = req.query
      if (!no) return res.status(400).json({ error: 'Project number required' })
      const signatures = await getRamsSignatures(no)
      return res.json({ signatures })
    }

    if (req.method === 'POST') {
      const { projectNo, fileId, opId, name, signatureImg } = req.body || {}
      if (!projectNo || !fileId || !opId) return res.status(400).json({ error: 'Missing projectNo/fileId/opId' })
      if (!name) return res.status(400).json({ error: 'Missing signer name' })
      if (!signatureImg) return res.status(400).json({ error: 'A signature is required' })

      const sigs = await getRamsSignatures(projectNo)
      sigs[fileId] = sigs[fileId] || {}
      sigs[fileId][opId] = {
        name,
        date: new Date().toISOString().slice(0, 10),
        signedAt: Date.now(),
        statement: STATEMENT,
        signatureImg,
      }
      await saveRamsSignatures(projectNo, sigs)
      return res.json({ ok: true, signature: sigs[fileId][opId] })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (e) {
    console.error('rams-signatures error:', e)
    return res.status(500).json({ error: e.message || 'Failed' })
  }
}


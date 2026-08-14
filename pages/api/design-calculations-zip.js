import { verifySessionToken, SESSION_COOKIE } from '../../lib/portalAuth'
import { getExternalUsers, externalCanAccessProject } from '../../lib/designUsers'
import { canAccessArea } from '../../lib/roles'
import { get } from '../../lib/db'
import zlib from 'zlib'

// Streams a set of stored files (by URL) into a single ZIP. Used by Handover Docs
// "Download all" / "Download selected". POST { projectNo, urls:[...], zipName }.
// Implemented WITHOUT any external zip library (no dependency to install) - it writes a
// standard ZIP by hand, DEFLATE-compressed, so it works reliably on Vercel serverless.

function readCookie(req, name) {
  const raw = req.headers.cookie || ''
  const m = raw.split(';').map(s => s.trim()).find(s => s.startsWith(name + '='))
  return m ? decodeURIComponent(m.split('=').slice(1).join('=')) : null
}
const HKEY = (no) => `design:calculations:${no}`

// CRC-32 (standard zip polynomial).
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0 }
  return t
})()
function crc32(buf) {
  let c = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8)
  return (c ^ 0xFFFFFFFF) >>> 0
}
function dosDateTime(d = new Date()) {
  const time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((Math.floor(d.getSeconds() / 2)) & 0x1f)
  const date = (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0x0f) << 5) | (d.getDate() & 0x1f)
  return { time, date }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const u = verifySessionToken(readCookie(req, SESSION_COOKIE))
  if (!u) return res.status(401).json({ error: 'Not logged in' })

  const projectNo = String(req.body?.projectNo || '').trim()
  if (!projectNo) return res.status(400).json({ error: 'Missing project' })

  // Access: internal design users, or the project's customers (they can download drawings).
  if (u.role === 'external') {
    const ext = (await getExternalUsers()).find(x => x.id === u.id && x.active !== false)
    if (!ext || !externalCanAccessProject(ext, projectNo)) return res.status(403).json({ error: 'No access' })
  } else if (!canAccessArea(u.role, 'design')) {
    return res.status(403).json({ error: 'No access' })
  }

  // Only allow URLs that belong to this project's rock drawings (flat array of docs).
  const docs = (await get(HKEY(projectNo))) || []
  const allowed = new Map()
  // Both the original and the stamped (Approved / Construction Issue) copy are valid
  // download targets - the page hands out stampedUrl when there is one.
  for (const d of (Array.isArray(docs) ? docs : [])) {
    if (d.url) allowed.set(d.url, d.name)
    if (d.stampedUrl) allowed.set(d.stampedUrl, d.name)
  }

  const requested = Array.isArray(req.body?.urls) ? req.body.urls : []
  const files = requested.map(url => ({ url, name: allowed.get(url) })).filter(f => f.name)
  if (!files.length) return res.status(400).json({ error: 'No valid files selected' })

  try {
    // Fetch all files and build the zip in memory.
    const entries = []
    const used = new Set()
    for (const f of files) {
      let upstream
      try { upstream = await fetch(f.url) } catch { continue }
      if (!upstream.ok) continue
      const content = Buffer.from(await upstream.arrayBuffer())
      let name = f.name || 'file'
      if (used.has(name)) { const dot = name.lastIndexOf('.'); const base = dot > 0 ? name.slice(0, dot) : name; const ext = dot > 0 ? name.slice(dot) : ''; let n = 2; while (used.has(`${base} (${n})${ext}`)) n++; name = `${base} (${n})${ext}` }
      used.add(name)
      entries.push({ name, content })
    }
    if (!entries.length) return res.status(502).json({ error: 'None of the files could be fetched' })

    const chunks = []
    const central = []
    let offset = 0
    const { time, date } = dosDateTime()

    for (const e of entries) {
      const nameBuf = Buffer.from(e.name, 'utf8')
      const crc = crc32(e.content)
      const compressed = zlib.deflateRawSync(e.content)
      const useDeflate = compressed.length < e.content.length
      const method = useDeflate ? 8 : 0
      const body = useDeflate ? compressed : e.content

      const local = Buffer.alloc(30)
      local.writeUInt32LE(0x04034b50, 0)
      local.writeUInt16LE(20, 4)           // version needed
      local.writeUInt16LE(0x0800, 6)       // flags: UTF-8 names
      local.writeUInt16LE(method, 8)
      local.writeUInt16LE(time, 10)
      local.writeUInt16LE(date, 12)
      local.writeUInt32LE(crc, 14)
      local.writeUInt32LE(body.length, 18)
      local.writeUInt32LE(e.content.length, 22)
      local.writeUInt16LE(nameBuf.length, 26)
      local.writeUInt16LE(0, 28)
      chunks.push(local, nameBuf, body)

      const cen = Buffer.alloc(46)
      cen.writeUInt32LE(0x02014b50, 0)
      cen.writeUInt16LE(20, 4)             // version made by
      cen.writeUInt16LE(20, 6)             // version needed
      cen.writeUInt16LE(0x0800, 8)         // flags
      cen.writeUInt16LE(method, 10)
      cen.writeUInt16LE(time, 12)
      cen.writeUInt16LE(date, 14)
      cen.writeUInt32LE(crc, 16)
      cen.writeUInt32LE(body.length, 20)
      cen.writeUInt32LE(e.content.length, 24)
      cen.writeUInt16LE(nameBuf.length, 28)
      cen.writeUInt16LE(0, 30)             // extra len
      cen.writeUInt16LE(0, 32)             // comment len
      cen.writeUInt16LE(0, 34)             // disk
      cen.writeUInt16LE(0, 36)             // internal attrs
      cen.writeUInt32LE(0, 38)             // external attrs
      cen.writeUInt32LE(offset, 42)        // local header offset
      central.push(cen, nameBuf)

      offset += local.length + nameBuf.length + body.length
    }

    const centralBuf = Buffer.concat(central)
    const end = Buffer.alloc(22)
    end.writeUInt32LE(0x06054b50, 0)
    end.writeUInt16LE(0, 4)
    end.writeUInt16LE(0, 6)
    end.writeUInt16LE(entries.length, 8)
    end.writeUInt16LE(entries.length, 10)
    end.writeUInt32LE(centralBuf.length, 12)
    end.writeUInt32LE(offset, 16)
    end.writeUInt16LE(0, 20)

    const zip = Buffer.concat([...chunks, centralBuf, end])
    const zipName = (String(req.body?.zipName || 'handover-docs').replace(/[^\w.\- ]+/g, '_')) + '.zip'
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`)
    res.setHeader('Content-Length', zip.length)
    return res.status(200).send(zip)
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Could not build zip' })
  }
}

export const config = { api: { responseLimit: false } }

import { upload } from '@vercel/blob/client'

// ONE WAY TO UPLOAD A FILE.
//
// There were two, and the difference decided whether a file could be uploaded at all.
//
//   POST /api/upload-file        the file's bytes go through our own serverless
//                                function. Vercel caps a serverless request body at
//                                about 4.5MB, and over that the PLATFORM rejects it
//                                before our code runs.
//
//   @vercel/blob/client upload   the browser sends the file straight to Blob storage
//                                and only a token passes through us. No practical
//                                size limit.
//
// The design pages already used the second. Everything else used the first, so a RAMS
// PDF over 4.5MB was refused while a smaller one from the same person on the same
// screen went up fine - which is exactly the "works for me, not for them" report.
//
// Worse, the rejection is a PLAIN TEXT body reading "Request Entity Too Large". Every
// call site then did `await res.json()` on it, so the user was shown
//
//     Unexpected token 'R', "Request En"... is not valid JSON
//
// which says nothing about the file being too big.
//
// Returns { url, contentType, size } - the same shape /api/upload-file returned, so
// call sites need no other change.
export async function uploadFile(file) {
  if (!file) throw new Error('No file')
  try {
    const blob = await upload(file.name || `file-${Date.now()}`, file, {
      access: 'public',
      handleUploadUrl: '/api/blob-upload',
      contentType: file.type || 'application/octet-stream',
    })
    return { url: blob.url, contentType: file.type || 'application/octet-stream', size: file.size || 0 }
  } catch (e) {
    // Say what went wrong in words the person can act on. A size limit they cannot
    // see is not something to leave them guessing at.
    const raw = String((e && e.message) || e || 'Upload failed')
    if (/entity too large|413|payload/i.test(raw)) {
      throw new Error(`"${file.name}" is too large to upload. Split it or compress it and try again.`)
    }
    if (/not valid JSON|Unexpected token/i.test(raw)) {
      throw new Error(`"${file.name}" was rejected by the server - it is most likely too large.`)
    }
    throw new Error(raw)
  }
}

export default uploadFile

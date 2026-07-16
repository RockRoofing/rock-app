// Client-side image compression. Resizes large photos and re-encodes as JPEG so
// uploads are far smaller while staying clearly viewable on screen.
//
// - ONLY touches real raster images (jpeg/png/webp/etc). PDFs, CSVs, xlsx and any
//   non-image file are returned UNCHANGED (compressing them would corrupt them).
// - Keeps aspect ratio; downscales only if larger than MAX_DIM.
// - Skips images already small enough (no point re-encoding).
// - Fails safe: if anything goes wrong, returns the ORIGINAL file so an upload
//   never breaks because of compression.
//
// Usage:  const toUpload = await compressImage(file)

const MAX_DIM = 1600      // longest edge, px — sharp for full-screen viewing
const QUALITY = 0.8       // JPEG quality — visually clean for photo evidence
const SKIP_UNDER = 500 * 1024   // don't bother compressing files under ~500KB

function isCompressibleImage(file) {
  if (!file || !file.type) return false
  const t = file.type.toLowerCase()
  // GIFs can be animated — re-encoding would flatten them; leave alone.
  return t === 'image/jpeg' || t === 'image/jpg' || t === 'image/png' || t === 'image/webp' || t === 'image/heic' || t === 'image/heif'
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = url
  })
}

export async function compressImage(file) {
  try {
    if (!isCompressibleImage(file)) return file
    if (file.size && file.size < SKIP_UNDER) return file
    if (typeof document === 'undefined') return file   // SSR guard

    const url = URL.createObjectURL(file)
    let img
    try { img = await loadImage(url) } finally { /* revoke after draw */ }

    let { width, height } = img
    if (!width || !height) { URL.revokeObjectURL(url); return file }

    // Scale down so the longest edge is at most MAX_DIM.
    const scale = Math.min(1, MAX_DIM / Math.max(width, height))
    const w = Math.round(width * scale)
    const h = Math.round(height * scale)

    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')
    // White backing so PNG transparency doesn't turn black when saved as JPEG.
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0, w, h)
    URL.revokeObjectURL(url)

    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', QUALITY))
    if (!blob) return file
    // If compression somehow made it bigger, keep the original.
    if (blob.size >= file.size) return file

    const baseName = (file.name || `photo-${Date.now()}`).replace(/\.[^.]+$/, '')
    return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg', lastModified: Date.now() })
  } catch (e) {
    console.error('compressImage failed, using original:', e)
    return file   // never block an upload because of compression
  }
}

// Convenience for multiple files.
export async function compressImages(files) {
  return Promise.all(Array.from(files || []).map(compressImage))
}

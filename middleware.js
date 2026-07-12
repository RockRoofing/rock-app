import { NextResponse } from 'next/server'

const SESSION_COOKIE = 'rr_portal_session'

// Edge-safe HMAC verify of the session token (mirrors lib/portalAuth.js).
async function verifyToken(token, secret) {
  if (!token || !token.includes('.')) return null
  const [body, sig] = token.split('.')
  try {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
    const expected = btoa(String.fromCharCode(...new Uint8Array(mac))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    if (expected !== sig) return null
    const payload = JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/')))
    if (!payload.exp || payload.exp < Date.now()) return null
    return payload
  } catch { return null }
}

// Operative Site App lives on siteapp.rockroofing.co.uk (formerly forms.).
export async function middleware(req) {
  const host = (req.headers.get('host') || '').toLowerCase()
  const isForms = host.startsWith('siteapp.') || host.startsWith('forms.')

  // ── Site App subdomain routing (unchanged) ──
  if (isForms) {
    const url = req.nextUrl.clone()
    const { pathname } = url
    const passthrough =
      pathname.startsWith('/_next') ||
      pathname.startsWith('/favicon') ||
      pathname === '/rock-logo.jpg' ||
      pathname.startsWith('/api/forms') ||
      pathname.startsWith('/api/submissions') ||
      pathname.startsWith('/api/ops-users') ||
      pathname.startsWith('/api/ops-docs') ||
      pathname.startsWith('/api/ops-projects') ||
      pathname.startsWith('/api/project-files') ||
      pathname.startsWith('/api/upload-file') ||
      pathname.startsWith('/api/team') ||
      pathname.startsWith('/api/upload-photo') ||
      pathname.startsWith('/api/dashboard') ||
      pathname.startsWith('/api/issues') ||
      pathname.startsWith('/api/issue-notify') ||
      pathname.startsWith('/api/issue-send-customer') ||
      pathname.startsWith('/api/issue-pdf') ||
      pathname.startsWith('/api/download') ||
      pathname.startsWith('/api/deliveries') ||
      pathname.startsWith('/api/operatives') ||
      pathname.startsWith('/api/planning')
    if (passthrough) return NextResponse.next()
    if (pathname === '/forms' || pathname.startsWith('/forms/')) return NextResponse.next()
    url.pathname = '/forms'
    return NextResponse.rewrite(url)
  }

  // ── Main portal: require login ──
  const { pathname } = req.nextUrl
  // Always allow: static, the login page & its API, Xero OAuth callback, logo.
  const isOpen =
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname === '/rock-logo.jpg' ||
    pathname === '/login' ||
    pathname.startsWith('/go/') ||
    pathname === '/api/portal-auth' ||
    pathname.startsWith('/xero-callback') ||
    pathname.startsWith('/api/xero')
  if (isOpen) return NextResponse.next()

  const token = req.cookies.get(SESSION_COOKIE)?.value
  const session = await verifyToken(token, process.env.SESSION_SECRET || 'dev-insecure-secret-change-me')
  if (!session) {
    // API calls get a 401; page requests redirect to /login.
    if (pathname.startsWith('/api/')) {
      return new NextResponse(JSON.stringify({ error: 'Not authenticated' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
    }
    const url = req.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
}

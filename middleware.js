import { NextResponse } from 'next/server'

// Operative Site App lives on siteapp.rockroofing.co.uk (formerly forms.).
// This middleware is the single source of truth for that subdomain:
//   1. Rewrites the subdomain root and paths into the /forms app.
//   2. Keeps the subdomain isolated from the rest of the portal.
// (The old next.config.js rewrite was removed to avoid double-handling.)
export function middleware(req) {
  const host = (req.headers.get('host') || '').toLowerCase()
  // siteapp. is the live subdomain. forms. kept as a fallback so old links/
  // bookmarks still resolve during the transition.
  const isForms = host.startsWith('siteapp.') || host.startsWith('forms.')
  if (!isForms) return NextResponse.next()

  const url = req.nextUrl.clone()
  const { pathname } = url

  // Assets and the APIs the forms app needs pass straight through, untouched.
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
    pathname.startsWith('/api/dashboard')

  if (passthrough) return NextResponse.next()

  // Already in the forms app: serve as-is.
  if (pathname === '/forms' || pathname.startsWith('/forms/')) {
    return NextResponse.next()
  }

  // Root of the subdomain -> forms home.
  if (pathname === '/') {
    url.pathname = '/forms'
    return NextResponse.rewrite(url)
  }

  // Anything else on the subdomain (e.g. someone trying /operations) is not
  // allowed here — send them to the forms home.
  url.pathname = '/forms'
  return NextResponse.rewrite(url)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
}

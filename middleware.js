import { NextResponse } from 'next/server'

// Operative Forms app lives on forms.rockroofing.co.uk.
// This middleware is the single source of truth for that subdomain:
//   1. Rewrites the subdomain root and paths into the /forms app.
//   2. Keeps the subdomain isolated from the rest of the portal.
// (The old next.config.js rewrite was removed to avoid double-handling.)
export function middleware(req) {
  const host = (req.headers.get('host') || '').toLowerCase()
  const isForms = host.startsWith('forms.')
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

import { NextResponse } from 'next/server'

// Keep the operative forms subdomain isolated from the main portal.
// On forms.rockroofing.co.uk we only allow the /forms app and the APIs it uses.
export function middleware(req) {
  const host = req.headers.get('host') || ''
  const { pathname } = req.nextUrl

  if (host.startsWith('forms.')) {
    const allowed =
      pathname === '/' ||
      pathname.startsWith('/forms') ||
      pathname.startsWith('/_next') ||
      pathname.startsWith('/favicon') ||
      pathname === '/rock-logo.jpg' ||
      // APIs the forms app legitimately needs
      pathname.startsWith('/api/forms') ||
      pathname.startsWith('/api/submissions') ||
      pathname.startsWith('/api/ops-users') ||
      pathname.startsWith('/api/ops-docs') ||
      pathname.startsWith('/api/upload-photo') ||
      pathname.startsWith('/api/dashboard')  // read-only project list

    if (!allowed) {
      const url = req.nextUrl.clone()
      url.pathname = '/forms'
      return NextResponse.redirect(url)
    }
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
}

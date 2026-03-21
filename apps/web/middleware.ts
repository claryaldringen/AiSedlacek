import { NextRequest, NextResponse } from 'next/server';

export function middleware(req: NextRequest): NextResponse {
  const isPublic =
    req.nextUrl.pathname === '/' ||
    req.nextUrl.pathname.startsWith('/login') ||
    req.nextUrl.pathname.startsWith('/view') ||
    req.nextUrl.pathname.startsWith('/api/auth') ||
    req.nextUrl.pathname.startsWith('/api/public') ||
    req.nextUrl.pathname.startsWith('/api/billing/webhook');

  if (isPublic) {
    return NextResponse.next();
  }

  // Check for session cookie (NextAuth v5 uses authjs.session-token)
  const hasSession =
    req.cookies.has('authjs.session-token') ||
    req.cookies.has('__Secure-authjs.session-token');

  if (!hasSession) {
    const loginUrl = new URL('/login', req.nextUrl.origin);
    loginUrl.searchParams.set('callbackUrl', req.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|hero/|api/images).*)'],
};

import { auth } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';

export default auth((req: NextRequest & { auth: unknown }) => {
  const isPublic =
    req.nextUrl.pathname === '/' ||
    req.nextUrl.pathname.startsWith('/login') ||
    req.nextUrl.pathname.startsWith('/view') ||
    req.nextUrl.pathname.startsWith('/api/auth') ||
    req.nextUrl.pathname.startsWith('/api/public');
  if (!req.auth && !isPublic) {
    const loginUrl = new URL('/login', req.nextUrl.origin);
    loginUrl.searchParams.set('callbackUrl', req.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|hero/|api/images).*)'],
};

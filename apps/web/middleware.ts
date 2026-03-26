import createMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';
import { routing } from './i18n/routing';

const intlMiddleware = createMiddleware(routing);

const PUBLIC_PATHS = [
  '/',
  '/login',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/view',
];

function isPublicRoute(pathname: string): boolean {
  const localePrefix = new RegExp(`^/(${routing.locales.join('|')})`);
  const withoutLocale = pathname.replace(localePrefix, '') || '/';
  return PUBLIC_PATHS.some((p) => withoutLocale === p || withoutLocale.startsWith(p + '/'));
}

function getLocaleFromPath(pathname: string): string {
  const match = pathname.match(new RegExp(`^/(${routing.locales.join('|')})\\b`));
  return match?.[1] ?? routing.defaultLocale;
}

export function middleware(req: NextRequest): NextResponse {
  if (req.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  const response = intlMiddleware(req);

  // If next-intl returned a redirect, return it directly
  if (!response.ok) {
    return response;
  }

  // Auth check for non-public routes
  const pathname = req.nextUrl.pathname;
  if (!isPublicRoute(pathname)) {
    const hasSession =
      req.cookies.has('authjs.session-token') || req.cookies.has('__Secure-authjs.session-token');
    if (!hasSession) {
      const locale = getLocaleFromPath(pathname);
      const loginUrl = new URL(`/${locale}/login`, req.nextUrl.origin);
      loginUrl.searchParams.set('callbackUrl', pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|hero/|api/images).*)'],
};

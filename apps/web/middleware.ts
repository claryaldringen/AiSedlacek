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

function hasSessionCookie(req: NextRequest): boolean {
  return (
    req.cookies.has('authjs.session-token') || req.cookies.has('__Secure-authjs.session-token')
  );
}

function redirectToLogin(req: NextRequest, locale: string): NextResponse {
  const loginUrl = new URL(`/${locale}/login`, req.nextUrl.origin);
  // Včetně query – /auth/cli?state=…&redirect=… bez ní po přihlášení nefunguje.
  loginUrl.searchParams.set('callbackUrl', req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.redirect(loginUrl);
}

export function middleware(req: NextRequest): NextResponse {
  if (req.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // Autorizace CLI (`ais login`) leží mimo [locale]: next-intl by ji přesměroval
  // na neexistující /en/auth/cli (404), takže `ais login` nefungoval.
  if (req.nextUrl.pathname === '/auth/cli') {
    return hasSessionCookie(req)
      ? NextResponse.next()
      : redirectToLogin(req, routing.defaultLocale);
  }

  const response = intlMiddleware(req);

  // If next-intl returned a redirect, return it directly
  if (!response.ok) {
    return response;
  }

  // Auth check for non-public routes
  const pathname = req.nextUrl.pathname;
  if (!isPublicRoute(pathname) && !hasSessionCookie(req)) {
    return redirectToLogin(req, getLocaleFromPath(pathname));
  }

  return response;
}

export const config = {
  // /api/* úplně mimo middleware: Next jinak kvůli middlewaru klonuje tělo každého
  // requestu do paměti a nad 10 MB ho ořízne – rozbíjelo to uploady skenů
  // (limit uploadu je 20 MB). Middleware pro API stejně nic nedělá.
  matcher: ['/((?!api/|_next/static|_next/image|favicon.ico|icon.svg|hero/).*)'],
};

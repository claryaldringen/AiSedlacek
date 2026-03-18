export { auth as middleware } from '@/lib/auth';

export const config = {
  // Protect all routes except login, register, auth API, static assets
  matcher: ['/((?!login|register|api/auth|_next/static|_next/image|favicon.ico|icon.svg).*)'],
};

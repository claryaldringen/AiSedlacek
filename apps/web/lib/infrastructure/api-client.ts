/**
 * Fetch wrapper that automatically adds X-Locale header.
 * Use instead of raw fetch() for API calls from client components.
 */
export function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const locale =
    typeof window !== 'undefined'
      ? (window.location.pathname.match(/^\/(en|cs)\b/)?.[1] ?? 'en')
      : 'en';

  const headers = new Headers(init?.headers);
  if (!headers.has('x-locale')) {
    headers.set('x-locale', locale);
  }

  return fetch(input, { ...init, headers });
}

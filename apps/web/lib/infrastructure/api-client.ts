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

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Jako apiFetch, ale ne-2xx odpověď vyhodí ApiError (s hláškou ze serveru, pokud
 * ji vrátil). fetch() na HTTP chybu nevyhazuje, takže optimistické úpravy UI
 * s `.catch()` dřív chybu serveru nikdy nezachytily a tvářily se jako úspěšné.
 */
export async function apiFetchOk(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await apiFetch(input, init);
  if (!res.ok) {
    const data = (await res
      .clone()
      .json()
      .catch(() => ({}))) as { error?: unknown };
    const message = typeof data.error === 'string' ? data.error : `HTTP ${res.status}`;
    throw new ApiError(message, res.status);
  }
  return res;
}

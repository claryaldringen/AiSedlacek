export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ApiResponse = any;

export type ApiClient = {
  get(path: string): Promise<ApiResponse>;
  postJson(path: string, data: unknown): Promise<ApiResponse>;
  patchJson(path: string, data: unknown): Promise<ApiResponse>;
  delete(path: string): Promise<ApiResponse>;
  postFormData(path: string, formData: FormData): Promise<ApiResponse>;
  getRaw(path: string): Promise<Response>;
};

// Povolíme jen HTTPS; výjimka je localhost přes HTTP kvůli lokálnímu vývoji.
function isSecureBaseUrl(serverUrl: string): boolean {
  try {
    const u = new URL(serverUrl);
    if (u.protocol === 'https:') return true;
    if (u.protocol === 'http:') {
      return u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '::1';
    }
    return false;
  } catch {
    return false;
  }
}

export function createApiClient(serverUrl: string, token: string): ApiClient {
  // Bezpečnost: Bearer token nikdy neposílej přes nezašifrované HTTP (mimo localhost dev).
  if (token && !isSecureBaseUrl(serverUrl)) {
    throw new Error(
      `Nezabezpečené spojení: ${serverUrl}. Bearer token lze posílat pouze přes HTTPS ` +
        `(výjimka: localhost pro vývoj). Změňte 'server' v konfiguraci na https://.`,
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function request(path: string, init?: RequestInit): Promise<any> {
    const url = `${serverUrl}${path}`;
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...init?.headers,
      },
    });

    if (res.status === 401) {
      throw new ApiError(401, 'Nejste přihlášen. Spusťte `ais login`.');
    }

    const body = await res.json().catch(() => null);

    if (!res.ok) {
      const msg = body?.error ?? `Server vrátil ${res.status}`;
      throw new ApiError(res.status, msg);
    }

    return body;
  }

  return {
    get(path: string) {
      return request(path);
    },

    postJson(path: string, data: unknown) {
      return request(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    },

    patchJson(path: string, data: unknown) {
      return request(path, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    },

    delete(path: string) {
      return request(path, { method: 'DELETE' });
    },

    async postFormData(path: string, formData: FormData) {
      return request(path, {
        method: 'POST',
        body: formData,
        headers: {},
      });
    },

    getRaw(path: string): Promise<Response> {
      const url = `${serverUrl}${path}`;
      return fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
    },
  };
}

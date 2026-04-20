export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function createApiClient(serverUrl: string, token: string) {
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

export type ApiClient = ReturnType<typeof createApiClient>;

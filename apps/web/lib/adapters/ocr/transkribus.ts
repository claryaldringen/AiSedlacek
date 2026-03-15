import type { IOcrEngine } from '@ai-sedlacek/shared';
import type { OcrEngineResult, OcrOptions, TranskribusConfig } from '@ai-sedlacek/shared';

const TRANSKRIBUS_TOKEN_URL =
  'https://account.readcoop.eu/auth/realms/readcoop/protocol/openid-connect/token';
const TRANSKRIBUS_PROCESS_URL = 'https://transkribus.eu/processing/v1/processes';

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 60;

interface TokenResponse {
  access_token: string;
}

interface ProcessResponse {
  processId: string;
}

interface ProcessStatusResponse {
  status: 'CREATED' | 'WAITING' | 'RUNNING' | 'FINISHED' | 'FAILED';
  content?: {
    text?: string;
  };
}

export class TranskribusOcrEngine implements IOcrEngine {
  readonly name = 'transkribus' as const;
  readonly role = 'recognizer' as const;

  constructor(private readonly config?: TranskribusConfig) {}

  async isAvailable(): Promise<boolean> {
    return !!(process.env['TRANSKRIBUS_EMAIL'] && process.env['TRANSKRIBUS_PASSWORD']);
  }

  async recognize(image: Buffer, options?: OcrOptions): Promise<OcrEngineResult> {
    void options; // options reserved for future use
    const startTime = Date.now();

    const token = await this.authenticate();
    const processId = await this.submitJob(token, image);
    const text = await this.pollForResult(token, processId);

    return {
      engine: this.name,
      role: this.role,
      text,
      processingTimeMs: Date.now() - startTime,
    };
  }

  private async authenticate(): Promise<string> {
    const email = process.env['TRANSKRIBUS_EMAIL'];
    const password = process.env['TRANSKRIBUS_PASSWORD'];

    if (!email || !password) {
      throw new Error('Transkribus credentials not configured');
    }

    const response = await fetch(TRANSKRIBUS_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        username: email,
        password: password,
        client_id: 'processing-api-client',
      }).toString(),
    });

    if (!response.ok) {
      throw new Error(`Transkribus authentication failed: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as TokenResponse;
    return data.access_token;
  }

  private async submitJob(token: string, image: Buffer): Promise<string> {
    const imageBase64 = image.toString('base64');
    const modelId = this.config?.modelId ?? process.env['TRANSKRIBUS_MODEL_ID'];

    const body: Record<string, unknown> = {
      config: {
        textRecognition: {
          ...(modelId !== undefined ? { htrId: modelId } : {}),
        },
      },
      image: {
        base64: imageBase64,
      },
    };

    const response = await fetch(TRANSKRIBUS_PROCESS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Transkribus job submission failed: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as ProcessResponse;
    return data.processId;
  }

  private async pollForResult(token: string, processId: string): Promise<string> {
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

      const response = await fetch(`${TRANSKRIBUS_PROCESS_URL}/${processId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        throw new Error(`Transkribus status check failed: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as ProcessStatusResponse;

      if (data.status === 'FINISHED') {
        return data.content?.text ?? '';
      }

      if (data.status === 'FAILED') {
        throw new Error(`Transkribus job ${processId} failed`);
      }
    }

    throw new Error(`Transkribus job ${processId} timed out after ${MAX_POLL_ATTEMPTS} attempts`);
  }
}

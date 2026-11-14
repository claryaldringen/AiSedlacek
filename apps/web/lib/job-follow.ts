/**
 * Sledování už běžícího jobu, když route vrátí 409 `job_running` (stejná akce
 * nad stejným cílem už čeká nebo běží – viz `runningJobConflict` na serveru).
 * UI místo hlášky „akce už běží“ sleduje vrácený job, ať uživatel vidí stav
 * i výsledek bez ručního obnovení.
 */

/** Konec sledovaného jobu (stav z `/api/pages/process/status`). */
export interface JobEnd {
  status: 'completed' | 'error' | 'cancelled';
  errorCode: string | null;
}

/** Odpověď route, která zakládá job. */
export interface StartResponse {
  status: number;
  body: { jobId?: unknown; code?: unknown; error?: unknown };
}

/** jobId běžícího jobu z odpovědi 409 `job_running`, který má UI sledovat, nebo null. */
export function followableJobId(status: number, body: unknown): string | null {
  if (status !== 409 || typeof body !== 'object' || body === null) return null;
  const { code, jobId } = body as { code?: unknown; jobId?: unknown };
  return code === 'job_running' && typeof jobId === 'string' && jobId ? jobId : null;
}

/** jobId k sledování: nově založený job (2xx), nebo už běžící stejná akce (409). */
export function jobToFollow(response: StartResponse): string | null {
  if (response.status >= 200 && response.status < 300) {
    return typeof response.body.jobId === 'string' && response.body.jobId
      ? response.body.jobId
      : null;
  }
  return followableJobId(response.status, response.body);
}

/** Kolikrát nejvýš počkat na cizí retranslaci téhož dokumentu, než to UI vzdá. */
export const MAX_FOLLOWED_RETRANSLATIONS = 3;

export type RetranslateOutcome =
  /** Vlastní retranslace doběhla (completed / error / cancelled). */
  | { kind: 'done'; end: JobEnd }
  /** Route retranslaci nezaložila (kredit, chyba) – `response` s hláškou. */
  | { kind: 'not_started'; response: StartResponse }
  /** Retranslace téhož dokumentu běží pořád znovu – vzdáno po `maxFollow` čekáních. */
  | { kind: 'still_running' }
  /** UI mezitím přepnulo dokument – výsledek se už nemá aplikovat. */
  | { kind: 'stale' };

/**
 * Retranslace po uložení transkripce. Když už retranslace téhož dokumentu
 * a jazyka běží (409 `job_running`), počká na ni a pak spustí novou – ta už
 * vychází z aktuální transkripce, takže se poslední úprava do překladu promítne.
 * Opakuje se nejvýš `maxFollow`-krát.
 *
 * @param deps.start Založí retranslaci; `attempt` > 0 = opakování po cizím jobu
 *   (volající pak neposílá zastaralý `previousTranslation`, worker vezme
 *   aktuální překlad z DB).
 * @param deps.waitForJob Počká na konec jobu; `own` = false u cizího jobu.
 * @param deps.isStale true, když UI mezitím přepnulo na jiný dokument.
 */
export async function runRetranslation(deps: {
  start: (attempt: number) => Promise<StartResponse>;
  waitForJob: (jobId: string, own: boolean) => Promise<JobEnd>;
  isStale: () => boolean;
  maxFollow?: number;
}): Promise<RetranslateOutcome> {
  const maxFollow = deps.maxFollow ?? MAX_FOLLOWED_RETRANSLATIONS;
  for (let attempt = 0; ; attempt++) {
    const response = await deps.start(attempt);
    if (deps.isStale()) return { kind: 'stale' };
    if (response.status >= 200 && response.status < 300) {
      const jobId = jobToFollow(response);
      if (!jobId) return { kind: 'not_started', response };
      const end = await deps.waitForJob(jobId, true);
      return deps.isStale() ? { kind: 'stale' } : { kind: 'done', end };
    }
    const runningJobId = followableJobId(response.status, response.body);
    if (!runningJobId) return { kind: 'not_started', response };
    if (attempt >= maxFollow) return { kind: 'still_running' };
    // Cizí retranslace téhož dokumentu (jiná záložka, předchozí úprava) – její
    // výsledek nevadí, po ní se spustí nová s aktuální transkripcí.
    await deps.waitForJob(runningJobId, false);
    if (deps.isStale()) return { kind: 'stale' };
  }
}

/**
 * Počká na konec jobu pollováním stavu (`fetchStatus` → `/api/pages/process/status`).
 * Výpadek sítě ani přechodná chyba serveru (5xx, 429) pollování nepřeruší
 * (job běží dál na serveru), nečitelný job (404/403) skončí jako `error` bez kódu. Po `signal.abort()` (přepnutí
 * dokumentu, odpojení komponenty) vrátí `cancelled` a dál se nedotazuje.
 */
export function waitForJobEnd(
  jobId: string,
  options: {
    fetchStatus: (jobId: string) => Promise<Response>;
    signal?: AbortSignal;
    intervalMs?: number;
    onStep?: (step: string) => void;
  },
): Promise<JobEnd> {
  const { fetchStatus, signal, intervalMs = 2000, onStep } = options;
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;
    const finish = (end: JobEnd): void => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      signal?.removeEventListener('abort', onAbort);
      resolve(end);
    };
    const onAbort = (): void => finish({ status: 'cancelled', errorCode: null });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort);

    const tick = async (): Promise<void> => {
      timer = null;
      try {
        const res = await fetchStatus(jobId);
        if (settled) return;
        // Přechodná chyba serveru (502/503 při deployi, 429) – job běží dál,
        // zkusit znovu. Konec jen u nečitelného jobu (401/403/404 apod.).
        if (!res.ok && res.status < 500 && res.status !== 429) {
          finish({ status: 'error', errorCode: null });
          return;
        }
        if (res.ok) {
          const data = (await res.json()) as {
            status?: string;
            currentStep?: string | null;
            errorCode?: string | null;
          };
          if (settled) return;
          if (data.currentStep) onStep?.(data.currentStep);
          if (
            data.status === 'completed' ||
            data.status === 'error' ||
            data.status === 'cancelled'
          ) {
            finish({ status: data.status, errorCode: data.errorCode ?? null });
            return;
          }
        }
      } catch {
        // Výpadek sítě – job na serveru běží dál, zkusit znovu
        if (settled) return;
      }
      timer = setTimeout(() => void tick(), intervalMs);
    };
    timer = setTimeout(() => void tick(), intervalMs);
  });
}

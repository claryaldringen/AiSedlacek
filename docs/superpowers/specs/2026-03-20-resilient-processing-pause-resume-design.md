# Resilientní zpracování s pause/resume

**Datum:** 2026-03-20
**Stav:** Schváleno

## Problém

Zpracování stránek (OCR + překlad) běží jako in-memory job na serveru. Pokud spadne SSE spojení nebo se restartuje server, stránky zůstanou viset ve stavu `processing` bez možnosti obnovení. Uživatel nemá možnost zpracování pozastavit — může ho pouze zrušit.

## Řešení

### 1. Pause/Resume mechanismus (server-side)

Rozšíření `ProcessingJob` interface v `processing-jobs.ts`:

```typescript
interface ProcessingJob {
  // ... existující pole ...
  paused: boolean;
  pausePromise: Promise<void> | null;
  pauseResolve: (() => void) | null;
}
```

Nové funkce:

- **`pauseJob(userId)`** — nastaví `job.paused = true`, vytvoří Promise která blokuje processing loop
- **`resumeJob(userId)`** — nastaví `job.paused = false`, resolve čekající Promise
- **`isJobPaused(userId)`** — vrátí boolean

V processing loopu (`runProcessing` v `route.ts`): po dokončení každého batche/stránky zkontrolovat `job.paused`. Pokud ano, emitovat SSE event `paused` a čekat na resume Promise. Po resume emitovat `resumed` a pokračovat.

Pause dokončí aktuálně zpracovávanou stránku/batch a teprve pak zastaví. Nezhazuje rozdělanou práci. U multi-page batchů pause nabere účinnosti až po dokončení celého batche, protože `processWithClaudeBatch()` je atomická operace.

### 2. Cancel-while-paused

Pokud je job pozastavený (blokovaný na `pausePromise`) a uživatel klikne "Zrušit", cancel musí fungovat okamžitě. Implementace:

```typescript
// V pause checkpointu:
await Promise.race([job.pausePromise, abortSignalPromise(signal)]);
if (signal.aborted) { /* cancel logika */ }
```

`cancelJob()` navíc resolve `pausePromise`, aby se processing loop odblokoval.

### 3. API endpointy

Všechny endpointy vyžadují autentizaci přes `requireUserId()` a filtrují dle `userId`.

| Metoda | Endpoint | Popis |
|--------|----------|-------|
| POST | `/api/pages/process/pause` | Pozastaví aktivní job. Vrátí 200 `{ status: 'paused' }` nebo 404. |
| POST | `/api/pages/process/resume` | Obnoví pozastavený job. Vrátí 200 `{ status: 'resumed' }` nebo 404. |
| POST | `/api/pages/process/cancel` | Beze změny (jen přidání ikony v UI). |
| GET | `/api/pages/process/interrupted` | Vrátí `{ count: number, pageIds: string[] }` stránek ve stavu `processing` bez aktivního jobu pro daného uživatele. |
| POST | `/api/pages/process/interrupted` | Resetuje osiřelé `processing` stránky na `pending`. Vrátí `{ reset: number }`. |

Endpoint `interrupted` je pod `/api/pages/process/` pro konzistenci se zbytkem processing endpointů.

### 4. SSE eventy

Nové typy eventů:

- **`paused`** — `{ message: "Zpracování pozastaveno", progress: number }`
- **`resumed`** — `{ message: "Zpracování obnoveno", progress: number }`

Existující eventy beze změny.

### 5. UI: Stav `isPaused` na klientovi

Workspace page přidá stav `isPaused: boolean`:
- Nastaví `true` při příjmu SSE eventu `paused`
- Nastaví `false` při příjmu SSE eventu `resumed`
- Při reconnectu: pokud poslední event v historii je `paused`, nastavit `isPaused = true`
- Předá se do `Toolbar` jako nová prop

### 6. UI: Tlačítka v progress baru

Toolbar progress bar aktuálně zobrazuje tlačítko "Zrušit". Rozšíření:

**Během zpracování** (modrý progress bar):
```
[spinner] Zpracovávám stránku 5/93…  ████████░░ 42%    [⏸ Pozastavit] [⏹ Zrušit]
```

**Po pozastavení** (žluto-oranžový progress bar, bez spinneru):
```
[—] Pozastaveno (5/93)               ████████░░ 42%    [▶ Pokračovat] [⏹ Zrušit]
```

Ikony ve stylu ovládání přehrávače (SVG, viewBox 0 0 24 24):
- ⏸ Pause (dva svislé pruhy) — `M6 4h4v16H6V4zm8 0h4v16h-4V4z`
- ▶ Play (trojúhelník) — existující SVG ikona pro "Zpracovat"
- ⏹ Stop (čtverec) — `M6 6h12v12H6V6z`

Tlačítka mají nápis i ikonu. Všechna tlačítka mají `title` atribut pro accessibility.

### 7. UI: Banner přerušeného zpracování

Při načtení workspace stránky klient zavolá `GET /api/pages/process/interrupted`. Pokud existují osiřelé stránky, zobrazí se žlutý banner:

```
⚠ Zpracování 255 stránek bylo přerušeno.  [▶ Pokračovat] [✕ Resetovat]
```

- **"Pokračovat"** — zavolá POST `/api/pages/process/interrupted` (reset na `pending`), pak spustí nový `POST /api/pages/process` se stejnými pageIds
- **"Resetovat"** — zavolá POST `/api/pages/process/interrupted`, banner zmizí, stránky se zobrazí jako `pending`
- Banner zmizí po jakékoliv akci

### 8. Pause checkpoint v processing loopu

Stávající abort checkpointy (3 místa v `runProcessing`) se rozšíří o pause check. Checkpoint se provede po dokončení každé stránky (single) nebo celého batche (multi-page):

```typescript
// Pomocná funkce pro pause checkpoint:
async function waitIfPaused(job: ProcessingJob, signal: AbortSignal, userId: string, progress: number): Promise<void> {
  if (!job.paused) return;
  emitEvent(userId, 'paused', { message: 'Zpracování pozastaveno', progress });
  await Promise.race([job.pausePromise, abortSignalPromise(signal)]);
  if (signal.aborted) return;  // cancel logika se zpracuje výše
  emitEvent(userId, 'resumed', { message: 'Zpracování obnoveno', progress });
}
```

### 9. Omezení: Serverless prostředí

Detekce přerušených stránek (`interrupted` endpoint) spoléhá na in-memory stav `activeJobs`. V single-process prostředí (lokální vývoj) funguje spolehlivě. V serverless prostředí (Vercel) může být endpoint obsluhován jiným procesem než tím, který má job v paměti.

Pro produkční nasazení na Vercel: endpoint považuje stránky ve stavu `processing` za přerušené, pokud pro daného uživatele neexistuje žádný aktivní job v aktuálním procesu. To je v praxi dostatečné, protože po cold startu Vercelu se in-memory joby ztratí a stránky skutečně jsou osiřelé.

### 10. Soubory ke změně

| Soubor | Typ změny |
|--------|-----------|
| `apps/web/lib/infrastructure/processing-jobs.ts` | Rozšíření: `pauseJob()`, `resumeJob()`, `isJobPaused()`, nová pole v `ProcessingJob`, úprava `cancelJob()` pro resolve pausePromise |
| `apps/web/app/api/pages/process/route.ts` | Pause checkpointy v `runProcessing()` |
| `apps/web/app/api/pages/process/pause/route.ts` | Nový endpoint |
| `apps/web/app/api/pages/process/resume/route.ts` | Nový endpoint |
| `apps/web/app/api/pages/process/interrupted/route.ts` | Nový endpoint (GET + POST) |
| `apps/web/components/Toolbar.tsx` | Pause/Resume/Cancel tlačítka s ikonami, nová prop `isPaused` |
| `apps/web/app/workspace/page.tsx` | `isPaused` stav, pause/resume handlery, interrupted banner, handling nových SSE eventů |

### 11. Co se nemění

- Batching logika
- Hash cache
- Reconnect logika (už funguje)
- Databázové schéma (žádné migrace)

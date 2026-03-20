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

Pause dokončí aktuálně zpracovávanou stránku/batch a teprve pak zastaví. Nezhazuje rozdělanou práci.

### 2. API endpointy

| Metoda | Endpoint | Popis |
|--------|----------|-------|
| POST | `/api/pages/process/pause` | Pozastaví aktivní job. Vrátí 200 `{ status: 'paused' }` nebo 404 pokud žádný job neběží. |
| POST | `/api/pages/process/resume` | Obnoví pozastavený job. Vrátí 200 `{ status: 'resumed' }` nebo 404. |
| POST | `/api/pages/process/cancel` | Beze změny. |
| GET | `/api/pages/interrupted` | Vrátí `{ count: number, pageIds: string[] }` stránek ve stavu `processing` bez aktivního jobu. |
| POST | `/api/pages/interrupted/reset` | Resetuje osiřelé `processing` stránky na `pending`. Vrátí `{ reset: number }`. |

### 3. SSE eventy

Nové typy eventů:

- **`paused`** — `{ message: "Zpracování pozastaveno", progress: number }`
- **`resumed`** — `{ message: "Zpracování obnoveno", progress: number }`

Existující eventy beze změny.

### 4. UI: Tlačítka v progress baru

Toolbar progress bar aktuálně zobrazuje tlačítko "Zrušit". Rozšíření:

**Během zpracování** (modrý progress bar):
```
[spinner] Zpracovávám stránku 5/93…  ████████░░ 42%    [⏸ Pozastavit] [⏹ Zrušit]
```

**Po pozastavení** (žluto-oranžový progress bar, bez spinneru):
```
[—] Pozastaveno (5/93)               ████████░░ 42%    [▶ Pokračovat] [⏹ Zrušit]
```

Ikony ve stylu ovládání přehrávače:
- ⏸ Pause (dva svislé pruhy) — SVG `M6 4h4v16H6V4zm8 0h4v16h-4V4z`
- ▶ Play (trojúhelník) — existující SVG ikona pro "Zpracovat"
- ⏹ Stop (čtverec) — SVG `M6 6h12v12H6V6z`

Tlačítka mají nápis i ikonu.

### 5. UI: Banner přerušeného zpracování

Při načtení workspace stránky klient zavolá `GET /api/pages/interrupted`. Pokud existují osiřelé stránky, zobrazí se žlutý banner:

```
⚠ Zpracování 255 stránek bylo přerušeno.  [▶ Pokračovat] [✕ Resetovat]
```

- **"Pokračovat"** — zavolá POST `/api/pages/interrupted/reset` (reset na `pending`), pak spustí nový `POST /api/pages/process` se stejnými pageIds
- **"Resetovat"** — zavolá POST `/api/pages/interrupted/reset`, banner zmizí, stránky se zobrazí jako `pending`
- Banner zmizí po jakékoliv akci

### 6. Pause checkpoint v processing loopu

Stávající abort checkpointy (3 místa v `runProcessing`) se rozšíří o pause check:

```typescript
// Po každém dokončeném batchi/stránce:
if (signal.aborted) { /* existující cancel logika */ }
if (job.paused) {
  emitEvent(userId, 'paused', { message: 'Zpracování pozastaveno', progress });
  await job.pausePromise;  // Blokuje do resume
  emitEvent(userId, 'resumed', { message: 'Zpracování obnoveno', progress });
}
```

### 7. Soubory ke změně

| Soubor | Typ změny |
|--------|-----------|
| `apps/web/lib/infrastructure/processing-jobs.ts` | Rozšíření: `pauseJob()`, `resumeJob()`, `isJobPaused()`, nová pole v `ProcessingJob` |
| `apps/web/app/api/pages/process/route.ts` | Pause checkpointy v `runProcessing()` |
| `apps/web/app/api/pages/process/pause/route.ts` | Nový endpoint |
| `apps/web/app/api/pages/process/resume/route.ts` | Nový endpoint |
| `apps/web/app/api/pages/interrupted/route.ts` | Nový endpoint (GET + POST) |
| `apps/web/components/Toolbar.tsx` | Pause/Resume/Cancel tlačítka s ikonami, stav `paused` |
| `apps/web/app/workspace/page.tsx` | Pause/resume handlery, interrupted banner, SSE event handling |

### 8. Co se nemění

- Batching logika
- Hash cache
- Reconnect logika (už funguje)
- Cancel logika (jen přidání ikony)
- Databázové schéma (žádné migrace)

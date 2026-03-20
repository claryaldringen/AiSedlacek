# Token Billing System – Design Spec

## Přehled

Systém kreditového zůstatku tokenů pro multiuserovou aplikaci. Uživatelé si dobíjejí tokeny přes Stripe (kartou) nebo bankovním převodem (FIO API + QR kód). Tokeny se automaticky odpočítávají při OCR zpracování s konfigurovatelným multiplikátorem.

## Datový model

### TokenTransaction (nová tabulka)

Ledger přístup – zdroj pravdy jsou transakce, zůstatek = `SUM(amount)`.

```prisma
enum TokenTransactionType {
  topup_stripe
  topup_bank
  consumption
  refund
}

model TokenTransaction {
  id          String               @id @default(cuid())
  userId      String
  user        User                 @relation(fields: [userId], references: [id], onDelete: Cascade)
  type        TokenTransactionType
  amount      Int                  // kladné = kredit, záporné = debit (tokeny, ne peníze)
  amountCzk   Int?                 // částka v haléřích (jen pro topup transakce, pro audit)
  description String
  referenceId String?              // Stripe payment ID, FIO transaction ID, document ID
  createdAt   DateTime             @default(now())

  @@unique([userId, referenceId])  // idempotence – stejný referenceId se nevloží dvakrát
  @@index([userId, createdAt])
}
```

### User (rozšíření)

```prisma
model User {
  // ... existující pole ...
  variableSymbol    Int?     @unique  // pro FIO platby, 6-ciferný, generovaný při registraci
  tokenTransactions TokenTransaction[]
}
```

`variableSymbol` je 6-ciferné číslo (100000–999999), generované náhodně při registraci. Rozsah bezpečně v `Int`.

## Zůstatek

```sql
SELECT COALESCE(SUM(amount), 0) FROM "TokenTransaction" WHERE "userId" = ?
```

Helper funkce `getTokenBalance(userId): Promise<bigint>` v `apps/web/lib/infrastructure/billing.ts`.

## Odpočet tokenů při zpracování

### Dotčené endpointy

Všechny endpointy, které volají Claude API, musí kontrolovat zůstatek a odpočítávat tokeny:

- `/api/pages/process` – OCR zpracování (hlavní spotřeba)
- `/api/documents/[id]/retranslate` – přegenerování překladu (Claude Sonnet)
- `/api/documents/[id]/chat` – multimodální chat (Claude Sonnet)

### Tok

1. **Před zpracováním:** `getTokenBalance(userId)`. Pokud ≤ 0 → odmítnutí s SSE event `insufficient_tokens`
2. **V batch processing:** Re-check zůstatku před každou stránkou (ne jen na začátku dávky)
3. **Po zpracování:** Claude vrátí `inputTokens + outputTokens`. Vytvoří se transakce:
   ```
   amount = -(inputTokens + outputTokens) * TOKEN_MULTIPLIER
   ```
4. Zůstatek může jít do mínusu (zpracování jedné stránky se zaplatí až po dokončení), ale nové zpracování/stránka se nepovolí při záporném zůstatku.

### Retranslate a chat

- Retranslate: kontrola zůstatku před voláním, odpočet po dokončení. Pokud nedostatek → vrátí 402 s `{ error: "insufficient_tokens", balance }`.
- Chat: kontrola zůstatku před voláním. SSE event `insufficient_tokens` pokud nedostatek. Frontend zakáže chat input a zobrazí upozornění s odkazem na dobíjení.
- Auto-retranslace po editaci: frontend zkontroluje zůstatek před odesláním. Pokud nedostatek → zobrazí varování místo automatického odeslání.

### Env proměnné

- `TOKEN_MULTIPLIER` – multiplikátor spotřeby (default: `2`)
- `TOKEN_PRICE_PER_MILLION` – cena za 1M tokenů v Kč (odvozeno z průměru Opus 4.6 cen)
- `STRIPE_SECRET_KEY` – Stripe API klíč
- `STRIPE_WEBHOOK_SECRET` – Stripe webhook signing secret
- `FIO_API_TOKEN` – FIO Banka API token
- `FIO_ACCOUNT_NUMBER` – číslo účtu pro QR kód

## Dobíjení – Stripe

### Tok

1. Uživatel zadá částku v Kč na stránce dobíjení
2. `POST /api/billing/checkout` → vytvoří Stripe Checkout Session s `metadata.userId`
3. Stripe přesměruje na platbu
4. Po úspěchu: `POST /api/billing/webhook` (Stripe webhook)
5. Webhook ověří podpis, spočítá tokeny: `částka_v_Kč / TOKEN_PRICE_PER_MILLION * 1_000_000`
6. Idempotentní insert: `upsert` s `@@unique([userId, referenceId])` – opakované doručení webhooku nevytvoří duplicitní transakci
7. Vytvoří `TokenTransaction(type: "topup_stripe", amount: tokeny, referenceId: payment_intent_id, amountCzk: částka_v_haléřích)`

### API

| Metoda | Endpoint | Popis |
|--------|----------|-------|
| POST | `/api/billing/checkout` | Vytvoření Stripe Checkout Session |
| POST | `/api/billing/webhook` | Stripe webhook handler |

## Dobíjení – FIO Banka (QR)

### Tok

1. Uživatel vidí QR kód (SPAYD formát) s: číslo účtu, variabilní symbol, volitelná částka
2. Zaplatí přes bankovní appku
3. Klikne tlačítko "Ověřit platbu" → `POST /api/billing/fio-check`
4. Endpoint zavolá FIO API (`/last/`), najde transakce s odpovídajícím variabilním symbolem
5. Idempotentní insert: `referenceId` = FIO transaction ID, unique constraint zabrání duplicitám
6. Pro každou novou platbu vytvoří `TokenTransaction(type: "topup_bank", amountCzk: částka_v_haléřích)`

### FIO rate limiting

FIO API povoluje 1 request / 30 sekund na token. Server udržuje in-memory timestamp posledního volání. Pokud uživatel klikne příliš brzy → vrátí se odpověď s informací kolik sekund zbývá.

### API

| Metoda | Endpoint | Popis |
|--------|----------|-------|
| POST | `/api/billing/fio-check` | On-demand FIO API check pro přihlášeného uživatele |
| GET | `/api/billing/balance` | Aktuální zůstatek a variabilní symbol |

## UI

### UserMenu (rozšíření existující komponenty)

- Pod jménem/emailem: řádek "Zůstatek: 1 250 000 tokenů"
- Odkaz "Dobít" → `/workspace/billing`

### Stránka dobíjení (`/workspace/billing`)

- Aktuální zůstatek tokenů
- **Kartou:** Input pro částku v Kč + tlačítko "Zaplatit kartou" → Stripe Checkout
- **Převodem:** QR kód (SPAYD), variabilní symbol, číslo účtu + tlačítko "Ověřit platbu"
- **Historie transakcí:** Tabulka (datum, typ, částka, popis)

### Process route – blokování

- Při nedostatku tokenů: SSE event `insufficient_tokens` s aktuálním zůstatkem
- Frontend zobrazí hlášku s odkazem na stránku dobíjení

## Bezpečnost

- Stripe webhook ověřuje podpis (`stripe.webhooks.constructEvent`)
- FIO check je rate-limited (FIO API povoluje 1 request / 30 sekund)
- Všechny billing endpointy vyžadují autentizaci (`requireUserId()`)
- Variabilní symbol je unikátní per uživatel

## Soubory k vytvoření/úpravě

### Nové soubory
- `apps/web/lib/infrastructure/billing.ts` – `getTokenBalance()`, `createTransaction()`, výpočty
- `apps/web/app/api/billing/checkout/route.ts` – Stripe Checkout
- `apps/web/app/api/billing/webhook/route.ts` – Stripe webhook
- `apps/web/app/api/billing/fio-check/route.ts` – FIO API check
- `apps/web/app/api/billing/balance/route.ts` – zůstatek + VS
- `apps/web/app/workspace/billing/page.tsx` – stránka dobíjení

### Úpravy
- `apps/web/prisma/schema.prisma` – TokenTransaction model, User rozšíření
- `apps/web/app/api/pages/process/route.ts` – kontrola zůstatku + odpočet + per-page re-check
- `apps/web/app/api/documents/[id]/retranslate/route.ts` – kontrola zůstatku + odpočet
- `apps/web/app/api/documents/[id]/chat/route.ts` – kontrola zůstatku + odpočet
- `apps/web/components/UserMenu.tsx` – zobrazení zůstatku + odkaz na dobíjení
- `apps/web/components/ResultViewer.tsx` – varování při nedostatku tokenů (auto-retranslace)
- `apps/web/package.json` – přidat `stripe`, `qrcode` dependencies

## Testy

- Unit testy pro `billing.ts`: `getTokenBalance`, `createTransaction`, přepočet Kč → tokeny
- Unit testy pro idempotenci: duplicitní `referenceId` nevytvoří druhou transakci
- Unit testy pro FIO rate limiting
- Integration test pro Stripe webhook s mockovanou signaturou

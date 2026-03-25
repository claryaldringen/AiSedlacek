# Email Verification při registraci

## Kontext

Aplikace má registraci přes email/heslo, ale `emailVerified` zůstává `null`. Potřebujeme ověření emailu před prvním přihlášením (pre-login gate).

## Rozhodnutí

- **Gate typ**: Pre-login — uživatel se nemůže přihlásit, dokud neověří email
- **Neověřené přihlášení**: Chyba "Email není ověřen" + tlačítko "Odeslat znovu"
- **Platnost tokenu**: 24 hodin
- **Rate limit**: Max 1 ověřovací email za 60s per adresa
- **Existující uživatelé**: Backfill migrace (`emailVerified = now()` pro všechny s heslem)
- **OAuth uživatelé**: Netýká se — NextAuth adapter nastaví `emailVerified` automaticky

## Flow

```
POST /api/auth/register
  → vytvoření uživatele (emailVerified = null)
  → generování verification tokenu (32 random bytes)
  → uložení SHA256 hash do VerificationToken (expires: +24h)
  → odeslání emailu s verify linkem
  → response: { message, email } (201, BEZ auto-přihlášení)

Frontend po registraci:
  → redirect na /verify-email?email=user@example.com
  → stránka "Zkontrolujte svůj email" + tlačítko "Odeslat znovu"

Uživatel klikne link v emailu:
  GET /api/auth/verify-email?token=xxx
  → hash tokenu, lookup v DB
  → validace: token existuje, není expirovaný, uživatel existuje
  → nastavení user.emailVerified = now()
  → smazání tokenu
  → redirect na /login?verified=true

Login stránka:
  → ?verified=true → zelený banner "Email ověřen, můžete se přihlásit"

Pokus o přihlášení bez ověření:
  → Credentials provider kontroluje emailVerified !== null
  → Pokud null → chyba "Email není ověřen"
  → Login stránka zobrazí chybu + tlačítko "Odeslat ověřovací email znovu"
```

## Datový model

Využívá existující `VerificationToken` model (NextAuth standard):

```prisma
model VerificationToken {
  identifier String    // = email
  token      String   @unique  // = SHA256 hash (NEplatný raw token)
  expires    DateTime

  @@unique([identifier, token])
}
```

Pole `token` ukládá SHA256 hash raw tokenu (stejný vzor jako `PasswordResetToken.tokenHash`). Raw token se posílá pouze v emailu, nikdy se neperzistuje.

Token se generuje jako `crypto.randomBytes(32).toString('hex')` (64-char hex string), konzistentně s password reset flow.

Žádná nová migrace pro model. Jediná migrace: backfill `emailVerified`.

## API endpointy

### POST `/api/auth/register` (úprava existujícího)

Změny:
- Email se normalizuje: `.toLowerCase().trim()` (konzistentně ve všech auth endpointech)
- Pokud uživatel s emailem existuje a `emailVerified` je null → smaže starého uživatele a vytvoří nového (re-registrace před ověřením). Pokud je ověřený → 409 jako dosud.
- Po vytvoření uživatele generuje verification token a posílá email
- Nevolá `signIn()` — vrací `{ message: "Ověřovací email odeslán", email }` s 201
- Frontend přestane volat `signIn()` po registraci, místo toho redirect na `/verify-email`

### POST `/api/auth/send-verification`

Nový endpoint pro znovuodeslání.

Request: `{ email: string }`
Response: `{ message: "..." }` (vždy 200, prevence email enumeration)

Logika:
1. Najdi uživatele podle emailu
2. Pokud neexistuje nebo nemá heslo (OAuth) nebo už je ověřený → return success (silent)
3. Zkontroluj existující token — pokud `expires.getTime() - Date.now() > (24*3600 - 60) * 1000` (odeslán před < 60s) → 429
4. Smaž staré tokeny pro tento email
5. Generuj nový token, ulož hash, pošli email

### GET `/api/auth/verify-email?token=xxx`

Nový endpoint pro ověření.

Logika:
1. Hash tokenu SHA256
2. Lookup v `VerificationToken`
3. Validace: existuje, není expirovaný
4. Najdi uživatele podle `identifier` (email)
5. V `prisma.$transaction`: `user.emailVerified = now()` + smaž token (atomicky)
6. Redirect na `/login?verified=true`

Chybové stavy:
- Token chybí → redirect na `/login?error=missing-token`
- Token neplatný/expirovaný → redirect na `/login?error=invalid-token`
- Uživatel nenalezen → redirect na `/login?error=invalid-token`

## Změny v auth.ts

Credentials provider — přidat kontrolu po ověření hesla. Authorize vrací `null` (nevolá `throw`), konzistentně se stávajícím kódem. Protože NextAuth v5 nepropaguje chybové zprávy z `authorize` na klienta, frontend detekuje neověřený email takto:

1. `signIn('credentials', { redirect: false })` vrátí `error: "CredentialsSignin"`
2. Frontend zavolá `POST /api/auth/check-verification` s emailem
3. Endpoint vrátí `{ verified: boolean }`
4. Pokud `verified: false` → zobrazí hlášku "Email není ověřen" + tlačítko resend

Nový endpoint `POST /api/auth/check-verification`:
- Request: `{ email: string }`
- Response: `{ verified: boolean }` (vždy 200)
- Pokud uživatel neexistuje → `{ verified: true }` (prevence enumeration)

## IEmailProvider rozšíření

Nová metoda v interface:

```typescript
export interface IEmailProvider {
  sendPasswordReset(email: string, resetUrl: string): Promise<void>;
  sendVerification(email: string, verifyUrl: string): Promise<void>;
}
```

Implementace v obou adapterech (Resend + Console).

## Frontend stránky

### `/verify-email` (nová)

Email se předává přes `sessionStorage` (nastavený po registraci), ne v URL (prevence leaku přes referrer/historii). Pokud `sessionStorage` nemá email, stránka zobrazí generickou zprávu.

Obsah:
- Nadpis "Zkontrolujte svůj email"
- Text "Na adresu {email} jsme odeslali ověřovací odkaz." (nebo generický text bez emailu)
- Tlačítko "Odeslat znovu" (volá POST `/api/auth/send-verification`)
- Po kliknutí: disabled na 60s s odpočtem
- Link "Zpět na přihlášení"

### `/login` (úprava)

Nové query params:
- `?verified=true` → zelený banner "Email ověřen, můžete se přihlásit"
- `?error=missing-token` / `?error=invalid-token` → červený banner s vysvětlením

Chování při chybě `EMAIL_NOT_VERIFIED`:
- Zobrazí chybovou hlášku "Email není ověřen"
- Tlačítko "Odeslat ověřovací email znovu" (potřebuje email z formuláře)

### Registrační flow v `/login` (úprava)

Po úspěšné registraci (201):
- Přestat volat `signIn()`
- Redirect na `/verify-email?email={email}`

## Middleware

Přidat `/verify-email` do public routes (stránka). API endpointy pod `/api/auth/*` jsou již pokryté existujícím pravidlem.

## Migrace: backfill emailVerified

```sql
UPDATE "User"
SET "emailVerified" = NOW()
WHERE "password" IS NOT NULL
  AND "emailVerified" IS NULL;
```

Bezpečné — nastaví ověření jen uživatelům s heslem, kteří se už registrovali před touto změnou.

## Email šablona

Ověřovací email (HTML):
- Nadpis "Ověření emailu"
- Text "Klikněte na tlačítko pro ověření vaší emailové adresy."
- Tlačítko "Ověřit email" → link na verify endpoint
- Poznámka "Odkaz je platný 24 hodin."

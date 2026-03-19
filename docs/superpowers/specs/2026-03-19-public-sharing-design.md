# Veřejné sdílení kolekcí a dokumentů

## Shrnutí

Umožnit uživatelům nastavit kolekce nebo jednotlivé stránky/dokumenty jako veřejné. Veřejný obsah je přístupný na `/view/{slug}` bez přihlášení — readonly zobrazení obrázku, transkripce, překladu, kontextu a glosáře.

## Datový model

### PublicSlug tabulka

Nová tabulka pro globálně unikátní slugy — eliminuje race condition při cross-table validaci:

```prisma
model PublicSlug {
  slug         String   @id
  targetType   String   // "collection" | "page"
  targetId     String   @unique
  createdAt    DateTime @default(now())
}
```

Přidáme do modelů `Collection` a `Page`:

```prisma
isPublic  Boolean  @default(false)
slug      String?  @unique  // denormalizováno z PublicSlug pro rychlý lookup
```

- **slug** se generuje automaticky ze jména (slugify) při zapnutí sdílení
- Při kolizi se připojí suffix (`-2`, `-3` atd.)
- Uživatel může slug ručně upravit
- Slug je **globálně unikátní** — vynuceno přes `PublicSlug` tabulku na DB úrovni
- Při vypnutí sdílení (`isPublic: false`) slug zůstane zachován pro případ opětovného zapnutí
- Povolené znaky ve slug: `[a-z0-9-]`, délka 3–80 znaků
- Při smazání položky se slug uvolní (smaže se i z `PublicSlug`)
- **Cascade cleanup**: Při kaskádovém smazání (např. smazání uživatele → cascade na Collection/Page) se `PublicSlug` záznamy musí vyčistit. Řešení: Prisma middleware (`$use`) nebo scheduled cleanup job pro osiřelé záznamy.
- Zdroj slug pro Collection: `name`
- Zdroj slug pro Page: `displayName` pokud existuje, jinak `page-{shortId}`

## Veřejná stránka `/view/[slug]`

Lookup: dotaz na `PublicSlug` → podle `targetType` načte Collection nebo Page.

### Pro kolekci
- Název, popis, grid stránek s thumbnaily
- Klik na stránku → `/view/[slug]/[pageId]` s detailem
- Navigace prev/next v rámci kolekce, odkaz zpět na kolekci

### Pro jednotlivou stránku
- Obrázek vlevo, vpravo readonly transkripce + překlad + kontext + glosář
- Readonly verze ResultViewer

### Chybová stránka
- Pokud slug neexistuje, položka není veřejná, nebo byla smazána: "Tento obsah již není dostupný"
- Stejná stránka pro všechny případy (nelze rozlišit smazané od soukromého)

### Prázdné stránky
- Stránky se statusem `blank` se ve veřejném zobrazení **zobrazují** (nezahrnovat by bylo matoucí pro číslování folií)

## API

### Nový veřejný endpoint (bez auth)

| Metoda | Endpoint | Popis |
|--------|----------|-------|
| GET | `/api/public/[slug]` | Vrátí kolekci nebo stránku. Vrátí 404 pokud neexistuje nebo není veřejná. |

### Response shape

Pro kolekci:
```json
{
  "type": "collection",
  "name": "...",
  "description": "...",
  "context": "...",
  "pages": [
    {
      "id": "...",
      "displayName": "...",
      "thumbnailUrl": "...",
      "imageUrl": "...",
      "status": "...",
      "order": 0,
      "document": {
        "transcription": "...",
        "detectedLanguage": "...",
        "context": "...",
        "translations": [{ "language": "...", "text": "..." }],
        "glossary": [{ "term": "...", "definition": "..." }]
      }
    }
  ]
}
```

Pro stránku:
```json
{
  "type": "page",
  "displayName": "...",
  "imageUrl": "...",
  "status": "...",
  "document": { /* stejná struktura */ }
}
```

Vyloučená pole: `userId`, `hash`, `inputTokens`, `outputTokens`, `processingTimeMs`, `model`, `rawResponse`, `batchId`, `fileSize`, `mimeType`.

### Úprava existujících endpointů

| Endpoint | Změna |
|----------|-------|
| PATCH `/api/collections/[id]` | Přijímá `isPublic`, `slug`. Při `isPublic: true` bez existujícího slug → automatická generace. Všechny operace se slug (vytvoření, úprava, smazání) probíhají v Prisma transakci — zápis do `PublicSlug` + update entity atomicky. |
| PATCH `/api/pages/[id]` | Přijímá `isPublic`, `slug`. Stejná logika. |
| DELETE `/api/collections/[id]` | Smazat odpovídající `PublicSlug` záznam. |
| DELETE `/api/pages/[id]` | Smazat odpovídající `PublicSlug` záznam. |

### Slug validace (server-side)
- Formát: `[a-z0-9-]`, délka 3–80 znaků
- Unikátnost: vynucena DB constraint na `PublicSlug.slug`
- Automatická generace: slugify z názvu + suffix při kolizi

## Routing

### Nové stránky
- `app/view/[slug]/page.tsx` — veřejné zobrazení kolekce nebo stránky
- `app/view/[slug]/[pageId]/page.tsx` — detail stránky v rámci veřejné kolekce

### Middleware úprava
Přidat `/view` a `/api/public` do veřejných cest v middleware matcher:

```typescript
const isPublic =
  req.nextUrl.pathname === '/' ||
  req.nextUrl.pathname.startsWith('/login') ||
  req.nextUrl.pathname.startsWith('/view') ||
  req.nextUrl.pathname.startsWith('/api/auth') ||
  req.nextUrl.pathname.startsWith('/api/public');
```

### SEO metadata
Veřejné stránky implementují `generateMetadata` pro `<title>`, `<meta description>` a Open Graph tagy — název kolekce/stránky + popis projektu.

## UI pro sdílení

### Kontextové menu (pravý klik na kolekci nebo stránku)
- "Sdílet veřejně" → zapne `isPublic`, vygeneruje slug, zobrazí toast s odkazem + tlačítko kopírovat
- "Zrušit sdílení" → vypne `isPublic`

### Detail panel
- Veřejná položka: ikona sdílení + odkaz ke zkopírování + editace slug + tlačítko "Zrušit sdílení"
- Soukromá položka: tlačítko "Sdílet veřejně"

### Vizuální indikátor
- Malá ikona sdílení (link icon) na thumbnailech veřejných položek v gridu/listu

## Bezpečnost

- `/api/images/` je již veřejně přístupné (mimo auth middleware) — obrázky veřejných stránek fungují bez změny
- Soukromé obrázky chráněny neznalostí UUID v názvu souboru. **Známé omezení**: toto je security through obscurity. Budoucí vylepšení: auth check na `/api/images/` ověřující, že obrázek patří veřejné stránce nebo přihlášenému uživateli.
- `/api/public/[slug]` vrací pouze data položek s `isPublic: true`, bez interních metadat
- Neveřejné položky vracejí stejnou 404 odpověď jako neexistující — nelze rozlišit
- Rate limiting: pro produkci nasadit Vercel edge rate limiting na `/api/public/*` a `/view/*`. V dev prostředí bez omezení.

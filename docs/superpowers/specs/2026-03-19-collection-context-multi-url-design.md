# Kontext kolekce – více URL a AI sloučení

## Problém

Aktuálně dialog kontextu kolekce podporuje jedno URL. Při fetchi se kontext přepíše extrahovaným textem. Uživatel nemůže kombinovat ruční text s obsahem z URL, ani přidávat více zdrojů.

## Řešení

### Chování

1. **Dialog kontextu kolekce** má dvě části:
   - Nahoře: textové pole s aktuálním kontextem (editovatelný Markdown)
   - Dole: vstup pro URL + tlačítko "Načíst" + seznam zdrojových URL

2. **Flow přidání URL:**
   - Uživatel zadá URL → klikne "Načíst"
   - Fetchne se obsah → Claude Sonnet dostane existující kontext + nový obsah z URL → vrátí sloučený text
   - Kontext se aktualizuje, URL se přidá do seznamu zdrojů

3. **Flow ruční editace:**
   - Uživatel přímo edituje text kontextu a uloží
   - Seznam URL zůstává beze změny

4. **Seznam zdrojů:**
   - Každé URL je klikatelný odkaz s možností odebrání (×)
   - Odebrání URL smaže jen odkaz ze seznamu, kontext se nepřegeneruje

### Datový model

Aktuálně `Collection` má:
```prisma
context     String   @default("")
contextUrl  String?
```

Změna:
- Nahradit `contextUrl` polem `contextUrls String[]` (pole textů v PostgreSQL)
- Migrace převede existující `contextUrl` do pole

### Prompt pro sloučení

Claude Sonnet dostane:
- Existující kontext kolekce
- Nový extrahovaný obsah z URL
- Instrukci: "Slouč tyto informace do jednoho koherentního textu. Neduplicuj, doplň nové informace."

### UI změny

Úprava stávajícího `CollectionContextDialog.tsx`:
- Textarea pro kontext zůstává nahoře
- URL input + "Načíst" tlačítko pod ním
- Pod URL inputem seznam zdrojových URL (klikatelné, s × pro odebrání)
- Při načítání URL se zobrazí loading indikátor

### API změny

- `PATCH /api/collections/[id]` — přijímá `contextUrls: string[]` místo `contextUrl: string`
- `POST /api/collections/[id]/fetch-context` — místo přepsání kontextu ho sloučí s existujícím, přidá URL do pole `contextUrls`

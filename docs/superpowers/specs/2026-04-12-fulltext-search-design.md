# Fulltextové vyhledávání v transkripci a překladu

## Cíl

Umožnit uživateli hledat v textech transkripce a překladu napříč stránkami. Výsledky se zobrazí přímo v existujícím gridu/listu — nematchující stránky se ztlumí, matchující zůstanou zvýrazněné. Při otevření dokumentu se nalezený text zvýrazní žlutě.

## Umístění

Nové tlačítko "Hledat" v toolbaru (stejný vertikální styl jako ostatní — ikona lupy + popisek). Klik rozbalí inline search input vedle tlačítka. Escape nebo klik na X input zavře a zruší filtr.

## Rozsah hledání

- **Výchozí:** hledá v aktuálně otevřeném svazku (kolekci)
- **Toggle:** checkbox/přepínač "Hledat ve všech svazcích" pod inputem — přepne na globální hledání napříč celým workspace uživatele
- Bez otevřeného svazku (root workspace) se hledá vždy globálně

## Chování

### Vyhledávání
1. Uživatel píše do search inputu
2. Po 300ms debounce se odešle request na API
3. API vrátí seznam matchujících page IDs + snippet (kontext kolem nalezeného textu) + počet výskytů na stránku
4. Minimální délka dotazu: 2 znaky

### Zobrazení v gridu/listu
- Stránky, které **nematchují**, se ztlumí (`opacity-30`)
- Matchující stránky zůstanou normální + malý badge s počtem výskytů
- Při globálním hledání (napříč svazky): u výsledků se zobrazí název svazku, klik na výsledek otevře daný svazek a stránku

### Zvýrazňování v dokumentu
- Při otevření matchující stránky se nalezený text zvýrazní `<mark>` (žlutě) v transkripci i překladu v ResultViewer
- Zvýrazňování je case-insensitive
- Search query se předá do DocumentPanel → ResultViewer jako prop

## API

### `GET /api/pages/search`

**Query parametry:**
- `q` (string, povinný) — hledaný text, min 2 znaky
- `collectionId` (string, volitelný) — omezení na svazek
- `workspaceId` (string, povinný) — workspace uživatele

**Response:**
```json
{
  "results": [
    {
      "pageId": "clxxx...",
      "filename": "3.jpg",
      "displayName": "3",
      "collectionId": "clyyy...",
      "collectionName": "Dopisy Týřovský",
      "matches": 2,
      "snippet": "...text kolem **nalezeného** výrazu..."
    }
  ]
}
```

**Implementace:**
- PostgreSQL `ILIKE '%query%'` na `Document.transcription` a `Translation.text`
- JOIN: `Page → Document → Translation`
- Filtr: `Page.userId = currentUser` a volitelně `Page.collectionId`
- Snippet: prvních ~100 znaků kolem prvního výskytu
- Počet výskytů: součet výskytů v transkripci + překladu

## Frontend

### Stav
- `searchQuery: string` — aktuální dotaz
- `searchResults: Map<string, SearchResult>` — page ID → result (matches, snippet)
- `searchScope: 'collection' | 'all'` — rozsah
- `isSearchOpen: boolean` — jestli je search input viditelný

### Komponenty
- **Toolbar** — nové tlačítko "Hledat" + inline input (rozbalitelný)
- **FileGrid / FileList** — přijmou `searchResults` prop, ztlumí nematchující, badge na matchujících
- **ResultViewer** — přijme `highlightQuery` prop, zvýrazní výskyty v transkripci a překladu

### Klávesové zkratky
- `Ctrl/Cmd+F` — otevře search input (pokud není panel otevřený)
- `Escape` — zavře search input a zruší filtr

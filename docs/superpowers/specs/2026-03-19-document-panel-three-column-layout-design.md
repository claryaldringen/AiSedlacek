# DocumentPanel – třísloupcový layout

## Problém

Aktuální DocumentPanel má dvousloupcový layout (obrázek vlevo, taby vpravo) s vertikálním stohováním všech sekcí v pravém sloupci. To znamená hodně scrollování a nemožnost vidět transkripci a překlad vedle sebe.

## Řešení

Nový layout využívá celou šířku panelu efektivněji:

```
┌──────────┬────────────────┬────────────────┐
│          │  Transkripce   │    Překlad     │
│          │                │                │
│  Obrázek │                │                │
│ (celá    ├────────────────┼────────────────┤
│  výška)  │  Slovníček     │    Kontext     │
│          ├────────────────┴────────────────┤
│          │           Chat                  │
│          ├────────────────┬────────────────┤
│          │   Metadata     │ Historie verzí │
└──────────┴────────────────┴────────────────┘
```

### Struktura

- **Levý sloupec (1/3):** Obrázek originálu, plná výška panelu. Rukopisy jsou typicky na výšku, proto obrázek zabírá celý sloupec.
- **Pravá strana (2/3):** Vnitřní dvousloupcový layout:
  - **Nahoře:** Transkripce (vlevo) | Překlad (vpravo) — obě editovatelné, flex: 1 pro maximální prostor
  - **Pod nimi:** Slovníček (vlevo, pod transkripcí) | Kontext (vpravo, pod překladem) — editovatelný kontext
  - **Chat:** Přes celou šířku pravé strany, pod slovníčkem a kontextem
  - **Dole:** Metadata (vlevo) | Historie verzí (vpravo)

### Změny komponent

**DocumentPanel.tsx:**
- Odstranit tab systém (Result | Chat) — vše je viditelné najednou
- Změnit grid z `1fr 1fr` na `1fr 2fr`
- Obrázek zabírá celý levý sloupec (`grid-row: 1 / -1` nebo flex column)
- Pravá strana je nový kontejner s vlastním vnitřním layoutem

**ResultViewer.tsx:**
- Rozdělit na dvousloupcový grid místo vertikálního `space-y-6`
- Transkripce a překlad vedle sebe (horní řádek)
- Slovníček a kontext vedle sebe (střední řádek)
- Metadata a verze vedle sebe (spodní řádek)
- Mezi nimi chat přes celou šířku

**Stávající subkomponenty** (EditableSection, VersionHistory, MarkdownEditor) — beze změn, jen se mění jejich umístění v gridu.

### Scrollování

- Obrázek: vlastní scroll v rámci levého sloupce
- Pravá strana: celá pravá strana scrolluje vertikálně
- Transkripce/překlad: nemají vlastní scroll, rostou s obsahem (scrolluje pravá strana)

### Responzivita

- Na úzkých obrazovkách (<1024px): fallback na dvousloupcový layout (obrázek + vertikální stohování)
- Na velmi úzkých (<768px): jednosloupcový layout

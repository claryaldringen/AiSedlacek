# ai-sedlacek-cli

CLI klient pro [čtečku starých textů](https://aisedlacek.com) — webovou aplikaci pro OCR a překlad
historických rukopisů (stará horní němčina, staročeština, latina).

## Instalace

```bash
npm install -g ai-sedlacek-cli
```

Nebo bez instalace přes `npx`:

```bash
npx ai-sedlacek-cli --help
```

## Rychlý start

```bash
ais login                       # přihlášení přes prohlížeč
ais upload obrazek.jpg          # nahrát stránku ke zpracování
ais list                        # seznam stránek
ais show <pageId>               # zobrazit transkripci, překlad, kontext, glosář
```

## Příkazy

| Příkaz | Popis |
|--------|-------|
| `ais login` | Přihlášení k serveru přes browser OAuth flow |
| `ais logout` | Odhlášení a revokace API tokenu |
| `ais whoami` | Zobrazit přihlášeného uživatele |
| `ais upload <sources...>` | Nahrát obrázky (URL nebo lokální cesty) |
| `ais list` | Seznam stránek (volitelně filtrovaných podle kolekce) |
| `ais show <pageId>` | Detail stránky včetně transkripce a překladů |
| `ais pull [pageIds...]` | Stáhnout dokumenty do lokálního workspace pro editaci |
| `ais push [pageIds...]` | Nahrát lokální změny zpět na server |
| `ais diff [pageIds...]` | Zobrazit lokální změny oproti serveru |
| `ais collections` | Správa kolekcí (list, create, delete) |
| `ais prompt [--mode]` | Zobrazit system prompt používaný pro OCR (transcribe+translate, translate, batch) |

Detailní nápovědu k libovolnému příkazu zobrazíš přes `ais <command> --help`.

## Konfigurace

Konfigurační soubor: `~/.config/ai-sedlacek/config.json`

```json
{
  "server": "https://aisedlacek.com"
}
```

Po `ais login` se do stejného adresáře uloží i API token.

## Lokální workspace

`ais pull` stahuje dokumenty do `.ais-workspace/` v aktuální složce. V něm můžeš transkripci nebo
překlad upravit ve svém oblíbeném editoru a změny pak vrátit přes `ais push`. `ais diff` ukáže,
co se změnilo proti verzi na serveru.

## Požadavky

- Node.js 22+
- Účet na [aisedlacek.com](https://aisedlacek.com)

## Licence

MIT — viz [LICENSE](https://github.com/claryaldringen/AiSedlacek/blob/main/LICENSE).

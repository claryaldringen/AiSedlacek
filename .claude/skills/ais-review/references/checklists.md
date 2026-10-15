# Checklisty review AiSedlacku

Každá položka odpovídá chybě, která se v projektu už objevila, nebo riziku,
které z jeho prostředí plyne (cizí uživatelé platí kredity, sdílený VPS,
drahá LLM volání, data se nesmí ztratit).

## Společná pravidla

- **Rozsah:** jen změny v diffu a kód, na který přímo působí. Starší problém
  uveď jen tehdy, když ho diff zhoršuje nebo na něm staví – označ `PRE-EXISTING`.
- **Konkrétní scénář:** každý nález musí mít scénář selhání (kdo, jaký vstup
  nebo stav → jaký špatný výsledek). Bez scénáře nález vynech.
- **Nehlásit:** styl, pojmenování a formátování (řeší lint a prettier), obecné
  rady typu „zvážit refaktor“, hypotetické problémy bez cesty v kódu.
- **Závažnost:**
  - **Critical** – únik cizích dat, ztráta nebo nevratné přepsání dat,
    neúčtovaná nebo dvojí platba ve velkém, SSRF/RCE/path traversal, rozbitý
    deploy nebo migrace na produkci.
  - **High** – chyba, kterou uživatel reálně potká (rozbitá funkce, špatná
    částka, pád jobu), bezpečnostní díra s omezeným dopadem, chybějící test
    u změny autorizace nebo účtování.
  - **Medium** – okrajový případ, horší chybová hláška, chybějící test běžné cesty.
  - **Low** – drobnost.

Formát nálezu:

```
### [HIGH] Stručný titulek
- Místo: apps/web/app/api/…/route.ts:42
- Scénář: člen workspace pošle PATCH … → přepíše cizí transkripci
- Oprava: …
- Jistota: vysoká | střední
```

## Přístup k datům a bezpečnost

- Každá nová nebo změněná API routa ověřuje přihlášení (`getAuthenticatedUserId`),
  pokud není záměrně veřejná.
- **Čtení** cizích dat jen přes `canReadPage` / `canReadCollection`
  (`apps/web/lib/infrastructure/authz.ts`): vlastník, `isPublic`, nebo člen
  workspace s danou položkou. **Zápis** jen vlastník. Cizí objekt → 404, ne 403.
- `canEdit` v odpovědi odpovídá tomu, co zápisové routy reálně pustí; UI
  nenabízí akce, které API odmítne.
- Archivované stránky (`status: 'archived'`) vidí jen vlastník – i v seznamech,
  počtech (`_count`), workspace, veřejných stránkách, vyhledávání a exportu.
- Odpovědi neposílají interní a cizí data: `rawResponse` (výstup celé dávky
  včetně jiných stránek), hashe hesel a API tokenů, OAuth tokeny z `Account`,
  e-maily uživatelů mimo členy daného workspace.
- Dedup podle hashe obrázku jen v rámci uživatele – cizí OCR se nesmí recyklovat.
- Upload: typ podle obsahu (magic bytes), uložení jako `<uuid>.<ext>`, limit těla
  streamem (`readBodyLimited`), Sharp jen přes `sharp-limit.ts` (limit pixelů).
- Odchozí HTTP na uživatelské URL jen přes `safe-fetch.ts` (SSRF), přesměrování
  po přihlášení jen přes `safe-callback-url.ts`.
- Rate limit (`rate-limit.ts`) u přihlášení, registrace, resetu hesla a nových
  veřejných endpointů.
- Raw SQL jen jako tagged template (`$queryRaw\`…\``), nikdy `$queryRawUnsafe`
  s interpolací.
- Žádné secrets v kódu, logu ani odpovědi; nové env proměnné jen názvem v docs.

## Peníze a LLM

- Každé volání Claude (`messages.create`, `messages.stream`, `beta.messages.stream`)
  má odpovídající `deductTokens` / `deductTokensIfSufficient`
  (`packages/db/src/billing.ts`) s **modelem z odpovědi** (`response.model`,
  `finalMsg.model`), ne s konstantou.
- Spotřeba se účtuje i při chybě po vzniku usage (odmítnutí, nevalidní JSON,
  `max_tokens`) – jinak platíme API za uživatele.
- Každý model z `packages/shared/src/models.ts` má řádek v `MODEL_PRICING_USD`
  (`packages/shared/src/pricing.ts`). Model bez ceny se účtuje nejdražší
  sazbou – nový model bez řádku je High.
- Zůstatek se kontroluje před drahým voláním. Retry jobu neúčtuje dvakrát
  (`referenceId`, idempotence). Člen sdíleného workspace neplatí za akce nad
  cizím obsahem a nemůže je spustit.
- Cena zobrazená v UI (`apps/web/lib/pricing.ts`, `chargeForUsage`) = částka,
  která se odečte.
- Parametry modelu: Opus 5.5 bez `temperature`/`top_p`, uvažování přes
  `output_config.effort`, `max_tokens` s rezervou na thinking
  (`THINKING_TOKENS_RESERVE`), streaming u dlouhých výstupů. Text jen z `text`
  bloků. `stop_reason` `refusal` a `max_tokens` ošetřený – ne tiše useknutý JSON.
- Prompty (`packages/shared/src/prompts.ts`): výstupní schéma odpovídá parseru.
  Text z rukopisu nebo od uživatele nesmí přes prompt měnit účtování, oprávnění
  ani spouštět akce.
- Logování podle CLAUDE.md: model, tokeny, čas – bez obsahu dokumentů a osobních údajů.

## Data, migrace a worker

- Nic se nemaže nevratně: regenerace a retranslace zachovají předchozí stav
  (verze přes `createVersion`, `packages/db/src/versioning.ts`), mazání stránky
  je archivace. `onDelete: Cascade` ve schématu nemaže víc, než má.
- Migrace jen v `packages/db/prisma/migrations` a odpovídají `schema.prisma`.
  Bezstrátové: žádný `DROP COLUMN/TABLE` bez přenosu dat, nový `NOT NULL`
  sloupec s defaultem nebo backfillem, přejmenování ne jako drop + add. Nikdy
  `migrate reset` ani `db push`.
- Souběh web ↔ worker: status stránky přes `setPageStatus`
  (`apps/worker/src/lib/page-status.ts`) – archivace má přednost. Zápis workeru
  nepřepíše novější ruční editaci. Zápisy, které musí být konzistentní
  (dokument + překlad + verze + odečet kreditů), jsou v transakci.
- Joby: chyba jedné stránky neshodí celou dávku, retry neduplikuje záznamy
  (unique `[documentId, language]`), job po pádu nezůstane viset v `processing`.
- Dotazy: N+1 v seznamech, chybějící index u nového filtru, `findMany` bez
  limitu nad velkou tabulkou, `include`/`select` tahající velké texty
  (`transcription`, `rawResponse`) do seznamů.
- Soubory v uploads: cesta mimo upload adresář (path traversal), osiřelé
  soubory při chybě, smazání souboru dřív než commit v DB.

## Provoz, kontrakty a UI

- Sdílený VPS (víc aplikací pod PM2, omezená RAM, disk přes 80 %): paměť (Sharp,
  celé soubory v paměti, velké JSON), souběžnost workeru, timeouty dlouhých LLM
  volání, SSE stream uzavřený při chybě i abortu klienta.
- Deploy (`deploy.sh` – build před migrací, `pg_dump`, rollback přes
  `DEPLOY_REF`): změna, která vyžaduje ruční krok na serveru (nová env
  proměnná, Caddy, systemd timer), je popsaná v `docs/deployment.md`
  a v popisu PR. Nová env proměnná je v dokumentaci a validovaná při startu.
- CI (`.github/workflows/ci.yml`): akce pinnuté na SHA, nový balíček je
  v turbo pipeline.
- Kontrakt CLI ↔ API (`apps/cli/src/lib/api-client.ts` ↔ routy): změna tvaru
  vstupu nebo odpovědi nerozbije nasazené CLI potichu – staré CLI dostane
  srozumitelnou chybu.
- Sdílené typy a konstanty v `packages/shared`, ne duplikáty. Domain vrstva
  (`packages/shared/src/domain`) bez závislostí na infrastruktuře.
- UI: i18n klíče v `apps/web/messages/cs.json` i `en.json` (čeština s „–“).
  Pravidla React hooks. Chybové stavy u akcí uživatele (ne tiché `catch {}`).
- Testy: změna chování má test, který opravdu testuje změnu (ne mock sám sebe).
  Mocky Prisma doplněné o nová volání.
- Závislosti: nový balíček je nutný, udržovaný a s lockfilem v pořádku.

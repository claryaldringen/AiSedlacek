---
name: ais-review
description: Povinné code review AiSedlacku před každým `gh pr create` (vynucuje ho hook). Čtyři paralelní revieweři s checklisty pro tenhle projekt – přístup k datům, peníze a LLM, data a migrace, provoz a kontrakty –, ověření nálezů, opravy, validace a zápis markeru. Použij před otevřením PR nebo když Martin chce review větve. Argumenty – volitelně base (výchozí origin/main) a --no-fix.
---

# AiSedlacek review

Povinné review před každým PR. `gh pr create` zablokuje hook
`.claude/hooks/require-review.sh`, dokud aktuální HEAD neprojde tímhle postupem
a nezapíše se marker (`.claude/hooks/mark-reviewed.sh`).

Bookbot review (`/bookbot:code-review`) se tu **nepoužívá** – AiSedlacek není
projekt Bookbotu a obecní revieweři míjeli to, co se tu reálně rozbilo: cizí
data přes sdílené workspacy a dedup, regenerace mazající dokumenty, účtování
pevnou sazbou nezávisle na modelu, upload podle přípony, migrace v nesprávném
adresáři. Checklisty v `references/checklists.md` vycházejí z těchto chyb.

## Argumenty

- `base` – proti čemu se diffuje. Výchozí `origin/main` (po `git fetch origin main`),
  bez remote `main`. U stacked větve base PR (např. `fix/…`).
- `--no-fix` – jen report, nic neopravovat a marker nezapisovat.

## 1. Rozsah

```bash
git fetch origin main 2>/dev/null || true
BASE=<base>                      # viz Argumenty
git log --oneline $BASE..HEAD
git diff --stat $BASE...HEAD
```

**Inkrementální review:** pokud marker existuje (`cat "$(git rev-parse --git-path ais-review/passed)"`)
a jeho commit je předkem HEAD (`git merge-base --is-ancestor <sha> HEAD`), stačí
review rozdílu `<sha>..HEAD` – typicky dorovnání po opravě CI nebo připomínce.
Prázdný diff = nic k review, rovnou krok 6.

## 2. Revieweři (paralelně)

Spusť čtyři `general-purpose` agenty najednou (jedna zpráva, `run_in_background: true`),
jednoho na každou oblast z `references/checklists.md`:

| Oblast                       | Klíč         |
| ---------------------------- | ------------ |
| Přístup k datům a bezpečnost | `pristup`    |
| Peníze a LLM                 | `penize-llm` |
| Data, migrace a worker       | `data`       |
| Provoz, kontrakty a UI       | `provoz`     |

U malého diffu (do ~150 řádků, jedna oblast) stačí ty oblasti, kterých se diff
týká – v reportu uveď, které jsi vynechal a proč.

Prompt pro každého (doplň `<…>`):

```
Jsi reviewer projektu AiSedlacek (repo /Users/martin-pracovni/Projects/AiSedlacek)
pro oblast „<název oblasti>“.

Rozsah: změny `git diff <BASE>...HEAD` (log: `git log --oneline <BASE>..HEAD`).
Přečti `.claude/skills/ais-review/references/checklists.md` – sekci „Společná
pravidla“ a sekci „<název oblasti>“ – a projdi podle nich změny. Čti i okolní
kód (volající, volané, testy, schéma), nejen diff. NIC NEEDITUJ a necommituj.

Vrať jen nálezy ve formátu z checklists.md, seřazené od nejzávažnějšího,
a na konec řádek `SOUHRN <klíč>: C=<n> H=<n> M=<n> L=<n>`.
Bez nálezů vrať jen souhrnný řádek.
```

## 3. Ověření nálezů

Revieweři se mýlí. Každý **Critical/High** ověř sám přímo v kódu: přečti místo,
projdi scénář, u nejistoty napiš test, který ho reprodukuje. Nepotvrzený nález
zahoď nebo sniž závažnost a poznamenej proč. Duplicitní nálezy z víc oblastí slouč.
Medium/Low ověř aspoň namátkou.

## 4. Opravy (bez `--no-fix`)

- **Critical a High opravit vždy.** Je-li oprava rozhodnutím vlastníka (cena,
  UX, schéma DB, mazání dat), zeptej se Martina a PR do té doby neotevírej.
- **Medium** opravit, když je oprava lokální a bezpečná; jinak vypsat.
- **Low** jen vypsat (do popisu PR).
- Ke každé opravě chování test (vitest, mocky podle vzorů v okolních testech).
- Pravidla projektu platí dál: bezstrátové migrace, žádné secrets, commity
  česky v konvenčním formátu.

## 5. Validace a další kolo

```bash
npx turbo typecheck lint format:check test --continue
```

Při změně závislostí, konfigurace Next.js nebo buildu i
`DATABASE_URL=postgresql://x:y@127.0.0.1:1/x AUTH_SECRET=build-only npx turbo build --filter=@ai-sedlacek/web`.
Opravy commitni (`fix: nálezy z review – …`).

Když opravy sáhly do autorizace, účtování, migrací nebo přidaly nový soubor,
pusť znovu reviewery dotčených oblastí nad diffem oprav. Nejvýš 3 kola – pak
zbylé nálezy předlož Martinovi.

## 6. Marker

Jen když nezbývá žádný otevřený Critical/High, validace je zelená a strom je
čistý (necommitnuté změny skript odmítne):

```bash
.claude/hooks/mark-reviewed.sh "C=0 H=0 M=<n> L=<n>, <k> kola"
```

S `--no-fix` nebo s otevřeným Critical/High marker **nezapisuj**.

## 7. Výstup

Martinovi stručně: tabulka nálezů podle oblastí (nalezeno / potvrzeno /
opraveno), co zůstalo otevřené a proč, počet kol, výsledek validace. Zbylé
Medium/Low dej do popisu PR do sekce „Review“.

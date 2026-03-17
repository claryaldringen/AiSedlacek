# OCR enginy – aktuální stav a plán

Zpět na hlavní dokumentaci: [CLAUDE.md](../CLAUDE.md)

---

## Aktuální stav: Claude Vision (jediný engine)

Aktuálně aplikace používá **jeden OCR engine** – Claude Opus 4.6 s multimodálním
přístupem. V jednom API volání provede:

1. Přečtení textu z obrázku (OCR)
2. Překlad do cílového jazyka
3. Historický kontext
4. Glosář archaických termínů

**Implementace:** `apps/web/lib/adapters/ocr/claude-vision.ts`

### Výhody současného přístupu

- **Jednoduchost** – jeden API call, žádná orchestrace
- **Kvalita** – Claude Vision rozumí kontextu, rozpozná zkratky, označí nejistotu
- **Nízké halucinace** – 0.09 % dle benchmarků (nejlepší z testovaných LLM)
- **Žádné extra závislosti** – stejné SDK jako pro ostatní LLM úlohy

### Známá omezení

- **Limit velikosti obrázku** – max 5 MB (řešeno automatickým resize přes Sharp)
- **Neanglické jazyky** – slabší než na angličtině, ale stále kompetitivní
- **Nedeterministický výstup** – při opakovaném zpracování může dát mírně jiný text
- **Cena** – dražší než Tesseract (zdarma) nebo Transkribus (~0.02 €/stránka)

---

## Plánovaný ensemble (Fáze 2)

Přidání více OCR enginů pro snížení chybovosti o 30–50 %:

| Engine | Typ | Silné stránky | Slabé stránky | Cena |
|--------|-----|---------------|---------------|------|
| **Transkribus** | Cloud HTR/OCR | Nejlepší na německé a středoevropské historické texty; 300+ modelů | Kreditový systém; slabší bez specializovaného modelu | ~0.02 €/stránka |
| **Tesseract.js** | Open source | Zdarma; běží v prohlížeči; frakturový model | Slabý na rukopisy; nemá staročeský model | Zdarma |
| **Claude Vision** | Multimodální LLM | Kontextové porozumění; nízké halucinace; zvládá zkratky | Dražší; nedeterministický | ~0.006 $/obrázek |

### Multimodální konsolidace

Klíčová inovace: konsolidační krok dostane **obrázek + všechny OCR výstupy**.
Studie ukazují, že multimodální post-korekce dramaticky snižuje chybovost
oproti čistě textové korekci.

Domain rozhraní jsou připravena v `packages/shared/src/domain/`:
- `IOcrEngine` – rozhraní pro OCR engine
- `ITranslator` – rozhraní pro konsolidaci a překlad
- `ILayoutClassifier` – rozhraní pro klasifikaci layoutu

Prompty pro konsolidaci v `packages/shared/src/prompts.ts`.

---

## Kraken segmentace (Fáze 3 – plánováno)

Pro složité layouty (marginální glosy, více sloupců, zakřivené řádky).

### Proč Kraken

Kraken je Python-only, vyžaduje GPU. Hlavní přínos: **baseline detekce** místo
obdélníkových rámců – zásadní pro středověké layouty. V Tier 2 slouží jako
segmentátor (rozřeže stránku na řádky), které pak ostatní enginy přečtou.

### Docker microservice (plán)

```dockerfile
FROM python:3.11-slim
RUN pip install --no-cache-dir kraken flask gunicorn
WORKDIR /app
COPY api.py .
COPY models/ ./models/
EXPOSE 5001
CMD ["gunicorn", "--bind", "0.0.0.0:5001", "--timeout", "300", "api:app"]
```

Endpointy:
- `POST /segment` – segmentace stránky na řádky (baseline + bounding box + image slice)
- `POST /recognize` – plné rozpoznání (segmentace + OCR)
- `GET /health` – health check

### Tier 2 workflow (plán)

1. Kraken segmentuje stránku na řádky
2. Transkribus + Tesseract + Claude Vision paralelně na každý řádek
3. Sestavení výsledků zpět do celostránkového textu
4. Multimodální konsolidace + překlad

### Kdy přidat Tier 2

- Pravidelně zpracováváš rukopisy se složitým layoutem
- Tier 1 nestačí na segmentaci (text z gloss se míchá)
- Potřebuješ trénovat vlastní Kraken modely

## Studie a benchmarky (stav 2025)

- **Moderní rukopisy:** LLM překonávají Transkribus (GPT-4o-mini: 1.71 % CER vs vyšší u Transkribus)
- **Historické dokumenty:** Smíšené výsledky; Transkribus lepší na německých datasetech
- **Multimodální post-korekce:** Nejlepší ze všech přístupů (obrázek + zašuměný OCR → dramatický pokles chybovosti)
- **Claude specificky:** Nejnižší halucinace (0.09 %), excelentní na složité layouty

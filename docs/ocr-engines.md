# OCR enginy – detaily, benchmarky, Kraken

Detailní informace o OCR enginech, benchmarky a Kraken Docker setup. Zpět na hlavní dokumentaci: [CLAUDE.md](../CLAUDE.md)

---

## Proč je Claude Vision jako OCR engine unikátní

Na rozdíl od Transkribu a Tesseractu, které rozpoznávají znaky po řádcích bez porozumění
obsahu, Claude Vision **čte a rozumí zároveň**. To přináší několik zásadních výhod
pro středověké texty:

- **Zkratky:** Tradiční OCR přepíše zkratku jako sekvenci znaků (často chybně).
  Claude Vision rozpozná, že jde o zkratku, a může ji rovnou rozvinout.
- **Poškozený text:** Kde Transkribus vidí nečitelné znaky, Claude Vision může
  odhadnout chybějící text z kontextu – a označit nejistotu.
- **Halucinace:** Claude je mezi LLM nejméně náchylný k vymýšlení textu.
  Jako jediný model aktivně vkládá [...] tam, kde si není jistý.
- **Žádná nová závislost:** Claude API se v pipeline už používá pro konsolidaci
  a překlad. OCR krok je jen jiný prompt na stejné API.

## Studie a benchmarky (stav 2025)

- **Moderní rukopisy:** LLM překonávají Transkribus. GPT-4o-mini dosahuje 1.71 % CER
  na datasetu IAM, Transkribus Text Titan I má vyšší chybovost.
- **Historické dokumenty:** Výsledky jsou smíšené. Na německých a vícejazyčných
  datasetech si Transkribus vede lépe; na italských a moderních lepší LLM.
- **Multimodální post-korekce:** Nejlepší výsledky ze všech přístupů. Když se LLM
  pošle obrázek + zašuměný OCR výstup, chybovost klesá dramaticky – to je přesně
  náš konsolidační krok.
- **Claude specificky:** Nejnižší halucinace ze všech testovaných LLM (0.09 %).
  Excelentní na složité layouty. Na neanglických jazycích slabší než na angličtině,
  ale stále kompetitivní.

## Proč Kraken jako samostatný tier

Kraken je Python-only a vyžaduje GPU pro rozumný výkon, proto běží jako Docker
microservice. Jeho hlavní přínos není v samotném rozpoznávání znaků (tam je srovnatelný
s Transkribus), ale v **segmentaci**: používá baseline detekci místo obdélníkových rámců,
což je zásadní výhoda pro složité středověké layouty. V Tier 2 slouží primárně jako
segmentátor – rozřeže stránku na řádky, které pak Transkribus a Tesseract přečtou.

Navíc Kraken 5 nabízí **neřízený pretraining** – dokáže se naučit vizuální reprezentace
z neanotovaných obrázků řádků, čímž dramaticky snižuje potřebu ručně přepsaných
trénovacích dat pro nové typy písma.

---

## Kraken – Docker microservice

### Proč Docker

Kraken je Python-only s těžkými závislostmi (PyTorch, CUDA). Zabalením do Docker
kontejneru zachováme čistě TypeScript hlavní aplikaci a komunikujeme přes REST API.

### Dockerfile

```dockerfile
FROM python:3.11-slim

# Volitelně: NVIDIA base image pro GPU
# FROM nvidia/cuda:12.1-runtime-ubuntu22.04

RUN pip install --no-cache-dir kraken flask gunicorn

WORKDIR /app
COPY api.py .
COPY models/ ./models/

EXPOSE 5001
CMD ["gunicorn", "--bind", "0.0.0.0:5001", "--timeout", "300", "api:app"]
```

### REST API (api.py)

```python
from flask import Flask, request, jsonify
from kraken import blla, rpred
from kraken.lib import vgsl, models
import io, base64
from PIL import Image

app = Flask(__name__)

# Načtení modelů při startu
seg_model = vgsl.TorchVGSLModel.load_model("models/blla.mlmodel")
rec_model = models.load_any("models/default_recognition.mlmodel")

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})

@app.route("/segment", methods=["POST"])
def segment():
    """Segmentace stránky na řádky – hlavní use case pro Tier 2."""
    data = request.json
    image = Image.open(io.BytesIO(base64.b64decode(data["image_base64"])))
    baseline_seg = blla.segment(image, model=seg_model)

    lines = []
    for idx, line in enumerate(baseline_seg.lines):
        # Výřez obrázku pro každý řádek
        bbox = line.bbox
        line_img = image.crop(bbox)
        buf = io.BytesIO()
        line_img.save(buf, format="PNG")

        lines.append({
            "id": f"line_{idx}",
            "baseline": line.baseline.tolist(),
            "bbox": list(bbox),
            "image_base64": base64.b64encode(buf.getvalue()).decode()
        })

    return jsonify({"lines": lines, "count": len(lines)})

@app.route("/recognize", methods=["POST"])
def recognize():
    """Plné rozpoznání: segmentace + OCR (volitelný fallback)."""
    data = request.json
    image = Image.open(io.BytesIO(base64.b64decode(data["image_base64"])))
    baseline_seg = blla.segment(image, model=seg_model)
    pred = rpred.rpred(rec_model, image, baseline_seg)

    lines = []
    for record in pred:
        lines.append({
            "text": record.prediction,
            "confidence": float(record.confidences.mean()),
            "bbox": list(record.line.bbox)
        })

    full_text = "\n".join(l["text"] for l in lines)
    return jsonify({"text": full_text, "lines": lines})
```

### docker-compose.yml

```yaml
version: "3.8"

services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - KRAKEN_API_URL=http://kraken:5001
    depends_on:
      kraken:
        condition: service_healthy

  kraken:
    build: ./docker/kraken
    ports:
      - "5001:5001"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:5001/health"]
      interval: 10s
      timeout: 5s
      retries: 3
    # Volitelně pro GPU:
    # deploy:
    #   resources:
    #     reservations:
    #       devices:
    #         - driver: nvidia
    #           count: 1
    #           capabilities: [gpu]
```

### TypeScript klient

```typescript
// lib/ocr/kraken.ts

interface KrakenSegmentResponse {
  lines: {
    id: string;
    baseline: number[][];
    bbox: number[];
    image_base64: string;
  }[];
  count: number;
}

interface KrakenRecognizeResponse {
  text: string;
  lines: {
    text: string;
    confidence: number;
    bbox: number[];
  }[];
}

export class KrakenClient {
  constructor(private baseUrl: string = process.env.KRAKEN_API_URL || 'http://localhost:5001') {}

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(2000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async segment(imageBase64: string): Promise<KrakenSegmentResponse> {
    const res = await fetch(`${this.baseUrl}/segment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_base64: imageBase64 }),
    });
    if (!res.ok) throw new Error(`Kraken segment failed: ${res.statusText}`);
    return res.json();
  }

  async recognize(imageBase64: string): Promise<KrakenRecognizeResponse> {
    const res = await fetch(`${this.baseUrl}/recognize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_base64: imageBase64 }),
    });
    if (!res.ok) throw new Error(`Kraken recognize failed: ${res.statusText}`);
    return res.json();
  }
}
```

### Tier 2 workflow

```typescript
// lib/ocr/tier-router.ts

async function processTier2(imageBase64: string, config: {
  transkribus: TranskribusConfig;
  kraken: KrakenConfig;
}): Promise<OcrEngineResult[]> {
  const kraken = new KrakenClient(config.kraken.baseUrl);

  // 1. Kraken segmentuje stránku na řádky
  const segmentation = await kraken.segment(imageBase64);

  // 2. Řádkové obrázky → Transkribus + Tesseract paralelně
  const results = await Promise.all(
    segmentation.lines.map(async (line) => {
      const [transkribusResult, tesseractResult] = await Promise.all([
        recognizeWithTranskribus(line.image_base64, config.transkribus),
        recognizeWithTesseract(line.image_base64),
      ]);
      return { lineId: line.id, transkribus: transkribusResult, tesseract: tesseractResult };
    })
  );

  // 3. Sestavení výstupů po řádcích
  return [
    {
      engine: 'kraken' as const,
      role: 'segmenter' as const,
      text: '',
      lines: segmentation.lines.map(l => ({
        id: l.id,
        baseline: l.baseline,
        boundingBox: { x: l.bbox[0], y: l.bbox[1], width: l.bbox[2] - l.bbox[0], height: l.bbox[3] - l.bbox[1] },
        imageSlice: Buffer.from(l.image_base64, 'base64'),
      })),
      processingTimeMs: 0, // měřit skutečný čas
    },
    {
      engine: 'transkribus' as const,
      role: 'recognizer' as const,
      text: results.map(r => r.transkribus).join('\n'),
      processingTimeMs: 0,
    },
    {
      engine: 'tesseract' as const,
      role: 'recognizer' as const,
      text: results.map(r => r.tesseract).join('\n'),
      processingTimeMs: 0,
    },
  ];
}
```

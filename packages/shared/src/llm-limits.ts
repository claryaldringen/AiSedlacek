/**
 * Limity výstupu (`max_tokens`) textových volání LLM – jediné místo, odkud je
 * berou volání v workeru i webu a zároveň odhad rezervace kreditu (BIL-1):
 * rezervuje se max_tokens × výstupní sazba, takže limit a rezervace se nesmí
 * rozejít. OCR dávky mají vlastní výpočet (`batchMaxTokens` v packages/ocr).
 */
export const LLM_MAX_TOKENS = {
  /** Retranslace po editaci transkripce. */
  retranslate: 8192,
  /** Překlad existujícího dokumentu do dalšího jazyka (příprava OCR jobu). */
  translateDocument: 8192,
  /** Kontext svazku z přepisů stránek. */
  generateContext: 16_000,
  /** Strukturovaná metadata z kontextu svazku. */
  contextMetadata: 1024,
  /** Oprava kontextu jednoho dokumentu podle kontextu svazku. */
  fixContext: 2048,
  /** Překlad kontextu svazku. */
  translateContext: 16_000,
  /** Kontext svazku z URL nebo vloženého textu. */
  fetchContext: 16_000,
  /** Chat nad dokumentem. */
  chat: 8192,
} as const;

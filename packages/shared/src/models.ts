/**
 * Modely Claude používané aplikací – jediné místo, kde se mění.
 *
 * Upgrade na novější generaci (např. claude-opus-5-5 / claude-sonnet-5-5) není
 * jen záměna ID: novější modely odmítají `temperature` a mají jiné chování
 * thinkingu, ceny i tokenizer – viz sekce „Příležitosti OCR/LLM" v code review
 * 2026-10-14. Před změnou ověřit kvalitu na vzorku stránek.
 */

/** OCR + překlad + kontext + glosář z obrázku (multimodální). */
export const OCR_MODEL = 'claude-opus-4-6';

/** Textové úlohy: retranslace, chat, kontexty svazků, metadata. */
export const TEXT_MODEL = 'claude-sonnet-4-6';

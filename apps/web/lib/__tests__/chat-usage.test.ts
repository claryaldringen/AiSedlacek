import { describe, it, expect } from 'vitest';
import {
  INCOMPLETE_CHAT_USAGE,
  addChatUsage,
  addChatUsageToDocument,
  chatUsageFromEvent,
} from '../chat-usage';

const USAGE = { inputTokens: 1200, outputTokens: 80, model: 'claude-sonnet-4-6' };

describe('chatUsageFromEvent – spotřeba z událostí SSE chatu', () => {
  it('done nese tokeny i skutečně odečtené kredity', () => {
    expect(chatUsageFromEvent({ type: 'done', usage: USAGE, chargedCredits: 4321 })).toEqual({
      ...USAGE,
      chargedCredits: 4321,
    });
  });

  it('error po přerušení nese částečnou spotřebu, která se naúčtovala', () => {
    expect(
      chatUsageFromEvent({ type: 'error', error: 'x', usage: USAGE, chargedCredits: 2500 }),
    ).toEqual({ ...USAGE, chargedCredits: 2500 });
  });

  it('error bez spotřeby a ostatní události spotřebu nenesou', () => {
    expect(chatUsageFromEvent({ type: 'error', error: 'x' })).toBeNull();
    expect(chatUsageFromEvent({ type: 'text', text: 'Ahoj' })).toBeNull();
  });

  it('done ze starší verze serveru (bez kreditů) – jen tokeny', () => {
    expect(chatUsageFromEvent({ type: 'done', usage: USAGE })).toEqual(USAGE);
  });
});

describe('addChatUsage – souhrn chatu dokumentu', () => {
  it('sčítá tokeny i skutečné kredity všech odpovědí včetně přerušených', () => {
    let state = addChatUsage({}, { ...USAGE, chargedCredits: 4321 });
    state = addChatUsage(state, { ...USAGE, outputTokens: 20, chargedCredits: 2500 });
    expect(state).toEqual({
      chatInputTokens: 2400,
      chatOutputTokens: 100,
      chatModel: 'claude-sonnet-4-6',
      chatChargedCredits: 6821,
      chatChargeIncomplete: false,
    });
  });

  it('odpověď bez známého odečtu označí cenu jako neúplnou, součty nemění', () => {
    const state = addChatUsage(
      { chatInputTokens: 10, chatOutputTokens: 5, chatModel: 'm', chatChargedCredits: 100 },
      INCOMPLETE_CHAT_USAGE,
    );
    expect(state).toEqual({
      chatInputTokens: 10,
      chatOutputTokens: 5,
      chatModel: 'm',
      chatChargedCredits: 100,
      chatChargeIncomplete: true,
    });
  });
});

// Uživatel během odpovědi chatu přepne na jinou stránku: spotřeba patří dokumentu,
// ke kterému se odpověď psala, a nesmí panel přepnout zpět na jeho obsah.
describe('addChatUsageToDocument – spotřeba jen k dokumentu, ke kterému odpověď patří', () => {
  const docA = { id: 'doc-a', transcription: 'A' };
  const docB = { id: 'doc-b', transcription: 'B' };

  it('přičte spotřebu, když panel ukazuje stejný dokument', () => {
    expect(addChatUsageToDocument(docA, 'doc-a', { ...USAGE, chargedCredits: 10 })).toEqual({
      ...docA,
      chatInputTokens: 1200,
      chatOutputTokens: 80,
      chatModel: 'claude-sonnet-4-6',
      chatChargedCredits: 10,
      chatChargeIncomplete: false,
    });
  });

  it('nechá panel beze změny, když už ukazuje jiný dokument', () => {
    const current = docB;
    expect(addChatUsageToDocument(current, 'doc-a', { ...USAGE, chargedCredits: 10 })).toBe(
      current,
    );
  });

  it('nechá prázdný panel prázdný (stránka se ještě načítá)', () => {
    expect(addChatUsageToDocument(null, 'doc-a', USAGE)).toBeNull();
  });
});

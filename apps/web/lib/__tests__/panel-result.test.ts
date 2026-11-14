import { describe, it, expect } from 'vitest';
import { PanelLoadGuard, applyResultPatch, applyResultUpdate } from '../panel-result';

const A = { id: 'doc-a', transcription: 'A' };
const B = { id: 'doc-b', transcription: 'B' };

describe('applyResultUpdate – aktualizace jen pro dokument v panelu', () => {
  it('legitimní aktualizace téhož dokumentu projde (uložení, obnova verze, chat, retranslace, regenerace)', () => {
    const saved = { ...A, transcription: 'A – upraveno' };
    expect(applyResultUpdate(A, saved)).toBe(saved);
  });

  it('zastaralý snímek dokumentu A po přepnutí na B panel nezmění', () => {
    // např. rollback optimistické úpravy z chatu nebo doběhlé uložení A
    expect(applyResultUpdate(B, A)).toBe(B);
  });

  it('panel bez dokumentu (načítá se jiná stránka) zůstane prázdný', () => {
    expect(applyResultUpdate(null, A)).toBeNull();
  });
});

describe('PanelLoadGuard – rychlé listování předchozí/další', () => {
  it('A → B → C: pozdě doběhlé načtení B se do panelu nezapíše a je přerušené', () => {
    const guard = new PanelLoadGuard();
    const a = guard.begin('page-a');
    const b = guard.begin('page-b');
    const c = guard.begin('page-c');

    expect(a.isCurrent()).toBe(false);
    expect(b.isCurrent()).toBe(false);
    expect(c.isCurrent()).toBe(true);
    expect(a.signal.aborted).toBe(true);
    expect(b.signal.aborted).toBe(true);
    expect(c.signal.aborted).toBe(false);
  });

  it('znovuotevření téže stránky: platí jen poslední načtení', () => {
    const guard = new PanelLoadGuard();
    const first = guard.begin('page-a');
    const second = guard.begin('page-a');
    expect(first.isCurrent()).toBe(false);
    expect(second.isCurrent()).toBe(true);
    expect(guard.isOpen('page-a')).toBe(true);
  });

  it('zavření panelu zahodí rozpracované načtení', () => {
    const guard = new PanelLoadGuard();
    const a = guard.begin('page-a');
    guard.close();
    expect(a.isCurrent()).toBe(false);
    expect(a.signal.aborted).toBe(true);
    expect(guard.isOpen('page-a')).toBe(false);
  });

  it('isOpen: doběhlá regenerace stránky A po přepnutí na B panel nepřepíše', () => {
    const guard = new PanelLoadGuard();
    guard.begin('page-a');
    expect(guard.isOpen('page-a')).toBe(true);
    guard.begin('page-b');
    expect(guard.isOpen('page-a')).toBe(false);
    expect(guard.isOpen('page-b')).toBe(true);
  });
});

// Uložení pole, použití návrhu z chatu (i jeho rollback) a doběhlá retranslace
// zapisují do panelu jen změněná pole nad aktuálním stavem – ne celý snímek
// dokumentu z doby, kdy akce začala (ten by vrátil mezitím uložený kontext,
// návrh z chatu nebo spotřebu chatu).
describe('applyResultPatch – jen změněná pole, nad aktuálním stavem panelu', () => {
  const doc = {
    id: 'doc-a',
    transcription: 'T1',
    context: 'K1',
    translation: 'P1',
    translationLanguage: 'cs',
    chatChargedCredits: 50,
  };

  it('zapíše jen patch a zachová mezitím uložené změny', () => {
    const current = { ...doc, context: 'K2 z chatu', chatChargedCredits: 80 };
    expect(
      applyResultPatch(current, 'doc-a', { translation: 'P2' }, { translationLanguage: 'cs' }),
    ).toEqual({
      ...current,
      translation: 'P2',
    });
  });

  it('jiný dokument v panelu (přepnutá stránka) nezmění', () => {
    const other = { ...doc, id: 'doc-b' };
    expect(applyResultPatch(other, 'doc-a', { transcription: 'X' })).toBe(other);
    expect(applyResultPatch<typeof doc>(null, 'doc-a', { transcription: 'X' })).toBeNull();
  });

  it('překlad jiného jazyka, než panel ukazuje, nezapíše', () => {
    const current = { ...doc, translationLanguage: 'en' };
    expect(
      applyResultPatch(current, 'doc-a', { translation: 'P2' }, { translationLanguage: 'cs' }),
    ).toBe(current);
  });

  it('rollback jen když v panelu pořád je hodnota, kterou vrací', () => {
    const optimistic = { ...doc, context: 'K2' };
    expect(
      applyResultPatch(optimistic, 'doc-a', { context: 'K1' }, { expected: { context: 'K2' } }),
    ).toEqual(doc);
    // uživatel mezitím kontext znovu upravil – rollback by jeho úpravu zahodil
    const editedAgain = { ...doc, context: 'K3' };
    expect(
      applyResultPatch(editedAgain, 'doc-a', { context: 'K1' }, { expected: { context: 'K2' } }),
    ).toBe(editedAgain);
  });
});

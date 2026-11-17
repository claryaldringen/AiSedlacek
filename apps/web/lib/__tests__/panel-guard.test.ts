import { describe, it, expect, vi } from 'vitest';
import { OpenEditorTracker, guardPanelNavigation, navNoticeReducer } from '../panel-guard';

describe('navNoticeReducer – hláška o zablokovaném listování', () => {
  it('každé zablokování hlášku ukáže (a restartuje její časovač)', () => {
    expect(navNoticeReducer(0, 'blocked')).toBe(1);
    expect(navNoticeReducer(1, 'blocked')).toBe(2);
  });

  it('zmizí po vypršení, při přepnutí stránky i po zavření editoru', () => {
    expect(navNoticeReducer(2, 'timeout')).toBe(0);
    expect(navNoticeReducer(2, 'page-changed')).toBe(0);
    expect(navNoticeReducer(2, 'editor-closed')).toBe(0);
  });
});

describe('OpenEditorTracker – otevřené editory textu v panelu', () => {
  it('otevřený je, dokud zůstává otevřený aspoň jeden editor', () => {
    const tracker = new OpenEditorTracker();
    expect(tracker.set('transcription', true)).toBe(true);
    expect(tracker.set('translation', true)).toBe(true);
    expect(tracker.set('transcription', false)).toBe(true);
    expect(tracker.set('translation', false)).toBe(false);
  });

  it('opakované hlášení téhož editoru se nepočítá dvakrát', () => {
    const tracker = new OpenEditorTracker();
    tracker.set('context', true);
    tracker.set('context', true);
    expect(tracker.set('context', false)).toBe(false);
  });

  it('zavření neotevřeného editoru (odpojení sekce) nic nerozbije', () => {
    expect(new OpenEditorTracker().set('translation', false)).toBe(false);
  });
});

describe('guardPanelNavigation – rozepsaný text nesmí přepnutím stránky zmizet', () => {
  it('s otevřeným editorem se stránka nepřepne a ukáže se hláška', () => {
    const navigate = vi.fn();
    const onBlocked = vi.fn();
    expect(guardPanelNavigation(true, navigate, onBlocked)).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
    expect(onBlocked).toHaveBeenCalledOnce();
  });

  it('bez otevřeného editoru se přepne normálně', () => {
    const navigate = vi.fn();
    const onBlocked = vi.fn();
    expect(guardPanelNavigation(false, navigate, onBlocked)).toBe(true);
    expect(navigate).toHaveBeenCalledOnce();
    expect(onBlocked).not.toHaveBeenCalled();
  });
});

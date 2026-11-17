import { describe, it, expect } from 'vitest';
import { isControlActivationKey } from '../keyboard-target';

const inside = (match: boolean) => ({ closest: () => (match ? {} : null) });

describe('isControlActivationKey – aktivační klávesy patří tlačítku s fokusem', () => {
  it('Enter a mezerník na tlačítku/odkazu nechá ovládacímu prvku', () => {
    expect(isControlActivationKey('Enter', inside(true))).toBe(true);
    expect(isControlActivationKey(' ', inside(true))).toBe(true);
  });

  it('mimo ovládací prvek (mřížka, body) zkratky platí', () => {
    expect(isControlActivationKey('Enter', inside(false))).toBe(false);
    expect(isControlActivationKey('Enter', null)).toBe(false);
    expect(isControlActivationKey('Enter', {})).toBe(false);
  });

  it('šipky, Delete a další klávesy zkratky ovládají i na tlačítku', () => {
    for (const key of ['ArrowDown', 'ArrowLeft', 'Delete', 'Backspace', 'a', 'Escape']) {
      expect(isControlActivationKey(key, inside(true))).toBe(false);
    }
  });
});

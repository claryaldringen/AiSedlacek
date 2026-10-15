import { describe, it, expect } from 'vitest';
import { isReadOnly, readCanEdit } from '../read-only';

describe('readCanEdit', () => {
  it('reads canEdit from the API response', () => {
    expect(readCanEdit({ id: 'c1', canEdit: true })).toBe(true);
    expect(readCanEdit({ id: 'c1', canEdit: false })).toBe(false);
  });

  it('defaults to true when the field is missing (older API)', () => {
    expect(readCanEdit({ id: 'c1', pages: [] })).toBe(true);
    expect(readCanEdit([])).toBe(true);
    expect(readCanEdit(null)).toBe(true);
    expect(readCanEdit(undefined)).toBe(true);
  });

  it('treats only an explicit false as read-only', () => {
    expect(readCanEdit({ canEdit: null })).toBe(true);
    expect(readCanEdit({ canEdit: 'false' })).toBe(true);
  });
});

describe('isReadOnly', () => {
  it('is read-only only for the object the access was loaded for', () => {
    const access = { id: 'c1', canEdit: false };
    expect(isReadOnly(access, 'c1')).toBe(true);
    expect(isReadOnly(access, 'c2')).toBe(false);
  });

  it('is editable when the owner may edit', () => {
    expect(isReadOnly({ id: 'c1', canEdit: true }, 'c1')).toBe(false);
  });

  it('uses the fallback while access for the id is unknown', () => {
    expect(isReadOnly(null, 'p1')).toBe(false);
    expect(isReadOnly(null, 'p1', true)).toBe(true);
    expect(isReadOnly({ id: 'p0', canEdit: true }, 'p1', true)).toBe(true);
    expect(isReadOnly({ id: 'p1', canEdit: true }, 'p1', true)).toBe(false);
  });

  it('falls back without an id (root view, closed panel)', () => {
    expect(isReadOnly({ id: 'c1', canEdit: false }, null)).toBe(false);
    expect(isReadOnly({ id: 'c1', canEdit: false }, undefined, true)).toBe(true);
  });
});

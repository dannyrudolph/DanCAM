import { describe, expect, it } from 'vitest';
import { TOOLS } from './app';

describe('tool shortcuts', () => {
  it('gives every tool its own key', () => {
    const keys = TOOLS.map((t) => t.shortcut).filter((k) => k !== '');
    expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([]);
  });

  it('keeps the Phase 3 keys the user approved', () => {
    const byId = Object.fromEntries(TOOLS.map((t) => [t.id, t.shortcut]));
    expect(byId).toMatchObject({ trim: 't', extend: 'shift+t', fillet: 'f', chamfer: 'shift+f', offset: 'o', break: 'b', join: 'j', lengthen: 'shift+l', array: 'shift+a', stretch: 'shift+s' });
  });
});

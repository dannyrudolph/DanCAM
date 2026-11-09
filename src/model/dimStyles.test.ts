import { describe, expect, it } from 'vitest';
import { defaultDimStyle } from './dimStyle';
import { addDimStyle, deleteDimStyle, dimStyleUsage, editDimStyle, ensureCurrentDimStyle, renameDimStyle } from './dimStyles';
import { createDrawing } from './drawing';
import type { DimensionEntity } from './entity';
import { UndoStack } from './undo';

const dim = (id: string, dimStyle: string): DimensionEntity => ({ kind: 'dimension', id, layer: '0', dimStyle, type: 'aligned', p1: { x: 0, y: 0 }, p2: { x: 1, y: 0 }, at: { x: 0, y: 1 } });

function setup() {
  const d = createDrawing('in');
  const undo = new UndoStack(d);
  d.entities.set('a', dim('a', 'INCH-3PL'));
  d.entities.set('b', dim('b', 'INCH-3PL'));
  return { d, undo };
}

const ok = (r: ReturnType<typeof editDimStyle>) => {
  if (!r.ok) throw new Error(r.error);
  return r.tx;
};

describe('dimension styles', () => {
  it('New copies a style under the first free -N name', () => {
    const { d, undo } = setup();
    const first = addDimStyle(d, 'INCH-3PL');
    undo.commit(first.tx);
    expect(first.name).toBe('INCH-3PL-2');
    expect(d.dimStyles.get('INCH-3PL-2')).toEqual({ ...defaultDimStyle('in'), name: 'INCH-3PL-2' });
    expect(addDimStyle(d, 'INCH-3PL').name).toBe('INCH-3PL-3');
  });

  it('an edit is one undo step; undefined removes an optional field; no change gives no step', () => {
    const { d, undo } = setup();
    undo.commit(ok(editDimStyle(d, 'INCH-3PL', { precision: 4, suffix: ' TYP' })));
    expect(d.dimStyles.get('INCH-3PL')).toMatchObject({ precision: 4, suffix: ' TYP' });
    undo.commit(ok(editDimStyle(d, 'INCH-3PL', { suffix: undefined })));
    expect('suffix' in d.dimStyles.get('INCH-3PL')!).toBe(false);
    expect(editDimStyle(d, 'INCH-3PL', { precision: 4 })).toEqual({ ok: false, error: '' });
    undo.undo();
    undo.undo();
    expect(d.dimStyles.get('INCH-3PL')).toEqual(defaultDimStyle('in'));
  });

  it('refuses sizes and tolerances that make no style', () => {
    const { d } = setup();
    expect(editDimStyle(d, 'INCH-3PL', { textHeight: 0 })).toEqual({ ok: false, error: 'The text height must be more than zero.' });
    expect(editDimStyle(d, 'INCH-3PL', { arrowSize: -0.1 })).toEqual({ ok: false, error: 'Sizes can not be negative.' });
    expect(editDimStyle(d, 'INCH-3PL', { tolerance: { kind: 'deviation', upper: -0.001, lower: 0 } })).toEqual({
      ok: false,
      error: 'The upper tolerance must not be below the lower one.',
    });
    expect(editDimStyle(d, 'INCH-3PL', { precision: 9 }).ok).toBe(false);
  });

  it('a rename moves its dimensions and the current style with it, as one undo step', () => {
    const { d, undo } = setup();
    undo.commit(ok(renameDimStyle(d, 'INCH-3PL', 'DETAIL')));
    ensureCurrentDimStyle(d, 'INCH-3PL', 'DETAIL');
    expect([...d.dimStyles.keys()]).toEqual(['DETAIL']);
    expect(dimStyleUsage(d)).toEqual(new Map([['DETAIL', 2]]));
    expect(d.currentDimStyle).toBe('DETAIL');
    undo.undo();
    expect(dimStyleUsage(d)).toEqual(new Map([['INCH-3PL', 2]]));
    ensureCurrentDimStyle(d); // the undo removed DETAIL: the current style falls back
    expect(d.currentDimStyle).toBe('INCH-3PL');
    expect(renameDimStyle(d, 'INCH-3PL', ' ')).toEqual({ ok: false, error: 'A dimension style needs a name.' });
  });

  it('delete is refused for a style in use, the current one, or the last; allowed otherwise', () => {
    const { d, undo } = setup();
    expect(deleteDimStyle(d, 'INCH-3PL')).toEqual({ ok: false, error: 'A drawing keeps at least one dimension style.' });
    undo.commit(addDimStyle(d, 'INCH-3PL').tx);
    expect(deleteDimStyle(d, 'INCH-3PL')).toEqual({ ok: false, error: 'INCH-3PL is the current style; make another current first.' });
    d.currentDimStyle = 'INCH-3PL-2';
    expect(deleteDimStyle(d, 'INCH-3PL')).toEqual({ ok: false, error: '2 dimensions use INCH-3PL.' });
    d.currentDimStyle = 'INCH-3PL';
    undo.commit(ok(deleteDimStyle(d, 'INCH-3PL-2')));
    expect([...d.dimStyles.keys()]).toEqual(['INCH-3PL']);
  });
});

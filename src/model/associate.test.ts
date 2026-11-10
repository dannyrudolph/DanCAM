import { describe, expect, it } from 'vitest';
import { withNewIds } from './anchor';
import { createDrawing } from './drawing';
import type { DimensionEntity, Entity } from './entity';
import { UndoStack } from './undo';

const v = (x: number, y: number) => ({ x, y });
type Dim = DimensionEntity;
const H = v(1, 0);

/** A drawing holding `es`, and its undo stack. */
function setup(...es: Entity[]) {
  const d = createDrawing('in');
  for (const e of es) d.entities.set(e.id, e);
  const undo = new UndoStack(d);
  const get = (id: string) => d.entities.get(id) as Extract<Dim, { type: 'linear' | 'aligned' }>; // or whichever type the test made
  const modify = (before: Entity, after: Entity) => undo.commit({ label: 'Edit', changes: [{ op: 'modify', before, after }] });
  return { d, undo, get, modify };
}

const line = (id: string, start: { x: number; y: number }, end: { x: number; y: number }): Entity => ({ kind: 'line', id, layer: '0', start, end });
const base = { kind: 'dimension', layer: '0', dimStyle: 'INCH-3PL' } as const;
/** A horizontal dimension of line L's ends, its line .5 below. */
const lengthOfL: Dim = { ...base, id: 'D', type: 'linear', dir: H, p1: v(0, 0), p2: v(2, 0), at: v(1, -0.5), anchors: { p1: { id: 'L', feature: 'start' }, p2: { id: 'L', feature: 'end' } } };

describe('associative dimensions', () => {
  it('an ordinate on a centerline\'s end follows the centerline as it follows its lines, in one undo step; it goes when they go', () => {
    const cl: Dim = { ...base, id: 'C', type: 'centerline', p1: v(1, 0), p2: v(1, 1), at: v(1, 0.5), anchors: { lines: ['A', 'B'] } };
    const o: Dim = { ...base, id: 'O', type: 'ordinate', p1: v(1, 1), origin: v(0, 0), axis: 'x', at: v(1, 2), anchors: { p1: { id: 'C', feature: 'end' } } };
    const { d, undo } = setup(line('A', v(0.9, 0), v(0.9, 1)), line('B', v(1.1, 0), v(1.1, 1)), cl, o);
    undo.commit({ label: 'Move', changes: [
      { op: 'modify', before: d.entities.get('A')!, after: line('A', v(1.4, 0), v(1.4, 1)) },
      { op: 'modify', before: d.entities.get('B')!, after: line('B', v(1.6, 0), v(1.6, 1)) },
    ] });
    expect(d.entities.get('C')).toMatchObject({ p1: v(1.5, 0), p2: v(1.5, 1) });
    expect(d.entities.get('O')).toMatchObject({ p1: v(1.5, 1), anchors: { p1: { id: 'C', feature: 'end' } } });
    undo.undo();
    expect(d.entities.get('O')).toEqual(o);
    expect(d.entities.get('C')).toEqual(cl);
    undo.commit({ label: 'Erase', changes: [{ op: 'remove', entity: d.entities.get('A')! }] });
    expect([...d.entities.keys()]).toEqual(['B']);
  });

  it('a moved line takes its dimension along, dimension line and all; one undo puts both back', () => {
    const { d, undo, get, modify } = setup(line('L', v(0, 0), v(2, 0)), lengthOfL);
    modify(d.entities.get('L')!, line('L', v(1, 3), v(3, 3)));
    expect(get('D')).toMatchObject({ p1: v(1, 3), p2: v(3, 3), at: v(2, 2.5) });
    expect(undo.undo()).toBe(true);
    expect(get('D')).toEqual(lengthOfL);
    expect(undo.redo()).toBe(true);
    expect(get('D').at).toEqual(v(2, 2.5));
  });

  it('a stretched end is measured again; the dimension line and dragged text stay put', () => {
    const { d, get, modify } = setup(line('L', v(0, 0), v(2, 0)), { ...lengthOfL, textAt: v(0.4, -0.5) });
    modify(d.entities.get('L')!, line('L', v(0, 0), v(2.375, 0.25)));
    expect(get('D')).toMatchObject({ p1: v(0, 0), p2: v(2.375, 0.25), at: v(1, -0.5), textAt: v(0.4, -0.5) });
  });

  it('deleting the geometry deletes its dimensions in the same undo step', () => {
    const { d, undo } = setup(line('L', v(0, 0), v(2, 0)), lengthOfL);
    undo.commit({ label: 'Erase', changes: [{ op: 'remove', entity: d.entities.get('L')! }] });
    expect([...d.entities.keys()]).toEqual([]);
    expect(undo.undoLabel).toBe('Erase');
    undo.undo();
    expect([...d.entities.keys()].sort()).toEqual(['D', 'L']);
  });

  it('a radius follows its circle, its text moving with the center; a circle trimmed to an arc keeps it', () => {
    const r: Dim = { ...base, id: 'R', type: 'radius', center: v(0, 0), radius: 0.5, at: v(1, 1), anchors: { curve: 'C' } };
    const { d, get, modify } = setup({ kind: 'circle', id: 'C', layer: '0', center: v(0, 0), radius: 0.5 }, r);
    modify(d.entities.get('C')!, { kind: 'circle', id: 'C', layer: '0', center: v(1, 0), radius: 0.625 });
    expect(get('R')).toMatchObject({ center: v(1, 0), radius: 0.625, at: v(2, 1) });
    modify(d.entities.get('C')!, { kind: 'arc', id: 'C', layer: '0', center: v(1, 0), radius: 0.625, startDeg: 0, endDeg: 180 });
    expect(get('R').anchors).toEqual({ curve: 'C' });
  });

  it('the angle between two lines is measured again when one turns', () => {
    const a: Dim = { ...base, id: 'A', type: 'angular', vertex: v(0, 0), p1: v(2, 0), p2: v(1, 1), dir1: H, dir2: v(Math.SQRT1_2, Math.SQRT1_2), at: v(1, 0.3), anchors: { lines: ['H', 'K'] } };
    const { d, get, modify } = setup(line('H', v(0, 0), v(2, 0)), line('K', v(0, 0), v(1, 1)), a);
    modify(d.entities.get('K')!, line('K', v(0, 0), v(0, 1)));
    expect(get('A')).toMatchObject({ vertex: v(0, 0), p1: v(2, 0), p2: v(0, 1), dir1: H, dir2: v(0, 1) });
  });

  it('an angle whose lines become parallel, or whose line becomes an arc, is deleted', () => {
    const a: Dim = { ...base, id: 'A', type: 'angular', vertex: v(0, 0), p1: v(2, 0), p2: v(1, 1), dir1: H, dir2: v(Math.SQRT1_2, Math.SQRT1_2), at: v(1, 0.3), anchors: { lines: ['H', 'K'] } };
    const { d, modify } = setup(line('H', v(0, 0), v(2, 0)), line('K', v(0, 0), v(1, 1)), a);
    modify(d.entities.get('K')!, line('K', v(0, 1), v(1, 1)));
    expect(d.entities.has('A')).toBe(false);
  });

  it('a dimension dragged off its geometry drops that anchor, so the geometry no longer pulls it back', () => {
    const { d, get, modify } = setup(line('L', v(0, 0), v(2, 0)), lengthOfL);
    modify(get('D'), { ...get('D'), p2: v(3, 0) });
    expect(get('D').anchors).toEqual({ p1: { id: 'L', feature: 'start' } });
    modify(d.entities.get('L')!, line('L', v(0.5, 0), v(2, 0)));
    expect(get('D')).toMatchObject({ p1: v(0.5, 0), p2: v(3, 0) });
  });

  it('moved together with its geometry, a dimension stays anchored', () => {
    const { d, undo, get } = setup(line('L', v(0, 0), v(2, 0)), lengthOfL);
    const shift = (e: Entity): Entity => (e.kind === 'line' ? line('L', v(0, 1), v(2, 1)) : { ...lengthOfL, p1: v(0, 1), p2: v(2, 1), at: v(1, 0.5) });
    undo.commit({ label: 'Move', changes: [...d.entities.values()].map((e) => ({ op: 'modify' as const, before: e, after: shift(e) })) });
    expect(get('D')).toEqual({ ...lengthOfL, p1: v(0, 1), p2: v(2, 1), at: v(1, 0.5) });
  });

  it('a point whose feature is gone (an arc trimmed past the quadrant) stays where it was, unanchored', () => {
    const q: Dim = { ...base, id: 'Q', type: 'aligned', p1: v(0, 0), p2: v(0, 1), at: v(-0.5, 0.5), anchors: { p1: { id: 'P', feature: 'node' }, p2: { id: 'C', feature: 'quad', deg: 90 } } };
    const { d, get, modify } = setup({ kind: 'point', id: 'P', layer: '0', at: v(0, 0) }, { kind: 'arc', id: 'C', layer: '0', center: v(0, 0), radius: 1, startDeg: 0, endDeg: 180 }, q);
    modify(d.entities.get('C')!, { kind: 'arc', id: 'C', layer: '0', center: v(0, 0), radius: 1, startDeg: 0, endDeg: 45 });
    expect(get('Q')).toMatchObject({ p2: v(0, 1), anchors: { p1: { id: 'P', feature: 'node' } } });
    expect(get('Q').anchors?.p2).toBeUndefined();
  });

  it('an intersection follows either line', () => {
    const x: Dim = { ...base, id: 'X', type: 'aligned', p1: v(0, 0), p2: v(1, 1), at: v(0, 1), anchors: { p1: { id: 'A', feature: 'start' }, p2: { id: 'A', feature: 'int', other: 'B' } } };
    const { d, get, modify } = setup(line('A', v(0, 0), v(3, 3)), line('B', v(0, 2), v(2, 0)), x);
    modify(d.entities.get('B')!, line('B', v(0, 4), v(4, 0)));
    expect(get('X').p2).toEqual(v(2, 2));
  });

  it('a copy of a line and its dimension is anchored to the copied line', () => {
    const { d, undo, get, modify } = setup(line('L', v(0, 0), v(2, 0)), lengthOfL);
    const copies = withNewIds(d, [line('L', v(0, 5), v(2, 5)), { ...lengthOfL, p1: v(0, 5), p2: v(2, 5), at: v(1, 4.5) }]);
    undo.commit({ label: 'Copy', changes: copies.map((entity) => ({ op: 'add' as const, entity })) });
    const [l2, d2] = copies.map((e) => e.id) as [string, string];
    expect(get(d2).anchors).toEqual({ p1: { id: l2, feature: 'start' }, p2: { id: l2, feature: 'end' } });
    modify(d.entities.get(l2)!, line(l2, v(0, 5), v(4, 5)));
    expect(get(d2).p2).toEqual(v(4, 5));
    expect(get('D').p2).toEqual(v(2, 0));
  });

  it('an angle by three snapped points follows its vertex', () => {
    const a: Dim = {
      ...base, id: 'A', type: 'angular', vertex: v(0, 0), p1: v(1, 0), p2: v(0, 1), dir1: H, dir2: v(0, 1), at: v(0.5, 0.5),
      anchors: { vertex: { id: 'P', feature: 'node' } },
    };
    const { d, get, modify } = setup({ kind: 'point', id: 'P', layer: '0', at: v(0, 0) }, a);
    modify(d.entities.get('P')!, { kind: 'point', id: 'P', layer: '0', at: v(-1, 0) });
    const moved = d.entities.get('A') as Extract<Dim, { type: 'angular' }>;
    expect(moved.vertex).toEqual(v(-1, 0));
    expect(moved.dir1).toEqual(H);
    expect(moved.dir2.x).toBeCloseTo(Math.SQRT1_2, 15);
    expect(moved.at).toEqual(v(-0.5, 0.5));
  });
});

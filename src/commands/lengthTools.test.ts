import { describe, expect, it } from 'vitest';
import type { ArcEntity, CircleEntity, Entity, LineEntity } from '../model/entity';
import { createBreakTool, createLengthenTool, joinTool } from './lengthTools';
import { setup } from './toolHarness';

const v = (x: number, y: number) => ({ x, y });
const ln = (id: string, ax: number, ay: number, bx: number, by: number): LineEntity => ({ kind: 'line', id, layer: '0', start: v(ax, ay), end: v(bx, by) });
const arc = (id: string, s: number, e: number): ArcEntity => ({ kind: 'arc', id, layer: '0', center: v(0, 0), radius: 1, startDeg: s, endDeg: e });

function withShapes(...shapes: Entity[]) {
  const t = setup();
  for (const e of shapes) t.add(e);
  return t;
}

describe('Break', () => {
  it('removes the part between two points as one undo step', () => {
    const t = withShapes(ln('L', 0, 0, 4, 0));
    t.runner.start(createBreakTool());
    t.pick('L', 2, 0);
    t.click(1, 0.01);
    expect(t.preview(v(3, 0))).toEqual([ln('preview', 0, 0, 1, 0), ln('preview', 3, 0, 4, 0)]);
    t.click(3, 0);
    expect(t.drawing.entities.get('L')).toEqual(ln('L', 0, 0, 1, 0));
    expect(t.drawing.entities.get('e1')).toEqual(ln('e1', 3, 0, 4, 0));
    t.undo.undo();
    expect([...t.drawing.entities.values()]).toEqual([ln('L', 0, 0, 4, 0)]);
  });

  it('opens a circle into an arc, counter-clockwise from the first point', () => {
    const c: CircleEntity = { kind: 'circle', id: 'C', layer: '0', center: v(0, 0), radius: 1 };
    const t = withShapes(c);
    t.runner.start(createBreakTool());
    t.pick('C', 1, 0);
    t.click(0, 1);
    t.click(-1, 0);
    expect(t.drawing.entities.get('C')).toEqual(arc('C', 180, 90));
  });

  it('splits at one point with At point, and refuses a circle', () => {
    const t = withShapes(ln('L', 0, 0, 4, 0), { kind: 'circle', id: 'C', layer: '0', center: v(0, 5), radius: 1 } as CircleEntity);
    t.runner.start(createBreakTool());
    t.option('at');
    t.pick('L', 2, 0);
    t.click(2.5, 0);
    expect(t.drawing.entities.get('L')).toEqual(ln('L', 0, 0, 2.5, 0));
    expect(t.drawing.entities.get('e1')).toEqual(ln('e1', 2.5, 0, 4, 0));
    t.pick('C', 1, 5); // sticky, still At point
    t.click(1, 5);
    expect(t.messages).toEqual(['A circle needs two break points: use Two points.']);
  });
});

describe('Join', () => {
  it('joins collinear lines across a gap and arcs on one circle, as one undo step', () => {
    const t = withShapes(ln('L1', 0, 0, 1, 0), ln('L2', 2, 0, 3, 0), ln('L3', 5, 0, 4, 0), arc('A1', 0, 90), arc('A2', 120, 180), ln('X', 0, 1, 1, 2));
    t.select('L1', 'L2', 'L3', 'A1', 'A2', 'X');
    t.runner.start(joinTool);
    expect(t.drawing.entities.get('L1')).toEqual(ln('L1', 0, 0, 5, 0));
    expect(t.drawing.entities.has('L2')).toBe(false);
    expect(t.drawing.entities.has('L3')).toBe(false);
    expect(t.drawing.entities.get('A1')).toEqual(arc('A1', 0, 180));
    expect(t.drawing.entities.get('X')).toEqual(ln('X', 0, 1, 1, 2));
    expect(t.messages).toEqual(['Joined 6 objects into 3.']);
    t.undo.undo();
    expect(t.drawing.entities.size).toBe(6);
  });

  it('bridges the smaller gap between two arcs, whichever is given first', () => {
    const t = withShapes(arc('A2', 120, 180), arc('A1', 0, 90));
    t.select('A2', 'A1');
    t.runner.start(joinTool);
    expect([...t.drawing.entities.values()]).toEqual([arc('A2', 0, 180)]);
  });

  it('says so when nothing joins', () => {
    const t = withShapes(ln('L1', 0, 0, 1, 0), ln('X', 0, 1, 1, 2));
    t.select('L1', 'X');
    t.runner.start(joinTool);
    expect(t.messages).toEqual(['Nothing to join: give collinear lines or arcs on one circle.']);
    expect(t.undo.undoLabel).toBeUndefined();
  });
});

describe('Lengthen', () => {
  it('adds a delta at the picked end, object after object, and previews it', () => {
    const t = withShapes(ln('L', 0, 0, 1, 0), arc('A', 0, 90));
    t.runner.start(createLengthenTool());
    expect(t.runner.request).toMatchObject({ kind: 'value', label: 'Δ' });
    t.value(0.5);
    t.hover('L');
    expect(t.preview(v(0.9, 0))).toEqual([ln('preview', 0, 0, 1.5, 0)]);
    t.pick('L', 0.9, 0);
    expect(t.drawing.entities.get('L')).toEqual(ln('L', 0, 0, 1.5, 0));
    t.pick('A', 0, 1);
    expect((t.drawing.entities.get('A') as ArcEntity).endDeg).toBeCloseTo(90 + (0.5 * 180) / Math.PI, 12);
    t.finish();
    expect(t.runner.tool).toBeUndefined();
  });

  it('sets a total length or a percent, asking for the value when the method changes', () => {
    const t = withShapes(ln('L', 0, 0, 2, 0));
    t.runner.start(createLengthenTool());
    t.option('total');
    expect(t.runner.request).toMatchObject({ kind: 'value', label: 'L' });
    t.value(0.75);
    t.pick('L', 0.1, 0); // the start end moves
    expect(t.drawing.entities.get('L')).toEqual(ln('L', 1.25, 0, 2, 0));
    t.option('percent');
    t.value(200);
    t.pick('L', 1.9, 0);
    expect(t.drawing.entities.get('L')).toEqual(ln('L', 1.25, 0, 2.75, 0));
  });

  it('says so when it would leave no length', () => {
    const t = withShapes(ln('L', 0, 0, 1, 0));
    t.runner.start(createLengthenTool());
    t.value(-1);
    t.pick('L', 0.9, 0);
    expect(t.messages).toEqual(['That would leave it with no length (or an arc a full turn or more).']);
  });
});

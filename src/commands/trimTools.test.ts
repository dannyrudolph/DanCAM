import { describe, expect, it } from 'vitest';
import type { CircleEntity, Entity, LineEntity, XlineEntity } from '../model/entity';
import { setup } from './toolHarness';
import { extendTool, trimTool } from './trimTools';

const v = (x: number, y: number) => ({ x, y });
const xl = (id: string, x: number, y: number, dx: number, dy: number): XlineEntity => ({ kind: 'xline', id, layer: '0', base: v(x, y), dir: v(dx, dy) });
const ln = (id: string, ax: number, ay: number, bx: number, by: number): LineEntity => ({ kind: 'line', id, layer: '0', start: v(ax, ay), end: v(bx, by) });

function withShapes(...shapes: Entity[]) {
  const t = setup();
  for (const e of shapes) t.add(e);
  return t;
}

describe('Trim', () => {
  it('goes straight to picking with every object an edge, and trims an xline to an exact line between two others', () => {
    const t = withShapes(xl('V1', 0, 0, 0, 1), xl('V2', 4, 0, 0, 1), xl('H', 0, 1, 1, 0));
    t.runner.start(trimTool);
    expect(t.runner.request).toMatchObject({ kind: 'entity', canFinish: true });
    expect(t.runner.request?.options?.find((o) => o.active)?.label).toBe('All objects');
    t.pick('H', 6, 1);
    expect(t.drawing.entities.get('H')).toEqual({ kind: 'ray', id: 'H', layer: '0', base: v(4, 1), dir: v(-1, -0) });
    t.pick('H', -2, 1);
    expect(t.drawing.entities.get('H')).toEqual(ln('H', 4, 1, 0, 1));
    expect(t.undo.undoLabel).toBe('Trim');
    t.undo.undo();
    expect(t.drawing.entities.get('H')?.kind).toBe('ray'); // each pick is its own step
  });

  it('splits an object picked in the middle, giving the far piece a new id and the same layer and style', () => {
    const t = withShapes(xl('V1', 1, 0, 0, 1), xl('V2', 3, 0, 0, 1), { ...ln('L', 0, 0, 4, 0), layer: 'A', style: 'hidden' });
    t.runner.start(trimTool);
    t.pick('L', 2, 0);
    expect(t.drawing.entities.get('L')).toEqual({ ...ln('L', 0, 0, 1, 0), layer: 'A', style: 'hidden' });
    expect(t.drawing.entities.get('e1')).toEqual({ ...ln('e1', 3, 0, 4, 0), layer: 'A', style: 'hidden' });
    t.undo.undo();
    expect([...t.drawing.entities.keys()]).toEqual(['V1', 'V2', 'L']);
    expect(t.drawing.entities.get('L')).toMatchObject({ start: v(0, 0), end: v(4, 0) });
  });

  it('Select edges asks for the edges first and cuts only at them; it stays chosen until All objects', () => {
    const t = withShapes(xl('V1', 1, 0, 0, 1), xl('V2', 3, 0, 0, 1), ln('L', 0, 0, 4, 0));
    t.runner.start(trimTool);
    t.option('method:select');
    expect(t.runner.request).toMatchObject({ kind: 'selection', prompt: 'Trim: select cutting edges, then Enter (Enter alone: all objects)' });
    t.selectionDone('V2');
    t.hover('L');
    expect(t.preview(v(0.5, 0))).toMatchObject([{ kind: 'line', start: v(0, 0), end: v(3, 0) }]); // past V1, which is not an edge
    t.pick('L', 0.5, 0);
    expect(t.drawing.entities.get('L')).toEqual(ln('L', 3, 0, 4, 0));
    t.finish();
    t.runner.start(trimTool);
    expect(t.runner.request?.kind).toBe('selection');
    t.option('method:all'); // back to the default for the tests that follow
    expect(t.runner.request?.kind).toBe('entity');
  });

  it('highlights the piece under the cursor up to the nearest crossings both ways', () => {
    const t = withShapes(xl('V1', 1, 0, 0, 1), xl('V2', 3, 0, 0, 1), xl('V3', 3.5, 0, 0, 1), ln('L', 0, 0, 4, 0));
    t.runner.start(trimTool);
    t.hover('L');
    expect(t.preview(v(2, 0))).toEqual([ln('preview', 1, 0, 3, 0)]);
    expect(t.preview(v(3.75, 0))).toEqual([ln('preview', 3.5, 0, 4, 0)]);
  });

  it('takes the selection as the edges without asking', () => {
    const t = withShapes(xl('V1', 1, 0, 0, 1), xl('V2', 3, 0, 0, 1), ln('L', 0, 0, 4, 0));
    t.select('V1');
    t.runner.start(trimTool);
    expect(t.runner.request?.kind).toBe('entity');
    t.pick('L', 3.5, 0);
    expect(t.drawing.entities.get('L')).toEqual(ln('L', 0, 0, 1, 0));
  });

  it('turns a circle into an arc', () => {
    const c: CircleEntity = { kind: 'circle', id: 'C', layer: '0', center: v(0, 0), radius: 1 };
    const t = withShapes(c, xl('Y', 0, 0, 0, 1));
    t.runner.start(trimTool);
    t.pick('C', 1, 0);
    expect(t.drawing.entities.get('C')).toEqual({ kind: 'arc', id: 'C', layer: '0', center: v(0, 0), radius: 1, startDeg: 90, endDeg: 270 });
  });

  it('keeps the far side when the piece past the only edge is picked', () => {
    const t = withShapes(xl('V', 1, 0, 0, 1), ln('L', 0, 0, 4, 0));
    t.runner.start(trimTool);
    t.pick('L', 0.5, 0);
    expect(t.drawing.entities.get('L')).toEqual(ln('L', 1, 0, 4, 0));
  });

  it('says so and changes nothing when no edge crosses the picked part', () => {
    const t = withShapes(ln('L', 0, 0, 4, 0), ln('M', 0, 1, 4, 1));
    t.runner.start(trimTool);
    t.pick('L', 2, 0);
    expect(t.messages).toEqual(['Nothing to trim there: no edge crosses that part.']);
    expect(t.undo.undoLabel).toBeUndefined();
  });

  it('extends instead on a Shift-pick', () => {
    const t = withShapes(xl('V', 5, 0, 0, 1), ln('L', 0, 0, 2, 0));
    t.runner.start(trimTool);
    t.pick('L', 1.9, 0, true);
    expect(t.drawing.entities.get('L')).toEqual(ln('L', 0, 0, 5, 0));
    expect(t.undo.undoLabel).toBe('Extend');
  });

  it('previews the piece to be removed without using up entity ids', () => {
    const t = withShapes(xl('V1', 1, 0, 0, 1), xl('V2', 3, 0, 0, 1), ln('L', 0, 0, 4, 0));
    t.runner.start(trimTool);
    const before = t.drawing.nextId;
    t.hover('L');
    expect(t.preview(v(2, 0))).toEqual([ln('preview', 1, 0, 3, 0)]);
    t.hover('L', true); // Shift previews Extend: both ends already lie past every edge, so nothing
    expect(t.preview(v(3.9, 0))).toEqual([]);
    expect(t.drawing.nextId).toBe(before);
  });

  it('ends on Enter at the pick step', () => {
    const t = withShapes(ln('L', 0, 0, 4, 0));
    t.runner.start(trimTool);
    t.finish();
    expect(t.runner.tool).toBeUndefined();
  });
});

describe('Trim by a dragged path', () => {
  const stroke = (t: ReturnType<typeof setup>, ...pts: [number, number][]) => t.runner.send({ kind: 'stroke', points: pts.map(([x, y]) => v(x, y)) });
  const req = (t: ReturnType<typeof setup>) => t.runner.request;

  it('removes every piece the path crosses, up to the edges either way, as one undo step, and previews it while dragging', () => {
    const t = withShapes(xl('V1', 1, 0, 0, 1), xl('V2', 3, 0, 0, 1), ln('L1', 0, 0, 4, 0), ln('L2', 0, 1, 4, 1), ln('L3', 0, 2, 4, 2));
    t.runner.start(trimTool);
    const r = req(t);
    expect(r?.kind === 'entity' && r.stroke?.([v(2, -0.5), v(2, 1.5)])).toEqual([ln('preview', 1, 0, 3, 0), ln('preview', 1, 1, 3, 1)]);
    stroke(t, [2, -0.5], [2.2, 1], [2, 2.5]);
    expect(t.lines()).toEqual([
      [0, 0, 1, 0],
      [0, 1, 1, 1],
      [0, 2, 1, 2],
      [3, 0, 4, 0],
      [3, 1, 4, 1],
      [3, 2, 4, 2],
    ]);
    expect(t.undo.undoLabel).toBe('Trim');
    t.undo.undo();
    expect(t.lines()).toEqual([
      [0, 0, 4, 0],
      [0, 1, 4, 1],
      [0, 2, 4, 2],
    ]);
    expect(req(t)?.kind).toBe('entity'); // still picking
  });

  it('an object crossed in two pieces loses both; a piece crossed twice is removed once', () => {
    const t = withShapes(xl('V1', 1, 0, 0, 1), xl('V2', 2, 0, 0, 1), xl('V3', 3, 0, 0, 1), ln('L', 0, 0, 4, 0), ln('M', 0, 5, 4, 5));
    t.runner.start(trimTool);
    stroke(t, [0.5, 1], [0.5, -1], [3.5, -1], [3.5, 1]);
    expect(t.drawing.entities.get('L')).toEqual(ln('L', 1, 0, 3, 0));
    stroke(t, [1.4, 6], [1.5, 4], [1.6, 6]);
    expect(t.lines().filter(([, y]) => y === 5)).toEqual([
      [0, 5, 1, 5],
      [2, 5, 4, 5],
    ]);
  });

  it('measures every crossing against the drawing before the path, so two objects that cut each other both lose the crossed piece', () => {
    const t = withShapes(ln('H', 0, 0, 4, 0), ln('V', 2, -2, 2, 2), xl('X', 1, 0, 0, 1), xl('Y', 0, 1, 1, 0));
    t.runner.start(trimTool);
    stroke(t, [1.5, -0.5], [1.5, 0.5], [2.5, 0.5]); // crosses H between X and V, then V between H and Y
    expect(t.drawing.entities.get('H')).toEqual(ln('H', 0, 0, 1, 0));
    expect(t.lines()).toContainEqual([2, 0, 4, 0]);
    expect(t.drawing.entities.get('V')).toEqual(ln('V', 2, -2, 2, 0));
    expect(t.lines()).toContainEqual([2, 1, 2, 2]);
  });

  it('cuts only at the chosen edges in Select edges', () => {
    const t = withShapes(xl('V1', 1, 0, 0, 1), xl('V2', 3, 0, 0, 1), ln('L', 0, 0, 4, 0));
    t.select('V2');
    t.runner.start(trimTool);
    stroke(t, [0.5, 1], [0.5, -1]);
    expect(t.drawing.entities.get('L')).toEqual(ln('L', 3, 0, 4, 0));
  });

  it('says so when the path trims nothing, and Extend takes no path', () => {
    const t = withShapes(ln('L', 0, 0, 4, 0));
    t.runner.start(trimTool);
    stroke(t, [1, 1], [1, -1]); // crosses L, but nothing cuts it
    stroke(t, [9, 9], [10, 10]); // crosses nothing
    expect(t.messages).toEqual([
      'Nothing to trim along that path: it crosses no piece that an edge cuts.',
      'Nothing to trim along that path: it crosses no piece that an edge cuts.',
    ]);
    expect(t.undo.undoLabel).toBeUndefined();
    t.finish();
    t.runner.start(extendTool);
    const r = req(t);
    expect(r?.kind === 'entity' && r.stroke).toBeUndefined();
  });
});

describe('Extend', () => {
  it('a trimmed circle is an arc, and either of its ends extends along the circle', () => {
    const c: CircleEntity = { kind: 'circle', id: 'C', layer: '0', center: v(0, 0), radius: 1 };
    // Boundaries on the right half, crossing the circle at 45° and 315°.
    const t = withShapes(c, xl('Y', 0, 0, 0, 1), ln('B1', 0, 0, 2, 2), ln('B2', 0, 0, 2, -2));
    t.select('Y'); // trim at the vertical only
    t.runner.start(trimTool);
    t.pick('C', 1, 0);
    expect(t.drawing.entities.get('C')).toEqual({ kind: 'arc', id: 'C', layer: '0', center: v(0, 0), radius: 1, startDeg: 90, endDeg: 270 });
    t.runner.stop();
    t.select();
    t.runner.start(extendTool);
    t.pick('C', -0.2, -0.98); // near the end at 270°: on counterclockwise to B2
    const afterEnd = t.drawing.entities.get('C');
    expect(afterEnd).toMatchObject({ kind: 'arc', startDeg: 90 });
    expect(afterEnd?.kind === 'arc' && afterEnd.endDeg).toBeCloseTo(315, 12);
    t.pick('C', -0.2, 0.98); // near the start at 90°: on clockwise to B1
    const afterStart = t.drawing.entities.get('C');
    expect(afterStart?.kind === 'arc' && afterStart.startDeg).toBeCloseTo(45, 12);
    expect(afterStart?.kind === 'arc' && afterStart.endDeg).toBeCloseTo(315, 12);
  });

  it('extends the picked end to the boundary, again to the next one, and trims on Shift-pick', () => {
    const t = withShapes(xl('V1', 3, 0, 0, 1), xl('V2', 6, 0, 0, 1), ln('L', 0, 0, 2, 0));
    t.runner.start(extendTool);
    t.pick('L', 1.9, 0);
    expect(t.drawing.entities.get('L')).toEqual(ln('L', 0, 0, 3, 0));
    t.pick('L', 2.9, 0);
    expect(t.drawing.entities.get('L')).toEqual(ln('L', 0, 0, 6, 0));
    t.pick('L', 5, 0, true);
    expect(t.drawing.entities.get('L')).toEqual(ln('L', 0, 0, 3, 0));
    expect(t.undo.undoLabel).toBe('Trim');
  });

  it('previews the extended object', () => {
    const t = withShapes(xl('V', 3, 0, 0, 1), ln('L', 0, 0, 2, 0));
    t.runner.start(extendTool);
    t.hover('L');
    expect(t.preview(v(1.9, 0))).toEqual([ln('preview', 0, 0, 3, 0)]);
  });

  it('says so when nothing lies ahead', () => {
    const t = withShapes(xl('V', 3, 0, 0, 1), ln('L', 0, 0, 2, 0));
    t.runner.start(extendTool);
    t.pick('L', 0.1, 0);
    expect(t.messages).toEqual(['No boundary ahead of that end.']);
  });
});

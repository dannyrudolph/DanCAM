import { describe, expect, it } from 'vitest';
import { measuredValue } from '../model/dimLayout';
import type { DimensionEntity } from '../model/entity';
import { createAlignedDimTool, createAngularDimTool, createDiameterDimTool, createLeaderTool, createLinearDimTool, createRadiusDimTool, linearDirFor } from './dimTools';
import { setup } from './toolHarness';

const v = (x: number, y: number) => ({ x, y });
const H = v(1, 0);
const V = v(0, 1);
const FIRST = 'Linear: pick a line, arc or circle (or a point)';
const dims = (t: ReturnType<typeof setup>) => t.entities().filter((e): e is DimensionEntity => e.kind === 'dimension');

describe('linearDirFor', () => {
  const a = v(0, 0);
  const b = v(2, 1);
  it('above or below the points: horizontal', () => {
    expect(linearDirFor(a, b, v(1, 3))).toEqual(H);
    expect(linearDirFor(a, b, v(1, -2))).toEqual(H);
  });
  it('beside them: vertical', () => {
    expect(linearDirFor(a, b, v(3, 0.5))).toEqual(V);
    expect(linearDirFor(a, b, v(-1, 0.5))).toEqual(V);
  });
  it('off a corner: whichever side it is further past', () => {
    expect(linearDirFor(a, b, v(2.5, 3))).toEqual(H);
    expect(linearDirFor(a, b, v(4, 1.5))).toEqual(V);
  });
});

describe('Linear dimension tool', () => {
  it('two points, then the line position: horizontal when dragged above, one undo step, and the tool starts again', () => {
    const t = setup();
    t.runner.start(createLinearDimTool());
    t.click(0, 0.125);
    t.click(2, 0.1875);
    t.click(1, 0.65);
    expect(dims(t)).toEqual([
      { kind: 'dimension', id: 'e1', layer: '0', dimStyle: 'INCH-3PL', type: 'linear', dir: H, p1: v(0, 0.125), p2: v(2, 0.1875), at: v(1, 0.65) },
    ]);
    expect(measuredValue(dims(t)[0]!)).toBe(2);
    expect(t.runner.request?.prompt).toBe(FIRST);
    t.undo.undo();
    expect(dims(t)).toEqual([]);
  });

  it('dragged beside the points it is vertical, and the preview follows the cursor', () => {
    const t = setup();
    t.runner.start(createLinearDimTool());
    t.click(0, 0.125);
    t.click(2, 0.1875);
    expect(t.preview(v(1, 1))).toMatchObject([{ kind: 'dimension', id: 'preview', type: 'linear', dir: H, at: v(1, 1) }]);
    expect(t.preview(v(2.5, 0.1))).toMatchObject([{ type: 'linear', dir: V }]);
    t.click(2.5, 0.1);
    expect(measuredValue(dims(t)[0]!)).toBe(0.0625);
  });

  it('Vertical in the options bar forces it, wherever the line goes, and stays chosen for the next one', () => {
    const t = setup();
    const tool = createLinearDimTool();
    t.runner.start(tool);
    t.click(0, 0);
    t.click(1, 0.5);
    t.option('orient:v');
    expect(t.runner.request?.options?.find((o) => o.active)?.label).toBe('Vertical');
    t.click(0.5, 2); // above: Auto would make this horizontal
    t.click(0, 0);
    t.click(1, 0.5);
    t.click(0.5, 2);
    expect(dims(t).map((d) => d.type === 'linear' && d.dir)).toEqual([V, V]);
  });

  it('points placed on snaps keep the features they are on, so the dimension follows a later change', () => {
    const t = setup();
    t.add({ kind: 'line', id: 'L', layer: '0', start: v(0, 0), end: v(1, 0) });
    t.runner.start(createLinearDimTool());
    t.runner.send({ kind: 'point', at: v(0, 0), anchor: { id: 'L', feature: 'start' } });
    t.click(1, 0); // typed, not snapped: a fixed point
    t.click(0.5, -0.5);
    expect(dims(t)[0]!.anchors).toEqual({ p1: { id: 'L', feature: 'start' } });
    const l = t.entities().find((e) => e.id === 'L')!;
    t.undo.commit({ label: 'Move', changes: [{ op: 'modify', before: l, after: { ...l, start: v(-0.25, 0) } as typeof l }] });
    expect(measuredValue(dims(t)[0]!)).toBe(1.25);
  });

  it('Objects is the default: a picked line measures its ends and remembers which line it was', () => {
    const t = setup();
    t.add({ kind: 'line', id: 'L', layer: '0', start: v(0.5, 0.25), end: v(1, 0.25) });
    t.runner.start(createLinearDimTool());
    expect(t.runner.request).toMatchObject({ kind: 'point', prompt: FIRST });
    expect(t.runner.request?.kind === 'point' && t.runner.request.pick?.(t.entities()[0]!)).toBe(true);
    t.pick('L', 0.7, 0.25);
    expect(t.runner.request?.prompt).toBe('Linear: pick where the dimension line goes, or a second object');
    expect(t.preview(v(0.75, 0.6))).toMatchObject([{ type: 'linear', p1: v(0.5, 0.25), p2: v(1, 0.25), dir: H }]);
    t.click(0.75, 0.6);
    expect(dims(t)[0]).toMatchObject({ p1: v(0.5, 0.25), p2: v(1, 0.25), anchors: { p1: { id: 'L', feature: 'start' }, p2: { id: 'L', feature: 'end' } }, dir: H });
    expect(measuredValue(dims(t)[0]!)).toBe(0.5);
  });

  it('a picked arc (a fillet) measures between its ends, anchored to them', () => {
    const t = setup();
    t.add({ kind: 'arc', id: 'A', layer: '0', center: v(0, 0), radius: 0.25, startDeg: 0, endDeg: 90 });
    t.runner.start(createLinearDimTool());
    t.pick('A', 0.177, 0.177);
    t.click(0.125, 0.5); // above: horizontal
    expect(dims(t)[0]).toMatchObject({ type: 'linear', dir: H, anchors: { p1: { id: 'A', feature: 'start' }, p2: { id: 'A', feature: 'end' } } });
    expect(measuredValue(dims(t)[0]!)).toBeCloseTo(0.25, 12);
  });

  it('a second object before placing measures between them: two faces of a turned step', () => {
    const t = setup();
    t.add({ kind: 'line', id: 'F1', layer: '0', start: v(0, 0), end: v(0, 0.25) });
    t.add({ kind: 'line', id: 'F2', layer: '0', start: v(0.375, 0), end: v(0.375, 0.125) });
    t.runner.start(createLinearDimTool());
    t.pick('F1', 0, 0.2);
    // The first object is not offered again.
    expect(t.runner.request?.kind === 'point' && t.runner.request.pick?.(t.entities()[0]!)).toBe(false);
    t.pick('F2', 0.375, 0.1);
    expect(t.runner.request?.prompt).toBe('Linear: pick where the dimension line goes');
    t.click(0.2, 0.5);
    expect(dims(t)).toHaveLength(1);
    expect(dims(t)[0]).toMatchObject({ dir: H, p1: v(0, 0.25), p2: v(0.375, 0.125), anchors: { p1: { id: 'F1', feature: 'end' }, p2: { id: 'F2', feature: 'end' } } });
    expect(measuredValue(dims(t)[0]!)).toBe(0.375);
    // It follows the faces: move the second one along Z.
    const f2 = t.entities().find((e) => e.id === 'F2')!;
    t.undo.commit({ label: 'Move', changes: [{ op: 'modify', before: f2, after: { ...f2, start: v(0.5, 0), end: v(0.5, 0.125) } as typeof f2 }] });
    expect(measuredValue(dims(t)[0]!)).toBe(0.5);
  });

  it('a line and a circle measure to its center; two circles center to center', () => {
    const t = setup();
    t.add({ kind: 'line', id: 'L', layer: '0', start: v(0, 0), end: v(0, 1) });
    t.add({ kind: 'circle', id: 'C', layer: '0', center: v(0.5, 0.5), radius: 0.1 });
    t.add({ kind: 'circle', id: 'D', layer: '0', center: v(1.25, 0.5), radius: 0.1 });
    t.runner.start(createLinearDimTool());
    t.pick('L', 0, 0.9);
    t.pick('C', 0.6, 0.5);
    t.click(0.25, 1.5);
    expect(dims(t)[0]).toMatchObject({ p1: v(0, 1), p2: v(0.5, 0.5), anchors: { p1: { id: 'L', feature: 'end' }, p2: { id: 'C', feature: 'center' } } });
    expect(measuredValue(dims(t)[0]!)).toBe(0.5);
    t.pick('C', 0.6, 0.5);
    expect(t.runner.request?.prompt).toBe('Linear: pick a second object to measure to');
    t.click(1, 2); // a circle alone has nothing to place
    expect(t.messages).toEqual(['A circle needs a second object to measure to; for its size use Diameter.']);
    t.pick('D', 1.35, 0.5);
    t.click(1, 1);
    expect(dims(t)[1]).toMatchObject({ anchors: { p1: { id: 'C', feature: 'center' }, p2: { id: 'D', feature: 'center' } } });
    expect(measuredValue(dims(t)[1]!)).toBe(0.75);
  });

  it('a click off the geometry is a first point, as with Two points', () => {
    const t = setup();
    t.runner.start(createLinearDimTool());
    t.click(0, 0);
    expect(t.runner.request?.prompt).toBe('Linear: pick the second point');
    t.click(1, 0);
    t.click(0.5, 0.5);
    expect(measuredValue(dims(t)[0]!)).toBe(1);
  });

  it('Two points takes points only, and stays chosen', () => {
    const t = setup();
    const tool = createLinearDimTool();
    t.runner.start(tool);
    t.option('method:points');
    expect(t.runner.request).toMatchObject({ kind: 'point', prompt: 'Linear: pick the first point to measure from' });
    expect(t.runner.request?.kind === 'point' && t.runner.request.pick).toBeUndefined();
    t.click(0, 0);
    t.click(1, 0);
    t.click(0.5, 0.5);
    expect(t.runner.request?.prompt).toBe('Linear: pick the first point to measure from');
  });

  it('refuses two points that are the same', () => {
    const t = setup();
    t.runner.start(createLinearDimTool());
    t.click(1, 1);
    t.click(1, 1);
    expect(t.messages).toEqual(['The two points are the same; there is nothing to measure.']);
    expect(t.runner.request?.prompt).toBe(FIRST);
  });

  it('Enter at the placement step drops that dimension and starts over', () => {
    const t = setup();
    t.runner.start(createLinearDimTool());
    t.click(0, 0);
    t.click(1, 0);
    t.finish();
    expect(dims(t)).toEqual([]);
    expect(t.runner.request?.prompt).toBe(FIRST);
  });
});

describe('Aligned dimension tool', () => {
  it('reads the true length between the points, with no orientation options', () => {
    const t = setup();
    t.runner.start(createAlignedDimTool());
    t.click(0, 0);
    t.click(3, 4);
    expect(t.runner.request?.options).toEqual([]);
    t.click(-0.8, 0.6);
    expect(dims(t)[0]).toMatchObject({ type: 'aligned', p1: v(0, 0), p2: v(3, 4), at: v(-0.8, 0.6) });
    expect(measuredValue(dims(t)[0]!)).toBe(5);
  });

  it('between parallel lines, or a line and a center, it measures square to the line', () => {
    const t = setup();
    // A 45° chamfer face and a parallel line .1 away (square to it).
    const s = Math.SQRT1_2;
    t.add({ kind: 'line', id: 'A', layer: '0', start: v(0, 0), end: v(1, 1) });
    t.add({ kind: 'line', id: 'B', layer: '0', start: v(0.1 / s, 0), end: v(1 + 0.1 / s, 1) });
    t.add({ kind: 'circle', id: 'C', layer: '0', center: v(1, 0), radius: 0.05 });
    t.runner.start(createAlignedDimTool());
    t.pick('A', 0.1, 0.1);
    t.pick('B', 0.2, 0.06);
    t.click(0.5, -0.5);
    const d = dims(t)[0]!;
    expect(d.type).toBe('linear');
    if (d.type === 'linear') {
      expect(d.dir.x).toBeCloseTo(-s, 15);
      expect(d.dir.y).toBeCloseTo(s, 15);
    }
    expect(measuredValue(dims(t)[0]!)).toBeCloseTo(0.1, 12);
    t.pick('A', 0.1, 0.1);
    t.pick('C', 1.05, 0);
    t.click(1, -1);
    expect(measuredValue(dims(t)[1]!)).toBeCloseTo(s, 12);
  });

  it('between two lines that are not parallel, it is the true length between their nearest ends', () => {
    const t = setup();
    t.add({ kind: 'line', id: 'A', layer: '0', start: v(0, 0), end: v(0, 1) });
    t.add({ kind: 'line', id: 'B', layer: '0', start: v(3, 4), end: v(4, 4) });
    t.runner.start(createAlignedDimTool());
    t.pick('A', 0, 0.1);
    t.pick('B', 3.1, 4);
    t.click(2, 1);
    expect(dims(t)[0]).toMatchObject({ type: 'aligned', p1: v(0, 0), p2: v(3, 4) });
    expect(measuredValue(dims(t)[0]!)).toBe(5);
  });
});

describe('Radius and Diameter tools', () => {
  it('Radius: pick an arc, then where the text goes; it keeps the arc\'s exact center and radius', () => {
    const t = setup();
    t.add({ kind: 'arc', id: 'A', layer: '0', center: v(0.1, 0.2), radius: 0.015, startDeg: 0, endDeg: 90 });
    t.runner.start(createRadiusDimTool());
    expect(t.runner.request?.prompt).toBe('Radius: pick an arc or circle');
    t.pick('A', 0.115, 0.2);
    expect(t.preview(v(0.3, 0.4))).toMatchObject([{ type: 'radius', center: v(0.1, 0.2), radius: 0.015 }]);
    t.click(0.3, 0.4);
    expect(dims(t)).toEqual([{ kind: 'dimension', id: 'e1', layer: '0', dimStyle: 'INCH-3PL', type: 'radius', center: v(0.1, 0.2), radius: 0.015, at: v(0.3, 0.4), anchors: { curve: 'A' } }]);
    expect(t.runner.request?.prompt).toBe('Radius: pick an arc or circle');
  });

  it('Diameter on a circle reads twice the radius', () => {
    const t = setup();
    t.add({ kind: 'circle', id: 'C', layer: '0', center: v(0, 0), radius: 0.0625 });
    t.runner.start(createDiameterDimTool());
    t.pick('C', 0.0625, 0);
    t.click(0.3, 0.3);
    expect(dims(t)[0]).toMatchObject({ type: 'diameter', radius: 0.0625 });
    expect(measuredValue(dims(t)[0]!)).toBe(0.125);
  });
});

describe('Angular tool', () => {
  const lines = (t: ReturnType<typeof setup>) => {
    t.add({ kind: 'line', id: 'H', layer: '0', start: v(0, 0), end: v(2, 0) });
    t.add({ kind: 'line', id: 'D', layer: '0', start: v(0, 0), end: v(1, 1) });
  };

  it('two lines: the angle in the quadrant the cursor is in', () => {
    const t = setup();
    lines(t);
    t.runner.start(createAngularDimTool());
    t.pick('H', 1, 0);
    t.pick('D', 0.5, 0.5);
    t.click(1.5, 0.3);
    expect(measuredValue(dims(t)[0]!)).toBeCloseTo(45, 12);
    expect(dims(t)[0]).toMatchObject({ vertex: v(0, 0), p1: v(2, 0), p2: v(1, 1), dir1: H, anchors: { lines: ['H', 'D'] } });
    t.pick('H', 1, 0);
    t.pick('D', 0.5, 0.5);
    t.click(-1, 0.3); // left of the vertex: between -X and the 45° line
    expect(measuredValue(dims(t)[1]!)).toBeCloseTo(135, 12);
    // The horizontal line doesn't reach left of the vertex: its extension line starts there.
    expect(dims(t)[1]).toMatchObject({ p1: v(0, 0), dir1: v(-1, 0) });
  });

  it('refuses parallel lines', () => {
    const t = setup();
    t.add({ kind: 'line', id: 'A', layer: '0', start: v(0, 0), end: v(1, 0) });
    t.add({ kind: 'line', id: 'B', layer: '0', start: v(0, 1), end: v(1, 1) });
    t.runner.start(createAngularDimTool());
    t.pick('A', 0.5, 0);
    t.pick('B', 0.5, 1);
    expect(t.messages).toEqual(['Those lines are parallel; there is no angle between them.']);
    expect(dims(t)).toEqual([]);
  });

  it('an arc: its included angle, or the rest of the turn when placed on the other side', () => {
    const t = setup();
    t.add({ kind: 'arc', id: 'A', layer: '0', center: v(0, 0), radius: 1, startDeg: 30, endDeg: 150 });
    const tool = createAngularDimTool();
    t.runner.start(tool);
    t.option('method:arc');
    t.pick('A', 0, 1);
    t.click(0, 1.3);
    t.pick('A', 0, 1);
    t.click(0, -1.3);
    const [inside, other] = dims(t).map(measuredValue);
    expect(inside).toBeCloseTo(120, 12); // the arc's angles go through cos/sin and back: a few ULPs, far below display
    expect(other).toBeCloseTo(240, 12);
    expect(dims(t)[0]).toMatchObject({ vertex: v(0, 0), anchors: { curve: 'A' } });
  });

  it('Two lines takes an arc as the first pick and dimensions its angle, without changing method', () => {
    const t = setup();
    t.add({ kind: 'arc', id: 'A', layer: '0', center: v(0, 0), radius: 1, startDeg: 30, endDeg: 150 });
    t.runner.start(createAngularDimTool());
    expect(t.runner.request?.prompt).toBe('Angular: pick the first line, or an arc');
    t.pick('A', 0, 1);
    t.click(0, 1.3);
    expect(measuredValue(dims(t)[0]!)).toBeCloseTo(120, 12);
    expect(dims(t)[0]).toMatchObject({ anchors: { curve: 'A' } });
    expect(t.runner.request?.options?.find((o) => o.active)?.label).toBe('Two lines');
  });

  it('a vertex and two points; the far side reads the reflex angle; a side point on the vertex is refused', () => {
    const t = setup();
    t.runner.start(createAngularDimTool());
    t.option('method:vertex');
    t.click(0, 0);
    t.click(1, 0);
    t.click(0, 1);
    t.click(-1, -1);
    expect(dims(t)[0]).toMatchObject({ vertex: v(0, 0), p1: v(1, 0), p2: v(0, 1), dir1: H, dir2: V });
    expect(measuredValue(dims(t)[0]!)).toBe(270);
    t.click(0, 0);
    t.click(0, 0);
    t.click(1, 1);
    expect(t.messages).toEqual(['A side point is on the vertex; there is no angle to measure.']);
  });
});

describe('Leader tool', () => {
  it('arrow point, landing, then the typed note: previewed as it is typed, symbol codes expanded, one undo step, then it starts again', () => {
    const t = setup();
    t.runner.start(createLeaderTool());
    expect(t.runner.request?.prompt).toBe('Leader: pick where the arrow points');
    t.click(2, 0.1875);
    expect(t.runner.request).toMatchObject({ kind: 'point', base: v(2, 0.1875) });
    expect(t.preview(v(2.35, 0.45))).toMatchObject([{ id: 'preview', type: 'leader', tip: v(2, 0.1875), at: v(2.35, 0.45), text: 'Text' }]);
    t.click(2.35, 0.45);
    expect(t.runner.request).toMatchObject({ kind: 'text', at: v(2.35, 0.45) });
    expect(t.preview(v(9, 9), undefined, '.005 X 45%%d')).toMatchObject([{ type: 'leader', text: '.005 X 45°' }]);
    t.text('  .005 X 45%%d 2X ');
    expect(dims(t)).toEqual([
      { kind: 'dimension', id: 'e1', layer: '0', dimStyle: 'INCH-3PL', type: 'leader', tip: v(2, 0.1875), at: v(2.35, 0.45), text: '.005 X 45° 2X' },
    ]);
    expect(measuredValue(dims(t)[0]!)).toBeUndefined();
    expect(t.runner.request?.prompt).toBe('Leader: pick where the arrow points');
    t.undo.undo();
    expect(dims(t)).toEqual([]);
  });

  it('refuses a landing on the arrow point and an empty note, and keeps asking', () => {
    const t = setup();
    t.runner.start(createLeaderTool());
    t.click(1, 1);
    t.click(1, 1);
    expect(t.messages).toEqual(['The text needs to go away from the arrow point.']);
    expect(t.runner.request).toMatchObject({ kind: 'point', base: v(1, 1) });
    t.click(1.5, 1.5);
    t.text('   ');
    expect(t.messages.at(-1)).toBe('Type the note first; Esc leaves without one.');
    expect(t.runner.request?.kind).toBe('text');
    expect(dims(t)).toEqual([]);
  });

  it('Esc at the text step adds nothing', () => {
    const t = setup();
    t.runner.start(createLeaderTool());
    t.click(0, 0);
    t.click(1, 1);
    t.runner.stop();
    expect(dims(t)).toEqual([]);
    expect(t.undo.undoLabel).toBeUndefined();
  });
});

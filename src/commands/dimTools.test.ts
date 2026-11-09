import { describe, expect, it } from 'vitest';
import { measuredValue } from '../model/dimLayout';
import type { DimensionEntity } from '../model/entity';
import { createAlignedDimTool, createAngularDimTool, createDiameterDimTool, createLeaderTool, createLinearDimTool, createRadiusDimTool, linearDirFor } from './dimTools';
import { setup } from './toolHarness';

const v = (x: number, y: number) => ({ x, y });
const H = v(1, 0);
const V = v(0, 1);
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
    expect(t.runner.request?.prompt).toBe('Linear: pick the first point to measure from');
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

  it('Pick a line measures its ends and remembers which line it was', () => {
    const t = setup();
    t.add({ kind: 'line', id: 'L', layer: '0', start: v(0.5, 0.25), end: v(1, 0.25) });
    t.runner.start(createLinearDimTool());
    t.option('method:object');
    expect(t.runner.request?.prompt).toBe('Linear: pick a line to dimension');
    t.pick('L', 0.7, 0.25);
    t.click(0.75, 0.6);
    expect(dims(t)[0]).toMatchObject({ p1: v(0.5, 0.25), p2: v(1, 0.25), refs: ['L'], dir: H });
  });

  it('refuses two points that are the same', () => {
    const t = setup();
    t.runner.start(createLinearDimTool());
    t.click(1, 1);
    t.click(1, 1);
    expect(t.messages).toEqual(['The two points are the same; there is nothing to measure.']);
    expect(t.runner.request?.prompt).toBe('Linear: pick the first point to measure from');
  });

  it('Enter at the placement step drops that dimension and starts over', () => {
    const t = setup();
    t.runner.start(createLinearDimTool());
    t.click(0, 0);
    t.click(1, 0);
    t.finish();
    expect(dims(t)).toEqual([]);
    expect(t.runner.request?.prompt).toBe('Linear: pick the first point to measure from');
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
    expect(dims(t)).toEqual([{ kind: 'dimension', id: 'e1', layer: '0', dimStyle: 'INCH-3PL', type: 'radius', center: v(0.1, 0.2), radius: 0.015, at: v(0.3, 0.4), refs: ['A'] }]);
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
    expect(dims(t)[0]).toMatchObject({ vertex: v(0, 0), p1: v(2, 0), p2: v(1, 1), dir1: H, refs: ['H', 'D'] });
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
    expect(dims(t)[0]).toMatchObject({ vertex: v(0, 0), refs: ['A'] });
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

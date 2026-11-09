import { describe, expect, it } from 'vitest';
import { measuredValue } from '../model/dimLayout';
import type { DimensionEntity } from '../model/entity';
import { createAlignedDimTool, createLinearDimTool, linearDirFor } from './dimTools';
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

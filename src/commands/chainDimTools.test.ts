import { describe, expect, it } from 'vitest';
import { measuredValue } from '../model/dimLayout';
import type { DimensionEntity } from '../model/entity';
import { createBaselineDimTool, createContinueDimTool } from './chainDimTools';
import { setup } from './toolHarness';

const v = (x: number, y: number) => ({ x, y });
const H = v(1, 0);
type Lin = Extract<DimensionEntity, { type: 'linear' }>;
/** A horizontal dimension of (0, 0)–(1, 0), its line .5 below; p2 anchored to line L's end. */
const base: Lin = {
  kind: 'dimension', id: 'B', layer: '0', dimStyle: 'INCH-3PL', type: 'linear', dir: H, p1: v(0, 0), p2: v(1, 0), at: v(0.5, -0.5),
  anchors: { p2: { id: 'L', feature: 'end' } },
};
const made = (t: ReturnType<typeof setup>) => t.entities().filter((e): e is Lin => e.kind === 'dimension' && e.id !== 'B');

function start(tool: 'baseline' | 'continue', sheetScale = 1) {
  const t = setup();
  t.drawing.sheetScale = sheetScale;
  t.add({ kind: 'line', id: 'L', layer: '0', start: v(0, 0), end: v(1, 0) });
  t.add(base);
  t.runner.start(tool === 'baseline' ? createBaselineDimTool() : createContinueDimTool());
  return t;
}

describe('Baseline dimension tool', () => {
  it('measures every point from the start nearer the pick, each line one spacing (.25) further out', () => {
    const t = start('baseline');
    expect(t.runner.request?.prompt).toBe('Baseline: pick a linear dimension near the extension line to start from');
    t.pick('B', 0.05, -0.5); // near p1
    expect(t.runner.request?.prompt).toBe('Baseline: pick the next point (Enter to finish)');
    t.click(2, 0);
    t.click(3, 0.2);
    t.finish();
    expect(made(t)).toEqual([
      { kind: 'dimension', id: 'e1', layer: '0', dimStyle: 'INCH-3PL', type: 'linear', dir: H, p1: v(0, 0), p2: v(2, 0), at: v(1, -0.75) },
      { kind: 'dimension', id: 'e2', layer: '0', dimStyle: 'INCH-3PL', type: 'linear', dir: H, p1: v(0, 0), p2: v(3, 0.2), at: v(1.5, -1) },
    ]);
    expect(made(t).map((e) => measuredValue(e))).toEqual([2, 3]);
    t.undo.undo();
    expect(made(t)).toHaveLength(1);
  });

  it('picked near p2 it starts there, keeping that anchor; the spacing follows the sheet scale', () => {
    const t = start('baseline', 10);
    t.pick('B', 0.9, -0.5);
    t.runner.send({ kind: 'point', at: v(0, 0), anchor: { id: 'L', feature: 'start' } });
    expect(made(t)[0]).toMatchObject({ p1: v(1, 0), p2: v(0, 0), at: v(0.5, -0.525), anchors: { p1: { id: 'L', feature: 'end' }, p2: { id: 'L', feature: 'start' } } });
  });

  it('a point level with the start measures nothing and is refused', () => {
    const t = start('baseline');
    t.pick('B', 0.05, -0.5);
    t.click(0, 3);
    expect(t.messages).toEqual(['That point is level with the start; there is nothing to measure.']);
    expect(made(t)).toEqual([]);
    expect(t.runner.request?.prompt).toBe('Baseline: pick the next point (Enter to finish)');
  });

  it('only a linear or aligned dimension can be picked', () => {
    const t = start('baseline');
    t.pick('L', 0.5, 0);
    expect(t.runner.request?.prompt).toBe('Baseline: pick a linear dimension near the extension line to start from');
  });
});

describe('Continue dimension tool', () => {
  it('chains each dimension from where the last ended, on the same line', () => {
    const t = start('continue');
    t.pick('B', 0.95, -0.5); // near p2: continue from it
    t.click(2, 0);
    t.click(3.5, 0.1);
    expect(made(t)).toMatchObject([
      { p1: v(1, 0), p2: v(2, 0), at: v(1.5, -0.5), anchors: { p1: { id: 'L', feature: 'end' } } },
      { p1: v(2, 0), p2: v(3.5, 0.1), at: v(2.75, -0.5) },
    ]);
    expect('anchors' in made(t)[1]!).toBe(false); // (2, 0) was typed, not snapped
    expect(made(t).map((e) => measuredValue(e))).toEqual([1, 1.5]);
  });

  it('from an aligned dimension it measures along that dimension', () => {
    const t = setup();
    t.add({ kind: 'dimension', id: 'A', layer: '0', dimStyle: 'INCH-3PL', type: 'aligned', p1: v(0, 0), p2: v(3, 4), at: v(-0.8, 0.6) });
    t.runner.start(createContinueDimTool());
    t.pick('A', 3, 4);
    t.click(6, 8);
    const d = t.last() as Lin;
    expect(d).toMatchObject({ type: 'linear', dir: v(0.6, 0.8), p1: v(3, 4), p2: v(6, 8) });
    expect(measuredValue(d)).toBeCloseTo(5, 12);
  });
});

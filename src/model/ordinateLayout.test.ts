import { describe, expect, it } from 'vitest';
import { alignOrdinatesTool, createOrdinateDimTool } from '../commands/ordinateTool';
import { setup } from '../commands/toolHarness';
import { applyDimensionGrip } from './dimGrips';
import { createDrawing } from './drawing';
import type { DimensionEntity } from './entity';
import { alignOrdinates, clearOfNeighbors, onCommonBaseline } from './ordinateLayout';
import { textWidth } from './textMetrics';

const v = (x: number, y: number) => ({ x, y });
type Ord = Extract<DimensionEntity, { type: 'ordinate' }>;
const ord = (id: string, p1: { x: number; y: number }, at: { x: number; y: number }, axis: 'x' | 'y' = 'x'): Ord => ({
  kind: 'dimension', id, layer: '0', dimStyle: 'INCH-3PL', type: 'ordinate', p1, origin: v(0, 0), axis, at,
});
const w = (text: string) => textWidth(text, 0.12); // INCH-3PL at 1:1; the gap between texts is .0625
const GAP = 0.0625;

function drawingWith(...os: Ord[]) {
  const d = createDrawing('in');
  for (const o of os) d.entities.set(o.id, o);
  return d;
}

describe('common baseline', () => {
  const a = ord('A', v(0.5, 0.25), v(0.5, 1));
  it('a leader end within two text heights of another ordinate\'s goes level with it', () => {
    const d = drawingWith(a);
    expect(onCommonBaseline(d, ord('B', v(1, 0.25), v(1, 1.2))).at).toEqual(v(1, 1));
    expect(onCommonBaseline(d, ord('B', v(1, 0.25), v(1, 1.25))).at).toEqual(v(1, 1.25)); // .25 away: too far
  });

  it('only ordinates of the same axis with leaders the same way count', () => {
    const d = drawingWith(a, ord('Y', v(2, 0.5), v(3, 1.1), 'y'));
    expect(onCommonBaseline(d, ord('B', v(1, 1.5), v(1, 1.1))).at).toEqual(v(1, 1.1)); // its leader runs down
    expect(onCommonBaseline(d, ord('C', v(1, 0.25), v(2.5, 0.9), 'y')).at).toEqual(v(2.5, 0.9)); // Y: its baseline is an X position
  });
});

describe('auto-jog', () => {
  it('a text that would overlap its neighbor on the baseline moves to the nearest clear place', () => {
    const d = drawingWith(ord('A', v(0.5, 0.25), v(0.5, 1)));
    const b = clearOfNeighbors(d, ord('B', v(0.55, 0.25), v(0.55, 1)));
    expect(b.at.x).toBeCloseTo(0.5 + (w('.500') + w('.550')) / 2 + GAP, 12);
    expect(b.at.y).toBe(1);
    const far = ord('C', v(1.5, 0.25), v(1.5, 1));
    expect(clearOfNeighbors(d, far)).toBe(far);
  });

  it('placed with the tool: snapped to the baseline, then jogged clear', () => {
    const t = setup();
    t.runner.start(createOrdinateDimTool());
    t.click(0.5, 0.25);
    t.click(0.5, 1);
    t.click(0.45, 0.25);
    t.click(0.45, 1.1);
    const b = t.last() as Ord;
    expect(b.at.y).toBe(1);
    expect(b.at.x).toBeCloseTo(0.5 - (w('.500') + w('.450')) / 2 - GAP, 12);
  });

  it('a text dragged by its grip lands on the baseline, clear of the others', () => {
    const d = drawingWith(ord('A', v(0.5, 0.25), v(0.5, 1)));
    const moved = applyDimensionGrip(d, ord('B', v(2, 0.25), v(2, 0.6)), 'text', v(0.52, 0.9)) as Ord;
    expect(moved.at.y).toBe(1);
    expect(moved.at.x).toBeCloseTo(0.5 + (w('.500') + w('2.000')) / 2 + GAP, 12);
  });
});

describe('Align ordinates', () => {
  it('lines each set up on the picked level, texts packed a gap apart in feature order, near their features', () => {
    const os = [ord('A', v(0.5, 0.25), v(0.5, 0.8)), ord('B', v(0.55, 0.25), v(0.6, 1.3)), ord('C', v(1.5, 0.25), v(1.5, 1)), ord('Y', v(2, 0.5), v(2.4, 0.5), 'y')];
    const d = drawingWith(...os);
    const out = alignOrdinates(d, os, v(2.75, 1.2));
    const [a, b, c, y] = ['A', 'B', 'C', 'Y'].map((id) => out.get(id)!) as [Ord, Ord, Ord, Ord];
    expect([a, b, c].map((o) => o.at.y)).toEqual([1.2, 1.2, 1.2]);
    expect(b.at.x - a.at.x).toBeCloseTo((w('.500') + w('.550')) / 2 + GAP, 12);
    // The packed pair is shifted to sit, on average, on the features: A left of .5, B right of .55.
    const push = 0.5 + (w('.500') + w('.550')) / 2 + GAP - 0.55;
    expect(a.at.x).toBeCloseTo(0.5 - push / 3, 12);
    expect(c.at.x).toBeCloseTo(1.5 - push / 3, 12);
    expect(y.at).toEqual(v(2.75, 0.5)); // a Y ordinate's level is the picked X
  });

  it('the tool: the selection, then the level; one undo step; nothing to do without ordinates', () => {
    const t = setup();
    t.add(ord('A', v(0.5, 0.25), v(0.5, 0.8)));
    t.add(ord('B', v(1, 0.25), v(1, 1.3)));
    t.add({ kind: 'line', id: 'L', layer: '0', start: v(0, 0), end: v(1, 0) });
    t.select('A', 'B', 'L');
    t.runner.start(alignOrdinatesTool);
    expect(t.runner.request?.prompt).toBe('Align ordinates: pick the level the leaders end at');
    t.click(3, 1);
    expect(t.entities().filter((e): e is Ord => e.kind === 'dimension').map((o) => o.at)).toEqual([v(0.5, 1), v(1, 1)]);
    expect(t.undo.undoLabel).toBe('Align ordinates');
    t.undo.undo();
    expect((t.drawing.entities.get('B') as Ord).at).toEqual(v(1, 1.3));

    const u = setup();
    u.add({ kind: 'line', id: 'L', layer: '0', start: v(0, 0), end: v(1, 0) });
    u.select('L');
    u.runner.start(alignOrdinatesTool);
    expect(u.messages).toEqual(['No ordinate dimensions are selected.']);
  });
});

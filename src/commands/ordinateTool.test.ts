import { describe, expect, it } from 'vitest';
import { parseDrawing, serializeDrawing } from '../io/nativeFile';
import { dimensionLayout, layoutDimension } from '../model/dimLayout';
import { defaultDimStyle } from '../model/dimStyle';
import type { DimensionEntity, Entity } from '../model/entity';
import { textWidth } from '../model/textMetrics';
import { convertUnits } from '../model/units';
import { createOrdinateDimTool, ordinateAxis } from './ordinateTool';
import { setup } from './toolHarness';

const v = (x: number, y: number) => ({ x, y });
type Ord = Extract<DimensionEntity, { type: 'ordinate' }>;
const INCH = defaultDimStyle('in'); // text and arrows .12, gap and offset .0625
const ord = (p1: { x: number; y: number }, at: { x: number; y: number }, axis: 'x' | 'y', origin = v(0, 0)): Ord => ({
  kind: 'dimension', id: 'O', layer: '0', dimStyle: 'INCH-3PL', type: 'ordinate', p1, origin, axis, at,
});
const ords = (t: ReturnType<typeof setup>) => t.entities().filter((e): e is Ord => e.kind === 'dimension' && e.type === 'ordinate');
const texts = (t: ReturnType<typeof setup>) => ords(t).map((e) => dimensionLayout(t.drawing, e).text.main);
const center = (b: { minX: number; maxX: number; minY: number; maxY: number }) => v((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2);

describe('ordinate axis', () => {
  it('a leader dragged up or down gives X, sideways gives Y, unless forced', () => {
    expect(ordinateAxis(v(0, 0), v(0.1, 1), 'auto')).toBe('x');
    expect(ordinateAxis(v(0, 0), v(-1, 0.2), 'auto')).toBe('y');
    expect(ordinateAxis(v(0, 0), v(0.1, 1), 'y')).toBe('y');
  });
});

describe('ordinate layout', () => {
  it('reads the distance from the origin, never negative; the leader starts an offset from the feature; text past its end', () => {
    const l = layoutDimension(ord(v(0.5, 0.25), v(0.5, 1), 'x'), INCH, 25.4);
    expect(l.text.main).toBe('.500');
    expect(l.arrows).toEqual([]);
    expect(l.lines).toEqual([[v(0.5, 0.3125), v(0.5, 1)]]);
    const c = center(l.textBox);
    expect(c.x).toBeCloseTo(0.5, 12);
    expect(c.y).toBeCloseTo(1 + 0.0625 + 0.06, 12);
    expect(layoutDimension(ord(v(-0.75, 0.25), v(-0.75, 1), 'x'), INCH, 25.4).text.main).toBe('.750');
  });

  it('at the origin it reads a bare 0, inch or mm, and so does a distance that rounds to nothing', () => {
    expect(layoutDimension(ord(v(0, 0.25), v(0, 1), 'x'), INCH, 25.4).text.main).toBe('0');
    expect(layoutDimension(ord(v(0.0004, 0.25), v(0, 1), 'x'), INCH, 25.4).text.main).toBe('0');
    expect(layoutDimension(ord(v(0.0005, 0.25), v(0, 1), 'x'), INCH, 25.4).text.main).toBe('.001');
    expect(layoutDimension(ord(v(0, 5), v(0, 20), 'x'), defaultDimStyle('mm'), 1 / 25.4).text.main).toBe('0');
  });

  it('jogs across in its last two arrow lengths when the text is off the leader line', () => {
    const l = layoutDimension(ord(v(0.5, 0.25), v(0.75, 1), 'x'), INCH, 25.4);
    expect(l.lines).toHaveLength(3);
    const flat = l.lines.flat();
    const want = [v(0.5, 0.3125), v(0.5, 0.52), v(0.5, 0.52), v(0.75, 0.76), v(0.75, 0.76), v(0.75, 1)];
    flat.forEach((p, i) => {
      expect(p.x).toBeCloseTo(want[i]!.x, 12);
      expect(p.y).toBeCloseTo(want[i]!.y, 12);
    });
  });

  it('a Y ordinate has a sideways leader, its text past the end', () => {
    const l = layoutDimension(ord(v(0.5, 0.25), v(1.5, 0.25), 'y', v(0, 0.125)), INCH, 25.4);
    expect(l.text.main).toBe('.125');
    expect(l.lines).toEqual([[v(0.5625, 0.25), v(1.5, 0.25)]]);
    expect(center(l.textBox).x).toBeCloseTo(1.5 + 0.0625 + textWidth('.125', 0.12) / 2, 12);
  });
});

describe('Ordinate tool', () => {
  it('feature after feature from the origin: X by a vertical drag, Y by a sideways one; each one undo step until Enter', () => {
    const t = setup();
    t.runner.start(createOrdinateDimTool());
    expect(t.runner.request?.prompt).toBe('Ordinate: pick an edge or a feature (Enter to finish)');
    expect(t.runner.request?.options?.map((o) => o.label)).toEqual(['Auto', 'X ordinate', 'Y ordinate', 'Set origin']);
    t.click(0.5, 0.25);
    t.click(0.5, 1);
    t.click(0.5, 0.25);
    t.click(1.5, 0.3);
    t.finish();
    expect(texts(t)).toEqual(['.500', '.250']);
    expect(ords(t)[0]).toMatchObject({ axis: 'x', origin: v(0, 0), at: v(0.5, 1) });
    expect(t.runner.request?.prompt).toBe('Ordinate: pick an edge or a feature (Enter to finish)'); // sticky
    t.undo.undo();
    expect(texts(t)).toEqual(['.500']);
  });

  it('in lathe mode the choices are Z and X, and with Ø on an X ordinate reads the diameter', () => {
    const t = setup();
    t.drawing.lathe = true;
    t.drawing.diameterMode = true;
    t.runner.start(createOrdinateDimTool());
    expect(t.runner.request?.options?.map((o) => o.label)).toEqual(['Auto', 'Z ordinate', 'X ordinate', 'Set origin']);
    t.option('orient:y'); // forced X (radial), wherever the text goes
    t.click(0.2, 0.094);
    t.click(0.3, 0.5);
    expect(texts(t)).toEqual(['Ø.188']);
    expect(t.runner.request?.options?.find((o) => o.active)?.label).toBe('X ordinate'); // kept
  });

  it('Set origin moves the origin and the ordinates on it in one undo step; new ones measure from it', () => {
    const t = setup();
    t.runner.start(createOrdinateDimTool());
    t.click(0.5, 0.25);
    t.click(0.5, 1);
    t.option('origin');
    expect(t.runner.request?.prompt).toBe('Ordinate: pick the origin the ordinates measure from');
    t.click(0.125, 0);
    expect(t.drawing.dimOrigin).toEqual(v(0.125, 0));
    expect(texts(t)).toEqual(['.375']);
    t.click(1, 0.25);
    t.click(1, 1);
    expect(texts(t)).toEqual(['.375', '.875']);
    t.undo.undo();
    t.undo.undo();
    expect(t.drawing.dimOrigin).toEqual(v(0, 0));
    expect(texts(t)).toEqual(['.500']);
  });

  it('a snapped feature is followed: the value updates and the text keeps level with it', () => {
    const t = setup();
    const line: Entity = { kind: 'line', id: 'L', layer: '0', start: v(0, 0.25), end: v(0.5, 0.25) };
    t.add(line);
    t.runner.start(createOrdinateDimTool());
    t.runner.send({ kind: 'point', at: v(0.5, 0.25), anchor: { id: 'L', feature: 'end' } });
    t.click(0.5, 1);
    t.undo.commit({ label: 'Edit', changes: [{ op: 'modify', before: line, after: { ...line, end: v(0.625, 0.25) } }] });
    expect(texts(t)).toEqual(['.625']);
    expect(ords(t)[0]!.at).toEqual(v(0.625, 1));
  });

  it('a vertical or horizontal edge is picked before snaps, measured at its end nearer the click and anchored; the drag still says Z or X', () => {
    const t = setup();
    t.drawing.lathe = true;
    t.drawing.diameterMode = true;
    const shoulder: Entity = { kind: 'line', id: 'S', layer: '0', start: v(0.25, 0.0625), end: v(0.25, 0.094) };
    const body: Entity = { kind: 'line', id: 'B', layer: '0', start: v(0.25, 0.094), end: v(0.6, 0.094) };
    const slope: Entity = { kind: 'line', id: 'C', layer: '0', start: v(0, 0.05), end: v(0.01, 0.06) };
    for (const e of [shoulder, body, slope]) t.add(e);
    t.runner.start(createOrdinateDimTool());
    const pick = t.runner.request?.kind === 'point' ? t.runner.request.pick : undefined;
    expect([shoulder, body, slope].map((e) => pick?.(e))).toEqual([true, true, false]); // a sloped edge is left to snaps
    t.pick('S', 0.25, 0.09);
    t.click(0.25, 0.3); // up: the shoulder's Z
    t.pick('B', 0.5, 0.094);
    t.click(0.8, 0.094); // sideways: the body's Ø
    t.pick('B', 0.3, 0.094);
    t.click(0.25, 0.3); // up from the near end: its Z
    expect(texts(t)).toEqual(['.250', 'Ø.188', '.250']);
    expect(ords(t).map((o) => [o.axis, o.p1, o.anchors?.p1])).toEqual([
      ['x', v(0.25, 0.094), { id: 'S', feature: 'end' }],
      ['y', v(0.6, 0.094), { id: 'B', feature: 'end' }],
      ['x', v(0.25, 0.094), { id: 'B', feature: 'start' }],
    ]);
  });

  it('the text cannot go on the feature', () => {
    const t = setup();
    t.runner.start(createOrdinateDimTool());
    t.click(0.5, 0.25);
    t.click(0.5, 0.25);
    expect(t.messages).toEqual(['The text needs to go away from the feature.']);
    expect(ords(t)).toEqual([]);
  });
});

describe('ordinate origin, saved and converted', () => {
  it('round-trips the origin and an ordinate; a bad axis is refused; converting units scales the origin', () => {
    const t = setup();
    t.drawing.dimOrigin = v(0.5, 0);
    t.add(ord(v(1, 0.25), v(1, 1), 'x', v(0.5, 0)));
    const text = serializeDrawing(t.drawing);
    const back = parseDrawing(text);
    if (!back.ok) throw new Error(back.error);
    expect(back.drawing.dimOrigin).toEqual(v(0.5, 0));
    expect(back.drawing.entities.get('O')).toEqual(ord(v(1, 0.25), v(1, 1), 'x', v(0.5, 0)));
    const bad = parseDrawing(text.replace('"axis": "x"', '"axis": "z"'));
    expect(bad.ok ? 'opened' : bad.error).toBe('entities[0].axis must be "x" or "y".');
    t.undo.commit(convertUnits(t.drawing, 'mm')!);
    expect(t.drawing.dimOrigin).toEqual(v(12.7, 0));
    expect((t.drawing.entities.get('O') as Ord).origin).toEqual(v(12.7, 0));
  });
});

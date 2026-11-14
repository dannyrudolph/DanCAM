import { describe, expect, it } from 'vitest';
import { createSymmetricDimTool } from '../commands/dimTools';
import { setup } from '../commands/toolHarness';
import { rotation, translation } from '../geometry/transform';
import { applyDimensionGrip } from './dimGrips';
import { dimensionLayout, layoutDimension } from './dimLayout';
import { defaultDimStyle } from './dimStyle';
import { createDrawing } from './drawing';
import { type DimensionEntity, type Entity, transformEntity } from './entity';
import { UndoStack } from './undo';

const v = (x: number, y: number) => ({ x, y });
type Sym = Extract<DimensionEntity, { type: 'symmetric' }>;
const INCH = defaultDimStyle('in'); // text and arrows .12, gap and offset .0625, extension .125
const sym = (p1: { x: number; y: number }, at: { x: number; y: number }, more: Partial<Sym> = {}): Sym => ({
  kind: 'dimension', id: 'S', layer: '0', dimStyle: 'INCH-3PL', type: 'symmetric', p1, axisBase: v(p1.x, 0), axisDir: v(1, 0), at, ...more,
});
const close = (p: { x: number; y: number }, q: { x: number; y: number }) => {
  expect(p.x).toBeCloseTo(q.x, 12);
  expect(p.y).toBeCloseTo(q.y, 12);
};

describe('symmetric diameter layout', () => {
  it('Half: Ø twice the distance; one extension line and one arrow at the feature; the line runs an arrow length past the axis', () => {
    const l = layoutDimension(sym(v(1, 0.75), v(2, 0.4)), INCH, 25.4);
    expect(l.value).toBe(1.5);
    expect(l.text.main).toBe('Ø1.500');
    expect(l.arrows).toHaveLength(1);
    expect(l.arrows[0]![0]).toEqual(v(2, 0.75)); // tip on the dimension line at the feature's level
    expect(l.lines).toHaveLength(3);
    expect(l.lines[0]).toEqual([v(1.0625, 0.75), v(2.125, 0.75)]); // extension line, offset from the feature, past the line
    // halfway to the axis, broken by the text (half height + gap = .1225 each way)
    close(l.lines[1]![0], v(2, 0.75));
    close(l.lines[1]![1], v(2, 0.375 + 0.1225));
    close(l.lines[2]![0], v(2, 0.375 - 0.1225));
    close(l.lines[2]![1], v(2, -0.12));
    close({ x: (l.textBox.minX + l.textBox.maxX) / 2, y: (l.textBox.minY + l.textBox.maxY) / 2 }, v(2, 0.375));
    expect(l.fit).toBe('inside');
  });

  it('Half, too small for the text between the arrow and the axis: the text goes past the axis', () => {
    const l = layoutDimension(sym(v(1, 0.1), v(2, 0.05)), INCH, 25.4);
    expect(l.text.main).toBe('Ø.200');
    expect(l.fit).toBe('textOutside');
    close({ x: (l.textBox.minX + l.textBox.maxX) / 2, y: (l.textBox.minY + l.textBox.maxY) / 2 }, v(2, 0.1 - (0.1 + 0.12 + 0.1225)));
  });

  it('Full: extension lines on both sides of the axis and two arrows, the same Ø', () => {
    const l = layoutDimension(sym(v(1, 0.75), v(2, 0.4)), { ...INCH, symmetric: 'full' }, 25.4);
    expect(l.text.main).toBe('Ø1.500');
    expect(l.arrows.map((a) => a[0])).toEqual([v(2, 0.75), v(2, -0.75)]);
    expect(l.lines.slice(0, 2)).toEqual([
      [v(1.0625, 0.75), v(2.125, 0.75)],
      [v(1.0625, -0.75), v(2.125, -0.75)],
    ]);
  });

  it('in lathe view with Ø on, a vertical linear dimension across the centerline reads Ø; not on one side, nor with Ø off', () => {
    const d = createDrawing('in');
    const across: DimensionEntity = { kind: 'dimension', id: 'L', layer: '0', dimStyle: 'INCH-3PL', type: 'linear', dir: v(0, 1), p1: v(1, 0.125), p2: v(1, -0.125), at: v(1.5, 0) };
    const oneSide: DimensionEntity = { ...across, p2: v(1, 0.05) };
    expect(dimensionLayout(d, across).text.main).toBe('.250');
    d.lathe = true;
    expect(dimensionLayout(d, across).text.main).toBe('.250');
    d.diameterMode = true;
    expect(dimensionLayout(d, across).text.main).toBe('Ø.250');
    expect(dimensionLayout(d, oneSide).text.main).toBe('.075');
    expect(dimensionLayout(d, { ...across, dir: v(1, 0), p2: v(1.25, -0.125) }).text.main).toBe('.250'); // horizontal
  });
});

describe('symmetric diameter, edited', () => {
  const line = (id: string, a: { x: number; y: number }, b: { x: number; y: number }): Entity => ({ kind: 'line', id, layer: '0', start: a, end: b });
  const anchored = sym(v(1, 0.75), v(2, 0.4), { anchors: { p1: { id: 'P', feature: 'end' }, axis: 'C' } });
  const drawing = () => {
    const d = createDrawing('in');
    for (const e of [line('C', v(0, 0), v(3, 0)), line('P', v(0, 0.75), v(1, 0.75)), anchored]) d.entities.set(e.id, e);
    return { d, undo: new UndoStack(d), get: () => d.entities.get('S') as Sym };
  };

  it('follows its feature; moved with its centerline, the dimension line goes along; deleting the centerline deletes it', () => {
    const { d, undo, get } = drawing();
    undo.commit({ label: 'Edit', changes: [{ op: 'modify', before: d.entities.get('P')!, after: line('P', v(0, 0.875), v(1.25, 0.875)) }] });
    expect(get()).toMatchObject({ p1: v(1.25, 0.875), axisBase: v(1.25, 0), at: v(2, 0.4) });
    const up = (e: Entity): Entity => transformEntity(e, translation(v(0, 0), v(0, 1)));
    undo.commit({ label: 'Move', changes: ['C', 'P'].map((id) => ({ op: 'modify' as const, before: d.entities.get(id)!, after: up(d.entities.get(id)!) })) });
    expect(get()).toMatchObject({ p1: v(1.25, 1.875), axisBase: v(1.25, 1), at: v(2, 1.4) });
    expect(dimensionLayout(d, get()).value).toBe(1.75);
    undo.commit({ label: 'Erase', changes: [{ op: 'remove', entity: d.entities.get('C')! }] });
    expect(d.entities.has('S')).toBe(false);
  });

  it('grips: the feature point moves (not onto the axis) and lets go of its anchor; the line moves along the axis', () => {
    const d = createDrawing('in');
    const moved = applyDimensionGrip(d, anchored, 'p1', v(1, 0.5)) as Sym;
    expect(moved.p1).toEqual(v(1, 0.5));
    expect(moved.anchors).toEqual({ axis: 'C' });
    expect(applyDimensionGrip(d, anchored, 'p1', v(1.5, 0))).toBeUndefined();
    expect(applyDimensionGrip(d, anchored, 'line1', v(2.5, 0.75))).toMatchObject({ at: v(2.5, 0.75) });
  });

  it('rotated, its axis turns with it', () => {
    const r = transformEntity(sym(v(1, 0.75), v(2, 0.4)), rotation(v(0, 0), 90)) as Sym;
    close(r.axisDir, v(0, 1));
    close(r.p1, v(-0.75, 1));
    expect(layoutDimension(r, INCH, 25.4).value).toBeCloseTo(1.5, 12);
  });
});

describe('Symmetric diameter tool', () => {
  it('in lathe mode: feature after feature on the lathe axis, each one undo step, until Enter', () => {
    const t = setup();
    t.drawing.lathe = true;
    t.add({ kind: 'line', id: 'P', layer: '0', start: v(0, 0.0625), end: v(0.2, 0.0625) });
    t.runner.start(createSymmetricDimTool());
    expect(t.runner.request?.prompt).toBe('Symmetric diameter: pick an edge or a feature (Enter to finish)');
    t.runner.send({ kind: 'point', at: v(0.2, 0.0625), anchor: { id: 'P', feature: 'end' } });
    t.click(0.25, 0.03);
    t.click(0.5, 0.094); // typed: not anchored
    t.click(0.55, 0.03);
    t.finish();
    const dims = t.entities().filter((e): e is Sym => e.kind === 'dimension');
    expect(dims.map((e) => dimensionLayout(t.drawing, e).text.main)).toEqual(['Ø.125', 'Ø.188']);
    expect(dims[0]).toMatchObject({ axisBase: v(0.2, 0), axisDir: v(1, 0), at: v(0.25, 0.03), anchors: { p1: { id: 'P', feature: 'end' } } });
    expect('anchors' in dims[1]!).toBe(false);
    expect(t.runner.request?.prompt).toBe('Symmetric diameter: pick an edge or a feature (Enter to finish)'); // sticky: ready for the next profile
    t.undo.undo();
    expect(t.entities().filter((e) => e.kind === 'dimension')).toHaveLength(1);
  });

  it('an edge parallel to the axis is picked before snaps, measured at its end nearer the click and anchored; others are left to snaps', () => {
    const t = setup();
    t.drawing.lathe = true;
    const nose: Entity = { kind: 'line', id: 'N', layer: '0', start: v(0.01, 0.0625), end: v(0.25, 0.0625) };
    const shoulder: Entity = { kind: 'line', id: 'S', layer: '0', start: v(0.25, 0.0625), end: v(0.25, 0.094) };
    const onAxis: Entity = { kind: 'line', id: 'A', layer: '0', start: v(0, 0), end: v(0.75, 0) };
    for (const e of [nose, shoulder, onAxis]) t.add(e);
    t.runner.start(createSymmetricDimTool());
    const pick = t.runner.request?.kind === 'point' ? t.runner.request.pick : undefined;
    expect([nose, shoulder, onAxis].map((e) => pick?.(e))).toEqual([true, false, false]);
    t.pick('N', 0.05, 0.0625);
    t.click(0.14, 0.03);
    const dim = t.entities().find((e): e is Sym => e.kind === 'dimension')!;
    expect(dimensionLayout(t.drawing, dim).text.main).toBe('Ø.125');
    expect(dim).toMatchObject({ p1: v(0.01, 0.0625), anchors: { p1: { id: 'N', feature: 'start' } } });
  });

  it('a point on the centerline is refused', () => {
    const t = setup();
    t.drawing.lathe = true;
    t.runner.start(createSymmetricDimTool());
    t.click(0.3, 0);
    expect(t.messages).toEqual(['That point is on the centerline; pick a feature off it.']);
    expect(t.runner.request?.prompt).toBe('Symmetric diameter: pick an edge or a feature (Enter to finish)');
  });

  it('outside lathe mode it asks for the centerline first, and anchors to it', () => {
    const t = setup();
    t.add({ kind: 'line', id: 'C', layer: '0', start: v(0, 1), end: v(0, -1) }); // a vertical axis, drawn downward
    t.runner.start(createSymmetricDimTool());
    expect(t.runner.request?.prompt).toBe('Symmetric diameter: pick the centerline');
    t.pick('C', 0, 0.5);
    t.click(0.3, 0.5);
    t.click(0.15, 0.8);
    const d = t.last() as Sym;
    expect(d).toMatchObject({ axisBase: v(0, 0.5), axisDir: v(0, -1), anchors: { axis: 'C' } });
    expect(dimensionLayout(t.drawing, d).text.main).toBe('Ø.600');
  });
});

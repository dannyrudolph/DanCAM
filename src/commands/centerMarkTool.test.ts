import { describe, expect, it } from 'vitest';
import { parseDrawing, serializeDrawing } from '../io/nativeFile';
import { centerlineBetween } from '../model/associate';
import { layoutDimension } from '../model/dimLayout';
import { defaultDimStyle } from '../model/dimStyle';
import type { DimensionEntity, Entity } from '../model/entity';
import { rowsFor } from '../model/properties';
import { createCenterMarkTool } from './centerMarkTool';
import { setup } from './toolHarness';

const v = (x: number, y: number) => ({ x, y });
const INCH = defaultDimStyle('in'); // arrows .12, offset .0625, extension .125
type Mark = Extract<DimensionEntity, { type: 'centerMark' }>;
type CL = Extract<DimensionEntity, { type: 'centerline' }>;
const line = (id: string, a: { x: number; y: number }, b: { x: number; y: number }): Entity => ({ kind: 'line', id, layer: '0', start: a, end: b });
const circle: Entity = { kind: 'circle', id: 'C', layer: '0', center: v(1, 1), radius: 0.5 };
const annotations = (t: ReturnType<typeof setup>) => t.entities().filter((e): e is Mark | CL => e.kind === 'dimension');

describe('center mark and centerline layout', () => {
  it('a center mark: a cross of half-arrow arms, then a gap, then lines an extension past the circle; no text, no value', () => {
    const mark: Mark = { kind: 'dimension', id: 'M', layer: '0', dimStyle: 'INCH-3PL', type: 'centerMark', center: v(1, 1), radius: 0.5, at: v(1, 1) };
    const l = layoutDimension(mark, INCH, 25.4);
    expect(l.value).toBeUndefined();
    expect(l.runs).toEqual([]);
    expect(l.centerDash).toBeUndefined();
    expect(l.lines.slice(0, 2)).toEqual([
      [v(1, 1), v(1.06, 1)],
      [v(1.1225, 1), v(1.625, 1)],
    ]);
    expect(l.lines).toHaveLength(8);
    expect(l.lines[7]).toEqual([v(1, 1 - 0.1225), v(1, 1 - 0.625)]);
  });

  it('a centerline: dash-dot, an extension past each end', () => {
    const cl: CL = { kind: 'dimension', id: 'L', layer: '0', dimStyle: 'INCH-3PL', type: 'centerline', p1: v(0, 0.5), p2: v(2, 0.5), at: v(1, 0.5) };
    const l = layoutDimension(cl, INCH, 25.4);
    expect(l.centerDash).toBe(true);
    expect(l.lines).toEqual([[v(-0.125, 0.5), v(2.125, 0.5)]]);
  });

  it('midway between two lines, whichever way the second was drawn', () => {
    const a = line('A', v(0, 0), v(2, 0)) as Extract<Entity, { kind: 'line' }>;
    expect(centerlineBetween(a, line('B', v(2.5, 1), v(0.5, 1)) as typeof a)).toEqual({ p1: v(0.25, 0.5), p2: v(2.25, 0.5) });
    expect(centerlineBetween(a, line('X', v(2, 0), v(0, 0)) as typeof a)).toEqual({ p1: v(0, 0), p2: v(2, 0) }); // on top of it: along it
  });
});

describe('Center mark tool', () => {
  it('marks a picked circle, anchored; a second mark on it is refused', () => {
    const t = setup();
    t.add(circle);
    t.runner.start(createCenterMarkTool());
    expect(t.runner.request?.prompt).toBe('Center mark: pick a circle or arc');
    t.pick('C', 1.5, 1);
    expect(annotations(t)).toEqual([
      { kind: 'dimension', id: 'e1', layer: '0', dimStyle: 'INCH-3PL', type: 'centerMark', center: v(1, 1), radius: 0.5, at: v(1, 1), anchors: { curve: 'C' } },
    ]);
    t.pick('C', 1.5, 1); // sticky: ready for the next
    expect(t.messages).toEqual(['That circle already has a center mark.']);
    expect(annotations(t)).toHaveLength(1);
  });

  it('follows its circle, and goes with it', () => {
    const t = setup();
    t.add(circle);
    t.runner.start(createCenterMarkTool());
    t.pick('C', 1.5, 1);
    t.undo.commit({ label: 'Edit', changes: [{ op: 'modify', before: circle, after: { ...circle, center: v(2, 1), radius: 0.25 } }] });
    expect(annotations(t)[0]).toMatchObject({ center: v(2, 1), radius: 0.25, at: v(2, 1) });
    t.undo.commit({ label: 'Erase', changes: [{ op: 'remove', entity: t.drawing.entities.get('C')! }] });
    expect(annotations(t)).toEqual([]);
  });

  it('Two lines: a centerline midway, following either line, deleted with either', () => {
    const t = setup();
    const a = line('A', v(0, 0), v(2, 0));
    t.add(a);
    t.add(line('B', v(0, 1), v(2, 1)));
    t.runner.start(createCenterMarkTool());
    t.option('method:lines');
    expect(t.runner.request?.prompt).toBe('Centerline: pick the first line');
    t.pick('A', 1, 0);
    t.pick('B', 1, 1);
    expect(annotations(t)[0]).toMatchObject({ type: 'centerline', p1: v(0, 0.5), p2: v(2, 0.5), anchors: { lines: ['A', 'B'] } });
    t.undo.commit({ label: 'Edit', changes: [{ op: 'modify', before: a, after: line('A', v(0, 0), v(3, 0)) }] });
    expect(annotations(t)[0]).toMatchObject({ p1: v(0, 0.5), p2: v(2.5, 0.5) });
    t.undo.commit({ label: 'Erase', changes: [{ op: 'remove', entity: t.drawing.entities.get('B')! }] });
    expect(annotations(t)).toEqual([]);
  });

  it('a center mark shows no text, precision or tolerance rows, and round-trips through a file', () => {
    const t = setup();
    t.add(circle);
    t.runner.start(createCenterMarkTool());
    t.pick('C', 1.5, 1);
    const mark = annotations(t)[0]!;
    expect(rowsFor(t.drawing, mark).map((r) => r.label)).toEqual(['Layer', 'Dim style', 'Type', 'Center X', 'Center Y', 'Radius']);
    const back = parseDrawing(serializeDrawing(t.drawing));
    if (!back.ok) throw new Error(back.error);
    expect(back.drawing.entities.get(mark.id)).toEqual(mark);
  });
});

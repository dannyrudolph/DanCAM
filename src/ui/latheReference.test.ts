import { describe, expect, it } from 'vitest';
import { type BBox } from '../geometry/bbox';
import { curveTouchesBox } from '../geometry/curve';
import { parseDrawing, serializeDrawing } from '../io/nativeFile';
import { flatText } from '../model/dimFormat';
import { dimensionLayout } from '../model/dimLayout';
import { createDrawing, type Drawing } from '../model/drawing';
import { type DimensionEntity, type Entity, entityCurve } from '../model/entity';
import { UndoStack } from '../model/undo';
import { LATHE_TEXTS, loadLatheReference } from './latheReference';

const dims = (d: Drawing): DimensionEntity[] => [...d.entities.values()].filter((e): e is DimensionEntity => e.kind === 'dimension');
const texts = (d: Drawing): string[] => dims(d).map((e) => flatText(dimensionLayout(d, e).text));
const overlap = (a: BBox, b: BBox): boolean => a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
/** The dimensions that print a text: center marks and centerlines have none. */
const withText = (d: Drawing) => dims(d).filter((e) => flatText(dimensionLayout(d, e).text) !== '');

describe('Phase 5 done-when: a turned pin in lathe mode, checked text by text', () => {
  const d = createDrawing('in');
  loadLatheReference(d);

  it('every dimension reads what the print should show, diameters as Ø', () => {
    expect(texts(d)).toEqual([...LATHE_TEXTS]);
    expect(d.lathe).toBe(true);
    expect(d.diameterMode).toBe(true);
    expect(d.sheetScale).toBe(10);
    expect(dims(d).map((e) => e.type)).toEqual([
      'symmetric', 'symmetric', 'ordinate', 'ordinate', 'ordinate', 'ordinate', 'ordinate', 'ordinate', 'centerline', 'centerMark', 'leader', 'leader',
    ]);
  });

  it('the Z ordinates share one baseline', () => {
    const z = dims(d).filter((e) => e.type === 'ordinate' && e.axis === 'x');
    expect(new Set(z.map((e) => e.at.y)).size).toBe(1);
  });

  it('no text overlaps another, or any of the part', () => {
    const boxes = withText(d).map((e) => ({ text: flatText(dimensionLayout(d, e).text), box: dimensionLayout(d, e).textBox }));
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i]!.box, boxes[j]!.box), `${boxes[i]!.text} / ${boxes[j]!.text}`).toBe(false);
    }
    const curves = [...d.entities.values()].map(entityCurve).filter((c) => c !== undefined);
    for (const { text, box } of boxes) expect(curves.some((c) => curveTouchesBox(c, box)), text).toBe(false);
  });

  it('no dimension\'s lines or arrows cross another\'s text', () => {
    const crossings: string[] = [];
    for (const a of withText(d)) {
      const box = dimensionLayout(d, a).textBox;
      for (const b of dims(d)) {
        if (a === b) continue;
        const l = dimensionLayout(d, b);
        const segments = [...l.lines, ...l.arrows.flatMap((t) => [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]] as const)];
        const hit = segments.some(([p, q]) => curveTouchesBox({ kind: 'segment', a: p, b: q }, box)) || l.arcs.some((arc) => curveTouchesBox({ kind: 'arc', ...arc }, box));
        if (hit) crossings.push(`${b.type} crosses ${flatText(dimensionLayout(d, a).text)}`);
      }
    }
    expect(crossings).toEqual([]);
  });

  it('stretching the back of the pin .05 longer: the Z ordinates past it follow, the diameters and the hole stay; undo puts it back', () => {
    const e = createDrawing('in');
    loadLatheReference(e);
    const undo = new UndoStack(e);
    const push = (p: { x: number; y: number }) => (p.x >= 0.55 ? { x: p.x + 0.05, y: p.y } : p);
    const changes = [...e.entities.values()].flatMap((x): { op: 'modify'; before: Entity; after: Entity }[] =>
      x.kind === 'line' && (x.start.x >= 0.55 || x.end.x >= 0.55) ? [{ op: 'modify', before: x, after: { ...x, start: push(x.start), end: push(x.end) } }] : []);
    expect(changes).toHaveLength(4); // body top, the step down, the neck, the back face
    undo.commit({ label: 'Stretch', changes });
    expect(texts(e)).toEqual(['Ø.125', 'Ø.188', 'Ø.156', '.000', '.250', '.400', '.650', '.800', '', '', 'Ø.030 THRU', '.010 X 45°']);
    undo.undo();
    expect(texts(e)).toEqual([...LATHE_TEXTS]);
  });

  it('saved and reopened, it reads the same, still in lathe mode', () => {
    const r = parseDrawing(serializeDrawing(d));
    if (!r.ok) throw new Error(r.error);
    expect(texts(r.drawing)).toEqual([...LATHE_TEXTS]);
    expect([...r.drawing.entities.values()]).toEqual([...d.entities.values()]);
    expect(r.drawing.lathe && r.drawing.diameterMode).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { type BBox } from '../geometry/bbox';
import { curveTouchesBox } from '../geometry/curve';
import { type Vec2, vecNearlyEqual } from '../geometry/vec';
import { parseDrawing, serializeDrawing } from '../io/nativeFile';
import { flatText } from '../model/dimFormat';
import { dimensionLayout } from '../model/dimLayout';
import { createDrawing, type Drawing } from '../model/drawing';
import { type DimensionEntity, entityCurve } from '../model/entity';
import { UndoStack } from '../model/undo';
import { HOLE, SHAFT, SHAFT_TEXTS, loadLatheShaft } from './latheShaft';

const dims = (d: Drawing): DimensionEntity[] => [...d.entities.values()].filter((e): e is DimensionEntity => e.kind === 'dimension');
const texts = (d: Drawing): string[] => dims(d).map((e) => flatText(dimensionLayout(d, e).text));
const overlap = (a: BBox, b: BBox): boolean => a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
const withText = (d: Drawing): DimensionEntity[] => dims(d).filter((e) => flatText(dimensionLayout(d, e).text) !== '');
type Ord = Extract<DimensionEntity, { type: 'ordinate' }>;

function lathePart(): Drawing {
  const d = createDrawing('in');
  loadLatheShaft(d);
  return d;
}

/**
 * Moves every line end at `from` by `delta` as one undo step, touching only
 * the geometry (as grips or the properties panel do), so the dimensions
 * change only by following their anchors.
 */
function moveEnds(d: Drawing, undo: UndoStack, from: readonly Vec2[], delta: Vec2): void {
  const moved = (p: Vec2): Vec2 => (from.some((f) => vecNearlyEqual(f, p)) ? { x: p.x + delta.x, y: p.y + delta.y } : p);
  const changes = [...d.entities.values()].flatMap((e) => {
    if (e.kind !== 'line') return [];
    const after = { ...e, start: moved(e.start), end: moved(e.end) };
    return vecNearlyEqual(after.start, e.start) && vecNearlyEqual(after.end, e.end) ? [] : [{ op: 'modify' as const, before: e, after }];
  });
  undo.commit({ label: 'Move ends', changes });
}

describe('Phase 5 done-when: a lathe part dimensioned the lathe way', () => {
  const d = lathePart();

  it('Z by ordinates from the front face, Ø by symmetric diameters, notes, a center mark and a centerline', () => {
    expect(texts(d)).toEqual([...SHAFT_TEXTS]);
    expect(dims(d).map((e) => e.type)).toEqual(['centerMark', 'centerline', ...Array(6).fill('ordinate'), 'symmetric', 'symmetric', 'symmetric', 'leader', 'leader']);
    expect(d.lathe && d.diameterMode).toBe(true);
    expect(d.sheetScale).toBe(10);
  });

  it('everything measured is anchored, the hole\'s ordinate to the end of its centerline', () => {
    expect(dims(d).filter((e) => e.type !== 'leader').every((e) => e.anchors !== undefined)).toBe(true);
    const [, centerline, , , hole] = dims(d);
    expect((hole as Ord).anchors?.p1).toEqual({ id: centerline!.id, feature: 'end' });
  });

  it('the cross hole moved .025 toward the back: its centerline follows the hidden lines and its ordinate follows the centerline, in one undo step', () => {
    const e = lathePart();
    const undo = new UndoStack(e);
    const sides = [HOLE.z - HOLE.radius, HOLE.z + HOLE.radius].flatMap((z) => [{ x: z, y: 0 }, { x: z, y: SHAFT.shoulderTop.y }]);
    moveEnds(e, undo, sides, { x: 0.025, y: 0 });
    expect(texts(e)[4]).toBe('.300');
    undo.undo();
    expect(texts(e)).toEqual([...SHAFT_TEXTS]);
  });

  it('the ordinates sit on one baseline; the .425 text moved clear of .400 and its leader jogs', () => {
    const os = dims(d).filter((e): e is Ord => e.type === 'ordinate');
    expect(new Set(os.map((o) => o.at.y)).size).toBe(1);
    const jogged = os.filter((o) => o.at.x !== o.p1.x).map((o) => flatText(dimensionLayout(d, o).text));
    expect(jogged).toContain('.425');
    const [b400, b425] = [os[3]!, os[4]!].map((o) => dimensionLayout(d, o).textBox);
    expect(overlap(b400!, b425!)).toBe(false);
  });

  it('no text overlaps another or any of the part, and no dimension crosses another\'s text', () => {
    const ds = withText(d);
    const boxes = ds.map((e) => ({ text: flatText(dimensionLayout(d, e).text), box: dimensionLayout(d, e).textBox }));
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i]!.box, boxes[j]!.box), `${boxes[i]!.text} / ${boxes[j]!.text}`).toBe(false);
    }
    const curves = [...d.entities.values()].map(entityCurve).filter((c) => c !== undefined);
    for (const { text, box } of boxes) expect(curves.some((c) => curveTouchesBox(c, box)), text).toBe(false);
    const crossings: string[] = [];
    for (const a of ds) {
      const box = dimensionLayout(d, a).textBox;
      for (const b of dims(d)) {
        if (a === b) continue;
        const l = dimensionLayout(d, b);
        const segments = [...l.lines, ...l.arrows.flatMap((t) => [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]] as const)];
        const hit = segments.some(([p, q]) => curveTouchesBox({ kind: 'segment', a: p, b: q }, box)) || l.arcs.some((arc) => curveTouchesBox({ kind: 'arc', ...arc }, box));
        if (hit) crossings.push(`${b.type} ${flatText(l.text)} crosses ${flatText(dimensionLayout(d, a).text)}`);
      }
    }
    expect(crossings).toEqual([]);
  });

  it('the back face moved .050 back: its ordinate reads .650 and Ø.125 goes with it; one undo puts it back', () => {
    const e = lathePart();
    const undo = new UndoStack(e);
    moveEnds(e, undo, [SHAFT.backTop, SHAFT.back], { x: 0.05, y: 0 });
    expect(texts(e).slice(2, 11)).toEqual(['0', '.150', '.275', '.400', '.425', '.650', 'Ø.080', 'Ø.100', 'Ø.125']);
    const o650 = dims(e)[7] as Ord;
    expect(o650.p1).toEqual({ x: 0.65, y: SHAFT.backTop.y });
    expect(undo.undoLabel).toBe('Move ends');
    undo.undo();
    expect(texts(e)).toEqual([...SHAFT_TEXTS]);
  });

  it('the groove deepened to Ø.090: its diameter re-measures, its ordinates stay', () => {
    const e = lathePart();
    const undo = new UndoStack(e);
    moveEnds(e, undo, [SHAFT.grooveBottom, SHAFT.grooveBottomEnd], { x: 0, y: -0.005 });
    expect(texts(e).slice(5, 11)).toEqual(['.400', '.425', '.600', 'Ø.080', 'Ø.090', 'Ø.125']);
  });

  it('saved and reopened, it reads the same, lathe and Ø on', () => {
    const r = parseDrawing(serializeDrawing(d));
    if (!r.ok) throw new Error(r.error);
    expect(texts(r.drawing)).toEqual([...SHAFT_TEXTS]);
    expect([...r.drawing.entities.values()]).toEqual([...d.entities.values()]);
    expect(r.drawing.lathe && r.drawing.diameterMode).toBe(true);
  });
});

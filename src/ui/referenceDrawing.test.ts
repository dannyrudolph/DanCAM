import { describe, expect, it } from 'vitest';
import { type BBox } from '../geometry/bbox';
import { curveTouchesBox } from '../geometry/curve';
import { parseDrawing, serializeDrawing } from '../io/nativeFile';
import { flatText } from '../model/dimFormat';
import { dimensionLayout } from '../model/dimLayout';
import { createDrawing, type Drawing } from '../model/drawing';
import { type DimensionEntity, entityCurve } from '../model/entity';
import { REFERENCE_TEXTS, loadReference } from './referenceDrawing';

const dims = (d: Drawing): DimensionEntity[] => [...d.entities.values()].filter((e): e is DimensionEntity => e.kind === 'dimension');
const texts = (d: Drawing): string[] => dims(d).map((e) => flatText(dimensionLayout(d, e).text));
const overlap = (a: BBox, b: BBox): boolean => a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;

describe('Phase 4 done-when: the reference drawing, checked text by text', () => {
  const d = createDrawing('in');
  loadReference(d);

  it('every dimension reads exactly what the print should show', () => {
    expect(texts(d)).toEqual([...REFERENCE_TEXTS]);
    expect(d.sheetScale).toBe(10);
    expect(dims(d).map((e) => e.type)).toEqual(['linear', 'linear', 'linear', 'aligned', 'angular', 'diameter', 'radius', 'angular', 'leader']);
  });

  it('the text prints .12 tall at 10:1, so it is .012 in the drawing', () => {
    for (const e of dims(d)) for (const run of dimensionLayout(d, e).runs) expect(run.height).toBeCloseTo(0.012, 15);
  });

  it('no text overlaps another dimension\'s text or any of the part', () => {
    const boxes = dims(d).map((e) => ({ text: REFERENCE_TEXTS[dims(d).indexOf(e)], box: dimensionLayout(d, e).textBox }));
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i]!.box, boxes[j]!.box), `${boxes[i]!.text} / ${boxes[j]!.text}`).toBe(false);
    }
    const curves = [...d.entities.values()].map(entityCurve).filter((c) => c !== undefined);
    for (const { text, box } of boxes) expect(curves.some((c) => curveTouchesBox(c, box)), text).toBe(false);
  });

  it('no dimension\'s lines, arcs or arrows cross another dimension\'s text', () => {
    const crossings: string[] = [];
    for (const a of dims(d)) {
      const box = dimensionLayout(d, a).textBox;
      for (const b of dims(d)) {
        if (a === b) continue;
        const l = dimensionLayout(d, b);
        const segments = [...l.lines, ...l.arrows.flatMap((t) => [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]] as const)];
        const hit = segments.some(([p, q]) => curveTouchesBox({ kind: 'segment', a: p, b: q }, box)) || l.arcs.some((arc) => curveTouchesBox({ kind: 'arc', ...arc }, box));
        if (hit) crossings.push(`${flatText(l.text)} crosses ${flatText(dimensionLayout(d, a).text)}`);
      }
    }
    expect(crossings).toEqual([]);
  });

  it('saved and reopened, it reads the same', () => {
    const r = parseDrawing(serializeDrawing(d));
    if (!r.ok) throw new Error(r.error);
    expect(texts(r.drawing)).toEqual([...REFERENCE_TEXTS]);
    expect([...r.drawing.entities.values()]).toEqual([...d.entities.values()]);
  });
});

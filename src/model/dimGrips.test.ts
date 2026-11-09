import { describe, expect, it } from 'vitest';
import { applyDimensionGrip, dimensionGrips, snapLineOffset } from './dimGrips';
import { dimensionLayout } from './dimLayout';
import { createDrawing } from './drawing';
import { type DimensionEntity, transformEntity } from './entity';
import { textWidth } from './textMetrics';

const v = (x: number, y: number) => ({ x, y });
type Lin = Extract<DimensionEntity, { type: 'linear' }>;
const linear: Lin = { kind: 'dimension', id: 'd', layer: '0', dimStyle: 'INCH-3PL', type: 'linear', dir: v(1, 0), p1: v(0, 0), p2: v(1, 0), at: v(0.5, 0.5), anchors: { p1: { id: 'e1', feature: 'start' }, p2: { id: 'e1', feature: 'end' } } };
const inch = createDrawing('in'); // text .12: snaps within .06

describe('dimension grips', () => {
  it('linear: the measured points, both ends of the dimension line, and the text center', () => {
    expect(dimensionGrips(inch, linear)).toEqual([
      { key: 'p1', at: v(0, 0) },
      { key: 'p2', at: v(1, 0) },
      { key: 'line1', at: v(0, 0.5) },
      { key: 'line2', at: v(1, 0.5) },
      { key: 'text', at: v(0.5, 0.5) },
    ]);
  });

  it('the dimension line snaps to .375 from the nearer point, then every .25, within half a text height', () => {
    const at = (to: { x: number; y: number }) => (applyDimensionGrip(inch, linear, 'line1', to) as Lin).at;
    expect(at(v(0.2, 0.4))).toEqual(v(0.2, 0.375));
    expect(at(v(0.2, 0.6))).toEqual(v(0.2, 0.625));
    expect(at(v(0.2, 0.55))).toEqual(v(0.2, 0.55)); // .075 from .625: free
    expect(at(v(0.3, -0.39))).toEqual(v(0.3, -0.375));
    // Between the measured points (they differ in height): no snap.
    const diagonal: Lin = { ...linear, p2: v(1, 1) };
    expect(snapLineOffset(inch, diagonal, v(0.5, 0.4))).toEqual(v(0.5, 0.4));
  });

  it('the spacing is a sheet spacing: a tenth at 10:1; 10 and 6 mm in a mm drawing', () => {
    const detail = createDrawing('in');
    detail.sheetScale = 10;
    expect(snapLineOffset(detail, linear, v(0.2, 0.04)).y).toBeCloseTo(0.0375, 15);
    const mm = createDrawing('mm');
    const m: Lin = { ...linear, dimStyle: 'MM-2PL', p2: v(20, 0) };
    expect(snapLineOffset(mm, m, v(5, 10.5))).toEqual(v(5, 10));
    expect(snapLineOffset(mm, m, v(5, 15.2))).toEqual(v(5, 16));
  });

  it('the text slides along the line, which runs out to it; dropped near the middle it centers again', () => {
    const moved = applyDimensionGrip(inch, linear, 'text', v(1.6, 0.41)) as Lin;
    expect(moved.at).toEqual(v(1.6, 0.375));
    expect(moved.textAt).toEqual(v(1.6, 0.41));
    const l = dimensionLayout(inch, moved);
    expect(l.fit).toBe('textOutside');
    const half = textWidth('1.000', 0.12) / 2 + 0.0625;
    expect(l.lines.at(-1)).toEqual([v(0, 0.375), v(1.6 - half, 0.375)]);
    expect(l.textBox.minX + l.textBox.maxX).toBeCloseTo(3.2, 12); // centered at x 1.6
    const back = applyDimensionGrip(inch, moved, 'text', v(0.53, 0.8)) as Lin;
    expect(back.textAt).toBeUndefined();
    expect(back.at).toEqual(v(0.53, 0.8));
    expect(dimensionLayout(inch, back).fit).toBe('inside');
  });

  it('a measured point moves, dropping its anchor and keeping the other; it cannot land on the other point', () => {
    const moved = applyDimensionGrip(inch, linear, 'p2', v(1.25, 0.1)) as Lin;
    expect(moved).toEqual({ ...linear, p2: v(1.25, 0.1), anchors: { p1: { id: 'e1', feature: 'start' } } });
    const both = applyDimensionGrip(inch, applyDimensionGrip(inch, moved, 'p1', v(0, 0.1))!, 'p2', v(1, 0.1))!;
    expect('anchors' in both).toBe(false);
    expect(applyDimensionGrip(inch, linear, 'p2', v(0, 0))).toBeUndefined();
  });

  it('radius text, the angular arc, and a leader tip and landing', () => {
    const radius: DimensionEntity = { kind: 'dimension', id: 'r', layer: '0', dimStyle: 'INCH-3PL', type: 'radius', center: v(0, 0), radius: 0.5, at: v(1, 1) };
    expect(dimensionGrips(inch, radius)).toEqual([{ key: 'text', at: v(1, 1) }]);
    expect(applyDimensionGrip(inch, radius, 'text', v(-1, 1))).toEqual({ ...radius, at: v(-1, 1) });
    expect(applyDimensionGrip(inch, radius, 'text', v(0, 0))).toBeUndefined();

    const angular: DimensionEntity = { kind: 'dimension', id: 'a', layer: '0', dimStyle: 'INCH-3PL', type: 'angular', vertex: v(0, 0), p1: v(1, 0), p2: v(0, 1), dir1: v(1, 0), dir2: v(0, 1), at: v(2, 0.1) };
    const [g] = dimensionGrips(inch, angular);
    expect(g!.key).toBe('arc');
    expect(g!.at.x).toBeCloseTo(Math.hypot(2, 0.1) * Math.SQRT1_2, 12); // the arc's middle, at 45°
    expect(g!.at.y).toBeCloseTo(Math.hypot(2, 0.1) * Math.SQRT1_2, 12);
    expect(applyDimensionGrip(inch, angular, 'arc', v(-1, -1))).toEqual({ ...angular, at: v(-1, -1) }); // now the reflex side

    const leader: DimensionEntity = { kind: 'dimension', id: 'l', layer: '0', dimStyle: 'INCH-3PL', type: 'leader', tip: v(0, 0), at: v(1, 1), text: '2X' };
    expect(dimensionGrips(inch, leader).map((x) => x.key)).toEqual(['tip', 'text']);
    expect(applyDimensionGrip(inch, leader, 'tip', v(0.5, 0))).toEqual({ ...leader, tip: v(0.5, 0) });
    expect(applyDimensionGrip(inch, leader, 'text', v(0, 0))).toBeUndefined();
  });

  it('a moved text position moves with the dimension', () => {
    const e = { ...linear, textAt: v(1.6, 0.4) };
    expect((transformEntity(e, { kind: 'translate', dx: 1, dy: 2 }) as Lin).textAt).toEqual(v(2.6, 2.4));
  });
});

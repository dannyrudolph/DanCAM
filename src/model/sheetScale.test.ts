import { describe, expect, it } from 'vitest';
import { dimensionLayout } from './dimLayout';
import { defaultDimStyle } from './dimStyle';
import { createDrawing } from './drawing';
import type { DimensionEntity } from './entity';
import { atSheetScale, formatSheetScale, parseSheetScale } from './sheetScale';
import { UndoStack } from './undo';

describe('sheet scale', () => {
  it('divides the sheet sizes, and only those', () => {
    const s = defaultDimStyle('in');
    expect(atSheetScale(s, 10)).toEqual({ ...s, textHeight: 0.012, arrowSize: 0.012, extOffset: 0.00625, extExtend: 0.0125, textGap: 0.00625 });
    const tol = { ...s, tolerance: { kind: 'symmetric' as const, value: 0.001 } };
    expect(atSheetScale(tol, 10).tolerance).toEqual({ kind: 'symmetric', value: 0.001 });
    expect(atSheetScale(s, 1)).toBe(s);
  });

  it('a 10:1 drawing lays out dimensions a tenth the size, reading the same value; undo puts it back', () => {
    const d = createDrawing('in');
    const e: DimensionEntity = { kind: 'dimension', id: 'd', layer: '0', dimStyle: 'INCH-3PL', type: 'radius', center: { x: 0, y: 0 }, radius: 0.01, at: { x: 0.03, y: 0.02 } };
    const undo = new UndoStack(d);
    const full = dimensionLayout(d, e);
    undo.commit({ label: 'Sheet scale', changes: [{ op: 'sheetScale', before: 1, after: 10 }] });
    const small = dimensionLayout(d, e);
    expect(small.text).toEqual(full.text);
    expect(small.runs[0]!.height).toBeCloseTo(0.012, 15);
    expect(small.textBox.maxY - small.textBox.minY).toBeCloseTo(0.012, 15);
    undo.undo();
    expect(d.sheetScale).toBe(1);
    expect(dimensionLayout(d, e)).toEqual(full);
  });

  it('formats and reads scales either side of 1:1', () => {
    expect([1, 10, 2.5, 0.5, 0.25].map(formatSheetScale)).toEqual(['1:1', '10:1', '2.5:1', '1:2', '1:4']);
    expect(['50:1', '1:2', '3/2', '2.5', ' 4 : 1 '].map(parseSheetScale)).toEqual([50, 0.5, 1.5, 2.5, 4]);
    expect(['0', '1:0', '-2', 'ten', ''].map(parseSheetScale)).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });
});

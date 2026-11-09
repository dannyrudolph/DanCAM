import { describe, expect, it } from 'vitest';
import { flatText } from './dimFormat';
import { dimensionLayout } from './dimLayout';
import { editableText, toleranceSetter, withPrecision, withText, withToleranceKind } from './dimOverride';
import { createDrawing } from './drawing';
import { type DimensionEntity, scaleEntity } from './entity';
import { rowsFor } from './properties';

const v = (x: number, y: number) => ({ x, y });
const d = createDrawing('in'); // INCH-3PL: 3 places, no tolerance
const linear: DimensionEntity = { kind: 'dimension', id: 'd', layer: '0', dimStyle: 'INCH-3PL', type: 'linear', dir: v(1, 0), p1: v(0, 0), p2: v(0.25, 0), at: v(0, 1) };
const angular: DimensionEntity = { kind: 'dimension', id: 'a', layer: '0', dimStyle: 'INCH-3PL', type: 'angular', vertex: v(0, 0), p1: v(1, 0), p2: v(0, 1), dir1: v(1, 0), dir2: v(0, 1), at: v(1, 1) };
const leader: DimensionEntity = { kind: 'dimension', id: 'l', layer: '0', dimStyle: 'INCH-3PL', type: 'leader', tip: v(0, 0), at: v(1, 1), text: '2X' };
const text = (e: DimensionEntity): string => flatText(dimensionLayout(d, e).text);

describe('dimension overrides', () => {
  it('precision overrides the style for the value and its tolerance; for an angle, the angle precision', () => {
    expect(text(withPrecision(linear, 4))).toBe('.2500');
    const tol = withToleranceKind(d, withPrecision(linear, 4), 'symmetric');
    expect(text(toleranceSetter(d, tol, 'Tol ±')!.set(0.0005) as DimensionEntity)).toBe('.2500 ±.0005');
    expect(text(withPrecision(angular, 1))).toBe('90.0°');
    expect(text(withPrecision(withPrecision(linear, 4), undefined))).toBe('.250');
    expect(withPrecision(withPrecision(linear, 4), undefined)).toEqual(linear); // the field is gone, not undefined
  });

  it('a tolerance kind carries its values where they fit, else starts at zero', () => {
    const dev = toleranceSetter(d, withToleranceKind(d, linear, 'deviation'), 'Tol upper')!.set(0.002) as DimensionEntity;
    expect(dev.tolerance).toEqual({ kind: 'deviation', upper: 0.002, lower: 0 });
    expect(text(dev)).toBe('.250 +.002/-.000');
    expect(withToleranceKind(d, dev, 'limits').tolerance).toEqual({ kind: 'limits', upper: 0.002, lower: 0 });
    expect(text(withToleranceKind(d, dev, 'limits'))).toBe('.252/.250');
    expect(withToleranceKind(d, dev, 'symmetric').tolerance).toEqual({ kind: 'symmetric', value: 0 });
    expect(withToleranceKind(d, dev, 'none').tolerance).toEqual({ kind: 'none' });
    expect(withToleranceKind(d, dev, undefined)).toEqual(linear);
  });

  it('tolerance values are refused when upper would fall below lower, or ± below zero', () => {
    const dev = withToleranceKind(d, linear, 'deviation');
    expect(toleranceSetter(d, dev, 'Tol upper')!.set(-0.001)).toBeUndefined();
    expect(toleranceSetter(d, dev, 'Tol lower')!.set(0.001)).toBeUndefined();
    expect(toleranceSetter(d, dev, 'Tol lower')!.refusal).toBe('the upper value must not be below the lower one');
    expect(toleranceSetter(d, withToleranceKind(d, linear, 'symmetric'), 'Tol ±')!.set(-0.001)).toBeUndefined();
    expect(toleranceSetter(d, angular, 'Tol ±')).toBeUndefined();
  });

  it('text override: <> is the measured value, symbol codes expand, empty or a bare <> goes back to the value', () => {
    const over = withText(linear, '2X %%c<> THRU')!;
    expect(over.textOverride).toBe('2X Ø<> THRU');
    expect(text(over)).toBe('2X Ø.250 THRU');
    expect(editableText(over)).toBe('2X Ø<> THRU');
    expect(editableText(linear)).toBe('<>');
    expect(withText(over, '  ')).toEqual(linear);
    expect(withText(over, '<>')).toEqual(linear);
  });

  it('a leader edits its note, which can not be emptied', () => {
    expect(withText(leader, ' 4X %%c.020 ')).toEqual({ ...leader, text: '4X Ø.020' });
    expect(withText(leader, '')).toBeUndefined();
    expect(editableText(leader)).toBe('2X');
  });

  it('the properties panel shows the precision and tolerance in effect; angles and leaders have no tolerance rows', () => {
    const labels = (e: DimensionEntity) => rowsFor(d, e).map((r) => r.label);
    const dev = withToleranceKind(d, linear, 'deviation');
    expect(rowsFor(d, dev).filter((r) => ['Precision', 'Tolerance', 'Tol upper', 'Tol lower'].includes(r.label))).toEqual([
      { label: 'Precision', value: '3' },
      { label: 'Tolerance', value: 'Deviation' },
      { label: 'Tol upper', value: 0 },
      { label: 'Tol lower', value: 0 },
    ]);
    expect(labels(angular)).toContain('Precision');
    expect(labels(angular)).not.toContain('Tolerance');
    expect(labels(leader)).not.toContain('Precision');
  });

  it('converting units scales a tolerance override with the geometry', () => {
    const dev = { ...linear, tolerance: { kind: 'deviation' as const, upper: 0.002, lower: -0.001 } };
    expect((scaleEntity(dev, (x) => x * 25.4) as DimensionEntity).tolerance).toEqual({ kind: 'deviation', upper: 0.002 * 25.4, lower: -0.001 * 25.4 });
  });
});

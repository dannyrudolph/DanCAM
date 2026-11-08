import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MIN_GRID_PX, gridLines, gridSpacing } from './grid';

describe('gridSpacing', () => {
  it('picks known steps at known scales', () => {
    // 12px minimum: at 100 px/in raw step is 0.12 → 0.2
    expect(gridSpacing(100)).toEqual({ step: 0.2, majorEvery: 5 });
    // at 250 px/in raw 0.048 → 0.05
    expect(gridSpacing(250)).toEqual({ step: 0.05, majorEvery: 2 });
    // at 1200 px/in raw exactly 0.01 → 0.01
    expect(gridSpacing(1200)).toEqual({ step: 0.01, majorEvery: 10 });
    // at 1e6 px/in (0.001" across 1000px) raw 1.2e-5 → 2e-5
    const deep = gridSpacing(1e6);
    expect(deep.step).toBeCloseTo(2e-5, 20);
    expect(deep.majorEvery).toBe(5);
  });

  it('rounds up to the next decade when 5x is not enough', () => {
    // raw 0.6 → 1, not 0.5
    expect(gridSpacing(20)).toEqual({ step: 1, majorEvery: 10 });
  });

  it('property: step is 1, 2 or 5 times a power of ten, at least MIN_GRID_PX apart, and the smallest such', () => {
    fc.assert(
      fc.property(fc.double({ min: 1e-3, max: 1e9, noNaN: true }), (scale) => {
        const { step, majorEvery } = gridSpacing(scale);
        const exp = Math.floor(Math.log10(step) + 1e-9);
        const mantissa = Math.round(step / 10 ** exp);
        expect([1, 2, 5]).toContain(mantissa);
        expect(majorEvery * mantissa).toBe(10);
        expect(step * scale).toBeGreaterThanOrEqual(MIN_GRID_PX * (1 - 1e-12));
        // The next smaller 1-2-5 step would be too dense.
        const smaller = mantissa === 1 ? 0.5 * step : mantissa === 2 ? 0.5 * step : 0.4 * step;
        expect(smaller * scale).toBeLessThan(MIN_GRID_PX);
      }),
    );
  });
});

describe('gridLines', () => {
  it('lists lines between min and max inclusive, with majors on multiples of majorEvery', () => {
    const lines = gridLines(-0.3, 0.5, { step: 0.2, majorEvery: 5 });
    expect(lines.map((l) => l.value)).toEqual([-0.2, 0, 0.2, 0.4]);
    expect(lines.map((l) => l.major)).toEqual([false, true, false, false]);
  });

  it('computes values as index * step so they stay exact far from the origin', () => {
    const lines = gridLines(1.99997, 2.00005, { step: 2e-5, majorEvery: 5 });
    expect(lines.map((l) => l.value)).toEqual([99999 * 2e-5, 100000 * 2e-5, 100001 * 2e-5, 100002 * 2e-5]);
    expect(lines.find((l) => l.major)?.value).toBe(100000 * 2e-5);
  });

  it('returns no lines for a range narrower than one step', () => {
    expect(gridLines(0.01, 0.09, { step: 0.1, majorEvery: 10 })).toEqual([]);
  });
});

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type DimFormat, INCH_ZEROS, MM_ZEROS, flatText, formatDecimal, formatDimension, expandSymbols, formatDms, roundDecimal } from './dimFormat';

const inch3: DimFormat = { precision: 3, zeros: INCH_ZEROS, tolerance: { kind: 'none' }, tolPrecision: 3 };
const mm2: DimFormat = { precision: 2, zeros: MM_ZEROS, tolerance: { kind: 'none' }, tolPrecision: 2 };
const text = (v: number, f: DimFormat): string => flatText(formatDimension(v, f));

describe('roundDecimal', () => {
  it('rounds in decimal, so a stored .1245 shows .125 though the double is 0.12449999…', () => {
    expect(0.1245 < 0.1245000000000001).toBe(true);
    expect((0.1245).toFixed(3)).toBe('0.124'); // what binary rounding gives
    expect(roundDecimal(0.1245, 3)).toBe('0.125');
    expect(roundDecimal(1.0005, 3)).toBe('1.001');
  });

  it('rounds halves away from zero and carries through nines', () => {
    expect(roundDecimal(-0.0625, 3)).toBe('-0.063');
    expect(roundDecimal(0.9996, 3)).toBe('1.000');
    expect(roundDecimal(9.99995, 4)).toBe('10.0000');
  });

  it('pads to the places asked, handles 0 places, large and tiny values', () => {
    expect(roundDecimal(0.25, 4)).toBe('0.2500');
    expect(roundDecimal(2.5, 0)).toBe('3');
    expect(roundDecimal(123456.789, 2)).toBe('123456.79');
    expect(roundDecimal(0.0000004, 6)).toBe('0.000000');
    expect(roundDecimal(0.0000005, 6)).toBe('0.000001');
  });

  it('never shows a minus sign on a value that rounds to zero', () => {
    expect(roundDecimal(-0.0001, 3)).toBe('0.000');
    expect(roundDecimal(-0, 2)).toBe('0.00');
  });

  it('agrees with exact decimal rounding of the 15-digit value', () => {
    fc.assert(
      fc.property(fc.integer({ min: -9_999_999, max: 9_999_999 }), fc.integer({ min: 0, max: 8 }), (n, places) => {
        // n / 10^4 is a value with four decimals; at four or more places it shows exactly.
        const v = n / 10_000;
        const shown = roundDecimal(v, places);
        if (places >= 4) expect(Number(shown)).toBe(v);
        expect(Math.abs(Number(shown) - v)).toBeLessThanOrEqual(0.5 * 10 ** -places + 1e-12);
      }),
    );
  });
});

describe('zero rules', () => {
  it('inch drops the leading zero and keeps trailing zeros', () => {
    expect(formatDecimal(0.25, 3, INCH_ZEROS)).toBe('.250');
    expect(formatDecimal(-0.25, 3, INCH_ZEROS)).toBe('-.250');
    expect(formatDecimal(1.5, 4, INCH_ZEROS)).toBe('1.5000');
  });

  it('mm keeps the leading zero and drops trailing zeros (and a bare point)', () => {
    expect(formatDecimal(0.25, 2, MM_ZEROS)).toBe('0.25');
    expect(formatDecimal(6.3, 2, MM_ZEROS)).toBe('6.3');
    expect(formatDecimal(32, 2, MM_ZEROS)).toBe('32');
  });
});

describe('formatDimension', () => {
  it('shows a plain value at the style precision', () => {
    expect(text(0.25, inch3)).toBe('.250');
    expect(text(0.1245, { ...inch3, precision: 4 })).toBe('.1245');
    expect(text(6.35, mm2)).toBe('6.35');
  });

  it('adds prefix and suffix, and replaces <> in an override with the measured text', () => {
    expect(text(0.125, { ...inch3, prefix: 'Ø' })).toBe('Ø.125');
    expect(text(0.015, { ...inch3, prefix: 'R' })).toBe('R.015');
    expect(text(0.125, { ...inch3, prefix: 'Ø', override: '2X <> THRU' })).toBe('2X Ø.125 THRU');
    expect(text(0.125, { ...inch3, override: 'REF' })).toBe('REF');
  });

  it('formats symmetric tolerances inline', () => {
    expect(text(0.25, { ...inch3, tolerance: { kind: 'symmetric', value: 0.001 } })).toBe('.250 ±.001');
    expect(formatDimension(0.25, { ...inch3, tolerance: { kind: 'symmetric', value: 0.001 } }).tol).toEqual({ kind: 'inline', text: '±.001' });
  });

  it('stacks deviations, writing a zero deviation as .000 with its sign in inch', () => {
    const t = formatDimension(0.25, { ...inch3, tolerance: { kind: 'deviation', upper: 0.002, lower: 0 } });
    expect(t).toEqual({ main: '.250', tol: { kind: 'stack', upper: '+.002', lower: '-.000' } });
    expect(flatText(t)).toBe('.250 +.002/-.000');
    expect(text(0.25, { ...inch3, tolerance: { kind: 'deviation', upper: 0.003, lower: -0.001 } })).toBe('.250 +.003/-.001');
  });

  it('writes a zero deviation as a bare 0 in mm, and keeps the value\'s trailing zeros with a tolerance', () => {
    expect(text(32, { ...mm2, tolerance: { kind: 'deviation', upper: 0, lower: -0.02 } })).toBe('32.00 0/-0.02');
    expect(text(6.3, { ...mm2, tolerance: { kind: 'symmetric', value: 0.05 } })).toBe('6.30 ±0.05');
  });

  it('shows limits as the upper limit over the lower, with no separate value', () => {
    const t = formatDimension(0.25, { ...inch3, tolerance: { kind: 'limits', upper: 0.001, lower: -0.001 } });
    expect(t).toEqual({ main: '', tol: { kind: 'stack', upper: '.251', lower: '.249' } });
    expect(flatText(t)).toBe('.251/.249');
  });

  it('uses its own precision for the tolerance', () => {
    expect(text(0.25, { ...inch3, tolPrecision: 4, tolerance: { kind: 'symmetric', value: 0.0005 } })).toBe('.250 ±.0005');
  });

  it('adds dual units in brackets with their own precision and zeros', () => {
    expect(text(0.25, { ...inch3, dual: { factor: 25.4, precision: 2, zeros: MM_ZEROS } })).toBe('.250 [6.35]');
    expect(text(6.35, { ...mm2, dual: { factor: 1 / 25.4, precision: 3, zeros: INCH_ZEROS } })).toBe('6.35 [.250]');
  });

  it('formats angles in decimal degrees with the zero rules, and leaves dual units off', () => {
    const ang: DimFormat = { precision: 1, zeros: MM_ZEROS, tolerance: { kind: 'none' }, tolPrecision: 1, angle: 'decimal', dual: { factor: 25.4, precision: 2, zeros: MM_ZEROS } };
    expect(text(45, ang)).toBe('45°');
    expect(text(29.95, ang)).toBe('30°');
    expect(text(0.5, { ...ang, precision: 2 })).toBe('0.5°');
    expect(text(45, { ...ang, tolerance: { kind: 'symmetric', value: 0.5 } })).toBe('45.0° ±0.5°');
  });
});

describe('formatDms', () => {
  it('shows degrees, minutes and seconds to the precision asked', () => {
    expect(formatDms(30.5, 0)).toBe('31°');
    expect(formatDms(30.5, 1)).toBe("30°30'");
    expect(formatDms(30.5125, 2)).toBe('30°30\'45"');
    expect(formatDms(30.51251, 3)).toBe('30°30\'45.0"');
  });

  it('carries rounded seconds and minutes upward', () => {
    expect(formatDms(29 + 59 / 60 + 59.9996 / 3600, 2)).toBe('30°0\'0"');
    expect(formatDms(44.9999, 1)).toBe("45°0'");
  });

  it('keeps the sign of a negative angle', () => {
    expect(formatDms(-10.25, 1)).toBe("-10°15'");
  });
});

describe('expandSymbols', () => {
  it('turns %%d, %%c and %%p into °, Ø and ± in either case, and leaves other text alone', () => {
    expect(expandSymbols('.010 X 45%%d')).toBe('.010 X 45°');
    expect(expandSymbols('%%C.125 THRU %%p.002 %%D')).toBe('Ø.125 THRU ±.002 °');
    expect(expandSymbols('100% %%x 2X')).toBe('100% %%x 2X');
  });
});

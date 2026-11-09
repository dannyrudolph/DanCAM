import { describe, expect, it } from 'vitest';
import { formatReadout } from '../ui/statusBar';
import { axisNames, radialFactor, viewLabel, viewRow } from './latheView';

const plain = { lathe: false, diameter: false };
const lathe = { lathe: true, diameter: false };
const dia = { lathe: true, diameter: true };

describe('lathe view', () => {
  it('names the axes X/Y, or Z and X in lathe mode, Ø for diameters', () => {
    expect([plain, lathe, dia].map(axisNames)).toEqual([
      { h: 'X', v: 'Y' },
      { h: 'Z', v: 'X' },
      { h: 'Z', v: 'Ø' },
    ]);
    expect([plain, lathe, dia, { lathe: false, diameter: true }].map(radialFactor)).toEqual([1, 1, 2, 1]);
  });

  it('renames coordinate rows, doubling vertical ones as diameters, and leaves the rest alone', () => {
    expect(['Start X', 'Start Y', 'ΔX', 'ΔY', 'Y', 'Radius', 'Text'].map((l) => viewLabel(l, dia))).toEqual([
      { label: 'Start Z', factor: 1 },
      { label: 'Start Ø', factor: 2 },
      { label: 'ΔZ', factor: 1 },
      { label: 'ΔØ', factor: 2 },
      { label: 'Ø', factor: 2 },
      { label: 'Radius', factor: 1 },
      { label: 'Text', factor: 1 },
    ]);
    expect(viewLabel('Center Y', lathe)).toEqual({ label: 'Center X', factor: 1 });
    expect(viewLabel('Center Y', plain)).toEqual({ label: 'Center Y', factor: 1 });
    expect(viewRow({ label: 'End Y', value: 0.0625 }, dia)).toEqual({ label: 'End Ø', value: 0.125 });
  });

  it('the status readout names the axes and shows a diameter', () => {
    const p = { x: 1.25, y: 0.0625 };
    expect(formatReadout(p, 4)).toBe('1.2500, 0.0625');
    expect(formatReadout(p, 4, lathe)).toBe('Z 1.2500  X 0.0625');
    expect(formatReadout(p, 4, dia)).toBe('Z 1.2500  Ø 0.1250');
  });
});

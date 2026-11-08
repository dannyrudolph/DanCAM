import { describe, expect, it } from 'vitest';
import { wheelZoomFactor } from './input';
import { formatFromBase, formatNumber, formatReadout } from './statusBar';

describe('coordinate readout', () => {
  it('shows 4 decimals by default', () => {
    expect(formatReadout({ x: 1.5, y: 0.2505 })).toBe('1.5000, 0.2505');
  });

  it('rounds for display only, leaving the value unchanged', () => {
    const p = { x: 0.123456789, y: -2 };
    expect(formatReadout(p)).toBe('0.1235, -2.0000');
    expect(p.x).toBe(0.123456789);
  });

  it('never shows negative zero', () => {
    expect(formatNumber(-0.00001, 4)).toBe('0.0000');
    expect(formatNumber(-0, 2)).toBe('0.00');
  });
});

describe('wheelZoomFactor', () => {
  it('zooms in when scrolling up and out when scrolling down, symmetrically', () => {
    const zoomIn = wheelZoomFactor(-100, 0);
    const zoomOut = wheelZoomFactor(100, 0);
    expect(zoomIn).toBeGreaterThan(1);
    expect(zoomIn * zoomOut).toBeCloseTo(1, 12);
  });

  it('treats line-mode deltas as 16px per line', () => {
    expect(wheelZoomFactor(3, 1)).toBeCloseTo(wheelZoomFactor(48, 0), 12);
  });

  it('many small steps zoom exactly as much as one large step', () => {
    expect(wheelZoomFactor(-10, 0) ** 10).toBeCloseTo(wheelZoomFactor(-100, 0), 12);
  });
});

describe('formatFromBase', () => {
  it('shows length and angle from the base point', () => {
    expect(formatFromBase({ x: 1, y: 2 }, { x: 4, y: 6 }, 3)).toBe('L 5.000  ∠ 53.130°');
  });
});

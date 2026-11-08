import { describe, expect, it } from 'vitest';
import { wheelAction, wheelZoomFactor } from './input';
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

describe('wheelAction', () => {
  it('a pinch (ctrlKey) zooms in either mode, spreading fingers zooms in', () => {
    for (const mode of ['pan', 'zoom'] as const) {
      const a = wheelAction(0, -10, 0, true, mode);
      expect(a.kind).toBe('zoom');
      if (a.kind === 'zoom') expect(a.factor).toBeCloseTo(Math.exp(0.1), 12);
    }
  });

  it('in pan mode, two-finger scroll moves the drawing with the fingers', () => {
    expect(wheelAction(30, -20, 0, false, 'pan')).toEqual({ kind: 'pan', dx: -30, dy: 20 });
  });

  it('in pan mode, line-mode deltas are converted to pixels', () => {
    expect(wheelAction(0, 3, 1, false, 'pan')).toEqual({ kind: 'pan', dx: -0, dy: -48 });
  });

  it('in zoom mode, the wheel zooms exactly as before', () => {
    expect(wheelAction(0, -100, 0, false, 'zoom')).toEqual({ kind: 'zoom', factor: wheelZoomFactor(-100, 0) });
  });
});

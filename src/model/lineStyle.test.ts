import { describe, expect, it } from 'vitest';
import { createDrawing, effectiveStyle } from './drawing';
import type { LineEntity } from './entity';
import { LINE_STYLES, dashOffset, insetSegment, patternLength } from './lineStyle';

describe('line styles', () => {
  it('Visible is continuous and the heaviest; Hidden and Center are dashed', () => {
    expect(LINE_STYLES.visible.dash).toEqual([]);
    for (const name of ['hidden', 'center', 'tangent'] as const) {
      expect(LINE_STYLES[name].weight).toBeLessThan(LINE_STYLES.visible.weight);
    }
    expect(LINE_STYLES.hidden.dash.length).toBe(2);
    expect(LINE_STYLES.center.dash).toHaveLength(4); // long-short
  });

  it('Tangent is continuous, lighter than the thin lines, with a gap at each end', () => {
    expect(LINE_STYLES.tangent.dash).toEqual([]);
    expect(LINE_STYLES.tangent.weight).toBeLessThan(LINE_STYLES.hidden.weight);
    expect(LINE_STYLES.tangent.endGap).toBeGreaterThan(0);
    for (const name of ['visible', 'hidden', 'center'] as const) expect(LINE_STYLES[name].endGap).toBe(0);
  });

  it('dashOffset keeps the pattern anchored when the start is clipped away', () => {
    expect(patternLength([8, 4])).toBe(12);
    expect(dashOffset([8, 4], 0)).toBe(0);
    expect(dashOffset([8, 4], 30)).toBe(6);
    expect(dashOffset([8, 4], 1e9)).toBe(1e9 % 12);
    expect(dashOffset([], 30)).toBe(0);
  });
});

describe('effectiveStyle', () => {
  const line = (style?: 'hidden', layer = '0'): LineEntity =>
    style
      ? { kind: 'line', id: 'e1', layer, style, start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }
      : { kind: 'line', id: 'e1', layer, start: { x: 0, y: 0 }, end: { x: 1, y: 0 } };

  it("uses the entity's own style first", () => {
    expect(effectiveStyle(createDrawing('in'), line('hidden')).name).toBe('hidden');
  });

  it("falls back to the layer's style", () => {
    const d = createDrawing('in');
    d.layers.set('CL', { name: 'CL', color: '#fff', visible: true, style: 'center' });
    expect(effectiveStyle(d, line(undefined, 'CL')).name).toBe('center');
  });

  it('falls back to Visible for an unknown layer', () => {
    expect(effectiveStyle(createDrawing('in'), line(undefined, 'missing')).name).toBe('visible');
  });
});

describe('insetSegment', () => {
  it('pulls both ends in by the gap along the line', () => {
    expect(insetSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, 4)).toEqual([
      { x: 4, y: 0 },
      { x: 96, y: 0 },
    ]);
    const [a, b] = insetSegment({ x: 0, y: 0 }, { x: 30, y: 40 }, 5); // 3-4-5 direction
    expect(a.x).toBeCloseTo(3, 12);
    expect(a.y).toBeCloseTo(4, 12);
    expect(b.x).toBeCloseTo(27, 12);
    expect(b.y).toBeCloseTo(36, 12);
  });

  it('keeps the middle half of a segment too short for full gaps', () => {
    expect(insetSegment({ x: 0, y: 0 }, { x: 8, y: 0 }, 4)).toEqual([
      { x: 2, y: 0 },
      { x: 6, y: 0 },
    ]);
  });

  it('returns the segment unchanged with no gap or no length', () => {
    const a = { x: 1, y: 1 };
    const b = { x: 5, y: 1 };
    expect(insetSegment(a, b, 0)).toEqual([a, b]);
    expect(insetSegment(a, a, 4)).toEqual([a, a]);
  });
});

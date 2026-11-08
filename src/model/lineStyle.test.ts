import { describe, expect, it } from 'vitest';
import { createDrawing, effectiveStyle } from './drawing';
import type { LineEntity } from './entity';
import { LINE_STYLES, dashOffset, patternLength } from './lineStyle';

describe('line styles', () => {
  it('Visible is continuous and heavier than the other three', () => {
    expect(LINE_STYLES.visible.dash).toEqual([]);
    for (const name of ['hidden', 'center', 'tangent'] as const) {
      expect(LINE_STYLES[name].dash.length).toBeGreaterThan(0);
      expect(LINE_STYLES[name].weight).toBeLessThan(LINE_STYLES.visible.weight);
    }
  });

  it('Center is long-short; Tangent (phantom) is long-short-short', () => {
    expect(LINE_STYLES.center.dash).toHaveLength(4);
    expect(LINE_STYLES.tangent.dash).toHaveLength(6);
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

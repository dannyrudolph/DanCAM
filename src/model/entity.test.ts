import { describe, expect, it } from 'vitest';
import { createDrawing, drawingBBox } from './drawing';

describe('drawingBBox', () => {
  it('covers circles and arcs by their curves and ignores xlines', () => {
    const d = createDrawing('in');
    d.entities.set('c', { kind: 'circle', id: 'c', layer: '0', center: { x: 0, y: 0 }, radius: 1 });
    // Upper half of a circle at x = 5: reaches y = 1 but not y = -1.
    d.entities.set('a', { kind: 'arc', id: 'a', layer: '0', center: { x: 5, y: 0 }, radius: 1, startDeg: 0, endDeg: 180 });
    d.entities.set('x', { kind: 'xline', id: 'x', layer: '0', base: { x: 100, y: 100 }, dir: { x: 0, y: 1 } });
    expect(drawingBBox(d)).toEqual({ minX: -1, minY: -1, maxX: 6, maxY: 1 });
  });

  it('is empty for a drawing of only xlines, so Zoom Extents leaves the view alone', () => {
    const d = createDrawing('in');
    d.entities.set('x', { kind: 'xline', id: 'x', layer: '0', base: { x: 0, y: 0 }, dir: { x: 1, y: 0 } });
    expect(drawingBBox(d).minX).toBe(Infinity);
  });
});

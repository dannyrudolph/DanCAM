import { describe, expect, it } from 'vitest';
import { createDrawing } from './drawing';
import type { Entity } from './entity';
import { boxModeFor, selectInBox } from './selection';

function drawing() {
  const d = createDrawing('in');
  const add = (e: Entity) => d.entities.set(e.id, e);
  add({ kind: 'line', id: 'inside', layer: '0', start: { x: 0.2, y: 0.2 }, end: { x: 0.8, y: 0.8 } });
  add({ kind: 'line', id: 'across', layer: '0', start: { x: 0.5, y: 0.5 }, end: { x: 3, y: 0.5 } });
  add({ kind: 'line', id: 'away', layer: '0', start: { x: 2, y: 2 }, end: { x: 3, y: 3 } });
  // the arc's chord ends are inside, but its bulge leaves the box: not inside
  add({ kind: 'arc', id: 'bulge', layer: '0', center: { x: 0.5, y: 0.5 }, radius: 0.45, startDeg: 0, endDeg: 180 });
  add({ kind: 'arc', id: 'small', layer: '0', center: { x: 0.5, y: 0.5 }, radius: 0.3, startDeg: 0, endDeg: 180 });
  add({ kind: 'xline', id: 'xl', layer: '0', base: { x: 0.5, y: 0.1 }, dir: { x: 1, y: 0 } });
  add({ kind: 'point', id: 'pt', layer: '0', at: { x: 0.9, y: 0.1 } });
  return d;
}
const box = { minX: 0, minY: 0, maxX: 1, maxY: 0.9 };

describe('selectInBox', () => {
  it('a window takes only objects entirely inside, judging arcs by their real extent; never xlines', () => {
    expect(selectInBox(drawing(), box, 'window')).toEqual(['inside', 'small', 'pt']);
  });

  it('a crossing also takes anything that touches the box', () => {
    expect(selectInBox(drawing(), box, 'crossing')).toEqual(['inside', 'across', 'bulge', 'small', 'xl', 'pt']);
  });

  it('skips objects on hidden layers', () => {
    const d = drawing();
    d.layers.set('0', { ...d.layers.get('0')!, visible: false });
    expect(selectInBox(d, box, 'crossing')).toEqual([]);
  });
});

describe('boxModeFor', () => {
  it('left to right is a window, right to left a crossing', () => {
    expect(boxModeFor(10, 50)).toBe('window');
    expect(boxModeFor(50, 10)).toBe('crossing');
  });
});

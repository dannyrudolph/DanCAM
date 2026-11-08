import { describe, expect, it } from 'vitest';
import { distanceToSegment } from '../geometry/distance';
import { createDrawing } from './drawing';
import { pickEntity } from './pick';

describe('distanceToSegment', () => {
  const a = { x: 0, y: 0 };
  const b = { x: 2, y: 0 };

  it('is the perpendicular distance beside the segment', () => {
    expect(distanceToSegment({ x: 1, y: 0.5 }, a, b)).toBe(0.5);
  });

  it('is the distance to the nearer end past either end', () => {
    expect(distanceToSegment({ x: -3, y: 4 }, a, b)).toBe(5);
    expect(distanceToSegment({ x: 5, y: 4 }, a, b)).toBe(5);
  });

  it('works for a zero-length segment', () => {
    expect(distanceToSegment({ x: 3, y: 4 }, a, a)).toBe(5);
  });
});

describe('pickEntity', () => {
  function drawing() {
    const d = createDrawing('in');
    d.entities.set('e1', { kind: 'line', id: 'e1', layer: '0', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } });
    d.entities.set('e2', { kind: 'line', id: 'e2', layer: '0', start: { x: 0, y: 0.1 }, end: { x: 1, y: 0.1 } });
    d.entities.set('e3', { kind: 'point', id: 'e3', layer: '0', at: { x: 2, y: 2 } });
    return d;
  }

  it('picks the nearest entity within the radius', () => {
    expect(pickEntity(drawing(), { x: 0.5, y: 0.03 }, 0.05)).toBe('e1');
    expect(pickEntity(drawing(), { x: 0.5, y: 0.08 }, 0.05)).toBe('e2');
    expect(pickEntity(drawing(), { x: 2.01, y: 2 }, 0.05)).toBe('e3');
  });

  it('picks nothing outside the radius', () => {
    expect(pickEntity(drawing(), { x: 0.5, y: 0.5 }, 0.05)).toBeUndefined();
  });

  it('skips entities on hidden layers', () => {
    const d = drawing();
    d.layers.set('0', { name: '0', color: '#fff', visible: false, style: 'visible' });
    expect(pickEntity(d, { x: 0.5, y: 0 }, 0.05)).toBeUndefined();
  });

  it('gives a tie to the entity drawn last', () => {
    const d = createDrawing('in');
    d.entities.set('a', { kind: 'line', id: 'a', layer: '0', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } });
    d.entities.set('b', { kind: 'line', id: 'b', layer: '0', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } });
    expect(pickEntity(d, { x: 0.5, y: 0 }, 0.05)).toBe('b');
  });
});

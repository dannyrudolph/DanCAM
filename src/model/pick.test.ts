import { describe, expect, it } from 'vitest';
import { distanceToSegment } from '../geometry/distance';
import { createDrawing } from './drawing';
import { dimensionLayout } from './dimLayout';
import type { DimensionEntity } from './entity';
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

describe('pickEntity on curves and xlines', () => {
  function drawing() {
    const d = createDrawing('in');
    d.entities.set('c', { kind: 'circle', id: 'c', layer: '0', center: { x: 0, y: 0 }, radius: 1 });
    d.entities.set('a', { kind: 'arc', id: 'a', layer: '0', center: { x: 5, y: 0 }, radius: 1, startDeg: 0, endDeg: 180 });
    d.entities.set('x', { kind: 'xline', id: 'x', layer: '0', base: { x: 0, y: 10 }, dir: { x: 1, y: 0 } });
    return d;
  }

  it('picks a circle on its curve, not inside its disc', () => {
    expect(pickEntity(drawing(), { x: 0, y: 1.02 }, 0.05)).toBe('c');
    expect(pickEntity(drawing(), { x: 0, y: 0 }, 0.05)).toBeUndefined();
  });

  it('picks an arc on its curve but not on the missing part of its circle', () => {
    expect(pickEntity(drawing(), { x: 5, y: 0.98 }, 0.05)).toBe('a');
    expect(pickEntity(drawing(), { x: 5, y: -1 }, 0.05)).toBeUndefined();
  });

  it('picks an xline far from its base point', () => {
    expect(pickEntity(drawing(), { x: -1000, y: 10.01 }, 0.05)).toBe('x');
  });

  it('picks a ray ahead of its base but not behind it', () => {
    const d = drawing();
    d.entities.set('r', { kind: 'ray', id: 'r', layer: '0', base: { x: 0, y: 20 }, dir: { x: 1, y: 0 } });
    expect(pickEntity(d, { x: 500, y: 20.01 }, 0.05)).toBe('r');
    expect(pickEntity(d, { x: -500, y: 20.01 }, 0.05)).toBeUndefined();
  });
});

const dim = (id: string, p1: { x: number; y: number }, p2: { x: number; y: number }, at: { x: number; y: number }): DimensionEntity => ({
  kind: 'dimension',
  id,
  layer: '0',
  dimStyle: 'INCH-3PL',
  type: 'linear',
  dir: { x: 1, y: 0 },
  p1,
  p2,
  at,
});

describe('pickEntity on a dimension', () => {
  it('picks it by clicking its text, where none of its lines pass', () => {
    const d = createDrawing('in');
    const e = dim('d1', { x: 0, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 1 });
    d.entities.set('d1', e);
    const box = dimensionLayout(d, e).textBox;
    expect(pickEntity(d, { x: 1, y: (box.minY + box.maxY) / 2 }, 0.001)).toBe('d1');
    expect(pickEntity(d, { x: 1, y: 0.5 }, 0.01)).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import type { ArcEntity, CircleEntity, Entity, LineEntity } from './entity';
import { propertySetter, withLayer, withStyle } from './propertyEdit';

const line: LineEntity = { kind: 'line', id: 'l', layer: '0', start: { x: 1, y: 1 }, end: { x: 4, y: 5 } };
const set = (e: Entity, label: string, v: number) => propertySetter(e, label)!.set(v);

describe('propertySetter for a line', () => {
  it('end coordinates move only that end', () => {
    expect(set(line, 'End X', 2.5)).toEqual({ ...line, end: { x: 2.5, y: 5 } });
    expect(set(line, 'Start Y', -1)).toEqual({ ...line, start: { x: 1, y: -1 } });
  });

  it('Length keeps the start and angle; exact along an axis', () => {
    const vertical: LineEntity = { ...line, end: { x: 1, y: 3 } };
    expect(set(vertical, 'Length', 0.375)).toEqual({ ...line, end: { x: 1, y: 1.375 } });
    const l = set(line, 'Length', 10) as LineEntity; // 3-4-5 direction
    expect(l.end.x).toBeCloseTo(7, 14);
    expect(l.end.y).toBeCloseTo(9, 14);
  });

  it('Angle keeps the start and length', () => {
    expect(set(line, 'Angle', 90)).toEqual({ ...line, end: { x: 1, y: 6 } });
  });

  it('ΔX and ΔY are measured from the start', () => {
    expect(set(line, 'ΔX', -2)).toEqual({ ...line, end: { x: -1, y: 5 } });
  });

  it('refuses zero length, and has no setter for read-only rows', () => {
    expect(set(line, 'Length', 0)).toBeUndefined();
    const flat: LineEntity = { ...line, end: { x: 4, y: 1 } };
    expect(set(flat, 'End X', 1)).toBeUndefined(); // would land on the start
    expect(propertySetter(line, 'Layer')).toBeUndefined();
  });

  it('reads lengths and angles as such', () => {
    expect(propertySetter(line, 'Length')!.quantity).toBe('length');
    expect(propertySetter(line, 'Angle')!.quantity).toBe('angle');
  });
});

describe('propertySetter for circles and arcs', () => {
  const circle: CircleEntity = { kind: 'circle', id: 'c', layer: '0', center: { x: 0, y: 0 }, radius: 1 };
  const arc: ArcEntity = { kind: 'arc', id: 'a', layer: '0', center: { x: 0, y: 0 }, radius: 2, startDeg: 30, endDeg: 90 };

  it('a circle Diameter and Circumference set the radius; zero is refused', () => {
    expect(set(circle, 'Diameter', 0.501)).toEqual({ ...circle, radius: 0.2505 });
    expect((set(circle, 'Circumference', Math.PI) as CircleEntity).radius).toBe(0.5);
    expect(set(circle, 'Radius', 0)).toBeUndefined();
  });

  it('arc Included angle and Arc length keep the start angle', () => {
    expect(set(arc, 'Included angle', 120)).toEqual({ ...arc, endDeg: 150 });
    expect((set(arc, 'Arc length', Math.PI) as ArcEntity).endDeg).toBeCloseTo(120, 12); // π/2 rad = 90°
  });

  it('arc angles wrap into [0, 360) and a full turn is refused', () => {
    expect(set(arc, 'End angle', -30)).toEqual({ ...arc, endDeg: 330 });
    expect(set(arc, 'Included angle', 360)).toBeUndefined();
    expect(set(arc, 'End angle', 30)).toBeUndefined();
  });
});

describe('withLayer and withStyle', () => {
  it('change the layer, and set or clear the entity style', () => {
    expect(withLayer(line, 'Profile').layer).toBe('Profile');
    expect(withStyle(line, 'hidden').style).toBe('hidden');
    expect('style' in withStyle({ ...line, style: 'hidden' }, undefined)).toBe(false);
  });
});

describe('withStyle on a dimension', () => {
  it('leaves it alone: dimensions always draw thin', () => {
    const d: Entity = { kind: 'dimension', id: 'd', layer: '0', dimStyle: 'INCH-3PL', type: 'aligned', p1: { x: 0, y: 0 }, p2: { x: 1, y: 0 }, at: { x: 0, y: 1 } };
    expect(withStyle(d, 'hidden')).toBe(d);
  });
});

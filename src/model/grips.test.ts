import { describe, expect, it } from 'vitest';
import { arcEnd, arcStart } from '../geometry/arc';
import { TOL } from '../geometry/tolerance';
import { distance } from '../geometry/vec';
import type { ArcEntity, CircleEntity, Entity, LineEntity } from './entity';
import { applyGrip, gripsFor } from './grips';

const line: LineEntity = { kind: 'line', id: 'l', layer: '0', start: { x: 0, y: 0 }, end: { x: 2, y: 0 } };
const circle: CircleEntity = { kind: 'circle', id: 'c', layer: '0', center: { x: 1, y: 1 }, radius: 0.5 };
const arc: ArcEntity = { kind: 'arc', id: 'a', layer: '0', center: { x: 0, y: 0 }, radius: 1, startDeg: 0, endDeg: 90 };

const grip = (e: Entity, key: string) => gripsFor(e).find((g) => g.key === key)!;

describe('gripsFor', () => {
  it('a line has its ends and its midpoint', () => {
    expect(gripsFor(line)).toEqual([
      { key: 'start', at: { x: 0, y: 0 } },
      { key: 'move', at: { x: 1, y: 0 } },
      { key: 'end', at: { x: 2, y: 0 } },
    ]);
  });

  it('a circle has its center and four quadrants; an arc its center, ends and midpoint', () => {
    expect(gripsFor(circle).map((g) => g.key)).toEqual(['move', 'quad0', 'quad90', 'quad180', 'quad270']);
    expect(grip(circle, 'quad90').at).toEqual({ x: 1, y: 1.5 });
    expect(gripsFor(arc).map((g) => g.key)).toEqual(['move', 'start', 'mid', 'end']);
  });
});

describe('applyGrip', () => {
  it('a line end stretches; the other end stays exactly', () => {
    expect(applyGrip(line, 'end', line.end, { x: 3, y: 1.5 })).toEqual({ ...line, end: { x: 3, y: 1.5 } });
  });

  it('a line midpoint moves the whole line by the drag', () => {
    expect(applyGrip(line, 'move', { x: 1, y: 0 }, { x: 1.5, y: 2 })).toEqual({ ...line, start: { x: 0.5, y: 2 }, end: { x: 2.5, y: 2 } });
  });

  it('refuses a line end dropped on the other end', () => {
    expect(applyGrip(line, 'end', line.end, line.start)).toBeUndefined();
  });

  it('a circle quadrant sets the radius; the center moves the circle', () => {
    expect(applyGrip(circle, 'quad0', { x: 1.5, y: 1 }, { x: 1, y: 2.25 })).toEqual({ ...circle, radius: 1.25 });
    expect(applyGrip(circle, 'move', circle.center, { x: 3, y: 4 })).toEqual({ ...circle, center: { x: 3, y: 4 } });
    expect(applyGrip(circle, 'quad0', { x: 1.5, y: 1 }, circle.center)).toBeUndefined();
  });

  it('an arc end slides along the circle: center and radius stay, the angle follows the cursor', () => {
    const a = applyGrip(arc, 'end', arcEnd(arc), { x: -3, y: 0.0 }) as ArcEntity; // dragged well outside
    expect(a).toEqual({ ...arc, endDeg: 180 });
  });

  it('an arc midpoint changes the radius and keeps both ends, within TOL', () => {
    const a = applyGrip(arc, 'mid', grip(arc, 'mid').at, { x: 0.9, y: 0.9 }) as ArcEntity;
    expect(a.radius).not.toBeCloseTo(1, 3);
    expect(distance(arcStart(a), { x: 1, y: 0 })).toBeLessThanOrEqual(TOL);
    expect(distance(arcEnd(a), { x: 0, y: 1 })).toBeLessThanOrEqual(TOL);
    expect(Math.abs(distance(a.center, { x: 0.9, y: 0.9 }) - a.radius)).toBeLessThanOrEqual(TOL);
  });

  it('an arc midpoint dragged across the chord gives the arc through that point', () => {
    const a = applyGrip(arc, 'mid', grip(arc, 'mid').at, { x: 0.3, y: 0.3 }) as ArcEntity;
    // still through both original ends and the dropped point
    for (const p of [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 0.3, y: 0.3 }]) {
      expect(Math.abs(distance(a.center, p) - a.radius)).toBeLessThanOrEqual(TOL);
    }
    const midDeg = (Math.atan2(0.3 - a.center.y, 0.3 - a.center.x) * 180) / Math.PI;
    const ccw = (from: number, to: number) => (((to - from) % 360) + 360) % 360;
    expect(ccw(a.startDeg, midDeg)).toBeLessThan(ccw(a.startDeg, a.endDeg));
  });

  it('refuses an arc whose midpoint is dragged onto the chord', () => {
    expect(applyGrip(arc, 'mid', grip(arc, 'mid').at, { x: 0.5, y: 0.5 })).toBeUndefined();
  });
});

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { TOL } from '../geometry/tolerance';
import { angleDeg } from '../geometry/angle';
import { fieldValue, fieldsFor, resolvePoint, track } from './pointInput';

const free = { ortho: false, polar: false, polarIncrementDeg: 15 };
const polar15 = { ortho: false, polar: true, polarIncrementDeg: 15 };
const ortho = { ortho: true, polar: false, polarIncrementDeg: 15 };
const base = { x: 1, y: 2 };

describe('fieldsFor', () => {
  it('asks for X and Y with no base point, whatever the mode', () => {
    expect(fieldsFor(undefined, 'polar')).toEqual(['x', 'y']);
  });

  it('asks for length/angle, dX/dY or X/Y after a base point', () => {
    expect(fieldsFor(base, 'polar')).toEqual(['length', 'angle']);
    expect(fieldsFor(base, 'delta')).toEqual(['dx', 'dy']);
    expect(fieldsFor(base, 'absolute')).toEqual(['x', 'y']);
  });
});

describe('resolvePoint without a base point', () => {
  it('follows the cursor when nothing is locked', () => {
    expect(resolvePoint({ x: 0.3, y: 0.4 }, undefined, 'polar', {}, polar15)).toEqual({ x: 0.3, y: 0.4 });
  });

  it('replaces locked X or Y and keeps the other from the cursor', () => {
    expect(resolvePoint({ x: 0.3, y: 0.4 }, undefined, 'polar', { x: 0.25 }, free)).toEqual({ x: 0.25, y: 0.4 });
    expect(resolvePoint({ x: 0.3, y: 0.4 }, undefined, 'polar', { x: 0, y: 0 }, free)).toEqual({ x: 0, y: 0 });
  });
});

describe('resolvePoint in polar mode', () => {
  it('locked length and angle give the exact point', () => {
    const p = resolvePoint({ x: 9, y: 9 }, base, 'polar', { length: 1.25, angle: 30 }, free);
    expect(p.x).toBe(1 + 1.25 * Math.cos(Math.PI / 6));
    expect(p.y).toBe(2 + 1.25 * Math.sin(Math.PI / 6));
  });

  it('a locked 90° segment keeps exactly the base X', () => {
    expect(resolvePoint({ x: 5, y: 5 }, base, 'polar', { length: 0.375, angle: 90 }, free)).toEqual({ x: 1, y: 2.375 });
  });

  it('locked length alone follows the cursor direction', () => {
    const p = resolvePoint({ x: 4, y: 6 }, base, 'polar', { length: 2.5 }, free); // cursor direction (3,4)/5
    expect(p.x).toBeCloseTo(1 + 1.5, 15);
    expect(p.y).toBeCloseTo(2 + 2, 15);
  });

  it('locked length with the cursor on the base point goes along +X', () => {
    expect(resolvePoint(base, base, 'polar', { length: 2 }, free)).toEqual({ x: 3, y: 2 });
  });

  it('locked angle alone takes the cursor projection onto that ray, never behind the base', () => {
    expect(resolvePoint({ x: 3, y: 5 }, base, 'polar', { angle: 0 }, free)).toEqual({ x: 3, y: 2 });
    expect(resolvePoint({ x: -3, y: 5 }, base, 'polar', { angle: 0 }, free)).toEqual({ x: 1, y: 2 });
  });

  it('property: with length and angle locked, the result is exactly that far from the base', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1e-4, max: 100, noNaN: true }),
        fc.double({ min: -720, max: 720, noNaN: true }),
        (length, angle) => {
          const p = resolvePoint({ x: 0, y: 0 }, base, 'polar', { length, angle }, polar15);
          expect(Math.abs(Math.hypot(p.x - base.x, p.y - base.y) - length)).toBeLessThanOrEqual(TOL);
        },
      ),
    );
  });
});

describe('resolvePoint in delta and absolute modes', () => {
  it('delta adds locked dX/dY to the base, cursor fills the rest', () => {
    expect(resolvePoint({ x: 9, y: 9 }, base, 'delta', { dx: 0.5, dy: -0.25 }, free)).toEqual({ x: 1.5, y: 1.75 });
    expect(resolvePoint({ x: 9, y: 2.5 }, base, 'delta', { dx: 0.5 }, free)).toEqual({ x: 1.5, y: 2.5 });
  });

  it('absolute ignores the base', () => {
    expect(resolvePoint({ x: 9, y: 9 }, base, 'absolute', { x: 0.1, y: 0.2 }, free)).toEqual({ x: 0.1, y: 0.2 });
  });
});

describe('track (Ortho and polar tracking)', () => {
  it('Ortho keeps the larger of the horizontal and vertical moves', () => {
    expect(track(base, { x: 3, y: 2.5 }, ortho)).toEqual({ x: 3, y: 2 });
    expect(track(base, { x: 1.2, y: -1 }, ortho)).toEqual({ x: 1, y: -1 });
  });

  it('Ortho wins over polar tracking when both are on', () => {
    // 47.7° from the base: polar alone would snap to 45°, Ortho makes it vertical.
    expect(track(base, { x: 2, y: 3.1 }, { ortho: true, polar: true, polarIncrementDeg: 45 })).toEqual({ x: 1, y: 3.1 });
  });

  it('polar tracking catches an angle within 3° of an increment and projects onto it', () => {
    // 2° above +X: snaps to 0°, keeping the projection 2*cos(2°)
    const a = (2 * Math.PI) / 180;
    const p = track(base, { x: 1 + 2 * Math.cos(a), y: 2 + 2 * Math.sin(a) }, polar15);
    expect(p.y).toBe(2);
    expect(p.x).toBeCloseTo(1 + 2 * Math.cos(a), 12);
  });

  it('polar tracking leaves the cursor alone between increments', () => {
    const c = { x: 1 + Math.cos((7 * Math.PI) / 180), y: 2 + Math.sin((7 * Math.PI) / 180) };
    expect(track(base, c, polar15)).toBe(c);
  });

  it('polar tracking catches just below 360° as 0°', () => {
    const a = (-1 * Math.PI) / 180;
    expect(track(base, { x: 1 + Math.cos(a), y: 2 + Math.sin(a) }, polar15).y).toBe(2);
  });

  it('polar tracking applies inside resolvePoint so an untyped segment snaps to 45°', () => {
    const near45 = { x: 1 + Math.cos((46 * Math.PI) / 180), y: 2 + Math.sin((46 * Math.PI) / 180) };
    const p = resolvePoint(near45, base, 'polar', {}, polar15);
    expect(angleDeg({ x: p.x - base.x, y: p.y - base.y })).toBeCloseTo(45, 10);
  });
});

describe('fieldValue', () => {
  it('shows the live value each box would lock', () => {
    const p = { x: 4, y: 6 };
    expect(fieldValue('x', p, base)).toBe(4);
    expect(fieldValue('dx', p, base)).toBe(3);
    expect(fieldValue('dy', p, base)).toBe(4);
    expect(fieldValue('length', p, base)).toBe(5);
    expect(fieldValue('angle', { x: 1, y: 3 }, base)).toBe(90);
  });
});

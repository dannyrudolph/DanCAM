import { describe, expect, it } from 'vitest';
import { angleDeg, ccwDeg, cosSinDeg, normDeg } from './angle';

describe('cosSinDeg', () => {
  it('is exact at multiples of 90°, including negative and over 360', () => {
    expect(cosSinDeg(0)).toEqual([1, 0]);
    expect(cosSinDeg(90)).toEqual([0, 1]);
    expect(cosSinDeg(180)).toEqual([-1, 0]);
    expect(cosSinDeg(270)).toEqual([0, -1]);
    expect(cosSinDeg(-90)).toEqual([0, -1]);
    expect(cosSinDeg(450)).toEqual([0, 1]);
  });

  it('matches Math.cos/sin elsewhere', () => {
    const [c, s] = cosSinDeg(30);
    expect(c).toBe(Math.cos(Math.PI / 6));
    expect(s).toBe(Math.sin(Math.PI / 6));
  });
});

describe('angleDeg', () => {
  it('is counter-clockwise from +X in [0, 360)', () => {
    expect(angleDeg({ x: 1, y: 0 })).toBe(0);
    expect(angleDeg({ x: 0, y: 1 })).toBe(90);
    expect(angleDeg({ x: -1, y: 0 })).toBe(180);
    expect(angleDeg({ x: 0, y: -1 })).toBe(270);
    expect(angleDeg({ x: 1, y: -1 })).toBe(315);
  });
});

describe('angleDeg on axis-aligned vectors', () => {
  it('is exactly 90 or 270 for any vertical vector, where atan2 alone could drift', () => {
    expect(angleDeg({ x: 0, y: 3.7 })).toBe(90);
    expect(angleDeg({ x: 0, y: -1e-12 })).toBe(270);
    expect(angleDeg({ x: -0, y: 2 })).toBe(90);
  });
});

describe('normDeg and ccwDeg', () => {
  it('wraps into [0, 360) and never returns -0 or 360', () => {
    expect(normDeg(-90)).toBe(270);
    expect(normDeg(720)).toBe(0);
    expect(Object.is(normDeg(-360), 0)).toBe(true);
    expect(normDeg(359.5)).toBe(359.5);
  });

  it('measures counter-clockwise, across 0°', () => {
    expect(ccwDeg(350, 10)).toBe(20);
    expect(ccwDeg(10, 350)).toBe(340);
    expect(ccwDeg(90, 90)).toBe(0);
  });
});

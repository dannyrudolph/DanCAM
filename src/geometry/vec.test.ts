import { describe, expect, it } from 'vitest';
import { add, cross, distance, dot, length, scale, sub, vec, vecNearlyEqual } from './vec';

describe('vectors', () => {
  it('add, sub and scale give exact componentwise results', () => {
    expect(add(vec(1, 2), vec(0.25, -3))).toEqual({ x: 1.25, y: -1 });
    expect(sub(vec(1, 2), vec(0.25, -3))).toEqual({ x: 0.75, y: 5 });
    expect(scale(vec(0.5, -2), 4)).toEqual({ x: 2, y: -8 });
  });

  it('dot is zero for perpendicular vectors; cross is positive counter-clockwise', () => {
    expect(dot(vec(3, 4), vec(-4, 3))).toBe(0);
    expect(dot(vec(3, 4), vec(3, 4))).toBe(25);
    expect(cross(vec(1, 0), vec(0, 1))).toBe(1);
    expect(cross(vec(0, 1), vec(1, 0))).toBe(-1);
  });

  it('length and distance use the 3-4-5 triangle exactly', () => {
    expect(length(vec(3, 4))).toBe(5);
    expect(distance(vec(1, 1), vec(4, 5))).toBe(5);
  });

  it('vecNearlyEqual compares both components against the shared tolerance', () => {
    expect(vecNearlyEqual(vec(1, 2), vec(1 + 5e-10, 2 - 5e-10))).toBe(true);
    expect(vecNearlyEqual(vec(1, 2), vec(1, 2 + 1e-8))).toBe(false);
  });
});

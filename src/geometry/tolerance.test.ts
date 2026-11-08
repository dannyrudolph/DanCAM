import { describe, expect, it } from 'vitest';
import { TOL, nearlyEqual, nearlyZero } from './tolerance';

describe('shared tolerance', () => {
  it('is 1e-9 drawing units', () => {
    expect(TOL).toBe(1e-9);
  });

  it('treats values exactly TOL apart as equal and values further apart as different', () => {
    expect(nearlyEqual(1, 1 + 0.5e-9)).toBe(true);
    expect(nearlyEqual(0, TOL)).toBe(true);
    expect(nearlyEqual(0, 2e-9)).toBe(false);
    expect(nearlyEqual(0.25, 0.250000002)).toBe(false);
  });

  it('is absolute, so it does not loosen for large coordinates', () => {
    expect(nearlyEqual(1000, 1000 + 1e-6)).toBe(false);
  });

  it('accepts an explicit tolerance for callers that need a coarser one', () => {
    expect(nearlyEqual(1, 1.001, 0.01)).toBe(true);
    expect(nearlyZero(-0.5e-9)).toBe(true);
    expect(nearlyZero(-2e-9)).toBe(false);
  });
});

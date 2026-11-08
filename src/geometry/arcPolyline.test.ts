import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { arcScreenPieces, maxStep } from './arcPolyline';

const box = { minX: 0, minY: 0, maxX: 1000, maxY: 800 };
const ERR = 0.25;
const TWO_PI = 2 * Math.PI;

function onCircle(c: { x: number; y: number }, r: number, p: { x: number; y: number }): number {
  return Math.abs(Math.hypot(p.x - c.x, p.y - c.y) - r);
}

describe('arcScreenPieces', () => {
  it('draws a fully visible circle as one closed piece', () => {
    const c = { x: 500, y: 400 };
    const pieces = arcScreenPieces(c, 100, 0, TWO_PI, box, ERR);
    expect(pieces).toHaveLength(1);
    const pts = pieces[0]!.points;
    expect(pts[0]!.x).toBeCloseTo(600, 9);
    expect(pts.at(-1)!.x).toBeCloseTo(600, 9);
    expect(pts.at(-1)!.y).toBeCloseTo(400, 9);
    expect(pieces[0]!.startOffsetPx).toBe(0);
  });

  it('maps world CCW to screen with Y down: a 0–90° arc goes up from the right', () => {
    const [p] = arcScreenPieces({ x: 500, y: 400 }, 100, 0, Math.PI / 2, box, ERR);
    expect(p!.points[0]!.x).toBeCloseTo(600, 9);
    expect(p!.points.at(-1)!.y).toBeCloseTo(300, 9);
  });

  it('returns nothing for a circle off screen or one that surrounds the screen', () => {
    expect(arcScreenPieces({ x: -500, y: 400 }, 100, 0, TWO_PI, box, ERR)).toEqual([]);
    expect(arcScreenPieces({ x: 500, y: 400 }, 1e6, 0, TWO_PI, box, ERR)).toEqual([]);
  });

  it('keeps only the visible part, with its arc-length offset from the start', () => {
    // Circle centered on the left edge: only the right half (−90°..90°) is visible.
    const pieces = arcScreenPieces({ x: 0, y: 400 }, 100, 0, TWO_PI, box, ERR);
    expect(pieces).toHaveLength(1);
    for (const q of pieces[0]!.points) expect(q.x).toBeGreaterThanOrEqual(-1e-9);
    // The visible stretch wraps through 0°, so it starts at 270° (3π/2 · r).
    expect(pieces[0]!.startOffsetPx).toBeCloseTo(1.5 * Math.PI * 100, 9);
  });

  it('stays to a few segments at extreme zoom', () => {
    // A 1-unit arc at 1e9 px/unit whose edge passes through the screen.
    const r = 1e9;
    const pieces = arcScreenPieces({ x: 500 - r, y: 400 }, r, -0.001, 0.002, box, ERR);
    expect(pieces).toHaveLength(1);
    const pts = pieces[0]!.points;
    expect(pts.length).toBeLessThan(10);
    for (const q of pts) expect(q.y).toBeGreaterThanOrEqual(-1e-6);
    for (const q of pts) expect(q.y).toBeLessThanOrEqual(800 + 1e-6);
  });

  it('keeps every vertex on the arc and every chord within the error', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -500, max: 1500, noNaN: true }),
        fc.double({ min: -500, max: 1300, noNaN: true }),
        fc.double({ min: 1, max: 5000, noNaN: true }),
        fc.double({ min: 0, max: TWO_PI, noNaN: true }),
        fc.double({ min: 0.01, max: TWO_PI, noNaN: true }),
        (cx, cy, r, start, sweep) => {
          const c = { x: cx, y: cy };
          for (const piece of arcScreenPieces(c, r, start, sweep, box, ERR)) {
            const pts = piece.points;
            for (const p of pts) expect(onCircle(c, r, p)).toBeLessThan(1e-9 * r);
            for (let i = 0; i + 1 < pts.length; i++) {
              const a = pts[i]!;
              const b = pts[i + 1]!;
              const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
              expect(onCircle(c, r, mid)).toBeLessThanOrEqual(ERR + 1e-9 * r);
            }
          }
        },
      ),
    );
  });
});

describe('maxStep', () => {
  it('is the chord angle with sagitta equal to the error', () => {
    const r = 100;
    const step = maxStep(r, 0.25);
    expect(r * (1 - Math.cos(step / 2))).toBeCloseTo(0.25, 12);
  });
});

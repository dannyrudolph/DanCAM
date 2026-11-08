import type { BBox } from './bbox';
import type { Vec2 } from './vec';

/** One visible stretch of an arc, ready to stroke. */
export type ArcPiece = {
  readonly points: readonly Vec2[];
  /** Arc length in pixels from the arc's start to this piece's first point, for anchoring dashes. */
  readonly startOffsetPx: number;
};

const TWO_PI = 2 * Math.PI;

/**
 * Splits an arc into screen-space polylines covering only the parts inside
 * `box`, with chord error at most `maxErrPx`.
 *
 * Works in screen pixels so the segment count depends on what is visible,
 * not on the zoom: a 1" radius seen at 1e9 px/unit still becomes a handful of
 * segments, and the canvas never receives far-away coordinates. Screen Y
 * points down, so the world angle θ maps to (cx + r·cos θ, cy − r·sin θ).
 *
 * `center` is in screen pixels, `startRad`/`sweepRad` are world angles
 * (counter-clockwise). A sweep of 2π is a full circle.
 */
export function arcScreenPieces(
  center: Vec2,
  radiusPx: number,
  startRad: number,
  sweepRad: number,
  box: BBox,
  maxErrPx: number,
): ArcPiece[] {
  if (!(radiusPx > 0) || !(sweepRad > 0)) return [];
  // Whole circle off screen?
  if (
    center.x + radiusPx < box.minX ||
    center.x - radiusPx > box.maxX ||
    center.y + radiusPx < box.minY ||
    center.y - radiusPx > box.maxY
  ) {
    return [];
  }

  const at = (u: number): Vec2 => ({
    x: center.x + radiusPx * Math.cos(startRad + u),
    y: center.y - radiusPx * Math.sin(startRad + u),
  });
  const inside = (p: Vec2) => p.x >= box.minX && p.x <= box.maxX && p.y >= box.minY && p.y <= box.maxY;
  const rel = (theta: number) => (((theta - startRad) % TWO_PI) + TWO_PI) % TWO_PI;

  // Parameters (relative to the start) where the circle crosses a box edge.
  const cuts = [0, sweepRad];
  const addCut = (theta: number) => {
    const u = rel(theta);
    if (u > 0 && u < sweepRad) cuts.push(u);
  };
  for (const x of [box.minX, box.maxX]) {
    const c = (x - center.x) / radiusPx;
    if (Math.abs(c) <= 1) {
      const t = Math.acos(c);
      addCut(t);
      addCut(-t);
    }
  }
  for (const y of [box.minY, box.maxY]) {
    const s = (center.y - y) / radiusPx;
    if (Math.abs(s) <= 1) {
      const t = Math.asin(s);
      addCut(t);
      addCut(Math.PI - t);
    }
  }
  cuts.sort((a, b) => a - b);

  // Visible intervals, merged where they touch.
  const spans: [number, number][] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const u0 = cuts[i]!;
    const u1 = cuts[i + 1]!;
    if (u1 <= u0 || !inside(at((u0 + u1) / 2))) continue;
    const last = spans.at(-1);
    if (last && last[1] === u0) last[1] = u1;
    else spans.push([u0, u1]);
  }
  // A full circle whose visible part wraps through the start is one stroke, not two.
  if (sweepRad >= TWO_PI && spans.length > 1 && spans[0]![0] === 0 && spans.at(-1)![1] === sweepRad) {
    const tail = spans.pop()!;
    spans[0] = [tail[0] - TWO_PI, spans[0]![1]];
  }

  const step = maxStep(radiusPx, maxErrPx);
  return spans.map(([u0, u1]) => {
    const n = Math.max(1, Math.ceil((u1 - u0) / step));
    const points: Vec2[] = [];
    for (let i = 0; i <= n; i++) points.push(at(u0 + ((u1 - u0) * i) / n));
    const offset = u0 < 0 ? u0 + TWO_PI : u0;
    return { points, startOffsetPx: radiusPx * offset };
  });
}

/** Largest angle step whose chord stays within `maxErrPx` of the arc. */
export function maxStep(radiusPx: number, maxErrPx: number): number {
  if (radiusPx <= maxErrPx) return Math.PI / 2;
  return Math.min(Math.PI / 2, 2 * Math.acos(1 - maxErrPx / radiusPx));
}

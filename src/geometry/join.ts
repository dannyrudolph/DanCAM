import { arcEnd, arcStart, arcSweepDeg } from './arc';
import { ccwDeg } from './angle';
import type { Curve } from './curve';
import { distanceToLine } from './distance';
import { TOL } from './tolerance';
import { type Vec2, dot, sub, vecNearlyEqual } from './vec';

/**
 * One curve from two: collinear segments into the segment spanning both
 * (any gap between them is bridged), arcs on the same circle into the arc
 * running counter-clockwise from `a`'s start through `b` (a full circle when
 * they cover it all). Undefined for anything else.
 */
export function joinCurves(a: Curve, b: Curve): Curve | undefined {
  if (a.kind === 'segment' && b.kind === 'segment') {
    if (distanceToLine(b.a, a.a, a.b) > TOL || distanceToLine(b.b, a.a, a.b) > TOL) return undefined;
    // The two points farthest apart along a's direction, keeping a's direction.
    const d = sub(a.b, a.a);
    const at = (p: Vec2): number => dot(sub(p, a.a), d);
    const pts = [a.a, a.b, b.a, b.b];
    const lo = pts.reduce((m, p) => (at(p) < at(m) ? p : m));
    const hi = pts.reduce((m, p) => (at(p) > at(m) ? p : m));
    return { kind: 'segment', a: lo, b: hi };
  }
  if (a.kind === 'arc' && b.kind === 'arc') {
    if (!vecNearlyEqual(a.center, b.center) || Math.abs(a.radius - b.radius) > TOL) return undefined;
    const sweepA = arcSweepDeg(a);
    const reach = ccwDeg(a.startDeg, b.startDeg) + arcSweepDeg(b);
    const whole: Curve = { kind: 'circle', center: a.center, radius: a.radius };
    if (reach >= 360) return whole; // b runs on past a's start
    const joined: Curve = reach > sweepA ? { ...a, endDeg: b.endDeg } : a;
    return vecNearlyEqual(arcEnd(joined), arcStart(joined)) ? whole : joined;
  }
  return undefined;
}

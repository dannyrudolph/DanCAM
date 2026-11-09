import { arcEnd, arcStart, arcSweepDeg } from './arc';
import { ccwDeg } from './angle';
import { angleFrom } from './circle';
import { type Curve, intersectCurves, nearestOnCurve } from './curve';
import { TOL } from './tolerance';
import { type Vec2, distance, dot, scale, sub } from './vec';

/**
 * Extends the end of `c` nearer `pick` to the first boundary it reaches.
 * Segments and rays extend along their line (a ray only at its base); arcs
 * run on along their circle. An end already on a boundary (within TOL) goes
 * on to the next one, so picking again extends further. The new end is the
 * intersection point itself. Undefined for xlines and circles, or when no
 * boundary lies ahead.
 */
export function extendCurve(c: Curve, boundaries: readonly Curve[], pick: Vec2): Curve | undefined {
  switch (c.kind) {
    case 'segment': {
      const on = nearestOnCurve(c, pick);
      const d = sub(c.b, c.a);
      const atStart = dot(sub(on, c.a), d) < dot(d, d) / 2;
      const end = atStart ? c.a : c.b;
      const hit = firstAhead(end, atStart ? scale(d, -1) : d, boundaries);
      if (!hit) return undefined;
      return atStart ? { kind: 'segment', a: hit, b: c.b } : { kind: 'segment', a: c.a, b: hit };
    }
    case 'ray': {
      const hit = firstAhead(c.base, scale(c.dir, -1), boundaries);
      return hit && { kind: 'ray', base: hit, dir: c.dir };
    }
    case 'arc': {
      const on = nearestOnCurve(c, pick);
      const sweep = arcSweepDeg(c);
      const atStart = ccwDeg(c.startDeg, angleFrom(c.center, on)) < sweep / 2;
      const end = atStart ? arcStart(c) : arcEnd(c);
      const other = atStart ? arcEnd(c) : arcStart(c);
      const full: Curve = { kind: 'circle', center: c.center, radius: c.radius };
      // How far past the end, in degrees, travelling away from the arc.
      const beyond = (p: Vec2): number => {
        const deg = angleFrom(c.center, p);
        return atStart ? ccwDeg(deg, c.startDeg) : ccwDeg(c.endDeg, deg);
      };
      let best: Vec2 | undefined;
      for (const b of boundaries) {
        for (const p of intersectCurves(full, b)) {
          if (distance(p, end) <= TOL || distance(p, other) <= TOL) continue;
          if (beyond(p) >= 360 - sweep) continue; // on the arc itself
          if (!best || beyond(p) < beyond(best)) best = p;
        }
      }
      if (!best) return undefined;
      const deg = angleFrom(c.center, best);
      return { kind: 'arc', center: c.center, radius: c.radius, startDeg: atStart ? deg : c.startDeg, endDeg: atStart ? c.endDeg : deg };
    }
    default:
      return undefined;
  }
}

/** The nearest boundary point on the ray from `from` along `dir`, more than TOL away. */
function firstAhead(from: Vec2, dir: Vec2, boundaries: readonly Curve[]): Vec2 | undefined {
  const ray: Curve = { kind: 'ray', base: from, dir };
  let best: Vec2 | undefined;
  for (const b of boundaries) {
    for (const p of intersectCurves(ray, b)) {
      if (distance(p, from) <= TOL) continue;
      if (!best || distance(p, from) < distance(best, from)) best = p;
    }
  }
  return best;
}

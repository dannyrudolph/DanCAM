import { arcEnd, arcLength, arcStart } from './arc';
import { normDeg } from './angle';
import { type Curve, nearestOnCurve } from './curve';
import { TOL } from './tolerance';
import { type Vec2, add, distance, scale, sub } from './vec';

/** How Lengthen sizes an object: add a length (negative shortens), set the total, or scale by a percent. */
export type LengthenSpec = { readonly kind: 'delta' | 'total' | 'percent'; readonly value: number };

/** The length a line or arc of length `len` gets. */
export function lengthenedLength(len: number, spec: LengthenSpec): number {
  return spec.kind === 'delta' ? len + spec.value : spec.kind === 'total' ? spec.value : (len * spec.value) / 100;
}

/**
 * The segment or arc with the end nearer `pick` moved so its length is
 * `lengthenedLength`; the other end stays put. Undefined for other curves,
 * or when the new length would be TOL or less (or an arc a full turn or more).
 */
export function lengthenCurve(c: Curve, pick: Vec2, spec: LengthenSpec): Curve | undefined {
  if (c.kind === 'segment') {
    const len = distance(c.a, c.b);
    const target = lengthenedLength(len, spec);
    if (target <= TOL) return undefined;
    const on = nearestOnCurve(c, pick);
    const movesB = distance(on, c.b) <= distance(on, c.a);
    const [fixed, moving] = movesB ? [c.a, c.b] : [c.b, c.a];
    const u = scale(sub(moving, fixed), 1 / len);
    const end = add(fixed, scale(u, target));
    // Keep the coordinate a horizontal or vertical line doesn't move along.
    const exact = { x: u.x === 0 ? fixed.x : end.x, y: u.y === 0 ? fixed.y : end.y };
    return movesB ? { kind: 'segment', a: c.a, b: exact } : { kind: 'segment', a: exact, b: c.b };
  }
  if (c.kind === 'arc') {
    const target = lengthenedLength(arcLength(c), spec);
    const sweep = (target / c.radius) * (180 / Math.PI);
    if (target <= TOL || sweep >= 360) return undefined;
    const on = nearestOnCurve(c, pick);
    const movesEnd = distance(on, arcEnd(c)) <= distance(on, arcStart(c));
    if (movesEnd) return { ...c, endDeg: normDeg(c.startDeg + sweep) };
    return { ...c, startDeg: normDeg(c.endDeg - sweep) };
  }
  return undefined;
}


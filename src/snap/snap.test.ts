import { describe, expect, it } from 'vitest';
import { TOL } from '../geometry/tolerance';
import { type Vec2, distance, dot, sub } from '../geometry/vec';
import { type Drawing, createDrawing } from '../model/drawing';
import type { Entity } from '../model/entity';
import { DEFAULT_SNAP_KINDS, SNAP_KINDS, type SnapKind, findSnap } from './snap';

const ALL: ReadonlySet<SnapKind> = new Set(SNAP_KINDS);
const DEFAULTS: ReadonlySet<SnapKind> = new Set(DEFAULT_SNAP_KINDS);
const only = (...k: SnapKind[]): ReadonlySet<SnapKind> => new Set(k);
const AP = 0.1;

type Shape = Entity extends infer E ? (E extends Entity ? Omit<E, 'id' | 'layer'> : never) : never;

function drawing(...shapes: Shape[]): Drawing {
  const d = createDrawing('in');
  shapes.forEach((s, i) => d.entities.set(`e${i}`, { ...s, id: `e${i}`, layer: '0' } as Entity));
  return d;
}

const line = (a: Vec2, b: Vec2): Shape => ({ kind: 'line', start: a, end: b });
const circle = (center: Vec2, radius: number): Shape => ({ kind: 'circle', center, radius });
const arc = (center: Vec2, radius: number, startDeg: number, endDeg: number): Shape => ({
  kind: 'arc',
  center,
  radius,
  startDeg,
  endDeg,
});

describe('findSnap point snaps', () => {
  it('takes the endpoint and midpoint of a line exactly', () => {
    const d = drawing(line({ x: 0, y: 0 }, { x: 2, y: 1 }));
    expect(findSnap(d, { x: 1.97, y: 1.02 }, AP, DEFAULTS)).toEqual({ kind: 'end', at: { x: 2, y: 1 }, on: { id: 'e0', feature: 'end' } });
    expect(findSnap(d, { x: 1.03, y: 0.48 }, AP, DEFAULTS)).toEqual({ kind: 'mid', at: { x: 1, y: 0.5 }, on: { id: 'e0', feature: 'mid' } });
  });

  it('takes arc ends, midpoint and only the quadrants the arc passes', () => {
    const d = drawing(arc({ x: 0, y: 0 }, 1, 0, 90));
    expect(findSnap(d, { x: 0.02, y: 1.03 }, AP, only('end'))).toEqual({ kind: 'end', at: { x: 0, y: 1 }, on: { id: 'e0', feature: 'end' } });
    const mid = findSnap(d, { x: 0.7, y: 0.7 }, AP, only('mid'))!;
    expect(mid.kind).toBe('mid');
    expect(mid.at.x).toBeCloseTo(Math.SQRT1_2, 15);
    expect(findSnap(d, { x: 1.02, y: 0.01 }, AP, only('quad'))).toEqual({ kind: 'quad', at: { x: 1, y: 0 }, on: { id: 'e0', feature: 'quad', deg: 0 } });
    // 180° is not on this arc, even with the cursor on the arc's circle there
    expect(findSnap(d, { x: -1, y: 0 }, AP, only('quad'))).toBeUndefined();
  });

  it('takes a circle quadrant exactly', () => {
    const d = drawing(circle({ x: 1, y: 1 }, 0.5));
    expect(findSnap(d, { x: 1.01, y: 0.52 }, AP, DEFAULTS)).toEqual({ kind: 'quad', at: { x: 1, y: 0.5 }, on: { id: 'e0', feature: 'quad', deg: 270 } });
  });

  it('takes a node on a point entity, and the start of a ray as its endpoint', () => {
    const d = drawing({ kind: 'point', at: { x: 3, y: 3 } }, { kind: 'ray', base: { x: 5, y: 0 }, dir: { x: 0, y: 1 } });
    expect(findSnap(d, { x: 3.04, y: 2.97 }, AP, DEFAULTS)).toEqual({ kind: 'node', at: { x: 3, y: 3 }, on: { id: 'e0', feature: 'node' } });
    expect(findSnap(d, { x: 5.01, y: 0.05 }, AP, DEFAULTS)).toEqual({ kind: 'end', at: { x: 5, y: 0 }, on: { id: 'e1', feature: 'start' } });
  });

  it('finds nothing outside the aperture, on a hidden layer, or for a snap that is off', () => {
    const d = drawing(line({ x: 0, y: 0 }, { x: 1, y: 0 }));
    expect(findSnap(d, { x: 1.2, y: 0 }, AP, ALL)).toBeUndefined();
    expect(findSnap(d, { x: 1.02, y: 0 }, AP, only('mid'))).toBeUndefined();
    d.layers.set('0', { ...d.layers.get('0')!, visible: false });
    expect(findSnap(d, { x: 1.02, y: 0 }, AP, ALL)).toBeUndefined();
  });
});

describe('findSnap center', () => {
  it('takes the center when the cursor is on the circle, far from the center', () => {
    const d = drawing(circle({ x: 0, y: 0 }, 1));
    expect(findSnap(d, { x: 0.6, y: 0.8 }, AP, only('cen'))).toEqual({ kind: 'cen', at: { x: 0, y: 0 }, on: { id: 'e0', feature: 'center' } });
  });

  it('takes the center when the cursor is near it, off the circle', () => {
    const d = drawing(arc({ x: 2, y: 2 }, 1, 0, 90));
    expect(findSnap(d, { x: 2.03, y: 1.98 }, AP, only('cen'))).toEqual({ kind: 'cen', at: { x: 2, y: 2 }, on: { id: 'e0', feature: 'center' } });
  });

  it('loses to a point snap within the aperture', () => {
    const d = drawing(circle({ x: 0, y: 0 }, 1));
    expect(findSnap(d, { x: 0.99, y: 0.05 }, AP, DEFAULTS)?.kind).toBe('quad');
  });
});

describe('findSnap intersection', () => {
  it('takes where two lines cross', () => {
    const d = drawing(line({ x: 0, y: 0 }, { x: 3, y: 3 }), line({ x: 0, y: 2 }, { x: 3, y: -1 }));
    expect(findSnap(d, { x: 1.03, y: 0.98 }, AP, DEFAULTS)).toEqual({ kind: 'int', at: { x: 1, y: 1 }, on: { id: 'e0', feature: 'int', other: 'e1' } });
  });

  it('ignores where the lines would cross past their ends', () => {
    const d = drawing(line({ x: 0, y: 0 }, { x: 0.95, y: 0.95 }), line({ x: 0, y: 2 }, { x: 2, y: 0 }));
    expect(findSnap(d, { x: 1, y: 1 }, AP, only('int'))).toBeUndefined();
  });

  it('a line-arc intersection lies on both, within TOL', () => {
    const d = drawing(line({ x: -2, y: 0.3 }, { x: 2, y: 0.3 }), arc({ x: 0, y: 0 }, 1, 0, 180));
    const s = findSnap(d, { x: 0.95, y: 0.32 }, AP, only('int'))!;
    expect(s.kind).toBe('int');
    expect(s.at.y).toBe(0.3);
    expect(Math.abs(distance(s.at, { x: 0, y: 0 }) - 1)).toBeLessThanOrEqual(TOL);
    expect(s.at.x).toBeGreaterThan(0); // the crossing near the cursor, not the one at -x
  });

  it('an arc-arc intersection lies on both, within TOL', () => {
    const c1 = { x: 0, y: 0 };
    const c2 = { x: 1.3, y: 0.2 };
    const d = drawing(arc(c1, 1, 0, 180), arc(c2, 0.75, 90, 270));
    const s = findSnap(d, { x: 0.65, y: 0.68 }, AP, only('int'))!;
    expect(s.kind).toBe('int');
    expect(Math.abs(distance(s.at, c1) - 1)).toBeLessThanOrEqual(TOL);
    expect(Math.abs(distance(s.at, c2) - 0.75)).toBeLessThanOrEqual(TOL);
  });

  it('an endpoint on another line counts as Endpoint, not Intersection', () => {
    const d = drawing(line({ x: 0, y: 0 }, { x: 1, y: 0 }), line({ x: 1, y: 0 }, { x: 1, y: 1 }));
    expect(findSnap(d, { x: 1.02, y: 0.02 }, AP, DEFAULTS)).toEqual({ kind: 'end', at: { x: 1, y: 0 }, on: { id: 'e0', feature: 'end' } });
  });
});

describe('findSnap ranking', () => {
  it('takes the candidate nearest the cursor', () => {
    // a short line: its end (0.1, 0) and its midpoint (0.05, 0) are both in the aperture
    const d = drawing(line({ x: 0, y: 0 }, { x: 0.1, y: 0 }));
    expect(findSnap(d, { x: 0.06, y: 0 }, AP, DEFAULTS)).toEqual({ kind: 'mid', at: { x: 0.05, y: 0 }, on: { id: 'e0', feature: 'mid' } });
    expect(findSnap(d, { x: 0.09, y: 0 }, AP, DEFAULTS)).toEqual({ kind: 'end', at: { x: 0.1, y: 0 }, on: { id: 'e0', feature: 'end' } });
  });

  it('takes Nearest only when nothing else is found', () => {
    const d = drawing(line({ x: 0, y: 0 }, { x: 4, y: 0 }));
    expect(findSnap(d, { x: 2.03, y: 0.01 }, AP, ALL)).toEqual({ kind: 'mid', at: { x: 2, y: 0 }, on: { id: 'e0', feature: 'mid' } });
    expect(findSnap(d, { x: 3, y: 0.05 }, AP, ALL)).toEqual({ kind: 'nea', at: { x: 3, y: 0 } });
  });
});

describe('findSnap perpendicular and tangent', () => {
  it('need a base point', () => {
    const d = drawing(line({ x: 0, y: 0 }, { x: 4, y: 0 }), circle({ x: 0, y: 5 }, 1));
    expect(findSnap(d, { x: 3, y: 0.02 }, AP, only('perp'))).toBeUndefined();
    expect(findSnap(d, { x: 1, y: 5 }, AP, only('tan'))).toBeUndefined();
  });

  it('Perpendicular gives the foot from the base on a hovered line, even far from the cursor', () => {
    const d = drawing(line({ x: 0, y: 0 }, { x: 4, y: 0 }));
    expect(findSnap(d, { x: 3, y: 0.02 }, AP, only('perp'), { x: 1.25, y: 2 })).toEqual({
      kind: 'perp',
      at: { x: 1.25, y: 0 },
    });
  });

  it('Perpendicular to a circle is on the diameter through the base', () => {
    const d = drawing(circle({ x: 0, y: 0 }, 1));
    expect(findSnap(d, { x: 0.02, y: 1.02 }, AP, only('perp'), { x: 0, y: 3 })).toEqual({ kind: 'perp', at: { x: 0, y: 1 } });
  });

  it('a line-arc tangent point is on the arc and square to the radius, within TOL', () => {
    const center = { x: 0, y: 0 };
    const base = { x: 3, y: 0.4 };
    const d = drawing(arc(center, 1, 0, 180));
    const s = findSnap(d, { x: 0.3, y: 0.97 }, AP, only('tan'), base)!;
    expect(s.kind).toBe('tan');
    expect(Math.abs(distance(s.at, center) - 1)).toBeLessThanOrEqual(TOL);
    expect(Math.abs(dot(sub(s.at, center), sub(base, s.at)))).toBeLessThanOrEqual(TOL);
  });

  it('of the two tangent points, takes the one nearer the cursor', () => {
    const d = drawing(circle({ x: 0, y: 0 }, 1));
    const base = { x: 3, y: 0 };
    const upper = findSnap(d, { x: -0.9, y: 0.45 }, AP, only('tan'), base)!;
    const lower = findSnap(d, { x: -0.9, y: -0.45 }, AP, only('tan'), base)!;
    expect(upper.at.y).toBeCloseTo(Math.sqrt(8) / 3, 15);
    expect(lower.at.y).toBeCloseTo(-Math.sqrt(8) / 3, 15);
  });

  it('no tangent from inside the circle', () => {
    const d = drawing(circle({ x: 0, y: 0 }, 1));
    expect(findSnap(d, { x: 1, y: 0.02 }, AP, only('tan'), { x: 0.2, y: 0 })).toBeUndefined();
  });
});

describe('findSnap deferred tangent and perpendicular', () => {
  it('with no base point and deferOk, Tangent on a circle is deferred at the point under the cursor', () => {
    const d = drawing(circle({ x: 0, y: 0 }, 1));
    const s = findSnap(d, { x: 0.6, y: 0.82 }, AP, only('tan'), undefined, true)!;
    expect(s.kind).toBe('tan');
    expect(s.deferred?.kind).toBe('tan');
    expect(s.deferred?.curve).toEqual({ kind: 'circle', center: { x: 0, y: 0 }, radius: 1 });
    expect(Math.abs(distance(s.at, { x: 0, y: 0 }) - 1)).toBeLessThanOrEqual(TOL);
    expect(s.deferred?.pick).toEqual(s.at);
  });

  it('is never deferred without deferOk, or with a base point', () => {
    const d = drawing(circle({ x: 0, y: 0 }, 1));
    expect(findSnap(d, { x: 0.6, y: 0.82 }, AP, only('tan'))).toBeUndefined();
    expect(findSnap(d, { x: 0.6, y: 0.82 }, AP, only('tan'), { x: 3, y: 0 }, true)?.deferred).toBeUndefined();
  });

  it('Perpendicular defers on a line; Tangent does not', () => {
    const d = drawing(line({ x: 0, y: 0 }, { x: 4, y: 0 }));
    expect(findSnap(d, { x: 3, y: 0.02 }, AP, only('perp'), undefined, true)).toEqual({
      kind: 'perp',
      at: { x: 3, y: 0 },
      deferred: { kind: 'perp', curve: { kind: 'segment', a: { x: 0, y: 0 }, b: { x: 4, y: 0 } }, pick: { x: 3, y: 0 } },
    });
    expect(findSnap(d, { x: 3, y: 0.02 }, AP, only('tan'), undefined, true)).toBeUndefined();
  });

  it('a nearby point snap still wins over a deferred one', () => {
    const d = drawing(circle({ x: 0, y: 0 }, 1));
    expect(findSnap(d, { x: 1.01, y: 0.03 }, AP, only('quad', 'tan'), undefined, true)).toEqual({ kind: 'quad', at: { x: 1, y: 0 }, on: { id: 'e0', feature: 'quad', deg: 0 } });
  });
});

describe('findSnap and dimensions', () => {
  it('never snaps to a dimension: it is annotation, not geometry', () => {
    const d = createDrawing('in');
    d.entities.set('d', { kind: 'dimension', id: 'd', layer: '0', dimStyle: 'INCH-3PL', type: 'linear', dir: { x: 1, y: 0 }, p1: { x: 0, y: 0 }, p2: { x: 2, y: 0 }, at: { x: 1, y: 0.5 } });
    expect(findSnap(d, { x: 0, y: 0.5 }, AP, ALL)).toBeUndefined(); // an arrow tip and the end of the dimension line
    expect(findSnap(d, { x: 0, y: 0.02 }, AP, ALL)).toBeUndefined();
  });
});

describe('lathe mode datum', () => {
  it('Center snaps to Z0 X0 within the aperture in lathe mode only, with no anchor; an endpoint there still wins', () => {
    const d = drawing();
    expect(findSnap(d, { x: 0.03, y: -0.04 }, AP, DEFAULTS)).toBeUndefined();
    d.lathe = true;
    expect(findSnap(d, { x: 0.03, y: -0.04 }, AP, DEFAULTS)).toEqual({ kind: 'cen', at: { x: 0, y: 0 } });
    expect(findSnap(d, { x: 0.3, y: 0 }, AP, DEFAULTS)).toBeUndefined();
    expect(findSnap(d, { x: 0.03, y: 0 }, AP, only('end'))).toBeUndefined();
    const withLine = drawing(line({ x: 0, y: 0 }, { x: 1, y: 0 }));
    withLine.lathe = true;
    expect(findSnap(withLine, { x: 0.01, y: 0.01 }, AP, DEFAULTS)?.kind).toBe('end');
  });
});

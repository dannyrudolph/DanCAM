import { describe, expect, it } from 'vitest';
import pinMm from '../../../test-fixtures/step/pin-mm.step?raw';
import shaft from '../../../test-fixtures/step/shaft.step?raw';
import { type ProfileCurve, curvesBox, placeProfile, shiftCurve } from '../../model/profilePlacement';
import { readStep } from './stepModel';
import { type ThreeViews, fit, threeViews } from './threeViews';
import { turnedProfile } from './turnedProfile';

function model(text: string) {
  const r = readStep(text);
  if (!r.ok) throw new Error(r.error);
  return r.model;
}

function views(text: string, flip = false, turn = 0): ThreeViews {
  const v = threeViews(model(text), 'mm', { flip, turn });
  if (!v.ok) throw new Error(v.error);
  return v.views;
}

/** Each curve as text rounded to 1e-6, its left end at x 0, sorted. */
function shape(curves: readonly ProfileCurve[]): string[] {
  const [x0] = curvesBox(curves);
  const n = (v: number): string => (Math.round(v * 1e6) / 1e6 + 0).toFixed(6);
  const p = (q: { x: number; y: number }): string => `(${n(q.x)}, ${n(q.y)})`;
  const deg = (d: number): string => n(((d % 360) + 360) % 360);
  const marks = (c: ProfileCurve): string => `${c.style ? ` ${c.style}` : ''}${c.fitted ? ' fitted' : ''}`;
  return curves
    .map((c) => shiftCurve(c, -x0, 0))
    .map((c) => (c.kind === 'line' ? `line ${[p(c.start), p(c.end)].sort().join('-')}` : c.kind === 'circle' ? `circle ${p(c.center)} R${n(c.radius)}` : `arc ${p(c.center)} R${n(c.radius)} ${deg(c.startDeg)}→${deg(c.endDeg)}`) + marks(c))
    .sort();
}

const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;
const lines = (cs: readonly ProfileCurve[]) => cs.filter((c): c is Extract<ProfileCurve, { kind: 'line' }> => c.kind === 'line');

describe('three views', () => {
  it('a turned part: the front view is the full profile, the top view the same, the end view a circle at every diameter', () => {
    const v = views(pinMm);
    const p = turnedProfile(model(pinMm), 'mm');
    if (!p.ok) throw new Error(p.error);
    const full = placeProfile(p.profile, { zeroAt: 'left', flip: false, full: true });
    expect(shape(v.front)).toEqual(shape(full));
    expect(shape(v.top)).toEqual(shape(v.front));
    // From the right end: the Ø6 and its chamfer, the bore, the fillet's tangent edge, the Ø10's shoulder; the Ø8 chamfer edge at the far end hidden.
    expect(shape(v.end)).toEqual(
      shape([
        { kind: 'circle', center: { x: 0, y: 0 }, radius: 1.5 },
        { kind: 'circle', center: { x: 0, y: 0 }, radius: 2.5 },
        { kind: 'circle', center: { x: 0, y: 0 }, radius: 3 },
        { kind: 'circle', center: { x: 0, y: 0 }, radius: 3.5, style: 'tangent' },
        { kind: 'circle', center: { x: 0, y: 0 }, radius: 4, style: 'hidden' },
        { kind: 'circle', center: { x: 0, y: 0 }, radius: 5 },
      ]),
    );
  });

  it('the shaft\'s cross hole: a Ø1.12 circle looking down it, hidden walls from the side, its break-out curves fitted', () => {
    const v = views(shaft);
    const [left] = curvesBox(v.front);
    // The hole is 1.8 from the chamfered end, square to the axis, through the Ø2.36.
    const hole = v.top.find((c) => c.kind === 'circle' && near(c.radius, 0.56));
    expect(hole && hole.kind === 'circle' && [hole.center.x - left, hole.center.y, hole.style]).toEqual([1.8, 0, undefined].map((x) => (typeof x === 'number' ? expect.closeTo(x, 9) : x)));
    const walls = lines(v.front).filter((l) => l.style === 'hidden' && near(l.start.x, l.end.x) && (near(l.start.x - left, 1.8 - 0.56) || near(l.start.x - left, 1.8 + 0.56)));
    expect(walls.length).toBe(2);
    const reach = 1.18; // seen from the side, the walls are where the hole meets the Ø2.36 at its full radius
    for (const w of walls) expect([Math.min(w.start.y, w.end.y), Math.max(w.start.y, w.end.y)].map((y) => Math.round(y * 1e5) / 1e5)).toEqual([-reach, reach].map((y) => Math.round(y * 1e5) / 1e5));
    expect(v.front.some((c) => c.fitted && c.style === undefined)).toBe(true);
  });

  it('the slotted head from above: its two walls 0.83 apart; the tang\'s flat across the end view', () => {
    const v = views(shaft);
    const walls = lines(v.top).filter((l) => near(l.start.y, l.end.y) && near(Math.abs(l.start.y), 0.415) && l.style === undefined);
    expect(new Set(walls.map((l) => Math.sign(l.start.y))).size).toBe(2);
    const flat = lines(v.end).find((l) => near(l.start.y, 0) && near(l.end.y, 0) && near(Math.abs(l.end.x - l.start.x), 3));
    expect(flat?.style).toBeUndefined();
  });

  it('a fillet\'s rim is its tangent edge with the flat face, drawn once: whole pieces, not rounding\'s fragments', () => {
    const v = views(shaft);
    const [, , right] = curvesBox(v.front);
    // The R0.15 fillet where the Ø3.97 meets the face 3.76 from the head end, seen edge-on: the tangent edge in two pieces
    // either side of the Ø1.85 tang's edge and the slot's wall (visible).
    const at = lines(v.front)
      .filter((l) => near(l.start.x, l.end.x) && near(l.start.x - right, -3.76))
      .map((l) => [Math.round(Math.min(l.start.y, l.end.y) * 1e4) / 1e4, Math.round(Math.max(l.start.y, l.end.y) * 1e4) / 1e4, l.style ?? 'visible'])
      .sort((p, q) => (p[0] as number) - (q[0] as number));
    expect(at).toEqual([
      [-1.985, -0.925, 'tangent'],
      [-0.925, 0.925, 'visible'],
      [0.925, 1.1, 'tangent'],
      [1.1, 1.9411, 'visible'],
    ]);
  });

  it('the head\'s rounds are quarter arcs, visible: no full circles, none in the tangent style (a full circle\'s two ends are one point)', () => {
    const v = views(shaft);
    const [, , right] = curvesBox(v.front);
    const rounds = (cs: readonly ProfileCurve[]) =>
      cs
        .filter((c) => c.kind !== 'line' && (near(c.radius, 0.5) || near(c.radius, 0.15)) && c.center.x - right > -5)
        .map((c) => (c.kind === 'arc' ? [c.radius, Math.sign(c.center.y), Math.round((((c.endDeg - c.startDeg) % 360) + 360) % 360), c.style ?? 'visible'] : [c.kind]))
        .sort((p, q) => String(p).localeCompare(String(q)));
    // From the front the slot has cut both rounds away on the top side; from above both sides show.
    expect(rounds(v.front)).toEqual([
      [0.15, -1, 90, 'visible'],
      [0.5, -1, 90, 'visible'],
    ]);
    expect(rounds(v.top)).toEqual([
      [0.15, -1, 90, 'visible'],
      [0.15, 1, 90, 'visible'],
      [0.5, -1, 90, 'visible'],
      [0.5, 1, 90, 'visible'],
    ]);
  });

  it('where the slot walls meet the head\'s round (spline edges a little inside the solid), the near one is visible all along', () => {
    const v = views(shaft);
    const [, , right] = curvesBox(v.front);
    // The near and far walls' curves project onto one another; the near one, solid, covers the far one.
    const atRound = v.front.filter((c) => c.fitted && c.kind !== 'line' && c.center.x - right > -2);
    expect(atRound.length).toBeGreaterThan(0);
    expect(atRound.filter((c) => c.style !== undefined)).toEqual([]);
  });

  it('Turn moves the cross hole\'s circle into the front view; Flip puts it at the far end', () => {
    const turned = views(shaft, false, 1);
    // Exactly the hole's circle (the break-out curves lie on the hole), the far one hidden under it.
    const [turnedLeft] = curvesBox(turned.front);
    const atHole = turned.front.filter((c) => c.kind !== 'line' && near(c.center.x - turnedLeft, 1.8));
    expect(atHole.map((c) => c.kind !== 'line' && [c.kind, c.center.y, c.radius, c.style, c.fitted])).toEqual([['circle', 0, 0.56, undefined, undefined]]);
    const flipped = views(shaft, true, 0);
    const [left, , right] = curvesBox(flipped.front);
    const hole = flipped.top.find((c) => c.kind === 'circle' && near(c.radius, 0.56));
    expect(hole?.kind === 'circle' && Math.round((right - hole.center.x) * 1e6) / 1e6).toBe(1.8);
    expect(right - left).toBeCloseTo(61.2, 6);
  });

  it('fitting: points along an arc give that arc; points along a line, one line', () => {
    const pts = Array.from({ length: 33 }, (_, i) => {
      const a = (Math.PI / 3) * (i / 32);
      return { x: 2 + 5 * Math.cos(a), y: -1 + 5 * Math.sin(a) };
    });
    const f = fit(pts, 1e-6);
    expect(f.length).toBe(1);
    const arc = f[0]!;
    expect(arc.kind === 'arc' && [arc.center.x, arc.center.y, arc.radius, arc.startDeg, arc.endDeg].map((x) => Math.round(x * 1e9) / 1e9 + 0)).toEqual([2, -1, 5, 0, 60]);
    expect(fit([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }], 1e-9)).toEqual([{ kind: 'line', start: { x: 0, y: 0 }, end: { x: 2, y: 2 } }]);
  });
});

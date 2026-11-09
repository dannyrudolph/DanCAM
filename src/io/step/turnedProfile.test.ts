import { describe, expect, it } from 'vitest';
import ballInch from '../../../test-fixtures/step/ball-end-inch.step?raw';
import crossHoleFlat from '../../../test-fixtures/step/cross-hole-flat-mm.step?raw';
import pinMm from '../../../test-fixtures/step/pin-mm.step?raw';
import pinTilted from '../../../test-fixtures/step/pin-tilted-mm.step?raw';
import type { Units } from '../../model/drawing';
import { type StepFace, type StepModel, readStep } from './stepModel';
import { type ProfileCurve, type TurnedProfile, placeProfile } from '../../model/profilePlacement';
import { turnedProfile } from './turnedProfile';

function profile(text: string, units: Units = 'mm'): TurnedProfile {
  const m = readStep(text);
  if (!m.ok) throw new Error(m.error);
  const p = turnedProfile(m.model, units);
  if (!p.ok) throw new Error(p.error);
  return p.profile;
}

/** Each curve as text rounded to 1e-6 (well inside the files' 1e-7 accuracy at these sizes), sorted: order doesn't matter. */
function shape(curves: readonly ProfileCurve[]): string[] {
  const n = (v: number): string => (Math.round(v * 1e6) / 1e6 + 0).toFixed(6);
  const p = (q: { x: number; y: number }): string => `(${n(q.x)}, ${n(q.y)})`;
  const deg = (d: number): string => n(((d % 360) + 360) % 360);
  const style = (c: ProfileCurve): string => (c.style ? ` ${c.style}` : '');
  return curves.map((c) => (c.kind === 'line' ? `line ${p(c.start)}-${p(c.end)}` : `arc ${p(c.center)} R${n(c.radius)} ${deg(c.startDeg)}→${deg(c.endDeg)}`) + style(c)).sort();
}

const TIP = 32 - 1.5 / Math.tan((59 * Math.PI) / 180); // where the 118° drill point closes

/** The pin as the fixture script makes it, Z0 at its left end, as a side view shows it: a line across it at each edge, the bore hidden. */
const PIN = shape([
  { kind: 'line', start: { x: 0, y: 0 }, end: { x: 0, y: 4 } }, // left end face, down to the axis
  { kind: 'line', start: { x: 0, y: 4 }, end: { x: 1, y: 5 } }, // 1x45° chamfer
  { kind: 'line', start: { x: 1, y: 0 }, end: { x: 1, y: 5 } }, // its edge with the Ø10
  { kind: 'line', start: { x: 1, y: 5 }, end: { x: 30, y: 5 } }, // Ø10
  { kind: 'line', start: { x: 30, y: 0 }, end: { x: 30, y: 5 } }, // shoulder face, and the Ø10's edge across the part
  { kind: 'arc', center: { x: 30.5, y: 3.5 }, radius: 0.5, startDeg: 180, endDeg: 270 }, // R.5 fillet into the shoulder
  { kind: 'line', start: { x: 30.5, y: 0 }, end: { x: 30.5, y: 3 }, style: 'tangent' }, // where the fillet runs smoothly into the Ø6
  { kind: 'line', start: { x: 30.5, y: 3 }, end: { x: 39.5, y: 3 } }, // Ø6
  { kind: 'line', start: { x: 39.5, y: 0 }, end: { x: 39.5, y: 3 } }, // its edge with the chamfer
  { kind: 'line', start: { x: 39.5, y: 3 }, end: { x: 40, y: 2.5 } }, // .5x45° chamfer
  { kind: 'line', start: { x: 40, y: 0 }, end: { x: 40, y: 2.5 } }, // right end face, across the bore (its edges are inside: no lines)
  { kind: 'line', start: { x: 32, y: 1.5 }, end: { x: 40, y: 1.5 }, style: 'hidden' }, // Ø3 bore, inside the part
  { kind: 'line', start: { x: 32, y: 0 }, end: { x: 32, y: 1.5 }, style: 'hidden' }, // its edge with the drill point
  { kind: 'line', start: { x: TIP, y: 0 }, end: { x: 32, y: 1.5 }, style: 'hidden' }, // 118° drill point to the axis
]);

describe('turned profile', () => {
  it('the pin: every face about the axis as its exact line or arc, the drill point to its apex, nothing left out', () => {
    const p = profile(pinMm);
    expect(shape(placeProfile(p, { zeroAt: 'left', flip: false, full: false }))).toEqual(PIN);
    expect(p.left).toEqual({ notRound: 0, freeform: 0, unreadable: 0 });
  });

  it('a part tilted and moved in space comes out the same, laid along Z', () => {
    const p = profile(pinTilted);
    const asIs = shape(placeProfile(p, { zeroAt: 'left', flip: false, full: false }));
    const flipped = shape(placeProfile(p, { zeroAt: 'left', flip: true, full: false }));
    expect([asIs, flipped]).toContainEqual(PIN); // a STEP axis can point either way
  });

  it('Z0 at the right end puts the part in −Z; Flip turns it end for end; Full mirrors it below the centerline', () => {
    const p = profile(pinMm);
    const right = placeProfile(p, { zeroAt: 'right', flip: false, full: false });
    expect(shape(right)).toContain('line (-40.000000, 0.000000)-(-40.000000, 4.000000)');
    expect(shape(right)).toContain('line (-8.000000, 1.500000)-(0.000000, 1.500000) hidden'); // the bore runs in from Z0
    expect(shape(right)).toContain('line (-9.500000, 0.000000)-(-9.500000, 3.000000) tangent');

    const flipped = shape(placeProfile(p, { zeroAt: 'left', flip: true, full: false }));
    expect(flipped).toContain('line (0.000000, 1.500000)-(8.000000, 1.500000) hidden'); // the bored end now at the left
    expect(flipped).toContain('arc (9.500000, 3.500000) R0.500000 270.000000→0.000000'); // the fillet, mirrored end for end

    const full = shape(placeProfile(p, { zeroAt: 'left', flip: false, full: true }));
    expect(full).toHaveLength(21); // 14 above, 14 below, the halves of the 7 lines from the centerline joined across it
    expect(full).toContain('line (32.000000, -1.500000)-(32.000000, 1.500000) hidden');
    expect(full).toContain('line (0.000000, -4.000000)-(0.000000, 4.000000)');
    expect(full).toContain('line (30.500000, -3.000000)-(30.500000, 3.000000) tangent');
    expect(full).toContain('arc (30.500000, -3.500000) R0.500000 90.000000→180.000000');
  });

  it('an inch file: converted to an mm drawing, kept in an inch one; a ball end runs to its pole', () => {
    expect(shape(placeProfile(profile(ballInch, 'in'), { zeroAt: 'left', flip: false, full: false }))).toEqual(
      shape([
        { kind: 'line', start: { x: 0, y: 0 }, end: { x: 0, y: 0.125 } },
        { kind: 'line', start: { x: 0, y: 0.125 }, end: { x: 1, y: 0.125 } },
        { kind: 'line', start: { x: 1, y: 0 }, end: { x: 1, y: 0.125 }, style: 'tangent' }, // the Ø.25 runs smoothly into the ball
        { kind: 'arc', center: { x: 1, y: 0 }, radius: 0.125, startDeg: 0, endDeg: 90 },
      ]),
    );
    const mm = shape(placeProfile(profile(ballInch, 'mm'), { zeroAt: 'left', flip: false, full: false }));
    expect(mm).toContain('line (0.000000, 3.175000)-(25.400000, 3.175000)');
  });

  it('a cross hole and a flat are left out and counted; the bar\'s own faces stay whole', () => {
    const p = profile(crossHoleFlat);
    expect(shape(placeProfile(p, { zeroAt: 'left', flip: false, full: false }))).toEqual(
      shape([
        { kind: 'line', start: { x: 0, y: 0 }, end: { x: 0, y: 5 } },
        { kind: 'line', start: { x: 0, y: 5 }, end: { x: 20, y: 5 } },
        { kind: 'line', start: { x: 20, y: 0 }, end: { x: 20, y: 5 } },
      ]),
    );
    expect(p.left).toEqual({ notRound: 4, freeform: 0, unreadable: 0 });
  });

  it('a face split in two by the exporter gives one line; freeform and unreadable faces are counted', () => {
    const m = readStep(pinMm);
    if (!m.ok) throw new Error(m.error);
    const cylinder = m.model.faces.find((f) => f.surface.kind === 'cylinder' && f.surface.radius === 5)!;
    const freeform: StepFace = { id: 999, surface: { kind: 'other', type: 'B_SPLINE_SURFACE_WITH_KNOTS' }, loops: [], sameSense: true };
    const model: StepModel = { ...m.model, faces: [...m.model.faces, { ...cylinder, id: 998 }, freeform], unreadable: [{ id: 5, reason: 'x' }] };
    const r = turnedProfile(model, 'mm');
    if (!r.ok) throw new Error(r.error);
    expect(shape(placeProfile(r.profile, { zeroAt: 'left', flip: false, full: false }))).toEqual(PIN);
    expect(r.profile.left).toEqual({ notRound: 0, freeform: 1, unreadable: 1 });
  });

  it('a part with nothing turned is refused', () => {
    const m = readStep(pinMm);
    if (!m.ok) throw new Error(m.error);
    const planes = { ...m.model, faces: m.model.faces.filter((f) => f.surface.kind === 'plane') };
    const r = turnedProfile(planes, 'mm');
    expect(r.ok ? 'profile' : r.error).toBe('There is no turned part here: no cylinders, cones or tori share an axis.');
  });

  it('an end face whose normal points against its edge circle\'s axis is still round, not left out', () => {
    // As Solid Edge writes them: each disk's edge is one full circle about +Z
    // starting on its X axis, and the disk at Z0 faces -Z. Seen from that
    // face, the circle's closing point falls a rounding error across the
    // direction it starts in.
    const at = (z: number, axisZ = 1) => ({ origin: { x: 0, y: 0, z }, axis: { x: 0, y: 0, z: axisZ }, ref: { x: 1, y: 0, z: 0 } });
    const circle = (z: number, r: number) => ({ start: { x: r, y: 0, z }, end: { x: r, y: 0, z }, curve: { kind: 'circle' as const, at: at(z), radius: r }, sameSense: true, id: 0, forward: true });
    const model: StepModel = {
      faces: [
        { id: 1, surface: { kind: 'plane', at: at(0, -1) }, loops: [{ edges: [circle(0, 2)] }], sameSense: true },
        { id: 2, surface: { kind: 'cylinder', at: at(0), radius: 2 }, loops: [{ edges: [circle(0, 2)] }, { edges: [circle(5, 2)] }], sameSense: true },
        { id: 3, surface: { kind: 'plane', at: at(5, -1) }, loops: [{ edges: [circle(5, 1)] }, { edges: [circle(5, 2)] }], sameSense: true },
        { id: 4, surface: { kind: 'cylinder', at: at(5), radius: 1 }, loops: [{ edges: [circle(5, 1)] }, { edges: [circle(8, 1)] }], sameSense: true },
        { id: 5, surface: { kind: 'plane', at: at(8) }, loops: [{ edges: [circle(8, 1)] }], sameSense: true },
      ],
      unreadable: [],
      mmPerUnit: 1,
      uncertainty: undefined,
    };
    const r = turnedProfile(model, 'mm');
    if (!r.ok) throw new Error(r.error);
    expect(r.profile.left.notRound).toBe(0);
    expect(shape(r.profile.curves)).toEqual(
      shape([
        { kind: 'line', start: { x: 0, y: 0 }, end: { x: 0, y: 2 } },
        { kind: 'line', start: { x: 0, y: 2 }, end: { x: 5, y: 2 } },
        { kind: 'line', start: { x: 5, y: 0 }, end: { x: 5, y: 2 } }, // the shoulder face, and the Ø4's edge across the part
        { kind: 'line', start: { x: 5, y: 1 }, end: { x: 8, y: 1 } },
        { kind: 'line', start: { x: 8, y: 0 }, end: { x: 8, y: 1 } },
      ]),
    );
  });

  it('inside the part, hidden: a stepped bore with a ball bottom, its shoulder and edges; the outside stays visible', () => {
    const at = (z: number) => ({ origin: { x: 0, y: 0, z }, axis: { x: 0, y: 0, z: 1 }, ref: { x: 1, y: 0, z: 0 } });
    const circle = (z: number, r: number) => ({ start: { x: r, y: 0, z }, end: { x: r, y: 0, z }, curve: { kind: 'circle' as const, at: at(z), radius: r }, sameSense: true, id: 0, forward: true });
    const ring = (z: number, ...rs: number[]) => rs.map((r) => ({ edges: [circle(z, r)] }));
    // A Ø10 bar 0–10 with a Ø6 bore 4 deep from Z10, stepping down to a Ø4 bore with a full-radius ball bottom ending at Z2.
    const model: StepModel = {
      faces: [
        { id: 1, surface: { kind: 'plane', at: at(0) }, loops: ring(0, 5), sameSense: true },
        { id: 2, surface: { kind: 'cylinder', at: at(0), radius: 5 }, loops: [...ring(0, 5), ...ring(10, 5)], sameSense: true },
        { id: 3, surface: { kind: 'plane', at: at(10) }, loops: ring(10, 5, 3), sameSense: true },
        { id: 4, surface: { kind: 'cylinder', at: at(6), radius: 3 }, loops: [...ring(6, 3), ...ring(10, 3)], sameSense: true },
        { id: 5, surface: { kind: 'plane', at: at(6) }, loops: ring(6, 3, 2), sameSense: true },
        { id: 6, surface: { kind: 'cylinder', at: at(4), radius: 2 }, loops: [...ring(4, 2), ...ring(6, 2)], sameSense: true },
        { id: 7, surface: { kind: 'sphere', at: at(4), radius: 2 }, loops: ring(4, 2), sameSense: true },
      ],
      unreadable: [],
      mmPerUnit: 1,
      uncertainty: undefined,
    };
    const r = turnedProfile(model, 'mm');
    if (!r.ok) throw new Error(r.error);
    expect(shape(r.profile.curves)).toEqual(
      shape([
        { kind: 'line', start: { x: 0, y: 0 }, end: { x: 0, y: 5 } },
        { kind: 'line', start: { x: 0, y: 5 }, end: { x: 10, y: 5 } },
        { kind: 'line', start: { x: 10, y: 0 }, end: { x: 10, y: 5 } }, // the end face, across the bore's mouth
        { kind: 'line', start: { x: 6, y: 3 }, end: { x: 10, y: 3 }, style: 'hidden' }, // Ø6 bore
        { kind: 'line', start: { x: 6, y: 0 }, end: { x: 6, y: 3 }, style: 'hidden' }, // its shoulder, and the edge across the part
        { kind: 'line', start: { x: 4, y: 2 }, end: { x: 6, y: 2 }, style: 'hidden' }, // Ø4 bore
        { kind: 'line', start: { x: 4, y: 0 }, end: { x: 4, y: 2 }, style: 'hidden' }, // where the ball bottom meets it
        { kind: 'arc', center: { x: 4, y: 0 }, radius: 2, startDeg: 90, endDeg: 180, style: 'hidden' }, // the ball bottom, to the axis
      ]),
    );
  });
});

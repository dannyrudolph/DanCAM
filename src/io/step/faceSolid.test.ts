import { describe, expect, it } from 'vitest';
import ballInch from '../../../test-fixtures/step/ball-end-inch.step?raw';
import pinMm from '../../../test-fixtures/step/pin-mm.step?raw';
import shaft from '../../../test-fixtures/step/shaft.step?raw';
import type { Vec3 } from '../../geometry/vec3';
import { type SolidFace, insideFace, nearestOn, rayHits, solidFaces } from './faceSolid';
import { type StepModel, readStep } from './stepModel';

const TOL = 1e-6;

function faces(text: string): SolidFace[] {
  const r = readStep(text);
  if (!r.ok) throw new Error(r.error);
  return solidFaces((r.model as StepModel).faces, TOL);
}

const p = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const at = (deg: number, r: number, z: number): Vec3 => p(r * Math.cos((deg * Math.PI) / 180), r * Math.sin((deg * Math.PI) / 180), z);

describe('faces of the solid', () => {
  const pin = faces(pinMm);
  const find = (fs: SolidFace[], test: (f: SolidFace) => boolean): SolidFace => {
    const f = fs.find(test);
    if (!f) throw new Error('no such face');
    return f;
  };

  it('a band of cylinder: inside between its circles all the way round, outside beyond them', () => {
    const body = find(pin, (f) => f.surface.kind === 'cylinder' && f.surface.radius === 5);
    for (const deg of [0, 90, 179, 181, 359]) expect(insideFace(body, at(deg, 5, 15), TOL)).toBe(true);
    expect(insideFace(body, at(30, 5, 35), TOL)).toBe(false);
    expect(insideFace(body, at(30, 5, 0.5), TOL)).toBe(false); // in the chamfer's span
    expect(insideFace(body, at(30, 5, 30), TOL)).toBe(true); // on its edge with the shoulder
  });

  it('flat faces: an annulus has a hole; the end face is a disk to the axis', () => {
    const shoulder = find(pin, (f) => f.surface.kind === 'plane' && Math.abs(f.surface.at.origin.z - 30) < 1e-9);
    expect(insideFace(shoulder, at(45, 4, 30), TOL)).toBe(true);
    expect(insideFace(shoulder, at(45, 2, 30), TOL)).toBe(false);
    expect(insideFace(shoulder, at(45, 6, 30), TOL)).toBe(false);
    const end = find(pin, (f) => f.surface.kind === 'plane' && Math.abs(f.surface.at.origin.z) < 1e-9);
    expect([insideFace(end, p(0, 0, 0), TOL), insideFace(end, at(200, 3.9, 0), TOL), insideFace(end, at(200, 4.1, 0), TOL)]).toEqual([true, true, false]);
  });

  it('a drill point: the cone from its circle to its apex, not the far nappe', () => {
    const tip = find(pin, (f) => f.surface.kind === 'cone' && f.surface.semiAngle > 1);
    const s = tip.surface;
    if (s.kind !== 'cone') throw new Error();
    // Where the cone has radius 0.75: half way to the apex.
    const z = 32 - 0.75 / Math.tan((59 * Math.PI) / 180);
    expect(insideFace(tip, at(10, 0.75, z), TOL)).toBe(true);
    const zFar = 32 + 0.75 / Math.tan((59 * Math.PI) / 180);
    expect(insideFace(tip, at(10, 0.75, zFar), TOL)).toBe(false);
  });

  it('a ball end: the cap to its pole is inside, the sphere\'s other half not', () => {
    const ball = find(faces(ballInch), (f) => f.surface.kind === 'sphere');
    const s = ball.surface;
    const c = s.at.origin;
    const r = s.kind === 'sphere' ? s.radius : 0;
    // The rod runs along X from 0 to 1 inch; the ball is at the +X end.
    expect(insideFace(ball, p(c.x + r, c.y, c.z), TOL)).toBe(true);
    expect(insideFace(ball, p(c.x + r * Math.SQRT1_2, c.y + r * Math.SQRT1_2, c.z), TOL)).toBe(true);
    expect(insideFace(ball, p(c.x - r, c.y, c.z), TOL)).toBe(false);
  });

  it('the shaft\'s cross hole: through the body, not beyond it', () => {
    const fs = faces(shaft);
    const hole = find(fs, (f) => f.surface.kind === 'cylinder' && Math.abs(f.surface.radius - 0.56) < 1e-9);
    expect(insideFace(hole, p(0.56, 0, 0), TOL)).toBe(true);
    expect(insideFace(hole, p(-0.56, 0.5, 0), TOL)).toBe(true);
    expect(insideFace(hole, p(0.56, 1.5, 0), TOL)).toBe(false);
  });

  it('a fillet torus: inside over its quarter of the tube, outside on the rest', () => {
    const fs = faces(shaft);
    const fillet = find(fs, (f) => f.surface.kind === 'torus' && Math.abs(f.surface.minor - 0.15) < 1e-9 && Math.abs(f.surface.at.origin.z - 20.7271) < 1e-3);
    const s = fillet.surface;
    if (s.kind !== 'torus') throw new Error();
    const z0 = s.at.origin.z;
    // The blend from the 20° taper down onto the Ø1.85 neck: its tube centre at R1.075, the neck at 1.075 − 0.15.
    expect(insideFace(fillet, at(77, s.major - s.minor, z0), TOL)).toBe(true);
    expect(insideFace(fillet, at(77, s.major + s.minor, z0), TOL)).toBe(false);
  });

  it('rays: through a cylinder twice, a plane once, a cone on its own nappe only', () => {
    const body = find(pin, (f) => f.surface.kind === 'cylinder' && f.surface.radius === 5);
    expect(rayHits(body.surface, p(-10, 0, 15), p(1, 0, 0)).sort((a, b) => a - b)).toEqual([5, 15]);
    const shoulder = find(pin, (f) => f.surface.kind === 'plane' && Math.abs(f.surface.at.origin.z - 30) < 1e-9);
    expect(rayHits(shoulder.surface, p(4, 0, 0), p(0, 0, 1))).toEqual([30]);
    const tip = find(pin, (f) => f.surface.kind === 'cone' && f.surface.semiAngle > 1);
    expect(rayHits(tip.surface, p(-5, 0, 31.6), p(1, 0, 0)).length).toBe(2); // the drill point spans Z31.1 to Z32
    expect(rayHits(tip.surface, p(-5, 0, 30), p(1, 0, 0)).length).toBe(0); // the far nappe, past the apex, isn't the face's surface
  });

  it('a face whose loops the exporter wrote backwards (the pin\'s reversed fillet torus) is taken the right way round by its neighbours', () => {
    const fillet = find(pin, (f) => f.surface.kind === 'torus');
    const s = fillet.surface;
    if (s.kind !== 'torus') throw new Error();
    // Its tube centre at Z30.5, R3.5, axis −Z: the fillet runs from the shoulder (Z30, R3.5) round to the Ø6 (Z30.5, R3).
    const onTube = (deg: number): Vec3 => {
      const ph = (deg * Math.PI) / 180;
      return at(40, s.major + s.minor * Math.cos(ph), 30.5 - s.minor * Math.sin(ph));
    };
    expect([135, 100, 170].map((d) => insideFace(fillet, onTube(d), TOL))).toEqual([true, true, true]);
    expect([0, 45, 200, 270].map((d) => insideFace(fillet, onTube(d), TOL))).toEqual([false, false, false, false]);
  });

  it('a point exactly where its face\'s circle edges start and end (angle 0, the seam) is judged like any other', () => {
    const fillet = find(pin, (f) => f.surface.kind === 'torus');
    const onTube = (deg: number, th: number): Vec3 => {
      const ph = (deg * Math.PI) / 180;
      return at(th, 3.5 + 0.5 * Math.cos(ph), 30.5 - 0.5 * Math.sin(ph));
    };
    expect([0, 180, 1e-9].map((th) => [insideFace(fillet, onTube(135, th), TOL), insideFace(fillet, onTube(45, th), TOL)])).toEqual([
      [true, false],
      [true, false],
      [true, false],
    ]);
    const tip = find(pin, (f) => f.surface.kind === 'cone' && f.surface.semiAngle > 1);
    const z = 32 - 0.75 / Math.tan((59 * Math.PI) / 180);
    expect([0, 180].map((th) => insideFace(tip, at(th, 0.75, z), TOL))).toEqual([true, true]);
  });
});

describe('the nearest point of a surface', () => {
  const Z = { origin: p(0, 0, 0), axis: p(0, 0, 1), ref: p(1, 0, 0) };
  const round = (q: Vec3): number[] => [q.x, q.y, q.z].map((x) => Math.round(x * 1e9) / 1e9 + 0);

  it('plane, cylinder, cone, sphere and torus: straight across to the surface, square to it', () => {
    expect(round(nearestOn({ kind: 'plane', at: { ...Z, origin: p(0, 0, 1) } }, p(3, 4, 5)))).toEqual([3, 4, 1]);
    expect(round(nearestOn({ kind: 'cylinder', at: Z, radius: 2 }, p(3, 4, 7)))).toEqual([1.2, 1.6, 7]);
    // A 45° cone from R1: the point (3, 0, 1) meets its generator r = 1 + z square on at (2.5, 1.5).
    expect(round(nearestOn({ kind: 'cone', at: Z, radius: 1, semiAngle: Math.PI / 4 }, p(3, 0, 1)))).toEqual([2.5, 0, 1.5]);
    expect(round(nearestOn({ kind: 'sphere', at: { ...Z, origin: p(1, 1, 1) }, radius: 2 }, p(1, 1, 5)))).toEqual([1, 1, 3]);
    // A torus R3 r1: from (0, 5, 1) toward its tube's centre (0, 3, 0), one radius out.
    expect(round(nearestOn({ kind: 'torus', at: Z, major: 3, minor: 1 }, p(0, 5, 1)))).toEqual(round(p(0, 3 + 2 / Math.sqrt(5), 1 / Math.sqrt(5))));
  });
});

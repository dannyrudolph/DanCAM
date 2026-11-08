import { arc3P, arcEnd, arcMid, arcStart } from './arc';
import type { BBox } from './bbox';
import type { Curve } from './curve';
import { type Vec2, add, cross, distance, scale, sub } from './vec';

const inside = (p: Vec2, b: BBox): boolean => p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;

/**
 * Stretch: the curve with whatever defining points lie inside `box` moved by
 * `delta`. A line's ends move independently; a ray or xline moves when its
 * base is inside, a circle when its center is. An arc with both ends inside
 * moves whole; with one end inside, that end moves and the arc keeps its
 * bulge height (sagitta) over the new chord, as in AutoCAD. Undefined when
 * nothing of it is inside, or a stretched arc would be straight.
 */
export function stretchCurve(c: Curve, box: BBox, delta: Vec2): Curve | undefined {
  const mv = (p: Vec2): Vec2 => add(p, delta);
  switch (c.kind) {
    case 'segment': {
      const a = inside(c.a, box);
      const b = inside(c.b, box);
      return a || b ? { kind: 'segment', a: a ? mv(c.a) : c.a, b: b ? mv(c.b) : c.b } : undefined;
    }
    case 'ray':
    case 'xline':
      return inside(c.base, box) ? { ...c, base: mv(c.base) } : undefined;
    case 'circle':
      return inside(c.center, box) ? { ...c, center: mv(c.center) } : undefined;
    case 'arc': {
      const s = arcStart(c);
      const e = arcEnd(c);
      const si = inside(s, box);
      const ei = inside(e, box);
      if (si && ei) return { ...c, center: mv(c.center) };
      if (!si && !ei) return undefined;
      const m = arcMid(c);
      const chord = sub(e, s);
      // Signed sagitta: the mid's offset from the chord's middle, along the chord's left normal.
      const h = cross(chord, sub(m, s)) / distance(s, e);
      const s2 = si ? mv(s) : s;
      const e2 = ei ? mv(e) : e;
      const len = distance(s2, e2);
      if (len === 0) return undefined;
      const n = scale({ x: -(e2.y - s2.y), y: e2.x - s2.x }, h / len);
      const mid = add(scale(add(s2, e2), 0.5), n);
      const a = arc3P(s2, mid, e2);
      return a && { kind: 'arc', ...a };
    }
  }
}

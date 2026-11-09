import { angleDeg, cosSinDeg, normDeg } from '../geometry/angle';
import { arcEnd, arcStart } from '../geometry/arc';
import { TOL } from '../geometry/tolerance';
import { type Vec2, vecNearlyEqual } from '../geometry/vec';
import type { Entity } from './entity';
import type { LineStyleName } from './lineStyle';

/** How a typed value is read: lengths take unit suffixes, angles are degrees, factors are plain numbers. */
export type Quantity = 'length' | 'angle' | 'factor';

/**
 * Sets one property from a typed value. Returns undefined when the value
 * would make the entity degenerate (zero length or radius, a full-turn arc).
 */
export type PropertySetter = {
  readonly quantity: Quantity;
  set(value: number): Entity | undefined;
  /** Why `set` refused, when it isn't that the object would have no size. */
  readonly refusal?: string;
};

const RAD_PER_DEG = Math.PI / 180;

function lineWith(e: Extract<Entity, { kind: 'line' }>, start: Vec2, end: Vec2): Entity | undefined {
  return vecNearlyEqual(start, end) ? undefined : { ...e, start, end };
}

/** `from` plus `len` along `deg`, exact at multiples of 90°. */
function polar(from: Vec2, len: number, deg: number): Vec2 {
  const [c, s] = cosSinDeg(deg);
  return { x: from.x + len * c, y: from.y + len * s };
}

function arcWith(e: Extract<Entity, { kind: 'arc' }>, startDeg: number, endDeg: number): Entity | undefined {
  const next = { ...e, startDeg: normDeg(startDeg), endDeg: normDeg(endDeg) };
  return vecNearlyEqual(arcStart(next), arcEnd(next)) ? undefined : next;
}

const positive = (v: number): boolean => v > TOL;

/**
 * The setter for the properties-panel row `label` of `e`, or undefined when
 * the row is read-only. Labels match `rowsFor` in the properties panel.
 * Each setter keeps what the row's neighbours would expect: a line's Length
 * keeps its start and angle, its Angle keeps start and length; an arc's
 * Included angle and Arc length keep its start.
 */
export function propertySetter(e: Entity, label: string): PropertySetter | undefined {
  const length = (set: (v: number) => Entity | undefined): PropertySetter => ({ quantity: 'length', set });
  const angle = (set: (v: number) => Entity | undefined): PropertySetter => ({ quantity: 'angle', set });
  switch (e.kind) {
    case 'point':
      if (label === 'X') return length((v) => ({ ...e, at: { x: v, y: e.at.y } }));
      if (label === 'Y') return length((v) => ({ ...e, at: { x: e.at.x, y: v } }));
      return undefined;
    case 'line': {
      const dx = e.end.x - e.start.x;
      const dy = e.end.y - e.start.y;
      const len = Math.hypot(dx, dy);
      const deg = angleDeg({ x: dx, y: dy });
      switch (label) {
        case 'Start X':
          return length((v) => lineWith(e, { x: v, y: e.start.y }, e.end));
        case 'Start Y':
          return length((v) => lineWith(e, { x: e.start.x, y: v }, e.end));
        case 'End X':
          return length((v) => lineWith(e, e.start, { x: v, y: e.end.y }));
        case 'End Y':
          return length((v) => lineWith(e, e.start, { x: e.end.x, y: v }));
        case 'ΔX':
          return length((v) => lineWith(e, e.start, { x: e.start.x + v, y: e.end.y }));
        case 'ΔY':
          return length((v) => lineWith(e, e.start, { x: e.end.x, y: e.start.y + v }));
        case 'Length':
          return length((v) => (positive(v) ? lineWith(e, e.start, polar(e.start, v, deg)) : undefined));
        case 'Angle':
          return angle((v) => lineWith(e, e.start, polar(e.start, len, v)));
      }
      return undefined;
    }
    case 'circle':
      switch (label) {
        case 'Center X':
          return length((v) => ({ ...e, center: { x: v, y: e.center.y } }));
        case 'Center Y':
          return length((v) => ({ ...e, center: { x: e.center.x, y: v } }));
        case 'Radius':
          return length((v) => (positive(v) ? { ...e, radius: v } : undefined));
        case 'Diameter':
          return length((v) => (positive(v) ? { ...e, radius: v / 2 } : undefined));
        case 'Circumference':
          return length((v) => (positive(v) ? { ...e, radius: v / (2 * Math.PI) } : undefined));
      }
      return undefined;
    case 'arc':
      switch (label) {
        case 'Center X':
          return length((v) => ({ ...e, center: { x: v, y: e.center.y } }));
        case 'Center Y':
          return length((v) => ({ ...e, center: { x: e.center.x, y: v } }));
        case 'Radius':
          return length((v) => (positive(v) ? { ...e, radius: v } : undefined));
        case 'Start angle':
          return angle((v) => arcWith(e, v, e.endDeg));
        case 'End angle':
          return angle((v) => arcWith(e, e.startDeg, v));
        case 'Included angle':
          return angle((v) => (positive(v) && v < 360 ? arcWith(e, e.startDeg, e.startDeg + v) : undefined));
        case 'Arc length':
          return length((v) => {
            const sweep = v / e.radius / RAD_PER_DEG;
            return positive(v) && sweep < 360 ? arcWith(e, e.startDeg, e.startDeg + sweep) : undefined;
          });
      }
      return undefined;
    case 'xline':
    case 'ray':
      switch (label) {
        case 'Base X':
          return length((v) => ({ ...e, base: { x: v, y: e.base.y } }));
        case 'Base Y':
          return length((v) => ({ ...e, base: { x: e.base.x, y: v } }));
        case 'Angle':
          return angle((v) => {
            const [c, s] = cosSinDeg(v);
            return { ...e, dir: { x: c, y: s } };
          });
      }
      return undefined;
    case 'insert':
      switch (label) {
        case 'X':
          return length((v) => ({ ...e, at: { x: v, y: e.at.y } }));
        case 'Y':
          return length((v) => ({ ...e, at: { x: e.at.x, y: v } }));
        case 'Rotation':
          return angle((v) => ({ ...e, rotationDeg: normDeg(v) }));
        case 'Scale':
          return { quantity: 'factor', set: (v) => (positive(v) ? { ...e, scale: v } : undefined), refusal: 'the scale needs to be more than zero' };
      }
      return undefined;
  }
}

/** The instance mirrored or not, about its own X axis through its insertion point. */
export function withMirrored(e: Extract<Entity, { kind: 'insert' }>, mirrored: boolean): Entity {
  return { ...e, mirrored };
}

export function withLayer(e: Entity, layer: string): Entity {
  return { ...e, layer };
}

/** `style` undefined means "by layer": the entity's own style is removed. Dimensions always draw thin, so they keep theirs. */
export function withStyle(e: Entity, style: LineStyleName | undefined): Entity {
  if (e.kind === 'dimension') return e;
  const { style: _old, ...rest } = e;
  return style ? { ...rest, style } : rest;
}

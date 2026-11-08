import type { Vec2 } from './vec';

/** Axis-aligned bounding box. An empty box has min > max on both axes. */
export type BBox = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

export const EMPTY_BBOX: BBox = {
  minX: Infinity,
  minY: Infinity,
  maxX: -Infinity,
  maxY: -Infinity,
};

export function isEmpty(b: BBox): boolean {
  return b.minX > b.maxX || b.minY > b.maxY;
}

export function extend(b: BBox, p: Vec2): BBox {
  return {
    minX: Math.min(b.minX, p.x),
    minY: Math.min(b.minY, p.y),
    maxX: Math.max(b.maxX, p.x),
    maxY: Math.max(b.maxY, p.y),
  };
}

export function union(a: BBox, b: BBox): BBox {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

export function fromPoints(points: readonly Vec2[]): BBox {
  let b = EMPTY_BBOX;
  for (const p of points) b = extend(b, p);
  return b;
}

export function width(b: BBox): number {
  return isEmpty(b) ? 0 : b.maxX - b.minX;
}

export function height(b: BBox): number {
  return isEmpty(b) ? 0 : b.maxY - b.minY;
}

export function center(b: BBox): Vec2 {
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

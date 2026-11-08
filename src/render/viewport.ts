import { type BBox, center as bboxCenter, height, isEmpty, width } from '../geometry/bbox';
import type { Vec2 } from '../geometry/vec';

/**
 * The world-to-screen transform. World is Y-up in drawing units; screen is
 * Y-down in CSS pixels with the origin at the top-left of the canvas.
 *
 * Positions are converted here in float64, relative to the view center, so the
 * canvas only ever receives small pixel coordinates. Handing the canvas a huge
 * scale transform instead would lose precision at deep zoom.
 */
export type Viewport = {
  /** World point shown at the center of the canvas. */
  readonly center: Vec2;
  /** CSS pixels per drawing unit. */
  readonly scale: number;
  readonly widthPx: number;
  readonly heightPx: number;
};

/** Zoom limits in pixels per drawing unit. 1e9 shows 1e-6 units across 1000px. */
export const MIN_SCALE = 1e-3;
export const MAX_SCALE = 1e9;

/** Fraction of the canvas left empty on each side by Zoom Extents. */
export const EXTENTS_MARGIN = 0.05;

function clampScale(s: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

export function worldToScreen(v: Viewport, p: Vec2): Vec2 {
  return {
    x: v.widthPx / 2 + (p.x - v.center.x) * v.scale,
    y: v.heightPx / 2 - (p.y - v.center.y) * v.scale,
  };
}

export function screenToWorld(v: Viewport, s: Vec2): Vec2 {
  return {
    x: v.center.x + (s.x - v.widthPx / 2) / v.scale,
    y: v.center.y - (s.y - v.heightPx / 2) / v.scale,
  };
}

/** World-space rectangle covered by the canvas. */
export function visibleBBox(v: Viewport): BBox {
  const halfW = v.widthPx / 2 / v.scale;
  const halfH = v.heightPx / 2 / v.scale;
  return {
    minX: v.center.x - halfW,
    minY: v.center.y - halfH,
    maxX: v.center.x + halfW,
    maxY: v.center.y + halfH,
  };
}

/**
 * Multiplies the scale by `factor`, keeping the world point under `screenPt`
 * at the same screen position. The scale is clamped to [MIN_SCALE, MAX_SCALE].
 */
export function zoomAt(v: Viewport, screenPt: Vec2, factor: number): Viewport {
  const anchor = screenToWorld(v, screenPt);
  const scale = clampScale(v.scale * factor);
  return {
    ...v,
    scale,
    center: {
      x: anchor.x - (screenPt.x - v.widthPx / 2) / scale,
      y: anchor.y + (screenPt.y - v.heightPx / 2) / scale,
    },
  };
}

/** Moves the view so the drawing follows a drag of (dxPx, dyPx) screen pixels. */
export function pan(v: Viewport, dxPx: number, dyPx: number): Viewport {
  return {
    ...v,
    center: { x: v.center.x - dxPx / v.scale, y: v.center.y + dyPx / v.scale },
  };
}

/**
 * Centers `box` and scales it to fill the canvas less EXTENTS_MARGIN on each
 * side. An empty box leaves the view unchanged; a box with no width or height
 * is centered at the current scale.
 */
export function zoomExtents(v: Viewport, box: BBox): Viewport {
  if (isEmpty(box)) return v;
  const usable = 1 - 2 * EXTENTS_MARGIN;
  const bw = width(box);
  const bh = height(box);
  const fits = [
    bw > 0 ? (v.widthPx * usable) / bw : Infinity,
    bh > 0 ? (v.heightPx * usable) / bh : Infinity,
  ];
  const fit = Math.min(...fits);
  const scale = Number.isFinite(fit) ? clampScale(fit) : v.scale;
  return { ...v, center: bboxCenter(box), scale };
}

/** Keeps the same center and scale when the canvas changes size. */
export function resize(v: Viewport, widthPx: number, heightPx: number): Viewport {
  return { ...v, widthPx, heightPx };
}

import type { BBox } from '../geometry/bbox';
import { clipSegment } from '../geometry/clip';
import type { Vec2 } from '../geometry/vec';
import type { Drawing } from '../model/drawing';
import type { Entity } from '../model/entity';
import { gridLines, gridSpacing } from './grid';
import { type Viewport, visibleBBox, worldToScreen } from './viewport';

const COLORS = {
  background: '#1b1f24',
  gridMinor: '#262b32',
  gridMajor: '#323943',
  axisX: '#7a3b3b',
  axisY: '#3b6a45',
} as const;

/** Entity line width in CSS pixels; constant on screen at every zoom. */
const ENTITY_LINE_PX = 1.5;
/** Half-size of the point marker in CSS pixels. */
const POINT_MARK_PX = 3;

/**
 * Redraws the whole canvas. `dpr` is the device pixel ratio; the canvas backing
 * store is expected to be widthPx*dpr by heightPx*dpr.
 */
export function render(ctx: CanvasRenderingContext2D, v: Viewport, drawing: Drawing, dpr: number): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, v.widthPx, v.heightPx);
  drawGrid(ctx, v, dpr);
  drawEntities(ctx, v, drawing);
}

/** Rounds a CSS-pixel coordinate to the center of a device pixel, so 1-device-pixel lines stay sharp. */
function crisp(px: number, dpr: number): number {
  return (Math.round(px * dpr - 0.5) + 0.5) / dpr;
}

function drawGrid(ctx: CanvasRenderingContext2D, v: Viewport, dpr: number): void {
  const spacing = gridSpacing(v.scale);
  const box = visibleBBox(v);
  ctx.lineWidth = 1 / dpr;

  const xs = gridLines(box.minX, box.maxX, spacing);
  const ys = gridLines(box.minY, box.maxY, spacing);
  for (const major of [false, true]) {
    ctx.strokeStyle = major ? COLORS.gridMajor : COLORS.gridMinor;
    ctx.beginPath();
    for (const line of xs) {
      if (line.major !== major || line.value === 0) continue;
      const sx = crisp(worldToScreen(v, { x: line.value, y: 0 }).x, dpr);
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, v.heightPx);
    }
    for (const line of ys) {
      if (line.major !== major || line.value === 0) continue;
      const sy = crisp(worldToScreen(v, { x: 0, y: line.value }).y, dpr);
      ctx.moveTo(0, sy);
      ctx.lineTo(v.widthPx, sy);
    }
    ctx.stroke();
  }

  const origin = worldToScreen(v, { x: 0, y: 0 });
  if (box.minY <= 0 && box.maxY >= 0) {
    const sy = crisp(origin.y, dpr);
    ctx.strokeStyle = COLORS.axisX;
    ctx.beginPath();
    ctx.moveTo(0, sy);
    ctx.lineTo(v.widthPx, sy);
    ctx.stroke();
  }
  if (box.minX <= 0 && box.maxX >= 0) {
    const sx = crisp(origin.x, dpr);
    ctx.strokeStyle = COLORS.axisY;
    ctx.beginPath();
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, v.heightPx);
    ctx.stroke();
  }
}

function drawEntities(ctx: CanvasRenderingContext2D, v: Viewport, drawing: Drawing): void {
  ctx.lineWidth = ENTITY_LINE_PX;
  ctx.lineCap = 'round';
  for (const e of drawing.entities.values()) {
    const layer = drawing.layers.get(e.layer);
    if (layer && !layer.visible) continue;
    ctx.strokeStyle = layer?.color ?? '#ffffff';
    drawEntity(ctx, v, e);
  }
}

function drawEntity(ctx: CanvasRenderingContext2D, v: Viewport, e: Entity): void {
  switch (e.kind) {
    case 'line': {
      // Clip in float64 screen space so the canvas never sees huge coordinates at deep zoom.
      const seg = clipSegment(worldToScreen(v, e.start), worldToScreen(v, e.end), screenClipBox(v));
      if (!seg) return;
      ctx.beginPath();
      ctx.moveTo(seg[0].x, seg[0].y);
      ctx.lineTo(seg[1].x, seg[1].y);
      ctx.stroke();
      return;
    }
    case 'point':
      drawPointMark(ctx, worldToScreen(v, e.at));
      return;
  }
}

/** The canvas rectangle plus a margin wider than any line cap, in CSS pixels. */
function screenClipBox(v: Viewport): BBox {
  const m = 10;
  return { minX: -m, minY: -m, maxX: v.widthPx + m, maxY: v.heightPx + m };
}

function drawPointMark(ctx: CanvasRenderingContext2D, s: Vec2): void {
  ctx.beginPath();
  ctx.moveTo(s.x - POINT_MARK_PX, s.y);
  ctx.lineTo(s.x + POINT_MARK_PX, s.y);
  ctx.moveTo(s.x, s.y - POINT_MARK_PX);
  ctx.lineTo(s.x, s.y + POINT_MARK_PX);
  ctx.stroke();
}

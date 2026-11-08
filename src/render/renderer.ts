import { degToRad } from '../geometry/angle';
import { arcSweepDeg } from '../geometry/arc';
import { arcScreenPieces } from '../geometry/arcPolyline';
import type { BBox } from '../geometry/bbox';
import { clipLine, clipSegment } from '../geometry/clip';
import { distance } from '../geometry/vec';
import type { Vec2 } from '../geometry/vec';
import { type Drawing, effectiveStyle } from '../model/drawing';
import type { Entity, EntityId } from '../model/entity';
import { type LineStyle, dashOffset, insetArc, insetSegment } from '../model/lineStyle';
import { type Viewport, worldToScreen } from './viewport';

/** Paper-style drawing area: black lines on white, no grid. */
const COLORS = {
  background: '#ffffff',
  /** For an entity whose layer is missing. */
  fallbackLine: '#000000',
  selected: '#0969da',
  preview: '#d4760a',
  cursor: '#d4760a',
} as const;

/** Half-size of the point marker in CSS pixels. */
const POINT_MARK_PX = 3;
/** Extra width added to a selected entity, CSS pixels. */
const SELECTED_EXTRA_PX = 1;
/** Largest gap between a drawn arc chord and the true curve, CSS pixels. */
const ARC_ERROR_PX = 0.25;
/** Half-size of the marker where the next point will land. */
const CURSOR_MARK_PX = 4;

/** Things drawn over the drawing: tool preview, selection and the next-point marker. */
export type Overlay = {
  readonly preview: readonly Entity[];
  readonly selected: EntityId | undefined;
  /** Where a click or Enter would place the point now (after locks and tracking). */
  readonly nextPoint: Vec2 | undefined;
};

/**
 * Redraws the whole canvas. `dpr` is the device pixel ratio; the canvas backing
 * store is expected to be widthPx*dpr by heightPx*dpr.
 */
export function render(
  ctx: CanvasRenderingContext2D,
  v: Viewport,
  drawing: Drawing,
  overlay: Overlay,
  dpr: number,
): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, v.widthPx, v.heightPx);
  drawEntities(ctx, v, drawing, overlay.selected);
  for (const e of overlay.preview) {
    drawEntity(ctx, v, e, effectiveStyle(drawing, e), COLORS.preview, 0);
  }
  if (overlay.nextPoint) drawCursorMark(ctx, worldToScreen(v, overlay.nextPoint));
}

function drawEntities(ctx: CanvasRenderingContext2D, v: Viewport, drawing: Drawing, selected: EntityId | undefined): void {
  for (const e of drawing.entities.values()) {
    const layer = drawing.layers.get(e.layer);
    if (layer && !layer.visible) continue;
    const isSelected = e.id === selected;
    const color = isSelected ? COLORS.selected : (layer?.color ?? COLORS.fallbackLine);
    drawEntity(ctx, v, e, effectiveStyle(drawing, e), color, isSelected ? SELECTED_EXTRA_PX : 0);
  }
}

function drawEntity(
  ctx: CanvasRenderingContext2D,
  v: Viewport,
  e: Entity,
  style: LineStyle,
  color: string,
  extraWidth: number,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = style.weight + extraWidth;
  ctx.lineCap = style.dash.length === 0 ? 'round' : 'butt';
  switch (e.kind) {
    case 'line': {
      // Clip in float64 screen space so the canvas never sees huge coordinates at deep zoom.
      // Tangent edges stop short of their ends; done in screen pixels so the gap is the same at every zoom.
      const [a, b] = insetSegment(worldToScreen(v, e.start), worldToScreen(v, e.end), style.endGap);
      const seg = clipSegment(a, b, screenClipBox(v));
      if (!seg) return;
      ctx.setLineDash(style.dash);
      ctx.lineDashOffset = dashOffset(style.dash, distance(a, seg[0]));
      ctx.beginPath();
      ctx.moveTo(seg[0].x, seg[0].y);
      ctx.lineTo(seg[1].x, seg[1].y);
      ctx.stroke();
      ctx.setLineDash([]);
      return;
    }
    case 'circle':
    case 'arc': {
      // Flattened in screen space and clipped to the view, so the segment count
      // follows what is visible rather than the zoom.
      const center = worldToScreen(v, e.center);
      const radiusPx = e.radius * v.scale;
      let start = 0;
      let sweep = 2 * Math.PI;
      if (e.kind === 'arc') {
        [start, sweep] = insetArc(degToRad(e.startDeg), degToRad(arcSweepDeg(e)), radiusPx, style.endGap);
      }
      const pieces = arcScreenPieces(center, radiusPx, start, sweep, screenClipBox(v), ARC_ERROR_PX);
      ctx.setLineDash(style.dash);
      for (const piece of pieces) {
        ctx.lineDashOffset = dashOffset(style.dash, piece.startOffsetPx);
        ctx.beginPath();
        const [first, ...rest] = piece.points;
        ctx.moveTo(first!.x, first!.y);
        for (const p of rest) ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      return;
    }
    case 'xline': {
      const base = worldToScreen(v, e.base);
      const dir = { x: e.dir.x, y: -e.dir.y }; // screen Y points down
      const seg = clipLine(base, dir, screenClipBox(v));
      if (!seg) return;
      // Dashes are anchored at the base point, so they stay put while panning.
      const fromBase = (seg[0].x - base.x) * dir.x + (seg[0].y - base.y) * dir.y;
      ctx.setLineDash(style.dash);
      ctx.lineDashOffset = dashOffset(style.dash, fromBase);
      ctx.beginPath();
      ctx.moveTo(seg[0].x, seg[0].y);
      ctx.lineTo(seg[1].x, seg[1].y);
      ctx.stroke();
      ctx.setLineDash([]);
      return;
    }
    case 'point':
      ctx.lineWidth = 1 + extraWidth;
      drawPointMark(ctx, worldToScreen(v, e.at));
      return;
  }
}

function drawCursorMark(ctx: CanvasRenderingContext2D, s: Vec2): void {
  ctx.strokeStyle = COLORS.cursor;
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.strokeRect(s.x - CURSOR_MARK_PX, s.y - CURSOR_MARK_PX, CURSOR_MARK_PX * 2, CURSOR_MARK_PX * 2);
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

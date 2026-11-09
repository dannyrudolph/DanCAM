import { degToRad } from '../geometry/angle';
import { arcSweepDeg } from '../geometry/arc';
import { arcScreenPieces } from '../geometry/arcPolyline';
import type { BBox } from '../geometry/bbox';
import { clipLine, clipRay, clipSegment } from '../geometry/clip';
import { distance } from '../geometry/vec';
import type { Vec2 } from '../geometry/vec';
import { type DimLayout, dimensionLayout } from '../model/dimLayout';
import { type Drawing, effectiveStyle } from '../model/drawing';
import type { Entity, EntityId } from '../model/entity';
import type { BoxMode } from '../model/selection';
import { type LineStyle, dashOffset, insetArc, insetSegment } from '../model/lineStyle';
import { CAP_HEIGHT_EM, TEXT_FONT } from '../model/textMetrics';
import { SNAP_LABEL, type Snap, type SnapKind } from '../snap/snap';
import { type Viewport, worldToScreen } from './viewport';

/** Paper-style drawing area: black lines on white, no grid. */
const COLORS = {
  background: '#ffffff',
  /** For an entity whose layer is missing. */
  fallbackLine: '#000000',
  selected: '#0969da',
  preview: '#d4760a',
  cursor: '#d4760a',
  snap: '#1a7f37',
  tooltipText: '#ffffff',
  grip: '#0969da',
  hotGrip: '#d1242f',
  gripEdge: '#ffffff',
  windowEdge: '#0969da',
  windowFill: 'rgba(9, 105, 218, 0.08)',
  crossingEdge: '#1a7f37',
  crossingFill: 'rgba(26, 127, 55, 0.08)',
} as const;

/** Half-size of the point marker in CSS pixels. */
const POINT_MARK_PX = 3;
/** Extra width added to a selected entity, CSS pixels. */
const SELECTED_EXTRA_PX = 1;
/** Largest gap between a drawn arc chord and the true curve, CSS pixels. */
const ARC_ERROR_PX = 0.25;
/** Half-size of the marker where the next point will land. */
const CURSOR_MARK_PX = 4;
/** Half-size of a grip square, CSS pixels. */
export const GRIP_PX = 4;
/** Half-size of an object snap marker, CSS pixels. */
const SNAP_MARK_PX = 6;
/** Dimension, extension and leader lines, CSS pixels: thin, like the Hidden and Center styles. */
const DIM_LINE_PX = 1;
/** Dimension text smaller than this font size is not drawn, CSS pixels. */
const MIN_TEXT_PX = 2;

/** Things drawn over the drawing: tool preview, selection and the next-point marker. */
export type Overlay = {
  readonly preview: readonly Entity[];
  readonly selected: ReadonlySet<EntityId>;
  /** Grips of the selected entities, world coordinates. */
  readonly grips: readonly Vec2[];
  /** The grip being dragged, drawn hot. */
  readonly hotGrip: Vec2 | undefined;
  /** A selection box being dragged, in screen pixels. */
  readonly selectBox: { readonly from: Vec2; readonly to: Vec2; readonly mode: BoxMode } | undefined;
  /** Where a click or Enter would place the point now (after locks and tracking). */
  readonly nextPoint: Vec2 | undefined;
  /** The object snap the cursor is on; drawn instead of the next-point marker. */
  readonly snap: Snap | undefined;
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
    drawEntity(ctx, v, drawing, e, effectiveStyle(drawing, e), COLORS.preview, 0);
  }
  for (const g of overlay.grips) drawGrip(ctx, worldToScreen(v, g), COLORS.grip);
  if (overlay.hotGrip) drawGrip(ctx, worldToScreen(v, overlay.hotGrip), COLORS.hotGrip);
  if (overlay.selectBox) drawSelectBox(ctx, overlay.selectBox);
  if (overlay.snap) drawSnapMark(ctx, worldToScreen(v, overlay.snap.at), overlay.snap.kind, overlay.snap.deferred !== undefined);
  else if (overlay.nextPoint) drawCursorMark(ctx, worldToScreen(v, overlay.nextPoint));
}

function drawEntities(ctx: CanvasRenderingContext2D, v: Viewport, drawing: Drawing, selected: ReadonlySet<EntityId>): void {
  for (const e of drawing.entities.values()) {
    const layer = drawing.layers.get(e.layer);
    if (layer && !layer.visible) continue;
    const isSelected = selected.has(e.id);
    const color = isSelected ? COLORS.selected : (layer?.color ?? COLORS.fallbackLine);
    drawEntity(ctx, v, drawing, e, effectiveStyle(drawing, e), color, isSelected ? SELECTED_EXTRA_PX : 0);
  }
}

function drawEntity(
  ctx: CanvasRenderingContext2D,
  v: Viewport,
  drawing: Drawing,
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
    case 'xline':
    case 'ray': {
      const base = worldToScreen(v, e.base);
      const dir = { x: e.dir.x, y: -e.dir.y }; // screen Y points down
      const seg = (e.kind === 'ray' ? clipRay : clipLine)(base, dir, screenClipBox(v));
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
    case 'dimension':
      drawDimension(ctx, v, dimensionLayout(drawing, e), color, extraWidth);
      return;
  }
}

/** Thin continuous lines, filled arrows and upright text, whatever the line style. */
function drawDimension(ctx: CanvasRenderingContext2D, v: Viewport, l: DimLayout, color: string, extraWidth: number): void {
  const clip = screenClipBox(v);
  ctx.lineWidth = DIM_LINE_PX + extraWidth;
  ctx.lineCap = 'butt';
  ctx.setLineDash([]);
  ctx.beginPath();
  for (const [a, b] of l.lines) {
    const seg = clipSegment(worldToScreen(v, a), worldToScreen(v, b), clip);
    if (!seg) continue;
    ctx.moveTo(seg[0].x, seg[0].y);
    ctx.lineTo(seg[1].x, seg[1].y);
  }
  ctx.stroke();
  ctx.fillStyle = color;
  for (const t of l.arrows) {
    const [p, q, r] = t.map((w) => worldToScreen(v, w)) as [Vec2, Vec2, Vec2];
    const off = (k: 'x' | 'y', min: number, max: number): boolean => Math.max(p[k], q[k], r[k]) < min || Math.min(p[k], q[k], r[k]) > max;
    if (off('x', clip.minX, clip.maxX) || off('y', clip.minY, clip.maxY)) continue;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
    ctx.lineTo(r.x, r.y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  for (const run of l.runs) {
    const px = (run.height / CAP_HEIGHT_EM) * v.scale;
    if (px < MIN_TEXT_PX) continue; // too small to read; canvas would draw a smudge
    const at = worldToScreen(v, run.at);
    ctx.font = `${px}px ${TEXT_FONT}`;
    ctx.fillText(run.text, at.x, at.y);
  }
}

function drawCursorMark(ctx: CanvasRenderingContext2D, s: Vec2): void {
  ctx.strokeStyle = COLORS.cursor;
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.strokeRect(s.x - CURSOR_MARK_PX, s.y - CURSOR_MARK_PX, CURSOR_MARK_PX * 2, CURSOR_MARK_PX * 2);
}

function drawGrip(ctx: CanvasRenderingContext2D, s: Vec2, color: string): void {
  const x = Math.round(s.x) - GRIP_PX;
  const y = Math.round(s.y) - GRIP_PX;
  ctx.fillStyle = color;
  ctx.fillRect(x, y, GRIP_PX * 2, GRIP_PX * 2);
  ctx.strokeStyle = COLORS.gripEdge;
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.strokeRect(x - 0.5, y - 0.5, GRIP_PX * 2 + 1, GRIP_PX * 2 + 1);
}

/** Window: solid blue edge. Crossing: dashed green edge. Both lightly filled. */
function drawSelectBox(ctx: CanvasRenderingContext2D, b: NonNullable<Overlay['selectBox']>): void {
  const x = Math.min(b.from.x, b.to.x);
  const y = Math.min(b.from.y, b.to.y);
  const w = Math.abs(b.to.x - b.from.x);
  const h = Math.abs(b.to.y - b.from.y);
  const crossing = b.mode === 'crossing';
  ctx.fillStyle = crossing ? COLORS.crossingFill : COLORS.windowFill;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = crossing ? COLORS.crossingEdge : COLORS.windowEdge;
  ctx.lineWidth = 1;
  ctx.setLineDash(crossing ? [6, 4] : []);
  ctx.strokeRect(x + 0.5, y + 0.5, w, h);
  ctx.setLineDash([]);
}

/** The snap's glyph (AutoCAD's shapes) at `s`, with its name in a tooltip above right, clear of the input boxes. */
function drawSnapMark(ctx: CanvasRenderingContext2D, s: Vec2, kind: SnapKind, deferred: boolean): void {
  const r = SNAP_MARK_PX;
  ctx.strokeStyle = COLORS.snap;
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  ctx.beginPath();
  switch (kind) {
    case 'end':
      ctx.rect(s.x - r, s.y - r, 2 * r, 2 * r);
      break;
    case 'mid':
      ctx.moveTo(s.x, s.y - r);
      ctx.lineTo(s.x + r, s.y + r);
      ctx.lineTo(s.x - r, s.y + r);
      ctx.closePath();
      break;
    case 'cen':
      ctx.arc(s.x, s.y, r, 0, 2 * Math.PI);
      break;
    case 'quad':
      ctx.moveTo(s.x, s.y - r);
      ctx.lineTo(s.x + r, s.y);
      ctx.lineTo(s.x, s.y + r);
      ctx.lineTo(s.x - r, s.y);
      ctx.closePath();
      break;
    case 'int':
      ctx.moveTo(s.x - r, s.y - r);
      ctx.lineTo(s.x + r, s.y + r);
      ctx.moveTo(s.x + r, s.y - r);
      ctx.lineTo(s.x - r, s.y + r);
      break;
    case 'perp':
      // ⊥ with the corner square
      ctx.moveTo(s.x - r, s.y - r);
      ctx.lineTo(s.x - r, s.y + r);
      ctx.lineTo(s.x + r, s.y + r);
      ctx.moveTo(s.x - r, s.y);
      ctx.lineTo(s.x, s.y);
      ctx.lineTo(s.x, s.y + r);
      break;
    case 'tan':
      ctx.arc(s.x, s.y, r, 0, 2 * Math.PI);
      ctx.moveTo(s.x - r, s.y - r);
      ctx.lineTo(s.x + r, s.y - r);
      break;
    case 'nea':
      // hourglass
      ctx.moveTo(s.x - r, s.y - r);
      ctx.lineTo(s.x + r, s.y - r);
      ctx.lineTo(s.x - r, s.y + r);
      ctx.lineTo(s.x + r, s.y + r);
      ctx.closePath();
      break;
    case 'node':
      ctx.arc(s.x, s.y, r, 0, 2 * Math.PI);
      ctx.moveTo(s.x - r * 0.7, s.y - r * 0.7);
      ctx.lineTo(s.x + r * 0.7, s.y + r * 0.7);
      ctx.moveTo(s.x + r * 0.7, s.y - r * 0.7);
      ctx.lineTo(s.x - r * 0.7, s.y + r * 0.7);
      break;
  }
  ctx.stroke();

  const label = deferred ? `Deferred ${SNAP_LABEL[kind]}` : SNAP_LABEL[kind];
  ctx.font = '12px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  const w = ctx.measureText(label).width + 10;
  const x = s.x + r + 8;
  const y = s.y - r - 8 - 18;
  ctx.fillStyle = COLORS.snap;
  ctx.fillRect(x, y, w, 18);
  ctx.fillStyle = COLORS.tooltipText;
  ctx.fillText(label, x + 5, y + 9);
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

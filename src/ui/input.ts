import type { Vec2 } from '../geometry/vec';

/** Zoom change per pixel of wheel scroll. One notch of a mouse wheel (~100px) zooms ~16%. */
const ZOOM_PER_PIXEL = 0.0015;
/** Pixels per line when the browser reports wheel deltas in lines. */
const PIXELS_PER_LINE = 16;
/** WheelEvent.DOM_DELTA_LINE, written out so this module loads outside a browser. */
const DOM_DELTA_LINE = 1;
/** Two middle clicks within this many ms count as a double click (Zoom Extents). */
const DOUBLE_CLICK_MS = 400;

/**
 * Scale factor for one wheel event. Scrolling up (negative deltaY) zooms in.
 * Exponential, so many small trackpad events zoom as smoothly as one notch.
 */
export function wheelZoomFactor(deltaY: number, deltaMode: number): number {
  const px = deltaMode === DOM_DELTA_LINE ? deltaY * PIXELS_PER_LINE : deltaY;
  return Math.exp(-px * ZOOM_PER_PIXEL);
}

/** Zoom per pixel of a trackpad pinch, which sends much smaller deltas than a wheel. */
const PINCH_ZOOM_PER_PIXEL = 0.01;

/** What plain two-finger scroll (or a mouse wheel) does. Pinch always zooms. */
export type ScrollMode = 'pan' | 'zoom';

export type WheelAction = { readonly kind: 'zoom'; readonly factor: number } | { readonly kind: 'pan'; readonly dx: number; readonly dy: number };

/**
 * Maps a wheel event to a view change. A trackpad pinch arrives as a wheel
 * event with ctrlKey set and always zooms. Otherwise `mode` decides: 'pan'
 * suits a trackpad (content follows the fingers), 'zoom' suits a mouse wheel.
 */
export function wheelAction(
  deltaX: number,
  deltaY: number,
  deltaMode: number,
  ctrlKey: boolean,
  mode: ScrollMode,
): WheelAction {
  const k = deltaMode === DOM_DELTA_LINE ? PIXELS_PER_LINE : 1;
  if (ctrlKey) return { kind: 'zoom', factor: Math.exp(-deltaY * k * PINCH_ZOOM_PER_PIXEL) };
  if (mode === 'zoom') return { kind: 'zoom', factor: wheelZoomFactor(deltaY, deltaMode) };
  return { kind: 'pan', dx: -deltaX * k, dy: -deltaY * k };
}

export type CanvasHandlers = {
  zoomAt(screen: Vec2, factor: number): void;
  pan(dxPx: number, dyPx: number): void;
  zoomExtents(): void;
  cursor(screen: Vec2 | undefined): void;
  /** Left click (press and release without dragging). */
  click(screen: Vec2, shift: boolean): void;
  /**
   * A left press, before anything else: true when it grabbed something (a
   * grip) that the drag now moves. Releasing after a drag calls `dragEnd`;
   * releasing in place calls nothing, leaving the grabbed thing for a click.
   */
  pressStartsDrag(screen: Vec2, shift: boolean): boolean;
  dragEnd(screen: Vec2): void;
  /** True when a left drag should draw a selection box (no tool waiting for input). */
  leftDragSelects(): boolean;
  /** True when a left drag should draw a path across the objects (Trim by scribble). */
  leftDragStrokes(): boolean;
  /** The path dragged so far, canvas-local pixels; `done` on release. */
  stroke(points: readonly Vec2[], done: boolean): void;
  /** A selection box being dragged from `from` to `to`; `done` on release. */
  box(from: Vec2, to: Vec2, done: boolean, shift: boolean): void;
  /** Right click, in page coordinates for placing a menu. */
  contextMenu(pageX: number, pageY: number): void;
  /** True when a left drag should pan (Space held, or the Pan button is on). */
  leftDragPans(): boolean;
  /** Called when panning starts or stops, to show a grab cursor. */
  panningChanged(panning: boolean): void;
  scrollMode(): ScrollMode;
};

/** A left press that moves less than this many pixels counts as a click. */
const CLICK_SLOP_PX = 4;

/**
 * Wheel or pinch zoom at the cursor; two-finger scroll pan; pan by middle-drag, or left-drag while Space is
 * held or the Pan button is on; double-middle-click Zoom Extents; left click;
 * right-click menu.
 */
export function bindCanvasInput(canvas: HTMLCanvasElement, h: CanvasHandlers): void {
  /** Last pointer position of an active pan, and which button started it. */
  let pan: { at: Vec2; button: number } | undefined;
  let lastMiddleDown = 0;
  let leftDown: Vec2 | undefined;
  /** Where a selection-box drag started, canvas-local, once it has moved past the click slop. */
  let boxFrom: Vec2 | undefined;
  /** A press that grabbed a grip: where it started, in client pixels. */
  let grabbed: Vec2 | undefined;
  /** A path being dragged, canvas-local, once it has moved past the click slop. */
  let path: Vec2[] | undefined;

  const local = (e: MouseEvent): Vec2 => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const startPan = (e: PointerEvent): void => {
    pan = { at: { x: e.clientX, y: e.clientY }, button: e.button };
    canvas.setPointerCapture(e.pointerId);
    h.panningChanged(true);
  };

  const endPan = (e: PointerEvent): void => {
    if (!pan || (e.type === 'pointerup' && e.button !== pan.button)) return;
    pan = undefined;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    h.panningChanged(false);
  };

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const a = wheelAction(e.deltaX, e.deltaY, e.deltaMode, e.ctrlKey, h.scrollMode());
      if (a.kind === 'zoom') h.zoomAt(local(e), a.factor);
      else h.pan(a.dx, a.dy);
    },
    { passive: false },
  );

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button === 0) {
      if (h.leftDragPans()) {
        startPan(e);
        return;
      }
      boxFrom = undefined;
      path = undefined;
      if (h.pressStartsDrag(local(e), e.shiftKey)) {
        grabbed = { x: e.clientX, y: e.clientY };
        canvas.setPointerCapture(e.pointerId);
        return;
      }
      leftDown = { x: e.clientX, y: e.clientY };
      return;
    }
    if (e.button !== 1) return;
    e.preventDefault(); // stop the browser's middle-click autoscroll
    const now = performance.now();
    if (now - lastMiddleDown < DOUBLE_CLICK_MS) {
      h.zoomExtents();
      lastMiddleDown = 0;
      return;
    }
    lastMiddleDown = now;
    startPan(e);
  });

  canvas.addEventListener('pointermove', (e) => {
    h.cursor(local(e));
    if (leftDown && !pan) {
      const moved = Math.hypot(e.clientX - leftDown.x, e.clientY - leftDown.y);
      if (!boxFrom && !path && moved > CLICK_SLOP_PX && h.leftDragStrokes()) {
        const r = canvas.getBoundingClientRect();
        path = [{ x: leftDown.x - r.left, y: leftDown.y - r.top }];
        canvas.setPointerCapture(e.pointerId);
      }
      if (path) {
        path.push(local(e));
        h.stroke(path, false);
      }
      if (!boxFrom && !path && moved > CLICK_SLOP_PX && h.leftDragSelects()) {
        const r = canvas.getBoundingClientRect();
        boxFrom = { x: leftDown.x - r.left, y: leftDown.y - r.top };
        canvas.setPointerCapture(e.pointerId); // keep the box going outside the canvas
      }
      if (boxFrom) h.box(boxFrom, local(e), false, e.shiftKey);
    }
    if (!pan) return;
    h.pan(e.clientX - pan.at.x, e.clientY - pan.at.y);
    pan.at = { x: e.clientX, y: e.clientY };
  });

  canvas.addEventListener('pointerup', (e) => {
    if (pan) {
      endPan(e);
      return;
    }
    if (grabbed && e.button === 0) {
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      const moved = Math.hypot(e.clientX - grabbed.x, e.clientY - grabbed.y);
      grabbed = undefined;
      if (moved > CLICK_SLOP_PX) h.dragEnd(local(e));
      return;
    }
    if (e.button !== 0 || !leftDown) return;
    const moved = Math.hypot(e.clientX - leftDown.x, e.clientY - leftDown.y);
    leftDown = undefined;
    if (path) {
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      const done = [...path, local(e)];
      path = undefined;
      h.stroke(done, true);
    } else if (boxFrom) {
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      const from = boxFrom;
      boxFrom = undefined;
      h.box(from, local(e), true, e.shiftKey);
    } else if (moved <= CLICK_SLOP_PX) h.click(local(e), e.shiftKey);
  });
  canvas.addEventListener('pointercancel', endPan);
  canvas.addEventListener('pointerleave', () => {
    if (!pan) h.cursor(undefined);
  });
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    h.contextMenu(e.pageX, e.pageY);
  });
  canvas.addEventListener('auxclick', (e) => e.preventDefault());
}

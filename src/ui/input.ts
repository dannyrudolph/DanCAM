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

export type CanvasHandlers = {
  zoomAt(screen: Vec2, factor: number): void;
  pan(dxPx: number, dyPx: number): void;
  zoomExtents(): void;
  cursor(screen: Vec2 | undefined): void;
  /** Left click (press and release without dragging). */
  click(screen: Vec2): void;
  /** Right click, in page coordinates for placing a menu. */
  contextMenu(pageX: number, pageY: number): void;
  /** True when a left drag should pan (Space held, or the Pan button is on). */
  leftDragPans(): boolean;
  /** Called when panning starts or stops, to show a grab cursor. */
  panningChanged(panning: boolean): void;
};

/** A left press that moves less than this many pixels counts as a click. */
const CLICK_SLOP_PX = 4;

/**
 * Wheel zoom at the cursor; pan by middle-drag, or left-drag while Space is
 * held or the Pan button is on; double-middle-click Zoom Extents; left click;
 * right-click menu.
 */
export function bindCanvasInput(canvas: HTMLCanvasElement, h: CanvasHandlers): void {
  /** Last pointer position of an active pan, and which button started it. */
  let pan: { at: Vec2; button: number } | undefined;
  let lastMiddleDown = 0;
  let leftDown: Vec2 | undefined;

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
      h.zoomAt(local(e), wheelZoomFactor(e.deltaY, e.deltaMode));
    },
    { passive: false },
  );

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button === 0) {
      if (h.leftDragPans()) {
        startPan(e);
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
    if (!pan) return;
    h.pan(e.clientX - pan.at.x, e.clientY - pan.at.y);
    pan.at = { x: e.clientX, y: e.clientY };
  });

  canvas.addEventListener('pointerup', (e) => {
    if (pan) {
      endPan(e);
      return;
    }
    if (e.button !== 0 || !leftDown) return;
    const moved = Math.hypot(e.clientX - leftDown.x, e.clientY - leftDown.y);
    leftDown = undefined;
    if (moved <= CLICK_SLOP_PX) h.click(local(e));
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

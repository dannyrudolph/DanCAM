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
};

/** Wheel zoom at the cursor, middle-drag pan, double-middle-click Zoom Extents. */
export function bindCanvasInput(canvas: HTMLCanvasElement, h: CanvasHandlers): void {
  let panning: Vec2 | undefined;
  let lastMiddleDown = 0;

  const local = (e: MouseEvent): Vec2 => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
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
    if (e.button !== 1) return;
    e.preventDefault(); // stop the browser's middle-click autoscroll
    const now = performance.now();
    if (now - lastMiddleDown < DOUBLE_CLICK_MS) {
      h.zoomExtents();
      lastMiddleDown = 0;
      return;
    }
    lastMiddleDown = now;
    panning = { x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', (e) => {
    h.cursor(local(e));
    if (!panning) return;
    h.pan(e.clientX - panning.x, e.clientY - panning.y);
    panning = { x: e.clientX, y: e.clientY };
  });

  const endPan = (e: PointerEvent): void => {
    if (e.button !== 1 && e.type === 'pointerup') return;
    panning = undefined;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  };
  canvas.addEventListener('pointerup', endPan);
  canvas.addEventListener('pointercancel', endPan);
  canvas.addEventListener('pointerleave', () => {
    if (!panning) h.cursor(undefined);
  });
  canvas.addEventListener('auxclick', (e) => e.preventDefault());
}

import { type Transform, rotation, transformPoint, translation } from './transform';
import type { Vec2 } from './vec';

/**
 * Where each copy of a rectangular array goes: `rows` × `cols` cells,
 * `rowSpacing` apart in Y and `colSpacing` apart in X (negative runs down or
 * left). The original's cell (0, 0) is left out.
 */
export function rectangularArray(rows: number, cols: number, rowSpacing: number, colSpacing: number): Transform[] {
  const out: Transform[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (r === 0 && c === 0) continue;
      out.push({ kind: 'translate', dx: c * colSpacing, dy: r * rowSpacing });
    }
  }
  return out;
}

/**
 * Where each copy of a polar array goes: `count` items about `center`,
 * spread over `fillDeg` counter-clockwise (negative: clockwise). A full
 * 360° spaces them evenly round the circle; less puts the last item at the
 * end of the fill. With `rotateItems` off, copies are moved, not turned,
 * keeping `ref` (a point of the objects) on the circle. The original is
 * left out.
 */
export function polarArray(center: Vec2, count: number, fillDeg: number, rotateItems: boolean, ref: Vec2): Transform[] {
  const full = Math.abs(fillDeg) >= 360;
  const step = full ? Math.sign(fillDeg) * (360 / count) : fillDeg / (count - 1);
  const out: Transform[] = [];
  for (let i = 1; i < count; i++) {
    const turn = rotation(center, i * step);
    out.push(rotateItems ? turn : translation(ref, transformPoint(turn, ref)));
  }
  return out;
}

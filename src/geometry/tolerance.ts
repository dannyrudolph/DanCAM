/**
 * The one shared tolerance for geometric comparisons, in drawing units (CAD-4).
 * Never hard-code an epsilon elsewhere; import this.
 */
export const TOL = 1e-9;

/** True when a and b differ by no more than `tol` (absolute, in drawing units). */
export function nearlyEqual(a: number, b: number, tol: number = TOL): boolean {
  return Math.abs(a - b) <= tol;
}

/** True when |a| is within `tol` of zero. */
export function nearlyZero(a: number, tol: number = TOL): boolean {
  return Math.abs(a) <= tol;
}

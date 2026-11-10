/** 3D vectors, for reading solid models (STEP import). Plain math, like `vec`. */
export type Vec3 = { readonly x: number; readonly y: number; readonly z: number };

export const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
export const add3 = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub3 = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale3 = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
export const dot3 = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross3 = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
export const length3 = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);

/** `a` scaled to length 1; undefined for the zero vector. */
export function unit3(a: Vec3): Vec3 | undefined {
  const l = length3(a);
  return l === 0 ? undefined : scale3(a, 1 / l);
}

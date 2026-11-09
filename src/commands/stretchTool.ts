import type { BBox } from '../geometry/bbox';
import { curveTouchesBox } from '../geometry/curve';
import { stretchCurve } from '../geometry/stretch';
import { type Vec2, sub } from '../geometry/vec';
import type { Drawing } from '../model/drawing';
import { type Entity, entityCurve, entityFromCurve } from '../model/entity';
import { point } from './editTools';
import type { ToolDef, ToolGen } from './tool';
import { PREVIEW_ID } from './toolSteps';

const boxOf = (a: Vec2, b: Vec2): BBox => ({ minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) });

/** The window drawn as four preview lines. */
function windowLines(b: BBox, layer: string): Entity[] {
  const c = [
    { x: b.minX, y: b.minY },
    { x: b.maxX, y: b.minY },
    { x: b.maxX, y: b.maxY },
    { x: b.minX, y: b.maxY },
  ];
  return c.map((p, i) => ({ kind: 'line', id: PREVIEW_ID, layer, style: 'hidden', start: p, end: c[(i + 1) % 4]! }));
}

/**
 * The entity stretched by `delta`, or undefined when nothing of it is inside
 * the window. A dimension's measured points and dimension-line point move
 * one by one, as in AutoCAD.
 */
function stretched(e: Entity, box: BBox, delta: Vec2): Entity | undefined {
  const inside = (p: Vec2): boolean => p.x >= box.minX && p.x <= box.maxX && p.y >= box.minY && p.y <= box.maxY;
  const mv = (p: Vec2): Vec2 => (inside(p) ? { x: p.x + delta.x, y: p.y + delta.y } : p);
  if (e.kind === 'point') return inside(e.at) ? { ...e, at: mv(e.at) } : undefined;
  if (e.kind === 'dimension') return [e.p1, e.p2, e.at].some(inside) ? { ...e, p1: mv(e.p1), p2: mv(e.p2), at: mv(e.at) } : undefined;
  const c = entityCurve(e)!;
  const s = stretchCurve(c, box, delta);
  return s && entityFromCurve(e, s);
}

/** Visible objects the crossing window touches. */
function touched(d: Drawing, box: BBox): Entity[] {
  return [...d.entities.values()].filter((e) => {
    if (d.layers.get(e.layer)?.visible === false) return false;
    if (e.kind === 'point' || e.kind === 'dimension') return stretched(e, box, { x: 0, y: 0 }) !== undefined;
    return curveTouchesBox(entityCurve(e)!, box);
  });
}

/**
 * Stretch (Shift+S): a crossing window picked by two corners, then a base
 * point and a second point. Line ends, arc ends, centers, bases and points
 * inside the window move; objects wholly inside move whole. One undo step.
 */
export const stretchTool: ToolDef = {
  id: 'stretch',
  label: 'Stretch',
  shortcut: 'shift+s',
  repeat: false,
  *run(ctx): ToolGen {
    const a = yield* point({ prompt: 'Stretch: pick the first corner of the crossing window' });
    if (!a) return;
    const layer = ctx.newProps().layer;
    const b = yield* point({ prompt: 'Stretch: pick the opposite corner', preview: (p) => windowLines(boxOf(a, p), layer) });
    if (!b) return;
    const box = boxOf(a, b);
    const es = touched(ctx.drawing, box);
    if (es.length === 0) {
      ctx.message('Stretch: the window touches nothing.');
      return;
    }
    const moved = (delta: Vec2): Entity[] => es.flatMap((e) => stretched(e, box, delta) ?? []);
    const base = yield* point({ prompt: 'Stretch: pick the base point', preview: () => windowLines(box, layer) });
    if (!base) return;
    const to = yield* point({ prompt: 'Stretch: pick the second point', base, preview: (p) => moved(sub(p, base)).map((e) => ({ ...e, id: PREVIEW_ID })) });
    if (!to) return;
    const delta = sub(to, base);
    const changes = es.flatMap((e) => {
      const after = stretched(e, box, delta);
      return after ? [{ op: 'modify' as const, before: e, after }] : [];
    });
    if (changes.length > 0) ctx.undo.commit({ label: 'Stretch', changes });
  },
};

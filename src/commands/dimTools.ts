import { cosSinDeg } from '../geometry/angle';
import { arcEnd, arcStart } from '../geometry/arc';
import { lineLine } from '../geometry/intersect';
import { TOL } from '../geometry/tolerance';
import { type Vec2, cross, distance, dot, sub, vecNearlyEqual } from '../geometry/vec';
import type { DimensionEntity, EntityId, LineEntity } from '../model/entity';
import type { Request, ToolContext, ToolDef, ToolGen, ToolInput, ToolOption } from './tool';
import { MethodChoice, PREVIEW_ID, addEntity } from './toolSteps';

const H: Vec2 = { x: 1, y: 0 };
const V: Vec2 = { x: 0, y: 1 };

/**
 * Horizontal or vertical from where the dimension line is dragged, as in
 * AutoCAD: beside the two points (outside their span in X by more than in
 * Y) gives a vertical dimension; above or below gives a horizontal one.
 */
export function linearDirFor(p1: Vec2, p2: Vec2, cursor: Vec2): Vec2 {
  const outside = (c: number, a: number, b: number): number => Math.max(Math.min(a, b) - c, 0, c - Math.max(a, b));
  return outside(cursor.x, p1.x, p2.x) > outside(cursor.y, p1.y, p2.y) ? V : H;
}

type Orientation = 'auto' | 'h' | 'v';
const ORIENT_PREFIX = 'orient:';
const ORIENTATIONS: readonly { key: Orientation; label: string }[] = [
  { key: 'auto', label: 'Auto H/V' },
  { key: 'h', label: 'Horizontal' },
  { key: 'v', label: 'Vertical' },
];

/**
 * Linear and Aligned dimensions: two points (snaps apply) or one line, then
 * the dimension line's position, previewed as the cursor moves. Each
 * dimension is its own undo step; the tool starts again for the next.
 * Linear is horizontal or vertical by drag direction, or forced by the
 * options bar; both choices are remembered for the session.
 */
function createDimTool(type: 'linear' | 'aligned'): ToolDef {
  const name = type === 'linear' ? 'Linear' : 'Aligned';
  const method = new MethodChoice<'points' | 'object'>(
    [
      { key: 'points', label: 'Two points' },
      { key: 'object', label: 'Pick a line' },
    ],
    'points',
  );
  let orientation: Orientation = 'auto';

  return {
    id: type === 'linear' ? 'dimLinear' : 'dimAligned',
    label: `${name} dimension`,
    shortcut: type === 'linear' ? 'shift+d' : 'g',
    *run(ctx): ToolGen {
      let p1: Vec2 | undefined;
      let p2: Vec2 | undefined;
      let refs: EntityId[] | undefined;
      if (method.current === 'points') {
        p1 = yield* method.point({ prompt: `${name}: pick the first point to measure from` });
        if (!p1) return;
        const first = p1;
        p2 = yield* method.point({ prompt: `${name}: pick the second point`, base: first });
        if (!p2) return;
      } else {
        const pick = yield* method.entity(ctx, { prompt: `${name}: pick a line to dimension`, accepts: (e) => e.kind === 'line' });
        if (!pick || pick.entity.kind !== 'line') return;
        p1 = pick.entity.start;
        p2 = pick.entity.end;
        refs = [pick.entity.id];
      }
      if (vecNearlyEqual(p1, p2)) {
        ctx.message('The two points are the same; there is nothing to measure.');
        return;
      }
      const a = p1;
      const b = p2;
      const dimension = (id: EntityId, at: Vec2): DimensionEntity => {
        const base = { kind: 'dimension' as const, id, layer: ctx.newProps().layer, dimStyle: ctx.drawing.currentDimStyle, p1: a, p2: b, at, ...(refs && { refs }) };
        if (type === 'aligned') return { ...base, type };
        const dir = orientation === 'h' ? H : orientation === 'v' ? V : linearDirFor(a, b, at);
        return { ...base, type, dir };
      };
      for (;;) {
        const options: ToolOption[] =
          type === 'linear' ? ORIENTATIONS.map((o) => ({ key: ORIENT_PREFIX + o.key, label: o.label, enabled: true, active: o.key === orientation })) : [];
        const input = yield {
          kind: 'point',
          prompt: `${name}: pick where the dimension line goes`,
          preview: (p) => [dimension(PREVIEW_ID, p)],
          options,
        };
        if (input.kind === 'finish') return;
        if (input.kind === 'option' && input.key.startsWith(ORIENT_PREFIX)) {
          const o = ORIENTATIONS.find((x) => ORIENT_PREFIX + x.key === input.key);
          if (o) orientation = o.key;
          continue;
        }
        if (input.kind !== 'point') continue;
        addEntity(ctx, `${name} dimension`, (id) => dimension(id, input.at));
        return;
      }
    },
  };
}

export const createLinearDimTool = (): ToolDef => createDimTool('linear');
export const createAlignedDimTool = (): ToolDef => createDimTool('aligned');

/** Makes the dimension for a placement point; undefined when it can't be placed there. */
type MakeDim = (id: EntityId, at: Vec2) => DimensionEntity | undefined;

/** The placement step: previews as the cursor moves, then adds the dimension as one undo step. */
function* place(ctx: ToolContext, name: string, prompt: string, make: MakeDim): Generator<Request, void, ToolInput> {
  for (;;) {
    const input = yield {
      kind: 'point',
      prompt: `${name}: ${prompt}`,
      preview: (p) => {
        const d = make(PREVIEW_ID, p);
        return d ? [d] : [];
      },
    };
    if (input.kind === 'finish') return;
    if (input.kind !== 'point') continue;
    const at = input.at;
    if (!make(PREVIEW_ID, at)) continue;
    addEntity(ctx, `${name} dimension`, (id) => make(id, at)!);
    return;
  }
}

/**
 * Radius and Diameter: pick an arc or circle, then where the text goes. Outside
 * the circle the text sits on a leader pointing at the center; inside, on the
 * radius or diameter line. Sticky; each dimension one undo step.
 */
function createRadialTool(type: 'radius' | 'diameter'): ToolDef {
  const name = type === 'radius' ? 'Radius' : 'Diameter';
  return {
    id: type === 'radius' ? 'dimRadius' : 'dimDiameter',
    label: `${name} dimension`,
    shortcut: type === 'radius' ? 'shift+r' : 'shift+o',
    *run(ctx): ToolGen {
      for (;;) {
        const input = yield { kind: 'entity', prompt: `${name}: pick an arc or circle`, accepts: (e) => e.kind === 'arc' || e.kind === 'circle' };
        if (input.kind === 'finish') return;
        if (input.kind !== 'entity') continue;
        const e = ctx.drawing.entities.get(input.id);
        if (e?.kind !== 'arc' && e?.kind !== 'circle') continue;
        const layer = ctx.newProps().layer;
        yield* place(ctx, name, 'pick where the text goes', (id, at) => ({
          kind: 'dimension',
          id,
          layer,
          dimStyle: ctx.drawing.currentDimStyle,
          type,
          center: e.center,
          radius: e.radius,
          at,
          refs: [e.id],
        }));
        return;
      }
    },
  };
}

export const createRadiusDimTool = (): ToolDef => createRadialTool('radius');
export const createDiameterDimTool = (): ToolDef => createRadialTool('diameter');

const unit = (v: Vec2): Vec2 => {
  const l = Math.hypot(v.x, v.y);
  return { x: v.x / l, y: v.y / l };
};

/**
 * The angle between two lines, in the quadrant where `at` is: each arm runs
 * from the lines' crossing along the line, toward `at`'s side. An arm's
 * extension line starts at the end of its line farthest along it, or at the
 * crossing when the line doesn't reach that side. Undefined for parallel lines.
 */
export function angleBetweenLines(l1: LineEntity, l2: LineEntity, at: Vec2): Pick<Extract<DimensionEntity, { type: 'angular' }>, 'vertex' | 'p1' | 'p2' | 'dir1' | 'dir2'> | undefined {
  const d1 = unit(sub(l1.end, l1.start));
  const d2 = unit(sub(l2.end, l2.start));
  const vertex = lineLine(l1.start, d1, l2.start, d2);
  if (!vertex) return undefined;
  // at - vertex = α d1 + β d2: the signs pick the quadrant.
  const w = sub(at, vertex);
  const den = cross(d1, d2);
  const s1 = cross(w, d2) / den >= 0 ? 1 : -1;
  const s2 = cross(d1, w) / den >= 0 ? 1 : -1;
  const dir1 = { x: d1.x * s1 || 0, y: d1.y * s1 || 0 };
  const dir2 = { x: d2.x * s2 || 0, y: d2.y * s2 || 0 };
  const armStart = (l: LineEntity, d: Vec2): Vec2 => {
    const [a, b] = [l.start, l.end].map((p) => ({ p, t: dot(sub(p, vertex), d) })) as [{ p: Vec2; t: number }, { p: Vec2; t: number }];
    const far = a.t >= b.t ? a : b;
    return far.t > TOL ? far.p : vertex;
  };
  return { vertex, p1: armStart(l1, dir1), p2: armStart(l2, dir2), dir1, dir2 };
}

/**
 * Angular: two lines (the quadrant follows the cursor), an arc (its
 * included angle, or the rest of the turn on the other side), or a vertex
 * and two points (snaps apply; the reflex angle on the far side). Then the
 * arc's position. Sticky; the method is remembered for the session.
 */
export function createAngularDimTool(): ToolDef {
  const name = 'Angular';
  const method = new MethodChoice<'lines' | 'arc' | 'vertex'>(
    [
      { key: 'lines', label: 'Two lines' },
      { key: 'arc', label: 'Arc' },
      { key: 'vertex', label: 'Vertex + 2 points' },
    ],
    'lines',
  );
  return {
    id: 'dimAngular',
    label: 'Angular dimension',
    shortcut: 'shift+g',
    *run(ctx): ToolGen {
      const layer = ctx.newProps().layer;
      const dim = (id: EntityId, at: Vec2, arms: Pick<Extract<DimensionEntity, { type: 'angular' }>, 'vertex' | 'p1' | 'p2' | 'dir1' | 'dir2'>, refs: EntityId[]): DimensionEntity => ({
        kind: 'dimension',
        id,
        layer,
        dimStyle: ctx.drawing.currentDimStyle,
        type: 'angular',
        ...arms,
        at,
        ...(refs.length > 0 && { refs }),
      });
      const prompt = 'pick where the dimension arc goes';
      if (method.current === 'lines') {
        const isLine = (e: { kind: string }): boolean => e.kind === 'line';
        const first = yield* method.entity(ctx, { prompt: `${name}: pick the first line`, accepts: isLine });
        if (!first) return;
        const second = yield* method.entity(ctx, { prompt: `${name}: pick the second line`, accepts: (e) => isLine(e) && e.id !== first.entity.id });
        if (!second) return;
        const l1 = first.entity as LineEntity;
        const l2 = second.entity as LineEntity;
        if (!angleBetweenLines(l1, l2, l1.start)) {
          ctx.message('Those lines are parallel; there is no angle between them.');
          return;
        }
        yield* place(ctx, name, prompt, (id, at) => {
          const arms = angleBetweenLines(l1, l2, at);
          return arms && dim(id, at, arms, [l1.id, l2.id]);
        });
      } else if (method.current === 'arc') {
        const pick = yield* method.entity(ctx, { prompt: `${name}: pick an arc`, accepts: (e) => e.kind === 'arc' });
        if (!pick || pick.entity.kind !== 'arc') return;
        const a = pick.entity;
        const [c1, s1] = cosSinDeg(a.startDeg);
        const [c2, s2] = cosSinDeg(a.endDeg);
        const arms = { vertex: a.center, p1: arcStart(a), p2: arcEnd(a), dir1: { x: c1, y: s1 }, dir2: { x: c2, y: s2 } };
        yield* place(ctx, name, prompt, (id, at) => dim(id, at, arms, [a.id]));
      } else {
        const vertex = yield* method.point({ prompt: `${name}: pick the vertex` });
        if (!vertex) return;
        const p1 = yield* method.point({ prompt: `${name}: pick a point on the first side`, base: vertex });
        if (!p1) return;
        const p2 = yield* method.point({ prompt: `${name}: pick a point on the second side`, base: vertex });
        if (!p2) return;
        if (distance(p1, vertex) <= TOL || distance(p2, vertex) <= TOL) {
          ctx.message('A side point is on the vertex; there is no angle to measure.');
          return;
        }
        const arms = { vertex, p1, p2, dir1: unit(sub(p1, vertex)), dir2: unit(sub(p2, vertex)) };
        if (vecNearlyEqual(arms.dir1, arms.dir2)) {
          ctx.message('Both sides run the same way; there is no angle to measure.');
          return;
        }
        yield* place(ctx, name, prompt, (id, at) => dim(id, at, arms, []));
      }
    },
  };
}

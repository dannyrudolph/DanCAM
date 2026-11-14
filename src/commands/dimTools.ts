import { TOL } from '../geometry/tolerance';
import { arcEnd, arcStart } from '../geometry/arc';
import { type Vec2, cross, distance, dot, sub, vecNearlyEqual } from '../geometry/vec';
import type { Anchor, DimAnchors } from '../model/anchor';
import { angleBetweenLines, arcArms } from '../model/associate';
import { expandSymbols } from '../model/dimFormat';
import type { DimensionEntity, Entity, EntityId, LineEntity } from '../model/entity';

export { angleBetweenLines } from '../model/associate';
import type { Request, ToolContext, ToolDef, ToolGen, ToolInput, ToolOption } from './tool';
import { MethodChoice, PREVIEW_ID, addEntity, nearerEnd } from './toolSteps';

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

/** What a linear or aligned dimension measures: two points, what they are anchored to, and a fixed direction when it measures square to a line. */
export type Measure = { readonly p1: Vec2; readonly p2: Vec2; readonly anchors?: DimAnchors; readonly normal?: Vec2 };

/** A picked object and where it was clicked. */
export type Picked = { readonly entity: Entity; readonly at: Vec2 };

/** The objects a linear or aligned dimension measures: lines (chamfers too), arcs (fillets) and circles. */
export const isMeasurable = (e: Entity): boolean => e.kind === 'line' || e.kind === 'arc' || e.kind === 'circle';

/** One object on its own: a line end to end, an arc end to end (its chord). A circle needs a second object. */
export function measureObject(e: Entity): Measure | undefined {
  if (e.kind === 'line') return { p1: e.start, p2: e.end, anchors: { p1: { id: e.id, feature: 'start' }, p2: { id: e.id, feature: 'end' } } };
  if (e.kind === 'arc') return { p1: arcStart(e), p2: arcEnd(e), anchors: { p1: { id: e.id, feature: 'start' }, p2: { id: e.id, feature: 'end' } } };
  return undefined;
}

/** Where a picked object is measured from in a pair: a line's end nearest the click, an arc's or circle's center. */
function pairPoint(p: Picked): { at: Vec2; anchor: Anchor } | undefined {
  const e = p.entity;
  if (e.kind === 'line') {
    const start = distance(e.start, p.at) <= distance(e.end, p.at);
    return { at: start ? e.start : e.end, anchor: { id: e.id, feature: start ? 'start' : 'end' } };
  }
  if (e.kind === 'arc' || e.kind === 'circle') return { at: e.center, anchor: { id: e.id, feature: 'center' } };
  return undefined;
}

const lineDir = (e: Entity): Vec2 | undefined => (e.kind === 'line' ? unit(sub(e.end, e.start)) : undefined);

/**
 * Two objects (as Solid Edge's Smart Dimension): a line is measured from
 * its end nearest the click, an arc or circle from its center. An aligned
 * dimension between a line and a parallel line, or a line and a center,
 * measures square to the line (`normal`); otherwise, as a linear one, it
 * goes horizontal or vertical. Undefined when both are the same point.
 */
export function measureBetween(type: 'linear' | 'aligned', a: Picked, b: Picked): Measure | undefined {
  const pa = pairPoint(a);
  const pb = pairPoint(b);
  if (!pa || !pb || vecNearlyEqual(pa.at, pb.at)) return undefined;
  const m: Measure = { p1: pa.at, p2: pb.at, anchors: { p1: pa.anchor, p2: pb.anchor } };
  if (type !== 'aligned') return m;
  const da = lineDir(a.entity);
  const db = lineDir(b.entity);
  const square = da && db ? (Math.abs(cross(da, db)) <= TOL ? da : undefined) : (da ?? db);
  if (!square) return m;
  const normal = { x: -square.y || 0, y: square.x || 0 };
  // Points level with each other along the line: nothing square to it to measure.
  return Math.abs(dot(sub(m.p2, m.p1), normal)) <= TOL ? m : { ...m, normal };
}

/**
 * Linear and Aligned dimensions. The default, Objects: a line, arc or
 * circle under the cursor is picked (it highlights), then either a second
 * object to measure between them or the dimension line's position; off the
 * geometry, a click, snap or typed values give a first point instead.
 * Two points: points only, with snaps. The dimension line's position is
 * previewed as the cursor moves. Each dimension is its own undo step; the
 * tool starts again for the next. Linear is horizontal or vertical by drag
 * direction, or forced by the options bar; both choices are remembered for
 * the session.
 */
function createDimTool(type: 'linear' | 'aligned'): ToolDef {
  const name = type === 'linear' ? 'Linear' : 'Aligned';
  const method = new MethodChoice<'object' | 'points'>(
    [
      { key: 'object', label: 'Objects' },
      { key: 'points', label: 'Two points' },
    ],
    'object',
  );
  let orientation: Orientation = 'auto';

  return {
    id: type === 'linear' ? 'dimLinear' : 'dimAligned',
    label: `${name} dimension`,
    shortcut: type === 'linear' ? 'shift+d' : 'g',
    *run(ctx): ToolGen {
      let m: Measure | undefined;
      /** The object picked first, while a second can still be picked at the placement step. */
      let first: Picked | undefined;
      const points = function* (from?: { at: Vec2; anchor?: Anchor }): Generator<Request, Measure | undefined, ToolInput> {
        const p = from ?? (yield* method.anchoredPoint({ prompt: `${name}: pick the first point to measure from` }));
        if (!p) return undefined;
        const q = yield* method.anchoredPoint({ prompt: `${name}: pick the second point`, base: p.at });
        if (!q) return undefined;
        const anchors = pointAnchors({ p1: p.anchor, p2: q.anchor });
        return { p1: p.at, p2: q.at, ...(anchors && { anchors }) };
      };
      if (method.current === 'points') {
        m = yield* points();
        if (!m) return;
      } else {
        const pick = yield* method.objectOrPoint(ctx, { prompt: `${name}: pick a line, arc or circle (or a point)`, pick: isMeasurable });
        if (!pick) return;
        if (pick.kind === 'point') {
          m = yield* points(pick);
          if (!m) return;
        } else {
          first = { entity: pick.entity, at: pick.at };
          m = measureObject(pick.entity);
        }
      }
      if (m && vecNearlyEqual(m.p1, m.p2)) {
        ctx.message('The two points are the same; there is nothing to measure.');
        return;
      }
      const dimension = (meas: Measure, id: EntityId, at: Vec2): DimensionEntity => {
        const base = { kind: 'dimension' as const, id, layer: ctx.newProps().layer, dimStyle: ctx.drawing.currentDimStyle, p1: meas.p1, p2: meas.p2, at, ...(meas.anchors && { anchors: meas.anchors }) };
        if (meas.normal) return { ...base, type: 'linear', dir: meas.normal };
        if (type === 'aligned') return { ...base, type };
        const dir = orientation === 'h' ? H : orientation === 'v' ? V : linearDirFor(meas.p1, meas.p2, at);
        return { ...base, type, dir };
      };
      for (;;) {
        const options: ToolOption[] =
          type === 'linear' ? ORIENTATIONS.map((o) => ({ key: ORIENT_PREFIX + o.key, label: o.label, enabled: true, active: o.key === orientation })) : [];
        const one = first;
        const meas = m;
        const input = yield {
          kind: 'point',
          prompt: !meas ? `${name}: pick a second object to measure to` : one ? `${name}: pick where the dimension line goes, or a second object` : `${name}: pick where the dimension line goes`,
          ...(meas && { preview: (p: Vec2) => [dimension(meas, PREVIEW_ID, p)] }),
          ...(one && { pick: (e: Entity) => isMeasurable(e) && e.id !== one.entity.id }),
          options,
        };
        if (input.kind === 'finish') return;
        if (input.kind === 'option' && input.key.startsWith(ORIENT_PREFIX)) {
          const o = ORIENTATIONS.find((x) => ORIENT_PREFIX + x.key === input.key);
          if (o) orientation = o.key;
          continue;
        }
        if (input.kind === 'entity' && one) {
          const second = ctx.drawing.entities.get(input.id);
          if (!second || second.id === one.entity.id || !isMeasurable(second)) continue;
          const between = measureBetween(type, one, { entity: second, at: input.at });
          if (!between) {
            ctx.message('Those are measured from the same point; there is nothing between them.');
            continue;
          }
          m = between;
          first = undefined;
          continue;
        }
        if (input.kind !== 'point') continue;
        if (!meas) {
          ctx.message('A circle needs a second object to measure to; for its size use Diameter.');
          continue;
        }
        addEntity(ctx, `${name} dimension`, (id) => dimension(meas, id, input.at));
        return;
      }
    },
  };
}

export const createLinearDimTool = (): ToolDef => createDimTool('linear');
export const createAlignedDimTool = (): ToolDef => createDimTool('aligned');

/** Makes the dimension for a placement point; undefined when it can't be placed there. */
type MakeDim = (id: EntityId, at: Vec2) => DimensionEntity | undefined;

/** The placement step: previews as the cursor moves, then adds the dimension as one undo step. False when Enter ended it instead. */
function* place(ctx: ToolContext, name: string, prompt: string, make: MakeDim): Generator<Request, boolean, ToolInput> {
  for (;;) {
    const input = yield {
      kind: 'point',
      prompt: `${name}: ${prompt}`,
      preview: (p) => {
        const d = make(PREVIEW_ID, p);
        return d ? [d] : [];
      },
    };
    if (input.kind === 'finish') return false;
    if (input.kind !== 'point') continue;
    const at = input.at;
    if (!make(PREVIEW_ID, at)) continue;
    addEntity(ctx, `${name} dimension`, (id) => make(id, at)!);
    return true;
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
          anchors: { curve: e.id },
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

/** The point anchors that snaps gave, or none. */
function pointAnchors(ps: Partial<Record<'p1' | 'p2' | 'vertex', Anchor | undefined>>): DimAnchors | undefined {
  const out = Object.fromEntries(Object.entries(ps).filter(([, a]) => a !== undefined)) as DimAnchors;
  return Object.keys(out).length === 0 ? undefined : out;
}

/**
 * Angular: two lines (the quadrant follows the cursor; an arc picked
 * first gives its angle, as the Arc method does), an arc (its
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
      const dim = (id: EntityId, at: Vec2, arms: Pick<Extract<DimensionEntity, { type: 'angular' }>, 'vertex' | 'p1' | 'p2' | 'dir1' | 'dir2'>, anchors: DimAnchors | undefined): DimensionEntity => ({
        kind: 'dimension',
        id,
        layer,
        dimStyle: ctx.drawing.currentDimStyle,
        type: 'angular',
        ...arms,
        at,
        ...(anchors && { anchors }),
      });
      const prompt = 'pick where the dimension arc goes';
      if (method.current === 'lines') {
        const isLine = (e: { kind: string }): boolean => e.kind === 'line';
        const first = yield* method.entity(ctx, { prompt: `${name}: pick the first line, or an arc`, accepts: (e) => isLine(e) || e.kind === 'arc' });
        if (!first) return;
        if (first.entity.kind === 'arc') {
          const a = first.entity;
          const arms = arcArms(a);
          yield* place(ctx, name, prompt, (id, at) => dim(id, at, arms, { curve: a.id }));
          return;
        }
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
          return arms && dim(id, at, arms, { lines: [l1.id, l2.id] });
        });
      } else if (method.current === 'arc') {
        const pick = yield* method.entity(ctx, { prompt: `${name}: pick an arc`, accepts: (e) => e.kind === 'arc' });
        if (!pick || pick.entity.kind !== 'arc') return;
        const a = pick.entity;
        const arms = arcArms(a);
        yield* place(ctx, name, prompt, (id, at) => dim(id, at, arms, { curve: a.id }));
      } else {
        const v = yield* method.anchoredPoint({ prompt: `${name}: pick the vertex` });
        if (!v) return;
        const vertex = v.at;
        const s1 = yield* method.anchoredPoint({ prompt: `${name}: pick a point on the first side`, base: vertex });
        if (!s1) return;
        const s2 = yield* method.anchoredPoint({ prompt: `${name}: pick a point on the second side`, base: vertex });
        if (!s2) return;
        const p1 = s1.at;
        const p2 = s2.at;
        const anchors = pointAnchors({ vertex: v.anchor, p1: s1.anchor, p2: s2.anchor });
        if (distance(p1, vertex) <= TOL || distance(p2, vertex) <= TOL) {
          ctx.message('A side point is on the vertex; there is no angle to measure.');
          return;
        }
        const arms = { vertex, p1, p2, dir1: unit(sub(p1, vertex)), dir2: unit(sub(p2, vertex)) };
        if (vecNearlyEqual(arms.dir1, arms.dir2)) {
          ctx.message('Both sides run the same way; there is no angle to measure.');
          return;
        }
        yield* place(ctx, name, prompt, (id, at) => dim(id, at, arms, anchors));
      }
    },
  };
}

/** A line running parallel to the axis through `base` along `dir`, off it: one diameter all along. */
function isParallelEdge(e: LineEntity, base: Vec2, dir: Vec2): boolean {
  if (distance(e.start, e.end) <= TOL || Math.abs(cross(unit(sub(e.end, e.start)), dir)) > TOL) return false;
  return Math.abs(cross(sub(e.start, base), dir)) > TOL;
}

/** The lathe centerline: Y = 0, Z increasing. */
const LATHE_AXIS = { base: { x: 0, y: 0 }, dir: H } as const;

/**
 * Symmetric diameter (Shift+M): the centerline (the lathe axis in lathe
 * mode, or a picked line, ray or xline), then feature after feature, each
 * followed by where its dimension line goes, until Enter. Each reads Ø
 * twice the feature's distance from the axis; snapped features are
 * anchored, and so is a picked centerline. An edge parallel to the axis
 * under the cursor is picked before snaps, measured at its end nearer the
 * click (spec, "feature points or edges").
 */
export function createSymmetricDimTool(): ToolDef {
  const name = 'Symmetric diameter';
  const lathe = new MethodChoice<'axis' | 'pick'>(
    [
      { key: 'axis', label: 'Lathe axis' },
      { key: 'pick', label: 'Pick centerline' },
    ],
    'axis',
  );
  return {
    id: 'dimSymmetric',
    label: 'Symmetric diameter',
    shortcut: 'shift+m',
    *run(ctx): ToolGen {
      const method = ctx.drawing.lathe ? lathe : new MethodChoice<'axis' | 'pick'>([{ key: 'pick', label: 'Pick centerline' }], 'pick');
      let axis: { base: Vec2; dir: Vec2 } = LATHE_AXIS;
      let axisId: EntityId | undefined;
      if (method.current === 'pick') {
        const isAxis = (e: { kind: string }): boolean => e.kind === 'line' || e.kind === 'xline' || e.kind === 'ray';
        const pick = yield* method.entity(ctx, { prompt: `${name}: pick the centerline`, accepts: isAxis });
        if (!pick) return;
        const e = pick.entity;
        if (e.kind === 'line') axis = { base: e.start, dir: unit(sub(e.end, e.start)) };
        else if (e.kind === 'xline' || e.kind === 'ray') axis = { base: e.base, dir: e.dir };
        else return;
        axisId = e.id;
      }
      const { base, dir } = axis;
      const layer = ctx.newProps().layer;
      for (;;) {
        const isEdge = (e: Entity): boolean => e.kind === 'line' && e.id !== axisId && isParallelEdge(e, base, dir);
        const got = yield* method.objectOrPoint(ctx, { prompt: `${name}: pick an edge or a feature (Enter to finish)`, pick: isEdge, canFinish: true });
        if (!got) return;
        if (got.kind === 'object' && got.entity.kind !== 'line') continue;
        const feature: { at: Vec2; anchor?: Anchor } = got.kind === 'object' && got.entity.kind === 'line' ? nearerEnd(got.entity, got.at) : got;
        const p1 = feature.at;
        const along = dot(sub(p1, base), dir);
        const axisBase = { x: base.x + dir.x * along, y: base.y + dir.y * along };
        if (distance(p1, axisBase) <= TOL) {
          ctx.message('That point is on the centerline; pick a feature off it.');
          continue;
        }
        const anchors: DimAnchors = { ...(feature.anchor && { p1: feature.anchor }), ...(axisId !== undefined && { axis: axisId }) };
        const placed = yield* place(ctx, name, 'pick where the dimension line goes', (id, at) => ({
          kind: 'dimension',
          id,
          layer,
          dimStyle: ctx.drawing.currentDimStyle,
          type: 'symmetric',
          p1,
          axisBase,
          axisDir: dir,
          at,
          ...(Object.keys(anchors).length > 0 && { anchors }),
        }));
        if (!placed) return;
      }
    },
  };
}

/**
 * Leader / note: the arrow point (snaps apply), then the landing, where
 * the shoulder and text go, then the text, typed in a box there and
 * previewed as it is typed. %%d, %%c and %%p give °, Ø and ±. Enter adds
 * the leader as one undo step; empty text adds nothing. Sticky.
 */
export function createLeaderTool(): ToolDef {
  const name = 'Leader';
  return {
    id: 'dimLeader',
    label: 'Leader / note',
    shortcut: 'shift+n',
    *run(ctx): ToolGen {
      const layer = ctx.newProps().layer;
      const leader = (id: EntityId, tip: Vec2, at: Vec2, text: string): DimensionEntity => ({
        kind: 'dimension',
        id,
        layer,
        dimStyle: ctx.drawing.currentDimStyle,
        type: 'leader',
        tip,
        at,
        text,
      });
      let tip: Vec2 | undefined;
      let at: Vec2 | undefined;
      while (!tip) {
        const input = yield { kind: 'point', prompt: `${name}: pick where the arrow points` };
        if (input.kind === 'finish') return;
        if (input.kind === 'point') tip = input.at;
      }
      const from = tip;
      while (!at) {
        const input = yield {
          kind: 'point',
          prompt: `${name}: pick where the text goes`,
          base: from,
          preview: (p) => (vecNearlyEqual(p, from) ? [] : [leader(PREVIEW_ID, from, p, 'Text')]),
        };
        if (input.kind === 'finish') return;
        if (input.kind !== 'point') continue;
        if (vecNearlyEqual(input.at, from)) ctx.message('The text needs to go away from the arrow point.');
        else at = input.at;
      }
      const landing = at;
      for (;;) {
        const input = yield {
          kind: 'text',
          prompt: `${name}: type the note, then press Enter (%%d °, %%c Ø, %%p ±)`,
          at: landing,
          preview: (text) => [leader(PREVIEW_ID, from, landing, expandSymbols(text))],
        };
        if (input.kind === 'finish') return;
        if (input.kind !== 'text') continue;
        const text = expandSymbols(input.text).trim();
        if (text === '') {
          ctx.message('Type the note first; Esc leaves without one.');
          continue;
        }
        addEntity(ctx, 'Leader', (id) => leader(id, from, landing, text));
        return;
      }
    },
  };
}

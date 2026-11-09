import { type Circle, circle2P, circle3P } from '../geometry/circle';
import { type TangentTarget, nearestToPicks, tangentTangentRadius, tangentTangentTangent } from '../geometry/tangentCircles';
import { TOL } from '../geometry/tolerance';
import { type Vec2, add, distance } from '../geometry/vec';
import type { CircleEntity, Entity, EntityId, LineEntity } from '../model/entity';
import type { Request, ToolContext, ToolDef, ToolGen, ToolInput } from './tool';
import { MethodChoice, PREVIEW_ID, addEntity } from './toolSteps';

type CircleMethod = 'cr' | 'cd' | '2p' | '3p' | 'ttr' | 'ttt';

const METHODS = [
  { key: 'cr', label: 'Center, Radius' },
  { key: 'cd', label: 'Center, Diameter' },
  { key: '2p', label: '2-Point' },
  { key: '3p', label: '3-Point' },
  { key: 'ttr', label: 'Tan, Tan, Radius' },
  { key: 'ttt', label: 'Tan, Tan, Tan' },
] as const;

function circleEntity(ctx: ToolContext, id: EntityId, c: Circle): CircleEntity {
  return { kind: 'circle', id, ...ctx.newProps(), center: c.center, radius: c.radius };
}

function rubberBand(ctx: ToolContext, start: Vec2, end: Vec2): LineEntity {
  return { kind: 'line', id: PREVIEW_ID, ...ctx.newProps(), start, end };
}

/** Lines, xlines, circles and arcs can be tangent targets; arcs count as their full circle. */
export function tangentTarget(e: Entity): TangentTarget | undefined {
  switch (e.kind) {
    case 'line':
      return { kind: 'line', a: e.start, b: e.end };
    case 'xline':
    case 'ray':
      return { kind: 'line', a: e.base, b: add(e.base, e.dir) };
    case 'circle':
    case 'arc':
      return { kind: 'circle', center: e.center, radius: e.radius };
    case 'point':
      return undefined;
  }
}

const isTangentTarget = (e: Entity): boolean => tangentTarget(e) !== undefined;

const NOT_POSITIVE = 'The radius must be more than zero.';

/**
 * Circle by any of the spec's six methods, chosen in the options bar. The
 * method sticks between circles until another is chosen.
 */
export function createCircleTool(): ToolDef {
  const choice = new MethodChoice<CircleMethod>(METHODS, 'cr');
  const label = 'Circle';
  const commit = (ctx: ToolContext, c: Circle): void => void addEntity(ctx, label, (id) => circleEntity(ctx, id, c));
  const preview = (ctx: ToolContext, c: Circle | undefined): Entity[] => (c ? [circleEntity(ctx, PREVIEW_ID, c)] : []);

  return {
    id: 'circle',
    label,
    shortcut: 'c',
    *run(ctx): ToolGen {
      switch (choice.current) {
        case 'cr':
        case 'cd': {
          const diameter = choice.current === 'cd';
          const center = yield* choice.point({ prompt: 'Circle: pick the center' });
          if (!center) return;
          const toRadius = (v: number) => (diameter ? v / 2 : v);
          for (;;) {
            const r = yield* choice.value({
              prompt: diameter ? 'Circle: pick or type the diameter' : 'Circle: pick or type the radius',
              label: diameter ? 'Ø' : 'R',
              quantity: 'length',
              base: center,
              fromCursor: (p) => (diameter ? 2 : 1) * distance(center, p),
              preview: (v) => preview(ctx, { center, radius: toRadius(v) }),
            });
            if (!r) return;
            if (toRadius(r.value) > TOL) return commit(ctx, { center, radius: toRadius(r.value) });
            ctx.message(diameter ? 'The diameter must be more than zero.' : NOT_POSITIVE);
          }
        }
        case '2p': {
          const a = yield* choice.point({ prompt: 'Circle: pick the first end of a diameter' });
          if (!a) return;
          for (;;) {
            const b = yield* choice.point({
              prompt: 'Circle: pick the other end of the diameter',
              base: a,
              preview: (p) => preview(ctx, circle2P(a, p)),
            });
            if (!b) return;
            const c = circle2P(a, b);
            if (c) return commit(ctx, c);
            ctx.message('That point is the same as the first one; pick another.');
          }
        }
        case '3p': {
          const a = yield* choice.point({ prompt: 'Circle: pick the first point on the circle' });
          if (!a) return;
          const b = yield* choice.point({
            prompt: 'Circle: pick the second point',
            base: a,
            preview: (p) => [rubberBand(ctx, a, p)],
          });
          if (!b) return;
          for (;;) {
            const c3 = yield* choice.point({
              prompt: 'Circle: pick the third point',
              base: b,
              preview: (p) => preview(ctx, circle3P(a, b, p)),
            });
            if (!c3) return;
            const c = circle3P(a, b, c3);
            if (c) return commit(ctx, c);
            ctx.message('The three points are in a line or repeat; pick another.');
          }
        }
        case 'ttr': {
          const picks = yield* pickTargets(ctx, choice, 2);
          if (!picks) return;
          const [a0, a1] = [picks.at[0]!, picks.at[1]!];
          const hint = { x: (a0.x + a1.x) / 2, y: (a0.y + a1.y) / 2 };
          const solve = (r: number) => nearestToPicks(tangentTangentRadius(picks.targets[0]!, picks.targets[1]!, r, hint), picks.targets, picks.at);
          for (;;) {
            const r = yield* choice.value({
              prompt: 'Circle: type the radius',
              label: 'R',
              quantity: 'length',
              preview: (v) => preview(ctx, solve(v)),
            });
            if (!r) return;
            if (r.value <= TOL) {
              ctx.message(NOT_POSITIVE);
              continue;
            }
            const c = solve(r.value);
            if (c) return commit(ctx, c);
            ctx.message('No circle of that radius touches both; type another radius.');
          }
        }
        case 'ttt': {
          const picks = yield* pickTargets(ctx, choice, 3);
          if (!picks) return;
          const [t1, t2, t3] = picks.targets as [TangentTarget, TangentTarget, TangentTarget];
          const c = nearestToPicks(tangentTangentTangent(t1, t2, t3), picks.targets, picks.at);
          if (c) return commit(ctx, c);
          ctx.message('No circle touches all three; pick again.');
          return;
        }
      }
    },
  };
}

const ORDINALS = ['first', 'second', 'third'];

/** Picks `n` tangent targets, remembering where each was clicked. */
function* pickTargets(
  ctx: ToolContext,
  choice: MethodChoice<CircleMethod>,
  n: number,
): Generator<Request, { targets: TangentTarget[]; at: Vec2[] } | undefined, ToolInput> {
  const targets: TangentTarget[] = [];
  const at: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const pick = yield* choice.entity(ctx, {
      prompt: `Circle: pick the ${ORDINALS[i]} line, circle or arc to touch`,
      accepts: isTangentTarget,
    });
    if (!pick) return undefined;
    targets.push(tangentTarget(pick.entity)!);
    at.push(pick.at);
  }
  return { targets, at };
}

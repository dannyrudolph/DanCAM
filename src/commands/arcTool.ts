import { ccwDeg } from '../geometry/angle';
import { type Arc, arc3P, arcEnd, arcSCA, arcSCE, arcSER, arcStart, arcTangentFrom, ccwTangentAt } from '../geometry/arc';
import { angleFrom, circle3P } from '../geometry/circle';
import { type Vec2, distance, vecNearlyEqual } from '../geometry/vec';
import type { ArcEntity, Entity, EntityId, LineEntity } from '../model/entity';
import type { Continuation, ToolContext, ToolDef, ToolGen } from './tool';
import { MethodChoice, PREVIEW_ID, addEntity } from './toolSteps';

type ArcMethod = '3p' | 'sce' | 'ser' | 'sca' | 'continue';

const METHODS = [
  { key: '3p', label: '3-Point' },
  { key: 'sce', label: 'Start, Center, End' },
  { key: 'ser', label: 'Start, End, Radius' },
  { key: 'sca', label: 'Start, Center, Angle' },
  { key: 'continue', label: 'Continue' },
] as const;

function arcEntity(ctx: ToolContext, id: EntityId, a: Arc): ArcEntity {
  return { kind: 'arc', id, ...ctx.newProps(), center: a.center, radius: a.radius, startDeg: a.startDeg, endDeg: a.endDeg };
}

function rubberBand(ctx: ToolContext, start: Vec2, end: Vec2): LineEntity {
  return { kind: 'line', id: PREVIEW_ID, ...ctx.newProps(), start, end };
}

/**
 * Where an arc drawn from `from` ends, and its direction of travel there.
 * Arcs are stored counter-clockwise, so one drawn clockwise ends at its stored start.
 */
export function arcContinuation(id: EntityId, a: Arc, from: Vec2): Continuation {
  const s = arcStart(a);
  const e = arcEnd(a);
  if (distance(s, from) <= distance(e, from)) return { id, end: e, dir: ccwTangentAt(a.endDeg) };
  const t = ccwTangentAt(a.startDeg);
  return { id, end: s, dir: { x: -t.x, y: -t.y } };
}

const SAME_POINT = 'That point is the same as the last one; pick another.';

/**
 * Arc by the spec's five methods. Continue starts at the end of the last line
 * or arc drawn, tangent to it; repeating it chains tangent arcs.
 */
export function createArcTool(): ToolDef {
  const choice = new MethodChoice<ArcMethod>(METHODS, '3p');
  const label = 'Arc';
  const preview = (ctx: ToolContext, a: Arc | undefined, ...extra: Entity[]): Entity[] =>
    a ? [arcEntity(ctx, PREVIEW_ID, a), ...extra] : extra;
  const commit = (ctx: ToolContext, a: Arc, from: Vec2): void => {
    const e = addEntity(ctx, label, (id) => arcEntity(ctx, id, a));
    ctx.continuation = arcContinuation(e.id, a, from);
  };

  return {
    id: 'arc',
    label,
    shortcut: 'a',
    *run(ctx): ToolGen {
      const cont = ctx.continuation;
      if (choice.current === 'continue' && !(cont && ctx.drawing.entities.has(cont.id))) {
        ctx.message('Continue needs a line or arc to start from; draw one first.');
        choice.current = '3p';
      }

      switch (choice.current) {
        case 'continue': {
          const { end: s, dir } = cont!;
          for (;;) {
            const e = yield* choice.point({
              prompt: 'Arc: pick the end point',
              base: s,
              preview: (p) => preview(ctx, arcTangentFrom(s, dir, p)?.arc),
            });
            if (!e) return;
            const t = arcTangentFrom(s, dir, e);
            if (t) return commit(ctx, t.arc, s);
            ctx.message('That point is straight ahead; an arc needs to turn. Pick another.');
          }
        }
        case '3p': {
          const s = yield* choice.point({ prompt: 'Arc: pick the start point' });
          if (!s) return;
          const m = yield* choice.point({ prompt: 'Arc: pick a point on the arc', base: s, preview: (p) => [rubberBand(ctx, s, p)] });
          if (!m) return;
          for (;;) {
            const e = yield* choice.point({ prompt: 'Arc: pick the end point', base: m, preview: (p) => preview(ctx, arc3P(s, m, p)) });
            if (!e) return;
            const a = arc3P(s, m, e);
            if (a) return commit(ctx, a, s);
            ctx.message('The three points are in a line or repeat; pick another.');
          }
        }
        case 'sce':
        case 'sca': {
          const s = yield* choice.point({ prompt: 'Arc: pick the start point' });
          if (!s) return;
          let c: Vec2 | undefined;
          while (!c) {
            c = yield* choice.point({ prompt: 'Arc: pick the center', base: s, preview: (p) => [rubberBand(ctx, s, p)] });
            if (!c) return;
            if (vecNearlyEqual(c, s)) {
              ctx.message(SAME_POINT);
              c = undefined;
            }
          }
          const center = c;
          if (choice.current === 'sce') {
            for (;;) {
              const e = yield* choice.point({
                prompt: 'Arc: pick the end direction (counter-clockwise from the start)',
                base: center,
                preview: (p) => preview(ctx, arcSCE(s, center, p), rubberBand(ctx, center, p)),
              });
              if (!e) return;
              const a = arcSCE(s, center, e);
              if (a) return commit(ctx, a, s);
              ctx.message('Pick an end in a different direction from the start.');
            }
          }
          for (;;) {
            const v = yield* choice.value({
              prompt: 'Arc: pick or type the included angle (negative is clockwise)',
              label: '∠',
              quantity: 'angle',
              base: center,
              fromCursor: (p) => ccwDeg(angleFrom(center, s), angleFrom(center, p)),
              preview: (deg) => preview(ctx, arcSCA(s, center, deg)),
            });
            if (!v) return;
            const a = arcSCA(s, center, v.value);
            if (a) return commit(ctx, a, s);
            ctx.message('The angle must be between -360° and 360°, and not zero.');
          }
        }
        case 'ser': {
          const s = yield* choice.point({ prompt: 'Arc: pick the start point' });
          if (!s) return;
          let e: Vec2 | undefined;
          while (!e) {
            e = yield* choice.point({ prompt: 'Arc: pick the end point', base: s, preview: (p) => [rubberBand(ctx, s, p)] });
            if (!e) return;
            if (vecNearlyEqual(e, s)) {
              ctx.message(SAME_POINT);
              e = undefined;
            }
          }
          const end = e;
          const half = distance(s, end) / 2;
          for (;;) {
            const v = yield* choice.value({
              prompt: 'Arc: pick or type the radius; the arc bulges toward the cursor',
              label: 'R',
              quantity: 'length',
              // The radius of the circle through both ends and the cursor; never shorter than half the chord.
              fromCursor: (p) => Math.max(half, circle3P(s, end, p)?.radius ?? half),
              preview: (r, cursor) => preview(ctx, arcSER(s, end, r, cursor)),
            });
            if (!v) return;
            const a = arcSER(s, end, v.value, v.at);
            if (a) return commit(ctx, a, s);
            ctx.message('The radius must be at least half the distance between the ends.');
          }
        }
      }
    },
  };
}

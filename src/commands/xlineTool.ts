import { angleDeg } from '../geometry/angle';
import { distanceToXline, offsetXline, type Xline, xline2P, xlineAngle, xlineH, xlineV } from '../geometry/xline';
import type { Vec2 } from '../geometry/vec';
import type { Entity, EntityId, XlineEntity } from '../model/entity';
import type { ToolContext, ToolDef, ToolGen } from './tool';
import { MethodChoice, PREVIEW_ID, addEntity } from './toolSteps';

type XlineMethod = 'h' | 'v' | 'angle' | '2p' | 'offset';

const METHODS = [
  { key: 'h', label: 'Horizontal' },
  { key: 'v', label: 'Vertical' },
  { key: 'angle', label: 'Angle' },
  { key: '2p', label: 'Through 2 points' },
  { key: 'offset', label: 'Offset' },
] as const;

function xlineEntity(ctx: ToolContext, id: EntityId, x: Xline): XlineEntity {
  return { kind: 'xline', id, ...ctx.newProps(), base: x.base, dir: x.dir };
}

/** The infinite line an entity lies on, for offsetting: lines and xlines only. */
function lineOf(e: Entity): Xline | undefined {
  if (e.kind === 'xline') return { base: e.base, dir: e.dir };
  if (e.kind === 'line') return xline2P(e.start, e.end);
  return undefined;
}

/** Construction line by the spec's five methods, chosen in the options bar. */
export function createXlineTool(): ToolDef {
  const choice = new MethodChoice<XlineMethod>(METHODS, 'h');
  const label = 'Xline';
  const commit = (ctx: ToolContext, x: Xline): void => void addEntity(ctx, label, (id) => xlineEntity(ctx, id, x));
  const preview = (ctx: ToolContext, x: Xline | undefined): Entity[] => (x ? [xlineEntity(ctx, PREVIEW_ID, x)] : []);

  return {
    id: 'xline',
    label,
    shortcut: 'x',
    *run(ctx): ToolGen {
      switch (choice.current) {
        case 'h':
        case 'v': {
          const make = choice.current === 'h' ? xlineH : xlineV;
          const p = yield* choice.point({ prompt: 'Xline: pick a point it passes through', preview: (q) => preview(ctx, make(q)) });
          if (p) commit(ctx, make(p));
          return;
        }
        case 'angle': {
          const p = yield* choice.point({ prompt: 'Xline: pick a point it passes through' });
          if (!p) return;
          const v = yield* choice.value({
            prompt: 'Xline: pick or type the angle',
            label: '∠',
            quantity: 'angle',
            base: p,
            fromCursor: (q) => (q.x === p.x && q.y === p.y ? undefined : angleDeg({ x: q.x - p.x, y: q.y - p.y })),
            preview: (deg) => preview(ctx, xlineAngle(p, deg)),
          });
          if (v) commit(ctx, xlineAngle(p, v.value));
          return;
        }
        case '2p': {
          const a = yield* choice.point({ prompt: 'Xline: pick the first point' });
          if (!a) return;
          for (;;) {
            const b = yield* choice.point({ prompt: 'Xline: pick the second point', base: a, preview: (q) => preview(ctx, xline2P(a, q)) });
            if (!b) return;
            const x = xline2P(a, b);
            if (x) return commit(ctx, x);
            ctx.message('That point is the same as the first one; pick another.');
          }
        }
        case 'offset': {
          const pick = yield* choice.entity(ctx, {
            prompt: 'Xline: pick a line or xline to offset',
            accepts: (e) => lineOf(e) !== undefined,
          });
          if (!pick) return;
          const from = lineOf(pick.entity)!;
          for (;;) {
            const v = yield* choice.value({
              prompt: 'Xline: pick or type the offset distance; the side follows the cursor',
              label: 'Dist',
              quantity: 'length',
              fromCursor: (q: Vec2) => distanceToXline(q, from),
              preview: (d, cursor) => preview(ctx, offsetXline(from, d, cursor)),
            });
            if (!v) return;
            const x = offsetXline(from, v.value, v.at);
            if (x) return commit(ctx, x);
            ctx.message('The distance must be more than zero, with the cursor off the line to choose a side.');
          }
        }
      }
    },
  };
}

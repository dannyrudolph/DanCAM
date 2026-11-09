import { type Vec2, vecNearlyEqual } from '../geometry/vec';
import type { DimensionEntity, EntityId } from '../model/entity';
import type { ToolDef, ToolGen, ToolOption } from './tool';
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

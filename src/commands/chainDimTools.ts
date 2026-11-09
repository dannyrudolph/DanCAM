import { TOL } from '../geometry/tolerance';
import { type Vec2, distance, dot, sub } from '../geometry/vec';
import type { Anchor, DimAnchors } from '../model/anchor';
import { lineSpacing } from '../model/dimGrips';
import { dimLine } from '../model/dimLayout';
import type { DimensionEntity, EntityId } from '../model/entity';
import type { ToolDef, ToolGen } from './tool';
import { MethodChoice, PREVIEW_ID, addEntity } from './toolSteps';

type Straight = Extract<DimensionEntity, { type: 'linear' | 'aligned' }>;
const isStraight = (e: { kind: string; type?: string }): boolean => e.kind === 'dimension' && (e.type === 'linear' || e.type === 'aligned');

/**
 * Baseline (Shift+B) and Continue (Shift+K) (spec, "Dimensioning"): pick a
 * linear or aligned dimension near the extension line to start from, then
 * point after point until Enter. Each new dimension measures along the
 * picked one's direction and is its own undo step.
 * - Baseline: every one from that same start, each dimension line one
 *   standard spacing (.25" or 6 mm on paper) further out.
 * - Continue: each from where the last ended, on the same line.
 * The start keeps its anchor, and snapped points are anchored, so the set
 * follows the geometry.
 */
function createChainTool(kind: 'baseline' | 'continue'): ToolDef {
  const name = kind === 'baseline' ? 'Baseline' : 'Continue';
  const steps = new MethodChoice<'pick'>([{ key: 'pick', label: 'Pick a dimension' }], 'pick');
  return {
    id: kind === 'baseline' ? 'dimBaseline' : 'dimContinue',
    label: kind === 'baseline' ? 'Baseline dimension' : 'Continue dimension',
    shortcut: kind === 'baseline' ? 'shift+b' : 'shift+k',
    *run(ctx): ToolGen {
      const picked = yield* steps.entity(ctx, { prompt: `${name}: pick a linear dimension near the extension line to start from`, accepts: isStraight });
      if (!picked || !isStraight(picked.entity)) return;
      const base = picked.entity as Straight;
      const { u, n } = dimLine(base);
      // The extension line nearer the pick is the start.
      const fromP1 = Math.abs(dot(sub(picked.at, base.p1), u)) <= Math.abs(dot(sub(picked.at, base.p2), u));
      let from = fromP1 ? base.p1 : base.p2;
      let fromAnchor: Anchor | undefined = fromP1 ? base.anchors?.p1 : base.anchors?.p2;
      // Where the line sits across the dimension, and which way is out (away from the measured points).
      let level = dot(base.at, n);
      const out = dot(sub(base.at, base.p1), n) < 0 ? -1 : 1;
      const step = kind === 'baseline' ? out * lineSpacing(ctx.drawing) : 0;
      const layer = ctx.newProps().layer;
      const make = (id: EntityId, to: Vec2, toAnchor: Anchor | undefined): DimensionEntity => {
        const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
        const k = level + step - dot(mid, n);
        const anchors: DimAnchors = { ...(fromAnchor && { p1: fromAnchor }), ...(toAnchor && { p2: toAnchor }) };
        return {
          kind: 'dimension',
          id,
          layer,
          dimStyle: base.dimStyle,
          type: 'linear',
          dir: u,
          p1: from,
          p2: to,
          at: { x: mid.x + n.x * k, y: mid.y + n.y * k },
          ...(Object.keys(anchors).length > 0 && { anchors }),
        };
      };
      for (;;) {
        const next = yield* steps.anchoredPoint({
          prompt: `${name}: pick the next point (Enter to finish)`,
          base: from,
          canFinish: true,
          preview: (p) => (Math.abs(dot(sub(p, from), u)) <= TOL ? [] : [make(PREVIEW_ID, p, undefined)]),
        });
        if (!next) return;
        if (Math.abs(dot(sub(next.at, from), u)) <= TOL || distance(next.at, from) <= TOL) {
          ctx.message('That point is level with the start; there is nothing to measure.');
          continue;
        }
        addEntity(ctx, `${name} dimension`, (id) => make(id, next.at, next.anchor));
        level += step;
        if (kind === 'continue') {
          from = next.at;
          fromAnchor = next.anchor;
        }
      }
    },
  };
}

export const createBaselineDimTool = (): ToolDef => createChainTool('baseline');
export const createContinueDimTool = (): ToolDef => createChainTool('continue');

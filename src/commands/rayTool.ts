import { type Ray, ray2P } from '../geometry/ray';
import type { EntityId, RayEntity } from '../model/entity';
import type { ToolContext, ToolDef, ToolGen } from './tool';
import { PREVIEW_ID, addEntity } from './toolSteps';

function rayEntity(ctx: ToolContext, id: EntityId, r: Ray): RayEntity {
  return { kind: 'ray', id, ...ctx.newProps(), base: r.base, dir: r.dir };
}

/**
 * Ray: pick the start, then any number of points it passes through; each
 * click adds one ray from the same start, as its own undo step. Enter
 * finishes and the tool starts again.
 */
export const rayTool: ToolDef = {
  id: 'ray',
  label: 'Ray',
  shortcut: 'shift+x',
  *run(ctx): ToolGen {
    const first = yield { kind: 'point', prompt: 'Ray: pick the start point' };
    if (first.kind !== 'point') return;
    const base = first.at;
    for (;;) {
      const input = yield {
        kind: 'point',
        prompt: 'Ray: pick a point it passes through (Enter to finish)',
        base,
        preview: (p) => {
          const r = ray2P(base, p);
          return r ? [rayEntity(ctx, PREVIEW_ID, r)] : [];
        },
        canFinish: true,
      };
      if (input.kind === 'finish') return;
      if (input.kind !== 'point') continue;
      const r = ray2P(base, input.at);
      if (!r) {
        ctx.message('That point is the start point; pick another.');
        continue;
      }
      addEntity(ctx, 'Ray', (id) => rayEntity(ctx, id, r));
    }
  },
};

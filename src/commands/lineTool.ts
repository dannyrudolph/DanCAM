import { vecNearlyEqual } from '../geometry/vec';
import type { Vec2 } from '../geometry/vec';
import { newEntityId } from '../model/drawing';
import type { LineEntity } from '../model/entity';
import type { ToolContext, ToolDef, ToolGen } from './tool';

function makeLine(ctx: ToolContext, id: string, start: Vec2, end: Vec2): LineEntity {
  return { kind: 'line', id, ...ctx.newProps(), start, end };
}

/**
 * Line: point to point, chained. Each segment is its own undo step.
 * Options: Undo last segment, Close (back to the chain's first point).
 * Enter finishes the chain; the tool then starts a new one.
 */
export const lineTool: ToolDef = {
  id: 'line',
  label: 'Line',
  shortcut: 'l',
  *run(ctx): ToolGen {
    const first = yield { kind: 'point', prompt: 'Line: pick the first point' };
    if (first.kind !== 'point') return;

    // points[0] is the chain start; each committed segment adds its end point.
    const points: Vec2[] = [first.at];
    for (;;) {
      const from = points[points.length - 1]!;
      const segments = points.length - 1;
      const input = yield {
        kind: 'point',
        prompt: 'Line: pick the next point (Enter to finish)',
        base: from,
        preview: (p) => [makeLine(ctx, 'preview', from, p)],
        canFinish: true,
        options: [
          { key: 'undo', label: 'Undo last segment', enabled: segments > 0 },
          { key: 'close', label: 'Close', enabled: segments >= 2 },
        ],
      };

      if (input.kind === 'finish') return;
      if (input.kind === 'option') {
        if (input.key === 'undo' && segments > 0) {
          ctx.undo.undo();
          points.pop();
        } else if (input.key === 'close' && segments >= 2) {
          commitSegment(ctx, from, points[0]!);
          return;
        }
        continue;
      }
      if (vecNearlyEqual(input.at, from)) {
        ctx.message('That point is the same as the last one; pick another.');
        continue;
      }
      commitSegment(ctx, from, input.at);
      points.push(input.at);
    }
  },
};

function commitSegment(ctx: ToolContext, start: Vec2, end: Vec2): void {
  const line = makeLine(ctx, newEntityId(ctx.drawing), start, end);
  ctx.undo.commit({ label: 'Line', changes: [{ op: 'add', entity: line }] });
}

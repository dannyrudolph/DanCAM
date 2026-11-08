import { type Deferred, resolveDeferred, resolveDeferredPair } from '../geometry/curve';
import { vecNearlyEqual } from '../geometry/vec';
import type { Vec2 } from '../geometry/vec';
import { newEntityId } from '../model/drawing';
import type { LineEntity } from '../model/entity';
import type { Request, ToolContext, ToolDef, ToolGen, ToolInput } from './tool';

function makeLine(ctx: ToolContext, id: string, start: Vec2, end: Vec2): LineEntity {
  return { kind: 'line', id, ...ctx.newProps(), start, end };
}

/**
 * Line: point to point, chained. Each segment is its own undo step.
 * Options: Undo last segment, Close (back to the chain's first point).
 * Enter finishes the chain; the tool then starts a new one.
 *
 * The first point can be a deferred Tangent or Perpendicular pick: the start
 * then slides along that curve as the end moves, and is fixed when the end
 * is placed. An end that is also a deferred Tangent gives a line tangent to
 * both curves.
 */
export const lineTool: ToolDef = {
  id: 'line',
  label: 'Line',
  shortcut: 'l',
  *run(ctx): ToolGen {
    const first = yield { kind: 'point', prompt: 'Line: pick the first point', acceptsDeferred: true };
    if (first.kind !== 'point') return;

    // points[0] is the chain start; each committed segment adds its end point.
    const points: Vec2[] = [first.at];
    if (first.deferred) {
      const seg = yield* deferredSegment(ctx, first.deferred);
      if (!seg) return;
      commitSegment(ctx, seg[0], seg[1]);
      points.splice(0, 1, seg[0], seg[1]);
    }
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
      if (input.kind === 'selection') continue;
      if (vecNearlyEqual(input.at, from)) {
        ctx.message('That point is the same as the last one; pick another.');
        continue;
      }
      commitSegment(ctx, from, input.at);
      points.push(input.at);
    }
  },
};

const DEFERRED_LABEL = { tan: 'tangent', perp: 'perpendicular' } as const;

/** The two ends of a segment from a deferred start to `end`, which may itself be deferred. */
function segmentTo(start: Deferred, end: Vec2, endDeferred: Deferred | undefined): [Vec2, Vec2] | undefined {
  if (endDeferred) return resolveDeferredPair(start, endDeferred);
  const s = resolveDeferred(start, end);
  return s && !vecNearlyEqual(s, end) ? [s, end] : undefined;
}

/** Asks for the end of a segment whose start is deferred. Undefined when the user finishes instead. */
function* deferredSegment(ctx: ToolContext, start: Deferred): Generator<Request, [Vec2, Vec2] | undefined, ToolInput> {
  for (;;) {
    const input = yield {
      kind: 'point',
      prompt: `Line: pick the end point (start ${DEFERRED_LABEL[start.kind]} to the picked object)`,
      acceptsDeferred: true,
      preview: (p, d) => {
        const seg = segmentTo(start, p, d);
        return seg ? [makeLine(ctx, 'preview', seg[0], seg[1])] : [];
      },
    };
    if (input.kind === 'finish') return undefined;
    if (input.kind !== 'point') continue;
    const seg = segmentTo(start, input.at, input.deferred);
    if (seg) return seg;
    ctx.message(
      input.deferred
        ? 'Only tangent to tangent can be found when both ends are on objects; pick a point.'
        : `No ${DEFERRED_LABEL[start.kind]} line from there; pick another point.`,
    );
  }
}

function commitSegment(ctx: ToolContext, start: Vec2, end: Vec2): void {
  const line = makeLine(ctx, newEntityId(ctx.drawing), start, end);
  ctx.undo.commit({ label: 'Line', changes: [{ op: 'add', entity: line }] });
  ctx.continuation = { id: line.id, end, dir: { x: end.x - start.x, y: end.y - start.y } };
}

import type { EntityId } from '../model/entity';
import { type Grip, applyGrip } from '../model/grips';
import type { ToolDef, ToolGen } from './tool';

/**
 * Dragging one grip of a selected entity: a one-shot tool asking for the
 * grip's new point, so snaps, Ortho, polar and the input boxes all apply,
 * measured from where the grip was. The edit is one `modify` undo step; a
 * drop that changes nothing, or would make the entity degenerate, commits
 * nothing.
 */
export function gripTool(id: EntityId, grip: Grip): ToolDef {
  return {
    id: 'grip',
    label: 'Grip',
    shortcut: '',
    repeat: false,
    *run(ctx): ToolGen {
      const before = ctx.drawing.entities.get(id);
      if (!before) return;
      const input = yield {
        kind: 'point',
        prompt: 'Grip: drop at the new point',
        base: grip.at,
        preview: (p) => {
          const after = applyGrip(before, grip.key, grip.at, p);
          return after ? [after] : [];
        },
      };
      if (input.kind !== 'point') return;
      const after = applyGrip(before, grip.key, grip.at, input.at);
      if (!after) {
        ctx.message("That would leave the object with no size; it wasn't changed.");
        return;
      }
      if (JSON.stringify(after) === JSON.stringify(before)) return;
      ctx.undo.commit({ label: 'Grip edit', changes: [{ op: 'modify', before, after }] });
    },
  };
}

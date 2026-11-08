import { newEntityId } from '../model/drawing';
import type { ToolDef, ToolGen } from './tool';

/** Point: one click places one point entity. The tool repeats until Esc. */
export const pointTool: ToolDef = {
  id: 'point',
  label: 'Point',
  shortcut: 'p',
  *run(ctx): ToolGen {
    const input = yield { kind: 'point', prompt: 'Point: pick a location' };
    if (input.kind !== 'point') return;
    const id = newEntityId(ctx.drawing);
    ctx.undo.commit({ label: 'Point', changes: [{ op: 'add', entity: { kind: 'point', id, ...ctx.newProps(), at: input.at } }] });
  },
};

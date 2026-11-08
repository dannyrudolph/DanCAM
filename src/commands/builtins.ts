import { type CommandDef, matchOption } from './command';
import type { CommandRegistry } from './registry';

const ZOOM_OPTIONS = ['Extents'] as const;

/** ZOOM. Phase 0 has only the Extents option; wheel zoom covers the rest. */
export const zoomCommand: CommandDef = {
  name: 'ZOOM',
  aliases: ['Z'],
  *run(ctx) {
    for (;;) {
      const input = yield { prompt: 'ZOOM [Extents]:' };
      if (input.kind === 'enter') return;
      const option = matchOption(input.text, ZOOM_OPTIONS);
      if (option === 'Extents') {
        ctx.view.zoomExtents();
        return;
      }
      ctx.print('Invalid option keyword.');
    }
  },
};

export const undoCommand: CommandDef = {
  name: 'UNDO',
  aliases: ['U'],
  *run(ctx) {
    const label = ctx.undo.undoLabel;
    ctx.print(ctx.undo.undo() ? `Undo: ${label}` : 'Nothing to undo.');
  },
};

export const redoCommand: CommandDef = {
  name: 'REDO',
  aliases: [],
  *run(ctx) {
    const label = ctx.undo.redoLabel;
    ctx.print(ctx.undo.redo() ? `Redo: ${label}` : 'Nothing to redo.');
  },
};

export function registerBuiltins(registry: CommandRegistry): void {
  registry.register(zoomCommand);
  registry.register(undoCommand);
  registry.register(redoCommand);
}

import type { Vec2 } from '../geometry/vec';
import { type AfterCreate, blockNameError, createBlock, isBlockGeometry } from '../model/block';
import { objects } from './editTools';
import type { ToolDef, ToolGen, ToolInput, ToolOption } from './tool';

/**
 * Block tools (spec, "Blocks").
 *
 * Create block (K): the selection (or objects picked now), then the base
 * point the block is placed by, then its name and an optional description.
 * Only lines, circles, arcs and points go in. Option buttons choose what
 * happens to the objects: converted to an instance of the new block
 * (default), kept, or deleted; the choice is kept for the session. One
 * undo step.
 */
export function createBlockTool(): ToolDef {
  let after: AfterCreate = 'convert';
  const options = (): ToolOption[] => [
    { key: 'after:convert', label: 'Convert to block', enabled: true, active: after === 'convert' },
    { key: 'after:keep', label: 'Keep objects', enabled: true, active: after === 'keep' },
    { key: 'after:delete', label: 'Delete objects', enabled: true, active: after === 'delete' },
  ];
  /** Takes an options-bar choice; true when `input` was one. */
  const chose = (input: ToolInput): boolean => {
    if (input.kind !== 'option' || !input.key.startsWith('after:')) return false;
    after = input.key.slice('after:'.length) as AfterCreate;
    return true;
  };
  return {
    id: 'createBlock',
    label: 'Create block',
    shortcut: 'k',
    repeat: false,
    *run(ctx): ToolGen {
      const es = yield* objects(ctx, 'Create block');
      if (!es) return;
      const sources = es.filter(isBlockGeometry);
      if (sources.length === 0) {
        ctx.message('A block holds lines, circles, arcs and points, and none are selected.');
        return;
      }
      const left = es.length - sources.length;
      if (left > 0) ctx.message(`${left} object${left === 1 ? '' : 's'} left out: a block holds only lines, circles, arcs and points.`);

      let base: Vec2 | undefined;
      while (!base) {
        const input = yield { kind: 'point', prompt: 'Create block: pick the base point, the point it is placed by', options: options() };
        if (input.kind === 'finish') return;
        if (!chose(input) && input.kind === 'point') base = input.at;
      }
      const at = base;

      let name: string | undefined;
      while (name === undefined) {
        const input = yield { kind: 'text', prompt: 'Create block: type its name, then press Enter', at, options: options() };
        if (input.kind === 'finish') return;
        if (chose(input) || input.kind !== 'text') continue;
        const typed = input.text.trim();
        const error = blockNameError(ctx.drawing, typed);
        if (error) ctx.message(error);
        else name = typed;
      }

      let description: string | undefined;
      while (description === undefined) {
        const input = yield { kind: 'text', prompt: `Create block ${name}: type a description (holder, insert, notes), or press Enter for none`, at, options: options() };
        if (input.kind === 'finish') description = '';
        else if (!chose(input) && input.kind === 'text') description = input.text.trim();
      }

      ctx.undo.commit(createBlock(ctx.drawing, sources, at, name, description, after, ctx.newProps().layer));
    },
  };
}

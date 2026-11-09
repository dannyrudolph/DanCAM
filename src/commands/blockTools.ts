import { angleDeg, normDeg } from '../geometry/angle';
import { type Vec2, distance, sub } from '../geometry/vec';
import { type AfterCreate, blockNameError, createBlock, explodeInserts, isBlockGeometry } from '../model/block';
import type { Drawing } from '../model/drawing';
import type { EntityId, InsertEntity } from '../model/entity';
import { objects } from './editTools';
import type { ToolContext, ToolDef, ToolGen, ToolInput, ToolOption } from './tool';
import { PREVIEW_ID, addEntity } from './toolSteps';

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

/** The Insert tool, which the Blocks panel can point at a block before starting it. */
export type InsertTool = ToolDef & {
  /** Makes `name` the block the next placement uses. */
  use(name: string): void;
};

/**
 * Insert (Shift+I): places instances of a block, one undo step each, until
 * Esc (sticky). The block is the one last chosen (in the Blocks panel or
 * with its button in the options bar), else the first by name. Click where
 * the base point goes, then pick or type the rotation (Enter keeps the
 * last one). Mirror and Scale are options, kept for the session, as are
 * the block and rotation.
 */
export function createInsertTool(): InsertTool {
  let chosen: string | undefined;
  let rotationDeg = 0;
  let scale = 1;
  let mirrored = false;

  const names = (d: Drawing): string[] => [...d.blocks.keys()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }));
  const current = (d: Drawing): string | undefined => (chosen !== undefined && d.blocks.has(chosen) ? chosen : names(d)[0]);
  const options = (d: Drawing): ToolOption[] => [
    ...names(d).map((name) => ({ key: `block:${name}`, label: name, enabled: true, active: name === current(d) })),
    { key: 'mirror', label: 'Mirror', enabled: true, active: mirrored },
    { key: 'scale', label: `Scale ${scale}`, enabled: true },
  ];

  /** Takes a block or Mirror choice; true when `input` was one. */
  const chose = (input: ToolInput): boolean => {
    if (input.kind !== 'option') return false;
    if (input.key.startsWith('block:')) chosen = input.key.slice('block:'.length);
    else if (input.key === 'mirror') mirrored = !mirrored;
    else return false;
    return true;
  };

  /** Asks for a new scale, typed; keeps the old one on Enter or a bad value. */
  function* askScale(ctx: ToolContext): ToolGen {
    for (;;) {
      const input = yield { kind: 'value', prompt: `Insert: type the scale (now ${scale})`, label: '×', quantity: 'factor', canFinish: true };
      if (input.kind !== 'value') return;
      if (input.value > 0) {
        scale = input.value;
        return;
      }
      ctx.message('The scale needs to be more than zero.');
    }
  }

  return {
    id: 'insertBlock',
    label: 'Insert block',
    shortcut: 'shift+i',
    use(name) {
      chosen = name;
    },
    *run(ctx): ToolGen {
      const d = ctx.drawing;
      const make = (id: EntityId, name: string, at: Vec2, rot: number): InsertEntity => ({
        kind: 'insert',
        id,
        ...ctx.newProps(),
        block: name,
        at,
        rotationDeg: normDeg(rot),
        scale,
        mirrored,
      });

      let at: Vec2 | undefined;
      while (!at) {
        const name = current(d);
        if (name === undefined) {
          ctx.message('No blocks yet: select geometry and choose Create block (K).');
          return;
        }
        const input = yield {
          kind: 'point',
          prompt: `Insert ${name}: pick where its base point goes`,
          preview: (p) => [make(PREVIEW_ID, name, p, rotationDeg)],
          options: options(d),
        };
        if (input.kind === 'finish') return;
        if (input.kind === 'option' && input.key === 'scale') yield* askScale(ctx);
        else if (!chose(input) && input.kind === 'point') at = input.at;
      }
      const base = at;

      for (;;) {
        const name = current(d)!;
        const input = yield {
          kind: 'value',
          prompt: `Insert ${name}: pick or type the rotation, or press Enter for ${Number(rotationDeg.toFixed(4))}°`,
          label: '∠',
          quantity: 'angle',
          base,
          fromCursor: (c) => (distance(c, base) > 0 ? angleDeg(sub(c, base)) : undefined),
          preview: (v) => [make(PREVIEW_ID, name, base, v)],
          options: options(d),
          canFinish: true,
        };
        if (input.kind === 'option' && input.key === 'scale') {
          yield* askScale(ctx);
          continue;
        }
        if (chose(input)) continue;
        if (input.kind === 'value') rotationDeg = normDeg(input.value);
        else if (input.kind !== 'finish') continue;
        addEntity(ctx, `Insert ${name}`, (id) => make(id, name, base, rotationDeg));
        return;
      }
    },
  };
}

/**
 * Explode (Shift+U): the selected instances (or ones picked now) become
 * plain lines, circles, arcs and points, in one undo step. Other objects
 * are left as they are.
 */
export const explodeTool: ToolDef = {
  id: 'explode',
  label: 'Explode',
  shortcut: 'shift+u',
  repeat: false,
  *run(ctx): ToolGen {
    const es = yield* objects(ctx, 'Explode');
    if (!es) return;
    const inserts = es.filter((e): e is InsertEntity => e.kind === 'insert');
    if (inserts.length === 0) {
      ctx.message('Only block instances can be exploded, and none are selected.');
      return;
    }
    ctx.undo.commit(explodeInserts(ctx.drawing, inserts));
  },
};

import { angleDeg } from '../geometry/angle';
import { type Transform, mirrorLine, rotation, scaling, translation } from '../geometry/transform';
import { type Vec2, distance, sub } from '../geometry/vec';
import { newEntityId } from '../model/drawing';
import { type Entity, transformEntity } from '../model/entity';
import type { Change } from '../model/undo';
import type { PointRequest, Request, ToolContext, ToolDef, ToolGen, ToolInput, ToolOption, ValueRequest } from './tool';

/** A step generator's result: the payload, or undefined when the run should end. */
type Step<T> = Generator<Request, T | undefined, ToolInput>;

/**
 * The objects to edit: the selection when there is one (selection first), or
 * else a `selection` step until some are picked. Undefined if the user
 * finishes without picking any.
 */
function* objects(ctx: ToolContext, verb: string): Step<Entity[]> {
  let ids = ctx.selection();
  for (;;) {
    const found = ids.map((id) => ctx.drawing.entities.get(id)).filter((e): e is Entity => e !== undefined);
    if (found.length > 0) return found;
    const input = yield { kind: 'selection', prompt: `${verb}: select objects, then press Enter` };
    if (input.kind === 'finish') return undefined;
    if (input.kind === 'selection') ids = input.ids;
  }
}

function* point(req: Omit<PointRequest, 'kind'>): Step<Vec2> {
  for (;;) {
    const input = yield { ...req, kind: 'point' };
    if (input.kind === 'finish') return undefined;
    if (input.kind === 'point') return input.at;
  }
}

function* value(req: Omit<ValueRequest, 'kind'>): Step<number> {
  for (;;) {
    const input = yield { ...req, kind: 'value' };
    if (input.kind === 'finish') return undefined;
    if (input.kind === 'value') return input.value;
  }
}

const moved = (es: readonly Entity[], t: Transform): Entity[] => es.map((e) => transformEntity(e, t));

/** Replaces each entity by its transformed self, as one undo step. */
function commitTransform(ctx: ToolContext, label: string, es: readonly Entity[], t: Transform): void {
  ctx.undo.commit({ label, changes: es.map((before) => ({ op: 'modify', before, after: transformEntity(before, t) })) });
}

/** Adds a transformed copy of each entity with a new id, as one undo step. */
function commitCopies(ctx: ToolContext, label: string, es: readonly Entity[], t: Transform, extra: readonly Change[] = []): void {
  const adds: Change[] = es.map((e) => ({ op: 'add', entity: { ...transformEntity(e, t), id: newEntityId(ctx.drawing) } }));
  ctx.undo.commit({ label, changes: [...adds, ...extra] });
}

/** Edit tools act once on their objects and end, back to selecting, as in AutoCAD. */
const once = { repeat: false } as const;

export const eraseTool: ToolDef = {
  id: 'erase',
  label: 'Erase',
  shortcut: 'e',
  ...once,
  *run(ctx): ToolGen {
    const es = yield* objects(ctx, 'Erase');
    if (!es) return;
    ctx.undo.commit({ label: 'Erase', changes: es.map((entity) => ({ op: 'remove', entity })) });
  },
};

export const moveTool: ToolDef = {
  id: 'move',
  label: 'Move',
  shortcut: 'm',
  ...once,
  *run(ctx): ToolGen {
    const es = yield* objects(ctx, 'Move');
    if (!es) return;
    const base = yield* point({ prompt: 'Move: pick the base point' });
    if (!base) return;
    const to = yield* point({
      prompt: 'Move: pick the second point',
      base,
      preview: (p) => moved(es, translation(base, p)),
    });
    if (!to) return;
    commitTransform(ctx, 'Move', es, translation(base, to));
  },
};

/** Copy: one base point, then a copy at every point picked until Enter. Each copy is its own undo step. */
export const copyTool: ToolDef = {
  id: 'copy',
  label: 'Copy',
  shortcut: 'shift+c',
  ...once,
  *run(ctx): ToolGen {
    const es = yield* objects(ctx, 'Copy');
    if (!es) return;
    const base = yield* point({ prompt: 'Copy: pick the base point' });
    if (!base) return;
    for (;;) {
      const to = yield* point({
        prompt: 'Copy: pick the second point (Enter to finish)',
        base,
        canFinish: true,
        preview: (p) => moved(es, translation(base, p)),
      });
      if (!to) return;
      commitCopies(ctx, 'Copy', es, translation(base, to));
    }
  },
};

/**
 * Rotate: about a center by an angle, typed or from the cursor. The
 * Reference option measures an existing edge first (two points, or a typed
 * angle at the second point) and then asks for the angle it should have:
 * the rotation is new − reference.
 */
export const rotateTool: ToolDef = {
  id: 'rotate',
  label: 'Rotate',
  shortcut: 'r',
  ...once,
  *run(ctx): ToolGen {
    const es = yield* objects(ctx, 'Rotate');
    if (!es) return;
    const base = yield* point({ prompt: 'Rotate: pick the center of rotation' });
    if (!base) return;
    const fromCursor = (c: Vec2): number | undefined => (distance(c, base) > 0 ? angleDeg(sub(c, base)) : undefined);
    let reference = 0;
    for (;;) {
      const input = yield {
        kind: 'value',
        prompt: 'Rotate: pick or type the angle (counter-clockwise), or use Reference',
        label: '∠',
        quantity: 'angle',
        base,
        fromCursor,
        preview: (v) => moved(es, rotation(base, v)),
        options: [{ key: 'reference', label: 'Reference', enabled: true }],
      };
      if (input.kind === 'finish') return;
      if (input.kind === 'value') {
        commitTransform(ctx, 'Rotate', es, rotation(base, input.value));
        return;
      }
      if (input.kind === 'option' && input.key === 'reference') break;
    }
    const r1 = yield* point({ prompt: 'Rotate: pick the first point of the reference edge' });
    if (!r1) return;
    for (;;) {
      const r2 = yield* point({ prompt: 'Rotate: pick the second point of the reference edge', base: r1 });
      if (!r2) return;
      if (distance(r1, r2) > 0) {
        reference = angleDeg(sub(r2, r1));
        break;
      }
      ctx.message('The reference edge needs two different points; pick another.');
    }
    const ref = reference;
    const target = yield* value({
      prompt: `Rotate: pick or type the new angle (reference ${Number(ref.toFixed(4))}°)`,
      label: '∠',
      quantity: 'angle',
      base,
      fromCursor,
      preview: (v) => moved(es, rotation(base, v - ref)),
    });
    if (target === undefined) return;
    commitTransform(ctx, 'Rotate', es, rotation(base, target - ref));
  },
};

/** Mirror: about the line through two points; the originals are kept or erased (an option, remembered). */
export function createMirrorTool(): ToolDef {
  let eraseSource = false;
  return {
    id: 'mirror',
    label: 'Mirror',
    shortcut: 'i',
    ...once,
    *run(ctx): ToolGen {
      const es = yield* objects(ctx, 'Mirror');
      if (!es) return;
      const a = yield* point({ prompt: 'Mirror: pick the first point of the mirror line' });
      if (!a) return;
      for (;;) {
        const options: ToolOption[] = [
          { key: 'keep', label: 'Keep originals', enabled: true, active: !eraseSource },
          { key: 'erase', label: 'Erase originals', enabled: true, active: eraseSource },
        ];
        const input = yield {
          kind: 'point',
          prompt: 'Mirror: pick the second point of the mirror line',
          base: a,
          options,
          preview: (p) => {
            const t = mirrorLine(a, p);
            return t ? moved(es, t) : [];
          },
        };
        if (input.kind === 'finish') return;
        if (input.kind === 'option') {
          eraseSource = input.key === 'erase';
          continue;
        }
        if (input.kind !== 'point') continue;
        const t = mirrorLine(a, input.at);
        if (!t) {
          ctx.message('The mirror line needs two different points; pick another.');
          continue;
        }
        if (eraseSource) commitTransform(ctx, 'Mirror', es, t);
        else commitCopies(ctx, 'Mirror', es, t);
        return;
      }
    },
  };
}

/** Scale: about a base point by a factor, typed or the cursor's distance from the base. */
export const scaleTool: ToolDef = {
  id: 'scale',
  label: 'Scale',
  shortcut: 's',
  ...once,
  *run(ctx): ToolGen {
    const es = yield* objects(ctx, 'Scale');
    if (!es) return;
    const base = yield* point({ prompt: 'Scale: pick the base point' });
    if (!base) return;
    for (;;) {
      const factor = yield* value({
        prompt: 'Scale: pick or type the scale factor',
        label: '×',
        quantity: 'factor',
        base,
        fromCursor: (c) => distance(c, base),
        preview: (v) => {
          const t = scaling(base, v);
          return t ? moved(es, t) : [];
        },
      });
      if (factor === undefined) return;
      const t = scaling(base, factor);
      if (t) {
        commitTransform(ctx, 'Scale', es, t);
        return;
      }
      ctx.message('The scale factor must be more than zero.');
    }
  },
};

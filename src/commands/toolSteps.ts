import type { Vec2 } from '../geometry/vec';
import { newEntityId } from '../model/drawing';
import type { Entity, EntityId } from '../model/entity';
import type { EntityRequest, PointRequest, Request, ToolContext, ToolInput, ToolOption, ValueRequest } from './tool';

/** A creation method a tool offers as a button in its options bar. */
export type Method<K extends string> = { readonly key: K; readonly label: string };

const METHOD_PREFIX = 'method:';

/** A step generator's result: the payload, or undefined when the run should end. */
type Step<T> = Generator<Request, T | undefined, ToolInput>;

type Ask<R extends Request> = Omit<R, 'kind' | 'options'> & { readonly options?: readonly ToolOption[] };

/**
 * The chosen creation method of a multi-method tool, kept between runs so the
 * tool restarts with the same method, plus step helpers that put the method
 * buttons on every step.
 *
 * Each helper yields until it gets the input it asked for and returns its
 * payload, or returns undefined when the user picked a method or pressed Enter
 * to finish: the run should then end, and the sticky tool restarts with the
 * (possibly new) method.
 */
export class MethodChoice<K extends string> {
  constructor(
    readonly methods: readonly Method<K>[],
    public current: K,
  ) {}

  options(): ToolOption[] {
    return this.methods.map((m) => ({ key: METHOD_PREFIX + m.key, label: m.label, enabled: true, active: m.key === this.current }));
  }

  *point(req: Ask<PointRequest>): Step<Vec2> {
    for (;;) {
      const input = yield* this.ask({ ...req, kind: 'point' });
      if (!input) return undefined;
      if (input.kind === 'point') return input.at;
    }
  }

  *value(req: Ask<ValueRequest>): Step<{ value: number; at: Vec2 }> {
    for (;;) {
      const input = yield* this.ask({ ...req, kind: 'value' });
      if (!input) return undefined;
      if (input.kind === 'value') return { value: input.value, at: input.at };
    }
  }

  *entity(ctx: ToolContext, req: Ask<EntityRequest>): Step<{ entity: Entity; at: Vec2 }> {
    for (;;) {
      const input = yield* this.ask({ ...req, kind: 'entity' });
      if (!input) return undefined;
      if (input.kind !== 'entity') continue;
      const entity = ctx.drawing.entities.get(input.id);
      if (entity && req.accepts(entity)) return { entity, at: input.at };
    }
  }

  private *ask(req: Request): Generator<Request, ToolInput | undefined, ToolInput> {
    const input = yield { ...req, options: [...this.options(), ...(req.options ?? [])] };
    if (input.kind === 'finish') return undefined;
    if (input.kind === 'option' && input.key.startsWith(METHOD_PREFIX)) {
      const key = input.key.slice(METHOD_PREFIX.length);
      const m = this.methods.find((x) => x.key === key);
      if (m) this.current = m.key;
      return undefined;
    }
    return input;
  }
}

/** Adds one new entity as its own undo step, and returns it. */
export function addEntity<E extends Entity>(ctx: ToolContext, label: string, make: (id: EntityId) => E): E {
  const e = make(newEntityId(ctx.drawing));
  ctx.undo.commit({ label, changes: [{ op: 'add', entity: e }] });
  return e;
}

/** Id given to preview entities, which never enter the drawing. */
export const PREVIEW_ID = 'preview';

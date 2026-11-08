import type { Vec2 } from '../geometry/vec';
import type { Drawing } from '../model/drawing';
import type { Entity, EntityProps } from '../model/entity';
import type { UndoStack } from '../model/undo';

/** A button in the options bar while a step is waiting. */
export type ToolOption = { readonly key: string; readonly label: string; readonly enabled: boolean };

/**
 * What a tool step asks for. Phase 1b adds `{ kind: 'entity' }` for picking
 * objects (tangent circles, offset).
 */
export type PointRequest = {
  readonly kind: 'point';
  /** Instruction for the status line, e.g. "Pick the first point". */
  readonly prompt: string;
  /** The previous point: enables length/angle and dX/dY entry and the rubber band. */
  readonly base?: Vec2;
  /** Entities to draw as a preview for a candidate point. */
  readonly preview?: (p: Vec2) => readonly Entity[];
  readonly options?: readonly ToolOption[];
  /** True when Enter with nothing locked finishes the tool, as in a line chain. */
  readonly canFinish?: boolean;
};

export type Request = PointRequest;

export type ToolInput =
  | { readonly kind: 'point'; readonly at: Vec2 }
  | { readonly kind: 'option'; readonly key: string }
  | { readonly kind: 'finish' };

/** A tool is a generator: each `yield` is one step waiting for one input. */
export type ToolGen = Generator<Request, void, ToolInput>;

export interface ToolContext {
  readonly drawing: Drawing;
  readonly undo: UndoStack;
  /** Layer and style for new entities, from the toolbar's current settings. */
  newProps(): EntityProps;
  /** Shows a short message to the user (status line). */
  message(text: string): void;
}

export type ToolDef = {
  readonly id: string;
  readonly label: string;
  /** Single-key shortcut, lowercase. */
  readonly shortcut: string;
  run(ctx: ToolContext): ToolGen;
};

/**
 * Drives the active tool's generator. Tools are sticky: when one completes it
 * starts again, so you can keep drawing until Esc or another tool.
 */
export class ToolRunner {
  private active: { def: ToolDef; gen: ToolGen; request: Request } | undefined;

  constructor(private readonly ctx: ToolContext) {}

  get tool(): ToolDef | undefined {
    return this.active?.def;
  }

  get request(): Request | undefined {
    return this.active?.request;
  }

  start(def: ToolDef): void {
    this.stop();
    this.launch(def);
  }

  send(input: ToolInput): void {
    const a = this.active;
    if (!a) return;
    this.advance(a.def, () => a.gen.next(input), true);
  }

  /** Esc: leaves the tool. Whatever it already committed stays committed. */
  stop(): void {
    this.active?.gen.return();
    this.active = undefined;
  }

  private launch(def: ToolDef): void {
    const gen = def.run(this.ctx);
    this.active = { def, gen, request: { kind: 'point', prompt: '' } };
    this.advance(def, () => gen.next(), false);
  }

  private advance(def: ToolDef, step: () => IteratorResult<Request, void>, restartWhenDone: boolean): void {
    let result: IteratorResult<Request, void>;
    try {
      result = step();
    } catch (err) {
      this.active = undefined;
      this.ctx.message(`${def.label} failed: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    if (!result.done) {
      if (this.active) this.active.request = result.value;
      return;
    }
    this.active = undefined;
    // A tool that ends before asking for anything would restart forever; don't.
    if (restartWhenDone) this.launch(def);
  }
}

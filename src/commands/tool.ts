import type { Deferred } from '../geometry/curve';
import type { Vec2 } from '../geometry/vec';
import type { Anchor } from '../model/anchor';
import type { Drawing } from '../model/drawing';
import type { Entity, EntityId, EntityProps } from '../model/entity';
import type { Row } from '../model/properties';
import type { UndoStack } from '../model/undo';

/** A button in the options bar while a step is waiting. `active` marks the chosen method. */
export type ToolOption = {
  readonly key: string;
  readonly label: string;
  readonly enabled: boolean;
  readonly active?: boolean;
};

/** A step that asks for a point: clicked, or typed into the input boxes. */
export type PointRequest = {
  readonly kind: 'point';
  /** Instruction for the status line, e.g. "Pick the first point". */
  readonly prompt: string;
  /** The previous point: enables length/angle and dX/dY entry and the rubber band. */
  readonly base?: Vec2;
  /** Entities to draw as a preview for a candidate point, or a deferred one. */
  readonly preview?: (p: Vec2, deferred?: Deferred) => readonly Entity[];
  /** Entities shown as a preview wherever the cursor is, even off the drawing (Import STEP's part in place). */
  readonly shown?: () => readonly Entity[];
  /**
   * True when, with no base point yet, the step takes a deferred Tangent or
   * Perpendicular pick (a line end that slides along a curve until the other
   * end is known).
   */
  readonly acceptsDeferred?: boolean;
  readonly options?: readonly ToolOption[];
  /** True when Enter with nothing locked finishes the tool, as in a line chain. */
  readonly canFinish?: boolean;
};

/**
 * A step that asks for one number (a radius, diameter, angle or distance). One
 * input box follows the cursor; clicking takes the value the cursor gives, and
 * a typed value is locked like a point's.
 */
export type ValueRequest = {
  readonly kind: 'value';
  readonly prompt: string;
  /** Label on the input box, e.g. "R", "Ø", "∠". */
  readonly label: string;
  /** How typed text is read: lengths take unit suffixes, angles are degrees, factors are plain numbers. */
  readonly quantity: 'length' | 'angle' | 'factor';
  /** The value the cursor gives. Absent when the value can only be typed. */
  readonly fromCursor?: (cursor: Vec2) => number | undefined;
  /** Point the value is measured from, for the status line. */
  readonly base?: Vec2;
  /** Preview for a candidate value; `cursor` is where the mouse is (e.g. to choose a side). */
  readonly preview?: (value: number, cursor: Vec2) => readonly Entity[];
  readonly options?: readonly ToolOption[];
  readonly canFinish?: boolean;
};

/** A step that asks the user to click an existing entity. */
export type EntityRequest = {
  readonly kind: 'entity';
  readonly prompt: string;
  /** Which entities can be picked; others are passed over. */
  readonly accepts: (e: Entity) => boolean;
  /**
   * What picking `id` at `at` would do, drawn while hovering; `shift` is
   * whether Shift is held (Trim and Extend swap modes with it). Absent: the
   * entity under the cursor is highlighted.
   */
  readonly preview?: (id: EntityId, at: Vec2, shift: boolean) => readonly Entity[];
  /** No base point; declared so `request.base` reads on any request. */
  readonly base?: never;
  readonly options?: readonly ToolOption[];
  readonly canFinish?: boolean;
};

/**
 * A step that asks for objects to work on. Clicks and window/crossing drags
 * build the selection as they do with no tool; Enter answers with it.
 */
export type SelectionRequest = {
  readonly kind: 'selection';
  readonly prompt: string;
  readonly base?: never;
  readonly options?: readonly ToolOption[];
  /** True when Enter with nothing selected answers `finish` (Trim's "Enter = all edges"). */
  readonly canFinish?: boolean;
};

/**
 * A step that asks for a line of text (a note). A text box opens at `at`
 * with the focus in it; Enter answers with what was typed.
 */
export type TextRequest = {
  readonly kind: 'text';
  readonly prompt: string;
  /** Where the box goes, in drawing units: where the text will be. */
  readonly at: Vec2;
  /** Preview for the text typed so far. */
  readonly preview?: (text: string) => readonly Entity[];
  readonly base?: never;
  readonly options?: readonly ToolOption[];
  readonly canFinish?: boolean;
};

export type Request = PointRequest | ValueRequest | EntityRequest | SelectionRequest | TextRequest;

export type ToolInput =
  /** `deferred` is set only for a step that `acceptsDeferred`; `at` is then where the curve was clicked. */
  /** `anchor`: the geometry feature an object snap put the point on, for dimensions to follow. */
  | { readonly kind: 'point'; readonly at: Vec2; readonly deferred?: Deferred; readonly anchor?: Anchor }
  /** `at` is the cursor when the value was given. */
  | { readonly kind: 'value'; readonly value: number; readonly at: Vec2 }
  /** `at` is where the entity was clicked; `shift` is true for a Shift-click. */
  | { readonly kind: 'entity'; readonly id: EntityId; readonly at: Vec2; readonly shift?: boolean }
  | { readonly kind: 'selection'; readonly ids: readonly EntityId[] }
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'option'; readonly key: string }
  | { readonly kind: 'finish' };

/**
 * Where the last line or arc drawn ends, and the direction it was travelling
 * there. Arc "Continue" starts from it. Stale once `id` is no longer in the
 * drawing (undone).
 */
export type Continuation = { readonly id: EntityId; readonly end: Vec2; readonly dir: Vec2 };

/** An inquiry result: a heading and exact values, rounded only on display. */
export type Report = { readonly title: string; readonly rows: readonly Row[] };

/** A tool is a generator: each `yield` is one step waiting for one input. */
export type ToolGen = Generator<Request, void, ToolInput>;

export interface ToolContext {
  readonly drawing: Drawing;
  readonly undo: UndoStack;
  /** Layer and style for new entities, from the toolbar's current settings. */
  newProps(): EntityProps;
  /** Shows a short message to the user (status line). */
  message(text: string): void;
  /** Shows an inquiry result (Dist, ID, List, Angle) in the results panel. */
  report(result: Report): void;
  /** The objects selected now, in the order they were picked (an edit tool's selection-first input). */
  selection(): readonly EntityId[];
  /** Set by the Line and Arc tools each time they add an entity. */
  continuation: Continuation | undefined;
}

export type ToolDef = {
  readonly id: string;
  readonly label: string;
  /** Single-key shortcut, lowercase, optionally with a `shift+` prefix ("x", "shift+x"). */
  readonly shortcut: string;
  /** False for a one-shot tool (a grip drag) that ends instead of starting again. */
  readonly repeat?: false;
  run(ctx: ToolContext): ToolGen;
};

/**
 * Drives the active tool's generator. Tools are sticky: when one completes it
 * starts again, so you can keep drawing until Esc or another tool (unless
 * the tool says `repeat: false`).
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
    if (restartWhenDone && def.repeat !== false) this.launch(def);
  }
}

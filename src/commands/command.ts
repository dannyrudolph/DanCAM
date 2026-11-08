import type { Drawing } from '../model/drawing';
import type { UndoStack } from '../model/undo';

/**
 * What a command receives at a prompt. Phase 1 adds `{ kind: 'point' }` for
 * clicked and typed coordinates.
 */
export type Input = { readonly kind: 'text'; readonly text: string } | { readonly kind: 'enter' };

/** What a command asks for: a prompt shown on the command line. */
export type Request = { readonly prompt: string };

/**
 * A command is a generator: each `yield` shows a prompt and waits for one
 * Input, so a command reads top to bottom like its AutoCAD prompts.
 */
export type CommandGen = Generator<Request, void, Input>;

/** View operations a command may ask for, provided by the UI. */
export interface ViewControl {
  zoomExtents(): void;
}

export interface CommandContext {
  readonly drawing: Drawing;
  readonly undo: UndoStack;
  readonly view: ViewControl;
  /** Writes a line to the command history. */
  print(message: string): void;
}

export type CommandDef = {
  readonly name: string;
  readonly aliases: readonly string[];
  run(ctx: CommandContext): CommandGen;
};

/**
 * Matches typed text against option keywords the AutoCAD way: case-insensitive,
 * and any prefix of the keyword is enough ("E", "ext", "EXTENTS").
 * Returns the matched keyword, or undefined.
 */
export function matchOption(text: string, options: readonly string[]): string | undefined {
  const t = text.trim().toUpperCase();
  if (t === '') return undefined;
  return options.find((o) => o.toUpperCase().startsWith(t));
}

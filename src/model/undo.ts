import { dimensionFollowUp } from './associate';
import { type Vec2, vecNearlyEqual } from '../geometry/vec';
import type { DimStyle } from './dimStyle';
import type { Drawing, Layer, Units } from './drawing';
import type { Entity } from './entity';

/** One reversible change to the drawing. */
export type Change =
  | { readonly op: 'add'; readonly entity: Entity }
  | { readonly op: 'remove'; readonly entity: Entity }
  | { readonly op: 'modify'; readonly before: Entity; readonly after: Entity }
  /** The drawing's unit label (converting also scales every entity, in the same transaction). */
  | { readonly op: 'units'; readonly before: Units; readonly after: Units }
  /** Adds (no `before`), removes (no `after`) or edits one layer, matched by name. */
  | { readonly op: 'layer'; readonly before?: Layer; readonly after?: Layer }
  /** Adds (no `before`), removes (no `after`) or edits one dimension style, matched by name. */
  | { readonly op: 'dimStyle'; readonly before?: DimStyle; readonly after?: DimStyle }
  /** The sheet (print) scale dimensions are sized for. */
  | { readonly op: 'sheetScale'; readonly before: number; readonly after: number }
  /** The ordinate origin (its ordinates follow in the same transaction, see `associate`). */
  | { readonly op: 'dimOrigin'; readonly before: Vec2; readonly after: Vec2 };

/** A user-level operation: undone and redone as one step. */
export type Transaction = {
  readonly label: string;
  readonly changes: readonly Change[];
};

function invert(c: Change): Change {
  switch (c.op) {
    case 'add':
      return { op: 'remove', entity: c.entity };
    case 'remove':
      return { op: 'add', entity: c.entity };
    case 'modify':
      return { op: 'modify', before: c.after, after: c.before };
    case 'units':
    case 'sheetScale':
    case 'dimOrigin':
      return { ...c, before: c.after, after: c.before } as Change;
    case 'layer':
      return { op: 'layer', ...(c.after && { before: c.after }), ...(c.before && { after: c.before }) };
    case 'dimStyle':
      return { op: 'dimStyle', ...(c.after && { before: c.after }), ...(c.before && { after: c.before }) };
  }
}

/** Applies one change. Throws if the drawing is not in the state the change expects. */
function apply(d: Drawing, c: Change): void {
  switch (c.op) {
    case 'add':
      if (d.entities.has(c.entity.id)) throw new Error(`add: ${c.entity.id} already exists`);
      d.entities.set(c.entity.id, c.entity);
      return;
    case 'remove':
      if (!d.entities.has(c.entity.id)) throw new Error(`remove: ${c.entity.id} not found`);
      d.entities.delete(c.entity.id);
      return;
    case 'modify':
      if (c.before.id !== c.after.id) throw new Error('modify: before and after ids differ');
      if (!d.entities.has(c.before.id)) throw new Error(`modify: ${c.before.id} not found`);
      d.entities.set(c.after.id, c.after);
      return;
    case 'units':
      if (d.units !== c.before) throw new Error(`units: drawing is ${d.units}, expected ${c.before}`);
      d.units = c.after;
      return;
    case 'sheetScale':
      if (d.sheetScale !== c.before) throw new Error(`sheetScale: drawing is ${d.sheetScale}, expected ${c.before}`);
      d.sheetScale = c.after;
      return;
    case 'dimOrigin':
      if (!vecNearlyEqual(d.dimOrigin, c.before)) throw new Error('dimOrigin: drawing origin is not the expected one');
      d.dimOrigin = c.after;
      return;
    case 'layer':
      applyLayer(d, c.before, c.after);
      return;
    case 'dimStyle':
      applyDimStyle(d, c.before, c.after);
      return;
  }
}

function applyDimStyle(d: Drawing, before: DimStyle | undefined, after: DimStyle | undefined): void {
  if (before && after && before.name !== after.name) throw new Error('dimStyle: a change keeps the name');
  const name = (before ?? after)?.name;
  if (name === undefined) throw new Error('dimStyle: change has neither before nor after');
  if (before ? !d.dimStyles.has(name) : d.dimStyles.has(name)) {
    throw new Error(before ? `dimStyle: ${name} not found` : `dimStyle: ${name} already exists`);
  }
  if (after) d.dimStyles.set(name, after);
  else d.dimStyles.delete(name);
}

function applyLayer(d: Drawing, before: Layer | undefined, after: Layer | undefined): void {
  if (before && after && before.name !== after.name) throw new Error('layer: a change keeps the name; rename is remove + add');
  const name = (before ?? after)?.name;
  if (name === undefined) throw new Error('layer: change has neither before nor after');
  if (before ? !d.layers.has(name) : d.layers.has(name)) {
    throw new Error(before ? `layer: ${name} not found` : `layer: ${name} already exists`);
  }
  if (after) {
    d.layers.set(name, after);
    return;
  }
  for (const e of d.entities.values()) {
    if (e.layer === name) throw new Error(`layer: ${name} still has entities`);
  }
  d.layers.delete(name);
}

/**
 * The only way the drawing changes (CAD-3). `commit` applies a transaction and
 * records it; `undo` and `redo` replay its inverse or itself.
 */
export class UndoStack {
  private readonly done: Transaction[] = [];
  private readonly undone: Transaction[] = [];
  /** The newest applied transaction when the drawing was last saved or opened. */
  private savedAt: Transaction | undefined;

  constructor(private readonly drawing: Drawing) {}

  /**
   * Applies `tx`, then measures again the dimensions on the geometry it
   * changed (deleting those whose geometry is gone); those changes join the
   * transaction, so undo restores both.
   */
  commit(tx: Transaction): void {
    if (tx.changes.length === 0) return;
    for (const c of tx.changes) apply(this.drawing, c);
    const follow = dimensionFollowUp(this.drawing, tx.changes);
    for (const c of follow) apply(this.drawing, c);
    this.done.push(follow.length === 0 ? tx : { label: tx.label, changes: [...tx.changes, ...follow] });
    this.undone.length = 0;
  }

  /** Returns false when there is nothing to undo. */
  undo(): boolean {
    const tx = this.done.pop();
    if (!tx) return false;
    for (let i = tx.changes.length - 1; i >= 0; i--) {
      apply(this.drawing, invert(tx.changes[i]!));
    }
    this.undone.push(tx);
    return true;
  }

  /** Returns false when there is nothing to redo. */
  redo(): boolean {
    const tx = this.undone.pop();
    if (!tx) return false;
    for (const c of tx.changes) apply(this.drawing, c);
    this.done.push(tx);
    return true;
  }

  /** Records that the drawing as it is now has been saved. */
  markSaved(): void {
    this.savedAt = this.done.at(-1);
  }

  /** True when the drawing differs from the last save (undoing back to it makes it clean again). */
  get dirty(): boolean {
    return this.done.at(-1) !== this.savedAt;
  }

  get undoLabel(): string | undefined {
    return this.done.at(-1)?.label;
  }

  get redoLabel(): string | undefined {
    return this.undone.at(-1)?.label;
  }
}

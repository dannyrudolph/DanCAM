import type { Drawing } from './drawing';
import type { Entity } from './entity';

/** One reversible change to the drawing. */
export type Change =
  | { readonly op: 'add'; readonly entity: Entity }
  | { readonly op: 'remove'; readonly entity: Entity }
  | { readonly op: 'modify'; readonly before: Entity; readonly after: Entity };

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
  }
}

/**
 * The only way the drawing changes (CAD-3). `commit` applies a transaction and
 * records it; `undo` and `redo` replay its inverse or itself.
 */
export class UndoStack {
  private readonly done: Transaction[] = [];
  private readonly undone: Transaction[] = [];

  constructor(private readonly drawing: Drawing) {}

  commit(tx: Transaction): void {
    if (tx.changes.length === 0) return;
    for (const c of tx.changes) apply(this.drawing, c);
    this.done.push(tx);
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

  get undoLabel(): string | undefined {
    return this.done.at(-1)?.label;
  }

  get redoLabel(): string | undefined {
    return this.undone.at(-1)?.label;
  }
}

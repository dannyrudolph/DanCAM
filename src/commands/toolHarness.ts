import type { Vec2 } from '../geometry/vec';
import { createDrawing } from '../model/drawing';
import type { Entity, EntityId, LineEntity } from '../model/entity';
import { UndoStack } from '../model/undo';
import { type ToolContext, ToolRunner } from './tool';

/**
 * Test harness: runs tools against a fresh drawing without the UI, feeding
 * them clicks, values, entity picks and option buttons.
 */
export function setup(style?: 'hidden') {
  const drawing = createDrawing('in');
  const undo = new UndoStack(drawing);
  const messages: string[] = [];
  /** What the app has selected when a tool starts; tests set it directly. */
  let selected: string[] = [];
  const select = (...ids: string[]): void => {
    selected = ids;
  };
  const ctx: ToolContext = {
    drawing,
    undo,
    newProps: () => (style ? { layer: '0', style } : { layer: '0' }),
    message: (m) => messages.push(m),
    selection: () => selected,
    continuation: undefined,
  };
  const runner = new ToolRunner(ctx);
  const click = (x: number, y: number): void => runner.send({ kind: 'point', at: { x, y } });
  const value = (v: number, at: Vec2 = { x: 0, y: 0 }): void => runner.send({ kind: 'value', value: v, at });
  const pick = (id: EntityId, x: number, y: number): void => runner.send({ kind: 'entity', id, at: { x, y } });
  const option = (key: string): void => runner.send({ kind: 'option', key });
  const add = (e: Entity): void => void drawing.entities.set(e.id, e);
  const entities = (): Entity[] => [...drawing.entities.values()];
  const last = (): Entity | undefined => entities().at(-1);
  const lines = (): [number, number, number, number][] =>
    entities()
      .filter((e): e is LineEntity => e.kind === 'line')
      .map((l) => [l.start.x, l.start.y, l.end.x, l.end.y]);
  /** The waiting step's preview for a cursor point (point steps) or value (value steps). */
  const preview = (p: Vec2, v?: number): readonly Entity[] => {
    const req = runner.request;
    if (req?.kind === 'point') return req.preview?.(p) ?? [];
    if (req?.kind === 'value') return req.preview?.(v ?? req.fromCursor?.(p) ?? 0, p) ?? [];
    return [];
  };
  const selectionDone = (...ids: string[]): void => runner.send({ kind: 'selection', ids });
  return { drawing, undo, messages, ctx, runner, click, value, pick, option, add, entities, last, lines, preview, select, selectionDone };
}

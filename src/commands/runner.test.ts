import { describe, expect, it } from 'vitest';
import { createDrawing } from '../model/drawing';
import { UndoStack } from '../model/undo';
import { registerBuiltins } from './builtins';
import type { CommandContext } from './command';
import { CommandRegistry } from './registry';
import { CommandRunner, IDLE_PROMPT } from './runner';

function setup() {
  const drawing = createDrawing('in');
  const undo = new UndoStack(drawing);
  const printed: string[] = [];
  let extentsCalls = 0;
  const ctx: CommandContext = {
    drawing,
    undo,
    view: { zoomExtents: () => (extentsCalls += 1) },
    print: (m) => printed.push(m),
  };
  const registry = new CommandRegistry();
  registerBuiltins(registry);
  const runner = new CommandRunner(registry, ctx);
  return { runner, registry, drawing, undo, printed, extents: () => extentsCalls };
}

describe('CommandRunner', () => {
  it('Z then E zooms to extents and returns to the idle prompt', () => {
    const t = setup();
    t.runner.submit('Z');
    expect(t.runner.prompt).toBe('ZOOM [Extents]:');
    expect(t.runner.activeCommand).toBe('ZOOM');
    t.runner.submit('e');
    expect(t.extents()).toBe(1);
    expect(t.runner.prompt).toBe(IDLE_PROMPT);
    expect(t.runner.activeCommand).toBeUndefined();
  });

  it('re-asks after an invalid option instead of ending the command', () => {
    const t = setup();
    t.runner.submit('ZOOM');
    t.runner.submit('Q');
    expect(t.printed).toEqual(['Invalid option keyword.']);
    expect(t.runner.prompt).toBe('ZOOM [Extents]:');
    t.runner.submit('EXTENTS');
    expect(t.extents()).toBe(1);
  });

  it('Enter at the ZOOM prompt ends the command without zooming', () => {
    const t = setup();
    t.runner.submit('Z');
    t.runner.submit('');
    expect(t.extents()).toBe(0);
    expect(t.runner.prompt).toBe(IDLE_PROMPT);
  });

  it('Esc cancels the running command', () => {
    const t = setup();
    t.runner.submit('Z');
    t.runner.cancel();
    expect(t.printed).toEqual(['*Cancel*']);
    expect(t.runner.activeCommand).toBeUndefined();
    t.runner.submit('E'); // now an unknown command, not a ZOOM option
    expect(t.extents()).toBe(0);
  });

  it('reports an unknown command and stays idle', () => {
    const t = setup();
    t.runner.submit('frob');
    expect(t.printed).toEqual(['Unknown command "FROB".']);
    expect(t.runner.prompt).toBe(IDLE_PROMPT);
  });

  it('Enter at the idle prompt does nothing', () => {
    const t = setup();
    t.runner.submit('   ');
    expect(t.printed).toEqual([]);
  });

  it('U undoes the last transaction and REDO redoes it, naming the step', () => {
    const t = setup();
    t.undo.commit({
      label: 'LINE',
      changes: [{ op: 'add', entity: { kind: 'point', id: 'e1', layer: '0', at: { x: 1, y: 2 } } }],
    });
    t.runner.submit('U');
    expect(t.drawing.entities.size).toBe(0);
    t.runner.submit('REDO');
    expect(t.drawing.entities.size).toBe(1);
    t.runner.submit('redo');
    expect(t.printed).toEqual(['Undo: LINE', 'Redo: LINE', 'Nothing to redo.']);
  });

  it('U with nothing to undo says so', () => {
    const t = setup();
    t.runner.submit('u');
    expect(t.printed).toEqual(['Nothing to undo.']);
  });

  it('a command that throws is ended and its error printed, so the runner is not stuck', () => {
    const t = setup();
    t.registry.register({
      name: 'BOOM',
      aliases: [],
      *run() {
        yield { prompt: 'Go:' };
        throw new Error('kaboom');
      },
    });
    t.runner.submit('BOOM');
    expect(t.runner.prompt).toBe('Go:');
    t.runner.submit('x');
    expect(t.printed).toEqual(['BOOM failed: kaboom']);
    expect(t.runner.prompt).toBe(IDLE_PROMPT);
    t.runner.submit('Z');
    expect(t.runner.activeCommand).toBe('ZOOM');
  });
});

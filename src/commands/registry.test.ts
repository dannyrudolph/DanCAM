import { describe, expect, it } from 'vitest';
import { redoCommand, registerBuiltins, undoCommand, zoomCommand } from './builtins';
import { matchOption } from './command';
import { CommandRegistry } from './registry';

describe('CommandRegistry', () => {
  const registry = new CommandRegistry();
  registerBuiltins(registry);

  it('resolves names and aliases case-insensitively', () => {
    expect(registry.lookup('ZOOM')).toBe(zoomCommand);
    expect(registry.lookup('z')).toBe(zoomCommand);
    expect(registry.lookup('Zoom')).toBe(zoomCommand);
    expect(registry.lookup('U')).toBe(undoCommand);
    expect(registry.lookup('undo')).toBe(undoCommand);
    expect(registry.lookup('redo')).toBe(redoCommand);
  });

  it('returns undefined for an unknown command', () => {
    expect(registry.lookup('FROB')).toBeUndefined();
  });

  it('refuses a second command claiming an existing alias', () => {
    expect(() => registry.register({ name: 'ZAP', aliases: ['Z'], *run() {} })).toThrow(/"Z" is already registered/);
  });
});

describe('matchOption', () => {
  it('matches any case-insensitive prefix of an option keyword', () => {
    expect(matchOption('E', ['Extents'])).toBe('Extents');
    expect(matchOption('ext', ['Extents'])).toBe('Extents');
    expect(matchOption('EXTENTS', ['Extents'])).toBe('Extents');
  });

  it('rejects text that is not a prefix, and empty text', () => {
    expect(matchOption('X', ['Extents'])).toBeUndefined();
    expect(matchOption('extentsx', ['Extents'])).toBeUndefined();
    expect(matchOption('  ', ['Extents'])).toBeUndefined();
  });
});

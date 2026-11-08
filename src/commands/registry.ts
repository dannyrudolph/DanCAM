import type { CommandDef } from './command';

/** Command names and aliases, matched case-insensitively. */
export class CommandRegistry {
  private readonly byName = new Map<string, CommandDef>();

  register(def: CommandDef): void {
    for (const key of [def.name, ...def.aliases]) {
      const k = key.toUpperCase();
      if (this.byName.has(k)) throw new Error(`Command name or alias "${k}" is already registered`);
      this.byName.set(k, def);
    }
  }

  lookup(nameOrAlias: string): CommandDef | undefined {
    return this.byName.get(nameOrAlias.trim().toUpperCase());
  }
}

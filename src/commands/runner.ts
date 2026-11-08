import type { CommandContext, CommandGen, Input, Request } from './command';
import type { CommandRegistry } from './registry';

export const IDLE_PROMPT = 'Command:';

/**
 * Feeds command-line input to the running command, or starts a command when
 * none is running. Drives each command's generator one prompt at a time.
 */
export class CommandRunner {
  private active: { name: string; gen: CommandGen } | undefined;
  private currentPrompt = IDLE_PROMPT;

  constructor(
    private readonly registry: CommandRegistry,
    private readonly ctx: CommandContext,
  ) {}

  get prompt(): string {
    return this.currentPrompt;
  }

  get activeCommand(): string | undefined {
    return this.active?.name;
  }

  /** One submitted line of the command line. Empty text counts as Enter. */
  submit(text: string): void {
    const trimmed = text.trim();
    const input: Input = trimmed === '' ? { kind: 'enter' } : { kind: 'text', text: trimmed };
    if (this.active) {
      const gen = this.active.gen;
      this.step(() => gen.next(input));
      return;
    }
    if (input.kind === 'enter') return;
    const def = this.registry.lookup(input.text);
    if (!def) {
      this.ctx.print(`Unknown command "${input.text.toUpperCase()}".`);
      return;
    }
    const gen = def.run(this.ctx);
    this.active = { name: def.name, gen };
    this.step(() => gen.next());
  }

  /** Esc: abandons the running command without committing anything further. */
  cancel(): void {
    if (!this.active) return;
    this.active.gen.return();
    this.active = undefined;
    this.currentPrompt = IDLE_PROMPT;
    this.ctx.print('*Cancel*');
  }

  /**
   * Advances the active command. A command that throws is ended and its error
   * printed, so the command line never stays stuck in a dead command.
   */
  private step(advance: () => IteratorResult<Request, void>): void {
    let result: IteratorResult<Request, void>;
    try {
      result = advance();
    } catch (err) {
      const name = this.active?.name ?? 'command';
      this.ctx.print(`${name} failed: ${err instanceof Error ? err.message : String(err)}`);
      result = { done: true, value: undefined };
    }
    if (result.done) {
      this.active = undefined;
      this.currentPrompt = IDLE_PROMPT;
    } else {
      this.currentPrompt = result.value.prompt;
    }
  }
}

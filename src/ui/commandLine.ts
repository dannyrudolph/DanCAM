import type { CommandRunner } from '../commands/runner';

/** Lines of history kept in the command-line panel. */
const HISTORY_LIMIT = 200;

/**
 * The command line: a history panel, the current prompt and a text input.
 * Enter or Space submits the typed text, AutoCAD style; Esc cancels.
 */
export class CommandLine {
  private readonly history: HTMLElement;
  private readonly promptEl: HTMLElement;
  readonly input: HTMLInputElement;
  private runner: CommandRunner | undefined;

  constructor(root: HTMLElement, private readonly onAfterInput: () => void) {
    this.history = document.createElement('div');
    this.history.className = 'cmd-history';
    const row = document.createElement('div');
    row.className = 'cmd-row';
    this.promptEl = document.createElement('span');
    this.promptEl.className = 'cmd-prompt';
    this.input = document.createElement('input');
    this.input.className = 'cmd-input';
    this.input.autocomplete = 'off';
    this.input.spellcheck = false;
    row.append(this.promptEl, this.input);
    root.append(this.history, row);
    this.input.addEventListener('keydown', (e) => this.onKey(e));
  }

  attach(runner: CommandRunner): void {
    this.runner = runner;
    this.refreshPrompt();
  }

  print(message: string): void {
    const line = document.createElement('div');
    line.textContent = message;
    this.history.append(line);
    while (this.history.childElementCount > HISTORY_LIMIT) this.history.firstElementChild?.remove();
    this.history.scrollTop = this.history.scrollHeight;
  }

  /** Runs a line as if typed, echoing it to the history. */
  run(text: string): void {
    if (!this.runner) return;
    this.print(`${this.runner.prompt} ${text}`);
    this.runner.submit(text);
    this.refreshPrompt();
    this.onAfterInput();
  }

  cancel(): void {
    this.runner?.cancel();
    this.input.value = '';
    this.refreshPrompt();
    this.onAfterInput();
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const text = this.input.value;
      this.input.value = '';
      this.run(text);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.cancel();
    }
  }

  private refreshPrompt(): void {
    this.promptEl.textContent = this.runner?.prompt ?? '';
  }
}

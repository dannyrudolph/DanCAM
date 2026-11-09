import {
  type EntryMode,
  type FieldKey,
  type Locks,
  type Tracking,
  fieldValue,
  fieldsFor,
  resolvePoint,
} from '../commands/pointInput';
import type { Request } from '../commands/tool';
import { type ParseResult, parseAngle, parseFactor, parseLength } from '../commands/valueExpr';
import type { Vec2 } from '../geometry/vec';
import type { Units } from '../model/drawing';
import { type AxisView, axisNames, radialFactor } from '../model/latheView';
import { formatNumber } from './statusBar';

/** A point's fields, the single box of a value request, or the text box of a text request. */
type BoxKey = FieldKey | 'value' | 'text';

/** A box's name in this view: lathe mode names the axes Z and X (Ø with diameter on). */
function fieldLabel(key: FieldKey, view: AxisView): string {
  const n = axisNames(view);
  const labels: Record<FieldKey, string> = { x: n.h, y: n.v, dx: `Δ${n.h}`, dy: `Δ${n.v}`, length: 'L', angle: '∠' };
  return labels[key];
}

/** Vertical boxes show and take values times this (2 for diameters). */
const factorFor = (key: BoxKey, view: AxisView): number => (key === 'y' || key === 'dy' ? radialFactor(view) : 1);
/** The entry-mode button's text, with the axes named for the view (Ø shown as X: the mode, not the value). */
function modeLabel(mode: EntryMode, view: AxisView): string {
  const n = axisNames({ ...view, diameter: false });
  return { polar: 'L∠', delta: `Δ${n.h}${n.v}`, absolute: `${n.h}${n.v}` }[mode];
}
const NEXT_MODE: Record<EntryMode, EntryMode> = { polar: 'delta', delta: 'absolute', absolute: 'polar' };

/** Offset of the boxes from the cursor, CSS pixels. */
const OFFSET_PX = 18;

/** What Enter means after the boxes have taken their turn. */
export type EnterAction = 'place' | 'finish' | 'none';

export type InputBoxesHost = {
  units(): Units;
  precision(): number;
  /** How the axes are named and whether vertical values are diameters. */
  axisView(): AxisView;
  /** Called after any change that moves the resolved point (typing, locking, mode). */
  changed(): void;
  enter(action: EnterAction): void;
  escape(): void;
};

type Field = { key: BoxKey; input: HTMLInputElement; dirty: boolean };

/**
 * The input boxes that follow the cursor while a tool asks for a point or a
 * value. Typing a value and pressing Tab locks it; locked values constrain the
 * point. An entity pick has no boxes. A text step has one box, at the text's
 * place rather than the cursor, holding the focus; it is never locked.
 */
export class InputBoxes {
  private readonly root: HTMLElement;
  private readonly modeButton: HTMLButtonElement;
  private fields: Field[] = [];
  private request: Request | undefined;
  private locks: Partial<Record<BoxKey, number>> = {};
  private mode: EntryMode = 'polar';

  constructor(
    container: HTMLElement,
    private readonly host: InputBoxesHost,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'input-boxes';
    this.root.hidden = true;
    this.modeButton = document.createElement('button');
    this.modeButton.className = 'input-mode';
    this.modeButton.type = 'button';
    this.modeButton.tabIndex = -1;
    this.modeButton.title = 'Switch between length/angle, ΔX/ΔY and absolute X/Y';
    this.modeButton.addEventListener('mousedown', (e) => e.preventDefault());
    this.modeButton.addEventListener('click', () => this.setMode(NEXT_MODE[this.mode]));
    container.append(this.root);
  }

  get hasLocks(): boolean {
    return Object.keys(this.locks).length > 0;
  }

  get focused(): boolean {
    return this.root.contains(document.activeElement);
  }

  /** Shows the boxes for a new step, or hides them. A new step clears locks. */
  setRequest(req: Request | undefined): void {
    if (req === this.request) return;
    this.request = req;
    this.locks = {};
    this.rebuild();
  }

  /** Renames the boxes after lathe mode or diameter display changes, keeping what is typed and locked. */
  relabel(): void {
    for (const f of this.fields) {
      if (f.key === 'value' || f.key === 'text') continue;
      const name = f.input.previousElementSibling;
      if (name) name.textContent = fieldLabel(f.key, this.host.axisView());
    }
    this.modeButton.textContent = modeLabel(this.mode, this.host.axisView());
    this.host.changed();
  }

  clearLocks(): void {
    this.locks = {};
    for (const f of this.fields) f.dirty = false;
    this.blur();
    this.host.changed();
  }

  /** The point a click or Enter would place now, counting valid text still being typed. */
  resolve(cursor: Vec2, tracking: Tracking, snap?: Vec2): Vec2 {
    return resolvePoint(cursor, this.request?.base, this.effectiveMode(), this.provisionalLocks(), tracking, snap);
  }

  /** What is typed in a text step's box; empty for any other step. */
  textValue(): string {
    return this.fields.find((f) => f.key === 'text')?.input.value ?? '';
  }

  /** The value a click or Enter would give a value request now: typed, else from the cursor. */
  resolveValue(cursor: Vec2): number | undefined {
    if (this.request?.kind !== 'value') return undefined;
    return this.provisionalLocks().value ?? this.request.fromCursor?.(cursor);
  }

  /**
   * Moves the boxes next to the cursor and refreshes the live values. `point`
   * is the resolved point for a point request, the cursor for a value request.
   */
  update(cursorScreen: Vec2 | undefined, point: Vec2 | undefined): void {
    if (this.fields.length === 0) {
      this.root.hidden = true;
      return;
    }
    if (!this.request || !cursorScreen || !point) {
      this.root.hidden = !this.request || !this.focused;
      if (!this.request) return;
    } else {
      this.root.hidden = false;
      this.root.style.transform = `translate(${cursorScreen.x + OFFSET_PX}px, ${cursorScreen.y + OFFSET_PX}px)`;
    }
    for (const f of this.fields) {
      if (f.key === 'text') continue; // only ever what was typed
      const locked = this.locks[f.key];
      f.input.classList.toggle('locked', locked !== undefined);
      if (f.dirty) continue; // never overwrite what the user is typing
      const value = locked ?? (point ? this.liveValue(f.key, point) : undefined);
      if (value === undefined) continue;
      const text = formatNumber(value * factorFor(f.key, this.host.axisView()), this.host.precision());
      if (f.input.value === text) continue;
      f.input.value = text;
      // A focused box keeps its text selected, so typing replaces the live value.
      if (document.activeElement === f.input) f.input.select();
    }
  }

  /**
   * Starts typing into the first unlocked box with `ch`, for a key pressed
   * while the canvas has focus. Returns false when there are no boxes.
   */
  startTyping(ch: string): boolean {
    if (this.request?.kind === 'text') {
      const f = this.fields[0];
      if (!f) return false;
      this.focusText(f);
      f.input.value += ch;
      f.dirty = true;
      this.host.changed();
      return true;
    }
    const target = this.fields.find((f) => this.locks[f.key] === undefined) ?? this.fields[0];
    if (!target) return false;
    this.root.hidden = false; // a hidden input can't take focus
    target.input.focus();
    target.input.value = ch;
    target.dirty = true;
    this.host.changed();
    return true;
  }

  focusFirst(): boolean {
    const f = this.fields[0];
    if (!f) return false;
    if (f.key === 'text') {
      this.focusText(f);
      return true;
    }
    this.root.hidden = false;
    f.input.focus();
    f.input.select();
    return true;
  }

  /** Focuses a text box with the caret after what is typed, keeping it. */
  private focusText(f: Field): void {
    this.root.hidden = false;
    f.input.focus();
    const end = f.input.value.length;
    f.input.setSelectionRange(end, end);
  }

  /** What Enter should do, after locking any value still being typed. A text step always places. */
  enterAction(): EnterAction {
    if (this.request?.kind === 'text') return 'place';
    for (const f of this.fields) {
      if (f.dirty && !this.lockField(f)) return 'none';
    }
    if (this.hasLocks) return 'place';
    return this.request?.canFinish ? 'finish' : 'none';
  }

  private liveValue(key: BoxKey, p: Vec2): number | undefined {
    if (key === 'text') return undefined;
    if (key !== 'value') return fieldValue(key, p, this.request?.base);
    return this.request?.kind === 'value' ? this.request.fromCursor?.(p) : undefined;
  }

  private effectiveMode(): EntryMode {
    return this.request?.base ? this.mode : 'absolute';
  }

  private setMode(mode: EntryMode): void {
    this.mode = mode;
    this.locks = {};
    this.rebuild();
    this.host.changed();
  }

  private provisionalLocks(): Locks & { value?: number } {
    const locks: Locks & { value?: number } = { ...this.locks };
    for (const f of this.fields) {
      if (!f.dirty || f.key === 'text') continue;
      const r = this.parse(f);
      if (r.ok) locks[f.key] = r.value / factorFor(f.key, this.host.axisView());
    }
    return locks;
  }

  private parse(f: Field): ParseResult {
    const q = f.key === 'value' && this.request?.kind === 'value' ? this.request.quantity : undefined;
    if (f.key === 'angle' || q === 'angle') return parseAngle(f.input.value);
    if (q === 'factor') return parseFactor(f.input.value);
    return parseLength(f.input.value, this.host.units());
  }

  /** Locks a typed value, or unlocks the field when it was emptied. False if the text is invalid. */
  private lockField(f: Field): boolean {
    if (f.input.value.trim() === '') {
      delete this.locks[f.key];
      f.dirty = false;
      f.input.classList.remove('invalid');
      return true;
    }
    const r = this.parse(f);
    if (!r.ok) {
      f.input.classList.add('invalid');
      f.input.title = r.error;
      return false;
    }
    this.locks[f.key] = r.value / factorFor(f.key, this.host.axisView()); // a typed diameter locks the radius
    f.dirty = false;
    f.input.classList.remove('invalid');
    f.input.title = '';
    return true;
  }

  private blur(): void {
    if (this.focused && document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }

  private rebuild(): void {
    this.blur();
    this.root.replaceChildren();
    this.fields = [];
    if (!this.request) {
      this.root.hidden = true;
      return;
    }
    const keys: readonly BoxKey[] =
      this.request.kind === 'point'
        ? fieldsFor(this.request.base, this.effectiveMode())
        : this.request.kind === 'value'
          ? ['value']
          : this.request.kind === 'text'
            ? ['text']
            : [];
    const req = this.request;
    for (const key of keys) {
      const label = document.createElement('label');
      label.className = 'input-field';
      const name = document.createElement('span');
      name.textContent = key === 'text' ? 'Note' : key === 'value' ? (req.kind === 'value' ? req.label : '') : fieldLabel(key, this.host.axisView());
      const input = document.createElement('input');
      if (key === 'text') input.className = 'input-text';
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.dataset.field = key;
      const field: Field = { key, input, dirty: false };
      input.addEventListener('input', () => {
        field.dirty = true;
        input.classList.remove('invalid');
        this.host.changed();
      });
      if (key !== 'text') input.addEventListener('focus', () => input.select());
      input.addEventListener('keydown', (e) => this.onKey(e, field));
      label.append(name, input);
      this.root.append(label);
      this.fields.push(field);
    }
    if (this.request.kind === 'point' && this.request.base) {
      this.modeButton.textContent = modeLabel(this.mode, this.host.axisView());
      this.root.append(this.modeButton);
    }
    // A note is typed straight away: the box takes the focus, so keys don't start tools.
    const text = this.fields.find((f) => f.key === 'text');
    if (text) this.focusText(text);
  }

  private onKey(e: KeyboardEvent, f: Field): void {
    if (e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      if (f.key === 'text') return; // nothing to lock or move to
      if (f.dirty && !this.lockField(f)) return;
      const i = this.fields.indexOf(f);
      const next = this.fields[(i + (e.shiftKey ? this.fields.length - 1 : 1)) % this.fields.length];
      next?.input.focus();
      this.host.changed();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      const action = this.enterAction();
      if (action !== 'none') this.blur();
      this.host.enter(action);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.host.escape();
    }
  }
}

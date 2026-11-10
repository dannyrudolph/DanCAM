import type { ContextMenu, MenuItem } from './contextMenu';

/** A button on a toolbar: a tool, or a toggle such as a snap kind. */
export type ToolbarItem = { readonly id: string; readonly label: string };

/** One toolbar: a named group of buttons. */
export type ToolbarGroup = { readonly id: string; readonly label: string; readonly items: readonly ToolbarItem[] };

/**
 * Which toolbars and buttons the user has hidden. A per-browser
 * convenience, not part of the drawing: hidden tools keep their shortcuts.
 */
export type ToolbarPrefs = { readonly hiddenBars: readonly string[]; readonly hiddenButtons: readonly string[] };

/** A fresh browser: every toolbar shown but Inquiry. */
export const DEFAULT_TOOLBAR_PREFS: ToolbarPrefs = { hiddenBars: ['inquiry'], hiddenButtons: [] };

const STORAGE_KEY = 'dancam.toolbars';

const strings = (v: unknown): string[] | undefined => (Array.isArray(v) && v.every((s) => typeof s === 'string') ? v : undefined);

/** Saved prefs from their JSON; the defaults when missing or unreadable. */
export function parseToolbarPrefs(text: string | null): ToolbarPrefs {
  if (text === null) return DEFAULT_TOOLBAR_PREFS;
  try {
    const raw = JSON.parse(text) as { hiddenBars?: unknown; hiddenButtons?: unknown };
    const hiddenBars = strings(raw.hiddenBars);
    const hiddenButtons = strings(raw.hiddenButtons);
    return hiddenBars && hiddenButtons ? { hiddenBars, hiddenButtons } : DEFAULT_TOOLBAR_PREFS;
  } catch {
    return DEFAULT_TOOLBAR_PREFS;
  }
}

export const hideButton = (p: ToolbarPrefs, toolId: string): ToolbarPrefs =>
  p.hiddenButtons.includes(toolId) ? p : { ...p, hiddenButtons: [...p.hiddenButtons, toolId] };

/** Every button of `group` shown again. */
export const resetBar = (p: ToolbarPrefs, group: ToolbarGroup): ToolbarPrefs => {
  const ids = new Set(group.items.map((t) => t.id));
  return { ...p, hiddenButtons: p.hiddenButtons.filter((id) => !ids.has(id)) };
};

export const setBarShown = (p: ToolbarPrefs, barId: string, shown: boolean): ToolbarPrefs => ({
  ...p,
  hiddenBars: shown ? p.hiddenBars.filter((id) => id !== barId) : p.hiddenBars.includes(barId) ? p.hiddenBars : [...p.hiddenBars, barId],
});

function loadPrefs(): ToolbarPrefs {
  try {
    return parseToolbarPrefs(localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_TOOLBAR_PREFS;
  }
}

function savePrefs(p: ToolbarPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    // Private mode or blocked storage: the layout just won't persist.
  }
}

/**
 * The tool row's toolbars. Each bar starts with a grip; right-click a
 * button to hide it, right-click a grip to reset that bar or show and hide
 * whole bars. Right-clicking the row anywhere else also lists the bars, so
 * they can come back with every one hidden.
 */
export class Toolbars {
  private prefs = loadPrefs();
  private readonly bars = new Map<string, HTMLElement>();
  private readonly buttons = new Map<string, HTMLButtonElement>();

  constructor(
    row: HTMLElement,
    private readonly groups: readonly ToolbarGroup[],
    makeButton: (item: ToolbarItem) => HTMLButtonElement,
    private readonly menu: ContextMenu,
  ) {
    for (const g of groups) {
      const bar = document.createElement('div');
      bar.className = 'toolbar-group';
      bar.dataset.testid = `toolbar-${g.id}`;
      const grip = document.createElement('span');
      grip.className = 'toolbar-grip';
      grip.title = `${g.label} toolbar: right-click to reset it or show and hide toolbars`;
      grip.dataset.testid = `toolbar-grip-${g.id}`;
      grip.addEventListener('contextmenu', (e) => this.openMenu(e, [this.resetItem(g)]));
      // The buttons, with the bar's name in small type under them.
      const buttons = document.createElement('div');
      buttons.className = 'toolbar-buttons';
      const name = document.createElement('span');
      name.className = 'toolbar-label';
      name.textContent = g.label;
      const body = document.createElement('div');
      body.className = 'toolbar-body';
      body.append(buttons, name);
      bar.append(grip, body);
      for (const item of g.items) {
        const b = makeButton(item);
        b.addEventListener('contextmenu', (e) => this.openMenu(e, [{ label: `Hide ${item.label}`, enabled: true, run: () => this.update(hideButton(this.prefs, item.id)) }], false));
        this.buttons.set(item.id, b);
        buttons.append(b);
      }
      this.bars.set(g.id, bar);
      row.append(bar);
    }
    row.addEventListener('contextmenu', (e) => {
      if (!e.defaultPrevented) this.openMenu(e, []);
    });
    this.apply();
  }

  private resetItem(g: ToolbarGroup): MenuItem {
    const hidden = g.items.some((t) => this.prefs.hiddenButtons.includes(t.id));
    return { label: `Reset ${g.label} toolbar`, enabled: hidden, run: () => this.update(resetBar(this.prefs, g)) };
  }

  private openMenu(e: MouseEvent, first: readonly MenuItem[], withBars = true): void {
    e.preventDefault();
    const bars: MenuItem[] = withBars
      ? [
          ...this.groups.map((g) => {
            const shown = !this.prefs.hiddenBars.includes(g.id);
            return { label: `${g.label} toolbar`, enabled: true, checked: shown, run: () => this.update(setBarShown(this.prefs, g.id, !shown)) };
          }),
          { label: 'Reset all toolbars', enabled: true, run: () => this.update(DEFAULT_TOOLBAR_PREFS) },
        ]
      : [];
    this.menu.open(e.clientX, e.clientY, [...first, ...bars]);
  }

  private update(p: ToolbarPrefs): void {
    this.prefs = p;
    savePrefs(p);
    this.apply();
  }

  private apply(): void {
    for (const [id, bar] of this.bars) bar.hidden = this.prefs.hiddenBars.includes(id);
    for (const [id, b] of this.buttons) b.hidden = this.prefs.hiddenButtons.includes(id);
  }
}

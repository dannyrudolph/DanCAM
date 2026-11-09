/** `checked`, when given, shows a check mark column (on or off). */
export type MenuItem = { readonly label: string; readonly enabled: boolean; readonly run: () => void; readonly checked?: boolean };

/** A line of text heading the menu, such as the question its items answer. */
export type MenuHeading = { readonly heading: string };

/** A small right-click menu. Closes on pick, Esc or any click elsewhere. */
export class ContextMenu {
  private readonly root: HTMLElement;

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'context-menu';
    this.root.hidden = true;
    container.append(this.root);
    window.addEventListener('pointerdown', (e) => {
      if (!this.root.contains(e.target as Node)) this.close();
    });
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(x: number, y: number, items: readonly (MenuItem | MenuHeading)[]): void {
    this.root.replaceChildren(
      ...items.map((item) => {
        if ('heading' in item) {
          const p = document.createElement('p');
          p.className = 'menu-heading';
          p.textContent = item.heading;
          return p;
        }
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = item.label;
        b.disabled = !item.enabled;
        if (item.checked !== undefined) {
          b.classList.add('checkable');
          b.classList.toggle('checked', item.checked);
          b.setAttribute('role', 'menuitemcheckbox');
          b.setAttribute('aria-checked', String(item.checked));
        }
        b.addEventListener('click', () => {
          this.close();
          item.run();
        });
        return b;
      }),
    );
    this.root.hidden = false;
    // Keep it inside the window, e.g. when opened from the status bar.
    const r = this.root.getBoundingClientRect();
    this.root.style.left = `${Math.max(0, Math.min(x, window.innerWidth - r.width - 4))}px`;
    this.root.style.top = `${Math.max(0, Math.min(y, window.innerHeight - r.height - 4))}px`;
  }

  close(): void {
    this.root.hidden = true;
  }
}

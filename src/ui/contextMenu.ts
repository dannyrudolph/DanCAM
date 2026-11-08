export type MenuItem = { readonly label: string; readonly enabled: boolean; readonly run: () => void };

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

  open(x: number, y: number, items: readonly MenuItem[]): void {
    this.root.replaceChildren(
      ...items.map((item) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = item.label;
        b.disabled = !item.enabled;
        b.addEventListener('click', () => {
          this.close();
          item.run();
        });
        return b;
      }),
    );
    this.root.style.left = `${x}px`;
    this.root.style.top = `${y}px`;
    this.root.hidden = false;
  }

  close(): void {
    this.root.hidden = true;
  }
}

/** 20x20 stroke icons for toolbar buttons, drawn with currentColor. */
const svg = (body: string): string =>
  `<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  line: svg('<path d="M3 16 L17 4"/><circle cx="3" cy="16" r="1.4" fill="currentColor"/><circle cx="17" cy="4" r="1.4" fill="currentColor"/>'),
  circle: svg('<circle cx="10" cy="10" r="7"/><circle cx="10" cy="10" r="1.2" fill="currentColor"/>'),
  arc: svg('<path d="M3 15 A8 8 0 0 1 17 9"/><circle cx="3" cy="15" r="1.4" fill="currentColor"/><circle cx="17" cy="9" r="1.4" fill="currentColor"/>'),
  xline: svg('<path d="M1 16 L19 4"/><circle cx="10" cy="10" r="1.6" fill="currentColor"/>'),
  point: svg('<path d="M10 5 V15 M5 10 H15"/><circle cx="10" cy="10" r="1.6" fill="currentColor"/>'),
  undo: svg('<path d="M7 5 L3 9 L7 13"/><path d="M3 9 H12 a4 4 0 0 1 0 8 H9"/>'),
  redo: svg('<path d="M13 5 L17 9 L13 13"/><path d="M17 9 H8 a4 4 0 0 0 0 8 H11"/>'),
  pan: svg('<path d="M10 2 V18 M2 10 H18"/><path d="M7 5 L10 2 L13 5 M7 15 L10 18 L13 15 M5 7 L2 10 L5 13 M15 7 L18 10 L15 13"/>'),
  extents: svg('<path d="M3 7 V3 H7 M13 3 H17 V7 M17 13 V17 H13 M7 17 H3 V13"/><rect x="7" y="7" width="6" height="6"/>'),
} as const;

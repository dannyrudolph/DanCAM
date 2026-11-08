# Progress

Read with `docs/SPEC.md`, `AGENTS.md` and `git log`.

## Done

- **Phase 0:** canvas, grid, zoom and pan, Zoom Extents, undo stack. Pushed, CI green.
- **Spec change (2026-11-08):** mouse-first GUI, no command line (CAD-9).
- **Phase 1a:** toolbar, options bar, status line, input boxes at the cursor
  (length/angle, ΔX/ΔY, X/Y; Tab locks, Enter places), value parser
  (fractions, arithmetic, in/mm suffixes), Ortho (F8) and polar tracking (F10),
  Line and Point tools, single-key shortcuts (L, P), click-to-pick with a
  read-only properties panel, display precision 0–8, right-click menu.
  Line styles: Visible, Hidden, Center, Tangent (phantom), set per layer with
  a per-entity override; a "Style" selector applies to new objects.
  Playwright browser tests, also run in CI.

## In flight

- Waiting for the user's hand review of 1a before starting 1b.

## Next: Phase 1b

Circle (center+radius/diameter, 2-pt, 3-pt, TTR, TTT), Arc (3-pt, S-C-E,
S-E-R, S-C-Angle, continue tangent), Construction line (H, V, angle, 2-pt,
offset), entity picking inside tools, layers panel (including each layer's
line style), units (new drawing, convert vs relabel), `.cad2d.json` save and
load. Arcs must be drawn as clipped, adaptively split polylines in screen
space for deep zoom.

## Open questions

- Tangent style uses the phantom pattern (long-short-short). Confirm with the
  user that this matches their drafting standard.
- Line weights: Visible 2px, the others 1px on screen. Print weights come in Phase 6.

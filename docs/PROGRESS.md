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
  Line styles: Visible (heavy), Hidden (dashed), Center (long-short), Tangent
  (light, continuous, with a 4px gap at each end, display only), set per
  layer with a per-entity override; a "Style" selector applies to new objects.
  Panning: middle-drag, Space + left-drag, or the Pan button (H).
  Playwright browser tests, also run in CI.

## In flight: Phase 1b (plan approved 2026-11-08)

Five steps, one commit each:

1. **Geometry kernel — done.** `geometry/`: `angle` (moved `cosSinDeg`/`angleDeg`
   here from `commands/pointInput`), `circle` (2P, 3P), `arc` (3P, S-C-E, S-E-R
   minor arc toward a side point, S-C-Angle, tangent-from-direction), `xline`
   (H, V, angle, 2P, offset), `intersect` (line/circle), `tangentCircles` (TTR,
   TTT, contact points, nearest-to-picks), `arcPolyline` (screen-space,
   clipped, chord error bound), `clip.clipLine`. TTT walks the bisectors of
   two lines (well conditioned for nearly parallel lines) and refines the
   all-circle/one-line cases with damped least squares; fast-check
   counterexamples are pinned as regression tests.
2. **Model and rendering — done.** Circle/Arc/Xline entities (arc angles in
   degrees, CCW), bbox (xlines excluded from extents; `arcBBox` uses ends plus
   crossed quadrants), pick distance (arc: radial within its range, else
   nearer end), render via `arcScreenPieces` (0.25px chord error) with dash
   offsets and tangent end gaps (`insetArc`), xline dashes anchored at the base
   point, properties rows. The `?demo` drawing has an end view with all three.
3. **Next: tools** — — `entity` and `value` requests; Circle (C), Arc (A), Xline (X).
4. Layers — undoable layer records, layers panel, current layer.
5. Units and files — new drawing, convert/relabel, `.cad2d.json` save/load.

Decisions (user, 2026-11-08): arc angles in degrees; arcs count as full
circles for TTR/TTT; Continue starts from the last line/arc drawn; current
layer is saved in the file but not undoable; ray and IndexedDB autosave are
deferred (ray to Phase 2, autosave to Phase 6).

## Open questions

- Trackpad: done. Two-finger scroll pans, pinch zooms; "Scroll: Zoom" in the
  status bar restores mouse-wheel zoom (remembered per browser).
- Line weights: Visible 2px, the others 1px on screen. Print weights come in Phase 6.

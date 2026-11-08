# Progress

Read with `docs/SPEC.md`, `AGENTS.md` and `git log`.

## Done

- **Phase 0:** canvas, grid, zoom and pan, Zoom Extents, undo stack. Pushed, CI green.
- **Spec change (2026-11-08):** mouse-first GUI, no command line (CAD-9).
- **Since 1b step 3 (2026-11-08):** white drawing area, black lines, no grid;
  the demo's end view sits left of the profile.
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
3. **Tools — done.** `value` requests (one box at the cursor: R, Ø, ∠, Dist;
   click takes the cursor's value, typing locks one) and `entity` requests
   (click an object; candidates highlight on hover). `MethodChoice` puts a
   tool's methods in the options bar and keeps the choice between runs.
   Circle (C): Center-Radius/Diameter, 2P, 3P, TTR, TTT. Arc (A): 3P, S-C-E,
   S-E-R (bulges toward the cursor), S-C-Angle (negative = clockwise),
   Continue (from `ToolContext.continuation`, set by Line and Arc; falls back
   to 3P when the last one was undone). Xline (X): H, V, Angle (point then
   angle), 2P, Offset (pick a line or xline; distance and side from the cursor).
4. **Next (deferred by the user, 2026-11-08; done after step 5): layers** —
   undoable layer records, layers panel, current layer. Also add the current
   layer to the file as an optional field (default "0"), so version 1 files
   still open.
5. **Units and files — done.** New (inch or mm), Open, Save, Save As in the
   top bar; Ctrl+O, Ctrl+S, Ctrl+Shift+S. `io/nativeFile`: indented
   `.cad2d.json`, schemaVersion 1, a migrations table, and a strict reader
   that says what is wrong. File System Access API with input/download
   fallbacks; a file that fails to open never becomes the Save target.
   Clicking the units in the status bar converts (×/÷ 25.4, undoable, a
   `units` change record) or relabels. The title shows • when unsaved; New,
   Open and closing the tab ask first.

Decisions (user, 2026-11-08): arc angles in degrees; arcs count as full
circles for TTR/TTT; Continue starts from the last line/arc drawn; current
layer is saved in the file but not undoable; ray and IndexedDB autosave are
deferred (ray to Phase 2, autosave to Phase 6).

## Open questions

- TTR between two parallel lines finds nothing: the kernel treats the
  coincident offset lines as having no intersection, where AutoCAD places the
  circle nearest the picks. Fix in `tangentTangentRadius` when it matters.

- Trackpad: done. Two-finger scroll pans, pinch zooms; "Scroll: Zoom" in the
  status bar restores mouse-wheel zoom (remembered per browser).
- Line weights: Visible 2px, the others 1px on screen. Print weights come in Phase 6.

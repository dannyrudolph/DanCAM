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

## Phase 1b (plan approved 2026-11-08): all five steps done; awaiting the user's review

1. **Geometry kernel.** `geometry/`: `angle`, `circle` (2P, 3P), `arc` (3P,
   S-C-E, S-E-R, S-C-Angle, tangent-from-direction), `xline`, `intersect`,
   `tangentCircles` (TTR, TTT, nearest-to-picks), `arcPolyline`
   (screen-space, clipped), `clip.clipLine`.
2. **Model and rendering.** Circle/Arc/Xline entities (arc angles in degrees,
   CCW); xlines excluded from extents; pick distance; arcs flattened in screen
   space with anchored dashes and tangent end gaps; properties rows.
3. **Tools.** `value` and `entity` requests; `MethodChoice` keeps a tool's
   method in the options bar. Circle (C): C-R, C-D, 2P, 3P, TTR, TTT. Arc (A):
   3P, S-C-E, S-E-R, S-C-A, Continue (from `ToolContext.continuation`). Xline
   (X): H, V, Angle, 2P, Offset.
4. **Layers** (done after step 5, at the user's request). `layer` change
   record; `model/layers` (add LayerN, edit, rename moving its objects,
   delete only when empty and not 0 or current); Layers panel above the
   properties (current, show/hide, color, style, name by double-click, count,
   delete). `Drawing.currentLayer` is saved (optional `currentLayer` in the
   file) but not undoable; it follows a rename and falls back to 0 when undo
   removes its layer.
5. **Units and files.** New (inch/mm), Open, Save, Save As; `io/nativeFile`
   (`.cad2d.json`, schemaVersion 1, migrations table, strict reader); File
   System Access API with fallbacks; convert/relabel from the status bar
   units (undoable `units` record); unsaved-changes marker and prompts.

Next: Phase 2 (snaps, selection, grips, editing). Don't start it until the
user says so (CAD-7).

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

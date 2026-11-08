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

## Phase 1b (plan approved 2026-11-08): done, reviewed by the user 2026-11-08

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

## Phase 2 (plan approved 2026-11-08): in progress

1. **Geometry and rays (done).** Bounded curves (segment, ray, xline, circle, arc):
   intersections that respect ends, nearest, perpendicular feet, tangent
   points from a point; move/rotate/mirror/scale transforms (exact at 90°,
   mirror swaps arc ends); Ray entity and tool (Shift+X); TTR between
   parallel lines. `geometry/curve`, `geometry/transform`, `geometry/ray`,
   `commands/rayTool`. Rays need no file migration: the kind is new, so
   older files read unchanged (schemaVersion stays 1).
2. **Object snaps** (`snap/`): End, Mid, Cen, Quad, Int, Perp, Tan, Nea,
   Node; markers with tooltips; nearest-to-cursor ranking, Nearest last;
   Perp/Tan from a base point only; snaps feed point and value steps, beat
   Ortho/polar, lose to locked values; OSNAP button + F3, snap-type menu,
   one-time snap from the right-click menu.
3. **Selection.** Multi-select; Shift-click removes; left-to-right window
   (inside), right-to-left crossing (touching); Esc clears; not undoable.
4. **Grips and properties editing.** Arc end grips slide along the circle
   (center and radius fixed); arc mid grip changes radius keeping both ends.
   Each drag is one `modify`. Panel fields editable with the value parser;
   multi-select edits layer and style only.
5. **Edit tools.** Erase (E, Del), Move (M), Copy (Shift+C, repeats),
   Rotate (R), Mirror (I, keep/erase), Scale (S); selection first or a new
   `selection` request.
6. **Inquiry.** Dist (D), ID, List, Angle; results in a sidebar panel; e2e
   for the phase's done-when (line-arc and arc-arc Tan/Int checked with ID).

Decisions (user, 2026-11-08): shortcuts as above plus F3 for snaps (Stretch
needs a key other than S); arc grips as in step 4; sidebar results panel;
deferred: extension/tracking snaps, Perp/Tan for a first point, multi-object
grip edits.

Decisions (user, 2026-11-08): arc angles in degrees; arcs count as full
circles for TTR/TTT; Continue starts from the last line/arc drawn; current
layer is saved in the file but not undoable; ray and IndexedDB autosave are
deferred (ray to Phase 2, autosave to Phase 6).

## Open questions

- Trackpad: done. Two-finger scroll pans, pinch zooms; "Scroll: Zoom" in the
  status bar restores mouse-wheel zoom (remembered per browser).
- Line weights: Visible 2px, the others 1px on screen. Print weights come in Phase 6.

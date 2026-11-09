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

## Phase 2 (plan approved 2026-11-08): done 2026-11-08, awaiting the user's review

1. **Geometry and rays (done).** Bounded curves (segment, ray, xline, circle, arc):
   intersections that respect ends, nearest, perpendicular feet, tangent
   points from a point; move/rotate/mirror/scale transforms (exact at 90°,
   mirror swaps arc ends); Ray entity and tool (Shift+X); TTR between
   parallel lines. `geometry/curve`, `geometry/transform`, `geometry/ray`,
   `commands/rayTool`. Rays need no file migration: the kind is new, so
   older files read unchanged (schemaVersion stays 1).
2. **Object snaps (done).** `snap/snap.findSnap`: End, Mid, Cen, Quad, Int,
   Perp, Tan, Nea, Node within a 10px aperture; nearest-to-cursor ranking,
   Nearest last, ties by kind order (End before Int). Cen/Perp/Tan count
   whenever their object is under the cursor and rank as if at the aperture
   edge. Perp/Tan need a base point. Snaps feed point and value steps, beat
   Ortho/polar, lose to locked values (`resolvePoint`'s `snap`). Markers with
   a tooltip label; OSNAP button + F3 (on by default: End, Mid, Cen, Quad,
   Int, Node), a menu of kinds; right-click "Snap once..." for the next point
   (no snap found: nothing placed; Esc drops it). Settings not persisted.
   **Deferred Tan/Perp for a line's first point** (brought forward from the
   deferred list at the user's request, 2026-11-08): with no base point, the
   Line tool's first point can be a deferred Tangent (circle/arc) or
   Perpendicular (any curve); the start slides as the end moves and is fixed
   on placement. Tangent to tangent uses `geometry/curve.commonTangents`;
   other pairings ask for a point. Deferred snaps rank like Center. Line tool
   only; Circle/Arc/Xline/Ray don't take deferred picks.
3. **Selection (done).** `model/selection.selectInBox` (window: entity bbox
   inside, never xlines/rays; crossing: `geometry/curve.curveTouchesBox`);
   `entityCurve` now lives in `model/entity`. App keeps a `Set` of ids: a
   click adds, Shift-click removes, a plain click on empty space clears, Esc
   clears; drags with no tool waiting draw the box (left-to-right window,
   solid blue; right-to-left crossing, dashed green; Shift-drag removes).
   Hidden or deleted objects drop out. Panel shows "N objects" with counts by
   kind for more than one. Not undoable.
4. **Grips and properties editing (done).** `model/grips` (gripsFor,
   applyGrip): line ends stretch, line mid / centers / point / xline-ray base
   move, circle quadrants set radius, arc ends slide along the circle, arc
   mid makes the arc through the dropped point keeping both ends.
   `commands/gripTool` is a one-shot tool (`ToolDef.repeat: false`), so grip
   drags get snaps, Ortho/polar and input boxes from the grip; one `modify`;
   no-change and degenerate drops commit nothing. Press on a grip and drag,
   or press-release to make it hot and click to drop; Shift-press never
   grabs. Grips show on every selected object with no tool active.
   `model/propertyEdit.propertySetter`: click a value in the panel to type
   (Enter/blur applies, Esc cancels, unchanged text stores nothing); Length
   keeps start+angle, Angle keeps start+length, arc Included angle / Arc
   length keep the start. Layer and Style dropdowns, also for multi-select
   ("(varies)"). Also added: Select arrow button (no tool), arrow cursor.
5. **Edit tools (done).** `commands/editTools`: Erase (E, Delete/Backspace
   with a selection), Move (M), Copy (Shift+C, a copy per point until Enter),
   Rotate (R, angle typed or from the cursor), Mirror (I, Keep/Erase
   originals option, remembered), Scale (S, `factor` quantity: plain number,
   or cursor distance). Selection first (`ToolContext.selection()`), else a
   `selection` request (clicks and boxes as usual, Enter hands it over).
   Edit tools are one-shot (`repeat: false`) and the selection is kept after.
   `model/entity.transformEntity`. Toolbar: separator, then edit tools.
6. **Inquiry (done).** `commands/inquiryTools`: Dist (D), ID, List (pick
   one object; same rows as the panel, now in `model/properties`), Angle
   (vertex + two arms: included and CCW). Sticky. `ToolContext.report` →
   `ui/inquiryPanel` (Results, newest first, 10 kept, Clear; hover for full
   precision). Toolbar: third group. Done-when e2e: line–arc and arc–arc
   Int, point-to-arc Tan and arc-to-arc tangent line, each checked with ID
   to 1e-12.

Also in Phase 2, at the user's request: Rotate's Reference option (two
points along an edge, then its new angle).

## Phase 3 (plan approved 2026-11-08): done 2026-11-08, awaiting the user's review

1. **Trim/extend kernel (done).** `geometry/trim.trimCurve` (removed piece +
   kept pieces; new ends are the cut points; cuts within TOL of an end or of
   each other dropped; circle needs two cuts → arc; xline → ray(s), ray →
   line) and `geometry/extend.extendCurve` (segment end nearer the pick, ray
   base, arc end along its circle; an end already on a boundary goes on to
   the next). Unit and property tests.
2. **Trim (T) and Extend (Shift+T) tools (done).** `commands/trimTools`:
   edges from the selection, a selection step, or Enter alone = every
   visible object (re-read at each pick; never the picked object itself);
   then picks until Enter, each its own undo step; Shift-pick does the other
   mode. A split keeps the id on the first piece, the other gets a new id,
   same layer and style (`model/entity.entityFromCurve`). Hover previews the
   removed piece or the extended object (Shift held previews the other mode;
   previews allocate no ids). `EntityRequest.preview`, entity input `shift`,
   `SelectionRequest.canFinish` (Enter with nothing selected = finish).
   Toolbar: fourth group (Modify).
3. **Fillet (F) and Chamfer (Shift+F) (done).** `geometry/corner`:
   `filletCurves` (lines, rays, xlines, arcs, circles; the center is on the
   side of each curve where the other pick is, then nearest the picks;
   straight curves keep the part running away from the arc, arcs the part
   with the pick, circles stay whole; parallel lines get a half-circle at
   the first line's picked end; radius 0 = sharp corner) and `chamferLines`
   (straight curves; distances or distance + angle from the first line).
   `commands/cornerTools`: pick two objects (second previews), one undo
   step, sticky; Distances / Distance, Angle, Trim / No trim, all
   remembered for the session. **Size first** (user, 2026-11-08): until a
   size has been typed this session, the tool opens on the input box at
   the cursor (Fillet R; Chamfer D1 with the method buttons, then D2 or
   the angle); after that the prompt shows it ("Fillet R 0.02: …") and
   "Change size (…)…" asks again. The joint takes the objects' layer and style
   when they share them, else the current ones.
4. **Offset (O), Break (B), Join (J), Lengthen (Shift+L) (done).**
   Geometry: `offset` (sideways / concentric, exact for H/V lines;
   `offsetThrough`), `breakCurve` (`breakAt`, `breakBetween` via
   `trimCurve`; circle CCW from the first point), `join` (collinear
   segments across gaps; arcs on one circle CCW from the first, a circle
   when closed), `lengthen` (delta / total / percent at the end nearer the
   pick). Tools: `commands/offsetTool` (Distance… or Through point,
   object after object until Enter, each its own step; remembered),
   `commands/lengthTools` (Break: Two points / At point, sticky; Join:
   selection first, merges every joinable pair, the smaller gap for arcs,
   one step; Lengthen: Delta / Total / Percent, value asked on change and
   remembered, picks until Enter). `editTools.objects` is now exported.
   Also: `intersect.lineLine` takes x from a vertical line and y from a
   horizontal one exactly (separate commit).
5. **Array (Shift+A) and Stretch (Shift+S) (done).** `geometry/array`
   (`rectangularArray`, `polarArray`: full 360° spaces evenly, a partial
   fill ends on the last item, negative is clockwise, unrotated copies
   keep the objects' bbox center on the circle) and `geometry/stretch`
   (line ends, ray/xline base, circle center, points inside move; an arc
   with both ends inside moves, with one end keeps its sagitta).
   `commands/arrayTool`: selection first; Rectangular (rows, columns,
   ΔY, ΔX; spacing skipped for a single row/column) or Polar (center,
   count, fill angle with Rotate items / Don't rotate); typed values, the
   last previews; one step. `commands/stretchTool`: the crossing window is
   two picked corners (previewed as a dashed box; snaps work), then base
   and second point; visible objects only; one step. No selection-first
   for Stretch (it needs the window itself). `editTools.point` / `value`
   exported and reused. `ui/shortcuts.test` guards unique tool keys.
6. **Done-when e2e (done).** Six xlines (centerline, Ø.250, Ø.375, front
   face, shoulder, back face) trimmed with Trim / Enter = all into a shaft
   step, then a .010 x 45° chamfer and an R.020 fillet; every vertex
   checked in the properties panel at full precision to 1e-12. Also: the
   toolbar wraps to a second row on narrow windows (at 1024px the extra
   buttons had pushed the page wider than the window).

**Next:** Phase 4, after the user's go-ahead (CAD-7). Re-read the spec's
"Dimensioning" section and propose a plan first.

Decisions (user, 2026-11-08): Join may bridge gaps between collinear lines
or arcs on one circle; Fillet and Chamfer accept xlines and rays (results
become rays or lines); shortcuts as listed above.

Decisions (user, 2026-11-08): shortcuts as above plus F3 for snaps (Stretch
needs a key other than S); arc grips as in step 4; sidebar results panel;
deferred: extension/tracking snaps, multi-object grip edits (Perp/Tan for a
line's first point was brought forward into step 2).

Decisions (user, 2026-11-08): arc angles in degrees; arcs count as full
circles for TTR/TTT; Continue starts from the last line/arc drawn; current
layer is saved in the file but not undoable; ray and IndexedDB autosave are
deferred (ray to Phase 2, autosave to Phase 6).

## Open questions

- Trackpad: done. Two-finger scroll pans, pinch zooms; "Scroll: Zoom" in the
  status bar restores mouse-wheel zoom (remembered per browser).
- Line weights: Visible 2px, the others 1px on screen. Print weights come in Phase 6.

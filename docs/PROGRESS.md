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

## Phase 3 (plan approved 2026-11-08): done, reviewed by the user 2026-11-08

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

## Phase 4 (plan approved 2026-11-08): done 2026-11-09, awaiting the user's review

1. **Formatting kernel (done).** `model/dimFormat`: `roundDecimal` rounds
   the 15-significant-digit decimal of the stored value, halves away from
   zero, no "-0" (so .1245 → .125 at 3 places); `formatDecimal` with zero
   rules (`INCH_ZEROS`, `MM_ZEROS`); `formatDimension` → `DimText` (main,
   inline ± or stacked deviation/limits, alt in brackets), prefix/suffix,
   `<>` override; with a tolerance the value and tolerance keep trailing
   zeros; a zero deviation is "+.000"/"-.000" when the style keeps
   trailing zeros, a bare "0" when it drops them (mm); limits leave `main`
   empty; angles in decimal ° or D°M'S (`formatDms`, carries), no dual
   units on angles. `flatText` for one-line display.
2. **Model, layout and rendering (done).** `DimensionEntity` (kind
   `dimension`): `p1`, `p2` measured, `at` on the dimension line,
   `dimStyle`, optional `refs` (Phase 5); `type: 'linear'` with a unit
   `dir` (a rotate turns it, so a rotated linear dim keeps measuring
   along its axis) or `'aligned'`. `model/dimStyle` (`DimStyle`: sheet
   sizes in drawing units, precision, zeros, tolerance, angle format,
   dual, prefix/suffix; defaults INCH-3PL .12 text/arrows, MM-2PL 3 mm).
   `Drawing.dimStyles` + `currentDimStyle` (saved, not undoable);
   `dimStyle` undo record; Convert units scales styles too. File v2
   (migration 1 → 2 adds the unit's default style; strict reader for
   styles and dimensions). `model/textMetrics` (Helvetica widths, cap
   height .718 em) keeps layout DOM-free. `model/dimLayout`: extension
   lines (offset, extend), ASME upright text breaking the line, 3:1 filled
   arrows, best fit (inside / arrows outside / text outside past p2 /
   both outside), stacked tolerances 2.5 text heights, alt units after.
   Pick counts the text as solid; window/crossing and Zoom Extents use
   the drawn extent; snaps ignore dimensions; Stretch moves p1/p2/at one
   by one; no grips yet; line style ignored (no Style row). Properties:
   Dim style, Type, Text, Measured, points. Four demo dimensions, one per
   fit case.
3. **Linear (Shift+D) and Aligned (G) tools (done).** `commands/dimTools`:
   Two points (snaps; the second has the first as base) or Pick a line
   (its ends; `refs` = the line), then the dimension line's position,
   previewed live; one undo step each; sticky. Linear: Auto H/V
   (`linearDirFor`: beside the points' span → vertical, above/below →
   horizontal, off a corner → the larger overshoot), or Horizontal /
   Vertical forced; method and orientation remembered for the session.
   Same two points refused; Enter at placement drops it. Toolbar: a
   Dimensions group before Inquiry. Shortcuts chosen by Claude, not yet
   confirmed by the user.
4. **Radius (Shift+R), Diameter (Shift+O), Angular (Shift+G) (done).**
   Entity: `p1`/`p2` moved into the types that use them; radius and
   diameter store `center` + `radius` exactly (copied from the arc or
   circle, never rebuilt from a point); angular stores `vertex`, unit arm
   directions `dir1`/`dir2`, and `p1`/`p2` where each extension line
   starts. `dimensionPoints` / `mapDimensionPoints` drive bbox, transform
   and Stretch. Layout: radial text outside the circle on a leader aimed
   at the center, arrow on the circle, horizontal shoulder (left or right
   by side); inside on the radius / full diameter line, broken by the
   text. Angular: `angularSector` = the side of the arms where `at` is
   (reflex on the far side); arc through `at` broken by upright text, the
   same four fit cases, extension lines past each arm's geometry; text
   from `angleFormat` (anglePrecision, decimal or D°M'S; no tolerance or
   dual). Prefixes R and Ø. Tools: Radius/Diameter pick an arc or circle,
   then the text point; Angular methods Two lines (quadrant by cursor,
   `angleBetweenLines`; parallel refused), Arc, Vertex + 2 points; all
   previewed, sticky, refs kept. Toolbar icons; demo end view has Ø, R and
   120° dims. Arc-derived angles carry a few ULPs (120.00000000000003)
   from cos/sin → atan2; below any display precision. Shortcuts chosen by
   Claude, not yet confirmed.
5. **Leader / note, Shift+N (done).** A dimension of `type: 'leader'`
   (so it shares the dimension style, layout, pick, selection, Stretch,
   transforms and file code): `tip` (the arrow), `at` (the landing),
   `text` exactly as typed. No measured value (`measuredValue` and the
   layout's `value` are undefined; no Measured row). Layout: arrow at the
   tip along the leader, horizontal shoulder one arrow long pointing away
   from the tip (right when vertical), upright text past it, centered on
   the shoulder; a mirror keeps the text readable. Tool: arrow point
   (snaps), landing (refused on the tip), then a new `text` request: a
   "Note" box at the landing takes the focus, so letters are text, not
   shortcuts; the preview follows the typing; Enter adds it (empty text
   refused), a click on the canvas refocuses the box, Esc leaves with
   nothing added. `expandSymbols`: %%d °, %%c Ø, %%p ± (either case). One
   line only. No file migration (a new type; schemaVersion stays 2). Demo:
   a ".005 X 45°" note at the right-hand corner. Not yet: editing a
   leader's text afterwards (with the text overrides in step 6),
   multi-line notes, more than one leader segment. Shortcut chosen by
   Claude, not yet confirmed.
6. Dimension Styles panel; per-dimension overrides; Sheet scale (done,
   awaiting the user's review). Three commits:
   a. **Overrides (done).** Optional `precision`, `tolerance`,
      `textOverride` on any dimension but a leader (`model/dimOverride`).
      Precision sets the value's and the tolerance's places (the angle's
      for angular); tolerance lengths only; text with `<>` for the value
      and %%d/%%c/%%p; empty or a bare `<>` removes it. Properties panel:
      Dim style, Precision ("By style (3)", 0–8) and Tolerance ("By
      style", None, ±, Deviation, Limits) dropdowns; Tol ± / Tol upper /
      Tol lower editable (editing one makes the tolerance the dimension's
      own; upper never below lower); Text click-to-edit (a leader's note
      too; it can't be emptied). Each edit one undo step. Files: optional
      fields, validated, schemaVersion stays 2. Convert units scales an
      override tolerance.
   b. **Sheet scale (done).** `Drawing.sheetScale` (10 = 10:1, 0.5 =
      1:2; default 1) divides a style's sheet sizes (text height, arrows,
      offsets, gap; not tolerances) when a dimension is laid out
      (`model/sheetScale.atSheetScale`), so a 10:1 detail prints .12"
      text. Undoable (`sheetScale` change), saved (optional in the file;
      absent opens at 1:1). Status bar dropdown: 1:1, 2:1, 5:1, 10:1,
      20:1, Custom… (types 50:1, 1:2, 3/2 or 2.5; Enter applies, Esc
      cancels). Print/PDF uses it in Phase 6.
   c. **Dimension Styles panel (done).** `model/dimStyles` (like
      `layers`): New copies the style being edited as NAME-2, -3…; edit
      (validated: text height > 0, sizes ≥ 0, places 0–8, ± ≥ 0, upper ≥
      lower; undefined removes dual/prefix/suffix); rename moves its
      dimensions (one step, current follows); delete refused when used,
      current or last; `ensureCurrentDimStyle` after undo. Sidebar panel
      under Layers: current radio, name (click: edit its settings;
      double-click: rename), dimension count, delete; collapsible
      Settings: sizes (exact, value parser), precision, leading/trailing
      zeros, tolerance kind and values, tol precision, angle format and
      precision, dual units (other unit's defaults) and precision,
      prefix/suffix (spaces kept). Each change one undo step.
      `toleranceOfKind` is shared with the per-dimension override.
7. **Dimension grips (done).** `model/dimGrips`; `gripsFor` and
   `applyGrip` take the drawing for dimensions. Linear/aligned: `p1`, `p2`
   (move a measured point; snaps apply; drops `refs`; not onto the other
   point), `line1`/`line2` at the dimension line's ends (move the line),
   `text` (new optional `textAt`: the text sits on the line where it
   projects, the line running out to it; dropped within half a text height
   of the middle it centers again; the line moves with it). Line and text
   drags snap the line's clearance from the nearer measured point to ASME
   spacing (.375" then every .25"; 10 then 6 mm; divided by the sheet
   scale) within half a text height; no snap when the line runs between
   the points. Radius/diameter: `text`. Angular: `arc` at the arc's
   middle (radius and side). Leader: `tip`, `text` (landing). Each drag is
   one undo step. `textAt` moves, stretches and saves with the dimension
   (optional in the file).
8. **Done-when (done).** `ui/referenceDrawing` (`/?reference`): a turned
   pin (.500 long, Ø.125/Ø.188, .010 × 45° chamfer) and its end view at
   10:1, built with the tools (clicks, picks, typed note) plus overrides,
   a dual-units style (INCH-DUAL) and the sheet scale through the undo
   stack. Nine dimensions, every type: .500 [12.7], .200 REF, .0940
   ±.0005, .014, 45°, Ø.188 +.000/-.001, R.030, 120°, .010 X 45°. Checked
   in `referenceDrawing.test.ts` (exact texts, .012 text = .12 printed,
   no text over another or over the part, no dimension line, arc or arrow
   across another's text, file round-trip) and in the browser (each text
   clicked and read from the properties panel). Placing them found that
   an angular dimension with its arrows outside a short arc reaches back
   across nearby text; the reference places that one where the arrows fit.

Associativity stays Phase 5; dimensions store their measured points (and
a reference to the geometry, unused until Phase 5).

Decisions (user, 2026-11-08): no exact Solid Edge match needed yet (the
user will give feedback on a working version; done-when uses our own
reference drawing); ASME unidirectional text; leader text typed in a box
at the cursor is fine (CAD-9 exception for notes); plain sans font for
now, stroke font question at Phase 6.

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

## Phase 5 (plan approved 2026-11-09): in progress

1. Lathe mode and diameter entry: a per-drawing Lathe toggle (saved)
   labels the axes Z (horizontal) and X (vertical) and supplies a
   centerline at Y = 0; Diameter shows and takes X as Ø (stored values
   unchanged; halving is exact) in the input boxes, status readout,
   properties panel and inquiry results. **(done)** `model/latheView`
   (`AxisView`, `viewLabel`/`viewRow`: X→Z, Y→X or Ø with factor 2);
   `Drawing.lathe`, `diameterMode` (saved, optional in the file, not
   undoable); status bar Lathe and Ø toggles (Ø off without lathe), readout
   "Z … X/Ø …"; boxes Z/X/Ø/ΔZ/ΔØ, mode button L∠/ΔZX/ZX, a typed diameter
   locks the radius; properties and inquiry rows renamed and doubled, a
   typed Ø sets the radius; the renderer draws the axis at Y = 0 as a
   center-style xline (not an entity, so not snappable yet).
2. Associativity: snaps report what they hit (entity + feature);
   dimensions anchor each measured point (replaces `refs`; file v2 → v3);
   a geometry change re-measures its dimensions inside the same
   transaction, so one undo restores both. **(done)** `model/anchor`
   (`Anchor`: entity + start/end/mid/center/node/quad/int; `DimAnchors`
   p1/p2/vertex points, `curve`, `lines`); snaps carry `on`, the app sends
   it as the point's `anchor` when the point is on the snap; the tools
   anchor snapped points, Pick a line (start/end), radius/diameter/arc
   angle (`curve`), two-line angle (`lines`). `model/associate`:
   `UndoStack.commit` appends `dimensionFollowUp` to the transaction:
   geometry changed → re-measure (a uniform move carries `at`/`textAt`);
   geometry deleted, wrong kind, parallel or zero-length → delete the
   dimension; a feature gone → that point unanchored; a dimension changed
   itself → mismatched anchors dropped. Copy and Array remap anchors onto
   the copies (`withNewIds`). File v3: `anchors` (checked to name
   geometry); v2 `refs` converted on open where the points still match.
   Leaders aren't anchored yet; Nearest, Perpendicular and Tangent snaps
   don't anchor.
3. Symmetric diameter (Shift+M): the lathe centerline (or a picked one),
   then features one after another; Ø + twice the distance; Half (default)
   or Full per style. In lathe mode a linear dimension across the
   centerline gets Ø automatically. **(done)** Dimension type `symmetric`
   (`p1`, `axisBase` = its foot, `axisDir`; `at` sets where the line
   crosses the axis); value 2 × distance, always Ø. Style
   `symmetric?: 'half' | 'full'` (absent = Half; Styles panel
   "Symmetric Ø"). Half: one extension line and arrow at the feature, line
   an arrow length past the axis, text halfway or past the axis when it
   doesn't fit; Full: the linear layout to the mirrored point. Tool
   Shift+M: lathe axis (or Pick centerline; outside lathe mode always
   picked, anchored as `anchors.axis`), then feature + placement pairs
   until Enter, each one undo step. Re-measures with its feature and
   centerline; moved together, the line goes along. Grips p1, line1,
   text. `readsDiameter`: lathe + Ø on, a vertical linear dimension across
   Y = 0 gets Ø. Picking an edge (instead of a point) isn't offered.
4. Baseline (Shift+B) and Continue (Shift+K) from a linear dimension.
   **(done)** `commands/chainDimTools`: pick a linear or aligned
   dimension (the extension line nearer the pick is the start, keeping its
   anchor), then points until Enter, each a linear dimension along the
   picked one's direction, own undo step, snapped points anchored.
   Baseline: from the start, each line `lineSpacing` (.25" / 6 mm at the
   sheet scale) further out; Continue: from the last end, same line. The
   user wasn't sure these are needed (2026-11-09); kept, finished.
   Also: Enter now finishes Symmetric diameter, as its prompt says.
5. Ordinate (Shift+Z): DIMORIGIN with a marker; Z or X by drag or forced;
   X as Ø in lathe mode; common baseline; auto-jog; Align Ordinates.
   Split (user, 2026-11-09): 5a the tool, origin and Ø; 5b the common
   baseline, auto-jog and Align Ordinates.
   **5a (done)** `Drawing.dimOrigin` ((0, 0) default, saved, `dimOrigin`
   undo record, scaled by Convert units); marker (circle and cross) once
   set or used. Dimension type `ordinate` (`p1`, `origin` copied, `axis`
   x|y, `at` = leader end); value |Δ| from the origin; leader from the
   feature (extension offset) square to the axis, jogging in its last two
   arrow lengths when `at` is off its line, text past the end. Tool
   Shift+Z (`commands/ordinateTool`): feature + text pairs until Enter;
   Auto / Z / X (X / Y outside lathe) kept for the session; Set origin
   (its ordinates follow in the same undo step via `associate`). With
   lathe + Ø, X ordinates read Ø twice. A snapped feature is anchored; the
   text keeps level with it along the measured axis. Grips p1, text. The
   origin itself isn't anchored to geometry.
   **5b (done)** `model/ordinateLayout`: `onCommonBaseline` (leader end
   level with the nearest same-axis, same-direction ordinate's within two
   text heights), `clearOfNeighbors` (text moved along the baseline to the
   nearest place a text gap clear of the others; the leader jogs),
   `placeOrdinate` = both, used when placing and when dragging the text
   grip. Align ordinates (toolbar only, no shortcut): selection, then a
   level; each axis's set on it, packed in feature order a gap apart and
   shifted to sit on their features on average; one undo step.
6. Center marks (Shift+E) and centerlines: associative annotations.
   **(done)** Dimension types `centerMark` (center, radius; `anchors.curve`)
   and `centerline` (p1, p2 midway between two lines; `anchors.lines`):
   no value or text, no precision/tolerance/text rows, no grips. Mark: a
   cross of half-arrow arms, an offset gap, then lines an extension past
   the curve; centerline: dash-dot (`DimLayout.centerDash`), an extension
   past each end. `centerlineBetween` pairs the second line's ends with
   the first's. Tool Shift+E (`commands/centerMarkTool`): Circle or arc
   (a second mark on one refused) or Two lines; sticky; one undo step
   each. They follow their geometry and are deleted with it.
7. Done-when: a real lathe part, with the user's feedback along the way.
   **(built, awaiting the user's feedback)** `ui/latheReference`
   (`/?lathe`): a turned pin, upper half on the lathe axis, lathe + Ø on,
   10:1. .005 × 45° chamfer to Ø.080, shoulder at Z .150 to Ø.125, Ø.030
   cross hole (hidden) at Z .275, .025 groove to Ø.100 at Z .400, back
   face Z .600, end view with a center mark. Built with the tools, clicks
   landing on object snaps so the dimensions anchor as in the app: six Z
   ordinates from the front face (common baseline; .425 jogs clear of
   .400), three Half symmetric diameters, chamfer and hole notes, a center
   mark and the hole's centerline. `latheReference.test.ts`: exact texts,
   anchors, baseline and jog, no text over text, part or another
   dimension's lines, two geometry-only edits (back face +.050 → .650;
   groove → Ø.090) re-measured with one undo, file round-trip. Browser
   test reads each text from the properties panel.
   User feedback (2026-11-09): the origin ordinate reads a bare `0` (done:
   any ordinate that rounds to zero, in `dimLayout`); centerlines take
   snaps (done: `entity.snapCurve`, End/Mid/Int/Nearest at its stored
   ends, not the drawn extension; anchors may name a centerline,
   `anchor.isAnchorable`, also in the file check; `UndoStack.commit`
   repeats the follow-up so what is anchored to a centerline follows it
   as it follows its lines, one undo step). The hole's ordinate is now
   anchored to its centerline. Open: the narrow groove's Ø text sits
   inside the part, wider than the groove; the user will look at it.

Decisions (user, 2026-11-09): no reference part needed yet (feedback as
we go); lathe mode supplies the centerline at Y = 0; symmetric diameter
defaults to Half; a dimension is deleted when the geometry it measures is
deleted; shortcuts as above.

Phase 5 accepted by the user ("looks good for now", 2026-11-09). Phase 6
is on hold while the user tweaks the GUI.

## GUI tweaks (user, 2026-11-09): in progress

- **Toolbars (done).** `ui/toolbars`: the tool row is five bars (Draw,
  Edit, Modify, Dimension, Inquiry), each with a grip. Right-click a
  button: Hide it. Right-click a grip: Reset that bar, a checklist to show
  or hide each bar, Reset all toolbars (the row's own right-click gives
  the checklist too, so hidden bars can come back). Saved per browser
  (`dancam.toolbars`), Inquiry hidden by default; hidden tools keep their
  shortcuts.
- **Snaps toolbar (done).** A sixth bar, one button per snap kind with
  its canvas marker as the icon: pressed (inset, blue) when it runs,
  raised when not. Replaces the status bar's OSNAP button, its ▾ menu and
  the global on/off (F3 is gone with it). Snap once… stays on the
  right-click menu. Snap kinds are still not saved between sessions.
- **Style menu (done).** Off the top bar, into the options bar while a
  Draw tool runs (user's choice).
- **Colors (done).** Light theme after dannysdowelfactory.com: navy
  (#003865) top bar, light gray bars and panels, blue (#0072ce) for active
  and on, orange for messages and locked values; canvas stays white.

## Open questions

- Trackpad: done. Two-finger scroll pans, pinch zooms; "Scroll: Zoom" in the
  status bar restores mouse-wheel zoom (remembered per browser).
- Line weights: Visible 2px, the others 1px on screen. Print weights come in Phase 6.

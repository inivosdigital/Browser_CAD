# BrowserCAD

A 2D CAD application that runs entirely in the browser — an AutoCAD LT-style drafting
tool in the same spirit that [Photopea](https://www.photopea.com) is a browser-based
Photoshop. Pure HTML/CSS/JavaScript with **zero dependencies and no build step**:
everything renders on a single `<canvas>` and all work stays on your machine.

![status](https://img.shields.io/badge/runtime-vanilla%20JS-blue) ![deps](https://img.shields.io/badge/dependencies-none-success)

## Run it

Serve the folder with any static file server and open `index.html`:

```bash
npx http-server -p 8080      # or: python3 -m http.server 8080
# then visit http://localhost:8080
```

No compilation, no install. (Classic `<script>` tags are used precisely so it works
from any plain static host — GitHub Pages included.)

## Features

**Drafting**
- Line, Polyline, Circle (center-radius / 2P), Arc (3-point / center), Rectangle,
  Polygon, Point, single-line Text
- Hatching of closed boundaries (diagonal lines, crosshatch, or solid fill)
- Blocks: define a block from a selection (`BLOCK`/`B`), insert references with
  scale + rotation (`INSERT`/`I`), explode back to geometry
- Linear (horizontal/vertical), aligned, **radius, diameter, and angular**
  dimensions with arrowheads and live measured values; `DIST` measuring tool

**Editing**
- Move, Copy (repeating), Rotate, Scale, Mirror, Offset (line/circle/arc/polyline),
  Trim (all objects act as cutting edges), **Extend** (to the nearest boundary),
  Fillet (radius or sharp corner), **Array** (rectangular and polar), Explode, Erase
- **Grip editing**: drag the blue grips of any selected entity — endpoints,
  midpoints, centers, quadrants, vertices — with object snaps active
- Unlimited-ish undo/redo (snapshot based, Ctrl+Z / Ctrl+Y)
- Properties panel for editing geometry, layer, and color of the selection

**Precision input — the AutoCAD way**
- Command line with command names *and* classic aliases: `L`, `PL`, `C`, `A`, `REC`,
  `M`, `CO`, `RO`, `SC`, `MI`, `O`, `TR`, `F`, `X`, `E`, `DLI`, `DAL`, `DI`, `Z` …
- Coordinate entry: `10,20` absolute · `@10,20` relative · `@15<45` polar ·
  bare number = direct distance toward the cursor
- Object snaps with glyph markers: endpoint □, midpoint △, center ○, quadrant ◇,
  intersection ✕, perpendicular ⊾ (F3)
- Ortho mode (F8), grid + grid snap (F7/F9), crosshair cursor with pickbox
- Right-click = Enter; Enter on an empty command line repeats the last command
- Window (drag →, blue) vs crossing (drag ←, green) selection, Shift to deselect

**Organization & files**
- Layers: color, show/hide, lock, current layer — entity colors default to ByLayer
- Save / open native `.json` drawings (blocks included)
- **DXF R12 export** (LINE, CIRCLE, ARC, POLYLINE, POINT, TEXT, layer table;
  dimensions/hatches/blocks are exploded for compatibility) — opens in AutoCAD,
  LibreCAD, QCAD…
- **DXF import** (R12 + LWPOLYLINE, TEXT/MTEXT, layers)
- **Plot to PDF** (`PLOT`): true vector PDF output — extents or window area,
  A4/A3/Letter with auto-orientation, white-paper color mapping
- Autosave to `localStorage` — reopen the tab and your drawing is still there

**Viewport**
- Wheel zoom at cursor, middle-mouse pan, `Z` zoom-extents, adaptive grid,
  HiDPI-crisp rendering

## Layout

| Area | Purpose |
|---|---|
| Left toolbar | Draw / Annotate / Modify tools |
| Right sidebar | Layers panel + Properties panel |
| Bottom | Command history, command line, status toggles (GRID·SNAP·ORTHO·OSNAP) |

Press **F1** in the app for the full command reference.

## Architecture

```
index.html          shell + script load order
css/style.css       dark workbench theme
js/geometry.js      vector math, intersections, arcs, bboxes   (headless)
js/entities.js      entity model: hit-test, snap, transform,
                    dimension geometry, explode                (headless)
js/document.js      entities + layers + selection + undo/redo  (headless)
js/viewport.js      world(Y-up) <-> screen mapping, zoom/pan
js/snap.js          OSNAP / grid snap / ortho resolution
js/renderer.js      canvas drawing: grid, entities, previews, markers
js/dxf.js           DXF R12 writer + tolerant reader           (headless)
js/pdf.js           minimal vector PDF writer for plotting     (headless)
js/tools.js         tool state machines + command registry
js/ui.js            toolbar, menus, layers/properties panels, help
js/main.js          app object, input routing, command line, file I/O
tests/smoke.js      Node tests for the headless core
```

Entities are plain JSON-serializable objects (`line`, `circle`, `arc`, `polyline`,
`point`, `text`, `dim`) dispatched through `ENT.*` functions, which keeps undo
(snapshots), autosave, and file formats trivial. Tools are small state machines fed
by both mouse clicks and command-line input through the same code path.

## Tests

```bash
node tests/smoke.js
```

Covers geometry primitives, entity transforms/hit-testing, undo/redo, JSON
round-trip, and a full DXF export→import round-trip.

## Roadmap ideas

- Break, Stretch, Lengthen; polar tracking; dimension styles
- Ellipses, splines, leaders/multileaders
- More hatch patterns; associative hatches and dimensions
- Linetypes and lineweights; paper-space layouts with viewports
- Closed-polyline trim; true mirrored block references (negative scale)

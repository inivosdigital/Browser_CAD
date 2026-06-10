/* main.js — application bootstrap, input routing, command line, file I/O. */
'use strict';

const app = {
  doc: null,
  vp: null,
  canvas: null,
  ctx: null,
  tool: null,
  pointer: { screen: { x: 0, y: 0 }, raw: { x: 0, y: 0 }, snapped: { x: 0, y: 0 }, snap: null, inside: false },
  rubber: null,
  anchor: null,       // base point of the active tool (ortho / perp / direct distance)
  angleLock: null,    // explicit angle override (<30), radians, until next point
  trackAcq: [],       // acquired osnap-tracking points (F11)
  _hover: null,
  lastPoint: null,    // last picked point (for @relative coordinates)
  downScreen: null,
  panning: false,
  docName: 'untitled.json',
  lastCommand: null,
  _dirty: true,
  _autosaveTimer: null,

  /* ---------- rendering ---------- */

  requestRender() { app._dirty = true; },

  pickTol() { return app.vp.pxToWorld(8); },

  /* ---------- command line ---------- */

  print(msg, cls) {
    const hist = document.getElementById('cmd-history');
    const div = document.createElement('div');
    div.className = 'cmd-line' + (cls ? ' ' + cls : '');
    div.textContent = msg;
    hist.appendChild(div);
    while (hist.children.length > 300) hist.removeChild(hist.firstChild);
    hist.scrollTop = hist.scrollHeight;
  },

  prompt(text) {
    document.getElementById('cmd-prompt').textContent = text;
  },

  /* ---------- tools ---------- */

  setTool(name) {
    app.tool = TOOLS[name]();
    app.anchor = null;
    app.rubber = null;
    app.angleLock = null;
    app.trackAcq = [];
    app.tool.start(app);
    UI.markActiveTool(app);
    app.requestRender();
  },

  endTool() {
    app.tool = TOOLS.select();
    app.anchor = null;
    app.rubber = null;
    app.angleLock = null;
    app.trackAcq = [];
    app.tool.start(app);
    UI.markActiveTool(app);
    app.requestRender();
  },

  cancel() {
    if (app.angleLock != null || app.trackAcq.length) { app.angleLock = null; app.trackAcq = []; app.requestRender(); }
    if (app.tool && app.tool.cancelGrip && app.tool.cancelGrip(app)) { app.requestRender(); return; }
    if (app.rubber) { app.rubber = null; app.requestRender(); return; }
    if (app.tool && app.tool.name !== 'select') {
      app.print('*Cancel*');
      app.endTool();
    } else if (app.doc.selection.size) {
      app.doc.clearSelection();
      app.onSelectionChange();
    }
  },

  execCommand(word) {
    const name = resolveCommand(word);
    if (!name) { app.print(`Unknown command: ${word.toUpperCase()}`, 'err'); return; }
    const cmd = COMMANDS[name];
    app.print(`Command: ${name.toUpperCase()}`, 'echo');
    if (app.tool && app.tool.name !== 'select' && cmd.tool) app.endTool();
    app.lastCommand = name;
    if (cmd.tool) app.setTool(cmd.tool);
    else if (cmd.fn) { cmd.fn(app); app.requestRender(); }
  },

  refreshStatus() { UI.refreshStatus(app); },
  showHelp() { UI.showHelp(); },

  onSelectionChange() {
    UI.refreshProps(app);
    app.requestRender();
  },

  /* ---------- model / paper space ---------- */

  _spaceViews: {},

  activeBBox() {
    let b = app.doc.bbox();
    const layout = app.doc.activeLayout();
    if (layout) {
      const [W, H] = UNITS.layoutDims(layout);
      b = GEO.bbValid(b) ? GEO.bbUnion(b, { x1: 0, y1: 0, x2: W, y2: H }) : { x1: 0, y1: 0, x2: W, y2: H };
    }
    return b;
  },

  setSpace(space) {
    if (app.doc.space === space) return;
    // remember the camera per space
    app._spaceViews[String(app.doc.space)] = { scale: app.vp.scale, cx: app.vp.cx, cy: app.vp.cy };
    app.doc.space = space;
    app.doc.clearSelection();
    app.endTool();
    const saved = app._spaceViews[String(space)];
    if (saved) {
      app.vp.scale = saved.scale; app.vp.cx = saved.cx; app.vp.cy = saved.cy;
    } else {
      app.vp.zoomExtents(app.activeBBox());
    }
    const layout = app.doc.activeLayout();
    const blk = app.doc.editingBlock();
    if (blk) app.print(`Editing block "${blk}" — changes apply to every insert. BCLOSE to finish.`);
    else app.print(layout ? `Paper space: ${layout.name} (${layout.paper.toUpperCase()}).` : 'Model space.');
    UI.refreshTabs(app);
    UI.refreshProps(app);
    UI.refreshStatus(app);
    app.requestRender();
  },

  /* ---------- coordinate input ---------- */

  // Lengths accept architectural input everywhere: 42 · 3'6 · 3'-6 1/2" · 18" · 1/2
  parseCoord(raw) {
    const rel = raw.startsWith('@');
    const body = rel ? raw.slice(1) : raw;
    const base = rel ? (app.lastPoint || app.anchor || { x: 0, y: 0 }) : { x: 0, y: 0 };
    const comma = body.indexOf(',');
    if (comma >= 0) {
      const x = UNITS.parseLength(body.slice(0, comma));
      const y = UNITS.parseLength(body.slice(comma + 1));
      if (x === null || y === null) return null;
      return rel ? GEO.add(base, { x, y }) : { x, y };
    }
    const lt = body.indexOf('<');
    if (lt >= 0) {
      const d = UNITS.parseLength(body.slice(0, lt));
      const a = parseFloat(body.slice(lt + 1));
      if (d === null || Number.isNaN(a)) return null;
      return GEO.polar(base, a * Math.PI / 180, d);
    }
    // bare length = direct distance entry toward the cursor (polar/ortho applied)
    if (!rel && app.anchor) {
      const d = UNITS.parseLength(body);
      if (d === null) return null;
      const dir = GEO.sub(app.pointer.snapped, app.anchor);
      if (GEO.len(dir) < 1e-9) return null;
      return GEO.add(app.anchor, GEO.mul(GEO.norm(dir), d));
    }
    return null;
  },

  submitInput(rawValue) {
    const raw = rawValue.trim();
    if (raw) app.print('> ' + raw, 'echo');

    if (app.tool && app.tool.rawInput) {
      app.tool.input(app, rawValue);
      app.requestRender();
      return;
    }
    if (app.tool && app.tool.input && app.tool.input(app, raw)) {
      app.requestRender();
      return;
    }
    if (raw === '') {
      // Enter on empty line in idle state repeats the last command
      if (app.tool && app.tool.name === 'select' && app.lastCommand) app.execCommand(app.lastCommand);
      return;
    }
    // angle override: "<30" locks the next point's direction from the base point
    const angm = /^<\s*(-?\d+(?:\.\d+)?)$/.exec(raw);
    if (angm && app.tool && app.tool.name !== 'select') {
      app.angleLock = parseFloat(angm[1]) * Math.PI / 180;
      app.print(`Angle locked to ${angm[1]}°.`);
      app.requestRender();
      return;
    }
    const pt = app.parseCoord(raw);
    if (pt) {
      if (app.tool && app.tool.click) {
        app.tool.click(app, pt, {});
        if (app.tool && app.tool.name !== 'select') app.anchor = pt;
        app.angleLock = null;
        app.trackAcq = [];
        app.requestRender();
      }
      return;
    }
    app.execCommand(raw);
  },

  /* ---------- pointer pipeline ---------- */

  updatePointer(ev) {
    const r = app.canvas.getBoundingClientRect();
    const screen = { x: ev.clientX - r.left, y: ev.clientY - r.top };
    app.pointer.screen = screen;
    app.pointer.raw = app.vp.s2w(screen);
    app.pointer.inside = screen.x >= 0 && screen.y >= 0 && screen.x <= r.width && screen.y <= r.height;

    const isPointTool = (app.tool && !['select', 'pan'].includes(app.tool.name) &&
      !(app.tool.stage === 'acquire')) || !!(app.tool && app.tool.gripDrag);
    let snap = null;
    let eff;
    app.pointer.track = null;
    app.pointer.otrack = null;

    if (isPointTool && app.angleLock != null && app.anchor) {
      // explicit angle override (<30): project the cursor onto the locked ray
      const u = { x: Math.cos(app.angleLock), y: Math.sin(app.angleLock) };
      const t = GEO.dot(GEO.sub(app.pointer.raw, app.anchor), u);
      eff = GEO.add(app.anchor, GEO.mul(u, t));
      app.pointer.track = { base: app.anchor, ang: app.angleLock, dist: Math.abs(t) };
    } else {
      if (isPointTool) snap = SNAP.find(app.doc, app.vp, screen, app.anchor);
      eff = snap ? { ...snap.pt } : { ...app.pointer.raw };
      if (!snap && isPointTool) {
        const s = app.doc.settings;
        if (s.snapGrid) eff = SNAP.gridSnap(app.doc, eff);
        // object snap tracking: align with acquired points
        let tracked = false;
        if (s.otrack && app.trackAcq.length) {
          const tol = app.vp.pxToWorld(8);
          let vx = null, hy = null;
          for (const t of app.trackAcq) {
            if (!vx && Math.abs(app.pointer.raw.x - t.x) < tol) vx = t;
            if (!hy && Math.abs(app.pointer.raw.y - t.y) < tol) hy = t;
          }
          if (vx || hy) {
            eff = { x: vx ? vx.x : app.pointer.raw.x, y: hy ? hy.y : app.pointer.raw.y };
            const rays = [];
            if (vx) rays.push({ from: vx, to: eff });
            if (hy && hy !== vx) rays.push({ from: hy, to: eff });
            app.pointer.otrack = { rays };
            tracked = true;
          }
        }
        if (!tracked) {
          if (s.ortho && app.anchor) {
            eff = SNAP.ortho(app.anchor, eff);
          } else if (s.polar && app.anchor) {
            // polar tracking: lock to angle increments when the cursor is near a tracking ray
            const d = GEO.sub(app.pointer.raw, app.anchor);
            const dist = GEO.len(d);
            if (dist > app.vp.pxToWorld(4)) {
              const inc = (s.polarInc || 45) * Math.PI / 180;
              const ang = Math.atan2(d.y, d.x);
              const locked = Math.round(ang / inc) * inc;
              let diff = Math.abs(ang - locked);
              if (diff > Math.PI) diff = Math.PI * 2 - diff;
              if (diff < 6 * Math.PI / 180) {
                eff = GEO.polar(app.anchor, locked, dist);
                app.pointer.track = { base: app.anchor, ang: locked, dist };
              }
            }
          }
        }
      }
    }
    app.pointer.snap = snap;

    // hover-acquire tracking points (pause on an osnap marker for ~1/3 s);
    // a timer handles the stationary-mouse case since this only runs on movement
    if (snap && isPointTool && app.doc.settings.otrack) {
      const key = `${snap.pt.x.toFixed(6)},${snap.pt.y.toFixed(6)}`;
      const acquire = (pt) => {
        if (!app.trackAcq.some(t => GEO.eq(t, pt))) {
          app.trackAcq.push({ ...pt });
          if (app.trackAcq.length > 3) app.trackAcq.shift();
          app.requestRender();
        }
      };
      const now = performance.now();
      if (app._hover && app._hover.key === key) {
        if (now - app._hover.since > 350) acquire(snap.pt);
      } else {
        app._hover = { key, since: now };
        clearTimeout(app._hoverTimer);
        const pt = { ...snap.pt };
        app._hoverTimer = setTimeout(() => {
          if (app._hover && app._hover.key === key && app.doc.settings.otrack) acquire(pt);
        }, 360);
      }
    } else if (!snap) {
      app._hover = null;
      clearTimeout(app._hoverTimer);
    }

    app.pointer.snapped = eff;
    // dynamic input: live distance<angle readout from the tool's base point
    app.pointer.dyn = null;
    if (isPointTool && app.anchor && app.doc.settings.dynInput && !app.pointer.track) {
      const dist = GEO.dist(app.anchor, eff);
      if (dist > 1e-9) app.pointer.dyn = { dist, ang: GEO.ang(app.anchor, eff) };
    }
    UI.updateCoords(app);
  },

  /* ---------- file operations ---------- */

  _download(name, text, mime) {
    const blob = new Blob([text], { type: mime || 'application/octet-stream' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  },

  fileNew() {
    if (app.doc.modified && app.doc.entities.length &&
        !window.confirm('Discard unsaved changes and start a new drawing?')) return;
    app.doc.clear();
    app.docName = 'untitled.json';
    app.vp.zoomExtents(null);
    localStorage.removeItem('browsercad.autosave');
    app.endTool();
    UI.refreshLayers(app);
    UI.refreshProps(app);
    UI.refreshStatus(app);
    UI.setDocTitle(app.docName, false);
    app.print('New drawing.');
  },

  fileSave() {
    const json = JSON.stringify(app.doc.toJSON(), null, 1);
    app._download(app.docName.endsWith('.json') ? app.docName : app.docName + '.json', json, 'application/json');
    app.doc.modified = false;
    UI.setDocTitle(app.docName, false);
    app.print(`Saved ${app.docName}`);
  },

  fileExportDxf() {
    const name = app.docName.replace(/\.(json|dxf)$/i, '') + '.dxf';
    app._download(name, DXF.exportDoc(app.doc), 'application/dxf');
    app.print(`Exported ${name} (DXF R12).`);
  },

  fileOpen() {
    document.getElementById('file-input').click();
  },

  fileImportTemplate() {
    document.getElementById('template-input').click();
  },

  _importTemplate(name, text) {
    if (/\.dwt$/i.test(name) || text.slice(0, 6) !== '  0\r\n' && /^AC10\d\d/.test(text.slice(0, 200)) === false && text.indexOf('SECTION') < 0) {
      app.print('DWT/DWG is a closed binary format. In AutoCAD: SAVEAS → "AutoCAD 2000 DXF" once, then import that file.', 'err');
      return;
    }
    try {
      const res = DXF.importText(text);
      const srcLayouts = (res.paperLayouts || []).filter(l => l.entities.length);
      if (!srcLayouts.length && !res.entities.length) {
        app.print('No usable entities found in the template.', 'err');
        return;
      }
      app.doc.checkpoint();
      for (const [bn, bdef] of Object.entries(res.blocks || {})) {
        if (!app.doc.blocks[bn]) app.doc.blocks[bn] = bdef;
      }
      for (const ly of res.layers) if (!app.doc.layer(ly.name)) app.doc.layers.push(ly);

      // build one BrowserCAD layout per template layout (fall back to model
      // entities as a single title block when the DXF has no paper space)
      const sources = srcLayouts.length ? srcLayouts : [{ name: 'Layout1', w: 0, h: 0, entities: res.entities }];
      const newLayouts = sources.map(srcL => {
        const layout = { name: srcL.name, paper: 'letter', landscape: true, entities: srcL.entities };
        let bb = GEO.bbEmpty();
        for (const e of srcL.entities) bb = GEO.bbUnion(bb, ENT.bbox(e));
        const cw = GEO.bbValid(bb) ? bb.x2 - bb.x1 : 0;
        const ch = GEO.bbValid(bb) ? bb.y2 - bb.y1 : 0;
        // prefer the sheet size declared in the template's LAYOUT object
        let W = srcL.w, H = srcL.h;
        if (!(W > 1 && H > 1)) { W = cw + 0.5; H = ch + 0.5; } // fall back to content extents
        const std = UNITS.matchPaper(W, H, 0.4);
        if (std) {
          layout.paper = std.paper;
          layout.landscape = std.landscape;
        } else {
          layout.paper = 'custom';
          layout.customW = +W.toFixed(2);
          layout.customH = +H.toFixed(2);
        }
        // keep template coordinates when the content already sits on the sheet;
        // otherwise center it
        const [SW, SH] = UNITS.layoutDims(layout);
        if (GEO.bbValid(bb) && (bb.x1 < -0.01 || bb.y1 < -0.01 || bb.x2 > SW + 0.01 || bb.y2 > SH + 0.01)) {
          const xf = ENT.xfTranslate({ x: (SW - cw) / 2 - bb.x1, y: (SH - ch) / 2 - bb.y1 });
          for (const e of layout.entities) ENT.transform(e, xf);
        }
        return layout;
      });
      app.doc.layouts = newLayouts;
      app.doc._changed();
      app.doc.space = 'model'; // force the space switch below to re-zoom
      app.setSpace(0);
      UI.refreshLayers(app);
      UI.refreshTabs(app);
      const names = newLayouts.map(l => {
        const [W, H] = UNITS.layoutDims(l);
        return `${l.name} (${l.paper === 'custom' ? `${W}×${H}"` : l.paper.toUpperCase()})`;
      });
      app.print(`Template imported: ${newLayouts.length} layout(s) — ${names.join(', ')}.`);
    } catch (err) {
      app.print(`Could not import template: ${err.message}`, 'err');
    }
  },

  _openText(name, text) {
    try {
      if (/\.dxf$/i.test(name)) {
        const res = DXF.importText(text);
        if (!res.entities.length && !res.paperEntities.length) { app.print('No supported entities found in DXF.', 'err'); return; }
        app.doc.loadJSON({ entities: res.entities, layers: res.layers.length ? res.layers : undefined });
        app.doc.blocks = res.blocks || {};
        if (res.paperEntities.length) {
          app.doc.layouts[0].entities = res.paperEntities;
          app.print(`${res.paperEntities.length} paper-space entities loaded into ${app.doc.layouts[0].name}.`);
        }
        if (!app.doc.layer('0')) app.doc.layers.unshift({ name: '0', color: '#ffffff', visible: true, locked: false });
        // make sure every entity's layer exists
        for (const e of app.doc.entities) if (!app.doc.layer(e.layer)) app.doc.addLayer(e.layer);
        app.print(`Imported ${res.entities.length} entities from ${name}.`);
      } else {
        app.doc.loadJSON(JSON.parse(text));
        app.print(`Opened ${name}.`);
      }
      app.docName = name;
      app.vp.zoomExtents(app.doc.bbox());
      app.endTool();
      UI.refreshLayers(app);
      UI.refreshProps(app);
      UI.refreshStatus(app);
      UI.setDocTitle(app.docName, false);
    } catch (err) {
      app.print(`Could not open ${name}: ${err.message}`, 'err');
    }
  },

  _scheduleAutosave() {
    clearTimeout(app._autosaveTimer);
    app._autosaveTimer = setTimeout(() => {
      try {
        localStorage.setItem('browsercad.autosave', JSON.stringify({ name: app.docName, doc: app.doc.toJSON() }));
      } catch (e) { /* storage full/unavailable — ignore */ }
    }, 800);
  },

  _tryRestoreAutosave() {
    try {
      const raw = localStorage.getItem('browsercad.autosave');
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data.doc || !data.doc.entities || !data.doc.entities.length) return false;
      app.doc.loadJSON(data.doc);
      app.docName = data.name || 'untitled.json';
      app.print(`Restored autosaved drawing (${app.doc.entities.length} entities). Use NEW to discard.`);
      return true;
    } catch (e) {
      return false;
    }
  },
};

/* ================= bootstrap ================= */

function initApp() {
  app.doc = new CadDocument();
  app.vp = new Viewport();
  ENT.blockResolver = (name) => app.doc.blocks[name];
  ENT.units = app.doc.settings.units || 'decimal';
  app.canvas = document.getElementById('canvas');
  app.ctx = app.canvas.getContext('2d');

  app.doc.onChange = () => {
    ENT.units = app.doc.settings.units || 'decimal';
    const ds = app.doc.settings.dimStyle || {};
    const as = app.doc.settings.annoScale || 1; // annotative sizes scale with CANNOSCALE
    ENT.DIM_TEXT = (ds.textHeight || 2.5) * as;
    ENT.DIM_ARROW = (ds.arrow || 2.5) * as;
    ENT.DIM_EXT_GAP = (ds.extGap == null ? 1.0 : ds.extGap) * as;
    ENT.DIM_EXT_OVER = (ds.extOver == null ? 1.2 : ds.extOver) * as;
    ENT.dimPrecision = ds.precision == null ? 2 : ds.precision;
    app.requestRender();
    UI.refreshProps(app);
    UI.setDocTitle(app.docName, app.doc.modified);
    app._scheduleAutosave();
  };

  UI.init(app);
  UI.refreshTabs(app);

  const restored = app._tryRestoreAutosave();
  app.tool = TOOLS.select();
  app.tool.start(app);
  UI.markActiveTool(app);
  UI.refreshLayers(app);
  UI.setDocTitle(app.docName, false);

  /* ----- canvas sizing ----- */
  const wrap = document.getElementById('canvas-wrap');
  const resize = () => {
    const dpr = window.devicePixelRatio || 1;
    const w = wrap.clientWidth, h = wrap.clientHeight;
    app.canvas.width = Math.max(1, Math.round(w * dpr));
    app.canvas.height = Math.max(1, Math.round(h * dpr));
    app.canvas.style.width = w + 'px';
    app.canvas.style.height = h + 'px';
    app.vp.resize(w, h);
    app.requestRender();
  };
  new ResizeObserver(resize).observe(wrap);
  resize();
  if (restored) app.vp.zoomExtents(app.doc.bbox());

  /* ----- pointer events ----- */
  const cmdInput = document.getElementById('cmd-input');
  let panLast = null;

  app.canvas.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    cmdInput.focus();
    app.updatePointer(ev);
    app.downScreen = { ...app.pointer.screen };

    const panButton = ev.button === 1 || (app.tool && app.tool.panTool && ev.button === 0);
    if (panButton) {
      app.panning = true;
      panLast = { x: ev.clientX, y: ev.clientY };
      app.canvas.setPointerCapture(ev.pointerId);
      app.requestRender();
      return;
    }
    if (ev.button === 0) {
      if (app.tool && app.tool.click) {
        app.tool.click(app, app.pointer.snapped, ev);
        if (app.tool && !['select', 'pan'].includes(app.tool.name) && app.tool.stage !== 'acquire') {
          app.anchor = app.pointer.snapped;
        }
        app.angleLock = null;
        app.trackAcq = [];
      }
      app.requestRender();
    }
  });

  window.addEventListener('pointermove', (ev) => {
    if (app.panning && panLast) {
      app.vp.panPx(ev.clientX - panLast.x, ev.clientY - panLast.y);
      panLast = { x: ev.clientX, y: ev.clientY };
      app.updatePointer(ev);
      app.requestRender();
      return;
    }
    app.updatePointer(ev);
    if (app.tool && app.tool.move) app.tool.move(app, app.pointer.snapped);
    app.requestRender();
  });

  window.addEventListener('pointerup', (ev) => {
    if (app.panning) {
      app.panning = false;
      panLast = null;
      app.requestRender();
      return;
    }
    if (ev.button === 0 && app.tool && app.tool.up) {
      app.updatePointer(ev);
      app.tool.up(app, ev);
      app.requestRender();
    }
  });

  app.canvas.addEventListener('dblclick', (ev) => {
    if (!app.tool || app.tool.name !== 'select') return;
    app.updatePointer(ev);
    const tol = app.pickTol();
    for (let i = app.doc.entities.length - 1; i >= 0; i--) {
      const e = app.doc.entities[i];
      if (e.type === 'insert' && app.doc.selectable(e) && ENT.hitTest(e, app.pointer.raw, tol) && app.doc.blocks[e.name]) {
        app.setSpace('block:' + e.name);
        return;
      }
      if (e.type !== 'mtext' || !app.doc.selectable(e) || !ENT.hitTest(e, app.pointer.raw, tol)) continue;
      UI.openMtextEditor(app, e, (text) => {
        if (text === null) return;
        app.doc.checkpoint();
        e.text = text;
        app.doc._changed();
      });
      return;
    }
  });

  app.canvas.addEventListener('pointerleave', () => {
    app.pointer.inside = false;
    app.requestRender();
  });

  app.canvas.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    app.updatePointer(ev);
    const factor = Math.pow(1.0015, -ev.deltaY);
    app.vp.zoomAt(app.pointer.screen, factor);
    app.updatePointer(ev);
    UI.refreshStatus(app);
    app.requestRender();
  }, { passive: false });

  // right click = Enter (AutoCAD style)
  app.canvas.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    app.submitInput('');
  });

  /* ----- command line ----- */
  const history = [];
  let histIdx = -1;
  cmdInput.addEventListener('input', () => UI.updateSuggest(app, cmdInput.value));
  cmdInput.addEventListener('keydown', (ev) => {
    if (UI.suggestOpen()) {
      if (ev.key === 'ArrowDown') { ev.preventDefault(); UI.moveSuggest(1); return; }
      if (ev.key === 'ArrowUp') { ev.preventDefault(); UI.moveSuggest(-1); return; }
      if (ev.key === 'Tab') {
        ev.preventDefault();
        const c = UI.acceptSuggest();
        if (c) cmdInput.value = c;
        return;
      }
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        UI.closeSuggest();
        return;
      }
      if (ev.key === 'Enter') {
        const c = UI.acceptSuggest(true); // only when explicitly highlighted
        UI.closeSuggest();
        if (c) {
          ev.preventDefault();
          cmdInput.value = '';
          history.push(c);
          histIdx = history.length;
          app.submitInput(c);
          return;
        }
      }
    }
    if (ev.key === 'Enter') {
      ev.preventDefault();
      UI.closeSuggest();
      const v = cmdInput.value;
      cmdInput.value = '';
      if (v.trim()) { history.push(v); histIdx = history.length; }
      app.submitInput(v);
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (history.length) {
        histIdx = Math.max(0, histIdx - 1);
        cmdInput.value = history[histIdx] || '';
      }
    } else if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      histIdx = Math.min(history.length, histIdx + 1);
      cmdInput.value = history[histIdx] || '';
    }
  });
  cmdInput.focus();

  /* ----- global keys ----- */
  window.addEventListener('keydown', (ev) => {
    if (ev.target && ev.target.closest && ev.target.closest('#mtext-editor')) return;
    const key = ev.key;
    const mod = ev.ctrlKey || ev.metaKey;

    if (key === 'Escape') {
      const modal = document.getElementById('help-modal');
      if (!modal.hidden) { modal.hidden = true; return; }
      ev.preventDefault();
      app.cancel();
      app.requestRender();
      return;
    }
    if (key === 'F1') { ev.preventDefault(); UI.showHelp(); return; }
    if (key === 'F3') { ev.preventDefault(); app.execCommand('osnap'); return; }
    if (key === 'F7') { ev.preventDefault(); app.execCommand('grid'); return; }
    if (key === 'F8') { ev.preventDefault(); app.execCommand('ortho'); return; }
    if (key === 'F9') { ev.preventDefault(); app.execCommand('snap'); return; }
    if (key === 'F10') { ev.preventDefault(); app.execCommand('polar'); return; }
    if (key === 'F11') { ev.preventDefault(); app.execCommand('otrack'); return; }
    if (key === 'F12') { ev.preventDefault(); app.execCommand('dyn'); return; }

    if (mod && key.toLowerCase() === 'z' && !ev.shiftKey) { ev.preventDefault(); app.execCommand('undo'); return; }
    if (mod && (key.toLowerCase() === 'y' || (key.toLowerCase() === 'z' && ev.shiftKey))) { ev.preventDefault(); app.execCommand('redo'); return; }
    if (mod && key.toLowerCase() === 'a') { ev.preventDefault(); app.execCommand('selectall'); return; }
    if (mod && key.toLowerCase() === 's') { ev.preventDefault(); app.fileSave(); return; }
    if (mod && key.toLowerCase() === 'o') { ev.preventDefault(); app.fileOpen(); return; }

    if (key === 'Delete' || key === 'Backspace') {
      const t = ev.target;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');
      const idle = app.tool && app.tool.name === 'select' && !app.tool.gripDrag;
      if (idle && typing && t.id === 'cmd-input' && t.value === '' && key === 'Delete' && app.doc.selection.size) {
        app.doc.checkpoint();
        app.doc.remove(app.doc.selection);
        app.print('Selection erased.');
        app.onSelectionChange();
        return;
      }
      if (idle && !typing && key === 'Delete' && app.doc.selection.size) {
        app.doc.checkpoint();
        app.doc.remove(app.doc.selection);
        app.print('Selection erased.');
        app.onSelectionChange();
        return;
      }
      return;
    }

    // route printable characters into the command line from anywhere
    const t = ev.target;
    const typing = t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');
    if (!typing && key.length === 1 && !mod && !ev.altKey) {
      cmdInput.focus();
    }
  });

  /* ----- file input ----- */
  document.getElementById('template-input').addEventListener('change', (ev) => {
    const f = ev.target.files[0];
    ev.target.value = '';
    if (!f) return;
    if (/\.(dwt|dwg)$/i.test(f.name)) {
      app.print(`${f.name} is binary DWG (closed format). In AutoCAD run SAVEAS → "AutoCAD 2000 DXF" on the template once, then import the .dxf here.`, 'err');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => app._importTemplate(f.name, reader.result);
    reader.readAsText(f);
  });

  document.getElementById('file-input').addEventListener('change', (ev) => {
    const f = ev.target.files[0];
    ev.target.value = '';
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => app._openText(f.name, reader.result);
    reader.readAsText(f);
  });

  window.addEventListener('beforeunload', (ev) => {
    if (app.doc.modified && app.doc.entities.length) {
      ev.preventDefault();
      ev.returnValue = '';
    }
  });

  /* ----- render loop ----- */
  const frame = () => {
    if (app._dirty) {
      app._dirty = false;
      RENDER.render(app);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  app.print('BrowserCAD ready. Type a command (L, C, A, REC …) or press F1 for help.');
  app.prompt('Command:');
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', initApp);
}

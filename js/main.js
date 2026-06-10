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
    app.tool.start(app);
    UI.markActiveTool(app);
    app.requestRender();
  },

  endTool() {
    app.tool = TOOLS.select();
    app.anchor = null;
    app.rubber = null;
    app.tool.start(app);
    UI.markActiveTool(app);
    app.requestRender();
  },

  cancel() {
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

  /* ---------- coordinate input ---------- */

  parseCoord(raw) {
    const rel = raw.startsWith('@');
    const body = rel ? raw.slice(1) : raw;
    const base = rel ? (app.lastPoint || app.anchor || { x: 0, y: 0 }) : { x: 0, y: 0 };
    let m = /^(-?\d*\.?\d+)\s*,\s*(-?\d*\.?\d+)$/.exec(body);
    if (m) {
      const p = { x: parseFloat(m[1]), y: parseFloat(m[2]) };
      return rel ? GEO.add(base, p) : p;
    }
    m = /^(-?\d*\.?\d+)\s*<\s*(-?\d*\.?\d+)$/.exec(body);
    if (m) {
      return GEO.polar(base, parseFloat(m[2]) * Math.PI / 180, parseFloat(m[1]));
    }
    // bare number = direct distance entry toward the cursor
    m = /^(-?\d*\.?\d+)$/.exec(body);
    if (m && !rel && app.anchor) {
      const d = parseFloat(m[1]);
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
    const pt = app.parseCoord(raw);
    if (pt) {
      if (app.tool && app.tool.click) {
        app.tool.click(app, pt, {});
        if (app.tool && app.tool.name !== 'select') app.anchor = pt;
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

    const isPointTool = app.tool && !['select', 'pan'].includes(app.tool.name) &&
      !(app.tool.stage === 'acquire');
    let snap = null;
    if (isPointTool) snap = SNAP.find(app.doc, app.vp, screen, app.anchor);
    app.pointer.snap = snap;

    let eff = snap ? { ...snap.pt } : { ...app.pointer.raw };
    if (!snap && isPointTool && app.doc.settings.snapGrid) eff = SNAP.gridSnap(app.doc, eff);
    if (!snap && isPointTool && app.doc.settings.ortho && app.anchor) eff = SNAP.ortho(app.anchor, eff);
    app.pointer.snapped = eff;
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

  _openText(name, text) {
    try {
      if (/\.dxf$/i.test(name)) {
        const res = DXF.importText(text);
        if (!res.entities.length) { app.print('No supported entities found in DXF.', 'err'); return; }
        app.doc.loadJSON({ entities: res.entities, layers: res.layers.length ? res.layers : undefined });
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
  app.canvas = document.getElementById('canvas');
  app.ctx = app.canvas.getContext('2d');

  app.doc.onChange = () => {
    app.requestRender();
    UI.refreshProps(app);
    UI.setDocTitle(app.docName, app.doc.modified);
    app._scheduleAutosave();
  };

  UI.init(app);

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
  cmdInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
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

    if (mod && key.toLowerCase() === 'z' && !ev.shiftKey) { ev.preventDefault(); app.execCommand('undo'); return; }
    if (mod && (key.toLowerCase() === 'y' || (key.toLowerCase() === 'z' && ev.shiftKey))) { ev.preventDefault(); app.execCommand('redo'); return; }
    if (mod && key.toLowerCase() === 'a') { ev.preventDefault(); app.execCommand('selectall'); return; }
    if (mod && key.toLowerCase() === 's') { ev.preventDefault(); app.fileSave(); return; }
    if (mod && key.toLowerCase() === 'o') { ev.preventDefault(); app.fileOpen(); return; }

    if (key === 'Delete' || key === 'Backspace') {
      const t = ev.target;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');
      if (typing && t.id === 'cmd-input' && t.value === '' && key === 'Delete' && app.doc.selection.size) {
        app.doc.checkpoint();
        app.doc.remove(app.doc.selection);
        app.print('Selection erased.');
        app.onSelectionChange();
        return;
      }
      if (!typing && key === 'Delete' && app.doc.selection.size) {
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

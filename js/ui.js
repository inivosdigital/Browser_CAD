/* ui.js — toolbar, menus, layers panel, properties panel, status bar, help overlay. */
'use strict';

const ICONS = {
  select: '<path d="M6 2 L15 10 L10.5 10.8 L13.5 16.5 L11.3 17.6 L8.4 11.9 L5 15 Z" fill="currentColor" stroke="none"/>',
  line: '<path d="M3 17 L17 3"/>',
  polyline: '<path d="M2 16 L7 5 L12 13 L18 4"/>',
  circle: '<circle cx="10" cy="10" r="7"/>',
  arc: '<path d="M3 16 A 13 13 0 0 1 16 3"/>',
  rectangle: '<rect x="3" y="5" width="14" height="10"/>',
  polygon: '<path d="M10 2 L17 6 L17 14 L10 18 L3 14 L3 6 Z"/>',
  point: '<circle cx="10" cy="10" r="1.6" fill="currentColor"/><path d="M10 4 V8 M10 12 V16 M4 10 H8 M12 10 H16"/>',
  text: '<path d="M4 17 L10 3 L16 17 M6.6 11.5 H13.4"/>',
  dimlinear: '<path d="M3 3 V17 M17 3 V17 M3 10 H17 M5.5 8.5 L3 10 L5.5 11.5 M14.5 8.5 L17 10 L14.5 11.5"/>',
  dimaligned: '<path d="M2 8 L8 2 M12 18 L18 12 M5 5 L15 15 M8.2 6.4 L5 5 L6.4 8.2 M13.6 11.8 L15 15 L11.8 13.6"/>',
  dist: '<path d="M3 17 L17 3 M5 13 L7 15 M8 10 L10 12 M11 7 L13 9"/>',
  move: '<path d="M10 2 V18 M2 10 H18 M8 4 L10 2 L12 4 M8 16 L10 18 L12 16 M4 8 L2 10 L4 12 M16 8 L18 10 L16 12"/>',
  copy: '<rect x="3" y="3" width="10" height="10"/><rect x="7" y="7" width="10" height="10"/>',
  rotate: '<path d="M16 10 A 6 6 0 1 1 10 4 M10 4 L13 2.5 M10 4 L12 6.5"/>',
  scale: '<rect x="3" y="11" width="6" height="6"/><path d="M9 11 L17 3 M17 3 H12 M17 3 V8"/>',
  mirror: '<path d="M10 2 V18" stroke-dasharray="2.5 2.5"/><path d="M7 6 L3 10 L7 14 Z M13 6 L17 10 L13 14 Z"/>',
  offset: '<path d="M5 17 L5 3 M12 17 L12 3 M15 8 H19 M17 6 V10"/>',
  trim: '<path d="M3 10 H17 M13 3 L7 17 M9.5 8 L7 6"/>',
  fillet: '<path d="M3 17 L3 10 Q3 3 10 3 L17 3"/>',
  explode: '<path d="M10 3 V8 M10 12 V17 M3 10 H8 M12 10 H17 M5 5 L8 8 M12 12 L15 15 M15 5 L12 8 M8 12 L5 15"/>',
  erase: '<rect x="3" y="9" width="9" height="7" transform="rotate(-25 7 12)"/><path d="M10 16 H18"/>',
  pan: '<path d="M10 3 V17 M3 10 H17 M8.5 4.5 L10 3 L11.5 4.5 M8.5 15.5 L10 17 L11.5 15.5 M4.5 8.5 L3 10 L4.5 11.5 M15.5 8.5 L17 10 L15.5 11.5" stroke-width="1.2"/>',
  zoom: '<circle cx="8.5" cy="8.5" r="5.5"/><path d="M12.5 12.5 L17.5 17.5"/>',
  dimradius: '<circle cx="10" cy="10" r="7"/><path d="M10 10 L15 5 M13 5 H15 V7"/>',
  dimangular: '<path d="M3 17 H17 M3 17 L15 5 M10 17 A 7 7 0 0 0 8 12"/>',
  extend: '<path d="M3 3 V17" /><path d="M17 10 H7 M9.5 7.5 L7 10 L9.5 12.5" stroke-dasharray="0"/><path d="M17 10 H13" stroke-dasharray="2 2"/>',
  array: '<circle cx="5" cy="5" r="1.4" fill="currentColor"/><circle cx="10" cy="5" r="1.4" fill="currentColor"/><circle cx="15" cy="5" r="1.4" fill="currentColor"/><circle cx="5" cy="10" r="1.4" fill="currentColor"/><circle cx="10" cy="10" r="1.4" fill="currentColor"/><circle cx="15" cy="10" r="1.4" fill="currentColor"/><circle cx="5" cy="15" r="1.4" fill="currentColor"/><circle cx="10" cy="15" r="1.4" fill="currentColor"/><circle cx="15" cy="15" r="1.4" fill="currentColor"/>',
  hatch: '<rect x="3" y="3" width="14" height="14"/><path d="M3 9 L9 3 M3 15 L15 3 M7 17 L17 7 M13 17 L17 13"/>',
  block: '<path d="M10 2 L17 6 V14 L10 18 L3 14 V6 Z M10 10 L17 6 M10 10 L3 6 M10 10 V18"/>',
  insert: '<path d="M12 4 L17 7 V13 L12 16 L7 13 V7 Z"/><path d="M2 10 H7 M5 8 L7 10 L5 12"/>',
  ellipse: '<ellipse cx="10" cy="10" rx="8" ry="5"/>',
  leader: '<path d="M3 17 L10 8 H17 M5.5 16.6 L3 17 L3.6 14.6"/><path d="M12 5 H17" stroke-width="1.1"/>',
  break: '<path d="M3 10 H8 M12 10 H17 M9 7 L11 13" /><path d="M11 7 L9 13" stroke-width="1.1"/>',
  join: '<path d="M3 16 L8 10 M12 10 L17 4 M8 10 H12" stroke-dasharray="0"/><circle cx="8" cy="10" r="1.3" fill="currentColor"/><circle cx="12" cy="10" r="1.3" fill="currentColor"/>',
  stretch: '<path d="M3 4 H11 V16 H3 Z" stroke-dasharray="2.5 2.5"/><path d="M11 10 H18 M15.5 7.5 L18 10 L15.5 12.5"/>',
  chamfer: '<path d="M3 17 V9 L9 3 H17"/>',
  dimcontinue: '<path d="M3 4 V12 M10 4 V12 M17 4 V12 M3 8 H17"/><path d="M5 15 H15 M13 13.5 L15 15 L13 16.5"/>',
  dimbaseline: '<path d="M3 3 V17 M11 5 V11 M17 11 V17 M3 8 H11 M3 14 H17"/>',
  mtext: '<rect x="3" y="4" width="14" height="12"/><path d="M5 8 H15 M5 11 H15 M5 14 H11"/>',
  mview: '<rect x="2" y="3" width="16" height="14"/><rect x="5" y="6" width="10" height="8"/><path d="M7 12 L10 8 L13 12" stroke-width="1.1"/>',
  annoscale: '<path d="M3 17 L17 3 M5 13 L7 15 M9 9 L11 11 M13 5 L15 7"/><path d="M11 16 H17 M14 13 V16" stroke-width="1.1"/>',
  template: '<rect x="3" y="2" width="14" height="16"/><path d="M3 14 H17 M12 14 V18 M5 5 H12 M5 8 H10"/>',
};

function svgIcon(name) {
  return `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
}

const TOOLBAR_GROUPS = [
  {
    title: 'Tools',
    items: [
      { icon: 'select', label: 'Select', cmd: '_select', tip: 'Select (Esc)' },
      { icon: 'pan', label: 'Pan', cmd: 'pan', tip: 'Pan (P) — or drag middle mouse' },
      { icon: 'zoom', label: 'Zoom Ext', cmd: 'zoom', tip: 'Zoom extents (Z)' },
    ],
  },
  {
    title: 'Draw',
    items: [
      { icon: 'line', label: 'Line', cmd: 'line', tip: 'Line (L)' },
      { icon: 'polyline', label: 'Pline', cmd: 'pline', tip: 'Polyline (PL)' },
      { icon: 'circle', label: 'Circle', cmd: 'circle', tip: 'Circle (C)' },
      { icon: 'arc', label: 'Arc', cmd: 'arc', tip: 'Arc (A)' },
      { icon: 'rectangle', label: 'Rect', cmd: 'rectang', tip: 'Rectangle (REC)' },
      { icon: 'polygon', label: 'Polygon', cmd: 'polygon', tip: 'Polygon (POL)' },
      { icon: 'ellipse', label: 'Ellipse', cmd: 'ellipse', tip: 'Ellipse (EL)' },
      { icon: 'point', label: 'Point', cmd: 'point', tip: 'Point (PO)' },
      { icon: 'text', label: 'Text', cmd: 'text', tip: 'Text (T)' },
      { icon: 'mtext', label: 'MText', cmd: 'mtext', tip: 'Multiline text (MT) — double-click to edit' },
      { icon: 'hatch', label: 'Hatch', cmd: 'hatch', tip: 'Hatch (H)' },
    ],
  },
  {
    title: 'Annotate',
    items: [
      { icon: 'dimlinear', label: 'Dim H/V', cmd: 'dimlinear', tip: 'Linear dimension (DLI)' },
      { icon: 'dimaligned', label: 'Dim Ali', cmd: 'dimaligned', tip: 'Aligned dimension (DAL)' },
      { icon: 'dimradius', label: 'Dim Rad', cmd: 'dimradius', tip: 'Radius dimension (DRA) — diameter: DDI' },
      { icon: 'dimangular', label: 'Dim Ang', cmd: 'dimangular', tip: 'Angular dimension (DAN)' },
      { icon: 'dimcontinue', label: 'Dim Cont', cmd: 'dimcontinue', tip: 'Continue dimension chain (DCO)' },
      { icon: 'dimbaseline', label: 'Dim Base', cmd: 'dimbaseline', tip: 'Baseline dimensions (DBA)' },
      { icon: 'leader', label: 'Leader', cmd: 'leader', tip: 'Leader with text (LE)' },
      { icon: 'dist', label: 'Measure', cmd: 'dist', tip: 'Distance (DI)' },
    ],
  },
  {
    title: 'Modify',
    items: [
      { icon: 'move', label: 'Move', cmd: 'move', tip: 'Move (M)' },
      { icon: 'copy', label: 'Copy', cmd: 'copy', tip: 'Copy (CO)' },
      { icon: 'rotate', label: 'Rotate', cmd: 'rotate', tip: 'Rotate (RO)' },
      { icon: 'scale', label: 'Scale', cmd: 'scale', tip: 'Scale (SC)' },
      { icon: 'mirror', label: 'Mirror', cmd: 'mirror', tip: 'Mirror (MI)' },
      { icon: 'offset', label: 'Offset', cmd: 'offset', tip: 'Offset (O)' },
      { icon: 'trim', label: 'Trim', cmd: 'trim', tip: 'Trim (TR)' },
      { icon: 'extend', label: 'Extend', cmd: 'extend', tip: 'Extend (EX)' },
      { icon: 'break', label: 'Break', cmd: 'break', tip: 'Break (BR)' },
      { icon: 'join', label: 'Join', cmd: 'join', tip: 'Join (J)' },
      { icon: 'stretch', label: 'Stretch', cmd: 'stretch', tip: 'Stretch (S)' },
      { icon: 'array', label: 'Array', cmd: 'array', tip: 'Array (AR)' },
      { icon: 'fillet', label: 'Fillet', cmd: 'fillet', tip: 'Fillet (F)' },
      { icon: 'chamfer', label: 'Chamfer', cmd: 'chamfer', tip: 'Chamfer (CHA)' },
      { icon: 'explode', label: 'Explode', cmd: 'explode', tip: 'Explode (X)' },
      { icon: 'erase', label: 'Erase', cmd: 'erase', tip: 'Erase (E)' },
    ],
  },
  {
    title: 'Layout',
    items: [
      { icon: 'mview', label: 'Viewport', cmd: 'mview', tip: 'New paper-space viewport (MV)' },
      { icon: 'annoscale', label: 'Anno Scl', cmd: 'annoscale', tip: 'Annotation scale (ANNOSCALE)' },
      { icon: 'template', label: 'Template', cmd: 'template', tip: 'Import AutoCAD template (DXF)' },
    ],
  },
  {
    title: 'Blocks',
    items: [
      { icon: 'block', label: 'Block', cmd: 'block', tip: 'Define block from selection (B)' },
      { icon: 'insert', label: 'Insert', cmd: 'insert', tip: 'Insert block (I)' },
    ],
  },
];

const UI = {

  init(app) {
    UI.buildToolbar(app);
    UI.bindMenus(app);
    UI.bindStatusBar(app);
    UI.bindLayerPanel(app);
    UI.buildHelp(app);
    UI.bindDimStyle(app);
    UI.refreshLayers(app);
    UI.refreshProps(app);
    UI.refreshStatus(app);
  },

  /* ---- toolbar ---- */

  buildToolbar(app) {
    const bar = document.getElementById('toolbar');
    bar.innerHTML = '';
    for (const group of TOOLBAR_GROUPS) {
      const g = document.createElement('div');
      g.className = 'tb-group';
      const h = document.createElement('div');
      h.className = 'tb-title';
      h.textContent = group.title;
      g.appendChild(h);
      const wrap = document.createElement('div');
      wrap.className = 'tb-items';
      for (const it of group.items) {
        const b = document.createElement('button');
        b.className = 'tb-btn';
        b.dataset.cmd = it.cmd;
        b.title = it.tip;
        b.innerHTML = `${svgIcon(it.icon)}<span>${it.label}</span>`;
        b.addEventListener('click', () => {
          if (it.cmd === '_select') app.cancel();
          else app.execCommand(it.cmd);
        });
        wrap.appendChild(b);
      }
      g.appendChild(wrap);
      bar.appendChild(g);
    }
  },

  markActiveTool(app) {
    const toolToCmd = {
      select: '_select', pan: 'pan', line: 'line', polyline: 'pline', circle: 'circle', arc: 'arc',
      rectangle: 'rectang', polygon: 'polygon', point: 'point', text: 'text',
      dimlinear: 'dimlinear', dimaligned: 'dimaligned', dist: 'dist',
      move: 'move', copy: 'copy', rotate: 'rotate', scale: 'scale', mirror: 'mirror',
      offset: 'offset', trim: 'trim', extend: 'extend', array: 'array',
      fillet: 'fillet', explode: 'explode', erase: 'erase',
      hatch: 'hatch', block: 'block', insert: 'insert',
      dimradius: 'dimradius', dimdiameter: 'dimradius', dimangular: 'dimangular',
      ellipse: 'ellipse', leader: 'leader', mtext: 'mtext', break: 'break', join: 'join',
      stretch: 'stretch', chamfer: 'chamfer',
      dimcontinue: 'dimcontinue', dimbaseline: 'dimbaseline', plot: '_select',
      mview: 'mview', annoscale: 'annoscale',
    };
    const active = toolToCmd[app.tool ? app.tool.name : 'select'];
    document.querySelectorAll('.tb-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.cmd === active);
    });
  },

  /* ---- menus ---- */

  bindMenus(app) {
    const menus = document.querySelectorAll('#menubar .menu');
    let open = null;
    const closeAll = () => {
      menus.forEach(m => m.classList.remove('open'));
      open = null;
    };
    menus.forEach(m => {
      const label = m.querySelector('.menu-label');
      label.addEventListener('click', (e) => {
        e.stopPropagation();
        const was = m.classList.contains('open');
        closeAll();
        if (!was) { m.classList.add('open'); open = m; }
      });
      m.addEventListener('mouseenter', () => {
        if (open && open !== m) { closeAll(); m.classList.add('open'); open = m; }
      });
    });
    document.addEventListener('click', closeAll);
    document.querySelectorAll('#menubar .dropdown button').forEach(b => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        closeAll();
        const cmd = b.dataset.cmd;
        if (cmd) app.execCommand(cmd);
      });
    });
  },

  /* ---- status bar ---- */

  bindStatusBar(app) {
    const bind = (id, cmd) => {
      document.getElementById(id).addEventListener('click', () => app.execCommand(cmd));
    };
    bind('tog-grid', 'grid');
    bind('tog-snap', 'snap');
    bind('tog-ortho', 'ortho');
    bind('tog-polar', 'polar');
    bind('tog-otrack', 'otrack');
    bind('tog-dyn', 'dyn');
    document.getElementById('anno-scale').addEventListener('click', () => app.execCommand('annoscale'));
    bind('tog-osnap', 'osnap');
  },

  refreshStatus(app) {
    const s = app.doc.settings;
    const set = (id, on) => document.getElementById(id).classList.toggle('on', !!on);
    set('tog-grid', s.grid);
    set('tog-snap', s.snapGrid);
    set('tog-ortho', s.ortho);
    set('tog-polar', s.polar);
    set('tog-otrack', s.otrack);
    set('tog-dyn', s.dynInput);
    set('tog-osnap', s.osnap);
    document.getElementById('anno-scale').textContent = UNITS.scaleLabel(s.annoScale || 1);
    document.getElementById('anno-scale').classList.toggle('on', (s.annoScale || 1) !== 1);
    document.getElementById('zoom-level').textContent = `${(app.vp.scale * 100 / 4).toFixed(0)}%`;
    document.getElementById('cur-layer').textContent = app.doc.currentLayer;
    const sw = document.getElementById('cur-layer-swatch');
    const ly = app.doc.layer(app.doc.currentLayer);
    if (ly) sw.style.background = ly.color;
    app.requestRender();
  },

  updateCoords(app) {
    const p = app.pointer.snapped;
    const arch = app.doc.settings.units === 'architectural';
    const f = (v) => (arch ? UNITS.formatLength(v, 'architectural') : v.toFixed(4));
    document.getElementById('coords').textContent = `${f(p.x)}, ${f(p.y)}`;
  },

  /* ---- layers panel ---- */

  bindLayerPanel(app) {
    document.getElementById('layer-add').addEventListener('click', () => {
      let name = window.prompt('New layer name:', `Layer${app.doc.layers.length}`);
      if (!name) return;
      name = name.trim();
      if (!name) return;
      if (!app.doc.addLayer(name)) { app.print(`Layer "${name}" already exists.`); return; }
      app.doc.currentLayer = name;
      UI.refreshLayers(app);
      UI.refreshStatus(app);
    });
  },

  refreshLayers(app) {
    const list = document.getElementById('layers-list');
    list.innerHTML = '';
    for (const ly of app.doc.layers) {
      const row = document.createElement('div');
      row.className = 'layer-row' + (ly.name === app.doc.currentLayer ? ' current' : '');

      const eye = document.createElement('button');
      eye.className = 'icon-btn' + (ly.visible ? ' on' : '');
      eye.title = 'Visible';
      eye.textContent = ly.visible ? '👁' : '–';
      eye.addEventListener('click', () => {
        ly.visible = !ly.visible;
        app.doc._changed();
        UI.refreshLayers(app);
      });

      const lock = document.createElement('button');
      lock.className = 'icon-btn' + (ly.locked ? ' on' : '');
      lock.title = 'Locked';
      lock.textContent = ly.locked ? '🔒' : '🔓';
      lock.addEventListener('click', () => {
        ly.locked = !ly.locked;
        app.doc._changed();
        UI.refreshLayers(app);
      });

      const color = document.createElement('input');
      color.type = 'color';
      color.value = ly.color;
      color.title = 'Layer color';
      color.addEventListener('change', () => {
        ly.color = color.value;
        app.doc._changed();
        UI.refreshStatus(app);
      });

      const name = document.createElement('span');
      name.className = 'layer-name';
      name.textContent = ly.name;
      name.title = 'Click to make current';
      name.addEventListener('click', () => {
        app.doc.currentLayer = ly.name;
        UI.refreshLayers(app);
        UI.refreshStatus(app);
      });

      const lt = document.createElement('select');
      lt.className = 'layer-mini';
      lt.title = 'Linetype';
      for (const [v, label] of [['continuous', '——'], ['dashed', '– –'], ['hidden', '···–'], ['center', '–·–'], ['dot', '···']]) {
        const o = document.createElement('option');
        o.value = v; o.textContent = label;
        lt.appendChild(o);
      }
      lt.value = ly.ltype || 'continuous';
      lt.addEventListener('change', () => {
        ly.ltype = lt.value;
        app.doc._changed();
      });

      const lw = document.createElement('select');
      lw.className = 'layer-mini';
      lw.title = 'Lineweight';
      for (const v of [1, 1.5, 2, 3]) {
        const o = document.createElement('option');
        o.value = String(v); o.textContent = v.toFixed(1);
        lw.appendChild(o);
      }
      lw.value = String(ly.lweight || 1);
      lw.addEventListener('change', () => {
        ly.lweight = parseFloat(lw.value);
        app.doc._changed();
      });

      const del = document.createElement('button');
      del.className = 'icon-btn danger';
      del.title = 'Delete layer (must be empty)';
      del.textContent = '✕';
      del.addEventListener('click', () => {
        if (!app.doc.deleteLayer(ly.name)) {
          app.print(ly.name === '0' ? 'Layer 0 cannot be deleted.' : `Layer "${ly.name}" is not empty.`);
        } else {
          UI.refreshLayers(app);
          UI.refreshStatus(app);
        }
      });

      row.append(eye, lock, color, name, lt, lw, del);
      list.appendChild(row);
    }
  },

  /* ---- properties panel ---- */

  refreshProps(app) {
    const body = document.getElementById('props-body');
    body.innerHTML = '';
    const sel = app.doc.selectedEntities();

    const row = (label, el) => {
      const r = document.createElement('div');
      r.className = 'prop-row';
      const l = document.createElement('label');
      l.textContent = label;
      r.append(l, el);
      body.appendChild(r);
    };
    const info = (label, value) => {
      const s = document.createElement('span');
      s.className = 'prop-value';
      s.textContent = value;
      row(label, s);
    };

    if (!sel.length) {
      info('Selection', 'none');
      info('Entities', String(app.doc.entities.length));
      return;
    }

    info('Selection', sel.length === 1 ? ENT.describe(sel[0]) : `${sel.length} objects`);

    // layer selector
    const laySel = document.createElement('select');
    for (const ly of app.doc.layers) {
      const o = document.createElement('option');
      o.value = ly.name;
      o.textContent = ly.name;
      laySel.appendChild(o);
    }
    const sameLayer = sel.every(e => e.layer === sel[0].layer);
    laySel.value = sameLayer ? sel[0].layer : '';
    laySel.addEventListener('change', () => {
      app.doc.checkpoint();
      sel.forEach(e => { e.layer = laySel.value; });
      app.doc._changed();
    });
    row('Layer', laySel);

    // color: ByLayer toggle + picker
    const colorWrap = document.createElement('div');
    colorWrap.className = 'prop-inline';
    const byLayer = document.createElement('input');
    byLayer.type = 'checkbox';
    byLayer.checked = sel.every(e => !e.color);
    byLayer.title = 'ByLayer';
    const byLabel = document.createElement('span');
    byLabel.className = 'prop-mini';
    byLabel.textContent = 'ByLayer';
    const colorIn = document.createElement('input');
    colorIn.type = 'color';
    colorIn.value = sel[0].color || app.doc.entityColor(sel[0]);
    colorIn.disabled = byLayer.checked;
    byLayer.addEventListener('change', () => {
      app.doc.checkpoint();
      sel.forEach(e => { e.color = byLayer.checked ? null : colorIn.value; });
      colorIn.disabled = byLayer.checked;
      app.doc._changed();
    });
    colorIn.addEventListener('change', () => {
      app.doc.checkpoint();
      sel.forEach(e => { e.color = colorIn.value; });
      app.doc._changed();
    });
    colorWrap.append(byLayer, byLabel, colorIn);
    row('Color', colorWrap);

    if (sel.length !== 1) return;
    const e = sel[0];

    const numField = (value, apply) => {
      const i = document.createElement('input');
      i.type = 'number';
      i.step = 'any';
      i.value = (+value.toFixed(6)).toString();
      i.addEventListener('change', () => {
        const v = parseFloat(i.value);
        if (Number.isNaN(v)) return;
        app.doc.checkpoint();
        apply(v);
        app.doc._changed();
      });
      return i;
    };

    switch (e.type) {
      case 'line': {
        row('Start X', numField(e.a.x, v => { e.a.x = v; }));
        row('Start Y', numField(e.a.y, v => { e.a.y = v; }));
        row('End X', numField(e.b.x, v => { e.b.x = v; }));
        row('End Y', numField(e.b.y, v => { e.b.y = v; }));
        // editable length/angle: the start point stays fixed, the end moves
        const lenIn = document.createElement('input');
        lenIn.type = 'text';
        lenIn.value = fmtLen(GEO.dist(e.a, e.b));
        lenIn.title = "Accepts 3'6, 18\", 42 …";
        lenIn.addEventListener('change', () => {
          const v = UNITS.parseLength(lenIn.value);
          if (v === null || v <= 0) { lenIn.value = fmtLen(GEO.dist(e.a, e.b)); return; }
          app.doc.checkpoint();
          e.b = GEO.polar(e.a, GEO.ang(e.a, e.b), v);
          app.doc._changed();
        });
        row('Length', lenIn);
        row('Angle °', numField(degOf(GEO.ang(e.a, e.b)), v => {
          const len = GEO.dist(e.a, e.b);
          e.b = GEO.polar(e.a, v * Math.PI / 180, len);
        }));
        break;
      }
      case 'circle':
        row('Center X', numField(e.c.x, v => { e.c.x = v; }));
        row('Center Y', numField(e.c.y, v => { e.c.y = v; }));
        row('Radius', numField(e.r, v => { if (v > 0) e.r = v; }));
        info('Circumference', fmt(2 * Math.PI * e.r));
        break;
      case 'arc':
        row('Center X', numField(e.c.x, v => { e.c.x = v; }));
        row('Center Y', numField(e.c.y, v => { e.c.y = v; }));
        row('Radius', numField(e.r, v => { if (v > 0) e.r = v; }));
        row('Start °', numField(degOf(e.a0), v => { e.a0 = GEO.normAng(v * Math.PI / 180); }));
        row('End °', numField(degOf(e.a1), v => { e.a1 = GEO.normAng(v * Math.PI / 180); }));
        break;
      case 'polyline': {
        info('Vertices', String(e.pts.length));
        const closed = document.createElement('input');
        closed.type = 'checkbox';
        closed.checked = !!e.closed;
        closed.addEventListener('change', () => {
          app.doc.checkpoint();
          e.closed = closed.checked;
          app.doc._changed();
        });
        row('Closed', closed);
        break;
      }
      case 'point':
        row('X', numField(e.p.x, v => { e.p.x = v; }));
        row('Y', numField(e.p.y, v => { e.p.y = v; }));
        break;
      case 'text': {
        const t = document.createElement('input');
        t.type = 'text';
        t.value = e.text;
        t.addEventListener('change', () => {
          app.doc.checkpoint();
          e.text = t.value;
          app.doc._changed();
        });
        row('Text', t);
        row('Height', numField(e.height, v => { if (v > 0) e.height = v; }));
        row('Rotation °', numField(degOf(e.rotation || 0), v => { e.rotation = v * Math.PI / 180; }));
        break;
      }
      case 'mtext': {
        const ta = document.createElement('textarea');
        ta.rows = 3;
        ta.value = e.text;
        ta.addEventListener('change', () => {
          app.doc.checkpoint();
          e.text = ta.value;
          app.doc._changed();
        });
        row('Text', ta);
        row('Height', numField(e.height, v => { if (v > 0) e.height = v; }));
        row('Width', numField(e.width, v => { if (v > 0) e.width = v; }));
        break;
      }
      case 'dim':
        info('Value', ENT.formatDim(ENT.dimValue(e)));
        info('Type', e.dtype);
        break;
      case 'viewport': {
        info('Scale', UNITS.scaleLabel(1 / e.scale));
        row('Scale 1:n', numField(1 / e.scale, v => { if (v > 0) e.scale = 1 / v; }));
        row('Center X', numField(e.center.x, v => { e.center.x = v; }));
        row('Center Y', numField(e.center.y, v => { e.center.y = v; }));
        row('Width', numField(e.w, v => { if (v > 0.1) e.w = v; }));
        row('Height', numField(e.h, v => { if (v > 0.1) e.h = v; }));
        break;
      }
    }
  },

  /* ---- help overlay ---- */

  buildHelp(app) {
    const modal = document.getElementById('help-modal');
    const body = document.getElementById('help-body');
    const aliasFor = {};
    for (const [a, c] of Object.entries(ALIASES)) {
      (aliasFor[c] = aliasFor[c] || []).push(a.toUpperCase());
    }
    let html = '<h3>Commands</h3><table><tr><th>Command</th><th>Aliases</th><th>Description</th></tr>';
    for (const [name, cmd] of Object.entries(COMMANDS)) {
      html += `<tr><td>${name.toUpperCase()}</td><td>${(aliasFor[name] || []).join(', ')}</td><td>${cmd.help || ''}</td></tr>`;
    }
    html += '</table><h3>Mouse & keys</h3><table>';
    const rows = [
      ['Wheel', 'Zoom at cursor'],
      ['Middle drag', 'Pan'],
      ['Right click', 'Enter (confirm / repeat last command)'],
      ['Left drag / two clicks', 'Window select (→ blue) or crossing select (← green)'],
      ['Shift + click', 'Remove from selection'],
      ['Esc', 'Cancel command / clear selection'],
      ['Enter (empty)', 'Repeat last command'],
      ['Coordinates', '10,20 absolute · @10,20 relative · @15&lt;45 polar · bare length = distance along cursor'],
      ['Lengths', "decimal or feet-inches: 42 · 3'6 · 3'-6 1/2\" · 18\" · 6 1/2 (1 unit = 1\")"],
      ['Polar tracking', 'F10 — locks the cursor to 45° increments with a distance&lt;angle readout'],
      ['Osnap tracking', 'F11 — hover an osnap to acquire a point, then align with dotted rays'],
      ['Angle override', 'type &lt;30 to lock the next point to a 30° bearing'],
      ['Autocomplete', 'type a command — Tab completes, ↑/↓ choose, Enter runs'],
      ['MText', 'MT draws a text box; double-click any mtext to edit in place'],
      ['Layouts', 'tabs below the canvas switch Model / paper space; MV adds a viewport'],
      ['Template', 'File → Import Template: each template layout becomes a tab at its sheet size'],
      ['Blocks', 'BE (or double-click an insert) edits a block in place; BC closes; B redefines'],
      ['Dynamic input', 'F12 — live distance&lt;angle tooltip at the cursor before the next click'],
      ['F1', 'Help'], ['F3', 'Object snap'], ['F7', 'Grid'], ['F8', 'Ortho'], ['F9', 'Grid snap'], ['F10', 'Polar tracking'], ['F12', 'Dynamic input'],
      ['Ctrl+Z / Ctrl+Y', 'Undo / Redo'], ['Ctrl+A', 'Select all'], ['Ctrl+S', 'Save'], ['Delete', 'Erase selection'],
    ];
    for (const [k, v] of rows) html += `<tr><td>${k}</td><td colspan="2">${v}</td></tr>`;
    html += '</table>';
    body.innerHTML = html;
    document.getElementById('help-close').addEventListener('click', () => { modal.hidden = true; });
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.hidden = true; });
  },

  showHelp() {
    document.getElementById('help-modal').hidden = false;
  },

  /* ---- model / layout tabs ---- */

  refreshTabs(app) {
    const wrap = document.getElementById('space-tabs');
    wrap.innerHTML = '';
    const mk = (label, active, onClick, extraClass) => {
      const b = document.createElement('button');
      b.className = 'space-tab' + (active ? ' active' : '') + (extraClass ? ' ' + extraClass : '');
      b.textContent = label;
      b.addEventListener('click', onClick);
      wrap.appendChild(b);
      return b;
    };
    const blk = app.doc.editingBlock();
    if (blk) {
      mk(`✎ Block: ${blk} — click to finish`, true, () => app.execCommand('bclose'), 'block-edit');
    }
    mk('Model', app.doc.space === 'model', () => app.setSpace('model'));
    app.doc.layouts.forEach((l, i) => {
      const t = mk(l.name, app.doc.space === i, () => app.setSpace(i));
      t.title = 'Double-click to rename';
      t.addEventListener('dblclick', () => {
        const name = window.prompt('Layout name:', l.name);
        if (name && name.trim()) { l.name = name.trim(); app.doc._changed(); UI.refreshTabs(app); }
      });
    });
    mk('＋', false, () => {
      app.doc.layouts.push({
        name: `Layout${app.doc.layouts.length + 1}`,
        paper: 'letter', landscape: true, entities: [],
      });
      app.doc._changed();
      app.setSpace(app.doc.layouts.length - 1);
    }, 'add');

    // layout options (paper / orientation)
    const opts = document.getElementById('layout-opts');
    const layout = app.doc.activeLayout();
    opts.hidden = !layout;
    if (layout) {
      const sel = document.getElementById('layout-paper');
      sel.innerHTML = '';
      for (const name of Object.keys(UNITS.PAPERS)) {
        const o = document.createElement('option');
        o.value = name;
        const [w, h] = UNITS.PAPERS[name];
        o.textContent = `${name.toUpperCase()} (${w}×${h}")`;
        sel.appendChild(o);
      }
      if (layout.paper === 'custom') {
        const o = document.createElement('option');
        o.value = 'custom';
        o.textContent = `CUSTOM (${layout.customW}×${layout.customH}")`;
        sel.appendChild(o);
      }
      sel.value = layout.paper;
      sel.onchange = () => { layout.paper = sel.value; app.doc._changed(); app.vp.zoomExtents(app.activeBBox()); app.requestRender(); };
      document.getElementById('layout-orient').onclick = () => {
        layout.landscape = !layout.landscape;
        app.doc._changed();
        app.vp.zoomExtents(app.activeBBox());
        app.requestRender();
      };
    }
  },

  /* ---- mtext in-canvas editor ---- */

  openMtextEditor(app, ent, onDone) {
    const wrap = document.getElementById('canvas-wrap');
    const old = document.getElementById('mtext-editor');
    if (old) old.remove();
    const tl = app.vp.w2s(ent.p);
    const wPx = Math.max(ent.width * app.vp.scale, 160);
    const lines = ENT.mtextLines(ent);
    const hPx = Math.max(lines.length * ENT.MTEXT_LS * ent.height * app.vp.scale, 70);
    const ed = document.createElement('div');
    ed.id = 'mtext-editor';
    ed.style.left = Math.max(4, Math.min(tl.x, app.vp.w - wPx - 8)) + 'px';
    ed.style.top = Math.max(4, Math.min(tl.y, app.vp.h - hPx - 40)) + 'px';
    ed.style.width = wPx + 'px';
    const ta = document.createElement('textarea');
    ta.value = ent.text || '';
    ta.style.height = hPx + 'px';
    ta.spellcheck = false;
    const bar = document.createElement('div');
    bar.className = 'mtext-bar';
    const ok = document.createElement('button');
    ok.textContent = 'OK (Ctrl+Enter)';
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel (Esc)';
    bar.append(ok, cancel);
    ed.append(ta, bar);
    wrap.appendChild(ed);
    ta.focus();
    const close = (text) => {
      ed.remove();
      document.getElementById('cmd-input').focus();
      onDone(text);
      app.requestRender();
    };
    ok.addEventListener('click', () => close(ta.value));
    cancel.addEventListener('click', () => close(null));
    ta.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); close(ta.value); }
      else if (ev.key === 'Escape') { ev.preventDefault(); close(null); }
    });
  },

  /* ---- dimension style dialog ---- */

  openDimStyle(app) {
    const modal = document.getElementById('dimstyle-modal');
    const ds = app.doc.settings.dimStyle;
    document.getElementById('ds-text').value = ds.textHeight;
    document.getElementById('ds-arrow').value = ds.arrow;
    document.getElementById('ds-gap').value = ds.extGap;
    document.getElementById('ds-over').value = ds.extOver;
    document.getElementById('ds-prec').value = ds.precision;
    modal.hidden = false;
  },

  bindDimStyle(app) {
    const modal = document.getElementById('dimstyle-modal');
    document.getElementById('ds-apply').addEventListener('click', () => {
      const num = (id, min) => {
        const v = parseFloat(document.getElementById(id).value);
        return Number.isNaN(v) ? null : Math.max(min, v);
      };
      const ds = app.doc.settings.dimStyle;
      ds.textHeight = num('ds-text', 0.1) || ds.textHeight;
      ds.arrow = num('ds-arrow', 0.1) || ds.arrow;
      ds.extGap = num('ds-gap', 0);
      ds.extOver = num('ds-over', 0);
      ds.precision = Math.round(num('ds-prec', 0) == null ? ds.precision : num('ds-prec', 0));
      modal.hidden = true;
      app.doc._changed();
      app.print('Dimension style updated.');
    });
    document.getElementById('ds-close').addEventListener('click', () => { modal.hidden = true; });
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.hidden = true; });
  },

  /* ---- command autocomplete ---- */

  _suggest: { items: [], idx: -1 },

  updateSuggest(app, value) {
    const box = document.getElementById('cmd-suggest');
    const v = value.trim().toLowerCase();
    const idle = app.tool && app.tool.name === 'select' && !app.tool.gripDrag;
    if (!idle || !v || !/^[a-z?]+$/.test(v)) { UI.closeSuggest(); return; }
    const seen = new Set();
    const items = [];
    for (const [name, cmd] of Object.entries(COMMANDS)) {
      if (name.startsWith(v) && !seen.has(name)) { seen.add(name); items.push({ cmd: name, via: null, help: cmd.help }); }
    }
    for (const [alias, target] of Object.entries(ALIASES)) {
      if (alias.startsWith(v) && !seen.has(target)) {
        seen.add(target);
        items.push({ cmd: target, via: alias, help: (COMMANDS[target] || {}).help });
      }
    }
    items.sort((a, b) => a.cmd.localeCompare(b.cmd));
    UI._suggest = { items: items.slice(0, 8), idx: -1 };
    if (!UI._suggest.items.length) { UI.closeSuggest(); return; }
    box.innerHTML = '';
    UI._suggest.items.forEach((it, i) => {
      const div = document.createElement('div');
      div.className = 'suggest-item';
      div.innerHTML = `<b>${it.cmd.toUpperCase()}</b><span class="suggest-alias">${it.via ? it.via.toUpperCase() : ''}</span><span class="suggest-help">${it.help || ''}</span>`;
      div.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        UI.closeSuggest();
        document.getElementById('cmd-input').value = '';
        app.submitInput(it.cmd);
      });
      box.appendChild(div);
    });
    box.hidden = false;
  },

  suggestOpen() {
    const box = document.getElementById('cmd-suggest');
    return box && !box.hidden;
  },

  moveSuggest(dir) {
    const sg = UI._suggest;
    if (!sg.items.length) return;
    sg.idx = (sg.idx + dir + sg.items.length) % sg.items.length;
    const box = document.getElementById('cmd-suggest');
    [...box.children].forEach((el, i) => el.classList.toggle('sel', i === sg.idx));
  },

  // returns the command to run, or null. onlyExplicit: require a highlighted row.
  acceptSuggest(onlyExplicit) {
    const sg = UI._suggest;
    if (!sg.items.length) return null;
    if (sg.idx >= 0) return sg.items[sg.idx].cmd;
    return onlyExplicit ? null : sg.items[0].cmd;
  },

  closeSuggest() {
    const box = document.getElementById('cmd-suggest');
    if (box) box.hidden = true;
    UI._suggest = { items: [], idx: -1 };
  },

  setDocTitle(name, modified) {
    document.getElementById('doc-title').textContent = name + (modified ? ' •' : '');
  },
};

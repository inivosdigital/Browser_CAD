/* tools.js — interactive tool state machines and the command registry.
   Tool interface: { name, start(app), click(app, pt, ev), move(app, pt),
                     input(app, raw)->bool, up(app, ev), preview(ctx, app), rawInput }
   `pt` passed to click() is the snapped/effective world point; selection
   operations use app.pointer.raw (unsnapped cursor position). */
'use strict';

const fmt = (n) => {
  let s = (+n).toFixed(4);
  s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s === '-0' ? '0' : s;
};
const degOf = (rad) => GEO.normAng(rad) * 180 / Math.PI;
// distance input: accepts decimal and architectural (3'6, 18", 6 1/2) forms
const parseDist = (raw) => (typeof UNITS !== 'undefined' ? UNITS.parseLength(raw) : (Number.isNaN(parseFloat(raw)) ? null : parseFloat(raw)));
const fmtLen = (v) => (typeof UNITS !== 'undefined' && ENT.units === 'architectural' ? UNITS.formatLength(v, 'architectural') : fmt(v));

/* ================= selection helpers ================= */

const SEL = {
  hitAt(app, pt) {
    const tol = app.pickTol();
    for (let i = app.doc.entities.length - 1; i >= 0; i--) {
      const e = app.doc.entities[i];
      if (!app.doc.selectable(e)) continue;
      if (ENT.hitTest(e, pt, tol)) return e;
    }
    return null;
  },

  // click handling shared by Select tool and modify-tool "Select objects:" stage
  click(app, ev) {
    const pt = app.pointer.raw;
    if (app.rubber) { SEL.finishRubber(app); return; }
    const e = SEL.hitAt(app, pt);
    if (e) {
      if (ev && ev.shiftKey) app.doc.selection.delete(e.id);
      else app.doc.selection.add(e.id);
      app.onSelectionChange();
    } else {
      app.rubber = { a: pt, b: pt };
    }
  },

  move(app) {
    if (app.rubber) app.rubber.b = app.pointer.raw;
  },

  up(app, downScreen) {
    // drag-style window select: finish on release if the mouse travelled
    if (app.rubber && downScreen) {
      const d = Math.hypot(app.pointer.screen.x - downScreen.x, app.pointer.screen.y - downScreen.y);
      if (d > 8) SEL.finishRubber(app);
    }
  },

  finishRubber(app) {
    const r = app.rubber;
    app.rubber = null;
    if (!r) return;
    const crossing = r.b.x < r.a.x; // drag right-to-left = crossing (green)
    const rect = GEO.rectFromPts(r.a, r.b);
    let n = 0;
    for (const e of app.doc.entities) {
      if (!app.doc.selectable(e)) continue;
      if (ENT.inRect(e, rect, crossing)) { app.doc.selection.add(e.id); n++; }
    }
    if (n) app.print(`${n} found (${crossing ? 'crossing' : 'window'})`);
    app.onSelectionChange();
  },
};

/* ================= modify-tool base (acquire selection first) ================= */

function startModify(app, tool) {
  if (app.doc.selection.size) {
    tool.stage = null;
    tool.begin(app);
  } else {
    tool.stage = 'acquire';
    app.prompt(`${tool.label} — Select objects, then Enter:`);
  }
}

function acquireClick(app, tool, ev) {
  SEL.click(app, ev);
  const n = app.doc.selection.size;
  app.prompt(`${tool.label} — ${n} selected. Select objects, then Enter:`);
}

function acquireInput(app, tool, raw) {
  if (raw !== '') return false;
  if (!app.doc.selection.size) { app.print('Nothing selected.'); return true; }
  tool.stage = null;
  tool.begin(app);
  return true;
}

function ghostSelection(ctx, app, xf) {
  for (const e of app.doc.selectedEntities()) {
    RENDER.ghostEntity(ctx, app.vp, ENT.transformed(e, xf));
  }
}

/* ================= offset / trim / fillet geometry ================= */

function offsetEntity(e, d, sidePt) {
  if (e.type === 'line') {
    const dir = GEO.norm(GEO.sub(e.b, e.a));
    const n = GEO.perp(dir);
    const s = GEO.dot(GEO.sub(sidePt, e.a), n) >= 0 ? 1 : -1;
    const off = GEO.mul(n, d * s);
    return makeEntity('line', { a: GEO.add(e.a, off), b: GEO.add(e.b, off), layer: e.layer, color: e.color });
  }
  if (e.type === 'circle' || e.type === 'arc') {
    const out = GEO.dist(sidePt, e.c) > e.r;
    const r = e.r + (out ? d : -d);
    if (r <= 1e-9) return null;
    if (e.type === 'circle') return makeEntity('circle', { c: { ...e.c }, r, layer: e.layer, color: e.color });
    return makeEntity('arc', { c: { ...e.c }, r, a0: e.a0, a1: e.a1, layer: e.layer, color: e.color });
  }
  if (e.type === 'polyline') {
    const pts = e.pts;
    const n = pts.length;
    if (n < 2) return null;
    const segs = [];
    for (let i = 0; i + 1 < n; i++) segs.push([pts[i], pts[i + 1]]);
    if (e.closed && n > 2) segs.push([pts[n - 1], pts[0]]);
    // pick side from the nearest segment, then offset all segments consistently
    let nearest = 0, nd = Infinity;
    segs.forEach((s, i) => {
      const dd = GEO.distPtSeg(sidePt, s[0], s[1]);
      if (dd < nd) { nd = dd; nearest = i; }
    });
    const nrm = (s) => GEO.perp(GEO.norm(GEO.sub(s[1], s[0])));
    const sgn = GEO.dot(GEO.sub(sidePt, segs[nearest][0]), nrm(segs[nearest])) >= 0 ? 1 : -1;
    const off = segs.map(s => {
      const o = GEO.mul(nrm(s), d * sgn);
      return [GEO.add(s[0], o), GEO.add(s[1], o)];
    });
    const join = (s1, s2) => GEO.lineLine(s1[0], s1[1], s2[0], s2[1]) || s1[1];
    const newPts = [];
    if (e.closed && n > 2) {
      for (let i = 0; i < off.length; i++) newPts.push(join(off[(i + off.length - 1) % off.length], off[i]));
      return makeEntity('polyline', { pts: newPts, closed: true, layer: e.layer, color: e.color });
    }
    newPts.push(off[0][0]);
    for (let i = 0; i + 1 < off.length; i++) newPts.push(join(off[i], off[i + 1]));
    newPts.push(off[off.length - 1][1]);
    return makeEntity('polyline', { pts: newPts, closed: false, layer: e.layer, color: e.color });
  }
  return null;
}

function collectCuts(app, target) {
  const cuts = [];
  for (const other of app.doc.entities) {
    if (other.id === target.id || !app.doc.visible(other)) continue;
    for (const p of ENT.intersections(target, other)) {
      if (!cuts.some(q => GEO.eq(q, p, 1e-6))) cuts.push(p);
    }
  }
  return cuts;
}

function trimEntity(app, e, clickPt) {
  const cuts = collectCuts(app, e);
  const props = { layer: e.layer, color: e.color };
  const eps = 1e-6;

  if (e.type === 'line') {
    const ts = cuts.map(p => GEO.lineParam(p, e.a, e.b)).filter(t => t > eps && t < 1 - eps).sort((x, y) => x - y);
    if (!ts.length) { app.print('No intersections found.'); return false; }
    const tHit = GEO.segParam(clickPt, e.a, e.b);
    let lo = null, hi = null;
    for (const t of ts) { if (t < tHit) lo = t; else if (hi === null) hi = t; }
    const P = (t) => GEO.lerp(e.a, e.b, t);
    const out = [];
    if (lo !== null) out.push(makeEntity('line', { a: { ...e.a }, b: P(lo), ...props }));
    if (hi !== null) out.push(makeEntity('line', { a: P(hi), b: { ...e.b }, ...props }));
    app.doc.checkpoint();
    app.doc.remove([e.id]);
    out.forEach(x => app.doc.add(x));
    return true;
  }

  if (e.type === 'circle') {
    const angs = cuts.map(p => GEO.ang(e.c, p));
    if (angs.length < 2) { app.print('Need at least two intersections to trim a circle.'); return false; }
    const aHit = GEO.ang(e.c, clickPt);
    // remaining arc runs CCW from the first cut after the click to the last cut before it
    let hi = null, hiRel = Infinity, lo = null, loRel = -Infinity;
    for (const a of angs) {
      const rel = GEO.normAng(a - aHit);
      if (rel > eps && rel < hiRel) { hiRel = rel; hi = a; }
      const rel2 = GEO.normAng(a - aHit) - Math.PI * 2; // negative side
      if (rel2 < -eps && rel2 > loRel) { loRel = rel2; lo = a; }
    }
    if (hi === null || lo === null) { app.print('Need at least two intersections to trim a circle.'); return false; }
    app.doc.checkpoint();
    app.doc.remove([e.id]);
    app.doc.add(makeEntity('arc', { c: { ...e.c }, r: e.r, a0: GEO.normAng(hi), a1: GEO.normAng(lo), ...props }));
    return true;
  }

  if (e.type === 'arc') {
    const sweep = GEO.sweep(e.a0, e.a1);
    const rels = cuts.map(p => GEO.normAng(GEO.ang(e.c, p) - e.a0)).filter(r => r > eps && r < sweep - eps).sort((x, y) => x - y);
    if (!rels.length) { app.print('No intersections found.'); return false; }
    const rHit = GEO.normAng(GEO.ang(e.c, clickPt) - e.a0);
    let lo = null, hi = null;
    for (const r of rels) { if (r < rHit) lo = r; else if (hi === null) hi = r; }
    const out = [];
    if (lo !== null) out.push(makeEntity('arc', { c: { ...e.c }, r: e.r, a0: e.a0, a1: GEO.normAng(e.a0 + lo), ...props }));
    if (hi !== null) out.push(makeEntity('arc', { c: { ...e.c }, r: e.r, a0: GEO.normAng(e.a0 + hi), a1: e.a1, ...props }));
    app.doc.checkpoint();
    app.doc.remove([e.id]);
    out.forEach(x => app.doc.add(x));
    return true;
  }

  if (e.type === 'polyline') {
    if (e.closed) { app.print('Trimming closed polylines is not supported yet.'); return false; }
    const pts = e.pts;
    const nSeg = pts.length - 1;
    if (nSeg < 1) return false;
    const paramOf = (p) => {
      let best = null, bd = Infinity;
      for (let i = 0; i < nSeg; i++) {
        const t = GEO.segParam(p, pts[i], pts[i + 1]);
        const q = GEO.lerp(pts[i], pts[i + 1], t);
        const d = GEO.dist(p, q);
        if (d < bd) { bd = d; best = i + t; }
      }
      return best;
    };
    const cps = cuts.map(paramOf).filter(t => t > eps && t < nSeg - eps).sort((x, y) => x - y);
    if (!cps.length) { app.print('No intersections found.'); return false; }
    const tHit = paramOf(clickPt);
    let lo = null, hi = null;
    for (const t of cps) { if (t < tHit) lo = t; else if (hi === null) hi = t; }
    const ptAt = (t) => {
      const i = Math.min(nSeg - 1, Math.floor(t));
      return GEO.lerp(pts[i], pts[i + 1], t - i);
    };
    const piece = (t0, t1) => {
      const arr = [ptAt(t0)];
      for (let i = Math.floor(t0) + 1; i <= Math.floor(t1 - 1e-9); i++) arr.push({ ...pts[i] });
      const end = ptAt(t1);
      if (!GEO.eq(arr[arr.length - 1], end)) arr.push(end);
      return arr;
    };
    const out = [];
    if (lo !== null) {
      const a = piece(0, lo);
      if (a.length >= 2) out.push(makeEntity('polyline', { pts: a, closed: false, ...props }));
    }
    if (hi !== null) {
      const a = piece(hi, nSeg);
      if (a.length >= 2) out.push(makeEntity('polyline', { pts: a, closed: false, ...props }));
    }
    app.doc.checkpoint();
    app.doc.remove([e.id]);
    out.forEach(x => app.doc.add(x));
    return true;
  }

  app.print(`Cannot trim a ${e.type}.`);
  return false;
}

function filletLines(app, e1, pick1, e2, pick2, r) {
  const X = GEO.lineLine(e1.a, e1.b, e2.a, e2.b);
  if (!X) { app.print('Lines are parallel — cannot fillet.'); return false; }
  // for each line keep the endpoint on the picked side of the intersection
  const keepEnd = (e, pick) => {
    const tX = GEO.lineParam(X, e.a, e.b);
    const tP = GEO.lineParam(pick, e.a, e.b);
    return tP <= tX ? 'a' : 'b';
  };
  const k1 = keepEnd(e1, pick1), k2 = keepEnd(e2, pick2);
  const K1 = e1[k1], K2 = e2[k2];

  app.doc.checkpoint();
  if (r <= 1e-9) {
    if (k1 === 'a') e1.b = { ...X }; else e1.a = { ...X };
    if (k2 === 'a') e2.b = { ...X }; else e2.a = { ...X };
    app.doc._changed();
    return true;
  }
  const u1 = GEO.norm(GEO.sub(K1, X));
  const u2 = GEO.norm(GEO.sub(K2, X));
  const cosT = Math.max(-1, Math.min(1, GEO.dot(u1, u2)));
  const theta = Math.acos(cosT);
  if (theta < 1e-6 || Math.PI - theta < 1e-6) { app.print('Cannot fillet — lines are collinear.'); app.doc.undo(); return false; }
  const t = r / Math.tan(theta / 2);
  if (t > GEO.dist(X, K1) + 1e-9 || t > GEO.dist(X, K2) + 1e-9) {
    app.print('Fillet radius too large for these lines.');
    app.doc.undo();
    return false;
  }
  const T1 = GEO.add(X, GEO.mul(u1, t));
  const T2 = GEO.add(X, GEO.mul(u2, t));
  const C = GEO.add(X, GEO.mul(GEO.norm(GEO.add(u1, u2)), r / Math.sin(theta / 2)));
  if (k1 === 'a') { e1.a = K1; e1.b = T1; } else { e1.a = T1; e1.b = K1; }
  if (k2 === 'a') { e2.a = K2; e2.b = T2; } else { e2.a = T2; e2.b = K2; }
  let a0 = GEO.ang(C, T1), a1 = GEO.ang(C, T2);
  if (GEO.sweep(a0, a1) > Math.PI) { const tmp = a0; a0 = a1; a1 = tmp; }
  app.doc.add(makeEntity('arc', { c: C, r, a0: GEO.normAng(a0), a1: GEO.normAng(a1), layer: e1.layer, color: e1.color }));
  return true;
}

/* ================= tools ================= */

const TOOLS = {};

TOOLS.select = () => ({
  name: 'select',
  gripDrag: null, // { id, idx } while dragging a grip of a selected entity
  start(app) { app.prompt('Command:'); },
  click(app, pt, ev) {
    if (this.gripDrag) {
      this._applyGrip(app, pt);
      this._commitGrip(app);
      return;
    }
    // grab a grip of a selected entity if the pickbox is on one
    if (app.doc.selection.size) {
      const tol = app.pickTol();
      for (const e of app.doc.selectedEntities()) {
        const gs = ENT.grips(e);
        for (let i = 0; i < gs.length; i++) {
          if (GEO.dist(gs[i].pt, app.pointer.raw) <= tol) {
            app.doc.checkpoint();
            this.gripDrag = { id: e.id, idx: i };
            app.prompt('Specify new grip position:');
            return;
          }
        }
      }
    }
    SEL.click(app, ev);
  },
  _applyGrip(app, pt) {
    const e = app.doc.get(this.gripDrag.id);
    if (!e) return;
    const g = ENT.grips(e)[this.gripDrag.idx];
    if (g) g.apply(pt);
  },
  _commitGrip(app) {
    this.gripDrag = null;
    app.doc._changed();
    app.prompt('Command:');
  },
  cancelGrip(app) {
    if (!this.gripDrag) return false;
    this.gripDrag = null;
    app.doc.undo();
    app.prompt('Command:');
    return true;
  },
  move(app) {
    if (this.gripDrag) { this._applyGrip(app, app.pointer.snapped); return; }
    SEL.move(app);
  },
  up(app) {
    if (this.gripDrag) {
      // drag style: commit on release if the mouse travelled
      if (app.downScreen) {
        const d = Math.hypot(app.pointer.screen.x - app.downScreen.x, app.pointer.screen.y - app.downScreen.y);
        if (d > 6) { this._applyGrip(app, app.pointer.snapped); this._commitGrip(app); }
      }
      return;
    }
    SEL.up(app, app.downScreen);
  },
  input(app, raw) { return false; },
});

TOOLS.pan = () => ({
  name: 'pan',
  panTool: true,
  start(app) { app.prompt('PAN — drag to pan, Esc to exit.'); },
});

TOOLS.line = () => ({
  name: 'line',
  pts: [],
  start(app) { this.pts = []; app.prompt('LINE — Specify first point:'); },
  click(app, pt) {
    if (!this.pts.length) {
      this.pts.push(pt);
      app.prompt('Specify next point or [Close/Undo]:');
    } else {
      const prev = this.pts[this.pts.length - 1];
      if (GEO.eq(prev, pt)) return;
      app.doc.checkpoint();
      app.doc.add(makeEntity('line', { a: { ...prev }, b: { ...pt }, layer: app.doc.currentLayer }));
      this.pts.push(pt);
    }
    app.lastPoint = pt;
  },
  input(app, raw) {
    const u = raw.toLowerCase();
    if (u === '') { app.endTool(); return true; }
    if (u === 'c' && this.pts.length > 2) {
      app.doc.checkpoint();
      app.doc.add(makeEntity('line', { a: { ...this.pts[this.pts.length - 1] }, b: { ...this.pts[0] }, layer: app.doc.currentLayer }));
      app.endTool();
      return true;
    }
    if (u === 'u' && this.pts.length > 1) {
      app.doc.undo();
      this.pts.pop();
      app.lastPoint = this.pts[this.pts.length - 1];
      return true;
    }
    return false;
  },
  preview(ctx, app) {
    if (!this.pts.length) return;
    RENDER.previewEntity(ctx, app.vp, { type: 'line', a: this.pts[this.pts.length - 1], b: app.pointer.snapped });
  },
});

TOOLS.polyline = () => ({
  name: 'polyline',
  pts: [],
  start(app) { this.pts = []; app.prompt('PLINE — Specify first point:'); },
  click(app, pt) {
    if (this.pts.length && GEO.eq(this.pts[this.pts.length - 1], pt)) return;
    this.pts.push(pt);
    app.lastPoint = pt;
    app.prompt('Specify next point or [Close/Undo], Enter to finish:');
  },
  _finish(app, closed) {
    if (this.pts.length >= 2) {
      app.doc.checkpoint();
      app.doc.add(makeEntity('polyline', {
        pts: this.pts.map(p => ({ ...p })), closed: !!closed, layer: app.doc.currentLayer,
      }));
    }
    app.endTool();
  },
  input(app, raw) {
    const u = raw.toLowerCase();
    if (u === '') { this._finish(app, false); return true; }
    if (u === 'c' && this.pts.length > 2) { this._finish(app, true); return true; }
    if (u === 'u' && this.pts.length) {
      this.pts.pop();
      app.lastPoint = this.pts.length ? this.pts[this.pts.length - 1] : null;
      return true;
    }
    return false;
  },
  preview(ctx, app) {
    if (!this.pts.length) return;
    RENDER.previewEntity(ctx, app.vp, { type: 'polyline', pts: [...this.pts, app.pointer.snapped], closed: false });
  },
});

TOOLS.circle = () => ({
  name: 'circle',
  stage: 'center',
  c: null, p1: null, p2: null,
  start(app) { app.prompt('CIRCLE — Specify center point or [2P/3P]:'); },
  click(app, pt) {
    if (this.stage === 'center') {
      this.c = pt; app.lastPoint = pt;
      this.stage = 'radius';
      app.prompt('Specify radius:');
    } else if (this.stage === 'radius') {
      this._make(app, this.c, GEO.dist(this.c, pt));
    } else if (this.stage === '2p1') {
      this.p1 = pt; app.lastPoint = pt;
      this.stage = '2p2';
      app.prompt('Specify second end of diameter:');
    } else if (this.stage === '2p2') {
      this._make(app, GEO.mid(this.p1, pt), GEO.dist(this.p1, pt) / 2);
    } else if (this.stage === '3p1') {
      this.p1 = pt; app.lastPoint = pt;
      this.stage = '3p2';
      app.prompt('Specify second point on circle:');
    } else if (this.stage === '3p2') {
      this.p2 = pt; app.lastPoint = pt;
      this.stage = '3p3';
      app.prompt('Specify third point on circle:');
    } else if (this.stage === '3p3') {
      const a = GEO.arc3pt(this.p1, this.p2, pt);
      if (!a) { app.print('Points are collinear.'); return; }
      this._make(app, a.c, a.r);
    }
  },
  _make(app, c, r) {
    if (r <= 1e-9) { app.print('Radius must be positive.'); return; }
    app.doc.checkpoint();
    app.doc.add(makeEntity('circle', { c: { ...c }, r, layer: app.doc.currentLayer }));
    app.endTool();
  },
  input(app, raw) {
    const u = raw.toLowerCase();
    if (u === '2p' && this.stage === 'center') {
      this.stage = '2p1';
      app.prompt('Specify first end of diameter:');
      return true;
    }
    if (u === '3p' && this.stage === 'center') {
      this.stage = '3p1';
      app.prompt('Specify first point on circle:');
      return true;
    }
    if (this.stage === 'radius') {
      const n = parseDist(raw);
      if (n !== null) { this._make(app, this.c, n); return true; }
    }
    if (u === '') { app.endTool(); return true; }
    return false;
  },
  preview(ctx, app) {
    const p = app.pointer.snapped;
    if (this.stage === 'radius') {
      RENDER.previewEntity(ctx, app.vp, { type: 'circle', c: this.c, r: GEO.dist(this.c, p) });
      RENDER.previewEntity(ctx, app.vp, { type: 'line', a: this.c, b: p });
    } else if (this.stage === '2p2') {
      RENDER.previewEntity(ctx, app.vp, { type: 'circle', c: GEO.mid(this.p1, p), r: GEO.dist(this.p1, p) / 2 });
    } else if (this.stage === '3p2') {
      RENDER.previewEntity(ctx, app.vp, { type: 'line', a: this.p1, b: p });
    } else if (this.stage === '3p3') {
      const a = GEO.arc3pt(this.p1, this.p2, p);
      if (a) RENDER.previewEntity(ctx, app.vp, { type: 'circle', c: a.c, r: a.r });
    }
  },
});

TOOLS.arc = () => ({
  name: 'arc',
  stage: 'p1',
  p1: null, p2: null, c: null, r: 0, a0: 0,
  start(app) { app.prompt('ARC — Specify start point or [CEnter]:'); },
  click(app, pt) {
    app.lastPoint = pt;
    switch (this.stage) {
      case 'p1': this.p1 = pt; this.stage = 'p2'; app.prompt('Specify second point on arc:'); break;
      case 'p2': this.p2 = pt; this.stage = 'p3'; app.prompt('Specify end point:'); break;
      case 'p3': {
        const a = GEO.arc3pt(this.p1, this.p2, pt);
        if (!a) { app.print('Points are collinear.'); return; }
        app.doc.checkpoint();
        app.doc.add(makeEntity('arc', { c: a.c, r: a.r, a0: a.a0, a1: a.a1, layer: app.doc.currentLayer }));
        app.endTool();
        break;
      }
      case 'cen': this.c = pt; this.stage = 'cstart'; app.prompt('Specify start point:'); break;
      case 'cstart':
        this.r = GEO.dist(this.c, pt);
        if (this.r <= 1e-9) { app.print('Radius must be positive.'); return; }
        this.a0 = GEO.ang(this.c, pt);
        this.stage = 'cend';
        app.prompt('Specify end angle (CCW):');
        break;
      case 'cend': {
        const a1 = GEO.ang(this.c, pt);
        app.doc.checkpoint();
        app.doc.add(makeEntity('arc', { c: { ...this.c }, r: this.r, a0: GEO.normAng(this.a0), a1: GEO.normAng(a1), layer: app.doc.currentLayer }));
        app.endTool();
        break;
      }
    }
  },
  input(app, raw) {
    const u = raw.toLowerCase();
    if ((u === 'ce' || u === 'c') && this.stage === 'p1') {
      this.stage = 'cen';
      app.prompt('Specify center point:');
      return true;
    }
    if (u === '') { app.endTool(); return true; }
    return false;
  },
  preview(ctx, app) {
    const p = app.pointer.snapped;
    if (this.stage === 'p2') RENDER.previewEntity(ctx, app.vp, { type: 'line', a: this.p1, b: p });
    else if (this.stage === 'p3') {
      const a = GEO.arc3pt(this.p1, this.p2, p);
      if (a) RENDER.previewEntity(ctx, app.vp, { type: 'arc', c: a.c, r: a.r, a0: a.a0, a1: a.a1 });
      else RENDER.previewEntity(ctx, app.vp, { type: 'polyline', pts: [this.p1, this.p2, p], closed: false });
    } else if (this.stage === 'cstart') RENDER.previewEntity(ctx, app.vp, { type: 'line', a: this.c, b: p });
    else if (this.stage === 'cend') {
      RENDER.previewEntity(ctx, app.vp, { type: 'arc', c: this.c, r: this.r, a0: GEO.normAng(this.a0), a1: GEO.normAng(GEO.ang(this.c, p)) });
    }
  },
});

TOOLS.rectangle = () => ({
  name: 'rectangle',
  c1: null,
  start(app) { app.prompt('RECTANG — Specify first corner:'); },
  click(app, pt) {
    if (!this.c1) {
      this.c1 = pt; app.lastPoint = pt;
      app.prompt('Specify opposite corner:');
    } else {
      if (Math.abs(pt.x - this.c1.x) < 1e-9 || Math.abs(pt.y - this.c1.y) < 1e-9) {
        app.print('Degenerate rectangle.');
        return;
      }
      app.doc.checkpoint();
      app.doc.add(makeEntity('polyline', {
        pts: [{ ...this.c1 }, { x: pt.x, y: this.c1.y }, { ...pt }, { x: this.c1.x, y: pt.y }],
        closed: true, layer: app.doc.currentLayer,
      }));
      app.endTool();
    }
  },
  input(app, raw) { if (raw === '') { app.endTool(); return true; } return false; },
  preview(ctx, app) {
    if (!this.c1) return;
    const p = app.pointer.snapped;
    RENDER.previewEntity(ctx, app.vp, {
      type: 'polyline',
      pts: [this.c1, { x: p.x, y: this.c1.y }, p, { x: this.c1.x, y: p.y }],
      closed: true,
    });
  },
});

TOOLS.polygon = () => ({
  name: 'polygon',
  stage: 'sides',
  n: 6, c: null,
  start(app) { app.prompt('POLYGON — Number of sides <6>:'); },
  click(app, pt) {
    if (this.stage === 'center') {
      this.c = pt; app.lastPoint = pt;
      this.stage = 'vertex';
      app.prompt('Specify radius (vertex point) or type radius:');
    } else if (this.stage === 'vertex') {
      this._make(app, GEO.dist(this.c, pt), GEO.ang(this.c, pt));
    }
  },
  _make(app, r, startAng) {
    if (r <= 1e-9) { app.print('Radius must be positive.'); return; }
    const pts = [];
    for (let i = 0; i < this.n; i++) pts.push(GEO.polar(this.c, startAng + i * 2 * Math.PI / this.n, r));
    app.doc.checkpoint();
    app.doc.add(makeEntity('polyline', { pts, closed: true, layer: app.doc.currentLayer }));
    app.endTool();
  },
  input(app, raw) {
    if (this.stage === 'sides') {
      if (raw === '') { this.stage = 'center'; app.prompt('Specify center point:'); return true; }
      const n = parseInt(raw, 10);
      if (n >= 3 && n <= 1024) { this.n = n; this.stage = 'center'; app.prompt('Specify center point:'); return true; }
      app.print('Enter a number between 3 and 1024.');
      return true;
    }
    if (this.stage === 'vertex') {
      const r = parseDist(raw);
      if (r !== null) { this._make(app, r, Math.PI / 2); return true; }
    }
    if (raw === '') { app.endTool(); return true; }
    return false;
  },
  preview(ctx, app) {
    if (this.stage !== 'vertex') return;
    const p = app.pointer.snapped;
    const r = GEO.dist(this.c, p), a = GEO.ang(this.c, p);
    if (r <= 1e-9) return;
    const pts = [];
    for (let i = 0; i < this.n; i++) pts.push(GEO.polar(this.c, a + i * 2 * Math.PI / this.n, r));
    RENDER.previewEntity(ctx, app.vp, { type: 'polyline', pts, closed: true });
  },
});

TOOLS.point = () => ({
  name: 'point',
  start(app) { app.prompt('POINT — Specify a point (Esc to finish):'); },
  click(app, pt) {
    app.doc.checkpoint();
    app.doc.add(makeEntity('point', { p: { ...pt }, layer: app.doc.currentLayer }));
    app.lastPoint = pt;
  },
  input(app, raw) { if (raw === '') { app.endTool(); return true; } return false; },
});

TOOLS.text = () => ({
  name: 'text',
  stage: 'point',
  p: null, height: null,
  rawInput: false,
  start(app) { app.prompt('TEXT — Specify insertion point:'); },
  click(app, pt) {
    if (this.stage === 'point') {
      this.p = pt; app.lastPoint = pt;
      this.stage = 'height';
      app.prompt(`Specify height <${fmt(app.doc.settings.textHeight)}>:`);
    }
  },
  input(app, raw) {
    if (this.stage === 'height') {
      const h = raw === '' ? app.doc.settings.textHeight : parseDist(raw);
      if (h === null || Number.isNaN(h) || h <= 0) { app.print('Invalid height.'); return true; }
      this.height = h;
      app.doc.settings.textHeight = h;
      this.stage = 'text';
      this.rawInput = true;
      app.prompt('Enter text:');
      return true;
    }
    if (this.stage === 'text') {
      if (raw !== '') {
        app.doc.checkpoint();
        app.doc.add(makeEntity('text', { p: { ...this.p }, text: raw, height: this.height, rotation: 0, layer: app.doc.currentLayer }));
      }
      app.endTool();
      return true;
    }
    if (raw === '') { app.endTool(); return true; }
    return false;
  },
  preview(ctx, app) {
    if (this.stage === 'text') {
      RENDER.previewEntity(ctx, app.vp, { type: 'line', a: this.p, b: GEO.add(this.p, { x: this.height * 4, y: 0 }) });
    }
  },
});

function makeDimTool(name, aligned) {
  return () => ({
    name,
    stage: 'p1',
    p1: null, p2: null,
    start(app) { app.prompt(`${name.toUpperCase()} — Specify first extension line origin:`); },
    _dtype(p3) {
      if (aligned) return 'aligned';
      const mid = GEO.mid(this.p1, this.p2);
      return Math.abs(p3.y - mid.y) >= Math.abs(p3.x - mid.x) ? 'linear-h' : 'linear-v';
    },
    click(app, pt) {
      if (this.stage === 'p1') {
        this.p1 = pt; app.lastPoint = pt;
        this.stage = 'p2';
        app.prompt('Specify second extension line origin:');
      } else if (this.stage === 'p2') {
        if (GEO.eq(this.p1, pt)) return;
        this.p2 = pt; app.lastPoint = pt;
        this.stage = 'place';
        app.prompt('Specify dimension line location:');
      } else {
        app.doc.checkpoint();
        const dim = app.doc.add(makeEntity('dim', {
          dtype: this._dtype(pt), p1: { ...this.p1 }, p2: { ...this.p2 }, p3: { ...pt },
          layer: app.doc.currentLayer,
        }));
        app.lastDimId = dim.id;
        app.endTool();
      }
    },
    input(app, raw) { if (raw === '') { app.endTool(); return true; } return false; },
    preview(ctx, app) {
      const p = app.pointer.snapped;
      if (this.stage === 'p2') RENDER.previewEntity(ctx, app.vp, { type: 'line', a: this.p1, b: p });
      else if (this.stage === 'place') {
        RENDER.previewEntity(ctx, app.vp, { type: 'dim', dtype: this._dtype(p), p1: this.p1, p2: this.p2, p3: p });
      }
    },
  });
}
TOOLS.dimlinear = makeDimTool('dimlinear', false);
TOOLS.dimaligned = makeDimTool('dimaligned', true);

TOOLS.dist = () => ({
  name: 'dist',
  p1: null,
  start(app) { app.prompt('DIST — Specify first point:'); },
  click(app, pt) {
    if (!this.p1) {
      this.p1 = pt; app.lastPoint = pt;
      app.prompt('Specify second point:');
    } else {
      const d = GEO.dist(this.p1, pt);
      app.print(`Distance = ${fmtLen(d)},  ΔX = ${fmtLen(pt.x - this.p1.x)},  ΔY = ${fmtLen(pt.y - this.p1.y)},  Angle = ${fmt(degOf(GEO.ang(this.p1, pt)))}°`);
      app.endTool();
    }
  },
  input(app, raw) { if (raw === '') { app.endTool(); return true; } return false; },
  preview(ctx, app) {
    if (this.p1) RENDER.previewEntity(ctx, app.vp, { type: 'line', a: this.p1, b: app.pointer.snapped });
  },
});

TOOLS.move = () => ({
  name: 'move', label: 'MOVE',
  stage: null, base: null,
  start(app) { startModify(app, this); },
  begin(app) { this.stage = 'base'; app.prompt('MOVE — Specify base point:'); },
  click(app, pt, ev) {
    if (this.stage === 'acquire') { acquireClick(app, this, ev); return; }
    if (this.stage === 'base') {
      this.base = pt; app.lastPoint = pt;
      this.stage = 'dest';
      app.prompt('Specify second point:');
    } else if (this.stage === 'dest') {
      app.doc.checkpoint();
      const xf = ENT.xfTranslate(GEO.sub(pt, this.base));
      for (const e of app.doc.selectedEntities()) ENT.transform(e, xf);
      app.doc._changed();
      app.print(`${app.doc.selection.size} object(s) moved.`);
      app.endTool();
    }
  },
  move(app) { if (this.stage === 'acquire') SEL.move(app); },
  up(app) { if (this.stage === 'acquire') SEL.up(app, app.downScreen); },
  input(app, raw) {
    if (this.stage === 'acquire') return acquireInput(app, this, raw);
    if (raw === '') { app.endTool(); return true; }
    return false;
  },
  preview(ctx, app) {
    if (this.stage !== 'dest') return;
    const d = GEO.sub(app.pointer.snapped, this.base);
    ghostSelection(ctx, app, ENT.xfTranslate(d));
    RENDER.previewEntity(ctx, app.vp, { type: 'line', a: this.base, b: app.pointer.snapped });
  },
});

TOOLS.copy = () => ({
  name: 'copy', label: 'COPY',
  stage: null, base: null, count: 0,
  start(app) { startModify(app, this); },
  begin(app) { this.stage = 'base'; app.prompt('COPY — Specify base point:'); },
  click(app, pt, ev) {
    if (this.stage === 'acquire') { acquireClick(app, this, ev); return; }
    if (this.stage === 'base') {
      this.base = pt; app.lastPoint = pt;
      this.stage = 'dest';
      app.prompt('Specify second point (Enter to finish):');
    } else if (this.stage === 'dest') {
      app.doc.checkpoint();
      const xf = ENT.xfTranslate(GEO.sub(pt, this.base));
      for (const e of app.doc.selectedEntities()) {
        const c = ENT.transformed(e, xf);
        c.id = nextEntityId();
        app.doc.add(c);
      }
      this.count++;
      app.print(`Copy placed (${this.count}).`);
    }
  },
  move(app) { if (this.stage === 'acquire') SEL.move(app); },
  up(app) { if (this.stage === 'acquire') SEL.up(app, app.downScreen); },
  input(app, raw) {
    if (this.stage === 'acquire') return acquireInput(app, this, raw);
    if (raw === '') { app.endTool(); return true; }
    return false;
  },
  preview(ctx, app) {
    if (this.stage !== 'dest') return;
    ghostSelection(ctx, app, ENT.xfTranslate(GEO.sub(app.pointer.snapped, this.base)));
    RENDER.previewEntity(ctx, app.vp, { type: 'line', a: this.base, b: app.pointer.snapped });
  },
});

TOOLS.rotate = () => ({
  name: 'rotate', label: 'ROTATE',
  stage: null, base: null, refAng: 0, refP1: null,
  start(app) { startModify(app, this); },
  begin(app) { this.stage = 'base'; app.prompt('ROTATE — Specify base point:'); },
  _apply(app, ang) {
    app.doc.checkpoint();
    const xf = ENT.xfRotate(this.base, ang);
    for (const e of app.doc.selectedEntities()) ENT.transform(e, xf);
    app.doc._changed();
    app.print(`Rotated ${fmt(degOf(ang))}°.`);
    app.endTool();
  },
  click(app, pt, ev) {
    if (this.stage === 'acquire') { acquireClick(app, this, ev); return; }
    if (this.stage === 'base') {
      this.base = pt; app.lastPoint = pt;
      this.stage = 'angle';
      app.prompt('Specify rotation angle (degrees), pick a point, or [Reference]:');
    } else if (this.stage === 'angle') {
      this._apply(app, GEO.ang(this.base, pt));
    } else if (this.stage === 'ref1') {
      this.refP1 = pt; app.lastPoint = pt;
      this.stage = 'ref2';
      app.prompt('Specify second point of reference angle:');
    } else if (this.stage === 'ref2') {
      this.refAng = GEO.ang(this.refP1, pt);
      this.stage = 'newang';
      app.prompt('Specify new angle (degrees or pick a point):');
    } else if (this.stage === 'newang') {
      this._apply(app, GEO.ang(this.base, pt) - this.refAng);
    }
  },
  move(app) { if (this.stage === 'acquire') SEL.move(app); },
  up(app) { if (this.stage === 'acquire') SEL.up(app, app.downScreen); },
  input(app, raw) {
    if (this.stage === 'acquire') return acquireInput(app, this, raw);
    const u = raw.toLowerCase();
    if (this.stage === 'angle' && (u === 'r' || u === 'reference')) {
      this.stage = 'ref1';
      app.prompt('Specify reference angle (degrees) or first point:');
      return true;
    }
    if (this.stage === 'ref1' && raw !== '') {
      const n = parseFloat(raw);
      if (!Number.isNaN(n)) {
        this.refAng = n * Math.PI / 180;
        this.stage = 'newang';
        app.prompt('Specify new angle (degrees or pick a point):');
        return true;
      }
    }
    if (this.stage === 'newang' && raw !== '') {
      const n = parseFloat(raw);
      if (!Number.isNaN(n)) { this._apply(app, n * Math.PI / 180 - this.refAng); return true; }
    }
    if (this.stage === 'angle' && raw !== '') {
      const n = parseFloat(raw);
      if (!Number.isNaN(n)) { this._apply(app, n * Math.PI / 180); return true; }
    }
    if (raw === '') { app.endTool(); return true; }
    return false;
  },
  preview(ctx, app) {
    if (this.stage === 'angle' || this.stage === 'newang') {
      const ang = GEO.ang(this.base, app.pointer.snapped) - (this.stage === 'newang' ? this.refAng : 0);
      ghostSelection(ctx, app, ENT.xfRotate(this.base, ang));
      RENDER.previewEntity(ctx, app.vp, { type: 'line', a: this.base, b: app.pointer.snapped });
    } else if (this.stage === 'ref2') {
      RENDER.previewEntity(ctx, app.vp, { type: 'line', a: this.refP1, b: app.pointer.snapped });
    }
  },
});

TOOLS.scale = () => ({
  name: 'scale', label: 'SCALE',
  stage: null, base: null, refLen: 1, refP1: null,
  start(app) { startModify(app, this); },
  begin(app) { this.stage = 'base'; app.prompt('SCALE — Specify base point:'); },
  _apply(app, f) {
    if (!(f > 1e-9)) { app.print('Scale factor must be positive.'); return; }
    app.doc.checkpoint();
    const xf = ENT.xfScale(this.base, f);
    for (const e of app.doc.selectedEntities()) ENT.transform(e, xf);
    app.doc._changed();
    app.print(`Scaled by ${fmt(f)}.`);
    app.endTool();
  },
  click(app, pt, ev) {
    if (this.stage === 'acquire') { acquireClick(app, this, ev); return; }
    if (this.stage === 'base') {
      this.base = pt; app.lastPoint = pt;
      this.stage = 'factor';
      app.prompt('Specify scale factor (number, pick a point, or [Reference]):');
    } else if (this.stage === 'factor') {
      this._apply(app, GEO.dist(this.base, pt));
    } else if (this.stage === 'ref1') {
      this.refP1 = pt; app.lastPoint = pt;
      this.stage = 'ref2';
      app.prompt('Specify second point of reference length:');
    } else if (this.stage === 'ref2') {
      const d = GEO.dist(this.refP1, pt);
      if (d <= 1e-9) { app.print('Reference length must be positive.'); return; }
      this.refLen = d;
      this.stage = 'newlen';
      app.prompt(`Specify new length <ref ${fmtLen(this.refLen)}>:`);
    } else if (this.stage === 'newlen') {
      this._apply(app, GEO.dist(this.base, pt) / this.refLen);
    }
  },
  move(app) { if (this.stage === 'acquire') SEL.move(app); },
  up(app) { if (this.stage === 'acquire') SEL.up(app, app.downScreen); },
  input(app, raw) {
    if (this.stage === 'acquire') return acquireInput(app, this, raw);
    const u = raw.toLowerCase();
    if (this.stage === 'factor' && (u === 'r' || u === 'reference')) {
      this.stage = 'ref1';
      app.prompt('Specify reference length (number) or first point:');
      return true;
    }
    if (this.stage === 'ref1' && raw !== '') {
      const n = parseDist(raw);
      if (n !== null && n > 0) {
        this.refLen = n;
        this.stage = 'newlen';
        app.prompt(`Specify new length <ref ${fmtLen(n)}>:`);
        return true;
      }
    }
    if (this.stage === 'newlen' && raw !== '') {
      const n = parseDist(raw);
      if (n !== null && n > 0) { this._apply(app, n / this.refLen); return true; }
    }
    if (this.stage === 'factor' && raw !== '') {
      const n = parseFloat(raw);
      if (!Number.isNaN(n)) { this._apply(app, n); return true; }
    }
    if (raw === '') { app.endTool(); return true; }
    return false;
  },
  preview(ctx, app) {
    if (this.stage === 'factor') {
      const f = GEO.dist(this.base, app.pointer.snapped);
      if (f > 1e-9) ghostSelection(ctx, app, ENT.xfScale(this.base, f));
    } else if (this.stage === 'newlen') {
      const f = GEO.dist(this.base, app.pointer.snapped) / this.refLen;
      if (f > 1e-9) ghostSelection(ctx, app, ENT.xfScale(this.base, f));
    } else if (this.stage === 'ref2') {
      RENDER.previewEntity(ctx, app.vp, { type: 'line', a: this.refP1, b: app.pointer.snapped });
    }
  },
});

TOOLS.mirror = () => ({
  name: 'mirror', label: 'MIRROR',
  stage: null, m1: null, m2: null,
  start(app) { startModify(app, this); },
  begin(app) { this.stage = 'm1'; app.prompt('MIRROR — Specify first point of mirror line:'); },
  click(app, pt, ev) {
    if (this.stage === 'acquire') { acquireClick(app, this, ev); return; }
    if (this.stage === 'm1') {
      this.m1 = pt; app.lastPoint = pt;
      this.stage = 'm2';
      app.prompt('Specify second point of mirror line:');
    } else if (this.stage === 'm2') {
      if (GEO.eq(this.m1, pt)) return;
      this.m2 = pt;
      this.stage = 'erase';
      app.prompt('Erase source objects? [Yes/No] <N>:');
    }
  },
  move(app) { if (this.stage === 'acquire') SEL.move(app); },
  up(app) { if (this.stage === 'acquire') SEL.up(app, app.downScreen); },
  _apply(app, erase) {
    app.doc.checkpoint();
    const xf = ENT.xfMirror(this.m1, this.m2);
    const sel = app.doc.selectedEntities();
    for (const e of sel) {
      const c = ENT.transformed(e, xf);
      c.id = nextEntityId();
      app.doc.add(c);
    }
    if (erase) app.doc.remove(sel.map(e => e.id));
    app.print(`Mirrored ${sel.length} object(s)${erase ? ', source erased' : ''}.`);
    app.endTool();
  },
  input(app, raw) {
    if (this.stage === 'acquire') return acquireInput(app, this, raw);
    if (this.stage === 'erase') {
      const u = raw.toLowerCase();
      if (u === 'y' || u === 'yes') { this._apply(app, true); return true; }
      this._apply(app, false);
      return true;
    }
    if (raw === '') { app.endTool(); return true; }
    return false;
  },
  preview(ctx, app) {
    if (this.stage === 'm2') {
      const p = app.pointer.snapped;
      if (!GEO.eq(this.m1, p)) ghostSelection(ctx, app, ENT.xfMirror(this.m1, p));
      RENDER.previewEntity(ctx, app.vp, { type: 'line', a: this.m1, b: p });
    } else if (this.stage === 'erase') {
      ghostSelection(ctx, app, ENT.xfMirror(this.m1, this.m2));
      RENDER.previewEntity(ctx, app.vp, { type: 'line', a: this.m1, b: this.m2 });
    }
  },
});

TOOLS.offset = () => ({
  name: 'offset',
  stage: 'dist',
  d: 0, target: null,
  start(app) {
    this.d = app.doc.settings.offsetDist;
    app.prompt(`OFFSET — Specify distance <${fmt(this.d)}>:`);
  },
  click(app, pt) {
    if (this.stage === 'pick') {
      const e = SEL.hitAt(app, app.pointer.raw);
      if (!e) { app.print('No object found.'); return; }
      if (!['line', 'circle', 'arc', 'polyline'].includes(e.type)) { app.print(`Cannot offset a ${e.type}.`); return; }
      this.target = e;
      this.stage = 'side';
      app.prompt('Specify point on side to offset:');
    } else if (this.stage === 'side') {
      const out = offsetEntity(this.target, this.d, pt);
      if (!out) { app.print('Cannot offset (result would be degenerate).'); }
      else {
        app.doc.checkpoint();
        app.doc.add(out);
      }
      this.target = null;
      this.stage = 'pick';
      app.prompt('Select object to offset (Enter to finish):');
    }
  },
  input(app, raw) {
    if (this.stage === 'dist') {
      if (raw !== '') {
        const n = parseDist(raw);
        if (n === null || n <= 0) { app.print('Distance must be a positive number.'); return true; }
        this.d = n;
        app.doc.settings.offsetDist = n;
      }
      this.stage = 'pick';
      app.prompt('Select object to offset (Enter to finish):');
      return true;
    }
    if (raw === '') { app.endTool(); return true; }
    return false;
  },
  preview(ctx, app) {
    if (this.stage === 'side' && this.target) {
      const out = offsetEntity(this.target, this.d, app.pointer.snapped);
      if (out) RENDER.previewEntity(ctx, app.vp, out);
    }
  },
});

TOOLS.trim = () => ({
  name: 'trim',
  start(app) { app.prompt('TRIM — Click the part to remove (all objects are cutting edges, Enter to finish):'); },
  click(app, pt) {
    const e = SEL.hitAt(app, app.pointer.raw);
    if (!e) { app.print('No object found.'); return; }
    trimEntity(app, e, app.pointer.raw);
  },
  input(app, raw) { if (raw === '') { app.endTool(); return true; } return false; },
});

TOOLS.fillet = () => ({
  name: 'fillet',
  stage: 'first',
  e1: null, pick1: null,
  start(app) {
    app.prompt(`FILLET — Select first line or [Radius] (r=${fmt(app.doc.settings.filletRadius)}):`);
  },
  click(app, pt) {
    if (this.stage === 'radius') return;
    const e = SEL.hitAt(app, app.pointer.raw);
    if (!e) { app.print('No object found.'); return; }
    if (e.type !== 'line') { app.print('Fillet currently supports lines only.'); return; }
    if (this.stage === 'first') {
      this.e1 = e;
      this.pick1 = app.pointer.raw;
      this.stage = 'second';
      app.prompt('Select second line:');
    } else if (this.stage === 'second') {
      if (e.id === this.e1.id) { app.print('Select a different line.'); return; }
      if (filletLines(app, this.e1, this.pick1, e, app.pointer.raw, app.doc.settings.filletRadius)) {
        app.endTool();
      }
    }
  },
  input(app, raw) {
    const u = raw.toLowerCase();
    if (this.stage === 'first' && (u === 'r' || u === 'radius')) {
      this.stage = 'radius';
      app.prompt(`Specify fillet radius <${fmt(app.doc.settings.filletRadius)}>:`);
      return true;
    }
    if (this.stage === 'radius') {
      if (raw !== '') {
        const n = parseDist(raw);
        if (n === null || n < 0) { app.print('Radius must be >= 0.'); return true; }
        app.doc.settings.filletRadius = n;
      }
      this.stage = 'first';
      app.prompt(`Select first line or [Radius] (r=${fmt(app.doc.settings.filletRadius)}):`);
      return true;
    }
    if (raw === '') { app.endTool(); return true; }
    return false;
  },
});

function makeImmediateTool(name, label, apply) {
  return () => ({
    name, label,
    stage: null,
    start(app) {
      if (app.doc.selection.size) { apply(app); app.endTool(); }
      else {
        this.stage = 'acquire';
        app.prompt(`${label} — Select objects, then Enter:`);
      }
    },
    click(app, pt, ev) { if (this.stage === 'acquire') acquireClick(app, this, ev); },
    move(app) { if (this.stage === 'acquire') SEL.move(app); },
    up(app) { if (this.stage === 'acquire') SEL.up(app, app.downScreen); },
    begin(app) { apply(app); app.endTool(); },
    input(app, raw) {
      if (this.stage === 'acquire') return acquireInput(app, this, raw);
      if (raw === '') { app.endTool(); return true; }
      return false;
    },
  });
}

TOOLS.erase = makeImmediateTool('erase', 'ERASE', (app) => {
  const n = app.doc.selection.size;
  app.doc.checkpoint();
  app.doc.remove(app.doc.selection);
  app.print(`${n} object(s) erased.`);
  app.onSelectionChange();
});

TOOLS.explode = makeImmediateTool('explode', 'EXPLODE', (app) => {
  const sel = app.doc.selectedEntities();
  const jobs = sel.map(e => [e, ENT.explode(e)]).filter(j => j[1]);
  if (!jobs.length) { app.print('Nothing to explode (polylines and dimensions only).'); return; }
  app.doc.checkpoint();
  for (const [e, parts] of jobs) {
    app.doc.remove([e.id]);
    parts.forEach(p => app.doc.add(p));
  }
  app.print(`${jobs.length} object(s) exploded.`);
  app.onSelectionChange();
});

/* ================= extend ================= */

// candidate params on the infinite line a->b from intersections with other entities
function lineBoundaryParams(app, selfId, a, b) {
  const ts = [];
  for (const other of app.doc.entities) {
    if (other.id === selfId || !app.doc.visible(other)) continue;
    const pr = ENT.prims(other);
    for (const s of pr.segs) {
      const X = GEO.lineLine(a, b, s[0], s[1]);
      if (!X) continue;
      const u = GEO.lineParam(X, s[0], s[1]);
      if (u >= -1e-7 && u <= 1 + 1e-7) ts.push(GEO.lineParam(X, a, b));
    }
    for (const c of pr.circles) {
      for (const X of GEO.lineCircle(a, b, c.c, c.r)) ts.push(GEO.lineParam(X, a, b));
    }
    for (const ar of pr.arcs) {
      for (const X of GEO.lineCircle(a, b, ar.c, ar.r)) {
        if (GEO.angIn(GEO.ang(ar.c, X), ar.a0, ar.a1, 1e-6)) ts.push(GEO.lineParam(X, a, b));
      }
    }
  }
  return ts;
}

function extendEntity(app, e, clickPt) {
  const eps = 1e-9;

  if (e.type === 'line') {
    const end = GEO.segParam(clickPt, e.a, e.b) < 0.5 ? 'a' : 'b';
    const ts = lineBoundaryParams(app, e.id, e.a, e.b);
    let best = null;
    if (end === 'b') for (const t of ts) { if (t > 1 + eps && (best === null || t < best)) best = t; }
    else for (const t of ts) { if (t < -eps && (best === null || t > best)) best = t; }
    if (best === null) { app.print('No boundary edge found.'); return false; }
    app.doc.checkpoint();
    e[end] = GEO.lerp(e.a, e.b, best);
    app.doc._changed();
    return true;
  }

  if (e.type === 'arc') {
    const full = makeEntity('circle', { c: e.c, r: e.r });
    const sweep = GEO.sweep(e.a0, e.a1);
    const rels = [];
    for (const other of app.doc.entities) {
      if (other.id === e.id || !app.doc.visible(other)) continue;
      for (const p of ENT.intersections(full, other)) {
        const rel = GEO.normAng(GEO.ang(e.c, p) - e.a0);
        if (rel > sweep + 1e-6 && rel < Math.PI * 2 - 1e-6) rels.push(rel);
      }
    }
    if (!rels.length) { app.print('No boundary edge found.'); return false; }
    const relHit = GEO.normAng(GEO.ang(e.c, clickPt) - e.a0);
    const atEnd = relHit > sweep / 2; // closer to the a1 end of the sweep
    app.doc.checkpoint();
    if (atEnd) e.a1 = GEO.normAng(e.a0 + Math.min(...rels));
    else e.a0 = GEO.normAng(e.a0 + Math.max(...rels));
    app.doc._changed();
    return true;
  }

  if (e.type === 'polyline' && !e.closed && e.pts.length >= 2) {
    const pts = e.pts;
    const atStart = GEO.dist(clickPt, pts[0]) < GEO.dist(clickPt, pts[pts.length - 1]);
    const inner = atStart ? pts[1] : pts[pts.length - 2];
    const endPt = atStart ? pts[0] : pts[pts.length - 1];
    const ts = lineBoundaryParams(app, e.id, inner, endPt);
    let best = null;
    for (const t of ts) { if (t > 1 + eps && (best === null || t < best)) best = t; }
    if (best === null) { app.print('No boundary edge found.'); return false; }
    app.doc.checkpoint();
    const np = GEO.lerp(inner, endPt, best);
    if (atStart) pts[0] = np; else pts[pts.length - 1] = np;
    app.doc._changed();
    return true;
  }

  app.print(`Cannot extend a ${e.type}.`);
  return false;
}

TOOLS.extend = () => ({
  name: 'extend',
  start(app) { app.prompt('EXTEND — Click near the end to extend (all objects are boundaries, Enter to finish):'); },
  click(app) {
    const e = SEL.hitAt(app, app.pointer.raw);
    if (!e) { app.print('No object found.'); return; }
    extendEntity(app, e, app.pointer.raw);
  },
  input(app, raw) { if (raw === '') { app.endTool(); return true; } return false; },
});

/* ================= array ================= */

TOOLS.array = () => ({
  name: 'array', label: 'ARRAY',
  stage: null, mode: null,
  rows: 2, cols: 2, rsp: 10, csp: 10,
  center: null, count: 6, fill: 360,
  start(app) { startModify(app, this); },
  begin(app) { this.stage = 'type'; app.prompt('ARRAY — Type [Rectangular/Polar] <R>:'); },
  click(app, pt, ev) {
    if (this.stage === 'acquire') { acquireClick(app, this, ev); return; }
    if (this.stage === 'center') {
      this.center = pt; app.lastPoint = pt;
      this.stage = 'count';
      app.prompt('Number of items <6>:');
    }
  },
  move(app) { if (this.stage === 'acquire') SEL.move(app); },
  up(app) { if (this.stage === 'acquire') SEL.up(app, app.downScreen); },
  _int(raw, def, min) {
    if (raw === '') return def;
    const n = parseInt(raw, 10);
    return (Number.isNaN(n) || n < min) ? null : n;
  },
  _num(raw, def) {
    if (raw === '') return def;
    const n = parseFloat(raw);
    return Number.isNaN(n) ? null : n;
  },
  input(app, raw) {
    if (this.stage === 'acquire') return acquireInput(app, this, raw);
    const u = raw.toLowerCase();
    switch (this.stage) {
      case 'type':
        if (u === '' || u === 'r' || u === 'rectangular') { this.mode = 'r'; this.stage = 'rows'; app.prompt('Number of rows <2>:'); return true; }
        if (u === 'p' || u === 'polar') { this.mode = 'p'; this.stage = 'center'; app.prompt('Specify center point of array:'); return true; }
        app.print('Enter R or P.');
        return true;
      case 'rows': {
        const n = this._int(raw, 2, 1);
        if (n === null) { app.print('Enter a whole number >= 1.'); return true; }
        this.rows = n; this.stage = 'cols'; app.prompt('Number of columns <2>:');
        return true;
      }
      case 'cols': {
        const n = this._int(raw, 2, 1);
        if (n === null) { app.print('Enter a whole number >= 1.'); return true; }
        if (this.rows * n < 2) { app.print('Array must have more than one item.'); return true; }
        this.cols = n; this.stage = 'rsp'; app.prompt('Distance between rows <10>:');
        return true;
      }
      case 'rsp': {
        const n = raw === '' ? 10 : parseDist(raw);
        if (n === null) { app.print('Enter a distance.'); return true; }
        this.rsp = n; this.stage = 'csp'; app.prompt('Distance between columns <10>:');
        return true;
      }
      case 'csp': {
        const n = raw === '' ? 10 : parseDist(raw);
        if (n === null) { app.print('Enter a distance.'); return true; }
        this.csp = n;
        this._applyRect(app);
        return true;
      }
      case 'count': {
        const n = this._int(raw, 6, 2);
        if (n === null) { app.print('Enter a whole number >= 2.'); return true; }
        this.count = n; this.stage = 'fill'; app.prompt('Angle to fill (degrees, CCW) <360>:');
        return true;
      }
      case 'fill': {
        const n = this._num(raw, 360);
        if (n === null || n === 0) { app.print('Enter a non-zero angle.'); return true; }
        this.fill = n;
        this._applyPolar(app);
        return true;
      }
    }
    if (raw === '') { app.endTool(); return true; }
    return false;
  },
  _applyRect(app) {
    const sel = app.doc.selectedEntities();
    app.doc.checkpoint();
    let made = 0;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (r === 0 && c === 0) continue;
        const xf = ENT.xfTranslate({ x: c * this.csp, y: r * this.rsp });
        for (const e of sel) {
          const cl = ENT.transformed(e, xf);
          cl.id = nextEntityId();
          app.doc.add(cl);
          made++;
        }
      }
    }
    app.print(`Rectangular array: ${made} object(s) created.`);
    app.endTool();
  },
  _applyPolar(app) {
    const sel = app.doc.selectedEntities();
    const full = Math.abs(Math.abs(this.fill) - 360) < 1e-9;
    const step = (full ? this.fill / this.count : this.fill / (this.count - 1)) * Math.PI / 180;
    app.doc.checkpoint();
    let made = 0;
    for (let i = 1; i < this.count; i++) {
      const xf = ENT.xfRotate(this.center, step * i);
      for (const e of sel) {
        const cl = ENT.transformed(e, xf);
        cl.id = nextEntityId();
        app.doc.add(cl);
        made++;
      }
    }
    app.print(`Polar array: ${made} object(s) created.`);
    app.endTool();
  },
});

/* ================= hatch ================= */

TOOLS.hatch = () => ({
  name: 'hatch',
  stage: 'pick',
  boundary: null, pattern: 'lines', spacing: 5, angle: null,
  start(app) { app.prompt('HATCH — Select a closed boundary (circle or closed polyline):'); },
  click(app) {
    if (this.stage !== 'pick') return;
    const e = SEL.hitAt(app, app.pointer.raw);
    if (!e) { app.print('No object found.'); return; }
    if (e.type === 'circle') this.boundary = { kind: 'circle', c: { ...e.c }, r: e.r };
    else if (e.type === 'polyline' && e.closed && e.pts.length > 2) this.boundary = { kind: 'poly', pts: e.pts.map(p => ({ ...p })) };
    else { app.print('Boundary must be a circle or a closed polyline.'); return; }
    this.stage = 'pattern';
    app.prompt('Pattern [Lines/Cross/Solid] <Lines>:');
  },
  input(app, raw) {
    const u = raw.toLowerCase();
    if (this.stage === 'pattern') {
      if (u === '' || u === 'l' || u === 'lines') this.pattern = 'lines';
      else if (u === 'c' || u === 'cross') this.pattern = 'cross';
      else if (u === 's' || u === 'solid') this.pattern = 'solid';
      else { app.print('Enter L, C, or S.'); return true; }
      if (this.pattern === 'solid') { this._make(app); return true; }
      this.stage = 'spacing';
      app.prompt('Line spacing <5>:');
      return true;
    }
    if (this.stage === 'spacing') {
      if (raw !== '') {
        const n = parseDist(raw);
        if (n === null || n <= 0) { app.print('Enter a positive number.'); return true; }
        this.spacing = n;
      }
      this.stage = 'angle';
      app.prompt('Pattern angle (degrees) <45>:');
      return true;
    }
    if (this.stage === 'angle') {
      if (raw !== '') {
        const n = parseFloat(raw);
        if (Number.isNaN(n)) { app.print('Enter an angle in degrees.'); return true; }
        this.angle = n * Math.PI / 180;
      }
      this._make(app);
      return true;
    }
    if (raw === '') { app.endTool(); return true; }
    return false;
  },
  _make(app) {
    app.doc.checkpoint();
    app.doc.add(makeEntity('hatch', {
      boundary: this.boundary, pattern: this.pattern, spacing: this.spacing,
      angle: this.angle == null ? Math.PI / 4 : this.angle, layer: app.doc.currentLayer,
    }));
    app.endTool();
  },
});

/* ================= blocks ================= */

TOOLS.block = () => ({
  name: 'block', label: 'BLOCK',
  stage: null, bname: null, rawInput: false,
  start(app) { startModify(app, this); },
  begin(app) { this.stage = 'name'; this.rawInput = true; app.prompt('BLOCK — Enter block name:'); },
  click(app, pt, ev) {
    if (this.stage === 'acquire') { acquireClick(app, this, ev); return; }
    if (this.stage === 'base') {
      const sel = app.doc.selectedEntities();
      app.doc.checkpoint();
      app.doc.blocks[this.bname] = { name: this.bname, base: { ...pt }, entities: sel.map(e => ENT.clone(e)) };
      app.doc.remove(sel.map(e => e.id));
      app.doc.add(makeEntity('insert', { name: this.bname, p: { ...pt }, scale: 1, rotation: 0, layer: app.doc.currentLayer }));
      app.print(`Block "${this.bname}" defined from ${sel.length} object(s).`);
      app.onSelectionChange();
      app.endTool();
    }
  },
  move(app) { if (this.stage === 'acquire') SEL.move(app); },
  up(app) { if (this.stage === 'acquire') SEL.up(app, app.downScreen); },
  input(app, raw) {
    if (this.stage === 'acquire') return acquireInput(app, this, raw);
    if (this.stage === 'name') {
      const name = raw.trim();
      if (!name) { app.print('A name is required.'); return true; }
      if (app.doc.blocks[name]) { app.print(`Block "${name}" already exists.`); return true; }
      this.bname = name;
      this.rawInput = false;
      this.stage = 'base';
      app.prompt('Specify base point:');
      return true;
    }
    if (raw === '') { app.endTool(); return true; }
    return false;
  },
});

TOOLS.insert = () => ({
  name: 'insert',
  stage: 'name', bname: null, p: null, scale: 1,
  rawInput: true,
  start(app) {
    const names = Object.keys(app.doc.blocks);
    if (!names.length) {
      app.print('No blocks defined yet — use BLOCK to create one from a selection.');
      app.endTool();
      return;
    }
    app.prompt(`INSERT — Block name [${names.join(', ')}]${names.length === 1 ? ` <${names[0]}>` : ''}:`);
  },
  click(app, pt) {
    if (this.stage === 'point') {
      this.p = pt; app.lastPoint = pt;
      this.stage = 'scale';
      app.prompt('Scale <1>:');
    }
  },
  input(app, raw) {
    if (this.stage === 'name') {
      const names = Object.keys(app.doc.blocks);
      let name = raw.trim();
      if (!name && names.length === 1) name = names[0];
      if (!app.doc.blocks[name]) { app.print(`Unknown block "${name}". Available: ${names.join(', ')}`); return true; }
      this.bname = name;
      this.rawInput = false;
      this.stage = 'point';
      app.prompt('Specify insertion point:');
      return true;
    }
    if (this.stage === 'scale') {
      let s = 1;
      if (raw !== '') {
        s = parseFloat(raw);
        if (Number.isNaN(s) || s <= 0) { app.print('Enter a positive number.'); return true; }
      }
      this.scale = s;
      this.stage = 'rot';
      app.prompt('Rotation (degrees) <0>:');
      return true;
    }
    if (this.stage === 'rot') {
      let r = 0;
      if (raw !== '') {
        r = parseFloat(raw);
        if (Number.isNaN(r)) { app.print('Enter a number.'); return true; }
      }
      app.doc.checkpoint();
      app.doc.add(makeEntity('insert', {
        name: this.bname, p: { ...this.p }, scale: this.scale, rotation: r * Math.PI / 180,
        layer: app.doc.currentLayer,
      }));
      app.endTool();
      return true;
    }
    if (raw === '') { app.endTool(); return true; }
    return false;
  },
  preview(ctx, app) {
    if (this.stage === 'point' && this.bname) {
      RENDER.ghostEntity(ctx, app.vp, { type: 'insert', name: this.bname, p: app.pointer.snapped, scale: 1, rotation: 0 });
    }
  },
});

/* ================= radial & angular dimensions ================= */

function makeRadialDimTool(name, diameter) {
  return () => ({
    name,
    stage: 'pick',
    c: null, r: 0,
    start(app) { app.prompt(`${name.toUpperCase()} — Select a circle or arc:`); },
    click(app, pt) {
      if (this.stage === 'pick') {
        const e = SEL.hitAt(app, app.pointer.raw);
        if (!e || (e.type !== 'circle' && e.type !== 'arc')) { app.print('Select a circle or arc.'); return; }
        this.c = { ...e.c };
        this.r = e.r;
        this.stage = 'place';
        app.prompt('Specify text location:');
      } else {
        const a = GEO.ang(this.c, pt);
        app.doc.checkpoint();
        app.doc.add(makeEntity('dim', {
          dtype: diameter ? 'diameter' : 'radius',
          p1: { ...this.c }, p2: GEO.polar(this.c, a, this.r), p3: { ...pt },
          layer: app.doc.currentLayer,
        }));
        app.endTool();
      }
    },
    input(app, raw) { if (raw === '') { app.endTool(); return true; } return false; },
    preview(ctx, app) {
      if (this.stage !== 'place') return;
      const p = app.pointer.snapped;
      const a = GEO.ang(this.c, p);
      RENDER.previewEntity(ctx, app.vp, {
        type: 'dim', dtype: diameter ? 'diameter' : 'radius',
        p1: this.c, p2: GEO.polar(this.c, a, this.r), p3: p,
      });
    },
  });
}
TOOLS.dimradius = makeRadialDimTool('dimradius', false);
TOOLS.dimdiameter = makeRadialDimTool('dimdiameter', true);

TOOLS.dimangular = () => ({
  name: 'dimangular',
  stage: 'first',
  vertex: null, rayA: null, rayB: null,
  start(app) { app.prompt('DIMANGULAR — Select first line:'); },
  click(app, pt) {
    if (this.stage === 'place') {
      app.doc.checkpoint();
      app.doc.add(makeEntity('dim', {
        dtype: 'angular',
        p1: { ...this.vertex }, p2: { ...this.rayA }, p3: { ...this.rayB }, p4: { ...pt },
        layer: app.doc.currentLayer,
      }));
      app.endTool();
      return;
    }
    const e = SEL.hitAt(app, app.pointer.raw);
    if (!e || e.type !== 'line') { app.print('Select a line.'); return; }
    if (this.stage === 'first') {
      this.l1 = e;
      this.pick1 = { ...app.pointer.raw };
      this.stage = 'second';
      app.prompt('Select second line:');
    } else if (this.stage === 'second') {
      if (e.id === this.l1.id) { app.print('Select a different line.'); return; }
      const X = GEO.lineLine(this.l1.a, this.l1.b, e.a, e.b);
      if (!X) { app.print('Lines are parallel.'); return; }
      const rayPt = (l, pick) => GEO.add(l.a, GEO.mul(GEO.sub(l.b, l.a), GEO.lineParam(pick, l.a, l.b)));
      this.vertex = X;
      this.rayA = rayPt(this.l1, this.pick1);
      this.rayB = rayPt(e, app.pointer.raw);
      this.stage = 'place';
      app.prompt('Specify dimension arc location:');
    }
  },
  input(app, raw) { if (raw === '') { app.endTool(); return true; } return false; },
  preview(ctx, app) {
    if (this.stage !== 'place') return;
    RENDER.previewEntity(ctx, app.vp, {
      type: 'dim', dtype: 'angular',
      p1: this.vertex, p2: this.rayA, p3: this.rayB, p4: app.pointer.snapped,
    });
  },
});

/* ================= plot to PDF ================= */

TOOLS.plot = () => ({
  name: 'plot',
  stage: 'area',
  win: null, c1: null, paper: 'a4',
  start(app) {
    const layout = app.doc.activeLayout();
    if (layout) {
      // plotting a layout: the sheet defines area and scale (1:1)
      const name = app.docName.replace(/\.(json|dxf|pdf)$/i, '') + '-' + layout.name.toLowerCase() + '.pdf';
      app._download(name, PDF.generateLayout(app.doc, layout), 'application/pdf');
      app.print(`Plotted ${layout.name} at 1:1 (${layout.paper.toUpperCase()} ${layout.landscape ? 'landscape' : 'portrait'}).`);
      app.endTool();
      return;
    }
    if (!app.doc.entities.length) { app.print('Nothing to plot.'); app.endTool(); return; }
    app.prompt('PLOT — Area [Extents/Window] <E>:');
  },
  click(app, pt) {
    if (this.stage === 'w1') {
      this.c1 = pt; app.lastPoint = pt;
      this.stage = 'w2';
      app.prompt('Specify opposite corner:');
    } else if (this.stage === 'w2') {
      this.win = GEO.rectFromPts(this.c1, pt);
      this.stage = 'paper';
      app.prompt('Paper size [A4/A3/Letter] <A4>:');
    }
  },
  input(app, raw) {
    const u = raw.toLowerCase();
    if (this.stage === 'area') {
      if (u === '' || u === 'e' || u === 'extents') { this.win = null; this.stage = 'paper'; app.prompt('Paper size [A4/A3/Letter] <A4>:'); return true; }
      if (u === 'w' || u === 'window') { this.stage = 'w1'; app.prompt('Specify first corner of plot window:'); return true; }
      app.print('Enter E or W.');
      return true;
    }
    if (this.stage === 'paper') {
      if (u === 'a3') this.paper = 'a3';
      else if (u === 'letter' || u === 'l') this.paper = 'letter';
      else if (u === '' || u === 'a4') this.paper = 'a4';
      else { app.print('Enter A4, A3, or Letter.'); return true; }
      this.stage = 'scale';
      app.prompt('Plot scale [Fit / 1:n / x/y inches per foot] <Fit>:');
      return true;
    }
    if (this.stage === 'scale') {
      let fixedScale = null;
      if (u !== '' && u !== 'f' && u !== 'fit') {
        let m = /^1\s*[:=]\s*(\d+(?:\.\d+)?)$/.exec(u);
        if (m) fixedScale = 1 / parseFloat(m[1]);
        else {
          m = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)"?$/.exec(u);
          if (m) fixedScale = (parseFloat(m[1]) / parseFloat(m[2])) / 12; // x/y inch = 1 foot
          else { app.print('Enter Fit, 1:n (e.g. 1:50), or a fraction like 1/4 (= 1/4 inch per foot).'); return true; }
        }
      }
      const rect = this.win || app.doc.bbox();
      if (!GEO.bbValid(rect)) { app.print('Nothing to plot.'); app.endTool(); return true; }
      const name = app.docName.replace(/\.(json|dxf|pdf)$/i, '') + '.pdf';
      app._download(name, PDF.generate(app.doc, rect, this.paper, fixedScale), 'application/pdf');
      app.print(`Plotted to ${name} (${this.paper.toUpperCase()}${fixedScale ? `, scale ${u}` : ', fit'}).`);
      app.endTool();
      return true;
    }
    if (raw === '') { app.endTool(); return true; }
    return false;
  },
  preview(ctx, app) {
    if (this.stage === 'w2') {
      const p = app.pointer.snapped;
      RENDER.previewEntity(ctx, app.vp, {
        type: 'polyline',
        pts: [this.c1, { x: p.x, y: this.c1.y }, p, { x: this.c1.x, y: p.y }],
        closed: true,
      });
    }
  },
});

/* ================= ellipse ================= */

TOOLS.ellipse = () => ({
  name: 'ellipse',
  stage: 'center',
  c: null, rx: 0, rot: 0,
  start(app) { app.prompt('ELLIPSE — Specify center point:'); },
  click(app, pt) {
    if (this.stage === 'center') {
      this.c = pt; app.lastPoint = pt;
      this.stage = 'axis';
      app.prompt('Specify end of first axis:');
    } else if (this.stage === 'axis') {
      this.rx = GEO.dist(this.c, pt);
      if (this.rx <= 1e-9) return;
      this.rot = GEO.ang(this.c, pt);
      this.stage = 'other';
      app.prompt('Specify other axis distance:');
    } else {
      this._make(app, GEO.dist(this.c, pt));
    }
  },
  _make(app, ry) {
    if (ry <= 1e-9) { app.print('Axis distance must be positive.'); return; }
    app.doc.checkpoint();
    app.doc.add(makeEntity('ellipse', { c: { ...this.c }, rx: this.rx, ry, rot: this.rot, layer: app.doc.currentLayer }));
    app.endTool();
  },
  input(app, raw) {
    if (this.stage === 'axis' && raw !== '') {
      const n = parseDist(raw);
      if (n !== null && n > 0) { this.rx = n; this.rot = 0; this.stage = 'other'; app.prompt('Specify other axis distance:'); return true; }
    }
    if (this.stage === 'other' && raw !== '') {
      const n = parseDist(raw);
      if (n !== null) { this._make(app, n); return true; }
    }
    if (raw === '') { app.endTool(); return true; }
    return false;
  },
  preview(ctx, app) {
    const p = app.pointer.snapped;
    if (this.stage === 'axis') RENDER.previewEntity(ctx, app.vp, { type: 'line', a: this.c, b: p });
    else if (this.stage === 'other') {
      RENDER.previewEntity(ctx, app.vp, { type: 'ellipse', c: this.c, rx: this.rx, ry: Math.max(GEO.dist(this.c, p), 1e-6), rot: this.rot });
    }
  },
});

/* ================= leader ================= */

TOOLS.leader = () => ({
  name: 'leader',
  pts: [],
  rawInput: false,
  start(app) { this.pts = []; app.prompt('LEADER — Specify arrowhead point:'); },
  click(app, pt) {
    if (this.rawInput) return;
    if (this.pts.length && GEO.eq(this.pts[this.pts.length - 1], pt)) return;
    this.pts.push(pt);
    app.lastPoint = pt;
    app.prompt(this.pts.length < 2 ? 'Specify next point:' : 'Specify next point or Enter for text:');
  },
  input(app, raw) {
    if (this.rawInput) {
      if (raw.trim() === '') { app.endTool(); return true; }
      app.doc.checkpoint();
      app.doc.add(makeEntity('leader', {
        pts: this.pts.map(p => ({ ...p })), text: raw, height: app.doc.settings.textHeight,
        layer: app.doc.currentLayer,
      }));
      app.endTool();
      return true;
    }
    if (raw === '') {
      if (this.pts.length < 2) { app.endTool(); return true; }
      this.rawInput = true;
      app.prompt('Enter leader text:');
      return true;
    }
    return false;
  },
  preview(ctx, app) {
    if (!this.pts.length) return;
    const pts = this.rawInput ? this.pts : [...this.pts, app.pointer.snapped];
    if (pts.length >= 2) {
      RENDER.previewEntity(ctx, app.vp, { type: 'leader', pts, text: '…', height: app.doc.settings.textHeight });
    }
  },
});

/* ================= break ================= */

function breakEntity(app, e, p1, p2) {
  const props = { layer: e.layer, color: e.color };
  const atPoint = GEO.eq(p1, p2, 1e-9);

  if (e.type === 'line') {
    let t1 = GEO.segParam(p1, e.a, e.b), t2 = GEO.segParam(p2, e.a, e.b);
    if (t2 < t1) { const t = t1; t1 = t2; t2 = t; }
    const P = (t) => GEO.lerp(e.a, e.b, t);
    const out = [];
    if (t1 > 1e-9) out.push(makeEntity('line', { a: { ...e.a }, b: P(t1), ...props }));
    if (t2 < 1 - 1e-9) out.push(makeEntity('line', { a: P(t2), b: { ...e.b }, ...props }));
    app.doc.checkpoint();
    app.doc.remove([e.id]);
    out.forEach(x => app.doc.add(x));
    return true;
  }

  if (e.type === 'circle') {
    if (atPoint) { app.print('Cannot break a circle at a single point.'); return false; }
    // remove CCW from p1 to p2 (AutoCAD convention)
    const a1 = GEO.ang(e.c, p1), a2 = GEO.ang(e.c, p2);
    app.doc.checkpoint();
    app.doc.remove([e.id]);
    app.doc.add(makeEntity('arc', { c: { ...e.c }, r: e.r, a0: GEO.normAng(a2), a1: GEO.normAng(a1), ...props }));
    return true;
  }

  if (e.type === 'arc') {
    const sweep = GEO.sweep(e.a0, e.a1);
    const clampRel = (p) => Math.max(0, Math.min(sweep, GEO.normAng(GEO.ang(e.c, p) - e.a0)));
    let r1 = clampRel(p1), r2 = clampRel(p2);
    if (r2 < r1) { const t = r1; r1 = r2; r2 = t; }
    const out = [];
    if (r1 > 1e-9) out.push(makeEntity('arc', { c: { ...e.c }, r: e.r, a0: e.a0, a1: GEO.normAng(e.a0 + r1), ...props }));
    if (r2 < sweep - 1e-9) out.push(makeEntity('arc', { c: { ...e.c }, r: e.r, a0: GEO.normAng(e.a0 + r2), a1: e.a1, ...props }));
    app.doc.checkpoint();
    app.doc.remove([e.id]);
    out.forEach(x => app.doc.add(x));
    return true;
  }

  if (e.type === 'polyline' && !e.closed) {
    const pts = e.pts;
    const nSeg = pts.length - 1;
    const paramOf = (p) => {
      let best = 0, bd = Infinity;
      for (let i = 0; i < nSeg; i++) {
        const t = GEO.segParam(p, pts[i], pts[i + 1]);
        const dd = GEO.dist(p, GEO.lerp(pts[i], pts[i + 1], t));
        if (dd < bd) { bd = dd; best = i + t; }
      }
      return best;
    };
    let t1 = paramOf(p1), t2 = paramOf(p2);
    if (t2 < t1) { const t = t1; t1 = t2; t2 = t; }
    const ptAt = (t) => {
      const i = Math.min(nSeg - 1, Math.floor(t));
      return GEO.lerp(pts[i], pts[i + 1], t - i);
    };
    const piece = (a, b) => {
      const arr = [ptAt(a)];
      for (let i = Math.floor(a) + 1; i <= Math.floor(b - 1e-9); i++) arr.push({ ...pts[i] });
      const end = ptAt(b);
      if (!GEO.eq(arr[arr.length - 1], end)) arr.push(end);
      return arr;
    };
    const out = [];
    const left = piece(0, t1), right = piece(t2, nSeg);
    if (left.length >= 2) out.push(makeEntity('polyline', { pts: left, closed: false, ...props }));
    if (right.length >= 2) out.push(makeEntity('polyline', { pts: right, closed: false, ...props }));
    app.doc.checkpoint();
    app.doc.remove([e.id]);
    out.forEach(x => app.doc.add(x));
    return true;
  }

  app.print(`Cannot break a ${e.type}.`);
  return false;
}

TOOLS.break = () => ({
  name: 'break',
  stage: 'pick',
  target: null, p1: null,
  start(app) { app.prompt('BREAK — Select object (pick point = first break point):'); },
  click(app, pt) {
    if (this.stage === 'pick') {
      const e = SEL.hitAt(app, app.pointer.raw);
      if (!e) { app.print('No object found.'); return; }
      this.target = e;
      this.p1 = { ...app.pointer.raw };
      this.stage = 'second';
      app.prompt('Specify second break point, or [First] / @ to split at point:');
    } else if (this.stage === 'first') {
      this.p1 = { ...pt };
      this.stage = 'second';
      app.prompt('Specify second break point (@ to split at point):');
    } else if (this.stage === 'second') {
      if (breakEntity(app, this.target, this.p1, pt)) app.endTool();
    }
  },
  input(app, raw) {
    const u = raw.toLowerCase();
    if (this.stage === 'second' && (u === 'f' || u === 'first')) {
      this.stage = 'first';
      app.prompt('Specify first break point:');
      return true;
    }
    if (this.stage === 'second' && u === '@') {
      if (breakEntity(app, this.target, this.p1, this.p1)) app.endTool();
      return true;
    }
    if (raw === '') { app.endTool(); return true; }
    return false;
  },
});

/* ================= join ================= */

function joinSelection(app) {
  const sel = app.doc.selectedEntities();
  const eps = 1e-6;
  const paths = [];   // open point chains from lines / open polylines
  const arcs = [];
  const consumed = [];
  for (const e of sel) {
    if (e.type === 'line') { paths.push([{ ...e.a }, { ...e.b }]); consumed.push(e.id); }
    else if (e.type === 'polyline' && !e.closed) { paths.push(e.pts.map(p => ({ ...p }))); consumed.push(e.id); }
    else if (e.type === 'arc') { arcs.push(e); consumed.push(e.id); }
  }
  if (consumed.length < 2 && !(arcs.length === 1 && consumed.length === 1)) {
    app.print('Select two or more lines, open polylines, or coincident arcs.');
    return;
  }

  const results = [];

  // merge arcs sharing center+radius into contiguous spans (or a circle)
  const arcGroups = [];
  for (const a of arcs) {
    let grp = arcGroups.find(g => GEO.eq(g[0].c, a.c, eps) && Math.abs(g[0].r - a.r) < eps);
    if (!grp) { grp = []; arcGroups.push(grp); }
    grp.push(a);
  }
  for (const grp of arcGroups) {
    let spans = grp.map(a => ({ a0: a.a0, sweep: GEO.sweep(a.a0, a.a1) }));
    let merged = true;
    while (merged && spans.length > 1) {
      merged = false;
      outer:
      for (let i = 0; i < spans.length; i++) {
        for (let j = 0; j < spans.length; j++) {
          if (i === j) continue;
          const rel = GEO.normAng(spans[j].a0 - spans[i].a0);
          if (rel <= spans[i].sweep + 1e-6) { // j starts inside/at end of i
            const total = Math.max(spans[i].sweep, rel + spans[j].sweep);
            spans[i] = { a0: spans[i].a0, sweep: Math.min(total, Math.PI * 2) };
            spans.splice(j, 1);
            merged = true;
            break outer;
          }
        }
      }
    }
    const src = grp[0];
    if (spans.length === 1 && spans[0].sweep >= Math.PI * 2 - 1e-6) {
      results.push(makeEntity('circle', { c: { ...src.c }, r: src.r, layer: src.layer, color: src.color }));
    } else {
      for (const s of spans) {
        results.push(makeEntity('arc', { c: { ...src.c }, r: src.r, a0: GEO.normAng(s.a0), a1: GEO.normAng(s.a0 + s.sweep), layer: src.layer, color: src.color }));
      }
    }
  }

  // chain lines / polylines by shared endpoints
  const chains = [];
  const pool = paths.slice();
  while (pool.length) {
    let chain = pool.shift();
    let grew = true;
    while (grew) {
      grew = false;
      for (let i = 0; i < pool.length; i++) {
        const c = pool[i];
        const h = chain[0], t = chain[chain.length - 1];
        if (GEO.eq(c[0], t, eps)) { chain = chain.concat(c.slice(1)); }
        else if (GEO.eq(c[c.length - 1], t, eps)) { chain = chain.concat(c.slice(0, -1).reverse()); }
        else if (GEO.eq(c[c.length - 1], h, eps)) { chain = c.slice(0, -1).concat(chain); }
        else if (GEO.eq(c[0], h, eps)) { chain = c.slice(1).reverse().concat(chain); }
        else continue;
        pool.splice(i, 1);
        grew = true;
        break;
      }
    }
    chains.push(chain);
  }
  const srcStyle = sel.find(e => e.type === 'line' || e.type === 'polyline');
  for (const chain of chains) {
    const closed = chain.length > 3 && GEO.eq(chain[0], chain[chain.length - 1], eps);
    const pts = closed ? chain.slice(0, -1) : chain;
    if (pts.length === 2) {
      results.push(makeEntity('line', { a: pts[0], b: pts[1], layer: srcStyle.layer, color: srcStyle.color }));
    } else if (pts.length > 2) {
      results.push(makeEntity('polyline', { pts, closed, layer: srcStyle.layer, color: srcStyle.color }));
    }
  }

  if (results.length >= consumed.length) {
    app.print('Nothing could be joined (no shared endpoints).');
    return;
  }
  app.doc.checkpoint();
  app.doc.remove(consumed);
  results.forEach(r => app.doc.add(r));
  app.print(`Joined into ${results.length} object(s).`);
  app.onSelectionChange();
}

TOOLS.join = makeImmediateTool('join', 'JOIN', joinSelection);

/* ================= stretch ================= */

TOOLS.stretch = () => ({
  name: 'stretch',
  stage: 'w1',
  rect: null, c1: null, base: null,
  start(app) { app.prompt('STRETCH — Specify first corner of crossing window:'); },
  click(app, pt) {
    if (this.stage === 'w1') {
      this.c1 = pt;
      this.stage = 'w2';
      app.prompt('Specify opposite corner:');
    } else if (this.stage === 'w2') {
      this.rect = GEO.rectFromPts(this.c1, pt);
      const n = this._affected(app).length;
      if (!n) { app.print('No objects cross the window.'); this.stage = 'w1'; app.prompt('Specify first corner of crossing window:'); return; }
      this.stage = 'base';
      app.prompt(`${n} object(s) — Specify base point:`);
    } else if (this.stage === 'base') {
      this.base = pt; app.lastPoint = pt;
      this.stage = 'dest';
      app.prompt('Specify second point:');
    } else if (this.stage === 'dest') {
      const d = GEO.sub(pt, this.base);
      app.doc.checkpoint();
      for (const e of this._affected(app)) ENT.stretch(e, this.rect, d);
      app.doc._changed();
      app.print('Stretch complete.');
      app.endTool();
    }
  },
  _affected(app) {
    return app.doc.entities.filter(e => app.doc.selectable(e) && ENT.inRect(e, this.rect, true));
  },
  input(app, raw) { if (raw === '') { app.endTool(); return true; } return false; },
  preview(ctx, app) {
    const p = app.pointer.snapped;
    if (this.stage === 'w2') {
      RENDER.previewEntity(ctx, app.vp, {
        type: 'polyline', pts: [this.c1, { x: p.x, y: this.c1.y }, p, { x: this.c1.x, y: p.y }], closed: true,
      });
    } else if (this.stage === 'dest') {
      const d = GEO.sub(p, this.base);
      for (const e of this._affected(app)) {
        RENDER.ghostEntity(ctx, app.vp, ENT.stretch(ENT.clone(e), this.rect, d));
      }
      RENDER.previewEntity(ctx, app.vp, { type: 'line', a: this.base, b: p });
    }
  },
});

/* ================= chamfer ================= */

function chamferLines(app, e1, pick1, e2, pick2, d1, d2) {
  const X = GEO.lineLine(e1.a, e1.b, e2.a, e2.b);
  if (!X) { app.print('Lines are parallel — cannot chamfer.'); return false; }
  const keepEnd = (e, pick) => (GEO.lineParam(pick, e.a, e.b) <= GEO.lineParam(X, e.a, e.b) ? 'a' : 'b');
  const k1 = keepEnd(e1, pick1), k2 = keepEnd(e2, pick2);
  const K1 = e1[k1], K2 = e2[k2];
  app.doc.checkpoint();
  if (d1 <= 1e-9 && d2 <= 1e-9) {
    if (k1 === 'a') e1.b = { ...X }; else e1.a = { ...X };
    if (k2 === 'a') e2.b = { ...X }; else e2.a = { ...X };
    app.doc._changed();
    return true;
  }
  if (d1 > GEO.dist(X, K1) + 1e-9 || d2 > GEO.dist(X, K2) + 1e-9) {
    app.print('Chamfer distances are too large for these lines.');
    app.doc.undo();
    return false;
  }
  const T1 = GEO.add(X, GEO.mul(GEO.norm(GEO.sub(K1, X)), d1));
  const T2 = GEO.add(X, GEO.mul(GEO.norm(GEO.sub(K2, X)), d2));
  if (k1 === 'a') { e1.a = K1; e1.b = T1; } else { e1.a = T1; e1.b = K1; }
  if (k2 === 'a') { e2.a = K2; e2.b = T2; } else { e2.a = T2; e2.b = K2; }
  app.doc.add(makeEntity('line', { a: T1, b: T2, layer: e1.layer, color: e1.color }));
  return true;
}

TOOLS.chamfer = () => ({
  name: 'chamfer',
  stage: 'first',
  e1: null, pick1: null,
  start(app) {
    const s = app.doc.settings;
    app.prompt(`CHAMFER — Select first line or [Distance] (d1=${fmtLen(s.chamferD1 || 0)}, d2=${fmtLen(s.chamferD2 || 0)}):`);
  },
  click(app, pt) {
    if (this.stage === 'd1' || this.stage === 'd2') return;
    const e = SEL.hitAt(app, app.pointer.raw);
    if (!e) { app.print('No object found.'); return; }
    if (e.type !== 'line') { app.print('Chamfer currently supports lines only.'); return; }
    if (this.stage === 'first') {
      this.e1 = e;
      this.pick1 = { ...app.pointer.raw };
      this.stage = 'second';
      app.prompt('Select second line:');
    } else if (this.stage === 'second') {
      if (e.id === this.e1.id) { app.print('Select a different line.'); return; }
      const s = app.doc.settings;
      if (chamferLines(app, this.e1, this.pick1, e, app.pointer.raw, s.chamferD1 || 0, s.chamferD2 || 0)) app.endTool();
    }
  },
  input(app, raw) {
    const u = raw.toLowerCase();
    const s = app.doc.settings;
    if (this.stage === 'first' && (u === 'd' || u === 'distance')) {
      this.stage = 'd1';
      app.prompt(`Specify first chamfer distance <${fmtLen(s.chamferD1 || 0)}>:`);
      return true;
    }
    if (this.stage === 'd1') {
      if (raw !== '') {
        const n = parseDist(raw);
        if (n === null || n < 0) { app.print('Distance must be >= 0.'); return true; }
        s.chamferD1 = n;
      }
      this.stage = 'd2';
      app.prompt(`Specify second chamfer distance <${fmtLen(s.chamferD2 != null ? s.chamferD2 : (s.chamferD1 || 0))}>:`);
      return true;
    }
    if (this.stage === 'd2') {
      if (raw !== '') {
        const n = parseDist(raw);
        if (n === null || n < 0) { app.print('Distance must be >= 0.'); return true; }
        s.chamferD2 = n;
      } else if (s.chamferD2 == null) s.chamferD2 = s.chamferD1 || 0;
      this.stage = 'first';
      app.prompt(`Select first line or [Distance] (d1=${fmtLen(s.chamferD1 || 0)}, d2=${fmtLen(s.chamferD2 || 0)}):`);
      return true;
    }
    if (raw === '') { app.endTool(); return true; }
    return false;
  },
});

/* ================= continue / baseline dimensions ================= */

function dimLinePlacement(base, p1, p2, extraOffset) {
  // place the new dimension on the same dimension line as `base` (offset for baseline)
  if (base.dtype === 'linear-h') return { x: GEO.mid(p1, p2).x, y: base.p3.y + (extraOffset || 0) };
  if (base.dtype === 'linear-v') return { x: base.p3.x + (extraOffset || 0), y: GEO.mid(p1, p2).y };
  // aligned: keep the same perpendicular offset from the measured points
  const dir = GEO.norm(GEO.sub(base.p2, base.p1));
  const n = GEO.perp(dir);
  const off = GEO.dot(GEO.sub(base.p3, base.p1), n) + (extraOffset || 0);
  return GEO.add(GEO.mid(p1, p2), GEO.mul(n, off));
}

function makeChainDimTool(name, baseline) {
  return () => ({
    name,
    stage: null,
    baseDim: null, count: 0,
    start(app) {
      const last = app.lastDimId != null ? app.doc.get(app.lastDimId) : null;
      if (last && ['linear-h', 'linear-v', 'aligned'].includes(last.dtype)) {
        this.baseDim = last;
        this.stage = 'next';
        app.prompt(`${name.toUpperCase()} — Specify next extension line origin (Enter to finish):`);
      } else {
        this.stage = 'pickbase';
        app.prompt(`${name.toUpperCase()} — Select a linear/aligned dimension to continue from:`);
      }
    },
    click(app, pt) {
      if (this.stage === 'pickbase') {
        const e = SEL.hitAt(app, app.pointer.raw);
        if (!e || e.type !== 'dim' || !['linear-h', 'linear-v', 'aligned'].includes(e.dtype)) {
          app.print('Select a linear or aligned dimension.');
          return;
        }
        this.baseDim = e;
        this.stage = 'next';
        app.prompt('Specify next extension line origin (Enter to finish):');
        return;
      }
      if (this.stage === 'next') {
        const base = this.baseDim;
        const p1 = baseline ? { ...base.p1 } : { ...base.p2 };
        if (GEO.eq(p1, pt)) return;
        this.count++;
        const gap = baseline ? this._gapSign(base) * ENT.DIM_TEXT * 3.2 * this.count : 0;
        const dim = makeEntity('dim', {
          dtype: base.dtype, p1, p2: { ...pt },
          p3: dimLinePlacement(base, p1, pt, gap),
          layer: base.layer,
        });
        app.doc.checkpoint();
        app.doc.add(dim);
        if (!baseline) this.baseDim = dim; // chain continues from the new dim
        app.lastDimId = dim.id;
        app.lastPoint = pt;
      }
    },
    _gapSign(base) {
      // offset further away from the measured geometry
      if (base.dtype === 'linear-h') return base.p3.y >= Math.max(base.p1.y, base.p2.y) ? 1 : -1;
      if (base.dtype === 'linear-v') return base.p3.x >= Math.max(base.p1.x, base.p2.x) ? 1 : -1;
      const n = GEO.perp(GEO.norm(GEO.sub(base.p2, base.p1)));
      return GEO.dot(GEO.sub(base.p3, base.p1), n) >= 0 ? 1 : -1;
    },
    input(app, raw) { if (raw === '') { app.endTool(); return true; } return false; },
    preview(ctx, app) {
      if (this.stage !== 'next' || !this.baseDim) return;
      const base = this.baseDim;
      const p1 = baseline ? base.p1 : base.p2;
      const pt = app.pointer.snapped;
      if (GEO.eq(p1, pt)) return;
      const gap = baseline ? this._gapSign(base) * ENT.DIM_TEXT * 3.2 * (this.count + 1) : 0;
      RENDER.previewEntity(ctx, app.vp, {
        type: 'dim', dtype: base.dtype, p1, p2: pt, p3: dimLinePlacement(base, p1, pt, gap),
      });
    },
  });
}
TOOLS.dimcontinue = makeChainDimTool('dimcontinue', false);
TOOLS.dimbaseline = makeChainDimTool('dimbaseline', true);

/* ================= mtext ================= */

TOOLS.mtext = () => ({
  name: 'mtext',
  stage: 'c1',
  c1: null, editing: false,
  start(app) { app.prompt('MTEXT — Specify first corner of text box:'); },
  click(app, pt) {
    if (this.editing) return;
    if (this.stage === 'c1') {
      this.c1 = pt; app.lastPoint = pt;
      this.stage = 'c2';
      app.prompt('Specify opposite corner:');
    } else if (this.stage === 'c2') {
      const width = Math.abs(pt.x - this.c1.x);
      if (width < 1e-6) { app.print('Box width must be positive.'); return; }
      const ent = {
        p: { x: Math.min(this.c1.x, pt.x), y: Math.max(this.c1.y, pt.y) },
        width,
        height: app.doc.settings.textHeight,
        text: '',
      };
      this.editing = true;
      app.prompt('Type text — Ctrl+Enter to place, Esc to cancel:');
      UI.openMtextEditor(app, ent, (text) => {
        this.editing = false;
        if (text !== null && text.trim()) {
          app.doc.checkpoint();
          app.doc.add(makeEntity('mtext', {
            p: ent.p, width: ent.width, height: ent.height, text,
            layer: app.doc.currentLayer,
          }));
        }
        app.endTool();
      });
    }
  },
  input(app, raw) { if (raw === '' && !this.editing) { app.endTool(); return true; } return this.editing; },
  preview(ctx, app) {
    if (this.stage === 'c2' && !this.editing) {
      const p = app.pointer.snapped;
      RENDER.previewEntity(ctx, app.vp, {
        type: 'polyline',
        pts: [this.c1, { x: p.x, y: this.c1.y }, p, { x: this.c1.x, y: p.y }],
        closed: true,
      });
    }
  },
});

/* ================= paper space: viewports & annotation scale ================= */

TOOLS.mview = () => ({
  name: 'mview',
  stage: 'c1',
  c1: null, rect: null,
  start(app) {
    if (!app.doc.activeLayout()) {
      app.print('MVIEW works in paper space — switch to a layout tab first.');
      app.endTool();
      return;
    }
    app.prompt('MVIEW — Specify first corner of viewport (on paper):');
  },
  click(app, pt) {
    if (this.stage === 'c1') {
      this.c1 = pt; app.lastPoint = pt;
      this.stage = 'c2';
      app.prompt('Specify opposite corner:');
    } else if (this.stage === 'c2') {
      const r = GEO.rectFromPts(this.c1, pt);
      if (r.x2 - r.x1 < 0.2 || r.y2 - r.y1 < 0.2) { app.print('Viewport too small.'); return; }
      this.rect = r;
      this.stage = 'scale';
      const def = UNITS.scaleLabel(app.doc.settings.annoScale || 1);
      app.prompt(`Viewport scale [Fit / 1:n / x/y inches per foot] <${def}>:`);
    }
  },
  input(app, raw) {
    if (this.stage !== 'scale') {
      if (raw === '') { app.endTool(); return true; }
      return false;
    }
    const u = raw.toLowerCase();
    const r = this.rect;
    const w = r.x2 - r.x1, h = r.y2 - r.y1;
    let mb = GEO.bbEmpty();
    for (const e of app.doc.modelEntities) mb = GEO.bbUnion(mb, ENT.bbox(e));
    const center = GEO.bbValid(mb) ? { x: (mb.x1 + mb.x2) / 2, y: (mb.y1 + mb.y2) / 2 } : { x: 0, y: 0 };
    let scale; // paper per model
    if (u === '' ) scale = 1 / (app.doc.settings.annoScale || 1);
    else if (u === 'f' || u === 'fit') {
      scale = GEO.bbValid(mb)
        ? Math.min(w / Math.max(mb.x2 - mb.x1, 1e-9), h / Math.max(mb.y2 - mb.y1, 1e-9)) * 0.95
        : 1;
    } else {
      const n = parseScaleToken(u);
      if (n === null) { app.print('Enter Fit, 1:n, or a fraction like 1/4.'); return true; }
      scale = n;
    }
    app.doc.checkpoint();
    app.doc.add(makeEntity('viewport', {
      p: { x: r.x1, y: r.y1 }, w, h, center, scale, layer: app.doc.currentLayer,
    }));
    app.print(`Viewport at ${UNITS.scaleLabel(1 / scale)}.`);
    app.endTool();
    return true;
  },
  preview(ctx, app) {
    if (this.stage === 'c2') {
      const p = app.pointer.snapped;
      RENDER.previewEntity(ctx, app.vp, {
        type: 'polyline', pts: [this.c1, { x: p.x, y: this.c1.y }, p, { x: this.c1.x, y: p.y }], closed: true,
      });
    } else if (this.stage === 'scale' && this.rect) {
      RENDER.previewEntity(ctx, app.vp, {
        type: 'viewport', p: { x: this.rect.x1, y: this.rect.y1 },
        w: this.rect.x2 - this.rect.x1, h: this.rect.y2 - this.rect.y1,
        center: { x: 0, y: 0 }, scale: 1,
      });
    }
  },
});

// "1:48" -> 1/48 paper-per-model, "1/4" -> (1/4)/12, plain "48" -> 1/48
function parseScaleToken(u) {
  let m = /^1\s*[:=]\s*(\d+(?:\.\d+)?)$/.exec(u);
  if (m) return 1 / parseFloat(m[1]);
  m = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)"?$/.exec(u);
  if (m) return (parseFloat(m[1]) / parseFloat(m[2])) / 12;
  m = /^(\d+(?:\.\d+)?)$/.exec(u);
  if (m && parseFloat(m[1]) > 0) return 1 / parseFloat(m[1]);
  return null;
}

TOOLS.annoscale = () => ({
  name: 'annoscale',
  start(app) {
    app.prompt(`ANNOSCALE — current ${UNITS.scaleLabel(app.doc.settings.annoScale || 1)}. New scale [1:1 / 1:n / x/y inches per foot]:`);
  },
  input(app, raw) {
    const u = raw.toLowerCase().trim();
    if (u === '') { app.endTool(); return true; }
    let n = null; // model units per paper inch
    if (u === '1:1' || u === '1') n = 1;
    else {
      const sc = parseScaleToken(u);
      if (sc !== null) n = 1 / sc;
    }
    if (n === null || !(n > 0)) { app.print('Enter 1:1, 1:n (e.g. 1:48), or a fraction like 1/4.'); return true; }
    app.doc.settings.annoScale = n;
    const ds = app.doc.settings.dimStyle;
    if (n !== 1 && ds.textHeight > 1) {
      // style was sized in model units; switch to standard paper sizes (DIMTXT 3/16")
      ds.textHeight = 0.1875; ds.arrow = 0.1875; ds.extGap = 0.0625; ds.extOver = 0.1875;
      app.print('Dimension style switched to paper sizes (text 3/16") — adjust via DIMSTYLE.');
    }
    app.doc._changed(); // re-syncs annotative sizes
    app.print(`Annotation scale set to ${UNITS.scaleLabel(n)}. Dim text plots at ${fmt(ds.textHeight)}" on paper.`);
    app.refreshStatus();
    app.endTool();
    return true;
  },
});

/* ================= command registry ================= */

const COMMANDS = {
  // drawing
  line: { tool: 'line', help: 'Draw line segments' },
  pline: { tool: 'polyline', help: 'Draw a polyline' },
  circle: { tool: 'circle', help: 'Draw a circle (center/radius or 2P)' },
  arc: { tool: 'arc', help: 'Draw an arc (3-point or CEnter)' },
  rectang: { tool: 'rectangle', help: 'Draw a rectangle' },
  ellipse: { tool: 'ellipse', help: 'Draw an ellipse (center, axis, axis)' },
  polygon: { tool: 'polygon', help: 'Draw a regular polygon' },
  point: { tool: 'point', help: 'Place point objects' },
  text: { tool: 'text', help: 'Place single-line text' },
  mtext: { tool: 'mtext', help: 'Multiline text in a word-wrapped box (double-click to edit)' },
  hatch: { tool: 'hatch', help: 'Hatch a closed boundary (lines/cross/solid)' },
  block: { tool: 'block', help: 'Define a block from a selection' },
  insert: { tool: 'insert', help: 'Insert a block reference' },
  dimlinear: { tool: 'dimlinear', help: 'Linear (horizontal/vertical) dimension' },
  dimaligned: { tool: 'dimaligned', help: 'Aligned dimension' },
  dimradius: { tool: 'dimradius', help: 'Radius dimension for circle/arc' },
  dimdiameter: { tool: 'dimdiameter', help: 'Diameter dimension for circle/arc' },
  dimangular: { tool: 'dimangular', help: 'Angular dimension between two lines' },
  dimcontinue: { tool: 'dimcontinue', help: 'Continue a chain of dimensions from the last one' },
  dimbaseline: { tool: 'dimbaseline', help: 'Baseline dimensions from a common origin' },
  leader: { tool: 'leader', help: 'Leader: arrow, segments, then text' },
  dist: { tool: 'dist', help: 'Measure distance between two points' },
  // modify
  move: { tool: 'move', help: 'Move selection' },
  copy: { tool: 'copy', help: 'Copy selection (repeating)' },
  rotate: { tool: 'rotate', help: 'Rotate selection' },
  scale: { tool: 'scale', help: 'Scale selection' },
  mirror: { tool: 'mirror', help: 'Mirror selection' },
  offset: { tool: 'offset', help: 'Offset line/circle/arc/polyline' },
  trim: { tool: 'trim', help: 'Trim at intersections' },
  extend: { tool: 'extend', help: 'Extend to the nearest boundary edge' },
  break: { tool: 'break', help: 'Break an object between two points (@ splits at a point)' },
  join: { tool: 'join', help: 'Join lines/polylines/arcs into one object' },
  stretch: { tool: 'stretch', help: 'Stretch vertices inside a crossing window' },
  chamfer: { tool: 'chamfer', help: 'Chamfer two lines (distances or corner)' },
  array: { tool: 'array', help: 'Rectangular or polar array' },
  fillet: { tool: 'fillet', help: 'Fillet two lines (radius or corner)' },
  explode: { tool: 'explode', help: 'Explode polylines/dimensions' },
  erase: { tool: 'erase', help: 'Erase objects' },
  // view
  pan: { tool: 'pan', help: 'Pan (or drag middle mouse anytime)' },
  zoom: { fn: (app) => { app.vp.zoomExtents(app.activeBBox ? app.activeBBox() : app.doc.bbox()); app.print('Zoom extents.'); }, help: 'Zoom to extents' },
  regen: { fn: (app) => app.requestRender(), help: 'Redraw' },
  // edit
  undo: { fn: (app) => { app.print(app.doc.undo() ? 'Undo.' : 'Nothing to undo.'); app.onSelectionChange(); }, help: 'Undo' },
  redo: { fn: (app) => { app.print(app.doc.redo() ? 'Redo.' : 'Nothing to redo.'); app.onSelectionChange(); }, help: 'Redo' },
  selectall: {
    fn: (app) => {
      for (const e of app.doc.entities) if (app.doc.selectable(e)) app.doc.selection.add(e.id);
      app.print(`${app.doc.selection.size} selected.`);
      app.onSelectionChange();
    }, help: 'Select all',
  },
  dimstyle: { fn: (app) => UI.openDimStyle(app), help: 'Dimension style: text height, arrows, precision' },
  annoscale: { tool: 'annoscale', help: 'Set annotation scale (sizes dims for the viewport scale)' },
  mview: { tool: 'mview', help: 'Create a paper-space viewport (in a layout)' },
  model: { fn: (app) => app.setSpace('model'), help: 'Switch to model space' },
  layout: {
    fn: (app) => {
      if (app.doc.space === 'model') app.setSpace(0);
      else app.setSpace((app.doc.space + 1) % app.doc.layouts.length);
    }, help: 'Switch to (next) paper-space layout',
  },
  template: { fn: (app) => app.fileImportTemplate(), help: 'Import an AutoCAD template (DXF) into the current layout' },
  // toggles
  grid: { fn: (app) => { app.doc.settings.grid = !app.doc.settings.grid; app.refreshStatus(); }, help: 'Toggle grid (F7)' },
  snap: { fn: (app) => { app.doc.settings.snapGrid = !app.doc.settings.snapGrid; app.refreshStatus(); }, help: 'Toggle grid snap (F9)' },
  ortho: {
    fn: (app) => {
      app.doc.settings.ortho = !app.doc.settings.ortho;
      if (app.doc.settings.ortho) app.doc.settings.polar = false;
      app.refreshStatus();
    }, help: 'Toggle ortho (F8)',
  },
  polar: {
    fn: (app) => {
      app.doc.settings.polar = !app.doc.settings.polar;
      if (app.doc.settings.polar) app.doc.settings.ortho = false;
      app.print(`Polar tracking ${app.doc.settings.polar ? 'on' : 'off'} (increment ${app.doc.settings.polarInc || 45}°).`);
      app.refreshStatus();
    }, help: 'Toggle polar tracking (F10)',
  },
  otrack: {
    fn: (app) => {
      app.doc.settings.otrack = !app.doc.settings.otrack;
      if (!app.doc.settings.otrack) app.trackAcq = [];
      app.print(`Object snap tracking ${app.doc.settings.otrack ? 'on' : 'off'} (hover an osnap to acquire a point).`);
      app.refreshStatus();
    }, help: 'Toggle object snap tracking (F11)',
  },
  dyn: {
    fn: (app) => {
      app.doc.settings.dynInput = !app.doc.settings.dynInput;
      app.print(`Dynamic input ${app.doc.settings.dynInput ? 'on' : 'off'}.`);
      app.refreshStatus();
    }, help: 'Toggle dynamic input readout (F12)',
  },
  units: {
    fn: (app) => {
      const arch = app.doc.settings.units !== 'architectural';
      app.doc.settings.units = arch ? 'architectural' : 'decimal';
      ENT.units = app.doc.settings.units;
      app.print(arch
        ? "Units: architectural (1 unit = 1\"; lengths accept 3'6, 18\", 6 1/2)."
        : 'Units: decimal.');
      app.refreshStatus();
      app.requestRender();
    }, help: 'Toggle decimal / architectural (feet-inches) units',
  },
  osnap: { fn: (app) => { app.doc.settings.osnap = !app.doc.settings.osnap; app.refreshStatus(); }, help: 'Toggle object snap (F3)' },
  // file
  new: { fn: (app) => app.fileNew(), help: 'New drawing' },
  open: { fn: (app) => app.fileOpen(), help: 'Open .json or .dxf' },
  save: { fn: (app) => app.fileSave(), help: 'Save drawing (.json)' },
  dxfout: { fn: (app) => app.fileExportDxf(), help: 'Export DXF (R12)' },
  plot: { tool: 'plot', help: 'Plot to a vector PDF' },
  layer: { fn: (app) => app.print('Use the Layers panel on the right to manage layers.'), help: 'Layers info' },
  help: { fn: (app) => app.showHelp(), help: 'Show command reference (F1)' },
};

const ALIASES = {
  l: 'line', pl: 'pline', c: 'circle', a: 'arc', rec: 'rectang', rect: 'rectang', rectangle: 'rectang',
  pol: 'polygon', po: 'point', t: 'text', dt: 'text', dli: 'dimlinear', dimlin: 'dimlinear',
  dal: 'dimaligned', dima: 'dimaligned', dra: 'dimradius', dimrad: 'dimradius',
  ddi: 'dimdiameter', dan: 'dimangular', dimang: 'dimangular', di: 'dist',
  m: 'move', co: 'copy', cp: 'copy', ro: 'rotate', sc: 'scale', mi: 'mirror', o: 'offset',
  tr: 'trim', ex: 'extend', ar: 'array', f: 'fillet', x: 'explode', e: 'erase', del: 'erase', delete: 'erase',
  el: 'ellipse', le: 'leader', lead: 'leader', br: 'break', j: 'join', s: 'stretch', cha: 'chamfer',
  dco: 'dimcontinue', dimcont: 'dimcontinue', dba: 'dimbaseline', dimbase: 'dimbaseline',
  mt: 'mtext', d: 'dimstyle', dst: 'dimstyle',
  mv: 'mview', vports: 'mview', cannoscale: 'annoscale', ansc: 'annoscale',
  pspace: 'layout', mspace: 'model', ps: 'layout', ms: 'model',
  h: 'hatch', bh: 'hatch', b: 'block', i: 'insert',
  p: 'pan', z: 'zoom', ze: 'zoom', re: 'regen', u: 'undo', la: 'layer',
  print: 'plot', pdf: 'plot', un: 'units',
  '?': 'help', os: 'osnap', or: 'ortho',
};

function resolveCommand(word) {
  const w = word.toLowerCase();
  if (COMMANDS[w]) return w;
  if (ALIASES[w]) return ALIASES[w];
  return null;
}

/* viewport.js — world <-> screen mapping. World is Y-up, screen is Y-down (CSS px). */
'use strict';

class Viewport {
  constructor() {
    this.scale = 4;      // px per world unit
    this.cx = 0;         // world point at screen center
    this.cy = 0;
    this.w = 800;        // canvas size in CSS px
    this.h = 600;
  }

  resize(w, h) { this.w = w; this.h = h; }

  w2s(p) {
    return {
      x: (p.x - this.cx) * this.scale + this.w / 2,
      y: this.h / 2 - (p.y - this.cy) * this.scale,
    };
  }

  s2w(p) {
    return {
      x: (p.x - this.w / 2) / this.scale + this.cx,
      y: (this.h / 2 - p.y) / this.scale + this.cy,
    };
  }

  pxToWorld(px) { return px / this.scale; }

  panPx(dx, dy) {
    this.cx -= dx / this.scale;
    this.cy += dy / this.scale;
  }

  zoomAt(screenPt, factor) {
    const before = this.s2w(screenPt);
    this.scale = Math.min(1e6, Math.max(1e-6, this.scale * factor));
    const after = this.s2w(screenPt);
    this.cx += before.x - after.x;
    this.cy += before.y - after.y;
  }

  zoomExtents(bbox) {
    if (!bbox || !GEO.bbValid(bbox)) {
      this.scale = 4; this.cx = 0; this.cy = 0;
      return;
    }
    const bw = Math.max(bbox.x2 - bbox.x1, 1e-6);
    const bh = Math.max(bbox.y2 - bbox.y1, 1e-6);
    this.scale = Math.min(this.w / bw, this.h / bh) * 0.85;
    this.scale = Math.min(1e6, Math.max(1e-6, this.scale));
    this.cx = (bbox.x1 + bbox.x2) / 2;
    this.cy = (bbox.y1 + bbox.y2) / 2;
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { Viewport };

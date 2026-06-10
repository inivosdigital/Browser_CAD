/* renderer.js — canvas drawing: grid, entities, selection, previews, snap markers, crosshair. */
'use strict';

const RENDER = {
  // screen-space dash patterns per layer linetype
  LTYPES: {
    continuous: [],
    dashed: [8, 5],
    hidden: [4, 3],
    center: [16, 4, 4, 4],
    dot: [1.5, 4],
  },

  COLORS: {
    bg: '#15191e',
    gridMinor: '#1f262e',
    gridMajor: '#2a3340',
    axisX: '#7a3b3b',
    axisY: '#3b6b3b',
    selection: '#3aa0ff',
    ghost: 'rgba(170,200,255,0.55)',
    preview: '#9fd0ff',
    crosshair: 'rgba(255,255,255,0.55)',
    snap: '#35e07a',
    rubberWindow: 'rgba(70,140,255,0.12)',
    rubberWindowEdge: '#4a8cff',
    rubberCross: 'rgba(70,220,110,0.12)',
    rubberCrossEdge: '#39c46a',
  },

  /* ---- entity drawing (world coords mapped through vp per point) ---- */

  drawEntity(ctx, vp, e, color, lineWidth, dash) {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = lineWidth || 1.4;
    ctx.setLineDash(dash || []);
    switch (e.type) {
      case 'line': {
        const a = vp.w2s(e.a), b = vp.w2s(e.b);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        break;
      }
      case 'circle': {
        const c = vp.w2s(e.c);
        ctx.beginPath(); ctx.arc(c.x, c.y, e.r * vp.scale, 0, Math.PI * 2); ctx.stroke();
        break;
      }
      case 'arc': {
        const c = vp.w2s(e.c);
        // world is y-up, canvas y-down: angles negate, CCW world = anticlockwise=false? world CCW -> canvas CW
        ctx.beginPath();
        ctx.arc(c.x, c.y, e.r * vp.scale, -e.a0, -e.a1, true);
        ctx.stroke();
        break;
      }
      case 'polyline': {
        if (e.pts.length < 2) break;
        ctx.beginPath();
        const p0 = vp.w2s(e.pts[0]);
        ctx.moveTo(p0.x, p0.y);
        for (let i = 1; i < e.pts.length; i++) {
          const p = vp.w2s(e.pts[i]);
          ctx.lineTo(p.x, p.y);
        }
        if (e.closed) ctx.closePath();
        ctx.stroke();
        break;
      }
      case 'point': {
        const p = vp.w2s(e.p);
        ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(p.x - 6, p.y); ctx.lineTo(p.x + 6, p.y);
        ctx.moveTo(p.x, p.y - 6); ctx.lineTo(p.x, p.y + 6);
        ctx.stroke();
        break;
      }
      case 'text':
        RENDER.drawText(ctx, vp, e.p, e.text, e.height, e.rotation || 0, color, e.align || 'left');
        break;
      case 'dim': {
        const g = ENT.dimGeometry(e);
        ctx.beginPath();
        for (const l of g.lines) {
          const a = vp.w2s(l.a), b = vp.w2s(l.b);
          ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        }
        for (const a of g.arcs) {
          const c = vp.w2s(a.c);
          ctx.moveTo(c.x + Math.cos(-a.a0) * a.r * vp.scale, c.y + Math.sin(-a.a0) * a.r * vp.scale);
          ctx.arc(c.x, c.y, a.r * vp.scale, -a.a0, -a.a1, true);
        }
        ctx.stroke();
        for (const ar of g.arrows) RENDER.drawArrow(ctx, vp, ar.p, ar.ang, color);
        for (const t of g.texts) RENDER.drawText(ctx, vp, t.p, t.text, t.height, t.rotation, color, t.align || 'center');
        break;
      }
      case 'ellipse': {
        const c = vp.w2s(e.c);
        ctx.beginPath();
        ctx.ellipse(c.x, c.y, e.rx * vp.scale, e.ry * vp.scale, -(e.rot || 0), 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case 'leader': {
        const g = ENT.leaderGeometry(e);
        ctx.beginPath();
        for (const l of g.lines) {
          const a = vp.w2s(l.a), b = vp.w2s(l.b);
          ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        }
        ctx.stroke();
        for (const ar of g.arrows) RENDER.drawArrow(ctx, vp, ar.p, ar.ang, color);
        for (const t of g.texts) RENDER.drawText(ctx, vp, t.p, t.text, t.height, 0, color, t.align);
        break;
      }
      case 'mtext': {
        const lines = ENT.mtextLines(e);
        for (let i = 0; i < lines.length; i++) {
          RENDER.drawText(ctx, vp,
            { x: e.p.x, y: e.p.y - (i + 1) * ENT.MTEXT_LS * e.height + e.height * 0.45 },
            lines[i], e.height, 0, color, 'left');
        }
        break;
      }
      case 'viewport': {
        const a = vp.w2s(e.p), b = vp.w2s({ x: e.p.x + e.w, y: e.p.y + e.h });
        ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        break;
      }
      case 'hatch':
        RENDER.drawHatch(ctx, vp, e, color, lineWidth, dash);
        break;
      case 'insert':
        for (const ch of ENT.resolvedChildren(e)) {
          RENDER.drawEntity(ctx, vp, ch, color, lineWidth, dash);
        }
        break;
    }
    ctx.setLineDash([]);
  },

  drawHatch(ctx, vp, e, color, lineWidth, dash) {
    const b = e.boundary;
    const path = new Path2D();
    if (b.kind === 'circle') {
      const c = vp.w2s(b.c);
      path.arc(c.x, c.y, b.r * vp.scale, 0, Math.PI * 2);
    } else {
      const p0 = vp.w2s(b.pts[0]);
      path.moveTo(p0.x, p0.y);
      for (let i = 1; i < b.pts.length; i++) {
        const p = vp.w2s(b.pts[i]);
        path.lineTo(p.x, p.y);
      }
      path.closePath();
    }
    if (e.pattern === 'solid') {
      ctx.save();
      ctx.globalAlpha *= 0.8;
      ctx.fill(path);
      ctx.restore();
    } else {
      ctx.save();
      ctx.clip(path);
      const bb = ENT.bbox(e);
      const ang = e.angle == null ? Math.PI / 4 : e.angle;
      const spacing = Math.max(e.spacing || 5, (bb.x2 - bb.x1 + bb.y2 - bb.y1) / 2000);
      const cx = (bb.x1 + bb.x2) / 2, cy = (bb.y1 + bb.y2) / 2;
      const half = GEO.dist({ x: bb.x1, y: bb.y1 }, { x: bb.x2, y: bb.y2 }) / 2 + spacing;
      const dirs = e.pattern === 'cross' ? [ang, ang + Math.PI / 2] : [ang];
      ctx.lineWidth = Math.max(0.75, lineWidth * 0.6);
      ctx.beginPath();
      for (const d of dirs) {
        const u = { x: Math.cos(d), y: Math.sin(d) };
        const n = { x: -u.y, y: u.x };
        const count = Math.ceil(half / spacing);
        for (let i = -count; i <= count; i++) {
          const base = { x: cx + n.x * i * spacing, y: cy + n.y * i * spacing };
          const a = vp.w2s({ x: base.x - u.x * half, y: base.y - u.y * half });
          const b2 = vp.w2s({ x: base.x + u.x * half, y: base.y + u.y * half });
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b2.x, b2.y);
        }
      }
      ctx.stroke();
      ctx.restore();
    }
    // boundary outline
    ctx.lineWidth = lineWidth || 1.4;
    ctx.stroke(path);
  },

  drawText(ctx, vp, p, text, height, rotation, color, align) {
    const s = vp.w2s(p);
    const px = Math.max(1, height * vp.scale);
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(-(rotation || 0));
    ctx.fillStyle = color;
    ctx.font = `${px}px "Segoe UI", Arial, sans-serif`;
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(text || '', 0, 0);
    ctx.restore();
  },

  drawArrow(ctx, vp, tip, ang, color) {
    // filled arrowhead; `ang` is the world direction from the tip toward the barbs
    const L = ENT.DIM_ARROW;
    const t = vp.w2s(tip);
    const b1 = vp.w2s(GEO.polar(tip, ang + 0.16, L));
    const b2 = vp.w2s(GEO.polar(tip, ang - 0.16, L));
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(t.x, t.y);
    ctx.lineTo(b1.x, b1.y);
    ctx.lineTo(b2.x, b2.y);
    ctx.closePath();
    ctx.fill();
  },

  /* ---- grid ---- */

  drawGrid(ctx, vp, doc) {
    if (!doc.settings.grid) { RENDER.drawAxes(ctx, vp); return; }
    // adaptive spacing: doubles the base grid step until lines are >= 8 px apart
    const step = RENDER.niceStep(8 / vp.scale, doc.settings.gridStep || 10);
    const major = step * 5;
    const tl = vp.s2w({ x: 0, y: 0 });
    const br = vp.s2w({ x: vp.w, y: vp.h });
    const x0 = Math.floor(tl.x / step) * step, x1 = br.x;
    const y0 = Math.floor(br.y / step) * step, y1 = tl.y;

    for (const [sp, color] of [[step, RENDER.COLORS.gridMinor], [major, RENDER.COLORS.gridMajor]]) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const sx0 = Math.floor(tl.x / sp) * sp;
      const sy0 = Math.floor(br.y / sp) * sp;
      for (let x = sx0; x <= x1; x += sp) {
        const s = vp.w2s({ x, y: 0 });
        ctx.moveTo(Math.round(s.x) + 0.5, 0); ctx.lineTo(Math.round(s.x) + 0.5, vp.h);
      }
      for (let y = sy0; y <= y1; y += sp) {
        const s = vp.w2s({ x: 0, y });
        ctx.moveTo(0, Math.round(s.y) + 0.5); ctx.lineTo(vp.w, Math.round(s.y) + 0.5);
      }
      ctx.stroke();
    }
    RENDER.drawAxes(ctx, vp);
  },

  niceStep(minWorld, base) {
    let step = base;
    while (step < minWorld) step *= 2;
    while (step / 2 >= minWorld && step / 2 >= base) step /= 2;
    return step;
  },

  drawAxes(ctx, vp) {
    const o = vp.w2s({ x: 0, y: 0 });
    ctx.lineWidth = 1;
    if (o.y >= 0 && o.y <= vp.h) {
      ctx.strokeStyle = RENDER.COLORS.axisX;
      ctx.beginPath(); ctx.moveTo(0, Math.round(o.y) + 0.5); ctx.lineTo(vp.w, Math.round(o.y) + 0.5); ctx.stroke();
    }
    if (o.x >= 0 && o.x <= vp.w) {
      ctx.strokeStyle = RENDER.COLORS.axisY;
      ctx.beginPath(); ctx.moveTo(Math.round(o.x) + 0.5, 0); ctx.lineTo(Math.round(o.x) + 0.5, vp.h); ctx.stroke();
    }
  },

  /* ---- snap marker ---- */

  drawSnapMarker(ctx, vp, snap) {
    const s = vp.w2s(snap.pt);
    const r = 6;
    ctx.strokeStyle = RENDER.COLORS.snap;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    switch (snap.kind) {
      case 'end': // square
        ctx.rect(s.x - r, s.y - r, r * 2, r * 2);
        break;
      case 'mid': // triangle
        ctx.moveTo(s.x, s.y - r);
        ctx.lineTo(s.x - r, s.y + r);
        ctx.lineTo(s.x + r, s.y + r);
        ctx.closePath();
        break;
      case 'center': // circle
        ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
        break;
      case 'quad': // diamond
        ctx.moveTo(s.x, s.y - r);
        ctx.lineTo(s.x + r, s.y);
        ctx.lineTo(s.x, s.y + r);
        ctx.lineTo(s.x - r, s.y);
        ctx.closePath();
        break;
      case 'int': // X
        ctx.moveTo(s.x - r, s.y - r); ctx.lineTo(s.x + r, s.y + r);
        ctx.moveTo(s.x - r, s.y + r); ctx.lineTo(s.x + r, s.y - r);
        break;
      case 'perp': // right-angle mark
        ctx.moveTo(s.x - r, s.y - r); ctx.lineTo(s.x - r, s.y + r); ctx.lineTo(s.x + r, s.y + r);
        ctx.moveTo(s.x - r, s.y); ctx.lineTo(s.x, s.y); ctx.lineTo(s.x, s.y + r);
        break;
      case 'tan': // circle with tangent bar on top
        ctx.arc(s.x, s.y, r - 1, 0, Math.PI * 2);
        ctx.moveTo(s.x - r, s.y - r); ctx.lineTo(s.x + r, s.y - r);
        break;
      case 'near': // bowtie
        ctx.moveTo(s.x - r, s.y - r); ctx.lineTo(s.x + r, s.y + r); ctx.lineTo(s.x + r, s.y - r);
        ctx.lineTo(s.x - r, s.y + r); ctx.closePath();
        break;
      default:
        ctx.rect(s.x - r, s.y - r, r * 2, r * 2);
    }
    ctx.stroke();
  },

  /* ---- main frame ---- */

  render(app) {
    const { ctx, vp, doc } = app;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = RENDER.COLORS.bg;
    ctx.fillRect(0, 0, vp.w, vp.h);

    const layout = doc.activeLayout ? doc.activeLayout() : null;
    if (layout) RENDER.drawPaper(ctx, vp, layout);
    else RENDER.drawGrid(ctx, vp, doc);

    // entities (active space)
    const viewRect = GEO.bbPad(GEO.rectFromPts(vp.s2w({ x: 0, y: 0 }), vp.s2w({ x: vp.w, y: vp.h })), 0);
    for (const e of doc.entities) {
      if (!doc.visible(e)) continue;
      const bb = ENT.bbox(e);
      if (GEO.bbValid(bb) && !GEO.bbOverlap(bb, viewRect)) continue;
      // viewport contents first so the frame/selection draws on top
      if (layout && e.type === 'viewport') RENDER.drawViewportContents(ctx, vp, doc, e);
      const sel = doc.selection.has(e.id);
      const ly = doc.layer(e.layer);
      const locked = ly && ly.locked;
      let color = doc.entityColor(e);
      if (layout) color = RENDER.paperInk(color);
      if (locked) color = RENDER.fade(color);
      if (sel) {
        RENDER.drawEntity(ctx, vp, e, RENDER.COLORS.selection, 2.0, [6, 4]);
        RENDER.drawGrips(ctx, vp, e);
      } else {
        const dash = (ly && RENDER.LTYPES[ly.ltype]) || [];
        const width = 1.4 * (ly && ly.lweight ? ly.lweight : 1);
        RENDER.drawEntity(ctx, vp, e, color, width, dash);
      }
    }

    // tool preview
    if (app.tool && app.tool.preview) app.tool.preview(ctx, app);

    // rubber band selection
    if (app.rubber) {
      const a = vp.w2s(app.rubber.a), b = vp.w2s(app.rubber.b);
      const crossing = app.rubber.b.x < app.rubber.a.x;
      ctx.fillStyle = crossing ? RENDER.COLORS.rubberCross : RENDER.COLORS.rubberWindow;
      ctx.strokeStyle = crossing ? RENDER.COLORS.rubberCrossEdge : RENDER.COLORS.rubberWindowEdge;
      ctx.lineWidth = 1;
      ctx.setLineDash(crossing ? [5, 4] : []);
      const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x + 0.5, y + 0.5, w, h);
      ctx.setLineDash([]);
    }

    // polar tracking ray + distance<angle readout (dynamic input)
    if (app.pointer.track) {
      const t = app.pointer.track;
      const b = vp.w2s(t.base);
      const dir = { x: Math.cos(-t.ang), y: Math.sin(-t.ang) }; // world->canvas angle flip
      const far = Math.hypot(vp.w, vp.h);
      ctx.strokeStyle = 'rgba(53,224,122,0.55)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x + dir.x * far, b.y + dir.y * far);
      ctx.stroke();
      ctx.setLineDash([]);
      RENDER.drawReadout(ctx, app, t.dist, t.ang);
    } else if (app.pointer.dyn) {
      RENDER.drawReadout(ctx, app, app.pointer.dyn.dist, app.pointer.dyn.ang);
    }

    // object snap tracking: acquired points + alignment rays
    if (app.trackAcq && app.trackAcq.length) {
      ctx.strokeStyle = '#e0a435';
      ctx.lineWidth = 1.4;
      for (const t of app.trackAcq) {
        const p = vp.w2s(t);
        ctx.beginPath();
        ctx.moveTo(p.x - 4, p.y); ctx.lineTo(p.x + 4, p.y);
        ctx.moveTo(p.x, p.y - 4); ctx.lineTo(p.x, p.y + 4);
        ctx.stroke();
      }
    }
    if (app.pointer.otrack) {
      ctx.strokeStyle = 'rgba(224,164,53,0.6)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      for (const ray of app.pointer.otrack.rays) {
        const a = vp.w2s(ray.from), b = vp.w2s(ray.to);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // snap marker
    if (app.pointer.snap) RENDER.drawSnapMarker(ctx, vp, app.pointer.snap);

    // crosshair + pickbox
    if (app.pointer.inside && !app.panning) {
      const s = app.pointer.screen;
      ctx.strokeStyle = RENDER.COLORS.crosshair;
      ctx.lineWidth = 1;
      const g = 5; // pickbox half-size
      ctx.beginPath();
      ctx.moveTo(0, s.y + 0.5); ctx.lineTo(s.x - g, s.y + 0.5);
      ctx.moveTo(s.x + g, s.y + 0.5); ctx.lineTo(vp.w, s.y + 0.5);
      ctx.moveTo(s.x + 0.5, 0); ctx.lineTo(s.x + 0.5, s.y - g);
      ctx.moveTo(s.x + 0.5, s.y + g); ctx.lineTo(s.x + 0.5, vp.h);
      ctx.rect(s.x - g + 0.5, s.y - g + 0.5, g * 2, g * 2);
      ctx.stroke();
    }
  },

  // dynamic-input style distance<angle tooltip at the cursor
  drawReadout(ctx, app, dist, ang) {
    const s = app.pointer.screen;
    const units = app.doc.settings.units;
    const distTxt = (typeof UNITS !== 'undefined') ? UNITS.formatLength(dist, units, 2) : dist.toFixed(2);
    const angDeg = GEO.normAng(ang) * 180 / Math.PI;
    const label = `${distTxt} < ${(+angDeg.toFixed(2))}°`;
    ctx.font = '11px Consolas, monospace';
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(20,28,24,0.85)';
    ctx.fillRect(s.x + 14, s.y - 26, tw + 10, 17);
    ctx.fillStyle = RENDER.COLORS.snap;
    ctx.fillText(label, s.x + 19, s.y - 14);
  },

  drawGrips(ctx, vp, e) {
    ctx.fillStyle = '#2f7fd6';
    ctx.strokeStyle = '#9fd0ff';
    ctx.lineWidth = 1;
    for (const g of ENT.grips(e)) {
      const p = vp.w2s(g.pt);
      ctx.fillRect(p.x - 3.5, p.y - 3.5, 7, 7);
      ctx.strokeRect(p.x - 3.5, p.y - 3.5, 7, 7);
    }
  },

  drawPaper(ctx, vp, layout) {
    const [W, H] = UNITS.layoutDims(layout);
    const a = vp.w2s({ x: 0, y: 0 }), b = vp.w2s({ x: W, y: H });
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 18;
    ctx.fillStyle = '#f2f1ec';
    ctx.fillRect(x, y, w, h);
    ctx.restore();
    // printable margin
    const m = 0.4 * vp.scale;
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 1;
    ctx.strokeRect(x + m, y + m, w - 2 * m, h - 2 * m);
    ctx.setLineDash([]);
  },

  // draw model entities through a viewport window, clipped to its frame
  drawViewportContents(ctx, vp, doc, v) {
    const a = vp.w2s(v.p), b = vp.w2s({ x: v.p.x + v.w, y: v.p.y + v.h });
    ctx.save();
    ctx.beginPath();
    ctx.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    ctx.clip();
    const xf = ENT.viewportXf(v);
    // dim/arrow sizes are globals in model units; scale them into paper units
    const keep = [ENT.DIM_TEXT, ENT.DIM_ARROW, ENT.DIM_EXT_GAP, ENT.DIM_EXT_OVER];
    ENT.DIM_TEXT *= v.scale; ENT.DIM_ARROW *= v.scale;
    ENT.DIM_EXT_GAP *= v.scale; ENT.DIM_EXT_OVER *= v.scale;
    for (const me of doc.modelEntities) {
      if (!doc.visible(me)) continue;
      const ly = doc.layer(me.layer);
      const clone = ENT.transformed(me, xf);
      if (me.type === 'dim') clone.$text = ENT.dimGeometry(me).texts[0].text; // keep the true measurement
      const color = RENDER.paperInk(doc.entityColor(me));
      const dash = (ly && RENDER.LTYPES[ly.ltype]) || [];
      RENDER.drawEntity(ctx, vp, clone, color, 1.1 * (ly && ly.lweight ? ly.lweight : 1), dash);
    }
    [ENT.DIM_TEXT, ENT.DIM_ARROW, ENT.DIM_EXT_GAP, ENT.DIM_EXT_OVER] = keep;
    ctx.restore();
  },

  // near-white ink becomes dark when drawn on the white paper sheet
  paperInk(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return hex;
    const v = parseInt(m[1], 16);
    const r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
    return (r > 225 && g > 225 && b > 225) ? '#1c1c1c' : hex;
  },

  fade(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!m) return hex;
    const v = parseInt(m[1], 16);
    const r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
    return `rgba(${r},${g},${b},0.4)`;
  },

  ghostEntity(ctx, vp, e) {
    RENDER.drawEntity(ctx, vp, e, RENDER.COLORS.ghost, 1.2, [5, 4]);
  },

  previewEntity(ctx, vp, e) {
    RENDER.drawEntity(ctx, vp, e, RENDER.COLORS.preview, 1.2, [5, 4]);
  },
};

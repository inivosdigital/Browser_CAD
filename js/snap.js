/* snap.js — object snapping (OSNAP), grid snap and ortho constraint. */
'use strict';

const SNAP = {
  RANGE_PX: 12,
  // tie-break priority when two candidates are equally close
  PRIORITY: { end: 6, int: 5, mid: 4, center: 3, quad: 2, perp: 1 },

  /* Find the best object snap near screenPt. basePoint (optional) enables
     perpendicular snap. Returns { pt, kind } or null. */
  find(doc, vp, screenPt, basePoint) {
    if (!doc.settings.osnap) return null;
    const world = vp.s2w(screenPt);
    const range = vp.pxToWorld(SNAP.RANGE_PX);
    let best = null, bestScore = Infinity;
    const consider = (pt, kind) => {
      const d = GEO.dist(pt, world);
      if (d > range) return;
      const score = d - SNAP.PRIORITY[kind] * range * 0.02;
      if (score < bestScore) { bestScore = score; best = { pt, kind }; }
    };

    const near = [];
    const nearBB = { x1: world.x - range, y1: world.y - range, x2: world.x + range, y2: world.y + range };
    for (const e of doc.entities) {
      if (!doc.visible(e)) continue;
      const bb = GEO.bbPad(ENT.bbox(e), range);
      if (!GEO.bbValid(bb) || !GEO.bbOverlap(bb, nearBB)) continue;
      near.push(e);
      for (const s of ENT.snapPoints(e)) consider(s.pt, s.kind);
    }

    // intersections between nearby entities
    for (let i = 0; i < near.length; i++) {
      for (let j = i + 1; j < near.length; j++) {
        for (const p of ENT.intersections(near[i], near[j])) consider(p, 'int');
      }
    }

    // perpendicular foot from base point onto nearby segments/circles
    if (basePoint) {
      for (const e of near) {
        const pr = ENT.prims(e);
        for (const s of pr.segs) {
          const t = GEO.segParam(basePoint, s[0], s[1]);
          if (t > 0.001 && t < 0.999) consider(GEO.lerp(s[0], s[1], t), 'perp');
        }
        for (const c of pr.circles) {
          const u = GEO.norm(GEO.sub(basePoint, c.c));
          consider(GEO.add(c.c, GEO.mul(u, c.r)), 'perp');
        }
      }
    }

    return best;
  },

  gridSnap(doc, pt) {
    const s = doc.settings.gridStep || 10;
    return { x: Math.round(pt.x / s) * s, y: Math.round(pt.y / s) * s };
  },

  ortho(basePoint, pt) {
    const dx = Math.abs(pt.x - basePoint.x), dy = Math.abs(pt.y - basePoint.y);
    return dx >= dy ? { x: pt.x, y: basePoint.y } : { x: basePoint.x, y: pt.y };
  },
};

if (typeof module !== 'undefined' && module.exports) module.exports = { SNAP };

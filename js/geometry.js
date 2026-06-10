/* geometry.js — 2D vector math and intersection primitives. All angles in radians. */
'use strict';

const GEO = {
  EPS: 1e-9,

  V(x, y) { return { x, y }; },
  add(a, b) { return { x: a.x + b.x, y: a.y + b.y }; },
  sub(a, b) { return { x: a.x - b.x, y: a.y - b.y }; },
  mul(a, s) { return { x: a.x * s, y: a.y * s }; },
  dot(a, b) { return a.x * b.x + a.y * b.y; },
  cross(a, b) { return a.x * b.y - a.y * b.x; },
  len(a) { return Math.hypot(a.x, a.y); },
  dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); },
  norm(a) { const l = Math.hypot(a.x, a.y); return l < GEO.EPS ? { x: 1, y: 0 } : { x: a.x / l, y: a.y / l }; },
  perp(a) { return { x: -a.y, y: a.x }; },
  lerp(a, b, t) { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; },
  mid(a, b) { return GEO.lerp(a, b, 0.5); },
  ang(a, b) { return Math.atan2(b.y - a.y, b.x - a.x); },
  polar(p, ang, d) { return { x: p.x + Math.cos(ang) * d, y: p.y + Math.sin(ang) * d }; },
  eq(a, b, eps) { return GEO.dist(a, b) <= (eps || 1e-7); },

  rotPt(p, c, ang) {
    const s = Math.sin(ang), co = Math.cos(ang), dx = p.x - c.x, dy = p.y - c.y;
    return { x: c.x + dx * co - dy * s, y: c.y + dx * s + dy * co };
  },
  scalePt(p, c, f) { return { x: c.x + (p.x - c.x) * f, y: c.y + (p.y - c.y) * f }; },
  mirrorPt(p, a, b) {
    const d = GEO.norm(GEO.sub(b, a));
    const v = GEO.sub(p, a);
    const t = GEO.dot(v, d);
    const foot = GEO.add(a, GEO.mul(d, t));
    return { x: 2 * foot.x - p.x, y: 2 * foot.y - p.y };
  },
  // Reflect a direction angle across the direction of line a->b.
  mirrorAng(ang, a, b) {
    const m = GEO.ang(a, b);
    return GEO.normAng(2 * m - ang);
  },

  normAng(a) {
    const T = Math.PI * 2;
    a = a % T;
    return a < 0 ? a + T : a;
  },
  // Is angle a within CCW sweep from a0 to a1?
  angIn(a, a0, a1, eps) {
    eps = eps || 1e-9;
    const T = Math.PI * 2;
    const sweep = GEO.normAng(a1 - a0) || T; // full circle when a0==a1
    const rel = GEO.normAng(a - a0);
    return rel <= sweep + eps;
  },
  sweep(a0, a1) { const s = GEO.normAng(a1 - a0); return s < GEO.EPS ? Math.PI * 2 : s; },

  // Parameter of closest point on segment ab to p, clamped to [0,1].
  segParam(p, a, b) {
    const ab = GEO.sub(b, a);
    const l2 = GEO.dot(ab, ab);
    if (l2 < GEO.EPS) return 0;
    return Math.max(0, Math.min(1, GEO.dot(GEO.sub(p, a), ab) / l2));
  },
  closestOnSeg(p, a, b) { return GEO.lerp(a, b, GEO.segParam(p, a, b)); },
  distPtSeg(p, a, b) { return GEO.dist(p, GEO.closestOnSeg(p, a, b)); },
  // Unclamped parameter of p projected on infinite line ab.
  lineParam(p, a, b) {
    const ab = GEO.sub(b, a);
    const l2 = GEO.dot(ab, ab);
    if (l2 < GEO.EPS) return 0;
    return GEO.dot(GEO.sub(p, a), ab) / l2;
  },

  // Intersection of infinite lines p1p2 and p3p4 (null if parallel).
  lineLine(p1, p2, p3, p4) {
    const d1 = GEO.sub(p2, p1), d2 = GEO.sub(p4, p3);
    const den = GEO.cross(d1, d2);
    if (Math.abs(den) < GEO.EPS) return null;
    const t = GEO.cross(GEO.sub(p3, p1), d2) / den;
    return GEO.add(p1, GEO.mul(d1, t));
  },
  // Intersection of segments (null if none).
  segSeg(p1, p2, p3, p4) {
    const d1 = GEO.sub(p2, p1), d2 = GEO.sub(p4, p3);
    const den = GEO.cross(d1, d2);
    if (Math.abs(den) < GEO.EPS) return null;
    const t = GEO.cross(GEO.sub(p3, p1), d2) / den;
    const u = GEO.cross(GEO.sub(p3, p1), d1) / den;
    const e = 1e-7;
    if (t < -e || t > 1 + e || u < -e || u > 1 + e) return null;
    return GEO.add(p1, GEO.mul(d1, t));
  },
  // Infinite line / circle intersections.
  lineCircle(a, b, c, r) {
    const d = GEO.sub(b, a), f = GEO.sub(a, c);
    const A = GEO.dot(d, d);
    if (A < GEO.EPS) return [];
    const B = 2 * GEO.dot(f, d);
    const C = GEO.dot(f, f) - r * r;
    let disc = B * B - 4 * A * C;
    if (disc < 0) return [];
    disc = Math.sqrt(disc);
    const out = [];
    for (const t of [(-B - disc) / (2 * A), (-B + disc) / (2 * A)]) {
      const p = GEO.add(a, GEO.mul(d, t));
      if (!out.some(q => GEO.eq(q, p))) out.push(p);
    }
    return out;
  },
  // Point inside polygon (ray casting).
  ptInPoly(p, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j];
      if ((a.y > p.y) !== (b.y > p.y) &&
          p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  },
  // Segment/circle intersections.
  segCircle(a, b, c, r) {
    const d = GEO.sub(b, a), f = GEO.sub(a, c);
    const A = GEO.dot(d, d);
    if (A < GEO.EPS) return [];
    const B = 2 * GEO.dot(f, d);
    const C = GEO.dot(f, f) - r * r;
    let disc = B * B - 4 * A * C;
    if (disc < 0) return [];
    disc = Math.sqrt(disc);
    const out = [];
    for (const t of [(-B - disc) / (2 * A), (-B + disc) / (2 * A)]) {
      if (t >= -1e-7 && t <= 1 + 1e-7) {
        const p = GEO.add(a, GEO.mul(d, t));
        if (!out.some(q => GEO.eq(q, p))) out.push(p);
      }
    }
    return out;
  },
  circleCircle(c1, r1, c2, r2) {
    const d = GEO.dist(c1, c2);
    if (d < GEO.EPS || d > r1 + r2 + GEO.EPS || d < Math.abs(r1 - r2) - GEO.EPS) return [];
    const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
    const h2 = r1 * r1 - a * a;
    const h = h2 > 0 ? Math.sqrt(h2) : 0;
    const u = GEO.norm(GEO.sub(c2, c1));
    const m = GEO.add(c1, GEO.mul(u, a));
    const n = GEO.perp(u);
    if (h < 1e-7) return [m];
    return [GEO.add(m, GEO.mul(n, h)), GEO.sub(m, GEO.mul(n, h))];
  },

  // Arc through three points -> {c, r, a0, a1} CCW from a0 to a1 passing p2, or null.
  arc3pt(p1, p2, p3) {
    const ax = p1.x, ay = p1.y, bx = p2.x, by = p2.y, cx = p3.x, cy = p3.y;
    const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if (Math.abs(d) < 1e-9) return null;
    const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
    const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
    const c = { x: ux, y: uy };
    const r = GEO.dist(c, p1);
    let a0 = GEO.ang(c, p1), am = GEO.ang(c, p2), a1 = GEO.ang(c, p3);
    if (!GEO.angIn(am, a0, a1)) { const t = a0; a0 = a1; a1 = t; }
    return { c, r, a0: GEO.normAng(a0), a1: GEO.normAng(a1) };
  },

  // Bounding boxes: {x1,y1,x2,y2}
  bbEmpty() { return { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity }; },
  bbValid(b) { return b.x1 <= b.x2 && b.y1 <= b.y2; },
  bbAddPt(b, p) {
    b.x1 = Math.min(b.x1, p.x); b.y1 = Math.min(b.y1, p.y);
    b.x2 = Math.max(b.x2, p.x); b.y2 = Math.max(b.y2, p.y);
    return b;
  },
  bbUnion(a, b) {
    return { x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1), x2: Math.max(a.x2, b.x2), y2: Math.max(a.y2, b.y2) };
  },
  bbPad(b, d) { return { x1: b.x1 - d, y1: b.y1 - d, x2: b.x2 + d, y2: b.y2 + d }; },
  bbOverlap(a, b) { return a.x1 <= b.x2 && a.x2 >= b.x1 && a.y1 <= b.y2 && a.y2 >= b.y1; },
  bbContains(outer, inner) {
    return inner.x1 >= outer.x1 && inner.x2 <= outer.x2 && inner.y1 >= outer.y1 && inner.y2 <= outer.y2;
  },
  rectFromPts(a, b) {
    return { x1: Math.min(a.x, b.x), y1: Math.min(a.y, b.y), x2: Math.max(a.x, b.x), y2: Math.max(a.y, b.y) };
  },
  ptInRect(p, r) { return p.x >= r.x1 && p.x <= r.x2 && p.y >= r.y1 && p.y <= r.y2; },
  rectCorners(r) {
    return [{ x: r.x1, y: r.y1 }, { x: r.x2, y: r.y1 }, { x: r.x2, y: r.y2 }, { x: r.x1, y: r.y2 }];
  },
  // Does segment ab touch rect (inside or crossing boundary)?
  segTouchesRect(a, b, r) {
    if (GEO.ptInRect(a, r) || GEO.ptInRect(b, r)) return true;
    const cs = GEO.rectCorners(r);
    for (let i = 0; i < 4; i++) {
      if (GEO.segSeg(a, b, cs[i], cs[(i + 1) % 4])) return true;
    }
    return false;
  },
};

if (typeof module !== 'undefined' && module.exports) module.exports = { GEO };

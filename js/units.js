/* units.js — length parsing and formatting, including architectural (feet-inches).
   Convention: 1 drawing unit = 1 inch, so 3'6" -> 42 units.
   Accepted input: 42 · 3.5 · 1/2 · 6 1/2 · 6-1/2 · 18" · 5' · 3.5' · 3'6 ·
                   3'-6" · 3' 6 1/2" · -3'6  (the - after ' is a separator) */
'use strict';

const UNITS = {

  // paper sizes in inches (portrait W x H)
  PAPERS: {
    letter: [8.5, 11],
    'ansi-b': [11, 17],
    a4: [8.27, 11.69],
    a3: [11.69, 16.54],
    'arch-d': [24, 36],
  },
  paperDims(name, landscape) {
    const d = UNITS.PAPERS[name] || UNITS.PAPERS.letter;
    return landscape ? [d[1], d[0]] : [d[0], d[1]];
  },
  // annotation / viewport scale label: 48 -> 1/4"=1'-0"
  scaleLabel(n) {
    if (!n || Math.abs(n - 1) < 1e-9) return '1:1';
    const arch = { 192: '1/16"', 96: '1/8"', 64: '3/16"', 48: '1/4"', 32: '3/8"', 24: '1/2"', 16: '3/4"', 12: '1"' };
    if (arch[n]) return `${arch[n]}=1'-0"`;
    return `1:${+n.toFixed(4)}`;
  },

  // number token: "6", "6.5", "1/2", "6 1/2", "6-1/2" -> value | null
  _num(tok) {
    const t = String(tok).trim();
    if (!t) return null;
    let m = /^(\d+)\s*\/\s*(\d+)$/.exec(t);
    if (m) {
      const den = parseInt(m[2], 10);
      return den ? parseInt(m[1], 10) / den : null;
    }
    m = /^(\d+(?:\.\d+)?)(?:[\s-]+(\d+)\s*\/\s*(\d+))?$/.exec(t);
    if (m) {
      let v = parseFloat(m[1]);
      if (m[2]) {
        const den = parseInt(m[3], 10);
        if (!den) return null;
        v += parseInt(m[2], 10) / den;
      }
      return v;
    }
    return null;
  },

  /* Parse a length expression -> drawing units (inches), or null. */
  parseLength(str) {
    if (typeof str !== 'string') return null;
    let s = str.trim();
    if (!s) return null;
    let sign = 1;
    if (s[0] === '+' || s[0] === '-') {
      if (s[0] === '-') sign = -1;
      s = s.slice(1).trim();
      if (!s) return null;
    }
    const ftIdx = s.indexOf("'");
    if (ftIdx >= 0) {
      const feet = UNITS._num(s.slice(0, ftIdx));
      if (feet === null) return null;
      let rest = s.slice(ftIdx + 1).trim();
      rest = rest.replace(/^-/, '').trim();      // 3'-6 : the dash is a separator
      rest = rest.replace(/"$/, '').trim();
      let inches = 0;
      if (rest) {
        inches = UNITS._num(rest);
        if (inches === null) return null;
      }
      return sign * (feet * 12 + inches);
    }
    if (s.endsWith('"')) {
      const inches = UNITS._num(s.slice(0, -1));
      return inches === null ? null : sign * inches;
    }
    const v = UNITS._num(s);
    return v === null ? null : sign * v;
  },

  /* Format a length for display. mode: 'decimal' | 'architectural' */
  formatLength(v, mode, prec) {
    if (mode !== 'architectural') {
      let s = (+v).toFixed(prec == null ? 4 : prec);
      s = s.replace(/0+$/, '').replace(/\.$/, '');
      return s === '-0' ? '0' : s;
    }
    const sign = v < 0 ? '-' : '';
    const total = Math.abs(v);
    // round to nearest 1/16"
    let sixteenths = Math.round(total * 16);
    let ft = Math.floor(sixteenths / (12 * 16));
    sixteenths -= ft * 12 * 16;
    let inch = Math.floor(sixteenths / 16);
    sixteenths -= inch * 16;
    let frac = '';
    if (sixteenths > 0) {
      let n = sixteenths, d = 16;
      while (n % 2 === 0) { n /= 2; d /= 2; }
      frac = ` ${n}/${d}`;
    }
    return `${sign}${ft}'-${inch}${frac}"`;
  },
};

if (typeof module !== 'undefined' && module.exports) module.exports = { UNITS };

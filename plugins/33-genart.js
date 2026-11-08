// forge.genart — Gen-Art Studio: the "Ember Ledger" movement as seeded, parametric generative code.
// Canvas2D only. Own PRNG (mulberry32) + own gradient noise. Same seed + params + palette => same pixels.
const GA_TAU = Math.PI * 2;
const GA_mulberry = a => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const GA_hashStr = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
// 2D gradient (Perlin-style) noise with a seeded permutation, plus fbm.
function GA_noise(seed) {
  const R = GA_mulberry(seed ^ 0x9E3779B9), p = new Uint8Array(512), q = new Uint8Array(256);
  for (let i = 0; i < 256; i++) q[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(R() * (i + 1)); const t = q[i]; q[i] = q[j]; q[j] = t; }
  for (let i = 0; i < 512; i++) p[i] = q[i & 255];
  const GX = [], GY = []; for (let i = 0; i < 16; i++) { const a = (i / 16) * GA_TAU + 0.1; GX.push(Math.cos(a)); GY.push(Math.sin(a)); }
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  const g = (h, x, y) => GX[h & 15] * x + GY[h & 15] * y;
  const n = (x, y) => {
    const X = Math.floor(x), Y = Math.floor(y), xf = x - X, yf = y - Y, xi = X & 255, yi = Y & 255;
    const u = fade(xf), v = fade(yf);
    const aa = p[p[xi] + yi], ab = p[p[xi] + yi + 1], ba = p[p[xi + 1] + yi], bb = p[p[xi + 1] + yi + 1];
    const x1 = g(aa, xf, yf) + u * (g(ba, xf - 1, yf) - g(aa, xf, yf));
    const x2 = g(ab, xf, yf - 1) + u * (g(bb, xf - 1, yf - 1) - g(ab, xf, yf - 1));
    return (x1 + v * (x2 - x1)) * 1.42; // ~[-1,1]
  };
  n.fbm = (x, y, o = 4) => { let s = 0, a = 0.5, f = 1, m = 0; for (let i = 0; i < o; i++) { s += a * n(x * f + i * 17.3, y * f - i * 9.1); m += a; f *= 2.03; a *= 0.5; } return s / m; };
  return n;
}
const GA_hex = c => { c = String(c || '').trim(); if (/^#([0-9a-f]{3})$/i.test(c)) c = '#' + c.slice(1).split('').map(x => x + x).join(''); const m = /^#([0-9a-f]{6})/i.exec(c); if (m) { const v = parseInt(m[1], 16); return [v >> 16, (v >> 8) & 255, v & 255]; } const r = /rgba?\(([^)]+)\)/.exec(c); if (r) { const a = r[1].split(',').map(parseFloat); return [a[0] | 0, a[1] | 0, a[2] | 0]; } return null; };
const GA_lum = rgb => rgb ? (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255 : 0;
const GA_rgba = (rgb, a) => 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + (+a).toFixed(3) + ')';
const GA_mix = (a, b, t) => [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];
const GA_PALETTES = {
  ember: { label: 'Ember', bg: '#0f0b09', ink: ['#ff6a2b', '#ffb347', '#ffe0a8', '#e2481c', '#8a2c12'] },
  ledger: { label: 'Ledger Ink', bg: '#f2ebdd', ink: ['#7a2a14', '#1e2a38', '#b4531a', '#3f4b59', '#c98a2e'] },
  harbor: { label: 'Night Harbor', bg: '#0a0f1e', ink: ['#5eead4', '#38bdf8', '#a78bfa', '#f472b6', '#fde68a'] }
};
function GA_themePalette() {
  const cs = getComputedStyle(document.documentElement), v = k => cs.getPropertyValue(k).trim();
  const bg = v('--bg') || '#101014', ink = ['--accent', '--warn', '--violet', '--ok', '--text-2', '--danger'].map(v).filter(c => GA_hex(c));
  return { label: 'Theme', bg: GA_hex(bg) ? bg : '#101014', ink: ink.length ? ink : GA_PALETTES.ember.ink };
}
function GA_pal(id) { const P = id === 'theme' ? GA_themePalette() : (GA_PALETTES[id] || GA_PALETTES.ember); const bg = GA_hex(P.bg) || [16, 16, 20]; return { id, label: P.label, bgHex: P.bg, bg, ink: P.ink.map(GA_hex).filter(Boolean), dark: GA_lum(bg) < 0.45 }; }
const GA_LOW = (navigator.hardwareConcurrency || 8) <= 4;
const GA_CAP = GA_LOW ? 0.55 : 1;

// ---------- the four algorithms (each make() returns a step() that does one deterministic unit; true = done) ----------
const GA_ALGOS = {
  ember: {
    label: 'Flow Embers', blurb: 'Thousands of warm particles follow a seeded curl of noise; each trace is one entry in the ledger of the field.',
    params: [
      { k: 'count', label: 'Embers', min: 200, max: 2400, step: 50, def: 1100 },
      { k: 'length', label: 'Trail length', min: 30, max: 260, step: 5, def: 120 },
      { k: 'scale', label: 'Field scale', min: 0.5, max: 5, step: 0.1, def: 1.7 },
      { k: 'twist', label: 'Turbulence', min: 0, max: 2, step: 0.05, def: 0.8 },
      { k: 'heat', label: 'Heat', min: 0.1, max: 1, step: 0.05, def: 0.55 }
    ],
    make(g, W, H, R, N, P, pal, cap) {
      const k = W / 1000, total = Math.max(20, Math.round(P.count * cap)), sc = P.scale / W, inks = pal.ink;
      g.globalCompositeOperation = pal.dark ? 'lighter' : 'multiply'; g.lineCap = 'round'; let i = 0;
      return () => {
        // rejection-sample a start point: embers gather where the field is warm
        let x, y, tries = 0; do { x = R() * W; y = R() * H; tries++; } while (tries < 6 && (N.fbm(x * sc * 0.6 + 40, y * sc * 0.6) + 1) / 2 < R() * 0.9);
        const ci = Math.floor(Math.pow(R(), 1.6) * inks.length), col = inks[ci], len = Math.round(P.length * (0.4 + R() * 0.8)), sp = (1.2 + R() * 1.4) * k * 1.6;
        const w = (0.35 + Math.pow(R(), 2) * 1.8) * k * 1.4, a = P.heat * (pal.dark ? 0.32 : 0.5) * (0.25 + R() * 0.75);
        g.strokeStyle = GA_rgba(col, a); g.lineWidth = w; g.beginPath(); g.moveTo(x, y);
        for (let s = 0; s < len; s++) {
          const ang = N.fbm(x * sc, y * sc, 3) * GA_TAU * (1 + P.twist) + N(x * sc * 3.1, y * sc * 3.1) * P.twist;
          x += Math.cos(ang) * sp; y += Math.sin(ang) * sp; if (x < -20 || y < -20 || x > W + 20 || y > H + 20) break; g.lineTo(x, y);
        }
        g.stroke();
        if (R() < 0.12 + P.heat * 0.15) { g.fillStyle = GA_rgba(inks[Math.min(inks.length - 1, 2)] || col, Math.min(1, a * 2.6)); g.beginPath(); g.arc(x, y, w * (1.2 + R() * 2.2), 0, GA_TAU); g.fill(); }
        return ++i >= total;
      };
    }
  },
  ledger: {
    label: 'Crystal Ledger', blurb: 'A ruled ledger receives tally marks cell by cell; where the field runs hot, the count crystallizes into nested squares.',
    params: [
      { k: 'cols', label: 'Columns', min: 6, max: 40, step: 1, def: 16 },
      { k: 'density', label: 'Tally density', min: 0.1, max: 1, step: 0.05, def: 0.6 },
      { k: 'crystal', label: 'Crystallize', min: 0, max: 1, step: 0.05, def: 0.38 },
      { k: 'jitter', label: 'Hand jitter', min: 0, max: 1, step: 0.05, def: 0.35 },
      { k: 'ink', label: 'Ink weight', min: 0.3, max: 2, step: 0.05, def: 1 }
    ],
    make(g, W, H, R, N, P, pal, cap) {
      const cols = Math.round(P.cols), cw = W / (cols + 2), rows = Math.max(2, Math.floor(H / cw) - 2), ox = cw, oy = (H - rows * cw) / 2, k = W / 1000, inks = pal.ink;
      const rule = GA_mix(pal.bg, inks[1] || inks[0], 0.22), margin = inks[0];
      g.lineCap = 'round'; g.lineWidth = k * 0.8; g.strokeStyle = GA_rgba(rule, 0.9);
      for (let r = 0; r <= rows; r++) { g.beginPath(); g.moveTo(ox * 0.4, oy + r * cw); g.lineTo(W - ox * 0.4, oy + r * cw); g.stroke(); }
      g.strokeStyle = GA_rgba(margin, 0.55); g.lineWidth = k * 1.4; g.beginPath(); g.moveTo(ox + cw * 0.9, oy - cw * 0.5); g.lineTo(ox + cw * 0.9, oy + rows * cw + cw * 0.5); g.stroke();
      const J = () => (R() - 0.5) * P.jitter * cw * 0.12;
      const stroke = (x1, y1, x2, y2, w, col, a) => { g.strokeStyle = GA_rgba(col, a); g.lineWidth = w; g.beginPath(); g.moveTo(x1 + J(), y1 + J()); g.quadraticCurveTo((x1 + x2) / 2 + J() * 2, (y1 + y2) / 2 + J() * 2, x2 + J(), y2 + J()); g.stroke(); };
      let r = 0;
      return () => {
        for (let c = 0; c < cols; c++) {
          const x = ox + c * cw, y = oy + r * cw, f = (N.fbm(c * 0.13 + 3.7, r * 0.13 - 1.1, 4) + 1) / 2, m = cw * 0.16;
          if (f > 0.74 - P.crystal * 0.32 && R() < 0.85) { // crystallized cell: nested, slightly rotated squares
            const col = inks[(c + r) % 2 ? 0 : Math.min(2, inks.length - 1)], depth = 2 + Math.floor(R() * 4);
            g.fillStyle = GA_rgba(col, pal.dark ? 0.22 : 0.16); g.fillRect(x + m, y + m, cw - 2 * m, cw - 2 * m);
            for (let d = 0; d < depth; d++) { const s = (cw - 2 * m) * (1 - d / (depth + 0.6)), cx = x + cw / 2, cy = y + cw / 2, rot = (R() - 0.5) * 0.18 * d; g.save(); g.translate(cx, cy); g.rotate(rot); g.strokeStyle = GA_rgba(col, 0.75 - d * 0.1); g.lineWidth = k * P.ink * (1.6 - d * 0.2); g.strokeRect(-s / 2, -s / 2, s, s); g.restore(); }
            if (R() < 0.5) { g.fillStyle = GA_rgba(inks[1] || col, 0.9); g.beginPath(); g.arc(x + cw / 2, y + cw / 2, k * 2.2 * P.ink, 0, GA_TAU); g.fill(); }
          } else { // tally marks in groups of five
            const n = Math.floor(f * P.density * 13 * (0.6 + R() * 0.6)), col = inks[1] || inks[0];
            for (let t = 0; t < n; t++) {
              const grp = Math.floor(t / 5), within = t % 5, gx = x + m + (grp % 2) * (cw - 2 * m) / 2, gy = y + m + Math.floor(grp / 2) * (cw - 2 * m) / 2, gw = (cw - 2 * m) / 2, gh = (cw - 2 * m) / 2;
              if (gy + gh > y + cw - m + 1) break;
              if (within < 4) { const tx = gx + gw * (0.18 + within * 0.2); stroke(tx, gy + gh * 0.12, tx, gy + gh * 0.88, k * P.ink * 1.1, col, 0.8); }
              else stroke(gx + gw * 0.05, gy + gh * 0.8, gx + gw * 0.95, gy + gh * 0.2, k * P.ink * 1.2, inks[0], 0.85);
            }
          }
        }
        return ++r >= rows;
      };
    }
  },
  orbit: {
    label: 'Orbital Harmonics', blurb: 'Damped pendulums in near-integer ratios trace an orbit; tiny drifts of tuning accumulate into a woven record of time.',
    params: [
      { k: 'ratio', label: 'Ratio complexity', min: 1, max: 7, step: 1, def: 3 },
      { k: 'damping', label: 'Damping', min: 0.0005, max: 0.01, step: 0.0005, def: 0.0025 },
      { k: 'points', label: 'Points (k)', min: 20, max: 220, step: 5, def: 110 },
      { k: 'detune', label: 'Detune', min: 0, max: 0.03, step: 0.001, def: 0.006 },
      { k: 'layers', label: 'Layers', min: 1, max: 5, step: 1, def: 3 }
    ],
    make(g, W, H, R, N, P, pal, cap) {
      const L = Math.round(P.layers), inks = pal.ink, k = W / 1000, total = Math.round(P.points * 1000 * cap), per = Math.ceil(total / L), dt = 0.011, A = Math.min(W, H) * 0.23;
      const layers = []; for (let l = 0; l < L; l++) { const f = () => 1 + Math.floor(R() * (P.ratio + 1)) + (R() - 0.5) * P.detune * 2; layers.push({ f: [f(), f(), f(), f()], ph: [R() * GA_TAU, R() * GA_TAU, R() * GA_TAU, R() * GA_TAU], a: [0.6 + R() * 0.4, 0.6 + R() * 0.4, 0.6 + R() * 0.4, 0.6 + R() * 0.4], c0: inks[l % inks.length], c1: inks[(l + 1) % inks.length], rot: R() * GA_TAU }); }
      g.globalCompositeOperation = pal.dark ? 'lighter' : 'multiply'; let i = 0; const sz = Math.max(1, k * 1.25);
      return () => {
        const end = Math.min(total, i + 4000);
        for (; i < end; i++) {
          const ly = layers[i % L], j = Math.floor(i / L), t = j * dt, e = Math.exp(-P.damping * t * 2.2), F = ly.f, Ph = ly.ph, Aa = ly.a;
          let x = Aa[0] * Math.sin(F[0] * t + Ph[0]) + Aa[1] * Math.sin(F[1] * t + Ph[1]), y = Aa[2] * Math.sin(F[2] * t + Ph[2]) + Aa[3] * Math.sin(F[3] * t + Ph[3]);
          const cr = Math.cos(ly.rot), sr = Math.sin(ly.rot); const X = W / 2 + (x * cr - y * sr) * A * e, Y = H / 2 + (x * sr + y * cr) * A * e;
          const u = j / per; g.fillStyle = GA_rgba(GA_mix(ly.c0, ly.c1, u), (pal.dark ? 0.09 : 0.12) * (0.4 + 0.6 * e)); g.fillRect(X, Y, sz, sz);
        }
        return i >= total;
      };
    }
  },
  branch: {
    label: 'Ink Branches', blurb: 'From a single ledger baseline, recursive strokes branch and bend in the field; tips end in embers, joints pool ink.',
    params: [
      { k: 'roots', label: 'Roots', min: 1, max: 7, step: 1, def: 3 },
      { k: 'depth', label: 'Depth', min: 4, max: 11, step: 1, def: 8 },
      { k: 'spread', label: 'Spread', min: 0.1, max: 1.2, step: 0.05, def: 0.5 },
      { k: 'decay', label: 'Length decay', min: 0.6, max: 0.86, step: 0.01, def: 0.76 },
      { k: 'ink', label: 'Ink & embers', min: 0, max: 1, step: 0.05, def: 0.5 }
    ],
    make(g, W, H, R, N, P, pal, cap) {
      const inks = pal.ink, k = W / 1000, D = Math.round(P.depth), base = H * 0.9, stack = [], roots = Math.round(P.roots); let done = 0; const maxSeg = Math.round(24000 * cap);
      g.strokeStyle = GA_rgba(inks[1] || inks[0], 0.55); g.lineWidth = k * 1.2; g.beginPath(); g.moveTo(W * 0.06, base); g.lineTo(W * 0.94, base); g.stroke();
      for (let i = 0; i < roots; i++) stack.push({ x: W * (i + 0.5) / roots + (R() - 0.5) * W * 0.08, y: base, a: -Math.PI / 2 + (R() - 0.5) * 0.3, len: H * (0.105 + R() * 0.05), w: k * (7 + R() * 5), d: D });
      g.lineCap = 'round'; g.lineJoin = 'round';
      return () => {
        for (let b = 0; b < 30 && stack.length; b++) {
          const s = stack.pop(); let x = s.x, y = s.y, a = s.a; const t = 1 - s.d / D, col = GA_mix(inks[1] || inks[0], inks[0], Math.min(1, t * 1.2));
          g.strokeStyle = GA_rgba(col, 0.85); g.lineWidth = Math.max(0.4 * k, s.w); g.beginPath(); g.moveTo(x, y);
          for (let q = 0; q < 6; q++) { a += N(x / W * 3.2, y / W * 3.2) * 0.12; x += Math.cos(a) * s.len / 6; y += Math.sin(a) * s.len / 6; g.lineTo(x, y); }
          g.stroke(); done++;
          if (s.d > 0 && done < maxSeg) {
            const kids = R() < 0.18 ? 3 : 2;
            for (let c = 0; c < kids; c++) { const side = kids === 2 ? (c ? 1 : -1) : c - 1; stack.push({ x, y, a: a + side * P.spread * (0.45 + R() * 0.7) + (R() - 0.5) * 0.2, len: s.len * P.decay * (0.8 + R() * 0.4), w: s.w * 0.68, d: s.d - 1 }); }
            if (R() < P.ink * 0.06) { const rr = s.w * (2 + R() * 3); const gr = g.createRadialGradient(x, y, 0, x, y, rr); gr.addColorStop(0, GA_rgba(col, 0.5)); gr.addColorStop(1, GA_rgba(col, 0)); g.fillStyle = gr; g.beginPath(); g.arc(x, y, rr, 0, GA_TAU); g.fill(); }
          } else if (R() < 0.3 + P.ink * 0.6) { const ec = inks[2 + Math.floor(R() * Math.max(1, inks.length - 2))] || inks[0]; g.fillStyle = GA_rgba(ec, 0.9); g.beginPath(); g.arc(x, y, k * (1.4 + R() * 3.2), 0, GA_TAU); g.fill(); }
        }
        return !stack.length;
      };
    }
  }
};
const GA_IDS = Object.keys(GA_ALGOS);
const GA_defaults = id => Object.fromEntries(GA_ALGOS[id].params.map(p => [p.k, p.def]));
const GA_clampParams = (id, P) => { const o = GA_defaults(id); for (const p of GA_ALGOS[id].params) if (P && P[p.k] != null && isFinite(+P[p.k])) o[p.k] = Math.min(p.max, Math.max(p.min, +P[p.k])); return o; };

// prepare a canvas and return a job (step function). The same inputs always yield the same pixels.
function GA_job(cv, { algorithm, seed, params, palette, width, height, cap }) {
  const id = GA_ALGOS[algorithm] ? algorithm : 'ember', W = cv.width = Math.round(width), H = cv.height = Math.round(height || width), g = cv.getContext('2d');
  const pal = GA_pal(palette || 'ember'), sd = (seed >>> 0), R = GA_mulberry(sd ^ GA_hashStr(id)), N = GA_noise(sd);
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; g.fillStyle = pal.bgHex; g.fillRect(0, 0, W, H);
  // paper grain + a warm vignette: the ground every ledger is written on
  const GR = GA_mulberry(sd ^ 0xA11CE), gc = pal.dark ? [255, 255, 255] : [60, 40, 20];
  for (let i = 0, n = Math.round(W * H / 900); i < n; i++) { g.fillStyle = GA_rgba(gc, 0.018 + GR() * 0.03); g.fillRect(GR() * W, GR() * H, 1 + GR() * (W / 700), 1 + GR() * (W / 700)); }
  const vg = g.createRadialGradient(W / 2, H * 0.55, Math.min(W, H) * 0.2, W / 2, H / 2, Math.max(W, H) * 0.75); vg.addColorStop(0, GA_rgba(pal.ink[0] || [255, 120, 40], pal.dark ? 0.06 : 0.03)); vg.addColorStop(1, GA_rgba(pal.dark ? [0, 0, 0] : [90, 60, 30], pal.dark ? 0.35 : 0.08)); g.fillStyle = vg; g.fillRect(0, 0, W, H);
  const P = GA_clampParams(id, params), step = GA_ALGOS[id].make(g, W, H, R, N, P, pal, cap == null ? GA_CAP : cap);
  return { step, finish: () => { g.globalCompositeOperation = 'source-over'; }, id, seed: sd, P, pal };
}
const GA_runSync = job => { let guard = 0; while (!job.step() && guard++ < 2e6); job.finish(); };
function GA_runProgressive(job, onProgress, onDone) {
  let raf = 0, dead = false, units = 0;
  const tick = () => { if (dead) return; const t0 = performance.now(); let done = false; while (!(done = job.step()) && performance.now() - t0 < 9) units++; units++; if (onProgress) onProgress(units); if (done) { job.finish(); dead = true; if (onDone) onDone(); } else raf = requestAnimationFrame(tick); };
  raf = requestAnimationFrame(tick); return () => { dead = true; cancelAnimationFrame(raf); };
}

DS.plugin({
  name: 'forge.genart', title: 'Gen-Art Studio', version: '1.0.0', tags: ['art', 'generative', 'canvas'],
  description: 'Ember Ledger generative art: four seeded algorithms (flow embers, crystal ledger, orbital harmonics, ink branches), PNG export to /art, agent tool genart_create, /art command and an animated backdrop.',
  apply(ctx) {
    const U = DS.util, esc = U.esc;
    DS.icons.spiral = DS.icons.spiral || '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 12.5a1 1 0 0 1-1-1 2 2 0 0 1 2-2 3 3 0 0 1 3 3 4 4 0 0 1-4 4 5 5 0 0 1-5-5 6 6 0 0 1 6-6 7 7 0 0 1 7 7 8 8 0 0 1-8 8"/></svg>';
    const st = Object.assign({ algo: 'ember', palette: 'ember', seeds: {}, params: {} }, ctx.data.get('state', {}));
    const save = () => ctx.data.set('state', st);
    const seedOf = id => (st.seeds[id] != null ? st.seeds[id] : 1) >>> 0;
    const paramsOf = id => GA_clampParams(id, st.params[id]);
    const pathFor = (id, seed) => '/art/' + id + '-' + seed + '.png';
    const thr = t => (t && t.thread) || DS.store.activeThread() || DS.store.newThread();
    function render(o) { const cv = document.createElement('canvas'); GA_runSync(GA_job(cv, Object.assign({ width: 1024 }, o))); return cv; }
    async function savePng(cv, id, seed, tctx) {
      const path = pathFor(id, seed), data = cv.toDataURL('image/png');
      if (tctx) { let before = null; try { if (await DS.fs.exists(path)) before = (await DS.fs.read(path)).content; } catch (_) {} DS.agent.recordChange(thr(tctx), path, before); }
      await DS.fs.write(path, data); DS.bus.emit('media:update', path); DS.bus.emit('genart:saved', path); return path;
    }
    async function create(args, tctx) {
      args = args || {}; const id = GA_ALGOS[args.algorithm] ? args.algorithm : (GA_IDS.find(k => new RegExp(k, 'i').test(String(args.algorithm || ''))) || 'ember');
      const seed = args.seed != null && isFinite(+args.seed) ? (+args.seed >>> 0) : Math.floor(Math.random() * 1e6);
      const size = Math.min(2048, Math.max(256, +args.size || 1024)), palette = args.palette && (args.palette === 'theme' || GA_PALETTES[args.palette]) ? args.palette : 'ember';
      const params = GA_clampParams(id, args.params), cv = render({ algorithm: id, seed, params, palette, width: size });
      const path = await savePng(cv, id, seed, tctx || {});
      return { path, seed, algorithm: id, title: GA_ALGOS[id].label, palette, size, params };
    }
    ctx.provide('forge.genart', { algorithms: () => GA_IDS.map(id => ({ id, label: GA_ALGOS[id].label, params: GA_ALGOS[id].params })), palettes: () => ['theme'].concat(Object.keys(GA_PALETTES)), render, create, open: (id, seed) => { if (GA_ALGOS[id]) st.algo = id; if (seed != null) st.seeds[st.algo] = seed >>> 0; save(); DS.shell.show('genart'); DS.bus.emit('genart:state'); } });

    ctx.effect(() => { const s = document.createElement('style'); s.textContent = `
.ga-v .vscroll{padding:12px 16px 28px}
.ga-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:14px;max-width:1100px;margin:0 auto}
@media(min-width:820px){.ga-grid{grid-template-columns:minmax(0,1.25fr) minmax(280px,1fr)}}
.ga-stage{position:relative;border-radius:var(--radius);overflow:hidden;border:1px solid var(--line);background:var(--bg-2);aspect-ratio:1/1;width:100%}
.ga-stage canvas{display:block;width:100%;height:100%}
.ga-bar{position:absolute;left:0;bottom:0;height:3px;background:var(--accent);transition:width .15s,opacity .4s;width:0}
.ga-tag{position:absolute;left:10px;top:10px;font:600 11px var(--mono);padding:4px 8px;border-radius:999px;background:color-mix(in srgb,var(--bg) 70%,transparent);color:var(--text);backdrop-filter:blur(6px)}
.ga-algos{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}
.ga-algos button{min-height:44px;padding:6px 4px;font-size:12px;line-height:1.15;border-radius:10px;border:1px solid var(--line);background:var(--card);color:var(--text-2);cursor:pointer}
.ga-algos button.on{border-color:var(--accent-line);background:var(--accent-soft);color:var(--text);font-weight:600}
.ga-blurb{font-size:13px;color:var(--muted);margin:2px 0 0;line-height:1.45}
.ga-seed{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.ga-seed .inp{width:110px;min-height:40px;font-family:var(--mono)}
.ga-seed .icon-btn{min-width:40px;min-height:40px}
.ga-sl{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 10px;align-items:center;margin:6px 0}
.ga-sl label{font-size:13px;color:var(--text-2)} .ga-sl output{font:12px var(--mono);color:var(--muted)}
.ga-sl input[type=range]{grid-column:1/-1;width:100%;accent-color:var(--accent);min-height:28px}
.ga-pals{display:flex;gap:6px;flex-wrap:wrap}
.ga-pals button{display:flex;align-items:center;gap:6px;min-height:40px;padding:4px 10px;border-radius:999px;border:1px solid var(--line);background:var(--card);color:var(--text-2);font-size:12px;cursor:pointer}
.ga-pals button.on{border-color:var(--accent-line);color:var(--text);background:var(--accent-soft)}
.ga-sw{display:flex}.ga-sw i{width:10px;height:10px;border-radius:50%;margin-left:-3px;border:1px solid var(--line)}
.ga-acts{display:flex;gap:8px;flex-wrap:wrap}.ga-acts .btn{min-height:40px}
.ga-path{font:12px var(--mono);color:var(--muted);word-break:break-all}
.ga-gal{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:6px}
.ga-gal button{padding:0;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--bg-2);cursor:pointer;aspect-ratio:1/1;position:relative}
.ga-gal button.on{outline:2px solid var(--accent);outline-offset:1px}
.ga-gal canvas{width:100%;height:100%;display:block}
.ga-gal span{position:absolute;right:3px;bottom:2px;font:600 9px var(--mono);color:#fff;text-shadow:0 1px 2px #000}
.ga-card{padding:12px;border:1px solid var(--line);border-radius:var(--radius);background:var(--card)}
.ga-card+.ga-card{margin-top:10px}
.ga-man{font-size:12.5px;color:var(--muted);line-height:1.5;font-style:italic}
.ga-inline img{max-width:min(100%,320px);border-radius:10px;display:block;border:1px solid var(--line)}
`; document.head.appendChild(s); return () => s.remove(); });

    // ---------- Studio view ----------
    ctx.view({ id: 'genart', title: 'Gen-Art', icon: 'spiral', order: 33,
      mount(el) {
        el.classList.add('ga-v');
        el.innerHTML = `<div class="vhead"><h2>Gen-Art Studio</h2><span class="chip acc">Ember Ledger</span></div><div class="vscroll"><div class="ga-grid">
          <div><div class="ga-stage"><canvas data-g="main" aria-label="generative artwork"></canvas><div class="ga-tag" data-g="tag"></div><div class="ga-bar" data-g="bar"></div></div>
            <div class="ga-card" style="margin-top:10px"><div class="sec-t">Gallery · next six seeds</div><div class="ga-gal" data-g="gal"></div></div></div>
          <div><div class="ga-card"><div class="ga-algos" data-g="algos"></div><p class="ga-blurb" data-g="blurb"></p></div>
            <div class="ga-card"><div class="sec-t">Seed</div><div class="ga-seed">
              <button class="icon-btn" data-a="prev" title="Previous seed" aria-label="Previous seed">‹</button>
              <input class="inp" data-g="seed" inputmode="numeric" aria-label="Seed">
              <button class="icon-btn" data-a="next" title="Next seed" aria-label="Next seed">›</button>
              <button class="btn sm" data-a="jump">Jump</button><button class="btn sm" data-a="rand" title="Random seed">🎲 Random</button></div></div>
            <div class="ga-card"><div class="sec-t">Parameters</div><div data-g="params"></div></div>
            <div class="ga-card"><div class="sec-t">Palette</div><div class="ga-pals" data-g="pals"></div></div>
            <div class="ga-card"><div class="ga-acts"><button class="btn pri" data-a="regen">Regenerate</button><button class="btn" data-a="reset">Reset</button><button class="btn" data-a="dl">${DS.icon ? DS.icon('download') : ''} Download PNG</button></div>
              <div class="ga-path" data-g="path" style="margin-top:8px"></div></div>
            <div class="ga-card"><div class="ga-man">Ember Ledger — every image is a record of many small warm marks, each placed by an algorithm and kept exactly: the same seed always writes the same page.</div></div>
          </div></div></div>`;
        const $ = s => el.querySelector('[data-g="' + s + '"]'), main = $('main'), bar = $('bar');
        let cancel = null, galCancel = null, deb = 0;
        const size = () => { const r = main.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1); return Math.max(360, Math.min(GA_LOW ? 900 : 1400, Math.round((r.width || 360) * dpr))); };
        function draw() {
          if (cancel) cancel(); const id = st.algo, seed = seedOf(id), job = GA_job(main, { algorithm: id, seed, params: paramsOf(id), palette: st.palette, width: size() });
          main.dataset.done = '0'; main.dataset.seed = seed; main.dataset.algo = id; $('tag').textContent = GA_ALGOS[id].label + ' · #' + seed;
          bar.style.opacity = 1; bar.style.width = '4%'; let est = 1;
          cancel = GA_runProgressive(job, u => { est = Math.max(est, u * 1.25); bar.style.width = Math.min(96, 4 + 92 * u / est) + '%'; }, () => { bar.style.width = '100%'; setTimeout(() => { bar.style.opacity = 0; }, 200); main.dataset.done = '1'; cancel = null; });
        }
        function gallery() {
          if (galCancel) galCancel(); const gal = $('gal'), id = st.algo, s0 = seedOf(id); gal.innerHTML = ''; const list = [];
          for (let i = 0; i < 6; i++) { const sd = s0 + i, b = U.el('button', { title: 'Seed ' + sd, 'data-seed': sd }); if (!i) b.classList.add('on'); const c = document.createElement('canvas'); b.appendChild(c); b.appendChild(U.el('span', {}, '#' + sd)); b.onclick = () => { st.seeds[id] = sd; save(); sync(); }; gal.appendChild(b); list.push([c, sd]); }
          let k = 0, stop = null; const next = () => { if (k >= list.length) { galCancel = null; return; } const [c, sd] = list[k++]; stop = GA_runProgressive(GA_job(c, { algorithm: id, seed: sd, params: paramsOf(id), palette: st.palette, width: 160, cap: GA_CAP * 0.45 }), null, next); };
          next(); galCancel = () => { k = 99; if (stop) stop(); };
        }
        function controls() {
          const id = st.algo, A = GA_ALGOS[id];
          $('algos').innerHTML = GA_IDS.map(k => `<button data-al="${k}" class="${k === id ? 'on' : ''}">${esc(GA_ALGOS[k].label)}</button>`).join('');
          $('blurb').textContent = A.blurb; $('seed').value = seedOf(id);
          const P = paramsOf(id); $('params').innerHTML = A.params.map(p => `<div class="ga-sl"><label for="ga-${p.k}">${esc(p.label)}</label><output data-o="${p.k}">${+P[p.k]}</output><input id="ga-${p.k}" type="range" data-p="${p.k}" min="${p.min}" max="${p.max}" step="${p.step}" value="${P[p.k]}"></div>`).join('');
          $('pals').innerHTML = ['theme'].concat(Object.keys(GA_PALETTES)).map(k => { const p = GA_pal(k); return `<button data-pal="${k}" class="${k === st.palette ? 'on' : ''}"><span class="ga-sw">${p.ink.slice(0, 4).map(c => `<i style="background:rgb(${c})"></i>`).join('')}</span>${esc(p.label)}</button>`; }).join('');
        }
        function sync() { controls(); draw(); gallery(); }
        el.addEventListener('input', e => { const p = e.target.dataset.p; if (!p) return; const id = st.algo; st.params[id] = Object.assign(paramsOf(id), { [p]: +e.target.value }); el.querySelector('[data-o="' + p + '"]').textContent = +e.target.value; save(); clearTimeout(deb); deb = setTimeout(() => { draw(); gallery(); }, 160); });
        el.addEventListener('keydown', e => { if (e.target === $('seed') && e.key === 'Enter') { e.preventDefault(); jump(); } });
        const setSeed = v => { st.seeds[st.algo] = (Math.max(0, Math.floor(+v) || 0)) >>> 0; save(); sync(); };
        const jump = () => setSeed($('seed').value);
        el.addEventListener('click', async e => {
          const al = e.target.closest('[data-al]'), pal = e.target.closest('[data-pal]'), a = e.target.closest('[data-a]');
          if (al) { st.algo = al.dataset.al; save(); return sync(); }
          if (pal) { st.palette = pal.dataset.pal; save(); return sync(); }
          if (!a) return; const id = st.algo, s = seedOf(id);
          if (a.dataset.a === 'prev') setSeed(Math.max(0, s - 1)); else if (a.dataset.a === 'next') setSeed(s + 1); else if (a.dataset.a === 'rand') setSeed(Math.floor(Math.random() * 1e6)); else if (a.dataset.a === 'jump') jump();
          else if (a.dataset.a === 'regen') draw();
          else if (a.dataset.a === 'reset') { delete st.params[id]; save(); sync(); ctx.toast('Parameters reset', 'ok', 1200); }
          else if (a.dataset.a === 'dl') {
            const fin = main.dataset.done === '1' ? main : render({ algorithm: id, seed: s, params: paramsOf(id), palette: st.palette, width: main.width });
            const path = await savePng(fin, id, s, null); $('path').innerHTML = 'Saved to <b>' + esc(path) + '</b>';
            try { fin.toBlob(b => { if (b) U.download(id + '-' + s + '.png', b, 'image/png'); }, 'image/png'); } catch (_) {}
            ctx.toast('Saved ' + path, 'ok', 1800);
          }
        });
        const onState = () => sync(); DS.bus.on('genart:state', onState);
        const ro = window.ResizeObserver ? new ResizeObserver(U.debounce(() => { if (Math.abs(size() - main.width) > 40) draw(); }, 250)) : null; if (ro) ro.observe(el.querySelector('.ga-stage'));
        el._gaSync = sync; sync();
        return () => { if (cancel) cancel(); if (galCancel) galCancel(); if (ro) ro.disconnect(); DS.bus.off && DS.bus.off('genart:state', onState); clearTimeout(deb); };
      },
      onShow(el) { if (el._gaSync && el.querySelector('[data-g="main"]').dataset.done !== '1') el._gaSync(); }
    });

    // ---------- agent tool ----------
    const resOf = part => { let r = part && part.result; if (typeof r === 'string') { try { r = JSON.parse(r); } catch (_) {} } return r || {}; };
    ctx.tool({ name: 'genart_create', label: 'Generative art', gate: 'none',
      description: 'Render seeded generative art (Ember Ledger movement) offscreen and save a PNG at /art/<algorithm>-<seed>.png. algorithm: ember (flow-field ember trails), ledger (tally grid that crystallizes), orbit (orbital harmonics / harmonograph), branch (recursive ink branches). Same seed + params => identical image. Returns {path, seed, algorithm}. Show it with a ```image fence containing the path.',
      parameters: { type: 'object', properties: { algorithm: { type: 'string', enum: GA_IDS }, seed: { type: 'integer' }, palette: { type: 'string', enum: ['theme'].concat(Object.keys(GA_PALETTES)) }, size: { type: 'integer', description: '256-2048, default 1024' },
        params: { type: 'object', description: 'Per-algorithm numbers: ' + GA_IDS.map(id => id + ': ' + GA_ALGOS[id].params.map(p => p.k + ' ' + p.min + '-' + p.max).join(', ')).join(' | ') } }, required: ['algorithm'] },
      detail: a => ({ path: '/art/' + (a.algorithm || 'ember') + '-' + (a.seed != null ? a.seed : '*') + '.png' }),
      run: create, summarize: (a, r) => r && r.path ? r.path + ' · seed ' + r.seed : 'gen-art',
      inline(part, el) { const r = resOf(part); if (!r.path) return; el.innerHTML = ''; const w = U.el('div', { class: 'ga-inline' }), im = U.el('img', { alt: r.title + ' seed ' + r.seed }); w.appendChild(im); const cap = U.el('div', { class: 'xs muted mono' }, esc(r.path) + ' · <a href="#" data-open>open in studio</a>'); w.appendChild(cap); el.appendChild(w);
        DS.fs.read(r.path).then(f => { if (f && f.content) im.src = f.content; }).catch(() => {}); im.onclick = cap.querySelector('[data-open]').onclick = e => { e.preventDefault(); ctx.service('forge.genart').open(r.algorithm, r.seed); }; } });

    // ---------- /art command ----------
    ctx.command({ name: 'art', args: '[ember|ledger|orbit|branch] [seed]', desc: 'Generative art: open the studio, or render an algorithm + seed to /art',
      async run(argText, cctx) {
        const parts = String(argText || '').trim().split(/\s+/).filter(Boolean); if (!parts.length) { DS.shell.show('genart'); return; }
        const id = GA_IDS.find(k => k.startsWith(parts[0].toLowerCase())) || 'ember', sd = parts.find(p => /^\d+$/.test(p));
        const r = await create({ algorithm: id, seed: sd != null ? +sd : undefined, palette: st.palette }, { thread: cctx && cctx.thread });
        cctx.reply(`**${r.title}** · seed \`${r.seed}\`\n\n\`\`\`image\n${r.path}\n\`\`\`\n\nSaved to \`${r.path}\`. Same seed, same image — try \`/art ${id} ${r.seed + 1}\` or open the **Gen-Art** studio.`);
      } });

    // ---------- offline Sim intent + suggest ----------
    const pick = t => /ledger|grid|tally|crystal/i.test(t) ? 'ledger' : /orbit|harmon|pendul|spiro|lissajous/i.test(t) ? 'orbit' : /branch|tree|ink|root|recurs/i.test(t) ? 'branch' : 'ember';
    ctx.intent({ id: 'genart', order: 45 /* more specific than media-image */, match: t => /\b(generative|algorithmic|procedural)\s+art\b|\bgen-?art\b|\bflow[- ]?field\b|\bember ledger\b|\b(draw|make|render|create)\b.*\b(orbital harmonics?|harmonograph|ink branches|crystal ledger)\b/i.test(t),
      script: t => { const id = pick(t), m = /seed\s*#?\s*(\d+)/i.exec(t), seed = m ? +m[1] : (GA_hashStr(t) % 100000); return [
        { say: `Rendering **${GA_ALGOS[id].label}** (Ember Ledger) with seed ${seed}…`, tool: { name: 'genart_create', args: { algorithm: id, seed } } },
        { final: rs => { const r = rs[0] || {}; return r.path ? `Here is **${r.title}**, seed \`${r.seed}\`:\n\n\`\`\`image\n${r.path}\n\`\`\`\n\nSaved to \`${r.path}\`. The same seed always reproduces this exact image; open **Gen-Art** to sweep seeds, tune the ${GA_ALGOS[id].params.length} parameters or switch palettes.` : 'Generative render failed: ' + JSON.stringify(r); } }]; } });
    ctx.suggest({ id: 'genart', emoji: '🌀', title: 'Make generative art', sub: 'Seeded flow-field embers', prompt: 'Make generative art: a flow field of ember trails, seed 7' });
    ctx.prompt({ id: 'genart', text: 'Generative art: genart_create{algorithm: ember|ledger|orbit|branch, seed?, palette?: theme|ember|ledger|harbor, params?} renders deterministic seeded art to /art/<algo>-<seed>.png (show with an ```image fence). The Gen-Art Studio view lets the user tune seeds/params.' });

    // ---------- animated backdrop ----------
    if (ctx.backdrop) ctx.backdrop({ id: 'ember-ledger', label: 'Ember Ledger', group: 'Generative', still: 'radial-gradient(120% 90% at 50% 100%, rgba(255,106,43,.18), transparent 60%)',
      start(host, o) {
        o = o || {}; const dpr = Math.min(2, o.dpr || window.devicePixelRatio || 1), cv = document.createElement('canvas'); cv.className = 'ga-backdrop'; cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none'; host.appendChild(cv);
        const g = cv.getContext('2d'); let W = 0, H = 0, raf = 0, dead = false, last = 0;
        const pal = () => { const p = GA_pal('theme'); return p.ink.length ? p : GA_pal('ember'); };
        let P = pal(); const N = GA_noise(20261026), R = GA_mulberry(77);
        const size = () => { W = host.clientWidth || innerWidth; H = host.clientHeight || innerHeight; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = P.bgHex; g.fillRect(0, 0, W, H); };
        size();
        if (o.reduced) { // honour reduced motion: one still ledger page, no loop
          const off = document.createElement('canvas'); GA_runSync(GA_job(off, { algorithm: 'ember', seed: 20261026, params: { count: 500, length: 90 }, palette: 'theme', width: Math.round(Math.max(W, H) * dpr), cap: 0.6 }));
          g.drawImage(off, 0, 0, off.width, off.height, 0, 0, Math.max(W, H), Math.max(W, H)); cv.dataset.still = '1';
          return () => { cv.remove(); };
        }
        const n = Math.round((o.quality === 'low' ? 140 : o.quality === 'high' ? 520 : 300) * GA_CAP), pts = [];
        const spawn = p => { p.x = R() * W; p.y = R() * H; p.life = 60 + R() * 220; p.c = P.ink[Math.floor(Math.pow(R(), 1.5) * P.ink.length)]; p.w = 0.5 + R() * 1.3; return p; };
        for (let i = 0; i < n; i++) pts.push(spawn({}));
        const onR = U.debounce ? U.debounce(size, 200) : size; addEventListener('resize', onR);
        const frame = t => {
          if (dead) return; raf = requestAnimationFrame(frame); if (t - last < 33) return; last = t; // ~30fps: calm, battery-friendly
          g.globalCompositeOperation = 'source-over'; g.fillStyle = GA_rgba(P.bg, 0.05); g.fillRect(0, 0, W, H);
          g.globalCompositeOperation = P.dark ? 'lighter' : 'source-over'; const z = t * 0.00002, s = 1.6 / Math.max(W, H);
          for (const p of pts) { const a = N.fbm(p.x * s + z, p.y * s - z, 3) * GA_TAU * 1.6, x0 = p.x, y0 = p.y; p.x += Math.cos(a) * 0.9; p.y += Math.sin(a) * 0.9;
            g.strokeStyle = GA_rgba(p.c, P.dark ? 0.22 : 0.3); g.lineWidth = p.w; g.beginPath(); g.moveTo(x0, y0); g.lineTo(p.x, p.y); g.stroke();
            if (--p.life < 0 || p.x < 0 || p.y < 0 || p.x > W || p.y > H) spawn(p); }
        };
        raf = requestAnimationFrame(frame); cv.dataset.running = '1';
        const onTheme = () => { P = pal(); }; DS.bus.on('theme:change', onTheme);
        return () => { dead = true; cancelAnimationFrame(raf); removeEventListener('resize', onR); DS.bus.off && DS.bus.off('theme:change', onTheme); cv.width = cv.height = 0; cv.remove(); };
      } });
  }
});

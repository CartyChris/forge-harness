/* forge.backdrops — wallpaper host manager: Canvas2D generative scenes, ONE shared three.js WebGLRenderer for every 3D scene
   (lazy CDN load with fallbacks + 10 s deadline, auto 2D fallback offline / on context loss), and the Wallpapers gallery view. */
const FB_RNG = s => () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const FB_NOISE = (x, y, t) => Math.sin(x * 1.7 + t) * Math.cos(y * 1.3 - t * 0.7) + Math.sin((x + y) * 0.9 + t * 0.4) * 0.5;
const FB_CAP = { low: 0.4, med: 0.7, high: 1 };
const FB_UA = navigator.userAgent || '';
const FB_IOS = /iPhone|iPad|iPod/.test(FB_UA) || (/Mac/.test(FB_UA) && navigator.maxTouchPoints > 1);
const FB_MOBILE = FB_IOS || /Android|Mobile/.test(FB_UA) || Math.min(screen.width || 999, screen.height || 999) < 600;
/* three.js r149 UMD — only URLs that serve the file at this exact path (cdnjs never published 0.149.0, so it is not listed). */
const FB_THREE_URLS = ['https://cdn.jsdelivr.net/npm/three@0.149.0/build/three.min.js', 'https://unpkg.com/three@0.149.0/build/three.min.js'];
const FB_THREE_DEADLINE = 10000;
/* css colour → [r,g,b] via the canvas normaliser (handles #hex, rgb(), hsl(), names) */
const FB_PARSE = (() => { let g = null; return (css, d) => { try { g = g || document.createElement('canvas').getContext('2d'); g.fillStyle = '#010203'; g.fillStyle = css; const v = g.fillStyle; if (v === '#010203' && css !== '#010203') return d || [74, 138, 196]; if (v[0] === '#') return [1, 3, 5].map(i => parseInt(v.slice(i, i + 2), 16)); const m = v.match(/[\d.]+/g); return m ? m.slice(0, 3).map(Number) : d || [74, 138, 196]; } catch (e) { return d || [74, 138, 196]; } }; })();
const FB_HUE = ([r, g, b]) => { r /= 255; g /= 255; b /= 255; const M = Math.max(r, g, b), m = Math.min(r, g, b), d = M - m; if (!d) return 0; const h = M === r ? ((g - b) / d) % 6 : M === g ? (b - r) / d + 2 : (r - g) / d + 4; return (h * 60 + 360) % 360; };

/* every 2D scene: init(c2d, W, H, rnd, cap, col) → frame(t, dt). col = { acc, vio, bg, text, fade, hue, hue2, rgba(css,a) } */
const FB_2D = {
  flow: { label: 'Flow ribbons', cat: 'gen', still: 'linear-gradient(135deg,#0b1020,#1b2a4a 60%,#0b1020)', init(g, W, H, r, cap, col) {
    const n = Math.round(500 * cap), P = Array.from({ length: n }, () => [r() * W, r() * H]); const sc = 0.0025 + r() * 0.002, sp = 1 + r();
    g.fillStyle = col.bg; g.fillRect(0, 0, W, H);
    return t => { g.fillStyle = col.fade; g.fillRect(0, 0, W, H); g.strokeStyle = col.acc; g.lineWidth = 1; g.beginPath();
      for (const p of P) { const a = FB_NOISE(p[0] * sc, p[1] * sc, t * 0.15) * Math.PI * 2; g.moveTo(p[0], p[1]); p[0] += Math.cos(a) * sp; p[1] += Math.sin(a) * sp; g.lineTo(p[0], p[1]); if (p[0] < 0 || p[0] > W || p[1] < 0 || p[1] > H) { p[0] = r() * W; p[1] = r() * H; } } g.stroke(); }; } },
  constellation: { label: 'Constellation', cat: 'gen', still: 'radial-gradient(circle at 30% 30%,#173018,#060a06)', init(g, W, H, r, cap, col) {
    const n = Math.round(90 * cap), P = Array.from({ length: n }, () => ({ x: r() * W, y: r() * H, vx: (r() - .5) * .4, vy: (r() - .5) * .4 })); const D = Math.min(110, Math.max(W, H) * .25);
    return () => { g.clearRect(0, 0, W, H); g.fillStyle = col.acc; for (const p of P) { p.x += p.vx; p.y += p.vy; if (p.x < 0 || p.x > W) p.vx *= -1; if (p.y < 0 || p.y > H) p.vy *= -1; g.fillRect(p.x - 1, p.y - 1, 2, 2); }
      g.strokeStyle = col.acc; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { const dx = P[i].x - P[j].x, dy = P[i].y - P[j].y, d = dx * dx + dy * dy; if (d < D * D) { g.globalAlpha = (1 - Math.sqrt(d) / D) * .5; g.beginPath(); g.moveTo(P[i].x, P[i].y); g.lineTo(P[j].x, P[j].y); g.stroke(); } } g.globalAlpha = 1; }; } },
  aurora: { label: 'Aurora ribbons', cat: 'calm', still: 'linear-gradient(180deg,#041222,#0b3a4a 50%,#1a1240)', init(g, W, H, r, cap, col) {
    const bands = 3 + Math.round(3 * cap), ph = Array.from({ length: bands }, () => r() * 10), hues = Array.from({ length: bands }, (_, i) => (i % 2 ? col.hue2 : col.hue) + (r() - .5) * 50), A = H / 7;
    return t => { g.clearRect(0, 0, W, H); g.globalCompositeOperation = 'lighter'; for (let b = 0; b < bands; b++) { const y0 = H * (0.2 + b * 0.5 / bands); const gr = g.createLinearGradient(0, y0 - A * 2, 0, y0 + A * 2); gr.addColorStop(0, 'transparent'); gr.addColorStop(.5, 'hsla(' + hues[b] + ',80%,60%,.18)'); gr.addColorStop(1, 'transparent'); g.fillStyle = gr; g.beginPath(); g.moveTo(0, H);
      for (let x = 0; x <= W; x += 16) g.lineTo(x, y0 + Math.sin(x * 0.006 + t * 0.4 + ph[b]) * A + Math.sin(x * 0.013 - t * 0.3) * A * .4); g.lineTo(W, H); g.closePath(); g.fill(); } g.globalCompositeOperation = 'source-over'; }; } },
  grid: { label: 'Synth horizon', cat: 'gen', still: 'linear-gradient(180deg,#0d0221 0 55%,#2a0845 55%,#0d0221)', init(g, W, H, r, cap, col) {
    const hz = H * (0.45 + r() * 0.1);
    return t => { g.clearRect(0, 0, W, H); const sun = g.createRadialGradient(W / 2, hz, 0, W / 2, hz, H * .35); sun.addColorStop(0, col.acc); sun.addColorStop(1, 'transparent'); g.globalAlpha = .35; g.fillStyle = sun; g.fillRect(0, 0, W, H); g.globalAlpha = .6; g.strokeStyle = col.acc; g.lineWidth = 1; g.beginPath();
      for (let i = 0; i < 24; i++) { const z = ((i + (t * 0.8) % 1) / 24); const y = hz + (H - hz) * z * z; g.moveTo(0, y); g.lineTo(W, y); }
      for (let i = -12; i <= 12; i++) { g.moveTo(W / 2 + i * 8, hz); g.lineTo(W / 2 + i * W * 0.12, H); } g.stroke(); g.globalAlpha = 1; }; } },
  matrix: { label: 'Matrix rain', cat: 'gen', still: 'linear-gradient(180deg,#000,#001a08)', init(g, W, H, r, cap, col) {
    const fs = W < 300 ? 9 : 14, cols = Math.ceil(W / fs), Y = Array.from({ length: cols }, () => r() * -H / fs); const ch = 'アイウエオカキクケコ01ABCDEF<>/{}'; let acc = 0;
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    return (t, dt) => { acc += dt; if (acc < 0.05) return; acc = 0; g.fillStyle = 'rgba(0,0,0,.08)'; g.fillRect(0, 0, W, H); g.fillStyle = col.acc; g.font = fs + 'px monospace';
      for (let i = 0; i < cols; i++) { if (r() > cap + .2) continue; g.fillText(ch[(r() * ch.length) | 0], i * fs, Y[i] * fs); if (Y[i] * fs > H && r() > .975) Y[i] = 0; Y[i]++; } }; } },
  orbs: { label: 'Liquid orbs', cat: 'calm', still: 'radial-gradient(circle at 25% 30%,#3b6fd8aa,transparent 45%),radial-gradient(circle at 75% 70%,#8b5cf6aa,transparent 45%),#07111f', init(g, W, H, r, cap, col) {
    const n = 4 + Math.round(4 * cap), O = Array.from({ length: n }, (_, i) => ({ x: r() * W, y: r() * H, rad: (0.18 + r() * 0.25) * Math.max(W, H), h: (i % 2 ? col.hue2 : col.hue) + (r() - .5) * 60, sp: .1 + r() * .2, ph: r() * 6 }));
    return t => { g.clearRect(0, 0, W, H); g.globalCompositeOperation = 'lighter'; for (const o of O) { const x = o.x + Math.sin(t * o.sp + o.ph) * W * .15, y = o.y + Math.cos(t * o.sp * .8 + o.ph) * H * .12; const gr = g.createRadialGradient(x, y, 0, x, y, o.rad); gr.addColorStop(0, 'hsla(' + ((o.h + t * 6) % 360) + ',80%,60%,.22)'); gr.addColorStop(1, 'transparent'); g.fillStyle = gr; g.fillRect(0, 0, W, H); } g.globalCompositeOperation = 'source-over'; }; } },
  warp: { label: 'Starfield warp', cat: 'gen', still: 'radial-gradient(circle,#101830,#000)', init(g, W, H, r, cap, col) {
    const n = Math.round(400 * cap), S = Array.from({ length: n }, () => [r() * 2 - 1, r() * 2 - 1, r()]);
    return (t, dt) => { g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, 0, W, H); g.fillStyle = '#fff'; for (const s of S) { s[2] -= dt * .25; if (s[2] <= 0.01) { s[0] = r() * 2 - 1; s[1] = r() * 2 - 1; s[2] = 1; } const x = W / 2 + s[0] / s[2] * W * .5, y = H / 2 + s[1] / s[2] * H * .5, z = (1 - s[2]) * 2.2; g.globalAlpha = 1 - s[2]; g.fillRect(x, y, z, z); } g.globalAlpha = 1; }; } },
};

/* THREE scenes: build(T, scene, camera, rnd, cap, col) → frame(t, dt). col = { acc, vio, bg: THREE.Color, … } */
const FB_3D = {
  starfield: { label: 'Starfield 3D', fb: 'warp', still: 'radial-gradient(circle,#0b1430,#000)', build(T, S, C, r, cap) { const n = Math.round(3000 * cap), a = new Float32Array(n * 3); for (let i = 0; i < a.length; i++) a[i] = (r() - .5) * 200; const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.BufferAttribute(a, 3)); const p = new T.Points(geo, new T.PointsMaterial({ size: .5, color: 0xffffff })); S.add(p); C.position.z = 50; return t => { p.rotation.y = t * .03; p.rotation.x = t * .01; }; } },
  liquidglass: { label: 'Liquid glass knot', fb: 'orbs', calm: true, still: 'radial-gradient(circle,#123a5a,#03101d)', build(T, S, C, r, cap, col) { const k = new T.Mesh(new T.TorusKnotGeometry(8, 2.4, cap < .5 ? 100 : 160, cap < .5 ? 14 : 24), new T.MeshStandardMaterial({ color: col.acc, metalness: .6, roughness: .15, transparent: true, opacity: .55 })); S.add(k); S.add(new T.AmbientLight(0x406080, 1)); const l = new T.PointLight(0xffffff, 1.4); l.position.set(20, 20, 30); S.add(l); const l2 = new T.PointLight(col.vio, 1); l2.position.set(-25, -10, 10); S.add(l2); C.position.z = 34; return t => { k.rotation.x = t * .18; k.rotation.y = t * .26; C.position.x = Math.sin(t * .12) * 3.5; C.lookAt(0, 0, 0); }; } },
  neuralmesh: { label: 'Neural mesh', fb: 'neuralmesh-2d', still: 'radial-gradient(circle,#1a1f48,#07091b)', build(T, S, C, r, cap, col) { const n = Math.round(160 * cap), pos = new Float32Array(n * 3), vel = []; for (let i = 0; i < n; i++) { pos[i * 3] = (r() - .5) * 60; pos[i * 3 + 1] = (r() - .5) * 44; pos[i * 3 + 2] = (r() - .5) * 30; vel.push((r() - .5) * .3, (r() - .5) * .3, (r() - .5) * .3); } const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos, 3)); S.add(new T.Points(g, new T.PointsMaterial({ size: .7, color: col.acc })));
    const max = n * 6, lp = new Float32Array(max * 6), lg = new T.BufferGeometry(); lg.setAttribute('position', new T.BufferAttribute(lp, 3)); const lines = new T.LineSegments(lg, new T.LineBasicMaterial({ color: col.vio, transparent: true, opacity: .35 })); S.add(lines); C.position.z = 50;
    return (t, dt) => { for (let i = 0; i < n * 3; i++) { pos[i] += vel[i] * dt * 6; const lim = [30, 22, 15][i % 3]; if (Math.abs(pos[i]) > lim) vel[i] *= -1; } g.attributes.position.needsUpdate = true; let k = 0; for (let i = 0; i < n && k < max; i++) for (let j = i + 1; j < n && k < max; j++) { const dx = pos[i * 3] - pos[j * 3], dy = pos[i * 3 + 1] - pos[j * 3 + 1], dz = pos[i * 3 + 2] - pos[j * 3 + 2]; if (dx * dx + dy * dy + dz * dz < 64) { lp.set([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], pos[j * 3], pos[j * 3 + 1], pos[j * 3 + 2]], k * 6); k++; } } lg.setDrawRange(0, k * 2); lg.attributes.position.needsUpdate = true; S.rotation.y = t * .04; }; } },
  orbitals: { label: 'Gilded orbitals', fb: 'solar-2d', still: 'radial-gradient(circle,#3a2a08,#0a0703)', build(T, S, C) { const rings = []; for (let i = 0; i < 5; i++) { const m = new T.Mesh(new T.TorusGeometry(6 + i * 2.2, .08, 8, 120), new T.MeshBasicMaterial({ color: 0xfacc15, transparent: true, opacity: .6 - i * .08 })); rings.push(m); S.add(m); } const core = new T.Mesh(new T.IcosahedronGeometry(3, 1), new T.MeshBasicMaterial({ color: 0xfde68a, wireframe: true })); S.add(core); C.position.z = 30; return (t, dt) => { rings.forEach((m, i) => { m.rotation.x += dt * (.08 + i * .015); m.rotation.y += dt * (.16 + i * .01); }); core.rotation.x = t * .31; core.rotation.y = t * .23; }; } },
  shaderloom: { label: 'Shader loom waves', fb: 'waves-2d', still: 'linear-gradient(180deg,#0a0f24,#1b1050)', build(T, S, C, r, cap, col) { const geo = new T.PlaneGeometry(80, 50, cap < .5 ? 40 : 60, cap < .5 ? 26 : 40), base = geo.attributes.position.array.slice(); const m = new T.Mesh(geo, new T.MeshBasicMaterial({ color: col.vio, wireframe: true, transparent: true, opacity: .5 })); m.rotation.x = -1.1; S.add(m); C.position.set(0, 8, 30); C.lookAt(0, 0, 0); return t => { const p = geo.attributes.position.array; for (let i = 0; i < p.length; i += 3) { const x = base[i], y = base[i + 1]; p[i + 2] = Math.sin(x * .22 + t * 1.5) * 1.4 + Math.cos(y * .3 + t) * 1.1; } geo.attributes.position.needsUpdate = true; }; } },
  tunnel: { label: 'Tunnel', fb: 'tunnel-2d', still: 'radial-gradient(circle,#000 10%,#24104a)', build(T, S, C, r, cap, col) { const rings = []; for (let i = 0; i < 30; i++) { const m = new T.Mesh(new T.TorusGeometry(10, .1, 6, 48), new T.MeshBasicMaterial({ color: col.acc.clone().lerp(col.vio, i / 29) })); m.position.z = -i * 6; rings.push(m); S.add(m); } return (t, dt) => { rings.forEach(m => { m.position.z += dt * 12; if (m.position.z > 5) m.position.z -= 180; m.rotation.z = t * .2; }); }; } },
};

DS.plugin({ name: 'forge.backdrops', title: 'Wallpapers (backdrops)', version: '2.0.0', tags: ['ui', '3d', 'generative'],
  description: 'Wallpapers gallery + animated backdrops: Canvas2D generative scenes and three.js 3D scenes on ONE shared WebGL renderer (lazy CDN load, 10 s deadline, automatic 2D fallback offline). Theme-colour aware, pauses when hidden/typing, iOS gyro parallax.',
  apply(ctx) {
    const root = document.documentElement, U = DS.util, esc = U.esc;
    const hc = navigator.hardwareConcurrency || 4;
    /* Auto = low on iPhone or ≤4 cores; medium on other phones; high on ≥8-core desktops */
    const autoQ = () => (FB_IOS || hc <= 4) ? 'low' : FB_MOBILE ? 'med' : (hc >= 8 ? 'high' : 'med');
    const autoWhy = () => FB_IOS ? 'iPhone/iPad' : hc <= 4 ? hc + ' CPU cores' : FB_MOBILE ? 'mobile' : hc + ' cores';
    const sysReduced = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    const prefs = () => Object.assign({ pauseTyping: true, gyro: false, cat: 'all' }, ctx.data.get('prefs', {}));
    const setPref = (k, v) => { const p = prefs(); p[k] = v; ctx.data.set('prefs', p); };

    /* ---------- colours (theme aware) ---------- */
    let colKey = '';
    function colors() { const cs = getComputedStyle(root); const v = k => (cs.getPropertyValue(k) || '').trim(); const acc = v('--accent') || '#4a8ac4', vio = v('--violet') || acc, bg = v('--bg') || '#000', text = v('--text') || '#fff'; const B = FB_PARSE(bg, [0, 0, 0]);
      return { acc, vio, bg, text, fade: 'rgba(' + B.join(',') + ',.06)', hue: FB_HUE(FB_PARSE(acc)), hue2: FB_HUE(FB_PARSE(vio, [138, 108, 255])), rgba: (c, a) => 'rgba(' + FB_PARSE(c).join(',') + ',' + a + ')' }; }
    const keyOf = c => c.acc + c.vio + c.bg;
    function colors3(T) { const c = colors(); const mk = (s, d) => { const [r, g, b] = FB_PARSE(s, d); return new T.Color(r / 255, g / 255, b / 255); }; return { acc: mk(c.acc), vio: mk(c.vio, [138, 108, 255]), bg: mk(c.bg, [0, 0, 0]), text: mk(c.text, [255, 255, 255]), css: c }; }

    /* ---------- styles + host ---------- */
    ctx.effect(() => { const s = document.createElement('style'); s.id = 'fx-css'; s.textContent = FB_CSS_TEXT(); document.head.appendChild(s); return () => s.remove(); });
    const host = document.createElement('div'); host.id = 'fx-bd'; host.setAttribute('aria-hidden', 'true'); document.body.insertBefore(host, document.body.firstChild);
    ctx.effect(() => () => { stopCur(); host.remove(); root.classList.remove('fx-on'); disposeEngine(); });

    /* ---------- animation loop: fps cap, speed scale, pauses when hidden / typing / paused ---------- */
    let typingUntil = 0;
    const halted = () => document.hidden || loop.paused || (typingUntil && performance.now() < typingUntil);
    function loop(frame, fps, speed) { let raf = 0, last = 0, T = 0, alive = true; speed = speed || 1; const step = n => { if (!alive) return; raf = requestAnimationFrame(step); if (halted()) { last = n; return; } if (n - last < 1000 / fps - 2) return; const dt = Math.min(.1, (n - (last || n)) / 1000) || 1 / fps; last = n; T += dt * speed; try { frame(T + 1, dt * speed); } catch (e) { alive = false; cancelAnimationFrame(raf); ctx.log('warn', 'backdrop frame: ' + e.message); } }; raf = requestAnimationFrame(step); return () => { alive = false; cancelAnimationFrame(raf); }; }
    loop.paused = false;
    const fps = q => FB_MOBILE || q === 'low' ? 30 : 60;
    const onType = e => { const t = e.target; if (!prefs().pauseTyping || !t) return; if (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && /^(text|search|url|email|)$/.test(t.type || '')) || t.isContentEditable) typingUntil = performance.now() + 1400; };
    document.addEventListener('input', onType, true); document.addEventListener('keydown', onType, true);
    ctx.effect(() => () => { document.removeEventListener('input', onType, true); document.removeEventListener('keydown', onType, true); });

    /* ---------- three.js engine: lazy load + ONE renderer reused across every scene and preview ---------- */
    const ENG = { T: null, R: null, p: null, err: '', lost: false, contexts: 0, live: null, url: '' };
    function loadThree() {
      if (window.THREE && window.THREE.WebGLRenderer) return Promise.resolve(ENG.T = window.THREE);
      if (ENG.p) return ENG.p;
      if (navigator.onLine === false) { ENG.err = 'offline'; return Promise.reject(new Error('offline')); }
      const t0 = Date.now();
      ENG.p = new Promise((res, rej) => { let i = 0, done = false; const fail = m => { if (done) return; done = true; ENG.p = null; ENG.err = m; DS.bus.emit('backdrops:engine', { ok: false, err: m }); rej(new Error(m)); };
        const next = () => { if (done) return; if (i >= FB_THREE_URLS.length) return fail('three.js could not be loaded from jsdelivr or unpkg'); const left = FB_THREE_DEADLINE - (Date.now() - t0); if (left <= 0) return fail('three.js load timed out (10 s)');
          const url = FB_THREE_URLS[i++], s = document.createElement('script'); s.src = url; s.async = true; s.crossOrigin = 'anonymous'; s.dataset.fx = 'three';
          const to = setTimeout(() => { s.onload = s.onerror = null; s.remove(); next(); }, left);
          s.onload = () => { clearTimeout(to); if (window.THREE && window.THREE.WebGLRenderer) { done = true; ENG.T = window.THREE; ENG.err = ''; ENG.url = url; DS.bus.emit('backdrops:engine', { ok: true, rev: ENG.T.REVISION }); res(ENG.T); } else { s.remove(); next(); } };
          s.onerror = () => { clearTimeout(to); s.remove(); next(); }; document.head.appendChild(s); };
        next(); });
      return ENG.p;
    }
    function renderer() {
      if (ENG.R) return ENG.R; const T = ENG.T; if (!T) return null; let R;
      try { R = new T.WebGLRenderer({ antialias: !FB_MOBILE && autoQ() === 'high', alpha: true, powerPreference: 'low-power', premultipliedAlpha: true }); } catch (e) { ENG.err = 'WebGL unavailable'; return null; }
      if (!R.getContext()) { ENG.err = 'WebGL unavailable'; return null; }
      ENG.contexts++; R.setClearColor(0x000000, 0); R.domElement.className = 'fx-gl';
      R.domElement.addEventListener('webglcontextlost', e => { e.preventDefault(); ENG.lost = true; ctx.log('warn', 'WebGL context lost'); const b = find(curId); if (b && b.group === '3d') { toast3d('The GPU dropped the 3D context — showing the 2D version until it recovers.'); fallbackFor(b, new Error('WebGL context lost')); } }, false);
      R.domElement.addEventListener('webglcontextrestored', () => { ENG.lost = false; ctx.log('info', 'WebGL context restored'); const w = find(wanted); if (w && w.group === '3d' && curId !== wanted) set(wanted, { force: true }); }, false);
      return ENG.R = R;
    }
    function disposeScene(S) { const T = ENG.T; if (!S) return; S.traverse(ob => { if (ob.geometry) ob.geometry.dispose(); if (ob.material) [].concat(ob.material).forEach(m => { for (const k in m) { const v = m[k]; if (v && T && v.isTexture) v.dispose(); } m.dispose(); }); }); if (S.background && S.background.isTexture) S.background.dispose(); S.clear && S.clear(); }
    function disposeEngine() { if (ENG.R) { try { ENG.R.dispose(); ENG.R.forceContextLoss(); } catch (e) {} ENG.R.domElement.remove(); ENG.R = null; } }
    let toastAt = 0; const toast3d = m => { if (Date.now() - toastAt < 8000) return; toastAt = Date.now(); ctx.toast(m, 'warn', 5200); };

    async function start3d(h, o, sc) {
      const T = await loadThree(); const R = renderer(); if (!R) throw new Error(ENG.err || 'WebGL unavailable'); if (ENG.lost) throw new Error('WebGL context lost');
      R.setPixelRatio(o.dpr); R.setRenderTarget(null); R.setClearColor(0x000000, 0);
      const S = new T.Scene(), C = new T.PerspectiveCamera(60, 1, .1, 1000);
      const size = () => { const W = h.clientWidth || innerWidth, H = h.clientHeight || innerHeight; R.setSize(W, H, false); C.aspect = W / H; C.updateProjectionMatrix(); };
      let frame; try { frame = sc.build(T, S, C, FB_RNG(o.seed || 1), o.cap, colors3(T)); } catch (e) { disposeScene(S); throw e; }
      h.appendChild(R.domElement); size();
      const render = () => { if (!ENG.lost) R.render(S, C); };
      const onR = U.debounce ? U.debounce(size, 200) : size; addEventListener('resize', onR);
      const stop = loop((t, dt) => { if (ENG.lost) return; frame(t, dt); render(); }, fps(o.quality), o.speed);
      ENG.live = { render, S }; h._renderer = R;
      return () => { stop(); removeEventListener('resize', onR); disposeScene(S); try { R.renderLists.dispose(); } catch (e) {} if (R.domElement.parentNode === h) h.removeChild(R.domElement); if (ENG.live && ENG.live.S === S) ENG.live = null; h._renderer = null; };
    }
    function start2d(h, o, sc) {
      const cv = document.createElement('canvas'); h.appendChild(cv); const g = cv.getContext('2d'); if (!g) throw new Error('Canvas2D unavailable'); let frame;
      const size = () => { const W = h.clientWidth || innerWidth, H = h.clientHeight || innerHeight; cv.width = Math.round(W * o.dpr); cv.height = Math.round(H * o.dpr); g.setTransform(o.dpr, 0, 0, o.dpr, 0, 0); frame = sc.init(g, W, H, FB_RNG(o.seed || 1), o.cap, colors()); };
      size(); const onR = U.debounce ? U.debounce(size, 200) : size; addEventListener('resize', onR); const stop = loop((t, dt) => frame(t, dt), fps(o.quality), o.speed);
      return () => { stop(); removeEventListener('resize', onR); cv.width = cv.height = 0; cv.remove(); };
    }
    /* contribution factories — 72-scenes uses these so every scene shares the same engine */
    const def2d = (id, sc) => ({ id, label: sc.label, group: '2d', cat: sc.cat || 'gen', still: sc.still, init: sc.init, start: (h, o) => start2d(h, o, sc) });
    const def3d = (id, sc) => ({ id, label: sc.label, group: '3d', cat: '3d', calm: !!sc.calm, still: sc.still, fallback: sc.fb || 'constellation', build: sc.build, isNew: !!sc.isNew, start: (h, o) => start3d(h, o, sc) });

    /* ---------- host manager ---------- */
    let cur = null, curId = 'none', wanted = 'none', gen = 0, pendingGen = 0, lastKey = '', colAtStart = '';
    const opts = { intensity: .7, seed: 1, quality: 'auto', reduced: false };
    const stats = { starts: 0, stops: 0, fallback: '', fallbacks: 0 };
    const find = id => DS.kernel.list('backdrop').find(x => x.id === id);
    const cleanup = () => { host.innerHTML = ''; host.style.background = ''; };
    function stopCur() { if (cur) { try { cur(); } catch (e) {} cur = null; stats.stops++; } cleanup(); }
    const qNow = () => opts.quality === 'auto' ? autoQ() : opts.quality;
    const intensityOf = () => Math.max(.05, Math.min(1, +opts.intensity || .7));
    function set(id, o) {
      o = o || {}; for (const k of ['intensity', 'seed', 'quality', 'reduced']) if (o[k] != null) opts[k] = o[k];
      root.style.setProperty('--fx-op', (.45 + .55 * intensityOf()).toFixed(2));
      id = id || 'none'; if (!o._fb) wanted = id;
      const key = [id, opts.seed, qNow(), !!(opts.reduced || sysReduced()), Math.round(intensityOf() * 20)].join('|');
      if (key === lastKey && (cur || pendingGen === gen) && !o.force) return;
      lastKey = key; stopCur(); curId = id; const myGen = ++gen; const b = find(id);
      root.classList.toggle('fx-on', !!b); DS.bus.emit('backdrops:change', { id, wanted });
      if (!b) { pendingGen = 0; return; }
      const q = qNow(), reduced = !!(opts.reduced || sysReduced()), I = intensityOf();
      const dpr = Math.min(window.devicePixelRatio || 1, q === 'low' ? 1 : FB_MOBILE ? 1.5 : q === 'high' ? 2 : 1.5);
      if (reduced) { host.style.background = b.still || 'var(--bg)'; pendingGen = 0; return; }
      colAtStart = keyOf(colors()); pendingGen = myGen;
      Promise.resolve().then(() => b.start(host, { quality: q, reduced, dpr, seed: opts.seed, cap: (FB_CAP[q] || .7) * (.35 + .65 * I) / .805, speed: .35 + .93 * I }))
        .then(stop => { if (myGen !== gen) { try { stop && stop(); } catch (e) {} return; } pendingGen = 0; cur = stop; stats.starts++; DS.bus.emit('backdrops:started', { id }); })
        .catch(e => { if (myGen !== gen) return; pendingGen = 0; cleanup(); fallbackFor(b, e); });
    }
    function fallbackFor(b, e) {
      stats.fallback = e.message; stats.fallbacks++; ctx.log('warn', 'backdrop ' + b.id + ' failed: ' + e.message + ' → 2D fallback');
      const f = [b.fallback, b.id + '-2d', 'orbs'].find(x => x && x !== b.id && find(x) && find(x).group !== '3d') || 'none';
      if (b.group === '3d') { const fl = find(f); toast3d((/offline|loaded|timed out|three/i.test(e.message) ? '3D engine (three.js) is unavailable — offline? ' : e.message + ' — ') + 'Showing “' + (fl ? fl.label : 'plain') + '” (2D) instead; 3D retries next time.'); }
      set(f, { force: true, _fb: true });
    }
    /* theme colour change → restart scene with new colours (debounced) */
    const recolor = (U.debounce || (f => f))(() => { const k = keyOf(colors()); if (k === colKey) return; colKey = k; DS.bus.emit('backdrops:recolor', k); if (cur && k !== colAtStart) set(curId, { force: true, _fb: curId !== wanted }); }, 180);
    ctx.effect(() => { const mo = new MutationObserver(recolor); mo.observe(root, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] }); return () => mo.disconnect(); });
    ctx.effect(() => DS.bus.on('themes:change', recolor));
    colKey = keyOf(colors());

    ctx.hook('run:start', () => { if (document.hidden) { loop.paused = true; loop._byRun = true; } }); ctx.hook('run:end', () => { if (loop._byRun) { loop.paused = false; loop._byRun = false; } });
    const onVis = () => { if (!document.hidden && loop._byRun) { loop.paused = false; loop._byRun = false; } DS.bus.emit('backdrops:visibility', !document.hidden); }; document.addEventListener('visibilitychange', onVis); ctx.effect(() => () => document.removeEventListener('visibilitychange', onVis));
    const mq = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)'); const onMq = () => set(curId, { force: true, _fb: curId !== wanted }); if (mq && mq.addEventListener) { mq.addEventListener('change', onMq); ctx.effect(() => () => mq.removeEventListener('change', onMq)); }

    /* ---------- gyro parallax (iOS needs DeviceOrientationEvent.requestPermission from a tap) ---------- */
    const hasGyro = typeof window.DeviceOrientationEvent !== 'undefined';
    const needsPerm = hasGyro && typeof DeviceOrientationEvent.requestPermission === 'function';
    let gyroOn = false, gyroT = 0;
    const onOri = e => { const n = performance.now(); if (n - gyroT < 50 || e.gamma == null) return; gyroT = n; const cl = v => Math.max(-1, Math.min(1, v)); const x = cl(e.gamma / 35) * -14, y = cl(((e.beta || 45) - 45) / 35) * -14; host.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0) scale(1.07)'; };
    function gyro(v) { if (v && !gyroOn && !sysReduced()) { addEventListener('deviceorientation', onOri); gyroOn = true; root.classList.add('fx-gyro'); } else if (!v && gyroOn) { removeEventListener('deviceorientation', onOri); gyroOn = false; host.style.transform = ''; root.classList.remove('fx-gyro'); } }
    async function enableGyro() { if (!hasGyro) { ctx.toast('No motion-sensor API in this browser', 'warn'); return false; }
      if (needsPerm) { try { const r = await DeviceOrientationEvent.requestPermission(); if (r !== 'granted') { ctx.toast('Motion access was not granted (Settings › Safari › Motion & Orientation Access)', 'warn', 4500); return false; } } catch (e) { ctx.toast('Motion permission needs a tap: ' + e.message, 'warn'); return false; } }
      gyro(true); return true; }
    ctx.effect(() => () => gyro(false));
    if (prefs().gyro && hasGyro) { if (needsPerm) { const once = () => { removeEventListener('pointerdown', once, true); enableGyro(); }; addEventListener('pointerdown', once, true); ctx.effect(() => () => removeEventListener('pointerdown', once, true)); } else gyro(true); }

    /* ---------- persistence: forge.themes owns backdrop state when present; otherwise we persist ourselves ---------- */
    const themes = () => ctx.service('forge.themes');
    function persist(o) { const th = themes(); if (th && th.apply) { th.apply(o); return; } const s = Object.assign(ctx.data.get('own', {}), o); ctx.data.set('own', s); set(s.backdrop != null ? s.backdrop : wanted, s); }
    const curState = () => { const th = themes(); return th && th.state ? th.state() : Object.assign({ backdrop: wanted, intensity: opts.intensity, quality: opts.quality, reduced: opts.reduced }, ctx.data.get('own', {})); };
    ctx.setTimeout(() => { if (!themes()) { const s = ctx.data.get('own', null); if (s && s.backdrop) set(s.backdrop, s); } }, 0);

    /* ---------- gallery previews: cheap stills rendered once (cached), ONE live tile at a time ---------- */
    const PW = 240, PH = 150, thumbs = new Map();
    function draw2dInto(b, cv, frames) { const g = cv.getContext('2d'); const c = colors(); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, PW, PH); const fr = b.init(g, PW, PH, FB_RNG(7), .5, c); let t = 2; for (let i = 0; i < (frames || 36); i++) { t += 1 / 30; fr(t, 1 / 30); } return fr; }
    function make3d(b) { const T = ENG.T, R = renderer(); if (!T || !R || ENG.lost) return null; const S = new T.Scene(), C = new T.PerspectiveCamera(60, PW / PH, .1, 1000); const c3 = colors3(T); let fr; try { fr = b.build(T, S, C, FB_RNG(7), .45, c3); } catch (e) { disposeScene(S); return null; }
      const rt = new T.WebGLRenderTarget(PW, PH), buf = new Uint8Array(PW * PH * 4), tmp = document.createElement('canvas'); tmp.width = PW; tmp.height = PH; const tg = tmp.getContext('2d'), img = tg.createImageData(PW, PH); const cc = new T.Color();
      return { draw(t, dt, dst) { fr(t, dt); if (ENG.lost) return; R.getClearColor(cc); const ca = R.getClearAlpha(), prev = R.getRenderTarget(); R.setRenderTarget(rt); R.setClearColor(c3.bg, 1); R.clear(); R.render(S, C); R.readRenderTargetPixels(rt, 0, 0, PW, PH, buf); R.setRenderTarget(prev); R.setClearColor(cc, ca); img.data.set(buf); tg.putImageData(img, 0, 0); const g = dst.getContext('2d'); g.save(); g.setTransform(1, 0, 0, -1, 0, PH); g.clearRect(0, 0, PW, PH); g.drawImage(tmp, 0, 0); g.restore(); }, dispose() { disposeScene(S); rt.dispose(); } }; }
    /* still for card: 3D via the shared renderer (only when three is already loaded), else the 2D twin, else CSS still */
    function thumb(b, cv) { const k = b.id + '|' + colKey + '|' + (ENG.T ? 1 : 0); const c = thumbs.get(k); const g = cv.getContext('2d'); if (c) { g.clearRect(0, 0, PW, PH); g.drawImage(c, 0, 0); return c.dataset.kind; }
      let kind = 'still';
      try { if (b.group === '3d' && ENG.T) { const p = make3d(b); if (p) { for (let i = 0; i < 4; i++) p.draw(3 + i / 30, 1 / 30, cv); p.dispose(); kind = '3d'; } }
        if (kind === 'still') { const tw = b.group === '3d' ? find(b.fallback) : b; if (tw && tw.init) { draw2dInto(tw, cv); kind = b.group === '3d' ? 'twin' : '2d'; } } } catch (e) { ctx.log('warn', 'thumb ' + b.id + ': ' + e.message); }
      const copy = document.createElement('canvas'); copy.width = PW; copy.height = PH; copy.getContext('2d').drawImage(cv, 0, 0); copy.dataset.kind = kind; thumbs.set(k, copy); return kind; }
    ctx.effect(() => DS.bus.on('backdrops:recolor', () => thumbs.clear()));

    /* ---------- the Wallpapers gallery view ---------- */
    DS.icons.wallpaper = DS.icons.wallpaper || '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 16l5-5 4 4 3-3 6 6"/><circle cx="16" cy="9" r="1.6"/></svg>';
    const CATS = [['all', 'All'], ['3d', '3D scenes'], ['gen', 'Generative 2D'], ['calm', 'Calm']];
    const inCat = (b, c) => c === 'all' || (c === '3d' ? b.group === '3d' : c === 'calm' ? (b.cat === 'calm' || b.calm) : b.group !== '3d' && b.cat !== 'calm');
    function engineLine() { if (ENG.T) return '<span class="wp-ok">●</span> three.js r' + esc(String(ENG.T.REVISION)) + ' ready · ' + ENG.contexts + ' WebGL context' + (ENG.lost ? ' (lost — recovering)' : '');
      if (ENG.p) return '<span class="wp-wait">●</span> loading three.js…'; if (ENG.err) return '<span class="wp-bad">●</span> 3D engine unavailable (' + esc(ENG.err) + ') — 3D wallpapers use their 2D version'; return '<span class="wp-wait">●</span> three.js loads on demand (jsdelivr → unpkg)'; }
    ctx.view({ id: 'wallpapers', title: 'Wallpapers', icon: 'wallpaper', order: 89, mount(el) {
      el.innerHTML = '<div class="vhead"><h2>Wallpapers</h2><span class="xs muted wp-cnt"></span></div><div class="vscroll"><div class="wp-wrap">'
        + '<div class="wp-ctl"><div class="wp-row"><label for="wp-int">Intensity</label><input id="wp-int" type="range" min="0.1" max="1" step="0.05" class="wp-int" aria-label="Wallpaper intensity (particles and speed)"><span class="xs muted wp-intv"></span></div>'
        + '<div class="wp-row"><label>3D quality</label><div class="wp-seg wp-q" role="group" aria-label="3D quality"><button data-q="auto">Auto</button><button data-q="low">Low</button><button data-q="high">High</button></div><span class="xs muted wp-qv"></span></div>'
        + '<div class="wp-row"><label class="wp-tg"><input type="checkbox" class="wp-pt"> Pause when typing</label><label class="wp-tg"><input type="checkbox" class="wp-gy"' + (hasGyro ? '' : ' disabled') + '> Gyro parallax' + (hasGyro ? (needsPerm ? ' <small class="muted">(asks iOS)</small>' : '') : ' <small class="muted">(no sensor API)</small>') + '</label><label class="wp-tg"><input type="checkbox" class="wp-rm"> Still image</label></div>'
        + '<div class="wp-row wp-eng"><span class="xs wp-engl"></span><button class="btn sm wp-retry" hidden>Retry 3D</button><button class="btn sm wp-none">Turn off</button></div></div>'
        + '<div class="wp-cats" role="tablist"></div><div class="wp-grid"></div><p class="xs muted wp-foot">Tap a tile to preview it live · <b>Apply</b> sets it behind the whole app. 3D scenes share one WebGL renderer and fall back to a 2D twin offline.</p></div></div>';
      const $ = s => el.querySelector(s), grid = $('.wp-grid'), cats = $('.wp-cats');
      let cat = prefs().cat, liveId = null, liveStop = null, queue = [], qTimer = 0, alive = true;
      const ri = $('.wp-int'), seg = $('.wp-q');
      function syncCtl() { const s = curState(); ri.value = s.intensity != null ? s.intensity : .7; $('.wp-intv').textContent = Math.round(ri.value * 100) + '%'; const q = s.quality === 'med' ? 'auto' : (s.quality || 'auto'); seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.q === q)); $('.wp-qv').textContent = q === 'auto' ? 'Auto → ' + autoQ() + ' (' + autoWhy() + ')' : ''; $('.wp-pt').checked = prefs().pauseTyping; $('.wp-gy').checked = gyroOn; $('.wp-rm').checked = !!s.reduced;
        $('.wp-engl').innerHTML = engineLine() + (curId !== wanted && find(wanted) ? ' · <b>now showing 2D fallback</b>' : ''); $('.wp-retry').hidden = !ENG.err || !!ENG.T; }
      ri.oninput = () => { $('.wp-intv').textContent = Math.round(ri.value * 100) + '%'; };
      ri.onchange = () => persist({ intensity: +ri.value });
      seg.onclick = e => { const b = e.target.closest('button'); if (b) { persist({ quality: b.dataset.q }); syncCtl(); } };
      $('.wp-pt').onchange = e => setPref('pauseTyping', e.target.checked);
      $('.wp-gy').onchange = async e => { if (e.target.checked) { const ok = await enableGyro(); e.target.checked = ok; setPref('gyro', ok); } else { gyro(false); setPref('gyro', false); } };
      $('.wp-rm').onchange = e => persist({ reduced: e.target.checked });
      $('.wp-none').onclick = () => { apply('none'); };
      $('.wp-retry').onclick = () => { ENG.err = ''; syncCtl(); loadThree().then(() => { thumbs.clear(); draw(); const w = find(wanted); if (w && w.group === '3d') set(wanted, { force: true }); }).catch(() => { ctx.toast('three.js still unavailable — check the connection', 'warn'); syncCtl(); }); };
      function apply(id) { persist({ backdrop: id }); const b = find(id); ctx.toast(id === 'none' ? 'Wallpaper off' : 'Wallpaper → ' + (b ? b.label : id), 'ok'); markOn(); }
      function markOn() { grid.querySelectorAll('.wp-card').forEach(c => { const on = c.dataset.wp === wanted; c.classList.toggle('on', on); const a = c.querySelector('.wp-ap'); a.textContent = on ? '✓ Applied' : 'Apply'; a.classList.toggle('pri', !on); }); syncCtl(); }
      function card(b) { const is3 = b.group === '3d'; const c = U.el('div', { class: 'wp-card', 'data-wp': b.id, 'data-group': b.group || '2d' },
          '<button class="wp-th" aria-label="Preview ' + esc(b.label) + '" style="background:' + esc(b.still || 'var(--bg-2)') + '"><canvas width="' + PW + '" height="' + PH + '"></canvas><span class="wp-tag" hidden></span></button>'
          + '<div class="wp-meta"><span class="wp-nm" title="' + esc(b.label) + '">' + esc(b.label) + '</span>' + (b.isNew ? '<span class="wp-b wp-new">NEW</span>' : '') + '<span class="wp-b ' + (is3 ? 'd3">3D' : 'd2">2D') + '</span></div><button class="btn sm wp-ap">Apply</button>');
        c.querySelector('.wp-th').onclick = () => goLive(b.id); c.querySelector('.wp-th').onpointerenter = e => { if (e.pointerType === 'mouse') goLive(b.id); };
        c.querySelector('.wp-ap').onclick = () => apply(b.id); return c; }
      function draw() {
        stopLive(); queue = []; const all = DS.kernel.list('backdrop'), n3 = all.filter(b => b.group === '3d').length;
        $('.wp-cnt').textContent = all.length + ' wallpapers · ' + n3 + ' in 3D';
        cats.innerHTML = CATS.map(([k, l]) => '<button role="tab" data-c="' + k + '" class="' + (k === cat ? 'on' : '') + '" aria-selected="' + (k === cat) + '">' + l + ' <small>' + all.filter(b => inCat(b, k)).length + '</small></button>').join('');
        grid.innerHTML = ''; const none = U.el('div', { class: 'wp-card', 'data-wp': 'none' }, '<button class="wp-th" aria-label="No wallpaper" style="background:var(--bg)"><span class="wp-off">Plain</span></button><div class="wp-meta"><span class="wp-nm">None</span></div><button class="btn sm wp-ap">Apply</button>'); none.querySelector('.wp-ap').onclick = () => apply('none'); if (cat === 'all') grid.appendChild(none);
        for (const b of all.filter(b => inCat(b, cat))) { const c = card(b); grid.appendChild(c); queue.push([b, c]); }
        markOn(); pump(); const first = all.find(b => b.id === wanted && inCat(b, cat)); if (first && !FB_MOBILE) ctx.setTimeout(() => alive && goLive(first.id), 400);
      }
      cats.onclick = e => { const b = e.target.closest('button'); if (b) { cat = b.dataset.c; setPref('cat', cat); draw(); } };
      function pump() { clearTimeout(qTimer); if (!alive || !queue.length) return; const [b, c] = queue.shift(); if (c.isConnected) { const k = thumb(b, c.querySelector('canvas')); const tg = c.querySelector('.wp-tag'); if (k === 'twin') { tg.hidden = false; tg.textContent = '2D preview'; } else if (k === 'still') { tg.hidden = false; tg.textContent = 'still'; } else tg.hidden = true; } qTimer = setTimeout(pump, document.hidden ? 400 : 16); }
      /* ONE live tile: 2D scenes animate in their own canvas; 3D scenes render through the shared renderer into a 240×150 target */
      function stopLive() { if (liveStop) { try { liveStop(); } catch (e) {} liveStop = null; } const o = liveId && grid.querySelector('.wp-card[data-wp="' + liveId + '"]'); if (o) o.classList.remove('live'); liveId = null; }
      function goLive(id) { if (id === liveId) return; stopLive(); const b = find(id), c = b && grid.querySelector('.wp-card[data-wp="' + id + '"]'); if (!c) return; const cv = c.querySelector('canvas'); liveId = id; c.classList.add('live');
        const startIt = () => { if (liveId !== id || !alive) return; let fr = null, p = null;
          if (b.group === '3d' && ENG.T) p = make3d(b);
          if (!p) { const tw = b.group === '3d' ? find(b.fallback) : b; if (!tw || !tw.init) return; fr = draw2dInto(tw, cv, 1); }
          const stop = loop((t, dt) => { if (!cv.isConnected) { stop(); return; } if (p) p.draw(t + 3, dt, cv); else fr(t + 2, dt); }, FB_MOBILE ? 20 : 30, 1);
          liveStop = () => { stop(); if (p) p.dispose(); }; };
        if (b.group === '3d' && !ENG.T && !ENG.err && navigator.onLine !== false) loadThree().then(() => { thumbs.clear(); syncCtl(); startIt(); }).catch(() => { syncCtl(); startIt(); }); else startIt(); }
      const offs = [DS.bus.on('backdrops:change', () => alive && markOn()), DS.bus.on('backdrops:engine', () => { if (alive) { syncCtl(); if (ENG.T) { thumbs.clear(); grid.querySelectorAll('.wp-card[data-group="3d"]').forEach(c => { const b = find(c.dataset.wp); if (b) queue.push([b, c]); }); pump(); } } }), DS.bus.on('backdrops:recolor', () => alive && draw()), DS.bus.on('contrib:change', e => { if (alive && e && e.point === 'backdrop') draw(); }), DS.bus.on('themes:change', () => alive && syncCtl())];
      draw(); syncCtl();
      return () => { alive = false; stopLive(); clearTimeout(qTimer); queue = []; offs.forEach(f => typeof f === 'function' && f()); };
    } });

    /* entry points: rail icon, theme-picker button (70-themes has no hook, so we add one button to its packs row), command, tool, Sim intent, suggestion */
    ctx.rail({ id: 'wallpapers', icon: 'wallpaper', label: 'Wallpapers', group: 'bottom', order: 89, run: () => DS.shell.show('wallpapers'), active: () => DS.shell.current === 'wallpapers' });
    const addPickerBtn = () => { const pk = document.querySelector('.ft-wrap .ft-packs'); if (!pk || pk.querySelector('.wp-open')) return; const b = U.el('button', { class: 'btn sm wp-open', title: 'Open the Wallpapers gallery (3D + 2D live scenes)' }, '🖼 Wallpapers · 3D'); b.onclick = () => DS.shell.show('wallpapers'); pk.insertBefore(b, pk.firstChild); };
    ctx.effect(() => DS.bus.on('view:show', v => { if (v === 'themes') setTimeout(addPickerBtn, 0); }));
    const byName = n => { n = String(n || '').trim().toLowerCase(); if (!n) return null; if (n === 'none' || n === 'off') return 'none'; const all = DS.kernel.list('backdrop'); const b = all.find(x => x.id === n) || all.find(x => x.label.toLowerCase() === n) || all.find(x => x.label.toLowerCase().includes(n) || x.id.includes(n.replace(/\s+/g, ''))); return b ? b.id : null; };
    ctx.command({ name: 'wallpaper', args: '[name]', desc: 'Open the Wallpapers gallery, or set one by name', run(a, c) { if (!a || !a.trim()) { DS.shell.show('wallpapers'); return c.reply('Opened **Wallpapers** — ' + DS.kernel.list('backdrop').length + ' live scenes.'); } const id = byName(a); if (!id) return c.reply('No wallpaper matches “' + esc(a) + '”. Try `/wallpaper` to browse.'); persist({ backdrop: id }); c.reply('Wallpaper → **' + esc((find(id) || { label: 'none' }).label) + '**'); } });
    ctx.tool({ name: 'wallpaper_set', label: 'Wallpaper', gate: 'none', description: 'Set or browse the animated wallpaper behind Forge (three.js 3D scenes + 2D generative). id = wallpaper id or name (or "none"); open = true opens the Wallpapers gallery. With no id, returns the list.',
      parameters: { type: 'object', properties: { id: { type: 'string' }, open: { type: 'boolean' } } },
      run(a) { const all = DS.kernel.list('backdrop'); if (a.open) DS.shell.show('wallpapers'); if (a.id) { const id = byName(a.id); if (!id) throw new Error('unknown wallpaper ' + a.id); persist({ backdrop: id }); return { ok: true, id, label: (find(id) || {}).label || 'none', engine: ENG.T ? 'three r' + ENG.T.REVISION : (ENG.err || 'on demand') }; }
        return { count: all.length, threeD: all.filter(b => b.group === '3d').map(b => b.id), twoD: all.filter(b => b.group !== '3d').map(b => b.id), current: wanted }; },
      summarize: (a, r) => r.id ? 'wallpaper → ' + r.label : r.count + ' wallpapers' });
    ctx.intent({ id: 'wallpapers-open', order: 45, match: t => /\b(3d|three\.?js)\b.*\b(theme|wallpaper|scene|background|backdrop)s?\b|\b(show|open|browse)\b.*\bwallpapers?\b|^wallpapers?$/i.test(t),
      script: () => [{ say: 'Opening the Wallpapers gallery…', tool: { name: 'wallpaper_set', args: { open: true } } }, { final: r => 'Here are **' + ((r[0] && r[0].count) || 0) + ' wallpapers** (' + ((r[0] && r[0].threeD && r[0].threeD.length) || 0) + ' live three.js 3D scenes). Tap a tile to preview, **Apply** to set it. Offline, 3D scenes fall back to a 2D twin.' }] });
    ctx.intent({ id: 'wallpaper-set', order: 46, match: t => /\b(set|use|switch|change)\b.*\bwallpaper\b\s+(to\s+)?\S/i.test(t), script: t => { const m = t.match(/wallpaper\s+(?:to\s+)?["“]?([^"”.!?]+)/i); return [{ say: 'Switching wallpaper…', tool: { name: 'wallpaper_set', args: { id: m ? m[1].trim() : '' } } }, { final: r => 'Wallpaper → **' + ((r[0] && r[0].label) || '?') + '**.' }]; } });
    ctx.suggest({ id: 'wallpapers', emoji: '🖼', title: 'Try a 3D wallpaper', sub: 'Live three.js scenes behind the chat', prompt: 'show 3d wallpapers' });
    ctx.settings({ id: 'wallpapers', title: 'Wallpapers', order: 91, render(el) { el.innerHTML = '<div class="hint xs muted">Current: <b>' + esc((find(wanted) || { label: 'none' }).label) + '</b> · ' + esc(info()) + '</div><button class="btn sm" style="margin-top:8px">Open Wallpapers gallery</button>'; el.querySelector('button').onclick = () => DS.shell.show('wallpapers'); } });

    for (const [id, sc] of Object.entries(FB_2D)) ctx.backdrop(def2d(id, sc));
    for (const [id, sc] of Object.entries(FB_3D)) ctx.backdrop(def3d(id, sc));

    function info() { return 'quality ' + (opts.quality === 'auto' ? 'auto→' + autoQ() : opts.quality) + (sysReduced() ? ' · system reduced-motion' : '') + (FB_MOBILE ? ' · mobile 30fps' : '') + (ENG.T ? ' · three r' + ENG.T.REVISION + ' · ' + ENG.contexts + ' GL context' : ENG.err ? ' · 3D unavailable: ' + ENG.err : ' · three loads on demand') + (stats.fallback ? ' · fallback: ' + stats.fallback : ''); }
    /* probe: render the live 3D scene now and sample pixels (same task → no preserveDrawingBuffer needed). Used by tests + diagnostics. */
    function probe() { const R = ENG.R; if (!R || !ENG.live) return null; ENG.live.render(); const gl = R.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, px = new Uint8Array(4); let lit = 0, n = 0; for (let y = 1; y < 24; y++) for (let x = 1; x < 24; x++) { gl.readPixels((x / 24 * w) | 0, (y / 24 * h) | 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); n++; if (px[3] > 8 && (px[0] + px[1] + px[2]) > 24) lit++; } return { lit, n, w, h }; }
    ctx.provide('forge.backdrops', { set, current: () => curId, wanted: () => wanted, running: () => !!cur, pause(v) { loop.paused = !!v; }, def2d, def3d, start2d, start3d, loadThree, probe, autoQuality: autoQ, colors,
      stats: () => Object.assign({}, stats, { id: curId, wanted, nodes: host.childNodes.length, renderer: ENG.R ? ENG.R.info.memory : null, contexts: ENG.contexts, three: ENG.T ? ENG.T.REVISION : null, engineError: ENG.err, lost: ENG.lost, canvas: ENG.R ? ENG.R.domElement : null, gyro: gyroOn }),
      info, enableGyro, typing: () => !!(typingUntil && performance.now() < typingUntil) });
  } });

function FB_CSS_TEXT() { return '#fx-bd{position:fixed;top:0;right:0;bottom:0;left:0;z-index:0;pointer-events:none;overflow:hidden;opacity:var(--fx-op,var(--fx-intensity,.7));transition:opacity .4s,transform .25s linear}#fx-bd canvas{width:100%!important;height:100%!important;display:block}html.fx-on body{background:var(--bg)}html.fx-on #app{position:relative;z-index:1;background:transparent}html.fx-on #main,html.fx-on #views,html.fx-on #body,html.fx-on .vscroll,html.fx-on .ft-tabs{background:transparent}html.fx-on #composer{background:linear-gradient(transparent,var(--bg) 40%)}html.fx-on .card{background:var(--glass,var(--card))}'
  + '.wp-wrap{padding:12px 16px 28px;max-width:1120px;margin:0 auto;box-sizing:border-box;min-width:0}.wp-ctl{display:grid;gap:6px;background:var(--glass,var(--card));border:1px solid var(--line);border-radius:14px;padding:10px 12px;margin-bottom:12px;min-width:0}'
  + '.wp-row{display:flex;flex-wrap:wrap;align-items:center;gap:4px 12px;min-width:0}.wp-row>label{font-size:13px;color:var(--text-2);min-width:74px}.wp-row input[type=range]{flex:1 1 120px;min-width:0;height:40px;accent-color:var(--accent);margin:0}'
  + '.wp-seg{display:inline-flex;border:1px solid var(--line-2);border-radius:10px;overflow:hidden}.wp-seg button{min-height:40px;padding:0 14px;background:transparent;color:var(--text-2);border:0;font:inherit;font-size:13px;cursor:pointer}.wp-seg button+button{border-left:1px solid var(--line)}.wp-seg button.on{background:var(--accent-soft,var(--card-2));color:var(--text);font-weight:600}'
  + '.wp-tg{display:inline-flex!important;align-items:center;gap:8px;min-height:40px;font-size:13px;color:var(--text)!important;cursor:pointer}.wp-tg input{width:18px;height:18px;accent-color:var(--accent);margin:0}.wp-eng{justify-content:space-between}.wp-engl{flex:1 1 200px;min-width:0;color:var(--text-2);overflow-wrap:anywhere}.wp-ok{color:var(--ok,#3fb950)}.wp-bad{color:var(--warn,#d29922)}.wp-wait{color:var(--muted)}.wp-eng .btn{min-height:40px}'
  + '.wp-cats{display:flex;gap:6px;overflow-x:auto;margin:0 0 10px;padding-bottom:2px;scrollbar-width:none;-webkit-overflow-scrolling:touch}.wp-cats::-webkit-scrollbar{display:none}.wp-cats button{flex:none;min-height:40px;padding:0 14px;border-radius:20px;border:1px solid var(--line-2);background:var(--glass,var(--card));color:var(--text-2);font:inherit;font-size:13px;cursor:pointer}.wp-cats button.on{background:var(--accent);border-color:var(--accent);color:var(--bg);font-weight:600}.wp-cats small{opacity:.7;margin-left:2px}'
  + '.wp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;min-width:0}.wp-card{min-width:0;background:var(--glass,var(--card));border:1px solid var(--line);border-radius:14px;overflow:hidden;display:flex;flex-direction:column;transition:border-color .2s,box-shadow .2s,transform .2s}'
  + '.wp-card.on{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent),0 6px 22px -10px var(--accent)}.wp-card.live .wp-th{box-shadow:inset 0 0 0 2px var(--accent-line,var(--accent))}.wp-th{position:relative;display:block;width:100%;aspect-ratio:16/10;border:0;padding:0;margin:0;cursor:pointer;background-size:cover;overflow:hidden}'
  + '.wp-th canvas{position:absolute;top:0;left:0;width:100%;height:100%;display:block}.wp-tag{position:absolute;left:6px;bottom:6px;font-size:10px;padding:1px 6px;border-radius:6px;background:rgba(0,0,0,.55);color:#fff}.wp-off{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:12px;color:var(--muted)}'
  + '.wp-card.live .wp-th::after{content:"LIVE";position:absolute;right:6px;top:6px;font-size:9px;font-weight:700;letter-spacing:.06em;padding:2px 6px;border-radius:6px;background:var(--accent);color:var(--bg)}'
  + '.wp-meta{display:flex;align-items:center;gap:6px;padding:8px 10px 0;min-width:0}.wp-nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:600}.wp-b{flex:none;font-size:10px;font-weight:700;padding:2px 6px;border-radius:6px;letter-spacing:.04em}.wp-b.d3{background:var(--accent);color:var(--bg)}.wp-b.d2{border:1px solid var(--line-2);color:var(--text-2)}.wp-b.wp-new{background:var(--violet,var(--accent));color:var(--bg)}'
  + '.wp-ap{margin:8px 10px 10px;min-height:40px!important}.wp-foot{margin:14px 2px 0}@media (prefers-reduced-motion:reduce){.wp-card{transition:none}#fx-bd{transition:none}}'; }

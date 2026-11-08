// Forge Media plugin (A3): generate_image, render_video, generate_audio + Studio view.
DS.plugin({
  name: 'forge.media', title: 'Media Studio', version: '1.0.0', tags: ['media', 'image', 'video', 'audio'],
  description: 'Generate images (Pollinations or offline procedural art), canvas scene videos and synthesized audio. Studio view with gallery.',
  apply(ctx) {
    const U = DS.util, esc = U.esc;
    // ---------- helpers ----------
    const h32 = s => { let h = 2166136261 >>> 0; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; };
    const rng = seed => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
    const slug = s => (String(s || 'media').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'media');
    const thr = t => (t && t.thread) || DS.store.activeThread() || DS.store.newThread();
    async function saveFile(path, content, tctx) {
      let before = null; try { before = (await DS.fs.read(path)).content; } catch (_) {}
      DS.agent.recordChange(thr(tctx), path, before); await DS.fs.write(path, content); DS.bus.emit('media:update', path); return path;
    }
    async function readData(path) { try { return (await DS.fs.read(path)).content; } catch (_) { return null; } }
    const PAL = {
      neon: ['#0a0018', '#2b0a5a', '#ff2bd6', '#00f0ff', '#fffb00'], sunset: ['#1b0b2e', '#7a1f5c', '#ff6b3d', '#ffc24b', '#fff1c1'],
      ocean: ['#021526', '#03346e', '#1e88e5', '#6ec6ff', '#e0f7ff'], forest: ['#0b1d0f', '#1f3d2b', '#3f7d4a', '#a3c972', '#f0f5d8'],
      cyberpunk: ['#05010f', '#22004d', '#ff003c', '#00ffd5', '#f9f871'], space: ['#000008', '#0b0b2a', '#4b2aa6', '#9b8cff', '#ffffff'],
      pastel: ['#fde2e4', '#e2ece9', '#bee1e6', '#cddafd', '#fad2e1'], mono: ['#0b0b0b', '#2a2a2a', '#6b6b6b', '#bdbdbd', '#f5f5f5'],
      fire: ['#120400', '#5a0f00', '#e8400c', '#ffa600', '#fff3b0'], desert: ['#2b1608', '#8a4b1f', '#d98f4e', '#f2c48d', '#fff4e0'],
    };
    const STYLE_WORDS = Object.keys(PAL);
    function pickPalette(prompt, style) {
      const t = (style + ' ' + prompt).toLowerCase();
      const map = { neon: /neon|synth|retro|80s/, sunset: /sunset|dusk|dawn|warm|golden/, ocean: /ocean|sea|wave|beach|water|underwater/, forest: /forest|tree|jungle|nature|green|mountain/, cyberpunk: /cyber|city|tokyo|futur|robot/, space: /space|galaxy|star|cosmic|planet|nebula|night/, pastel: /pastel|soft|cute|dream/, mono: /mono|black and white|noir|minimal/, fire: /fire|lava|volcan|dragon|flame/, desert: /desert|sand|dune|mars/ };
      for (const k of [style].concat(Object.keys(map))) if (k && (k === style && PAL[k] || (map[k] && map[k].test(t)))) return { name: k, c: PAL[k] };
      const ks = STYLE_WORDS; const k = ks[h32(prompt) % ks.length]; return { name: k, c: PAL[k] };
    }
    function procedural(prompt, W, H, seed, style) {
      const R = rng(seed), cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d');
      const { name, c } = pickPalette(prompt, style || ''); const t = prompt.toLowerCase(); const light = name === 'pastel';
      let gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, c[0]); gr.addColorStop(0.55, c[1]); gr.addColorStop(1, c[2]); g.fillStyle = gr; g.fillRect(0, 0, W, H);
      if (!light) for (let i = 0; i < 260 * (W * H) / 500000; i++) { g.globalAlpha = R() * 0.9; g.fillStyle = '#fff'; const s = R() * 1.6 + 0.3; g.fillRect(R() * W, R() * H * 0.7, s, s); }
      g.globalAlpha = 1;
      const orbs = 1 + Math.floor(R() * 3);
      for (let i = 0; i < orbs; i++) { const x = W * (0.2 + R() * 0.6), y = H * (0.15 + R() * 0.35), r = Math.min(W, H) * (0.08 + R() * 0.16); const rg = g.createRadialGradient(x, y, 0, x, y, r * 2.6); rg.addColorStop(0, c[4]); rg.addColorStop(0.35, c[3]); rg.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = rg; g.globalCompositeOperation = 'lighter'; g.beginPath(); g.arc(x, y, r * 2.6, 0, 7); g.fill(); g.globalCompositeOperation = 'source-over'; g.fillStyle = c[4]; g.globalAlpha = 0.85; g.beginPath(); g.arc(x, y, r * 0.55, 0, 7); g.fill(); g.globalAlpha = 1; }
      if (/neon|cyber|grid|retro|synth|80s/.test(t + name)) { g.strokeStyle = c[2]; g.globalAlpha = 0.6; g.lineWidth = 1.2; const hz = H * 0.68; for (let i = 0; i < 18; i++) { const y = hz + (H - hz) * Math.pow(i / 18, 2); g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); } for (let i = -12; i <= 12; i++) { g.beginPath(); g.moveTo(W / 2 + i * W * 0.02, hz); g.lineTo(W / 2 + i * W * 0.18, H); g.stroke(); } g.globalAlpha = 1; }
      const layers = 3;
      const kind = /city|cyber|tokyo|skyline|urban|street/.test(t) ? 'city' : /ocean|sea|wave|beach|water/.test(t) ? 'waves' : 'mountains';
      for (let L = 0; L < layers; L++) {
        const base = H * (0.6 + L * 0.11), col = L === layers - 1 ? '#000' : c[Math.max(0, 1 - L + 1)];
        g.fillStyle = col; g.globalAlpha = 0.55 + L * 0.2; g.beginPath(); g.moveTo(0, H);
        if (kind === 'city') { let x = 0; while (x < W) { const bw = W * (0.03 + R() * 0.06), bh = H * (0.08 + R() * (0.3 - L * 0.07)); g.lineTo(x, base - bh); g.lineTo(x + bw, base - bh); x += bw; } g.lineTo(W, H); g.fill(); if (L < 2) { g.fillStyle = c[4]; g.globalAlpha = 0.6; for (let i = 0; i < 60; i++) g.fillRect(R() * W, base - R() * H * 0.25, 2, 3); } }
        else if (kind === 'waves') { const f = 2 + R() * 4, ph = R() * 6; for (let x = 0; x <= W; x += 6) g.lineTo(x, base + Math.sin(x / W * f * 6.28 + ph) * H * 0.02 + Math.sin(x / W * f * 17 + ph) * H * 0.006); g.lineTo(W, H); g.fill(); }
        else { let y = base - H * 0.1; for (let x = 0; x <= W; x += W / 40) { y += (R() - 0.5) * H * 0.06; y = Math.max(base - H * (0.28 - L * 0.05), Math.min(base, y)); g.lineTo(x, y); } g.lineTo(W, H); g.fill(); }
      }
      g.globalAlpha = 1;
      const img = g.getImageData(0, 0, W, H), d = img.data; for (let i = 0; i < d.length; i += 4) { const n = (R() - 0.5) * 18; d[i] += n; d[i + 1] += n; d[i + 2] += n; } g.putImageData(img, 0, 0);
      const vg = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)'); g.fillStyle = vg; g.fillRect(0, 0, W, H);
      g.font = `500 ${Math.max(10, Math.round(W / 60))}px ui-monospace,monospace`; g.fillStyle = 'rgba(255,255,255,0.75)'; g.textAlign = 'left'; g.fillText(prompt.slice(0, 70), W * 0.03, H - W * 0.03);
      return cv.toDataURL('image/png');
    }
    const blobToData = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });
    async function pollinations(prompt, w, h, seed) {
      const ac = new AbortController(); const to = setTimeout(() => ac.abort(), 8000);
      try { const r = await fetch(`https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${w}&height=${h}&seed=${seed}&nologo=true`, { signal: ac.signal }); if (!r.ok) throw new Error('HTTP ' + r.status); const b = await r.blob(); if (!/^image\//.test(b.type)) throw new Error('not image'); return await blobToData(b); } finally { clearTimeout(to); }
    }
    async function genImage(a, tctx) {
      const prompt = String(a.prompt || 'abstract art').slice(0, 400); const w = Math.max(64, Math.min(1536, a.width | 0 || 768)), hh = Math.max(64, Math.min(1536, a.height | 0 || 768));
      const seed = a.seed != null ? (a.seed >>> 0) : h32(prompt + w + 'x' + hh); const full = a.style ? prompt + ', ' + a.style : prompt;
      let data = null, source = 'procedural';
      if (navigator.onLine) { try { data = await pollinations(full, w, hh, seed); source = 'pollinations'; } catch (_) { data = null; } }
      if (!data) { data = procedural(prompt, w, hh, seed, a.style); source = 'procedural'; }
      const path = '/media/img-' + h32(full + seed + w + hh).toString(36) + '.png'; await saveFile(path, data, tctx);
      return { path, width: w, height: hh, seed, source, prompt };
    }
    // ---------- video scenes ----------
    const sceneTotal = s => (s.scenes || []).reduce((t, x) => t + (+x.duration || 3), 0) || 1;
    const easeOut = x => 1 - Math.pow(1 - Math.max(0, Math.min(1, x)), 3);
    function drawFrame(g, S, T, W, H, imgs) {
      let t = T, sc = S.scenes[0], i = 0; for (; i < S.scenes.length; i++) { const d = +S.scenes[i].duration || 3; if (t < d || i === S.scenes.length - 1) { sc = S.scenes[i]; break; } t -= d; }
      const dur = +sc.duration || 3, bg = sc.background || { type: 'solid', colors: ['#111'] }, cols = bg.colors && bg.colors.length ? bg.colors : ['#111'];
      g.globalAlpha = 1; g.setTransform(1, 0, 0, 1, 0, 0);
      if (bg.type === 'gradient' && cols.length > 1) { const a = (bg.angle || 135) * Math.PI / 180 + t * 0.05; const gr = g.createLinearGradient(W / 2 - Math.cos(a) * W, H / 2 - Math.sin(a) * H, W / 2 + Math.cos(a) * W, H / 2 + Math.sin(a) * H); cols.forEach((c, k) => gr.addColorStop(k / (cols.length - 1), c)); g.fillStyle = gr; } else g.fillStyle = cols[0];
      g.fillRect(0, 0, W, H);
      for (const L of sc.layers || []) {
        const an = L.anim || {}, delay = +an.delay || 0, ad = +an.duration || 0.8, p = easeOut((t - delay) / ad); if (t < delay && an.kind && an.kind !== 'pulse') continue;
        let alpha = 1, dx = 0, dy = 0, sc2 = 1;
        if (an.kind === 'fade') alpha = p; else if (an.kind === 'slide') { const dir = an.from || 'left'; const off = (1 - p) * (dir === 'left' || dir === 'right' ? W : H) * 0.4 * (dir === 'left' || dir === 'top' ? -1 : 1); if (dir === 'left' || dir === 'right') dx = off; else dy = off; alpha = p; } else if (an.kind === 'zoom') { sc2 = 0.6 + 0.4 * p; alpha = p; } else if (an.kind === 'pulse') sc2 = 1 + Math.sin(t * Math.PI * 2 * (an.speed || 1)) * 0.06;
        const out = an.out !== false ? Math.min(1, (dur - t) / 0.35) : 1; alpha *= Math.max(0, out);
        const x = (L.x != null ? L.x : 0.5) * W + dx, y = (L.y != null ? L.y : 0.5) * H + dy;
        g.save(); g.globalAlpha = Math.max(0, Math.min(1, alpha * (L.opacity != null ? L.opacity : 1))); g.translate(x, y); g.scale(sc2, sc2);
        const color = L.color || '#fff';
        if (L.type === 'text') { let txt = String(L.text || ''); if (an.kind === 'type') txt = txt.slice(0, Math.floor(Math.max(0, t - delay) * (an.cps || 18))); const fs = (L.size || 0.08) * H; g.font = `${L.weight || 700} ${fs}px ${L.font || 'system-ui, sans-serif'}`; g.textAlign = L.align || 'center'; g.textBaseline = 'middle'; if (L.glow) { g.shadowColor = color; g.shadowBlur = fs * 0.4; } g.fillStyle = color; g.fillText(txt, 0, 0); }
        else if (L.type === 'shape') { g.fillStyle = color; g.strokeStyle = color; g.lineWidth = (L.stroke || 0.006) * H; const r = (L.r || 0.1) * H; if (L.rotate) g.rotate(t * L.rotate); if (L.shape === 'rect') g.fillRect(-(L.w || 0.3) * W / 2, -(L.h || 0.1) * H / 2, (L.w || 0.3) * W, (L.h || 0.1) * H); else { g.beginPath(); g.arc(0, 0, r, 0, 7); L.shape === 'ring' ? g.stroke() : g.fill(); } }
        else if (L.type === 'particles') { g.setTransform(1, 0, 0, 1, 0, 0); const R = rng(L.seed || 7), n = L.count || 60, sp = L.speed || 0.05; g.fillStyle = color; for (let k = 0; k < n; k++) { const px = (R() * W + Math.sin(T * 0.5 + k) * W * 0.01), py = ((R() - T * sp * (0.5 + R())) % 1 + 1) % 1 * H, s = (L.size || 0.004) * H * (0.4 + R()); g.globalAlpha = alpha * (0.3 + R() * 0.7); g.beginPath(); g.arc(px, py, s, 0, 7); g.fill(); } }
        else if (L.type === 'wave') { g.setTransform(1, 0, 0, 1, 0, 0); g.strokeStyle = color; g.lineWidth = (L.width || 0.006) * H; const lines = L.lines || 3; for (let k = 0; k < lines; k++) { g.globalAlpha = alpha * (1 - k / (lines + 1)); g.beginPath(); for (let px = 0; px <= W; px += 4) { const py = (L.y != null ? L.y : 0.7) * H + Math.sin(px / W * 6.28 * (L.freq || 2) + T * (L.speed || 2) + k * 0.7) * (L.amp || 0.05) * H; px ? g.lineTo(px, py) : g.moveTo(px, py); } g.stroke(); } }
        else if (L.type === 'image' && L.path) { const im = imgs[L.path]; if (im && im.complete && im.naturalWidth) { const w = (L.w || 0.5) * W, h2 = L.h ? L.h * H : w * im.naturalHeight / im.naturalWidth; g.drawImage(im, -w / 2, -h2 / 2, w, h2); } }
        g.restore();
      }
    }
    function normScene(s) { if (typeof s === 'string') s = JSON.parse(s); s = s || {}; s.width = s.width || 640; s.height = s.height || 360; s.fps = s.fps || 30; s.scenes = Array.isArray(s.scenes) && s.scenes.length ? s.scenes : [{ duration: 3, background: { type: 'gradient', colors: ['#222', '#555'] }, layers: [{ type: 'text', text: s.title || 'Untitled', anim: { kind: 'fade' } }] }]; return s; }
    function player(el, scene) {
      const S = normScene(scene), total = sceneTotal(S), imgs = {};
      for (const sc of S.scenes) for (const L of sc.layers || []) if (L.type === 'image' && L.path && !imgs[L.path]) { const im = new Image(); imgs[L.path] = im; readData(L.path).then(d => { if (d) im.src = d; }); }
      el.innerHTML = ''; const wrap = U.el('div', { class: 'md-player' });
      const cv = U.el('canvas'); cv.width = S.width; cv.height = S.height; const g = cv.getContext('2d');
      const bar = U.el('div', { class: 'md-pbar' }); const pb = U.el('button', { class: 'icon-btn', title: 'Play/pause' }); const rg = U.el('input', { type: 'range', min: '0', max: String(total), step: '0.01', value: '0', class: 'grow' }); const tl = U.el('span', { class: 'xs mono muted' }); const ex = U.el('button', { class: 'btn sm', title: 'Export webm' }, DS.icon('download') + ' webm');
      bar.append(pb, rg, tl, ex); wrap.append(cv, bar); el.appendChild(wrap);
      let t = 0, playing = true, last = performance.now(), raf = 0;
      const setIcon = () => { pb.innerHTML = DS.icon(playing ? 'stop' : 'play'); };
      const draw = () => { drawFrame(g, S, t, S.width, S.height, imgs); rg.value = t; tl.textContent = t.toFixed(1) + '/' + total.toFixed(1) + 's'; };
      const loop = now => { if (!cv.isConnected) { if (++loop.miss > 3) return; } else loop.miss = 0; if (playing) { t = (t + (now - last) / 1000) % total; } last = now; draw(); raf = requestAnimationFrame(loop); }; loop.miss = 0;
      pb.onclick = () => { playing = !playing; setIcon(); }; rg.oninput = () => { t = +rg.value; draw(); };
      ex.onclick = async () => {
        if (!cv.captureStream || typeof MediaRecorder === 'undefined') return DS.ui.toast('Video export not supported in this browser', 'warn');
        const st = cv.captureStream(S.fps); const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(m => MediaRecorder.isTypeSupported(m)) || ''; const rec = new MediaRecorder(st, mime ? { mimeType: mime } : {}); const ch = [];
        rec.ondataavailable = e => e.data.size && ch.push(e.data); rec.onstop = () => { U.download(slug(S.title) + '.webm', new Blob(ch, { type: 'video/webm' })); DS.ui.toast('Exported webm', 'ok'); ex.disabled = false; };
        ex.disabled = true; t = 0; playing = true; setIcon(); rec.start(); DS.ui.toast('Recording ' + total.toFixed(1) + 's…'); setTimeout(() => rec.stop(), total * 1000 + 100);
      };
      setIcon(); raf = requestAnimationFrame(loop); el._player = { canvas: cv, seek: x => { t = x; draw(); }, stop: () => cancelAnimationFrame(raf), scene: S };
      return el._player;
    }
    async function renderVideo(a, tctx) {
      const S = normScene({ title: a.title, scenes: a.scenes, width: Math.min(1280, a.width || 640), height: Math.min(1280, a.height || 360), fps: Math.min(60, a.fps || 30) });
      const path = '/media/' + slug(S.title || 'video') + '-' + h32(JSON.stringify(S)).toString(36).slice(0, 5) + '.scene.json'; await saveFile(path, JSON.stringify(S, null, 1), tctx);
      return { path, duration: +sceneTotal(S).toFixed(2), scenes: S.scenes.length, width: S.width, height: S.height };
    }
    function sceneFromPrompt(p) {
      const { c } = pickPalette(p, ''); const title = p.replace(/^(please\s+)?(make|create|render|generate|build)\s+(me\s+)?(a|an)?\s*/i, '').replace(/^(short\s+)?(video|animation|trailer|intro|clip)\s*(about|of|for|showing)?\s*/i, '').trim() || 'Forge';
      const T = title.length > 28 ? title.slice(0, 28) + '…' : title; const words = title.split(/\s+/).filter(w => w.length > 3).slice(0, 3);
      return { title: T, width: 640, height: 360, fps: 30, scenes: [
        { duration: 3, background: { type: 'gradient', colors: [c[0], c[1], c[2]] }, layers: [{ type: 'particles', count: 90, color: c[4], speed: 0.06 }, { type: 'shape', shape: 'ring', r: 0.3, color: c[3], opacity: 0.5, anim: { kind: 'pulse', speed: 0.5 } }, { type: 'text', text: T.toUpperCase(), size: 0.11, color: c[4], glow: true, anim: { kind: 'zoom', duration: 1.2 } }, { type: 'text', text: 'a Forge production', y: 0.68, size: 0.04, color: c[3], anim: { kind: 'fade', delay: 1 } }] },
        { duration: 3.5, background: { type: 'gradient', colors: [c[1], c[0]] }, layers: [{ type: 'wave', color: c[3], amp: 0.06, freq: 2, lines: 4, y: 0.72 }, { type: 'text', text: words[0] ? words.join(' · ') : 'Imagine.', size: 0.08, color: c[4], y: 0.4, anim: { kind: 'type', cps: 16 } }] },
        { duration: 3, background: { type: 'gradient', colors: [c[2], c[1], c[0]] }, layers: [{ type: 'particles', count: 140, color: '#ffffff', speed: 0.12, size: 0.003 }, { type: 'text', text: 'Coming soon', size: 0.1, color: '#fff', glow: true, anim: { kind: 'slide', from: 'bottom' } }] },
      ] };
    }
    // ---------- audio ----------
    const NOTE = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
    const noteHz = n => { const m = /^([a-g])([#b]?)(-?\d)?$/i.exec(String(n).trim()); if (!m) return null; let s = NOTE[m[1].toLowerCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0); const oct = m[3] != null ? +m[3] : 4; return 440 * Math.pow(2, (s + (oct + 1) * 12 - 69) / 12); };
    function wav(buf) {
      const d = buf.getChannelData(0), n = d.length, sr = buf.sampleRate, ab = new ArrayBuffer(44 + n * 2), v = new DataView(ab); const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
      ws(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); ws(8, 'WAVE'); ws(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); ws(36, 'data'); v.setUint32(40, n * 2, true);
      let pk = 0; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(d[i])); const gain = pk > 0 ? 0.9 / pk : 1;
      for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, d[i] * gain)) * 32767, true);
      const by = new Uint8Array(ab); let s = ''; for (let i = 0; i < by.length; i += 0x8000) s += String.fromCharCode.apply(null, by.subarray(i, i + 0x8000)); return 'data:audio/wav;base64,' + btoa(s);
    }
    async function genAudio(a, tctx) {
      const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext; if (!OAC) return 'Error: OfflineAudioContext not available in this browser';
      const kind = ['melody', 'ambient', 'sfx'].includes(a.kind) ? a.kind : 'melody', prompt = String(a.prompt || a.notes || kind), R = rng(h32(prompt + kind)), bpm = Math.max(40, Math.min(220, a.bpm || 110)), sr = 22050;
      const secs = Math.max(0.3, Math.min(12, a.seconds || (kind === 'sfx' ? 1 : kind === 'ambient' ? 8 : 6))); const ac = new OAC(1, Math.ceil(sr * secs), sr); const out = ac.createGain(); out.gain.value = 0.6; out.connect(ac.destination);
      const tone = (f, t0, d, type = 'triangle', vol = 0.3, f2) => { const o = ac.createOscillator(), e = ac.createGain(); o.type = type; o.frequency.setValueAtTime(f, t0); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + d); e.gain.setValueAtTime(0.0001, t0); e.gain.exponentialRampToValueAtTime(vol, t0 + Math.min(0.02, d / 4)); e.gain.exponentialRampToValueAtTime(0.0001, t0 + d); o.connect(e); e.connect(out); o.start(t0); o.stop(t0 + d + 0.02); };
      const noise = (t0, d, vol = 0.4) => { const b = ac.createBuffer(1, Math.ceil(sr * d), sr), ch = b.getChannelData(0); for (let i = 0; i < ch.length; i++) ch[i] = (R() * 2 - 1) * Math.pow(1 - i / ch.length, 2); const s = ac.createBufferSource(), e = ac.createGain(); e.gain.value = vol; s.buffer = b; s.connect(e); e.connect(out); s.start(t0); };
      const p = prompt.toLowerCase(); let notes = [];
      if (kind === 'melody') {
        const given = String(a.notes || '').split(/[\s,]+/).map(noteHz).filter(Boolean); const beat = 60 / bpm / 2;
        if (given.length) notes = given; else { const minor = /sad|dark|minor|night|rain|mystery/.test(p); const sc = minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 7, 9]; const root = 48 + (h32(p) % 12); let idx = 0; const n = Math.floor(secs / beat); for (let i = 0; i < n; i++) { idx = Math.max(0, Math.min(sc.length * 2 - 1, idx + Math.floor(R() * 5) - 2)); notes.push(440 * Math.pow(2, (root + 12 + sc[idx % sc.length] + 12 * Math.floor(idx / sc.length) - 69) / 12)); } }
        notes.forEach((f, i) => { const t0 = i * beat; if (t0 < secs - 0.05) { tone(f, t0, beat * 1.8, 'triangle', 0.3); if (i % 4 === 0) tone(f / 2, t0, beat * 3.5, 'sine', 0.2); } });
        if (/beat|drum|dance|groove/.test(p)) for (let t0 = 0; t0 < secs; t0 += beat * 2) { tone(120, t0, 0.18, 'sine', 0.6, 40); noise(t0 + beat, 0.06, 0.15); }
      } else if (kind === 'ambient') {
        const root = 110 * Math.pow(2, (h32(p) % 7) / 12); [1, 1.5, 2, 2.52, 3].forEach((m, i) => { for (const det of [-3, 3]) { const o = ac.createOscillator(), e = ac.createGain(), l = ac.createOscillator(), lg = ac.createGain(); o.type = 'sine'; o.frequency.value = root * m; o.detune.value = det; l.frequency.value = 0.1 + i * 0.07; lg.gain.value = 0.05; l.connect(lg); lg.connect(e.gain); e.gain.setValueAtTime(0, 0); e.gain.linearRampToValueAtTime(0.08 / (i + 1), secs * 0.3); e.gain.linearRampToValueAtTime(0, secs); o.connect(e); e.connect(out); o.start(0); l.start(0); o.stop(secs); l.stop(secs); } });
        for (let i = 0; i < secs * 1.5; i++) tone(root * 4 * [1, 1.25, 1.5, 2][Math.floor(R() * 4)], R() * secs * 0.9, 1.2, 'sine', 0.05);
      } else {
        if (/laser|zap|shoot/.test(p)) tone(1800, 0, Math.min(secs, 0.4), 'sawtooth', 0.3, 120);
        else if (/coin|pickup|ding|bell/.test(p)) { tone(988, 0, 0.08, 'square', 0.25); tone(1319, 0.08, Math.min(secs, 0.5), 'square', 0.25); }
        else if (/explo|boom|crash|blast/.test(p)) { noise(0, Math.min(secs, 1.2), 0.8); tone(90, 0, Math.min(secs, 0.8), 'sine', 0.6, 30); }
        else if (/jump|bounce|boing/.test(p)) tone(220, 0, Math.min(secs, 0.35), 'square', 0.25, 880);
        else if (/power|level|win|success/.test(p)) [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.25, 'square', 0.2));
        else { tone(400 + R() * 600, 0, Math.min(secs, 0.5), 'triangle', 0.3, 80 + R() * 400); noise(0, 0.1, 0.2); }
      }
      const buf = await ac.startRendering(); const data = wav(buf); const path = '/media/' + slug(kind + '-' + prompt) + '-' + h32(prompt + secs + bpm).toString(36).slice(0, 4) + '.wav'; await saveFile(path, data, tctx);
      return { path, kind, seconds: +secs.toFixed(2), sampleRate: sr, bytes: Math.round((data.length - 22) * 0.75) };
    }
    // ---------- inline renderers ----------
    const resOf = part => { let r = part && part.result; if (typeof r === 'string') { try { r = JSON.parse(r); } catch (_) {} } return r || {}; };
    function imgEl(path) { const im = U.el('img', { class: 'md-img', alt: path }); readData(path).then(d => { if (d) im.src = d; }); im.onclick = () => openItem(path); return im; }
    async function audioEl(path) { const au = U.el('audio', { controls: 'controls', class: 'md-audio' }); const d = await readData(path); if (d) au.src = d; return au; }
    function mountScene(el, path) { readData(path).then(d => { if (d) try { player(el, d); } catch (e) { el.textContent = 'Bad scene: ' + e.message; } }); }
    function svgSafe(src) { return String(src).replace(/<script[\s\S]*?</script>/gi, '').replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '').replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '').replace(/(href\s*=\s*["'])\s*javascript:[^"']*/gi, '$1#'); }
    // ---------- tools ----------
    ctx.tool({ name: 'generate_image', label: 'Generate image', gate: 'write',
      description: 'Generate an image from a text prompt and save it as a PNG under /media. Uses an online image model when reachable, otherwise an offline procedural art renderer. Returns {path,width,height,source}. Show it to the user with a ```image fence containing the path.',
      parameters: { type: 'object', properties: { prompt: { type: 'string' }, width: { type: 'integer', description: '64-1536, default 768' }, height: { type: 'integer' }, seed: { type: 'integer' }, style: { type: 'string', description: 'e.g. neon, sunset, ocean, forest, cyberpunk, space, pastel, mono' } }, required: ['prompt'] },
      detail: a => ({ path: '/media/img-*.png' }), run: genImage, summarize: (a, r) => r && r.path ? r.path + ' · ' + r.source : 'image',
      inline(part, el) { const r = resOf(part); if (r.path) { el.innerHTML = ''; el.appendChild(imgEl(r.path)); } } });
    ctx.tool({ name: 'render_video', label: 'Render video', gate: 'write',
      description: 'Create an animated video from a JSON scene list rendered by a canvas player (saved as /media/<slug>.scene.json; user can export webm). Format: {title, width?=640, height?=360, fps?=30, scenes:[{duration(s), background:{type:"gradient"|"solid", colors:[css…], angle?}, layers:[…]}]}. Positions x,y are 0..1 fractions; sizes are fractions of height. Layer types: text{text,x,y,size=0.08,color,weight,glow,align}; shape{shape:"circle"|"ring"|"rect",r|w,h,color,rotate}; particles{count,color,speed,size}; wave{color,amp,freq,lines,y,speed}; image{path,x,y,w}. Any layer may have anim:{kind:"fade"|"slide"|"zoom"|"type"|"pulse", delay?, duration?, from?:"left|right|top|bottom", cps?(type), speed?(pulse)}. Embed with a ```video-scene fence containing the JSON or the path.',
      parameters: { type: 'object', properties: { title: { type: 'string' }, scenes: { type: 'array', items: { type: 'object' } }, width: { type: 'integer' }, height: { type: 'integer' }, fps: { type: 'integer' } }, required: ['scenes'] },
      run: renderVideo, summarize: (a, r) => r && r.path ? r.path + ' · ' + r.duration + 's' : 'video',
      inline(part, el) { const r = resOf(part); if (r.path) mountScene(el, r.path); } });
    ctx.tool({ name: 'generate_audio', label: 'Generate audio', gate: 'write',
      description: 'Synthesize audio offline and save a 16-bit mono 22050 Hz WAV (max 12 s) in /media. kind: "melody" (notes like "C4 E4 G4 C5" or a prompt-seeded scale; mention beat/drums for percussion), "ambient" (evolving pad), "sfx" (prompt keywords: laser, coin, explosion, jump, powerup). Embed with ```audio fence containing the path.',
      parameters: { type: 'object', properties: { kind: { type: 'string', enum: ['melody', 'ambient', 'sfx'] }, notes: { type: 'string' }, prompt: { type: 'string' }, bpm: { type: 'integer' }, seconds: { type: 'number' } }, required: ['kind'] },
      run: genAudio, summarize: (a, r) => r && r.path ? r.path + ' · ' + r.seconds + 's' : String(r),
      inline(part, el) { const r = resOf(part); if (r.path) audioEl(r.path).then(a => { el.innerHTML = ''; el.appendChild(a); }); } });
    // ---------- fences ----------
    ctx.fence({ langs: ['image'], render(el, code, o) { if (!o.closed) { el.textContent = 'image…'; return; } if (el._src === code) return; el._src = code; el.innerHTML = ''; const v = code.trim(); if (/^\/\S+\.(png|jpe?g|gif|webp|svg)$/i.test(v)) el.appendChild(imgEl(v)); else { el.textContent = 'Generating…'; genImage({ prompt: v }).then(r => { el.innerHTML = ''; el.appendChild(imgEl(r.path)); }).catch(e => { el.textContent = e.message; }); } } });
    ctx.fence({ langs: ['svg'], render(el, code, o) { if (!o.closed) return; if (el._src === code) return; el._src = code; el.innerHTML = ''; el.appendChild(U.el('img', { class: 'md-img', alt: 'svg', src: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgSafe(code)) })); } });
    ctx.fence({ langs: ['video-scene'], render(el, code, o) { if (!o.closed) { el.textContent = 'scene…'; return; } if (el._src === code) return; el._src = code; const v = code.trim(); if (/^\/\S+\.json$/.test(v)) mountScene(el, v); else try { player(el, v); } catch (e) { el.textContent = 'Bad scene JSON: ' + e.message; } } });
    ctx.fence({ langs: ['audio'], render(el, code, o) { if (!o.closed) return; if (el._src === code) return; el._src = code; audioEl(code.trim()).then(a => { el.innerHTML = ''; el.appendChild(a); }); } });
    ctx.previewer({ id: 'media', match: p => /\.(png|wav)$|\.scene\.json$/.test(p), render(el, { path }) { if (/\.png$/.test(path)) el.appendChild(imgEl(path)); else if (/\.wav$/.test(path)) audioEl(path).then(a => el.appendChild(a)); else mountScene(el, path); } });
    // ---------- css ----------
    ctx.effect(() => { const s = document.createElement('style'); s.textContent = `
.md-img{max-width:100%;border-radius:var(--radius);display:block;border:1px solid var(--line);cursor:zoom-in}.md-audio{width:100%}
.md-player{border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;background:#000}.md-player canvas{width:100%;display:block}
.md-pbar{display:flex;align-items:center;gap:6px;padding:4px 8px;background:var(--card);color:var(--text)}.md-pbar input{min-width:0}
.st-tabs{margin:0 0 10px}.st-body{padding:0 0 16px}.st-ta{width:100%;min-height:76px;resize:vertical}
.st-row{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0;align-items:center}.st-chip{cursor:pointer;min-height:32px}.st-chip.on{background:var(--accent-soft);border-color:var(--accent-line);color:var(--accent)}
.st-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:12px}.st-cell{aspect-ratio:1;border-radius:10px;overflow:hidden;background:var(--card-2);border:1px solid var(--line);display:flex;align-items:center;justify-content:center;flex-direction:column;gap:4px;cursor:pointer;font-size:11px;color:var(--text-2);text-align:center;padding:2px}
.st-cell img{width:100%;height:100%;object-fit:cover}.st-cell .ic svg{width:26px;height:26px}.st-out{margin-top:10px}`; document.head.appendChild(s); return () => s.remove(); });
    // ---------- studio ----------
    async function mediaList() { try { return (await DS.fs.walk('/media')).filter(p => /\.(png|wav|jpe?g|webp)$|\.scene\.json$/.test(p)).reverse(); } catch (_) { return []; } }
    function openItem(path) {
      const node = U.el('div', { class: 'col', style: 'gap:10px' }); const name = path.split('/').pop();
      if (/\.wav$/.test(path)) audioEl(path).then(a => node.appendChild(a)); else if (/\.json$/.test(path)) { const d = U.el('div'); node.appendChild(d); mountScene(d, path); } else { const im = imgEl(path); im.onclick = null; node.appendChild(im); }
      node.appendChild(U.el('div', { class: 'xs mono muted' }, esc(path)));
      DS.ui.sheet({ title: name, node, actions: [
        { label: 'Delete', danger: true, onClick: async c => { if (await DS.ui.confirm('Delete ' + name + '?', 'Delete')) { let b = null; try { b = (await DS.fs.read(path)).content; } catch (_) {} DS.agent.recordChange(thr(), path, b); await DS.fs.remove(path); DS.bus.emit('media:update', path); c(); } } },
        { label: 'Download', onClick: async () => { const d = await readData(path); if (!d) return; if (/^data:/.test(d)) { const r = await fetch(d); U.download(name, await r.blob()); } else U.download(name, d, 'application/json'); } },
        { label: 'Use in chat', primary: true, onClick: c => { const tv = DS.threadView; const fence = /\.wav$/.test(path) ? 'audio' : /\.json$/.test(path) ? 'video-scene' : 'image'; if (tv && tv.cctx) tv.cctx().addContext(name, 'Media file ' + path + ' (embed with ```' + fence + '\n' + path + '\n```)'); DS.shell.show('thread'); c(); DS.ui.toast('Added ' + name + ' to context', 'ok'); } },
      ] });
    }
    const enhance = (p, tab) => { const extra = { image: ['highly detailed', 'cinematic lighting', 'volumetric glow', 'dramatic composition', '8k'], video: ['epic', 'cinematic'], audio: ['dreamy', 'upbeat'] }[tab]; const has = extra.filter(w => !p.toLowerCase().includes(w)); return (p.trim() || 'a mysterious landscape') + (has.length ? ', ' + has.slice(0, 3).join(', ') : ''); };
    ctx.view({ id: 'studio', title: 'Studio', icon: 'image', order: 30,
      mount(el) {
        el.innerHTML = `<div class="vhead"><h2>Studio</h2></div><div class="vscroll"><div class="seg st-tabs"><button data-t="image" class="on">Image</button><button data-t="video">Video</button><button data-t="audio">Audio</button></div><div class="st-body"><textarea class="inp st-ta" placeholder="Describe what to create…"></textarea><div class="st-row st-opts"></div><div class="st-row"><button class="btn sm st-enh">${DS.icon('sparkle')} Enhance</button><span class="grow"></span><button class="btn pri st-go">${DS.icon('sparkle')} Generate</button></div><div class="st-out"></div><div class="sec-t">Gallery</div><div class="st-grid"></div></div></div>`;
        const q = s => el.querySelector(s), ta = q('.st-ta'), opts = q('.st-opts'), out = q('.st-out'), grid = q('.st-grid'); let tab = 'image'; const st = { aspect: '1:1', style: '', seed: '', kind: 'melody' };
        const chips = (list, key) => list.map(v => `<button class="chip st-chip ${st[key] === v ? 'on' : ''}" data-k="${key}" data-v="${v}">${v || 'auto'}</button>`).join('');
        const renderOpts = () => { opts.innerHTML = tab === 'image' ? chips(['1:1', '16:9', '9:16'], 'aspect') + '<span style="width:100%"></span>' + chips([''].concat(STYLE_WORDS.slice(0, 8)), 'style') + '<input class="inp st-seed" inputmode="numeric" placeholder="seed" style="width:90px" value="' + esc(st.seed) + '">' : tab === 'audio' ? chips(['melody', 'ambient', 'sfx'], 'kind') : chips(['16:9', '9:16', '1:1'], 'aspect'); const sd = opts.querySelector('.st-seed'); if (sd) sd.oninput = () => { st.seed = sd.value; }; };
        opts.onclick = e => { const b = e.target.closest('.st-chip'); if (!b) return; st[b.dataset.k] = b.dataset.v; renderOpts(); };
        q('.st-tabs').onclick = e => { const b = e.target.closest('button'); if (!b) return; tab = b.dataset.t; el.querySelectorAll('.st-tabs button').forEach(x => x.classList.toggle('on', x === b)); ta.placeholder = { image: 'A neon city skyline at night…', video: 'An intro for my space podcast…', audio: 'A calm night melody / laser sfx…' }[tab]; renderOpts(); };
        q('.st-enh').onclick = () => { ta.value = enhance(ta.value, tab); };
        const dims = a => ({ '1:1': [768, 768], '16:9': [1024, 576], '9:16': [576, 1024] }[a] || [768, 768]);
        q('.st-go').onclick = async () => {
          const p = ta.value.trim() || ta.placeholder.replace('…', ''); const go = q('.st-go'); go.disabled = true; out.innerHTML = '<div class="muted sm">Generating…</div>';
          try { let r; const [w, h] = dims(st.aspect);
            if (tab === 'image') { r = await genImage({ prompt: p, width: w, height: h, style: st.style || undefined, seed: st.seed !== '' ? +st.seed : undefined }); out.innerHTML = ''; out.appendChild(imgEl(r.path)); }
            else if (tab === 'video') { const s = sceneFromPrompt(p); const vw = st.aspect === '9:16' ? 360 : st.aspect === '1:1' ? 480 : 640, vh = st.aspect === '9:16' ? 640 : st.aspect === '1:1' ? 480 : 360; r = await renderVideo(Object.assign(s, { width: vw, height: vh })); out.innerHTML = ''; mountScene(out, r.path); }
            else { r = await genAudio({ kind: st.kind, prompt: p }); if (typeof r === 'string') throw new Error(r); out.innerHTML = ''; out.appendChild(await audioEl(r.path)); }
            out.appendChild(U.el('div', { class: 'xs mono muted', style: 'margin-top:4px' }, esc(r.path + (r.source ? ' · ' + r.source : ''))));
          } catch (e) { out.innerHTML = '<div class="chip err">' + esc(e.message) + '</div>'; } finally { go.disabled = false; }
        };
        const refresh = async () => { const items = await mediaList(); grid.innerHTML = items.length ? '' : '<div class="muted sm" style="grid-column:1/-1">Nothing yet — generate something above.</div>'; for (const p of items.slice(0, 60)) { const c = U.el('div', { class: 'st-cell', title: p }); if (/\.(png|jpe?g|webp)$/.test(p)) c.appendChild(imgEl(p)); else c.innerHTML = '<span class="ic">' + DS.icon(/\.wav$/.test(p) ? 'speaker' : 'video') + '</span>' + esc(p.split('/').pop().replace(/-[a-z0-9]{4,5}\.(wav|scene\.json)$/, '').slice(0, 24)); c.onclick = () => openItem(p); grid.appendChild(c); } };
        renderOpts(); refresh(); const off = DS.bus.on ? DS.bus.on('media:update', DS.util.debounce ? DS.util.debounce(refresh, 150) : refresh) : null;
        el._refresh = refresh; return () => { if (typeof off === 'function') off(); else if (DS.bus.off) DS.bus.off('media:update', refresh); };
      }, onShow(el) { el._refresh && el._refresh(); } });
    // ---------- commands ----------
    const reply = (cctx, md) => (DS.threadView && DS.threadView.replyLocal ? DS.threadView.replyLocal(md) : cctx.reply(md));
    ctx.command({ name: 'image', args: '<prompt>', desc: 'Generate an image', async run(a, c) { if (!a.trim()) return c.reply('Usage: `/image <prompt>`'); const r = await genImage({ prompt: a.trim() }, c); reply(c, `**${esc(a.trim())}** · ${r.width}×${r.height} · ${r.source}\n\n\`\`\`image\n${r.path}\n\`\`\``); } });
    ctx.command({ name: 'video', args: '<prompt>', desc: 'Render an animated scene video', async run(a, c) { const r = await renderVideo(sceneFromPrompt(a.trim() || 'Forge intro'), c); reply(c, `**Video** · ${r.duration}s · ${r.scenes} scenes\n\n\`\`\`video-scene\n${r.path}\n\`\`\``); } });
    ctx.command({ name: 'audio', args: '<prompt>', desc: 'Synthesize music or sfx', async run(a, c) { const p = a.trim() || 'melody'; const kind = /sfx|laser|coin|explo|jump|boom|zap|power/i.test(p) ? 'sfx' : /ambient|pad|drone|calm|relax/i.test(p) ? 'ambient' : 'melody'; const r = await genAudio({ kind, prompt: p }, c); if (typeof r === 'string') return c.reply(r); reply(c, `**${kind}** · ${r.seconds}s\n\n\`\`\`audio\n${r.path}\n\`\`\``); } });
    // ---------- sim intents ----------
    const subj = t => t.replace(/^.*?\b(?:of|about|showing|with|for)\s+/i, '').replace(/[.!?]+$/, '').trim() || t;
    ctx.intent({ id: 'media-image', order: 50, match: t => /\b(make|generate|draw|create|paint|render|design)\b.*\b(image|picture|poster|wallpaper|illustration|art|photo|drawing|painting)\b/i.test(t), script: t => [{ say: 'Generating the image…', tool: { name: 'generate_image', args: { prompt: subj(t), width: /wallpaper|phone/i.test(t) ? 576 : /poster/i.test(t) ? 640 : 768, height: /wallpaper|phone/i.test(t) ? 1024 : /poster/i.test(t) ? 896 : 768 } } }, { final: rs => { const r = rs[0] || {}; return r.path ? `Here it is${r.source === 'procedural' ? ' (offline procedural renderer)' : ''}:\n\n\`\`\`image\n${r.path}\n\`\`\`\n\nSaved to \`${r.path}\` — open **Studio** to tweak style, aspect or seed.` : 'Image generation failed: ' + JSON.stringify(r); } }] });
    ctx.intent({ id: 'media-video', order: 50, match: t => /\b(make|create|render|generate|build)\b.*\b(video|animation|trailer|intro|clip|animated)\b/i.test(t), script: t => { const s = sceneFromPrompt(t); return [{ say: 'Composing a ' + s.scenes.length + '-scene animation…', tool: { name: 'render_video', args: s } }, { final: rs => { const r = rs[0] || {}; return r.path ? `Rendered **${s.title}** (${r.duration}s, ${r.scenes} scenes):\n\n\`\`\`video-scene\n${r.path}\n\`\`\`\n\nUse **webm** under the player to export.` : 'Video failed: ' + JSON.stringify(r); } }]; } });
    ctx.intent({ id: 'media-audio', order: 50, match: t => /\b(make|create|compose|generate|play|synth\w*)\b.*\b(sound|music|melody|beat|tune|song|jingle|sfx|effect|ambient|soundtrack)\b/i.test(t), script: t => { const kind = /sfx|effect|laser|coin|explo|jump|boom/i.test(t) ? 'sfx' : /ambient|pad|drone|calm|relax|soundtrack/i.test(t) ? 'ambient' : 'melody'; return [{ say: 'Synthesizing ' + kind + '…', tool: { name: 'generate_audio', args: { kind, prompt: t, bpm: /fast|upbeat|dance/i.test(t) ? 140 : 100 } } }, { final: rs => { const r = rs[0] || {}; return r.path ? `Here's your ${kind} (${r.seconds}s WAV):\n\n\`\`\`audio\n${r.path}\n\`\`\`` : 'Audio failed: ' + JSON.stringify(r); } }]; } });
    ctx.suggest({ id: 'media-img', emoji: '🎨', title: 'Generate an image', sub: 'Neon city wallpaper', prompt: 'Generate an image of a neon cyberpunk city skyline at night' });
    ctx.suggest({ id: 'media-vid', emoji: '🎬', title: 'Make a video intro', sub: 'Animated title + particles', prompt: 'Make a video intro for my space exploration podcast' });
    ctx.suggest({ id: 'media-aud', emoji: '🎵', title: 'Compose a melody', sub: 'Synthesized WAV', prompt: 'Compose a dreamy melody with a soft beat' });
    ctx.prompt({ id: 'media', text: 'Media tools: generate_image{prompt,width?,height?,seed?,style?} saves a PNG to /media; render_video{title,scenes:[…]} saves an animated canvas scene (see its description for the JSON format: scenes with duration, background gradient/solid, layers text/shape/particles/wave/image with anim fade/slide/zoom/type/pulse; coordinates are 0..1 fractions); generate_audio{kind:melody|ambient|sfx,notes?,prompt?,bpm?,seconds?} saves a WAV. After creating media, show it inline with a fenced block: ```image\\n<path>\\n```, ```video-scene\\n<path>\\n``` or ```audio\\n<path>\\n```. You may also emit ```svg blocks for vector art.' });
  }
});

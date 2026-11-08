/* forge.voice — hands-free Voice Mode: listen → agent → speak → listen. Orb reacts to mic level. */
DS.plugin({
  name: 'forge.voice', title: 'Voice Mode', version: '1.0.0', tags: ['voice', 'speech', 'accessibility'],
  description: 'Hands-free conversation: speech recognition → active thread → sentence-chunked speech synthesis, with barge-in, captions and an animated orb.',
  apply(ctx) {
    const U = DS.util, esc = U.esc;
    const SR = () => window.SpeechRecognition || window.webkitSpeechRecognition;
    const hasTTS = () => !!(window.speechSynthesis && window.SpeechSynthesisUtterance);
    const reduced = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    const DEF = { voice: '', rate: 1, pitch: 1, autoListen: true, lang: '', micOrb: true, bargeIn: false /* off by default: speakers can trigger it via TTS echo */ };
    const cfg = () => Object.assign({}, DEF, ctx.data.get('cfg', {}));
    const setCfg = (patch) => ctx.data.set('cfg', Object.assign(cfg(), patch));
    const lang = () => cfg().lang || navigator.language || 'en-US';
    DS.icons.orb = DS.icons.orb || '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M4 12h1M19 12h1M6.3 6.3l.7.7M17 17l.7.7M12 4v1M12 19v1M6.3 17.7l.7-.7M17 7l.7-.7"/></svg>';

    /* ---------- text → speakable chunks ---------- */
    function stripMd(md) {
      return String(md || '')
        .replace(/```[\s\S]*?(```|$)/g, ' (code block omitted). ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/`([^`]*)`/g, '$1')
        .replace(/^\s{0,3}#{1,6}\s+(.*)$/gm, '$1.')
        .replace(/^\s*>\s?/gm, '')
        .replace(/^\s*([-*+]|\d+[.)])\s+/gm, '')
        .replace(/^\s*\|?[\s:|-]{3,}\|?\s*$/gm, ' ')
        .replace(/\|/g, ', ')
        .replace(/(\*\*|__)(.*?)\1/g, '$2').replace(/(\*|_)(\S[^*_]*?)\1/g, '$2')
        .replace(/~~(.*?)~~/g, '$1').replace(/[*_#~]+/g, '')
        .replace(/https?:\/\/\S+/g, 'link')
        .replace(/\.(\s*\.)+/g, '.').replace(/\n{2,}/g, '. ').replace(/\s+/g, ' ').replace(/\s+([.,!?])/g, '$1').replace(/([.!?…])\s*\.(?!\.)/g, '$1').replace(/^[.\s]+/, '').trim();
    }
    function chunk(text, max = 200) {
      const sents = String(text).match(/[^.!?…]+[.!?…]+["')\]]*|[^.!?…]+$/g) || [];
      const out = []; let cur = '';
      const push = (s) => { s = s.trim(); if (s) out.push(s); };
      for (let s of sents) {
        s = s.trim(); if (!s) continue;
        while (s.length > max) { let cut = s.lastIndexOf(', ', max); if (cut < max / 3) cut = s.lastIndexOf(' ', max); if (cut < 1) cut = max; push(cur); cur = ''; push(s.slice(0, cut + 1)); s = s.slice(cut + 1).trim(); }
        if (cur && (cur + ' ' + s).length > max) { push(cur); cur = s; } else cur = cur ? cur + ' ' + s : s;
        if (/[.!?…]["')\]]*$/.test(cur) && cur.length >= 40) { push(cur); cur = ''; }
      }
      push(cur); return out;
    }

    /* ---------- voices ---------- */
    let voices = [];
    const loadVoices = () => { try { voices = hasTTS() ? speechSynthesis.getVoices() || [] : []; } catch (_) { voices = []; } return voices; };
    ctx.effect(() => {
      if (!hasTTS()) return;
      loadVoices(); const h = () => { loadVoices(); DS.bus.emit('voice:voices', voices.length); };
      try { speechSynthesis.addEventListener('voiceschanged', h); } catch (_) {}
      return () => { try { speechSynthesis.removeEventListener('voiceschanged', h); } catch (_) {} };
    });
    const pickVoice = () => { const c = cfg(); if (!voices.length) loadVoices(); return voices.find(v => v.voiceURI === c.voice) || voices.find(v => (v.lang || '').toLowerCase().startsWith(lang().toLowerCase().slice(0, 2)) && v.default) || voices.find(v => (v.lang || '').toLowerCase().startsWith(lang().toLowerCase().slice(0, 2))) || null; };

    /* ---------- state ---------- */
    const S = { open: false, state: 'closed', muted: false, heard: '', interim: '', said: '', spoken: [], level: 0, error: '', supported: !!SR() };
    let ui = null, rec = null, speakGen = 0, keepAlive = null, audio = null;
    const setState = (st, note) => { S.state = st; if (ui) ui.render(note); DS.bus.emit('voice:state', st); };

    function stopTTS() { speakGen++; clearInterval(keepAlive); keepAlive = null; try { if (hasTTS()) speechSynthesis.cancel(); } catch (_) {} }
    function speak(text, { after } = {}) {
      const clean = stripMd(text); const parts = chunk(clean);
      S.said = clean; if (ui) ui.render();
      if (!parts.length || S.muted || !hasTTS()) { if (after) setTimeout(after, 50); return Promise.resolve(parts); }
      stopTTS(); const gen = ++speakGen; const c = cfg(); const v = pickVoice();
      setState('speaking');
      return new Promise((res) => {
        let left = parts.length;
        const done = () => { if (gen !== speakGen) return res(parts); if (--left <= 0) { clearInterval(keepAlive); keepAlive = null; res(parts); if (after) after(); } };
        parts.forEach((p) => {
          const u = new SpeechSynthesisUtterance(p);
          if (v) u.voice = v; u.lang = (v && v.lang) || lang(); u.rate = +c.rate || 1; u.pitch = +c.pitch || 1;
          u.onend = done; u.onerror = done; u.onboundary = () => { S.pulse = 1; };
          S.spoken.push(p); if (S.spoken.length > 60) S.spoken.splice(0, S.spoken.length - 60);
          try { speechSynthesis.speak(u); } catch (e) { done(); }
        });
        /* Chrome/iOS stall guard: nudge paused engines; give up after a generous budget */
        const budget = Date.now() + 8000 + clean.length * 120;
        keepAlive = setInterval(() => { if (gen !== speakGen) return clearInterval(keepAlive); try { if (speechSynthesis.paused) speechSynthesis.resume(); } catch (_) {} if (Date.now() > budget) { left = 1; done(); } }, 2500);
      });
    }

    function stopRec() { const r = rec; rec = null; if (r) { r.onend = r.onresult = r.onerror = null; try { r.abort(); } catch (_) { try { r.stop(); } catch (__) {} } } }
    function listen() {
      if (!S.open) return;
      stopTTS(); S.interim = '';
      const C = SR();
      if (!C) { setState('typing'); if (ui) ui.focusType(); return; }
      stopRec();
      let r; try { r = new C(); } catch (e) { S.supported = false; setState('typing', 'Speech recognition failed to start: ' + e.message); return; }
      r.lang = lang(); r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
      let fin = '';
      r.onresult = (e) => { let it = ''; for (let i = e.resultIndex; i < e.results.length; i++) { const t = e.results[i][0].transcript; if (e.results[i].isFinal) fin += t; else it += t; } S.interim = (fin + ' ' + it).trim(); if (ui) ui.render(); };
      r.onerror = (e) => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { S.supported = false; rec = null; setState('typing', 'Microphone permission was denied — type instead, replies are still spoken.'); } else if (e.error === 'network' || e.error === 'audio-capture' || e.error === 'language-not-supported') { S.supported = false; rec = null; setState('typing', 'Speech recognition unavailable (' + e.error + ') — type instead, replies are still spoken.'); } else if (e.error !== 'no-speech' && e.error !== 'aborted') S.error = e.error; };
      r.onend = () => { if (rec !== r) return; rec = null; const t = fin.trim() || (S.interim || '').trim(); S.interim = ''; if (t) { S.empty = 0; send(t); } else if (S.state === 'listening') { S.empty = (S.empty || 0) + 1; if (S.empty >= 3) { S.empty = 0; setState('idle', 'Paused listening after a few silent tries — tap the orb to talk.'); } else setTimeout(() => { if (S.state === 'listening' && !rec) listen(); }, 350); } };
      rec = r; setState('listening');
      try { r.start(); } catch (e) { rec = null; setState('idle', 'Tap the orb to talk.'); }
    }

    async function send(text) {
      text = String(text || '').trim(); if (!text) return;
      stopRec(); S.heard = text; S.interim = ''; S.said = ''; setState('thinking');
      let th = DS.store.activeThread(); if (!th) th = DS.store.newThread('Voice chat');
      if (DS.agent.isRunning && DS.agent.isRunning(th)) { setState('idle', 'This thread is busy — wait or tap end.'); return; }
      let msg;
      try { msg = await DS.agent.run(th, text); } catch (e) { msg = { meta: { error: e.message }, parts: [] }; }
      if (!S.open) return;
      const reply = finalText(msg);
      const again = () => { if (!S.open || S.state === 'paused') return; if (cfg().autoListen && S.supported) listen(); else setState(S.supported ? 'idle' : 'typing'); };
      if (msg && msg.meta && msg.meta.aborted) return setState('idle', 'Stopped.');
      speak(reply || (msg && msg.meta && msg.meta.error ? 'Sorry, that failed: ' + msg.meta.error : 'Done.'), { after: again });
    }
    function finalText(msg) {
      const ps = (msg && msg.parts) || []; let lastTool = -1; ps.forEach((p, i) => { if (p.type === 'tool') lastTool = i; });
      const tail = ps.slice(lastTool + 1).filter(p => p.type === 'text').map(p => p.text).join('\n\n');
      return tail.trim() || ps.filter(p => p.type === 'text').map(p => p.text).join('\n\n').trim();
    }

    /* ---------- mic level (optional) ---------- */
    /* iOS Safari: an AudioContext created outside a user gesture starts 'suspended' — make it during open() (a tap) and reuse it */
    let preAC = null;
    function primeAudio() { try { if (!preAC) { const AC = window.AudioContext || window.webkitAudioContext; if (AC) preAC = new AC(); } if (preAC && preAC.state === 'suspended') preAC.resume().catch(() => {}); } catch (_) {} }
    function audioCtx() { if (preAC && preAC.state !== 'closed') { const a = preAC; preAC = null; return a; } try { const AC = window.AudioContext || window.webkitAudioContext; return AC ? new AC() : null; } catch (_) { return null; } }
    async function startMeter() {
      if (audio || !cfg().micOrb || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        if (!S.open) { stream.getTracks().forEach(t => t.stop()); return; }
        const ac = audioCtx(); if (!ac) { stream.getTracks().forEach(t => t.stop()); return; } try { if (ac.state === 'suspended') await ac.resume(); } catch (_) {} const src = ac.createMediaStreamSource(stream); const an = ac.createAnalyser(); an.fftSize = 512; src.connect(an);
        audio = { stream, ac, an, buf: new Uint8Array(an.fftSize), hot: 0 };
      } catch (_) { audio = null; }
    }
    function stopMeter() { if (!audio) return; try { audio.stream.getTracks().forEach(t => t.stop()); audio.ac.close(); } catch (_) {} audio = null; S.level = 0; }
    function readLevel() {
      if (!audio) return 0; audio.an.getByteTimeDomainData(audio.buf); let s = 0; for (let i = 0; i < audio.buf.length; i++) { const d = (audio.buf[i] - 128) / 128; s += d * d; }
      const lv = Math.min(1, Math.sqrt(s / audio.buf.length) * 4);
      if (S.state === 'speaking' && cfg().bargeIn) { audio.base = audio.base == null ? lv : audio.base * 0.97 + lv * 0.03; audio.hot = lv > Math.max(0.35, audio.base * 2.2) ? audio.hot + 1 : 0; if (audio.hot > 9) { audio.hot = 0; listen(); } } else if (audio) audio.base = null;
      return lv;
    }

    /* ---------- orb ---------- */
    function orb(canvas) {
      const g = canvas.getContext('2d'); let raf = 0, t = 0, last = 0, col = { a: '#7aa2ff', b: '#b48cff' };
      const css = () => { const cs = getComputedStyle(document.documentElement); col = { a: cs.getPropertyValue('--accent').trim() || '#7aa2ff', b: cs.getPropertyValue('--violet').trim() || cs.getPropertyValue('--accent').trim() || '#b48cff' }; };
      css();
      const draw = (now) => {
        raf = requestAnimationFrame(draw); if (document.hidden) return;
        const red = reduced(); if (red && now - last < 250) return; last = now;
        const dpr = Math.min(2, window.devicePixelRatio || 1), w = canvas.clientWidth || 260, h = canvas.clientHeight || 260;
        if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
        g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
        t += red ? 0 : 0.016; const lv = readLevel(); S.level += (lv - S.level) * 0.3; S.pulse = (S.pulse || 0) * 0.9;
        const st = S.state, cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.3;
        const amp = st === 'listening' ? 0.04 + S.level * 0.35 : st === 'speaking' ? 0.07 + 0.05 * Math.sin(t * 9) + S.pulse * 0.08 : st === 'thinking' ? 0.05 : 0.025;
        const breathe = red ? 1 : 1 + Math.sin(t * 1.6) * 0.03 + (st === 'listening' ? S.level * 0.25 : 0);
        for (let k = 3; k >= 0; k--) {
          g.beginPath(); const rr = R * breathe * (1 + k * 0.12);
          for (let i = 0; i <= 96; i++) { const a = (i / 96) * Math.PI * 2; const wob = red ? 0 : Math.sin(a * 3 + t * 2 + k) * amp + Math.sin(a * 5 - t * 1.3 + k * 2) * amp * 0.6; const r2 = rr * (1 + wob); const x = cx + Math.cos(a) * r2, y = cy + Math.sin(a) * r2; i ? g.lineTo(x, y) : g.moveTo(x, y); }
          g.closePath();
          if (k === 0) { const gr = g.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.1, cx, cy, R * 1.2); gr.addColorStop(0, col.a); gr.addColorStop(1, col.b); g.globalAlpha = st === 'paused' ? 0.45 : 0.95; g.fillStyle = gr; g.fill(); }
          else { g.globalAlpha = (st === 'paused' ? 0.06 : 0.14) / k; g.fillStyle = k % 2 ? col.b : col.a; g.fill(); }
        }
        if (st === 'thinking') { g.globalAlpha = 0.8; g.strokeStyle = col.a; g.lineWidth = 3; g.lineCap = 'round'; g.beginPath(); const s0 = red ? 0 : t * 4; g.arc(cx, cy, R * 1.45, s0, s0 + Math.PI * 0.6); g.stroke(); }
        g.globalAlpha = 0.35; g.fillStyle = '#fff'; g.beginPath(); g.ellipse(cx - R * 0.32, cy - R * 0.38, R * 0.22, R * 0.12, -0.6, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1;
      };
      raf = requestAnimationFrame(draw);
      return () => cancelAnimationFrame(raf);
    }

    /* ---------- sheet UI ---------- */
    const LABEL = { listening: 'Listening…', thinking: 'Thinking…', speaking: 'Speaking — tap the orb to interrupt', paused: 'Paused', idle: 'Tap the orb to talk', typing: 'Type your message — replies are spoken', closed: '' };
    function open() {
      if (S.open) return api; S.open = true; if (cfg().micOrb) primeAudio(); S.heard = S.said = S.interim = ''; S.supported = !!SR(); S.muted = !!ctx.data.get('muted', false);
      const w = U.el('div', { class: 'vx-wrap', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Voice mode' });
      w.innerHTML = `<div class="vx-top"><span class="vx-ttl">${DS.icon('mic')} Voice</span><span class="vx-st" aria-live="polite"></span><button class="icon-btn vx-x" aria-label="End voice mode">${DS.icon('x')}</button></div>
        <button class="vx-orbb" aria-label="Talk / interrupt"><canvas class="vx-orb" aria-hidden="true"></canvas></button>
        <div class="vx-note" role="status"></div>
        <div class="vx-cap"><div class="vx-you"><b>You</b><span></span></div><div class="vx-ai"><b>Forge</b><span></span></div></div>
        <form class="vx-type" hidden><input class="inp" placeholder="Type to talk…" enterkeyhint="send" aria-label="Message"><button class="btn pri" type="submit">Send</button></form>
        <div class="vx-ctl"><button class="btn vx-pause">Pause</button><button class="btn vx-mute">Mute</button><button class="btn vx-kb">Type instead</button><button class="btn danger vx-end">End</button></div>`;
      document.body.appendChild(w);
      const q = (s) => w.querySelector(s), form = q('.vx-type'), inp = form.querySelector('input');
      const stopOrb = orb(q('.vx-orb'));
      let note = '';
      ui = {
        el: w,
        render(n) {
          if (n !== undefined) note = n; const st = S.state;
          q('.vx-st').textContent = LABEL[st] || st; w.dataset.state = st;
          q('.vx-note').textContent = note || (!S.supported ? 'Speech recognition isn’t available in this browser. Push-to-talk fallback: type below and Forge answers out loud.' : '');
          q('.vx-you span').textContent = S.interim || S.heard || '—'; q('.vx-ai span').textContent = S.said || (st === 'thinking' ? '…' : '—');
          q('.vx-pause').textContent = st === 'paused' ? 'Resume' : 'Pause'; q('.vx-mute').textContent = S.muted ? 'Unmute' : 'Mute'; q('.vx-mute').classList.toggle('on', S.muted);
          form.hidden = !(st === 'typing' || !S.supported || form.dataset.force === '1');
        },
        focusType() { form.dataset.force = '1'; this.render(); setTimeout(() => { try { inp.focus(); } catch (_) {} }, 30); },
        dispose() { stopOrb(); w.remove(); document.removeEventListener('keydown', onKey); }
      };
      const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
      document.addEventListener('keydown', onKey);
      q('.vx-orbb').onclick = () => { if (S.state === 'speaking') listen(); else if (S.state === 'listening') { if (rec) try { rec.stop(); } catch (_) {} } else if (S.state !== 'thinking') listen(); };
      q('.vx-x').onclick = q('.vx-end').onclick = () => close();
      q('.vx-pause').onclick = () => { if (S.state === 'paused') listen(); else { stopRec(); stopTTS(); setState('paused'); } };
      q('.vx-mute').onclick = () => { S.muted = !S.muted; ctx.data.set('muted', S.muted); if (S.muted) { stopTTS(); if (S.state === 'speaking') listen(); } ui.render(); };
      q('.vx-kb').onclick = () => { stopRec(); stopTTS(); setState('typing'); ui.focusType(); };
      form.onsubmit = (e) => { e.preventDefault(); const v = inp.value.trim(); if (!v) return; inp.value = ''; send(v); };
      setPill(true); startMeter();
      if (S.supported) listen(); else setState('typing');
      return api;
    }
    function close() {
      if (!S.open) return api; S.open = false; stopRec(); stopTTS(); stopMeter();
      if (ui) { ui.dispose(); ui = null; } S.state = 'closed'; setPill(false); DS.bus.emit('voice:state', 'closed'); return api;
    }
    function setPill(on) { const tg = DS.store.state.toggles; if (tg && tg['voice-mode'] !== on) { tg['voice-mode'] = on; try { DS.threadView.renderPills(); } catch (_) {} } }
    ctx.effect(() => () => close());

    const api = { open, close, speak: (t) => speak(t), state: () => ({ state: S.state, open: S.open, muted: S.muted, supported: S.supported, heard: S.heard, said: S.said, spoken: S.spoken.slice(), level: +S.level.toFixed(3), tts: hasTTS() }), send, listen, stripMd, chunk };
    ctx.provide('forge.voice', api);
    window.forge = window.forge || {}; window.forge.voice = api;
    ctx.effect(() => () => { if (window.forge && window.forge.voice === api) delete window.forge.voice; });

    /* ---------- entry points ---------- */
    ctx.composerAction({ id: 'voice-mode', icon: 'orb', label: 'Voice mode', desc: 'Hands-free conversation', run: () => open() });
    ctx.pill({ id: 'voice-mode', label: 'Voice', icon: 'orb', title: 'Hands-free voice mode', run: () => (S.open ? close() : open()) });
    ctx.command({ name: 'voice-mode', desc: 'Hands-free voice conversation', run: () => open() });
    ctx.shortcut({ keys: 'mod+shift+v', desc: 'Voice mode', run: () => (S.open ? close() : open()) });
    ctx.suggest({ id: 'voice-demo', emoji: '🎙️', title: 'Talk to Forge', sub: 'Hands-free voice mode', run: () => open() });
    ctx.intent({ id: 'voice.demo', order: 50, match: (t) => /\b(voice mode|talk to (me|you)|hands[- ]free|say something|speak to me)\b/i.test(t),
      script: () => [{ final: '## Voice mode is on\nI can **hear you** and *answer out loud*. Each reply is split into sentences so long answers are not cut off on iPhone.\n\n- Tap the orb to interrupt me.\n- Use **Type instead** if you prefer the keyboard.\n\n```js\nconsole.log("code is skipped when spoken")\n```\nWhat would you like to build today?' }] });

    /* ---------- settings ---------- */
    ctx.settings({ id: 'voice', title: 'Voice', render(el) {
      const c = cfg();
      el.innerHTML = `<div class="field"><label>Voice</label><select class="sel vx-v"></select><div class="hint vx-vh"></div></div>
        <div class="field"><label>Rate <span class="mono vx-rv"></span></label><input type="range" class="vx-r" min="0.5" max="2" step="0.05"></div>
        <div class="field"><label>Pitch <span class="mono vx-pv"></span></label><input type="range" class="vx-p" min="0" max="2" step="0.05"></div>
        <div class="field"><label>Language</label><input class="inp vx-l" placeholder="${esc(navigator.language || 'en-US')} (auto)" list="vx-langs"><datalist id="vx-langs">${['en-US', 'en-GB', 'es-ES', 'fr-FR', 'de-DE', 'it-IT', 'pt-BR', 'ja-JP', 'zh-CN', 'ko-KR', 'hi-IN', 'ar-SA'].map(l => `<option value="${l}">`).join('')}</datalist></div>
        <label class="row vx-cb"><input type="checkbox" class="vx-a"> Auto-listen after each reply</label>
        <label class="row vx-cb"><input type="checkbox" class="vx-m"> Mic-reactive orb (asks for microphone)</label>
        <label class="row vx-cb"><input type="checkbox" class="vx-b"> Barge-in: speaking interrupts the reply</label>
        <div class="row wrap" style="gap:8px;margin-top:8px"><button class="btn sm vx-test">Test voice</button><button class="btn sm pri vx-open">Open voice mode</button></div>
        <div class="hint xs">Recognition: ${SR() ? 'available' : 'not available in this browser (typing fallback)'} · Synthesis: ${hasTTS() ? 'available' : 'not available'}</div>`;
      const q = (s) => el.querySelector(s), sel = q('.vx-v');
      const fill = () => { loadVoices(); const cur = cfg().voice; sel.innerHTML = '<option value="">Auto (matches language)</option>' + voices.map(v => `<option value="${esc(v.voiceURI)}"${v.voiceURI === cur ? ' selected' : ''}>${esc(v.name)} · ${esc(v.lang)}${v.localService === false ? ' · online' : ''}</option>`).join(''); q('.vx-vh').textContent = voices.length ? voices.length + ' voices' : (hasTTS() ? 'Loading voices… (some browsers list them late)' : 'Speech synthesis unavailable'); };
      fill(); const off = DS.bus.on('voice:voices', () => { if (el.isConnected) fill(); else off(); });
      sel.onchange = () => setCfg({ voice: sel.value });
      const r = q('.vx-r'), p = q('.vx-p'); r.value = c.rate; p.value = c.pitch; const lab = () => { q('.vx-rv').textContent = (+r.value).toFixed(2) + '×'; q('.vx-pv').textContent = (+p.value).toFixed(2); }; lab();
      r.oninput = () => { lab(); setCfg({ rate: +r.value }); }; p.oninput = () => { lab(); setCfg({ pitch: +p.value }); };
      const l = q('.vx-l'); l.value = c.lang; l.onchange = () => setCfg({ lang: l.value.trim() });
      [['.vx-a', 'autoListen'], ['.vx-m', 'micOrb'], ['.vx-b', 'bargeIn']].forEach(([s, k]) => { const b = q(s); b.checked = !!c[k]; b.onchange = () => setCfg({ [k]: b.checked }); });
      q('.vx-test').onclick = () => { const m = S.muted; S.muted = false; speak('Hello! This is how I sound. Adjust the rate and pitch to taste.'); S.muted = m; if (!S.open) S.state = 'closed'; };
      q('.vx-open').onclick = () => open();
    } });

    ctx.effect(() => {
      const s = document.createElement('style');
      s.textContent = `.vx-wrap{position:fixed;top:0;left:0;right:0;bottom:0;z-index:9000;display:flex;flex-direction:column;align-items:center;gap:12px;padding:max(12px,env(safe-area-inset-top)) 16px max(16px,env(safe-area-inset-bottom));background:radial-gradient(120% 80% at 50% 30%,var(--accent-soft),transparent 60%),var(--bg);color:var(--text);overflow-y:auto;overscroll-behavior:contain;animation:vx-in .2s ease}
@keyframes vx-in{from{opacity:0;transform:scale(.98)}}
.vx-top{display:flex;align-items:center;gap:10px;width:100%;max-width:560px;min-height:44px}.vx-ttl{display:flex;align-items:center;gap:6px;font-weight:600}.vx-ttl svg{width:18px;height:18px}.vx-st{flex:1;text-align:right;color:var(--muted);font-size:13px}
.vx-orbb{all:unset;cursor:pointer;display:block;width:min(72vw,300px,42vh);aspect-ratio:1;border-radius:50%;margin-top:2vh;-webkit-tap-highlight-color:transparent}.vx-orbb:focus-visible{outline:2px solid var(--accent);outline-offset:6px}.vx-orb{width:100%;height:100%;display:block}
.vx-note{max-width:520px;text-align:center;font-size:13px;color:var(--warn);min-height:1em}
.vx-cap{width:100%;max-width:560px;display:flex;flex-direction:column;gap:8px}.vx-cap>div{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:10px 12px;font-size:15px;line-height:1.45;max-height:22vh;overflow-y:auto}.vx-cap b{display:block;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-bottom:2px}.vx-ai{border-color:var(--accent-line)!important}
.vx-type{display:flex;gap:8px;width:100%;max-width:560px}.vx-type[hidden]{display:none}.vx-type .inp{flex:1;min-height:44px;font-size:16px}
.vx-ctl{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;width:100%;max-width:560px;margin-top:auto}.vx-ctl .btn{min-height:44px;justify-content:center}.vx-ctl .btn.on{background:var(--accent-soft);border-color:var(--accent-line)}
.vx-cb{gap:8px;min-height:40px;align-items:center}
@media (prefers-reduced-motion:reduce){.vx-wrap{animation:none}}`;
      document.head.appendChild(s); return () => s.remove();
    });
  }
});

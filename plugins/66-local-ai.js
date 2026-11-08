/* forge.localai — keyless, on-device inference providers (route 'local').
   HONESTY: written in a sandbox with no internet. CDN paths, library versions and model ids below were NOT verified live —
   they are tagged `unverified`; loaders try a small list of candidates and report exactly which ones failed.
   WebLLM (WebGPU) already lives in forge.labs as `webllm_local` and is not duplicated here. */
const LA_WLLAMA_URLS = [
  'https://cdn.jsdelivr.net/npm/@wllama/wllama@3.8.1/esm/index.js',
  'https://cdn.jsdelivr.net/npm/@wllama/wllama@3.6.1/esm/index.js',
  'https://cdn.jsdelivr.net/npm/@wllama/wllama@3.6.1/+esm',
  'https://cdn.jsdelivr.net/npm/@wllama/wllama@2.3.1/esm/index.js',
  'https://cdn.jsdelivr.net/npm/@wllama/wllama@2.3.1/+esm',
  'https://cdn.jsdelivr.net/npm/@wllama/wllama@2.2.1/esm/index.js',
  'https://unpkg.com/@wllama/wllama@2.3.1/esm/index.js'
];
const LA_TJS_URLS = [
  'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/+esm',
  'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js',
  'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.5/+esm'
];
const LA_GGUF = [
  { id: 'qwen2.5-0.5b-instruct-q4_k_m', label: 'Qwen2.5 0.5B Instruct Q4_K_M (~400 MB)', repo: 'Qwen/Qwen2.5-0.5B-Instruct-GGUF', file: 'qwen2.5-0.5b-instruct-q4_k_m.gguf', url: 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf' },
  { id: 'smollm2-360m-instruct-q8_0', label: 'SmolLM2 360M Instruct Q8_0 (~390 MB)', repo: 'HuggingFaceTB/SmolLM2-360M-Instruct-GGUF', file: 'smollm2-360m-instruct-q8_0.gguf', url: 'https://huggingface.co/HuggingFaceTB/SmolLM2-360M-Instruct-GGUF/resolve/main/smollm2-360m-instruct-q8_0.gguf' },
  { id: 'qwen2.5-1.5b-instruct-q4_k_m', label: 'Qwen2.5 1.5B Instruct Q4_K_M (~1 GB)', repo: 'Qwen/Qwen2.5-1.5B-Instruct-GGUF', file: 'qwen2.5-1.5b-instruct-q4_k_m.gguf', url: 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf' }
];
const LA_TJS_MODELS = [
  { id: 'onnx-community/Qwen2.5-0.5B-Instruct', label: 'Qwen2.5 0.5B Instruct (ONNX)' },
  { id: 'HuggingFaceTB/SmolLM2-360M-Instruct', label: 'SmolLM2 360M Instruct (ONNX)' },
  { id: 'onnx-community/Llama-3.2-1B-Instruct', label: 'Llama 3.2 1B Instruct (ONNX)' }
];

DS.plugin({
  name: 'forge.localai', title: 'Local AI (on-device)', version: '1.0.0', tags: ['providers', 'local', 'offline', 'wasm', 'webgpu'],
  description: 'Keyless on-device models: Chrome built-in AI (Gemini Nano), wllama GGUF on CPU/WASM (works without WebGPU), Transformers.js — with a capability check and cache manager.',
  apply(ctx) {
    const U = DS.util, esc = U.esc;
    const st = { chrome: 'idle', wllama: 'idle', tjs: 'idle', progress: {}, errors: {}, failed: { wllama: [], tjs: [] }, loadedUrl: { wllama: '', tjs: '' } };
    let wl = null, wlModel = '', tjsGen = null, tjsModel = '', libs = {};
    const ws = () => Object.assign({ gguf: LA_GGUF[0].id, tjs: LA_TJS_MODELS[0].id, maxTokens: 512 }, ctx.data.get('settings', {}));
    const setWs = patch => { ctx.data.set('settings', Object.assign(ws(), patch)); refresh(); };
    const hasLM = () => typeof self !== 'undefined' && !!self.LanguageModel && typeof self.LanguageModel.create === 'function';
    const refreshers = new Set(); const refresh = () => refreshers.forEach(f => { try { f(); } catch (_) {} });
    const abortErr = () => Object.assign(new Error('aborted'), { name: 'AbortError' });

    /* ---------- message helpers (text-only; no tool protocol) ---------- */
    const txt = c => typeof c === 'string' ? c : Array.isArray(c) ? c.map(p => p && (p.text || '')).join('\n') : (c == null ? '' : String(c));
    function simpleMsgs(messages) {
      const out = [];
      for (const m of messages || []) {
        if (!m) continue; let role = m.role === 'tool' ? 'user' : m.role; let content = txt(m.content);
        if (m.role === 'tool') content = '[tool result] ' + content.slice(0, 2000);
        if (!content.trim()) continue; if (!/^(system|user|assistant)$/.test(role)) role = 'user';
        if (role === 'system' && out.length) role = 'user';
        const last = out[out.length - 1]; if (last && last.role === role && role !== 'system') last.content += '\n\n' + content; else out.push({ role, content });
      }
      if (out[0] && out[0].role === 'system') out[0].content = out[0].content.slice(0, 6000) + '\n\n(You run on-device with no tools: answer in plain text.)';
      return out;
    }
    /* chunks may be cumulative (older Chrome) or deltas (newer): diff against what we have */
    function differ(onDelta) {
      let acc = '';
      return { push(chunk) { chunk = typeof chunk === 'string' ? chunk : txt(chunk); if (!chunk) return; let d; if (acc && chunk.length >= acc.length && chunk.startsWith(acc)) { d = chunk.slice(acc.length); acc = chunk; } else { d = chunk; acc += chunk; } if (d) onDelta && onDelta({ content: d }); }, get text() { return acc; } };
    }

    /* ---------- lazy ESM loader with candidate list ---------- */
    async function loadLib(key, urls, check) {
      if (libs[key]) return libs[key];
      const failed = [];
      for (const u of urls) {
        try { const m = await import(u); if (check(m)) { libs[key] = m; st.loadedUrl[key] = u; st.failed[key] = failed; return m; } failed.push(u + ' (unexpected exports)'); }
        catch (e) { failed.push(u + ' — ' + String(e && e.message || e).slice(0, 80)); }
      }
      st.failed[key] = failed; refresh();
      throw new Error(key + ': could not load the library from any CDN candidate (offline, blocked, or wrong version). Tried: ' + failed.join(' | '));
    }

    /* ---------- capability check ---------- */
    const SIMD = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);
    const withT = (p, ms, d) => Promise.race([p, new Promise(r => setTimeout(() => r(d), ms))]);
    async function check() {
      const r = { ts: Date.now(), protocol: location.protocol, secure: !!self.isSecureContext, crossOriginIsolated: !!self.crossOriginIsolated, cores: navigator.hardwareConcurrency || null, memoryGB: navigator.deviceMemory || null };
      r.wasm = typeof WebAssembly === 'object'; r.wasmSimd = false; try { r.wasmSimd = r.wasm && WebAssembly.validate(SIMD); } catch (_) {}
      r.sharedArrayBuffer = typeof SharedArrayBuffer === 'function' && r.crossOriginIsolated;
      r.webgpu = !!navigator.gpu; r.webgpuAdapter = false;
      if (navigator.gpu) { try { r.webgpuAdapter = !!(await withT(navigator.gpu.requestAdapter(), 1500, null)); } catch (_) {} }
      r.languageModel = hasLM() ? 'present' : 'absent'; r.languageModelAvailability = null;
      if (hasLM() && typeof self.LanguageModel.availability === 'function') { try { r.languageModelAvailability = String(await withT(self.LanguageModel.availability(), 1500, 'timeout')); } catch (e) { r.languageModelAvailability = 'error: ' + e.message; } }
      r.storage = null; try { if (navigator.storage && navigator.storage.estimate) { const e = await withT(navigator.storage.estimate(), 1500, null); if (e) r.storage = { usage: e.usage || 0, quota: e.quota || 0 }; } } catch (_) {}
      r.cacheApi = typeof caches !== 'undefined';
      r.recommend = r.languageModelAvailability === 'available' ? 'chrome_ai' : (r.webgpuAdapter ? 'tjs_local (WebGPU) or webllm_local' : (r.wasm ? 'wllama (CPU/WASM' + (r.sharedArrayBuffer ? ', multi-thread' : ', single-thread') + ')' : 'none — use a cloud provider'));
      r.loaded = { chrome_ai: st.chrome, wllama: wlModel ? 'loaded: ' + wlModel : st.wllama, tjs_local: tjsModel ? 'loaded: ' + tjsModel : st.tjs };
      return r;
    }
    const yes = b => b ? '✅' : '❌';
    const table = r => '| capability | status |\n|---|---|\n' + [
      ['WebGPU', yes(r.webgpu) + (r.webgpu ? (r.webgpuAdapter ? ' adapter ok' : ' no adapter') : '')], ['WASM', yes(r.wasm)], ['WASM SIMD', yes(r.wasmSimd)],
      ['SharedArrayBuffer (threads)', yes(r.sharedArrayBuffer) + (r.crossOriginIsolated ? '' : ' not cross-origin isolated → single-thread')],
      ['Prompt API (LanguageModel)', r.languageModel + (r.languageModelAvailability ? ' · ' + r.languageModelAvailability : '') + ' (desktop Chrome 148+ only; not iOS/Android)'],
      ['Storage', r.storage ? DS.fmtBytes(r.storage.usage) + ' used of ' + DS.fmtBytes(r.storage.quota) : 'unknown'], ['Page', r.protocol + (r.secure ? ' (secure)' : ' (not secure)')], ['CPU cores', String(r.cores || '?')]
    ].map(x => '| ' + x[0] + ' | ' + x[1] + ' |').join('\n') + '\n\n**Best on this device:** `' + r.recommend + '`';

    /* ---------- provider 1: Chrome built-in AI ---------- */
    ctx.provider({
      id: 'chrome_ai', label: 'Chrome built-in AI (Gemini Nano, on-device)', route: 'local', order: 85, models: ['gemini-nano'], keyless: true,
      available: () => hasLM(),
      async stream({ messages, signal, onDelta }) {
        if (!hasLM()) throw new Error('Chrome built-in AI: the Prompt API (self.LanguageModel) is not exposed here. It needs desktop Chrome 148+ with the on-device model enabled; other browsers and iOS do not have it.');
        const LM = self.LanguageModel; let av = 'available';
        if (typeof LM.availability === 'function') { try { av = String(await LM.availability()); } catch (e) { av = 'unavailable'; } }
        if (av === 'unavailable') throw new Error('Chrome built-in AI reports "unavailable" on this device (hardware/flags/storage requirements not met).');
        const msgs = simpleMsgs(messages); let last = msgs.length && msgs[msgs.length - 1].role === 'user' ? msgs.pop() : { content: 'Continue.' };
        st.chrome = av === 'available' ? 'ready' : av; refresh();
        if (av !== 'available') ctx.toast('Gemini Nano is ' + av + ' — Chrome downloads it on first use.', 'info', 5000);
        const session = await LM.create({ initialPrompts: msgs, signal, monitor(m) { try { m.addEventListener('downloadprogress', e => { st.progress.chrome = Math.round((e.loaded || 0) * (e.total && e.total > 1 ? 100 / e.total : 100)); st.chrome = 'downloading ' + st.progress.chrome + '%'; refresh(); }); } catch (_) {} } });
        const d = differ(onDelta);
        try {
          if (typeof session.promptStreaming === 'function') {
            const it = session.promptStreaming(last.content, { signal });
            if (it && typeof it[Symbol.asyncIterator] === 'function') { for await (const ch of it) { if (signal && signal.aborted) throw abortErr(); d.push(ch); } }
            else if (it && typeof it.getReader === 'function') { const rd = it.getReader(); for (;;) { const x = await rd.read(); if (x.done) break; if (signal && signal.aborted) throw abortErr(); d.push(x.value); } }
          } else d.push(await session.prompt(last.content, { signal }));
        } finally { try { session.destroy && session.destroy(); } catch (_) {} }
        st.chrome = 'ready'; refresh();
        return { content: d.text, reasoning: '', toolCalls: [], usage: null };
      }
    });

    /* ---------- provider 2: wllama (GGUF on CPU/WASM) ---------- */
    let wlP = null, tjsP = null; /* in-flight loads: a second caller waits instead of starting a parallel multi-hundred-MB load */
    function loadWllama() { if (wlP) return wlP; wlP = _loadWllama().finally(() => { wlP = null; }); return wlP; }
    function loadTjs() { if (tjsP) return tjsP; tjsP = _loadTjs().finally(() => { tjsP = null; }); return tjsP; }
    async function _loadWllama() {
      const want = LA_GGUF.find(g => g.id === ws().gguf) || LA_GGUF[0];
      if (wl && wlModel === want.id) return wl;
      st.wllama = 'loading library'; st.errors.wllama = ''; refresh();
      try {
        const mod = await loadLib('wllama', LA_WLLAMA_URLS, m => !!(m.Wllama || (m.default && m.default.Wllama)));
        const W = mod.Wllama || mod.default.Wllama; const base = st.loadedUrl.wllama.replace(/\/esm\/index\.js$|\/\+esm$/, '');
        const paths = { 'single-thread/wllama.wasm': base + '/esm/single-thread/wllama.wasm', 'multi-thread/wllama.wasm': base + '/esm/multi-thread/wllama.wasm' };
        if (wl) { try { await wl.exit(); } catch (_) {} wl = null; wlModel = ''; }
        /* wllama 3.x wants pathConfig { default: <wasm url> } (README 3.8.1; the v2 single-/multi-thread keys are gone → "default is missing from pathConfig").
           Prefer the package's own wasm-from-cdn map when it loads, else build { default } ourselves; v2 keeps its explicit paths. */
        const v3 = /@3\./.test(st.loadedUrl.wllama || '');
        let cfg = mod.WasmFromCDN || (mod.default && mod.default.WasmFromCDN) || null;
        if (!cfg && v3) { try { const wm = await import(base + '/esm/wasm-from-cdn.js'); cfg = wm && (wm.default || wm.WasmFromCDN) || null; } catch (_) {} }
        if (!cfg || typeof cfg !== 'object' || !cfg.default && v3) cfg = Object.assign({}, cfg || {}, { default: base + '/esm/wasm/wllama.wasm' });
        const inst = new W(v3 ? cfg : (cfg || paths), { suppressNativeLog: true });
        st.wllama = 'downloading 0%'; refresh();
        const lo = { n_ctx: 2048, n_gpu_layers: 0, n_threads: self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1,
          progressCallback: ({ loaded, total }) => { st.progress.wllama = total ? Math.round(loaded * 100 / total) : 0; st.wllama = 'downloading ' + st.progress.wllama + '%'; refresh(); } };
        if (typeof inst.loadModelFromHF === 'function' && want.repo) await inst.loadModelFromHF({ repo: want.repo, file: want.file }, lo); else await inst.loadModelFromUrl(want.url, lo);
        wl = inst; wlModel = want.id; st.wllama = 'ready'; refresh(); return wl;
      } catch (e) { st.wllama = 'error'; st.errors.wllama = String(e.message || e); refresh(); throw new Error('wllama: ' + st.errors.wllama.replace(/^wllama: /, '')); }
    }
    ctx.provider({
      id: 'wllama', label: 'wllama (GGUF on CPU/WASM — works on iPhone without WebGPU)', route: 'local', order: 86, models: LA_GGUF.map(g => g.id), keyless: true,
      available: () => typeof WebAssembly === 'object',
      async stream({ messages, signal, onDelta }) {
        const w = await loadWllama(); const d = differ(onDelta);
        const opts = { nPredict: ws().maxTokens, sampling: { temp: 0.7, top_p: 0.9 }, abortSignal: signal,
          onNewToken: (tok, piece, cur, o) => { if (signal && signal.aborted && o && o.abortSignal) o.abortSignal(); if (typeof cur === 'string') d.push(cur); } };
        const r = await w.createChatCompletion(simpleMsgs(messages), opts);
        if (r && typeof r[Symbol.asyncIterator] === 'function') { for await (const ch of r) { if (signal && signal.aborted) break; d.push(ch && (ch.currentText != null ? ch.currentText : ch.piece || '')); } }
        else if (typeof r === 'string' && !d.text) d.push(r);
        if (signal && signal.aborted) throw abortErr();
        return { content: d.text, reasoning: '', toolCalls: [], usage: null };
      }
    });

    /* ---------- provider 3: Transformers.js text-generation ---------- */
    async function _loadTjs() {
      const id = ws().tjs; if (tjsGen && tjsModel === id) return tjsGen;
      st.tjs = 'loading library'; st.errors.tjs = ''; refresh();
      try {
        const T = await loadLib('tjs', LA_TJS_URLS, m => typeof m.pipeline === 'function');
        if (tjsGen) { try { await tjsGen.dispose(); } catch (_) {} tjsGen = null; tjsModel = ''; }
        const files = {};
        const pc = p => { if (p && p.file && p.total) { files[p.file] = [p.loaded || 0, p.total]; const a = Object.values(files).reduce((s, x) => [s[0] + x[0], s[1] + x[1]], [0, 0]); st.progress.tjs = Math.round(a[0] * 100 / a[1]); st.tjs = 'downloading ' + st.progress.tjs + '%'; refresh(); } };
        try { if (!navigator.gpu) throw new Error('no WebGPU'); tjsGen = await T.pipeline('text-generation', id, { device: 'webgpu', dtype: 'q4', progress_callback: pc }); }
        catch (e1) { ctx.log('info', 'Transformers.js webgpu unavailable (' + (e1 && e1.message) + ') — using wasm'); tjsGen = await T.pipeline('text-generation', id, { device: 'wasm', dtype: 'q4', progress_callback: pc }); }
        tjsModel = id; st.tjs = 'ready'; refresh(); return tjsGen;
      } catch (e) { st.tjs = 'error'; st.errors.tjs = String(e.message || e); refresh(); throw new Error('Transformers.js: ' + st.errors.tjs); }
    }
    ctx.provider({
      id: 'tjs_local', label: 'Transformers.js text-generation (small models)', route: 'local', order: 87, models: LA_TJS_MODELS.map(m => m.id), keyless: true,
      available: () => typeof WebAssembly === 'object',
      async stream({ messages, signal, onDelta }) {
        const gen = await loadTjs(); const T = libs.tjs; let acc = '';
        const streamer = T.TextStreamer ? new T.TextStreamer(gen.tokenizer, { skip_prompt: true, skip_special_tokens: true, callback_function: t => { if (signal && signal.aborted) return; if (t) { acc += t; onDelta && onDelta({ content: t }); } } }) : undefined;
        /* Stop must actually stop the WASM/WebGPU generation, not just hide it */
        const sc = T.InterruptableStoppingCriteria ? new T.InterruptableStoppingCriteria() : null; const onAbort = () => { try { sc && sc.interrupt(); } catch (_) {} };
        if (signal) { if (signal.aborted) throw abortErr(); signal.addEventListener('abort', onAbort, { once: true }); }
        let out; try { out = await gen(simpleMsgs(messages), Object.assign({ max_new_tokens: ws().maxTokens, do_sample: false, streamer }, sc ? { stopping_criteria: sc } : {})); }
        finally { if (signal) signal.removeEventListener('abort', onAbort); }
        if (signal && signal.aborted) throw abortErr();
        if (!acc) { const g = out && out[0] && out[0].generated_text; acc = Array.isArray(g) ? txt((g[g.length - 1] || {}).content) : txt(g); if (acc) onDelta && onDelta({ content: acc }); }
        return { content: acc, reasoning: '', toolCalls: [], usage: null };
      }
    });

    /* ---------- unload / cache ---------- */
    async function unload(which) {
      if (!which || which === 'wllama') { if (wl) { try { await wl.exit(); } catch (_) {} } wl = null; wlModel = ''; st.wllama = 'idle'; }
      if (!which || which === 'tjs') { if (tjsGen) { try { await tjsGen.dispose(); } catch (_) {} } tjsGen = null; tjsModel = ''; st.tjs = 'idle'; }
      refresh();
    }
    async function cacheInfo() {
      const out = { caches: [], opfs: [] };
      try { if (typeof caches !== 'undefined') out.caches = (await caches.keys()).filter(k => /transformers|wllama|webllm|onnx|gguf/i.test(k)); } catch (_) {}
      try { if (navigator.storage && navigator.storage.getDirectory) { const root = await navigator.storage.getDirectory(); for await (const name of root.keys()) out.opfs.push(name); } } catch (_) {}
      return out;
    }
    async function clearCache() {
      await unload(); const info = await cacheInfo(); let n = 0;
      for (const k of info.caches) { try { if (await caches.delete(k)) n++; } catch (_) {} }
      try { const root = await navigator.storage.getDirectory(); for (const name of info.opfs) { if (/cache|wllama|gguf/i.test(name)) { try { await root.removeEntry(name, { recursive: true }); n++; } catch (_) {} } } } catch (_) {}
      return n;
    }

    /* ---------- UI: panel used by view + settings + sheet ---------- */
    ctx.effect(() => { const s = document.createElement('style'); s.textContent =
      '.la-v .vscroll{padding:12px 16px 40px}.la-card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:12px;margin-bottom:12px}' +
      '.la-card h4{margin:0 0 8px;font-size:14px}.la-t{width:100%;border-collapse:collapse;font-size:13px}.la-t td{padding:7px 4px;border-top:1px solid var(--line);vertical-align:top}.la-t td:first-child{color:var(--text-2);width:46%}' +
      '.la-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;align-items:center}.la-row .btn{min-height:40px}.la-bar{height:6px;background:var(--bg-2);border-radius:3px;overflow:hidden;margin-top:6px}.la-bar i{display:block;height:100%;background:var(--accent);width:0}' +
      '.la-err{color:var(--danger);font-size:12px;word-break:break-word;margin-top:6px}.la-v .sel{max-width:100%;min-height:40px}'; document.head.appendChild(s); return () => s.remove(); });
    DS.icons.chip = DS.icons.chip || '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/></svg>';
    const cap = (r, k) => '<tr><td>' + k[0] + '</td><td>' + k[1] + '</td></tr>';
    function capRows(r) {
      return [['WebGPU', yes(r.webgpu) + (r.webgpu ? (r.webgpuAdapter ? ' adapter' : ' no adapter') : '')], ['WASM / SIMD', yes(r.wasm) + ' / ' + yes(r.wasmSimd)],
        ['SharedArrayBuffer', yes(r.sharedArrayBuffer) + (r.sharedArrayBuffer ? '' : ' <span class="xs muted">single-thread</span>')], ['Prompt API', esc(r.languageModel + (r.languageModelAvailability ? ' · ' + r.languageModelAvailability : '')) + ' <span class="xs muted">desktop Chrome 148+</span>'],
        ['Storage', r.storage ? DS.fmtBytes(r.storage.usage) + ' / ' + DS.fmtBytes(r.storage.quota) : 'unknown'], ['Page', esc(r.protocol) + (r.secure ? ' secure' : '')], ['Best here', '<b>' + esc(r.recommend) + '</b>']].map(k => cap(r, k)).join('');
    }
    const provRow = (pid, key, title, sub) => '<div class="la-card" data-p="' + pid + '"><h4>' + title + '</h4><div class="xs muted">' + sub + '</div>' +
      '<div class="la-row"><span class="chip xs" data-s="' + key + '"></span></div><div class="la-bar"><i data-b="' + key + '"></i></div><div class="la-err" data-e="' + key + '"></div><div class="la-row" data-ctl="' + key + '"></div></div>';
    function mountPanel(el) {
      el.innerHTML = '<div class="la-card"><h4>This device</h4><table class="la-t" data-cap><tr><td>checking…</td><td></td></tr></table><div class="la-row"><button class="btn sm" data-a="recheck">Re-check</button></div></div>' +
        provRow('chrome_ai', 'chrome', 'Chrome built-in AI · Gemini Nano', 'Prompt API, desktop Chrome only. Text-only (no tools). Model downloaded and managed by Chrome.') +
        provRow('wllama', 'wllama', 'wllama · GGUF on CPU/WASM', 'Runs without WebGPU (iPhone, file://). Single-thread unless the page is cross-origin isolated. Text-only. Model URLs <b>unverified</b>.') +
        provRow('tjs_local', 'tjs', 'Transformers.js · small instruct models', 'WebGPU when present, else WASM. Text-only. Model ids <b>unverified</b>.') +
        '<div class="la-card"><h4>Cache</h4><div class="sm" data-cache>…</div><div class="la-row"><button class="btn sm" data-a="unload">Unload all</button><button class="btn sm danger" data-a="clear">Clear model cache</button></div></div>';
      const ctl = el.querySelector('[data-ctl=wllama]'), ctl2 = el.querySelector('[data-ctl=tjs]'), ctl0 = el.querySelector('[data-ctl=chrome]');
      ctl0.innerHTML = '<button class="btn sm pri" data-use="chrome_ai">Use for chat</button>';
      ctl.innerHTML = '<select class="sel" data-m="gguf">' + LA_GGUF.map(g => '<option value="' + g.id + '">' + esc(g.label) + '</option>').join('') + '</select><button class="btn sm" data-a="load-wllama">Load</button><button class="btn sm" data-a="unload-wllama">Unload</button><button class="btn sm pri" data-use="wllama">Use for chat</button>';
      ctl2.innerHTML = '<select class="sel" data-m="tjs">' + LA_TJS_MODELS.map(g => '<option value="' + g.id + '">' + esc(g.label) + '</option>').join('') + '</select><button class="btn sm" data-a="load-tjs">Load</button><button class="btn sm" data-a="unload-tjs">Unload</button><button class="btn sm pri" data-use="tjs_local">Use for chat</button>';
      el.querySelector('[data-m=gguf]').value = ws().gguf; el.querySelector('[data-m=tjs]').value = ws().tjs;
      const paint = () => {
        const S = { chrome: hasLM() ? st.chrome : 'API not present', wllama: wlModel ? 'loaded · ' + wlModel : st.wllama, tjs: tjsModel ? 'loaded · ' + tjsModel : st.tjs };
        for (const k of ['chrome', 'wllama', 'tjs']) {
          const c = el.querySelector('[data-s=' + k + ']'); if (!c) continue; c.textContent = S[k]; c.className = 'chip xs ' + (/ready|loaded/.test(S[k]) ? 'ok' : /error|not present/.test(S[k]) ? 'err' : /download|loading/.test(S[k]) ? 'acc' : '');
          el.querySelector('[data-b=' + k + ']').style.width = (/download/.test(S[k]) ? st.progress[k] || 0 : /ready|loaded/.test(S[k]) ? 100 : 0) + '%';
          const er = String(st.errors[k] || ''), ix = er.indexOf(' Tried: '), ee = el.querySelector('[data-e=' + k + ']');
          ee.innerHTML = ix < 0 ? esc(er.slice(0, 300)) : esc(er.slice(0, ix)) + '<details><summary class="xs">' + er.slice(ix + 8).split(' | ').length + ' CDN candidates failed</summary><div class="xs mono">' + er.slice(ix + 8).split(' | ').map(esc).join('<br>') + '</div></details>';
        }
      };
      const recheck = async () => { const r = await check(); const t = el.querySelector('[data-cap]'); if (t) t.innerHTML = capRows(r); const ci = await cacheInfo(); const c = el.querySelector('[data-cache]'); if (c) c.innerHTML = 'Cache Storage: ' + (ci.caches.length ? ci.caches.map(esc).join(', ') : 'none') + '<br>OPFS entries: ' + (ci.opfs.length ? ci.opfs.map(esc).join(', ') : 'none'); paint(); };
      const onChange = e => { const s = e.target.closest('[data-m]'); if (s) setWs(s.dataset.m === 'gguf' ? { gguf: s.value } : { tjs: s.value }); };
      const onClick = async e => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.use) { const M = ctx.service('forge.models'); if (M && M.select) M.select(b.dataset.use, ''); else { DS.store.settings().provider = b.dataset.use; DS.store.settings().forceSim = false; DS.store.save && DS.store.save(); } DS.bus.emit('status:refresh'); ctx.toast('Chat now uses ' + b.dataset.use + ' (falls back to Sim if unavailable).', 'ok'); return; }
        const a = b.dataset.a; b.disabled = true;
        try {
          if (a === 'recheck') await recheck();
          else if (a === 'load-wllama') await loadWllama().then(() => ctx.toast('wllama model ready', 'ok'));
          else if (a === 'load-tjs') await loadTjs().then(() => ctx.toast('Transformers.js model ready', 'ok'));
          else if (a === 'unload-wllama') await unload('wllama'); else if (a === 'unload-tjs') await unload('tjs'); else if (a === 'unload') await unload();
          else if (a === 'clear') { if (await DS.ui.confirm('Delete downloaded on-device model files from this browser?', 'Clear')) { const n = await clearCache(); ctx.toast('Cleared ' + n + ' cache entr' + (n === 1 ? 'y' : 'ies'), 'ok'); await recheck(); } }
        } catch (er) { ctx.toast(String(er.message || er).split(' Tried: ')[0].slice(0, 140), 'err', 5000); }
        finally { b.disabled = false; paint(); }
      };
      el.addEventListener('click', onClick); el.addEventListener('change', onChange);
      refreshers.add(paint); paint(); recheck();
      return () => refreshers.delete(paint);
    }
    ctx.view({ id: 'localai', title: 'Local AI', icon: 'chip', order: 78, mount(el) {
      el.classList.add('la-v'); el.innerHTML = '<div class="vhead"><h2>Local AI</h2><span class="chip xs">on-device · keyless</span></div><div class="vscroll"></div>';
      return mountPanel(el.querySelector('.vscroll'));
    } });
    ctx.settings({ id: 'localai', title: 'Local AI (on-device)', render(el) {
      el.innerHTML = '<div class="sm muted">Keyless models running in this browser: Chrome built-in AI, wllama (GGUF/WASM), Transformers.js. Text-only (no tools).</div><div class="la-row"><button class="btn sm pri" data-open>Open Local AI</button><label class="sm">Max tokens <input class="inp" style="width:90px" type="number" min="32" max="4096" data-mt value="' + ws().maxTokens + '"></label></div>';
      el.querySelector('[data-open]').onclick = () => DS.shell.show('localai');
      el.querySelector('[data-mt]').onchange = e => setWs({ maxTokens: Math.max(32, Math.min(4096, +e.target.value || 512)) });
    } });
    ctx.command({ name: 'local', args: '[check]', desc: 'On-device AI: capability check / open Local AI', async run(a, c) { if (/check/i.test(a || '')) c.reply(table(await check())); else DS.shell.show('localai'); } });

    /* ---------- tool + Sim intent + suggest ---------- */
    ctx.tool({ name: 'localai_check', description: 'Check which on-device (keyless, local) AI runtimes this browser supports: WebGPU, WASM SIMD, threads, Chrome Prompt API, storage quota; returns the best local provider.', gate: 'none', label: 'Local AI check',
      parameters: { type: 'object', properties: {}, required: [] },
      async run() { return await check(); },
      summarize: (a, r) => r && r.recommend ? 'best: ' + r.recommend : 'checked',
      inline(part, el) { const r = part.result; if (!r || el._done) return; el._done = 1; el.innerHTML = '<table class="la-t">' + capRows(r) + '</table><div class="la-row"><button class="btn sm pri">Open Local AI</button></div>'; el.querySelector('button').onclick = () => DS.shell.show('localai'); } });
    ctx.intent({ id: 'localai', order: 50, match: t => /\b(run (ai|a model|models?|llm) (on|locally on) (this|my) (device|phone|computer|browser)|on-device (ai|model|llm)|local ai|offline (ai|model|llm)|gemini nano|wllama)\b/i.test(t),
      script: () => [
        { say: 'Checking what this device can run locally…', tool: { name: 'localai_check', args: {} } },
        { final: rs => { const r = rs[0] || {}; return (r.recommend ? table(r) : 'Capability check failed.') + '\n\nOpen **Local AI** (`/local`) to download a model and pick it for chat. On-device models are keyless and private but small and **text-only** (no tools); WebLLM (WebGPU) is also available from the GPU lab.'; } }
      ] });
    ctx.suggest({ id: 'localai-sug', emoji: '📱', title: 'Run AI on this device', sub: 'Keyless, private — check WebGPU / WASM / Gemini Nano', prompt: 'Run AI on this device' });
    ctx.provide('forge.localai', { check, open: () => DS.shell.show('localai'), unload, clearCache, cacheInfo, state: () => JSON.parse(JSON.stringify(st)), load: k => k === 'tjs' ? loadTjs() : loadWllama() });
    return () => { unload().catch(() => {}); };
  }
});

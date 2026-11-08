/* forge.checkpoints — per-run file checkpoints, rewind (code / conversation / both), thread forking, real-folder import.
   Inspired by Claude Code /rewind, Cline checkpoints and LibreChat forks. Uses only the public DS/ctx API. */
DS.plugin({
  name: 'forge.checkpoints', title: 'Checkpoints, rewind & fork', version: '1.0.0', tags: ['workflow', 'safety'],
  description: 'Snapshots files before each agent run so you can rewind code and/or conversation, fork a thread from any message, and import a real folder.',
  apply(ctx) {
    const { util, ui } = DS; const esc = util.esc;
    const CAP = 30, MAXB = 200 * 1024, WRITE_KEYS = ['path', 'to', 'dest', 'target', 'file', 'from', 'out', 'output'];
    const all = () => ctx.data.get('cps', {});
    const listFor = t => (t && all()[t.id]) || [];
    /* global budget: snapshots live in plugin storage (localStorage on iOS when IndexedDB is blocked) — keep them small.
       Oldest checkpoints across all threads are evicted first once the total passes BUDGET characters. */
    const BUDGET = 1.5e6, MAXFILES = 200;
    const enforce = a => { let tot = JSON.stringify(a).length; if (tot <= BUDGET) return a; const flat = []; for (const [tid, arr] of Object.entries(a)) arr.forEach(c => flat.push([c.ts, tid, c.id])); flat.sort((x, y) => x[0] - y[0]);
      for (const [, tid, id] of flat) { if (tot <= BUDGET) break; const arr = a[tid]; const i = arr.findIndex(c => c.id === id); if (i < 0) continue; if (live.get(tid) && live.get(tid).id === id) continue; tot -= JSON.stringify(arr[i]).length; arr.splice(i, 1); if (!arr.length) delete a[tid]; }
      return a; };
    const saveFor = (t, arr) => { const a = all(); a[t.id] = arr.slice(-CAP); ctx.data.set('cps', enforce(a)); };
    ctx.on('thread:removed', id => { const a = all(); if (a[id]) { delete a[id]; ctx.data.set('cps', a); } });
    const live = new Map(); // threadId -> checkpoint currently being filled by a run
    const size = s => (typeof s === 'string' ? s.length : 0);
    const fmtT = ts => { try { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; } };
    const persist = () => { try { DS.store.save(); } catch (_) {} };

    /* ───────── capture ───────── */
    ctx.effect(() => { const s = document.createElement('style'); s.textContent = `
      .ck-li{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border:1px solid var(--line);border-radius:var(--radius);background:var(--card);margin-bottom:8px}
      .ck-li .nm{font-weight:600;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:break-word}
      .ck-li .ds{color:var(--muted);font-size:12px;margin-top:2px}
      .ck-li .grow{min-width:0;flex:1}
      .ck-dot{width:10px;height:10px;border-radius:50%;background:var(--accent);margin-top:6px;flex:none;box-shadow:0 0 0 3px var(--accent-soft)}
      .ck-files{font-family:var(--mono);font-size:11.5px;color:var(--text-2);margin-top:4px;word-break:break-all}
      .ck-fork{display:flex;align-items:center;gap:8px;margin:4px 0 12px;flex-wrap:wrap}
      .ck-fork .chip{cursor:pointer;min-height:32px;display:inline-flex;align-items:center;gap:6px}
      .ck-ub{display:flex;justify-content:flex-end;gap:6px;margin-top:4px;opacity:.75}
      .ck-ub button{background:none;border:1px solid var(--line);color:var(--muted);border-radius:999px;font-size:12px;padding:4px 10px;min-height:30px;cursor:pointer}
      .ck-ub button:hover{color:var(--text);border-color:var(--accent-line)}
      .ck-prev{max-height:46vh;overflow:auto;margin-top:8px}
      .ck-prev h4{font:600 12px var(--mono);margin:10px 0 4px;color:var(--text-2);word-break:break-all}
      .ck-note{font-size:12.5px;color:var(--muted);margin:6px 0}
      .ck-opts{display:grid;gap:8px;margin-top:6px}
      .ck-opts button{text-align:left;min-height:44px}
    `; document.head.appendChild(s); return () => s.remove(); });

    ctx.hook('run:start', ({ thread, text }) => {
      if (!thread) return;
      const msgs = thread.messages || []; let ui0 = -1;
      for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === 'user') { ui0 = i; break; }
      const um = msgs[ui0];
      const cp = { id: util.uid('cp'), ts: Date.now(), threadId: thread.id, msgIndex: ui0 < 0 ? msgs.length : ui0, msgId: um && um.id, label: String(text || (um && um.content) || '(run)').slice(0, 160), files: {}, skipped: [] };
      live.set(thread.id, cp); saveFor(thread, [...listFor(thread), cp]);
    }, { order: 5 });
    ctx.hook('run:end', ({ thread }) => { if (!thread) return; const cp = live.get(thread.id); live.delete(thread.id); if (cp) commit(thread, cp); });

    function commit(thread, cp) { const arr = listFor(thread); const i = arr.findIndex(c => c.id === cp.id); if (i >= 0) { arr[i] = cp; saveFor(thread, arr); } }
    async function snap(thread, cp, p) {
      if (!p || typeof p !== 'string' || p[0] !== '/') return; p = DS.fs.norm(p);
      if (p in cp.files || cp.skipped.includes(p)) return;
      let content = null, isDir = false;
      try { content = (await DS.fs.read(p)).content; } catch (_) { try { isDir = await DS.fs.exists(p); } catch (_) {} }
      if (isDir) { let kids = []; try { kids = await DS.fs.walk(p, 400); } catch (_) {} for (const k of kids) await snap(thread, cp, k); return; }
      if ((content != null && size(content) > MAXB) || Object.keys(cp.files).length >= MAXFILES) { cp.skipped.push(p); return; }
      cp.files[p] = content;
    }
    ctx.hook('beforeTool', async ({ name, args, thread }) => {
      const cp = thread && live.get(thread.id); if (!cp || !args) return;
      const def = DS.agent.tool(name); const gate = def && def.gate || 'none'; if (gate === 'read' || gate === 'none') return;
      for (const k of WRITE_KEYS) if (typeof args[k] === 'string') await snap(thread, cp, args[k]);
      if (Array.isArray(args.files)) for (const f of args.files) if (f && typeof f.path === 'string') await snap(thread, cp, f.path);
      commit(thread, cp);
    }, { order: 5 });
    // Safety net: tools we could not predict still call recordChange — use its `before` if the first change happened during this run.
    ctx.on('changes:update', thread => {
      const cp = thread && live.get(thread.id); if (!cp || !thread.changes) return;
      for (const [p, c] of Object.entries(thread.changes)) if (!(p in cp.files) && !cp.skipped.includes(p) && c.ts >= cp.ts - 5) { if (size(c.before) > MAXB) cp.skipped.push(p); else cp.files[p] = c.before; commit(thread, cp); }
    });

    /* ───────── rewind ───────── */
    // Files to restore when rewinding to cp: union of cp and every later checkpoint; earliest snapshot wins.
    function targetFiles(thread, cp) {
      const arr = listFor(thread); const i = arr.findIndex(c => c.id === cp.id); const out = {}; const skipped = new Set();
      for (const c of arr.slice(Math.max(0, i))) { for (const [p, v] of Object.entries(c.files || {})) if (!(p in out)) out[p] = v; (c.skipped || []).forEach(p => skipped.add(p)); }
      return { files: out, skipped: [...skipped] };
    }
    async function currentOf(p) { try { return (await DS.fs.read(p)).content; } catch (_) { return null; } }
    async function plan(thread, cp) {
      const { files, skipped } = targetFiles(thread, cp); const rows = [];
      for (const [p, before] of Object.entries(files)) { const cur = await currentOf(p); if (cur !== before) rows.push({ path: p, cur, before }); }
      return { rows, skipped, drop: Math.max(0, thread.messages.length - cp.msgIndex) };
    }
    async function restoreCode(thread, rows) {
      for (const r of rows) {
        const ch = thread.changes && thread.changes[r.path];
        if (ch && ch.before === r.before) DS.agent.accept(thread, r.path); // back to the thread's baseline → no pending change
        else DS.agent.recordChange(thread, r.path, r.cur);
        if (r.before === null) { try { await DS.fs.remove(r.path); } catch (_) {} } else await DS.fs.write(r.path, r.before);
      }
      persist(); DS.bus.emit('changes:update', thread); DS.bus.emit('fs:change', {});
    }
    function restoreConvo(thread, cp) {
      if (DS.agent.isRunning(thread)) DS.agent.stop(thread);
      const um = thread.messages[cp.msgIndex]; thread.messages = thread.messages.slice(0, cp.msgIndex); thread.updated = Date.now();
      saveFor(thread, listFor(thread).filter(c => c.msgIndex < cp.msgIndex));
      persist(); try { DS.threadView.renderAll(); } catch (_) {}
      const txt = um && um.role === 'user' ? um.content : cp.label;
      setTimeout(() => { try { const ta = document.querySelector('#composer textarea, textarea'); if (ta && txt && !ta.value) { ta.value = txt; ta.dispatchEvent(new Event('input')); } } catch (_) {} }, 60);
    }
    async function rewind(thread, cp, mode) {
      const p = await plan(thread, cp);
      if (mode !== 'convo') await restoreCode(thread, p.rows);
      if (mode !== 'code') restoreConvo(thread, cp);
      ctx.toast(mode === 'convo' ? 'Conversation rewound' : (p.rows.length + ' file' + (p.rows.length === 1 ? '' : 's') + ' restored' + (mode === 'both' ? ' · conversation rewound' : '')), 'ok');
      return { restored: p.rows.map(r => r.path), dropped: mode === 'code' ? 0 : p.drop };
    }
    /* "Summarize up to here" (Claude Code rewind menu): compacts everything before the checkpoint into one extractive summary
       message — offline and deterministic; the files are untouched. Checkpoint indexes are shifted to match. */
    function summarizeUpTo(thread, cp) {
      const idx = Math.min(cp.msgIndex, thread.messages.length); if (idx < 2) { ctx.toast('Nothing before this point to summarize', 'warn'); return { summarized: 0 }; }
      const old = thread.messages.slice(0, idx); const lines = [];
      for (const m of old) {
        if (m.role === 'user') lines.push('- **You:** ' + String(m.content || '').replace(/\s+/g, ' ').slice(0, 180));
        else { const t = (m.parts || []).filter(p => p.type === 'text').map(p => p.text).join(' ').replace(/\s+/g, ' ').slice(0, 220); const tools = (m.parts || []).filter(p => p.type === 'tool').map(p => p.name + (p.status && p.status !== 'ok' ? '(' + p.status + ')' : '')); lines.push('- **Assistant:** ' + (t || '(no text)') + (tools.length ? ' · tools: ' + tools.join(', ') : '')); }
      }
      const sum = { id: util.uid('m'), role: 'user', ts: old[0].ts || Date.now(), summary: true, content: '[Summary of ' + old.length + ' earlier messages — extractive, made by Forge rewind]\n' + lines.join('\n').slice(0, 6000) };
      thread.messages.splice(0, idx, sum);
      const shift = idx - 1; saveFor(thread, listFor(thread).map(c => Object.assign({}, c, { msgIndex: Math.max(0, c.msgIndex - shift) })));
      persist(); try { DS.threadView.renderAll(); } catch (_) {} ctx.toast('Summarized ' + old.length + ' messages into 1', 'ok');
      return { summarized: old.length };
    }
    async function rewindSheet(thread, cp) {
      const p = await plan(thread, cp); const node = util.el('div', {});
      node.innerHTML = '<div class="ck-note">Checkpoint <b>' + esc(fmtT(cp.ts)) + '</b> — before “' + esc(cp.label.slice(0, 80)) + '”</div>' +
        '<div class="ck-note">Code: <b>' + p.rows.length + '</b> file(s) will change · Conversation: <b>' + p.drop + '</b> message(s) will be removed</div>' +
        (p.skipped.length ? '<div class="ck-note">⚠ Not snapshotted (binary or &gt; 200 KB): ' + esc(p.skipped.join(', ')) + '</div>' : '') +
        '<div class="ck-opts"><button class="btn pri" data-m="both">Rewind code + conversation</button><button class="btn" data-m="code">Code only</button><button class="btn" data-m="convo">Conversation only</button><button class="btn" data-m="sum">Summarize up to here</button></div><div class="ck-prev"></div>';
      const prev = node.querySelector('.ck-prev');
      if (!p.rows.length) prev.innerHTML = '<div class="ck-note">No file differences — files already match this checkpoint.</div>';
      for (const r of p.rows.slice(0, 20)) {
        const h = util.el('h4', {}); h.textContent = r.path + (r.before === null ? '  (will be deleted — new in this run)' : r.cur === null ? '  (will be re-created)' : ''); prev.appendChild(h);
        const box = util.el('div', { class: 'diffbox' }); try { box.innerHTML = DS.diff.html(r.cur || '', r.before || ''); } catch (_) { box.textContent = '(diff unavailable)'; } prev.appendChild(box);
      }
      let close = null;
      node.querySelectorAll('[data-m]').forEach(b => b.onclick = async () => { const m = b.getAttribute('data-m'); if (close) close(); if (m === 'sum') summarizeUpTo(thread, cp); else await rewind(thread, cp, m); });
      const sh = ui.sheet({ title: 'Rewind to checkpoint', node, actions: [{ label: 'Cancel', onClick: c => c() }] });
      close = () => { try { if (sh && sh.close) sh.close(); else document.querySelector('.sheet .x, .sheet [aria-label="Close"]')?.click(); } catch (_) {} };
      return sh;
    }
    function cpForMsg(thread, m) {
      const arr = listFor(thread); const idx = thread.messages.indexOf(m); if (idx < 0) return null;
      if (m.role === 'user') return arr.find(c => c.msgId === m.id) || arr.find(c => c.msgIndex === idx) || null;
      let u = idx; while (u >= 0 && thread.messages[u].role !== 'user') u--; // assistant → the run that produced it
      return arr.filter(c => c.msgIndex <= Math.max(u, 0)).pop() || arr.find(c => c.msgIndex >= u) || null;
    }

    /* ───────── fork ───────── */
    function fork(thread, upto) {
      const n = upto == null ? thread.messages.length : upto + 1; const msgs = JSON.parse(JSON.stringify(thread.messages.slice(0, n)));
      const src = { id: thread.id, title: thread.title, at: n };
      const t = DS.store.newThread('↳ ' + (thread.title || 'thread'));
      Object.assign(t, { messages: msgs, mode: thread.mode, permission: thread.permission, plan: thread.plan ? JSON.parse(JSON.stringify(thread.plan)) : null, titled: true, forkOf: src, changes: {} });
      const cps = listFor(thread).filter(c => c.msgIndex < n).map(c => Object.assign({}, c, { id: util.uid('cp'), threadId: t.id }));
      saveFor(t, cps); persist();
      DS.bus.emit('sidebar:refresh'); DS.bus.emit('thread:switch', t);
      try { DS.shell.show('thread'); } catch (_) {}
      ctx.toast('Forked · ' + msgs.length + ' message' + (msgs.length === 1 ? '' : 's'), 'ok'); return t;
    }
    // Parent chip at the top of a fork + small rewind/fork buttons under user bubbles (core renders no footer for user turns).
    function decorate() {
      const inEl = document.getElementById('msgs-in'); const th = DS.store.activeThread(); if (!inEl || !th) return;
      if (th.forkOf && !inEl.querySelector('.ck-fork') && th.messages.length) {
        const c = util.el('div', { class: 'ck-fork' }); c.innerHTML = '<span class="chip acc" role="button" tabindex="0">' + DS.icon('branch') + ' Forked from “' + esc(th.forkOf.title || 'thread') + '” · ' + th.forkOf.at + ' msgs</span>';
        c.firstChild.onclick = () => { const p = DS.store.threads().find(x => x.id === th.forkOf.id); if (p) DS.store.setActive(p.id); else ctx.toast('Parent thread was deleted', 'warn'); };
        inEl.prepend(c);
      }
      if (DS.agent.isRunning(th)) return;
      inEl.querySelectorAll('.turn.user').forEach(n => {
        if (n.querySelector('.ck-ub')) return; const m = th.messages.find(x => x.id === n.getAttribute('data-id')); if (!m) return;
        const bar = util.el('div', { class: 'ck-ub' }); const cp = cpForMsg(th, m);
        bar.innerHTML = (cp ? '<button data-a="rw" title="Rewind to before this message">⟲ Rewind</button>' : '') + '<button data-a="fk" title="Fork a new thread from here">↳ Fork</button>';
        bar.onclick = e => { const a = e.target.closest('button'); if (!a) return; if (a.dataset.a === 'rw') rewindSheet(th, cp); else fork(th, th.messages.indexOf(m)); };
        n.appendChild(bar);
      });
    }
    const deco = util.debounce ? util.debounce(decorate, 60) : decorate;
    ctx.effect(() => {
      let mo = null; const hook = () => { const inEl = document.getElementById('msgs-in'); if (!inEl) return false; mo = new MutationObserver(() => deco()); mo.observe(inEl, { childList: true }); deco(); return true; };
      const iv = setInterval(() => { if (hook()) clearInterval(iv); }, 300); hook() && clearInterval(iv);
      return () => { clearInterval(iv); if (mo) mo.disconnect(); document.querySelectorAll('.ck-ub,.ck-fork').forEach(x => x.remove()); };
    });
    ctx.on('thread:switch', () => deco()); ctx.on('run:end', () => setTimeout(deco, 80));

    ctx.messageAction({ id: 'ck-rewind', icon: 'redo', label: 'Rewind to here', when: m => { const t = DS.store.activeThread(); return !!(t && cpForMsg(t, m)); }, run: (m, { thread }) => { const cp = cpForMsg(thread, m); if (cp) rewindSheet(thread, cp); } });
    ctx.messageAction({ id: 'ck-fork', icon: 'branch', label: 'Fork from here', run: (m, { thread }) => fork(thread, thread.messages.indexOf(m)) });
    ctx.threadAction({ id: 'ck-fork-thread', icon: 'branch', label: 'Fork thread', run: t => fork(t) });
    ctx.threadAction({ id: 'ck-panel', icon: 'redo', label: 'Checkpoints…', run: t => openPanel(t) });

    /* ───────── checkpoints panel ───────── */
    function openPanel(thread) {
      thread = thread || DS.store.activeThread(); if (!thread) return ctx.toast('No active thread', 'warn');
      const node = util.el('div', {}); const draw = () => {
        const arr = listFor(thread).slice().reverse(); node.innerHTML = '';
        if (!arr.length) { node.innerHTML = '<div class="empty-v">No checkpoints yet. One is taken automatically before every agent run.</div>'; return; }
        for (const cp of arr) {
          const files = Object.keys(cp.files || {}); const li = util.el('div', { class: 'ck-li' });
          li.innerHTML = '<span class="ck-dot"></span><div class="grow"><div class="nm"></div><div class="ds">' + esc(fmtT(cp.ts)) + ' · msg #' + (cp.msgIndex + 1) + ' · ' + files.length + ' file(s)' + (cp.skipped && cp.skipped.length ? ' · ' + cp.skipped.length + ' skipped' : '') + '</div>' + (files.length ? '<div class="ck-files"></div>' : '') + '</div><div class="col" style="gap:6px"><button class="btn sm pri" data-a="rw">Rewind</button><button class="btn sm" data-a="fk">Fork</button></div>';
          li.querySelector('.nm').textContent = cp.label; const fl = li.querySelector('.ck-files'); if (fl) fl.textContent = files.slice(0, 6).join('  ') + (files.length > 6 ? ' …' : '');
          li.querySelector('[data-a=rw]').onclick = () => rewindSheet(thread, cp);
          li.querySelector('[data-a=fk]').onclick = () => fork(thread, Math.max(0, cp.msgIndex - 1));
          node.appendChild(li);
        }
      }; draw();
      return ui.sheet({ title: 'Checkpoints · ' + (thread.title || ''), node, actions: [{ label: 'Clear all', danger: true, onClick: c => { saveFor(thread, []); draw(); } }, { label: 'Done', primary: true, onClick: c => c() }] });
    }
    ctx.command({ name: 'rewind', args: '[n]', desc: 'List checkpoints / rewind the last n runs', async run(arg, c) {
      const t = c.thread || DS.store.activeThread(); if (!t) return c.reply('No active thread.');
      const arr = listFor(t); const n = parseInt(arg, 10);
      if (n > 0 && arr.length) return rewindSheet(t, arr[Math.max(0, arr.length - n)]);
      openPanel(t);
    } });
    ctx.command({ name: 'fork', desc: 'Fork this thread into a new one', run: (a, c) => { const t = c.thread || DS.store.activeThread(); if (t) fork(t); } });
    ctx.command({ name: 'checkpoints', desc: 'Show this thread’s checkpoints', run: (a, c) => openPanel(c.thread) });

    /* ───────── real folder ───────── */
    const handles = new Map(); // mount -> { dir, files:{rel:content at import} }
    const SKIP = /(^|\/)(node_modules|\.git|\.DS_Store|dist|build|\.next)(\/|$)/;
    const TEXT = /\.(txt|md|markdown|js|mjs|cjs|ts|tsx|jsx|json|html?|css|scss|py|rb|go|rs|java|c|h|cpp|sh|ya?ml|toml|ini|xml|svg|csv|sql|env|gitignore|lua|php|swift|kt|vue|svelte)$/i;
    const LIMIT = 2 * 1024 * 1024;
    async function importEntries(name, entries) { // entries: [{rel, file:File}]
      const mount = '/mnt/' + name.replace(/[^\w.-]+/g, '_'); let total = 0, n = 0; const skipped = []; const snap = {};
      for (const e of entries) {
        if (SKIP.test(e.rel)) continue; if (!TEXT.test(e.rel) && !/^[^.]+$/.test(e.rel.split('/').pop())) { skipped.push(e.rel); continue; }
        if (total + e.file.size > LIMIT) { skipped.push(e.rel); continue; }
        const txt = await e.file.text(); total += e.file.size; n++; snap[e.rel] = txt; await DS.fs.write(mount + '/' + e.rel, txt);
      }
      DS.bus.emit('fs:change', {}); return { mount, n, total, skipped, snap };
    }
    async function walkHandle(dir, pre, out) {
      for await (const [nm, h] of dir.entries()) { const rel = pre ? pre + '/' + nm : nm; if (SKIP.test(rel)) continue; if (h.kind === 'directory') await walkHandle(h, rel, out); else out.push({ rel, file: await h.getFile() }); if (out.length > 3000) break; }
      return out;
    }
    async function writeBack(mount) {
      const h = handles.get(mount); if (!h) return ctx.toast('No write access for ' + mount + ' (imported read-only)', 'warn');
      let n = 0; const errs = [];
      for (const rel of Object.keys(h.files)) {
        const cur = await currentOf(mount + '/' + rel); if (cur === null || cur === h.files[rel]) continue;
        try { let d = h.dir; const parts = rel.split('/'); for (const seg of parts.slice(0, -1)) d = await d.getDirectoryHandle(seg); const fh = await d.getFileHandle(parts.pop(), { create: true }); const w = await fh.createWritable(); await w.write(cur); await w.close(); h.files[rel] = cur; n++; } catch (e) { errs.push(rel + ': ' + e.message); }
      }
      ctx.toast(n ? 'Wrote ' + n + ' file(s) back to disk' : (errs.length ? 'Write-back failed' : 'No changes to write back'), errs.length ? 'err' : 'ok');
      return { written: n, errors: errs };
    }
    async function pickFolder(c) {
      const reply = md => { try { (c && c.reply ? c.reply : DS.threadView.replyLocal.bind(DS.threadView))(md); } catch (_) { ctx.toast(md.replace(/[*`]/g, '').slice(0, 120)); } };
      if (typeof window.showDirectoryPicker === 'function') {
        let dir; try { dir = await window.showDirectoryPicker({ mode: 'readwrite' }); } catch (e) { return ctx.toast('Folder pick cancelled', 'warn'); }
        const r = await importEntries(dir.name, await walkHandle(dir, '', [])); handles.set(r.mount, { dir, files: r.snap });
        return reply('📂 Imported **' + r.n + '** text files (' + DS.fmtBytes(r.total) + ') from `' + esc(dir.name) + '` into `' + r.mount + '/`.' + (r.skipped.length ? ' Skipped ' + r.skipped.length + ' (binary or over the 2 MB budget).' : '') + '\n\nEdits stay in the browser until you run **/folder write** (writes changed files back to the real folder).');
      }
      const inp = util.el('input', { type: 'file', multiple: '' }); inp.setAttribute('webkitdirectory', ''); inp.style.display = 'none'; document.body.appendChild(inp);
      inp.onchange = async () => {
        const files = [...(inp.files || [])]; inp.remove(); if (!files.length) return;
        const name = (files[0].webkitRelativePath || files[0].name).split('/')[0] || 'folder';
        const r = await importEntries(name, files.map(f => ({ rel: (f.webkitRelativePath || f.name).split('/').slice(1).join('/') || f.name, file: f })));
        reply('📂 Imported **' + r.n + '** text files into `' + r.mount + '/` as a **read-only copy**. This browser has no File System Access API (e.g. iOS Safari, Firefox), so changes cannot be written back — use the Files view to download edited files.');
      };
      inp.click();
    }
    ctx.command({ name: 'folder', args: '[write]', desc: 'Import a real folder into /mnt (write back with “/folder write”)', async run(arg, c) {
      if (/^write/.test((arg || '').trim())) { if (!handles.size) return c.reply('No writable folder is open. Run `/folder` in Chrome/Edge (File System Access API) first.'); for (const m of handles.keys()) await writeBack(m); return; }
      return pickFolder(c);
    } });
    ctx.composerAction({ id: 'ck-folder', icon: 'file', label: 'Open real folder', desc: 'Import a folder from disk into /mnt', run: c => pickFolder(c) });

    /* ───────── service + Sim demo ───────── */
    ctx.provide('forge.checkpoints', { summarizeUpTo: (t, cp) => summarizeUpTo(t, typeof cp === 'string' ? listFor(t).find(c => c.id === cp) : cp), list: t => listFor(t || DS.store.activeThread()), rewind: (t, cp, mode) => rewind(t, typeof cp === 'string' ? listFor(t).find(c => c.id === cp) : cp, mode || 'both'), plan, fork, openPanel, writeBack, importEntries });
    ctx.intent({ id: 'ck-demo', order: 50, match: t => /\b(change|edit|write)\b.*\bthen\b.*\b(rewind|undo|revert)\b|\bcheckpoint demo\b/i.test(t), script: () => [
      { say: 'I’ll create `/notes/demo.txt`, then change it — a checkpoint was taken before this run started.', tool: { name: 'fs_write', args: { path: '/notes/demo.txt', content: 'Draft 1 — written by the agent.\n' } } },
      { tool: { name: 'fs_write', args: { path: '/notes/demo.txt', content: 'Draft 2 — the agent changed its mind.\nAdded a second line.\n' } } },
      { final: () => 'Done: `/notes/demo.txt` was written twice. Now tap **⟲ Rewind** under your message (or ⋯ → **Checkpoints…**, or `/rewind 1`) and choose **Code only** — the file disappears because it did not exist at the checkpoint. **↳ Fork** makes a branch of this conversation instead.' }
    ] });
    ctx.suggest({ id: 'ck-demo', emoji: '⟲', title: 'Make a change, then rewind it', sub: 'Checkpoints · rewind · fork', prompt: 'Make a change then rewind it' });
  }
});

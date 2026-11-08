/* ═══════════════════════════ THREAD VIEW + COMPOSER ═══════════════════════════ */
const ST_ICON = { ok: DS.icons.check, err: DS.icons.x, denied: DS.icons.x, aborted: DS.icons.stop, running: '<span class="spin">' + DS.icons.redo + '</span>', pending: '<span class="spin">' + DS.icons.redo + '</span>' };
const TV = DS.threadView = {
  root: null, msgsEl: null, nodes: new Map(), ctx: [], stick: true, ac: { items: [], idx: 0, kind: null, range: null },
  mount(root) {
    this.root = root; root.innerHTML = '<div class="thread-v"><div id="msgs"><div class="msgs-in" id="msgs-in"></div></div><div id="planbar"></div><div id="composer"></div></div>';
    this.msgsEl = $('#msgs', root); this.inEl = $('#msgs-in', root); this.buildComposer();
    this.msgsEl.addEventListener('scroll', () => { this.stick = this.msgsEl.scrollHeight - this.msgsEl.scrollTop - this.msgsEl.clientHeight < 90; });
    const b = DS.bus;
    b.on('thread:switch', () => this.renderAll()); b.on('workspace:switch', () => this.renderAll());
    /* coalesce streaming updates: at most one render per frame (and ≥ 80 ms apart for very long answers) instead of one per token */
    this._pend = new Map(); this._raf = 0; this._last = 0;
    const flush = () => { this._raf = 0; this._last = performance.now(); const ms = [...this._pend.values()]; this._pend.clear(); for (const m of ms) { try { this.updateMsg(m); } catch (e) { console.error(e); } } };
    this.flushUpdates = () => { if (this._raf) { cancelAnimationFrame(this._raf); clearTimeout(this._raf); } flush(); };
    b.on('msg:update', ({ thread, msg }) => {
      if (thread !== Store.activeThread()) return; this._pend.set(msg.id, msg); if (this._raf) return;
      const big = msg.parts && msg.parts.reduce((n, p) => n + ((p.text && p.text.length) || 0), 0) > 20000; const wait = big ? Math.max(0, 80 - (performance.now() - this._last)) : 0;
      if (document.hidden) { this._raf = setTimeout(flush, 250); return; }
      this._raf = wait ? setTimeout(() => { this._raf = requestAnimationFrame(flush); }, wait) : requestAnimationFrame(flush);
    });
    b.on('run:end', () => this.flushUpdates());
    b.on('run:start', ({ thread }) => { if (thread === Store.activeThread()) { this.renderAll(); this.syncSend(); } });
    b.on('run:end', ({ thread }) => { if (thread === Store.activeThread()) { this.renderAll(); this.syncSend(); } });
    b.on('plan:update', ({ }) => this.renderPlan()); b.on('contrib:change', e => { if (['composerPill', 'composerAction', 'suggestion'].includes(e.point)) { this.renderPills(); if (e.point === 'suggestion') this.renderAll(); } });
    this.renderAll();
  },
  onShow() { this.renderAll(); setTimeout(() => { const th = Store.activeThread(); if (!th || !th.messages.length) this.msgsEl.scrollTop = 0; else this.scroll(true); }, 30); },
  scroll(force) { if (force || this.stick) this.msgsEl.scrollTop = this.msgsEl.scrollHeight; },
  /* ---------- message list ---------- */
  renderAll() {
    if (!this.inEl) return; const th = Store.activeThread(); this.nodes.clear(); this.inEl.innerHTML = '';
    if (!th || !th.messages.length) { this.renderEmpty(); this.renderPlan(); return; }
    for (const m of th.messages) this.inEl.appendChild(this.buildMsg(m, th)); this.renderPlan(); this.scroll(true);
  },
  renderEmpty() {
    const sugg = DS.kernel.list('suggestion'); const live = DS.providers.isLive();
    const e = el('div', { class: 'empty' }, '<svg style="width:54px;height:54px" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="var(--card)"/><path d="M14 44h36l-6-10H30l-4-8h-6z" fill="var(--accent)"/><rect x="20" y="46" width="24" height="5" rx="2" fill="#ff8a3d"/></svg><h1>What are we forging?</h1><p>' + (live ? 'Connected to <b>' + esc(Store.settings().baseUrl.replace(/^https?:\/\//, '')) + '</b>' : 'Running on the <b>offline Sim</b>; add a key in Settings for live models') + ' · everything here is a plugin.</p><div class="sugg"></div>');
    const box = $('.sugg', e); const LIM = 6; let more = null; sugg.forEach((s, i) => { const b = el('button', { class: 'sg' }, '<span class="em">' + esc(s.emoji || '✦') + '</span><span><b>' + esc(s.title) + '</b><span class="s">' + esc(s.sub || '') + '</span></span>'); b.onclick = () => { if (s.run) s.run(); else this.submit(s.prompt); }; if (i >= LIM) { b.style.display = 'none'; b.dataset.more = '1'; } box.appendChild(b); }); if (sugg.length > LIM) { more = el('button', { class: 'sg more', style: 'justify-content:center;opacity:.85' }, '<span><b>More ideas</b><span class="s">+' + (sugg.length - LIM) + ' starters</span></span>'); more.onclick = () => { box.querySelectorAll('[data-more]').forEach(x => { x.style.display = ''; }); more.remove(); }; box.appendChild(more); }
    this.inEl.appendChild(e);
  },
  buildMsg(m, th) {
    const n = el('div', { class: 'turn ' + m.role, 'data-id': m.id }); this.nodes.set(m.id, { el: n, parts: [] });
    if (m.role === 'user') { n.innerHTML = (m.ctx ? '<div class="ctxline">+ context attached</div>' : '') + '<div class="bubble"></div>'; $('.bubble', n).textContent = m.content; }
    else this.updateMsg(m, n);
    return n;
  },
  updateMsg(m, nodeOverride) {
    const rec = this.nodes.get(m.id); let n = nodeOverride || (rec && rec.el);
    if (!n) { const th = Store.activeThread(); if (!th) return; n = this.buildMsg(m, th); this.inEl.appendChild(n); const e0 = $('.empty', this.inEl); if (e0) e0.remove(); }
    const th = Store.activeThread(); const running = DS.agent.isRunning(th) && th.messages[th.messages.length - 1] === m;
    if (!n._built) { n._built = true; n.innerHTML = '<div class="wk"></div><div class="steps"></div><div class="final"></div><div class="tail"></div>'; n._open = null; $('.wk', n).onclick = () => { n._open = !n.classList.contains('steps-open'); this.updateMsg(m); }; }
    const wk = $('.wk', n), steps = $('.steps', n), fin = $('.final', n), tail = $('.tail', n);
    const parts = m.parts; let lastTool = -1; parts.forEach((p, i) => { if (p.type === 'tool') lastTool = i; });
    const stepParts = [], finParts = [], tailParts = [];
    parts.forEach((p, i) => { if (p.type === 'critic' || p.type === 'error') tailParts.push([p, i]); else if (p.type === 'tool' || i < lastTool) stepParts.push([p, i]); else finParts.push([p, i]); });
    const hasSteps = stepParts.length > 0; const open = n._open != null ? n._open : running; n.classList.toggle('steps-open', open);
    const dur = (m.meta.endedAt || now()) - m.meta.startedAt; const nTools = parts.filter(p => p.type === 'tool').length;
    wk.className = 'wk' + (hasSteps ? ' worked' + (open ? ' open' : '') : ''); wk.style.display = hasSteps ? 'flex' : 'none';
    wk.innerHTML = hasSteps ? '<span>' + (running ? '<span class="spin">' + DS.icons.redo + '</span> Working for ' + DS.fmtDur(dur) : 'Worked for ' + DS.fmtDur(dur)) + (nTools ? ' · ' + nTools + ' tool call' + (nTools > 1 ? 's' : '') : '') + '</span><i class="ln"></i>' + DS.icons.chev : '';
    steps.className = 'steps' + (open ? '' : ' hide');
    this.syncParts(steps, stepParts, m); this.syncParts(fin, finParts, m); this.syncParts(tail, tailParts, m);
    if (running && !parts.length) { if (!n._typing) { n._typing = el('div', { class: 'typing' }, '<i></i><i></i><i></i>'); } fin.appendChild(n._typing); } else if (n._typing) { n._typing.remove(); n._typing = null; }
    let foot = $('.foot', n);
    if (!running && (m.meta.endedAt)) { if (!foot) { foot = el('div', { class: 'foot' }); n.appendChild(foot); } this.renderFoot(foot, m, th); } else if (foot) foot.remove();
    if (m.meta.error && !n._err) { n._err = true; } if (m.meta.error) { let eb = $('.errbox', n); if (!eb) { eb = el('div', { class: 'errbox' }); n.insertBefore(eb, foot || null); } eb.textContent = m.meta.error; }
    this.scroll();
  },
  syncParts(host, list, m) {
    const keep = new Set();
    list.forEach(([p, i], k) => {
      const key = m.id + ':' + i; keep.add(key); let node = host.querySelector('[data-k="' + key + '"]');
      const kind = p.type; if (node && node._kind !== kind) { node.remove(); node = null; }
      if (!node) { node = el('div', { 'data-k': key }); node._kind = kind; host.appendChild(node); }
      if (host.children[k] !== node) host.insertBefore(node, host.children[k] || null);
      this.renderPart(node, p, m);
    });
    [...host.children].forEach(c => { if (c.dataset && c.dataset.k && !keep.has(c.dataset.k)) c.remove(); });
  },
  renderPart(node, p, m) {
    if (p.type === 'text') { if (node._t !== p.text) { node._t = p.text; DS.render.into(node, p.text, { msg: m, streaming: !m.meta.endedAt }); } return; }
    if (p.type === 'reasoning') {
      if (!p.text || !String(p.text).trim()) { node.className = ''; node.innerHTML = ''; node._b = false; return; } /* render only when reasoning actually arrived */
      if (!p.t0) p.t0 = m.meta.startedAt || now(); const done = !!m.meta.endedAt || m.parts.some(q => q !== p && q.type === 'text' && q.text && m.parts.indexOf(q) > m.parts.indexOf(p)); if (done && !p.t1) p.t1 = Math.min(now(), m.meta.endedAt || now());
      if (!node._b) { node._b = true; node.className = 'reason'; node.innerHTML = '<details' + (done ? '' : ' open') + '><summary role="button"></summary><div class="rt" aria-live="off"></div></details>'; const d = $('details', node); d.addEventListener('toggle', () => { node._user = true; }); }
      const d = $('details', node); if (!done) { if (!node._user) d.open = true; } else if (!node._closed && !node._user) { node._closed = true; d.open = false; }
      $('.rt', node).textContent = p.text; const secs = Math.max(1, Math.round(((p.t1 || now()) - p.t0) / 1000));
      $('summary', node).innerHTML = done ? DS.icons.atom.replace('<svg', '<svg style="width:13px;height:13px;vertical-align:-2px;margin-right:4px"') + 'Thought for ' + secs + 's' : '<span class="spin" style="width:13px;height:13px;margin-right:4px;vertical-align:-2px">' + DS.icons.atom.replace('<svg', '<svg style="width:13px;height:13px"') + '</span>Thinking… ' + secs + 's';
      if (!done) { const rt = $('.rt', node); rt.scrollTop = rt.scrollHeight; } return;
    }
    if (p.type === 'critic') { node.className = 'crit'; node.innerHTML = '<b>Critic</b><div></div>'; $('div', node).innerHTML = DS.render.inline(p.text); return; }
    if (p.type === 'tool') return this.renderTool(node, p, m);
  },
  renderTool(node, p, m) {
    const def = DS.agent.tool(p.name) || {}; if (!node._b) { node._b = true; node.className = 'tcall'; node.innerHTML = '<div class="tc-h"><span class="st"></span><span class="nm"></span><span class="sm"></span><span class="ico muted">' + DS.icons.chev + '</span></div><div class="tc-b"></div>'; $('.tc-h', node).onclick = () => { node.classList.toggle('open'); node._open = node.classList.contains('open'); if (node._open) this.fillTool(node, p, def); }; }
    const st = $('.st', node); st.className = 'st ' + p.status; st.innerHTML = ST_ICON[p.status] || ''; node.classList.remove('st-ok', 'st-err', 'st-denied', 'st-running', 'st-pending', 'st-aborted'); node.classList.add('st-' + p.status);
    $('.nm', node).textContent = def.label || p.name; $('.sm', node).textContent = p.summary || (p.status === 'denied' ? (p.result && p.result.error) : '') || ((p.args && (p.args.path || p.args.cmd || p.args.query || p.args.prompt || p.args.question)) || '');
    if (p.status === 'running' && p.live) { let lv = $('.tc-live', node); if (!lv) { lv = el('div', { class: 'tc-live' }); node.appendChild(lv); } lv.textContent = p.live; } else { const lv = $('.tc-live', node); if (lv) lv.remove(); }
    if (p.ask) this.renderAsk(node, p);
    if (node._open) this.fillTool(node, p, def); if (def.inline && p.status === 'ok') { try { let ib = $('.tc-inline', node); if (!ib) { ib = el('div', { class: 'tc-inline', style: 'padding:6px 8px' }); node.appendChild(ib); } def.inline(p, ib); } catch (_) {} }
  },
  fillTool(node, p, def) {
    const b = $('.tc-b', node); const j = v => { try { return JSON.stringify(v, null, 2); } catch (_) { return String(v); } };
    b.innerHTML = '';
    if (def.render) { try { def.render(p, b); return; } catch (e) { b.textContent = 'render failed: ' + e.message; } }
    const a = p.args || {}; let html = '';
    if (p.name === 'fs_edit' && a.old != null) html += '<div class="lbl">' + esc(a.path) + '</div><div class="diffbox">' + DS.diff.html(a.old, a.new || '', 2) + '</div>';
    else if (p.name === 'fs_write') html += '<div class="lbl">' + esc(a.path) + ' · ' + DS.fmtBytes((a.content || '').length) + '</div><div class="diffbox">' + DS.diff.html('', String(a.content || '').slice(0, 6000), 0) + '</div>';
    else html += '<div class="lbl">arguments</div>' + esc(j(a));
    if (p.result != null) html += '<div class="lbl">result</div>' + esc(typeof p.result === 'string' ? p.result : j(p.result).slice(0, 5000));
    b.innerHTML = html;
  },
  renderAsk(node, p) {
    let box = $('.askc', node); if (!box) { box = el('div', { class: 'askc' }); node.appendChild(box); }
    if (p.ask.answer != null) { box.innerHTML = '<b>' + esc(p.ask.question) + '</b><div class="muted sm" style="margin-top:4px">You: ' + esc(p.ask.answer) + '</div>'; return; }
    if (box._shown) return; box._shown = true; box.innerHTML = '<b></b><div class="opts"></div><div class="row" style="margin-top:8px"><input class="inp" placeholder="Type an answer…"><button class="btn pri">Send</button></div>'; $('b', box).textContent = p.ask.question;
    const send = t => { if (t) DS.agent.answer(p.id, t); }; const o = $('.opts', box); (p.ask.options || []).forEach(x => { const b = el('button', { class: 'btn sm' }); b.textContent = x; b.onclick = () => send(x); o.appendChild(b); });
    const inp = $('input', box); $('.btn.pri', box).onclick = () => send(inp.value.trim()); inp.onkeydown = e => { if (e.key === 'Enter') send(inp.value.trim()); };
  },
  renderFoot(foot, m, th) {
    foot.innerHTML = '<div class="mactions"></div><div class="mmeta"></div>'; const bar = $('.mactions', foot);
    const add = (icon, label, fn) => { const b = el('button', { title: label }, DS.icons[icon] + '<span>' + esc(label) + '</span>'); b.onclick = fn; bar.appendChild(b); };
    const text = m.parts.filter(p => p.type === 'text').map(p => p.text).join('\n\n');
    if (text) add('copy', 'Copy', () => util.copy(text));
    const last = th.messages[th.messages.length - 1] === m; if (last && !DS.agent.isRunning(th)) add('redo', 'Retry', () => this.retry());
    for (const a of DS.kernel.list('messageAction')) { try { if (a.when && !a.when(m)) continue; add(a.icon && DS.icons[a.icon] ? a.icon : 'sparkle', a.label, () => a.run(m, { thread: th, toast: ui.toast })); } catch (_) {} }
    const u = m.meta || {}; const mm = $('.mmeta', foot); mm.textContent = '';
    if (u.provider || u.model || u.route) { const route = u.route || (u.provider === 'sim' ? 'sim' : ''); const chip = el('span', { class: 'mchip', title: 'provider · model · route' + (u.gateway ? ' · gateway ' + u.gateway : '') }); chip.textContent = [u.provider === 'sim' ? 'offline sim' : (u.providerName || u.provider), u.provider === 'sim' ? '' : (u.resolvedModel || u.model), route].filter(Boolean).join(' · '); mm.appendChild(chip); }
    mm.appendChild(document.createTextNode(' ' + [DS.fmtDur((u.endedAt || now()) - (u.startedAt || now())), u.aborted ? 'stopped' : ''].filter(Boolean).join(' · ')));
  },
  retry() {
    const th = Store.activeThread(); if (!th || DS.agent.isRunning(th)) return; let i = th.messages.length - 1; while (i >= 0 && th.messages[i].role !== 'user') i--; if (i < 0) return; const u = th.messages[i]; th.messages.splice(i + 1);
    this.renderAll(); DS.agent.run(th, u.content, { silentUser: true, ctx: u.ctx });
  },
  /* ---------- plan bar ---------- */
  renderPlan() {
    const pb = $('#planbar', this.root); if (!pb) return; const th = Store.activeThread(); const p = th && th.plan; if (!p || !p.steps || !p.steps.length) { pb.innerHTML = ''; return; }
    const done = p.steps.filter(s => s.status === 'done').length; const collapsed = this._planCollapsed != null ? this._planCollapsed : p.status !== 'proposed';
    pb.innerHTML = '<div style="padding:0 10px"><div class="plan" style="max-width:820px;margin:0 auto"><h5 data-t style="cursor:pointer"><span class="grow">Plan · ' + done + '/' + p.steps.length + (p.status === 'proposed' ? ' · awaiting approval' : '') + '</span>' + DS.icons.chev + '</h5><div class="pb"' + (collapsed ? ' style="display:none"' : '') + '>' + (p.goal ? '<div class="sm muted" style="margin-bottom:4px">' + esc(p.goal) + '</div>' : '') + '<ul>' + p.steps.map(s => '<li class="' + s.status + '"><span class="bx">' + (s.status === 'done' ? '✓' : '') + '</span><span>' + esc(s.text) + '</span></li>').join('') + '</ul>' + (p.status === 'proposed' ? '<div class="row" style="margin-top:8px"><button class="btn pri" data-ap>Approve & run</button><button class="btn" data-rj>Dismiss</button></div>' : '') + '</div></div></div>';
    $('[data-t]', pb).onclick = () => { this._planCollapsed = !collapsed; this.renderPlan(); };
    const ap = $('[data-ap]', pb); if (ap) ap.onclick = () => { this._planCollapsed = true; DS.agent.approvePlan(th); this.renderAll(); };
    const rj = $('[data-rj]', pb); if (rj) rj.onclick = () => { th.plan = null; Store.save(); this.renderPlan(); };
  },
  /* ---------- composer ---------- */
  buildComposer() {
    const c = $('#composer', this.root);
    c.innerHTML = '<div class="cmp"><div class="ac" id="ac"></div><div class="cmp-box"><div class="ctxbar" id="ctxbar"></div><textarea id="cmp-ta" rows="1" placeholder="Ask Forge…  ( / commands · @ files )" enterkeyhint="send" autocapitalize="sentences"></textarea><div class="cmp-bar"><button class="cmp-btn" id="cmp-plus" aria-label="Add">' + DS.icons.plusChat.replace('M12 9v6M9 12h6', 'M12 9v6M9 12h6') + '</button><span id="pills" class="row wrap" style="gap:6px"></span><span class="sp"></span><button class="cmp-send" id="cmp-send" aria-label="Send" disabled>' + DS.icons.up + '</button></div></div></div>';
    this.ta = $('#cmp-ta', c); this.sendBtn = $('#cmp-send', c); this.acEl = $('#ac', c);
    const grow = () => { this.ta.style.height = 'auto'; this.ta.style.height = Math.min(200, this.ta.scrollHeight) + 'px'; this.syncSend(); this.autocomplete(); };
    this.ta.addEventListener('input', grow);
    this.ta.addEventListener('keydown', e => {
      if (this.acEl.classList.contains('on')) { if (e.key === 'ArrowDown') { e.preventDefault(); this.acMove(1); return; } if (e.key === 'ArrowUp') { e.preventDefault(); this.acMove(-1); return; } if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) { e.preventDefault(); this.acPick(); return; } if (e.key === 'Escape') { this.acClose(); return; } }
      const es = Store.settings().enterToSend; const desktop = !DS.isNarrow() && !('ontouchstart' in window); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.isComposing) { e.preventDefault(); this.submit(); return; } if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && (es === 'always' || (es !== 'never' && desktop))) { e.preventDefault(); this.submit(); }
    });
    this.sendBtn.onclick = () => { const th = Store.activeThread(); if (th && DS.agent.isRunning(th)) DS.agent.stop(th); else this.submit(); };
    $('#cmp-plus', c).onclick = () => this.plusMenu(); this.renderPills(); this.renderCtx();
  },
  syncSend() { const th = Store.activeThread(); const run = th && DS.agent.isRunning(th); this.sendBtn.classList.toggle('stop', !!run); this.sendBtn.innerHTML = run ? DS.icons.stop : DS.icons.up; this.sendBtn.disabled = !run && !this.ta.value.trim() && !this.ctx.length; this.sendBtn.setAttribute('aria-label', run ? 'Stop' : 'Send'); },
  renderPills() {
    const box = $('#pills', this.root); if (!box) return; box.innerHTML = ''; const tg = Store.state.toggles;
    for (const p of DS.kernel.list('composerPill')) { if (!(p.id in tg)) tg[p.id] = !!p.default; const b = el('button', { class: 'pill' + (tg[p.id] && !p.run ? ' on' : ''), title: p.title || '' }, (p.icon ? DS.icon(p.icon) : '') + esc(p.label)); b.onclick = () => { if (typeof p.run === 'function') { try { p.run(); } catch (e) { DS.kernel.log('error', p.__owner || 'pill', e.message); } return; } tg[p.id] = !tg[p.id]; Store.save(); this.renderPills(); DS.bus.emit('pill:toggle', { id: p.id, on: tg[p.id] }); }; box.appendChild(b); }
  },
  plusMenu() {
    const th = Store.activeThread() || Store.newThread(); const items = DS.kernel.list('composerAction').map(a => ({ icon: a.icon, label: a.label + (a.desc ? ' — ' + a.desc : ''), run: () => a.run(this.cctx()) }));
    if (!items.length) items.push({ icon: 'file', label: 'Nothing here yet — plugins can add actions', run() {} }); ui.menu(items, 'Add to message');
  },
  cctx() { return { thread: Store.activeThread(), addContext: (name, text) => { this.ctx.push({ name, text }); this.renderCtx(); this.syncSend(); }, insert: t => { this.ta.value += (this.ta.value && !/\s$/.test(this.ta.value) ? ' ' : '') + t; this.ta.dispatchEvent(new Event('input')); this.ta.focus(); }, send: t => this.submit(t), reply: md => this.replyLocal(md), focus: () => this.ta.focus() }; },
  renderCtx() { const bar = $('#ctxbar', this.root); bar.innerHTML = ''; this.ctx.forEach((c, i) => { const ch = el('span', { class: 'ctxchip' }, esc(c.name) + '<button aria-label="Remove">' + DS.icons.x + '</button>'); $('button', ch).onclick = () => { this.ctx.splice(i, 1); this.renderCtx(); this.syncSend(); }; bar.appendChild(ch); }); },
  replyLocal(md) { const th = Store.activeThread() || Store.newThread(); const m = { id: uid('m'), role: 'assistant', parts: [{ type: 'text', text: md }], api: [], ts: now(), meta: { startedAt: now(), endedAt: now(), provider: 'local' } }; th.messages.push(m); Store.save(); this.renderAll(); },
  /* ---------- autocomplete (/commands, @mentions) ---------- */
  autocomplete() {
    const v = this.ta.value, pos = this.ta.selectionStart; const before = v.slice(0, pos);
    const cm = before.match(/^\/(\S*)$/); const mm = before.match(/(?:^|\s)@([^\s@]*)$/);
    if (cm) { const q = cm[1].toLowerCase(); const items = DS.kernel.list('command').filter(c => c.name.toLowerCase().startsWith(q)).map(c => ({ label: '/' + c.name, desc: (c.args ? c.args + ' · ' : '') + (c.desc || ''), apply: () => { this.ta.value = '/' + c.name + ' '; this.ta.focus(); this.ta.dispatchEvent(new Event('input')); } })); return this.acOpen(items); }
    if (mm) { const q = mm[1]; const run = async () => { let items = []; for (const p of DS.kernel.list('mention')) { try { const r = await p.search(q); (r || []).slice(0, 8).forEach(it => items.push({ label: it.label, desc: it.desc || it.hint || p.id, apply: () => { const start = pos - mm[1].length - 1; this.ta.value = v.slice(0, start) + (it.attach ? '' : (it.insert || it.label) + ' ') + v.slice(pos); if (it.attach) { Promise.resolve(typeof it.attach.text === 'function' ? it.attach.text() : it.attach.text).then(t => { this.ctx.push({ name: it.attach.name || it.label, text: t }); this.renderCtx(); this.syncSend(); }); } this.ta.focus(); this.ta.dispatchEvent(new Event('input')); } })); } catch (e) { DS.kernel.log('error', p.__owner || 'mention', e.message); } } if (this.ta.value.slice(0, this.ta.selectionStart).match(/(?:^|\s)@([^\s@]*)$/)) this.acOpen(items); }; run(); return; }
    this.acClose();
  },
  acOpen(items) { this.ac.items = items.slice(0, 40); this.ac.idx = 0; if (!items.length) return this.acClose(); this.acEl.innerHTML = ''; this.ac.items.forEach((it, i) => { const r = el('div', { class: 'ac-i' + (i === 0 ? ' sel' : '') }, '<b>' + esc(it.label) + '</b><span>' + esc(it.desc || '') + '</span>'); r.onpointerdown = e => { e.preventDefault(); this.ac.idx = i; this.acPick(); }; this.acEl.appendChild(r); }); this.acEl.classList.add('on'); },
  acClose() { this.acEl.classList.remove('on'); this.ac.items = []; },
  acMove(d) { const n = this.ac.items.length; this.ac.idx = (this.ac.idx + d + n) % n; [...this.acEl.children].forEach((c, i) => c.classList.toggle('sel', i === this.ac.idx)); this.acEl.children[this.ac.idx].scrollIntoView({ block: 'nearest' }); },
  acPick() { const it = this.ac.items[this.ac.idx]; this.acClose(); if (it) it.apply(); },
  /* ---------- submit ---------- */
  async submit(textOverride) {
    const th0 = Store.activeThread(); if (th0 && DS.agent.isRunning(th0)) return;
    const text = (textOverride != null ? textOverride : this.ta.value).trim(); if (!text && !this.ctx.length) return;
    const th = th0 || Store.newThread(); this.acClose();
    const cm = text.match(/^\/(\S+)\s*([\s\S]*)$/);
    if (cm) { const cmd = DS.kernel.list('command').find(c => c.name === cm[1]); if (cmd) { if (textOverride == null) { this.ta.value = ''; this.ta.style.height = 'auto'; } this.syncSend(); try { await cmd.run(cm[2], this.cctx()); } catch (e) { ui.toast('/' + cmd.name + ' failed: ' + e.message, 'err'); DS.kernel.log('error', cmd.__owner || 'command', e.message); } return; } }
    const ctx = this.ctx.length ? this.ctx.map(c => '### Attached: ' + c.name + '\n```\n' + String(c.text).slice(0, 30000) + '\n```').join('\n\n') : undefined;
    if (textOverride == null) { this.ta.value = ''; this.ta.style.height = 'auto'; } this.ctx = []; this.renderCtx(); this.stick = true;
    const p = DS.agent.run(th, text || '(see attached context)', { ctx }); this.renderAll(); this.syncSend(); await p; this.syncSend();
  }
};

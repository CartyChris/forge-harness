/* ═══════════════════════════ GUARD: permission tiers · context taint · approvals · plugin rules ═══════════════════════════ */
const TIERS = {
  readonly:     { id: 'readonly',     label: 'Read-only',    tone: 'ok',   blurb: 'Look, don’t touch. No writes, shell, network or code execution.', matrix: { read: 'allow', write: 'deny', shell: 'deny', net: 'deny', exec: 'deny' } },
  restricted:   { id: 'restricted',   label: 'Restricted',   tone: 'acc',  blurb: 'Edits stay inside the workspace. Shell blocked; network and code runs allowed.', matrix: { read: 'allow', write: 'allow', shell: 'deny', net: 'allow', exec: 'allow' } },
  supervised:   { id: 'supervised',   label: 'Supervised',   tone: 'warn', blurb: 'Edits, shell and network each ask first. Approve once or for the whole thread.', matrix: { read: 'allow', write: 'ask', shell: 'ask', net: 'ask', exec: 'allow' } },
  unrestricted: { id: 'unrestricted', label: 'Full access',  tone: 'err',  blurb: 'No prompts at all. Only for throwaway sandboxes.', matrix: { read: 'allow', write: 'allow', shell: 'allow', net: 'allow', exec: 'allow' } }
};
const Guard = DS.guard = {
  tiers: TIERS, _queue: Promise.resolve(), _openClose: null,
  tier(thread) { const id = (thread && thread.permission) || Store.settings().permission; return TIERS[id] || TIERS.supervised; },
  taint(text) {
    const s = String(text || ''); const rules = [
      { id: 'prompt-injection', re: /ignore (all )?(previous|prior|above) (instructions|prompts?)|disregard (the )?(system|previous)/i, w: 0.9 },
      { id: 'exfil-attempt', re: /(curl|wget)\s+https?:\/\/|send (it|this|the .{0,20}) to https?:/i, w: 0.7 },
      { id: 'credential-harvest', re: /(\.env\b|id_rsa|aws_secret|api[_-]?key|authorization:\s*bearer)/i, w: 0.8 },
      { id: 'destructive', re: /\brm\s+-rf\s+[\/~]|mkfs|dd\s+if=|:\(\)\s*\{|>\s*\/dev\/sd/i, w: 1.0 },
      { id: 'shell-meta', re: /[;&|]{2,}|\$\(|`[^`]+`/, w: 0.45 }];
    const hits = []; let score = 0; for (const r of rules) if (r.re.test(s)) { hits.push(r.id); score = Math.max(score, r.w); }
    return { score, hits, level: score >= 0.8 ? 'high' : score >= 0.45 ? 'medium' : 'low' };
  },
  bump(thread, level) { if (!thread) return; const rank = { low: 0, medium: 1, high: 2 }; if (rank[level] > rank[thread.taint || 'low']) { thread.taint = level; DS.bus.emit('taint:change', thread); } },
  /* → { allowed, reason, cached } */
  async check(action, detail, thread, toolName) {
    const t = this.tier(thread); let rule = t.matrix[action] || 'allow'; let why = '';
    const s = Store.settings();
    if (action === 'shell' && s.taintCheck) { const v = this.taint(detail && detail.cmd); if (v.level === 'high') return { allowed: false, reason: 'taint guard rejected the command (' + v.hits.join(', ') + ')' }; if (v.level === 'medium' && rule === 'allow' && t.id !== 'unrestricted') { rule = 'ask'; why = 'suspicious shell syntax'; } }
    if (thread && s.taintCheck && thread.taint && thread.taint !== 'low' && ['write', 'shell', 'exec'].includes(action) && rule === 'allow' && t.id !== 'unrestricted') { rule = 'ask'; why = 'this thread read untrusted content (taint: ' + thread.taint + ')'; }
    for (const r of DS.kernel.list('guardRule')) {
      try { const res = await r.check({ action, detail, tier: t, thread, tool: toolName }); if (res && res.deny) return { allowed: false, reason: res.deny + ' (rule ' + r.id + ')' }; if (res && res.ask && rule !== 'deny') { rule = 'ask'; why = res.ask; } }
      catch (e) { DS.kernel.log('error', r.__owner || 'guard', 'rule ' + r.id + ' failed: ' + e.message); }
    }
    if (rule === 'deny') return { allowed: false, reason: 'tier “' + t.label + '” forbids ' + action };
    if (rule === 'ask') {
      if (thread && thread.allow && thread.allow[action] && !why) return { allowed: true, cached: true };
      /* optional reviewer (Codex "auto_review"): a plugin may set DS.guard.reviewer = async req → {decision:'allow'|'deny'|'ask', reason}.
         Never consulted for lethal-trifecta / Rule-of-Two asks — those always reach a human. */
      if (this.reviewer && !/trifecta|Rule of Two|quarantine/i.test(why)) {
        try { const rv = await this.reviewer({ action, detail, thread, tool: toolName, tier: t, why });
          if (rv && (rv.decision === 'allow' || rv.decision === 'deny')) { DS.bus.emit('approval:result', { action, tool: toolName, thread, allowed: rv.decision === 'allow', reviewer: true, reason: rv.reason || '' }); DS.kernel.log(rv.decision === 'allow' ? 'info' : 'warn', 'guard', 'auto-review ' + rv.decision + ' ' + (toolName || action) + (rv.reason ? ': ' + rv.reason : '')); return rv.decision === 'allow' ? { allowed: true, reviewed: true, reason: rv.reason || '' } : { allowed: false, reason: 'auto-reviewer denied: ' + (rv.reason || '') }; }
        } catch (e) { DS.kernel.log('error', 'guard', 'reviewer failed: ' + e.message); }
      }
      const r = await this.ask({ action, detail, thread, tool: toolName, tier: t, why });
      DS.bus.emit('approval:result', { action, tool: toolName, thread, allowed: !!r.allow, always: !!r.always, why });
      if (r.allow && r.always && thread && !why) { thread.allow = thread.allow || {}; thread.allow[action] = true; Store.save(); }
      return { allowed: r.allow, reason: r.allow ? '' : 'denied by you' };
    }
    return { allowed: true };
  },
  ask(req) {
    this._queue = this._queue.then(() => new Promise(resolve => {
      let settled = false; const finish = (allow, always, close) => { if (settled) return; settled = true; this._openClose = null; if (close) close(); resolve({ allow, always }); };
      const d = req.detail || {}; const body = el('div');
      const label = { write: 'Edit files', shell: 'Run a command', net: 'Use the network', exec: 'Run code' }[req.action] || req.action;
      let preview = '';
      if (d.preview && d.preview.kind === 'diff') preview = '<div class="diffbox">' + DS.diff.html(d.preview.before || '', d.preview.after || '', 80) + '</div>';
      else if (d.cmd) preview = '<pre class="appr-pre">$ ' + esc(d.cmd) + '</pre>';
      else preview = '<pre class="appr-pre">' + esc(JSON.stringify(d.args || d, null, 2).slice(0, 1400)) + '</pre>';
      body.innerHTML = '<div class="appr-top"><span class="chip warn">' + esc(label) + '</span><span class="muted mono">' + esc(req.tool || '') + '</span></div>' + (d.path ? '<div class="appr-path mono">' + esc(d.path) + '</div>' : '') + preview +
        '<div class="appr-note">Tier <b>' + esc(req.tier.label) + '</b> asks before this action' + (req.why ? ' — <b>' + esc(req.why) + '</b>' : '') + '.</div>';
      const sh = ui.sheet({ title: 'Approval needed', node: body, actions: [
        { label: 'Deny', danger: true, onClick: c => finish(false, false, c) },
        ...(req.why ? [] : [{ label: 'Allow for thread', onClick: c => finish(true, true, c) }]),
        { label: 'Allow once', primary: true, onClick: c => finish(true, false, c) }], onClose: () => finish(false, false, null) });
      this._openClose = () => finish(false, false, sh.close);
      DS.bus.emit('approval:open', req);
    }));
    return this._queue;
  },
  cancelPending() { if (this._openClose) this._openClose(); }
};

/* ═══════════════════════════ BRIDGE CLIENT (WebSocket RPC to the local execution daemon) ═══════════════════════════ */
const Bridge = DS.bridge = {
  ws: null, status: 'offline', info: null, pending: new Map(), _retry: 0,
  validate(url) { const raw = String(url || '').trim(); if (!raw) return { ok: false, reason: 'Enter a ws:// or wss:// endpoint.' }; try { const u = new URL(raw); if (u.protocol !== 'ws:' && u.protocol !== 'wss:') return { ok: false, reason: 'Use ws:// or wss://' }; return { ok: true, url: u.href }; } catch (_) { return { ok: false, reason: 'Not a valid URL.' }; } },
  _b64(str) { try { const bytes = new TextEncoder().encode(String(str || '')); let bin = ''; bytes.forEach(b => { bin += String.fromCharCode(b); }); return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''); } catch (_) { return ''; } },
  setStatus(s, detail) { this.status = s; DS.bus.emit('bridge:status', { status: s, detail }); },
  connect(url, token) {
    const v = this.validate(url || Store.settings().bridgeUrl); if (!v.ok) { this.setStatus('offline', v.reason); return Promise.reject(new Error(v.reason)); }
    const tok = token != null ? token : Store.settings().bridgeToken; this.disconnect(true); this.setStatus('connecting');
    return new Promise((resolve, reject) => {
      let sock; try { sock = new WebSocket(v.url, tok ? ['dsh', 'token.' + this._b64(tok)] : ['dsh']); } catch (e) { this.setStatus('offline', e.message); return reject(e); }
      this.ws = sock; let opened = false;
      const timer = setTimeout(() => { if (!opened) { try { sock.close(); } catch (_) {} this.setStatus('offline', 'timeout'); reject(new Error('handshake timed out')); } }, 5000);
      sock.onopen = async () => { opened = true; clearTimeout(timer); this.setStatus('online'); DS.kernel.log('info', 'bridge', 'connected to ' + v.url); try { this.info = await this.call('ping', {}); DS.bus.emit('bridge:info', this.info); } catch (_) {} resolve(this.info); };
      sock.onmessage = ev => {
        let m; try { m = JSON.parse(ev.data); } catch (_) { return; } const p = this.pending.get(m.id); if (!p) return;
        if (m.event === 'chunk') { if (p.onChunk) try { p.onChunk(m); } catch (_) {} return; }
        this.pending.delete(m.id); clearTimeout(p.timer); if (m.ok) p.resolve(m.result); else p.reject(new Error(m.error || 'bridge error'));
      };
      sock.onclose = () => { clearTimeout(timer); if (this.ws === sock) this.ws = null; for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error('bridge disconnected')); } this.pending.clear(); if (this.status !== 'offline') { this.setStatus('offline'); DS.kernel.log('warn', 'bridge', 'disconnected'); } if (!opened) reject(new Error('could not connect (is the bridge running?)')); };
      sock.onerror = () => {};
    });
  },
  disconnect(silent) { if (this.ws) { const s = this.ws; this.ws = null; try { s.close(); } catch (_) {} } this.setStatus('offline'); if (!silent) ui.toast('Bridge disconnected', 'warn'); },
  call(op, params, opts = {}) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== 1) return reject(new Error('bridge offline'));
      const id = uid('rpc'); const ms = opts.timeout || 130000;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('bridge timeout on "' + op + '"')); }, ms);
      this.pending.set(id, { resolve, reject, timer, onChunk: opts.onChunk });
      this.ws.send(JSON.stringify({ id, op, params: params || {} }));
    });
  },
  get online() { return this.status === 'online' && !!this.ws && this.ws.readyState === 1; },
  script(kind) { const n = document.getElementById(kind === 'python' ? 'bridge-python' : 'bridge-node'); return n ? n.textContent : ''; }
};

/* forge.skills — Agent Skills (SKILL.md) import/export, learned-skill proposals behind a HUMAN gate + canary, AGENTS.md editor. */
DS.plugin({ name: 'forge.skills', title: 'Skills', description: 'Import Agent Skills (SKILL.md: paste, .md, .zip, URL), manage them, approve learned skills through a validation + canary gate, edit AGENTS.md.', version: '1.0.0', tags: ['skills', 'agents', 'learning'], apply(ctx) {
  const U = DS.util, esc = U.esc;
  const SAMPLE = '---\nname: commit-message\ndescription: Write a Conventional Commits message from a diff or a change summary. Use when the user asks for a commit message.\nlicense: MIT\n---\n# Commit messages\n\n1. Look at what changed (use the Changes view or the diff the user gave).\n2. Pick a type: feat, fix, docs, refactor, test, chore.\n3. Subject line: `type(scope): imperative summary`, at most 72 chars, no period.\n4. Body: why the change was made, wrapped at 72 chars.\n5. Add `BREAKING CHANGE:` footer only when behaviour breaks.\n\nSee references/examples.md for examples.\n';
  const SAMPLE_REF = '# Examples\n\n- `feat(skills): import SKILL.md from zip`\n- `fix(guard): ask before shell in read tier`\n';
  const AGENTS_TPL = '# AGENTS.md\n\n## Commands\n- Build: `python3 build.py`\n- Test: `python3 tests/smoke.py <dist html>`\n\n## Code style\n- Plain JS, no imports; plugins only use `DS.*` / `ctx.*`.\n\n## Layout\n- `/apps` generated apps · `/notes` notes · `/skills` imported skills\n\n## Never\n- Never disable guards or auto-approve tool calls.\n- Never send keys or secrets anywhere.\n';
  const CANARY = [
    [/\b(disable|turn\s+off|bypass|skip|ignore|override|circumvent)\b[^.\n]{0,40}\b(guards?|approvals?|permissions?|confirmations?|safety|shield|sandbox|gates?|prompts?)\b/i, 'tries to disable guards/approvals'],
    [/ignore\s+(all\s+|any\s+)?(previous|prior|above|earlier)\s+(instructions|rules|messages)/i, 'prompt-injection phrase'],
    [/\bauto[- ]?approve\b|\bwithout\s+(asking|approval|confirmation|the user knowing)\b/i, 'removes the human from the loop'],
    [/\b(exfiltrat\w*|send|upload|post|leak|forward|email)\b[^\n]{0,60}\b(api[_ -]?keys?|tokens?|secrets?|passwords?|credentials?|cookies?|localStorage|\.env)\b/i, 'exfiltrates secrets'],
    [/\b(curl|wget|fetch|web_fetch)\b[^\n]{0,80}https?:\/\/\S+[^\n]{0,40}\b(key|token|secret|env)\b/i, 'network call carrying secrets'],
    [/\bpermission\s*[:=]\s*['"]?(full|yolo|auto)\b|\btier\s*[:=]\s*['"]?full\b/i, 'escalates permission tier'],
    [/settings\.apiKey|document\.cookie|DS\.guard\s*=|guardRule\s*\(/i, 'touches secrets or guard internals']];
  const get = (k, d) => ctx.data.get(k, d);
  const skills = () => get('skills', {});
  const regs = new Map();
  let viewEl = null, tab = get('tab', 'installed'), viewing = null;
  const rerender = () => { if (viewEl && viewEl._render) viewEl._render(); };

  // ── SKILL.md parsing / validation ──
  function parseYaml(src) {
    const lines = src.split('\n'), meta = {};
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^([A-Za-z0-9_.-]+):\s*(.*)$/); if (!m) continue;
      let [, k, v] = m; v = v.trim();
      const kids = []; while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1].trim() === '')) kids.push(lines[++i]);
      while (kids.length && !kids[kids.length - 1].trim()) kids.pop();
      if (/^[|>][+-]?$/.test(v)) { const ind = Math.min(...kids.filter(l => l.trim()).map(l => l.match(/^\s*/)[0].length)); const body = kids.map(l => l.slice(ind)); meta[k] = v[0] === '|' ? body.join('\n') : body.join(' ').replace(/\s+/g, ' ').trim(); }
      else if (!v && kids.length) { const sub = {}, arr = []; kids.forEach(l => { const t = l.trim(); if (t.startsWith('- ')) arr.push(t.slice(2).replace(/^['"]|['"]$/g, '')); else { const mm = t.match(/^([^:]+):\s*(.*)$/); if (mm) sub[mm[1].trim()] = mm[2].replace(/^['"]|['"]$/g, ''); } }); meta[k] = arr.length ? arr : sub; }
      else meta[k] = /^".*"$/.test(v) ? v.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, '\n') : /^'.*'$/.test(v) ? v.slice(1, -1).replace(/''/g, "'") : v;
    }
    return meta;
  }
  function parseSkill(text) {
    text = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    const m = text.match(/^\s*---\n([\s\S]*?)\n---[ \t]*(?:\n|$)([\s\S]*)$/);
    if (!m) return { error: 'missing YAML frontmatter: SKILL.md must start with --- name/description --- block' };
    const meta = parseYaml(m[1]);
    return { name: String(meta.name || '').trim(), description: String(meta.description || '').trim(), body: m[2].replace(/^\n+/, ''), meta };
  }
  function validate(s) {
    const errors = [], warns = [];
    if (!s.name) errors.push('name is required');
    else { if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s.name)) errors.push('name must be kebab-case (a-z, 0-9, single hyphens)'); if (s.name.length > 64) errors.push('name is longer than 64 chars'); }
    if (!s.description) errors.push('description is required'); else if (s.description.length > 1024) errors.push('description is longer than 1024 chars');
    if (!String(s.body || '').trim()) errors.push('body (instructions) is empty');
    const n = String(s.body || '').split('\n').length; if (n > 500) warns.push('body is ' + n + ' lines (> 500): move detail into references/');
    const extra = Object.keys(s.meta || {}).filter(k => !['name', 'description'].includes(k)); if (extra.length) warns.push('extra keys kept: ' + extra.join(', '));
    const own = regs.has(s.name), clash = DS.kernel.list('skill').some(k => k.id === s.name) && !own;
    if (clash) errors.push('a built-in skill already uses the name "' + s.name + '"');
    return { ok: !errors.length, errors, warns };
  }
  function canary(text) {
    const hits = CANARY.filter(([re]) => re.test(text)).map(([, why]) => why);
    try { const t = DS.guard && DS.guard.taint && DS.guard.taint(text); if (t && t.level === 'high') hits.push('guard taint: high (' + (t.hits || []).slice(0, 3).join(', ') + ')'); } catch (e) {}
    return hits;
  }
  function check(p) { const v = validate(p); const c = canary([p.name, p.description, p.body].join('\n')); return { ok: v.ok && !c.length, errors: v.errors, warns: v.warns, canary: c }; }
  const serialize = s => { const q = v => /[:#\n"']|^\s|\s$/.test(v) ? JSON.stringify(v) : v; let fm = '---\nname: ' + s.name + '\ndescription: ' + q(s.description) + '\n'; for (const [k, v] of Object.entries(s.meta || {})) { if (k === 'name' || k === 'description') continue; if (Array.isArray(v)) fm += k + ':\n' + v.map(x => '  - ' + q(String(x))).join('\n') + '\n'; else if (v && typeof v === 'object') fm += k + ':\n' + Object.entries(v).map(([a, b]) => '  ' + a + ': ' + q(String(b))).join('\n') + '\n'; else fm += k + ': ' + q(String(v)) + '\n'; } return fm + '---\n' + s.body; };

  // ── registry ──
  function instructionsOf(s) { return s.body + (s.refs && s.refs.length ? '\n\n---\nBundled reference files (read them with fs_read only when needed):\n' + s.refs.map(p => '- ' + p).join('\n') : ''); }
  function register(s) {
    unregister(s.name); if (!s.enabled) return;
    try { regs.set(s.name, ctx.skill({ id: s.name, title: (s.meta && s.meta.title) || s.name, description: s.description, instructions: instructionsOf(s) })); } catch (e) { DS.kernel.log('warn', 'forge.skills', 'register ' + s.name + ': ' + e.message); }
  }
  function unregister(name) { const d = regs.get(name); if (d) { try { d(); } catch (e) {} regs.delete(name); } }
  async function install(parsed, refs, source) {
    const v = validate(parsed); if (!v.ok) throw new Error('invalid SKILL.md: ' + v.errors.join('; '));
    const dir = '/skills/' + parsed.name, paths = [];
    try { await DS.fs.write(dir + '/SKILL.md', serialize(parsed)); for (const r of refs || []) { const p = DS.fs.norm(dir + '/' + String(r.path || '').replace(/^\/+/, '')); if (/(^|\/)\.\.(\/|$)/.test(String(r.path || '')) || !p.startsWith(dir + '/')) { DS.kernel.log('warn', 'forge.skills', 'skipped unsafe reference path: ' + String(r.path).slice(0, 120)); continue; } await DS.fs.write(p, r.content); paths.push(p); } } catch (e) { DS.kernel.log('warn', 'forge.skills', 'vfs: ' + e.message); }
    const all = skills(); const s = { name: parsed.name, description: parsed.description, body: parsed.body, meta: parsed.meta || {}, refs: paths, enabled: true, source, importedAt: Date.now(), flags: canary(parsed.body) };
    all[s.name] = s; ctx.data.set('skills', all); register(s); rerender(); DS.bus.emit('sidebar:refresh');
    return { name: s.name, refs: paths, warnings: v.warns, flags: s.flags };
  }
  const importText = (text, source, refs) => { const p = parseSkill(text); if (p.error) throw new Error(p.error); return install(p, refs, source || 'paste'); };
  const importSample = () => importText(SAMPLE, 'sample', [{ path: 'references/examples.md', content: SAMPLE_REF }]);

  // ── ZIP reader (central directory + deflate-raw) ──
  async function unzip(buf) {
    const u8 = new Uint8Array(buf), dv = new DataView(buf), td = new TextDecoder(); let e = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 65535); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error('not a zip file (no end-of-central-directory record)');
    const n = dv.getUint16(e + 10, true); let off = dv.getUint32(e + 16, true); const entries = [];
    for (let k = 0; k < n; k++) {
      if (dv.getUint32(off, true) !== 0x02014b50) throw new Error('corrupt zip central directory');
      const method = dv.getUint16(off + 10, true), csize = dv.getUint32(off + 20, true), fl = dv.getUint16(off + 28, true), xl = dv.getUint16(off + 30, true), cl = dv.getUint16(off + 32, true), lho = dv.getUint32(off + 42, true);
      entries.push({ name: td.decode(u8.subarray(off + 46, off + 46 + fl)), method, csize, lho }); off += 46 + fl + xl + cl;
    }
    async function read(en) {
      const l = en.lho; if (dv.getUint32(l, true) !== 0x04034b50) throw new Error('corrupt zip entry ' + en.name);
      const st = l + 30 + dv.getUint16(l + 26, true) + dv.getUint16(l + 28, true), data = u8.slice(st, st + en.csize);
      if (en.method === 0) return td.decode(data);
      if (en.method !== 8) throw new Error('unsupported zip compression method ' + en.method + ' in ' + en.name);
      if (typeof DecompressionStream === 'undefined') throw new Error('this browser has no DecompressionStream, so deflated zips cannot be read here. Re-zip with "store" (no compression) or paste the SKILL.md text.');
      return await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
    }
    return { entries, read };
  }
  async function importZip(buf, source) {
    const z = await unzip(buf); const roots = z.entries.filter(e => /(^|\/)SKILL\.md$/i.test(e.name)).sort((a, b) => a.name.split('/').length - b.name.split('/').length);
    if (!roots.length) throw new Error('zip contains no SKILL.md');
    const out = [];
    for (const r of roots) {
      const root = r.name.replace(/SKILL\.md$/i, ''); const refs = [];
      for (const en of z.entries) if (en.name.startsWith(root + 'references/') && /\.(md|txt)$/i.test(en.name)) refs.push({ path: en.name.slice(root.length), content: await z.read(en) });
      out.push(await importText(await z.read(r), source || 'zip', refs));
    }
    return out.length === 1 ? out[0] : { imported: out.map(o => o.name), details: out };
  }
  async function importUrl(url) {
    url = String(url || '').trim(); if (!/^https?:\/\//i.test(url)) throw new Error('URL must start with https://');
    const gh = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/); if (gh) url = 'https://raw.githubusercontent.com/' + gh[1] + '/' + gh[2] + '/' + gh[3];
    else if (/^https:\/\/github\.com\/[^/]+\/[^/]+\/tree\//.test(url)) url = url.replace('github.com', 'raw.githubusercontent.com').replace('/tree/', '/') + '/SKILL.md';
    const gw = ctx.service('forge.gateway'); let r;
    try { r = gw && gw.fetch ? await gw.fetch(url, {}) : await fetch(url); }
    catch (e) { throw new Error('could not fetch ' + url + ' (' + e.message + '). From file:// the browser can only read servers that send CORS headers (raw.githubusercontent.com does); otherwise set a gateway in Models, or paste the SKILL.md text.'); }
    if (!r.ok) throw new Error('fetch ' + url + ' → HTTP ' + r.status);
    if (/\.zip(\?|$)/i.test(url)) return importZip(await r.arrayBuffer(), 'url');
    return importText(await r.text(), 'url:' + url);
  }
  async function importFile(file) {
    const buf = await file.arrayBuffer(), u8 = new Uint8Array(buf);
    if (u8[0] === 0x50 && u8[1] === 0x4b) return importZip(buf, 'zip:' + file.name);
    return importText(new TextDecoder().decode(u8), 'file:' + file.name);
  }

  // ── learned skills (proposal → human gate) ──
  const pending = () => get('pending', []);
  const slug = t => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').split('-').slice(0, 5).join('-').slice(0, 50) || 'procedure';
  function propose(p) {
    const q = pending(); if (q.some(x => x.sig === p.sig) || skills()[p.name]) return null;
    p.id = U.uid('ps'); p.ts = Date.now(); q.unshift(p); ctx.data.set('pending', q.slice(0, 30)); rerender(); DS.bus.emit('sidebar:refresh');
    ctx.toast('Skill proposal queued: ' + p.name + ' (needs your approval)', 'ok', 2500); return p;
  }
  function decide(id, decision, reason) {
    const q = pending(), p = q.find(x => x.id === id); if (!p) return { error: 'no such proposal' };
    if (decision === 'approve') { const c = check(p); if (!c.ok) return { error: 'blocked by gate: ' + c.errors.concat(c.canary).join('; ') }; }
    ctx.data.set('pending', q.filter(x => x.id !== id));
    const d = get('decisions', []); d.unshift({ id, name: p.name, decision, reason: reason || '', ts: Date.now() }); ctx.data.set('decisions', d.slice(0, 100));
    if (decision === 'approve') return install({ name: p.name, description: p.description, body: p.body, meta: { origin: 'learned' } }, [], 'learned');
    rerender(); return { rejected: p.name };
  }
  const brief = a => Object.entries(a || {}).map(([k, v]) => k + '=' + (typeof v === 'string' ? (v.length > 40 ? v.slice(0, 40) + '…' : v) : JSON.stringify(v).slice(0, 40))).join(', ');
  ctx.hook('run:end', ({ thread, msg }) => {
    try {
      if (!msg || msg.meta && msg.meta.aborted) return;
      const tools = (msg.parts || []).filter(p => p.type === 'tool'); const real = tools.filter(p => !['use_skill', 'skill_import', 'skill_decide'].includes(p.name));
      if (real.length < 2 || tools.some(p => p.status !== 'ok')) return;
      const i = thread.messages.indexOf(msg); let goal = '';
      for (let j = i - 1; j >= 0; j--) if (thread.messages[j].role === 'user') { goal = String(thread.messages[j].content || '').trim(); break; }
      if (!goal) return;
      const g = goal.length > 160 ? goal.slice(0, 160) + '…' : goal;
      const steps = real.map((p, k) => (k + 1) + '. Call `' + p.name + '`' + (p.args && Object.keys(p.args).length ? ' (' + brief(p.args) + ')' : '') + (p.summary ? ' — expect: ' + String(p.summary).slice(0, 80) : '') + '.');
      propose({ name: 'learned-' + slug(goal), description: 'Learned procedure for requests like: "' + g.replace(/"/g, "'") + '". Use when the user asks for the same kind of task.', body: '# ' + g + '\n\nDistilled from a successful run (' + new Date().toISOString().slice(0, 10) + '). Adapt the arguments to the new request.\n\n## Steps\n' + steps.join('\n') + '\n\n## Checks\n- Verify each tool result before the next step; stop and ask the user if a step fails.\n', sig: real.map(p => p.name).join('>') + '|' + slug(goal), from: { thread: thread.id, tools: real.map(p => p.name) } });
    } catch (e) { DS.kernel.log('warn', 'forge.skills', 'learn: ' + e.message); }
  });

  // ── boot: register persisted skills ──
  Object.values(skills()).forEach(register);
  ctx.effect(() => () => { [...regs.keys()].forEach(unregister); });
  ctx.provide('forge.skills', { parse: parseSkill, validate, canary, check, importText, importUrl, importZip, importSample, list: () => Object.values(skills()), pending, decide, propose, unzip, serialize });

  // ── tools ──
  ctx.tool({ name: 'skill_import', label: 'Import skill', gate: 'write', description: 'Import an Agent Skill (SKILL.md). source="sample" installs the bundled commit-message skill. source="url"/"text" imports from a URL or SKILL.md text, but those go to the Pending queue: the user must approve them in the Skills view.',
    parameters: { type: 'object', properties: { source: { type: 'string', enum: ['sample', 'url', 'text'] }, url: { type: 'string' }, text: { type: 'string' } }, required: ['source'] },
    async run(a) {
      if (a.source === 'sample') return importSample();
      let p;
      if (a.source === 'url') { const gw = ctx.service('forge.gateway'); const r = gw && gw.fetch ? await gw.fetch(a.url, {}) : await fetch(a.url); if (!r.ok) throw new Error('HTTP ' + r.status); p = parseSkill(await r.text()); }
      else p = parseSkill(a.text);
      if (p.error) throw new Error(p.error);
      const q = propose({ name: p.name, description: p.description, body: p.body, sig: 'agent|' + p.name, from: { agent: true, source: a.source } });
      return q ? { pending: q.name, note: 'Queued for human approval in the Skills view; not active yet.' } : { note: 'already pending or installed: ' + p.name };
    }, summarize: (a, r) => r && (r.name ? 'installed ' + r.name : r.pending ? 'pending ' + r.pending : r.note) });

  // ── view ──
  DS.icons.skills = DS.icons.skills || '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5a2 2 0 0 1 2-2h9l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M14 3v5h5"/><path d="M8 13l2 2 4-4"/></svg>';
  ctx.effect(() => { const s = document.createElement('style'); s.textContent = '.sk-v .vscroll{padding:12px 16px 40px;display:flex;flex-direction:column;gap:10px}.sk-v .seg{display:flex;flex-wrap:wrap}.sk-v .seg button{min-height:40px}.sk-card{border:1px solid var(--line);background:var(--card);border-radius:var(--radius);padding:12px;display:flex;flex-direction:column;gap:8px}.sk-card h4{margin:0;font-size:15px;word-break:break-word}.sk-card .ds{color:var(--text-2);font-size:13px;line-height:1.4}.sk-row{display:flex;gap:6px;flex-wrap:wrap;align-items:center}.sk-row .btn{min-height:40px}.sk-pre{white-space:pre-wrap;word-break:break-word;font:12px/1.45 var(--mono);background:var(--code-bg);border:1px solid var(--line);border-radius:8px;padding:10px;max-height:260px;overflow:auto;margin:0}.sk-ta{width:100%;min-height:150px;font:12px/1.45 var(--mono);box-sizing:border-box}.sk-gate{font-size:12px;border-left:3px solid var(--ok);padding:4px 8px;background:var(--bg-2);border-radius:4px}.sk-gate.bad{border-color:var(--danger)}.sk-gate li{margin-left:14px}'; document.head.appendChild(s); return () => s.remove(); });
  const badge = () => { const n = pending().length; return n ? String(n) : ''; };
  async function act(fn, okMsg) { try { const r = await fn(); ctx.toast(typeof okMsg === 'function' ? okMsg(r) : okMsg, 'ok', 2200); rerender(); return r; } catch (e) { ctx.toast(e.message, 'err', 5000); return null; } }
  ctx.view({ id: 'skills', title: 'Skills', icon: 'skills', order: 60, badge,
    mount(el) {
      el.classList.add('sk-v'); viewEl = el;
      el.innerHTML = '<div class="vhead"><h2>Skills</h2></div><div class="vscroll"></div>';
      const sc = el.querySelector('.vscroll');
      el._render = () => {
        const mine = Object.values(skills()), builtin = DS.kernel.list('skill').filter(k => !regs.has(k.id)), q = pending();
        const tabs = [['installed', 'Installed ' + (mine.length + builtin.length)], ['pending', 'Pending ' + q.length], ['import', 'Import'], ['agents', 'AGENTS.md']];
        let h = '<div class="seg">' + tabs.map(([k, l]) => '<button data-tab="' + k + '" class="' + (tab === k ? 'on' : '') + '">' + l + '</button>').join('') + '</div>';
        if (tab === 'installed') {
          h += '<div class="sec-t">Imported &amp; learned</div>' + (mine.length ? '' : '<div class="empty-v muted sm">No imported skills yet. Use Import, or say “import a skill”.</div>');
          for (const s of mine) h += '<div class="sk-card" data-sk="' + esc(s.name) + '"><div class="sk-row"><h4 class="grow">' + esc(s.name) + '</h4><span class="chip ' + (s.enabled ? 'ok' : '') + '">' + (s.enabled ? 'enabled' : 'disabled') + '</span>' + (s.source === 'learned' ? '<span class="chip acc">learned</span>' : '') + ((s.flags || []).length ? '<span class="chip warn" title="' + esc(s.flags.join('; ')) + '">canary ⚠</span>' : '') + '</div><div class="ds">' + esc(s.description) + '</div><div class="xs muted mono">' + esc(String(s.source)) + ((s.refs || []).length ? ' · ' + s.refs.length + ' ref file(s)' : '') + '</div><div class="sk-row"><button class="btn sm" data-a="toggle">' + (s.enabled ? 'Disable' : 'Enable') + '</button><button class="btn sm" data-a="view">' + (viewing === s.name ? 'Hide' : 'View') + '</button><button class="btn sm" data-a="export">Export SKILL.md</button><button class="btn sm danger" data-a="del">Delete</button></div>' + (viewing === s.name ? '<pre class="sk-pre">' + esc(serialize(s)) + '</pre>' : '') + '</div>';
          h += '<div class="sec-t">Built-in</div>';
          for (const k of builtin) h += '<div class="sk-card" data-bi="' + esc(k.id) + '"><div class="sk-row"><h4 class="grow">' + esc(k.id) + '</h4><span class="chip">built-in</span></div><div class="ds">' + esc(k.description || k.title || '') + '</div><div class="sk-row"><button class="btn sm" data-a="bview">' + (viewing === '#' + k.id ? 'Hide' : 'View') + '</button></div>' + (viewing === '#' + k.id ? '<pre class="sk-pre">' + esc(String(k.instructions || '').slice(0, 8000)) + '</pre>' : '') + '</div>';
        } else if (tab === 'pending') {
          h += '<div class="muted sm">Learned skills are never activated automatically. Each proposal must pass validation and the canary (no disabling guards, no exfiltration) and then needs your Approve.</div>';
          if (!q.length) h += '<div class="empty-v muted sm">Nothing pending. Successful runs that use 2+ tools propose a skill here.</div>';
          for (const p of q) { const c = check(p); h += '<div class="sk-card" data-p="' + esc(p.id) + '"><div class="sk-row"><h4 class="grow">' + esc(p.name) + '</h4><span class="chip ' + (c.ok ? 'ok' : 'err') + '">' + (c.ok ? 'gate passed' : 'gate failed') + '</span></div><div class="ds">' + esc(p.description) + '</div><pre class="sk-pre">' + esc(p.body) + '</pre><div class="sk-gate ' + (c.ok ? '' : 'bad') + '"><b>Check</b>: validation ' + (c.errors.length ? 'failed' : 'ok') + ' · canary ' + (c.canary.length ? 'failed' : 'clean') + (c.errors.concat(c.canary).length ? '<ul>' + c.errors.concat(c.canary).map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '') + (c.warns.length ? '<div class="muted">' + esc(c.warns.join(' · ')) + '</div>' : '') + '</div><div class="sk-row"><button class="btn sm pri" data-a="approve" ' + (c.ok ? '' : 'disabled title="blocked by gate"') + '>Approve</button><button class="btn sm" data-a="rename">Rename</button><button class="btn sm danger" data-a="reject">Reject</button></div></div>'; }
          const d = get('decisions', []); if (d.length) h += '<div class="sec-t">Decisions</div>' + d.slice(0, 8).map(x => '<div class="xs mono muted">' + new Date(x.ts).toISOString().slice(0, 16).replace('T', ' ') + ' · ' + esc(x.decision) + ' · ' + esc(x.name) + '</div>').join('');
        } else if (tab === 'import') {
          h += '<div class="sk-card"><h4>Paste SKILL.md</h4><textarea class="inp sk-ta" data-in="paste" placeholder="---\nname: my-skill\ndescription: What it does and when to use it\n---\n# Instructions…"></textarea><div class="sk-row"><button class="btn sm pri" data-a="paste">Import pasted</button><button class="btn sm" data-a="sample">Load sample</button></div></div>';
          h += '<div class="sk-card"><h4>From file</h4><div class="ds">A SKILL.md, or a .zip skill folder (SKILL.md + references/*.md).' + (typeof DecompressionStream === 'undefined' ? ' <b>This browser lacks DecompressionStream: only uncompressed zips work.</b>' : '') + '</div><input type="file" accept=".md,.markdown,.zip,text/markdown,application/zip" data-in="file" class="inp"></div>';
          h += '<div class="sk-card"><h4>From URL</h4><div class="ds">raw.githubusercontent.com and github.com/…/blob/… links work from file:// (CORS-enabled). Other hosts need a gateway.</div><input class="inp" data-in="url" placeholder="https://raw.githubusercontent.com/…/SKILL.md"><div class="sk-row"><button class="btn sm pri" data-a="url">Import URL</button></div></div>';
        } else {
          h += '<div class="sk-card"><h4>/AGENTS.md</h4><div class="ds">Workspace instructions every agent reads. Keep it short and operational.</div><textarea class="inp sk-ta" data-in="agents" style="min-height:260px"></textarea><div class="sk-row"><button class="btn sm pri" data-a="asave">Save</button><button class="btn sm" data-a="atpl">Insert template</button><button class="btn sm" data-a="areload">Reload</button></div></div>';
        }
        sc.innerHTML = h;
        if (tab === 'agents') DS.fs.read('/AGENTS.md').then(f => { const ta = sc.querySelector('[data-in=agents]'); if (ta && !ta.value) ta.value = (f && f.content) || ''; }).catch(() => {});
        const fi = sc.querySelector('[data-in=file]'); if (fi) fi.onchange = () => { const f = fi.files && fi.files[0]; if (f) act(() => importFile(f), r => 'Imported ' + (r.name || (r.imported || []).join(', '))); };
      };
      sc.addEventListener('click', async ev => {
        const t = ev.target.closest('[data-tab]'); if (t) { tab = t.dataset.tab; ctx.data.set('tab', tab); viewing = null; return el._render(); }
        const b = ev.target.closest('[data-a]'); if (!b || b.disabled) return; const a = b.dataset.a;
        const card = b.closest('[data-sk]'), name = card && card.dataset.sk, pc = b.closest('[data-p]');
        if (a === 'toggle') { const all = skills(); all[name].enabled = !all[name].enabled; ctx.data.set('skills', all); register(all[name]); el._render(); }
        else if (a === 'view') { viewing = viewing === name ? null : name; el._render(); }
        else if (a === 'bview') { const id = '#' + b.closest('[data-bi]').dataset.bi; viewing = viewing === id ? null : id; el._render(); }
        else if (a === 'export') U.download(name + '.SKILL.md', serialize(skills()[name]), 'text/markdown');
        else if (a === 'del') { if (!(await DS.ui.confirm('Delete skill “' + name + '”? Its /skills files stay in the VFS.', 'Delete'))) return; const all = skills(); delete all[name]; ctx.data.set('skills', all); unregister(name); el._render(); }
        else if (a === 'approve') act(async () => { const r = await decide(pc.dataset.p, 'approve'); if (r && r.error) throw new Error(r.error); return r; }, r => 'Approved: ' + r.name + ' is now a skill');
        else if (a === 'reject') { decide(pc.dataset.p, 'reject'); ctx.toast('Rejected', 'ok', 1500); el._render(); }
        else if (a === 'rename') { const q = pending(), p = q.find(x => x.id === pc.dataset.p); const v = await DS.ui.promptText('Skill name (kebab-case)', p.name); if (v) { p.name = v.trim(); ctx.data.set('pending', q); el._render(); } }
        else if (a === 'paste') { const ta = sc.querySelector('[data-in=paste]'); act(() => importText(ta.value, 'paste'), r => 'Imported ' + r.name + (r.warnings.length ? ' (' + r.warnings.length + ' warning)' : '')); }
        else if (a === 'sample') { sc.querySelector('[data-in=paste]').value = SAMPLE; }
        else if (a === 'url') act(() => importUrl(sc.querySelector('[data-in=url]').value), r => 'Imported ' + (r.name || (r.imported || []).join(', ')));
        else if (a === 'atpl') { const ta = sc.querySelector('[data-in=agents]'); ta.value = ta.value.trim() ? ta.value.replace(/\s*$/, '\n\n') + AGENTS_TPL.replace(/^# AGENTS\.md\n\n/, '') : AGENTS_TPL; }
        else if (a === 'areload') { const f = await DS.fs.read('/AGENTS.md').catch(() => null); sc.querySelector('[data-in=agents]').value = (f && f.content) || ''; }
        else if (a === 'asave') { const ta = sc.querySelector('[data-in=agents]'); const before = await DS.fs.read('/AGENTS.md').then(f => f && f.content, () => null); const th = DS.store.activeThread(); if (th) try { DS.agent.recordChange(th, '/AGENTS.md', before == null ? null : before); } catch (e) {} await DS.fs.write('/AGENTS.md', ta.value); ctx.toast('Saved /AGENTS.md', 'ok', 1500); }
      });
      el._render();
      return () => { viewEl = null; };
    }, onShow(el) { el._render && el._render(); } });
  if (ctx.rail) ctx.rail({ id: 'skills', icon: 'skills', label: 'Skills', group: 'top', order: 60, run: () => DS.shell.show('skills'), badge });

  // ── commands, intents, suggest ──
  ctx.command({ name: 'skills', desc: 'Open the Skills view (installed, pending approvals, import, AGENTS.md)', run() { DS.shell.show('skills'); } });
  ctx.command({ name: 'skill-import', args: '<url>', desc: 'Import a SKILL.md (or .zip) from a URL', async run(a, c) {
    if (!a.trim()) { tab = 'import'; DS.shell.show('skills'); return; }
    try { const r = await importUrl(a.trim()); c.reply('Imported skill **' + (r.name || (r.imported || []).join(', ')) + '**' + (r.refs && r.refs.length ? ' with ' + r.refs.length + ' reference file(s) in `/skills/' + r.name + '/`' : '') + '. The agent can load it with `use_skill`.'); }
    catch (e) { c.reply('Skill import failed: ' + e.message); } } });
  ctx.intent({ id: 'skills-sample', order: 50, match: t => /\b(import|install|add|load)\b.{0,20}\b(a |the |sample |example )*skill\b/i.test(t) && !/https?:\/\//.test(t),
    script: () => [
      { say: 'Importing the bundled sample Agent Skill (SKILL.md + a reference file).\n\n', tool: { name: 'skill_import', args: { source: 'sample' } } },
      { tool: rs => ({ name: 'use_skill', args: { id: (rs[0] && rs[0].name) || 'commit-message' } }) },
      { final: rs => { const s = rs[1] || {}; return 'Installed **' + ((rs[0] && rs[0].name) || 'commit-message') + '** and loaded it with `use_skill` (progressive disclosure: only its name + description sit in the system prompt until loaded).\n\nFirst lines of the instructions:\n\n> ' + String(s.instructions || '').split('\n').filter(Boolean).slice(0, 3).join('\n> ') + '\n\nManage it in **Skills** (rail) — export, disable, or review learned-skill proposals.'; } }] });
  ctx.intent({ id: 'skills-use', order: 50, match: t => /\b(use|load|apply)\s+(the\s+)?skill\s+[`"']?[a-z0-9][a-z0-9-]*/i.test(t),
    script: t => { const id = t.match(/skill\s+[`"']?([a-z0-9][a-z0-9-]*)/i)[1].toLowerCase(); return [
      { tool: { name: 'use_skill', args: { id } } },
      { final: rs => 'Loaded skill **' + id + '**:\n\n' + String((rs[0] && rs[0].instructions) || '').slice(0, 600) }]; } });
  ctx.suggest({ id: 'skills', emoji: '🧩', title: 'Import a skill', sub: 'SKILL.md + use_skill', prompt: 'Import a sample skill and load it' });
} });

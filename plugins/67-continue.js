/* forge.continue — Continue.dev compatibility: import config.yaml / legacy config.json (models, roles, rules, prompts, MCP servers),
   export Forge → config.yaml (secrets as ${{ secrets.NAME }} placeholders, never real keys), and an IDE autocomplete service.
   HONESTY: written offline. Continue's schema facts come from research/R7_2026-11-08.md §2 (docs.continue.dev reference, v1).
   Continue's free-trial models are GitHub-sign-in, rate-limited and only usable inside Continue's own extension — not an API Forge can call.
   No provider/endpoint is claimed to work; everything imported stays `unverified` until a real call succeeds. */
const CN_PROVIDERS = { /* Continue provider id → Forge catalog provider id (registered by 60/61/63) */
  openai: 'openai-api', ollama: 'ollama', lmstudio: 'lmstudio', groq: 'groq', gemini: 'gemini', mistral: 'mistral', deepseek: 'deepseek',
  openrouter: 'openrouter', together: 'together', cerebras: 'cerebras', huggingface: 'huggingface', 'huggingface-inference-api': 'huggingface',
  xai: 'xai', sambanova: 'sambanova', cohere: 'cohere', 'llama.cpp': 'llamacpp', llamacpp: 'llamacpp', llamafile: 'llamacpp', nvidia: 'nvidia', venice: 'venice'
};
/* providers Forge has no catalog entry for, with a documented OpenAI-compatible base (still unverified from a browser) */
const CN_DEFAULT_BASE = { anthropic: 'https://api.anthropic.com/v1' };
const CN_ROLE_MAP = { chat: 'main', edit: 'coder', apply: 'coder', autocomplete: 'autocomplete', embed: 'embed', summarize: 'fast', rerank: 'rerank' };
const CN_ROLE_LABEL = { main: 'Main chat model', coder: 'Coder (edit / apply)', autocomplete: 'IDE autocomplete', embed: 'Embeddings (brain note)', fast: 'Fast (summarize)', rerank: 'Rerank (not used)' };
const CN_DEFAULT_ROLES = ['chat', 'edit', 'apply', 'summarize'];
const CN_SECRET = /^\$\{\{\s*(secrets|inputs)\.([A-Za-z0-9_\-]+)\s*\}\}$/;
const CN_SAMPLE = `# Continue config.yaml (sample)
name: My Assistant
version: 1.0.0
schema: v1
models:
  - name: Local coder
    provider: openai
    model: qwen2.5-coder-7b
    apiBase: https://llm.example.test/v1
    apiKey: \${{ secrets.LOCAL_LLM_KEY }}
    roles:
      - chat
      - edit
      - autocomplete
  - name: Groq fast
    provider: groq
    model: llama-3.1-8b-instant
    roles: [summarize]
rules:
  - Always write tests for new functions
  - |
    Prefer small, pure functions.
    Explain trade-offs briefly.
prompts:
  - name: review
    description: Review the selected code
    prompt: Review this code for bugs, security issues and readability.
mcpServers:
  - name: docs
    type: streamable-http
    url: https://mcp.example.test/mcp
  - name: filesystem
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "."]
`;

/* ---------------- tiny, safe YAML subset parser ----------------
   Supports: block maps, block sequences (incl. "- key: v" items), plain / single / double-quoted scalars, `|` and `>` block scalars
   (with -/+ chomping), one-line flow sequences/maps ([a, b], {a: 1}), comments, a leading `---`.
   Rejects: anchors (&), aliases (*), tags (!), merge keys (<<), multi-document streams — with a line number. */
function cnYamlError(msg, ln) { const e = new Error('YAML line ' + ln + ': ' + msg); e.yamlLine = ln; return e; }
function cnStripComment(s) {
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '\\' && q === '"') { i++; continue; } if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { if (i === 0 || /[\s\[{,:-]/.test(s[i - 1])) q = c; continue; }
    if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i).replace(/\s+$/, '');
  }
  return s.replace(/\s+$/, '');
}
function cnParseYaml(src) {
  const raw = String(src || '').replace(/\r\n?/g, '\n').replace(/^﻿/, '').split('\n');
  const L = raw.map((r, i) => { if (/\t/.test(r.match(/^\s*/)[0])) throw cnYamlError('tabs are not allowed for indentation', i + 1); const t = cnStripComment(r); return { ln: i + 1, raw: r, ind: t.length - t.replace(/^ +/, '').length, text: t.trim() }; });
  let docs = 0;
  for (const l of L) { if (l.text === '---' || /^---\s/.test(l.text)) { if (++docs > 1) throw cnYamlError('multiple YAML documents are not supported', l.ln); l.text = ''; } else if (l.text === '...') l.text = ''; }
  let pos = 0;
  const skip = () => { while (pos < L.length && !L[pos].text) pos++; };
  const guard = (v, ln) => {
    const s = v.trim();
    if (/^&/.test(s)) throw cnYamlError('YAML anchors (&name) are not supported — expand the anchor and paste again', ln);
    if (/^\*/.test(s)) throw cnYamlError('YAML aliases (*name) are not supported — replace the alias with its value', ln);
    if (/^!/.test(s)) throw cnYamlError('YAML tags (!tag) are not supported — remove the tag', ln);
  };
  function scalar(s, ln) {
    s = s.trim(); guard(s, ln);
    if (s === '' || s === '~' || s === 'null' || s === 'Null' || s === 'NULL') return null;
    if (s[0] === '"') { if (!/"$/.test(s) || s.length < 2) throw cnYamlError('unterminated double-quoted string', ln); try { return JSON.parse(s.replace(/\\x([0-9a-fA-F]{2})/g, '\\u00$1').replace(/\\'/g, "'").replace(/\t/g, '\\t')); } catch (_) { throw cnYamlError('bad escape in double-quoted string', ln); } }
    if (s[0] === "'") { if (!/'$/.test(s) || s.length < 2) throw cnYamlError('unterminated single-quoted string', ln); return s.slice(1, -1).replace(/''/g, "'"); }
    if (s[0] === '[' || s[0] === '{') return flow(s, ln);
    if (/^(true|True|TRUE)$/.test(s)) return true; if (/^(false|False|FALSE)$/.test(s)) return false;
    if (/^[-+]?\d+$/.test(s) && s.length < 16) return parseInt(s, 10);
    if (/^[-+]?(\d+\.\d*|\.\d+|\d+(\.\d*)?[eE][-+]?\d+)$/.test(s)) return parseFloat(s);
    return s;
  }
  function flow(s, ln) { /* one-line flow collections */
    let i = 0;
    const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
    const item = stop => {
      ws(); const c = s[i];
      if (c === '[') { i++; const a = []; ws(); if (s[i] === ']') { i++; return a; } for (;;) { a.push(item(',]')); ws(); if (s[i] === ',') { i++; continue; } if (s[i] === ']') { i++; return a; } throw cnYamlError('bad flow sequence', ln); } }
      if (c === '{') { i++; const o = {}; ws(); if (s[i] === '}') { i++; return o; } for (;;) { const k = item(':,}'); ws(); if (s[i] !== ':') throw cnYamlError('bad flow mapping (expected ":")', ln); i++; const v = item(',}'); if (k === '<<') throw cnYamlError('YAML merge keys (<<) are not supported', ln); o[String(k)] = v; ws(); if (s[i] === ',') { i++; continue; } if (s[i] === '}') { i++; return o; } throw cnYamlError('bad flow mapping', ln); } }
      if (c === '"' || c === "'") { let j = i + 1; while (j < s.length) { if (c === '"' && s[j] === '\\') { j += 2; continue; } if (s[j] === c) { if (c === "'" && s[j + 1] === "'") { j += 2; continue; } break; } j++; } if (j >= s.length) throw cnYamlError('unterminated string in flow collection', ln); const r = scalar(s.slice(i, j + 1), ln); i = j + 1; return r; }
      let j = i; while (j < s.length && !stop.includes(s[j]) && !(s[j] === ':' && stop.includes(':') && /\s|$/.test(s[j + 1] || ''))) j++;
      const tok = s.slice(i, j); i = j; return scalar(tok, ln);
    };
    const v = item(''); ws(); if (i < s.length) throw cnYamlError('unexpected text after flow collection', ln); return v;
  }
  function block(parentInd, header, ln) { /* | or > block scalar; lines more indented than parentInd */
    const m = header.match(/^([|>])([-+]?)(\d?)([-+]?)$/); if (!m) throw cnYamlError('bad block scalar header "' + header + '"', ln);
    const fold = m[1] === '>'; const chomp = m[2] || m[4] || '';
    const lines = []; let ci = m[3] ? parentInd + parseInt(m[3], 10) : -1;
    while (pos < L.length) {
      const r = L[pos].raw; const ind = r.length - r.replace(/^ +/, '').length;
      if (r.trim() === '') { lines.push(''); pos++; continue; }
      if (ind <= parentInd) break;
      if (ci < 0) ci = ind; if (ind < ci) break;
      lines.push(r.slice(ci)); pos++;
    }
    let trail = 0; while (lines.length && lines[lines.length - 1] === '') { lines.pop(); trail++; }
    let out;
    if (!fold) out = lines.join('\n');
    else { out = ''; lines.forEach((l, i) => { const pv = lines[i - 1]; if (i === 0) out = l; else if (l === '') out += '\n'; else if (pv === '') out += l; else if (/^\s/.test(l) || /^\s/.test(pv)) out += '\n' + l; else out += ' ' + l; }); }
    if (chomp === '-') return out; if (chomp === '+') return out + '\n'.repeat(trail + (lines.length ? 1 : 0));
    return lines.length ? out + '\n' : '';
  }
  const KEY = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s"'#\-?:,\[\]{}&*!|>@`][^#]*?|-[^\s][^#]*?)\s*:(?:\s+(.*)|$)$/;
  function value(rest, ind, ln) { /* the text after "key:" or "- " */
    rest = rest.trim();
    if (/^[|>]/.test(rest)) return block(ind, rest, ln);
    if (rest !== '') return scalar(rest, ln);
    skip(); if (pos >= L.length) return null;
    const n = L[pos];
    if (n.ind > ind) return node(n.ind);
    if (n.ind === ind && /^-(\s|$)/.test(n.text)) return seq(ind);
    return null;
  }
  function seq(ind) {
    const a = [];
    for (;;) {
      skip(); if (pos >= L.length) break; const l = L[pos];
      if (l.ind < ind) break; if (l.ind > ind) throw cnYamlError('bad indentation', l.ln);
      if (!/^-(\s|$)/.test(l.text)) break;
      const rest = l.text.slice(1); const lead = rest.length - rest.replace(/^ +/, '').length; const body = rest.trim();
      guard(body, l.ln);
      if (body && KEY.test(body) && !/^["'\[{]/.test(body) || (body && /^["'][^"']*["']\s*:(\s|$)/.test(body))) { L[pos] = { ln: l.ln, raw: ' '.repeat(ind + 1 + lead) + body, ind: ind + 1 + lead, text: body }; a.push(map(ind + 1 + lead)); }
      else { pos++; a.push(value(body, ind, l.ln)); }
    }
    return a;
  }
  function map(ind) {
    const o = {};
    for (;;) {
      skip(); if (pos >= L.length) break; const l = L[pos];
      if (l.ind < ind) break; if (l.ind > ind) throw cnYamlError('bad indentation', l.ln);
      if (/^-(\s|$)/.test(l.text)) break;
      const m = l.text.match(KEY); if (!m) { guard(l.text, l.ln); throw cnYamlError('expected "key: value", got "' + l.text.slice(0, 40) + '"', l.ln); }
      let k = m[1]; if (k[0] === '"' || k[0] === "'") k = scalar(k, l.ln);
      if (k === '<<') throw cnYamlError('YAML merge keys (<<) are not supported — expand them', l.ln);
      guard(String(k), l.ln);
      pos++; o[k] = value(m[2] || '', ind, l.ln);
    }
    return o;
  }
  function node(ind) { skip(); if (pos >= L.length) return null; const l = L[pos]; if (/^-(\s|$)/.test(l.text)) return seq(ind); if (KEY.test(l.text)) return map(ind); pos++; return scalar(l.text, l.ln); }
  skip(); if (pos >= L.length) return null;
  const root = node(L[pos].ind); skip();
  if (pos < L.length) throw cnYamlError('unexpected content (check indentation)', L[pos].ln);
  return root;
}

/* ---------------- YAML emitter (export) ---------------- */
function cnYamlStr(v) { const s = String(v); return /^[A-Za-z0-9_][A-Za-z0-9_ .\/@-]*$/.test(s) && !/^(true|false|null|yes|no|on|off|~|-?\d[\d.eE+-]*)$/i.test(s) && !/\s$/.test(s) && !/: /.test(s) ? s : JSON.stringify(s); }
function cnToYaml(v, ind) {
  ind = ind || 0; const pad = ' '.repeat(ind);
  if (Array.isArray(v)) return v.length ? v.map(x => { if (x && typeof x === 'object' && !Array.isArray(x)) { const inner = cnToYaml(x, ind + 2); return pad + '- ' + inner.slice(ind + 2); } return pad + '- ' + cnScalarOut(x, ind + 2); }).join('\n') : pad + '[]';
  return Object.keys(v).filter(k => v[k] !== undefined).map(k => { const x = v[k]; if (x && typeof x === 'object') return (Array.isArray(x) && !x.length) ? pad + cnYamlStr(k) + ': []' : pad + cnYamlStr(k) + ':\n' + cnToYaml(x, Array.isArray(x) ? ind + 2 : ind + 2); return pad + cnYamlStr(k) + ': ' + cnScalarOut(x, ind + 2); }).join('\n');
}
function cnScalarOut(x, ind) {
  if (x === null || x === undefined) return 'null'; if (typeof x === 'number' || typeof x === 'boolean') return String(x);
  const s = String(x); if (CN_SECRET.test(s)) return s;
  if (/\n/.test(s)) return '|' + (/\n$/.test(s) ? '' : '-') + '\n' + s.replace(/\n$/, '').split('\n').map(l => ' '.repeat(ind) + l).join('\n');
  return cnYamlStr(s);
}

DS.plugin({
  name: 'forge.continue', title: 'Continue.dev compatibility', version: '1.0.0', tags: ['continue', 'import', 'models', 'ide', 'autocomplete'],
  description: 'Import a Continue config.yaml / config.json (models, roles, rules, prompts → slash commands, MCP servers), export Forge → config.yaml with secret placeholders, and an IDE autocomplete service.',
  apply(ctx) {
    const U = DS.util, esc = U.esc;
    const NOTE = 'Continue is an open-source IDE assistant (Apache-2.0). Its free trial models only work inside Continue\'s own extension — Forge can\'t use them. Forge imports your Continue config so the same models/rules/prompts work here.';
    const roles = () => ctx.data.get('roles', {}) || {};
    const prompts = () => ctx.data.get('prompts', []) || [];
    const models = () => ctx.service('forge.models');
    const core = () => ctx.service('forge.providers.core');

    /* ---------- parse + plan ---------- */
    function parse(text) {
      const t = String(text || '').trim(); if (!t) throw new Error('Nothing to import — paste a config.yaml or config.json.');
      let cfg, format = 'yaml';
      if (/^[{\[]/.test(t)) { try { cfg = JSON.parse(t); format = 'json'; } catch (e) { try { cfg = JSON.parse(t.replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1')); format = 'json'; } catch (_) { throw new Error('config.json is not valid JSON: ' + e.message); } } }
      else cfg = cnParseYaml(t);
      if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error('Not a Continue config: expected a mapping with models/rules/prompts/mcpServers.');
      return plan(cfg, format);
    }
    const secretOf = v => { const m = typeof v === 'string' && v.trim().match(CN_SECRET); return m ? m[2] : null; };
    const hostOf = u => { try { return new URL(u).host; } catch (_) { return ''; } };
    function plan(cfg, format) {
      const P = { name: cfg.name || '', format, models: [], rules: [], prompts: [], mcp: [], secrets: [], warnings: [] };
      const addSecret = (n, used) => { let s = P.secrets.find(x => x.name === n); if (!s) P.secrets.push(s = { name: n, usedBy: [] }); if (!s.usedBy.includes(used)) s.usedBy.push(used); };
      let ms = Array.isArray(cfg.models) ? cfg.models.slice() : [];
      if (format === 'json') { /* legacy config.json */
        ms = ms.map(m => Object.assign({}, m, { roles: m.roles || ['chat', 'edit', 'apply'] }));
        const tac = Array.isArray(cfg.tabAutocompleteModel) ? cfg.tabAutocompleteModel : (cfg.tabAutocompleteModel ? [cfg.tabAutocompleteModel] : []);
        tac.forEach(m => ms.push(Object.assign({}, m, { roles: ['autocomplete'] })));
        if (cfg.embeddingsProvider) ms.push(Object.assign({ title: 'Embeddings' }, cfg.embeddingsProvider, { roles: ['embed'] }));
        if (cfg.systemMessage) P.rules.push(String(cfg.systemMessage));
        (cfg.customCommands || []).forEach(c => c && c.name && c.prompt && P.prompts.push({ name: String(c.name), description: String(c.description || ''), prompt: String(c.prompt) }));
        const ex = cfg.experimental && cfg.experimental.modelContextProtocolServers; if (Array.isArray(ex)) ex.forEach((s, i) => { const tr = s.transport || s; cfg.mcpServers = (cfg.mcpServers || []).concat([{ name: s.name || tr.name || ('mcp' + (i + 1)), type: tr.type, url: tr.url, command: tr.command, args: tr.args, env: tr.env }]); });
      }
      ms.forEach((m, i) => {
        if (!m || typeof m !== 'object') return;
        if (m.uses) { P.warnings.push('Model block "' + m.uses + '" comes from Continue Hub — not fetched (offline import). Paste its expanded YAML instead.'); return; }
        const name = String(m.name || m.title || m.model || ('model ' + (i + 1)));
        const provider = String(m.provider || '').toLowerCase(); const model = m.model != null ? String(m.model) : '';
        const apiBase = m.apiBase ? String(m.apiBase).replace(/\/+$/, '') : '';
        const R = (Array.isArray(m.roles) && m.roles.length ? m.roles : CN_DEFAULT_ROLES).map(r => String(r).toLowerCase());
        const rec = { name, provider, model, apiBase, roles: R, keySecret: null, keyLiteral: '', headers: null, tools: (m.capabilities || []).includes('tool_use') ? 'native' : 'prompt', target: null };
        const sec = secretOf(m.apiKey);
        if (sec) { rec.keySecret = sec; addSecret(sec, name); } else if (m.apiKey && /\$\{\{/.test(String(m.apiKey))) P.warnings.push(name + ': apiKey uses an unsupported template — you will be asked for the key.'), rec.keySecret = name.toUpperCase().replace(/[^A-Z0-9]+/g, '_') + '_KEY', addSecret(rec.keySecret, name);
        else if (m.apiKey) rec.keyLiteral = String(m.apiKey);
        const hd = m.requestOptions && m.requestOptions.headers; if (hd && typeof hd === 'object') { rec.headers = {}; for (const k of Object.keys(hd)) { const s2 = secretOf(hd[k]); rec.headers[k] = s2 ? { secret: s2 } : String(hd[k]); if (s2) addSecret(s2, name + ' header ' + k); } }
        if (provider === 'free-trial' || provider === 'continue-proxy') rec.target = { kind: 'skip', why: 'Continue\'s ' + provider + ' models only work inside Continue\'s extension (GitHub sign-in). Forge can\'t use them.' };
        else if (!model) rec.target = { kind: 'skip', why: 'no model id' };
        else {
          const pid = CN_PROVIDERS[provider]; const c = core(); const spec = pid && c && c.spec ? c.spec(pid) : null;
          const sameBase = !apiBase || (spec && (hostOf(spec.base || spec.endpoint || '') === hostOf(apiBase)));
          if (pid && spec && sameBase) rec.target = { kind: 'catalog', pid };
          else if (apiBase || CN_DEFAULT_BASE[provider]) rec.target = { kind: 'custom', base: apiBase || CN_DEFAULT_BASE[provider], note: apiBase ? '' : 'default base for ' + provider + ' (unverified from a browser)' };
          else if (pid) rec.target = { kind: 'skip', why: 'Forge provider "' + pid + '" is not loaded' };
          else rec.target = { kind: 'skip', why: 'provider "' + provider + '" has no OpenAI-compatible endpoint Forge knows — add apiBase' };
        }
        P.models.push(rec);
      });
      (Array.isArray(cfg.rules) ? cfg.rules : (cfg.rules ? [cfg.rules] : [])).forEach(r => {
        if (typeof r === 'string') { if (r.trim()) P.rules.push(r.replace(/\s+$/, '')); }
        else if (r && typeof r === 'object') { if (r.uses) P.warnings.push('Rule block "' + r.uses + '" not fetched (Hub/file reference).'); else if (r.rule) P.rules.push((r.name ? r.name + ': ' : '') + String(r.rule).replace(/\s+$/, '')); }
      });
      (Array.isArray(cfg.prompts) ? cfg.prompts : []).forEach(p => {
        if (!p || typeof p !== 'object') return; if (p.uses) { P.warnings.push('Prompt block "' + p.uses + '" not fetched.'); return; }
        const n = String(p.name || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, ''); if (!n || !p.prompt) return;
        P.prompts.push({ name: n, description: String(p.description || ''), prompt: String(p.prompt) });
      });
      (Array.isArray(cfg.mcpServers) ? cfg.mcpServers : []).forEach((s, i) => {
        if (!s || typeof s !== 'object') return; if (s.uses) { P.warnings.push('MCP block "' + s.uses + '" not fetched.'); return; }
        const name = String(s.name || ('mcp' + (i + 1))).replace(/[^A-Za-z0-9_-]+/g, '-');
        if (s.url) { const headers = {}; const ro = s.requestOptions && s.requestOptions.headers; if (ro) for (const k of Object.keys(ro)) { const s2 = secretOf(ro[k]); headers[k] = s2 ? { secret: s2 } : String(ro[k]); if (s2) addSecret(s2, 'MCP ' + name); } P.mcp.push({ name, kind: 'http', url: String(s.url), type: s.type || 'http', headers }); }
        else if (s.command) P.mcp.push({ name, kind: 'stdio', command: String(s.command), args: (s.args || []).map(String), env: s.env || null });
      });
      return P;
    }

    /* ---------- apply ---------- */
    async function askSecrets(P) {
      const vals = {};
      for (const s of P.secrets) {
        const v = await DS.ui.promptText('Value for secret ' + s.name + ' (used by ' + s.usedBy.join(', ') + ') — leave empty to skip', '', 'paste the key / token');
        if (v && v.trim() && !CN_SECRET.test(v.trim())) vals[s.name] = v.trim();
      }
      return vals;
    }
    const resolveHeaders = (h, vals) => { if (!h) return null; const o = {}; for (const k of Object.keys(h)) { const v = h[k]; if (v && typeof v === 'object') { if (vals[v.secret]) o[k] = vals[v.secret]; } else o[k] = v; } return o; };
    async function applyPlan(P, opt) {
      opt = opt || {}; const out = { models: [], roles: {}, rules: 0, prompts: [], mcp: [], errors: [] };
      const vals = opt.secrets || await askSecrets(P);
      const M = models(); const C = core();
      const R = Object.assign({}, roles());
      const assigned = {};
      for (const m of P.models) {
        if (!m.target || m.target.kind === 'skip') continue;
        const key = m.keySecret ? (vals[m.keySecret] || '') : m.keyLiteral;
        try {
          let pid;
          if (m.target.kind === 'catalog') { pid = m.target.pid; if (key && C) C.setKey(pid, key); }
          else { if (!M || !M.custom) throw new Error('forge.models.custom is not available'); const hd = resolveHeaders(m.headers, vals); pid = M.custom.add({ name: 'Continue · ' + m.name, base: m.target.base, key, headers: hd && Object.keys(hd).length ? hd : '', defaultModel: m.model, tools: m.tools, stream: true }); }
          m.pid = pid; out.models.push({ name: m.name, provider: pid, model: m.model, key: key ? 'set' : (m.keySecret ? 'skipped' : 'none') });
          for (const r of m.roles) { const fr = CN_ROLE_MAP[r]; if (!fr || assigned[fr]) continue; assigned[fr] = true; R[fr] = { provider: pid, model: m.model, from: m.name }; }
        } catch (e) { out.errors.push(m.name + ': ' + e.message); }
      }
      ctx.data.set('roles', R); out.roles = R;
      if (assigned.main && opt.switchMain !== false && M && M.select) { try { M.select(R.main.provider, R.main.model); } catch (e) { out.errors.push('select main: ' + e.message); } }
      const ag = ctx.service('forge.agents');
      if (ag) for (const fr of Object.keys(assigned).filter(k => k === 'coder' || k === 'fast')) {  /* only roles that are also subagent roles */ const fn = ['setRole', 'setRoleModel', 'assignRole'].find(f => typeof ag[f] === 'function'); if (fn) { try { ag[fn](fr, { provider: R[fr].provider, model: R[fr].model, from: 'continue' }); } catch (e) { out.errors.push('forge.agents.' + fn + ': ' + e.message); } } }
      if (P.rules.length) { try { await writeRules(P.rules); ctx.data.set('rules', P.rules.slice()); out.rules = P.rules.length; } catch (e) { out.errors.push('AGENTS.md: ' + e.message); } }
      if (P.prompts.length) { const cur = prompts().filter(p => !P.prompts.some(q => q.name === p.name)); ctx.data.set('prompts', cur.concat(P.prompts)); registerPrompts(); out.prompts = P.prompts.map(p => cmdName(p.name)); }
      for (const s of P.mcp) {
        if (s.kind === 'http') {
          const cfg = { name: s.name, url: s.url, headers: resolveHeaders(s.headers, vals) || {} };
          const st = DS.store.settings(); st.mcp = (st.mcp || []).filter(x => x.name !== s.name).concat([cfg]); DS.store.save && DS.store.save();
          const p = DS.mcp && DS.mcp.connect ? DS.mcp.connect(cfg, ctx).then(srv => ({ name: s.name, status: srv.status, err: srv.err })).catch(e => ({ name: s.name, status: 'error', err: e.message })) : Promise.resolve({ name: s.name, status: 'error', err: 'DS.mcp unavailable' });
          out.mcp.push(opt.waitMcp ? await p : { name: s.name, status: 'connecting' }); if (!opt.waitMcp) p.then(r => ctx.toast('MCP ' + r.name + ': ' + r.status + (r.err ? ' — ' + r.err : ''), r.status === 'ready' ? 'ok' : 'warn', 4000));
        } else {
          const up = DS.bridge && /online|connected|ready|open/.test(String(DS.bridge.status || ''));
          if (up && DS.mcp) { const srv = await DS.mcp.connect({ name: s.name, transport: 'stdio', command: s.command, args: s.args }, ctx).catch(e => ({ status: 'error', err: e.message })); out.mcp.push({ name: s.name, status: srv.status, err: srv.err, via: 'bridge' }); }
          else out.mcp.push({ name: s.name, status: 'needs the local bridge', command: s.command + ' ' + s.args.join(' ') });
        }
      }
      ctx.data.set('last', { ts: Date.now(), name: P.name, models: out.models.length, rules: out.rules, prompts: out.prompts.length, mcp: out.mcp.length, errors: out.errors.slice(0, 6) });
      ctx.emit('continue:applied', out); DS.bus.emit('status:refresh');
      return out;
    }
    const RULES_H = '## Rules (from Continue)';
    async function writeRules(rules) {
      let cur = ''; try { cur = (await DS.fs.read('/AGENTS.md')).content || ''; } catch (_) {}
      const i = cur.indexOf(RULES_H);
      if (i >= 0) { const rest = cur.slice(i + RULES_H.length); const j = rest.search(/\n## /); cur = cur.slice(0, i).replace(/\s+$/, '') + (j >= 0 ? '\n\n' + rest.slice(j + 1) : ''); }
      const body = rules.map(r => '- ' + String(r).trim().split('\n').join('\n  ')).join('\n');
      const next = (cur.replace(/\s+$/, '') ? cur.replace(/\s+$/, '') + '\n\n' : '# AGENTS.md\n\n') + RULES_H + '\n\n' + body + '\n';
      await DS.fs.write('/AGENTS.md', next); return next;
    }

    /* ---------- prompts → slash commands ---------- */
    let promptUndo = [];
    const cmdName = n => { const taken = DS.kernel.list('command').some(c => c.name === n && !c.__cnPrompt); return taken ? 'c-' + n : n; };
    function registerPrompts() {
      promptUndo.forEach(d => { try { d(); } catch (_) {} }); promptUndo = [];
      for (const p of prompts()) {
        const spec = { name: cmdName(p.name), args: '[text]', desc: (p.description || 'Continue prompt') + ' · from Continue', run(arg, c) { c.send(p.prompt + (arg && arg.trim() ? '\n\n' + arg.trim() : '')); } };
        Object.defineProperty(spec, '__cnPrompt', { value: true });
        const d = ctx.command(spec); if (typeof d === 'function') promptUndo.push(d);
      }
    }
    ctx.effect(() => () => promptUndo.forEach(d => { try { d(); } catch (_) {} }));
    registerPrompts();

    /* ---------- export ---------- */
    const secretName = pid => String(pid).replace(/^custom:/, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_') + '_API_KEY';
    function exportYaml() {
      const M = models(); const C = core(); const R = roles(); const seen = new Map();
      const add = (pid, model, role) => {
        if (!pid || pid === 'sim' || !model) return; const k = pid + '|' + model;
        let e = seen.get(k);
        if (!e) {
          const spec = C && C.spec ? C.spec(pid) : null; const inv = Object.keys(CN_PROVIDERS).find(x => CN_PROVIDERS[x] === pid);
          e = { name: (spec && spec.name ? spec.name : pid) + ' · ' + model, provider: inv || 'openai', model, roles: [] };
          if (!inv || (spec && spec.custom)) { const b = spec && (spec.base || String(spec.endpoint || '').replace(/\/chat\/completions$/, '')); if (b) e.apiBase = b; }
          if (spec && !spec.keyless) e.apiKey = '${{ secrets.' + secretName(pid) + ' }}';
          seen.set(k, e);
        }
        if (role && !e.roles.includes(role)) e.roles.push(role);
      };
      let id = null; try { id = M && M.identity ? M.identity() : null; } catch (_) {}
      if (id && id.provider && id.provider !== 'sim') add(id.provider, id.model, 'chat');
      const inv = { main: ['chat'], coder: ['edit', 'apply'], autocomplete: ['autocomplete'], embed: ['embed'], fast: ['summarize'], rerank: ['rerank'] };
      for (const fr of Object.keys(R)) if (R[fr] && R[fr].provider) inv[fr].forEach(r => add(R[fr].provider, R[fr].model, r));
      if (M && M.custom) M.custom.list().forEach(c => add('custom:' + c.id, c.defaultModel, null));
      const ms = [...seen.values()].map(e => { if (!e.roles.length) delete e.roles; return e; });
      const doc = { name: 'Forge export', version: '1.0.0', schema: 'v1', models: ms };
      const rl = ctx.data.get('rules', []) || []; if (rl.length) doc.rules = rl;
      if (prompts().length) doc.prompts = prompts().map(p => ({ name: p.name, description: p.description || undefined, prompt: p.prompt }));
      const mcp = []; try { (DS.mcp && DS.mcp.servers ? [...DS.mcp.servers.values()] : []).forEach(s => { if (s.cfg && s.cfg.url) mcp.push({ name: s.cfg.name, type: 'streamable-http', url: s.cfg.url }); else if (s.cfg && s.cfg.command) mcp.push({ name: s.cfg.name, command: s.cfg.command, args: s.cfg.args || [] }); }); } catch (_) {}
      if (mcp.length) doc.mcpServers = mcp;
      return '# Exported from Forge — keys are ${{ secrets.NAME }} placeholders; add the real values in Continue (never exported).\n' + cnToYaml(doc) + '\n';
    }

    /* ---------- IDE autocomplete ---------- */
    function cleanCompletion(t, prefix, suffix) {
      let s = String(t || '');
      const f = s.match(/```[^\n`]*\n([\s\S]*?)(```|$)/); if (f) s = f[1];
      s = s.replace(/^```[^\n]*\n?/, '').replace(/\n?```\s*$/, '');
      s = s.replace(/<\/?(CURSOR|PREFIX|SUFFIX|FILL|MIDDLE)\/?>/gi, '');
      const lastLine = String(prefix || '').split('\n').pop();
      if (lastLine.trim().length > 3 && s.startsWith(lastLine)) s = s.slice(lastLine.length);
      const sf = String(suffix || ''); const firstSuf = sf.split('\n').find(l => l.trim()) || '';
      if (firstSuf.trim().length > 3) { const k = s.indexOf(firstSuf.trim()); if (k > 0) s = s.slice(0, k).replace(/\s+$/, ''); }
      return s.slice(0, 900);
    }
    async function complete(o) {
      o = o || {}; const r = roles().autocomplete; const C = core();
      if (!r || !r.provider) throw new Error('No autocomplete model — import a Continue config with an "autocomplete" role, or set one in Settings → Continue.dev.');
      if (!C || !C.streamFor) throw new Error('forge.providers.core is not available');
      const prefix = String(o.prefix || '').slice(-4000), suffix = String(o.suffix || '').slice(0, 1500);
      const messages = [
        { role: 'system', content: 'You are a code completion engine (fill-in-the-middle). Output ONLY the code that belongs at <CURSOR/>. No explanations, no markdown fences, never repeat the prefix or the suffix. Keep it short (at most ~200 tokens).' },
        { role: 'user', content: 'Language: ' + (o.lang || 'text') + '\n<PREFIX>' + prefix + '</PREFIX><CURSOR/><SUFFIX>' + suffix + '</SUFFIX>' }
      ];
      const ac = new AbortController(); let text = '', capped = false;
      const fwd = () => ac.abort(); if (o.signal) { if (o.signal.aborted) return ''; o.signal.addEventListener('abort', fwd, { once: true }); }
      try {
        const res = await C.streamFor(r.provider, { quiet: true, messages, tools: [], signal: ac.signal, temperature: 0.2, forceModel: r.model, onDelta: d => { if (d && d.content) { text += d.content; if (text.length > 800 && !capped) { capped = true; ac.abort(); } } } });
        text = (res && res.content) || text;
      } catch (e) { if (!(e && e.name === 'AbortError' && capped)) { if (o.signal && o.signal.aborted) return ''; throw e; } }
      finally { if (o.signal) o.signal.removeEventListener('abort', fwd); }
      return cleanCompletion(text, prefix, suffix);
    }
    function autocompleter(opt) { /* debounced, self-cancelling: request() resolves to the text, or null when superseded */
      const delay = (opt && opt.delay) || 350; let timer = null, ac = null, pendingRes = null;
      const cancel = () => { if (timer) clearTimeout(timer); timer = null; if (ac) ac.abort(); ac = null; if (pendingRes) { pendingRes(null); pendingRes = null; } };
      return { cancel, request(args) { cancel(); return new Promise(res => { pendingRes = res; timer = setTimeout(async () => { timer = null; ac = new AbortController(); const mine = ac; try { const t = await complete(Object.assign({}, args, { signal: mine.signal })); if (pendingRes === res) { pendingRes = null; res(mine.signal.aborted ? null : t); } } catch (e) { if (pendingRes === res) { pendingRes = null; res(null); } ctx.log('warn', 'autocomplete: ' + e.message); } }, delay); }); } };
    }
    function debounce(fn, ms) { let t = null; return function () { const a = arguments, self = this; clearTimeout(t); t = setTimeout(() => fn.apply(self, a), ms || 300); }; }

    /* ---------- UI ---------- */
    const CSS = '.cn-wrap{display:flex;flex-direction:column;gap:10px;min-width:0}.cn-note{font-size:13px;color:var(--text-2);background:var(--card-2);border:1px solid var(--line);border-radius:10px;padding:10px;line-height:1.45}.cn-row{display:flex;flex-wrap:wrap;gap:8px}.cn-row .btn{min-height:40px}.cn-ta{width:100%;min-height:180px;box-sizing:border-box;font-family:var(--mono,ui-monospace,monospace);font-size:12px}.cn-sec{border:1px solid var(--line);border-radius:10px;padding:8px 10px;min-width:0}.cn-sec h4{margin:0 0 6px;font-size:13px}.cn-li{font-size:12.5px;padding:4px 0;border-top:1px solid var(--line);overflow-wrap:anywhere;word-break:break-word}.cn-li:first-of-type{border-top:0}.cn-tag{display:inline-block;font-size:11px;padding:1px 6px;border-radius:6px;border:1px solid var(--line-2);margin-left:4px;color:var(--muted)}.cn-tag.warn{color:var(--warn);border-color:var(--warn)}.cn-tag.ok{color:var(--ok);border-color:var(--ok)}.cn-tbl{width:100%;border-collapse:collapse;font-size:12.5px;table-layout:fixed}.cn-tbl td{padding:5px 4px;border-top:1px solid var(--line);overflow-wrap:anywhere;word-break:break-word;vertical-align:top}.cn-err{color:var(--danger);font-size:13px;overflow-wrap:anywhere}.cn-chk{display:flex;gap:8px;align-items:center;font-size:13px;min-height:40px}';
    if (!document.getElementById('cn-css')) { const st = document.createElement('style'); st.id = 'cn-css'; st.textContent = CSS; document.head.appendChild(st); ctx.effect(() => () => st.remove()); }

    function previewNode(P) {
      const box = U.el('div', { class: 'cn-wrap' });
      const sec = (title, items) => '<div class="cn-sec"><h4>' + esc(title) + ' <span class="cn-tag">' + items.length + '</span></h4>' + (items.length ? items.map(x => '<div class="cn-li">' + x + '</div>').join('') : '<div class="cn-li muted">none</div>') + '</div>';
      const tgt = m => m.target.kind === 'catalog' ? 'Forge provider <b>' + esc(m.target.pid) + '</b>' + (m.keySecret ? ' · key from secret <code>' + esc(m.keySecret) + '</code>' : m.keyLiteral ? ' · key from config' : '') : m.target.kind === 'custom' ? 'new custom endpoint <code>' + esc(m.target.base) + '</code> <span class="cn-tag warn">unverified</span>' + (m.target.note ? ' ' + esc(m.target.note) : '') + (m.keySecret ? ' · key from secret <code>' + esc(m.keySecret) + '</code>' : '') : '<span class="cn-tag warn">skipped</span> ' + esc(m.target.why);
      let h = '<div class="cn-note">' + esc(NOTE) + '</div>';
      h += sec('Models', P.models.map(m => '<b>' + esc(m.name) + '</b> — <code>' + esc(m.provider + '/' + m.model) + '</code><br>→ ' + tgt(m) + '<br><span class="muted">roles: ' + esc(m.roles.map(r => r + (CN_ROLE_MAP[r] ? '→' + CN_ROLE_MAP[r] : '')).join(', ')) + '</span>'));
      h += sec('Secrets to enter', P.secrets.map(s => '<code>' + esc(s.name) + '</code> <span class="muted">for ' + esc(s.usedBy.join(', ')) + ' — you will be asked; placeholders are never stored as keys</span>'));
      h += sec('Rules → /AGENTS.md “Rules (from Continue)”', P.rules.map(r => esc(r.length > 220 ? r.slice(0, 220) + '…' : r).replace(/\n/g, '<br>')));
      h += sec('Prompts → slash commands', P.prompts.map(p => '<b>/' + esc(cmdName(p.name)) + '</b> ' + esc(p.description || '') + '<br><span class="muted">' + esc(p.prompt.slice(0, 160)) + '</span>'));
      h += sec('MCP servers', P.mcp.map(s => s.kind === 'http' ? '<b>' + esc(s.name) + '</b> <code>' + esc(s.url) + '</code> → connect over HTTP' : '<b>' + esc(s.name) + '</b> <code>' + esc(s.command + ' ' + s.args.join(' ')) + '</code> <span class="cn-tag warn">needs the local bridge</span>'));
      if (P.warnings.length) h += sec('Warnings', P.warnings.map(w => esc(w)));
      h += '<label class="cn-chk"><input type="checkbox" data-cn="switch" checked> Use the chat model as my main model</label>';
      box.innerHTML = h; return box;
    }
    function openPreview(P) {
      const node = previewNode(P);
      const sh = DS.ui.sheet({ title: 'Import Continue config' + (P.name ? ' — ' + P.name : ''), node, full: true, actions: [{ label: 'Cancel' }, { label: 'Apply', primary: true, onClick: async close => {
        const sw = node.querySelector('[data-cn=switch]'); close();
        try { const r = await applyPlan(P, { switchMain: sw ? sw.checked : true }); ctx.toast('Continue import: ' + r.models.length + ' model(s), ' + r.rules + ' rule(s), ' + r.prompts.length + ' prompt(s), ' + r.mcp.length + ' MCP' + (r.errors.length ? ' · ' + r.errors.length + ' error(s)' : ''), r.errors.length ? 'warn' : 'ok', 5000); }
        catch (e) { ctx.toast('Import failed: ' + e.message, 'err', 6000); }
      } }] });
      sh.el.setAttribute('data-cn-preview', '1'); return sh;
    }
    function openImport(prefill) {
      const box = U.el('div', { class: 'cn-wrap' });
      box.innerHTML = '<div class="cn-note">' + esc(NOTE) + '</div><textarea class="inp cn-ta" data-cn="src" spellcheck="false" autocapitalize="off" placeholder="Paste ~/.continue/config.yaml (or legacy config.json)"></textarea><div class="cn-err" data-cn="err" role="alert"></div><div class="cn-row"><button class="btn" data-cn="file">Pick file…</button><button class="btn" data-cn="sample">Load sample</button></div>';
      const ta = box.querySelector('[data-cn=src]'); const err = box.querySelector('[data-cn=err]'); if (prefill) ta.value = prefill;
      box.querySelector('[data-cn=sample]').onclick = () => { ta.value = CN_SAMPLE; err.textContent = ''; };
      box.querySelector('[data-cn=file]').onclick = () => { const f = U.el('input', { type: 'file', accept: '.yaml,.yml,.json,text/yaml,application/json,text/plain' }); f.onchange = async () => { try { ta.value = await f.files[0].text(); err.textContent = ''; } catch (e) { err.textContent = e.message; } }; f.click(); };
      const sh = DS.ui.sheet({ title: 'Import Continue config', node: box, full: true, actions: [{ label: 'Cancel' }, { label: 'Preview', primary: true, onClick: close => { try { const P = parse(ta.value); close(); openPreview(P); } catch (e) { err.textContent = e.message; } } }] });
      sh.el.setAttribute('data-cn-import', '1'); return sh;
    }
    function renderSettings(el) {
      const R = roles(); const last = ctx.data.get('last', null);
      const rows = Object.keys(CN_ROLE_LABEL).map(fr => '<tr><td>' + esc(CN_ROLE_LABEL[fr]) + '</td><td>' + (R[fr] ? '<code>' + esc(R[fr].provider + ' / ' + R[fr].model) + '</code>' + (R[fr].from ? ' <span class="muted">(' + esc(R[fr].from) + ')</span>' : '') + (fr === 'embed' ? '<br><span class="muted">Recorded only — Forge\'s brain uses its own local embeddings.</span>' : '') : '<span class="muted">—</span>') + '</td><td style="width:64px">' + (R[fr] ? '<button class="btn sm" data-cnclr="' + esc(fr) + '">Clear</button>' : '') + '</td></tr>').join('');
      el.innerHTML = '<div class="cn-wrap"><div class="cn-note">' + esc(NOTE) + '</div><div class="cn-row"><button class="btn pri" data-cn="imp">Import config…</button><button class="btn" data-cn="exp">Export config.yaml</button><button class="btn" data-cn="copy">Copy export</button></div>' +
        '<div class="cn-sec"><h4>Role mapping</h4><table class="cn-tbl"><tbody>' + rows + '</tbody></table></div>' +
        '<div class="cn-sec"><h4>Imported prompts <span class="cn-tag">' + prompts().length + '</span></h4>' + (prompts().length ? prompts().map(p => '<div class="cn-li"><b>/' + esc(cmdName(p.name)) + '</b> ' + esc(p.description || '') + '</div>').join('') : '<div class="cn-li muted">none</div>') + '</div>' +
        (last ? '<div class="sm muted">Last import ' + esc(new Date(last.ts).toLocaleString()) + ': ' + last.models + ' models, ' + last.rules + ' rules, ' + last.prompts + ' prompts, ' + last.mcp + ' MCP' + (last.errors && last.errors.length ? ' · errors: ' + esc(last.errors.join('; ')) : '') + '</div>' : '') + '</div>';
      el.querySelector('[data-cn=imp]').onclick = () => openImport();
      el.querySelector('[data-cn=exp]').onclick = () => U.download('config.yaml', exportYaml(), 'text/yaml');
      el.querySelector('[data-cn=copy]').onclick = async () => { try { await navigator.clipboard.writeText(exportYaml()); ctx.toast('Copied config.yaml (keys are placeholders)', 'ok'); } catch (_) { ctx.toast('Clipboard unavailable — use Export', 'warn'); } };
      el.querySelectorAll('[data-cnclr]').forEach(b => b.onclick = () => { const r2 = roles(); delete r2[b.dataset.cnclr]; ctx.data.set('roles', r2); renderSettings(el); });
    }
    ctx.settings({ id: 'continue', title: 'Continue.dev', order: 72, render: renderSettings });
    ctx.command({ name: 'continue', args: '[import|export]', desc: 'Import / export a Continue.dev config', run(a, c) { const s = (a || '').trim(); if (/^exp/i.test(s)) { c.reply('```yaml\n' + exportYaml() + '```\nKeys are `${{ secrets.NAME }}` placeholders — real keys are never exported.'); return; } openImport(); } });

    /* ---------- Sim + suggest ---------- */
    ctx.intent({ id: 'continue-import', order: 45, match: t => /\bcontinue(\.dev)?\b[^\n]{0,30}\b(config|yaml|setup|settings)\b|\bimport\b[^\n]{0,20}\bcontinue\b/i.test(t),
      script: () => [{ final: () => { setTimeout(() => openImport(), 30); return 'Opened **Import Continue config**. Paste your `~/.continue/config.yaml` (or legacy `config.json`), or tap **Load sample**, then **Preview → Apply**.\n\n- models → Forge providers (unknown `apiBase` → a custom endpoint, tagged *unverified*)\n- `${{ secrets.X }}` → I ask you for the value (placeholders are never stored)\n- roles → main / Coder / IDE autocomplete / Fast\n- rules → `/AGENTS.md`, prompts → `/slash` commands, MCP http servers → connected (stdio ones need the local bridge)\n\n' + NOTE; } }] });
    ctx.suggest({ id: 'continue-import', emoji: '🔁', title: 'Import my Continue config', sub: 'Models, rules, prompts, MCP', prompt: 'Import my Continue config' });

    ctx.provide('forge.continue', {
      parse, parseYaml: cnParseYaml, toYaml: cnToYaml, plan, apply: applyPlan, importText: async (text, opt) => applyPlan(parse(text), opt),
      exportYaml, roles: () => JSON.parse(JSON.stringify(roles())), setRole: (fr, v) => { const r = roles(); if (v) r[fr] = v; else delete r[fr]; ctx.data.set('roles', r); return r; },
      prompts: () => prompts().map(p => Object.assign({}, p)), complete, autocompleter, debounce, clean: cleanCompletion,
      openImport, openPreview, writeRules, note: NOTE, sample: CN_SAMPLE
    });
  }
});

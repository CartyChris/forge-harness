/* Forge — Ecosystem (A5): SDK reference, Plugin Lab, catalog of example plugins, themes, skills.
   Headline: "anything can be a plugin". */

const ECO_EXAMPLES = {
  tool: "ctx.tool({ name: 'shout', description: 'Uppercase some text', gate: 'none',\n  parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },\n  run: ({ text }) => ({ result: String(text).toUpperCase() + '!' }) });",
  command: "ctx.command({ name: 'hello', desc: 'Say hello', run(arg, c) { c.reply('Hello **' + (arg || 'world') + '** 👋'); } });",
  view: "ctx.view({ id: 'hello-view', title: 'Hello', icon: 'sparkle', order: 90,\n  mount(el) { el.innerHTML = '<div class=\"vhead\"><h2>Hello</h2></div><div class=\"vscroll\"><p>Hi from a view!</p></div>'; } });",
  fence: "ctx.fence({ langs: ['upper'], render(el, code) { el.style.cssText = 'padding:10px;font-weight:700'; el.textContent = code.toUpperCase(); } });",
  theme: "ctx.theme({ id: 'mint', label: 'Mint', dark: true, vars: { '--bg': '#0d1a16', '--surface': '#12241e', '--card': '#173029', '--accent': '#3ee6a8', '--text': '#e6fff6' } });",
  statusItem: "ctx.status({ id: 'clock', align: 'right', text: () => new Date().toLocaleTimeString().slice(0, 5) });\nctx.setInterval(() => DS.emit('status:refresh'), 30000);",
  composerAction: "ctx.composerAction({ id: 'stamp', icon: 'clip', label: 'Insert date', run(c) { c.insert(new Date().toDateString()); } });",
  composerPill: "ctx.pill({ id: 'concise', label: 'Concise', default: false, title: 'Ask for short answers' });\nctx.prompt({ id: 'concise-p', build: () => DS.store.state.toggles.concise ? 'Answer in at most 3 sentences.' : '' });",
  mention: "ctx.mention({ id: 'emoji', search: q => ['tada', 'rocket', 'fire'].filter(x => x.includes(q)).map(x => ({ label: x, insert: ':' + x + ':' })) });",
  messageAction: "ctx.messageAction({ id: 'count', icon: 'atom', label: 'Count words', run(msg, h) { h.toast(String(msg.content || '').split(/\\s+/).filter(Boolean).length + ' words'); } });",
  settings: "ctx.settings({ id: 'hello-set', title: 'Hello settings', render(el) { el.innerHTML = '<div class=\"field\"><label>Greeting</label><input class=\"inp\" value=\"' + ctx.data.get('g', 'Hi') + '\"></div>'; el.querySelector('input').oninput = e => ctx.data.set('g', e.target.value); } });",
  sidebarSection: "ctx.sidebar({ id: 'quote', title: 'Quote', render(el) { el.innerHTML = '<div class=\"sm muted\" style=\"padding:6px 12px\">Make it work, make it right, make it fast.</div>'; } });",
  guardRule: "ctx.guardRule({ id: 'no-secrets', check({ detail }) { if (/\\.env$/.test((detail && detail.path) || '')) return { deny: '.env files are off limits' }; } });",
  hook: "ctx.hook('user:message', m => ctx.log('info', 'user said: ' + String(m && (m.text || m.content) || '').slice(0, 40)));",
  provider: "ctx.provider({ id: 'echo', label: 'Echo model', models: ['echo-1'], available: () => true,\n  async stream({ messages, onDelta }) { const last = messages[messages.length - 1]; const t = 'You said: ' + (typeof last.content === 'string' ? last.content : '…'); onDelta && onDelta({ content: t }); return { content: t, toolCalls: [], usage: { input: 1, output: 1 } }; } });",
  profile: "ctx.profile({ id: 'pirate', label: 'Pirate', system: 'You are a helpful assistant who talks like a pirate.' });",
  skill: "ctx.skill({ id: 'haiku', title: 'Haiku writer', description: 'Write answers as haiku', instructions: 'Answer in a 5-7-5 haiku. No preamble.' });",
  shortcut: "ctx.shortcut({ keys: 'mod+shift+h', desc: 'Say hi', run: () => ctx.toast('Hi from a shortcut!', 'ok') });",
  systemPrompt: "ctx.prompt({ id: 'tz', build: () => 'The user\\'s local time is ' + new Date().toString() });",
  previewer: "ctx.previewer({ id: 'csv', match: p => /\\.csv$/.test(p), render(el, { content }) { el.innerHTML = '<table class=\"mono xs\">' + content.split('\\n').map(r => '<tr>' + r.split(',').map(c => '<td style=\"padding:2px 6px\">' + DS.util.esc(c) + '</td>').join('') + '</tr>').join('') + '</table>'; } });",
  intent: "ctx.intent({ id: 'coin', order: 50, match: t => /flip a coin/i.test(t), script: () => [{ final: Math.random() < .5 ? '🪙 Heads!' : '🪙 Tails!' }] });",
  suggestion: "ctx.suggest({ id: 'coin-s', emoji: '🪙', title: 'Flip a coin', sub: 'demo suggestion', prompt: 'flip a coin' });",
  threadAction: "ctx.threadAction({ id: 'msgcount', icon: 'atom', label: 'Count messages', run(t) { ctx.toast(t.messages.length + ' messages', 'ok'); } });",
  catalogEntry: "ctx.catalog({ id: 'user.hello-cat', title: 'Hello (catalog demo)', description: 'Adds /hi', tags: ['demo'],\n  source: '/* @plugin {\"name\":\"user.hello-cat\",\"title\":\"Hello cat\"} */\\nctx.command({ name: \"hi\", desc: \"hi\", run: (a, c) => c.reply(\"hi!\") });' });"
};

const ecoSrc = (name, title, desc, body) => '/* @plugin ' + JSON.stringify({ name, title, description: desc, version: '1.0.0' }) + ' */\n' + body.trim() + '\n';

const ECO_CATALOG = [
  ['cat.pomodoro', 'Pomodoro timer', '25-minute focus timer in the status bar. /pomo start|stop', ['productivity'], `
let end = 0;
const left = () => Math.max(0, end - Date.now());
const fmt = ms => Math.floor(ms / 60000) + ':' + String(Math.floor(ms / 1000) % 60).padStart(2, '0');
ctx.status({ id: 'pomo', align: 'right', text: () => end ? '🍅 ' + fmt(left()) : '', onClick: () => { end = 0; ctx.toast('Pomodoro stopped'); } });
ctx.setInterval(() => { if (!end) return; if (left() <= 0) { end = 0; ctx.toast('🍅 Pomodoro done — take a break!', 'ok', 6000); } DS.emit('status:refresh'); }, 1000);
ctx.command({ name: 'pomo', args: 'start [min] | stop', desc: 'Pomodoro timer', run(a, c) {
  const [cmd, m] = (a || 'start').trim().split(/\\s+/);
  if (cmd === 'stop') { end = 0; c.reply('Pomodoro stopped.'); }
  else { const min = +m || 25; end = Date.now() + min * 60000; c.reply('🍅 Focus for **' + min + ' min**. Timer is in the status bar.'); }
  DS.emit('status:refresh');
} });`],
  ['cat.wordcount', 'Word counter', 'Live word/char count of the composer in the status bar.', ['writing'], `
const get = () => { const t = document.querySelector('textarea'); return t ? t.value : ''; };
ctx.status({ id: 'wc', align: 'left', text: () => { const v = get(); return v ? v.trim().split(/\\s+/).filter(Boolean).length + 'w · ' + v.length + 'c' : ''; } });
const on = e => { if (e.target && e.target.tagName === 'TEXTAREA') DS.emit('status:refresh'); };
document.addEventListener('input', on);
ctx.effect(() => () => document.removeEventListener('input', on));`],
  ['cat.notes', 'Quick notes', 'A persistent scratchpad view (saved per plugin).', ['productivity', 'view'], `
ctx.view({ id: 'notes', title: 'Notes', icon: 'edit', order: 95, mount(el) {
  el.innerHTML = '<div class="vhead"><h2>Quick notes</h2></div><div class="vscroll"><textarea class="inp" style="width:100%;min-height:60vh;font-family:var(--mono)"></textarea><div class="xs muted" style="margin-top:6px">Saved automatically.</div></div>';
  const ta = el.querySelector('textarea'); ta.value = ctx.data.get('text', '');
  ta.oninput = () => ctx.data.set('text', ta.value);
} });
ctx.command({ name: 'note', args: '<text>', desc: 'Append a quick note', run(a, c) { ctx.data.set('text', (ctx.data.get('text', '') + '\\n- ' + a).trim()); c.reply('📝 Noted.'); } });`],
  ['cat.snippets', 'Snippet expander', 'Composer action that inserts saved snippets.', ['writing'], `
const defs = { sig: 'Best,\\nChris', lgtm: 'LGTM — ship it 🚢', todo: '- [ ] ', bug: '**Steps:**\\n1. \\n**Expected:**\\n**Actual:**' };
ctx.composerAction({ id: 'snip', icon: 'clip', label: 'Snippet…', desc: 'Insert a saved snippet', run(c) {
  DS.ui.menu(Object.keys(defs).map(k => ({ label: k, onClick: () => c.insert(defs[k]) })), 'Snippets');
} });
ctx.mention({ id: 'snip', search: q => Object.keys(defs).filter(k => k.includes(q)).map(k => ({ label: 'snip:' + k, desc: defs[k].slice(0, 30), insert: defs[k] })) });`],
  ['cat.jsonfmt', 'JSON formatter', 'Pretty-prints and validates ```json fences, plus a json_format tool.', ['dev', 'fence'], `
ctx.fence({ langs: ['json', 'jsonc'], render(el, code, { closed }) {
  if (!closed) { el.textContent = code; return; }
  try { const v = JSON.parse(code); el.innerHTML = '<div class="xs" style="color:var(--ok);padding:4px 8px">✓ valid JSON · ' + (Array.isArray(v) ? v.length + ' items' : Object.keys(v || {}).length + ' keys') + '</div><pre class="mono xs" style="padding:8px;margin:0;overflow:auto">' + DS.util.esc(JSON.stringify(v, null, 2)) + '</pre>'; }
  catch (e) { el.innerHTML = '<div class="xs" style="color:var(--danger);padding:4px 8px">✗ ' + DS.util.esc(e.message) + '</div><pre class="mono xs" style="padding:8px;margin:0">' + DS.util.esc(code) + '</pre>'; }
} });
ctx.tool({ name: 'json_format', description: 'Validate and pretty-print JSON', gate: 'none', parameters: { type: 'object', properties: { json: { type: 'string' } }, required: ['json'] },
  run: ({ json }) => { try { return { ok: true, pretty: JSON.stringify(JSON.parse(json), null, 2) }; } catch (e) { return { ok: false, error: e.message }; } } });`],
  ['cat.safety', 'Safety rules', 'Guard rule that blocks rm -rf / and curl|sh in shell commands.', ['security'], `
const bad = [[/rm\\s+-[a-z]*r[a-z]*f?[a-z]*\\s+(\\/|~)(\\s|$)/i, 'recursive delete of / or ~'], [/(curl|wget)[^|]*\\|\\s*(sudo\\s+)?(ba|z)?sh/i, 'piping a download into a shell'], [/:\\(\\)\\s*\\{\\s*:\\|:&\\s*\\}/, 'fork bomb']];
ctx.guardRule({ id: 'safety', check({ detail, args }) {
  const cmd = String((detail && detail.cmd) || (args && (args.cmd || args.command)) || '');
  for (const [re, why] of bad) if (re.test(cmd)) return { deny: 'Safety rules: ' + why };
} });
ctx.tool({ name: 'safety_check', description: 'Check whether a shell command would be blocked by the safety rules', gate: 'none', parameters: { type: 'object', properties: { cmd: { type: 'string' } }, required: ['cmd'] },
  run: ({ cmd }) => { const hit = bad.find(([re]) => re.test(cmd)); return hit ? { blocked: true, why: hit[1] } : { blocked: false }; } });`],
  ['cat.dice', 'Dice & random', 'roll_dice tool (2d6+3 notation) + /roll and /pick.', ['fun'], `
const roll = n => { const m = String(n || '1d6').match(/(\\d*)d(\\d+)([+-]\\d+)?/i); if (!m) throw new Error('Use NdM+K'); const c = Math.min(+m[1] || 1, 100), s = +m[2], k = +(m[3] || 0); const r = Array.from({ length: c }, () => 1 + Math.floor(Math.random() * s)); return { rolls: r, modifier: k, total: r.reduce((a, b) => a + b, 0) + k }; };
ctx.tool({ name: 'roll_dice', description: 'Roll dice in NdM+K notation', gate: 'none', parameters: { type: 'object', properties: { notation: { type: 'string' } }, required: ['notation'] }, run: ({ notation }) => roll(notation), summarize: (a, r) => a.notation + ' → ' + (r && r.total) });
ctx.command({ name: 'roll', args: '[2d6+1]', desc: 'Roll dice', run(a, c) { const r = roll(a.trim() || '1d6'); c.reply('🎲 ' + r.rolls.join(' + ') + (r.modifier ? ' ' + (r.modifier > 0 ? '+' : '') + r.modifier : '') + ' = **' + r.total + '**'); } });
ctx.command({ name: 'pick', args: 'a, b, c', desc: 'Pick one at random', run(a, c) { const xs = a.split(',').map(s => s.trim()).filter(Boolean); c.reply(xs.length ? '👉 **' + xs[Math.floor(Math.random() * xs.length)] + '**' : 'Give me options: /pick tea, coffee'); } });
ctx.intent({ id: 'dice', order: 50, match: t => /\\broll\\b.*\\bd\\d+/i.test(t), script: t => [{ tool: { name: 'roll_dice', args: { notation: (t.match(/\\d*d\\d+([+-]\\d+)?/i) || ['1d6'])[0] } } }, { final: r => '🎲 You rolled **' + r[0].total + '** (' + r[0].rolls.join(', ') + ').' }] });`],
  ['cat.convert', 'Unit converter', 'convert_units tool: length, mass, temperature, volume, data.', ['tools'], `
const U = { m: 1, km: 1000, cm: .01, mm: .001, mi: 1609.344, ft: .3048, in: .0254, yd: .9144, kg: 1, g: .001, lb: .45359237, oz: .028349523, l: 1, ml: .001, gal: 3.785411784, cup: .2365882365, b: 1, kb: 1024, mb: 1048576, gb: 1073741824 };
const G = [['m', 'km', 'cm', 'mm', 'mi', 'ft', 'in', 'yd'], ['kg', 'g', 'lb', 'oz'], ['l', 'ml', 'gal', 'cup'], ['b', 'kb', 'mb', 'gb']];
const T = { c: v => v, f: v => (v - 32) * 5 / 9, k: v => v - 273.15 }, Ti = { c: v => v, f: v => v * 9 / 5 + 32, k: v => v + 273.15 };
const conv = (v, a, b) => { a = a.toLowerCase(); b = b.toLowerCase(); if (T[a] && Ti[b]) return Ti[b](T[a](v)); if (!G.some(g => g.includes(a) && g.includes(b))) throw new Error('Cannot convert ' + a + ' to ' + b); return v * U[a] / U[b]; };
ctx.tool({ name: 'convert_units', description: 'Convert a value between units (m km cm mm mi ft in yd kg g lb oz l ml gal cup b kb mb gb c f k)', gate: 'none',
  parameters: { type: 'object', properties: { value: { type: 'number' }, from: { type: 'string' }, to: { type: 'string' } }, required: ['value', 'from', 'to'] },
  run: ({ value, from, to }) => ({ value, from, to, result: +conv(+value, from, to).toPrecision(8) }), summarize: (a, r) => a.value + ' ' + a.from + ' = ' + (r && r.result) + ' ' + a.to });
ctx.command({ name: 'convert', args: '10 km mi', desc: 'Convert units', run(a, c) { const [v, f, t] = a.trim().replace(/\\bto\\b/, '').split(/\\s+/).filter(Boolean); try { c.reply(v + ' ' + f + ' = **' + +conv(+v, f, t).toPrecision(8) + ' ' + t + '**'); } catch (e) { c.reply('⚠️ ' + e.message); } } });`],
  ['cat.focus', 'Daily focus', "A sidebar section with today's single most important task.", ['productivity'], `
const key = () => 'focus-' + new Date().toDateString();
ctx.sidebar({ id: 'focus', title: 'Today\\'s focus', render(el) {
  el.innerHTML = '<div style="padding:4px 12px 10px"><input class="inp" placeholder="One thing that matters today…" style="width:100%"></div>';
  const i = el.querySelector('input'); i.value = ctx.data.get(key(), ''); i.onchange = () => { ctx.data.set(key(), i.value); ctx.toast('Focus set 🎯', 'ok'); };
} });
ctx.prompt({ id: 'focus-p', build: () => { const f = ctx.data.get(key(), ''); return f ? 'The user\\'s focus for today: ' + f : ''; } });`],
  ['cat.checklist', 'Checklist tracker', 'Renders - [ ] lists in ```checklist fences with live progress, and a Checklists view.', ['productivity', 'fence'], `
const state = () => ctx.data.get('ticks', {});
const draw = (el, code, closed) => {
  const items = code.split('\\n').map(l => l.match(/^\\s*[-*]\\s*\\[( |x)\\]\\s*(.*)/i)).filter(Boolean);
  const h = DS.hash(code), st = state(); const done = items.filter((m, i) => st[h + i] != null ? st[h + i] : m[1] !== ' ');
  el.innerHTML = '<div style="padding:8px 10px"><div class="xs muted">' + done.length + '/' + items.length + ' done</div><div style="height:4px;background:var(--line);border-radius:2px;margin:4px 0 8px"><div style="height:4px;border-radius:2px;background:var(--accent);width:' + (items.length ? 100 * done.length / items.length : 0) + '%"></div></div>' + items.map((m, i) => '<label class="row" style="gap:8px;min-height:32px"><input type="checkbox" data-i="' + i + '"' + (done.includes(m) ? ' checked' : '') + '> <span>' + DS.util.esc(m[2]) + '</span></label>').join('') + '</div>';
  if (closed) el.querySelectorAll('input').forEach(cb => cb.onchange = () => { const s = state(); s[h + cb.dataset.i] = cb.checked; ctx.data.set('ticks', s); draw(el, code, closed); });
};
ctx.fence({ langs: ['checklist', 'todo'], render: (el, code, { closed }) => draw(el, code, closed) });`],
  ['cat.palette', 'Color palettes', 'palette tool (harmonies from a base color) + ```palette swatch fence.', ['design', 'fence'], `
const hsl = (h, s, l) => { s /= 100; l /= 100; const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l), f = n => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)); return '#' + [f(0), f(8), f(4)].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join(''); };
const toH = hex => { const n = parseInt(hex.replace('#', ''), 16), r = (n >> 16) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0; if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return (h * 60 + 360) % 360; };
const make = (base, kind) => { const h = toH(base); const offs = { analogous: [-30, -15, 0, 15, 30], triadic: [0, 120, 240, 60, 180], complementary: [0, 180, 20, 200, 0] }[kind] || [0, 0, 0, 0, 0]; return offs.map((o, i) => hsl((h + o + 360) % 360, 65, kind === 'mono' ? 20 + i * 15 : 45 + (i % 2) * 15)); };
ctx.tool({ name: 'palette', description: 'Generate a 5-color palette from a base hex color. kind: analogous|triadic|complementary|mono', gate: 'none',
  parameters: { type: 'object', properties: { base: { type: 'string' }, kind: { type: 'string' } }, required: ['base'] },
  run: ({ base, kind }) => ({ colors: make(base, kind || 'analogous') }), inline(part, el) { const c = (part.result && part.result.colors) || []; el.innerHTML = c.map(x => '<span title="' + x + '" style="display:inline-block;width:36px;height:36px;border-radius:8px;margin:2px;background:' + x + '"></span>').join(''); } });
ctx.fence({ langs: ['palette'], render(el, code) { const cs = code.match(/#[0-9a-f]{3,8}\\b/gi) || []; el.innerHTML = '<div class="row wrap" style="gap:6px;padding:8px">' + cs.map(x => '<div style="text-align:center"><div style="width:52px;height:52px;border-radius:10px;background:' + x + ';border:1px solid var(--line)"></div><div class="mono xs">' + x + '</div></div>').join('') + '</div>'; } });`],
  ['cat.cliphist', 'Clipboard history', 'Message action to copy a reply into a history you can re-insert from the composer.', ['writing'], `
ctx.messageAction({ id: 'clip', icon: 'copy', label: 'Copy to history', run(msg, h) {
  const t = String(msg.content || ''); DS.util.copy(t); const l = ctx.data.get('h', []); l.unshift(t.slice(0, 4000)); ctx.data.set('h', l.slice(0, 20)); h.toast('Copied (' + l.length + ' in history)', 'ok');
} });
ctx.composerAction({ id: 'cliph', icon: 'copy', label: 'Clipboard history', run(c) {
  const l = ctx.data.get('h', []); if (!l.length) return ctx.toast('History is empty — use “Copy to history” on a message');
  DS.ui.menu(l.map(t => ({ label: t.replace(/\\s+/g, ' ').slice(0, 60), onClick: () => c.insert(t) })), 'Clipboard history');
} });`],
  ['cat.readtime', 'Reading time', 'Message action showing word count and reading time.', ['writing'], `
ctx.messageAction({ id: 'rt', icon: 'atom', label: 'Reading time', run(msg, h) {
  const w = String(msg.content || '').split(/\\s+/).filter(Boolean).length; const m = Math.max(1, Math.round(w / 230));
  h.toast('📖 ' + w + ' words · ~' + m + ' min read', 'ok', 4000);
} });`],
  ['cat.cost', 'Cost estimator', 'Status item estimating thread cost from token usage.', ['dev'], `
const rate = () => ctx.data.get('rate', { in: 3, out: 15 });
ctx.status({ id: 'cost', align: 'right', text() {
  const t = ctx.thread(); const u = (t && t.usage) || {}; const i = u.input || u.in || 0, o = u.output || u.out || 0; if (!i && !o) return '';
  return '$' + ((i * rate().in + o * rate().out) / 1e6).toFixed(4);
}, onClick: () => ctx.toast('Rates: $' + rate().in + '/M in, $' + rate().out + '/M out. Change with /rate 3 15') });
ctx.command({ name: 'rate', args: '<in> <out>', desc: 'Set $/M token rates for the cost estimator', run(a, c) { const [i, o] = a.trim().split(/\\s+/).map(Number); if (!(i >= 0 && o >= 0)) return c.reply('Usage: /rate 3 15'); ctx.data.set('rate', { in: i, out: o }); DS.emit('status:refresh'); c.reply('Rates set: $' + i + '/M in, $' + o + '/M out.'); } });`]
];

const ECO_THEMES = [
  ['matrix', 'Matrix', true, '#020a04', '#05140a', '#0a1f10', '#00ff66', '#b8ffcc', '#4d8a5c'],
  ['solarized', 'Solarized Dark', true, '#002b36', '#073642', '#0b3d4a', '#2aa198', '#eee8d5', '#839496'],
  ['dracula', 'Dracula', true, '#21222c', '#282a36', '#303241', '#bd93f9', '#f8f8f2', '#8a8fb0'],
  ['nord', 'Nord', true, '#2e3440', '#3b4252', '#434c5e', '#88c0d0', '#eceff4', '#9aa5b8'],
  ['sunset', 'Sunset', true, '#1a0f1f', '#26152b', '#311c37', '#ff7a59', '#ffe9df', '#b08a9a'],
  ['hicontrast', 'High Contrast', true, '#000000', '#0a0a0a', '#141414', '#ffd400', '#ffffff', '#cfcfcf'],
  ['ink', 'Ink (light)', false, '#fbfaf7', '#ffffff', '#f2f0ea', '#1f4fd1', '#15171a', '#5f6670'],
  ['rose', 'Rose (light)', false, '#fff7f8', '#ffffff', '#fdecef', '#d6336c', '#2a1a1f', '#8c6a73']
];
const ecoMix = (a, b, t) => { const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); const x = p(a), y = p(b); return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join(''); };
const ecoVars = (bg, surface, card, accent, text, muted, dark) => ({
  '--bg': bg, '--bg-2': ecoMix(bg, surface, .5), '--surface': surface, '--card': card, '--card-2': ecoMix(card, text, .06),
  '--text': text, '--text-2': ecoMix(text, muted, .45), '--muted': muted, '--line': ecoMix(card, text, .14), '--line-2': ecoMix(card, text, .24),
  '--accent': accent, '--accent-soft': accent + (dark ? '22' : '18'), '--accent-line': accent + '66', '--violet': dark ? '#b48cff' : '#7048e8',
  '--danger': dark ? '#ff6b6b' : '#d6336c', '--ok': dark ? '#3fd07a' : '#2b8a3e', '--warn': dark ? '#f5b041' : '#c77700',
  '--code-bg': dark ? ecoMix(bg, '#000000', .35) : ecoMix(bg, text, .04), '--code-head': dark ? ecoMix(card, '#000000', .2) : ecoMix(bg, text, .08),
  '--add': dark ? 'rgba(63,208,122,.16)' : 'rgba(43,138,62,.12)', '--del': dark ? 'rgba(255,107,107,.16)' : 'rgba(214,51,108,.12)', '--think-line': accent + '55'
});

const ECO_SKILLS = {
  'code-review': ['Code review', 'Review a diff or file like a senior engineer', `Review the code the user points at (diff, file or snippet). Read it fully before commenting.
1. Correctness first: logic errors, off-by-one, null/undefined paths, async races, error handling, resource leaks.
2. Security: injection, unescaped HTML, secrets, unsafe eval, path traversal, missing auth checks.
3. API & design: naming, cohesion, hidden coupling, surprising side effects.
4. Tests: what is untested that could break?
Output: a short verdict line, then findings ordered by severity as "**[high|med|low]** file:line — problem → concrete fix". Quote at most 3 lines per finding. Skip nitpicks unless asked. If it is good, say so plainly.`],
  refactor: ['Refactor', 'Improve structure without changing behaviour', `Goal: same behaviour, clearer code.
- First state the invariants you will preserve (inputs, outputs, side effects, public API).
- Make small, named steps: extract function, rename, inline, remove duplication, replace conditionals with data.
- Never mix refactoring with feature changes. Keep diffs reviewable.
- Use fs tools to write changes; record each change so it can be reverted.
- After changes, list what moved where and how to verify (tests or a manual check).`],
  'test-writer': ['Test writer', 'Write focused, meaningful tests', `Write tests that would catch real regressions.
- Identify the unit's contract: happy path, edge cases (empty, zero, huge, unicode, null), error paths.
- One behaviour per test; descriptive names ("returns 0 for empty cart").
- Match the project's existing framework and style; detect it from files first.
- Avoid mocking what you own; prefer real values. No sleeps; control time.
- Finish with how to run the tests and what each one protects.`],
  debugging: ['Debugging', 'Systematic root-cause debugging', `Debug scientifically.
1. Reproduce: get the exact error, input and environment. Do not guess before you can reproduce.
2. Narrow: read the stack trace bottom-up, bisect the input or the change history, add targeted logging.
3. Hypothesize: state ONE cause and the observation that would confirm or refute it. Test it.
4. Fix the root cause, not the symptom; explain why it happened.
5. Verify the fix and add a regression test. Mention any similar code that may share the bug.`],
  'research-and-cite': ['Research & cite', 'Answer with sources and honest uncertainty', `When answering factual questions:
- Search before answering if the topic may have changed or you are unsure. Prefer primary sources.
- Every non-obvious claim gets an inline citation [n]; list sources at the end with title and URL.
- Separate what sources say from your inference. Flag conflicts between sources.
- Give dates for time-sensitive facts. Say "I could not verify" rather than inventing.
- Lead with the direct answer in 1–2 sentences, then supporting detail.`],
  'release-notes': ['Release notes', 'Turn changes into crisp release notes', `Produce release notes from commits, diffs or a changelog.
- Group under: ✨ New, 🛠 Improved, 🐛 Fixed, ⚠️ Breaking (omit empty groups).
- Write for users, not developers: describe the benefit, not the implementation.
- One line per item, present tense, start with a verb. Link issues/PRs when available.
- Put breaking changes first with a migration note. Keep the whole thing scannable.`],
  'ui-design': ['UI design', 'Design polished, accessible interfaces', `Design and build UI with intent.
- Start mobile-first (390px). One clear primary action per screen. 8px spacing scale.
- Typography: max 2 typefaces, clear hierarchy (size + weight), 45–75 char line length.
- Color: use CSS variables; ensure 4.5:1 contrast for text; one accent color used sparingly.
- Touch targets ≥ 44px, visible focus states, labels on inputs, prefers-reduced-motion respected.
- Show empty, loading and error states. Explain choices briefly after the code.`]
};

const ECO_TEMPLATES = {
  'Slash command': "/* @plugin {\"name\":\"lab.hello\",\"title\":\"Hello command\"} */\nctx.command({ name: 'hello', args: '[name]', desc: 'Greets someone', run(arg, c) {\n  ctx.log('info', 'hello ran with ' + arg);\n  c.reply('Hello **' + (arg || 'world') + '** 👋');\n} });\n",
  'Agent tool': "/* @plugin {\"name\":\"lab.tool\",\"title\":\"Reverse tool\"} */\nctx.tool({ name: 'reverse_text', description: 'Reverse a string', gate: 'none',\n  parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },\n  run({ text }) { ctx.log('info', 'reversing ' + text.length + ' chars'); return { reversed: [...text].reverse().join('') }; } });\nctx.intent({ id: 'rev', order: 50, match: t => /^reverse /i.test(t), script: t => [\n  { tool: { name: 'reverse_text', args: { text: t.slice(8) } } },\n  { final: r => 'Reversed: **' + r[0].reversed + '**' } ] });\n",
  'View (tab)': "/* @plugin {\"name\":\"lab.view\",\"title\":\"Counter view\"} */\nctx.view({ id: 'counter', title: 'Counter', icon: 'sparkle', order: 99, mount(el) {\n  el.innerHTML = '<div class=\"vhead\"><h2>Counter</h2></div><div class=\"vscroll\"><button class=\"btn pri\">Clicked 0×</button></div>';\n  const b = el.querySelector('button'); let n = ctx.data.get('n', 0); b.textContent = 'Clicked ' + n + '×';\n  b.onclick = () => { ctx.data.set('n', ++n); b.textContent = 'Clicked ' + n + '×'; ctx.log('info', 'n=' + n); };\n} });\n",
  'Status item': "/* @plugin {\"name\":\"lab.status\",\"title\":\"Uptime status\"} */\nconst t0 = Date.now();\nctx.status({ id: 'uptime', align: 'right', text: () => '⏱ ' + Math.round((Date.now() - t0) / 1000) + 's' });\nctx.setInterval(() => DS.emit('status:refresh'), 1000);\nctx.log('info', 'uptime status running');\n",
  'Theme': "/* @plugin {\"name\":\"lab.theme\",\"title\":\"Ocean theme\"} */\nctx.theme({ id: 'ocean', label: 'Ocean', dark: true, vars: {\n  '--bg': '#06121f', '--surface': '#0b1b2d', '--card': '#10243a', '--accent': '#4cc9f0', '--text': '#e3f4ff', '--muted': '#7fa3bf' } });\nctx.log('info', 'theme registered — pick it in Settings');\n",
  'Fence renderer': "/* @plugin {\"name\":\"lab.fence\",\"title\":\"Progress fence\"} */\n// Renders ```progress fences like: Build 70\nctx.fence({ langs: ['progress'], render(el, code) {\n  el.innerHTML = code.split('\\n').filter(Boolean).map(l => { const m = l.match(/(.*?)(\\d+)\\s*$/) || [0, l, 0];\n    return '<div style=\"padding:4px 10px\"><div class=\"xs\">' + DS.util.esc(m[1]) + ' ' + m[2] + '%</div><div style=\"height:6px;background:var(--line);border-radius:3px\"><div style=\"height:6px;border-radius:3px;background:var(--accent);width:' + m[2] + '%\"></div></div></div>'; }).join('');\n} });\n",
  'Guard rule': "/* @plugin {\"name\":\"lab.guard\",\"title\":\"No deletes\"} */\nctx.guardRule({ id: 'no-delete', check({ tool, detail }) {\n  if (/remove|delete/.test(tool || '')) { ctx.log('warn', 'blocked ' + tool); return { deny: 'Deletes are disabled by the lab.guard plugin' }; }\n} });\n",
  'ES module': "export const manifest = { name: 'lab.esm', title: 'ESM plugin' };\nexport default function (ctx) {\n  ctx.command({ name: 'esm', desc: 'Hello from an ES module', run: (a, c) => c.reply('ES modules work too ✨') });\n  ctx.log('info', 'ESM plugin applied');\n}\n"
};

DS.plugin({
  name: 'forge.ecosystem', title: 'Ecosystem', version: '1.0.0', tags: ['sdk', 'plugins'],
  description: 'Anything can be a plugin: SDK reference, Plugin Lab, example catalog, themes, skills.',
  apply(ctx) {
    const { esc, el } = DS.util;
    DS.icons.flask = DS.icons.flask || '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3"/><path d="M7 15h10"/></svg>';
    ctx.effect(() => { const s = document.createElement('style'); s.textContent = `
.eco-hero{padding:14px 16px;border:1px solid var(--line);border-radius:var(--radius);background:linear-gradient(135deg,var(--accent-soft),transparent 70%);margin-bottom:14px}
.eco-hero h3{margin:0 0 4px;font-size:17px}.eco-ways{display:grid;gap:8px;margin:8px 0 16px}
.eco-pt{border:1px solid var(--line);border-radius:var(--radius);background:var(--card);margin-bottom:12px;overflow:hidden}
.eco-pt .hd{display:flex;align-items:center;gap:8px;padding:10px 12px}.eco-pt .hd b{font-family:var(--mono);font-size:13px;color:var(--accent)}
.eco-pt .sum{padding:0 12px 6px;font-size:13px;color:var(--text-2)}.eco-pt .shape{padding:0 12px 8px;font-family:var(--mono);font-size:11px;color:var(--muted);word-break:break-word}
.eco-code{margin:0;padding:10px 12px;background:var(--code-bg);font-family:var(--mono);font-size:11.5px;line-height:1.5;overflow-x:auto;white-space:pre;border-top:1px solid var(--line)}
.eco-pt .ft{display:flex;gap:8px;padding:8px 12px;border-top:1px solid var(--line);background:var(--code-head)}
.eco-toc{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px}.eco-toc a{font-family:var(--mono);font-size:11px;padding:4px 8px;border:1px solid var(--line);border-radius:999px;color:var(--text-2);text-decoration:none}
.eco-ed{width:100%;min-height:260px;font-family:var(--mono);font-size:12px;line-height:1.5;background:var(--code-bg);color:var(--text);border:1px solid var(--line);border-radius:var(--radius);padding:10px;resize:vertical;tab-size:2;box-sizing:border-box}
.eco-log{font-family:var(--mono);font-size:11px;background:var(--code-bg);border:1px solid var(--line);border-radius:var(--radius);padding:8px;min-height:90px;max-height:220px;overflow:auto;white-space:pre-wrap;word-break:break-word}
.eco-log .e{color:var(--danger)}.eco-log .w{color:var(--warn)}.eco-log .i{color:var(--text-2)}
.eco-bar{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}.eco-bar .btn{min-height:40px}
.eco-scan{font-size:12px;padding:8px 10px;border-radius:var(--radius);border:1px solid var(--line);margin-top:8px}
.eco-scan.warn{border-color:var(--warn);color:var(--warn)}.eco-scan.ok{color:var(--ok)}
.eco-sw{display:flex;align-items:center;gap:10px;min-height:44px}.eco-sw input[type=color]{width:44px;height:36px;border:1px solid var(--line);border-radius:8px;background:none;padding:2px}`;
      document.head.appendChild(s); return () => s.remove(); });

    /* ---------- themes ---------- */
    ECO_THEMES.forEach(([id, label, dark, bg, surface, card, accent, text, muted]) => ctx.theme({ id, label, dark, vars: ecoVars(bg, surface, card, accent, text, muted, dark) }));
    const custom = () => ctx.data.get('custom', { accent: '#7c5cff', bg: '#101014', dark: true });
    let customOff = null;
    const regCustom = () => {
      if (customOff) { try { customOff(); } catch (_) {} }
      const c = custom(); const surface = ecoMix(c.bg, c.dark ? '#ffffff' : '#000000', .04), card = ecoMix(c.bg, c.dark ? '#ffffff' : '#000000', .07);
      customOff = ctx.theme({ id: 'custom', label: 'Custom', dark: c.dark, vars: ecoVars(c.bg, surface, card, c.accent, c.dark ? '#ececf1' : '#16171a', c.dark ? '#9a9aa6' : '#6a6d75', c.dark) });
      if (typeof customOff !== 'function') customOff = null;
    };
    regCustom();
    ctx.settings({ id: 'theme-custom', title: 'Theme customizer', render(box) {
      const c = custom();
      box.innerHTML = '<div class="sm muted">Edit accent and background live. Saved as the <b>Custom</b> theme.</div>' +
        '<label class="eco-sw"><input type="color" data-k="accent" value="' + c.accent + '"> Accent</label>' +
        '<label class="eco-sw"><input type="color" data-k="bg" value="' + c.bg + '"> Background</label>' +
        '<label class="eco-sw"><input type="checkbox" data-k="dark"' + (c.dark ? ' checked' : '') + '> Dark</label>' +
        '<button class="btn sm pri">Use Custom theme</button>';
      const apply = () => { const v = custom(); Object.entries(v.dark ? ecoVars(v.bg, ecoMix(v.bg, '#ffffff', .04), ecoMix(v.bg, '#ffffff', .07), v.accent, '#ececf1', '#9a9aa6', true) : ecoVars(v.bg, ecoMix(v.bg, '#000000', .04), ecoMix(v.bg, '#000000', .07), v.accent, '#16171a', '#6a6d75', false)).forEach(([k, x]) => document.documentElement.style.setProperty(k, x)); };
      box.querySelectorAll('input').forEach(i => i.oninput = () => { const v = custom(); v[i.dataset.k] = i.type === 'checkbox' ? i.checked : i.value; ctx.data.set('custom', v); regCustom(); if ((DS.store.state.settings || {}).theme === 'custom') apply(); });
      box.querySelector('button').onclick = () => { ecoSetTheme('custom'); ctx.toast('Custom theme applied', 'ok'); };
    } });
    const ecoSetTheme = id => { const s = DS.store.state.settings || (DS.store.state.settings = {}); s.theme = id; DS.store.save && DS.store.save(); DS.emit('theme:set', id); DS.emit('settings:change', { key: 'theme', value: id }); };

    /* ---------- skills / profile / suggestions ---------- */
    Object.entries(ECO_SKILLS).forEach(([id, [title, description, instructions]]) => ctx.skill({ id, title, description, instructions }));
    ctx.profile({ id: 'reviewer', label: 'Reviewer', system: 'You are a meticulous senior code reviewer. Load the code-review skill (use_skill) for any review request. Be direct, rank issues by severity, propose concrete fixes, and never rubber-stamp.' });
    const showCatalog = () => { DS.shell.show('plugins'); setTimeout(() => { const b = [...document.querySelectorAll('.seg button, button')].find(x => /^\s*catalog\s*$/i.test(x.textContent)); b && b.click(); }, 60); };
    ctx.suggest({ id: 'eco-catalog', emoji: '🧩', title: 'Browse plugin catalog', sub: ECO_CATALOG.length + ' ready-made plugins', run: showCatalog });
    ctx.suggest({ id: 'eco-sdk', emoji: '📘', title: 'Open the SDK', sub: 'every contribution point, live', run: () => DS.shell.show('sdk') });
    ctx.suggest({ id: 'eco-lab', emoji: '🧪', title: 'Open the Lab', sub: 'write & hot-run a plugin', run: () => DS.shell.show('lab') });

    /* ---------- catalog ---------- */
    ECO_CATALOG.forEach(([id, title, description, tags, body]) => ctx.catalog({ id, title, description, tags, source: ecoSrc(id, title, description, body) }));

    /* ---------- SDK view ---------- */
    const tryExample = (point, code) => {
      const name = 'sdk.' + point.toLowerCase();
      const src = '/* @plugin ' + JSON.stringify({ name, title: 'SDK example: ' + point, description: 'Installed from the SDK “Try it” button' }) + ' */\n' + code + '\nctx.toast(' + JSON.stringify('SDK example “' + point + '” is live') + ', "ok");\n';
      return DS.views.installSource({ source: src, origin: 'sdk', title: 'Try ' + point });
    };
    ctx.view({ id: 'sdk', title: 'SDK', icon: 'code', order: 75, mount(root) {
      const pts = Object.entries(DS.POINTS || {});
      root.innerHTML = '<div class="vhead"><h2>Plugin SDK</h2><span class="chip acc">' + pts.length + ' points</span></div><div class="vscroll"></div>';
      const sc = root.querySelector('.vscroll');
      sc.innerHTML = '<div class="eco-hero"><h3>Anything can be a plugin</h3><div class="sm muted">Every feature of Forge — tools, views, themes, the model provider itself — is built on the same API you get. Tap <b>Try it</b> on any card to install the example live, then disable it in Plugins.</div></div>' +
        '<div class="sec-t">Three ways to write a plugin</div><div class="eco-ways">' +
        [['1 · Body + header comment', '/* @plugin {"name":"me.hi","title":"Hi"} */\nctx.command({ name: "hi", desc: "Hi", run: (a, c) => c.reply("hi") });'],
         ['2 · ES module', 'export const manifest = { name: "me.hi", title: "Hi" };\nexport default function (ctx) {\n  ctx.command({ name: "hi", desc: "Hi", run: (a, c) => c.reply("hi") });\n}'],
         ['3 · DS.plugin', 'DS.plugin({ name: "me.hi", title: "Hi", apply(ctx) {\n  ctx.command({ name: "hi", desc: "Hi", run: (a, c) => c.reply("hi") });\n} });']]
          .map(([t, c]) => '<div class="eco-pt"><div class="hd"><b>' + esc(t) + '</b></div><pre class="eco-code">' + esc(c) + '</pre></div>').join('') + '</div>' +
        '<div class="sec-t">Contribution points</div><div class="eco-toc">' + pts.map(([k]) => '<a href="#" data-k="' + k + '">' + k + '</a>').join('') + '</div>';
      pts.forEach(([k, p]) => {
        const ex = ECO_EXAMPLES[k] || '// see shape above';
        const card = el('div', { class: 'eco-pt', id: 'eco-pt-' + k }, '<div class="hd"><b>' + esc(k) + '</b><span class="xs muted">ctx.' + esc(p.helper || k) + '()</span></div><div class="sum">' + esc(p.summary || '') + '</div><div class="shape">' + esc(p.shape || '') + '</div><pre class="eco-code">' + esc(ex) + '</pre><div class="ft"><button class="btn sm" data-a="copy">' + DS.icon('copy') + ' Copy</button>' + (ECO_EXAMPLES[k] ? '<button class="btn sm pri" data-a="try">' + DS.icon('play') + ' Try it</button>' : '') + '</div>');
        card.querySelector('[data-a=copy]').onclick = () => { DS.util.copy(ex); ctx.toast('Copied ' + k + ' example', 'ok'); };
        const tb = card.querySelector('[data-a=try]'); if (tb) tb.onclick = () => tryExample(k, ex);
        sc.appendChild(card);
      });
      sc.querySelectorAll('.eco-toc a').forEach(a => a.onclick = e => { e.preventDefault(); const t = sc.querySelector('#eco-pt-' + a.dataset.k); t && t.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    } });

    /* ---------- Lab view ---------- */
    const lab = { name: null, log: [], logEl: null };
    const labLog = (cls, text) => { lab.log.push([cls, text]); if (lab.log.length > 300) lab.log.shift(); if (lab.logEl) { const d = el('div', { class: cls }); d.textContent = text; lab.logEl.appendChild(d); lab.logEl.scrollTop = 1e9; } };
    ctx.on('trace', e => { if (!lab.name || !e || e.source !== lab.name) return; labLog(e.level === 'error' ? 'e' : e.level === 'warn' ? 'w' : 'i', new Date(e.ts || Date.now()).toLocaleTimeString() + ' [' + e.level + '] ' + e.msg); });
    const labName = src => { const m = src.match(/"name"\s*:\s*"([^"]+)"|name\s*:\s*'([^']+)'/); let n = m ? (m[1] || m[2]) : 'lab.scratch'; if (!/^lab\./.test(n)) n = 'lab.' + n.replace(/^[^.]*\./, ''); return n; };
    const forceName = (src, n) => /"name"\s*:\s*"[^"]+"/.test(src) ? src.replace(/"name"\s*:\s*"[^"]+"/, '"name":"' + n + '"') : /name\s*:\s*'[^']+'/.test(src) ? src.replace(/name\s*:\s*'[^']+'/, "name: '" + n + "'") : '/* @plugin {"name":"' + n + '","title":"Lab scratch"} */\n' + src;
    const labStop = async (quiet) => { if (!lab.name) return; const n = lab.name; try { await DS.plugins.remove(n); } catch (_) {} if (!quiet) labLog('w', '■ stopped & uninstalled ' + n); lab.name = null; DS.emit('plugin:change'); };
    const labRun = async (src) => {
      const n = labName(src); const code = forceName(src, n);
      if (lab.name && lab.name !== n) await labStop(true);
      lab.name = n; labLog('i', (DS.kernel.plugins.has(n) ? '↻ reloading ' : '▶ running ') + n);
      try {
        const recs = await DS.plugins.install({ source: code, origin: 'lab' });
        recs.forEach(r => { if (r.state === 'error') labLog('e', '✗ ' + r.name + ': ' + (r.error && r.error.message)); else labLog('i', '✓ ' + r.name + ' ' + r.state + ' · contributes ' + JSON.stringify(DS.kernel.contributionsOf ? DS.kernel.contributionsOf(r.name) : {})); });
        DS.emit('plugin:change'); return recs;
      } catch (e) { labLog('e', '✗ ' + e.message); return null; }
    };
    ctx.view({ id: 'lab', title: 'Lab', icon: 'sparkle', order: 70, badge: () => lab.name ? '●' : '', mount(root) {
      root.innerHTML = '<div class="vhead"><h2>Plugin Lab</h2><span class="chip" data-st>idle</span></div><div class="vscroll">' +
        '<div class="field"><label>Template</label><select class="sel" style="width:100%">' + Object.keys(ECO_TEMPLATES).map(k => '<option>' + esc(k) + '</option>').join('') + '</select></div>' +
        '<textarea class="eco-ed" spellcheck="false" autocapitalize="off" autocomplete="off"></textarea><div class="eco-scan ok" data-scan></div>' +
        '<div class="eco-bar"><button class="btn pri" data-a="run">' + DS.icon('play') + ' Run</button><button class="btn" data-a="stop">' + DS.icon('stop') + ' Stop</button><button class="btn" data-a="save">' + DS.icon('check') + ' Save</button><button class="btn" data-a="ask">' + DS.icon('sparkle') + ' Ask the agent</button></div>' +
        '<div class="sec-t">Live log <span class="xs muted" data-nm></span></div><div class="eco-log"></div><div class="xs muted" style="margin-top:8px">Run hot-installs under a <span class="mono">lab.*</span> name and replaces the previous run. Save keeps it as a normal plugin.</div></div>';
      const ta = root.querySelector('textarea'), sel = root.querySelector('select'), scan = root.querySelector('[data-scan]'), st = root.querySelector('[data-st]'), nm = root.querySelector('[data-nm]');
      lab.logEl = root.querySelector('.eco-log'); lab.log.forEach(([c, t]) => { const d = el('div', { class: c }); d.textContent = t; lab.logEl.appendChild(d); });
      const draft = ctx.data.get('draft', null); ta.value = draft || ECO_TEMPLATES[sel.value];
      const rescan = () => { const r = DS.scanSource(ta.value); scan.className = 'eco-scan ' + (r.length ? 'warn' : 'ok'); scan.textContent = r.length ? '⚠ Static scan: ' + r.map(x => x.label + ' (' + x.sev + ')').join(' · ') : '✓ Static scan: nothing unusual'; };
      const status = () => { st.textContent = lab.name ? 'running' : 'idle'; st.className = 'chip' + (lab.name ? ' ok' : ''); nm.textContent = lab.name || ''; };
      const save = DS.util.debounce ? DS.util.debounce(() => ctx.data.set('draft', ta.value), 400) : () => ctx.data.set('draft', ta.value);
      rescan(); status();
      sel.onchange = () => { ta.value = ECO_TEMPLATES[sel.value]; ctx.data.set('draft', ta.value); rescan(); };
      ta.oninput = () => { save(); rescan(); };
      ta.onkeydown = e => { if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); const s = ta.selectionStart, en = ta.selectionEnd; ta.value = ta.value.slice(0, s) + '  ' + ta.value.slice(en); ta.selectionStart = ta.selectionEnd = s + 2; save(); } if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); run(); } };
      const run = async () => { const r = DS.scanSource(ta.value); if (r.some(x => x.sev === 'high') && !(await DS.ui.confirm('Static scan flagged: ' + r.map(x => x.label).join(', ') + '. Run anyway?', 'Run'))) return; await labRun(ta.value); status(); };
      root.querySelector('[data-a=run]').onclick = run;
      root.querySelector('[data-a=stop]').onclick = async () => { await labStop(); status(); };
      root.querySelector('[data-a=save]').onclick = async () => { const n = labName(ta.value).replace(/^lab\./, 'user.'); const rr = await DS.views.installSource({ source: forceName(ta.value, n), origin: 'lab', title: 'Save ' + n }); if (rr) { labLog('i', '💾 saved as ' + n); if (lab.name) await labStop(true); status(); } };
      root.querySelector('[data-a=ask]').onclick = async () => { const what = await DS.ui.promptText('Describe the plugin you want', ''); if (!what) return; DS.shell.show('thread'); const t = DS.store.activeThread() || DS.store.newThread(); DS.agent.run(t, '/plugin ' + what); };
      const off = DS.bus.on('plugin:change', status);
      return () => { off && off(); lab.logEl = null; };
    } });

    ctx.command({ name: 'lab', args: '[template]', desc: 'Open the Plugin Lab', run(a) { if (a && ECO_TEMPLATES[a]) ctx.data.set('draft', ECO_TEMPLATES[a]); DS.shell.show('lab'); } });
    ctx.command({ name: 'sdk', args: '[point]', desc: 'Open the plugin SDK reference', run(a) { DS.shell.show('sdk'); if (a) setTimeout(() => { const t = document.getElementById('eco-pt-' + a.trim()); t && t.scrollIntoView(); }, 80); } });
    ctx.intent({ id: 'eco-catalog', order: 50, match: t => /\b(plugin catalog|browse plugins|what plugins)\b/i.test(t), script: () => [{ final: () => { showCatalog(); return 'Opened the **plugin catalog** — ' + ECO_CATALOG.length + ' ready-made plugins (' + ECO_CATALOG.map(c => c[1]).join(', ') + '). Tap Install on any of them, or open the **Lab** (/lab) to write your own.'; } }] });
    ctx.lab = { run: labRun, stop: labStop, state: lab };
    ctx.provide('ecosystem', { run: labRun, stop: labStop, state: lab, templates: ECO_TEMPLATES, catalog: ECO_CATALOG, themes: ECO_THEMES.map(t => t[0]).concat('custom') });
  }
});

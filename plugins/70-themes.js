/* forge.themes — ATT colour themes + packs + layouts + looks, picker view, rail, commands, Sim intents. */
const FT_HEX = h => { h = String(h).replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); const n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const FT_TOHEX = c => '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const FT_MIX = (a, b, t) => { const A = FT_HEX(a), B = FT_HEX(b); return FT_TOHEX(A.map((v, i) => v + (B[i] - v) * t)); };
const FT_RGBA = (h, a) => 'rgba(' + FT_HEX(h).join(',') + ',' + a + ')';
const FT_LUM = h => { const c = FT_HEX(h).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const FT_CR = (a, b) => { const x = FT_LUM(a), y = FT_LUM(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
/* push colour c toward `to` until contrast vs bg >= min */
const FT_FIX = (c, bg, to, min) => { let t = 0; let out = c; while (FT_CR(out, bg) < min && t < 1) { t += 0.05; out = FT_MIX(c, to, t); } return out; };

const FT_COLORS = {
  dark: ['Dark', ['#1e1e20', '#0b1120', '#4a8ac4', '#e8e8ea']], light: ['Light', ['#f2f2f7', '#eef3fa', '#4176e6', '#1c1c1e']],
  midnight: ['Midnight', ['#05070e', '#02040a', '#3b82f6', '#dce6f7']], aurora: ['Aurora', ['#0a1628', '#071326', '#22d3ee', '#e0f2ff']],
  sunset: ['Sunset', ['#1c0e14', '#160a10', '#fb7185', '#ffe4e6']], forest: ['Forest', ['#0a1410', '#06120d', '#34d399', '#d9f0e0']],
  ocean: ['Ocean', ['#061420', '#04101c', '#0ea5e9', '#d5efff']], rose: ['Rose', ['#1a0f1a', '#150b15', '#ec4899', '#f7dcf7']],
  mono: ['Mono', ['#0d0d0d', '#0a0a0a', '#e5e5e5', '#f5f5f5']], nordic: ['Nordic', ['#2e3440', '#2b303b', '#88c0d0', '#eceff4']],
  terminal: ['Terminal', ['#000', '#000', '#00ff41', '#33ff33']], cyberpunk: ['Cyberpunk', ['#0d0221', '#08011a', '#ff00ff', '#f0e6ff']],
  solarized: ['Solarized', ['#002b36', '#001f27', '#b58900', '#eee8d5']], dracula: ['Dracula', ['#1e1f29', '#191a21', '#bd93f9', '#f8f8f2']],
  nord: ['Nord', ['#242933', '#1f242d', '#5e81ac', '#d8dee9']], gruvbox: ['Gruvbox', ['#1d2021', '#181818', '#fabd2f', '#ebdbb2']],
  tokyo: ['Tokyo Night', ['#1a1b26', '#16161e', '#7aa2f7', '#c0caf5']], catppuccin: ['Catppuccin', ['#1e1e2e', '#181825', '#cba6f7', '#cdd6f4']],
  blood: ['Blood', ['#0f0505', '#0a0303', '#ef4444', '#f5d5d5']], ice: ['Ice', ['#0a141c', '#061018', '#67e8f9', '#e0f4ff']],
  liquid: ['Liquid Glass', ['#07111f', '#03101d', '#7dd3fc', '#effbff']], opal: ['Opal Dayglass', ['#f7f4ff', '#f9fbff', '#8b5cf6', '#241833']],
  nvidia: ['NVIDIA Core', ['#071004', '#030800', '#76b900', '#efffde']], sakura: ['Sakura Noir', ['#1b0f18', '#150a13', '#fb7185', '#fff0f7']],
  arctic: ['Arctic Glass', ['#e9f8ff', '#f6fcff', '#0284c7', '#082f49']], emberglass: ['Ember Glass', ['#130906', '#090403', '#f97316', '#fff3e6']],
  holo: ['Holographic', ['#0d1025', '#07091b', '#67e8f9', '#f6f3ff']],
};
const FT_LIGHT_OF = ['liquid', 'nvidia', 'holo', 'cyberpunk', 'aurora', 'emberglass', 'tokyo', 'dracula'];

function ftDerive(sw, forceLight) {
  let [bg, bg2, acc, text] = sw.map(c => FT_TOHEX(FT_HEX(c)));
  let dark = FT_LUM(bg) < 0.4;
  if (forceLight && dark) { bg = FT_MIX(acc, '#ffffff', 0.94); bg2 = FT_MIX(acc, '#ffffff', 0.9); text = FT_MIX(acc, '#000000', 0.82); dark = false; }
  const W = dark ? '#ffffff' : '#000000';
  const surface = FT_MIX(bg, dark ? text : '#ffffff', dark ? 0.045 : 0.6), card = FT_MIX(bg, dark ? text : acc, dark ? 0.07 : 0.05), card2 = FT_MIX(bg, dark ? text : acc, dark ? 0.11 : 0.09);
  const worst = [bg, bg2, surface, card, card2].reduce((w, c) => (dark ? FT_LUM(c) > FT_LUM(w) : FT_LUM(c) < FT_LUM(w)) ? c : w, bg);
  text = FT_FIX(text, worst, W, 7);
  const text2 = FT_FIX(FT_MIX(text, bg, 0.18), worst, W, 5.5), muted = FT_FIX(FT_MIX(text, bg, 0.42), worst, W, 4.6);
  const accT = FT_FIX(acc, worst, W, 3.2);
  return { dark, vars: {
    '--bg': bg, '--bg-2': bg2, '--surface': surface, '--surface-2': card, '--card': card, '--card-2': card2,
    '--text': text, '--text-2': text2, '--muted': muted, '--line': FT_MIX(bg, text, dark ? 0.12 : 0.13), '--line-2': FT_MIX(bg, text, dark ? 0.2 : 0.22),
    '--accent': accT, '--accent-2': FT_MIX(accT, W, 0.18), '--accent-soft': FT_RGBA(acc, dark ? 0.14 : 0.11), '--accent-line': FT_RGBA(acc, 0.42),
    '--violet': dark ? '#a78bfa' : '#7c3aed', '--danger': dark ? '#f87171' : '#c62828', '--ok': dark ? '#4ade80' : '#1a7f37', '--warn': dark ? '#fbbf24' : '#9a6700',
    '--code-bg': FT_MIX(bg, '#000000', dark ? 0.25 : 0.03), '--code-head': FT_MIX(bg, text, dark ? 0.07 : 0.06), '--think-line': FT_MIX(bg, text, 0.2),
    '--add': dark ? 'rgba(74,222,128,.14)' : 'rgba(26,127,55,.13)', '--del': dark ? 'rgba(248,113,113,.14)' : 'rgba(207,34,46,.12)',
    '--glass': FT_RGBA(card, dark ? 0.72 : 0.78), '--glass-line': FT_RGBA(text, 0.1), '--radius': '12px' } };
}
/* ---- Theme Factory (anthropic theme-factory palettes) + font pairings (system stacks only, no network fonts) ---- */
const FT_FONTS = {
  system: ['System', 'var(--font)'],
  serif: ['Serif', '"Iowan Old Style","Palatino Linotype",Palatino,Georgia,"DejaVu Serif","Times New Roman",serif'],
  humanist: ['Humanist', '"Avenir Next",Avenir,"Segoe UI","Gill Sans","DejaVu Sans",Helvetica,sans-serif'],
  geometric: ['Geometric', 'Futura,"Century Gothic","Trebuchet MS","DejaVu Sans",sans-serif'],
  rounded: ['Rounded', 'ui-rounded,"SF Pro Rounded","Arial Rounded MT Bold","Nunito",var(--font)'],
  slab: ['Slab', 'Rockwell,"Roboto Slab","Courier New",Georgia,serif'],
  mono: ['Mono', 'var(--mono)'],
};
/* [label, c1..c4, font, dark-base {bg,accent,secondary,text}, light-base] */
const FT_TF = {
  ocean: ['Ocean Depths', ['#1a2332', '#2d8b8b', '#a8dadc', '#f1faee'], 'humanist', ['#1a2332', '#2d8b8b', '#a8dadc', '#f1faee'], ['#f1faee', '#2d8b8b', '#a8dadc', '#1a2332']],
  sunset: ['Sunset Boulevard', ['#e76f51', '#f4a261', '#e9c46a', '#264653'], 'serif', ['#264653', '#e76f51', '#e9c46a', '#fdf3e7'], ['#fcf6e6', '#e76f51', '#f4a261', '#264653']],
  forest: ['Forest Canopy', ['#2d4a2b', '#7d8471', '#a4ac86', '#faf9f6'], 'serif', ['#2d4a2b', '#a4ac86', '#7d8471', '#faf9f6'], ['#faf9f6', '#2d4a2b', '#a4ac86', '#22301f']],
  minimalist: ['Modern Minimalist', ['#36454f', '#708090', '#d3d3d3', '#ffffff'], 'system', ['#36454f', '#d3d3d3', '#708090', '#ffffff'], ['#ffffff', '#708090', '#d3d3d3', '#36454f']],
  golden: ['Golden Hour', ['#f4a900', '#c1666b', '#d4b896', '#4a403a'], 'humanist', ['#4a403a', '#f4a900', '#c1666b', '#f6eee2'], ['#f7f1e6', '#c1666b', '#f4a900', '#4a403a']],
  arctic: ['Arctic Frost', ['#d4e4f7', '#4a6fa5', '#c0c0c0', '#fafafa'], 'geometric', ['#141d2b', '#8fb0dc', '#c0c0c0', '#fafafa'], ['#fafafa', '#4a6fa5', '#d4e4f7', '#1c2b40']],
  desert: ['Desert Rose', ['#d4a5a5', '#b87d6d', '#e8d5c4', '#5d2e46'], 'serif', ['#5d2e46', '#d4a5a5', '#b87d6d', '#f6ece4'], ['#f6efe7', '#b87d6d', '#d4a5a5', '#5d2e46']],
  tech: ['Tech Innovation', ['#0066ff', '#00ffff', '#1e1e1e', '#ffffff'], 'mono', ['#1e1e1e', '#3d8bff', '#00ffff', '#ffffff'], ['#ffffff', '#0066ff', '#00a3a3', '#1e1e1e']],
  botanical: ['Botanical Garden', ['#4a7c59', '#f9a620', '#b7472a', '#f5f3ed'], 'serif', ['#17261c', '#f9a620', '#b7472a', '#f5f3ed'], ['#f5f3ed', '#4a7c59', '#b7472a', '#24301f']],
  galaxy: ['Midnight Galaxy', ['#2b1e3e', '#4a4e8f', '#a490c2', '#e6e6fa'], 'geometric', ['#2b1e3e', '#a490c2', '#4a4e8f', '#e6e6fa'], ['#f3f3fd', '#4a4e8f', '#a490c2', '#2b1e3e']],
};
/* full var set from 4 base colours: bg, accent, secondary, text (+ font key) */
function ftFromBase(b, font) {
  const [bg, acc, sec, text] = [b.bg, b.accent, b.secondary, b.text].map(c => FT_TOHEX(FT_HEX(c || '#888')));
  const dark = FT_LUM(bg) < 0.4;
  const bg2 = FT_MIX(bg, dark ? '#000000' : acc, dark ? 0.18 : 0.05);
  const d = ftDerive([bg, bg2, acc, text], false);
  const W = d.dark ? '#ffffff' : '#000000';
  d.vars['--violet'] = FT_FIX(sec, d.vars['--card'], W, 3);
  d.vars['--accent-soft'] = FT_RGBA(acc, d.dark ? 0.16 : 0.12);
  d.vars['--font-head'] = (FT_FONTS[font] || FT_FONTS.system)[1];
  return d;
}
/* nudge text (and accent) lightness until text/bg >= 4.5 and accent/bg >= 3 */
function ftFixBase(b) {
  const o = Object.assign({}, b); const dark = FT_LUM(o.bg) < 0.4; const W = dark ? '#ffffff' : '#000000';
  if (FT_CR(o.text, o.bg) < 4.5) o.text = FT_FIX(o.text, o.bg, W, 4.6);
  if (FT_CR(o.text, o.bg) < 4.5) { o.bg = FT_FIX(o.bg, o.text, dark ? '#000000' : '#ffffff', 4.6); }
  if (FT_CR(o.accent, o.bg) < 3) o.accent = FT_FIX(o.accent, o.bg, W, 3.1);
  return o;
}
const FT_LAYOUTS = { default: 'Standard', compact: 'Denser', wide: 'Spacious', center: 'Focused', bubbles: 'Chat style', terminal: 'Monospace', studio: 'Builder workspace', cinematic: 'Wide canvas', zen: 'No chrome', split: 'Dense review' };
const FT_LOOKS = { none: 'Flat', glass: 'Glass', liquid: 'Liquid glass', nvidia: 'NVIDIA', core: 'Core', cyber: 'Cyber', aurora: 'Aurora', opal: 'Opal' };
const FT_GLASS = ['glass', 'liquid', 'nvidia', 'cyber', 'aurora', 'opal'];
/* liquid-glass chrome (ported from ATT forge-liquid-glass-upgrades). NO backdrop-filter on #rail/#hdr/overlays/full-screen layers (A9 click-trap rule); only translucent gradients + highlights. */
const FT_GLASS_CSS = FT_GLASS.map(l => 'html[data-look=' + l + ']').reduce((acc, h) => acc.concat([h]), []);
const FT_LG = (sel) => FT_GLASS_CSS.map(h => sel.split(',').map(x => h + ' ' + x.trim()).join(',')).join(',');
const FT_CHROME = FT_LG('#rail') + '{background:linear-gradient(180deg,color-mix(in srgb,var(--surface) 72%,transparent),color-mix(in srgb,var(--bg) 82%,transparent));border-right:1px solid var(--glass-line,var(--line-2));box-shadow:inset -1px 0 0 rgba(255,255,255,.06),8px 0 30px -18px var(--accent)}'
 + FT_LG('#rail .rb') + '{border-radius:14px;transition:background .2s,box-shadow .2s,transform .12s}'
 + FT_LG('#rail .rb:hover,#rail .rb.on') + '{background:linear-gradient(180deg,rgba(255,255,255,.14),rgba(255,255,255,.03));box-shadow:inset 0 1px 0 rgba(255,255,255,.22),0 4px 14px -6px var(--accent)}'
 + FT_LG('.rgrp.forge') + '{background:linear-gradient(180deg,color-mix(in srgb,var(--accent) 16%,transparent),color-mix(in srgb,var(--violet,var(--accent)) 10%,transparent));border:1px solid var(--accent-line);border-radius:18px;padding:3px 0;box-shadow:inset 0 1px 0 rgba(255,255,255,.18)}'
 + FT_LG('.rgrp.forge .rb.on') + '{background:var(--accent);color:var(--bg);box-shadow:0 0 18px -4px var(--accent)}'
 + FT_LG('#hdr') + '{background:linear-gradient(180deg,color-mix(in srgb,var(--surface) 80%,transparent),color-mix(in srgb,var(--surface) 55%,transparent));border-bottom:1px solid var(--glass-line,var(--line));box-shadow:inset 0 -1px 0 rgba(255,255,255,.05)}'
 + FT_LG('.card,.mchip,.tcall') + '{box-shadow:inset 0 1px 0 rgba(255,255,255,.10),0 10px 30px -18px rgba(0,0,0,.6);border-radius:calc(var(--radius) + 4px)}'
 + 'html[data-look=liquid] .card,html[data-look=nvidia] .card{background:var(--glass,var(--card))!important;border-color:var(--glass-line,var(--line))!important;-webkit-backdrop-filter:blur(14px) saturate(1.4);backdrop-filter:blur(14px) saturate(1.4)}'
 + 'html[data-look=nvidia] .rgrp.forge{border-color:#76b90088}html[data-look=nvidia] .vhead h2{color:#76b900}html[data-look=liquid] .vhead h2{background:linear-gradient(90deg,var(--text),var(--accent));-webkit-background-clip:text;background-clip:text;color:transparent}'
 + '#backdrop,.sheet-bg,.overlay{-webkit-backdrop-filter:none!important;backdrop-filter:none!important}';
const FT_PACKS = {
  liquid: { label: 'Liquid Glass', color: 'att-liquid', backdrop: 'orbs', layout: 'default', look: 'liquid' },
  nvidia: { label: 'NVIDIA Core', color: 'att-nvidia', backdrop: 'constellation', layout: 'studio', look: 'nvidia' },
  cyber: { label: 'Cyber', color: 'att-cyberpunk', backdrop: 'grid', layout: 'default', look: 'cyber' },
  aurora: { label: 'Aurora', color: 'att-aurora', backdrop: 'aurora', layout: 'center', look: 'aurora' },
  opal: { label: 'Opal', color: 'att-opal', backdrop: 'orbs', layout: 'bubbles', look: 'opal' },
  neural: { label: 'Neural Cinematic', color: 'att-holo', backdrop: 'neuralmesh', layout: 'cinematic', look: 'glass' },
};
const FT_CSS = `
.ft-mini{position:absolute;top:0;right:0;bottom:0;left:0;pointer-events:none}.ft-mini u{position:absolute;right:10%;height:12%;border-radius:4px;width:40%;top:30%}.ft-mini u+u{left:20%;right:auto;width:55%;top:52%}
html[data-layout=compact] .turn{margin-bottom:6px}html[data-layout=compact] .md{font-size:13.5px;line-height:1.45}
html[data-layout=wide] #thread .turn,html[data-layout=wide] .turn{max-width:none}html[data-layout=wide] .md{font-size:15.5px;line-height:1.7}
html[data-layout=center] .turn{max-width:720px;margin-left:auto;margin-right:auto}
html[data-layout=bubbles] .turn.user{display:flex;flex-direction:column;align-items:flex-end}html[data-layout=bubbles] .turn.assistant .final{background:var(--card);border:1px solid var(--line);border-radius:18px 18px 18px 4px;padding:8px 12px;max-width:92%}html[data-layout=bubbles] .turn.user .bubble{background:var(--accent-soft);border:1px solid var(--accent-line);border-radius:18px 18px 4px 18px;padding:8px 12px;margin-left:auto;max-width:86%}
html[data-layout=terminal] .md,html[data-layout=terminal] #composer textarea{font-family:var(--mono)!important;font-size:13px}
html[data-layout=studio] #hdr{border-bottom-color:var(--accent-line)}html[data-layout=studio] .md{font-size:14px}
html[data-layout=cinematic] .turn{max-width:860px;margin-left:auto;margin-right:auto}html[data-layout=cinematic] #hdr{background:transparent}
html[data-layout=zen] #status,html[data-layout=zen] #tabs{display:none!important}html[data-layout=zen] .turn{max-width:680px;margin:0 auto 14px}
html[data-layout=split] .md{font-size:13px}
html[data-look=glass] .card,html[data-look=glass] .tc,html[data-look=opal] .card,html[data-look=aurora] .card{background:var(--glass)!important;border-color:var(--glass-line)!important;-webkit-backdrop-filter:blur(14px) saturate(1.3);backdrop-filter:blur(14px) saturate(1.3)}
html[data-look=core] .card{border-color:var(--accent-line)!important;box-shadow:0 0 0 1px var(--accent-soft),0 6px 24px -12px var(--accent)}
html[data-look=cyber] .card{border-color:var(--accent-line)!important;box-shadow:0 0 14px -4px var(--accent)}html[data-look=cyber] .vhead h2{text-shadow:0 0 10px var(--accent)}
html[data-look=aurora] .vhead h2{background:linear-gradient(90deg,var(--accent),var(--violet));-webkit-background-clip:text;background-clip:text;color:transparent}
.ft-tabs{position:sticky;top:0;z-index:2;background:var(--bg);padding:8px 16px}
.ft-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.ft-sw{display:flex;flex-direction:column;gap:6px;padding:8px;border-radius:12px;border:1px solid var(--line);background:var(--card);color:var(--text);text-align:left;min-height:44px;cursor:pointer;font:inherit}
.ft-sw.on{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-soft)}
.ft-sw i{display:block;height:46px;border-radius:8px;position:relative;overflow:hidden}
.ft-sw i b{position:absolute;right:6px;bottom:6px;width:14px;height:14px;border-radius:50%}
.ft-sw span{font-size:12.5px;font-weight:600}.ft-sw small{font-size:11px;color:var(--muted)}
.ft-packs{display:flex;flex-wrap:wrap;gap:8px}.ft-packs .btn{min-height:40px}
.ft-row{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:10px 0}.ft-row label{font-size:12.5px;color:var(--text-2)}
.ft-row input[type=range]{flex:1;min-width:140px;accent-color:var(--accent)}
.ft-wrap{padding:0 16px 24px;max-width:100%;box-sizing:border-box}
.vhead h2,.md h1,.md h2,.md h3{font-family:var(--font-head-x,var(--font-head,var(--font)))}
.ft-gt{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:14px 0 6px;font-weight:700}
.ft-st{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:8px 0}
.ft-st label{display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid var(--line);border-radius:10px;background:var(--card);font-size:12.5px;min-height:40px;box-sizing:border-box}
.ft-st input[type=color]{width:34px;height:30px;border:0;padding:0;background:none;border-radius:6px;flex:none}
.ft-st code{font-size:11px;color:var(--muted)}
.ft-pv{border-radius:14px;border:1px solid var(--line);overflow:hidden;background:var(--bg);color:var(--text);font-family:var(--font)}
.ft-pv .h{background:var(--surface);border-bottom:1px solid var(--line);padding:8px 12px;font-weight:700;font-family:var(--font-head)}
.ft-pv .b{padding:10px 12px;display:flex;flex-direction:column;gap:8px}
.ft-pv .u{align-self:flex-end;background:var(--accent-soft);border:1px solid var(--accent-line);border-radius:14px 14px 4px 14px;padding:6px 10px;font-size:13px}
.ft-pv .c{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px 10px;font-size:13px}.ft-pv .c small{color:var(--muted)}.ft-pv .c i{color:var(--violet);font-style:normal}
.ft-pv .k{background:var(--code-bg);border-radius:8px;padding:6px 8px;font:12px var(--mono);color:var(--text-2)}
.ft-pv .a{align-self:flex-start;background:var(--accent);color:var(--bg);border-radius:9px;padding:6px 12px;font-size:12.5px;font-weight:700}
.ft-cr{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}

`;

DS.plugin({ name: 'forge.themes', title: 'Themes & layouts', version: '2.0.0', tags: ['ui', 'themes'],
  description: '27 ATT colour themes + 10 Theme Factory palettes (dark+light, font pairings), Theme Studio (custom themes w/ WCAG check), light variants, 10 layouts, glass/core/cyber looks, one-tap packs and a picker.',
  apply(ctx) {
    const ids = [];
    for (const [k, [label, sw]] of Object.entries(FT_COLORS)) {
      const d = ftDerive(sw, false); ctx.theme({ id: 'att-' + k, label, dark: d.dark, vars: d.vars }); ids.push({ id: 'att-' + k, label, sw, dark: d.dark, vars: d.vars });
      if (FT_LIGHT_OF.includes(k)) { const l = ftDerive(sw, true); ctx.theme({ id: 'att-' + k + '-light', label: label + ' Light', dark: false, vars: l.vars }); ids.push({ id: 'att-' + k + '-light', label: label + ' Light', sw: [l.vars['--bg'], l.vars['--bg-2'], l.vars['--accent'], l.vars['--text']], dark: false, vars: l.vars }); }
    }
    for (const [k, [label, , font, db, lb]] of Object.entries(FT_TF)) {
      for (const [suf, base, nm] of [['', db, label], ['-light', lb, label + ' Light']]) {
        const d = ftFromBase({ bg: base[0], accent: base[1], secondary: base[2], text: base[3] }, font);
        ctx.theme({ id: 'tf-' + k + suf, label: nm, dark: d.dark, group: 'Theme Factory', font, vars: d.vars });
      }
    }
    /* custom themes (Theme Studio) */
    const customOff = {};
    const customs = () => ctx.data.get('custom', []);
    function regCustom(c) { if (customOff[c.id]) try { customOff[c.id](); } catch (e) {} const d = ftFromBase(c.base, c.font); const off = ctx.theme({ id: c.id, label: c.label, dark: d.dark, group: 'Custom', font: c.font, base: c.base, vars: d.vars }); customOff[c.id] = typeof off === 'function' ? off : null; return d; }
    customs().forEach(c => { try { regCustom(c); } catch (e) { ctx.log('warn', 'custom theme ' + c.id + ': ' + e.message); } });
    function saveCustom(spec) {
      const base = Object.assign({}, spec.base); for (const k of ['bg', 'accent', 'secondary', 'text']) if (!/^#[0-9a-f]{3,8}$/i.test(String(base[k] || ''))) throw new Error('bad colour ' + k);
      const label = String(spec.label || 'My theme').slice(0, 40); const id = spec.id && /^custom-/.test(spec.id) ? spec.id : 'custom-' + label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + Date.now().toString(36).slice(-4);
      const c = { id, label, base, font: FT_FONTS[spec.font] ? spec.font : 'system' }; const all = customs().filter(x => x.id !== id); all.push(c); ctx.data.set('custom', all); regCustom(c); return c;
    }
    function deleteCustom(id) { const all = customs(); if (!all.some(x => x.id === id)) return false; ctx.data.set('custom', all.filter(x => x.id !== id)); if (customOff[id]) customOff[id](); delete customOff[id]; if (DS.store.state.settings.theme === id) apply({ color: 'att-dark' }); return true; }
    function exportTheme(id) { const t = themeList().find(x => x.id === id) || themeList().find(x => x.id === DS.store.state.settings.theme); if (!t) return null; const v = t.vars || {}; return { forgeTheme: 1, label: t.label, font: fontFor(t.id), base: t.base || { bg: v['--bg'], accent: v['--accent'], secondary: v['--violet'], text: v['--text'] }, vars: v }; }
    function importTheme(json) { const o = typeof json === 'string' ? JSON.parse(json) : json; if (!o || !o.base) throw new Error('not a Forge theme JSON (needs base{bg,accent,secondary,text})'); return saveCustom({ label: o.label || 'Imported', base: o.base, font: o.font }); }
    /* per-theme heading font override */
    const fontFor = id => { const o = ctx.data.get('fonts', {}); const t = themeList().find(x => x.id === id); return o[id] || (t && t.font) || 'system'; };
    function setFont(id, f) { if (!FT_FONTS[f]) return false; const o = Object.assign({}, ctx.data.get('fonts', {})); o[id || DS.store.state.settings.theme] = f; ctx.data.set('fonts', o); syncFont(); return true; }
    function syncFont() { const id = document.documentElement.dataset.theme || DS.store.state.settings.theme; const f = fontFor(id); document.documentElement.style.setProperty('--font-head-x', FT_FONTS[f][1]); document.documentElement.dataset.fhead = f; }
    ctx.effect(() => { const mo = new MutationObserver(() => { syncFont(); mirror(st()); }); mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] }); return () => { mo.disconnect(); document.documentElement.style.removeProperty('--font-head-x'); delete document.documentElement.dataset.fhead; }; });
    ctx.effect(() => { const s = document.createElement('style'); s.id = 'ft-css'; s.textContent = FT_CSS + FT_CHROME; document.head.appendChild(s); return () => s.remove(); });
    DS.icons.palette = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.7-.8 1.7-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.8-1.7 1.7-1.7H16a5 5 0 0 0 5-5c0-4-4-7.2-9-7.2z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/></svg>';
    const st = () => Object.assign({ color: '', backdrop: 'none', layout: 'default', look: 'none', intensity: 0.7, seed: 1, quality: 'auto', reduced: false }, ctx.data.get('state', {}));
    const root = document.documentElement;
    const bd = () => DS.kernel && DS.services ? null : null; // placeholder (service resolved lazily below)
    let bdSvc = null; ctx.waitFor('forge.backdrops').then(s => { bdSvc = s; applyBackdrop(st()); }).catch(() => {});
    function applyBackdrop(s) { if (bdSvc) try { bdSvc.set(s.backdrop || 'none', { intensity: s.intensity, seed: s.seed, quality: s.quality, reduced: s.reduced }); } catch (e) { ctx.log('warn', 'backdrop: ' + e.message); } }
    function themeList() { return DS.kernel.list('theme'); }
    function apply(o = {}) {
      const s = Object.assign(st(), {}); const bad = [];
      if (o.color != null) { const t = themeList().find(x => x.id === o.color || x.id === 'att-' + o.color || x.label.toLowerCase() === String(o.color).toLowerCase()); if (t) { s.color = t.id; DS.store.state.settings.theme = t.id; DS.store.save(); DS.shell.applyTheme(); } else bad.push('color ' + o.color); }
      if (o.layout != null) { if (FT_LAYOUTS[o.layout]) s.layout = o.layout; else bad.push('layout ' + o.layout); }
      if (o.look != null) { if (FT_LOOKS[o.look]) s.look = o.look; else bad.push('look ' + o.look); }
      for (const k of ['intensity', 'seed', 'quality', 'reduced']) if (o[k] != null) s[k] = o[k];
      if (o.backdrop != null) s.backdrop = o.backdrop;
      root.dataset.layout = s.layout; root.dataset.look = s.look; root.style.setProperty('--fx-intensity', s.intensity);
      ctx.data.set('state', s); mirror(s); applyBackdrop(s); DS.bus.emit('themes:change', s); if (picker) picker();
      return { ok: !bad.length, state: s, unknown: bad };
    }
    /* boot-flash mirror: tiny sync-readable copy for shell <head> (see A16.HANDOFF) */
    function mirror(s) { try { const t = themeList().find(x => x.id === (s.color || DS.store.state.settings.theme)); localStorage.setItem('forge.boot.theme', JSON.stringify({ color: s.color || DS.store.state.settings.theme || '', look: s.look, layout: s.layout, bg: t && t.vars ? t.vars['--bg'] : '', dark: t ? t.dark !== false : true, still: ((DS.kernel.list('backdrop').find(b => b.id === s.backdrop) || {}).still) || '' })); } catch (e) {} }
    function randomLook(seed) { seed = seed == null ? (Math.random() * 1e6) | 0 : seed; const r = (() => { let x = seed | 0; return () => { x = x + 0x6D2B79F5 | 0; let t = Math.imul(x ^ x >>> 15, 1 | x); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; })(); const pick = a => a[(r() * a.length) | 0]; const cols = themeList().filter(t => t.dark !== false); const bds = DS.kernel.list('backdrop').filter(b => b.group === '2d'); return Object.assign(apply({ color: pick(cols).id, look: pick(FT_GLASS), layout: pick(['default', 'center', 'bubbles', 'cinematic', 'compact']), backdrop: bds.length ? pick(bds).id : 'none', seed }), { seed }); }
    function pack(id) { const p = FT_PACKS[id]; if (!p) return null; return apply({ color: p.color, backdrop: p.backdrop, layout: p.layout, look: p.look }); }
    function list() { return { colors: themeList().map(t => ({ id: t.id, label: t.label, dark: t.dark !== false })), layouts: Object.keys(FT_LAYOUTS), looks: Object.keys(FT_LOOKS), packs: Object.keys(FT_PACKS), backdrops: DS.kernel.list('backdrop').map(b => ({ id: b.id, label: b.label, group: b.group })) }; }
    // boot: restore before first paint where possible
    { const s = st(); root.dataset.layout = s.layout; root.dataset.look = s.look; }
    let picker = null;
    function openPicker() { DS.shell.show('themes'); }
    ctx.provide('forge.themes', { apply, pack, randomLook, list, openPicker, state: st, derive: ftDerive, contrast: FT_CR, layouts: FT_LAYOUTS, packs: FT_PACKS, fromBase: ftFromBase, fixContrast: ftFixBase, saveCustom, deleteCustom, customs, exportTheme, importTheme, fonts: FT_FONTS, setFont, fontFor, factory: Object.keys(FT_TF).map(k => 'tf-' + k), openStudio() { DS.shell.show('themes'); setTimeout(() => { const b = document.querySelector('.ft-seg button[data-t=studio]'); if (b) b.click(); }, 30); } });

    ctx.view({ id: 'themes', title: 'Themes', icon: 'palette', order: 90, mount(el) {
      let tab = 'color';
      el.innerHTML = '<div class="vhead"><h2>Themes</h2></div><div class="vscroll"><div class="ft-tabs"><div class="seg ft-seg"><button data-t="color">Colour</button><button data-t="backdrop">Backdrop</button><button data-t="layout">Layout</button><button data-t="studio">Studio</button></div></div><div class="ft-wrap"><div class="sec-t">Quick packs</div><div class="ft-packs"></div><div class="ft-body"></div></div></div>';
      const body = el.querySelector('.ft-body'), seg = el.querySelector('.ft-seg');
      const pk = el.querySelector('.ft-packs');
      for (const [id, p] of Object.entries(FT_PACKS)) { const b = DS.util.el('button', { class: 'btn sm', 'data-pack': id }, DS.util.esc(p.label)); b.onclick = () => { pack(id); DS.ui.toast('Pack → ' + p.label, 'ok'); }; pk.appendChild(b); }
      { const rb = DS.util.el('button', { class: 'btn sm pri ft-rand' }, '🎲 Random look'); rb.onclick = () => { const r = randomLook(); DS.ui.toast('Random look · seed ' + r.seed, 'ok'); }; pk.appendChild(rb); }
      seg.onclick = e => { const b = e.target.closest('button'); if (b) { tab = b.dataset.t; draw(); } };
      function card(on, sw, name, sub, fn, attrs) { const b = DS.util.el('button', Object.assign({ class: 'ft-sw' + (on ? ' on' : '') }, attrs || {}), '<i style="background:' + sw + '"></i><span>' + DS.util.esc(name) + '</span>' + (sub ? '<small>' + DS.util.esc(sub) + '</small>' : '')); b.onclick = fn; return b; }
      function draw() {
        const s = st(); seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.t === tab)); body.innerHTML = '';
        if (tab === 'color') {
          const row = DS.util.el('div', { class: 'ft-row' }, '<label>Look</label>'); const sel = DS.util.el('select', { class: 'sel ft-look' }); for (const [k, v] of Object.entries(FT_LOOKS)) sel.appendChild(DS.util.el('option', { value: k }, v)); sel.value = s.look; sel.onchange = () => apply({ look: sel.value }); row.appendChild(sel); body.appendChild(row);
          { const fr = DS.util.el('div', { class: 'ft-row' }, '<label>Heading font</label>'); const fs = DS.util.el('select', { class: 'sel ft-font' }); for (const [k, v] of Object.entries(FT_FONTS)) fs.appendChild(DS.util.el('option', { value: k }, v[0])); fs.value = fontFor(DS.store.state.settings.theme); fs.onchange = () => { setFont(null, fs.value); DS.ui.toast('Heading font → ' + FT_FONTS[fs.value][0], 'ok'); }; fr.appendChild(fs); const sb = DS.util.el('button', { class: 'btn sm ft-open-studio' }, '✎ Theme Studio'); sb.onclick = () => { tab = 'studio'; draw(); }; fr.appendChild(sb); body.appendChild(fr); }
          const cur = DS.store.state.settings.theme; const groups = {}; themeList().forEach(t => { const gname = t.group || 'Forge'; (groups[gname] = groups[gname] || []).push(t); });
          for (const gname of ['Custom', 'Theme Factory', 'Forge'].concat(Object.keys(groups).filter(x => !['Custom', 'Theme Factory', 'Forge'].includes(x)))) { if (!groups[gname]) continue;
          body.appendChild(DS.util.el('div', { class: 'ft-gt' }, DS.util.esc(gname) + ' · ' + groups[gname].length));
          const g = DS.util.el('div', { class: 'ft-grid', 'data-group': gname });
          groups[gname].forEach(t => { const v = t.vars || {}; const sw = 'linear-gradient(135deg,' + (v['--bg'] || '#111') + ' 0 55%,' + (v['--card'] || v['--bg-2'] || '#222') + ' 55%)'; const c = card(t.id === cur, sw, t.label, t.dark === false ? 'light' : 'dark', () => apply({ color: t.id }), { 'data-color': t.id }); c.querySelector('i').innerHTML = '<b style="background:' + (v['--accent'] || '#888') + '"></b><em class="ft-mini" style="background:linear-gradient(90deg,' + (v['--surface'] || v['--bg-2'] || '#222') + ' 0 14%,transparent 14%),linear-gradient(180deg,' + (v['--surface'] || '#222') + ' 0 16%,transparent 16%);"><u style="background:' + (v['--accent-soft'] || v['--accent'] || '#888') + '"></u><u style="background:' + (v['--card'] || '#333') + '"></u></em>'; c.querySelector('i').style.color = v['--text']; g.appendChild(c); });
          body.appendChild(g); }
        } else if (tab === 'backdrop') {
          const ctl = DS.util.el('div', {}, '<div class="ft-row"><label>Intensity</label><input type="range" min="0" max="1" step="0.05" class="ft-int"></div><div class="ft-row"><label>Quality</label><select class="sel ft-q"><option value="auto">Auto</option><option value="low">Low</option><option value="med">Medium</option><option value="high">High</option></select><label><input type="checkbox" class="ft-rm"> Reduce motion</label></div><div class="ft-row"><label>Seed <b class="mono ft-seed"></b></label><button class="btn sm ft-reroll">Re-roll</button><span class="xs muted ft-info"></span></div>');
          const ri = ctl.querySelector('.ft-int'), q = ctl.querySelector('.ft-q'), rm = ctl.querySelector('.ft-rm');
          ri.value = s.intensity; q.value = s.quality; rm.checked = !!s.reduced; ctl.querySelector('.ft-seed').textContent = s.seed;
          ri.onchange = () => apply({ intensity: +ri.value }); q.onchange = () => apply({ quality: q.value }); rm.onchange = () => apply({ reduced: rm.checked });
          ctl.querySelector('.ft-reroll').onclick = () => apply({ seed: (Math.random() * 1e6) | 0 });
          ctl.querySelector('.ft-info').textContent = bdSvc ? bdSvc.info() : 'backdrops plugin off'; body.appendChild(ctl);
          const g = DS.util.el('div', { class: 'ft-grid' });
          g.appendChild(card(s.backdrop === 'none', 'var(--bg)', 'None', 'off', () => apply({ backdrop: 'none' }), { 'data-bd': 'none' }));
          DS.kernel.list('backdrop').forEach(b => g.appendChild(card(s.backdrop === b.id, b.still || 'var(--card)', b.label, b.group || '', () => apply({ backdrop: b.id }), { 'data-bd': b.id })));
          body.appendChild(g);
        } else if (tab === 'studio') { drawStudio(body);
        } else {
          const g = DS.util.el('div', { class: 'ft-grid' });
          for (const [k, v] of Object.entries(FT_LAYOUTS)) g.appendChild(card(s.layout === k, 'linear-gradient(90deg,var(--card-2) 0 18%,var(--card) 18%)', k[0].toUpperCase() + k.slice(1), v, () => apply({ layout: k }), { 'data-layout': k }));
          body.appendChild(g);
        }
      }

      let sd = null; /* studio draft */
      function drawStudio(body) {
        if (!sd) { const t = themeList().find(x => x.id === DS.store.state.settings.theme) || {}; const v = t.vars || {}; const cs = getComputedStyle(document.documentElement); const g = k => FT_TOHEX(FT_HEX((v[k] || cs.getPropertyValue(k) || '#888').trim().startsWith('#') ? (v[k] || cs.getPropertyValue(k)).trim() : '#888888'));
          sd = { label: 'My ' + (t.label || 'theme'), font: fontFor(t.id), base: (t.base ? Object.assign({}, t.base) : { bg: g('--bg'), accent: g('--accent'), secondary: g('--violet'), text: g('--text') }) }; }
        const w = DS.util.el('div', { class: 'ft-studio' });
        w.innerHTML = '<div class="hint xs muted" style="margin:6px 0">Pick 4 base colours — every other variable is derived. Contrast is checked against WCAG AA.</div>'
          + '<div class="field"><label>Name</label><input class="inp ft-name" maxlength="40"></div>'
          + '<div class="ft-st">' + [['bg', 'Background'], ['accent', 'Accent'], ['secondary', 'Secondary'], ['text', 'Text']].map(([k, l]) => '<label><input type="color" data-k="' + k + '"><span class="grow">' + l + '<br><code></code></span></label>').join('') + '</div>'
          + '<div class="ft-row"><label>Heading font</label><select class="sel ft-sfont">' + Object.entries(FT_FONTS).map(([k, v]) => '<option value="' + k + '">' + v[0] + '</option>').join('') + '</select></div>'
          + '<div class="ft-cr"></div><div class="ft-pv"><div class="h">Preview heading</div><div class="b"><div class="u">Build me a landing page</div><div class="c">Sure — here is a plan. <i>secondary</i><br><small>muted · 2 files</small></div><div class="k">const forge = await DS.ready;</div><div class="a">Accent button</div></div></div>'
          + '<div class="ft-packs" style="margin-top:10px"><button class="btn sm ft-fix">Fix contrast</button><button class="btn sm ft-try">Try live</button><button class="btn sm pri ft-save">Save theme</button><button class="btn sm ft-exp">Export JSON</button><button class="btn sm ft-imp">Import JSON</button></div>'
          + '<div class="ft-gt">Your themes</div><div class="ft-mine"></div>';
        body.appendChild(w);
        const nm = w.querySelector('.ft-name'), pv = w.querySelector('.ft-pv'), cr = w.querySelector('.ft-cr'), sf = w.querySelector('.ft-sfont');
        nm.value = sd.label; nm.oninput = () => { sd.label = nm.value; }; sf.value = sd.font; sf.onchange = () => { sd.font = sf.value; upd(); };
        w.querySelectorAll('input[type=color]').forEach(i => { i.value = sd.base[i.dataset.k]; i.oninput = () => { sd.base[i.dataset.k] = i.value; upd(); }; });
        function upd() {
          const d = ftFromBase(sd.base, sd.font); for (const [k, v] of Object.entries(d.vars)) pv.style.setProperty(k, v);
          w.querySelectorAll('input[type=color]').forEach(i => { i.value = sd.base[i.dataset.k]; i.nextElementSibling.querySelector('code').textContent = sd.base[i.dataset.k]; });
          const tr = FT_CR(sd.base.text, sd.base.bg), ar = FT_CR(sd.base.accent, sd.base.bg);
          cr.innerHTML = '<span class="chip ft-tcr ' + (tr >= 4.5 ? 'ok' : 'err') + '" data-r="' + tr.toFixed(2) + '">Text/bg ' + tr.toFixed(2) + ':1 ' + (tr >= 4.5 ? '✓ AA' : '✗ < 4.5') + '</span><span class="chip ft-acr ' + (ar >= 3 ? 'ok' : 'warn') + '" data-r="' + ar.toFixed(2) + '">Accent/bg ' + ar.toFixed(2) + ':1 ' + (ar >= 3 ? '✓' : '✗ < 3') + '</span><span class="chip">' + (d.dark ? 'dark' : 'light') + '</span>';
        }
        upd();
        w.querySelector('.ft-fix').onclick = () => { sd.base = ftFixBase(sd.base); upd(); DS.ui.toast('Contrast fixed', 'ok'); };
        w.querySelector('.ft-try').onclick = () => { const c = saveCustom({ id: sd.id, label: sd.label, base: sd.base, font: sd.font }); sd.id = c.id; apply({ color: c.id }); };
        w.querySelector('.ft-save').onclick = () => { try { const c = saveCustom({ id: sd.id, label: sd.label, base: sd.base, font: sd.font }); sd.id = c.id; apply({ color: c.id }); DS.ui.toast('Saved “' + c.label + '”', 'ok'); } catch (e) { DS.ui.toast(e.message, 'err'); } };
        w.querySelector('.ft-exp').onclick = () => { const j = JSON.stringify({ forgeTheme: 1, label: sd.label, font: sd.font, base: sd.base, vars: ftFromBase(sd.base, sd.font).vars }, null, 2); try { DS.util.download((sd.label || 'theme').replace(/\W+/g, '-') + '.forge-theme.json', j, 'application/json'); } catch (e) {} try { DS.util.copy(j); } catch (e) {} DS.ui.toast('Theme JSON exported (and copied)', 'ok'); };
        w.querySelector('.ft-imp').onclick = async () => { const j = await DS.ui.promptText('Paste theme JSON', ''); if (!j) return; try { const c = importTheme(j); sd = { id: c.id, label: c.label, base: Object.assign({}, c.base), font: c.font }; apply({ color: c.id }); DS.ui.toast('Imported “' + c.label + '”', 'ok'); } catch (e) { DS.ui.toast('Import failed: ' + e.message, 'err'); } };
        const mine = w.querySelector('.ft-mine'); const cs = customs();
        if (!cs.length) mine.innerHTML = '<div class="xs muted">None yet — save one above.</div>';
        cs.forEach(c => { const r = DS.util.el('div', { class: 'li', 'data-custom': c.id }, '<i style="width:22px;height:22px;border-radius:6px;flex:none;background:linear-gradient(135deg,' + c.base.bg + ' 0 50%,' + c.base.accent + ' 50%)"></i><div class="info"><div class="nm">' + DS.util.esc(c.label) + '</div><div class="ds">' + c.id + '</div></div>');
          const ed = DS.util.el('button', { class: 'btn sm' }, 'Edit'); ed.onclick = () => { sd = { id: c.id, label: c.label, base: Object.assign({}, c.base), font: c.font }; apply({ color: c.id }); };
          const del = DS.util.el('button', { class: 'btn sm danger ft-del' }, 'Delete'); del.onclick = async () => { if (await DS.ui.confirm('Delete theme “' + c.label + '”?', 'Delete')) { deleteCustom(c.id); if (sd && sd.id === c.id) delete sd.id; draw(); } };
          r.appendChild(ed); r.appendChild(del); mine.appendChild(r); });
      }
      picker = draw; draw();
      const off = DS.bus.on('contrib:change', e => { if (e.point === 'backdrop' || e.point === 'theme') draw(); });
      return () => { picker = null; if (typeof off === 'function') off(); };
    } });
    ctx.rail({ id: 'themes', icon: 'palette', label: 'Themes', group: 'bottom', order: 90, run: openPicker });
    ctx.settings({ id: 'themes', title: 'Themes & backdrops', render(el) {
      const s = st(); el.innerHTML = '<div class="hint xs muted">Colour: <b>' + DS.util.esc(DS.store.state.settings.theme || '') + '</b> · layout <b>' + s.layout + '</b> · look <b>' + s.look + '</b> · backdrop <b>' + DS.util.esc(s.backdrop) + '</b></div><div class="ft-packs" style="margin-top:8px"></div><button class="btn sm" style="margin-top:8px">Open theme picker</button>';
      const pk = el.querySelector('.ft-packs'); for (const [id, p] of Object.entries(FT_PACKS)) { const b = DS.util.el('button', { class: 'btn sm' }, DS.util.esc(p.label)); b.onclick = () => pack(id); pk.appendChild(b); }
      el.querySelector('button.btn:last-child').onclick = openPicker;
    } });
    const findBd = n => { n = String(n || '').trim().toLowerCase(); return n === 'none' || n === 'off' ? 'none' : (DS.kernel.list('backdrop').find(b => b.id === n || b.label.toLowerCase() === n) || {}).id; };
    ctx.command({ name: 'backdrop', args: 'name', desc: 'Switch animated backdrop', run(a, c) { const id = findBd(a); if (!id) return c.reply('Backdrops: `none`, ' + DS.kernel.list('backdrop').map(b => '`' + b.id + '`').join(', ')); apply({ backdrop: id }); c.reply('Backdrop → **' + id + '**'); } });
    ctx.command({ name: 'look', args: 'pack|layout', desc: 'Apply a theme pack (liquid, nvidia, cyber, aurora, opal, neural) or layout', run(a, c) { a = a.trim().toLowerCase(); if (FT_PACKS[a]) { pack(a); return c.reply('Pack → **' + FT_PACKS[a].label + '**'); } if (FT_LAYOUTS[a]) { apply({ layout: a }); return c.reply('Layout → **' + a + '**'); } c.reply('Packs: ' + Object.keys(FT_PACKS).map(x => '`' + x + '`').join(', ') + ' · layouts: ' + Object.keys(FT_LAYOUTS).map(x => '`' + x + '`').join(', ')); } });
    ctx.tool({ name: 'theme_apply', label: 'Apply theme', gate: 'none', description: 'Change the Forge UI look. pack = liquid|nvidia|cyber|aurora|opal|neural applies colour+backdrop+layout. Or set color (theme id e.g. att-dracula), backdrop (id or none), layout (' + Object.keys(FT_LAYOUTS).join('|') + ').',
      parameters: { type: 'object', properties: { pack: { type: 'string' }, color: { type: 'string' }, backdrop: { type: 'string' }, layout: { type: 'string' } } },
      run(a) { const r = a.pack ? pack(a.pack) : apply({ color: a.color, backdrop: a.backdrop ? findBd(a.backdrop) || a.backdrop : undefined, layout: a.layout }); if (!r) throw new Error('unknown pack ' + a.pack); return { ok: r.ok, unknown: r.unknown, color: DS.store.state.settings.theme, backdrop: r.state.backdrop, layout: r.state.layout, look: r.state.look }; },
      summarize: (a, r) => [r.color, r.backdrop, r.layout].join(' · ') });
    const T = (re, args, fin) => ({ order: 50, match: t => re.test(t), script: () => [{ say: 'Switching the look…', tool: { name: 'theme_apply', args } }, { final: r => fin + ' (' + ((r[0] && r[0].color) || '') + ', backdrop ' + ((r[0] && r[0].backdrop) || '') + ').' }] });
    ctx.intent(Object.assign({ id: 'theme-liquid' }, T(/liquid ?glass/i, { pack: 'liquid' }, 'Liquid Glass pack applied')));
    ctx.intent(Object.assign({ id: 'theme-cyber' }, T(/cyber ?punk|make it cyber/i, { pack: 'cyber' }, 'Cyberpunk mode on')));
    ctx.intent(Object.assign({ id: 'theme-aurora-bd' }, T(/backdrop (to )?aurora|aurora backdrop/i, { backdrop: 'aurora' }, 'Backdrop switched to Aurora')));
    ctx.intent(Object.assign({ id: 'theme-nvidia' }, T(/nvidia/i, { pack: 'nvidia' }, 'NVIDIA Core pack applied')));
    { const TFRE = new RegExp('(' + Object.values(FT_TF).map(x => x[0]).join('|') + ')', 'i');
      ctx.intent({ id: 'theme-factory', order: 49, match: t => TFRE.test(t) && /theme|apply|switch|use|make/i.test(t), script: t => { const m = t.match(TFRE)[1].toLowerCase(); const k = Object.keys(FT_TF).find(x => FT_TF[x][0].toLowerCase() === m); const light = /light/i.test(t); return [{ say: 'Applying the ' + FT_TF[k][0] + ' theme-factory palette…', tool: { name: 'theme_apply', args: { color: 'tf-' + k + (light ? '-light' : '') } } }, { final: r => '**' + FT_TF[k][0] + (light ? ' Light' : '') + '** applied (' + ((r[0] && r[0].color) || '') + ') with ' + FT_FONTS[FT_TF[k][2]][0].toLowerCase() + ' headings. Open **Themes → Studio** to remix it.' }]; } }); }
    ctx.command({ name: 'studio-theme', desc: 'Open Theme Studio (build a custom theme)', run(a, c) { DS.shell.show('themes'); setTimeout(() => { const b = document.querySelector('.ft-seg button[data-t=studio]'); if (b) b.click(); }, 30); c.reply('Theme Studio opened.'); } });
    ctx.suggest({ id: 'themes-tf', emoji: '🌊', title: 'Apply Ocean Depths', sub: 'Theme Factory palette + font pairing', prompt: 'apply the Ocean Depths theme' });
    ctx.suggest({ id: 'themes', emoji: '🎨', title: 'Make it liquid glass', sub: 'Theme + animated backdrop + layout', prompt: 'apply liquid glass theme' });
    // restore saved state after themes are registered
    ctx.setTimeout(() => { syncFont(); const s = st(); if (s.color && DS.store.state.settings.theme !== s.color && themeList().some(t => t.id === s.color)) { DS.store.state.settings.theme = s.color; DS.shell.applyTheme(); } syncFont(); mirror(st()); }, 0);
  } });

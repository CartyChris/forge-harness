/* ── markdown renderer + fenced-block pipeline ── */
/* ─────────────── markdown ─────────────── */
function safeUrl(u){ u = String(u).trim(); return /^(https?:|mailto:|data:image\/)/i.test(u) ? u : '#'; }
function inline(s){
  const codes = [];
  s = s.replace(/`([^`\n]+)`/g, (_, c) => { codes.push(c); return '\u0000' + (codes.length-1) + '\u0000'; });
  s = esc(s);
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (_, alt, u) => '<img alt="' + alt + '" src="' + esc(safeUrl(u.replace(/&amp;/g,'&'))) + '" loading="lazy">');
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => '<a href="' + esc(safeUrl(u.replace(/&amp;/g,'&'))) + '" target="_blank" rel="noopener noreferrer">' + t + '</a>');
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:!?])/g, (_, p, u) => p + '<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + u + '</a>');
  s = s.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => '<code class="ic">' + esc(codes[+i]) + '</code>');
  return s;
}
function mdBlocks(src){
  const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
  const out = []; let i = 0; let para = [];
  const flush = () => { if (para.length){ out.push('<p>' + para.map(inline).join('<br>') + '</p>'); para = []; } };
  const isTableSep = l => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
  const cells = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
  while (i < lines.length){
    const l = lines[i];
    if (!l.trim()){ flush(); i++; continue; }
    let m;
    if ((m = l.match(/^(#{1,6})\s+(.*)$/))){ flush(); const n = Math.min(4, m[1].length); out.push('<h' + n + '>' + inline(m[2]) + '</h' + n + '>'); i++; continue; }
    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(l)){ flush(); out.push('<hr>'); i++; continue; }
    if (/^\s*>/.test(l)){ flush(); const q = []; while (i < lines.length && /^\s*>/.test(lines[i])){ q.push(lines[i].replace(/^\s*>\s?/, '')); i++; } out.push('<blockquote>' + mdBlocks(q.join('\n')) + '</blockquote>'); continue; }
    if (l.includes('|') && i+1 < lines.length && isTableSep(lines[i+1])){
      flush(); const head = cells(l); i += 2; const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()){ rows.push(cells(lines[i])); i++; }
      out.push('<table><thead><tr>' + head.map(h => '<th>' + inline(h) + '</th>').join('') + '</tr></thead><tbody>' + rows.map(r => '<tr>' + r.map(c => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table>');
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(l)){ flush(); const r = parseList(lines, i); out.push(r.html); i = r.next; continue; }
    para.push(l.trim()); i++;
  }
  flush();
  return out.join('');
}
function parseList(lines, i){
  const base = lines[i].match(/^(\s*)/)[1].length;
  const ordered = /^\s*\d+[.)]/.test(lines[i]);
  const startNum = ordered ? parseInt(lines[i].trim(), 10) : 1;
  const items = [];
  while (i < lines.length){
    const l = lines[i];
    if (!l.trim()){ if (i+1 < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i+1]) && lines[i+1].match(/^(\s*)/)[1].length >= base){ i++; continue; } break; }
    const ind = l.match(/^(\s*)/)[1].length;
    const m = l.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
    if (m && ind === base){ items.push({ text: m[2], sub: '' }); i++; continue; }
    if (ind > base && items.length){
      if (m){ const r = parseList(lines, i); items[items.length-1].sub += r.html; i = r.next; continue; }
      items[items.length-1].text += '\n' + l.trim(); i++; continue;
    }
    break;
  }
  const tag = ordered ? 'ol' : 'ul';
  const task = t => t.replace(/^\[( |x|X)\]\s+/, (_, c) => (c.trim() ? '☑ ' : '☐ '));
  return { html: '<' + tag + (ordered && startNum !== 1 ? ' start="' + startNum + '"' : '') + '>' + items.map(it => '<li>' + inline(task(it.text)).replace(/\n/g, '<br>') + it.sub + '</li>').join('') + '</' + tag + '>', next: i };
}

/* Split into text / fenced-code segments. Unclosed trailing fence → closed:false (streaming). */
function segments(src){
  const lines = String(src || '').split('\n'); const segs = []; let buf = []; let code = null;
  for (const l of lines){
    if (!code){
      const m = l.match(/^\s{0,3}(`{3,}|~{3,})\s*([\w+#.\-]*)\s*(.*)$/);
      if (m){ if (buf.length){ segs.push({ type:'text', text: buf.join('\n') }); buf = []; } code = { type:'code', fence: m[1], lang: (m[2]||'').toLowerCase(), info: m[3]||'', lines: [] }; continue; }
      buf.push(l);
    } else {
      if (new RegExp('^\\s{0,3}' + code.fence[0] + '{' + code.fence.length + ',}\\s*$').test(l)){ segs.push({ type:'code', lang: code.lang, info: code.info, code: code.lines.join('\n'), closed: true }); code = null; continue; }
      code.lines.push(l);
    }
  }
  if (code) segs.push({ type:'code', lang: code.lang, info: code.info, code: code.lines.join('\n'), closed: false });
  if (buf.length && buf.join('').trim()) segs.push({ type:'text', text: buf.join('\n') });
  return segs;
}

const blockRenderers = new Map();
const render = DS.render = {
  markdown: mdBlocks,
  inline,
  segments,
  /* Optional syntax highlighter hook: (code, lang) => html or null */
  highlight: null,
  /* Register a custom renderer for fenced blocks with given language tag(s).
     def.render(el, code, ctx) is called with the SAME element whenever the code or closed-state changes.
     ctx = { lang, info, closed, streaming, msg, chat, index } */
  registerBlock(langs, def){ [].concat(langs).forEach(l => blockRenderers.set(String(l).toLowerCase(), def)); },
  getBlock(lang){ return blockRenderers.get(lang); },
  defaultCode(el, code, ctx){
    if (!el._built){
      el.className = 'cb';
      el.innerHTML = '<div class="cb-h"><span class="lang"></span><button data-copy>' + DS.icon('copy') + 'Copy</button></div><pre><code></code></pre>';
      el.querySelector('[data-copy]').onclick = () => util.copy(el._code || '');
      el._built = true;
    }
    el._code = code;
    el.querySelector('.lang').textContent = ctx.lang || 'text';
    const c = el.querySelector('code');
    let html = null;
    if (render.highlight && (ctx.closed || code.length < 4000)){ try { html = render.highlight(code, ctx.lang); } catch(e){ html = null; } }
    if (html != null) c.innerHTML = html; else c.textContent = code;
  },
  /* Render content into a container, reusing DOM per segment (keeps iframes alive while streaming). */
  into(container, text, ctx={}){
    const segs = segments(text);
    for (let i = 0; i < segs.length; i++){
      const s = segs[i]; let node = container.children[i];
      const key = s.type === 'text' ? 'text' : 'code:' + s.lang;
      if (!node || node._key !== key){
        const fresh = document.createElement('div'); fresh._key = key;
        if (node) container.replaceChild(fresh, node); else container.appendChild(fresh);
        node = fresh;
      }
      if (s.type === 'text'){
        if (node._src !== s.text){ node._src = s.text; node.className = 'md'; node.innerHTML = mdBlocks(s.text); }
      } else {
        const sig = s.code.length + ':' + s.closed + ':' + (s.code.length < 200 ? s.code : s.code.slice(-200));
        if (node._sig !== sig || node._force){
          node._sig = sig; node._force = false;
          const c = Object.assign({}, ctx, { lang: s.lang, info: s.info, closed: s.closed, index: i });
          const def = blockRenderers.get(s.lang) || (DS.kernel && DS.kernel.fence(s.lang));
          try { if (def) def.render(node, s.code, c); else render.defaultCode(node, s.code, c); }
          catch(e){ console.error('block render failed', s.lang, e); render.defaultCode(node, s.code, c); }
        }
      }
    }
    while (container.children.length > segs.length) container.lastChild.remove();
    DS.emit('render:content', { container, text, ctx });
  }
};


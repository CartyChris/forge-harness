/* Forge plugin: IDE — file tree, tabs, Lite/Monaco editor, outline, problems, stack → source, run, AI actions. (I1) */
DS.plugin({
  name: 'forge.ide', title: 'IDE', version: '1.0.0', tags: ['ide', 'editor', 'code', 'debug'],
  description: 'A real IDE view: workspace tree + Forge source, tabs with dirty markers, Lite (offline) or Monaco editor, find/replace, format, outline, problems, run, AI actions and a stack-trace → source navigator.',
  apply(ctx) {
    const U = DS.util, esc = U.esc, IC = DS.icons;
    const SV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">';
    if (!IC.folder) IC.folder = SV + '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
    if (!IC.save) IC.save = SV + '<path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 3v5h8V3M7 21v-7h10v7"/></svg>';
    if (!IC.layers) IC.layers = SV + '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/></svg>';
    const MONACO = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.57.0/min/';
    const LH = 20;
    const base = p => String(p).split('/').pop();
    const extOf = p => { const m = base(p).match(/\.([^.]+)$/); return m ? m[1].toLowerCase() : ''; };
    const LANG = { js: 'js', mjs: 'js', cjs: 'js', jsx: 'jsx', ts: 'ts', tsx: 'tsx', py: 'py', html: 'html', htm: 'html', svg: 'html', xml: 'html', css: 'css', scss: 'css', less: 'css', json: 'json', md: 'md', markdown: 'md', sh: 'sh', bash: 'sh', yml: 'yaml', yaml: 'yaml', sql: 'sql', txt: 'txt' };
    const langOf = p => LANG[extOf(p)] || extOf(p) || 'txt';
    const MLANG = { js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', py: 'python', html: 'html', css: 'css', json: 'json', md: 'markdown', sh: 'shell', yaml: 'yaml', sql: 'sql' };
    const unitOf = lang => lang === 'py' ? '    ' : '  ';
    const lineAt = (s, idx) => { let n = 1; for (let i = 0; i < idx && i < s.length; i++) if (s.charCodeAt(i) === 10) n++; return n; };
    const offsetOfLine = (s, line) => { let i = 0; for (let n = 1; n < line; n++) { const j = s.indexOf('\n', i); if (j < 0) return s.length; i = j + 1; } return i; };
    const isNarrow = () => window.innerWidth < 700;

    /* ═════ state ═════ */
    const S = { tabs: [], active: -1, side: ctx.data.get('side', 'outline'), pane: 'code', openDirs: null, srcOpen: false, problems: [], stackText: '', frames: [], errors: [], usages: null, findOpen: false };
    const engPref = () => ctx.data.get('engine', 'auto');
    let UI = null;
    const cur = () => S.tabs[S.active] || null;
    const dirty = t => !!t && !t.ro && t.value !== t.saved;

    /* ═════ error capture ═════ */
    const onErr = e => { if (!e || e._ideSeen) return; const er = e.error; S.errors.unshift({ ts: Date.now(), msg: String((er && er.message) || e.message || 'error'), stack: (er && er.stack) || (e.filename ? `at ${e.filename}:${e.lineno}:${e.colno}` : '') }); S.errors.length = Math.min(S.errors.length, 30); UI && S.side === 'stack' && UI.drawSide(); };
    const onRej = e => { const r = e && e.reason; S.errors.unshift({ ts: Date.now(), msg: 'Unhandled rejection: ' + String((r && r.message) || r), stack: (r && r.stack) || '' }); S.errors.length = Math.min(S.errors.length, 30); };
    window.addEventListener('error', onErr); window.addEventListener('unhandledrejection', onRej);
    ctx.effect(() => () => { window.removeEventListener('error', onErr); window.removeEventListener('unhandledrejection', onRej); });

    /* ═════ Forge source (from document.scripts) ═════ */
    const PLUG_RE = /\/\* ═══ plugin: ([\w.\-]+) ═══ \*\//;
    function forgeSources() {
      const out = [];
      for (const s of document.scripts) {
        const t = s.text || ''; if (!t) continue;
        if (t.includes('//# sourceURL=forge/core.js')) { out.unshift({ path: 'forge:/core.js', name: 'core.js', text: t, offset: 0 }); continue; }
        const m = t.slice(0, 200).match(PLUG_RE); if (!m) continue;
        const a = t.indexOf('try{\n', m.index); const b = t.lastIndexOf('\n}catch(e){console.error("[plugin file');
        out.push({ path: 'forge:/plugins/' + m[1] + '.js', name: m[1] + '.js', text: t.slice(a + 5, b > a ? b : undefined), offset: 3 });
      }
      return out;
    }

    /* ═════ outline ═════ */
    const KW = /^(if|for|while|switch|catch|function|return|with|else|do|try|new|typeof|await|super|constructor)$/;
    function outline(code, lang) {
      const out = [], lines = String(code).split('\n');
      lines.forEach((l, i) => {
        const n = i + 1; let m;
        if (/^(js|jsx|ts|tsx)$/.test(lang)) {
          if ((m = l.match(/^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([\w$]+)/))) out.push({ name: m[1] + '()', kind: 'fn', line: n, depth: 0 });
          else if ((m = l.match(/^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([\w$]+)/))) out.push({ name: m[1], kind: 'class', line: n, depth: 0 });
          else if ((m = l.match(/^\s*(?:export\s+)?(?:const|let|var)\s+([\w$]+)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*(?::[^=]+)?=>|[\w$]+\s*=>)/))) out.push({ name: m[1] + '()', kind: 'fn', line: n, depth: 0 });
          else if ((m = l.match(/^(\s+)(?:static\s+|async\s+|get\s+|set\s+|public\s+|private\s+|protected\s+)*\*?([\w$]+)\s*\([^)]*\)\s*(?::\s*[\w<>\[\]|, ]+)?\s*\{/)) && !KW.test(m[2])) out.push({ name: m[2] + '()', kind: 'method', line: n, depth: 1 });
          else if ((m = l.match(/^(\s+)([\w$]+)\s*:\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*=>)/))) out.push({ name: m[2] + '()', kind: 'method', line: n, depth: 1 });
        } else if (lang === 'py') {
          if ((m = l.match(/^(\s*)(?:async\s+)?def\s+(\w+)/))) out.push({ name: m[2] + '()', kind: m[1] ? 'method' : 'fn', line: n, depth: Math.min(3, Math.floor(m[1].length / 4)) });
          else if ((m = l.match(/^(\s*)class\s+(\w+)/))) out.push({ name: m[2], kind: 'class', line: n, depth: Math.min(3, Math.floor(m[1].length / 4)) });
        } else if (lang === 'md') {
          if ((m = l.match(/^(#{1,6})\s+(.+)/))) out.push({ name: m[2].replace(/[#*`]/g, '').trim(), kind: 'h' + m[1].length, line: n, depth: m[1].length - 1 });
        } else if (lang === 'css') {
          if ((m = l.match(/^\s*(@media[^{]*|@keyframes\s+[\w-]+|@supports[^{]*|[^{}@\/\s][^{};]*?)\s*\{/))) out.push({ name: m[1].trim().slice(0, 60), kind: m[1][0] === '@' ? 'at' : 'sel', line: n, depth: /^\s+/.test(l) ? 1 : 0 });
        } else if (lang === 'html') {
          const re = /<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>|\bid=["']([^"']+)["']|<(script|style)\b/gi; let x;
          while ((x = re.exec(l))) { if (x[1]) out.push({ name: x[2].replace(/<[^>]+>/g, '').trim().slice(0, 60) || x[1], kind: x[1].toLowerCase(), line: n, depth: +x[1][1] - 1 }); else if (x[3]) out.push({ name: '#' + x[3], kind: 'id', line: n, depth: 0 }); else out.push({ name: '<' + x[4].toLowerCase() + '>', kind: 'tag', line: n, depth: 0 }); }
        }
      });
      return out;
    }

    /* ═════ problems ═════ */
    const AF = Object.getPrototypeOf(async function () {}).constructor;
    const tryParse = src => { try { new AF(src); return null; } catch (e) { return e; } };
    function jsProblems(code) {
      if (/^\s*(import|export)\b/m.test(code)) return [{ sev: 'info', line: 1, msg: 'ES module syntax (import/export) — module syntax not checked' }];
      const e = tryParse(code); if (!e) return [];
      if (!(e instanceof SyntaxError)) return [{ sev: 'warn', line: 1, msg: String(e.message) }];
      let line = e.lineNumber ? e.lineNumber - 2 : 0, col = e.columnNumber || 0;
      if (!line) { /* V8 gives no position: bisect for the shortest line-prefix that fails with the same message */
        const ls = code.split('\n'); let lo = 1, hi = ls.length;
        while (lo < hi) { const mid = (lo + hi) >> 1; const pe = tryParse(ls.slice(0, mid).join('\n')); if (pe && pe.message === e.message) hi = mid; else lo = mid + 1; }
        const pe = tryParse(ls.slice(0, lo).join('\n')); line = pe && pe.message === e.message ? lo : ls.length;
      }
      return [{ sev: 'error', line, col, msg: 'SyntaxError: ' + e.message }];
    }
    function jsonProblems(code) {
      if (!code.trim()) return [];
      try { JSON.parse(code); return []; } catch (e) {
        const msg = String(e.message); let line = 1, col = 0, m;
        if ((m = msg.match(/line (\d+) column (\d+)/))) { line = +m[1]; col = +m[2]; } else if ((m = msg.match(/position (\d+)/))) { const p = +m[1]; line = lineAt(code, p); col = p - offsetOfLine(code, line) + 1; }
        return [{ sev: 'error', line, col, msg }];
      }
    }
    const VOID = /^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr|!doctype)$/i, OPT = /^(p|li|td|th|tr|option|dt|dd|thead|tbody|tfoot|colgroup|html|head|body|optgroup|rt|rp)$/i;
    function htmlProblems(code) {
      const out = [], st = []; const re = /<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>|<(\/?)([a-zA-Z][\w-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*?(\/?)>/gi; let m;
      while ((m = re.exec(code))) {
        if (!m[3]) continue; const tag = m[3].toLowerCase(); if (VOID.test(tag) || m[4]) continue;
        if (!m[2]) { st.push({ tag, idx: m.index }); continue; }
        let k = st.length - 1; while (k >= 0 && st[k].tag !== tag) k--;
        if (k < 0) { out.push({ sev: 'warn', line: lineAt(code, m.index), msg: 'Stray closing tag </' + tag + '>' }); continue; }
        while (st.length > k + 1) { const u = st.pop(); if (!OPT.test(u.tag)) out.push({ sev: 'error', line: lineAt(code, u.idx), msg: '<' + u.tag + '> is not closed before </' + tag + '>' }); }
        st.pop();
      }
      st.forEach(u => { if (!OPT.test(u.tag)) out.push({ sev: 'error', line: lineAt(code, u.idx), msg: 'Unclosed <' + u.tag + '>' }); });
      return out.sort((a, b) => a.line - b.line);
    }
    function cssProblems(code) {
      let d = 0; const out = []; const s = code.replace(/\/\*[\s\S]*?\*\//g, c => c.replace(/[^\n]/g, ' ')).replace(/(["'])(?:\\.|(?!\1).)*\1/g, '""');
      for (let i = 0; i < s.length; i++) { if (s[i] === '{') d++; else if (s[i] === '}') { d--; if (d < 0) { out.push({ sev: 'error', line: lineAt(s, i), msg: 'Unmatched }' }); d = 0; } } }
      if (d > 0) out.push({ sev: 'error', line: s.split('\n').length, msg: d + ' unclosed {' });
      return out;
    }
    function problemsFor(t) {
      if (!t) return []; const c = t.value;
      try {
        if (t.ro) return [];
        if (t.lang === 'js') return jsProblems(c);
        if (t.lang === 'json') return jsonProblems(c);
        if (t.lang === 'html') return htmlProblems(c);
        if (t.lang === 'css') return cssProblems(c);
        if (/^(ts|tsx|jsx)$/.test(t.lang)) return [{ sev: 'info', line: 1, msg: t.lang.toUpperCase() + ' — syntax not checked in Lite (use Monaco for type checks)' }];
      } catch (e) { return [{ sev: 'warn', line: 1, msg: 'checker failed: ' + e.message }]; }
      return [];
    }

    /* ═════ formatting ═════ */
    const strip = s => s.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""').replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
    function reindent(code, lang) {
      const unit = unitOf(lang); let d = 0; const html = lang === 'html'; let inCm = false;
      return code.split('\n').map(line => {
        const t = line.trim(); if (!t) return '';
        if (inCm) { if (t.includes('*/')) inCm = false; return unit.repeat(d) + (t[0] === '*' ? ' ' : '') + t; }
        const s = strip(t); if (/\/\*/.test(s) && !/\*\//.test(s)) inCm = true;
        let lead = (s.match(/^[\}\]\)]+/) || [''])[0].length;
        let opens = (s.match(/[\{\[\(]/g) || []).length, closes = (s.match(/[\}\]\)]/g) || []).length;
        if (html) {
          const tags = [...s.matchAll(/<(\/?)([a-zA-Z][\w-]*)\b[^>]*?(\/?)>/g)]; let leadTags = 0, i = 0;
          const lt = s.match(/^(<\/[a-zA-Z][\w-]*\s*>\s*)+/); if (lt) leadTags = (lt[0].match(/<\//g) || []).length;
          for (const g of tags) { if (VOID.test(g[2]) || g[3]) continue; if (g[1]) closes++; else opens++; i++; }
          lead += leadTags;
        }
        const curD = Math.max(0, d - lead); d = Math.max(0, d + opens - closes);
        return unit.repeat(curD) + t;
      }).join('\n');
    }
    function format(t) {
      if (t.lang === 'json') return JSON.stringify(JSON.parse(t.value), null, 2) + (t.value.endsWith('\n') ? '\n' : '');
      if (/^(js|jsx|ts|tsx|css|html)$/.test(t.lang)) return reindent(t.value, t.lang);
      throw new Error('No formatter for .' + t.lang);
    }

    /* ═════ stack parsing ═════ */
    function parseStack(text) {
      const frames = [];
      for (const raw of String(text || '').split('\n')) {
        const l = raw.trim(); if (!l) continue; let m, fn = (l.match(/^at\s+(?:async\s+)?([^\s(]+)\s+\(/) || l.match(/^([\w$.<>]+)@/) || [])[1] || '';
        if ((m = l.match(/forge\/plugins\/([\w.\-]+)\.js:(\d+)(?::(\d+))?/))) frames.push({ fn, kind: 'plugin', path: 'forge:/plugins/' + m[1] + '.js', label: m[1] + '.js', line: Math.max(1, +m[2] - 3), col: +(m[3] || 0), raw: l });
        else if ((m = l.match(/forge\/core\.js:(\d+)(?::(\d+))?/))) frames.push({ fn, kind: 'core', path: 'forge:/core.js', label: 'core.js', line: +m[1], col: +(m[2] || 0), raw: l });
        else if ((m = l.match(/(?<![\w.:\/])(\/[\w.\-]+(?:\/[\w.\-]+)*\.\w+):(\d+)(?::(\d+))?/))) frames.push({ fn, kind: 'vfs', path: m[1], label: m[1], line: +m[2], col: +(m[3] || 0), raw: l });
      }
      return frames;
    }

    /* ═════ Lite engine ═════ */
    function liteEngine(host, hooks) {
      const root = U.el('div', { class: 'ide-lite' });
      root.innerHTML = '<div class="ide-in"><div class="ide-gut"></div><div class="ide-code"><div class="ide-cur"></div><div class="ide-flash"></div><div class="ide-marks"></div><pre class="ide-hl"></pre><textarea spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" wrap="off" aria-label="Code editor"></textarea></div></div>';
      host.appendChild(root);
      const ta = root.querySelector('textarea'), pre = root.querySelector('pre'), gut = root.querySelector('.ide-gut'), curEl = root.querySelector('.ide-cur'), flash = root.querySelector('.ide-flash'), marks = root.querySelector('.ide-marks');
      let lang = 'txt', raf = 0, lastLines = -1;
      const paint = () => {
        raf = 0; const v = ta.value; let h = null;
        if (v.length < 300000) { try { h = DS.render.highlight ? DS.render.highlight(v, lang) : null; } catch (_) { h = null; } }
        pre.innerHTML = (h || esc(v)) + ' ';
        const n = v.split('\n').length; if (n !== lastLines) { lastLines = n; let g = ''; for (let i = 1; i <= n; i++) g += i + '\n'; gut.textContent = g; }
      };
      const sched = () => { if (!raf) raf = requestAnimationFrame(paint); };
      const pos = () => { const o = ta.selectionStart, v = ta.value; const line = lineAt(v, o); return { line, col: o - offsetOfLine(v, line) + 1, offset: o }; };
      const markCur = () => { const p = pos(); curEl.style.top = (8 + (p.line - 1) * LH) + 'px'; hooks.cursor && hooks.cursor(p); };
      const changed = () => { sched(); markCur(); hooks.change && hooks.change(); };
      const insert = text => { ta.focus(); if (!document.execCommand || !document.execCommand('insertText', false, text)) { ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end'); } changed(); };
      ta.addEventListener('input', changed);
      ['keyup', 'click', 'focus'].forEach(ev => ta.addEventListener(ev, markCur));
      ta.addEventListener('keydown', e => {
        if (ta.readOnly) return; const unit = unitOf(lang);
        if (e.key === 'Tab') {
          e.preventDefault(); const v = ta.value, s = ta.selectionStart, en = ta.selectionEnd;
          if (s !== en && v.slice(s, en).includes('\n') || e.shiftKey) {
            const ls = offsetOfLine(v, lineAt(v, s)), le = v.indexOf('\n', en - (en > s && v[en - 1] === '\n' ? 1 : 0)); const end = le < 0 ? v.length : le;
            const block = v.slice(ls, end); const nb = block.split('\n').map(l => e.shiftKey ? l.replace(new RegExp('^( {1,' + unit.length + '}|\\t)'), '') : unit + l).join('\n');
            ta.setSelectionRange(ls, end); insert(nb); ta.setSelectionRange(ls, ls + nb.length);
          } else insert(unit);
          return;
        }
        if (e.key === 'Enter' && !e.isComposing && !e.metaKey && !e.ctrlKey) {
          e.preventDefault(); const v = ta.value, s = ta.selectionStart; const ls = offsetOfLine(v, lineAt(v, s)); const lineTxt = v.slice(ls, s); const ind = (lineTxt.match(/^[ \t]*/) || [''])[0];
          const before = lineTxt.trimEnd().slice(-1), after = v[ta.selectionEnd] || '';
          const open = /[\{\[\(]/.test(before) || (lang === 'py' && before === ':') || (lang === 'html' && /<([a-zA-Z][\w-]*)[^>]*>$/.test(lineTxt) && !VOID.test((lineTxt.match(/<([a-zA-Z][\w-]*)[^>]*>$/) || [])[1] || 'br'));
          if (open && /[\}\]\)<]/.test(after)) { insert('\n' + ind + unit + '\n' + ind); const p = ta.selectionStart - 1 - ind.length; ta.setSelectionRange(p, p); markCur(); }
          else insert('\n' + ind + (open ? unit : ''));
        }
      });
      const api = {
        kind: 'lite', root,
        load(t) { lang = t.lang; ta.value = t.value; ta.readOnly = !!t.ro; root.classList.toggle('ro', !!t.ro); lastLines = -1; paint(); flash.classList.remove('on'); const o = Math.min(t.sel || 0, t.value.length); ta.setSelectionRange(o, o); root.scrollTop = t.scroll || 0; markCur(); },
        save(t) { t.sel = ta.selectionStart; t.scroll = root.scrollTop; },
        value: () => ta.value,
        setValue(v) { ta.focus(); ta.select(); insert(v); ta.setSelectionRange(0, 0); },
        pos, selText: () => ta.value.slice(ta.selectionStart, ta.selectionEnd),
        word() { const v = ta.value, o = ta.selectionStart; const l = v.slice(0, o).match(/[\w$]*$/)[0], r = v.slice(o).match(/^[\w$]*/)[0]; return (ta.selectionEnd > o ? v.slice(o, ta.selectionEnd) : l + r).trim(); },
        select(a, b) { ta.focus({ preventScroll: true }); ta.setSelectionRange(a, b); const ln = lineAt(ta.value, a); api.reveal(ln); markCur(); },
        replaceRange(a, b, text) { ta.focus({ preventScroll: true }); ta.setSelectionRange(a, b); insert(text); },
        reveal(line) { const y = 8 + (line - 1) * LH; if (y < root.scrollTop + 10 || y > root.scrollTop + root.clientHeight - 40) root.scrollTop = Math.max(0, y - root.clientHeight / 2); },
        goto(line, col, doFlash) {
          const v = ta.value; line = Math.max(1, Math.min(line || 1, v.split('\n').length)); const o = Math.min(offsetOfLine(v, line) + Math.max(0, (col || 1) - 1), v.length);
          if (!matchMedia('(pointer:coarse)').matches) ta.focus({ preventScroll: true });
          ta.setSelectionRange(o, o); root.scrollTop = Math.max(0, 8 + (line - 1) * LH - root.clientHeight / 2); markCur();
          if (doFlash) { flash.style.top = (8 + (line - 1) * LH) + 'px'; flash.dataset.line = line; flash.classList.remove('on'); void flash.offsetWidth; flash.classList.add('on'); }
        },
        marks(list) { marks.innerHTML = (list || []).filter(p => p.line && p.sev !== 'info').map(p => `<div class="ide-mk ${p.sev}" style="top:${8 + (p.line - 1) * LH}px" title="${esc(p.msg)}"></div>`).join(''); },
        focus() { ta.focus(); },
        destroy() { cancelAnimationFrame(raf); root.remove(); }
      };
      return api;
    }

    /* ═════ Monaco engine (lazy, optional) ═════ */
    let monacoP = null;
    function loadMonaco() {
      if (window.monaco && window.monaco.editor) return Promise.resolve(window.monaco);
      if (monacoP) return monacoP;
      monacoP = new Promise((res, rej) => {
        self.MonacoEnvironment = { getWorkerUrl: () => 'data:text/javascript;charset=utf-8,' + encodeURIComponent(`self.MonacoEnvironment={baseUrl:'${MONACO}'};importScripts('${MONACO}vs/base/worker/workerMain.js');`) };
        const tm = setTimeout(() => rej(new Error('Monaco load timed out')), 15000);
        const go = () => { try { window.require.config({ paths: { vs: MONACO + 'vs' } }); window.require(['vs/editor/editor.main'], () => { clearTimeout(tm); try { if (window.define && window.define.amd) window.define.amd = undefined; } catch (_) {} window.monaco ? res(window.monaco) : rej(new Error('monaco global missing')); }, err => { clearTimeout(tm); rej(err instanceof Error ? err : new Error('Monaco modules failed')); }); } catch (e) { clearTimeout(tm); rej(e); } };
        if (window.require && window.require.config) return go();
        const s = document.createElement('script'); s.src = MONACO + 'vs/loader.js'; s.onload = go; s.onerror = () => { clearTimeout(tm); s.remove(); rej(new Error('Monaco CDN unreachable')); }; document.head.appendChild(s);
      }).catch(e => { monacoP = null; throw e; });
      return monacoP;
    }
    function monacoEngine(host, hooks, monaco) {
      const root = U.el('div', { class: 'ide-mon' }); host.appendChild(root);
      const bg = getComputedStyle(document.body).backgroundColor.match(/\d+/g) || [0, 0, 0]; const dark = (+bg[0] + +bg[1] + +bg[2]) < 384;
      const ed = monaco.editor.create(root, { value: '', automaticLayout: true, theme: dark ? 'vs-dark' : 'vs', fontSize: 13, minimap: { enabled: window.innerWidth > 1100 }, scrollBeyondLastLine: false, tabSize: 2 });
      const models = new Map(); let deco = [], flashDeco = [];
      ed.onDidChangeModelContent(() => hooks.change && hooks.change());
      ed.onDidChangeCursorPosition(e => hooks.cursor && hooks.cursor({ line: e.position.lineNumber, col: e.position.column }));
      const model = t => { let m = models.get(t.path); if (!m || m.isDisposed()) { m = monaco.editor.createModel(t.value, MLANG[t.lang] || 'plaintext'); models.set(t.path, m); } else if (m.getValue() !== t.value) m.setValue(t.value); return m; };
      const api = {
        kind: 'monaco', root,
        load(t) { ed.setModel(model(t)); ed.updateOptions({ readOnly: !!t.ro }); if (t.view) ed.restoreViewState(t.view); },
        save(t) { t.view = ed.saveViewState(); },
        value: () => ed.getValue(),
        setValue(v) { const m = ed.getModel(); ed.executeEdits('ide', [{ range: m.getFullModelRange(), text: v }]); },
        pos() { const p = ed.getPosition() || { lineNumber: 1, column: 1 }; return { line: p.lineNumber, col: p.column, offset: ed.getModel().getOffsetAt(p) }; },
        selText: () => ed.getModel().getValueInRange(ed.getSelection()),
        word() { const s = api.selText(); if (s) return s.trim(); const w = ed.getModel().getWordAtPosition(ed.getPosition() || { lineNumber: 1, column: 1 }); return w ? w.word : ''; },
        select(a, b) { const m = ed.getModel(), p = m.getPositionAt(a), q = m.getPositionAt(b); ed.setSelection(new monaco.Range(p.lineNumber, p.column, q.lineNumber, q.column)); ed.revealLineInCenter(p.lineNumber); ed.focus(); },
        replaceRange(a, b, text) { const m = ed.getModel(), p = m.getPositionAt(a), q = m.getPositionAt(b); ed.executeEdits('ide', [{ range: new monaco.Range(p.lineNumber, p.column, q.lineNumber, q.column), text }]); },
        goto(line, col, doFlash) { ed.revealLineInCenter(line); ed.setPosition({ lineNumber: line, column: col || 1 }); ed.focus(); if (doFlash) flashDeco = ed.deltaDecorations(flashDeco, [{ range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, className: 'ide-mflash' } }]); },
        marks(list) { deco = ed.deltaDecorations(deco, (list || []).filter(p => p.line && p.sev !== 'info').map(p => ({ range: new monaco.Range(p.line, 1, p.line, 1), options: { isWholeLine: true, className: 'ide-merr', hoverMessage: { value: p.msg } } }))); },
        focus() { ed.focus(); },
        dropModel(path) { const m = models.get(path); if (m && ed.getModel() !== m) { try { m.dispose(); } catch (_) {} models.delete(path); } },
        destroy() { try { ed.dispose(); models.forEach(m => m.dispose()); } catch (_) {} root.remove(); }
      };
      return api;
    }

    /* ═════ file ops ═════ */
    async function readFor(path) {
      if (path.startsWith('forge:')) { const s = forgeSources().find(x => x.path === path); if (!s) throw new Error('no Forge source ' + path); return { content: s.text, ro: true }; }
      const f = await DS.fs.read(path); if (DS.fs.isBinary(f.content)) throw new Error('binary file — open it in Files'); return { content: f.content, ro: false };
    }
    async function open(path, o = {}) {
      path = String(path || '').trim(); if (!path) return null;
      const m = path.match(/^(.*?):(\d+)(?::(\d+))?$/); if (m && !o.line) { path = m[1]; o = Object.assign({}, o, { line: +m[2], col: +(m[3] || 0) }); }
      if (!path.startsWith('forge:')) path = DS.fs.norm(path);
      let i = S.tabs.findIndex(t => t.path === path);
      if (i < 0) {
        let r; try { r = await readFor(path); } catch (e) { ctx.toast('Cannot open ' + path + ': ' + e.message, 'err'); return null; }
        S.tabs.push({ path, title: base(path), lang: langOf(path), ro: r.ro, saved: r.content, value: r.content, sel: 0, scroll: 0 }); i = S.tabs.length - 1;
      }
      if (o.show !== false && DS.shell && DS.shell.show) { try { DS.shell.show('ide'); } catch (_) {} }
      activate(i);
      if (o.line) { S.pane = 'code'; UI && UI.layout(); const go = () => UI && UI.eng && UI.eng.goto(o.line, o.col, true); go(); setTimeout(go, 60); }
      return S.tabs[i];
    }
    function activate(i) {
      if (UI && UI.eng && cur()) { cur().value = UI.eng.value(); UI.eng.save(cur()); }
      S.active = Math.max(-1, Math.min(i, S.tabs.length - 1)); if (UI) UI.showTab();
    }
    async function save(t = cur(), quiet) {
      if (!t || t.ro) { t && t.ro && ctx.toast('Read-only: Forge source cannot be saved', 'warn'); return false; }
      if (UI && UI.eng && t === cur()) t.value = UI.eng.value();
      if (!dirty(t)) return true;
      let before = null; try { before = (await DS.fs.exists(t.path)) ? (await DS.fs.read(t.path)).content : null; } catch (_) {}
      if (before != null && t.saved != null && before !== t.saved && !(await DS.ui.confirm(t.title + ' changed on disk since you opened it (maybe the agent edited it). Overwrite with your version?', 'Overwrite'))) return false;
      const th = DS.store.activeThread() || DS.store.newThread();
      try { DS.agent.recordChange(th, t.path, before); DS.store.save && DS.store.save(); await DS.fs.write(t.path, t.value); t.saved = t.value; quiet || ctx.toast('Saved ' + t.title, 'ok', 1200); UI && UI.drawTabs(); return true; }
      catch (e) { ctx.toast('Save failed: ' + e.message, 'err'); return false; }
    }
    async function saveAll() { let n = 0; for (const t of S.tabs) if (dirty(t) || t === cur()) { if (dirty(t) && await save(t, true)) n++; } ctx.toast(n ? 'Saved ' + n + ' file' + (n > 1 ? 's' : '') : 'Nothing to save', n ? 'ok' : 'info', 1200); }
    async function closeTab(i) {
      const t = S.tabs[i]; if (!t) return; if (UI && UI.eng && t === cur()) t.value = UI.eng.value();
      if (dirty(t) && !await DS.ui.confirm('Discard unsaved changes to ' + t.title + '?', 'Discard')) return;
      S.tabs.splice(i, 1); try { UI && UI.eng && UI.eng.dropModel && UI.eng.dropModel(t.path); } catch (_) {} if (S.active >= S.tabs.length || S.active > i) S.active--; if (S.active < 0 && S.tabs.length) S.active = 0;
      UI && UI.showTab(true);
    }

    /* ═════ run + AI ═════ */
    function outSheet(title, html) { const box = U.el('div', { class: 'ide-out' }, html); DS.ui.sheet({ title, node: box, full: true }); return box; }
    async function run() {
      const t = cur(); if (!t) return; if (UI && UI.eng) t.value = UI.eng.value(); const code = t.value;
      if (t.lang === 'html') { const box = U.el('div', { class: 'ide-prev' }); box.appendChild(U.sandboxFrame(code)); DS.ui.sheet({ title: 'Preview · ' + t.title, node: box, full: true, noPad: true }); return; }
      const tool = t.lang === 'py' ? 'run_py' : /^(js|mjs)$/.test(t.lang) ? 'run_js' : null;
      if (!tool) return ctx.toast('Run supports .html, .js and .py', 'warn');
      const tl = DS.agent.tool(tool); if (!tl) return ctx.toast(tool + ' tool unavailable (enable forge.devtools)', 'err');
      const box = outSheet('Run · ' + t.title, '<div class="muted sm">Running…</div>');
      try {
        const th = DS.store.activeThread(); const r = await tl.run({ code }, { thread: th, signal: new AbortController().signal, msg: null, part: null, log() {}, update() {}, fs: DS.fs }) || {};
        const logs = (r.logs || []).map(l => typeof l === 'string' ? l : (l && (l.text || l.args)) ? [].concat(l.text || l.args).join(' ') : JSON.stringify(l)).join('\n');
        box.innerHTML = `<div class="xs muted">${tool} · ${r.ms != null ? r.ms + ' ms' : ''}</div>${logs || r.stdout ? `<pre class="ide-o">${esc(logs || r.stdout)}</pre>` : ''}${r.result !== undefined ? `<pre class="ide-o res">⇒ ${esc(typeof r.result === 'string' ? r.result : JSON.stringify(r.result, null, 2))}</pre>` : ''}${r.error ? `<pre class="ide-o err">${esc(r.error)}</pre>` : ''}${!logs && !r.stdout && r.result === undefined && !r.error ? '<div class="muted sm">(no output)</div>' : ''}`;
        if (r.error) { const fr = parseStack(r.error); if (fr.length) ctx.toast('Error has ' + fr.length + ' frame(s) — see Stack', 'warn'); }
      } catch (e) { box.innerHTML = `<pre class="ide-o err">${esc(e.message)}</pre>`; }
    }
    function ai(kind) {
      const t = cur(); if (!t) return ctx.toast('Open a file first', 'warn'); if (UI && UI.eng) t.value = UI.eng.value();
      const sel = UI && UI.eng ? UI.eng.selText() : ''; const body = (sel || t.value).slice(0, 14000); const fence = '```' + t.lang + '\n' + body + '\n```';
      const where = (sel ? 'this selection from' : 'the file') + ' `' + t.path + '`';
      const probs = S.problems.filter(p => p.sev !== 'info').map(p => '- line ' + p.line + ': ' + p.msg).join('\n');
      const text = { explain: `Explain ${where} — what it does, how it is structured, and anything risky.\n\n${fence}`,
        fix: `Fix the problems in \`${t.path}\`${probs ? ':\n' + probs : ' (look for bugs and syntax errors)'}.\nUse the file tools to write the corrected file.\n\n${fence}`,
        refactor: `Refactor ${where} for clarity and maintainability without changing behaviour. Explain the changes, then write the result back to \`${t.path}\` with the file tools.\n\n${fence}`,
        tests: `Write tests for ${where}. Put them in a sensible test file next to it and show how to run them.\n\n${fence}` }[kind];
      try { DS.shell.show('thread'); } catch (_) {}
      if (DS.threadView && DS.threadView.submit) DS.threadView.submit(text);
      else { const th = DS.store.activeThread() || DS.store.newThread(); DS.agent.run(th, text); }
    }
    async function findUsages(word) {
      word = String(word || '').trim(); if (!word) return ctx.toast('Put the cursor on a word', 'warn');
      let hits = []; try { hits = await DS.fs.search('(^|[^\\w$])' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^\\w$])', { regex: true, ci: false, max: 200 }); } catch (e) { return ctx.toast(e.message, 'err'); }
      S.usages = { word, hits }; S.side = 'outline'; S.pane = isNarrow() ? 'outline' : S.pane; UI && (UI.layout(), UI.drawSide());
    }

    /* ═════ view ═════ */
    function mount(el) {
      el.classList.add('ide-host');
      el.innerHTML = `<div class="ide" data-pane="code">
        <div class="ide-top"><button class="icon-btn ide-tt" data-a="tree" title="Toggle file tree" aria-label="Toggle file tree">${IC.folder}</button><b class="ide-ttl">IDE</b><span class="grow"></span>
          <button class="btn sm" data-a="save" title="Save (⌘S)">${IC.save}<span>Save</span></button><button class="btn sm" data-a="run" title="Run">${IC.play}<span>Run</span></button><button class="btn sm" data-a="find" title="Find & replace (⌘F)">${IC.search}<span class="hn">Find</span></button><button class="btn sm" data-a="ai" title="AI actions">${IC.sparkle}<span class="hn">AI</span></button><button class="icon-btn" data-a="more" aria-label="More">${IC.more}</button></div>
        <div class="ide-main"><div class="ide-tree"></div>
          <div class="ide-center"><div class="ide-tabs" role="tablist"></div>
            <div class="ide-find" hidden><input class="inp" data-f="q" placeholder="Find" aria-label="Find"><input class="inp" data-f="r" placeholder="Replace" aria-label="Replace"><button class="chip" data-f="re" title="Regex">.*</button><button class="chip" data-f="cs" title="Match case">Aa</button><button class="btn sm" data-f="next">Next</button><button class="btn sm" data-f="one">Replace</button><button class="btn sm" data-f="all">All</button><span class="xs muted" data-f="n"></span></div>
            <div class="ide-ed"></div><div class="ide-st"><span data-s="pos"></span><span data-s="lang"></span><span data-s="eng"></span><span class="grow"></span><span data-s="prob"></span></div></div>
          <div class="ide-side"><div class="seg ide-sseg"><button data-s="outline">Outline</button><button data-s="problems">Problems</button><button data-s="stack">Stack</button></div><div class="ide-sbody"></div></div></div>
        <div class="seg ide-sw"><button data-p="files">Files</button><button data-p="code">Code</button><button data-p="outline">Outline</button><button data-p="problems">Problems</button><button data-p="stack">Stack</button></div></div>`;
      const $ = s => el.querySelector(s); const ide = $('.ide'), tree = $('.ide-tree'), tabs = $('.ide-tabs'), edHost = $('.ide-ed'), side = $('.ide-sbody'), fbar = $('.ide-find');
      let treeHidden = !!ctx.data.get('treeHidden', false), findRe = false, findCs = false;
      const ui = UI = { eng: null };
      const refresh = U.debounce(() => { const t = cur(); if (!t) return; S.problems = problemsFor(t); ui.eng && ui.eng.marks(S.problems); ui.drawStatus(); if (S.side !== 'stack' || isNarrow()) ui.drawSide(); }, 350);
      const hooks = { change: () => { const t = cur(); if (!t || !ui.eng) return; t.value = ui.eng.value(); ui.markDirty(); refresh(); }, cursor: p => { const s = el.querySelector('[data-s="pos"]'); if (s) s.textContent = 'Ln ' + p.line + ', Col ' + p.col; } };
      function makeEngine(kind, monaco) { const t = cur(); if (ui.eng) { t && ui.eng.save(t); ui.eng.destroy(); } edHost.innerHTML = ''; ui.eng = kind === 'monaco' ? monacoEngine(edHost, hooks, monaco) : liteEngine(edHost, hooks); ui.drawStatus(); }
      const wantMonaco = () => { const p = engPref(); return p === 'monaco' || (p === 'auto' && matchMedia('(pointer:fine)').matches && navigator.onLine !== false && window.innerWidth >= 900); };
      ui.applyEngine = () => {
        if (!wantMonaco()) { if (!ui.eng || ui.eng.kind !== 'lite') { makeEngine('lite'); ui.showTab(); } return; }
        if (!ui.eng) { makeEngine('lite'); ui.showTab(); }
        ui.monacoLoading = true; ui.drawStatus();
        loadMonaco().then(mon => { ui.monacoLoading = false; if (UI !== ui || !wantMonaco()) return; if (cur() && ui.eng) cur().value = ui.eng.value(); makeEngine('monaco', mon); ui.showTab(); })
          .catch(e => { ui.monacoLoading = false; ui.drawStatus(); if (UI === ui) ctx.toast('Monaco unavailable (' + (e && e.message || e) + ') — using Lite editor', 'warn', 2600); });
      };
      ui.layout = () => {
        const n = isNarrow(); ide.classList.toggle('narrow', n); ide.dataset.pane = n ? S.pane : 'code'; ide.classList.toggle('notree', !n && treeHidden);
        el.querySelectorAll('.ide-sw [data-p]').forEach(b => b.classList.toggle('on', b.dataset.p === S.pane));
        if (n && /^(outline|problems|stack)$/.test(S.pane)) S.side = S.pane;
        el.querySelectorAll('.ide-sseg [data-s]').forEach(b => b.classList.toggle('on', b.dataset.s === S.side));
      };
      ui.markDirty = () => { const t = cur(), b = tabs.children[S.active]; if (b) b.classList.toggle('dirty', dirty(t)); };
      ui.drawTabs = () => {
        tabs.innerHTML = S.tabs.length ? '' : '<span class="xs muted" style="padding:10px 12px">No files open — pick one from the tree.</span>';
        S.tabs.forEach((t, i) => { const b = U.el('div', { class: 'ide-tab' + (i === S.active ? ' on' : '') + (dirty(t) ? ' dirty' : '') + (t.ro ? ' ro' : ''), role: 'tab', title: t.path, 'data-path': t.path }, `<span class="nm">${esc(t.title)}</span><i class="dot"></i><button class="x" aria-label="Close ${esc(t.title)}">${IC.x}</button>`);
          b.onclick = e => { if (e.target.closest('.x')) return closeTab(i); activate(i); }; tabs.appendChild(b); });
        const on = tabs.children[S.active]; on && on.scrollIntoView && on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      };
      ui.showTab = () => {
        ui.drawTabs(); const t = cur();
        if (!t) { if (ui.eng) { ui.eng.destroy(); ui.eng = null; } edHost.innerHTML = `<div class="empty-v ide-empty"><div>${IC.code}</div><b>Forge IDE</b><span class="sm muted">Open a workspace file from the tree, or browse <b>Forge source</b> and paste a stack trace in <b>Stack</b>.</span></div>`; S.problems = []; ui.drawSide(); ui.drawStatus(); return; }
        if (!ui.eng) makeEngine('lite');
        ui.eng.load(t); S.problems = problemsFor(t); ui.eng.marks(S.problems); ui.drawSide(); ui.drawStatus(); ui.drawTree();
        if (isNarrow() && S.pane === 'files') { S.pane = 'code'; ui.layout(); }
      };
      ui.drawStatus = () => { const t = cur(), q = s => el.querySelector('[data-s="' + s + '"]'); if (!q('lang')) return;
        q('lang').textContent = t ? t.lang + (t.ro ? ' · read-only' : '') : ''; q('eng').textContent = (ui.eng ? (ui.eng.kind === 'monaco' ? 'Monaco' : 'Lite') : '') + (ui.monacoLoading ? ' (loading Monaco…)' : '');
        const e = S.problems.filter(p => p.sev === 'error').length, w = S.problems.filter(p => p.sev === 'warn').length; const pr = q('prob'); pr.textContent = t ? (e || w ? `${e ? '✕ ' + e : ''} ${w ? '⚠ ' + w : ''}`.trim() : '✓') : ''; pr.className = e ? 'err' : w ? 'warn' : 'ok';
        const pb = el.querySelector('.ide-sw [data-p="problems"]'); if (pb) pb.textContent = 'Problems' + (e + w ? ' ' + (e + w) : ''); };
      /* tree */
      ui.drawTree = async () => {
        let files = []; try { files = await DS.fs.walk('/', 3000); } catch (_) {}
        if (!S.openDirs) { S.openDirs = new Set(); if (files.length < 80) files.forEach(p => { const ps = p.split('/'); for (let i = 2; i < ps.length; i++) S.openDirs.add(ps.slice(0, i).join('/')); }); }
        const t = cur(); if (t && !t.path.startsWith('forge:')) { const ps = t.path.split('/'); for (let i = 2; i < ps.length; i++) S.openDirs.add(ps.slice(0, i).join('/')); }
        const rootN = { d: {}, f: [] }; files.forEach(p => { const ps = p.split('/').slice(1); let n = rootN; ps.slice(0, -1).forEach(s => { n = n.d[s] = n.d[s] || { d: {}, f: [] }; }); n.f.push(p); });
        let h = `<div class="ide-th"><span class="sec-t">Workspace</span><span class="grow"></span><button class="icon-btn" data-t="new" title="New file" aria-label="New file">${IC.plus || '+'}</button></div>`;
        const walk = (n, pre, depth) => {
          Object.keys(n.d).sort().forEach(k => { const p = pre + '/' + k, o = S.openDirs.has(p); h += `<button class="ide-ti dir${o ? ' open' : ''}" data-dir="${esc(p)}" style="padding-left:${8 + depth * 14}px"><i class="chev">${IC.chev}</i>${esc(k)}</button>`; if (o) walk(n.d[k], p, depth + 1); });
          n.f.sort().forEach(p => { h += `<button class="ide-ti${t && t.path === p ? ' on' : ''}" data-file="${esc(p)}" style="padding-left:${22 + depth * 14}px">${esc(base(p))}${S.tabs.some(x => x.path === p && dirty(x)) ? ' <i class="dot"></i>' : ''}</button>`; });
        };
        walk(rootN, '', 0); if (!files.length) h += '<div class="xs muted" style="padding:6px 14px">(empty workspace)</div>';
        const srcs = S.srcOpen ? forgeSources() : [];
        h += `<button class="ide-ti dir src${S.srcOpen ? ' open' : ''}" data-src="1" style="padding-left:8px"><i class="chev">${IC.chev}</i><b>Forge source</b><span class="xs muted">&nbsp;read-only</span></button>`;
        srcs.forEach(s => { h += `<button class="ide-ti${t && t.path === s.path ? ' on' : ''}" data-file="${esc(s.path)}" style="padding-left:22px">${esc(s.name)}<span class="xs muted">&nbsp;${s.text.split('\n').length}</span></button>`; });
        tree.innerHTML = h;
      };
      tree.onclick = async e => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.t === 'new') { const p = await DS.ui.promptText('New file path', '/src/new.js'); if (!p) return; const np = DS.fs.norm(p); if (!await DS.fs.exists(np)) { const th = DS.store.activeThread() || DS.store.newThread(); DS.agent.recordChange(th, np, null); await DS.fs.write(np, ''); } open(np); return; }
        if (b.dataset.src) { S.srcOpen = !S.srcOpen; ui.drawTree(); return; }
        if (b.dataset.dir) { const d = b.dataset.dir; S.openDirs.has(d) ? S.openDirs.delete(d) : S.openDirs.add(d); ui.drawTree(); return; }
        if (b.dataset.file) open(b.dataset.file);
      };
      /* side panel */
      ui.drawSide = () => {
        const t = cur(); let h = '';
        if (S.side === 'outline') {
          if (S.usages) { h += `<div class="ide-uh"><span class="sec-t">Usages of “${esc(S.usages.word)}” · ${S.usages.hits.length}</span><button class="icon-btn" data-u="x" aria-label="Clear usages">${IC.x}</button></div>` + (S.usages.hits.map(u => `<button class="ide-row" data-go="${esc(u.path)}" data-line="${u.line}"><span class="mono xs muted">${esc(base(u.path))}:${u.line}</span><span class="mono xs">${esc(u.text.trim().slice(0, 90))}</span></button>`).join('') || '<div class="xs muted pad">No usages found in the workspace.</div>'); }
          const o = t ? outline(t.value, t.lang) : [];
          h += `<div class="sec-t pad">Outline${t ? ' · ' + esc(t.title) : ''}</div>` + (o.map(s => `<button class="ide-row ol" data-line="${s.line}" style="padding-left:${10 + s.depth * 12}px"><span class="k k-${s.kind}">${s.kind === 'class' ? 'C' : s.kind === 'method' ? 'm' : s.kind === 'fn' ? 'ƒ' : s.kind === 'id' ? '#' : s.kind[0] === 'h' ? 'H' : '§'}</span><span class="nm">${esc(s.name)}</span><span class="xs muted">${s.line}</span></button>`).join('') || `<div class="xs muted pad">${t ? 'No symbols found.' : 'Open a file to see its outline.'}</div>`);
        } else if (S.side === 'problems') {
          h += S.problems.length ? S.problems.map(p => `<button class="ide-row pr ${p.sev}" data-line="${p.line}" data-col="${p.col || 0}"><span class="sv">${p.sev === 'error' ? '✕' : p.sev === 'warn' ? '⚠' : 'i'}</span><span class="nm">${esc(p.msg)}</span><span class="xs muted">${p.line ? 'Ln ' + p.line + (p.col ? ':' + p.col : '') : ''}</span></button>`).join('') + (S.problems.some(p => p.sev !== 'info') ? '<button class="btn sm" data-a="fix" style="margin:10px">Ask AI to fix</button>' : '') : `<div class="xs muted pad">${t ? (t.ro ? 'Read-only source — not checked.' : /^(js|json|html|css|ts|tsx|jsx)$/.test(t.lang) ? '✓ No problems detected.' : 'No checker for .' + esc(t.lang) + ' files.') : 'Open a file to check it.'}</div>`;
        } else {
          const tr = DS.kernel.trace.filter(e => e.level === 'error').slice(-12).reverse().map(e => ({ ts: e.ts, msg: (e.source ? e.source + ': ' : '') + e.msg, stack: (e.data && (e.data.stack || (e.data.error && e.data.error.stack))) || e.msg }));
          const recent = S.errors.concat(tr).slice(0, 20);
          h += `<div class="pad"><textarea class="inp mono ide-stk" rows="5" placeholder="Paste an error stack — frames like (forge/plugins/62-router.js:130:19), forge/core.js:L:C or /src/app.js:12:5 become links">${esc(S.stackText)}</textarea><div class="row" style="gap:6px;margin-top:6px"><button class="btn sm pri" data-k="parse">Parse</button><button class="btn sm" data-k="clear">Clear</button></div></div>`;
          if (S.frames.length) h += `<div class="sec-t pad">Frames · ${S.frames.length}</div>` + S.frames.map((f, i) => `<button class="ide-row fr" data-fr="${i}"><span class="mono xs">${esc(f.fn || '(anonymous)')}</span><span class="mono xs muted">${esc(f.label)}:${f.line}${f.col ? ':' + f.col : ''}</span></button>`).join('');
          else if (S.stackText) h += '<div class="xs muted pad">No Forge or workspace frames found in that text.</div>';
          h += `<div class="sec-t pad">Recent errors · ${recent.length}</div>` + (recent.map((r, i) => `<button class="ide-row er" data-er="${i}"><span class="xs" style="color:var(--danger)">${esc(r.msg.slice(0, 120))}</span><span class="xs muted">${U.fmtAgo ? esc(U.fmtAgo(r.ts)) : ''}</span></button>`).join('') || '<div class="xs muted pad">No errors captured yet.</div>');
          ui._recent = recent;
        }
        side.innerHTML = h;
      };
      side.onclick = e => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.u) { S.usages = null; ui.drawSide(); return; }
        if (b.dataset.a === 'fix') return ai('fix');
        if (b.dataset.k === 'parse') { S.stackText = side.querySelector('.ide-stk').value; S.frames = parseStack(S.stackText); ui.drawSide(); return; }
        if (b.dataset.k === 'clear') { S.stackText = ''; S.frames = []; ui.drawSide(); return; }
        if (b.dataset.er) { const r = ui._recent[+b.dataset.er]; S.stackText = r.msg + '\n' + (r.stack || ''); S.frames = parseStack(S.stackText); ui.drawSide(); return; }
        if (b.dataset.fr) { const f = S.frames[+b.dataset.fr]; open(f.path, { line: f.line, col: f.col }); return; }
        if (b.dataset.go) { open(b.dataset.go, { line: +b.dataset.line }); return; }
        if (b.dataset.line && ui.eng) { S.pane = 'code'; ui.layout(); ui.eng.goto(+b.dataset.line, +(b.dataset.col || 0) || 1, true); }
      };
      side.addEventListener('input', e => { if (e.target.classList.contains('ide-stk')) S.stackText = e.target.value; });
      el.querySelector('.ide-sseg').onclick = e => { const b = e.target.closest('[data-s]'); if (!b) return; S.side = b.dataset.s; ctx.data.set('side', S.side); ui.layout(); ui.drawSide(); };
      el.querySelector('.ide-sw').onclick = e => { const b = e.target.closest('[data-p]'); if (!b) return; S.pane = b.dataset.p; ui.layout(); if (S.pane === 'files') ui.drawTree(); else if (S.pane !== 'code') ui.drawSide(); };
      /* find & replace */
      const fq = fbar.querySelector('[data-f="q"]'), fr = fbar.querySelector('[data-f="r"]'), fn = fbar.querySelector('[data-f="n"]');
      const mkRe = () => { const q = fq.value; if (!q) return null; try { return new RegExp(findRe ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g' + (findCs ? '' : 'i')); } catch (e) { fn.textContent = 'bad regex'; return null; } };
      const findNext = () => { const re = mkRe(); if (!re || !ui.eng) return null; const v = ui.eng.value(); const all = [...v.matchAll(re)].filter(m => m[0].length); fn.textContent = all.length + ' match' + (all.length === 1 ? '' : 'es'); if (!all.length) return null; const at = ui.eng.pos().offset + (ui.eng.selText() ? 0 : 0); const m = all.find(x => x.index > at - (ui.eng.selText() ? 0 : 1) && !(ui.eng.selText() && x.index === at - ui.eng.selText().length)) || all[0]; ui.eng.select(m.index, m.index + m[0].length); return m; };
      fbar.onclick = e => { const b = e.target.closest('button'); if (!b || !ui.eng || !cur() || cur().ro && /one|all/.test(b.dataset.f)) return;
        if (b.dataset.f === 're') { findRe = !findRe; b.classList.toggle('acc', findRe); } else if (b.dataset.f === 'cs') { findCs = !findCs; b.classList.toggle('acc', findCs); }
        else if (b.dataset.f === 'next') findNext();
        else if (b.dataset.f === 'one') { const re = mkRe(); const s = ui.eng.selText(); if (re && s && new RegExp('^(?:' + re.source + ')$', re.flags.replace('g', '')).test(s)) { const p = ui.eng.pos().offset; const a = p - s.length; ui.eng.replaceRange(a, p, findRe ? s.replace(new RegExp(re.source, re.flags.replace('g', '')), fr.value) : fr.value); } findNext(); }
        else if (b.dataset.f === 'all') { const re = mkRe(); if (!re) return; const v = ui.eng.value(); const n = [...v.matchAll(re)].length; if (!n) return; ui.eng.setValue(v.replace(re, findRe ? fr.value : () => fr.value)); fn.textContent = 'replaced ' + n; } };
      fq.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); findNext(); } if (e.key === 'Escape') toggleFind(false); });
      fq.addEventListener('input', () => { const re = mkRe(); fn.textContent = re && ui.eng ? [...ui.eng.value().matchAll(re)].length + ' matches' : ''; });
      const toggleFind = on => { S.findOpen = on == null ? !S.findOpen : on; fbar.hidden = !S.findOpen; if (S.findOpen) { const s = ui.eng && ui.eng.selText(); if (s && !s.includes('\n')) fq.value = s; fq.focus(); fq.select(); } };
      /* toolbar */
      const gotoLine = async () => { const t = cur(); if (!t || !ui.eng) return; const v = await DS.ui.promptText('Go to line[:col]', String(ui.eng.pos().line)); const m = v && v.match(/(\d+)(?::(\d+))?/); if (m) ui.eng.goto(+m[1], +(m[2] || 1), true); };
      const doFormat = () => { const t = cur(); if (!t || t.ro || !ui.eng) return; t.value = ui.eng.value(); try { const f = format(t); if (f === t.value) return ctx.toast('Already formatted', 'info', 1000); ui.eng.setValue(f); ctx.toast('Formatted', 'ok', 900); } catch (e) { ctx.toast('Format failed: ' + e.message, 'err'); } };
      const doDiff = () => { const t = cur(); if (!t) return; if (ui.eng) t.value = ui.eng.value(); if (!dirty(t)) return ctx.toast('No unsaved changes', 'info', 1100); const s = DS.diff.stat ? DS.diff.stat(t.saved, t.value) : null; DS.ui.sheet({ title: 'Unsaved changes · ' + t.title, full: true, html: `${s ? `<div class="xs muted" style="margin-bottom:8px">+${s.add || s.added || 0} −${s.del || s.removed || 0}</div>` : ''}<div class="diffbox">${DS.diff.html(t.saved, t.value)}</div>` }); };
      const doRevert = async () => { const t = cur(); if (!t || !dirty(t)) return; if (!await DS.ui.confirm('Revert ' + t.title + ' to the saved version?', 'Revert')) return; ui.eng.setValue(t.saved); t.value = t.saved; ui.markDirty(); };
      ui.cmd = { save: () => save(), run, find: () => toggleFind(), ai: () => DS.ui.menu([{ label: 'Explain', icon: 'sparkle', run: () => ai('explain') }, { label: 'Fix problems', icon: 'check', run: () => ai('fix') }, { label: 'Refactor selection', icon: 'redo', run: () => ai('refactor') }, { label: 'Write tests', icon: 'code', run: () => ai('tests') }], 'AI actions'),
        tree: () => { if (isNarrow()) { S.pane = S.pane === 'files' ? 'code' : 'files'; ui.layout(); ui.drawTree(); } else { treeHidden = !treeHidden; ctx.data.set('treeHidden', treeHidden); ui.layout(); } },
        more: () => DS.ui.menu([{ label: 'Save all', icon: 'check', run: saveAll }, { label: 'Format document', icon: 'code', run: doFormat }, { label: 'Diff vs saved', icon: 'branch', run: doDiff }, { label: 'Revert to saved', icon: 'redo', run: doRevert }, { label: 'Go to line…', icon: 'chev', run: gotoLine }, { label: 'Find usages of word', icon: 'search', run: () => findUsages(ui.eng && ui.eng.word()) }, { label: 'Copy path', icon: 'copy', run: () => { cur() && U.copy(cur().path); } }, { label: 'Editor engine: ' + engPref(), icon: 'gear', run: () => DS.ui.menu(['auto', 'lite', 'monaco'].map(k => ({ label: (k === engPref() ? '✓ ' : '') + { auto: 'Auto (Monaco on desktop, Lite on touch/offline)', lite: 'Lite (offline, iOS-friendly)', monaco: 'Monaco (CDN, desktop)' }[k], run: () => { ctx.data.set('engine', k); ui.applyEngine(); } })), 'Editor engine') }], cur() ? cur().title : 'IDE'),
        format: doFormat, diff: doDiff, revert: doRevert, gotoLine, saveAll, usages: () => findUsages(ui.eng && ui.eng.word()) };
      el.querySelector('.ide-top').onclick = e => { const b = e.target.closest('[data-a]'); if (b && ui.cmd[b.dataset.a]) ui.cmd[b.dataset.a](); };
      const onKey = e => { if (!el.offsetParent || !(e.metaKey || e.ctrlKey)) return; const k = e.key.toLowerCase();
        if (k === 's') { e.preventDefault(); e.shiftKey ? saveAll() : save(); } else if (k === 'f' && !e.shiftKey) { e.preventDefault(); toggleFind(true); } else if (k === 'g') { e.preventDefault(); gotoLine(); } else if (k === 'f' && e.shiftKey) { e.preventDefault(); doFormat(); } else if (k === 'enter') { e.preventDefault(); run(); } };
      document.addEventListener('keydown', onKey);
      const ro = new ResizeObserver(() => ui.layout()); ro.observe(el);
      const changedPaths = new Set(); /* collect every changed path: a trailing debounce alone would drop all but the last */
      const flushFs = U.debounce(async () => { if (UI !== ui) return; ui.drawTree(); const ps = [...changedPaths]; changedPaths.clear();
        for (const pth of ps) { const t = S.tabs.find(x => x.path === pth); if (!t || dirty(t) || t.ro) continue; try { if (!(await DS.fs.exists(pth))) continue; const f = await DS.fs.read(pth); if (f.content !== t.saved) { t.saved = t.value = f.content; t === cur() && ui.eng && ui.eng.load(t); } } catch (_) {} } }, 250);
      const offFs = DS.bus.on('fs:change', ev => { if (ev && ev.path) changedPaths.add(ev.path); flushFs(); });
      ui.layout(); ui.showTab(); ui.drawTree(); ui.applyEngine();
      return () => { document.removeEventListener('keydown', onKey); ro.disconnect(); offFs && offFs(); if (ui.eng) { cur() && (cur().value = ui.eng.value()); ui.eng.destroy(); } if (UI === ui) UI = null; };
    }
    if (ctx.rail) ctx.rail({ id: 'ide', icon: 'code', label: 'IDE — open any file, outline, problems, stack', group: 'top', order: 45, run: () => DS.shell.show('ide'), active: () => DS.shell.current === 'ide' });
    ctx.view({ id: 'ide', title: 'IDE', icon: 'code', order: 12, mount, onShow: () => { UI && (UI.layout(), UI.drawTree()); }, badge: () => { const n = S.tabs.filter(dirty).length; return n ? String(n) : ''; } });

    /* ═════ entry points ═════ */
    const api = { open, save: () => save(), saveAll, active: () => { const t = cur(); return t && { path: t.path, lang: t.lang, ro: t.ro, dirty: dirty(t), value: UI && UI.eng ? UI.eng.value() : t.value }; }, tabs: () => S.tabs.map(t => ({ path: t.path, dirty: dirty(t), ro: t.ro })),
      setValue: v => { if (UI && UI.eng && cur()) UI.eng.setValue(v); }, engine: () => UI && UI.eng ? UI.eng.kind : null, problems: () => S.problems.slice(), outline: () => { const t = cur(); return t ? outline(UI && UI.eng ? UI.eng.value() : t.value, t.lang) : []; },
      parseStack, sources: () => forgeSources().map(s => ({ path: s.path, name: s.name, lines: s.text.split('\n').length })), errors: () => S.errors.slice(), cursor: () => UI && UI.eng ? UI.eng.pos() : null,
      showStack(text) { S.stackText = String(text || ''); S.frames = parseStack(S.stackText); S.side = 'stack'; S.pane = isNarrow() ? 'stack' : 'code'; try { DS.shell.show('ide'); } catch (_) {} UI && (UI.layout(), UI.drawSide()); return S.frames; },
      cmd: k => UI && UI.cmd[k] && UI.cmd[k](), format: t => format(t), checks: { js: jsProblems, json: jsonProblems, html: htmlProblems, css: cssProblems } };
    ctx.provide('forge.ide', api);
    ctx.command({ name: 'ide', args: '<path>[:line]', desc: 'Open a file (or the IDE) in the Forge IDE', run: async (arg) => { arg = (arg || '').trim(); if (!arg) { DS.shell.show('ide'); return; } const t = await open(arg); if (!t) return; } });
    ctx.threadAction({ id: 'ide-open', icon: 'code', label: 'Open IDE', run: () => DS.shell.show('ide') });
    const FEXT = { js: 'js', javascript: 'js', node: 'js', mjs: 'js', ts: 'ts', typescript: 'ts', tsx: 'tsx', jsx: 'jsx', py: 'py', python: 'py', html: 'html', htm: 'html', css: 'css', json: 'json', md: 'md', markdown: 'md', sh: 'sh', bash: 'sh', shell: 'sh', yaml: 'yml', yml: 'yml', sql: 'sql', svg: 'svg', xml: 'xml' };
    const textOf = m => (m.parts || []).filter(p => p.type === 'text').map(p => p.text || '').join('\n');
    ctx.messageAction({ id: 'ide-snippet', icon: 'code', label: 'Open in IDE', when: m => m.role === 'assistant' && /```[\w+-]*[^\n]*\n[\s\S]*?```/.test(textOf(m)),
      run: async m => { const f = textOf(m).match(/```([\w+-]*)[^\n]*\n([\s\S]*?)```/); if (!f) return; const ext = FEXT[(f[1] || '').toLowerCase()] || 'txt'; let n = ctx.data.get('snip', 0), p;
        do { p = '/scratch/snippet-' + (++n) + '.' + ext; } while (await DS.fs.exists(p)); ctx.data.set('snip', n);
        const th = DS.store.activeThread() || DS.store.newThread(); DS.agent.recordChange(th, p, null); await DS.fs.write(p, f[2].replace(/\n$/, '') + '\n'); open(p); } });
    /* tool cards: clickable VFS paths */
    const PATH_RE = /^(\/[\w.\-]+(?:\/[\w.\-]+)*\.\w+)(?::(\d+))?$/;
    const onClick = async e => {
      const t = e.target; if (!t || !t.closest) return; const card = t.closest('.tcall'); if (!card) return;
      const dp = t.closest('[data-path]'); const ap = t.closest('.appr-path, .sm');
      const txt = dp ? dp.getAttribute('data-path') : ap ? (ap.textContent || '').trim() : ''; const m = txt.match(PATH_RE); if (!m) return;
      if (dp || (ap && ap.classList.contains('appr-path'))) { e.preventDefault(); e.stopPropagation(); }
      if (await DS.fs.exists(m[1])) open(m[1], { line: +(m[2] || 0) || undefined });
    };
    document.addEventListener('click', onClick, true); ctx.effect(() => () => document.removeEventListener('click', onClick, true));
    /* Files view: inject an "IDE" button into the editor sheet's .fx-bar (no edits to 10-files.js) */
    const inject = bar => { if (bar.querySelector('.ide-fxbtn')) return; const b = U.el('button', { class: 'btn sm ide-fxbtn', title: 'Open in IDE' }, IC.code + '<span>IDE</span>');
      b.onclick = () => { let p = bar, h = null; while (p && !(h = p.querySelector && p.querySelector('h3[title]'))) p = p.parentElement; const path = h && h.title; if (!path) return ctx.toast('Could not tell which file this is', 'warn'); const wrap = bar.closest('.sheet-wrap'); const x = wrap && wrap.querySelector('[data-x]'); x && x.click(); open(path); };
      const more = bar.querySelector('[data-more]'); more ? bar.insertBefore(b, more) : bar.appendChild(b); };
    const mo = new MutationObserver(muts => { for (const m of muts) for (const n of m.addedNodes) { if (n.nodeType !== 1) continue; if (n.classList.contains('fx-bar')) inject(n); else if (n.firstElementChild) { const l = n.getElementsByClassName('fx-bar'); for (let i = 0; i < l.length; i++) inject(l[i]); } } });
    mo.observe(document.body, { childList: true, subtree: true }); ctx.effect(() => () => { mo.disconnect(); document.querySelectorAll('.ide-fxbtn').forEach(b => b.remove()); });
    /* agent tool + offline Sim intent + starter */
    ctx.tool({ name: 'ide_open', label: 'Open in IDE', gate: 'read', description: 'Open a workspace file in the Forge IDE view for the user, optionally at a line (shows it with a highlight).', parameters: { type: 'object', properties: { path: { type: 'string', description: 'absolute VFS path' }, line: { type: 'number' } }, required: ['path'] },
      run: async a => { if (!await DS.fs.exists(a.path)) return { error: 'no such file: ' + a.path }; setTimeout(() => open(a.path, { line: a.line }), 0); return { opened: DS.fs.norm(a.path), line: a.line || 1 }; }, summarize: (a, r) => r && r.error ? '✕ ' + r.error : 'opened ' + (a.path || '') + (a.line ? ':' + a.line : '') });
    ctx.intent({ id: 'ide-open', order: 50, match: t => /\b(open|show|edit)\b[\s\S]*\b(in|with)\s+(the\s+)?ide\b/i.test(t),
      script: t => { const m = t.match(/(\/[\w.\-]+(?:\/[\w.\-]+)*\.\w+)(?::(\d+))?/); if (!m) return [{ final: 'Which file? Say e.g. *open /src/main.js:12 in the IDE*, or use `/ide <path>`.' }];
        return [{ say: 'Opening it in the IDE.', tool: { name: 'ide_open', args: { path: m[1], line: m[2] ? +m[2] : undefined } } }, { final: rs => rs[0] && rs[0].error ? 'Could not open: ' + rs[0].error : `Opened **${m[1]}**${m[2] ? ' at line ' + m[2] : ''} in the IDE — tabs, outline, problems, Run and AI actions are in the toolbar.` }]; } });
    ctx.suggest({ id: 'ide', emoji: '⌨️', title: 'Open the IDE', sub: 'Tabs, outline, problems, run, stack → source', run: () => DS.shell.show('ide') });
    ctx.settings({ id: 'ide', title: 'IDE', render(el) {
      const draw = () => { el.innerHTML = `<div class="field"><label>Editor engine</label><div class="seg">${['auto', 'lite', 'monaco'].map(k => `<button data-e="${k}" class="${engPref() === k ? 'on' : ''}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div><div class="hint">Auto = Monaco (lazy from jsDelivr, monaco-editor@0.57.0) on desktop with a mouse; Lite everywhere else. Lite works offline and on iOS; Monaco falls back to Lite if the CDN is unreachable.</div></div>`; };
      draw(); el.onclick = e => { const b = e.target.closest('[data-e]'); if (!b) return; ctx.data.set('engine', b.dataset.e); draw(); UI && UI.applyEngine(); }; } });

    /* ═════ styles ═════ */
    ctx.effect(() => { const s = document.createElement('style'); s.textContent = `
.ide-host{min-width:0}
.ide{display:flex;flex-direction:column;flex:1;min-height:0;min-width:0;height:100%;overflow:hidden}
.ide-top{display:flex;align-items:center;gap:6px;padding:6px 10px;border-bottom:1px solid var(--line);min-width:0;overflow-x:auto;scrollbar-width:none;flex-shrink:0}
.ide-top .btn.sm{display:inline-flex;align-items:center;gap:5px;flex-shrink:0;min-height:36px}.ide-top .btn svg,.ide-fxbtn svg{width:15px;height:15px}
.ide-ttl{font-size:14px;white-space:nowrap}
.ide-main{flex:1;min-height:0;display:flex;min-width:0}
.ide-tree{width:220px;flex-shrink:0;border-right:1px solid var(--line);overflow:auto;background:var(--bg-2);padding-bottom:20px}
.ide.notree .ide-tree{display:none}
.ide-th{display:flex;align-items:center;padding:6px 6px 2px 12px}
.ide-ti{display:flex;align-items:center;gap:4px;width:100%;text-align:left;background:none;border:0;color:var(--text-2);font:inherit;font-size:13px;padding:6px 8px;min-height:32px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ide-ti:hover{background:var(--card)}.ide-ti.on{background:var(--accent-soft);color:var(--text)}
.ide-ti .chev{display:inline-flex;width:14px;height:14px;transition:transform .15s;transform:rotate(-90deg);flex-shrink:0}.ide-ti.open .chev{transform:none}.ide-ti .chev svg{width:14px;height:14px}
.ide-ti.src{margin-top:10px;border-top:1px solid var(--line);padding-top:10px}
.ide .dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--warn);flex-shrink:0}
.ide-center{flex:1;min-width:0;display:flex;flex-direction:column}
.ide-tabs{display:flex;overflow-x:auto;border-bottom:1px solid var(--line);flex-shrink:0;scrollbar-width:thin;background:var(--bg-2);min-height:38px}
.ide-tab{display:flex;align-items:center;gap:6px;padding:0 4px 0 12px;min-height:38px;border-right:1px solid var(--line);cursor:pointer;font-size:13px;color:var(--muted);white-space:nowrap;flex-shrink:0}
.ide-tab.on{background:var(--bg);color:var(--text);box-shadow:inset 0 -2px 0 var(--accent)}
.ide-tab.ro .nm{font-style:italic}.ide-tab .dot{display:none}.ide-tab.dirty .dot{display:inline-block}
.ide-tab .x{background:none;border:0;color:inherit;width:28px;height:28px;display:grid;place-items:center;border-radius:6px;cursor:pointer}.ide-tab .x svg{width:13px;height:13px}.ide-tab .x:hover{background:var(--card)}
.ide-find[hidden]{display:none!important}
.ide-find{display:flex;flex-wrap:wrap;gap:6px;padding:6px 10px;border-bottom:1px solid var(--line);align-items:center}.ide-find .inp{flex:1 1 120px;min-width:0;height:34px;padding:4px 8px}.ide-find .chip{cursor:pointer;font-family:var(--mono)}
.ide-ed{flex:1;min-height:0;position:relative;background:var(--code-bg)}
.ide-empty{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;text-align:center;padding:20px}.ide-empty svg{width:34px;height:34px;opacity:.6}
.ide-lite{position:absolute;inset:0;overflow:auto;font-family:var(--mono);font-size:13px;line-height:${LH}px;-webkit-overflow-scrolling:touch;overscroll-behavior:contain}
@media (pointer:coarse){.ide-lite{font-size:16px}}
.ide-in{display:flex;min-height:100%;min-width:100%;width:max-content}
.ide-gut{position:sticky;left:0;z-index:3;background:var(--code-head);color:var(--muted);text-align:right;padding:8px 8px 8px 6px;user-select:none;-webkit-user-select:none;min-width:34px;white-space:pre;font-size:.85em;border-right:1px solid var(--line)}
.ide-code{position:relative;flex:1 0 auto;min-width:0}
.ide-code pre,.ide-code textarea{margin:0;padding:8px 14px 8px 10px;font:inherit;line-height:inherit;white-space:pre;tab-size:2;-moz-tab-size:2;border:0;letter-spacing:normal;word-wrap:normal;overflow-wrap:normal;box-sizing:border-box}
.ide-code pre{position:relative;z-index:1;pointer-events:none;color:var(--text);min-height:100%;background:none}
.ide-code textarea{position:absolute;inset:0;z-index:2;width:100%;height:100%;resize:none;background:transparent;color:transparent;-webkit-text-fill-color:transparent;caret-color:var(--accent);outline:none;overflow:hidden}
.ide-code textarea::selection{background:var(--accent-soft);-webkit-text-fill-color:transparent}
.ide-cur,.ide-flash,.ide-mk{position:absolute;left:0;right:0;height:${LH}px;pointer-events:none}
.ide-cur{background:var(--card);opacity:.55}.ide-lite.ro .ide-cur{opacity:.3}
.ide-flash{display:none;background:var(--accent-soft);box-shadow:inset 3px 0 0 var(--accent)}.ide-flash.on{display:block;animation:ideFl 1.6s ease-out}
@keyframes ideFl{0%{background:var(--accent-line)}100%{background:var(--accent-soft)}}
.ide-mk{box-shadow:inset 3px 0 0 var(--danger);background:linear-gradient(90deg,color-mix(in srgb,var(--danger) 14%,transparent),transparent 70%)}.ide-mk.warn{box-shadow:inset 3px 0 0 var(--warn);background:none}
.ide-mon{position:absolute;inset:0}.ide-mflash{background:rgba(120,140,255,.22)}.ide-merr{background:rgba(255,80,80,.12)}
.ide-st{display:flex;gap:12px;padding:3px 10px;font-size:11px;color:var(--muted);border-top:1px solid var(--line);flex-shrink:0;white-space:nowrap;overflow:hidden}
.ide-st .err{color:var(--danger)}.ide-st .warn{color:var(--warn)}.ide-st .ok{color:var(--ok)}
.ide-side{width:270px;flex-shrink:0;border-left:1px solid var(--line);display:flex;flex-direction:column;min-height:0;background:var(--bg-2)}
.ide-sseg{margin:8px;flex-shrink:0}.ide-sseg button{flex:1}
.ide-sbody{flex:1;overflow:auto;min-height:0;padding-bottom:20px}
.ide-sbody .pad{padding:8px 12px}.ide-sbody .sec-t.pad{padding-bottom:2px}
.ide-row{display:flex;align-items:center;gap:8px;width:100%;text-align:left;background:none;border:0;border-bottom:1px solid var(--line);color:var(--text);font:inherit;font-size:13px;padding:8px 10px;min-height:38px;cursor:pointer}
.ide-row:hover{background:var(--card)}.ide-row .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ide-row.pr .nm{white-space:normal}.ide-row.pr.error .sv{color:var(--danger)}.ide-row.pr.warn .sv{color:var(--warn)}.ide-row.pr.info .sv{color:var(--muted)}
.ide-row.fr,.ide-row.er,.ide-sbody [data-go]{flex-direction:column;align-items:flex-start;gap:2px}.ide-row.fr span,.ide-row.er span,.ide-sbody [data-go] span{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ide-row .k{width:18px;height:18px;border-radius:5px;display:grid;place-items:center;font-size:11px;font-weight:700;background:var(--card-2);color:var(--accent);flex-shrink:0}.ide-row .k-class{color:var(--violet)}
.ide-uh{display:flex;align-items:center;padding:4px 4px 0 12px}.ide-uh .sec-t{flex:1}
.ide-stk{width:100%;font-size:12px;min-height:90px;resize:vertical}
.ide-sw{display:none}
.ide.narrow .ide-tree,.ide.narrow .ide-side,.ide.narrow .ide-center{display:none;width:auto;border:0;flex:1}
.ide.narrow[data-pane=files] .ide-tree{display:block}.ide.narrow[data-pane=code] .ide-center{display:flex}
.ide.narrow[data-pane=outline] .ide-side,.ide.narrow[data-pane=problems] .ide-side,.ide.narrow[data-pane=stack] .ide-side{display:flex}
.ide.narrow .ide-sseg{display:none}
.ide.narrow .ide-sw{display:flex;margin:6px 8px calc(6px + env(safe-area-inset-bottom));flex-shrink:0;overflow-x:auto}.ide.narrow .ide-sw button{flex:1;min-height:38px;font-size:12px;padding:0 6px;white-space:nowrap}
.ide.narrow .ide-top .hn{display:none}
.ide-prev{height:75vh;min-height:300px}
.ide-out .ide-o{background:var(--code-bg);border:1px solid var(--line);border-radius:8px;padding:10px;font-family:var(--mono);font-size:12px;white-space:pre-wrap;word-break:break-word;margin:8px 0}.ide-out .err{color:var(--danger)}.ide-out .res{color:var(--ok)}
.ide-fxbtn{display:inline-flex;align-items:center;gap:4px}
`; document.head.appendChild(s); return () => s.remove(); });
  }
});

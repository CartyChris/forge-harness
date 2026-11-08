/* Forge plugin: Files — browser view, previewers, editor, zip export, fs_move/fs_copy/fs_stat. (A1) */
DS.plugin({
  name: 'forge.files', title: 'Files', version: '1.0.0', tags: ['files', 'editor', 'preview'],
  description: 'Workspace file browser with previewers (markdown, html, images, json, csv, code), an editor, upload, zip export and move/copy/stat tools.',
  apply(ctx) {
    const U = DS.util, esc = U.esc;
    const IC = DS.icons;
    if (!IC.folder) IC.folder = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
    if (!IC.plus) IC.plus = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>';
    if (!IC.upload) IC.upload = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M7 9l5-5 5 5M5 20h14"/></svg>';

    /* ───── helpers ───── */
    const norm = p => DS.fs.norm(p);
    const base = p => p.split('/').pop();
    const dirOf = p => { const d = p.slice(0, p.lastIndexOf('/')); return d || '/'; };
    const join = (d, n) => (d === '/' ? '' : d) + '/' + n;
    const ext = p => { const m = base(p).match(/\.([^.]+)$/); return m ? m[1].toLowerCase() : ''; };
    const KIND = { md: 'markdown', markdown: 'markdown', html: 'html', htm: 'html', svg: 'svg', png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', bmp: 'image', ico: 'image', json: 'json', csv: 'csv', tsv: 'csv' };
    const CODE = /^(js|mjs|cjs|ts|tsx|jsx|py|rb|go|rs|java|c|h|cpp|cs|php|sh|bash|zsh|css|scss|less|sql|yaml|yml|toml|ini|xml|txt|log|lua|swift|kt|r|pl|vue|svelte|env|gitignore|dockerfile|makefile)$/;
    const kindOf = (p, content) => { if (content != null && DS.fs.isBinary(content)) return /^data:image\//.test(content) ? 'image' : 'binary'; return KIND[ext(p)] || 'code'; };
    const glyph = (k) => ({ markdown: '📝', html: '🌐', svg: '🎨', image: '🖼️', json: '🧾', csv: '📊', binary: '📦' })[k] || '📄';
    const bytesOf = c => { if (DS.fs.isBinary(c)) { const b = c.slice(c.indexOf(',') + 1); return /;base64/.test(c.slice(0, c.indexOf(','))) ? Math.floor(b.length * 3 / 4) - (b.endsWith('==') ? 2 : b.endsWith('=') ? 1 : 0) : decodeURIComponent(b).length; } return new Blob([c]).size; };
    const toBytes = c => { if (DS.fs.isBinary(c)) { const i = c.indexOf(','); const meta = c.slice(0, i), d = c.slice(i + 1); if (/;base64/.test(meta)) { const s = atob(d); const u = new Uint8Array(s.length); for (let k = 0; k < s.length; k++) u[k] = s.charCodeAt(k); return u; } return new TextEncoder().encode(decodeURIComponent(d)); } return new TextEncoder().encode(c); };
    const changedSet = () => { const t = DS.store.activeThread(); return Object.keys((t && t.changes) || {}); };
    const isDir = async p => { p = norm(p); if (p === '/') return true; if (await DS.fs.exists(p)) return false; return (await DS.fs.walk(p, 1)).length > 0; };

    /* ───── minimal ZIP writer (store, CRC32) ───── */
    const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
    const crc32 = u => { let c = 0xFFFFFFFF; for (let i = 0; i < u.length; i++) c = CRC[(c ^ u[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
    function zipStore(entries) { // entries: [{name, data:Uint8Array}]
      const parts = [], central = []; let off = 0; const d = new Date();
      const dosT = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), dosD = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
      for (const e of entries) {
        const nm = new TextEncoder().encode(e.name), crc = crc32(e.data), sz = e.data.length;
        const h = new DataView(new ArrayBuffer(30));
        h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true); h.setUint16(10, dosT, true); h.setUint16(12, dosD, true);
        h.setUint32(14, crc, true); h.setUint32(18, sz, true); h.setUint32(22, sz, true); h.setUint16(26, nm.length, true); h.setUint16(28, 0, true);
        parts.push(new Uint8Array(h.buffer), nm, e.data);
        const c = new DataView(new ArrayBuffer(46));
        c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true); c.setUint16(12, dosT, true); c.setUint16(14, dosD, true);
        c.setUint32(16, crc, true); c.setUint32(20, sz, true); c.setUint32(24, sz, true); c.setUint16(28, nm.length, true); c.setUint32(42, off, true);
        central.push(new Uint8Array(c.buffer), nm); off += 30 + nm.length + sz;
      }
      const cdSize = central.reduce((a, b) => a + b.length, 0);
      const end = new DataView(new ArrayBuffer(22)); end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true); end.setUint32(12, cdSize, true); end.setUint32(16, off, true);
      const all = [...parts, ...central, new Uint8Array(end.buffer)]; const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0)); let p = 0; for (const a of all) { out.set(a, p); p += a.length; } return out;
    }
    async function zipWorkspace(dir = '/') {
      const files = await DS.fs.walk(dir, 5000); const pre = dir === '/' ? '/' : dir + '/'; const ents = [];
      for (const f of files) { try { const r = await DS.fs.read(f); ents.push({ name: f.slice(pre.length), data: toBytes(r.content) }); } catch (_) {} }
      return { bytes: zipStore(ents), count: ents.length };
    }
    ctx.provide('files', { zipStore, zipWorkspace, crc32, open: p => openFile(p), kindOf });

    /* ───── CSS ───── */
    ctx.effect(() => { const s = document.createElement('style'); s.textContent = `
.fx-top{display:flex;gap:8px;padding:0 16px 8px;align-items:center}
.fx-top .inp{flex:1;min-width:0;height:40px}
.fx-crumbs{display:flex;gap:2px;align-items:center;padding:0 12px 6px;overflow-x:auto;white-space:nowrap;scrollbar-width:none;font-size:13px}
.fx-crumbs button{background:none;border:0;color:var(--text-2);padding:6px 6px;border-radius:8px;cursor:pointer;font:inherit;min-height:32px}
.fx-crumbs button:last-child{color:var(--text);font-weight:600}
.fx-crumbs .sep{color:var(--muted)}
.fx-list{display:flex;flex-direction:column;padding:0 8px 24px}
.fx-row{display:flex;align-items:center;gap:10px;padding:6px 6px 6px 10px;min-height:52px;border-radius:12px;cursor:pointer;position:relative}
.fx-row:hover{background:var(--card)}
.fx-row .ic{width:34px;height:34px;flex:none;border-radius:10px;display:grid;place-items:center;background:var(--card-2);font-size:17px;color:var(--accent)}
.fx-row .ic svg{width:18px;height:18px}
.fx-row .nf{flex:1;min-width:0}
.fx-row .nm{font-size:14.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text)}
.fx-row .ds{font-size:12px;color:var(--muted)}
.fx-row .dot{width:8px;height:8px;border-radius:50%;background:var(--accent);display:inline-block;margin-left:6px;vertical-align:middle;box-shadow:0 0 0 3px var(--accent-soft)}
.fx-row .icon-btn{flex:none}
.fx-hit{padding:8px 12px;border-radius:10px;cursor:pointer;min-height:44px}
.fx-hit:hover{background:var(--card)}
.fx-hit .p{font-size:13px;color:var(--accent)} .fx-hit .t{font-family:var(--mono);font-size:12px;color:var(--text-2);white-space:pre;overflow:hidden;text-overflow:ellipsis}
.fx-hit mark{background:var(--accent-soft);color:var(--text);border-radius:3px}
.fx-sheet{display:flex;flex-direction:column;height:100%;min-height:60vh}
.fx-bar{display:flex;gap:8px;align-items:center;padding:8px 12px;border-bottom:1px solid var(--line);flex-wrap:wrap}
.fx-bar .meta{font-size:12px;color:var(--muted);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fx-dirty{width:8px;height:8px;border-radius:50%;background:var(--warn);display:none}
.fx-sheet.dirty .fx-dirty{display:inline-block}
.fx-body{flex:1;overflow:auto;min-height:0}
.fx-body.pad{padding:14px 16px}
.fx-ed{width:100%;height:100%;min-height:60vh;border:0;outline:0;resize:none;background:var(--code-bg);color:var(--text);font:13px/1.55 var(--mono);padding:12px 14px;box-sizing:border-box;tab-size:2;white-space:pre;overflow:auto}
.fx-code{font:12.5px/1.6 var(--mono);background:var(--code-bg);min-height:100%;padding:8px 0;counter-reset:ln}
.fx-code .l{display:flex;white-space:pre;padding-right:12px}
.fx-code .l:before{counter-increment:ln;content:counter(ln);width:44px;flex:none;text-align:right;padding-right:12px;color:var(--muted);opacity:.7;user-select:none}
.fx-code .l.hl{background:var(--accent-soft)}
.fx-frame{height:70vh;border-radius:12px;overflow:hidden;border:1px solid var(--line);margin:12px}
.fx-img{display:grid;place-items:center;padding:16px;background:repeating-conic-gradient(var(--card) 0 25%,var(--bg-2) 0 50%) 0 0/20px 20px;min-height:40vh}
.fx-img img{max-width:100%;max-height:70vh;border-radius:8px}
.fx-json{font:12.5px/1.6 var(--mono);padding:12px 14px}
.fx-json details{margin-left:14px} .fx-json summary{cursor:pointer;margin-left:-14px;list-style:none} .fx-json summary::-webkit-details-marker{display:none}
.fx-json summary:before{content:'▸ ';color:var(--muted)} .fx-json details[open]>summary:before{content:'▾ '}
.fx-json .k{color:var(--accent)} .fx-json .s{color:var(--ok)} .fx-json .n{color:var(--warn)} .fx-json .b{color:var(--violet)} .fx-json .c{color:var(--muted)}
.fx-csv{overflow:auto;padding:12px} .fx-csv table{border-collapse:collapse;font-size:13px}
.fx-csv th,.fx-csv td{border:1px solid var(--line);padding:6px 10px;text-align:left;white-space:nowrap}
.fx-csv th{background:var(--card-2);position:sticky;top:0} .fx-csv tr:nth-child(even) td{background:var(--card)}
.fx-bin{padding:24px 16px;text-align:center;color:var(--text-2)} .fx-bin .big{font-size:44px}
`; document.head.appendChild(s); return () => s.remove(); });

    /* ───── previewers ───── */
    ctx.previewer({ id: 'markdown', order: 50, match: p => kindOf(p) === 'markdown', render(el, f) { el.classList.add('pad'); const box = U.el('div', { class: 'md' }); el.appendChild(box); DS.render.into(box, f.content); } });
    ctx.previewer({ id: 'html', order: 50, match: p => kindOf(p) === 'html', render(el, f) { const w = U.el('div', { class: 'fx-frame' }); w.appendChild(U.sandboxFrame(f.content)); el.appendChild(w); } });
    ctx.previewer({ id: 'image', order: 50, match: p => kindOf(p) === 'svg' || kindOf(p) === 'image', render(el, f) {
      const w = U.el('div', { class: 'fx-img' }); const img = document.createElement('img'); img.alt = base(f.path);
      img.src = DS.fs.isBinary(f.content) ? f.content : 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(f.content);
      w.appendChild(img); el.appendChild(w); } });
    ctx.previewer({ id: 'json', order: 50, match: p => kindOf(p) === 'json', render(el, f) {
      let v; try { v = JSON.parse(f.content); } catch (e) { el.appendChild(U.el('div', { class: 'fx-bin' }, '<div class="chip err">Invalid JSON</div><div class="sm" style="margin-top:8px">' + esc(e.message) + '</div>')); codeView(el, f.content); return; }
      const box = U.el('div', { class: 'fx-json' }); let n = 0;
      const prim = x => x === null ? '<span class="b">null</span>' : typeof x === 'string' ? '<span class="s">' + esc(JSON.stringify(x)) + '</span>' : typeof x === 'number' ? '<span class="n">' + x + '</span>' : '<span class="b">' + x + '</span>';
      const node = (x, key) => { const k = key != null ? '<span class="k">' + esc(JSON.stringify(key)) + '</span>: ' : '';
        if (x && typeof x === 'object') { const arr = Array.isArray(x), ks = Object.keys(x); const d = document.createElement('details'); if (n++ < 40) d.open = true;
          d.innerHTML = '<summary>' + k + (arr ? '[' : '{') + ' <span class="c">' + ks.length + (arr ? ' items' : ' keys') + '</span></summary>';
          ks.forEach(kk => d.appendChild(node(x[kk], arr ? null : kk))); d.appendChild(U.el('div', {}, arr ? ']' : '}')); return d; }
        return U.el('div', {}, k + prim(x)); };
      box.appendChild(node(v, null)); el.appendChild(box); } });
    const parseCSV = (t, sep) => { const rows = []; let row = [], cur = '', q = false; for (let i = 0; i < t.length; i++) { const c = t[i]; if (q) { if (c === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; } else if (c === '"') q = true; else if (c === sep) { row.push(cur); cur = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; } else cur += c; } if (cur || row.length) { row.push(cur); rows.push(row); } return rows; };
    ctx.previewer({ id: 'csv', order: 50, match: p => kindOf(p) === 'csv', render(el, f) {
      const rows = parseCSV(f.content, ext(f.path) === 'tsv' ? '\t' : ','); const w = U.el('div', { class: 'fx-csv' });
      if (!rows.length) { w.textContent = '(empty)'; el.appendChild(w); return; }
      const shown = rows.slice(1, 1001);
      w.innerHTML = '<div class="xs muted" style="margin-bottom:8px">' + (rows.length - 1) + ' rows × ' + rows[0].length + ' columns' + (rows.length > 1001 ? ' · first 1000 shown' : '') + '</div><table><thead><tr>' + rows[0].map(h => '<th>' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' + shown.map(r => '<tr>' + r.map(c => '<td>' + esc(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
      el.appendChild(w); } });
    function codeView(el, text, hl) {
      const box = U.el('div', { class: 'fx-code' }); const lines = String(text).split('\n'); const lang = ext('x.' + (el.dataset.ext || ''));
      let html = null; try { html = DS.render.highlight ? DS.render.highlight(text, lang) : null; } catch (_) {}
      const hlLines = html ? html.split('\n') : null;
      box.innerHTML = lines.slice(0, 20000).map((l, i) => '<div class="l' + (hl === i + 1 ? ' hl' : '') + '">' + (hlLines && hlLines.length === lines.length ? hlLines[i] : esc(l)) + ' </div>').join('');
      el.appendChild(box); if (hl) setTimeout(() => { const t = box.children[hl - 1]; t && t.scrollIntoView({ block: 'center' }); }, 60);
    }
    ctx.previewer({ id: 'code', order: 900, match: () => true, render(el, f) {
      if (DS.fs.isBinary(f.content)) { const mime = f.content.slice(5, f.content.search(/[;,]/)); el.appendChild(U.el('div', { class: 'fx-bin' }, '<div class="big">📦</div><div style="margin:8px 0;font-weight:600">' + esc(base(f.path)) + '</div><div class="sm">' + esc(mime || 'binary') + ' · ' + DS.fmtBytes(bytesOf(f.content)) + '</div><div class="xs muted" style="margin-top:6px">No preview for this type — use Download.</div>')); return; }
      el.dataset.ext = ext(f.path); codeView(el, f.content, f.line); } });

    /* ───── opener / editor sheet ───── */
    async function openFile(path, opts = {}) {
      path = norm(path); let f; try { f = await DS.fs.read(path); } catch (e) { ctx.toast('Cannot open ' + path + ': ' + e.message, 'err'); return null; }
      let saved = f.content, mode = 'preview';
      const bin = DS.fs.isBinary(saved);
      const root = U.el('div', { class: 'fx-sheet' });
      root.innerHTML = '<div class="fx-bar"><div class="seg"><button data-m="preview" class="on">Preview</button><button data-m="edit">Edit</button></div><span class="fx-dirty" title="Unsaved changes"></span><span class="meta"></span><button class="btn sm pri" data-save style="display:none">Save</button><button class="icon-btn" data-more aria-label="More">' + IC.more + '</button></div><div class="fx-body"></div>';
      const body = root.querySelector('.fx-body'), meta = root.querySelector('.meta'), saveB = root.querySelector('[data-save]');
      let ta = null;
      const setMeta = () => { meta.textContent = (bin ? '' : saved.split('\n').length + ' lines · ') + DS.fmtBytes(bytesOf(saved)) + ' · ' + kindOf(path, saved); };
      const dirty = () => !!ta && ta.value !== saved;
      const markDirty = () => root.classList.toggle('dirty', dirty());
      const draw = () => {
        root.querySelectorAll('[data-m]').forEach(b => b.classList.toggle('on', b.dataset.m === mode));
        body.innerHTML = ''; body.className = 'fx-body'; delete body.dataset.ext; saveB.style.display = mode === 'edit' ? '' : 'none';
        if (mode === 'edit') { const v = ta ? ta.value : saved; ta = U.el('textarea', { class: 'fx-ed', spellcheck: 'false', 'aria-label': 'Edit ' + base(path) }); ta.value = v; ta.addEventListener('input', markDirty); ta.addEventListener('keydown', e => { if (e.key === 'Tab') { e.preventDefault(); const s = ta.selectionStart; ta.setRangeText('  ', s, ta.selectionEnd, 'end'); markDirty(); } }); body.appendChild(ta); setTimeout(() => ta.focus(), 30); return; }
        const content = ta ? ta.value : saved;
        const pv = DS.kernel.list('previewer').slice().sort((a, b) => (a.order || 100) - (b.order || 100)).find(p => { try { return p.match(path, content); } catch (_) { return false; } });
        try { pv.render(body, { path, content, line: opts.line }); } catch (e) { body.textContent = 'Preview failed: ' + e.message; }
      };
      const save = async () => { if (!ta) return; try { await DS.fs.write(path, ta.value); saved = ta.value; markDirty(); setMeta(); ctx.toast('Saved ' + base(path), 'ok', 1400); } catch (e) { ctx.toast('Save failed: ' + e.message, 'err'); } };
      saveB.onclick = save;
      root.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { if (b.dataset.m === 'edit' && bin) { ctx.toast('Binary files cannot be edited as text', 'warn'); return; } mode = b.dataset.m; draw(); });
      const onKey = e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's' && document.body.contains(root)) { e.preventDefault(); if (mode === 'edit') save(); } };
      document.addEventListener('keydown', onKey);
      const sh = DS.ui.sheet({ title: base(path), node: root, full: true, noPad: true, onClose: () => { document.removeEventListener('keydown', onKey); if (dirty()) DS.ui.confirm('Save changes to ' + base(path) + '?', 'Save', false).then(ok => { if (ok) DS.fs.write(path, ta.value); }); } });
      root.querySelector('[data-more]').onclick = () => itemMenu({ path, type: 'file', name: base(path) }, { inSheet: sh });
      sh.el.querySelector('h3').title = path;
      if (opts.edit && !bin) mode = 'edit';
      setMeta(); draw(); return sh;
    }

    /* ───── item ops ───── */
    async function uniqueName(dir, name) { let n = name, i = 1; const m = name.match(/^(.*?)(\.[^.]+)?$/); while (await DS.fs.exists(join(dir, n)) || (await DS.fs.walk(join(dir, n), 1)).length) n = m[1] + ' copy' + (i++ > 1 ? ' ' + i : '') + (m[2] || ''); return n; }
    async function moveAny(from, to) { from = norm(from); to = norm(to); if (from === to) return []; const moved = [];
      if (await DS.fs.exists(from)) { if (await DS.fs.exists(to)) throw new Error(to + ' already exists'); await DS.fs.move(from, to); moved.push([from, to]); return moved; }
      const files = await DS.fs.walk(from, 5000); if (!files.length) throw new Error('no such file or folder: ' + from);
      if (to.startsWith(from + '/')) throw new Error('cannot move a folder into itself');
      for (const f of files) { const t = to + f.slice(from.length); await DS.fs.move(f, t); moved.push([f, t]); } return moved; }
    async function copyAny(from, to) { from = norm(from); to = norm(to); const out = [];
      if (await DS.fs.exists(from)) { await DS.fs.copy(from, to); out.push([from, to]); return out; }
      const files = await DS.fs.walk(from, 5000); if (!files.length) throw new Error('no such file or folder: ' + from);
      for (const f of files) { const t = to + f.slice(from.length); await DS.fs.copy(f, t); out.push([f, t]); } return out; }
    async function downloadItem(it) {
      if (it.type === 'dir') { const z = await zipWorkspace(it.path); U.download(it.name + '.zip', new Blob([z.bytes], { type: 'application/zip' })); return; }
      const f = await DS.fs.read(it.path); if (DS.fs.isBinary(f.content)) U.download(it.name, new Blob([toBytes(f.content)], { type: f.content.slice(5, f.content.search(/[;,]/)) })); else U.download(it.name, f.content, 'text/plain');
    }
    function itemMenu(it, o = {}) {
      DS.ui.menu([
        it.type === 'file' && !o.inSheet && { label: 'Open', icon: 'file', run: () => openFile(it.path) },
        it.type === 'file' && !o.inSheet && !/^(image|binary)$/.test(kindOf(it.path)) && { label: 'Edit', icon: 'edit', run: () => openFile(it.path, { edit: true }) },
        { label: 'Rename', icon: 'edit', run: async () => { const n = await DS.ui.promptText('Rename', it.name); if (!n || n === it.name) return; if (/\//.test(n)) return ctx.toast('Use Move to change folders', 'warn'); try { await moveAny(it.path, join(dirOf(it.path), n)); ctx.toast('Renamed to ' + n, 'ok'); o.inSheet && o.inSheet.close(); } catch (e) { ctx.toast(e.message, 'err'); } } },
        { label: 'Move…', icon: 'redo', run: async () => { const n = await DS.ui.promptText('Move to (full path)', it.path); if (!n || norm(n) === it.path) return; try { await moveAny(it.path, n); ctx.toast('Moved to ' + norm(n), 'ok'); o.inSheet && o.inSheet.close(); } catch (e) { ctx.toast(e.message, 'err'); } } },
        { label: 'Duplicate', icon: 'copy', run: async () => { try { const d = dirOf(it.path); const n = await uniqueName(d, it.name); await copyAny(it.path, join(d, n)); ctx.toast('Created ' + n, 'ok'); } catch (e) { ctx.toast(e.message, 'err'); } } },
        { label: it.type === 'dir' ? 'Download .zip' : 'Download', icon: 'download', run: () => downloadItem(it).catch(e => ctx.toast(e.message, 'err')) },
        { label: 'Copy path', icon: 'copy', run: () => { U.copy(it.path); ctx.toast('Path copied', 'ok', 1200); } },
        { label: 'Delete', icon: 'trash', danger: true, run: async () => { if (!await DS.ui.confirm('Delete ' + (it.type === 'dir' ? 'folder ' : '') + '“' + it.name + '”?', 'Delete')) return; await DS.fs.remove(it.path); ctx.toast('Deleted ' + it.name, 'ok', 1400); o.inSheet && o.inSheet.close(); } },
      ].filter(Boolean), it.name);
    }

    /* ───── view ───── */
    const S = { cwd: '/', q: '', rerender: null };
    async function upload(dir) {
      const inp = U.el('input', { type: 'file', multiple: 'multiple' });
      inp.onchange = async () => { let n = 0; for (const file of inp.files) {
        if (file.size > 3e6) { ctx.toast(file.name + ' is too large (3 MB max)', 'warn'); continue; }
        const textual = /^text\/|json|xml|svg|javascript/.test(file.type) || KIND[ext(file.name)] && !/image/.test(KIND[ext(file.name)]) || CODE.test(ext(file.name));
        const content = textual ? await file.text() : await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
        await DS.fs.write(join(dir, file.name), content); n++; } if (n) ctx.toast('Uploaded ' + n + ' file' + (n > 1 ? 's' : ''), 'ok'); };
      inp.click();
    }
    async function downloadZip() { const z = await zipWorkspace('/'); const w = DS.store.ws(); U.download(((w && w.name) || 'workspace').replace(/[^\w.-]+/g, '-') + '.zip', new Blob([z.bytes], { type: 'application/zip' })); ctx.toast('Zipped ' + z.count + ' files · ' + DS.fmtBytes(z.bytes.length), 'ok'); }
    function plusMenu() {
      DS.ui.menu([
        { label: 'New file', icon: 'file', run: async () => { const n = await DS.ui.promptText('New file name', '', 'notes.md'); if (!n) return; const p = norm(n.startsWith('/') ? n : join(S.cwd, n)); if (await DS.fs.exists(p)) return ctx.toast('Already exists', 'warn'); await DS.fs.write(p, ''); openFile(p, { edit: true }); } },
        { label: 'New folder', icon: 'folder', run: async () => { const n = await DS.ui.promptText('New folder name', '', 'assets'); if (!n) return; const p = norm(join(S.cwd, n)); await DS.fs.write(p + '/.keep', ''); S.cwd = p; S.rerender && S.rerender(); } },
        { label: 'Upload from device', icon: 'upload', run: () => upload(S.cwd) },
        { label: 'Download workspace .zip', icon: 'download', run: () => downloadZip().catch(e => ctx.toast(e.message, 'err')) },
      ], 'Add');
    }
    ctx.view({ id: 'files', title: 'Files', icon: 'file', order: 10,
      badge: () => { const n = changedSet().length; return ''; },
      mount(el) {
        el.innerHTML = '<div class="vhead"><h2>Files</h2><div class="grow"></div><button class="icon-btn" data-up aria-label="Upload">' + IC.upload + '</button><button class="icon-btn" data-plus aria-label="New">' + IC.plus + '</button></div>' +
          '<div class="fx-top"><input class="inp" type="search" placeholder="Search in files…" aria-label="Search in files"></div><div class="fx-crumbs"></div><div class="vscroll"><div class="fx-list"></div></div>';
        const list = el.querySelector('.fx-list'), crumbs = el.querySelector('.fx-crumbs'), q = el.querySelector('.fx-top .inp');
        el.querySelector('[data-plus]').onclick = plusMenu; el.querySelector('[data-up]').onclick = () => upload(S.cwd);
        let seq = 0;
        const render = async () => {
          const my = ++seq;
          if (S.q.trim()) {
            crumbs.style.display = 'none'; let hits = [];
            try { hits = await DS.fs.search(S.q.trim(), { max: 120 }); } catch (e) { list.innerHTML = '<div class="empty-v">' + esc(e.message) + '</div>'; return; }
            const names = (await DS.fs.walk('/', 3000)).filter(p => base(p).toLowerCase().includes(S.q.trim().toLowerCase())).slice(0, 30);
            if (my !== seq) return; list.innerHTML = '';
            const re = new RegExp(S.q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig');
            if (names.length) { list.appendChild(U.el('div', { class: 'sec-t', style: 'padding:6px 12px' }, 'File names')); names.forEach(p => { const r = U.el('div', { class: 'fx-hit' }, '<div class="p">' + esc(p) + '</div>'); r.onclick = () => openFile(p); list.appendChild(r); }); }
            list.appendChild(U.el('div', { class: 'sec-t', style: 'padding:6px 12px' }, hits.length + ' match' + (hits.length === 1 ? '' : 'es') + ' in content'));
            hits.forEach(h => { const r = U.el('div', { class: 'fx-hit' }, '<div class="p">' + esc(h.path) + ':' + h.line + '</div><div class="t">' + esc(h.text.trim()).replace(re, m => '<mark>' + m + '</mark>') + '</div>'); r.onclick = () => openFile(h.path, { line: h.line }); list.appendChild(r); });
            if (!hits.length && !names.length) list.appendChild(U.el('div', { class: 'empty-v' }, 'No matches'));
            return;
          }
          crumbs.style.display = '';
          let ents = []; try { ents = await DS.fs.list(S.cwd); } catch (e) { list.innerHTML = '<div class="empty-v">' + esc(e.message) + '</div>'; return; }
          if (!ents.length && S.cwd !== '/') { S.cwd = dirOf(S.cwd); return render(); }
          if (my !== seq) return;
          const segs = S.cwd.split('/').filter(Boolean); crumbs.innerHTML = '';
          const cb = (label, p) => { const b = U.el('button', {}); b.textContent = label; b.onclick = () => { S.cwd = p; render(); }; crumbs.appendChild(b); };
          cb('⌂ ' + ((DS.store.ws() && DS.store.ws().name) || 'Workspace'), '/'); segs.forEach((s, i) => { crumbs.appendChild(U.el('span', { class: 'sep' }, '›')); cb(s, '/' + segs.slice(0, i + 1).join('/')); });
          setTimeout(() => crumbs.scrollLeft = 1e5, 0);
          const ch = changedSet(); list.innerHTML = '';
          const vis = ents.filter(e => e.name !== '.keep');
          if (!vis.length) list.appendChild(U.el('div', { class: 'empty-v' }, S.cwd === '/' ? 'No files yet. Tap <b>+</b> to create or upload, or ask the agent to build something.' : 'Empty folder'));
          for (const e of vis) {
            const changed = e.type === 'dir' ? ch.some(p => p.startsWith(e.path + '/')) : ch.includes(e.path);
            const k = e.type === 'dir' ? null : kindOf(e.path);
            const r = U.el('div', { class: 'fx-row', 'data-path': e.path, role: 'button', tabindex: '0' });
            r.innerHTML = '<div class="ic">' + (e.type === 'dir' ? IC.folder : glyph(k)) + '</div><div class="nf"><div class="nm">' + esc(e.name) + (changed ? '<span class="dot" title="Changed by the agent in this thread"></span>' : '') + '</div><div class="ds">' + (e.type === 'dir' ? 'Folder' : (e.size != null ? DS.fmtBytes(e.size) : '') + (e.mtime ? ' · ' + U.fmtAgo(e.mtime) : '')) + '</div></div>';
            const mb = U.el('button', { class: 'icon-btn', 'aria-label': 'Actions for ' + e.name }, IC.more);
            mb.onclick = ev => { ev.stopPropagation(); itemMenu(e); }; r.appendChild(mb);
            r.onclick = () => { if (e.type === 'dir') { S.cwd = e.path; render(); } else openFile(e.path); };
            r.onkeydown = ev => { if (ev.key === 'Enter') r.onclick(); };
            list.appendChild(r);
          }
        };
        S.rerender = render;
        q.addEventListener('input', U.debounce(() => { S.q = q.value; render(); }, 180));
        const offs = [DS.bus.on('fs:change', U.debounce(render, 120)), DS.bus.on('workspace:switch', () => { S.cwd = '/'; render(); }), DS.bus.on('changes:update', U.debounce(render, 120)), DS.bus.on('thread:switch', U.debounce(render, 120))];
        render();
        return () => { offs.forEach(o => typeof o === 'function' && o()); S.rerender = null; };
      },
      onShow() { S.rerender && S.rerender(); }
    });

    /* ───── tools ───── */
    ctx.tool({ name: 'fs_move', label: 'Move', gate: 'write', description: 'Move or rename a file or folder in the workspace.',
      parameters: { type: 'object', properties: { from: { type: 'string', description: 'Existing path' }, to: { type: 'string', description: 'New path' } }, required: ['from', 'to'] },
      detail: a => ({ path: norm(a.from || '/') + ' → ' + norm(a.to || '/') }),
      async run(a, t) { const from = norm(a.from), to = norm(a.to);
        const files = (await DS.fs.exists(from)) ? [from] : await DS.fs.walk(from, 5000); if (!files.length) throw new Error('no such file or folder: ' + from);
        for (const f of files) { const tgt = to + f.slice(from.length); let before = null; try { before = (await DS.fs.read(tgt)).content; } catch (_) {} if (before !== null) throw new Error(tgt + ' already exists'); DS.agent.recordChange(t.thread, f, (await DS.fs.read(f)).content); DS.agent.recordChange(t.thread, tgt, null); }
        const moved = await moveAny(from, to); return { from, to, moved: moved.length }; },
      summarize: (a, r) => r && r.to ? base(r.from) + ' → ' + r.to : 'move' });
    ctx.tool({ name: 'fs_copy', label: 'Copy', gate: 'write', description: 'Copy a file or folder to a new path (overwrites the target file if it exists).',
      parameters: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] },
      detail: a => ({ path: norm(a.from || '/') + ' ⇒ ' + norm(a.to || '/') }),
      async run(a, t) { const from = norm(a.from), to = norm(a.to);
        const files = (await DS.fs.exists(from)) ? [from] : await DS.fs.walk(from, 5000); if (!files.length) throw new Error('no such file or folder: ' + from);
        for (const f of files) { const tgt = to + f.slice(from.length); let before = null; try { before = (await DS.fs.read(tgt)).content; } catch (_) {} DS.agent.recordChange(t.thread, tgt, before); }
        const c = await copyAny(from, to); return { from, to, copied: c.length }; },
      summarize: (a, r) => r && r.to ? base(r.from) + ' ⇒ ' + r.to : 'copy' });
    ctx.tool({ name: 'fs_stat', label: 'Stat', gate: 'read', description: 'File or folder metadata: type, size in bytes, line count, mtime, kind.',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      async run(a) { const p = norm(a.path || '/');
        if (p !== '/' && await DS.fs.exists(p)) { const f = await DS.fs.read(p); const bin = DS.fs.isBinary(f.content); return { path: p, type: 'file', kind: kindOf(p, f.content), size: bytesOf(f.content), lines: bin ? null : f.content.split('\n').length, mtime: f.mtime ? new Date(f.mtime).toISOString() : null, binary: bin }; }
        const files = await DS.fs.walk(p, 5000); if (!files.length && p !== '/') throw new Error('no such file or folder: ' + p);
        let size = 0, mt = 0; for (const f of files) { try { const r = await DS.fs.read(f); size += bytesOf(r.content); mt = Math.max(mt, r.mtime || 0); } catch (_) {} }
        return { path: p, type: 'dir', files: files.length, size, mtime: mt ? new Date(mt).toISOString() : null, entries: (await DS.fs.list(p)).slice(0, 40).map(e => e.name + (e.type === 'dir' ? '/' : '')) }; },
      summarize: (a, r) => r ? (r.type === 'dir' ? r.files + ' files · ' + DS.fmtBytes(r.size) : DS.fmtBytes(r.size) + (r.lines ? ' · ' + r.lines + ' lines' : '')) : 'stat' });

    /* ───── commands ───── */
    async function openPath(arg) {
      const p = norm((arg || '').trim() || '/'); DS.shell.show('files');
      if (await isDir(p)) { S.cwd = p; S.q = ''; S.rerender && S.rerender(); return 'dir'; }
      if (!await DS.fs.exists(p)) return null; S.cwd = dirOf(p); S.rerender && S.rerender(); await openFile(p); return 'file';
    }
    ctx.command({ name: 'open', args: '<path>', desc: 'Open a file or folder in the Files view', async run(arg, c) { const r = await openPath(arg); if (!r) c.reply('No such file: `' + norm(arg || '/') + '`'); } });
    ctx.command({ name: 'files', desc: 'Browse & edit workspace files', run() { DS.shell.show('files'); } });
    ctx.threadAction({ id: 'zip', icon: 'download', label: 'Download workspace .zip', run: () => downloadZip() });

    /* ───── offline Sim intents ───── */
    const P = s => { s = s.replace(/^[`'"]|[`'".,!?]+$/g, ''); return s.startsWith('/') ? s : '/' + s; };
    ctx.intent({ id: 'files-move', order: 50, match: t => /\b(move|rename|mv)\s+\S+\s+(to|as|->|into)\s+\S+/i.test(t), script: t => {
      const m = t.match(/\b(?:move|rename|mv)\s+(\S+)\s+(?:to|as|->|into)\s+(\S+)/i); const from = P(m[1]); let to = m[2].replace(/^[`'"]|[`'".,!?]+$/g, '');
      if (!to.startsWith('/')) to = (/\brename\b/i.test(t) || !to.includes('/') && /\.\w+$/.test(to) ? join(dirOf(from), to) : '/' + to);
      if (/\binto\b/i.test(t) || to.endsWith('/')) to = join(norm(to), base(from));
      return [{ say: 'Moving `' + from + '` → `' + norm(to) + '`.', tool: { name: 'fs_move', args: { from, to: norm(to) } } }, { final: rs => rs[0] && rs[0].to ? 'Done — moved **' + base(from) + '** to `' + rs[0].to + '`' + (rs[0].moved > 1 ? ' (' + rs[0].moved + ' files)' : '') + '. You can revert it from **Changes**.' : 'Could not move it: ' + JSON.stringify(rs[0]) }]; } });
    ctx.intent({ id: 'files-copy', order: 50, match: t => /\b(copy|duplicate|cp)\s+\S+\s+(to|as|into)\s+\S+/i.test(t), script: t => {
      const m = t.match(/\b(?:copy|duplicate|cp)\s+(\S+)\s+(?:to|as|into)\s+(\S+)/i); const from = P(m[1]); let to = m[2].replace(/^[`'"]|[`'".,!?]+$/g, '');
      if (!to.startsWith('/')) to = to.includes('/') ? '/' + to : join(dirOf(from), to); if (/\binto\b/i.test(t)) to = join(norm(to), base(from));
      return [{ tool: { name: 'fs_copy', args: { from, to: norm(to) } } }, { final: rs => rs[0] && rs[0].to ? 'Copied `' + from + '` → `' + rs[0].to + '`' + (rs[0].copied > 1 ? ' (' + rs[0].copied + ' files)' : '') + '.' : 'Copy failed: ' + JSON.stringify(rs[0]) }]; } });
    ctx.intent({ id: 'files-open', order: 50, match: t => /\b(show|open|browse)\b.*\b(the\s+)?files?\s*(view|browser|explorer|manager)?\s*$/i.test(t.trim()) || /\bfile (browser|explorer|manager)\b/i.test(t), script: () => [
      { tool: { name: 'fs_stat', args: { path: '/' } } },
      { final: rs => { setTimeout(() => DS.shell.show('files'), 250); const r = rs[0] || {}; return 'Opening the **Files** view — ' + (r.files || 0) + ' files, ' + DS.fmtBytes(r.size || 0) + '.\n\nTap a file to preview it (markdown, HTML, JSON, CSV, images), switch to **Edit** to change it, or use **+** to upload or download the whole workspace as a .zip.'; } }] });
    ctx.intent({ id: 'files-stat', order: 50, match: t => /\b(stat|size of|how big is|info (on|about))\s+\/?[\w./-]+/i.test(t), script: t => { const m = t.match(/(\/?[\w.-]+(?:\/[\w.-]+)*\.?\w*)\s*\??$/); const p = P(m ? m[1] : '/'); return [{ tool: { name: 'fs_stat', args: { path: p } } }, { final: rs => { const r = rs[0] || {}; return r.type ? '`' + r.path + '` — ' + (r.type === 'dir' ? 'folder, ' + r.files + ' files, ' : r.kind + ', ' + (r.lines ? r.lines + ' lines, ' : '')) + DS.fmtBytes(r.size) + (r.mtime ? ', modified ' + r.mtime.slice(0, 16).replace('T', ' ') : '') + '.' : 'Not found: ' + JSON.stringify(r); } }]; } });
    ctx.suggest({ id: 'files', emoji: '🗂️', title: 'Browse & edit files', sub: 'preview, edit, zip the workspace', prompt: 'open the files' });
  }
});

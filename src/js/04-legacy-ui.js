/* ── toast / sheet / confirm / prompt / menu / panel ── */
/* ─────────────── UI primitives ─────────────── */
const ui = DS.ui = {
  toast(msg, kind='', ms=2400){
    const t = el('div', { class: 'toast ' + kind, role: kind === 'err' ? 'alert' : 'status' }); t.textContent = msg;
    $('#toasts').appendChild(t); setTimeout(() => { t.style.transition = 'opacity .2s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 220); }, ms);
  },
  /* Bottom sheet / modal. Returns { el, body, close }. opts: { title, html|node, full, actions:[{label, primary, danger, onClick(close)}], onClose } */
  sheet(opts={}){
    const wrap = el('div', { class: 'sheet-wrap', role: 'dialog', 'aria-modal': 'true' });
    const sh = el('div', { class: 'sheet' + (opts.full ? ' full' : '') });
    sh.innerHTML = '<div class="sheet-grab"></div><div class="sheet-h"><h3></h3><div data-hx style="display:flex;gap:4px"></div><button class="icon-btn" data-x aria-label="Close">' + DS.icons.x + '</button></div><div class="sheet-b"></div>';
    sh.querySelector('h3').textContent = opts.title || '';
    const body = sh.querySelector('.sheet-b');
    if (opts.noPad) body.style.padding = '0';
    if (opts.node) body.appendChild(opts.node); else if (opts.html) body.innerHTML = opts.html;
    if (opts.actions && opts.actions.length){
      const f = el('div', { class: 'sheet-f' });
      opts.actions.forEach(a => { const b = el('button', { class: 'btn' + (a.primary ? ' pri' : '') + (a.danger ? ' danger' : '') }); b.textContent = a.label; b.onclick = () => a.onClick ? a.onClick(close) : close(); f.appendChild(b); });
      sh.appendChild(f);
    }
    wrap.appendChild(sh); document.body.appendChild(wrap);
    let closed = false;
    function close(){ if (closed) return; closed = true; document.removeEventListener('keydown', onKey); wrap.style.transition = 'opacity .18s'; wrap.style.opacity = '0'; setTimeout(() => wrap.remove(), 180); try { opts.onClose && opts.onClose(); } catch(e){} }
    const onKey = e => { if (e.key === 'Escape' && wrap === $$('.sheet-wrap').pop()) close(); };
    document.addEventListener('keydown', onKey);
    wrap.addEventListener('pointerdown', e => { if (e.target === wrap) close(); });
    sh.querySelector('[data-x]').onclick = close;
    return { el: sh, wrap, body, header: sh.querySelector('[data-hx]'), close };
  },
  confirm(text, okLabel='Confirm', danger=true){
    return new Promise(res => { let done = false; const s = ui.sheet({ title: text, html: '', actions: [ { label: 'Cancel', onClick: c => { done = true; res(false); c(); } }, { label: okLabel, primary: !danger, danger, onClick: c => { done = true; res(true); c(); } } ], onClose: () => { if (!done) res(false); } }); s.body.remove(); });
  },
  promptText(title, value='', placeholder=''){
    return new Promise(res => {
      let done = false; const inp = el('input', { class: 'inp', placeholder }); inp.value = value;
      const s = ui.sheet({ title, node: inp, actions: [ { label: 'Cancel', onClick: c => { done = true; res(null); c(); } }, { label: 'Save', primary: true, onClick: c => { done = true; res(inp.value); c(); } } ], onClose: () => { if (!done) res(null); } });
      inp.addEventListener('keydown', e => { if (e.key === 'Enter'){ done = true; res(inp.value); s.close(); } });
      setTimeout(() => { inp.focus(); inp.select(); }, 60);
    });
  },
  menu(items, title=''){
    const box = el('div', { class: 'menu' });
    const s = ui.sheet({ title: title || 'Options', node: box });
    items.forEach(it => { const b = el('button', { class: it.danger ? 'danger' : '' }, (it.icon ? DS.icon(it.icon) : '') + '<span>' + esc(it.label) + '</span>'); b.onclick = () => { s.close(); it.run(); }; box.appendChild(b); });
    return s;
  },
  /* Full-screen panel for studios (images, video, apps...). render(bodyEl, close) */
  panel(opts){ const s = ui.sheet({ title: opts.title, full: opts.full !== false, noPad: !!opts.noPad, onClose: opts.onClose }); try { opts.render(s.body, s.close, s); } catch(e){ console.error(e); s.body.textContent = 'Panel failed: ' + e.message; } return s; }
};


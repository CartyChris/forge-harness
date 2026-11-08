/* ── reused, tested helpers: util / icons / logo ── */
/* ─────────────── util ─────────────── */
const util = DS.util = {
  $, $$,
  uid: (p='id') => p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2,8),
  esc: s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
  sleep: ms => new Promise(r => setTimeout(r, ms)),
  clamp: (n,a,b) => Math.max(a, Math.min(b, n)),
  debounce(fn, ms){ let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; },
  throttleRAF(fn){ let q = false, args; return (...a) => { args = a; if (q) return; q = true; requestAnimationFrame(() => { q = false; fn(...args); }); }; },
  el(tag, attrs={}, html){ const e = document.createElement(tag); for (const k in attrs){ if (k === 'class') e.className = attrs[k]; else if (k.startsWith('on') && typeof attrs[k] === 'function') e.addEventListener(k.slice(2), attrs[k]); else if (attrs[k] != null) e.setAttribute(k, attrs[k]); } if (html != null) e.innerHTML = html; return e; },
  async copy(text){
    try { await navigator.clipboard.writeText(text); DS.ui.toast('Copied', 'ok'); return true; }
    catch(_){ const t = document.createElement('textarea'); t.value = text; t.style.position='fixed'; t.style.opacity='0'; document.body.appendChild(t); t.select(); let ok=false; try{ ok = document.execCommand('copy'); }catch(e){} t.remove(); DS.ui.toast(ok ? 'Copied' : 'Copy failed', ok ? 'ok' : 'err'); return ok; }
  },
  download(name, content, type='text/plain'){
    const blob = content instanceof Blob ? content : new Blob([content], {type});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  },
  /* Sandboxed iframe for generated apps/games/animations. */
  sandboxFrame(html, opts={}){
    const f = document.createElement('iframe');
    f.setAttribute('sandbox', opts.sandbox || 'allow-scripts allow-modals allow-pointer-lock allow-popups allow-forms allow-downloads');
    f.setAttribute('allow', 'accelerometer; gyroscope; fullscreen; autoplay; clipboard-write');
    f.setAttribute('referrerpolicy', 'no-referrer');
    f.style.cssText = 'width:100%;height:100%;border:0;display:block;background:#fff';
    f.srcdoc = html;
    return f;
  },
  fmtAgo(ts){ const s = (Date.now()-ts)/1000; if (s<60) return 'just now'; if (s<3600) return Math.floor(s/60)+'m ago'; if (s<86400) return Math.floor(s/3600)+'h ago'; return Math.floor(s/86400)+'d ago'; }
};
const { esc, uid, el } = util;

/* ─────────────── icons ─────────────── */
const P = d => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>';
DS.icons = {
  sidebar: P('<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/>'),
  plusChat: P('<path d="M12 20.5c4.7 0 8.5-3.6 8.5-8.2S16.7 4 12 4 3.5 7.7 3.5 12.3c0 1.6.5 3.1 1.3 4.4L4 20l3.6-.9c1.3.9 2.8 1.4 4.4 1.4z"/><path d="M12 9v6M9 12h6"/>'),
  search: P('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-3.8-3.8"/>'),
  gear: P('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  clip: P('<path d="m21 11.5-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.6-8.6a3.7 3.7 0 0 1 5.2 5.2l-8.6 8.6a1.8 1.8 0 0 1-2.6-2.6l7.9-7.9"/>'),
  up: P('<path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/>'),
  stop: '<svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"/></svg>',
  down: P('<path d="M12 5v14M5.5 12.5 12 19l6.5-6.5"/>'),
  copy: P('<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>'),
  check: P('<path d="M5 12.5 10 17.5 19 7"/>'),
  redo: P('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>'),
  edit: P('<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>'),
  trash: P('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>'),
  more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>',
  x: P('<path d="M6 6l12 12M18 6 6 18"/>'),
  atom: P('<circle cx="12" cy="12" r="1.6"/><ellipse cx="12" cy="12" rx="9.5" ry="4" /><ellipse cx="12" cy="12" rx="9.5" ry="4" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9.5" ry="4" transform="rotate(120 12 12)"/>'),
  globe: P('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.8 3 2.8 15 0 18M12 3c-2.8 3-2.8 15 0 18"/>'),
  chev: P('<path d="m6 9 6 6 6-6"/>'),
  file: P('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>'),
  sun: P('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  play: P('<path d="M7 5v14l12-7z"/>'),
  expand: P('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  download: P('<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>'),
  code: P('<path d="m8 8-4 4 4 4M16 8l4 4-4 4M14 5l-4 14"/>'),
  sparkle: P('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>'),
  image: P('<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>'),
  video: P('<rect x="3" y="5" width="13" height="14" rx="3"/><path d="m16 10 5-3v10l-5-3"/>'),
  game: P('<path d="M6 8h12a4 4 0 0 1 4 4v1a4 4 0 0 1-7 2.6L14 15h-4l-1 .6A4 4 0 0 1 2 13v-1a4 4 0 0 1 4-4z"/><path d="M7 11v3M5.5 12.5h3"/><circle cx="16" cy="11.5" r=".6" fill="currentColor"/><circle cx="18" cy="13.5" r=".6" fill="currentColor"/>'),
  mic: P('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>'),
  speaker: P('<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>'),
  branch: P('<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="8" r="2"/><path d="M6 7v10M18 10c0 4-6 3-12 7"/>'),
  terminal: P('<rect x="3" y="4" width="18" height="16" rx="3"/><path d="m7 9 3 3-3 3M13 15h4"/>'),
  thumbUp: P('<path d="M7 11v9H4v-9zM7 11l4-8a2.5 2.5 0 0 1 2.5 3L13 10h5.5a2 2 0 0 1 2 2.4l-1.4 6A2 2 0 0 1 17.2 20H7"/>'),
  thumbDown: P('<path d="M7 13V4H4v9zM7 13l4 8a2.5 2.5 0 0 0 2.5-3L13 14h5.5a2 2 0 0 0 2-2.4l-1.4-6A2 2 0 0 0 17.2 4H7"/>'),
  share: P('<path d="M12 15V3M7.5 7.5 12 3l4.5 4.5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>')
};
DS.icon = (name) => '<span class="ico">' + (DS.icons[name] || DS.icons.sparkle) + '</span>';
/* Original logo mark: a stylised wave/comet in a soft circle. */
DS.logoSVG = '<svg viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6b86ff"/><stop offset="1" stop-color="#3a56e8"/></linearGradient></defs><path d="M10 40c7 9 27 11 37-1 6-7 6-17 0-23-2 8-9 13-18 12 6-4 8-10 6-16C22 15 11 25 10 40z" fill="url(#lg)"/><circle cx="44" cy="22" r="2.6" fill="#fff"/></svg>';


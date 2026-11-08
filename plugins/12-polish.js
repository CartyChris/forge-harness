/* forge.polish (V6) — "Refined UI": a scoped, theme-agnostic stylesheet + tiny DOM enhancements.
   Everything is keyed off html.fp so turning the setting off restores the core look exactly. */
const FP_CSS = `
html.fp{--fp-ease:cubic-bezier(.2,.8,.2,1);--fp-ring:0 0 0 3px color-mix(in srgb,var(--accent) 30%,transparent);--fp-elev:0 1px 0 color-mix(in srgb,var(--text) 6%,transparent) inset,0 10px 30px -12px rgba(0,0,0,.45),0 2px 6px -2px rgba(0,0,0,.25)}
html.fp body{font-feature-settings:'kern','liga','calt';-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;text-rendering:optimizeLegibility}
html.fp ::selection{background:color-mix(in srgb,var(--accent) 34%,transparent);color:inherit}
html.fp :focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:8px}
html.fp *{scrollbar-width:thin;scrollbar-color:var(--line-2) transparent}
html.fp ::-webkit-scrollbar{width:10px;height:10px}html.fp ::-webkit-scrollbar-thumb{background:var(--line-2);border-radius:10px;border:3px solid transparent;background-clip:padding-box}html.fp ::-webkit-scrollbar-thumb:hover{background:var(--muted);background-clip:padding-box;border:3px solid transparent}
/* header */
html.fp #hdr{gap:8px;padding-right:10px}
html.fp #hdr .title{font-size:14.5px;font-weight:620;letter-spacing:-.01em;color:var(--text)}
html.fp .hsub{letter-spacing:.01em;opacity:.9}
html.fp .hchip{min-height:32px;border-radius:9px;transition:border-color .15s,background-color .15s}
html.fp .hchip:hover{border-color:var(--accent-line)}
/* thread rhythm */
html.fp #msgs{padding:18px 16px 12px}
html.fp .msgs-in{max-width:760px;gap:18px}
html.fp .turn{animation:fp-in .28s var(--fp-ease) both}
html.fp .turn.assistant .final .md,html.fp .turn.assistant>.final{line-height:1.62;text-wrap:pretty}
html.fp .md{max-width:70ch}
html.fp .md h1,html.fp .md h2,html.fp .md h3{letter-spacing:-.015em;font-weight:650;color:var(--text)}
html.fp .md strong,html.fp .md b{color:var(--text);font-weight:620}
html.fp .md a{text-underline-offset:3px;text-decoration-thickness:1px}
html.fp .md li::marker{color:var(--muted)}
html.fp:not([data-layout="bubbles"]) .turn.user .bubble{background:color-mix(in srgb,var(--accent) 11%,var(--card));border-color:color-mix(in srgb,var(--accent) 24%,var(--line-2));border-radius:18px 18px 6px 18px;padding:10px 14px;line-height:1.5;color:var(--text)}
html.fp .turn.user{max-width:min(86%,560px)}
html.fp .mactions button{height:32px;border-radius:9px;transition:color .15s,background-color .15s}
/* worked line + tool cards with a clear status rail */
html.fp .worked{font-size:12px;letter-spacing:.01em;min-height:28px}
html.fp .tcall{position:relative;border-radius:10px;background:var(--bg-2);border-color:var(--line);transition:border-color .15s}
html.fp .tcall::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--line-2)}
html.fp .tcall.st-ok::before{background:var(--ok)}html.fp .tcall.st-err::before,html.fp .tcall.st-denied::before{background:var(--danger)}
html.fp .tcall.st-running::before,html.fp .tcall.st-pending::before{background:var(--accent);animation:pulse 1.2s infinite}html.fp .tcall.st-aborted::before{background:var(--warn)}
html.fp .tcall:hover{border-color:var(--line-2)}
html.fp .tc-h{min-height:42px;padding:8px 12px 8px 14px}
html.fp .tc-h .nm{color:var(--text);letter-spacing:-.01em}
html.fp .tc-b{padding:10px 14px;background:var(--code-bg)}
html.fp .tc-b .lbl{font-weight:600;letter-spacing:.1em}
/* code blocks */
html.fp .cb{border-radius:10px;border-color:var(--line)}
html.fp .cb-h{padding:4px 6px 4px 12px;min-height:34px;letter-spacing:.02em}
html.fp .cb-h button{min-height:28px;padding:4px 8px}
html.fp .cb pre{padding:12px 14px;font-size:12.5px;line-height:1.6;tab-size:2}
html.fp .md :not(pre)>code{font-size:.86em;background:color-mix(in srgb,var(--text) 7%,transparent);border-color:transparent;padding:.12em .4em}
/* empty state: left-aligned editorial hero + 2x2 starter grid */
html.fp .empty{max-width:680px;margin:clamp(16px,7vh,72px) auto 0;text-align:left;padding:0 4px}
html.fp .empty>svg{display:none}
html.fp .fp-mark{display:block;width:44px;height:44px;border-radius:12px;box-shadow:0 0 0 1px var(--line-2),0 8px 24px -10px color-mix(in srgb,var(--accent) 60%,transparent)}
html.fp .empty h1{font-size:clamp(24px,6.4vw,32px);line-height:1.12;letter-spacing:-.028em;font-weight:680;margin:18px 0 8px;color:var(--text);text-wrap:balance}
html.fp .empty p{font-size:14px;line-height:1.55;color:var(--muted);margin:0 0 22px;max-width:52ch;text-wrap:pretty}
html.fp .empty p b{color:var(--text-2);font-weight:600}
html.fp .sugg{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
html.fp .sugg:has(.more):not(.fp-all) .sg:nth-child(n+5):not(.more){display:none!important}
html.fp .sg{flex-direction:column;align-items:flex-start;gap:8px;padding:13px 14px;min-height:104px;border-radius:12px;background:var(--bg-2);border:1px solid var(--line);transition:border-color .18s,background-color .18s,transform .18s var(--fp-ease)}
html.fp .sg:hover{border-color:var(--accent-line);background:var(--card);transform:translateY(-1px)}
html.fp .sg:active{transform:translateY(0) scale(.99)}
html.fp .sg .em{font-size:18px;line-height:1;width:32px;height:32px;display:inline-flex;align-items:center;justify-content:center;border-radius:9px;background:var(--card-2);border:1px solid var(--line)}
html.fp .sg b{font-size:13.5px;font-weight:620;letter-spacing:-.01em;line-height:1.3;color:var(--text)}
html.fp .sg span.s{display:block;margin-top:3px;font-size:12px;line-height:1.4}
html.fp .sg.more{grid-column:1/-1;min-height:44px;flex-direction:row;padding:8px 14px;background:transparent;border-style:dashed}
@media (orientation:landscape) and (max-height:500px){html.fp .empty{margin-top:8px}html.fp .fp-mark{width:32px;height:32px;border-radius:9px}html.fp .empty h1{font-size:21px;margin:10px 0 4px}html.fp .empty p{margin-bottom:12px;font-size:13px}html.fp .sugg{grid-template-columns:repeat(4,minmax(0,1fr))}html.fp .sg{min-height:92px}html.fp .sg span.s{display:none}html.fp .sg.more{grid-column:1/-1}}
@media (min-width:900px){html.fp .sugg{grid-template-columns:repeat(4,minmax(0,1fr))}html.fp .sg{min-height:124px}html.fp .empty{max-width:760px}}
/* composer */
html.fp #composer{padding:8px 12px 10px;padding-bottom:calc(10px + max(var(--sab),var(--kb)))}
html.fp .cmp{max-width:760px}
html.fp .cmp-box{border-radius:16px;padding:6px 6px 6px;box-shadow:var(--fp-elev);transition:border-color .18s,box-shadow .18s}
html.fp .cmp-box:focus-within{border-color:var(--accent);box-shadow:var(--fp-elev),var(--fp-ring)}
html.fp .cmp textarea{font-size:16px;padding:8px 10px 4px;line-height:1.45}
html.fp .cmp textarea:focus-visible{outline:none}
html.fp .cmp textarea::placeholder{color:var(--muted);opacity:1}
html.fp .cmp-btn{height:40px;min-width:40px;border-radius:11px}
html.fp .pill{height:32px;border-radius:9px;padding:0 11px}
html.fp .cmp-send{width:40px;height:40px;border-radius:12px;transition:transform .15s var(--fp-ease),background-color .15s,opacity .15s;box-shadow:0 4px 14px -6px color-mix(in srgb,var(--accent) 80%,transparent)}
html.fp .cmp-send:not([disabled]):hover{transform:translateY(-1px)}
html.fp .cmp-send:not([disabled]):active{transform:scale(.94)}
html.fp .cmp-send[disabled]{box-shadow:none;opacity:.7}
html.fp .ac{border-radius:12px}
/* settings & lists */
html.fp .vhead h2{letter-spacing:-.02em;font-weight:660}
html.fp .sec-t{letter-spacing:.12em;margin-top:22px}
html.fp .li{border-radius:10px;transition:border-color .15s}
html.fp .li:hover{border-color:var(--line-2)}
html.fp .btn{min-height:40px;border-radius:10px;transition:border-color .15s,background-color .15s,transform .12s}
html.fp .btn.sm{min-height:32px}
html.fp .sheet{border-radius:16px 16px 0 0}
@media (min-width:700px){html.fp .sheet{border-radius:16px}}
@keyframes fp-in{from{opacity:0;transform:translateY(6px)}}
@media (prefers-reduced-motion:reduce){html.fp *,html.fp *::before,html.fp *::after{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important}}
`;

DS.plugin({
  name: 'forge.polish', title: 'Refined UI', version: '1.0.0', tags: ['ui', 'theme'],
  description: 'Premium typography, rhythm, composer, tool-card status rails and empty state — theme-agnostic (CSS vars only).',
  apply(ctx) {
    const root = document.documentElement; let off = null;
    const iconHref = () => { const l = document.querySelector('link[rel~="icon"]'); return l ? l.href : ''; };
    const markEmpty = () => {
      document.querySelectorAll('.empty').forEach(e => {
        if (e.querySelector('.fp-mark')) return; const h = iconHref(); if (!h) return;
        const img = document.createElement('img'); img.className = 'fp-mark'; img.alt = ''; img.src = h; img.width = 44; img.height = 44; img.decoding = 'async';
        e.insertBefore(img, e.firstChild);
      });
    };
    const onClick = ev => { const m = ev.target && ev.target.closest && ev.target.closest('.sg.more'); if (m && m.parentElement) m.parentElement.classList.add('fp-all'); };
    function enable() {
      if (off) return;
      const s = document.createElement('style'); s.id = 'fp-style'; s.textContent = FP_CSS; document.head.appendChild(s);
      root.classList.add('fp'); markEmpty();
      const host = document.getElementById('views') || document.body;
      /* no :has() (old Safari throws on it) and cheap on every streaming mutation: debounce to one frame, bail when there is no icon */
      let pend = false; const mo = new MutationObserver(() => { if (pend || !iconHref()) return; pend = true; requestAnimationFrame(() => { pend = false; const es = host.querySelectorAll('.empty'); for (const e of es) if (!e.querySelector('.fp-mark')) { markEmpty(); break; } }); });
      mo.observe(host, { childList: true, subtree: true });
      document.addEventListener('click', onClick, true);
      off = () => { mo.disconnect(); document.removeEventListener('click', onClick, true); s.remove(); root.classList.remove('fp'); document.querySelectorAll('.fp-mark').forEach(x => x.remove()); document.querySelectorAll('.sugg.fp-all').forEach(x => x.classList.remove('fp-all')); off = null; };
    }
    const disable = () => { if (off) off(); };
    const isOn = () => ctx.data.get('enabled', true) !== false;
    if (isOn()) enable();
    ctx.effect(() => () => disable());
    ctx.settings({
      id: 'polish', title: 'Appearance',
      render(el) {
        const row = document.createElement('div'); row.className = 'row'; row.style.cssText = 'min-height:44px;gap:12px';
        row.innerHTML = '<div class="grow"><div style="font-weight:600;font-size:13.5px">Refined UI</div><div class="sm muted">Polished typography, composer, tool cards and empty state. Works with every theme.</div></div>';
        const b = document.createElement('button'); b.id = 'fp-toggle'; b.type = 'button'; b.setAttribute('role', 'switch'); b.setAttribute('aria-label', 'Refined UI');
        b.style.cssText = 'min-width:44px;min-height:44px;display:inline-flex;align-items:center;justify-content:center';
        const sw = document.createElement('span'); sw.className = 'sw'; b.appendChild(sw);
        const sync = () => { const on = isOn(); sw.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); };
        b.onclick = () => { const on = !isOn(); ctx.data.set('enabled', on); on ? enable() : disable(); sync(); };
        sync(); row.appendChild(b); el.appendChild(row);
      }
    });
  }
});

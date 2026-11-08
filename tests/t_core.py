#!/usr/bin/env python3
"""Core regression: boot, no page errors, Sim tool run, every view opens without page errors or horizontal overflow,
and the chat never scrolls sideways even with very long unbreakable text, JSON errors, tool cards and code.
usage: t_core.py <abs html> [shotdir]"""
import sys, os, asyncio
from playwright.async_api import async_playwright
HTML = os.path.abspath(sys.argv[1]); SHOT = sys.argv[2] if len(sys.argv) > 2 else None
fails = []
def check(n, c, i=''):
    print(('PASS ' if c else 'FAIL ') + n + ((' — ' + str(i)[:400]) if i and not c else ''), flush=True)
    if not c: fails.append(n)
LONG = 'x' * 400
ERRJSON = 'Pollinations (free, no key): the API key was rejected. Server said: {"success":false,"error":{"message":"A valid API key is required. Get one at https://enter.pollinations.ai/keys/very/long/path/that/never/breaks/' + 'a' * 120 + '","code":"UNAUTHORIZED","timestamp":"2026-11-08T19:02:11.000Z"}}'
async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch()
        for (w, h) in [(390, 844), (844, 390), (1280, 800)]:
            ctx = await b.new_context(viewport={'width': w, 'height': h}, has_touch=w < 900, is_mobile=w < 900)
            pg = await ctx.new_page(); errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)))
            await pg.goto('file://' + HTML); await pg.wait_for_function('window.DS && DS.ready', timeout=20000); await pg.wait_for_timeout(500)
            tag = '%dx%d' % (w, h)
            if w == 390:
                await pg.evaluate("DS.store.settings().permission='unrestricted'")
                await pg.evaluate("DS.store.newThread()")
                await pg.fill('#cmp-ta', 'list files'); await pg.click('#cmp-send')
                await pg.wait_for_function("!DS.agent.isRunning(DS.store.activeThread())", timeout=30000)
                st = await pg.evaluate("(DS.store.activeThread().messages.at(-1).parts||[]).filter(p=>p.type==='tool').map(p=>p.status)")
                check(tag + ' Sim tool run ok', st and all(s == 'ok' for s in st), st)
            # chat overflow: inject nasty content into a thread and render
            await pg.evaluate("""([LONG, ERR]) => { const t = DS.store.newThread(); const U = DS.util;
              t.messages.push({ id: U.uid('m'), role: 'user', content: 'Hi ' + LONG, ts: Date.now() });
              t.messages.push({ id: U.uid('m'), role: 'assistant', ts: Date.now(), parts: [
                { type: 'reasoning', text: 'thinking ' + LONG },
                { type: 'text', text: 'Here: ' + LONG + '\\n\\n```json\\n{"k":"' + LONG + '"}\\n```\\n| a | b |\\n|---|---|\\n| ' + LONG + ' | y |' },
                { type: 'tool', id: 't1', name: 'tool_call', args: { blob: LONG }, status: 'err', result: { error: ERR } } ], meta: { error: ERR } });
              DS.store.save(); DS.shell.show('chat'); DS.threadView && DS.threadView.renderAll && DS.threadView.renderAll(); }""", [LONG, ERRJSON])
            await pg.wait_for_timeout(500)
            ov = await pg.evaluate("""() => { const sc = document.querySelector('#msgs');
              const de = document.documentElement; const out = { page: de.scrollWidth - de.clientWidth };
              if (sc) { out.thread = sc.scrollWidth - sc.clientWidth; sc.scrollLeft = 500; out.left = sc.scrollLeft; }
              const vp = innerWidth; out.wide = [...document.querySelectorAll('.msg, .msg *')].filter(e => { const r = e.getBoundingClientRect(); if (!r.width) return false; let p = e.parentElement, scrolls = false; while (p) { const cs = getComputedStyle(p); if (/(auto|scroll)/.test(cs.overflowX) && p.scrollWidth > p.clientWidth + 1 && !/thread|scroll/.test(p.id||'')) { scrolls = true; break; } p = p.parentElement; } return !scrolls && r.right > vp + 1; }).slice(0, 5).map(e => e.tagName + '.' + (e.className || '').toString().slice(0, 40) + ' r=' + Math.round(e.getBoundingClientRect().right));
              return out; }""")
            check(tag + ' page has no horizontal scroll', ov['page'] <= 0, ov)
            check(tag + ' chat cannot scroll sideways', ov.get('left', 0) == 0, ov)
            check(tag + ' nothing in messages sticks out past the screen', not ov['wide'], ov['wide'])
            if SHOT: os.makedirs(SHOT, exist_ok=True); await pg.screenshot(path=f'{SHOT}/chat-{tag}.png')
            views = await pg.evaluate("DS.shell.views().map(v => v.id)")
            bad = []
            for v in views:
                try:
                    await pg.evaluate(f"DS.shell.show('{v}')"); await pg.wait_for_timeout(120)
                    o = await pg.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
                    if o > 0: bad.append(f'{v}+{o}')
                except Exception as e: bad.append(f'{v}!{str(e)[:60]}')
            check(tag + ' all %d views open w/o page overflow' % len(views), not bad, bad)
            check(tag + ' no page errors', not errs, errs[:3])
            await ctx.close()
        await b.close()
asyncio.run(main()); print('\nFAILS:', fails or 'none'); sys.exit(1 if fails else 0)

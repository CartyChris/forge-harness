#!/usr/bin/env python3
"""IDE ghost-text autocomplete: real Monaco 0.57 (served locally via pg.route from an npm-packed copy),
off when no autocomplete role, on when Continue's autocomplete role is set; suggestion shown & accepted with Tab.
usage: t_ide_ghost.py <abs html> <monaco package dir (…/package)>"""
import sys, os, asyncio, mimetypes
from playwright.async_api import async_playwright
HTML = os.path.abspath(sys.argv[1]); MON = os.path.abspath(sys.argv[2]) if len(sys.argv) > 2 else os.environ.get('MONACO_PKG', '')
fails = []
def check(n, c, i=''):
    print(('PASS ' if c else 'FAIL ') + n + ((' — ' + str(i)[:400]) if i and not c else ''), flush=True)
    if not c: fails.append(n)
async def serve(route):
    u = route.request.url; rel = u.split('monaco-editor@0.57.0/', 1)[1].split('?')[0]; p = os.path.join(MON, rel)
    if not os.path.isfile(p): return await route.fulfill(status=404, body='')
    ct = mimetypes.guess_type(p)[0] or 'application/javascript'
    await route.fulfill(status=200, content_type=ct, body=open(p, 'rb').read(), headers={'access-control-allow-origin': '*'})
async def main():
    if not os.path.isdir(MON): print('SKIP: monaco package dir missing'); print('\nFAILS: none'); return
    async with async_playwright() as pw:
        b = await pw.chromium.launch()
        ctx = await b.new_context(viewport={'width': 1280, 'height': 800})
        pg = await ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.route('**/monaco-editor@0.57.0/**', serve)
        await pg.goto('file://' + HTML); await pg.wait_for_function('window.DS && DS.ready', timeout=20000)
        await pg.evaluate("""async () => { await DS.fs.write('/ghost.js', 'function add(a, b) {\\n  \\n}\\n'); const cs = DS.service('forge.continue');
          window.__calls = []; cs.complete = async o => { window.__calls.push(o); return 'return a + b;'; }; }""")
        await pg.evaluate("DS.service('forge.ide').open('/ghost.js')")
        try: await pg.wait_for_function("DS.service('forge.ide').engine() === 'monaco'", timeout=30000); ok = True
        except Exception: ok = False
        check('Monaco engine loads (local copy)', ok, await pg.evaluate("DS.service('forge.ide').engine()"))
        if ok:
            await pg.click('.monaco-editor .view-lines'); await pg.keyboard.press('Control+End')
            await pg.keyboard.press('ArrowUp'); await pg.keyboard.press('End'); await pg.keyboard.type('r'); await pg.keyboard.press('Backspace')
            await pg.wait_for_timeout(1200)
            n0 = await pg.evaluate("window.__calls.length")
            check('no autocomplete calls without an autocomplete role', n0 == 0, n0)
            await pg.evaluate("DS.service('forge.continue').setRole('autocomplete', { provider: 'groq', model: 'test-model' })")
            await pg.keyboard.type(' '); await pg.keyboard.press('Backspace')
            await pg.wait_for_timeout(500)
            await pg.keyboard.press('Alt+Backslash')   # explicit trigger as well
            try: await pg.wait_for_function("DS.service('forge.ide').ghostStats().shown > 0", timeout=6000)
            except Exception: pass
            st = await pg.evaluate("DS.service('forge.ide').ghostStats()")
            calls = await pg.evaluate("window.__calls.map(c => ({ p: c.prefix.slice(-25), lang: c.lang, sig: !!c.signal }))")
            check('autocomplete called with prefix/lang/signal once the role is set', len(calls) > 0 and calls[-1]['lang'] == 'javascript' and calls[-1]['sig'], calls)
            check('ghost suggestion shown', st['shown'] > 0, st)
            ghost = await pg.evaluate("!!document.querySelector('.ghost-text, .ghost-text-decoration')")
            check('ghost text rendered in editor', ghost, st)
            await pg.keyboard.press('Tab'); await pg.wait_for_timeout(300)
            val = await pg.evaluate("DS.service('forge.ide').active().value")
            check('Tab accepts the suggestion', 'return a + b;' in val, val)
        check('no page errors', not errs, errs)
        await b.close()
    print('\nFAILS: ' + (', '.join(fails) if fails else 'none')); sys.exit(1 if fails else 0)
asyncio.run(main())

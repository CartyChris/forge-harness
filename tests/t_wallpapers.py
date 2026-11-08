#!/usr/bin/env python3
"""Wallpapers / 3D backdrops: real three.js (served from tests/fixtures via pg.route) renders lit pixels,
one shared WebGL renderer across switches, gallery opens w/o overflow, offline → 2D fallback + toast,
choice persists across reload. usage: t_wallpapers.py <abs html> [shotdir]"""
import sys, os, asyncio
from playwright.async_api import async_playwright
HTML = os.path.abspath(sys.argv[1]); SHOT = sys.argv[2] if len(sys.argv) > 2 else None
THREE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', 'three.min.js')
fails = []
def check(n, c, i=''):
    print(('PASS ' if c else 'FAIL ') + n + ((' — ' + str(i)[:400]) if i and not c else ''), flush=True)
    if not c: fails.append(n)

async def serve_three(route):
    await route.fulfill(status=200, content_type='application/javascript', body=open(THREE, 'rb').read())

async def boot(ctx, online=True):
    pg = await ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    if online: await pg.route('**/three@*/build/three.min.js', serve_three)
    else: await pg.route('**/three@*/**', lambda r: r.abort())
    await pg.goto('file://' + HTML); await pg.wait_for_function('window.DS && DS.ready', timeout=20000); await pg.wait_for_timeout(300)
    return pg, errs

async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True)
        pg, errs = await boot(ctx)
        info = await pg.evaluate("""() => { const s = DS.service('forge.scenes'), B = DS.service('forge.backdrops');
          return { n3: s ? s.ids3d.length : 0, n2: s ? s.ids2d.length : 0, all: DS.kernel.list('backdrop').length, hasB: !!B }; }""")
        check('scenes registered (>=21 3D)', info['hasB'] and info['n3'] >= 21, info)
        ids = await pg.evaluate("DS.service('forge.scenes').ids3d.slice(0, 4)")
        res = []
        for i in ids:
            await pg.evaluate("id => DS.service('forge.backdrops').set(id)", i)
            try: await pg.wait_for_function("() => { const s = DS.service('forge.backdrops').stats(); return s.three && !!DS.service('forge.backdrops').probe(); }", timeout=15000)
            except Exception as e: pass
            await pg.wait_for_timeout(700)
            pr = await pg.evaluate("() => { const B = DS.service('forge.backdrops'); return { p: B.probe(), s: (({id, contexts, three, engineError}) => ({id, contexts, three, engineError}))(B.stats()) }; }")
            res.append(pr)
        lit = [r for r in res if r['p'] and r['p']['lit'] > 0]
        check('3D scenes render lit pixels with real three.js', len(lit) >= 3, res)
        check('one shared WebGL context after switching', all(r['s']['contexts'] == 1 for r in res), [r['s'] for r in res])
        canv = await pg.evaluate("document.querySelectorAll('canvas').length")
        check('canvas count bounded (<=3)', canv <= 3, canv)
        # gallery
        await pg.evaluate("DS.shell.show('wallpapers')"); await pg.wait_for_timeout(1200)
        g = await pg.evaluate("""() => { const de = document.documentElement; const cards = document.querySelectorAll('[data-wp], .wp-card');
          return { cards: cards.length, over: de.scrollWidth - de.clientWidth }; }""")
        check('gallery shows cards', g['cards'] >= 30, g)
        check('gallery no horizontal overflow at 390', g['over'] <= 1, g)
        if SHOT: await pg.screenshot(path=os.path.join(SHOT, 'wallpapers-390.png'))
        # persistence
        await pg.evaluate("DS.store.settings().permission='unrestricted'")
        await pg.evaluate("DS.agent.tool('wallpaper_set').run({ id: 'nebula-particles' }, {})"); await pg.wait_for_timeout(800)
        await pg.reload(); await pg.wait_for_function('window.DS && DS.ready', timeout=20000); await pg.wait_for_timeout(1500)
        w = await pg.evaluate("DS.service('forge.backdrops').wanted() || DS.service('forge.backdrops').current()")
        check('wallpaper choice persists across reload', w == 'nebula-particles', w)
        check('no page errors (online)', not errs, errs)
        await ctx.close()
        # offline: CDN blocked → 2D fallback + toast, still no page errors
        ctx2 = await b.new_context(viewport={'width': 390, 'height': 844})
        pg2, errs2 = await boot(ctx2, online=False)
        await pg2.evaluate("DS.service('forge.backdrops').set('nebula-particles')")
        try: await pg2.wait_for_function("!!DS.service('forge.backdrops').stats().engineError", timeout=15000)
        except Exception: pass
        await pg2.wait_for_timeout(600)
        st = await pg2.evaluate("() => { const B = DS.service('forge.backdrops'); return { cur: B.current(), wanted: B.wanted(), running: B.running(), err: B.stats().engineError, toast: document.body.innerText.includes('2D') }; }")
        check('offline: engine error reported honestly', bool(st['err']), st)
        check('offline: falls back to a running 2D wallpaper', st['running'] and st['cur'] != 'nebula-particles', st)
        check('offline: still wants the 3D choice for next load', st['wanted'] == 'nebula-particles', st)
        check('no page errors (offline)', not errs2, errs2)
        await b.close()
    print('\nFAILS: ' + (', '.join(fails) if fails else 'none')); sys.exit(1 if fails else 0)
asyncio.run(main())

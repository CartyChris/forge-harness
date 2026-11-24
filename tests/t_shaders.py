#!/usr/bin/env python3
"""GPU shader wallpapers (73-shaders): every scene compiles+links on SwiftShader, renders non-blank, pointer changes output,
<=1 live pack context after 10 switches, reduced-motion still frame, gallery GPU tab at 390px w/o overflow. usage: t_shaders.py <abs html>"""
import sys, os, asyncio
from playwright.async_api import async_playwright
HTML = os.path.abspath(sys.argv[1]); fails = []
def check(n, c, i=''):
    print(('PASS ' if c else 'FAIL ') + n + ((' — ' + str(i)[:400]) if i and not c else ''), flush=True)
    if not c: fails.append(n)
async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True)
        pg = await ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('file://' + HTML); await pg.wait_for_function('window.DS && DS.ready', timeout=20000); await pg.wait_for_timeout(300)
        ids = await pg.evaluate("DS.service('forge.shaders').ids()")
        reg = await pg.evaluate("DS.kernel.list('backdrop').filter(b=>b.group==='gpu').map(b=>b.id)")
        check('10 gpu scenes registered', len(ids) == 10 and sorted(reg) == sorted(ids), reg)
        ce = await pg.evaluate("DS.service('forge.shaders').compileErrors()")
        check('all shaders compile + link', ce == {}, ce)
        for i in ids:
            r = await pg.evaluate("id => { const S = DS.service('forge.shaders'); return [S.probe(id, {mouse:[0,0]}), S.probe(id, {mouse:[.9,.7]})]; }", i)
            a, m = r
            check(i + ' renders non-blank', a.get('ok') and a.get('variance', 0) > 2 and a.get('mean', 0) > 1, a)
            check(i + ' pointer changes output', a.get('hash') != m.get('hash'), [a, m])
        # live switching
        for k in range(10):
            await pg.evaluate("id => DS.service('forge.backdrops').set(id, {force:true, reduced:false})", ids[k % 10]); await pg.wait_for_timeout(120)
        await pg.wait_for_timeout(400)
        st = await pg.evaluate("DS.service('forge.shaders').stats()")
        check('<=1 live shader context after 10 switches', st['live'] <= 1 and st['starts'] >= 10, st)
        smp = await pg.evaluate("DS.service('forge.shaders').sampleLive()")
        check('live scene renders lit pixels', smp and smp['variance'] > 2, smp)
        canv = await pg.evaluate("document.querySelectorAll('#fx-bd canvas.fx-shader').length")
        check('one shader canvas in host', canv == 1, canv)
        await pg.evaluate("DS.service('forge.backdrops').set('none')"); await pg.wait_for_timeout(100)
        st = await pg.evaluate("DS.service('forge.shaders').stats()")
        check('switching to none frees the context', st['live'] == 0 and await pg.evaluate("document.querySelectorAll('canvas.fx-shader').length") == 0, st)
        # reduced-motion still
        await pg.emulate_media(reduced_motion='reduce')
        r = await pg.evaluate("""async () => { const h = document.createElement('div'); h.style.cssText='position:fixed;inset:0;width:200px;height:120px'; document.body.appendChild(h);
          const S = DS.service('forge.shaders'); const stop = S.start('gl-aurora', h, {quality:'low', dpr:1}); const s = await S.sampleLive(); await new Promise(r=>setTimeout(r,300));
          const f = S.current().frames; stop(); h.remove(); return {s, f}; }""")
        check('reduced-motion renders exactly one still frame', r['f'] == 1 and r['s'] and r['s']['variance'] > 1, r)
        await pg.emulate_media(reduced_motion='no-preference')
        # gallery
        await pg.evaluate("DS.shell.show('wallpapers')"); await pg.wait_for_timeout(500)
        tab = pg.locator('.wp-cats button[data-c=gpu]')
        check('GPU shaders tab exists', await tab.count() == 1)
        if await tab.count(): await tab.click(); await pg.wait_for_timeout(1500)
        n = await pg.evaluate("document.querySelectorAll('.wp-grid .wp-card[data-group=gpu]').length")
        check('gallery shows 10 gpu tiles', n == 10, n)
        lit = await pg.evaluate("""() => [...document.querySelectorAll('.wp-card[data-group=gpu] canvas')].filter(c => { const d = c.getContext('2d').getImageData(0,0,c.width,c.height).data; let s=0; for (let i=0;i<d.length;i+=400) s+=d[i]+d[i+1]+d[i+2]; return s>500; }).length""")
        check('gpu thumbs are real rendered frames', lit >= 8, lit)
        ov = await pg.evaluate("document.documentElement.scrollWidth - innerWidth")
        check('no horizontal overflow at 390px', ov <= 1, ov)
        st = await pg.evaluate("DS.service('forge.shaders').stats()")
        check('thumbs share one context', st['thumbContext'] and st['live'] <= 1, st)
        check('no page errors', not errs, errs)
        await b.close()
    print('FAILS: ' + (', '.join(fails) if fails else 'none')); sys.exit(1 if fails else 0)
asyncio.run(main())

#!/usr/bin/env python3
"""Agent skills pack (plugins/89-agent-skills.js): 25 as-* skills, use_skill body, settings 390px, fetch fallback, no page errors.
usage: timeout 150 python3 tests/t_agent_skills.py <abs html>"""
import sys, os, asyncio
from playwright.async_api import async_playwright
fails = []
def check(n, c, i=''):
    print(('PASS ' if c else 'FAIL ') + n + ((' — ' + str(i)[:400]) if i and not c else ''), flush=True)
    if not c: fails.append(n)
HTML = os.path.abspath(sys.argv[1])
async def boot(b, kill_ds=False):
    pg = await b.new_page(viewport={'width': 390, 'height': 844}); errs = []; hits = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    async def raw(route):
        hits.append(route.request.url); name = route.request.url.split('/skills/')[1].split('/')[0]
        await route.fulfill(status=200, headers={'Access-Control-Allow-Origin': '*', 'Content-Type': 'text/plain'}, body='---\nname: ' + name + '\n---\n# MOCK ' + name + '\n')
    await pg.route('https://raw.githubusercontent.com/**', raw)
    if kill_ds: await pg.add_init_script('delete window.DecompressionStream;')
    await pg.goto('file://' + HTML); await pg.wait_for_function('window.DS && DS.ready', timeout=20000)
    await pg.evaluate("() => DS.kernel.service ? 0 : 0"); await pg.wait_for_timeout(200)
    await pg.evaluate("async () => { const s = DS.kernel.service && DS.kernel.service('forge.agentSkills'); if (s) await s.ready; DS.store.settings().permission = 'unrestricted'; }")
    return pg, errs, hits
async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch()
        pg, errs, hits = await boot(b)
        ids = await pg.evaluate("() => DS.kernel.list('skill').map(s => s.id).filter(i => i.startsWith('as-'))")
        check('25 as-* skills registered', len(ids) == 25, ids)
        mode = await pg.evaluate("() => DS.kernel.service('forge.agentSkills').mode()")
        check('bundled gzip decoded via DecompressionStream', mode == 'bundled', mode)
        r = await pg.evaluate("async () => await DS.agent.tool('use_skill').run({ id: 'as-spec-driven-development' })")
        body = (r or {}).get('instructions', '')
        check('use_skill returns spec-driven-development body', 'name: spec-driven-development' in body and len(body) > 1000, body[:200])
        sysd = await pg.evaluate("() => DS.agent.systemPrompt ? DS.agent.systemPrompt(DS.store.activeThread() || DS.store.newThread()) : ''")
        if sysd: check('system prompt lists as-* + routing note', 'as-spec-driven-development' in sysd and 'spec → plan → build' in sysd, sysd[-600:])
        maxdesc = await pg.evaluate("() => Math.max(...DS.kernel.list('skill').filter(s => s.id.startsWith('as-')).map(s => s.description.length))")
        check('descriptions short (<=110)', maxdesc <= 110, maxdesc)
        await pg.evaluate("() => DS.shell.show('settings')"); await pg.wait_for_timeout(400)
        n = await pg.evaluate("() => document.querySelectorAll('.as-v').length")
        check('settings section lists 25 skills with view', n == 25, n)
        sw = await pg.evaluate("() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth, ...[...document.querySelectorAll('.as-list')].map(e => e.scrollWidth))")
        check('settings 390px: no horizontal overflow', sw <= 390, sw)
        await pg.evaluate("() => document.querySelector('.as-v[data-n=\"code-review-and-quality\"]').click()"); await pg.wait_for_timeout(400)
        shown = await pg.evaluate("() => [...document.querySelectorAll('.as-view pre')].map(p => p.textContent).join('')")
        check('view opens SKILL.md in a sheet', 'code-review-and-quality' in shown, shown[:200])
        sw2 = await pg.evaluate("() => document.documentElement.scrollWidth")
        check('sheet 390px: no horizontal overflow', sw2 <= 390, sw2)
        check('no network fetch when bundled', not hits, hits)
        check('no page errors (bundled)', not errs, errs)
        await pg.close()
        pg, errs, hits = await boot(b, kill_ds=True)
        mode = await pg.evaluate("() => DS.kernel.service('forge.agentSkills').mode()")
        check('fallback mode when DecompressionStream deleted', mode == 'remote', mode)
        ids = await pg.evaluate("() => DS.kernel.list('skill').map(s => s.id).filter(i => i.startsWith('as-')).length")
        check('fallback: 25 skills still registered (index bundled)', ids == 25, ids)
        txt = await pg.evaluate("async () => await DS.kernel.service('forge.agentSkills').load('spec-driven-development')")
        check('fallback fetch from raw.githubusercontent.com', 'MOCK spec-driven-development' in txt and any('/skills/spec-driven-development/SKILL.md' in h for h in hits), [txt[:80], hits])
        r = await pg.evaluate("async () => await DS.agent.tool('use_skill').run({ id: 'as-spec-driven-development' })")
        check('fallback: use_skill returns fetched body', 'MOCK spec-driven-development' in (r or {}).get('instructions', ''), r)
        check('no page errors (fallback)', not errs, errs)
        await b.close()
    print('FAILS: ' + (', '.join(fails) if fails else 'none')); sys.exit(1 if fails else 0)
asyncio.run(main())

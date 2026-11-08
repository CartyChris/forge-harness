#!/usr/bin/env python3
"""forge.ecc: roles into forge.agents, ecc_load bundled + fetched (mocked), ECC loop pill prompt, view @390px, commands.
usage: t_ecc.py <abs html>"""
import sys, os, asyncio
from playwright.async_api import async_playwright
fails = []
def check(n, c, i=''):
    print(('PASS ' if c else 'FAIL ') + n + ((' — ' + str(i)[:400]) if i and not c else ''), flush=True)
    if not c: fails.append(n)
async def route(r):
    u = r.request.url
    if u.startswith('https://raw.githubusercontent.com/affaan-m/ECC/main/skills/django-patterns/SKILL.md'):
        await r.fulfill(status=200, body='---\nname: django-patterns\n---\n# MOCK DJANGO SKILL', headers={'access-control-allow-origin': '*', 'content-type': 'text/plain'})
    else: await r.abort()
async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch(); pg = await b.new_page(viewport={'width': 390, 'height': 844})
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.route('http*://**/*', route)
        await pg.goto('file://' + os.path.abspath(sys.argv[1])); await pg.wait_for_function('window.DS && DS.ready'); await pg.wait_for_timeout(500)
        await pg.evaluate("() => { const st = DS.store.settings(); st.permission = 'unrestricted'; st.forceSim = false; }")
        r = await pg.evaluate("""async () => { const A = DS.service('forge.agents'); if (!A) return null; await DS.service('forge.ecc').installRoles(true); const rs = A.roles(); const e = Object.keys(rs).filter(k => k.startsWith('ecc-'));
          return { n: e.length, planner: rs['ecc-planner'] && { tools: rs['ecc-planner'].tools, len: rs['ecc-planner'].prompt.length, max: rs['ecc-planner'].maxSteps } }; }""")
        if r is not None:
            check('ECC roles installed into forge.agents (>=12 ecc-*)', r['n'] >= 12, r)
            check('ecc-planner: files group, prompt capped <= ~6KB', r['planner'] and r['planner']['tools'] == ['files'] and 500 < r['planner']['len'] <= 6100, r)
        l = await pg.evaluate("""async () => { const T = DS.agent.tool('ecc_load'); const t = DS.store.newThread();
          const a = await T.run({ kind: 'agent', name: 'planner' }, { thread: t }); const s = await T.run({ kind: 'skill', name: 'django-patterns' }, { thread: t }); const ru = await T.run({ kind: 'rule', name: 'testing' }, { thread: t });
          return { a: a.source, al: (a.markdown || '').length, ap: /planner/i.test(a.markdown || ''), s: s.source, sm: s.markdown, ru: ru.source, ro: T.readonly }; }""")
        check('ecc_load returns bundled planner', l['a'] == 'bundled' and l['ap'] and l['al'] > 1000, l)
        check('ecc_load fetches non-bundled skill (mocked raw.githubusercontent)', l['s'] == 'fetched' and 'MOCK DJANGO SKILL' in (l['sm'] or ''), l)
        check('ecc_load bundled rule + readonly', l['ru'] == 'bundled' and l['ro'] is True, l)
        p = await pg.evaluate("""() => new Promise(res => { DS.plugin({ name: 't.cap', apply(ctx) { ctx.provider({ id: 'capp', label: 'Cap', available: () => true, models: ['c'],
            async stream({ messages }) { window.__sys = (messages.find(m => m.role === 'system') || {}).content || ''; return { content: 'ok', reasoning: '', toolCalls: [], usage: null }; } }); } });
          setTimeout(async () => { const st = DS.store.settings(); st.provider = 'capp';
            DS.store.state.toggles = DS.store.state.toggles || {}; DS.store.state.toggles['ecc-loop'] = false; await DS.agent.run(DS.store.newThread(), 'hi'); const off = window.__sys;
            DS.store.state.toggles['ecc-loop'] = true; await DS.agent.run(DS.store.newThread(), 'hi'); const onp = window.__sys; DS.store.state.toggles['ecc-loop'] = false;
            res({ off: off.includes('ECC LOOP'), on: onp.includes('ECC LOOP'), rules: onp.includes('ECC common rules'), agentsmd: onp.includes('/AGENTS.md') }); }, 150); })""")
        check('pill off → no ECC prompt', p['off'] is False, p)
        check('pill on → ECC loop + common rules in system prompt', p['on'] and p['rules'] and p['agentsmd'], p)
        c = await pg.evaluate("() => { const names = DS.kernel.list('command').map(c => c.name); return { names: names.filter(n => /^(ecc|ecc-.*|plan|tdd|code-review|build-fix|verify)$/.test(n)), map: DS.service('forge.ecc').commands(), pills: !!DS.kernel.list('composerPill').find(p => p.id === 'ecc-loop') }; }")
        check('commands registered (/ecc + 5 ECC commands, ecc- prefix on conflicts)', 'ecc' in c['names'] and len(c['map']) == 5 and all(v in c['names'] for v in c['map'].values()), c)
        check('ECC loop pill registered', c['pills'], c)
        await pg.evaluate("DS.shell.show('ecc')"); await pg.wait_for_timeout(300)
        await pg.fill('.ecc [data-q]', 'review'); await pg.wait_for_timeout(300)
        v = await pg.evaluate("() => ({ sw: document.documentElement.scrollWidth, bw: document.body.scrollWidth, items: document.querySelectorAll('.ecc .ecc-i').length, credit: /MIT/.test(document.querySelector('.ecc').textContent) })")
        check('ECC view: search results + credits', v['items'] >= 5 and v['credit'], v)
        check('ECC view: no horizontal scroll at 390px', v['sw'] <= 390 and v['bw'] <= 390, v)
        await pg.click('.ecc [data-export]'); await pg.wait_for_timeout(400)
        md = await pg.evaluate("async () => (await DS.fs.exists('/AGENTS.md')) ? (f => typeof f === 'object' && f ? String(f.content != null ? f.content : f.text || '') : String(f || ''))(await DS.fs.read('/AGENTS.md')) : ''")
        check('Export writes /AGENTS.md with loop + rules + credit', 'ECC LOOP' in md and '## Rules' in md and 'MIT' in md, md[:200])
        s = await pg.evaluate("""async () => { DS.store.settings().provider = 'sim'; const t = DS.store.newThread(); await DS.agent.run(t, 'ecc plan: add validation'); const m = t.messages.at(-1);
          return { tools: (m.parts || []).filter(p => p.type === 'tool').map(p => p.name + ':' + p.status), text: (m.parts || []).filter(p => p.type === 'text').map(p => p.text).join(''), sug: !!DS.kernel.list('suggestion').find(x => x.id === 'ecc-loop') }; }""")
        check('Sim intent: ecc_load ok + loop summary; suggest card', s['tools'] == ['ecc_load:ok'] and 'ECC loop' in s['text'] and s['sug'], s)
        check('no page errors', not errs, errs)
        await b.close()
    print('FAILS: ' + (', '.join(fails) if fails else 'none'))
    sys.exit(1 if fails else 0)
asyncio.run(main())

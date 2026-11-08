#!/usr/bin/env python3
"""forge.past: past.dev memory backend (mocked api.past.dev). usage: t_past_memory.py <abs html>"""
import sys, os, json, asyncio
from playwright.async_api import async_playwright
HTML = os.path.abspath(sys.argv[1])
KEY = 'pk_TESTSECRET_9f8e7d6c5b4a'
fails = []
def check(n, c, i=''):
    print(('PASS ' if c else 'FAIL ') + n + ((' — ' + str(i)[:400]) if i and not c else ''), flush=True)
    if not c: fails.append(n)
CORS = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS', 'Content-Type': 'application/json'}
seen = []; polls = {'n': 0}
async def handler(route):
    req = route.request; url = req.url; m = req.method
    if m == 'OPTIONS': return await route.fulfill(status=204, headers=CORS, body='')
    seen.append({'m': m, 'url': url, 'auth': req.headers.get('authorization'), 'body': req.post_data})
    if url.endswith('/ingest') and m == 'POST':
        return await route.fulfill(status=202, headers=CORS, body=json.dumps({'projectId': 'p1', 'ingestionId': 'ing_1', 'sourceId': 's1', 'status': 'queued'}))
    if '/ingest/' in url and m == 'GET':
        polls['n'] += 1
        return await route.fulfill(status=200, headers=CORS, body=json.dumps({'status': 'completed' if polls['n'] >= 2 else 'processing', 'settled': polls['n'] >= 2, 'failure': None}))
    if '/ingest/' in url and m == 'DELETE':
        return await route.fulfill(status=204, headers=CORS, body='')
    if url.endswith('/recall'):
        return await route.fulfill(status=200, headers=CORS, body=json.dumps({'asOf': '2026-11-08T00:00:00Z', 'usedEvidenceTokens': 42, 'results': [
            {'id': 'r1', 'rank': 1, 'occurredAt': '2026-10-01T12:00:00Z', 'content': 'User loves Rust and tabs over spaces.',
             'sources': [{'sourceId': 's1', 'occurredAt': '2026-10-01T12:00:00Z', 'label': 'chat', 'excerpts': []}]}]}))
    return await route.fulfill(status=404, headers=CORS, body='{"code":"not_found"}')
PROV = """() => new Promise(res => { window.__sys = [];
  DS.plugin({ name: 't.pastprov', apply(ctx) { ctx.provider({ id: 'capture', label: 'Capture', available: () => true, models: ['c'],
    async stream({ messages, onDelta }) { onDelta && onDelta({ content: 'ok answer' }); window.__sys.push(messages.filter(m => m.role === 'system').map(m => m.content).join('\\n')); return { content: 'ok answer', reasoning: '', toolCalls: [], usage: null }; } }); } });
  setTimeout(res, 150); })"""
async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch(); pg = await b.new_page(viewport={'width': 390, 'height': 844})
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.route('https://api.past.dev/**', handler)
        await pg.goto('file://' + HTML); await pg.wait_for_function('window.DS && DS.ready', timeout=20000); await pg.wait_for_timeout(400)
        await pg.evaluate("() => { DS.store.settings().permission = 'unrestricted'; }")
        ok = await pg.evaluate("() => !!DS.service('forge.past') && ['past_remember','past_recall','past_forget'].every(n => DS.agent.tool(n))")
        check('service + 3 tools registered', ok)
        g = await pg.evaluate("() => ({ r: DS.agent.tool('past_remember').gate, c: DS.agent.tool('past_recall').gate, ro: DS.agent.tool('past_recall').readonly, f: DS.agent.tool('past_forget').gate })")
        check('gates net/net(readonly)/write', g == {'r': 'net', 'c': 'net', 'ro': True, 'f': 'write'}, g)
        # no key → local fallback
        r = await pg.evaluate("""async () => { const t = DS.agent.tool('past_remember'); const a = await t.run({ text: 'Local fallback fact about zebras' }, {});
          const c = await DS.agent.tool('past_recall').run({ query: 'zebras' }, {}); return { a, c }; }""")
        check('no key: remember falls back to local brain', r['a'].get('backend') == 'local' and 'local' in r['a'].get('note', ''), r)
        check('no key: recall uses local brain', r['c'].get('backend') == 'local' and any('zebras' in x['content'] for x in r['c']['results']), r['c'])
        check('no key: no network calls', len(seen) == 0, seen)
        # settings section
        await pg.evaluate("() => DS.shell.show('settings')"); await pg.wait_for_timeout(400)
        has = await pg.evaluate("() => !!document.querySelector('.pm-root')")
        check('settings section rendered', has)
        if has:
            await pg.evaluate("""k => { const i = document.querySelector('.pm-key'); i.value = k; i.dispatchEvent(new Event('change')); }""", KEY)
            await pg.evaluate("() => document.querySelector('.pm-root').scrollIntoView()")
            ov = await pg.evaluate("""() => { const r = document.querySelector('.pm-root'); const bad = [...r.querySelectorAll('*')].filter(e => e.getBoundingClientRect().right > innerWidth + 1).map(e => e.className);
              return { page: document.documentElement.scrollWidth <= innerWidth + 1, bad, sw: r.scrollWidth, cw: r.clientWidth }; }""")
            check('settings no overflow at 390px', ov['page'] and not ov['bad'] and ov['sw'] <= ov['cw'] + 1, ov)
            shown = await pg.evaluate("k => document.body.innerText.includes(k) || [...document.querySelectorAll('input')].some(i => i.value === k)", KEY)
            check('full key never shown in UI', not shown)
            check('key masked label shown', await pg.evaluate("() => /saved: pk_…/.test(document.querySelector('.pm-k').textContent)"))
            await pg.click('.pm-test'); await pg.wait_for_timeout(500)
            out = await pg.evaluate("() => document.querySelector('.pm-out').textContent")
            check('test connection ok', out.startswith('✓'), out)
        # ingest → poll → completed
        seen.clear()
        r = await pg.evaluate("() => DS.service('forge.past').ingest('Chris uses fish shell', { pollMs: 10 })")
        check('ingest → poll → completed', r.get('status') == 'completed' and r.get('ingestionId') == 'ing_1' and polls['n'] >= 2, r)
        bodies = [json.loads(s['body']) for s in seen if s['m'] == 'POST' and s['body']]
        check('ingest body has content + timestamp', bodies and bodies[0].get('content') == 'Chris uses fish shell' and 'T' in bodies[0].get('timestamp', ''), bodies)
        check('Authorization: Bearer on every call', seen and all(s['auth'] == 'Bearer ' + KEY for s in seen), [s['auth'] for s in seen])
        check('key never in URL', all(KEY not in s['url'] for s in seen))
        r = await pg.evaluate("() => DS.agent.tool('past_recall').run({ query: 'rust', limit: 3 }, {})")
        check('recall returns dated sourced results', r.get('backend') == 'past.dev' and r['results'][0]['occurredAt'] and r['results'][0]['sources'][0]['label'] == 'chat', r)
        r = await pg.evaluate("() => DS.agent.tool('past_forget').run({ ingestionId: 'ing_1' }, {})")
        check('forget → DELETE', r.get('deleted') == 'ing_1' and any(s['m'] == 'DELETE' for s in seen), r)
        # localStorage: key only in plugin's own field
        ls = await pg.evaluate("k => Object.keys(localStorage).filter(n => (localStorage.getItem(n) || '').includes(k))", KEY)
        check('key only stored in plugin data', all('past' in n for n in ls) and len(ls) <= 1, ls)
        # auto-recall injection via capture provider + auto-ingest
        await pg.evaluate(PROV)
        await pg.evaluate("""() => { document.querySelector('.pm-ar').checked = true; document.querySelector('.pm-ar').dispatchEvent(new Event('change'));
          document.querySelector('.pm-ai').checked = true; document.querySelector('.pm-ai').dispatchEvent(new Event('change')); }""")
        seen.clear(); polls['n'] = 0
        await pg.evaluate("async () => { const st = DS.store.settings(); st.provider = 'capture'; st.forceSim = false; const t = DS.store.newThread(); await DS.agent.run(t, 'what language do I like?'); }")
        await pg.wait_for_timeout(1500)
        sysp = await pg.evaluate("() => window.__sys.join('\\n')")
        check('auto-recall injected into system prompt', '[Long-term memory — past.dev' in sysp and 'Rust' in sysp, sysp[-300:])
        dbg = await pg.evaluate("() => { const m = DS.store.activeThread().messages; return JSON.stringify(m.map(x => ({ r: x.role, c: x.content, p: x.parts, e: x.meta }))).slice(0, 600); }")
        ing = [json.loads(s['body']) for s in seen if s['m'] == 'POST' and s['url'].endswith('/ingest')]
        check('auto-ingest on run:end (user + answer)', ing and 'what language' in ing[0]['content'] and 'ok answer' in ing[0]['content'], [ing, [s['url'] for s in seen], dbg])
        logs = await pg.evaluate("k => JSON.stringify((DS.traces && DS.traces.all && DS.traces.all()) || []).includes(k)", KEY)
        check('key not in traces', not logs)
        check('no page errors', not errs, errs)
        await b.close()
    print('FAILS: ' + (', '.join(fails) if fails else 'none'))
    sys.exit(1 if fails else 0)
asyncio.run(main())

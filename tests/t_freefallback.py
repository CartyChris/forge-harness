#!/usr/bin/env python3
"""Free fallback (Continue-style): with no key the chat tries free/keyless models before the offline Sim; a failing keyed
provider falls through to the free chain; 429/timeout move to the next; all-fail ends in the Sim with a one-time
'best free options' prompt; forceSim / freeFallback=false never touch the network. All endpoints mocked. usage: t_freefallback.py <abs html>"""
import sys, os, asyncio, json
from playwright.async_api import async_playwright
fails = []
def check(n, c, i=''):
    print(('PASS ' if c else 'FAIL ') + n + ((' — ' + str(i)[:500]) if i and not c else ''), flush=True)
    if not c: fails.append(n)
CORS = {'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET, OPTIONS'}
def sse(text): return 'data: ' + json.dumps({'choices': [{'delta': {'content': text}}]}) + '\n\ndata: [DONE]\n\n'
async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch()
        async def fresh(mode):
            ctx = await b.new_context(viewport={'width': 390, 'height': 844}); pg = await ctx.new_page(); errs = []; hits = []
            pg.on('pageerror', lambda e: errs.append(str(e)))
            async def handler(route):
                req = route.request; u = req.url
                if req.method == 'OPTIONS': return await route.fulfill(status=204, headers=CORS)
                if '/models' in u and req.method == 'GET':
                    body = '{"data":[{"id":"foo/bar:free"},{"id":"paid/model"}]}' if mode.get(u.split('/')[2]) == 'heal' else '{"data":[]}'
                    return await route.fulfill(status=200, headers=CORS, content_type='application/json', body=body)
                host = u.split('/')[2]; hits.append({'host': host, 'auth': req.headers.get('authorization'), 'model': json.loads(req.post_data or '{}').get('model')})
                m = mode.get(host, 'abort')
                if m == 'heal': m = 'ok' if json.loads(req.post_data or '{}').get('model') == 'foo/bar:free' else 404
                if m == 'ok': return await route.fulfill(status=200, headers=dict(CORS, **{'content-type': 'text/event-stream'}), body=sse('hello from ' + host))
                if m == 'hang': await asyncio.sleep(6); return await route.abort()
                if isinstance(m, int): return await route.fulfill(status=m, headers=CORS, content_type='application/json', body='{"error":{"message":"HTTP %d test"}}' % m)
                return await route.abort()
            await pg.route(lambda u: not u.startswith('file:'), handler)
            await pg.goto('file://' + os.path.abspath(sys.argv[1])); await pg.wait_for_function('window.DS && DS.ready'); await pg.wait_for_timeout(300)
            return ctx, pg, errs, hits
        RUN = """async (txt) => { const t = DS.store.newThread(); await DS.agent.run(t, txt); const m = t.messages.at(-1);
            const text = (m.parts || []).filter(p => p.type === 'text').map(p => p.text).join('') || m.content || '';
            const r = DS.service('forge.router').last(); return { text, used: r && r.used, mode: r && r.mode, why: r && r.why, sheet: !!document.querySelector('.sheet-h') && document.querySelector('.sheet-h').innerText }; }"""
        # 1 no key → kilo answers
        ctx, pg, errs, hits = await fresh({'ai-gateway.kilo.ai': 'ok'})
        r = await pg.evaluate(RUN, 'say hi')
        check('no key: answered by a free keyless model (Kilo), not the Sim', 'hello from ai-gateway.kilo.ai' in r['text'] and r['mode'] == 'free-fallback', r)
        check('keyless call sends no Authorization header + a :free model', hits and hits[0]['auth'] is None and str(hits[0]['model']).endswith(':free'), hits[:2])
        st = await pg.evaluate("document.body.innerText.toLowerCase().includes('free fallback') && DS.store.activeThread().messages.at(-1).meta.provider === 'kilo'")
        check('toast mentions the free fallback + message tagged with the real provider', st)
        check('no page errors (1)', not errs, errs); await ctx.close()
        # 1b stale model id → 404 → re-discover /models → retry with a live :free id
        ctx, pg, errs, hits = await fresh({'ai-gateway.kilo.ai': 'heal'})
        r = await pg.evaluate(RUN, 'say hi')
        check('stale free model id self-heals via /models and answers', 'hello from ai-gateway.kilo.ai' in r['text'] and any(h['model'] == 'foo/bar:free' for h in hits), {'r': r, 'hits': hits[:4]})
        await ctx.close()
        # 2 kilo 429 → next keyless answers, kilo cooled down
        ctx, pg, errs, hits = await fresh({'ai-gateway.kilo.ai': 429, 'api.llm7.io': 'ok', 'blockrun.ai': 'ok'})
        r = await pg.evaluate(RUN, 'say hi')
        cool = await pg.evaluate("DS.service('forge.router').cooldowns().map(c => c.key)")
        check('429 on first free model → next one answers', 'hello from' in r['text'] and 'kilo' not in (r['used'] or ''), r)
        check('rate-limited model is put on cooldown', any(k.startswith('kilo|') for k in cool), cool)
        await ctx.close()
        # 3 keyed provider fails with 401 → free chain
        ctx, pg, errs, hits = await fresh({'api.groq.com': 401, 'ai-gateway.kilo.ai': 'ok'})
        r = await pg.evaluate("""async (RUN) => { const M = DS.service('forge.models'); M.setKey('groq', 'gsk_bad'); M.select('groq'); return await (eval(RUN))('hi'); }""", RUN)
        check('chosen keyed provider fails (401) → free fallback answers', 'hello from ai-gateway.kilo.ai' in r['text'] and 'groq' in (r['why'] or '').lower(), r)
        await ctx.close()
        # 4 hanging endpoint → first-byte timeout → next
        ctx, pg, errs, hits = await fresh({'ai-gateway.kilo.ai': 'hang', 'api.llm7.io': 'ok', 'blockrun.ai': 'ok'})
        await pg.evaluate("DS.store.settings().freeFallbackFirstByteMs = 1500")
        r = await pg.evaluate(RUN, 'hi')
        check('silent endpoint times out and the next free model answers', 'hello from' in r['text'] and 'kilo' not in (r['used'] or ''), r)
        await ctx.close()
        # 5 everything unreachable → Sim + one-time prompt with best free options
        ctx, pg, errs, hits = await fresh({})
        r = await pg.evaluate(RUN, 'list files')
        check('all free models unreachable → offline Sim still answers', len(r['text']) > 0 and r['used'] == 'sim', r)
        await pg.wait_for_timeout(300)
        sheet = await pg.evaluate("(() => { const h = [...document.querySelectorAll('.sheet-h h3')].map(x => x.innerText); const body = document.querySelector('.sheet-b'); return { h, links: body ? [...body.querySelectorAll('a[href]')].map(a => a.href) : [], over: document.documentElement.scrollWidth - document.documentElement.clientWidth }; })()")
        check('prompts the best free options (sheet with get-key links)', 'No free model answered' in ' '.join(sheet['h']) and any('openrouter.ai/keys' in l for l in sheet['links']), sheet)
        check('prompt sheet has no horizontal overflow at 390px', sheet['over'] <= 1, sheet)
        await pg.evaluate("document.querySelectorAll('.sheet-wrap').forEach(n => n.remove())")
        await pg.evaluate(RUN, 'list files'); await pg.wait_for_timeout(300)
        again = await pg.evaluate("document.querySelectorAll('.sheet-wrap').length")
        check('prompt shown only once per session', again == 0, again)
        check('no page errors (5)', not errs, errs); await ctx.close()
        # 6 forceSim and freeFallback=false → no network at all
        ctx, pg, errs, hits = await fresh({'ai-gateway.kilo.ai': 'ok'})
        await pg.evaluate("(() => { const s = DS.store.settings(); s.forceSim = true; })()"); await pg.evaluate(RUN, 'hi')
        n1 = len(hits)
        await pg.evaluate("(() => { const s = DS.store.settings(); s.forceSim = false; s.freeFallback = false; })()"); r = await pg.evaluate(RUN, 'hi')
        check('explicit Sim choice and fallback=off never call the network', n1 == 0 and len(hits) == 0, hits)
        await ctx.close()
        # 7 helper calls (superagent triage style) without a thread get an error, not Sim text
        ctx, pg, errs, hits = await fresh({})
        e = await pg.evaluate("""async () => { try { await DS.providers.pick().stream({ messages: [{ role: 'user', content: 'x' }], tools: [] }); return 'no error'; } catch (e) { return String(!!e.freeFallbackExhausted); } }""")
        check('helper calls without a thread get a clear exhausted error', e == 'true', e)
        await ctx.close()
        await b.close()
    print('\nFAILS: ' + (', '.join(fails) if fails else 'none')); sys.exit(1 if fails else 0)
asyncio.run(main())

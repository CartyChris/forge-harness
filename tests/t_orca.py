#!/usr/bin/env python3
"""OrcaRouter provider: cyber-tier models in the catalog, key sent as Bearer, OpenAI-compatible SSE parsed,
chosen model id passed through. api.orcarouter.ai is mocked (no internet). usage: t_orca.py <abs html>"""
import sys, os, asyncio, json
from playwright.async_api import async_playwright
fails = []
def check(n, c, i=''):
    print(('PASS ' if c else 'FAIL ') + n + ((' — ' + str(i)[:400]) if i and not c else ''), flush=True)
    if not c: fails.append(n)
seen = []
async def chat(route):
    req = route.request
    if req.method == 'OPTIONS':
        return await route.fulfill(status=204, headers={'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET, OPTIONS'})
    seen.append({'auth': req.headers.get('authorization'), 'body': json.loads(req.post_data or '{}'), 'url': req.url})
    sse = 'data: ' + json.dumps({'choices': [{'delta': {'content': 'orca says hi'}}]}) + '\n\ndata: [DONE]\n\n'
    await route.fulfill(status=200, headers={'content-type': 'text/event-stream', 'access-control-allow-origin': '*'}, body=sse)
async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch(); pg = await b.new_page(viewport={'width': 390, 'height': 844}); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.route('https://api.orcarouter.ai/**', chat)
        await pg.goto('file://' + os.path.abspath(sys.argv[1])); await pg.wait_for_function('window.DS && DS.ready'); await pg.wait_for_timeout(300)
        cat = await pg.evaluate("DS.service('forge.models').catalog().filter(m => m.provider === 'orcarouter').map(m => m.id)")
        check('cyber-tier models listed', 'orca/orcacyber-flash-1.0' in cat and 'orca/orcacyber-ultra-1.0' in cat, cat)
        out = await pg.evaluate("""async () => { const M = DS.service('forge.models'); M.setKey('orcarouter', 'sk-orca-TESTKEY');
          let txt = ''; const r = await DS.service('forge.providers.core').streamFor('orcarouter', { messages: [{ role: 'user', content: 'hi' }], tools: [], forceModel: 'orca/orcacyber-flash-1.0', onDelta: d => { if (d.content) txt += d.content; } });
          return { txt, content: r && r.content }; }""")
        check('streams the reply', 'orca says hi' in (out['txt'] or out['content'] or ''), out)
        check('Bearer key sent to api.orcarouter.ai/v1/chat/completions', seen and seen[-1]['auth'] == 'Bearer sk-orca-TESTKEY' and seen[-1]['url'].startswith('https://api.orcarouter.ai/v1/chat/completions'), seen[-1:] and {k: v for k, v in seen[-1].items() if k != 'body'})
        check('chosen model id passed through', seen and seen[-1]['body'].get('model') == 'orca/orcacyber-flash-1.0', seen and seen[-1]['body'].get('model'))
        check('no page errors', not errs, errs)
        await b.close()
    print('\nFAILS: ' + (', '.join(fails) if fails else 'none')); sys.exit(1 if fails else 0)
asyncio.run(main())

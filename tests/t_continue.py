#!/usr/bin/env python3
"""forge.continue: Continue.dev config import (YAML subset parser, preview, apply), export without keys, IDE autocomplete.
usage: t_continue.py <abs html>"""
import sys, os, json, asyncio
from playwright.async_api import async_playwright
HTML = os.path.abspath(sys.argv[1])
fails = []
def check(n, c, i=''):
    print(('PASS ' if c else 'FAIL ') + n + ((' — ' + str(i)[:400]) if i and not c else ''), flush=True)
    if not c: fails.append(n)

YAML = r'''# realistic Continue config.yaml
name: Team Assistant
version: 1.0.0
schema: v1
models:
  - name: Local coder   # served by our own box
    provider: openai
    model: qwen2.5-coder-7b
    apiBase: https://llm.example.test/v1
    apiKey: ${{ secrets.LOCAL_LLM_KEY }}
    capabilities: [tool_use]
    roles:
      - chat
      - edit
      - apply
      - autocomplete
  - name: Groq fast
    provider: groq
    model: llama-3.1-8b-instant
    roles: [summarize]
  - name: Trial
    provider: free-trial
    model: claude-sonnet
rules:
  - Always write tests for new functions
  - |
    Prefer small, pure functions.
    Explain trade-offs briefly.
prompts:
  - name: review
    description: "Review the selected code"
    prompt: >
      Review this code for bugs,
      security issues and readability.
mcpServers:
  - name: docs
    type: streamable-http
    url: https://mcp.example.test/mcp
  - name: filesystem
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "."]
'''
SECRET = 'sk-test-SECRET-123'

async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch()
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True)
        pg = await ctx.new_page(); errs = []; mcp_hits = []; llm_bodies = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        async def mcp(route):
            req = route.request; body = {}
            try: body = json.loads(req.post_data or '{}')
            except Exception: pass
            mcp_hits.append(body.get('method'))
            res = {'protocolVersion': '2025-03-26', 'capabilities': {}, 'serverInfo': {'name': 'docs'}}
            if body.get('method') == 'tools/list': res = {'tools': [{'name': 'search', 'description': 'search docs', 'inputSchema': {'type': 'object', 'properties': {}}}]}
            await route.fulfill(status=200, content_type='application/json', body=json.dumps({'jsonrpc': '2.0', 'id': body.get('id'), 'result': res}))
        async def llm(route):
            req = route.request
            if req.method == 'OPTIONS': return await route.fulfill(status=204, headers={'access-control-allow-origin': '*', 'access-control-allow-headers': '*'})
            llm_bodies.append({'url': req.url, 'auth': req.headers.get('authorization', ''), 'body': req.post_data or ''})
            chunks = ['```js\n', 'return a + b;', '\n```']
            sse = ''.join('data: ' + json.dumps({'model': 'qwen2.5-coder-7b', 'choices': [{'delta': {'content': c}}]}) + '\n\n' for c in chunks) + 'data: [DONE]\n\n'
            await route.fulfill(status=200, headers={'content-type': 'text/event-stream', 'access-control-allow-origin': '*'}, body=sse)
        await pg.route('https://mcp.example.test/**', mcp)
        await pg.route('https://llm.example.test/**', llm)
        await pg.goto('file://' + HTML); await pg.wait_for_function('window.DS && DS.ready', timeout=20000); await pg.wait_for_timeout(400)
        await pg.evaluate("""() => { DS.store.settings().permission = 'unrestricted'; window.__asked = [];
          DS.ui.promptText = async (t) => { window.__asked.push(t); return '%s'; }; }""" % SECRET)
        has = await pg.evaluate("!!DS.service('forge.continue')")
        check('forge.continue service provided', has)

        # anchors rejected with a clear error
        e = await pg.evaluate("""() => { try { DS.service('forge.continue').parse('base: &b\\n  k: 1\\nother: *b'); return 'no error'; } catch (e) { return e.message; } }""")
        check('YAML anchors rejected with a clear error', 'anchor' in e.lower() and 'line' in e.lower(), e)
        e2 = await pg.evaluate("""() => { try { DS.service('forge.continue').parse('a: !!python/object x'); return 'no error'; } catch (e) { return e.message; } }""")
        check('YAML tags rejected', 'tag' in e2.lower(), e2)

        # parse → plan
        P = await pg.evaluate("y => DS.service('forge.continue').parse(y)", YAML)
        kinds = {m['name']: m['target']['kind'] for m in P['models']}
        check('plan: unknown apiBase → custom endpoint', kinds.get('Local coder') == 'custom', kinds)
        check('plan: groq → catalog provider', kinds.get('Groq fast') == 'catalog', kinds)
        check('plan: free-trial skipped honestly', kinds.get('Trial') == 'skip' and 'inside Continue' in P['models'][2]['target']['why'], P['models'][2]['target'])
        check('plan: secret placeholder detected', [s['name'] for s in P['secrets']] == ['LOCAL_LLM_KEY'], P['secrets'])
        check('plan: rules incl. block scalar', len(P['rules']) == 2 and 'Explain trade-offs briefly.' in P['rules'][1] and '\n' in P['rules'][1], P['rules'])
        check('plan: folded prompt', P['prompts'] and P['prompts'][0]['prompt'].startswith('Review this code for bugs, security'), P['prompts'])
        check('plan: mcp http + stdio', [(s['name'], s['kind']) for s in P['mcp']] == [('docs', 'http'), ('filesystem', 'stdio')], P['mcp'])

        # preview sheet
        await pg.evaluate("y => DS.service('forge.continue').openPreview(DS.service('forge.continue').parse(y))", YAML)
        await pg.wait_for_selector('[data-cn-preview]', timeout=5000)
        txt = await pg.inner_text('[data-cn-preview]')
        for needle in ['Local coder', 'llm.example.test', 'LOCAL_LLM_KEY', '/review', 'needs the local bridge', 'Always write tests', 'unverified', "can't use them"]:
            check('preview lists ' + needle, needle in txt)
        ov = await pg.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        check('390px preview: no horizontal scroll', ov <= 0, ov)
        await pg.click('[data-cn-preview] .sheet-f .btn.pri')
        await pg.wait_for_function("DS.store.state && (DS.service('forge.continue').roles().autocomplete || null)", timeout=10000)
        await pg.wait_for_timeout(800)
        r = await pg.evaluate("""async () => { const C = DS.service('forge.continue'), M = DS.service('forge.models');
          let agents = ''; try { agents = (await DS.fs.read('/AGENTS.md')).content; } catch (e) { agents = 'ERR ' + e.message; }
          return { roles: C.roles(), custom: M.custom.list(), hasKey: M.hasKey('custom:continue-local-coder'), asked: window.__asked,
            agents, cmds: DS.kernel.list('command').map(c => c.name), sel: M.identity(), mcp: [...DS.mcp.servers.values()].map(s => [s.cfg.name, s.status]),
            stored: JSON.stringify(DS.store.state.pluginDataBag || {}) }; }""")
        check('apply: custom endpoint created for unknown apiBase', any('llm.example.test' in c['base'] for c in r['custom']), r['custom'])
        check('apply: secret prompted once', len(r['asked']) == 1 and 'LOCAL_LLM_KEY' in r['asked'][0], r['asked'])
        check('apply: key set from prompted value', r['hasKey'])
        check('apply: placeholder never stored as a key', '${{ secrets' not in r['stored'], r['stored'][:200])
        check('apply: roles mapped (main/coder/autocomplete/fast)', r['roles'].get('main', {}).get('provider') == 'custom:continue-local-coder' and r['roles'].get('coder') and r['roles'].get('autocomplete', {}).get('model') == 'qwen2.5-coder-7b' and r['roles'].get('fast', {}).get('provider') == 'groq', r['roles'])
        check('apply: main model selected', r['sel'].get('provider') == 'custom:continue-local-coder', r['sel'])
        check('apply: AGENTS.md gets Continue rules', '## Rules (from Continue)' in r['agents'] and 'Always write tests' in r['agents'] and 'Explain trade-offs' in r['agents'], r['agents'][:300])
        check('apply: /review slash command registered', 'review' in r['cmds'], r['cmds'])
        check('apply: MCP http connect attempted', 'initialize' in mcp_hits, mcp_hits)
        check('apply: MCP docs server ready', ['docs', 'ready'] in r['mcp'], r['mcp'])
        # idempotent rules
        again = await pg.evaluate("async () => { await DS.service('forge.continue').writeRules(['x1']); return (await DS.fs.read('/AGENTS.md')).content; }")
        check('rules section replaced, not duplicated', again.count('## Rules (from Continue)') == 1 and 'x1' in again and 'Always write tests' not in again, again[-200:])

        # /review sends its prompt + args
        await pg.evaluate("DS.store.newThread(); DS.shell.show('chat')")
        n0 = len(llm_bodies)
        await pg.fill('#cmp-ta', '/review function add(a,b){return a-b}'); await pg.click('#cmp-send')
        await pg.wait_for_timeout(300)
        await pg.wait_for_function("!DS.agent.isRunning(DS.store.activeThread())", timeout=30000)
        um = await pg.evaluate("(DS.store.activeThread().messages.find(m => m.role === 'user') || {}).content || ''")
        check('/review sends the prompt text + args', um.startswith('Review this code for bugs') and 'function add(a,b)' in um, um)
        check('/review reached the imported endpoint with the key', len(llm_bodies) > n0 and llm_bodies[-1]['auth'] == 'Bearer ' + SECRET, llm_bodies[-1:] and llm_bodies[-1]['auth'])

        # export: no real keys
        y = await pg.evaluate("DS.service('forge.continue').exportYaml()")
        check('export has no real keys', SECRET not in y, y[:300])
        check('export uses secret placeholders', '${{ secrets.' in y, y[:400])
        rt = await pg.evaluate("y => { try { const o = DS.service('forge.continue').parseYaml(y); return o.models.length; } catch (e) { return e.message; } }", y)
        check('export re-parses as YAML with models', isinstance(rt, int) and rt >= 1, rt)

        # autocomplete
        out = await pg.evaluate("""() => DS.service('forge.continue').complete({ prefix: 'function add(a, b) {\\n  ', suffix: '\\n}', lang: 'js' })""")
        check('complete() returns inserted text without fences', out.strip() == 'return a + b;', repr(out))
        lb = json.loads(llm_bodies[-1]['body'])
        check('complete() used the autocomplete model + FIM prompt', lb.get('model') == 'qwen2.5-coder-7b' and '<CURSOR/>' in json.dumps(lb.get('messages')), lb.get('model'))
        sup = await pg.evaluate("""async () => { const a = DS.service('forge.continue').autocompleter({ delay: 50 }); const p1 = a.request({ prefix: 'x', suffix: '' }); const p2 = a.request({ prefix: 'function add(a, b) {\\n  ', suffix: '\\n}' }); return [await p1, await p2]; }""")
        check('autocompleter: superseded request → null, latest → text', sup[0] is None and sup[1] and 'return a + b;' in sup[1], sup)

        # Sim intent + suggest
        si = await pg.evaluate("""() => ({ intent: DS.kernel.list('intent').some(i => i.id === 'continue-import' && i.match('Import my Continue config')), sug: DS.kernel.list('suggestion').some(s => s.id === 'continue-import') })""")
        check('Sim intent + suggest card', si['intent'] and si['sug'], si)

        # settings section at 390px
        await pg.evaluate("document.querySelectorAll('.sheet-wrap').forEach(w => w.remove()); DS.shell.show('settings')"); await pg.wait_for_timeout(400)
        st = await pg.evaluate("""() => { const t = document.body.innerText; return { has: /Continue\\.dev/i.test(t), note: t.includes("Forge can't use them"), ov: document.documentElement.scrollWidth - document.documentElement.clientWidth }; }""")
        check('settings: Continue.dev section with honest note', st['has'] and st['note'], st)
        check('390px settings: no horizontal scroll', st['ov'] <= 0, st)
        await pg.evaluate("DS.service('forge.continue').openImport()"); await pg.wait_for_selector('[data-cn-import]')
        await pg.click('[data-cn-import] [data-cn=sample]')
        ov2 = await pg.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        check('390px import sheet: no horizontal scroll', ov2 <= 0, ov2)
        await pg.fill('[data-cn-import] [data-cn=src]', 'a: &x 1')
        await pg.click('[data-cn-import] .sheet-f .btn.pri'); await pg.wait_for_timeout(200)
        et = await pg.inner_text('[data-cn-import] [data-cn=err]')
        check('import sheet shows the anchor error inline', 'anchor' in et.lower(), et)
        check('no page errors', not errs, errs[:3])
        await ctx.close(); await b.close()
asyncio.run(main()); print('\nFAILS:', fails or 'none'); sys.exit(1 if fails else 0)

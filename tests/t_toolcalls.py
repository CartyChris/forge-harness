#!/usr/bin/env python3
"""Tool-calling reliability: scripted 'bad model' providers must still end in correct tool runs.
usage: t_toolcalls.py <abs html>"""
import sys, os, asyncio, json
from playwright.async_api import async_playwright
fails = []
def check(n, c, i=''):
    print(('PASS ' if c else 'FAIL ') + n + ((' — ' + str(i)[:400]) if i and not c else ''), flush=True)
    if not c: fails.append(n)
SETUP = """(script) => new Promise(res => { window.__script = script; window.__sys = []; window.__ntools = [];
  DS.plugin({ name: 't.badmodel', apply(ctx) { ctx.provider({ id: 'badmodel', label: 'Bad model', available: () => true, models: ['bad'],
    async stream({ messages, tools, onDelta }) { window.__sys.push(messages[0].content); window.__ntools.push((tools || []).map(t => t.name));
      const step = messages.filter(m => m.role === 'assistant').length - (window.__base || 0); const r = window.__script[step] || { content: 'done' };
      if (r.content) onDelta({ content: r.content });
      return { content: r.content || '', reasoning: '', toolCalls: (r.calls || []).map((c, i) => ({ id: 'c' + step + i, name: c.name, args: typeof c.args === 'string' ? DS.safeJSON(c.args) : c.args, raw: typeof c.args === 'string' ? c.args : JSON.stringify(c.args) })), usage: null }; } }); } });
  setTimeout(res, 150); })"""
async def run(pg, prompt, script):
    await pg.evaluate("(s) => { window.__script = s; window.__sys = []; window.__ntools = []; const st = DS.store.settings(); st.provider = 'badmodel'; st.forceSim = false; st.permission = 'unrestricted'; DS.store.newThread(); window.__base = 0; }", script)
    await pg.evaluate("(p) => DS.agent.run(DS.store.activeThread(), p)", prompt)
    return await pg.evaluate("(() => { const m = DS.store.activeThread().messages.at(-1); return { parts: (m.parts||[]).filter(p => p.type==='tool').map(p => ({ name: p.name, status: p.status, fixed: p.fixed || [], err: p.result && p.result.error, args: p.args })), api: JSON.stringify(m.api) }; })()")
async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch(); pg = await b.new_page(viewport={'width': 390, 'height': 844})
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('file://' + os.path.abspath(sys.argv[1])); await pg.wait_for_function('window.DS && DS.ready'); await pg.wait_for_timeout(300)
        await pg.evaluate(SETUP, [])
        html = '<!doctype html><title>t</title><h1>Hi</h1>'
        # 1. native call wrapped in "tool_call" (the bug in the screenshots)
        r = await run(pg, 'build me a tiny app', [{ 'calls': [{ 'name': 'tool_call', 'args': { 'name': 'app_create', 'arguments': { 'name': 'tiny', 'html': html } } }] }])
        check('wrapper "tool_call" is unwrapped to app_create and runs', r['parts'] and r['parts'][0]['name'] == 'app_create' and r['parts'][0]['status'] == 'ok', r['parts'])
        # 2. alias + synonym args + string args
        r = await run(pg, 'save a note', [{ 'calls': [{ 'name': 'write_file', 'args': json.dumps({ 'file': '/notes/x.md', 'text': 'hello' }) }] }])
        ok = r['parts'] and r['parts'][0]['name'] == 'fs_write' and r['parts'][0]['status'] == 'ok'
        content = await pg.evaluate("DS.fs.read('/notes/x.md').then(f => f.content).catch(e => 'ERR ' + e.message)")
        check('alias write_file + {file,text} + JSON-string args → fs_write ok', ok and content == 'hello', [r['parts'], content])
        # 3. case/format + number coercion
        r = await run(pg, 'list files', [{ 'calls': [{ 'name': 'FS-List', 'args': { 'path': '/' } }] }])
        check('FS-List → fs_list', r['parts'] and r['parts'][0]['name'] == 'fs_list' and r['parts'][0]['status'] == 'ok', r['parts'])
        # 4. unknown tool → helpful error the model can act on
        r = await run(pg, 'do a thing', [{ 'calls': [{ 'name': 'frobnicate_widget', 'args': {} }] }])
        check('unknown tool error carries closest names + how_to_fix', 'how_to_fix' in r['api'] and 'Closest tools' in r['api'], r['api'][:300])
        # 5. missing required arg → error with signature + example
        r = await run(pg, 'save', [{ 'calls': [{ 'name': 'fs_write', 'args': { 'content': 'x' } }] }])
        check('missing required arg → signature + example in error', 'missing required' in r['api'] and 'Example' in r['api'], r['api'][:300])
        # 6. native model that writes the call as text (reasoning-model habit)
        r = await run(pg, 'list files', [{ 'content': 'I will list.\n```tool_call\n{"name":"fs_list","arguments":{"path":"/"}}\n```' }])
        # this provider is a plugin provider, so text recovery happens in forge.providers only — check toolkit parse directly instead:
        p = await pg.evaluate("""() => { const T = DS.toolkit, n = DS.agent.tools().map(t => t.name); return [
          T.parse('x\\n```tool_call\\n{"name":"fs_list","arguments":{"path":"/"}}\\n```', {names:n}).calls.map(c => c.name),
          T.parse('<tool_call>{"name":"fs_read","arguments":{"path":"/a"}}</tool_call>', {names:n}).calls.map(c => c.name),
          T.parse('<function=fs_read>{"path":"/a"}</function>', {names:n}).calls.map(c => c.name),
          T.parse('{"name":"web_search","arguments":{"query":"x"}}', {names:n}).calls.map(c => c.name),
          T.parse('```json\\n{"name":"John","age":3}\\n```', {names:n}).calls.length,
          T.parse('```json\\n{"tool":"fs_list","args":{"path":"/"}}\\n```', {names:n}).calls.map(c => c.name),
          T.parse('```tool_call\\n{"name":"app_create","arguments":{"name":"a","html":"<p>{x}</p>"}}\\n```', {names:n}).calls.map(c => c.args.html) ]; }""")
        check('parse ```tool_call fence', p[0] == ['fs_list'], p)
        check('parse <tool_call> xml', p[1] == ['fs_read'], p)
        check('parse <function=…> llama style', p[2] == ['fs_read'], p)
        check('parse bare JSON reply', p[3] == ['web_search'], p)
        check('ordinary JSON data is NOT a tool call', p[4] == 0, p)
        check('json fence with tool/args keys', p[5] == ['fs_list'], p)
        check('nested braces inside arguments survive', p[6] == ['<p>{x}</p>'], p)
        # 7. scoping + quick reference in the system prompt
        await run(pg, 'hello there', [{ 'content': 'hi' }])
        nt = await pg.evaluate("window.__ntools[0]"); sysp = await pg.evaluate("window.__sys[0]")
        check('small talk gets a scoped tool list (≤ 26) incl. app_create', len(nt) <= 26 and 'app_create' in nt, len(nt))
        check('system prompt has the tools quick reference', 'Tools — quick reference' in sysp and 'tool_help' in sysp)
        await run(pg, 'search the web and open https://example.com', [{ 'content': 'ok' }])
        nt2 = await pg.evaluate("window.__ntools[0]")
        check('web request adds browser tools', any(n.startswith('computer_') for n in nt2), nt2)
        # 8. hidden tool still callable
        r = await run(pg, 'hi', [{ 'calls': [{ 'name': 'brain_recall', 'args': { 'query': 'x' } }] }])
        check('a tool hidden by scoping still runs when called', r['parts'] and r['parts'][0]['status'] == 'ok', r['parts'])
        # 9. tool_help
        th = await pg.evaluate("DS.agent.tool('tool_help').run({ name: 'write_file' })")
        check('tool_help resolves aliases and gives an example', th.get('name') == 'fs_write' and 'example_call' in th, th)
        check('no page errors', not errs, errs)
        await b.close()
asyncio.run(main()); print('\nFAILS:', fails or 'none'); sys.exit(1 if fails else 0)

#!/usr/bin/env python3
"""Claude (built into this artifact) provider. window.claude is mocked with the artifact runtime contract
(use('sample') / use('downloads')): default provider inside an artifact, prompt-mode tool calls run through the agent loop,
streaming via onText, tiers per role, not_granted handled honestly, downloads routed through the capability,
and outside an artifact nothing changes. usage: t_claude_artifact.py <abs html>"""
import sys, os, asyncio
from playwright.async_api import async_playwright
fails = []
def check(n, c, i=''):
    print(('PASS ' if c else 'FAIL ') + n + ((' — ' + str(i)[:500]) if i and not c else ''), flush=True)
    if not c: fails.append(n)
MOCK = r"""
(() => {
  window.__calls = []; window.__saves = []; window.__mode = 'ok';
  const sample = async (input, opts) => {
    window.__calls.push({ input: JSON.parse(JSON.stringify(input)), tier: opts && opts.modelTier, cache: opts && opts.cache });
    if (window.__mode === 'deny') throw { code: 'not_granted', message: 'viewer declined' };
    const last = input[input.length - 1].content;
    let text;
    if (/\[TOOL_RESULT/.test(last)) text = 'Saved the note. Done.';
    else if (/write a note/i.test(last)) text = 'I will save it.\n```tool_call\n{"name":"fs_write","arguments":{"path":"/notes/claude.md","content":"hello from claude"}}\n```';
    else text = 'Hello from Claude (mock), tier ' + (opts && opts.modelTier);
    let acc = '';
    for (const ch of text.match(/.{1,12}/gs)) { await new Promise(r => setTimeout(r, 5)); acc += ch; opts && opts.onText && opts.onText({ text: acc, delta: ch }); }
    return { text, truncated: false, modelTierApplied: opts && opts.modelTier || 'default' };
  };
  const api = { sample, downloads: { save: async (o) => { window.__saves.push({ filename: o.filename, size: o.data && o.data.size }); } }, permissions: { manage: async () => {}, state: async () => ({}) } };
  window.claude = { use: name => Promise.resolve(api[name] || null) };
})();
"""
RUN = """async (txt) => { const t = DS.store.newThread(); await DS.agent.run(t, txt); const m = t.messages.at(-1);
  return { text: (m.parts || []).filter(p => p.type === 'text').map(p => p.text).join(''), tools: (m.parts || []).filter(p => p.type === 'tool').map(p => p.name + ':' + p.status), meta: m.meta, err: m.meta && m.meta.error }; }"""
async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch()
        # inside an artifact
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}); await ctx.add_init_script(MOCK)
        pg = await ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        net = []; pg.on('request', lambda r: net.append(r.url) if not r.url.startswith(('file:', 'data:', 'blob:')) else None)
        await pg.goto('file://' + os.path.abspath(sys.argv[1])); await pg.wait_for_function('window.DS && DS.ready'); await pg.wait_for_timeout(600)
        s = await pg.evaluate("(() => { const s = DS.store.settings(); return { provider: s.provider, models: s.models, pick: DS.providers.pick().id, live: DS.providers.isLive() }; })()")
        check('inside an artifact Claude (built in) is the default provider', s['provider'] == 'claude_artifact' and s['pick'] == 'claude_artifact' and s['live'], s)
        check('agent/trainer/judge tiers: executor default, planner complex, critic quick', s['models'].get('executor') == 'claude-default' and s['models'].get('planner') == 'claude-complex' and s['models'].get('critic') == 'claude-quick', s['models'])
        note = await pg.evaluate("document.body.innerText.includes('No API key needed')")
        check('the "No API key needed" notice is shown', note)
        r = await pg.evaluate(RUN, 'hi there')
        c = await pg.evaluate("window.__calls.at(-1)")
        check('chat answered by Claude via sample (streamed)', 'Hello from Claude (mock), tier default' in r['text'], r)
        check('instructions sent as a leading user turn, ends on user, cache off', c['input'][0]['role'] == 'user' and '[INSTRUCTIONS' in c['input'][0]['content'] and c['input'][-1]['role'] == 'user' and c['cache'] is False, c['input'][0]['content'][:200])
        check('message tagged with the real provider', r['meta'].get('provider') == 'claude_artifact', r['meta'])
        await pg.evaluate("DS.store.settings().permission = 'unrestricted'")
        r2 = await pg.evaluate(RUN, 'please write a note')
        f = await pg.evaluate("DS.fs.read('/notes/claude.md')")
        check('prompt-mode tool call runs through the agent loop (fs_write), fence not shown', 'fs_write:ok' in r2['tools'] and (f or {}).get('content') == 'hello from claude' and 'Done' in r2['text'] and 'tool_call' not in r2['text'], {'r': r2, 'f': f})
        tool_turn = await pg.evaluate("window.__calls.at(-1).input.at(-1).content")
        check('tool result returned to Claude as a [TOOL_RESULT] user turn', '[TOOL_RESULT' in tool_turn, tool_turn[:200])
        await pg.evaluate("DS.util.download('x.txt', 'abc')"); await pg.wait_for_timeout(100)
        sv = await pg.evaluate("window.__saves")
        check('downloads go through the artifact downloads capability', sv and sv[0]['filename'] == 'x.txt' and sv[0]['size'] == 3, sv)
        await pg.evaluate("DS.shell.show('settings')"); await pg.wait_for_timeout(500)
        ov = await pg.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        sec = await pg.evaluate("document.body.innerText.includes('Claude (built into this artifact)')")
        check('settings section present, no horizontal overflow at 390', sec and ov <= 1, {'sec': sec, 'ov': ov})
        ext = [u for u in net if 'fonts.googleapis' not in u and 'fonts.gstatic' not in u]
        check('no network requests needed for Claude answers', not ext, ext[:5])
        # declined consent → honest error, then free fallback/Sim path still answers
        await pg.evaluate("window.__mode = 'deny'")
        r3 = await pg.evaluate(RUN, 'hi again')
        avail = await pg.evaluate("DS.kernel.list('provider').find(p => p.id === 'claude_artifact').available()")
        check('declined consent: provider marked unavailable and the run still gets an answer (fallback)', avail is False and (len(r3['text']) > 0 or r3['err']), {'r': r3, 'avail': avail})
        check('no page errors (artifact)', not errs, errs)
        await ctx.close()
        # outside an artifact: nothing changes
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}); pg = await ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('file://' + os.path.abspath(sys.argv[1])); await pg.wait_for_function('window.DS && DS.ready'); await pg.wait_for_timeout(400)
        s2 = await pg.evaluate("(() => ({ provider: DS.store.settings().provider, avail: DS.kernel.list('provider').find(p => p.id === 'claude_artifact').available(), note: document.body.innerText.includes('No API key needed') }))()")
        check('outside an artifact: default stays OpenRouter, provider unavailable, no notice', s2['provider'] == 'openai' and s2['avail'] is False and not s2['note'], s2)
        check('no page errors (file://)', not errs, errs)
        await b.close()
    print('\nFAILS: ' + (', '.join(fails) if fails else 'none')); sys.exit(1 if fails else 0)
asyncio.run(main())

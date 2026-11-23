#!/usr/bin/env python3
"""Observatory: live agent visibility. Offline: Sim demo builds a canvas game (plan → app_create → app_inspect) and the
Observatory captures spans, thoughts, files and the agent's eye (real frames from the running game); a scripted
provider streams reasoning + calls web_search / web_fetch (tool runs stubbed) → searches, pages, sites, tagged
thoughts, context snapshot; a subagent lane; HUD during a run; replay; export; every tab at 390px w/o overflow.
usage: t_observe.py <abs html> [shotdir]"""
import sys, os, asyncio, json
from playwright.async_api import async_playwright
HTML = os.path.abspath(sys.argv[1]); SHOT = sys.argv[2] if len(sys.argv) > 2 else None
fails = []
def check(n, c, i=''):
    print(('PASS ' if c else 'FAIL ') + n + ((' — ' + str(i)[:500]) if i and not c else ''), flush=True)
    if not c: fails.append(n)
SETUP = """() => new Promise(res => {
  DS.agent.tool('web_search').run = async a => [{ title: 'Canvas game loop basics', url: 'https://developer.mozilla.org/en-US/docs/Games/Anatomy', snippet: 'requestAnimationFrame drives the loop' }, { title: 'Collision detection', url: 'https://example.org/collide', snippet: 'circle vs triangle' }];
  DS.agent.tool('web_fetch').run = async a => ({ url: a.url, status: 200, title: 'Anatomy of a video game', text: 'A game loop updates state then renders. [MDN](https://developer.mozilla.org) Use requestAnimationFrame. Secret sk-or-v1-abcdefabcdefabcdefabcdefabcdefabcdefabcdef should be hidden.', links: 3 });
  DS.plugin({ name: 't.obs', apply(ctx) { ctx.provider({ id: 'scripted', label: 'Scripted', available: () => true, models: ['s'],
    async stream({ messages, onDelta, thread }) { const step = messages.filter(m => m.role === 'assistant').length; const sc = (thread && thread.__script) || window.__script; const r = sc[step] || { content: 'done' };
      if (r.reason) for (const ch of r.reason.match(/.{1,9}/gs)) { onDelta && onDelta({ reasoning: ch }); await new Promise(z => setTimeout(z, 3)); }
      if (r.content) onDelta && onDelta({ content: r.content });
      return { content: r.content || '', reasoning: r.reason || '', toolCalls: (r.calls || []).map((c, i) => ({ id: 'c' + step + i, name: c.name, args: c.args, raw: JSON.stringify(c.args) })), usage: null }; } }); } });
  setTimeout(res, 120); })"""
async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch()
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
        pg = await ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('file://' + HTML); await pg.wait_for_function('window.DS && DS.ready'); await pg.wait_for_timeout(300)
        await pg.evaluate("(() => { const s = DS.store.settings(); s.permission = 'unrestricted'; s.forceSim = true; })()")
        # 1. Sim demo: build + inspect a game
        await pg.evaluate("(async () => { const t = DS.store.newThread(); DS.shell.show('thread'); window.__p = DS.agent.run(t, 'watch an agent build a tiny canvas game'); })()")
        await pg.wait_for_timeout(400); await pg.evaluate("DS.shell.show('thread')"); await pg.wait_for_timeout(450)
        hud = await pg.evaluate("(() => { const h = document.getElementById('ob-hud'); return h ? { on: h.classList.contains('on'), text: h.innerText } : null; })()")
        await pg.evaluate("window.__p")
        r = await pg.evaluate("""(() => { const O = DS.service('forge.observe'); const run = O.runs().at(-1); const tools = run.spans.filter(s => s.kind === 'tool').map(s => s.label + ':' + s.status);
          return { status: run.status, steps: run.steps, tools, files: [...run.files.keys()], thoughts: run.thoughts.length, eye: run.eye && { path: run.eye.path, snaps: run.eye.snaps, frames: run.eye.frames.length, fps: run.eye.fps, verdict: O.verdict(run.eye).t, canvas: run.eye.stats && run.eye.stats.canvas, errors: run.eye.errors }, last: DS.store.activeThread().messages.at(-1).parts.filter(p => p.type === 'text').map(p => p.text).join('') }; })()""")
        check('HUD pill shows live activity while the agent runs', hud and hud['on'] and len(hud['text']) > 3, hud)
        check('run captured: done, steps and tool spans', r['status'] == 'done' and r['steps'] >= 3 and 'app_create:ok' in r['tools'] and 'app_inspect:ok' in r['tools'], r)
        check('files touched recorded', '/apps/orbit-dodge/index.html' in r['files'], r['files'])
        check('thoughts parsed from the agent text', r['thoughts'] >= 3, r['thoughts'])
        e = r['eye'] or {}
        check('agent\'s eye ran the game: snapshots + real canvas frames', e.get('snaps', 0) >= 2 and e.get('frames', 0) >= 1 and (e.get('canvas') or {}).get('w', 0) > 0, e)
        check('agent\'s eye verdict: animating, no errors', e.get('verdict') == 'animating' and e.get('errors') == 0, e)
        check('app_inspect result reaches the agent (final answer mentions it)', 'animating' in r['last'] and 'fps' in r['last'], r['last'])
        # 2. scripted: reasoning + web
        await pg.evaluate(SETUP)
        await pg.evaluate("""(async () => { const s = DS.store.settings(); s.forceSim = false; s.provider = 'scripted';
          window.__script = [
            { reason: 'First, I need to find how game loops work. I will search the web. Maybe requestAnimationFrame is best? ', calls: [{ name: 'web_search', args: { query: 'canvas game loop' } }] },
            { reason: 'The search shows an MDN page. Let me read it.', calls: [{ name: 'web_fetch', args: { url: 'https://developer.mozilla.org/en-US/docs/Games/Anatomy' } }] },
            { reason: 'So I\\'ll go with requestAnimationFrame. ', content: 'Use requestAnimationFrame for the loop.' } ];
          const t = DS.store.newThread(); await DS.agent.run(t, 'research game loops'); })()""")
        w = await pg.evaluate("""(() => { const run = DS.service('forge.observe').runs().at(-1);
          return { searches: run.searches.map(s => s.q + ':' + s.results.length), pages: run.pages.map(p => ({ host: p.host, title: p.title, text: p.text })), sites: [...run.sites.keys()], tags: [...new Set(run.thoughts.map(t => t.tag))], ctx: run.ctx && { total: run.ctx.total, tools: run.ctx.tools.length, msgs: run.ctx.messages.length, model: run.ctx.model } }; })()""")
        check('searches captured with results', w['searches'] == ['canvas game loop:2'], w['searches'])
        check('pages read captured (what the agent got)', w['pages'] and w['pages'][0]['host'] == 'developer.mozilla.org' and 'game loop' in w['pages'][0]['text'], w['pages'])
        check('secrets redacted in captured page text', w['pages'] and 'sk-or-v1-abcdef' not in w['pages'][0]['text'], w['pages'][0]['text'] if w['pages'] else '')
        check('sites mapped (listed + read)', 'developer.mozilla.org' in w['sites'] and 'example.org' in w['sites'], w['sites'])
        check('reasoning parsed into tagged thoughts (plan/intent/question/observation/decision)', {'plan', 'question', 'observation', 'decision'} <= set(w['tags']), w['tags'])
        check('context snapshot of what the model saw', w['ctx'] and w['ctx']['total'] > 100 and w['ctx']['tools'] > 3 and w['ctx']['msgs'] >= 2, w['ctx'])
        # 3. subagent lane
        await pg.evaluate("""(async () => { const parent = DS.store.activeThread(); const ch = DS.store.newThread(); ch.hidden = true; ch.parentId = parent.id; ch.agentRole = 'researcher';
          ch.__script = [{ content: 'child done' }]; DS.store.state.activeThread[DS.store.state.activeWorkspace] = parent.id;
          const pr = DS.agent.run(parent, 'parent again'); const cr = DS.agent.run(ch, 'child task'); await Promise.all([pr, cr]); })()""")
        # 4. views at 390
        await pg.evaluate("DS.shell.show('observe')"); await pg.wait_for_timeout(500)
        sel_ok = await pg.evaluate("(() => { const O = DS.service('forge.observe'); const runs = O.runs().filter(r => !r.parentId); const p = runs.at(-1); O.select(p.id); return !!p; })()")
        await pg.wait_for_timeout(300)
        lanes = await pg.evaluate("[...document.querySelectorAll('.ob-svg text')].map(t => t.textContent).filter(x => x === 'main' || x === 'researcher')")
        check('swimlane shows main + subagent lanes', 'main' in lanes and 'researcher' in lanes, lanes)
        res = {}
        for tb in ['overview', 'mind', 'web', 'eye', 'context', 'tools', 'log']:
            await pg.evaluate("t => document.querySelector('.ob-tabs [data-t=\"' + t + '\"]').click()", tb); await pg.wait_for_timeout(350)
            res[tb] = await pg.evaluate("(() => ({ over: document.documentElement.scrollWidth - document.documentElement.clientWidth, inner: (() => { const b = document.querySelector('.ob-body'); return b.scrollWidth - b.clientWidth; })(), len: document.querySelector('.ob-body').innerText.length }))()")
            if SHOT: await pg.screenshot(path=os.path.join(SHOT, 'obs-' + tb + '.png'))
        check('all 7 tabs render content', all(v['len'] > 20 for v in res.values()), res)
        check('no horizontal overflow in any tab at 390px', all(v['over'] <= 1 and v['inner'] <= 1 for v in res.values()), res)
        # eye tab on the game run mounts a live frame that reports
        await pg.evaluate("(() => { const O = DS.service('forge.observe'); const g = O.runs().find(r => r.eye && /orbit/.test(r.eye.path)); O.select(g.id); document.querySelector('.ob-tabs [data-t=\"eye\"]').click(); })()")
        await pg.wait_for_timeout(2200)
        live = await pg.evaluate("(() => ({ frame: !!document.querySelector('.ob-stage iframe'), film: document.querySelectorAll('.ob-film img').length, wire: !!document.querySelector('[data-wire] svg'), badges: document.querySelector('[data-badges]').innerText }))()")
        if SHOT: await pg.screenshot(path=os.path.join(SHOT, 'obs-eye-live.png'))
        check('agent\'s eye tab: live iframe + filmstrip + wireframe + badges', live['frame'] and live['film'] >= 1 and live['wire'] and 'animating' in live['badges'], live)
        # replay + export
        await pg.evaluate("document.querySelector('.ob-tabs [data-t=\"overview\"]').click()")
        await pg.evaluate("(() => { const i = document.querySelector('.ob-scrub input'); i.value = 300; i.dispatchEvent(new Event('input')); })()"); await pg.wait_for_timeout(200)
        lbl = await pg.evaluate("document.querySelector('.ob-scrub span').textContent")
        check('replay scrubber moves back in time', lbl.startswith('⏪'), lbl)
        ex = await pg.evaluate("(() => { const O = DS.service('forge.observe'); return JSON.parse(JSON.stringify(O.exportRun(O.selected()))); })()")
        check('export has spans, thoughts and eye summary', ex['spans'] and ex['thoughts'] and ex['eye'] and ex['eye']['verdict'] == 'animating', {k: (len(v) if isinstance(v, list) else v) for k, v in ex.items() if k in ('spans', 'thoughts', 'eye')})
        check('no page errors', not errs, errs)
        await b.close()
    print('\nFAILS: ' + (', '.join(fails) if fails else 'none')); sys.exit(1 if fails else 0)
asyncio.run(main())

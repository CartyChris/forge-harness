#!/usr/bin/env python3
"""forge.agents: parallel subagents, hidden child threads, per-role routes, persistence, Agents view @390px, Stop, Sim orchestrate.
usage: t_agents.py <abs html>"""
import sys, os, asyncio
from playwright.async_api import async_playwright
fails = []
def check(n, c, i=''):
    print(('PASS ' if c else 'FAIL ') + n + ((' — ' + str(i)[:400]) if i and not c else ''), flush=True)
    if not c: fails.append(n)
PREP = """() => { const st = DS.store.settings(); st.provider = 'sim'; st.forceSim = false; st.permission = 'unrestricted'; st.verify = false; }"""
async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch(); pg = await b.new_page(viewport={'width': 390, 'height': 844})
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.route('http*://**/*', lambda r: r.abort())
        await pg.goto('file://' + os.path.abspath(sys.argv[1])); await pg.wait_for_function('window.DS && DS.ready'); await pg.wait_for_timeout(300)
        await pg.evaluate(PREP)
        check('forge.agents service + tools registered', await pg.evaluate("!!DS.service('forge.agents') && ['spawn_subagent','agents_wait','agents_status'].every(n => !!DS.agent.tool(n))"))
        has_del = await pg.evaluate("!!DS.agent.tool('delegate') || !DS.kernel.plugins.has('forge.picks')")
        check('existing delegate tool still present (when 95-picks is loaded)', has_del)
        # 1. parallel spawn
        r = await pg.evaluate("""async () => {
          const A = DS.service('forge.agents'); A.setRole('coder', { provider: 'sim', model: 'sim' });
          const parent = DS.store.newThread('parent'); const ac = new AbortController(); let maxRun = 0;
          const off = DS.bus.on('agents:update', () => { maxRun = Math.max(maxRun, A.jobs().filter(j => j.status === 'running').length); });
          const T = DS.agent.tool('spawn_subagent');
          const out = await Promise.all([T.run({ task: 'Research for: alpha', role: 'researcher' }, { thread: parent, signal: ac.signal }), T.run({ task: 'Write notes for: beta', role: 'coder' }, { thread: parent, signal: ac.signal })]);
          off(); const kids = DS.store.threads().filter(t => t.parentId === parent.id);
          return { out, maxRun, kids: kids.map(t => ({ id: t.id, hidden: t.hidden, parentId: t.parentId, route: t.route || null, role: t.agentRole, msgs: t.messages.length })), pid: parent.id };
        }""")
        out = r['out']
        check('both subagents finish (status done, non-empty answer)', all(o['status'] == 'done' and o['answer'] for o in out), out)
        check('result shape {role, model, answer, tools_used, files_changed}', all(all(k in o for k in ('role', 'model', 'answer', 'tools_used', 'files_changed')) for o in out), out)
        check('subagents ran concurrently (2 running at once)', r['maxRun'] >= 2, r['maxRun'])
        kids = r['kids']
        check('two distinct hidden child threads with parentId', len(kids) == 2 and len({k['id'] for k in kids}) == 2 and all(k['hidden'] and k['parentId'] == r['pid'] for k in kids), kids)
        coder = [k for k in kids if k['role'] == 'coder']
        check('coder child.route set from role (sim/sim)', coder and coder[0]['route'] == {'provider': 'sim', 'model': 'sim'}, kids)
        check('child tools filtered by role groups (researcher used fs_list)', any('fs_list' in o['tools_used'] for o in out), out)
        # 2. Sim orchestrate intent (two spawns + wait + summary)
        r2 = await pg.evaluate("""async () => { const t = DS.store.newThread(); await DS.agent.run(t, 'orchestrate: audit this workspace'); const m = t.messages.at(-1);
          return { tools: (m.parts || []).filter(p => p.type === 'tool').map(p => p.name + ':' + p.status), text: (m.parts || []).filter(p => p.type === 'text').map(p => p.text).join('') }; }""")
        check('Sim orchestrate: spawn×2 + agents_wait all ok', r2['tools'] == ['spawn_subagent:ok', 'spawn_subagent:ok', 'agents_wait:ok'], r2)
        check('Sim orchestrate: final summary lists 2 subagents', 'Orchestrated 2 subagents' in r2['text'], r2['text'][:300])
        # 3. Stop aborts a running subagent (fake provider that waits on its signal)
        r3 = await pg.evaluate("""() => new Promise(res => { DS.plugin({ name: 't.slow', apply(ctx) { ctx.provider({ id: 'slowp', label: 'Slow', available: () => true, models: ['slow'],
            stream: ({ signal }) => { window.__slowCalled = (window.__slowCalled || 0) + 1; return new Promise((_, rej) => signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true })); } }); } });
          setTimeout(async () => { const A = DS.service('forge.agents'); A.setRole('fast', { provider: 'slowp', model: 'slow' });
            const parent = DS.store.newThread('p2'); const h = await DS.agent.tool('spawn_subagent').run({ task: 'never ends', role: 'fast', wait: false }, { thread: parent, signal: new AbortController().signal });
            for (let i = 0; i < 40 && !window.__slowCalled; i++) await DS.util.sleep(50);
            const before = A.job(h.id).status; const t0 = Date.now(); A.stop(h.id); const w = await A.wait([h.id], 5000);
            res({ before, after: A.job(h.id).status, ms: Date.now() - t0, called: window.__slowCalled, route: DS.store.threads().find(t => t.id === h.thread).route, w }); }, 150); })""")
        check('fake provider reached via role route', r3['called'] >= 1 and r3['route'] == {'provider': 'slowp', 'model': 'slow'}, r3)
        check('Stop aborts a running subagent quickly', r3['before'] == 'running' and r3['after'] == 'stopped' and r3['ms'] < 3000, r3)
        # 4. Agents view at 390px
        await pg.evaluate("DS.shell.show('agents')"); await pg.wait_for_timeout(300)
        v = await pg.evaluate("""() => ({ sw: document.documentElement.scrollWidth, bw: document.body.scrollWidth, roles: document.querySelectorAll('.ag .ag-r').length, jobs: document.querySelectorAll('.ag .ag-j[data-th]').length,
          opts: [...(document.querySelector('.ag .ag-r select') || { options: [] }).options].map(o => o.value) })""")
        check('Agents view renders roles + live jobs', v['roles'] >= 5 and v['jobs'] >= 3, v)
        check('Agents view: no horizontal scroll at 390px', v['sw'] <= 390 and v['bw'] <= 390, v)
        check('model select lists only usable providers (sim present, inherit first)', v['opts'] and v['opts'][0] == '' and 'sim::sim' in v['opts'], v['opts'][:8])
        tr = await pg.evaluate("""async () => { const b = document.querySelector('.ag .ag-r[data-role="coder"] [data-test]'); b.click(); for (let i = 0; i < 40; i++) { const t = document.querySelector('.ag .ag-r[data-role="coder"] [data-out]').textContent; if (/[✓✗]/.test(t)) return t; await DS.util.sleep(50); } return 'timeout'; }""")
        check('Test button reports a real result for the role model', tr.startswith('✓'), tr)
        hid = await pg.evaluate("[...document.querySelectorAll('#side .th-i')].filter(e => e.querySelector('[data-t]') && DS.store.threads().find(t => t.id === e.querySelector('[data-t]').dataset.t && t.hidden)).filter(e => getComputedStyle(e).display !== 'none').length")
        check('hidden child threads are not visible in the sidebar', hid == 0, hid)
        # 5. persistence across reload
        await pg.evaluate("DS.store.flush()"); await pg.wait_for_timeout(200)
        await pg.reload(); await pg.wait_for_function('window.DS && DS.ready'); await pg.wait_for_timeout(300)
        p = await pg.evaluate("() => { const A = DS.service('forge.agents'); return { coder: A.role('coder'), fast: A.role('fast'), hidden: DS.store.threads().filter(t => t.hidden && t.parentId).length }; }")
        check('per-role model mapping persists across reload', p['coder']['provider'] == 'sim' and p['coder']['model'] == 'sim' and p['fast']['provider'] == 'slowp', p)
        check('hidden child threads persist across reload', p['hidden'] >= 5, p)
        await pg.evaluate("DS.shell.show('agents')"); await pg.wait_for_timeout(200)
        n = await pg.evaluate("document.querySelectorAll('.ag .ag-j[data-th]').length")
        check('Agents view lists past subagents after reload', n >= 5, n)
        check('no page errors', not errs, errs)
        await b.close()
    print('FAILS: ' + (', '.join(fails) if fails else 'none'))
    sys.exit(1 if fails else 0)
asyncio.run(main())

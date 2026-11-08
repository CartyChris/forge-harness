#!/usr/bin/env python3
"""Agent-engine regressions: parallel-safe tool calls in one step run concurrently (results in call order),
writes stay sequential, and stopping one thread never cancels another thread's pending approval.
usage: t_engine.py <abs html>"""
import sys, os, asyncio
from playwright.async_api import async_playwright
fails = []
def check(n, c, i=''):
    print(('PASS ' if c else 'FAIL ') + n + ((' — ' + str(i)[:400]) if i and not c else ''), flush=True)
    if not c: fails.append(n)
SETUP = """() => new Promise(res => { window.__log = [];
  DS.plugin({ name: 't.engine', apply(ctx) {
    ctx.tool({ name: 'slow_read', label: 'slow', gate: 'none', parallel: true, description: 'test', parameters: { type: 'object', properties: { k: { type: 'string' } } },
      async run(a, t) { const s = performance.now(); await new Promise((r, j) => { const tm = setTimeout(r, 400); t.signal && t.signal.addEventListener('abort', () => { clearTimeout(tm); j(Object.assign(new Error('aborted'), { name: 'AbortError' })); }); }); window.__log.push({ k: a.k, s, e: performance.now() }); return { k: a.k }; } });
    ctx.tool({ name: 'slow_write', label: 'slow w', gate: 'none', description: 'test', parameters: { type: 'object', properties: { k: { type: 'string' } } },
      async run(a) { const s = performance.now(); await new Promise(r => setTimeout(r, 200)); window.__log.push({ k: a.k, s, e: performance.now() }); return { k: a.k }; } });
    ctx.provider({ id: 'scripted', label: 'Scripted', available: () => true, models: ['s'],
      async stream({ messages, thread }) { const step = messages.filter(m => m.role === 'assistant').length; const sc = (thread && thread.__script) || window.__script; const r = sc[step] || { content: 'done' };
        return { content: r.content || '', reasoning: '', toolCalls: (r.calls || []).map((c, i) => ({ id: 'c' + step + i, name: c.name, args: c.args, raw: JSON.stringify(c.args) })), usage: null }; } }); } });
  setTimeout(res, 150); })"""
async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch(); pg = await b.new_page(viewport={'width': 390, 'height': 844})
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('file://' + os.path.abspath(sys.argv[1])); await pg.wait_for_function('window.DS && DS.ready'); await pg.wait_for_timeout(300)
        await pg.evaluate(SETUP)
        await pg.evaluate("""async () => { const st = DS.store.settings(); st.provider = 'scripted'; st.forceSim = false; st.permission = 'unrestricted';
          window.__script = [{ calls: [{ name: 'slow_read', args: { k: 'a' } }, { name: 'slow_read', args: { k: 'b' } }, { name: 'slow_read', args: { k: 'c' } }, { name: 'slow_write', args: { k: 'w1' } }, { name: 'slow_write', args: { k: 'w2' } }] }];
          const t = DS.store.newThread(); const t0 = performance.now(); await DS.agent.run(t, 'go'); window.__dur = performance.now() - t0; }""")
        r = await pg.evaluate("""() => { const m = DS.store.activeThread().messages.at(-1); const L = window.__log; const by = k => L.find(x => x.k === k);
          return { dur: window.__dur, order: m.api.filter(x => x.role === 'tool').map(x => JSON.parse(x.content).k), status: m.parts.filter(p => p.type === 'tool').map(p => p.status),
            overlap: by('b').s < by('a').e && by('c').s < by('a').e, seqW: by('w2').s >= by('w1').e - 1, readsBeforeWrites: by('w1').s >= Math.max(by('a').e, by('b').e, by('c').e) - 1 }; }""")
        check('parallel-safe reads overlap in time', r['overlap'], r)
        check('step faster than sequential (< 1.4 s for 3×0.4 s + 2×0.2 s)', r['dur'] < 1400, r)
        check('writes stay sequential and after the read batch', r['seqW'] and r['readsBeforeWrites'], r)
        check('tool results appended in call order', r['order'] == ['a', 'b', 'c', 'w1', 'w2'], r['order'])
        check('all calls ok', all(s == 'ok' for s in r['status']), r['status'])
        # scoped stop: thread A waits on an approval; stopping thread B must not cancel it
        res = await pg.evaluate("""async () => { const st = DS.store.settings(); st.permission = 'supervised';
          const A = DS.store.newThread(); A.__script = [{ calls: [{ name: 'fs_write', args: { path: '/scoped.txt', content: 'x' } }] }];
          const B = DS.store.newThread(); B.__script = [{ calls: [{ name: 'slow_read', args: { k: 'long' } }] }, { calls: [{ name: 'slow_read', args: { k: 'long2' } }] }];
          const pa = DS.agent.run(A, 'write'); await new Promise(r => setTimeout(r, 300));
          const sheetBefore = !!DS.guard._openClose;
          const pb = DS.agent.run(B, 'read'); await new Promise(r => setTimeout(r, 100)); DS.agent.stop(B); await pb.catch(() => {}); await new Promise(r => setTimeout(r, 150));
          const sheetAfter = !!DS.guard._openClose; const aRunning = DS.agent.isRunning(A);
          DS.agent.stop(A); await pa.catch(() => {}); await new Promise(r => setTimeout(r, 150));
          return { sheetBefore, sheetAfter, aRunning, closedOnOwnStop: !DS.guard._openClose, bStopped: !DS.agent.isRunning(B) }; }""")
        check('approval sheet opened for thread A', res['sheetBefore'], res)
        check('stopping thread B leaves A\'s approval open', res['sheetAfter'] and res['aRunning'], res)
        check('stopping A closes its own approval', res['closedOnOwnStop'] and res['bStopped'], res)
        # stop mid-batch: every tool_call still gets a tool reply (strict OpenAI-compatible APIs reject orphans), finished results are kept
        o = await pg.evaluate("""async () => { const st = DS.store.settings(); st.permission = 'unrestricted';
          const T = DS.store.newThread(); T.__script = [{ calls: [{ name: 'fs_list', args: { path: '/' } }, { name: 'slow_read', args: { k: 'x' } }, { name: 'slow_write', args: { k: 'never' } }] }];
          const p = DS.agent.run(T, 'go'); await new Promise(r => setTimeout(r, 200)); DS.agent.stop(T); await p.catch(() => {}); await new Promise(r => setTimeout(r, 100));
          const m = T.messages.at(-1); const a = m.api.find(x => x.tool_calls); const replies = m.api.filter(x => x.role === 'tool');
          T.__script = [{ content: 'ok' }]; let sent = null; const pr = DS.providers.pick(T); const orig = pr.stream; pr.stream = async o2 => { sent = o2.messages; return orig.call(pr, o2); };
          await DS.agent.run(T, 'again'); pr.stream = orig;
          const ai = sent.findIndex(x => x.tool_calls); const after = sent.slice(ai + 1, ai + 1 + a.tool_calls.length).map(x => x.role + ':' + x.tool_call_id);
          return { calls: a.tool_calls.map(c => c.id), replies: replies.map(r => r.tool_call_id + ':' + r.content.slice(0, 40)), after, wrote: window.__log.some(l => l.k === 'never') }; }""")
        check('stop mid-batch: every tool_call has a reply', len(o['replies']) == len(o['calls']), o)
        check('stop mid-batch: finished fs_list result kept, rest marked cancelled', 'cancelled' not in o['replies'][0] and all('cancelled' in r for r in o['replies'][1:]), o['replies'])
        check('next request: tool_calls immediately followed by their tool replies', all(x.startswith('tool:') for x in o['after']) and len(o['after']) == len(o['calls']), o)
        check('later sequential write never ran after stop', not o['wrote'], o)
        g = await pg.evaluate("[DS.toolkit.matchName('delete'), DS.toolkit.matchName('fs_delte'), DS.toolkit.matchName('rm'), DS.toolkit.matchName('fs_reed')]")
        check('fuzzy match never guesses a destructive tool', g[0] is None and g[1] is None, g)
        check('explicit alias rm and typo fs_reed still resolve', g[2] and g[2]['name'] == 'fs_delete' and g[3] and g[3]['name'] == 'fs_read', g)
        check('no page errors', not errs, errs)
        await b.close()
    print('\nFAILS: ' + (', '.join(fails) if fails else 'none')); sys.exit(1 if fails else 0)
asyncio.run(main())

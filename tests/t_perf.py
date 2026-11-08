#!/usr/bin/env python3
"""Performance probes (report + soft budgets): boot time, streaming 3000 deltas into a long answer, rendering a 200-message thread.
usage: t_perf.py <abs html>"""
import sys, os, asyncio, json
from playwright.async_api import async_playwright
fails = []
def check(n, c, i=''):
    print(('PASS ' if c else 'FAIL ') + n + ((' — ' + str(i)[:300]) if i else ''), flush=True)
    if not c: fails.append(n)
async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch(); ctx = await b.new_context(viewport={'width': 390, 'height': 844}); pg = await ctx.new_page()
        await ctx.new_cdp_session(pg)
        await pg.goto('file://' + os.path.abspath(sys.argv[1])); await pg.wait_for_function('window.DS && DS.ready', timeout=30000)
        boot = await pg.evaluate("(() => { const l = (DS.kernel.trace || []).find(x => /ready in/.test(x.msg || '')); return l ? +String(l.msg).match(/ready in (\\d+)ms/)[1] : -1; })()")
        check('boot ≤ 2500 ms (headless desktop CPU)', 0 < boot <= 2500, str(boot) + ' ms')
        r = await pg.evaluate("""() => new Promise(res => { DS.plugin({ name: 't.stream', apply(ctx) { ctx.provider({ id: 'streamer', label: 's', available: () => true,
            async stream({ onDelta }) { let s = ''; for (let i = 0; i < 3000; i++) { const d = (i % 40 === 0 ? '\\n\\n## Part ' + i + '\\n' : '') + 'word' + i + ' ' + (i % 97 === 0 ? '`code` **bold** ' : ''); s += d; onDelta({ content: d }); if (i % 50 === 0) await new Promise(r => setTimeout(r, 0)); } return { content: s, reasoning: '', toolCalls: [], usage: null }; } }); } });
          setTimeout(async () => { const st = DS.store.settings(); st.provider = 'streamer'; st.forceSim = false; const t = DS.store.newThread(); DS.shell.show('chat');
            let long = 0, last = performance.now(); const po = new PerformanceObserver(l => { for (const e of l.getEntries()) long += e.duration; }); try { po.observe({ type: 'longtask', buffered: false }); } catch (_) {}
            const t0 = performance.now(); await DS.agent.run(t, 'stream test'); await new Promise(r => setTimeout(r, 300)); po.disconnect(); res({ ms: Math.round(performance.now() - t0), longTasks: Math.round(long), chars: document.querySelector('#msgs').innerText.length }); }, 150); })""")
        check('streaming 3000 deltas ≤ 6000 ms', r['ms'] <= 6000, json.dumps(r))
        r2 = await pg.evaluate("""() => { const t = DS.store.newThread(); for (let i = 0; i < 200; i++) { t.messages.push({ id: 'u' + i, role: 'user', content: 'question ' + i, ts: Date.now() }); t.messages.push({ id: 'a' + i, role: 'assistant', ts: Date.now(), meta: { startedAt: Date.now() - 1000, endedAt: Date.now() }, parts: [{ type: 'text', text: '## Answer ' + i + '\\n' + 'lorem ipsum '.repeat(60) + '\\n```js\\nconst x = ' + i + ';\\n```' }] }); }
            const t0 = performance.now(); DS.shell.show('chat'); DS.threadView.renderAll(); return Math.round(performance.now() - t0); }""")
        check('render 400-message thread ≤ 1500 ms', r2 <= 1500, str(r2) + ' ms')
        await b.close()
asyncio.run(main()); print('\nFAILS:', fails or 'none'); sys.exit(1 if fails else 0)

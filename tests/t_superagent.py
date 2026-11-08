#!/usr/bin/env python3
"""Superagent (plugins/94-superagent.js): watch → inbox, ETag 304, Work on it thread, gh_pr_draft (.patch / draft PR), token hygiene, proactive, demo, 390px.
usage: timeout 150 python3 tests/t_superagent.py <abs html>"""
import sys, os, asyncio, json, re, time, subprocess, tempfile
from playwright.async_api import async_playwright
fails = []
def check(n, c, i=''):
    print(('PASS ' if c else 'FAIL ') + n + ((' — ' + str(i)[:500]) if i and not c else ''), flush=True)
    if not c: fails.append(n)
TOKEN = 'ghp_TESTtoken_9f8e7d6c5b4a'
REQ = []
MOCK = {'issues_v': 1, 'ratelimited': False}
CORS = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-None-Match, Accept',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS', 'Access-Control-Expose-Headers': 'ETag, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, Retry-After'}
RESET = str(int(time.time()) + 3000)
def issues():
    now = '2026-11-08T10:00:00Z'
    base = [{'number': 1, 'title': 'Crash on empty input', 'html_url': 'https://github.com/o/r/issues/1', 'labels': [{'name': 'bug', 'color': 'd73a4a'}], 'created_at': now, 'updated_at': now, 'user': {'login': 'alice'}, 'comments': 1, 'body': 'Steps: call app() with empty string.'},
            {'number': 2, 'title': 'Docs typo <script>alert(1)</script>', 'html_url': 'https://github.com/o/r/issues/2', 'labels': ['docs'], 'created_at': now, 'updated_at': now, 'user': {'login': 'bob'}, 'comments': 0, 'body': 'tpyo'},
            {'number': 3, 'title': 'Add feature', 'html_url': 'https://github.com/o/r/pull/3', 'pull_request': {'url': 'x'}, 'labels': [], 'created_at': now, 'updated_at': now, 'user': {'login': 'carol'}, 'comments': 0, 'body': 'adds', 'draft': False}]
    if MOCK['issues_v'] >= 2:
        base.insert(0, {'number': 4, 'title': 'Please auto-handle this', 'html_url': 'https://github.com/o/r/issues/4', 'labels': [{'name': 'Forge', 'color': '5319e7'}], 'created_at': now, 'updated_at': now, 'user': {'login': 'dave'}, 'comments': 0, 'body': 'A bug in parsing. Fix it.'})
    return base
RUNS = {'workflow_runs': [
    {'id': 900, 'name': 'CI', 'workflow_id': 1, 'head_branch': 'main', 'conclusion': 'failure', 'run_number': 41, 'html_url': 'https://github.com/o/r/actions/runs/900', 'created_at': '2026-11-08T09:00:00Z', 'event': 'push', 'head_sha': 'deadbeef', 'actor': {'login': 'alice'}, 'display_title': 'merge'},
    {'id': 899, 'name': 'CI', 'workflow_id': 1, 'head_branch': 'main', 'conclusion': 'success', 'run_number': 40, 'html_url': 'https://github.com/o/r/actions/runs/899', 'created_at': '2026-11-08T08:00:00Z'},
    {'id': 898, 'name': 'Lint', 'workflow_id': 2, 'head_branch': 'main', 'conclusion': 'success', 'run_number': 12, 'html_url': 'https://github.com/o/r/actions/runs/898', 'created_at': '2026-11-08T08:00:00Z'}]}
FILES = {'README.md': '# r\nHello repo\n', 'src/app.js': 'const x = 1;\nexport default x;\n'}
async def handle(route):
    rq = route.request; u = rq.url; m = rq.method; h = await rq.all_headers()
    REQ.append({'m': m, 'u': u, 'auth': h.get('authorization', ''), 'inm': h.get('if-none-match', ''), 'body': rq.post_data or ''})
    if m == 'OPTIONS': return await route.fulfill(status=204, headers=CORS)
    hd = dict(CORS); hd.update({'X-RateLimit-Limit': '60', 'X-RateLimit-Remaining': '55', 'X-RateLimit-Reset': RESET, 'Content-Type': 'application/json'})
    def js(o, st=200, etag=None):
        x = dict(hd)
        if etag: x['ETag'] = etag
        return route.fulfill(status=st, headers=x, body=json.dumps(o))
    if u.startswith('https://raw.githubusercontent.com/o/r/main/'):
        p = u.split('/main/', 1)[1]
        if p in FILES: return await route.fulfill(status=200, headers={'Access-Control-Allow-Origin': '*', 'Content-Type': 'text/plain'}, body=FILES[p])
        return await route.fulfill(status=404, headers={'Access-Control-Allow-Origin': '*'}, body='404')
    path = u.replace('https://api.github.com', '')
    if MOCK['ratelimited']:
        x = dict(hd); x['X-RateLimit-Remaining'] = '0'
        return await route.fulfill(status=403, headers=x, body=json.dumps({'message': 'API rate limit exceeded'}))
    if path == '/repos/o/r': return await js({'full_name': 'o/r', 'default_branch': 'main', 'private': False, 'html_url': 'https://github.com/o/r'}, etag='"meta"')
    if path.startswith('/repos/o/r/issues?'):
        et = '"iss%d"' % MOCK['issues_v']
        if h.get('if-none-match') == et:
            x = dict(hd); x['ETag'] = et
            return await route.fulfill(status=304, headers=x, body='')
        return await js(issues(), etag=et)
    if path.startswith('/repos/o/r/actions/runs?'): return await js(RUNS, etag='"runs1"')
    if path.startswith('/repos/o/r/issues/1/comments'): return await js([{'user': {'login': 'maint'}, 'body': 'Confirmed on v2 COMMENT_MARK'}])
    if path.startswith('/repos/o/r/git/trees/main'): return await js({'truncated': False, 'tree': [{'path': 'README.md', 'type': 'blob'}, {'path': 'src', 'type': 'tree'}, {'path': 'src/app.js', 'type': 'blob'}]})
    if path.startswith('/repos/o/r/contents/'):
        p = path.split('/contents/', 1)[1].split('?')[0]
        if p in FILES: return await route.fulfill(status=200, headers=dict(hd, **{'Content-Type': 'text/plain'}), body=FILES[p])
        return await js({'message': 'Not Found'}, 404)
    if m == 'GET' and path == '/repos/o/r/git/ref/heads/main': return await js({'object': {'sha': 'head111'}})
    if m == 'GET' and path == '/repos/o/r/git/commits/head111': return await js({'sha': 'head111', 'tree': {'sha': 'tree000'}})
    if m == 'POST' and path == '/repos/o/r/git/blobs': return await js({'sha': 'blob%d' % len([r for r in REQ if r['u'].endswith('/git/blobs')])}, 201)
    if m == 'POST' and path == '/repos/o/r/git/trees': return await js({'sha': 'tree111'}, 201)
    if m == 'POST' and path == '/repos/o/r/git/commits': return await js({'sha': 'commit111'}, 201)
    if m == 'POST' and path == '/repos/o/r/git/refs': return await js({'ref': 'refs/heads/x'}, 201)
    if m == 'POST' and path == '/repos/o/r/pulls': return await js({'number': 7, 'html_url': 'https://github.com/o/r/pull/7'}, 201)
    return await js({'message': 'unmocked ' + m + ' ' + path}, 404)

WAIT_RUN = "async (tid) => { const t0 = Date.now(); while (Date.now() - t0 < 20000) { const t = DS.store.threads().find(x => x.id === tid); if (t && !DS.agent.isRunning(t) && t.messages.length >= 2) return true; await new Promise(r => setTimeout(r, 100)); } return false; }"
CALL_PR = """async (args) => { const th = DS.store.activeThread(); const ac = new AbortController(); const part = { type: 'tool', id: 'p' + Date.now() }; const msg = { parts: [part], api: [] };
  const r = await DS.agent.callTool({ id: part.id, name: 'gh_pr_draft', args }, th, msg, part, ac.signal); return { r: (part.result && typeof part.result === 'object') ? part.result : r, status: part.status, summary: part.summary }; }"""

async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch(); pg = await b.new_page(viewport={'width': 390, 'height': 844})
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.route('https://api.github.com/**', handle); await pg.route('https://raw.githubusercontent.com/**', handle)
        await pg.goto('file://' + os.path.abspath(sys.argv[1])); await pg.wait_for_function('window.DS && DS.ready'); await pg.wait_for_timeout(300)
        ok = await pg.evaluate("!!DS.service('forge.superagent') && DS.kernel.list('view').some(v => v.id === 'superagent')")
        check('plugin active: service + view', ok)
        await pg.evaluate("() => { const s = DS.store.settings(); s.permission = 'unrestricted'; window.__asks = 0; DS.guard.ask = async req => { window.__asks++; window.__lastAsk = req; return { allow: true, always: false }; }; }")
        # 1. watch → inbox
        await pg.evaluate("DS.service('forge.superagent').watch('o/r')")
        st = await pg.evaluate("(() => { const s = DS.service('forge.superagent'); const it = s.items(); return { st: s.state(), kinds: it.map(i => i.kind), keys: it.map(i => i.key) }; })()")
        k = st['kinds']
        check('watch o/r → 2 issues + 1 PR + 1 failed run', k.count('issue') == 2 and k.count('ci') == 1 and k.count('pr') == 1 and not st['st']['error'], st)
        check('only the latest failing run per workflow is listed', 'ci:900' in st['keys'] and 'ci:899' not in st['keys'], st['keys'])
        check('rate-limit headers read', st['st']['rate']['remaining'] == 55 and st['st']['rate']['limit'] == 60, st['st']['rate'])
        await pg.evaluate("DS.shell.show('superagent')"); await pg.wait_for_timeout(200)
        dom = await pg.evaluate("(() => { const v = document.querySelector('#v-superagent'); return { issue: v.querySelectorAll('.sa-it[data-kind=issue]').length, ci: v.querySelectorAll('.sa-it[data-kind=ci]').length, xss: !!v.querySelector('.sa-list script'), credit: /dsh-superagent-prototype/.test(v.textContent) && /not DeepSeek/.test(v.textContent) }; })()")
        check('inbox view renders 2 issue cards + 1 CI card', dom['issue'] == 2 and dom['ci'] == 1, dom)
        check('untrusted titles are escaped', not dom['xss'], dom)
        check('UI credits the prototype honestly', dom['credit'], dom)
        n_calls = len([r for r in REQ if r['m'] == 'GET'])
        check('first poll is ≤ 3 API calls (meta, issues, runs)', len([r for r in REQ if 'api.github.com' in r['u']]) <= 3, [r['u'] for r in REQ])
        # 2. ETag 304
        REQ.clear()
        await pg.evaluate("DS.service('forge.superagent').poll('manual')")
        st2 = await pg.evaluate("DS.service('forge.superagent').state()")
        iss_req = [r for r in REQ if '/issues?' in r['u']]
        check('second poll sends If-None-Match and handles 304', iss_req and iss_req[0]['inm'] == '"iss1"' and st2['cached'] >= 1 and len(await pg.evaluate("DS.service('forge.superagent').items()")) == 4, [iss_req, st2])
        check('second poll skips the repo meta call', not any(r['u'].endswith('/repos/o/r') for r in REQ), [r['u'] for r in REQ])
        # 3. triage (Sim → heuristic)
        tr = await pg.evaluate("(async () => { const s = DS.service('forge.superagent'); const it = s.items().find(i => i.key === 'issue:1'); const r = await s.triage(it); return r; })()")
        check('triage gives a 3-line summary + next step', tr.get('status') == 'done' and 'Next step' in tr.get('text', '') and tr['text'].count('\n') >= 2, tr)
        # 4. Work on it (click) → new thread with context, plan mode, Sim plans via gh_tree/gh_read/update_plan
        await pg.click('#v-superagent .sa-it[data-k="issue:1"] [data-a="work"]')
        await pg.wait_for_function("DS.store.activeThread() && /^#1 /.test(DS.store.activeThread().title)", timeout=8000)
        tid = await pg.evaluate("DS.store.activeThread().id")
        done = await pg.evaluate(WAIT_RUN, tid)
        th = await pg.evaluate("""(() => { const t = DS.store.activeThread(); const u = t.messages.find(m => m.role === 'user'); const a = t.messages.find(m => m.role === 'assistant');
          return { title: t.title, mode: t.mode, sa: t.superagent, ctx: u && u.ctx || '', content: u && u.content, tools: (a && a.parts || []).filter(p => p.type === 'tool').map(p => p.name + ':' + p.status), plan: t.plan, view: DS.shell.current, err: a && a.meta && a.meta.error }; })()""")
        c = th['ctx']
        check('Work on it creates a visible thread "#1 <title>"', th['title'].startswith('#1 Crash on empty input') and th['view'] == 'thread', th['title'])
        check('context has body, comments, tree, README', 'Steps: call app()' in c and 'COMMENT_MARK' in c and 'src/app.js' in c and 'Hello repo' in c and 'Repo tree @ main' in c, c[:600])
        check('thread runs in Plan mode and proposes a plan', done and th['mode'] == 'plan' and th['plan'] and th['plan'].get('status') == 'proposed', [th['tools'], th['plan'], th['err']])
        check('agent used gh_tree + gh_read in plan mode', 'gh_tree:ok' in th['tools'] and 'gh_read:ok' in th['tools'], th['tools'])
        mir = await pg.evaluate("DS.fs.read('/repos/o/r/src/app.js').then(f => f.content).catch(e => 'ERR ' + e.message)")
        check('gh_read mirrors the file to /repos/o/r/', mir == FILES['src/app.js'], mir)
        # 5. gh_pr_draft without token → .patch
        r = await pg.evaluate(CALL_PR, {'title': 'Fix app crash', 'body': 'b', 'files': [{'path': 'src/app.js', 'content': 'const x = 2;\nexport default x;\n'}, {'path': 'src/new.js', 'content': 'export const y = 1;\n'}]})
        res = r['r']
        patch = await pg.evaluate("DS.fs.read('/repos/o/r/patches/fix-app-crash.patch').then(f => f.content).catch(e => 'ERR ' + e.message)")
        check('no token → .patch written under /repos/o/r/patches/', r['status'] == 'ok' and res.get('mode') == 'patch' and res.get('path') == '/repos/o/r/patches/fix-app-crash.patch' and '@@ -1,2 +1,2 @@' in patch and '-const x = 1;' in patch and 'new file mode 100644' in patch, [r, patch[:400]])
        check('gh_pr_draft asked via the guard (even at Full access)', await pg.evaluate("window.__asks") == 1, await pg.evaluate("window.__asks"))
        check('no write calls to GitHub without a token', not any(x['m'] == 'POST' for x in REQ), [x['u'] for x in REQ if x['m'] == 'POST'])
        # git apply the patch for real
        try:
            d = tempfile.mkdtemp(prefix='sa_')
            os.makedirs(d + '/src'); open(d + '/src/app.js', 'w').write(FILES['src/app.js']); open(d + '/p.patch', 'w').write(patch)
            subprocess.run(['git', 'init', '-q'], cwd=d, check=True)
            g = subprocess.run(['git', 'apply', 'p.patch'], cwd=d, capture_output=True, text=True)
            ok = g.returncode == 0 and open(d + '/src/app.js').read() == 'const x = 2;\nexport default x;\n' and open(d + '/src/new.js').read() == 'export const y = 1;\n'
            check('the .patch applies cleanly with git apply', ok, g.stderr)
        except FileNotFoundError:
            print('SKIP git apply (git missing)')
        pa = await pg.evaluate("DS.service('forge.superagent').patch('a.txt', 'l1\\nl2\\nl3', 'l1\\nL2\\nl3\\n')")
        check('patch: no-EOL marker + CRLF-free hunks', '\\ No newline at end of file' in pa and '@@ -1,3 +1,3 @@' in pa, pa)
        # 6. with token → blobs → tree → commit → ref → pulls
        await pg.evaluate("(t) => DS.service('forge.superagent').setToken(t)", TOKEN)
        REQ.clear()
        r = await pg.evaluate(CALL_PR, {'title': 'Fix app crash', 'body': 'b', 'files': [{'path': 'src/app.js', 'content': 'const x = 3;\n'}]})
        res = r['r']; posts = [x for x in REQ if x['m'] == 'POST']
        order = [re.sub(r'.*/repos/o/r/', '', x['u']) for x in posts]
        check('token → blobs→tree→commit→ref→pulls in order', order == ['git/blobs', 'git/trees', 'git/commits', 'git/refs', 'pulls'], order)
        check('returns the draft PR URL', res.get('url') == 'https://github.com/o/r/pull/7' and res.get('mode') == 'pr', res)
        pb = [json.loads(x['body']) for x in posts]
        check('ref is forge/<slug>, PR is draft against main, closes #1', pb[3].get('ref') == 'refs/heads/forge/fix-app-crash' and pb[4].get('draft') is True and pb[4].get('base') == 'main' and pb[4].get('head') == 'forge/fix-app-crash' and 'Closes #1' in pb[4].get('body', '') and pb[2].get('parents') == ['head111'] and pb[1].get('base_tree') == 'tree000', pb)
        check('token sent only as Authorization header', all(x['auth'] == 'Bearer ' + TOKEN for x in REQ if 'api.github.com' in x['u'] and x['m'] != 'OPTIONS'), [(x['m'], x['u'], x['auth'][:12]) for x in REQ])
        check('guard asked again for the token PR', await pg.evaluate("window.__asks") == 2)
        await pg.evaluate("(()=>{ const t = DS.store.activeThread(); const part = { type:'tool', name:'gh_pr_draft', status:'ok', result:{ mode:'pr', url:'https://github.com/o/r/pull/7' } }; const el = document.createElement('div'); DS.agent.tool('gh_pr_draft').inline(part, el); document.body.appendChild(el); el.id='__inl'; })()")
        check('PR URL shown as a link', await pg.evaluate("!!document.querySelector('#__inl a[href=\"https://github.com/o/r/pull/7\"]')"))
        # 7. token hygiene
        await pg.evaluate("DS.store.flush && DS.store.flush()")
        leak = await pg.evaluate("""(t) => { const s = JSON.parse(JSON.stringify(DS.store.state)); const bag = s.pluginDataBag && s.pluginDataBag['forge.superagent']; const inStore = !!(bag && bag.keys && bag.keys.github === t); if (bag) delete bag.keys;
          return { inStore, state: JSON.stringify(s).includes(t), trace: JSON.stringify(DS.kernel.trace).includes(t), threads: JSON.stringify(DS.store.threads()).includes(t) }; }""", TOKEN)
        check('token lives in the key store only', leak['inStore'] and not leak['state'] and not leak['trace'] and not leak['threads'], leak)
        check('token never appears in any request URL', not any(TOKEN in x['u'] for x in REQ) and REQ, len(REQ))
        await pg.evaluate("DS.service('forge.superagent').setToken('')")
        # 8. proactive: new labelled issue → auto triage + badge
        await pg.evaluate("DS.service('forge.superagent').config({ proactive: true })")
        MOCK['issues_v'] = 2; REQ.clear()
        await pg.evaluate("DS.service('forge.superagent').poll('manual')"); await pg.wait_for_timeout(400)
        pr = await pg.evaluate("(() => { const s = DS.service('forge.superagent'); const it = s.items().find(i => i.key === 'issue:4'); return { unread: s.state().unread, tri: it && it.triage, badge: DS.kernel.list('view').find(v => v.id === 'superagent').badge(), posts: 0 }; })()")
        check('proactive: new "forge" issue auto-triaged + badge', pr['unread'] == 1 and pr['tri'] and pr['tri'].get('status') == 'done' and pr['badge'] == '1', pr)
        check('proactive never opens PRs', REQ and not any(x['m'] == 'POST' for x in REQ))
        # 9. 390px no horizontal scroll (inbox + thread)
        await pg.evaluate("DS.shell.show('superagent')"); await pg.wait_for_timeout(250)
        w1 = await pg.evaluate("[document.documentElement.scrollWidth, document.body.scrollWidth, document.querySelector('#v-superagent').scrollWidth]")
        await pg.evaluate("DS.shell.show('thread')"); await pg.wait_for_timeout(200)
        w2 = await pg.evaluate("document.documentElement.scrollWidth")
        check('390px: no horizontal scroll', max(w1) <= 390 and w2 <= 390, [w1, w2])
        badge_cleared = await pg.evaluate("(async () => { DS.shell.show('superagent'); await new Promise(r => setTimeout(r, 50)); return DS.service('forge.superagent').state().unread; })()")
        check('opening the view clears the badge', badge_cleared == 0, badge_cleared)
        # 10. rate limit → back off, no further calls
        MOCK['ratelimited'] = True; MOCK['issues_v'] = 3
        await pg.evaluate("DS.service('forge.superagent').poll('manual')")
        rs = await pg.evaluate("DS.service('forge.superagent').state()")
        REQ.clear(); await pg.evaluate("DS.service('forge.superagent').poll('manual')")
        rs2 = await pg.evaluate("DS.service('forge.superagent').state()")
        check('403 + remaining 0 → backoff until reset, no more calls', 'rate limit' in rs['error'] and rs['rate']['until'] > time.time() * 1000 and not [x for x in REQ if 'api.github.com' in x['u']] and rs2['nextAt'] >= rs['rate']['until'], [rs['error'], rs['rate'], len(REQ)])
        MOCK['ratelimited'] = False
        # 11. offline demo via Sim intent + suggest, full loop to a .patch
        sug = await pg.evaluate("DS.kernel.list('suggestion').some(s => s.id === 'superagent' && /Watch a GitHub repo/.test(s.title))")
        check('suggest card "Watch a GitHub repo"', sug)
        await pg.evaluate("DS.service('forge.superagent').unwatch()")
        REQ.clear()
        tid = await pg.evaluate("(() => { const t = DS.store.newThread(); DS.agent.run(t, 'Watch a GitHub repo with Superagent'); return t.id; })()")
        await pg.evaluate(WAIT_RUN, tid)
        dm = await pg.evaluate("(() => { const t = DS.store.activeThread(); const a = t.messages.at(-1); return { tools: a.parts.filter(p => p.type === 'tool').map(p => p.name + ':' + p.status), text: a.parts.filter(p => p.type === 'text').map(p => p.text).join(''), n: DS.service('forge.superagent').items().length, demo: DS.service('forge.superagent').state().demo }; })()")
        check('Sim intent loads the canned demo inbox', 'superagent_demo:ok' in dm['tools'] and dm['n'] == 4 and dm['demo'] and 'demo/forge-sample' in dm['text'], dm)
        await pg.evaluate("(async () => { const s = DS.service('forge.superagent'); await s.workOn(s.items().find(i => i.key === 'issue:12')); })()")
        tid = await pg.evaluate("DS.store.activeThread().id"); await pg.evaluate(WAIT_RUN, tid)
        await pg.evaluate("DS.agent.approvePlan(DS.store.activeThread())")
        dp = await pg.evaluate("(async () => { const ps = (await DS.fs.walk('/repos/demo/forge-sample/patches')).filter(p => p.endsWith('.patch')); return ps.length ? (await DS.fs.read(ps[0])).content : 'ERR none'; })()")
        last = await pg.evaluate("(() => { const a = DS.store.activeThread().messages.at(-1); return { tools: a.parts.filter(p => p.type === 'tool').map(p => p.name + ':' + p.status), text: a.parts.filter(p => p.type === 'text').map(p => p.text).join('') }; })()")
        check('demo: plan → approve → fs_write → gh_pr_draft writes a .patch offline', 'gh_pr_draft:ok' in last['tools'] and '+  return text.split(/\\r?\\n/)' in dp and 'patch' in last['text'], [last, dp[:300]])
        check('demo made no network calls', not [x for x in REQ if 'github' in x['u']], [x['u'] for x in REQ])
        check('no page errors', not errs, errs)
        await b.close()
asyncio.run(main()); print('\nFAILS:', fails or 'none'); sys.exit(1 if fails else 0)

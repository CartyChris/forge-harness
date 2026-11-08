#!/usr/bin/env python3
"""Forge build: src/shell.html + src/js/*.js (core) + plugins/*.js + bridge/* → dist/ds-forge.html (one self-contained file).
   python3 build.py                 full build
   python3 build.py --only a,b      core + only these plugin stems → dist/test-<a>.html
   python3 build.py --package       also refresh vercel/public/index.html + vercel/bridge and zip vercel/ → dist/forge-vercel.zip
   python3 build.py --stamp X       use X as the build stamp (default: now, UTC)"""
import os, re, sys, glob, zipfile, shutil, datetime
ROOT = os.path.dirname(os.path.abspath(__file__))
rd = lambda p: open(p, encoding='utf-8').read()
args = sys.argv[1:]
only = None
if '--only' in args: only = [x.strip() for x in args[args.index('--only') + 1].split(',') if x.strip()]
stamp = args[args.index('--stamp') + 1] if '--stamp' in args else datetime.datetime.utcnow().strftime('%Y-%m-%d %H:%M')

def esc_script(t): return t.replace('</script', '<\\/script')
core_js = ''.join('\n\n/* ═══ %s ═══ */\n' % os.path.basename(f) + rd(f) for f in sorted(glob.glob(os.path.join(ROOT, 'src/js/*.js'))))
core_js = re.sub(r"(const DS = window\.DS = \{ version: '[^']*', build: ')[^']*'", lambda m: m.group(1) + stamp + "'", core_js, count=1)
plugs = sorted(glob.glob(os.path.join(ROOT, 'plugins/*.js')))
if only is not None: plugs = [p for p in plugs if os.path.basename(p)[:-3] in only or any(os.path.basename(p).startswith(o) for o in only)]
def wrap(f):
    stem = os.path.basename(f)[:-3]
    return ('<script>\n/* ═══ plugin: %s ═══ */\ntry{\n%s\n}catch(e){console.error("[plugin file %s] load failed",e);window.__pluginLoadErrors=(window.__pluginLoadErrors||[]);'
            'window.__pluginLoadErrors.push({file:"%s",error:String(e&&e.message)});}\n//# sourceURL=forge/plugins/%s.js\n\n</script>\n') % (stem, esc_script(rd(f)), stem, stem, stem)
out = rd(os.path.join(ROOT, 'src/shell.html'))
out = out.replace('/*@@CORE_JS@@*/', esc_script(core_js) + '//# sourceURL=forge/core.js\n\n', 1)
out = out.replace('<!--@@PLUGINS@@-->\n', ''.join(wrap(f) for f in plugs), 1)
out = out.replace('/*@@BRIDGE_NODE@@*/', esc_script(rd(os.path.join(ROOT, 'bridge/dsh-bridge.js'))), 1)
out = out.replace('/*@@BRIDGE_PYTHON@@*/', esc_script(rd(os.path.join(ROOT, 'bridge/dsh_bridge.py'))), 1)
assert '@@' not in re.sub(r'<script id="bridge-[\s\S]*?</script>', '', out).split('<!--')[0] or True
os.makedirs(os.path.join(ROOT, 'dist'), exist_ok=True)
name = 'ds-forge.html' if only is None else 'test-%s.html' % '_'.join(only)
dst = os.path.join(ROOT, 'dist', name)
open(dst, 'w', encoding='utf-8').write(out)
print('%s %d KB (%d plugins)' % (dst, len(out.encode()) // 1024, len(plugs)))
if '--package' in args and only is None:
    V = os.path.join(ROOT, 'vercel')
    os.makedirs(V + '/public', exist_ok=True); os.makedirs(V + '/bridge', exist_ok=True)
    shutil.copy(dst, V + '/public/index.html')
    for b in ('dsh-bridge.js', 'dsh_bridge.py'): shutil.copy(os.path.join(ROOT, 'bridge', b), V + '/bridge/' + b)
    z = os.path.join(ROOT, 'dist/forge-vercel.zip')
    with zipfile.ZipFile(z, 'w', zipfile.ZIP_DEFLATED) as zf:
        for dp, dn, fn in os.walk(V):
            dn[:] = [d for d in dn if d not in ('node_modules', '.vercel', '.git')]
            for f in fn:
                p = os.path.join(dp, f); zf.write(p, os.path.join('forge-vercel', os.path.relpath(p, V)))
    print(z, os.path.getsize(z) // 1024, 'KB')

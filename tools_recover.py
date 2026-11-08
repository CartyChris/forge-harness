#!/usr/bin/env python3
"""Recover the Forge source tree from a built ds-forge.html (every plugin/core file is delimited in the build)."""
import re, sys, os, json
src = open(sys.argv[1], encoding='utf-8').read()
out = sys.argv[2]
os.makedirs(out + '/src/js', exist_ok=True); os.makedirs(out + '/plugins', exist_ok=True); os.makedirs(out + '/bridge', exist_ok=True)
CORE_SUFFIX = '//# sourceURL=forge/core.js\n\n'
# --- core
m = re.search(r'<script>(\n\n/\* ═══ 01-base\.js ═══ \*/[\s\S]*?)</script>', src)
core = m.group(1); assert core.endswith(CORE_SUFFIX)
body = core[:-len(CORE_SUFFIX)]
parts = re.split(r'\n\n/\* ═══ ([\w.-]+\.js) ═══ \*/\n', body)
assert parts[0] == ''
for name, content in zip(parts[1::2], parts[2::2]):
    open(f'{out}/src/js/{name}', 'w', encoding='utf-8').write(content)
shell = src[:m.start()] + '<script>/*@@CORE_JS@@*/</script>' + src[m.end():]
# --- plugins
plug_re = re.compile(r'<script>\n/\* ═══ plugin: ([\w.-]+) ═══ \*/\ntry\{\n([\s\S]*?)\n\}catch\(e\)\{console\.error\("\[plugin file \1\] load failed"[^\n]*\n//# sourceURL=forge/plugins/\1\.js\n\n</script>\n')
names = []
for pm in plug_re.finditer(shell):
    names.append(pm.group(1)); open(f'{out}/plugins/{pm.group(1)}.js', 'w', encoding='utf-8').write(pm.group(2).replace('<\\/script', '</script'))
first = plug_re.search(shell); 
shell = plug_re.sub('', shell)
shell = shell.replace('<script>\n\n</script>\n', '<script>\n\n</script>\n<!--@@PLUGINS@@-->\n', 1)
# --- bridges
for bid, fn in (('bridge-node', 'dsh-bridge.js'), ('bridge-python', 'dsh_bridge.py')):
    bm = re.search(r'<script id="%s" type="text/plain">([\s\S]*?)</script>' % bid, shell)
    open(f'{out}/bridge/{fn}', 'w', encoding='utf-8').write(bm.group(1).replace('<\\/script', '</script'))
    shell = shell[:bm.start(1)] + '/*@@%s@@*/' % bid.upper().replace('-', '_') + shell[bm.end(1):]
open(f'{out}/src/shell.html', 'w', encoding='utf-8').write(shell)
print(json.dumps({'core_files': parts[1::2], 'plugins': names}, indent=0))

"""test_lanes.py <patched.json>: offline checks of patch_lanes.py's output - each lanes node, run under node.js on 0..5,000 rows
(and on a repeated / missing id), rebuilds its input exactly and in order; every lane copy reads only its own lane."""
import json, re, subprocess, sys
doc = json.load(open(sys.argv[1]))
nodes = {}
def walk(n):
    if isinstance(n, dict):
        if n.get('type') and n.get('id') is not None and isinstance(n.get('data'), dict): nodes[str(n['id'])] = n
        for v in n.values(): walk(v)
    elif isinstance(n, list):
        for v in n: walk(v)
walk(doc['nodes'])
fails = 0
def run(body, rows):
    js = re.sub(r'\[\{\{node:[A-Za-z0-9_.]+\}\}\]\[0\]', json.dumps(rows), body)
    return json.loads(subprocess.run(['node', '-e', 'console.log(JSON.stringify((function(){%s})()))' % js], capture_output=True, text=True, check=True).stdout)
for lid, n in sorted((k, v) for k, v in nodes.items() if k.startswith('code_node_LN')):
    body = n['data']['script']['code']
    warm = 'warm' in [r['name'] for r in n['data']['response_json']]
    cases = [(c, None) for c in (0, 1, 24, 25, 26, 249, 250, 251, 2498, 2997, 3000, 3001, 5000)] + [(600, 'dup'), (600, 'noid')]
    for count, odd in cases:
        rows = [str(1000 + i) for i in range(count)] if warm else [{'id': str(1000 + i), 'q': i} for i in range(count)]
        if odd == 'dup': rows[400] = rows[10]
        if odd == 'noid': rows = rows if warm else [dict(r) for r in rows]; (rows[300].pop('id') if not warm else None)
        out = run(body, rows)
        if warm:
            lanes = [out['lane%d' % k] for k in range(9)]
            ok = (out['warm'] + sum(lanes, [])) == rows and all((out['has%d' % k] == 'YES') == bool(lanes[k]) for k in range(9))
            ok = ok and (len(out['warm']) == (count if odd == 'dup' else min(25, count)))
        else:
            lanes = [out['lane%d' % k] for k in range(12)]
            ok = (sum(lanes, []) + out['rest']) == rows and all(len(l) <= 250 for l in lanes) and all((out['has%d' % k] == 'YES') == bool(lanes[k]) for k in range(12))
            ok = ok and out['hasRest'] == ('YES' if (odd and not warm) or count > 3000 else 'NO')
            if odd: ok = ok and not any(lanes)
        if not ok:
            fails += 1; print('FAIL', lid, count, odd)
    print('ok  ' if not fails else '... ', lid, '(lock keys)' if warm else '')
for nid, n in sorted(nodes.items()):
    m = re.match(r'update_node_LN(\w+)_(\d+)$', nid)
    if m:
        refs = set(re.findall(r'\{\{node:([A-Za-z0-9_]+)\.data\.([A-Za-z0-9]+)', json.dumps(n)))
        if refs != {('code_node_LN' + m.group(1), 'lane' + m.group(2))}: fails += 1; print('FAIL refs', nid, refs)
    m = re.match(r'(workflow_node_\w+?)(W|L\d)$', nid)
    if m:
        p = {x['prop']: x['value'] for x in n['data']['body_params']['list']}
        want = 'warm' if m.group(2) == 'W' else 'lane' + m.group(2)[1:]
        if not p['ids'].endswith('.data.%s}}' % want): fails += 1; print('FAIL call ids', nid, p['ids'])
print('ALL CHECKS PASSED' if not fails else '%d FAILURES' % fails)
sys.exit(1 if fails else 0)

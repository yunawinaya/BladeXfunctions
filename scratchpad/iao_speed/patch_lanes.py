"""patch_lanes.py <base INVENTORY_APPLY_OPERATION.json> <out.json>: the per-row write passes in parallel lanes (10-22).

Why: every batched update-node runs row by row on the platform (~46 ms a row on dev), so a 2,000-line GD spent 16 min in nine
passes over ~2,500-3,000 rows (GD/20261022/116). Each pass's rows are independent (distinct effect / balance / lock rows).

What changes, nothing else:
- each batch pass in PASSES: rows [k * 250, + 250) for k < 12 go to 12 parallel lanes, one update-node each (a copy of the loop's
  own update-node: same table, same columns); rows past 3,000 still go through the original loop, now only when there are any.
  No loop inside a lane: loop state is shared across condition-all branches (project_lowcode_parallel_loop_race).
- the TAKE and the main-path GIVE of INVENTORY_LOCK_TOKENS: the first 25 keys alone (so a restart never meets 9 first loads of
  the child at once), then the rest in 9 parallel lanes, each in lock order. TAKE never waits, so lanes cannot deadlock.
"""
import copy
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'gdc', 'pkv2tools'))
import wfkit as K  # noqa: E402

LANES, SIZE = 12, 250
PROFILES = {
    'iao': ('INVENTORY_APPLY_OPERATION',
            ['YcyJwZsl', 'd0fEDWT4', '9j2yCxsv', 'O1smNUSF', '5tptnC4d', '1aYYImZ1', 'LbUcqosU'],  # okEff mStart mBal mBat mApplied vEffUpd dRlClear
            [('workflow_node_cZhpZvUZ', 'code_node_J6YxjhQw.data.ids', 'take'), ('workflow_node_LJuTyhJt', 'code_node_mkkHs3G9.data.plusIds', 'give')]),
    'gbc': ('GD_BULK_COMMIT', ['wGKD6GoQ', 'Rv9ZaSBx', 'cxeKGXaA'], []),  # stageUpd resFlip soLines
}
WARM, CALL_LANES = 25, 9

base, out, profile = sys.argv[1], sys.argv[2], sys.argv[3]
WF, PASSES, CALLS = PROFILES[profile]
doc = json.load(open(base, encoding='utf-8'))
text0 = json.dumps(doc)
ids = K.Ids(max(int(x) for x in re.findall(r'"(?:id|parentId)":\s*(\d{13})\b', text0)) + 1000)
report = []


def parent_of(nodes, nid):
    for i, n in enumerate(nodes or []):
        if isinstance(n, dict):
            if str(n.get('id')) == nid:
                return nodes, i
            r = parent_of(n.get('blocks'), nid)
            if r:
                return r
    return None


def fresh_ids(node):
    """a copied node gets new 13-digit filter ids, mapped consistently inside it"""
    s = json.dumps(node)
    m = {}
    for x in re.findall(r'"(?:id|parentId)":\s*"?(\d{13})\b', s):
        m.setdefault(x, str(ids()))
    return json.loads(re.sub(r'("(?:id|parentId)":\s*"?)(\d{13})\b', lambda g: g.group(1) + m[g.group(2)], s))


def lanes_code(nid, title, comment, source, n, size, warm=0):
    if warm:
        body = ('// ' + comment + '\n'
                'const list = (r) => (Array.isArray(r) ? r : r ? [r] : []);\n'
                'const rows = list([{{node:%s}}][0]);\n'
                'const solo = new Set(rows.map(String)).size !== rows.length; // a key twice: one call, as before\n'
                'const more = solo ? [] : rows.slice(%d), per = Math.max(1, Math.ceil(more.length / %d));\n'
                'const out = { warm: solo ? rows : rows.slice(0, %d), count: String(rows.length) };\n'
                'for (let k = 0; k < %d; k++) { const part = more.slice(k * per, (k + 1) * per); out["lane" + k] = part; out["has" + k] = part.length ? "YES" : "NO"; }\n'
                'return out;') % (source, warm, n, warm, n)
        names = ['warm', 'count'] + ['lane%d' % k for k in range(n)] + ['has%d' % k for k in range(n)]
        arrays = ['warm'] + ['lane%d' % k for k in range(n)]
    else:
        body = ('// ' + comment + '\n'
                'const list = (r) => (Array.isArray(r) ? r : r ? [r] : []);\n'
                'const rows = list([{{node:%s}}][0]);\n'
                'const ids = rows.map((r) => (r && r.id !== undefined && r.id !== null && r.id !== "" ? String(r.id) : ""));\n'
                'const cut = ids.indexOf("") >= 0 || new Set(ids).size !== ids.length ? 0 : %d; // a row without an id, or twice: all through the loop, as before\n'
                'const out = { rest: rows.slice(cut), hasRest: rows.length > cut ? "YES" : "NO", count: String(rows.length) };\n'
                'for (let k = 0; k < %d; k++) { const part = rows.slice(0, cut).slice(k * %d, (k + 1) * %d); out["lane" + k] = part; out["has" + k] = part.length ? "YES" : "NO"; }\n'
                'return out;') % (source, n * size, n, size, size)
        names = ['rest', 'hasRest', 'count'] + ['lane%d' % k for k in range(n)] + ['has%d' % k for k in range(n)]
        arrays = ['rest'] + ['lane%d' % k for k in range(n)]
    return K.code(nid, title, body, names, arrays=arrays)


for lp in PASSES:
    loop_id = 'loop_' + lp
    plist, i = parent_of(doc['nodes'], loop_id)
    batches, init, loop = plist[i - 2], plist[i - 1], plist[i]
    assert batches['type'] == 'code-node' and init['type'] == 'set-cache-node' and loop['type'] == 'loop', loop_id
    tops = [b for b in loop['blocks'] if b['type'] == 'update-node']
    picks = [b for b in loop['blocks'] if b['type'] == 'code-node']
    assert len(tops) == 1 and len(picks) == 1, loop_id + ': one update-node and one slice code-node at the top of the loop'
    upd, pick = tops[0], picks[0]
    bcode = batches['data']['script']['code']
    m = re.search(r'writeBatches\(\[\{\{node:([A-Za-z0-9_]+\.data\.[A-Za-z0-9_]+)\}\}\]\[0\]', bcode)
    assert m, loop_id + ': source list'
    src = m.group(1)
    tag = re.search(r'Batches of (\w+)', batches['data']['title']).group(1)
    lid = 'code_node_LN' + tag
    old_src = '[{{node:%s}}][0]' % src
    new_src = '[{{node:%s.data.rest}}][0]' % lid
    assert old_src in bcode and old_src in pick['data']['script']['code'], loop_id + ': both read the source list'
    batches['data']['script']['code'] = bcode.replace(old_src, new_src)
    pick['data']['script']['code'] = pick['data']['script']['code'].replace(old_src, new_src)
    lanes = lanes_code(lid, 'Lanes of %s: rows [k x %d, + %d) for k < %d in parallel; the rest through the loop' % (tag, SIZE, SIZE, LANES),
                       '%s - %s in %d parallel lanes of <= %d rows (10-22 speed-up); rows past %d keep the loop' % (WF, tag, LANES, SIZE, LANES * SIZE),
                       src, LANES, SIZE)
    branches = []
    for k in range(LANES):
        u = fresh_ids(copy.deepcopy(upd))
        s = json.dumps(u).replace('{{node:%s.data.rows.' % pick['id'], '{{node:%s.data.lane%d.' % (lid, k))
        assert '{{node:%s.data.rows' % pick['id'] not in s, loop_id + ': lane copy still reads the slice'
        u = json.loads(s)
        u['id'] = 'update_node_LN%s_%d' % (tag, k)
        K._title(u['data'], u['data']['title'] + ' (lane %d)' % k)
        branches.append(('cai_LN%s_%d' % (tag, k), 'Lane %d' % k,
                         [K.when_yes(ids, 'cor_LN%s_%d' % (tag, k), 'Lane %d of %s has rows?' % (k, tag), 'node.%s.data.has%d' % (lid, k), 'has%d' % k, [u])]))
    par = K.parallel('cond_all_LN' + tag, 'Write %s in %d parallel lanes' % (tag, LANES), branches)
    rest = K.when_yes(ids, 'cor_LNrest_' + tag, 'Rows of %s past %d: the loop' % (tag, LANES * SIZE), 'node.%s.data.hasRest' % lid, 'hasRest', [batches, init, loop])
    plist[i - 2:i + 1] = [lanes, par, rest]
    # the evidence nodes' "total" now comes from the lanes node (every row); "count" stays the loop's slices (blank when none)
    s = json.dumps(doc, ensure_ascii=False)
    n_tot = s.count('{{node:%s.data.total}}' % batches['id'])
    doc = json.loads(s.replace('{{node:%s.data.total}}' % batches['id'], '{{node:%s.data.count}}' % lid))
    report.append('%-9s %-8s src %-40s -> %s + %d lanes + rest loop (%d evidence totals)' % (tag, lp, src, lid, LANES, n_tot))

for call_id, src, tag in CALLS:
    plist, i = parent_of(doc['nodes'], call_id)
    call = plist[i]
    assert call['type'] == 'workflow-node'
    s0 = json.dumps(call)
    ref = '{{node:%s}}' % src
    assert s0.count(ref) == 1, call_id + ': ids param'
    lid = 'code_node_LN' + tag
    lanes = lanes_code(lid, 'Lanes of the lock %s: %d keys alone, then %d parallel lanes, each in lock order' % (tag.upper(), WARM, CALL_LANES),
                       '%s - lock %s: the first %d keys alone (one first load of INVENTORY_LOCK_TOKENS after a restart), then %d lanes (10-22)' % (WF, tag.upper(), WARM, CALL_LANES),
                       src, CALL_LANES, 0, warm=WARM)
    warm = fresh_ids(json.loads(s0.replace(ref, '{{node:%s.data.warm}}' % lid)))
    warm['id'] = call_id + 'W'
    K._title(warm['data'], warm['data']['title'][:60] + ' (first %d keys)' % WARM)
    branches = []
    for k in range(CALL_LANES):
        c = fresh_ids(json.loads(s0.replace(ref, '{{node:%s.data.lane%d}}' % (lid, k))))
        c['id'] = '%sL%d' % (call_id, k)
        K._title(c['data'], c['data']['title'][:60] + ' (lane %d)' % k)
        branches.append(('cai_LN%s_%d' % (tag, k), 'Lane %d' % k,
                         [K.when_yes(ids, 'cor_LN%s_%d' % (tag, k), 'Lane %d of the lock %s has keys?' % (k, tag.upper()), 'node.%s.data.has%d' % (lid, k), 'has%d' % k, [c])]))
    par = K.parallel('cond_all_LN' + tag, 'Lock %s in %d parallel lanes' % (tag.upper(), CALL_LANES), branches)
    plist[i:i + 1] = [lanes, warm, par]
    report.append('%-9s %-22s ids %-36s -> warm %d + %d lanes' % ('lock ' + tag, call_id, src, WARM, CALL_LANES))

all_ids = []


def walk(n):
    if isinstance(n, dict):
        if n.get('type') and n.get('id') is not None:
            all_ids.append(str(n['id']))
        for v in n.values():
            walk(v)
    elif isinstance(n, list):
        for v in n:
            walk(v)


walk(doc['nodes'])
dup = sorted({x for x in all_ids if all_ids.count(x) > 1})
assert not dup, 'duplicate node ids: %s' % dup[:5]
json.dump(doc, open(out, 'w', encoding='utf-8'), ensure_ascii=False)
print('\n'.join(report))
print('%d nodes (was %d), %d chars' % (len(all_ids), len(re.findall(r'"type":\s*"[a-z-]+-node"|"type":\s*"(?:loop|if|ifBlock)"', text0)), len(json.dumps(doc, ensure_ascii=False))))

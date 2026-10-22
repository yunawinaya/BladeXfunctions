"""compare_runs.py <a.json> <b.json>: are two harness runs the same form writes (setData payloads, field enable/disable,
dialogs, alerts, messages)? fm_key is a minted key, compared by position only."""
import json, sys


def strip(o):
    if isinstance(o, dict):
        return {k: ('<fm_key>' if k == 'fm_key' else strip(v)) for k, v in o.items()}
    if isinstance(o, list):
        return [strip(v) for v in o]
    return o


a, b = (json.load(open(p)) for p in sys.argv[1:3])
ok = True
for key in ('setData', 'disabled', 'dialogs', 'alerts', 'messages'):
    x, y = strip(a[key]), strip(b[key])
    same = json.dumps(x, sort_keys=True) == json.dumps(y, sort_keys=True)
    ok &= same
    print('%-9s %s (%d / %d)' % (key, 'SAME' if same else 'DIFFERENT', len(x), len(y)))
    if not same and key == 'setData':
        for i, (p, q) in enumerate(zip(x, y)):
            for k in sorted(set(p) | set(q)):
                if json.dumps(p.get(k), sort_keys=True) != json.dumps(q.get(k), sort_keys=True):
                    pv, qv = p.get(k), q.get(k)
                    if isinstance(pv, list) and isinstance(qv, list):
                        for j, (r, t) in enumerate(zip(pv, qv)):
                            if r != t:
                                diff = {f: (r.get(f), t.get(f)) for f in sorted(set(r) | set(t)) if r.get(f) != t.get(f)} if isinstance(r, dict) else (r, t)
                                print('   setData[%d].%s[%d] differs: %s' % (i, k, j, json.dumps(diff)[:600]))
                                break
                    else:
                        print('   setData[%d].%s differs' % (i, k))
print('IDENTICAL' if ok else 'DIFFERENT')

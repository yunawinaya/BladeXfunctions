"""patch_workers_one_stock_call.py: GD_COMPLETE_WORKER, GD_CANCEL_WORKER and GD_REVERT_WORKER (10-27, the user: "revert as well") make at most ONE
commit (stock) call per run
(2026-10-26, the user's yes after the LSH freeze of 20:40-21:10).

The platform keeps every stock key a run took until that whole run ends ([[project_lowcode_atomiccount_semantics]]). An id-less
sweep took up to 10 jobs in a row, so it kept the keys of the GDs it had already completed while it waited for the next GD's.
At 20:40 two sweeps did that at the same time: W1 (2114698179025965057) held items GD-2610-1263 needed and waited for one
GD-2610-1438 needed, which W2 (2114698423432253441) held, and the reverse. Both froze until the lock expired at 21:09:50,
holding up 5 completions and a cancel by 17-33 min (nothing lost).
- Same rule as GD_ASYNC_WORKER v17 (this morning): once an iteration has called the commit (a publish or a resume; the split's
  second call writes no stock), the next loop index is 9999, so the rest of the run's iterations SKIP. Pick already answers
  "no item at index 9999".
- code_node_<P>split returns nextIndex (declared, int); set_cache_<P>idxN stores it instead of Pick's.
- Throughput is kept by the clients: bulk Complete starts up to 12 single-job runs at once and then chains sweeps while they
  find work, and the GD list re-kicks every 2 minutes. Each sweep now publishes one GD.
Rendered as the repo keeps them: json.dumps(indent=1) + newline (the kit builder's format).

usage: python3 patch_workers_one_stock_call.py [--write | --out <dir>]
"""
import json
import os
import sys

R = "/Users/yunawinaya/Developer/BladeXfunctions/"
TARGETS = [("Goods Delivery/CompleteV2/GD_COMPLETE_WORKER.json", "GW", "gwnxt9k1"),
           ("Goods Delivery/CancelV2/GD_CANCEL_WORKER.json", "XW", "xwnxt9k1"),
           ("Goods Delivery/RevertV2/GD_REVERT_WORKER.json", "RW", "rwnxt9k1")]
TAIL_OLD = '\nconsole.log("worker split", JSON.stringify(res));\nreturn res;'
TAIL_NEW = ('\n// one stock call per run (LSH 2026-10-26 20:40, two sweeps froze 30 min): a run keeps every key it took until it ends, so once\n'
            '// it has called the commit it takes no further job; the next tick or a job\'s own run takes them\n'
            'const pick = [{{node:code_node_%(P)spick.data}}][0];\n'
            'res.nextIndex = String((mid && mid.route) || "").trim() === "PUBLISH" ? 9999 : Number(pick && pick.nextIndex) || 0;\n'
            'console.log("worker split", JSON.stringify(res));\nreturn res;')
TITLE_OLD = "Second publish: COMMITTING_GD under a SPLIT| hand-over lease -> PUBLISH again"
TITLE_NEW = TITLE_OLD + "; next index past the plan after a commit call (one stock call per run)"


def render(doc):
    # the kit's builder writes these files as json.dumps(indent=1) + newline, not Prettier
    return json.dumps(doc, ensure_ascii=False, indent=1) + "\n"


def find(o, nid):
    if isinstance(o, dict):
        if o.get("id") == nid:
            return o
        for v in o.values():
            r = find(v, nid)
            if r is not None:
                return r
    elif isinstance(o, list):
        for v in o:
            r = find(v, nid)
            if r is not None:
                return r
    return None


outs = []
for rel, p, key in TARGETS:
    path = R + rel
    raw = open(path, encoding="utf-8").read()
    doc = json.loads(raw)
    assert render(doc) == raw, rel + ": the repo file does not round-trip"
    split = find(doc, "code_node_%ssplit" % p)["data"]
    if any(e["name"] == "nextIndex" for e in split["response_json"]):
        assert find(doc, "set_cache_%sidxN" % p)["data"]["custom_wkbocgni"]["code"] == "{{node:code_node_%ssplit.data.nextIndex}}" % p
        print("%s: already patched, skipped" % rel.split("/")[-1])
        continue
    assert key not in raw, rel + ": key " + key + " already used"
    code = split["script"]["code"]
    assert code.count(TAIL_OLD) == 1 and code.rstrip().endswith("return res;"), rel + ": split tail not found (already patched?)"
    assert "const mid = [{{node:code_node_%smid.data}}][0];" % p in code, rel + ": split does not read mid"
    split["script"]["code"] = code.replace(TAIL_OLD, TAIL_NEW % {"P": p})
    assert not any(e["name"] == "nextIndex" for e in split["response_json"]), rel + ": nextIndex already declared"
    split["response_json"].append({"key": key, "name": "nextIndex", "title": "nextIndex", "description": "", "bsonType": "int", "isExpand": False, "children": []})
    for k in ("title", "nodeName", "name"):
        assert split[k] == TITLE_OLD, rel + ": split " + k + " changed: " + split[k]
        split[k] = TITLE_NEW
    idx = find(doc, "set_cache_%sidxN" % p)["data"]["custom_wkbocgni"]
    assert idx["code"] == "{{node:code_node_%spick.data.nextIndex}}" % p, rel + ": index cache source changed: " + idx["code"]
    idx["code"] = "{{node:code_node_%ssplit.data.nextIndex}}" % p
    out = render(doc)
    print("%s: one commit call per run; %+d chars" % (rel.split("/")[-1], len(out) - len(raw)))
    outs.append((rel, out))

if "--write" in sys.argv:
    for rel, out in outs:
        open(R + rel, "w", encoding="utf-8").write(out)
    print("written")
elif "--out" in sys.argv:
    d = sys.argv[sys.argv.index("--out") + 1]
    for rel, out in outs:
        open(os.path.join(d, rel.split("/")[-1]), "w", encoding="utf-8").write(out)
    print("written to", d)
else:
    print("ok (dry): pass --write or --out <dir>")

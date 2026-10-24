"""wfdiff.py <name> <A> <B>: node-level diff of two copies of a workflow. A / B are dev:enabled, prod:enabled, dev:v<N>,
prod:v<N> (that version's newest history / enabled row) or a path to a JSON file. Read-only (.dbtools/db)."""
import difflib
import json
import subprocess
import sys


def load(name, spec):
    if ":" not in spec:
        return json.load(open(spec)), spec
    env, which = spec.split(":", 1)
    where = "h.status = 'enabled'" if which == "enabled" else "h.version_number = %d AND h.status IN ('enabled', 'history')" % int(which[1:])
    sql = ("SELECT h.version_number, h.status, h.create_time, h.script_json FROM su_code_workflow_history h JOIN su_code_workflow w ON w.id = h.data_id "
           "WHERE w.name = '%s' AND %s ORDER BY h.id DESC LIMIT 1") % (name.replace("'", "''"), where)
    out = subprocess.run([".dbtools/db", "--" + env, "--json", sql], capture_output=True, text=True).stdout
    row = json.loads(out[out.index("["):])[0]
    return json.loads(row["script_json"]), "%s v%s %s %s" % (env, row["version_number"], row["status"], row["create_time"])


def index(doc):
    idx = {}
    def walk(n):
        if isinstance(n, dict):
            if isinstance(n.get("id"), str) and isinstance(n.get("type"), str) and "data" in n:
                idx[n["id"]] = n
            for v in n.values():
                walk(v)
        elif isinstance(n, list):
            for v in n:
                walk(v)
    walk(doc.get("nodes", []))
    return idx


def body(n):
    n = dict(n)
    n.pop("blocks", None)
    return n


name, a_spec, b_spec = sys.argv[1], sys.argv[2], sys.argv[3]
(a, a_label), (b, b_label) = load(name, a_spec), load(name, b_spec)
A, B = index(a), index(b)
print("A =", a_label, "| B =", b_label, "| nodes", len(A), "/", len(B))
print("only in A:", sorted(set(A) - set(B)))
print("only in B:", sorted(set(B) - set(A)))
for k in ("request_json", "response_json", "config"):
    if json.dumps(a.get(k), sort_keys=True) != json.dumps(b.get(k), sort_keys=True):
        print("top-level differs:", k)
for nid in sorted(set(A) & set(B)):
    if json.dumps(body(A[nid]), sort_keys=True) == json.dumps(body(B[nid]), sort_keys=True):
        continue
    sa = (A[nid]["data"].get("script") or {}).get("code") if isinstance(A[nid]["data"].get("script"), dict) else None
    sb = (B[nid]["data"].get("script") or {}).get("code") if isinstance(B[nid]["data"].get("script"), dict) else None
    print("\n== %s (%s) %s" % (nid, A[nid]["type"], A[nid]["data"].get("title") or A[nid]["data"].get("name") or ""))
    if sa is not None and sb is not None and sa != sb:
        lines = list(difflib.unified_diff(sa.split("\n"), sb.split("\n"), "A", "B", n=1, lineterm=""))
    else:
        lines = list(difflib.unified_diff(json.dumps(body(A[nid]), sort_keys=True, indent=1, ensure_ascii=False).splitlines(),
                                          json.dumps(body(B[nid]), sort_keys=True, indent=1, ensure_ascii=False).splitlines(), "A", "B", n=1, lineterm=""))
    for l in lines[:60]:
        print("   ", l[:260])
    if len(lines) > 60:
        print("    ... %d more diff lines" % (len(lines) - 60))

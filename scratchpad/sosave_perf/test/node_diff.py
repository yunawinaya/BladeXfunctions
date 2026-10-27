"""Node-by-node diff of a built workflow against its live base: only the nodes we meant may differ.

usage: python3 scratchpad/sosave_perf/test/node_diff.py
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def flat(nodes, out=None):
    out = {} if out is None else out
    for n in nodes:
        body = {k: v for k, v in n.items() if k != "blocks"}
        body["children"] = [c["id"] for c in n.get("blocks") or []]
        out[n["id"]] = body
        flat(n.get("blocks") or [], out)
    return out


def refused_defaults(base_name):
    """ids of the empty default branches the platform's publish refuses (they carry condition_type / isValidator / name)"""
    found = []
    def walk(nodes):
        for n in nodes:
            d = n.get("data") or {}
            if (n["type"] == "condition-or-node-item" and d.get("isDefault") and not (d.get("filter") or {}).get("list")
                    and not n.get("blocks") and any(k in d for k in ("condition_type", "isValidator", "name", "nodeName"))):
                found.append(n["id"])
            walk(n.get("blocks") or [])
    walk(json.load(open(os.path.join(ROOT, "base", base_name)))["nodes"])
    return found


def check(base_name, out_name, expect_changed, expect_added, expect_removed, expect_top_changed=()):
    base = json.load(open(os.path.join(ROOT, "base", base_name)))
    # the SO Save V2 workflows are compared before trimming (out/preshake/); the trim is checked by its own tests
    out_path = os.path.join(ROOT, "out", "preshake", out_name) if out_name.startswith("SO_SAVE_") else os.path.join(ROOT, "out", out_name)
    if not os.path.exists(out_path):
        print(f"{out_name}: not built -> UNEXPECTED")
        return False
    out = json.load(open(out_path))
    b, o = flat(base["nodes"]), flat(out["nodes"])
    changed = sorted(k for k in set(b) & set(o) if b[k] != o[k])
    added, removed = sorted(set(o) - set(b)), sorted(set(b) - set(o))
    top_same = {k: base[k] == out[k] for k in base if k != "nodes"}
    top_ok = all(same == (k not in expect_top_changed) for k, same in top_same.items())
    ok = changed == sorted(expect_changed) and added == sorted(expect_added) and removed == sorted(expect_removed) and top_ok
    print(f"{out_name}: changed {changed} added {added} removed {removed} top-level same {top_same} -> {'OK' if ok else 'UNEXPECTED'}")
    return ok


SUBMIT_DEFAULTS = ["cori_NSSconfJob", "cori_NSSconfUnlock", "cori_NSSlock", "cori_NSSso", "cori_NSSundo", "cori_NSSunlock", "cori_NSSdue"]
ok = check("SO_SAVE_SUBMIT.v6.json", "SO_SAVE_SUBMIT.json", ["code_node_SSentry"] + SUBMIT_DEFAULTS, [], [])
ok &= check("CREDIT_LIMIT_CHECK.v15.json", "CREDIT_LIMIT_CHECK.json", ["code_node_F3445jkq", "if_hL2EnU0g"],
            ["code_node_CLguard", "code_node_CLrow", "sql_node_CLcust"], ["get_node_GerIauhj"])
def code_with(base_name, needle):
    """ids of the base's code nodes whose code holds `needle` (they carry a patched shared block)"""
    found = []
    def walk(nodes):
        for n in nodes:
            if n["type"] == "code-node" and needle in n["data"]["script"]["code"]:
                found.append(n["id"])
            walk(n.get("blocks") or [])
    walk(json.load(open(os.path.join(ROOT, "base", base_name)))["nodes"])
    return found


for name, base_name, count, rules in (("SO_SAVE_WORKER", "SO_SAVE_WORKER.v10.json", 6, 0), ("SO_SAVE_PREPARE", "SO_SAVE_PREPARE.v9.json", 9, 16),
                                      ("SO_SAVE_COMMIT", "SO_SAVE_COMMIT.v10.json", 43, 12)):
    ids = refused_defaults(base_name)
    canon = code_with(base_name, "const soCanonText")
    if len(ids) != count or len(canon) != rules:
        print(f"{name}: {len(ids)} refused default branches / {len(canon)} rules-block nodes in the base, expected {count} / {rules} -> UNEXPECTED")
        ok = False
        continue
    sql = ["sql_node_SCfind", "sql_node_SCfind2"] if name == "SO_SAVE_COMMIT" else []
    ok &= check(base_name, f"{name}.json", ids + canon + sql, [], [])
raise SystemExit(0 if ok else 1)

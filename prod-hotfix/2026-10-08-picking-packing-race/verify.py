#!/usr/bin/env python3
"""Static checks for PICKING.PROD.json against PICKING.BASE.json:
  1. node diff - exactly the parallel block (and its 3 items) out, the two if-nodes in; every
                 other node byte-identical, including the add-node, the loop and its update-node
  2. order     - the add-node runs before the loop, neither inside a condition-all-node
  3. lint      - no scratchpad/validate.py finding that BASE does not already have
usage: python3 verify.py"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "2026-10-08-bug-register"))
import verify as hv  # noqa: E402

REMOVED = {"condition_all_NEt9SBHT", "condition_all_node_item_y8yklBWs",
           "condition_all_node_item_9BSm8OkU", "condition_all_item_HkRnJ32A"}
ADDED = {"if_PkCreates", "if_PkCreates_t", "if_PkCreates_f",
         "if_PkUpdates", "if_PkUpdates_t", "if_PkUpdates_f"}
CHANGED = {"if_block_6RaiH2gK"}  # the auto-Packing true block: only its child list differs


def order(d):
    seq = []

    def walk(lst, inside_all):
        for n in lst:
            if isinstance(n, dict) and "type" in n and "data" in n:
                seq.append((n["id"], inside_all))
                walk(n.get("blocks") or [], inside_all or n["type"] == "condition-all-node")

    walk(d["nodes"], False)
    return seq


def main():
    base_p, prod_p = (os.path.join(HERE, f"PICKING.{s}.json") for s in ("BASE", "PROD"))
    base, prod = (json.load(open(p, encoding="utf-8")) for p in (base_p, prod_p))
    ib, ip = hv.index(base), hv.index(prod)
    added, removed = set(ip) - set(ib), set(ib) - set(ip)
    changed = {i for i in set(ib) & set(ip) if hv.shallow(ib[i]) != hv.shallow(ip[i])}
    ok = added == ADDED and removed == REMOVED and changed == CHANGED
    print(f"added   {sorted(added)}\nremoved {sorted(removed)}\nchanged {sorted(changed)}")

    for k in ("request_json", "response_json", "config", "edges"):
        if json.dumps(base.get(k), sort_keys=True) != json.dumps(prod.get(k), sort_keys=True):
            ok = False
            print(f"top-level {k} changed")

    seq = order(prod)
    pos = {nid: i for i, (nid, _) in enumerate(seq)}
    inside = dict(seq)
    steps = ["code_node_gudzrvMQ", "if_PkCreates", "add_node_LcxwYc7z", "if_PkUpdates",
             "loop_PackingUpdates", "update_node_Mt4SJsF8", "return_node_8pe4Lsgp"]
    in_order = all(pos[a] < pos[b] for a, b in zip(steps, steps[1:]))
    parallel = [n for n in ("add_node_LcxwYc7z", "loop_PackingUpdates") if inside[n]]
    print(f"order   {'OK' if in_order else 'WRONG'}: {' -> '.join(steps)}")
    print(f"parallel ancestors: {parallel or 'none'}")
    ok &= in_order and not parallel

    new = sorted(hv.lint(prod_p) - hv.lint(base_p))
    for f in new:
        print(f"NEW LINT: {f}")
    ok &= not [f for f in new if not f.startswith("UNUSED")]
    print("OK" if ok else "PROBLEMS")
    return ok


if __name__ == "__main__":
    sys.exit(0 if main() else 1)

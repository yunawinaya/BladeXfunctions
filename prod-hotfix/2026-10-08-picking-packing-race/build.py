#!/usr/bin/env python3
"""PICKING: run the auto-Packing writes one after the other instead of as parallel branches.

`condition_all_NEt9SBHT` ran `add_node_LcxwYc7z` (create Packings) beside `loop_PackingUpdates`
(update existing Packings). Loop state lives in the run's shared context, and an add-node that
evaluates while the sibling loop is starting dies with "Index 0 out of bounds for length 0" --
the whole PICKING run fails and no Packing is created (PI-20261008-1026: GD-2610-42/43).

Seeded from the ENABLED prod script, which must still be the bug-register hotfix (v73). Writes:
  PICKING.BASE.json  what prod runs now (diff baseline, never deploy)
  PICKING.PROD.json  the file to paste (prod, and dev -- see the parity line)

usage: python3 build.py
"""
import copy, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
HOTFIX = os.path.join(HERE, "..", "2026-10-08-bug-register")
sys.path.insert(0, HOTFIX)
import build as hb  # noqa: E402

WID, VERSION = 2020683258347081730, 73


def rule_if(nid, title, leaves, true_nodes):
    return {"id": nid, "type": "if", "data": {
        "title": title, "isValidator": True, "nodeName": title, "name": title,
        "condition_type": "ConditionRule",
        "expression": {"type": "javascript", "code": ""},
        "filter": {"list": copy.deepcopy(leaves)}},
        "blocks": [
            {"id": f"{nid}_t", "type": "ifBlock", "data": {"title": "true"}, "blocks": true_nodes},
            {"id": f"{nid}_f", "type": "ifBlock", "data": {"title": "false"}, "blocks": []}]}


def patch(d):
    block, parent, i = hb.find(d, "condition_all_NEt9SBHT")
    items = {it["data"]["title"]: it for it in block["blocks"]}
    assert sorted(items) == ["None", "hasCreates", "hasUpdates"], sorted(items)
    assert not items["None"]["blocks"], "the default branch is expected to be empty"
    creates, updates = items["hasCreates"], items["hasUpdates"]
    assert [n["id"] for n in creates["blocks"]] == ["add_node_LcxwYc7z"]
    assert [n["id"] for n in updates["blocks"]] == ["loop_PackingUpdates"]
    # Create first: the add-node must never evaluate while loop_PackingUpdates is running.
    parent[i:i + 1] = [
        rule_if("if_PkCreates", "IF hasCreates", creates["data"]["filter"]["list"], creates["blocks"]),
        rule_if("if_PkUpdates", "IF hasUpdates", updates["data"]["filter"]["list"], updates["blocks"]),
    ]


def main():
    version, base = hb.fetch(WID)
    if version != VERSION:
        sys.exit(f"FAIL: prod PICKING is v{version}, this fix was written against v{VERSION}")
    shipped = json.load(open(os.path.join(HOTFIX, "PICKING.PROD.json"), encoding="utf-8"))
    if hb.canon(base) != hb.canon(shipped):
        sys.exit("FAIL: prod PICKING is not the bug-register hotfix file -- rebase this fix first")

    prod = copy.deepcopy(base)
    patch(prod)
    hb.write(os.path.join(HERE, "PICKING.BASE.json"), base)
    hb.write(os.path.join(HERE, "PICKING.PROD.json"), prod)
    print(f"PICKING prod v{version} -> PICKING.BASE.json / PICKING.PROD.json")

    dev_version, dev = hb.fetch(WID, "--dev")
    old_base = json.load(open(os.path.join(HOTFIX, "PICKING.BASE.json"), encoding="utf-8"))
    if hb.canon(dev) == hb.canon(old_base):
        print(f"dev v{dev_version} == prod's pre-hotfix baseline -> PICKING.PROD.json is safe for dev "
              "(it carries the bug-register fixes too)")
    elif hb.canon(dev) == hb.canon(base):
        print(f"dev v{dev_version} == prod v{version} -> PICKING.PROD.json is safe for dev")
    else:
        print(f"dev v{dev_version} DIFFERS from both prod baselines -> do NOT paste into dev")


if __name__ == "__main__":
    main()

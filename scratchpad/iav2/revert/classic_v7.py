"""The classic IA_REVERT v7 = v6 (classic_v6.py) + the IA output split's WA batch match (plan 10-27): in code_node_iaRvBuild an IA IN row of a
Weighted Average batch takes the WA row of its own quantity first, then the nearest (lift_revert.py WA_WAS / WA_NOW, shared with Revert V2's
lifted code): a split's receipts into one batch (two bins, one price) leave a WA row each. Asserted: every v6 node byte-identical but that.

usage: python3 revert/classic_v7.py   (prints a summary; build_revert.py BUILDERS["IA_REVERT"] calls build())"""
import copy
import importlib.util
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
IAV2 = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(IAV2, "lib"))


def _load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


V6 = _load(os.path.join(HERE, "classic_v6.py"), "iarv_classic_v6_for_v7")
LIFT = _load(os.path.join(HERE, "lift", "lift_revert.py"), "iarv_lift_for_v7")
index = V6.index


def build():
    v6 = V6.build()
    doc = copy.deepcopy(v6)
    sc = index(doc)["code_node_iaRvBuild"]["data"]["script"]
    assert sc["code"].count(LIFT.WA_WAS) == 1, "the WA batch match moved in v6"
    sc["code"] = sc["code"].replace(LIFT.WA_WAS, LIFT.WA_NOW)
    rev = copy.deepcopy(doc)
    index(rev)["code_node_iaRvBuild"]["data"]["script"]["code"] = sc["code"].replace(LIFT.WA_NOW, LIFT.WA_WAS)
    canon = lambda x: json.dumps(x, ensure_ascii=False, separators=(",", ":"))
    assert canon(rev) == canon(v6), "IA_REVERT v7: a v6 node changed beyond the WA batch match"
    return doc


if __name__ == "__main__":
    doc = build()
    print("IA_REVERT v7: %d top-level nodes; code_node_iaRvBuild matches a WA batch row by its quantity first" % len(doc["nodes"]))

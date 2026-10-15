"""PROPOSAL, not deployed: the Batch Add Item (Procurement) page (dev page 1983374741340389378 v28, shared by the PO
and Purchase Requisition forms) with the bulk Item reads batched. Writes page_v28_patched.json next to this file (never
into the repo) and lists every path that differs from v28.
  python3 build_page.py
"""
import copy
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
from build_form import diff_paths  # noqa: E402

CHANGED = ["onClick_itemCodeInput", "onItemTableheaderClick_1l2un0x7", "onItemTablecheckboxEvent_tg37ka6k"]

if __name__ == "__main__":
    dev = json.load(open(os.path.join(HERE, "page_v28.json"), encoding="utf-8"))
    page = copy.deepcopy(dev)
    by_name = {e["name"]: e for e in page["config"]["eventScript"]}
    for name in CHANGED:
        e = by_name[name]
        assert e.get("type") == "js", name
        text = open(os.path.join(HERE, "new_handlers", name + ".js"), encoding="utf-8").read()
        e["func"] = text if e["func"].endswith("\n") else text.rstrip("\n")
    with open(os.path.join(HERE, "page_v28_patched.json"), "w", encoding="utf-8") as f:
        json.dump(page, f, ensure_ascii=False, indent=1)
    print("paths differing from page v28:")
    for p in diff_paths(dev, page):
        print("   ", p)

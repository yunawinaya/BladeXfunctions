"""Batch Add (PI) page (dev su_code_pages 2089184571995197441, built on the live v11 in ../base/), user 2026-10-21: a GR is
invoiced when it is Completed or Received (receipt done, putaway may still be pending), and only then.
  v12  "Document - GR" tab: gr_status equal Completed -> any[Completed, Received]
  v13  "Item - GR" tab: goods_receiving_id.gr_status all[notEqual Draft, notEqual Created] (Cancelled and Processing GRs'
       lines were listed) -> any[equal Completed, equal Received]

usage: python3 build_batchadd_page.py [--write]   (--write also refreshes Purchase Invoice/BatchAddPIpageJSON.json)
"""
import copy
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
R = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
BASE = os.path.join(HERE, "..", "base", "BatchAddPI_page.v11.json")
OUT = os.path.join(HERE, "out_BatchAddPI_page.json")
REPO = os.path.join(R, "Purchase Invoice", "BatchAddPIpageJSON.json")

page = json.load(open(BASE, encoding="utf-8"))
doc = copy.deepcopy(page)
ids = set()


def collect(o):
    if isinstance(o, dict):
        if isinstance(o.get("id"), int):
            ids.add(o["id"])
        for v in o.values():
            collect(v)
    elif isinstance(o, list):
        for v in o:
            collect(v)


collect(doc)
hits = []


def walk(o):
    if isinstance(o, dict):
        for k, v in list(o.items()):
            if k == "children" and isinstance(v, list):
                for i, leaf in enumerate(v):
                    if (isinstance(leaf, dict) and leaf.get("type") == "leaf" and leaf.get("prop") == "gr_status"
                            and leaf.get("operator") == "equal" and leaf.get("value") == "Completed"):
                        hits.append((v, i, leaf))
            walk(v)
    elif isinstance(o, list):
        for v in o:
            walk(v)


walk(doc)
assert len(hits) == 1, "expected the one Document - GR leaf, found %d" % len(hits)
siblings, at, leaf = hits[0]
new_id = max(ids) + 1
branch_id, received_id = new_id, new_id + 1
done = copy.deepcopy(leaf)
done.update({"parentId": branch_id, "level": leaf["level"] + 1})
received = copy.deepcopy(done)
received.update({"id": received_id, "value": "Received"})
siblings[at] = {"id": branch_id, "parentId": leaf.get("parentId"), "isTop": False, "type": "branch", "operator": "any",
                "level": leaf["level"], "children": [done, received]}
# v13: the Item - GR tab takes the same two statuses
items = []


def walk_items(o):
    if isinstance(o, dict):
        ch = o.get("children")
        if (o.get("type") == "branch" and isinstance(ch, list) and len(ch) == 2
                and all(c.get("prop") == "goods_receiving_id.gr_status" and c.get("operator") == "notEqual" for c in ch)
                and sorted(c.get("value") for c in ch) == ["Created", "Draft"]):
            items.append(o)
        for v in o.values():
            walk_items(v)
    elif isinstance(o, list):
        for v in o:
            walk_items(v)


walk_items(doc)
assert len(items) == 1, "expected the one Item - GR status branch, found %d" % len(items)
items[0]["operator"] = "any"
for leaf, status in zip(items[0]["children"], ("Completed", "Received")):
    leaf.update({"operator": "equal", "operatorLabel": "Equal", "value": status})
print("Item - GR: goods_receiving_id.gr_status all[notEqual Draft, notEqual Created] -> any[Completed, Received] (branch %d)" % items[0]["id"])
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(doc, f, ensure_ascii=False)
print("Document - GR: gr_status equal Completed -> any[Completed, Received] (branch %d, leaf %d) -> %s" % (branch_id, received_id, OUT))
if "--write" in sys.argv:
    with open(REPO, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print("wrote", REPO)

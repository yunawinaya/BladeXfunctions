# Packing list page (dev page 1993880834000805890, base = dev/prod enabled v28): hide packing_status "Waiting"
# (GD Created V2's shell until picking fills it). The page's one top-level rule branch is wrapped in an "all" with
# any(packing_status notEqual 'Waiting', packing_status isNull) - leaf shapes copied from the Sales Invoice page.
# Usage: python3 -I patch_page.py   (writes out/PackingListPage.json and the repo mirror Packing/PackingListPageJSON.json)
import json, os, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
BASE = os.path.join(HERE, "base", "PackingListPage.v28.json")
OUT = os.path.join(HERE, "out", "PackingListPage.json")
MIRROR = os.path.join(REPO, "Packing", "PackingListPageJSON.json")
PRETTIER = os.path.expanduser("~/.npm/_npx/b388654678d519d9/node_modules/prettier/bin/prettier.cjs")
HIDDEN = "Waiting"
TOP, BRANCH, NE, NUL = 1793700000001, 1793700000002, 1793700000003, 1793700000004

doc = json.load(open(BASE))
rules = doc["list"][0]["options"]["customProps"]["dataSource"]["rules"]
assert rules["collectionId"] == "1993515601863524353", rules["collectionId"]
assert len(rules["list"]) == 1 and rules["list"][0]["isTop"] and rules["list"][0]["operator"] == "any", "the base page's rules changed"
text = json.dumps(doc)
for i in (TOP, BRANCH, NE, NUL):
    assert str(i) not in text, f"id {i} already used"
assert "packing_status" not in json.dumps(rules), "a packing_status rule exists already"

old = rules["list"][0]
top_parent = old["parentId"]


def deepen(node):
    node["level"] = node.get("level", 1) + 1
    for c in node.get("children") or []:
        deepen(c)


deepen(old)
old["isTop"] = False
old["parentId"] = TOP
leaf = lambda i, op, value, label: {"id": i, "parentId": BRANCH, "isTop": False, "prop": "packing_status", "operator": op, "valueType": "value", "value": value,
                                    "type": "leaf", "level": 3, "propLabel": "Packing Status", "valueLabel": "", "operatorLabel": label, "valueTypeLabel": "值"}
status = {"id": BRANCH, "isTop": False, "parentId": TOP, "type": "branch", "operator": "any", "level": 2,
          "children": [leaf(NE, "notEqual", HIDDEN, "不等于"), leaf(NUL, "isNull", None, "没有值")]}
rules["list"] = [{"id": TOP, "parentId": top_parent, "isTop": True, "type": "branch", "operator": "all", "prop": "", "valueType": "", "value": "", "level": 1,
                  "children": [old, status]}]

os.makedirs(os.path.dirname(OUT), exist_ok=True)
open(OUT, "w").write(json.dumps(doc, ensure_ascii=False, indent=2) + "\n")
# repo mirror in the list-page format (Prettier of an indent=2 dump, as GDlistPageJSON / PutawayListPageJSON)
pretty = subprocess.run(["node", PRETTIER, "--parser", "json"], input=json.dumps(doc, ensure_ascii=False, indent=2), capture_output=True, text=True, check=True).stdout
open(MIRROR, "w").write(pretty)
print("page: wrapped the rules in all(", old["operator"], "plant/org branch, any(packing_status notEqual", HIDDEN, ", isNull))")
print("wrote", OUT, "and", MIRROR)

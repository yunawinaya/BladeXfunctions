"""Pick a replay sample of prod PO_SAVE runs from the run catalog and cache them (read-only, by id)."""
import json, os, sys, random
from runs import fetch
S = sys.argv[1]
cat = json.load(open(os.path.join(S, "run_catalog.json")))["--prod"]
random.seed(7)
pick = []
def kind(r):
    return "draft" if r["has_code_draft_check_doc_no"] else ("add" if r["has_add_po"] else ("edit" if r["has_get_one_po"] else "other"))
comp = [r for r in cat if r["status"] == "Complete"]
by = {}
for r in comp:
    by.setdefault(kind(r), []).append(r)
pick += [r for r in comp if r["has_search_preq"]][:40]
pick += random.sample(by.get("add", []), min(60, len(by.get("add", []))))
pick += random.sample(by.get("edit", []), min(80, len(by.get("edit", []))))
pick += random.sample(by.get("draft", []), min(30, len(by.get("draft", []))))
pick += [r for r in cat if r["status"] == "Fail"]
pick += sorted(comp, key=lambda r: -(r["rq"] or 0))[:20]
pick += [r for r in cat if r["status"] == "InExecute"]
seen = set(); ids = []
for r in pick:
    if r["id"] not in seen:
        seen.add(r["id"]); ids.append(r["id"])
print("fetching", len(ids))
ok = 0
for i, rid in enumerate(ids):
    for attempt in range(3):
        try:
            fetch("--prod", rid); ok += 1; break
        except Exception as e:
            if attempt == 2: print("failed", rid, str(e)[:120])
json.dump(ids, open(os.path.join(S, "prod_sample_ids.json"), "w"))
print("cached", ok, "of", len(ids))

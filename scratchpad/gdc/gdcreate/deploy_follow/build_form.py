"""build_form.py: the GD form with the Save as Created V2 handler that waits for PREPARE's verdict (user 2026-10-23).
Base = the live dev form, pulled first: .dbtools/form pull --dev goods_delivery -o GD_form.live_v1487.json
Writes GD_form.v1487_follow.json (publish.json's form item) and puts the same handler into Goods Delivery/GDfullJSON.json
(its one encoded handler string replaced, so the file keeps its own format).

usage: python3 build_form.py
"""
import json

D = "/Users/yunawinaya/Developer/BladeXfunctions/scratchpad/gdc/gdcreate/deploy_follow/"
R = "/Users/yunawinaya/Developer/BladeXfunctions/"
H = "gdV2_onClick_save_as_created"


def canon(o):
    return json.dumps(o, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def handler(form):
    hs = [e for e in form["config"]["eventScript"] if e.get("name") == H]
    assert len(hs) == 1, "%d %s handlers" % (len(hs), H)
    return hs[0]


live = json.load(open(D + "GD_form.live_v1487.json", encoding="utf-8"))
new_src = open(R + "Goods Delivery/AsyncV2/gdV2_onClick_save_as_created.js", encoding="utf-8").read()
print("live handler chars", len(handler(live)["func"]), "-> new", len(new_src))
handler(live)["func"] = new_src
json.dump(live, open(D + "GD_form.v1487_follow.json", "w", encoding="utf-8"), ensure_ascii=False)

p = R + "Goods Delivery/GDfullJSON.json"
raw = open(p, encoding="utf-8").read()
oe, ne = json.dumps(handler(json.loads(raw))["func"], ensure_ascii=False), json.dumps(new_src, ensure_ascii=False)
assert raw.count(oe) == 1, raw.count(oe)
open(p, "w", encoding="utf-8").write(raw.replace(oe, ne))
assert canon(json.load(open(p, encoding="utf-8"))) == canon(live), "GDfullJSON.json differs from live v1487 beyond the handler"
print("GD_form.v1487_follow.json written; GDfullJSON.json == the built form")

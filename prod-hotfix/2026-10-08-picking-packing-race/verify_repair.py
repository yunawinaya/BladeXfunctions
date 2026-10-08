#!/usr/bin/env python3
"""Checks for REPAIR_PACKING_PI1026.json:
  1. lint + syntax  - scratchpad/validate.py clean, code_node_RpPlan parses
  2. add-node       - same props, order and value types as PICKING's add_node_LcxwYc7z; only the
                      payload / rule references differ
  3. plan node      - replayed through the harness for each case the run can meet
usage: python3 verify_repair.py"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "2026-10-08-bug-register"))
import build as hb  # noqa: E402
import replay_tests as rt  # noqa: E402
import verify as hv  # noqa: E402

PATH = os.path.join(HERE, "REPAIR_PACKING_PI1026.json")
RULE = {"id": "2048857875989835777", "business_type": "Packing", "department_id": "1996787068457861121"}
G42, G43 = "2108074151607668738", "2108074166921072642"
failed = []


def check(cond, msg):
    print(f"  {'ok  ' if cond else 'FAIL'} {msg}")
    if not cond:
        failed.append(msg)


def search(rows):
    return {"code": 200, "data": {"total": len(rows), "count": len(rows), "data": rows}}


def plan(code, rules, existing):
    return rt.run(code, {}, {"search_node_RpRule": search(rules), "search_node_RpExisting": search(existing)})


def main():
    wf = json.load(open(PATH, encoding="utf-8"))
    picking = json.load(open(os.path.join(HERE, "PICKING.PROD.json"), encoding="utf-8"))

    print("lint / syntax")
    findings = sorted(hv.lint(PATH))
    check(not [f for f in findings if not f.startswith("UNUSED")], f"validate.py: {findings or 'clean'}")
    code = hb.find(wf, "code_node_RpPlan")[0]["data"]["script"]["code"]
    good, err = hv.syntax_ok(code)
    check(good, f"code_node_RpPlan parses {err}")

    print("add-node vs PICKING add_node_LcxwYc7z")
    mine = hb.find(wf, "add_node_RpPacking")[0]["data"]
    orig = hb.find(picking, "add_node_LcxwYc7z")[0]["data"]
    repoint = lambda v: str(v).replace("code_node_gudzrvMQ.data.packingDataList.", "code_node_RpPlan.data.toCreate.") \
        .replace("get_node_P2TpS5kS.data.data.id", "code_node_RpPlan.data.ruleId")
    same_props = [(p["prop"], p["valueType"], repoint(p["value"])) for p in orig["props"]["list"]] == \
                 [(p["prop"], p["valueType"], p["value"]) for p in mine["props"]["list"]]
    check(same_props, f"{len(mine['props']['list'])} props identical once re-pointed")
    check(mine["table_id"] == orig["table_id"], "same target table (Packing 1993515601863524353)")
    declared = {k["name"]: k["bsonType"] for k in hb.find(wf, "code_node_RpPlan")[0]["data"]["response_json"]}
    check(declared == {"toCreate": "array", "go": "int", "ruleId": "string", "code": "string", "message": "string"},
          f"plan keys declared {declared}")

    print("plan node")
    out = plan(code, [RULE], [])
    check(out["go"] == 1 and [p["gd_no"] for p in out["toCreate"]] == ["GD-2610-43", "GD-2610-42"],
          f"LSH session, no Packing yet -> creates both: {out['message']}")
    check(out["toCreate"][1]["remarks_2"].startswith("送货前") and out["toCreate"][1]["table_item_source"][0]["picked_qty"] == 20,
          "payload carried through verbatim (remarks_2, picked 20)")
    out = plan(code, [RULE], [{"id": "1", "gd_id": G42}])
    check(out["go"] == 1 and [p["gd_no"] for p in out["toCreate"]] == ["GD-2610-43"], f"42 already packed -> only 43: {out['message']}")
    out = plan(code, [RULE], [{"id": "1", "gd_id": G42}, {"id": "2", "gd_id": G43}])
    check(out["go"] == 0 and out["code"] == "200", f"both exist (re-run) -> nothing: {out['message']}")
    out = rt.run(code, {}, {"search_node_RpRule": {"code": 200, "data": {"total": 1, "count": 1, "data": RULE}},
                            "search_node_RpExisting": search([])})
    check(out["go"] == 1, "a single-object search result is read too")
    out = plan(code, [dict(RULE, id="2048857875989835778")], [])
    check(out["go"] == 0 and out["code"] == "400", f"another tenant's rule -> refuses: {out['message']}")
    out = plan(code, [], [])
    check(out["go"] == 0 and out["code"] == "400", "no rule visible -> refuses")

    print("FAILED: " + "; ".join(failed) if failed else "ALL OK")
    return not failed


if __name__ == "__main__":
    sys.exit(0 if main() else 1)

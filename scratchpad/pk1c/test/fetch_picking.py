"""The PICKING run behind each recorded GOODS_DELIVERY re-save from a Picking (isPicking "Yes"): the latest PICKING run of
the same tenant that started within 5 minutes before the head. Its nodes_data holds the pre-move GD lines
(search_node_krPmTbfL), the records (code_node_oHIIKfiw) and the classic allocation rewrite (code_node_iES7iMKA).
Fixtures hold tenant data: they go to the session scratchpad, never the repo.

usage: python3 fetch_picking.py <out_dir> --ids <goods_delivery head id,...> [--env --dev|--prod]
"""
import json, os, sys

sys.path.insert(0, "/Users/yunawinaya/Developer/BladeXfunctions/scratchpad/gdc/pkv2tools")
from dbq import q  # noqa: E402

PICKING, GOODS_DELIVERY = "2020683258347081730", "2017151544868491265"
COLS = "CAST(id AS CHAR) id, CAST(workflow_id AS CHAR) wf, tenant_id, status, run_time, current_node_id, error_msg, request_json_data, response_json_data, nodes_data"
BACK_MS = 300000


def main():
    out = sys.argv[1]
    env = sys.argv[sys.argv.index("--env") + 1] if "--env" in sys.argv else "--dev"
    ids = sys.argv[sys.argv.index("--ids") + 1].split(",")
    assert ids and all(i.isdigit() for i in ids)
    os.makedirs(out, exist_ok=True)
    heads = q(env, f"SELECT CAST(id AS CHAR) id, tenant_id FROM su_code_workflow_inst WHERE workflow_id = {GOODS_DELIVERY} AND id IN ({','.join(ids)})")
    for h in heads:
        t = h["tenant_id"]
        assert t.isdigit()
        lo = int(h["id"]) - (BACK_MS << 22)
        rows = q(env, f"SELECT {COLS} FROM su_code_workflow_inst WHERE workflow_id = {PICKING} AND id BETWEEN {lo} AND {h['id']}"
                      f" AND tenant_id = '{t}' ORDER BY id DESC LIMIT 1")
        if not rows:
            print(f"{h['id']} {t}: no PICKING run in the 5 minutes before")
            continue
        p = rows[0]
        nodes = json.loads(p["nodes_data"] or "[]")
        have = {n.get("node_id") for n in nodes}
        json.dump({"tenant_id": t, "gd_head": h["id"], "picking": p}, open(os.path.join(out, h["id"] + ".json"), "w"))
        print(f"{h['id']} {t}: PICKING {p['id']} {p['status']} {p['run_time']} ms; "
              + " ".join(k + ("=Y" if k in have else "=-") for k in ("search_node_krPmTbfL", "code_node_oHIIKfiw", "code_node_iES7iMKA", "get_node_Uj1uV9PU")))


if __name__ == "__main__":
    main()

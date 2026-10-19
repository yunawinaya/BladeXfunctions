"""Pull every recorded classic IA_REVERT run (read-only) into a JSONL fixture for the Revert V2 parity harnesses.
Copy of tpl/grrv/test/fetch_grrv_runs.py for workflow 2099319746652852225 (the same id on prod and dev), plus the child
runs each one made (SUBTRACT_INVENTORY / ADD_INVENTORY / HANDLING_UNIT, found by id window and tenant: nodes_data does not
record a loop's workflow nodes), with the parameters they were called with.

usage: python3 fetch_runs.py <--prod|--dev> [out.jsonl]   (default: FIXTURES/runs_<env>.jsonl)
Filtered by workflow_id + id only (prod's statement timeout; su_code_workflow_inst has no create_time index). 16+ digit
numbers are read as their exact digit strings. Fixtures hold customer data: they live OUTSIDE the repo (CONTRACT.md ruling 8).
"""
import json
import os
import re
import sys
import time

sys.dont_write_bytecode = True

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "lib"))
from dbq import q as _q  # noqa: E402

WF = "2099319746652852225"
FIXTURES = "/Users/yunawinaya/Documents/ASC-dev/iav2-fixtures/f"
CHILD = {"2012096660219564034": "SUBTRACT_INVENTORY", "2012005532688723970": "ADD_INVENTORY", "2037062451509002241": "HANDLING_UNIT"}
EPOCH = 1288834974657
BIG = re.compile(r'"(?:[^"\\]|\\.)*"|-?\d{16,}(?![.\deE])')


def q(env, sql, tries=4):
    for n in range(tries):
        try:
            return _q(env, sql)
        except RuntimeError:
            if n == tries - 1:
                raise
            time.sleep(5 * (n + 1))


def P(text):
    """JSON with every 16+ digit number read as its exact digit string (the platform's ids)."""
    if text is None or text == "":
        return None
    return json.loads(BIG.sub(lambda m: m.group(0) if m.group(0)[0] == '"' else '"' + m.group(0) + '"', text))


def node_map(nodes_data):
    out, order = {}, []
    for n in P(nodes_data) or []:
        nid = n.get("node_id")
        if not nid:
            continue
        rec = {"type": n.get("node_type"), "status": n.get("status"), "t0": n.get("start_time_millis"), "t1": n.get("end_time_millis"),
               "cut": bool(n.get("response_is_writer_file") or n.get("request_is_writer_file"))}
        raw_req = n.get("request_json_data")
        try:
            rq = P(raw_req)
        except ValueError:
            rq = raw_req
        if isinstance(rq, dict) and "code" in rq and n.get("node_type") == "code-node":
            rec["code"] = rq.get("code")
            rec["vars"] = rq.get("variableMap")
            rec["decl"] = [[r.get("name"), r.get("bsonType")] for r in (rq.get("responseConfig") or [])]
        else:
            rec["req"] = rq
        try:
            rec["resp"] = P(n.get("response_json_data"))
        except ValueError:
            rec["resp"] = None
        key = nid if nid not in out else nid + "#" + str(len(order))
        out[key] = rec
        order.append(nid)
    return out, order


def children(env, run_id, tenant, t1):
    hi = ((int(t1) - EPOCH) << 22) + (1 << 22)
    rows = q(env, "SELECT CAST(id AS CHAR) id, CAST(workflow_id AS CHAR) wf, status, request_json_data, response_json_data FROM su_code_workflow_inst "
                  f"WHERE workflow_id IN ({','.join(CHILD)}) AND id BETWEEN {run_id} AND {hi} AND tenant_id = '{tenant}' ORDER BY id")
    out = []
    for r in rows:
        rq = P(r["request_json_data"]) or {}
        out.append({"id": r["id"], "workflow": CHILD.get(r["wf"], r["wf"]), "status": r["status"], "params": rq.get("workflowparams") or rq,
                    "resp": P(r["response_json_data"])})
    return out


def main():
    env = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(FIXTURES, "runs_%s.jsonl" % env[2:])
    assert not os.path.abspath(out).startswith("/Users/yunawinaya/Developer/"), "fixtures hold customer data: never inside the repo"
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    ids = [r["id"] for r in q(env, f"SELECT CAST(id AS CHAR) id FROM su_code_workflow_inst WHERE workflow_id={WF} ORDER BY id")]
    kept = 0
    tmp = out + ".part"
    with open(tmp, "w") as fh:
        for i in range(0, len(ids), 5):
            part = ids[i:i + 5]
            rows = q(env, "SELECT CAST(id AS CHAR) id, tenant_id, status, current_node_id, start_date, end_date, error_msg, request_json_data, response_json_data, nodes_data "
                          f"FROM su_code_workflow_inst WHERE workflow_id={WF} AND id IN ({','.join(part)}) ORDER BY id")
            for r in rows:
                rq = P(r["request_json_data"]) or {}
                nodes, order = node_map(r["nodes_data"])
                t0 = int(r["start_date"] or ((int(r["id"]) >> 22) + EPOCH))
                t1 = int(r["end_date"] or t0)
                rec = {"id": r["id"], "env": env[2:], "tenant": r["tenant_id"], "status": r["status"], "exit": r["current_node_id"],
                       "error": (r.get("error_msg") or "")[:500], "t0": t0, "t1": t1, "params": rq.get("workflowparams") or {},
                       "resp": P(r["response_json_data"]), "nodes": nodes, "order": order, "children": children(env, r["id"], r["tenant_id"], t1)}
                fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
                kept += 1
            print(f"  {env} {min(i + 5, len(ids))}/{len(ids)}", file=sys.stderr)
    os.replace(tmp, out)
    print(f"{env}: kept {kept} IA_REVERT runs -> {out}")


if __name__ == "__main__":
    main()

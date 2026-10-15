"""Pull recorded PUTAWAY runs (read-only) with the SUBTRACT_INVENTORY / ADD_INVENTORY child runs each one made, into JSONL
fixtures for the PREPARE parity harnesses.

usage: python3 fetch_pw_runs.py <--prod|--dev> <out.jsonl> [--since-id ID] [--max N]
  PUTAWAY runs newer than --since-id (default: PUTAWAY v33's release, 2026-09-18 17:33 MYT), filtered by workflow_id + id
  only (prod's statement timeout). Per run: request, exit, every recorded node (code nodes: source + variableMap + declared
  outputs; others: request), and the child SUBTRACT / ADD runs made between its start and end (trx_no = the TO number,
  transaction_type "TO - PA"; request + response only). The PUTAWAY_LOOP run that called it is matched by time.
Fixtures hold customer data: write them to the session scratchpad, never into the repo.
"""
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "grv2"))
from dbq import q as _q  # noqa: E402

PW_WF = "2031249915811270657"
LOOP_WF = "2031190421336195074"
SUB_WF = "2012096660219564034"
ADD_WF = "2012005532688723970"
EPOCH = 1288834974657
V33 = "2100880758666166272"
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
        try:
            rq = P(n.get("request_json_data"))
        except ValueError:
            rq = None
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


def children(env, wf, lo, hi, like):
    ids = [r["id"] for r in q(env, f"SELECT CAST(id AS CHAR) id FROM su_code_workflow_inst WHERE workflow_id={wf} AND id BETWEEN {lo} AND {hi} ORDER BY id")]
    rows = []
    for i in range(0, len(ids), 60):
        part = ids[i:i + 60]
        rows += q(env, "SELECT CAST(id AS CHAR) id, status, current_node_id, start_date, end_date, request_json_data, response_json_data FROM su_code_workflow_inst "
                       f"WHERE workflow_id={wf} AND id IN ({','.join(part)}) AND request_json_data LIKE '{like}' ORDER BY id")
    out = []
    for r in rows:
        rq = P(r["request_json_data"]) or {}
        out.append({"id": r["id"], "status": r["status"], "exit": r["current_node_id"], "t0": r["start_date"], "t1": r["end_date"],
                    "params": rq.get("workflowparams") or {}, "resp": P(r["response_json_data"])})
    return out


def main():
    env, out = sys.argv[1], sys.argv[2]
    since = sys.argv[sys.argv.index("--since-id") + 1] if "--since-id" in sys.argv else V33
    cap = int(sys.argv[sys.argv.index("--max") + 1]) if "--max" in sys.argv else 10 ** 9
    ids = [r["id"] for r in q(env, f"SELECT CAST(id AS CHAR) id FROM su_code_workflow_inst WHERE workflow_id={PW_WF} AND id > {since} ORDER BY id")]
    ids = ids[:cap]
    loops = q(env, f"SELECT CAST(id AS CHAR) id, start_date, end_date, current_node_id FROM su_code_workflow_inst WHERE workflow_id={LOOP_WF} AND id > {since} ORDER BY id")
    kept = 0
    tmp = out + ".part"
    with open(tmp, "w") as fh:
        for i in range(0, len(ids), 10):
            part = ids[i:i + 10]
            rows = q(env, "SELECT CAST(id AS CHAR) id, tenant_id, status, current_node_id, start_date, end_date, error_msg, request_json_data, response_json_data, nodes_data "
                          f"FROM su_code_workflow_inst WHERE workflow_id={PW_WF} AND id IN ({','.join(part)}) ORDER BY id")
            for r in rows:
                rq = P(r["request_json_data"]) or {}
                params = rq.get("workflowparams") or {}
                nodes, order = node_map(r["nodes_data"])
                t0 = int(r["start_date"] or ((int(r["id"]) >> 22) + EPOCH))
                t1 = int(r["end_date"] or t0)
                lo = int(r["id"])
                hi = (t1 + 3000 - EPOCH) << 22
                to_no = str((params.get("allData") or {}).get("to_id") or "")
                subs, adds = [], []
                if to_no and re.fullmatch(r"[A-Za-z0-9/_.\- ]{1,60}", to_no):
                    like = '%"trx_no":"' + to_no + '"%'
                    subs = [c for c in children(env, SUB_WF, lo, hi, like) if (c["params"].get("transaction_type") == "TO - PA")]
                    adds = [c for c in children(env, ADD_WF, lo, hi, like) if (c["params"].get("transaction_type") == "TO - PA")]
                # the PUTAWAY_LOOP run that called it: the latest one started before it and still running when it started
                caller = None
                for lp in loops:
                    if int(lp["id"]) < lo and int(lp["end_date"] or 0) >= t0 - 50:
                        caller = lp
                rec = {"id": r["id"], "env": env[2:], "tenant": r["tenant_id"], "status": r["status"], "exit": r["current_node_id"],
                       "error": (r.get("error_msg") or "")[:500], "t0": t0, "t1": t1, "params": params, "resp": P(r["response_json_data"]),
                       "nodes": nodes, "order": order, "subs": subs, "adds": adds,
                       "caller": {"id": caller["id"], "exit": caller["current_node_id"]} if caller else None}
                fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
                kept += 1
            print(f"  {env} {min(i + 10, len(ids))}/{len(ids)}", file=sys.stderr)
    os.replace(tmp, out)
    print(f"{env}: kept {kept} PUTAWAY runs since {since} -> {out}")


if __name__ == "__main__":
    main()

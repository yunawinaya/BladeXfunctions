"""Pull the recorded classic STOCK_ADJUSTMENT runs (read-only) and, inside each, its recorded ADD_INVENTORY /
SUBTRACT_INVENTORY child runs into JSONL for replay_sa.js. One line per SA run:

  {id, env, tenant, status, exit, error, t0, t1, saveAs, pageStatus, o4, o4From, hdr, hdrFrom, trx, items, order,
   foreign, calls: [child, ...]}

  o4    code_node_O4tWJ5JH's allData (the fillback the classic loop iterates: lines with line_index, plant_id, q8
        unit_price), HTML status strings dropped. o4From "o4" | "request" (the node output was cut: the request's
        allData with the fillback applied here)
  hdr   the header code_node_qrsgEz2F read for plant / org / adjustment_no / adjustment_date: add_node_Yk7ukSPp (Add),
        get_node_Rs3nGg9f (Edit of a Draft), else o4. trx = hdr.adjustment_no
  items search_node_SAItems rows (slimmed to what the engine's item adapter reads)
  calls the child runs, id order: fetch_runs_old.py's record {id, kind, status, exit, error, t0, t1, code, params,
        order, nodes} (params.itemData + the ItemData node outputs slimmed the same way)
  foreign  ADD / SUBTRACT runs in the window with transaction_type "SA" but another trx_no (expected 0)

Children = ADD_INVENTORY / SUBTRACT_INVENTORY runs of the SA run's tenant inside its window (start_date - 0.5 s ..
end_date + 0.5 s, as snowflake id bounds: su_code_workflow_inst is filtered by workflow_id + id only, never by a date)
whose request says transaction_type "SA" and trx_no = the SA's number. Prod has no two SA runs of one tenant
overlapping in time (checked 2026-10-16), so window + trx_no is unambiguous.
Copied from scratchpad/sav2/tpl/smv2/parity/fetch_runs_old.py (child record format, item slimming, code version);
the parent walk is new (package E, SA V2).

usage: python3 fetch_runs_sa.py <--prod|--dev> <out.jsonl> [--since YYYY-MM-DD[THH:MM]] [--until YYYY-MM-DD[THH:MM]]
  --since / --until are MYT. Default since 2026-09-17 (the prod run log; dev holds 15 SA runs in all).
Fixtures hold customer data: write them to the session scratchpad, never into the repo.
"""
import datetime, json, os, sys

sys.dont_write_bytecode = True  # no __pycache__ in the repo folder
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dbq import q  # noqa: E402

SA_WF = "2032025505853816833"  # STOCK_ADJUSTMENT
KIDS = {"2012005532688723970": "ADD", "2012096660219564034": "SUBTRACT"}  # ADD_INVENTORY v65 / SUBTRACT_INVENTORY v58 prod, v59 dev
EPOCH = 1288834974657
SLACK_MS = 500
Q8 = "const q8 = (v) => Number((parseFloat(v) || 0).toFixed(8))"
ITEM_KEYS = ("id", "material_code", "stock_control", "based_uom", "material_costing_method", "purchase_unit_price", "item_batch_management", "table_uom_conversion")
ITEM_NODES = ("code_node_TC1cqaOy", "code_node_3XzQSsce", "get_node_BWe6rbru", "get_node_cnqECQ8X")  # ItemData outputs + the item get-nodes
DIG = set("0123456789")


def digits(v):
    v = "" if v is None else str(v)
    if not v or not set(v) <= DIG:
        raise ValueError("not an id: " + v)
    return v


def ids_as_text(v):
    if isinstance(v, dict):
        return {k: ids_as_text(x) for k, x in v.items()}
    if isinstance(v, list):
        return [ids_as_text(x) for x in v]
    if isinstance(v, int) and not isinstance(v, bool) and abs(v) > 2 ** 53:
        return str(v)
    return v


def slim(it):
    if not isinstance(it, dict):
        return it
    return {k: it[k] for k in ITEM_KEYS if k in it}


def no_html(d):
    if not isinstance(d, dict):
        return d
    return {k: v for k, v in d.items() if not (isinstance(v, str) and ("<!DOCTYPE" in v or "<html" in v))}


def to_id(text):
    at = datetime.datetime.fromisoformat(text).replace(tzinfo=datetime.timezone(datetime.timedelta(hours=8)))
    return (int(at.timestamp() * 1000) - EPOCH) << 22


def parse_nodes(raw):
    """fetch_runs_old.py's node walk: {node_id: {type, status, cut, resp}}, the order, the last end, the code version"""
    nodes, order, t1, code_seen = {}, [], 0, set()
    for n in raw:
        t1 = max(t1, int(n.get("end_time_millis") or 0))
        nid = n.get("node_id")
        if not nid:
            continue  # a failed run's last entry
        if n.get("node_type") == "code-node":
            src = n.get("request_json_data") or ""
            if Q8 in src:
                code_seen.add("v65")
            if "toFixed(4)" in src or "toFixed(3)" in src:
                code_seen.add("pre-v65")
        try:
            resp = json.loads(n.get("response_json_data") or "null")
        except ValueError:
            resp = None
        if nid in ITEM_NODES and isinstance(resp, dict):
            d = resp.get("data")
            if isinstance(d, dict) and "itemData" in d:
                d["itemData"] = slim(d["itemData"])
            elif isinstance(d, dict) and "data" in d:
                d["data"] = slim(d["data"]) if isinstance(d["data"], dict) else [slim(x) for x in d["data"]] if isinstance(d["data"], list) else d["data"]
        order.append(nid)
        nodes[nid] = {"type": n.get("node_type"), "status": n.get("status"), "cut": bool(n.get("response_is_writer_file")), "resp": resp}
    return nodes, order, t1, ("pre-v65" if "pre-v65" in code_seen else "v65" if code_seen else "unknown")


def out(nodes, nid):
    n = nodes.get(nid)
    return (n.get("resp") or {}).get("data") if n and isinstance(n.get("resp"), dict) else None


def fillback(all_data):
    """code_node_O4tWJ5JH's line fillback (used only when its recorded output was cut)"""
    q8 = lambda v: float(f"{float(v or 0):.8f}") if str(v or "").strip() not in ("", "None") else 0.0  # noqa: E731
    d = dict(all_data)
    lines = []
    for i, ln in enumerate(d.get("stock_adjustment") or []):
        ln = dict(ln)
        try:
            ln["unit_price"] = q8(ln.get("unit_price"))
        except (TypeError, ValueError):
            ln["unit_price"] = 0.0
        ln["plant_id"] = d.get("plant_id") or None
        ln["line_index"] = i + 1
        lines.append(ln)
    d["stock_adjustment"] = lines
    return d


def main():
    env, outfile = sys.argv[1], sys.argv[2]
    if env not in ("--prod", "--dev"):
        raise SystemExit(__doc__)
    since = sys.argv[sys.argv.index("--since") + 1] if "--since" in sys.argv else "2026-09-17"
    until = sys.argv[sys.argv.index("--until") + 1] if "--until" in sys.argv else None
    lo = to_id(since)
    hi = f"AND id < {to_id(until)}" if until else ""
    heads = q(env, f"SELECT CAST(id AS CHAR) id, tenant_id, start_date, end_date FROM su_code_workflow_inst WHERE workflow_id={SA_WF} AND id >= {lo} {hi} ORDER BY id")
    parents = []
    for i in range(0, len(heads), 20):
        part = [h["id"] for h in heads[i:i + 20]]
        for r in q(env, "SELECT CAST(id AS CHAR) id, tenant_id, status, current_node_id, error_msg, start_date, end_date, request_json_data, nodes_data "
                        f"FROM su_code_workflow_inst WHERE workflow_id={SA_WF} AND id IN (" + ",".join(part) + ")"):
            parents.append(r)
    parents.sort(key=lambda r: int(r["id"]))

    # children: ids first (PK ranges), then their payloads in chunks
    kid_ids = []
    for i in range(0, len(parents), 25):
        part = parents[i:i + 25]
        conds = " OR ".join(f"(id BETWEEN {(int(p['start_date']) - SLACK_MS - EPOCH) << 22} AND {(int(p['end_date']) + SLACK_MS - EPOCH) << 22} AND tenant_id='{digits(p['tenant_id'])}')" for p in part)
        kid_ids += [r["id"] for r in q(env, f"SELECT CAST(id AS CHAR) id FROM su_code_workflow_inst WHERE workflow_id IN ({','.join(KIDS)}) AND ({conds})")]
    kids = []
    for i in range(0, len(kid_ids), 25):
        part = kid_ids[i:i + 25]
        kids += q(env, "SELECT CAST(id AS CHAR) id, CAST(workflow_id AS CHAR) workflow_id, tenant_id, status, current_node_id, error_msg, start_date, end_date, request_json_data, nodes_data "
                       "FROM su_code_workflow_inst WHERE id IN (" + ",".join(part) + ") AND request_json_data LIKE '%\"transaction_type\":\"SA\"%'")
    kids.sort(key=lambda r: int(r["id"]))

    got = calls = foreign = 0
    with open(outfile, "w") as fh:
        for p in parents:
            try:
                wp = json.loads(p["request_json_data"]).get("workflowparams") or {}
                nodes, order, t1, _ = parse_nodes(json.loads(p["nodes_data"] or "[]"))
            except (ValueError, TypeError):
                continue
            o4 = out(nodes, "code_node_O4tWJ5JH")
            o4_from = "o4"
            if not (isinstance(o4, dict) and isinstance(o4.get("allData"), dict)) or (nodes.get("code_node_O4tWJ5JH") or {}).get("cut"):
                o4 = {"allData": fillback(wp.get("allData") or {})}
                o4_from = "request"
            all_data = no_html(o4["allData"])
            page = wp.get("pageStatus")
            status = o4.get("stock_adjustment_status", all_data.get("stock_adjustment_status"))
            if page == "Add":
                raw = out(nodes, "add_node_Yk7ukSPp")
                hdr, hdr_from = (raw[0] if isinstance(raw, list) and raw else raw), "add_node_Yk7ukSPp"
            elif page == "Edit" and status == "Draft":
                hdr, hdr_from = (out(nodes, "get_node_Rs3nGg9f") or {}).get("data"), "get_node_Rs3nGg9f"
            else:
                hdr, hdr_from = all_data, "code_node_O4tWJ5JH"
            hdr = no_html(hdr) if isinstance(hdr, dict) else None
            trx = (hdr or {}).get("adjustment_no")
            items = out(nodes, "search_node_SAItems") or {}
            items = [slim(x) for x in (items.get("data") or [])] if isinstance(items.get("data"), list) else [slim(items["data"])] if isinstance(items.get("data"), dict) else []
            lo_id = (int(p["start_date"]) - SLACK_MS - EPOCH) << 22
            hi_id = (int(p["end_date"]) + SLACK_MS - EPOCH) << 22
            mine = []
            nf = 0
            for k in kids:
                if not (lo_id <= int(k["id"]) <= hi_id) or k["tenant_id"] != p["tenant_id"]:
                    continue
                try:
                    kp = json.loads(k["request_json_data"]).get("workflowparams") or {}
                    knodes, korder, kt1, kcode = parse_nodes(json.loads(k["nodes_data"] or "[]"))
                except (ValueError, TypeError):
                    continue
                if kp.get("transaction_type") != "SA":
                    continue
                if trx is not None and str(kp.get("trx_no")) != str(trx):
                    nf += 1
                    continue
                if "itemData" in kp:
                    kp["itemData"] = slim(kp["itemData"])
                kt0 = int(k["start_date"] or 0) or ((int(k["id"]) >> 22) + EPOCH)
                mine.append({"id": k["id"], "kind": KIDS[k["workflow_id"]], "tenant": k["tenant_id"], "env": env[2:], "status": k["status"],
                             "exit": k["current_node_id"], "error": (k.get("error_msg") or "")[:300], "t0": kt0,
                             "t1": int(k["end_date"] or 0) or kt1 or kt0, "code": kcode, "params": kp, "order": korder, "nodes": knodes})
            rec = {"id": p["id"], "env": env[2:], "tenant": p["tenant_id"], "status": p["status"], "exit": p["current_node_id"],
                   "error": (p.get("error_msg") or "")[:300], "t0": int(p["start_date"]), "t1": int(p["end_date"]) or t1,
                   "saveAs": wp.get("saveAs"), "pageStatus": page, "o4": {"allData": all_data, "stock_adjustment_status": status},
                   "o4From": o4_from, "hdr": hdr, "hdrFrom": hdr_from, "trx": trx, "items": items, "order": order,
                   "foreign": nf, "calls": mine}
            fh.write(json.dumps(ids_as_text(rec), ensure_ascii=False) + "\n")
            got += 1
            calls += len(mine)
            foreign += nf
    print(f"{env} STOCK_ADJUSTMENT since {since}" + (f" until {until}" if until else "") + f": {got} runs, {calls} child calls kept, {foreign} SA child runs of another trx_no in a window -> {outfile}")


if __name__ == "__main__":
    main()

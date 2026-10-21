"""Pull the recorded classic IA_SAVE runs (read-only) and, inside each, its recorded ADD_INVENTORY / SUBTRACT_INVENTORY child runs
into JSONL for replay_ia.js. One line per IA_SAVE run:

  {id, env, tenant, status, exit, error, t0, t1, saveAs, pageStatus, doc, docFrom, hdr, hdrFrom, trx, items, receipt, addAnswer,
   outRead, batchNumber, order, foreign, calls: [child, ...]}

  doc       code_fillback's allData (the lines the classic issue loop iterates, line_index = array order), HTML strings dropped;
            docFrom "fillback" | "request" (the node output was cut: the request's allData with the fillback's line rules applied)
  hdr       the STORED header the classic read its number / dates back from: add_ia (Add) or get_ia (Edit), HTML dropped
  trx       code_persisted.stock_movement_no (the number every movement carries)
  items     search_items rows, slimmed to what the engine's item adapter and price.js read (+ assembly_cost)
  receipt   code_receipt_prep's output minus itemData (the classic's receipt params incl. its unit_price)
  addAnswer wf_add's answer; outRead = search_movements rows (the OUT rows the classic priced the receipt from)
  calls     the child runs in id order: {id, kind, status, exit, error, t0, t1, code, params, order, nodes} (fetch_runs_sa.py's record)
  foreign   ADD / SUBTRACT runs in the window with transaction_type "IA" but another trx_no (expected 0)

Children = ADD_INVENTORY / SUBTRACT_INVENTORY runs of the run's tenant inside its window (start_date - 0.5 s .. end_date + 0.5 s,
as snowflake id bounds: su_code_workflow_inst is filtered by workflow_id + id only, never by a date) whose request says
transaction_type "IA" and trx_no = the IA's number. Copied from scratchpad/sav2/parity/fetch_runs_sa.py (child record format,
item slimming, code version, window); the parent walk is IA_SAVE's (package E, IA V2).

usage: python3 fetch_runs_ia.py <--prod|--dev> <out.jsonl> [--since YYYY-MM-DD[THH:MM]] [--until YYYY-MM-DD[THH:MM]]
  --since / --until are MYT. Default since 2026-09-11 (the first IA_SAVE run on dev; prod's start 2026-09-26).
Fixtures hold customer data: dev output goes outside the repo; --prod output only under ialib.PROD_FIXTURES (refused elsewhere)."""
import datetime, json, os, sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ialib as L  # noqa: E402

IA_WF = "2098335576774463489"  # IA_SAVE v11 (dev = prod)
KIDS = {"2012005532688723970": "ADD", "2012096660219564034": "SUBTRACT"}  # ADD_INVENTORY v65; SUBTRACT_INVENTORY v59 dev / v58 prod
SLACK_MS = 500
Q8 = "const q8 = (v) => Number((parseFloat(v) || 0).toFixed(8))"
ITEM_KEYS = ("id", "material_code", "stock_control", "based_uom", "material_costing_method", "purchase_unit_price", "item_batch_management", "table_uom_conversion",
             "assembly_cost", "batch_number_genaration", "serial_number_management")
ITEM_NODES = ("code_node_TC1cqaOy", "code_node_3XzQSsce", "get_node_BWe6rbru", "get_node_cnqECQ8X")  # the child workflows' ItemData outputs / item get-nodes


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
    out = {k: it[k] for k in ITEM_KEYS if k in it}
    if isinstance(out.get("table_uom_conversion"), list):
        out["table_uom_conversion"] = [{k: c.get(k) for k in ("alt_uom_id", "base_uom_id", "alt_qty", "base_qty")} for c in out["table_uom_conversion"] if isinstance(c, dict)]
    return out


def no_html(d):
    if not isinstance(d, dict):
        return d
    return {k: v for k, v in d.items() if not (isinstance(v, str) and ("<!DOCTYPE" in v or "<html" in v))}


def to_id(text):
    at = datetime.datetime.fromisoformat(text).replace(tzinfo=datetime.timezone(datetime.timedelta(hours=8)))
    return (int(at.timestamp() * 1000) - L.EPOCH) << 22


def parse_nodes(raw):
    """fetch_runs_sa.py's node walk: {node_id: {type, status, cut, resp}}, the order, the last end, the code version"""
    nodes, order, t1, code_seen = {}, [], 0, set()
    for n in raw:
        t1 = max(t1, int(n.get("end_time_millis") or 0))
        nid = n.get("node_id")
        if not nid:
            continue
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
    """IA_SAVE code_fillback's line rules (used only when its recorded output was cut)"""
    q8 = lambda v: float(f"{float(v or 0):.8f}") if str(v or "").strip() not in ("", "None") else 0.0  # noqa: E731
    d = dict(all_data)
    lines = []
    for i, ln in enumerate(d.get("stock_movement") or []):
        ln = dict(ln)
        ln["requested_qty"] = q8(ln.get("requested_qty"))
        ln["total_quantity"] = q8(ln.get("total_quantity"))
        ln["organization_id"] = d.get("organization_id")
        ln["issuing_plant"] = d.get("issuing_operation_faci") or None
        ln["line_index"] = i + 1
        lines.append(ln)
    d["stock_movement"] = lines
    d["item_qty"] = q8(d.get("item_qty"))
    d["inventory_category"] = d.get("inventory_category") or "Unrestricted"
    return d


def main():
    env, outfile = sys.argv[1], sys.argv[2]
    if env not in ("--prod", "--dev"):
        raise SystemExit(__doc__)
    L.guard_out(outfile)
    if env == "--prod":
        L.guard_prod(outfile)
    since = L.arg("--since", "2026-09-11")
    until = L.arg("--until")
    lo = to_id(since)
    hi = f"AND id < {to_id(until)}" if until else ""
    heads = L.q(f"SELECT CAST(id AS CHAR) id FROM su_code_workflow_inst WHERE workflow_id={IA_WF} AND id >= {lo} {hi} ORDER BY id", env)
    parents = []
    for part in L.chunks([h["id"] for h in heads], 20):
        parents += L.q("SELECT CAST(id AS CHAR) id, tenant_id, status, current_node_id, error_msg, start_date, end_date, request_json_data, nodes_data "
                       f"FROM su_code_workflow_inst WHERE workflow_id={IA_WF} AND id IN ({','.join(part)})", env)
    parents.sort(key=lambda r: int(r["id"]))
    kid_ids = []
    for part in L.chunks(parents, 25):
        conds = " OR ".join(f"(id BETWEEN {(int(p['start_date']) - SLACK_MS - L.EPOCH) << 22} AND {(int(p['end_date'] or p['start_date']) + SLACK_MS - L.EPOCH) << 22} "
                            f"AND tenant_id='{L.digits(p['tenant_id'], 'tenant')}')" for p in part)
        kid_ids += [r["id"] for r in L.q(f"SELECT CAST(id AS CHAR) id FROM su_code_workflow_inst WHERE workflow_id IN ({','.join(KIDS)}) AND ({conds})", env)]
    kids = []
    for part in L.chunks(kid_ids, 25):
        kids += L.q("SELECT CAST(id AS CHAR) id, CAST(workflow_id AS CHAR) workflow_id, tenant_id, status, current_node_id, error_msg, start_date, end_date, request_json_data, "
                    f"nodes_data FROM su_code_workflow_inst WHERE id IN ({','.join(part)}) AND request_json_data LIKE '%\"transaction_type\":\"IA\"%'", env)
    kids.sort(key=lambda r: int(r["id"]))
    got = calls = foreign = 0
    with open(outfile, "w") as fh:
        for p in parents:
            try:
                wp = json.loads(p["request_json_data"]).get("workflowparams") or {}
                nodes, order, t1, _ = parse_nodes(json.loads(p["nodes_data"] or "[]"))
            except (ValueError, TypeError):
                continue
            fb = out(nodes, "code_fillback")
            doc_from = "fillback"
            if not (isinstance(fb, dict) and isinstance(fb.get("allData"), dict)) or (nodes.get("code_fillback") or {}).get("cut"):
                fb = {"allData": fillback(wp.get("allData") or {})}
                doc_from = "request"
            doc = no_html(fb["allData"])
            page = wp.get("pageStatus")
            if page == "Edit":
                raw = out(nodes, "get_ia")
                hdr, hdr_from = ((raw or {}).get("data") if isinstance(raw, dict) else None), "get_ia"
            else:
                raw = out(nodes, "add_ia")
                hdr, hdr_from = (raw[0] if isinstance(raw, list) and raw else raw), "add_ia"
            if isinstance(hdr, list):
                hdr = hdr[0] if hdr else None
            hdr = no_html(hdr) if isinstance(hdr, dict) else None
            if hdr:
                hdr.pop("stock_movement", None)
            trx = (out(nodes, "code_persisted") or {}).get("stock_movement_no") or (hdr or {}).get("stock_movement_no")
            items = out(nodes, "search_items") or {}
            items = [slim(x) for x in (items.get("data") or [])] if isinstance(items.get("data"), list) else [slim(items["data"])] if isinstance(items.get("data"), dict) else []
            receipt = out(nodes, "code_receipt_prep")
            if isinstance(receipt, dict):
                receipt = {k: v for k, v in receipt.items() if k != "itemData"}
            out_read = out(nodes, "search_movements") or {}
            out_read = out_read.get("data") if isinstance(out_read.get("data"), list) else []
            lo_id = (int(p["start_date"]) - SLACK_MS - L.EPOCH) << 22
            hi_id = (int(p["end_date"] or p["start_date"]) + SLACK_MS - L.EPOCH) << 22
            mine, nf = [], 0
            for k in kids:
                if not (lo_id <= int(k["id"]) <= hi_id) or k["tenant_id"] != p["tenant_id"]:
                    continue
                try:
                    kp = json.loads(k["request_json_data"]).get("workflowparams") or {}
                    knodes, korder, kt1, kcode = parse_nodes(json.loads(k["nodes_data"] or "[]"))
                except (ValueError, TypeError):
                    continue
                if kp.get("transaction_type") != "IA":
                    continue
                if trx is not None and str(kp.get("trx_no")) != str(trx):
                    nf += 1
                    continue
                if "itemData" in kp:
                    kp["itemData"] = slim(kp["itemData"])
                kt0 = int(k["start_date"] or 0) or ((int(k["id"]) >> 22) + L.EPOCH)
                mine.append({"id": k["id"], "kind": KIDS[k["workflow_id"]], "tenant": k["tenant_id"], "env": env[2:], "status": k["status"], "exit": k["current_node_id"],
                             "error": (k.get("error_msg") or "")[:300], "t0": kt0, "t1": int(k["end_date"] or 0) or kt1 or kt0, "code": kcode, "params": kp,
                             "order": korder, "nodes": knodes})
            rec = {"id": p["id"], "env": env[2:], "tenant": p["tenant_id"], "status": p["status"], "exit": p["current_node_id"], "error": (p.get("error_msg") or "")[:300],
                   "t0": int(p["start_date"]), "t1": int(p["end_date"] or 0) or t1, "saveAs": wp.get("saveAs"), "pageStatus": page, "doc": doc, "docFrom": doc_from,
                   "hdr": hdr, "hdrFrom": hdr_from, "trx": trx, "items": items, "receipt": receipt, "addAnswer": out(nodes, "wf_add"), "outRead": out_read,
                   "batchNumber": (out(nodes, "code_batch_number") or {}).get("batchNumber"), "order": order, "foreign": nf, "calls": mine}
            fh.write(json.dumps(ids_as_text(rec), ensure_ascii=False) + "\n")
            got += 1
            calls += len(mine)
            foreign += nf
    print(f"{env} IA_SAVE since {since}" + (f" until {until}" if until else "") + f": {got} runs, {calls} child calls kept, {foreign} IA child runs of another trx_no -> {outfile}")


if __name__ == "__main__":
    main()

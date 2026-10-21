"""recon_ia.py <iaId> --tenant T [--before SNAP] [--job ID | --classic] [--posted] [--json OUT]
recon_ia.py revert <iaId> --tenant T --before SNAP [--job ID | --classic] [--json OUT]

Read-only reconciliation (SELECTs through .dbtools/db --dev only) of a V2-completed Item Assembly (CONTRACT sections 3-9):
  job       the IA's latest COMPLETE_IA job (IA|<id>): COMPLETED 100 %, no error; request_payload = the IA (iaId, iaNo, IF1 fingerprint,
            pickCount / nonStockLines / movementCount = the stored lines); its manifest; the latest IAC|<id> LOCK row holds its key
  steps     I0_REVALIDATE, I2_ISSUE, I3_RECEIPT, I4_FINISH DONE (+ I1_BATCH and the I1|I|001 intent for a batch parent); both engine
            operations IAC|<job>|I and IAC|<job>|R: IBA|DONE, no IBA|REVIEW; op 1's DONE summary = the stock picks
  header    Completed, posted_status Unposted (--posted: Pending Post / Fully Posted), ia_v2_job_id / ia_idem_key = the job's
  OUT rows  inventory_movement keyed IAC|<job>|I|M<n>: one per stock pick of the STORED lines, M<n> = the n-th pick in the classic
            loop order (ia_moves.js), item / bin / batch / category / qty / UOM / base qty / trx_no / doc_date / parent_trx_no '';
            non-stock (stock_control 0) lines move nothing
  receipt   ONE IN row IAC|<job>|R|R1: parent, header bin + category, item_qty in item_uom, base qty = price.js iaUomOf, I1's batch;
            unit_price = receiptUnitPrice(the stored OUT totals, base qty, assembly_cost) at the tenant rule (Fixed Cost: purchase
            price); the shared OUT_TOTALS SQL gives the same sum; non-stock lines add nothing
  cost row  FIFO parent: one new layer (base qty at the price); WA parent: a new batch row / the re-averaged row (--before)
  batch     batch parent: exactly one live Batch row, transaction_no = the IA number, = I1's batch_id = R1's batch, number = batch_no,
            initial_quantity = base qty; non-batch parent: NO Batch row (the deliberate difference from the classic's blank one)
  stock     every touched item_balance / item_batch_balance key: balance_quantity = its whole movement history (IN - OUT base qty);
            --before: also the delta = ALL window movements (ours + other sessions'), FIFO available delta = IN - OUT per material
  locks     no inventory_balance_lock row held on the touched materials; every row an IAC|<job>| operation owned is released
  items     the parent + every line item (non-stock too) stamped (update_time at or after the job's queue time)
  runs      su_code_workflow_inst of IA_V2_SUBMIT / WORKER / PREPARE / COMMIT / INVENTORY_BULK_APPLY for the job: status, seconds, MB
            (nodes_data / request / response) against config budget_mb (CONTRACT section 14)
revert: the REVERT_IA job (or --classic: IA_REVERT) - Draft, the number kept, posted_status blank; one IA-R movement per live row of the
completion (IAV|<job>|M<n>); stock back to the --before snapshot (taken BEFORE the completion) + other sessions' window movements; the
parent's layer / WA row and the Batch row removed; V0-V4 DONE; locks (incl. IAV|<job>|C) released.
Exit 1 on any failed check. Writes nothing but --json (outside the repo)."""
import importlib.util, json, os, subprocess, sys
from decimal import Decimal

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import ialib as L  # noqa: E402
import v2build as V  # noqa: E402  (iav2/lib, for .sub)

D = L.dec
spec = importlib.util.spec_from_file_location("ia_shared_sql", os.path.join(L.IAV2, "code", "shared", "sql.py"))
S = importlib.util.module_from_spec(spec)
spec.loader.exec_module(S)

FAILS, INFOS = [], []


def ok(cond, text):
    print(("ok    " if cond else "FAIL  ") + text)
    if not cond:
        FAILS.append(text)
    return cond


def info(text):
    print("info  " + text)
    INFOS.append(text)


def node(script, payload):
    r = subprocess.run(["node", "-e", script], input=json.dumps(payload), capture_output=True, text=True, cwd=HERE)
    if r.returncode:
        raise RuntimeError(r.stderr[:800])
    return json.loads(r.stdout)


def same_stored(a, b, rule_dp=None):
    """price.js / ia_common iaSameStored: equal, or b = a at some dp (round / truncate / ceil)"""
    return node("const C = require('../code/shared/ia_common.js'); const p = JSON.parse(require('fs').readFileSync(0, 'utf8'));"
                "console.log(JSON.stringify(p.map(([a, b]) => C.iaSameStored(a, b))));", [[a, b]])[0]


class R:
    pass


def read_ia(r):
    # the form publish creates ia_v2_job_id / ia_idem_key (CONTRACT section 12): read NULL until then
    cols = L.col_types("sm_item_assembly")
    v2 = ", ".join(f"{c}" if c in cols else f"NULL {c}" for c in ("ia_v2_job_id", "ia_idem_key"))
    h = L.q(f"SELECT CAST(id AS CHAR) id, stock_movement_no, item_assembly_status, posted_status, {v2}, item_id, CAST(item_qty AS CHAR) item_qty, "
            "CAST(item_uom AS CHAR) item_uom, CAST(location_id AS CHAR) location_id, inventory_category, batch_no, CAST(issuing_operation_faci AS CHAR) plant, organization_id, "
            "DATE_FORMAT(item_assembly_date, '%Y-%m-%d %H:%i:%s') item_assembly_date, DATE_FORMAT(manufacturing_date, '%Y-%m-%d %H:%i:%s') manufacturing_date, "
            "DATE_FORMAT(expired_date, '%Y-%m-%d %H:%i:%s') expired_date, remarks, remarks_2, remarks_3, table_hu, DATE_FORMAT(create_time, '%Y-%m-%d %H:%i:%s') created "
            f"FROM sm_item_assembly WHERE {r.TQ} AND id = {r.ia} AND is_deleted = 0")
    if not h:
        raise SystemExit(f"IA {r.ia} not found in tenant {r.T}")
    lines = L.q("SELECT CAST(id AS CHAR) id, line_index, item_selection, CAST(quantity_uom AS CHAR) quantity_uom, CAST(total_quantity AS CHAR) total_quantity, "
                f"temp_qty_data, temp_hu_data FROM sm_item_assembly_tlm8ve69_sub WHERE {r.TQ} AND sm_item_assembly_id = {r.ia} AND is_deleted = 0 ORDER BY id")
    return h[0], lines


def read_items(r, ids):
    items = {}
    for part in L.chunks(sorted({L.digits(i, "item") for i in ids}, key=int), 500):
        for it in L.q("SELECT CAST(id AS CHAR) id, material_code, stock_control, material_costing_method, item_batch_management, CAST(based_uom AS CHAR) based_uom, "
                      "CAST(purchase_unit_price AS CHAR) purchase_unit_price, CAST(assembly_cost AS CHAR) assembly_cost, "
                      "DATE_FORMAT(update_time, '%Y-%m-%d %H:%i:%s') update_time, DATE_FORMAT(last_transaction_date, '%Y-%m-%d %H:%i:%s') ltd "
                      f"FROM item WHERE {r.TQ} AND id IN ({','.join(part)})"):
            it["table_uom_conversion"] = []
            items[it["id"]] = it
        for u in L.q("SELECT CAST(Item_id AS CHAR) item, CAST(alt_uom_id AS CHAR) alt_uom_id, CAST(base_qty AS CHAR) base_qty FROM item_mji552rc_sub "
                     f"WHERE {r.TQ} AND is_deleted = 0 AND Item_id IN ({','.join(part)}) ORDER BY id"):
            if u["item"] in items:
                items[u["item"]]["table_uom_conversion"].append({"alt_uom_id": u["alt_uom_id"], "base_qty": u["base_qty"]})
    return items


def engine_moves(hdr, lines, items, job, base, cost, batch):
    p = {"doc": {"stock_movement": lines}, "hdr": hdr, "items": items, "opts": {"jobId": job, "receiptBaseQty": base, "assemblyCost": cost, "batchId": batch}}
    return node("const M = require('./ia_moves.js'); const p = JSON.parse(require('fs').readFileSync(0, 'utf8'));"
                "console.log(JSON.stringify(M.iaEngineMoves(p.doc, p.hdr, p.items, p.opts)));", p)


def price_of(parent, item_qty, item_uom, out_total):
    p = {"item": parent, "qty": item_qty, "uom": item_uom, "out": out_total, "cost": parent.get("assembly_cost")}
    return node("const P = require('../code/shared/price.js'); const p = JSON.parse(require('fs').readFileSync(0, 'utf8'));"
                "const b = P.iaUomOf(p.item, p.qty, p.uom).baseQty; const c = Number((parseFloat(p.cost) || 0).toFixed(8));"
                "console.log(JSON.stringify({ base: b, cost: c, price: P.receiptUnitPrice({ outTotals: [p.out], receiptBaseQty: b, assemblyCost: c }) }));", p)


def fingerprint(lines_j, header_j):
    return node("const F = require('../code/shared/fingerprint.js'); const p = JSON.parse(require('fs').readFileSync(0, 'utf8'));"
                "console.log(JSON.stringify(F.iaLineFingerprint(p.l, p.h)));", {"l": lines_j, "h": header_j})


def mv_cols():
    return ("CAST(id AS CHAR) id, operation_effect_key k, transaction_type tt, trx_no, movement, inventory_category cat, parent_trx_no ptn, CAST(item_id AS CHAR) item_id, "
            "CAST(bin_location_id AS CHAR) bin, CAST(batch_number_id AS CHAR) batch, CAST(quantity AS CHAR) qty, CAST(base_qty AS CHAR) base_qty, CAST(uom_id AS CHAR) uom, "
            "CAST(base_uom_id AS CHAR) base_uom, CAST(unit_price AS CHAR) unit_price, CAST(total_price AS CHAR) total_price, costing_method_id, "
            "DATE_FORMAT(doc_date, '%Y-%m-%d %H:%i:%s') doc_date, CAST(handling_unit_id AS CHAR) hu, organization_id org, CAST(plant_id AS CHAR) plant")


def ledger(r, keys):
    """balance_quantity of every touched key vs its whole movement history (IN - OUT base qty), item and batch level"""
    mats = sorted({k[0] for k in keys}, key=int)
    led_i, led_b, bal_i, bal_b = {}, {}, {}, {}
    for part in L.chunks(mats, 500):
        ids = ",".join(part)
        for m in L.q("SELECT CAST(item_id AS CHAR) m, CAST(bin_location_id AS CHAR) b, CAST(COALESCE(batch_number_id, 0) AS CHAR) bt, "
                     "CAST(SUM(CASE WHEN movement = 'IN' THEN base_qty ELSE -base_qty END) AS CHAR) q FROM inventory_movement "
                     f"WHERE {r.TQ} AND is_deleted = 0 AND plant_id = {r.plant} AND item_id IN ({ids}) GROUP BY 1, 2, 3"):
            led_i[(m["m"], m["b"])] = led_i.get((m["m"], m["b"]), Decimal(0)) + D(m["q"])
            if m["bt"] != "0":
                led_b[(m["m"], m["b"], m["bt"])] = D(m["q"])
        for b in L.q("SELECT CAST(material_id AS CHAR) m, CAST(location_id AS CHAR) b, CAST(SUM(balance_quantity) AS CHAR) q FROM item_balance "
                     f"WHERE {r.TQ} AND is_deleted = 0 AND plant_id = {r.plant} AND material_id IN ({ids}) GROUP BY 1, 2"):
            bal_i[(b["m"], b["b"])] = D(b["q"])
        for b in L.q("SELECT CAST(material_id AS CHAR) m, CAST(location_id AS CHAR) b, CAST(batch_id AS CHAR) bt, CAST(SUM(balance_quantity) AS CHAR) q "
                     f"FROM item_batch_balance WHERE {r.TQ} AND is_deleted = 0 AND plant_id = {r.plant} AND material_id IN ({ids}) GROUP BY 1, 2, 3"):
            bal_b[(b["m"], b["b"], b["bt"])] = D(b["q"])
    ik = {(k[0], k[1]) for k in keys}
    bk = {k for k in keys if k[2]}
    off_i = [(k, str(bal_i.get(k)), str(led_i.get(k))) for k in sorted(ik) if bal_i.get(k, Decimal(0)) != led_i.get(k, Decimal(0))]
    off_b = [(k, str(bal_b.get(k)), str(led_b.get(k))) for k in sorted(bk) if bal_b.get(k, Decimal(0)) != led_b.get(k, Decimal(0))]
    return len(ik), off_i, len(bk), off_b


def window_check(r, before, keys):
    """--before: balance / FIFO deltas of the touched keys = ALL window movements (ours and other sessions')"""
    lo = L.digits(before["meta"]["max_mv_id"], "max_mv_id")
    mats = sorted({k[0] for k in keys}, key=int)
    win = []
    for part in L.chunks(mats, 500):
        win += L.q(f"SELECT {mv_cols()} FROM inventory_movement WHERE {r.TQ} AND is_deleted = 0 AND id > {lo} AND plant_id = {r.plant} AND item_id IN ({','.join(part)})")
    exp = {}
    for m in win:
        k = (m["item_id"], m["bin"])
        exp[k] = exp.get(k, Decimal(0)) + (1 if m["movement"] == "IN" else -1) * D(m["base_qty"])
    b0 = {}
    for row in before.get("ib", []):
        if not row.get("is_deleted"):
            k = (str(row["material_id"]), str(row["location_id"]))
            b0[k] = b0.get(k, Decimal(0)) + D(row["balance_quantity"])
    now = {}
    for part in L.chunks(mats, 500):
        for b in L.q("SELECT CAST(material_id AS CHAR) m, CAST(location_id AS CHAR) b, CAST(SUM(balance_quantity) AS CHAR) q FROM item_balance "
                     f"WHERE {r.TQ} AND is_deleted = 0 AND plant_id = {r.plant} AND material_id IN ({','.join(part)}) GROUP BY 1, 2"):
            now[(b["m"], b["b"])] = D(b["q"])
    bad = [(k, str(now.get(k, 0) - b0.get(k, 0)), str(d)) for k, d in exp.items() if now.get(k, Decimal(0)) - b0.get(k, Decimal(0)) != d]
    moved = [k for k in set(now) | set(b0) if now.get(k, Decimal(0)) != b0.get(k, Decimal(0)) and k not in exp]
    return win, bad, moved


def held_on(r, mats):
    held = []
    for part in L.chunks(sorted(mats, key=int), 500):
        held += L.q("SELECT lock_key, owner_operation_id FROM inventory_balance_lock WHERE " + r.TQ + f" AND organization_id = '{r.org}' AND is_deleted = 0 "
                    "AND (free_token IS NULL OR free_token <> 1) AND SUBSTRING_INDEX(SUBSTRING_INDEX(lock_key, '|', 2), '|', -1) IN ("
                    + ",".join("'" + m + "'" for m in part) + ")")
    return held


def runs_of(r, job, key, names):
    ids = L.load_ids()
    cfg = L.load_config()
    lo = int(job["id"]) - (15 * 60 * 1000 << 22)
    out = []
    for name in names:
        wid = ids.get(name) or cfg["workflows_classic"].get(name) or "0"
        if not wid or wid == "0":
            info(f"{name}: shell id not set in ids.json - its runs are not read")
            continue
        pat = key if name.endswith("_SUBMIT") else (f"IAC|{job['id']}|" if name == "INVENTORY_BULK_APPLY" else job["id"])
        if not all(ch.isalnum() or ch in "|:_.-" for ch in pat):
            continue
        out += L.q(f"SELECT CAST(id AS CHAR) id, '{name}' wf, status, current_node_id, start_date, end_date, run_time, LENGTH(nodes_data) nd, LENGTH(request_json_data) rq, "
                   f"LENGTH(response_json_data) rs, LEFT(response_json_data, 300) head FROM su_code_workflow_inst WHERE workflow_id = {L.digits(wid, name)} AND id > {lo} "
                   f"AND tenant_id = '{r.T}' AND request_json_data LIKE '%{pat}%' ORDER BY id")
    return sorted(out, key=lambda x: int(x["id"]))


def print_runs(runs, budget):
    over = []
    print("      runs (MB nodes_data / request / response; seconds):")
    for x in runs:
        try:
            secs = (int(x["end_date"]) - int(x["start_date"])) / 1000
        except (TypeError, ValueError):
            secs = float(x.get("run_time") or 0) / 1000
        path = ""
        head = (x.get("head") or "").replace(" ", "")
        for p in ("PARK", "SPLIT", "DONE", "I0_END", "I1_END", "I2_END", "I3_END", "I4_END", "ENTRY_END", "NO_WRITE", "LOST"):
            if f'"path":"{p}' in head:
                path = p
        nd = int(x["nd"] or 0) / 1e6
        print(f"        {x['wf']:22s} {x['id']} {str(x['status']):8s} exit {str(x['current_node_id'])[:26]:26s} {nd:7.2f} / {int(x['rq'] or 0) / 1e6:6.2f} / "
              f"{int(x['rs'] or 0) / 1e6:6.2f} {secs:7.1f}s {path}")
        if x["wf"] in budget and nd > float(budget[x["wf"]]):
            over.append((x["wf"], x["id"], round(nd, 2)))
    return over


def completion(r, args):
    hdr, lines = read_ia(r)
    no = hdr["stock_movement_no"]
    classic = args.get("classic")
    job, jid, req, man = None, None, {}, {}
    if not classic:
        jobs = L.q("SELECT CAST(id AS CHAR) id, command, idempotency_key, correlation_id, job_status, progress_percent, progress_message, error_code, error_message, "
                   "attempt_count, line_count, request_payload, prepared_payload, DATE_FORMAT(queued_at, '%Y-%m-%d %H:%i:%s') queued_at, "
                   "DATE_FORMAT(finished_at, '%Y-%m-%d %H:%i:%s') finished_at FROM gd_async_job WHERE " + r.TQ + " AND is_deleted = 0 AND command = 'COMPLETE_IA' AND "
                   + (f"id = {L.digits(args['job'], '--job')}" if args.get("job") else f"correlation_id = 'IA|{r.ia}'") + " ORDER BY id DESC")
        if not jobs:
            raise SystemExit(f"no COMPLETE_IA job for IA {r.ia} (a classic completion: --classic)")
        job = jobs[0]
        jid = job["id"]
        req = json.loads(job["request_payload"] or "{}")
        man = json.loads(job["prepared_payload"] or "{}")
        print(f"IA {r.ia} {no} {hdr['item_assembly_status']} / {hdr['posted_status']}; job {jid} {job['job_status']} {job['progress_percent']}% attempts {job['attempt_count']} "
              f"queued {job['queued_at']} finished {job['finished_at']}")
        ok(job["job_status"] == "COMPLETED" and str(job["progress_percent"]) == "100" and not job["error_code"],
           f"job COMPLETED 100 % without error ({job['job_status']} {job['progress_percent']} {job['error_code'] or ''} {(job['error_message'] or '')[:160]})")
    else:
        print(f"IA {r.ia} {no} {hdr['item_assembly_status']} / {hdr['posted_status']} - CLASSIC completion (no job; movements by trx_no, the classic price formula)")
    posted = ("Pending Post", "Fully Posted", "Unposted") if args.get("posted") else ("Unposted",)
    ok(hdr["item_assembly_status"] in (("Completed", "Fully Posted") if args.get("posted") else ("Completed",)) and hdr["posted_status"] in posted
       and no not in ("", "issued", "draft", None), f"header {hdr['item_assembly_status']} / {hdr['posted_status']}, number {no}")
    if not classic:
        ok(str(hdr["ia_v2_job_id"] or "") == jid and str(hdr["ia_idem_key"] or "") == job["idempotency_key"],
           f"ia_v2_job_id {hdr['ia_v2_job_id']} / ia_idem_key = the job's ({job['idempotency_key'][:60]})")
    items = read_items(r, {hdr["item_id"]} | {l["item_selection"] for l in lines if str(l["item_selection"] or "").isdigit()})
    parent = items[hdr["item_id"]]
    batch_parent = str(parent["item_batch_management"]) == "1"
    method = parent["material_costing_method"]
    batch_id = None
    if not classic:
        i1 = L.q(f"SELECT step_name, step_status, result_ref FROM gd_publish_step WHERE {r.TQ} AND job_id = '{jid}' AND step_name IN ('I1_BATCH', 'I1|I|001') AND is_deleted = 0")
        i1d = next((json.loads(x["result_ref"]) for x in i1 if x["step_name"] == "I1_BATCH" and (x["result_ref"] or "").startswith("{")), {})
        batch_id = str(i1d.get("batch_id") or "") or None
        out_rows = L.q(f"SELECT {mv_cols()} FROM inventory_movement WHERE {r.TQ} AND is_deleted = 0 AND id > {jid} AND operation_effect_key LIKE 'IAC|{jid}|I|%' ORDER BY id")
        inn = L.q(f"SELECT {mv_cols()} FROM inventory_movement WHERE {r.TQ} AND is_deleted = 0 AND id > {jid} AND operation_effect_key LIKE 'IAC|{jid}|R|%' ORDER BY id")
    else:
        own = L.q(f"SELECT {mv_cols()} FROM inventory_movement WHERE {r.TQ} AND is_deleted = 0 AND id > {r.ia} AND transaction_type = 'IA' AND organization_id = '{r.org}' "
                  f"AND trx_no = (SELECT h.stock_movement_no FROM sm_item_assembly h WHERE h.{r.TQ} AND h.id = {r.ia}) ORDER BY id")
        out_rows = [m for m in own if m["movement"] == "OUT"]
        inn = [m for m in own if m["movement"] == "IN"]
        batch_id = (inn[0]["batch"] if inn else None) if batch_parent else None
    out_total = sum((D(m["total_price"]) for m in out_rows), Decimal(0))
    pr = price_of(parent, hdr["item_qty"], hdr["item_uom"], str(out_total))
    if not classic:
        # PREPARE fixed receiptBaseQty / assemblyCost in the ENGINE_R part (CONTRACT section 5): the price expectation uses them
        parts = L.q(f"SELECT step_name, result_ref FROM gd_publish_step WHERE {r.TQ} AND job_id = '{jid}' AND step_name LIKE 'P|%|ENGINE_R|%' AND is_deleted = 0 ORDER BY step_name")
        er = None
        if parts:
            try:
                er = json.loads("".join(p["result_ref"] or "" for p in parts))
            except ValueError:
                er = None
        if ok(isinstance(er, dict), f"ENGINE_R part readable ({len(parts)} row(s))") and er:
            ok(D(str(er.get("receiptBaseQty"))) == D(str(pr["base"])) and D(str(er.get("assemblyCost"))) == D(str(pr["cost"])),
               f"ENGINE_R receiptBaseQty {er.get('receiptBaseQty')} / assemblyCost {er.get('assemblyCost')} = the item master's {pr['base']} / {pr['cost']}")
            pr = price_of(dict(parent, assembly_cost=er.get("assemblyCost")), hdr["item_qty"], hdr["item_uom"], str(out_total)) | {"base": er.get("receiptBaseQty")}
            pr["price"] = node("const P = require('../code/shared/price.js'); const p = JSON.parse(require('fs').readFileSync(0, 'utf8'));"
                               "console.log(JSON.stringify(P.receiptUnitPrice({ outTotals: [p.o], receiptBaseQty: p.b, assemblyCost: p.c })));",
                               {"o": str(out_total), "b": er.get("receiptBaseQty"), "c": er.get("assemblyCost")})
    built = engine_moves(hdr | {"issuing_operation_faci": hdr["plant"]}, lines, items, jid or "0", pr["base"], pr["cost"], batch_id)
    cn = built["counts"]
    ok(not built["bad"], f"the stored lines build cleanly ({built['bad'][:2]})")
    if not classic:
        lines_j = [{"j": json.dumps({"id": l["id"], "line_index": l["line_index"], "item_selection": l["item_selection"], "quantity_uom": l["quantity_uom"],
                                     "total_quantity": l["total_quantity"], "temp_qty_data": l["temp_qty_data"]})} for l in lines]
        header_j = [{"j": json.dumps({k: hdr[k] for k in ("item_id", "item_qty", "item_uom", "location_id", "inventory_category", "batch_no")} | {"issuing_operation_faci": hdr["plant"]})}]
        fp = fingerprint(lines_j, header_j)
        ok(req.get("iaId") == r.ia and req.get("iaNo") == no and req.get("action") == "DIRECT" and req.get("prevStatus") == "Draft" and req.get("saveAs") == "Completed",
           f"request_payload names this IA ({req.get('iaId')}, {req.get('iaNo')}, {req.get('action')}, prev {req.get('prevStatus')})")
        ok(req.get("lineFingerprint") == fp, f"request lineFingerprint {req.get('lineFingerprint')} = the stored lines' {fp}")
        ok(int(req.get("pickCount", -1)) == cn["picks"] and int(req.get("nonStockLines", -1)) == cn["nonStock"] and int(req.get("movementCount", -1)) == cn["movementsI"] + 1
           and int(job["line_count"] or -1) == cn["picks"],
           f"counts: pickCount {req.get('pickCount')} / nonStockLines {req.get('nonStockLines')} / movementCount {req.get('movementCount')} / line_count {job['line_count']} "
           f"vs stored {cn['picks']} / {cn['nonStock']} / {cn['movementsI'] + 1}")
        if man:
            ok(man.get("job_id") == jid and man.get("ia_id") == r.ia and man.get("batchMode") == ("insert" if batch_parent else "none"),
               f"manifest job {man.get('job_id')} ia {man.get('ia_id')} batchMode {man.get('batchMode')} counts {man.get('counts')}")
        lock = L.q(f"SELECT step_name, result_ref FROM gd_publish_step WHERE {r.TQ} AND job_id = 'IAC|{r.ia}' AND step_name LIKE 'LOCK|%' AND is_deleted = 0 ORDER BY id DESC LIMIT 1")
        ok(bool(lock) and lock[0]["result_ref"] == job["idempotency_key"], f"latest IAC|{r.ia} lock {lock[0]['step_name'] if lock else '-'} holds the job's key")
        st = L.q(f"SELECT job_id, step_name, step_status FROM gd_publish_step WHERE {r.TQ} AND is_deleted = 0 AND job_id IN ('{jid}', 'IAC|{jid}|I', 'IAC|{jid}|R') ORDER BY id")
        names = {(x["job_id"], x["step_name"]): x for x in st}
        for n in ["I0_REVALIDATE", "I2_ISSUE", "I3_RECEIPT", "I4_FINISH"] + (["I1_BATCH"] if batch_parent else []):
            ok(names.get((jid, n), {}).get("step_status") == "DONE", f"step {n} DONE")
        if batch_parent:
            ok((jid, "I1|I|001") in names, "I1 intent I1|I|001 written before the Batch insert")
        elif (jid, "I1_BATCH") in names:
            info(f"I1_BATCH {names[(jid, 'I1_BATCH')]['step_status']} on a non-batch parent (nothing to insert)")
        parts = sorted({x["step_name"].split("|")[2] for x in st if x["job_id"] == jid and x["step_name"].startswith("P|") and x["step_name"].count("|") >= 3})
        want_parts = {"ENGINE_I", "ENGINE_R", "LABELS", "ITEMS"} | ({"BATCH"} if batch_parent else set())
        ok(want_parts <= set(parts) and "NONSTOCK" not in parts, f"PREPARE parts {parts} (want {sorted(want_parts)}, no NONSTOCK)")
        for side in ("I", "R"):
            eng = {n for (j, n) in names if j == f"IAC|{jid}|{side}"}
            ok("IBA|DONE" in eng and "IBA|REVIEW" not in eng, f"engine IAC|{jid}|{side}: {sorted(eng)[:5]}")
        done_i = L.q(f"SELECT CAST(JSON_EXTRACT(result_ref, '$.summary') AS CHAR) s FROM gd_publish_step WHERE {r.TQ} AND job_id = 'IAC|{jid}|I' AND step_name = 'IBA|DONE' "
                     "AND is_deleted = 0 AND JSON_VALID(result_ref) ORDER BY id DESC LIMIT 1")
        if done_i:
            info(f"op 1 DONE summary {(done_i[0]['s'] or '')[:300]}")
    # OUT rows vs the stored picks (V2: by key M<n> in order; classic: as a multiset)
    ms = built["I"]["movements"]
    ok(len(out_rows) == len(ms), f"OUT rows {'keyed IAC|' + jid + '|I|M<n>' if jid else 'by trx_no'}: {len(out_rows)} = the stored stock picks {len(ms)} "
       f"({cn['nonStock']} non-stock lines move nothing)")

    def base_of(m):
        it = items.get(m["material_id"]) or {}
        alt = m["material_uom"] or it.get("based_uom")
        conv = next((c for c in it.get("table_uom_conversion") or [] if str(c["alt_uom_id"]) == str(alt)), None)
        return D(m["quantity"]) * D(conv["base_qty"]) if conv else D(m["quantity"])
    sig_m = lambda m: (m["material_id"], m["location_id"], m["batch_id"] or "", m["inventory_category"], str(D(m["quantity"]).normalize()),  # noqa: E731
                       str(base_of(m).normalize()), m["material_uom"] or (items.get(m["material_id"]) or {}).get("based_uom") or "")
    sig_r = lambda x: (x["item_id"], x["bin"], x["batch"] or "", x["cat"], str(D(x["qty"]).normalize()), str(D(x["base_qty"]).normalize()), x["uom"] or "")  # noqa: E731
    bad = []
    if jid:
        by_key = {x["k"].split("|")[-1]: x for x in out_rows}
        for m in ms:
            x = by_key.get(m["movement_key"])
            if not x:
                bad.append((m["movement_key"], "missing"))
                continue
            d = [] if sig_r(x) == sig_m(m) else [f"{sig_r(x)} vs {sig_m(m)}"]
            d += [f"{c} {x.get(c)!r}" for c, v in (("tt", "IA"), ("trx_no", no), ("doc_date", m["doc_date"])) if x.get(c) != v]
            if x.get("ptn") not in (None, ""):
                d.append(f"parent_trx_no {x.get('ptn')!r}")
            if d:
                bad.append((m["movement_key"], d))
    else:
        got, want = sorted(sig_r(x) for x in out_rows), sorted(sig_m(m) for m in ms)
        if got != want:
            bad.append(("multiset", sorted(set(got) - set(want))[:2], sorted(set(want) - set(got))[:2]))
        bad += [(x["id"], "doc_date " + str(x["doc_date"])) for x in out_rows if x["doc_date"] != (ms[0]["doc_date"] if ms else None)]
    ok(not bad, f"every OUT row = its pick (item, bin, batch, category, qty, base qty, UOM{', trx_no, doc_date, parent_trx_no' if jid else ''}): {len(bad)} off {bad[:3]}")
    ns_items = {l["item_selection"] for l in lines if str((items.get(l["item_selection"]) or {}).get("stock_control")) == "0"}
    ok(not [m for m in out_rows if m["item_id"] in ns_items], f"no movement of the {len(ns_items)} non-stock line item(s)")
    if jid:
        tot_sql = L.q(V.sub(S.OUT_TOTALS, T=r.T, IA=r.ia, JOB=jid))[0]
        ok(int(tot_sql["n"]) == len(out_rows) and D(tot_sql["total"]) == out_total, f"shared OUT_TOTALS SQL: n {tot_sql['n']} total {tot_sql['total']} (rows {len(out_rows)} / {out_total})")
    # the receipt
    ok(len(inn) == 1 and (not jid or inn[0]["k"] == f"IAC|{jid}|R|R1"), f"one IN row{' IAC|' + jid + '|R|R1' if jid else ''} ({len(inn)})")
    if method == L.FIXED:
        expect = D(parent["purchase_unit_price"] or 0)
        how = f"purchase_unit_price {expect} (Fixed Cost)"
    elif classic:
        qty = D(hdr["item_qty"])
        expect = D(str(round(float(out_total / qty if qty > 0 else 0) + float(pr["cost"]), 8)))
        how = f"the classic q8({out_total} / item_qty {hdr['item_qty']} + {pr['cost']}) = {expect}"
    else:
        expect = D(str(pr["price"]))
        how = f"receiptUnitPrice: q8({out_total} / base {pr['base']} + assembly_cost {pr['cost']}) = {pr['price']}"
    if inn:
        x = inn[0]
        want = {"item_id": hdr["item_id"], "bin": hdr["location_id"], "cat": hdr["inventory_category"] or "Unrestricted", "movement": "IN", "tt": "IA", "trx_no": no}
        if batch_parent and not classic:
            want["batch"] = batch_id
        diff = [f"{c} {x.get(c)!r} vs {v!r}" for c, v in want.items() if (x.get(c) or None) != (v or None)]
        if not batch_parent and x.get("batch"):
            diff.append(f"batch {x['batch']} on a non-batch parent")
        if D(x["qty"]) != D(hdr["item_qty"]) or D(x["base_qty"]) != D(str(pr["base"])):
            diff.append(f"qty {x['qty']} / base {x['base_qty']} vs {hdr['item_qty']} / {pr['base']}")
        ok(not diff, f"R1: parent {parent['material_code']} into the header bin / category, qty {x['qty']} (base {x['base_qty']}), batch {x['batch'] or '-'}" + (f"; off {diff}" if diff else ""))
        ok(same_stored(float(expect), float(x["unit_price"])), f"receipt unit_price {x['unit_price']} = {how} at the tenant's price rule")
        ok(same_stored(float(expect) * float(pr["base"]), float(x["total_price"])), f"receipt total_price {x['total_price']} = price x base qty {pr['base']}")
        if method != L.FIXED and out_total == 0 and D(str(pr["cost"])) == 0:
            info("OUT total 0 and no assembly_cost: the price check is trivial for this IA (every consumed FIFO layer costs 0)")
        if not classic and D(hdr["item_qty"]) != D(str(pr["base"])):
            info(f"item_uom is not the base UOM ({hdr['item_qty']} -> base {pr['base']}): V2 divides by the base qty, the classic by item_qty (deliberate)")
    # parent cost row
    cid = jid or r.ia
    if method == L.FIFO and inn:
        lay = L.q("SELECT CAST(id AS CHAR) id, CAST(batch_id AS CHAR) batch, fifo_sequence, CAST(fifo_initial_quantity AS CHAR) ini, CAST(fifo_available_quantity AS CHAR) av, "
                  f"CAST(fifo_cost_price AS CHAR) price FROM fifo_costing_history WHERE {r.TQ} AND is_deleted = 0 AND id > {cid} AND plant_id = {r.plant} "
                  f"AND organization_id = '{r.org}' AND material_id = {hdr['item_id']}")
        near = lambda y: abs(L.id_ms(y["id"]) - L.id_ms(inn[0]["id"])) <= 60000  # noqa: E731  (written with the IN row: same APPLY / ADD run)
        mine = [y for y in lay if (y["batch"] or None) == (inn[0]["batch"] or None) and near(y)]
        ok(len(mine) == 1 and D(mine[0]["ini"]) == D(str(pr["base"])) and same_stored(float(expect), float(mine[0]["price"])),
           f"parent FIFO layer: {[(y['id'], y['fifo_sequence'], y['ini'], y['av'], y['price']) for y in mine]} (want one, {pr['base']} @ {expect})")
        if mine and D(mine[0]["av"]) != D(mine[0]["ini"]):
            info(f"the new layer was consumed since ({mine[0]['av']} of {mine[0]['ini']} left)")
    elif method == L.WA and inn:
        wa = L.q(f"SELECT CAST(id AS CHAR) id, CAST(batch_id AS CHAR) batch, CAST(wa_quantity AS CHAR) q, CAST(wa_cost_price AS CHAR) p FROM wa_costing_method WHERE {r.TQ} "
                 f"AND is_deleted = 0 AND plant_id = '{r.plant}' AND organization_id = '{r.org}' AND material_id = {hdr['item_id']} ORDER BY id")
        if inn[0]["batch"]:
            mine = [y for y in wa if y["batch"] == inn[0]["batch"] and abs(L.id_ms(y["id"]) - L.id_ms(inn[0]["id"])) <= 60000]
            ok(len(mine) == 1 and D(mine[0]["q"]) == D(str(pr["base"])) and same_stored(float(expect), float(mine[0]["p"])),
               f"parent WA row of its new batch: {mine} (want one, {pr['base']} @ {expect})")
        else:
            info(f"non-batch WA parent: the re-averaged row is now {[(y['id'], y['q'], y['p']) for y in wa if not y['batch']]} (check it against the --before snapshot)")
    # Batch row
    bt = L.q(f"SELECT CAST(id AS CHAR) id, batch_number, CAST(material_id AS CHAR) m, CAST(plant_id AS CHAR) plant, organization_id org, CAST(initial_quantity AS CHAR) iq, "
             f"transaction_no FROM batch WHERE {r.TQ} AND is_deleted = 0 AND id > {r.ia} AND organization_id = '{r.org}' "
             f"AND transaction_no = (SELECT h.stock_movement_no FROM sm_item_assembly h WHERE h.{r.TQ} AND h.id = {r.ia})")
    if batch_parent:
        rb = inn[0]["batch"] if inn else None
        ok(len(bt) == 1 and bt[0]["id"] == rb and (classic or bt[0]["id"] == batch_id) and bt[0]["m"] == hdr["item_id"] and bt[0]["batch_number"] == hdr["batch_no"]
           and D(bt[0]["iq"]) == D(str(pr["base"])) and bt[0]["plant"] == r.plant,
           f"one Batch row {[(x['id'], x['batch_number'], x['iq']) for x in bt]} = R1's batch {rb}" + ("" if classic else f" = I1's {batch_id}") + f", number {hdr['batch_no']!r}")
    elif classic:
        info(f"classic non-batch parent: {len(bt)} blank Batch row(s) {[(x['id'], x['batch_number']) for x in bt]} (the classic ADD_INVENTORY mints one; V2 writes none)")
    else:
        ok(not bt, f"no Batch row for the non-batch parent ({len(bt)}; the classic would have minted a blank one - deliberate V2 difference)")
    # stock vs movement history
    keys = {(m["item_id"], m["bin"], m["batch"] or "") for m in out_rows + inn}
    ni, off_i, nb, off_b = ledger(r, keys)
    ok(not off_i, f"item_balance: {ni} touched keys = their whole movement history ({len(off_i)} off {off_i[:3]})")
    ok(not off_b, f"item_batch_balance: {nb} touched keys = their history ({len(off_b)} off {off_b[:3]})")
    if args.get("before"):
        win, badw, moved = window_check(r, args["before"], keys)
        foreign = [m for m in win if m["trx_no"] != no]
        ok(not badw and not moved, f"window since the snapshot: {len(win)} movements ({len(foreign)} by other writers) explain every balance delta ({len(badw)} off, "
           f"{len(moved)} moved without one) {badw[:2]} {moved[:2]}")
    mats = {k[0] for k in keys}
    held = held_on(r, mats)
    ok(not held, f"no engine lock held on the {len(mats)} touched materials ({len(held)}: {[h['lock_key'] for h in held[:3]]})")
    if jid:
        mine = L.q("SELECT lock_key, owner_operation_id, free_token FROM inventory_balance_lock WHERE " + r.TQ + f" AND organization_id = '{r.org}' AND is_deleted = 0 "
                   f"AND (owner_operation_id LIKE 'IAC|{jid}|%' OR last_owner_operation_id LIKE 'IAC|{jid}|%')")
        ok(all(str(x["free_token"]) == "1" and not x["owner_operation_id"] for x in mine), f"{len(mine)} lock rows owned by IAC|{jid}| operations, all released")
    since = (job["queued_at"] if job else hdr["created"]) or ""
    stale = [i for i, it in items.items() if not it["update_time"] or it["update_time"] < since[:19]]
    ok(not stale, f"items stamped (parent + {len(items) - 1} line items, non-stock included): {len(stale)} not touched since {since} {stale[:3]}")
    if jid:
        over = print_runs(runs_of(r, job, job["idempotency_key"], ["IA_V2_SUBMIT", "IA_V2_WORKER", "IA_V2_PREPARE", "IA_V2_COMMIT", "INVENTORY_BULK_APPLY"]),
                          L.load_config()["budget_mb"])
        ok(not over, "node data within the CONTRACT section 14 budgets" + (f": over {over}" if over else ""))


def revert(r, args):
    hdr, lines = read_ia(r)
    before = args.get("before")
    if not before:
        raise SystemExit("revert needs --before (the snapshot taken BEFORE the completion)")
    no = hdr["stock_movement_no"]
    ok(hdr["item_assembly_status"] == "Draft" and (hdr["posted_status"] or "") == "", f"header Draft, posted_status blank ({hdr['item_assembly_status']} / {hdr['posted_status']!r}), number kept {no}")
    jid = None
    if not args.get("classic"):
        jobs = L.q("SELECT CAST(id AS CHAR) id, job_status, progress_percent, error_code, error_message, idempotency_key, request_payload, "
                   "DATE_FORMAT(queued_at, '%Y-%m-%d %H:%i:%s') queued_at FROM gd_async_job WHERE " + r.TQ + " AND is_deleted = 0 AND command = 'REVERT_IA' AND "
                   + (f"id = {L.digits(args['job'], '--job')}" if args.get("job") else f"correlation_id = 'IA|{r.ia}'") + " ORDER BY id DESC")
        if not jobs:
            raise SystemExit(f"no REVERT_IA job for IA {r.ia}")
        job = jobs[0]
        jid = job["id"]
        ok(job["job_status"] == "COMPLETED" and str(job["progress_percent"]) == "100" and not job["error_code"],
           f"REVERT_IA job {jid} COMPLETED ({job['job_status']} {job['error_code'] or ''} {(job['error_message'] or '')[:160]})")
        ok(str(hdr["ia_v2_job_id"] or "") == jid, f"ia_v2_job_id {hdr['ia_v2_job_id']} = the revert job")
        srows = L.q(f"SELECT job_id, step_name, step_status, result_ref FROM gd_publish_step WHERE {r.TQ} AND is_deleted = 0 AND job_id IN ('{jid}', 'IAV|{jid}') ORDER BY id")
        st = {x["step_name"]: x for x in srows}
        btxt = "".join(x["result_ref"] or "" for x in srows if "|BATCH|" in x["step_name"] and x["step_name"].startswith("P|"))
        try:
            bdel = json.loads(btxt).get("batchDeletes") if btxt else None
        except ValueError:
            bdel = None
        for n in ("V0_REVALIDATE", "V1_INVENTORY", "V2_COST", "V3_BATCH", "V4_FINISH"):
            if n == "V3_BATCH" and n not in st and bdel == []:
                ok(True, "step V3_BATCH skipped (the BATCH part lists no Batch row to remove)")
                continue
            ok(st.get(n, {}).get("step_status") == "DONE", f"step {n} DONE")
        ok("IBA|DONE" in st and "IBA|REVIEW" not in st, f"engine IAV|{jid}: IBA|DONE, no IBA|REVIEW")
    comp = L.q(f"SELECT {mv_cols()} FROM inventory_movement WHERE {r.TQ} AND id > {r.ia} AND trx_no = (SELECT h.stock_movement_no FROM sm_item_assembly h WHERE h.{r.TQ} "
               f"AND h.id = {r.ia}) AND organization_id = '{r.org}' AND is_deleted = 0 ORDER BY id")
    ia_rows = [m for m in comp if m["tt"] == "IA"]
    rv = [m for m in comp if m["tt"] == "IA-R"]
    if jid:
        rv_mine = [m for m in rv if str(m["k"] or "").startswith(f"IAV|{jid}|M")]
        ok(len(rv_mine) == len(rv), f"every IA-R row keyed IAV|{jid}|M<n> ({len(rv_mine)} of {len(rv)})")
    sig = lambda m: (m["item_id"], m["bin"], m["batch"] or "", m["cat"], str(D(m["base_qty"]).normalize()))  # noqa: E731
    want = sorted((sig(m), "IN" if m["movement"] == "OUT" else "OUT") for m in ia_rows)
    got = sorted((sig(m), m["movement"]) for m in rv)
    ok(got == want, f"one reverse IA-R movement per IA row: {len(rv)} vs {len(ia_rows)} (extra {sorted(set(got) - set(want))[:2]}, missing {sorted(set(want) - set(got))[:2]})")
    keys = {(m["item_id"], m["bin"], m["batch"] or "") for m in comp}
    win, badw, moved = window_check(r, before, keys)
    ours = [m for m in win if m["trx_no"] == no]
    foreign = [m for m in win if m["trx_no"] != no]
    net = {}
    for m in ours:
        k = (m["item_id"], m["bin"])
        net[k] = net.get(k, Decimal(0)) + (1 if m["movement"] == "IN" else -1) * D(m["base_qty"])
    ok(all(v == 0 for v in net.values()), f"the IA's own window movements net to zero on every key ({sum(1 for v in net.values() if v != 0)} not)")
    ok(not badw and not moved, f"stock back to the before-completion snapshot + {len(foreign)} other writers' movements ({len(badw)} off, {len(moved)} moved without one)")
    ni, off_i, nb, off_b = ledger(r, keys)
    ok(not off_i and not off_b, f"balances = movement history on {ni} + {nb} keys ({len(off_i) + len(off_b)} off)")
    parent = hdr["item_id"]
    lay = L.q(f"SELECT CAST(f.id AS CHAR) id, f.is_deleted, CAST(f.batch_id AS CHAR) batch_id, bt.transaction_no FROM fifo_costing_history f "
              f"LEFT JOIN batch bt ON bt.tenant_id = f.tenant_id AND bt.id = f.batch_id WHERE f.{r.TQ} AND f.id > {r.ia} AND f.plant_id = {r.plant} AND f.material_id = {parent}")
    b_ids = {str(x["id"]) for x in before.get("fifo", [])}
    # a layer on a Batch row another IA minted is that IA's receipt (other tests on the same parent in the window)
    foreign_l = [x for x in lay if x["batch_id"] and x["transaction_no"] and x["transaction_no"] != hdr["stock_movement_no"]]
    live_new = [{"id": x["id"], "is_deleted": x["is_deleted"]} for x in lay if x["id"] not in b_ids and not x["is_deleted"] and x not in foreign_l]
    ok(not live_new, f"the completion's parent FIFO layer(s) gone ({len(live_new)} live new layers: {live_new[:2]}; {len(foreign_l)} on other IAs' Batch rows skipped)")
    bt = L.q(f"SELECT CAST(id AS CHAR) id, batch_number, is_deleted FROM batch WHERE {r.TQ} AND transaction_no = (SELECT h.stock_movement_no FROM sm_item_assembly h "
             f"WHERE h.{r.TQ} AND h.id = {r.ia}) AND organization_id = '{r.org}' AND id > {r.ia}")
    ok(all(x["is_deleted"] for x in bt), f"the IA's Batch row(s) soft-deleted ({[(x['id'], x['batch_number'], x['is_deleted']) for x in bt]})")
    held = held_on(r, {k[0] for k in keys})
    ok(not held, f"no engine lock held on the touched materials ({[h['lock_key'] for h in held[:3]]})")
    if jid:
        mine = L.q("SELECT lock_key, owner_operation_id, free_token FROM inventory_balance_lock WHERE " + r.TQ + f" AND organization_id = '{r.org}' AND is_deleted = 0 "
                   f"AND (owner_operation_id LIKE 'IAV|{jid}%' OR last_owner_operation_id LIKE 'IAV|{jid}%')")
        ok(all(str(x["free_token"]) == "1" and not x["owner_operation_id"] for x in mine), f"{len(mine)} lock rows of IAV|{jid} (incl. the |C cost-row owner) released")
        over = print_runs(runs_of(r, job, job["idempotency_key"], ["IA_REVERT_V2_SUBMIT", "IA_REVERT_V2_WORKER", "IA_REVERT_V2_PREPARE", "IA_REVERT_V2_COMMIT",
                                                                    "INVENTORY_BULK_APPLY", "INVENTORY_LOCK_TOKENS"]), L.load_config()["budget_mb"])
        ok(not over, "node data within budget" + (f": over {over}" if over else ""))


def main():
    argv = [a for a in sys.argv[1:]]
    mode = "revert" if argv and argv[0] == "revert" else "complete"
    pos = [a for a in (argv[1:] if mode == "revert" else argv) if not a.startswith("--")]
    for o in ("--tenant", "--before", "--job", "--json"):
        if L.arg(o) in pos:
            pos.remove(L.arg(o))
    if not pos or not L.arg("--tenant"):
        raise SystemExit(__doc__)
    r = R()
    r.T = L.digits(L.arg("--tenant"), "--tenant")
    tc = L.tenant_cfg(L.load_config(), r.T)
    r.plant, r.org = tc["plant"], tc["org"]
    r.TQ = f"tenant_id = '{r.T}'"
    r.ia = L.digits(pos[0], "iaId")
    args = {"job": L.arg("--job"), "before": L.read_json(L.arg("--before")) if L.arg("--before") else None, "posted": L.flag("--posted"),
            "classic": L.flag("--classic")}
    (revert if mode == "revert" else completion)(r, args)
    print(("RECONCILED" if not FAILS else f"{len(FAILS)} CHECK(S) FAILED") + f" ({len(INFOS)} info)")
    if L.arg("--json"):
        L.write_json(L.arg("--json"), {"fails": FAILS, "infos": INFOS}, indent=1)
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()

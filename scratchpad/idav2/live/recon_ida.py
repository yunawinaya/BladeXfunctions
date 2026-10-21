"""recon_ida.py <idaId> --tenant T [--before SNAP] [--job ID | --classic [--v6]] [--posted] [--json OUT]

Read-only reconciliation (SELECTs through .dbtools/db --dev only) of a V2-completed Item Disassembly by formula (CONTRACT sections 3-9);
every stored value is compared EXACTLY with what the engine stores (live/ida_expect.js: core.js arithmetic at the tenant's number rules in
force when the rows were written - a rule applies from its creation on). Run it with --before (the snap_ida.py snapshot taken before the
completion) for the full proof; without it the checks that need the prior state are INFO.
  job       the IDA's latest COMPLETE_IDA job (IDA|<id>): COMPLETED 100 %, no error; request_payload = this IDA (idaId, idaNo, DF1 fingerprint of
            the stored lines - the AUTO lines read with their pre-D4 text, see AUTO -, lineCount / pickCount / moveCount / stockLines /
            nonStockLines = the stored rows); line_count = moves; the manifest's job / ida / batchMode / counts; the IDC|<id> LOCK row's key
  AUTO      after D4 an AUTO line holds its generated number (its text alone reads TYPED): the AUTO lines are the PREPARE BATCH part's AUTO
            rows (line_ids); their numbers = the D1 intent's (one per AUTO row, distinct); the intent's config advance = the AUTO count; each
            line holds its number; --before: the live batch_number_config advanced by exactly that count (more only with other GENERATE_BATCH
            runs in the window)
  steps     D0_REVALIDATE, D2_ISSUE, D3_RECEIPT, D4_FINISH DONE (+ D1_BATCH when Batch rows are planned); the PREPARE parts; both engine
            operations IDC|<job>|I and IDC|<job>|R: IBA|DONE, no IBA|REVIEW; op 1's DONE summary = the picks
  header    Completed, posted_status Unposted (--posted: Pending Post / Fully Posted), ida_v2_job_id / ida_idem_key = the job's
  OUT rows  keyed IDC|<job>|I|M<n> = the stored picks in temp_qty_data order (item, bin, batch, category, UOM, base UOM, qty and base qty at
            the rule, trx_no, doc_date, parent_trx_no ''); the shared OUT_TOTALS SQL gives the same count / sum; --before + a FIFO source:
            each OUT price = fifoUnitPrice over the snapshot's layers and those layers consumed in sequence, exactly
  IN rows   keyed IDC|<job>|R|R<k> = the stock lines in line order (item, bin, Unrestricted, UOM, base UOM, qty / base qty at the rule, the
            line's Batch row); each unit_price / total_price = the engine's value at the price rule from price.js idaAllocate over the stored
            OUT total (Fixed Cost: purchase_unit_price), exactly; the allocation re-derived independently (sum = issued, each line = issued x
            share / total share); the IN totals = the allocated values
  FIFO      one new layer per FIFO IN row (base qty, cost at the rule), no other new layer on those materials (since the snapshot / within
            120 s of our rows), unless another document received the material in the window (INFO)
  WA        a batch receipt's new row at the IN price and base qty; --before: a non-batch receipt re-averages the newest row of the material
            (any batch) from the snapshot exactly as core.js does ((wc x wq + price x base) / (wq + base), q8, the rule) or creates the
            first one; no unexpected new row; materials other documents moved are INFO
  Batch     one live row per TYPED number + item (idaBatchKey), one per AUTO stock line holding its intent number, none for NONE, no blank
            row; initial_quantity per item = the lines' base qty at the rule; no OTHER live org Batch row holds one of the numbers
  stock     per item_balance / item_batch_balance key: the drift = balance - its whole movement history (IN - OUT base qty). --before: the
            drift of every key of the touched materials is unchanged since the snapshot (pre-existing drift INFO; a changed drift on a key
            only another document moved INFO); without --before: a key this completion created has none (other drift INFO)
  locks     no inventory_balance_lock row held by an IDC|<job>| operation; the job's operations took lock rows (> 0) and released them all;
            another session's held rows on these materials are INFO
  items     the source + every line item (non-stock too) stamped (update_time at or after the job's queue time)
  runs      su_code_workflow_inst of IDA_V2_SUBMIT / WORKER / PREPARE / COMMIT / INVENTORY_BULK_APPLY for the job: status, seconds, MB
            (nodes_data / request / response) against config budget_mb (CONTRACT section 14)
--classic: a classic completion (no job): movements by trx_no, OUT / IN as above in call order, the price by the v7 rule (per BASE unit;
--v6: per LINE unit, the IDAs completed before v7) over the OUT rows the classic read (trx_no + OUT, every cycle), its Batch rows one per
batch line plus a blank one per NONE line (the deliberate difference, info). Exit 1 on any failed check. Writes nothing but --json."""
import json, os, sys
from decimal import Decimal

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import idalib as L  # noqa: E402
import v2build as V  # noqa: E402  (idav2/lib, for .sub)
import importlib.util  # noqa: E402
import recon_lib as RL  # noqa: E402

D = L.dec
spec = importlib.util.spec_from_file_location("ida_shared_sql", os.path.join(L.SHARED, "sql.py"))
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


class R:
    pass


def has_col(table, col):
    return col in L.col_types(table)


def fill(sql, **kw):
    """a shared statement with the V2 columns mapped to NULL until the form publish creates them (sqlcheck's missing_cols rule)"""
    text = V.sub(sql, **kw)
    if not has_col("sm_item_disassembly", "ida_v2_job_id"):
        text = text.replace("h.ida_v2_job_id", "NULL").replace("g.ida_v2_job_id", "NULL")
    return text


def rows_j(rows):
    return [json.loads(r["j"]) if isinstance(r.get("j"), str) else r["j"] for r in rows]


def read_ida(r):
    v2 = ", ".join(c if has_col("sm_item_disassembly", c) else f"NULL {c}" for c in ("ida_v2_job_id", "ida_idem_key"))
    h = L.q(f"SELECT CAST(id AS CHAR) id, stock_movement_no, CAST(stock_movement_no_type AS CHAR) no_type, item_disassembly_status, posted_status, {v2}, "
            "CAST(item_id AS CHAR) item_id, CAST(item_qty AS CHAR) item_qty, CAST(item_uom AS CHAR) item_uom, CAST(issuing_operation_faci AS CHAR) plant, organization_id, "
            "DATE_FORMAT(item_disassembly_date, '%Y-%m-%d %H:%i:%s') item_disassembly_date, temp_qty_data, temp_hu_data, table_hu, "
            f"DATE_FORMAT(create_time, '%Y-%m-%d %H:%i:%s') created FROM sm_item_disassembly WHERE {r.TQ} AND id = {r.ida} AND is_deleted = 0")
    if not h:
        raise SystemExit(f"IDA {r.ida} not found in tenant {r.T}")
    lines = rows_j(L.q(fill(S.FP_LINES, T=r.T, IDA=r.ida)))
    return h[0], lines


def read_items(r, ids):
    items = {}
    for part in L.chunks(sorted({L.digits(i, "item") for i in ids}, key=int), 500):
        for it in rows_j(L.q(V.sub(S.ITEMS, T=r.T, ITEMS=",".join(part)))):
            items[it["id"]] = it
        for t in L.q(f"SELECT CAST(id AS CHAR) id, DATE_FORMAT(update_time, '%Y-%m-%d %H:%i:%s') update_time, DATE_FORMAT(last_transaction_date, '%Y-%m-%d %H:%i:%s') ltd "
                     f"FROM item WHERE {r.TQ} AND id IN ({','.join(part)})"):
            if t["id"] in items:
                items[t["id"]]["update_time"], items[t["id"]]["ltd"] = t["update_time"], t["ltd"]
    return items


def engine_moves(hdr, lines, items, job, prices=None):
    p = {"h": hdr, "l": lines, "i": items, "o": {"jobId": job, "prices": prices}}
    return L.node("const M = require('./ida_moves.js'); const p = JSON.parse(require('fs').readFileSync(0, 'utf8'));"
                  "console.log(JSON.stringify(M.idaEngineMoves(p.h, p.l, p.i, p.o)));", p)


def fingerprint(lines, header):
    return L.node(L.SHARED_JS + "console.log(JSON.stringify(F.idaLineFingerprint(p.l, p.h)));", {"l": lines, "h": header})


def mv_cols():
    return ("CAST(id AS CHAR) id, operation_effect_key k, transaction_type tt, trx_no, movement, inventory_category cat, parent_trx_no ptn, CAST(item_id AS CHAR) item_id, "
            "CAST(bin_location_id AS CHAR) bin, CAST(batch_number_id AS CHAR) batch, CAST(quantity AS CHAR) qty, CAST(base_qty AS CHAR) base_qty, CAST(uom_id AS CHAR) uom, "
            "CAST(base_uom_id AS CHAR) base_uom, CAST(unit_price AS CHAR) unit_price, CAST(total_price AS CHAR) total_price, costing_method_id, "
            "DATE_FORMAT(doc_date, '%Y-%m-%d %H:%i:%s') doc_date, CAST(handling_unit_id AS CHAR) hu, organization_id org, CAST(plant_id AS CHAR) plant")


def bkey(n):
    """ida_common idaBatchKey: a typed number's identity (lower case, trailing blanks dropped)"""
    return str(n or "").lower().rstrip(" ")


def e_uom(m, it):
    """the UOM an ADD row is stored in: the line's, else the item's base UOM (core.js uomOf)"""
    return m.get("material_uom") or it.get("based_uom") or ""


def history(r, mats):
    """per (material, bin, batch or 0): the whole movement history (IN - OUT base qty) and its first movement id"""
    out = {}
    for part in L.chunks(sorted(mats, key=int), 400):
        for m in L.q("SELECT CAST(item_id AS CHAR) m, CAST(bin_location_id AS CHAR) b, CAST(COALESCE(batch_number_id, 0) AS CHAR) bt, "
                     "CAST(SUM(CASE WHEN movement = 'IN' THEN base_qty ELSE -base_qty END) AS CHAR) q, CAST(MIN(id) AS CHAR) f FROM inventory_movement "
                     f"WHERE {r.TQ} AND is_deleted = 0 AND plant_id = {r.plant} AND item_id IN ({','.join(part)}) GROUP BY 1, 2, 3"):
            out[(m["m"], m["b"], m["bt"])] = (D(m["q"]), m["f"])
    return out


def balances(r, mats):
    """live item_balance per (material, bin) and item_batch_balance per (material, bin, batch) at the plant"""
    bi, bb = {}, {}
    for part in L.chunks(sorted(mats, key=int), 400):
        for b in L.q("SELECT CAST(material_id AS CHAR) m, CAST(location_id AS CHAR) b, CAST(SUM(balance_quantity) AS CHAR) q FROM item_balance "
                     f"WHERE {r.TQ} AND is_deleted = 0 AND plant_id = {r.plant} AND material_id IN ({','.join(part)}) GROUP BY 1, 2"):
            bi[(b["m"], b["b"])] = D(b["q"])
        for b in L.q("SELECT CAST(material_id AS CHAR) m, CAST(location_id AS CHAR) b, CAST(batch_id AS CHAR) bt, CAST(SUM(balance_quantity) AS CHAR) q "
                     f"FROM item_batch_balance WHERE {r.TQ} AND is_deleted = 0 AND plant_id = {r.plant} AND material_id IN ({','.join(part)}) GROUP BY 1, 2, 3"):
            bb[(b["m"], b["b"], b["bt"])] = D(b["q"])
    return bi, bb


def window_rows(r, before, mats):
    """every movement of the materials at the plant since the snapshot (ours and other writers')"""
    lo = L.digits(before["meta"]["max_mv_id"], "max_mv_id")
    out = []
    for part in L.chunks(sorted(mats, key=int), 400):
        out += L.q(f"SELECT {mv_cols()} FROM inventory_movement WHERE {r.TQ} AND is_deleted = 0 AND id > {lo} AND plant_id = {r.plant} AND item_id IN ({','.join(part)})")
    return out


def precision_rows(r):
    return L.q("SELECT CAST(id AS CHAR) id, scope_type, rule_key, CAST(table_id AS CHAR) table_id, field_name, decimal_places, precision_rule, store_raw_value "
               f"FROM su_code_num_precision WHERE {r.TQ} AND status = 1 AND is_deleted = 0 AND ((scope_type = '1' AND rule_key IN ('Inventory Price', 'Inventory Qty')) "
               "OR scope_type = '2')")


def held_locks(r, mats, jid):
    """held lock rows on the touched materials: (ours = owned by an IDC|<job>| operation, others = another session's)"""
    held = []
    for part in L.chunks(sorted(mats, key=int), 400):
        held += L.q("SELECT lock_key, owner_operation_id FROM inventory_balance_lock WHERE " + r.TQ + f" AND organization_id = '{r.org}' AND is_deleted = 0 "
                    "AND (free_token IS NULL OR free_token <> 1) AND SUBSTRING_INDEX(SUBSTRING_INDEX(lock_key, '|', 2), '|', -1) IN ("
                    + ",".join("'" + m + "'" for m in part) + ")")
    ours = [h for h in held if jid and str(h.get("owner_operation_id") or "").startswith(f"IDC|{jid}|")]
    return ours, [h for h in held if h not in ours]


def read_part(r, jid, names):
    """a PREPARE part / D1 intent joined from its step rows (step-name order); None = no row, {} = unreadable"""
    if not names:
        return None
    rows = L.q(f"SELECT step_name, result_ref FROM gd_publish_step WHERE {r.TQ} AND job_id = '{jid}' AND is_deleted = 0 AND step_name IN ("
               + ",".join("'" + n.replace("'", "") + "'" for n in names) + ") ORDER BY step_name")
    if not rows:
        return None
    try:
        return json.loads("".join(x["result_ref"] or "" for x in rows))
    except ValueError:
        return {}


def runs_of(r, job, key, names):
    lo = int(job["id"]) - (15 * 60 * 1000 << 22)
    out = []
    for name in names:
        try:
            wid = L.wf_id(name)
        except SystemExit:
            info(f"{name}: no workflow id in ids.json - its runs are not read")
            continue
        pat = key if name.endswith("_SUBMIT") else (f"IDC|{job['id']}|" if name == "INVENTORY_BULK_APPLY" else job["id"])
        if not all(ch.isalnum() or ch in "|:_.-" for ch in pat):
            continue
        out += L.q(f"SELECT CAST(id AS CHAR) id, '{name}' wf, status, current_node_id, start_date, end_date, run_time, LENGTH(nodes_data) nd, LENGTH(request_json_data) rq, "
                   f"LENGTH(response_json_data) rs, LEFT(response_json_data, 300) head FROM su_code_workflow_inst WHERE workflow_id = {wid} AND id > {lo} "
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
        head = (x.get("head") or "").replace(" ", "")
        path = next((p for p in ("PARK", "SPLIT", "DONE", "D0_END", "D1_END", "D2_END", "D3_END", "D4_END", "ENTRY_END", "NO_WRITE", "LOST") if f'"path":"{p}' in head), "")
        nd = int(x["nd"] or 0) / 1e6
        print(f"        {x['wf']:22s} {x['id']} {str(x['status']):8s} exit {str(x['current_node_id'])[:26]:26s} {nd:7.2f} / {int(x['rq'] or 0) / 1e6:6.2f} / "
              f"{int(x['rs'] or 0) / 1e6:6.2f} {secs:7.1f}s {path}")
        if x["wf"] in budget and nd > float(budget[x["wf"]]):
            over.append((x["wf"], x["id"], round(nd, 2)))
    return over


def completion(r, args):
    hdr, lines = read_ida(r)
    no = hdr["stock_movement_no"]
    classic = args.get("classic")
    before = args.get("before")
    job, jid, req, man = None, None, {}, {}
    if not classic:
        jobs = L.q("SELECT CAST(id AS CHAR) id, idempotency_key, correlation_id, job_status, progress_percent, progress_message, error_code, error_message, "
                   "attempt_count, line_count, request_payload, prepared_payload, DATE_FORMAT(queued_at, '%Y-%m-%d %H:%i:%s') queued_at, "
                   "DATE_FORMAT(finished_at, '%Y-%m-%d %H:%i:%s') finished_at FROM gd_async_job WHERE " + r.TQ + " AND is_deleted = 0 AND command = 'COMPLETE_IDA' AND "
                   + (f"id = {L.digits(args['job'], '--job')}" if args.get("job") else f"correlation_id = 'IDA|{r.ida}'") + " ORDER BY id DESC")
        if not jobs:
            raise SystemExit(f"no COMPLETE_IDA job for IDA {r.ida} (a classic completion: --classic)")
        job = jobs[0]
        jid = job["id"]
        req = json.loads(job["request_payload"] or "{}")
        man = json.loads(job["prepared_payload"] or "{}")
        print(f"IDA {r.ida} {no} {hdr['item_disassembly_status']} / {hdr['posted_status']}; job {jid} {job['job_status']} {job['progress_percent']}% attempts "
              f"{job['attempt_count']} queued {job['queued_at']} finished {job['finished_at']}")
        ok(job["job_status"] == "COMPLETED" and str(job["progress_percent"]) == "100" and not job["error_code"],
           f"job COMPLETED 100 % without error ({job['job_status']} {job['progress_percent']} {job['error_code'] or ''} {(job['error_message'] or '')[:160]})")
    else:
        print(f"IDA {r.ida} {no} {hdr['item_disassembly_status']} / {hdr['posted_status']} - CLASSIC completion (no job; movements by trx_no, the "
              + ("v6 price per LINE unit" if args.get("v6") else "v7 price per BASE unit") + ")")
    posted = ("Pending Post", "Fully Posted", "Unposted") if args.get("posted") else ("Unposted",)
    ok(hdr["item_disassembly_status"] in (("Completed", "Fully Posted") if args.get("posted") else ("Completed",)) and hdr["posted_status"] in posted
       and no not in ("", "issued", "draft", None), f"header {hdr['item_disassembly_status']} / {hdr['posted_status']}, number {no}")
    if not classic:
        ok(str(hdr["ida_v2_job_id"] or "") == jid and str(hdr["ida_idem_key"] or "") == job["idempotency_key"],
           f"ida_v2_job_id {hdr['ida_v2_job_id']} / ida_idem_key = the job's ({job['idempotency_key'][:60]})")
    items = read_items(r, {hdr["item_id"]} | {l["item_selection"] for l in lines if str(l.get("item_selection") or "").isdigit()})
    store_hdr = {"issuing_operation_faci": hdr["plant"], "organization_id": hdr["organization_id"], "stock_movement_no": no, "item_disassembly_date": hdr["item_disassembly_date"],
                 "item_id": hdr["item_id"], "item_uom": hdr["item_uom"], "temp_qty_data": hdr["temp_qty_data"]}
    # C1: after D4 an AUTO line holds its generated number - the BATCH part + the D1 intent name the AUTO lines, read back pre-D4
    auto = {"rows": [], "numbers": {}, "by_line": {}, "line_ids": set()}
    intent = None
    if not classic:
        parts = (man.get("parts") or {}) if isinstance(man, dict) else {}
        batch_part = read_part(r, jid, parts.get("BATCH") or []) if man.get("batchMode") == "insert" else None
        names = [x["step_name"] for x in L.q(f"SELECT step_name FROM gd_publish_step WHERE {r.TQ} AND job_id = '{jid}' AND step_name LIKE 'D1|I|%' AND is_deleted = 0")]
        intent = read_part(r, jid, names)
        if man.get("batchMode") == "insert":
            ok(isinstance(batch_part, dict) and isinstance(batch_part.get("rows"), list), f"the BATCH part {parts.get('BATCH')} reads back ({type(batch_part).__name__})")
        auto, aprob = RL.auto_plan(batch_part, intent if isinstance(intent, dict) and intent else (None if intent is None else {}), lines)
        ok(not aprob, f"AUTO lines {len(auto['line_ids'])} (BATCH part) = D1 intent numbers {len(auto['numbers'])} = its config advance, each held by its line (D4)"
           + (f": {aprob}" if aprob else ""))
    lines_pre = RL.pre_d4(lines, auto["line_ids"], L.PLACEHOLDER)
    by_id = {str(l["id"]): l for l in lines}
    built = engine_moves(store_hdr, lines_pre, items, jid or "0")
    cn = built["counts"]
    ok(not built["bad"], f"the stored rows build cleanly ({built['bad'][:2]})")
    if not classic:
        ok(cn["autoRows"] == len(auto["rows"]), f"the stored lines read pre-D4 give {cn['autoRows']} AUTO rows = the BATCH part's {len(auto['rows'])}")
        fp_h = rows_j(L.q(fill(S.FP_HEADER, T=r.T, IDA=r.ida)))
        fps = [fingerprint(RL.pre_d4(lines, auto["line_ids"], t), fp_h) for t in ([L.PLACEHOLDER, ""] if auto["line_ids"] else [None])]
        ok(req.get("idaId") == r.ida and req.get("idaNo") == no and req.get("action") == "DIRECT" and req.get("prevStatus") == "Draft" and req.get("saveAs") == "Completed",
           f"request_payload names this IDA ({req.get('idaId')}, {req.get('idaNo')}, {req.get('action')}, prev {req.get('prevStatus')}, saveAs {req.get('saveAs')})")
        ok(req.get("lineFingerprint") in fps, f"request lineFingerprint {req.get('lineFingerprint')} = the stored rows' {fps}"
           + (f" ({len(auto['line_ids'])} AUTO lines read with their pre-D4 text)" if auto["line_ids"] else ""))
        want = {"lineCount": cn["lines"], "pickCount": cn["picks"], "moveCount": cn["moves"], "stockLines": cn["movementsR"], "nonStockLines": cn["nonStockLines"]}
        got = {k: req.get(k) for k in want}
        ok(all(str(got[k]) == str(v) for k, v in want.items()) and str(job["line_count"]) == str(cn["moves"]),
           f"request counts {got} / line_count {job['line_count']} = stored {want}")
        if man:
            mc = man.get("counts") or {}
            ok(man.get("job_id") == jid and man.get("ida_id") == r.ida and man.get("batchMode") == built["batch"]["mode"]
               and mc.get("movementsI") == cn["movementsI"] and mc.get("movementsR") == cn["movementsR"] and mc.get("lines") == cn["lines"]
               and int(mc.get("autoRows", -1)) == cn["autoRows"], f"manifest job {man.get('job_id')} ida {man.get('ida_id')} batchMode {man.get('batchMode')} "
               f"(want {built['batch']['mode']}) counts {mc}")
        else:
            ok(False, "manifest (prepared_payload) present")
        lock = L.q(f"SELECT step_name, result_ref FROM gd_publish_step WHERE {r.TQ} AND job_id = 'IDC|{r.ida}' AND step_name LIKE 'LOCK|%' AND is_deleted = 0 ORDER BY id DESC LIMIT 1")
        ok(bool(lock) and lock[0]["result_ref"] == job["idempotency_key"], f"latest IDC|{r.ida} lock {lock[0]['step_name'] if lock else '-'} holds the job's key")
        st = L.q(f"SELECT job_id, step_name, step_status FROM gd_publish_step WHERE {r.TQ} AND is_deleted = 0 AND job_id IN ('{jid}', 'IDC|{jid}|I', 'IDC|{jid}|R') ORDER BY id")
        names = {(x["job_id"], x["step_name"]): x for x in st}
        insert = built["batch"]["mode"] == "insert"
        for n in ["D0_REVALIDATE", "D2_ISSUE", "D3_RECEIPT", "D4_FINISH"] + (["D1_BATCH"] if insert else []):
            ok(names.get((jid, n), {}).get("step_status") == "DONE", f"step {n} DONE")
        parts_seen = sorted({x["step_name"].split("|")[2] for x in st if x["job_id"] == jid and x["step_name"].startswith("P|") and x["step_name"].count("|") >= 3})
        want_parts = {"ENGINE_I", "ENGINE_R", "LABELS", "ITEMS"} | ({"BATCH"} if insert else set())
        ok(want_parts <= set(parts_seen), f"PREPARE parts {parts_seen} (want {sorted(want_parts)})")
        for side in ("I", "R"):
            eng = {n for (j_, n) in names if j_ == f"IDC|{jid}|{side}"}
            ok("IBA|DONE" in eng and "IBA|REVIEW" not in eng, f"engine IDC|{jid}|{side}: {sorted(eng)[:5]}")
        done_i = L.q(V.sub(S.OP_STATE, T=r.T, JOB=jid, SIDE="I"))[0]
        try:
            summ = json.loads(done_i["done_summary"] or "{}")
        except ValueError:
            summ = {}
        ok(int(summ.get("movements", -1)) == cn["movementsI"], f"op 1 DONE summary {done_i['done_summary']} (movements = the {cn['movementsI']} picks)")
    # the movement rows; the number rules in force when they were written (a rule applies from its creation on)
    if jid:
        out_rows = L.q(f"SELECT {mv_cols()} FROM inventory_movement WHERE {r.TQ} AND is_deleted = 0 AND id > {jid} AND operation_effect_key LIKE 'IDC|{jid}|I|%' ORDER BY id")
        inn = L.q(f"SELECT {mv_cols()} FROM inventory_movement WHERE {r.TQ} AND is_deleted = 0 AND id > {jid} AND operation_effect_key LIKE 'IDC|{jid}|R|%' ORDER BY id")
    else:
        own = L.q(f"SELECT {mv_cols()} FROM inventory_movement WHERE {r.TQ} AND is_deleted = 0 AND id > {r.ida} AND transaction_type = 'IDA' AND organization_id = '{r.org}' "
                  f"AND trx_no = (SELECT h.stock_movement_no FROM sm_item_disassembly h WHERE h.{r.TQ} AND h.id = {r.ida}) ORDER BY id")
        out_rows = [m for m in own if m["movement"] == "OUT"]
        inn = [m for m in own if m["movement"] == "IN"]
    own_ids = sorted(int(x["id"]) for x in out_rows + inn)
    span = (120 * 1000) << 22
    lo_id, hi_id = (own_ids[0] - span, own_ids[-1] + span) if own_ids else (0, 0)
    prec = RL.rules_at(precision_rows(r), str(own_ids[0]) if own_ids else None)
    rules = [(x["rule_key"] or f"{x['table_id']}.{x['field_name']}", x["decimal_places"], x["precision_rule"]) for x in prec] or "none: 8 dp"
    ms = built["I"]["movements"]
    rm = built["R"]["movements"]
    src = items.get(hdr["item_id"]) or {}
    # OUT rows: one per stored pick in temp_qty_data order, quantities stored at the rule
    ok(len(out_rows) == len(ms), f"OUT rows {'keyed IDC|' + jid + '|I|M<n>' if jid else 'by trx_no'}: {len(out_rows)} = the stored picks {len(ms)}")
    exp_q = RL.expect("qty", prec, moves=[{"item": src, "quantity": m["quantity"], "material_uom": m["material_uom"]} for m in ms]) if ms else []
    by_key = {x["k"].split("|")[-1]: x for x in out_rows} if jid else {f"M{i + 1}": x for i, x in enumerate(out_rows)}
    bad = []
    for m, e in zip(ms, exp_q):
        x = by_key.get(m["movement_key"])
        if not x:
            bad.append((m["movement_key"], "missing"))
            continue
        d = []
        if (x["item_id"], x["bin"], x["batch"] or "", x["cat"], x["uom"] or "", x["base_uom"] or "") != \
                (m["material_id"], m["location_id"], m["batch_id"] or "", m["inventory_category"], e["uom"] or "", src.get("based_uom") or ""):
            d.append(f"{(x['item_id'], x['bin'], x['batch'], x['cat'], x['uom'], x['base_uom'])} vs {(m['material_id'], m['location_id'], m['batch_id'], m['inventory_category'], e['uom'])}")
        if not (RL.eq_stored(x["qty"], e["quantity"]) and RL.eq_stored(x["base_qty"], e["base_qty"])):
            d.append(f"qty / base {x['qty']} / {x['base_qty']} vs {e['quantity']} / {e['base_qty']}")
        d += [f"{c} {x.get(c)!r}" for c, v in (("tt", "IDA"), ("trx_no", no), ("doc_date", m["doc_date"])) if x.get(c) != v]
        if x.get("ptn") not in (None, ""):
            d.append(f"parent_trx_no {x.get('ptn')!r}")
        if d:
            bad.append((m["movement_key"], d))
    ok(not bad, f"every OUT row = its pick (item, bin, batch, category, UOM, base UOM, qty + base qty at the rule, trx_no, doc_date, parent_trx_no ''): "
       f"{len(bad)} off {bad[:3]}")
    out_total = sum((D(m["total_price"]) for m in out_rows), Decimal(0))
    if jid:
        tot = L.q(V.sub(S.OUT_TOTALS, T=r.T, IDA=r.ida, JOB=jid, ORG=r.org))[0]
        ok(int(tot["n"]) == len(out_rows) and D(tot["total"]) == out_total, f"shared OUT_TOTALS SQL: n {tot['n']} total {tot['total']} (rows {len(out_rows)} / {out_total})")
        issued = out_total
    else:
        read = L.q(f"SELECT CAST(COALESCE(SUM(total_price), 0) AS CHAR) t, COUNT(*) n FROM inventory_movement WHERE {r.TQ} AND movement = 'OUT' AND trx_no = "
                   f"(SELECT h.stock_movement_no FROM sm_item_disassembly h WHERE h.{r.TQ} AND h.id = {r.ida})")[0]
        issued = D(read["t"])
        if D(read["t"]) != out_total:
            info(f"the classic's search_movements reads every OUT row of {no} ({read['n']}, {read['t']}): an earlier cycle's rows count too (deliberate V2 difference)")
    # the window: every movement of the touched materials since the snapshot (--before), else those within 120 s of ours
    mats = {hdr["item_id"]} | {x["item_id"] for x in inn}
    if before:
        win = window_rows(r, before, mats)
    else:
        win = []
        for part in L.chunks(sorted(mats, key=int), 400):
            win += L.q(f"SELECT {mv_cols()} FROM inventory_movement WHERE {r.TQ} AND is_deleted = 0 AND id > {lo_id} AND id <= {hi_id} AND plant_id = {r.plant} "
                       f"AND item_id IN ({','.join(part)})") if own_ids else []
    mine_ids = {x["id"] for x in out_rows + inn}
    foreign = [m for m in win if m["id"] not in mine_ids]
    foreign_mats = {m["item_id"] for m in foreign}
    # M3: the source's FIFO consumption and the OUT prices, exactly, from the snapshot's layers
    if before and src.get("material_costing_method") == L.FIFO and ms:
        lay0 = [x for x in before.get("fifo", []) if str(x.get("material_id")) == hdr["item_id"] and not x.get("is_deleted")
                and str(x.get("plant_id")) == r.plant and str(x.get("organization_id")) == r.org]
        picks = [{"material_id": m["material_id"], "plant_id": m["plant_id"], "organization_id": m["organization_id"], "batch_id": m["batch_id"] or "",
                  "item": src, "quantity": m["quantity"], "material_uom": m["material_uom"]} for m in ms]
        exp = RL.expect("out", prec, layers=[{k: (str(v) if v is not None else None) for k, v in y.items()} for y in lay0], picks=picks)
        off = []
        for m, e in zip(ms, exp["picks"]):
            x = by_key.get(m["movement_key"]) or {}
            if not (RL.eq_stored(x.get("unit_price"), e["unit_price"]) and RL.eq_stored(x.get("total_price"), e["total_price"])):
                off.append((m["movement_key"], (x.get("unit_price"), x.get("total_price")), (e["unit_price"], e["total_price"])))
        now_l = {x["id"]: x["a"] for x in L.q(f"SELECT CAST(id AS CHAR) id, CAST(fifo_available_quantity AS CHAR) a FROM fifo_costing_history WHERE {r.TQ} "
                                             f"AND id IN ({L.ids_sql(exp['layers'].keys())})")} if exp["layers"] else {}
        loff = [(i, now_l.get(i), a) for i, a in exp["layers"].items() if not RL.eq_stored(now_l.get(i), a)]
        if hdr["item_id"] in foreign_mats:
            info(f"the source moved by other documents in the window: OUT prices / layer consumption not proven ({len(off)} / {len(loff)} differ)")
        else:
            ok(not off and not loff, f"OUT prices = the engine's FIFO price over the snapshot's {len(lay0)} layers; the layers consumed in sequence ({len(exp['layers'])}): "
               f"{len(off)} prices, {len(loff)} layers off {(off + loff)[:3]}")
    elif not before:
        info("no --before: the source's FIFO consumption and the OUT prices are not checked against the layers")
    else:
        info(f"source costing {src.get('material_costing_method')}: the OUT price / consumption check covers FIFO sources")
    # IN rows: the stock lines in line order; prices = idaAllocate over the issued value, stored exactly as the engine stores them (I2)
    prices = L.allocate(float(issued), built["alloc"])
    aprob = RL.alloc_check(issued, built["alloc"], prices)
    ok(not aprob, f"the allocation adds up: sum of the values = the issued value {issued}, each line = issued x share / total share{(': ' + str(aprob)) if aprob else ''}")
    ok(len(inn) == len(rm), f"IN rows {'keyed IDC|' + jid + '|R|R<k>' if jid else 'by trx_no'}: {len(inn)} = the stock lines {len(rm)} ({cn['nonStockLines']} non-stock lines receive nothing)")
    by_in = {x["k"].split("|")[-1]: x for x in inn} if jid else {f"R{i + 1}": x for i, x in enumerate(inn)}
    rm_by = {x["movement_key"]: x for x in rm}
    stock = [(i, a, pr) for i, (a, pr) in enumerate(zip(built["alloc"], prices)) if a["movement_key"]]
    in_lines = []
    for i, a, pr in stock:
        it = items.get(a["item_id"]) or {}
        m = rm_by[a["movement_key"]]
        l = {"method": it.get("material_costing_method"), "purchase": it.get("purchase_unit_price"), "item": it, "quantity": m["quantity"], "material_uom": m["material_uom"]}
        if classic and args.get("v6"):
            l["v6"] = {"value": pr["value"], "share": a["share_qty"]}
        else:
            l["unit"] = pr["unit_price"]
        in_lines.append(l)
    exp_in = RL.expect("in", prec, lines=in_lines) if in_lines else []
    our_batch = L.q(f"SELECT CAST(id AS CHAR) id, batch_number, CAST(material_id AS CHAR) m, CAST(plant_id AS CHAR) plant, organization_id org, CAST(initial_quantity AS CHAR) iq, "
                    f"transaction_no, is_deleted FROM batch WHERE {r.TQ} AND organization_id = '{r.org}' AND id > {jid or r.ida} AND transaction_no = (SELECT h.stock_movement_no "
                    f"FROM sm_item_disassembly h WHERE h.{r.TQ} AND h.id = {r.ida}) ORDER BY id")
    live_b = [b for b in our_batch if str(b["is_deleted"]) == "0"]
    bmap = {b["id"]: b for b in live_b}
    order = built["order"]
    kind_at = {i: b["kind"] for b in built["batch"]["rows"] for i in b["lines"]}
    bad, pairs, in_sum, val_sum = [], [], Decimal(0), Decimal(0)
    for (i, a, pr), e in zip(stock, exp_in):
        m = rm_by[a["movement_key"]]
        x = by_in.get(a["movement_key"])
        it = items.get(a["item_id"]) or {}
        if not x:
            bad.append((a["movement_key"], "missing"))
            continue
        stored_line = by_id.get(str(order[i].get("id")), order[i])
        d = []
        if (x["item_id"], x["bin"], x["cat"], x["uom"] or "", x["base_uom"] or "") != (m["material_id"], m["location_id"], "Unrestricted", e_uom(m, it), it.get("based_uom") or ""):
            d.append(f"row {(x['item_id'], x['bin'], x['cat'], x['uom'], x['base_uom'])} vs {(m['material_id'], m['location_id'], e_uom(m, it), it.get('based_uom'))}")
        if not (RL.eq_stored(x["qty"], e["quantity"]) and RL.eq_stored(x["base_qty"], e["base_qty"])):
            d.append(f"qty / base {x['qty']} / {x['base_qty']} vs {e['quantity']} / {e['base_qty']}")
        if x.get("tt") != "IDA" or x.get("trx_no") != no or x.get("ptn") not in (None, ""):
            d.append(f"tt {x.get('tt')} trx {x.get('trx_no')} parent {x.get('ptn')!r}")
        kind = kind_at.get(i, "NONE")
        if kind == "NONE":
            if x["batch"]:
                d.append(f"batch {x['batch']} on a NONE line")
        else:
            b = bmap.get(x["batch"] or "")
            if not b or b["m"] != a["item_id"]:
                d.append(f"batch {x['batch']} is not a live Batch row of this IDA for the item")
            elif kind == "AUTO" and b["batch_number"] != stored_line.get("batch_number"):
                d.append(f"AUTO line batch_number {stored_line.get('batch_number')!r} != its Batch row's {b['batch_number']!r} (D4)")
            elif kind == "TYPED" and bkey(b["batch_number"]) != bkey(stored_line.get("batch_number")):
                d.append(f"TYPED number {stored_line.get('batch_number')!r} vs Batch row {b['batch_number']!r}")
        if d:
            bad.append((a["movement_key"], d))
        pairs.append((x, e, it))
        if it.get("material_costing_method") != L.FIXED:
            val_sum += D(str(pr["value"]))
            in_sum += D(x["total_price"])
    ok(not bad, f"every IN row = its stock line (item, bin, Unrestricted, UOM, base UOM, qty + base qty at the rule, trx_no, parent '', its Batch row): "
       f"{len(bad)} off {bad[:3]}")
    off = RL.in_price_problems([x for x, _, _ in pairs], [e for _, e, _ in pairs])
    ok(not off, f"every IN unit_price / total_price = the engine's value at the tenant rule, exactly ({'v6 q8(value / line qty)' if classic and args.get('v6') else 'idaAllocate per base unit'}"
       f"; Fixed Cost: purchase_unit_price; rules {rules}): {len(off)} off {off[:3]}")
    nonstock = sum(D(str(pr["value"])) for a, pr in zip(built["alloc"], prices) if not a["movement_key"])
    tol = Decimal("0.00006") * max(1, len(pairs)) + Decimal("0.00000001")
    ok(abs(in_sum - val_sum) <= tol, f"IN totals {in_sum} = the allocated values {val_sum} (issued {issued} - non-stock share {nonstock} - Fixed Cost lines' value) "
       f"within the price rule ({abs(in_sum - val_sum)} <= {tol})")
    # M3: one new FIFO layer per FIFO IN row, exactly; no other new layer on those materials (unless another document received one)
    fifo_pairs = [(x, e) for x, e, it in pairs if it.get("material_costing_method") == L.FIFO]
    fmats = sorted({x["item_id"] for x, _ in fifo_pairs}, key=int)
    if fmats:
        lo_q = (L.id_at(before["meta"]["taken_at"]) - span) if before else lo_id
        lay = []
        for part in L.chunks(fmats, 400):
            lay += L.q("SELECT CAST(id AS CHAR) id, CAST(material_id AS CHAR) m, CAST(batch_id AS CHAR) b, CAST(fifo_initial_quantity AS CHAR) ini, CAST(fifo_cost_price AS CHAR) p "
                       f"FROM fifo_costing_history WHERE {r.TQ} AND is_deleted = 0 AND plant_id = {r.plant} AND organization_id = '{r.org}' AND id > {lo_q} "
                       + ("" if before else f"AND id <= {hi_id} ") + f"AND material_id IN ({','.join(part)})")
        if before:
            seen = {str(y.get("id")) for y in before.get("fifo", [])}
            lay = [y for y in lay if y["id"] not in seen]
        in_foreign = {m["item_id"] for m in foreign if m["movement"] == "IN"}
        missing, extra = RL.fifo_layer_problems(lay, [x for x, _ in fifo_pairs], [e for _, e in fifo_pairs], in_foreign)
        if in_foreign & set(fmats):
            info(f"FIFO materials received by other documents in the window {sorted(in_foreign & set(fmats))[:3]}: their extra layers are not judged")
        ok(not missing and not extra, f"one new FIFO layer per FIFO IN row ({len(fifo_pairs)}: base qty + cost at the rule), no other new layer on those materials "
           f"({'since the snapshot' if before else 'within 120 s of our movements'}): {len(missing)} missing {missing[:2]}, {len(extra)} extra {extra[:3]}")
    # I4: WA rows - a batch receipt's new row at the IN price; a non-batch receipt re-averages the newest row of the material (the snapshot's)
    wa_pairs = [(x, e) for x, e, it in pairs if it.get("material_costing_method") == L.WA]
    if wa_pairs:
        receipts = []
        for x, e in wa_pairs:
            m = rm_by[x["k"].split("|")[-1]] if jid else next(mm for mm in rm if by_in.get(mm["movement_key"]) is x)
            receipts.append({"material_id": x["item_id"], "plant_id": m["plant_id"], "organization_id": m["organization_id"], "batch_id": x["batch"] or "",
                             "base": e["base"], "engine_unit": e["engine_unit"]})
        wmats = sorted({x["item_id"] for x, _ in wa_pairs}, key=int)
        now_wa = L.q("SELECT CAST(id AS CHAR) id, CAST(material_id AS CHAR) material_id, CAST(batch_id AS CHAR) batch_id, CAST(wa_quantity AS CHAR) wa_quantity, "
                     f"CAST(wa_cost_price AS CHAR) wa_cost_price FROM wa_costing_method WHERE {r.TQ} AND is_deleted = 0 AND plant_id = '{r.plant}' "
                     f"AND organization_id = '{r.org}' AND material_id IN ({','.join(wmats)}) ORDER BY id")
        if before:
            seen = {str(w.get("id")) for w in before.get("wa", [])}
            rows0 = [{k: (str(v) if v is not None else None) for k, v in w.items()} for w in before.get("wa", [])
                     if str(w.get("material_id")) in wmats and not w.get("is_deleted")]
            exp = RL.expect("wa", prec, rows=rows0, receipts=receipts)
            new_wa = [w for w in now_wa if w["id"] not in seen]
            moved_later = set()
        else:
            exp = RL.expect("wa", prec, rows=[], receipts=[x for x in receipts if x["batch_id"]])
            new_wa = [w for w in now_wa if lo_id < int(w["id"]) <= hi_id]
            moved_later = set()
            for part in L.chunks(wmats, 400):
                moved_later |= {x["m"] for x in L.q(f"SELECT DISTINCT CAST(item_id AS CHAR) m FROM inventory_movement WHERE {r.TQ} AND is_deleted = 0 "
                                                    f"AND id > {own_ids[-1]} AND plant_id = {r.plant} AND item_id IN ({','.join(part)})")}
            if any(not x["batch_id"] for x in receipts):
                info(f"{sum(1 for x in receipts if not x['batch_id'])} non-batch WA receipt(s): the re-average is checked only with --before")
        loose = foreign_mats | moved_later
        hard, soft, n = RL.wa_problems(now_wa, new_wa, exp, loose)
        if soft:
            info(f"{len(soft)} WA difference(s) on materials other documents moved {'in the window' if before else 'in or after it'} {sorted(loose & set(wmats))[:3]}: not proven")
        ok(not hard, f"WA rows of {len(wa_pairs)} WA receipt(s): {len(exp['created'])} new row(s) at the IN price, {len(exp['updated'])} re-averaged exactly "
           f"(wc x wq + price x base) / (wq + base) at the rule - {n['created_off']} new off, {n['updated_off']} re-average off, {n['unexpected']} unexpected new "
           f"{hard[:2]}")
    # Batch rows
    rows = built["batch"]["rows"]
    blanks = [b for b in live_b if not (b["batch_number"] or "").strip()]
    if classic:
        info(f"classic: {len(live_b)} live Batch row(s) of {no} ({len(blanks)} blank: one per NONE line, the deliberate V2 difference); planned V2 rows {len(rows)}")
    else:
        ok(not blanks, f"no blank Batch row ({len(blanks)})")
        want_rows = [b for b in rows if b["insert"]]
        hits = []
        for b in want_rows:
            if b["kind"] == "AUTO":
                num = auto["numbers"].get(next((auto["by_line"].get(l) for l in b["line_ids"] if l in auto["by_line"]), None))
                mine = [x for x in live_b if x["m"] == b["material_id"] and x["batch_number"] == num]
            else:
                mine = [x for x in live_b if x["m"] == b["material_id"] and bkey(x["batch_number"]) == bkey(b["batch_number"])]
            hits.append(len(mine) == 1)
        ok(len(live_b) == len(want_rows) and all(hits), f"live Batch rows of {no}: {len(live_b)} = planned {len(want_rows)} (TYPED one per item + number, AUTO one per stock line "
           f"with its intent number): {hits.count(False)} off")
        st_iq = RL.expect("store", prec, values=[["batch", "initial_quantity", float(b["initial_quantity"])] for b in want_rows]) if want_rows else []
        iq, got_iq = {}, {}
        for b, v in zip(want_rows, st_iq):
            iq[b["material_id"]] = iq.get(b["material_id"], Decimal(0)) + D(v)
        for b in live_b:
            got_iq[b["m"]] = got_iq.get(b["m"], Decimal(0)) + D(b["iq"])
        ok(got_iq == iq, f"Batch initial_quantity per item = the lines' base qty at the rule ({[(k, str(v), str(iq.get(k))) for k, v in got_iq.items() if v != iq.get(k)][:3]} off)")
        nums = [b["batch_number"] for b in live_b if b["batch_number"]]
        if nums:
            hx = L.node(L.SHARED_JS + "console.log(JSON.stringify(C.idaHexJson(p)));", nums)
            others = [x for x in rows_j(L.q(V.sub(S.BATCH_HOLDERS, T=r.T, ORG=r.org, HEX=hx))) if x["id"] not in bmap]
            ok(not others, f"no OTHER live org Batch row holds one of our {len(nums)} numbers ({[(o['batch_number'], o['transaction_no']) for o in others][:3]})")
        if auto["rows"]:
            if before:
                runs = L.q(f"SELECT COUNT(*) n FROM su_code_workflow_inst WHERE workflow_id = {L.wf_id('GENERATE_BATCH')} AND tenant_id = '{r.T}' "
                           f"AND id > {L.id_at(before['meta']['taken_at'])} AND status = 'Complete'")[0]["n"]
                cp, ci = RL.config_advance(before.get("bnc", []), rows_j(L.q(V.sub(S.BNC, T=r.T, ORG=r.org))),
                                           (intent or {}).get("configs") if isinstance(intent, dict) else [], len(auto["rows"]), int(runs))
                for x in ci:
                    info(x)
                ok(not cp, "batch_number_config advanced by the AUTO count since the snapshot" + (f": {cp}" if cp else ""))
            else:
                info("no --before: the batch_number_config advance is not checked against the snapshot (the D1 intent's own advance is)")
    # I3: stock - balance minus movement history (the drift) per key: unchanged since the snapshot; on a key this completion created: none
    keys_i = {(m["item_id"], m["bin"]) for m in out_rows + inn}
    keys_b = {(m["item_id"], m["bin"], m["batch"]) for m in out_rows + inn if m["batch"]}
    hist = history(r, mats)
    bi, bb = balances(r, mats)
    hist_i, first_i, hist_b, first_b = {}, {}, {}, {}
    for (m, b, bt), (q, f) in hist.items():
        hist_i[(m, b)] = hist_i.get((m, b), Decimal(0)) + q
        first_i[(m, b)] = min(first_i.get((m, b), f), f, key=int)
        if bt != "0":
            hist_b[(m, b, bt)], first_b[(m, b, bt)] = q, f
    first_own = str(own_ids[0]) if own_ids else "0"
    if before:
        b0i, b0b, wi, wb = {}, {}, {}, {}
        for x in before.get("ib", []):
            if not x.get("is_deleted") and str(x.get("plant_id")) == r.plant and str(x.get("material_id")) in mats:
                k = (str(x["material_id"]), str(x["location_id"]))
                b0i[k] = b0i.get(k, Decimal(0)) + D(x["balance_quantity"])
        for x in before.get("ibb", []):
            if not x.get("is_deleted") and str(x.get("plant_id")) == r.plant and str(x.get("material_id")) in mats:
                k = (str(x["material_id"]), str(x["location_id"]), str(x["batch_id"]))
                b0b[k] = b0b.get(k, Decimal(0)) + D(x["balance_quantity"])
        for m in win:
            sgn = (1 if m["movement"] == "IN" else -1) * D(m["base_qty"])
            wi[(m["item_id"], m["bin"])] = wi.get((m["item_id"], m["bin"]), Decimal(0)) + sgn
            if m["batch"]:
                wb[(m["item_id"], m["bin"], m["batch"])] = wb.get((m["item_id"], m["bin"], m["batch"]), Decimal(0)) + sgn
        fk_i = {(m["item_id"], m["bin"]) for m in foreign}
        fk_b = {(m["item_id"], m["bin"], m["batch"]) for m in foreign if m["batch"]}
        all_i = keys_i | set(b0i) | set(bi) | set(wi)
        all_b = keys_b | set(b0b) | set(bb) | set(wb)
        pi, ii = RL.drift(all_i, bi, hist_i, b0i, wi, touched=keys_i, foreign_keys=fk_i)
        pb, ib = RL.drift(all_b, bb, hist_b, b0b, wb, touched=keys_b, foreign_keys=fk_b)
    else:
        new_i = {k for k in keys_i if int(first_i.get(k, first_own)) >= int(first_own)}
        new_b = {k for k in keys_b if int(first_b.get(k, first_own)) >= int(first_own)}
        pi, ii = RL.drift(keys_i, bi, hist_i, new_keys=new_i)
        pb, ib = RL.drift(keys_b, bb, hist_b, new_keys=new_b)
    for x in ii[:6] + ib[:6]:
        info(x)
    if len(ii) + len(ib) > 12:
        info(f"... {len(ii) + len(ib) - 12} more drift note(s)")
    ok(not pi, f"item_balance: the drift (balance - movement history) {'of every key of the touched materials is unchanged since the snapshot' if before else 'is none on the keys this completion created'} "
       f"({len(keys_i)} touched; {len(pi)} off {pi[:3]})")
    ok(not pb, f"item_batch_balance: the same for the batch keys ({len(keys_b)} touched; {len(pb)} off {pb[:3]})")
    if before:
        info(f"window since the snapshot: {len(win)} movements, {len(foreign)} by other documents")
    # M1: locks - ours released (there must be some), another session's held locks are not ours to judge
    ours_held, others_held = held_locks(r, mats, jid)
    ok(not ours_held, f"no lock held by IDC|{jid}| operations on the {len(mats)} touched materials ({[h['lock_key'] for h in ours_held][:3]})" if jid
       else f"no lock held by this completion ({len(ours_held)})")
    if others_held:
        info(f"{len(others_held)} lock row(s) held by other operations on these materials: {[(h['lock_key'], h['owner_operation_id']) for h in others_held][:3]}")
    if jid:
        mine = L.q("SELECT lock_key, owner_operation_id, free_token FROM inventory_balance_lock WHERE " + r.TQ + f" AND organization_id = '{r.org}' AND is_deleted = 0 "
                   f"AND (owner_operation_id LIKE 'IDC|{jid}|%' OR last_owner_operation_id LIKE 'IDC|{jid}|%')")
        ok(len(mine) > 0 and all(str(x["free_token"]) == "1" and not x["owner_operation_id"] for x in mine),
           f"{len(mine)} lock rows taken by IDC|{jid}| operations (there must be some), all released")
    since = (job["queued_at"] if job else hdr["created"]) or ""
    stale = [i for i, it in items.items() if not it.get("update_time") or it["update_time"] < since[:19]]
    ok(not stale, f"items stamped (source + {len(items) - 1} line items, non-stock included): {len(stale)} not touched since {since} {stale[:3]}")
    if jid:
        over = print_runs(runs_of(r, job, job["idempotency_key"], ["IDA_V2_SUBMIT", "IDA_V2_WORKER", "IDA_V2_PREPARE", "IDA_V2_COMMIT", "INVENTORY_BULK_APPLY"]),
                          L.load_config()["budget_mb"])
        ok(not over, "node data within the CONTRACT section 14 budgets" + (f": over {over}" if over else ""))


def main():
    argv = list(sys.argv[1:])
    pos = [a for a in argv if not a.startswith("--")]
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
    r.ida = L.digits(pos[0], "idaId")
    args = {"job": L.arg("--job"), "before": L.read_json(L.arg("--before")) if L.arg("--before") else None, "posted": L.flag("--posted"),
            "classic": L.flag("--classic"), "v6": L.flag("--v6")}
    completion(r, args)
    print(("RECONCILED" if not FAILS else f"{len(FAILS)} CHECK(S) FAILED") + f" ({len(INFOS)} info)")
    if L.arg("--json"):
        L.write_json(L.arg("--json"), {"fails": FAILS, "infos": INFOS}, indent=1)
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()

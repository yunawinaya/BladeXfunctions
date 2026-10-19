"""test_kit.py [--no-db]: offline + read-only tests of the IA V2 live-check kit (package E). Writes only to a temp dir outside the repo.
  1 key       ialib.ia_key / hash16 / canon = the JS client recipe (tpl/sav2/client/src/saV2_onClick_completed.js canon + hash16 + clean)
  2 record    record_of drops every NOT_RECORD key and every dialog_* key; keeps sia_uuid / page_status
  3 shape     a built Add request = the recorded web payloads' key order / types (dev run 2110917562163441665, prod run
              2111001816408920065, read-only) - needs the DB and a built tag (skipped with --no-db)
  4 moves     ia_moves.js on a hand-made IA: non-stock line skipped, picks in line_index / array order, keys M1.., R1 fields
  5 plan      plan_ia.js over a synthetic snapshot: PLAN OK with the receipt price; an over-qty pick -> PLAN REFUSED INSUFFICIENT
  6 diff      diff_twins_ia.py on synthetic snapshots: twins SAME; a changed balance delta DIFFERs; the classic blank Batch row is
              DELIBERATE; --nothing-moved passes / fails as designed
  7 recon     recon_ia.py --classic on dev IA-2609-010 (read-only) -> RECONCILED (skipped with --no-db)"""
import copy, json, os, subprocess, sys, tempfile

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import ialib as L  # noqa: E402

NODB = "--no-db" in sys.argv
TMP = tempfile.mkdtemp(prefix="iav2-kit-test-")
results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("ok    " if cond else "FAIL  ") + name + (f"  ({detail})" if detail and not cond else ""))


def node(script, payload=None):
    r = subprocess.run(["node", "-e", script], input=json.dumps(payload or {}), capture_output=True, text=True, cwd=HERE)
    if r.returncode:
        raise RuntimeError(r.stderr[:600])
    return json.loads(r.stdout)


# 1 key -------------------------------------------------------------------------------------------------------------------------
tpl = open(os.path.join(L.IAV2, "tpl", "sav2", "client", "src", "saV2_onClick_completed.js")).read()
js_fns = tpl[tpl.index("const canon = "):tpl.index("const orgOf = ")]
record = {"organization_id": "2105190589240086530", "item_id": "2105489115887079441", "item_qty": 1, "remarks": "naïve – é 中文", "x": None, "f": 0.1 + 0.2,
          "stock_movement": [{"line_index": 1, "temp_qty_data": "[{\"sm_quantity\":2}]", "requested_qty": 3.0799999999999996, "b": True}]}
js = node(js_fns + "const p = JSON.parse(require('fs').readFileSync(0, 'utf8'));"
          "const key = ('IA:' + p.org + ':' + p.doc + ':' + hash16(canon({ saveAs: 'Completed', pageStatus: p.page, record: p.record })) + ':' + p.gen)"
          ".replace(/[^A-Za-z0-9|:_.-]/g, '-').slice(0, 128); console.log(JSON.stringify({ key, canon: canon(p.record) }));",
          {"org": "2105190589240086530", "doc": "new-mvez6fk24v72ykmx", "page": "Add", "record": record, "gen": 1})
check("1 key: ia_key = the JS client's idemKey recipe", L.ia_key("2105190589240086530", "new-mvez6fk24v72ykmx", "Add", record, 1) == js["key"], js["key"])
check("1 key: canon = the JS canon (unicode, floats, null, bools)", L.js_canon(record) == js["canon"])
check("1 key: the key passes IA_KEY_RE", node("const C = require('../code/shared/ia_common.js'); const p = JSON.parse(require('fs').readFileSync(0, 'utf8'));"
                                              "console.log(JSON.stringify(C.IA_KEY_RE.test(p.k)));", {"k": js["key"]}))

# 2 record ----------------------------------------------------------------------------------------------------------------------
vals = {k: 1 for k in L.NOT_RECORD} | {"dialog_x": 1, "sia_uuid": "", "page_status": "Add", "item_id": "1"}
rec = L.record_of(vals)
check("2 record: NOT_RECORD + dialog_* dropped, sia_uuid / page_status kept", set(rec) == {"sia_uuid", "page_status", "item_id"}, sorted(rec))

# 3 shape -----------------------------------------------------------------------------------------------------------------------
if not NODB and os.environ.get("IA_LIVE_OUT") and os.path.exists(os.path.join(os.environ["IA_LIVE_OUT"], "b", "classic.json")):
    built = L.read_json(os.path.join(os.environ["IA_LIVE_OUT"], "b", "classic.json"))
    for env, rid in (("--dev", "2110917562163441665"), ("--prod", "2111001816408920065")):
        row = L.q(f"SELECT request_json_data FROM su_code_workflow_inst WHERE workflow_id = 2098335576774463489 AND id = {rid}", env)[0]
        recd = json.loads(row["request_json_data"])["workflowparams"]
        ra, ba = recd["allData"], built["allData"]
        rk = [k for k in ra if k not in ("manufacturing_date", "expired_date")]
        check(f"3 shape: header key order = recorded {env[2:]} run {rid}", rk == list(ba), str([k for k in rk if k not in ba] + [k for k in ba if k not in rk]))
        check(f"3 shape: header value types = recorded {env[2:]}", all(type(ra[k]) == type(ba[k]) or k in ("item_qty",) for k in rk if k in ba),
              str([(k, type(ra[k]).__name__, type(ba[k]).__name__) for k in rk if k in ba and type(ra[k]) != type(ba[k])]))
        rl = next((l for l in ra["stock_movement"] if l.get("temp_qty_data") not in ("", "[]", None)), ra["stock_movement"][0])
        bl = ba["stock_movement"][0]
        check(f"3 shape: line key order = recorded {env[2:]}", list(rl) == list(bl), str(list(rl)))
        if rl.get("temp_qty_data"):
            re_, be = json.loads(rl["temp_qty_data"])[0], json.loads(bl["temp_qty_data"])[0]
            check(f"3 shape: pick entry keys = recorded {env[2:]}", list(re_) == list(be), str(list(re_)))
    check("3 shape: request top level {allData, saveAs, pageStatus}", list(built) == ["allData", "saveAs", "pageStatus"] and built["saveAs"] == "Completed")
    sub = L.read_json(os.path.join(os.environ["IA_LIVE_OUT"], "b", "submit.json"))
    check("3 shape: SUBMIT request = CONTRACT section 7 keys", sorted(sub) == sorted(["operation", "saveAs", "pageStatus", "ia_id", "idempotency_key", "source", "form"])
          and not set(L.NOT_RECORD) & set(sub["form"]))
else:
    print("skip  3 shape (needs the DB and IA_LIVE_OUT with a built tag b)")

# 4 moves -----------------------------------------------------------------------------------------------------------------------
doc = {"stock_movement": [
    {"line_index": 2, "item_selection": "11", "quantity_uom": "900", "temp_qty_data": json.dumps([{"sm_quantity": 1.5, "location_id": "501", "batch_id": "", "category": ""},
                                                                                                   {"sm_quantity": 0, "location_id": "502"}, {"sm_quantity": "2", "location_id": "503", "batch_id": "77", "category": "Blocked"}])},
    {"line_index": 1, "item_selection": "12", "quantity_uom": "", "temp_qty_data": json.dumps([{"sm_quantity": 3, "location_id": "504"}])},
    {"line_index": 3, "item_selection": "13", "quantity_uom": "901", "temp_qty_data": ""}]}
hdr = {"issuing_operation_faci": "7", "organization_id": "8", "stock_movement_no": "IA-1", "item_assembly_date": "2026-10-20", "item_id": "10", "item_qty": "2.00000000",
       "item_uom": "905", "location_id": "600", "inventory_category": "", "remarks": " r ", "manufacturing_date": None}
items = {"11": {"stock_control": 1}, "12": {"stock_control": 1}, "13": {"stock_control": 0}, "10": {"stock_control": 1}}
b = node("const M = require('./ia_moves.js'); const p = JSON.parse(require('fs').readFileSync(0, 'utf8'));"
         "console.log(JSON.stringify(M.iaEngineMoves(p.doc, p.hdr, p.items, { jobId: '99', receiptBaseQty: 2, assemblyCost: 1, batchId: '' })));",
         {"doc": doc, "hdr": hdr, "items": items})
m = b["I"]["movements"]
check("4 moves: 3 movements, line_index order then array order, zero picks dropped, non-stock line skipped",
      [(x["movement_key"], x["material_id"], x["location_id"], x["quantity"]) for x in m] == [("M1", "12", "504", 3), ("M2", "11", "501", 1.5), ("M3", "11", "503", 2)], str(m))
check("4 moves: category / batch / UOM / dates / keys as CONTRACT section 5",
      m[1]["inventory_category"] == "Unrestricted" and m[1]["batch_id"] is None and m[2]["batch_id"] == "77" and m[2]["inventory_category"] == "Blocked"
      and m[0]["material_uom"] == "" and m[1]["material_uom"] == "900" and m[0]["doc_date"] == "2026-10-20 00:00:00" and m[0]["parent_trx_no"] == ""
      and m[0]["isMovingInv"] == 0 and m[0]["handling_unit_id"] is None and b["I"]["operation_key"] == "IAC|99|I" and b["R"]["operation_key"] == "IAC|99|R")
r1 = b["R"]["movements"][0]
check("4 moves: R1 = the header (qty q8, Unrestricted default, remarks untrimmed, no batch_number, unit_price 0)",
      r1["material_id"] == "10" and r1["quantity"] == 2 and r1["inventory_category"] == "Unrestricted" and r1["remark"] == " r " and "batch_number" not in r1
      and r1["unit_price"] == 0 and r1["batch_id"] is None and b["counts"] == {"lines": 3, "picks": 3, "nonStock": 1, "movementsI": 3}, str(r1))

# 5 plan ------------------------------------------------------------------------------------------------------------------------
snap = {"precision": [], "itemdef": [
    {"id": "2000000000000000010", "material_code": "P", "stock_control": 1, "material_costing_method": "First In First Out", "based_uom": "900", "assembly_cost": "1.50",
     "purchase_unit_price": "0", "item_batch_management": 0, "table_uom_conversion": [{"alt_uom_id": "900", "base_uom_id": "900", "alt_qty": "1", "base_qty": "1"}]},
    {"id": "2000000000000000011", "material_code": "C", "stock_control": 1, "material_costing_method": "First In First Out", "based_uom": "900", "assembly_cost": "0",
     "purchase_unit_price": "0", "item_batch_management": 0, "table_uom_conversion": []}],
    "ib": [{"id": "1", "material_id": "2000000000000000011", "location_id": "2000000000000000501", "plant_id": "7", "organization_id": "8", "unrestricted_qty": "10",
            "reserved_qty": "0", "block_qty": "0", "qualityinsp_qty": "0", "intransit_qty": "0", "balance_quantity": "10", "is_deleted": 0}],
    "ibb": [], "wa": [], "fifo": [{"id": "5", "material_id": "2000000000000000011", "plant_id": "7", "organization_id": "8", "batch_id": None, "fifo_sequence": "1",
                                   "fifo_available_quantity": "10", "fifo_cost_price": "4", "fifo_initial_quantity": "10", "is_deleted": 0}]}
req = {"allData": {"issuing_operation_faci": "7", "organization_id": "8", "item_assembly_date": "2026-10-20", "item_id": "2000000000000000010", "item_qty": 2, "item_uom": "900",
                   "location_id": "2000000000000000501", "inventory_category": "Unrestricted", "stock_movement": [
                       {"line_index": 1, "item_selection": "2000000000000000011", "quantity_uom": "900",
                        "temp_qty_data": json.dumps([{"sm_quantity": 3, "location_id": "2000000000000000501", "category": "Unrestricted"}])}]}}
sp, rp = os.path.join(TMP, "snap.json"), os.path.join(TMP, "req.json")
json.dump(snap, open(sp, "w"))
json.dump(req, open(rp, "w"))
r = subprocess.run(["node", os.path.join(HERE, "plan_ia.js"), rp, sp], capture_output=True, text=True)
check("5 plan: PLAN OK, receipt at q8(3 x 4 / 2 + 1.5) = 7.5", r.returncode == 0 and "at 7.5 =" in r.stdout, r.stdout[-400:] + r.stderr[-300:])
req2 = copy.deepcopy(req)
req2["allData"]["stock_movement"][0]["temp_qty_data"] = json.dumps([{"sm_quantity": 11, "location_id": "2000000000000000501"}])
json.dump(req2, open(rp, "w"))
r = subprocess.run(["node", os.path.join(HERE, "plan_ia.js"), rp, sp], capture_output=True, text=True)
check("5 plan: an over-qty pick -> PLAN REFUSED INSUFFICIENT at M1", r.returncode == 1 and "PLAN REFUSED op 1 INSUFFICIENT at M1" in r.stdout, r.stdout[-300:])

# 6 diff ------------------------------------------------------------------------------------------------------------------------
def snapshot(ia_id, no, bal, mv, batch=None, job=None, steps=(), oek="", status="Completed"):
    s = {"meta": {}, "ia": [{"id": ia_id, "stock_movement_no": no, "item_id": "10", "item_assembly_status": status, "posted_status": "Unposted",
                             "ia_v2_job_id": job or None}] if ia_id else [],
         "ial": [], "ib": [{"id": 1, "material_id": "11", "location_id": "501", "balance_quantity": str(bal), "unrestricted_qty": str(bal), "is_deleted": 0}],
         "ibb": [], "fifo": [], "wa": [], "batch": batch or [], "item": [], "itemdef": [{"id": "10", "item_batch_management": 0}], "lock": [], "job": [], "step": list(steps),
         "mv": [{"id": i, "item_id": "11", "bin_location_id": "501", "batch_number_id": None, "movement": "OUT", "transaction_type": "IA", "trx_no": no, "quantity": "1",
                 "base_qty": "1", "unit_price": "4", "total_price": "4", "operation_effect_key": oek, "inventory_category": "Unrestricted"} for i in mv]}
    if job:
        s["job"] = [{"id": job, "command": "COMPLETE_IA", "job_status": "COMPLETED", "progress_percent": 100, "error_code": None}]
    return s
A0, A1 = snapshot(None, None, 10, []), snapshot("100", "IA-A", 9, [201], batch=[{"id": 301, "material_id": "10", "batch_number": "", "is_deleted": 0}])
steps = [{"job_id": "500", "step_name": n, "step_status": "DONE"} for n in ("I0_REVALIDATE", "I2_ISSUE", "I3_RECEIPT", "I4_FINISH")] + \
        [{"job_id": "IAC|500|" + x, "step_name": "IBA|DONE", "step_status": "DONE"} for x in ("I", "R")]
B0, B1 = snapshot(None, None, 9, []), snapshot("101", "IA-B", 8, [202], job="500", steps=steps, oek="IAC|500|I|M1")
paths = []
for name, s in (("A0", A0), ("A1", A1), ("B0", B0), ("B1", B1)):
    p = os.path.join(TMP, name + ".json")
    json.dump(s, open(p, "w"))
    paths.append(p)
r = subprocess.run([sys.executable, os.path.join(HERE, "diff_twins_ia.py")] + paths, capture_output=True, text=True)
check("6 diff: twins SAME table by table, the blank Batch row DELIBERATE, the V2 checks pass", "tables differing: 0; failed checks: 0" in r.stdout
      and "DELIBERATE A batch: blank Batch row" in r.stdout, r.stdout[-900:])
B1x = snapshot("101", "IA-B", 7, [202], job="500", steps=steps, oek="IAC|500|I|M1")
json.dump(B1x, open(paths[3], "w"))
r = subprocess.run([sys.executable, os.path.join(HERE, "diff_twins_ia.py")] + paths, capture_output=True, text=True)
check("6 diff: B's balance moved by 2 instead of 1 -> ib DIFFERs", r.returncode == 1 and "ib     A    1 changes  B    1  DIFFER" in r.stdout, r.stdout[:600])
F0, F1 = snapshot("102", "IA-F", 10, [], status="Draft"), snapshot("102", "IA-F", 10, [], status="Draft")
F1["job"] = [{"id": "600", "command": "COMPLETE_IA", "job_status": "FAILED", "error_code": "IA_INVENTORY_INSUFFICIENT", "error_message": "Insufficient quantity"}]
json.dump(F0, open(paths[0], "w"))
json.dump(F1, open(paths[1], "w"))
r = subprocess.run([sys.executable, os.path.join(HERE, "diff_twins_ia.py"), "--nothing-moved", paths[0], paths[1], "--code", "IA_INVENTORY_INSUFFICIENT"], capture_output=True, text=True)
check("6 diff: --nothing-moved passes on a FAILED job that moved nothing", r.returncode == 0 and "NOTHING MOVED" in r.stdout, r.stdout[-500:])
F1["ib"][0]["balance_quantity"] = "9"
json.dump(F1, open(paths[1], "w"))
r = subprocess.run([sys.executable, os.path.join(HERE, "diff_twins_ia.py"), "--nothing-moved", paths[0], paths[1], "--code", "IA_INVENTORY_INSUFFICIENT"], capture_output=True, text=True)
check("6 diff: --nothing-moved fails when a balance moved", r.returncode == 1 and "FAIL  ib: 1 change(s)" in r.stdout, r.stdout[-500:])

# 7 recon -----------------------------------------------------------------------------------------------------------------------
if not NODB:
    r = subprocess.run([sys.executable, os.path.join(HERE, "recon_ia.py"), "2102337892356845570", "--tenant", "000000", "--classic"], capture_output=True, text=True, cwd=L.REPO)
    check("7 recon: --classic on dev IA-2609-010 (read-only) RECONCILED", r.returncode == 0 and "RECONCILED" in r.stdout, r.stdout[-600:])
else:
    print("skip  7 recon (needs the DB)")

n_ok = sum(1 for _, x in results if x)
print(f"{n_ok}/{len(results)} checks passed (temp files in {TMP})")
sys.exit(0 if n_ok == len(results) else 1)

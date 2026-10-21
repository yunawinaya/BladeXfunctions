"""test_kit.py [--no-db]: offline + read-only tests of the IDA V2 live-check kit (package E). Writes only to a temp dir outside the repo.
  1 key       idalib.ida_key / hash16 / canon = package D's client recipe (client/src/idaV2_onClick_completed.js canon + hash16 + clean)
  2 record    record_of drops every NOT_RECORD key (= CONTRACT section 12's list) and every dialog_* key; keeps page_status / temp_qty_data
  3 moves     ida_moves.js on a hand-made IDA: picks in temp_qty_data order (sm_quantity <= 0 dropped), R<k> over the stock lines in
              line_index order, alloc over every line (non-stock included), base qty by the line UOM, the BATCH rows (TYPED shared by two
              lines of one item = one row with the summed base qty, AUTO one per line, a non-stock AUTO line insert false, NONE none), the
              CONTRACT section 5 field values
  4 plan      plan_ida.js over a synthetic snapshot: PLAN OK at idaAllocate's prices (a non-base-UOM line per base unit); an over-qty
              pick -> PLAN REFUSED INSUFFICIENT at M1
  5 diff      diff_twins_ida.py on synthetic snapshots: twins SAME although twin A creates the receipt balance row and B updates it; the
              classic's blank Batch row and its two rows for a shared typed number DELIBERATE; a changed delta DIFFERs; --nothing-moved
  6 batchnum  the builder's AUTO preview = batchnum over a fixture config (running_number = the NEXT number: 631 -> Batch-00631)
  7 shape     a built Add request = the recorded web payload's header key order / types (dev run 2110936708288786433), the explode line
              keys, the single-source pick keys; the dialog pick = run 2108127883327025153's (needs the DB + a built a / r1 tag)
  8 recon     recon_ida.py --classic --v6 on dev IDA-2610-003 (read-only) -> RECONCILED (needs the DB)
  9 gates     every built tag's classic.json through the classic's own code_fillback + code_validate bodies -> Passed (needs the DB)
  10 recon    fix round 1 on synthetic rows: C1 the AUTO lines after D4 (BATCH part + D1 intent, pre-D4 kinds and fingerprint, the counts,
              the config advance); I2 exact IN prices at the 4 dp rule (0 / truncated / unrounded FAIL), rules from creation; I3 drift
              before vs after (old drift INFO); I4 WA re-average / first row / batch row exact; M3 FIFO consumption + layers, the allocation
              in Decimal; M1 our vs another session's held locks
  11 cmds     M5 a classic re-print refused while its .out.json exists (--again); I1 a > 250-move classic / an Edit of a stored Completed
              IDA refused while the live IDA_SAVE lacks v7's guard (forced answer; the Edit's stored status + the live guard by SELECT)
  12 diff     M2 per-batch own tokens, parent_trx_no compared, --mask-prices only with a plan of two layer prices and never on Fixed Cost
  13 autonum  variant.py autonum on a copy of the built r1 (the runas route's AUTO-line workaround): the AUTO lines typed <prefix>-<n>, plan.json
              rebuilt (AUTO 0, TYPED + N, no config advance, prices unchanged); refused without AUTO lines / a held number / a number typed
              on another line (needs the DB + a built r1)"""
import copy, json, os, re, subprocess, sys, tempfile

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import idalib as L  # noqa: E402

NODB = "--no-db" in sys.argv
TMP = tempfile.mkdtemp(prefix="idav2-kit-test-")
results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("ok    " if cond else "FAIL  ") + name + (f"  ({detail})" if detail and not cond else ""))


def node(script, payload=None):
    return L.node(script, payload)


# 1 key -------------------------------------------------------------------------------------------------------------------------
src = open(os.path.join(L.IDAV2, "client", "src", "idaV2_onClick_completed.js")).read()
js_fns = src[src.index("const canon = "):src.index("const orgOf = ")]
record = {"organization_id": "1123598813738675201", "item_id": "2107721324476432385", "item_qty": 1, "remarks": "naïve – é 中文", "x": None, "f": 0.1 + 0.2,
          "stock_movement": [{"line_index": 1, "bom_ratio": None, "total_quantity": 0.16666667, "requested_qty": 3.0799999999999996, "b": True}],
          "temp_qty_data": "[{\"sm_quantity\":1,\"balance_id\":\"2107724306903400449\"}]", "stock_movement_no_type": -9999}
js = node(js_fns + "const p = JSON.parse(require('fs').readFileSync(0, 'utf8'));"
          "const key = ('IDA:' + p.org + ':' + p.doc + ':' + hash16(canon({ saveAs: 'Completed', pageStatus: p.page, record: p.record })) + ':' + p.gen)"
          ".replace(/[^A-Za-z0-9|:_.-]/g, '-').slice(0, 128); console.log(JSON.stringify({ key, canon: canon(p.record) }));",
          {"org": "1123598813738675201", "doc": "new-mvez6fk24v72ykmx", "page": "Add", "record": record, "gen": 1})
check("1 key: ida_key = the D client's idemKey recipe", L.ida_key("1123598813738675201", "new-mvez6fk24v72ykmx", "Add", record, 1) == js["key"], js["key"])
check("1 key: canon = the client canon (unicode, floats, null, bools, -9999)", L.js_canon(record) == js["canon"])
check("1 key: the key passes IDA_KEY_RE", node(L.SHARED_JS + "console.log(JSON.stringify(C.IDA_KEY_RE.test(p.k)));", {"k": js["key"]}))

# 2 record ----------------------------------------------------------------------------------------------------------------------
contract = open(os.path.join(L.IDAV2, "CONTRACT.md")).read()
sec = contract[contract.index("**NOT_RECORD**"):contract.index("Columns (`page_status`")]
want = set(re.findall(r"`([A-Za-z0-9_$]+)`", sec)) - {"dialog_"}
check("2 record: NOT_RECORD = CONTRACT section 12's list", set(L.NOT_RECORD) == want, str(sorted(set(L.NOT_RECORD) ^ want)))
client_nr = set(re.findall(r'"([A-Za-z0-9_$]+)"', src[src.index("const IDA_NOT_RECORD"):src.index("];", src.index("const IDA_NOT_RECORD"))]))
check("2 record: NOT_RECORD = the D client's IDA_NOT_RECORD", set(L.NOT_RECORD) == client_nr, str(sorted(set(L.NOT_RECORD) ^ client_nr)))
vals = {k: 1 for k in L.NOT_RECORD} | {"dialog_x": 1, "page_status": "Add", "item_id": "1", "temp_qty_data": "[]", "table_hu": []}
check("2 record: NOT_RECORD + dialog_* dropped, page_status / temp_qty_data / table_hu kept", set(L.record_of(vals)) == {"page_status", "item_id", "temp_qty_data", "table_hu"})

# 3 moves -----------------------------------------------------------------------------------------------------------------------
hdr = {"issuing_operation_faci": "7", "organization_id": "8", "stock_movement_no": "IDA-1", "item_disassembly_date": "2026-10-21", "item_id": "10", "item_uom": "900",
       "temp_qty_data": json.dumps([{"sm_quantity": 0, "location_id": "500"}, {"sm_quantity": 1.5, "location_id": "501", "batch_id": "", "category": ""},
                                    {"sm_quantity": "2", "location_id": "503", "batch_id": "77", "category": "Blocked", "manufacturing_date": "2026-01-01 00:00:00"}])}
lines = [
    {"id": "", "line_index": 3, "item_selection": "13", "total_quantity": 1, "quantity_uom": "905", "location_id": "601", "batch_number": "Auto-generated batch number"},
    {"id": "", "line_index": 1, "item_selection": "11", "total_quantity": 2, "quantity_uom": "900", "location_id": "602", "batch_number": "LOT-1 ", "item_remark": " r "},
    {"id": "", "line_index": 2, "item_selection": "11", "total_quantity": 3, "quantity_uom": "905", "location_id": "603", "batch_number": "lot-1", "manufacturing_date": "2026-10-01"},
    {"id": "", "line_index": 4, "item_selection": "14", "total_quantity": 1, "quantity_uom": "", "location_id": "604", "batch_number": ""},
    {"id": "", "line_index": 5, "item_selection": "12", "total_quantity": 4, "quantity_uom": "", "location_id": "605", "batch_number": "-"},
    {"id": "", "line_index": 6, "item_selection": "", "total_quantity": 9}]
manual = {"item_batch_management": 1, "batch_number_genaration": "Manual Input"}
items = {"10": {"stock_control": 1, "based_uom": "900"},
         "11": dict(manual, stock_control=1, based_uom="900", table_uom_conversion=[{"alt_uom_id": "905", "base_qty": 10}]),
         "12": {"stock_control": 1, "based_uom": "900", "item_batch_management": 0},
         "13": {"stock_control": 1, "based_uom": "900", "item_batch_management": 1, "batch_number_genaration": "According To System Settings",
                "table_uom_conversion": [{"alt_uom_id": "905", "base_qty": 12}], "item_category": "C1"},
         "14": {"stock_control": 0, "based_uom": "901", "item_batch_management": 1, "batch_number_genaration": "According To System Settings"}}
b = node("const M = require('./ida_moves.js'); const p = JSON.parse(require('fs').readFileSync(0, 'utf8'));"
         "console.log(JSON.stringify(M.idaEngineMoves(p.h, p.l, p.i, { jobId: '99', prices: p.l.slice(0, 5).map((x, i) => ({ unit_price: i + 0.5 })), batchIdOf: (k) => 'id' + k.slice(1) })));",
         {"h": hdr, "l": lines, "i": items})
m = b["I"]["movements"]
check("3 moves: 2 picks in temp_qty_data order (sm_quantity 0 dropped), keys M1 / M2, op key IDC|99|I",
      [(x["movement_key"], x["location_id"], x["quantity"]) for x in m] == [("M1", "501", 1.5), ("M2", "503", 2)] and b["I"]["operation_key"] == "IDC|99|I", str(m))
check("3 moves: SUBTRACT fields (source item + UOM, category default, batch null / id, dates, doc_date, parent_trx_no '', isMovingInv 0, no HU)",
      m[0]["material_id"] == "10" and m[0]["material_uom"] == "900" and m[0]["inventory_category"] == "Unrestricted" and m[0]["batch_id"] is None
      and m[1]["batch_id"] == "77" and m[1]["inventory_category"] == "Blocked" and m[1]["manufacturing_date"] == "2026-01-01 00:00:00" and m[0]["doc_date"] == "2026-10-21 00:00:00"
      and m[0]["parent_trx_no"] == "" and m[0]["isMovingInv"] == 0 and m[0]["handling_unit_id"] is None and m[0]["trx_no"] == "IDA-1", str(m[0]))
r = b["R"]["movements"]
check("3 moves: R1..R4 over the 4 stock lines in line_index order (the non-stock and the item-less lines skipped), op key IDC|99|R",
      [(x["movement_key"], x["material_id"], x["location_id"]) for x in r] == [("R1", "11", "602"), ("R2", "11", "603"), ("R3", "13", "601"), ("R4", "12", "605")]
      and b["R"]["operation_key"] == "IDC|99|R", str([(x["movement_key"], x["material_id"]) for x in r]))
check("3 moves: ADD fields (q8 qty in the line UOM, Unrestricted, untrimmed remark, line date, the D3 price + D1 batch id, no batch_number)",
      r[0]["quantity"] == 2 and r[0]["material_uom"] == "900" and r[0]["inventory_category"] == "Unrestricted" and r[0]["remark"] == " r " and "batch_number" not in r[0]
      and r[1]["manufacturing_date"] == "2026-10-01 00:00:00" and r[0]["unit_price"] == 0.5 and r[0]["batch_id"] == "id1" and r[3]["batch_id"] is None and r[3]["material_uom"] == "")
a = b["alloc"]
check("3 moves: alloc over every recovery line (non-stock kept, share = q8(total_quantity), base by the line UOM), keys only on stock lines",
      [(x["line_index"], x["share_qty"], x["base_qty"], x["movement_key"]) for x in a] == [("1", 2, 2, "R1"), ("2", 3, 30, "R2"), ("3", 1, 12, "R3"), ("4", 1, 1, ""), ("5", 4, 4, "R4")],
      str([(x["line_index"], x["share_qty"], x["base_qty"], x["movement_key"]) for x in a]))
rows = b["batch"]["rows"]
check("3 moves: BATCH rows - TYPED 'LOT-1 ' + 'lot-1' of one item = ONE row (first text untrimmed, base 2 + 30), AUTO per line, a non-stock AUTO line insert false",
      [(x["kind"], x["batch_number"], x["initial_quantity"], len(x["line_ids"]), x["insert"]) for x in rows]
      == [("TYPED", "LOT-1 ", "32.00000000", 2, True), ("AUTO", "", "12.00000000", 1, True), ("AUTO", "", "1.00000000", 1, False)]
      and b["batch"]["mode"] == "insert" and a[0]["batch_key"] == a[1]["batch_key"] == "B1" and a[3]["batch_key"] == "", str(rows))
check("3 moves: AUTO request = idaBatchRequest (item, document date, dates, the IDA's organization); counts",
      rows[1]["request"] == {"item_id": "13", "document_date": "2026-10-21", "manufacturing_date": None, "expired_date": None, "organization_id": "8"}
      and b["counts"] == {"lines": 5, "picks": 2, "movementsI": 2, "movementsR": 4, "nonStockLines": 1, "moves": 7, "batchRows": 3, "autoRows": 2, "typedRows": 1, "items": 5},
      str(b["counts"]))

# 4 plan ------------------------------------------------------------------------------------------------------------------------
snap = {"precision": [], "itemdef": [
    {"id": "2000000000000000010", "material_code": "S", "stock_control": 1, "material_costing_method": "First In First Out", "based_uom": "900", "purchase_unit_price": "0",
     "item_batch_management": 0, "table_uom_conversion": []},
    {"id": "2000000000000000011", "material_code": "C1", "stock_control": 1, "material_costing_method": "First In First Out", "based_uom": "900", "purchase_unit_price": "0",
     "item_batch_management": 0, "table_uom_conversion": [{"alt_uom_id": "905", "base_uom_id": "900", "alt_qty": "1", "base_qty": "10"}]},
    {"id": "2000000000000000012", "material_code": "C2", "stock_control": 1, "material_costing_method": "Weighted Average", "based_uom": "900", "purchase_unit_price": "0",
     "item_batch_management": 0, "table_uom_conversion": []}],
    "ib": [{"id": "1", "material_id": "2000000000000000010", "location_id": "2000000000000000501", "plant_id": "7", "organization_id": "8", "unrestricted_qty": "10",
            "reserved_qty": "0", "block_qty": "0", "qualityinsp_qty": "0", "intransit_qty": "0", "balance_quantity": "10", "is_deleted": 0}],
    "ibb": [], "wa": [], "fifo": [{"id": "5", "material_id": "2000000000000000010", "plant_id": "7", "organization_id": "8", "batch_id": None, "fifo_sequence": "1",
                                   "fifo_available_quantity": "10", "fifo_cost_price": "4", "fifo_initial_quantity": "10", "is_deleted": 0}]}
req = {"allData": {"issuing_operation_faci": "7", "organization_id": "8", "item_disassembly_date": "2026-10-21", "item_id": "2000000000000000010", "item_qty": 2, "item_uom": "900",
                   "stock_movement_no": "IDA-T", "temp_qty_data": json.dumps([{"sm_quantity": 2, "location_id": "2000000000000000501", "balance_id": "1", "category": "Unrestricted"}]),
                   "stock_movement": [{"line_index": 1, "item_selection": "2000000000000000011", "quantity_uom": "905", "total_quantity": 1, "location_id": "2000000000000000502",
                                       "batch_number": "-"},
                                      {"line_index": 2, "item_selection": "2000000000000000012", "quantity_uom": "900", "total_quantity": 3, "location_id": "2000000000000000502",
                                       "batch_number": "-"}]}}
sp, rp = os.path.join(TMP, "snap.json"), os.path.join(TMP, "req.json")
json.dump(snap, open(sp, "w"))
json.dump(req, open(rp, "w"))
r = subprocess.run(["node", os.path.join(HERE, "plan_ida.js"), rp, sp, "--json", os.path.join(TMP, "plan.out.json")], capture_output=True, text=True)
po = json.load(open(os.path.join(TMP, "plan.out.json"))) if r.returncode == 0 else {}
# issued 8 over shares 1 + 3: 2 per share -> C1 2 / 10 base = 0.2 per base unit, C2 the remainder 6 / 3 = 2
check("4 plan: PLAN OK, issued 8, the BOX line priced per BASE unit (0.2 x 10), the remainder line 2, a new FIFO layer + a first WA row",
      r.returncode == 0 and po["op1"]["out_total"] == 8 and [x["unit_price"] for x in po["prices"]] == [0.2, 2] and any(f.get("id") == "new" and f.get("qty") == 10 for f in po["fifo"])
      and any(w.get("id") == "new" and w.get("price") == 2 for w in po["wa"]), r.stdout[-500:] + r.stderr[-300:])
req2 = copy.deepcopy(req)
req2["allData"]["temp_qty_data"] = json.dumps([{"sm_quantity": 11, "location_id": "2000000000000000501", "balance_id": "1"}])
json.dump(req2, open(rp, "w"))
r = subprocess.run(["node", os.path.join(HERE, "plan_ida.js"), rp, sp], capture_output=True, text=True)
check("4 plan: an over-qty pick -> PLAN REFUSED INSUFFICIENT at M1", r.returncode == 1 and "PLAN REFUSED op 1 INSUFFICIENT at M1" in r.stdout, r.stdout[-300:])


# 5 diff ------------------------------------------------------------------------------------------------------------------------
def snapshot(ida_id, no, src_bal, rcv_bal, mv, batch=(), job=None, steps=(), oek=None, status="Completed", lines=()):
    s = {"meta": {}, "ida": [{"id": ida_id, "stock_movement_no": no, "item_id": "10", "item_qty": "1", "item_disassembly_status": status, "posted_status": "Unposted",
                              "ida_v2_job_id": job, "ida_idem_key": "k" if job else None}] if ida_id else [],
         "idal": list(lines), "ib": [{"id": 1, "material_id": "10", "location_id": "501", "balance_quantity": str(src_bal), "unrestricted_qty": str(src_bal), "is_deleted": 0}]
         + ([{"id": rcv_bal[0], "material_id": "11", "location_id": "601", "balance_quantity": str(rcv_bal[1]), "unrestricted_qty": str(rcv_bal[1]), "is_deleted": 0}] if rcv_bal else []),
         "ibb": [], "fifo": [], "wa": [], "batch": list(batch), "item": [], "itemdef": [], "lock": [], "job": [], "step": list(steps), "bnc": [],
         "mv": [{"id": i, "item_id": it, "bin_location_id": b_, "batch_number_id": None, "movement": mvt, "transaction_type": "IDA", "trx_no": no, "quantity": "1", "base_qty": "1",
                 "unit_price": "4", "total_price": "4", "operation_effect_key": (oek or {}).get(i, ""), "inventory_category": "Unrestricted", "parent_trx_no": ""}
                for i, it, b_, mvt in mv]}
    if job:
        s["job"] = [{"id": job, "command": "COMPLETE_IDA", "job_status": "COMPLETED", "progress_percent": 100, "error_code": None}]
    return s


line = {"id": 1, "line_index": "1", "item_selection": "11", "total_quantity": "1", "batch_number": "-", "location_id": "601"}
A0 = snapshot(None, None, 10, None, [])
A1 = snapshot("100", "IDA-A", 9, (21, 1), [(201, "10", "501", "OUT"), (202, "11", "601", "IN")], batch=[{"id": 301, "material_id": "11", "batch_number": "", "is_deleted": 0}],
              lines=[dict(line, id=1)])
steps = [{"job_id": "500", "step_name": n, "step_status": "DONE"} for n in ("D0_REVALIDATE", "D2_ISSUE", "D3_RECEIPT", "D4_FINISH")] + \
        [{"job_id": "IDC|500|" + x, "step_name": "IBA|DONE", "step_status": "DONE"} for x in ("I", "R")]
B0 = snapshot(None, None, 9, (21, 1), [])
B1 = snapshot("101", "IDA-B", 8, (21, 2), [(203, "10", "501", "OUT"), (204, "11", "601", "IN")], job="500", steps=steps,
              oek={203: "IDC|500|I|M1", 204: "IDC|500|R|R1"}, lines=[dict(line, id=2)])
paths = []
for name, s in (("A0", A0), ("A1", A1), ("B0", B0), ("B1", B1)):
    p = os.path.join(TMP, name + ".json")
    json.dump(s, open(p, "w"))
    paths.append(p)
r = subprocess.run([sys.executable, os.path.join(HERE, "diff_twins_ida.py")] + paths, capture_output=True, text=True)
check("5 diff: twins SAME table by table (A creates the receipt balance row, B updates it), the blank Batch row DELIBERATE, the V2 checks pass",
      "tables differing: 0; failed checks: 0" in r.stdout and "DELIBERATE A 1 blank Batch row" in r.stdout, r.stdout[-900:])
B1x = snapshot("101", "IDA-B", 8, (21, 3), [(203, "10", "501", "OUT"), (204, "11", "601", "IN")], job="500", steps=steps, oek={203: "IDC|500|I|M1", 204: "IDC|500|R|R1"},
               lines=[dict(line, id=2)])
json.dump(B1x, open(paths[3], "w"))
r = subprocess.run([sys.executable, os.path.join(HERE, "diff_twins_ida.py")] + paths, capture_output=True, text=True)
check("5 diff: B received 2 instead of 1 -> ib DIFFERs", r.returncode == 1 and re.search(r"ib +A +2 +B +2 +DIFFER", r.stdout), r.stdout[:700])
A1s = copy.deepcopy(A1)
A1s["batch"] = [{"id": 301, "material_id": "11", "batch_number": "T-1", "initial_quantity": "1", "transaction_no": "IDA-A", "is_deleted": 0},
                {"id": 302, "material_id": "11", "batch_number": "T-1", "initial_quantity": "2", "transaction_no": "IDA-A", "is_deleted": 0}]
B1s = copy.deepcopy(B1)
B1s["batch"] = [{"id": 303, "material_id": "11", "batch_number": "T-2", "initial_quantity": "3", "transaction_no": "IDA-B", "is_deleted": 0}]
json.dump(A1s, open(paths[1], "w"))
json.dump(B1s, open(paths[3], "w"))
r = subprocess.run([sys.executable, os.path.join(HERE, "diff_twins_ida.py")] + paths, capture_output=True, text=True)
check("5 diff: a shared typed number - the classic's two Batch rows vs V2's one, same initial quantity -> batch SAME, row count DELIBERATE",
      re.search(r"batch +A +1 +B +1 +SAME", r.stdout) and "DELIBERATE A material 11: 2 Batch rows" in r.stdout, r.stdout[:900])
F0 = snapshot("102", "IDA-F", 10, None, [], status="Draft")
F1 = snapshot("102", "IDA-F", 10, None, [], status="Draft")
F1["job"] = [{"id": "600", "command": "COMPLETE_IDA", "job_status": "FAILED", "error_code": "IDA_INVENTORY_INSUFFICIENT", "error_message": "Insufficient quantity"}]
json.dump(F0, open(paths[0], "w"))
json.dump(F1, open(paths[1], "w"))
r = subprocess.run([sys.executable, os.path.join(HERE, "diff_twins_ida.py"), "--nothing-moved", paths[0], paths[1], "--code", "IDA_INVENTORY_INSUFFICIENT"], capture_output=True, text=True)
check("5 diff: --nothing-moved passes on a FAILED job that moved nothing", r.returncode == 0 and "NOTHING MOVED" in r.stdout, r.stdout[-500:])
F1["ib"][0]["balance_quantity"] = "9"
json.dump(F1, open(paths[1], "w"))
r = subprocess.run([sys.executable, os.path.join(HERE, "diff_twins_ida.py"), "--nothing-moved", paths[0], paths[1], "--code", "IDA_INVENTORY_INSUFFICIENT"], capture_output=True, text=True)
check("5 diff: --nothing-moved fails when a balance moved without a movement", r.returncode == 1 and "FAIL  item_balance deltas" in r.stdout, r.stdout[-500:])
F1["mv"] = [{"id": 900, "item_id": "10", "bin_location_id": "501", "movement": "OUT", "transaction_type": "IDA", "trx_no": "IDA-OTHER", "base_qty": "1", "quantity": "1"}]
json.dump(F1, open(paths[1], "w"))
r = subprocess.run([sys.executable, os.path.join(HERE, "diff_twins_ida.py"), "--nothing-moved", paths[0], paths[1], "--code", "IDA_INVENTORY_INSUFFICIENT"], capture_output=True, text=True)
check("5 diff: --nothing-moved passes when another document's window movement explains the delta (7b's taker)", r.returncode == 0 and "NOTHING MOVED" in r.stdout, r.stdout[-500:])

# 6 batchnum --------------------------------------------------------------------------------------------------------------------
cfg = [{"id": "2062365526375706626", "batch_level_selection": "Organization Level", "item_id": None, "item_category_id": None, "item_group_id": None, "batch_format": "Batch-%5d",
        "running_number": 631, "reset_frequency": "Never Reset", "initial_value": 0, "last_reset_date": None, "date_format": "Document Created Date",
        "format_preview": "", "organization_id": "1123598813738675201"}]
reqs = [{"item_id": "11", "document_date": "2026-10-21", "manufacturing_date": None, "expired_date": None, "organization_id": "1123598813738675201"}] * 3
bn = L.batchnum(cfg, [{"id": "11", "item_category": None, "item_group_id": None}], reqs, 1792555200000)
check("6 batchnum: 3 AUTO lines from running_number 631 -> Batch-00631..00633, config after 634", bn.get("numbers") == ["Batch-00631", "Batch-00632", "Batch-00633"]
      and (bn.get("configs") or [{}])[0].get("after", {}).get("running_number") == 634, str(bn))

# 10 recon units (fix round 1: C1 I2 I3 I4 M1 M3) -------------------------------------------------------------------------------
import recon_lib as RL  # noqa: E402

MOVES = "const M = require('./ida_moves.js'); const p = JSON.parse(require('fs').readFileSync(0, 'utf8')); console.log(JSON.stringify(M.idaEngineMoves(p.h, p.l, p.i, {})));"
FPJS = L.SHARED_JS + "console.log(JSON.stringify(F.idaLineFingerprint(p.l, p.h)));"
sub_lines = [dict(x, id=str(3001 + i)) for i, x in enumerate(lines) if x["item_selection"]]
for x in sub_lines:
    if x["item_selection"] in ("13", "14"):
        x["batch_number"] = L.PLACEHOLDER          # the form's text on an AUTO-rule item (the builder emulates it)
pre = node(MOVES, {"h": hdr, "l": sub_lines, "i": items})
part = pre["batch"]
auto_rows = [x for x in part["rows"] if x["kind"] == "AUTO"]
intent = {"numbers": {x["key"]: f"Batch-0063{i + 1}" for i, x in enumerate(auto_rows)},
          "configs": [{"id": "2062365526375706626", "before": {"running_number": 631}, "after": {"running_number": 633}}]}
num_of = {lid: intent["numbers"][x["key"]] for x in auto_rows for lid in x["line_ids"]}
post_lines = [dict(x, batch_number=num_of.get(x["id"], x["batch_number"])) for x in sub_lines]
post = node(MOVES, {"h": hdr, "l": post_lines, "i": items})
auto, prob = RL.auto_plan(part, intent, post_lines)
again = node(MOVES, {"h": hdr, "l": RL.pre_d4(post_lines, auto["line_ids"], L.PLACEHOLDER), "i": items})
check("10 C1: after D4 the AUTO lines read TYPED (the bug: 0 AUTO rows); the BATCH part + D1 intent name them, read pre-D4 they give the 2 AUTO rows again",
      pre["counts"]["autoRows"] == 2 and post["counts"]["autoRows"] == 0 and not prob and len(auto["line_ids"]) == 2 and again["counts"]["autoRows"] == 2
      and [x["kind"] for x in again["batch"]["rows"]] == [x["kind"] for x in part["rows"]], f"{pre['counts']} {post['counts']} {prob} {again['counts']}")
fp_submit = node(FPJS, {"l": sub_lines, "h": hdr})
check("10 C1: the SUBMIT fingerprint = the stored lines' with the AUTO lines back at their placeholder (the post-D4 lines' differs)",
      fp_submit == node(FPJS, {"l": RL.pre_d4(post_lines, auto["line_ids"], L.PLACEHOLDER), "h": hdr}) != node(FPJS, {"l": post_lines, "h": hdr}), fp_submit)
bad_cases = {"no intent": RL.auto_plan(part, None, post_lines)[1],
             "a number missing": RL.auto_plan(part, dict(intent, numbers=dict(list(intent["numbers"].items())[:1])), post_lines)[1],
             "a repeated number": RL.auto_plan(part, dict(intent, numbers={k: "Batch-00631" for k in intent["numbers"]}), post_lines)[1],
             "config advance 3": RL.auto_plan(part, dict(intent, configs=[{"id": "1", "before": {"running_number": 631}, "after": {"running_number": 634}}]), post_lines)[1],
             "a line without its number": RL.auto_plan(part, intent, sub_lines)[1]}
check("10 C1: auto_plan fails a missing intent, a missing / repeated number, an intent advance != the AUTO count, a line not holding its number (D4)",
      all(bad_cases.values()), str({k: bool(v) for k, v in bad_cases.items()}))
bnc0, bnc_ok, bnc_more = [{"id": "9", "running_number": 631}], [{"id": "9", "running_number": 633}], [{"id": "9", "running_number": 634}]
check("10 C1: the live config advance = the AUTO count (2: ok; 3 with no other GENERATE_BATCH run: FAIL; 3 with one: info)",
      not RL.config_advance(bnc0, bnc_ok, [{"id": "9"}], 2, 0)[0] and RL.config_advance(bnc0, bnc_more, [{"id": "9"}], 2, 0)[0]
      and not RL.config_advance(bnc0, bnc_more, [{"id": "9"}], 2, 1)[0] and RL.config_advance(bnc0, bnc_more, [{"id": "9"}], 2, 1)[1])
R4 = [{"id": "1", "scope_type": "1", "rule_key": "Inventory Price", "decimal_places": 4, "precision_rule": "1", "store_raw_value": 0},
      {"id": "2", "scope_type": "1", "rule_key": "Inventory Qty", "decimal_places": 3, "precision_rule": "1", "store_raw_value": 0}]
fifo_item = {"based_uom": "900", "material_costing_method": L.FIFO, "table_uom_conversion": [{"alt_uom_id": "905", "base_qty": "12"}]}
exp = RL.expect("in", R4, lines=[{"method": L.FIFO, "unit": 0.16666667, "item": fifo_item, "quantity": 1, "material_uom": "900"},
                                 {"method": L.FIXED, "unit": 9, "purchase": "2.5", "item": fifo_item, "quantity": 0.5, "material_uom": "905"}])
rowx = lambda u, t: {"k": "R", "unit_price": u, "total_price": t}  # noqa: E731
check("10 I2: IN prices stored at the 4 dp rule exactly (0.16666667 -> 0.1667; Fixed Cost = purchase_unit_price x base 6); 0, truncated or unrounded values FAIL",
      (exp[0]["unit_price"], exp[0]["total_price"], exp[1]["unit_price"], exp[1]["total_price"], exp[1]["base_qty"]) == (0.1667, 0.1667, 2.5, 15, 6)
      and not RL.in_price_problems([rowx("0.1667", "0.16670000"), rowx("2.5000", "15")], exp)
      and all(RL.in_price_problems([rowx(u, t), rowx("2.5", "15")], exp) for u, t in (("0", "0"), ("0.1666", "0.1666"), ("0.16666667", "0.16666667"))), str(exp))
check("10 I2: a rule applies from its creation on (a row written before the rule's id: 8 dp)",
      RL.rules_at([dict(R4[0], id=str(2112097876430200848))], "2110985745580818434") == [] and RL.rules_at(R4, None) == R4)
K = ("2064633018934157313", "2018912822846582786")
Dd = RL.dec
p0, i0 = RL.drift({K}, {K: Dd(321)}, {K: Dd(371)}, {K: Dd(321)}, {})
p1, i1 = RL.drift({K}, {K: Dd(320)}, {K: Dd(370)}, {K: Dd(321)}, {K: Dd(-1)}, touched={K})
p2, _ = RL.drift({K}, {K: Dd(321)}, {K: Dd(370)}, {K: Dd(321)}, {K: Dd(-1)}, touched={K})
p3, _ = RL.drift({K}, {K: Dd(2)}, {K: Dd(1)}, new_keys={K})
p4, i4 = RL.drift({K}, {K: Dd(321)}, {K: Dd(370)}, {K: Dd(321)}, {K: Dd(-1)}, touched=set(), foreign_keys={K})
check("10 I3: ITM-20260600005-A's old drift (balance 321 vs history 371) unchanged -> INFO only, also after our -1; a balance not moved with its movement FAILs; "
      "a key we created with drift FAILs; a changed drift on a key only another document moved is INFO",
      not p0 and i0 and not p1 and i1 and p2 and p3 and not p4 and i4, str((p0, i0, p1, p2, p3, p4, i4)))
wa_rows = [{"id": "10", "material_id": "7", "plant_id": "P", "organization_id": "O", "batch_id": None, "wa_quantity": "10.000", "wa_cost_price": "1.0000",
            "created_at": "2026-10-01 10:00:00"},
           {"id": "11", "material_id": "7", "plant_id": "P", "organization_id": "O", "batch_id": "55", "wa_quantity": "5.000", "wa_cost_price": "3.0000",
            "created_at": "2026-10-02 10:00:00"}]
rc = [{"material_id": "7", "plant_id": "P", "organization_id": "O", "batch_id": "", "base": 5, "engine_unit": 4},
      {"material_id": "8", "plant_id": "P", "organization_id": "O", "batch_id": "", "base": 2, "engine_unit": 0.5},
      {"material_id": "7", "plant_id": "P", "organization_id": "O", "batch_id": "66", "base": 1, "engine_unit": 0.33333333}]
wexp = RL.expect("wa", R4, rows=wa_rows, receipts=rc)
now_ok = [dict(wa_rows[0]), dict(wa_rows[1], wa_quantity="10.000", wa_cost_price="3.5000"),
          {"id": "20", "material_id": "8", "batch_id": None, "wa_quantity": "2.000", "wa_cost_price": "0.5000"},
          {"id": "21", "material_id": "7", "batch_id": "66", "wa_quantity": "1.000", "wa_cost_price": "0.3333"}]
h_ok = RL.wa_problems(now_ok, now_ok[2:], wexp)[0]
now_bad = [now_ok[0], dict(now_ok[1], wa_cost_price="3.4000")] + now_ok[2:] + [{"id": "22", "material_id": "7", "batch_id": None, "wa_quantity": "1", "wa_cost_price": "1"}]
h_bad, s_bad, n_bad = RL.wa_problems(now_bad, now_bad[2:], wexp)
h_loose, s_loose, _ = RL.wa_problems(now_bad, now_bad[2:], wexp, loose={"7"})
check("10 I4: WA - a non-batch receipt re-averages the NEWEST row of the material (any batch) exactly ((3 x 5 + 4 x 5) / 10 = 3.5), a first row is created at the "
      "IN price, a batch receipt gets its own row; a wrong re-average and an unexpected row FAIL (on another document's material: soft)",
      wexp["updated"] == {"11": {"wa_quantity": 10, "wa_cost_price": 3.5}} and [(x["material_id"], x["batch_id"], x["wa_cost_price"]) for x in wexp["created"]]
      == [("8", "", 0.5), ("7", "66", 0.3333)] and not h_ok and n_bad["updated_off"] == 1 and n_bad["unexpected"] == 1 and len(h_bad) == 2 and not h_loose and len(s_loose) == 2,
      str((wexp, h_ok, h_bad, n_bad)))
lay = [{"id": "a", "material_id": "9", "plant_id": "P", "organization_id": "O", "batch_id": None, "fifo_sequence": "2", "fifo_available_quantity": "4", "fifo_cost_price": "2"},
       {"id": "b", "material_id": "9", "plant_id": "P", "organization_id": "O", "batch_id": None, "fifo_sequence": "1", "fifo_available_quantity": "3", "fifo_cost_price": "1"}]
oexp = RL.expect("out", R4, layers=lay, picks=[{"material_id": "9", "plant_id": "P", "organization_id": "O", "batch_id": "", "base": 5},
                                               {"material_id": "9", "plant_id": "P", "organization_id": "O", "batch_id": "", "base": 1}])
check("10 M3: the source's OUT price = fifoUnitPrice over its layers in sequence (5 @ (3 x 1 + 2 x 2) / 5 = 1.4, then 1 @ 2); layers consumed b 3 -> 0, a 4 -> 1",
      oexp["picks"] == [{"unit_price": 1.4, "total_price": 7}, {"unit_price": 2, "total_price": 2}] and oexp["layers"] == {"b": 0, "a": 1}, str(oexp))
alloc = [{"share_qty": 1, "line_index": "1"}, {"share_qty": 3, "line_index": "2"}]
check("10 M3: the allocation re-derived in Decimal (issued 8 over shares 1 + 3 = 2 + 6); a value off by 0.01 or a sum off FAILs",
      not RL.alloc_check("8", alloc, [{"value": 2}, {"value": 6}]) and RL.alloc_check("8", alloc, [{"value": 2.01}, {"value": 5.99}])
      and RL.alloc_check("8", alloc, [{"value": 2}, {"value": 5}]))
fin = [{"item_id": "9", "batch": None}, {"item_id": "9", "batch": None}]
fexp = [{"fifo_qty": 1, "fifo_cost_price": 0.5}, {"fifo_qty": 2, "fifo_cost_price": 0.5}]
nl = [{"m": "9", "b": None, "ini": "1.000", "p": "0.5000"}, {"m": "9", "b": None, "ini": "2.000", "p": "0.5000"}]
mi, ex = RL.fifo_layer_problems(nl, fin, fexp, set())
mi2, ex2 = RL.fifo_layer_problems(nl + [{"m": "9", "b": None, "ini": "5", "p": "1"}], fin, fexp, set())
mi3, ex3 = RL.fifo_layer_problems(nl + [{"m": "9", "b": None, "ini": "5", "p": "1"}], fin, fexp, {"9"})
mi4, _ = RL.fifo_layer_problems(nl[:1] + [{"m": "9", "b": None, "ini": "2.000", "p": "0.4999"}], fin, fexp, set())
check("10 M3: one new FIFO layer per FIFO IN row exactly; an extra layer FAILs (unless another document received the material); a layer at another cost is missing",
      not mi and not ex and ex2 and not mi2 and not ex3 and mi4, str((mi, ex, ex2, ex3, mi4)))
import recon_ida as RI  # noqa: E402
_q = RI.L.q
rr = RI.R()
rr.TQ, rr.org = "tenant_id = '000000'", "8"
RI.L.q = lambda sql, env="--dev": [{"lock_key": "ITEM|9|x", "owner_operation_id": "IDC|500|I"}, {"lock_key": "ITEM|9|y", "owner_operation_id": "GDC|7|R"}]
ours, others = RI.held_locks(rr, {"9"}, "500")
RI.L.q = _q
check("10 M1: a held lock is ours only when an IDC|<job>| operation owns it; another session's held row is not (INFO)",
      [h["lock_key"] for h in ours] == ["ITEM|9|x"] and [h["lock_key"] for h in others] == ["ITEM|9|y"])

# 11 cmds (I1, M5) ---------------------------------------------------------------------------------------------------------------
TAGS = os.path.join(TMP, "tags")
small = {"allData": {"item_id": "10", "temp_qty_data": json.dumps([{"sm_quantity": 1, "location_id": "501"}]),
                     "stock_movement": [{"line_index": 1, "item_selection": "11"}]}, "saveAs": "Completed", "pageStatus": "Add"}
big = copy.deepcopy(small)
big["allData"]["stock_movement"] = [{"line_index": i + 1, "item_selection": "11"} for i in range(251)]
for tag, body, done in (("m5", small, True), ("big", big, False)):
    os.makedirs(os.path.join(TAGS, tag), exist_ok=True)
    json.dump({"tenant": "000000"}, open(os.path.join(TAGS, tag, "plan.json"), "w"))
    for what in ("classic", "draft"):
        json.dump(dict(body, saveAs="Completed" if what == "classic" else "Draft"), open(os.path.join(TAGS, tag, what + ".json"), "w"))
    if done:
        json.dump({"code": 200}, open(os.path.join(TAGS, tag, "classic.out.json"), "w"))
ENV = dict(os.environ, IDA_LIVE_OUT=TAGS)


def cmds(args, live=None):
    """cmds.main() with the live-guard answer forced (None: the real SELECT)"""
    code = ("import sys; sys.dont_write_bytecode = True; sys.path.insert(0, %r); import cmds; " % HERE
            + ("" if live is None else "cmds.v7_live = lambda: (%r, %r); " % live) + "sys.argv = ['cmds.py'] + %r; cmds.main()" % (args,))
    return subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, env=ENV, cwd=L.REPO)


r1_, r2_ = cmds(["classic", "m5"], (True, "7")), cmds(["classic", "m5", "--again"], (True, "7"))
check("11 M5: a classic re-print is refused while classic.out.json exists (a retry saves a SECOND IDA); --again prints it to .out2.json",
      r1_.returncode == 1 and "already ran" in r1_.stderr and not r1_.stdout and r2_.returncode == 0 and r2_.stdout.strip().endswith("classic.out2.json"), r1_.stderr[-300:] + r2_.stdout)
r3_, r4_, r5_ = cmds(["classic", "big"], (False, "6")), cmds(["classic", "big"], (True, "7")), cmds(["draft", "big"], (False, "6"))
check("11 I1: a 252-move classic is refused while the live IDA_SAVE lacks code_node_IDAguardStored (v6 would COMPLETE it); printed once v7 is live; its Draft prints",
      r3_.returncode == 1 and "252 moves > 250" in r3_.stderr and "run only after batch 1" in r3_.stderr and not r3_.stdout
      and r4_.returncode == 0 and "runas.mjs" in r4_.stdout and "expected refusal" in r4_.stderr and r5_.returncode == 0 and "runas.mjs" in r5_.stdout,
      r3_.stderr[-300:] + r4_.stderr[-200:] + r5_.stderr[-200:])
if not NODB:
    os.makedirs(os.path.join(TAGS, "edit-done"), exist_ok=True)
    json.dump({"tenant": "000000"}, open(os.path.join(TAGS, "edit-done", "plan.json"), "w"))
    json.dump(dict(small, pageStatus="Edit", allData=dict(small["allData"], id="2110985744909729793"), saveAs="Draft"),
              open(os.path.join(TAGS, "edit-done", "draft.json"), "w"))
    r6_ = cmds(["draft", "edit-done"], (False, "6"))
    live = subprocess.run([sys.executable, "-c", "import sys; sys.dont_write_bytecode = True; sys.path.insert(0, %r); import cmds; print(cmds.v7_live())" % HERE],
                          capture_output=True, text=True, env=ENV, cwd=L.REPO)
    check("11 I1: a Draft Edit of the stored Completed IDA-2610-003 is refused while v7 is not live (read-only SELECT of its status); the live guard reads "
          f"({live.stdout.strip()})", r6_.returncode == 1 and "Edit of the stored Completed IDA" in r6_.stderr and live.returncode == 0
          and live.stdout.strip().startswith("("), r6_.stderr[-300:] + live.stderr[-300:])
else:
    print("skip  11 I1 Edit case (needs the DB)")

# 12 diff masks (M2) -------------------------------------------------------------------------------------------------------------


def twin(no, ida, job, mv, batch, rcv):
    s = snapshot(ida, no, 9 if job is None else 8, (21, rcv), [], job=job, steps=steps if job else (), lines=[dict(line, id=1 if job is None else 2)])
    s["batch"] = batch
    s["mv"] = mv
    return s


def mrow(i, item, mvt, batch=None, price="4", method="First In First Out", oek="", ptn=""):
    return {"id": i, "item_id": item, "bin_location_id": "501" if mvt == "OUT" else "601", "batch_number_id": batch, "movement": mvt, "transaction_type": "IDA",
            "quantity": "1", "base_qty": "1", "unit_price": price, "total_price": price, "operation_effect_key": oek, "inventory_category": "Unrestricted",
            "parent_trx_no": ptn, "costing_method_id": method}


def diff_run(a1, b1, extra=()):
    for p_, s_ in ((paths[0], A0), (paths[1], a1), (paths[2], B0), (paths[3], b1)):
        json.dump(s_, open(p_, "w"))
    return subprocess.run([sys.executable, os.path.join(HERE, "diff_twins_ida.py")] + paths + list(extra), capture_output=True, text=True)


ba = [{"id": 301, "material_id": "11", "batch_number": "N1", "initial_quantity": "1", "transaction_no": "IDA-A", "is_deleted": 0},
      {"id": 302, "material_id": "11", "batch_number": "N2", "initial_quantity": "1", "transaction_no": "IDA-A", "is_deleted": 0}]
bb_ = [{"id": 303, "material_id": "11", "batch_number": "N3", "initial_quantity": "1", "transaction_no": "IDA-B", "is_deleted": 0},
       {"id": 304, "material_id": "11", "batch_number": "N4", "initial_quantity": "1", "transaction_no": "IDA-B", "is_deleted": 0}]
for x in (A0, B0):
    x["mv"] = []
oa = {}
for x in ("IDA-A", "IDA-B"):
    oa[x] = [mrow(201 if x == "IDA-A" else 211, "10", "OUT")]
for r_ in oa["IDA-A"] + oa["IDA-B"]:
    r_["trx_no"] = "IDA-A" if r_["id"] == 201 else "IDA-B"
mvA = oa["IDA-A"] + [dict(mrow(202, "11", "IN", 301), trx_no="IDA-A"), dict(mrow(203, "11", "IN", 302), trx_no="IDA-A")]
mvB = [dict(oa["IDA-B"][0], operation_effect_key="IDC|500|I|M1"), dict(mrow(212, "11", "IN", 303, oek="IDC|500|R|R1"), trx_no="IDA-B"),
       dict(mrow(213, "11", "IN", 304, oek="IDC|500|R|R2"), trx_no="IDA-B")]
A1m, B1m = twin("IDA-A", "100", None, mvA, ba, 3), twin("IDA-B", "101", "500", mvB, bb_, 3)
r7 = diff_run(A1m, B1m)
B1one = copy.deepcopy(B1m)
B1one["mv"][2]["batch_number_id"] = 303
r8 = diff_run(A1m, B1one)
check("12 M2: own Batch rows tokenised per batch (the k-th number of the material): two batches each side -> mv SAME; B's two lines in ONE batch -> mv DIFFERs",
      re.search(r"mv +A +3 +B +3 +SAME", r7.stdout) and re.search(r"mv +A +3 +B +3 +DIFFER", r8.stdout) and "<own batch 11 #2>" in r8.stdout, r7.stdout[:600] + r8.stdout[:600])
A1p = copy.deepcopy(A1m)
A1p["mv"][1]["parent_trx_no"] = "IDA-A"
r9 = diff_run(A1p, B1m)
check("12 M2: parent_trx_no is compared ('' both sides): a classic row carrying one DIFFERs", re.search(r"mv +A +3 +B +3 +DIFFER", r9.stdout), r9.stdout[:600])
B1c = copy.deepcopy(B1m)
for x in B1c["mv"]:
    x["unit_price"] = x["total_price"] = "5"
plan1, plan2 = os.path.join(TMP, "plan1.json"), os.path.join(TMP, "plan2.json")
json.dump({"out_rows": [], "in_rows": [], "fifo_layers_used": ["4"]}, open(plan1, "w"))
json.dump({"out_rows": [], "in_rows": [], "fifo_layers_used": ["4", "5"]}, open(plan2, "w"))
r10, r11, r12 = diff_run(A1m, B1c, ["--mask-prices"]), diff_run(A1m, B1c, ["--mask-prices", "--expect", plan1]), diff_run(A1m, B1c, ["--mask-prices", "--expect", plan2])
B1f = copy.deepcopy(B1c)
A1f = copy.deepcopy(A1m)
A1f["mv"][2]["costing_method_id"] = B1f["mv"][2]["costing_method_id"] = "Fixed Cost"
r13 = diff_run(A1f, B1f, ["--mask-prices", "--expect", plan2])
check("12 M2: --mask-prices is refused without --expect / when plan.json's issue takes ONE layer price; with two it masks the issue-derived prices (mv SAME) "
      "but never a Fixed Cost row's (DIFFER)", r10.returncode == 1 and "needs --expect" in r10.stderr and r11.returncode == 1 and "one price" in r11.stderr
      and re.search(r"mv +A +3 +B +3 +SAME", r12.stdout) and re.search(r"mv +A +3 +B +3 +DIFFER", r13.stdout), (r10.stderr + r11.stderr)[-300:] + r12.stdout[:400] + r13.stdout[:400])

# 7 shape -----------------------------------------------------------------------------------------------------------------------
out = os.environ.get("IDA_LIVE_OUT")
if not NODB and out and os.path.exists(os.path.join(out, "a", "classic.json")) and os.path.exists(os.path.join(out, "r1", "classic.json")):
    recd = json.loads(L.q("SELECT request_json_data FROM su_code_workflow_inst WHERE workflow_id = 2107305535347552257 AND id = 2110936708288786433")[0]["request_json_data"])
    ra = recd["workflowparams"]["allData"]
    built = L.read_json(os.path.join(out, "a", "classic.json"))
    ba = built["allData"]
    check("7 shape: header key order = recorded web Add run 2110936708288786433", list(ra) == list(ba), str([k for k in ra if k not in ba] + [k for k in ba if k not in ra]))
    tolerant = {"stock_movement_no_type"}
    check("7 shape: header value types = recorded (stock_movement_no_type: -9999 a number in 711077, the rule id text in 000000)",
          all(type(ra[k]) == type(ba[k]) for k in ra if k in ba and k not in tolerant) and isinstance(ba["stock_movement_no_type"], int),
          str([(k, type(ra[k]).__name__, type(ba[k]).__name__) for k in ra if k in ba and type(ra[k]) != type(ba[k])]))
    check("7 shape: explode line key order = recorded", list(ra["stock_movement"][0]) == list(ba["stock_movement"][0]), str(list(ba["stock_movement"][0])))
    check("7 shape: single-source pick keys = recorded", list(json.loads(ra["temp_qty_data"])[0]) == list(json.loads(ba["temp_qty_data"])[0]))
    check("7 shape: request top level {allData, saveAs, pageStatus}", list(built) == ["allData", "saveAs", "pageStatus"] and built["saveAs"] == "Completed")
    rd = json.loads(L.q("SELECT request_json_data FROM su_code_workflow_inst WHERE workflow_id = 2107305535347552257 AND id = 2108127883327025153")[0]["request_json_data"])
    rp_ = json.loads(rd["workflowparams"]["allData"]["temp_qty_data"])[0]
    bp_ = json.loads(L.read_json(os.path.join(out, "r1", "classic.json"))["allData"]["temp_qty_data"])[0]
    check("7 shape: Select Stock dialog pick keys = recorded run 2108127883327025153", list(rp_) == list(bp_), str(list(bp_)))
    sub = L.read_json(os.path.join(out, "a", "submit.json"))
    check("7 shape: SUBMIT request = CONTRACT section 7 keys, no NOT_RECORD key in form", sorted(sub) == sorted(["operation", "saveAs", "pageStatus", "ida_id", "idempotency_key", "source", "form"])
          and not set(L.NOT_RECORD) & set(sub["form"]))
else:
    print("skip  7 shape (needs the DB and IDA_LIVE_OUT with built tags a and r1)")

# 9 gates -----------------------------------------------------------------------------------------------------------------------
# every built request through the classic's own code_fillback + code_validate bodies (base/ida_code, = v7's), as a code node runs them
GATES = ("const fs = require('fs'); const p = JSON.parse(fs.readFileSync(0, 'utf8')); const body = (f) => fs.readFileSync(f, 'utf8');"
         " const run = (src, vals) => new Function(src.replace(/\\{\\{(workflowparams|node):([A-Za-z0-9_.]+)\\}\\}/g, (m, k, n) => JSON.stringify(vals[k + ':' + n])))();"
         " const fb = run(body(p.fb), { 'workflowparams:allData': p.req.allData, 'workflowparams:saveAs': p.req.saveAs, 'workflowparams:pageStatus': p.req.pageStatus });"
         " const v = run(body(p.va), { 'node:code_fillback.data.allData': fb.allData, 'node:code_fillback.data.storedStatus': fb.storedStatus,"
         " 'node:search_items.data.data': p.items, 'node:search_batches.data.data': [] });"
         " console.log(JSON.stringify({ v, no: fb.allData.stock_movement_no, lines: fb.allData.stock_movement.length }));")
if not NODB and out:
    code = os.path.join(L.IDAV2, "base", "ida_code")
    for tag in ("r1", "c", "p8", "a", "b", "d"):
        f = os.path.join(out, tag, "classic.json")
        if not os.path.exists(f):
            continue
        req = L.read_json(f)
        ad = req["allData"]
        t = L.read_json(os.path.join(out, tag, "plan.json"))["tenant"]
        ids = {str(ad["item_id"])} | {str(x["item_selection"]) for x in ad["stock_movement"]}
        import importlib.util
        spec = importlib.util.spec_from_file_location("ida_sql", os.path.join(L.SHARED, "sql.py"))
        S = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(S)
        rows = []
        for part in L.chunks(sorted(ids, key=int), 500):
            rows += [json.loads(r["j"]) for r in L.q(S.ITEMS.replace("@T", t).replace("@ITEMS", ",".join(part)))]
        got = node(GATES, {"fb": os.path.join(code, "code_fillback.js"), "va": os.path.join(code, "code_validate.js"), "req": req, "items": rows})
        check(f"9 gates: {tag} passes the classic code_fillback + code_validate ({got['lines']} lines, number {got['no']!r})", got["v"]["status"] == "Passed", got["v"]["message"])
else:
    print("skip  9 gates (needs the DB and IDA_LIVE_OUT with built tags)")

# 13 autonum (the runas route cannot GENERATE_BATCH: AUTO lines typed) -----------------------------------------------------------
if not NODB and out and os.path.exists(os.path.join(out, "r1", "plan.json")):
    import shutil
    from decimal import Decimal
    AN = os.path.join(TMP, "an")
    VAR = os.path.join(HERE, "variant.py")
    for t_ in ("r1", "r1dup"):
        os.makedirs(os.path.join(AN, t_), exist_ok=True)
        for f_ in ("classic", "draft", "submit", "status", "plan"):
            shutil.copy(os.path.join(out, "r1", f_ + ".json"), os.path.join(AN, t_, f_ + ".json"))
    pre_ = "IDV2KT-" + L.stamp()
    rv = subprocess.run([sys.executable, VAR, "r1", "autonum", pre_, "--out-dir", AN], capture_output=True, text=True, cwd=L.REPO)
    po_ = L.read_json(os.path.join(AN, "r1", "plan.json"))
    pn_ = L.read_json(os.path.join(AN, "r1-autonum", "plan.json")) if rv.returncode == 0 else {"counts": {}, "batch_rows": [], "in_rows": [], "variant": {}}
    lo_ = L.read_json(os.path.join(AN, "r1", "classic.json"))["allData"]["stock_movement"]
    ln_ = L.read_json(os.path.join(AN, "r1-autonum", "classic.json"))["allData"]["stock_movement"] if rv.returncode == 0 else []
    autos_ = [r for r in po_["batch_rows"] if r["kind"] == "AUTO"]
    changed = [(o_.get("batch_number"), n_.get("batch_number")) for o_, n_ in zip(lo_, ln_) if o_.get("batch_number") != n_.get("batch_number")]
    want_ = [f"{pre_}-{k + 1}" for k in range(len(autos_))]
    io_, in_ = L.dec(po_["issued_value_preview"]), L.dec(pn_.get("issued_value_preview"))
    same_prices = len(po_["in_rows"]) == len(pn_["in_rows"]) > 0 and all(
        abs(L.dec(a_["value"]) * in_ - L.dec(b_["value"]) * io_) <= Decimal("0.000001") and (io_ != in_ or a_["unit_price"] == b_["unit_price"])
        for a_, b_ in zip(po_["in_rows"], pn_["in_rows"]))
    check("13 autonum: r1's AUTO lines typed <prefix>-1.. in line order (every other line unchanged); plan.json rebuilt: AUTO 0, TYPED + the AUTO count, "
          "no config advance, the IN prices unchanged",
          rv.returncode == 0 and autos_ and [n for _, n in changed] == want_ and all(o in ("", L.PLACEHOLDER) for o, _ in changed)
          and pn_["counts"].get("autoRows") == 0 and pn_["counts"].get("typedRows") == po_["counts"]["typedRows"] + len(autos_) and not pn_.get("auto_configs")
          and all(r["kind"] != "AUTO" for r in pn_["batch_rows"]) and same_prices and pn_["variant"].get("numbers") == want_, rv.stdout[-500:] + rv.stderr[-400:])
    r2v = subprocess.run([sys.executable, VAR, "r1-autonum", "autonum", pre_ + "X", "--out-dir", AN], capture_output=True, text=True, cwd=L.REPO)
    held_code = ("import sys; sys.dont_write_bytecode = True; sys.path.insert(0, %r); import build_ida_payload as B; "
                 "B.holders = lambda c, nums: [{'batch_number': nums[0], 'transaction_no': 'IDA-HELD'}]; import variant; "
                 "sys.argv = ['variant.py', 'r1', 'autonum', %r, '--out-dir', %r]; sys.exit(variant.main())") % (HERE, pre_ + "H", AN)
    r3v = subprocess.run([sys.executable, "-c", held_code], capture_output=True, text=True, cwd=L.REPO)
    dup_ = L.read_json(os.path.join(AN, "r1dup", "classic.json"))
    typed_no = next((r["batch_number"] for r in po_["batch_rows"] if r["kind"] == "TYPED"), None)
    for l_ in dup_["allData"]["stock_movement"]:
        if typed_no and l_.get("batch_number") == typed_no:
            l_["batch_number"] = pre_ + "D-1"
    json.dump(dup_, open(os.path.join(AN, "r1dup", "classic.json"), "w"))
    r4v = subprocess.run([sys.executable, VAR, "r1dup", "autonum", pre_ + "D", "--out-dir", AN], capture_output=True, text=True, cwd=L.REPO)
    kept = L.read_json(os.path.join(AN, "r1-autonum", "plan.json")).get("variant", {}).get("numbers") == want_ if rv.returncode == 0 else False
    check("13 autonum: refused (nothing written) on a tag without AUTO lines, when a number is held by a live org Batch row (forced answer), and when "
          "it is typed on another line of the IDA", r2v.returncode == 1 and "no AUTO line" in r2v.stderr and r3v.returncode == 1 and "already held" in r3v.stderr
          and r4v.returncode == 1 and "another line" in r4v.stderr and kept and not os.path.exists(os.path.join(AN, "r1dup-autonum")),
          (r2v.stderr + r3v.stderr + r4v.stderr)[-600:])
else:
    print("skip  13 autonum (needs the DB and IDA_LIVE_OUT with a built r1)")

# 8 recon -----------------------------------------------------------------------------------------------------------------------
if not NODB:
    r = subprocess.run([sys.executable, os.path.join(HERE, "recon_ida.py"), "2110985744909729793", "--tenant", "000000", "--classic", "--v6"], capture_output=True, text=True, cwd=L.REPO)
    check("8 recon: --classic --v6 on dev IDA-2610-003 (read-only) RECONCILED", r.returncode == 0 and "RECONCILED" in r.stdout, r.stdout[-600:])
else:
    print("skip  8 recon (needs the DB)")

n_ok = sum(1 for _, x in results if x)
print(f"{n_ok}/{len(results)} checks passed (temp files in {TMP})")
sys.exit(0 if n_ok == len(results) else 1)

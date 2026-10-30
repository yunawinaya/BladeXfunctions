"""Live DEV test tools (WP7, 10-28): request bodies for scratchpad/gdc/tools/runas.mjs (admin@711077), built from the rows stored NOW the
way the forms load them (the shape of real browser saves: ids as text, decimals as numbers, times with milliseconds, uom_options as an
array) with the warehouse's picks chosen from the stored balances (never the line's destination bin, never the blade item).

usage: python3 scratchpad/iatr/live/lt.py <op> [args] -o <out.json>
  create <ia>  [key]               IA_TRANSFER_REQUEST CREATE: expected_fp of the stored IA, staging FA, required 2026-10-30
  refresh <ia> <lot> [key]         IA_TRANSFER_REQUEST REFRESH (expected_fp of the stored IA)
  cancel <ia> <lot> [key]          IA_TRANSFER_REQUEST CANCEL
  status <ia>                      IA_TRANSFER_REQUEST STATUS
  dispatch <lot> [i=qty ...]       LOT_V2_SUBMIT In Progress: every line picked in full (i=qty: line i picked qty), posting date today
  receive <lot>                    LOT_V2_SUBMIT Completed, the stored lines as they are
  lotcancel <lot>                  LOT_V2_SUBMIT Cancelled as the list sends it (Cancel.js: ids only)
  classic <lot> <saveAs> [pick]    SM_LOCATION_TRANSFER {allData, saveAs, pageStatus} as the classic handlers send it ("pick" = with the
                                   dispatch's picks, else the stored lines)
  newlot <saveAs> <dest bin>       SM_LOCATION_TRANSFER: a NEW ordinary transfer (Add) of the 3 cable items, 1 each, to dest
  iasave <ia> <saveAs> [i=req ...] [from=<bin>] [out=<bin>]   IA_SAVE {allData, saveAs, pageStatus}: i=req types Required on line i
                                   (required_manual 1); from=<bin> re-picks every stock line in full from that bin; out=<bin> the receipt bin
v8 (reserved requests, RESERVED_REQUEST_PLAN.md Task 12):
  iacreated <ia> [from=<bin>] [<lineId>=qty ...]   IA_SAVE Save as Created (ia_target_status Created; <lineId>=qty: that much more from the
                                   warehouse, never FA, the line's picks kept = sc_main GAP's allocation)
  hold <ia> <operation> [source]   IA_HOLD (RECONCILE / CHECK / CANCEL ...)
  dispatch8 <lot> [i=<bin> ...]    LOT_V2_SUBMIT In Progress with the stored (reserved) picks; i=<bin>: line i picked from that bin instead (T2)
  receive8 <lot> [i=d[:why] i.<batch>=d:why ...]   LOT_V2_SUBMIT Completed with form.iatr_receipts (good = dispatched - defect)
  defect <ia> <lineId>=q:why | <lineId>.<batch>=q:why ...   IA_TRANSFER_REQUEST DEFECT
  replace <ia> [key]               IA_TRANSFER_REQUEST REPLACE to FA, dated today
  worker <job>                     LOT_V2_WORKER one tick
Every body is printed as a one-line summary; the test steps and their results are in the ledger (.superpowers/sdd/<plan>/progress.md)."""
import json
import os
import re
import subprocess
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
DB = os.path.join(REPO, ".dbtools", "db")
NODE = "/opt/homebrew/bin/node" if os.path.exists("/opt/homebrew/bin/node") else "node"
T = "711077"
ORG = "2105190589240086530"
PLANT = "2105200506810306561"
FA_SL, FA_BIN = "2105224035639398402", "2107138649624088577"
A1_01 = "2106278340907413505"
BLADE = "2105492637718319110"  # the user's: never touch it at A1-01 - never picked at all here
TODAY = "2026-10-30"


def q(sql):
    r = subprocess.run([DB, "--dev", "--json", sql], capture_output=True, text=True)
    if r.returncode:
        sys.exit((r.stderr or r.stdout).strip()[-800:])
    t = r.stdout.split("\n")
    k = [i for i, l in enumerate(t) if l.strip() in ("[", "[]") or l.startswith("[{")]
    return json.loads("\n".join(t[k[0]:])) if k else []


def digits(v):
    s = str(v or "")
    assert re.match(r"^[0-9]{1,20}$", s), v
    return s


def num(v):
    f = float(v)
    return int(f) if f == int(f) else f


DECIMAL = re.compile(r"^-?\d+\.\d+$|^-?\d+(\.\d+)?E-?\d+$")


def ts(v):
    m = re.match(r"^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)(?:\.(\d+))?$", v)
    return m.group(1) + "." + (m.group(2) or "000")[:3].ljust(3, "0") if m else v


def fv(v):
    """a stored value as the form holds it"""
    if v is None:
        return ""
    if isinstance(v, int) and not isinstance(v, bool) and abs(v) >= 10 ** 15:
        return str(v)
    if isinstance(v, str) and DECIMAL.match(v):
        return num(v)
    if isinstance(v, str) and re.match(r"^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d", v):
        return ts(v)
    return v


def arr(v):
    if isinstance(v, list):
        return v
    try:
        x = json.loads(v or "[]")
        return x if isinstance(x, list) else []
    except ValueError:
        return []


# ------------------------------------------------------------------ Location Transfer
LOT_HEAD_SKIP = {"stock_movement", "table_sn_records", "table_item_balance", "table_item_balance_raw", "balance_index", "sub_tenant_id", "stock_movement_no_sn",
                 "current_table_uom", "material_id", "material_name", "material_uom", "search_serial_number", "apply_location_id", "apply_storage_location_id"}
LOT_LINE_KEYS = ["balance_id", "bundle_ratio", "id", "is_serial_allocated", "is_serialized_item", "issuing_plant", "item_bundle_id", "item_desc", "item_name",
                 "item_remark", "item_remark2", "item_remark3", "item_selection", "line_index", "location_id", "organization_id", "quantity_uom", "requested_qty",
                 "stock_summary", "storage_location_id", "temp_excess_data", "temp_hu_data", "temp_qty_data", "total_quantity", "uom_options",
                 "source_ia_line_id", "source_ref_key"]
BAL_KEYS = ["update_user", "intransit_qty", "is_deleted", "plant_id", "unrestricted_qty", "reserved_qty", "material_id", "balance_quantity", "create_user", "block_qty",
            "create_time", "material_uom", "qualityinsp_qty", "organization_id", "tenant_id", "location_id", "update_time", "create_dept"]


def lot_rows(lot):
    head = q("SELECT * FROM sm_location_transfer WHERE tenant_id = '%s' AND id = %s AND is_deleted = 0" % (T, digits(lot)))
    assert len(head) == 1, lot
    lines = q("SELECT * FROM sm_location_transfer_d2c7o1jd_sub WHERE tenant_id = '%s' AND sm_location_transfer_id = %s AND is_deleted = 0" % (T, digits(lot)))
    return head[0], sorted(lines, key=lambda r: int(r["line_index"] or 0))


def bin_names(ids):
    ids = sorted({digits(i) for i in ids})
    return {str(r["id"]): r["n"] for r in q("SELECT id, bin_location_combine n FROM bin_location WHERE id IN (%s)" % ",".join(ids))} if ids else {}


def choose(item, qty, avoid):
    """balance rows covering qty of item (Unrestricted, loose), the fullest bins first, A1-01 last; never a bin in avoid"""
    assert str(item) != BLADE, "the blade item is never picked"
    rows = q("SELECT * FROM item_balance WHERE tenant_id = '%s' AND is_deleted = 0 AND plant_id = %s AND material_id = %s AND unrestricted_qty > 0"
             % (T, PLANT, digits(item)))
    rows = [r for r in rows if str(r["location_id"]) not in avoid]
    rows.sort(key=lambda r: (str(r["location_id"]) == A1_01, -float(r["unrestricted_qty"])))
    out, need = [], float(qty)
    for r in rows:
        if need <= 1e-9:
            break
        take = min(need, float(r["unrestricted_qty"]))
        out.append((r, num(round(take, 8))))
        need -= take
    assert need <= 1e-9, ("not enough stock", item, qty)
    return out


def lot_pick(bal, qty, n):
    p = {k: fv(bal.get(k)) for k in BAL_KEYS}
    p.update({"balance_id": str(bal["id"]), "category": "Unrestricted", "unit_price": 0, "fm_key": "lt%06d" % n, "sm_quantity": qty})
    return p


def lot_form(lot, picks=None, issue_date=None, ui=False):
    """the LOT form's values; picks: {line_index: [(balance row, qty)]} replaces those lines' picks; ui: the classic handlers' getValues
    (the job fields kept), else the V2 handlers' record (NOT_RECORD removed)"""
    head, lines = lot_rows(lot)
    skip = LOT_HEAD_SKIP | (set() if ui else {"lot_v2_job_id", "lot_idem_key"})
    rec = {k: fv(v) for k, v in head.items() if k not in skip}
    rec["page_status"] = "Edit"
    rec["table_hu"] = arr(head.get("table_hu"))
    if issue_date:
        rec["issue_date"] = issue_date + " 00:00:00.000"
    names = bin_names([b["location_id"] for v in (picks or {}).values() for b, _ in v])
    out = []
    for i, l in enumerate(lines):
        row = {k: fv(l.get(k)) for k in LOT_LINE_KEYS}
        row["fm_key"] = row["id"]
        row["uom_options"] = arr(l.get("uom_options"))
        uom = (row["uom_options"] or [{}])[0].get("uom_name", "")
        p = (picks or {}).get(str(l["line_index"]))
        if p is not None:
            row["temp_qty_data"] = json.dumps([lot_pick(b, qq, i * 10 + j + 1) for j, (b, qq) in enumerate(p)], ensure_ascii=False, separators=(",", ":"))
            row["total_quantity"] = num(round(sum(qq for _, qq in p), 8))
            det = "\n".join("%d. %s: %s %s (UNR)" % (j + 1, names.get(str(b["location_id"]), "?"), qq, uom) for j, (b, qq) in enumerate(p))
            row["stock_summary"] = "Total: %s %s\n\nDETAILS:\n%s" % (row["total_quantity"], uom, det)
        out.append(row)
    rec["stock_movement"] = out
    return rec


def full_picks(lot, override=None):
    """every line of the stored request picked in its requested quantity (override {line_index: qty}), from bins other than its destination"""
    _, lines = lot_rows(lot)
    out = {}
    for l in lines:
        want = (override or {}).get(str(l["line_index"]), num(l["requested_qty"]))
        out[str(l["line_index"])] = choose(l["item_selection"], want, {str(l["location_id"]), FA_BIN}) if want else []
    return out


# a new ordinary transfer as the form's Add holds it (the keys of the real Add save, run 2112469256678539266) + the v115 request fields
# empty: the 3 cable items, 1 each, from the fullest bin to dest (units / names as LOT-20261028/0013's lines carry them)
CABLES = ["2105490803863752734", "2105490762705047577", "2105490762705047576"]
NEW_FIELDS = ["transfer_purpose", "source_ia_id", "source_ia_no", "source_ia_fp", "source_ia_rev", "required_date", "requested_by", "requested_at",
              "replaces_id", "request_log", "lot_v2_job_id", "lot_idem_key"]


def new_lot(dest):
    b = q("SELECT id, storage_location_id sl, bin_location_combine n FROM bin_location WHERE id = %s AND is_deleted = 0" % digits(dest))[0]
    ref = {str(l["item_selection"]): l for l in lot_rows("2115360155468480513")[1]}
    rec = {"acc_integration_type": "", "balance_index": [], "default_bin": "", "default_storage_location": "", "delivery_method_text": "", "is_production_order": 0,
           "issue_date": TODAY, "issued_by": "admin", "issuing_operation_faci": PLANT, "movement_id": "", "movement_reason": "", "movement_type": "Location Transfer",
           "movement_type_id": "", "organization_id": ORG, "page_status": "Add", "posted_status": "", "process_id": "", "production_order_id": "", "project_id": "",
           "receiving_operation_faci": "", "reference_documents": [], "remark": "", "remark2": "", "remark3": "", "remarks": "", "stock_movement_no": "",
           "stock_movement_no_type": "2105200574229549070", "stock_movement_status": "", "task_status": "", "table_hu": [], "table_sn_records": []}
    rec.update({k: "" for k in NEW_FIELDS})
    out = []
    for n, item in enumerate(CABLES):
        r = ref[item]
        picks = choose(item, 1, {str(dest), FA_BIN})
        names = bin_names([p["location_id"] for p, _ in picks])
        uoms = arr(r["uom_options"])
        uom = (uoms or [{}])[0].get("uom_name", "")
        out.append({"balance_id": "", "bundle_ratio": 0, "category": "Unrestricted", "fm_key": "ltnew%03d" % n, "is_serial_allocated": 0, "is_serialized_item": 0,
                    "issuing_plant": "", "item_bundle_id": "", "item_name": r["item_name"], "item_remark": "", "item_remark2": "", "item_remark3": "",
                    "item_selection": item, "line_index": "", "location_id": str(b["id"]), "organization_id": "", "project_id": "",
                    "quantity_uom": str(r["quantity_uom"]), "received_quantity": 0, "received_quantity_uom": str(r["quantity_uom"]), "receiving_plant": "",
                    "requested_qty": 0, "stock_summary": "Total: 1 %s\n\nDETAILS:\n1. %s: 1 %s (UNR)" % (uom, names.get(str(picks[0][0]["location_id"]), "?"), uom),
                    "storage_location_id": str(b["sl"]), "temp_excess_data": "", "temp_hu_data": "[]",
                    "temp_qty_data": json.dumps([lot_pick(p, qq, n * 10 + j + 1) for j, (p, qq) in enumerate(picks)], ensure_ascii=False, separators=(",", ":")),
                    "to_recv_qty": 0, "total_quantity": 1, "unit_price": 0, "uom_options": uoms})
    rec["stock_movement"] = out
    return rec


def v2(lot, save_as, rec, tag):
    return {"operation": "SUBMIT", "saveAs": save_as, "pageStatus": "Edit", "lot_id": digits(lot), "idempotency_key": "LOT:%s:%s:live-%s:1" % (ORG, lot, tag),
            "source": "FORM", "form": rec}


# ------------------------------------------------------------------ Item Assembly
IA_HEAD_SKIP = {"stock_movement", "table_item_balance", "stock_movement_no_sn", "draft_status", "created_status", "completed_status", "issued_status",
                "cancelled_status", "fullyposted_status", "sc_expand_table", "sc_line_table", "sc_expand_preview", "sc_expand_level", "ia_v2_job_id", "ia_idem_key"}
IA_LINE_SKIP = {"sm_item_assembly_id", "tenant_id", "create_dept", "create_time", "create_user", "update_time", "update_user", "is_deleted"}


def ia_rows(ia):
    head = q("SELECT * FROM sm_item_assembly WHERE tenant_id = '%s' AND id = %s AND is_deleted = 0" % (T, digits(ia)))
    assert len(head) == 1, ia
    lines = q("SELECT * FROM sm_item_assembly_tlm8ve69_sub WHERE tenant_id = '%s' AND sm_item_assembly_id = %s AND is_deleted = 0" % (T, digits(ia)))
    return head[0], sorted(lines, key=lambda r: int(r["line_index"] or 0))


def ia_fp(ia):
    head, lines = ia_rows(ia)
    h = {"plant": fv(head["issuing_operation_faci"]), "item_id": fv(head["item_id"]), "item_qty": head["item_qty"], "planned_output_qty": head["planned_output_qty"],
         "bom_consumption_mode": head["bom_consumption_mode"], "source_bom_id": fv(head["source_bom_id"])}
    tmp = os.path.join(HERE, ".fp_lines.json")
    json.dump([{"id": str(l["id"]), "item_selection": l["item_selection"], "quantity_uom": str(l["quantity_uom"]), "requested_qty": l["requested_qty"],
                "required_qty": l["required_qty"]} for l in lines], open(tmp, "w"))
    r = subprocess.run([NODE, os.path.join(HERE, "fp.js"), REPO, json.dumps(h), tmp], capture_output=True, text=True)
    os.remove(tmp)
    assert r.returncode == 0, r.stderr
    return r.stdout.strip()


def ia_pick(bal, qty):
    return {"material_id": str(bal["material_id"]), "location_id": str(bal["location_id"]), "storage_location_id": None, "batch_id": None,
            "balance_id": str(bal["id"]), "sm_quantity": qty, "category": "Unrestricted", "plant_id": str(bal["plant_id"]), "organization_id": bal["organization_id"],
            "is_deleted": 0, "expired_date": None, "manufacturing_date": None, "unrestricted_qty": num(bal["unrestricted_qty"]),
            "balance_quantity": num(bal["balance_quantity"])}


def ia_form(ia, required=None, pick_bin=None, out_bin=None):
    head, lines = ia_rows(ia)
    data = {k: fv(v) for k, v in head.items() if k not in IA_HEAD_SKIP}
    data["page_status"] = "Edit"
    data["table_hu"] = arr(head.get("table_hu"))
    data["output_split"] = arr(head.get("output_split"))
    if out_bin:
        data["location_id"] = digits(out_bin)
        data["item_assembly_date"] = TODAY + " 00:00:00.000"
    stock = {str(r["id"]) for r in q("SELECT id FROM item WHERE tenant_id = '%s' AND stock_control = 1 AND id IN (%s)"
                                       % (T, ",".join(digits(l["item_selection"]) for l in lines)))} if lines else set()
    name = bin_names([pick_bin]).get(str(pick_bin), "?") if pick_bin else ""
    out = []
    for l in lines:
        row = {k: fv(v) for k, v in l.items() if k not in IA_LINE_SKIP}
        row["uom_options"] = arr(l.get("uom_options"))
        row["fm_key"] = row["id"]
        i = str(l["line_index"])
        if required and i in required:
            row["required_qty"] = required[i]
            row["required_manual"] = "1"
        if pick_bin and str(l["item_selection"]) in stock:
            assert str(l["item_selection"]) != BLADE
            want = num(row["required_qty"] if row["required_qty"] != "" else row["requested_qty"])
            bal = q("SELECT * FROM item_balance WHERE tenant_id = '%s' AND is_deleted = 0 AND material_id = %s AND location_id = %s"
                    % (T, digits(l["item_selection"]), digits(pick_bin)))
            assert len(bal) == 1 and float(bal[0]["unrestricted_qty"]) >= want, ("bin short", i, want, bal)
            uom = (row["uom_options"] or [{}])[0].get("uom_name", "")
            row["temp_qty_data"] = json.dumps([ia_pick(bal[0], want)], ensure_ascii=False, separators=(",", ":"))
            row["total_quantity"] = want
            row["stock_summary"] = "Total: %s %s\n\nDETAILS:\n1. %s: %s %s (UNR)" % (want, uom, name, want, uom)
        out.append(row)
    data["stock_movement"] = out
    return data


# ------------------------------------------------------------------ v8: reserved requests (scratchpad/iatr/RESERVED_REQUEST_PLAN.md Task 12)
def bin_pick(item, qty, bin_id):
    """qty of item from that one bin (loose, Unrestricted): the swap of a dispatch (T2)"""
    assert str(item) != BLADE, "the blade item is never picked"
    rows = q("SELECT * FROM item_balance WHERE tenant_id = '%s' AND is_deleted = 0 AND plant_id = %s AND material_id = %s AND location_id = %s"
             % (T, PLANT, digits(item), digits(bin_id)))
    assert len(rows) == 1 and float(rows[0]["unrestricted_qty"]) >= float(qty) - 1e-9, ("bin short", item, qty, bin_id, rows)
    return [(rows[0], num(qty))]


def receipts(lot, spec):
    """the Receive dialog's receipts (lotRr_onConfirm_receive): spec {line_index: "defect[:reason]", "line_index.batch_id": "defect[:reason]"};
    good = dispatched - defect per line / batch"""
    _, lines = lot_rows(lot)
    out = {}
    for l in lines:
        i = str(l["line_index"])
        by = {}
        for p in arr(l.get("temp_qty_data")):
            if float(p.get("sm_quantity") or 0) > 0:
                b = str(p.get("batch_id") or "")
                by[b] = round(by.get(b, 0) + float(p["sm_quantity"]), 8)
        rec = {"good": 0.0, "defect": 0.0, "reason": "", "batches": {}}
        for b, sent in by.items():
            v = spec.get(i + "." + b) if b else spec.get(i)
            d, _, why = (v or "0").partition(":")
            d = float(d)
            assert 0 <= d <= sent + 1e-9, (i, b, d, sent)
            rec["good"] += sent - d
            rec["defect"] += d
            if d > 0:
                assert why, ("a defect needs its reason", i, b)
                rec["reason"] = why
            if b:
                rec["batches"][b] = {"good": str(num(round(sent - d, 8))), "defect": str(num(round(d, 8)))}
        r = {"good": str(num(round(rec["good"], 8))), "defect": str(num(round(rec["defect"], 8))), "reason": rec["reason"]}
        if rec["batches"]:
            r["batches"] = rec["batches"]
        out[str(l["id"])] = r
    return out


def ia_created(ia, extra=None, pick_bin=None):
    """the IA form's Save as Created (iaForm_onClick_saveAsCreated: IA_SAVE's Draft path with ia_target_status Created); extra {line id: qty}
    allocates that much more from the warehouse (never the staging FA bin), the line's own picks kept - sc_main GAP's allocation"""
    data = ia_form(ia, None, pick_bin)
    data["ia_target_status"] = "Created"
    for row in data["stock_movement"]:
        more = (extra or {}).get(str(row["id"]))
        if not more:
            continue
        picks = arr(row.get("temp_qty_data"))
        for b, qq in choose(row["item_selection"], more, {FA_BIN, A1_01}):
            picks.append(ia_pick(b, qq))
        row["temp_qty_data"] = json.dumps(picks, ensure_ascii=False, separators=(",", ":"))
        row["total_quantity"] = num(round(sum(float(p["sm_quantity"]) for p in picks), 8))
    return {"allData": data, "saveAs": "Draft", "pageStatus": "Edit"}


# ------------------------------------------------------------------ the ops
def kv(args):
    return {a.split("=", 1)[0]: a.split("=", 1)[1] for a in args if "=" in a}


def main(argv):
    o = argv.index("-o")
    out, args = argv[o + 1], argv[:o] + argv[o + 2:]
    op, rest = args[0], args[1:]
    if op == "create":
        ia = rest[0]
        body = {"operation": "CREATE", "ia_id": digits(ia), "organization_id": ORG, "expected_fp": ia_fp(ia), "storage_location_id": FA_SL, "location_id": FA_BIN,
                "required_date": "2026-10-30", "idempotency_key": "IATR:%s:create:%s" % (ia, rest[1] if len(rest) > 1 else "lt")}
    elif op in ("refresh", "cancel"):
        ia, lot = rest[0], rest[1]
        body = {"operation": op.upper(), "ia_id": digits(ia), "organization_id": ORG, "lot_id": digits(lot),
                "idempotency_key": "IATR:%s:%s:%s" % (ia, op, rest[2] if len(rest) > 2 else "lt")}
        if op == "refresh":
            body["expected_fp"] = ia_fp(ia)
    elif op == "status":
        body = {"operation": "STATUS", "ia_id": digits(rest[0]), "organization_id": ORG}
    elif op == "dispatch":
        lot = rest[0]
        over = {k: float(v) for k, v in kv(rest[1:]).items()}
        body = v2(lot, "In Progress", lot_form(lot, full_picks(lot, over), TODAY), "dispatch" + ("-" + "-".join("%s.%s" % x for x in sorted(over.items())) if over else ""))
    elif op == "receive":
        body = v2(rest[0], "Completed", lot_form(rest[0]), "receive")
    elif op == "lotcancel":
        head, _ = lot_rows(rest[0])
        body = {"operation": "SUBMIT", "saveAs": "Cancelled", "pageStatus": "Edit", "lot_id": digits(rest[0]),
                "idempotency_key": "LOT:%s:%s:live-cancel:1" % (ORG, rest[0]), "source": "LIST", "min_lines": "50",
                "form": {"id": str(head["id"]), "stock_movement_status": head["stock_movement_status"], "stock_movement_no": head["stock_movement_no"],
                         "organization_id": head["organization_id"]}}
    elif op == "newlot":
        save_as, dest = rest[0], rest[1]
        rec = new_lot(dest)
        body = {"allData": rec, "saveAs": save_as, "pageStatus": "Add"}
    elif op == "classic":
        lot, save_as = rest[0], rest[1]
        rec = lot_form(lot, full_picks(lot) if "pick" in rest[2:] else None, ui=True)
        body = {"allData": rec, "saveAs": save_as, "pageStatus": rec["page_status"]}
    elif op == "iasave":
        ia, save_as = rest[0], rest[1]
        opts = kv(rest[2:])
        req = {k: num(v) for k, v in opts.items() if k.isdigit()}
        data = ia_form(ia, req, opts.get("from"), opts.get("out"))
        body = {"allData": data, "saveAs": save_as, "pageStatus": "Edit"}
    # ---- v8 (reserved requests)
    elif op == "iacreated":
        ia = rest[0]
        opts = kv(rest[1:])
        body = ia_created(ia, {k: float(v) for k, v in opts.items() if k.isdigit() and len(k) > 6}, opts.get("from"))
    elif op == "hold":
        body = {"ia_id": digits(rest[0]), "organization_id": ORG, "operation": rest[1], "source": rest[2] if len(rest) > 2 else "FORM"}
    elif op == "dispatch8":
        lot = rest[0]
        swap = kv(rest[1:])
        _, lines = lot_rows(lot)
        picks = {str(l["line_index"]): bin_pick(l["item_selection"], num(l["requested_qty"]), swap[str(l["line_index"])]) for l in lines if str(l["line_index"]) in swap}
        body = v2(lot, "In Progress", lot_form(lot, picks or None, TODAY), "dispatch8" + ("-" + "-".join("%s.%s" % x for x in sorted(swap.items())) if swap else ""))
    elif op == "receive8":
        lot = rest[0]
        spec = kv(rest[1:])
        rec = lot_form(lot)
        rec["iatr_receipts"] = receipts(lot, spec)
        body = v2(lot, "Completed", rec, "receive8" + ("-" + "-".join(sorted(spec)) if spec else ""))
    elif op == "defect":
        ia = rest[0]
        d = {}
        for k, v in kv(rest[1:]).items():
            qty, _, why = v.partition(":")
            line, _, batch = k.partition(".")
            e = d.setdefault(line, {"reason": why})
            if batch:
                e.setdefault("batches", {})[batch] = qty
            else:
                e["qty"] = qty
        body = {"operation": "DEFECT", "ia_id": digits(ia), "organization_id": ORG, "defects": json.dumps(d), "idempotency_key": "IATR:%s:defect:%s" % (ia, "-".join(sorted(d)))}
    elif op == "replace":
        ia = rest[0]
        body = {"operation": "REPLACE", "ia_id": digits(ia), "organization_id": ORG, "expected_fp": ia_fp(ia), "storage_location_id": FA_SL, "location_id": FA_BIN,
                "required_date": TODAY, "idempotency_key": "IATR:%s:replace:%s" % (ia, rest[1] if len(rest) > 1 else "lt")}
    elif op == "worker":
        body = {"job_id": digits(rest[0])}
    else:
        sys.exit("unknown op " + op)
    json.dump(body, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    form = body.get("form") or body.get("allData") or {}
    lines = form.get("stock_movement") or []
    print(op, {k: body[k] for k in body if k not in ("form", "allData")}, "lines", len(lines),
          "picked", [l.get("total_quantity") for l in lines][:12], "...", "->", out)


if __name__ == "__main__":
    main(sys.argv[1:])

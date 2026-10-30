"""Live DEV test (WP7, 10-28): a LOT form's Dispatch / Receive request for LOT_V2_SUBMIT, built from the stored request as the form loads
it (the shape of real browser saves, run 2112784619141406721: ids as text, decimals as numbers, times with milliseconds, uom_options as
an array) plus the warehouse's picks from the J3-07 balance rows.

usage: python3 scratchpad/iatr/live/build_dispatch.py <short|full|receive> <out.json> [issue date]
  short    line 2 picked 5 of 6 (the others in full)  -> expect STOP IATR_NOT_FULL
  full     every line in full from J3-07              -> expect QUEUED (STAGE from Requested)
  receive  the stored In Progress request, unedited   -> expect QUEUED (COMPLETE)
reads lot13_head.json / lot13_lines.json / j307_bal.json (.dbtools/db --dev --json SELECT * dumps) next to this file"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LOT_ID = "2115360155468480513"
PICKS = {"short": {"1": 2, "2": 5, "3": 1}, "full": {"1": 2, "2": 6, "3": 1}}


def rows(name):
    t = open(os.path.join(HERE, name), encoding="utf-8").read().split("\n")
    k = [i for i, l in enumerate(t) if l.strip() in ("[", "[]") or l.startswith("[{")][0]
    return json.loads("\n".join(t[k:]))


def num(v):
    f = float(v)
    return int(f) if f == int(f) else f


def ts(v):
    m = re.match(r"^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)(?:\.(\d+))?$", v or "")
    return m.group(1) + "." + (m.group(2) or "000")[:3].ljust(3, "0") if m else v


DECIMAL = re.compile(r"^-?\d+\.\d+$|^-?\d+(\.\d+)?E-?\d+$")


def form_value(k, v):
    if v is None:
        return ""
    if isinstance(v, int) and not isinstance(v, bool) and abs(v) >= 10 ** 15:
        return str(v)
    if isinstance(v, str) and DECIMAL.match(v):
        return num(v)
    if isinstance(v, str) and re.match(r"^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d", v):
        return ts(v)
    return v


# the header as the form holds it (the real save's keys; the subform columns as the form's widgets)
HEAD_SKIP = {"stock_movement", "table_sn_records", "table_item_balance", "table_item_balance_raw", "balance_index", "sub_tenant_id", "stock_movement_no_sn",
             "current_table_uom", "material_id", "material_name", "material_uom", "search_serial_number", "apply_location_id", "apply_storage_location_id",
             "lot_v2_job_id", "lot_idem_key"}
# a line as the form holds it (the real save's line keys + the request's two line fields)
LINE_KEYS = ["balance_id", "bundle_ratio", "id", "is_serial_allocated", "is_serialized_item", "issuing_plant", "item_bundle_id", "item_desc", "item_name", "item_remark",
             "item_remark2", "item_remark3", "item_selection", "line_index", "location_id", "organization_id", "quantity_uom", "requested_qty", "stock_summary",
             "storage_location_id", "temp_excess_data", "temp_hu_data", "temp_qty_data", "total_quantity", "uom_options", "source_ia_line_id", "source_ref_key"]
BAL_KEYS = ["update_user", "intransit_qty", "is_deleted", "plant_id", "unrestricted_qty", "reserved_qty", "material_id", "balance_quantity", "create_user", "block_qty",
            "create_time", "material_uom", "qualityinsp_qty", "organization_id", "tenant_id", "location_id", "update_time", "create_dept"]


def pick(bal, qty, n):
    p = {k: form_value(k, bal.get(k)) for k in BAL_KEYS}
    p.update({"balance_id": str(bal["id"]), "category": "Unrestricted", "unit_price": 0, "fm_key": "lv%06d" % n, "sm_quantity": qty})
    return p


def build(mode, issue_date):
    head = rows("lot13_head.json")[0]
    lines = rows("lot13_lines.json")
    bals = {str(b["material_id"]): b for b in rows("j307_bal.json")}
    rec = {k: form_value(k, v) for k, v in head.items() if k not in HEAD_SKIP}
    rec["page_status"] = "Edit"
    rec["table_hu"] = []
    if mode != "receive":
        rec["issue_date"] = issue_date + " 00:00:00.000"
    out = []
    for i, l in enumerate(sorted(lines, key=lambda r: int(r["line_index"]))):
        row = {k: form_value(k, l.get(k)) for k in LINE_KEYS}
        row["fm_key"] = row["id"]
        row["uom_options"] = json.loads(l["uom_options"] or "[]")
        uom = (row["uom_options"] or [{}])[0].get("uom_name", "")
        if mode in PICKS:
            q = PICKS[mode][str(l["line_index"])]
            row["temp_qty_data"] = json.dumps([pick(bals[str(l["item_selection"])], q, i + 1)], ensure_ascii=False, separators=(",", ":"))
            row["total_quantity"] = q
            row["stock_summary"] = "Total: %s %s\n\nDETAILS:\n1. J3-07: %s %s (UNR)" % (q, uom, q, uom)
        out.append(row)
    rec["stock_movement"] = out
    save_as = "Completed" if mode == "receive" else "In Progress"
    return {"operation": "SUBMIT", "saveAs": save_as, "pageStatus": "Edit", "lot_id": LOT_ID,
            "idempotency_key": "LOT:2105190589240086530:%s:live-%s:1" % (LOT_ID, mode), "source": "FORM", "form": rec}


if __name__ == "__main__":
    mode, path = sys.argv[1], sys.argv[2]
    assert mode in ("short", "full", "receive"), mode
    req = build(mode, sys.argv[3] if len(sys.argv) > 3 else "2026-10-28")
    json.dump(req, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    sm = req["form"]["stock_movement"]
    print(mode, req["saveAs"], "lines", len(sm), "picked", [r["total_quantity"] for r in sm], "issue_date", req["form"]["issue_date"], "->", path)

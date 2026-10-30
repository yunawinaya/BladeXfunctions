"""Live DEV test (WP7, 10-28): the IA form's classic Save as Completed request for IA_SAVE, built from IA-2610-023 as the form loads it
(ids as text, decimals as numbers, times with milliseconds, uom_options as an array; the lines with their stored picks).

usage: python3 scratchpad/iatr/live/build_ia_complete.py <out.json> [--from-fa]
  --from-fa  the 3 stock lines re-picked in full from the request's destination bin FA (fa_bal.json), the finished good received into
             J3-07 (A1-01's storage location) and dated today - production consuming what the request delivered
reads ia023_head.json / ia023_lines.json (.dbtools/db --dev --json SELECT * dumps) next to this file"""
import json
import os
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_dispatch import form_value, num, rows  # noqa: E402

# DB-only columns and the form's widget placeholders (badges, UI tables) the form never sends as values
HEAD_SKIP = {"stock_movement", "table_item_balance", "stock_movement_no_sn", "draft_status", "created_status", "completed_status", "issued_status",
             "cancelled_status", "fullyposted_status", "sc_expand_table", "sc_line_table", "sc_expand_preview", "sc_expand_level", "ia_v2_job_id", "ia_idem_key"}
LINE_SKIP = {"sm_item_assembly_id", "tenant_id", "create_dept", "create_time", "create_user", "update_time", "update_user", "is_deleted"}


J307 = "2107138647224946690"


def fa_pick(bal, qty):
    """an IA pick as the IA form writes it (the stored picks' keys), from an item_balance row"""
    return {"material_id": str(bal["material_id"]), "location_id": str(bal["location_id"]), "storage_location_id": None, "batch_id": None,
            "balance_id": str(bal["id"]), "sm_quantity": qty, "category": "Unrestricted", "plant_id": str(bal["plant_id"]),
            "organization_id": bal["organization_id"], "is_deleted": 0, "expired_date": None, "manufacturing_date": None,
            "unrestricted_qty": num(bal["unrestricted_qty"]), "balance_quantity": num(bal["balance_quantity"])}


def build(from_fa=False):
    head = rows("ia023_head.json")[0]
    lines = rows("ia023_lines.json")
    fa = {str(b["material_id"]): b for b in rows("fa_bal.json")} if from_fa else {}
    data = {k: form_value(k, v) for k, v in head.items() if k not in HEAD_SKIP}
    data["page_status"] = "Edit"
    data["table_hu"] = json.loads(head["table_hu"]) if head.get("table_hu") else []
    data["output_split"] = json.loads(head["output_split"]) if head.get("output_split") else []
    if from_fa:
        data["location_id"] = J307
        data["item_assembly_date"] = "2026-10-28 00:00:00.000"
    out = []
    for l in sorted(lines, key=lambda r: int(r["line_index"])):
        row = {k: form_value(k, v) for k, v in l.items() if k not in LINE_SKIP}
        row["uom_options"] = json.loads(l["uom_options"] or "[]") if isinstance(l.get("uom_options"), str) else (l.get("uom_options") or [])
        row["fm_key"] = row["id"]
        bal = fa.get(str(l["item_selection"]))
        if bal:
            q = num(l["required_qty"])
            uom = (row["uom_options"] or [{}])[0].get("uom_name", "")
            row["temp_qty_data"] = json.dumps([fa_pick(bal, q)], ensure_ascii=False, separators=(",", ":"))
            row["total_quantity"] = q
            row["stock_summary"] = "Total: %s %s\n\nDETAILS:\n1. FA: %s %s (UNR)" % (q, uom, q, uom)
        out.append(row)
    data["stock_movement"] = out
    return {"allData": data, "saveAs": "Completed", "pageStatus": "Edit"}


if __name__ == "__main__":
    req = build("--from-fa" in sys.argv)
    json.dump(req, open(sys.argv[1], "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    d = req["allData"]
    print("IA", d["stock_movement_no"], d["item_assembly_status"], "lines", len(d["stock_movement"]),
          "picks", [len(json.loads(l["temp_qty_data"])) if l.get("temp_qty_data") else 0 for l in d["stock_movement"]], "->", sys.argv[1])

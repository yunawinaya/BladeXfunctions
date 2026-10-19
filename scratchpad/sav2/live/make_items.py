"""RUNBOOK step 0a - prepare (never run) the ITEM_SAVE Add requests of the four SAV2T test items in dev tenant 496474, from the
RECORDED ITEM_SAVE Add of that tenant (read-only SELECT of its request) - a copy of race/make_item_requests.py with the
alternate-UOM item added.

  python3 scratchpad/sav2/live/make_items.py [--config live/config.json]
    -> <out_dir>/items/<code>.json (one request body each: {"allData": {...}}) + the runas commands

Facts (dev, checked 2026-10-16 21:05):
- ITEM_SAVE 2098251509145264130 (Item/ItemSaveWorkflow.json); material_code_type -9999 keeps the given code (no serial rule).
- One UOM row ticked default purchase + sales (code_validate_uom); SAV2T-ALT adds a second, unticked row BOX (2021056571405717506)
  = 10 PCS (alt_qty 1, base_qty 10), the shape the org's own items use (item_mji552rc_sub, e.g. QQQ: BAG = 10 PCS).
- batch_number_config of the org is Organization Level -> batch_config {} (as the recorded batch Add).
- material_code is unique per org INCLUDING soft-deleted rows: SAV2T-* are unused (checked here again).
Writes per call: 1 Item row + its UOM conversion row(s) (item_mji552rc_sub; SAV2T-ALT 2) + the Upsert-Items AI call every
Item save makes; no BOM (auto_bom 0)."""
import copy, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True
sys.path.insert(0, HERE)
import twinlib as L  # noqa: E402

DROP = ("html_4zfvn8ue", "success_msg", "failed_msg")


def main():
    cfg = L.load_config()
    t, org = cfg["tenant_id"], cfg["organization_id"]
    pcs, box = cfg["uom"]["PCS"], cfg["uom"]["BOX"]
    run = L.digits(cfg["recorded"]["item_save_add"], "recorded.item_save_add")
    wf = cfg["workflows"]["ITEM_SAVE"]
    row = L.q(f"SELECT tenant_id, current_node_id, request_json_data FROM su_code_workflow_inst WHERE workflow_id={wf} AND id={run}")
    if not row or row[0]["tenant_id"] != t or row[0]["current_node_id"] != "end":
        raise SystemExit(f"template run {run} is not a successful ITEM_SAVE of tenant {t}")
    tpl = json.loads(row[0]["request_json_data"])["workflowparams"]["allData"]
    if tpl.get("page_status") != "Add" or tpl.get("material_code_type") != -9999 or str(tpl.get("organization_id")) != org:
        raise SystemExit("template is not a manual-code Add of the org")
    items = L.items_of(cfg, need_ids=False)
    codes = [it["code"] for it in items.values()]
    taken = L.q(f"SELECT material_code, is_deleted FROM item WHERE tenant_id='{t}' AND organization_id='{org}' AND material_code IN ("
                + ",".join("'" + c.replace("'", "") + "'" for c in codes) + ")")
    if taken:
        raise SystemExit("codes already used (the unique index counts soft-deleted rows too): " + json.dumps(taken))
    uoms = {r["id"]: r["uom_name"] for r in L.q(f"SELECT CAST(id AS CHAR) id, uom_name FROM unit_of_measurement WHERE tenant_id='{t}' AND is_deleted=0 "
                                                 f"AND id IN ({int(pcs)},{int(box)})")}
    if uoms.get(pcs) != "PCS" or uoms.get(box) != "BOX":
        raise SystemExit(f"UOMs not as configured: {uoms}")
    out = L.out_dir(cfg, "items")
    print(f"# STEP 0a - ITEM_SAVE {wf} Add, one call per item (template: recorded run {run}, tenant {t}, org {org}); WRITE: 1 Item row + UOM row(s) each")
    for key, m in items.items():
        a = {k: v for k, v in copy.deepcopy(tpl).items() if k not in DROP}
        conv = [{"alt_qty": 1, "alt_uom_id": pcs, "base_qty": 1, "base_uom_id": pcs, "text_b4j8h211": "=", "purchase_default_uom": 1, "sales_default_uom": 1,
                 "fm_key": L.fm_key(m["code"] + "|base")}]
        if m.get("alt"):
            conv.append({"alt_qty": 1, "alt_uom_id": cfg["uom"][m["alt"]["uom"]], "base_qty": m["alt"]["base_qty"], "base_uom_id": pcs, "text_b4j8h211": "=",
                         "purchase_default_uom": 0, "sales_default_uom": 0, "fm_key": L.fm_key(m["code"] + "|alt")})
        a.update({
            "page_status": "Add", "is_active": 1, "material_code_type": -9999, "material_code": m["code"], "material_name": m["name"],
            "material_desc": "SA V2 live twin test item (package F) - test only", "item_category": cfg["category"][m["method"]],
            "material_costing_method": m["method"], "stock_control": 1, "based_uom": pcs, "previous_based_uom": pcs, "item_properties": "Default",
            "item_batch_management": int(m["batch"]), "batch_number_genaration": "According To System Settings" if int(m["batch"]) else "",
            "serial_number_management": 0, "is_single_unit_serial": 0, "auto_bom": 0, "hu_type": "", "organization_id": org, "is_post": 0,
            "purchase_unit_price": "", "sales_unit_price": 0, "batch_config": {}, "custom_fields": {}, "table_uom_conversion": conv,
        })
        for tbl in ("table_supplier_price", "table_sup_item_access", "table_sup_item_bind", "table_reorder_supplier", "table_customer_price",
                    "table_cust_item_access", "table_cust_item_bind", "table_packing_detail", "table_default_bin", "item_image"):
            a[tbl] = []
        path = L.write_json(os.path.join(out, m["code"] + ".json"), {"allData": a})
        print(f"{m['code']:12s} {m['method']:19s} batch {m['batch']}  UOM rows {len(conv)}"
              + (f" (+ {m['alt']['uom']} = {m['alt']['base_qty']} PCS)" if m.get("alt") else ""))
        print(f"  node scratchpad/gdc/tools/runas.mjs {cfg['identity']} {wf} {path} {path[:-5]}.out.json")
    print("# then (read-only; writes only live/config.json): python3 scratchpad/sav2/live/seed.py --fill-ids && python3 scratchpad/sav2/live/seed.py --check")


if __name__ == "__main__":
    main()

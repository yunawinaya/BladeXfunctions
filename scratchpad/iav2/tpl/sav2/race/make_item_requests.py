"""Prepare (never run) the ITEM_SAVE requests that create the four SA V2 race-test items in dev tenant 496474, from a
RECORDED ITEM_SAVE Add of that tenant (read-only SELECT of its request), so the user need not create them by hand.

  python3 make_item_requests.py [--config race/config.json] [--template-run 2098294091924426754] [--out DIR]
    -> DIR/<code>.json (one request body per item: {"allData": {...}}) + the runbook commands printed

Facts the requests rely on (dev, checked 2026-10-16):
- ITEM_SAVE = 2098251509145264130, enabled v4 = Item/ItemSaveWorkflow.json (wf --dev deployed: IDENTICAL).
- material_code_type -9999 ("Manual Input", as every recorded 496474 Add): code_determine keeps the given code, so no
  serial-number rule is read (the 流水号规则 department_id trap of avoiding-bladex-data-traps does not apply).
- Required: material_name, material_code, item_category, based_uom, item_properties; exactly one UOM row ticked default
  purchase + default sales (code_validate_uom); empty price tables pass.
- Batch item: batch_number_config of org 1901545950162329602 is "Organization Level" -> the Item-Level check (403) is skipped,
  batch_config {} is what the recorded batch Add (Item-02) sent.
- Categories of the org: FIFO 2021055961214177291, WEIGHTED 2021055961214177293, FIXED 2021055961214177292 (their
  mat_costing_method = the costing_method rows FIFO / WA / FC); base UOM PCS 2021056571405717507.
- material_code is unique per (material_code, organization_id) INCLUDING soft-deleted rows: the codes must be unused.
The template's display-only HTML strings (html_4zfvn8ue, success_msg, failed_msg; not ITEM_SAVE props) are dropped.
"""
import copy, hashlib, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True  # no __pycache__ in the repo folder
sys.path.insert(0, os.path.join(HERE, "..", "parity"))
from dbq import q  # noqa: E402

ITEM_SAVE = "2098251509145264130"
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
CATEGORY = {"First In First Out": "2021055961214177291", "Weighted Average": "2021055961214177293", "Fixed Cost": "2021055961214177292"}
DROP = ("html_4zfvn8ue", "success_msg", "failed_msg")


def main():
    cfg_path = sys.argv[sys.argv.index("--config") + 1] if "--config" in sys.argv else os.path.join(HERE, "config.json")
    if not os.path.exists(cfg_path):
        cfg_path = os.path.join(HERE, "config.example.json")
    cfg = json.load(open(cfg_path))
    tpl_run = sys.argv[sys.argv.index("--template-run") + 1] if "--template-run" in sys.argv else "2098294091924426754"
    out = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else os.path.join(cfg["out_dir"], "items")
    if os.path.abspath(out).startswith(REPO + os.sep):
        raise SystemExit("refusing: --out is inside the repo")
    if not tpl_run.isdigit():
        raise SystemExit("bad --template-run")
    t, org, uom = cfg["tenant_id"], cfg["organization_id"], cfg["uom_id"]
    row = q("--dev", f"SELECT tenant_id, current_node_id, request_json_data FROM su_code_workflow_inst WHERE workflow_id={ITEM_SAVE} AND id={tpl_run}")
    if not row or row[0]["tenant_id"] != t or row[0]["current_node_id"] != "end":
        raise SystemExit(f"template run {tpl_run} is not a successful ITEM_SAVE of tenant {t}")
    tpl = json.loads(row[0]["request_json_data"])["workflowparams"]["allData"]
    if tpl.get("page_status") != "Add" or tpl.get("material_code_type") != -9999 or str(tpl.get("organization_id")) != org:
        raise SystemExit("template is not a manual-code Add of the org")
    codes = [m["code"] for k, m in cfg["materials"].items() if not k.startswith("_")]
    taken = q("--dev", "SELECT material_code, is_deleted FROM item WHERE tenant_id='" + t + "' AND organization_id='" + org + "' AND material_code IN ("
                       + ",".join("'" + c.replace("'", "") + "'" for c in codes) + ")")
    if taken:
        raise SystemExit("codes already used (unique index counts soft-deleted rows too): " + json.dumps(taken))
    have_uom = q("--dev", f"SELECT uom_name FROM unit_of_measurement WHERE tenant_id='{t}' AND is_deleted=0 AND id={int(uom)}")
    if not have_uom:
        raise SystemExit(f"base UOM {uom} not in tenant {t}")
    os.makedirs(out, exist_ok=True)
    ident = cfg["identity"]
    print(f"# ITEM_SAVE {ITEM_SAVE} Add requests (template: recorded run {tpl_run}, tenant {t}, org {org}); base UOM {uom} ({have_uom[0]['uom_name']})")
    print("# each is a WRITE (one Item row + its UOM conversion row): run only after the user's yes, one command at a time (no chaining)")
    for key, m in cfg["materials"].items():
        if key.startswith("_"):
            continue
        a = {k: v for k, v in copy.deepcopy(tpl).items() if k not in DROP}
        a.update({
            "page_status": "Add", "is_active": 1, "material_code_type": -9999, "material_code": m["code"], "material_name": m["name"],
            "material_desc": "SA V2 cost-row race test item (package E) - test only", "item_category": CATEGORY[m["method"]],
            "material_costing_method": m["method"], "stock_control": 1, "based_uom": uom, "previous_based_uom": uom, "item_properties": "Default",
            "item_batch_management": int(m["batch_managed"]), "batch_number_genaration": "According To System Settings" if int(m["batch_managed"]) else "",
            "serial_number_management": 0, "is_single_unit_serial": 0, "auto_bom": 0, "hu_type": "", "organization_id": org, "is_post": 0,
            "purchase_unit_price": "", "sales_unit_price": 0, "batch_config": {}, "custom_fields": {},
            "table_uom_conversion": [{"alt_qty": 1, "alt_uom_id": uom, "base_qty": 1, "base_uom_id": uom, "text_b4j8h211": "=", "purchase_default_uom": 1,
                                      "sales_default_uom": 1, "fm_key": hashlib.md5(m["code"].encode()).hexdigest()[:8]}],
        })
        for tbl in ("table_supplier_price", "table_sup_item_access", "table_sup_item_bind", "table_reorder_supplier", "table_customer_price",
                    "table_cust_item_access", "table_cust_item_bind", "table_packing_detail", "table_default_bin", "item_image"):
            a[tbl] = []
        path = os.path.join(out, m["code"] + ".json")
        with open(path, "w") as fh:
            json.dump({"allData": a}, fh, ensure_ascii=False, indent=1)
        print(f"{m['code']:14s} {m['method']:19s} batch {m['batch_managed']} category {CATEGORY[m['method']]}")
        print(f"  node scratchpad/gdc/tools/runas.mjs {ident} {ITEM_SAVE} {path} {path[:-5]}.out.json")
    print("# afterwards (read-only SELECT by material_code, writes only the local race/config.json):")
    print("#   python3 scratchpad/sav2/race/seed_plan.py --fill-ids")
    print("# equivalent SELECT: .dbtools/db --dev \"SELECT CAST(id AS CHAR) id, material_code FROM item WHERE tenant_id='" + t + "' AND organization_id='" + org
          + "' AND is_deleted=0 AND material_code IN (" + ",".join("'" + c + "'" for c in codes) + ")\"")


if __name__ == "__main__":
    main()

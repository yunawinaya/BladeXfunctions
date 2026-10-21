"""Writes the IDA V2 dev publish plans (wf_upload.mjs --plan). Batch 1: form + list (OFF) + IDA_SAVE v7."""
import json, os
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT = os.path.join(REPO, "Item Disassembly", "AsyncV2")
BASE = os.path.join(HERE, "..", "base")
ids = json.load(open(os.path.join(HERE, "..", "ids.json")))

smoke_lines = [{"item_selection": "0", "total_quantity": 1, "quantity_uom": "0"} for _ in range(251)]
classic_smoke = {"request": {"allData": {"id": "", "page_status": "Add", "organization_id": "1123598813738675201",
                                         "issuing_operation_faci": "0", "item_id": "0", "item_qty": 1, "item_uom": "0",
                                         "stock_movement_no": "IDAV2-SMOKE", "stock_movement_no_type": -9999,
                                         "temp_qty_data": "", "stock_movement": smoke_lines},
                             "saveAs": "Completed", "pageStatus": "Add"},
                 "expect": {"key": "code", "equals": "400"}}
batch1 = {"profile": "dev-write", "tableId": "1856231112670498818", "items": [
    {"name": "IDA form (OFF)", "kind": "form", "dataId": ids["form_sm_item_disassembly"],
     "file": os.path.join(OUT, "IDAform.json"), "base": os.path.abspath(os.path.join(BASE, "ida_form_v35.json"))},
    {"name": "IDA list (OFF)", "kind": "page", "dataId": ids["list_page_item_disassembly"],
     "file": os.path.join(OUT, "IDAlistPage.json"), "base": os.path.abspath(os.path.join(BASE, "ida_list_v17d.json"))},
    {"name": "IDA_SAVE", "dataId": ids["IDA_SAVE"], "file": os.path.join(OUT, "IDA_SAVE.json"),
     "base": os.path.abspath(os.path.join(BASE, "IDA_SAVE.v6.json")), "smoke": classic_smoke},
]}
p = os.path.join(HERE, "wf_upload.ida.batch1.plan.json")
json.dump(batch1, open(p, "w"), indent=1, ensure_ascii=False)
print("wrote", p)

batch2 = {"profile": "dev-write", "tableId": "1856231112670498818", "items": [
    {"name": "IDA_V2_PREPARE", "dataId": ids["IDA_V2_PREPARE"], "file": os.path.join(OUT, "IDA_V2_PREPARE.json"),
     "smoke": {"request": {"job_id": "x"}, "expect": {"key": "result_code", "equals": "IDA_INVALID_DATA"}}},
    {"name": "IDA_V2_COMMIT", "dataId": ids["IDA_V2_COMMIT"], "file": os.path.join(OUT, "IDA_V2_COMMIT.json"),
     "smoke": {"request": {"job_id": "x"}, "expect": {"key": "result_code", "equals": "IDA_INVALID_DATA"}}},
    {"name": "IDA_V2_WORKER", "dataId": ids["IDA_V2_WORKER"], "file": os.path.join(OUT, "IDA_V2_WORKER.json"),
     "smoke": {"request": {"job_id": ""}, "expect": {"key": "worker_route", "equals": "IDLE"}}},
    {"name": "IDA_V2_SUBMIT", "dataId": ids["IDA_V2_SUBMIT"], "file": os.path.join(OUT, "IDA_V2_SUBMIT.json"),
     "smoke": {"request": {"operation": "STATUS", "saveAs": "", "pageStatus": "", "ida_id": "2110985744909729793",
                           "idempotency_key": "", "source": "FORM", "form": ""}, "expect": {"key": "route", "equals": "STATUS"}}},
]}
p2 = os.path.join(HERE, "wf_upload.ida.batch2.plan.json")
json.dump(batch2, open(p2, "w"), indent=1, ensure_ascii=False)
print("wrote", p2)

# batch 3 (go): form + list ON (COMPLETE only); base = the OFF build batch 1 published (live v36 / v17)
OFF = os.path.join(HERE, "base_off")
batch3 = {"profile": "dev-write", "tableId": "1856231112670498818", "items": [
    {"name": "IDA form (ON)", "kind": "form", "dataId": ids["form_sm_item_disassembly"],
     "file": os.path.join(OUT, "IDAform.json"), "base": os.path.join(OFF, "IDAform.json")},
    {"name": "IDA list (ON)", "kind": "page", "dataId": ids["list_page_item_disassembly"],
     "file": os.path.join(OUT, "IDAlistPage.json"), "base": os.path.join(OFF, "IDAlistPage.json")},
]}
p3 = os.path.join(HERE, "wf_upload.ida.batch3.plan.json")
json.dump(batch3, open(p3, "w"), indent=1, ensure_ascii=False)
print("wrote", p3)

# batch 4 (final-review fixes): COMMIT (big-receipt lease, op 1 skipped -> REVIEW), SUBMIT (first due 600 s), form (escaped BOM dialog)
SNAP = os.path.join(REPO, ".superpowers", "sdd", "there-s-this-item-dissasembly-binary-sonnet", "prefix-snap", "AsyncV2")
batch4 = {"profile": "dev-write", "tableId": "1856231112670498818", "items": [
    {"name": "IDA_V2_COMMIT", "dataId": ids["IDA_V2_COMMIT"], "file": os.path.join(OUT, "IDA_V2_COMMIT.json"), "base": os.path.join(SNAP, "IDA_V2_COMMIT.json"),
     "smoke": {"request": {"job_id": "x"}, "expect": {"key": "result_code", "equals": "IDA_INVALID_DATA"}}},
    {"name": "IDA_V2_SUBMIT", "dataId": ids["IDA_V2_SUBMIT"], "file": os.path.join(OUT, "IDA_V2_SUBMIT.json"), "base": os.path.join(SNAP, "IDA_V2_SUBMIT.json"),
     "smoke": {"request": {"operation": "STATUS", "saveAs": "", "pageStatus": "", "ida_id": "2110985744909729793",
                           "idempotency_key": "", "source": "FORM", "form": ""}, "expect": {"key": "route", "equals": "STATUS"}}},
    {"name": "IDA form (ON, escaped)", "kind": "form", "dataId": ids["form_sm_item_disassembly"],
     "file": os.path.join(OUT, "IDAform.json"), "base": os.path.join(HERE, "base_on37", "IDAform.json")},
]}
p4 = os.path.join(HERE, "wf_upload.ida.batch4.plan.json")
json.dump(batch4, open(p4, "w"), indent=1, ensure_ascii=False)
print("wrote", p4)

"""Live DEV test of the SM_PLANT_TRANSFER duplicate guard (tenant 000000, org 1123598813738675201, the CLI login).

    python3 scratchpad/ptguard/test/live/cases.py req <case>              # write req/<case>.json
    python3 scratchpad/ptguard/test/live/cases.py req-ip <case> <ptId>    # In Progress request for a saved PT
    python3 scratchpad/ptguard/test/live/cases.py req-cancel <case> <ptId>
    python3 scratchpad/ptguard/test/live/cases.py req-draft <case> <ptId> # Draft save of a stored PT (must be refused)
    python3 scratchpad/ptguard/test/live/cases.py req-receive <case> <childId>

Every document carries remarks "PTGUARD-<case>" so check.py can find it. Quantities are 1-3 units of non-batch items
with thousands in stock at A-bin 2018912822846582786 (plant 1123598813738675202).
"""
import json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REQ = os.path.join(HERE, "req")
DB = os.path.join(HERE, "..", "..", "..", "..", ".dbtools", "db")
ORG, ISS, RCV, RULE, BIN = "1123598813738675201", "1123598813738675202", "1123598813738675203", "2025861792103608321", "2018912822846582786"
ITEMS = {  # material_id: (code, uom, balance_id)
    "P2": ("2066341864143695874", "POST 2", "2018906563477008389", "2066342789100974081"),
    "BS": ("2064262676831449089", "Blue Sky", "2018906563477008392", "2064263342522019842"),
    "JJ": ("2047134665199767554", "Item-Jojo-Non-Batch", "2018906563477008392", "2047135607634710529"),
    "I40": ("2047206770768797698", "POST 1", "2018906563477008392", "2047207160604188673"),
    "I41": ("2047206971399135233", "POST 2", "2018906563477008389", "2047207162424516609"),
    "P1": ("2047235050834157570", "POST 1", "2018906563477008389", "2070338657549369346"),
}
CASES = {  # case: (saveAs, key or None, [(item, qty)])
    "P0": ("Issued", "PT:1123598813738675201:new-ptguardP0:0001", []),   # probe: refused at Validate Quantity, writes nothing
    "T1": ("Issued", "PT:1123598813738675201:new-ptguardT1:0001", [("P2", 1)]),
    "T2": ("Issued", None, [("BS", 1)]),
    "T3": ("Issued", None, [("P2", 2)]),
    "T4": ("Issued", None, [("P2", 3), ("BS", 2), ("JJ", 1), ("I40", 1), ("I41", 1), ("P1", 1)]),
    "T5": ("Draft", "PT:1123598813738675201:new-ptguardT5:0001", [("BS", 3)]),
}


def line(i, item, qty):
    mat, name, uom, bal = ITEMS[item]
    entry = {"location_id": BIN, "material_id": mat, "batch_id": None, "category": "Unrestricted", "sm_quantity": qty, "plant_id": ISS,
             "organization_id": ORG, "material_uom": uom, "balance_id": bal, "tenant_id": "000000"}
    return {"id": "", "line_index": str(i + 1), "stock_summary": "", "item_selection": mat, "item_name": name, "item_desc": "", "requested_qty": "0",
            "total_quantity": str(qty), "to_recv_qty": "0", "received_quantity": "0", "quantity_uom": uom, "received_quantity_uom": uom,
            "unit_price": "0", "amount": "0", "batch_no": "", "category": "Unrestricted", "balance_id": "", "organization_id": ORG, "project_id": "",
            "manufacturing_date": "", "expired_date": "", "temp_qty_data": json.dumps([entry]), "temp_hu_data": "[]", "serial_number_data": "",
            "issuing_plant": ISS, "receiving_plant": RCV, "is_serialized_item": 0, "is_serial_allocated": 0, "item_remark": "", "item_remark_2": "",
            "item_remark_3": "", "view_hu": "", "is_split": "No", "parent_index": i}


def header(case, save_as, key, lines):
    d = {"id": "", "page_status": "Add", "issuing_operation_faci": ISS, "receiving_operation_faci": RCV, "issue_date": "2026-10-23", "stock_movement_no": "",
         "stock_movement_no_type": RULE, "movement_type": "Plant Transfer", "movement_reason": "", "issued_by": "ptguard-test", "stock_movement_status": save_as,
         "reference_documents": [], "movement_id": "", "organization_id": ORG, "project_id": "", "acc_integration_type": "", "is_production_order": 0,
         "remarks": "PTGUARD-" + case, "remark": "", "remark2": "", "remark3": "", "balance_index": [], "stock_movement": lines}
    if key:
        d["pt_idem_key"] = key
    return d


def write(name, body):
    os.makedirs(REQ, exist_ok=True)
    p = os.path.join(REQ, name + ".json")
    with open(p, "w") as f:
        json.dump(body, f, ensure_ascii=False)
    print(p)


def stored(pt_id):
    """the stored PT with its lines, as the app's getById would return it (ids as strings)"""
    def q(sql):
        out = subprocess.run([DB, "--dev", "--json", "--limit", "500", sql], capture_output=True, text=True, check=True).stdout
        return json.loads(re.sub(r"^\[(DEV|PROD)\][^\n]*\n", "", out))
    h = q("SELECT * FROM plant_transfer WHERE id = %d AND tenant_id = '000000'" % int(pt_id))[0]
    lines = q("SELECT * FROM plant_transfer_d2c7o1jd_sub WHERE plant_transfer_id = %d AND is_deleted = 0 ORDER BY line_index" % int(pt_id))
    fix = lambda r: {k: (str(v) if isinstance(v, int) and abs(v) > 2 ** 53 else v) for k, v in r.items()}
    h = fix(h)
    h["stock_movement"] = [fix(l) for l in lines]
    for k in ("create_time", "update_time", "create_user", "update_user", "create_dept", "is_deleted", "tenant_id", "pt_uuid"):
        h.pop(k, None)
    for l in h["stock_movement"]:
        for k in ("create_time", "update_time", "create_user", "update_user", "create_dept", "tenant_id"):
            l.pop(k, None)
    return h


def main():
    cmd = sys.argv[1]
    if cmd == "req":
        case = sys.argv[2]
        save_as, key, items = CASES[case]
        write(case, {"allData": header(case, save_as, key, [line(i, it, q) for i, (it, q) in enumerate(items)]), "saveAs": save_as, "pageStatus": "Add"})
    elif cmd == "req-ip":
        case, pt = sys.argv[2], sys.argv[3]
        d = stored(pt)
        d["page_status"] = "Edit"
        write(case, {"allData": d, "saveAs": "In Progress", "pageStatus": "Edit"})
    elif cmd == "req-draft":
        case, pt = sys.argv[2], sys.argv[3]
        d = stored(pt)
        d["page_status"] = "Edit"
        write(case, {"allData": d, "saveAs": "Draft", "pageStatus": "Edit"})
    elif cmd == "req-cancel":
        case, pt = sys.argv[2], sys.argv[3]
        write(case, {"allData": {"id": pt, "page_status": "Edit", "stock_movement": []}, "saveAs": "Cancelled", "pageStatus": "Edit"})
    elif cmd == "req-receive":
        case, child = sys.argv[2], sys.argv[3]
        d = stored(child)
        d["page_status"] = "Edit"
        for l in d["stock_movement"]:
            l["received_quantity"] = l["total_quantity"]
        write(case, {"allData": d, "saveAs": "Completed", "pageStatus": "Edit"})
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()

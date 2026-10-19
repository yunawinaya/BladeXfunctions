"""Read-only dev stock for the 2k payload builders (build_sa_2k.py, build_review_2k.py): items, balances, batch balances,
bins, UOM / batch names, WA / FIFO cost rows, number rules, default number rules - SELECTs through .dbtools/db --dev only.
Every query is tenant-scoped; ids come back as text."""
import json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True  # no __pycache__ in the repo folder
sys.path.insert(0, os.path.join(HERE, "..", "parity"))
from dbq import q  # noqa: E402

DIG = set("0123456789")
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
QTY = ("unrestricted_qty", "reserved_qty", "block_qty", "qualityinsp_qty", "intransit_qty", "balance_quantity")
FIFO, WA = "First In First Out", "Weighted Average"


def digits(v, what):
    v = "" if v is None else str(v)
    if not v or not set(v) <= DIG:
        raise SystemExit(f"{what} is not an id ({v!r})")
    return v


def num(v):
    try:
        return float(v) if v not in (None, "") else 0.0
    except (TypeError, ValueError):
        return 0.0


def clean(v):
    """a number column as the platform hands it to the form (no trailing zeros)"""
    f = num(v)
    return int(f) if f == int(f) else round(f, 8)


def chunks(xs, n=400):
    xs = list(xs)
    for i in range(0, len(xs), n):
        yield xs[i:i + n]


def out_dir(path):
    path = os.path.abspath(path)
    if path.startswith(REPO + os.sep):
        raise SystemExit("refusing: the output dir is inside the repo (payloads carry tenant data)")
    os.makedirs(path, exist_ok=True)
    return path


class Stock:
    def __init__(self, tenant, org, plant):
        self.t = digits(tenant, "tenant")
        self.org = digits(org, "organization")
        self.plant = digits(plant, "plant")

    def items(self):
        rows = q("--dev", "SELECT CAST(id AS CHAR) id, material_code, material_name, material_desc, material_costing_method, item_batch_management, stock_control, "
                          "serial_number_management, CAST(based_uom AS CHAR) based_uom, CAST(purchase_unit_price AS CHAR) purchase_unit_price, item_category "
                          f"FROM item WHERE tenant_id='{self.t}' AND is_deleted=0 AND organization_id='{self.org}' AND stock_control=1 "
                          f"AND material_costing_method IN ('{FIFO}', '{WA}') AND COALESCE(serial_number_management, 0) = 0 AND based_uom IS NOT NULL")
        return {r["id"]: r for r in rows}

    def bins(self):
        return q("--dev", f"SELECT CAST(id AS CHAR) id, bin_location_combine FROM bin_location WHERE tenant_id='{self.t}' AND is_deleted=0 AND plant_id={self.plant} "
                          f"AND organization_id='{self.org}' AND bin_status=1 ORDER BY id")

    def balances(self, batch=False):
        cols = ", ".join(f"CAST({c} AS CHAR) {c}" for c in QTY)
        if batch:
            return q("--dev", f"SELECT CAST(id AS CHAR) id, CAST(material_id AS CHAR) material_id, CAST(location_id AS CHAR) location_id, CAST(batch_id AS CHAR) batch_id, "
                              f"CAST(plant_id AS CHAR) plant_id, organization_id, CAST(material_uom AS CHAR) material_uom, {cols}, "
                              "DATE_FORMAT(manufacturing_date, '%Y-%m-%d %H:%i:%s') manufacturing_date, DATE_FORMAT(expired_date, '%Y-%m-%d %H:%i:%s') expired_date, "
                              "DATE_FORMAT(doc_date, '%Y-%m-%d %H:%i:%s') doc_date, remark, remark2, remark3, tenant_id, CAST(create_user AS CHAR) create_user, "
                              "CAST(create_dept AS CHAR) create_dept, DATE_FORMAT(create_time, '%Y-%m-%d %H:%i:%s.%f') create_time, CAST(update_user AS CHAR) update_user, "
                              f"DATE_FORMAT(update_time, '%Y-%m-%d %H:%i:%s.%f') update_time, is_deleted FROM item_batch_balance WHERE tenant_id='{self.t}' AND is_deleted=0 "
                              f"AND plant_id={self.plant} ORDER BY id")
        return q("--dev", f"SELECT CAST(id AS CHAR) id, CAST(material_id AS CHAR) material_id, CAST(location_id AS CHAR) location_id, CAST(plant_id AS CHAR) plant_id, "
                          f"organization_id, CAST(material_uom AS CHAR) material_uom, {cols}, tenant_id, CAST(create_user AS CHAR) create_user, CAST(create_dept AS CHAR) create_dept, "
                          "DATE_FORMAT(create_time, '%Y-%m-%d %H:%i:%s.%f') create_time, CAST(update_user AS CHAR) update_user, "
                          f"DATE_FORMAT(update_time, '%Y-%m-%d %H:%i:%s.%f') update_time, is_deleted FROM item_balance WHERE tenant_id='{self.t}' AND is_deleted=0 "
                          f"AND plant_id={self.plant} ORDER BY id")

    def cost_rows(self, materials):
        fifo, wa = [], []
        for part in chunks(sorted(materials)):
            ids = ",".join(digits(m, "material") for m in part)
            fifo += q("--dev", "SELECT CAST(id AS CHAR) id, CAST(material_id AS CHAR) material_id, CAST(plant_id AS CHAR) plant_id, organization_id, "
                               "CAST(COALESCE(batch_id, 0) AS CHAR) batch_id, fifo_sequence, CAST(fifo_cost_price AS CHAR) fifo_cost_price, "
                               "CAST(fifo_initial_quantity AS CHAR) fifo_initial_quantity, CAST(fifo_available_quantity AS CHAR) fifo_available_quantity "
                               f"FROM fifo_costing_history WHERE tenant_id='{self.t}' AND is_deleted=0 AND plant_id={self.plant} AND material_id IN ({ids})")
            wa += q("--dev", "SELECT CAST(id AS CHAR) id, CAST(material_id AS CHAR) material_id, plant_id, organization_id, CAST(COALESCE(batch_id, 0) AS CHAR) batch_id, "
                             "CAST(wa_quantity AS CHAR) wa_quantity, CAST(wa_cost_price AS CHAR) wa_cost_price, CAST(created_at AS CHAR) created_at "
                             f"FROM wa_costing_method WHERE tenant_id='{self.t}' AND is_deleted=0 AND plant_id={self.plant} AND material_id IN ({ids})")
        return fifo, wa

    def names(self, uom_ids, batch_ids):
        uoms, batches = {}, {}
        for part in chunks(sorted(uom_ids)):
            for r in q("--dev", f"SELECT CAST(id AS CHAR) id, uom_name FROM unit_of_measurement WHERE tenant_id='{self.t}' AND id IN ({','.join(part)})"):
                uoms[r["id"]] = r["uom_name"]
        for part in chunks(sorted(batch_ids)):
            for r in q("--dev", f"SELECT CAST(id AS CHAR) id, batch_number FROM batch WHERE tenant_id='{self.t}' AND id IN ({','.join(part)})"):
                batches[r["id"]] = r["batch_number"]
        return uoms, batches

    def default_rule(self, business_type):
        r = q("--dev", f"SELECT CAST(id AS CHAR) id FROM su_code_serial_no_rule WHERE tenant_id='{self.t}' AND is_deleted=0 AND business_type='{business_type}' "
                       f"AND department_id={self.org} AND is_default=1 LIMIT 1")
        return r[0]["id"] if r else ""

    def acc_integration(self):
        r = q("--dev", f"SELECT acc_integration_type FROM stock_adjustment WHERE tenant_id='{self.t}' AND is_deleted=0 AND organization_id='{self.org}' "
                       "AND acc_integration_type IS NOT NULL ORDER BY id DESC LIMIT 1")
        return r[0]["acc_integration_type"] if r else "No Accounting Integration"

    def precision(self):
        return q("--dev", "SELECT scope_type, rule_key, CAST(table_id AS CHAR) table_id, field_name, decimal_places, precision_rule, store_raw_value FROM su_code_num_precision "
                          f"WHERE tenant_id='{self.t}' AND status=1 AND is_deleted=0 AND ((scope_type='1' AND rule_key IN ('Inventory Price', 'Inventory Qty')) OR scope_type='2')")


def plan_check(engine_input_path):
    """run the real planner (parity/../gdc/engine/core.js, read-only) over the payload's §5 movements: live/plan_check.js"""
    r = subprocess.run(["node", os.path.join(HERE, "plan_check.js"), engine_input_path], capture_output=True, text=True)
    return (r.stdout + r.stderr).strip()


def entry_of(bal, movement_type, qty, batch=False):
    """a balance_index entry as the SA form / the review build writes it: the balance row + balance_id, category,
    movement_type, sa_quantity (the form's dialog copies the row; ids as text, numbers clean)"""
    e = {k: v for k, v in bal.items() if k != "id"}
    for c in QTY:
        e[c] = clean(bal.get(c))
    e["balance_id"] = bal.get("id")
    if not batch:
        e.pop("batch_id", None)
    e["category"] = "Unrestricted"
    e["movement_type"] = movement_type
    e["sa_quantity"] = qty
    return e


def write_json(path, obj):
    with open(path, "w") as fh:
        json.dump(obj, fh, ensure_ascii=False, indent=1)
    return os.path.getsize(path)

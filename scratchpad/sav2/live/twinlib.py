"""Shared helpers of the SA V2 live test kit (package F): config, read-only dev SELECTs, the client db API's record shape,
the form clients' idempotency keys (JS-exact canon + hash16), SA balance_index entries, output-dir guard. Never writes to
any database; files go to the session scratchpad only."""
import datetime, hashlib, json, os, sys
from decimal import Decimal

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.dont_write_bytecode = True  # no __pycache__ in the repo folder
sys.path.insert(0, os.path.join(HERE, "..", "parity"))
from dbq import q as _q  # noqa: E402  (E's read-only .dbtools/db wrapper)

DIG = set("0123456789")
JS_MAX = 9007199254740991
QTY = ("unrestricted_qty", "reserved_qty", "block_qty", "qualityinsp_qty", "intransit_qty", "balance_quantity")
FIFO, WA = "First In First Out", "Weighted Average"
# the SA form client's NOT_RECORD (Stock Adjustment/AsyncV2/saV2_onClick_completed.js SA_NOT_RECORD) + every dialog_* key
SA_NOT_RECORD = ["sa_v2_job_id", "sa_idem_key", "_data", "$_v", "_vts", "isTrusted", "error_message", "previous_material_uom", "sa_batch_no_map",
                 "sa_item_balance", "table_item_balance", "table_item_balance_raw", "search_batch", "material_uom", "current_table_uom", "row_index",
                 "is_serialized", "draft_status", "completed_status", "fullyposted_status", "processing_status", "cancel_status", "button_save_as_draft",
                 "button_completed", "button_completed_posted", "button_posted", "confirm_search", "reset_search", "flex_tp9swgvv", "flex_shjmh0gq",
                 "flex_palvd55h", "stock_adjustment_tittle"]
# the SC form client's SCR_NOT_RECORD (Stock Count/AsyncV2/scV2_onButtonReviewClick.js) + every dialog_* key
SC_NOT_RECORD = ["_data", "$_v", "_vts", "isTrusted", "error_message", "dialog_select_stock", "storage_location", "storage_location_id", "location",
                 "item_balance", "batch_balance", "item_item_balance", "item_batch_balance", "selectedRowIndex", "draft_status", "issued_status",
                 "processing_status", "completed_status", "cancelled_status", "to_be_reviewed_status", "in_review_status", "recount_status",
                 "button_select_stock", "button_sync", "button_approve_all", "button_draft", "button_issued", "button_count", "button_review", "log_button"]
# columns the client db API leaves out of SUBFORM rows (recorded db-fetched SA / loaded SC lines carry none of them)
SUB_SYSTEM = {"create_user", "create_dept", "create_time", "update_user", "update_time", "is_deleted", "tenant_id", "sub_tenant_id", "stock_adjustment_id",
              "stock_count_id"}


def q(sql):
    """read-only SELECT on dev (.dbtools/db refuses anything else)"""
    return _q("--dev", sql)


def digits(v, what):
    v = "" if v is None else str(v)
    if not v or not set(v) <= DIG:
        raise SystemExit(f"{what} is not an id ({v!r})")
    return v


def arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


def load_config(path=None):
    path = path or arg("--config") or os.path.join(HERE, "config.json")
    with open(path) as fh:
        cfg = json.load(fh)
    cfg["_path"] = path
    return cfg


def out_dir(cfg, *sub):
    path = os.path.abspath(os.path.join(arg("--out-dir") or cfg["out_dir"], *sub))
    if path.startswith(REPO + os.sep):
        raise SystemExit("refusing: the output dir is inside the repo (request bodies carry tenant data)")
    os.makedirs(path, exist_ok=True)
    return path


def big_str(obj):
    """every integer beyond JS's safe range as its digit string (a 19-digit id read by node / the platform would lose digits)"""
    if isinstance(obj, dict):
        return {k: big_str(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [big_str(v) for v in obj]
    if isinstance(obj, int) and not isinstance(obj, bool) and abs(obj) > JS_MAX:
        return str(obj)
    return obj


def write_json(path, obj, indent=1):
    if os.path.abspath(path).startswith(REPO + os.sep):
        raise SystemExit("refusing to write a fixture inside the repo: " + path)
    with open(path, "w") as fh:
        json.dump(big_str(obj), fh, ensure_ascii=False, indent=indent, default=str)
    return path


def items_of(cfg, need_ids=True):
    out = {}
    for k, it in cfg["items"].items():
        if k.startswith("_"):
            continue
        if need_ids:
            digits(it.get("id"), f"items.{k}.id (run seed.py --fill-ids after RUNBOOK step 0)")
        out[k] = it
    return out


def material_ids(cfg):
    return [digits(it["id"], "item id") for it in items_of(cfg).values()]


# --------------------------------------------------------------------------------------------- JS-exact values / keys
def jsnum(v):
    """a number as JS holds it after JSON.parse: integral -> int, else float"""
    d = Decimal(str(v))
    return int(d) if d == d.to_integral_value() else float(d)


def js_str(v):
    """JSON.stringify of a primitive"""
    if v is None:
        return "null"
    if v is True:
        return "true"
    if v is False:
        return "false"
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        if isinstance(v, float) and v.is_integer() and abs(v) < 1e21:
            return str(int(v))
        return json.dumps(v)
    return json.dumps(v, ensure_ascii=False)


def js_canon(v):
    """the clients' canon(): sorted keys, undefined dropped (None stays null)"""
    if isinstance(v, list):
        return "[" + ",".join(js_canon(x) for x in v) + "]"
    if isinstance(v, dict):
        return "{" + ",".join(js_str(k) + ":" + js_canon(v[k]) for k in sorted(v.keys())) + "}"
    return js_str(v)


def hash16(text):
    """the clients' hash16 over UTF-16 code units (FNV-1a 32 + djb2 32)"""
    h1, h2 = 2166136261, 5381
    data = text.encode("utf-16-le")
    for i in range(0, len(data), 2):
        c = data[i] | (data[i + 1] << 8)
        h1 = ((h1 ^ c) * 16777619) & 0xFFFFFFFF
        h2 = (h2 * 33 + c) & 0xFFFFFFFF
    return "%08x%08x" % (h1, h2)


def _key_clean(k):
    return "".join(ch if ch.isalnum() and ch.isascii() or ch in "|:_.-" else "-" for ch in k)[:128]


def record_of(values, not_record):
    r = {k: v for k, v in values.items() if k not in not_record and not k.startswith("dialog_")}
    return r


def sa_key(org, doc, page, record, gen=1):
    """saV2_onClick_completed.js idemKey: SA:<org>:<saId | new-<pageToken>>:<hash16(canon({saveAs, pageStatus, record}))>:<gen>"""
    h = hash16(js_canon({"saveAs": "Completed", "pageStatus": page, "record": record}))
    return _key_clean(f"SA:{org}:{doc}:{h}:{gen}")


def scr_key(org, sc_id, create_adjustment, record, gen=1):
    """scV2_onButtonReviewClick.js scrKey: SCR:<org>:<scId>:<hash16(canon({createAdjustment, record}))>:<gen>"""
    h = hash16(js_canon({"createAdjustment": create_adjustment, "record": record}))
    return _key_clean(f"SCR:{org}:{sc_id}:{h}:{gen}")


def page_token(tag):
    """a pageToken as the SA form makes one (Date.now base36 + 8 random base36), deterministic per tag"""
    import time
    n = int(time.time() * 1000)
    b36 = "0123456789abcdefghijklmnopqrstuvwxyz"
    s = ""
    while n:
        n, r = divmod(n, 36)
        s = b36[r] + s
    return s + hashlib.sha256(tag.encode()).hexdigest()[:8]


def fm_key(seed):
    b36 = "0123456789abcdefghijklmnopqrstuvwxyz"
    h = int(hashlib.sha256(seed.encode()).hexdigest(), 16)
    return "".join(b36[(h >> (6 * i)) % 36] for i in range(8))


# --------------------------------------------------------------------------------------------- the client db API's record shape
_TYPES = {}


def col_types(table):
    if table not in _TYPES:
        rows = q("SELECT COLUMN_NAME c, DATA_TYPE d FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '"
                 + table.replace("'", "") + "' ORDER BY ORDINAL_POSITION")
        if not rows:
            raise SystemExit("no such table " + table)
        _TYPES[table] = {r["c"]: r["d"] for r in rows}
    return _TYPES[table]


def api_value(v, t):
    if v is None:
        return None
    if t == "bigint":
        iv = int(v)
        return str(iv) if abs(iv) > JS_MAX else iv
    if t in ("int", "tinyint", "smallint", "mediumint"):
        return int(v)
    if t == "decimal":
        return jsnum(v)
    if t in ("datetime", "timestamp"):
        s = str(v)
        if "." in s:
            head, frac = s.split(".", 1)
            return head + "." + (frac + "000")[:3]
        return s + ".000"
    if t == "json":
        if isinstance(v, str):
            try:
                return json.loads(v)
            except ValueError:
                return v
        return v
    return v


def api_row(row, table, sub=False):
    """a SELECT * row as the platform's client db API hands it to a form: NULL dropped, big ints as digit strings, decimals as
    numbers, datetimes with milliseconds, JSON columns parsed; subform rows without the system columns"""
    types = col_types(table)
    out = {}
    for k, v in row.items():
        if sub and k in SUB_SYSTEM:
            continue
        x = api_value(v, types.get(k, "varchar"))
        if x is not None:
            out[k] = x
    return out


def select_all(table, where, order="id"):
    return q(f"SELECT * FROM {table} WHERE {where} ORDER BY {order}")


# --------------------------------------------------------------------------------------------- SA form entries / lines
CAT_ABBR = {"Blocked": "BLK", "Reserved": "RES", "Unrestricted": "UNR", "Quality Inspection": "QIP", "In Transit": "INT"}


def entry_of(bal_row, table, movement_type, qty, factor=1, seed="e"):
    """one balance_index entry as the SA form's item-balance dialog saves it (onConfirm_item_balance): the balance row as the db
    API gives it, id -> balance_id, + category / fm_key / sa_quantity / movement_type; quantities in the LINE's UOM (the dialog
    divides base quantities by the alt UOM's base_qty)"""
    r = api_row(bal_row, table)
    bid = r.pop("id")
    r.pop("bin_location_combine_d_n4h1t", None)
    if factor != 1:
        for c in QTY:
            if c in r and r[c]:
                r[c] = jsnum(Decimal(str(r[c])) / Decimal(factor))
    r["balance_id"] = str(bid)
    r["category"] = "Unrestricted"
    r["fm_key"] = fm_key(seed + str(bid))
    r["sa_quantity"] = jsnum(qty)
    r["movement_type"] = movement_type
    return r


def adj_summary(entries, uom_name, bin_names, batch_names):
    total = sum(Decimal(str(e["sa_quantity"])) for e in entries)
    out = [f"Total: {js_str(jsnum(total))} {uom_name}", "DETAILS:"]
    det = []
    for i, e in enumerate(entries):
        d = f"{i + 1}. {bin_names.get(str(e['location_id']), e['location_id'])}: {js_str(e['sa_quantity'])} {uom_name} ({CAT_ABBR.get(e['category'], 'UNR')}) - " \
            + ("IN" if e["movement_type"] in ("In", "IN") else "OUT")
        if e.get("batch_id"):
            d += f"\n[{batch_names.get(str(e['batch_id']), e['batch_id'])}]"
        det.append(d)
    return "\n".join(out) + "\n" + "\n".join(det)


def bi_text(entries):
    """balance_index as the form stores it: JSON.stringify of the entries"""
    return json.dumps(entries, ensure_ascii=False, separators=(",", ":"))


def today_text():
    return q("SELECT DATE_FORMAT(NOW(), '%Y-%m-%d') d")[0]["d"]


def utc_date_text():
    """new Date().toISOString().split('T')[0] - what the SC form sends as adjustmentDate"""
    return q("SELECT DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d') d")[0]["d"]

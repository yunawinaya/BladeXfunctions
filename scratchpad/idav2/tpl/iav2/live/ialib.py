"""Shared helpers of the Item Assembly V2 live-check kit (package E): config + ids, read-only SELECTs (iav2/lib/dbq.py over
.dbtools/db), the client db API's record shapes, the form client's record + idempotency key (CONTRACT section 3: canon + hash16,
JS-exact), the snowflake clock, output-dir guard. Never writes to a database; files go outside the repo only."""
import datetime, hashlib, json, os, random, sys, time
from decimal import Decimal, InvalidOperation

HERE = os.path.dirname(os.path.abspath(__file__))
IAV2 = os.path.dirname(HERE)
REPO = os.path.abspath(os.path.join(IAV2, "..", ".."))
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.join(IAV2, "lib"))
from dbq import q as _q  # noqa: E402  (WP0's read-only .dbtools/db wrapper)

# the ONE place PROD captures live (controller rule 2026-10-19: prod business data never in the repo working tree; outside any git
# repo); re-pull read-only with live/pull_prod_fixtures.sh. Dev data goes to --out-dir / $IA_LIVE_OUT.
PROD_FIXTURES = "/Users/yunawinaya/Documents/ASC-dev/iav2-fixtures/e"
EPOCH = 1288834974657
DB_TZ = datetime.timezone(datetime.timedelta(hours=8))
JS_MAX = 9007199254740991
DIG = set("0123456789")
FIFO, WA, FIXED = "First In First Out", "Weighted Average", "Fixed Cost"
QTY = ("unrestricted_qty", "reserved_qty", "block_qty", "qualityinsp_qty", "intransit_qty", "balance_quantity")
# CONTRACT section 12 NOT_RECORD (+ every dialog_* key): what the V2 client drops from getValues() before SUBMIT
NOT_RECORD = ["ia_v2_job_id", "ia_idem_key", "_data", "$_v", "_vts", "isTrusted", "sm_item_balance", "button_draft", "button_completed",
              "comp_post_button", "button_post", "draft_status", "issued_status", "completed_status", "fullyposted_status", "processing_status",
              "flex_2det1nd2", "flex_t6y2yh5r", "item_assembly_tittle"]
# columns the client db API leaves out of SUBFORM rows of a loaded record (prod Edit payload 2110996652046290946)
SUB_SYSTEM = {"create_user", "create_dept", "create_time", "update_user", "update_time", "is_deleted", "tenant_id", "sub_tenant_id", "sm_item_assembly_id"}
EXCLUDED = {"_note": "-41's GD test tenant 711077 (2026-10-19): never pick this item at this bin; never touch SO/20261016-034 / -035",
            "material": "2105492637718319110", "bin": "2106278340907413505", "plant": "2105200506810306561"}


def q(sql, env="--dev"):
    """read-only SELECT (.dbtools/db refuses anything else)"""
    return _q(env, sql)


def digits(v, what):
    v = "" if v is None else str(v)
    if not v or not set(v) <= DIG:
        raise SystemExit(f"{what} is not an id ({v!r})")
    return v


def arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


def flag(name):
    return name in sys.argv


def ids_sql(vals):
    """a bare digit list for IN (...); '0' when empty"""
    out = sorted({digits(v, "id") for v in vals if v not in (None, "")}, key=int)
    return ",".join(out) or "0"


def chunks(xs, n=400):
    xs = list(xs)
    for i in range(0, len(xs), n):
        yield xs[i:i + n]


def load_config(path=None):
    path = path or arg("--config") or os.path.join(HERE, "config.json")
    with open(path) as fh:
        cfg = json.load(fh)
    cfg["_path"] = path
    return cfg


def load_ids():
    with open(os.path.join(IAV2, "ids.json")) as fh:
        return json.load(fh)


def tenant_cfg(cfg, tenant):
    t = cfg["tenants"].get(str(tenant))
    if not t:
        raise SystemExit(f"tenant {tenant} is not in live/config.json")
    return t


def out_dir(*sub):
    """the fixtures dir: --out-dir, else $IA_LIVE_OUT; never inside the repo (request bodies and snapshots hold tenant data)"""
    base = arg("--out-dir") or os.environ.get("IA_LIVE_OUT")
    if not base:
        raise SystemExit("set --out-dir or IA_LIVE_OUT to a directory OUTSIDE the repo (the session scratchpad)")
    path = os.path.abspath(os.path.join(base, *sub))
    if path == REPO or path.startswith(REPO + os.sep):
        raise SystemExit("refusing: the output dir is inside the repo: " + path)
    os.makedirs(path, exist_ok=True)
    return path


def guard_out(path):
    p = os.path.abspath(path)
    if p == REPO or p.startswith(REPO + os.sep):
        raise SystemExit("refusing to write tenant data inside the repo: " + p)
    return p


def guard_prod(path):
    """a file holding PROD rows / run payloads: only under PROD_FIXTURES"""
    p = os.path.realpath(os.path.abspath(path))
    if not p.startswith(os.path.realpath(PROD_FIXTURES) + os.sep):
        raise SystemExit(f"refusing: prod data goes under {PROD_FIXTURES} only (got {p}); use live/pull_prod_fixtures.sh")
    os.makedirs(os.path.dirname(p), exist_ok=True)
    return p


def big_str(obj):
    """every integer beyond JS's safe range as its digit string (a 19-digit id read by node / the platform would lose digits)"""
    if isinstance(obj, dict):
        return {k: big_str(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [big_str(v) for v in obj]
    if isinstance(obj, int) and not isinstance(obj, bool) and abs(obj) > JS_MAX:
        return str(obj)
    return obj


def write_json(path, obj, indent=None):
    guard_out(path)
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w") as fh:
        json.dump(big_str(obj), fh, ensure_ascii=False, indent=indent, default=str)
    return path


def read_json(path):
    with open(path) as fh:
        return json.load(fh)


# --------------------------------------------------------------------------------------------- clocks and snowflake ids
def db_now():
    return q("SELECT DATE_FORMAT(NOW(3), '%Y-%m-%d %H:%i:%s.%f') t")[0]["t"]


def id_at(text):
    """the snowflake id bound of a MYT wall-clock text (DB datetimes are MYT)"""
    dt = datetime.datetime.strptime(text[:19], "%Y-%m-%d %H:%M:%S").replace(tzinfo=DB_TZ)
    return (int(dt.timestamp() * 1000) - EPOCH) << 22


def id_ms(i):
    return (int(i) >> 22) + EPOCH


def utc_date():
    """new Date().toISOString().split('T')[0] - what the form stamps as item_assembly_date on Add"""
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")


# --------------------------------------------------------------------------------------------- JS-exact values / keys
def dec(v):
    if v in (None, ""):
        return Decimal(0)
    try:
        return Decimal(str(v))
    except InvalidOperation:
        return Decimal(0)


def jsnum(v):
    """a number as JS holds it after JSON.parse of the platform's text: integral -> int, else float"""
    d = Decimal(str(v))
    return int(d) if d == d.to_integral_value() else float(d)


def js_str(v):
    """JSON.stringify / template-literal text of a primitive"""
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


def js_text(v):
    """`${v}` of a number or string (no quotes)"""
    if isinstance(v, str):
        return v
    return js_str(v)


def js_canon(v):
    """the clients' canon(): sorted keys, undefined dropped (None stays null)"""
    if isinstance(v, list):
        return "[" + ",".join(js_canon(x) for x in v) + "]"
    if isinstance(v, dict):
        return "{" + ",".join(js_str(k) + ":" + js_canon(v[k]) for k in sorted(v.keys())) + "}"
    return js_str(v)


def hash16(text):
    """FNV-1a 32 + djb2 32 over UTF-16 code units (the clients' hash16)"""
    h1, h2 = 2166136261, 5381
    data = text.encode("utf-16-le")
    for i in range(0, len(data), 2):
        c = data[i] | (data[i + 1] << 8)
        h1 = ((h1 ^ c) * 16777619) & 0xFFFFFFFF
        h2 = (h2 * 33 + c) & 0xFFFFFFFF
    return "%08x%08x" % (h1, h2)


def key_clean(k):
    return "".join(ch if (ch.isascii() and ch.isalnum()) or ch in "|:_.-" else "-" for ch in k)[:128]


def record_of(values):
    """getValues() minus NOT_RECORD and every dialog_* key (CONTRACT section 12)"""
    return {k: v for k, v in values.items() if k not in NOT_RECORD and not k.startswith("dialog_")}


def ia_key(org, doc, page, record, gen=1):
    """CONTRACT section 3: IA:<org>:<iaId | new-<pageToken>>:<hash16(canon({saveAs, pageStatus, record}))>:<gen>"""
    h = hash16(js_canon({"saveAs": "Completed", "pageStatus": page, "record": record}))
    return key_clean(f"IA:{org}:{doc}:{h}:{gen}")


def rv_key(org, ia_id, token):
    """RV1: IAV:<org>:<iaId>:<clickToken>"""
    return key_clean(f"IAV:{org}:{ia_id}:{token}")


def page_token(tag=""):
    """a pageToken as the form makes one: Date.now() base36 + 8 base36"""
    n = int(time.time() * 1000)
    b36 = "0123456789abcdefghijklmnopqrstuvwxyz"
    s = ""
    while n:
        n, r = divmod(n, 36)
        s = b36[r] + s
    tail = hashlib.sha256((tag + str(random.random())).encode()).hexdigest()
    return s + "".join(b36[int(tail[i:i + 2], 16) % 36] for i in range(0, 16, 2))


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


def api_row(row, table, sub=False, keep_null=False):
    """a SELECT * row as the platform's client db API hands it to a form: NULL dropped (kept with keep_null: a .get() list read),
    big ints as digit strings, decimals as numbers, datetimes with milliseconds, JSON columns parsed; subform rows without
    the system columns"""
    types = col_types(table)
    out = {}
    for k, v in row.items():
        if sub and k in SUB_SYSTEM:
            continue
        x = api_value(v, types.get(k, "varchar"))
        if x is not None or keep_null:
            out[k] = x
    return out


def ns(v):
    """an id / value as text ('' for NULL)"""
    return "" if v is None else str(v)

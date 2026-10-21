"""build_ida_payload.py <subject> [options]: Item Disassembly save requests in the shape the dev web form v35 sends to IDA_SAVE
(onClick_saveAsCompleted / onClick_saveAsDraft: { allData: getValues() minus sm_item_balance, saveAs, pageStatus }) + the matching
IDA_V2_SUBMIT / STATUS requests (CONTRACT section 7), built READ-ONLY from today's dev rows. Nothing is run.

The shape (recorded web runs: Add 2110936708288786433 / 2107733122596405250, Edit 2108127883327025153; the 23-key payloads of runs
2110921114374025217 / 2110921351171846145 / 2110985743831793666 / 2110993307680243713 are NOT form payloads - no widget keys,
reference_documents a list, picks with location_name - so they set no shape here):
  header   getValues() key order of the Add form (isTrusted, _vts, the four status html widgets, ..., stock_movement, buttons, $_v,
           ida_source_stock_mode, storage_location_id, location_id); stock_movement_no '' + the rule id (000000) or the typed number +
           -9999 (a NUMBER: 711077 has no IDA numbering rule, the form offers only Manual Input); page_status Add / Edit / Clone
  lines    BOM rows exactly as ida_src_item explodes them (ratio = q8(sub_material_qty / base qty), qty = q8(item_qty x ratio), the
           BOM UOM, item default bin else the plant default Common storage / bin, batch '-' / 'Auto-generated batch number' / '',
           remark from the BOM, uom_options = the UOM rows as JSON text) + Batch Add rows (requested_qty 0, bom_ratio null, base UOM,
           then the typed total_quantity), each with the platform's fm_key; the target bin / UOM / batch number then edited per row
  picks    the explode's single-source pick (exactly one positive loose balance, no HU) or the Select Stock dialog's row (more than
           one): the balance row as the client reads it minus id + balance_id, category, unit_price, fm_key, sm_quantity
Subjects (config.json "subjects"; --tag overrides the folder name):
  a     711077: 1 x 2783-000000-00 into its 830-component BOM, every receipt into the kit's receipt bin (J3-07)
  b     711077 twins: a 55-70-component BOM, twin A = classic.json (number <...>-A), twin B = submit.json (<...>-B); --bom ID
  c     000000 batches: ITEM-0035 x 1 (dialog pick) -> Bom-1/2/3 + TYPED shared / AUTO x 6 / WA / alt-UOM / quiet NONE lines (52 moves)
  r1    000000 classic regression: ITEM-0035 x 1 -> Bom-1/2/3 + one alt-UOM line (5 moves); --typed X = Bom-3's number
  d     711077: 2783-000000-00 x 1 into 2,000 manual lines of distinct stock items, all into J3-07
  edit  --tenant T --ida ID [--clone]: the stored IDA as the Edit form loads it (classic Completed / Draft, V2 SUBMIT Edit); --clone:
        the Clone a desktop copy sends (page_status Clone, the source ids kept: SUBMIT strips them)
  check --tenant T: read-only pre-flight (open COMPLETE_IDA jobs, Processing IDAs, held locks in the org, the receipt bin)
Options: --qty N, --bom ID, --tag NAME, --typed X (r1: Bom-3's number), --number X (711077 manual number), --gen N (key generation),
--any (a refusal test: the checks a refused request must fail print as EXPECTED, exit 0), --out-dir DIR (or $IDA_LIVE_OUT; never the repo).
Writes <out>/<tag>/: classic.json (IDA_SAVE Completed), draft.json (IDA_SAVE Draft), submit.json + status.json (IDA_V2_SUBMIT), plan.json
(the counts, picks vs available, eligibility, the expected movements, the issued-value preview and idaAllocate prices, the Batch rows
with the AUTO numbers batchnum predicts from today's config). Exit 1 when a check fails. RE-RUN right before a live test."""
import copy, json, os, sys
from decimal import Decimal

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import idalib as L  # noqa: E402

D = L.dec
# recorded client shapes (key orders)
UOM_KEYS = ["create_time", "create_dept", "id", "create_user", "organization_id", "update_user", "tenant_id", "update_time", "uom_type", "uom_name",
            "uom_desc", "sub_tenant_id", "is_deleted"]
BAL_ORDER = ["update_user", "intransit_qty", "is_deleted", "plant_id", "unrestricted_qty", "reserved_qty", "material_id", "balance_quantity", "create_user",
             "block_qty", "create_time", "material_uom", "qualityinsp_qty", "organization_id", "tenant_id", "location_id", "update_time", "create_dept"]
EDIT_HDR_ORDER = ["tenant_id", "item_code", "draft_status", "issued_status", "update_time", "completed_status", "item_uom", "item_disassembly_status",
                  "update_user", "is_deleted", "project_id", "item_disassembly_date", "stock_movement_no", "stock_movement_no_type", "stock_movement", "id",
                  "page_status", "issued_by", "issuing_operation_faci", "item_desc", "create_time", "item_id", "create_dept", "stock_summary", "temp_hu_data",
                  "temp_qty_data", "fullyposted_status", "item_name", "remarks_2", "remarks_3", "table_item_balance", "organization_id", "create_user", "table_hu",
                  "item_qty", "remarks"]
EDIT_LINE_ORDER = ["bom_ratio", "item_remark", "item_desc", "batch_number", "uom_options", "item_selection", "issuing_plant", "storage_location_id",
                   "item_remark_3", "item_name", "location_id", "requested_qty", "quantity_uom", "project_id", "item_remark_2", "organization_id", "total_quantity",
                   "id", "line_index"]
OK_CATEGORIES = ("Unrestricted", "Blocked")


def dstr(d):
    return format(D(d).normalize(), "f")


# --------------------------------------------------------------------------------------------- reads (read-only, tenant-scoped)
class Ctx:
    def __init__(self, cfg, tenant):
        self.cfg = cfg
        self.tc = L.tenant_cfg(cfg, tenant)
        self.T = L.digits(tenant, "tenant")
        self.org = L.digits(self.tc["org"], "org")
        self.plant = L.digits(self.tc["plant"], "plant")
        self.TQ = f"tenant_id = '{self.T}'"
        self.problems, self.warnings = [], []

    def fail(self, text):
        self.problems.append(text)

    def warn(self, text):
        self.warnings.append(text)


def read_items(c, ids):
    ids = sorted({L.digits(i, "item") for i in ids if i}, key=int)
    items = {}
    for part in L.chunks(ids, 500):
        for r in L.q("SELECT CAST(id AS CHAR) id, material_code, material_name, material_desc, CAST(based_uom AS CHAR) based_uom, stock_control, "
                     "material_costing_method, item_batch_management, batch_number_genaration, serial_number_management, organization_id, "
                     "CAST(purchase_unit_price AS CHAR) purchase_unit_price, item_category, item_group_id, is_deleted, DATE_FORMAT(create_time, '%Y-%m-%d %H:%i:%s') created "
                     f"FROM item WHERE {c.TQ} AND id IN ({','.join(part)})"):
            r["table_uom_conversion"], r["table_default_bin"] = [], []
            items[r["id"]] = r
        for u in L.q("SELECT CAST(Item_id AS CHAR) item, CAST(alt_uom_id AS CHAR) alt_uom_id, CAST(base_uom_id AS CHAR) base_uom_id, "
                     f"CAST(alt_qty AS CHAR) alt_qty, CAST(base_qty AS CHAR) base_qty FROM item_mji552rc_sub WHERE {c.TQ} AND is_deleted = 0 "
                     f"AND Item_id IN ({','.join(part)}) ORDER BY id"):
            if u["item"] in items:
                items[u["item"]]["table_uom_conversion"].append({k: u[k] for k in ("alt_uom_id", "base_uom_id", "alt_qty", "base_qty")})
        for b in L.q("SELECT CAST(Item_id AS CHAR) item, CAST(plant_id AS CHAR) plant_id, CAST(bin_location AS CHAR) bin_location, "
                     f"CAST(storage_location AS CHAR) storage_location FROM item_wu520fpw_sub WHERE {c.TQ} AND is_deleted = 0 "
                     f"AND Item_id IN ({','.join(part)}) ORDER BY id"):
            if b["item"] in items:
                items[b["item"]]["table_default_bin"].append({k: b[k] for k in ("plant_id", "bin_location", "storage_location")})
    return items


def read_uoms(c, ids):
    ids = sorted({str(i) for i in ids if i and str(i).isdigit()}, key=int)
    out = {}
    for part in L.chunks(ids, 500):
        for r in L.q(f"SELECT * FROM unit_of_measurement WHERE id IN ({','.join(part)}) AND is_deleted = 0"):
            row = L.api_row(r, "unit_of_measurement", keep_null=True)
            for k in ("create_dept", "create_user", "update_user", "id", "sub_tenant_id"):
                if row.get(k) is not None:
                    row[k] = str(row[k])
            out[str(r["id"])] = {k: row.get(k) for k in UOM_KEYS}
    return out


def plant_defaults(c):
    sl = L.q(f"SELECT CAST(id AS CHAR) id FROM storage_location WHERE {c.TQ} AND plant_id = {c.plant} AND is_deleted = 0 AND is_default = 1 "
             "AND storage_status = 1 AND location_type = 'Common' ORDER BY id LIMIT 1")
    if not sl:
        return "", ""
    b = L.q(f"SELECT CAST(id AS CHAR) id FROM bin_location WHERE {c.TQ} AND plant_id = {c.plant} AND storage_location_id = {sl[0]['id']} AND is_deleted = 0 "
            "AND is_default = 1 AND bin_status = 1 ORDER BY id LIMIT 1")
    return sl[0]["id"], (b[0]["id"] if b else "")


def bin_rows(c, ids):
    out = {}
    for part in L.chunks(sorted({str(i) for i in ids if i}, key=int), 500):
        for r in L.q(f"SELECT CAST(id AS CHAR) id, bin_location_combine n, CAST(storage_location_id AS CHAR) sl, bin_status st, is_deleted del, CAST(plant_id AS CHAR) plant "
                     f"FROM bin_location WHERE {c.TQ} AND id IN ({','.join(part)})"):
            out[r["id"]] = r
    return out


def form_html_defaults():
    f = L.read_json(os.path.join(L.IDAV2, "base", "ida_form_v35.json"))
    out = {}

    def walk(items):
        for w in items or []:
            if isinstance(w, dict):
                if w.get("model") in ("draft_status", "issued_status", "completed_status", "fullyposted_status"):
                    out[w["model"]] = (w.get("options") or {}).get("defaultValue")
                for k in ("list", "columns", "tableColumns", "rows", "tabs", "items", "children"):
                    v = w.get(k)
                    if isinstance(v, list):
                        for x in v:
                            walk([x] if isinstance(x, dict) else x if isinstance(x, list) else [])
    walk(f["list"])
    return out


def v36_fields():
    """after package D's form publish (the columns exist): the form's hidden ida_v2_job_id / ida_idem_key inputs and the processing_status
    badge join getValues() (D's built form: badge after fullyposted_status, the inputs after page_status); None before it"""
    if "ida_v2_job_id" not in L.col_types("sm_item_disassembly"):
        return None
    badge = ""
    built = os.path.join(L.REPO, "Item Disassembly", "AsyncV2", "IDAform.json")
    if os.path.exists(built):
        def walk(items):
            for w in items or []:
                if isinstance(w, dict):
                    if w.get("model") == "processing_status":
                        return (w.get("options") or {}).get("defaultValue") or ""
                    for k in ("list", "columns", "tableColumns", "rows", "tabs", "items", "children"):
                        v = w.get(k)
                        if isinstance(v, list):
                            x = walk([y for y in v if isinstance(y, dict)])
                            if x is not None:
                                return x
            return None
        badge = walk(L.read_json(built)["list"]) or ""
    return {"processing_status": badge}


def with_v36(h, keep_job=None):
    """insert the v36 keys at their form positions (no-op before the form publish)"""
    extra = v36_fields()
    if extra is None:
        return h
    out = {}
    for k, v in h.items():
        if k in ("processing_status", "ida_v2_job_id", "ida_idem_key"):
            continue
        out[k] = v
        if k == "fullyposted_status":
            out["processing_status"] = h.get("processing_status", extra["processing_status"])
        if k == "page_status":
            out["ida_v2_job_id"] = h.get("ida_v2_job_id", "") if keep_job is None else keep_job[0]
            out["ida_idem_key"] = h.get("ida_idem_key", "") if keep_job is None else keep_job[1]
    return out


def uom_options(ids, uoms):
    rows, seen = [], set()
    for i in ids:
        if i and i not in seen:
            seen.add(i)
            if i in uoms:
                rows.append(uoms[i])
    return json.dumps(rows, ensure_ascii=False, separators=(",", ":"))


def default_bin(item, plant):
    for b in (item or {}).get("table_default_bin") or []:
        if b.get("plant_id") == plant and b.get("bin_location"):
            return b["bin_location"], b.get("storage_location") or ""
    return None, None


# --------------------------------------------------------------------------------------------- the source pick
def source_pick(c, item, qty, balance_id=None):
    """inspectSourceStock (ida_src_item) for exactly one positive loose balance; the Select Stock dialog's row otherwise"""
    loose = item.get("item_batch_management") != 1
    table = "item_balance" if loose else "item_batch_balance"
    rows = L.q(f"SELECT * FROM {table} WHERE {c.TQ} AND is_deleted = 0 AND material_id = {item['id']} AND plant_id = {c.plant} "
               f"AND organization_id = '{c.org}' ORDER BY id")
    pos = [r for r in rows if D(r.get("unrestricted_qty")) > 0]
    hu = L.q(f"SELECT COUNT(*) n FROM handling_unit_atu7sreg_sub WHERE {c.TQ} AND is_deleted = 0 AND material_id = {item['id']}")[0]["n"]
    if int(hu):
        c.fail(f"source {item['material_code']}: {hu} HU rows (an HU pick is NOT_ELIGIBLE; the form opens Select Stock)")
    if not pos:
        raise SystemExit(f"source {item['material_code']} has no positive balance at plant {c.plant}")
    mode = "single" if len(pos) == 1 and not int(hu) else "multiple"
    bal = next((r for r in pos if str(r["id"]) == str(balance_id)), None) if balance_id else (pos[0] if mode == "single" else None)
    if not bal:
        raise SystemExit(f"source {item['material_code']}: {len(pos)} positive balances - name one with source_balance ({[str(r['id']) for r in pos]})")
    avail = D(bal["unrestricted_qty"])
    if mode == "single":
        pick = {"material_id": item["id"], "location_id": str(bal["location_id"]), "storage_location_id": None, "batch_id": str(bal["batch_id"]) if bal.get("batch_id") else None,
                "serial_number": "", "balance_id": str(bal["id"]), "sm_quantity": L.jsf(float(qty)), "category": "Unrestricted", "plant_id": c.plant, "organization_id": c.org,
                "is_deleted": 0, "expired_date": None, "manufacturing_date": None, "unrestricted_qty": L.jsnum(bal["unrestricted_qty"]),
                "balance_quantity": L.jsnum(bal["balance_quantity"] or 0)}
        if not loose:
            pick["expired_date"] = L.api_value(bal.get("expired_date"), "datetime")
            pick["manufacturing_date"] = L.api_value(bal.get("manufacturing_date"), "datetime")
    else:
        row = L.ordered(L.api_row(bal, table), BAL_ORDER)
        bid = row.pop("id")
        row["balance_id"] = str(bid)
        row["category"] = row.get("category") or "Unrestricted"
        if loose:
            row["unit_price"] = None if item.get("purchase_unit_price") is None else L.jsnum(item["purchase_unit_price"])
        else:
            row["manufacturing_date"] = row.pop("dialog_manufacturing_date", row.get("manufacturing_date"))
            row["expired_date"] = row.pop("dialog_expired_date", row.get("expired_date"))
        row["fm_key"] = L.fm_key("pick" + str(bid) + str(qty))
        row["sm_quantity"] = L.jsf(float(qty))
        pick = row
    return pick, mode, avail, bal


def summary_of(pick, qty, uom_name, bin_name, batch_name=""):
    """inspectSourceStock / onConfirm_Stock formatLooseDetails: one loose pick"""
    det = f"1. {bin_name}: {L.js_text(L.jsf(float(qty)))} {uom_name} (UNR)"
    if batch_name:
        det += f"\n[Batch: {batch_name}]" if "serial_number" in pick else f"\n[{batch_name}]"
    return f"Total: {L.js_text(L.jsf(float(qty)))} {uom_name}\n\nDETAILS:\n{det}"


# --------------------------------------------------------------------------------------------- rows
def explode_rows(c, source, qty, uoms, items, plant_sl, plant_bin):
    """ida_src_item: the source's BOM (default first, else the highest V-number), components without REF, in BOM line order"""
    boms = L.q(f"SELECT CAST(id AS CHAR) id, CAST(parent_mat_base_quantity AS CHAR) base, parent_mat_bom_version v, parent_mat_is_default d FROM bill_of_materials "
               f"WHERE {c.TQ} AND is_deleted = 0 AND is_active = 1 AND organization_id = '{c.org}' AND parent_material_code = '{L.digits(source['id'], 'source')}'")
    if not boms:
        raise SystemExit(f"no active BOM for {source['material_code']}")

    def vnum(b):
        t = str(b.get("v") or "").strip()
        return int(t[1:]) if len(t) > 1 and t[0] in "Vv" and t[1:].isdigit() else 0
    boms.sort(key=lambda b: (-(1 if str(b["d"]) == "1" else 0), -vnum(b)))
    if len(boms) > 1:
        c.warn(f"{len(boms)} active BOMs for {source['material_code']}: the explode takes {boms[0]['id']} (default first, then the highest V)")
    bom = boms[0]
    base = float(bom["base"] or 0)
    if base <= 0:
        raise SystemExit("the BOM has no valid base quantity")
    subs = L.q("SELECT CAST(id AS CHAR) id, bom_material_code code, sub_material_name name, sub_material_desc descr, CAST(sub_material_qty AS CHAR) qty, "
               f"CAST(sub_material_qty_uom AS CHAR) uom, sub_material_remark remark, consume_type FROM bill_of_materials_ttux02kq_sub WHERE {c.TQ} "
               f"AND bill_of_materials_id = {bom['id']} AND is_deleted = 0 ORDER BY id")
    subs = [s for s in subs if s["code"] and s["consume_type"] != "REF"]
    items.update(read_items(c, [s["code"] for s in subs if s["code"] not in items]))
    need_u = {s["uom"] for s in subs}
    for s in subs:
        it = items.get(s["code"]) or {}
        need_u |= {it.get("based_uom")} | {u["alt_uom_id"] for u in it.get("table_uom_conversion") or []}
    uoms.update(read_uoms(c, need_u - set(uoms)))
    rows = []
    for i, s in enumerate(subs):
        it = items.get(s["code"]) or {}
        ratio = L.q8(float(s["qty"] or 0) / base)
        total = L.q8(float(qty) * ratio)
        ib, isl = default_bin(it, c.plant)
        ids = [s["uom"], it.get("based_uom")] + [u["alt_uom_id"] for u in it.get("table_uom_conversion") or []]
        batch = "-" if str(it.get("item_batch_management")) != "1" else (L.PLACEHOLDER if it.get("batch_number_genaration") == L.AUTO_RULE else "")
        rows.append({"item_selection": s["code"], "item_name": s["name"] or it.get("material_name") or "", "item_desc": s["descr"] or it.get("material_desc") or "",
                     "requested_qty": L.jsf(total), "bom_ratio": L.jsf(ratio), "total_quantity": L.jsf(total), "quantity_uom": s["uom"] or it.get("based_uom") or "",
                     "storage_location_id": (isl or plant_sl) if ib else plant_sl, "location_id": ib or plant_bin, "batch_number": batch, "manufacturing_date": "",
                     "expired_date": "", "item_remark": s["remark"] or "", "item_remark_2": "", "item_remark_3": "", "project_id": "", "organization_id": c.org,
                     "issuing_plant": c.plant, "line_index": i + 1, "uom_options": uom_options(ids, uoms)})
    return bom, rows


def batch_add_row(c, it, line_index, uoms, plant_sl, plant_bin):
    """onConfirm_batchAddItem (iabcnf01): item default bin else the plant default, base UOM, '-' / placeholder / '' batch"""
    ib, isl = default_bin(it, c.plant)
    ids = [it.get("based_uom")] + [u["alt_uom_id"] for u in it.get("table_uom_conversion") or []]
    batch = "-"
    if str(it.get("item_batch_management")) == "1":
        batch = L.PLACEHOLDER if it.get("batch_number_genaration") == L.AUTO_RULE else ""
    return {"item_selection": it["id"], "item_name": it.get("material_name") or "", "item_desc": it.get("material_desc") or "", "requested_qty": 0, "bom_ratio": None,
            "quantity_uom": it.get("based_uom") or "", "uom_options": uom_options(ids, uoms), "storage_location_id": (isl or plant_sl) if ib else plant_sl,
            "location_id": ib or plant_bin, "batch_number": batch, "manufacturing_date": "", "expired_date": "", "item_remark": "", "item_remark_2": "", "item_remark_3": "",
            "project_id": "", "organization_id": c.org, "issuing_plant": c.plant, "line_index": line_index}


def header_add(c, source, qty, number, pick, mode, summary, sl, bin_, remarks=("", "", "")):
    """getValues() of the Add form after the source pick and the lines (recorded Add order); stock_movement goes in place"""
    html = form_html_defaults()
    h = {"isTrusted": True, "_vts": int(__import__("time").time() * 1000)}
    h.update({k: html[k] for k in ("draft_status", "issued_status", "completed_status", "fullyposted_status")})
    num = c.tc["number"]
    h.update({"flex_2det1nd2": "", "organization_id": c.org, "sid_uuid": "", "item_disassembly_status": "", "posted_status": "", "page_status": "Add",
              "issuing_operation_faci": c.plant, "stock_movement_no": number if num["type"] == L.MANUAL else "",
              "stock_movement_no_type": L.MANUAL if num["type"] == L.MANUAL else L.digits(num["type"], "number rule"), "item_id": source["id"],
              "item_disassembly_date": L.utc_date(), "issued_by": c.tc.get("nickname", "admin"), "item_code": source.get("material_code") or "",
              "item_name": source.get("material_name") or "", "item_desc": source.get("material_desc") or "", "item_qty": L.jsf(float(qty)),
              "item_uom": source.get("based_uom") or "", "stock_summary": summary, "temp_qty_data": json.dumps([pick], ensure_ascii=False, separators=(",", ":")),
              "temp_hu_data": "" if mode == "single" else "[]", "project_id": "", "remarks": remarks[0], "remarks_2": remarks[1], "remarks_3": remarks[2],
              "reference_documents": "",
              "item_display_table": [{"item_selection": source["id"], "item_code": source.get("material_code") or "", "item_name": source.get("material_name") or "",
                                      "item_desc": source.get("material_desc") or "", "item_qty": L.jsf(float(qty)), "item_uom": source.get("based_uom") or "",
                                      "stock_summary": summary, "fm_key": L.fm_key("disp" + source["id"])}],
              "stock_movement": [], "button_draft": "", "button_completed": "", "flex_t6y2yh5r": "", "$_v": 56, "ida_source_stock_mode": mode,
              "storage_location_id": sl, "location_id": bin_})
    return with_v36(h)


def finish_lines(c, rows, seed):
    """the table's fm_key on every row; a Batch Add row gets its typed total_quantity after it"""
    out = []
    for r in rows:
        r = dict(r)
        typed_qty = r.pop("_typed_qty", None)
        r["fm_key"] = L.fm_key(seed + c.T + str(r["item_selection"]) + str(r["line_index"]))
        if typed_qty is not None:
            r["total_quantity"] = L.jsf(float(typed_qty))
        out.append(r)
    return out


def requests_of(c, all_data, page, ida_id="", gen=1, token=None):
    """the classic IDA_SAVE requests and the V2 SUBMIT / STATUS requests for one form state"""
    classic = {"allData": all_data, "saveAs": "Completed", "pageStatus": all_data.get("page_status") or page}
    draft = {"allData": all_data, "saveAs": "Draft", "pageStatus": all_data.get("page_status") or page}
    record = L.record_of(all_data)
    is_new = page in ("Add", "Clone", "Copy")
    token = token or L.page_token(c.T)
    doc = ("new-" + token) if is_new else L.digits(ida_id, "ida_id")
    key = L.ida_key(c.org, doc, page, record, gen)
    submit = {"operation": "SUBMIT", "saveAs": "Completed", "pageStatus": page, "ida_id": "" if is_new else str(ida_id), "idempotency_key": key,
              "source": "FORM", "form": record}
    status = {"operation": "STATUS", "saveAs": "Completed", "pageStatus": "Edit", "ida_id": "0" if is_new else str(ida_id), "idempotency_key": key,
              "source": "FORM", "form": {}}
    return classic, draft, submit, status


# --------------------------------------------------------------------------------------------- checks + plan
def number_free(c, number):
    if not number:
        return
    n = number.replace("'", "''")
    used = L.q(f"SELECT CAST(id AS CHAR) id FROM sm_item_disassembly WHERE {c.TQ} AND stock_movement_no = '{n}' LIMIT 3")
    mv = L.q(f"SELECT COUNT(*) n FROM inventory_movement WHERE {c.TQ} AND trx_no = '{n}'")[0]["n"]
    if used or int(mv):
        c.fail(f"number {number} already used ({len(used)} IDA, {mv} movements): the classic's issued value reads trx_no only")


def costing_screen(c, keys):
    """CONTRACT section 7 'costing migration' (IA's FIFO+WA rule) on (material, batch or 0) at the plant + organization"""
    mats = sorted({k[0] for k in keys}, key=int)
    f, w = {}, {}
    for part in L.chunks(mats, 500):
        ids = ",".join(part)
        for r in L.q("SELECT CAST(material_id AS CHAR) m, CAST(COALESCE(batch_id, 0) AS CHAR) b, COUNT(*) n FROM fifo_costing_history "
                     f"WHERE {c.TQ} AND is_deleted = 0 AND plant_id = {c.plant} AND organization_id = '{c.org}' AND material_id IN ({ids}) GROUP BY 1, 2"):
            f[(r["m"], r["b"])] = int(r["n"])
        for r in L.q("SELECT CAST(material_id AS CHAR) m, CAST(COALESCE(batch_id, 0) AS CHAR) b, COUNT(*) n FROM wa_costing_method "
                     f"WHERE {c.TQ} AND is_deleted = 0 AND plant_id = '{c.plant}' AND organization_id = '{c.org}' AND material_id IN ({ids}) GROUP BY 1, 2"):
            w[(r["m"], r["b"])] = int(r["n"])
    return f, w


def dup_balances(c, keys):
    """more than one item_balance row per (material, location) at the plant + org (CONTRACT section 7 DUP)"""
    mats = sorted({k[0] for k in keys}, key=int)
    out = set()
    for part in L.chunks(mats, 500):
        for r in L.q(f"SELECT CAST(material_id AS CHAR) m, CAST(location_id AS CHAR) l, COUNT(*) n FROM item_balance WHERE {c.TQ} AND is_deleted = 0 "
                     f"AND plant_id = {c.plant} AND organization_id = '{c.org}' AND material_id IN ({','.join(part)}) GROUP BY 1, 2 HAVING n > 1"):
            out.add((r["m"], r["l"]))
    return {k for k in keys if (k[0], k[1]) in out}


def held_locks(c, mats):
    held = []
    for part in L.chunks(sorted(mats, key=int), 400):
        held += L.q(f"SELECT lock_key, owner_operation_id FROM inventory_balance_lock WHERE {c.TQ} AND organization_id = '{c.org}' AND is_deleted = 0 "
                    "AND (free_token IS NULL OR free_token <> 1) AND SUBSTRING_INDEX(SUBSTRING_INDEX(lock_key, '|', 2), '|', -1) IN ("
                    + ",".join("'" + m + "'" for m in part) + ")")
    return held


def holders(c, numbers):
    """live org Batch rows holding one of the numbers, compared as the SQL collation does (case-insensitive, trailing spaces ignored)"""
    nums = sorted({n for n in numbers if n and n.strip()})
    if not nums:
        return []
    lits = ",".join("'" + n.replace("'", "''").replace("\\", "\\\\") + "'" for n in nums)
    return L.q(f"SELECT CAST(id AS CHAR) id, batch_number, CAST(material_id AS CHAR) m, transaction_no FROM batch WHERE {c.TQ} AND is_deleted = 0 "
               f"AND organization_id = '{c.org}' AND batch_number IN ({lits})")


def fifo_price(c, mat, batch, qty):
    """the engine's fifoUnitPrice over today's layers of (material, plant, org, batch)"""
    w = f"batch_id = {L.digits(batch, 'batch')}" if batch else "batch_id IS NULL"
    lay = L.q("SELECT fifo_sequence s, CAST(fifo_available_quantity AS CHAR) a, CAST(fifo_cost_price AS CHAR) p FROM fifo_costing_history WHERE "
              f"{c.TQ} AND is_deleted = 0 AND plant_id = {c.plant} AND organization_id = '{c.org}' AND material_id = {mat} AND {w}")
    lay.sort(key=lambda r: int(str(r["s"] or 0)))
    if not lay:
        return Decimal(0), []
    need, cost, tq, used = D(qty), Decimal(0), Decimal(0), []
    for r in lay:
        if need <= 0:
            break
        a = D(r["a"])
        if a <= 0:
            continue
        t = min(a, need)
        cost += t * D(r["p"])
        tq += t
        need -= t
        used.append(dstr(D(r["p"])))
    if need > 0:
        cost += need * D(lay[-1]["p"])
        tq += need
        used.append("SHORT@" + dstr(D(lay[-1]["p"])))
    return (cost / tq if tq > 0 else Decimal(0)), used


def build_plan(c, all_data, items, tag, runs=1, v2=True, page="Add"):
    """the designed moves + every check the kit can make before a run (CONTRACT section 7 gates / eligibility as data checks)"""
    lines = [dict(l) for l in all_data.get("stock_movement") or []]
    for i, l in enumerate(lines):
        l["line_index"] = l.get("line_index") or i + 1
    hdr = {k: all_data.get(k) for k in ("issuing_operation_faci", "organization_id", "stock_movement_no", "item_disassembly_date", "item_id", "item_uom", "temp_qty_data")}
    hdr["stock_movement_no"] = hdr.get("stock_movement_no") or "<number>"
    built = L.node("const M = require('./ida_moves.js'); const p = JSON.parse(require('fs').readFileSync(0, 'utf8'));"
                   "console.log(JSON.stringify(M.idaEngineMoves(p.h, p.l, p.i, { jobId: 'PLAN' })));", {"h": hdr, "l": lines, "i": items})
    cn = built["counts"]
    for b in built["bad"]:
        c.fail("builder: " + b)
    src = items.get(str(all_data.get("item_id"))) or {}
    picks = json.loads(all_data.get("temp_qty_data") or "[]")
    picks = [p for p in picks if float(p.get("sm_quantity") or 0) > 0]
    # code_validate (the classic 401 texts) as data checks
    total = sum(D(p["sm_quantity"]) for p in picks)
    if abs(total - D(all_data.get("item_qty"))) > Decimal("0.00000001"):
        c.fail(f"allocated {total} != item_qty {all_data.get('item_qty')} (code_validate 401)")
    for i, l in enumerate(lines):
        it = items.get(str(l.get("item_selection"))) or {}
        lab = f"Line {i + 1} ({l.get('item_name') or l.get('item_selection')})"
        if not (float(l.get("total_quantity") or 0) > 0) or not l.get("quantity_uom") or not l.get("storage_location_id") or not l.get("location_id"):
            c.fail(lab + ": quantity / UOM / storage / bin missing (code_validate 401)")
        if str(it.get("item_batch_management")) == "1" and it.get("batch_number_genaration") != L.AUTO_RULE:
            b = str(l.get("batch_number") or "").strip()
            if b in ("", "-", L.PLACEHOLDER):
                c.fail(lab + ": Batch number is required (code_validate 401)")
    # picks vs today's available (x runs for twins); never the excluded item at its bin
    avail = {}
    for p in picks:
        k = (str(p.get("balance_id")), str(p.get("location_id")), str(p.get("batch_id") or ""))
        avail.setdefault(k, Decimal(0))
        avail[k] += D(p["sm_quantity"])
        if str(all_data.get("item_id")) == L.EXCLUDED["material"] and str(p.get("location_id")) == L.EXCLUDED["bin"]:
            c.fail("picks the EXCLUDED item 'blade, loose' at bin A1-01 (-41's GD test stock)")
    for (bid, loc, bat), use in avail.items():
        t = "item_batch_balance" if bat else "item_balance"
        r = L.q(f"SELECT CAST(unrestricted_qty AS CHAR) u, CAST(block_qty AS CHAR) b FROM {t} WHERE {c.TQ} AND id = {L.digits(bid, 'balance_id')} AND is_deleted = 0")
        have = D(r[0]["u"]) if r else Decimal(0)
        if use * runs > have:
            c.fail(f"pick of balance {bid}: {use} x {runs} run(s) > today's unrestricted {have}")
    # eligibility (CONTRACT section 7), as a V2 subject must pass it
    reasons = []
    if not src:
        reasons.append(f"item {all_data.get('item_id')} not found")
    if any(p.get("handling_unit_id") for p in picks) or (all_data.get("temp_hu_data") or "") not in ("", "[]") or all_data.get("table_hu"):
        reasons.append("handling units")
    if str(src.get("serial_number_management")) == "1":
        reasons.append("serial-numbered source item")
    if str(src.get("stock_control")) == "0":
        reasons.append("source item not stock controlled")
    order = built["order"]
    stock_lines = [l for l in order if str((items.get(str(l["item_selection"])) or {}).get("stock_control")) != "0"]
    for l in [all_data] + order:
        it = items.get(str(l.get("item_selection") or l.get("item_id"))) or {}
        if it and it.get("stock_control") is None:
            reasons.append(f"item {it.get('material_code')} has no stock control setting")
    for p in picks:
        if (p.get("category") or "Unrestricted") not in OK_CATEGORIES:
            reasons.append(f"{p.get('category')} stock")
    keys = {(str(all_data["item_id"]), str(p.get("batch_id") or "0")) for p in picks} | {(str(l["item_selection"]), "0") for l in stock_lines}
    f, w = costing_screen(c, keys)
    meth = {i: it.get("material_costing_method") for i, it in items.items()}
    flagged = [(m, b, f.get((m, b), 0), w.get((m, b), 0)) for (m, b) in sorted(keys)
               if (f.get((m, b), 0) and w.get((m, b), 0)) or (meth.get(m) == L.FIFO and not f.get((m, b), 0) and w.get((m, b), 0))
               or (meth.get(m) == L.WA and not w.get((m, b), 0) and f.get((m, b), 0))]
    if flagged:
        reasons.append("costing migration")
        c.warn(f"costing screen flags {flagged[:3]}")
    dups = dup_balances(c, {(str(all_data["item_id"]), str(p["location_id"])) for p in picks} | {(str(l["item_selection"]), str(l["location_id"])) for l in stock_lines})
    if dups:
        reasons.append("duplicate balance rows")
        c.warn(f"duplicate item_balance keys {sorted(dups)[:3]}")
    if not stock_lines:
        reasons.append("no stock to receive")
    if src.get("material_costing_method") == L.WA:
        for p in picks:
            if not w.get((str(all_data["item_id"]), str(p.get("batch_id") or "0"))):
                c.fail("WA source pick without a wa_costing_method row (SUBMIT STOP IDA_NO_WA_RECORD)")
    reasons = sorted(set(reasons))
    if v2 and reasons:
        c.fail("ineligible for V2: " + "; ".join(reasons))
    # batch numbers: TYPED free in the org (code_validate exact, the F4 check case-insensitive); AUTO = batchnum over today's config
    typed = [r for r in built["batch"]["rows"] if r["kind"] == "TYPED"]
    taken = holders(c, [r["batch_number"].strip() for r in typed])
    if taken:
        c.fail(f"typed number(s) already held by live org Batch rows (SUBMIT STOP IDA_INVALID typedExists): {[(t['batch_number'], t['transaction_no']) for t in taken][:3]}")
    autos = [r for r in built["batch"]["rows"] if r["kind"] == "AUTO"]
    auto_numbers = {"numbers": [], "configs": []}
    if autos:
        cfgs = L.q("SELECT JSON_OBJECT('id', CAST(c.id AS CHAR), 'batch_level_selection', c.batch_level_selection, 'item_id', CAST(c.item_id AS CHAR), "
                   "'item_category_id', CAST(c.item_category_id AS CHAR), 'item_group_id', CAST(c.item_group_id AS CHAR), 'batch_format', c.batch_format, "
                   "'running_number', c.running_number, 'reset_frequency', c.reset_frequency, 'initial_value', c.initial_value, 'last_reset_date', c.last_reset_date, "
                   "'date_format', c.date_format, 'format_preview', c.format_preview, 'organization_id', c.organization_id) AS j FROM batch_number_config c "
                   f"WHERE c.{c.TQ} AND c.organization_id = '{c.org}' AND c.is_deleted = 0 ORDER BY c.id")
        auto_numbers = L.batchnum(cfgs, built["batch"]["items"], [r["request"] for r in autos], int(__import__("time").time() * 1000))
        if auto_numbers.get("error"):
            c.fail(f"batchnum dry run refuses (SUBMIT STOP IDA_BATCH_CONFIG): {auto_numbers['error']}")
        else:
            held = holders(c, auto_numbers["numbers"])
            if held:
                c.fail(f"generated number(s) already held (D1 FAILED IDA_BATCH_DUPLICATE): {[h['batch_number'] for h in held][:3]}")
    # expected moves and prices (the classic and V2 move the same stock; V2 prices per base unit)
    issued, layers = Decimal(0), []
    out_rows = []
    for p in picks:
        qty = D(p["sm_quantity"])
        base = D(str(L.uom_of([[src, float(qty), all_data.get("item_uom")]])[0]["baseQty"]))
        if src.get("material_costing_method") == L.FIFO:
            up, layers = fifo_price(c, src["id"], p.get("batch_id"), base * runs)
        elif src.get("material_costing_method") == L.WA:
            wr = L.q(f"SELECT CAST(wa_cost_price AS CHAR) p FROM wa_costing_method WHERE {c.TQ} AND is_deleted = 0 AND plant_id = '{c.plant}' AND organization_id = '{c.org}' "
                     f"AND material_id = {src['id']} AND " + (f"batch_id = {p['batch_id']}" if p.get("batch_id") else "batch_id IS NULL") + " ORDER BY created_at DESC LIMIT 1")
            up = D(wr[0]["p"]) if wr else Decimal(0)
        elif src.get("material_costing_method") == L.FIXED:
            up = D(src.get("purchase_unit_price"))
        else:
            up = Decimal(0)
        issued += D(str(L.q8(float(up * base))))
        out_rows.append({"material_id": src["id"], "bin": p["location_id"], "batch_id": p.get("batch_id"), "category": p.get("category") or "Unrestricted",
                         "qty": dstr(qty), "base_qty": dstr(base), "unit_price_preview": str(L.q8(float(up)))})
    prices = L.allocate(float(issued), built["alloc"])
    in_rows = []
    for a, pr in zip(built["alloc"], prices):
        it = items.get(a["item_id"]) or {}
        if not a["movement_key"]:
            continue
        l = next(x for x in order if str(x.get("id") or "") == a["line_id"] and str(x["line_index"]) == a["line_index"]) if a["line_id"] else \
            next(x for x in order if str(x["line_index"]) == a["line_index"])
        up = D(it.get("purchase_unit_price")) if it.get("material_costing_method") == L.FIXED else D(str(pr["unit_price"]))
        in_rows.append({"key": a["movement_key"], "line_index": a["line_index"], "material_id": a["item_id"], "code": it.get("material_code"), "bin": str(l["location_id"]),
                        "uom": str(l.get("quantity_uom") or ""), "qty": a["share_qty"], "base_qty": a["base_qty"], "batch_key": a["batch_key"],
                        "method": it.get("material_costing_method"), "value": pr["value"], "unit_price": str(L.q8(float(up))),
                        "unit_price_v6": str(L.q8(pr["value"] / a["share_qty"])) if a["share_qty"] else "0"})
    held = held_locks(c, {src.get("id")} | {str(l["item_selection"]) for l in stock_lines} - {None})
    if held:
        c.warn(f"{len(held)} engine lock rows held now on these items (a V2 run waits / fails IDA_INVENTORY_LOCK_BUSY): {[h['lock_key'] for h in held[:3]]}")
    rows_out = []
    an = iter(auto_numbers.get("numbers") or [])
    for r in built["batch"]["rows"]:
        rows_out.append({"key": r["key"], "kind": r["kind"], "insert": r["insert"], "material_id": r["material_id"], "code": (items.get(r["material_id"]) or {}).get("material_code"),
                         "batch_number": r["batch_number"] if r["kind"] == "TYPED" else next(an, ""), "initial_quantity": r["initial_quantity"], "lines": len(r["line_ids"])})
    plan = {"tag": tag, "tenant": c.T, "org": c.org, "plant": c.plant, "page": page, "number": all_data.get("stock_movement_no"),
            "number_type": all_data.get("stock_movement_no_type"), "source": {"id": src.get("id"), "code": src.get("material_code"),
            "method": src.get("material_costing_method"), "qty": all_data.get("item_qty"), "uom": all_data.get("item_uom"), "mode": all_data.get("ida_source_stock_mode")},
            "counts": cn, "runs": runs, "moves_route": ("V2 from the client (> 50)" if cn["moves"] > 50 else "classic from the client (<= 50)")
            + ("; the classic v7 refuses it (> 250)" if cn["moves"] > 250 else ""), "eligibility": reasons or ["eligible"],
            "out_rows": out_rows, "issued_value_preview": dstr(issued), "fifo_layers_used": layers, "in_rows": in_rows, "batch_rows": rows_out,
            "auto_configs": auto_numbers.get("configs"), "warnings": c.warnings, "problems": c.problems}
    return plan, built


def write_out(c, tag, all_data, items, page="Add", ida_id="", runs=1, v2=True, extra=None):
    out = L.out_dir(tag)
    classic, draft, submit, status = requests_of(c, all_data, page, ida_id, int(L.arg("--gen", "1")))
    plan, built = build_plan(c, all_data, items, tag, runs=runs, v2=v2, page=page)
    plan["key"] = submit["idempotency_key"]
    files = [("classic", classic), ("draft", draft), ("submit", submit), ("status", status)] + (extra or [])
    for name, obj in files + [("plan", plan)]:
        L.write_json(os.path.join(out, name + ".json"), obj, indent=None if name != "plan" else 1)
    cn = plan["counts"]
    print(f"{tag}: tenant {c.T} source {plan['source']['code']} x {all_data['item_qty']} ({plan['source']['mode']}) - {cn['lines']} lines "
          f"({cn['movementsR']} stock, {cn['nonStockLines']} non-stock), {cn['picks']} pick(s), {cn['moves']} moves -> {plan['moves_route']}; "
          f"batch rows {cn['batchRows']} (AUTO {cn['autoRows']}, TYPED {cn['typedRows']}); eligibility {plan['eligibility']}")
    print(f"   number {plan['number'] or '(issued by rule ' + str(plan['number_type']) + ')'}; issued value preview {plan['issued_value_preview']}; "
          f"AUTO numbers {[r['batch_number'] for r in plan['batch_rows'] if r['kind'] == 'AUTO'][:6]}")
    print(f"   requests: classic {len(json.dumps(classic)) / 1e6:.2f} MB, submit {len(json.dumps(submit)) / 1e6:.2f} MB; key {submit['idempotency_key']}")
    for w in c.warnings[:8]:
        print("   WARN", w)
    tag_ = "EXPECTED" if L.flag("--any") else "FAIL"
    for p in c.problems:
        print(f"   {tag_}", p)
    print(f"   -> {out}/{{{','.join(n for n, _ in files)},plan}}.json" + ("" if not c.problems else f"   ({len(c.problems)} CHECK(S) " + (
        "failed - expected: --any builds a refusal test" if L.flag("--any") else "FAILED") + ")"))
    return 1 if c.problems and not L.flag("--any") else 0


# --------------------------------------------------------------------------------------------- subjects
def receipt_bin_check(c):
    r = c.tc.get("receipt") or {}
    b = bin_rows(c, [r.get("bin")]).get(str(r.get("bin")))
    if not b or str(b["st"]) != "1" or str(b["del"]) != "0" or b["plant"] != c.plant:
        c.fail(f"receipt bin {r.get('bin')} is not an active bin of plant {c.plant}")
        return
    mv = L.q(f"SELECT transaction_type t, COUNT(*) n FROM inventory_movement WHERE {c.TQ} AND id > {L.id_ago(7 * 86400)} AND bin_location_id = {r['bin']} GROUP BY 1")
    foreign = [(m["t"], m["n"]) for m in mv if m["t"] != "IDA"]
    if foreign:
        c.warn(f"receipt bin {b['n']}: movements of other kinds in the last 7 days {foreign} - another session may use it")


def manual_number(c, sub, tag, suffix=""):
    if c.tc["number"]["type"] != L.MANUAL:
        return ""
    n = L.arg("--number") or f"{c.tc['number'].get('prefix', 'IDV2')}-{sub.get('number', tag).upper()}-{L.stamp()}{suffix}"
    number_free(c, n)
    return n


def to_receipt(c, rows, which="receipt"):
    r = c.tc.get(which) or {}
    for row in rows:
        row["storage_location_id"], row["location_id"] = r["storage"], r["bin"]


def subject_bom(c, sub, tag):
    """a / b: the source's BOM exploded; 711077: every receipt into the kit's receipt bin"""
    receipt_bin_check(c)
    bom_id = L.arg("--bom") or sub.get("bom")
    if bom_id:
        b = L.q(f"SELECT CAST(parent_material_code AS CHAR) p FROM bill_of_materials WHERE {c.TQ} AND id = {L.digits(bom_id, 'bom')} AND is_deleted = 0")
        if not b:
            raise SystemExit(f"BOM {bom_id} not found")
        src_id = b[0]["p"]
    else:
        src_id = L.digits(sub["source"], "source")
    qty = float(L.arg("--qty") or sub.get("qty", 1))
    items = read_items(c, [src_id])
    source = items[src_id]
    uoms = read_uoms(c, {source.get("based_uom")})
    sl, bin_ = plant_defaults(c)
    bom, rows = explode_rows(c, source, qty, uoms, items, sl, bin_)
    if bom_id and str(bom["id"]) != str(bom_id):
        c.fail(f"the explode takes BOM {bom['id']}, not {bom_id}")
    excluded = [r for r in rows if r["item_selection"] == L.EXCLUDED["material"]]
    if excluded:
        c.warn("dropped the EXCLUDED item 'blade, loose' (as the user would delete the row)")
        rows = [r for r in rows if r["item_selection"] != L.EXCLUDED["material"]]
        for i, r in enumerate(rows):
            r["line_index"] = i + 1
    if sub.get("twin"):
        lo, hi = sub.get("min_lines", 55), sub.get("max_lines", 70)
        bad = [r for r in rows if (items.get(r["item_selection"]) or {}).get("material_costing_method") != L.FIFO or r["quantity_uom"] != (items.get(r["item_selection"]) or {}).get("based_uom")
               or str((items.get(r["item_selection"]) or {}).get("stock_control")) != "1"]
        if not lo <= len(rows) <= hi or bad:
            c.fail(f"twin BOM {bom['id']}: {len(rows)} lines ({lo}-{hi} wanted), {len(bad)} not FIFO / base UOM / stocked")
    if c.tc.get("receipt") and c.T == "711077":
        to_receipt(c, rows)
    pk, mode, avail, bal = source_pick(c, source, qty, sub.get("source_balance"))
    bins = bin_rows(c, [pk["location_id"]])
    summary = summary_of(pk, qty, (uoms.get(source.get("based_uom")) or {}).get("uom_name") or "", (bins.get(pk["location_id"]) or {}).get("n") or pk["location_id"])
    tsl, tbin = default_bin(source, c.plant)
    runs = 2 if sub.get("twin") else 1
    if sub.get("twin"):
        out = L.out_dir(tag)
        docs = []
        for side in ("A", "B"):
            number = manual_number(c, sub, tag, "-" + side)
            h = header_add(c, source, qty, number, pk, mode, summary, (tsl or sl) if tbin else sl, tbin or bin_, (f"IDA V2 twins {tag}", "", ""))
            h["stock_movement"] = finish_lines(c, copy.deepcopy(rows), tag)
            docs.append(h)
        rc = write_out(c, tag, docs[1], items, runs=runs)
        cl_a, dr_a, _, _ = requests_of(c, docs[0], "Add")
        L.write_json(os.path.join(out, "classic.json"), cl_a)
        L.write_json(os.path.join(out, "draft.json"), dr_a)
        print(f"   twins: A = classic.json ({docs[0]['stock_movement_no']}), B = submit.json ({docs[1]['stock_movement_no']}); availability checked for both")
        return rc
    number = manual_number(c, sub, tag)
    hdr = header_add(c, source, qty, number, pk, mode, summary, (tsl or sl) if tbin else sl, tbin or bin_, (f"IDA V2 live test {tag}", "", ""))
    hdr["stock_movement"] = finish_lines(c, rows, tag)
    return write_out(c, tag, hdr, items, runs=runs)


def quiet_items(c, n, exclude):
    """the org's quiet non-batch stock items: no movement in 30 days, no item_balance key twice, created before 2026-10-19 (no recent test's item)"""
    cands = L.q(f"SELECT CAST(i.id AS CHAR) id, i.material_costing_method m FROM item i WHERE i.{c.TQ} AND i.is_deleted = 0 AND i.organization_id = '{c.org}' "
                "AND i.stock_control = 1 AND i.serial_number_management = 0 AND i.item_batch_management = 0 "
                f"AND i.id < {L.id_at('2026-10-19 00:00:00')} ORDER BY (i.material_costing_method IS NULL), i.id")
    ids = [r["id"] for r in cands if r["id"] not in exclude]
    busy = set()
    for part in L.chunks(ids, 400):
        busy |= {r["m"] for r in L.q(f"SELECT DISTINCT CAST(item_id AS CHAR) m FROM inventory_movement WHERE {c.TQ} AND id > {L.id_ago(30 * 86400)} "
                                     f"AND item_id IN ({','.join(part)})")}
        busy |= {r["m"] for r in L.q(f"SELECT CAST(material_id AS CHAR) m FROM item_balance WHERE {c.TQ} AND is_deleted = 0 AND material_id IN ({','.join(part)}) "
                                     "GROUP BY material_id, location_id, plant_id, organization_id HAVING COUNT(*) > 1")}
    quiet = [i for i in ids if i not in busy]
    if len(quiet) < n:
        c.fail(f"only {len(quiet)} quiet non-batch items for {n} NONE lines")
    return quiet[:n]


def subject_manual(c, sub, tag):
    """c / r1: the source's BOM rows + Batch Add rows (typed numbers, AUTO, UOM, bins as the user edits them)"""
    qty = float(L.arg("--qty") or sub.get("qty", 1))
    src_id = L.digits(sub["source"], "source")
    manual = list(sub.get("manual") or [])
    cyc = sub.get("cycle") or {}
    manual += [{"item": cyc["items"][k % len(cyc["items"])], "qty": cyc.get("qty", 1)} for k in range(int(cyc.get("count", 0)))] if cyc else []
    quiet = sub.get("quiet") or {}
    q_ids = quiet_items(c, int(quiet.get("count", 0)), {src_id} | {m["item"] for m in manual}) if quiet.get("count") else []
    items = read_items(c, [src_id] + [m["item"] for m in manual] + q_ids)
    source = items[src_id]
    uoms = read_uoms(c, {u for it in items.values() for u in [it.get("based_uom")] + [x["alt_uom_id"] for x in it["table_uom_conversion"]]})
    sl, bin_ = plant_defaults(c)
    rows = []
    stamp = L.stamp()
    typed_of = {}
    if sub.get("bom_lines"):
        _, rows = explode_rows(c, source, qty, uoms, items, sl, bin_)
        if sub.get("drop_none"):
            rows = [r for r in rows if r["batch_number"] != "-"]
            for i, r in enumerate(rows):
                r["line_index"] = i + 1
        for r in rows:
            it = items.get(r["item_selection"]) or {}
            if r["batch_number"] == "" and str(it.get("item_batch_management")) == "1":
                r["batch_number"] = L.arg("--typed") or f"IDV2{tag.upper()}-{stamp}-L{r['line_index']}"
    second = c.tc.get("second_bin")
    for m in manual:
        it = items.get(m["item"])
        if not it:
            c.fail(f"item {m['item']} not found")
            continue
        r = batch_add_row(c, it, len(rows) + 1, uoms, sl, bin_)
        if m.get("uom"):
            if m["uom"] not in [u["alt_uom_id"] for u in it["table_uom_conversion"]]:
                c.fail(f"{it['material_code']}: UOM {m['uom']} has no conversion row")
            r["quantity_uom"] = m["uom"]
        if m.get("typed"):
            typed_of.setdefault(m["typed"], f"IDV2{tag.upper()}-{stamp}-{m['typed']}")
            r["batch_number"] = typed_of[m["typed"]]
        if m.get("bin") == "second" and second:
            r["location_id"] = second
        r["_typed_qty"] = m.get("qty", 1)
        rows.append(r)
    for k, iid in enumerate(q_ids + q_ids[:int(quiet.get("copies_to_second_bin", 0))]):
        r = batch_add_row(c, items[iid], len(rows) + 1, uoms, sl, bin_)
        if k >= len(q_ids) and second:
            r["location_id"] = second
        r["_typed_qty"] = quiet.get("qty", 1)
        rows.append(r)
    pk, mode, avail, bal = source_pick(c, source, qty, sub.get("source_balance"))
    bins = bin_rows(c, [pk["location_id"]])
    summary = summary_of(pk, qty, (uoms.get(source.get("based_uom")) or {}).get("uom_name") or "", (bins.get(pk["location_id"]) or {}).get("n") or pk["location_id"])
    tsl, tbin = default_bin(source, c.plant)
    number = manual_number(c, sub, tag)
    hdr = header_add(c, source, qty, number, pk, mode, summary, (tsl or sl) if tbin else sl, tbin or bin_, (f"IDA V2 live test {tag}", "", ""))
    hdr["stock_movement"] = finish_lines(c, rows, tag)
    return write_out(c, tag, hdr, items)


def subject_k2(c, sub, tag):
    """d: N manual lines over N distinct stock-controlled items (non-batch, FIFO, not serial, no held lock, no duplicate key at the receipt bin)"""
    receipt_bin_check(c)
    n = int(L.arg("--lines") or sub.get("lines", 2000))
    src_id = L.digits(sub["source"], "source")
    rb = c.tc["receipt"]["bin"]
    cands = L.q(f"SELECT CAST(i.id AS CHAR) id FROM item i WHERE i.{c.TQ} AND i.is_deleted = 0 AND i.organization_id = '{c.org}' AND i.stock_control = 1 "
                "AND i.serial_number_management = 0 AND i.item_batch_management = 0 AND i.material_costing_method = 'First In First Out' ORDER BY i.id")
    pool = [r["id"] for r in cands if r["id"] not in (L.EXCLUDED["material"], src_id)]
    held = {h["lock_key"].split("|")[1] for h in held_locks(c, set(pool)) if h["lock_key"].count("|") >= 2}
    pool = [m for m in pool if m not in held]
    f, w = costing_screen(c, {(m, "0") for m in pool})
    pool = [m for m in pool if not w.get((m, "0"))]
    dups = dup_balances(c, {(m, rb) for m in pool})
    pool = [m for m in pool if (m, rb) not in dups]
    off = int(sub.get("offset", 0))
    if len(pool) < off + n:
        raise SystemExit(f"only {len(pool)} clean stock items for {n} lines")
    comps = pool[off:off + n]
    items = read_items(c, [src_id] + comps)
    source = items[src_id]
    uoms = read_uoms(c, {u for it in items.values() for u in [it.get("based_uom")] + [x["alt_uom_id"] for x in it["table_uom_conversion"]]})
    sl, bin_ = plant_defaults(c)
    rows = []
    for i, m in enumerate(comps):
        r = batch_add_row(c, items[m], i + 1, uoms, sl, bin_)
        r["_typed_qty"] = sub.get("line_qty", 1)
        rows.append(r)
    to_receipt(c, rows)
    qty = float(L.arg("--qty") or sub.get("qty", 1))
    pk, mode, avail, bal = source_pick(c, source, qty, sub.get("source_balance"))
    bins = bin_rows(c, [pk["location_id"]])
    summary = summary_of(pk, qty, (uoms.get(source.get("based_uom")) or {}).get("uom_name") or "", (bins.get(pk["location_id"]) or {}).get("n") or pk["location_id"])
    tsl, tbin = default_bin(source, c.plant)
    number = manual_number(c, sub, tag)
    hdr = header_add(c, source, qty, number, pk, mode, summary, (tsl or sl) if tbin else sl, tbin or bin_, (f"IDA V2 live test {tag} ({n} lines)", "", ""))
    hdr["stock_movement"] = finish_lines(c, rows, tag)
    if len(set(comps)) + 1 > 1000:
        c.warn(f"{len(set(comps)) + 1} distinct items: the posting fetch refuses more than 1,000 - never Complete & Post this IDA")
    return write_out(c, tag, hdr, items)


def subject_edit(c, tag):
    """the stored IDA as the Edit (or Clone) form's getValues(): the record's columns in the recorded Edit order + the form's widgets"""
    ida = L.digits(L.arg("--ida"), "--ida")
    h = L.q(f"SELECT * FROM sm_item_disassembly WHERE {c.TQ} AND id = {ida} AND is_deleted = 0")
    if not h:
        raise SystemExit(f"IDA {ida} not found in tenant {c.T}")
    lines = L.q(f"SELECT * FROM sm_item_disassembly_tlm8ve69_sub WHERE {c.TQ} AND sm_item_disassembly_id = {ida} AND is_deleted = 0 "
                "ORDER BY CAST(line_index AS UNSIGNED), id")
    rec = L.api_row(h[0], "sm_item_disassembly")
    clone = L.flag("--clone")
    page = "Clone" if clone else "Edit"
    rows = []
    for ln in lines:
        r = L.ordered(L.api_row(ln, "sm_item_disassembly_tlm8ve69_sub", sub=True), EDIT_LINE_ORDER)
        r["fm_key"] = L.fm_key(str(r.get("id")))
        rows.append(r)
    rec["stock_movement"] = rows
    rec["page_status"] = page
    rec.setdefault("table_item_balance", [])
    rec.setdefault("table_hu", [])
    html = form_html_defaults()
    for k in ("draft_status", "issued_status", "completed_status", "fullyposted_status"):
        rec.setdefault(k, html[k])
    hdr = L.ordered(rec, EDIT_HDR_ORDER)
    if v36_fields() is not None:
        hdr = with_v36(dict(hdr, processing_status=rec.get("processing_status", v36_fields()["processing_status"])), (rec.get("ida_v2_job_id") or "", rec.get("ida_idem_key") or ""))
    picks = json.loads(hdr.get("temp_qty_data") or "[]")
    hu = json.loads(hdr.get("temp_hu_data") or "[]") if (hdr.get("temp_hu_data") or "").startswith("[") else []
    hdr.update({"flex_2det1nd2": "", "item_display_table": [{"item_selection": hdr.get("item_id"), "item_code": hdr.get("item_code") or "", "item_name": hdr.get("item_name") or "",
                "item_desc": hdr.get("item_desc") or "", "item_qty": hdr.get("item_qty") or 0, "item_uom": hdr.get("item_uom") or "", "stock_summary": hdr.get("stock_summary") or "",
                "fm_key": L.fm_key("disp" + ida)}], "button_draft": "", "button_completed": "", "comp_post_button": "", "button_post": "", "flex_t6y2yh5r": "", "$_v": 22,
                "ida_source_stock_mode": "multiple" if hu or len(picks) > 1 else "single" if len(picks) == 1 else "none"})
    if clone:
        hdr.update({"item_disassembly_status": "", "posted_status": "", "item_disassembly_date": L.utc_date(), "stock_movement_no": ""})
        if c.tc["number"]["type"] == L.MANUAL:
            hdr["stock_movement_no"], hdr["stock_movement_no_type"] = manual_number(c, {"number": "CLONE"}, tag), L.MANUAL
        else:
            hdr["stock_movement_no_type"] = L.digits(c.tc["number"]["type"], "number rule")
        c.warn("Clone: no recorded Clone payload exists - built from the Edit shape with page_status Clone, the source ids kept (SUBMIT strips them)")
    elif hdr.get("item_disassembly_status") != "Draft":
        c.warn(f"stored status {hdr.get('item_disassembly_status')!r}: SUBMIT answers NOT_ELIGIBLE / STALE / BUSY, the classic v7 refuses Processing")
    if hdr.get("stock_movement_no_type") is not None and str(hdr.get("stock_movement_no_type")) == str(L.MANUAL):
        hdr["stock_movement_no_type"] = L.MANUAL
    items = read_items(c, [hdr.get("item_id")] + [r.get("item_selection") for r in rows if r.get("item_selection")])
    return write_out(c, tag, hdr, items, page=page, ida_id="" if clone else ida, v2=not L.flag("--any"))


def check(c):
    jobs = L.q("SELECT CAST(id AS CHAR) id, job_status, correlation_id FROM gd_async_job WHERE " + c.TQ + " AND is_deleted = 0 AND command = 'COMPLETE_IDA' "
               "AND job_status IN ('QUEUED', 'VALIDATING', 'READY_TO_COMMIT', 'COMMITTING_IDA', 'REQUIRES_REVIEW')")
    print(f"tenant {c.T}: open COMPLETE_IDA jobs {len(jobs)} {[(j['id'], j['job_status'], j['correlation_id']) for j in jobs][:6]}")
    proc = L.q(f"SELECT CAST(id AS CHAR) id, stock_movement_no FROM sm_item_disassembly WHERE {c.TQ} AND is_deleted = 0 AND item_disassembly_status = 'Processing'")
    print(f"   Processing IDAs {len(proc)} {[(p['id'], p['stock_movement_no']) for p in proc][:6]}")
    held = L.q(f"SELECT COUNT(*) n FROM inventory_balance_lock WHERE {c.TQ} AND organization_id = '{c.org}' AND is_deleted = 0 AND (free_token IS NULL OR free_token <> 1)")
    print(f"   engine lock rows held in the organization now: {held[0]['n']}")
    if c.tc.get("receipt") and c.T == "711077":
        receipt_bin_check(c)
        for w in c.warnings + c.problems:
            print("   " + w)
        print(f"   receipt bin {c.tc['receipt']['bin_name']} {c.tc['receipt']['bin']}: " + ("FAIL" if c.problems else "ok"))
    print(f"   base snapshots: run `python3 {os.path.relpath(os.path.join(L.IDAV2, 'base', 'snapshot.py'), L.REPO)} --check` (dev moved since WP0?)")
    return 1 if jobs or proc or c.problems else 0


def main():
    if len(sys.argv) < 2 or sys.argv[1] in ("-h", "--help"):
        raise SystemExit(__doc__)
    cfg = L.load_config()
    name = sys.argv[1]
    if name in ("edit", "check"):
        c = Ctx(cfg, L.digits(L.arg("--tenant"), "--tenant"))
        sys.exit(subject_edit(c, L.arg("--tag") or ("edit-" + L.arg("--ida", ""))) if name == "edit" else check(c))
    sub = cfg["subjects"].get(name)
    if not sub:
        raise SystemExit(f"unknown subject {name}: {sorted(k for k in cfg['subjects'] if not k.startswith('_'))}")
    c = Ctx(cfg, sub["tenant"])
    tag = L.arg("--tag") or name
    fn = {"bom": subject_bom, "manual": subject_manual, "k2": subject_k2}[sub["kind"]]
    sys.exit(fn(c, sub, tag))


if __name__ == "__main__":
    main()

"""build_ia_payload.py <subject> [options]: Item Assembly save requests in the exact shape the dev web form v32 sends to IA_SAVE
(+ the matching IA_V2_SUBMIT / STATUS requests, CONTRACT section 7), built READ-ONLY from today's dev rows. Nothing is run.

Subjects (config.json "subjects"; --tag overrides the folder name):
  a          711077 BOM 2105498079022452744 exploded (830 FIFO stock lines; it holds NO DL / IDL / VO line) + the three non-stock
             lines I-DL / I-IDL / I-VO added through Batch Add with a typed qty: 833 lines, 830 picks (the CONTRACT section 3 example)
  a2         711077 BOM 2105498122743877647 exploded as is (829 lines: 826 stock + I-DL / I-IDL / I-VO natively)
  b          711077 twin BOM: the first active 60-80-component BOM (base UOM, FIFO, no non-stock line) on which twin A and twin B
             both issue every component from ONE FIFO layer each (identical OUT prices, so live twin deltas can match); --bom ID forces one
  c-fifo     000000 ITM-20260600005-A (FIFO, batch 'According To System Settings') + 3 stocked FIFO components (Batch Add + typed qty)
  c-wa       000000 FRESH FJORD TROUT; SUP 5-6KG (WA, system batch) + 3 components
  c-manual   000000 JN-MANUAL-02 (Fixed Cost, Manual Input batch: SUBMIT must answer NOT_ELIGIBLE this cut) + 3 components;
             batch_no = a live batch number of this item made by ANOTHER document (--batch-no to choose)
  c-blocked  000000 ITM-20260600005-A received into inventory_category Blocked (verification item 5)
  d          711077 2,000 lines, one pick each, 2,000 distinct stocked FIFO items, qty 1 (Batch Add + typed qty); > 1,000 items:
             the posting fetch refuses it, never Complete & Post it
  r1         000000 TES500 + 2 FIFO components: the classic regression subject (verification items 1 / 2; variants: variant.py)
  s-ns       711077 a SMALL classic IA: 3 stocked components + I-DL / I-IDL / I-VO (item 6)
  m250       711077 240 Batch-Add lines (241 live rows): the classic IA_REVERT measurement (no 711077 BOM has 200-249 lines)
  c-post     000000 TES500 + 55 FIFO components: the items for item 9's browser BOM (000000 has no BOM above 3 lines)
  edit       --tenant T --ia ID: the stored Draft as the Edit form loads it (classic Completed / Draft, V2 SUBMIT Edit); --clone: the
             V2 SUBMIT a desktop Clone of it sends (pageStatus Clone, the source ids kept: SUBMIT strips them)
  check      --tenant T: read-only pre-flight of the tenant (open IA V2 jobs, held locks on the subjects' items, dev moved since base/)

Options: --qty N (assembled qty, default the subject's), --bom ID, --tag NAME, --components ID,.. (manual subjects), --batch-no X
(c-manual), --gen N (key generation), --expect-reason R, --out-dir DIR (or $IA_LIVE_OUT; never the repo). Subject b checks the
availability for TWO runs (the twins).
Writes <out>/<tag>/: classic.json (IA_SAVE {allData, saveAs Completed, pageStatus}), draft.json (saveAs Draft), submit.json,
status.json (IA_V2_SUBMIT), plan.json (picks, availability, expected movements, eligibility, today's FIFO preview). Exit 1 when a
check fails (a pick over the available stock, the excluded item, an ineligible line for a V2 subject, ...). RE-RUN right before a
live test: the picks are today's balances, and -41's GD tests share 711077's stock."""
import json, os, sys
from decimal import Decimal

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ialib as L  # noqa: E402

D = L.dec
# the client .get() shape of a unit_of_measurement row (key order and kept nulls as the prod payload's uom_options shows them)
UOM_KEYS = ["create_time", "create_dept", "id", "create_user", "organization_id", "update_user", "tenant_id", "update_time", "uom_type", "uom_name",
            "uom_desc", "sub_tenant_id", "is_deleted"]
OK_CATEGORIES = ("Unrestricted", "Blocked")


def jsf(x):
    """a JS number for JSON output: integral doubles print without a fraction"""
    if isinstance(x, float) and x.is_integer() and abs(x) < 2 ** 53:
        return int(x)
    return x


def q8(v):
    return float("%.8f" % (float(v or 0)))


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
    ids = sorted({L.digits(i, "item") for i in ids}, key=int)
    items = {}
    for part in L.chunks(ids, 500):
        for r in L.q("SELECT CAST(id AS CHAR) id, material_code, material_name, material_desc, CAST(based_uom AS CHAR) based_uom, stock_control, "
                     "material_costing_method, item_batch_management, batch_number_genaration, serial_number_management, show_delivery, "
                     "CAST(purchase_unit_price AS CHAR) purchase_unit_price, CAST(assembly_cost AS CHAR) assembly_cost, is_deleted "
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
            for k in ("create_dept", "create_user", "update_user", "id"):
                if row.get(k) is not None:
                    row[k] = str(row[k])
            out[str(r["id"])] = {k: row.get(k) for k in UOM_KEYS}
    return out


def read_balances(c, loose, batch):
    rows_l, rows_b = [], []
    W = f"{c.TQ} AND is_deleted = 0 AND plant_id = {c.plant} AND organization_id = '{c.org}'"
    for part in L.chunks(sorted(loose, key=int), 500):
        rows_l += [L.api_row(r, "item_balance") for r in L.q(f"SELECT * FROM item_balance WHERE {W} AND material_id IN ({','.join(part)}) ORDER BY id")]
    for part in L.chunks(sorted(batch, key=int), 500):
        rows_b += [L.api_row(r, "item_batch_balance") for r in L.q(f"SELECT * FROM item_batch_balance WHERE {W} AND material_id IN ({','.join(part)}) ORDER BY id")]
    return rows_l, rows_b


def read_hu_qty(c, mats):
    """the form's huQtyMap: HU-held loose quantity per material|bin|batch, net of Allocated HU reservations"""
    if not mats:
        return {}
    subs = []
    for part in L.chunks(sorted(mats, key=int), 500):
        subs += L.q(f"SELECT CAST(handling_unit_id AS CHAR) hu FROM handling_unit_atu7sreg_sub WHERE {c.TQ} AND is_deleted = 0 AND material_id IN ({','.join(part)})")
    hus = sorted({s["hu"] for s in subs if s["hu"] and s["hu"].isdigit()}, key=int)
    if not hus:
        return {}
    hu_loc, items = {}, []
    for part in L.chunks(hus, 500):
        for h in L.q(f"SELECT CAST(id AS CHAR) id, CAST(location_id AS CHAR) loc FROM handling_unit WHERE {c.TQ} AND is_deleted = 0 AND id IN ({','.join(part)})"):
            hu_loc[h["id"]] = h["loc"]
        items += L.q("SELECT CAST(handling_unit_id AS CHAR) hu, CAST(material_id AS CHAR) mat, CAST(location_id AS CHAR) loc, CAST(batch_id AS CHAR) batch, "
                     f"CAST(quantity AS CHAR) qty FROM handling_unit_atu7sreg_sub WHERE {c.TQ} AND is_deleted = 0 AND handling_unit_id IN ({','.join(part)})")
    resv = {}
    for part in L.chunks(sorted(mats, key=int), 500):
        for r in L.q("SELECT CAST(handling_unit_id AS CHAR) hu, CAST(batch_id AS CHAR) batch, CAST(open_qty AS CHAR) q FROM on_reserved_gd "
                     f"WHERE {c.TQ} AND is_deleted = 0 AND plant_id = {c.plant} AND organization_id = '{c.org}' AND status = 'Allocated' AND open_qty > 0 "
                     f"AND handling_unit_id IS NOT NULL AND material_id IN ({','.join(part)})"):
            k = f"{r['hu']}|{r['batch'] or ''}"
            resv[k] = resv.get(k, 0.0) + float(r["q"])
    out = {}
    for it in items:
        if it["hu"] not in hu_loc:
            continue
        loc = it["loc"] or hu_loc[it["hu"]]
        qty = max(0.0, float(it["qty"] or 0) - resv.get(f"{it['hu']}|{it['batch'] or ''}", 0.0))
        if qty <= 0:
            continue
        k = f"{it['mat']}|{loc}|{it['batch'] or 'no_batch'}"
        out[k] = out.get(k, 0.0) + qty
    return out


def plant_defaults(c):
    sl = L.q(f"SELECT CAST(id AS CHAR) id FROM storage_location WHERE {c.TQ} AND plant_id = {c.plant} AND is_deleted = 0 AND is_default = 1 "
             "AND storage_status = 1 AND location_type = 'Common' ORDER BY id LIMIT 1")
    if not sl:
        return "", ""
    b = L.q(f"SELECT CAST(id AS CHAR) id FROM bin_location WHERE {c.TQ} AND plant_id = {c.plant} AND storage_location_id = {sl[0]['id']} AND is_deleted = 0 "
            "AND is_default = 1 AND bin_status = 1 ORDER BY id LIMIT 1")
    return sl[0]["id"], (b[0]["id"] if b else "")


def names(c, table, col, ids):
    out = {}
    for part in L.chunks(sorted({str(i) for i in ids if i}, key=int), 500):
        for r in L.q(f"SELECT CAST(id AS CHAR) id, {col} n FROM {table} WHERE id IN ({','.join(part)}) AND is_deleted = 0"):
            out[r["id"]] = r["n"]
    return out


def default_bin(item, plant):
    for b in (item or {}).get("table_default_bin") or []:
        if b.get("plant_id") == plant and b.get("bin_location"):
            return b["bin_location"], b.get("storage_location") or None
    return None, None


def uom_options(ids, uoms):
    rows, seen = [], set()
    for i in ids:
        if i and i not in seen:
            seen.add(i)
            if i in uoms:
                rows.append(uoms[i])
    return json.dumps(rows, ensure_ascii=False, separators=(",", ":"))


# --------------------------------------------------------------------------------------------- the form's allocation
def candidates_of(balances_l, balances_b, hu_map):
    by_mat = {}
    for bal in balances_l + balances_b:
        key = f"{bal['material_id']}|{bal['location_id']}|{bal.get('batch_id') or 'no_batch'}"
        avail = max(0.0, float(bal.get("unrestricted_qty") or 0) - hu_map.get(key, 0.0))
        if avail <= 0:
            continue
        by_mat.setdefault(str(bal["material_id"]), []).append({"balance": bal, "available": avail})
    return by_mat


def sort_candidates(lst, preferred):
    lst.sort(key=lambda c: (0 if (preferred and str(c["balance"]["location_id"]) == preferred) else 1, str(c["balance"].get("create_time") or "")))


def pick_entry(bal, take, c):
    return {"material_id": str(bal["material_id"]), "location_id": str(bal["location_id"]), "storage_location_id": bal.get("storage_location_id") or None,
            "batch_id": str(bal["batch_id"]) if bal.get("batch_id") else None, "balance_id": str(bal["id"]), "sm_quantity": jsf(take), "category": "Unrestricted",
            "plant_id": c.plant, "organization_id": c.org, "is_deleted": 0, "expired_date": bal.get("expired_date") or None,
            "manufacturing_date": bal.get("manufacturing_date") or None, "unrestricted_qty": jsf(float(bal.get("unrestricted_qty") or 0)),
            "balance_quantity": jsf(float(bal.get("balance_quantity") or 0))}


def summary_of(picks, total, uom_name, bins, batches):
    det = []
    for i, p in enumerate(picks):
        line = f"{i + 1}. {bins.get(p['location_id'], p['location_id'])}: {L.js_text(p['sm_quantity'])} {uom_name} (UNR)"
        if p["batch_id"]:
            line += f"\n[{batches.get(p['batch_id'], p['batch_id'])}]"
        det.append(line)
    return f"Total: {L.js_text(jsf(total))} {uom_name}\n\nDETAILS:\n" + "\n".join(det)


def explode_allocate(c, rows, items, by_mat, plant):
    """onChange_assembledItem autoAllocate (form v32) + the non-stock rule (CONTRACT section 12): a stock_control 0 line keeps
    total_quantity = requested_qty, no picks"""
    for mat, lst in by_mat.items():
        sort_candidates(lst, default_bin(items.get(mat), plant)[0])
    out = []
    for row in rows:
        it = items.get(row["item_selection"])
        if not it or str(it.get("serial_number_management")) == "1":
            out.append((row, []))
            continue
        if str(it.get("stock_control")) == "0":
            row["total_quantity"] = row["requested_qty"]
            out.append((row, []))
            continue
        remaining = float(row["requested_qty"] or 0)
        if remaining <= 0:
            out.append((row, []))
            continue
        picks = []
        for cand in by_mat.get(row["item_selection"], []):
            if remaining <= 0:
                break
            if cand["available"] <= 0:
                continue
            take = min(cand["available"], remaining)
            cand["available"] -= take
            remaining = remaining - take
            picks.append(pick_entry(cand["balance"], take, c))
        total = 0.0
        for p in picks:
            total = total + float(p["sm_quantity"])
        row["total_quantity"] = jsf(total)
        row["temp_qty_data"] = json.dumps(picks, ensure_ascii=False, separators=(",", ":")) if picks else ""
        if remaining > 0:
            c.warn(f"line {row['line_index']} ({row['item_name']}): short {remaining} of loose stock (the form warns and saves the rest)")
        out.append((row, picks))
    return out


def typed_allocate(c, row, typed, it, by_mat, plant):
    """onChange_componentQty (form v32): a typed qty on one line re-picked from loose stock (q8 takes; siblings already deducted in
    by_mat); stock_control 0 keeps the typed qty without picks"""
    if str(it.get("stock_control")) == "0":
        row["total_quantity"] = jsf(float(typed))
        return []
    lst = by_mat.get(row["item_selection"], [])
    sort_candidates(lst, default_bin(it, plant)[0])
    remaining = max(0.0, float(typed))
    picks = []
    for cand in lst:
        if remaining <= 0:
            break
        take = q8(min(cand["available"], remaining))
        if take <= 0:
            continue
        cand["available"] -= take
        remaining = q8(remaining - take)
        picks.append(pick_entry(cand["balance"], take, c))
    total = q8(sum(float(p["sm_quantity"]) for p in picks))
    row["total_quantity"] = jsf(total)
    row["temp_qty_data"] = json.dumps(picks, ensure_ascii=False, separators=(",", ":")) if picks else ""
    row["temp_hu_data"] = ""
    if remaining > 0:
        c.warn(f"line {row['line_index']} ({row['item_name']}): only {total} of {typed} available")
    return picks


def base_row(it, line_index, c, uoms, qty_uom=None, requested=0, name=None, desc=None, remark=""):
    ids = [qty_uom or it.get("based_uom"), it.get("based_uom")] + [u["alt_uom_id"] for u in it.get("table_uom_conversion") or []]
    return {"item_selection": it["id"], "item_name": name if name is not None else (it.get("material_name") or ""),
            "item_desc": desc if desc is not None else (it.get("material_desc") or ""), "requested_qty": requested, "total_quantity": 0,
            "quantity_uom": qty_uom or it.get("based_uom") or "", "uom_options": uom_options(ids, uoms), "item_remark": remark, "project_id": "",
            "organization_id": c.org, "issuing_plant": c.plant, "line_index": line_index, "balance_id": "", "temp_qty_data": "", "temp_hu_data": "",
            "stock_summary": ""}


# --------------------------------------------------------------------------------------------- header + requests
def form_defaults():
    f = L.read_json(os.path.join(L.IAV2, "base", "ia_form_v32.json"))
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


def header_add(c, parent, qty, sl, bin_, category="Unrestricted", batch_no="", mfg=None, exp=None, remarks=("", "", ""), date=None):
    """getValues() of the Add form (key order = the recorded dev / prod Add payloads 2110917562163441665 / 2111001816408920065);
    stock_movement goes in place; mfg / exp only when set (a null model is not in getValues())"""
    html = form_defaults()
    h = {"isTrusted": True, "_vts": int(__import__("time").time() * 1000)}
    h.update({k: html[k] for k in ("draft_status", "issued_status", "completed_status", "fullyposted_status")})
    h.update({"flex_2det1nd2": "", "organization_id": c.org, "sia_uuid": "", "item_assembly_status": "", "posted_status": "", "page_status": "Add",
              "issuing_operation_faci": c.plant, "stock_movement_no": "", "stock_movement_no_type": L.digits(c.tc["ia_rule"], "ia_rule"),
              "item_id": parent["id"], "item_name": parent.get("material_name") or "", "item_desc": parent.get("material_desc") or "", "item_qty": jsf(float(qty)),
              "item_uom": parent.get("based_uom") or "", "item_assembly_date": date or L.utc_date(), "issued_by": c.tc.get("nickname", "admin"),
              "project_id": "", "batch_no": batch_no})
    if mfg:
        h["manufacturing_date"] = mfg
    if exp:
        h["expired_date"] = exp
    h.update({"storage_location_id": sl, "location_id": bin_, "inventory_category": category, "remarks": remarks[0], "remarks_2": remarks[1],
              "remarks_3": remarks[2], "reference_documents": "", "stock_movement": [], "button_draft": "", "button_completed": "",
              "flex_t6y2yh5r": "", "$_v": 30})
    return h


def requests_of(c, all_data, page, ia_id="", gen=1, token=None):
    """the classic IA_SAVE requests and the V2 SUBMIT / STATUS requests for one form state"""
    classic = {"allData": all_data, "saveAs": "Completed", "pageStatus": all_data.get("page_status") or page}
    draft = {"allData": all_data, "saveAs": "Draft", "pageStatus": all_data.get("page_status") or page}
    record = L.record_of(all_data)
    is_new = page in ("Add", "Clone", "Copy")
    token = token or L.page_token(c.T)
    doc = ("new-" + token) if is_new else L.digits(ia_id, "ia_id")
    key = L.ia_key(c.org, doc, page, record, gen)
    submit = {"operation": "SUBMIT", "saveAs": "Completed", "pageStatus": page, "ia_id": "" if is_new else str(ia_id), "idempotency_key": key,
              "source": "FORM", "form": record}
    status = {"operation": "STATUS", "saveAs": "Completed", "pageStatus": "Edit", "ia_id": "" if is_new else str(ia_id), "idempotency_key": key,
              "source": "FORM", "form": {}}
    return classic, draft, submit, status


# --------------------------------------------------------------------------------------------- checks + plan
def costing_screen(c, keys):
    """CONTRACT section 7 costing screen (copy of scratchpad/pwv2/prepare/sql.py SUBMIT_SQL['cost']) on (material, batch or 0)"""
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


def fifo_layers(c, mats):
    out = {}
    for part in L.chunks(sorted(mats, key=int), 500):
        for r in L.q("SELECT CAST(id AS CHAR) id, CAST(material_id AS CHAR) m, CAST(COALESCE(batch_id, 0) AS CHAR) b, fifo_sequence, "
                     "CAST(fifo_available_quantity AS CHAR) avail, CAST(fifo_cost_price AS CHAR) price FROM fifo_costing_history "
                     f"WHERE {c.TQ} AND is_deleted = 0 AND plant_id = {c.plant} AND organization_id = '{c.org}' AND material_id IN ({','.join(part)})"):
            out.setdefault((r["m"], r["b"]), []).append(r)
    for v in out.values():
        v.sort(key=lambda r: int(str(r["fifo_sequence"] or 0)))
    return out


def held_locks(c, mats):
    held = []
    for part in L.chunks(sorted(mats, key=int), 150):
        like = " OR ".join(f"lock_key LIKE '%|{m}|%' OR lock_key LIKE '%|{m}'" for m in part)
        held += L.q(f"SELECT lock_key, owner_operation_id FROM inventory_balance_lock WHERE {c.TQ} AND organization_id = '{c.org}' AND is_deleted = 0 "
                    f"AND (free_token IS NULL OR free_token <> 1) AND ({like})")
    return held


def uom_base(it, qty, uom):
    """price.js iaUomOf (= the engine's uomOf): q8 qty, the line UOM else the base UOM, one conversion row of that alt UOM"""
    alt = q8(qty)
    alt_uom = uom or it.get("based_uom")
    for cv in it.get("table_uom_conversion") or []:
        if str(cv.get("alt_uom_id")) == str(alt_uom):
            return q8(alt * float(cv.get("base_qty") or 0))
    return alt


def plan_and_check(c, all_data, items, pairs, avail_of, twin=False, v2=True, tag=""):
    """the designed moves + every check this kit can make before a run (CONTRACT section 7 eligibility / gates as data checks)"""
    parent = items.get(all_data["item_id"])
    picks, nonstock, stock_lines = [], [], 0
    use = {}
    for row, plist in pairs:
        it = items.get(row["item_selection"]) or {}
        if str(it.get("stock_control")) == "0":
            nonstock.append(row["line_index"])
            if plist:
                c.fail(f"non-stock line {row['line_index']} carries picks")
            if not (float(row.get("total_quantity") or 0) > 0):
                c.fail(f"non-stock line {row['line_index']}: total_quantity must be > 0 (v12 code_validate)")
            continue
        stock_lines += 1
        if not plist:
            c.fail(f"stock line {row['line_index']} ({row['item_name']}) has no pick (code_validate: no stock has been allocated)")
        tot = sum(D(p["sm_quantity"]) for p in plist)
        if abs(tot - D(row.get("total_quantity") or 0)) > Decimal("0.0005"):
            c.fail(f"line {row['line_index']}: total_quantity {row.get('total_quantity')} != picks {tot}")
        for p in plist:
            k = (p["material_id"], p["location_id"], p["batch_id"] or "", p["category"])
            use[k] = use.get(k, Decimal(0)) + D(p["sm_quantity"])
            picks.append({"line_index": row["line_index"], "material_id": p["material_id"], "code": it.get("material_code"), "bin": p["location_id"],
                          "batch_id": p["batch_id"], "category": p["category"], "qty": str(D(p["sm_quantity"]).normalize()),
                          "uom": row["quantity_uom"], "base_qty": str(Decimal(str(uom_base(it, p["sm_quantity"], row["quantity_uom"]))).normalize())})
            if p["material_id"] == L.EXCLUDED["material"] and p["location_id"] == L.EXCLUDED["bin"]:
                c.fail(f"line {row['line_index']}: picks the EXCLUDED item 'blade, loose' at bin A1-01 (-41's GD test stock)")
    runs = 2 if twin else 1
    over = [(k, str(v * runs), str(avail_of.get(k, 0))) for k, v in use.items() if v * runs > D(avail_of.get(k, 0))]
    if over:
        c.fail(f"{len(over)} (material, bin, batch, category) keys need more than today's available ({'x2 twins' if twin else 'one run'}): {over[:3]}")
    # eligibility (CONTRACT section 7), as a V2 subject must pass it
    reasons = []
    if not parent:
        reasons.append(f"item {all_data['item_id']} not found")
    else:
        if str(parent.get("stock_control")) == "0":
            reasons.append("assembled item not stock controlled")
        if str(parent.get("item_batch_management")) == "1" and parent.get("batch_number_genaration") != "According To System Settings":
            reasons.append("manual batch number")
        if str(parent.get("serial_number_management")) == "1":
            reasons.append("serial numbers")
    for row, plist in pairs:
        it = items.get(row["item_selection"])
        if not it:
            reasons.append(f"item {row['item_selection']} not found")
            continue
        if str(it.get("serial_number_management")) == "1":
            reasons.append("serial numbers")
        if (row.get("temp_hu_data") or "") not in ("", "[]") or any(p.get("handling_unit_id") for p in plist):
            reasons.append("handling units")
        for p in plist:
            if p["category"] not in OK_CATEGORIES:
                reasons.append(f"{p['category']} stock")
    if not picks:
        reasons.append("no stock to issue")
    keys = {(p["material_id"], p["batch_id"] or "0") for p in picks} | ({(parent["id"], "0")} if parent else set())
    f, w = costing_screen(c, keys)
    meth = {i: it.get("material_costing_method") for i, it in items.items()}
    flagged = []
    for (m, b) in sorted(keys):
        it = items.get(m) or {}
        if str(it.get("stock_control")) == "0":
            continue
        fn, wn = f.get((m, b), 0), w.get((m, b), 0)
        if (fn and wn) or (meth.get(m) == L.FIFO and not fn and wn) or (meth.get(m) == L.WA and not wn and fn):
            flagged.append((m, b, fn, wn))
    if flagged:
        reasons.append("costing migration")
        c.warn(f"costing screen flags {flagged[:3]}")
    for p in picks:
        it = items.get(p["material_id"]) or {}
        if it.get("material_costing_method") == L.WA and not w.get((p["material_id"], p["batch_id"] or "0"), 0):
            c.fail(f"line {p['line_index']}: WA component without a wa_costing_method row (SUBMIT STOP IA_NO_WA_RECORD)")
    reasons = sorted(set(reasons))
    expect = L.arg("--expect-reason") or getattr(c, "expect_reason", "")
    if expect:
        if expect not in reasons:
            c.fail(f"expected SUBMIT NOT_ELIGIBLE '{expect}', the data gives {reasons or ['eligible']}")
    elif v2 and reasons:
        c.fail("ineligible for V2: " + "; ".join(reasons))
    held = held_locks(c, {p["material_id"] for p in picks} | ({parent["id"]} if parent else set()))
    if held:
        c.warn(f"{len(held)} engine lock rows held now on these items (a V2 run waits / fails IA_INVENTORY_LOCK_BUSY): {[h['lock_key'] for h in held[:3]]}")
    # today's FIFO preview: the price each pick would get (both twins when twin)
    layers = fifo_layers(c, {p["material_id"] for p in picks})
    preview, multi = {}, []
    for p in picks:
        it = items.get(p["material_id"]) or {}
        if it.get("material_costing_method") != L.FIFO:
            continue
        lst = layers.setdefault((p["material_id"], p["batch_id"] or "0"), [])
        prices = []
        for _ in range(runs):
            need, cost = D(p["base_qty"]), []
            for lay in lst:
                if need <= 0:
                    break
                a = D(lay["avail"])
                if a <= 0:
                    continue
                t = min(a, need)
                lay["avail"] = str(a - t)
                need -= t
                cost.append(lay["price"])
            prices.append(sorted(set(str(D(x).normalize()) for x in cost)) + (["SHORT"] if need > 0 else []))
        preview[f"M{len(preview) + 1}"] = prices
        if any(len(x) != 1 for x in prices) or (twin and prices[0] != prices[1]):
            multi.append((p["line_index"], prices))
    receipt_base = uom_base(parent or {}, all_data["item_qty"], all_data.get("item_uom")) if parent else 0
    plan = {"tag": tag, "tenant": c.T, "org": c.org, "plant": c.plant, "parent": {"id": all_data["item_id"], "code": (parent or {}).get("material_code"),
            "method": (parent or {}).get("material_costing_method"), "batch": (parent or {}).get("item_batch_management"),
            "batch_rule": (parent or {}).get("batch_number_genaration"), "assembly_cost": (parent or {}).get("assembly_cost"),
            "purchase_unit_price": (parent or {}).get("purchase_unit_price"), "item_qty": all_data["item_qty"], "item_uom": all_data.get("item_uom"),
            "receipt_base_qty": receipt_base, "bin": all_data.get("location_id"), "category": all_data.get("inventory_category")},
            "counts": {"lines": len(pairs), "stock_lines": stock_lines, "picks": len(picks), "non_stock_lines": len(nonstock),
                       "items": len({all_data["item_id"]} | {r["item_selection"] for r, _ in pairs}), "movements": len(picks) + 1},
            "non_stock_line_indexes": nonstock, "eligibility": reasons or ["eligible"], "picks": picks,
            "use_vs_available": {"|".join(k): {"use": str(v), "available": str(avail_of.get(k, 0))} for k, v in use.items()},
            "fifo_price_preview": {"runs": runs, "multi_layer_or_twin_differs": multi[:50], "n_multi": len(multi)},
            "warnings": c.warnings, "problems": c.problems}
    return plan


def write_out(c, tag, all_data, items, pairs, avail_of, page="Add", ia_id="", twin=False, v2=True):
    out = L.out_dir(tag)
    classic, draft, submit, status = requests_of(c, all_data, page, ia_id, int(L.arg("--gen", "1")))
    plan = plan_and_check(c, all_data, items, pairs, avail_of, twin=twin, v2=v2, tag=tag)
    plan["key"] = submit["idempotency_key"]
    for name, obj in (("classic", classic), ("draft", draft), ("submit", submit), ("status", status), ("plan", plan)):
        L.write_json(os.path.join(out, name + ".json"), obj, indent=None if name != "plan" else 1)
    cn = plan["counts"]
    print(f"{tag}: tenant {c.T} parent {plan['parent']['code']} x {all_data['item_qty']} - {cn['lines']} lines, {cn['picks']} picks, "
          f"{cn['non_stock_lines']} non-stock, {cn['items']} items; eligibility {plan['eligibility']}; FIFO multi-layer / twin-price-differs "
          f"{plan['fifo_price_preview']['n_multi']}")
    print(f"   requests: classic {len(json.dumps(classic)) / 1e6:.2f} MB, submit {len(json.dumps(submit)) / 1e6:.2f} MB; key {submit['idempotency_key']}")
    for w in c.warnings[:8]:
        print("   WARN", w)
    for p in c.problems:
        print("   FAIL", p)
    print(f"   -> {out}/{{classic,draft,submit,status,plan}}.json" + ("" if not c.problems else f"   ({len(c.problems)} CHECK(S) FAILED)"))
    return 1 if c.problems else 0


# --------------------------------------------------------------------------------------------- subjects
def bom_rows(c, bom_id):
    b = L.q(f"SELECT CAST(id AS CHAR) id, parent_material_code parent, CAST(parent_mat_base_quantity AS CHAR) base, parent_mat_bom_version v, "
            f"parent_mat_is_default d, is_active a, organization_id org FROM bill_of_materials WHERE {c.TQ} AND id = {L.digits(bom_id, 'bom')} AND is_deleted = 0")
    if not b:
        raise SystemExit(f"BOM {bom_id} not found in tenant {c.T}")
    subs = L.q("SELECT CAST(id AS CHAR) id, bom_material_code code, sub_material_name name, sub_material_desc descr, CAST(sub_material_qty AS CHAR) qty, "
               f"CAST(sub_material_qty_uom AS CHAR) uom, sub_material_wastage w, sub_material_remark remark, consume_type FROM bill_of_materials_ttux02kq_sub "
               f"WHERE {c.TQ} AND bill_of_materials_id = {b[0]['id']} AND is_deleted = 0 ORDER BY id")
    others = L.q(f"SELECT COUNT(*) n FROM bill_of_materials WHERE {c.TQ} AND is_deleted = 0 AND is_active = 1 AND organization_id = '{c.org}' "
                 f"AND parent_material_code = '{L.digits(b[0]['parent'], 'parent')}'")[0]["n"]
    if int(others) > 1:
        c.warn(f"{others} active BOMs for this parent: the form takes the default / highest V-number one - check it is {bom_id}")
    return b[0], [s for s in subs if s["code"] and s["consume_type"] != "REF"]


def explode(c, bom, subs, qty, items, uoms):
    rows = []
    base = float(bom["base"] or 0)
    for i, s in enumerate(subs):
        it = items.get(s["code"]) or {}
        w = float(s["w"] or 0)
        req = (float(qty) / base) * float(s["qty"] or 0) * (1 + w / 100)
        if str(it.get("serial_number_management")) == "1":
            req = float(int(-(-req // 1)))
        ids = [s["uom"], it.get("based_uom")] + [u["alt_uom_id"] for u in it.get("table_uom_conversion") or []]
        rows.append({"item_selection": s["code"], "item_name": s["name"] or it.get("material_name") or "", "item_desc": s["descr"] or it.get("material_desc") or "",
                     "requested_qty": jsf(req), "total_quantity": 0, "quantity_uom": s["uom"] or it.get("based_uom") or "", "uom_options": uom_options(ids, uoms),
                     "item_remark": s["remark"] or "", "project_id": "", "organization_id": c.org, "issuing_plant": c.plant, "line_index": i + 1,
                     "balance_id": "", "temp_qty_data": "", "temp_hu_data": "", "stock_summary": ""})
    return rows


def finish_rows(c, pairs, items, uoms):
    bins = names(c, "bin_location", "bin_location_combine", {p["location_id"] for _, pl in pairs for p in pl})
    batches = names(c, "batch", "batch_number", {p["batch_id"] for _, pl in pairs for p in pl if p["batch_id"]})
    for row, pl in pairs:
        if pl:
            row["stock_summary"] = summary_of(pl, float(row["total_quantity"]), (uoms.get(row["quantity_uom"]) or {}).get("uom_name") or "", bins, batches)
        row["fm_key"] = L.fm_key(c.T + row["item_selection"] + str(row["line_index"]))
    return [r for r, _ in pairs]


def availability(c, items, mats):
    loose = {m for m in mats if str((items.get(m) or {}).get("item_batch_management")) != "1"}
    batch = set(mats) - loose
    rows_l, rows_b = read_balances(c, loose, batch)
    hu = read_hu_qty(c, set(mats))
    by_mat = candidates_of(rows_l, rows_b, hu)
    avail_of = {}
    for lst in by_mat.values():
        for cand in lst:
            b = cand["balance"]
            k = (str(b["material_id"]), str(b["location_id"]), str(b["batch_id"]) if b.get("batch_id") else "", "Unrestricted")
            avail_of[k] = avail_of.get(k, Decimal(0)) + Decimal(str(cand["available"]))
    return by_mat, avail_of


def find_bom(c, lo, hi):
    """the first active BOM of the organization with lo..hi lines, all of them FIFO stock lines (the classic revert measurement)"""
    rows = L.q("SELECT CAST(b.id AS CHAR) id, COUNT(*) n, SUM(i.stock_control = 1 AND i.material_costing_method = 'First In First Out') fifo FROM bill_of_materials b "
               "JOIN bill_of_materials_ttux02kq_sub s ON s.bill_of_materials_id = b.id AND s.is_deleted = 0 AND s.tenant_id = b.tenant_id "
               "JOIN item i ON i.id = CAST(s.bom_material_code AS UNSIGNED) AND i.tenant_id = b.tenant_id "
               f"WHERE b.{c.TQ} AND b.is_deleted = 0 AND b.is_active = 1 AND b.organization_id = '{c.org}' GROUP BY b.id "
               f"HAVING n BETWEEN {int(lo)} AND {int(hi)} AND fifo = n ORDER BY n DESC, b.id LIMIT 5")
    if not rows:
        raise SystemExit(f"no active {lo}-{hi}-line all-FIFO BOM")
    print(f"   BOM {rows[0]['id']} ({rows[0]['n']} lines) for {lo}-{hi} live rows")
    return rows[0]["id"]


def subject_bom(c, sub, tag):
    bom_id = L.arg("--bom") or sub.get("bom") or find_bom(c, *sub["pick_lines"])
    qty = float(L.arg("--qty") or sub.get("qty", 1))
    bom, subs = bom_rows(c, bom_id)
    add_ns = sub.get("add_nonstock") or []
    items = read_items(c, [bom["parent"]] + [s["code"] for s in subs] + add_ns)
    parent = items.get(bom["parent"])
    if not parent:
        raise SystemExit("parent item missing")
    uom_ids = {s["uom"] for s in subs} | {parent.get("based_uom")}
    for it in items.values():
        uom_ids |= {it.get("based_uom")} | {u["alt_uom_id"] for u in it["table_uom_conversion"]}
    uoms = read_uoms(c, uom_ids)
    rows = explode(c, bom, subs, qty, items, uoms)
    excluded = [r for r in rows if r["item_selection"] == L.EXCLUDED["material"]]
    if excluded:
        c.warn(f"dropped {len(excluded)} line(s) of the EXCLUDED item 'blade, loose' (as the user would delete the row)")
        rows = [r for r in rows if r["item_selection"] != L.EXCLUDED["material"]]
        for i, r in enumerate(rows):
            r["line_index"] = i + 1
    sl, bin_ = plant_defaults(c)
    pb, ps = default_bin(parent, c.plant)
    hdr = header_add(c, parent, qty, (ps or sl) if pb else sl, pb or bin_)
    hdr["item_uom"] = parent.get("based_uom") or ""
    mats = {r["item_selection"] for r in rows if str((items.get(r["item_selection"]) or {}).get("stock_control")) != "0"}
    by_mat, avail_of = availability(c, items, mats)
    pairs = explode_allocate(c, rows, items, by_mat, c.plant)
    # non-stock lines added through Batch Add with a typed qty (the BOM itself holds none)
    for ns_id in add_ns:
        it = items.get(ns_id)
        if not it:
            c.fail(f"non-stock item {ns_id} not found")
            continue
        row = base_row(it, len(pairs) + 1, c, uoms)
        typed_allocate(c, row, float(sub.get("nonstock_qty", 1)) * qty, it, by_mat, c.plant)
        pairs.append((row, []))
    hdr["stock_movement"] = finish_rows(c, pairs, items, uoms)
    return write_out(c, tag, hdr, items, pairs, avail_of, twin=bool(sub.get("twin")), v2=True)


def subject_twin(c, sub, tag):
    """b: the first 60-80-component BOM whose every line is FIFO, base UOM, stocked, and whose two runs price from ONE layer each"""
    if L.arg("--bom"):
        sub = dict(sub, bom=L.arg("--bom"), twin=True)
        return subject_bom(c, sub, tag)
    lo, hi = sub.get("min_lines", 60), sub.get("max_lines", 80)
    cands = L.q("SELECT CAST(b.id AS CHAR) id, COUNT(*) n FROM bill_of_materials b JOIN bill_of_materials_ttux02kq_sub s ON s.bill_of_materials_id = b.id "
                f"AND s.is_deleted = 0 AND s.tenant_id = b.tenant_id WHERE b.{c.TQ} AND b.is_deleted = 0 AND b.is_active = 1 AND b.organization_id = '{c.org}' "
                f"GROUP BY b.id HAVING n BETWEEN {int(lo)} AND {int(hi)} ORDER BY n, b.id")
    qty = float(L.arg("--qty") or sub.get("qty", 1))
    for cand in cands:
        probe = Ctx(c.cfg, c.T)
        bom, subs = bom_rows(probe, cand["id"])
        items = read_items(probe, [bom["parent"]] + [s["code"] for s in subs])
        bad = [s for s in subs if str((items.get(s["code"]) or {}).get("stock_control")) != "1" or (items.get(s["code"]) or {}).get("material_costing_method") != L.FIFO
               or s["uom"] != (items.get(s["code"]) or {}).get("based_uom") or s["code"] == L.EXCLUDED["material"]]
        if bad:
            print(f"   twin candidate {cand['id']} ({cand['n']} lines): {len(bad)} line(s) not FIFO / base UOM / stocked - skipped")
            continue
        layers = fifo_layers(probe, {s["code"] for s in subs})
        ok = True
        for s in subs:
            need = Decimal(str((qty / float(bom["base"] or 1)) * float(s["qty"]) * (1 + float(s["w"] or 0) / 100)))
            first = next((lay for lay in layers.get((s["code"], "0"), []) if D(lay["avail"]) > 0), None)
            if not first or D(first["avail"]) < 2 * need:
                ok = False
                break
        if not ok:
            print(f"   twin candidate {cand['id']} ({cand['n']} lines): a component's first FIFO layer cannot cover both twins - skipped")
            continue
        print(f"   twin BOM {cand['id']} ({cand['n']} lines): every component prices both twins from one FIFO layer")
        return subject_bom(c, dict(sub, bom=cand["id"], twin=True), tag)
    raise SystemExit("no 60-80-component BOM fits the twin rule today (try --bom ID --qty N)")


def pick_components(c, n, exclude, kinds=("fifo",)):
    """stocked, clean components for the manual subjects: FIFO non-batch (+ 'fifob' FIFO batch), most stock first, no HU holding,
    no held lock, no cost-row migration, not the excluded item"""
    rows = L.q("SELECT CAST(b.material_id AS CHAR) m, SUM(b.unrestricted_qty) u, i.item_batch_management bat FROM item_balance b JOIN item i ON i.id = b.material_id "
               f"AND i.tenant_id = b.tenant_id WHERE b.{c.TQ} AND b.is_deleted = 0 AND b.plant_id = {c.plant} AND b.organization_id = '{c.org}' "
               "AND i.is_deleted = 0 AND i.stock_control = 1 AND i.serial_number_management = 0 AND i.material_costing_method = 'First In First Out' "
               "GROUP BY b.material_id, i.item_batch_management HAVING u > 100 ORDER BY u DESC LIMIT 200")
    want = {"fifo": "0", "fifob": "1"}
    out = []
    for kind in kinds:
        got = 0
        for r in rows:
            if got >= n:
                break
            if str(r["bat"]) != want[kind] or r["m"] in exclude or r["m"] in out:
                continue
            if read_hu_qty(c, {r["m"]}) or held_locks(c, {r["m"]}):
                continue
            _, w = costing_screen(c, {(r["m"], "0")})
            if w:
                continue
            out.append(r["m"])
            got += 1
    return out


def subject_manual(c, sub, tag):
    qty = float(L.arg("--qty") or sub.get("qty", 1))
    if sub.get("parent"):
        pid = L.digits(sub["parent"], "parent")
    else:
        parent_rows = L.q(f"SELECT CAST(id AS CHAR) id FROM item WHERE {c.TQ} AND is_deleted = 0 AND organization_id = '{c.org}' AND material_code = "
                          + "'" + sub["parent_code"].replace("'", "''") + "'")
        if len(parent_rows) != 1:
            raise SystemExit(f"parent {sub['parent_code']}: {len(parent_rows)} items")
        pid = parent_rows[0]["id"]
    add_ns = sub.get("add_nonstock") or []
    comps = [L.digits(x, "component") for x in (L.arg("--components") or "").split(",") if x] or sub.get("components_ids") or \
        pick_components(c, int(sub.get("components", 3)), {pid, L.EXCLUDED["material"]} | set(add_ns))
    items = read_items(c, [pid] + comps + add_ns)
    parent = items[pid]
    uom_ids = set()
    for it in items.values():
        uom_ids |= {it.get("based_uom")} | {u["alt_uom_id"] for u in it["table_uom_conversion"]}
    uoms = read_uoms(c, uom_ids)
    sl, bin_ = plant_defaults(c)
    pb, ps = default_bin(parent, c.plant)
    batch_no = ""
    if str(parent.get("item_batch_management")) == "1" and parent.get("batch_number_genaration") != "According To System Settings":
        batch_no = L.arg("--batch-no") or sub.get("batch_no") or ""
        if not batch_no:
            used = L.q(f"SELECT batch_number n, transaction_no t FROM batch WHERE {c.TQ} AND is_deleted = 0 AND material_id = {pid} AND COALESCE(batch_number, '') <> '' "
                       "ORDER BY id LIMIT 20")
            other = [u for u in used if not str(u["t"] or "").startswith("IA")]
            if other:
                batch_no = other[0]["n"]
                c.warn(f"manual batch_no {batch_no!r} = a live batch of this item made by {other[0]['t']} (reuse case, verification item 5)")
            else:
                batch_no = "IAV2-MANUAL-" + L.utc_date().replace("-", "")
    mfg = sub.get("mfg", "today") if str(parent.get("item_batch_management")) == "1" else None
    exp = sub.get("exp", "+2y") if str(parent.get("item_batch_management")) == "1" else None
    today = L.utc_date()
    mfg = today if mfg == "today" else mfg
    exp = (str(int(today[:4]) + 2) + today[4:]) if exp == "+2y" else exp
    hdr = header_add(c, parent, qty, (ps or sl) if pb else sl, pb or bin_, category=sub.get("category", "Unrestricted"), batch_no=batch_no, mfg=mfg, exp=exp,
                     remarks=(sub.get("remark", "IA V2 live test " + tag), "", ""))
    by_mat, avail_of = availability(c, items, set(comps))
    pairs = []
    for i, m in enumerate(comps):
        it = items.get(m)
        if not it:
            c.fail(f"component {m} not found")
            continue
        row = base_row(it, i + 1, c, uoms)
        pl = typed_allocate(c, row, float(sub.get("component_qty", 1)) * qty, it, by_mat, c.plant)
        pairs.append((row, pl))
    for ns_id in add_ns:
        it = items.get(ns_id)
        if not it:
            c.fail(f"non-stock item {ns_id} not found")
            continue
        row = base_row(it, len(pairs) + 1, c, uoms)
        typed_allocate(c, row, float(sub.get("nonstock_qty", 1)) * qty, it, by_mat, c.plant)
        pairs.append((row, []))
    hdr["stock_movement"] = finish_rows(c, pairs, items, uoms)
    return write_out(c, tag, hdr, items, pairs, avail_of, v2=sub.get("v2", True))


def subject_k2(c, sub, tag):
    n = int(L.arg("--picks") or sub.get("picks", 2000))
    qty_line = float(sub.get("component_qty", 1))
    parent_id = L.digits(sub["parent"], "parent")
    rows = L.q("SELECT CAST(b.material_id AS CHAR) m, SUM(b.unrestricted_qty) u FROM item_balance b JOIN item i ON i.id = b.material_id AND i.tenant_id = b.tenant_id "
               f"WHERE b.{c.TQ} AND b.is_deleted = 0 AND b.plant_id = {c.plant} AND b.organization_id = '{c.org}' AND i.is_deleted = 0 AND i.stock_control = 1 "
               "AND i.serial_number_management = 0 AND i.item_batch_management = 0 AND i.material_costing_method = 'First In First Out' "
               f"GROUP BY b.material_id HAVING u >= {qty_line * 10} ORDER BY b.material_id")
    pool = [r["m"] for r in rows if r["m"] not in (L.EXCLUDED["material"], parent_id)]
    held = {h["lock_key"].split("|")[1] for h in held_locks(c, set(pool)) if "|" in h["lock_key"]}
    pool = [m for m in pool if m not in held]
    off = int(sub.get("offset", 0))
    if len(pool) < off + n:
        raise SystemExit(f"only {len(pool)} clean stocked items for {n} picks at offset {off}")
    comps = pool[off:off + n]
    items = read_items(c, [parent_id] + comps)
    uom_ids = set()
    for it in items.values():
        uom_ids |= {it.get("based_uom")} | {u["alt_uom_id"] for u in it["table_uom_conversion"]}
    uoms = read_uoms(c, uom_ids)
    parent = items[parent_id]
    sl, bin_ = plant_defaults(c)
    pb, ps = default_bin(parent, c.plant)
    hdr = header_add(c, parent, float(sub.get("qty", 1)), (ps or sl) if pb else sl, pb or bin_, remarks=("IA V2 live test " + tag + " (2,000 picks)", "", ""))
    by_mat, avail_of = availability(c, items, set(comps))
    pairs = []
    for i, m in enumerate(comps):
        row = base_row(items[m], i + 1, c, uoms)
        pairs.append((row, typed_allocate(c, row, qty_line, items[m], by_mat, c.plant)))
    hdr["stock_movement"] = finish_rows(c, pairs, items, uoms)
    if len(set(comps)) + 1 > 1000:
        c.warn(f"{len(set(comps)) + 1} distinct items: the posting fetch refuses more than 1,000 - never Complete & Post this IA")
    return write_out(c, tag, hdr, items, pairs, avail_of)


def subject_edit(c, tag):
    ia = L.digits(L.arg("--ia"), "--ia")
    h = L.q(f"SELECT * FROM sm_item_assembly WHERE {c.TQ} AND id = {ia} AND is_deleted = 0")
    if not h:
        raise SystemExit(f"IA {ia} not found in tenant {c.T}")
    lines = L.q(f"SELECT * FROM sm_item_assembly_tlm8ve69_sub WHERE {c.TQ} AND sm_item_assembly_id = {ia} AND is_deleted = 0 ORDER BY CAST(line_index AS UNSIGNED), id")
    hdr = L.api_row(h[0], "sm_item_assembly")
    clone = L.flag("--clone")
    page = "Clone" if clone else "Edit"
    hdr["page_status"] = page
    if clone:
        hdr.update({"batch_no": "", "item_assembly_status": hdr.get("item_assembly_status", "")})
        hdr.pop("manufacturing_date", None)
        hdr.pop("expired_date", None)
    rows = []
    for ln in lines:
        r = L.api_row(ln, "sm_item_assembly_tlm8ve69_sub", sub=True)
        r["fm_key"] = L.fm_key(str(r.get("id")))
        rows.append(r)
    hdr["stock_movement"] = rows
    hdr.setdefault("table_item_balance", [])
    hdr.setdefault("table_hu", [])
    hdr.update({"flex_2det1nd2": "", "button_draft": "", "button_completed": "", "comp_post_button": "", "button_post": "", "flex_t6y2yh5r": "", "$_v": 14})
    if hdr.get("item_assembly_status") != "Draft" and not clone:
        c.warn(f"stored status {hdr.get('item_assembly_status')!r}: SUBMIT answers NOT_ELIGIBLE / STALE / BUSY, the classic v12 refuses Processing")
    items = read_items(c, [hdr.get("item_id")] + [r.get("item_selection") for r in rows if r.get("item_selection")])
    pairs = []
    for r in rows:
        try:
            pl = json.loads(r.get("temp_qty_data") or "[]")
        except ValueError:
            pl = []
        pairs.append((r, [dict(p, batch_id=p.get("batch_id") or None, category=p.get("category") or "Unrestricted") for p in pl
                          if isinstance(p, dict) and float(p.get("sm_quantity") or 0) > 0]))
    by_mat, avail_of = availability(c, items, {r.get("item_selection") for r in rows if r.get("item_selection")})
    if clone:
        out = L.out_dir(tag)
        _, _, submit, status = requests_of(c, hdr, "Clone")
        L.write_json(os.path.join(out, "submit.json"), submit)
        L.write_json(os.path.join(out, "status.json"), status)
        print(f"{tag}: Clone of IA {ia} -> {out}/submit.json (pageStatus Clone, source ids kept), key {submit['idempotency_key']}")
        return 0
    return write_out(c, tag, hdr, items, pairs, avail_of, page="Edit", ia_id=ia)


def check(c):
    jobs = L.q("SELECT CAST(id AS CHAR) id, command, job_status, correlation_id FROM gd_async_job WHERE " + c.TQ + " AND is_deleted = 0 AND command IN "
               "('COMPLETE_IA', 'REVERT_IA') AND job_status IN ('QUEUED', 'VALIDATING', 'READY_TO_COMMIT', 'COMMITTING_IA', 'COMMITTING_REVERT', 'REQUIRES_REVIEW')")
    print(f"tenant {c.T}: open IA V2 jobs {len(jobs)} {[(j['id'], j['command'], j['job_status'], j['correlation_id']) for j in jobs][:6]}")
    proc = L.q(f"SELECT CAST(id AS CHAR) id, stock_movement_no FROM sm_item_assembly WHERE {c.TQ} AND is_deleted = 0 AND item_assembly_status = 'Processing'")
    print(f"   Processing IAs {len(proc)} {[(p['id'], p['stock_movement_no']) for p in proc][:6]}")
    held = L.q(f"SELECT COUNT(*) n FROM inventory_balance_lock WHERE {c.TQ} AND organization_id = '{c.org}' AND is_deleted = 0 AND (free_token IS NULL OR free_token <> 1)")
    print(f"   engine lock rows held in the organization now: {held[0]['n']}")
    snap = os.path.join(L.IAV2, "base", "snapshot.py")
    print(f"   base snapshots: run `python3 {os.path.relpath(snap, L.REPO)} --check` (dev moved since WP0?)")
    return 1 if jobs or proc else 0


def main():
    if len(sys.argv) < 2 or sys.argv[1] in ("-h", "--help"):
        raise SystemExit(__doc__)
    cfg = L.load_config()
    name = sys.argv[1]
    if name in ("edit", "check"):
        c = Ctx(cfg, L.digits(L.arg("--tenant"), "--tenant"))
        sys.exit(subject_edit(c, L.arg("--tag") or ("edit-" + L.arg("--ia", ""))) if name == "edit" else check(c))
    sub = cfg["subjects"].get(name)
    if not sub:
        raise SystemExit(f"unknown subject {name}: {sorted(k for k in cfg['subjects'] if not k.startswith('_'))}")
    c = Ctx(cfg, sub["tenant"])
    c.expect_reason = sub.get("expect_reason", "")
    tag = L.arg("--tag") or name
    fn = {"bom": subject_bom, "twin": subject_twin, "manual": subject_manual, "k2": subject_k2}[sub["kind"]]
    sys.exit(fn(c, sub, tag))


if __name__ == "__main__":
    main()

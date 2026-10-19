#!/usr/bin/env python3
"""Build a Location Transfer (LOT) save request {allData, saveAs, pageStatus: "Add"} in the shape the DEV web form
sm_location_transfer v107 sends to SM_LOCATION_TRANSFER (2013133675374927874), from DEV tenant 000000 stock. Read-only:
SELECTs through .dbtools/db (scratchpad/smv2/parity/dbq.py). Never runs a workflow.

usage:
  python3 build_lot_payload.py --lines 2000 --action Draft --out lot_2000_draft.json
      [--pool strict|putaway-items|a1b1-source] [--plant 1123598813738675202] [--qty 1] [--max-share 0.5]
      [--batch-lines N/50] [--two-bin-lines N/200] [--blocked 1] [--issue-date YYYY-MM-DD] [--issued-by Juna]
      [--seed 7] [--report report.json]
  --action Draft | "In Progress" | Completed  (pageStatus is always Add: a new document, as the form's Save buttons send it;
           Add + In Progress = STAGE: -cat@source, +In Transit@destination; Add + Completed = DIRECT: -cat@source, +cat@destination)
  --pool   strict        every exclusion of the Package E brief: plant 1123598813738675202 bins A1-B1 (both) and A1-B3, every item
                         on Putaway TRF-PA-20261016-0010 / -0011; also LB-01 (that test's putaway source bin) and the items
                         whose master row is tenant '0' (invisible to tenant 000000 workflow search nodes)
           putaway-items as strict, but the putaway docs' items are allowed (still never from/to A1-B1, A1-B3, LB-01)
           a1b1-source   as strict, but plant 1123598813738675202 A1-B1 may be a SOURCE bin (never a destination)
  Exit 3 = the pool cannot supply the request (prints what each pool holds).

Shape (derived 2026-10-16 from recorded web runs: prod 2026-09-28..10-16 = form v47, whose save / stock-dialog handlers equal
dev v107 for non-bundle lines - 84 Add saves, 229 lines, 238 entries - and dev tenant 000000 run 2105479699297112066):
  header   = the 45 keys of the recorded dev 000000 v107 request (status HTML badges, sm_item_balance dialog state, $_v, _vts,
             isTrusted, balance_index [], dialog_apply_location {}, table_sn_records [], reference_documents [] ...), with
             page_status "Add", stock_movement_status "", stock_movement_no "", stock_movement_no_type = the tenant's LOT rule
             (the workflow writes the 'draft' / 'issued' sentinel; the platform numbers the document)
  line     = the 31/32-key table line (item_desc only when the item has one); temp_qty_data = JSON string of the entries,
             temp_hu_data "[]", stock_summary as onConfirm_Stock formats it, uom_options = the item's UOM rows, unit_price =
             item.purchase_unit_price, requested_qty 0, total_quantity = sum of sm_quantity
  entry    = the balance row as the stock dialog holds it: non-batch = item_balance columns (non-null) + balance_id, category,
             unit_price, fm_key, sm_quantity (23 keys); batch = item_batch_balance columns incl. null dates / remarks + category,
             fm_key, sm_quantity (28 keys)
Mobile payloads differ (hand-built JSON) and are not produced here.
"""
import argparse, datetime, json, os, random, string, sys
from collections import OrderedDict, defaultdict
from decimal import Decimal

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "parity"))
from dbq import q  # noqa: E402

ENV = "--dev"
TENANT = "000000"
LOT_WF = "2013133675374927874"
TEMPLATE_RUN = "2105479699297112066"  # dev 000000 web LOT save, 2026-10-01 (form v107), pageStatus Add
AVOID_TO = ("TRF-PA-20261016-0010", "TRF-PA-20261016-0011")
FORBIDDEN_BIN_NAMES = {"1123598813738675202": {"A1-B1", "A1-B3"}}
EXTRA_EXCLUDED_BIN_NAMES = {"1123598813738675202": {"LB-01"}}
MAX_MOVEMENTS = 5000  # INVENTORY_BULK_APPLY guard: at most 5,000 movements per operation (two per LOT entry)
CAT_ABBR = {"Blocked": "BLK", "Reserved": "RES", "Unrestricted": "UNR", "Quality Inspection": "QIP", "In Transit": "INT"}
DIG = set("0123456789")
NB_KEYS = ("update_user", "intransit_qty", "is_deleted", "plant_id", "unrestricted_qty", "reserved_qty", "material_id", "balance_quantity", "create_user",
           "block_qty", "create_time", "material_uom", "qualityinsp_qty", "organization_id", "tenant_id", "location_id", "update_time", "create_dept")
B_KEYS = ("location_id", "organization_id", "remark", "block_qty", "intransit_qty", "remark3", "remark2", "tenant_id", "reserved_qty", "expired_date",
          "update_user", "plant_id", "update_time", "material_uom", "create_user", "batch_id", "unrestricted_qty", "create_time", "manufacturing_date",
          "material_id", "is_deleted", "doc_date", "balance_quantity", "qualityinsp_qty", "create_dept")
UOM_KEYS = ("create_time", "create_dept", "id", "create_user", "organization_id", "update_user", "tenant_id", "update_time", "uom_name", "sub_tenant_id", "is_deleted")
QTY_COLS = ("block_qty", "reserved_qty", "unrestricted_qty", "qualityinsp_qty", "intransit_qty", "balance_quantity")


def digits(v):
    v = "" if v is None else str(v)
    if not v or not set(v) <= DIG:
        raise SystemExit("not an id: " + v)
    return v


def ids_sql(ids):
    return ",".join(digits(i) for i in ids) or "0"


def num(v):
    """a decimal column the way the client API hands it to the form: a JS number"""
    if v is None:
        return None
    d = Decimal(str(v))
    return int(d) if d == d.to_integral_value() else float(d)


def jsnum(v):
    """String(number) in JS for the quantities the form prints in stock_summary"""
    return str(int(v)) if float(v) == int(float(v)) else repr(float(v))


def fm_key(rng):
    return "".join(rng.choice(string.ascii_lowercase + string.digits) for _ in range(8))


TS = "DATE_FORMAT({c}, '%Y-%m-%d %H:%i:%s.%f')"


def ts3(v):
    return None if v is None else str(v)[:23]


def load(args):
    plant = digits(args.plant)
    t = q(ENV, f"SELECT request_json_data FROM su_code_workflow_inst WHERE id={TEMPLATE_RUN} AND workflow_id={LOT_WF} AND tenant_id='{TENANT}'")
    if not t:
        raise SystemExit("template run " + TEMPLATE_RUN + " not found on dev")
    header = json.loads(t[0]["request_json_data"])["workflowparams"]["allData"]
    bins = q(ENV, f"SELECT CAST(id AS CHAR) id, bin_location_combine name, CAST(storage_location_id AS CHAR) sl, bin_status FROM bin_location "
                  f"WHERE tenant_id='{TENANT}' AND is_deleted=0 AND plant_id={plant}")
    avoid = {r["item"] for r in q(ENV, "SELECT DISTINCT CAST(s.item_code AS CHAR) item FROM transfer_order_putaway_jz8m9w3h_sub s JOIN transfer_order_putaway p "
                                       "ON p.id = s.transfer_order_putaway_id WHERE p.tenant_id='" + TENANT + "' AND p.to_id IN ('" + "','".join(AVOID_TO) + "') AND s.is_deleted=0")}
    nb = q(ENV, "SELECT CAST(id AS CHAR) id, CAST(update_user AS CHAR) update_user, CAST(intransit_qty AS CHAR) intransit_qty, is_deleted, CAST(plant_id AS CHAR) plant_id, "
                "CAST(unrestricted_qty AS CHAR) unrestricted_qty, CAST(reserved_qty AS CHAR) reserved_qty, CAST(material_id AS CHAR) material_id, "
                "CAST(balance_quantity AS CHAR) balance_quantity, CAST(create_user AS CHAR) create_user, CAST(block_qty AS CHAR) block_qty, " + TS.format(c="create_time") + " create_time, "
                "CAST(material_uom AS CHAR) material_uom, CAST(qualityinsp_qty AS CHAR) qualityinsp_qty, organization_id, tenant_id, CAST(location_id AS CHAR) location_id, "
                + TS.format(c="update_time") + " update_time, CAST(create_dept AS CHAR) create_dept, CAST(sub_tenant_id AS CHAR) sub_tenant_id "
                f"FROM item_balance WHERE tenant_id='{TENANT}' AND is_deleted=0 AND plant_id={plant} AND (unrestricted_qty > 0 OR block_qty > 0)")
    bb = q(ENV, "SELECT CAST(id AS CHAR) id, CAST(location_id AS CHAR) location_id, organization_id, remark, CAST(block_qty AS CHAR) block_qty, CAST(intransit_qty AS CHAR) intransit_qty, "
                "remark3, remark2, tenant_id, CAST(reserved_qty AS CHAR) reserved_qty, " + TS.format(c="expired_date") + " expired_date, CAST(update_user AS CHAR) update_user, "
                "CAST(plant_id AS CHAR) plant_id, " + TS.format(c="update_time") + " update_time, CAST(material_uom AS CHAR) material_uom, CAST(create_user AS CHAR) create_user, "
                "CAST(batch_id AS CHAR) batch_id, CAST(unrestricted_qty AS CHAR) unrestricted_qty, " + TS.format(c="create_time") + " create_time, "
                + TS.format(c="manufacturing_date") + " manufacturing_date, CAST(material_id AS CHAR) material_id, is_deleted, " + TS.format(c="doc_date") + " doc_date, "
                "CAST(balance_quantity AS CHAR) balance_quantity, CAST(qualityinsp_qty AS CHAR) qualityinsp_qty, CAST(create_dept AS CHAR) create_dept, CAST(sub_tenant_id AS CHAR) sub_tenant_id "
                f"FROM item_batch_balance WHERE tenant_id='{TENANT}' AND is_deleted=0 AND plant_id={plant} AND (unrestricted_qty > 0 OR block_qty > 0)")
    mats = sorted({r["material_id"] for r in nb + bb})
    items = {r["id"]: r for r in q(ENV, "SELECT CAST(id AS CHAR) id, material_code, material_name, material_desc, CAST(based_uom AS CHAR) based_uom, item_batch_management, stock_control, "
                                         "serial_number_management, material_costing_method, CAST(purchase_unit_price AS CHAR) purchase_unit_price, tenant_id, organization_id "
                                         f"FROM item WHERE is_deleted=0 AND id IN ({ids_sql(mats)})")}
    conv = defaultdict(list)
    for r in q(ENV, f"SELECT CAST(Item_id AS CHAR) item_id, CAST(alt_uom_id AS CHAR) alt_uom_id, CAST(base_qty AS CHAR) base_qty FROM item_mji552rc_sub WHERE is_deleted=0 AND Item_id IN ({ids_sql(mats)})"):
        conv[r["item_id"]].append(r)
    uom_ids = sorted({i["based_uom"] for i in items.values() if i["based_uom"]} | {c["alt_uom_id"] for cs in conv.values() for c in cs})
    uoms = {r["id"]: r for r in q(ENV, "SELECT " + TS.format(c="create_time") + " create_time, CAST(create_dept AS CHAR) create_dept, CAST(id AS CHAR) id, CAST(create_user AS CHAR) create_user, "
                                       "organization_id, CAST(update_user AS CHAR) update_user, tenant_id, " + TS.format(c="update_time") + " update_time, uom_name, "
                                       f"CAST(sub_tenant_id AS CHAR) sub_tenant_id, is_deleted FROM unit_of_measurement WHERE id IN ({ids_sql(uom_ids)})")}
    batch_ids = sorted({r["batch_id"] for r in bb if r["batch_id"]})
    batches = {r["id"]: r["batch_number"] for r in q(ENV, f"SELECT CAST(id AS CHAR) id, batch_number FROM batch WHERE id IN ({ids_sql(batch_ids)})")}
    cost = defaultdict(lambda: {"fifo": 0, "wa": 0})
    for tbl, k in (("fifo_costing_history", "fifo"), ("wa_costing_method", "wa")):
        for r in q(ENV, f"SELECT x.m, x.b, COUNT(*) n FROM (SELECT CAST(material_id AS CHAR) m, CAST(IFNULL(NULLIF(batch_id, 0), 0) AS CHAR) b FROM {tbl} "
                        f"WHERE tenant_id='{TENANT}' AND is_deleted=0 AND plant_id={plant} AND material_id IN ({ids_sql(mats)})) x GROUP BY x.m, x.b"):
            cost[(r["m"], "" if r["b"] == "0" else r["b"])][k] = int(r["n"])
    hu = defaultdict(Decimal)
    for r in q(ENV, "SELECT x.m, x.l, x.b, CAST(SUM(x.qty) AS CHAR) qty FROM (SELECT CAST(s.material_id AS CHAR) m, CAST(s.location_id AS CHAR) l, "
                    "CAST(IFNULL(s.batch_id, 0) AS CHAR) b, s.quantity qty FROM handling_unit_atu7sreg_sub s JOIN handling_unit h ON h.id = s.handling_unit_id "
                    f"WHERE s.is_deleted=0 AND h.is_deleted=0 AND h.tenant_id='{TENANT}' AND s.material_id IN ({ids_sql(mats)})) x GROUP BY x.m, x.l, x.b"):
        hu[(r["m"], r["l"], "" if r["b"] == "0" else r["b"])] += Decimal(r["qty"] or "0")
    return dict(header=header, bins=bins, avoid=avoid, nb=nb, bb=bb, items=items, conv=conv, uoms=uoms, batches=batches, cost=cost, hu=hu)


def pools(d, plant):
    """every (material, bin, batch, category) a LOT entry can draw, per pool, with the reason a key is out"""
    names = {b["id"]: b["name"] for b in d["bins"]}
    forbidden = {b["id"] for b in d["bins"] if b["name"] in FORBIDDEN_BIN_NAMES.get(plant, set())}
    extra = {b["id"] for b in d["bins"] if b["name"] in EXTRA_EXCLUDED_BIN_NAMES.get(plant, set())}
    a1b1 = {b["id"] for b in d["bins"] if b["name"] == "A1-B1"}
    dests = [b for b in d["bins"] if b["id"] not in forbidden and b["id"] not in extra and str(b["bin_status"]) == "1"]
    keys = []
    for kind, rows in (("nb", d["nb"]), ("b", d["bb"])):
        for r in rows:
            it = d["items"].get(r["material_id"])
            batch = (r.get("batch_id") or "") if kind == "b" else ""
            why = []
            if not it:
                why.append("item missing or deleted")
            else:
                if str(it["tenant_id"]) != TENANT:
                    why.append("item master tenant '" + str(it["tenant_id"]) + "' (invisible to tenant 000000 search nodes)")
                if int(it["stock_control"] or 0) != 1:
                    why.append("stock_control 0")
                if int(it["serial_number_management"] or 0) == 1:
                    why.append("serialized")
                if (kind == "b") != (int(it["item_batch_management"] or 0) == 1):
                    why.append("balance table does not match the item's batch management")
                c = d["cost"][(r["material_id"], batch)]
                m = it["material_costing_method"]
                if (c["wa"] and c["fifo"]) or (m == "First In First Out" and not c["fifo"] and c["wa"]) or (m == "Weighted Average" and not c["wa"] and c["fifo"]):
                    why.append("costing rows need migration (engine UNSUPPORTED_COSTING)")
                if m == "Weighted Average" and not c["wa"]:
                    why.append("WA item without a WA row (precheck refuses)")
            if d["hu"].get((r["material_id"], r["location_id"], batch)):
                why.append("HU-bound stock in the bin (kept out)")
            for cat, col in (("Unrestricted", "unrestricted_qty"), ("Blocked", "block_qty")):
                cap = Decimal(r[col] or "0")
                if cap <= 0:
                    continue
                keys.append({"row": r, "kind": kind, "material_id": r["material_id"], "bin": r["location_id"], "bin_name": names.get(r["location_id"], r["location_id"]),
                             "batch": batch, "category": cat, "cap": cap, "why": list(why),
                             "putaway_item": r["material_id"] in d["avoid"], "forbidden_bin": r["location_id"] in forbidden, "extra_bin": r["location_id"] in extra,
                             "a1b1": r["location_id"] in a1b1})
    return keys, dests


def eligible(k, pool):
    if k["why"] or k["extra_bin"]:
        return False
    if k["putaway_item"] and pool != "putaway-items":
        return False
    if k["forbidden_bin"] and not (pool == "a1b1-source" and k["a1b1"]):
        return False
    return True


def build(args):
    rng = random.Random(args.seed)
    d = load(args)
    plant = digits(args.plant)
    keys, dests = pools(d, plant)
    usable = [k for k in keys if eligible(k, args.pool)]
    qty = Decimal(str(args.qty))
    if qty <= 0:
        raise SystemExit("--qty must be > 0")
    summary = {}
    for pool in ("strict", "putaway-items", "a1b1-source"):
        ks = [k for k in keys if eligible(k, pool)]
        summary[pool] = {"keys": len(ks), "items": len({k["material_id"] for k in ks}),
                         "unrestricted": str(sum((k["cap"] for k in ks if k["category"] == "Unrestricted"), Decimal(0))),
                         "blocked": str(sum((k["cap"] for k in ks if k["category"] == "Blocked"), Decimal(0)))}
    share = Decimal(str(args.max_share))
    if not (Decimal(0) < share <= Decimal(1)):
        raise SystemExit("--max-share must be in (0, 1]")
    rem = {id(k): k["cap"] * share for k in usable}  # no line set takes more than this share of any balance
    unr_nb = [k for k in usable if k["category"] == "Unrestricted" and k["kind"] == "nb"]
    unr_b = [k for k in usable if k["category"] == "Unrestricted" and k["kind"] == "b"]
    blocked = [k for k in usable if k["category"] == "Blocked"]
    by_mat = defaultdict(list)
    for k in unr_nb + unr_b:
        by_mat[k["material_id"]].append(k)
    two_bin_mats = [m for m, ks in by_mat.items() if len({k["bin"] for k in ks}) >= 2]

    order = lambda k: (d["items"][k["material_id"]]["material_code"] or "", k["bin_name"], k["batch"], k["category"])
    for lst in (unr_nb, unr_b, blocked):
        lst.sort(key=order)
    cursor = {}

    def take(cands, tag):
        """round-robin over the candidates that can still give qty, so the lines spread over every item and bin"""
        n = len(cands)
        start = cursor.get(tag, 0)
        for i in range(n):
            k = cands[(start + i) % n]
            if rem[id(k)] >= qty:
                rem[id(k)] -= qty
                cursor[tag] = (start + i + 1) % n
                return k
        return None

    plan = []
    n_blocked = 1 if args.blocked and args.lines > 0 else 0
    n_two = min(args.two_bin_lines, max(0, args.lines - n_blocked))
    n_batch = min(args.batch_lines, max(0, args.lines - n_blocked - n_two))
    n_plain = args.lines - n_blocked - n_two - n_batch
    problems = []
    if n_blocked:
        k = take(blocked, "blocked")
        plan.append(("blocked", [k])) if k else problems.append("no Blocked stock in the pool (asked for one Blocked entry)")
    two_bin_mats.sort(key=lambda m: d["items"][m]["material_code"] or "")
    for j in range(n_two):
        mats = [m for m in two_bin_mats if len({k["bin"] for k in by_mat[m] if rem[id(k)] >= qty}) >= 2]
        if not mats:
            problems.append("no item with stock in two source bins left for a two-bin line")
            break
        m = mats[j % len(mats)]
        cands = sorted(by_mat[m], key=order)
        k1 = take(cands, "two:" + m)
        k2 = take([k for k in cands if k["bin"] != k1["bin"]], "two2:" + m)
        plan.append(("two-bin", [k1, k2]))
    for _ in range(n_batch):
        k = take(unr_b, "batch")
        if not k:
            problems.append("batch stock exhausted after %d batch lines" % sum(1 for p in plan if p[0] == "batch"))
            break
        plan.append(("batch", [k]))
    for _ in range(n_plain):
        k = take(unr_nb, "plain") or take(unr_b, "plain-batch")
        if not k:
            problems.append("stock exhausted after %d lines (pool %s, qty %s per entry)" % (len(plan), args.pool, qty))
            break
        plan.append(("plain", [k]))
    entries = sum(len(p[1]) for p in plan)
    if problems or len(plan) != args.lines:
        print(json.dumps({"error": problems or ["could not build the lines"], "asked": args.lines, "built": len(plan), "pool": args.pool, "pools": summary}, indent=1), file=sys.stderr)
        sys.exit(3)
    if 2 * entries > MAX_MOVEMENTS:
        print("warning: %d entries = %d engine movements > INVENTORY_BULK_APPLY's %d per operation" % (entries, 2 * entries, MAX_MOVEMENTS), file=sys.stderr)
    rng.shuffle(plan)

    # ------------------------------------------------------------------------------------------------- lines
    org = str(d["header"].get("organization_id"))
    lines = []
    for n, (kind, ks) in enumerate(plan):
        it = d["items"][ks[0]["material_id"]]
        src = {k["bin"] for k in ks}
        choices = [b for b in dests if b["id"] not in src]
        if not choices:
            raise SystemExit("no destination bin outside the source bins " + ",".join(src))
        dest = choices[n % len(choices)]
        ents = []
        for k in ks:
            r = k["row"]
            if k["kind"] == "nb":
                e = OrderedDict((c, num(r[c]) if c in QTY_COLS or c == "is_deleted" else ts3(r[c]) if c in ("create_time", "update_time") else r[c]) for c in NB_KEYS)
                if r.get("sub_tenant_id"):
                    e["sub_tenant_id"] = r["sub_tenant_id"]
                e["balance_id"] = r["id"]
                e["category"] = k["category"]
                e["unit_price"] = num(it["purchase_unit_price"] or 0)
            else:
                e = OrderedDict()
                for c in B_KEYS:
                    v = r[c]
                    e[c] = num(v) if c in QTY_COLS or c == "is_deleted" else ts3(v) if c.endswith("_time") or c.endswith("_date") else v
                if r.get("sub_tenant_id"):
                    e["sub_tenant_id"] = r["sub_tenant_id"]
                e["category"] = k["category"]
            e["fm_key"] = fm_key(rng)
            e["sm_quantity"] = num(qty)
            ents.append(e)
        uom = it["based_uom"]
        uname = (d["uoms"].get(uom) or {}).get("uom_name") or uom
        total = num(sum((Decimal(str(e["sm_quantity"])) for e in ents), Decimal(0)))
        det = []
        for i, (e, k) in enumerate(zip(ents, ks)):
            line = "%d. %s: %s %s (%s)" % (i + 1, k["bin_name"], jsnum(e["sm_quantity"]), uname, CAT_ABBR.get(k["category"], k["category"]))
            if k["batch"]:
                line += "\n[" + (d["batches"].get(k["batch"]) or k["batch"]) + "]"
            det.append(line)
        uom_rows = []
        for uid in [uom] + [c["alt_uom_id"] for c in d["conv"].get(it["id"], []) if c["alt_uom_id"] != uom]:
            u = d["uoms"].get(uid)
            if u:
                uom_rows.append(OrderedDict((c, (num(u[c]) if c == "is_deleted" else ts3(u[c]) if c.endswith("_time") else u[c])) for c in UOM_KEYS if not (c == "sub_tenant_id" and u.get(c) is None)))
        L = OrderedDict()
        L["item_selection"] = it["id"]
        L["item_name"] = it["material_name"] or it["material_code"]
        if it.get("material_desc"):
            L["item_desc"] = it["material_desc"]
        L["requested_qty"] = 0
        L["total_quantity"] = total
        L["quantity_uom"] = uom
        L["storage_location_id"] = dest["sl"]
        L["location_id"] = dest["id"]
        L["stock_summary"] = "Total: %s %s\n\nDETAILS:\n%s" % (jsnum(total), uname, "\n".join(det))
        for c in ("item_remark", "item_remark2", "item_remark3", "balance_id", "organization_id", "line_index"):
            L[c] = ""
        L["temp_qty_data"] = json.dumps(ents, ensure_ascii=False, separators=(",", ":"))
        L["temp_hu_data"] = "[]"
        L["temp_excess_data"] = ""
        L["uom_options"] = uom_rows
        for c in ("issuing_plant", "receiving_plant"):
            L[c] = ""
        L["is_serialized_item"] = 0
        L["is_serial_allocated"] = 0
        L["project_id"] = ""
        L["item_bundle_id"] = ""
        L["bundle_ratio"] = 0
        L["fm_key"] = fm_key(rng)
        L["category"] = "Unrestricted"
        L["received_quantity_uom"] = uom
        L["unit_price"] = num(it["purchase_unit_price"] or 0)
        L["to_recv_qty"] = 0
        L["received_quantity"] = 0
        lines.append((L, ents, ks, kind))

    # ------------------------------------------------------------------------------------------------- header
    h = OrderedDict()
    now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8)))
    for c, v in d["header"].items():
        h[c] = v
    last, last_ents, last_ks, _ = lines[-1]
    last_item = d["items"][last["item_selection"]]
    h.update({
        "isTrusted": True, "_vts": int(now.timestamp() * 1000), "stock_movement_status": "", "task_status": "", "posted_status": "", "page_status": "Add",
        "issuing_operation_faci": plant, "issue_date": args.issue_date or now.strftime("%Y-%m-%d"), "stock_movement_no": "",
        "movement_type": "Location Transfer", "movement_type_id": "", "movement_reason": "", "issued_by": args.issued_by, "project_id": "",
        "reference_documents": [], "receiving_operation_faci": "", "movement_id": "", "organization_id": org, "acc_integration_type": "",
        "is_production_order": 0, "production_order_id": "", "process_id": "", "table_sn_records": [], "remarks": "", "remark": "", "remark2": "", "remark3": "",
        "balance_index": [], "dialog_apply_location": {"apply_storage_location_id": "", "apply_location_id": ""}, "$_v": 3 * len(lines) + 7, "error_message": "",
    })
    # the stock dialog as the last confirm left it (the form sends it with every save)
    dialog_rows = []
    for e in last_ents:
        x = OrderedDict(e)
        dialog_rows.append(x)
    sib = OrderedDict(h.get("sm_item_balance") or {})
    sib.update({"material_id": last_item["material_code"], "material_name": last_item["material_name"], "row_index": last["fm_key"], "material_uom": last["quantity_uom"],
                "required_qty": 0, "table_item_balance": dialog_rows, "table_hu": []})
    h["sm_item_balance"] = sib
    h["stock_movement"] = [x[0] for x in lines]
    req = OrderedDict([("allData", h), ("saveAs", args.action), ("pageStatus", "Add")])

    # ------------------------------------------------------------------------------------------------- report
    use = defaultdict(Decimal)
    for _, ents, ks, _ in lines:
        for e, k in zip(ents, ks):
            use[id(k)] += Decimal(str(e["sm_quantity"]))
    consumed = []
    for k in usable:
        if use[id(k)]:
            it = d["items"][k["material_id"]]
            consumed.append({"material_id": k["material_id"], "material_code": it["material_code"], "bin": k["bin_name"], "bin_id": k["bin"],
                             "batch_id": k["batch"] or None, "batch_number": d["batches"].get(k["batch"]) if k["batch"] else None, "category": k["category"],
                             "available": str(k["cap"]), "moved": str(use[id(k)]), "left": str(k["cap"] - use[id(k)]), "putaway_item": k["putaway_item"]})
    consumed.sort(key=lambda x: (x["material_code"], x["bin"], x["batch_number"] or "", x["category"]))
    report = {"action": args.action, "pool": args.pool, "lines": len(lines), "entries": entries, "engine_movements": 2 * entries,
              "line_kinds": {kd: sum(1 for x in lines if x[3] == kd) for kd in ("plain", "batch", "two-bin", "blocked")},
              "destinations": sorted({x[0]["location_id"] for x in lines}), "stock_moved_on_in_progress_or_completed": consumed, "pools": summary,
              "note": "Draft moves no stock; In Progress = STAGE (-cat@source, +In Transit@destination), Completed = DIRECT (-cat@source, +cat@destination)"}
    return req, report


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--lines", type=int, required=True)
    ap.add_argument("--action", required=True, choices=["Draft", "In Progress", "Completed"])
    ap.add_argument("--out", required=True)
    ap.add_argument("--pool", default="strict", choices=["strict", "putaway-items", "a1b1-source"])
    ap.add_argument("--plant", default="1123598813738675202")
    ap.add_argument("--qty", default="1")
    ap.add_argument("--max-share", default="0.5")  # at most this share of any (material, bin, batch, category) balance
    ap.add_argument("--batch-lines", type=int, default=None)  # default max(1, N // 50): 40 of 2,000
    ap.add_argument("--two-bin-lines", type=int, default=None)  # default max(1, N // 200): 10 of 2,000
    ap.add_argument("--blocked", type=int, default=1)
    ap.add_argument("--issue-date", default=None)
    ap.add_argument("--issued-by", default="Juna")  # junaxanto, the user runwf.mjs runs as
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--report", default=None)
    args = ap.parse_args()
    if args.lines < 1:
        raise SystemExit("--lines must be >= 1")
    if args.batch_lines is None:
        args.batch_lines = max(1, args.lines // 50)
    if args.two_bin_lines is None:
        args.two_bin_lines = max(1, args.lines // 200)
    req, report = build(args)
    text = json.dumps(req, ensure_ascii=False, separators=(",", ":"))
    with open(args.out, "w") as fh:
        fh.write(text)
    report["request_bytes"] = len(text.encode("utf-8"))
    if args.report:
        json.dump(report, open(args.report, "w"), ensure_ascii=False, indent=1)
    print("%s: %d lines (%s), %d entries = %d engine movements, saveAs %s, pageStatus Add, pool %s, %.1f KB"
          % (args.out, report["lines"], ", ".join("%s %d" % kv for kv in report["line_kinds"].items()), report["entries"], report["engine_movements"],
             args.action, args.pool, report["request_bytes"] / 1024))
    for c in report["stock_moved_on_in_progress_or_completed"]:
        print("  %-24s %-20s %-18s %-12s moved %-8s of %-10s%s" % (c["material_code"], c["bin"], c["batch_number"] or "-", c["category"], c["moved"], c["available"],
                                                                  "  (putaway item)" if c["putaway_item"] else ""))


if __name__ == "__main__":
    main()

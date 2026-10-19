"""Build (read-only) the request bodies of the SA V2 live twin tests (RUNBOOK steps T1, T2, T3, F1) from the dev rows of the
SAV2T test items. Every request is written to <out_dir>/<step>/ (session scratchpad) with a manifest.json holding the
designed movements (the expected per-key deltas diff_twins.py --expect checks each twin against). Nothing is sent anywhere.

  python3 build_twins.py t1                         T1 A (classic STOCK_ADJUSTMENT Add, Completed) + B (SA_V2_SUBMIT DIRECT)
  python3 build_twins.py t2-drafts                  T2: the two identical Draft adds (STOCK_ADJUSTMENT saveAs Draft, Add)
  python3 build_twins.py t2 --sa-a ID --sa-b ID     T2 A (classic Completed, Edit) + B (SUBMIT COMPLETE), same edits on both
  python3 build_twins.py t3-issue                   T3: the two identical Stock Counts (STOCK_COUNT saveAs Issued, Add)
  python3 build_twins.py t3-count --sc-a ID --sc-b ID     the counts (STOCK_COUNT saveAs "Stock Count", Edit)
  python3 build_twins.py t3-review --sc-a ID --sc-b ID    A = classic Review (STOCK_COUNT Review, createAdjustment Yes),
                                                          B = SUBMIT REVIEW
  python3 build_twins.py t3-complete-a --sa ID     A's second call: STOCK_ADJUSTMENT {allData: the review's Draft SA as
                                                    SCsaveReviewWorkflow.js fetches it, Completed, Edit}
  python3 build_twins.py f1                         F1: SUBMIT DIRECT whose Out exceeds the stock (+ one valid In)
  python3 build_twins.py worker --job ID --out F    {job_id}            (SA_V2_WORKER)
  python3 build_twins.py status (--key K | --sa ID | --sc ID) --out F   SUBMIT operation STATUS (writes nothing on the platform)
  python3 build_twins.py docs                       read-only: the SAs / SCs naming a SAV2T item (a Draft add answers no id) + their jobs
  python3 build_twins.py ans FILE.out.json          the essentials of a runas answer
  python3 build_twins.py dry-state --out F          the expected post-seed rows as a snap.py snapshot (fake ids)
Options: --dry (synthetic post-seed rows + fake ids: offline shape checks before the items exist), --config, --out-dir."""
import copy, datetime, json, os, sys
from decimal import Decimal

HERE = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True
sys.path.insert(0, HERE)
import twinlib as L  # noqa: E402
from twinlib import jsnum  # noqa: E402

# ------------------------------------------------------------------------------------------------ the designed documents
# (item key, line UOM, unit_price or None (Out-only line: the form hides the field), [(movement, bin, qty in the line UOM, batch?)])
T1_LINES = [
    ("fifo", "PCS", 7, [("In", "b1", 10, False)]),                          # FIFO In priced -> new layer 10 @ 7
    ("fifo", "PCS", None, [("Out", "b1", 5, False)]),                       # FIFO Out on the same key (In then Out, in order) -> seq 1
    ("wa", "PCS", None, [("Out", "b1", 5, False)]),                         # WA Out at the average (15)
    ("wa", "PCS", 12, [("In", "b2", 10, False)]),                           # WA In priced: re-average to 14.8537 ...
    ("wa", "PCS", 18, [("In", "b2", 10, False)]),                           # ... same key again (duplicate): back to 15.0000
    ("fifob", "PCS", 8, [("In", "b1", 6, True), ("Out", "b2", 4, True)]),   # batch In + Out in one line
    ("alt", "BOX", 60, [("Out", "b1", 1, False), ("In", "b2", 2, False)]),  # alternate UOM: 1 BOX = 10 PCS out, 2 BOX = 20 PCS in
]
T2_LINES = [
    ("fifo", "PCS", 9, [("In", "b2", 4, False)]),
    ("wa", "PCS", None, [("Out", "b2", 3, False)]),                         # edited at completion: 3 -> 4
    ("fifob", "PCS", None, [("Out", "b1", 2, True)]),
    ("alt", "BOX", None, [("Out", "b2", 1, False)]),
]
T2_EDIT_LINE, T2_EDIT_QTY = 2, 4   # line_index 2 (WA Out) -> 4; + adjustment_date -> the day before
# (item key, bin, batch?, variance in base PCS); 0 = approved without a variance (no SA entry, still Adjusted)
T3_SC = [("fifo", "b1", False, 3), ("fifo", "b2", False, -2), ("wa", "b1", False, -1), ("wa", "b2", False, 2),
         ("fifob", "b2", True, 1), ("fifob", "b1", True, -1), ("alt", "b1", False, -3), ("alt", "b2", False, 0)]
F1_LINES = [("wa", "PCS", 15, [("In", "b1", 1, False)]),                    # valid: proves all-or-nothing (must NOT move)
            ("fifo", "PCS", None, [("Out", "b1", "unrestricted+1", False)])]  # exceeds the bin's stock -> engine INSUFFICIENT
REMARK = "SA V2 live test {} (twin)"

DRY_IDS = {"fifo": "9100000000000000001", "wa": "9100000000000000002", "fifob": "9100000000000000003", "alt": "9100000000000000004"}
DRY_BATCH = "9300000000000000001"


# ------------------------------------------------------------------------------------------------ state: live (read-only) or dry
class State:
    def __init__(self, cfg, dry=False):
        self.cfg, self.dry = cfg, dry
        self.t, self.org, self.plant = cfg["tenant_id"], cfg["organization_id"], cfg["plant_id"]
        if dry:
            cfg = copy.deepcopy(cfg)
            for k, i in DRY_IDS.items():
                cfg["items"][k]["id"] = i
            cfg["items"]["fifob"]["batch_id"] = DRY_BATCH
            self.cfg = cfg
        self.it = L.items_of(self.cfg)
        self.mats = [i["id"] for i in self.it.values()]

    # items with their UOM conversions
    def items(self):
        if self.dry:
            out = {}
            for k, i in self.it.items():
                out[k] = {"id": i["id"], "code": i["code"], "name": i["name"], "desc": "SA V2 live twin test item (package F) - test only",
                          "category": self.cfg["category"][i["method"]], "method": i["method"], "batch": int(i["batch"]), "base_uom": self.cfg["uom"]["PCS"],
                          "conv": {self.cfg["uom"]["BOX"]: 10} if i.get("alt") else {}}
            return out
        rows = L.q("SELECT CAST(id AS CHAR) id, material_code, material_name, material_desc, CAST(item_category AS CHAR) item_category, material_costing_method, "
                   f"item_batch_management, CAST(based_uom AS CHAR) based_uom FROM item WHERE tenant_id='{self.t}' AND is_deleted=0 AND id IN ({','.join(self.mats)})")
        conv = L.q("SELECT CAST(item_id AS CHAR) item_id, CAST(alt_uom_id AS CHAR) alt, CAST(base_qty AS CHAR) bq FROM item_mji552rc_sub "
                   f"WHERE tenant_id='{self.t}' AND is_deleted=0 AND item_id IN ({','.join(self.mats)})")
        by = {r["id"]: r for r in rows}
        out = {}
        for k, i in self.it.items():
            r = by.get(i["id"])
            if not r or r["material_code"] != i["code"]:
                raise SystemExit(f"item {k} {i['id']} is not {i['code']} in tenant {self.t}")
            cv = {c["alt"]: float(c["bq"]) for c in conv if c["item_id"] == i["id"] and c["alt"] != r["based_uom"]}
            out[k] = {"id": i["id"], "code": r["material_code"], "name": r["material_name"] or "", "desc": r["material_desc"] or "", "category": r["item_category"],
                      "method": r["material_costing_method"], "batch": int(r["item_batch_management"] or 0), "base_uom": r["based_uom"], "conv": cv}
        return out

    def _dry_row(self, table, mat, loc, batch=None, n=0):
        now = "2026-10-16 21:30:00.123000"
        r = {"id": int(("9210" if batch else "9200") + "%015d" % n), "material_id": int(mat), "location_id": int(loc), "block_qty": "0.00000000",
             "reserved_qty": "0.00000000", "unrestricted_qty": "100.00000000", "qualityinsp_qty": "0.00000000", "balance_quantity": "100.00000000",
             "create_user": 2084101916223139841, "create_dept": int(self.org), "create_time": now, "update_user": 2084101916223139841, "update_time": now,
             "is_deleted": 0, "tenant_id": self.t, "plant_id": int(self.plant), "organization_id": self.org, "intransit_qty": "0.00000000",
             "material_uom": int(self.cfg["uom"]["PCS"]), "sub_tenant_id": int(self.org)}
        if batch:
            r.update({"batch_id": int(batch), "doc_date": "2026-10-16 00:00:00", "expired_date": None, "manufacturing_date": None, "remark": None, "remark2": None,
                      "remark3": None})
        else:
            r["bin_location_combine_d_n4h1t"] = None
        return r

    def balances(self):
        """{(mat, loc): row} item_balance; rows as SELECT * returns them"""
        if self.dry:
            out, n = {}, 0
            for k, i in self.it.items():
                for b in ("b1", "b2"):
                    n += 1
                    out[(i["id"], self.cfg["bins"][b])] = self._dry_row("item_balance", i["id"], self.cfg["bins"][b], n=n)
            return out
        rows = L.select_all("item_balance", f"tenant_id='{self.t}' AND is_deleted=0 AND plant_id={self.plant} AND material_id IN ({','.join(self.mats)})")
        return self._uniq(rows, lambda r: (str(r["material_id"]), str(r["location_id"])), "item_balance")

    def batch_balances(self):
        if self.dry:
            fb = self.it["fifob"]
            return {(fb["id"], self.cfg["bins"][b], DRY_BATCH): self._dry_row("item_batch_balance", fb["id"], self.cfg["bins"][b], DRY_BATCH, n)
                    for n, b in ((1, "b1"), (2, "b2"))}
        rows = L.select_all("item_batch_balance", f"tenant_id='{self.t}' AND is_deleted=0 AND plant_id={self.plant} AND material_id IN ({','.join(self.mats)})")
        return self._uniq(rows, lambda r: (str(r["material_id"]), str(r["location_id"]), str(r["batch_id"])), "item_batch_balance")

    @staticmethod
    def _uniq(rows, key, what):
        out = {}
        for r in rows:
            k = key(r)
            if k in out:
                raise SystemExit(f"two {what} rows for {k}: the engine refuses DUPLICATE_BALANCE - fix the data first")
            out[k] = r
        return out

    def names(self):
        bins = {v: k for k, v in self.cfg["bins"].items() if not k.startswith("_")}
        if self.dry:
            return ({self.cfg["bins"]["b1"]: "Test-Batch-S2", self.cfg["bins"]["b2"]: "Sealing Head Assembly"}, {DRY_BATCH: self.cfg["items"]["fifob"]["batch_number"]},
                    {self.cfg["uom"]["PCS"]: "PCS", self.cfg["uom"]["BOX"]: "BOX"})
        b = {r["id"]: r["n"] for r in L.q(f"SELECT CAST(id AS CHAR) id, bin_location_combine n FROM bin_location WHERE tenant_id='{self.t}' AND id IN ({','.join(bins)})")}
        bt = {r["id"]: r["n"] for r in L.q(f"SELECT CAST(id AS CHAR) id, batch_number n FROM batch WHERE tenant_id='{self.t}' AND material_id IN ({','.join(self.mats)})")}
        u = {r["id"]: r["n"] for r in L.q(f"SELECT CAST(id AS CHAR) id, uom_name n FROM unit_of_measurement WHERE tenant_id='{self.t}' AND id IN "
                                          f"({','.join(v for v in self.cfg['uom'].values())})")}
        return b, bt, u

    def ui(self, kind):
        """the recorded web run's UI-only keys (badges, layout widgets, $_v ...): what getValues() carries besides the record"""
        rec = self.cfg["recorded"][kind]
        cache = os.path.join(L.out_dir(self.cfg, "rec"), kind + ".json")
        if os.path.exists(cache):
            with open(cache) as fh:
                return json.load(fh)
        wf = self.cfg["workflows"]["STOCK_ADJUSTMENT" if kind.startswith("sa") else "STOCK_COUNT"]
        try:
            r = L.q(f"SELECT request_json_data FROM su_code_workflow_inst WHERE workflow_id={wf} AND id={L.digits(rec, kind)}")
            ad = json.loads(r[0]["request_json_data"])["workflowparams"]["allData"]
        except Exception as e:  # noqa: BLE001
            print(f"  (recorded run {rec} unreadable: {e} - UI keys left out)")
            return {}
        keep = {k: v for k, v in ad.items() if k in ("isTrusted", "_vts", "$_v") or k.endswith("_status") and isinstance(v, str) and v.startswith("<")
                or k.startswith(("flex_", "utext_", "button_")) or k in ("log_button", "dialog_select_stock")}
        L.write_json(cache, keep)
        return keep

    def sa(self, sa_id):
        if self.dry:
            raise SystemExit("stored documents do not exist in --dry")
        h = L.select_all("stock_adjustment", f"tenant_id='{self.t}' AND id={L.digits(sa_id, 'sa id')}")
        if not h:
            raise SystemExit(f"no Stock Adjustment {sa_id} in tenant {self.t}")
        lines = L.select_all("stock_adjustment_1dknywqh_sub", f"tenant_id='{self.t}' AND is_deleted=0 AND stock_adjustment_id={sa_id}",
                             "CAST(line_index AS UNSIGNED), id")
        return h[0], lines

    def sc(self, sc_id):
        if self.dry:
            raise SystemExit("stored documents do not exist in --dry")
        h = L.select_all("stock_count", f"tenant_id='{self.t}' AND id={L.digits(sc_id, 'sc id')}")
        if not h:
            raise SystemExit(f"no Stock Count {sc_id} in tenant {self.t}")
        lines = L.select_all("stock_count_h4c9e1cl_sub", f"tenant_id='{self.t}' AND is_deleted=0 AND stock_count_id={sc_id}", "CAST(line_index AS UNSIGNED), id")
        return h[0], lines

    def dates(self):
        if self.dry:
            return "2026-10-16", "2026-10-16"
        return L.today_text(), L.utc_date_text()


# ------------------------------------------------------------------------------------------------ SA form documents
def base_qty(item, uom_key, qty, cfg):
    return Decimal(str(qty)) * Decimal(str(item["conv"].get(cfg["uom"][uom_key], 1))) if uom_key != "PCS" else Decimal(str(qty))


def sa_lines(st, plan, tag, expected):
    """the form's stock_adjustment lines (as the dialog leaves them) + the expected per-key moves"""
    cfg = st.cfg
    items, bals, bbals = st.items(), st.balances(), st.batch_balances()
    bin_names, batch_names, uom_names = st.names()
    lines = []
    for n, (key, uom_key, price, ents) in enumerate(plan):
        it = items[key]
        uom = cfg["uom"][uom_key]
        factor = it["conv"].get(uom, 1) if uom_key != "PCS" else 1
        entries = []
        for j, (mt, bin_key, qty, batch) in enumerate(ents):
            loc = cfg["bins"][bin_key]
            bid = cfg["items"]["fifob"]["batch_id"] if batch else None
            row = bbals.get((it["id"], loc, str(bid))) if batch else bals.get((it["id"], loc))
            if row is None:
                raise SystemExit(f"{tag} line {n + 1}: no {'batch ' if batch else ''}balance row for {it['code']} in {bin_key} - seed first")
            if qty == "unrestricted+1":
                qty = jsnum(Decimal(str(row["unrestricted_qty"])) / Decimal(str(factor)) + 1)
            e = L.entry_of(row, "item_batch_balance" if batch else "item_balance", mt, qty, factor, seed=f"{tag}|{n}|{j}")
            entries.append(e)
            bq = base_qty(it, uom_key, qty, cfg)
            sign = 1 if mt == "In" else -1
            k_ib = f"{it['id']}|{loc}"
            expected["ib"][k_ib] = str(Decimal(expected["ib"].get(k_ib, "0")) + sign * bq)
            if batch:
                k_bb = f"{it['id']}|{loc}|{bid}"
                expected["ibb"][k_bb] = str(Decimal(expected["ibb"].get(k_bb, "0")) + sign * bq)
            expected["mv"].append({"item_id": it["id"], "bin": loc, "batch": str(bid) if bid else "", "movement": "IN" if mt == "In" else "OUT",
                                   "quantity": str(Decimal(str(qty))), "base_qty": str(bq), "uom_id": uom, "unit_price_in": str(price) if mt == "In" else None})
            if mt == "In" and it["method"] == L.FIFO:
                expected["fifo_new"].setdefault(f"{it['id']}|{bid or ''}", []).append([str(bq), str(price)])
            if it["method"] == L.WA:
                expected["wa_qty"][it["id"]] = str(Decimal(expected["wa_qty"].get(it["id"], "0")) + sign * bq)
        total = sum(Decimal(str(e["sa_quantity"])) for e in entries)
        line = {"material_id": it["id"], "uom_id": uom, "material_name": it["name"], "material_desc": it["desc"], "item_category": it["category"],
                "fm_key": L.fm_key(f"{tag}|line|{n}"), "adjustment_reason": "", "total_quantity": jsnum(total),
                "balance_index": L.bi_text(entries), "adj_summary": L.adj_summary(entries, uom_names.get(uom, uom_key), bin_names, batch_names),
                "adjustment_remarks": "", "item_remark": "", "item_remark2": "", "item_remark3": "", "project_id": "", "is_serialized_item": 0, "is_single_serial": 0}
        if any(e["movement_type"] == "In" for e in entries):
            line["unit_price"] = price
        lines.append(line)
    return lines


def new_expected():
    return {"ib": {}, "ibb": {}, "mv": [], "fifo_new": {}, "wa_qty": {}}


def sa_form_add(st, lines, remark, date):
    """getValues() of a new SA form (Add) after the lines were entered: the recorded 496474 Add's keys"""
    cfg = st.cfg
    ui = st.ui("sa_add_completed")
    last = lines[-1]
    f = dict(ui)
    f.update({"stock_adjustment_status": "", "page_status": "Add", "posted_status": "", "plant_id": cfg["plant_id"], "adjustment_no": "",
              "adjustment_no_type": cfg["rules"]["sa"], "adjustment_date": date, "adjustment_type": "Stock Count", "stock_count_id": "",
              "adjusted_by": cfg["nickname"], "organization_id": cfg["organization_id"], "acc_integration_type": cfg["acc_integration_type"], "previous_status": "",
              "project_id": "", "reference_documents": [], "adjustment_remarks": remark, "adjustment_remarks2": "", "adjustment_remarks3": "", "stock_adjustment": lines,
              "sa_item_balance": {"material_id": last["material_name"], "material_name": last["material_name"], "material_uom": last["uom_id"], "current_table_uom": "",
                                  "row_index": len(lines) - 1, "is_serialized": 0, "table_item_balance_raw": "", "search_batch": "", "flex_palvd55h": "",
                                  "table_item_balance": json.loads(last["balance_index"])},
              "error_message": "", "_data": {"is_processing": 1}})
    return f


def sa_form_edit(st, hdr, lines):
    """getValues() of a stored SA opened in Edit: the record as the db API loads it + the UI keys"""
    ui = st.ui("sa_add_completed")
    f = dict(ui)
    f.update(L.api_row(hdr, "stock_adjustment"))
    f["stock_adjustment"] = [L.api_row(r, "stock_adjustment_1dknywqh_sub", sub=True) for r in lines]
    f.update({"page_status": "Edit", "error_message": "", "_data": {"is_processing": 1}})
    return f


def submit_form(cfg, page, form, sa_id="", key=None, token_tag="t"):
    record = L.record_of(form, L.SA_NOT_RECORD)
    doc = sa_id if page == "Edit" else "new-" + L.page_token(token_tag)
    key = key or L.sa_key(cfg["organization_id"], doc, page, record)
    return {"operation": "SUBMIT", "source": "FORM", "saveAs": "Completed", "pageStatus": page, "sa_id": sa_id if page == "Edit" else "", "sc_id": "",
            "idempotency_key": key, "form": record, "organization_id": cfg["organization_id"], "nickname": "", "adjustment_date": "", "create_adjustment": ""}


def status_req(cfg, key="", sa_id="", sc_id="", source="FORM"):
    return {"operation": "STATUS", "source": source, "saveAs": "Completed", "pageStatus": "Edit", "sa_id": sa_id or ("0" if source == "FORM" else ""),
            "sc_id": sc_id, "idempotency_key": key, "form": {}, "organization_id": cfg["organization_id"], "nickname": "", "adjustment_date": "", "create_adjustment": ""}


def step_dir(st, name):
    return L.out_dir(st.cfg, name + ("-dry" if st.dry else ""))


def runas(cfg, wf_name, path):
    return f"node scratchpad/gdc/tools/runas.mjs {cfg['identity']} {cfg['workflows'][wf_name]} {path} {path[:-5]}.out.json"


def manifest(out, step, files, expected, notes, cfg, st):
    m = {"step": step, "dry": st.dry, "built_at": datetime.datetime.now().isoformat(timespec="seconds"), "tenant": cfg["tenant_id"], "plant": cfg["plant_id"],
         "materials": {k: i["id"] for k, i in st.it.items()}, "bins": {k: v for k, v in cfg["bins"].items() if not k.startswith("_")},
         "batch_id": st.cfg["items"]["fifob"]["batch_id"], "files": files, "expected_per_twin": expected, "notes": notes}
    L.write_json(os.path.join(out, "manifest.json"), m)
    return m


def show(cfg, out, files):
    for f, (wf, what) in files.items():
        print(f"  {what}")
        print(f"    {runas(cfg, wf, os.path.join(out, f))}" if wf else f"    {os.path.join(out, f)}")


# ------------------------------------------------------------------------------------------------ steps
def t1(st):
    cfg = st.cfg
    out = step_dir(st, "t1")
    date, _ = st.dates()
    exp = new_expected()
    lines = sa_lines(st, T1_LINES, "t1", exp)
    form = sa_form_add(st, lines, REMARK.format("T1"), date)
    a = {"allData": form, "saveAs": "Completed", "pageStatus": "Add"}
    b = submit_form(cfg, "Add", form, token_tag="t1B")
    L.write_json(os.path.join(out, "A.classic.json"), a)
    L.write_json(os.path.join(out, "B.submit.json"), b)
    L.write_json(os.path.join(out, "B.status.json"), status_req(cfg, key=b["idempotency_key"]))
    files = {"A.classic.json": ("STOCK_ADJUSTMENT", "A: classic STOCK_ADJUSTMENT {allData, Completed, Add}"),
             "B.submit.json": ("SA_V2_SUBMIT", "B: SA_V2_SUBMIT SUBMIT FORM Add (DIRECT) -> QUEUED with job_id / sa_id"),
             "B.status.json": ("SA_V2_SUBMIT", "B: STATUS by the idempotency key (read-only on the platform)")}
    manifest(out, "T1", list(files), exp, {"lines": len(lines), "entries": sum(len(json.loads(l["balance_index"])) for l in lines), "key": b["idempotency_key"]}, cfg, st)
    print(f"T1 ({'DRY ' if st.dry else ''}{len(lines)} lines, {sum(len(json.loads(l['balance_index'])) for l in lines)} entries) -> {out}")
    show(cfg, out, files)


def t2_drafts(st):
    cfg = st.cfg
    out = step_dir(st, "t2")
    date, _ = st.dates()
    exp = new_expected()
    lines = sa_lines(st, T2_LINES, "t2", exp)
    form = sa_form_add(st, lines, REMARK.format("T2"), date)
    form.pop("_data", None)  # the Draft button's handler never sets is_processing
    req = {"allData": form, "saveAs": "Draft", "pageStatus": "Add"}
    L.write_json(os.path.join(out, "draftA.json"), req)
    L.write_json(os.path.join(out, "draftB.json"), copy.deepcopy(req))
    files = {"draftA.json": ("STOCK_ADJUSTMENT", "Draft A: STOCK_ADJUSTMENT {allData, Draft, Add} (= the Draft button's record; the button itself writes by db add)"),
             "draftB.json": ("STOCK_ADJUSTMENT", "Draft B: the identical request")}
    manifest(out, "T2-drafts", list(files), exp, {"edit": f"line {T2_EDIT_LINE} qty -> {T2_EDIT_QTY}, adjustment_date -> the day before"}, cfg, st)
    print(f"T2 drafts ({'DRY ' if st.dry else ''}{len(lines)} lines) -> {out}")
    show(cfg, out, files)


def t2(st, sa_a, sa_b):
    cfg = st.cfg
    out = step_dir(st, "t2")
    docs = {}
    for tag, sid in (("A", sa_a), ("B", sa_b)):
        h, lines = st.sa(sid)
        if h.get("stock_adjustment_status") != "Draft" or str(h.get("sa_v2_job_id") or "") not in ("", "None"):
            raise SystemExit(f"SA {sid} is {h.get('stock_adjustment_status')} (job {h.get('sa_v2_job_id')}): T2 needs a fresh Draft")
        if [str(l["material_id"]) for l in lines] != [st.it[k]["id"] for k, *_ in T2_LINES]:
            raise SystemExit(f"SA {sid}'s lines are not the T2 drafts' lines")
        docs[tag] = (h, lines)
    sig = lambda ls: [(str(l["material_id"]), str(l["uom_id"]), str(l["total_quantity"]), str(l["unit_price"]), l["balance_index"]) for l in ls]  # noqa: E731
    if sig(docs["A"][1]) != sig(docs["B"][1]):
        raise SystemExit("the two drafts' lines differ: rebuild them from one t2-drafts run")
    new_date = (datetime.date.fromisoformat(str(docs["A"][0]["adjustment_date"])[:10]) - datetime.timedelta(days=1)).isoformat()
    bin_names, batch_names, uom_names = st.names()
    exp = new_expected()
    # the expected moves after the edit (base PCS)
    plan = copy.deepcopy(T2_LINES)
    k, u, p, ents = plan[T2_EDIT_LINE - 1]
    plan[T2_EDIT_LINE - 1] = (k, u, p, [(ents[0][0], ents[0][1], T2_EDIT_QTY, ents[0][3])])
    items = st.items()
    for key, uom_key, price, ents in plan:
        it = items[key]
        for mt, bin_key, qty, batch in ents:
            loc, bid = cfg["bins"][bin_key], (cfg["items"]["fifob"]["batch_id"] if batch else None)
            bq, sign = base_qty(it, uom_key, qty, cfg), (1 if mt == "In" else -1)
            exp["ib"][f"{it['id']}|{loc}"] = str(Decimal(exp["ib"].get(f"{it['id']}|{loc}", "0")) + sign * bq)
            if batch:
                exp["ibb"][f"{it['id']}|{loc}|{bid}"] = str(Decimal(exp["ibb"].get(f"{it['id']}|{loc}|{bid}", "0")) + sign * bq)
            exp["mv"].append({"item_id": it["id"], "bin": loc, "batch": str(bid) if bid else "", "movement": "IN" if mt == "In" else "OUT",
                              "quantity": str(Decimal(str(qty))), "base_qty": str(bq), "uom_id": cfg["uom"][uom_key], "unit_price_in": str(price) if mt == "In" else None})
            if mt == "In" and it["method"] == L.FIFO:
                exp["fifo_new"].setdefault(f"{it['id']}|{bid or ''}", []).append([str(bq), str(price)])
            if it["method"] == L.WA:
                exp["wa_qty"][it["id"]] = str(Decimal(exp["wa_qty"].get(it["id"], "0")) + sign * bq)
    files = {}
    for tag in ("A", "B"):
        h, lines = docs[tag]
        form = sa_form_edit(st, h, lines)
        form["adjustment_date"] = new_date
        ln = form["stock_adjustment"][T2_EDIT_LINE - 1]
        ents = json.loads(ln["balance_index"])
        ents[0]["sa_quantity"] = T2_EDIT_QTY
        ln["balance_index"] = L.bi_text(ents)
        ln["total_quantity"] = T2_EDIT_QTY
        ln["adj_summary"] = L.adj_summary(ents, uom_names.get(str(ln["uom_id"]), "PCS"), bin_names, batch_names)
        if tag == "A":
            L.write_json(os.path.join(out, "A.classic.json"), {"allData": form, "saveAs": "Completed", "pageStatus": "Edit"})
            files["A.classic.json"] = ("STOCK_ADJUSTMENT", f"A: classic STOCK_ADJUSTMENT {{allData: Draft {sa_a} + edits, Completed, Edit}}")
        else:
            b = submit_form(cfg, "Edit", form, sa_id=str(sa_b))
            L.write_json(os.path.join(out, "B.submit.json"), b)
            L.write_json(os.path.join(out, "B.status.json"), status_req(cfg, key=b["idempotency_key"], sa_id=str(sa_b)))
            files["B.submit.json"] = ("SA_V2_SUBMIT", f"B: SA_V2_SUBMIT SUBMIT FORM Edit (COMPLETE, edited) of Draft {sa_b}")
            files["B.status.json"] = ("SA_V2_SUBMIT", "B: STATUS (sa_id + key)")
    manifest(out, "T2", list(files), exp, {"sa_a": sa_a, "sa_b": sa_b, "new_date": new_date, "edit_line": T2_EDIT_LINE, "edit_qty": T2_EDIT_QTY}, cfg, st)
    print(f"T2 A = Draft {sa_a} (classic), B = Draft {sa_b} (V2): adjustment_date -> {new_date}, line {T2_EDIT_LINE} -> {T2_EDIT_QTY} -> {out}")
    show(cfg, out, files)


# ------------------------------------------------------------------------------------------------ Stock Count (T3)
def distribution(row, variance=None):
    """the SC form's balance_distribution text (SCfetchBalanceTable at issue; SCcountQty.js after counting)"""
    def c(v):
        return L.js_str(jsnum(v or 0))
    total = c(row.get("balance_quantity"))
    if variance is None:
        det = [f"  • {lab}: {c(row.get(col))}" for col, lab in (("unrestricted_qty", "Unrestricted"), ("reserved_qty", "Reserved"), ("block_qty", "Blocked"),
               ("qualityinsp_qty", "Quality Inspection"), ("intransit_qty", "In Transit")) if Decimal(str(row.get(col) or 0)) > 0]
        return f"TOTAL: {total}" + ("\n\nBreakdown:\n" + "\n".join(det) if det else "")
    vs = f"(+{L.js_str(jsnum(variance))})" if variance >= 0 else f"({L.js_str(jsnum(variance))})"
    det = []
    if Decimal(str(row.get("unrestricted_qty") or 0)) > 0 or variance != 0:
        det.append(f"  • Unrestricted: {c(row.get('unrestricted_qty'))} {vs}")
    for col, lab in (("reserved_qty", "Reserved"), ("block_qty", "Blocked"), ("qualityinsp_qty", "Quality Inspection"), ("intransit_qty", "In Transit")):
        if Decimal(str(row.get(col) or 0)) > 0:
            det.append(f"  • {lab}: {c(row.get(col))}")
    return f"TOTAL: {total} {vs}" + ("\n\nBreakdown:\n" + "\n".join(det) if det else "")


def t3_issue(st):
    cfg = st.cfg
    out = step_dir(st, "t3")
    _, utc = st.dates()
    items, bals, bbals = st.items(), st.balances(), st.batch_balances()
    bin_names = st.names()[0]
    lines, item_list, plan = [], [], []
    for n, (key, bin_key, batch, var) in enumerate(T3_SC):
        it, loc = items[key], cfg["bins"][bin_key]
        bid = cfg["items"]["fifob"]["batch_id"] if batch else None
        row = bbals.get((it["id"], loc, str(bid))) if batch else bals.get((it["id"], loc))
        if row is None:
            raise SystemExit(f"T3 line {n + 1}: no balance row for {it['code']} in {bin_key}")
        r = L.api_row(row, "item_batch_balance" if batch else "item_balance")
        system = jsnum(row["balance_quantity"])
        ln = {"material_id": it["id"], "material_name": it["name"], "material_desc": it["desc"], "item_category": it["category"], "uom_id": it["base_uom"],
              "base_uom_id": it["base_uom"], "balance_distribution": distribution(r), "system_qty": system, "location_id": loc, "line_status": "Pending",
              "plant_id": cfg["plant_id"], "fm_key": L.fm_key(f"t3|{n}")}
        if batch:
            ln["batch_id"] = str(bid)
        lines.append(ln)
        il = {"item_id": it["id"], "item_name": it["name"], "material_desc": it["desc"], "item_category": it["category"], "location_id": loc, "uom_id": it["base_uom"]}
        il.update({c: r.get(c, 0) for c in L.QTY})
        if batch:
            il["batch_id"] = str(bid)
        item_list.append(il)
        plan.append({"line_index": n + 1, "item": key, "material_id": it["id"], "location_id": loc, "batch_id": str(bid) if bid else "", "system_qty": system,
                     "variance": var})
    ui = st.ui("sc_issued_add")
    f = dict(ui)
    f.update({"stock_count_status": "", "review_status": "", "adjustment_status": "", "page_status": "Add", "stock_count_no": "", "stock_count_no_type": cfg["rules"]["sc"],
              "plant_id": cfg["plant_id"], "organization_id": cfg["organization_id"], "count_method": "", "count_type": "Location", "item_list": item_list,
              "start_date": "", "end_date": "", "assignees": "User", "user_assignees": [], "work_group_assignees": "", "blind_count": 0, "total_counted": "",
              "total_variance": "", "stock_count_remark": REMARK.format("T3"), "stock_count_remark2": "", "stock_count_remark3": "",
              "locationList": [{"id": cfg["bins"][b], "name": bin_names.get(cfg["bins"][b], b)} for b in ("b1", "b2")], "itemList": item_list,
              "table_stock_count": lines})
    req = {"allData": f, "saveAs": "Issued", "pageStatus": "Add", "organizationId": cfg["organization_id"], "nickname": cfg["nickname"], "adjustmentDate": utc,
           "proceedReview": "", "createAdjustment": ""}
    L.write_json(os.path.join(out, "scA.issue.json"), req)
    L.write_json(os.path.join(out, "scB.issue.json"), copy.deepcopy(req))
    L.write_json(os.path.join(out, "plan.json"), plan)
    exp = t3_expected(cfg, items, plan)
    files = {"scA.issue.json": ("STOCK_COUNT", "SC A: STOCK_COUNT {Issued, Add} - 8 Pending lines"), "scB.issue.json": ("STOCK_COUNT", "SC B: the identical request")}
    manifest(out, "T3-issue", list(files), exp, {"plan": "plan.json", "sa_lines_expected": 7}, cfg, st)
    print(f"T3 issue ({'DRY ' if st.dry else ''}{len(lines)} SC lines) -> {out}")
    show(cfg, out, files)


def t3_expected(cfg, items, plan):
    exp = new_expected()
    by = {i["id"]: i for i in items.values()}
    for p in plan:
        v = Decimal(str(p["variance"]))
        if v == 0:
            continue
        it = by[p["material_id"]]
        loc, bid = p["location_id"], p["batch_id"]
        exp["ib"][f"{it['id']}|{loc}"] = str(Decimal(exp["ib"].get(f"{it['id']}|{loc}", "0")) + v)
        if bid:
            exp["ibb"][f"{it['id']}|{loc}|{bid}"] = str(Decimal(exp["ibb"].get(f"{it['id']}|{loc}|{bid}", "0")) + v)
        exp["mv"].append({"item_id": it["id"], "bin": loc, "batch": bid, "movement": "IN" if v > 0 else "OUT", "quantity": str(abs(v)), "base_qty": str(abs(v)),
                          "uom_id": it["base_uom"], "unit_price_in": "review cost" if v > 0 else None})
        if v > 0 and it["method"] == L.FIFO:
            exp["fifo_new"].setdefault(f"{it['id']}|{bid}", []).append([str(v), "review cost"])
        if it["method"] == L.WA:
            exp["wa_qty"][it["id"]] = str(Decimal(exp["wa_qty"].get(it["id"], "0")) + v)
    return exp


def sc_form_edit(st, hdr, lines, ui_kind, previous_status):
    ui = st.ui(ui_kind)
    f = dict(ui)
    f.update(L.api_row(hdr, "stock_count"))
    f["table_stock_count"] = []
    for r in lines:
        x = L.api_row(r, "stock_count_h4c9e1cl_sub", sub=True)
        x["fm_key"] = L.fm_key(f"sc|{r['id']}|{ui_kind}")
        f["table_stock_count"].append(x)
    f.update({"page_status": "Edit", "previous_status": previous_status})
    return f


def load_plan(st):
    p = os.path.join(step_dir(st, "t3"), "plan.json")
    if not os.path.exists(p):
        raise SystemExit("no t3/plan.json: run build_twins.py t3-issue first")
    with open(p) as fh:
        return json.load(fh)


def check_sc_pair(st, sc_a, sc_b, status, review):
    docs = {}
    for tag, sid in (("A", sc_a), ("B", sc_b)):
        h, lines = st.sc(sid)
        if h.get("stock_count_status") != status or (h.get("review_status") or "") != review:
            raise SystemExit(f"SC {sid} is {h.get('stock_count_status')} / {h.get('review_status')}: expected {status} / {review or '(none)'}")
        docs[tag] = (h, lines)
    sig = lambda ls: [(str(l["material_id"]), str(l["location_id"]), str(l["batch_id"] or ""), str(Decimal(str(l["system_qty"])).normalize())) for l in ls]  # noqa: E731
    if sig(docs["A"][1]) != sig(docs["B"][1]):
        raise SystemExit("the two Stock Counts' lines differ (material / bin / batch / system_qty): rebuild them from one t3-issue run")
    return docs


def t3_count(st, sc_a, sc_b):
    cfg = st.cfg
    out = step_dir(st, "t3")
    _, utc = st.dates()
    plan = load_plan(st)
    docs = check_sc_pair(st, sc_a, sc_b, "Issued", "")
    pk = {(p["material_id"], p["location_id"], p["batch_id"]): p for p in plan}
    files = {}
    for tag, sid in (("A", sc_a), ("B", sc_b)):
        h, lines = docs[tag]
        f = sc_form_edit(st, h, lines, "sc_count_edit", "Issued")
        for ln, row in zip(f["table_stock_count"], lines):
            p = pk[(str(row["material_id"]), str(row["location_id"]), str(row["batch_id"] or ""))]
            system = Decimal(str(row["system_qty"]))
            v = Decimal(str(p["variance"]))
            ln.update({"count_qty": jsnum(system + v), "variance_qty": jsnum(v), "adjusted_qty": jsnum(v),
                       "variance_percentage": ("%.2f%%" % abs(float(v / system) * 100)) if system else ("100.00%" if system + v > 0 else "0.00%"),
                       "is_counted": 1, "line_status": "Counted",
                       "balance_distribution": distribution({"balance_quantity": system, "unrestricted_qty": system}, v)})
        f["approvedItems"] = []
        req = {"allData": f, "saveAs": "Stock Count", "pageStatus": "Edit", "organizationId": cfg["organization_id"], "nickname": cfg["nickname"],
               "adjustmentDate": utc, "proceedReview": "", "createAdjustment": ""}
        L.write_json(os.path.join(out, f"sc{tag}.count.json"), req)
        files[f"sc{tag}.count.json"] = ("STOCK_COUNT", f"SC {tag} {sid}: STOCK_COUNT {{Stock Count, Edit}} - every line counted -> Completed / To Be Reviewed")
    print(f"T3 counts -> {out}")
    show(cfg, out, files)


def t3_review(st, sc_a, sc_b):
    cfg = st.cfg
    out = step_dir(st, "t3")
    _, utc = st.dates()
    docs = check_sc_pair(st, sc_a, sc_b, "Completed", "To Be Reviewed")
    files = {}
    for tag, sid in (("A", sc_a), ("B", sc_b)):
        h, lines = docs[tag]
        if any(l.get("line_status") != "Counted" or int(l.get("is_counted") or 0) != 1 for l in lines):
            raise SystemExit(f"SC {sid}: not every line is Counted")
        f = sc_form_edit(st, h, lines, "sc_review_edit", "Completed")
        for ln in f["table_stock_count"]:
            ln.update({"line_status": "Approved", "review_status": "Approved"})    # SCapproveAll.js
        f["selectedRowIndex"] = 0
        if tag == "A":
            req = {"allData": f, "saveAs": "Review", "pageStatus": "Edit", "organizationId": cfg["organization_id"], "nickname": cfg["nickname"],
                   "adjustmentDate": utc, "proceedReview": "", "createAdjustment": "Yes"}
            L.write_json(os.path.join(out, "A.review.json"), req)
            files["A.review.json"] = ("STOCK_COUNT", f"A: classic STOCK_COUNT {{Review, createAdjustment Yes}} of SC {sid} -> answer data.stockAdjustmentId (a Draft SA)")
        else:
            record = L.record_of(f, L.SC_NOT_RECORD)
            key = L.scr_key(cfg["organization_id"], str(sid), "Yes", record)
            b = {"operation": "SUBMIT", "source": "REVIEW", "saveAs": "Completed", "pageStatus": "Edit", "sa_id": "", "sc_id": str(sid), "idempotency_key": key,
                 "form": record, "organization_id": cfg["organization_id"], "nickname": cfg["nickname"], "adjustment_date": utc, "create_adjustment": "Yes"}
            L.write_json(os.path.join(out, "B.submit.json"), b)
            L.write_json(os.path.join(out, "B.status.json"), status_req(cfg, key=key, sc_id=str(sid), source="REVIEW"))
            files["B.submit.json"] = ("SA_V2_SUBMIT", f"B: SA_V2_SUBMIT SUBMIT REVIEW of SC {sid} -> QUEUED (a NEW SA, Processing)")
            files["B.status.json"] = ("SA_V2_SUBMIT", "B: STATUS (source REVIEW, sc_id + key)")
    print(f"T3 reviews -> {out}")
    show(cfg, out, files)
    print("  after A.review: python3 scratchpad/sav2/live/build_twins.py t3-complete-a --sa <data.stockAdjustmentId of A.review.out.json>")


def t3_complete_a(st, sa_id):
    """SCsaveReviewWorkflow.js: db.collection('stock_adjustment').where({id}).get() -> data[0]; sa.id = saId; STOCK_ADJUSTMENT {allData: sa,
    saveAs Completed, pageStatus Edit}"""
    cfg = st.cfg
    out = step_dir(st, "t3")
    h, lines = st.sa(sa_id)
    if h.get("stock_adjustment_status") != "Draft" or not h.get("stock_count_id"):
        raise SystemExit(f"SA {sa_id} is {h.get('stock_adjustment_status')} (stock_count_id {h.get('stock_count_id')}): not the classic review's Draft")
    rec = L.api_row(h, "stock_adjustment")
    rec["stock_adjustment"] = [L.api_row(r, "stock_adjustment_1dknywqh_sub", sub=True) for r in sorted(lines, key=lambda r: int(r["id"]))]
    rec["id"] = str(sa_id)
    L.write_json(os.path.join(out, "A.complete.json"), {"allData": rec, "saveAs": "Completed", "pageStatus": "Edit"})
    files = {"A.complete.json": ("STOCK_ADJUSTMENT", f"A: classic STOCK_ADJUSTMENT {{allData: Draft SA {sa_id} as fetched, Completed, Edit}} (moves the stock)")}
    print(f"T3 A completion of SA {sa_id} ({h.get('adjustment_no')}, {len(lines)} lines) -> {out}")
    show(cfg, out, files)


def f1(st):
    cfg = st.cfg
    out = step_dir(st, "f1")
    date, _ = st.dates()
    exp = new_expected()
    lines = sa_lines(st, F1_LINES, "f1", exp)
    form = sa_form_add(st, lines, "SA V2 live test F1 (Out exceeds stock)", date)
    b = submit_form(cfg, "Add", form, token_tag="f1")
    L.write_json(os.path.join(out, "B.submit.json"), b)
    L.write_json(os.path.join(out, "B.status.json"), status_req(cfg, key=b["idempotency_key"]))
    files = {"B.submit.json": ("SA_V2_SUBMIT", "F1: SA_V2_SUBMIT DIRECT - expect QUEUED, then the job FAILED SA_INVENTORY_INSUFFICIENT, SA back to Draft"),
             "B.status.json": ("SA_V2_SUBMIT", "F1: STATUS by key")}
    out_qty = json.loads(lines[1]["balance_index"])[0]["sa_quantity"]
    manifest(out, "F1", list(files), {"ib": {}, "ibb": {}, "mv": [], "fifo_new": {}, "wa_qty": {}},
             {"out_qty": out_qty, "expect": "job FAILED, error_code SA_INVENTORY_INSUFFICIENT, message 'Insufficient quantity - line 2 (SAV2T-FIFO), bin "
              "Test-Batch-S2 (Unrestricted)', SA stock_adjustment_status Draft, 0 movements, 0 balance / cost changes (the valid WA In of line 1 too)"}, cfg, st)
    print(f"F1 ({'DRY ' if st.dry else ''}FIFO Out {out_qty} > stock) -> {out}")
    show(cfg, out, files)


def dry_state(st, path):
    """the expected post-seed rows as a snap.py snapshot (fake ids) - plan_twin.js / preflight input before the items exist"""
    cfg = st.cfg
    items = st.items()
    P, qty = cfg["seed"]["prices"], cfg["seed"]["qty"]
    fifo, wa, n = [], [], 0
    for k, it in items.items():
        if it["method"] == L.WA:
            wa.append({"id": 9400000000000000001, "material_id": int(it["id"]), "batch_id": None, "plant_id": cfg["plant_id"], "organization_id": cfg["organization_id"],
                       "wa_quantity": "%d.00000000" % (2 * qty), "wa_cost_price": "%.8f" % ((P[k][0] + P[k][1]) / 2), "created_at": "2026-10-16 21:30:00", "is_deleted": 0})
            continue
        for seq, price in ((1, P[k][0]), (2, P[k][1])):
            n += 1
            fifo.append({"id": 9500000000000000000 + n, "material_id": int(it["id"]), "batch_id": int(DRY_BATCH) if it["batch"] else None,
                         "plant_id": int(cfg["plant_id"]), "organization_id": cfg["organization_id"], "fifo_sequence": str(seq), "fifo_cost_price": "%.8f" % price,
                         "fifo_initial_quantity": "%d.00000000" % qty, "fifo_available_quantity": "%d.00000000" % qty, "is_deleted": 0})
    snap = {"meta": {"dry": True, "materials": {k: i["id"] for k, i in items.items()}}, "ib": list(st.balances().values()),
            "ibb": list(st.batch_balances().values()), "fifo": fifo, "wa": wa,
            "itemdef": [{"id": it["id"], "material_code": it["code"], "material_costing_method": it["method"], "item_batch_management": it["batch"], "stock_control": 1,
                         "based_uom": it["base_uom"], "purchase_unit_price": "0",
                         "table_uom_conversion": [{"alt_uom_id": it["base_uom"], "base_uom_id": it["base_uom"], "alt_qty": "1", "base_qty": "1"}]
                         + [{"alt_uom_id": a, "base_uom_id": it["base_uom"], "alt_qty": "1", "base_qty": str(b)} for a, b in it["conv"].items()]} for it in items.values()],
            "precision": [{"scope_type": "1", "rule_key": "Inventory Price", "decimal_places": 4, "precision_rule": 1, "store_raw_value": 0},
                          {"scope_type": "1", "rule_key": "Inventory Qty", "decimal_places": 3, "precision_rule": 1, "store_raw_value": 0}]}
    L.write_json(path, snap)
    print(f"dry post-seed state -> {path}")


def docs(cfg):
    """read-only: the Stock Adjustments / Stock Counts whose lines name a SAV2T item (a Draft add answers no id: find it here), their jobs"""
    t = L.digits(cfg["tenant_id"], "tenant")
    mats = L.material_ids(cfg)
    sas = L.q("SELECT CAST(s.id AS CHAR) id, s.adjustment_no, s.stock_adjustment_status st, s.adjustment_remarks rmk, s.sa_v2_job_id job, "
              "CAST(s.stock_count_id AS CHAR) sc, DATE_FORMAT(s.adjustment_date, '%Y-%m-%d') d, s.create_time, (SELECT COUNT(*) FROM stock_adjustment_1dknywqh_sub l "
              "WHERE l.tenant_id = s.tenant_id AND l.is_deleted = 0 AND l.stock_adjustment_id = s.id) n FROM stock_adjustment s WHERE s.tenant_id = '" + t + "' AND s.id IN "
              "(SELECT stock_adjustment_id FROM stock_adjustment_1dknywqh_sub WHERE tenant_id = '" + t + "' AND material_id IN (" + ",".join("'" + m + "'" for m in mats)
              + ")) ORDER BY s.id")
    print("Stock Adjustments naming a SAV2T item:")
    for r in sas:
        print(f"  {r['id']}  {r['adjustment_no'] or '-':18s} {r['st'] or '-':11s} date {r['d']} lines {r['n']}  job {r['job'] or '-':20s} sc {r['sc'] or '-':20s} "
              f"{(r['rmk'] or '')[:40]}  ({r['create_time']})")
    scs = L.q("SELECT CAST(c.id AS CHAR) id, c.stock_count_no, c.stock_count_status st, c.review_status rv, c.adjustment_status ad, c.stock_count_remark rmk, c.create_time "
              f"FROM stock_count c WHERE c.tenant_id = '{t}' AND c.id IN (SELECT stock_count_id FROM stock_count_h4c9e1cl_sub WHERE tenant_id = '{t}' AND material_id IN "
              f"({','.join(mats)})) ORDER BY c.id")
    print("Stock Counts naming a SAV2T item:")
    for r in scs:
        print(f"  {r['id']}  {r['stock_count_no'] or '-':18s} {r['st'] or '-':10s} / {r['rv'] or '-':15s} / {r['ad'] or '-':18s} {(r['rmk'] or '')[:40]}  ({r['create_time']})")
    if sas:
        jobs = L.q("SELECT CAST(id AS CHAR) id, correlation_id, job_status, progress_percent, error_code, LEFT(error_message, 160) em FROM gd_async_job WHERE tenant_id = '"
                   + t + "' AND command = 'COMPLETE_SA' AND correlation_id IN (" + ",".join("'SA|" + r["id"] + "'" for r in sas) + ") ORDER BY id")
        print("COMPLETE_SA jobs of those SAs:")
        for j in jobs:
            print(f"  {j['id']}  {j['correlation_id']}  {j['job_status']} {j['progress_percent']}%  {j['error_code'] or ''} {j['em'] or ''}")


def ans(path):
    """the essentials of a runas answer file"""
    with open(path) as fh:
        d = json.load(fh)
    x = d.get("data") if isinstance(d.get("data"), dict) else {}
    keys = ("code", "message", "id", "stock_count_no", "stockAdjustmentId", "route", "action", "job_id", "job_status", "sa_id", "sa_no", "sc_id", "line_count",
            "progress_percent", "error_code", "error_message", "worker_route", "processed", "result_code", "result_message")
    print(f"envelope code {d.get('code')} success {d.get('success')} msg {str(d.get('msg'))[:200]}")
    print("  " + "  ".join(f"{k}={json.dumps(x[k], ensure_ascii=False)[:160]}" for k in keys if k in x and x[k] not in ("", None)))


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    cmd = sys.argv[1]
    if cmd == "ans":
        ans(sys.argv[2])
        return
    cfg = L.load_config()
    if cmd == "docs":
        docs(cfg)
        return
    if cmd == "dry-state":
        dry_state(State(cfg, dry=True), L.arg("--out"))
        return
    if cmd == "worker":
        job = L.digits(L.arg("--job"), "--job")
        print(L.write_json(L.arg("--out"), {"job_id": job}))
        return
    if cmd == "status":
        src = "REVIEW" if L.arg("--sc") else "FORM"
        print(L.write_json(L.arg("--out"), status_req(cfg, key=L.arg("--key", ""), sa_id=L.arg("--sa", ""), sc_id=L.arg("--sc", ""), source=src)))
        return
    st = State(cfg, dry="--dry" in sys.argv)
    if cmd == "t1":
        t1(st)
    elif cmd == "t2-drafts":
        t2_drafts(st)
    elif cmd == "t2":
        t2(st, L.digits(L.arg("--sa-a"), "--sa-a"), L.digits(L.arg("--sa-b"), "--sa-b"))
    elif cmd == "t3-issue":
        t3_issue(st)
    elif cmd == "t3-count":
        t3_count(st, L.digits(L.arg("--sc-a"), "--sc-a"), L.digits(L.arg("--sc-b"), "--sc-b"))
    elif cmd == "t3-review":
        t3_review(st, L.digits(L.arg("--sc-a"), "--sc-a"), L.digits(L.arg("--sc-b"), "--sc-b"))
    elif cmd == "t3-complete-a":
        t3_complete_a(st, L.digits(L.arg("--sa"), "--sa"))
    elif cmd == "f1":
        f1(st)
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main()

"""Offline end-to-end check of the twin request builders, no platform call and no database write: the --dry post-seed state,
the platform's storage of each write SIMULATED from the request (Draft adds, Stock Count issue / count, as SELECT * would read the
rows back), the builder's next step on those rows, and package B's SUBMIT interpreter (preflight_submit.js) on every V2 request:
T1-B DIRECT, F1 DIRECT, T2-B COMPLETE (edited), T3-B REVIEW must all answer QUEUED with the designed line / entry counts.
Reads dev only for column types (information_schema) and the recorded UI keys (cached).
  python3 scratchpad/sav2/live/test_build_dry.py"""
import copy, json, os, subprocess, sys
from decimal import Decimal

HERE = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True
sys.path.insert(0, HERE)
import twinlib as L  # noqa: E402
import build_twins as B  # noqa: E402

RESULTS = []


def check(name, cond, detail=""):
    RESULTS.append(bool(cond))
    print(("ok    " if cond else "FAIL  ") + name + ("" if cond else "  " + str(detail)[:600]))


def dec8(v):
    return "%.8f" % Decimal(str(v))


class SimState(B.State):
    """the dry state + simulated stored documents"""
    def __init__(self, cfg):
        super().__init__(cfg, dry=True)
        self.store_sa, self.store_sc = {}, {}

    def sa(self, sa_id):
        return copy.deepcopy(self.store_sa[str(sa_id)])

    def sc(self, sc_id):
        return copy.deepcopy(self.store_sc[str(sc_id)])


def store_draft(st, req, sa_id, n):
    """STOCK_ADJUSTMENT saveAs Draft, pageStatus Add: add_node_jhZYWnLa's props after code_node_O4tWJ5JH (line_index, plant_id, unit_price q8)"""
    a = req["allData"]
    hdr = {"id": int(sa_id), "adjustment_date": a["adjustment_date"] + " 00:00:00", "adjustment_type": a["adjustment_type"], "adjusted_by": a["adjusted_by"],
           "plant_id": int(a["plant_id"]), "adjustment_remarks": a["adjustment_remarks"], "reference_documents": "[]", "create_user": 2084101916223139841,
           "create_dept": int(a["organization_id"]), "create_time": "2026-10-16 22:00:00", "update_user": 2084101916223139841, "update_time": "2026-10-16 22:00:00",
           "is_deleted": 0, "tenant_id": st.t, "adjustment_no": "Draft-SA-90%02d" % n, "row_index": 0, "stock_adjustment_status": "Draft",
           "organization_id": a["organization_id"], "posted_status": None, "acc_integration_type": a["acc_integration_type"], "adjustment_remarks3": "",
           "adjustment_remarks2": "", "stock_count_id": None, "sub_tenant_id": int(a["organization_id"]), "adjustment_no_type": int(a["adjustment_no_type"]),
           "project_id": None, "sa_v2_job_id": None, "sa_idem_key": None}
    lines = []
    for i, l in enumerate(a["stock_adjustment"]):
        lines.append({"id": int(sa_id) + 100 + i, "stock_adjustment_id": int(sa_id), "material_id": l["material_id"], "material_name": l["material_name"],
                      "material_desc": l["material_desc"], "adjustment_reason": l["adjustment_reason"], "total_quantity": str(l["total_quantity"]),
                      "uom_id": int(l["uom_id"]), "unit_price": dec8(l.get("unit_price") or 0), "adj_summary": l["adj_summary"], "adjustment_remarks": "",
                      "balance_index": l["balance_index"], "create_user": 2084101916223139841, "create_dept": int(a["organization_id"]), "create_time": "2026-10-16 22:00:00",
                      "update_user": 2084101916223139841, "update_time": "2026-10-16 22:00:00", "is_deleted": 0, "tenant_id": st.t, "line_index": str(i + 1),
                      "plant_id": int(a["plant_id"]), "item_category": int(l["item_category"]), "is_single_serial": 0, "is_serialized_item": 0,
                      "sub_tenant_id": int(a["organization_id"]), "item_remark2": "", "item_remark3": "", "item_remark": "", "project_id": None})
    st.store_sa[str(sa_id)] = (hdr, lines)


def store_sc(st, req, sc_id, n):
    """STOCK_COUNT saveAs Issued, pageStatus Add: add_node_sc's props after code_issued + code_fillback"""
    a = req["allData"]
    hdr = {"id": int(sc_id), "plant_id": int(a["plant_id"]), "organization_id": a["organization_id"], "page_status": None, "count_type": a["count_type"],
           "count_method": a["count_method"], "start_date": None, "end_date": None, "blind_count": 0, "create_user": 2084101916223139841,
           "create_dept": int(a["organization_id"]), "create_time": "2026-10-16 22:10:00", "update_user": 2084101916223139841, "update_time": "2026-10-16 22:10:00",
           "is_deleted": 0, "tenant_id": st.t, "item_list": json.dumps(a["item_list"]), "user_assignees": "[]", "review_status": "", "stock_count_status": "Issued",
           "assignees": "User", "work_group_assignees": None, "stock_count_no": "STC/20261016/90%02d" % n, "stock_count_remark3": "", "stock_count_remark2": "",
           "stock_count_remark": a["stock_count_remark"], "total_counted": "0 / %d" % len(a["table_stock_count"]), "adjustment_status": "", "total_variance": "0.00%",
           "storage_location_id": None, "sub_tenant_id": 0, "stock_count_no_type": int(a["stock_count_no_type"])}
    lines = []
    for i, l in enumerate(a["table_stock_count"]):
        lines.append({"id": int(sc_id) + 100 + i, "stock_count_id": int(sc_id), "material_id": int(l["material_id"]), "material_name": l["material_name"],
                      "material_desc": l["material_desc"], "batch_id": int(l["batch_id"]) if l.get("batch_id") else None, "location_id": int(l["location_id"]),
                      "system_qty": dec8(l["system_qty"]), "count_qty": None, "variance_qty": None, "variance_percentage": None, "uom_id": int(l["uom_id"]),
                      "base_uom_id": int(l["base_uom_id"]), "line_status": "Pending", "plant_id": int(l["plant_id"]), "item_category": int(l["item_category"]),
                      "line_index": str(i + 1), "is_serialized": None, "is_single": None, "create_user": 2084101916223139841, "create_dept": int(a["organization_id"]),
                      "create_time": "2026-10-16 22:10:00", "update_user": 2084101916223139841, "update_time": "2026-10-16 22:10:00", "is_deleted": 0, "tenant_id": st.t,
                      "is_counted": None, "review_status": None, "adjusted_qty": None, "balance_distribution": l["balance_distribution"], "sub_tenant_id": 0})
    st.store_sc[str(sc_id)] = (hdr, lines)


def apply_count(st, req, sc_id):
    """STOCK_COUNT saveAs "Stock Count": every line counted -> Completed / To Be Reviewed (code_stockcount)"""
    hdr, lines = st.store_sc[str(sc_id)]
    by = {str(l["id"]): l for l in req["allData"]["table_stock_count"]}
    for row in lines:
        l = by[str(row["id"])]
        row.update({"count_qty": dec8(l["count_qty"]), "variance_qty": dec8(l["variance_qty"]), "adjusted_qty": dec8(l["adjusted_qty"]),
                    "variance_percentage": l["variance_percentage"], "is_counted": 1, "line_status": "Counted", "balance_distribution": l["balance_distribution"]})
    hdr.update({"stock_count_status": "Completed", "review_status": "To Be Reviewed", "total_counted": "%d / %d" % (len(lines), len(lines))})


def preflight(req, snap, status=None):
    cmd = ["node", os.path.join(HERE, "preflight_submit.js"), req, snap] + ([status] if status else [])
    r = subprocess.run(cmd, capture_output=True, text=True)
    return r.returncode, (r.stdout + r.stderr).strip()


def main():
    cfg = L.load_config()
    st = SimState(cfg)
    F = L.out_dir(cfg)
    tmp = L.out_dir(cfg, "tmp")
    state = os.path.join(tmp, "dry_state.json")
    B.dry_state(st, state)
    with open(state) as fh:
        base = json.load(fh)
    # T1 / F1 (DIRECT)
    B.t1(st)
    B.f1(st)
    for step, lines, entries in (("t1-dry", 7, 9), ("f1-dry", 2, 2)):
        code, out = preflight(os.path.join(F, step, "B.submit.json"), state, os.path.join(F, step, "B.status.json"))
        check(f"{step} B: SUBMIT DIRECT QUEUED, {lines} lines / {entries} entries; STATUS answers", code == 0 and f"line_count {lines}" in out and "action DIRECT" in out
              and f"entries {entries}" in out and "STATUS" in out, out)
    # T2: drafts stored as STOCK_ADJUSTMENT Draft would, then the COMPLETE edit
    B.t2_drafts(st)
    with open(os.path.join(F, "t2-dry", "draftA.json")) as fh:
        dA = json.load(fh)
    store_draft(st, dA, "9700000000000000001", 1)
    store_draft(st, copy.deepcopy(dA), "9700000000000000002", 2)
    B.t2(st, "9700000000000000001", "9700000000000000002")
    with open(os.path.join(F, "t2-dry", "A.classic.json")) as fh:
        a2 = json.load(fh)
    with open(os.path.join(F, "t2-dry", "B.submit.json")) as fh:
        b2 = json.load(fh)
    check("t2 A: classic Edit request carries the stored id, Draft status and the edits", a2["pageStatus"] == "Edit" and a2["allData"]["id"] == "9700000000000000001"
          and a2["allData"]["stock_adjustment_status"] == "Draft" and a2["allData"]["adjustment_date"] == "2026-10-15"
          and json.loads(a2["allData"]["stock_adjustment"][1]["balance_index"])[0]["sa_quantity"] == 4 and a2["allData"]["stock_adjustment"][1]["total_quantity"] == 4)
    check("t2 B: SUBMIT FORM Edit, sa_id = the form's id, NOT_RECORD keys gone", b2["sa_id"] == "9700000000000000002" and b2["form"]["id"] == "9700000000000000002"
          and "_data" not in b2["form"] and "draft_status" not in b2["form"] and b2["idempotency_key"].startswith("SA:1901545950162329602:9700000000000000002:"))
    snap = copy.deepcopy(base)
    hdr, lines = st.store_sa["9700000000000000002"]
    snap["sa"], snap["sal"] = [L.big_str(hdr)], [L.big_str(x) for x in lines]
    snap2 = os.path.join(tmp, "dry_state_t2.json")
    L.write_json(snap2, snap)
    code, out = preflight(os.path.join(F, "t2-dry", "B.submit.json"), snap2, os.path.join(F, "t2-dry", "B.status.json"))
    check("t2 B: SUBMIT COMPLETE QUEUED, edited 1, 4 lines / 4 entries, DOC part", code == 0 and "action COMPLETE" in out and "edited 1" in out and "entries 4" in out
          and '"DOC"' in out, out)
    # T3: two Stock Counts issued, counted, reviewed
    B.t3_issue(st)
    with open(os.path.join(F, "t3-dry", "scA.issue.json")) as fh:
        iss = json.load(fh)
    store_sc(st, iss, "9800000000000000001", 1)
    store_sc(st, copy.deepcopy(iss), "9800000000000000002", 2)
    B.t3_count(st, "9800000000000000001", "9800000000000000002")
    for tag, sid in (("A", "9800000000000000001"), ("B", "9800000000000000002")):
        with open(os.path.join(F, "t3-dry", f"sc{tag}.count.json")) as fh:
            apply_count(st, json.load(fh), sid)
    B.t3_review(st, "9800000000000000001", "9800000000000000002")
    with open(os.path.join(F, "t3-dry", "A.review.json")) as fh:
        a3 = json.load(fh)
    with open(os.path.join(F, "t3-dry", "B.submit.json")) as fh:
        b3 = json.load(fh)
    lines = a3["allData"]["table_stock_count"]
    check("t3 A: classic Review, createAdjustment Yes, 8 approved lines with numeric counts", a3["saveAs"] == "Review" and a3["createAdjustment"] == "Yes"
          and len(lines) == 8 and all(l["line_status"] == "Approved" and l["review_status"] == "Approved" and l["is_counted"] == 1 for l in lines)
          and [l["variance_qty"] for l in lines] == [3, -2, -1, 2, 1, -1, -3, 0], [l.get("variance_qty") for l in lines])
    check("t3 B: SUBMIT REVIEW for SC B with the stored statuses, SCR key, dialog keys gone", b3["source"] == "REVIEW" and b3["sc_id"] == "9800000000000000002"
          and b3["form"]["stock_count_status"] == "Completed" and b3["form"]["review_status"] == "To Be Reviewed" and "dialog_select_stock" not in b3["form"]
          and b3["idempotency_key"].startswith("SCR:1901545950162329602:9800000000000000002:"))
    snap = copy.deepcopy(base)
    hdr, lines = st.store_sc["9800000000000000002"]
    snap["sc"], snap["scl"] = [L.big_str(hdr)], [L.big_str(x) for x in lines]
    snap3 = os.path.join(tmp, "dry_state_t3.json")
    L.write_json(snap3, snap)
    code, out = preflight(os.path.join(F, "t3-dry", "B.submit.json"), snap3, os.path.join(F, "t3-dry", "B.status.json"))
    check("t3 B: SUBMIT REVIEW QUEUED, a NEW SA of 7 built lines (8 SC lines, one without variance), SC part", code == 0 and "action REVIEW" in out
          and "line_count 7" in out and '"SC"' in out, out)
    print(out.replace("\n", "\n      "))
    # keys are the clients' exactly (canon + hash16) - cross-checked against the JS functions
    js = os.path.join(tmp, "keycheck.js")
    if os.path.exists(js):
        for kind, f in (("SA", os.path.join(F, "t1-dry", "B.submit.json")), ("SA", os.path.join(F, "t2-dry", "B.submit.json")),
                        ("SCR", os.path.join(F, "t3-dry", "B.submit.json"))):
            r = subprocess.run(["node", js, kind, f], capture_output=True, text=True)
            check(f"idempotency key = the {kind} client's hash ({os.path.basename(os.path.dirname(f))})", "MATCHES" in r.stdout, r.stdout + r.stderr)
    print(f"{sum(RESULTS)}/{len(RESULTS)} passed")
    sys.exit(0 if all(RESULTS) else 1)


if __name__ == "__main__":
    main()

"""live_check.py GR|PO <doc id> <draft|completed> <identity.json> [--run]
Predicts with the OLD versions (sim/predict.js, on the documents as the platform reads them now) what one conversion writes,
then - with --run - runs the LIVE (lean) conversion on DEV as that identity and compares the invoice it added (header + every
line) and the order / receipt counters it moved. Also reports node data and run time of the conversion and its PI_SAVE.
Writes real dev rows (an invoice, invoice counters): run only with the user's yes."""
import datetime
import json
import os
import re
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
R = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, os.path.join(R, "scratchpad", "grv2"))
from dbq import q  # noqa: E402

kind, doc_id, convert_to, ident = sys.argv[1:5]
RUN = "--run" in sys.argv
WORK = os.path.join("/private/tmp/claude-501/-Users-yunawinaya-Developer-BladeXfunctions/3184bace-c1a2-43fd-9910-40a12d531785/scratchpad", "live_pi")
os.makedirs(WORK, exist_ok=True)
tenant = json.load(open(ident))["tenant_id"]
WF = {"GR": "2070324857790087170", "PO": "2107312550576844801"}
SAVE = "2066342495378059266"


sys.path.insert(0, HERE)
from test_sql import platform  # noqa: E402


def norm(v):
    if isinstance(v, bool):
        return int(v)
    if isinstance(v, float):
        return round(v, 6) if not v.is_integer() else int(v)
    if isinstance(v, str) and re.fullmatch(r"-?\d+\.\d+", v):
        f = float(v)
        return int(f) if f.is_integer() else round(f, 6)
    if isinstance(v, str) and re.fullmatch(r"-?\d{1,15}", v):
        return int(v)
    if isinstance(v, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2} 00:00:00(\.0+)?", v):
        return v[:10]
    if isinstance(v, list):
        return [norm(x) for x in v]
    if isinstance(v, dict):
        return {k: norm(x) for k, x in v.items() if x is not None and x != ""}
    return v


SKIP = {"id", "purchase_invoice_no", "purchase_invoice_no_type", "create_user", "create_dept", "create_time", "update_user", "update_time",
        "tenant_id", "is_deleted", "sub_tenant_id", "table_pi", "parent_id", "children", "page_status", "previous_status", "purchase_invoice_id"}


_COLS = {}


def columns(table):
    if table not in _COLS:
        _COLS[table] = {r["c"] for r in q("--dev", f"SELECT column_name c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = '{table}'")}
    return _COLS[table]


def cmp_obj(label, want, got, problems):
    cols = columns("purchase_invoice" if label == "header" else "purchase_invoice_xpuy7o4q_sub")
    for k, v in want.items():
        if k in SKIP or k not in cols or v is None or v == "" or v == [] and k not in ("po_id", "gr_id"):
            continue
        if norm(v) != norm(got.get(k)):
            problems.append("%s.%s: old would write %s, lean wrote %s" % (label, k, json.dumps(norm(v))[:120], json.dumps(norm(got.get(k)))[:120]))


def main():
    # 1. the documents as the platform reads them now
    fx = {"kind": kind, "tenantId": tenant, "grs": [], "pos": []}
    if kind == "GR":
        gr = platform("goods_receiving", doc_id)
        assert gr, "GR not readable (the CLI reads tenant 000000 only)"
        fx["grs"] = [gr]
        fx["pos"] = [platform("purchase_order", str(p)) for p in gr.get("po_id") or []]
        fx["params"] = {"ids": [doc_id], "convert_to": convert_to, "is_multiple": "single", "filter_draft": "no"}
    else:
        po = platform("purchase_order", doc_id)
        assert po, "PO not readable"
        fx["pos"] = [po]
        fx["params"] = {"po_ids": [doc_id], "convert_to": convert_to, "is_multiple": "single", "filter_draft": "no"}
    fix = os.path.join(WORK, "fixture_%s_%s.json" % (kind, doc_id))
    pred = os.path.join(WORK, "predicted_%s_%s.json" % (kind, doc_id))
    json.dump(fx, open(fix, "w"))
    after = sys.argv[sys.argv.index("--after") + 1] if "--after" in sys.argv else None
    if not after:
        out = subprocess.run(["node", os.path.join(R, "scratchpad", "pi2k", "sim", "predict.js"), fix, pred], capture_output=True, text=True)
        print(out.stdout.strip() or out.stderr.strip()[:600])
        if out.returncode or not RUN:
            return
    predicted = json.load(open(pred))

    # 2. the live (lean) conversion
    req = os.path.join(WORK, "req_%s_%s.json" % (kind, doc_id))
    res = os.path.join(WORK, "res_%s_%s.json" % (kind, doc_id))
    json.dump(fx["params"], open(req, "w"))
    if after:
        start_id = int(after)
    else:
        t0 = time.time()
        start_id = int((int(t0 * 1000) - 5000 - 1288834974657) << 22)
        print("start id", start_id)
        run = subprocess.run(["node", "scratchpad/gdc/tools/runas.mjs", ident, WF[kind], req, res], capture_output=True, text=True, cwd=R)
        t1 = time.time()
        print("live %s -> %s (%.1f s)" % (kind, run.stdout.strip().splitlines()[-1][:300] if run.stdout.strip() else run.stderr[:300], t1 - t0))

    # 3. what it wrote
    pis = q("--dev", f"SELECT CAST(id AS CHAR) id, purchase_invoice_no, pi_status FROM purchase_invoice WHERE tenant_id = '{tenant}' AND is_deleted = 0 "
                     f"AND id > {start_id} ORDER BY id")
    print("invoices added:", pis)
    problems = []
    if len(pis) != len(predicted["pis"]):
        problems.append("invoice count: old %d, lean %d" % (len(predicted["pis"]), len(pis)))
    for want, got_row in zip(predicted["pis"], pis):
        got = platform("purchase_invoice", got_row["id"]) if tenant == "000000" else None
        if got is None:
            problems.append("cannot read invoice %s through the platform (tenant %s)" % (got_row["id"], tenant))
            continue
        if want.get("purchase_invoice_no", "").startswith("Draft") != str(got.get("purchase_invoice_no", "")).startswith("Draft"):
            problems.append("number kind: old %s, lean %s" % (want.get("purchase_invoice_no"), got.get("purchase_invoice_no")))
        cmp_obj("header", want, got, problems)
        wl, gl = want.get("table_pi") or [], got.get("table_pi") or []
        if len(wl) != len(gl):
            problems.append("lines: old %d, lean %d" % (len(wl), len(gl)))
        key = lambda r: str(r.get("line_index"))
        gmap = {key(r): r for r in gl}
        for w in wl:
            g = gmap.get(key(w), {})
            cmp_obj("line %s" % key(w), w, g, problems)
            wc, gc = w.get("children") or [], g.get("children") or []
            if len(wc) != len(gc):
                problems.append("line %s children: old %d, lean %d" % (key(w), len(wc), len(gc)))
            gcm = {key(r): r for r in gc}
            for c in wc:
                cmp_obj("line %s" % key(c), c, gcm.get(key(c), {}), problems)
    # counters on the order / receipt lines
    for coll, store, line_key in (("purchase_order", predicted["po"], "table_po"), ("goods_receiving", predicted["gr"], "table_gr")):
        for did, want in store.items():
            got = platform(coll, did)
            if got is None:
                continue
            if norm(want["pi_status"]) != norm(got.get("pi_status")):
                problems.append("%s %s pi_status: old %s, lean %s" % (coll, did, want["pi_status"], got.get("pi_status")))
            flat = {}
            for l in got.get(line_key) or []:
                flat[str(l["id"])] = l
                for c in l.get("children") or []:
                    flat[str(c["id"])] = c
            for lid, w in want["lines"].items():
                g = flat.get(lid, {})
                if norm(w["invoice_qty"] or 0) != norm(g.get("invoice_qty") or 0) or norm(w["pi_status"]) != norm(g.get("pi_status")):
                    problems.append("%s line %s: old %s/%s, lean %s/%s" % (coll, lid, w["invoice_qty"], w["pi_status"], g.get("invoice_qty"), g.get("pi_status")))
    # node data + time
    for name, wid in (("conversion", WF[kind]), ("PI_SAVE", SAVE)):
        for r in q("--dev", f"SELECT CAST(id AS CHAR) id, status, run_time, LENGTH(nodes_data) nd FROM su_code_workflow_inst WHERE workflow_id = {wid} "
                            f"AND id > {start_id} ORDER BY id"):
            print("  %-10s run %s %-8s %6.1f s  node data %.2f MB" % (name, r["id"], r["status"], int(r["run_time"] or 0) / 1000, int(r["nd"] or 0) / 1e6))
    print("RESULT:", "SAME as the old version" if not problems else "%d difference(s)" % len(problems))
    for p in problems[:25]:
        print("  ", p)


if __name__ == "__main__":
    main()

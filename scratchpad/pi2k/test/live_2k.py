"""live_2k.py GR|PO <doc id> <draft|completed> <identity.json>   - convert one document on DEV (lean GR_Convert_PI / PO_CONVERT_PI)
   live_2k.py SAVE <draft PI id> completed <identity.json>       - save a stored Draft invoice as Completed (lean PI_SAVE, Edit)
Then checks what was written (invoice lines, the order / receipt counters and statuses) and reports run time and node data of
every run the request made, with any platform error. Writes real dev rows: run only with the user's yes."""
import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
R = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, os.path.join(R, "scratchpad", "grv2"))
sys.path.insert(0, HERE)
from dbq import q  # noqa: E402

mode, doc_id, convert_to, ident = sys.argv[1:5]
tenant = json.load(open(ident))["tenant_id"]
WORK = "/private/tmp/claude-501/-Users-yunawinaya-Developer-BladeXfunctions/3184bace-c1a2-43fd-9910-40a12d531785/scratchpad/live_pi"
os.makedirs(WORK, exist_ok=True)
WF = {"GR": "2070324857790087170", "PO": "2107312550576844801", "SAVE": "2066342495378059266"}
NAMES = {"2070324857790087170": "GR_Convert_PI", "2107312550576844801": "PO_CONVERT_PI", "2066342495378059266": "PI_SAVE"}


def stored_pi_payload(pi_id):
    from test_sql import platform  # the platform's own read of the invoice (CLI tenant 000000)
    pi = platform("purchase_invoice", pi_id)
    assert pi and pi.get("pi_status") == "Draft", "not a stored Draft invoice: %s" % (pi or {}).get("pi_status")
    pi["page_status"] = "Edit"
    pi["previous_status"] = "Draft"
    pi["pi_status"] = "Completed"
    return pi


def main():
    if mode == "SAVE":
        params = {"data": stored_pi_payload(doc_id)}
    elif mode == "GR":
        params = {"ids": [doc_id], "convert_to": convert_to, "is_multiple": "single", "filter_draft": "no"}
    else:
        params = {"po_ids": [doc_id], "convert_to": convert_to, "is_multiple": "single", "filter_draft": "no"}
    req = os.path.join(WORK, "req2k_%s_%s.json" % (mode, doc_id))
    res = os.path.join(WORK, "res2k_%s_%s.json" % (mode, doc_id))
    json.dump(params, open(req, "w"))
    print("request: %s, %.2f MB" % (mode, os.path.getsize(req) / 1e6))
    t0 = time.time()
    start_id = int((int(t0 * 1000) - 5000 - 1288834974657) << 22)
    run = subprocess.run(["node", "scratchpad/gdc/tools/runas.mjs", ident, WF[mode], req, res], capture_output=True, text=True, cwd=R)
    t1 = time.time()
    out = (run.stdout.strip().splitlines() or [run.stderr.strip()])[-1]
    print("answer (%.1f s): %s" % (t1 - t0, out[:400]))

    # every run this request made
    for wid, name in NAMES.items():
        for r in q("--dev", f"SELECT CAST(id AS CHAR) id, status, run_time, LENGTH(nodes_data) nd, error_msg FROM su_code_workflow_inst WHERE workflow_id = {wid} "
                            f"AND id > {start_id} ORDER BY id"):
            print("  %-14s %s %-9s %7.1f s  node data %6.2f MB %s" % (name, r["id"], r["status"], int(r["run_time"] or 0) / 1000, int(r["nd"] or 0) / 1e6,
                                                                 (r["error_msg"] or "")[:160]))
    # what was written
    pis = q("--dev", f"SELECT CAST(id AS CHAR) id, purchase_invoice_no, pi_status, posted_status, CAST(po_id AS CHAR) po, CAST(gr_id AS CHAR) gr, invoice_total "
                     f"FROM purchase_invoice WHERE tenant_id = '{tenant}' AND is_deleted = 0 AND (id > {start_id} OR id = {doc_id if mode == 'SAVE' else 0}) ORDER BY id")
    for p in pis:
        lines = q("--dev", f"SELECT COUNT(*) n, SUM(parent_id IS NULL) top, ROUND(SUM(invoice_qty), 4) qty, ROUND(SUM(invoice_amount), 2) amt, "
                           f"COUNT(DISTINCT line_index) idx FROM purchase_invoice_xpuy7o4q_sub WHERE purchase_invoice_id = {p['id']} AND is_deleted = 0")[0]
        print("  invoice %s %s %s/%s total %s | lines %s (top %s, distinct line_index %s), invoiced qty %s, amount %s | po %s gr %s" % (
            p["id"], p["purchase_invoice_no"], p["pi_status"], p["posted_status"], p["invoice_total"], lines["n"], lines["top"], lines["idx"], lines["qty"],
            lines["amt"], p["po"][:60], (p["gr"] or "")[:60]))
    docs = set()
    for p in pis:
        for x in json.loads(p["po"] or "[]"):
            docs.add(("PO", str(x)))
        for x in json.loads(p["gr"] or "[]"):
            docs.add(("GR", str(x)))
    for kind, did in sorted(docs):
        if kind == "PO":
            h = q("--dev", f"SELECT purchase_order_no no, pi_status FROM purchase_order WHERE id = {did}")[0]
            s = q("--dev", f"SELECT COUNT(*) n, SUM(invoice_qty >= quantity - 0.00000001) full, SUM(invoice_qty > 0) inv, ROUND(SUM(invoice_qty), 4) qty, "
                           f"GROUP_CONCAT(DISTINCT COALESCE(pi_status, '-')) st FROM purchase_order_2ukyuanr_sub WHERE purchase_order_id = {did} AND is_deleted = 0")[0]
        else:
            h = q("--dev", f"SELECT gr_no no, pi_status FROM goods_receiving WHERE id = {did}")[0]
            s = q("--dev", f"SELECT COUNT(*) n, SUM(invoice_qty >= received_qty - 0.00000001) full, SUM(invoice_qty > 0) inv, ROUND(SUM(invoice_qty), 4) qty, "
                           f"GROUP_CONCAT(DISTINCT COALESCE(pi_status, '-')) st FROM goods_receiving_eg6l4ywi_sub WHERE goods_receiving_id = {did} AND is_deleted = 0")[0]
        print("  %s %s %s pi_status %s | lines %s, invoiced %s, fully %s, qty %s, line statuses %s" % (kind, did, h["no"], h["pi_status"], s["n"], s["inv"], s["full"],
                                                                                                   s["qty"], s["st"]))
    print("start id", start_id)


if __name__ == "__main__":
    main()

"""Runs every sql-node of the lean GR_CREATED / GR_CANCEL_CREATED read-only on dev with real ids, checks the columns
against each node's response_json, and EXPLAINs each statement (no full scan of item / PO lines by id).
Usage: python3 sqlcheck.py"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
from dbq import q  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
PH = re.compile(r"\{\{([^}]+)\}\}")
bad = 0


def nodes(rel):
    out = {}

    def walk(n):
        if isinstance(n, dict):
            if n.get("type") == "sql-node":
                out[n["id"]] = n
            for v in n.values():
                walk(v)
        elif isinstance(n, list):
            for v in n:
                walk(v)
    walk(json.load(open(os.path.join(ROOT, rel))))
    return out


# gr_idem_key is a new hidden GR header column (added with the GR form change): until dev has it, the statements are
# checked with the column replaced by a typed NULL, and reported PENDING
_cols = {r["c"] for r in q("--dev", "SELECT column_name AS c FROM information_schema.columns WHERE table_schema = DATABASE() "
                                    "AND table_name = 'goods_receiving'")}
IDEM_PENDING = "gr_idem_key" not in _cols
MISSING_COLS = [("g.gr_no, g.gr_idem_key\n", "g.gr_no, CAST(NULL AS CHAR) AS gr_idem_key\n"), ("g.gr_idem_key", "CAST(NULL AS CHAR)")]


def run(label, node, values, expect_rows=None):
    global bad
    text = PH.sub(lambda m: values[m.group(1)], node["data"]["script"]["code"])
    if IDEM_PENDING and "gr_idem_key" in text:
        for a, b in MISSING_COLS:
            text = text.replace(a, b)
        label += " [PENDING gr_idem_key: checked as NULL]"
    long = [ln for ln in node["data"]["script"]["code"].split("\n") if len(ln) > 160]
    declared = [r["name"] for r in node["data"]["response_json"]]
    try:
        rows = q("--dev", text)
    except BaseException as e:  # noqa: BLE001
        bad += 1
        print("FAIL %-22s %s: %s" % (node["id"], label, str(e)[:400]))
        return None
    cols = list(rows[0].keys()) if rows else []
    miss = [c for c in cols if c not in declared]
    extra = [c for c in declared if rows and c not in cols]
    flag = "ok  "
    if miss or extra or long or (expect_rows is not None and not expect_rows(rows)):
        flag = "BAD "
        bad += 1
    plan = q("--dev", "EXPLAIN " + text)
    scans = ["%s:%s/%s" % (p.get("table"), p.get("type"), p.get("key")) for p in plan]
    print("%s %-22s %-34s rows=%-4d %s%s%s" % (flag, node["id"], label, len(rows), ("undeclared " + str(miss)) if miss else "",
                                                (" unreturned " + str(extra)) if extra else "", (" LONG LINES %d" % len(long)) if long else ""))
    print("      plan: " + ", ".join(scans))
    return rows


def main():
    T = "000000"
    # a Draft GR of 13 lines on tenant 000000 and a Created GR of tenant 496474
    draft = q("--dev", "SELECT CAST(id AS CHAR) id FROM goods_receiving WHERE id=2075110414665449473")[0]["id"]
    created = q("--dev", "SELECT CAST(id AS CHAR) id, tenant_id FROM goods_receiving WHERE id=2091804377420345346")[0]
    gl = q("--dev", "SELECT CAST(po_line_item_id AS CHAR) lid, CAST(item_id AS CHAR) item FROM goods_receiving_eg6l4ywi_sub "
                    "WHERE goods_receiving_id=%s AND is_deleted=0" % created["id"])
    lids = ",".join(sorted({r["lid"] for r in gl if r["lid"]}))
    items = ",".join(sorted({r["item"] for r in gl if r["item"]}))
    po = q("--dev", "SELECT DISTINCT CAST(purchase_order_id AS CHAR) po FROM purchase_order_2ukyuanr_sub WHERE id IN (%s)" % lids)
    pos = ",".join(r["po"] for r in po)

    c = nodes("Goods Receiving/GRsaveAsCreatedWorkflow.json")
    v = {"system:tenantId": created["tenant_id"], "node:code_node_GcPrep.data.grId": created["id"],
         "node:code_node_GcPrep.data.poLineCsv": lids, "node:code_node_GcPrep.data.itemCsv": items,
         "node:code_node_GcPrep.data.keySql": "GRC:test:does-not-exist", "node:code_node_GcQty.data.relPoCsv": pos}
    run("stored Created GR", c["sql_node_GcProcGuard"], v, lambda r: len(r) >= 1 and r[0]["gr_status"] == "Created")
    run("stored Draft GR (000000)", c["sql_node_GcProcGuard"], dict(v, **{"system:tenantId": T, "node:code_node_GcPrep.data.grId": draft}),
        lambda r: r and r[0]["gr_status"] == "Draft")
    run("Add: no stored GR (id 0)", c["sql_node_GcProcGuard"], dict(v, **{"node:code_node_GcPrep.data.grId": "0"}), lambda r: r == [])
    run("PO lines: new + stored", c["sql_node_GcPoLines"], v, lambda r: len(r) >= 1)
    run("PO lines: Add, empty csv", c["sql_node_GcPoLines"], dict(v, **{"node:code_node_GcPrep.data.poLineCsv": "0",
                                                                            "node:code_node_GcPrep.data.grId": "0"}), lambda r: r == [])
    run("PO lines: only the stored GR's", c["sql_node_GcPoLines"], dict(v, **{"node:code_node_GcPrep.data.poLineCsv": "0"}),
        lambda r: len(r) >= 1)
    run("tolerances", c["sql_node_GcTol"], v, lambda r: len(r) >= 1)
    run("tolerances: none", c["sql_node_GcTol"], dict(v, **{"node:code_node_GcPrep.data.itemCsv": "0"}), lambda r: r == [])
    run("key hit: none", c["sql_node_GcKeyHit"], v, lambda r: r == [])
    run("key twins: none", c["sql_node_GcKeyDup"], v, lambda r: r == [])
    run("PO status", c["sql_node_GcPoStatus"], v, lambda r: len(r) >= 1)
    run("PO status: none", c["sql_node_GcPoStatus"], dict(v, **{"node:code_node_GcQty.data.relPoCsv": "0"}), lambda r: r == [])

    k = nodes("Bulk Actions/Procurement/Goods Receiving/GRcancelWorkflow.json")
    w = {"system:tenantId": created["tenant_id"], "node:code_node_CcGuardKey.data.idsCsv": created["id"],
         "node:code_node_CcPlan.data.poCsv": pos}
    run("cancel: GR lines x PO lines", k["sql_node_CcLines"], w, lambda r: len(r) >= 1)
    run("cancel: two GRs", k["sql_node_CcLines"], dict(w, **{"node:code_node_CcGuardKey.data.idsCsv": created["id"] + ",2097503606885449730"}),
        lambda r: len(r) >= 1)
    run("cancel: refused ids -> 0", k["sql_node_CcLines"], dict(w, **{"node:code_node_CcGuardKey.data.idsCsv": "0"}), lambda r: r == [])
    run("cancel: PO status", k["sql_node_CcPoStatus"], w, lambda r: len(r) >= 1)
    run("cancel: stored status (Phase 0)", k["sql_node_CcGuard"], w, lambda r: len(r) == 1)
    print("problems:", bad)
    return bad


if __name__ == "__main__":
    sys.exit(1 if main() else 0)

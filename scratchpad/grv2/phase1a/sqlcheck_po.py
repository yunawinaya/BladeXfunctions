"""Runs every sql-node of the patched PO_SAVE on DEV (read-only SELECTs) with real placeholder values: a PO with lines,
on-order rows, PREQ links and draft GR / PI where dev has them. Checks each statement runs and returns exactly the
declared columns. Usage: python3 sqlcheck_po.py"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
from dbq import q  # noqa: E402
from wf import find, walk  # noqa: E402

WF = os.path.join(HERE, "..", "..", "..", "Purchase Order", "POsaveWorkflow.json")


def hexs(s):
    return s.encode("utf-8").hex().upper()


def main():
    doc = json.load(open(WF, encoding="utf-8"))
    nodes = []
    walk(doc, lambda n, p, k: nodes.append(n) if n.get("type") == "sql-node" else None)
    # a PO with a draft GR (dev), and the 50-line PO
    draft = q("--dev", "SELECT g.tenant_id, CAST(JSON_UNQUOTE(JSON_EXTRACT(g.po_id, '$[0]')) AS CHAR) AS po FROM goods_receiving g "
                       "WHERE g.is_deleted = 0 AND g.gr_status = 'Draft' AND JSON_LENGTH(g.po_id) > 0 ORDER BY g.id DESC LIMIT 1")
    cases = [("496474", "2108375168033402881")]
    if draft:
        cases.append((draft[0]["tenant_id"], draft[0]["po"]))
    bad = 0
    for tenant, po in cases:
        head = q("--dev", "SELECT purchase_order_no, organization_id FROM purchase_order WHERE id = %s" % po)
        if not head:
            print("skip", po)
            continue
        vals = {"system:tenantId": tenant, "node:code_pre.data.poIdSql": po, "node:code_get_latest.data.poIdSql": po,
                "node:code_resolve_latest.data.poIdSql": po, "node:code_resolve_latest.data.orgSql": head[0]["organization_id"],
                "node:code_resolve_latest.data.poNoHex": hexs(head[0]["purchase_order_no"] or "")}
        for n in nodes:
            text = n["data"]["script"]["code"]
            long_lines = [l for l in text.split("\n") if len(l) > 160]
            sql = re.sub(r"\{\{([^}]+)\}\}", lambda m: vals[m.group(1)], text)
            declared = [r["name"] for r in n["data"]["response_json"]]
            try:
                rows = q("--dev", sql)
                cols = list(rows[0].keys()) if rows else []
                miss = [c for c in cols if c not in declared]
                extra = [c for c in declared if rows and c not in cols]
                flag = "ok  " if not miss and not extra and not long_lines else "BAD "
                bad += 0 if flag == "ok  " else 1
                print("%s %-16s %-20s rows=%-5d %s%s%s" % (flag, po[-6:], n["id"], len(rows), ("undeclared %s " % miss) if miss else "",
                                                          ("unreturned %s " % extra) if extra else "", ("lines>160: %d" % len(long_lines)) if long_lines else ""))
            except BaseException as e:  # noqa: BLE001
                bad += 1
                print("FAIL %-16s %-20s %s" % (po[-6:], n["id"], str(e)[-300:]))
    print("sql nodes:", len(nodes), "problems:", bad)
    return bad


if __name__ == "__main__":
    sys.exit(1 if main() else 0)

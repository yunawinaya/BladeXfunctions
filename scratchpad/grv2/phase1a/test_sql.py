"""Runs the new PO_SAVE sql-nodes read-only on DEV for POs whose latest recorded PO_SAVE run read them back, and compares
each result with what the replaced get/search node returned in that run (projected to the same fields).
Usage: python3 test_sql.py [max_pos]"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
from dbq import q  # noqa: E402
from runs import fetch, list_runs, nodes  # noqa: E402

PH = re.compile(r"\{\{([^}]+)\}\}")


def sql_text(name, values):
    with open(os.path.join(HERE, "code", name + ".sql"), encoding="utf-8") as f:
        text = f.read()

    def rep(m):
        if m.group(1) not in values:
            raise KeyError(m.group(1))
        return values[m.group(1)]
    return PH.sub(rep, text)


def hexs(s):
    return s.encode("utf-8").hex().upper()


def data_of(n, nid):
    if nid not in n:
        return None
    g = n[nid]["out"]
    g = g.get("data") if isinstance(g, dict) else g
    if isinstance(g, dict) and "data" in g:
        g = g["data"]
    return g


def flatten(rows):
    out = []
    for r in rows or []:
        out.append(r)
        out.extend(r.get("children") or [])
    return out


def norm_num(v):
    if v is None or v == "":
        return None
    return round(float(v), 8)


fails = 0
checked = 0


def check(label, got, want):
    global fails, checked
    checked += 1
    if got != want:
        fails += 1
        print("FAIL", label)
        print("   got ", json.dumps(got, ensure_ascii=False)[:600])
        print("   want", json.dumps(want, ensure_ascii=False)[:600])


def main(max_pos):
    latest = {}
    for meta in list_runs("--dev", 300):
        if meta["status"] != "Complete":
            continue
        r = fetch("--dev", meta["id"])
        n = nodes(r)
        g = data_of(n, "get_po_full")
        if not g:
            continue
        if isinstance(g, list):
            g = g[0]
        pid = str(g["id"])
        if pid not in latest:
            latest[pid] = (meta, n, g)
    print("POs with a recorded read-back:", len(latest))
    for pid, (meta, n, g) in list(latest.items())[:max_pos]:
        tenant = meta["tenant_id"]
        org = str(g.get("organization_id") or "")
        vals = {"system:tenantId": tenant, "node:code_get_latest.data.poIdSql": pid, "node:code_resolve_latest.data.poIdSql": pid,
                "node:code_resolve_latest.data.orgSql": org if re.fullmatch(r"[0-9]+", org) else "0",
                "node:code_resolve_latest.data.poNoHex": hexs(str(g.get("purchase_order_no") or "")),
                "node:code_pre.data.poIdSql": pid}
        # header
        head = q("--dev", sql_text("sql_po_head", vals))
        h = head[0] if head else {}
        want_h = {"id": pid, "purchase_order_no": g.get("purchase_order_no"), "po_status": g.get("po_status"),
                  "po_plant": str(g.get("po_plant")) if g.get("po_plant") is not None else None, "organization_id": g.get("organization_id"),
                  "po_supplier_id": g.get("po_supplier_id"), "preq_id": [str(x) for x in (g.get("preq_id") or [])],
                  "po_total": norm_num(g.get("po_total")), "auto_pi": g.get("auto_pi"), "create_pi": g.get("create_pi")}
        got_h = {"id": h.get("id"), "purchase_order_no": h.get("purchase_order_no"), "po_status": h.get("po_status"), "po_plant": h.get("po_plant"),
                 "organization_id": h.get("organization_id"), "po_supplier_id": h.get("po_supplier_id"),
                 "preq_id": json.loads(h["preq_id_json"]) if h.get("preq_id_json") else [], "po_total": norm_num(h.get("po_total")),
                 "auto_pi": None if h.get("auto_pi") is None else int(h["auto_pi"]), "create_pi": h.get("create_pi")}
        if want_h["auto_pi"] is not None:
            want_h["auto_pi"] = int(want_h["auto_pi"])
        if got_h.get("po_status") in ("Processing", "Completed", "Cancelled") and want_h.get("po_status") != got_h.get("po_status"):
            # the PO moved on since the run (GR / cancel): its status and (cancel) number are not the run's any more
            for k in ("po_status", "purchase_order_no"):
                got_h.pop(k, None)
                want_h.pop(k, None)
        check("head %s" % pid, got_h, want_h)
        # lines (flat, ordered as Reconcile On Order flattens get_po_full.table_po)
        lines = q("--dev", sql_text("sql_oo_lines", vals))
        got_l = [{"id": r["id"], "item_id": r.get("item_id"), "quantity": norm_num(r.get("quantity")), "quantity_uom": r.get("quantity_uom"),
                  "preq_id": r.get("preq_id"), "preq_line_id": r.get("preq_line_id")} for r in lines]
        want_l = [{"id": str(r["id"]), "item_id": None if r.get("item_id") in (None, "") else str(r.get("item_id")), "quantity": norm_num(r.get("quantity")),
                   "quantity_uom": None if r.get("quantity_uom") is None else str(r.get("quantity_uom")),
                   "preq_id": None if r.get("preq_id") is None else str(r.get("preq_id")),
                   "preq_line_id": None if r.get("preq_line_id") is None else str(r.get("preq_line_id"))} for r in flatten(g.get("table_po"))]
        for x in got_l:
            if x["item_id"] == "":
                x["item_id"] = None
        check("lines %s (%d)" % (pid, len(want_l)), got_l, want_l)
        # items
        items = q("--dev", sql_text("sql_oo_items", vals))
        got_i = sorted([{"id": r["id"], "uom": sorted([(str(c["alt_uom_id"]), norm_num(c["base_qty"])) for c in json.loads(r["uom_json"] or "[]")])}
                        for r in items], key=lambda x: x["id"])
        si = data_of(n, "search_items") or []
        want_i = sorted([{"id": str(r["id"]), "uom": sorted([(str(c.get("alt_uom_id")), norm_num(c.get("base_qty")))
                                                             for c in (r.get("table_uom_conversion") or [])])} for r in si], key=lambda x: x["id"])
        check("items %s (%d)" % (pid, len(want_i)), got_i, want_i)
        # on-order rows (received / open quantities move with GR, so only the reconcile keys are compared)
        oo = q("--dev", sql_text("sql_onorder", vals))
        key = lambda r: (str(r["id"]), None if r.get("po_id") is None else str(r.get("po_id")), None if r.get("po_line_id") is None else str(r.get("po_line_id")),
                         str(r.get("material_id")), r.get("purchase_order_number"), int(r.get("purchase_order_line")) if r.get("purchase_order_line") is not None else None)
        got_o = sorted(key(r) for r in oo)
        so = data_of(n, "search_onorder") or []
        # rows the run itself added / deleted change the set: compare against the run's fetch + its adds - its deletes
        diff = data_of(n, "code_onorder_diff") or {}
        want_ids = set(str(r["id"]) for r in so) - set(str(r["id"]) for r in (diff.get("toDelete") or []))
        got_ids = set(x[0] for x in got_o)
        missing = want_ids - got_ids
        check("onorder %s fetched rows still present (%d)" % (pid, len(want_ids)), sorted(missing), [])
        print("ok-ish %s lines=%d items=%d onorder=%d (run %s)" % (pid, len(got_l), len(got_i), len(oo), meta["id"]))
    print("checks", checked, "failures", fails)


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 40)
    sys.exit(1 if fails else 0)

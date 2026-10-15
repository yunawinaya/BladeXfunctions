"""diff_twins_gr.py <before_A> <after_A> <before_B> <after_B>: each receipt's own delta (before -> after, snap_gr.py), made
comparable across twins (rows keyed by material, ids / numbers / clocks masked), then A's delta against B's, table by table.
Twins = two receipts of the same purchase order with the same lines, one completed (or reverted) by the classic and one by V2."""
import json
import sys
from decimal import Decimal

A0, A1, B0, B1 = [json.load(open(p)) for p in sys.argv[1:5]]
SKIP = {"update_time", "update_user", "create_time", "create_user", "create_dept"}
QTY = {"balance_quantity", "reserved_qty", "unrestricted_qty", "block_qty", "qualityinsp_qty", "intransit_qty", "fifo_available_quantity", "wa_quantity",
       "received_qty", "created_received_qty", "outstanding_quantity", "open_qty"}
MASK = {"id", "gr_no", "gr_id", "goods_receiving_id", "trx_no", "parent_trx_no", "doc_no", "doc_id", "doc_line_id", "parent_no", "parent_id", "parent_line_id",
        "transaction_no", "batch_number", "batch_id", "batch_number_id", "balance_id", "to_id", "receiving_no", "transfer_order_putaway_id", "target_doc_id",
        "target_doc_no", "target_doc_line_id", "putaway_line_id", "source_transit_id", "operation_effect_key", "job_line_key", "last_transaction_date", "doc_date",
        "gr_v2_job_id", "gr_idem_key", "fifo_sequence", "organization_id", "received_date", "transit_date", "line_index", "fm_key", "grn_uuid", "gr_date",
        "created_at", "line_no", "partially_received", "fully_received", "gr_line_id", "po_no", "batch_no", "confirmed_at",
        "line_po_id", "line_po_no", "po_line_item_id", "po_id", "purchase_order_number", "item_batch_no"}
# V2 keys its movements (INVENTORY_BULK_APPLY) and its ledger rows; the classic path leaves them NULL
EXPECTED = {"operation_effect_key", "job_line_key", "gr_v2_job_id"}


def num(v):
    try:
        return Decimal(str(v)).normalize()
    except Exception:
        return v


def rowdelta(b, a):
    """changed columns of one row (same id): quantities as after - before (twins share balance rows), "" and NULL the same"""
    out = {}
    for k in sorted(set(b) | set(a)):
        if k in SKIP:
            continue
        x, y = b.get(k), a.get(k)
        if (x in (None, "")) and (y in (None, "")):
            continue
        if num(x) != num(y):
            if k in QTY and isinstance(num(x), Decimal) and isinstance(num(y), Decimal):
                out[k] = (x, "d" + str((num(y) - num(x)).normalize()))
            else:
                out[k] = (x, y)
    return out


def delta(before, after, table):
    bi = {r["id"]: r for r in before.get(table, [])}
    ai = {r["id"]: r for r in after.get(table, [])}
    changed = {i: rowdelta(bi[i], ai[i]) for i in bi if i in ai}
    return {i: d for i, d in changed.items() if d}, [ai[i] for i in ai if i not in bi], [bi[i] for i in bi if i not in ai]


def mat_of(table, row):
    if table in ("ib", "ibb", "fifo", "wa", "batch", "it", "oo"):
        return row.get("material_id") or row.get("item_id") or row.get("po_line_id")
    if table in ("tol", "tor"):
        return row.get("item_code")
    if table in ("grl", "pol", "mv"):
        return row.get("item_id") or row.get("material_id")
    if table == "item":
        return row.get("id")
    return table


def shape(table, before, after):
    ch, new, gone = delta(before, after, table)
    bi = {r["id"]: r for r in before.get(table, [])}
    sig = {}
    for i, d in ch.items():
        key = mat_of(table, bi[i])
        sig.setdefault(key, []).append(("chg", tuple(sorted((k, (v[1] if str(v[1]).startswith("d") else str(num(v[1]))) if k not in MASK else "*") for k, v in d.items()
                                                            if k not in EXPECTED))))
    for r in new:
        sig.setdefault(mat_of(table, r), []).append(("new", tuple(sorted((k, str(num(v)) if k not in MASK else "*") for k, v in r.items()
                                                                        if k not in SKIP and k not in EXPECTED and v not in (None, "")))))
    for r in gone:
        sig.setdefault(mat_of(table, r), []).append(("gone",))
    return {k: sorted(v) for k, v in sig.items()}


bad = 0
for t in ["gr", "grl", "po", "pol", "oo", "ib", "ibb", "fifo", "wa", "mv", "batch", "to", "tol", "tor", "it", "item"]:
    sa, sb = shape(t, A0, A1), shape(t, B0, B1)
    same = sa == sb
    bad += 0 if same else 1
    print(f"{t:6s} A {sum(len(v) for v in sa.values()):4d} changes  B {sum(len(v) for v in sb.values()):4d}  {'SAME' if same else 'DIFFER'}")
    if not same:
        for k in sorted(set(sa) | set(sb), key=str):
            if sa.get(k) != sb.get(k):
                print("   ", k)
                print("      A:", str(sa.get(k))[:900])
                print("      B:", str(sb.get(k))[:900])
print("tables differing:", bad)

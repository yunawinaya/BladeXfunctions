"""diff_twins_create.py <before_A> <after_A> <before_B> <after_B>: GD Created V2 twins (scratchpad/gdc/test/diff_twins.py with the
Picking tables and the create-only masks): each conversion's own delta (before -> after), made comparable across
twins (rows keyed by material, ids / numbers / clocks masked), then A's delta against B's, table by table."""
import json
import sys
from decimal import Decimal

A0, A1, B0, B1 = [json.load(open(p)) for p in sys.argv[1:5]]
SKIP = {"update_time", "update_user", "create_time", "create_user", "create_dept"}


def num(v):
    try:
        return Decimal(str(v)).normalize()
    except Exception:
        return v


QTY = {"balance_quantity", "reserved_qty", "unrestricted_qty", "block_qty", "qualityinsp_qty", "intransit_qty", "fifo_available_quantity",
       "wa_quantity", "delivered_qty", "planned_qty", "outstanding_quantity", "open_qty"}


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


def mat_of(table, row, snap):
    if table in ("gdl", "res", "ib", "ibb", "fifo", "wa"):
        return row.get("material_id")
    if table == "sol":
        return row.get("item_name") or row.get("material_id") or row.get("id")
    if table == "mv":
        return row.get("item_id")
    if table == "item":
        return row.get("id")
    return table


MASK = {"id", "delivery_no", "so_no", "so_id", "sales_order_id", "goods_delivery_id", "line_so_id", "line_so_no", "so_line_item_id", "trx_no",
        "parent_trx_no", "doc_no", "doc_id", "doc_line_id", "parent_no", "parent_id", "parent_line_id", "target_gd_id", "source_reserved_id",
        "operation_effect_key", "job_line_key", "gd_id", "last_transaction_date", "doc_date", "reserved_date", "prev_temp_qty_data", "completed_at",
        "pre_so_lines", "pre_pending_state", "pre_on_reserved_gd_ids", "pre_so_headers", "pre_picking_records", "pre_pp_headers", "pre_hu_state",
        "pp_restamp_map", "fifo_sequence", "completed_by", "organization_id",
        # create twins: the job marker, the Picking's own number / links, the GD number copied onto the Picking
        "gd_dockey", "transfer_order_id", "to_id", "gd_no", "delivery_no_display", "source_doc_id", "source_doc_no", "ref_doc"}
EXPECTED = {"operation_effect_key"}  # V2 keys its movements (INVENTORY_BULK_APPLY); the classic path leaves it NULL


def shape(table, before, after):
    ch, new, gone = delta(before, after, table)
    bi = {r["id"]: r for r in before.get(table, [])}
    sig = {}
    for i, d in ch.items():
        key = mat_of(table, bi[i], before)
        sig.setdefault(key, []).append(("chg", tuple(sorted((k, (v[1] if str(v[1]).startswith("d") else str(num(v[1]))) if k not in MASK else "*") for k, v in d.items()))))
    for r in new:
        key = mat_of(table, r, after)
        sig.setdefault(key, []).append(("new", tuple(sorted((k, str(num(v)) if k not in MASK else "*") for k, v in r.items() if k not in SKIP and k not in EXPECTED and v not in (None, "")))))
    for r in gone:
        sig.setdefault(mat_of(table, r, before), []).append(("gone",))
    return {k: sorted(v) for k, v in sig.items()}


bad = 0
for t in ["gd", "gdl", "res", "so", "sol", "ib", "ibb", "fifo", "wa", "mv", "item", "pkh", "pkl"]:
    sa, sb = shape(t, A0, A1), shape(t, B0, B1)
    same = sa == sb
    bad += 0 if same else 1
    print(f"{t:9s} A {sum(len(v) for v in sa.values()):3d} changes  B {sum(len(v) for v in sb.values()):3d}  {'SAME' if same else 'DIFFER'}")
    if not same:
        for k in sorted(set(sa) | set(sb), key=str):
            if sa.get(k) != sb.get(k):
                print("   ", k)
                print("      A:", str(sa.get(k))[:900])
                print("      B:", str(sb.get(k))[:900])
print("tables differing:", bad)

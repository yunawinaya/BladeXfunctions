"""diff_twins_ida.py <A_before> <A_after> <B_before> <B_after> [--expect plan.json] [--mask-prices] [--json out.json]
diff_twins_ida.py --nothing-moved <before> <after> [--code IDA_INVENTORY_INSUFFICIENT]     (verification 7: a FAILED job moved nothing)

Twin parity for Item Disassembly V2 (package E): each twin's own delta (before -> after, snap_ida.py), made comparable across the
twins, then A's delta (classic IDA_SAVE) against B's (V2), table by table. Twins run SEQUENTIALLY on the same stock (A before /
after, then B before / after), so rows both twins touch compare as DELTAS, never as absolute values; a balance row one twin creates
and the other updates compares as the same quantity delta (the receipt bin may hold the item already). Copied from
tpl/iav2/live/diff_twins_ia.py (masks, --expect, V2 checks, --nothing-moved); the tables and the deliberate differences are IDA's.
  masked: ids and document ids, numbers (stock_movement_no, trx_no, transaction_no, batch numbers: twins cannot share a typed number and
          draw consecutive AUTO numbers - a line's batch number compares by its kind: '-', placeholder, number), timestamps, the new FIFO
          layer's sequence, the re-averaged WA price (it starts from the other twin's state: recon_ida.py --before proves it by formula);
          a twin's OWN new Batch row id is one token per material + batch number (idaBatchKey), numbered by first id within the material
          ('<own batch MAT #k>', the k-th distinct number of MAT) wherever it appears; parent_trx_no is NOT masked ('' on both sides)
  skipped: create / update user, dept and time, sub_tenant_id (platform bookkeeping)
  deliberate V2 differences (CONTRACT section 13, listed under DELIBERATE / V2 CHECKS): inventory_movement.operation_effect_key; the
          classic's BLANK Batch row per NONE line; one Batch row per shared typed number (the classic: one per line) - Batch rows compare
          as the per-material sum of initial_quantity; sm_item_disassembly.ida_v2_job_id / ida_idem_key; gd_async_job, gd_publish_step,
          inventory_balance_lock rows
  temp_qty_data compares by its picks (balance, bin, batch, category, sm_quantity); NULL and '' compare equal; --mask-prices (only with
          --expect plan.json whose fifo_layers_used holds two or more prices: the twins' issues take different layers) masks the prices
          that follow from the issue - the OUT rows', the IN rows' but Fixed Cost ones (purchase_unit_price), the new FIFO layers' and new WA
          rows' cost - and compares a FIFO key's consumption as its total; recon_ida.py proves B's prices by formula
Every remaining difference is listed (key, A, B, the columns that differ). Exit 1 on any difference / failed expectation / check."""
import json, sys
from decimal import Decimal, InvalidOperation

SKIP = {"create_user", "update_user", "create_dept", "create_time", "update_time", "sub_tenant_id"}
EXPECTED = {"operation_effect_key", "ida_v2_job_id", "ida_idem_key"}
MASK = {"id", "sm_item_disassembly_id", "stock_movement_no", "stock_movement_no_sn", "trx_no", "transaction_no", "batch_number",
        "last_transaction_date", "created_at", "updated_at", "claimed_at", "last_released_at", "fm_key", "last_reset_date", "item_disassembly_date",
        "remarks", "stock_summary", "temp_hu_data", "issued_by", "line_index"}
MASK_NEW = {"fifo_sequence"}
PRICES = {"unit_price", "total_price", "fifo_cost_price", "wa_cost_price"}
QTY = ("balance_quantity", "reserved_qty", "unrestricted_qty", "block_qty", "qualityinsp_qty", "intransit_qty")
NUMERIC = set(QTY) | {"fifo_available_quantity", "fifo_initial_quantity", "wa_quantity", "quantity", "base_qty", "actual_qty", "actual_base_qty", "item_qty",
                      "total_quantity", "requested_qty", "bom_ratio", "initial_quantity", "running_number"}
PICK_KEYS = ("balance_id", "location_id", "batch_id", "category", "sm_quantity")
BATCHY = {"batch_id", "batch_number_id"}
MASK_PRICES = "--mask-prices" in sys.argv
FIXED = "Fixed Cost"


def blank(v):
    return v is None or v == ""


def num(v):
    if isinstance(v, bool) or v is None:
        return None
    try:
        return Decimal(str(v)).normalize()
    except (InvalidOperation, ValueError):
        return None


def nstr(v):
    n = num(v)
    return "" if n is None else format(n, "f")


def batch_key(n):
    """ida_common idaBatchKey: lower case, trailing blanks dropped"""
    return str(n).lower().rstrip(" ")


def own_batches(before, after):
    """{batch id: token} for the Batch rows a twin created in its window (classic ADD_INVENTORY / V2 D1): '<own batch MAT #k>' = the k-th
    distinct batch number (idaBatchKey) of material MAT by first id, so the classic's two rows of one typed number share V2's one token
    and twins compare batch by batch; a blank row '<own blank batch MAT>', a soft-deleted one '<own deleted batch MAT>'"""
    old = {str(r["id"]) for r in before.get("batch", [])}
    rows = sorted((r for r in after.get("batch", []) if str(r["id"]) not in old), key=lambda r: int(str(r["id"])))
    seen, out = {}, {}
    for r in rows:
        m = str(r.get("material_id"))
        if is_deleted(r):
            out[str(r["id"])] = f"<own deleted batch {m}>"
        elif blank(r.get("batch_number")) or not str(r.get("batch_number")).strip():
            out[str(r["id"])] = f"<own blank batch {m}>"
        else:
            k = (m, batch_key(r.get("batch_number")))
            if k not in seen:
                seen[k] = sum(1 for x in seen if x[0] == m) + 1
            out[str(r["id"])] = f"<own batch {m} #{seen[k]}>"
    return out


def issue_priced(r):
    """an inventory_movement row whose price follows from the issue: the OUT rows, the IN rows but Fixed Cost ones"""
    return MASK_PRICES and (r.get("movement") == "OUT" or (r.get("movement") == "IN" and r.get("costing_method_id") != FIXED))


def kind_of(n):
    t = "" if n is None else str(n)
    if t.strip() in ("", "-"):
        return t.strip() or "''"
    if t == "Auto-generated batch number":
        return "<placeholder>"
    return "<number>"


def norm_picks(v):
    if blank(v):
        return ""
    try:
        ents = json.loads(v) if isinstance(v, str) else v
    except ValueError:
        return "UNPARSABLE:" + str(v)
    if not isinstance(ents, list):
        return "NOT-A-LIST:" + str(v)
    return " ; ".join("|".join(f"{k}={nstr(e.get(k)) if k == 'sm_quantity' else ('' if blank(e.get(k)) else e.get(k))}" for k in PICK_KEYS)
                      if isinstance(e, dict) else str(e) for e in ents)


def val(col, v, own):
    if col == "temp_qty_data":
        return norm_picks(v)
    if blank(v):
        return ""
    if col in BATCHY and str(v) in own:
        return own[str(v)]
    if col in NUMERIC or col in PRICES:
        return nstr(v)
    return str(v)


def is_deleted(r):
    return str(r.get("is_deleted", 0)) not in ("0", "None")


# ------------------------------------------------------------------------------------------------ deltas
def qty_delta(table, key_cols, before, after, own):
    """{key: {col: delta}}: a created row is a delta from 0, a soft-deleted row a delta to 0; keys use the own-batch token"""
    b = {str(r["id"]): r for r in before.get(table, [])}
    out = {}
    for r in after.get(table, []):
        o = b.get(str(r["id"]))
        k = "/".join(val(c, r.get(c), own) or "-" for c in key_cols)
        for c in QTY:
            x = Decimal(0) if (not o or is_deleted(o)) else (num(o.get(c)) or Decimal(0))
            y = Decimal(0) if is_deleted(r) else (num(r.get(c)) or Decimal(0))
            if x != y:
                out.setdefault(k, {})
                out[k][c] = out[k].get(c, Decimal(0)) + (y - x)
    return {k: {c: format(v.normalize(), "f") for c, v in d.items() if v != 0} for k, d in out.items() if any(v != 0 for v in d.values())}


def new_rows(table, before, after):
    old = {str(r["id"]) for r in before.get(table, [])}
    return [r for r in after.get(table, []) if str(r["id"]) not in old]


def changed_rows(table, before, after):
    b = {str(r["id"]): r for r in before.get(table, [])}
    return [(b[str(r["id"])], r) for r in after.get(table, []) if str(r["id"]) in b and r != b[str(r["id"])]]


def sig(r, own, drop=(), prices=False):
    return tuple(sorted((c, "*" if c in MASK or c in MASK_NEW else "<price>" if prices and c in PRICES else val(c, v, own)) for c, v in r.items()
                        if c not in SKIP and c not in EXPECTED and c not in drop and not blank(v)))


def mv_delta(before, after, own, no):
    """the twin's own new movements (its number), as signatures; others are FOREIGN"""
    return sorted(sig(r, own, ("is_deleted", "tenant_id"), issue_priced(r)) for r in new_rows("mv", before, after)
                  if r.get("trx_no") == no and r.get("transaction_type") == "IDA")


def fifo_delta(before, after, own):
    """consumed layers (delta, the layer's cost) and new layers (initial, available, cost); --mask-prices: a key's consumption as its total
    (the twins take different layers) and the new layers' cost masked"""
    out = {}
    for o, r in changed_rows("fifo", before, after):
        d = (num(r.get("fifo_available_quantity")) or 0) - (num(o.get("fifo_available_quantity")) or 0)
        if d:
            out.setdefault(f"consumed {r.get('material_id')}/{val('batch_id', r.get('batch_id'), own) or '-'}", []).append(
                (d, val("fifo_cost_price", r.get("fifo_cost_price"), own)))
    for k in [k for k in out if k.startswith("consumed ")]:
        if MASK_PRICES:
            out[k] = [(format(sum((d for d, _ in out[k]), Decimal(0)).normalize(), "f"), "<layers>")]
        else:
            out[k] = [(format(d.normalize(), "f"), p) for d, p in out[k]]
    for r in new_rows("fifo", before, after):
        k = f"new {r.get('material_id')}/{val('batch_id', r.get('batch_id'), own) or '-'}"
        out.setdefault(k, []).append((val("fifo_initial_quantity", r.get("fifo_initial_quantity"), own), val("fifo_available_quantity", r.get("fifo_available_quantity"), own),
                                      "<price>" if MASK_PRICES else val("fifo_cost_price", r.get("fifo_cost_price"), own)))
    return {k: sorted(v) for k, v in out.items()}


def wa_delta(before, after, own):
    out = {}
    for o, r in changed_rows("wa", before, after):
        d = (num(r.get("wa_quantity")) or 0) - (num(o.get("wa_quantity")) or 0)
        out.setdefault(f"re-averaged {r.get('material_id')}/{val('batch_id', r.get('batch_id'), own) or '-'}", []).append(
            (format(d.normalize(), "f"), "<price changed>" if num(r.get("wa_cost_price")) != num(o.get("wa_cost_price")) else "<price kept>"))
    for r in new_rows("wa", before, after):
        out.setdefault(f"new {r.get('material_id')}/{val('batch_id', r.get('batch_id'), own) or '-'}", []).append(
            (val("wa_quantity", r.get("wa_quantity"), own), "<price>" if MASK_PRICES else val("wa_cost_price", r.get("wa_cost_price"), own)))
    return {k: sorted(v) for k, v in out.items()}


def batch_delta(before, after, own, no):
    """per material: the sum of initial_quantity of the twin's live non-blank new Batch rows; the classic's blank rows and the row count per
    material are DELIBERATE (CONTRACT section 13)"""
    out, deliberate = {}, []
    rows = [r for r in new_rows("batch", before, after) if not is_deleted(r)]
    blanks = [r for r in rows if blank(r.get("batch_number"))]
    if blanks:
        deliberate.append(f"{len(blanks)} blank Batch row(s) (the classic ADD_INVENTORY's per NONE line; V2 writes none)")
    for r in rows:
        if blank(r.get("batch_number")):
            continue
        k = str(r.get("material_id"))
        e = out.setdefault(k, {"initial_quantity": Decimal(0), "rows": 0, "transaction_no": set()})
        e["initial_quantity"] += num(r.get("initial_quantity")) or 0
        e["rows"] += 1
        e["transaction_no"].add("<own number>" if r.get("transaction_no") == no else str(r.get("transaction_no")))
    for k, e in out.items():
        if e["rows"] > 1:
            deliberate.append(f"material {k}: {e['rows']} Batch rows (the classic mints one per line; V2 one per typed number + item)")
    return {k: {"initial_quantity": format(e["initial_quantity"].normalize(), "f"), "transaction_no": sorted(e["transaction_no"])} for k, e in out.items()}, deliberate


def header_delta(before, after, own):
    a = (after.get("ida") or [{}])[0]
    b = (before.get("ida") or [{}])[0] if before.get("ida") else {}
    d = {}
    for c in sorted(set(a) | set(b)):
        if c in SKIP or c in EXPECTED or c in MASK:
            continue
        x, y = b.get(c), a.get(c)
        if (blank(x) and blank(y)) or (num(x) is not None and num(x) == num(y)) or str(x) == str(y):
            if c not in ("item_disassembly_status", "posted_status"):
                continue
        d[c] = norm_picks(y) if c == "temp_qty_data" else val(c, y, own)
    return {"IDA": d}


def lines_delta(before, after, own):
    b = {str(r["id"]): r for r in before.get("idal", [])}
    out = {}
    for r in after.get("idal", []):
        if str(r["id"]) in b and b[str(r["id"])] == r:
            continue
        k = f"line {r.get('line_index')} {r.get('item_selection')}"
        out[k] = tuple(sorted([(c, val(c, v, own)) for c, v in r.items() if c not in SKIP and c not in EXPECTED and c not in MASK and not blank(v)]
                              + [("batch_kind", kind_of(r.get("batch_number")))]))
    return out


def item_touch(before, after):
    bi = {str(r["id"]): r for r in before.get("item", [])}
    return {r["material_code"]: "touched" for r in after.get("item", []) if str(r.get("update_time")) != str((bi.get(str(r["id"])) or {}).get("update_time"))}


def bnc_delta(before, after):
    b = {str(r["id"]): r for r in before.get("bnc", [])}
    out = {}
    for r in after.get("bnc", []):
        o = b.get(str(r["id"]))
        if o and num(r.get("running_number")) != num(o.get("running_number")):
            out[str(r["id"])] = format(((num(r.get("running_number")) or 0) - (num(o.get("running_number")) or 0)).normalize(), "f")
    return out


def number_of(snap):
    return ((snap.get("ida") or [{}])[0]).get("stock_movement_no")


def foreign(before, after):
    """movements in a twin's window that are not its IDA's (another session on the same items): they explain a balance DIFFER"""
    no = number_of(after)
    return [r for r in new_rows("mv", before, after) if r.get("trx_no") != no or r.get("transaction_type") != "IDA"]


def twin_deltas(b, a):
    own = own_batches(b, a)
    no = number_of(a)
    bt, delib = batch_delta(b, a, own, no)
    return {"ib": qty_delta("ib", ("material_id", "location_id"), b, a, own), "ibb": qty_delta("ibb", ("material_id", "location_id", "batch_id"), b, a, own),
            "fifo": fifo_delta(b, a, own), "wa": wa_delta(b, a, own), "batch": bt, "mv": {"rows": mv_delta(b, a, own, no)}, "item": item_touch(b, a),
            "ida": header_delta(b, a, own), "idal": lines_delta(b, a, own), "bnc": bnc_delta(b, a)}, delib


def compare(A0, A1, B0, B1):
    da, xa = twin_deltas(A0, A1)
    db, xb = twin_deltas(B0, B1)
    report, bad = [], 0
    for t in ("ib", "ibb", "fifo", "wa", "batch", "mv", "item", "ida", "idal", "bnc"):
        sa, sb = da[t], db[t]
        if t == "mv":
            ra, rb = sa["rows"], sb["rows"]
            diffs = []
            if ra != rb:
                only_a = [r for r in ra if r not in rb]
                only_b = [r for r in rb if r not in ra]
                diffs.append({"key": "movements", "A": only_a[:6], "B": only_b[:6], "columns": [f"row count A {len(ra)} B {len(rb)}; A-only {len(only_a)}, B-only {len(only_b)}"]})
            report.append({"table": t, "A": len(ra), "B": len(rb), "same": not diffs, "diffs": diffs})
            bad += 1 if diffs else 0
            continue
        diffs = []
        for k in sorted(set(sa) | set(sb), key=str):
            if sa.get(k) != sb.get(k):
                x, y = sa.get(k), sb.get(k)
                cols = []
                if isinstance(x, dict) and isinstance(y, dict):
                    cols = [f"{c}: A {x.get(c)} B {y.get(c)}" for c in sorted(set(x) | set(y)) if x.get(c) != y.get(c)]
                diffs.append({"key": k, "A": x, "B": y, "columns": cols})
        bad += 1 if diffs else 0
        report.append({"table": t, "A": len(sa), "B": len(sb), "same": not diffs, "diffs": diffs})
    return report, bad, ["A " + x for x in xa] + ["B " + x for x in xb]


# ------------------------------------------------------------------------------------------------ the designed moves (--expect)
def check_expect(before, after, plan):
    fails = []
    own = own_batches(before, after)
    no = number_of(after)
    new = [r for r in new_rows("mv", before, after) if r.get("trx_no") == no and r.get("transaction_type") == "IDA"]
    got = sorted((str(r["item_id"]), str(r["bin_location_id"]), r["movement"], r["inventory_category"], nstr(r["base_qty"])) for r in new)
    want = sorted([(x["material_id"], x["bin"], "OUT", x["category"], nstr(x["base_qty"])) for x in plan["out_rows"]]
                  + [(x["material_id"], x["bin"], "IN", "Unrestricted", nstr(x["base_qty"])) for x in plan["in_rows"]])
    if got != want:
        fails.append(f"movements {len(got)} != designed {len(want)}: extra {sorted(set(got) - set(want))[:3]} missing {sorted(set(want) - set(got))[:3]}")
    want_ib = {}
    for x in plan["out_rows"]:
        k = f"{x['material_id']}/{x['bin']}"
        want_ib[k] = want_ib.get(k, Decimal(0)) - Decimal(str(x["base_qty"]))
    for x in plan["in_rows"]:
        k = f"{x['material_id']}/{x['bin']}"
        want_ib[k] = want_ib.get(k, Decimal(0)) + Decimal(str(x["base_qty"]))
    for r in foreign(before, after):
        k = f"{r['item_id']}/{r['bin_location_id']}"
        want_ib[k] = want_ib.get(k, Decimal(0)) + (1 if r["movement"] == "IN" else -1) * (num(r["base_qty"]) or 0)
    want_ib = {k: format(v.normalize(), "f") for k, v in want_ib.items() if v != 0}
    got_ib = {k: d.get("balance_quantity") for k, d in qty_delta("ib", ("material_id", "location_id"), before, after, own).items() if d.get("balance_quantity")}
    if got_ib != want_ib:
        diff = {k: (got_ib.get(k), want_ib.get(k)) for k in set(got_ib) | set(want_ib) if got_ib.get(k) != want_ib.get(k)}
        fails.append(f"item_balance deltas differ from the design on {len(diff)} keys (got, designed): {dict(list(diff.items())[:3])}")
    return fails


# ------------------------------------------------------------------------------------------------ V2-only checks
def v2_checks(tag, before, after, v2):
    out = []
    oj = {str(j["id"]) for j in before.get("job", [])}
    jobs = [j for j in after.get("job", []) if str(j["id"]) not in oj and j.get("command") == "COMPLETE_IDA"]
    held = [r for r in after.get("lock", []) if str(r.get("free_token")) != "1"]
    out.append((not held, f"{tag}: no inventory_balance_lock held after ({len(held)} held{': ' + str([r['lock_key'] for r in held][:4]) if held else ''})"))
    no = number_of(after)
    newmv = [r for r in new_rows("mv", before, after) if r.get("trx_no") == no and r.get("transaction_type") == "IDA"]
    if not v2:
        out.append((not jobs, f"{tag} (classic): no COMPLETE_IDA job ({len(jobs)})"))
        out.append((all(blank(r.get("operation_effect_key")) for r in newmv), f"{tag} (classic): {len(newmv)} new IDA movements, none keyed"))
        return out
    out.append((len(jobs) == 1, f"{tag} (V2): one new COMPLETE_IDA job ({len(jobs)})"))
    if not jobs:
        return out
    j = jobs[0]
    jid = str(j["id"])
    out.append((j["job_status"] == "COMPLETED" and blank(j.get("error_code")) and str(j.get("progress_percent")) == "100",
                f"{tag} (V2): job {jid} {j['job_status']} {j.get('progress_percent')}% {j.get('error_code') or ''} {(j.get('error_message') or '')[:120]}"))
    steps = {(str(s_["job_id"]), s_["step_name"]): s_ for s_ in after.get("step", [])}
    batchy = any(n == "D1_BATCH" for (x, n) in steps if x == jid) or any(k.startswith("<own batch") for k in own_batches(before, after).values())
    need = ["D0_REVALIDATE", "D2_ISSUE", "D3_RECEIPT", "D4_FINISH"] + (["D1_BATCH"] if batchy else [])
    missing = [n for n in need if steps.get((jid, n), {}).get("step_status") != "DONE"]
    out.append((not missing, f"{tag} (V2): steps DONE {sorted(n for (x, n) in steps if x == jid and n[:1] == 'D' and '|' not in n)}" + (f", missing {missing}" if missing else "")))
    for side in ("I", "R"):
        eng = sorted(n for (x, n) in steps if x == f"IDC|{jid}|{side}")
        out.append(("IBA|DONE" in eng and "IBA|REVIEW" not in eng, f"{tag} (V2): engine rows under IDC|{jid}|{side}: {eng[:4]}{' ...' if len(eng) > 4 else ''}"))
    ida = (after.get("ida") or [{}])[0]
    out.append((ida.get("item_disassembly_status") == "Completed" and ida.get("posted_status") == "Unposted" and str(ida.get("ida_v2_job_id")) == jid,
                f"{tag} (V2): IDA {ida.get('stock_movement_no')} {ida.get('item_disassembly_status')} / {ida.get('posted_status')} ida_v2_job_id {ida.get('ida_v2_job_id')}"))
    bad = [r for r in newmv if not (str(r.get("operation_effect_key") or "").startswith(f"IDC|{jid}|I|M") if r["movement"] == "OUT"
                                    else str(r.get("operation_effect_key") or "").startswith(f"IDC|{jid}|R|R"))]
    out.append((bool(newmv) and not bad, f"{tag} (V2): {len(newmv)} new IDA movements keyed IDC|{jid}|I|M<n> / IDC|{jid}|R|R<k> ({len(bad)} not)"))
    return out


def nothing_moved(before, after, code):
    """this IDA moved nothing: no movement of its number, every balance delta explained by OTHER documents' window movements, no live
    Batch row of its number, the job FAILED with the code, the IDA back to Draft, no lock held"""
    fails = 0
    own = own_batches(before, after)
    no = number_of(after)
    mv = [r for r in new_rows("mv", before, after) if r.get("trx_no") == no and r.get("transaction_type") == "IDA"]
    fails += 1 if mv else 0
    print(("  ok    " if not mv else "  FAIL  ") + f"no movement of this IDA {no} ({len(mv)})")
    fo = foreign(before, after)
    want = {}
    for r in fo:
        k = f"{r['item_id']}/{r['bin_location_id']}"
        want[k] = want.get(k, Decimal(0)) + (1 if r["movement"] == "IN" else -1) * (num(r["base_qty"]) or 0)
    want = {k: format(v.normalize(), "f") for k, v in want.items() if v != 0}
    got = {k: d.get("balance_quantity") for k, d in qty_delta("ib", ("material_id", "location_id"), before, after, own).items() if d.get("balance_quantity")}
    bad = {k: (got.get(k), want.get(k)) for k in set(got) | set(want) if got.get(k) != want.get(k)}
    fails += 1 if bad else 0
    print(("  ok    " if not bad else "  FAIL  ") + f"item_balance deltas = the {len(fo)} foreign window movement(s) ({len(bad)} keys off {dict(list(bad.items())[:3])})")
    fmats = {str(r["item_id"]) for r in fo}
    for t, d in (("ibb", qty_delta("ibb", ("material_id", "location_id", "batch_id"), before, after, own)), ("fifo", fifo_delta(before, after, own)), ("wa", wa_delta(before, after, own))):
        mine = {k: v for k, v in d.items() if k.split(" ")[-1].split("/")[0] not in fmats}
        fails += 1 if mine else 0
        print(("  ok    " if not mine else "  FAIL  ") + f"{t}: {len(mine)} change(s) on materials no foreign movement touched" + (f" {str(mine)[:300]}" if mine else "")
              + (f" ({len(d) - len(mine)} on foreign-moved materials)" if len(d) != len(mine) else ""))
    oj = {str(j["id"]) for j in before.get("job", [])}
    jobs = [j for j in after.get("job", []) if str(j["id"]) not in oj]
    j = jobs[0] if jobs else {}
    ok = len(jobs) == 1 and j.get("job_status") == "FAILED" and (not code or j.get("error_code") == code)
    fails += 0 if ok else 1
    print(("  ok    " if ok else "  FAIL  ") + f"one new job FAILED {code}: {[(x['id'], x['job_status'], x.get('error_code'), (x.get('error_message') or '')[:160]) for x in jobs]}")
    ida = (after.get("ida") or [{}])[0]
    ok = ida.get("item_disassembly_status") == "Draft"
    fails += 0 if ok else 1
    print(("  ok    " if ok else "  FAIL  ") + f"the IDA is back to Draft (the unlock): {ida.get('id')} {ida.get('stock_movement_no')} {ida.get('item_disassembly_status')}")
    live_batch = [r for r in new_rows("batch", before, after) if not is_deleted(r) and r.get("transaction_no") == no]
    fails += 1 if live_batch else 0
    print(("  ok    " if not live_batch else "  FAIL  ") + f"no live Batch row of this IDA left ({len(live_batch)}: {[(r['id'], r['batch_number']) for r in live_batch][:3]})")
    held = [r for r in after.get("lock", []) if str(r.get("free_token")) != "1"]
    fails += 1 if held else 0
    print(("  ok    " if not held else "  FAIL  ") + f"no lock held ({[r['lock_key'] for r in held][:4]})")
    bnc = bnc_delta(before, after)
    if bnc:
        print(f"  info  batch_number_config advanced {bnc} (numbers consumed - by D1 before the failure, as the classic, or by a foreign writer)")
    print("NOTHING MOVED" if not fails else f"{fails} CHECK(S) FAILED")
    return fails


def main():
    if "--nothing-moved" in sys.argv:
        i = sys.argv.index("--nothing-moved")
        b, a = json.load(open(sys.argv[i + 1])), json.load(open(sys.argv[i + 2]))
        code = sys.argv[sys.argv.index("--code") + 1] if "--code" in sys.argv else ""
        sys.exit(1 if nothing_moved(b, a, code) else 0)
    files = [x for x in sys.argv[1:] if not x.startswith("--")]
    for o in ("--expect", "--json"):
        if o in sys.argv:
            files.remove(sys.argv[sys.argv.index(o) + 1])
    if len(files) < 4:
        raise SystemExit(__doc__)
    A0, A1, B0, B1 = [json.load(open(p)) for p in files[:4]]
    if MASK_PRICES:
        if "--expect" not in sys.argv:
            raise SystemExit("--mask-prices needs --expect plan.json: it is only for twins whose issue takes FIFO layers of different prices")
        used = {x for x in json.load(open(sys.argv[sys.argv.index("--expect") + 1])).get("fifo_layers_used") or []}
        if len(used) < 2:
            raise SystemExit(f"refusing --mask-prices: plan.json's fifo_layers_used {sorted(used)} is one price - the twins issue at the same price, compare it")
    report, bad, delib = compare(A0, A1, B0, B1)
    print("TWIN PARITY (A = classic, B = V2; deltas, ids / numbers / clocks masked" + ("; PRICES MASKED" if MASK_PRICES else "") + ")")
    for r in report:
        print(f"  {r['table']:6s} A {r['A']:5d}  B {r['B']:5d}  {'SAME' if r['same'] else 'DIFFER'}")
        for d in r["diffs"][:12]:
            print(f"      {d['key']}")
            for c in d["columns"]:
                print(f"         ~ {c}"[:400])
            print(f"         A: {str(d['A'])[:600]}")
            print(f"         B: {str(d['B'])[:600]}")
    for x in sorted(set(delib)):
        print("  DELIBERATE " + x)
    for tag, b, a in (("A", A0, A1), ("B", B0, B1)):
        fo = foreign(b, a)
        if fo:
            print(f"  FOREIGN {tag}: {len(fo)} movement(s) of other documents on these items in the window (they explain a balance DIFFER): "
                  + str(sorted({(r.get('transaction_type'), r.get('trx_no')) for r in fo})[:6]))
    fails = 0
    if "--expect" in sys.argv:
        plan = json.load(open(sys.argv[sys.argv.index("--expect") + 1]))
        print("DESIGNED MOVES (" + str(plan.get("tag", "")) + ")")
        for tag, b, a in (("A", A0, A1), ("B", B0, B1)):
            f = check_expect(b, a, plan)
            fails += len(f)
            print(f"  {tag}: " + ("PASS" if not f else "FAIL"))
            for x in f:
                print("     - " + x)
    print("V2 CHECKS")
    for tag, b, a, v2 in (("A", A0, A1, False), ("B", B0, B1, True)):
        for ok, text in v2_checks(tag, b, a, v2):
            fails += 0 if ok else 1
            print(("  ok    " if ok else "  FAIL  ") + text)
    print(f"tables differing: {bad}; failed checks: {fails}")
    if "--json" in sys.argv:
        with open(sys.argv[sys.argv.index("--json") + 1], "w") as fh:
            json.dump({"report": report, "deliberate": delib, "tables_differing": bad, "failed_checks": fails}, fh, default=str, indent=1)
    sys.exit(1 if bad or fails else 0)


if __name__ == "__main__":
    main()

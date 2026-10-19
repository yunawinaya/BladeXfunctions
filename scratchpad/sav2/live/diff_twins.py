"""diff_twins.py <A_before> <A_after> <B_before> <B_after> [--expect manifest.json] [--json out.json]
diff_twins.py --nothing-moved <before> <after> [--code SA_INVENTORY_INSUFFICIENT]     (F1: a failed V2 job moved nothing)

Twin parity for SA V2 (package F): each twin's own delta (before -> after, snap.py), made comparable across the twins, then A's
delta (classic) against B's (V2), table by table. Twins run SEQUENTIALLY on the same SAV2T items (A before / after, then B before /
after), so rows both twins touch (balances, cost rows, items) compare as DELTAS, never as absolute values.
  masked (compared as "changed / present or not"): ids and document ids, numbers, timestamps, the new FIFO layer's sequence
  skipped: create / update user, dept and time
  expected V2-only (ignored, listed under V2 CHECKS): inventory_movement.operation_effect_key, stock_adjustment.sa_v2_job_id /
  sa_idem_key, gd_async_job, gd_publish_step, inventory_balance_lock
  balance_index: compared by its movement fields per entry (material, plant, bin, batch, category, movement_type, sa_quantity,
  balance_id); the balance-row snapshot an entry carries (quantities / clocks at the time the form or the review read it) is
  state, not effect
  NULL and '' compare equal (a column one twin turns NULL -> '' is listed as INFO: the engine's remark gap)
Every remaining difference is listed (key, A, B, the columns that differ). --expect also checks each twin against the
builder's designed moves (manifest.json expected_per_twin). Exit 1 on any difference / failed expectation / failed V2 check."""
import json, sys
from decimal import Decimal, InvalidOperation

SKIP = {"create_user", "update_user", "create_dept", "create_time", "update_time"}
EXPECTED = {"operation_effect_key", "sa_v2_job_id", "sa_idem_key"}
MASK = {"id", "stock_adjustment_id", "stock_count_id", "adjustment_no", "adjustment_no_sn", "trx_no", "parent_trx_no", "stock_count_no", "stock_count_no_sn",
        "last_transaction_date", "created_at", "updated_at", "claimed_at", "last_released_at"}
MASK_NEW = {"fifo_sequence"}
QTY = {"balance_quantity", "reserved_qty", "unrestricted_qty", "block_qty", "qualityinsp_qty", "intransit_qty", "fifo_available_quantity", "wa_quantity"}
ENTRY_KEYS = ("material_id", "plant_id", "location_id", "batch_id", "category", "movement_type", "sa_quantity", "balance_id")
# role keys (identical for both twins: same items, bins, batch) and the unchanged columns that identify a changed row
TABLES = [
    ("ib", ("material_id", "location_id"), ()),
    ("ibb", ("material_id", "location_id", "batch_id"), ()),
    ("fifo", ("material_id", "batch_id"), ("fifo_sequence", "fifo_cost_price")),
    ("wa", ("material_id", "batch_id"), ()),
    ("batch", ("material_id", "batch_number"), ()),
    ("mv", ("item_id", "bin_location_id", "batch_number_id", "movement"), ()),
    ("item", ("material_code",), ()),
    ("sa", None, ()),
    ("sal", ("line_index",), ("material_id",)),
    ("sc", None, ()),
    ("scl", ("line_index",), ("material_id", "location_id", "batch_id")),
]


def blank(v):
    return v is None or v == ""


def num(v):
    if isinstance(v, bool) or v is None:
        return None
    try:
        return Decimal(str(v)).normalize()
    except (InvalidOperation, ValueError):
        return None


def same(x, y):
    if blank(x) and blank(y):
        return True
    a, b = num(x), num(y)
    if a is not None and b is not None:
        return a == b
    return str(x) == str(y)


def norm_bi(v):
    """balance_index -> its entries' movement fields (canonical text); unparsable -> the text itself"""
    if blank(v):
        return ""
    try:
        ents = json.loads(v) if isinstance(v, str) else v
    except ValueError:
        return "UNPARSABLE:" + str(v)
    if not isinstance(ents, list):
        return "NOT-A-LIST:" + str(v)
    out = []
    for e in ents:
        if not isinstance(e, dict):
            out.append(str(e))
            continue
        out.append("|".join(f"{k}={str(num(e.get(k)) if num(e.get(k)) is not None and k == 'sa_quantity' else ('' if blank(e.get(k)) else e.get(k)))}"
                            for k in ENTRY_KEYS))
    return " ; ".join(out)


def val(table, col, v):
    if col == "balance_index":
        return norm_bi(v)
    if blank(v):
        return ""
    if _numeric_col(col):
        n = num(v)
        return str(n) if n is not None else str(v)
    return str(v)


def _numeric_col(col):
    return col in QTY or col.endswith(("_qty", "_quantity", "_price")) or col in ("unit_price", "total_price", "base_qty", "actual_qty", "actual_base_qty",
                                                                                   "total_quantity", "count_qty", "variance_qty", "adjusted_qty", "system_qty")


def live(rows, table):
    return [r for r in rows if table not in ("sal", "scl", "sa", "sc") or str(r.get("is_deleted", 0)) in ("0", "None")]


def rowdelta(table, b, a):
    out, info = {}, []
    for k in sorted(set(b) | set(a)):
        if k in SKIP or k in EXPECTED:
            continue
        x, y = b.get(k), a.get(k)
        if same(x, y):
            if x is None and y == "" or x == "" and y is None:
                info.append(f"{k} {x!r} -> {y!r}")
            continue
        if k == "balance_index" and norm_bi(x) == norm_bi(y):
            continue
        if k in MASK:
            out[k] = "*"
        elif k in QTY and num(x) is not None and num(y) is not None:
            out[k] = "d" + str((num(y) - num(x)).normalize())
        else:
            out[k] = val(table, k, y)
    return out, info


def keyof(table, spec, r):
    if spec is None:
        return table.upper()
    return "/".join("-" if blank(r.get(c)) else str(r.get(c)) for c in spec)


def delta(table, spec, ident, before, after):
    bi = {str(r["id"]): r for r in live(before.get(table, []), table)}
    ai = {str(r["id"]): r for r in live(after.get(table, []), table)}
    sig, info = {}, []
    docs = 0
    for i, r in ai.items():
        if i in bi:
            d, inf = rowdelta(table, bi[i], r)
            info += [f"{table} {keyof(table, spec, r)}: {x}" for x in inf]
            if not d:
                continue
            k = keyof(table, spec, bi[i])
            if spec is None:
                k = f"{table.upper()}#{docs}"
                docs += 1
            idt = tuple((c, val(table, c, bi[i].get(c))) for c in ident)
            sig.setdefault(k, []).append(("chg",) + idt + tuple(sorted(d.items())))
        else:
            k = keyof(table, spec, r)
            if spec is None:
                k = f"{table.upper()}#{docs}"
                docs += 1
            cols = tuple(sorted((c, "*" if c in MASK or c in MASK_NEW else val(table, c, v)) for c, v in r.items()
                                if c not in SKIP and c not in EXPECTED and not blank(v)))
            sig.setdefault(k, []).append(("new",) + cols)
    for i, r in bi.items():
        if i not in ai:
            sig.setdefault(keyof(table, spec, r), []).append(("gone",))
    was_live = {str(r["id"]) for r in before.get(table, []) if str(r.get("is_deleted", 0)) in ("0", "None")}
    soft = [r for r in after.get(table, []) if str(r.get("is_deleted", 0)) not in ("0", "None")
            and (str(r["id"]) in was_live or str(r["id"]) not in {str(x["id"]) for x in before.get(table, [])})]
    if soft and table in ("sal", "scl"):
        info.append(f"{table}: {len(soft)} row(s) soft-deleted in this window")
    return {k: sorted(v, key=str) for k, v in sig.items()}, info


def explain(sa, sb):
    """which columns differ between two signature lists"""
    def cols(sig):
        out = {}
        for s in sig:
            for c in s[1:]:
                if isinstance(c, tuple) and len(c) == 2:
                    out.setdefault(c[0], set()).add(str(c[1]))
        return out
    ca, cb = cols(sa or []), cols(sb or [])
    diff = []
    for c in sorted(set(ca) | set(cb)):
        if ca.get(c) != cb.get(c):
            diff.append(f"{c}: A {sorted(ca.get(c, []))} B {sorted(cb.get(c, []))}")
    if len(sa or []) != len(sb or []):
        diff.insert(0, f"row count A {len(sa or [])} B {len(sb or [])}")
    return diff


def item_touch(before, after):
    """item: both twins write the same doc date, so B's value change can vanish behind A's - compare (touched, value after)"""
    bi = {str(r["id"]): r for r in before.get("item", [])}
    return {r["material_code"]: [("touched", str(r.get("last_transaction_date")))] for r in after.get("item", [])
            if str(r.get("update_time")) != str((bi.get(str(r["id"])) or {}).get("update_time"))}, []


def compare(A0, A1, B0, B1):
    report, bad, infos = [], 0, []
    for table, spec, ident in TABLES:
        if table == "item":
            (sa, ia), (sb, ib) = item_touch(A0, A1), item_touch(B0, B1)
        else:
            sa, ia = delta(table, spec, ident, A0, A1)
            sb, ib = delta(table, spec, ident, B0, B1)
        infos += ["A " + x for x in ia] + ["B " + x for x in ib]
        diffs = []
        for k in sorted(set(sa) | set(sb), key=str):
            if sa.get(k) != sb.get(k):
                diffs.append({"key": k, "A": sa.get(k), "B": sb.get(k), "columns": explain(sa.get(k), sb.get(k))})
        bad += 1 if diffs else 0
        report.append({"table": table, "A": sum(len(v) for v in sa.values()), "B": sum(len(v) for v in sb.values()), "same": not diffs, "diffs": diffs})
    return report, bad, infos


# ------------------------------------------------------------------------------------------------ the designed moves (--expect)
def check_expect(tag, before, after, exp):
    fails = []
    D = lambda v: Decimal(str(v))  # noqa: E731

    def bal_delta(table, keycols):
        b = {"|".join(str(r[c]) for c in keycols): D(r["balance_quantity"]) for r in before.get(table, []) if str(r.get("is_deleted", 0)) == "0"}
        out = {}
        for r in after.get(table, []):
            if str(r.get("is_deleted", 0)) != "0":
                continue
            k = "|".join(str(r[c]) for c in keycols)
            d = D(r["balance_quantity"]) - b.get(k, Decimal(0))
            if d != 0:
                out[k] = d
        return out
    for table, cols, ek in (("ib", ("material_id", "location_id"), "ib"), ("ibb", ("material_id", "location_id", "batch_id"), "ibb")):
        got = bal_delta(table, cols)
        want = {k: D(v) for k, v in exp.get(ek, {}).items() if D(v) != 0}
        if got != want:
            fails.append(f"{table} balance_quantity deltas {dict((k[-30:], str(v)) for k, v in got.items())} != designed {dict((k[-30:], str(v)) for k, v in want.items())}")
    old = {str(r["id"]) for r in before.get("mv", [])}
    new = [r for r in after.get("mv", []) if str(r["id"]) not in old]
    got = sorted((str(r["item_id"]), str(r["bin_location_id"]), "" if blank(r.get("batch_number_id")) else str(r["batch_number_id"]), r["movement"],
                  str(D(r["quantity"]).normalize()), str(D(r["base_qty"]).normalize()), str(r["uom_id"])) for r in new)
    want = sorted((m["item_id"], m["bin"], m["batch"], m["movement"], str(D(m["quantity"]).normalize()), str(D(m["base_qty"]).normalize()), m["uom_id"])
                  for m in exp.get("mv", []))
    if got != want:
        fails.append(f"movements {len(got)} != designed {len(want)}: extra {sorted(set(got) - set(want))[:4]} missing {sorted(set(want) - set(got))[:4]}")
    for m in exp.get("mv", []):
        if m["movement"] == "IN" and m.get("unit_price_in") not in (None, "review cost"):
            hit = [r for r in new if str(r["item_id"]) == m["item_id"] and str(r["bin_location_id"]) == m["bin"] and r["movement"] == "IN"
                   and D(r["quantity"]) == D(m["quantity"]) and D(r["unit_price"]) == D(m["unit_price_in"])]
            if not hit:
                fails.append(f"no IN movement of {m['item_id'][-6:]} in {m['bin'][-6:]} qty {m['quantity']} @ {m['unit_price_in']}")
    oldf = {str(r["id"]) for r in before.get("fifo", [])}
    newf = {}
    for r in after.get("fifo", []):
        if str(r["id"]) not in oldf:
            newf.setdefault(f"{r['material_id']}|{'' if blank(r.get('batch_id')) else r['batch_id']}", []).append(
                (str(D(r["fifo_initial_quantity"]).normalize()), str(D(r["fifo_cost_price"]).normalize())))
    for k, layers in exp.get("fifo_new", {}).items():
        want = sorted((str(D(q).normalize()), p) for q, p in layers)
        have = sorted(newf.get(k, []))
        if [w[0] for w in want] != [h[0] for h in have] or any(w[1] != "review cost" and str(D(w[1]).normalize()) != h[1] for w, h in zip(want, have)):
            fails.append(f"new FIFO layers {k[-30:]}: {have} != designed {want}")
    for k in set(newf) - set(exp.get("fifo_new", {})):
        fails.append(f"unexpected new FIFO layers {k[-30:]}: {newf[k]}")
    wb = {str(r["material_id"]): D(r["wa_quantity"]) for r in before.get("wa", [])}
    for mat, d in exp.get("wa_qty", {}).items():
        wa = [r for r in after.get("wa", []) if str(r["material_id"]) == mat]
        got_d = sum(D(r["wa_quantity"]) for r in wa) - wb.get(mat, Decimal(0))
        if got_d != D(d):
            fails.append(f"WA quantity of {mat[-6:]} moved {got_d}, designed {d}")
    return fails


# ------------------------------------------------------------------------------------------------ V2-only checks
def v2_checks(tag, before, after, v2):
    out = []
    oj = {str(j["id"]) for j in before.get("job", [])}
    jobs = [j for j in after.get("job", []) if str(j["id"]) not in oj]
    held = [r for r in after.get("lock", []) if str(r.get("free_token")) != "1"]
    out.append((not held, f"{tag}: no inventory_balance_lock held after ({len(held)} held{': ' + str([r['lock_key'] for r in held][:4]) if held else ''})"))
    if not v2:
        out.append((not jobs, f"{tag} (classic): no COMPLETE_SA job ({len(jobs)})"))
        return out
    out.append((len(jobs) == 1, f"{tag} (V2): one new COMPLETE_SA job ({len(jobs)})"))
    if not jobs:
        return out
    j = jobs[0]
    out.append((j["job_status"] == "COMPLETED" and blank(j.get("error_code")), f"{tag} (V2): job {j['id']} {j['job_status']} {j.get('error_code') or ''} {(j.get('error_message') or '')[:120]}"))
    steps = {(str(s["job_id"]), s["step_name"]): s for s in after.get("step", [])}
    jid = str(j["id"])
    try:
        req = json.loads(j.get("request_payload") or "{}")
    except ValueError:
        req = {}
    review = req.get("action") == "REVIEW"
    need = ["A0_REVALIDATE", "A2_INVENTORY", "A4_REORDER", "A4_FINISH"] + (["A1_SA_LINES"] if review or str(req.get("edited")) == "1" else []) \
        + (["A3_STOCK_COUNT"] if review or str(req.get("scId") or "") not in ("", "0") else [])
    missing = [n for n in need if steps.get((jid, n), {}).get("step_status") != "DONE"]
    out.append((not missing, f"{tag} (V2): steps DONE {sorted(n for (x, n) in steps if x == jid and n.startswith('A'))}" + (f", missing {missing}" if missing else "")))
    eng = sorted(n for (x, n) in steps if x == "SAC|" + jid)
    out.append(("IBA|DONE" in eng and "IBA|REVIEW" not in eng, f"{tag} (V2): engine rows under SAC|{jid}: {eng}"))
    corr = str(j.get("correlation_id") or "")
    sa = [r for r in after.get("sa", []) if "SA|" + str(r["id"]) == corr]
    out.append((bool(sa) and sa[0].get("stock_adjustment_status") == "Completed" and str(sa[0].get("sa_v2_job_id")) == jid,
                f"{tag} (V2): SA {corr} " + (f"{sa[0].get('stock_adjustment_status')} {sa[0].get('adjustment_no')} sa_v2_job_id {sa[0].get('sa_v2_job_id')}" if sa else "not found")))
    oe = {str(r["id"]) for r in before.get("mv", [])}
    keyed = [r for r in after.get("mv", []) if str(r["id"]) not in oe]
    bad = [r for r in keyed if not str(r.get("operation_effect_key") or "").startswith("SAC|" + jid + "|M")]
    out.append((keyed and not bad, f"{tag} (V2): {len(keyed)} new movements, all keyed SAC|{jid}|M<n> ({len(bad)} not)"))
    return out


def nothing_moved(before, after, code):
    """F1: a V2 job that must fail before any stock moved - no stock / cost / movement / item change, the job FAILED with `code`,
    its SA back to Draft, no lock held"""
    fails = 0
    for table, spec, ident in TABLES:
        if table in ("sa", "sal", "sc", "scl"):
            continue
        sig, _ = delta(table, spec, ident, before, after)
        n = sum(len(v) for v in sig.values())
        fails += 1 if n else 0
        print(("  ok    " if not n else "  FAIL  ") + f"{table}: {n} change(s)" + (f" {str(sig)[:300]}" if n else ""))
    oj = {str(j["id"]) for j in before.get("job", [])}
    jobs = [j for j in after.get("job", []) if str(j["id"]) not in oj]
    j = jobs[0] if jobs else {}
    ok = len(jobs) == 1 and j.get("job_status") == "FAILED" and (not code or j.get("error_code") == code)
    fails += 0 if ok else 1
    print(("  ok    " if ok else "  FAIL  ") + f"one new job FAILED {code}: {[(x['id'], x['job_status'], x.get('error_code'), (x.get('error_message') or '')[:160]) for x in jobs]}")
    corr = str(j.get("correlation_id") or "")
    sa = [r for r in after.get("sa", []) if "SA|" + str(r["id"]) == corr]
    ok = bool(sa) and sa[0].get("stock_adjustment_status") == "Draft"
    fails += 0 if ok else 1
    print(("  ok    " if ok else "  FAIL  ") + f"its SA back to Draft: {[(r['id'], r.get('adjustment_no'), r.get('stock_adjustment_status')) for r in sa]}")
    held = [r for r in after.get("lock", []) if str(r.get("free_token")) != "1"]
    fails += 1 if held else 0
    print(("  ok    " if not held else "  FAIL  ") + f"no lock held ({[r['lock_key'] for r in held][:4]})")
    print("NOTHING MOVED" if not fails else f"{fails} CHECK(S) FAILED")
    return fails


def main():
    if "--nothing-moved" in sys.argv:
        i = sys.argv.index("--nothing-moved")
        b, a = json.load(open(sys.argv[i + 1])), json.load(open(sys.argv[i + 2]))
        code = sys.argv[sys.argv.index("--code") + 1] if "--code" in sys.argv else ""
        sys.exit(1 if nothing_moved(b, a, code) else 0)
    if len(sys.argv) < 5:
        raise SystemExit(__doc__)
    A0, A1, B0, B1 = [json.load(open(p)) for p in sys.argv[1:5]]
    report, bad, infos = compare(A0, A1, B0, B1)
    print("TWIN PARITY (A = classic, B = V2; deltas, ids / numbers / clocks masked)")
    for r in report:
        print(f"  {r['table']:6s} A {r['A']:3d} changes  B {r['B']:3d}  {'SAME' if r['same'] else 'DIFFER'}")
        for d in r["diffs"]:
            print(f"      {d['key']}")
            for c in d["columns"]:
                print(f"         ~ {c}"[:400])
            print(f"         A: {str(d['A'])[:700]}")
            print(f"         B: {str(d['B'])[:700]}")
    for i in sorted(set(infos)):
        print("  INFO " + i)
    fails = 0
    if "--expect" in sys.argv:
        m = json.load(open(sys.argv[sys.argv.index("--expect") + 1]))
        exp = m.get("expected_per_twin") or m
        print("DESIGNED MOVES (" + str(m.get("step", "")) + ")")
        for tag, b, a in (("A", A0, A1), ("B", B0, B1)):
            f = check_expect(tag, b, a, exp)
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
            json.dump({"report": report, "infos": infos, "tables_differing": bad, "failed_checks": fails}, fh, default=str, indent=1)
    sys.exit(1 if bad or fails else 0)


if __name__ == "__main__":
    main()

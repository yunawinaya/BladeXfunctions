"""diff_twins_ia.py <A_before> <A_after> <B_before> <B_after> [--expect plan.json] [--mask-prices] [--json out.json]
diff_twins_ia.py --nothing-moved <before> <after> [--code IA_INVENTORY_INSUFFICIENT]     (verification item 7: a FAILED job moved nothing)

Twin parity for Item Assembly V2 (package E): each twin's own delta (before -> after, snap_ia.py), made comparable across the twins,
then A's delta (classic IA_SAVE) against B's (V2), table by table. Twins run SEQUENTIALLY on the same stock (A before / after, then B
before / after), so rows both twins touch (balances, cost rows, items) compare as DELTAS, never as absolute values. Template: the
CURRENT scratchpad/sav2/live/diff_twins.py (items compared by update_time; masks; --expect; V2 checks; --nothing-moved).
  masked (compared as changed / present): ids and document ids, numbers (stock_movement_no, the generated batch number, trx_no),
  timestamps, the new FIFO layer's sequence; a twin's OWN new Batch row id is one token (<own batch>) wherever it appears
  skipped: create / update user, dept and time, sub_tenant_id (platform bookkeeping)
  deliberate V2 differences (ignored, listed under DELIBERATE / V2 CHECKS): inventory_movement.operation_effect_key; the classic's
  BLANK Batch row of a non-batch parent (batch_number ''); sm_item_assembly.ia_v2_job_id / ia_idem_key; gd_async_job,
  gd_publish_step, inventory_balance_lock rows
  temp_qty_data: compared by its picks (material, bin, batch, category, sm_quantity); the balance snapshot a pick carries is state
  NULL and '' compare equal; --mask-prices masks unit_price / total_price / fifo_cost_price / wa_cost_price (use it only when the
  builder's plan.json says the twins' FIFO consumption could not price alike - then recon_ia.py proves B's prices by formula)
Every remaining difference is listed (key, A, B, the columns that differ). Exit 1 on any difference / failed expectation / check."""
import json, sys
from decimal import Decimal, InvalidOperation

SKIP = {"create_user", "update_user", "create_dept", "create_time", "update_time", "sub_tenant_id"}
EXPECTED = {"operation_effect_key", "ia_v2_job_id", "ia_idem_key"}
MASK = {"id", "sm_item_assembly_id", "stock_movement_no", "stock_movement_no_sn", "trx_no", "parent_trx_no", "transaction_no", "batch_no", "batch_number",
        "last_transaction_date", "created_at", "updated_at", "claimed_at", "last_released_at", "fm_key"}
MASK_NEW = {"fifo_sequence"}
PRICES = {"unit_price", "total_price", "fifo_cost_price", "wa_cost_price"}
QTY = {"balance_quantity", "reserved_qty", "unrestricted_qty", "block_qty", "qualityinsp_qty", "intransit_qty", "fifo_available_quantity", "wa_quantity"}
PICK_KEYS = ("material_id", "location_id", "batch_id", "category", "sm_quantity")
BATCHY = {"batch_id", "batch_number_id"}
TABLES = [
    ("ib", ("material_id", "location_id"), ()),
    ("ibb", ("material_id", "location_id", "batch_id"), ()),
    ("fifo", ("material_id", "batch_id"), ("fifo_sequence", "fifo_cost_price")),
    ("wa", ("material_id", "batch_id"), ()),
    ("batch", ("material_id",), ()),
    ("mv", ("item_id", "bin_location_id", "batch_number_id", "movement", "transaction_type"), ()),
    ("item", ("material_code",), ()),
    ("ia", None, ()),
    ("ial", ("line_index",), ("item_selection",)),
]
MASK_PRICES = "--mask-prices" in sys.argv


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


def own_batches(before, after):
    """the batch ids a twin created in its window (its I1 / ADD_INVENTORY Batch row)"""
    old = {str(r["id"]) for r in before.get("batch", [])}
    return {str(r["id"]) for r in after.get("batch", []) if str(r["id"]) not in old}


def norm_picks(v):
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
        out.append("|".join(f"{k}={str(num(e.get(k))) if k == 'sm_quantity' and num(e.get(k)) is not None else ('' if blank(e.get(k)) else e.get(k))}" for k in PICK_KEYS))
    return " ; ".join(out)


def val(col, v, own):
    if col == "temp_qty_data":
        return norm_picks(v)
    if blank(v):
        return ""
    if col in BATCHY and str(v) in own:
        return "<own batch>"
    if MASK_PRICES and col in PRICES:
        return "<price>"
    n = num(v)
    if n is not None and (col in QTY or col.endswith(("_qty", "_quantity", "_price")) or col in ("quantity", "base_qty", "actual_qty", "actual_base_qty", "item_qty")):
        return str(n)
    return str(v)


def is_deleted(r):
    return str(r.get("is_deleted", 0)) not in ("0", "None")


def rowdelta(table, b, a, own):
    out, info = {}, []
    for k in sorted(set(b) | set(a)):
        if k in SKIP or k in EXPECTED:
            continue
        x, y = b.get(k), a.get(k)
        if same(x, y):
            if (x is None and y == "") or (x == "" and y is None):
                info.append(f"{k} {x!r} -> {y!r}")
            continue
        if k == "temp_qty_data" and norm_picks(x) == norm_picks(y):
            continue
        if k in MASK:
            out[k] = "*"
        elif k in QTY and num(x) is not None and num(y) is not None:
            out[k] = "d" + str((num(y) - num(x)).normalize())
        else:
            out[k] = val(k, y, own)
    return out, info


def keyof(table, spec, r, own):
    if spec is None:
        return table.upper()
    return "/".join("-" if blank(r.get(c)) else ("<own batch>" if c in BATCHY and str(r.get(c)) in own else str(r.get(c))) for c in spec)


def delta(table, spec, ident, before, after, parent=None):
    own = own_batches(before, after)
    bi = {str(r["id"]): r for r in before.get(table, [])}
    ai = {str(r["id"]): r for r in after.get(table, [])}
    sig, info, deliberate = {}, [], []
    docs = 0
    for i, r in ai.items():
        if i in bi:
            d, inf = rowdelta(table, bi[i], r, own)
            info += [f"{table} {keyof(table, spec, r, own)}: {x}" for x in inf]
            if not d:
                continue
            k = keyof(table, spec, bi[i], own)
            if spec is None:
                k, docs = f"{table.upper()}#{docs}", docs + 1
            idt = tuple((c, val(c, bi[i].get(c), own)) for c in ident)
            sig.setdefault(k, []).append(("chg",) + idt + tuple(sorted(d.items())))
            continue
        if table == "batch" and blank(r.get("batch_number")) and (parent is None or str(r.get("material_id")) == str(parent)):
            deliberate.append(f"batch: blank Batch row {r['id']} of the non-batch parent (the classic's ADD_INVENTORY; V2 writes none)")
            continue
        k = keyof(table, spec, r, own)
        if spec is None:
            k, docs = f"{table.upper()}#{docs}", docs + 1
        cols = tuple(sorted((c, "*" if c in MASK or c in MASK_NEW else val(c, v, own)) for c, v in r.items()
                            if c not in SKIP and c not in EXPECTED and not blank(v) and not (table == "ial" and c in ("is_deleted", "tenant_id"))))
        sig.setdefault(k, []).append(("new",) + cols)
    for i, r in bi.items():
        if i not in ai:
            sig.setdefault(keyof(table, spec, r, own), []).append(("gone",))
    return {k: sorted(v, key=str) for k, v in sig.items()}, info, deliberate


def item_touch(before, after):
    """item: both twins stamp last_transaction_date, so compare (touched or not) by update_time (the SA rule)"""
    bi = {str(r["id"]): r for r in before.get("item", [])}
    return {r["material_code"]: [("touched",)] for r in after.get("item", []) if str(r.get("update_time")) != str((bi.get(str(r["id"])) or {}).get("update_time"))}


def explain(sa, sb):
    def cols(sig):
        out = {}
        for s_ in sig:
            for c in s_[1:]:
                if isinstance(c, tuple) and len(c) == 2:
                    out.setdefault(c[0], set()).add(str(c[1]))
        return out
    ca, cb = cols(sa or []), cols(sb or [])
    diff = [f"{c}: A {sorted(ca.get(c, []))[:4]} B {sorted(cb.get(c, []))[:4]}" for c in sorted(set(ca) | set(cb)) if ca.get(c) != cb.get(c)]
    if len(sa or []) != len(sb or []):
        diff.insert(0, f"row count A {len(sa or [])} B {len(sb or [])}")
    return diff


def parent_of(snap):
    if snap.get("ia"):
        return snap["ia"][0].get("item_id")
    return None


def foreign(before, after):
    """movements in a twin's window that are not its IA's (another session on the same items): they explain a balance DIFFER"""
    no = ((after.get("ia") or [{}])[0]).get("stock_movement_no")
    old = {str(r["id"]) for r in before.get("mv", [])}
    return [r for r in after.get("mv", []) if str(r["id"]) not in old and (r.get("trx_no") != no or r.get("transaction_type") not in ("IA", "IA-R"))]


def compare(A0, A1, B0, B1):
    report, bad, infos, delib = [], 0, [], []
    pa, pb = parent_of(A1), parent_of(B1)
    for table, spec, ident in TABLES:
        if table == "item":
            sa, sb, ia, ib, da, db = item_touch(A0, A1), item_touch(B0, B1), [], [], [], []
        else:
            sa, ia, da = delta(table, spec, ident, A0, A1, pa)
            sb, ib, db = delta(table, spec, ident, B0, B1, pb)
        infos += ["A " + x for x in ia] + ["B " + x for x in ib]
        delib += ["A " + x for x in da] + ["B " + x for x in db]
        diffs = [{"key": k, "A": sa.get(k), "B": sb.get(k), "columns": explain(sa.get(k), sb.get(k))} for k in sorted(set(sa) | set(sb), key=str) if sa.get(k) != sb.get(k)]
        bad += 1 if diffs else 0
        report.append({"table": table, "A": sum(len(v) for v in sa.values()), "B": sum(len(v) for v in sb.values()), "same": not diffs, "diffs": diffs})
    return report, bad, infos, delib


# ------------------------------------------------------------------------------------------------ the designed moves (--expect)
def check_expect(before, after, plan):
    fails = []
    Dd = lambda v: Decimal(str(v))  # noqa: E731
    own = own_batches(before, after)
    old = {str(r["id"]) for r in before.get("mv", [])}
    new = [r for r in after.get("mv", []) if str(r["id"]) not in old and r.get("transaction_type") == "IA"]
    got = sorted((str(r["item_id"]), str(r["bin_location_id"]), "" if blank(r.get("batch_number_id")) else ("<own>" if str(r["batch_number_id"]) in own else str(r["batch_number_id"])),
                  r["movement"], r["inventory_category"], str(Dd(r["base_qty"]).normalize())) for r in new)
    p = plan["parent"]
    want = sorted([(x["material_id"], x["bin"], x["batch_id"] or "", "OUT", x["category"], str(Dd(x["base_qty"]).normalize())) for x in plan["picks"]]
                  + [(p["id"], p["bin"], "<own>" if str(p.get("batch")) == "1" else "", "IN", p.get("category") or "Unrestricted", str(Dd(p["receipt_base_qty"]).normalize()))])
    if got != want:
        fails.append(f"movements {len(got)} != designed {len(want)}: extra {sorted(set(got) - set(want))[:3]} missing {sorted(set(want) - set(got))[:3]}")

    def bal_delta(table, cols):
        b = {"|".join(str(r[c]) for c in cols): Dd(r["balance_quantity"]) for r in before.get(table, []) if not is_deleted(r)}
        out = {}
        for r in after.get(table, []):
            if is_deleted(r):
                continue
            k = "|".join(str(r[c]) for c in cols)
            d = Dd(r["balance_quantity"]) - b.get(k, Decimal(0))
            if d != 0:
                out[k] = d
        return out
    want_ib = {}
    for x in plan["picks"]:
        k = f"{x['material_id']}|{x['bin']}"
        want_ib[k] = want_ib.get(k, Decimal(0)) - Dd(x["base_qty"])
    k = f"{p['id']}|{p['bin']}"
    want_ib[k] = want_ib.get(k, Decimal(0)) + Dd(p["receipt_base_qty"])
    for r in foreign(before, after):
        k = f"{r['item_id']}|{r['bin_location_id']}"
        want_ib[k] = want_ib.get(k, Decimal(0)) + (1 if r["movement"] == "IN" else -1) * Dd(r["base_qty"])
    want_ib = {k: v for k, v in want_ib.items() if v != 0}
    got_ib = bal_delta("ib", ("material_id", "location_id"))
    if got_ib != want_ib:
        diff = {k: (str(got_ib.get(k)), str(want_ib.get(k))) for k in set(got_ib) | set(want_ib) if got_ib.get(k) != want_ib.get(k)}
        fails.append(f"item_balance deltas differ from the design on {len(diff)} keys (got, designed): {dict(list(diff.items())[:3])}")
    return fails


# ------------------------------------------------------------------------------------------------ V2-only checks
def v2_checks(tag, before, after, v2):
    out = []
    oj = {str(j["id"]) for j in before.get("job", [])}
    jobs = [j for j in after.get("job", []) if str(j["id"]) not in oj and j.get("command") == "COMPLETE_IA"]
    held = [r for r in after.get("lock", []) if str(r.get("free_token")) != "1"]
    out.append((not held, f"{tag}: no inventory_balance_lock held after ({len(held)} held{': ' + str([r['lock_key'] for r in held][:4]) if held else ''})"))
    oe = {str(r["id"]) for r in before.get("mv", [])}
    newmv = [r for r in after.get("mv", []) if str(r["id"]) not in oe and r.get("transaction_type") == "IA"]
    if not v2:
        out.append((not jobs, f"{tag} (classic): no COMPLETE_IA job ({len(jobs)})"))
        out.append((all(blank(r.get("operation_effect_key")) for r in newmv), f"{tag} (classic): {len(newmv)} new IA movements, none keyed"))
        return out
    out.append((len(jobs) == 1, f"{tag} (V2): one new COMPLETE_IA job ({len(jobs)})"))
    if not jobs:
        return out
    j = jobs[0]
    jid = str(j["id"])
    out.append((j["job_status"] == "COMPLETED" and blank(j.get("error_code")) and str(j.get("progress_percent")) == "100",
                f"{tag} (V2): job {jid} {j['job_status']} {j.get('progress_percent')}% {j.get('error_code') or ''} {(j.get('error_message') or '')[:120]}"))
    steps = {(str(s_["job_id"]), s_["step_name"]): s_ for s_ in after.get("step", [])}
    ia = (after.get("ia") or [{}])[0]
    batch_parent = any(str(d.get("id")) == str(ia.get("item_id")) and str(d.get("item_batch_management")) == "1" for d in after.get("itemdef", []))
    need = ["I0_REVALIDATE", "I2_ISSUE", "I3_RECEIPT", "I4_FINISH"] + (["I1_BATCH"] if batch_parent else [])
    missing = [n for n in need if steps.get((jid, n), {}).get("step_status") != "DONE"]
    out.append((not missing, f"{tag} (V2): steps DONE {sorted(n for (x, n) in steps if x == jid and n[:1] == 'I')}" + (f", missing {missing}" if missing else "")))
    for side in ("I", "R"):
        eng = sorted(n for (x, n) in steps if x == f"IAC|{jid}|{side}")
        out.append(("IBA|DONE" in eng and "IBA|REVIEW" not in eng, f"{tag} (V2): engine rows under IAC|{jid}|{side}: {eng[:4]}{' ...' if len(eng) > 4 else ''}"))
    out.append((ia.get("item_assembly_status") == "Completed" and ia.get("posted_status") == "Unposted" and str(ia.get("ia_v2_job_id")) == jid,
                f"{tag} (V2): IA {ia.get('stock_movement_no')} {ia.get('item_assembly_status')} / {ia.get('posted_status')} ia_v2_job_id {ia.get('ia_v2_job_id')}"))
    bad = [r for r in newmv if not (str(r.get("operation_effect_key") or "").startswith(f"IAC|{jid}|I|M") if r["movement"] == "OUT"
                                    else str(r.get("operation_effect_key") or "") == f"IAC|{jid}|R|R1")]
    out.append((newmv and not bad, f"{tag} (V2): {len(newmv)} new IA movements keyed IAC|{jid}|I|M<n> / IAC|{jid}|R|R1 ({len(bad)} not)"))
    return out


def nothing_moved(before, after, code):
    fails = 0
    for table, spec, ident in TABLES:
        if table in ("ia", "ial", "item"):
            continue
        sig, _, _ = delta(table, spec, ident, before, after)
        n = sum(len(v) for v in sig.values())
        fails += 1 if n else 0
        print(("  ok    " if not n else "  FAIL  ") + f"{table}: {n} change(s)" + (f" {str(sig)[:300]}" if n else ""))
    oj = {str(j["id"]) for j in before.get("job", [])}
    jobs = [j for j in after.get("job", []) if str(j["id"]) not in oj]
    j = jobs[0] if jobs else {}
    ok = len(jobs) == 1 and j.get("job_status") == "FAILED" and (not code or j.get("error_code") == code)
    fails += 0 if ok else 1
    print(("  ok    " if ok else "  FAIL  ") + f"one new job FAILED {code}: {[(x['id'], x['job_status'], x.get('error_code'), (x.get('error_message') or '')[:160]) for x in jobs]}")
    ia = (after.get("ia") or [{}])[0]
    ok = ia.get("item_assembly_status") == "Draft"
    fails += 0 if ok else 1
    print(("  ok    " if ok else "  FAIL  ") + f"the IA is back to Draft (the unlock): {ia.get('id')} {ia.get('stock_movement_no')} {ia.get('item_assembly_status')}")
    live_batch = [r for r in after.get("batch", []) if not is_deleted(r) and str(r["id"]) in own_batches(before, after)]
    fails += 1 if live_batch else 0
    print(("  ok    " if not live_batch else "  FAIL  ") + f"no live Batch row of this job left ({len(live_batch)})")
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
    files = [x for x in sys.argv[1:] if not x.startswith("--")]
    for opt in ("--expect", "--json"):
        if opt in sys.argv:
            files.remove(sys.argv[sys.argv.index(opt) + 1])
    if len(files) < 4:
        raise SystemExit(__doc__)
    A0, A1, B0, B1 = [json.load(open(p)) for p in files[:4]]
    report, bad, infos, delib = compare(A0, A1, B0, B1)
    print("TWIN PARITY (A = classic, B = V2; deltas, ids / numbers / clocks masked" + ("; PRICES MASKED" if MASK_PRICES else "") + ")")
    for r in report:
        print(f"  {r['table']:6s} A {r['A']:4d} changes  B {r['B']:4d}  {'SAME' if r['same'] else 'DIFFER'}")
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
    for x in sorted(set(infos))[:20]:
        print("  INFO " + x)
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
            json.dump({"report": report, "infos": infos, "deliberate": delib, "tables_differing": bad, "failed_checks": fails}, fh, default=str, indent=1)
    sys.exit(1 if bad or fails else 0)


if __name__ == "__main__":
    main()

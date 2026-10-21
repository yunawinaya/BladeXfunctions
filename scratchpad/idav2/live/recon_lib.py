"""The reconcile's checks as pure functions over rows (recon_ida.py feeds them from dev; test_kit.py from synthetic snapshots). Each returns
(problems, infos) or the values to compare; nothing here reads a database. The stored values the engine writes come from live/ida_expect.js
(core.js arithmetic + the tenant's number rules)."""
import json, os, sys
from decimal import Decimal, InvalidOperation

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import idalib as L  # noqa: E402

PLACEHOLDER = L.PLACEHOLDER


def dec(v):
    try:
        return Decimal(str(v)) if v not in (None, "") else Decimal(0)
    except InvalidOperation:
        return Decimal(0)


def expect(op, precision, **kw):
    """live/ida_expect.js: op qty / in / wa / out / store"""
    return L.node("const E = require('./ida_expect.js'); console.log(JSON.stringify(E.run(JSON.parse(require('fs').readFileSync(0, 'utf8')))));",
                  dict(kw, op=op, precision=precision))


def rules_at(rows, at_id):
    """the number rules in force when the row at_id was written (a rule applies from its creation on: 000000's date from 2026-10-19)"""
    if not at_id:
        return list(rows or [])
    t = L.id_ms(at_id)
    return [r for r in rows or [] if not r.get("id") or L.id_ms(r["id"]) <= t]


# --------------------------------------------------------------------------------------------- C1: the AUTO lines after D4
def auto_plan(batch_part, intent, lines):
    """the AUTO lines named by the PREPARE BATCH part (kind AUTO, line_ids) and their D1 intent numbers; after D4 such a line holds its
    generated number, so its text alone reads TYPED. -> (auto, problems): auto = {line_ids, numbers (row key -> number), rows, by_line}"""
    problems = []
    rows = [r for r in ((batch_part or {}).get("rows") or []) if isinstance(r, dict) and r.get("kind") == "AUTO"]
    numbers = dict(((intent or {}).get("numbers") or {}))
    by_line = {}
    for r in rows:
        for lid in r.get("line_ids") or []:
            by_line[str(lid)] = r.get("key")
    auto = {"rows": rows, "numbers": numbers, "by_line": by_line, "line_ids": set(by_line)}
    if not rows:
        if numbers:
            problems.append(f"the D1 intent numbers {len(numbers)} rows but the BATCH part has no AUTO row")
        return auto, problems
    if intent is None:
        problems.append(f"{len(rows)} AUTO rows planned but no D1 intent (D1|I|nnn) is readable")
        return auto, problems
    keys = [r.get("key") for r in rows]
    missing = [k for k in keys if not str(numbers.get(k) or "").strip()]
    extra = [k for k in numbers if k not in keys]
    if missing or extra or len(numbers) != len(rows):
        problems.append(f"D1 intent numbers {len(numbers)} != AUTO rows {len(rows)} (missing {missing[:3]}, extra {extra[:3]})")
    low = [str(v).strip().lower() for v in numbers.values()]
    if len(set(low)) != len(low):
        problems.append("the D1 intent repeats a number (case-insensitive)")
    adv = sum(int(c.get("after", {}).get("running_number") or 0) - int(c.get("before", {}).get("running_number") or 0) for c in (intent.get("configs") or []))
    if adv != len(rows):
        problems.append(f"the D1 intent's configs advance {adv} != AUTO rows {len(rows)}")
    by_id = {str(l.get("id")): l for l in lines or []}
    off = [(lid, (by_id.get(lid) or {}).get("batch_number"), numbers.get(k)) for lid, k in by_line.items()
           if lid not in by_id or str((by_id.get(lid) or {}).get("batch_number") or "") != str(numbers.get(k) or "")]
    if off:
        problems.append(f"{len(off)} AUTO line(s) do not hold their intent number (D4): {off[:3]}")
    return auto, problems


def pre_d4(lines, auto_ids, text):
    """the stored lines as SUBMIT wrote them: every AUTO line back to its placeholder text (the fingerprint and the kinds)"""
    out = []
    for l in lines or []:
        x = dict(l)
        if str(x.get("id")) in auto_ids:
            x["batch_number"] = text
        out.append(x)
    return out


def config_advance(before_bnc, now_bnc, intent_configs, count, foreign_runs):
    """the org's batch_number_config advanced by exactly the AUTO count since the snapshot; a larger advance is explained only by other
    generators in the window (foreign_runs = GENERATE_BATCH runs since the snapshot)"""
    problems, infos = [], []
    b = {str(r.get("id")): r for r in before_bnc or []}
    n = {str(r.get("id")): r for r in now_bnc or []}
    ids = {str(c.get("id")) for c in intent_configs or []} or set(n)
    adv = sum(int((n.get(i) or {}).get("running_number") or 0) - int((b.get(i) or {}).get("running_number") or 0) for i in ids)
    if adv == count:
        infos.append(f"batch_number_config {sorted(ids)} advanced {adv} = the {count} AUTO numbers")
    elif adv > count and adv - count <= foreign_runs:
        infos.append(f"batch_number_config advanced {adv}: our {count} + {adv - count} by other generators ({foreign_runs} GENERATE_BATCH runs in the window)")
    else:
        problems.append(f"batch_number_config {sorted(ids)} advanced {adv}, the AUTO lines are {count} ({foreign_runs} foreign GENERATE_BATCH runs in the window)")
    return problems, infos


# --------------------------------------------------------------------------------------------- M3: the allocation, independently
def alloc_check(issued, alloc, prices):
    """sum(values) = the issued value; every line but the last = issued x share / total share (Decimal, independent of price.js)"""
    problems = []
    iss = dec(issued)
    total = sum((dec(L.q8(a["share_qty"])) for a in alloc), Decimal(0))
    vals = [dec(p["value"]) for p in prices]
    if abs(sum(vals, Decimal(0)) - iss) > Decimal("0.000001"):
        problems.append(f"sum of the allocated values {sum(vals, Decimal(0))} != the issued value {iss}")
    for i, (a, v) in enumerate(zip(alloc[:-1], vals[:-1])):
        want = iss * dec(L.q8(a["share_qty"])) / total if total > 0 else Decimal(0)
        if abs(want - v) > Decimal("0.000001") * max(Decimal(1), abs(want)):
            problems.append(f"line {a.get('line_index')}: value {v} != issued x share / total {want}")
            break
    return problems


# --------------------------------------------------------------------------------------------- I3: drift, not absolute ledgers
def drift(keys, bal_now, hist_now, before_bal=None, window_net=None, new_keys=(), touched=None, foreign_keys=()):
    """balance - movement history per key. With a --before snapshot: the drift must be unchanged (drift_before = bal_before - (hist_now -
    the window's net movements)); a non-zero drift that was already there is INFO; a changed drift on a key this completion did not touch
    but another document moved in the window is INFO (that writer's, not ours). Without one: a key this completion created must have no
    drift; any other drift is INFO (not proven unchanged)."""
    problems, infos = [], []
    for k in sorted(keys):
        d_now = dec(bal_now.get(k)) - dec(hist_now.get(k))
        if before_bal is not None:
            d_before = dec(before_bal.get(k)) - (dec(hist_now.get(k)) - dec((window_net or {}).get(k)))
            if d_now != d_before:
                if touched is not None and k not in touched and k in foreign_keys:
                    infos.append(f"{k}: drift {d_before} -> {d_now} on a key only other documents moved in the window")
                else:
                    problems.append(f"{k}: drift (balance - history) {d_before} before -> {d_now} now")
            elif d_now != 0:
                infos.append(f"{k}: pre-existing drift {d_now} (unchanged)")
        elif k in new_keys:
            if d_now != 0:
                problems.append(f"{k}: a key this completion created has drift {d_now}")
        elif d_now != 0:
            infos.append(f"{k}: drift {d_now} (no --before: not proven unchanged)")
    return problems, infos


# --------------------------------------------------------------------------------------------- I2 / M3: exact stored values
def eq_stored(got, want):
    return dec(got) == dec(want)


def in_price_problems(in_rows, expected):
    """every IN row's stored unit_price / total_price = the engine's value at the rule, exactly"""
    off = []
    for x, e in zip(in_rows, expected):
        if not (eq_stored(x["unit_price"], e["unit_price"]) and eq_stored(x["total_price"], e["total_price"])):
            off.append((x.get("k") or x.get("id"), (x["unit_price"], x["total_price"]), (e["unit_price"], e["total_price"])))
    return off


def wa_problems(now_rows, new_rows, exp, loose=()):
    """the WA rows against ida_expect waRows: every re-averaged row (by id) and every created row (material + batch, qty, price - a
    multiset over the rows new since the snapshot) exact; a new row nobody expected is a problem; on a material another document moved
    (loose) a difference is soft. -> (hard, soft, counts)"""
    nowmap = {str(w["id"]): w for w in now_rows}
    upd_off = [("updated", i, (nowmap.get(i) or {}).get("material_id"), (nowmap.get(i) or {}).get("wa_quantity"), (nowmap.get(i) or {}).get("wa_cost_price"), e)
               for i, e in (exp.get("updated") or {}).items()
               if not (eq_stored((nowmap.get(i) or {}).get("wa_quantity"), e["wa_quantity"]) and eq_stored((nowmap.get(i) or {}).get("wa_cost_price"), e["wa_cost_price"]))]
    pool = list(new_rows)
    cre_off = []
    for e in exp.get("created") or []:
        hit = next((w for w in pool if str(w["material_id"]) == str(e["material_id"]) and str(w.get("batch_id") or "") == str(e.get("batch_id") or "")
                    and eq_stored(w["wa_quantity"], e["wa_quantity"]) and eq_stored(w["wa_cost_price"], e["wa_cost_price"])), None)
        if hit:
            pool.remove(hit)
        else:
            cre_off.append(("created", None, e["material_id"], e.get("batch_id"), e["wa_quantity"], e["wa_cost_price"]))
    extra = [("unexpected", w["id"], w["material_id"], w.get("batch_id"), w["wa_quantity"], w["wa_cost_price"]) for w in pool]
    allx = upd_off + cre_off + extra
    hard = [z for z in allx if str(z[2]) not in {str(m) for m in loose}]
    soft = [z for z in allx if z not in hard]
    return hard, soft, {"updated_off": len(upd_off), "created_off": len(cre_off), "unexpected": len(extra)}


def fifo_layer_problems(new_layers, fifo_in, expected, foreign_mats):
    """one new layer per FIFO IN row (its material + batch, base qty, cost at the rule), no other new layer on a touched key unless another
    document received that material in the window"""
    pool = {}
    for y in new_layers:
        pool.setdefault((str(y["m"]), str(y["b"] or "")), []).append(y)
    missing = []
    for x, e in zip(fifo_in, expected):
        cands = pool.get((str(x["item_id"]), str(x["batch"] or "")), [])
        hit = next((y for y in cands if eq_stored(y["ini"], e["fifo_qty"]) and eq_stored(y["p"], e["fifo_cost_price"])), None)
        if not hit:
            missing.append((x["item_id"], x["batch"], e["fifo_qty"], e["fifo_cost_price"], [(y["ini"], y["p"]) for y in cands][:3]))
            continue
        cands.remove(hit)
    extra = [(k, len(v)) for k, v in pool.items() if v and k[0] not in foreign_mats]
    return missing, extra

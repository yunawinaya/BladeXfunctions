"""pick_twins.py snap <tenant> <gd_id> <out.json> | diff <A.json> <B.json>: the Pickings naming a GD, read-only (dev), and a
comparison of twin GDs' Pickings. snap reads every transfer_order naming the GD (any status, deleted too), its items and
records (deleted too), plus the GD's numbers and line / SO ids. diff replaces each twin's own ids and numbers with
positional names (GD, GDL3, SOL3, PK1, PI4, ...), then compares header, items and records by position."""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "gdc", "pkv2tools"))
from dbq import q  # noqa: E402

CLOCKS = {"create_time", "update_time", "confirmed_at", "created_at"}


def snap(tenant, gd, out):
    assert tenant.isdigit() and gd.isdigit()
    T = f"tenant_id = '{tenant}'"
    hdr = q("--dev", f"SELECT id, delivery_no, so_id, so_no, picking_status, gd_status FROM goods_delivery WHERE {T} AND id = {gd}")
    assert len(hdr) == 1, "GD not found"
    names = f"(JSON_CONTAINS(t.gd_no, JSON_QUOTE('{gd}')) OR JSON_CONTAINS(t.gd_no, '{gd}'))"
    of = f"SELECT t.id FROM transfer_order t WHERE t.{T} AND t.movement_type = 'Picking' AND {names}"
    s = {
        "gd": hdr,
        "gdl": q("--dev", f"SELECT id, so_line_item_id, line_so_id, material_id, is_deleted, picking_status FROM goods_delivery_fwii8mvb_sub WHERE {T} AND goods_delivery_id = {gd} ORDER BY id"),
        "pick": q("--dev", f"SELECT t.* FROM transfer_order t WHERE t.{T} AND t.movement_type = 'Picking' AND {names} ORDER BY t.id"),
        "items": q("--dev", f"SELECT * FROM transfer_order_jz8m9w3h_sub WHERE {T} AND transfer_order_id IN ({of}) ORDER BY transfer_order_id, id"),
        "recs": q("--dev", f"SELECT * FROM transfer_order_vrqs3cmr_sub WHERE {T} AND transfer_order_id IN ({of}) ORDER BY transfer_order_id, id"),
    }
    json.dump(s, open(out, "w"), default=str, indent=1)
    print(f"{hdr[0]['delivery_no']}: {len(s['pick'])} Picking(s) " + ", ".join(f"{p['to_id']} {p['to_status']} del={p['is_deleted']} proc={p['is_processing']}" for p in s["pick"])
          + f"; {len(s['items'])} item(s), {len(s['recs'])} record(s)")


def names(s):
    """this twin's own ids / numbers -> positional names"""
    m = {}
    g = s["gd"][0]
    m[str(g["id"])] = "GD"
    m[str(g["delivery_no"])] = "GDNO"
    for k, so in enumerate(json.loads(g["so_id"]) if isinstance(g["so_id"], str) else (g["so_id"] or []), 1):
        m[str(so)] = f"SO{k}"
    for k, no in enumerate([x.strip() for x in str(g.get("so_no") or "").split(",") if x.strip()], 1):
        m[no] = f"SONO{k}"
    for k, r in enumerate(s["gdl"], 1):
        m[str(r["id"])] = f"GDL{k}"
        if r.get("so_line_item_id"):
            m[str(r["so_line_item_id"])] = f"SOL{k}"
    for k, p in enumerate(s["pick"], 1):
        m[str(p["id"])] = f"PK{k}"
        if p.get("to_id"):
            m[str(p["to_id"])] = f"PKNO{k}"
    for key, tag in (("items", "PI"), ("recs", "PR")):
        for k, r in enumerate(s[key], 1):
            m[str(r["id"])] = f"{tag}{k}"
    return m


def mask(v, m, order):
    if v is None:
        return None
    t = str(v)
    if t in m:
        return m[t]
    if isinstance(v, str):
        for k in order:
            if k in t:
                t = t.replace(k, m[k])
        return t
    return v


def rows(s, key, m):
    order = sorted(m, key=len, reverse=True)
    return [{k: mask(v, m, order) for k, v in r.items() if k not in CLOCKS} for r in s[key]]


def diff(fa, fb):
    A, B = json.load(open(fa)), json.load(open(fb))
    ma, mb = names(A), names(B)
    bad = 0
    for key in ("pick", "items", "recs"):
        ra, rb = rows(A, key, ma), rows(B, key, mb)
        print(f"{key}: A {len(ra)} row(s), B {len(rb)} row(s)")
        if len(ra) != len(rb):
            bad += 1
        for k, (x, y) in enumerate(zip(ra, rb), 1):
            cols = [c for c in sorted(set(x) | set(y)) if not ((x.get(c) in (None, "")) and (y.get(c) in (None, ""))) and x.get(c) != y.get(c)]
            for c in cols:
                bad += 1
                print(f"  {key}[{k}].{c}: A={str(x.get(c))[:160]!r} B={str(y.get(c))[:160]!r}")
    print("SAME" if not bad else f"{bad} difference(s)")


if __name__ == "__main__":
    if sys.argv[1] == "snap":
        snap(*sys.argv[2:5])
    else:
        diff(*sys.argv[2:4])

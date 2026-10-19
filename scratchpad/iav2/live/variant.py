"""variant.py <tag> <kind> [args] [--gen N]: a local variant of a built tag's requests (no DB write, no run) for the negative tests.
Writes the folder <tag>-<kind> beside <tag> with classic.json / draft.json / submit.json / status.json (a new idempotency key: the
content changed) + plan.json (copied; cmds.py reads the tenant from it). The first STOCK line with a pick is the one changed.
  no-picks         that line without picks (temp_qty_data "", total_quantity 0, stock_summary "") -> classic 401 "no stock has been
                   allocated" (code_validate); SUBMIT STOP 400 IA_ASSEMBLY_INVALID
  over             its first pick = the available qty of plan.json + 1 (line total follows) -> classic 402 (the stock pre-check);
                   V2: SUBMIT QUEUED (it does not check stock), PREPARE FAILED IA_INVENTORY_INSUFFICIENT, nothing moved, IA back to Draft
  qty <n>          its first pick = n (line total follows): the corrected "second click" after a FAILED job (use with --gen 2)
  gen              the same content, the next key generation (a resend after FAILED)
  big <n>          classic only: n copies of the first stock line (a classic Completed above 250 picks -> v12 400 classicTooBig)"""
import copy, json, os, shutil, sys
from decimal import Decimal

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ialib as L  # noqa: E402
import build_ia_payload as B  # noqa: E402


def first_pick_line(doc):
    for i, l in enumerate(doc.get("stock_movement") or []):
        try:
            ps = json.loads(l.get("temp_qty_data") or "[]")
        except ValueError:
            ps = []
        if any(float(p.get("sm_quantity") or 0) > 0 for p in ps):
            return i, ps
    raise SystemExit("no stock line with a pick")


def main():
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    tag, kind = sys.argv[1], sys.argv[2]
    src = L.out_dir(tag)
    plan = L.read_json(os.path.join(src, "plan.json"))
    classic = L.read_json(os.path.join(src, "classic.json"))
    doc = copy.deepcopy(classic["allData"])
    i, ps = first_pick_line(doc)
    line = doc["stock_movement"][i]
    if kind == "no-picks":
        line.update({"temp_qty_data": "", "total_quantity": 0, "stock_summary": ""})
    elif kind in ("over", "qty"):
        p0 = ps[0]
        key = "|".join([str(p0.get("material_id")), str(p0.get("location_id")), str(p0.get("batch_id") or ""), p0.get("category") or "Unrestricted"])
        if kind == "over":
            avail = Decimal(str((plan["use_vs_available"].get(key) or {}).get("available") or "0"))
            new = avail + 1
        else:
            new = Decimal(L.arg(kind) or sys.argv[3])
        p0["sm_quantity"] = B.jsf(float(new))
        line["temp_qty_data"] = json.dumps(ps, ensure_ascii=False, separators=(",", ":"))
        line["total_quantity"] = B.jsf(float(sum(Decimal(str(p["sm_quantity"])) for p in ps)))
        print(f"line {line.get('line_index')} ({line.get('item_name')}): first pick {key} -> {new}")
    elif kind == "big":
        n = int(sys.argv[3])
        base = doc["stock_movement"][i]
        doc["stock_movement"] = [dict(base, line_index=k + 1, fm_key=L.fm_key(f"big{k}")) for k in range(n)]
        print(f"{n} copies of line {base.get('line_index')}: {n} picks (classic only - the copies share one balance)")
    elif kind != "gen":
        raise SystemExit(__doc__)
    dst = src.rstrip("/") + "-" + kind
    os.makedirs(dst, exist_ok=True)
    c = B.Ctx(L.load_config(), plan["tenant"])
    page = doc.get("page_status") or classic["pageStatus"]
    ia_id = str(doc.get("id") or "") if page == "Edit" else ""
    old_key = L.read_json(os.path.join(src, "submit.json")).get("idempotency_key") or ""
    token = old_key.split(":")[2][4:] if old_key.count(":") >= 4 and old_key.split(":")[2].startswith("new-") else None
    cl, dr, sub, st = B.requests_of(c, doc, page, ia_id, int(L.arg("--gen", "2" if kind == "gen" else "1")), token=token)
    for name, obj in (("classic", cl), ("draft", dr), ("submit", sub), ("status", st)):
        L.write_json(os.path.join(dst, name + ".json"), obj)
    shutil.copy(os.path.join(src, "plan.json"), os.path.join(dst, "plan.json"))
    print(f"-> {dst}/{{classic,draft,submit,status}}.json (key {sub['idempotency_key']})")


if __name__ == "__main__":
    main()

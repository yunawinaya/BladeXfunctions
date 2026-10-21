"""variant.py <tag> <kind> [args] [--gen N]: a local variant of a built tag's requests (no DB write, no run) for the negative tests.
Writes the folder <tag>-<kind> beside <tag> with classic.json / draft.json / submit.json / status.json (a new idempotency key: the
content changed; an Add keeps its pageToken) + plan.json (copied; cmds.py reads the tenant from it). Copied from tpl/iav2/live/variant.py.
  over        the source pick = today's available + 1 (item_qty follows, BOM rows rescale by their ratio as the form does) -> classic
              402 (the per-pick GLOBAL_INVENTORY_VALIDATION pre-check); V2: SUBMIT QUEUED (it does not check stock), PREPARE FAILED
              IDA_INVENTORY_INSUFFICIENT, nothing moved, the IDA back to Draft
  qty <n>     the source pick = n (item_qty follows, BOM rows rescale): the corrected "second click" after a FAILED job (with --gen 2)
  gen         the same content, the next key generation (a resend after FAILED)
  no-bin      line 1 without a bin -> classic 401 "Line 1 (...): bin location is required."; SUBMIT STOP 400 IDA_INVALID (the same text)
  typed <X>   the first TYPED line's batch number = X (7b: take a V2 IDA's typed number with a classic save before its first tick)
  big <n>     n more copies of line 1 (classic only: more than 250 moves -> v7 400 IDA_TEXT.classicTooBig, nothing written)
  autonum <P> every AUTO line (item batch-managed, 'According To System Settings', text '' or the placeholder) gets the typed number
              <P>-<n> (n = 1.. in line order; refused when one is held by a live org Batch row or typed on another line), so the classic
              Completed save skips GENERATE_BATCH - it cannot run through runas (GENERATE_BATCH's org = organization_id ??
              {{global:firstLvDeptId}}, the classic passes none, a minted token has no session global: "No default batch found.").
              plan.json is REBUILT (those lines are TYPED Batch rows; AUTO 0, no config advance; the prices as before). V2 needs none
              (no {{global:}} in the IDA_V2_* workflows or INVENTORY_BULK_APPLY)"""
import copy, json, os, re, shutil, sys
from decimal import Decimal

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import idalib as L  # noqa: E402
import build_ida_payload as B  # noqa: E402


def rescale(c, doc, qty):
    """onChange_idaSourceQuantity / onConfirm_Stock -> ida_src_item rescale: every BOM row (bom_ratio set) = q8(qty x ratio)"""
    doc["item_qty"] = L.jsf(float(qty))
    picks = json.loads(doc.get("temp_qty_data") or "[]")
    if len(picks) != 1:
        raise SystemExit("the variant needs exactly one source pick")
    picks[0]["sm_quantity"] = L.jsf(float(qty))
    doc["temp_qty_data"] = json.dumps(picks, ensure_ascii=False, separators=(",", ":"))
    for l in doc.get("stock_movement") or []:
        if l.get("bom_ratio") not in (None, ""):
            t = L.jsf(L.q8(float(qty) * float(l["bom_ratio"])))
            l["requested_qty"], l["total_quantity"] = t, t
    old = doc.get("stock_summary") or ""
    if old.startswith("Total: "):
        head, rest = old.split("\n", 1)
        unit = head.split(" ", 2)[2] if head.count(" ") >= 2 else ""
        det = rest.split("1. ", 1)[1] if "1. " in rest else ""
        name = det.split(":", 1)[0]
        doc["stock_summary"] = f"Total: {L.js_text(L.jsf(float(qty)))} {unit}\n\nDETAILS:\n1. {name}: {L.js_text(L.jsf(float(qty)))} {unit} (UNR)" + (
            "\n" + det.split("\n", 1)[1] if "\n" in det else "")
    for row in doc.get("item_display_table") or []:
        row["item_qty"], row["stock_summary"] = doc["item_qty"], doc["stock_summary"]
    return picks[0]


def autonum(c, doc, prefix):
    """the AUTO lines (ida_common idaBatchKind's AUTO rule) in line order -> '<prefix>-<n>'; -> (items, [(line_index, item, number)])"""
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,40}", prefix or ""):
        raise SystemExit("autonum needs a prefix of letters, digits, '_', '.', '-' (variant.py <tag> autonum <prefix>)")
    lines = doc.get("stock_movement") or []
    items = B.read_items(c, [doc.get("item_id")] + [l.get("item_selection") for l in lines if l.get("item_selection")])
    order = sorted(range(len(lines)), key=lambda i: (float(lines[i].get("line_index") or i + 1), i))
    done = []
    for i in order:
        l = lines[i]
        it = items.get(str(l.get("item_selection") or "")) or {}
        raw = "" if l.get("batch_number") is None else str(l.get("batch_number"))
        if str(it.get("item_batch_management")) == "1" and it.get("batch_number_genaration") == L.AUTO_RULE and raw in ("", L.PLACEHOLDER):
            l["batch_number"] = f"{prefix}-{len(done) + 1}"
            done.append((l.get("line_index"), it.get("material_code"), l["batch_number"]))
    if not done:
        raise SystemExit("no AUTO line (item auto-rule + placeholder / '') - nothing to number")
    key = lambda n: str(n).lower().rstrip(" ")  # noqa: E731  (idaBatchKey)
    mine = {key(n) for _, _, n in done}
    others = [l.get("batch_number") for l in lines if key(l.get("batch_number") or "") in mine]
    if len(others) != len(done):
        raise SystemExit(f"refusing: a number <{prefix}-n> is already typed on another line of this IDA ({others}) - choose another prefix")
    held = B.holders(c, [n for _, _, n in done])
    if held:
        raise SystemExit(f"refusing: {[(h['batch_number'], h['transaction_no']) for h in held][:4]} already held by live Batch rows of the organization - "
                         "choose another prefix")
    return items, done


def main():
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    tag, kind = sys.argv[1], sys.argv[2]
    src = L.out_dir(tag)
    plan = L.read_json(os.path.join(src, "plan.json"))
    classic = L.read_json(os.path.join(src, "classic.json"))
    doc = copy.deepcopy(classic["allData"])
    c = B.Ctx(L.load_config(), plan["tenant"])
    if kind in ("over", "qty"):
        picks = json.loads(doc.get("temp_qty_data") or "[]")
        bid = L.digits(picks[0].get("balance_id"), "balance_id")
        t = "item_batch_balance" if picks[0].get("batch_id") else "item_balance"
        have = Decimal(str(L.q(f"SELECT CAST(unrestricted_qty AS CHAR) u FROM {t} WHERE tenant_id = '{c.T}' AND id = {bid}")[0]["u"]))
        new = have + 1 if kind == "over" else Decimal(sys.argv[3])
        p = rescale(c, doc, new)
        print(f"source pick {p.get('balance_id')} (bin {p.get('location_id')}): {new} (available today {have}); BOM rows rescaled")
    elif kind == "no-bin":
        doc["stock_movement"][0]["location_id"] = ""
        print(f"line 1 ({doc['stock_movement'][0].get('item_name')}) without a bin")
    elif kind == "typed":
        x = sys.argv[3]
        items = B.read_items(c, [l["item_selection"] for l in doc["stock_movement"]])
        for l in doc["stock_movement"]:
            it = items.get(str(l["item_selection"])) or {}
            if str(it.get("item_batch_management")) == "1" and it.get("batch_number_genaration") != L.AUTO_RULE:
                print(f"line {l['line_index']} ({l.get('item_name')}): batch number {l.get('batch_number')!r} -> {x!r}")
                l["batch_number"] = x
                break
        else:
            raise SystemExit("no TYPED line")
    elif kind == "big":
        n = int(sys.argv[3])
        base = doc["stock_movement"][0]
        start = len(doc["stock_movement"])
        doc["stock_movement"] += [dict(base, line_index=start + k + 1, fm_key=L.fm_key(f"big{k}")) for k in range(n)]
        print(f"{n} copies of line 1: {start + n} lines (classic only)")
    elif kind == "autonum":
        items, done = autonum(c, doc, sys.argv[3] if len(sys.argv) > 3 else "")
        for li, code, n in done:
            print(f"line {li} ({code}): AUTO -> typed {n}")
    elif kind != "gen":
        raise SystemExit(__doc__)
    dst = src.rstrip("/") + "-" + kind
    os.makedirs(dst, exist_ok=True)
    page = doc.get("page_status") or classic["pageStatus"]
    ida_id = str(doc.get("id") or "") if page == "Edit" else ""
    old_key = L.read_json(os.path.join(src, "submit.json")).get("idempotency_key") or ""
    parts = old_key.split(":")
    token = parts[2][4:] if len(parts) >= 5 and parts[2].startswith("new-") else None
    cl, dr, sub, st = B.requests_of(c, doc, page, ida_id, int(L.arg("--gen", "2" if kind == "gen" else "1")), token=token)
    for name, obj in (("classic", cl), ("draft", dr), ("submit", sub), ("status", st)):
        L.write_json(os.path.join(dst, name + ".json"), obj)
    if kind != "autonum":
        shutil.copy(os.path.join(src, "plan.json"), os.path.join(dst, "plan.json"))
        print(f"-> {dst}/{{classic,draft,submit,status}}.json (key {sub['idempotency_key']})")
        return 0
    new, _ = B.build_plan(c, doc, items, os.path.basename(dst), runs=int(plan.get("runs") or 1), v2=not L.flag("--any"), page=page)
    new["key"] = sub["idempotency_key"]
    new["variant"] = {"of": tag, "kind": "autonum", "numbers": [n for _, _, n in done]}
    L.write_json(os.path.join(dst, "plan.json"), new, indent=1)
    cn, was = new["counts"], plan["counts"]
    adv = lambda p_: sum(int((x.get("after") or {}).get("running_number") or 0) - int((x.get("before") or {}).get("running_number") or 0)  # noqa: E731
                         for x in p_.get("auto_configs") or [])
    print(f"-> {dst}/{{classic,draft,submit,status,plan}}.json (key {sub['idempotency_key']}); plan rebuilt: batch rows AUTO {was['autoRows']} -> {cn['autoRows']}, "
          f"TYPED {was['typedRows']} -> {cn['typedRows']}; config advance +{adv(plan)} -> +{adv(new)}; issued preview {plan.get('issued_value_preview')} -> "
          f"{new.get('issued_value_preview')}; IN prices {[x['unit_price'] for x in plan['in_rows']]} -> {[x['unit_price'] for x in new['in_rows']]}")
    for w in c.warnings[:8]:
        print("   WARN", w)
    for x in c.problems:
        print("   " + ("EXPECTED" if L.flag("--any") else "FAIL"), x)
    return 1 if c.problems and not L.flag("--any") else 0


if __name__ == "__main__":
    sys.exit(main())

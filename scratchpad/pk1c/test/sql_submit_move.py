"""sql_node_PSmove (code/submit_move.sql + submit_move_rows.sql) rendered with given tokens and run READ-ONLY on dev.
Fixed cases on a real Picking: a CONFIRM that moves one row to another bin, sends one row empty, leaves one unsent; a
PICK_ALL_REMAINING (stored targets). Prints the rows and checks their shape.

usage: python3 sql_submit_move.py <tenant> <org> <picking_id> <row_a> <row_b> <row_c> <other_bin>  (org: not Loading Bay)
"""
import json, os, sys

sys.path.insert(0, "/Users/yunawinaya/Developer/BladeXfunctions/scratchpad/gdc/pkv2tools")
from dbq import q  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))


def render(tokens):
    rows = open(os.path.join(HERE, "..", "code", "submit_move_rows.sql")).read().strip()
    text = open(os.path.join(HERE, "..", "code", "submit_move.sql")).read().replace("@ROWS@", rows)
    for k, v in tokens.items():
        text = text.replace("{{node:code_node_PSguard.data.%s}}" % k, v)
    assert "{{" not in text and text.lstrip().upper().startswith("SELECT")
    return text


tenant, org, pick, a, b, c, other = sys.argv[1:8]
assert all(x.isdigit() for x in (tenant, org, pick, a, b, c, other))
base = {"tenantId": tenant, "pickingId": pick, "organizationId": org}
fails = 0
for label, op, rows, want in [
    ("CONFIRM: a moved, b sent empty, c not sent", "CONFIRM",
     [{"r": a, "l": other, "b": None}, {"r": b, "l": "0", "b": "0"}, {"r": c, "l": None, "b": None}], {("R", a): ("1", "0")}),
    ("PICK_ALL_REMAINING: stored targets (none set), not a bay org: no rows", "PICK_ALL_REMAINING", [], {}),
]:
    out = q("--dev", render(dict(base, operation=op, moveRowsJson=json.dumps(rows))))
    print("==", label, "->", len(out), "rows")
    for r in out[:8]:
        print("  ", {k: r[k] for k in ("kind", "row_id", "gd_id", "moved", "bay_bad", "delivery_no", "line_count", "serial_items", "select_picking", "linked", "other_job")})
    if want:
        got = {(r["kind"], r["row_id"]): (r["moved"], r["bay_bad"]) for r in out if r["kind"] == "R"}
        for k, v in want.items():
            ok = got.get(k) == v
            fails += 0 if ok else 1
            print("  ", "ok  " if ok else "FAIL", k, "->", got.get(k), "want", v)
        gs = [r for r in out if r["kind"] == "G"]
        ok = len(gs) == 1 and gs[0]["line_count"] not in (None, "0")
        fails += 0 if ok else 1
        print("  ", "ok  " if ok else "FAIL", "one G row for the moved GD, with its line count")
        unsent = (("R", c) not in got) and (("R", b) not in got)
        fails += 0 if unsent else 1
        print("  ", "ok  " if unsent else "FAIL", "rows sent empty / not sent (no stored target) do not move (no bay rows outside a bay org)")
    if want == {}:
        fails += 0 if not out else 1
        print("  ", "ok  " if not out else "FAIL", "nothing returned")
print("all passed" if not fails else "%d FAILED" % fails)
sys.exit(1 if fails else 0)

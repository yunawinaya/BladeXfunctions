"""The Item Assembly list for the IA transfer request (ENH-20261027-001), patched onto the live dev list v36
(scratchpad/iatr/base/rr_IA_LIST_v36.json, pinned 10-30: its Item Assembly and By Item tabs). v36 already carries the v7 changes: the
Transfer Request column (transfer_request_no, appended last) and the delete guard (a live or received request keeps its IA).
Reserved requests (scratchpad/iatr/RESERVED_REQUEST_PLAN.md Task 10):
  cancel    a Created IA whose transfer request is open (Requested, In Progress, Processing) is not cancelled - cancel the request first
            (IA_HOLD refuses a dispatched one's IA anyway); a received one does not stop it, its staging reservation is released with
            the rest. One read of the selected Created IAs' requests, after the stored re-read, before the confirm
  column    unchanged: transfer_request_no is the IA's link, which IA_TRANSFER_REQUEST and LOT_V2_COMMIT keep on the latest open or
            received request (a cancelled replacement gives it back to the received one)
Nothing else changes (test/test_ia_list.js proves it).

usage: python3 scratchpad/iatr/ia_client/patch_ia_list.py [--write]   (IATR_UI_OUT=<dir> writes there; --patches prints the text changes)"""
import hashlib
import json
import os
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
IATR = os.path.dirname(HERE)
BASE = os.path.join(IATR, "base", "rr_IA_LIST_v36.json")
BASE_MD5 = "79dcb8780919b2e0e3141a2152f308e1"
OUT = os.environ.get("IATR_UI_OUT") or os.path.join(HERE, "out")
OPEN = ["Requested", "In Progress", "Processing"]
CANCEL = [
    ('  const todo = selected.filter((r) => s((byId[s(r && r.id)] || {}).item_assembly_status) === "Created");\n'
     '  if (!todo.length) {\n'
     '    this.$message.warning("None of the selected Item Assemblies is Created: only a Created Item Assembly can be cancelled.");\n'
     '    return;\n  }\n',
     '  const created = selected.filter((r) => s((byId[s(r && r.id)] || {}).item_assembly_status) === "Created");\n'
     '  if (!created.length) {\n'
     '    this.$message.warning("None of the selected Item Assemblies is Created: only a Created Item Assembly can be cancelled.");\n'
     '    return;\n  }\n'
     '  // IA transfer request (scratchpad/iatr, Task 10): an IA whose transfer request is open (Requested, or dispatched) keeps it - the request\n'
     '  // is cancelled first (IA_HOLD refuses a dispatched one\'s IA anyway); a received one does not stop it (its staging reservation is released)\n'
     '  const open = {};\n'
     '  let reqs = null;\n'
     '  try {\n'
     '    const rq = await db\n'
     '      .collection("sm_location_transfer")\n'
     '      .field("source_ia_id,stock_movement_no,stock_movement_status")\n'
     '      .filter([{ type: "branch", operator: "all", children: [{ prop: "source_ia_id", operator: "in", value: created.map((r) => s(r.id)) },\n'
     '        { prop: "transfer_purpose", operator: "equal", value: "IA_SUPPLY" }, { prop: "is_deleted", operator: "equal", value: 0 }] }])\n'
     '      .limit(5000)\n'
     '      .get();\n'
     '    reqs = rq && Array.isArray(rq.data) ? rq.data : null;\n'
     '  } catch (e) {\n'
     '    console.error("IA transfer request: the selected Item Assemblies\' requests could not be read", e);\n'
     '  }\n'
     '  if (!reqs) {\n'
     '    this.$message.error("The selected Item Assemblies\' transfer requests could not be read: try again.");\n'
     '    return;\n  }\n'
     '  for (const q of reqs) if (' + json.dumps(OPEN) + '.indexOf(s(q.stock_movement_status)) >= 0) open[s(q.source_ia_id)] = q;\n'
     '  const todo = created.filter((r) => !open[s(r.id)]);\n'
     '  if (!todo.length) {\n'
     '    this.$message.warning("Each selected Created Item Assembly has a transfer request open: cancel the request first.");\n'
     '    return;\n  }\n'),
    ('  const left = selected.length - n;\n',
     '  const left = selected.length - created.length;\n  const held = created.length - n;\n'),
    (': "are"} left as ${left === 1 ? "it is" : "they are"}.` : ""),\n',
     ': "are"} left as ${left === 1 ? "it is" : "they are"}.` : "") +\n'
     '      (held ? ` ${held} of the selected ${held === 1 ? "has" : "have"} a transfer request open and ${held === 1 ? "is" : "are"} left as ${held === 1 ? "it is" : "they are"}.` : ""),\n'),
    ('      if (status !== "Created") {\n        lines.push(label + ": " + whyNot(status));\n        continue;\n      }\n',
     '      if (status !== "Created") {\n        lines.push(label + ": " + whyNot(status));\n        continue;\n      }\n'
     '      if (open[id]) {\n'
     '        lines.push(label + ": transfer request " + s(open[id].stock_movement_no) + " is " + s(open[id].stock_movement_status) + ": cancel the request first");\n'
     '        continue;\n      }\n'),
]


def build():
    raw = open(BASE, encoding="utf-8").read()
    assert hashlib.md5(raw.encode("utf-8")).hexdigest() == BASE_MD5, "base/rr_IA_LIST_v36.json is not the pinned v36"
    page = json.loads(raw)
    ev = {e["name"]: e for e in page["config"]["eventScript"]}
    f = ev["onItemAssemblyCancel"]["func"]
    for old, new in CANCEL:
        assert f.count(old) == 1, old[:60]
        f = f.replace(old, new)
    ev["onItemAssemblyCancel"]["func"] = f
    return page


if __name__ == "__main__":
    if "--patches" in sys.argv:
        print(json.dumps({"cancel": CANCEL}))
        sys.exit(0)
    page = build()
    text = json.dumps(page, ensure_ascii=False, separators=(",", ":"))
    path = os.path.join(OUT, "list", "IAlistPage.json")
    print("IA list: md5 %s%s" % (hashlib.md5(text.encode("utf-8")).hexdigest(), " -> " + path if "--write" in sys.argv else " (dry)"))
    if "--write" in sys.argv:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        open(path, "w", encoding="utf-8").write(text)

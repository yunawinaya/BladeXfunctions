#!/usr/bin/env python3
"""BUG-20261016-023 (TAF CA-4098): the Picking form refused an exact pick of 32.95 because the
row's pending_process_qty was 32.94999999999999 (shown as 32.950).

The residue is 304.95 - 272 from the Picking Plan form. PICKING_PLAN rounds to_qty with q8 but
writes the auto-allocated temp_qty_data.to_quantity raw (a TEXT column, so nothing trims it).
PP_Convert_Picking sums those to_quantity values raw into qty_to_pick / pending_process_qty, and
the picked_qty validator compares with a strict `<`.

  python3 build.py          # patch the dev repo files in place + build PICKING_PLAN.prod.json
  python3 build.py --check  # build everything in memory only and print the node-level diff
"""
import json, os, subprocess, sys, copy

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
FORM_FILE = os.path.join(ROOT, "Picking", "PickingFullJSON.json")
VALIDATOR_JS = os.path.join(ROOT, "Picking", "PickingQuantityValidation.js")
CONV_FILE = os.path.join(ROOT, "Picking Plan", "PPconvertToPicking.json")
PP_FILE = os.path.join(ROOT, "Picking Plan", "PPheadWorkflow.json")
PP_PROD_OUT = os.path.join(HERE, "PICKING_PLAN.prod.json")
PP_WF_ID = 2021431201147527170

# ---- Picking form: table_picking_items.picked_qty validator --------------------------------------
VAL_OLD = """if (pending_process_qty < pickedInOrderUom) {"""
VAL_NEW = """// Half a 0.001 step: float residue (32.94999999999999 shown as 32.950) must not reject an exact pick.
if (pickedInOrderUom - pending_process_qty > 0.0005) {"""

# ---- PP_Convert_Picking: code_node_8MJPH5aT "Map Picking Data" -----------------------------------
CONV_TOP_OLD = """// A bundle is ONE row of table_to with the bundle's items under `children`, so the
// tree is walked flat wherever its items are what matter."""
CONV_TOP_NEW = """const q8 = (v) => Number((parseFloat(v) || 0).toFixed(8));

""" + CONV_TOP_OLD
CONV_REM_OLD = """      const remainingQty = parseFloat(tempItem.to_quantity || 0) - used;"""
CONV_REM_NEW = """      const remainingQty = q8(parseFloat(tempItem.to_quantity || 0) - used);"""
CONV_SUM_OLD = """  for (const group of pickingItemGroups.values()) {
    if (group.serial_numbers.length > 0) {"""
CONV_SUM_NEW = """  for (const group of pickingItemGroups.values()) {
    group.qty_to_pick = q8(group.qty_to_pick);
    group.pending_process_qty = q8(group.pending_process_qty);
    if (group.serial_numbers.length > 0) {"""

# ---- PICKING_PLAN: code_node_8Z1krUr1 "Table TO" (the only node that writes table_to) ------------
PP_HELPER_OLD = """// Every decimal column on a line. A bundle keeps its items under `children` and"""
PP_HELPER_NEW = """// temp_qty_data is a TEXT column, so the platform never trims its to_quantity residue.
const q8TempQty = (raw) => {
  let rows;
  try {
    rows = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (e) {
    return raw;
  }
  if (!Array.isArray(rows)) return raw;
  const out = rows.map((t) =>
    t && t.to_quantity !== undefined && t.to_quantity !== null && t.to_quantity !== ""
      ? { ...t, to_quantity: q8(t.to_quantity) }
      : t
  );
  return typeof raw === "string" ? JSON.stringify(out) : out;
};

""" + PP_HELPER_OLD
PP_LINE_OLD = """    picking_status:
      ppOverrides[String(item.id || "")] || src.picking_status,
    to_order_quantity: q8(src.to_order_quantity),"""
PP_LINE_NEW = """    picking_status:
      ppOverrides[String(item.id || "")] || src.picking_status,
    ...(src.temp_qty_data && { temp_qty_data: q8TempQty(src.temp_qty_data) }),
    to_order_quantity: q8(src.to_order_quantity),"""


def find(n, nid):
    if isinstance(n, dict):
        if n.get("id") == nid:
            return n
        for v in n.values():
            r = find(v, nid)
            if r is not None:
                return r
    elif isinstance(n, list):
        for v in n:
            r = find(v, nid)
            if r is not None:
                return r
    return None


def replace_once(text, old, new, where):
    if text.count(old) != 1:
        sys.exit(f"  {where}: expected exactly one match of the baseline text, found {text.count(old)} -- baseline drifted")
    return text.replace(old, new)


def patch_code(doc, nid, pairs):
    doc = copy.deepcopy(doc)
    node = find(doc, nid)
    code = node["data"]["script"]["code"]
    for old, new in pairs:
        if new in code:
            sys.exit(f"  {nid}: already patched")
        code = replace_once(code, old, new, nid)
    node["data"]["script"]["code"] = code
    return doc


def patch_conv(doc):
    return patch_code(doc, "code_node_8MJPH5aT",
                      [(CONV_TOP_OLD, CONV_TOP_NEW), (CONV_REM_OLD, CONV_REM_NEW), (CONV_SUM_OLD, CONV_SUM_NEW)])


def patch_pp(doc):
    return patch_code(doc, "code_node_8Z1krUr1", [(PP_HELPER_OLD, PP_HELPER_NEW), (PP_LINE_OLD, PP_LINE_NEW)])


def patch_validator(text):
    if VAL_NEW in text:
        sys.exit("  validator: already patched")
    return replace_once(text, VAL_OLD, VAL_NEW, "picked_qty validator")


def patch_form(doc):
    doc = copy.deepcopy(doc)
    col = doc["list"][2]["tabs"][0]["list"][0]["tableColumns"][23]
    assert col["model"] == "picked_qty", col.get("model")
    assert col["options"]["validator"] == col["rules"][0]["func"], "validator copies differ"
    new = patch_validator(col["options"]["validator"])
    col["options"]["validator"] = new
    col["rules"][0]["func"] = new
    return doc, new


def text_patch(raw, pairs, expected, where):
    """Replace JSON-escaped code text in a repo file, keeping its formatting byte for byte (no printer
    reproduces these files). The result must parse to the structured patch."""
    for old, new, count in pairs:
        for ea in (False, True):
            e_old = json.dumps(old, ensure_ascii=ea)[1:-1]
            if raw.count(e_old) == count:
                break
        else:
            sys.exit(f"  {where}: expected {count} escaped match(es) of the baseline text -- baseline drifted")
        raw = raw.replace(e_old, json.dumps(new, ensure_ascii=ea)[1:-1])
    if json.loads(raw) != expected:
        sys.exit(f"  {where}: text patch does not parse to the structured patch")
    return raw


def prod_enabled(wf_id):
    out = subprocess.run([os.path.join(ROOT, ".dbtools", "db"), "--prod", "--json",
                          f"SELECT version_number, script_json FROM su_code_workflow_history "
                          f"WHERE data_id={wf_id} AND status='enabled' ORDER BY version_number DESC LIMIT 1"],
                         capture_output=True, text=True)
    s = out.stdout
    rows = json.loads(s[s.index("[\n"):])
    return rows[0]["version_number"], json.loads(rows[0]["script_json"])


def nodes(doc):
    out = {}
    def walk(n):
        if isinstance(n, dict):
            if n.get("id") and isinstance(n.get("data"), dict):
                out[n["id"]] = json.dumps({k: v for k, v in n.items() if k != "blocks"}, sort_keys=True, ensure_ascii=False)
            for v in n.values():
                walk(v)
        elif isinstance(n, list):
            for v in n:
                walk(v)
    walk(doc)
    return out


def node_diff(a, b):
    na, nb = nodes(a), nodes(b)
    return {"added": sorted(set(nb) - set(na)), "removed": sorted(set(na) - set(nb)),
            "changed": sorted(k for k in set(na) & set(nb) if na[k] != nb[k])}


if __name__ == "__main__":
    check = "--check" in sys.argv

    form_raw = open(FORM_FILE, encoding="utf-8").read()
    form_base = json.loads(form_raw)
    form_new, validator = patch_form(form_base)

    conv_raw = open(CONV_FILE, encoding="utf-8").read()
    conv_base = json.loads(conv_raw)
    conv_new = patch_conv(conv_base)

    pp_raw = open(PP_FILE, encoding="utf-8").read()
    pp_base = json.loads(pp_raw)
    pp_new = patch_pp(pp_base)
    pv, pp_prod_base = prod_enabled(PP_WF_ID)
    pp_prod_new = patch_pp(pp_prod_base)

    print(f"  Picking form validator: {form_base != form_new}")
    print(f"  PP_Convert_Picking repo  -> {node_diff(conv_base, conv_new)}")
    print(f"  PICKING_PLAN dev repo    -> {node_diff(pp_base, pp_new)}")
    print(f"  PICKING_PLAN prod v{pv}   -> {node_diff(pp_prod_base, pp_prod_new)}")
    print(f"  PICKING_PLAN prod built vs dev built -> {node_diff(pp_prod_new, pp_new)}")
    if check:
        sys.exit(0)

    # Everything is rendered and checked before the first file is opened for writing.
    outputs = [
        (FORM_FILE, text_patch(form_raw, [(VAL_OLD, VAL_NEW, 2)], form_new, "form")),
        (VALIDATOR_JS, validator + "\n"),
        (CONV_FILE, text_patch(conv_raw, [(CONV_TOP_OLD, CONV_TOP_NEW, 1), (CONV_REM_OLD, CONV_REM_NEW, 1),
                                          (CONV_SUM_OLD, CONV_SUM_NEW, 1)], conv_new, "PP_Convert_Picking")),
        (PP_FILE, text_patch(pp_raw, [(PP_HELPER_OLD, PP_HELPER_NEW, 1), (PP_LINE_OLD, PP_LINE_NEW, 1)],
                             pp_new, "PICKING_PLAN")),
        (PP_PROD_OUT, json.dumps(pp_prod_new, indent=2, ensure_ascii=False) + "\n"),
    ]
    for path, text in outputs:
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
        print(f"  wrote {os.path.relpath(path, ROOT)}")

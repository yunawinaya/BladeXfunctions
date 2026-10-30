"""The Location Transfer list for the IA transfer request (ENH-20261027-001; plan top section, WP5), patched onto the live list v49
(scratchpad/iatr/base/lot_list_v49.json: dev v49 = prod v49, 10-28):
  status column   + the Requested badge (cyan; amber is In Progress)
  columns         + Source Item Assembly, Required Date, Requested By - appended LAST (the user's rule for list columns); keys = the
                  LOT form widgets' (patch_lot_ui.py fields phase)
  filters         + Status (the IA list's proven select on the status dictionary, limited to the transfer's statuses incl. Requested)
  bulkCancel_LOT  + a Requested request is cancelled by IA_TRANSFER_REQUEST CANCEL (state only); In Progress as before
  bulkDelete_LOT  a request (Requested / Cancelled) is never deleted: it keeps its audit history (spec section 5)
Nothing else changes (test/test_lot_list.js proves it).

usage: python3 scratchpad/iatr/lot_client/patch_lot_list.py [--write]   (IATR_UI_OUT=<dir> writes there; --patches prints the text changes)"""
import copy
import hashlib
import json
import os
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
IATR = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import patch_lot_ui as UI  # noqa: E402

BASE = os.path.join(IATR, "base", "lot_list_v49.json")
BASE_MD5 = "4067cdf3a3d36f3c9b74230f76920b4a"
OUT = os.environ.get("IATR_UI_OUT") or os.path.join(HERE, "out")
STATUS_KEYS = ["Draft", "Requested", "Processing", "In Progress", "Completed", "Cancelled"]
FILTER_ID = 1797900000100
BADGE = ('\n<div v-if="scope.value===\'Requested\'" style=" padding: 0 10px; border: 2px solid #0891B2; background-color: #CFFAFE; color: #155E75; font-size: 14px; '
         'font-family: Arial, sans-serif; border-radius: 20px; cursor: default; transition: background-color 0.3s; width: max-content; display: flex; align-items: center; '
         'justify-content: center;">{{scope.value}}</div>')
CANCEL = [
    ('const LOT_ROUTES = ["QUEUED", "SAVED", "STATUS", "NOT_ELIGIBLE", "BUSY", "STALE", "STOP", "INVALID"];\n',
     'const LOT_ROUTES = ["QUEUED", "SAVED", "STATUS", "NOT_ELIGIBLE", "BUSY", "STALE", "STOP", "INVALID"];\n'
     '// IA transfer request (scratchpad/iatr): a Requested request is cancelled by IA_TRANSFER_REQUEST (state only, no stock call)\n'
     'const IATR_WF = "' + UI.IATR_WF + '"; // IA_TRANSFER_REQUEST\n'),
    ('    if (inProgressLOTs.length === 0) {\n      this.hideLoading();\n      this.$message.error(\n        "Please select at least one In Progress location transfer.",\n      );\n',
     '    const requestLOTs = selectedRecords.filter((item) => item.stock_movement_status === "Requested" && item.transfer_purpose === "IA_SUPPLY");\n\n'
     '    if (inProgressLOTs.length === 0 && requestLOTs.length === 0) {\n      this.hideLoading();\n      this.$message.error(\n'
     '        "Please select at least one In Progress location transfer or Requested transfer request.",\n      );\n'),
    ('    const lotNumbers = inProgressLOTs.map((item) => item.stock_movement_no);\n',
     '    const lotNumbers = inProgressLOTs.concat(requestLOTs).map((item) => item.stock_movement_no);\n'),
    ('    for (const lot of inProgressLOTs) {\n',
     '    for (const lot of requestLOTs) {\n'
     '      try {\n'
     '        const res = await lv2run(IATR_WF, { operation: "CANCEL", ia_id: lv2s(lot.source_ia_id), organization_id: lv2s(lot.organization_id), lot_id: lv2s(lot.id),\n'
     '          idempotency_key: ("IATR:" + lv2s(lot.id) + ":cancel:" + lotV2ClickToken).slice(0, 128) });\n'
     '        const r = (res && res.data) || {};\n'
     '        if (lv2s(r.code) === "200") {\n          successCount++;\n        } else {\n          failCount++;\n'
     '          failedLOTs.push(`${lot.stock_movement_no} (${lv2s(r.message) || "not cancelled"})`);\n        }\n'
     '      } catch (error) {\n        failCount++;\n        failedLOTs.push(lot.stock_movement_no);\n'
     '        console.error(`Failed to cancel transfer request ${lot.stock_movement_no}:`, error);\n      }\n    }\n\n'
     '    for (const lot of inProgressLOTs) {\n'),
]
DELETE = [
    ('    const deleteLOTs = selectedRecords.filter(\n      (item) =>\n        item.stock_movement_status === "Cancelled" ||\n        item.stock_movement_status === "Draft",\n    );\n',
     '    // IA transfer request (scratchpad/iatr): a request (Requested or Cancelled) keeps its audit history - never deleted here\n'
     '    const deleteLOTs = selectedRecords.filter(\n      (item) =>\n        (item.stock_movement_status === "Cancelled" ||\n'
     '        item.stock_movement_status === "Draft") && item.transfer_purpose !== "IA_SUPPLY",\n    );\n'),
]


def build():
    raw = open(BASE, encoding="utf-8").read()
    assert hashlib.md5(raw.encode("utf-8")).hexdigest() == BASE_MD5, "base/lot_list_v49.json is not the pinned v49"
    page = json.loads(raw)
    form, _ = UI.build("fields")
    fkey = {m: UI.one(form, m)["key"] for m in ("source_ia_no", "required_date", "requested_by", "stock_movement_status")}
    cp = page["list"][0]["tabs"][0]["list"][0]["options"]["customProps"]
    cols = {c.get("name"): c for c in cp["columns"]}
    # the Requested badge
    st = cols["stock_movement_status"]
    assert "Requested" not in st["configCustom"]["content"]
    st["configCustom"]["content"] += BADGE
    # the columns, appended last
    tail = cp["columns"][-1]["name"]
    for name, title, tpl in (("source_ia_no", "Source Item Assembly", "remark3"), ("required_date", "Required Date", "issue_date"), ("requested_by", "Requested By", "remark3")):
        c = copy.deepcopy(cols[tpl])
        c.update({"key": fkey[name], "name": name, "title": title, "description": title})
        if "maxLength" in c:
            c["maxLength"] = 255
        if "isRequired" in c:
            c["isRequired"] = False
        cp["columns"].append(c)
    assert cp["columns"][-4]["name"] == tail
    # the Status filter: the IA list's shape (a select on the status dictionary), this transfer's statuses
    ia = json.load(open(os.path.join(IATR, "base", "ia_list_v31.json"), encoding="utf-8"))
    ia_cp = ia["list"][0]["tabs"][0]["list"][0]["options"]["customProps"] if "tabs" in ia["list"][0] else None
    tpl = None

    def walk(n):
        nonlocal tpl
        if isinstance(n, dict):
            o = n.get("options")
            c2 = o.get("customProps") if isinstance(o, dict) else None
            if isinstance(c2, dict) and "filters" in c2:
                for f in c2["filters"]:
                    if f.get("name") == "item_assembly_status":
                        tpl = f
            for v in n.values():
                walk(v)
        elif isinstance(n, list):
            for v in n:
                walk(v)
    walk(ia_cp or ia)
    assert tpl is not None
    f = copy.deepcopy(tpl)
    branch = f["component"]["rules"][0]["children"][1]
    assert branch["operator"] == "any" and branch["children"][0]["prop"] == "dict_key"
    leaf = branch["children"][0]
    branch["children"] = [dict(copy.deepcopy(leaf), id=FILTER_ID + i, parentId=branch["id"], value=k) for i, k in enumerate(STATUS_KEYS)]
    f.update({"name": "stock_movement_status", "title": "Status", "description": "Location Transfer Status", "key": fkey["stock_movement_status"]})
    assert str(FILTER_ID)[:10] not in raw
    cp["filters"].append(f)
    # the handlers
    ev = {e["name"]: e for e in page["config"]["eventScript"]}
    for name, pairs in (("bulkCancel_LOT", CANCEL), ("bulkDelete_LOT", DELETE)):
        fn = ev[name]["func"]
        for old, new in pairs:
            fn = UI.replace_once(fn, old, new, name)
        ev[name]["func"] = fn
    return page


if __name__ == "__main__":
    if "--patches" in sys.argv:
        print(json.dumps({"cancel": CANCEL, "delete": DELETE, "badge": BADGE, "iatr_wf": UI.IATR_WF}))
        sys.exit(0)
    page = build()
    text = json.dumps(page, ensure_ascii=False, separators=(",", ":"))
    path = os.path.join(OUT, "list", "LOTlist.json")
    print("LOT list: md5 %s%s" % (hashlib.md5(text.encode("utf-8")).hexdigest(), " -> " + path if "--write" in sys.argv else " (dry)"))
    if "--write" in sys.argv:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        open(path, "w", encoding="utf-8").write(text)

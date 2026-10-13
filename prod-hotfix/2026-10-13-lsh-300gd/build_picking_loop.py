#!/usr/bin/env python3
"""Step 4 of the LSH plan: Convert to Picking (PICKING_LOOP Add) at LSH's size. One file for prod and dev
(dev v85 = prod v40 = Picking/PickingLoopWorkflow.json = .PROD.json).

The 300-GD convert (2026-10-13 00:36) took 190 s: 77 s of it wrote the 300 GD headers 2,096 times, because
code_node_1HuvfKMv listed one GD per Picking line. And the four "stamp Created" update-nodes are keyed on id
lists, which makes the platform ignore their status filter: converting a Full Picking remainder reset In
Progress lines and headers to Created.

1. code_node_1HuvfKMv: de-duplicated, digits-only id lists (CSV) instead of per-row lists.
2. sql_node_StampState + code_node_StampPlan: read the current status of those GDs / lines / Picking Plans
   and keep only the rows still waiting for a Picking (Not Created, Cancelled, empty) -- what the filters
   meant. Each update-node writes exactly that list, behind an IF so an empty list writes nothing.
3. code_node_hjAwTKzF takes its Picking from the loop item (it read the whole arrayData on every pass);
   code_node_uPSc7Syb no longer reads arrayData at all; CHECK_REQUIRED_FIELD gets a placeholder list
   instead of every Picking line (it only checks the list is not empty).

usage: python3 build_picking_loop.py [--write]
"""
import copy, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_picking as bp  # noqa: E402

REPO = bp.REPO
MAIN = os.path.join(REPO, "Picking", "PickingLoopWorkflow.json")
PROD_MIRROR = os.path.join(REPO, "Picking", "PickingLoopWorkflow.PROD.json")
WF_ID = 2021065804251615233

UNIQUE_OLD = """const arrayData = {{workflowparams:arrayData}};
const allData = arrayData[0];
const unique = `${allData.created_by || ""}_${Date.now()}`;
"""
UNIQUE_NEW = """// This run's key for its cache entries (it used to read the whole arrayData only for created_by).
const unique = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
"""

PREP_OLD_HEAD = """const arrayData = {{workflowparams:arrayData}}
const currentIndexRaw = {{node:get_cache_node_hGFbHnzQ.data}}"""
PREP_NEW_HEAD = """const currentIndexRaw = {{node:get_cache_node_hGFbHnzQ.data}}"""
PREP_OLD_DATA = "let data = arrayData[index];\n"
PREP_NEW_DATA = ("// The loop's own item: arrayData[index] took every Picking of the batch on every pass.\n"
                 "let data = {{node:loop_BIfi18oK}} || {};\n")
PREP_OLD_RET = """return {
  data,
  updatedStatus,"""
PREP_NEW_RET = """return {
  data,
  itemCount: Array.isArray(data.table_picking_items) ? data.table_picking_items.length : 0,
  updatedStatus,"""

REQ_OLD = "    table_picking_items: {{node:code_node_hjAwTKzF.data.data.table_picking_items}},\n"
REQ_NEW = ("    // CHECK_REQUIRED_FIELD only checks that the list is not empty; a placeholder keeps its verdict.\n"
           "    table_picking_items: {{node:code_node_hjAwTKzF.data.itemCount}} > 0 ? [{}] : [],\n")

IDS_OLD = """const gdIds = pickingData.table_picking_items.filter((item) => item.line_status !== "Cancelled").map((item) => item.gd_id);

const toIds = pickingData.table_picking_items.filter((item) => item.line_status !== "Cancelled").map((item) => item.to_id);

const filteredPickingItems = pickingData.table_picking_items.filter((item) => item.line_status !== "Cancelled",);

return {
  gdIds,
  toIds,
  filteredPickingItems,
  isPickingPlan,
}"""
IDS_NEW = """// One entry per document or line, digits only (sql_node_StampState takes them as text): the per-row lists
// wrote each GD header once per Picking line, 2,096 writes for the 300-GD convert.
const pickingItems = pickingData.table_picking_items.filter((item) => item.line_status !== "Cancelled");
const digits = (v) => (/^[0-9]{1,20}$/.test(String(v == null ? "" : v)) ? String(v) : "");
const csv = (key) => [...new Set(pickingItems.map((item) => digits(item[key])).filter(Boolean))].join(",");

return {
  isPickingPlan,
  gdIdCsv: isPickingPlan ? "" : csv("gd_id"),
  gdLineIdCsv: isPickingPlan ? "" : csv("gd_line_id"),
  toIdCsv: isPickingPlan ? csv("to_id") : "",
  toLineIdCsv: isPickingPlan ? csv("to_line_id") : "",
}"""

STATE_SQL = """SELECT CAST('gd' AS CHAR) AS kind, CAST(g.id AS CHAR) AS id, CAST(COALESCE(g.picking_status, '') AS CHAR) AS picking_status
FROM JSON_TABLE(CONCAT('[', '{{node:code_node_1HuvfKMv.data.gdIdCsv}}', ']'), '$[*]' COLUMNS (rid BIGINT PATH '$')) j
JOIN goods_delivery g ON g.id = j.rid AND g.is_deleted = 0
UNION ALL
SELECT CAST('gd_line' AS CHAR), CAST(l.id AS CHAR), CAST(COALESCE(l.picking_status, '') AS CHAR)
FROM JSON_TABLE(CONCAT('[', '{{node:code_node_1HuvfKMv.data.gdLineIdCsv}}', ']'), '$[*]' COLUMNS (rid BIGINT PATH '$')) j
JOIN goods_delivery_fwii8mvb_sub l ON l.id = j.rid AND l.is_deleted = 0
UNION ALL
SELECT CAST('pp' AS CHAR), CAST(p.id AS CHAR), CAST(COALESCE(p.picking_status, '') AS CHAR)
FROM JSON_TABLE(CONCAT('[', '{{node:code_node_1HuvfKMv.data.toIdCsv}}', ']'), '$[*]' COLUMNS (rid BIGINT PATH '$')) j
JOIN picking_plan p ON p.id = j.rid AND p.is_deleted = 0
UNION ALL
SELECT CAST('pp_line' AS CHAR), CAST(l.id AS CHAR), CAST(COALESCE(l.picking_status, '') AS CHAR)
FROM JSON_TABLE(CONCAT('[', '{{node:code_node_1HuvfKMv.data.toLineIdCsv}}', ']'), '$[*]' COLUMNS (rid BIGINT PATH '$')) j
JOIN picking_plan_fwii8mvb_sub l ON l.id = j.rid AND l.is_deleted = 0"""

PLAN_JS = """// "Created" goes only on rows still waiting for a Picking. The update-nodes below are keyed on id lists, and an
// id list makes the platform ignore their status filter, so they used to reset In Progress / Completed rows too.
const STAMPABLE = { "Not Created": true, "Cancelled": true, "": true };
const raw = {{node:sql_node_StampState.data}};
const rows = Array.isArray(raw) ? raw : raw ? [raw] : [];
const pick = (kind) => [
  ...new Set(rows.filter((r) => r.kind === kind && STAMPABLE[r.picking_status || ""] === true).map((r) => String(r.id))),
];
const gdIds = pick("gd");
const gdLineIds = pick("gd_line");
const toIds = pick("pp");
const toLineIds = pick("pp_line");

return {
  gdIds,
  gdLineIds,
  toIds,
  toLineIds,
  hasGdIds: gdIds.length > 0 ? 1 : 0,
  hasGdLineIds: gdLineIds.length > 0 ? 1 : 0,
  hasToIds: toIds.length > 0 ? 1 : 0,
  hasToLineIds: toLineIds.length > 0 ? 1 : 0,
};
"""

# update-node -> (the old id list it was keyed on, the exact list it now writes, its IF flag)
STAMPS = {
    "update_node_g7Juvu0X": ("{{node:code_node_1HuvfKMv.data.gdIds}}", "gdIds", "hasGdIds", "GD Headers To Stamp"),
    "update_node_CfTrqcLh": ("{{node:code_node_1HuvfKMv.data.filteredPickingItems.gd_line_id}}", "gdLineIds",
                             "hasGdLineIds", "GD Lines To Stamp"),
    "update_node_BnFKmzTB": ("{{node:code_node_1HuvfKMv.data.toIds}}", "toIds", "hasToIds", "Picking Plans To Stamp"),
    "update_node_WU2OsGIZ": ("{{node:code_node_1HuvfKMv.data.filteredPickingItems.to_line_id}}", "toLineIds",
                             "hasToLineIds", "Picking Plan Lines To Stamp"),
}


def patch_stamp(wf, ids, nid, old_ref, key, flag, title):
    lst, i = bp.locate(wf, nid)
    node = lst[i]
    rules = node["data"]["table_id"]["rules"]["list"]
    [top] = rules
    assert top["type"] == "branch" and top["operator"] == "all"
    id_leaf, status_branch = top["children"]
    assert id_leaf["prop"] == "id" and id_leaf["value"] == old_ref, (nid, id_leaf)
    new_ref = "{{node:code_node_StampPlan.data.%s}}" % key
    id_leaf["value"] = new_ref
    for leaf in status_branch["children"]:  # quoted values ("'Not Created'") never matched anything
        if isinstance(leaf.get("value"), str) and leaf["value"].startswith("'") and leaf["value"].endswith("'"):
            leaf["value"] = leaf["value"][1:-1]
    id_prop = next(p for p in node["data"]["props"]["list"] if p["prop"] == "id")
    assert id_prop["value"] == old_ref
    id_prop["value"] = new_ref
    lst[i] = bp.flag_if(ids, "if_" + nid.split("_")[-1] + "Stamp", "IF " + title,
                        "node.code_node_StampPlan.data." + flag, [node])


def build(base):
    wf = copy.deepcopy(base)
    ids = bp.Ids(wf)
    bp.replace_code(wf, "code_node_uPSc7Syb", UNIQUE_OLD, UNIQUE_NEW)

    bp.replace_code(wf, "code_node_hjAwTKzF", PREP_OLD_HEAD, PREP_NEW_HEAD)
    bp.replace_code(wf, "code_node_hjAwTKzF", PREP_OLD_DATA, PREP_NEW_DATA)
    bp.replace_code(wf, "code_node_hjAwTKzF", PREP_OLD_RET, PREP_NEW_RET)
    prep = bp.node(wf, "code_node_hjAwTKzF")
    rj = prep["data"]["response_json"]
    assert rj[0]["name"] == "data"
    rj.insert(1, bp.resp(ids, "itemCount", "int"))
    bp.replace_code(wf, "code_node_jZbs5DDd", REQ_OLD, REQ_NEW)

    bp.replace_code(wf, "code_node_1HuvfKMv", IDS_OLD, IDS_NEW)
    stamp_ids = bp.node(wf, "code_node_1HuvfKMv")
    assert [r["name"] for r in stamp_ids["data"]["response_json"]] == ["gdIds", "filteredPickingItems", "toIds",
                                                                       "isPickingPlan"]
    stamp_ids["data"]["response_json"] = [r for r in stamp_ids["data"]["response_json"] if r["name"] == "isPickingPlan"]
    stamp_ids["data"]["response_json"] += [bp.resp(ids, n, "string")
                                          for n in ("gdIdCsv", "gdLineIdCsv", "toIdCsv", "toLineIdCsv")]

    lst, i = bp.locate(wf, "code_node_1HuvfKMv")
    assert lst[i + 1]["id"] == "if_tOacmhkB"
    state = bp.sql_node(ids, "sql_node_StampState", "Current Picking Status (GD / Picking Plan)", STATE_SQL,
                        ["kind", "id", "picking_status"])
    plan = bp.code_node(ids, "code_node_StampPlan", "Rows To Stamp Created", PLAN_JS,
                        [("gdIds", "array"), ("gdLineIds", "array"), ("toIds", "array"), ("toLineIds", "array"),
                         ("hasGdIds", "int"), ("hasGdLineIds", "int"), ("hasToIds", "int"), ("hasToLineIds", "int")])
    lst[i + 1:i + 1] = [state, plan]
    for nid, (old_ref, key, flag, title) in STAMPS.items():
        patch_stamp(wf, ids, nid, old_ref, key, flag, title)
    return wf


def main(write):
    raw = open(MAIN, encoding="utf-8").read()
    base = json.loads(raw)
    _, dev = bs_enabled("--dev")
    _, prod = bs_enabled("--prod")
    assert bp.canon(base) == bp.canon(dev) == bp.canon(prod), "PICKING_LOOP: repo, dev and prod differ"
    assert open(PROD_MIRROR, encoding="utf-8").read() == raw, "the .PROD mirror differs from the main file"
    target = build(base)
    text = bp.render_onto(raw, base, target, normalize=())
    print("PICKING_LOOP: dev = prod = repo file; built")
    if write:
        for path in (MAIN, PROD_MIRROR):
            open(path, "w", encoding="utf-8").write(text)
            print("wrote", os.path.relpath(path, REPO))
    else:
        out = os.path.join(os.environ.get("TMPDIR", "/tmp"), "PickingLoopWorkflow.built.json")
        open(out, "w", encoding="utf-8").write(text)
        print("dry run, wrote", out)
    return target


def bs_enabled(env):
    import build_so_to_gd as bs
    return bs.enabled(env, WF_ID)


if __name__ == "__main__":
    main("--write" in sys.argv)

#!/usr/bin/env python3
"""Generate Item Assembly & BOM/BOMsaveWorkflow.json.

Mirrors the shape of Item/ItemSaveWorkflow.json: code-node validation, if-gates,
one fork-join for the independent lookups, then an add/update split.
"""
import json, os, itertools

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "Item Assembly & BOM", "BOMsaveWorkflow.json")

BOM_TABLE = "Bill of Materials:Table:1902195284188975106"
BOM_ID = "1902195284188975106"
ITEM_TABLE = "Item:Table:1901546842240438273"
ITEM_ID = "1901546842240438273"
CHECK_REQUIRED = "CHECK_REQUIRED_FIELD:Workflow:1988831880511062018"
CHECK_REQUIRED_ID = "1988831880511062018"

_fid = itertools.count(1700000000001)
def fid(): return next(_fid)

_key = itertools.count()
def key(prefix):
    return (prefix + "0000000000")[:8].replace("_", "x") + str(next(_key))[-0:] or "k"

def rj(*names):
    """response_json entries — the allow-list the runtime filters returns through."""
    out = []
    for i, n in enumerate(names):
        out.append({"key": "rj%s%02d" % (n[:4].ljust(4, "x"), i), "name": n,
                    "title": "", "description": "",
                    "bsonType": "any" if n in ("entry", "prevDefaultIds") else "string",
                    "isExpand": False, "children": []})
    return out

def code_node(nid, title, script, *returns):
    return {"id": nid, "type": "code-node",
            "data": {"language": "javascript", "code": "", "timeout": 30000,
                     "title": title, "isValidator": True, "nodeName": title, "name": title,
                     "script": {"type": "javascript", "code": script},
                     "response_json": rj(*returns)},
            "blocks": []}

def empty_leaf():
    return {"list": [{"id": fid(), "parentId": fid(), "isTop": True, "prop": "",
                      "operator": "", "valueType": "", "value": "", "type": "leaf", "level": 1}]}

def end_error(nid, code, msg_js):
    return {"id": nid, "type": "end-node",
            "data": {"title": "结束节点", "outputs": {"type": "object",
                                                  "properties": {"result": {"type": "string"}}},
                     "isValidator": True, "nodeName": "结束节点", "name": "结束节点",
                     "back_data_type": "Default", "code": code,
                     "msg": {"type": "javascript", "code": msg_js}},
            "blocks": []}

def if_node(nid, title, expr, true_blocks, false_blocks=None):
    return {"id": nid, "type": "if",
            "data": {"title": title, "isValidator": True, "nodeName": title, "name": title,
                     "condition_type": "Expression", "filter": empty_leaf(),
                     "expression": {"type": "javascript", "code": expr}},
            "blocks": [
                {"id": nid + "_t", "type": "ifBlock", "data": {"title": "true"},
                 "blocks": true_blocks},
                {"id": nid + "_f", "type": "ifBlock", "data": {"title": "false"},
                 "blocks": false_blocks or []},
            ]}

def leaf(prop, operator, value, label=None):
    return {"id": fid(), "parentId": fid(), "isTop": False, "prop": prop,
            "operator": operator, "valueType": "field", "value": value,
            "type": "leaf", "level": 2, "propLabel": label or prop,
            "valueLabel": "", "operatorLabel": operator}

def all_branch(children):
    """Multiple conditions MUST hang off one branch/all — sibling leaves don't AND."""
    top = {"id": fid(), "parentId": fid(), "isTop": True, "prop": "", "operator": "all",
           "valueType": "", "value": "", "type": "branch", "level": 1, "children": children}
    return {"list": [top]}

def single_leaf(prop, operator, value, label=None):
    return {"list": [{"id": fid(), "parentId": fid(), "isTop": True, "prop": prop,
                      "operator": operator, "valueType": "field", "value": value,
                      "type": "leaf", "level": 1, "propLabel": label or prop,
                      "valueLabel": "", "operatorLabel": operator}]}

def props(pairs):
    return {"modelName": "", "list": [
        {"prop": p, "valueType": vt, "value": v, "operator": "", "valueLabel": "", "propLabel": p}
        for p, v, vt in pairs]}

# ---------------------------------------------------------------- scripts

DETERMINE = """const entry = {{workflowparams:allData}};
const pageStatus = {{workflowparams:pageStatus}} || entry.page_status;

const isEdit = pageStatus === 'Edit';

// A Clone is a brand new record: keeping the source ids would rewrite the
// source's own child rows instead of inserting a new set.
if (pageStatus === 'Clone') {
  delete entry.id;
}

// UI-only models that are not columns on bill_of_materials.
delete entry.default_dialog;
delete entry.page_status;

entry.is_active = entry.is_active === 1 ? 1 : 0;
entry.parent_mat_is_default = entry.parent_mat_is_default === 1 ? 1 : 0;

// An empty string into a bigint column is rejected by the platform; null is not.
const BIGINT_HEADER = ['parent_material_category', 'parent_mat_base_uom', 'parent_mat_bom_version_type'];
const BIGINT_LINE = ['sub_material_category', 'sub_material_qty_uom', 'ref_bom_id'];

BIGINT_HEADER.forEach(function (col) {
  if (entry[col] === '' || entry[col] === undefined) entry[col] = null;
});

const rows = (entry.subform_sub_material || []).filter(function (row) {
  return row && row.bom_material_code;
});

rows.forEach(function (row) {
  if (pageStatus === 'Clone') {
    delete row.id;
    delete row.bill_of_materials_id;
  }
  BIGINT_LINE.forEach(function (col) {
    if (row[col] === '' || row[col] === undefined) row[col] = null;
  });
  row.bom_type = row.bom_type || 'standard';
  row.consume_type = row.consume_type || 'USE';
  if (row.bom_type !== 'reference') row.ref_bom_id = null;
  // Superseded by ref_bom_id; never written again.
  row.sub_material_bom_version = null;
});

entry.subform_sub_material = rows;

return {
  entry: entry,
  isEdit: isEdit ? 'Y' : 'N',
  hasOrg: entry.organization_id && entry.organization_id !== '' ? 'Y' : 'N',
  bomId: entry.id ? String(entry.id) : ''
};"""

REQUIRED = """const entry = {{node:code_determine.data.entry}};

const requiredFields = [
  { name: 'parent_material_code', label: 'Material Code' },
  { name: 'parent_mat_bom_version', label: 'BOM Version' },
  { name: 'parent_mat_base_uom', label: 'Based UOM' },
  { name: 'parent_mat_base_quantity', label: 'Base Quantity' },
  {
    name: 'subform_sub_material',
    label: 'Sub Material',
    isArray: true,
    arrayType: 'object',
    arrayFields: [
      { name: 'bom_material_code', label: 'Material Code' },
      { name: 'sub_material_qty', label: 'Quantity' }
    ]
  }
];

return {
  required_fields: JSON.stringify(requiredFields),
  data: JSON.stringify({
    parent_material_code: entry.parent_material_code,
    parent_mat_bom_version: entry.parent_mat_bom_version,
    parent_mat_base_uom: entry.parent_mat_base_uom,
    parent_mat_base_quantity: entry.parent_mat_base_quantity,
    subform_sub_material: entry.subform_sub_material
  })
};"""

VALIDATE_LINES = """const entry = {{node:code_determine.data.entry}};
const rows = entry.subform_sub_material || [];

let message = '';

if (rows.length === 0) {
  message = 'A Bill of Materials needs at least one sub material.';
}

const seen = {};
for (let i = 0; i < rows.length && !message; i++) {
  const row = rows[i];
  const line = i + 1;
  const code = String(row.bom_material_code);

  if (code === String(entry.parent_material_code)) {
    message = 'Line ' + line + ': a material cannot be a sub material of itself.';
  } else if (seen[code]) {
    message = 'Line ' + line + ': material is already on line ' + seen[code] + '.';
  } else if (Number(row.sub_material_wastage || 0) < 0 || Number(row.sub_material_wastage || 0) > 100) {
    message = 'Line ' + line + ': wastage must be between 0 and 100.';
  } else if (row.bom_type === 'reference' && !row.ref_bom_id) {
    message = 'Line ' + line + ': a reference line needs a Ref BOM.';
  }
  seen[code] = line;
}

return {
  entry: entry,
  status: message ? 'Failed' : 'Passed',
  message: message
};"""

GUARD = """const rows = {{node:search_sibling_boms.data.data}} || [];
const entry = {{node:code_validate_lines.data.entry}};
const bomId = {{node:code_determine.data.bomId}};

const version = String(entry.parent_mat_bom_version || '').trim().toUpperCase();

const duplicate = rows.some(function (r) {
  return String(r.parent_mat_bom_version || '').trim().toUpperCase() === version
    && String(r.id) !== String(bomId);
});

// Computed before the write, so the record being saved can never be in it.
const prevDefaultIds = entry.parent_mat_is_default === 1
  ? rows.filter(function (r) {
      return r.parent_mat_is_default === 1 && String(r.id) !== String(bomId);
    }).map(function (r) { return r.id; })
  : [];

// Child rows inherit the document's tenant; a null here would break a later
// edit that deletes a line.
const self = rows.find(function (r) { return String(r.id) === String(bomId); });
const subTenantId = (self && self.sub_tenant_id) || (rows[0] && rows[0].sub_tenant_id) || null;

return {
  entry: entry,
  status: duplicate ? 'Failed' : 'Passed',
  message: duplicate ? 'BOM version ' + version + ' already exists for this material.' : '',
  prevDefaultIds: prevDefaultIds,
  hasPrevDefault: prevDefaultIds.length > 0 ? 'Y' : 'N',
  subTenantId: subTenantId
};"""

FORMAT = """const entry = {{node:code_guard.data.entry}};
// A get-node's record sits at .data.data -- one level less is the {count, data}
// envelope, which is truthy and makes every field read undefined.
const itemRaw = {{node:get_parent_item.data.data}};
const subTenantId = {{node:code_guard.data.subTenantId}};

const item = Array.isArray(itemRaw) ? itemRaw[0] : itemRaw;

// These columns are decimal(65,3). A raw float is serialized at full precision
// (1.6 -> 1.5999999999999999); the DB's BigDecimal multipleOf check then rejects
// the whole save, so every one of them is coerced to a fixed-scale STRING here.
// This map is an ALLOW-LIST -- a decimal column missing from it will crash a save.
const DEC_HEADER = { parent_mat_base_quantity: 3 };
const DEC_LINE = { sub_material_qty: 3 };

// A blank stays blank: defaulting to "0.000" would write a zero where the user
// left the field empty.
const applyDec = (row, map) => {
  const out = Object.assign({}, row);
  Object.keys(map).forEach((column) => {
    const raw = out[column];
    if (raw === null || raw === undefined || raw === '') {
      return;
    }
    const parsed = parseFloat(raw);
    out[column] = isNaN(parsed) ? raw : parsed.toFixed(map[column]);
  });
  return out;
};

let payload = applyDec(entry, DEC_HEADER);

// Re-derive from the Item so a stale client payload cannot blank these again.
if (item) {
  payload.parent_material_name = item.material_name;
  payload.parent_material_desc = item.material_desc;
  payload.parent_material_category = item.item_category || null;
  payload.parent_mat_base_uom = item.based_uom || null;
}

payload.subform_sub_material = (entry.subform_sub_material || []).map(function (row) {
  const line = applyDec(row, DEC_LINE);
  // sub_material_wastage is an int column, so it rounds rather than toFixed.
  line.sub_material_wastage = Math.round(Number(line.sub_material_wastage) || 0);
  if (subTenantId) {
    line.sub_tenant_id = line.sub_tenant_id || subTenantId;
  } else {
    // Let the platform's default apply rather than writing an explicit null.
    delete line.sub_tenant_id;
  }
  return line;
});

payload.is_deleted = 0;

return { entry: payload };"""

SAVED = """const isEdit = {{node:code_determine.data.isEdit}} === 'Y';
const entry = {{node:code_format.data.entry}};
const added = {{node:add_bom.data}};

// On Add the insert returns the row that was actually written; on Edit the
// payload we just wrote is already the record.
const addedRow = added && added.length > 0 ? added[0] : added;
const row = isEdit ? entry : addedRow;

return {
  id: row.id ? String(row.id) : '',
  parent_material_code: row.parent_material_code,
  parent_mat_bom_version: row.parent_mat_bom_version,
  parent_mat_is_default: String(row.parent_mat_is_default)
};"""

# ---------------------------------------------------------------- write columns

HEADER_COLUMNS = [
    "parent_material_code", "parent_material_name", "parent_material_desc",
    "parent_material_category", "parent_mat_bom_version", "parent_mat_bom_version_type",
    "parent_mat_base_quantity", "parent_mat_base_uom", "parent_mat_is_default",
    "is_active", "bom_remark", "organization_id", "subform_sub_material",
]

def write_props(include_id):
    pairs = []
    if include_id:
        pairs.append(("id", "{{node:code_format.data.entry.id}}", "field"))
    for col in HEADER_COLUMNS:
        pairs.append((col, "{{node:code_format.data.entry.%s}}" % col, "field"))
    return props(pairs)

# ---------------------------------------------------------------- assemble

nodes = [
    {"id": "start", "type": "start-node",
     "data": {"isValidator": True, "title": "Start Node", "nodeName": "Start Node",
              "name": "Start Node"}, "blocks": []},

    code_node("code_determine", "Determine Params", DETERMINE,
              "entry", "isEdit", "hasOrg", "bomId"),

    if_node("if_no_org", "Missing Organization?",
            "'{{node:code_determine.data.hasOrg}}' == 'N'",
            [end_error("end_no_org_404", 404,
                       "'Organization is required to save a Bill of Materials.'")]),

    code_node("code_required", "Required Fields", REQUIRED, "required_fields", "data"),

    {"id": "wf_check_required", "type": "workflow-node",
     "data": {"workflow_id": "", "workflow_name": "", "input_params": {},
              "title": "Check Required Workflow", "isValidator": True,
              "nodeName": "Check Required Workflow", "name": "Check Required Workflow",
              "workflow": {"source": CHECK_REQUIRED,
                           "rules": {"collectionId": CHECK_REQUIRED_ID,
                                     "list": empty_leaf()["list"]}},
              "remote": True, "remoteType": "innerdatasource",
              "body_params": {"list": [
                  {"prop": "entry", "propLabel": "entry", "operator": "", "operatorLabel": "",
                   "valueType": "field", "valueTypeLabel": "",
                   "value": "{{node:code_required.data.data}}", "valueLabel": ""},
                  {"prop": "required_fields", "propLabel": "required_fields", "operator": "",
                   "operatorLabel": "", "valueType": "field", "valueTypeLabel": "",
                   "value": "{{node:code_required.data.required_fields}}", "valueLabel": ""}]}},
     "blocks": []},

    if_node("if_required_failed", "Validation Failed?",
            "'{{node:wf_check_required.data.data.status}}' == 'Failed'",
            [end_error("end_required_400", 400,
                       "{{node:wf_check_required.data.data.message}}")]),

    code_node("code_validate_lines", "Validate Sub Materials", VALIDATE_LINES,
              "entry", "status", "message"),

    if_node("if_lines_failed", "Sub Material Invalid?",
            "'{{node:code_validate_lines.data.status}}' == 'Failed'",
            [end_error("end_lines_400", 400, "{{node:code_validate_lines.data.message}}")]),

    # Two independent reads: one slowest branch instead of two round-trips.
    {"id": "cond_all_lookup", "type": "condition-all-node",
     "data": {"title": "Lookups", "filter": {"list": []}, "expression": {"code": ""},
              "displayContent": "sdk.form.setCondition"},
     "blocks": [
         {"id": "cond_lookup_item", "type": "condition-all-node-item",
          "data": {"title": "Parent Item", "filter": empty_leaf(),
                   "expression": {"code": "true", "type": "javascript"},
                   "displayContent": "sdk.form.setCondition", "isValidator": True,
                   "nodeName": "Parent Item", "name": "Parent Item",
                   "condition_type": "Expression"},
          "blocks": [
              {"id": "get_parent_item", "type": "get-node",
               "data": {"table_id": {"source": ITEM_TABLE,
                                     "rules": {"collectionId": ITEM_ID,
                                               "list": single_leaf(
                                                   "id", "in",
                                                   "{{node:code_determine.data.entry.parent_material_code}}",
                                                   "Primary Key ID")["list"]}},
                        "condition": {}, "title": "Get Parent Item", "isValidator": True,
                        "nodeName": "Get Parent Item", "name": "Get Parent Item"},
               "blocks": []}]},
         {"id": "cond_lookup_siblings", "type": "condition-all-node-item",
          "data": {"title": "Sibling BOMs", "filter": empty_leaf(),
                   "expression": {"code": "true", "type": "javascript"},
                   "displayContent": "sdk.form.setCondition", "isValidator": True,
                   "nodeName": "Sibling BOMs", "name": "Sibling BOMs",
                   "condition_type": "Expression"},
          "blocks": [
              {"id": "search_sibling_boms", "type": "search-node",
               "data": {"table_id": {"source": BOM_TABLE,
                                     "rules": {"collectionId": BOM_ID,
                                               "list": all_branch([
                                                   leaf("organization_id", "equal",
                                                        "{{node:code_determine.data.entry.organization_id}}"),
                                                   leaf("parent_material_code", "equal",
                                                        "{{node:code_determine.data.entry.parent_material_code}}"),
                                               ])["list"]}},
                        "condition": {}, "limit": 1000,
                        "title": "Get Sibling BOMs", "isValidator": True,
                        "nodeName": "Get Sibling BOMs", "name": "Get Sibling BOMs"},
               "blocks": []}]},
     ]},

    code_node("code_guard", "Duplicate Version Guard", GUARD,
              "entry", "status", "message", "prevDefaultIds", "hasPrevDefault", "subTenantId"),

    if_node("if_guard_failed", "Duplicate Version?",
            "'{{node:code_guard.data.status}}' == 'Failed'",
            [end_error("end_guard_409", 409, "{{node:code_guard.data.message}}")]),

    code_node("code_format", "Format Write Payload", FORMAT, "entry"),

    if_node("if_edit", "Is Edit?",
            "'{{node:code_determine.data.isEdit}}' == 'Y'",
            [{"id": "update_bom", "type": "update-node",
              "data": {"table_id": {"source": BOM_TABLE,
                                    "rules": {"collectionId": BOM_ID,
                                              "list": single_leaf(
                                                  "id", "in",
                                                  "{{node:code_format.data.entry.id}}")["list"]}},
                       "fields": [], "condition": {}, "title": "Update Data",
                       "isValidator": True, "nodeName": "Update Data", "name": "Update Data",
                       "props": write_props(True)},
              "blocks": []}],
            [{"id": "add_bom", "type": "add-node",
              "data": {"table_id": {"source": BOM_TABLE,
                                    "rules": {"collectionId": BOM_ID,
                                              "list": empty_leaf()["list"]}},
                       "fields": [], "title": "Add Data", "isValidator": True,
                       "nodeName": "Add Data", "name": "Add Data",
                       "props": write_props(False)},
              "blocks": []}]),

    code_node("code_saved", "Saved Record", SAVED,
              "id", "parent_material_code", "parent_mat_bom_version", "parent_mat_is_default"),

    # After the write, so the old default is demoted only once the new row exists.
    if_node("if_reset_prev_default", "Demote Previous Default?",
            "'{{node:code_guard.data.hasPrevDefault}}' == 'Y'",
            [{"id": "update_prev_default", "type": "update-node",
              "data": {"table_id": {"source": BOM_TABLE,
                                    "rules": {"collectionId": BOM_ID,
                                              "list": single_leaf(
                                                  "id", "in",
                                                  "{{node:code_guard.data.prevDefaultIds}}")["list"]}},
                       "fields": [], "condition": {}, "title": "Demote Previous Default",
                       "isValidator": True, "nodeName": "Demote Previous Default",
                       "name": "Demote Previous Default",
                       "props": props([("parent_mat_is_default", "0", "value")])},
              "blocks": []}]),

    {"id": "end", "type": "end-node",
     "data": {"isValidator": True, "title": "End Node", "nodeName": "End Node",
              "name": "End Node", "back_data_type": "OutputParams", "code": "",
              "msg": {"type": "javascript", "code": ""},
              "response_value": {"list": [
                  {"prop": p, "propLabel": p, "operator": "", "operatorLabel": "",
                   "valueType": "field", "valueTypeLabel": "",
                   "value": "{{node:code_saved.data.%s}}" % p, "valueLabel": ""}
                  for p in ("id", "parent_material_code", "parent_mat_bom_version",
                            "parent_mat_is_default")]}},
     "blocks": []},
]

doc = {
    "request_json": [
        {"key": "bomallda", "name": "allData", "title": "All Data", "description": "",
         "bsonType": "any", "isExpand": False, "children": []},
        {"key": "bompgsta", "name": "pageStatus", "title": "Page Status", "description": "",
         "bsonType": "string", "isExpand": False, "children": []},
    ],
    "response_json": [
        {"key": "bomrjid0", "name": "id", "title": "", "description": "",
         "bsonType": "string", "isExpand": False, "children": []},
        {"key": "bomrjmc0", "name": "parent_material_code", "title": "", "description": "",
         "bsonType": "string", "isExpand": False, "children": []},
        {"key": "bomrjvr0", "name": "parent_mat_bom_version", "title": "", "description": "",
         "bsonType": "string", "isExpand": False, "children": []},
        {"key": "bomrjdf0", "name": "parent_mat_is_default", "title": "", "description": "",
         "bsonType": "string", "isExpand": False, "children": []},
    ],
    "config": {},
    "nodes": nodes,
    "edges": [],
}

with open(OUT, "w") as fh:
    json.dump(doc, fh, indent=1, ensure_ascii=False)
    fh.write("\n")
print("wrote", OUT)

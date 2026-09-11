#!/usr/bin/env python3
"""Generate Item Assembly & BOM/ItemAssemblySaveWorkflow.json.

Item Assembly is a two-legged Stock Movement: the subform is a set of MSI issue
lines (components out) and the header is a single MSR receipt line (the assembled
item in). Draft and Completed only.
"""
import json, os, itertools

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "Item Assembly & BOM", "ItemAssemblySaveWorkflow.json")

IA_TABLE = "Item Assembly:Table:2098256587713404929"
IA_ID = "2098256587713404929"
ITEM_TABLE = "Item:Table:1901546842240438273"
MOVE_TABLE = "Inventory Movement:Table:1902259348776800257"
MOVE_ID = "1902259348776800257"
ITEM_ID = "1901546842240438273"

WF_REQUIRED = ("CHECK_REQUIRED_FIELD:Workflow:1988831880511062018", "1988831880511062018")
WF_INVCHECK = ("GLOBAL_INVENTORY_VALIDATION:Workflow:2056291728334573570", "2056291728334573570")
WF_SUBTRACT = ("SUBTRACT_INVENTORY:Workflow:2012096660219564034", "2012096660219564034")
WF_ADD      = ("ADD_INVENTORY:Workflow:2012005532688723970", "2012005532688723970")
WF_BATCH    = ("GENERATE_BATCH:Workflow:2060178784435535873", "2060178784435535873")
WF_HU       = ("HANDLING_UNIT:Workflow:2037062451509002241", "2037062451509002241")


_fid = itertools.count(1790000000001)
def fid(): return next(_fid)

def rj(*names):
    """response_json — the allow-list the runtime filters returns through."""
    out = []
    for i, n in enumerate(names):
        bson = "any" if n in ("allData", "entry", "itemData", "balancesToProcess",
                              "huUpdates", "updates", "itemIds", "table_hu_items",
                              "costRows") else "string"
        if n in ("quantity", "unit_price", "item_qty"):
            bson = "decimal"
        if n in ("index", "nextIndex", "needsGen", "hasHuData", "huUpdatesLength"):
            bson = "int"
        out.append({"key": "ia%s%02d" % (n[:4].ljust(4, "x")[:4], i), "name": n,
                    "title": "", "description": "", "bsonType": bson,
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

def ret(nid, code, msg_value, msg_is_field=True, extra=None):
    lst = [{"prop": "code", "propLabel": "code", "operator": "", "operatorLabel": "",
            "valueType": "value", "valueTypeLabel": "", "value": str(code), "valueLabel": ""},
           {"prop": "message", "propLabel": "message", "operator": "", "operatorLabel": "",
            "valueType": "field" if msg_is_field else "value", "valueTypeLabel": "",
            "value": msg_value, "valueLabel": ""}]
    if extra:
        lst.extend(extra)
    return {"id": nid, "type": "return-node",
            "data": {"return_data": {}, "status_code": 200, "title": "Return Data",
                     "isValidator": True, "nodeName": "Return Data", "name": "Return Data",
                     "response_value": {"list": lst}, "return_raw_data": 0},
            "blocks": []}

def if_expr(nid, title, expr, true_blocks, false_blocks=None):
    return {"id": nid, "type": "if",
            "data": {"title": title, "isValidator": True, "nodeName": title, "name": title,
                     "condition_type": "Expression", "filter": empty_leaf(),
                     "expression": {"type": "javascript", "code": expr}},
            "blocks": [{"id": nid + "_t", "type": "ifBlock", "data": {"title": "true"},
                        "blocks": true_blocks},
                       {"id": nid + "_f", "type": "ifBlock", "data": {"title": "false"},
                        "blocks": false_blocks or []}]}

def if_rule(nid, title, prop, operator, value, true_blocks, false_blocks=None):
    """ConditionRule form — what MSI/MSR use for workflowparams comparisons."""
    leaf = {"id": fid(), "parentId": fid(), "isTop": True, "prop": prop,
            "operator": operator, "valueType": "value", "value": value,
            "type": "leaf", "level": 1, "propLabel": prop, "valueLabel": "",
            "operatorLabel": operator}
    return {"id": nid, "type": "if",
            "data": {"title": title, "isValidator": True, "nodeName": title, "name": title,
                     "condition_type": "ConditionRule", "filter": {"list": [leaf]},
                     "expression": {"type": "javascript", "code": ""}},
            "blocks": [{"id": nid + "_t", "type": "ifBlock", "data": {"title": "true"},
                        "blocks": true_blocks},
                       {"id": nid + "_f", "type": "ifBlock", "data": {"title": "false"},
                        "blocks": false_blocks or []}]}

def loop(nid, title, var_code, blocks):
    return {"id": nid, "type": "loop",
            "data": {"title": title, "isValidator": True, "nodeName": title, "name": title,
                     "loopType": "Var",
                     "loopSeletSource": {"datasource": {"rules": {"collectionId": "",
                                                                 "list": empty_leaf()["list"]}},
                                         "auto_refresh": 1, "auto_refresh_debounce": 100,
                                         "options": [], "props": {"value": "", "label": "",
                                                                  "image": "", "icon": "",
                                                                  "explain": ""},
                                         "remote": False, "remoteType": "datasource",
                                         "limit_count": ""},
                     "loopSeletVar": {"type": "markdown", "code": var_code}},
            "blocks": blocks}

def set_cache(nid, title, key, js):
    return {"id": nid, "type": "set-cache-node",
            "data": {"cache_key": "", "cache_value": "", "expire_time": 3600,
                     "title": title, "isValidator": True, "nodeName": title, "name": title,
                     # custom_wkbocgni is a FIXED platform key, not derived from the
                     # node id: the runtime looks it up by name and a different
                     # suffix throws "custom is null".
                     "custom_wkbocgni": {"type": "javascript", "code": js},
                     "redis_key": key},
            "blocks": []}

def get_cache(nid, title, key):
    return {"id": nid, "type": "get-cache-node",
            "data": {"cache_key": "", "title": title, "isValidator": True,
                     "nodeName": title, "name": title, "redis_key": key},
            "blocks": []}

def wf_node(nid, title, source, collection_id, params):
    return {"id": nid, "type": "workflow-node",
            "data": {"workflow_id": "", "workflow_name": "", "input_params": {},
                     "title": title, "isValidator": True, "nodeName": title, "name": title,
                     "workflow": {"source": source,
                                  "rules": {"collectionId": collection_id,
                                            "list": empty_leaf()["list"]}},
                     "remote": True, "remoteType": "innerdatasource",
                     "body_params": {"list": [
                         {"prop": p, "propLabel": p, "operator": "", "operatorLabel": "",
                          "valueType": vt, "valueTypeLabel": "", "value": v, "valueLabel": ""}
                         for p, v, vt in params]}},
            "blocks": []}

def props(pairs):
    return {"modelName": "", "list": [
        {"prop": p, "valueType": vt, "value": v, "operator": "", "valueLabel": "", "propLabel": p}
        for p, v, vt in pairs]}

def single_leaf(prop, operator, value, label=None):
    return [{"id": fid(), "parentId": fid(), "isTop": True, "prop": prop,
             "operator": operator, "valueType": "field", "value": value,
             "type": "leaf", "level": 1, "propLabel": label or prop,
             "valueLabel": "", "operatorLabel": operator}]

print("helpers ready")

# ---------------------------------------------------------------- scripts

IDEM_GUARD = """const raw = {{node:get_persisted_ia.data.data}};

// Read the stored status from the DB, never from allData: a stale tab or a
// double-click posts the pre-completion status and would move stock twice.
const rec = Array.isArray(raw) ? raw[0] : raw;
const status = rec ? rec.item_assembly_status : '';
const blocked = status === 'Completed' || status === 'Fully Posted' ? 1 : 0;

return {
  blocked: blocked,
  blockedMessage: blocked === 1
    ? 'This Item Assembly is already ' + status + ' and cannot be saved again.'
    : ''
};"""

PERSISTED = """const pageStatus = {{workflowparams:pageStatus}};
const updated = {{node:get_ia.data.data}};
const added = {{node:add_ia.data}};

// One of these two ran; the other resolves null. Guarded on pageStatus.
let rec = pageStatus === 'Edit' ? updated : added;
if (Array.isArray(rec)) rec = rec[0];
rec = rec || {};

// The serial engine replaced the 'issued' sentinel during the write, so this is
// the first point the REAL document number exists. Everything downstream stamps
// trx_no from here -- stamping it from the fillback copy would write the literal
// string 'issued' onto every inventory movement.
return {
  docId: rec.id ? String(rec.id) : '',
  stock_movement_no: rec.stock_movement_no || '',
  stock_movement: rec.stock_movement || []
};"""

FILLBACK = """let allData = {{workflowparams:allData}};
const saveAs = {{workflowparams:saveAs}};
const pageStatus = {{workflowparams:pageStatus}};

// Every decimal column is coerced to a fixed-scale STRING: a raw float is
// serialized at full precision and the DB's BigDecimal multipleOf check then
// rejects the whole save. This list is an ALLOW-LIST -- a decimal column missing
// from it will crash a save.
const formatNumber = (value) => {
  if (value === null || value === undefined || value === '') return 0;
  return parseFloat(value).toFixed(3);
};

const lines = [];
for (const [index, line] of (allData.stock_movement || []).entries()) {
  line.requested_qty = formatNumber(line.requested_qty);
  line.total_quantity = formatNumber(line.total_quantity);
  line.organization_id = allData.organization_id;
  line.issuing_plant = allData.issuing_operation_faci || null;
  line.line_index = index + 1;
  lines.push(line);
}
allData.stock_movement = lines;

// item_qty is decimal(65,3) on the header -- MSI/MSR only format lines because
// their header carries no quantity; this one does.
allData.item_qty = formatNumber(allData.item_qty);

const storedStatus = pageStatus === 'Add' ? 'Draft' : (allData.item_assembly_status || 'Draft');
allData.item_assembly_status = saveAs;

// The platform replaces these sentinels with a real number on insert. -9999 is
// Manual Input, where the user's typed number stands.
if (saveAs === 'Draft') {
  if (allData.stock_movement_no_type !== -9999 &&
      (!allData.stock_movement_no || allData.stock_movement_no === '')) {
    allData.stock_movement_no = 'draft';
  }
} else {
  if (allData.stock_movement_no_type !== -9999 &&
      (!allData.stock_movement_no || allData.stock_movement_no === '' ||
       storedStatus !== 'Completed')) {
    allData.stock_movement_no = 'issued';
  }
  // There is no acc_integration_type column on this table; posting is a later phase.
  allData.posted_status = 'Unposted';
}

return { allData: allData, storedStatus: storedStatus };"""

REQUIRED = """const entry = {{node:code_fillback.data.allData}};

const requiredFields = [
  { name: 'stock_movement_no', label: 'Item Assembly No' },
  { name: 'issuing_operation_faci', label: 'Plant' },
  { name: 'item_id', label: 'Item Code' },
  { name: 'item_qty', label: 'Quantity' },
  { name: 'storage_location_id', label: 'Storage Location' },
  { name: 'location_id', label: 'Bin Location' },
  { name: 'stock_movement', label: 'BOM Components', isArray: true, arrayType: 'object',
    arrayFields: [{ name: 'item_selection', label: 'Item Code' }] }
];

return {
  required_fields: JSON.stringify(requiredFields),
  data: JSON.stringify({
    stock_movement_no: entry.stock_movement_no,
    issuing_operation_faci: entry.issuing_operation_faci,
    item_id: entry.item_id,
    item_qty: entry.item_qty,
    storage_location_id: entry.storage_location_id,
    location_id: entry.location_id,
    stock_movement: entry.stock_movement
  })
};"""

ITEM_IDS = """const entry = {{node:code_fillback.data.allData}};

// The assembled item plus every component, in one fetch.
const ids = [];
if (entry.item_id) ids.push(String(entry.item_id));
(entry.stock_movement || []).forEach(function (line) {
  if (line.item_selection) ids.push(String(line.item_selection));
});

return { itemIds: ids.filter(function (v, i, a) { return a.indexOf(v) === i; }) };"""

VALIDATE = """const entry = {{node:code_fillback.data.allData}};
const storedStatus = {{node:code_fillback.data.storedStatus}};
const items = {{node:search_items.data.data}} || [];

const itemMap = {};
items.forEach(function (it) { itemMap[String(it.id)] = it; });

const round3 = function (v) { return Math.round((parseFloat(v) || 0) * 1000) / 1000; };

let message = '';

// Re-completing an assembly would move stock a second time.
if (storedStatus === 'Completed') {
  message = 'This Item Assembly is already Completed and cannot be saved again.';
}

const itemQty = round3(entry.item_qty);
if (!message && itemQty <= 0) {
  message = 'Quantity must be greater than zero.';
}

const lines = entry.stock_movement || [];
if (!message && lines.length === 0) {
  message = 'No BOM components to consume. Choose an item that has an active Bill of Materials.';
}

for (let i = 0; i < lines.length && !message; i++) {
  const line = lines[i];
  const label = line.item_name || line.item_selection;
  const requested = round3(line.requested_qty);
  const allocated = round3(line.total_quantity);

  let picks = [];
  try {
    picks = line.temp_qty_data ? JSON.parse(line.temp_qty_data) : [];
  } catch (e) {
    picks = [];
  }
  picks = picks.filter(function (p) { return round3(p.sm_quantity) > 0; });

  if (picks.length === 0) {
    message = 'Line ' + (i + 1) + ' (' + label + '): no stock has been allocated.';
  } else if (Math.abs(allocated - requested) > 0.0005) {
    message = 'Line ' + (i + 1) + ' (' + label + '): allocated ' + allocated +
      ' but ' + requested + ' is required.';
  }
}

// A manually-numbered batch item needs its batch before stock can be received.
if (!message) {
  const assembled = itemMap[String(entry.item_id)];
  if (assembled && assembled.item_batch_management === 1 &&
      assembled.batch_number_genaration === 'Manual Input' &&
      (!entry.batch_no || String(entry.batch_no).trim() === '' || entry.batch_no === '-')) {
    message = 'This item is batch managed with manual numbering, so a Batch No is required.';
  }
}

return { status: message ? 'Failed' : 'Passed', message: message };"""

PRECHECK_LINE = """const line = {{node:loop_precheck_lines}};
const entry = {{node:code_fillback.data.allData}};

let picks = [];
try {
  picks = line.temp_qty_data ? JSON.parse(line.temp_qty_data) : [];
} catch (e) {
  picks = [];
}

return {
  plant_id: entry.issuing_operation_faci,
  organization_id: entry.organization_id,
  material_id: line.item_selection,
  material_uom: line.quantity_uom,
  item_name: line.item_name || line.item_selection,
  balancesToProcess: picks.filter(function (p) {
    return (parseFloat(p.sm_quantity) || 0) > 0;
  })
};"""

PRECHECK_PICK = """const pick = {{node:loop_precheck_picks}};

return {
  location_id: pick.location_id || null,
  batch_id: pick.batch_id || null,
  quantity: parseFloat(pick.sm_quantity) || 0,
  inventory_category: pick.category || 'Unrestricted'
};"""

ISSUE_LINE = """const line = {{node:loop_issue_lines}};
const entry = {{node:code_fillback.data.allData}};
const persisted = {{node:code_persisted.data}};
const items = {{node:search_items.data.data}} || [];

let picks = [];
try {
  picks = line.temp_qty_data ? JSON.parse(line.temp_qty_data) : [];
} catch (e) {
  picks = [];
}

const itemData = items.find(function (it) {
  return String(it.id) === String(line.item_selection);
}) || null;

return {
  plant_id: entry.issuing_operation_faci,
  organization_id: entry.organization_id,
  stock_movement_no: persisted.stock_movement_no,
  doc_date: entry.item_assembly_date,
  material_id: line.item_selection,
  material_uom: line.quantity_uom,
  remark: line.item_remark || '',
  remark2: line.item_remark_2 || '',
  remark3: line.item_remark_3 || '',
  itemData: itemData,
  balancesToProcess: picks.filter(function (p) {
    return (parseFloat(p.sm_quantity) || 0) > 0;
  })
};"""

ISSUE_PICK = """const pick = {{node:loop_issue_picks}};

// Every nullable param is null, never '': SUBTRACT_INVENTORY's own Batch ID node
// does `const batchId = ...; if (batchId === "") batchId = null`, which throws
// TypeError: Assignment to constant. MSI passes null for the same reason.
return {
  location_id: pick.location_id || null,
  batch_id: pick.batch_id || null,
  quantity: parseFloat(pick.sm_quantity) || 0,
  inventory_category: pick.category || 'Unrestricted',
  manufacturing_date: pick.manufacturing_date || null,
  expired_date: pick.expired_date || null,
  handling_unit_id: pick.handling_unit_id || null
};"""

BATCH_DECIDE = """const entry = {{node:code_fillback.data.allData}};
const items = {{node:search_items.data.data}} || [];

const assembled = items.find(function (it) {
  return String(it.id) === String(entry.item_id);
}) || {};

const isBatch = assembled.item_batch_management === 1;
const auto = assembled.batch_number_genaration === 'According To System Settings';

return {
  needsGen: isBatch && auto ? 1 : 0,
  manualBatch: isBatch && !auto ? String(entry.batch_no || '') : '',
  isBatch: isBatch ? 'Y' : 'N',
  item_id: String(entry.item_id || ''),
  document_date: entry.item_assembly_date || null,
  manufacturing_date: entry.manufacturing_date || null,
  expired_date: entry.expired_date || null
};"""

BATCH_NUMBER = """const needsGen = {{node:code_batch_decide.data.needsGen}};
// Lives inside if_needs_batch_gen, so it is null whenever generation was skipped.
const generated = {{node:code_normalize_batch.data.batchNumber}};
const manual = {{node:code_batch_decide.data.manualBatch}};

return { batchNumber: needsGen === 1 ? String(generated || '') : String(manual || '') };"""

NORMALIZE_BATCH = """const raw = {{node:wf_generate_batch.data}};
const batchNumber = raw && raw.batch_number ? String(raw.batch_number) : '';

return {
  batchNumber: batchNumber,
  isError: batchNumber === '' ? 1 : 0,
  message: batchNumber === ''
    ? 'Could not generate a batch number. Check the Batch Number Configuration for this item.'
    : ''
};"""

RECEIPT_PREP = """const entry = {{node:code_fillback.data.allData}};
const items = {{node:search_items.data.data}} || [];
const movements = {{node:search_movements.data.data}} || [];
const persisted = {{node:code_persisted.data}};
const batchNumber = {{node:code_batch_number.data.batchNumber}};

const assembled = items.find(function (it) {
  return String(it.id) === String(entry.item_id);
}) || {};

// Read the cost back off the movements the issue leg just wrote. SUBTRACT has a
// success path that returns only `code` and no unit_price, so its response can
// never be relied on; the movement rows always carry the real figure, and FIFO
// splitting one pick across layers is summed correctly here for free.
const consumedValue = movements.reduce(function (sum, m) {
  return sum + (parseFloat(m.total_price) || 0);
}, 0);

const itemQty = parseFloat(entry.item_qty) || 0;
const materialUnitCost = itemQty > 0 ? consumedValue / itemQty : 0;
const assemblyCost = parseFloat(assembled.assembly_cost) || 0;

return {
  plant_id: entry.issuing_operation_faci,
  organization_id: entry.organization_id,
  material_id: entry.item_id,
  material_uom: entry.item_uom,
  quantity: parseFloat(itemQty.toFixed(3)),
  unit_price: parseFloat((materialUnitCost + assemblyCost).toFixed(4)),
  location_id: entry.location_id,
  batch_number: batchNumber,
  trx_no: persisted.stock_movement_no,
  doc_date: entry.item_assembly_date || null,
  manufacturing_date: entry.manufacturing_date || null,
  expired_date: entry.expired_date || null,
  remark: entry.remarks || '',
  remark2: entry.remarks_2 || '',
  remark3: entry.remarks_3 || '',
  itemData: assembled
};"""

HU_UNLOADS = """const entry = {{node:code_fillback.data.allData}};

// Components picked out of a handling unit have to be unloaded from it.
const byHu = {};
(entry.stock_movement || []).forEach(function (line) {
  let picks = [];
  try {
    picks = line.temp_qty_data ? JSON.parse(line.temp_qty_data) : [];
  } catch (e) {
    picks = [];
  }
  picks.forEach(function (p) {
    if (!p.handling_unit_id) return;
    if ((parseFloat(p.sm_quantity) || 0) <= 0) return;
    const key = String(p.handling_unit_id);
    if (!byHu[key]) {
      byHu[key] = {
        handling_unit_id: key,
        plant_id: entry.issuing_operation_faci,
        organization_id: entry.organization_id,
        location_id: p.location_id || null,
        storage_location_id: p.storage_location_id || null,
        table_hu_items: []
      };
    }
    byHu[key].table_hu_items.push({
      material_id: p.material_id || line.item_selection,
      location_id: p.location_id || null,
      batch_id: p.batch_id || null,
      material_uom: line.quantity_uom,
      quantity: parseFloat(p.sm_quantity) || 0,
      balance_id: p.balance_id || null
    });
  });
});

const huUpdates = Object.keys(byHu).map(function (k) { return byHu[k]; });

return { huUpdates: huUpdates, huUpdatesLength: huUpdates.length };"""

HU_PICK = """const hu = {{node:loop_hu}};

return {
  handling_unit_id: hu.handling_unit_id,
  plant_id: hu.plant_id,
  organization_id: hu.organization_id,
  location_id: hu.location_id,
  storage_location_id: hu.storage_location_id,
  table_hu_items: hu.table_hu_items
};"""

ITEM_TXN = """const entry = {{node:code_fillback.data.allData}};

const ids = [];
if (entry.item_id) ids.push(String(entry.item_id));
(entry.stock_movement || []).forEach(function (line) {
  if (line.item_selection) ids.push(String(line.item_selection));
});

const stamp = new Date().toISOString();

const updates = [];
ids.filter(function (v, i, a) { return a.indexOf(v) === i; }).forEach(function (id) {
  updates.push({ id: id, last_transaction_date: stamp });
});

return { updates: updates };"""

DOC_ID = """const entry = {{node:code_fillback.data.allData}};
const persisted = {{node:code_persisted.data.docId}};
// Each add-node lives in a mutually exclusive branch, so at most one of these
// resolves; the others come back null.
const addedDraft = {{node:add_draft.data}};

const firstId = function (raw) {
  if (!raw) return '';
  const row = raw.length > 0 ? raw[0] : raw;
  return row && row.id ? String(row.id) : '';
};

return { id: String(persisted || '') || firstId(addedDraft) || String(entry.id || '') };"""

print("scripts ready")

# ---------------------------------------------------------------- write columns

HEADER_COLUMNS = [
    "item_assembly_status", "issuing_operation_faci", "item_id", "item_name", "item_desc",
    "item_qty", "item_uom", "issued_by", "remarks", "remarks_2", "remarks_3",
    "project_id", "manufacturing_date", "expired_date",
    "storage_location_id", "location_id", "item_assembly_date", "reference_documents",
    "organization_id", "stock_movement",
]

def header_props(include_id=False, include_no=True, include_posted=True,
                 batch_from_node=True):
    pairs = []
    if include_id:
        pairs.append(("id", "{{node:code_fillback.data.allData.id}}", "field"))
    for col in HEADER_COLUMNS:
        pairs.append((col, "{{node:code_fillback.data.allData.%s}}" % col, "field"))
    # A generated batch number has to land on the document, not just on the
    # inventory movement, or the user never sees which batch was created.
    if batch_from_node:
        pairs.append(("batch_no", "{{node:code_batch_number.data.batchNumber}}", "field"))
    else:
        pairs.append(("batch_no", "{{node:code_fillback.data.allData.batch_no}}", "field"))
    if include_no:
        pairs.append(("stock_movement_no", "{{node:code_fillback.data.allData.stock_movement_no}}", "field"))
        pairs.append(("stock_movement_no_type", "{{node:code_fillback.data.allData.stock_movement_no_type}}", "field"))
    if include_posted:
        pairs.append(("posted_status", "Unposted", "value"))
    return props(pairs)

def add_node(nid, title, include_no=True, include_posted=True, batch_from_node=True):
    return {"id": nid, "type": "add-node",
            "data": {"table_id": {"source": IA_TABLE,
                                  "rules": {"collectionId": IA_ID, "list": empty_leaf()["list"]}},
                     "fields": [], "title": title, "isValidator": True,
                     "nodeName": title, "name": title,
                     "props": header_props(False, include_no, include_posted, batch_from_node)},
            "blocks": []}

def update_node(nid, title, include_no=True, include_posted=True, batch_from_node=True):
    return {"id": nid, "type": "update-node",
            "data": {"table_id": {"source": IA_TABLE,
                                  "rules": {"collectionId": IA_ID,
                                            "list": single_leaf("id", "in",
                                                                "{{node:code_fillback.data.allData.id}}")}},
                     "fields": [], "condition": {}, "title": title, "isValidator": True,
                     "nodeName": title, "name": title,
                     "props": header_props(True, include_no, include_posted, batch_from_node)},
            "blocks": []}

# ---------------------------------------------------------------- assemble

nodes = [
    {"id": "start", "type": "start-node",
     "data": {"isValidator": True, "title": "Start Node", "nodeName": "Start Node",
              "name": "Start Node"}, "blocks": []},

    code_node("code_fillback", "fillbackHeaderFields", FILLBACK, "allData", "storedStatus"),
    code_node("code_required", "Required Fields", REQUIRED, "required_fields", "data"),

    wf_node("wf_check_required", "Check Required Workflow", WF_REQUIRED[0], WF_REQUIRED[1], [
        ("entry", "{{node:code_required.data.data}}", "field"),
        ("required_fields", "{{node:code_required.data.required_fields}}", "field"),
    ]),

    if_expr("if_required_failed", "IF Validation Failed",
            "'{{node:wf_check_required.data.data.status}}' == 'Failed'",
            [ret("return_required_400", 400, "{{node:wf_check_required.data.data.message}}")]),

    # ---------------- validation + pre-flight inventory check (non-Draft only)
    if_rule("if_validate", "IF !Draft", "workflowparams.saveAs", "notEqual", "Draft", [
        code_node("code_item_ids", "Collect Item IDs", ITEM_IDS, "itemIds"),
        {"id": "search_items", "type": "search-node",
         "data": {"table_id": {"source": ITEM_TABLE,
                               "rules": {"collectionId": ITEM_ID,
                                         "list": single_leaf("id", "equalAny",
                                                             "{{node:code_item_ids.data.itemIds}}")}},
                  "condition": {}, "limit": 1000, "title": "Get Items", "isValidator": True,
                  "nodeName": "Get Items", "name": "Get Items"},
         "blocks": []},

        code_node("code_validate", "Validate Assembly", VALIDATE, "status", "message"),
        if_expr("if_validate_failed", "IF Assembly Invalid",
                "'{{node:code_validate.data.status}}' == 'Failed'",
                [ret("return_validate_401", 401, "{{node:code_validate.data.message}}")]),

        if_rule("if_edit_guard", "IF Edit Mode", "workflowparams.pageStatus", "equal", "Edit", [
            {"id": "get_persisted_ia", "type": "get-node",
             "data": {"table_id": {"source": IA_TABLE,
                                   "rules": {"collectionId": IA_ID,
                                             "list": single_leaf("id", "in",
                                                                 "{{node:code_fillback.data.allData.id}}")}},
                      "condition": {}, "title": "Get Stored Assembly", "isValidator": True,
                      "nodeName": "Get Stored Assembly", "name": "Get Stored Assembly"},
             "blocks": []},
            code_node("code_idem_guard", "Idempotency Guard", IDEM_GUARD,
                      "blocked", "blockedMessage"),
            if_expr("if_idem_blocked", "IF Already Completed",
                    "{{node:code_idem_guard.data.blocked}} == 1",
                    [ret("return_idem_409", 409,
                         "{{node:code_idem_guard.data.blockedMessage}}")]),
        ]),

        loop("loop_precheck_lines", "Loop Components (pre-check)",
             "{{node:code_fillback.data.allData.stock_movement}}", [
            code_node("code_precheck_line", "Pre-check Line Prep", PRECHECK_LINE,
                      "plant_id", "organization_id", "material_id", "material_uom",
                      "item_name", "balancesToProcess"),
            loop("loop_precheck_picks", "Loop Picks (pre-check)",
                 "{{node:code_precheck_line.data.balancesToProcess}}", [
                code_node("code_precheck_pick", "Pre-check Pick Prep", PRECHECK_PICK,
                          "location_id", "batch_id", "quantity", "inventory_category"),
                wf_node("wf_check_inventory", "Check Inventory", WF_INVCHECK[0], WF_INVCHECK[1], [
                    ("material_id", "{{node:code_precheck_line.data.material_id}}", "field"),
                    ("quantity", "{{node:code_precheck_pick.data.quantity}}", "field"),
                    ("plant_id", "{{node:code_precheck_line.data.plant_id}}", "field"),
                    ("organization_id", "{{node:code_precheck_line.data.organization_id}}", "field"),
                    ("location_id", "{{node:code_precheck_pick.data.location_id}}", "field"),
                    ("batch_id", "{{node:code_precheck_pick.data.batch_id}}", "field"),
                    ("orderUomId", "{{node:code_precheck_line.data.material_uom}}", "field"),
                    ("category", "{{node:code_precheck_pick.data.inventory_category}}", "field"),
                ]),
                if_expr("if_check_failed", "IF Check Failed",
                        "'{{node:wf_check_inventory.data.code}}' == '400'",
                        [ret("return_check_402", 402, "{{node:wf_check_inventory.data.message}}")]),
            ]),
        ]),
    ]),

    # ---------------- persistence + inventory movement
    if_rule("if_persist", "IF !Draft", "workflowparams.saveAs", "notEqual", "Draft", [
        code_node("code_batch_decide", "Batch Decision", BATCH_DECIDE,
                  "needsGen", "manualBatch", "isBatch", "item_id",
                  "document_date", "manufacturing_date", "expired_date"),

        if_expr("if_needs_batch_gen", "IF Needs Batch Generation",
                "{{node:code_batch_decide.data.needsGen}} == 1", [
            wf_node("wf_generate_batch", "Generate Batch", WF_BATCH[0], WF_BATCH[1], [
                ("item_id", "{{node:code_batch_decide.data.item_id}}", "field"),
                ("document_date", "{{node:code_batch_decide.data.document_date}}", "field"),
                ("manufacturing_date", "{{node:code_batch_decide.data.manufacturing_date}}", "field"),
                ("expired_date", "{{node:code_batch_decide.data.expired_date}}", "field"),
            ]),
            code_node("code_normalize_batch", "Normalize Batch Result", NORMALIZE_BATCH,
                      "batchNumber", "isError", "message"),
            if_expr("if_batch_failed", "IF Batch Error",
                    "{{node:code_normalize_batch.data.isError}} == 1",
                    [ret("return_batch_400", 400,
                         "{{node:code_normalize_batch.data.message}}")]),
        ]),

        code_node("code_batch_number", "Resolve Batch Number", BATCH_NUMBER, "batchNumber"),

        if_rule("if_edit", "IF Edit Mode", "workflowparams.pageStatus", "equal", "Edit",
                [update_node("update_ia", "Update Item Assembly"),
                 {"id": "get_ia", "type": "get-node",
                  "data": {"table_id": {"source": IA_TABLE,
                                        "rules": {"collectionId": IA_ID,
                                                  "list": single_leaf("id", "in",
                                                                      "{{node:code_fillback.data.allData.id}}")}},
                           "condition": {}, "title": "Get Saved Assembly", "isValidator": True,
                           "nodeName": "Get Saved Assembly", "name": "Get Saved Assembly"},
                  "blocks": []}],
                [add_node("add_ia", "Add Item Assembly")]),

        code_node("code_persisted", "Resolve Persisted Document", PERSISTED,
                  "docId", "stock_movement_no", "stock_movement"),

        loop("loop_issue_lines", "Loop Components (issue)",
             "{{node:code_fillback.data.allData.stock_movement}}", [
            code_node("code_issue_line", "Issue Line Prep", ISSUE_LINE,
                      "plant_id", "organization_id", "stock_movement_no", "doc_date",
                      "material_id", "material_uom", "remark", "remark2", "remark3",
                      "itemData", "balancesToProcess"),
            loop("loop_issue_picks", "Loop Picks (issue)",
                 "{{node:code_issue_line.data.balancesToProcess}}", [
                code_node("code_issue_pick", "Issue Pick Prep", ISSUE_PICK,
                          "location_id", "batch_id", "quantity", "inventory_category",
                          "manufacturing_date", "expired_date", "handling_unit_id"),
                wf_node("wf_subtract", "Subtract Inventory", WF_SUBTRACT[0], WF_SUBTRACT[1], [
                    ("plant_id", "{{node:code_issue_line.data.plant_id}}", "field"),
                    ("organization_id", "{{node:code_issue_line.data.organization_id}}", "field"),
                    ("material_id", "{{node:code_issue_line.data.material_id}}", "field"),
                    ("quantity", "{{node:code_issue_pick.data.quantity}}", "field"),
                    ("material_uom", "{{node:code_issue_line.data.material_uom}}", "field"),
                    ("transaction_type", "IA", "value"),
                    ("trx_no", "{{node:code_issue_line.data.stock_movement_no}}", "field"),
                    ("inventory_category", "{{node:code_issue_pick.data.inventory_category}}", "field"),
                    ("location_id", "{{node:code_issue_pick.data.location_id}}", "field"),
                    ("batch_id", "{{node:code_issue_pick.data.batch_id}}", "field"),
                    ("manufacturing_date", "{{node:code_issue_pick.data.manufacturing_date}}", "field"),
                    ("expired_date", "{{node:code_issue_pick.data.expired_date}}", "field"),
                    ("handling_unit_id", "{{node:code_issue_pick.data.handling_unit_id}}", "field"),
                    ("doc_date", "{{node:code_issue_line.data.doc_date}}", "field"),
                    ("itemData", "{{node:code_issue_line.data.itemData}}", "field"),
                ]),
                if_expr("if_subtract_failed", "IF Subtract Failed",
                        "'{{node:wf_subtract.data.code}}' == '400'",
                        [ret("return_subtract_400", 400,
                             "{{node:wf_subtract.data.errorMessage}}")]),
            ]),
        ]),

        # One read of what the issue leg actually wrote, in place of an
        # accumulator threaded through two loops.
        {"id": "search_movements", "type": "search-node",
         "data": {"table_id": {"source": MOVE_TABLE,
                               "rules": {"collectionId": MOVE_ID,
                                         "list": [{"id": fid(), "parentId": fid(), "isTop": True,
                                                   "prop": "", "operator": "all", "valueType": "",
                                                   "value": "", "type": "branch", "level": 1,
                                                   "children": [
                                                       {"id": fid(), "parentId": fid(), "isTop": False,
                                                        "prop": "trx_no", "operator": "equal",
                                                        "valueType": "field",
                                                        "value": "{{node:code_persisted.data.stock_movement_no}}",
                                                        "type": "leaf", "level": 2,
                                                        "propLabel": "trx_no", "valueLabel": "",
                                                        "operatorLabel": "equal"},
                                                       {"id": fid(), "parentId": fid(), "isTop": False,
                                                        "prop": "movement", "operator": "equal",
                                                        "valueType": "value", "value": "OUT",
                                                        "type": "leaf", "level": 2,
                                                        "propLabel": "movement", "valueLabel": "",
                                                        "operatorLabel": "equal"}]}]}},
                  "condition": {}, "limit": 1000, "title": "Get Component Movements",
                  "isValidator": True, "nodeName": "Get Component Movements",
                  "name": "Get Component Movements"},
         "blocks": []},

        code_node("code_receipt_prep", "Receipt Prep", RECEIPT_PREP,
                  "plant_id", "organization_id", "material_id", "material_uom",
                  "quantity", "unit_price", "location_id", "batch_number", "trx_no",
                  "doc_date", "manufacturing_date", "expired_date",
                  "remark", "remark2", "remark3", "itemData"),

        wf_node("wf_add", "Add Inventory", WF_ADD[0], WF_ADD[1], [
            ("plant_id", "{{node:code_receipt_prep.data.plant_id}}", "field"),
            ("organization_id", "{{node:code_receipt_prep.data.organization_id}}", "field"),
            ("material_id", "{{node:code_receipt_prep.data.material_id}}", "field"),
            ("quantity", "{{node:code_receipt_prep.data.quantity}}", "field"),
            ("material_uom", "{{node:code_receipt_prep.data.material_uom}}", "field"),
            ("transaction_type", "IA", "value"),
            ("trx_no", "{{node:code_receipt_prep.data.trx_no}}", "field"),
            ("inventory_category", "Unrestricted", "value"),
            ("location_id", "{{node:code_receipt_prep.data.location_id}}", "field"),
            ("batch_number", "{{node:code_receipt_prep.data.batch_number}}", "field"),
            ("unit_price", "{{node:code_receipt_prep.data.unit_price}}", "field"),
            ("doc_date", "{{node:code_receipt_prep.data.doc_date}}", "field"),
            ("manufacturing_date", "{{node:code_receipt_prep.data.manufacturing_date}}", "field"),
            ("expired_date", "{{node:code_receipt_prep.data.expired_date}}", "field"),
            ("remark", "{{node:code_receipt_prep.data.remark}}", "field"),
            ("remark2", "{{node:code_receipt_prep.data.remark2}}", "field"),
            ("remark3", "{{node:code_receipt_prep.data.remark3}}", "field"),
            ("itemData", "{{node:code_receipt_prep.data.itemData}}", "field"),
            ("isMovingInv", "0", "value"),
        ]),

        if_expr("if_add_failed", "IF Add Failed",
                "'{{node:wf_add.data.code}}' == '400'",
                [ret("return_add_400", 400, "{{node:wf_add.data.errorMessage}}")]),

        code_node("code_hu_unloads", "Aggregate HU Unloads", HU_UNLOADS,
                  "huUpdates", "huUpdatesLength"),

        loop("loop_hu", "Loop HU Unloads", "{{node:code_hu_unloads.data.huUpdates}}", [
            code_node("code_hu_pick", "Pick HU Unload", HU_PICK,
                      "handling_unit_id", "plant_id", "organization_id",
                      "location_id", "storage_location_id", "table_hu_items"),
            wf_node("wf_handling_unit", "Handling Unit Workflow", WF_HU[0], WF_HU[1], [
                ("handling_unit_id", "{{node:code_hu_pick.data.handling_unit_id}}", "field"),
                ("plant_id", "{{node:code_hu_pick.data.plant_id}}", "field"),
                ("organization_id", "{{node:code_hu_pick.data.organization_id}}", "field"),
                ("storage_location_id", "{{node:code_hu_pick.data.storage_location_id}}", "field"),
                ("location_id", "{{node:code_hu_pick.data.location_id}}", "field"),
                ("table_hu_items", "{{node:code_hu_pick.data.table_hu_items}}", "field"),
                ("process_type", "unload", "value"),
            ]),
        ]),

        code_node("code_item_txn", "updateItemTransactionDate", ITEM_TXN, "updates"),
        {"id": "update_item_txn", "type": "update-node",
         "data": {"table_id": {"source": ITEM_TABLE,
                               "rules": {"collectionId": ITEM_ID,
                                         "list": single_leaf("id", "in",
                                                             "{{node:code_item_txn.data.updates.id}}")}},
                  "fields": [], "condition": {}, "title": "Update Item Transaction",
                  "isValidator": True, "nodeName": "Update Item Transaction",
                  "name": "Update Item Transaction",
                  "props": props([("id", "{{node:code_item_txn.data.updates.id}}", "field"),
                                  ("last_transaction_date",
                                   "{{node:code_item_txn.data.updates.last_transaction_date}}",
                                   "field")])},
         "blocks": []},
    ], [
        # ---------------- Draft
        if_rule("if_edit_draft", "IF Edit Mode", "workflowparams.pageStatus", "equal", "Edit",
                [update_node("update_draft", "Update Draft", include_no=False,
                             include_posted=False, batch_from_node=False)],
                [add_node("add_draft", "Add Draft", include_posted=False,
                          batch_from_node=False)]),
    ]),

    code_node("code_doc_id", "Resolve Document ID", DOC_ID, "id"),

    ret("return_ok", 200, "Item Assembly saved.", msg_is_field=False,
        extra=[{"prop": "id", "propLabel": "id", "operator": "", "operatorLabel": "",
                "valueType": "field", "valueTypeLabel": "",
                "value": "{{node:code_doc_id.data.id}}", "valueLabel": ""}]),

    # Bare terminator, matching MSI/MSR/GR -- return_ok carries the response.
    {"id": "end", "type": "end-node",
     "data": {"isValidator": True, "title": "End Node"},
     "blocks": []},
]

doc = {
    "request_json": [
        {"key": "iawfalld", "name": "allData", "title": "allData", "description": "",
         "bsonType": "any", "isExpand": False, "children": []},
        {"key": "iawfsvas", "name": "saveAs", "title": "saveAs", "description": "",
         "bsonType": "string", "isExpand": False, "children": []},
        {"key": "iawfpgst", "name": "pageStatus", "title": "pageStatus", "description": "",
         "bsonType": "string", "isExpand": False, "children": []},
    ],
    "response_json": [
        {"key": "iawfrcod", "name": "code", "title": "", "description": "",
         "bsonType": "string", "isExpand": False, "children": []},
        {"key": "iawfrmsg", "name": "message", "title": "", "description": "",
         "bsonType": "string", "isExpand": False, "children": []},
        {"key": "iawfriid", "name": "id", "title": "", "description": "",
         "bsonType": "string", "isExpand": False, "children": []},
    ],
    "config": {},
    "nodes": nodes,
    "edges": [],
}

with open(OUT, "w") as fh:
    json.dump(doc, fh, indent=1, ensure_ascii=False)
    fh.write("\n")

count = 0
def cnt(o):
    global count
    if isinstance(o, dict):
        if o.get("id") and o.get("type"): count += 1
        for k, v in o.items():
            if k in ("nodes", "blocks"): cnt(v)
    elif isinstance(o, list):
        for v in o: cnt(v)
cnt(doc)
print("wrote %s  (%d nodes)" % (OUT, count))

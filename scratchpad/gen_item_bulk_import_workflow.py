#!/usr/bin/env python3
"""Emit Item/ItemBulkImportWorkflow.json (ITEM_BULK_IMPORT).

Bulk-creates Items from one Excel file uploaded on the Item list page. Excel
cells carry display NAMES, so every foreign key is resolved server-side in a
single fork-join, then each validated row is handed to ITEM_SAVE
(2098251509145264130) so the importer inherits its validation, its decimal
formatNumber allow-lists and its serial-number sentinel.

Regenerate with:

    python3 scratchpad/gen_item_bulk_import_workflow.py
"""
import json, os, string, random

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "Item", "ItemBulkImportWorkflow.json")

ITEM_TABLE = "Item:Table:1901546842240438273"
ITEM_ID = "1901546842240438273"
UOM_TABLE = "UOM:Table:1901805375573839874"
UOM_ID = "1901805375573839874"
MATCAT_TABLE = "Material Category:Table:1901981572257665025"
MATCAT_ID = "1901981572257665025"
GROUP_TABLE = "Item Group:Table:2069359258406567937"
GROUP_ID = "2069359258406567937"
DICT_TABLE = "系统字典(勿删):Table:1897577528487428098"
DICT_ID = "1897577528487428098"
COSTING_TABLE = "Costing Method:Table:1901980856973643777"
COSTING_ID = "1901980856973643777"
RULE_TABLE = "流水号规则表:Table:1994006139209117697"
RULE_ID = "1994006139209117697"
BATCHCFG_TABLE = "batch_number_config:Table:2058765580973846530"
BATCHCFG_ID = "2058765580973846530"

WF_ITEM_SAVE = "ITEM_SAVE:Workflow:2098251509145264130"
WF_ITEM_SAVE_ID = "2098251509145264130"

# Item Properties dictionary: children of this parent (Default / Product /
# Raw Material / Packaging Material / Work in Progress / Semi-Finished Goods /
# Auxiliary Material). The column stores the dict_key TEXT, not the id.
ITEM_PROPERTIES_PARENT = "1993566695331348481"

REDIS_PREFIX = "itemBulkImport_"

# ---------------------------------------------------------------- id helpers
_fid = [1800000000000]
def fid():
    _fid[0] += 1
    return _fid[0]

_rng = random.Random(20260917)
def key():
    return "".join(_rng.choice(string.ascii_lowercase + string.digits) for _ in range(8))

# ------------------------------------------------------------- node builders
def leaf_placeholder():
    a, b = fid(), fid()
    return {"id": a, "parentId": b, "isTop": True, "prop": "", "operator": "",
            "valueType": "", "value": "", "type": "leaf", "level": 1}

def start_node():
    return {"id": "start", "type": "start-node",
            "data": {"isValidator": True, "title": "Start Node",
                     "nodeName": "Start Node", "name": "Start Node"}, "blocks": []}

def code_node(nid, title, script, returns):
    return {
        "id": nid, "type": "code-node",
        "data": {
            "language": "javascript", "code": "", "timeout": 30000,
            "title": title, "isValidator": True, "nodeName": title, "name": title,
            "script": {"type": "javascript", "code": script},
            # response_json is an ALLOW-LIST: an undeclared key is dropped and the
            # node silently outputs {}.
            "response_json": [
                {"key": key(), "name": n, "title": "", "description": "",
                 "bsonType": t, "isExpand": False, "children": []}
                for n, t in returns
            ],
        },
        "blocks": [],
    }

def if_node(nid, title, expr, true_blocks, false_blocks=None):
    return {
        "id": nid, "type": "if",
        "data": {"title": title, "isValidator": True, "nodeName": title, "name": title,
                 "condition_type": "Expression",
                 "filter": {"list": [leaf_placeholder()]},
                 "expression": {"type": "javascript", "code": expr}},
        "blocks": [
            {"id": nid + "_t", "type": "ifBlock", "data": {"title": "true"}, "blocks": true_blocks},
            {"id": nid + "_f", "type": "ifBlock", "data": {"title": "false"}, "blocks": false_blocks or []},
        ],
    }

def end_error(nid, code, msg_expr):
    return {
        "id": nid, "type": "end-node",
        "data": {"title": "结束节点",
                 "outputs": {"type": "object", "properties": {"result": {"type": "string"}}},
                 "isValidator": True, "nodeName": "结束节点", "name": "结束节点",
                 "back_data_type": "Default", "code": code,
                 "msg": {"type": "javascript", "code": msg_expr}},
        "blocks": [],
    }

def _where(leaves):
    """One branch/all wrapper — multiple top-level leaves do NOT AND together."""
    if len(leaves) == 1:
        lid, pid = fid(), fid()
        l = dict(leaves[0]); l.update({"id": lid, "parentId": pid, "isTop": True,
                                       "type": "leaf", "level": 1})
        return [l]
    bid, bpid = fid(), fid()
    kids = []
    for lf in leaves:
        l = dict(lf); l.update({"id": fid(), "parentId": bid, "isTop": False,
                                "type": "leaf", "level": 2})
        kids.append(l)
    return [{"id": bid, "parentId": bpid, "isTop": True, "type": "branch",
             "operator": "all", "prop": "", "valueType": "", "value": "",
             "level": 1, "children": kids}]

def leaf(prop, operator, value, value_type="field", label=None):
    return {"prop": prop, "operator": operator, "valueType": value_type,
            "value": value, "propLabel": label or prop, "valueLabel": "",
            "operatorLabel": operator}

def search_node(nid, title, source, coll_id, leaves, limit=100):
    return {
        "id": nid, "type": "search-node",
        "data": {"table_id": {"source": source,
                              "rules": {"collectionId": coll_id, "list": _where(leaves)}},
                 "condition": {}, "limit": limit,
                 "title": title, "isValidator": True, "nodeName": title, "name": title},
        "blocks": [],
    }

def get_node(nid, title, source, coll_id, leaves):
    return {
        "id": nid, "type": "get-node",
        "data": {"table_id": {"source": source,
                              "rules": {"collectionId": coll_id, "list": _where(leaves)}},
                 "condition": {}, "title": title, "isValidator": True,
                 "nodeName": title, "name": title},
        "blocks": [],
    }

def workflow_node(nid, title, source, coll_id, body):
    return {
        "id": nid, "type": "workflow-node",
        "data": {"workflow_id": "", "workflow_name": "", "input_params": {},
                 "title": title, "isValidator": True, "nodeName": title, "name": title,
                 "workflow": {"source": source,
                              "rules": {"collectionId": coll_id, "list": [leaf_placeholder()]}},
                 "remote": True, "remoteType": "innerdatasource",
                 "body_params": {"list": [
                     {"prop": p, "propLabel": p, "operator": "", "operatorLabel": "",
                      "valueType": "field", "valueTypeLabel": "", "value": v, "valueLabel": ""}
                     for p, v in body]}},
        "blocks": [],
    }

def cond_all(nid, title, branches):
    """Fork-JOIN: branches run in parallel, the next sibling waits for all."""
    blocks = []
    for bid, btitle, bnodes in branches:
        blocks.append({
            "id": bid, "type": "condition-all-node-item",
            "data": {"title": btitle, "filter": {"list": [leaf_placeholder()]},
                     "expression": {"code": "true", "type": "javascript"},
                     "displayContent": "sdk.form.setCondition", "isValidator": True,
                     "nodeName": btitle, "name": btitle, "condition_type": "Expression"},
            "blocks": bnodes,
        })
    return {"id": nid, "type": "condition-all-node",
            "data": {"title": title, "filter": {"list": []}, "expression": {"code": ""},
                     "displayContent": "sdk.form.setCondition"},
            "blocks": blocks}

def loop_node(nid, title, var_expr, blocks):
    return {
        "id": nid, "type": "loop",
        "data": {"title": title, "isValidator": True, "nodeName": title, "name": title,
                 "loopType": "Var",
                 "loopSeletSource": {
                     "datasource": {"rules": {"collectionId": "", "list": [leaf_placeholder()]}},
                     "auto_refresh": 1, "auto_refresh_debounce": 100, "options": [],
                     "props": {"value": "", "label": "", "image": "", "icon": "", "explain": ""},
                     "remote": False, "remoteType": "datasource"},
                 "loopSeletVar": {"type": "markdown", "code": var_expr}},
        "blocks": blocks,
    }

def get_cache(nid, title, redis_key):
    return {"id": nid, "type": "get-cache-node",
            "data": {"cache_key": "", "title": title, "isValidator": True,
                     "nodeName": title, "name": title, "redis_key": redis_key},
            "blocks": []}

def set_cache(nid, title, redis_key, value_expr):
    # `custom_wkbocgni` is the platform's value slot on this node type; copied
    # verbatim from SOconvertGDCreatedWorkflow, which is deployed and working.
    return {"id": nid, "type": "set-cache-node",
            "data": {"cache_key": "", "cache_value": "", "expire_time": 3600,
                     "title": title, "isValidator": True, "nodeName": title, "name": title,
                     "custom_wkbocgni": {"type": "javascript", "code": value_expr},
                     "redis_key": redis_key},
            "blocks": []}

def return_node(nid, title, props, status_code=200):
    return {"id": nid, "type": "return-node",
            "data": {"return_data": {}, "status_code": status_code, "title": title,
                     "isValidator": True, "nodeName": title, "name": title,
                     "response_value": {"list": [
                         {"prop": p, "propLabel": p, "operator": "", "operatorLabel": "",
                          "valueType": "field", "valueTypeLabel": "", "value": v,
                          "valueLabel": ""} for p, v in props]}},
            "blocks": []}

# --------------------------------------------------------------- node scripts
SCRIPT_PARSE = """const raw = {{workflowparams:import_file}};

// Keeps one file well inside the search-node limits below, and gives a clean
// error instead of a silent "name not found" from a truncated lookup.
const MAX_ROWS = 500;

const str = (v) => (v === undefined || v === null ? '' : String(v).trim());

// Same normalised header lookup as ItemCustBindImport.js: "Item Code",
// "item_code" and "ITEMCODE" all collapse to the same key. (GR's importers match
// byte-for-byte and silently blank out on a case mismatch.)
const normKey = (k) =>
  String(k || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const HEADERS = {
  code: ['itemcode'],
  name: ['itemname'],
  desc: ['description', 'itemdescription', 'desc'],
  category: ['itemcategory', 'materialcategory', 'category'],
  uom: ['baseuom', 'basedoum', 'uom'],
  properties: ['itemproperties', 'itemproperty', 'properties'],
  type: ['itemtype', 'type'],
  stock: ['stockcontrol'],
  active: ['active', 'isactive'],
  barcode: ['barcode', 'barcodenumber'],
  group: ['itemgroup', 'group'],
  batch: ['batchmanagement', 'batch'],
  batchRule: ['batchnumbergeneration', 'batchnumbergenerationrule', 'batchgeneration']
};

const pick = (normRow, names) => {
  for (const n of names) {
    if (normRow[n] !== undefined) {
      const v = str(normRow[n]);
      if (v) return v;
    }
  }
  return '';
};

let excelData = raw;
if (typeof excelData === 'string') {
  try {
    excelData = JSON.parse(excelData);
  } catch (e) {
    excelData = null;
  }
}

// The parser emits an object keyed "0","1","2"... alongside name/size/type meta
// keys; a plain array is accepted too. Line 1 is consumed as the header row, so
// data index 0 is spreadsheet line 2.
let rawRows = [];
if (Array.isArray(excelData)) {
  rawRows = excelData.map((data, i) => ({ seq: i + 2, data: data || {} }));
} else if (excelData && typeof excelData === 'object') {
  rawRows = Object.keys(excelData)
    .filter((k) => /^\\d+$/.test(k))
    .map((k) => parseInt(k, 10))
    .sort((a, b) => a - b)
    .map((k) => ({ seq: k + 2, data: excelData[k] || {} }));
}

const rows = [];
for (const r of rawRows) {
  const normRow = {};
  Object.keys(r.data).forEach((k) => {
    normRow[normKey(k)] = r.data[k];
  });

  const row = {
    seq: r.seq,
    itemCode: pick(normRow, HEADERS.code),
    itemName: pick(normRow, HEADERS.name),
    itemDesc: pick(normRow, HEADERS.desc),
    categoryName: pick(normRow, HEADERS.category),
    uomName: pick(normRow, HEADERS.uom),
    properties: pick(normRow, HEADERS.properties),
    itemType: pick(normRow, HEADERS.type),
    stockControl: pick(normRow, HEADERS.stock),
    active: pick(normRow, HEADERS.active),
    barcode: pick(normRow, HEADERS.barcode),
    groupName: pick(normRow, HEADERS.group),
    batch: pick(normRow, HEADERS.batch),
    batchRule: pick(normRow, HEADERS.batchRule)
  };

  // Trailing/blank spreadsheet rows are ignored, not reported.
  const filled = Object.keys(row).some((k) => k !== 'seq' && row[k] !== '');
  if (filled) rows.push(row);
}

// An empty array in an `equalAny` filter is unsafe; "0" matches nothing.
const blocked = (message) => ({
  rows: [],
  itemCodes: ['0'],
  uomNames: ['0'],
  categoryNames: ['0'],
  groupNames: ['0'],
  hasRows: 'N',
  message: message
});

if (rows.length === 0) {
  return blocked('No data found in the imported file.');
}

if (rows.length > MAX_ROWS) {
  return blocked(
    'The file has ' + rows.length + ' rows. Import at most ' + MAX_ROWS +
      ' items per file.'
  );
}

const distinct = (list) => {
  const out = [];
  list.forEach((v) => {
    if (v && out.indexOf(v) === -1) out.push(v);
  });
  return out.length > 0 ? out : ['0'];
};

return {
  rows: rows,
  itemCodes: distinct(rows.map((r) => r.itemCode)),
  uomNames: distinct(rows.map((r) => r.uomName)),
  categoryNames: distinct(rows.map((r) => r.categoryName)),
  groupNames: distinct(rows.map((r) => r.groupName)),
  hasRows: 'Y',
  message: ''
};"""

SCRIPT_BUILD = """const rows = {{node:code_parse.data.rows}} || [];
const organizationId = {{workflowparams:organization_id}};

const uomData = {{node:search_uom.data.data}} || [];
const categoryData = {{node:search_category.data.data}} || [];
const groupData = {{node:search_group.data.data}} || [];
const propsData = {{node:search_props.data.data}} || [];
const costingData = {{node:search_costing.data.data}} || [];
const existingData = {{node:search_existing.data.data}} || [];
const batchCfgData = {{node:search_batch_config.data.data}} || [];
const ruleRaw = {{node:get_code_rule.data.data}};

// ITEM_SAVE's own batch check reads rows[0] of exactly this query, so mirror
// that rather than scanning for an Item Level row anywhere in the org.
const orgBatchCfg = batchCfgData.length > 0 ? batchCfgData[0] : null;
const batchIsItemLevel =
  !!orgBatchCfg && orgBatchCfg.batch_level_selection === 'Item Level';

// A get-node's record is a single OBJECT when count === 1, an array otherwise.
const ruleRows = !ruleRaw ? [] : Array.isArray(ruleRaw) ? ruleRaw : [ruleRaw];
const codeRuleId = ruleRows.length > 0 ? ruleRows[0].id : '';

const str = (v) => (v === undefined || v === null ? '' : String(v).trim());
const lc = (v) => str(v).toLowerCase();

const escapeHtml = (s) =>
  str(s).replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      })[c]
  );

// The platform's equalAny matching is case-insensitive, so key the maps the same way.
const indexBy = (list, field) => {
  const map = {};
  list.forEach((r) => {
    const k = lc(r[field]);
    if (k) (map[k] = map[k] || []).push(r);
  });
  return map;
};

const uomByName = indexBy(uomData, 'uom_name');
const catByName = indexBy(categoryData, 'mat_cat_name');
const groupByName = indexBy(groupData, 'group_code');

const costingById = {};
costingData.forEach((c) => {
  costingById[String(c.id)] = str(c.method_name);
});

const existingCodes = {};
existingData.forEach((i) => {
  const k = lc(i.material_code);
  if (k) existingCodes[k] = true;
});

const allowedProps = [];
propsData.forEach((p) => {
  const v = str(p.dict_key);
  if (v && allowedProps.indexOf(v) === -1) allowedProps.push(v);
});

// Mirrors the form's onItemPropertiesChange handler.
const SCOPE_BY_PROPERTY = {
  'Packaging Material': ['2', '1'],
  'Work in Progress': ['3'],
  'Raw Material': ['2', '3'],
  'Semi-Finished Goods': ['1', '3'],
  Product: ['1'],
  Default: ['1', '2', '3'],
  'Auxiliary Material': ['2', '3']
};

const YES = ['1', 'y', 'yes', 'true', 't'];
const NO = ['0', 'n', 'no', 'false', 'f'];
// Returns -1 for an unparseable cell so the caller can report it.
const parseBool = (v, dflt) => {
  const s = lc(v);
  if (s === '') return dflt;
  if (YES.indexOf(s) !== -1) return 1;
  if (NO.indexOf(s) !== -1) return 0;
  return -1;
};

const resolveOne = (map, name) => {
  const hits = map[lc(name)] || [];
  return { count: hits.length, row: hits.length === 1 ? hits[0] : null };
};

const errors = [];
const payloads = [];
const seenCodes = {};

rows.forEach((row) => {
  const label = 'Row ' + row.seq;
  const rowErrors = [];

  if (!row.itemName) rowErrors.push(label + ': Item Name is required.');

  // --- Item Category -> id, and the Costing Method it carries ---------------
  let categoryId = '';
  let costingMethod = '';
  if (!row.categoryName) {
    rowErrors.push(label + ': Item Category is required.');
  } else {
    const hit = resolveOne(catByName, row.categoryName);
    if (hit.count === 0) {
      rowErrors.push(
        label + ': Item Category "' + row.categoryName + '" not found.'
      );
    } else if (hit.count > 1) {
      rowErrors.push(
        label + ': Item Category "' + row.categoryName + '" matches ' +
          hit.count + ' categories.'
      );
    } else {
      categoryId = hit.row.id;
      // Costing Method is not an Excel column: the form derives it from the
      // category (onChange_item_category) and keeps the field read-only.
      costingMethod = costingById[String(hit.row.mat_costing_method)] || '';
      if (!costingMethod) {
        rowErrors.push(
          label + ': Item Category "' + row.categoryName +
            '" has no Costing Method configured.'
        );
      }
    }
  }

  // --- Base UOM -> id --------------------------------------------------------
  let basedUom = '';
  if (!row.uomName) {
    rowErrors.push(label + ': Base UOM is required.');
  } else {
    const hit = resolveOne(uomByName, row.uomName);
    if (hit.count === 0) {
      rowErrors.push(label + ': Base UOM "' + row.uomName + '" not found.');
    } else if (hit.count > 1) {
      rowErrors.push(
        label + ': Base UOM "' + row.uomName + '" matches ' + hit.count + ' UOMs.'
      );
    } else {
      basedUom = hit.row.id;
    }
  }

  // --- Item Group -> id (optional) ------------------------------------------
  let groupId = '';
  if (row.groupName) {
    const hit = resolveOne(groupByName, row.groupName);
    if (hit.count === 0) {
      rowErrors.push(label + ': Item Group "' + row.groupName + '" not found.');
    } else if (hit.count > 1) {
      rowErrors.push(
        label + ': Item Group "' + row.groupName + '" matches ' + hit.count +
          ' groups.'
      );
    } else {
      groupId = hit.row.id;
    }
  }

  // --- Item Properties (blank -> "Default") ---------------------------------
  let properties = 'Default';
  if (row.properties) {
    const match = allowedProps.filter((p) => lc(p) === lc(row.properties));
    if (match.length === 0) {
      rowErrors.push(
        label + ': Item Properties "' + row.properties +
          '" is not valid. Allowed: ' + allowedProps.join(', ') + '.'
      );
    } else {
      properties = match[0];
    }
  }
  const businessScope = SCOPE_BY_PROPERTY[properties] || [];

  // --- Item Type -------------------------------------------------------------
  let materialType = 'Goods';
  if (row.itemType) {
    const t = lc(row.itemType);
    if (t === 'goods') materialType = 'Goods';
    else if (t === 'services' || t === 'service') materialType = 'Services';
    else rowErrors.push(label + ': Item Type must be Goods or Services.');
  }

  // --- switches --------------------------------------------------------------
  const stockControl = parseBool(row.stockControl, 1);
  if (stockControl === -1) {
    rowErrors.push(label + ': Stock Control must be Yes or No.');
  }
  const isActive = parseBool(row.active, 1);
  if (isActive === -1) {
    rowErrors.push(label + ': Active must be Yes or No.');
  }

  // --- Batch Management ------------------------------------------------------
  const batchFlag = parseBool(row.batch, 0);
  if (batchFlag === -1) {
    rowErrors.push(label + ': Batch Management must be Yes or No.');
  }

  // The form only offers these two, and the second one skips the config check
  // entirely (ITEM_SAVE's needsBatchCheck).
  const BATCH_RULES = ['According To System Settings', 'Manual Input'];
  let batchRule = '';
  if (batchFlag === 1) {
    batchRule = BATCH_RULES[0];
    if (row.batchRule) {
      const hit = BATCH_RULES.filter((r) => lc(r) === lc(row.batchRule));
      if (hit.length === 0) {
        rowErrors.push(
          label + ': Batch Number Generation must be ' + BATCH_RULES.join(' or ') + '.'
        );
      } else {
        batchRule = hit[0];
      }
    }
    // A brand-new item has no id yet, so ITEM_SAVE's item-level config lookup
    // can never find a row and it would 403 mid-import. Block it here instead,
    // while nothing has been created.
    if (batchIsItemLevel && batchRule === BATCH_RULES[0]) {
      rowErrors.push(
        label +
          ': this organization sets batch numbers at Item Level, which needs a ' +
          'per-item batch configuration that cannot come from Excel. Use ' +
          '"Manual Input", or create this item in the form.'
      );
    }
  } else if (row.batchRule) {
    rowErrors.push(
      label + ': Batch Number Generation was filled but Batch Management is off.'
    );
  }

  // --- Item Code: filled = manual rule, blank = the serial rule assigns ------
  let materialCode = row.itemCode;
  let materialCodeType = codeRuleId;
  if (materialCode) {
    materialCodeType = -9999;
    const dupKey = lc(materialCode);
    if (seenCodes[dupKey]) {
      rowErrors.push(
        label + ': Item Code "' + materialCode + '" is also used on ' +
          seenCodes[dupKey] + ' of this file.'
      );
    } else {
      seenCodes[dupKey] = label;
    }
    if (existingCodes[dupKey]) {
      rowErrors.push(
        label + ': Item Code "' + materialCode + '" already exists.'
      );
    }
  } else if (!codeRuleId) {
    rowErrors.push(
      label +
        ': Item Code is required — no default numbering rule is configured for Items.'
    );
  }

  if (rowErrors.length > 0) {
    rowErrors.forEach((e) => errors.push(e));
    return;
  }

  payloads.push({
    seq: row.seq,
    itemName: row.itemName,
    allData: {
      page_status: 'Add',
      is_post: 0,
      organization_id: organizationId,
      material_code: materialCode,
      material_code_type: materialCodeType,
      material_name: row.itemName,
      material_desc: row.itemDesc,
      material_type: materialType,
      item_category: categoryId,
      item_group_id: groupId,
      material_costing_method: costingMethod,
      based_uom: basedUom,
      item_properties: properties,
      business_scope: businessScope,
      barcode_number: row.barcode,
      is_active: isActive,
      stock_control: stockControl,
      // The form forces both to 0 while Stock Control is on. With it off they
      // go to 1: stock_control === 0 && show_delivery === 0 is the
      // description-only marker, which no imported item should silently become.
      show_delivery: stockControl === 1 ? 0 : 1,
      show_receiving: stockControl === 1 ? 0 : 1,
      item_batch_management: batchFlag,
      batch_number_genaration: batchRule,
      // Deliberately no batch_config: ITEM_SAVE's post-save UPDATE_BATCH_CONFIG
      // only runs when this object is non-empty.
      serial_number_management: 0,
      auto_bom: 0,
      // ITEM_SAVE demands exactly one default purchase UOM and exactly one
      // default sales UOM, so generate the base row instead of asking a
      // spreadsheet to model conversions.
      table_uom_conversion: [
        {
          alt_uom_id: basedUom,
          base_uom_id: basedUom,
          alt_qty: 1,
          base_qty: 1,
          purchase_default_uom: 1,
          sales_default_uom: 1
        }
      ],
      table_packing_detail: [],
      table_supplier_price: [],
      table_customer_price: [],
      table_sup_item_access: [],
      table_cust_item_access: [],
      table_sup_item_bind: [],
      table_cust_item_bind: [],
      table_reorder_supplier: [],
      table_default_bin: []
    }
  });
});

// All-or-nothing: one bad row blocks the file so the user fixes it and re-uploads,
// rather than half a spreadsheet landing in the Item master.
const MAX_LISTED = 15;
if (errors.length > 0) {
  const shown = errors.slice(0, MAX_LISTED).map((m) => '• ' + escapeHtml(m));
  if (errors.length > MAX_LISTED) {
    shown.push('… and ' + (errors.length - MAX_LISTED) + ' more.');
  }
  return {
    status: 'Failed',
    message:
      'The file was not imported. Fix the following and upload again:<br><br>' +
      shown.join('<br>'),
    payloads: [],
    count: 0
  };
}

return { status: 'Passed', message: '', payloads: payloads, count: payloads.length };"""

SCRIPT_COSTING_IDS = """const categories = {{node:search_category.data.data}} || [];

// costing_method is seeded per tenant (1300+ rows), so it cannot be fetched whole
// under a search-node limit -- the limit is a ceiling, not a guard, and the rows
// past it come back as "no Costing Method configured". Fetch exactly the ids the
// matched categories point at instead.
const ids = [];
categories.forEach((c) => {
  const id = c.mat_costing_method;
  if (id !== null && id !== undefined && id !== '') {
    const s = String(id);
    if (ids.indexOf(s) === -1) ids.push(s);
  }
});

// An empty array in an `equalAny` filter is unsafe; "0" matches nothing.
return { costingIds: ids.length > 0 ? ids : ['0'] };"""

SCRIPT_UNIQUE = """// Per-run redis namespace, so concurrent imports never share an accumulator.
const org = {{workflowparams:organization_id}} || '';

return { unique: org + '_' + Date.now() };"""

SCRIPT_COLLECT = """const raw = {{node:get_results.data}};

let results = [];
if (raw) {
  results = typeof raw === 'string' ? JSON.parse(raw) : raw;
}
if (!Array.isArray(results)) results = [];

// ITEM_SAVE reports failure through error end-nodes (400/401/402/403/404), not
// output params, so a failing row aborts this workflow instead of arriving here.
// code_build pre-validates every one of those conditions -- organization, the
// required fields, the UOM conversion shape, the price tables and batch config --
// so those paths stay unreachable by construction.
const savedId = {{node:wf_item_save.data.id}};
const savedCode = {{node:wf_item_save.data.material_code}};

results.push({
  seq: {{node:loop_payloads.seq}},
  item_name: {{node:loop_payloads.itemName}} || '',
  item_id: savedId ? String(savedId) : '',
  material_code: savedCode || ''
});

return { results: results };"""

SCRIPT_SUMMARY = """const raw = {{node:get_results_final.data}};

let results = [];
if (raw) {
  results = typeof raw === 'string' ? JSON.parse(raw) : raw;
}
if (!Array.isArray(results)) results = [];

const expected = {{node:code_build.data.count}} || 0;
const created = results.filter((r) => r.item_id);

const codes = created.map((r) => r.material_code).filter((c) => c);
const distinctCodes = [];
codes.forEach((c) => {
  if (distinctCodes.indexOf(c) === -1) distinctCodes.push(c);
});
// Two rows sharing a code means the serial sentinel handed out the same number
// twice. Say so rather than letting it read as a clean import.
const duplicateCodes = codes.length !== distinctCodes.length;

if (created.length < expected || duplicateCodes) {
  return {
    code: '402',
    message:
      'Imported ' + created.length + ' of ' + expected + ' item(s).' +
      (duplicateCodes
        ? ' Some items were given the same Item Code — check the numbering rule for Items.'
        : '') +
      ' Review the Item list before re-uploading the rest of the file.',
    created: created,
    createdCount: created.length
  };
}

return {
  code: '200',
  message:
    'Imported ' + created.length + ' item' + (created.length === 1 ? '' : 's') + '.',
  created: created,
  createdCount: created.length
};"""

# ------------------------------------------------------------------- assembly
REDIS_KEY = REDIS_PREFIX + "{{node:code_unique.data.unique}}"

nodes = [
    start_node(),

    code_node("code_parse", "1. Parse Excel Rows", SCRIPT_PARSE,
              [("rows", "any"), ("itemCodes", "any"), ("uomNames", "any"),
               ("categoryNames", "any"), ("groupNames", "any"),
               ("hasRows", "string"), ("message", "string")]),

    if_node("if_no_rows", "Nothing To Import?",
            "'{{node:code_parse.data.hasRows}}' == 'N'",
            [end_error("end_no_rows_401", 401, "{{node:code_parse.data.message}}")]),

    # Every lookup here depends only on code_parse or the workflow params, never
    # on another lookup -- so they all belong in one fork-join. The only lookup
    # that cannot join them is costing_method, which is keyed off the categories
    # this block returns.
    cond_all("par_lookups", "Parallel Lookups", [
        ("cai_uom", "UOM", [
            search_node("search_uom", "Get UOMs", UOM_TABLE, UOM_ID, [
                leaf("uom_name", "equalAny", "{{node:code_parse.data.uomNames}}"),
                leaf("organization_id", "equal", "{{workflowparams:organization_id}}"),
            ], limit=200)]),
        ("cai_category", "Item Category", [
            search_node("search_category", "Get Item Categories", MATCAT_TABLE, MATCAT_ID, [
                leaf("mat_cat_name", "equalAny", "{{node:code_parse.data.categoryNames}}"),
                leaf("organization_id", "equal", "{{workflowparams:organization_id}}"),
            ], limit=200)]),
        ("cai_group", "Item Group", [
            search_node("search_group", "Get Item Groups", GROUP_TABLE, GROUP_ID, [
                leaf("group_code", "equalAny", "{{node:code_parse.data.groupNames}}"),
                leaf("organization_id", "equal", "{{global:firstLvDeptId}}"),
            ], limit=200)]),
        ("cai_props", "Item Properties", [
            search_node("search_props", "Get Item Properties", DICT_TABLE, DICT_ID, [
                leaf("parent_id", "numberEqual", ITEM_PROPERTIES_PARENT, "value"),
            ], limit=100)]),
        ("cai_existing", "Existing Item Codes", [
            # The dup check must cover every code in the file, so this limit
            # tracks MAX_ROWS in code_parse.
            search_node("search_existing", "Get Existing Items", ITEM_TABLE, ITEM_ID, [
                leaf("material_code", "equalAny", "{{node:code_parse.data.itemCodes}}"),
                leaf("organization_id", "equal", "{{workflowparams:organization_id}}"),
            ], limit=1000)]),
        ("cai_batchcfg", "Batch Number Config", [
            search_node("search_batch_config", "Get Batch Number Config",
                        BATCHCFG_TABLE, BATCHCFG_ID, [
                leaf("organization_id", "equal", "{{workflowparams:organization_id}}"),
            ], limit=100)]),
        ("cai_rule", "Item Number Rule", [
            # 流水号规则表 is org-shared: without department_id this returns one
            # row per tenant and the add-node throws 所选流水号规则不属于当前部门.
            get_node("get_code_rule", "Get Item Number Rule", RULE_TABLE, RULE_ID, [
                leaf("department_id", "numberEqual", "{{global:firstLvDeptId}}"),
                leaf("business_type", "equal", "Items", "value"),
                leaf("is_draft", "numberEqual", 0, "value"),
                leaf("is_default", "numberEqual", 1, "value"),
            ])]),
    ]),

    code_node("code_costing_ids", "2. Costing Method Ids", SCRIPT_COSTING_IDS,
              [("costingIds", "any")]),

    search_node("search_costing", "Get Costing Methods", COSTING_TABLE, COSTING_ID, [
        leaf("id", "equalAny", "{{node:code_costing_ids.data.costingIds}}"),
    ], limit=200),

    code_node("code_build", "3. Validate & Build Payloads", SCRIPT_BUILD,
              [("status", "string"), ("message", "string"),
               ("payloads", "any"), ("count", "any")]),

    if_node("if_build_failed", "Validation Failed?",
            "'{{node:code_build.data.status}}' == 'Failed'",
            [end_error("end_build_401", 401, "{{node:code_build.data.message}}")]),

    code_node("code_unique", "Unique Index", SCRIPT_UNIQUE, [("unique", "string")]),

    set_cache("set_results_init", "Set importResults", REDIS_KEY, "[]"),

    # Loop iterations cannot accumulate in JS, so results go through redis --
    # the same shape SOconvertGDCreatedWorkflow uses.
    loop_node("loop_payloads", "Loop Item Payloads",
              "{{node:code_build.data.payloads}}", [
        get_cache("get_results", "Get importResults", REDIS_KEY),
        workflow_node("wf_item_save", "Save Item", WF_ITEM_SAVE, WF_ITEM_SAVE_ID,
                      [("allData", "{{node:loop_payloads.allData}}")]),
        code_node("code_collect", "Collect Item Result", SCRIPT_COLLECT,
                  [("results", "any")]),
        set_cache("set_results", "Set importResults", REDIS_KEY,
                  "{{node:code_collect.data.results}}"),
    ]),

    get_cache("get_results_final", "Get Final importResults", REDIS_KEY),

    code_node("code_summary", "4. Build Summary", SCRIPT_SUMMARY,
              [("code", "string"), ("message", "string"),
               ("created", "any"), ("createdCount", "any")]),

    return_node("ret_summary", "Return Summary", [
        ("code", "{{node:code_summary.data.code}}"),
        ("message", "{{node:code_summary.data.message}}"),
        ("created", "{{node:code_summary.data.created}}"),
        ("createdCount", "{{node:code_summary.data.createdCount}}"),
    ]),

    {"id": "end", "type": "end-node",
     "data": {"isValidator": True, "title": "End Node",
              "nodeName": "End Node", "name": "End Node"},
     "blocks": []},
]

workflow = {
    "request_json": [
        {"key": key(), "name": "import_file", "title": "Import File",
         "description": "Parsed Excel JSON from su-fm-excel-parse",
         "bsonType": "any", "isExpand": False, "children": []},
        {"key": key(), "name": "organization_id", "title": "Organization",
         "description": "", "bsonType": "string", "isExpand": False, "children": []},
    ],
    "response_json": [
        {"key": key(), "name": n, "title": "", "description": "",
         "bsonType": t, "isExpand": False, "children": []}
        for n, t in (("code", "string"), ("message", "string"),
                     ("created", "any"), ("createdCount", "any"))],
    "config": {},
    "nodes": nodes,
    "edges": [],
}

with open(OUT, "w") as fh:
    json.dump(workflow, fh, ensure_ascii=False, indent=1)
    fh.write("\n")

# round-trip guard
with open(OUT) as fh:
    assert json.load(fh) == workflow
print("wrote %s (%d top-level nodes)" % (OUT, len(nodes)))

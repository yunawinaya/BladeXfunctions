#!/usr/bin/env python3
"""Emit Item/ItemSaveWorkflow.json (ITEM_SAVE).

Port of Item/ItemSave.js + Item/ItemSavePost.js. One workflow serves both save
buttons; `allData.is_post` picks the Save & Post behaviour. Regenerate with:

    python3 scratchpad/gen_item_save_workflow.py
"""
import json, os, string, random

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "Item", "ItemSaveWorkflow.json")

ITEM_TABLE = "Item:Table:1901546842240438273"
ITEM_ID = "1901546842240438273"
BOM_TABLE = "bom_tree:Table:2005460588197191682"
BOM_ID = "2005460588197191682"
BATCHCFG_TABLE = "batch_number_config:Table:2058765580973846530"
BATCHCFG_ID = "2058765580973846530"
ACC_TABLE = "accounting_integration:Table:1930794597760651266"
ACC_ID = "1930794597760651266"

WF_CHECK_REQUIRED = "CHECK_REQUIRED_FIELD:Workflow:1988831880511062018"
WF_BATCH_CONFIG = "UPDATE_BATCH_CONFIG:Workflow:2058838457211068417"
WF_AI_UPSERT = "Upsert-Items:Workflow:2080219250438160386"

# ---------------------------------------------------------------- id helpers
_fid = [1700000000000]
def fid():
    _fid[0] += 1
    return _fid[0]

_rng = random.Random(20260911)
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

def prop(name, value, value_type="field"):
    return {"prop": name, "valueType": value_type, "value": value,
            "operator": "", "valueLabel": "", "propLabel": name}

def add_node(nid, title, source, coll_id, props):
    return {
        "id": nid, "type": "add-node",
        "data": {"table_id": {"source": source,
                              "rules": {"collectionId": coll_id, "list": [leaf_placeholder()]}},
                 "fields": [], "title": title, "isValidator": True,
                 "nodeName": title, "name": title,
                 "props": {"modelName": "", "list": props}},
        "blocks": [],
    }

def update_node(nid, title, source, coll_id, where_leaves, props):
    return {
        "id": nid, "type": "update-node",
        "data": {"table_id": {"source": source,
                              "rules": {"collectionId": coll_id, "list": _where(where_leaves)}},
                 "fields": [], "condition": {}, "title": title, "isValidator": True,
                 "nodeName": title, "name": title,
                 "props": {"modelName": "", "list": props}},
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
    for i, (bid, btitle, bnodes) in enumerate(branches, 1):
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

# ------------------------------------------------------------ column sources
S = os.path.join(os.path.dirname(os.path.abspath(__file__)))
ITEM_COLUMNS = json.load(open(os.path.join(S, "item_save_columns.json")))["columns"]

# decimal(65,N) columns -> N. This map is an ALLOW-LIST: a decimal column missing
# from it reaches the DB as a raw float and the multipleOf check rejects the save.
DEC_HEADER = {
    "purchase_unit_price": 4, "purchase_min_price": 4, "purchase_max_price": 4,
    "sales_unit_price": 4, "sales_min_price": 4, "sales_max_price": 4,
    "min_purchase_qty": 3, "min_sales_qty": 3, "gross_weight": 3, "net_weight": 3,
    "over_receive_tolerance": 2, "under_receive_tolerance": 2,
    "over_delivery_tolerance": 2, "under_delivery_tolerance": 2, "assembly_cost": 2,
}
DEC_UOM = {
    "alt_qty": 6, "base_qty": 6,
    "purchase_unit_price": 4, "purchase_min_price": 4, "purchase_max_price": 4,
    "sales_unit_price": 4, "sales_min_price": 4, "sales_max_price": 4,
    "sales_price_1": 4, "sales_price_2": 4, "sales_price_3": 4,
    "sales_price_4": 4, "sales_price_5": 4, "sales_price_6": 4,
    "min_purchase_qty": 3, "max_purchase_qty": 3, "min_sales_qty": 3, "max_sales_qty": 3,
    "over_receive_tolerance": 2, "over_delivery_tolerance": 2,
}
DEC_PACK = {"packing_qty": 6, "quantity": 6}
DEC_SUP = {"sup_price_unit_price": 4, "sup_price_min_price": 4, "sup_price_max_price": 4,
           "sup_min_order_qty": 3, "sup_max_order_qty": 3, "sup_price_discount": 3}
DEC_CUST = {"cust_price_unit_price": 4, "cust_price_min_price": 4, "cust_price_max_price": 4,
            "cust_min_order_qty": 3, "cust_max_order_qty": 3, "cust_price_discount": 3}
DEC_REORDER = {"moq_qty": 3}

def js_map(d):
    return "{ " + ", ".join("%s: %d" % (k, v) for k, v in d.items()) + " }"

# --------------------------------------------------------------- node scripts
SCRIPT_DETERMINE = """const entry = {{workflowparams:allData}};

const isEdit = entry.page_status === 'Edit';

// Platform serial-number sentinel: a rule other than -9999 ("Manual Input") plus
// a fresh record means the backend assigns material_code on insert.
entry.material_code =
  entry.material_code_type === -9999 || isEdit ? entry.material_code : 'issued';
entry.batch_number_genaration =
  entry.batch_number_genaration || 'According To System Settings';

const needsBatchCheck =
  entry.item_batch_management === 1 &&
  entry.batch_number_genaration === 'According To System Settings';

return {
  entry,
  isEdit: isEdit ? 'Y' : 'N',
  isPost: entry.is_post === 1 || entry.is_post === '1' || entry.is_post === true ? 'Y' : 'N',
  needsBatchCheck: needsBatchCheck ? 'Y' : 'N',
  hasOrg: entry.organization_id && entry.organization_id !== '' ? 'Y' : 'N'
};"""

SCRIPT_REQUIRED = """const entry = {{node:code_determine.data.entry}};

const requiredFields = [{ name: 'material_name', label: 'Item Name' }];
if (entry.material_code_type === -9999) {
  requiredFields.push({ name: 'material_code', label: 'Item Code' });
}
requiredFields.push(
  { name: 'item_category', label: 'Item Category' },
  { name: 'based_uom', label: 'Based UOM' },
  { name: 'item_properties', label: 'Item Properties' }
);

return {
  required_fields: JSON.stringify(requiredFields),
  data: JSON.stringify({
    material_name: entry.material_name,
    material_code: entry.material_code,
    item_category: entry.item_category,
    based_uom: entry.based_uom,
    item_properties: entry.item_properties
  })
};"""

SCRIPT_VALIDATE_UOM = """const entry = {{node:code_determine.data.entry}};

const latestConversion = (entry.table_uom_conversion || []).filter(
  (item) => item.alt_uom_id && item.alt_uom_id !== ''
);

if (latestConversion.filter((item) => item.base_qty === 0).length > 0) {
  return {
    entry,
    status: 'Failed',
    message: 'Invalid Base Qty. Base Qty must be not equal to 0.'
  };
}

// Every document that adds this item takes the line's UOM from the row carrying
// the tick, and that `find` stops at the first match -- so a table with no tick
// puts the line in with no UOM, and two ticks let row order decide.
const defaultUOMErrors = [];
[
  { fieldName: 'purchase_default_uom', label: 'purchase' },
  { fieldName: 'sales_default_uom', label: 'sales' }
].forEach((defaultUOM) => {
  const ticked = latestConversion.filter((item) => item[defaultUOM.fieldName] === 1);
  if (ticked.length === 0) {
    defaultUOMErrors.push(
      'No default ' + defaultUOM.label + ' UOM. Please tick one UOM as the default ' +
        defaultUOM.label + ' UOM.'
    );
  } else if (ticked.length > 1) {
    defaultUOMErrors.push(
      ticked.length + ' default ' + defaultUOM.label + ' UOMs (' +
        ticked.map((item) => item.alt_uom_id).join(', ') +
        '). Only one UOM can be the default ' + defaultUOM.label + ' UOM.'
    );
  }
});

if (defaultUOMErrors.length > 0) {
  return { entry, status: 'Failed', message: defaultUOMErrors.join('<br>') };
}

entry.table_uom_conversion = latestConversion;

const altUOMs = latestConversion.map((item) => item.alt_uom_id);
const invalidLines = [];
const duplicateLines = [];
// A UOM may have several packing rows, but each (UOM, Packing UOM) pair must be
// unique -- documents identify a packing row by that pair.
const seenPairs = [];

(entry.table_packing_detail || []).forEach((item, index) => {
  if (item.uom_id && item.uom_id !== '' && altUOMs.indexOf(item.uom_id) === -1) {
    invalidLines.push(index + 1);
  }
  if (item.uom_id && item.uom_id !== '' && item.packing_uom_id && item.packing_uom_id !== '') {
    const pair = item.uom_id + '|' + item.packing_uom_id;
    if (seenPairs.indexOf(pair) !== -1) {
      duplicateLines.push(index + 1);
    }
    seenPairs.push(pair);
  }
});

if (invalidLines.length > 0) {
  return {
    entry,
    status: 'Failed',
    message: 'Invalid UOM in Packing Detail Line ' + invalidLines.join(', ') +
      '. Each UOM in Packing Detail must exist as an Alt UOM in UOM Conversion.'
  };
}

if (duplicateLines.length > 0) {
  return {
    entry,
    status: 'Failed',
    message: 'Duplicate Packing Detail in Line ' + duplicateLines.join(', ') +
      '. Each UOM can only have one row per Packing UOM.'
  };
}

return { entry, status: 'Passed', message: '' };"""

SCRIPT_VALIDATE_PRICE = """const entry = {{node:code_validate_uom.data.entry}};

const titleCase = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const findMissingPriceLine = (table, name) =>
  (table || []).filter(
    (item) =>
      (!item[name.tableName + '_id'] || item[name.tableName + '_id'] === '') &&
      (!item[name.fieldName + '_price_tag_id'] ||
        item[name.fieldName + '_price_tag_id'] === '')
  );

const findDuplicatePriceLine = (table, name) =>
  (table || []).filter(
    (item) =>
      item[name.tableName + '_id'] &&
      item[name.tableName + '_id'] !== '' &&
      item[name.fieldName + '_price_tag_id'] &&
      item[name.fieldName + '_price_tag_id'] !== ''
  );

const checkValidDateInput = (table, name) =>
  (table || []).filter((item) => {
    const dateFrom = item[name.fieldName + '_price_date_from'];
    const dateTo = item[name.fieldName + '_price_date_to'];
    if (dateFrom && dateTo) {
      return new Date(dateFrom) >= new Date(dateTo);
    }
    return false;
  });

const validatePricingDetail = (groupedPriceLine, name) => {
  const errors = [];
  const label = titleCase(name.tableName);

  Object.keys(groupedPriceLine).forEach((groupKey) => {
    const group = groupedPriceLine[groupKey];
    for (let i = 0; i < group.length; i++) {
      const currentItem = group[i];

      for (let j = i + 1; j < group.length; j++) {
        const comparedItem = group[j];

        const currentFrom = currentItem[name.fieldName + '_price_date_from'];
        const currentTo = currentItem[name.fieldName + '_price_date_to'];
        const comparedFrom = comparedItem[name.fieldName + '_price_date_from'];
        const comparedTo = comparedItem[name.fieldName + '_price_date_to'];

        // A missing boundary means "no boundary", so treat it as infinite.
        const from1 = !currentFrom ? -Infinity : new Date(currentFrom);
        const to1 = !currentTo ? Infinity : new Date(currentTo);
        const from2 = !comparedFrom ? -Infinity : new Date(comparedFrom);
        const to2 = !comparedTo ? Infinity : new Date(comparedTo);

        if (from1 <= to2 && to1 >= from2) {
          const currentMinQty = currentItem[name.fieldName + '_min_order_qty'] || 0;
          const currentMaxQty = currentItem[name.fieldName + '_max_order_qty'] || 0;
          const comparedMinQty = comparedItem[name.fieldName + '_min_order_qty'] || 0;
          const comparedMaxQty = comparedItem[name.fieldName + '_max_order_qty'] || 0;

          const min1 = !currentMinQty || currentMinQty === 0 ? -Infinity : currentMinQty;
          const max1 = !currentMaxQty || currentMaxQty === 0 ? Infinity : currentMaxQty;
          const min2 = !comparedMinQty || comparedMinQty === 0 ? -Infinity : comparedMinQty;
          const max2 = !comparedMaxQty || comparedMaxQty === 0 ? Infinity : comparedMaxQty;

          if (min1 <= max2 && max1 >= min2) {
            errors.push({
              message:
                'Overlapping quantity ranges within the same date found for table ' +
                label + ' Line ' + (i + 1) + ' and Line ' + (j + 1),
              details:
                '[Min: ' + currentMinQty + ', Max: ' + currentMaxQty + '] vs [Min: ' +
                comparedMinQty + ', Max: ' + comparedMaxQty + ']'
            });
          }
        }
      }

      const unitPrice = currentItem[name.fieldName + '_price_unit_price'];
      const minPrice = currentItem[name.fieldName + '_price_min_price'];
      const maxPrice = currentItem[name.fieldName + '_price_max_price'];

      if (minPrice && minPrice > 0 && unitPrice < minPrice) {
        errors.push({
          message: 'Unit price is less than minimum price for table ' + label +
            ' Line ' + (i + 1),
          details: '[Unit Price: ' + unitPrice + ', Min Price: ' + minPrice + ']'
        });
      }

      if (maxPrice && maxPrice > 0 && unitPrice > maxPrice) {
        errors.push({
          message: 'Unit price is greater than maximum price for table ' + label +
            ' Line ' + (i + 1),
          details: '[Unit Price: ' + unitPrice + ', Max Price: ' + maxPrice + ']'
        });
      }
    }
  });

  return errors;
};

const fieldNameList = [
  { tableName: 'supplier', fieldName: 'sup' },
  { tableName: 'customer', fieldName: 'cust' }
];

for (const name of fieldNameList) {
  const priceTable = entry['table_' + name.tableName + '_price'] || [];
  const accessTable = entry['table_' + name.fieldName + '_item_access'] || [];
  const label = titleCase(name.tableName);

  if (
    findMissingPriceLine(priceTable, name).length > 0 ||
    findMissingPriceLine(accessTable, name).length > 0
  ) {
    return { status: 'Failed', message: 'Please fill in all ' + label + ' price lines.' };
  }

  if (
    findDuplicatePriceLine(accessTable, name).length > 0 ||
    findDuplicatePriceLine(priceTable, name).length > 0
  ) {
    return {
      status: 'Failed',
      message: 'Please fill in either <em>' + label + ' Code</em> or <em>' + label +
        ' Price Tag</em> <strong>ONLY</strong>.'
    };
  }

  if (checkValidDateInput(priceTable, name).length > 0) {
    return {
      status: 'Failed',
      message: 'Please fill in valid date range for ' + label + ' price lines.'
    };
  }

  const groupedPriceLine = priceTable.reduce((acc, item) => {
    const hasID = item[name.tableName + '_id'] && item[name.tableName + '_id'] !== '';
    const hasPriceTagID =
      item[name.fieldName + '_price_tag_id'] &&
      item[name.fieldName + '_price_tag_id'] !== '';

    let groupKey;
    if (hasID) {
      groupKey = name.tableName + '_' + item[name.tableName + '_id'] + '_' +
        item[name.fieldName + '_price_uom'];
    } else if (hasPriceTagID) {
      groupKey = name.fieldName + '_price_tag_' + item[name.fieldName + '_price_tag_id'] +
        '_' + item[name.fieldName + '_price_uom'];
    } else {
      groupKey = 'no_id';
    }

    if (!acc[groupKey]) {
      acc[groupKey] = [];
    }
    acc[groupKey].push(item);
    return acc;
  }, {});

  const errors = validatePricingDetail(groupedPriceLine, name);
  if (errors.length > 0) {
    return {
      status: 'Failed',
      message: '<strong>Error in ' + label + ' Price Line:</strong><br> ' +
        errors.map((e) => e.message).join('<br>') +
        '<br><br><strong>Details:</strong><br>' +
        errors.map((e) => e.details).join('<br>')
    };
  }
}

return { status: 'Passed', message: '' };"""

SCRIPT_BATCH_LEVEL = """const entry = {{node:code_determine.data.entry}};
const rows = {{node:search_batch_org.data.data}} || [];
const config = rows.length > 0 ? rows[0] : null;

return {
  isItemLevel: config && config.batch_level_selection === 'Item Level' ? 'Y' : 'N',
  itemId: entry.id ? String(entry.id) : '0'
};"""

SCRIPT_BATCH_CHECK = """const entry = {{node:code_determine.data.entry}};
const itemRows = {{node:search_batch_item.data.data}} || [];

const hasConfig =
  entry.batch_config && Object.keys(entry.batch_config).length > 0;

return { status: !hasConfig && itemRows.length === 0 ? 'Failed' : 'Passed' };"""

SCRIPT_FILLBACK = """const entry = {{node:code_validate_uom.data.entry}};
const isPost = {{node:code_determine.data.isPost}} === 'Y';

// These columns are decimal(65,N). A raw float is serialized at full precision
// (1.6 -> 1.5999999999999999) and the BigDecimal multipleOf check then rejects
// the whole save, so every one of them is coerced to a fixed-scale STRING here.
// This map is an ALLOW-LIST -- a decimal column missing from it will crash a save.
const DEC_HEADER = __DEC_HEADER__;
const DEC_UOM = __DEC_UOM__;
const DEC_PACK = __DEC_PACK__;
const DEC_SUP = __DEC_SUP__;
const DEC_CUST = __DEC_CUST__;
const DEC_REORDER = __DEC_REORDER__;

// A blank stays blank: defaulting to "0.0000" would write a zero where the user
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

const formatTable = (rows, map) => (rows || []).map((row) => applyDec(row, map));

const formatted = applyDec(entry, DEC_HEADER);
formatted.table_uom_conversion = formatTable(entry.table_uom_conversion, DEC_UOM);
formatted.table_packing_detail = formatTable(entry.table_packing_detail, DEC_PACK);
formatted.table_supplier_price = formatTable(entry.table_supplier_price, DEC_SUP);
formatted.table_customer_price = formatTable(entry.table_customer_price, DEC_CUST);
formatted.table_reorder_supplier = formatTable(entry.table_reorder_supplier, DEC_REORDER);

if (isPost) {
  formatted.posted_status = 'Pending Post';
}

return { entry: formatted };"""

SCRIPT_LATEST = """const isEdit = {{node:code_determine.data.isEdit}} === 'Y';
const entry = {{node:code_fillback.data.entry}};
const added = {{node:add_item.data}};

// On Add the insert returns the row the numbering engine actually wrote, which
// is where the generated material_code comes from. On Edit nothing changed, so
// the payload we just wrote is already the record.
const addedRow = added && added.length > 0 ? added[0] : added;
const itemData = isEdit ? entry : addedRow;

const needsBom =
  itemData.auto_bom === 1 &&
  (!itemData.bom_id || itemData.bom_id === '' || itemData.bom_id === null);

return { itemData, needsBom: needsBom ? 'Y' : 'N' };"""

SCRIPT_BOM_IDS = """const added = {{node:add_bom.data}};
const bom = added && added.length > 0 ? added[0] : added;

return {
  bomId: bom.id,
  bomStatus: bom.bom_status,
  bomPath: '/' + bom.id + '/'
};"""

SCRIPT_BATCH_PAYLOAD = """const entry = {{node:code_fillback.data.entry}};
const itemData = {{node:code_latest.data.itemData}};

const config = entry.batch_config;
const hasConfig = config && Object.keys(config).length > 0;

let payload = {};
if (hasConfig) {
  payload = Object.assign({}, config, {
    item_id: itemData.id,
    // The real code, not the "issued" sentinel the form sent in.
    batch_format: String(config.batch_format || '')
      .split('{itemCode}')
      .join(itemData.material_code || '')
  });
}

return { hasConfig: hasConfig ? 'Y' : 'N', payload };"""

SCRIPT_MAP_RETURNED = """const itemData = {{node:code_latest.data.itemData}};
const accRows = {{node:search_acc.data.data}} || [];
const acc = accRows.length > 0 ? accRows[0] : {};

return {
  id: itemData.id,
  material_code: itemData.material_code,
  material_name: itemData.material_name,
  is_active: itemData.is_active,
  acc_integration_type: acc.acc_integration_type || '',
  agent_id: acc.agent_id || ''
};"""

SCRIPT_FILLBACK = (SCRIPT_FILLBACK
    .replace("__DEC_HEADER__", js_map(DEC_HEADER))
    .replace("__DEC_UOM__", js_map(DEC_UOM))
    .replace("__DEC_PACK__", js_map(DEC_PACK))
    .replace("__DEC_SUP__", js_map(DEC_SUP))
    .replace("__DEC_CUST__", js_map(DEC_CUST))
    .replace("__DEC_REORDER__", js_map(DEC_REORDER)))

# -------------------------------------------------------------------- assembly
item_props_add = [prop(c, "{{node:code_fillback.data.entry.%s}}" % c) for c in ITEM_COLUMNS]
item_props_update = [prop("id", "{{node:code_fillback.data.entry.id}}")] + item_props_add

nodes = [
    start_node(),

    code_node("code_determine", "Determine Params", SCRIPT_DETERMINE, [
        ("entry", "any"), ("isEdit", "string"), ("isPost", "string"),
        ("needsBatchCheck", "string"), ("hasOrg", "string")]),

    if_node("if_no_org", "Missing Organization?",
            "'{{node:code_determine.data.hasOrg}}' == 'N'",
            [end_error("end_no_org_404", 404,
                       "'Organization is required to save an item.'")]),

    code_node("code_required", "Required Fields", SCRIPT_REQUIRED,
              [("required_fields", "string"), ("data", "string")]),

    workflow_node("wf_check_required", "Check Required Workflow",
                  WF_CHECK_REQUIRED, "1988831880511062018",
                  [("entry", "{{node:code_required.data.data}}"),
                   ("required_fields", "{{node:code_required.data.required_fields}}")]),

    if_node("if_required_failed", "Validation Failed?",
            "'{{node:wf_check_required.data.data.status}}' == 'Failed'",
            [end_error("end_required_400", 400,
                       "{{node:wf_check_required.data.data.message}}")]),

    code_node("code_validate_uom", "Validate UOM Conversion", SCRIPT_VALIDATE_UOM,
              [("entry", "any"), ("status", "string"), ("message", "string")]),

    if_node("if_uom_failed", "UOM Validation Failed?",
            "'{{node:code_validate_uom.data.status}}' == 'Failed'",
            [end_error("end_uom_401", 401, "{{node:code_validate_uom.data.message}}")]),

    code_node("code_validate_price", "Validate Purchase And Sales Information",
              SCRIPT_VALIDATE_PRICE, [("status", "string"), ("message", "string")]),

    if_node("if_price_failed", "Price Validation Failed?",
            "'{{node:code_validate_price.data.status}}' == 'Failed'",
            [end_error("end_price_402", 402, "{{node:code_validate_price.data.message}}")]),

    if_node("if_batch_needed", "Need Batch Config Check?",
            "'{{node:code_determine.data.needsBatchCheck}}' == 'Y'",
            [
                search_node("search_batch_org", "Get Organization Batch Config",
                            BATCHCFG_TABLE, BATCHCFG_ID,
                            [leaf("organization_id", "equal",
                                  "{{workflowparams:allData.organization_id}}")]),
                code_node("code_batch_level", "Batch Level", SCRIPT_BATCH_LEVEL,
                          [("isItemLevel", "string"), ("itemId", "string")]),
                if_node("if_item_level", "Item Level?",
                        "'{{node:code_batch_level.data.isItemLevel}}' == 'Y'",
                        [
                            search_node("search_batch_item", "Get Item Batch Config",
                                        BATCHCFG_TABLE, BATCHCFG_ID,
                                        [leaf("organization_id", "equal",
                                              "{{workflowparams:allData.organization_id}}"),
                                         leaf("item_id", "equal",
                                              "{{node:code_batch_level.data.itemId}}")]),
                            code_node("code_batch_check", "Check Batch Config",
                                      SCRIPT_BATCH_CHECK, [("status", "string")]),
                            if_node("if_batch_failed", "Batch Config Missing?",
                                    "'{{node:code_batch_check.data.status}}' == 'Failed'",
                                    [end_error("end_batch_403", 403,
                                               "'Please set batch configuration'")]),
                        ]),
            ]),

    code_node("code_fillback", "Fillback Header Fields", SCRIPT_FILLBACK, [("entry", "any")]),

    if_node("if_edit", "IF edit?",
            "'{{node:code_determine.data.isEdit}}' == 'Y'",
            [update_node("update_item", "Update Data", ITEM_TABLE, ITEM_ID,
                         [leaf("id", "in", "{{node:code_fillback.data.entry.id}}")],
                         item_props_update)],
            [add_node("add_item", "Add Data", ITEM_TABLE, ITEM_ID, item_props_add)]),

    code_node("code_latest", "Get Latest Item", SCRIPT_LATEST,
              [("itemData", "any"), ("needsBom", "string")]),

    if_node("if_auto_bom", "Auto Create BOM?",
            "'{{node:code_latest.data.needsBom}}' == 'Y'",
            [
                add_node("add_bom", "Add BOM", BOM_TABLE, BOM_ID, [
                    prop("bom_level", "1", "value"),
                    prop("bom_sort", "0", "value"),
                    prop("organization_id", "{{node:code_latest.data.itemData.organization_id}}"),
                    prop("is_current_version", "1", "value"),
                    prop("is_top_level", "1", "value"),
                    prop("is_active", "1", "value"),
                    prop("bom_status", "Unready", "value"),
                    prop("bom_version", "V1", "value"),
                    prop("base_quantity", "1.000", "value"),
                    prop("material_id", "{{node:code_latest.data.itemData.id}}"),
                    prop("material_code", "{{node:code_latest.data.itemData.material_code}}"),
                    prop("material_name", "{{node:code_latest.data.itemData.material_name}}"),
                    prop("material_desc", "{{node:code_latest.data.itemData.material_desc}}"),
                    prop("category", "{{node:code_latest.data.itemData.item_category}}"),
                    prop("material_type", "{{node:code_latest.data.itemData.item_properties}}"),
                    prop("material_uom", "{{node:code_latest.data.itemData.based_uom}}"),
                    prop("bom_type", "STANDARD", "value"),
                ]),
                code_node("code_bom_ids", "BOM IDs", SCRIPT_BOM_IDS,
                          [("bomId", "string"), ("bomStatus", "string"), ("bomPath", "string")]),
                cond_all("cond_all_bom", "Back-fill BOM Links", [
                    ("cond_bom_item", "Item BOM Link", [
                        update_node("update_item_bom", "Update Item BOM", ITEM_TABLE, ITEM_ID,
                                    [leaf("id", "in", "{{node:code_latest.data.itemData.id}}")],
                                    [prop("id", "{{node:code_latest.data.itemData.id}}"),
                                     prop("bom_id", "{{node:code_bom_ids.data.bomId}}"),
                                     prop("bom_status", "{{node:code_bom_ids.data.bomStatus}}")])]),
                    ("cond_bom_path", "BOM Path", [
                        update_node("update_bom_path", "Update BOM Path", BOM_TABLE, BOM_ID,
                                    [leaf("id", "in", "{{node:code_bom_ids.data.bomId}}")],
                                    [prop("id", "{{node:code_bom_ids.data.bomId}}"),
                                     prop("root_id", "{{node:code_bom_ids.data.bomId}}"),
                                     prop("bom_path", "{{node:code_bom_ids.data.bomPath}}")])]),
                ]),
            ]),

    cond_all("cond_all_post", "Post-save Side Effects", [
        ("cond_post_batch", "Batch Config", [
            code_node("code_batch_payload", "Batch Config Payload", SCRIPT_BATCH_PAYLOAD,
                      [("hasConfig", "string"), ("payload", "any")]),
            if_node("if_has_batch_config", "Has Batch Config?",
                    "'{{node:code_batch_payload.data.hasConfig}}' == 'Y'",
                    [workflow_node("wf_batch_config", "Update Batch Config",
                                   WF_BATCH_CONFIG, "2058838457211068417",
                                   [("allData", "{{node:code_batch_payload.data.payload}}")])]),
        ]),
        ("cond_post_ai", "AI Agent Upsert", [
            # Fire-and-forget: nothing reads this, exactly as the client treated it.
            workflow_node("wf_ai_upsert", "Upsert Item To AI Agent",
                          WF_AI_UPSERT, "2080219250438160386",
                          [("id", "{{node:code_latest.data.itemData.id}}"),
                           ("material_code", "{{node:code_latest.data.itemData.material_code}}"),
                           ("material_name", "{{node:code_latest.data.itemData.material_name}}"),
                           ("is_active", "{{node:code_latest.data.itemData.is_active}}")]),
        ]),
        ("cond_post_acc", "Accounting Integration", [
            search_node("search_acc", "Get Accounting Integration", ACC_TABLE, ACC_ID,
                        [leaf("organization_id", "equal",
                              "{{workflowparams:allData.organization_id}}")]),
        ]),
    ]),

    code_node("code_map_returned", "Map returned data", SCRIPT_MAP_RETURNED,
              [("id", "string"), ("material_code", "string"), ("material_name", "string"),
               ("is_active", "any"), ("acc_integration_type", "string"),
               ("agent_id", "string")]),

    {"id": "end", "type": "end-node",
     "data": {"isValidator": True, "title": "End Node", "nodeName": "End Node",
              "name": "End Node", "back_data_type": "OutputParams", "code": "",
              "msg": {"type": "javascript", "code": ""},
              "response_value": {"list": [
                  {"prop": p, "propLabel": p, "operator": "", "operatorLabel": "",
                   "valueType": "field", "valueTypeLabel": "",
                   "value": "{{node:code_map_returned.data.%s}}" % p, "valueLabel": ""}
                  for p in ("id", "material_code", "material_name", "is_active",
                            "acc_integration_type", "agent_id")]}},
     "blocks": []},
]

workflow = {
    "request_json": [{"key": key(), "name": "allData", "title": "All Data",
                      "description": "", "bsonType": "any", "isExpand": False,
                      "children": []}],
    "response_json": [
        {"key": key(), "name": n, "title": "", "description": "",
         "bsonType": t, "isExpand": False, "children": []}
        for n, t in (("id", "string"), ("material_code", "string"),
                     ("material_name", "string"), ("is_active", "any"),
                     ("acc_integration_type", "string"), ("agent_id", "string"))],
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

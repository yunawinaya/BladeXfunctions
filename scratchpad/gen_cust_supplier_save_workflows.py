#!/usr/bin/env python3
"""Emit Customer/CustSaveWorkflow.json (CUSTOMER_SAVE) and
Supplier/SupplierSaveWorkflow.json (SUPPLIER_SAVE).

Ports of Customer/CustOnSave.js and Supplier/SupplierSave.js. Regenerate with:

    python3 scratchpad/gen_cust_supplier_save_workflows.py
"""
import json, os, string, random

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = os.path.dirname(os.path.abspath(__file__))

CUST_TABLE = "Customer:Table:1902779099617804290"
CUST_ID = "1902779099617804290"
CONTACT_TABLE = "Contact List(Customer):Table:1942869939031912450"
CONTACT_ID = "1942869939031912450"
SUP_TABLE = "Supplier:Table:1901541078662762497"
SUP_ID = "1901541078662762497"

WF_CUST_AI = ("Upsert-Customer:Workflow:2075496757336727553", "2075496757336727553")
WF_SUP_AI = ("Upsert-Supplier:Workflow:2094621825355546625", "2094621825355546625")

# ---------------------------------------------------------------- id helpers
_fid = [1710000000000]
def fid():
    _fid[0] += 1
    return _fid[0]

_rng = random.Random(20260914)
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

def leaf_where(prop, operator, value, label=None):
    lid, pid = fid(), fid()
    return [{"id": lid, "parentId": pid, "isTop": True, "prop": prop, "operator": operator,
             "valueType": "field", "value": value, "type": "leaf", "level": 1,
             "propLabel": label or prop, "valueLabel": "", "operatorLabel": operator}]

def search_node(nid, title, source, coll_id, where, limit=1000):
    return {
        "id": nid, "type": "search-node",
        "data": {"table_id": {"source": source,
                              "rules": {"collectionId": coll_id, "list": where}},
                 "condition": {}, "limit": limit,
                 "title": title, "isValidator": True, "nodeName": title, "name": title},
        "blocks": [],
    }

def prop(name, value):
    return {"prop": name, "valueType": "field", "value": value,
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

def update_node(nid, title, source, coll_id, where, props):
    return {
        "id": nid, "type": "update-node",
        "data": {"table_id": {"source": source,
                              "rules": {"collectionId": coll_id, "list": where}},
                 "fields": [], "condition": {}, "title": title, "isValidator": True,
                 "nodeName": title, "name": title,
                 "props": {"modelName": "", "list": props}},
        "blocks": [],
    }

def workflow_node(nid, title, wf, body):
    source, coll_id = wf
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

def end_ok(src_node, fields):
    return {"id": "end", "type": "end-node",
            "data": {"isValidator": True, "title": "End Node", "nodeName": "End Node",
                     "name": "End Node", "back_data_type": "OutputParams", "code": "",
                     "msg": {"type": "javascript", "code": ""},
                     "response_value": {"list": [
                         {"prop": p, "propLabel": p, "operator": "", "operatorLabel": "",
                          "valueType": "field", "valueTypeLabel": "",
                          "value": "{{node:%s.data.%s}}" % (src_node, p), "valueLabel": ""}
                         for p in fields]}},
            "blocks": []}

def workflow_doc(nodes, out_fields):
    return {
        "request_json": [{"key": key(), "name": "allData", "title": "All Data",
                          "description": "", "bsonType": "any", "isExpand": False,
                          "children": []}],
        "response_json": [
            {"key": key(), "name": n, "title": "", "description": "",
             "bsonType": "string", "isExpand": False, "children": []}
            for n in out_fields],
        "config": {},
        "nodes": nodes,
        "edges": [],
    }

def js_map(d):
    return "{ " + ", ".join("%s: %d" % (k, v) for k, v in d.items()) + " }"

def write(path, workflow):
    with open(path, "w") as fh:
        json.dump(workflow, fh, ensure_ascii=False, indent=1)
        fh.write("\n")
    with open(path) as fh:
        assert json.load(fh) == workflow
    print("wrote %s (%d top-level nodes)" % (path, len(workflow["nodes"])))

# ------------------------------------------------------------- shared scripts
FILLBACK = """const entry = {{node:code_determine.data.entry}};

// decimal(65,2) columns. A raw float is serialized at full precision and the
// BigDecimal multipleOf check rejects the whole save, so each one is coerced to a
// fixed-scale STRING. This map is an ALLOW-LIST -- a missing decimal column will crash a save.
const DEC = __DEC__;

const formatted = Object.assign({}, entry);
Object.keys(DEC).forEach((column) => {
  const raw = formatted[column];
  if (raw === null || raw === undefined || raw === '') {
    return;
  }
  const parsed = parseFloat(raw);
  formatted[column] = isNaN(parsed) ? raw : parsed.toFixed(DEC[column]);
});

return { entry: formatted };"""

LATEST = """const isEdit = {{node:code_determine.data.isEdit}} === 'Y';
const entry = {{node:code_fillback.data.entry}};
const added = {{node:__ADD__.data}};

// On Add the insert returns the row the numbering engine wrote, so the real code
// replaces the "issued" sentinel. On Edit the payload we just wrote is the record.
const addedRow = added && added.length > 0 ? added[0] : added;
const record = (isEdit ? entry : addedRow) || {};

return {
  id: record.id ? String(record.id) : '',
__FIELDS__
};"""

def latest_script(add_id, fields):
    body = ",\n".join("  %s: record.%s || ''" % (out, col) for out, col in fields)
    return LATEST.replace("__ADD__", add_id).replace("__FIELDS__", body)

def update_props(columns, owned_elsewhere):
    return ([prop("id", "{{node:code_fillback.data.entry.id}}")] +
            [prop(c, "{{node:code_fillback.data.entry.%s}}" % c)
             for c in columns if c not in owned_elsewhere])

def add_props(columns):
    return [prop(c, "{{node:code_fillback.data.entry.%s}}" % c) for c in columns]

# =================================================================== CUSTOMER
CUST_COLUMNS = json.load(open(os.path.join(S, "customer_save_columns.json")))["columns"]
CUST_DEC = {"customer_credit_limit": 2, "overdue_limit": 2,
            "outstanding_balance": 2, "overdue_inv_total_amount": 2}
# Written by SQL/ATC_UPDATE_CUS_CREDIT_LIMIT and ATC_SYNC_DEBTOR. The form only holds
# its mount-time snapshot, so an Edit must not write them back.
CUST_OWNED_ELSEWHERE = {"outstanding_balance", "overdue_inv_total_amount",
                        "last_sync_date", "customer_uuid"}

CUST_DETERMINE = """const entry = {{workflowparams:allData}};

const pageStatus = entry.page_status;
const isEdit = pageStatus === 'Edit';
const pageValid = isEdit || pageStatus === 'Add' || pageStatus === 'Clone';

const isBlank = (value) => {
  if (value === undefined || value === null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'string') return value.trim() === '';
  return !value;
};

// -9999 is "Manual Input"; any other rule means the platform numbers it on insert.
const isManualCode = String(entry.customer_id_type) === '-9999';

const requiredFields = [{ name: 'customer_status', label: 'Customer Status' }];
if (isManualCode) {
  requiredFields.push({ name: 'customer_id', label: 'Customer Code' });
}
requiredFields.push(
  { name: 'customer_com_name', label: 'Company Name' },
  { name: 'customer_currency_id', label: 'Currency' },
  { name: 'customer_payment_term_id', label: 'Payment Terms' }
);

const missing = requiredFields
  .filter((field) => isBlank(entry[field.name]))
  .map((field) => field.label);

entry.customer_id = isManualCode || isEdit ? entry.customer_id : 'issued';

const stripLeadingZero = (m) => {
  const s = (m || '').toString();
  return s.startsWith('0') ? s.slice(1) : s;
};

const contacts = Array.isArray(entry.contact_list) ? entry.contact_list : [];
let contactMessage = '';
const seen = {};
for (let i = 0; i < contacts.length; i++) {
  const c = contacts[i];
  if (!c.mobile_number) continue;
  const mobileKey = stripLeadingZero(c.mobile_number);
  if (seen[mobileKey] !== undefined) {
    contactMessage =
      'Duplicate mobile number ' + c.mobile_number + ' in contacts (rows ' +
      (seen[mobileKey] + 1) + ' and ' + (i + 1) + ')';
    break;
  }
  seen[mobileKey] = i;
}

const mobileVariants = [];
contacts
  .filter((c) => c.mobile_number)
  .forEach((c) => {
    const noLead = stripLeadingZero(c.mobile_number);
    [noLead, '0' + noLead].forEach((v) => {
      if (mobileVariants.indexOf(v) === -1) mobileVariants.push(v);
    });
  });

return {
  entry,
  isEdit: isEdit ? 'Y' : 'N',
  pageValid: pageValid ? 'Y' : 'N',
  requiredStatus: missing.length > 0 ? 'Failed' : 'Passed',
  requiredMessage: 'Missing required fields: ' + missing.join(', '),
  contactStatus: contactMessage ? 'Failed' : 'Passed',
  contactMessage,
  hasMobiles: mobileVariants.length > 0 ? 'Y' : 'N',
  mobileVariants
};"""

CUST_CONTACT_CHECK = """const entry = {{node:code_determine.data.entry}};
const found = {{node:search_contacts.data.data}} || [];
const rows = Array.isArray(found) ? found : [found];

const stripLeadingZero = (m) => {
  const s = (m || '').toString();
  return s.startsWith('0') ? s.slice(1) : s;
};

const contacts = Array.isArray(entry.contact_list) ? entry.contact_list : [];
const inMemoryIds = contacts.filter((c) => c.id).map((c) => String(c.id));
const currentId = entry.id ? String(entry.id) : '';

for (const c of contacts.filter((x) => x.mobile_number)) {
  const noLead = stripLeadingZero(c.mobile_number);
  const collision = rows.find(
    (r) =>
      inMemoryIds.indexOf(String(r.id)) === -1 &&
      stripLeadingZero(r.mobile_number) === noLead
  );
  if (collision) {
    const owner = collision.Customer_id != null ? collision.Customer_id : collision.customer_id;
    const sameCustomer = currentId !== '' && String(owner) === currentId;
    return {
      status: 'Failed',
      message: sameCustomer
        ? 'Mobile number ' + c.mobile_number + " already exists in this customer's other contacts"
        : 'Mobile number ' + c.mobile_number + ' is already registered to another customer'
    };
  }
}

return { status: 'Passed', message: '' };"""

cust_nodes = [
    start_node(),

    code_node("code_determine", "Determine Params", CUST_DETERMINE, [
        ("entry", "any"), ("isEdit", "string"), ("pageValid", "string"),
        ("requiredStatus", "string"), ("requiredMessage", "string"),
        ("contactStatus", "string"), ("contactMessage", "string"),
        ("hasMobiles", "string"), ("mobileVariants", "array")]),

    if_node("if_page_invalid", "Invalid Page Status?",
            "'{{node:code_determine.data.pageValid}}' == 'N'",
            [end_error("end_page_402", 402, "'Invalid page status'")]),

    if_node("if_required_failed", "Required Fields Missing?",
            "'{{node:code_determine.data.requiredStatus}}' == 'Failed'",
            [end_error("end_required_400", 400, "{{node:code_determine.data.requiredMessage}}")]),

    if_node("if_contact_dup", "Duplicate Mobile In Contacts?",
            "'{{node:code_determine.data.contactStatus}}' == 'Failed'",
            [end_error("end_contact_dup_401", 401, "{{node:code_determine.data.contactMessage}}")]),

    if_node("if_has_mobiles", "Any Contact Mobile?",
            "'{{node:code_determine.data.hasMobiles}}' == 'Y'",
            [
                search_node("search_contacts", "Get Contacts By Mobile",
                            CONTACT_TABLE, CONTACT_ID,
                            leaf_where("mobile_number", "equalAny",
                                       "{{node:code_determine.data.mobileVariants}}", "Mobile")),
                code_node("code_contact_check", "Check Mobile Registered",
                          CUST_CONTACT_CHECK, [("status", "string"), ("message", "string")]),
                if_node("if_contact_taken", "Mobile Already Registered?",
                        "'{{node:code_contact_check.data.status}}' == 'Failed'",
                        [end_error("end_contact_taken_401", 401,
                                   "{{node:code_contact_check.data.message}}")]),
            ]),

    code_node("code_fillback", "Fillback Header Fields",
              FILLBACK.replace("__DEC__", js_map(CUST_DEC)), [("entry", "any")]),

    if_node("if_edit", "IF edit?",
            "'{{node:code_determine.data.isEdit}}' == 'Y'",
            [update_node("update_customer", "Update Customer", CUST_TABLE, CUST_ID,
                         leaf_where("id", "in", "{{node:code_fillback.data.entry.id}}"),
                         update_props(CUST_COLUMNS, CUST_OWNED_ELSEWHERE))],
            [add_node("add_customer", "Add Customer", CUST_TABLE, CUST_ID,
                      add_props(CUST_COLUMNS))]),

    code_node("code_latest", "Map Saved Customer",
              latest_script("add_customer", [("customer_code", "customer_id"),
                                             ("customer_name", "customer_com_name"),
                                             ("customer_status", "customer_status")]),
              [("id", "string"), ("customer_code", "string"),
               ("customer_name", "string"), ("customer_status", "string")]),

    workflow_node("wf_ai_upsert", "Upsert Customer To AI Agent", WF_CUST_AI,
                  [("id", "{{node:code_latest.data.id}}"),
                   ("customer_code", "{{node:code_latest.data.customer_code}}"),
                   ("customer_name", "{{node:code_latest.data.customer_name}}"),
                   ("customer_status", "{{node:code_latest.data.customer_status}}")]),

    end_ok("code_latest", ("id", "customer_code", "customer_name", "customer_status")),
]

write(os.path.join(ROOT, "Customer", "CustSaveWorkflow.json"),
      workflow_doc(cust_nodes, ("id", "customer_code", "customer_name", "customer_status")))

# =================================================================== SUPPLIER
SUP_COLUMNS = json.load(open(os.path.join(S, "supplier_save_columns.json")))["columns"]
SUP_DEC = {"supplier_credit_limit": 2}
# Written by ATC_SYNC_CREDITOR; the form only holds its mount-time snapshot.
SUP_OWNED_ELSEWHERE = {"supplier_uuid"}

SUP_DETERMINE = """const entry = {{workflowparams:allData}};

const pageStatus = entry.page_status;
const isEdit = pageStatus === 'Edit';
const pageValid = isEdit || pageStatus === 'Add' || pageStatus === 'Clone';

const isBlank = (value) => {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (typeof value === 'number') return value <= 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return !value;
};

// -9999 is "Manual Input"; any other rule means the platform numbers it on insert.
const isManualCode = String(entry.supplier_code_type) === '-9999';

const requiredFields = [{ name: 'supplier_type', label: 'Supplier Type' }];
if (isManualCode) {
  requiredFields.push({ name: 'supplier_code', label: 'Supplier Code' });
}
requiredFields.push({ name: 'supplier_com_name', label: 'Company Name' });

const missing = requiredFields
  .filter((field) => isBlank(entry[field.name]))
  .map((field) => field.label);

entry.supplier_code = isManualCode || isEdit ? entry.supplier_code : 'issued';

return {
  entry,
  isEdit: isEdit ? 'Y' : 'N',
  pageValid: pageValid ? 'Y' : 'N',
  requiredStatus: missing.length > 0 ? 'Failed' : 'Passed',
  requiredMessage: 'Validation errors: ' + missing.join(', ')
};"""

sup_nodes = [
    start_node(),

    code_node("code_determine", "Determine Params", SUP_DETERMINE, [
        ("entry", "any"), ("isEdit", "string"), ("pageValid", "string"),
        ("requiredStatus", "string"), ("requiredMessage", "string")]),

    if_node("if_page_invalid", "Invalid Page Status?",
            "'{{node:code_determine.data.pageValid}}' == 'N'",
            [end_error("end_page_402", 402, "'Invalid page status'")]),

    if_node("if_required_failed", "Required Fields Missing?",
            "'{{node:code_determine.data.requiredStatus}}' == 'Failed'",
            [end_error("end_required_400", 400, "{{node:code_determine.data.requiredMessage}}")]),

    code_node("code_fillback", "Fillback Header Fields",
              FILLBACK.replace("__DEC__", js_map(SUP_DEC)), [("entry", "any")]),

    if_node("if_edit", "IF edit?",
            "'{{node:code_determine.data.isEdit}}' == 'Y'",
            [update_node("update_supplier", "Update Supplier", SUP_TABLE, SUP_ID,
                         leaf_where("id", "in", "{{node:code_fillback.data.entry.id}}"),
                         update_props(SUP_COLUMNS, SUP_OWNED_ELSEWHERE))],
            [add_node("add_supplier", "Add Supplier", SUP_TABLE, SUP_ID,
                      add_props(SUP_COLUMNS))]),

    code_node("code_latest", "Map Saved Supplier",
              latest_script("add_supplier", [("supplier_code", "supplier_code"),
                                             ("supplier_name", "supplier_com_name"),
                                             ("supplier_status", "supplier_status")]),
              [("id", "string"), ("supplier_code", "string"),
               ("supplier_name", "string"), ("supplier_status", "string")]),

    workflow_node("wf_ai_upsert", "Upsert Supplier To AI Agent", WF_SUP_AI,
                  [("id", "{{node:code_latest.data.id}}"),
                   ("supplier_code", "{{node:code_latest.data.supplier_code}}"),
                   ("supplier_name", "{{node:code_latest.data.supplier_name}}"),
                   ("supplier_status", "{{node:code_latest.data.supplier_status}}")]),

    end_ok("code_latest", ("id", "supplier_code", "supplier_name", "supplier_status")),
]

write(os.path.join(ROOT, "Supplier", "SupplierSaveWorkflow.json"),
      workflow_doc(sup_nodes, ("id", "supplier_code", "supplier_name", "supplier_status")))

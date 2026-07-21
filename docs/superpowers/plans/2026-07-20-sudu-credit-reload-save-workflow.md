# Sudu Credit Reload Save Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one low-code workflow that saves Sudu Credit Reload records from two entry modes — a full form payload and a headless payload carrying only `tenant_id`, `reload_type` and `reload_amount` — with all pricing maths computed server-side.

**Architecture:** A single workflow JSON with no edge list; flow is sequential within `blocks` arrays and branches by nesting, so a node placed after an `if` runs for both branches and lets the two modes converge on one shared calculation node. Routing flags are computed in a first code node rather than embedded in branch filters. The headless branch forks its two independent lookups through a `condition-all-node`.

**Tech Stack:** BladeX low-code platform workflow JSON; JavaScript inside `code-node.data.script.code`; Python 3 + `json` for authoring and validation; Node for JS syntax checks and calculation simulation.

## Global Constraints

- **No automated test framework exists in this repo.** Verification is structural validation scripts plus Node simulation, then manual on-platform testing. Do not introduce pytest/jest.
- **Do not run `git commit`.** The user handles all git operations themselves. End each task by reporting what changed.
- `db.collection()` and workflow `table_id.source` take the **registered display name**, not the physical table name. Physical `sudu_customer` is registered as `Sudu Customer`.
- Table sources, verbatim:
  - `Sudu Credit Reload:Table:1983746316466860034`
  - `Sudu Customer:Table:1983717165334331394`
  - `Currency:Table:1902047936116805633`
  - `流水号规则表:Table:1994006139209117697`
- Pricing constants: `BASE_AMOUNT = 45`, `BASE_CREDIT = 10000`, `TAX_RATE = 0.08`.
- `reload_type` dictionary keys are the literal strings `"Monthly Subscription"` and `"Add On"`.
- Decimal columns must be formatted as **`toFixed` strings**, not re-parsed floats. Money → `toFixed(2)`, `exchange_rate` → `toFixed(6)`, credits → integer.
- `if` node expressions are string-substituted before execution: wrap string-valued selectors in single quotes, and use `==` not `===`.
- Every `if` node needs both a true and a false `ifBlock`, and the **true block must be non-empty**.
- Every key returned from a code node must be declared in that node's `response_json`, or downstream `{{node:...}}` selectors resolve to nothing.
- JS placeholders inside code nodes are **not** quoted (`let x = {{node:a.data.b}}`); `if` expressions **are**.
- The workflow never writes to Sudu Customer. This is document-only by design.

---

## File Structure

| File | Responsibility |
|---|---|
| `scripts/validate_workflow.py` (create) | Reusable structural validator for any workflow JSON in this repo. The test harness. |
| `Sudu AI/Credit Reload/SuduCreditReloadSaveWorkflow.json` (create) | The workflow itself. |
| `Sudu AI/Credit Reload/SuduCreditReloadFullJSON.json` (modify) | `mounted` gains `page_status`; `button_save.onClick` gains a save handler. |
| `Sudu AI/Credit Reload/SuduCreditReloadOnMounted.js` (regenerate) | Extracted from the JSON. |
| `Sudu AI/Credit Reload/SuduCreditReloadSave.js` (create, generated) | Extracted from the JSON. |

---

### Task 1: Workflow structural validator

Build the harness first so every later task has a real pass/fail gate.

**Files:**
- Create: `scripts/validate_workflow.py`

**Interfaces:**
- Produces: CLI `python3 scripts/validate_workflow.py <path-to-workflow.json>`, exit 0 on pass, exit 1 with a printed finding list on failure.

- [ ] **Step 1: Write the validator**

Create `scripts/validate_workflow.py`:

```python
#!/usr/bin/env python3
"""Structural validator for BladeX low-code workflow JSON.

Checks the failure modes that are silent on-platform:
  - unresolvable {{node:<id>...}} selectors
  - code-node return keys missing from response_json
  - if-nodes with an empty true block (crashes the compiler)
  - === used inside an if expression (MVEL evaluates it false silently)
  - duplicate node ids
"""
import json
import re
import sys


def walk(node, out):
    """Yield every node dict in the nested blocks tree."""
    if isinstance(node, dict):
        if "id" in node and "type" in node:
            out.append(node)
        for value in node.values():
            walk(value, out)
    elif isinstance(node, list):
        for value in node:
            walk(value, out)


def code_of(node):
    data = node.get("data") or {}
    script = data.get("script") or {}
    return script.get("code") or ""


def main(path):
    doc = json.load(open(path, encoding="utf-8"))
    nodes = []
    walk(doc.get("nodes", []), nodes)

    findings = []
    ids = [n["id"] for n in nodes]

    for node_id in sorted({i for i in ids if ids.count(i) > 1}):
        findings.append(f"duplicate node id: {node_id}")

    id_set = set(ids)
    blob = json.dumps(doc, ensure_ascii=False)

    # 1. every {{node:<id>...}} selector must name a node that exists
    for ref in sorted(set(re.findall(r"\{\{node:([A-Za-z0-9_]+)", blob))):
        if ref not in id_set:
            findings.append(f"selector references missing node: {ref}")

    # 2. code nodes must declare every key they return
    for node in nodes:
        if node.get("type") != "code-node":
            continue
        declared = {
            f.get("name") for f in (node.get("data", {}).get("response_json") or [])
        }
        code = code_of(node)
        returned = set()
        # `return { a, b }` and `return { a: x, b: y }`
        for match in re.finditer(r"return\s*\{([^}]*)\}", code, re.S):
            for key in re.finditer(r"([A-Za-z_][A-Za-z0-9_]*)\s*(?::|,|$)", match.group(1)):
                returned.add(key.group(1))
        missing = returned - declared
        if missing:
            findings.append(
                f"{node['id']}: returns {sorted(missing)} not declared in response_json"
            )

    # 3. if nodes need a non-empty true block, and no === in the expression
    for node in nodes:
        if node.get("type") != "if":
            continue
        blocks = node.get("blocks") or []
        if len(blocks) < 2:
            findings.append(f"{node['id']}: needs both a true and a false ifBlock")
        elif not (blocks[0].get("blocks") or []):
            findings.append(f"{node['id']}: true ifBlock is empty (crashes the compiler)")
        expr = (node.get("data", {}).get("expression") or {}).get("code") or ""
        if "===" in expr or "!==" in expr:
            findings.append(f"{node['id']}: uses ===/!== in an if expression (use ==/!=)")

    # 4. response_json names must match the success end-node's response_value props
    declared_out = {f.get("name") for f in doc.get("response_json") or []}
    for node in nodes:
        data = node.get("data") or {}
        if node.get("type") == "end-node" and data.get("back_data_type") == "OutputParams":
            props = {
                p.get("prop") for p in (data.get("response_value") or {}).get("list") or []
            }
            if props - declared_out:
                findings.append(
                    f"{node['id']}: returns {sorted(props - declared_out)} "
                    "not declared in top-level response_json"
                )

    print(f"{path}: {len(nodes)} nodes")
    if findings:
        for f in findings:
            print(f"  FAIL  {f}")
        return 1
    print("  OK    all structural checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
```

- [ ] **Step 2: Run it against an existing known-good workflow to prove it does not false-positive**

Run:
```bash
cd "/Users/yunawinaya/Developer/BladeXfunctions"
python3 scripts/validate_workflow.py "Purchase Invoice/PIsaveWorkflow.json"
```
Expected: `OK    all structural checks passed`.

If it reports findings against PIsaveWorkflow, the validator is wrong, not the workflow — fix the validator before continuing. PIsaveWorkflow is deployed and working.

- [ ] **Step 3: Prove the validator actually catches a fault**

Run:
```bash
cd "/Users/yunawinaya/Developer/BladeXfunctions"
python3 - <<'EOF'
import json
d = json.load(open("Purchase Invoice/PIsaveWorkflow.json"))
blob = json.dumps(d).replace("{{node:code_pi_fillback", "{{node:code_does_not_exist")
open("/tmp/broken_workflow.json", "w").write(blob)
EOF
python3 scripts/validate_workflow.py /tmp/broken_workflow.json
```
Expected: exit 1, with `FAIL  selector references missing node: code_does_not_exist`.

- [ ] **Step 4: Report**

State that the validator passes a known-good workflow and fails a deliberately broken one. Do not commit.

---

### Task 2: Prove the server-side calculation matches the client

The workflow's calc node must produce byte-identical results to `SuduCreditReloadRecalculate.js`. Establish that with a differential test before embedding it in JSON.

**Files:**
- Create: `scripts/check_reload_calc.js`
- Read: `Sudu AI/Credit Reload/SuduCreditReloadRecalculate.js`

**Interfaces:**
- Produces: `computeReload(input)` — the canonical calculation, later pasted verbatim into the workflow's `code_cr_calc` node. Signature:
  `computeReload({reload_amount, exchange_rate, reload_type, monthly_remain_before, flex_remain_before}) -> {ai_credit_reload_amount, total_gross, total_tax_amount, total_amount, total_amount_myr, monthly_remain_after, flex_remain_after}`
  All fields are **numbers** here, so they can be compared field-by-field against the form handler's output, which is also numeric. The `toFixed` string conversion for persistence happens later, in the workflow's `code_cr_calc` node, *after* this arithmetic — do not move it into `computeReload` or the differential test will compare strings against numbers and fail spuriously.

- [ ] **Step 1: Write the differential test**

Create `scripts/check_reload_calc.js`:

```javascript
// Differential test: the workflow's calculation must agree with the form's.
const fs = require("fs");
const path = require("path");

const REPO = path.join(__dirname, "..");

// --- the canonical implementation, destined for code_cr_calc ---------------
const BASE_AMOUNT = 45;
const BASE_CREDIT = 10000;
const TAX_RATE = 0.08;

function computeReload(input) {
  const round = (value, dp) => parseFloat(parseFloat(value || 0).toFixed(dp));

  const reloadAmount = parseFloat(input.reload_amount) || 0;
  const exchangeRate = parseFloat(input.exchange_rate) || 1;
  const reloadType = input.reload_type;
  const subBefore = parseFloat(input.monthly_remain_before) || 0;
  const reloadBefore = parseFloat(input.flex_remain_before) || 0;

  const credits = Math.round((reloadAmount / BASE_AMOUNT) * BASE_CREDIT);

  const totalGross = round(reloadAmount, 2);
  const totalTax = round(totalGross * TAX_RATE, 2);
  const totalAmount = round(totalGross + totalTax, 2);
  const totalAmountMyr = round(totalAmount * exchangeRate, 2);

  let subAfter = subBefore;
  let reloadAfter = reloadBefore;

  if (reloadType === "Monthly Subscription") {
    subAfter = credits;
  } else if (reloadType === "Add On") {
    reloadAfter = reloadBefore + credits;
  }

  return {
    ai_credit_reload_amount: credits,
    total_gross: totalGross,
    total_tax_amount: totalTax,
    total_amount: totalAmount,
    total_amount_myr: totalAmountMyr,
    monthly_remain_after: subAfter,
    flex_remain_after: reloadAfter,
  };
}

// --- run the form's handler in a sandbox and capture its setData ------------
function runClientRecalc(values) {
  const body = fs.readFileSync(
    path.join(REPO, "Sudu AI/Credit Reload/SuduCreditReloadRecalculate.js"),
    "utf8",
  );
  let out = {};
  const ctx = { getValues: () => values, setData: (o) => Object.assign(out, o) };
  new Function(body).call(ctx);
  return out;
}

const CASES = [
  { reload_amount: 45, exchange_rate: 1, reload_type: "Monthly Subscription", monthly_remain_before: 3200, flex_remain_before: 500 },
  { reload_amount: 45, exchange_rate: 1, reload_type: "Add On", monthly_remain_before: 3200, flex_remain_before: 500 },
  { reload_amount: 90, exchange_rate: 4.72, reload_type: "Add On", monthly_remain_before: 3200, flex_remain_before: 500 },
  { reload_amount: 0, exchange_rate: 1, reload_type: "", monthly_remain_before: 3200, flex_remain_before: 500 },
  { reload_amount: 22.5, exchange_rate: 3.1416, reload_type: "Monthly Subscription", monthly_remain_before: 0, flex_remain_before: 0 },
];

const KEYS = [
  "ai_credit_reload_amount", "total_gross", "total_tax_amount",
  "total_amount", "total_amount_myr", "monthly_remain_after", "flex_remain_after",
];

let failures = 0;
for (const [i, c] of CASES.entries()) {
  const mine = computeReload(c);
  const theirs = runClientRecalc(c);
  for (const k of KEYS) {
    if (mine[k] !== theirs[k]) {
      failures++;
      console.log(`case ${i} key ${k}: workflow=${mine[k]} form=${theirs[k]}`);
    }
  }
}

console.log(failures === 0
  ? `PASS  ${CASES.length} cases agree across all ${KEYS.length} fields`
  : `FAIL  ${failures} mismatches`);
process.exit(failures === 0 ? 0 : 1);

module.exports = { computeReload };
```

- [ ] **Step 2: Run it**

Run:
```bash
cd "/Users/yunawinaya/Developer/BladeXfunctions"
node scripts/check_reload_calc.js
```
Expected: `PASS  5 cases agree across all 7 fields`.

If it fails, the workflow copy has drifted from the form's — reconcile before continuing. This script is the guard against exactly the `remain_sub_credit` / `monthly_remain_credit` class of bug.

- [ ] **Step 3: Report**

State the case count and that all fields agree. Do not commit.

---

### Task 3: Author the workflow JSON

**Files:**
- Create: `Sudu AI/Credit Reload/SuduCreditReloadSaveWorkflow.json`

**Interfaces:**
- Consumes: `computeReload` from Task 2 (pasted verbatim into `code_cr_calc`), validator from Task 1.
- Produces: workflow accepting `{ data: {...} }`, returning `{ id, reload_invoice_no }`.

- [ ] **Step 1: Write the workflow with a Python authoring script**

Author via Python rather than hand-writing JSON, so the nested `blocks` tree stays consistent. Create and run:

```python
#!/usr/bin/env python3
import json

SRC_CR   = "Sudu Credit Reload:Table:1983746316466860034"
SRC_CUST = "Sudu Customer:Table:1983717165334331394"
SRC_CURR = "Currency:Table:1902047936116805633"
SRC_RULE = "流水号规则表:Table:1994006139209117697"

_seq = [1700000000000]
def rid():
    _seq[0] += 2
    return _seq[0]

def leaf(prop="", operator="", value="", value_type="", label=""):
    i = rid()
    return {"id": i, "parentId": i - 1, "isTop": True, "prop": prop,
            "operator": operator, "valueType": value_type, "value": value,
            "type": "leaf", "level": 1, "propLabel": label,
            "valueLabel": "", "operatorLabel": operator}

def table(source, collection_id, rules_list):
    return {"source": source, "rules": {"collectionId": collection_id, "list": rules_list}}

def code_node(node_id, title, script, keys):
    return {"id": node_id, "type": "code-node", "data": {
        "language": "javascript", "code": "", "timeout": 30000,
        "title": title, "isValidator": True, "nodeName": title, "name": title,
        "script": {"type": "javascript", "code": script},
        "response_json": [
            {"key": f"k{node_id[:6]}{n}", "name": k, "title": "", "description": "",
             "bsonType": "any", "isExpand": False, "children": []}
            for n, k in enumerate(keys)
        ]}, "blocks": []}

def if_node(node_id, title, expr, true_blocks, false_blocks):
    return {"id": node_id, "type": "if", "data": {
        "title": title, "isValidator": True, "nodeName": title, "name": title,
        "condition_type": "Expression",
        "expression": {"type": "javascript", "code": expr}},
        "blocks": [
            {"id": f"ifBlock_{node_id}_true",  "type": "ifBlock",
             "data": {"title": "true"},  "blocks": true_blocks},
            {"id": f"ifBlock_{node_id}_false", "type": "ifBlock",
             "data": {"title": "false"}, "blocks": false_blocks}]}

def end_error(node_id, code, msg):
    return {"id": node_id, "type": "end-node", "data": {
        "title": "结束节点",
        "outputs": {"type": "object", "properties": {"result": {"type": "string"}}},
        "isValidator": True, "nodeName": "结束节点", "name": "结束节点",
        "back_data_type": "Default", "code": code,
        "msg": {"type": "javascript", "code": msg}}, "blocks": []}

# ---------------------------------------------------------------- determine
determine = code_node("code_cr_determine", "Determine Params", """
const input = {{workflowparams:data}} || {};

const mode = input.mode === 'headless' ? 'headless' : 'form';
const pageStatus = input.page_status || 'Add';

// Headless is always an Add. Edit only ever arrives from the form.
const isEdit = (mode === 'form' && pageStatus === 'Edit') ? 'Y' : 'N';
const isHeadless = mode === 'headless' ? 'Y' : 'N';

let errorCode = '';
if (isHeadless === 'Y') {
  const amount = parseFloat(input.reload_amount);
  if (!input.tenant_id || !input.reload_type || !amount || amount <= 0) {
    errorCode = '400';
  }
} else if (isEdit === 'N') {
  const amount = parseFloat(input.reload_amount);
  if (!input.tenant_2 || !input.reload_type || !amount || amount <= 0) {
    errorCode = '406';
  }
}

return { input, mode, isEdit, isHeadless, errorCode };
""".strip(), ["input", "mode", "isEdit", "isHeadless", "errorCode"])

# Two separate guards: the end-node's `code` is a static number, so a single
# guard cannot emit both 400 and 406.
guard_400 = if_node("if_cr_bad_headless", "Bad Headless Input ?",
    "'{{node:code_cr_determine.data.errorCode}}' == '400'",
    [end_error("end_cr_bad_headless", 400,
        "Headless payload requires tenant_id, reload_type and a reload_amount greater than zero.")],
    [])

guard_406 = if_node("if_cr_bad_form", "Bad Form Input ?",
    "'{{node:code_cr_determine.data.errorCode}}' == '406'",
    [end_error("end_cr_bad_form", 406,
        "Missing required fields: customer, reload type and a reload amount greater than zero are required.")],
    [])

# ------------------------------------------------------------ headless path
get_customer = {"id": "get_node_customer", "type": "get-node", "data": {
    "table_id": table(SRC_CUST, "1983717165334331394",
        [leaf("tenant_id2", "in", "{{node:code_cr_determine.data.input.tenant_id}}", "field", "Tenant")]),
    "condition": {}, "title": "Fetch Customer",
    "isValidator": True, "nodeName": "Fetch Customer", "name": "Fetch Customer"},
    "blocks": []}

search_rule = {"id": "search_node_serial", "type": "search-node", "data": {
    "table_id": table(SRC_RULE, "1994006139209117697",
        [leaf("is_default", "numberEqual", "1", "value", "Is Default")]),
    "condition": {}, "limit": 1, "title": "Fetch Default Serial Rule",
    "isValidator": True, "nodeName": "Fetch Default Serial Rule",
    "name": "Fetch Default Serial Rule"},
    "blocks": []}

lookup_parallel = {"id": "cond_all_cr_lookup", "type": "condition-all-node", "data": {
    "title": "Parallel Branch", "filter": {"list": []},
    "expression": {"code": ""}, "displayContent": "sdk.form.setCondition"},
    "blocks": [
        {"id": "cond_all_cr_lookup_item_cust", "type": "condition-all-node-item",
         "data": {"title": "Branch 1", "filter": {"list": [leaf()]},
                  "expression": {"code": "true", "type": "javascript"},
                  "displayContent": "sdk.form.setCondition", "isValidator": True,
                  "nodeName": "Branch 1", "name": "Branch 1",
                  "condition_type": "Expression"},
         "blocks": [get_customer]},
        {"id": "cond_all_cr_lookup_item_rule", "type": "condition-all-node-item",
         "data": {"title": "Branch 2", "filter": {"list": [leaf()]},
                  "expression": {"code": "true", "type": "javascript"},
                  "displayContent": "sdk.form.setCondition", "isValidator": True,
                  "nodeName": "Branch 2", "name": "Branch 2",
                  "condition_type": "Expression"},
         "blocks": [search_rule]}]}

guard_404 = if_node("if_cr_no_customer", "Customer Missing ?",
    "'{{node:get_node_customer.data.data.id}}' == ''",
    [end_error("end_cr_no_customer", 404,
        "No Sudu Customer found for the supplied tenant id.")],
    [])

get_currency = {"id": "get_node_currency", "type": "get-node", "data": {
    "table_id": table(SRC_CURR, "1902047936116805633",
        [leaf("id", "in", "{{node:get_node_customer.data.data.customer_currency_id}}",
              "field", "Primary Key ID")]),
    "condition": {}, "title": "Fetch Currency",
    "isValidator": True, "nodeName": "Fetch Currency", "name": "Fetch Currency"},
    "blocks": []}

headless_norm = code_node("code_cr_headless_norm", "Normalize Headless", """
const input = {{node:code_cr_determine.data.input}};
const customer = {{node:get_node_customer.data.data}} || {};
const currency = {{node:get_node_currency.data.data}} || {};
const rules = {{node:search_node_serial.data}} || [];

// '----' and 'MYR' both mean base currency - nothing to convert.
const code = currency.currency_code;
const isBase = !code || code === 'MYR' || code === '----';
const exchangeRate = isBase ? 1 : (currency.currency_buying_rate || 1);

const now = new Date();
const reloadDate = now.getFullYear() + '-' +
  String(now.getMonth() + 1).padStart(2, '0') + '-' +
  String(now.getDate()).padStart(2, '0');

const entry = {
  page_status: 'Add',
  reload_date: reloadDate,
  reload_invoice_no_type: rules[0] ? rules[0].id : '',
  tenant_2: input.tenant_id,
  reload_type: input.reload_type,
  reload_amount: input.reload_amount,
  currency_id: customer.customer_currency_id || null,
  exchange_rate: exchangeRate,
  exchange_rate_currency: isBase ? (code || '') : code,
  exchange_rate_myr: 'MYR',
  payment_status: 'Unpaid',
  payment_term: customer.customer_payment_term_id || null,
  customer_name: customer.customer_com_name || '',
  customer_reg_no: customer.customer_com_reg_no || '',
  customer_tax_no: customer.customer_tin_no || '',
  monthly_remain_before: customer.monthly_remain_credit || 0,
  flex_remain_before: customer.flex_remain_credit || 0,
};

return { entry };
""".strip(), ["entry"])

form_norm = code_node("code_cr_form_norm", "Normalize Form", """
const input = {{node:code_cr_determine.data.input}};

// The form already carries every column; strip only the transport field.
const entry = Object.assign({}, input);
delete entry.mode;

return { entry };
""".strip(), ["entry"])

headless_branch = if_node("if_cr_headless", "Headless ?",
    "'{{node:code_cr_determine.data.isHeadless}}' == 'Y'",
    [lookup_parallel, guard_404, get_currency, headless_norm],
    [form_norm])

# --------------------------------------------------------------------- calc
calc = code_node("code_cr_calc", "Calculate Amounts", """
// Single source of truth for Credit Reload pricing. Runs for BOTH modes so the
// form and the headless caller can never drift apart.
const BASE_AMOUNT = 45;
const BASE_CREDIT = 10000;
const TAX_RATE = 0.08;

let entry = {{node:code_cr_headless_norm.data.entry}} || {{node:code_cr_form_norm.data.entry}};

const round = (value, dp) => parseFloat(parseFloat(value || 0).toFixed(dp));

const reloadAmount = parseFloat(entry.reload_amount) || 0;
const exchangeRate = parseFloat(entry.exchange_rate) || 1;
const reloadType = entry.reload_type;
const subBefore = parseFloat(entry.monthly_remain_before) || 0;
const reloadBefore = parseFloat(entry.flex_remain_before) || 0;

const credits = Math.round((reloadAmount / BASE_AMOUNT) * BASE_CREDIT);

const totalGross = round(reloadAmount, 2);
const totalTax = round(totalGross * TAX_RATE, 2);
const totalAmount = round(totalGross + totalTax, 2);
const totalAmountMyr = round(totalAmount * exchangeRate, 2);

let subAfter = subBefore;
let reloadAfter = reloadBefore;

if (reloadType === 'Monthly Subscription') {
  subAfter = credits;
} else if (reloadType === 'Add On') {
  reloadAfter = reloadBefore + credits;
}

// Format allow-list. Every decimal column MUST appear here as a toFixed STRING -
// an unformatted float is rejected by the column's multipleOf constraint.
entry.reload_amount = totalGross.toFixed(2);
entry.total_gross = totalGross.toFixed(2);
entry.total_tax_amount = totalTax.toFixed(2);
entry.total_amount = totalAmount.toFixed(2);
entry.total_amount_myr = totalAmountMyr.toFixed(2);
entry.exchange_rate = exchangeRate.toFixed(6);

// Credit balances are integer columns.
entry.ai_credit_reload_amount = credits;
entry.monthly_remain_before = Math.round(subBefore);
entry.flex_remain_before = Math.round(reloadBefore);
entry.monthly_remain_after = Math.round(subAfter);
entry.flex_remain_after = Math.round(reloadAfter);

return { entry };
""".strip(), ["entry"])

CR_COLUMNS = [
    "reload_date", "reload_invoice_no", "reload_invoice_no_type", "tenant_2",
    "reload_type", "currency_id", "exchange_rate", "exchange_rate_currency",
    "exchange_rate_myr", "reload_amount", "ai_credit_reload_amount",
    "monthly_remain_before", "monthly_remain_after", "flex_remain_before",
    "flex_remain_after", "payment_status", "payment_term", "payment_method",
    "payment_date", "total_gross", "total_tax_amount", "total_amount",
    "total_amount_myr", "dealer_id", "agent_id", "customer_name",
    "customer_reg_no", "customer_tax_no", "address_name", "address_country_id",
    "adddress_state", "address_line_1", "address_line_2", "address_line_3",
    "address_line_4", "address_city", "address_postal_code", "address_phone",
    "address_phone2", "address_mobile", "address_email",
]

add_cr = {"id": "add_node_cr", "type": "add-node", "data": {
    "table_id": table(SRC_CR, "1983746316466860034", [leaf()]),
    "fields": [], "title": "Add Credit Reload",
    "isValidator": True, "nodeName": "Add Credit Reload", "name": "Add Credit Reload",
    "props": {"modelName": "", "list": [
        {"prop": c, "valueType": "field",
         "value": "{{node:code_cr_calc.data.entry.%s}}" % c,
         "operator": "", "valueLabel": "", "propLabel": c}
        for c in CR_COLUMNS]}},
    "blocks": []}

# --------------------------------------------------------------------- edit
payment_entry = code_node("code_cr_payment_entry", "Payment Entry", """
const input = {{node:code_cr_determine.data.input}};

// Edit exists only to settle payment - touch nothing else.
const entry = {
  id: input.id,
  payment_status: input.payment_status || '',
  payment_term: input.payment_term || null,
  payment_method: input.payment_method || '',
  payment_date: input.payment_date || '',
};

return { entry };
""".strip(), ["entry"])

update_cr = {"id": "update_node_cr", "type": "update-node", "data": {
    "table_id": table(SRC_CR, "1983746316466860034",
        [leaf("id", "in", "{{node:code_cr_payment_entry.data.entry.id}}",
              "field", "Primary Key ID")]),
    "fields": [], "condition": {}, "title": "Update Payment",
    "isValidator": True, "nodeName": "Update Payment", "name": "Update Payment",
    "props": {"modelName": "", "list": [
        {"prop": c, "valueType": "field",
         "value": "{{node:code_cr_payment_entry.data.entry.%s}}" % c,
         "operator": "", "valueLabel": "", "propLabel": c}
        for c in ["id", "payment_status", "payment_term",
                  "payment_method", "payment_date"]]}},
    "blocks": []}

get_cr = {"id": "get_node_cr", "type": "get-node", "data": {
    "table_id": table(SRC_CR, "1983746316466860034",
        [leaf("id", "in", "{{node:code_cr_payment_entry.data.entry.id}}",
              "field", "Primary Key ID")]),
    "condition": {}, "title": "Fetch Updated Reload",
    "isValidator": True, "nodeName": "Fetch Updated Reload",
    "name": "Fetch Updated Reload"},
    "blocks": []}

edit_branch = if_node("if_cr_edit", "Edit ?",
    "'{{node:code_cr_determine.data.isEdit}}' == 'Y'",
    [payment_entry, update_cr, get_cr],
    [headless_branch, calc, add_cr])

result = code_node("code_cr_result", "Map Result", """
const isEdit = '{{node:code_cr_determine.data.isEdit}}' === 'Y';
const added = {{node:add_node_cr.data}};
const fetched = {{node:get_node_cr.data.data}};

const row = isEdit ? fetched : (added && added[0]);

return {
  id: row ? row.id : '',
  reload_invoice_no: row ? row.reload_invoice_no : '',
};
""".strip(), ["id", "reload_invoice_no"])

end = {"id": "end", "type": "end-node", "data": {
    "isValidator": True, "title": "End Node", "nodeName": "End Node",
    "name": "End Node", "back_data_type": "OutputParams",
    "msg": {"type": "javascript", "code": ""},
    "response_value": {"list": [
        {"prop": "id", "propLabel": "id", "operator": "", "operatorLabel": "",
         "valueType": "field", "valueTypeLabel": "", "valueLabel": "",
         "value": "{{node:code_cr_result.data.id}}"},
        {"prop": "reload_invoice_no", "propLabel": "reload_invoice_no",
         "operator": "", "operatorLabel": "", "valueType": "field",
         "valueTypeLabel": "", "valueLabel": "",
         "value": "{{node:code_cr_result.data.reload_invoice_no}}"}]}},
    "blocks": []}

workflow = {
    "nodes": [
        {"id": "start", "type": "start-node",
         "data": {"isValidator": True, "title": "Start Node",
                  "nodeName": "Start Node", "name": "Start Node"}, "blocks": []},
        determine, guard_400, guard_406, edit_branch, result, end,
    ],
    "edges": [],
    "request_json": [
        {"key": "crdata01", "name": "data", "title": "Data", "description": "",
         "bsonType": "any", "isExpand": False, "children": []}],
    "response_json": [
        {"key": "crresp01", "name": "id", "title": "", "description": "",
         "bsonType": "string", "isExpand": False, "children": []},
        {"key": "crresp02", "name": "reload_invoice_no", "title": "",
         "description": "", "bsonType": "string", "isExpand": False,
         "children": []}],
    "config": {},
}

path = "Sudu AI/Credit Reload/SuduCreditReloadSaveWorkflow.json"
with open(path, "w", encoding="utf-8") as fh:
    json.dump(workflow, fh, ensure_ascii=False, indent=2)
print("written", path)
```

- [ ] **Step 2: Validate the workflow**

Run:
```bash
cd "/Users/yunawinaya/Developer/BladeXfunctions"
python3 scripts/validate_workflow.py "Sudu AI/Credit Reload/SuduCreditReloadSaveWorkflow.json"
```
Expected: `OK    all structural checks passed`.

- [ ] **Step 3: Syntax-check every embedded code node**

Placeholders are not valid JS on their own, so substitute them with a literal before parsing:

```bash
cd "/Users/yunawinaya/Developer/BladeXfunctions"
python3 - <<'EOF' > /tmp/cr_wf_code.json
import json, re
d = json.load(open("Sudu AI/Credit Reload/SuduCreditReloadSaveWorkflow.json"))
out = []
def walk(n):
    if isinstance(n, dict):
        if n.get("type") == "code-node":
            code = n["data"]["script"]["code"]
            out.append({"id": n["id"], "src": re.sub(r"\{\{[^}]+\}\}", "null", code)})
        for v in n.values(): walk(v)
    elif isinstance(n, list):
        for v in n: walk(v)
walk(d["nodes"])
print(json.dumps(out))
EOF
node -e '
const b = require("/tmp/cr_wf_code.json"); let bad = 0;
for (const x of b) { try { new Function(x.src) } catch (e) { bad++; console.log("SYNTAX", x.id, e.message) } }
console.log(`parsed ${b.length} code nodes, ${bad} syntax errors`);
process.exit(bad === 0 ? 0 : 1);'
```
Expected: `parsed 7 code nodes, 0 syntax errors`.

- [ ] **Step 4: Confirm the calc node still matches the form**

The calc node's body was copied from Task 2's `computeReload`. Re-run the differential test to confirm nothing was mangled in transit:

```bash
cd "/Users/yunawinaya/Developer/BladeXfunctions"
node scripts/check_reload_calc.js
```
Expected: `PASS  5 cases agree across all 7 fields`.

- [ ] **Step 5: Report**

State node count, validator result, code-node parse result. Do not commit.

---

### Task 4: Client-side wiring

**Files:**
- Modify: `Sudu AI/Credit Reload/SuduCreditReloadFullJSON.json` (`mounted` handler; `button_save.onClick`)
- Regenerate: `Sudu AI/Credit Reload/SuduCreditReloadOnMounted.js`
- Create (generated): `Sudu AI/Credit Reload/SuduCreditReloadSave.js`

**Interfaces:**
- Consumes: the workflow from Task 3, whose deployed id is pasted into the save handler.
- Produces: `page_status` populated on the form; `button_save.onClick` → new eventScript key `svw3k2ta`.

- [ ] **Step 1: Add page_status to the mounted handler**

`page_status` is a hidden input defaulting to `""` and nothing sets it, so the workflow's Edit/Add branch would never resolve. In `SuduCreditReloadOnMounted.js`'s `setTimeout` body, immediately after `await setupInvoiceRule();`, insert:

```javascript
    // The save workflow branches on this - it must always be populated.
    const pageStatus = this.isAdd
      ? 'Add'
      : this.isEdit
        ? 'Edit'
        : this.isView
          ? 'View'
          : '';
    this.setData({ page_status: pageStatus });
```

- [ ] **Step 2: Write the save handler**

Create the handler body (it will be written into the JSON in Step 3):

```javascript
// Replace with the deployed workflow id.
const CREDIT_RELOAD_SAVE_WORKFLOW_ID = 'REPLACE_WITH_WORKFLOW_ID';

(async () => {
  try {
    this.showLoading('Saving Credit Reload...');

    const data = this.getValues();
    data.mode = 'form';

    await this.runWorkflow(
      CREDIT_RELOAD_SAVE_WORKFLOW_ID,
      { data },
      () => {
        this.$message.success(this.isEdit ? 'Update successfully' : 'Add successfully');
        this.hideLoading();

        if (this.parentGenerateForm) {
          this.parentGenerateForm.$refs.SuPageDialogRef.hide();
          this.parentGenerateForm.refresh();
        }
      },
      (error) => {
        this.hideLoading();
        console.error('Credit Reload save failed', error);
        this.$message.error(error?.data?.msg || 'An error occurred');
      },
    );
  } catch (error) {
    this.hideLoading();
    console.error('Credit Reload save failed', error);
    this.$message.error(error?.data?.msg || 'An error occurred');
  }
})();
```

- [ ] **Step 3: Write both into the form JSON**

Use exact-string replacement so the rest of the 4900-line file stays byte-identical — do NOT `json.dump` the whole document, which would reformat everything. Follow the pattern already used in this repo:

```python
import json, re

p = "Sudu AI/Credit Reload/SuduCreditReloadFullJSON.json"
raw = open(p, encoding="utf-8").read()
d = json.loads(raw)

PAGE_STATUS_SNIPPET = """
    // The save workflow branches on this - it must always be populated.
    const pageStatus = this.isAdd
      ? 'Add'
      : this.isEdit
        ? 'Edit'
        : this.isView
          ? 'View'
          : '';
    this.setData({ page_status: pageStatus });
"""

SAVE_FUNC = r'''// Replace with the deployed workflow id.
const CREDIT_RELOAD_SAVE_WORKFLOW_ID = 'REPLACE_WITH_WORKFLOW_ID';

(async () => {
  try {
    this.showLoading('Saving Credit Reload...');

    const data = this.getValues();
    data.mode = 'form';

    await this.runWorkflow(
      CREDIT_RELOAD_SAVE_WORKFLOW_ID,
      { data },
      () => {
        this.$message.success(this.isEdit ? 'Update successfully' : 'Add successfully');
        this.hideLoading();

        if (this.parentGenerateForm) {
          this.parentGenerateForm.$refs.SuPageDialogRef.hide();
          this.parentGenerateForm.refresh();
        }
      },
      (error) => {
        this.hideLoading();
        console.error('Credit Reload save failed', error);
        this.$message.error(error?.data?.msg || 'An error occurred');
      },
    );
  } catch (error) {
    this.hideLoading();
    console.error('Credit Reload save failed', error);
    this.$message.error(error?.data?.msg || 'An error occurred');
  }
})();'''

# 1. mounted: insert the page_status block right after setupInvoiceRule()
old = [e for e in d["config"]["eventScript"] if e["key"] == "mounted"][0]["func"]
anchor = "    await setupInvoiceRule();\n"
assert old.count(anchor) == 1, "mounted anchor not found"
new = old.replace(anchor, anchor + PAGE_STATUS_SNIPPET)
enc = json.dumps(old, ensure_ascii=False)
assert raw.count(enc) == 1
raw = raw.replace(enc, json.dumps(new, ensure_ascii=False))

# 2. append the save handler as a new eventScript entry.
#    The last entry is the exchange-rate handler; append after its closing brace.
last = [e for e in d["config"]["eventScript"] if e["key"] == "cpu5a6hu"][0]
last_block = (
    '      {\n'
    '        "key": "cpu5a6hu",\n'
    f'        "name": {json.dumps(last["name"])},\n'
    f'        "func": {json.dumps(last["func"], ensure_ascii=False)},\n'
    '        "type": "js"\n'
    '      }'
)
assert raw.count(last_block) == 1, "last eventScript entry not found verbatim"

save_block = (
    '      {\n'
    '        "key": "svw3k2ta",\n'
    '        "name": "save",\n'
    f'        "func": {json.dumps(SAVE_FUNC, ensure_ascii=False)},\n'
    '        "type": "js"\n'
    '      }'
)
raw = raw.replace(last_block, last_block + ",\n" + save_block)

# 3. wire button_save.onClick. The events block always precedes its model key.
m = re.search(r'"model": "button_save"', raw)
assert m, "button_save model not found"
ev = raw.rfind('"events": {', 0, m.start())
end = raw.index("}", ev)
block = raw[ev:end]
assert '"onClick": ""' in block, f"button_save onClick already set: {block!r}"
raw = raw[:ev] + block.replace('"onClick": ""', '"onClick": "svw3k2ta"', 1) + raw[end:]

open(p, "w", encoding="utf-8").write(raw)
json.loads(raw)
print("form JSON updated and still valid")
```

- [ ] **Step 4: Verify the form JSON**

Run:
```bash
cd "/Users/yunawinaya/Developer/BladeXfunctions"
python3 - <<'EOF'
import json, re
d = json.load(open("Sudu AI/Credit Reload/SuduCreditReloadFullJSON.json"))
keys = {e["key"] for e in d["config"]["eventScript"]}
models, refs = set(), set()
def w(n):
    if isinstance(n, dict):
        if isinstance(n.get("model"), str) and n["model"]: models.add(n["model"])
        ev = n.get("events")
        if isinstance(ev, dict):
            for k, v in ev.items():
                if isinstance(v, str) and v.strip(): refs.add(v)
        for v in n.values(): w(v)
    elif isinstance(n, list):
        for v in n: w(v)
w(d["list"])
print("button_save wired:", any(
    e["key"] == "svw3k2ta" for e in d["config"]["eventScript"]))
print("dangling refs:", sorted(refs - keys))
src = "\n".join(e["func"] for e in d["config"]["eventScript"] if e.get("func"))
print("mounted sets page_status:", "page_status" in src)
EOF
```
Expected: `button_save wired: True`, `dangling refs: ['3ivhvcbg', 'br9ru0le', 'iqydixjo']` (the three pre-existing invoice-no ones, unchanged), `mounted sets page_status: True`.

- [ ] **Step 5: Regenerate the .js files from the JSON**

Files are generated from the JSON so they cannot drift. Extend the existing extraction map with `'svw3k2ta': 'SuduCreditReloadSave.js'` and re-run it for all eight handlers, then assert each file matches its `func` byte-for-byte.

- [ ] **Step 6: Report**

State that `page_status` is populated, `button_save` is wired, all files match the JSON, and that the workflow id is still the `REPLACE_WITH_WORKFLOW_ID` placeholder. Do not commit.

---

### Task 5: Final verification sweep

**Files:** none modified.

- [ ] **Step 1: Run every check**

```bash
cd "/Users/yunawinaya/Developer/BladeXfunctions"
python3 scripts/validate_workflow.py "Sudu AI/Credit Reload/SuduCreditReloadSaveWorkflow.json" && \
node scripts/check_reload_calc.js && \
python3 -c "import json; json.load(open('Sudu AI/Credit Reload/SuduCreditReloadFullJSON.json')); print('form JSON valid')"
```
Expected: all three pass.

- [ ] **Step 2: Write the deployment checklist**

Report to the user, listing in order:
1. Import `SuduCreditReloadSaveWorkflow.json` into the platform.
2. Copy the resulting workflow id into `CREDIT_RELOAD_SAVE_WORKFLOW_ID` in `SuduCreditReloadSave.js` **and** in the form JSON's `svw3k2ta` handler.
3. Re-import the form JSON.
4. Run the on-platform test matrix from the spec's Verification section — form Add, form Edit, headless success, headless 404, headless 400 — and confirm the Sudu Customer row is unchanged in every case.

---

## Notes carried forward from the spec

- **Document-only has a visible consequence.** Since the workflow never writes back to Sudu Customer, a second reload for the same customer reads the same `*_before` as the first. Confirm the consumer that applies balances exists.
- **`exchange_rate` is stored as a `toFixed(6)` string** (`"4.720000"`). Deliberate — it is what avoids `multipleOf` rejection — but anything doing arithmetic on that column must parse it first.
- **Headless has no authorization check.** A caller can create a reload against any tenant it names. If that entry point is externally reachable it needs an auth gate that is not in this design.
- The three dangling invoice-no handler refs remain outstanding.

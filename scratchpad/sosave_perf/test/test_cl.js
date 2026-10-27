// CREDIT_LIMIT_CHECK v15 (get-node) against the build (guard + sql + row): the credit check must answer the same for the
// same customer, whatever shape the sql-node hands back (JSON column as text or parsed, decimals as numbers or strings,
// NULL columns left out). Synthetic customers.
//   node scratchpad/sosave_perf/test/test_cl.js
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const nodesOf = (file) => {
  const wf = JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
  const all = {};
  const walk = (ns) => ns.forEach((n) => { all[n.id] = n; walk(n.blocks || []); });
  walk(wf.nodes);
  return all;
};
const fill = (code, values) => Object.entries(values).reduce((c, [token, v]) => c.split(token).join(v), code);
const exec = (code) => new Function(code)();

const OLD = nodesOf("base/CREDIT_LIMIT_CHECK.v15.json");
const NEW = nodesOf("out/CREDIT_LIMIT_CHECK.json");
const codeOf = (nodes, id) => nodes[id].data.script.code;

// the v15 path: the get-node's record (control_type_list parsed, decimals as numbers), the if on its count
const oldRun = (record, params) => {
  if (!record) return { result: "failed", message: "Customer Not Found" };
  return exec(fill(codeOf(OLD, "code_node_F3445jkq"), {
    "{{node:get_node_GerIauhj.data.data}}": JSON.stringify(record),
    "{{workflowparams:total}}": JSON.stringify(params.total),
    "{{workflowparams:document_type}}": JSON.stringify(params.document_type),
  }));
};
// the build's path: guard -> (the SQL, simulated by the caller as `sqlRows`) -> row -> the if on its count -> the check
const newRun = (sqlRowsFor, params, tenant = "012345") => {
  const g = exec(fill(codeOf(NEW, "code_node_CLguard"), {
    "{{workflowparams:customer_id}}": JSON.stringify(params.customer_id),
    "{{system:tenantId}}": JSON.stringify(tenant),
  }));
  const r = exec(fill(codeOf(NEW, "code_node_CLrow"), { "{{node:sql_node_CLcust.data}}": JSON.stringify(sqlRowsFor(g)) }));
  if (!(r.count > 0)) return { guard: g, out: { result: "failed", message: "Customer Not Found" } };
  return { guard: g, out: exec(fill(codeOf(NEW, "code_node_F3445jkq"), {
    "{{node:code_node_CLrow.data.data}}": JSON.stringify(r.data),
    "{{workflowparams:total}}": JSON.stringify(params.total),
    "{{workflowparams:document_type}}": JSON.stringify(params.document_type),
  })) };
};

const ct = (type, doc) => ({ control_type: type, document_type: doc, exceed_credit_limit: "block", exceed_overdue_limit: "unblock" });
const customers = {
  limit5: { id: "2114750549146021890", control_type_list: [ct(3, "Sales Orders"), ct(6, "Quotations"), ct(2, "Goods Delivery")], outstanding_balance: 0, overdue_inv_total_amount: 0, overdue_limit: 0, customer_credit_limit: 5 },
  overdue: { id: "2069707542149021698", control_type_list: [ct(2, "Sales Orders"), ct(5, "Sales Invoices")], outstanding_balance: 1200.5, overdue_inv_total_amount: 300.25, overdue_limit: 100, customer_credit_limit: 10000 },
  suspended: { id: "2069702586511736834", control_type_list: [ct(9, "Sales Orders")], outstanding_balance: 0, overdue_inv_total_amount: 0, overdue_limit: 0, customer_credit_limit: 0 },
  ignore: { id: "2065344606585597954", control_type_list: [ct(0, "Sales Orders"), ct(8, "Quotations")], outstanding_balance: 50, overdue_inv_total_amount: 10, overdue_limit: 5, customer_credit_limit: 40 },
  noTypes: { id: "2110633159748530188", control_type_list: null, outstanding_balance: 0, overdue_inv_total_amount: 0, overdue_limit: 0, customer_credit_limit: 0 },
  emptyTypes: { id: "2110633159748530191", control_type_list: [], outstanding_balance: 3, overdue_inv_total_amount: 0, overdue_limit: 0, customer_credit_limit: 2 },
};
// what the sql-node may hand back for a record
const shapes = {
  "json as text, decimals as numbers": (c) => Object.assign({}, c, { control_type_list: c.control_type_list === null ? undefined : JSON.stringify(c.control_type_list) }),
  "json as text, decimals as strings": (c) => {
    const o = { id: c.id };
    if (c.control_type_list !== null) o.control_type_list = JSON.stringify(c.control_type_list);
    for (const k of ["outstanding_balance", "overdue_inv_total_amount", "overdue_limit", "customer_credit_limit"]) o[k] = Number(c[k]).toFixed(2);
    return o;
  },
  "json parsed, decimals as numbers": (c) => Object.assign({}, c, c.control_type_list === null ? { control_type_list: undefined } : {}),
};
const strip = (o) => JSON.parse(JSON.stringify(o)); // NULL columns are left out of a sql-node's row

let fail = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : "  " + detail}`);
  if (!ok) fail++;
};

for (const [cname, c] of Object.entries(customers)) {
  const failBefore = fail;
  for (const doc of ["Sales Orders", "Quotations", "Goods Delivery", "Sales Invoices"]) {
    for (const total of [0, 3, 12, 12.8, "12", 99999]) {
      const params = { customer_id: c.id, total, document_type: doc };
      const want = oldRun(c, params);
      for (const [sname, shape] of Object.entries(shapes)) {
        const got = newRun((g) => (g.customerIdSql === c.id && g.tenantIdSql === "012345" ? [strip(shape(c))] : []), params).out;
        const same = JSON.stringify(got) === JSON.stringify(want);
        if (!same) check(`${cname} / ${doc} / total ${JSON.stringify(total)} / ${sname}`, false, `\n   v15: ${JSON.stringify(want)}\n   new: ${JSON.stringify(got)}`);
      }
    }
  }
  const bad = fail - failBefore;
  fail = failBefore;
  check(`${cname}: every document type, total and SQL row shape answers as v15`, bad === 0, `${bad} case(s) differ`);
}

// a text total with thousands separators is the amount it shows ("1,234.50" is 1234.5; v15 read it as 1)
{
  let bad = 0;
  for (const c of Object.values(customers)) {
    for (const doc of ["Sales Orders", "Goods Delivery"]) {
      for (const [text, value] of [["1,234.50", 1234.5], ["12,345", 12345], [" 1,000,000.00 ", 1000000]]) {
        const got = newRun((g) => (g.customerIdSql === c.id ? [strip(shapes["json as text, decimals as numbers"](c))] : []),
          { customer_id: c.id, total: text, document_type: doc }).out;
        const want = oldRun(c, { customer_id: c.id, total: value, document_type: doc });
        if (JSON.stringify(got) !== JSON.stringify(want)) bad++;
      }
    }
  }
  check("a total of \"1,234.50\" is checked as 1234.5", bad === 0, `${bad} case(s) read it otherwise`);
}

// not found: no row -> the same answer as the get-node's count 0
check("customer not found -> Customer Not Found", JSON.stringify(newRun(() => [], { customer_id: "1", total: 1, document_type: "Sales Orders" }).out) === JSON.stringify(oldRun(null, {})), "");
check("sql answers null -> Customer Not Found", newRun(() => null, { customer_id: "1", total: 1, document_type: "Sales Orders" }).out.message === "Customer Not Found", "");
check("sql answers one object (not a list)", newRun(() => strip(shapes["json as text, decimals as numbers"](customers.limit5)), { customer_id: customers.limit5.id, total: 12, document_type: "Sales Orders" }).out.result === "failed", "");
check("malformed control_type_list -> treated as none", newRun(() => [{ id: "1", control_type_list: "[{bad", outstanding_balance: 0, overdue_inv_total_amount: 0, overdue_limit: 0, customer_credit_limit: 0 }], { customer_id: "1", total: 1, document_type: "Sales Orders" }).out.message.startsWith("No control type defined for customer"), "");

// the guard: only digits reach the SQL, as the id and as the tenant
const guardOf = (cid, tenant = "012345") => newRun(() => [], { customer_id: cid, total: 0, document_type: "x" }, tenant).guard;
for (const [tenant, want] of [["012345", "012345"], ["000000", "000000"], ["07' OR '1", "0"], ["", "0"], [null, "0"]]) {
  const g = guardOf("1", tenant);
  check(`guard tenant ${JSON.stringify(tenant)} -> ${JSON.stringify(g.tenantIdSql)}`, g.tenantIdSql === want, `want ${want}`);
}
const G = [
  ["2114750549146021890", "2114750549146021890"],
  [" 2114750549146021890 ", "2114750549146021890"],
  [2069707542149021, "2069707542149021"],
  [["2114750549146021890"], "2114750549146021890"],
  ["1 OR 1=1", "0"],
  ["1; DROP TABLE customer", "0"],
  ["", "0"],
  [null, "0"],
];
for (const [cid, wantId] of G) {
  const g = guardOf(cid);
  check(`guard ${JSON.stringify(cid)} -> ${g.customerIdSql}`, g.customerIdSql === wantId, `want ${wantId}`);
}
// the SQL the node will run takes only the guard's values, and filters as the get-node did
const sql = NEW.sql_node_CLcust.data.script.code;
const tokens = sql.match(/\{\{[^}]+\}\}/g);
check(`SQL placeholders: ${tokens.join(", ")}`, tokens.every((t) => t.startsWith("{{node:code_node_CLguard.data.")), "");
check("SQL is scoped to the session tenant", /c\.tenant_id = '\{\{node:code_node_CLguard\.data\.tenantIdSql\}\}'/.test(sql), "");
check("SQL leaves deleted customers out (as v15's get-node)", /c\.is_deleted = 0/.test(sql), "");
const doc = JSON.parse(fs.readFileSync(path.join(ROOT, "out/CREDIT_LIMIT_CHECK.json"), "utf8"));
// the platform passes a fractional total through an int param (dev A/B and 93 prod checks, 10-27): the contract stays
const totalParam = doc.request_json.find((f) => f.name === "total");
check(`request total keeps its declared type (${totalParam.bsonType})`, totalParam.bsonType === "int", "");
// declared outputs: every key a node returns is declared (else the platform drops it)
for (const id of ["code_node_CLguard", "code_node_CLrow"]) {
  const declared = NEW[id].data.response_json.map((f) => f.name).sort().join(",");
  const returned = Object.keys(id === "code_node_CLguard" ? guardOf("1") : exec(fill(codeOf(NEW, id), { "{{node:sql_node_CLcust.data}}": "[]" }))).sort().join(",");
  check(`${id} declares ${declared}`, declared === returned, `returns ${returned}`);
}
const sqlCols = NEW.sql_node_CLcust.data.response_json.map((f) => f.name).sort().join(",");
check(`sql_node_CLcust declares every selected column (${sqlCols})`, sqlCols === "control_type_list,customer_credit_limit,id,outstanding_balance,overdue_inv_total_amount,overdue_limit", "");

console.log(fail ? `${fail} FAILED` : "all passed");
process.exit(fail ? 1 : 0);

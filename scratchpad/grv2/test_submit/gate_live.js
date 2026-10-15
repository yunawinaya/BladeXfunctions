// The SUBMIT gate node as the builder assembles it (gate_code()), its tokens substituted the way the platform does, run on a
// recorded SUBMIT read set + the stored receipt as the form. usage: TZ=Asia/Kuala_Lumpur node gate_live.js <submit_sql.json> [Add|Edit] [mutate]
const fs = require("fs");
const cp = require("child_process");
const [file, page = "Edit", mutate = ""] = process.argv.slice(2);
const R = JSON.parse(fs.readFileSync(file, "utf8"));
const body = cp.execFileSync("python3", ["-I", "-c", "import sys; sys.path.insert(0, '.'); import build_grv2 as B; print(B.gate_code())"], { cwd: __dirname + "/..", encoding: "utf8", maxBuffer: 1 << 28 });
const P = (t) => JSON.parse(String(t).replace(/"(?:[^"\\]|\\.)*"|-?\d{16,}(?![.\deE])/g, (m) => (m[0] === '"' ? m : '"' + m + '"')));
const rows = (k) => (R[k] || []).map((r) => (typeof r.j === "string" ? P(r.j) : r.j));
const hdr = rows("hdr")[0];
const lines = rows("lines");
const form = Object.assign({}, hdr, { page_status: page, table_gr: lines.map((l) => Object.assign({}, l)) });
if (page === "Add") { delete form.id; form.table_gr.forEach((l) => delete l.id); form.gr_no = ""; }
if (mutate === "zero") form.table_gr[0].received_qty = 0;
if (mutate === "over") form.table_gr[0].received_qty = 1e9;
if (mutate === "negative") form.table_gr[0].unit_price = -1;
const vals = {
  "node:code_node_RSguard.data": { operation: "SUBMIT", pageStatus: page, grId: page === "Edit" ? hdr.id : "0", tenantId: "000000", key: "GRC:test:1", answers: { continueZero: "" } },
  "node:code_node_RSentry.data": { grStatus: "Draft", organizationId: hdr.organization_id, plantId: hdr.plant_id },
  "node:code_node_RSkeys.data": { ok: "YES", lineCount: lines.length },
  "node:sql_node_RSitems.data": R.items, "node:sql_node_RSpol.data": R.pol, "node:sql_node_RSpoh.data": R.poh, "node:sql_node_RSsetup.data": R.setup,
  "workflowparams:form": form,
};
const src = body.replace(/\{\{([^}]+)\}\}/g, (m, k) => { if (!(k in vals)) throw new Error("no value for " + k); return JSON.stringify(vals[k]); });
const out = new Function(src)();
console.log(page, mutate || "-", "->", out.route, out.code, String(out.message).slice(0, 160), "| lines stored:", ((out.allData || {}).table_gr || []).length, "| gr_status:", out.grStatus,
  "| previous_status:", (out.allData || {}).previous_status);

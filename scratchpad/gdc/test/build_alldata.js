// build_alldata.js <tenant> <gd_id> <out.json> [saveAs]: GOODS_DELIVERY's request for a list-style completion of the
// stored GD (allData = the stored GD in the get-node shape, PREPARE's hdr + lines reads through the adapter)
const fs = require("fs"), vm = require("vm"), cp = require("child_process");
const R = "/Users/yunawinaya/Developer/BladeXfunctions/";
const [tenant, gdId, out, saveAs] = process.argv.slice(2);
const live = (sql) => JSON.parse(cp.execFileSync(R + ".dbtools/db", ["--dev", "--json", "--limit", "100000", sql], { maxBuffer: 1 << 30, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
const sb = { JSON, Math, Number, String, Array, Object, Set, Map, RegExp, parseFloat };
vm.createContext(sb);
vm.runInContext(fs.readFileSync(R + "scratchpad/gdc/code/prepare/adapter.js", "utf8") + "\nthis.gcAdapt = gcAdapt;", sb);
const wf = JSON.parse(fs.readFileSync(R + "Goods Delivery/CompleteV2/GD_COMPLETE_SUBMIT.json", "utf8"));
const find = (nodes, id) => { for (const n of nodes || []) { if (n.id === id) return n; const x = find(n.blocks, id); if (x) return x; } return null; };
const org = live("SELECT organization_id FROM goods_delivery WHERE tenant_id = '" + tenant + "' AND id = " + gdId)[0].organization_id;
const fill = (id) => find(wf.nodes, id).data.script.code.replace(/\{\{node:code_node_GSentry\.data\.tenantId\}\}/g, tenant)
  .replace(/\{\{node:code_node_GSentry\.data\.gdId\}\}/g, gdId).replace(/\{\{node:code_node_GSentry\.data\.organizationId\}\}/g, org);
const gd = sb.gcAdapt({ organizationId: org, hdr: live(fill("sql_node_GShdr")), lines: live(fill("sql_node_GSlines")) }).gd.data;
// REVERT: GD_REVERT_COMPLETED's request, as the list's bulk revert sends it
const req = saveAs === "REVERT" ? { allData: gd, pageStatus: "Edit" }
  : { allData: gd, saveAs: saveAs || "Completed", pageStatus: "Edit", needCL: "required", isForceComplete: "", continueZero: "", auto_gr_confirmed: "", auto_gr_skip: "", auto_si_confirmed: "", auto_si_skip: "" };
fs.writeFileSync(out, JSON.stringify(req));
console.log(gd.delivery_no, gd.gd_status, (gd.table_gd || []).length, "lines ->", out);

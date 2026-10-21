// Runs the changed code nodes of the drafts with stand-in node outputs. Usage: node test_js.js <out dir>
const fs = require("fs");
const path = require("path");
const out = process.argv[2];
const find = (o, id) => {
  if (o && typeof o === "object") {
    if (o.id === id) return o;
    for (const v of Object.values(o)) { const r = find(v, id); if (r) return r; }
  }
  return null;
};
const run = (code, subs) => {
  let c = code;
  for (const [k, v] of Object.entries(subs)) c = c.split(k).join(JSON.stringify(v));
  return new Function("console", c)({ log() {} });
};
let fails = 0;
const check = (name, got, want) => {
  const ok = want instanceof RegExp ? want.test(got) : got === want;
  if (!ok) fails++;
  console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : "  got: " + got));
};

const sub = JSON.parse(fs.readFileSync(path.join(out, "PACKING_ASYNC_SUBMIT.json")));
const decide = find(sub, "code_node_KSdecide").data.script.code;
const guard = { organizationId: "1", packingId: "9", idempotencyKey: "k", userName: "u", patch: {} };
const row = { id: "9", is_deleted: "0", organization_id: "1", packing_status: "Created", gd_found: "5", gd_status: "Created", delivery_no: "GD/1", unpicked: "0", bad_items: "0", stray_items: "0", db_now: "2026-10-21 12:00:00" };
const d = (extra) => run(decide, { "{{node:code_node_KSguard.data}}": guard, "{{node:sql_node_KSfacts.data}}": Object.assign({}, row, extra) });
check("submit: no SO job -> CREATE", d({}).route, "CREATE");
check("submit: SAVE_SO queued -> REJECT", d({ so_job: "77|QUEUED|SO/LSH-50" }).route, "REJECT");
check("submit: queued message", d({ so_job: "77|QUEUED|SO/LSH-50" }).result_message, /^Sales Order SO\/LSH-50 is being saved in the background \(job 77\)/);
check("submit: review message", d({ so_job: "77|REQUIRES_REVIEW|SO/LSH-50" }).result_message, /^The background save of Sales Order SO\/LSH-50 stopped half-way and is under review \(job 77\)/);
check("submit: no SO number", d({ so_job: "77|QUEUED|" }).result_message, /^Sales Order of this Goods Delivery is being saved/);
check("submit: GD job still wins first", d({ other_job: "60|EDIT_GD|QUEUED", so_job: "77|QUEUED|SO/1" }).result_message, /^Goods Delivery GD\/1 is being saved/);
check("submit: same key returns the job", d({ key_job: "88|QUEUED", so_job: "77|QUEUED|SO/1" }).route, "RETURN");

const ps = JSON.parse(fs.readFileSync(path.join(out, "PackingSaveWorkflowJSON.json")));
const chk = find(ps, "code_node_PkPickChk").data.script.code;
const gd = { gd_status: "Created", delivery_no: "GD/1", table_gd: [{ material_id: "m", gd_qty: 1, picking_status: "Completed" }] };
const p = (job) => run(chk, { "{{node:sql_node_PkJobChk.data}}": job ? { open_job: job } : [], "{{node:get_node_PkPickGd.data.data}}": gd });
check("save: no job -> passes", p(null).notPicked, 0);
check("save: SAVE_SO queued", p("77|SAVE_SO|QUEUED").pickedMessage, /^A Sales Order of this Goods Delivery is being saved in the background \(SAVE_SO job 77\)/);
check("save: SAVE_SO review", p("77|SAVE_SO|REQUIRES_REVIEW").pickedMessage, /^The background save of a Sales Order of this Goods Delivery stopped half-way and is under review \(SAVE_SO job 77\)/);
check("save: GD job wording unchanged", p("60|EDIT_GD|QUEUED").pickedMessage, "This Goods Delivery is being saved in the background (EDIT_GD job 60). Wait a moment, then try again. Nothing was saved.");
check("save: GD review wording unchanged", p("60|COMPLETE_GD|REQUIRES_REVIEW").pickedMessage, "The background save of this Goods Delivery stopped half-way and is under review (COMPLETE_GD job 60): please contact support. Nothing was saved.");
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);

// Small Cycle regression in one run: every builder (written to the repo; each asserts its own invariants), then every test.
//   node scratchpad/iasc/check_all.js            (add --mutants to run the mutation suites too, ~3 min)
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const I = __dirname;
// IA_SAVE v13 (= the deployed v25) is the base of v14 (the output split, plan 10-27): built into a temp folder, the repo holds v14
const V13 = fs.mkdtempSync(path.join(os.tmpdir(), "sc-v13-"));
const V13_FILE = path.join(V13, "IA_SAVE.json");
// IA_V2_SUBMIT v4 (= the deployed v13) likewise the base of v5 (the output split's gate, phase 1), v5 (= the deployed v14) the base of v6
// (phase 2: the background completion receives a split)
const V4 = fs.mkdtempSync(path.join(os.tmpdir(), "sc-v4-"));
const V5 = fs.mkdtempSync(path.join(os.tmpdir(), "sc-v5-"));
// IA_SAVE v14 (= the deployed v26) and IA_V2_SUBMIT v6 (= the deployed v15) are the bases of v15 / v7 (the IA transfer request guard,
// ENH-20261027-001): built into temp folders, the repo holds v15 / v7
const V14 = fs.mkdtempSync(path.join(os.tmpdir(), "sc-v14-"));
const V14_FILE = path.join(V14, "IA_SAVE.json");
const V6 = fs.mkdtempSync(path.join(os.tmpdir(), "sc-v6-"));
const V6_FILE = path.join(V6, "IA_V2_SUBMIT.json");
// IA_SAVE v15 (= the deployed v27) and IA_V2_SUBMIT v7 (= the deployed v16) are the bases of v16 / v8 (transfer requests from a reserved
// IA, scratchpad/iatr/RESERVED_REQUEST_PLAN.md Task 8): built into temp folders, the repo holds v16 / v8
const V15 = fs.mkdtempSync(path.join(os.tmpdir(), "sc-v15-"));
const V15_FILE = path.join(V15, "IA_SAVE.json");
const V7 = fs.mkdtempSync(path.join(os.tmpdir(), "sc-v7-"));
const V7_FILE = path.join(V7, "IA_V2_SUBMIT.json");
const SMALL_CYCLE = path.join(I, "..", "..", "Item Assembly & BOM", "SmallCycle");
const steps = [
  ["python3", ["build_sc.py", "--write"]],
  ["python3", ["classic/patch_v13.py", "--write"], { IASC_OUT: V13 }],
  ["python3", ["classic/patch_v14.py", "--write"], { IASC_OUT: V14 }],
  ["python3", ["classic/patch_v15.py", "--write"], { IASC_OUT: V15 }],
  ["python3", ["classic/patch_v16.py", "--write"]],
  ["python3", ["submit/patch_v4.py", "--write"], { IASC_OUT: V4 }],
  ["python3", ["submit/patch_v5.py", "--write"], { IASC_OUT: V5 }],
  ["python3", ["submit/patch_v6.py", "--write"], { IASC_OUT: V6 }],
  ["python3", ["submit/patch_v7.py", "--write"], { IASC_OUT: V7 }],
  ["python3", ["submit/patch_v8.py", "--write"]],
  ["python3", ["client/build_client_sc.py", "--on", "--write"]],
  ["python3", ["so/build_so_sc.py", "--write"]],
  // RES-01 (raw-material holds): the on_reserved_gd form and IA_HOLD
  ["python3", ["res01/build_onres.py", "--write"]],
  ["python3", ["res01/build_hold.py", "--write"]],
  ["node", ["test/test_sc_bom.js"]],
  ["node", ["test/test_sc_proj.js"]],
  ["node", ["test/test_os_split.js"]],
  ["node", ["test/bulk_sc_bom.js"]],
  ["node", ["test/sim_sc_workflows.js"]],
  ["node", ["test/test_v13_sim.js"], { IA_V13: V13_FILE }],
  ["node", ["test/test_v14_sim.js"], { IA_V13: V13_FILE, IA_V14: V14_FILE }],
  ["node", ["test/sim_submit_v4.js"]],
  ["node", ["test/test_iatr_guard.js"]],
  ["node", ["test/test_v15_sim.js"], { IA_V14: V14_FILE, IA_V15: V15_FILE }],
  ["node", ["test/sim_submit_v7.js"], { IA_V6: V6_FILE, IA_V7: V7_FILE }],
  ["node", ["test/test_iatr_guard2.js"]],
  ["node", ["test/test_v16_sim.js"], { IA_V15: V15_FILE, IA_V16: path.join(SMALL_CYCLE, "IA_SAVE.json") }],
  ["node", ["test/sim_submit_v8.js"], { IA_V7: V7_FILE, IA_V8: path.join(SMALL_CYCLE, "IA_V2_SUBMIT.json") }],
  ["node", ["client/test/test_sc_json.js"]],
  ["node", ["client/test/test_sc_legacy.js"]],
  ["node", ["client/test/test_sc_link.js"]],
  ["node", ["client/test/test_sc_prepare.js"]],
  ["node", ["client/test/test_sc_qty.js"]],
  ["node", ["client/test/test_sc_variance.js"]],
  ["node", ["client/test/test_sc_panel.js"]],
  ["node", ["client/test/test_v2_double.js"]],
  ["node", ["client/test/test_v2_park.js"]],
  ["node", ["client/test/test_classic_double.js"]],
  ["node", ["client/test/test_created.js"]],
  ["node", ["client/test/test_cancel.js"]],
  ["node", ["client/test/test_os_form.js"]],
  ["node", ["client/test/test_res_dirty.js"]],
  ["node", ["client/test/test_res_manual.js"]],
  ["node", ["client/test/test_res_draft.js"]],
  ["node", ["client/test/test_res_own.js"]],
  ["node", ["client/test/test_res_mount.js"]],
  ["node", ["client/test/test_res_close.js"]],
  // the IA transfer request (tr_main; v8: a request from a reserved IA) and sc_main GAP (its replacement allocation)
  ["node", ["client/test/test_tr_form.js"]],
  ["node", ["client/test/test_tr_reserve.js"]],
  ["node", ["client/test/test_sc_gap.js"]],
  ["node", ["so/test/test_so.js"]],
  ["node", ["res01/test/test_onres.js"]],
  ["node", ["res01/test/test_hold_core.js"]],
  ["node", ["res01/test/test_split.js"]],
  ["node", ["res01/test/test_revert.js"]],
  ["node", ["res01/test/sim_hold.js"]],
];
if (process.argv.indexOf("--mutants") >= 0) {
  steps.push(["node", ["test/mutants_sc_bom.js"]], ["node", ["test/mutants_sc_proj.js"]], ["python3", ["test/mutants_sc_workflows.py"]], ["python3", ["test/mutants_v13.py"]], ["node", ["test/mutants_os_split.js"]], ["python3", ["test/mutants_v14.py"]],
    ["python3", ["test/mutants_v4.py"]], ["python3", ["test/mutants_v5.py"]], ["python3", ["test/mutants_v6.py"]], ["python3", ["client/test/mutants_client.py"]],
    ["python3", ["so/test/mutants_so.py"]], ["python3", ["res01/test/mutants_hold.py"]], ["node", ["test/mutants_iatr_guard.js"]], ["node", ["test/mutants_iatr_wf.js"]],
    ["node", ["test/mutants_iatr_guard2.js"]], ["node", ["test/mutants_iatr_wf2.js"]], ["node", ["client/test/mutants_tr.js"]]);
}
let failed = false;
for (const [cmd, args, env] of steps) {
  const r = spawnSync(cmd, [path.join(I, args[0])].concat(args.slice(1)), { encoding: "utf8", timeout: 1800000, env: Object.assign({}, process.env, env || {}) });
  const out = ((r.stdout || "") + (r.stderr || "")).trim().split("\n");
  const last = out.filter((l) => l.trim()).slice(-1)[0] || "";
  out.filter((l) => /^FAIL|SURVIVED|BROKEN/.test(l)).slice(0, 8).forEach((l) => console.log("    " + l.slice(0, 300)));
  console.log((r.status === 0 ? "ok    " : "FAIL  ") + args[0] + "  " + last.slice(0, 160));
  if (r.status !== 0) failed = true;
}
console.log(failed ? "FAILED" : "ok - Small Cycle: every build and test passed");
process.exit(failed ? 1 : 0);

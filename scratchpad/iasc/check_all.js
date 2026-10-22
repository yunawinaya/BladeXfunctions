// Small Cycle regression in one run: every builder (written to the repo; each asserts its own invariants), then every test.
//   node scratchpad/iasc/check_all.js            (add --mutants to run the mutation suites too, ~3 min)
const { spawnSync } = require("child_process");
const path = require("path");
const I = __dirname;
const steps = [
  ["python3", ["build_sc.py", "--write"]],
  ["python3", ["classic/patch_v13.py", "--write"]],
  ["python3", ["submit/patch_v4.py", "--write"]],
  ["python3", ["client/build_client_sc.py", "--on", "--write"]],
  ["python3", ["so/build_so_sc.py", "--write"]],
  // RES-01 (raw-material holds): the on_reserved_gd form and IA_HOLD
  ["python3", ["res01/build_onres.py", "--write"]],
  ["python3", ["res01/build_hold.py", "--write"]],
  ["node", ["test/test_sc_bom.js"]],
  ["node", ["test/test_sc_proj.js"]],
  ["node", ["test/bulk_sc_bom.js"]],
  ["node", ["test/sim_sc_workflows.js"]],
  ["node", ["test/test_v13_sim.js"]],
  ["node", ["test/sim_submit_v4.js"]],
  ["node", ["client/test/test_sc_json.js"]],
  ["node", ["client/test/test_sc_legacy.js"]],
  ["node", ["client/test/test_sc_link.js"]],
  ["node", ["client/test/test_sc_prepare.js"]],
  ["node", ["client/test/test_sc_qty.js"]],
  ["node", ["client/test/test_sc_variance.js"]],
  ["node", ["client/test/test_sc_panel.js"]],
  ["node", ["client/test/test_v2_double.js"]],
  ["node", ["client/test/test_classic_double.js"]],
  ["node", ["client/test/test_created.js"]],
  ["node", ["client/test/test_cancel.js"]],
  ["node", ["client/test/test_res_dirty.js"]],
  ["node", ["client/test/test_res_manual.js"]],
  ["node", ["client/test/test_res_draft.js"]],
  ["node", ["client/test/test_res_own.js"]],
  ["node", ["client/test/test_res_mount.js"]],
  ["node", ["client/test/test_res_close.js"]],
  ["node", ["so/test/test_so.js"]],
  ["node", ["res01/test/test_onres.js"]],
  ["node", ["res01/test/test_hold_core.js"]],
  ["node", ["res01/test/test_split.js"]],
  ["node", ["res01/test/test_revert.js"]],
  ["node", ["res01/test/sim_hold.js"]],
];
if (process.argv.indexOf("--mutants") >= 0) {
  steps.push(["node", ["test/mutants_sc_bom.js"]], ["node", ["test/mutants_sc_proj.js"]], ["python3", ["test/mutants_sc_workflows.py"]], ["python3", ["test/mutants_v13.py"]],
    ["python3", ["test/mutants_v4.py"]], ["python3", ["client/test/mutants_client.py"]],
    ["python3", ["so/test/mutants_so.py"]], ["python3", ["res01/test/mutants_hold.py"]]);
}
let failed = false;
for (const [cmd, args] of steps) {
  const r = spawnSync(cmd, [path.join(I, args[0])].concat(args.slice(1)), { encoding: "utf8", timeout: 1800000 });
  const out = ((r.stdout || "") + (r.stderr || "")).trim().split("\n");
  const last = out.filter((l) => l.trim()).slice(-1)[0] || "";
  out.filter((l) => /^FAIL|SURVIVED|BROKEN/.test(l)).slice(0, 8).forEach((l) => console.log("    " + l.slice(0, 300)));
  console.log((r.status === 0 ? "ok    " : "FAIL  ") + args[0] + "  " + last.slice(0, 160));
  if (r.status !== 0) failed = true;
}
console.log(failed ? "FAILED" : "ok - Small Cycle: every build and test passed");
process.exit(failed ? 1 : 0);

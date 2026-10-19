// Package D regression (CONTRACT section 12): the switch-OFF fall-through and the rest of the client checks, in one run.
// test_sa_form.js  - each SA button (Completed, Completed & Post) = the base v313 click call for call through triggerEvent; V2 path; Draft re-read; mounted
// test_sc_form.js  - the Review button = the base v497 click call for call through every confirmation path; V2 branch; mounted
// test_lists.js    - the gated list kicks; bulk Post / Delete skip Processing
// test_json_integrity.js - only the intended JSON paths changed; classic handlers byte-identical; mirrors; shipped ON + real ids
// test_shipped.js  - the shipped files as they are (ON, real ids): small -> classic, large -> SA_V2_SUBMIT; views and kicks
//   node check_fallthrough.js        (first: python3 build_client.py --on --write)
const { spawnSync } = require("child_process");
const path = require("path");
let failed = false;
for (const args of [[], ["--on"]]) {
  const build = spawnSync("python3", [path.join(__dirname, "build_client.py")].concat(args), { encoding: "utf8" });
  if (build.status !== 0) failed = true;
  console.log("build_client.py " + (args.join(" ") || "(OFF)") + " check, no write: " + (build.status === 0 ? "ok" : "FAILED\n" + build.stderr.slice(-1500)));
}
for (const t of ["test_sa_form.js", "test_sc_form.js", "test_lists.js", "test_json_integrity.js", "test_shipped.js"]) {
  const r = spawnSync("node", [path.join(__dirname, "test", t)], { encoding: "utf8", timeout: 600000 });
  const out = (r.stdout || "").trim().split("\n");
  out.filter((l) => l.startsWith("FAIL")).slice(0, 10).forEach((l) => console.log("  " + l.slice(0, 300)));
  console.log(out[out.length - 1] + (r.status === 0 ? "" : "  <- exit " + r.status));
  if (r.status !== 0) failed = true;
}
process.exit(failed ? 1 : 0);

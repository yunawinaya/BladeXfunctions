// Package D regression in one run (copy of tpl/sav2/client/check_fallthrough.js): the builder's own assertions for the OFF and
// ON variants (no write), then every client test against the written build.
// test_form_click.js   - both buttons: switch OFF = the base v32 click call for call; routing; V2 path; Complete & Post; awaitLink
// test_form_mounted.js - OFF = base for every known status; the Processing view; following a completion / revert job
// test_labour.js       - non-stock lines (explode, allocator, picker, Batch Add, row remove, Transfer Stock); reads, 830 lines + clamp
// test_lists.js        - the list kick, Edit hidden, Delete guard + re-read, Revert routing (OFF = base call for call)
// test_post.js         - the form Post and the list bulk Post re-read the stored status before Pending Post (review R3)
// test_json_integrity.js - only the intended JSON paths changed; classics byte-identical; verbatim lifts; mirrors; shipped OFF
// test_shipped.js      - the ON build as built (dead while ids.json holds "0"; real ids -> real calls)
//   node check_all.js        (first: python3 build_client.py --write)
const { spawnSync } = require("child_process");
const path = require("path");
let failed = false;
for (const args of [[], ["--on"], ["--on=REVERT"]]) {
  const build = spawnSync("python3", [path.join(__dirname, "build_client.py")].concat(args), { encoding: "utf8" });
  if (build.status !== 0) failed = true;
  console.log("build_client.py " + (args.join(" ") || "(OFF + ON)") + " check, no write: " + (build.status === 0 ? "ok" : "FAILED\n" + build.stderr.slice(-1500)));
}
// CONTRACT ruling 9: COMPLETE / COMPLETE_POST may be ON only with REVERT ON
for (const args of [["--on=COMPLETE"], ["--on=COMPLETE_POST"], ["--on=COMPLETE,COMPLETE_POST"]]) {
  const build = spawnSync("python3", [path.join(__dirname, "build_client.py")].concat(args), { encoding: "utf8" });
  const refused = build.status !== 0 && /only with REVERT ON/.test(build.stderr);
  if (!refused) failed = true;
  console.log("build_client.py " + args.join(" ") + " refused (ruling 9): " + (refused ? "ok" : "NOT REFUSED"));
}
for (const t of ["test_form_click.js", "test_form_mounted.js", "test_labour.js", "test_lists.js", "test_post.js", "test_json_integrity.js", "test_shipped.js"]) {
  const r = spawnSync("node", [path.join(__dirname, "test", t)], { encoding: "utf8", timeout: 900000 });
  const out = (r.stdout || "").trim().split("\n");
  out.filter((l) => l.startsWith("FAIL")).slice(0, 10).forEach((l) => console.log("  " + l.slice(0, 300)));
  console.log(out[out.length - 1] + (r.status === 0 ? "" : "  <- exit " + r.status));
  if (r.status !== 0) failed = true;
}
process.exit(failed ? 1 : 0);

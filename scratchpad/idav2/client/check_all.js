// Package D regression in one run (copy of tpl/iav2/client/check_all.js): the builder's own assertions for the OFF and ON
// variants (no write), the --on --write refusal while an id is "0", then every client test against the written build.
// test_form_click.js     - both buttons: switch OFF = the base v35 click call for call; routing; V2 path; Complete & Post; awaitLink
// test_form_mounted.js   - OFF = base for every known status; the Processing view; following a job
// test_explode.js        - the BOM explode at 5 / 830 / 2,000 components (= base unclamped; every line filled under a 100-row clamp;
//                          .field() + chunks + limits); the 2,000-line measurements (out/measure.txt)
// test_lists.js          - the list kick, Edit hidden, Delete guard + re-read
// test_post.js           - the form Post and the list bulk Post re-read the stored status before Pending Post
// test_json_integrity.js - only the intended JSON paths / script edits; classics byte-identical; verbatim lifts; shared copies; mirrors
// test_shipped.js        - the ON build as built (real ids -> real calls; "0" -> classic)
//   node check_all.js        (first: python3 build_client.py --write)
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
let failed = false;
const builder = path.join(__dirname, "build_client.py");
for (const args of [[], ["--on"], ["--on=COMPLETE"], ["--on=COMPLETE_POST"]]) {
  const build = spawnSync("python3", [builder].concat(args), { encoding: "utf8" });
  if (build.status !== 0) failed = true;
  console.log("build_client.py " + (args.join(" ") || "(OFF + ON)") + " check, no write: " + (build.status === 0 ? "ok" : "FAILED\n" + build.stderr.slice(-1500)));
}
{
  // an ON build without its workflows would ship a switch that does nothing: --on --write is refused, nothing written
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "idav2-client-"));
  const ids = JSON.parse(fs.readFileSync(path.join(__dirname, "../ids.json"), "utf8"));
  fs.writeFileSync(path.join(tmp, "ids.json"), JSON.stringify(Object.assign({}, ids, { IDA_V2_SUBMIT: "0", IDA_V2_WORKER: "0" })));
  const out = path.join(tmp, "out");
  const build = spawnSync("python3", [builder, "--on", "--write"], { encoding: "utf8", env: Object.assign({}, process.env, { IDA_IDS: path.join(tmp, "ids.json"), IDA_OUT_DIR: out }) });
  const refused = build.status !== 0 && /--on --write needs the real workflow ids/.test(build.stderr) && !fs.existsSync(out);
  if (!refused) failed = true;
  console.log("build_client.py --on --write with ids \"0\" refused, nothing written: " + (refused ? "ok" : "NOT REFUSED"));
  fs.rmSync(tmp, { recursive: true, force: true });
}
for (const t of ["test_form_click.js", "test_form_mounted.js", "test_explode.js", "test_lists.js", "test_post.js", "test_json_integrity.js", "test_shipped.js"]) {
  const r = spawnSync("node", [path.join(__dirname, "test", t)], { encoding: "utf8", timeout: 900000 });
  const out = (r.stdout || "").trim().split("\n");
  out.filter((l) => l.startsWith("FAIL")).slice(0, 10).forEach((l) => console.log("  " + l.slice(0, 300)));
  console.log(out[out.length - 1] + (r.status === 0 ? "" : "  <- exit " + r.status));
  if (r.status !== 0) failed = true;
}
process.exit(failed ? 1 : 0);

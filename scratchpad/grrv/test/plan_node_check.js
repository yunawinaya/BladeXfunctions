// plan_node_check.js [<sql dump.json>]: each plan-core node body exactly as the builder embeds it (code/outputs.json "files"
// joined with "\n"): its size, `node --check` on it (as a function body, its tokens standing in as null), and - given a
// run_prepare_sql.py dump of a stored receipt - one run of VPprep -> VPplan and of VSgate with the tokens substituted the way
// the platform substitutes them: no name collides across the files, every token the tails read has a value, the answers
// have the declared keys only. The receipt is presented as locked by a test job. Run with TZ=Asia/Kuala_Lumpur.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const H = require("./_harness");
let bad = 0;
for (const node of Object.keys(H.OUTPUTS.files)) {
  const code = H.body(node);
  const tmp = path.join(os.tmpdir(), "grrv_check_" + node + "_" + process.pid + ".js");
  fs.writeFileSync(tmp, "(function () {\n" + code.replace(/\{\{([^{}]+?)\}\}/g, "null") + "\n})\n");
  let ok = "ok";
  try {
    execFileSync(process.execPath, ["--check", tmp], { stdio: "pipe" });
  } catch (e) {
    ok = "SYNTAX ERROR " + String(e.stderr).slice(0, 400);
    bad++;
  }
  fs.unlinkSync(tmp);
  const tokens = [...new Set((code.match(/\{\{([^{}]+?)\}\}/g) || []))];
  console.log(`${node.padEnd(7)} ${String(code.length).padStart(7)} chars ${String(code.split("\n").length).padStart(5)} lines  ${tokens.length} tokens  node --check: ${ok}`);
}
if (process.argv[2]) {
  const S = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  const L = H.locked(S);
  const prep = H.runNode("VPprep", H.prepCtx(L.entry, S, L.hdr, L.lock));
  const plan = H.runNode("VPplan", H.planCtx(L.entry, prep.out, S));
  const gate = H.runNode("VSgate", H.gateCtx({ route: "GO", tenantId: L.entry.tenantId, grId: L.entry.grId, organizationId: L.entry.organizationId }, S.submit || S));
  for (const [name, r] of [["VPprep", prep], ["VPplan", plan], ["VSgate", gate]]) {
    const extra = Object.keys(r.raw || {}).filter((k) => !H.OUTPUTS[name].fields.includes(k) && r.raw[k] !== undefined);
    const lacking = H.OUTPUTS[name].fields.filter((k) => !(k in (r.raw || {})));
    if (r.missing.length || extra.length) bad++;
    console.log(`${name.padEnd(7)} ${String(r.out.route).padEnd(12)} ${String(r.out.code).padEnd(16)} ${String(r.out.message || "").slice(0, 110)}`);
    console.log(`        ${r.ms.toFixed(0)} ms; tokens without a value: ${r.missing.join(", ") || "none"}; keys beyond the declared: ${extra.join(", ") || "none"}`
      + (lacking.length ? `; declared but not returned: ${lacking.join(", ")}` : ""));
  }
}
process.exit(bad ? 1 : 0);

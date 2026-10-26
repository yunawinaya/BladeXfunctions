// test_cfout_type.js: every keep-stored guard's CfOut declares `cf` as "any", like the live cfwipe CfOut (SO_SAVE
// code_node_CfOut1). The platform converts a code node's outputs to their declared types, so a "string" cf would hand the
// update node text instead of the custom-fields object (found by the final review, 10-27).
// Run: node scratchpad/salescf/test/test_cfout_type.js [file ...]   (default: out/dev + out/prod SI_SAVE and GOODS_DELIVERY)
const fs = require("fs"), assert = require("assert"), path = require("path");
const P = path.join(__dirname, "..");
const files = process.argv.slice(2).length ? process.argv.slice(2)
  : ["dev", "prod"].flatMap((e) => ["SI_SAVE", "GOODS_DELIVERY"].map((n) => path.join(P, "out", e, n + ".json")));
const nodes = (o, out = []) => {
  if (Array.isArray(o)) o.forEach((v) => nodes(v, out));
  else if (o && typeof o === "object") {
    if (typeof o.id === "string" && o.data) out.push(o);
    Object.values(o).forEach((v) => nodes(v, out));
  }
  return out;
};
let n = 0;
for (const f of files) {
  const all = nodes(JSON.parse(fs.readFileSync(f, "utf8")));
  const outs = all.filter((x) => /^code_node_(Gd|Si)CfOut[0-9]*$/.test(x.id));
  assert.ok(outs.length === 1 || outs.length === 3, f + ": " + outs.length + " CfOut nodes");
  for (const o of outs) {
    const cf = o.data.response_json.filter((r) => r.name === "cf");
    assert.strictEqual(cf.length, 1, o.id + ": one cf declaration");
    assert.strictEqual(cf[0].bsonType, "any", f + " " + o.id + ": cf must be declared any, is " + cf[0].bsonType);
    const ref = "{{node:" + o.id + ".data.cf}}";
    assert.ok(all.some((u) => /^update_node_/.test(u.id) && u.data.props.list.some((p) => p.value === ref)), o.id + ": an update node writes it");
  }
  n++;
  console.log("ok", path.relative(P, f), outs.map((o) => o.id).join(", "), "declare cf any");
}
console.log(n + " passed");

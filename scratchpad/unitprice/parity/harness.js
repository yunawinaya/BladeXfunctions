// Runs the shipped code-node bodies (everything before their "const res =" tail) on JSONL cases.
// usage: node harness.js <cases.jsonl> <out.jsonl>   case: {id, fn: "priceKeys"|"pricePlan"|"resolvePrices"|"check", args: [...]}
const fs = require("fs");
const path = require("path");
const CODE = path.join(__dirname, "..", "code");
const body = (f) => {
  const t = fs.readFileSync(path.join(CODE, f), "utf8");
  return t.slice(0, t.indexOf("\nconst res = "));
};
const fns = {};
for (const [f, name] of [["keys.js", "priceKeys"], ["plan.js", "pricePlan"], ["resolve.js", "resolvePrices"]]) {
  fns[name] = new Function(body(f) + "\nreturn " + name + ";")();
}
const check = fs.readFileSync(path.join(CODE, "check.js"), "utf8");
fns.check = (documentType, suppCustId, plantId, itemData) => {
  const lit = (v) => (v === undefined ? "null" : JSON.stringify(v));
  const src = check.replace("{{workflowparams:document_type}}", lit(documentType)).replace("{{workflowparams:supp_cust_id}}", lit(suppCustId))
    .replace("{{workflowparams:plant_id}}", lit(plantId)).replace("{{workflowparams:item_data}}", lit(itemData));
  return new Function(src)();
};
const [inp, outp] = process.argv.slice(2);
const out = fs.openSync(outp, "w");
let ms = 0;
for (const line of fs.readFileSync(inp, "utf8").split("\n")) {
  if (!line.trim()) continue;
  const c = JSON.parse(line);
  const t0 = process.hrtime.bigint();
  let res, err = null;
  try {
    res = fns[c.fn](...c.args);
  } catch (e) {
    err = String(e && e.stack || e).slice(0, 300);
  }
  const t1 = process.hrtime.bigint();
  ms += Number(t1 - t0) / 1e6;
  fs.writeSync(out, JSON.stringify({ id: c.id, res: res, err: err, ms: Number(t1 - t0) / 1e6 }) + "\n");
}
fs.closeSync(out);
console.error("harness: total fn time " + ms.toFixed(1) + " ms");

// test_one_stock_call.js: INVENTORY_APPLY_OPERATION takes every key in ONE ordered TAKE call (patch_one_stock_call.py,
// 2026-10-26). Runs code_node_LNtake from the repo JSON with its placeholder filled as the platform fills it.
// The GD_ASYNC_WORKER side is in test_worker_sweep_retry.js ("one call:" cases). usage: node test_one_stock_call.js
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const FILE = path.join(__dirname, "..", "..", "..", "..", "Goods Delivery", "AsyncV2", "INVENTORY_APPLY_OPERATION.json");
const find = (o, id) => {
  if (Array.isArray(o)) {
    for (const v of o) {
      const r = find(v, id);
      if (r) return r;
    }
  } else if (o && typeof o === "object") {
    if (o.id === id) return o;
    for (const v of Object.values(o)) {
      const r = find(v, id);
      if (r) return r;
    }
  }
  return null;
};
const code = find(JSON.parse(fs.readFileSync(FILE, "utf8")), "code_node_LNtake").data.script.code;
const take = (ids) => new Function(code.replace("{{node:code_node_J6YxjhQw.data.ids}}", JSON.stringify(ids)))();
const lanesEmpty = (o) => [0, 1, 2, 3, 4, 5, 6, 7, 8].every((k) => Array.isArray(o["lane" + k]) && o["lane" + k].length === 0 && o["has" + k] === "NO");
const ids = (n) => Array.from({ length: n }, (_, i) => String(2114000000000000000n + BigInt(i)));
let n = 0;
const ok = (name, cond, got) => {
  assert(cond, name + ": " + JSON.stringify(got).slice(0, 400));
  n++;
};

let o = take(ids(72));
ok("72 keys (an LSH GD): all in the first call, in the given order", o.warm.length === 72 && o.warm.join() === ids(72).join() && o.count === "72", o);
ok("72 keys: every lane empty", lanesEmpty(o), o);
o = take(ids(10));
ok("10 keys: all in the first call", o.warm.length === 10 && lanesEmpty(o), o);
o = take(ids(4000));
ok("4,000 keys (a 2k-line GD): all in the first call", o.warm.length === 4000 && lanesEmpty(o), o.count);
o = take(["1", "2", "2"]);
ok("a key listed twice: one call with every key, as before", o.warm.join() === "1,2,2" && lanesEmpty(o), o);
o = take("7");
ok("a single key arriving as a scalar", o.warm.join() === "7" && lanesEmpty(o), o);
console.log("test_one_stock_call: " + n + " pass");

// test_one_stock_call.js: INVENTORY_APPLY_OPERATION's lock TAKE and lock GIVE split the keys IDENTICALLY (first call + 9 lanes).
// 2026-10-26: v13 took every key in one call but still gave keys back in lanes; a lane cannot release a key the main call took,
// so every operation with more than 25 keys froze at give-back until the 20-min limit (LSH / GUB 11:06-11:39, rolled back).
// Runs code_node_LNtake and code_node_LNgive from the repo JSON with their placeholders filled. usage: node test_one_stock_call.js
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
const doc = JSON.parse(fs.readFileSync(FILE, "utf8"));
const split = (id, token) => (ids) => new Function(find(doc, id).data.script.code.replace(token, JSON.stringify(ids)))();
const take = split("code_node_LNtake", "{{node:code_node_J6YxjhQw.data.ids}}");
const give = split("code_node_LNgive", "{{node:code_node_mkkHs3G9.data.plusIds}}");
const shape = (o) => JSON.stringify([o.warm].concat([0, 1, 2, 3, 4, 5, 6, 7, 8].map((k) => o["lane" + k] || [])));
const ids = (n) => Array.from({ length: n }, (_, i) => String(2114000000000000000n + BigInt(i)));
let n = 0;
for (const count of [1, 2, 16, 25, 26, 36, 72, 92, 400, 4000]) {
  assert.strictEqual(shape(give(ids(count))), shape(take(ids(count))), count + " keys: TAKE and GIVE split differently");
  n++;
}
assert.strictEqual(shape(give(["1", "2", "2"])), shape(take(["1", "2", "2"])), "a key listed twice: TAKE and GIVE split differently");
n++;
// patch_engine_one_call_both.py: both as ONE main call, every key in lock order, the lanes empty
const one = (o, count) => o.warm.length === count && o.count === String(count) && [0, 1, 2, 3, 4, 5, 6, 7, 8].every((k) => (o["lane" + k] || []).length === 0 && o["has" + k] === "NO");
for (const count of [26, 72, 92, 200, 4000]) {
  assert(one(take(ids(count)), count), count + " keys: TAKE is not one call");
  assert(one(give(ids(count)), count), count + " keys: GIVE is not one call");
  assert.strictEqual(take(ids(count)).warm.join(), ids(count).join(), count + " keys: TAKE changed the lock order");
  n += 3;
}
console.log("test_one_stock_call: " + n + " pass (TAKE and GIVE split identically, each one call)");

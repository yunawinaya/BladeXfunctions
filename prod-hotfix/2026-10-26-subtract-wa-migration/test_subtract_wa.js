// test_subtract_wa.js <SUBTRACT_INVENTORY_NEW.json>: the WA price and WA deduction of SUBTRACT_INVENTORY_NEW, run from the
// workflow file as built. The costing migration in the same run may write the item's WA row after the WA lookup was read
// (Kenhin 10-23 / 10-26: a FIFO-only WA item threw "No Weighted Average costing record" on its first issue and stranded
// the Picking). Both nodes must use what the migration wrote; a true no-record case still throws. Exit 0 only if every
// case holds.
const fs = require("fs");
const w = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const find = (o, id) => {
  if (o && typeof o === "object") {
    if (o.id === id) return o;
    for (const v of Object.values(o)) { const r = find(v, id); if (r) return r; }
  }
  return null;
};
// a node that did not run resolves to null, as the platform does for a branch not taken
const run = (nodeId, ctx) => {
  const code = find(w, nodeId).data.script.code;
  const holders = [...new Set(code.match(/\{\{[^}]+\}\}/g))];
  const names = holders.map((_, i) => "__p" + i);
  let body = code;
  holders.forEach((h, i) => { body = body.split(h).join(names[i]); });
  const val = (h) => {
    const key = h.slice(2, -2);
    if (!(key in ctx)) throw new Error("test has no value for " + h);
    return JSON.parse(JSON.stringify(ctx[key]));
  };
  return new Function(...names, body)(...holders.map(val));
};
const base = {
  "workflowparams:material_id": "2102212734669168645",
  "workflowparams:batch_id": null,
  "workflowparams:plant_id": "2006975338995011586",
  "node:code_node_wBfvXM2G.data.baseQty": 7,
  "node:code_node_YqMfJIMz.data": null,
  "node:code_node_oz7GGSQA.data": null,
  "node:add_node_yOylfPVp.data": null,
};
const lookup = (rows) => ({
  "node:search_node_7bvv7f8g.data": { total: rows.length, count: rows.length, data: rows },
  "node:search_node_7bvv7f8g.data.data": rows,
});
const cases = [];
const check = (name, fn, want) => {
  let got;
  try { got = JSON.stringify(fn()); } catch (e) { got = "threw: " + e.message.slice(0, 120); }
  cases.push([name, got, JSON.stringify(want)]);
};
const both = (rows, extra) => Object.assign({}, base, lookup(rows), extra || {});

// 1. no migration, the WA row is found: unchanged behaviour
const found = both([{ id: "W1", wa_quantity: 10, wa_cost_price: 3.5, created_at: "2026-10-01" }]);
check("found row: price", () => run("code_node_7l9u4Zca", found), { calculatedUnitPrice: 3.5 });
check("found row: deduct", () => run("code_node_fVEv7HuP", found), { id: "W1", wa_quantity: 3 });

// 2. FIFO-only WA item (Kenhin V131): the migration added the WA row in this run, the lookup is empty
const added = both([], {
  "node:code_node_oz7GGSQA.data": { targetRecord: { wa_quantity: 100, wa_cost_price: 25 }, idsToDelete: ["F1"], targetCosting: "WA" },
  "node:add_node_yOylfPVp.data": [{ id: "NEW1", wa_quantity: 100, wa_cost_price: 25 }],
});
check("FIFO-only migrated: price from the migrated row", () => run("code_node_7l9u4Zca", added), { calculatedUnitPrice: 25 });
check("FIFO-only migrated: deduct from the added row", () => run("code_node_fVEv7HuP", added), { id: "NEW1", wa_quantity: 93 });

// 3. FIFO merged into the existing WA row: the lookup holds the pre-merge quantity and price
const merged = both([{ id: "W2", wa_quantity: 10, wa_cost_price: 4, created_at: "2026-10-01" }], {
  "node:code_node_YqMfJIMz.data": { targetRecord: { id: "W2", wa_quantity: 15, wa_cost_price: 5 }, idsToDelete: ["F2"], targetCosting: "WA" },
});
check("merged: price from the merged row", () => run("code_node_7l9u4Zca", merged), { calculatedUnitPrice: 5 });
check("merged: deduct from the merged quantity", () => run("code_node_fVEv7HuP", merged), { id: "W2", wa_quantity: 8 });

// 4. no WA row and no migration: still refused, naming the tuple
check("no row at all: still throws the named error", () => run("code_node_fVEv7HuP", both([])),
  "threw: No Weighted Average costing record for material 2102212734669");

// 5. the classic-lock copy of the deduction behaves the same
check("classic-lock copy: FIFO-only migrated", () => run("code_node_fVEv7HuPCLp", added), { id: "NEW1", wa_quantity: 93 });
check("classic-lock copy: merged", () => run("code_node_fVEv7HuPCLp", merged), { id: "W2", wa_quantity: 8 });

let ok = true;
for (const [name, got, want] of cases) {
  const wantStr = want.startsWith('"threw: ') ? JSON.parse(want) : want;
  const pass = want.startsWith('"threw: ') ? got.startsWith(wantStr) : got === want;
  ok = ok && pass;
  console.log((pass ? "ok   " : "FAIL ") + name + ": " + got + (pass ? "" : "  (want " + wantStr + ")"));
}
console.log(ok ? cases.length + "/" + cases.length + " passed" : "subtract WA test FAILED");
process.exit(ok ? 0 : 1);

// test_clamp_msg.js: classic PICKING code_node_ClampMsg (Picking/PickingProcessWorkflow.json). Its packingMessage is what the
// Auto Packing branch returns (return_node_8pe4Lsgp via code_node_GdFailSum); it must read like the plain branch and Picking
// V2 ("Picking processed successfully" + any clamp note), never the "Packing TBC" placeholder (user, 2026-10-20).
const fs = require("fs"), assert = require("assert");
const R = __dirname + "/../../../";
const walk = (l, out = []) => { for (const x of l || []) { out.push(x); walk(x.blocks, out); } return out; };
const node = walk(JSON.parse(fs.readFileSync(R + "Picking/PickingProcessWorkflow.json", "utf8")).nodes).filter((x) => x.id === "code_node_ClampMsg")[0];
const run = (clamped) => new Function(node.data.script.code.replace("{{node:code_node_oHIIKfiw.data.clampedLines}}", JSON.stringify(clamped)))();
let failed = 0, n = 0;
const it = (name, f) => { n++; try { f(); } catch (e) { failed++; console.log("FAIL " + name + ": " + String(e.message).split("\n")[0]); } };

it("no clamp: both messages are the plain success text", () => {
  const r = run([]);
  assert.strictEqual(r.message, "Picking processed successfully");
  assert.strictEqual(r.packingMessage, "Picking processed successfully");
});
it("a clamp: the Auto Packing message carries the same note as the plain one", () => {
  const r = run([{ picking_item_id: "1", item_name: "Normal Item", requested: 10, allowed: 4 }]);
  assert.ok(r.message.indexOf("Picking processed successfully. 1 line(s) were reduced") === 0, r.message);
  assert.strictEqual(r.packingMessage, r.message);
});
it("no placeholder text left in the node", () => {
  assert.ok(node.data.script.code.indexOf("TBC") < 0);
});
console.log(n - failed + "/" + n + " passed");
process.exit(failed ? 1 : 0);

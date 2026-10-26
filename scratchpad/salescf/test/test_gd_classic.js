// test_gd_classic.js: GOODS_DELIVERY (classic GD save) stores the GD header custom fields (out/<env>/GOODS_DELIVERY.json). Both
// add nodes write allData.custom_fields; each of the three header update nodes writes it through its own keep-stored guard
// (n = 1, 2, 3): a save that leaves the key out (Picking / Packing re-saves of a GD whose column is NULL) reads that ONE
// column back by id and writes it as stored. Code nodes run with placeholders filled like the platform.
// Run: node scratchpad/salescf/test/test_gd_classic.js [out/<env>/GOODS_DELIVERY.json] [base/<env>/GOODS_DELIVERY.json]
const fs = require("fs"), assert = require("assert"), path = require("path");
const P = path.join(__dirname, "..");
const W = JSON.parse(fs.readFileSync(process.argv[2] || path.join(P, "out", "dev", "GOODS_DELIVERY.json"), "utf8"));
const B = JSON.parse(fs.readFileSync(process.argv[3] || path.join(P, "base", "dev", "GOODS_DELIVERY.json"), "utf8"));
const find = (o, id) => {
  if (Array.isArray(o)) { for (const v of o) { const r = find(v, id); if (r) return r; } return null; }
  if (o && typeof o === "object") { if (o.id === id) return o; for (const v of Object.values(o)) { const r = find(v, id); if (r) return r; } }
  return null;
};
const node = (doc, id) => { const n = find(doc, id); assert.ok(n, "no node " + id); return n; };
const run = (id, vals) => new Function(node(W, id).data.script.code.replace(/\{\{(?:node|system):([A-Za-z0-9_.]+)\}\}/g, (m, name) =>
  (name in vals && vals[name] !== undefined ? JSON.stringify(vals[name]) : "null")))();
const parent = (o, id) => {
  if (Array.isArray(o)) { if (o.some((x) => x && x.id === id)) return o; for (const v of o) { const r = parent(v, id); if (r) return r; } return null; }
  if (o && typeof o === "object") for (const v of Object.values(o)) { const r = parent(v, id); if (r) return r; }
  return null;
};
const CF = "code_node_IyJHrBst.data.allData.custom_fields", ID = "code_node_IyJHrBst.data.allData.id";
const UPDATES = ["update_node_elLmtlLm", "update_node_aJCo6wbf", "update_node_wq10Ecg3"];
let n = 0;
const ok = (t) => { n++; console.log("ok", t); };

for (const id of ["add_node_ROqbYEI6", "add_node_2r51lmua"]) {
  const props = node(W, id).data.props.list, before = node(B, id).data.props.list;
  assert.strictEqual(props.find((p) => p.prop === "custom_fields").value, "{{node:code_node_IyJHrBst.data.allData.custom_fields}}");
  assert.deepStrictEqual(props.filter((p) => p.prop !== "custom_fields"), before, id + ": nothing else changed");
}
ok("both add nodes write allData.custom_fields and nothing else changed");

UPDATES.forEach((uid, i) => {
  const k = i + 1;
  const props = node(W, uid).data.props.list, before = node(B, uid).data.props.list;
  assert.strictEqual(props.find((p) => p.prop === "custom_fields").value, "{{node:code_node_GdCfOut" + k + ".data.cf}}");
  assert.deepStrictEqual(props.filter((p) => p.prop !== "custom_fields"), before, uid + ": nothing else changed");
  const sib = parent(W, uid).map((x) => x.id), at = sib.indexOf(uid);
  assert.deepStrictEqual(sib.slice(at - 3, at + 1), ["code_node_GdCfNeed" + k, "if_GdCfNeed" + k, "code_node_GdCfOut" + k, uid]);
  assert.deepStrictEqual(node(W, "if_GdCfNeed" + k).blocks[0].blocks.map((x) => x.id), ["sql_node_GdCfRead" + k]);
});
ok("each header update writes its own guard's value; guard order Need -> if(Read) -> Out right before it");

const k = 2;
let r = run("code_node_GdCfNeed" + k, { [CF]: { lsh_envelope: false }, [ID]: "2095877730484424705" });
assert.deepStrictEqual(r, { need: "0", id: "2095877730484424705" });
let o = run("code_node_GdCfOut" + k, { ["code_node_GdCfNeed" + k + ".data.need"]: "0", [CF]: { lsh_envelope: false } });
assert.deepStrictEqual(o, { cf: { lsh_envelope: false } });
ok("present_no_read: a form save's object (false kept) is written as sent, no read");

r = run("code_node_GdCfNeed" + k, { [ID]: "2095877730484424705" });
assert.deepStrictEqual(r, { need: "1", id: "2095877730484424705" });
const sql = node(W, "sql_node_GdCfRead" + k).data.script.code;
assert.ok(/SELECT CAST\(t\.id AS CHAR\) AS row_id,\s+IF\(t\.custom_fields IS NULL, NULL, \(SELECT IFNULL\(JSON_OBJECTAGG\(IFNULL\(d\.field_name, k\.k\)/.test(sql) && /AS custom_fields\s+FROM goods_delivery t/.test(sql), sql);
assert.ok(!find(node(W, "if_GdCfNeed" + k), "get_node_CfStored" + k) && node(W, "if_GdCfNeed" + k).blocks[0].blocks.length === 1, "one sql read, no get-node");
o = run("code_node_GdCfOut" + k, { ["code_node_GdCfNeed" + k + ".data.need"]: "1", ["sql_node_GdCfRead" + k + ".data"]: [{ row_id: "2095877730484424705" }] });
assert.deepStrictEqual(o, { cf: null });
ok("null_column_one_read: a Picking-style allData without the key reads one column; NULL stays NULL");

o = run("code_node_GdCfOut" + k, { ["code_node_GdCfNeed" + k + ".data.need"]: "1",
  ["sql_node_GdCfRead" + k + ".data"]: [{ row_id: "1", custom_fields: '{"2114765569527459842": true}' }] });
assert.deepStrictEqual(o, { cf: { "2114765569527459842": true } });
ok("missing_reads: a stored (id-keyed) value is written back as stored");

// the guard's read, run read-only on dev: the stored header comes back BY NAME (the platform drops id keys on a header
// write - GD Edit V2 wiped GD/20261027/632 that way on 2026-10-27), and a NULL column stays NULL
const cp = require("child_process");
const runRead = (gdId) => {
  const sql = node(W, "sql_node_GdCfRead" + k).data.script.code.replace("{{node:code_node_GdCfNeed" + k + ".data.id}}", gdId).replace("{{system:tenantId}}", "000000");
  const out = cp.execFileSync(path.join(P, "..", "..", ".dbtools", "db"), ["--dev", "--json", sql], { encoding: "utf8" });
  return JSON.parse(out.slice(out.indexOf("\n[") + 1));
};
let rows = runRead("2114777649110396930");
const o633 = run("code_node_GdCfOut" + k, { ["code_node_GdCfNeed" + k + ".data.need"]: "1", ["sql_node_GdCfRead" + k + ".data"]: rows });
// expected = 633's raw stored object mapped id -> name here, from separate reads (its values change as sessions test on it)
const dbJson = (s) => { const o = cp.execFileSync(path.join(P, "..", "..", ".dbtools", "db"), ["--dev", "--json", s], { encoding: "utf8" });
  return JSON.parse(o.slice(o.indexOf("\n[") + 1)); };
const rawCf = dbJson("SELECT custom_fields FROM goods_delivery WHERE id = 2114777649110396930")[0].custom_fields;
const raw = typeof rawCf === "string" ? JSON.parse(rawCf) : rawCf;
const idKeys = Object.keys(raw).filter((x) => /^[0-9]+$/.test(x));
assert.ok(idKeys.length > 0, "633 is stored by definition id: " + JSON.stringify(raw));
const defs = Object.fromEntries(dbJson("SELECT CAST(id AS CHAR) id, field_name FROM su_code_custom_field WHERE is_deleted = 0 AND id IN (" +
  idKeys.join(",") + ")").map((d) => [d.id, d.field_name]));
const want = {};
for (const [key, v] of Object.entries(raw)) if (!/^[0-9]+$/.test(key)) want[key] = v; else if (defs[key]) want[defs[key]] = v;
assert.deepStrictEqual(o633, { cf: want }, JSON.stringify(rows));
rows = runRead("2114777555472560129");
const o632 = run("code_node_GdCfOut" + k, { ["code_node_GdCfNeed" + k + ".data.need"]: "1", ["sql_node_GdCfRead" + k + ".data"]: rows });
assert.deepStrictEqual(o632, { cf: {} }, "GD 632 holds {} now: written back as {}");
const nullGd = JSON.parse((() => { const o = cp.execFileSync(path.join(P, "..", "..", ".dbtools", "db"), ["--dev", "--json",
  "SELECT CAST(id AS CHAR) id FROM goods_delivery WHERE tenant_id='000000' AND is_deleted=0 AND custom_fields IS NULL ORDER BY id DESC LIMIT 1"], { encoding: "utf8" });
  return o.slice(o.indexOf("\n[") + 1); })())[0].id;
rows = runRead(nullGd);
const oNull = run("code_node_GdCfOut" + k, { ["code_node_GdCfNeed" + k + ".data.need"]: "1", ["sql_node_GdCfRead" + k + ".data"]: rows });
assert.deepStrictEqual(oNull, { cf: null }, "a NULL column stays NULL: " + JSON.stringify(rows));
ok("live read (dev): GD/20261027/633 comes back by name and is written by name; {} stays {}; NULL stays NULL");

const ids = JSON.stringify(W).match(/"id":"[^"]+"/g);
assert.strictEqual(new Set(ids).size, ids.length, "node ids unique");
ok("node ids unique");
console.log(n + " passed");

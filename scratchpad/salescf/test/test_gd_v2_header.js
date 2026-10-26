// test_gd_v2_header.js: GD Created V2 carries the GD header custom fields. custom_fields joins GDC.header_fields in all three
// copies (GD_BULK_PREPARE code_node_J5T1G2s9 + code_node_egoCivrm, GD_BULK_COMMIT code_node_KBrubvGI) and the hidden-header
// insert add_node_7uwrPwCt writes headerRows.custom_fields. Each node's own header-copy statement is run against its patched
// GDC: an object travels as-is (false kept), an old-shape payload without the key gives null.
// Run: node scratchpad/salescf/test/test_gd_v2_header.js [dev|prod]
const fs = require("fs"), assert = require("assert"), path = require("path");
const ENV = process.argv[2] || "dev", P = path.join(__dirname, "..");
const load = (kind, name) => JSON.parse(fs.readFileSync(path.join(P, kind, ENV, name + ".json"), "utf8"));
const find = (o, id) => {
  if (Array.isArray(o)) { for (const v of o) { const r = find(v, id); if (r) return r; } return null; }
  if (o && typeof o === "object") { if (o.id === id) return o; for (const v of Object.values(o)) { const r = find(v, id); if (r) return r; } }
  return null;
};
const gdc = (code) => JSON.parse(code.match(/const GDC = (\{.*?\});\n/s)[1]);
let n = 0;
const ok = (t) => { n++; console.log("ok", t); };
const COPY = {
  code_node_J5T1G2s9: /const hdr = \{\};\s*for \(const k of GDC\.header_fields\) hdr\[k\] = header\[k\] === undefined \? null : header\[k\];/,
  code_node_egoCivrm: /const hdr = \{\};\s*for \(const k of GDC\.header_fields\) hdr\[k\] = header\[k\] === undefined \? null : header\[k\];/,
  code_node_KBrubvGI: /const h = \{\};\s*for \(const k of GDC\.header_fields\) h\[k\] = p\.header\[k\] === undefined \? null : p\.header\[k\];/,
};
for (const [name, ids] of [["GD_BULK_PREPARE", ["code_node_J5T1G2s9", "code_node_egoCivrm"]], ["GD_BULK_COMMIT", ["code_node_KBrubvGI"]]]) {
  const out = load("out", name), base = load("base", name);
  for (const id of ids) {
    const code = find(out, id).data.script.code, before = find(base, id).data.script.code;
    const a = gdc(code).header_fields, b = gdc(before).header_fields;
    assert.strictEqual(b.length, 111);
    assert.deepStrictEqual(a, b.concat(["custom_fields"]), id + ": custom_fields appended, the rest unchanged");
    assert.strictEqual(code.replace('"sales_person","custom_fields"]', '"sales_person"]'), before, id + ": nothing else changed");
    const stmt = code.match(COPY[id]);
    assert.ok(stmt, id + ": the header-copy statement is unchanged");
    const GDC = gdc(code);
    const copy = (hdrIn) => new Function("GDC", "header", "p", stmt[0] + " return " + (id === "code_node_KBrubvGI" ? "h" : "hdr") + ";")(GDC, hdrIn, { header: hdrIn });
    assert.deepStrictEqual(copy({ customer_name: "1", custom_fields: { lsh_envelope: false, lsh_restday: "Sun" } }).custom_fields, { lsh_envelope: false, lsh_restday: "Sun" });
    assert.strictEqual(copy({ customer_name: "1" }).custom_fields, null);
  }
}
ok("all three GDC copies list 112 header fields (custom_fields last), nothing else changed; each node's copy keeps the object, an old payload gives null");

const add = find(load("out", "GD_BULK_COMMIT"), "add_node_7uwrPwCt").data.props.list;
const addBase = find(load("base", "GD_BULK_COMMIT"), "add_node_7uwrPwCt").data.props.list;
assert.strictEqual(add.find((p) => p.prop === "custom_fields").value, "{{node:code_node_KBrubvGI.data.headerRows.custom_fields}}");
assert.deepStrictEqual(add.filter((p) => p.prop !== "custom_fields"), addBase);
ok("add_node_7uwrPwCt writes headerRows.custom_fields; its other 114 props unchanged");
console.log(n + " passed");

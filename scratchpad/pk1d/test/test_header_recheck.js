// test_header_recheck.js [PICKING_BULK_COMMIT.json]: phase B's header re-check, run from the workflow file as built.
// Two confirms of one Picking that commit within milliseconds each roll the header up from their own view, so both can write
// In Progress over rows that are all Completed (LSH PI-2610-3697, 10-26). Phase B re-reads the stored rows and promotes the
// header with P1's own rule; nothing else is ever changed. Exit 0 only if every case holds.
const fs = require("fs");
const file = process.argv[2] || __dirname + "/../../../Picking/AsyncV2/PICKING_BULK_COMMIT.json";
const w = JSON.parse(fs.readFileSync(file, "utf8"));
const find = (o, id) => {
  if (o && typeof o === "object") {
    if (o.id === id) return o;
    for (const v of Object.values(o)) { const r = find(v, id); if (r) return r; }
  }
  return null;
};
const node = find(w, "code_node_PCbhdr");
const cases = [];
const check = (name, got, want) => cases.push([name, JSON.stringify(got), JSON.stringify(want)]);
if (!node) {
  check("phase B has the header re-check node code_node_PCbhdr", "missing", "present");
} else {
  const code = node.data.script.code;
  const holders = [...new Set(code.match(/\{\{[^}]+\}\}/g))];
  const run = (row) => {
    const vals = { "node:sql_node_PCbhdr.data": row, "node:code_node_PCentry.data.pickingId": "2114537096101367810" };
    let body = code;
    const names = holders.map((_, i) => "__p" + i);
    holders.forEach((h, i) => { body = body.split(h).join(names[i]); });
    const args = holders.map((h) => {
      const k = h.slice(2, -2);
      if (!(k in vals)) throw new Error("test has no value for " + h);
      return JSON.parse(JSON.stringify(vals[k]));
    });
    const r = new Function(...names, body)(...args);
    return [r.needHdr, (r.hdrRows || []).map((x) => [x.id, x.to_status])];
  };
  const R = (to_status, live_rows, completed_rows) => [{ to_status: to_status, live_rows: String(live_rows), completed_rows: String(completed_rows) }];
  check("LSH PI-2610-3697: In Progress, 5 of 5 rows Completed -> Completed", run(R("In Progress", 5, 5)), ["YES", [["2114537096101367810", "Completed"]]]);
  check("one row still open -> unchanged", run(R("In Progress", 5, 4)), ["NO", []]);
  check("already Completed -> unchanged", run(R("Completed", 5, 5)), ["NO", []]);
  check("Cancelled header -> unchanged", run(R("Cancelled", 2, 2)), ["NO", []]);
  check("every row cancelled (no live row) -> unchanged", run(R("In Progress", 0, 0)), ["NO", []]);
  check("Created header over Completed rows -> Completed", run(R("Created", 3, 3)), ["YES", [["2114537096101367810", "Completed"]]]);
  check("the read returned nothing -> unchanged", run([]), ["NO", []]);
  check("a single object instead of rows -> read alike", run(R("In Progress", 1, 1)[0]), ["YES", [["2114537096101367810", "Completed"]]]);
}
let ok = true;
for (const [name, got, want] of cases) { const pass = got === want; ok = ok && pass; console.log((pass ? "ok   " : "FAIL ") + name + ": " + got + (pass ? "" : "  (want " + want + ")")); }
console.log(ok ? cases.length + "/" + cases.length + " passed" : "header re-check test FAILED");
process.exit(ok ? 0 : 1);

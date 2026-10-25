// Runs the new P4 plan (COMMIT) on stand-in rows, and compiles PREPARE's plan2. Usage: node test_p4.js <out dir>
const fs = require("fs");
const path = require("path");
const out = process.argv[2];
const find = (o, id) => {
  if (o && typeof o === "object") {
    if (o.id === id) return o;
    for (const v of Object.values(o)) { const r = find(v, id); if (r) return r; }
  }
  return null;
};
let fails = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : "  got " + JSON.stringify(got) + " want " + JSON.stringify(want)));
};
const commit = JSON.parse(fs.readFileSync(path.join(out, "PACKING_BULK_COMMIT.json")));
const code = find(commit, "code_node_KCp4plan").data.script.code;
const plan = (entry, row) => new Function("console", code
  .split("{{node:code_node_KCentry.data}}").join(JSON.stringify(entry))
  .split("{{node:sql_node_KCp4data.data}}").join(JSON.stringify(row)))({ log() {} });
const SO = "2113391714738774034", SO2 = "2113391803221811203";
const A = "2112751489737949186", B = "2112751544939184129";
const entryA = { gdId: A, packingId: "9001", jobId: "1", attempts: 0 };
const soNew = (ids, lines) => JSON.stringify({ flip_ids: [], line_ids: [], so_ids: ids, so_ids_json: "[" + ids.map((x) => x + ',"' + x + '"').join(",") + "]", so_lines: lines });
const sib = (id, so, ps, gs) => ({ id, gd_status: gs || "Created", packing_status: ps, so_id_json: '["' + so + '"]' });

// old payload: the frozen decision is used as is
let r = plan(entryA, { so: JSON.stringify({ flip_ids: [SO], line_ids: ["11", "12"] }), sibs: null });
check("old payload keeps flip_ids", [r.soIdsSql, r.lineIdsSql], [SO, "11,12"]);
r = plan(entryA, { so: JSON.stringify({ flip_ids: [], line_ids: [] }), sibs: null });
check("old payload, no flip", [r.hasSo, r.hasLines], ["NO", "NO"]);
// new payload, decided at commit time
const lines = [["11", SO], ["12", SO]];
r = plan(entryA, { so: soNew([SO], lines), sibs: JSON.stringify([sib(A, SO, "Completed")]) });
check("only this delivery -> flip + its lines", [r.soIdsSql, r.lineIdsSql, r.lineRows[0].packing_no], [SO, "11,12", "9001"]);
r = plan(entryA, { so: soNew([SO], lines), sibs: JSON.stringify([sib(A, SO, "Completed"), sib(B, SO, "")]) });
check("sibling still unpacked -> no flip", [r.hasSo, r.hasLines], ["NO", "NO"]);
r = plan(entryA, { so: soNew([SO], lines), sibs: JSON.stringify([sib(A, SO, "Completed"), sib(B, SO, "Completed")]) });
check("sibling packed meanwhile -> flip", [r.soIdsSql, r.lineIdsSql], [SO, "11,12"]);
r = plan(entryA, { so: soNew([SO], lines), sibs: JSON.stringify([sib(A, SO, "Completed"), sib(B, SO, "", "Cancelled")]) });
check("cancelled sibling ignored -> flip", r.soIdsSql, SO);
r = plan(entryA, { so: soNew([SO], lines), sibs: null });
check("no sibling rows at all -> flip", r.soIdsSql, SO);
// two SOs, one still open: only its lines stay
const lines2 = [["11", SO], ["21", SO2], ["99", ""]];
r = plan(entryA, { so: soNew([SO, SO2], lines2), sibs: JSON.stringify([sib(A, SO, "Completed"), sib(B, SO2, "")]) });
check("two SOs, one open -> flip one, unmapped line waits", [r.soIdsSql, r.lineIdsSql], [SO, "11"]);
r = plan(entryA, { so: soNew([SO, SO2], lines2), sibs: JSON.stringify([sib(A, SO, "Completed")]) });
check("two SOs, both closed -> unmapped line written too", [r.soIdsSql, r.lineIdsSql], [SO + "," + SO2, "11,21,99"]);
// the race: A and B (one SO) interleaved; each P4 reads the GD rows as they stand when it runs
const entryB = { gdId: B, packingId: "9002", jobId: "2", attempts: 0 };
const st = { [A]: "", [B]: "" };
const p4 = (e, mine) => plan(e, { so: soNew([SO], [[mine, SO]]), sibs: JSON.stringify([sib(A, SO, st[A]), sib(B, SO, st[B])]) }).hasSo;
st[A] = "Completed"; st[B] = "Completed"; // A.P3, B.P3, then both P4
check("race: P3 P3 P4 P4 -> both flip", [p4(entryA, "11"), p4(entryB, "12")], ["YES", "YES"]);
st[A] = "", st[B] = "";
st[A] = "Completed"; const a1 = p4(entryA, "11"); st[B] = "Completed"; const b1 = p4(entryB, "12"); // A.P3 A.P4 B.P3 B.P4
check("race: A runs first -> the later job flips", [a1, b1], ["NO", "YES"]);

// PREPARE plan2 must still compile with the new payload line
const prep = JSON.parse(fs.readFileSync(path.join(out, "PACKING_BULK_PREPARE.json")));
const c2 = find(prep, "code_node_KPplan2").data.script.code.replace(/\{\{node:[^}]+\}\}/g, "null");
try { new Function("console", c2); check("PREPARE plan2 compiles", true, true); } catch (e) { check("PREPARE plan2 compiles", e.message, true); }
check("PREPARE payload names the candidates", /so_ids: list\(w\.soIds\), so_ids_json: s\(p1\.soIdsJson\)/.test(c2), true);
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);

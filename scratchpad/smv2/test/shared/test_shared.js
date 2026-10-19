// Unit tests of scratchpad/smv2/code/shared/*.js (node test/shared/test_shared.js). No database, no network.
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const SH = path.join(__dirname, "..", "..", "code", "shared");
const C = require(path.join(SH, "lot_common.js"));
const F = require(path.join(SH, "fingerprint.js"));
const M = require(path.join(SH, "movekey.js"));

let fails = 0;
let n = 0;
const t = (label, fn) => {
  n++;
  try {
    fn();
    console.log("ok   " + label);
  } catch (e) {
    fails++;
    console.log("FAIL " + label + "\n     " + String(e.message).split("\n").join("\n     ").slice(0, 900));
  }
};
const eq = (a, b) => assert.deepStrictEqual(a, b);

// ------------------------------------------------------------------------------------------- lot_common.js
t("lotQ8: 8 dp NUMBER, float residue gone, junk -> 0", () => {
  eq(C.lotQ8(0.1 + 0.2), 0.3);
  eq(C.lotQ8("1.123456789"), 1.12345679);
  eq(C.lotQ8("abc"), 0);
  eq(C.lotQ8(null), 0);
  eq(typeof C.lotQ8("2"), "number");
});
t("lotQtyStr: 8-dp STRING, never negative (the ledger's qtyStr)", () => {
  eq(C.lotQtyStr(2), "2.00000000");
  eq(C.lotQtyStr(-0.5), "0.00000000");
  eq(C.lotQtyStr("1.5000000001"), "1.50000000");
});
t("lotIdStr: digit strings kept, safe integers stringified, an unsafe 19-digit NUMBER refused", () => {
  eq(C.lotIdStr(" 2105231525751984129 "), "2105231525751984129");
  eq(C.lotIdStr(12), "12");
  eq(C.lotIdStr(2105231525751984129), "");
  eq(C.lotIdStr(-1), "");
  eq(C.lotIdStr("12a"), "");
  eq(C.lotIdStr(null), "");
  eq(C.lotDigits("000123"), true);
  eq(C.lotDigits(""), false);
});
t("lotParseJ: bare 16+ digit integers become strings; decimals and quoted text untouched; bad text -> null", () => {
  eq(C.lotParseJ('{"id":2105231525751984129,"q":1.5,"s":"2105231525751984129","big":12345678901234567.5}'),
    { id: "2105231525751984129", q: 1.5, s: "2105231525751984129", big: 12345678901234567.5 });
  eq(C.lotParseJ("{bad"), null);
  eq(C.lotParseJ(null), null);
  eq(C.lotParseJ({ a: 1 }), { a: 1 });
});
t("lotParseJ: a float's 16+ fraction digits are NOT quoted (0.30000000000000004 parses as a number)", () => {
  eq(C.lotParseJ('{"q":0.30000000000000004}'), { q: 0.30000000000000004 });
  eq(C.lotParseJ('[0.12345678901234567, -1.00000000000000002]'), [0.12345678901234567, -1.00000000000000002]);
  eq(C.lotParseJ('{"temp_qty_data":[{"sm_quantity":0.30000000000000004,"material_id":2064633018934157313}]}'),
    { temp_qty_data: [{ sm_quantity: 0.30000000000000004, material_id: "2064633018934157313" }] });
});
t("lotParseJ: 19-digit ids stay exact strings - after : [ , and at the start, with blanks, negative, in arrays", () => {
  eq(C.lotParseJ('{"id":2105231525751984129,"ids":[2105231525751984129, 2105231525751984130 ],"neg":-2105231525751984129,"f":1234567890.1234567890123,"s":"x 2105231525751984129"}'),
    { id: "2105231525751984129", ids: ["2105231525751984129", "2105231525751984130"], neg: "-2105231525751984129", f: 1234567890.1234567890123, s: "x 2105231525751984129" });
  eq(C.lotParseJ(" 2105231525751984129 "), "2105231525751984129");
  eq(C.lotParseJ('{"a":\n 2105231525751984129\n}'), { a: "2105231525751984129" });
  eq(C.lotParseJ('{"small":123456789012345,"exp":12345678901234567e2}'), { small: 123456789012345, exp: 12345678901234567e2 });
});
t("lotJsonList: JSON text or array -> array; empty / scalar / bad -> []", () => {
  eq(C.lotJsonList('[{"a":1}]'), [{ a: 1 }]);
  eq(C.lotJsonList([{ a: 1 }]), [{ a: 1 }]);
  eq(C.lotJsonList(""), []);
  eq(C.lotJsonList(null), []);
  eq(C.lotJsonList('{"a":1}'), []);
  eq(C.lotJsonList("not json"), []);
});
t("lotRows: sql JSON_OBJECT rows and plain objects alike", () => {
  eq(C.lotRows([{ j: '{"id":"1","x":2105231525751984129}' }, { id: "2" }, null, { j: "{bad" }]), [{ id: "1", x: "2105231525751984129" }, { id: "2" }]);
  eq(C.lotRows({ j: '{"id":"3"}' }), [{ id: "3" }]);
});
t("lotCategory: UNR / BLK as code_node_yPlLXIZW normalizes them", () => {
  eq([C.lotCategory("UNR"), C.lotCategory("BLK"), C.lotCategory("Unrestricted"), C.lotCategory(""), C.lotCategory("In Transit")], ["Unrestricted", "Blocked", "Unrestricted", "", "In Transit"]);
});
t("lotPrevStatusOk: only Draft / In Progress", () => {
  eq(["Draft", "In Progress", "", "Processing", "Completed", null].map(C.lotPrevStatusOk), [true, true, false, false, false, false]);
});
t("lotDbAddSeconds: DB clock text + seconds", () => {
  eq(C.lotDbAddSeconds("2026-10-16 23:59:30", 120), "2026-10-17 00:01:30");
  eq(C.lotDbAddSeconds("bad", 5), "");
});
t("lotPartRows / lotJoinChunks: 400,000-character chunks S|<nonce>|LINES|nnn round-trip, ids exact", () => {
  const big = { lines: Array.from({ length: 9000 }, (_, i) => ({ id: "2105231525764567" + String(i).padStart(3, "0"), temp_qty_data: "x".repeat(80) })) };
  const rows = C.lotPartRows("2111005120857767938", "1123598813738675201", "S|ab12cd34|LINES|", big);
  assert.ok(rows.length >= 2, "expected several chunks, got " + rows.length);
  eq(Object.keys(rows[0]), ["job_id", "organization_id", "step_name", "step_status", "attempt_count", "result_ref"]);
  eq(rows.map((r) => r.step_name).slice(0, 2), ["S|ab12cd34|LINES|001", "S|ab12cd34|LINES|002"]);
  assert.ok(rows.every((r) => r.result_ref.length <= C.LOT_CHUNK && r.step_name.length <= 32 && r.step_status === "PAYLOAD"));
  const shuffled = rows.slice().reverse().concat([{ step_name: "S|ab12cd34|OTHER|001", result_ref: "{}" }]);
  eq(C.lotJoinChunks(shuffled, "S|ab12cd34|LINES|"), big);
  eq(C.lotJoinChunks(rows, "S|zzzzzzzz|LINES|"), null);
  eq(C.lotJoinChunks([{ step_name: "S|a|LINES|001", result_ref: "{bro" }], "S|a|LINES|"), undefined);
  eq(C.lotPartRows("1", "2", "P|n|HDR|", {}).length, 1);
});

// ------------------------------------------------------------------------------------------- fingerprint.js
const tqd = (entries) => JSON.stringify(entries);
const base = () => [
  { id: "2105231525764567045", line_index: "3", item_selection: "2069242655534825474", total_quantity: 2, quantity_uom: "1940", location_id: "2018912822846582786",
    temp_qty_data: tqd([{ material_id: "2069242655534825474", location_id: "2018912822846582700", batch_id: "", category: "Unrestricted", sm_quantity: 2, material_uom: "1940" }]) },
  { id: "2105231525764567046", line_index: "4", item_selection: "2064633018934157313", total_quantity: 4, quantity_uom: "1940", location_id: "2018912822846582786",
    temp_qty_data: tqd([{ material_id: "2064633018934157313", location_id: "2018912822846582700", batch_id: "2069333288379301890", category: "UNR", sm_quantity: "3", material_uom: "1940" },
      { material_id: "2064633018934157313", location_id: "2018912822846582701", batch_id: "2074794389877096450", category: "Blocked", sm_quantity: 1, material_uom: "1940" }]) },
];
const fp = F.lotLineFingerprint;
t("fingerprint: format LF1:<lines>:<16 hex>, deterministic", () => {
  assert.match(fp(base()), /^LF1:2:[0-9a-f]{16}$/);
  eq(fp(base()), fp(base()));
});
t("fingerprint: row order, sql {j} rows, temp_qty_data text vs array, number vs string, UNR vs Unrestricted are all the same", () => {
  const a = fp(base());
  eq(fp(base().reverse()), a);
  eq(fp(base().map((l) => ({ j: JSON.stringify(l) }))), a);
  eq(fp(base().map((l) => Object.assign({}, l, { temp_qty_data: JSON.parse(l.temp_qty_data) }))), a);
  const b = base();
  const e = JSON.parse(b[1].temp_qty_data);
  e[0].sm_quantity = 3.0000000001;
  e[0].category = "Unrestricted";
  b[1].temp_qty_data = JSON.stringify(e);
  b[0].line_index = 3;
  eq(fp(b), a);
});
t("fingerprint: a temp_qty_data holding a float residue (0.30000000000000004) parses - not RAW - and equals 0.3", () => {
  const mk = (q) => [{ id: "2105231525764567045", line_index: "1", item_selection: "2069242655534825474", quantity_uom: "1940", location_id: "2018912822846582786",
    temp_qty_data: '[{"material_id":"2069242655534825474","location_id":2018912822846582700,"sm_quantity":' + q + '}]' }];
  const row = F.lotFpCanonRows(mk("0.30000000000000004"))[0];
  assert.ok(Array.isArray(row[5]), "entries were fingerprinted as RAW text: " + JSON.stringify(row[5]));
  eq(row[5][0][1], "2018912822846582700");
  eq(fp(mk("0.30000000000000004")), fp(mk("0.3")));
});
t("fingerprint: total_quantity and the other decimal columns are ignored (stored rounding), so are unknown keys", () => {
  const b = base();
  b[0].total_quantity = 2.0004;
  b[1].requested_qty = 99;
  b[1].item_name = "renamed";
  eq(fp(b), fp(base()));
});
t("fingerprint: every movement-relevant change changes it", () => {
  const a = fp(base());
  const mut = (f) => {
    const b = base();
    f(b);
    return fp(b);
  };
  const entry = (f) => (b) => {
    const e = JSON.parse(b[1].temp_qty_data);
    f(e);
    b[1].temp_qty_data = JSON.stringify(e);
  };
  const changed = [
    mut((b) => (b[0].location_id = "2018912822846582787")),
    mut((b) => (b[0].quantity_uom = "1941")),
    mut((b) => (b[0].item_selection = "2069242655534825475")),
    mut((b) => (b[0].line_index = "9")),
    mut((b) => (b[0].id = "2105231525764567047")),
    mut((b) => b.pop()),
    mut(entry((e) => (e[0].sm_quantity = 3.5))),
    mut(entry((e) => (e[0].location_id = "2018912822846582799"))),
    mut(entry((e) => (e[0].batch_id = "2069333288379301891"))),
    mut(entry((e) => (e[1].category = "Unrestricted"))),
    mut(entry((e) => (e[0].material_uom = "1941"))),
    mut(entry((e) => (e[0].handling_unit_id = "2100000000000000001"))),
    mut(entry((e) => e.reverse())),
    mut(entry((e) => e.push({ material_id: "2064633018934157313", location_id: "2018912822846582701", sm_quantity: 0 }))),
  ];
  changed.forEach((x, i) => assert.notStrictEqual(x, a, "mutation " + i + " did not change the fingerprint"));
  eq(new Set(changed).size, changed.length);
});
t("fingerprint: an unparsable temp_qty_data is fingerprinted as its raw text (a change still shows); empty lists", () => {
  const b = base();
  b[0].temp_qty_data = "{not json";
  const x = fp(b);
  b[0].temp_qty_data = "{not json!";
  assert.notStrictEqual(fp(b), x);
  assert.match(fp([]), /^LF1:0:[0-9a-f]{16}$/);
  eq(fp(null), fp([]));
  eq(F.lotFpCanonRows([{ id: 2105231525764567045 }])[0][0].indexOf("?"), 0);
});
t("fingerprint: 2,000 lines x 2 entries in well under a second", () => {
  const lines = [];
  for (let i = 0; i < 2000; i++) {
    lines.push({ id: String(2105231525764567045n + BigInt(i)), line_index: String(i + 1), item_selection: "2069242655534825474", quantity_uom: "1940", location_id: "2018912822846582786",
      temp_qty_data: tqd([{ material_id: "2069242655534825474", location_id: "2018912822846582700", category: "Unrestricted", sm_quantity: 1 },
        { material_id: "2069242655534825474", location_id: "2018912822846582701", category: "Blocked", sm_quantity: 2 }]) });
  }
  const t0 = Date.now();
  const x = fp(lines);
  assert.ok(Date.now() - t0 < 1000, "took " + (Date.now() - t0) + " ms");
  assert.match(x, /^LF1:2000:/);
});

// ------------------------------------------------------------------------------------------- movekey.js
const labels = {
  M12: { line_index: "3", line_id: "2105231525764567045", item_code: "A-001", item_name: "Widget", bin: "A1-B2", bin_id: "2018912822846582700", category: "Unrestricted", side: "from" },
  "M12.2": { line_index: "3", item_code: "A-001", bin: "C1-D1", category: "In Transit", side: "to" },
  M13: { line_index: "4", item_name: "Gadget" },
};
t("movekey: the engine's '(movement M<n>)' suffix -> the line, item, bin and category", () => {
  eq(M.lotMovementKeyOf("Insufficient quantity (movement M12)"), "M12");
  eq(M.lotMapEngineMessage("Insufficient quantity (movement M12)", labels), "Insufficient quantity - line 3 (A-001), from bin A1-B2 (Unrestricted)");
  eq(M.lotMapEngineMessage("Balance not found (movement M12.2)", labels), "Balance not found - line 3 (A-001), to bin C1-D1 (In Transit)");
  eq(M.lotMapEngineMessage("Item 5 has costing rows that need migration (FIFO 1, WA 1) (movement M13)", labels), "Item 5 has costing rows that need migration (FIFO 1, WA 1) - line 4 (Gadget)");
});
t("movekey: the guard's 'movements[<i>] ...' through the ENGINE key list", () => {
  eq(M.lotMovementKeyOf("movements[1] location_id must be digits", ["M12", "M12.2"]), "M12.2");
  eq(M.lotMapEngineMessage("movements[0] material_id must be digits", labels, ["M12", "M12.2"]), "material_id must be digits - line 3 (A-001), from bin A1-B2 (Unrestricted)");
});
t("movekey: unknown key / no labels / no key -> the engine text unchanged", () => {
  eq(M.lotMapEngineMessage("Insufficient quantity (movement M99)", labels), "Insufficient quantity (movement M99)");
  eq(M.lotMapEngineMessage("Insufficient quantity (movement M12)", null), "Insufficient quantity (movement M12)");
  eq(M.lotMapEngineMessage("Another operation took a lock before this one could", labels), "Another operation took a lock before this one could");
  eq(M.lotMapEngineMessage(undefined, labels), "");
});

// ------------------------------------------------------------------------------------------- the builder's include rule
t("include: the shared files concatenate with a GR COMMIT step's helpers (s, q8, list, digits, parseJ) and compile", () => {
  const strip = (f) => fs.readFileSync(path.join(SH, f), "utf8").split("\n").filter((l) => !l.startsWith("if (typeof module")).join("\n");
  const grc = path.join(__dirname, "..", "..", "..", "grv2", "code", "commit");
  const src = [fs.readFileSync(path.join(grc, "_common.js"), "utf8"), fs.readFileSync(path.join(grc, "_cmp.js"), "utf8"), strip("lot_common.js"), strip("fingerprint.js"), strip("movekey.js"),
    "return { fp: lotLineFingerprint, map: lotMapEngineMessage, q8: q8, lotQ8: lotQ8 };"].join("\n");
  assert.ok(!/\{\{/.test(src));
  const m = new Function(src)();
  eq(m.fp(base()), fp(base()));
  eq(typeof m.map, "function");
  eq(m.q8("1.000000001"), m.lotQ8("1.000000001"));
});

console.log(fails ? fails + " of " + n + " FAILED" : "all " + n + " passed");
process.exit(fails ? 1 : 0);

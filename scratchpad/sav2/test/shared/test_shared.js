// node test/shared/test_shared.js - unit tests of code/shared (sa_common.js, fingerprint.js, movekey.js)
const path = require("path");
const C = require(path.join(__dirname, "../../code/shared/sa_common.js"));
const F = require(path.join(__dirname, "../../code/shared/fingerprint.js"));
const M = require(path.join(__dirname, "../../code/shared/movekey.js"));
let fails = 0, n = 0;
const eq = (name, got, want) => {
  n++;
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { fails++; console.log("FAIL", name, "\n  got ", g, "\n  want", w); }
};

// --- sa_common
eq("q8", C.saQ8("1.123456789"), 1.12345679);
eq("qtyStr clamps", C.saQtyStr(-2), "0.00000000");
eq("idStr 19 digits", C.saIdStr(" 2104431462706188289 "), "2104431462706188289");
eq("idStr unsafe number", C.saIdStr(2104431462706188289), "");
eq("parseJ ids", C.saParseJ('{"a":2104431462706188289,"b":0.30000000000000004,"c":[1234567890123456,1]}'), { a: "2104431462706188289", b: 0.30000000000000004, c: ["1234567890123456", 1] });
eq("parseJ bad", C.saParseJ("{x"), null);
eq("jsonList text", C.saJsonList('[{"a":1}]'), [{ a: 1 }]);
eq("jsonList blank", C.saJsonList(""), []);
eq("rows j", C.saRows([{ j: '{"id":2104431462706188289}' }, { id: "5" }, null]), [{ id: "2104431462706188289" }, { id: "5" }]);
eq("category default", C.saCategory(""), "Unrestricted");
eq("direction In", C.saDirection("In"), "ADD");
eq("direction OUT", C.saDirection("OUT"), "SUBTRACT");
eq("direction out", C.saDirection(" out "), "SUBTRACT");
eq("direction bad", [C.saDirection(null), C.saDirection(""), C.saDirection("adjust")], ["", "", ""]);
eq("utf8 ascii", C.saUtf8Bytes("abc"), 3);
eq("utf8 cjk", C.saUtf8Bytes("规则"), 6);
eq("utf8 array", C.saUtf8Bytes([{ a: "é" }]), JSON.stringify([{ a: "é" }]).length + 1);
eq("prev ok", [C.saPrevStatusOk("Draft"), C.saPrevStatusOk("Cancelled"), C.saPrevStatusOk("In Progress"), C.saPrevStatusOk("")], [true, true, false, false]);
const big = "x".repeat(C.SA_CHUNK + 5);
const parts = C.saPartRows("9", "8", "S|abcd1234|DOC|", { big }, "PAYLOAD");
eq("parts count", parts.length, 2);
eq("parts names", parts.map((p) => p.step_name), ["S|abcd1234|DOC|001", "S|abcd1234|DOC|002"]);
eq("join", C.saJoinChunks(parts.slice().reverse(), "S|abcd1234|DOC|"), { big });
eq("join none", C.saJoinChunks([], "S|x|"), null);
eq("dbAdd", C.saDbAddSeconds("2026-10-16 23:59:30", 120), "2026-10-17 00:01:30");

// --- fingerprint (SA: id-free, line_index order; balance_index text verbatim)
const bi = '[{"balance_id":"2094671156649459714","movement_type":"In","sa_quantity":2,"category":"Unrestricted"}]';
const a = [{ id: "1", line_index: "2", material_id: "77", uom_id: "5", total_quantity: "2", unit_price: "1.5", balance_index: bi },
  { id: "2", line_index: "1", material_id: "66", uom_id: "5", total_quantity: "3", unit_price: 0, balance_index: "[]" }];
const b = [{ line_index: "1", material_id: "66", uom_id: 5, total_quantity: "3", unit_price: "0.00000000", balance_index: "[]" },
  { line_index: "2", material_id: "77", uom_id: "5", total_quantity: "2", unit_price: 1.5, balance_index: JSON.parse(bi.replace("2094671156649459714", '"2094671156649459714"'.slice(1, -1))) }];
eq("SAF id-free + order", F.saLineFingerprint(a), F.saLineFingerprint([{ j: JSON.stringify(a[1]) }, a[0]]));
eq("SAF format", /^SAF1:2:[0-9a-f]{16}$/.test(F.saLineFingerprint(a)), true);
eq("SAF qty change", F.saLineFingerprint(a) === F.saLineFingerprint([a[0], { ...a[1], total_quantity: "4" }]), false);
eq("SAF price 8dp", F.saLineFingerprint(a), F.saLineFingerprint([{ ...a[0], unit_price: "1.50000000" }, a[1]]));
eq("SAF empty", F.saLineFingerprint([]), "SAF1:0:" + F.saFpHash("[]"));
eq("SAF parsed bi", F.saLineFingerprint([{ line_index: "1", material_id: "1", uom_id: "1", total_quantity: "1", unit_price: 0, balance_index: [{ a: 1 }] }]),
  F.saLineFingerprint([{ line_index: "1", material_id: "1", uom_id: "1", total_quantity: "1", unit_price: 0, balance_index: '[{"a":1}]' }]));
const s1 = [{ id: "2097986080484016131", line_index: "1", line_status: "Approved", review_status: "Approved", is_counted: 1, count_qty: "5.00000000", adjusted_qty: null, variance_qty: "-1" },
  { id: "2097986080484016130", line_index: "2", line_status: "Counted", review_status: "", is_counted: 1, count_qty: 3, adjusted_qty: "", variance_qty: 0 }];
eq("SCF order + forms", F.scLineFingerprint(s1), F.scLineFingerprint([s1[1], { ...s1[0], count_qty: 5, variance_qty: "-1.00000000" }]));
eq("SCF status change", F.scLineFingerprint(s1) === F.scLineFingerprint([{ ...s1[0], line_status: "Adjusted" }, s1[1]]), false);
eq("SCF format", /^SCF1:2:[0-9a-f]{16}$/.test(F.scLineFingerprint(s1)), true);

// --- movekey
const labels = { M3: { line_index: "4", line_id: "9", item_code: "FG-0042", item_name: "Widget", bin: "A1-B2", bin_id: "7", category: "Unrestricted", side: "out" } };
eq("map suffix", M.saMapEngineMessage("Insufficient quantity (movement M3)", labels, ["M1", "M2", "M3"]), "Insufficient quantity - line 4 (FG-0042), bin A1-B2 (Unrestricted)");
eq("map index", M.saMapEngineMessage("movements[2] material_id must be digits", labels, ["M1", "M2", "M3"]), "material_id must be digits - line 4 (FG-0042), bin A1-B2 (Unrestricted)");
eq("map unknown", M.saMapEngineMessage("Lock busy", labels, ["M1"]), "Lock busy");

console.log(fails ? `${fails} of ${n} FAILED` : `ok ${n}`);
process.exit(fails ? 1 : 0);

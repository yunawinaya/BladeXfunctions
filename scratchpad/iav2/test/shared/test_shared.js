// node scratchpad/iav2/test/shared/test_shared.js - unit tests of scratchpad/iav2/code/shared/*.js
const fs = require("fs");
const path = require("path");
const SHARED = path.join(__dirname, "..", "..", "code", "shared");
const TPL = path.join(__dirname, "..", "..", "tpl");
const C = require(path.join(SHARED, "ia_common.js"));
const F = require(path.join(SHARED, "fingerprint.js"));
const M = require(path.join(SHARED, "movekey.js"));
const P = require(path.join(SHARED, "price.js"));

let fails = 0;
let n = 0;
const eq = (label, got, want) => {
  n++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) {
    fails++;
    console.log("FAIL " + label + "\n  got  " + JSON.stringify(got) + "\n  want " + JSON.stringify(want));
  }
};
const yes = (label, v) => eq(label, !!v, true);
const no = (label, v) => eq(label, !!v, false);

// ---------------------------------------------------------------- ia_common
eq("q8 residue", C.iaQ8(0.1 + 0.2), 0.3);
eq("q8 text", C.iaQ8("1.320000004"), 1.32);
eq("q8 garbage", C.iaQ8("x"), 0);
eq("qtyStr", C.iaQtyStr(1.32), "1.32000000");
eq("qtyStr clamps", C.iaQtyStr(-0.5), "0.00000000");
eq("idStr digits", C.iaIdStr(" 2098256587713404929 "), "2098256587713404929");
eq("idStr unsafe number", C.iaIdStr(2098256587713404929), "");
eq("idStr safe number", C.iaIdStr(12345), "12345");
eq("idStr text", C.iaIdStr("12a"), "");
eq("parseJ big int", C.iaParseJ('{"a":2098256587713404929,"b":[2098256587713404930]}'), { a: "2098256587713404929", b: ["2098256587713404930"] });
eq("parseJ float residue kept", C.iaParseJ('{"q":0.30000000000000004}').q, 0.30000000000000004);
eq("parseJ string untouched", C.iaParseJ('{"s":"x 2098256587713404929"}').s, "x 2098256587713404929");
eq("parseJ bad", C.iaParseJ("{"), null);
eq("jsonList text", C.iaJsonList('[{"a":1}]'), [{ a: 1 }]);
eq("jsonList empty", C.iaJsonList(""), []);
eq("jsonList object", C.iaJsonList('{"a":1}'), []);
eq("rows", C.iaRows([{ j: '{"id":2098256587713404929}' }, { id: "1" }, null]), [{ id: "2098256587713404929" }, { id: "1" }]);
eq("idsSql", C.iaIdsSql({ "5": true, "x": true, "5 ": true }), "0,5");
eq("idsSql list", C.iaIdsSql(["2098256587713404929", "", "2098256587713404929"]), "0,2098256587713404929");
eq("category", [C.iaCategory(""), C.iaCategory(null), C.iaCategory("Blocked")], ["Unrestricted", "Unrestricted", "Blocked"]);
const line = { temp_qty_data: '[{"sm_quantity":7,"location_id":"1"},{"sm_quantity":0},{"sm_quantity":"0.5"},{"sm_quantity":-1}]' };
eq("picks", C.iaPicks(line).length, 2);
eq("picks array", C.iaPicks({ temp_qty_data: [{ sm_quantity: 1 }] }).length, 1);
eq("picks unparseable", C.iaPicks({ temp_qty_data: "[{bad" }).length, 0);
eq("pickCount", C.iaPickCount([line, { temp_qty_data: "" }, line]), 4);
yes("hu pick", C.iaLineHasHu({ temp_qty_data: '[{"sm_quantity":0,"handling_unit_id":"9"}]' }));
yes("hu data", C.iaLineHasHu({ temp_qty_data: "[]", temp_hu_data: '[{"x":1}]' }));
no("hu none", C.iaLineHasHu({ temp_qty_data: '[{"sm_quantity":1,"handling_unit_id":""}]', temp_hu_data: "[]" }));
eq("dbAddSeconds", C.iaDbAddSeconds("2026-10-19 23:59:50", 120), "2026-10-20 00:01:50");
eq("dbAddSeconds bad", C.iaDbAddSeconds("", 5), "");
eq("dbSeconds", C.iaDbSeconds("2026-10-19 10:00:00", "2026-10-19 10:30:01"), 1801);
yes("prev Draft", C.iaPrevStatusOk("Draft"));
no("prev Completed", C.iaPrevStatusOk("Completed"));
no("prev empty", C.iaPrevStatusOk(""));
const JOB = "2111005120857767938";
eq("op key I", C.iaOpKey(JOB, "I"), "IAC|" + JOB + "|I");
eq("op key R", C.iaOpKey(JOB, "R"), "IAC|" + JOB + "|R");
eq("op key length", C.iaOpKey(JOB, "I").length, 25);
yes("op key engine regex", /^[A-Za-z0-9|:._-]{1,32}$/.test(C.iaOpKey(JOB, "R")));
yes("lock job <= 32", C.iaLockJob("2098256587713404929").length <= 32);
eq("correlation", C.iaCorrelation("5"), "IA|5");
yes("part name <= 32", ("P|abcd1234|NONSTOCK|001").length <= 32 && ("P|abcd1234|ENGINE_I|001").length <= 32);
yes("key re ok", C.IA_KEY_RE.test("IA:1123598813738675201:new-abc:0a1b2c3d4e5f6071:1"));
no("key re bad", C.IA_KEY_RE.test("IA:1 2"));
const big = { text: "x".repeat(C.IA_CHUNK + 10), n: 2098256587713404929 };
const rows = C.iaPartRows("7", "8", "P|ab12cd34|ENGINE_I|", { text: big.text, id: "2098256587713404929" });
eq("parts 2 chunks", rows.map((r) => r.step_name), ["P|ab12cd34|ENGINE_I|001", "P|ab12cd34|ENGINE_I|002"]);
eq("parts round trip", C.iaJoinChunks(rows.slice().reverse(), "P|ab12cd34|ENGINE_I|"), { text: big.text, id: "2098256587713404929" });
eq("parts empty value", C.iaPartRows("7", "8", "P|x|LABELS|", {}).length, 1);
eq("join none", C.iaJoinChunks([], "P|x|"), null);
eq("join bad", C.iaJoinChunks([{ step_name: "P|x|A|001", result_ref: "{" }], "P|x|A|"), undefined);
yes("sameVal trailing zeros", C.iaSameVal("1.32000000", 1.32));
yes("sameVal nothing", C.iaSameVal("", null));
no("sameVal long ids", C.iaSameVal("2098256587713404929", "2098256587713404930"));
yes("sameVal ids exact", C.iaSameVal("2098256587713404929", "2098256587713404929"));
no("sameVal 16+ fraction-free text", C.iaSameVal("1234567890123456", "1234567890123457"));
yes("sameStored 4dp half-up", C.iaSameStored(3471.59815, "3471.5982"));
yes("sameStored truncate", C.iaSameStored(2.71828, "2.718"));
no("sameStored other", C.iaSameStored(2.71828, "2.72828"));
eq("text busy", C.IA_TEXT.busy, "This Item Assembly is being processed in the background - please wait for it to finish.");
eq("text classic final", C.IA_TEXT.classicFinal("Completed"), "This Item Assembly is already Completed and cannot be saved again.");
eq("classic cap placeholder", C.IA_CLASSIC_MAX_PICKS, 250);

// ---------------------------------------------------------------- fingerprint
const H = { item_id: "2105490681599791200", item_qty: "1.00000000", item_uom: "2105486663217483800", location_id: "2018912822846582786",
  inventory_category: "Unrestricted", batch_no: "", issuing_operation_faci: "2018912822846582700" };
const L = [
  { id: "2111005120857767946", line_index: "2", item_selection: "2105490681599791130", quantity_uom: "2105486663217483800", total_quantity: "1.32000000", temp_qty_data: "[]" },
  { id: "2111005120857767945", line_index: "1", item_selection: "2105490681599791201", quantity_uom: "2105486663217483797", total_quantity: "7.00000000",
    temp_qty_data: '[{"balance_id":"2102793508724281345","location_id":"2079758099144642562","batch_id":null,"category":"Unrestricted","sm_quantity":7,"material_id":"x"}]' },
];
const fp = F.iaLineFingerprint(L, H);
yes("fp format", /^IF1:2:[0-9a-f]{16}$/.test(fp));
eq("fp j rows", F.iaLineFingerprint(L.map((l) => ({ j: JSON.stringify(l) })), [{ j: JSON.stringify(H) }]), fp);
eq("fp number forms", F.iaLineFingerprint(L.map((l) => Object.assign({}, l, { total_quantity: Number(l.total_quantity) })), Object.assign({}, H, { item_qty: 1 })), fp);
eq("fp line order", F.iaLineFingerprint(L.slice().reverse(), H), fp);
eq("fp parsed entries", F.iaLineFingerprint([L[0], Object.assign({}, L[1], { temp_qty_data: JSON.parse(L[1].temp_qty_data) })], H), fp);
eq("fp blank category = Unrestricted", F.iaLineFingerprint([L[0], Object.assign({}, L[1], { temp_qty_data: L[1].temp_qty_data.replace('"category":"Unrestricted"', '"category":""') })], H), fp);
eq("fp extra entry keys ignored", F.iaLineFingerprint([L[0], Object.assign({}, L[1], { temp_qty_data: L[1].temp_qty_data.replace('"material_id":"x"', '"material_id":"y","unrestricted_qty":5') })], H), fp);
const changed = (label, l, h) => no("fp changes: " + label, F.iaLineFingerprint(l, h || H) === fp);
changed("pick qty", [L[0], Object.assign({}, L[1], { temp_qty_data: L[1].temp_qty_data.replace('"sm_quantity":7', '"sm_quantity":6') })]);
changed("pick batch", [L[0], Object.assign({}, L[1], { temp_qty_data: L[1].temp_qty_data.replace('"batch_id":null', '"batch_id":"2069333288379301890"') })]);
changed("pick bin", [L[0], Object.assign({}, L[1], { temp_qty_data: L[1].temp_qty_data.replace("2079758099144642562", "2079758099144642563") })]);
changed("labour qty", [Object.assign({}, L[0], { total_quantity: "1.33" }), L[1]]);
changed("line uom", [Object.assign({}, L[0], { quantity_uom: "2105486663217483797" }), L[1]]);
changed("line removed", [L[1]]);
changed("item qty", L, Object.assign({}, H, { item_qty: "2" }));
changed("batch no", L, Object.assign({}, H, { batch_no: "B-1" }));
changed("receipt bin", L, Object.assign({}, H, { location_id: "1" }));
changed("category", L, Object.assign({}, H, { inventory_category: "Blocked" }));
changed("plant", L, Object.assign({}, H, { issuing_operation_faci: "1" }));
no("fp unsafe id marked", F.iaLineFingerprint([Object.assign({}, L[0], { id: 2111005120857767946 }), L[1]], H) === fp);
// IA output split (plan 10-27): a split's rows are part of the header's fingerprint; no split (none, [], null) keeps every other IA's as it was
const OSR = [{ os_qty: 0.6, os_location_id: "2107138650005770241", os_category: "Unrestricted", os_group: 1, os_batch_no: "B-1", os_mfg_date: "2026-10-27 00:00:00" },
  { os_qty: 0.4, os_location_id: "2107138649959632897", os_category: "Blocked", os_group: 1, os_batch_no: "B-1", os_mfg_date: "2026-10-27 00:00:00" }];
eq("fp: no split rows = the old fingerprint ([])", F.iaLineFingerprint(L, Object.assign({}, H, { output_split: [] })), fp);
eq("fp: no split rows = the old fingerprint (null)", F.iaLineFingerprint(L, Object.assign({}, H, { output_split: null })), fp);
eq("fp: no split rows = the old fingerprint (JSON text '[]')", F.iaLineFingerprint(L, Object.assign({}, H, { output_split: "[]" })), fp);
const fpS = F.iaLineFingerprint(L, Object.assign({}, H, { output_split: OSR }));
no("fp: a split changes it", fpS === fp);
eq("fp: the split as JSON text (19-digit ids kept exact) = the same", F.iaLineFingerprint(L, [{ j: JSON.stringify(Object.assign({}, H, { output_split: "@@" })).replace('"@@"',
  '[{"os_qty":0.6,"os_location_id":2107138650005770241,"os_category":"Unrestricted","os_group":1,"os_batch_no":"B-1","os_mfg_date":"2026-10-27 00:00:00"},' +
  '{"os_qty":0.4,"os_location_id":2107138649959632897,"os_category":"Blocked","os_group":1,"os_batch_no":"B-1","os_mfg_date":"2026-10-27 00:00:00"}]') }]), fpS);
const splitChanged = (label, rows) => no("fp: the split's " + label + " changes it", F.iaLineFingerprint(L, Object.assign({}, H, { output_split: rows })) === fpS);
splitChanged("qty", [Object.assign({}, OSR[0], { os_qty: 0.5 }), Object.assign({}, OSR[1], { os_qty: 0.5 })]);
splitChanged("bin", [Object.assign({}, OSR[0], { os_location_id: "2107138650005770242" }), OSR[1]]);
splitChanged("category", [OSR[0], Object.assign({}, OSR[1], { os_category: "Unrestricted" })]);
splitChanged("batch number", [OSR[0], Object.assign({}, OSR[1], { os_batch_no: "B-2" })]);
splitChanged("group", [OSR[0], Object.assign({}, OSR[1], { os_group: 2 })]);
splitChanged("expiry", [OSR[0], Object.assign({}, OSR[1], { os_exp_date: "2028-10-27 00:00:00" })]);
splitChanged("row order", [OSR[1], OSR[0]]);
splitChanged("a row removed", [OSR[0]]);
eq("fp raw temp_qty_data", F.iaFpCanonRows([{ id: "1", temp_qty_data: "[{bad" }])[0][5], "RAW:[{bad");
eq("fp no header = empties", F.iaFpCanonHeader(null), ["", "", "", "", "Unrestricted", "", ""]);
eq("fp id-less lines first by index", F.iaFpCanonRows([{ id: "5", line_index: "1" }, { line_index: "2" }, { line_index: "10" }]).map((r) => r[1]), ["2", "10", "1"]);

// ---------------------------------------------------------------- Revert V2 helpers (user decision 2026-10-19 15:25)
eq("rv op key", C.iaRvOpKey(JOB), "IAV|" + JOB);
eq("rv cost owner", C.iaRvCostOwner(JOB), "IAV|" + JOB + "|C");
yes("rv op key engine regex", /^[A-Za-z0-9|:._-]{1,32}$/.test(C.iaRvOpKey(JOB)) && C.iaRvCostOwner(JOB).length <= 64);
yes("rv prev Completed", C.iaRvPrevStatusOk("Completed"));
no("rv prev Draft", C.iaRvPrevStatusOk("Draft"));
yes("open job includes the revert state", C.IA_OPEN_JOB.indexOf("COMMITTING_REVERT") >= 0 && C.IA_COMMANDS.join() === "COMPLETE_IA,REVERT_IA");
eq("rv texts", [C.IA_TEXT.rvConflicts, C.IA_TEXT.rvDone], ["Revert blocked: the assembled item has been used or its stock has moved on.", "Item Assembly reverted to Draft successfully."]);
// the review's wording of the two classic caps (integration, minor 7) and ruling 9's revert texts
eq("text classic too big", C.IA_TEXT.classicTooBig(251, 250), "This Item Assembly has 251 stock picks; this save can process at most 250 at once. Split it into smaller assemblies, or complete it from the web form if background completion is switched on.");
eq("text classic revert too big", C.IA_TEXT.rvClassicTooBig(252, 250), "This Item Assembly has 252 stock rows; this revert can process at most 250 at once. Revert it from the Item Assembly list if background revert is switched on, or contact support.");
eq("rv texts (ruling 9)", ["rvNotLocked", "rvReview", "rvUnderReview", "rvQueueFailed", "rvNotReverted", "rvNoJob"].map((k) => C.IA_TEXT[k]), ["The Item Assembly is no longer locked by this revert: nothing was reverted.",
  "Under review: the revert stopped half-way. Please contact support.", "Its last revert stopped half-way and is under review: please contact support.", "The revert could not be queued: please try again.",
  "Temporary failures persisted; not reverted.", "no background revert"]);
yes("rv texts: each the revert's twin of a completion text", ["notLocked", "review", "underReview", "queueFailed"].every((k) => /complet/.test(C.IA_TEXT[k]) && !/complet/.test(C.IA_TEXT["rv" + k[0].toUpperCase() + k.slice(1)])
  && /revert/.test(C.IA_TEXT["rv" + k[0].toUpperCase() + k.slice(1)])));
eq("classic cap decided", C.IA_CLASSIC_MAX_PICKS, 250);
const MV = [
  { id: "2112073147263094790", transaction_type: "IA", movement: "OUT", item_id: "1", batch_number_id: null, bin_location_id: "7", inventory_category: "Unrestricted", handling_unit_id: null, base_qty: "5.00000000" },
  { id: "2112073147263094795", transaction_type: "IA", movement: "IN", item_id: "2", batch_number_id: "9", bin_location_id: "8", inventory_category: "Unrestricted", handling_unit_id: null, base_qty: 1 },
];
const im = F.iaMovesFingerprint(MV);
yes("moves fp format", /^IM1:2:[0-9a-f]{16}$/.test(im));
eq("moves fp order / shape", F.iaMovesFingerprint([{ j: JSON.stringify(MV[1]) }, Object.assign({}, MV[0], { base_qty: 5, movement: "out" })]), im);
no("moves fp new row", F.iaMovesFingerprint(MV.concat([Object.assign({}, MV[0], { id: "2112073147263094799", transaction_type: "IA-R", movement: "IN" })])) === im);
no("moves fp qty", F.iaMovesFingerprint([MV[0], Object.assign({}, MV[1], { base_qty: 2 })]) === im);

// ---------------------------------------------------------------- movekey
const labels = { M1: { line_index: "4", line_id: "9", item_code: "RM-1", item_name: "Steel", bin: "A1-B2", bin_id: "77", category: "Unrestricted", side: "out" },
  R1: { line_index: "", item_code: "FG-9", bin: "FG-BIN", category: "Unrestricted", side: "in" } };
eq("move key", M.iaMovementKeyOf("Insufficient quantity (movement M1)", ["M1"]), "M1");
eq("move index", M.iaMovementKeyOf("movements[1] location_id must be digits", ["M1", "M2"]), "M2");
eq("move map out", M.iaMapEngineMessage("Insufficient quantity (movement M1)", labels, ["M1"]), "Insufficient quantity - line 4 (RM-1), bin A1-B2 (Unrestricted)");
eq("move map in", M.iaMapEngineMessage("More than one item_balance row for x (movement R1)", labels, ["R1"]), "More than one item_balance row for x - FG-9, into bin FG-BIN (Unrestricted)");
eq("move map unknown", M.iaMapEngineMessage("Validation Failed (movement M9)", labels, ["M1"]), "Validation Failed (movement M9)");

// ---------------------------------------------------------------- price (user decision 2026-10-19 ~15:45: no labour / overhead roll-in)
eq("receipt per base unit", P.receiptUnitPrice({ outTotals: ["1234.5678"], receiptBaseQty: 1, assemblyCost: 0 }), 1234.5678);
eq("receipt + assembly cost", P.receiptUnitPrice({ outTotals: ["100", "50.5"], receiptBaseQty: 3, assemblyCost: "2.50" }), 52.66666667);
eq("receipt ignores a stale nonStock", P.receiptUnitPrice({ outTotals: ["100"], nonStock: 2237.0304, receiptBaseQty: 2, assemblyCost: 0 }), 50);
eq("receipt residue", P.receiptUnitPrice({ outTotals: ["0.1", "0.2"], receiptBaseQty: 1, assemblyCost: 0 }), 0.3);
eq("receipt base 0", P.receiptUnitPrice({ outTotals: ["100"], receiptBaseQty: 0, assemblyCost: 3 }), 0);
eq("receipt base negative", P.receiptUnitPrice({ outTotals: ["100"], receiptBaseQty: -1, assemblyCost: 3 }), 0);
eq("receipt single SUM text", P.receiptUnitPrice({ outTotals: "350.12345678", receiptBaseQty: "2", assemblyCost: null }), 175.06172839);
eq("receipt many terms", P.receiptUnitPrice({ outTotals: Array(830).fill("0.01"), receiptBaseQty: 1, assemblyCost: 0 }), 8.3);
eq("no labour helpers exported", [typeof P.nonStockValue, typeof P.iaNonStockPart], ["undefined", "undefined"]);
// the engine's uomOf: q8 at each step, the line UOM else the base UOM, one row of that alt UOM, else 1:1
const CTN = "2092460418772639785";
const PCS = "2092460418772639758";
const box = { id: "1", based_uom: PCS, table_uom_conversion: [{ alt_uom_id: PCS, base_qty: 1 }, { alt_uom_id: CTN, base_qty: 12 }] };
const engineRow = { id: "2", based_uom: PCS, uom_conversion_json: '[{"alt_uom_id":"' + CTN + '","base_qty":12.000000}]' };
eq("uom engine row text", P.iaUomOf(engineRow, "2", CTN).baseQty, 24);
eq("uom alt", P.iaUomOf(box, "1.32", CTN), { altQty: 1.32, baseQty: 15.84, altUOM: CTN, baseUOM: PCS });
eq("uom unknown 1:1", P.iaUomOf(box, "1.32", "123").baseQty, 1.32);
eq("uom empty = base", P.iaUomOf(box, "2", "").altUOM, PCS);
eq("uom q8 qty", P.iaUomOf(box, "0.1234567891", CTN).baseQty, 1.48148148);
// a recorded search-node row carries 19-digit ids as JSON numbers (prod run 2111001816408920065); the platform's String() keeps
// them exact (code_batch_decide matches), a pure-JS JSON.parse does not: replays parse with iaParseJ
const recordedText = '{"id":2092500426523025458,"stock_control":0,"purchase_unit_price":31.128,"based_uom":2092460418772639758,"table_uom_conversion":[{"alt_uom_id":2092460418772639758,"base_qty":1.0},{"alt_uom_id":2092460418772639785,"base_qty":16.0}]}';
const lossy = JSON.parse(recordedText);
eq("String() of a JSON number loses digits", String(lossy.based_uom), "2092460418772639700");
eq("ids 27 apart are one double", lossy.table_uom_conversion[0].alt_uom_id === lossy.table_uom_conversion[1].alt_uom_id, true);
const recorded = C.iaParseJ(recordedText);
eq("uom big-int-safe row vs text line", P.iaUomOf(recorded, "2", CTN).baseQty, 32);
eq("item big-int-safe id vs text", P.iaItemOf([recorded], "2092500426523025458") === recorded, true);
eq("item lossy id never matches", P.iaItemOf([lossy], "2092500426523025458"), null);
eq("lossy row never matches a text id", P.iaUomOf(lossy, "2", CTN).baseQty, 2);
yes("id eq exact", P.iaPrIdEq("2092460418772639785", " 2092460418772639785"));
no("id eq text differs", P.iaPrIdEq("2092460418772639785", "2092460418772639758"));
no("id eq empty", P.iaPrIdEq("", ""));

// ---------------------------------------------------------------- concatenation with the template step helpers (no redeclaration)
const strip = (p) => fs.readFileSync(p, "utf8").split("\n").filter((l) => !l.startsWith("if (typeof module")).join("\n");
const parts = ["ia_common.js", "fingerprint.js", "movekey.js", "price.js"].map((f) => strip(path.join(SHARED, f)));
for (const f of ["ia_common.js", "fingerprint.js", "movekey.js", "price.js"]) no("no platform token in " + f, /\{\{/.test(strip(path.join(SHARED, f))));
const grvCommon = fs.readFileSync(path.join(TPL, "grv2", "commit", "_common.js"), "utf8");
const smvCmp = fs.readFileSync(path.join(TPL, "smv2", "code", "commit", "_cmp.js"), "utf8");
let concatOk = true;
try {
  const fn = new Function(parts.join("\n") + "\n" + grvCommon + "\n" + smvCmp + "\nreturn [iaLineFingerprint, receiptUnitPrice, iaMapEngineMessage, sameStored, iaSameStored, s, q8];");
  const got = fn();
  eq("concat runs", got.length, 7);
} catch (e) {
  concatOk = false;
  console.log("FAIL concat: " + e.message);
}
yes("concat with tpl grv2 _common + smv2 _cmp", concatOk);

console.log((fails ? "FAILED " + fails : "ok") + " - " + n + " checks");
process.exit(fails ? 1 : 0);

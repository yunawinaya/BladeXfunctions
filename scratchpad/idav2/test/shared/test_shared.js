// node scratchpad/idav2/test/shared/test_shared.js - unit tests of scratchpad/idav2/code/shared/*.js (CONTRACT.md section 6).
// batchnum runs in UTC+8 as the platform does: the script re-runs itself with TZ=Asia/Kuala_Lumpur when started elsewhere.
const fs = require("fs");
const path = require("path");
const cp = require("child_process");
if (new Date(2026, 0, 1).getTimezoneOffset() !== -480) {
  if (process.env.IDA_TZ_CHILD === "1") {
    console.error("FAIL TZ=Asia/Kuala_Lumpur is not honoured here (offset " + new Date(2026, 0, 1).getTimezoneOffset() + "): batchnum needs UTC+8");
    process.exit(2);
  }
  const r = cp.spawnSync(process.execPath, [__filename], { env: Object.assign({}, process.env, { TZ: "Asia/Kuala_Lumpur", IDA_TZ_CHILD: "1" }), stdio: "inherit" });
  process.exit(r.status === null ? 1 : r.status);
}
const ROOT = path.join(__dirname, "..", "..");
const SHARED = path.join(ROOT, "code", "shared");
const TPL = path.join(ROOT, "tpl");
const BASE = path.join(ROOT, "base");
const C = require(path.join(SHARED, "ida_common.js"));
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
const strip = (p) => fs.readFileSync(p, "utf8").split("\n").filter((l) => !l.startsWith("if (typeof module")).join("\n");

// ---------------------------------------------------------------- ida_common: values, ids, JSON
eq("q8 residue", C.idaQ8(0.1 + 0.2), 0.3);
eq("q8 text", C.idaQ8("1.320000004"), 1.32);
eq("q8 garbage", C.idaQ8("x"), 0);
eq("qtyStr", C.idaQtyStr(1.32), "1.32000000");
eq("qtyStr clamps", C.idaQtyStr(-0.5), "0.00000000");
eq("idStr digits", C.idaIdStr(" 2107305535347552257 "), "2107305535347552257");
eq("idStr unsafe number", C.idaIdStr(2107305535347552257), "");
eq("idStr safe number", C.idaIdStr(12345), "12345");
eq("idStr text", C.idaIdStr("12a"), "");
yes("idAfter longer", C.idaIdAfter("21107733125448531970", "2110773312544853197"));
yes("idAfter same length greater", C.idaIdAfter("2110985746692308994", "2110985744909729793"));
no("idAfter equal", C.idaIdAfter("2110985744909729793", "2110985744909729793"));
no("idAfter smaller", C.idaIdAfter("2107733125448531970", "2110985744909729793"));
no("idAfter not digits", C.idaIdAfter("21x", "1"));
eq("parseJ big int", C.idaParseJ('{"a":2107305535347552257,"b":[2107305535347552258]}'), { a: "2107305535347552257", b: ["2107305535347552258"] });
eq("parseJ float residue kept", C.idaParseJ('{"q":0.30000000000000004}').q, 0.30000000000000004);
eq("parseJ string untouched", C.idaParseJ('{"s":"x 2107305535347552257"}').s, "x 2107305535347552257");
eq("parseJ bad", C.idaParseJ("{"), null);
eq("jsonList text", C.idaJsonList('[{"a":1}]'), [{ a: 1 }]);
eq("jsonList empty", C.idaJsonList(""), []);
eq("jsonList object", C.idaJsonList('{"a":1}'), []);
eq("rows", C.idaRows([{ j: '{"id":2107305535347552257}' }, { id: "1" }, null]), [{ id: "2107305535347552257" }, { id: "1" }]);
eq("idsSql", C.idaIdsSql({ "5": true, "x": true, "5 ": true }), "0,5");
eq("idsSql list", C.idaIdsSql(["2107305535347552257", "", "2107305535347552257"]), "0,2107305535347552257");
eq("idsSql a 0 id once", C.idaIdsSql(["0", "7", 0, "7"]), "0,7");
// the O(n) dedupe gives IA's indexOf form's output, order included
const iaIdsSql = (vals) => ["0"].concat((Array.isArray(vals) ? vals : Object.keys(vals || {})).map(C.idaIdStr).filter((x) => x)).filter((x, i, a) => a.indexOf(x) === i).join(",");
const ids5000 = Array.from({ length: 5000 }, (_, i) => String(2107305535347552257n + BigInt((i * 7919) % 3000)));
eq("idsSql 5,000 = the indexOf form", C.idaIdsSql(ids5000), iaIdsSql(ids5000));
eq("idsSql object = the indexOf form", C.idaIdsSql({ "9": 1, "3": 1, "x": 1 }), iaIdsSql({ "9": 1, "3": 1, "x": 1 }));
eq("tuples", C.idaTuples([["1", "2"], ["1", "2"], ["3", "x"], [], "no", ["2107305535347552257", "0"]]), "[[1,2],[2107305535347552257,0]]");
eq("tuples none", C.idaTuples([]), "[]");
eq("category", [C.idaCategory(""), C.idaCategory(null), C.idaCategory("Blocked")], ["Unrestricted", "Unrestricted", "Blocked"]);

// ---------------------------------------------------------------- picks (on the header), recovery lines, moves, HU, serial
const H0 = { temp_qty_data: '[{"sm_quantity":2,"location_id":"2018912822846582786","balance_id":"2107724306903400449"},{"sm_quantity":0},{"sm_quantity":"0.5"},{"sm_quantity":-1}]' };
eq("picks", C.idaPicks(H0).length, 2);
eq("picks array", C.idaPicks({ temp_qty_data: [{ sm_quantity: 1 }] }).length, 1);
eq("picks unparseable", C.idaPicks({ temp_qty_data: "[{bad" }).length, 0);
eq("picks none", C.idaPicks(null).length, 0);
eq("pickCount", C.idaPickCount(H0), 2);
const LINES0 = [{ item_selection: "2107721546371891202" }, { item_selection: "" }, { item_selection: " 2107721718380298242 " }, null, { item_name: "x" }];
eq("recovery lines", C.idaRecoveryLines(LINES0).length, 2);
eq("moves = picks + recovery lines", C.idaMoveCount(H0, LINES0), 4);
eq("moves at the client cap", C.idaMoveCount({ temp_qty_data: '[{"sm_quantity":1}]' }, Array.from({ length: 50 }, () => ({ item_selection: "1" }))), 51);
yes("hu pick", C.idaHasHu({ temp_qty_data: '[{"sm_quantity":0,"handling_unit_id":"9"}]' }));
yes("hu data", C.idaHasHu({ temp_qty_data: "[]", temp_hu_data: '[{"x":1}]' }));
yes("hu table array", C.idaHasHu({ temp_qty_data: "[]", temp_hu_data: "", table_hu: [{ id: "1" }] }));
yes("hu table text", C.idaHasHu({ table_hu: '[{"id":"1"}]' }));
no("hu none", C.idaHasHu({ temp_qty_data: '[{"sm_quantity":1,"handling_unit_id":""}]', temp_hu_data: "[]", table_hu: [] }));
no("hu dev row shape", C.idaHasHu({ temp_qty_data: H0.temp_qty_data, temp_hu_data: null, table_hu: [] }));
yes("serial pick", C.idaPickHasSerial({ temp_qty_data: '[{"sm_quantity":1,"serial_number":"SN1"}]' }));
no("serial none", C.idaPickHasSerial(H0));

// ---------------------------------------------------------------- batch kinds, keys, hex, requests, labels
const AUTO_ITEM = { item_batch_management: 1, batch_number_genaration: "According To System Settings" };
const MANUAL_ITEM = { item_batch_management: 1, batch_number_genaration: "Manual Input" };
const PLAIN_ITEM = { item_batch_management: 0, batch_number_genaration: null };
eq("kind auto placeholder", C.idaBatchKind({ batch_number: "Auto-generated batch number" }, AUTO_ITEM), "AUTO");
eq("kind auto blank", C.idaBatchKind({ batch_number: "" }, AUTO_ITEM), "AUTO");
eq("kind auto null", C.idaBatchKind({ batch_number: null }, AUTO_ITEM), "AUTO");
eq("kind auto rule typed", C.idaBatchKind({ batch_number: "LOT-7" }, AUTO_ITEM), "TYPED");
eq("kind auto rule dash", C.idaBatchKind({ batch_number: "-" }, AUTO_ITEM), "NONE");
eq("kind auto rule spaces (not the classic's blank)", C.idaBatchKind({ batch_number: "  " }, AUTO_ITEM), "NONE");
eq("kind manual typed", C.idaBatchKind({ batch_number: "Batch-0003" }, MANUAL_ITEM), "TYPED");
eq("kind manual blank", C.idaBatchKind({ batch_number: "" }, MANUAL_ITEM), "NONE");
eq("kind manual placeholder", C.idaBatchKind({ batch_number: "Auto-generated batch number" }, MANUAL_ITEM), "NONE");
eq("kind plain dash", C.idaBatchKind({ batch_number: "-" }, PLAIN_ITEM), "NONE");
eq("kind plain placeholder (classic: a batch named so)", C.idaBatchKind({ batch_number: "Auto-generated batch number" }, PLAIN_ITEM), "NONE");
eq("kind plain typed", C.idaBatchKind({ batch_number: " X1 " }, PLAIN_ITEM), "TYPED");
eq("kind no item", C.idaBatchKind({ batch_number: "" }, null), "NONE");
eq("kind rule compared exactly", C.idaBatchKind({ batch_number: "" }, { item_batch_management: 1, batch_number_genaration: "According To System Settings " }), "NONE");
eq("batchKey", [C.idaBatchKey("Batch-00623  "), C.idaBatchKey(" LOT-7"), C.idaBatchKey(null)], ["batch-00623", "lot-7", ""]);
eq("hex ascii", C.idaHex("Batch-00516"), "42617463682D3030353136");
eq("hex 2-byte", C.idaHex("é"), "C3A9");
eq("hex 3-byte", C.idaHex("中"), "E4B8AD");
eq("hex 4-byte", C.idaHex("😀"), "F09F9880");
eq("hex trailing spaces kept", C.idaHex("A "), "4120");
eq("hex empty", [C.idaHex(""), C.idaHex(null)], ["", ""]);
eq("hex = node Buffer utf8", C.idaHex("Lot é 中 😀-7"), Buffer.from("Lot é 中 😀-7", "utf8").toString("hex").toUpperCase());
eq("hexJson distinct, blanks dropped", C.idaHexJson(["Batch-0003", "", "  ", null, "Batch-0003", "x"]), JSON.stringify(["42617463682D30303033", "78"]));
const nums5000 = Array.from({ length: 5000 }, (_, i) => "Batch-" + String((i * 7919) % 3000).padStart(5, "0"));
eq("hexJson 5,000: first-seen order, distinct", JSON.parse(C.idaHexJson(nums5000)), nums5000.filter((x, i, a) => a.indexOf(x) === i).map(C.idaHex));
eq("hexJson none", C.idaHexJson([]), "[]");
yes("hexJson is SQL-safe", /^\[("[0-9A-F]*",?)*\]$/.test(C.idaHexJson(["it's \"x\" -- ;", "中"])));
eq("batch request", C.idaBatchRequest({ item_disassembly_date: "2026-10-16 00:00:00" }, { item_selection: 2107721718380298242n.toString(), manufacturing_date: "", expired_date: "2027-01-01 00:00:00" }, "1123598813738675201"),
  { item_id: "2107721718380298242", document_date: "2026-10-16 00:00:00", manufacturing_date: null, expired_date: "2027-01-01 00:00:00", organization_id: "1123598813738675201" });
eq("batch request no org", C.idaBatchRequest({}, { item_selection: "1" }, "").organization_id, null);
eq("line label (code_validate's)", [C.idaLineLabel(3, { item_name: "Bom-3", item_selection: "9" }), C.idaLineLabel(1, { item_selection: "9" }), C.idaLineLabel(2, {})],
  ["Line 3 (Bom-3)", "Line 1 (9)", "Line 2 (-)"]);

// ---------------------------------------------------------------- clocks, lease, sizes, keys
eq("dbAddSeconds", C.idaDbAddSeconds("2026-10-21 23:59:50", 120), "2026-10-22 00:01:50");
eq("dbAddSeconds bad", C.idaDbAddSeconds("", 5), "");
eq("dbSeconds", C.idaDbSeconds("2026-10-21 10:00:00", "2026-10-21 10:30:01"), 1801);
eq("lease small", C.idaLeaseSeconds(2), 602);
eq("lease 2,000 lines + 1 pick", C.idaLeaseSeconds(2001), 1801);
eq("lease cap", C.idaLeaseSeconds(100000), 5400);
eq("lease bad", [C.idaLeaseSeconds(-5), C.idaLeaseSeconds("x"), C.idaLeaseSeconds(null)], [600, 600, 600]);
eq("sizes", [C.IDA_V2_MIN_MOVES, C.IDA_CLASSIC_MAX_MOVES, C.IDA_MAX_MOVES, C.IDA_PARK, C.IDA_LOCK_WAIT_TRIES, C.IDA_RECEIPT_WAIT_S, C.IDA_RECEIPT_RETRY_S],
  [50, 250, 5000, 1000, 8, 1800, 10]);
yes("prev Draft", C.idaPrevStatusOk("Draft"));
no("prev Completed", C.idaPrevStatusOk("Completed"));
no("prev empty", C.idaPrevStatusOk(""));
eq("job sets", [C.IDA_OPEN_JOB, C.IDA_RUNNING_JOB, C.IDA_TERMINAL_JOB, C.IDA_FINAL, C.IDA_OK_CATEGORIES], [
  ["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_IDA", "REQUIRES_REVIEW"], ["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_IDA"],
  ["COMPLETED", "FAILED", "REQUIRES_REVIEW", "CANCELLED", "NONE"], ["Completed", "Fully Posted"], ["Unrestricted", "Blocked"]]);
const JOB = "2111005120857767938";
const IDA = "2110985744909729793";
eq("op key I", C.idaOpKey(JOB, "I"), "IDC|" + JOB + "|I");
eq("op key R", C.idaOpKey(JOB, "R"), "IDC|" + JOB + "|R");
eq("op key length", C.idaOpKey(JOB, "I").length, 25);
yes("op key engine regex", /^[A-Za-z0-9|:._-]{1,32}$/.test(C.idaOpKey(JOB, "R")));
eq("lock job", C.idaLockJob(IDA), "IDC|" + IDA);
eq("lock job length", C.idaLockJob(IDA).length, 23);
eq("correlation", C.idaCorrelation(IDA), "IDA|" + IDA);
yes("part names <= 23", ["ENGINE_I", "ENGINE_R", "BATCH", "LABELS", "ITEMS"].every((p) => ("P|ab12cd34|" + p + "|001").length <= 23));
yes("step / intent names <= 32", ["D0_REVALIDATE", "D1_BATCH", "D2_ISSUE", "D3_RECEIPT", "D4_FINISH", "D1|I|001", "W0_CLAIM_99999"].every((x) => x.length <= 32));
yes("key re ok", C.IDA_KEY_RE.test("IDA:1123598813738675201:new-abc:0a1b2c3d4e5f6071:1"));
no("key re bad", C.IDA_KEY_RE.test("IDA:1 2"));

// ---------------------------------------------------------------- parts: chunking round trip
const big = "x".repeat(C.IDA_CHUNK + 10);
const rows = C.idaPartRows("7", "8", "P|ab12cd34|ENGINE_R|", { text: big, id: "2107305535347552257" });
eq("parts 2 chunks", rows.map((r) => r.step_name), ["P|ab12cd34|ENGINE_R|001", "P|ab12cd34|ENGINE_R|002"]);
eq("parts row columns", Object.keys(rows[0]), ["job_id", "organization_id", "step_name", "step_status", "attempt_count", "result_ref"]);
eq("parts default status", rows[0].step_status, "PAYLOAD");
eq("parts intent status", C.idaPartRows("7", "8", "D1|I|", {}, "INTENT")[0].step_status, "INTENT");
eq("parts round trip (any row order)", C.idaJoinChunks(rows.slice().reverse(), "P|ab12cd34|ENGINE_R|"), { text: big, id: "2107305535347552257" });
eq("parts other prefix ignored", C.idaJoinChunks(rows.concat([{ step_name: "P|ab12cd34|ENGINE_I|001", result_ref: "{}" }]), "P|ab12cd34|ENGINE_R|"), { text: big, id: "2107305535347552257" });
eq("parts empty value", C.idaPartRows("7", "8", "P|x|LABELS|", {}).length, 1);
eq("join none", C.idaJoinChunks([], "P|x|"), null);
eq("join bad", C.idaJoinChunks([{ step_name: "P|x|A|001", result_ref: "{" }], "P|x|A|"), undefined);
const many = { numbers: {} };
for (let i = 1; i <= 30000; i++) many.numbers["B" + i] = "Batch-" + String(i).padStart(5, "0");
const mrows = C.idaPartRows(JOB, "1123598813738675201", "D1|I|", many, "INTENT");
eq("intent 30,000 numbers round trip", C.idaJoinChunks(mrows, "D1|I|"), many);

// ---------------------------------------------------------------- compare helpers
yes("sameVal trailing zeros", C.idaSameVal("1.32000000", 1.32));
yes("sameVal nothing", C.idaSameVal("", null));
no("sameVal long ids", C.idaSameVal("2107305535347552257", "2107305535347552258"));
yes("sameVal ids exact", C.idaSameVal("2107305535347552257", "2107305535347552257"));
yes("sameStored 4dp half-up", C.idaSameStored(3471.59815, "3471.5982"));
yes("sameStored truncate", C.idaSameStored(2.71828, "2.718"));
no("sameStored other", C.idaSameStored(2.71828, "2.72828"));

// ---------------------------------------------------------------- texts (CONTRACT.md section 10)
const idem = fs.readFileSync(path.join(BASE, "ida_code", "code_idem_guard.js"), "utf8");
const validate = fs.readFileSync(path.join(BASE, "ida_code", "code_validate.js"), "utf8");
eq("text busy (plan)", C.IDA_TEXT.busy, "This Item Disassembly is being processed in the background - please wait for it to finish.");
eq("text classicFinal", C.IDA_TEXT.classicFinal("Completed"), "This Item Disassembly is already Completed and cannot be saved again.");
yes("classicFinal = code_idem_guard's wording", idem.indexOf("'This Item Disassembly is already ' + status + ' and cannot be saved again.'") >= 0);
eq("text typedExists = code_validate's", C.IDA_TEXT.typedExists(C.idaLineLabel(4, { item_name: "ITEM-0038" }), "Batch-0003"), "Line 4 (ITEM-0038): Batch No Batch-0003 already exists.");
yes("typedExists = code_validate's wording", validate.indexOf("message = label + ': Batch No ' + batch + ' already exists.';") >= 0
  && validate.indexOf("const label = 'Line ' + (i + 1) + ' (' + (line.item_name || line.item_selection || '-') + ')';") >= 0);
eq("text typedTaken", C.IDA_TEXT.typedTaken("Line 1 (X)", "B"), "Line 1 (X): Batch No B already exists. Nothing was moved.");
eq("text batchDuplicate", C.IDA_TEXT.batchDuplicate("Batch-00632"), "Duplicate Batch Format found. (batch number Batch-00632) Nothing was moved.");
eq("text classicTooBig", C.IDA_TEXT.classicTooBig(251, 250), "This Item Disassembly has 251 source picks and recovery lines - too big for the classic save, which handles at most 250 at once. Complete it from the web form with background completion switched on, or split it into smaller disassemblies.");
eq("text tooBig", C.IDA_TEXT.tooBig(300, "handling units", 250), "This Item Disassembly has 300 source picks and recovery lines and cannot be completed in the background (handling units); the classic save handles at most 250.");
eq("text splitRequired", C.IDA_TEXT.splitRequired(5001, "recovery lines"), "This Item Disassembly has 5001 recovery lines. At most 5,000 can be moved at once - please split the disassembly.");
eq("text stale", [C.IDA_TEXT.stale("Completed"), C.IDA_TEXT.stale("")], ["This Item Disassembly was changed by someone else (it is now Completed). Please close it and open it again.",
  "This Item Disassembly was changed by someone else (it is now without a status). Please close it and open it again."]);
eq("text planFailed", C.IDA_TEXT.planFailed("no stock to issue."), "The completion could not be prepared: no stock to issue.");
eq("text keys", Object.keys(C.IDA_TEXT).sort(), ["alreadyFinal", "batchDuplicate", "batchFailed", "busy", "classicFinal", "classicTooBig", "linesChanged", "lockBusy",
  "noJob", "notCompleted", "notFound", "notLocked", "planFailed", "postLater", "prevUnknown", "queueFailed", "review", "splitRequired", "stale", "tooBig", "typedExists",
  "typedTaken", "underReview", "unlinked"]);

// ---------------------------------------------------------------- fingerprint (DF1)
const HD = { id: IDA, item_id: "2107721324476432385", item_qty: "2.00000000", item_uom: "2018906563477008389", issuing_operation_faci: "1123598813738675202",
  item_disassembly_date: "2026-10-16 00:00:00", organization_id: "1123598813738675201", stock_movement_no: "IDA-2610-003", remarks: "",
  temp_qty_data: '[{"material_id":"2107721324476432385","location_id":"2018912822846582786","storage_location_id":null,"batch_id":null,"balance_id":"2107724306903400449","sm_quantity":2,"category":"Unrestricted","plant_id":"1123598813738675202"}]' };
const LD = [
  { id: "2110985744934895619", line_index: "2", item_selection: "2107721718380298242", quantity_uom: "2018906563477008392", total_quantity: "10.00000000",
    location_id: "2018912822846582786", batch_number: "Batch-00623", manufacturing_date: null, expired_date: null, item_remark: "" },
  { id: "2110985744934895618", line_index: "1", item_selection: "2107721546371891202", quantity_uom: "2018906563477008392", total_quantity: "10.00000000",
    location_id: "2018912822846582786", batch_number: "-", manufacturing_date: null, expired_date: null, item_remark: "" },
  { id: "2110985744934895621", line_index: "4", item_selection: "2070758892513914881", quantity_uom: "2018906563477008389", total_quantity: "1.00000000",
    location_id: "2018912972444823554", batch_number: "-", manufacturing_date: null, expired_date: null, item_remark: "" },
];
const fp = F.idaLineFingerprint(LD, HD);
yes("fp format", /^DF1:3:[0-9a-f]{16}$/.test(fp));
eq("fp deterministic", F.idaLineFingerprint(LD, HD), fp);
eq("fp j rows (FP_LINES / FP_HEADER shape)", F.idaLineFingerprint(LD.map((l) => ({ j: JSON.stringify(l) })), [{ j: JSON.stringify(HD) }]), fp);
eq("fp number forms", F.idaLineFingerprint(LD.map((l) => Object.assign({}, l, { total_quantity: Number(l.total_quantity) })), Object.assign({}, HD, { item_qty: 2 })), fp);
eq("fp line order", F.idaLineFingerprint(LD.slice().reverse(), HD), fp);
eq("fp parsed picks", F.idaLineFingerprint(LD, Object.assign({}, HD, { temp_qty_data: JSON.parse(HD.temp_qty_data) })), fp);
eq("fp blank category = Unrestricted", F.idaLineFingerprint(LD, Object.assign({}, HD, { temp_qty_data: HD.temp_qty_data.replace('"category":"Unrestricted"', '"category":""') })), fp);
eq("fp extra keys ignored (remarks, labels, pick extras)", F.idaLineFingerprint(LD.map((l) => Object.assign({}, l, { item_remark: "changed", item_name: "x" })),
  Object.assign({}, HD, { remarks: "r", temp_qty_data: HD.temp_qty_data.replace('"plant_id":"1123598813738675202"', '"plant_id":"1","unrestricted_qty":399') })), fp);
const changed = (label, l, h) => no("fp changes: " + label, F.idaLineFingerprint(l, h || HD) === fp);
const withLine = (i, patch) => LD.map((l, k) => (k === i ? Object.assign({}, l, patch) : l));
changed("line qty", withLine(0, { total_quantity: "9" }));
changed("line uom", withLine(0, { quantity_uom: "2018906563477008389" }));
changed("line item", withLine(0, { item_selection: "2107724107950784513" }));
changed("line bin", withLine(0, { location_id: "2018912972444823554" }));
changed("line batch number", withLine(0, { batch_number: "Batch-00624" }));
changed("line batch number spaces", withLine(0, { batch_number: "Batch-00623 " }));
changed("line mfg date", withLine(0, { manufacturing_date: "2026-10-30 00:00:00" }));
changed("line exp date", withLine(1, { expired_date: "2027-10-30 00:00:00" }));
changed("line index", withLine(2, { line_index: "3" }));
changed("line removed", LD.slice(0, 2));
changed("item qty", LD, Object.assign({}, HD, { item_qty: "3" }));
changed("item", LD, Object.assign({}, HD, { item_id: "2107721324476432386" }));
changed("item uom", LD, Object.assign({}, HD, { item_uom: "2018906563477008392" }));
changed("plant", LD, Object.assign({}, HD, { issuing_operation_faci: "1" }));
changed("doc date", LD, Object.assign({}, HD, { item_disassembly_date: "2026-10-17 00:00:00" }));
changed("pick qty", LD, Object.assign({}, HD, { temp_qty_data: HD.temp_qty_data.replace('"sm_quantity":2', '"sm_quantity":1') }));
changed("pick bin", LD, Object.assign({}, HD, { temp_qty_data: HD.temp_qty_data.replace("2018912822846582786", "2018912822846582787") }));
changed("pick batch", LD, Object.assign({}, HD, { temp_qty_data: HD.temp_qty_data.replace('"batch_id":null', '"batch_id":"2069333288379301890"') }));
changed("pick category", LD, Object.assign({}, HD, { temp_qty_data: HD.temp_qty_data.replace('"Unrestricted"', '"Blocked"') }));
changed("pick hu", LD, Object.assign({}, HD, { temp_qty_data: HD.temp_qty_data.replace('"sm_quantity":2', '"sm_quantity":2,"handling_unit_id":"5"') }));
changed("pick added (qty 0 kept)", LD, Object.assign({}, HD, { temp_qty_data: HD.temp_qty_data.replace("}]", '},{"sm_quantity":0,"location_id":"1"}]') }));
// 2^53: an id that went through a JS number is marked, never equal to its exact text
const lossyId = Number(LD[0].id);
no("fp unsafe line id marked", F.idaLineFingerprint(withLine(0, { id: lossyId }), HD) === fp);
eq("fp unsafe id text", F.idaFpId(lossyId), "?" + String(lossyId));
eq("fp safe number id", F.idaFpId(12345), "12345");
no("fp unsafe uom marked", F.idaLineFingerprint(withLine(0, { quantity_uom: Number(LD[0].quantity_uom) }), HD) === fp);
no("fp unsafe header item marked", F.idaLineFingerprint(LD, Object.assign({}, HD, { item_id: Number(HD.item_id) })) === fp);
eq("fp j rows keep 19-digit numbers exact", F.idaLineFingerprint(LD.map((l) => ({ j: JSON.stringify(l).replace('"' + l.id + '"', l.id) })), [{ j: JSON.stringify(HD) }]), fp);
eq("fp raw temp_qty_data", F.idaFpCanonHeader([{ temp_qty_data: "[{bad" }])[5], "RAW:[{bad");
eq("fp no header = empties", F.idaFpCanonHeader(null), ["", "", "", "", "", []]);
eq("fp id-less lines first by index", F.idaFpCanonRows([{ id: "5", line_index: "1" }, { line_index: "2" }, { line_index: "10" }]).map((r) => r[1]), ["2", "10", "1"]);
eq("fp line count", F.idaLineFingerprint([], HD).split(":")[1], "0");

// ---------------------------------------------------------------- movekey
const labels = { M1: { pick: "1", line_index: "", line_id: "", item_code: "FG-0001", item_name: "Kit", bin: "A1-B2", bin_id: "77", category: "Unrestricted", side: "out" },
  R4: { pick: "", line_index: "4", line_id: "9", item_code: "RM-0042", item_name: "Steel", bin: "A1-B2", bin_id: "78", category: "Unrestricted", side: "in" } };
eq("move key", M.idaMovementKeyOf("Insufficient quantity (movement M1)", ["M1"]), "M1");
eq("move index", M.idaMovementKeyOf("movements[1] location_id must be digits", ["M1", "R4"]), "R4");
eq("move map pick (contract example)", M.idaMapEngineMessage("Insufficient quantity (movement M1)", labels, ["M1"]), "Insufficient quantity - source pick 1 (FG-0001), bin A1-B2 (Unrestricted)");
eq("move map line (contract example)", M.idaMapEngineMessage("More than one item_balance row for x (movement R4)", labels, ["R4"]),
  "More than one item_balance row for x - line 4 (RM-0042), into bin A1-B2 (Unrestricted)");
eq("move map by index", M.idaMapEngineMessage("movements[0] batch_id must be digits or empty", labels, ["M1"]), "batch_id must be digits or empty - source pick 1 (FG-0001), bin A1-B2 (Unrestricted)");
eq("move map unknown", M.idaMapEngineMessage("Validation Failed (movement M9)", labels, ["M1"]), "Validation Failed (movement M9)");

// ---------------------------------------------------------------- price: idaUomOf = the engine's core uomOf (base/INVENTORY_BULK_APPLY.v10.json)
const engineDoc = JSON.parse(fs.readFileSync(path.join(BASE, "INVENTORY_BULK_APPLY.v10.json"), "utf8"));
const findNode = (doc, id) => {
  let hit = null;
  const walk = (o) => {
    if (hit || !o || typeof o !== "object") return;
    if (Array.isArray(o)) return o.forEach(walk);
    if (o.id === id && o.data) hit = o;
    else Object.values(o).forEach(walk);
  };
  walk(doc);
  return hit;
};
const planCode = findNode(engineDoc, "code_node_IBplan").data.script.code;
const at = planCode.indexOf("const uomOf = (item, m) => {");
const end = planCode.indexOf("\n  };", at);
yes("engine uomOf found", at > 0 && end > at);
const engineQ8 = (v) => Number((parseFloat(v) || 0).toFixed(8));
const engineUomOf = new Function("q8", "return " + planCode.slice(at + "const uomOf = ".length, end + 4).replace(/;\s*$/, ""))(engineQ8);
// the engine's own item mapping (bulkPlan's items loop) with its own s() / arr(), run on the row its sql_node_IBitems would give
const mapAt = planCode.indexOf("  const items = {};\n  for (const r of arr(inp.items)) {");
const mapEnd = planCode.indexOf("\n  const num = (rows, cols) =>", mapAt);
const sDef = planCode.match(/^const s = \(v\) => \(v === undefined \|\| v === null \? "" : String\(v\)\);$/m);
const arrDef = planCode.match(/^const arr = \(v\) => \(Array\.isArray\(v\) \? v : v \? \[v\] : \[\]\);$/m);
yes("engine item mapping / s() / arr() found", mapAt > 0 && mapEnd > mapAt && sDef && arrDef);
const engineItems = new Function("inp", "q8", sDef[0] + "\n" + arrDef[0] + "\n" + planCode.slice(mapAt, mapEnd) + "\nreturn items;");
// an ITEMS-shaped row as the engine's SQL gives the same DB row: conversions as JSON text
const engineRow = (row) => ({ id: row.id, based_uom: row.based_uom, stock_control: 1, material_costing_method: "First In First Out", purchase_unit_price: "0",
  uom_conversion_json: row.uom_conversion_json !== undefined ? row.uom_conversion_json : JSON.stringify(row.table_uom_conversion || []) });
const engineItem = (row) => engineItems({ items: [engineRow(row)] }, engineQ8)[String(row.id)];
const UNIT = "2018906563477008392";
const PCS = "2018906563477008389";
const CTN = "2092460418772639785";
// the ITEMS SQL row shape (alt_uom_id CAST AS CHAR, base_qty a decimal number)
const itemRows = [
  { id: "2107721546371891202", based_uom: UNIT, table_uom_conversion: [{ alt_uom_id: UNIT, base_qty: 1 }] },
  { id: "1", based_uom: PCS, table_uom_conversion: [{ alt_uom_id: PCS, base_qty: 1 }, { alt_uom_id: CTN, base_qty: 12 }] },
  { id: "2", based_uom: PCS, table_uom_conversion: [{ alt_uom_id: CTN, base_qty: 0.333333 }] },
  { id: "3", based_uom: PCS, table_uom_conversion: [] },
  { id: "4", based_uom: PCS, uom_conversion_json: '[{"alt_uom_id":"' + CTN + '","base_qty":24.000000}]' },
  // the reviewer's edge cases: a blank UOM with a NULL base UOM meets a NULL-alt row; a spaced UOM; plus a numeric UOM and text base_qty
  { id: "e1", based_uom: null, table_uom_conversion: [{ alt_uom_id: null, base_qty: 12 }] },
  { id: "e2", based_uom: "5", table_uom_conversion: [{ alt_uom_id: "6", base_qty: 12 }] },
  { id: "e3", based_uom: "6", table_uom_conversion: [{ alt_uom_id: "6", base_qty: "12.000000" }] },
  { id: "e4", based_uom: null, table_uom_conversion: [] },
  { id: "e5", based_uom: PCS, uom_conversion_json: "not json" },
];
const cases = [[0, "5", UNIT], [1, "1.32", CTN], [1, "2", ""], [1, "2", "123"], [1, "0.1234567891", CTN], [2, "3", CTN], [3, "7.5", CTN], [4, "2", CTN], [1, 10, PCS],
  [5, "2", ""], [6, "2", " 6"], [6, "2", "6"], [7, "2", null], [7, "2", 6], [7, "2", ""], [8, "x", ""], [9, "3", CTN], [9, "3", ""]];
for (const [i, q, u] of cases) {
  const mine = P.idaUomOf(itemRows[i], q, u);
  const eng = engineUomOf(engineItem(itemRows[i]), { quantity: q, material_uom: u });
  eq("uomOf = engine: item " + itemRows[i].id + " qty " + q + " uom " + (u || "(base)"), [mine.altQty, mine.baseQty, mine.altUOM, mine.baseUOM], [eng.altQty, eng.baseQty, eng.altUOM, eng.baseUOM]);
}
eq("uom alt", P.idaUomOf(itemRows[1], "1.32", CTN), { altQty: 1.32, baseQty: 15.84, altUOM: CTN, baseUOM: PCS });
eq("uom reviewer case: blank UOM + NULL-alt row = engine 24", P.idaUomOf(itemRows[5], "2", "").baseQty, 24);
eq("uom reviewer case: UOM ' 6' = engine 2 (no trim)", P.idaUomOf(itemRows[6], "2", " 6").baseQty, 2);
eq("uom return shape", Object.keys(P.idaUomOf(itemRows[1], "1", CTN)), ["altQty", "baseQty", "altUOM", "baseUOM"]);
// a recorded search-node row carries 19-digit ids as JSON numbers: a pure-JS JSON.parse loses them, idaParseJ keeps them exact
const recordedText = '{"id":2092500426523025458,"based_uom":2092460418772639758,"table_uom_conversion":[{"alt_uom_id":2092460418772639758,"base_qty":1.0},{"alt_uom_id":2092460418772639785,"base_qty":16.0}]}';
const lossy = JSON.parse(recordedText);
eq("ids 27 apart are one double", lossy.table_uom_conversion[0].alt_uom_id === lossy.table_uom_conversion[1].alt_uom_id, true);
eq("uom big-int-safe row vs text line", P.idaUomOf(C.idaParseJ(recordedText), "2", CTN).baseQty, 32);
eq("lossy row never matches a text id", P.idaUomOf(lossy, "2", CTN).baseQty, 2);
eq("item of", P.idaItemOf(itemRows, "1") === itemRows[1], true);
eq("item of none", P.idaItemOf(itemRows, "9"), null);
yes("id eq exact", P.idaPrIdEq(CTN, " " + CTN));
no("id eq text differs", P.idaPrIdEq(CTN, "2092460418772639758"));
no("id eq empty", P.idaPrIdEq("", ""));

// ---------------------------------------------------------------- price: idaAllocate = the classic code_cost_alloc with the v7 divisor
// the v6 body (base/ida_code/code_cost_alloc.js) run as the platform would, then patched as CONTRACT.md section 11 item 2 says
const allocV6 = fs.readFileSync(path.join(BASE, "ida_code", "code_cost_alloc.js"), "utf8");
const OLD_PRICE = "    unit_price: qty > 0 ? q8(lineValue / qty) : 0,";
yes("v6 price line present once", allocV6.split(OLD_PRICE).length === 2);
const allocV7 = allocV6.replace("const receipts = lines.map(", "const baseQtyOf = function (line, qty) {\n  const it = itemMap[String(line.item_selection)] || {};\n"
  + "  const alt = line.quantity_uom || it.based_uom;\n  const row = (Array.isArray(it.table_uom_conversion) ? it.table_uom_conversion : []).find(function (c) { return c && String(c.alt_uom_id) === String(alt); });\n"
  + "  return row ? q8(qty * Number(row.base_qty)) : qty;\n};\nconst receipts = lines.map(").replace(OLD_PRICE, "    unit_price: baseQtyOf(line, qty) > 0 ? q8(lineValue / baseQtyOf(line, qty)) : 0,");
const runAlloc = (body, fx) => new Function(body.replace("{{node:code_fillback.data.allData}}", JSON.stringify(fx.entry)).replace("{{node:search_items.data.data}}", JSON.stringify(fx.items))
  .replace("{{node:search_movements.data.data}}", JSON.stringify(fx.movements)).replace("{{node:code_persisted.data}}", JSON.stringify({ stock_movement_no: fx.no }))
  .replace("{{node:code_apply_batches.data.stock_movement}}", JSON.stringify(fx.lines)))();
yes("v6 body has no other token", !/\{\{/.test(allocV6.replace(/\{\{node:(code_fillback\.data\.allData|search_items\.data\.data|search_movements\.data\.data|code_persisted\.data|code_apply_batches\.data\.stock_movement)\}\}/g, "")));
const allocOf = (fx) => fx.lines.map((l) => {
  const it = P.idaItemOf(fx.items, l.item_selection) || {};
  const share = C.idaQ8(l.total_quantity);
  return { share_qty: share, base_qty: P.idaUomOf(it, share, l.quantity_uom).baseQty };
});
const ENTRY = { issuing_operation_faci: "1123598813738675202", organization_id: "1123598813738675201", item_disassembly_date: "2026-10-16" };
const unitItem = (id) => ({ id: id, based_uom: UNIT, table_uom_conversion: [{ alt_uom_id: UNIT, base_qty: 1 }] });
const line = (item, qty, uom) => ({ item_selection: item, total_quantity: qty, quantity_uom: uom || UNIT, location_id: "2018912822846582786", batch_number: "-" });
// dev IDA-2610-001: OUT 10.00000000; lines 5, 5, 2 (base UOM); the stored IN rows: unit_price 0.83333333 x3 (total 4.16666665, 4.16666665, 1.66666666)
const FX1 = { no: "IDA-2610-001", entry: ENTRY, movements: [{ total_price: "10.00000000" }], items: ["2107721546371891202", "2107721718380298242", "2107724107950784513"].map(unitItem),
  lines: [line("2107721546371891202", 5), line("2107721718380298242", 5), line("2107724107950784513", 2)] };
// dev IDA-2610-003: OUT 20.00000000; lines 10, 10, 4, 1 (the last in UOM ...389 = its base); the stored IN rows: unit_price 0.80000000 x4
const FX3 = { no: "IDA-2610-003", entry: ENTRY, movements: [{ total_price: "20.00000000" }],
  items: ["2107721546371891202", "2107721718380298242", "2107724107950784513"].map(unitItem).concat([{ id: "2070758892513914881", based_uom: PCS, table_uom_conversion: [{ alt_uom_id: PCS, base_qty: 1 }] }]),
  lines: [line("2107721546371891202", 10), line("2107721718380298242", 10), line("2107724107950784513", 4), line("2070758892513914881", 1, PCS)] };
// a non-base UOM line (CTN = 12 PCS) and a non-stock last line that takes the remainder
const FXN = { no: "IDA-X", entry: ENTRY, movements: [{ total_price: "100" }, { total_price: "23.456789" }],
  items: [{ id: "1", based_uom: PCS, table_uom_conversion: [{ alt_uom_id: PCS, base_qty: 1 }, { alt_uom_id: CTN, base_qty: 12 }] }, unitItem("2"), { id: "3", based_uom: PCS, stock_control: 0, table_uom_conversion: [] }],
  lines: [line("1", 2, CTN), line("2", 7), line("3", 1.5, PCS)] };
for (const [name, fx, stored] of [["IDA-2610-001", FX1, [0.83333333, 0.83333333, 0.83333333]], ["IDA-2610-003", FX3, [0.8, 0.8, 0.8, 0.8]], ["non-base + non-stock last", FXN, null]]) {
  const issued = fx.movements.reduce((s, m) => s + parseFloat(m.total_price), 0);
  const mine = P.idaAllocate(String(issued), allocOf(fx));
  const v7 = runAlloc(allocV7, fx).receipts.map((r) => r.unit_price);
  eq("allocate = v7 code_cost_alloc: " + name, mine.map((x) => x.unit_price), v7);
  eq("allocate values sum to the issued value: " + name, C.idaQ8(mine.reduce((s, x) => s + x.value, 0)), C.idaQ8(issued));
  if (stored) {
    eq("allocate = the stored classic IN rows: " + name, mine.map((x) => x.unit_price), stored);
    eq("v6 = v7 on base-UOM lines: " + name, runAlloc(allocV6, fx).receipts.map((r) => r.unit_price), v7);
  }
}
const v6n = runAlloc(allocV6, FXN).receipts.map((r) => r.unit_price);
const v7n = runAlloc(allocV7, FXN).receipts.map((r) => r.unit_price);
yes("non-base line: v6 priced per line unit, v7 per base unit (factor 12, up to the q8 residue)", Math.abs(v6n[0] / v7n[0] - 12) < 1e-6);
eq("allocate empty", P.idaAllocate("10", []), []);
eq("allocate zero qty", P.idaAllocate("10", [{ share_qty: 0, base_qty: 0 }, { share_qty: 0, base_qty: 0 }]).map((x) => x.unit_price), [0, 0]);
eq("allocate one line takes all", P.idaAllocate("12.5", [{ share_qty: 5, base_qty: 60 }]), [{ value: 12.5, unit_price: 0.20833333 }]);

// ---------------------------------------------------------------- batchnum (TZ=Asia/Kuala_Lumpur) + the adapter
const bnText = fs.readFileSync(path.join(SHARED, "batchnum.js"), "utf8");
eq("batchnum = tpl/grv2 copy byte for byte", bnText, fs.readFileSync(path.join(TPL, "grv2", "shared", "batchnum.js"), "utf8"));
const BN = new Function(bnText + "\n" + strip(path.join(SHARED, "batchnum_adapter.js")) + "\nreturn { bnNumber, idaBatchnum };")();
eq("adapter without batchnum", require(path.join(SHARED, "batchnum_adapter.js")).idaBatchnum([], [], [{ item_id: "1" }], 0).error, "batch numbering (code/shared/batchnum.js) is not included");
// dev 000000's default config (BNC row, 2026-10-21): Organization Level, Document Created Date, Batch-%5d, running 631, Never Reset
const ORG0 = "1123598813738675201";
const CFG0 = { j: '{"id": "2062365526375706626", "item_id": null, "date_format": "Document Created Date", "batch_format": "Batch-%5d", "initial_value": 0, "item_group_id": null, "format_preview": "Batch-00001", "running_number": 631, "last_reset_date": null, "organization_id": "1123598813738675201", "reset_frequency": "Never Reset", "item_category_id": null, "batch_level_selection": "Organization Level"}' };
const ITEMS0 = [{ id: "2107721718380298242", item_category: "2018905941675634693", item_group_id: null }];
const reqs = (k, extra) => Array.from({ length: k }, () => C.idaBatchRequest({ item_disassembly_date: "2026-10-21 00:00:00" }, Object.assign({ item_selection: "2107721718380298242" }, extra || {}), ORG0));
const now = Date.UTC(2026, 9, 21, 4, 0, 0);
const g3 = BN.idaBatchnum([CFG0], ITEMS0, reqs(3), now);
// running_number is the NEXT number GENERATE_BATCH issues (it writes running_number + 1 back)
eq("auto numbers in call order", g3.numbers, ["Batch-00631", "Batch-00632", "Batch-00633"]);
eq("config before / after", g3.configs, [{ id: "2062365526375706626", before: { running_number: 631, last_reset_date: null }, after: { running_number: 634, last_reset_date: null } }]);
eq("adapter = bnNumber's own results", BN.bnNumber([CFG0], ITEMS0, reqs(3), { now: now }).results.map((r) => r.batch_number), g3.numbers);
const g2000 = BN.idaBatchnum([CFG0], ITEMS0, reqs(2000), now);
eq("2,000 numbers", [g2000.numbers.length, g2000.numbers[1999], g2000.configs[0].after.running_number], [2000, "Batch-02630", 2631]);
eq("2,000 numbers distinct", new Set(g2000.numbers).size, 2000);
eq("no request", BN.idaBatchnum([CFG0], ITEMS0, [], now), { numbers: [], configs: [] });
eq("no default config", BN.idaBatchnum([], ITEMS0, reqs(1), now), { error: "No default batch found.", failedAt: 0 });
eq("other organization's config only", BN.idaBatchnum([CFG0], ITEMS0, reqs(1).map((r) => Object.assign(r, { organization_id: "9" })), now).error, "No default batch found.");
const docDate = { j: CFG0.j.replace('"Document Created Date"', '"Document Date"') };
eq("Document Date required", BN.idaBatchnum([docDate], ITEMS0, [Object.assign(reqs(1)[0], { document_date: null })], now), { error: "Document Date is required.", failedAt: 0 });
const expDate = { j: CFG0.j.replace('"Document Created Date"', '"Expired Date"') };
eq("Expired Date required (2nd call)", BN.idaBatchnum([expDate], ITEMS0, [reqs(1, { expired_date: "2027-01-01 00:00:00" })[0], reqs(1)[0]], now), { error: "Expired Date is required.", failedAt: 1 });
const badFmt = { j: CFG0.j.replace('"Document Created Date"', '"Nonsense"') };
eq("bad date format", BN.idaBatchnum([badFmt], ITEMS0, reqs(1), now).error, "Invalid date format configuration.");
// a NULL batch_format makes a lifted body throw (format.includes): the adapter answers an error instead of failing the run
const nullFmt = { j: CFG0.j.replace('"batch_format": "Batch-%5d"', '"batch_format": null') };
let threw = null;
try {
  BN.bnNumber([nullFmt], ITEMS0, reqs(1), { now: now });
} catch (e) {
  threw = e;
}
yes("bnNumber itself throws on a NULL batch_format", threw instanceof TypeError);
const nf = BN.idaBatchnum([nullFmt], ITEMS0, reqs(2), now);
eq("NULL batch_format -> error, failedAt -1", [nf.failedAt, typeof nf.error, nf.numbers], [-1, "string", undefined]);
yes("NULL batch_format error names the configuration", nf.error.indexOf("batch number configuration 2062365526375706626 has no batch format") > 0
  && nf.error.indexOf("The batch number could not be generated") === 0);
eq("NULL batch_format as an object row", BN.idaBatchnum([JSON.parse(nullFmt.j)], ITEMS0, reqs(1), now).failedAt, -1);

// ---------------------------------------------------------------- files: one export line, no platform token, they concatenate with a step's helpers
const JS = ["ida_common.js", "fingerprint.js", "movekey.js", "price.js", "batchnum_adapter.js"];
for (const f of JS) {
  const text = fs.readFileSync(path.join(SHARED, f), "utf8");
  eq("one export line: " + f, text.split("\n").filter((l) => l.startsWith("if (typeof module")).length, 1);
  no("no platform token: " + f, /\{\{/.test(strip(path.join(SHARED, f))));
}
no("no platform token: batchnum.js", /\{\{/.test(bnText));
const grvCommon = fs.readFileSync(path.join(TPL, "grv2", "commit", "_common.js"), "utf8");
const smvCmp = fs.readFileSync(path.join(TPL, "smv2", "code", "commit", "_cmp.js"), "utf8");
let concatOk = true;
try {
  const fn = new Function(JS.map((f) => strip(path.join(SHARED, f))).join("\n") + "\n" + bnText + "\n" + grvCommon + "\n" + smvCmp
    + "\nreturn [idaLineFingerprint, idaAllocate, idaMapEngineMessage, idaBatchnum, bnNumber, sameStored, idaSameStored, s, q8, batchKey];");
  eq("concat runs", fn().length, 10);
} catch (e) {
  concatOk = false;
  console.log("FAIL concat: " + e.message);
}
yes("concat with tpl grv2 _common + smv2 _cmp + batchnum", concatOk);

console.log((fails ? "FAILED " + fails : "ok") + " - " + n + " checks");
process.exit(fails ? 1 : 0);

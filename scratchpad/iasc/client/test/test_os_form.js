// IA output split (plan 10-27): the form's os_main on the built ON form - the switch, the rows and the total for each item kind and
// page; row 1 kept in the header's single fields; the batch's dates kept one per batch; the quantity, the item and the plant changes; a
// Clone; a read-only view; the caps; no write loop when a setData re-enters a cell's onChange.
//   node scratchpad/iasc/client/test/test_os_form.js
const H = require("./harness");
const { check, same } = H;

const ON = H.readJSON(H.FILES.formOn);
const OSM = H.byName(ON, "os_main");
const SYS = { item_batch_management: 1, batch_number_genaration: "According To System Settings", serial_number_management: 0, stock_control: 1 };
const MAN = Object.assign({}, SYS, { batch_number_genaration: "Manual Input" });
const PLAIN = Object.assign({}, SYS, { item_batch_management: 0 });
const SERIAL = Object.assign({}, SYS, { serial_number_management: 1 });
const HEADER = ["storage_location_id", "location_id", "inventory_category", "batch_no", "manufacturing_date", "expired_date"];

const form = (values, o) => {
  o = o || {};
  const w = H.world(o.world || {});
  const self = H.makeThis(w, o.doc || ON, Object.assign({ stateful: true, fireOnChange: true, values: Object.assign({ page_status: "Add", item_assembly_status: "", item_id: "9001",
    item_qty: 836, storage_location_id: "71", location_id: "81", inventory_category: "Blocked", batch_no: "", manufacturing_date: "2026-10-27 00:00:00.000",
    expired_date: "2028-10-27 00:00:00.000", output_split: [], output_split_on: 0, output_split_sum: "" }, values) }, o));
  const op = async (args) => {
    const at = w.trace.length;
    self.triggerEvent("os_main", args);
    await H.drain(w);
    return w.trace.slice(at);
  };
  return { w, self, op, v: self.values };
};
// os_main's calls are recorded "os:" (harness: the base comparisons drop them)
const calls = (trace, name) => trace.filter((t) => t[0].replace(/^(sc|os):/, "") === name).map((t) => t.slice(1));
const shown = (trace) => calls(trace, "display").reduce((a, c) => a.concat(c[0]), []);
const hidden = (trace) => calls(trace, "hide").reduce((a, c) => a.concat(c[0]), []);
const rowsOf = (v, f) => v.output_split.map((r) => f.map((k) => r[k]));

(async () => {
  check("ON: os_main is built and switched on", !!OSM && /const OS_ENABLED = true;/.test(OSM.func));
  // ---- Add: no item yet -> no switch; the item chosen -> the switch for its kind
  let f = form({ item_id: "" });
  let t = await f.op({ osOp: "MOUNT", item: null });
  check("Add, no item: No. of Split, the switch and the rows hidden, nothing written", ["output_split_pick", "output_split_on", "output_split"].every((m) => hidden(t).indexOf(m) >= 0) &&
    calls(t, "setData").length === 0, t);
  t = await f.op({ osOp: "ITEM", item: SYS });
  check("an item chosen (System batch): No. of Split + Split shown (the user, 10-28: no switch), no rows", shown(t).indexOf("output_split_pick") >= 0 &&
    shown(t).indexOf("output_split_on") < 0 && hidden(t).indexOf("output_split_on") >= 0 && same(f.v.output_split, []) && f.self.models._data.ia_os.kind === "SYSTEM", t);
  // ---- the switch on: row 1 = the header's values, the whole output, group 1
  t = await f.op({ osOp: "SWITCH", value: 1 });
  check("switch on: row 1 = the header (qty, storage, bin, category, group 1, no number, the dates)", same(f.v.output_split, [{ os_qty: 836, os_storage_location_id: "71",
    os_location_id: "81", os_category: "Blocked", os_group: 1, os_batch_no: "", os_mfg_date: "2026-10-27 00:00:00.000", os_exp_date: "2028-10-27 00:00:00.000" }]), f.v.output_split);
  check("switch on: the rows and total shown, the header's single fields hidden", shown(t).indexOf("output_split") >= 0 && shown(t).indexOf("output_split_sum") >= 0 &&
    HEADER.every((h) => hidden(t).indexOf(h) >= 0), [shown(t), hidden(t)]);
  check("switch on (System): batch no and dates shown, the number not typed (generated at completion)", ["output_split.os_batch_no",
    "output_split.os_mfg_date", "output_split.os_exp_date"].every((c) => shown(t).indexOf(c) >= 0) && calls(t, "disabled").some((c) => same(c, [["output_split.os_batch_no"], true])), t);
  check("switch on (System): the Group column hidden (the user, 10-27: every row is its own batch)", hidden(t).indexOf("output_split.os_group") >= 0 &&
    shown(t).indexOf("output_split.os_group") < 0, [shown(t), hidden(t)]);
  check("switch on: the total complete", f.v.output_split_sum === "Split total 836 of 836 ✓", f.v.output_split_sum);
  // ---- Add Row: the previous row's storage / category / dates, no bin, what is left; System: its own batch (hidden group = its row)
  f.v.output_split.push({});
  t = await f.op({ osOp: "ADD", rowIndex: 1 });
  check("Add Row with nothing left: no qty, the previous row's storage / category / dates, no bin, its own group (2)", same(f.v.output_split[1], { os_qty: null, os_storage_location_id: "71",
    os_location_id: "", os_category: "Blocked", os_group: 2, os_batch_no: "", os_mfg_date: "2026-10-27 00:00:00.000", os_exp_date: "2028-10-27 00:00:00.000" }), f.v.output_split[1]);
  f.v.output_split[0].os_qty = 500;
  t = await f.op({ osOp: "CELL", field: "os_qty", rowIndex: 0, value: 500 });
  check("a qty changed: the total says what is left", f.v.output_split_sum === "Split total 500 of 836 - 336 still to place", f.v.output_split_sum);
  f.v.output_split.push({});
  await f.op({ osOp: "ADD", rowIndex: 2 });
  check("Add Row: the qty left (336)", f.v.output_split[2].os_qty === 336 && f.v.output_split_sum === "Split total 836 of 836 ✓", [f.v.output_split[2], f.v.output_split_sum]);
  // ---- a storage location changed: the row's bin cleared (the bin list is the row's storage location's)
  f.v.output_split[2].os_location_id = "83";
  f.v.output_split[2].os_storage_location_id = "72";
  t = await f.op({ osOp: "CELL", field: "os_storage_location_id", rowIndex: 2, value: "72" });
  check("storage location changed: its bin cleared", f.v.output_split[2].os_storage_location_id === "72" && f.v.output_split[2].os_location_id === "", f.v.output_split[2]);
  // ---- System: every row is its own batch with its own dates: a date on row 1 stays row 1's (and the header's)
  check("System: three rows, three groups (one batch each)", same(rowsOf(f.v, ["os_group"]), [[1], [2], [3]]), rowsOf(f.v, ["os_group"]));
  t = await f.op({ osOp: "CELL", field: "os_mfg_date", rowIndex: 0, value: "2026-11-01 00:00:00.000" });
  check("System: a date typed on row 1 stays row 1's, the header takes it", same(rowsOf(f.v, ["os_mfg_date"]), [["2026-11-01 00:00:00.000"], ["2026-10-27 00:00:00.000"],
    ["2026-10-27 00:00:00.000"]]) && f.v.manufacturing_date === "2026-11-01 00:00:00.000", [rowsOf(f.v, ["os_mfg_date"]), f.v.manufacturing_date]);
  await f.op({ osOp: "CELL", field: "os_mfg_date", rowIndex: 2, value: "2026-10-20 00:00:00.000" });
  check("System: row 3's date its own, rows 1 and 2 keep theirs", same(rowsOf(f.v, ["os_mfg_date"]), [["2026-11-01 00:00:00.000"], ["2026-10-27 00:00:00.000"],
    ["2026-10-20 00:00:00.000"]]), rowsOf(f.v, ["os_mfg_date"]));
  // ---- row 1's fields stay in the header
  await f.op({ osOp: "CELL", field: "os_location_id", rowIndex: 0, value: "88" });
  check("row 1's bin -> the header's bin", f.v.location_id === "88", f.v.location_id);
  // ---- the output quantity: the last row takes the difference
  f.v.item_qty = 840;
  await f.op({ osOp: "QTY" });
  check("output qty 840: the last row takes the difference (340)", f.v.output_split[2].os_qty === 340 && f.v.output_split_sum === "Split total 840 of 840 ✓", f.v.output_split);
  f.v.item_qty = 400;
  await f.op({ osOp: "QTY" });
  check("output qty below the other rows: nothing changed, the total says too many", f.v.output_split[2].os_qty === 340 && /too many/.test(f.v.output_split_sum), f.v.output_split_sum);
  f.v.item_qty = 840;
  // ---- a row removed: the next row becomes row 1 in the header
  f.v.output_split.splice(0, 1);
  t = await f.op({ osOp: "REMOVE" });
  check("row 1 removed: the new row 1 in the header", f.v.location_id === "" && f.v.storage_location_id === "71", [f.v.location_id, f.v.storage_location_id]);
  check("System, row 1 removed: the groups follow the rows again (1, 2)", same(rowsOf(f.v, ["os_group"]), [[1], [2]]), rowsOf(f.v, ["os_group"]));
  // ---- the switch off: kept when cancelled; confirmed -> row 1 back in the header, the rows gone, the single fields shown
  let g = form({ output_split: [{ os_qty: 500, os_storage_location_id: "72", os_location_id: "85", os_category: "Unrestricted", os_group: 1 }, { os_qty: 336, os_location_id: "86" }],
    output_split_on: 1 }, { confirm: () => "cancel" });
  g.self.models._data.ia_os = { kind: "PLAIN" };
  t = await g.op({ osOp: "SWITCH", value: 0 });
  check("switch off, cancelled: the switch back on, the rows kept", g.v.output_split_on === 1 && g.v.output_split.length === 2, [g.v.output_split_on, g.v.output_split.length]);
  g = form({ output_split: [{ os_qty: 500, os_storage_location_id: "72", os_location_id: "85", os_category: "Unrestricted", os_group: 1 }, { os_qty: 336, os_location_id: "86" }],
    output_split_on: 1 });
  g.self.models._data.ia_os = { kind: "PLAIN" };
  t = await g.op({ osOp: "SWITCH", value: 0 });
  check("switch off, confirmed: row 1's storage / bin / category in the header, the rows cleared, the single fields shown",
    [g.v.storage_location_id, g.v.location_id, g.v.inventory_category, g.v.output_split.length, g.v.output_split_on] + "" === ["72", "85", "Unrestricted", 0, 0] + "" &&
    ["storage_location_id", "location_id", "inventory_category"].every((h) => shown(t).indexOf(h) >= 0), [g.v, shown(t)]);
  // ---- the item or the plant changed: the split cleared
  g = form({ output_split: [{ os_qty: 1 }, { os_qty: 2 }], output_split_on: 1 });
  t = await g.op({ osOp: "ITEM", item: MAN });
  check("the item changed: its split cleared, No. of Split shown for the new kind", g.v.output_split.length === 0 && g.v.output_split_on === 0 && shown(t).indexOf("batch_no") >= 0 &&
    shown(t).indexOf("output_split_pick") >= 0, [g.v.output_split, shown(t)]);
  g = form({ output_split: [{ os_qty: 1 }, { os_qty: 2 }], output_split_on: 1 });
  await g.op({ osOp: "PLANT" });
  check("the plant changed: the split cleared", g.v.output_split.length === 0 && g.v.output_split_on === 0, g.v.output_split);
  // ---- Manual: the typed number is the batch; a row given a batch's number takes its dates
  g = form({ batch_no: "LOT-A" });
  await g.op({ osOp: "ITEM", item: MAN });
  t = await g.op({ osOp: "SWITCH", value: 1 });
  check("Manual: row 1 takes the header's batch, the number typed (enabled), no group", g.v.output_split[0].os_batch_no === "LOT-A" && g.v.output_split[0].os_group === null &&
    calls(t, "disabled").some((c) => same(c, [["output_split.os_batch_no"], false])) && hidden(t).indexOf("output_split.os_group") >= 0, [g.v.output_split[0], t]);
  g.v.output_split.push({});
  await g.op({ osOp: "ADD", rowIndex: 1 });
  g.v.output_split[1].os_batch_no = "lot-b";
  await g.op({ osOp: "CELL", field: "os_batch_no", rowIndex: 1, value: "lot-b" });
  await g.op({ osOp: "CELL", field: "os_exp_date", rowIndex: 1, value: "2030-01-01 00:00:00.000" });
  check("Manual: a date on another batch stays its own", g.v.output_split[0].os_exp_date === "2028-10-27 00:00:00.000", g.v.output_split[0]);
  g.v.output_split[1].os_batch_no = "lot-a";
  await g.op({ osOp: "CELL", field: "os_batch_no", rowIndex: 1, value: "lot-a" });
  check("Manual: a row given row 1's number (any case) takes its dates", g.v.output_split[1].os_exp_date === "2028-10-27 00:00:00.000", g.v.output_split[1]);
  // ---- non-batch: bins only
  g = form({});
  await g.op({ osOp: "ITEM", item: PLAIN });
  t = await g.op({ osOp: "SWITCH", value: 1 });
  check("non-batch: row 1 without group / number / dates, those columns hidden", same([g.v.output_split[0].os_group, g.v.output_split[0].os_batch_no, g.v.output_split[0].os_mfg_date], [null, "", ""]) &&
    ["output_split.os_group", "output_split.os_batch_no", "output_split.os_mfg_date", "output_split.os_exp_date"].every((c) => hidden(t).indexOf(c) >= 0), [g.v.output_split[0], hidden(t)]);
  // ---- serial / non-stock items: no switch, refused if forced
  g = form({});
  t = await g.op({ osOp: "ITEM", item: SERIAL });
  check("a serial item: No. of Split and the switch hidden", ["output_split_pick", "output_split_on"].every((m) => hidden(t).indexOf(m) >= 0 && shown(t).indexOf(m) < 0), t);
  t = await g.op({ osOp: "SWITCH", value: 1 });
  check("a serial item switched on anyway: refused, back off, no row", g.v.output_split_on === 0 && g.v.output_split.length === 0 && calls(t, "$message.error").length === 1, t);
  // ---- the caps
  g = form({ output_split: Array.from({ length: 21 }, () => ({ os_qty: 1 })), output_split_on: 1 });
  g.self.models._data.ia_os = { kind: "PLAIN" };
  t = await g.op({ osOp: "ADD", rowIndex: 20 });
  check("a 21st row: taken away again, the cap said", g.v.output_split.length === 20 && /at most 20 rows/.test((calls(t, "$message.error")[0] || [])[0] || ""), [g.v.output_split.length, t]);
  // ---- a Clone: the rows' bins and quantities kept, never the source's numbers or dates
  g = form({ page_status: "Clone", output_split: [{ os_qty: 500, os_location_id: "81", os_group: 1, os_batch_no: "1056-022-0004", os_mfg_date: "D1", os_exp_date: "D2" },
    { os_qty: 336, os_location_id: "82", os_group: 2, os_batch_no: "1056-022-0005", os_mfg_date: "D3", os_exp_date: "D4" }] });
  t = await g.op({ osOp: "MOUNT", item: SYS });
  check("Clone: numbers and dates cleared, bins / qty / groups kept, the rows editable", same(rowsOf(g.v, ["os_qty", "os_location_id", "os_group", "os_batch_no", "os_mfg_date"]),
    [[500, "81", 1, "", ""], [336, "82", 2, "", ""]]) && calls(t, "disabled").some((c) => same(c, [["output_split"], false])) && g.v.output_split_on === 1, [g.v.output_split, t]);
  // ---- an editable Edit with a stored split: shown as it is
  g = form({ page_status: "Edit", item_assembly_status: "Draft", output_split: [{ os_qty: 500, os_group: 1, os_batch_no: "" }, { os_qty: 336, os_group: 2 }] });
  t = await g.op({ osOp: "MOUNT", item: SYS });
  check("Edit of a Draft with a split: the switch on, the rows shown and editable, the header's fields hidden", g.v.output_split_on === 1 && shown(t).indexOf("output_split") >= 0 &&
    calls(t, "disabled").some((c) => same(c, [["output_split"], false])) && hidden(t).indexOf("location_id") >= 0 && calls(t, "setData").every((c) => !("output_split" in c[0])), t);
  // a Draft saved while rows could share a group (before 10-27 evening): opened, every row gets its own batch
  g = form({ page_status: "Edit", item_assembly_status: "Draft", output_split: [{ os_qty: 500, os_group: 1, os_batch_no: "" }, { os_qty: 336, os_group: 1 }] });
  t = await g.op({ osOp: "MOUNT", item: SYS });
  check("Edit of a Draft whose rows share a group: renumbered on open (1, 2)", same(rowsOf(g.v, ["os_group"]), [[1], [2]]) &&
    calls(t, "setData").some((c) => "output_split" in c[0]), [rowsOf(g.v, ["os_group"]), t]);
  g = form({ page_status: "Edit", item_assembly_status: "Draft", output_split: [{ os_qty: 500, os_group: "1", os_batch_no: "" }, { os_qty: 336, os_group: "2" }] });
  t = await g.op({ osOp: "MOUNT", item: SYS });
  check("Edit of a Draft whose groups come back as text (\"1\", \"2\"): already one per row, nothing written", calls(t, "setData").every((c) => !("output_split" in c[0])), t);
  g = form({ page_status: "Edit", item_assembly_status: "Completed", output_split: [{ os_qty: 500, os_group: 1, os_batch_no: "B-1" }, { os_qty: 336, os_group: 1, os_batch_no: "B-1" }] });
  t = await g.op({ osOp: "MOUNT", item: SYS });
  check("a Completed IA whose rows share a group: opened as it is, nothing written", same(rowsOf(g.v, ["os_group"]), [[1], [1]]) &&
    calls(t, "setData").every((c) => !("output_split" in c[0])), t);
  // ---- a read-only view (Completed / Fully Posted / Processing / View): the rows read-only, only the columns with a value, no switch
  g = form({ page_status: "Edit", item_assembly_status: "Completed", output_split: [{ os_qty: 500, os_group: 1, os_batch_no: "1056-022-0004", os_mfg_date: "D1" },
    { os_qty: 336, os_group: 1, os_batch_no: "1056-022-0004", os_mfg_date: "D1" }] });
  t = await g.op({ osOp: "VIEW" });
  check("read-only view: the rows disabled, No. of Split and the switch hidden, group hidden, number and mfg date shown, expiry hidden (empty)",
    calls(t, "disabled").some((c) => same(c, [["output_split"], true])) && hidden(t).indexOf("output_split_pick") >= 0 &&
    hidden(t).indexOf("output_split_on") >= 0 && hidden(t).indexOf("output_split.os_group") >= 0 && shown(t).indexOf("output_split.os_batch_no") >= 0 &&
    shown(t).indexOf("output_split.os_mfg_date") >= 0 && hidden(t).indexOf("output_split.os_exp_date") >= 0, t);
  t = await g.op({ osOp: "ADD", rowIndex: 1 });
  check("read-only view: Add Row undone, said", g.v.output_split.length === 1 && /can no longer be changed/.test((calls(t, "$message.error")[0] || [])[0] || ""), [g.v.output_split.length, t]);
  g = form({ page_status: "View", output_split: [] });
  t = await g.op({ osOp: "VIEW" });
  check("read-only view of an IA without a split: only No. of Split and the switch hidden, nothing written", ["output_split_pick", "output_split_on"].every((m) => hidden(t).indexOf(m) >= 0) &&
    calls(t, "setData").length === 0, t);
  // ---- no write loop: a cell's setData re-enters its onChange (fireOnChange): bounded, then quiet (Manual: rows with one number = one batch)
  g = form({ batch_no: "LOT-A" });
  await g.op({ osOp: "ITEM", item: MAN });
  await g.op({ osOp: "SWITCH", value: 1 });
  g.v.output_split.push({});
  await g.op({ osOp: "ADD", rowIndex: 1 });
  t = await g.op({ osOp: "CELL", field: "os_exp_date", rowIndex: 0, value: "2031-01-01 00:00:00.000" });
  check("re-entry: a date synced to its batch writes each cell once, then stops", calls(t, "triggerEvent").filter((c) => c[0] === "os_main").length <= 4 &&
    calls(t, "setData").filter((c) => Object.keys(c[0]).some((k) => /os_exp_date$/.test(k))).length === 1 && g.v.output_split[1].os_exp_date === "2031-01-01 00:00:00.000", t);
  // ---- the default bin (the user, 10-27): Add Row and a storage location change give the row its storage location's default bin -
  // the assembled item's own default bin for this plant when it sits there, else the storage location's (the header's rule, onChange_Plant)
  const BINS = [{ id: "91", plant_id: "61", storage_location_id: "71", is_deleted: 0, is_default: 1, bin_status: 1 },
    { id: "93", plant_id: "61", storage_location_id: "71", is_deleted: 0, is_default: 0, bin_status: 1 },
    { id: "92", plant_id: "61", storage_location_id: "72", is_deleted: 0, is_default: 1, bin_status: 1 }];
  const dbf = (items, more) => ({ world: Object.assign({ db: H.tableDb({ bin_location: BINS, item: items }) }, more || {}) });
  let d = form({ issuing_operation_faci: "61" }, dbf([{ id: "9001", table_default_bin: [] }]));
  await d.op({ osOp: "ITEM", item: SYS });
  await d.op({ osOp: "SWITCH", value: 1 });
  d.v.output_split[0].os_qty = 500;
  await d.op({ osOp: "CELL", field: "os_qty", rowIndex: 0, value: 500 });
  d.v.output_split.push({});
  t = await d.op({ osOp: "ADD", rowIndex: 1 });
  check("Add Row: the bin = the row's storage location's default bin, no error shown", d.v.output_split[1].os_location_id === "91" && d.v.output_split[1].os_qty === 336 &&
    calls(t, "$message.error").length === 0, [d.v.output_split[1], calls(t, "$message.error")]);
  const binReads = () => d.w.reads.filter((q) => q.collection === "bin_location").length;
  const r1 = binReads();
  d.v.output_split.push({});
  await d.op({ osOp: "ADD", rowIndex: 2 });
  check("Add Row again in the same storage location: its default read once", d.v.output_split[2].os_location_id === "91" && binReads() === r1, [binReads(), r1]);
  d.v.output_split[2].os_storage_location_id = "72";
  await d.op({ osOp: "CELL", field: "os_storage_location_id", rowIndex: 2, value: "72" });
  check("a row's storage location changed: its bin = that storage location's default bin", d.v.output_split[2].os_location_id === "92", d.v.output_split[2]);
  d = form({ issuing_operation_faci: "61" }, dbf([{ id: "9001", table_default_bin: [{ plant_id: "61", storage_location: "71", bin_location: "95" },
    { plant_id: "99", storage_location: "71", bin_location: "96" }] }]));
  await d.op({ osOp: "ITEM", item: PLAIN });
  await d.op({ osOp: "SWITCH", value: 1 });
  d.v.output_split.push({});
  await d.op({ osOp: "ADD", rowIndex: 1 });
  check("Add Row: the item's own default bin for this plant and storage location wins", d.v.output_split[1].os_location_id === "95", d.v.output_split[1]);
  d = form({ issuing_operation_faci: "61", storage_location_id: "79" }, dbf([{ id: "9001", table_default_bin: [] }]));
  await d.op({ osOp: "ITEM", item: PLAIN });
  await d.op({ osOp: "SWITCH", value: 1 });
  d.v.output_split.push({});
  await d.op({ osOp: "ADD", rowIndex: 1 });
  check("Add Row: no default bin for the storage location -> the bin left empty", d.v.output_split[1].os_location_id === "", d.v.output_split[1]);
  d = form({ issuing_operation_faci: "61" }, dbf([{ id: "9001", table_default_bin: [] }], { dbDelay: (name) => (name === "bin_location" ? 50 : 0) }));
  await d.op({ osOp: "ITEM", item: PLAIN });
  await d.op({ osOp: "SWITCH", value: 1 });
  d.v.output_split.push({});
  d.self.triggerEvent("os_main", { osOp: "ADD", rowIndex: 1 });
  check("Add Row: the row is written at once (the default bin follows)", d.v.output_split[1].os_qty === null && d.v.output_split[1].os_location_id === "", d.v.output_split[1]);
  d.v.output_split[1].os_location_id = "77";
  await d.op({ osOp: "CELL", field: "os_location_id", rowIndex: 1, value: "77" });
  check("Add Row: a bin picked while the default is read stays", d.v.output_split[1].os_location_id === "77", d.v.output_split[1]);
  // ---- the total line warns of rows the save refuses (the same batch, bin and category: IA-2610-014, 10-27) as soon as they clash
  d = form({ issuing_operation_faci: "61", location_id: "91", inventory_category: "Unrestricted", item_qty: 4 }, dbf([{ id: "9001", table_default_bin: [] }]));
  await d.op({ osOp: "ITEM", item: PLAIN });
  await d.op({ osOp: "SWITCH", value: 1 });
  d.v.output_split[0].os_qty = 2;
  await d.op({ osOp: "CELL", field: "os_qty", rowIndex: 0, value: 2 });
  d.v.output_split.push({});
  await d.op({ osOp: "ADD", rowIndex: 1 });
  check("a row given row 1's bin (the default): the total line says the save would refuse it", d.v.output_split[1].os_location_id === "91" &&
    d.v.output_split_sum === "Split total 4 of 4 ✓ - but rows 1 and 2 go to the same bin and category: change a bin or merge them", d.v.output_split_sum);
  d.v.output_split[1].os_location_id = "93";
  await d.op({ osOp: "CELL", field: "os_location_id", rowIndex: 1, value: "93" });
  check("another bin picked: the warning gone", d.v.output_split_sum === "Split total 4 of 4 ✓", d.v.output_split_sum);
  d.v.output_split[1].os_location_id = "91";
  d.v.output_split[1].os_category = "Blocked";
  await d.op({ osOp: "CELL", field: "os_category", rowIndex: 1, value: "Blocked" });
  check("the same bin in another category: no warning", d.v.output_split_sum === "Split total 4 of 4 ✓", d.v.output_split_sum);
  d = form({ issuing_operation_faci: "61", storage_location_id: "79", location_id: "", inventory_category: "Unrestricted", item_qty: 4 }, dbf([{ id: "9001", table_default_bin: [] }]));
  await d.op({ osOp: "ITEM", item: PLAIN });
  await d.op({ osOp: "SWITCH", value: 1 });
  d.v.output_split[0].os_qty = 2;
  await d.op({ osOp: "CELL", field: "os_qty", rowIndex: 0, value: 2 });
  d.v.output_split.push({});
  await d.op({ osOp: "ADD", rowIndex: 1 });
  check("two rows without a bin yet (same category): no warning until a bin is picked", rowsOf(d.v, ["os_location_id"]).every((x) => x[0] === "") &&
    d.v.output_split_sum === "Split total 4 of 4 ✓", [rowsOf(d.v, ["os_location_id"]), d.v.output_split_sum]);
  d = form({ issuing_operation_faci: "61", location_id: "91", inventory_category: "Unrestricted", item_qty: 4 }, dbf([{ id: "9001", table_default_bin: [] }]));
  await d.op({ osOp: "ITEM", item: SYS });
  await d.op({ osOp: "SWITCH", value: 1 });
  d.v.output_split[0].os_qty = 2;
  await d.op({ osOp: "CELL", field: "os_qty", rowIndex: 0, value: 2 });
  d.v.output_split.push({});
  await d.op({ osOp: "ADD", rowIndex: 1 });
  check("System, two rows into the same bin and category: two batches, no warning", d.v.output_split[1].os_location_id === "91" &&
    same(rowsOf(d.v, ["os_group"]), [[1], [2]]) && d.v.output_split_sum === "Split total 4 of 4 ✓", [rowsOf(d.v, ["os_group", "os_location_id"]), d.v.output_split_sum]);
  d = form({ issuing_operation_faci: "61", location_id: "91", inventory_category: "Unrestricted", item_qty: 4, batch_no: "M-1" }, dbf([{ id: "9001", table_default_bin: [] }]));
  await d.op({ osOp: "ITEM", item: MAN });
  await d.op({ osOp: "SWITCH", value: 1 });
  d.v.output_split[0].os_qty = 2;
  await d.op({ osOp: "CELL", field: "os_qty", rowIndex: 0, value: 2 });
  d.v.output_split.push({});
  await d.op({ osOp: "ADD", rowIndex: 1 });
  check("Manual, row 1's number copied into the same bin and category: the batch wording", d.v.output_split[1].os_batch_no === "M-1" && d.v.output_split_sum ===
    "Split total 4 of 4 ✓ - but rows 1 and 2 put the same batch into the same bin and category: change a bin or merge them", d.v.output_split_sum);
  d.v.output_split[1].os_batch_no = "M-2";
  await d.op({ osOp: "CELL", field: "os_batch_no", rowIndex: 1, value: "M-2" });
  check("Manual, another number (another batch) in the same bin: no warning", d.v.output_split_sum === "Split total 4 of 4 ✓", d.v.output_split_sum);
  d.v.output_split[1].os_batch_no = "m-1";
  await d.op({ osOp: "CELL", field: "os_batch_no", rowIndex: 1, value: "m-1" });
  check("Manual, the same number in other letter case (one batch, as the save reads it): the warning", /rows 1 and 2 put the same batch/.test(d.v.output_split_sum),
    d.v.output_split_sum);
  // ---- No. of Split + Split (the user, 10-28, as GR's split): every row at once - the output spread (whole numbers when it is whole, the
  // first rows one more), each row the Output Location's storage / bin / category and the dates typed before the split; System: each row
  // its own batch, so a date typed after the split stays that row's; a split IA splits again from row 1 (asked); 1 or blank = one receipt
  const COLS8 = ["os_qty", "os_storage_location_id", "os_location_id", "os_category", "os_group", "os_batch_no", "os_mfg_date", "os_exp_date"];
  const D1 = "2026-10-27 00:00:00.000";
  const E1 = "2028-10-27 00:00:00.000";
  let s = form({});
  await s.op({ osOp: "ITEM", item: SYS });
  s.v.output_split_count = 3;
  t = await s.op({ osOp: "SPLIT" });
  check("Split 3 of 836 (System): 279 / 279 / 278, the header's storage / bin / category and dates on every row, one batch each", same(rowsOf(s.v, COLS8), [
    [279, "71", "81", "Blocked", 1, "", D1, E1], [279, "71", "81", "Blocked", 2, "", D1, E1], [278, "71", "81", "Blocked", 3, "", D1, E1]]), s.v.output_split);
  check("Split: the rows and total shown, the header's single fields hidden, the split on, the total complete, nothing asked", shown(t).indexOf("output_split") >= 0 &&
    HEADER.every((h) => hidden(t).indexOf(h) >= 0) && s.v.output_split_on === 1 && s.v.output_split_sum === "Split total 836 of 836 ✓" && calls(t, "$confirm").length === 0,
    [shown(t), hidden(t), s.v.output_split_sum]);
  await s.op({ osOp: "CELL", field: "os_exp_date", rowIndex: 1, value: "2029-01-01 00:00:00.000" });
  check("after the split: a date typed on row 2 stays row 2's", same(rowsOf(s.v, ["os_exp_date"]), [[E1], ["2029-01-01 00:00:00.000"], [E1]]), rowsOf(s.v, ["os_exp_date"]));
  s.v.output_split.push({});
  await s.op({ osOp: "ADD", rowIndex: 3 });
  check("Add Row after a split: No. of Split follows the rows (4)", s.v.output_split_count === 4, s.v.output_split_count);
  s.v.output_split.splice(3, 1);
  await s.op({ osOp: "REMOVE" });
  check("a row deleted: No. of Split follows the rows (3)", s.v.output_split_count === 3, s.v.output_split_count);
  const three = () => [
    { os_qty: 279, os_storage_location_id: "72", os_location_id: "85", os_category: "Unrestricted", os_group: 1, os_batch_no: "", os_mfg_date: "D2", os_exp_date: "E2" },
    { os_qty: 279, os_storage_location_id: "71", os_location_id: "86", os_category: "Blocked", os_group: 2, os_batch_no: "", os_mfg_date: D1, os_exp_date: E1 },
    { os_qty: 278, os_storage_location_id: "71", os_location_id: "87", os_category: "Blocked", os_group: 3, os_batch_no: "", os_mfg_date: D1, os_exp_date: E1 }];
  const splitIa = (count, o) => {
    const x = form({ page_status: "Edit", item_assembly_status: "Draft", output_split: three(), output_split_on: 1, output_split_count: count }, o);
    x.self.models._data.ia_os = { kind: "SYSTEM" };
    return x;
  };
  s = splitIa(2, { confirm: () => "cancel" });
  t = await s.op({ osOp: "SPLIT" });
  check("split again, cancelled: asked, the rows kept, No. of Split back to 3", calls(t, "$confirm").length === 1 && s.v.output_split.length === 3 && s.v.output_split_count === 3,
    [s.v.output_split.length, s.v.output_split_count]);
  s = splitIa(2);
  t = await s.op({ osOp: "SPLIT" });
  check("split again, confirmed: 2 rows rebuilt from row 1 (418 / 418, its storage, bin, category and dates)", calls(t, "$confirm").length === 1 &&
    same(rowsOf(s.v, COLS8), [[418, "72", "85", "Unrestricted", 1, "", "D2", "E2"], [418, "72", "85", "Unrestricted", 2, "", "D2", "E2"]]), s.v.output_split);
  for (const count of [1, null, ""]) {
    s = splitIa(count);
    t = await s.op({ osOp: "SPLIT" });
    check("Split " + JSON.stringify(count) + " on a split IA: one receipt again (asked; row 1 in the header, the rows gone, No. of Split empty)", calls(t, "$confirm").length === 1 &&
      s.v.output_split.length === 0 && s.v.output_split_on === 0 && [s.v.storage_location_id, s.v.location_id, s.v.inventory_category] + "" === ["72", "85", "Unrestricted"] + "" &&
      [null, ""].indexOf(s.v.output_split_count) >= 0 && ["storage_location_id", "location_id", "inventory_category"].every((h) => shown(t).indexOf(h) >= 0), [s.v, shown(t)]);
  }
  s = splitIa(1, { confirm: () => "cancel" });
  t = await s.op({ osOp: "SPLIT" });
  check("Split 1, cancelled: the split kept, No. of Split back to 3", s.v.output_split.length === 3 && s.v.output_split_count === 3, [s.v.output_split.length, s.v.output_split_count]);
  // the user, 10-29: rows deleted down to one -> one receipt again by itself (a one-row split can't be completed), nothing asked
  s = splitIa(3);
  s.v.output_split.splice(1, 2);
  t = await s.op({ osOp: "REMOVE" });
  check("rows deleted down to one: one receipt again, nothing asked (that row's storage, bin, category and dates in the header, the rows gone, No. of Split empty)",
    calls(t, "$confirm").length === 0 && s.v.output_split.length === 0 && s.v.output_split_on === 0 &&
    [s.v.storage_location_id, s.v.location_id, s.v.inventory_category, s.v.manufacturing_date] + "" === ["72", "85", "Unrestricted", "D2"] + "" &&
    [null, ""].indexOf(s.v.output_split_count) >= 0 && ["storage_location_id", "location_id", "inventory_category"].every((h) => shown(t).indexOf(h) >= 0), [s.v, shown(t)]);
  s = form({ output_split_count: null });
  await s.op({ osOp: "ITEM", item: SYS });
  t = await s.op({ osOp: "SPLIT" });
  check("Split with nothing typed and no split: nothing happens", calls(t, "setData").length === 0 && calls(t, "$message.error").length === 0 && calls(t, "$confirm").length === 0, t);
  s = splitIa(null);
  await s.op({ osOp: "MOUNT", item: SYS });
  check("Edit of a split IA: No. of Split shows its rows (3), shown", s.v.output_split_count === 3, s.v.output_split_count);
  // the quantity rule
  // (the item first: choosing an item clears No. of Split)
  const ready = async (values, item, count) => {
    const x = form(values);
    await x.op({ osOp: "ITEM", item: item });
    x.v.output_split_count = count;
    return x;
  };
  s = await ready({ item_qty: 1.1 }, SYS, 3);
  await s.op({ osOp: "SPLIT" });
  check("Split 3 of 1.1 (not whole): equal parts to 8 decimals, the last row the rounding, the total exact", same(rowsOf(s.v, ["os_qty"]), [[0.36666666], [0.36666666], [0.36666668]]) &&
    s.v.output_split_sum === "Split total 1.1 of 1.1 ✓", [rowsOf(s.v, ["os_qty"]), s.v.output_split_sum]);
  s = await ready({ item_qty: 10 }, SYS, "4");
  await s.op({ osOp: "SPLIT" });
  check("Split \"4\" (typed: the field is a text input) of 10: 3 / 3 / 2 / 2", same(rowsOf(s.v, ["os_qty"]), [[3], [3], [2], [2]]), rowsOf(s.v, ["os_qty"]));
  const refused = async (values, item, re, label) => {
    const x = await ready(values, item, values.output_split_count);
    const tt = await x.op({ osOp: "SPLIT" });
    const msg = (calls(tt, "$message.error")[0] || [])[0] || "";
    check(label + ": refused (" + msg + "), no rows", x.v.output_split.length === 0 && re.test(msg), tt);
  };
  await refused({ item_qty: 2, output_split_count: 3 }, SYS, /2 .*at most 2 rows/, "Split 3 of 2 whole units");
  await refused({ output_split_count: 21 }, SYS, /2 to 20/, "Split 21");
  await refused({ output_split_count: 2.5 }, SYS, /2 to 20/, "Split 2.5");
  await refused({ output_split_count: "x" }, SYS, /2 to 20/, "Split x");
  await refused({ item_qty: null, output_split_count: 2 }, SYS, /output quantity/, "Split without an output quantity");
  await refused({ output_split_count: 2 }, SERIAL, /Serial-numbered/, "Split of a serial item");
  // Manual: the header's batch number on every row (one batch: the total warns until a bin changes); non-batch: bins only
  s = await ready({ batch_no: "LOT-A" }, MAN, 2);
  await s.op({ osOp: "SPLIT" });
  check("Split 2 (Manual): the header's batch and dates on both rows, no group; the total warns about the same bin", same(rowsOf(s.v, COLS8), [[418, "71", "81", "Blocked", null, "LOT-A", D1, E1],
    [418, "71", "81", "Blocked", null, "LOT-A", D1, E1]]) && /rows 1 and 2 put the same batch into the same bin and category/.test(s.v.output_split_sum), [s.v.output_split, s.v.output_split_sum]);
  await s.op({ osOp: "CELL", field: "os_location_id", rowIndex: 1, value: "86" });
  check("Manual: row 2 in another bin -> the total complete", s.v.output_split_sum === "Split total 836 of 836 ✓", s.v.output_split_sum);
  s = await ready({}, PLAIN, 2);
  await s.op({ osOp: "SPLIT" });
  check("Split 2 (non-batch): bins only (no group / number / dates)", same(rowsOf(s.v, COLS8), [[418, "71", "81", "Blocked", null, "", "", ""], [418, "71", "81", "Blocked", null, "", "", ""]]),
    s.v.output_split);
  // read-only: nothing
  s = form({ page_status: "Edit", item_assembly_status: "Completed", output_split: three(), output_split_on: 1, output_split_count: 2 });
  s.self.models._data.ia_os = { kind: "SYSTEM" };
  t = await s.op({ osOp: "SPLIT" });
  check("Split on a read-only IA: nothing changes", s.v.output_split.length === 3 && calls(t, "setData").length === 0, t);
  // ---- OS_ENABLED false: nothing at all
  const OFF = H.clone(ON);
  H.byName(OFF, "os_main").func = H.byName(OFF, "os_main").func.replace("const OS_ENABLED = true;", "const OS_ENABLED = false;");
  g = form({ output_split: [{ os_qty: 1 }, { os_qty: 2 }] }, { doc: OFF });
  t = await g.op({ osOp: "PLANT" });
  check("switched off: os_main does nothing", calls(t, "setData").length === 0 && calls(t, "hide").length === 0 && g.v.output_split.length === 2, t);
  H.done("test_os_form");
})().catch((e) => {
  check("the test ran to its end", false, String(e && e.stack).slice(0, 800));
  H.done("test_os_form");
});

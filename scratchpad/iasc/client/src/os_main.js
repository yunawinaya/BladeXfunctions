// os_main - Item Assembly form, the output split (plan 10-27, scratchpad/iasc): the Output Location's No. of Split + Split (10-28; the
// hidden "Split receipt" switch only keeps the state), its rows (output_split, one receipt each) and their total. Every op comes from a
// forwarder (Split, the switch, a row added / removed, a cell) or a
// patched handler (mounted, the item, the plant, the output quantity). Row 1 stays in the header's single fields (single-value readers
// and the required checks); IA_SAVE v14 checks every rule again at completion. A setData of a cell re-enters its onChange: only cells
// whose value changes are written
const OS_ENABLED = __OS_ENABLED__;
/*@@OS_SPLIT@@*/
const osArgs = arguments[0] || {};
const OS_HEADER = ["storage_location_id", "location_id", "inventory_category", "batch_no", "manufacturing_date", "expired_date"];
const OS_BASE_COLS = ["os_qty", "os_storage_location_id", "os_location_id", "os_category"];
const OS_KIND_COLS = { SYSTEM: ["os_batch_no", "os_mfg_date", "os_exp_date"], MANUAL: ["os_batch_no", "os_mfg_date", "os_exp_date"], PLAIN: [] };
const OS_OPT_COLS = ["os_group", "os_batch_no", "os_mfg_date", "os_exp_date"];
const osCol = (c) => "output_split." + c;
const osState = () => ((this.models && this.models["_data"]) || {}).ia_os || {};
const osSetState = (s) => {
  this.models["_data"] = Object.assign({}, this.models["_data"], { ia_os: Object.assign({}, osState(), s) });
};
const osRows = () => {
  const v = this.getValue("output_split");
  return Array.isArray(v) ? v.map((r) => Object.assign({}, r)) : [];
};
const osAllowed = (kind) => kind === "SYSTEM" || kind === "MANUAL" || kind === "PLAIN";
const osEditable = () => {
  const page = osS(this.getValue("page_status"));
  const status = osS(this.getValue("item_assembly_status"));
  return page === "Add" || page === "Clone" || (page === "Edit" && (status === "" || status === "Draft" || status === "Created"));
};
const osSame = (a, b) => osS(a) === osS(b);
// the switch's state: 1 = on; anything else (0, empty, a form without the field) = off
const osIsOn = () => Number(this.getValue("output_split_on")) === 1;
// System numbering (the user, 10-27): every row is its own batch - its group (hidden) is its row number, so the save generates one
// number per row; true when a row's group changed
const osOwnGroups = (rows, kind) => {
  if (kind !== "SYSTEM") return false;
  let changed = false;
  rows.forEach((r, k) => {
    if (Number(r.os_group) !== k + 1) {
      r.os_group = k + 1;
      changed = true;
    }
  });
  return changed;
};
// the date pair of a row's batch (System: its group; Manual: its number, case-insensitive)
const osBatchKey = (r, kind) => (kind === "SYSTEM" ? osS(r.os_group) && "G" + osS(r.os_group) : kind === "MANUAL" ? osS(r.os_batch_no) && "B" + osS(r.os_batch_no).toLowerCase() : "");
// the first two rows the save refuses as one (osCheck: the same batch, bin and category), or null; a row without a bin does not count yet
const osClash = (rows, kind) => {
  const seen = {};
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!osS(r.os_location_id)) continue;
    const key = (kind === "SYSTEM" ? "G" + osS(r.os_group) : kind === "MANUAL" ? "B" + osS(r.os_batch_no).toLowerCase() : "") + "|" + osS(r.os_location_id) + "|" + osS(r.os_category);
    if (seen[key] !== undefined) return [seen[key] + 1, i + 1];
    seen[key] = i;
  }
  return null;
};
const osTotalText = (rows) => {
  const total = osSum(rows);
  const want = osQ8(this.getValue("item_qty"));
  const diff = osQ8(want - total);
  const kind = osState().kind || "";
  const clash = osClash(rows, kind);
  return "Split total " + total + " of " + want + (Math.abs(diff) <= OS_EPS ? " ✓" : diff > 0 ? " - " + diff + " still to place" : " - " + osQ8(-diff) + " too many") +
    (clash ? " - but rows " + clash[0] + " and " + clash[1] + (kind === "SYSTEM" || kind === "MANUAL" ? " put the same batch into the same bin and category" :
      " go to the same bin and category") + ": change a bin or merge them" : "");
};
const osHeaderShow = (kind) => {
  this.display(["storage_location_id", "location_id", "inventory_category"]);
  if (kind === "MANUAL") this.display(["batch_no"]);
  if (kind === "SYSTEM" || kind === "MANUAL") this.display(["manufacturing_date", "expired_date"]);
};
// row 1 into the header's single fields (a System number is generated at completion: the header keeps none until then)
const osHeaderSync = (rows, kind) => {
  const r = rows[0];
  if (!r) return;
  const want = { storage_location_id: r.os_storage_location_id || "", location_id: r.os_location_id || "", inventory_category: r.os_category || "Unrestricted" };
  if (kind === "MANUAL") want.batch_no = osS(r.os_batch_no);
  if (kind === "SYSTEM" || kind === "MANUAL") Object.assign(want, { manufacturing_date: r.os_mfg_date || null, expired_date: r.os_exp_date || null });
  const set = {};
  Object.keys(want).forEach((k) => {
    if (!osSame(this.getValue(k), want[k])) set[k] = want[k];
  });
  if (Object.keys(set).length) this.setData(set);
};
const osTotal = (rows) => {
  const text = rows.length ? osTotalText(rows) : "";
  if (!osSame(this.getValue("output_split_sum"), text)) this.setData({ output_split_sum: text });
};
// No. of Split shows the rows there are (empty without a split)
const osCount = (rows) => {
  const n = rows.length ? rows.length : null;
  if (!osSame(this.getValue("output_split_count"), n)) this.setData({ output_split_count: n });
};
// No. of Split + Split (the switch only keeps the state), the rows and their columns for this item (kind) and page; read-only pages show
// only the columns that hold a value
const osLayout = (kind, rows, editable) => {
  this.hide(["output_split_on"]);
  if (editable && osAllowed(kind)) this.display(["output_split_pick"]);
  else this.hide(["output_split_pick"]);
  const on = rows.length > 0;
  if (osIsOn() !== on) this.setData({ output_split_on: on ? 1 : 0 });
  if (editable) osCount(rows);
  if (!on) {
    this.hide(["output_split", "output_split_sum"]);
    return;
  }
  const shown = editable ? OS_KIND_COLS[kind] || [] : OS_OPT_COLS.filter((c) => c !== "os_group" && rows.some((r) => osS(r[c]) !== ""));
  this.hide(OS_HEADER);
  this.display(["output_split", "output_split_sum"]);
  this.display(OS_BASE_COLS.concat(shown).map(osCol));
  const hidden = OS_OPT_COLS.filter((c) => shown.indexOf(c) < 0);
  if (hidden.length) this.hide(hidden.map(osCol));
  // a System number is generated at completion: not typed
  if (editable) this.disabled([osCol("os_batch_no")], kind !== "MANUAL");
  this.disabled(["output_split"], !editable);
  osTotal(rows);
};
const osWrite = (rows) => this.setData({ output_split: rows });
// a split row's default bin, as the header gets one (onChange_Plant): the assembled item's own default bin for this plant when it sits in
// the row's storage location, else that storage location's default bin; "" when there is none. Read once per plant / item / storage location
const osDefaultBin = async (storageId) => {
  const plant = osS(this.getValue("issuing_operation_faci"));
  const item = osS(this.getValue("item_id"));
  const sl = osS(storageId);
  if (!osDigits(plant) || !osDigits(sl)) return "";
  const key = plant + "|" + item + "|" + sl;
  const known = osState().binDefaults || {};
  if (known[key] !== undefined) return known[key];
  let bin = "";
  if (osDigits(item)) {
    const res = await db.collection("item").field("table_default_bin").where({ id: item }).get().catch(() => ({ data: [] }));
    const own = ((res.data && res.data[0] && res.data[0].table_default_bin) || []).find((b) => b && osS(b.plant_id) === plant && osS(b.storage_location) === sl && osS(b.bin_location));
    if (own) bin = osS(own.bin_location);
  }
  if (!bin) {
    const res = await db.collection("bin_location").where({ plant_id: plant, storage_location_id: sl, is_deleted: 0, is_default: 1, bin_status: 1 }).get()
      .catch(() => ({ data: [] }));
    bin = osS(res.data && res.data[0] && res.data[0].id);
  }
  osSetState({ binDefaults: Object.assign({}, osState().binDefaults || {}, { [key]: bin }) });
  return bin;
};
// the default bin into row i once it is known - while the row still has no bin and the same storage location (a bin picked meanwhile stays)
const osFillBin = async (i, storageId) => {
  const bin = await osDefaultBin(storageId);
  const r = osRows()[i];
  if (!bin || !r || osS(r.os_location_id) !== "" || osS(r.os_storage_location_id) !== osS(storageId)) return;
  this.setData({ ["output_split." + i + ".os_location_id"]: bin });
};
const osClear = (kind) => {
  if (!osRows().length) return false;
  osWrite([]);
  if (osIsOn()) this.setData({ output_split_on: 0 });
  osCount([]);
  this.hide(["output_split", "output_split_sum"]);
  osHeaderShow(kind);
  return true;
};

const osMountOp = (item) => {
  const kind = item ? osKind(item) : "";
  osSetState({ kind: kind });
  const rows = osRows();
  // a Clone is a new production run: its rows keep their bins and quantities, never the source's numbers or dates
  let write = false;
  if (osS(this.getValue("page_status")) === "Clone" && rows.some((r) => osS(r.os_batch_no) || osS(r.os_mfg_date) || osS(r.os_exp_date))) {
    rows.forEach((r) => Object.assign(r, { os_batch_no: "", os_mfg_date: "", os_exp_date: "" }));
    write = true;
  }
  // a Draft saved while rows could share a group: every row its own batch again
  if (osEditable() && osOwnGroups(rows, kind)) write = true;
  if (write) osWrite(rows);
  osLayout(kind, rows, osEditable());
};
const osViewOp = () => {
  const rows = osRows();
  if (rows.length) osLayout(osState().kind || "", rows, false);
  else this.hide(["output_split_on", "output_split_pick"]);
};
const osItemOp = (item) => {
  const kind = item ? osKind(item) : "";
  osSetState({ kind: kind });
  osClear(kind);
  osLayout(kind, [], osEditable());
};
const osSwitchOp = async (value) => {
  const kind = osState().kind || "";
  const rows = osRows();
  const on = Number(value) === 1 || value === true;
  if (on === rows.length > 0) return;
  if (on) {
    if (!osAllowed(kind) || !osEditable()) {
      this.setData({ output_split_on: 0 });
      this.$message.error(kind === "SERIAL" ? "Serial-numbered items cannot be split across bins." : kind === "NONSTOCK" ?
        "This item is not stock-controlled: there is no receipt to split." : "Choose the item to assemble first.");
      return;
    }
    const seed = [{ os_qty: osQ8(this.getValue("item_qty")), os_storage_location_id: this.getValue("storage_location_id") || "", os_location_id: this.getValue("location_id") || "",
      os_category: this.getValue("inventory_category") || "Unrestricted", os_group: kind === "SYSTEM" ? 1 : null, os_batch_no: kind === "MANUAL" ? osS(this.getValue("batch_no")) : "",
      os_mfg_date: kind === "PLAIN" ? "" : this.getValue("manufacturing_date") || "", os_exp_date: kind === "PLAIN" ? "" : this.getValue("expired_date") || "" }];
    osWrite(seed);
    osLayout(kind, seed, true);
    return;
  }
  try {
    await this.$confirm("Receive the whole output into row 1's bin again? The other rows are removed.", "Split receipt off", { confirmButtonText: "Remove the rows",
      cancelButtonText: "Keep the split", type: "warning" });
  } catch (e) {
    this.setData({ output_split_on: 1 });
    return;
  }
  osHeaderSync(rows, kind);
  osClear(kind);
};
const osAddOp = (index) => {
  const kind = osState().kind || "";
  const rows = osRows();
  const i = Number.isInteger(index) && index >= 0 && index < rows.length ? index : rows.length - 1;
  if (i < 0) return;
  if (!osEditable() || rows.length > OS_MAX_ROWS) {
    rows.splice(i, 1);
    osWrite(rows);
    this.$message.error(osEditable() ? "A split receipt can have at most " + OS_MAX_ROWS + " rows." : "This Item Assembly can no longer be changed.");
    return;
  }
  const prev = rows[i - 1] || rows[i + 1] || {};
  const left = Math.max(0, osQ8(osQ8(this.getValue("item_qty")) - osSum(rows.filter((_, k) => k !== i))));
  rows[i] = Object.assign({}, rows[i], { os_qty: left > 0 ? left : null, os_storage_location_id: prev.os_storage_location_id || this.getValue("storage_location_id") || "",
    os_location_id: "", os_category: prev.os_category || this.getValue("inventory_category") || "Unrestricted", os_group: null,
    os_batch_no: kind === "MANUAL" ? osS(prev.os_batch_no) : "", os_mfg_date: kind === "PLAIN" ? "" : prev.os_mfg_date || "", os_exp_date: kind === "PLAIN" ? "" : prev.os_exp_date || "" });
  osOwnGroups(rows, kind);
  osWrite(rows);
  osTotal(rows);
  osCount(rows);
  return osFillBin(i, rows[i].os_storage_location_id);
};
const osRemoveOp = () => {
  const kind = osState().kind || "";
  const rows = osRows();
  if (!rows.length) {
    if (osIsOn()) this.setData({ output_split_on: 0 });
    osCount([]);
    this.hide(["output_split", "output_split_sum"]);
    osHeaderShow(kind);
    return;
  }
  // one row left (the user, 10-29): a split needs 2, so it is one receipt again by itself - that row into the Output Location fields
  if (rows.length === 1) {
    osHeaderSync(rows, kind);
    osClear(kind);
    return;
  }
  if (osOwnGroups(rows, kind)) osWrite(rows);
  osHeaderSync(rows, kind);
  osTotal(rows);
  osCount(rows);
};
const osCellOp = (field, index, value) => {
  const kind = osState().kind || "";
  const rows = osRows();
  const i = Number(index);
  if (!Number.isInteger(i) || !rows[i]) return;
  const set = {};
  const put = (k, f, v) => {
    if (!osSame(rows[k][f], v)) {
      rows[k][f] = v;
      set["output_split." + k + "." + f] = v;
    }
  };
  // the cell itself, when the model does not hold the typed value yet
  if (value !== undefined) put(i, field, value);
  if (field === "os_storage_location_id" && value !== undefined) put(i, "os_location_id", "");
  // a batch has one date pair: a row joining a batch takes its dates; a date typed on one row goes to the batch's other rows
  const key = osBatchKey(rows[i], kind);
  if (key && (field === "os_group" || field === "os_batch_no")) {
    const mate = rows.find((r, k) => k !== i && osBatchKey(r, kind) === key);
    if (mate) {
      put(i, "os_mfg_date", mate.os_mfg_date || "");
      put(i, "os_exp_date", mate.os_exp_date || "");
    }
  }
  if (key && (field === "os_mfg_date" || field === "os_exp_date")) rows.forEach((r, k) => k !== i && osBatchKey(r, kind) === key && put(k, field, rows[i][field] || ""));
  if (Object.keys(set).length) this.setData(set);
  osHeaderSync(rows, kind);
  osTotal(rows);
  // another storage location: its default bin (the cleared bin above)
  if (field === "os_storage_location_id" && value !== undefined) return osFillBin(i, value);
};
// No. of Split + Split (the user, 10-28, as GR's split): every row at once - the output spread over them (whole numbers when it is whole,
// the first rows one more; else 8 decimals, the last row the rounding), each row the Output Location's storage location, bin, category
// and the dates typed before the split (Manual: its batch number too; System: each row its own batch). A split IA splits again from
// row 1 (asked first); 1 or nothing = one receipt again (asked)
const osParts = (total, n) => {
  if (Math.abs(total - Math.round(total)) <= OS_EPS) {
    const t = Math.round(total);
    if (t < n) return null;
    const base = Math.floor(t / n);
    return Array.from({ length: n }, (_, k) => base + (k < t - base * n ? 1 : 0));
  }
  const each = osQ8(Math.floor((total / n) * 1e8) / 1e8);
  if (!(each > 0)) return null;
  return Array.from({ length: n }, (_, k) => (k < n - 1 ? each : osQ8(total - each * (n - 1))));
};
const osSplitOp = async () => {
  const kind = osState().kind || "";
  const rows = osRows();
  if (!osEditable()) return;
  if (!osAllowed(kind)) {
    this.$message.error(kind === "SERIAL" ? "Serial-numbered items cannot be split across bins." : kind === "NONSTOCK" ?
      "This item is not stock-controlled: there is no receipt to split." : "Choose the item to assemble first.");
    return;
  }
  const raw = this.getValue("output_split_count");
  const n = Number(raw);
  if (osS(raw) === "" || n === 1) {
    if (!rows.length) return;
    try {
      await this.$confirm("Receive the whole output into row 1's bin again? The other rows are removed.", "One receipt", { confirmButtonText: "Remove the rows",
        cancelButtonText: "Keep the split", type: "warning" });
    } catch (e) {
      osCount(rows);
      return;
    }
    osHeaderSync(rows, kind);
    osClear(kind);
    return;
  }
  if (!Number.isInteger(n) || n < 2 || n > OS_MAX_ROWS) {
    this.$message.error("Enter a number of rows from 2 to " + OS_MAX_ROWS + ".");
    return;
  }
  const total = osQ8(this.getValue("item_qty"));
  if (!(total > 0)) {
    this.$message.error("Enter the output quantity first, then split it.");
    return;
  }
  const parts = osParts(total, n);
  if (!parts) {
    this.$message.error(Math.abs(total - Math.round(total)) <= OS_EPS ? total + " can't be split into " + n + " rows of whole units: split it into at most " +
      Math.round(total) + " rows." : total + " is too small to split into " + n + " rows.");
    return;
  }
  if (rows.length) {
    try {
      await this.$confirm("Split the output again into " + n + " rows? Every row is made again from row 1's storage location, bin, category and dates.", "Split again",
        { confirmButtonText: "Split again", cancelButtonText: "Keep the rows", type: "warning" });
    } catch (e) {
      osCount(rows);
      return;
    }
  }
  const r1 = rows[0];
  const from = r1 ? { sl: r1.os_storage_location_id, bin: r1.os_location_id, cat: r1.os_category, batch: r1.os_batch_no, mfg: r1.os_mfg_date, exp: r1.os_exp_date } :
    { sl: this.getValue("storage_location_id"), bin: this.getValue("location_id"), cat: this.getValue("inventory_category"), batch: this.getValue("batch_no"),
      mfg: this.getValue("manufacturing_date"), exp: this.getValue("expired_date") };
  const made = parts.map((q, k) => ({ os_qty: q, os_storage_location_id: from.sl || "", os_location_id: from.bin || "", os_category: from.cat || "Unrestricted",
    os_group: kind === "SYSTEM" ? k + 1 : null, os_batch_no: kind === "MANUAL" ? osS(from.batch) : "", os_mfg_date: kind === "PLAIN" ? "" : from.mfg || "",
    os_exp_date: kind === "PLAIN" ? "" : from.exp || "" }));
  osWrite(made);
  osLayout(kind, made, true);
  osHeaderSync(made, kind);
};
// the output quantity changed: one row follows it; several = the last row takes the difference while it stays above 0
const osQtyOp = () => {
  const rows = osRows();
  if (!rows.length) return;
  const want = osQ8(this.getValue("item_qty"));
  const last = rows.length - 1;
  const v = osQ8(want - osSum(rows.slice(0, last)));
  if (v > 0 && !osSame(rows[last].os_qty, v)) {
    rows[last].os_qty = v;
    this.setData({ ["output_split." + last + ".os_qty"]: v });
  }
  osTotal(rows);
};
const osPlantOp = () => osClear(osState().kind || "");

(async () => {
  if (!OS_ENABLED) return;
  try {
    const op = osS(osArgs.osOp);
    if (op === "MOUNT") osMountOp(osArgs.item || null);
    else if (op === "VIEW") osViewOp();
    else if (op === "ITEM") osItemOp(osArgs.item || null);
    else if (op === "PLANT") osPlantOp();
    else if (op === "QTY") osQtyOp();
    else if (op === "SWITCH") await osSwitchOp(osArgs.value);
    else if (op === "ADD") await osAddOp(osArgs.rowIndex);
    else if (op === "REMOVE") osRemoveOp();
    else if (op === "CELL") await osCellOp(osS(osArgs.field), osArgs.rowIndex, osArgs.value);
    else if (op === "SPLIT") await osSplitOp();
  } catch (error) {
    console.error(error);
    this.$message.error("Split receipt: " + (error && error.message ? error.message : "an error occurred"));
  }
})();

// os_main - Item Assembly form, the output split (plan 10-27, scratchpad/iasc): the Output Location "Split receipt" switch, its rows
// (output_split, one receipt each) and their total. Every op comes from a forwarder (the switch, a row added / removed, a cell) or a
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
// the switch, the rows and their columns for this item (kind) and page; read-only pages show only the columns that hold a value
const osLayout = (kind, rows, editable) => {
  if (editable && osAllowed(kind)) this.display(["output_split_on"]);
  else this.hide(["output_split_on"]);
  const on = rows.length > 0;
  if (osIsOn() !== on) this.setData({ output_split_on: on ? 1 : 0 });
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
  else this.hide(["output_split_on"]);
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
  return osFillBin(i, rows[i].os_storage_location_id);
};
const osRemoveOp = () => {
  const kind = osState().kind || "";
  const rows = osRows();
  if (!rows.length) {
    if (osIsOn()) this.setData({ output_split_on: 0 });
    this.hide(["output_split", "output_split_sum"]);
    osHeaderShow(kind);
    return;
  }
  if (osOwnGroups(rows, kind)) osWrite(rows);
  osHeaderSync(rows, kind);
  osTotal(rows);
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
  } catch (error) {
    console.error(error);
    this.$message.error("Split receipt: " + (error && error.message ? error.message : "an error occurred"));
  }
})();

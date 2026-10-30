// JSON integrity of the Small Cycle IA form builds (scratchpad/iasc/CONTRACT.md section 9):
// OFF = v36 + the new widgets (all hidden, no event bound, no handler changed); ON = OFF + the new events bound to them and
// the patched handlers, each = its v36 text plus exactly the Small Cycle insertions (undo them -> v36); the four
// confirmBomVariance copies keep the v36 body verbatim; IA_NOT_RECORD strips the UI models and keeps the data keys; every
// new key 8-char and unique; no platform token in new code; every changed script compiles; the mirrors = the embedded text.
//   node scratchpad/iasc/client/test/test_sc_json.js
const fs = require("fs");
const path = require("path");
const H = require("./harness");
const { check, same } = H;

const F0 = H.readJSON(H.FILES.formBase);
const OFF = H.readJSON(H.FILES.form);
const ON = H.readJSON(H.FILES.formOn);
const SRC = path.join(__dirname, "../src");
const read = (p) => fs.readFileSync(p, "utf8");

// the widgets every build adds: model -> [type, parent (model, or "" = top level), dataBind]
const DATA = {
  source_so_id: ["input", ""], source_so_line_id: ["input", ""], source_so_context_json: ["textarea", ""], source_bom_id: ["input", ""],
  bom_snapshot_json: ["textarea", ""], bom_consumption_mode: ["radio", "grid_x46134mc"], planned_output_qty: ["number", "grid_x46134mc"],
  // RES-01 R1: the IA's raw-material hold result (server-owned) and when it was last checked
  material_hold_status: ["input", ""], material_hold_at: ["input", ""],
  // IA output split (plan 10-27): the receipt rows (one json column, no child table) and the Split receipt switch
  output_split: ["table", ""], output_split_on: ["switch", ""],
  // IA transfer request (ENH-20261027-001): the IA's link to its request (IA_TRANSFER_REQUEST writes it)
  transfer_request_id: ["input", ""], transfer_request_no: ["input", ""],
};
const UI = {
  sc_section: ["grid", ""], sc_collapse: ["collapse", "sc_section"], sc_info: ["grid", "sc_collapse"], sc_actions: ["flex", "sc_collapse"], sc_btn_line: ["button", "sc_actions"], sc_btn_unlink: ["button", "sc_actions"],
  sc_btn_relink: ["button", "sc_actions"], sc_btn_suggest: ["button", "sc_actions"], sc_btn_bom: ["button", "sc_actions"], sc_btn_refresh: ["button", "sc_actions"],
  sc_line_dialog: ["dialog", ""], sc_line_table: ["table", "sc_line_dialog"], sc_expand_dialog: ["dialog", ""], sc_expand_note: ["text", "sc_expand_dialog"], sc_expand_all: ["button", "sc_expand_dialog"],
  sc_expand_table: ["table", "sc_expand_dialog"],
  // IA output split: the split total line; No. of Split + Split (the user, 10-28, as GR's split dialog row)
  output_split_sum: ["text", ""], output_split_pick: ["grid", ""], output_split_count: ["input", "output_split_pick"], output_split_btn: ["button", "output_split_pick"],
};
// IA output split (plan 10-27): No. of Split + Split (10-28), the switch (hidden: the state), the rows and the total under them (10-28), top
// level right after sc_section (ON: the Output Location section's first, full-width column); the grid's columns: model -> [type, label]
const OS = ["output_split_pick", "output_split_on", "output_split", "output_split_sum"];
// the split's UI models at the end of IA V2's IA_NOT_RECORD (before the transfer request's)
const OS_UI = ["output_split_sum", "output_split_pick", "output_split_count", "output_split_btn"];
const OS_NOT_RECORD = ", " + OS_UI.map((m) => '"' + m + '"').join(", ") + "];";
const OS_COLS = [["os_qty", "number", "Qty"], ["os_storage_location_id", "select", "Storage Location"], ["os_location_id", "select", "Bin Location"],
  ["os_category", "select", "Category"], ["os_group", "number", "Group"], ["os_batch_no", "input", "Batch No"], ["os_mfg_date", "date", "Manufacturing Date"],
  ["os_exp_date", "date", "Expired Date"]];
const OS_BIN_FORMULA = "{{value:output_split}}.map(item => item.os_storage_location_id)[arguments[0].rowIndex]";
// the info rows (sc_info): the line on the left, the production figures on the right, then full width the BOM and the messages;
// model -> label; each a read-only text shown only when it has a fact
const PANEL = [
  [["sc_info_so", "Sales Order"], ["sc_info_customer", "Customer"], ["sc_info_ordered", "Ordered"], ["sc_info_delivered", "Delivered"]],
  [["sc_info_produced", "Produced"], ["sc_info_open", "In Progress"], ["sc_info_suggest", "Remaining to Plan"], ["sc_info_cover", "After This IA"]],
  [["sc_info_bom", "BOM"], ["sc_info_over", "Over the Order"], ["sc_info_warn", "Warnings"]]];
// the key rows bold, the two message rows (no label) in the app's error style (the Item form's error_msg)
const ROW_CLASS = { sc_info_so: "font-bold", sc_info_suggest: "font-bold", sc_info_over: "error-msg", sc_info_warn: "error-msg" };
const MESSAGE_ROWS = ["sc_info_over", "sc_info_warn"];
PANEL.flat().forEach(([m]) => (UI[m] = ["text", "sc_info"]));
const LINE_COLS = ["so_no", "line_no", "customer", "ordered", "delivered", "suggestion", "uom", "line_id", "so_id", "uom_id", "pick"];
const EXPAND_COLS = ["component", "level", "bom", "under", "uses", "item_id", "path", "kind", "expand"];
// the events ON binds: widget model -> [event, handler name]
const BOUND = {
  bom_consumption_mode: ["onChange", "sc_onChange_mode"], planned_output_qty: ["onChange", "sc_onChange_planned"], sc_btn_line: ["onClick", "sc_onClick_line"],
  sc_btn_unlink: ["onClick", "sc_onClick_unlink"], sc_btn_relink: ["onClick", "sc_onClick_relink"], sc_btn_suggest: ["onClick", "sc_onClick_suggest"],
  sc_btn_bom: ["onClick", "sc_onClick_bom"], sc_btn_refresh: ["onClick", "sc_onClick_refresh"], sc_expand_all: ["onClick", "sc_onClick_expandAll"],
};
const DIALOG_BOUND = { sc_line_dialog: { onCancel: "sc_onCancel_line" }, sc_expand_dialog: { onCancel: "sc_onCancel_expand", onConfirm: "sc_onConfirm_expand" } };
const ROW_LINK = ["sc_line_table", "pick", "sc_onClick_pickLine"];
const NEW_EVENTS = ["sc_main"].concat(Object.values(BOUND).map((b) => b[1]), ["sc_onClick_pickLine", "sc_onCancel_line", "sc_onCancel_expand", "sc_onConfirm_expand",
  "onClick_saveAsCreated", "onChange_requiredQty", "sc_onChange_expandLevel", "sc_onChange_expandTick"]);
// IA output split (plan 10-27): os_main and its forwarders (the switch, a row added / removed, each column)
const OS_EVENTS = ["os_main", "os_onChange_switch", "os_onRowAdd", "os_onRowRemove"].concat(["qty", "storage_location_id", "location_id", "category", "group", "batch_no", "mfg_date",
  "exp_date"].map((c) => "os_onChange_" + c), ["os_onClick_split"]);
// IA transfer request (ENH-20261027-001, scratchpad/iatr): tr_main and its forwarders; its section (before the components) and Request
// Materials (the action bar); its one mount call (after Small Cycle's) and its UI models at the end of IA_NOT_RECORD
// (a reserved IA's requests, RESERVED_REQUEST_PLAN.md Task 9: Request Replacement, Report Defect and the defect dialog, after the v7 ones)
const TR_EVENTS = ["tr_main", "tr_onClick_new", "tr_onClick_create", "tr_onClick_view", "tr_onClick_refresh", "tr_onClick_cancel", "tr_onChange_storage", "tr_onClick_replace",
  "tr_onClick_defect", "tr_onConfirm_defect", "tr_onCancel_defect"];
const TR_UI = ["tr_section", "tr_collapse", "tr_info", "tr_pick", "tr_storage_location_id", "tr_location_id", "tr_required_date", "tr_actions", "tr_btn_create", "tr_btn_view", "tr_btn_refresh", "tr_btn_cancel", "tr_btn_new",
  "tr_btn_replace", "tr_btn_defect", "tr_defect_dialog", "tr_defect_note", "tr_defect_table"];
const TR_MOUNT_CALL = '    this.triggerEvent("tr_main", { trOp: "MOUNT", pageStatus: pageStatus, status: status });\n';
const TR_NOT_RECORD = ", " + TR_UI.map((m) => '"' + m + '"').join(", ") + "];";
const untrText = (t) => String(t).replace(TR_MOUNT_CALL, "").replace(TR_NOT_RECORD, "];");
// the split's marked blocks in the patched handlers and the mount's widened item read; unosDoc = the form without the split's handlers
const OS_BLOCK_RE = /[ ]*\/\/ IA output split \(scratchpad\/iasc os_main\):[^\n]*\n[ ]*this\.triggerEvent\("os_main", \{ osOp: "[A-Z]+"(?:, item: item \|\| null)? \}\);\n[ ]*\/\/ -- end output split --\n/g;
const OS_FIELDS = ['.field("item_batch_management,batch_number_genaration,serial_number_management,stock_control")', '.field("item_batch_management,batch_number_genaration")'];
const unos = (t) => String(t).replace(OS_BLOCK_RE, "").replace(OS_FIELDS[0], OS_FIELDS[1]).replace(OS_NOT_RECORD, ', "output_split_sum"];').replace(', "output_split_sum"];', "];");
const unosDoc = (doc) => {
  const d = H.clone(doc);
  const keys = d.config.eventScript.filter((e) => OS_EVENTS.indexOf(e.name) >= 0).map((e) => e.key);
  d.config.eventScript = d.config.eventScript.filter((e) => keys.indexOf(e.key) < 0);
  // the IA V2 wait's park kick (10-27): not in v59 either
  d.config.eventScript.forEach((e) => {
    if (e.func) e.func = unpark(e.key, unos(e.func));
  });
  const walk = (n) => {
    if (Array.isArray(n)) n.forEach(walk);
    else if (n && typeof n === "object") {
      if (n.events) Object.keys(n.events).forEach((k) => keys.indexOf(n.events[k]) >= 0 && (n.events[k] = ""));
      Object.values(n).forEach(walk);
    }
  };
  walk(d.list);
  // No. of Split + Split (10-28): not in v59; the total was above the rows there
  remove(d, "output_split_pick");
  const holder = (function find(n) {
    if (Array.isArray(n)) {
      if (n.some((x) => x && x.model === "output_split_sum") && n.some((x) => x && x.model === "output_split")) return n;
      for (const x of n) {
        const r = find(x);
        if (r) return r;
      }
    } else if (n && typeof n === "object") {
      for (const v of Object.values(n)) {
        const r = find(v);
        if (r) return r;
      }
    }
    return null;
  })(d.list);
  if (holder) {
    const ti = holder.findIndex((x) => x && x.model === "output_split_sum");
    const gi = holder.findIndex((x) => x && x.model === "output_split");
    if (ti > gi) holder.splice(gi, 0, holder.splice(ti, 1)[0]);
  }
  // the grid's Add Row / Delete buttons (10-27, the browser pass) and its normal table (10-28): not in v59
  const g = H.findModel(d.list, "output_split");
  if (g && g.options) {
    g.options.virtualTable = true;
    g.options.tableHeightMode = "fixed";
    if (g.options.customProps && Array.isArray(g.options.customProps.toolbar)) g.options.customProps.toolbar = g.options.customProps.toolbar.filter((x) => x.type !== "addBtn");
    if (Array.isArray(g.options.rowActions)) g.options.rowActions = g.options.rowActions.filter((x) => x.type !== "delBtn");
  }
  return d;
};
// + onFormChange (empty in the base): RES-01 MIN-06's unsaved-changes marker (BA 10-22)
const PATCHED = ["wv07g9xe", "iaqty01x", "fgivan7v", "mounted", "iasvcomp", "aymq6q8z", "uhn48srb", "wia8s2r9", "iasvdrft", "iacqty01", "evhzkk8e", "onFormChange"];
const VARIANCE = ["iasvcomp", "aymq6q8z", "uhn48srb", "wia8s2r9"];

// parent model of every widget
const parents = (doc) => {
  const out = {};
  const walk = (n, parent) => {
    if (Array.isArray(n)) return n.forEach((x) => walk(x, parent));
    if (!n || typeof n !== "object") return;
    const me = n.model && n.type ? n.model : parent;
    if (n.model && n.type && n.type !== "col") out[n.model + (parent === "stock_movement" ? "@sm" : "")] = parent;
    Object.keys(n).forEach((k) => {
      if (k !== "options" && k !== "events") walk(n[k], n.type === "col" ? parent : me);
    });
  };
  walk(doc.list, "");
  return out;
};
const allKeys = (doc) => {
  const keys = [];
  const walk = (n) => {
    if (Array.isArray(n)) n.forEach(walk);
    else if (n && typeof n === "object") {
      if (typeof n.key === "string" && (n.model || n.type)) keys.push(n.key);
      Object.values(n).forEach(walk);
    }
  };
  walk(doc.list);
  return keys.concat(doc.config.eventScript.map((e) => e.key));
};
const remove = (doc, model) => {
  const walk = (n) => {
    if (Array.isArray(n)) {
      const i = n.findIndex((x) => x && x.model === model);
      if (i >= 0) return (n.splice(i, 1), true);
      return n.some(walk);
    }
    return n && typeof n === "object" ? Object.values(n).some(walk) : false;
  };
  return walk(doc.list);
};
const table = (doc) => H.findModel(doc.list, "stock_movement", "tlm8ve69");
// the Flat dialog's "Stop at level" (the user, 10-27 evening): not in v47 / v59 - its radio and forwarder taken out
const OLD_NOTE = "Tick a sub-assembly to make it from its own components in this Item Assembly. A tick applies to every place the item is used (see Used).";
const NEW_NOTE = "Each row is one place a component is used. Tick a sub-assembly to make it there from its own components (expand: its components appear " +
  "under it); leave it unticked to take it from stock there (stop here: what is under it is hidden). Rows marked Included have no choice. Stop at level N expands every " +
  "sub-assembly above level N. Assembly components shows the result.";
// (and one choice per place, the BA 10-27: the Place column, Used hidden, the Expand column's forwarder)
const unlevel = (doc) => {
  const d = H.clone(doc);
  remove(d, "sc_expand_level");
  remove(d, "sc_expand_preview");
  // the IA transfer request (ENH-20261027-001): its link fields, section, button, events, mount call and IA_NOT_RECORD models - newer
  // than v47 / v59 too
  remove(d, "transfer_request_id");
  remove(d, "transfer_request_no");
  remove(d, "tr_section");
  remove(d, "tr_btn_new");
  remove(d, "tr_defect_dialog");
  d.config.eventScript = d.config.eventScript.filter((e) => e.name !== "sc_onChange_expandLevel" && e.name !== "sc_onChange_expandTick" && TR_EVENTS.indexOf(e.name) < 0);
  d.config.eventScript.forEach((e) => {
    if (e.func) e.func = untrText(e.func);
  });
  const note = H.findModel(d.list, "sc_expand_note");
  if (note && note.options.defaultValue === NEW_NOTE) note.options.defaultValue = OLD_NOTE;
  const et = H.findModel(d.list, "sc_expand_table");
  if (et) {
    et.tableColumns = et.tableColumns.filter((c) => c.model !== "path" && c.model !== "kind");
    const uses = et.tableColumns.find((c) => c.model === "uses");
    if (uses) uses.options.hidden = false;
    const tick = et.tableColumns.find((c) => c.model === "expand");
    if (tick) tick.events.onChange = "";
  }
  return d;
};
// RES-01 Created (BA, 10-22): src/created_patch.json (the handler, mounted, IA V2 and badge pairs, the status option's leaf id)
const CREATED = JSON.parse(fs.readFileSync(path.join(H.IASC, "client/src/created_patch.json"), "utf8"));
// (no Cancel button on the form: Cancel is the list's bulk action, user 10-22 evening)
const CREATED_WIDGETS = ["button_created", "created_status", "cancelled_status"];
const uncreateOption = (doc) => {
  const leaves = H.findModel(doc.list, "item_assembly_status").options.datasource.rules.list[0].children[1].children;
  const i = leaves.findIndex((x) => x.value === "Created" && x.id === CREATED.statusLeafId);
  if (i < 0) return false;
  leaves.splice(i, 1);
  // RES-01 Cancel (user 10-22): the Cancelled option too
  const j = leaves.findIndex((x) => x.value === "Cancelled" && x.id === CREATED.cancel.statusLeafId);
  if (j < 0) return false;
  leaves.splice(j, 1);
  return true;
};
// UI-01 (BA handoff) regroups the ON build only: stacked sections Production / Sales Order / Output Location / Additional Details,
// the BOM row and the Use Suggestion / Prepare BOM buttons in Production, Quantity relabelled. unregroup puts every widget back
// where the OFF build has it, so the checks below prove the regroup moved widgets and changed only that label
const UI01 = ["sc_sec_production", "sc_sec_output", "sc_sec_more"];
// FIX-05 (BA handoff): the ON build switches on the platform's per-field change history (who, when, the new value) for these
const SC_HISTORY = ["source_so_id", "source_so_line_id", "source_so_context_json", "planned_output_qty", "item_qty", "bom_consumption_mode", "source_bom_id",
  "bom_snapshot_json", "item_id", "item_assembly_status", "posted_status", "material_hold_status"];
const UI01_NEW = UI01.concat(["sc_prod_grid", "sc_output_grid", "sc_more_grid", "sc_actual", "sc_prod_actions"]);
const unregroup = (doc) => {
  const d = H.clone(doc);
  // the layout widgets by model (the first of each: a table column or a dialog's field can share a header field's model)
  const byModel = {};
  const collect = (n) => {
    if (Array.isArray(n)) return n.forEach(collect);
    if (!n || typeof n !== "object" || n.type === "table" || n.type === "dialog") return;
    if (n.model && n.type && !(n.model in byModel)) byModel[n.model] = n;
    Object.keys(n).forEach((k) => k !== "options" && k !== "events" && collect(n[k]));
  };
  collect(d.list);
  // the output split widgets: from the Output Location section's first column back to the top level after sc_section
  const os = OS.map((m) => H.findModel(d.list, m));
  const back = (model) => {
    const off = H.findModel(OFF.list, model);
    const mine = H.findModel(d.list, model);
    if (off.columns) mine.columns.forEach((c, i) => (c.list = off.columns[i].list.map((w) => byModel[w.model])));
    else mine.list = off.list.map((w) => byModel[w.model]);
  };
  d.list = d.list.filter((w) => UI01.indexOf(w.model) < 0);
  if (os.every(Boolean)) d.list.splice(d.list.findIndex((w) => w.model === "sc_section") + 1, 0, ...os);
  ["grid_x46134mc", "sc_info", "sc_actions"].forEach(back);
  byModel.item_qty.name = H.findModel(OFF.list, "item_qty").name;
  SC_HISTORY.forEach((m) => byModel[m] && delete byModel[m].options.history);
  return d;
};
const ONX = unregroup(ON);
// the user's designer edits of 22 October (dev v55): Created primary, the BOM mode defaulting to Standard, the designer's own option
// defaults on the title and the header grid. The hidden strip (v36's data fields and Small Cycle's) sits below the action bar: under the
// title it left a gap (v55)
const STRIP = ["organization_id", "sia_uuid", "item_assembly_status", "posted_status", "page_status", "ia_v2_job_id", "ia_idem_key", "source_so_id",
  "source_so_line_id", "source_so_context_json", "source_bom_id", "bom_snapshot_json", "material_hold_status", "material_hold_at", "transfer_request_id", "transfer_request_no"];
const TITLE_V55 = ["left", "right", "pad", "desensitization_pattern", "desensitization_replace", "select-card_n7ge7fmb"];
const unsink = (doc) => {
  const moved = STRIP.map((m) => doc.list.find((w) => w.model === m)).filter(Boolean);
  doc.list = doc.list.filter((w) => STRIP.indexOf(w.model) < 0);
  doc.list.splice(doc.list.findIndex((w) => w.model === "flex_2det1nd2") + 1, 0, ...moved);
  return doc;
};
const unedit = (doc) => {
  const t = H.findModel(doc.list, "item_assembly_tittle");
  TITLE_V55.forEach((k) => delete t.options[k]);
  delete H.findModel(doc.list, "grid_x46134mc").options.dataIdentifier;
  const m = H.findModel(doc.list, "bom_consumption_mode");
  if (m) m.options.defaultValue = "";
  return doc;
};

for (const [label, B] of [["OFF", OFF], ["ON", ONX]]) {
  const P = parents(B);
  const order = B.list.map((w) => w.model);
  check(label + ": the title row is followed by the header grid (no hidden field between them: the v55 gap)", order[0] === "flex_2det1nd2" && order[1] === "grid_x46134mc",
    order.slice(0, 3));
  const bar = order.indexOf("flex_t6y2yh5r");
  check(label + ": the hidden data fields right after the action bar, in their old order, only dialogs after them", bar > 0 &&
    same(order.slice(bar + 1, bar + 1 + STRIP.length), STRIP) && B.list.slice(bar + 1 + STRIP.length).every((w) => w.type === "dialog"), order.slice(bar));
  check(label + ": the user's v55 edits kept (Created primary, the title and grid designer defaults)", H.findModel(B.list, "button_created").options.buttonType === "primary" &&
    TITLE_V55.every((k) => k in H.findModel(B.list, "item_assembly_tittle").options) && H.findModel(B.list, "grid_x46134mc").options.dataIdentifier === false);
  for (const [m, [type, parent]] of Object.entries(DATA)) {
    const w = H.findModel(B.list, m);
    check(label + ": data widget " + m + " (" + type + ", under " + (parent || "top") + ", dataBind, hidden)", !!w && w.type === type && P[m] === parent && w.options.dataBind === true && w.options.hidden === true);
  }
  for (const [m, [type, parent]] of Object.entries(UI)) {
    const w = H.findModel(B.list, m);
    // dialogs and their tables bind (the Transfer Stock dialog's pattern); every other UI widget is display only (no dataBind, or false)
    check(label + ": UI widget " + m + " (" + type + ", under " + (parent || "top") + ")", !!w && w.type === type && P[m] === parent && (w.type === "dialog" || w.type === "table" || w.options.dataBind !== true) &&
      (parent !== "" && parent !== "grid_x46134mc" ? true : w.type === "dialog" || w.options.hidden === true));
  }
  const ref = (table(B).tableColumns || []).find((c) => c.model === "sc_ref_key");
  const req = (table(B).tableColumns || []).find((c) => c.model === "required_qty");
  const cols = table(B).tableColumns;
  const shownCols = cols.slice(-2);
  check(label + ": stock_movement gains sc_ref_key (hidden input, dataBind), required_qty, required_manual (RF-09), then RES-01's Reserved / Short, its last five columns",
    !!ref && ref.type === "input" && ref.options.hidden === true && ref.options.dataBind === true && cols[cols.length - 5] === ref && cols[cols.length - 4] === req &&
    cols[cols.length - 3].model === "required_manual" && same(shownCols.map((c) => c.model), ["res_reserved", "res_short"]));
  // RES-01: a line's requirement (decision A), "Required", editable (empty = the BOM reference, filled by the save): hidden until
  // sc_main shows it for an enrolled IA, 8 decimals, no default, nothing bound
  // RF-09 (BA 10-22): ON, its onChange flags a hand-typed value (onChange_requiredQty); OFF, no event
  const rqKey = label === "ON" ? (H.byName(B, "onChange_requiredQty") || {}).key : "";
  check(label + ": required_qty = a hidden editable number Required, dataBind, p8, no default, no rule; onChange " + (label === "ON" ? "= the RF-09 flag" : "none"),
    !!req && req.type === "number" && req.name === "Required" && req.options.hidden === true && req.options.disabled === false && req.options.dataBind === true &&
    req.options.precision === 8 && req.options.defaultValue === null && req.options.required === false && same(req.rules, []) &&
    req.events.onChange === (rqKey || "") && (label !== "ON" || !!rqKey) && Object.keys(req.events).filter((k) => k !== "onChange").every((k) => req.events[k] === ""), req && req.events);
  // RES-01: Reserved / Short = the screen's figures (text, read-only, hidden, empty; IA_SAVE drops them) and the Materials row before bom_tab
  check(label + ": res_reserved / res_short = hidden read-only text inputs, empty, nothing bound", shownCols.every((c) => c.type === "input" && c.options.hidden === true &&
    c.options.disabled === true && c.options.defaultValue === "" && Object.values(c.events || {}).every((v) => v === "")), shownCols.map((c) => c.options));
  // MIN-06 (BA 10-22): Required / Reserved for this IA / Unreserved (with its reason), not a "Short" that names a cause it does not know
  check(label + ": the two columns are named Reserved for this IA / Unreserved", same(shownCols.map((c) => c.name), ["Reserved for this IA", "Unreserved"]), shownCols.map((c) => c.name));
  const resRow = H.findModel(B.list, "res_summary");
  const resTop = B.list.map((w) => w.model);
  check(label + ": res_summary = a hidden display text, no label, right before bom_tab (the transfer request's section between)", !!resRow && resRow.type === "text" &&
    resRow.options.dataBind === false && resRow.options.hidden === true && resRow.options.hideLabel === true && resTop.indexOf("res_summary") === resTop.indexOf("bom_tab") - 2 &&
    resTop[resTop.indexOf("bom_tab") - 1] === "tr_section", resRow && resRow.options);
  // the IA transfer request: its section hidden, its pickers UI only (no column), its buttons hidden; Request Materials last in the action bar
  const trW = TR_UI.map((m) => H.findModel(B.list, m));
  check(label + ": the transfer request's widgets once each, the section / pickers / buttons hidden, nothing bound in OFF, no data column", trW.every(Boolean) &&
    ["tr_section", "tr_pick", "tr_btn_create", "tr_btn_view", "tr_btn_refresh", "tr_btn_cancel", "tr_btn_new"].every((m) => H.findModel(B.list, m).options.hidden === true) &&
    ["tr_storage_location_id", "tr_location_id", "tr_required_date"].every((m) => H.findModel(B.list, m).options.dataBind === false) &&
    (label !== "OFF" || trW.every((w) => Object.values(w.events || {}).every((v) => v === ""))), TR_UI.filter((m, i) => !trW[i]));
  check(label + ": Request Materials last in the action bar, ia_create_transfer_request", H.findModel(B.list, "flex_t6y2yh5r").list.slice(-1)[0].model === "tr_btn_new" &&
    H.findModel(B.list, "tr_btn_new").options.permission === "ia_create_transfer_request");
  check(label + ": the staging bin filtered by the staging storage location", JSON.stringify(H.findModel(B.list, "tr_location_id").options.datasource).indexOf("{{value:tr_storage_location_id}}") > 0 &&
    JSON.stringify(H.findModel(B.list, "tr_location_id").options.datasource).indexOf("{{value:storage_location_id}}") < 0);
  // a reserved IA's requests (Task 9): Request Replacement (ia_create_transfer_request) and Report Defect (lot_ia_receive) hidden after Cancel;
  // the defect dialog: its rows' item, batch and quantity at the staging bin read-only, the defective quantity and the reason the only inputs,
  // the reason one of the user's organisation's Category Transfer Reasons (as the Category Transfer form), no Add Row / Delete
  const trAct = H.findModel(B.list, "tr_actions").list.map((w) => [w.model, w.options.permission || "", w.options.hidden]);
  check(label + ": Request Replacement and Report Defect hidden after Cancel, with their permissions", same(trAct.slice(-3), [["tr_btn_cancel", "ia_create_transfer_request", true],
    ["tr_btn_replace", "ia_create_transfer_request", true], ["tr_btn_defect", "lot_ia_receive", true]]), trAct);
  const dd = H.findModel(B.list, "tr_defect_dialog");
  const dt = H.findModel(B.list, "tr_defect_table");
  const dcol = (dt.tableColumns || []).map((c) => [c.model, c.type, c.options.disabled === true, c.options.hidden === true]);
  check(label + ": the defect dialog: its note and its table, the table's columns (read-only but the defect and its reason)", dd.type === "dialog" && dd.options.title === "Report Defect" &&
    dd.options.showOk === true && same(dd.list.map((w) => w.model), ["tr_defect_note", "tr_defect_table"]) && same(dcol, [["item", "input", true, false], ["batch", "input", true, false],
      ["at_bin", "number", true, false], ["defect", "number", false, false], ["reason", "select", false, false], ["line_id", "input", true, true], ["batch_id", "input", true, true]]), dcol);
  const rsn = (dt.tableColumns || []).find((c) => c.model === "reason") || { options: {} };
  check(label + ": the defect's reason: Category Transfer Reason of the user's organisation, its text stored", rsn.options.remote === true && rsn.options.remoteType === "innerdatasource" &&
    rsn.options.datasource.source === "Category Transfer Reason:Table:2113116113794039809" && rsn.options.datasource.rules.collectionId === "2113116113794039809" &&
    same(rsn.options.datasource.rules.list.map((x) => [x.prop, x.operator, x.valueType, x.value]), [["organization_id", "equal", "field", "{{global:firstLvDeptId}}"]]) &&
    rsn.options.props.value === "reason" && rsn.options.props.label === "reason", rsn.options);
  check(label + ": the defect table: no Add Row or Delete, its own height, not virtual", dt.options.isAdd === false && dt.options.isDelete === false && same(dt.options.rowActions, []) &&
    !dt.options.customProps.toolbar.some((x) => x.type === "addBtn") && dt.options.tableHeightMode === "auto" && dt.options.virtualTable === false && dt.options.generateSubTable === false,
  dt.options);
  // BA rev 1.2 C2: how a completed IA's completion ended, a hidden warning text right before the reservation row
  const ccRow = H.findModel(B.list, "completion_check");
  check(label + ": completion_check = a hidden display text, no label, error-msg, empty, right before res_summary", !!ccRow && ccRow.type === "text" &&
    ccRow.options.dataBind === false && ccRow.options.hidden === true && ccRow.options.hideLabel === true && ccRow.options.customClass === "error-msg" &&
    ccRow.options.defaultValue === "" && resTop.indexOf("completion_check") === resTop.indexOf("res_summary") - 1, ccRow && ccRow.options);
  const lt = H.findModel(B.list, "sc_line_table");
  const et = H.findModel(B.list, "sc_expand_table");
  check(label + ": sc_line_table columns", !!lt && same((lt.tableColumns || []).map((c) => c.model), LINE_COLS) && lt.options.isAdd === false && lt.options.isDelete === false);
  const pickCol = ((lt && lt.tableColumns) || []).find((c) => c.model === "pick");
  check(label + ": the Select link column fixed to the right (the user's designer change, dev v42)", !!pickCol && pickCol.options.fixedColumn === true &&
    pickCol.options.fixedColumnPosition === "right");
  check(label + ": sc_expand_table columns", !!et && same((et.tableColumns || []).map((c) => c.model), EXPAND_COLS) && et.options.isAdd === false && et.options.isDelete === false);
  const mode = H.findModel(B.list, "bom_consumption_mode");
  check(label + ": bom_consumption_mode = STANDARD / FLAT, default Standard (the user's designer edit, dev v55)", !!mode &&
    same(mode.options.options.map((o) => [o.value, o.label]), [["STANDARD", "Standard"], ["FLAT", "Flat"]]) && mode.options.defaultValue === "STANDARD");
  const planned = H.findModel(B.list, "planned_output_qty");
  check(label + ": planned_output_qty = number p8, no default, not required", !!planned && planned.options.precision === 8 && planned.options.defaultValue === null && planned.options.required === false && same(planned.rules, []));
  const left = H.findModel(B.list, "grid_x46134mc").columns[0].list.map((w) => w.model);
  check(label + ": mode + planned right after item_uom", left.indexOf("bom_consumption_mode") === left.indexOf("item_uom") + 1 && left.indexOf("planned_output_qty") === left.indexOf("item_uom") + 2);
  const right = H.findModel(B.list, "grid_x46134mc").columns[1].list.map((w) => w.model);
  const v36right = H.findModel(F0.list, "grid_x46134mc").columns[1].list.map((w) => w.model);
  check(label + ": the right column as in v36 (the Sales Order Link has its own section)", same(right, v36right), right);
  // the section: a hidden full-width grid (hidden from code like Production Order's grids) holding one collapse panel
  // "Sales Order Link" (the SO form's Basic Info section look), the rows grid then the buttons
  const tops = B.list.map((w) => w.model);
  check(label + ": sc_section right after the header grid", tops.indexOf("sc_section") === tops.indexOf("grid_x46134mc") + 1);
  const sec = H.findModel(B.list, "sc_section");
  check(label + ": sc_section = a hidden one-column grid holding only the collapse", !!sec && sec.options.hidden === true && sec.columns.length === 1 && sec.columns[0].options.span === 24 &&
    same(sec.columns[0].list.map((x) => x.model), ["sc_collapse"]));
  const col = H.findModel(B.list, "sc_collapse");
  check(label + ": sc_collapse = one panel 'Sales Order Link', open, the SO form's section class, holding sc_info then sc_actions", !!col && col.tabs.length === 1 &&
    col.tabs[0].title === "Sales Order Link" && col.options.defaultCollapsed === false && col.options.hidden === false && col.options.customClass === "collapse-overflow el-collapse" &&
    same(col.tabs[0].list.map((x) => x.model), ["sc_info", "sc_actions"]) && /^[a-z][a-z0-9]{7}$/.test(col.tabs[0].key || ""));
  const box = H.findModel(B.list, "sc_info");
  const rowsOf = (g) => (g && g.columns ? g.columns.map((c) => (c.list || []).map((x) => [x.model, x.name])) : []);
  check(label + ": sc_info = a hidden grid: the line left, the production right (half width each), the BOM and messages full width", !!box && box.type === "grid" &&
    box.options.hidden === true && same(box.columns.map((c) => [c.options.span, c.options.xs]), [[12, 24], [12, 24], [24, 24]]) && same(rowsOf(box), PANEL), rowsOf(box));
  const rowWidgets = box && box.columns ? box.columns.flatMap((c) => c.list || []) : [];
  check(label + ": every row = a text, display only, hidden, empty; labelled except the two messages", rowWidgets.length === 11 && rowWidgets.every((x) => x.type === "text" &&
    x.options.hideLabel === (MESSAGE_ROWS.indexOf(x.model) >= 0) && x.options.dataBind === false && x.options.hidden === true && x.options.defaultValue === "" &&
    x.events && x.events.onChange === "" && x.options.color === ""));
  check(label + ": the row classes: the key rows bold, the messages in the error style, the rest plain", rowWidgets.every((x) => x.options.customClass === (ROW_CLASS[x.model] || "")),
    rowWidgets.map((x) => [x.model, x.options.customClass]));
  // IA output split: the switch, the total and the rows grid (hidden, nothing bound), right after sc_section
  const osTop = B.list.map((w) => w.model);
  check(label + ": output split: No. of Split + Split, switch, rows, total right after sc_section", same(osTop.slice(osTop.indexOf("sc_section") + 1,
    osTop.indexOf("sc_section") + 1 + OS.length), OS), osTop.slice(osTop.indexOf("sc_section"), osTop.indexOf("sc_section") + 1 + OS.length));
  // No. of Split + Split (the user, 10-28): a hidden two-column grid - GR's plain split field (no number rule: "2,000" in the browser) and a button
  const osPick = H.findModel(B.list, "output_split_pick");
  const osCount = H.findModel(B.list, "output_split_count");
  const osBtn = H.findModel(B.list, "output_split_btn");
  check(label + ": output split: No. of Split + Split = a hidden grid, two half columns, the field then the button", !!osPick && osPick.options.hidden === true &&
    same(osPick.columns.map((c) => [c.options.span, (c.list || []).map((x) => x.model)]), [[12, ["output_split_count"]], [12, ["output_split_btn"]]]), osPick && osPick.columns);
  check(label + ": output split: No. of Split = GR's plain input (no number rule), unbound, not required, no rules, empty, no placeholder", !!osCount &&
    osCount.type === "input" && osCount.name === "No. of Split" && same(osCount.options.customProps, {}) && osCount.options.dataBind === false &&
    osCount.options.required === false && same(osCount.rules, []) && osCount.options.defaultValue === "" && osCount.options.placeholder === "" &&
    osCount.options.hidden === false && Object.values(osCount.events || {}).every((v) => v === ""), osCount && osCount.options);
  check(label + ": output split: Split = the form's button (primary, plain, no label), for every user (no permission)", !!osBtn && osBtn.type === "button" &&
    osBtn.options.buttonName === "Split" && osBtn.options.buttonType === "primary" && osBtn.options.buttonPlain === true && osBtn.options.hideLabel === true &&
    !osBtn.options.permission && osBtn.options.hidden === false, osBtn && osBtn.options);
  const osSwitch = H.findModel(B.list, "output_split_on");
  check(label + ": output split: the switch is 'Split receipt', a plain switch (no checkbox), 0 by default, dataBind, hidden", !!osSwitch && osSwitch.name === "Split receipt" &&
    osSwitch.options.checkboxMode === false && osSwitch.options.tableColumn === false && osSwitch.options.defaultValue === 0 && osSwitch.options.dataBind === true &&
    osSwitch.options.hidden === true, osSwitch && osSwitch.options);
  const osTotal = H.findModel(B.list, "output_split_sum");
  check(label + ": output split: the total is a hidden display text, no label, empty", !!osTotal && osTotal.options.dataBind === false && osTotal.options.hideLabel === true &&
    osTotal.options.defaultValue === "" && osTotal.options.customClass === "");
  const osGrid = H.findModel(B.list, "output_split");
  const hu = H.findModel(B.list, "table_hu");
  check(label + ": output split: the rows grid = a hidden json grid (generateSubTable false, as table_hu), Add / Delete row, no paging, empty by default, " +
    "its own height (tableHeightMode auto, not virtual: 10-28)", !!osGrid && osGrid.options.virtualTable === false && osGrid.options.tableHeightMode === "auto" &&
    osGrid.options.generateSubTable === false && osGrid.options.dataBind === true && osGrid.options.hidden === true && osGrid.options.isAdd === true &&
    osGrid.options.isDelete === true && osGrid.options.paging === false && same(osGrid.options.defaultValue, []) && same(Object.keys(osGrid.events), Object.keys(hu.events)),
    osGrid && osGrid.options);
  const oc = (osGrid && osGrid.tableColumns) || [];
  check(label + ": output split: the columns, their types and labels", same(oc.map((c) => [c.model, c.type, c.name]), OS_COLS), oc.map((c) => [c.model, c.type, c.name]));
  check(label + ": output split: every column shown, editable, not required, a table column, its own remote ids", oc.every((c) => c.options.hidden === false &&
    c.options.disabled === false && c.options.required === false && c.options.tableColumn === true && c.options.remoteFunc === "func_" + c.key));
  const ocm = Object.fromEntries(oc.map((c) => [c.model, c]));
  const hdr = (m, k) => H.findModel(B.list, m, k).options;
  check(label + ": output split: Qty p8, Group p0, no default", !!ocm.os_qty && ocm.os_qty.options.precision === 8 && ocm.os_group.options.precision === 0 &&
    ocm.os_qty.options.defaultValue === null && ocm.os_group.options.defaultValue === null);
  check(label + ": output split: Storage Location = the header's list (the plant's active storage locations)", !!ocm.os_storage_location_id &&
    same(ocm.os_storage_location_id.options.datasource, hdr("storage_location_id", "37cazpwp").datasource) &&
    same(ocm.os_storage_location_id.options.props, hdr("storage_location_id", "37cazpwp").props));
  const binDs = H.clone(hdr("location_id", "06a87twh").datasource);
  binDs.rules.list[0].children.filter((x) => x.prop === "storage_location_id").forEach((x) => Object.assign(x, { valueType: "formula", value: OS_BIN_FORMULA }));
  check(label + ": output split: Bin = the header's list but the row's own storage location (Misc Receipt's table_split formula)", !!ocm.os_location_id &&
    same(ocm.os_location_id.options.datasource, binDs) && same(ocm.os_location_id.options.props, hdr("location_id", "06a87twh").props) &&
    JSON.stringify(ocm.os_location_id.options.datasource).indexOf(OS_BIN_FORMULA) > 0);
  check(label + ": output split: Category = Unrestricted / Blocked, static, no default (the row takes the header's)", !!ocm.os_category && ocm.os_category.options.remote === false &&
    same(ocm.os_category.options.options.map((o) => o.value), ["Unrestricted", "Blocked"]) && ocm.os_category.options.defaultValue === "" &&
    same(ocm.os_category.options.datasource, hdr("inventory_category", "iainvcat").datasource));
  const osName = (key) => (H.byKey(B, key) || {}).name || "";
  if (label === "OFF") {
    check(label + ": output split: no event bound on the grid, a column, the switch or Split", !!osGrid && !!osSwitch && Object.values(osGrid.events).every((v) => v === "") &&
      oc.every((c) => Object.values(c.events || {}).every((v) => v === "")) && Object.values(osSwitch.events).every((v) => v === "") &&
      Object.values(osBtn.events).every((v) => v === ""));
  } else {
    check(label + ": output split: the switch, the rows (added / removed) and every column bound to their forwarders", !!osGrid && osName(osSwitch.events.onChange) === "os_onChange_switch" &&
      osName(osGrid.events.onRowAdd) === "os_onRowAdd" && osName(osGrid.events.onRowRemove) === "os_onRowRemove" && oc.every((c) => osName(c.events.onChange) === "os_onChange_" + c.model.slice(3)) &&
      Object.keys(osGrid.events).filter((k) => k !== "onRowAdd" && k !== "onRowRemove").every((k) => osGrid.events[k] === ""), [osGrid && osGrid.events, oc.map((c) => c.events)]);
    check(label + ": output split: Split bound to os_onClick_split", osName(osBtn.events.onClick) === "os_onClick_split", osBtn.events);
  }
  const top = B.list.map((w) => w.model);
  check(label + ": the hidden data fields right after ia_idem_key", same(top.slice(top.indexOf("ia_idem_key") + 1, top.indexOf("ia_idem_key") + 8), ["source_so_id", "source_so_line_id",
    "source_so_context_json", "source_bom_id", "bom_snapshot_json", "material_hold_status", "material_hold_at"]));
  // (and the transfer request's defect dialog after them)
  check(label + ": the two dialogs at the end", same(top.slice(-3), ["sc_line_dialog", "sc_expand_dialog", "tr_defect_dialog"]));
  // every key unique, the new ones 8-char and not in v36
  const keys = allKeys(B);
  const base = new Set(allKeys(F0));
  const fresh = keys.filter((k) => !base.has(k));
  check(label + ": every key unique in the form", keys.length === new Set(keys).size);
  check(label + ": the new keys are 8-char", fresh.length > 0 && fresh.every((k) => /^[a-z][a-z0-9]{7}$/.test(k)), fresh.filter((k) => !/^[a-z][a-z0-9]{7}$/.test(k)));
  const W = [];
  const walk = (n) => {
    if (Array.isArray(n)) n.forEach(walk);
    else if (n && typeof n === "object") {
      if (n.model && n.options && n.options.remoteFunc && !base.has(n.key)) W.push(n);
      Object.values(n).forEach(walk);
    }
  };
  walk(B.list);
  check(label + ": every new widget has its own remote ids", W.length > 0 && W.every((w) => w.options.remoteFunc === "func_" + w.key && w.options.remoteOption === "option_" + w.key));
  // undo the widgets -> v36 list exactly
  const u = H.clone(B);
  const models = Object.keys(DATA).concat(Object.keys(UI).filter((m) => UI[m][1] === "" || UI[m][1] === "grid_x46134mc")).concat(["res_summary", "completion_check", "tr_section", "tr_btn_new", "tr_defect_dialog"]);
  check(label + ": every new widget exists once", models.every((m) => remove(u, m)) && models.every((m) => !H.findModel(u.list, m)));
  check(label + ": the Created button and badge once each, the Created status option once", CREATED_WIDGETS.every((m) => remove(u, m)) && CREATED_WIDGETS.every((m) => !H.findModel(u.list, m)) &&
    uncreateOption(u));
  unedit(unsink(u));
  const ut = table(u);
  ut.tableColumns = ut.tableColumns.filter((c) => ["sc_ref_key", "required_qty", "required_manual", "res_reserved", "res_short"].indexOf(c.model) < 0);
  check(label + ": every other widget byte-identical to v36", JSON.stringify(u.list) === JSON.stringify(F0.list) &&
    JSON.stringify(Object.assign({}, u.config, { eventScript: [] })) === JSON.stringify(Object.assign({}, F0.config, { eventScript: [] })));
}

// OFF: no event added or changed, no new widget has an event bound
check("OFF: eventScript byte-identical to v36", JSON.stringify(OFF.config.eventScript) === JSON.stringify(F0.config.eventScript));
const BASE_KEYS = new Set(allKeys(F0));
const unbound = (doc) => {
  const bad = [];
  const walk = (n) => {
    if (Array.isArray(n)) n.forEach(walk);
    else if (n && typeof n === "object") {
      if (n.model && n.events && !BASE_KEYS.has(n.key) && Object.values(n.events).some((v) => v)) bad.push(n.model);
      Object.values(n).forEach(walk);
    }
  };
  walk(doc.list);
  return bad;
};
check("OFF: no new widget has an event bound", unbound(OFF).length === 0, unbound(OFF));
check("OFF and ON have the same widgets apart from the new widgets' events", (() => {
  const strip = (doc) => {
    const d = H.clone(doc);
    const walk = (n) => {
      if (Array.isArray(n)) n.forEach(walk);
      else if (n && typeof n === "object") {
        if (n.model && n.events && !BASE_KEYS.has(n.key)) {
          Object.keys(n.events).forEach((k) => (n.events[k] = ""));
        }
        Object.values(n).forEach(walk);
      }
    };
    walk(d.list);
    return JSON.stringify(d.list);
  };
  return strip(OFF) === strip(ONX);
})());

// ON: the events
const evOn = ON.config.eventScript;
const added = evOn.filter((e) => !F0.config.eventScript.some((x) => x.key === e.key));
check("ON: the added events are sc_main and its forwarders (and the split's, the transfer request's), at the end, all js", same(added.map((e) => e.name).sort(),
  NEW_EVENTS.concat(OS_EVENTS, TR_EVENTS).sort()) && added.every((e) => e.type === "js") &&
  same(evOn.slice(0, F0.config.eventScript.length).map((e) => e.key), F0.config.eventScript.map((e) => e.key)));
for (const [m, [ev, name]] of Object.entries(BOUND)) {
  const w = H.findModel(ON.list, m);
  check("ON: " + m + "." + ev + " -> " + name, !!w && H.byKey(ON, w.events[ev]) && H.byKey(ON, w.events[ev]).name === name);
}
for (const [m, evs] of Object.entries(DIALOG_BOUND)) {
  const w = H.findModel(ON.list, m);
  for (const [ev, name] of Object.entries(evs)) check("ON: " + m + "." + ev + " -> " + name, !!w && H.byKey(ON, w.events[ev]) && H.byKey(ON, w.events[ev]).name === name);
}
const pick = (H.findModel(ON.list, ROW_LINK[0]).tableColumns || []).find((c) => c.model === ROW_LINK[1]);
check("ON: the line table's Select link -> sc_onClick_pickLine", !!pick && pick.type === "link" && H.byKey(ON, pick.events.onClick) && H.byKey(ON, pick.events.onClick).name === ROW_LINK[2]);
for (const e of F0.config.eventScript) {
  if (PATCHED.indexOf(e.key) >= 0) continue;
  check("ON: v36 event " + e.name + " byte-identical", JSON.stringify(H.byKey(ON, e.key)) === JSON.stringify(e));
}
// each forwarder only hands its op to sc_main
// the transfer request's forwarders only hand their op to tr_main; its buttons and the staging storage location bound to them
for (const e of added.filter((x) => TR_EVENTS.indexOf(x.name) > 0)) {
  check("ON: forwarder " + e.name + " is one triggerEvent of tr_main", /^\/\/ [^\n]+\nthis\.triggerEvent\("tr_main", \{ trOp: "[A-Z_]+" \}\);\n?$/.test(e.func), e.func);
}
for (const [m, ev, name] of [["tr_btn_new", "onClick", "tr_onClick_new"], ["tr_btn_create", "onClick", "tr_onClick_create"], ["tr_btn_view", "onClick", "tr_onClick_view"],
  ["tr_btn_refresh", "onClick", "tr_onClick_refresh"], ["tr_btn_cancel", "onClick", "tr_onClick_cancel"], ["tr_storage_location_id", "onChange", "tr_onChange_storage"],
  ["tr_btn_replace", "onClick", "tr_onClick_replace"], ["tr_btn_defect", "onClick", "tr_onClick_defect"], ["tr_defect_dialog", "onConfirm", "tr_onConfirm_defect"],
  ["tr_defect_dialog", "onCancel", "tr_onCancel_defect"]]) {
  const w = H.findModel(ON.list, m);
  check("ON: " + m + "." + ev + " -> " + name, !!w && H.byKey(ON, w.events[ev]) && H.byKey(ON, w.events[ev]).name === name);
}
check("ON: the mount tells tr_main once, right after Small Cycle's call", H.byKey(ON, "mounted").func.split("    scMount(pageStatus, status);\n" + TR_MOUNT_CALL).length === 2);
for (const k of ["uhn48srb", "wia8s2r9"]) check("ON: " + k + " IA_NOT_RECORD strips the transfer request's UI models (at the end)", H.byKey(ON, k).func.split(TR_NOT_RECORD).length === 2);
for (const e of added.filter((x) => x.name !== "sc_main" && x.name !== "onClick_saveAsCreated" && x.name !== "onClick_cancelIA" && x.name !== "onChange_requiredQty" &&
  OS_EVENTS.indexOf(x.name) < 0 && TR_EVENTS.indexOf(x.name) < 0)) {
  check("ON: forwarder " + e.name + " is one triggerEvent of sc_main", /^\/\/ [^\n]+\nthis\.triggerEvent\("sc_main", \{ scOp: "[A-Z_]+"[^\n]*\}\);\n?$/.test(e.func), e.func);
}
// the split's forwarders only hand their op to os_main (a removed row a moment later, once it is gone)
for (const e of added.filter((x) => OS_EVENTS.indexOf(x.name) > 0)) {
  check("ON: forwarder " + e.name + " is one triggerEvent of os_main", /^\/\/ [^\n]+\n(this\.triggerEvent\("os_main", \{ osOp: "[A-Z]+"[^\n]*\}\);|setTimeout\(\(\) => this\.triggerEvent\("os_main", \{ osOp: "REMOVE" \}\), 50\);)\n$/.test(e.func), e.func);
}

// the patched handlers: undo the insertions -> v36 exactly
const base = (key) => H.byKey(F0, key).func;
// the classic save handlers' double-click guard (src/classic_double_patch.json, 10-22): undone here, checked on its own below
const CLASSIC_DOUBLE = JSON.parse(fs.readFileSync(path.join(H.IASC, "client/src/classic_double_patch.json"), "utf8"));
const raw = (key) => unos(untrText(H.byKey(ON, key).func));
const built = (key) => {
  let t = CLASSIC_DOUBLE.handlers.indexOf(key) >= 0 ? CLASSIC_DOUBLE.patch.reduce((x, d) => x.replace(d.now, d.was), raw(key)) : raw(key);
  if (CREATED.v2Keys.indexOf(key) >= 0) t = CREATED.v2.reduce((x, d) => x.replace(d.now, d.was), t);
  if (key === "mounted") t = CREATED.mount.slice().reverse().reduce((x, d) => x.replace(d.now, d.was), CREATED.cancel.mount.slice().reverse().reduce((x, d) => x.replace(d.now, d.was), t));
  return t;
};
// the IA V2 click handlers' double-click patch (src/v2_double_patch.json, bladexfunctions-8c 10-21): each pair applied once
const DOUBLE = JSON.parse(fs.readFileSync(path.join(H.IASC, "client/src/v2_double_patch.json"), "utf8"));
const undouble = (key, t) => (DOUBLE.handlers.indexOf(key) >= 0 ? DOUBLE.patch.reduce((x, d) => x.replace(d.now, d.was), t) : t);
// IA V2 one stock call per run (src/v2_park_patch.json, 10-27): the wait kicks a parked job at once; the build applies it after the
// double-click patch, so it is undone first
const PARK = JSON.parse(fs.readFileSync(path.join(H.IASC, "client/src/v2_park_patch.json"), "utf8"));
const unpark = (key, t) => (PARK.handlers.indexOf(key) >= 0 ? PARK.patch.reduce((x, d) => x.replace(d.now, d.was), t) : t);
// RES-01 R4: the four completion handlers close the holds once the completion answered (src/res_close_patch.json): undo = drop the block
// at the top, revert the call
const CLOSE = JSON.parse(fs.readFileSync(path.join(H.IASC, "client/src/res_close_patch.json"), "utf8"));
const CLOSE_MARK = "// Small Cycle (scratchpad/iasc): RES-01 - after a completion the form closes the IA's holds";
const closePairs = (key) => (typeof CLOSE[key] === "string" ? CLOSE[CLOSE[key]] : CLOSE[key]);
const unclose = (key, t) => {
  if (!CLOSE[key]) return t;
  const end = "// -- end Small Cycle --\n";
  const body = t.indexOf(CLOSE_MARK) === 0 ? t.slice(t.indexOf(end) + end.length) : t;
  return closePairs(key).reduce((x, d) => x.replace(d.now, d.was), body);
};
const between = (text, a, b) => {
  const i = text.indexOf(a);
  const j = text.indexOf(b, i + a.length);
  return i >= 0 && j > i ? text.slice(i, j + b.length) : null;
};
const PRO_START = "// Small Cycle (scratchpad/iasc):";
const PRO_END = "// -- end Small Cycle --\n";
// RES-01: the IA's own holds added back where it reads free stock (src/res_own_patch.json): undo = drop its block, revert its pairs
const OWN = JSON.parse(fs.readFileSync(path.join(H.IASC, "client/src/res_own_patch.json"), "utf8"));
const OWN_MARK = PRO_START + " RES-01 - this IA's own holds";
const unown = (key, t) => {
  if (!OWN[key]) return t;
  const block = between(t, OWN_MARK, PRO_END);
  return OWN[key].pairs.reduce((x, d) => x.replace(d.now, d.was), block ? t.replace(block, "") : t);
};
const ruleJs = (doc, key) => H.byKey(doc, key).rules.filter((r) => r.action === "js")[0].options.func;
for (const key of ["wv07g9xe", "iaqty01x"]) {
  const t = built(key);
  check("ON: " + key + " = the Small Cycle prologue + v36 verbatim (RES-01's add-back undone)", t.indexOf(PRO_START) === 0 && t.indexOf(PRO_END) > 0 &&
    unown(key, t.slice(t.indexOf(PRO_END) + PRO_END.length)) === base(key));
}
check("ON: iacqty01 = the RES-01 block + v36 with one add-back", built("iacqty01").indexOf(OWN_MARK) === 0 && unown("iacqty01", built("iacqty01")) === base("iacqty01"));
check("ON: evhzkk8e = the RES-01 block + v36's js rule with one add-back, its other rules unchanged", ruleJs(ON, "evhzkk8e").indexOf(OWN_MARK) === 0 &&
  unown("evhzkk8e", ruleJs(ON, "evhzkk8e")) === ruleJs(F0, "evhzkk8e") && same(H.byKey(ON, "evhzkk8e").rules.filter((r) => r.action !== "js"), H.byKey(F0, "evhzkk8e").rules.filter((r) => r.action !== "js")));
{
  // RES-01: the Draft handler = the reservation block at the top + v36 with one awaited call after the save message
  const t = built("iasvdrft");
  const block = between(t, PRO_START, PRO_END);
  const call = "    await resHoldAfterSave(workflowResult.data, data);\n";
  check("ON: iasvdrft = the RES-01 block + v36 verbatim with one awaited call after the save message", !!block && t.indexOf(block) === 0 && t.split(call).length === 2 &&
    t.slice(block.length).replace(call, "") === base("iasvdrft") && t.indexOf('this.$message.success("Item Assembly saved as draft");\n' + call) > 0);
}
{
  const t = built("fgivan7v");
  check("ON: fgivan7v = v36 verbatim + the Small Cycle epilogue", t.indexOf(base("fgivan7v")) === 0 && t.slice(base("fgivan7v").length).indexOf("\n" + PRO_START) === 0 && t.endsWith(PRO_END));
}
{
  const t = built("mounted");
  const block = between(t, PRO_START, PRO_END);
  const call = "\n    scMount(pageStatus, status);\n";
  check("ON: mounted = v36 + the Small Cycle block before the main IIFE + one call after iaBackgroundView",
    !!block && t.split(PRO_START).length === 2 && t.replace(block, "").replace("    iaBackgroundView(pageStatus, status);" + call, "    iaBackgroundView(pageStatus, status);\n") === base("mounted"));
}
const V36_VARIANCE = (() => {
  const t = base("iasvcomp");
  const a = t.indexOf("// The BOM seeds the component table");
  return t.slice(a, t.indexOf("\n};\n", t.indexOf("const confirmBomVariance = async (data) => {")) + 3);
})();
for (const key of VARIANCE) {
  check("v36: " + key + " holds the same confirmBomVariance", base(key).indexOf(V36_VARIANCE) >= 0);
  check("ON: " + key + ": RES-01's close block first, its call once", built(key).indexOf(CLOSE_MARK) === 0 && closePairs(key).every((d) => built(key).split(d.now).length === 2));
  const t = unclose(key, undouble(key, unpark(key, built(key))));
  const block = between(t, PRO_START, PRO_END);
  const renamed = V36_VARIANCE.replace("const confirmBomVariance = async (data) => {", "const scBaseConfirmBomVariance = async (data) => {");
  check("ON: " + key + ": the v36 confirmBomVariance renamed, verbatim, followed by the Small Cycle wrapper", !!block && t.indexOf(renamed + "\n\n" + block) >= 0 &&
    t.replace(renamed + "\n\n" + block, V36_VARIANCE).replace(/\nconst IA_NOT_RECORD = [\s\S]*?\];\n/, "\n@@\n") === base(key).replace(/\nconst IA_NOT_RECORD = [\s\S]*?\];\n/, "\n@@\n"));
}
// RES-01 Created (BA, 10-22): each pair applied once; the Created handler = the built Draft handler with the handler pairs, bound to its button
check("ON: mounted: every Cancel pair applied once", CREATED.cancel.mount.every((d) => raw("mounted").split(d.now).length === 2));
{
  const uncancelled = CREATED.cancel.mount.slice().reverse().reduce((x, d) => x.replace(d.now, d.was), raw("mounted"));
  check("ON: mounted: every Created pair applied once", CREATED.mount.every((d) => uncancelled.split(d.now).length === 2));
}
{
  check("ON: no Cancel button and no Cancel handler on the form (Cancel is the list's bulk action, user 10-22)", !H.byName(ON, "onClick_cancelIA") &&
    !H.findModel(ON.list, "button_cancel") && JSON.stringify(ON).indexOf("button_cancel") < 0);
}
for (const key of CREATED.v2Keys) check("ON: " + key + ": each Created pair applied once", CREATED.v2.every((d) => raw(key).split(d.now).length === 2 && raw(key).indexOf(d.was) < 0));
{
  const e = H.byName(ON, "onClick_saveAsCreated");
  const want = CREATED.handler.reduce((x, d) => x.replace(d.was, d.now), raw("iasvdrft"));
  const bt = H.findModel(ON.list, "button_created");
  check("ON: onClick_saveAsCreated = the Draft handler with the Created pairs (saveAs Draft, ia_target_status Created), bound to button_created", !!e && e.type === "js" &&
    e.func === want && CREATED.handler.every((d) => e.func.split(d.now).length === 2) && !!bt && bt.events.onClick === e.key);
}
for (const key of CLASSIC_DOUBLE.handlers) {
  check("ON: " + key + ": the classic double-click guard applied once per pair", CLASSIC_DOUBLE.patch.every((d) => raw(key).split(d.now).length === 2 && raw(key).indexOf(d.was) < 0));
}
for (const key of DOUBLE.handlers) {
  check("ON: " + key + ": the double-click patch applied once per pair", DOUBLE.patch.every((d) => built(key).split(d.now).length === 2 && base(key).split(d.was).length === 2 &&
    (d.now.indexOf(d.was) >= 0 || built(key).indexOf(d.was) < 0)));
}
for (const key of PARK.handlers) {
  check("ON: " + key + ": the park-kick patch applied once per pair", PARK.patch.every((d) => built(key).split(d.now).length === 2 && base(key).split(d.was).length === 2));
}
for (const key of ["uhn48srb", "wia8s2r9"]) {
  const grab = (t) => JSON.parse(/const IA_NOT_RECORD = (\[[\s\S]*?\]);/.exec(t)[1].replace(/\n/g, " "));
  const was = grab(base(key));
  const now = grab(built(key));
  // getValues keys: widgets in a layout container (grid, flex) are top-level keys, a dialog's children are under the dialog
  // (built() undoes the split: its total in IA_NOT_RECORD is checked with the v59 comparison)
  const ui = Object.keys(UI).filter((m) => ["", "grid_x46134mc", "sc_actions", "sc_info", "sc_section", "sc_collapse"].indexOf(UI[m][1]) >= 0 && OS.indexOf(m) < 0).concat(UI01_NEW);
  check("ON: " + key + " IA_NOT_RECORD = v36 + the top-level UI models, never a data key", same(now.slice(0, was.length), was) && same(now.slice(was.length).sort(), ui.slice().sort()) &&
    Object.keys(DATA).every((m) => now.indexOf(m) < 0));
}

// ON vs the live dev v47 (base/ia_form_v47.json, the IA V2 double-click fix published 2026-10-21 14:00): the same form
{
  const LIVE = H.readJSON(path.join(H.IASC, "base/ia_form_v47.json"));
  // the designer stores keys in its own order: compare with sorted keys
  const canon = (x) => (Array.isArray(x) ? x.map(canon) : x && typeof x === "object" ? Object.keys(x).sort().reduce((o, k) => Object.assign(o, { [k]: canon(x[k]) }), {}) : x);
  // not published yet: RES-01 R3's widgets (Reserved / Short, the Materials row) and Required named and editable
  const r3 = unedit(unsink(unlevel(ON)));
  // nor the output split (plan 10-27): the Output Location section's first column
  H.findModel(r3.list, "sc_output_grid").columns.shift();
  remove(r3, "res_summary");
  remove(r3, "completion_check");
  CREATED_WIDGETS.forEach((m) => remove(r3, m));
  uncreateOption(r3);
  const r3t = table(r3);
  r3t.tableColumns = r3t.tableColumns.filter((c) => c.model !== "res_reserved" && c.model !== "res_short" && c.model !== "required_manual");
  const r3req = r3t.tableColumns.find((c) => c.model === "required_qty");
  Object.assign(r3req, { name: "Required Qty" });
  r3req.options.disabled = true;
  r3req.events.onChange = "";
  check("ON vs v47: the widgets identical but RES-01 R3's (Reserved / Short, the Materials row, Required)", JSON.stringify(canon(r3.list)) === JSON.stringify(canon(LIVE.list)));
  // (the output split, plan 10-27, undone: its events and the blocks that tell os_main)
  const ONV = unosDoc(unlevel(ON));
  const changed = ONV.config.eventScript.filter((e) => JSON.stringify(H.byKey(LIVE, e.key)) !== JSON.stringify(e)).map((e) => e.name).sort();
  // not published yet: RES-01 R3 (switched off): the Draft handler, the add-back in the explode / component quantity / picker, and
  // sc_main (it carries the explode helpers)
  const createdKey = (H.byName(ON, "onClick_saveAsCreated") || {}).key;
  const reqQtyKey = (H.byName(ON, "onChange_requiredQty") || {}).key;
  check("ON vs v47: the same events but the Created handler (added at the end), only the RES-01 R3 / R4 and Created handlers changed",
    same(ONV.config.eventScript.map((e) => e.key).filter((k) => k !== createdKey && k !== reqQtyKey), LIVE.config.eventScript.map((e) => e.key)) &&
    same(ONV.config.eventScript.slice(-2).map((e) => e.key), [createdKey, reqQtyKey]) &&
    same(changed, ["iaV2_onClick_completed", "iaV2_onClick_completed_post", "mounted", "onChange_assembledItem", "onChange_componentQty", "onChange_requiredQty",
      "onClick_saveAsCompleted", "onClick_saveAsCompletedPost", "onClick_saveAsCreated", "onClick_saveAsDraft", "onClick_select_stock", "onFormChange",
      "sc_main"]), changed);
  check("ON vs v47: the form config identical apart from the events", JSON.stringify(canon(Object.assign({}, ON.config, { eventScript: [] }))) ===
    JSON.stringify(canon(Object.assign({}, LIVE.config, { eventScript: [] }))));
  const expandTable = H.findModel(ON.list, "sc_expand_table");
  const dlg = H.findModel(ON.list, "sc_expand_dialog").list.map((w) => w.model);
  const lv = H.findModel(ON.list, "sc_expand_level");
  check("ON: Stop at level: a radio 1-6 in the Flat dialog before Expand All, empty, editable, bound to its forwarder", !!lv && lv.type === "radio" &&
    same(lv.options.options.map((o) => o.value), [1, 2, 3, 4, 5, 6]) && lv.options.defaultValue === null && lv.options.disabled === false && lv.options.hidden === false &&
    dlg.indexOf("sc_expand_level") === dlg.indexOf("sc_expand_all") - 1 && (H.byKey(ON, lv.events.onChange) || {}).name === "sc_onChange_expandLevel", [dlg, lv && lv.options]);
  check("ON: Stop at level's forwarder sends EXPAND_LEVEL with the chosen value", /this\.triggerEvent\("sc_main", \{ scOp: "EXPAND_LEVEL", value: arguments\[0\] && arguments\[0\]\.value \}\);/.test(
    (H.byName(ON, "sc_onChange_expandLevel") || {}).func || ""));
  const etb = H.findModel(ON.list, "sc_expand_table");
  const col = (m) => etb.tableColumns.find((c) => c.model === m) || { options: {}, events: {} };
  check("ON: one row per place: the Place column hidden after Item ID, Used hidden, the Expand column bound to its forwarder", col("path").options.hidden === true &&
    col("uses").options.hidden === true && (H.byKey(ON, col("expand").events.onChange) || {}).name === "sc_onChange_expandTick", etb.tableColumns.map((c) => c.model));
  check("ON: the Expand column's forwarder sends EXPAND_TICK with the row and its value", /this\.triggerEvent\("sc_main", \{ scOp: "EXPAND_TICK", rowIndex: arguments\[0\] && arguments\[0\]\.rowIndex, value: arguments\[0\] && arguments\[0\]\.value \}\);/.test(
    (H.byName(ON, "sc_onChange_expandTick") || {}).func || ""));
  check("ON: sc_main wires Stop at level and the place ticks", /EXPAND_LEVEL: scOpExpandLevel, EXPAND_TICK: scOpExpandTick, /.test(H.byName(ON, "sc_main").func));
  const pv = H.findModel(ON.list, "sc_expand_preview");
  const dmodels = H.findModel(ON.list, "sc_expand_dialog").list.map((w) => w.model);
  check("ON: the Assembly components preview: a read-only table (Component, Required Qty, UOM) right after the places", !!pv && pv.type === "table" &&
    same(pv.tableColumns.map((c) => [c.model, c.options.disabled]), [["component", true], ["qty", true], ["uom", true]]) && pv.options.isAdd === false && pv.options.isDelete === false &&
    dmodels.indexOf("sc_expand_preview") === dmodels.indexOf("sc_expand_table") + 1, [dmodels, pv && pv.tableColumns.map((c) => c.model)]);
  check("OFF: the preview there too", !!H.findModel(OFF.list, "sc_expand_preview"));
  check("OFF: Stop at level's radio there too (unbound)", !!H.findModel(OFF.list, "sc_expand_level") && H.findModel(OFF.list, "sc_expand_level").events.onChange === "");
  check("ON: the Flat dialog's note first (one row per place), its Used column a whole number (hidden)", H.findModel(ON.list, "sc_expand_dialog").list[0].model === "sc_expand_note" &&
    /Each row is one place/.test(H.findModel(ON.list, "sc_expand_note").options.defaultValue) && expandTable.tableColumns.find((c) => c.model === "uses").options.precision === 0);
}

// FIX-05 (BA handoff): ON switches on the platform's field history for the IA's link, plan, output, mode, BOM, snapshot, item and status
{
  const flags = (doc) => {
    const out = [];
    const walk = (n) => {
      if (Array.isArray(n)) n.forEach(walk);
      else if (n && typeof n === "object") {
        if (n.model && n.options && n.options.history === true) out.push(n.model);
        Object.values(n).forEach(walk);
      }
    };
    walk(doc.list);
    return out;
  };
  check("FIX-05: ON tracks exactly these fields (and no other widget)", same(flags(ON).sort(), SC_HISTORY.slice().sort()), flags(ON));
  check("FIX-05: OFF tracks nothing (the rollback build)", flags(OFF).length === 0, flags(OFF));
  check("FIX-05: the material lines are not tracked one by one (big saves stay fast)", (table(ON).tableColumns || []).every((c) => !c.options.history));
  check("FIX-01: the Select SO Line list names its figure Remaining to Plan", H.findModel(ON.list, "sc_line_table").tableColumns.find((c) => c.model === "suggestion").name ===
    "Remaining to Plan" && H.findModel(OFF.list, "sc_line_table").tableColumns.find((c) => c.model === "suggestion").name === "Remaining to Plan");
}

// UI-01 (BA handoff): the ON build's stacked sections; OFF keeps v36's layout
{
  const tops = ON.list.map((w) => w.model);
  const order = ["grid_x46134mc", "sc_sec_production", "sc_section", "sc_sec_output", "bom_tab", "sc_sec_more", "flex_t6y2yh5r"];
  check("UI-01: header, Production, Sales Order, Output Location, Materials, Additional Details, the action bar, in that order",
    order.every((m) => tops.indexOf(m) >= 0) && order.every((m, i) => i === 0 || tops.indexOf(m) > tops.indexOf(order[i - 1])), tops);
  // each section = one collapse panel holding one grid (model sc_*_grid) with these columns: [span, models]
  const colsOf = (m) => {
    const sec = H.findModel(ON.list, m);
    const g = sec && sec.tabs && sec.tabs[0].list[0];
    return g && g.columns ? g.columns.map((c) => [c.options.span, c.list.map((x) => x.model)]) : null;
  };
  const sectionOk = (m, title, collapsed, grid) => {
    const sec = H.findModel(ON.list, m);
    return !!sec && sec.type === "collapse" && sec.tabs.length === 1 && sec.tabs[0].title === title && sec.options.defaultCollapsed === collapsed && sec.options.hidden === false &&
      sec.options.customClass === "collapse-overflow el-collapse" && sec.tabs[0].list.length === 1 && sec.tabs[0].list[0].type === "grid" && sec.tabs[0].list[0].model === grid &&
      sec.tabs[0].list[0].options.hidden === false;
  };
  check("UI-01: the sections are collapse panels (the SO form's look): Production and Output Location open, Additional Details collapsed",
    sectionOk("sc_sec_production", "Production", false, "sc_prod_grid") && sectionOk("sc_sec_output", "Output Location", false, "sc_output_grid") &&
    sectionOk("sc_sec_more", "Additional Details", true, "sc_more_grid"));
  check("UI-01: Production = FG, name, description, mode | planned output, output to receive, actual received, UOM | the BOM and its buttons full width",
    same(colsOf("sc_sec_production"), [[12, ["item_id", "item_name", "item_desc", "bom_consumption_mode"]], [12, ["planned_output_qty", "item_qty", "sc_actual", "item_uom"]],
      [24, ["sc_info_bom", "sc_prod_actions"]]]), colsOf("sc_sec_production"));
  check("UI-01: Output Location = the output split full width (plan 10-27) | storage location, category, manufacturing date | bin, batch, expiry",
    same(colsOf("sc_sec_output"), [[24, OS], [12, ["storage_location_id", "inventory_category", "manufacturing_date"]], [12, ["location_id", "batch_no", "expired_date"]]]),
    colsOf("sc_sec_output"));
  check("UI-01: Additional Details = project, documents | remarks 1-3", same(colsOf("sc_sec_more"), [[12, ["project_id", "reference_documents"]], [12, ["remarks", "remarks_2", "remarks_3"]]]),
    colsOf("sc_sec_more"));
  // the plant stays first, at the top: changing it clears the materials (v36 onChange_Plant), so it is chosen before the item
  check("UI-01: the header = the plant and the number | the date and Issued By", same(H.findModel(ON.list, "grid_x46134mc").columns.map((c) => c.list.map((x) => x.model)),
    [["issuing_operation_faci", "serial_flex_wrapper_6b2xyt4c"], ["item_assembly_date", "issued_by"]]));
  // the regroup kept every key of v43 (before UI-01): columns and fields pair by key
  const v43Keys = allKeys(H.readJSON(path.join(H.IASC, "base/ia_form_v43.json")));
  const onKeys = allKeys(ON);
  const newKeys = onKeys.filter((k) => v43Keys.indexOf(k) < 0);
  check("UI-01: every v43 key kept; the keys unique; the new ones 8-char (one per new widget, column and panel)", v43Keys.every((k) => onKeys.indexOf(k) >= 0) &&
    onKeys.length === new Set(onKeys).size && newKeys.length > 0 && newKeys.every((k) => /^[a-z][a-z0-9]{7}$/.test(k)), newKeys);
  check("UI-01: the SO card keeps its link buttons; Use Suggestion and Prepare BOM sit in Production", same(H.findModel(ON.list, "sc_actions").list.map((b) => b.model),
    ["sc_btn_line", "sc_btn_unlink", "sc_btn_relink", "sc_btn_refresh"]) && same(H.findModel(ON.list, "sc_prod_actions").list.map((b) => b.model), ["sc_btn_suggest", "sc_btn_bom"]) &&
    H.findModel(ON.list, "sc_prod_actions").options.hidden === true);
  check("UI-01: the SO card's full-width column keeps the messages only", same(H.findModel(ON.list, "sc_info").columns[2].list.map((x) => x.model), ["sc_info_over", "sc_info_warn"]));
  const actual = H.findModel(ON.list, "sc_actual");
  check("UI-01: labels: Output to Receive, Planned Output, Actual Received (a hidden labelled text), Use Suggestion", H.findModel(ON.list, "item_qty").name === "Output to Receive" &&
    H.findModel(ON.list, "planned_output_qty").name === "Planned Output" && !!actual && actual.type === "text" && actual.name === "Actual Received" && actual.options.hidden === true &&
    actual.options.hideLabel === false && actual.options.dataBind === false && actual.options.defaultValue === "" && H.findModel(ON.list, "sc_btn_suggest").options.buttonName === "Use Suggestion");
  check("UI-01: OFF keeps v36's layout (Plant first in the header, no sections)", H.findModel(OFF.list, "grid_x46134mc").columns[0].list[0].model === "issuing_operation_faci" &&
    UI01_NEW.every((m) => !H.findModel(OFF.list, m)));
}

// shipped state, platform tokens, syntax, mirrors
const shippedOn = /const SC_ENABLED = (true|false);/.exec(H.byName(ON, "sc_main").func);
check("ON: sc_main ships SC_ENABLED = true", !!shippedOn && shippedOn[1] === "true");
const ids = H.IDS;
for (const e of evOn) {
  if (PATCHED.indexOf(e.key) < 0 && !added.some((x) => x.key === e.key)) continue;
  const t = e.func;
  check("ON: " + e.name + " has no platform {{ token in new code", (() => {
    const old = (H.byKey(F0, e.key) || {}).func || "";
    return (t.match(/\{\{/g) || []).length === (old.match(/\{\{/g) || []).length;
  })());
  let ok = true;
  try {
    new Function("db", "return function () {\n" + t + "\n};");
  } catch (err) {
    ok = String(err.message);
  }
  check("ON: " + e.name + " compiles", ok === true, ok);
  const ids_ = [...t.matchAll(/"([0-9]+)"[^"\n]*\/\/ (SO_IA_PROJECTION|IA_SC_RELINK)$/gm)];
  check("ON: " + e.name + " carries the ids.json workflow ids", ids_.every((m) => m[1] === String(ids[m[2]])));
}
const mirrorDir = path.join(H.IASC, "client/out/on");
for (const e of added.concat(PATCHED.map((k) => H.byKey(ON, k)))) {
  const f = path.join(mirrorDir, (e.name.indexOf("sc_") === 0 || e.name.indexOf("os_") === 0 || e.name.indexOf("tr_") === 0 ? "" : "iaForm_") + e.name + ".js");
  // a rule event's mirror is its js action
  check("ON: mirror " + path.basename(f) + " = the embedded script", fs.existsSync(f) && read(f) === (e.type === "rule" ? ruleJs(ON, e.key) : e.func));
}
// ON vs the live dev v59 (base/ia_form_v59.json, published 2026-10-27 12:09: the split's widgets, hidden and unbound): the same form once the
// split's handlers are undone (its 12 events, the blocks that tell os_main, the mount's two extra flags, the total in IA_NOT_RECORD, its bindings)
{
  const LIVE = H.readJSON(path.join(H.IASC, "base/ia_form_v59.json"));
  const canon = (x) => (Array.isArray(x) ? x.map(canon) : x && typeof x === "object" ? Object.keys(x).sort().reduce((o, k) => Object.assign(o, { [k]: canon(x[k]) }), {}) : x);
  // sc_main's own Flat changes (Stop at level, one choice per place) are the behaviour tests' (test_sc_prepare); here it is v59's
  const V = unosDoc(unlevel(ON));
  V.config.eventScript.forEach((e) => {
    if (e.name === "sc_main") e.func = (H.byName(LIVE, "sc_main") || {}).func;
  });
  check("ON vs v59: every widget identical once the split's bindings are undone", JSON.stringify(canon(V.list)) === JSON.stringify(canon(LIVE.list)));
  // the browser pass (10-27): the grid had no Add Row and no per-row Delete - the components table's own buttons
  const smo = H.findModel(ON.list, "stock_movement").options;
  const ogo = H.findModel(ON.list, "output_split").options;
  const addOf = (o) => ((o.customProps || {}).toolbar || []).filter((x) => x.type === "addBtn");
  const delOf = (o) => (o.rowActions || []).filter((x) => x.type === "delBtn");
  check("ON: the split grid has Add Row (a toolbar addBtn, as the components table's)", addOf(ogo).length === 1 && addOf(ogo)[0].title === "Add Row" &&
    same(Object.assign({}, addOf(ogo)[0], { title: "" }), Object.assign({}, addOf(smo)[0], { title: "" })) && ogo.customProps.toolbar[0].type === "addBtn", ogo.customProps);
  check("ON: the split grid has a Delete row action (the components table's delBtn)", delOf(ogo).length === 1 && same(delOf(ogo)[0], delOf(smo)[0]), ogo.rowActions);
  check("ON vs v59: the form config identical once the split's events and blocks are undone", JSON.stringify(canon(V.config)) === JSON.stringify(canon(LIVE.config)));
  const changed = ON.config.eventScript.filter((e) => H.byKey(LIVE, e.key) && JSON.stringify(H.byKey(LIVE, e.key)) !== JSON.stringify(e)).map((e) => e.name).sort();
  check("ON vs v59: the split's " + OS_EVENTS.length + " events at the end; changed only the handlers that tell os_main and IA V2's IA_NOT_RECORD",
    same(ON.config.eventScript.filter((e) => TR_EVENTS.indexOf(e.name) < 0).slice(-OS_EVENTS.length).map((e) => e.name), OS_EVENTS) && same(changed, ["iaV2_onClick_completed",
      "iaV2_onClick_completed_post", "mounted", "onChange_Plant", "onChange_assembledItem", "onChange_itemQty", "sc_main"]), changed);
  check("ON: the transfer request's " + TR_EVENTS.length + " events last", same(ON.config.eventScript.slice(-TR_EVENTS.length).map((e) => e.name), TR_EVENTS));
  // where the handlers tell os_main
  const fn = (name) => (H.byName(ON, name) || {}).func || "";
  check("ON: an item change tells os_main inside applyBatchFields (and sc_main's copy of it)", ["onChange_assembledItem", "sc_main"].every((n) =>
    fn(n).indexOf("const applyBatchFields = (item) => {\n  // IA output split (scratchpad/iasc os_main):") >= 0 && fn(n).indexOf('this.triggerEvent("os_main", { osOp: "ITEM", item: item || null });') > 0));
  check("ON: the mount's item read asks the kind's flags and tells os_main; a read-only view tells it too", fn("mounted").indexOf(OS_FIELDS[0]) > 0 &&
    /const item = res\.data\?\.\[0\];\n  \/\/ IA output split[^\n]*\n  this\.triggerEvent\("os_main", \{ osOp: "MOUNT", item: item \|\| null \}\);/.test(fn("mounted")) &&
    /const showFilledBatchFields = \(\) => \{\n  \/\/ IA output split[^\n]*\n  this\.triggerEvent\("os_main", \{ osOp: "VIEW" \}\);/.test(fn("mounted")));
  check("ON: the output quantity tells os_main first (before the Small Cycle prologue), the plant last", fn("onChange_itemQty").indexOf("// IA output split (scratchpad/iasc os_main):") === 0 &&
    /this\.triggerEvent\("os_main", \{ osOp: "PLANT" \}\);\n\/\/ -- end output split --\n$/.test(fn("onChange_Plant")));
  const notRecord = (n) => fn(n).slice(fn(n).indexOf("const IA_NOT_RECORD"), fn(n).indexOf("];", fn(n).indexOf("const IA_NOT_RECORD")) + 2);
  check("ON: IA V2's IA_NOT_RECORD strips the split's total and No. of Split, never the rows or the switch", ["iaV2_onClick_completed", "iaV2_onClick_completed_post"].every((n) =>
    untrText(notRecord(n)).endsWith(OS_NOT_RECORD) && notRecord(n).indexOf('"output_split"') < 0 && notRecord(n).indexOf('"output_split_on"') < 0));
}
H.done("test_sc_json");

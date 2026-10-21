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
};
const UI = {
  sc_section: ["grid", ""], sc_collapse: ["collapse", "sc_section"], sc_info: ["grid", "sc_collapse"], sc_actions: ["flex", "sc_collapse"], sc_btn_line: ["button", "sc_actions"], sc_btn_unlink: ["button", "sc_actions"],
  sc_btn_relink: ["button", "sc_actions"], sc_btn_suggest: ["button", "sc_actions"], sc_btn_bom: ["button", "sc_actions"], sc_btn_refresh: ["button", "sc_actions"],
  sc_line_dialog: ["dialog", ""], sc_line_table: ["table", "sc_line_dialog"], sc_expand_dialog: ["dialog", ""], sc_expand_note: ["text", "sc_expand_dialog"], sc_expand_all: ["button", "sc_expand_dialog"],
  sc_expand_table: ["table", "sc_expand_dialog"],
};
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
const EXPAND_COLS = ["component", "level", "bom", "under", "uses", "item_id", "expand"];
// the events ON binds: widget model -> [event, handler name]
const BOUND = {
  bom_consumption_mode: ["onChange", "sc_onChange_mode"], planned_output_qty: ["onChange", "sc_onChange_planned"], sc_btn_line: ["onClick", "sc_onClick_line"],
  sc_btn_unlink: ["onClick", "sc_onClick_unlink"], sc_btn_relink: ["onClick", "sc_onClick_relink"], sc_btn_suggest: ["onClick", "sc_onClick_suggest"],
  sc_btn_bom: ["onClick", "sc_onClick_bom"], sc_btn_refresh: ["onClick", "sc_onClick_refresh"], sc_expand_all: ["onClick", "sc_onClick_expandAll"],
};
const DIALOG_BOUND = { sc_line_dialog: { onCancel: "sc_onCancel_line" }, sc_expand_dialog: { onCancel: "sc_onCancel_expand", onConfirm: "sc_onConfirm_expand" } };
const ROW_LINK = ["sc_line_table", "pick", "sc_onClick_pickLine"];
const NEW_EVENTS = ["sc_main"].concat(Object.values(BOUND).map((b) => b[1]), ["sc_onClick_pickLine", "sc_onCancel_line", "sc_onCancel_expand", "sc_onConfirm_expand"]);
const PATCHED = ["wv07g9xe", "iaqty01x", "fgivan7v", "mounted", "iasvcomp", "aymq6q8z", "uhn48srb", "wia8s2r9", "iasvdrft", "iacqty01", "evhzkk8e"];
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
  const back = (model) => {
    const off = H.findModel(OFF.list, model);
    const mine = H.findModel(d.list, model);
    if (off.columns) mine.columns.forEach((c, i) => (c.list = off.columns[i].list.map((w) => byModel[w.model])));
    else mine.list = off.list.map((w) => byModel[w.model]);
  };
  d.list = d.list.filter((w) => UI01.indexOf(w.model) < 0);
  ["grid_x46134mc", "sc_info", "sc_actions"].forEach(back);
  byModel.item_qty.name = H.findModel(OFF.list, "item_qty").name;
  SC_HISTORY.forEach((m) => byModel[m] && delete byModel[m].options.history);
  return d;
};
const ONX = unregroup(ON);

for (const [label, B] of [["OFF", OFF], ["ON", ONX]]) {
  const P = parents(B);
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
  check(label + ": stock_movement gains sc_ref_key (hidden input, dataBind), required_qty, then RES-01's Reserved / Short, its last four columns", !!ref && ref.type === "input" &&
    ref.options.hidden === true && ref.options.dataBind === true && cols[cols.length - 4] === ref && cols[cols.length - 3] === req &&
    same(shownCols.map((c) => c.model), ["res_reserved", "res_short"]));
  // RES-01: a line's requirement (decision A), "Required", editable (empty = the BOM reference, filled by the save): hidden until
  // sc_main shows it for an enrolled IA, 8 decimals, no default, nothing bound
  check(label + ": required_qty = a hidden editable number Required, dataBind, p8, no default, no rule, no event", !!req && req.type === "number" && req.name === "Required" &&
    req.options.hidden === true && req.options.disabled === false && req.options.dataBind === true && req.options.precision === 8 && req.options.defaultValue === null &&
    req.options.required === false && same(req.rules, []) && Object.values(req.events).every((v) => v === ""), req && req.options);
  // RES-01: Reserved / Short = the screen's figures (text, read-only, hidden, empty; IA_SAVE drops them) and the Materials row before bom_tab
  check(label + ": res_reserved / res_short = hidden read-only text inputs, empty, nothing bound", shownCols.every((c) => c.type === "input" && c.options.hidden === true &&
    c.options.disabled === true && c.options.defaultValue === "" && Object.values(c.events || {}).every((v) => v === "")), shownCols.map((c) => c.options));
  const resRow = H.findModel(B.list, "res_summary");
  const resTop = B.list.map((w) => w.model);
  check(label + ": res_summary = a hidden display text, no label, right before bom_tab", !!resRow && resRow.type === "text" && resRow.options.dataBind === false &&
    resRow.options.hidden === true && resRow.options.hideLabel === true && resTop.indexOf("res_summary") === resTop.indexOf("bom_tab") - 1, resRow && resRow.options);
  const lt = H.findModel(B.list, "sc_line_table");
  const et = H.findModel(B.list, "sc_expand_table");
  check(label + ": sc_line_table columns", !!lt && same((lt.tableColumns || []).map((c) => c.model), LINE_COLS) && lt.options.isAdd === false && lt.options.isDelete === false);
  const pickCol = ((lt && lt.tableColumns) || []).find((c) => c.model === "pick");
  check(label + ": the Select link column fixed to the right (the user's designer change, dev v42)", !!pickCol && pickCol.options.fixedColumn === true &&
    pickCol.options.fixedColumnPosition === "right");
  check(label + ": sc_expand_table columns", !!et && same((et.tableColumns || []).map((c) => c.model), EXPAND_COLS) && et.options.isAdd === false && et.options.isDelete === false);
  const mode = H.findModel(B.list, "bom_consumption_mode");
  check(label + ": bom_consumption_mode = STANDARD / FLAT, no default", !!mode && same(mode.options.options.map((o) => [o.value, o.label]), [["STANDARD", "Standard"], ["FLAT", "Flat"]]) && mode.options.defaultValue === "");
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
  const top = B.list.map((w) => w.model);
  check(label + ": the hidden data fields right after ia_idem_key", same(top.slice(top.indexOf("ia_idem_key") + 1, top.indexOf("ia_idem_key") + 8), ["source_so_id", "source_so_line_id",
    "source_so_context_json", "source_bom_id", "bom_snapshot_json", "material_hold_status", "material_hold_at"]));
  check(label + ": the two dialogs at the end", same(top.slice(-2), ["sc_line_dialog", "sc_expand_dialog"]));
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
  const models = Object.keys(DATA).concat(Object.keys(UI).filter((m) => UI[m][1] === "" || UI[m][1] === "grid_x46134mc")).concat(["res_summary"]);
  check(label + ": every new widget exists once", models.every((m) => remove(u, m)) && models.every((m) => !H.findModel(u.list, m)));
  const ut = table(u);
  ut.tableColumns = ut.tableColumns.filter((c) => ["sc_ref_key", "required_qty", "res_reserved", "res_short"].indexOf(c.model) < 0);
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
check("ON: the added events are sc_main and its forwarders, at the end, all js", same(added.map((e) => e.name).sort(), NEW_EVENTS.slice().sort()) && added.every((e) => e.type === "js") &&
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
for (const e of added.filter((x) => x.name !== "sc_main")) {
  check("ON: forwarder " + e.name + " is one triggerEvent of sc_main", /^\/\/ [^\n]+\nthis\.triggerEvent\("sc_main", \{ scOp: "[A-Z_]+"[^\n]*\}\);\n?$/.test(e.func), e.func);
}

// the patched handlers: undo the insertions -> v36 exactly
const base = (key) => H.byKey(F0, key).func;
const built = (key) => H.byKey(ON, key).func;
// the IA V2 click handlers' double-click patch (src/v2_double_patch.json, bladexfunctions-8c 10-21): each pair applied once
const DOUBLE = JSON.parse(fs.readFileSync(path.join(H.IASC, "client/src/v2_double_patch.json"), "utf8"));
const undouble = (key, t) => (DOUBLE.handlers.indexOf(key) >= 0 ? DOUBLE.patch.reduce((x, d) => x.replace(d.now, d.was), t) : t);
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
  const t = unclose(key, undouble(key, built(key)));
  const block = between(t, PRO_START, PRO_END);
  const renamed = V36_VARIANCE.replace("const confirmBomVariance = async (data) => {", "const scBaseConfirmBomVariance = async (data) => {");
  check("ON: " + key + ": the v36 confirmBomVariance renamed, verbatim, followed by the Small Cycle wrapper", !!block && t.indexOf(renamed + "\n\n" + block) >= 0 &&
    t.replace(renamed + "\n\n" + block, V36_VARIANCE).replace(/\nconst IA_NOT_RECORD = [\s\S]*?\];\n/, "\n@@\n") === base(key).replace(/\nconst IA_NOT_RECORD = [\s\S]*?\];\n/, "\n@@\n"));
}
for (const key of DOUBLE.handlers) {
  check("ON: " + key + ": the double-click patch applied once per pair", DOUBLE.patch.every((d) => built(key).split(d.now).length === 2 && base(key).split(d.was).length === 2 &&
    (d.now.indexOf(d.was) >= 0 || built(key).indexOf(d.was) < 0)));
}
for (const key of ["uhn48srb", "wia8s2r9"]) {
  const grab = (t) => JSON.parse(/const IA_NOT_RECORD = (\[[\s\S]*?\]);/.exec(t)[1].replace(/\n/g, " "));
  const was = grab(base(key));
  const now = grab(built(key));
  // getValues keys: widgets in a layout container (grid, flex) are top-level keys, a dialog's children are under the dialog
  const ui = Object.keys(UI).filter((m) => ["", "grid_x46134mc", "sc_actions", "sc_info", "sc_section", "sc_collapse"].indexOf(UI[m][1]) >= 0).concat(UI01_NEW);
  check("ON: " + key + " IA_NOT_RECORD = v36 + the top-level UI models, never a data key", same(now.slice(0, was.length), was) && same(now.slice(was.length).sort(), ui.slice().sort()) &&
    Object.keys(DATA).every((m) => now.indexOf(m) < 0));
}

// ON vs the live dev v47 (base/ia_form_v47.json, the IA V2 double-click fix published 2026-10-21 14:00): the same form
{
  const LIVE = H.readJSON(path.join(H.IASC, "base/ia_form_v47.json"));
  // the designer stores keys in its own order: compare with sorted keys
  const canon = (x) => (Array.isArray(x) ? x.map(canon) : x && typeof x === "object" ? Object.keys(x).sort().reduce((o, k) => Object.assign(o, { [k]: canon(x[k]) }), {}) : x);
  // not published yet: RES-01 R3's widgets (Reserved / Short, the Materials row) and Required named and editable
  const r3 = H.clone(ON);
  remove(r3, "res_summary");
  const r3t = table(r3);
  r3t.tableColumns = r3t.tableColumns.filter((c) => c.model !== "res_reserved" && c.model !== "res_short");
  const r3req = r3t.tableColumns.find((c) => c.model === "required_qty");
  Object.assign(r3req, { name: "Required Qty" });
  r3req.options.disabled = true;
  check("ON vs v47: the widgets identical but RES-01 R3's (Reserved / Short, the Materials row, Required)", JSON.stringify(canon(r3.list)) === JSON.stringify(canon(LIVE.list)));
  const changed = ON.config.eventScript.filter((e) => JSON.stringify(H.byKey(LIVE, e.key)) !== JSON.stringify(e)).map((e) => e.name).sort();
  // not published yet: RES-01 R3 (switched off): the Draft handler, the add-back in the explode / component quantity / picker, and
  // sc_main (it carries the explode helpers)
  check("ON vs v47: the same events, only the RES-01 R3 / R4 handlers changed (switched off)", same(ON.config.eventScript.map((e) => e.key), LIVE.config.eventScript.map((e) => e.key)) &&
    same(changed, ["iaV2_onClick_completed", "iaV2_onClick_completed_post", "onChange_assembledItem", "onChange_componentQty", "onClick_saveAsCompleted", "onClick_saveAsCompletedPost",
      "onClick_saveAsDraft", "onClick_select_stock", "sc_main"]), changed);
  check("ON vs v47: the form config identical apart from the events", JSON.stringify(canon(Object.assign({}, ON.config, { eventScript: [] }))) ===
    JSON.stringify(canon(Object.assign({}, LIVE.config, { eventScript: [] }))));
  const expandTable = H.findModel(ON.list, "sc_expand_table");
  check("ON: the Flat dialog's note first, its Used column a whole number", H.findModel(ON.list, "sc_expand_dialog").list[0].model === "sc_expand_note" &&
    /applies to every place/.test(H.findModel(ON.list, "sc_expand_note").options.defaultValue) && expandTable.tableColumns.find((c) => c.model === "uses").options.precision === 0);
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
  check("UI-01: Output Location = storage location, category, manufacturing date | bin, batch, expiry",
    same(colsOf("sc_sec_output"), [[12, ["storage_location_id", "inventory_category", "manufacturing_date"]], [12, ["location_id", "batch_no", "expired_date"]]]), colsOf("sc_sec_output"));
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
  const f = path.join(mirrorDir, (e.name.indexOf("sc_") === 0 ? "" : "iaForm_") + e.name + ".js");
  // a rule event's mirror is its js action
  check("ON: mirror " + path.basename(f) + " = the embedded script", fs.existsSync(f) && read(f) === (e.type === "rule" ? ruleJs(ON, e.key) : e.func));
}
H.done("test_sc_json");

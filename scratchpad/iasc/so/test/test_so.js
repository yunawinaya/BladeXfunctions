// The Small Cycle SO side (scratchpad/iasc/CONTRACT.md section 10): the SO form = live dev v1240 + two table_so row actions
// (Linked IAs, Create IA) and their two handlers, everything else byte-identical; the row actions' hidden expressions on
// sample rows; the handlers open the SO Linked IAs page with the line; the page (its widgets and events) loads SUMMARY,
// shows the sales and production groups, the line's IAs and the SO's orphans, opens an IA, creates one through the IA form
// (data + sc_entry), refuses an ineligible line, says "unavailable" on a failed read, refreshes, closes.
//   node scratchpad/iasc/so/test/test_so.js
const fs = require("fs");
const path = require("path");
const H = require("../../client/test/harness");
const F = require("../../client/test/fixture");
const { check, same } = H;

const SO_DIR = path.join(H.IASC, "so");
const OUT = process.env.SC_SO_OUT || path.join(SO_DIR, "out");
const S0 = H.readJSON(path.join(H.IASC, "base/so_form_v1240.json"));
const S1 = H.scVariant(H.readJSON(path.join(OUT, "SOform.json")), true, H.SC_TEST_IDS);
const PG = H.scVariant(H.readJSON(path.join(OUT, "SOLinkedIAsPage.json")), true, H.SC_TEST_IDS);
const IA_FORM = "2098256587713404929";
const PAGE = H.SC_TEST_IDS.SO_LINKED_IAS_PAGE;
const PROJ = H.SC_TEST_IDS.SO_IA_PROJECTION;

// ---- the SO form
const t0 = H.findModel(S0.list, "table_so");
const t1 = H.findModel(S1.list, "table_so");
const ra = t1.options.rowActions;
check("SO: table_so keeps Delete and View Info, then Linked IAs and Create IA", same(ra.map((a) => a.title), ["Delete", "View Info", "Linked IAs", "Create IA"]) && same(ra.slice(0, 2), t0.options.rowActions));
const linked = ra[2];
const create = ra[3];
for (const [a, perm, name] of [[linked, "so_item_linked_ias", "onTableSofunc_scLinkedIas"], [create, "so_item_create_ia", "onTableSofunc_scCreateIa"]]) {
  check("SO: " + a.title + " is a custom Link action with permission " + perm + " and its handler", a.type === "custom" && a.styleType === "Link" && a.permission === perm && a.ignoreFormDisabled === true &&
    a.events.length === 1 && a.events[0].name === name && H.byKey(S1, a.events[0].key) && H.byKey(S1, a.events[0].key).name === name, a);
}
const u = H.clone(S1);
H.findModel(u.list, "table_so").options.rowActions.splice(2, 2);
const added = S1.config.eventScript.filter((e) => !S0.config.eventScript.some((x) => x.key === e.key));
u.config.eventScript = u.config.eventScript.filter((e) => S0.config.eventScript.some((x) => x.key === e.key));
check("SO: undo the two actions and the two events -> v1240 byte-identical", JSON.stringify(u) === JSON.stringify(S0));
check("SO: the two events are js, new keys, at the end", same(added.map((e) => e.name), ["onTableSofunc_scLinkedIas", "onTableSofunc_scCreateIa"]) && added.every((e) => e.type === "js" && /^[a-z][a-z0-9]{7}$/.test(e.key)) &&
  same(S1.config.eventScript.slice(0, S0.config.eventScript.length).map((e) => e.key), S0.config.eventScript.map((e) => e.key)));
// the hidden expressions, evaluated the way the platform does ({{ ... }} = a JS expression over arguments[0] and this)
const hiddenOf = (action, row, header) => {
  const body = /^\{\{([\s\S]*)\}\}$/.exec(action.hidden)[1];
  const self = { isView: !!(header && header.isView), getValue: (k) => (header || {})[k] };
  return new Function("return " + body + ";").call(self, { row: row });
};
const line = (o) => Object.assign({ id: "8001", item_name: "P1", line_status: "Issued", line_index: "1" }, o || {});
const cases = [
  ["a saved Issued line of an Issued SO", line(), { so_status: "Issued" }, false, false],
  ["a saved line of a Processing SO", line(), { so_status: "Processing" }, false, false],
  ["an unsaved line", line({ id: undefined }), { so_status: "Issued" }, true, true],
  ["a line without an item", line({ item_name: "" }), { so_status: "Issued" }, true, true],
  ["a Completed line", line({ line_status: "Completed" }), { so_status: "Processing" }, false, true],
  ["a Cancelled line", line({ line_status: "Cancelled" }), { so_status: "Issued" }, false, true],
  ["a Draft SO", line(), { so_status: "Draft" }, false, true],
  ["a Cancelled SO", line(), { so_status: "Cancelled" }, false, true],
  ["a Completed SO viewed", line(), { so_status: "Completed", isView: true }, false, true],
  ["an Issued SO viewed", line(), { so_status: "Issued", isView: true }, false, false],
];
for (const [what, row, header, hideLinked, hideCreate] of cases) {
  check("SO hidden: " + what + " -> Linked IAs " + (hideLinked ? "hidden" : "shown") + ", Create IA " + (hideCreate ? "hidden" : "shown"),
    hiddenOf(linked, row, header) === hideLinked && hiddenOf(create, row, header) === hideCreate, [hiddenOf(linked, row, header), hiddenOf(create, row, header)]);
}
check("SO: the hidden expressions carry no platform token besides their own braces", [linked, create].every((a) => (a.hidden.match(/\{\{/g) || []).length === 1));

const runSo = async (name, row, header) => {
  const w = H.world({});
  const self = H.makeThis(w, S1, { values: Object.assign({ id: "9001", so_no: "SO-A", organization_id: F.ORG, so_status: "Issued" }, header || {}) });
  H.compile(w, H.byName(S1, name).func, false).call(self, { row: row });
  await H.drain(w);
  return w.trace;
};
(async () => {
  for (const [name, action] of [["onTableSofunc_scLinkedIas", ""], ["onTableSofunc_scCreateIa", "create"]]) {
    const tr = await runSo(name, line());
    const v = tr.find((t) => t[0] === "toView");
    check("SO " + name + ": opens the page in a dialog with the line (" + (action || "view") + ")", !!v && v[1].target === PAGE && v[1].targetType === "Page" && v[1].mode === "dialog" &&
      same(v[1].params, { so_id: "9001", so_line_id: "8001", item_id: "P1", organization_id: F.ORG, sc_action: action }), v && v[1]);
    const unsaved = await runSo(name, line({ id: undefined }));
    check("SO " + name + ": an unsaved line opens nothing, says why", !unsaved.some((t) => t[0] === "toView") && unsaved.some((t) => t[0] === "$message.warning"));
  }
  {
    const d = H.scVariant(H.readJSON(path.join(OUT, "SOform.json")), true, H.SC_OFF_IDS);
    const w = H.world({});
    const self = H.makeThis(w, d, { values: { id: "9001" } });
    H.compile(w, H.byName(d, "onTableSofunc_scLinkedIas").func, false).call(self, { row: line() });
    await H.drain(w);
    check("SO: with the page id 0 nothing opens", !w.trace.some((t) => t[0] === "toView") && w.trace.some((t) => t[0] === "$message.warning"));
  }

  // ---- the page
  // the summary (as the IA form's Sales Order Link section): the line left, the production right, the warnings full width; one
  // read-only text per fact, each shown only when it has one; the key rows bold, the warnings in the app's error style
  const LAYOUT = [
    [["sli_summary_so", "Sales Order"], ["sli_summary_customer", "Customer"], ["sli_summary_item", "Item"], ["sli_summary_ordered", "Ordered"], ["sli_summary_delivered", "Delivered"]],
    [["sli_summary_planned", "Planned"], ["sli_summary_produced", "Produced"], ["sli_summary_open", "In Progress"], ["sli_summary_suggest", "Remaining to Plan"]],
    [["sli_summary_warn", "Warnings"]]];
  const ROW_CLASS = { sli_summary_so: "font-bold", sli_summary_suggest: "font-bold", sli_summary_warn: "error-msg" };
  const box = H.findModel(PG.list, "sli_summary");
  const rowsOf = (g) => (g && g.columns ? g.columns.map((c) => (c.list || []).map((x) => [x.model, x.name])) : []);
  // the user, 10-29: the figure tiles first (an html display, filled by sli_load), the labelled grid after it, hidden (un-hiding it = the old view)
  const tilesW = PG.list[0];
  check("page: the figure tiles first: an html display, data-bound, shown, no label, empty until sli_load fills it", tilesW.model === "sli_summary_html" && tilesW.type === "html" &&
    tilesW.options.dataBind === true && tilesW.options.hidden === false && tilesW.options.hideLabel === true && tilesW.options.defaultValue === "", tilesW.options);
  check("page: sli_summary = the labelled grid right after, hidden: the line left, the production right (half width each), the warnings full width", !!box && box.type === "grid" &&
    box.options.hidden === true && PG.list[1] === box && same(box.columns.map((c) => [c.options.span, c.options.xs]), [[12, 24], [12, 24], [24, 24]]) && same(rowsOf(box), LAYOUT), rowsOf(box));
  check("page: the buttons 8px apart (their row's own gap)", H.findModel(PG.list, "sli_actions").options.hGap === "8px");
  // the user, 10-29: no scrolling to the buttons - each table only as tall as its rows (fixed = a 400px box)
  check("page: both IA tables as tall as their rows (auto height, not virtual)", ["sli_ias", "sli_orphans"].every((m) => H.findModel(PG.list, m).options.tableHeightMode === "auto" &&
    H.findModel(PG.list, m).options.virtualTable === false), ["sli_ias", "sli_orphans"].map((m) => [H.findModel(PG.list, m).options.tableHeightMode, H.findModel(PG.list, m).options.virtualTable]));
  const rowWidgets = box && box.columns ? box.columns.flatMap((c) => c.list || []) : [];
  check("page: every row = a text, display only, hidden until it has a fact; labelled except the warnings; the key rows bold, the warnings in the error style",
    rowWidgets.length === 10 && rowWidgets.every((x) => x.type === "text" && x.options.hideLabel === (x.model === "sli_summary_warn") && x.options.dataBind === false &&
    x.options.hidden === true && x.options.defaultValue === "" && x.options.color === "" && x.options.customClass === (ROW_CLASS[x.model] || "")),
    rowWidgets.map((x) => [x.model, x.options.hideLabel, x.options.customClass]));
  const PW = { sli_summary: "grid", sli_ias: "table", sli_orphans: "table", sli_btn_create: "button", sli_btn_refresh: "button", sli_btn_close: "button" };
  for (const [m, type] of Object.entries(PW)) check("page: widget " + m + " (" + type + ")", !!H.findModel(PG.list, m) && H.findModel(PG.list, m).type === type);
  const COLS = ["ia_no", "status", "mode", "planned", "to_receive", "actual", "uom", "counted", "ia_id", "open"];
  check("page: the two tables' columns", ["sli_ias", "sli_orphans"].every((m) => same((H.findModel(PG.list, m).tableColumns || []).map((c) => c.model), COLS)));
  // UI-01: the IA form's words; an open IA's quantity is not yet received (a Draft 10 is not produced 10)
  check("page: the column names: Planned Output, Output to Receive, Actual Received", ["sli_ias", "sli_orphans"].every((m) => same(H.findModel(PG.list, m).tableColumns.map((c) => c.name),
    ["Item Assembly", "Status", "BOM Mode", "Planned Output", "Output to Receive", "Actual Received", "UOM", "Counted As", "IA ID", "Open"])),
    H.findModel(PG.list, "sli_ias").tableColumns.map((c) => c.name));
  check("page: params so_id, so_line_id, item_id, organization_id, sc_action", same(PG.config.params.map((p) => p.name), ["so_id", "so_line_id", "item_id", "organization_id", "sc_action"]));
  // the config is the page shell's own (dev 2112449353901772801, as the designer created it): only params and two scripts differ
  const SHELL = H.readJSON(path.join(H.IASC, "base/page_so_linked_ias_shell.json"));
  const life = (doc) => doc.config.eventScript.filter((e) => e.key === e.name);
  check("page: the shell's config keys and its 12 lifecycle events kept", same(Object.keys(PG.config).sort(), Object.keys(SHELL.config).sort()) &&
    same(life(PG).map((e) => e.name), SHELL.config.eventScript.map((e) => e.name)) &&
    life(PG).every((e) => e.name === "mounted" || e.name === "refresh" || JSON.stringify(e) === JSON.stringify(SHELL.config.eventScript.find((x) => x.key === e.key))),
    [Object.keys(PG.config).sort(), life(PG).map((e) => e.name)]);
  const rest = (c) => JSON.stringify(Object.assign({}, c, { eventScript: [], params: [] }));
  check("page: every other config value = the shell's", rest(PG.config) === rest(SHELL.config));
  const ev = (m, e) => H.byKey(PG, H.findModel(PG.list, m).events[e]);
  check("page: buttons bound", ev("sli_btn_create", "onClick").name === "sli_onClick_create" && ev("sli_btn_refresh", "onClick").name === "sli_onClick_refresh" &&
    ev("sli_btn_close", "onClick").name === "sli_onClick_close");
  const openOf = (m) => H.byKey(PG, (H.findModel(PG.list, m).tableColumns.find((c) => c.model === "open") || { events: {} }).events.onClick);
  check("page: the Open links bound", (openOf("sli_ias") || {}).name === "sli_onClick_open" && (openOf("sli_orphans") || {}).name === "sli_onClick_openOrphan");
  check("page: mounted and refresh load the figures", /triggerEvent\("sli_load"/.test(H.byName(PG, "mounted").func) && /triggerEvent\("sli_load"/.test(H.byName(PG, "refresh").func));
  const keys = [];
  const walk = (n) => {
    if (Array.isArray(n)) n.forEach(walk);
    else if (n && typeof n === "object") {
      if (typeof n.key === "string" && (n.model || n.type)) keys.push(n.key);
      Object.values(n).forEach(walk);
    }
  };
  walk(PG.list);
  const allKeys = keys.concat(PG.config.eventScript.map((e) => e.key));
  check("page: every key unique", allKeys.length === new Set(allKeys).size);
  for (const e of PG.config.eventScript.filter((x) => x.func)) {
    let ok = true;
    try {
      new Function("db", "return function () {\n" + e.func + "\n};");
    } catch (err) {
      ok = err.message;
    }
    check("page: " + e.name + " compiles, no platform token", ok === true && e.func.indexOf("{{") < 0, ok);
  }

  const ias = [
    { id: "4100", no: "IA-1", status: "Completed", item_id: "P1", item_qty: "30", item_uom: F.EA, planned_output_qty: "40", mode: "STANDARD", is_deleted: 0, source_so_line_id: "8001" },
    { id: "4101", no: "IA-2", status: "Draft", item_id: "P1", item_qty: "60", item_uom: F.EA, planned_output_qty: "60", mode: "FLAT", is_deleted: 0, source_so_line_id: "8001" },
  ];
  // the summary as the user sees it: "Label: value" per row shown (the last display / hide wins; at first, the widget's hidden)
  const panelOf = (p) => {
    const rows = rowWidgets.map((x) => [x.model, x.options.hideLabel ? "" : x.name, !x.options.hidden]);
    const on = {};
    rows.forEach((r) => (on[r[0]] = r[2]));
    p.trace().forEach((t) => {
      const k = String(t[0]).replace(/^sc:/, "");
      if (k === "display" || k === "hide") [].concat(t[1]).forEach((m) => m in on && (on[m] = k === "display"));
    });
    const val = (m) => (p.v()[m] === undefined || p.v()[m] === null ? "" : String(p.v()[m]));
    return rows.filter((r) => on[r[0]]).map((r) => (r[1] ? r[1] + ": " : "") + val(r[0])).join("\n");
  };
  // the Sales Order's own row (its plant: a plant, or the organisation = an organisation-level SO), read when an IA is created
  const soRow = (plant) => ({ id: "9001", so_no: "SO-A", plant_name: plant === undefined ? F.PLANT : plant, organization_id: F.ORG, is_deleted: 0 });
  // the harness logs in at plant level (deptParentId = the organisation, deptIds = 2002,2003); an organisation-level login:
  const ORG_LOGIN = { globals: { deptParentId: "0", nickname: "tester", firstLvDeptId: F.ORG }, system: { deptIds: F.ORG, uid: "77" } };
  const page = async (params, o) => {
    o = o || {};
    const db = H.tableDb(F.tables({ extra: Object.assign({ sales_order: [soRow(o.soPlant)] }, o.extra || {}) }));
    const w = H.world({ db: db, dbThrows: o.failBoms ? (name) => name === "bill_of_materials" : undefined });
    w.so = F.so(Object.assign({ ias: ias }, o.so || {}));
    if (o.down) w.projectionDown = true;
    if (o.refuse) w.projectionRefuse = o.refuse;
    const answer = F.answer(w, H.SC_TEST_IDS);
    const self = H.makeThis(w, PG, { values: {}, stateful: true, params: Object.assign({ so_id: "9001", so_line_id: "8001", item_id: "P1", organization_id: F.ORG, sc_action: "" }, params),
      globals: o.login && o.login.globals, system: o.login && o.login.system,
      answer: (id, p) => {
        const a = answer(id, p);
        if (id === PROJ && p.operation === "SUMMARY" && o.orphans && a.data) {
          const r = JSON.parse(a.data.result_json);
          r.orphans = o.orphans;
          a.data.result_json = JSON.stringify(r);
        }
        return a;
      } });
    const fire = async (name, args) => {
      H.compile(w, H.byName(PG, name).func, false).call(self, args);
      await H.drain(w);
    };
    await fire("mounted");
    return { w: w, self: self, fire: fire, v: () => self.values, trace: () => w.trace };
  };
  {
    const p = await page({});
    const v = p.v();
    const sum = p.trace().filter((t) => t[0] === "sc:runWorkflow" || t[0] === "runWorkflow").filter((t) => t[1] === PROJ);
    check("page: one SUMMARY with the line, no exclusion", sum.length === 1 && same([sum[0][2].operation, sum[0][2].so_id, sum[0][2].so_line_id, sum[0][2].item_id, sum[0][2].exclude_ia_id, sum[0][2].organization_id],
      ["SUMMARY", "9001", "8001", "P1", "", F.ORG]), sum.map((t) => t[2]));
    check("page: the summary rows (the line, its figures, the production figures, the suggestion with its sum), no warning", same(panelOf(p).split("\n"), [
      "Sales Order: SO-A · line 1", "Customer: ACME", "Item: SC-BOX", "Ordered: 100 EA", "Delivered: 0 EA", "Planned: 100 EA in this line's IAs", "Produced: 30 EA",
      "In Progress: 60 EA in open IAs", "Remaining to Plan: 10 EA = 100 ordered \u2212 30 produced \u2212 60 in progress"]), panelOf(p));
    check("page: the line's IAs (number, status, mode, planned, to receive, received, UOM, counted as): the Draft's 60 to receive, the Completed IA's 30 received",
      same((v.sli_ias || []).map((r) => [r.ia_no, r.status, r.mode, r.planned, r.to_receive, r.actual, r.uom, r.counted, r.ia_id]),
      [["IA-1", "Completed", "Standard", 40, null, 30, "EA", "Produced", "4100"], ["IA-2", "Draft", "Flat", 60, 60, null, "EA", "Open", "4101"]]), v.sli_ias);
    check("page: no orphans -> an empty orphan table, hidden", same(v.sli_orphans || [], []) && p.trace().some((t) => /hide$/.test(t[0]) && JSON.stringify(t[1]).indexOf("sli_orphans") >= 0));
    check("page: Create shown (the line is eligible)", p.trace().some((t) => /display$/.test(t[0]) && JSON.stringify(t[1]).indexOf("sli_btn_create") >= 0));
    check("page: opening it creates nothing", !p.trace().some((t) => /toView$/.test(t[0])));
    const m = p.trace().length;
    await p.fire("sli_onClick_open", { rowIndex: 1, row: (v.sli_ias || [])[1] });
    const o1 = p.trace().slice(m).find((t) => /toView$/.test(t[0]));
    check("page: Open on a Draft IA -> the IA form, edit, on the right (rtl, as every form)", !!o1 && o1[1].target === IA_FORM && o1[1].type === "edit" && o1[1].mode === "dialog" &&
      o1[1].position === "rtl" && same(o1[1].data, { id: "4101" }), o1 && o1[1]);
    const m2 = p.trace().length;
    await p.fire("sli_onClick_open", { rowIndex: 0, row: (v.sli_ias || [])[0] });
    const o2 = p.trace().slice(m2).find((t) => /toView$/.test(t[0]));
    check("page: Open on a Completed IA -> view, on the right", !!o2 && o2[1].type === "view" && o2[1].position === "rtl" && same(o2[1].data, { id: "4100" }));
    // RES-01 Created (BA, 10-22): a Created IA is edited like a Draft
    const mc = p.trace().length;
    await p.fire("sli_onClick_open", { rowIndex: 1, row: Object.assign({}, (v.sli_ias || [])[1], { status: "Created", ia_id: "4102" }) });
    const oc = p.trace().slice(mc).find((t) => /toView$/.test(t[0]));
    check("page: Open on a Created IA -> the IA form, edit", !!oc && oc[1].type === "edit" && !oc[1].viewMode && same(oc[1].data, { id: "4102" }), oc && oc[1]);
    const m3 = p.trace().length;
    await p.fire("sli_onClick_create");
    const c = p.trace().slice(m3).find((t) => /toView$/.test(t[0]));
    check("page: Create (an SO at a plant) -> the IA form, Add, on the right, prefilled (item, SO, line, STANDARD, the SO's plant), sc_entry, no plant dialog",
      !!c && c[1].target === IA_FORM && c[1].type === "add" && c[1].mode === "dialog" && c[1].position === "rtl" &&
      same(c[1].data, { item_id: "P1", source_so_id: "9001", source_so_line_id: "8001", bom_consumption_mode: "STANDARD", issuing_operation_faci: F.PLANT }) &&
      same(c[1].params, { sc_entry: "1" }) && !p.trace().slice(m3).some((t) => /openDialog$/.test(t[0])), c && c[1]);
    const m4 = p.trace().length;
    await p.fire("sli_onClick_refresh");
    check("page: Refresh reads SUMMARY again", p.trace().slice(m4).filter((t) => /runWorkflow$/.test(t[0]) && t[1] === PROJ).length === 1);
    const m5 = p.trace().length;
    await p.fire("refresh");
    check("page: the page refresh (an IA saved from it) reads SUMMARY again", p.trace().slice(m5).filter((t) => /runWorkflow$/.test(t[0]) && t[1] === PROJ).length === 1);
    const m6 = p.trace().length;
    await p.fire("sli_onClick_close");
    check("page: Close hides the dialog", p.trace().slice(m6).some((t) => t[0] === "dialog.hide"));
  }
  {
    const p = await page({ sc_action: "create" });
    const views = p.trace().filter((t) => /toView$/.test(t[0]));
    check("page: opened from Create IA on an eligible line -> the IA form once", views.length === 1 && views[0][1].type === "add" && same(views[0][1].params, { sc_entry: "1" }));
    await p.fire("refresh");
    check("page: a later refresh does not open it again", p.trace().filter((t) => /toView$/.test(t[0])).length === 1);
  }
  // a plant-level login (the user, 10-28): the IA for the login's own plant, never asked, the Sales Order's plant not read
  {
    const p = await page({ sc_action: "create" }, { soPlant: F.ORG });
    const v = p.trace().find((t) => /toView$/.test(t[0]));
    check("page: a plant-level login, an organisation-level SO -> the IA form for the login's plant (the first of deptIds), no Select Plant, the SO not read",
      !!v && v[1].data.issuing_operation_faci === "2002" && v[1].position === "rtl" && !p.trace().some((t) => /openDialog$/.test(t[0])) &&
      !p.w.reads.some((q) => q.collection === "sales_order"), v && v[1]);
  }
  {
    const p = await page({ sc_action: "create" }, { soPlant: "2003" });
    const v = p.trace().find((t) => /toView$/.test(t[0]));
    check("page: a plant-level login, an SO at another plant -> the login's plant (the IA form fixes it to the login's anyway)", !!v && v[1].data.issuing_operation_faci === "2002", v && v[1]);
  }
  // an organisation-level login: the Sales Order's own plant, else Select Plant
  {
    const p = await page({ sc_action: "create" }, { login: ORG_LOGIN, soPlant: "2003" });
    const v = p.trace().find((t) => /toView$/.test(t[0]));
    check("page: an organisation-level login, an SO at a plant -> the SO's plant, no Select Plant", !!v && v[1].data.issuing_operation_faci === "2003" &&
      !p.trace().some((t) => /openDialog$/.test(t[0])), v && v[1]);
  }
  // an organisation-level Sales Order (the user, 10-28: as SO -> GD): the plant chosen first, then the IA form for that plant
  {
    const p = await page({ sc_action: "create" }, { login: ORG_LOGIN, soPlant: F.ORG });
    check("page: Create IA on an organisation-level SO -> the Select Plant dialog, no IA form yet", p.trace().some((t) => /openDialog$/.test(t[0]) && t[1] === "sli_plant_dialog") &&
      !p.trace().some((t) => /toView$/.test(t[0])), p.trace().filter((t) => /Dialog$|toView$/.test(t[0])));
    const m = p.trace().length;
    await p.fire("sli_onConfirm_plant");
    check("page: Select Plant confirmed with no plant -> refused, no IA form", p.trace().slice(m).some((t) => /\$alert$/.test(t[0]) && /select a plant/.test(String(t[1]))) &&
      !p.trace().some((t) => /toView$/.test(t[0])), p.trace().slice(m));
    p.self.values.sli_plant_dialog = { sli_plant_id: F.ORG };
    const m1 = p.trace().length;
    await p.fire("sli_onConfirm_plant");
    check("page: Select Plant confirmed with the organisation itself -> refused", p.trace().slice(m1).some((t) => /\$alert$/.test(t[0])) && !p.trace().some((t) => /toView$/.test(t[0])));
    p.self.values.sli_plant_dialog = { sli_plant_id: F.PLANT };
    const m2 = p.trace().length;
    await p.fire("sli_onConfirm_plant");
    const v = p.trace().slice(m2).find((t) => /toView$/.test(t[0]));
    check("page: Select Plant confirmed -> the dialog closed, the IA form for that plant (rtl, prefilled)", !!v && v[1].position === "rtl" && v[1].data.issuing_operation_faci === F.PLANT &&
      v[1].data.source_so_line_id === "8001" && p.trace().slice(m2).some((t) => /closeDialog$/.test(t[0]) && t[1] === "sli_plant_dialog"), v && v[1]);
    const m3 = p.trace().length;
    await p.fire("sli_onCancel_plant");
    check("page: Select Plant cancelled -> the dialog closed, nothing opened", p.trace().slice(m3).some((t) => /closeDialog$/.test(t[0])) &&
      !p.trace().slice(m3).some((t) => /toView$/.test(t[0])));
  }
  {
    const p = await page({ sc_action: "create" }, { login: ORG_LOGIN, soPlant: "" });
    check("page: an SO without a plant is organisation-level too -> Select Plant", p.trace().some((t) => /openDialog$/.test(t[0]) && t[1] === "sli_plant_dialog") &&
      !p.trace().some((t) => /toView$/.test(t[0])));
  }
  // an item without an active BOM in the organisation (the user, 10-28): Create hidden and refused with the reason
  {
    const p = await page({ sc_action: "create" }, { extra: { bill_of_materials: [F.bom("B1", "P1", 10, [F.row("C1", 1)], { is_active: 0 })] } });
    check("page: an item without an active BOM -> Create hidden, no IA form, the reason", !p.trace().some((t) => /toView$|openDialog$/.test(t[0])) &&
      p.trace().some((t) => /hide$/.test(t[0]) && JSON.stringify(t[1]).indexOf("sli_btn_create") >= 0) &&
      p.trace().some((t) => /\$message\.warning$/.test(t[0]) && /SC-BOX has no active BOM/.test(String(t[1]))), p.trace().filter((t) => /message/.test(t[0])));
    await p.fire("sli_onClick_create");
    check("page: Create pressed anyway on an item without an active BOM -> refused again", !p.trace().some((t) => /toView$|openDialog$/.test(t[0])));
  }
  {
    const p = await page({ sc_action: "create" }, { extra: { bill_of_materials: [F.bom("B9", "P1", 10, [F.row("C1", 1)], { organization_id: "OTHER-ORG" })] } });
    check("page: a BOM of another organisation only -> refused (the IA form's own rule: the SO's organisation)", !p.trace().some((t) => /toView$|openDialog$/.test(t[0])));
  }
  {
    const p = await page({ sc_action: "create" }, { failBoms: true });
    check("page: the BOM read failed -> no IA form, an error (never a guess)", !p.trace().some((t) => /toView$|openDialog$/.test(t[0])) &&
      p.trace().some((t) => /\$message\.error$/.test(t[0])), p.trace().filter((t) => /message/.test(t[0])));
  }
  {
    const p = await page({ sc_action: "create" }, { so: { header: Object.assign({}, F.so().header, { so_status: "Cancelled" }) } });
    check("page: a cancelled SO: no IA form, the reason shown, Create hidden, the warnings listed", !p.trace().some((t) => /toView$/.test(t[0])) && p.trace().some((t) => /\$message\.warning$/.test(t[0]) && /no active demand/.test(t[1])) &&
      p.trace().some((t) => /hide$/.test(t[0]) && JSON.stringify(t[1]).indexOf("sli_btn_create") >= 0) && /^\u26a0 SO-A is cancelled: it has no remaining demand\.$/m.test(panelOf(p)) &&
      /^Remaining to Plan: 0 EA: the line has no remaining demand$/m.test(panelOf(p)), panelOf(p));
    await p.fire("sli_onClick_create");
    check("page: Create on an ineligible line refuses", !p.trace().some((t) => /toView$/.test(t[0])));
  }
  {
    const NO = "Your user is not assigned to this organisation, so its Sales Order figures cannot be shown.";
    const q = await page({}, { refuse: NO });
    check("page: a refused read (FIX-03): the server's reason, tables empty, Create hidden", panelOf(q) === "Sales Order: " + NO && same(q.v().sli_ias || [], []) &&
      q.trace().some((t) => /hide$/.test(t[0]) && JSON.stringify(t[1]).indexOf("sli_btn_create") >= 0), panelOf(q));
    const p = await page({}, { down: true });
    check("page: a failed read: 'unavailable' only, no figure shown as zero, tables empty, Create hidden",
      panelOf(p) === "Sales Order: figures unavailable right now: press Refresh to try again" && same(p.v().sli_ias || [], []) &&
      p.trace().some((t) => /hide$/.test(t[0]) && JSON.stringify(t[1]).indexOf("sli_btn_create") >= 0), panelOf(p));
  }
  {
    const orphans = [{ id: "4200", no: "IA-9", status: "Completed", item_id: "P1", item_qty: "5", item_uom: F.EA, planned_output_qty: "5", mode: "STANDARD", is_deleted: 0, source_so_line_id: "7999" },
      { id: "4201", no: "IA-10", status: "Draft", item_id: "P1", item_qty: "7", item_uom: F.EA, planned_output_qty: "8", mode: "STANDARD", is_deleted: 0, source_so_line_id: "7999" },
      { id: "4202", no: "IA-11", status: "Created", item_id: "P1", item_qty: "3", item_uom: F.EA, planned_output_qty: "3", mode: "STANDARD", is_deleted: 0, source_so_line_id: "7999" }];
    const p = await page({}, { orphans: orphans });
    check("page: an orphan's quantity received when Completed, to receive when Draft or Created (review 3)", same((p.v().sli_orphans || []).map((r) => [r.ia_no, r.planned, r.to_receive, r.actual]),
      [["IA-9", 5, null, 5], ["IA-10", 8, 7, null], ["IA-11", 3, 3, null]]), p.v().sli_orphans);
    check("page: the SO's IAs whose line was removed are listed apart", same((p.v().sli_orphans || []).map((r) => [r.ia_no, r.status, r.counted, r.ia_id]),
      [["IA-9", "Completed", "Line removed", "4200"], ["IA-10", "Draft", "Line removed", "4201"], ["IA-11", "Created", "Line removed", "4202"]]) &&
      p.trace().some((t) => /display$/.test(t[0]) && JSON.stringify(t[1]).indexOf("sli_orphans") >= 0), p.v().sli_orphans);
    const m = p.trace().length;
    await p.fire("sli_onClick_openOrphan", { rowIndex: 0, row: (p.v().sli_orphans || [])[0] });
    check("page: Open on an orphan -> the IA form, view", p.trace().slice(m).some((t) => /toView$/.test(t[0]) && t[1].type === "view" && same(t[1].data, { id: "4200" })));
  }
  {
    const p = await page({});
    p.w.projectionDown = true;
    await p.fire("sli_onClick_refresh");
    check("page: Refresh failing after a good read: only 'unavailable' left, every figure row hidden again", panelOf(p) === "Sales Order: figures unavailable right now: press Refresh to try again", panelOf(p));
  }
  {
    const p = await page({}, { so: { lines: [Object.assign({}, F.so().lines[0], { delivered_qty: "35" })] } });
    const q = await page({}, { so: { lines: [Object.assign({}, F.so().lines[0], { delivered_qty: "35" })], ias: [ias[1]] } });
    check("page: delivered 35, nothing produced: exact, the delivered taken off", /^Remaining to Plan: 5 EA = 100 ordered \u2212 35 delivered \u2212 60 in progress$/m.test(panelOf(q)),
      panelOf(q));
    check("page: delivered 35 and produced 30 may overlap: Remaining to Plan unavailable, with why (FIX-01)",
      /^Remaining to Plan: Unavailable: nothing records whether the 35 EA delivered came from the 30 EA produced$/m.test(panelOf(p)), panelOf(p));
  }
  {
    const p = await page({}, { so: { header: Object.assign({}, F.so().header, { so_status: "Cancelled" }), lines: [Object.assign({}, F.so().lines[0], { line_status: "Completed" })] } });
    check("page: two warnings, each marked", /^\u26a0 SO-A is cancelled: it has no remaining demand\.   \u26a0 SO-A line 1 is completed\.$/m.test(panelOf(p)), panelOf(p));
  }
  // the figure tiles (the user, 10-29): one html card on top - the line, its customer and item, six figures, the sum under them, the
  // warnings in a strip; the labelled text rows stay filled but their grid is hidden
  const tileOf = (h, label) => {
    const m = new RegExp(">" + label + "</div><div[^>]*>([^<]*)</div>").exec(h);
    return m ? m[1] : null;
  };
  const TILES = ["Ordered", "Delivered", "Planned", "Produced", "In Progress", "To Plan"];
  {
    const p = await page({});
    const h = String(p.v().sli_summary_html || "");
    check("tiles: the line on top, its customer and item under it", /SO-A · line 1/.test(h) && /ACME · SC-BOX/.test(h), h);
    check("tiles: the SO number large (20px, bold)", /<div style="font-size:20px;font-weight:600[^"]*">SO-A · line 1<\/div>/.test(h), h);
    check("tiles: the six figures", same(TILES.map((x) => tileOf(h, x)), ["100 EA", "0 EA", "100 EA", "30 EA", "60 EA", "10 EA"]), TILES.map((x) => tileOf(h, x)));
    check("tiles: the sum under them", h.indexOf("To Plan = 100 ordered − 30 produced − 60 in progress") >= 0, h);
    check("tiles: no warning strip without a warning", h.indexOf("⚠") < 0, h);
    check("tiles: inline styles only, no script", !/<script|on[a-z]+=|<style/i.test(h), h);
  }
  {
    const p = await page({}, { so: { header: Object.assign({}, F.so().header, { so_status: "Cancelled" }), lines: [Object.assign({}, F.so().lines[0], { line_status: "Completed" })] } });
    const h = String(p.v().sli_summary_html || "");
    check("tiles: each warning on its own line in the strip", (h.match(/<div[^>]*>⚠ [^<]*<\/div>/g) || []).length === 2 && h.indexOf("⚠ SO-A is cancelled: it has no remaining demand.") >= 0, h);
    check("tiles: a line with no demand -> To Plan 0, the reason under it", tileOf(h, "To Plan") === "0 EA" && h.indexOf("the line has no remaining demand") >= 0, h);
  }
  {
    const p = await page({}, { so: { header: Object.assign({}, F.so().header, { customer_name: "A<b>&C" }) } });
    const h = String(p.v().sli_summary_html || "");
    check("tiles: names are shown as text, never as markup", h.indexOf("A&lt;b&gt;&amp;C") >= 0 && h.indexOf("A<b>") < 0, h);
  }
  {
    const p = await page({}, { down: true });
    const h = String(p.v().sli_summary_html || "");
    check("tiles: figures unavailable -> the message, no tiles", h.indexOf("figures unavailable right now: press Refresh to try again") >= 0 && tileOf(h, "Ordered") === null, h);
  }
  // the page vs the live dev v8 (base/page_so_linked_ias_v8.json, pulled 10-28): the same page but the user's 10-28 notes - Select Plant
  // (an appended dialog and its two events), the IA form opened on the right (rtl) for a plant and only for an item with an active BOM
  {
    const V8 = H.readJSON(path.join(H.IASC, "base/page_so_linked_ias_v8.json"));
    const RAW = H.readJSON(path.join(OUT, "SOLinkedIAsPage.json"));
    const dlg = RAW.list[RAW.list.length - 1];
    // v8's widgets: the 10-29 tiles taken off the top, the grid shown, the buttons without their gap
    const was8 = JSON.parse(JSON.stringify(RAW.list.slice(1, -1)));
    was8[0].options.hidden = false;
    H.findModel(was8, "sli_actions").options.hGap = "";
    ["sli_ias", "sli_orphans"].forEach((m) => Object.assign(H.findModel(was8, m).options, { tableHeightMode: "fixed", virtualTable: true }));
    check("page vs v8: the widgets identical but the tiles (first), the grid hidden, the buttons' gap and the Select Plant dialog (last: a note and the Plant)",
      RAW.list[0].model === "sli_summary_html" && JSON.stringify(was8) === JSON.stringify(V8.list) &&
      dlg.model === "sli_plant_dialog" && same(dlg.list.map((x) => x.model), ["sli_plant_note", "sli_plant_id"]), dlg && dlg.model);
    check("page vs v8: Select Plant = 'Select Plant', the Plant unbound and not required (checked on Confirm), the IA form's plant list", dlg.options.title === "Select Plant" &&
      dlg.list[1].options.dataBind === false && dlg.list[1].options.required === false && same(dlg.list[1].rules, []) &&
      H.byKey(RAW, dlg.events.onConfirm).name === "sli_onConfirm_plant" && H.byKey(RAW, dlg.events.onCancel).name === "sli_onCancel_plant");
    const NEW = ["sli_onConfirm_plant", "sli_onCancel_plant"];
    check("page vs v8: the same events, the two Select Plant events appended", same(RAW.config.eventScript.map((e) => e.key).slice(0, -2), V8.config.eventScript.map((e) => e.key)) &&
      same(RAW.config.eventScript.slice(-2).map((e) => e.name), NEW));
    const changed = RAW.config.eventScript.filter((e) => NEW.indexOf(e.name) < 0 && JSON.stringify(H.byKey(V8, e.key)) !== JSON.stringify(e)).map((e) => e.name);
    const openOk = (e) => (H.byKey(V8, e.key) || {}).func.replace("  const view = {", "  // on the right, as every form opens (the user, 10-28)\n  const view = {")
      .replace('mode: "dialog", title: edit', 'mode: "dialog", position: "rtl", title: edit') === e.func;
    check("page vs v8: changed only sli_load and the two Open handlers (rtl, one line each)", same(changed, ["sli_load", "sli_onClick_open", "sli_onClick_openOrphan"]) &&
      ["sli_onClick_open", "sli_onClick_openOrphan"].every((n) => openOk(H.byName(RAW, n))), changed);
    const was = (H.byKey(V8, H.byName(RAW, "sli_load").key) || {}).func || "";
    // the two tile lines (10-29) are tagged; the tile helpers sit with the BOM / plant helpers
    const now = H.byName(RAW, "sli_load").func.split("\n").filter((x) => !/\/\/ the tiles \(10-29\)$/.test(x)).join("\n");
    const a = now.indexOf("// an active BOM of the item");
    const b = now.indexOf("const ROLE = ");
    const c1 = now.indexOf("    // only an item with an active BOM");
    const c2 = now.indexOf("  } catch (error) {", c1);
    const w1 = was.indexOf("    if (r.eligibleNew) this.display");
    const w2 = was.indexOf("  } catch (error) {", w1);
    check("page vs v8: sli_load = v8 + the BOM / plant helpers + the new create path, nothing else", a > 0 && b > a && c1 > b && c2 > c1 && w1 > 0 && w2 > w1 &&
      now.slice(0, a) + now.slice(b, c1) + was.slice(w1, w2) + now.slice(c2) === was);
    check("page vs v8: the config identical apart from the events", JSON.stringify(Object.assign({}, RAW.config, { eventScript: [] })) ===
      JSON.stringify(Object.assign({}, V8.config, { eventScript: [] })));
  }
  H.done("test_so");
})();

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
    [["sli_summary_planned", "Planned"], ["sli_summary_produced", "Produced"], ["sli_summary_open", "In Progress"], ["sli_summary_suggest", "Suggested Qty"]],
    [["sli_summary_warn", "Warnings"]]];
  const ROW_CLASS = { sli_summary_so: "font-bold", sli_summary_suggest: "font-bold", sli_summary_warn: "error-msg" };
  const box = H.findModel(PG.list, "sli_summary");
  const rowsOf = (g) => (g && g.columns ? g.columns.map((c) => (c.list || []).map((x) => [x.model, x.name])) : []);
  check("page: sli_summary = a grid first on the page: the line left, the production right (half width each), the warnings full width", !!box && box.type === "grid" &&
    box.options.hidden === false && PG.list[0] === box && same(box.columns.map((c) => [c.options.span, c.options.xs]), [[12, 24], [12, 24], [24, 24]]) && same(rowsOf(box), LAYOUT), rowsOf(box));
  const rowWidgets = box && box.columns ? box.columns.flatMap((c) => c.list || []) : [];
  check("page: every row = a text, display only, hidden until it has a fact; labelled except the warnings; the key rows bold, the warnings in the error style",
    rowWidgets.length === 10 && rowWidgets.every((x) => x.type === "text" && x.options.hideLabel === (x.model === "sli_summary_warn") && x.options.dataBind === false &&
    x.options.hidden === true && x.options.defaultValue === "" && x.options.color === "" && x.options.customClass === (ROW_CLASS[x.model] || "")),
    rowWidgets.map((x) => [x.model, x.options.hideLabel, x.options.customClass]));
  const PW = { sli_summary: "grid", sli_ias: "table", sli_orphans: "table", sli_btn_create: "button", sli_btn_refresh: "button", sli_btn_close: "button" };
  for (const [m, type] of Object.entries(PW)) check("page: widget " + m + " (" + type + ")", !!H.findModel(PG.list, m) && H.findModel(PG.list, m).type === type);
  const COLS = ["ia_no", "status", "mode", "planned", "actual", "uom", "counted", "ia_id", "open"];
  check("page: the two tables' columns", ["sli_ias", "sli_orphans"].every((m) => same((H.findModel(PG.list, m).tableColumns || []).map((c) => c.model), COLS)));
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
  const page = async (params, o) => {
    o = o || {};
    const w = H.world({ db: H.tableDb(F.tables()) });
    w.so = F.so(Object.assign({ ias: ias }, o.so || {}));
    if (o.down) w.projectionDown = true;
    const answer = F.answer(w, H.SC_TEST_IDS);
    const self = H.makeThis(w, PG, { values: {}, stateful: true, params: Object.assign({ so_id: "9001", so_line_id: "8001", item_id: "P1", organization_id: F.ORG, sc_action: "" }, params),
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
      "In Progress: 60 EA in open IAs", "Suggested Qty: 10 EA = 100 ordered \u2212 30 produced \u2212 60 in progress"]), panelOf(p));
    check("page: the line's IAs (number, status, mode, planned, actual, UOM, counted as)", same((v.sli_ias || []).map((r) => [r.ia_no, r.status, r.mode, r.planned, r.actual, r.uom, r.counted, r.ia_id]),
      [["IA-1", "Completed", "Standard", 40, 30, "EA", "Produced", "4100"], ["IA-2", "Draft", "Flat", 60, 60, "EA", "Open", "4101"]]), v.sli_ias);
    check("page: no orphans -> an empty orphan table, hidden", same(v.sli_orphans || [], []) && p.trace().some((t) => /hide$/.test(t[0]) && JSON.stringify(t[1]).indexOf("sli_orphans") >= 0));
    check("page: Create shown (the line is eligible)", p.trace().some((t) => /display$/.test(t[0]) && JSON.stringify(t[1]).indexOf("sli_btn_create") >= 0));
    check("page: opening it creates nothing", !p.trace().some((t) => /toView$/.test(t[0])));
    const m = p.trace().length;
    await p.fire("sli_onClick_open", { rowIndex: 1, row: (v.sli_ias || [])[1] });
    const o1 = p.trace().slice(m).find((t) => /toView$/.test(t[0]));
    check("page: Open on a Draft IA -> the IA form, edit", !!o1 && o1[1].target === IA_FORM && o1[1].type === "edit" && o1[1].mode === "dialog" && same(o1[1].data, { id: "4101" }), o1 && o1[1]);
    const m2 = p.trace().length;
    await p.fire("sli_onClick_open", { rowIndex: 0, row: (v.sli_ias || [])[0] });
    const o2 = p.trace().slice(m2).find((t) => /toView$/.test(t[0]));
    check("page: Open on a Completed IA -> view", !!o2 && o2[1].type === "view" && same(o2[1].data, { id: "4100" }));
    const m3 = p.trace().length;
    await p.fire("sli_onClick_create");
    const c = p.trace().slice(m3).find((t) => /toView$/.test(t[0]));
    check("page: Create -> the IA form, Add, prefilled (item, SO, line, STANDARD), sc_entry", !!c && c[1].target === IA_FORM && c[1].type === "add" && c[1].mode === "dialog" &&
      same(c[1].data, { item_id: "P1", source_so_id: "9001", source_so_line_id: "8001", bom_consumption_mode: "STANDARD" }) && same(c[1].params, { sc_entry: "1" }), c && c[1]);
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
  {
    const p = await page({ sc_action: "create" }, { so: { header: Object.assign({}, F.so().header, { so_status: "Cancelled" }) } });
    check("page: a cancelled SO: no IA form, the reason shown, Create hidden, the warnings listed", !p.trace().some((t) => /toView$/.test(t[0])) && p.trace().some((t) => /\$message\.warning$/.test(t[0]) && /no active demand/.test(t[1])) &&
      p.trace().some((t) => /hide$/.test(t[0]) && JSON.stringify(t[1]).indexOf("sli_btn_create") >= 0) && /^\u26a0 SO-A is cancelled: it has no remaining demand\.$/m.test(panelOf(p)) &&
      /^Suggested Qty: 0 EA: the line has no remaining demand$/m.test(panelOf(p)), panelOf(p));
    await p.fire("sli_onClick_create");
    check("page: Create on an ineligible line refuses", !p.trace().some((t) => /toView$/.test(t[0])));
  }
  {
    const p = await page({}, { down: true });
    check("page: a failed read: 'unavailable' only, no figure shown as zero, tables empty, Create hidden",
      panelOf(p) === "Sales Order: figures unavailable right now: press Refresh to try again" && same(p.v().sli_ias || [], []) &&
      p.trace().some((t) => /hide$/.test(t[0]) && JSON.stringify(t[1]).indexOf("sli_btn_create") >= 0), panelOf(p));
  }
  {
    const orphans = [{ id: "4200", no: "IA-9", status: "Completed", item_id: "P1", item_qty: "5", item_uom: F.EA, planned_output_qty: "5", mode: "STANDARD", is_deleted: 0, source_so_line_id: "7999" }];
    const p = await page({}, { orphans: orphans });
    check("page: the SO's IAs whose line was removed are listed apart", same((p.v().sli_orphans || []).map((r) => [r.ia_no, r.status, r.counted, r.ia_id]), [["IA-9", "Completed", "Line removed", "4200"]]) &&
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
    check("page: delivered 35 > produced 30: the suggestion takes the delivered off", /^Suggested Qty: 5 EA = 100 ordered \u2212 35 delivered \u2212 60 in progress$/m.test(panelOf(p)), panelOf(p));
  }
  {
    const p = await page({}, { so: { header: Object.assign({}, F.so().header, { so_status: "Cancelled" }), lines: [Object.assign({}, F.so().lines[0], { line_status: "Completed" })] } });
    check("page: two warnings, each marked", /^\u26a0 SO-A is cancelled: it has no remaining demand\.   \u26a0 SO-A line 1 is completed\.$/m.test(panelOf(p)), panelOf(p));
  }
  // the page vs the live dev v3 (the publish base): every widget and event keeps its key; only the summary and sli_load differ
  {
    const V2 = H.readJSON(path.join(H.IASC, "base/page_so_linked_ias_v3.json"));
    const strip = (doc) => {
      const d = H.clone(doc);
      const b = H.findModel(d.list, "sli_summary");
      const key = b.key;
      Object.keys(b).forEach((k) => delete b[k]);
      Object.assign(b, { model: "sli_summary", key: key });
      return JSON.stringify(d.list);
    };
    const RAW = H.readJSON(path.join(OUT, "SOLinkedIAsPage.json"));
    check("page vs v3: the widgets differ only inside the summary; sli_summary keeps its key", strip(RAW) === strip(V2));
    const keyOf = (doc) => {
      const out = {};
      const walk = (n) => {
        if (Array.isArray(n)) n.forEach(walk);
        else if (n && typeof n === "object") {
          if (n.model && n.key && n.type) out[n.model] = n.key;
          Object.values(n).forEach(walk);
        }
      };
      walk(doc.list);
      return out;
    };
    const kRaw = keyOf(RAW);
    const kV = keyOf(V2);
    check("page vs v3: every v3 widget keeps its key", Object.keys(kV).every((m) => kRaw[m] === kV[m]), Object.keys(kV).filter((m) => kRaw[m] !== kV[m]));
    const changed = RAW.config.eventScript.filter((e) => JSON.stringify(H.byKey(V2, e.key)) !== JSON.stringify(e)).map((e) => e.name);
    check("page vs v3: the same events and config; only sli_load changed", same(RAW.config.eventScript.map((e) => e.key), V2.config.eventScript.map((e) => e.key)) &&
      same(changed, ["sli_load"]) && JSON.stringify(Object.assign({}, RAW.config, { eventScript: [] })) === JSON.stringify(Object.assign({}, V2.config, { eventScript: [] })), changed);
  }
  H.done("test_so");
})();

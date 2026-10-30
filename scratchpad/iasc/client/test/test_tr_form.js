// IA transfer request (ENH-20261027-001, scratchpad/iatr) on the Item Assembly form: tr_main (src/tr_main.js) on the ON build, v8 (a request
// from a reserved = Created IA, RESERVED_REQUEST_PLAN.md Task 9; test_tr_reserve.js has the receipt, the replacement and the defect).
//   mount   an IA without a request link: only an editable Created IA of an organisation with the setup on asks STATUS (Request Materials
//           when it may); a linked one asks STATUS and shows its line and View, Refresh and Cancel (Requested, editable); in transit a
//           read-only notice; a STATUS that fails offers nothing
//   create  Request Materials -> the staging pickers + Create; missing picks said, no call; CREATE carries the IA as the screen shows it
//           (iatrIaFp), the staging storage / bin and the required date (a timestamp read as the local day); its answer said, the link
//           set, the section re-read; a refusal said
//   others  View opens the request (a dispatched one editable: Receive is there); Refresh / Cancel confirmed, then IA_TRANSFER_REQUEST;
//           the staging bin cleared when its storage location changes; the IA never picks from the staging bin itself (B21 retired:
//           the receipt moves the IA's picks)
//   node scratchpad/iasc/client/test/test_tr_form.js
const fs = require("fs");
const path = require("path");
const H = require("./harness");
const F = require("./fixture");
const { check, same } = H;

const ON = H.scVariant(H.readJSON(H.FILES.formOn), true, H.SC_TEST_IDS);
const IATR = "1985966508400201729";
const LOT_FORM = "2013791389687349250";
const SHARED = path.join(H.ROOT, "scratchpad", "iatr", "code", "shared");
const strip = (t) => t.split("\n").filter((l) => !l.startsWith("if (typeof module")).join("\n");
const R = new Function(strip(fs.readFileSync(path.join(SHARED, "iatr_rules.js"), "utf8")) + "\n" + strip(fs.readFileSync(path.join(SHARED, "iatr_ia.js"), "utf8")) +
  "\nreturn { iatrIaFp, iatrBasis };")();

const lines = () => [{ id: "5001", item_selection: "C1", quantity_uom: F.EA, requested_qty: 4, required_qty: null, line_index: "1", temp_qty_data: "" },
  { id: "5002", item_selection: "C2", quantity_uom: F.EA, requested_qty: 2, required_qty: 3, line_index: "2", temp_qty_data: "" }];
const ia = (o) => F.header(Object.assign({ id: "4001", page_status: "Edit", item_assembly_status: "Created", stock_movement_no: "IA-7", stock_movement: lines(), item_qty: 2,
  transfer_request_id: "", transfer_request_no: "", tr_storage_location_id: "", tr_location_id: "", tr_required_date: "" }, o || {}));
const req = (o) => Object.assign({ id: "2114100000000000001", no: "LOT-20261028/0007", status: "Requested", rev: 1, stale: "NO" }, o || {});
const statusOf = (r, canCreate) => ({ data: { code: "200", message: "", result_json: JSON.stringify({ request: r, history: r ? [r] : [], can_create: canCreate || "NO", gap: [],
  replace_ready: "NO" }) } });
const SETUP_ON = [{ id: "9001", organization_id: F.ORG, plant_id: F.PLANT, transfer_request_enabled: 1, is_deleted: 0 }];
const session = (values, opt) => {
  const o = opt || {};
  const w = H.world({ db: H.tableDb(Object.assign(F.tables(), { item_assembly_setup: o.setup === undefined ? SETUP_ON : o.setup })) });
  w.so = F.so();
  const calls = [];
  const self = H.makeThis(w, ON, Object.assign({ values: H.clone(values), stateful: true, confirm: o.confirm,
    answer: (id, params) => {
      if (id !== IATR) return { data: { code: "200", message: "ok" } };
      calls.push(params);
      return o.answer ? o.answer(params) : statusOf(null, "YES");
    } }, o.flags || {}));
  const fire = async (op, extra) => {
    self.triggerEvent("tr_main", Object.assign({ trOp: op }, extra || {}));
    await H.drain(w);
  };
  return { w, self, calls, fire };
};
const shown = (w) => w.trace.filter((t) => /display$/.test(t[0])).reduce((a, t) => a.concat(t[1]), []);
const said = (w) => w.trace.filter((t) => /\$message\.[a-z]+$/.test(t[0])).map((t) => t[0].replace(/^.*\$message\./, "") + ": " + t[1]);
const sets = (w, k) => w.trace.filter((t) => /setData$/.test(t[0]) && t[1] && k in t[1]).map((t) => t[1][k]);
const TRB = ["tr_btn_new", "tr_btn_create", "tr_btn_view", "tr_btn_refresh", "tr_btn_cancel", "tr_btn_replace", "tr_btn_defect", "tr_section", "tr_pick"];
const trShown = (w) => shown(w).filter((m) => TRB.indexOf(m) >= 0);
const ops = (calls) => calls.map((p) => p.operation).join();
// what CREATE answers, then STATUS: no request before it, the created one after
const creating = (created) => {
  let made = false;
  return (p) => {
    if (p.operation === "CREATE") {
      made = true;
      return created;
    }
    return made ? statusOf(JSON.parse(created.data.result_json).request) : statusOf(null, "YES");
  };
};

(async () => {
  // ---- mount, no request link (D12: only an editable Created IA of an organisation with Transfer Request on asks)
  let s = session(ia());
  await s.fire("MOUNT", { pageStatus: "Edit", status: "Created" });
  check("mount, an editable Created IA without a request: STATUS, then only Request Materials", same(trShown(s.w), ["tr_btn_new"]) && ops(s.calls) === "STATUS" &&
    s.calls[0].ia_id === "4001" && s.calls[0].organization_id === F.ORG, [trShown(s.w), s.calls]);
  for (const [label, page, st] of [["viewed Created", "View", "Created"], ["Draft", "Edit", "Draft"], ["Completed", "Edit", "Completed"], ["new", "Add", "Draft"]]) {
    s = session(ia({ item_assembly_status: st }));
    await s.fire("MOUNT", { pageStatus: page, status: st });
    check("mount, a " + label + " IA without a request: nothing shown, no call", trShown(s.w).length === 0 && s.calls.length === 0, [trShown(s.w), s.calls]);
  }
  s = session(ia({ id: "" }));
  await s.fire("MOUNT", { pageStatus: "Edit", status: "Created" });
  check("mount, an unsaved IA: nothing", trShown(s.w).length === 0 && s.calls.length === 0);
  s = session(ia(), { setup: [{ id: "9001", organization_id: "999", plant_id: F.PLANT, transfer_request_enabled: 1, is_deleted: 0 }] });
  await s.fire("MOUNT", { pageStatus: "Edit", status: "Created" });
  check("mount, the setup on for another organisation only: nothing, no call", trShown(s.w).length === 0 && s.calls.length === 0, [trShown(s.w), s.calls]);
  s = session(ia(), { setup: [{ id: "9001", organization_id: F.ORG, plant_id: F.PLANT, transfer_request_enabled: 1, is_deleted: 1 }] });
  await s.fire("MOUNT", { pageStatus: "Edit", status: "Created" });
  check("mount, the setup row deleted: off - nothing, no call", trShown(s.w).length === 0 && s.calls.length === 0, [trShown(s.w), s.calls]);

  // ---- Request Materials -> Create
  const created = { data: { code: "200", message: "Transfer request LOT-20261028/0007 created.", result_json: JSON.stringify({ request: req(), created: "YES" }) } };
  s = session(ia({ tr_storage_location_id: "2105223032261218399", tr_location_id: "2106278340907413599", tr_required_date: new Date(2026, 9, 30, 0, 0, 0).getTime() }),
    { answer: creating(created) });
  await s.fire("MOUNT", { pageStatus: "Edit", status: "Created" });
  await s.fire("NEW");
  check("Request Materials: the section, the pickers and Create", ["tr_section", "tr_pick", "tr_btn_create"].every((m) => shown(s.w).indexOf(m) >= 0) && ops(s.calls) === "STATUS",
    trShown(s.w));
  check("  its line says what to choose", /choose the staging storage location and bin, and the date/.test(sets(s.w, "tr_info").slice(-1)[0] || ""), sets(s.w, "tr_info"));
  s.w.trace.length = 0;
  s.calls.length = 0;
  await s.fire("CREATE");
  const c = s.calls.find((p) => p.operation === "CREATE") || {};
  const fp = R.iatrIaFp(R.iatrBasis({ plant: F.PLANT, item_id: "P1", item_qty: 2, planned_output_qty: null, bom_consumption_mode: "", source_bom_id: "" }), lines());
  check("Create: CREATE with the IA as the screen shows it, the staging bin and the local required day", c.ia_id === "4001" && c.organization_id === F.ORG && c.expected_fp === fp &&
    c.storage_location_id === "2105223032261218399" && c.location_id === "2106278340907413599" && c.required_date === "2026-10-30" && /^[A-Za-z0-9|:_.-]{8,128}$/.test(c.idempotency_key || ""), c);
  check("  its answer said, the link set on the form, the section re-read", same(said(s.w), ["success: Transfer request LOT-20261028/0007 created."]) &&
    same(sets(s.w, "transfer_request_id"), ["2114100000000000001"]) && same(sets(s.w, "transfer_request_no"), ["LOT-20261028/0007"]) && ops(s.calls) === "CREATE,STATUS",
  [said(s.w), ops(s.calls)]);
  check("  then the request's line, View, Refresh and Cancel", ["tr_section", "tr_btn_view", "tr_btn_refresh", "tr_btn_cancel"].every((m) => shown(s.w).indexOf(m) >= 0) &&
    /Transfer request LOT-20261028\/0007 · Requested$/.test(sets(s.w, "tr_info").slice(-1)[0] || ""), [trShown(s.w), sets(s.w, "tr_info")]);
  s = session(ia({ tr_storage_location_id: "2105223032261218399", tr_location_id: "", tr_required_date: "2026-10-30" }));
  await s.fire("MOUNT", { pageStatus: "Edit", status: "Created" });
  await s.fire("NEW");
  await s.fire("CREATE");
  check("Create without a bin: said, no CREATE", ops(s.calls) === "STATUS" && said(s.w).length === 1 && /^warning: Choose the staging/.test(said(s.w)[0]), said(s.w));
  s = session(ia({ tr_storage_location_id: "2105223032261218399", tr_location_id: "2106278340907413599", tr_required_date: "2026-10-30" }), {
    answer: (p) => (p.operation === "CREATE" ? { data: { code: "409", message: "This Item Assembly has unsaved changes, or someone else saved it: save it (or open it again), then request its materials.",
      result_json: "{}" } } : statusOf(null, "YES")) });
  await s.fire("MOUNT", { pageStatus: "Edit", status: "Created" });
  await s.fire("NEW");
  await s.fire("CREATE");
  check("Create refused (unsaved edits): the server's reason, no link, no re-read", /^error: This Item Assembly has unsaved changes/.test(said(s.w)[0] || "") && sets(s.w, "transfer_request_id").length === 0 &&
    ops(s.calls) === "STATUS,CREATE", [said(s.w), ops(s.calls)]);
  s = session(ia({ tr_storage_location_id: "2105223032261218399", tr_location_id: "2106278340907413599", tr_required_date: "2026-10-30" }), { answer: creating({ data: { code: "200",
    message: "This Item Assembly already has transfer request LOT-10 (Requested).", result_json: JSON.stringify({ request: req({ no: "LOT-10" }), existing: "YES" }) } }) });
  await s.fire("MOUNT", { pageStatus: "Edit", status: "Created" });
  await s.fire("NEW");
  await s.fire("CREATE");
  check("Create when one exists: told, linked, shown", /already has transfer request LOT-10/.test(said(s.w)[0] || "") && same(sets(s.w, "transfer_request_no"), ["LOT-10"]) &&
    shown(s.w).indexOf("tr_btn_view") >= 0, said(s.w));

  // ---- mount, a linked request
  const mountWith = async (r, page, st, canCreate, values) => {
    const x = session(ia(Object.assign({ transfer_request_id: "2114100000000000001", item_assembly_status: st }, values || {})), { answer: () => statusOf(r, canCreate), setup: [] });
    await x.fire("MOUNT", { pageStatus: page, status: st });
    return x;
  };
  const trBtns = (w) => trShown(w).filter((m) => m !== "tr_section");
  s = await mountWith(req(), "Edit", "Created");
  check("mount, a Created IA's Requested request (the setup not read: it has a link): STATUS once, its line, View, Refresh, Cancel", ops(s.calls) === "STATUS" &&
    s.calls[0].ia_id === "4001" && same(trBtns(s.w).sort(), ["tr_btn_cancel", "tr_btn_refresh", "tr_btn_view"]), trShown(s.w));
  s = await mountWith(req({ stale: "YES" }), "Edit", "Created");
  check("mount, a stale request: its line says refresh it", /reservation changed since it was made: refresh it$/.test(sets(s.w, "tr_info").slice(-1)[0] || ""), sets(s.w, "tr_info"));
  s = await mountWith(req(), "Edit", "Draft");
  check("mount, an IA saved as Draft since its request: View, Refresh, Cancel", same(trBtns(s.w).sort(), ["tr_btn_cancel", "tr_btn_refresh", "tr_btn_view"]), trShown(s.w));
  s = await mountWith(req(), "View", "Created");
  check("mount, viewed: View only", same(trBtns(s.w), ["tr_btn_view"]), trShown(s.w));
  s = await mountWith(req({ status: "In Progress" }), "Edit", "Created");
  check("mount, a dispatched request: View only, said in transit, the IA can't change", same(trBtns(s.w), ["tr_btn_view"]) &&
    sets(s.w, "tr_info").slice(-1)[0] === "In transit (LOT-20261028/0007): this Item Assembly can't be changed until the request is received.", [trShown(s.w), sets(s.w, "tr_info")]);
  s = await mountWith(req({ status: "Completed" }), "Edit", "Created");
  check("mount, a received request: View and Report Defect, said reserved at the staging bin", same(trBtns(s.w).sort(), ["tr_btn_defect", "tr_btn_view"]) &&
    sets(s.w, "tr_info").slice(-1)[0] === "Transfer request LOT-20261028/0007 received: its materials are reserved for this Item Assembly at the staging bin.", [trShown(s.w), sets(s.w, "tr_info")]);
  s = await mountWith(req({ status: "Completed" }), "Edit", "Draft");
  check("mount, a received request on an IA saved as Draft: View only (only a Created IA reports a defect or replaces)", same(trBtns(s.w), ["tr_btn_view"]), trShown(s.w));
  s = await mountWith(req({ status: "Cancelled" }), "Edit", "Created", "YES");
  check("mount, only a cancelled request: Request Materials only (the offer on its click)", same(trShown(s.w), ["tr_btn_new"]), trShown(s.w));
  s = session(ia({ transfer_request_id: "2114100000000000001" }), { answer: () => ({ data: { code: "400", message: "You are not assigned to this Item Assembly's organisation.", result_json: "{}" } }) });
  await s.fire("MOUNT", { pageStatus: "Edit", status: "Created" });
  check("mount, a linked request whose status fails: nothing offered", trShown(s.w).length === 0, trShown(s.w));

  // ---- View / Refresh / Cancel / the staging storage location
  s = await mountWith(req(), "Edit", "Created");
  s.w.trace.length = 0;
  await s.fire("VIEW");
  const v1 = s.w.trace.filter((t) => /toView$/.test(t[0])).map((t) => t[1]);
  check("View, a Requested request: its form read-only, on the right (rtl, as every form: the user 10-28)", v1.length === 1 && v1[0].target === LOT_FORM && v1[0].type === "view" &&
    v1[0].viewMode === "disabled" && v1[0].position === "rtl" && v1[0].data.id === "2114100000000000001", v1);
  s = await mountWith(req({ status: "In Progress" }), "Edit", "Created");
  await s.fire("VIEW");
  const v2 = s.w.trace.filter((t) => /toView$/.test(t[0])).map((t) => t[1]);
  check("View, a dispatched request: editable (Receive is on its form), on the right", v2.length === 1 && v2[0].type === "edit" && !("viewMode" in v2[0]) && v2[0].position === "rtl", v2);
  let calls = [];
  s = session(ia({ transfer_request_id: "2114100000000000001" }), { answer: (p) => {
    calls.push(p);
    return p.operation === "REFRESH" ? { data: { code: "200", message: "Transfer request LOT-20261028/0007 refreshed: its picks were cleared.", result_json: JSON.stringify({ request: req({ rev: 2 }) }) } }
      : statusOf(req({ rev: 2 }));
  } });
  await s.fire("MOUNT", { pageStatus: "Edit", status: "Created" });
  await s.fire("REFRESH");
  const rf = calls.find((p) => p.operation === "REFRESH") || {};
  check("Refresh: confirmed, REFRESH with the request and the IA as shown", s.w.trace.some((t) => /\$confirm$/.test(t[0]) && t[1] === "Refresh transfer request") && rf.lot_id === "2114100000000000001" &&
    rf.expected_fp === R.iatrIaFp(R.iatrBasis({ plant: F.PLANT, item_id: "P1", item_qty: 2, planned_output_qty: null, bom_consumption_mode: "", source_bom_id: "" }), lines()) &&
    /^[A-Za-z0-9|:_.-]{8,128}$/.test(rf.idempotency_key || ""), rf);
  check("  its answer said, the section re-read", /refreshed/.test(said(s.w)[0] || "") && calls.slice(-1)[0].operation === "STATUS", said(s.w));
  calls = [];
  s = session(ia({ transfer_request_id: "2114100000000000001" }), { confirm: () => "cancel", answer: (p) => {
    calls.push(p);
    return statusOf(req());
  } });
  await s.fire("MOUNT", { pageStatus: "Edit", status: "Created" });
  await s.fire("REFRESH");
  await s.fire("CANCEL");
  check("Refresh / Cancel not confirmed: no call", ops(calls) === "STATUS", ops(calls));
  calls = [];
  s = session(ia({ transfer_request_id: "2114100000000000001" }), { answer: (p) => {
    calls.push(p);
    return p.operation === "CANCEL" ? { data: { code: "200", message: "Transfer request LOT-20261028/0007 cancelled.", result_json: JSON.stringify({ request: req({ status: "Cancelled" }) }) } }
      : statusOf(calls.some((q) => q.operation === "CANCEL") ? req({ status: "Cancelled" }) : req(), calls.some((q) => q.operation === "CANCEL") ? "YES" : "NO");
  } });
  await s.fire("MOUNT", { pageStatus: "Edit", status: "Created" });
  s.w.trace.length = 0;
  await s.fire("CANCEL");
  const cx = calls.find((p) => p.operation === "CANCEL") || {};
  check("Cancel: CANCEL for the request, no fingerprint", cx.lot_id === "2114100000000000001" && cx.ia_id === "4001" && !("expected_fp" in cx), cx);
  check("  then Request Materials again", /cancelled/.test(said(s.w)[0] || "") && same(trShown(s.w), ["tr_btn_new"]), [said(s.w), trShown(s.w)]);
  s = session(ia());
  await s.fire("STORAGE");
  check("the staging storage location changed: the staging bin cleared", same(sets(s.w, "tr_location_id"), [""]));
  // ---- RELOAD (the user, 10-29): the request's form closed after a save opened from View Transfer Request - only the request section
  // is drawn again from STATUS (the Location Transfer form no longer refreshes this form: that dropped its badge and buttons)
  const done = session(ia({ transfer_request_id: "2114100000000000001", transfer_request_no: "LOT-20261028/0007" }), { answer: () => statusOf(req({ status: "Completed" })) });
  await done.fire("MOUNT", { pageStatus: "Edit", status: "Created" });
  done.w.trace.length = 0;
  done.calls.length = 0;
  await done.fire("RELOAD");
  check("RELOAD after a receipt: one STATUS, the line says received, View shown", ops(done.calls) === "STATUS" &&
    /received: its materials are reserved for this Item Assembly at the staging bin/.test(sets(done.w, "tr_info").slice(-1)[0] || "") && trShown(done.w).indexOf("tr_btn_view") >= 0,
  [done.calls, sets(done.w, "tr_info"), trShown(done.w)]);
  check("  nothing else on the form touched: only the request's widgets shown or hidden, no other write",
    shown(done.w).every((m) => m.indexOf("tr_") === 0) && done.w.trace.filter((x) => /setData$/.test(x[0])).every((x) => Object.keys(x[1]).every((k) => k.indexOf("tr_") === 0)),
  done.w.trace.filter((x) => /display$|setData$/.test(x[0])));
  // B21 retired (Task 9): the receipt moves the IA's picks to the staging bin (D3), so the form never picks from it by itself
  const staging = (w) => w.trace.filter((x) => /triggerEvent$/.test(x[0]) && x[1] === "sc_main" && x[2] && (x[2].scOp === "STAGING" || x[2].scOp === "GAP"));
  for (const [label, st, page, iaSt] of [["received, an editable Created IA", "Completed", "Edit", "Created"], ["received, a Draft", "Completed", "Edit", "Draft"],
    ["Requested", "Requested", "Edit", "Created"], ["dispatched", "In Progress", "Edit", "Created"], ["received, viewed", "Completed", "View", "Created"]]) {
    const x = session(ia({ item_assembly_status: iaSt, transfer_request_id: "2114100000000000001", transfer_request_no: "LOT-20261028/0007" }),
      { answer: () => statusOf(req({ status: st, sl: "2105223032261218399", bin: "2106278340907413599" })) });
    await x.fire("MOUNT", { pageStatus: page, status: iaSt });
    check("mount, a request " + label + ": no pick by the form", staging(x.w).length === 0, staging(x.w));
  }
  let phase = "In Progress";
  const back = session(ia({ transfer_request_id: "2114100000000000001", transfer_request_no: "LOT-20261028/0007" }),
    { answer: () => statusOf(req({ status: phase, sl: "2105223032261218399", bin: "2106278340907413599" })) });
  await back.fire("MOUNT", { pageStatus: "Edit", status: "Created" });
  phase = "Completed";
  await back.fire("RELOAD");
  check("RELOAD after Receive, nothing missing: no pick by the form, no offer", staging(back.w).length === 0 && !back.w.trace.some((t) => /\$confirm$/.test(t[0])) &&
    trShown(back.w).indexOf("tr_btn_defect") >= 0, [staging(back.w), trShown(back.w)]);
  const none = session(ia());
  await none.fire("MOUNT", { pageStatus: "Edit", status: "Created" });
  none.calls.length = 0;
  await none.fire("RELOAD");
  check("RELOAD on an IA without a request: no call", none.calls.length === 0);
  H.done("test_tr_form");
})();

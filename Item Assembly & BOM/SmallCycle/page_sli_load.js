// sli_load - SO Linked IAs page (Small Cycle, scratchpad/iasc/CONTRACT.md section 10): one Sales Order line's figures, one per row
// (the line, its customer, item, ordered and delivered; planned, produced and in progress in its linked IAs; the suggested
// quantity with its sum), its warnings, its IAs and the SO's IAs whose line was removed. A failed read shows "unavailable", never a zero. Run by mounted (with the row action's sc_action), refresh and Refresh; Create IA opens the IA form only on
// an eligible line.
const SC_WF_PROJECTION = "2112448183267332097"; // SO_IA_PROJECTION
const SC_IA_FORM = "2098256587713404929";
const scArgs = arguments[0] || {};
const scS = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const scQ8 = (v) => Number((parseFloat(v) || 0).toFixed(8));
const scParseJ = (v) => {
  if (v && typeof v === "object") return v;
  const t = scS(v);
  if (!t) return null;
  try {
    return JSON.parse(t.replace(/"(?:[^"\\]|\\.)*"|(^\s*|[:\[,]\s*)(-?\d{16,})(?=\s*(?:[,\]}]|$))/g, (m, pre, num) => (num === undefined ? m : pre + '"' + num + '"')));
  } catch (e) {
    return null;
  }
};
const scP = (k) => scS(this.getParamsVariables(k));
const scRun = (id, params) =>
  new Promise((resolve, reject) => {
    const p = this.runWorkflow(id, params, (res) => resolve(res), (err) => reject(err));
    if (p && typeof p.then === "function") p.then((res) => resolve(res), (err) => reject(err));
  });
const scNames = async (collection, ids, field) => {
  const want = ids.filter((id, i, all) => scS(id) && all.indexOf(id) === i);
  const out = {};
  if (!want.length) return out;
  try {
    const res = await db.collection(collection).field(field)
      .filter([{ type: "branch", operator: "all", children: [{ prop: "id", operator: "in", value: want }, { prop: "is_deleted", operator: "equal", value: 0 }] }])
      .limit(want.length).get();
    ((res && res.data) || []).forEach((x) => (out[scS(x.id)] = scS(x[field])));
  } catch (e) {
    console.error("SO Linked IAs: names could not be read", e);
  }
  return out;
};
const ROLE = { produced: "Produced", open: "Open", excluded: "Excluded", none: "Not counted" };
const MODE = { STANDARD: "Standard", FLAT: "Flat" };
// a Created IA (RES-01, BA 10-22) is open production like a Draft (review 3)
const OPEN_ST = { Draft: 1, Created: 1, Processing: 1 };
const DONE_ST = { Completed: 1, "Fully Posted": 1 };
// the summary: one fact per row (the line left, the production right, the warnings below); a row without a fact is hidden
const SUMMARY = ["sli_summary_so", "sli_summary_customer", "sli_summary_item", "sli_summary_ordered", "sli_summary_delivered", "sli_summary_planned", "sli_summary_produced",
  "sli_summary_open", "sli_summary_suggest", "sli_summary_warn"];
const scRows = (row) => SUMMARY.reduce((data, m) => Object.assign(data, { [m]: row[m] || "" }), {});
const scShowRows = (row) => {
  const on = SUMMARY.filter((m) => row[m]);
  const off = SUMMARY.filter((m) => !row[m]);
  if (on.length) this.display(on);
  if (off.length) this.hide(off);
};

(async () => {
  try {
    const params = { operation: "SUMMARY", so_id: scP("so_id"), so_line_id: scP("so_line_id"), item_id: scP("item_id"), exclude_ia_id: "", organization_id: scP("organization_id"),
      proposal_qty: "", proposal_uom_id: "", baseline: "" };
    let r = null;
    // a refusal (400, e.g. the user is not assigned to the organisation: FIX-03) is shown with its reason
    let refused = "";
    try {
      const res = await scRun(SC_WF_PROJECTION, params);
      const d = (res && res.data) || {};
      r = scS(d.code) === "200" ? scParseJ(d.result_json) : null;
      if (scS(d.code) === "400") refused = scS(d.message);
    } catch (e) {
      console.error("SO Linked IAs: SUMMARY failed", e);
    }
    if (!r || !r.totals) {
      const down = { sli_summary_so: refused || "figures unavailable right now: press Refresh to try again" };
      await this.setData(Object.assign(scRows(down), { sli_ias: [], sli_orphans: [] }));
      scShowRows(down);
      this.hide(["sli_btn_create", "sli_orphans"]);
      return;
    }
    const h = r.header || {};
    const l = r.line || {};
    const orphans = Array.isArray(r.orphans) ? r.orphans : [];
    const uoms = await scNames("unit_of_measurement", [r.uomId].concat((r.ias || []).map((x) => x.uomId), orphans.map((x) => x.item_uom)), "uom_name");
    const item = (await scNames("item", [scP("item_id")], "material_name"))[scP("item_id")] || scP("item_id");
    const u = (id) => uoms[scS(id)] || scS(id);
    const swap = (text) => Object.keys(uoms).reduce((t, id) => (uoms[id] ? t.split(id).join(uoms[id]) : t), scS(text));
    const t = r.totals;
    const lineQty = (n) => scQ8(n) + (uoms[scS(r.uomId)] ? " " + uoms[scS(r.uomId)] : "");
    const active = !!r.header && !!r.line && Number(h.is_deleted) !== 1 && Number(l.is_deleted) !== 1 && (scS(h.so_status) === "Issued" || scS(h.so_status) === "Processing") &&
      scS(l.line_status) !== "Completed" && scS(l.line_status) !== "Cancelled";
    // the suggestion takes off the larger of delivered and produced
    const done = scQ8(t.delivered) > scQ8(t.produced) ? scQ8(t.delivered) + " delivered" : scQ8(t.produced) + " produced";
    const row = {
      sli_summary_so: (scS(h.so_no) || "Sales Order") + (scS(l.line_index) ? " · line " + scS(l.line_index) : ""),
      sli_summary_customer: scS(h.customer_name),
      sli_summary_item: item,
      sli_summary_ordered: lineQty(t.ordered),
      sli_summary_delivered: lineQty(t.delivered),
      sli_summary_planned: lineQty(t.planned) + " in this line's IAs",
      sli_summary_produced: lineQty(t.produced),
      sli_summary_open: lineQty(t.open) + " in open IAs",
      // a delivery may have come from the linked production: nothing records which, so no figure (FIX-01)
      sli_summary_suggest: t.unavailable === "OVERLAP" ? "Unavailable: nothing records whether the " + lineQty(t.delivered) + " delivered came from the " + lineQty(t.produced) + " produced"
        : t.suggestion === null || t.complete === false ? "Unavailable: a unit conversion is missing"
        : !active ? lineQty(0) + ": the line has no remaining demand"
        : lineQty(t.suggestion) + " = " + scQ8(t.ordered) + " ordered \u2212 " + done + " \u2212 " + scQ8(t.open) + " in progress",
    };
    const warnings = r.warnings || [];
    if (warnings.length) row.sli_summary_warn = warnings.map((w) => "\u26a0 " + swap(w.text)).join("   ");
    // UI-01: an open IA's quantity is still to be received, a completed one's received; an IA the figures do not count shows neither
    const rows = (r.ias || []).map((x) => ({ ia_no: scS(x.no), status: scS(x.status), mode: MODE[scS(x.mode)] || "", planned: scQ8(x.planned),
      to_receive: scS(x.role) === "open" ? scQ8(x.itemQty) : null, actual: scS(x.role) === "produced" ? scQ8(x.itemQty) : null, uom: u(x.uomId),
      counted: ROLE[scS(x.role)] || "Not counted", ia_id: scS(x.id) }));
    const lost = orphans.map((x) => ({ ia_no: scS(x.no), status: scS(x.status), mode: MODE[scS(x.mode)] || "", planned: scQ8(scS(x.planned_output_qty) ? x.planned_output_qty : x.item_qty),
      to_receive: OPEN_ST[scS(x.status)] ? scQ8(x.item_qty) : null, actual: DONE_ST[scS(x.status)] ? scQ8(x.item_qty) : null, uom: u(x.item_uom), counted: "Line removed",
      ia_id: scS(x.id) }));
    await this.setData(Object.assign(scRows(row), { sli_ias: rows, sli_orphans: lost }));
    scShowRows(row);
    if (lost.length) this.display(["sli_orphans"]);
    else this.hide(["sli_orphans"]);
    if (r.eligibleNew) this.display(["sli_btn_create"]);
    else this.hide(["sli_btn_create"]);
    if (scS(scArgs.action) !== "create") return;
    if (!r.eligibleNew) {
      this.$message.warning(scS(r.reason) || "No Item Assembly can be created for this line.");
      return;
    }
    this.toView({ target: SC_IA_FORM, type: "add", mode: "dialog", title: "Add Item Assembly", width: "80%",
      data: { item_id: scP("item_id"), source_so_id: scS(h.id) || scP("so_id"), source_so_line_id: scS(l.id) || scP("so_line_id"), bom_consumption_mode: "STANDARD" },
      params: { sc_entry: "1" } });
  } catch (error) {
    console.error("SO Linked IAs error:", error);
    this.$message.error((error && error.message) || "The Item Assemblies could not be shown");
  }
})();

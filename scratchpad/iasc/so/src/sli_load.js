// sli_load - SO Linked IAs page (Small Cycle, scratchpad/iasc/CONTRACT.md section 10): one Sales Order line's figures, one per row
// (the line, its customer, item, ordered and delivered; planned, produced and in progress in its linked IAs; the suggested
// quantity with its sum), its warnings, its IAs and the SO's IAs whose line was removed. A failed read shows "unavailable", never a zero. Run by mounted (with the row action's sc_action), refresh and Refresh; Create IA opens the IA form only on
// an eligible line.
const SC_WF_PROJECTION = "__SO_IA_PROJECTION__"; // SO_IA_PROJECTION
const SC_IA_FORM = "__IA_FORM_TABLE__";
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
// an active BOM of the item in the organisation (the IA form's own rule: BOMs are per organisation): true / false; null = the read failed
const scHasBom = async (itemId, org) => {
  try {
    const res = await db.collection("bill_of_materials").field("id")
      .filter([{ type: "branch", operator: "all", children: [{ prop: "parent_material_code", operator: "equal", value: itemId },
        { prop: "organization_id", operator: "equal", value: org }, { prop: "is_active", operator: "equal", value: 1 }, { prop: "is_deleted", operator: "equal", value: 0 }] }])
      .limit(1).get();
    return ((res && res.data) || []).length > 0;
  } catch (e) {
    console.error("SO Linked IAs: the item's BOMs could not be read", e);
    return null;
  }
};
// the Sales Order's own plant; "" = an organisation-level SO (its plant is the organisation, or none); null = the read failed
const scSoPlant = async (soId, org) => {
  try {
    const res = await db.collection("sales_order").field("plant_name").where({ id: soId }).get();
    const row = ((res && res.data) || [])[0] || {};
    const p = scS(row.plant_name);
    return /^[0-9]{1,20}$/.test(p) && p !== scS(org) ? p : "";
  } catch (e) {
    console.error("SO Linked IAs: the Sales Order's plant could not be read", e);
    return null;
  }
};
// a plant-level login's own plant, "" for an organisation-level login (the IA form's and Convert to GD's rule)
const scLoginPlant = () => {
  const parent = scS(this.getVarGlobal("deptParentId"));
  const p = scS(this.getVarSystem("deptIds")).split(",")[0].trim();
  return parent && parent !== "0" && /^[0-9]{1,20}$/.test(p) ? p : "";
};
// the figure tiles (the user, 10-29): one html card on top - the line, its customer and item, the six figures, the sum under them, the
// warnings in a strip; inline styles only, every text escaped
const scEsc = (v) => scS(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const scCard = (body) => '<div style="font-size:13px;color:#1F2937;line-height:1.45;margin-bottom:12px">' + body + "</div>";
const scMessage = (text) => scCard('<div style="padding:10px 12px;border:1px solid #E5E7EB;border-radius:6px;background:#F9FAFB;color:#6B7280">' + scEsc(text) + "</div>");
const scTile = (label, value, key) => '<div style="flex:1 1 110px;min-width:110px;padding:8px 12px;border-radius:6px;border:1px solid ' + (key ? "#335B57" : "#E5E7EB") +
  ";background:" + (key ? "#EEF4F3" : "#FAFAFA") + '"><div style="font-size:12px;color:#6B7280">' + label + '</div><div style="font-size:18px;font-weight:600;color:' +
  (key ? "#335B57" : "#111827") + '">' + scEsc(value) + "</div></div>";
const scTiles = (x) => {
  const t = x.t;
  const plan = t.unavailable === "OVERLAP" ? ["—", "Unavailable: nothing records whether the " + x.lineQty(t.delivered) + " delivered came from the " + x.lineQty(t.produced) + " produced"]
    : t.suggestion === null || t.complete === false ? ["—", "Unavailable: a unit conversion is missing"]
    : !x.active ? [x.lineQty(0), "the line has no remaining demand"]
    : [x.lineQty(t.suggestion), "To Plan = " + scQ8(t.ordered) + " ordered − " + x.done + " − " + scQ8(t.open) + " in progress"];
  const sub = [scS(x.h.customer_name), scS(x.item)].filter((s) => s).join(" · ");
  const tiles = [["Ordered", x.lineQty(t.ordered)], ["Delivered", x.lineQty(t.delivered)], ["Planned", x.lineQty(t.planned)], ["Produced", x.lineQty(t.produced)],
    ["In Progress", x.lineQty(t.open)]].map((p) => scTile(p[0], p[1], false)).join("") + scTile("To Plan", plan[0], true);
  const warn = x.warnings.length ? '<div style="margin-top:10px;padding:8px 12px;border:1px solid #FFD591;border-radius:6px;background:#FFF7E6;color:#AD6800">' +
    x.warnings.map((w) => "<div>⚠ " + scEsc(w) + "</div>").join("") + "</div>" : "";
  return scCard('<div style="font-size:20px;font-weight:600;color:#111827">' + scEsc((scS(x.h.so_no) || "Sales Order") + (scS(x.l.line_index) ? " · line " + scS(x.l.line_index) : "")) +
    "</div>" + (sub ? '<div style="color:#4B5563;margin-top:2px">' + scEsc(sub) + "</div>" : "") + '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">' + tiles +
    '</div><div style="font-size:12px;color:#6B7280;margin-top:6px">' + scEsc(plan[1]) + "</div>" + warn);
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
      await this.setData({ sli_summary_html: scMessage(down.sli_summary_so) }); // the tiles (10-29)
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
    await this.setData({ sli_summary_html: scTiles({ h: h, l: l, t: t, item: item, lineQty: lineQty, active: active, done: done, warnings: warnings.map((w) => swap(w.text)) }) }); // the tiles (10-29)
    scShowRows(row);
    if (lost.length) this.display(["sli_orphans"]);
    else this.hide(["sli_orphans"]);
    // only an item with an active BOM in the Sales Order's organisation can be assembled (the user, 10-28)
    const org = scS(h.organization_id) || scP("organization_id");
    const bom = r.eligibleNew ? await scHasBom(scP("item_id"), org) : null;
    if (r.eligibleNew && bom === true) this.display(["sli_btn_create"]);
    else this.hide(["sli_btn_create"]);
    if (scS(scArgs.action) !== "create") return;
    if (!r.eligibleNew) {
      this.$message.warning(scS(r.reason) || "No Item Assembly can be created for this line.");
      return;
    }
    if (bom === null) {
      this.$message.error("The item's BOMs could not be read: press Refresh and try again.");
      return;
    }
    if (!bom) {
      this.$message.warning(item + " has no active BOM, so an Item Assembly can't be made for it.");
      return;
    }
    // the plant (the user, 10-28: as SO -> GD): a plant-level login's own, else the one chosen in Select Plant, else the Sales Order's
    // own; an organisation-level SO asks
    let plant = scLoginPlant() || scS(scArgs.plant);
    if (!plant) {
      const own = await scSoPlant(scS(h.id) || scP("so_id"), org);
      if (own === null) {
        this.$message.error("The Sales Order's plant could not be read: press Refresh and try again.");
        return;
      }
      if (!own) {
        await this.setData({ "sli_plant_dialog.sli_plant_id": "" });
        this.openDialog("sli_plant_dialog");
        return;
      }
      plant = own;
    }
    // on the right, as every form opens (the user, 10-28)
    this.toView({ target: SC_IA_FORM, type: "add", mode: "dialog", position: "rtl", title: "Add Item Assembly", width: "80%",
      data: { item_id: scP("item_id"), source_so_id: scS(h.id) || scP("so_id"), source_so_line_id: scS(l.id) || scP("so_line_id"), bom_consumption_mode: "STANDARD",
        issuing_operation_faci: plant },
      params: { sc_entry: "1" } });
  } catch (error) {
    console.error("SO Linked IAs error:", error);
    this.$message.error((error && error.message) || "The Item Assemblies could not be shown");
  }
})();

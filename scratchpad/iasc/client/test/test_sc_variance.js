// Small Cycle client, the BOM-variance check of the four completion handlers on an enhanced IA: compared with its snapshot at
// item_qty, never the latest BOM (Changed / Added / Removed listed, Cancel stops the save, Complete goes on); a Flat line of
// an expanded sub-assembly and references out of step with item_qty stop it; a linked IA lists the Sales Order warnings now
// (units by name) or says the figures are unavailable - never blocking; nothing to show = no dialog. SC_ENABLED false = the
// v36 check. The IA V2 handler (60 picks) takes the same branch before IA_V2_SUBMIT.
//   node scratchpad/iasc/client/test/test_sc_variance.js
const path = require("path");
const H = require("./harness");
const F = require("./fixture");
const { session } = require("./session");
const B = require(path.join(H.IASC, "code/shared/sc_bom.js"));
const { check, same } = H;
const IA_SAVE = "2098335576774463489";
const IA_V2_SUBMIT = "2112141238600376321";
const PROJ = H.SC_TEST_IDS.SO_IA_PROJECTION;

// a snapshot straight from the resolver over the fixture tables, and the lines it gives (keyed, total = reference)
const prepared = async (o) => {
  const t = o.tables || F.tables();
  const io = {
    readBoms: async (ids) => t.bill_of_materials.filter((b) => ids.indexOf(b.parent_material_code) >= 0),
    readItems: async (ids) => t.item.filter((i) => ids.indexOf(i.id) >= 0),
  };
  const r = await B.scResolve({ mode: o.mode, itemId: o.item || "P1", itemUomId: F.EA, outputQty: o.qty, expand: o.expand || [], fg: t.item.find((i) => i.id === (o.item || "P1")),
    preparedAt: "2026-10-20T00:00:00.000Z", preparedBy: "tester" }, io);
  if (!r.ok) throw new Error(r.message);
  const lines = r.rows.map((x) => ({ item_selection: x.item_selection, item_name: x.item_name, quantity_uom: x.quantity_uom, requested_qty: x.requested_qty, total_quantity: x.requested_qty,
    sc_ref_key: x.key, temp_qty_data: "", temp_hu_data: "" }));
  return F.header(Object.assign({ item_id: o.item || "P1", item_qty: o.qty, bom_consumption_mode: o.mode, bom_snapshot_json: JSON.stringify(r.snapshot), source_bom_id: r.snapshot.root.bomId,
    stock_movement: lines }, o.header || {}));
};
const click = async (values, name, o) => {
  const s = session(values, o);
  await s.fire(name || "onClick_saveAsCompleted");
  return s;
};
const saved = (s) => s.wf(IA_SAVE).length;
const asked = (s, title) => s.calls("$confirm").filter((t) => !title || t[1] === title);

(async () => {
  const flat = await prepared({ mode: "FLAT", qty: 5, expand: ["C1"] });
  const linkedStd = await prepared({ mode: "STANDARD", qty: 10, header: { source_so_id: "9001", source_so_line_id: "8001",
    source_so_context_json: JSON.stringify({ v: 1, orderedQty: "100", uomId: F.EA, history: [] }) } });
  // ---- V1: lines = the snapshot: no dialog, saved; the latest BOM is not read for the check
  for (const name of ["onClick_saveAsCompleted", "onClick_saveAsCompletedPost"]) {
    const s = await click(flat, name);
    check("V1 " + name + ": Flat lines = the snapshot: no question, IA_SAVE runs with the snapshot", asked(s).length === 0 && saved(s) === 1 && s.wf(IA_SAVE)[0][2].allData.bom_snapshot_json === flat.bom_snapshot_json);
    check("V1 " + name + ": no BOM read for the check", s.reads("bill_of_materials").length === 0);
  }
  // ---- V2 / V3: differences
  {
    const v = H.clone(flat);
    v.stock_movement[1].total_quantity = 21;
    const s = await click(v, "onClick_saveAsCompleted", { confirms: { "Components Differ From The Prepared BOM": "cancel" } });
    const q = asked(s, "Components Differ From The Prepared BOM");
    check("V2: a changed line listed against the reference (Screw 20 -> 21); Cancel stops the save", q.length === 1 && /Changed: SC-SCREW 20 → 21/.test(q[0][2]) && /Flat, V1, for 5/.test(q[0][2]) && saved(s) === 0, q.map((t) => t[2]));
    const ok = await click(v, "onClick_saveAsCompleted");
    check("V2: Complete goes on", saved(ok) === 1);
  }
  {
    const v = H.clone(flat);
    v.stock_movement.splice(2, 1);
    v.stock_movement.push({ item_selection: "C2", item_name: "extra screw", quantity_uom: F.EA, requested_qty: 0, total_quantity: 5, sc_ref_key: "", temp_qty_data: "", temp_hu_data: "" });
    const s = await click(v);
    const q = asked(s);
    check("V3: a manual line = Added, a snapshot row without a line = Removed", q.length === 1 && /Added: extra screw \(5\)/.test(q[0][2]) && /Removed: SC-LAB/.test(q[0][2]), q.map((t) => t[2]));
  }
  // ---- V4 / V5: refused before saving
  {
    const v = H.clone(flat);
    v.stock_movement.push({ item_selection: "C1", item_name: "SC-FRAME", quantity_uom: F.EA, requested_qty: 0, total_quantity: 3, sc_ref_key: "", temp_qty_data: "", temp_hu_data: "" });
    const s = await click(v);
    check("V4: a Flat line of the expanded Frame: refused, not saved", s.calls("$alert").some((t) => /SC-FRAME is expanded/.test(t[1]) && t[2] === "Cannot Complete") && saved(s) === 0 && asked(s).length === 0);
  }
  {
    const v = H.clone(flat);
    v.stock_movement[0].requested_qty = 31;
    const s = await click(v);
    check("V5: a reference out of step with item_qty (Panel 31 for 5): refused, not saved", s.calls("$alert").some((t) => /SC-PANEL/.test(t[1]) && /quantity 5/.test(t[1])) && saved(s) === 0);
  }
  // ---- V6 / V7 / V8: the Sales Order warnings
  {
    const v = H.clone(linkedStd);
    v.source_so_context_json = JSON.stringify({ v: 1, orderedQty: "120", uomId: F.EA, history: [] });
    const s = await click(v);
    const q = asked(s, "Check Before Completing");
    const sum = s.wf(PROJ).filter((t) => t[2].operation === "SUMMARY");
    check("V6: a reduced line: listed with its unit by name, never blocking", q.length === 1 && /reduced from 120 to 100 EA/.test(q[0][2]) && saved(s) === 1, q.map((t) => t[2]));
    check("V6: SUMMARY for the Add page: no exclusion, proposal = item_qty", sum.length === 1 && sum[0][2].exclude_ia_id === "" && sum[0][2].proposal_qty === "10.00000000");
    const e = await click(Object.assign(H.clone(v), { page_status: "Edit", id: "4001" }));
    check("V6: on Edit, SUMMARY excludes this IA", e.wf(PROJ).some((t) => t[2].operation === "SUMMARY" && t[2].exclude_ia_id === "4001"));
  }
  {
    const s = await click(linkedStd, "onClick_saveAsCompleted", { projectionDown: true });
    const q = asked(s, "Check Before Completing");
    check("V7: the figures unavailable: said, Complete goes on", q.length === 1 && /figures are unavailable/.test(q[0][2]) && saved(s) === 1);
    const c = await click(linkedStd, "onClick_saveAsCompleted", { projectionDown: true, confirms: { "Check Before Completing": "cancel" } });
    check("V7: Cancel stops the save", saved(c) === 0);
  }
  {
    const s = await click(linkedStd);
    check("V8: linked, no difference, no warning: no question, saved", asked(s).length === 0 && saved(s) === 1);
  }
  // ---- V9: the IA V2 handler (60 picks) takes the same branch before IA_V2_SUBMIT
  {
    const tables = F.tables({ boms: [F.bom("B5", "P5", 1, [F.row("C2", 1)])] });
    tables.item.push(F.item("P5", "SIXTY"));
    const v = await prepared({ mode: "STANDARD", qty: 60, item: "P5", tables: tables });
    const pk = [];
    for (let i = 0; i < 60; i++) pk.push({ material_id: "C2", location_id: "L0", balance_id: "BL2", sm_quantity: 1, category: "Unrestricted" });
    v.stock_movement[0].temp_qty_data = JSON.stringify(pk);
    for (const name of ["iaV2_onClick_completed", "iaV2_onClick_completed_post"]) {
      const s = await click(v, name, { tables: tables });
      const changed = H.clone(v);
      changed.stock_movement[0].total_quantity = 59;
      const c = await click(changed, name, { tables: tables, confirms: { "Components Differ From The Prepared BOM": "cancel" } });
      check("V9 " + name + ": no difference -> IA_V2_SUBMIT, no BOM read; a difference asked, Cancel = no SUBMIT", s.wf(IA_V2_SUBMIT).length === 1 && s.reads("bill_of_materials").length === 0 &&
        asked(c, "Components Differ From The Prepared BOM").length === 1 && c.wf(IA_V2_SUBMIT).length === 0, [s.wf(IA_V2_SUBMIT).length, asked(c).map((t) => t[1])]);
    }
  }
  // ---- V10: SC_ENABLED false: the v36 check (the latest BOM)
  {
    const s = await click(flat, "onClick_saveAsCompleted", { doc: H.scVariant(H.readJSON(H.FILES.formOn), false, H.SC_TEST_IDS), confirms: { "Components Differ From The BOM": "cancel" } });
    check("V10: switched off: the v36 check reads the BOM and lists the Flat lines against it", s.reads("bill_of_materials").length === 1 && asked(s, "Components Differ From The BOM").length === 1 &&
      /Added: SC-PANEL/.test(asked(s)[0][2]) && saved(s) === 0, asked(s).map((t) => t[2]));
  }
  H.done("test_sc_variance");
})();

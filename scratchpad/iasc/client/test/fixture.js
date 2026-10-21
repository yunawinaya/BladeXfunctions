// The Small Cycle client tests' world (contract section 7 example, scaled): SC-BOX (EA; CTN = 12 EA) from BOM V1, base 10 EA:
// 20 SC-FRAME, 40 SC-SCREW, 1 SC-LAB (non-stock), a REF row; SC-FRAME has its own BOM, base 2: 6 SC-PANEL. SO-A line 1 asks 100
// EA of SC-BOX. The projection workflow is answered by the real code/shared/sc_proj.js over these rows.
const path = require("path");
const H = require("./harness");
const P = require(path.join(H.IASC, "code/shared/sc_proj.js"));

const ORG = "1001";
const PLANT = "2002";
const EA = "77";
const CTN = "78";
const item = (id, name, o) => Object.assign({ id: id, material_name: name, material_desc: name + " desc", based_uom: EA, serial_number_management: 0, item_batch_management: 0,
  batch_number_genaration: "", table_uom_conversion: [], table_default_bin: [], stock_control: 1, is_deleted: 0 }, o || {});
const row = (code, qty, o) => Object.assign({ bom_material_code: code, consume_type: "", sub_material_qty: qty, sub_material_qty_uom: EA, sub_material_wastage: 0, sub_material_name: "",
  sub_material_desc: "", sub_material_remark: "", bom_type: "", ref_bom_id: "", is_deleted: 0 }, o || {});
const bom = (id, parent, base, rows, o) => Object.assign({ id: id, parent_material_code: parent, organization_id: ORG, is_deleted: 0, is_active: 1, parent_mat_bom_version: "V1",
  parent_mat_is_default: 1, parent_mat_base_quantity: base, parent_mat_base_uom: EA, subform_sub_material: rows }, o || {});
const balance = (id, material, qty, o) => Object.assign({ id: id, material_id: material, location_id: "L0", storage_location_id: "S1", batch_id: null, plant_id: PLANT, organization_id: ORG,
  unrestricted_qty: qty, balance_quantity: qty, is_deleted: 0, create_time: "2026-01-01 00:00:00" }, o || {});

const tables = (o) => {
  o = o || {};
  const items = [
    item("P1", "SC-BOX", { table_uom_conversion: [{ alt_uom_id: CTN, alt_qty: 1, base_qty: 12 }] }),
    item("C1", "SC-FRAME"), item("C2", "SC-SCREW"), item("C3", "SC-PANEL"), item("N1", "SC-LAB", { stock_control: 0 }), item("S1", "SC-SN", { serial_number_management: 1 }),
    item("P9", "NO-BOM"),
  ];
  const boms = [
    bom("B1", "P1", 10, [row("C1", 20), row("C2", 40), row("N1", 1), row("C3", 5, { consume_type: "REF" })]),
    bom("B2", "C1", 2, [row("C3", 6)]),
  ].concat(o.boms || []);
  return Object.assign({
    bill_of_materials: boms, item: items,
    unit_of_measurement: [{ id: EA, uom_name: "EA", is_deleted: 0 }, { id: CTN, uom_name: "CTN", is_deleted: 0 }],
    item_balance: [balance("BL1", "C1", 100), balance("BL2", "C2", 500), balance("BL3", "C3", 300), balance("BL4", "C1", 50, { location_id: "L1", create_time: "2026-02-01 00:00:00" })],
    item_batch_balance: [], handling_unit_atu7sreg_sub: [], handling_unit: [], on_reserved_gd: [],
    bin_location: [{ id: "L0", bin_location_combine: "A-0", is_deleted: 0, plant_id: PLANT, storage_location_id: "S1", is_default: 1, bin_status: 1 },
      { id: "L1", bin_location_combine: "A-1", is_deleted: 0 }],
    storage_location: [{ id: "S1", plant_id: PLANT, is_deleted: 0, is_default: 1, storage_status: 1, location_type: "Common" }],
    batch: [],
  }, o.extra || {});
};

// the SO side, read by the mocked SO_IA_PROJECTION
const so = (o) => Object.assign({
  header: { id: "9001", so_no: "SO-A", so_status: "Issued", organization_id: ORG, customer_id: "5001", customer_name: "ACME", is_deleted: 0 },
  lines: [{ id: "8001", sales_order_id: "9001", item_name: "P1", so_quantity: "100", so_item_uom: EA, delivered_qty: "0", line_status: "Issued", is_deleted: 0, line_index: "1" }],
  ias: [],
  fg: tables().item[0],
}, o || {});
const answer = (world, ids, extra) => (id, params) => {
  const s = world.so;
  if (id === ids.SO_IA_PROJECTION) {
    if (world.projectionDown) return { reject: new Error("projection down") };
    if (world.projectionRefuse) return { data: { code: "400", message: world.projectionRefuse, result_json: "" } };
    if (params.operation === "CANDIDATES") {
      const rows = s.lines.filter((l) => Number(l.is_deleted) !== 1 && l.item_name === params.item_id).map((l) => ({ line: l, header: s.header }));
      return { data: { code: "200", message: "", result_json: JSON.stringify({ candidates: P.scCandidates({ rows: rows, ias: s.ias, fg: s.fg, iaItemId: params.item_id, iaOrgId: params.organization_id }),
        capped: "NO" }) } };
    }
    const line = s.lines.find((l) => l.id === params.so_line_id) || null;
    const res = P.scProject({ line: line, header: line ? s.header : null, fg: s.fg, ias: s.ias.filter((x) => x.source_so_line_id === params.so_line_id), excludeIaId: params.exclude_ia_id,
      iaItemId: params.item_id, iaOrgId: params.organization_id, proposal: params.proposal_qty ? { qty: params.proposal_qty, uomId: params.proposal_uom_id } : null,
      baseline: P.spParseJ(params.baseline), candidates: line && Number(line.is_deleted) === 1 ? s.lines.filter((l) => Number(l.is_deleted) !== 1 && l.item_name === params.item_id)
        .map((l) => ({ id: l.id, line_index: l.line_index, item_name: l.item_name, so_quantity: l.so_quantity, so_item_uom: l.so_item_uom, delivered_qty: l.delivered_qty, line_status: l.line_status })) : [] });
    res.orphans = [];
    res.line = line;
    res.header = line ? s.header : null;
    return { data: { code: "200", message: "", result_json: JSON.stringify(res) } };
  }
  if (id === ids.IA_SC_RELINK) return world.relinkAnswer || { data: { code: "200", message: "Re-linked to the Sales Order line.", result_json: "{}" } };
  return extra ? extra(id, params) : { data: { code: "200", message: "ok" } };
};

// an Add / Edit header (the 7 Small Cycle keys present and empty, as the ON form has them)
const header = (o) => Object.assign({ page_status: "Add", issuing_operation_faci: PLANT, item_qty: 10, item_uom: EA, project_id: "", organization_id: ORG, item_id: "P1",
  item_name: "SC-BOX", stock_movement: [], source_so_id: "", source_so_line_id: "", source_so_context_json: "", bom_consumption_mode: "", source_bom_id: "",
  bom_snapshot_json: "", planned_output_qty: null, item_assembly_status: "Draft", id: "" }, o || {});

module.exports = { ORG, PLANT, EA, CTN, item, row, bom, balance, tables, so, answer, header, P };

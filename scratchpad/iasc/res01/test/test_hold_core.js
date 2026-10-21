// RES-01: the hold core (res01/code/shared/hold.js): which picks are held, the change against the IA's own holds, the caps by
// free stock, the engine moves, the row states, recovery after a dead run, the coverage label
//   node scratchpad/iasc/res01/test/test_hold_core.js
const path = require("path");
const C = require(path.join(process.env.HD_CODE || path.join(__dirname, "..", "code"), "shared", "hold.js"));

let fails = 0;
let n = 0;
const eq = (label, got, want) => {
  n++;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fails++;
    console.log("FAIL " + label + "\n  got  " + JSON.stringify(got).slice(0, 900) + "\n  want " + JSON.stringify(want).slice(0, 900));
  }
};

const EA = "77";
const CTN = "78";
const items = {
  C1: { id: "C1", stock_control: 1, serial_number_management: 0, based_uom: EA, table_uom_conversion: [{ alt_uom_id: CTN, base_qty: 12, alt_qty: 1, base_uom_id: EA }] },
  C2: { id: "C2", stock_control: 1, serial_number_management: 0, based_uom: EA, table_uom_conversion: [] },
  SN: { id: "SN", stock_control: 1, serial_number_management: 1, based_uom: EA, table_uom_conversion: [] },
  NS: { id: "NS", stock_control: 0, serial_number_management: 0, based_uom: EA, table_uom_conversion: [] },
};
const pick = (bin, qty, extra) => Object.assign({ material_id: "", location_id: bin, batch_id: null, sm_quantity: qty, category: "Unrestricted" }, extra || {});
const line = (id, item, uom, picks, extra) => Object.assign({ id: id, item_selection: item, quantity_uom: uom, total_quantity: picks.reduce((s, p) => s + p.sm_quantity, 0),
  required_qty: null, requested_qty: 0, temp_qty_data: JSON.stringify(picks.map((p) => Object.assign({}, p, { material_id: item }))), temp_hu_data: "", is_deleted: 0 }, extra || {});

// ---- hdWanted
{
  const w = C.hdWanted({ lines: [
    line("L1", "C1", EA, [pick("B1", 6), pick("B2", 4), pick("B1", 1)]),
    line("L2", "C2", EA, [pick("B1", 3, { batch_id: "T9" }), pick("B3", 2, { category: "Blocked" })]),
    line("L3", "SN", EA, [pick("B1", 1)]),
    line("L4", "NS", EA, []),
    line("L5", "C2", EA, [pick("B1", 2)], { temp_hu_data: JSON.stringify([{ handling_unit_id: "H1", sm_quantity: 2 }]) }),
    line("L6", "C2", EA, [pick("B1", 2, { handling_unit_id: "H2" }), pick("B4", 0), pick("B5", 3, { category: "Reserved" })]),
    line("L7", "C2", EA, [pick("B1", 5)], { is_deleted: 1 }),
    line("L8", "C2", CTN, [pick("B1", 1)]),
  ], items: items });
  eq("hdWanted: loose picks of stock lines, one fragment per line + material + bin + batch + category + unit, summed", w.fragments.map((f) => [f.key, f.qty, f.uomId]), [
    ["L1|C1|B1||Unrestricted|77", 7, EA], ["L1|C1|B2||Unrestricted|77", 4, EA], ["L2|C2|B1|T9|Unrestricted|77", 3, EA], ["L2|C2|B3||Blocked|77", 2, EA],
    ["L5|C2|B1||Unrestricted|77", 2, EA]]);
  eq("hdWanted: what is not held and why (serial, non-stock, handling unit, an unholdable category)", w.notHeld.map((x) => [x.lineId, x.reason]),
    [["L3", "SERIAL"], ["L4", "NON_STOCK"], ["L5", "HANDLING_UNIT"], ["L6", "HANDLING_UNIT"], ["L6", "CATEGORY"], ["L8", "UOM"]]);
}
// ---- an item the IA's items read did not return (unknown, or not a numeric id): never held, never reaches SQL
{
  const w = C.hdWanted({ lines: [line("L1", "1) OR 1=1 --", EA, [pick("B1", 2)]), line("L2", "C9", EA, [pick("B1", 1)])], items: items });
  eq("hdWanted: an unknown item is not held (reason ITEM)", [w.fragments.length, w.notHeld.map((x) => [x.lineId, x.reason])], [0, [["L1", "ITEM"], ["L2", "ITEM"]]]);
}
// ---- hdHeld: the IA's own Allocated rows by key
const row = (id, lineId, mat, bin, batch, cat, qty, status) => ({ id: id, doc_line_id: lineId, material_id: mat, bin_location: bin, batch_id: batch, from_category: cat,
  open_qty: String(qty), reserved_qty: String(qty), item_uom: EA, status: status || "Allocated", job_line_key: "" });
{
  const h = C.hdHeld([row("R1", "L1", "C1", "B1", null, "Unrestricted", 5), row("R2", "L1", "C1", "B1", "", "Unrestricted", 2), row("R3", "L2", "C2", "B1", "T9", "Unrestricted", 3, "Cancelled"),
    row("R4", "L2", "C2", "B3", null, "Blocked", 2, "Processing")]);
  eq("hdHeld: Allocated rows only, null and empty batch alike", Object.keys(h).map((k) => [k, h[k].qty, h[k].rows.map((r) => r.id)]), [["L1|C1|B1||Unrestricted|77", 7, ["R1", "R2"]]]);
}
// ---- hdDelta
const frag = (lineId, mat, bin, qty, extra) => Object.assign({ key: lineId + "|" + mat + "|" + bin + "||Unrestricted|" + EA, lineId: lineId, materialId: mat, binId: bin, batchId: "",
  cat: "Unrestricted", qty: qty, uomId: EA }, extra || {});
{
  const held = C.hdHeld([row("R1", "L1", "C1", "B1", null, "Unrestricted", 7), row("R2", "L1", "C1", "B2", null, "Unrestricted", 4), row("R3", "L2", "C2", "B1", null, "Unrestricted", 3)]);
  const d = C.hdDelta([frag("L1", "C1", "B1", 7), frag("L1", "C1", "B2", 10), frag("L2", "C2", "B1", 1), frag("L9", "C2", "B5", 2)], held);
  eq("hdDelta: unchanged -> nothing; more -> only the difference held; a new fragment held", d.holds.map((h) => [h.key, h.qty]), [["L1|C1|B2||Unrestricted|77", 6], ["L9|C2|B5||Unrestricted|77", 2]]);
  eq("hdDelta: less -> its rows closed, a row for what stays", d.releases.map((r) => [r.key, r.rows.map((x) => x.id), r.releaseQty, r.keepQty]), [["L2|C2|B1||Unrestricted|77", ["R3"], 2, 1]]);
  const all = C.hdDelta([], held);
  eq("hdDelta: nothing wanted (RELEASE_ALL, a deleted Draft) -> every own row released, nothing kept", all.releases.map((r) => [r.key, r.releaseQty, r.keepQty]),
    [["L1|C1|B1||Unrestricted|77", 7, 0], ["L1|C1|B2||Unrestricted|77", 4, 0], ["L2|C2|B1||Unrestricted|77", 3, 0]]);
  eq("hdDelta: removed fragment -> released whole", C.hdDelta([frag("L1", "C1", "B1", 7), frag("L1", "C1", "B2", 4)], held).releases.map((r) => [r.key, r.releaseQty, r.keepQty]),
    [["L2|C2|B1||Unrestricted|77", 3, 0]]);
}
// ---- hdCap: only what is free, in the line's unit; lines sharing one bin take it in line order
{
  const bal = [{ material_id: "C1", location_id: "B1", batch_id: null, unrestricted_qty: "30", block_qty: "0" }, { material_id: "C2", location_id: "B1", batch_id: null, unrestricted_qty: "5", block_qty: "4" },
    { material_id: "C2", location_id: "B1", batch_id: "T9", unrestricted_qty: "2", block_qty: "0" }];
  const holds = [{ key: "a", frag: frag("L1", "C1", "B1", 3, { uomId: CTN }), qty: 3 }, { key: "b", frag: frag("L2", "C2", "B1", 4), qty: 4 },
    { key: "c", frag: frag("L3", "C2", "B1", 4), qty: 4 }, { key: "d", frag: frag("L4", "C2", "B1", 9, { cat: "Blocked" }), qty: 9 },
    { key: "e", frag: frag("L5", "C2", "B1", 5, { batchId: "T9" }), qty: 5 }, { key: "f", frag: frag("L6", "C9", "B1", 1), qty: 1 }];
  const c = C.hdCap(holds, bal, items);
  eq("hdCap: 30 EA free = 2.5 CTN; 5 free shared in line order (4, then 1); Blocked from block_qty; a batch from its batch row; no balance -> 0",
    c.holds.map((h) => [h.key, h.qty]), [["a", 2.5], ["b", 4], ["c", 1], ["d", 4], ["e", 2]]);
  eq("hdCap: the shortfall per hold (in the line's unit)", c.short.map((x) => [x.key, x.short]), [["a", 0.5], ["c", 3], ["d", 5], ["e", 3], ["f", 1]]);
  // the IA's own released stock is free again for its other lines (the release runs first in the same operation)
  const moved = C.hdCap([{ key: "g", frag: frag("L2", "C2", "B1", 6), qty: 6 }], [bal[1]], items,
    [{ key: "x", releaseQty: 3, frag: { lineId: "L1", materialId: "C2", binId: "B1", batchId: "", cat: "Unrestricted", uomId: EA } }]);
  eq("hdCap: 5 free + 3 released by another line = 6 held", moved.holds.map((h) => [h.key, h.qty]), [["g", 6]]);
}
// ---- hdMoves: a hold = from its category into Reserved (no costing); a release = back
{
  const ctx = { iaNo: "IA-0001", plantId: "P1", orgId: "O1", docDate: "2026-10-21 00:00:00" };
  const m = C.hdMoves([{ frag: frag("L1", "C1", "B1", 2.5, { uomId: CTN, batchId: "T9" }), qty: 2.5 }], [{ key: "k", rows: [row("R3", "L2", "C2", "B1", null, "Blocked", 3)], releaseQty: 2, keepQty: 1,
    frag: { materialId: "C2", binId: "B1", batchId: "", cat: "Blocked", uomId: EA } }], ctx);
  eq("hdMoves: releases first (their stock is free for the holds), then holds; release = SUBTRACT Reserved + ADD Blocked, hold = SUBTRACT Unrestricted + ADD Reserved priced from it; IA-H; isMovingInv 1",
    m.map((x) => [x.movement_key, x.direction, x.material_id, x.location_id, x.batch_id, x.quantity, x.material_uom, x.inventory_category, x.isMovingInv, x.unit_price_from || "", x.transaction_type, x.trx_no]),
    [["X1", "SUBTRACT", "C2", "B1", null, 2, EA, "Reserved", 1, "", "IA-H", "IA-0001/H"], ["X1.2", "ADD", "C2", "B1", null, 2, EA, "Blocked", 1, "X1", "IA-H", "IA-0001/H"],
      ["H1", "SUBTRACT", "C1", "B1", "T9", 2.5, CTN, "Unrestricted", 1, "", "IA-H", "IA-0001/H"], ["H1.2", "ADD", "C1", "B1", "T9", 2.5, CTN, "Reserved", 1, "H1", "IA-H", "IA-0001/H"]]);
  // the hold moves never carry the IA's own number: the classic receipt price sums every OUT movement under it (trx_no + OUT only),
  // and a Manual-numbered IA keeps its number from Draft to Completed
  eq("hdMoves: the document number is the IA's + /H", m.every((x) => x.trx_no === "IA-0001/H"), true);
  eq("hdMoves: plant, organisation, date on every move", m.every((x) => x.plant_id === "P1" && x.organization_id === "O1" && x.doc_date === ctx.docDate), true);
}
// ---- hdRows: Processing rows for new holds and kept remainders, the released rows marked Releasing
{
  const ia = { id: "IA1", no: "IA-0001", plantId: "P1", orgId: "O1" };
  const r = C.hdRows([{ frag: frag("L1", "C1", "B1", 2, { batchId: "T9" }), qty: 2 }], [{ key: "k", rows: [row("R3", "L2", "C2", "B1", null, "Unrestricted", 3)], releaseQty: 2, keepQty: 1,
    frag: { lineId: "L2", materialId: "C2", binId: "B1", batchId: "", cat: "Unrestricted", uomId: EA } }], ia, "IAH|IA1|4", "2026-10-21 12:00:00");
  eq("hdRows: new rows Processing (the IA, its line, bin, batch, unit, from_category, create-once key); no SO line, no GD",
    r.add.map((x) => [x.doc_type, x.status, x.doc_id, x.doc_no, x.doc_line_id, x.material_id, x.bin_location, x.batch_id, x.item_uom, x.reserved_qty, x.open_qty, x.delivered_qty, x.from_category,
      x.job_line_key, x.parent_line_id, x.target_gd_id, x.source_reserved_id]),
    [["Item Assembly", "Processing", "IA1", "IA-0001", "L1", "C1", "B1", "T9", EA, "2.00000000", "2.00000000", "0.00000000", "Unrestricted", "IAH|IA1|4|1", "", "", ""],
      ["Item Assembly", "Processing", "IA1", "IA-0001", "L2", "C2", "B1", null, EA, "1.00000000", "1.00000000", "0.00000000", "Unrestricted", "IAH|IA1|4|2", "", "", "R3"]]);
  eq("hdRows: the released rows -> Releasing (same op key)", r.mark.map((x) => [x.id, x.status, x.job_line_key]), [["R3", "Releasing", "IAH|IA1|4|R3"]]);
}
// ---- hdFinish: after the engine answer
{
  const rows = [{ id: "N1", status: "Processing" }, { id: "N2", status: "Processing" }, { id: "R3", status: "Releasing", open_qty: "3", reserved_qty: "3" }];
  const done = C.hdFinish("DONE", rows);
  eq("hdFinish DONE: new rows Allocated, released rows Cancelled (open 0, reserved kept)", [done.publish.map((x) => [x.id, x.status]), done.close.map((x) => [x.id, x.status, x.open_qty, x.reserved_qty])],
    [[["N1", "Allocated"], ["N2", "Allocated"]], [["R3", "Cancelled", "0.00000000", "3"]]]);
  const none = C.hdFinish("NOTHING", rows);
  eq("hdFinish NOTHING (refused, nothing moved): new rows soft-deleted, released rows back to Allocated", [none.drop.map((x) => [x.id, x.is_deleted]), none.restore.map((x) => [x.id, x.status])],
    [[["N1", 1], ["N2", 1]], [["R3", "Allocated"]]]);
  const unsure = C.hdFinish("UNCERTAIN", rows);
  eq("hdFinish UNCERTAIN: nothing touched (the next run resolves it)", [unsure.publish.length, unsure.close.length, unsure.drop.length, unsure.restore.length], [0, 0, 0, 0]);
}
// ---- hdRecover: rows a dead run left Processing / Releasing, resolved from the engine's own record of that operation
{
  const left = [{ id: "N1", status: "Processing", job_line_key: "IAH|101|4|1" }, { id: "R3", status: "Releasing", job_line_key: "IAH|101|4|R3" }];
  eq("hdRecover: the operations to look up", C.hdOpsOf(left), ["IAH|101|4"]);
  eq("hdRecover: the engine recorded DONE -> finish (publish + close)", C.hdRecover(left, { "IAH|101|4": { done: 1, intents: 3 } }).map((x) => [x.op, x.outcome]), [["IAH|101|4", "DONE"]]);
  eq("hdRecover: no intent at all -> nothing moved: roll back", C.hdRecover(left, { "IAH|101|4": { done: 0, intents: 0 } }).map((x) => [x.op, x.outcome]), [["IAH|101|4", "NOTHING"]]);
  eq("hdRecover: intents without DONE -> uncertain: Needs review", C.hdRecover(left, { "IAH|101|4": { done: 0, intents: 2 } }).map((x) => [x.op, x.outcome]), [["IAH|101|4", "UNCERTAIN"]]);
  // a key this workflow never makes (tampered, or another writer's) is never looked up nor touched
  eq("hdRecover: a foreign key is left alone", C.hdOpsOf([{ id: "N9", status: "Processing", job_line_key: "X') OR ('1|1" }, { id: "N8", status: "Releasing", job_line_key: "IAH|IA1|4|R3" }]), []);
}
// ---- hdClose: after completion, what it issued from Reserved (base units, per material + bin + batch) closes the own rows in id
// order (used -> Delivered, partly used -> Delivered for the used part + a remainder to release), the rest is released
{
  const rows = [row("R1", "L1", "C1", "B1", null, "Unrestricted", 2), row("R2", "L2", "C1", "B1", null, "Unrestricted", 3), row("R3", "L3", "C2", "B1", null, "Blocked", 4),
    Object.assign(row("R4", "L4", "C1", "B2", null, "Unrestricted", 1), { item_uom: CTN })];
  const c = C.hdClose(rows, { ["C1|B1|"]: 4, ["C2|B1|"]: 0, ["C1|B2|"]: 12 }, items);
  eq("hdClose: 4 issued at C1/B1 -> R1 delivered whole (2), R2 delivered 2 of 3; R4 (1 CTN = 12 EA) delivered whole",
    c.deliver.map((x) => [x.id, x.status, x.delivered_qty, x.reserved_qty, x.open_qty]),
    [["R1", "Delivered", "2.00000000", "2.00000000", "0.00000000"], ["R2", "Delivered", "2.00000000", "2.00000000", "0.00000000"], ["R4", "Delivered", "1.00000000", "1.00000000", "0.00000000"]]);
  eq("hdClose: R2's unused 1 and R3's 4 (nothing issued) to release, back to their category", c.releases.map((r) => [r.source, r.whole, r.releaseQty, r.frag.cat]),
    [["R2", false, 1, "Unrestricted"], ["R3", true, 4, "Blocked"]]);
  eq("hdClose: nothing issued beyond the holds", c.over, []);
  const over = C.hdClose([rows[0]], { ["C1|B1|"]: 5 }, items);
  eq("hdClose: more issued from Reserved than held -> named (another owner's stock, or drift)", over.over.map((x) => [x.key, x.qty]), [["C1|B1|", 3]]);
  const w = C.hdCloseRows(c, { id: "IA1", no: "IA-9", plantId: "P1", orgId: "O1" }, "IAH|IA1|2", "2026-10-21 13:00:00");
  eq("hdCloseRows: a whole release marks its row Releasing; a partly used row's remainder is a new row, Releasing from the start",
    [w.mark, w.add.map((x) => [x.status, x.source_reserved_id, x.doc_line_id, x.open_qty, x.reserved_qty, x.from_category, x.job_line_key])],
    [[{ id: "R3", status: "Releasing", job_line_key: "IAH|IA1|2|R3" }], [["Releasing", "R2", "L2", "1.00000000", "1.00000000", "Unrestricted", "IAH|IA1|2|1"]]]);
}
// ---- hdNet: what the completion issued from Reserved less what this cycle's Delivered rows already account for, so a re-run of
// CLOSE (after a refused release, or a dead run) never delivers the same consumption twice
{
  const read = [{ kind: "OUT", key: "C1|B1|", base: "4" }, { kind: "OUT", key: "C1|B2|", base: "12" }, { kind: "OUT", key: "C2|B1|T9", base: "1" },
    { kind: "DELIVERED", id: "R1", material_id: "C1", bin_location: "B1", batch_id: null, item_uom: EA, delivered_qty: "2.00000000" },
    { kind: "DELIVERED", id: "R4", material_id: "C1", bin_location: "B2", batch_id: null, item_uom: CTN, delivered_qty: "1.00000000" }];
  const t = C.hdNet(read, items);
  eq("hdNet: issued less delivered, in base units (1 CTN delivered = 12 EA)", [t.net, t.under], [{ "C1|B1|": 2, "C1|B2|": 0, "C2|B1|T9": 1 }, []]);
  const u = C.hdNet([{ kind: "DELIVERED", id: "R1", material_id: "C1", bin_location: "B1", batch_id: null, item_uom: EA, delivered_qty: "3" }], items);
  eq("hdNet: more delivered than issued -> named, counted as nothing left", [u.net, u.under], [{ "C1|B1|": 0 }, [{ key: "C1|B1|", qty: 3 }]]);
}
// ---- hdStatus: required versus held per line; the label
{
  const ls = [line("L1", "C1", EA, [pick("B1", 6)], { required_qty: "10" }), line("L2", "C2", EA, [pick("B1", 3)], { required_qty: null, requested_qty: "3" }),
    line("L3", "SN", EA, [pick("B1", 1)], { required_qty: "1" })];
  const held = [row("R1", "L1", "C1", "B1", null, "Unrestricted", 6), row("R2", "L2", "C2", "B1", null, "Unrestricted", 3)];
  const st = C.hdStatus(ls, held, items);
  eq("hdStatus: per line required / reserved / short; no required_qty -> the line quantity; serial not reservable", st.lines.map((x) => [x.lineId, x.required, x.reserved, x.short, x.reason]),
    [["L1", 10, 6, 4, ""], ["L2", 3, 3, 0, ""], ["L3", 1, 0, 0, "SERIAL"]]);
  eq("hdStatus: some short -> PARTIAL", st.status, "PARTIAL");
  eq("hdStatus: all covered -> FULL", C.hdStatus([ls[1]], [held[1]], items).status, "FULL");
  eq("hdStatus: nothing held while something is required -> SHORT", C.hdStatus([ls[0]], [], items).status, "SHORT");
  eq("hdStatus: no reservable line -> NONE", C.hdStatus([ls[2]], [], items).status, "NONE");
  // review M3: NONE means nothing held (a completed IA labelled NONE is never closed again)
  eq("hdStatus: nothing required (Required typed 0) but its picks held -> FULL, not NONE",
    C.hdStatus([line("L1", "C1", EA, [pick("B1", 2)], { required_qty: "0" })], [row("R1", "L1", "C1", "B1", null, "Unrestricted", 2)], items).status, "FULL");
}
// ---- review M2: the line's unit is part of the hold key: a changed unit releases the old hold whole and holds the new quantity
{
  const ctn = Object.assign(row("R1", "L1", "C1", "B1", null, "Unrestricted", 1), { item_uom: CTN });
  const d = C.hdDelta(C.hdWanted({ lines: [line("L1", "C1", EA, [pick("B1", 12)])], items: items }).fragments, C.hdHeld([ctn]));
  eq("hdDelta: 1 CTN held, 12 EA now wanted -> the carton hold released whole and 12 EA held (never 11 EA more on top)",
    [d.holds.map((h) => [h.frag.uomId, h.qty]), d.releases.map((r) => [r.rows.map((x) => x.id), r.releaseQty, r.keepQty, r.frag.uomId])], [[[EA, 12]], [[["R1"], 1, 0, CTN]]]);
}
// ---- review M1: CLOSE attributes what the completion issued from Reserved by the completion's own split (line + category), so a
// Blocked hold is never delivered for an Unrestricted pick; without it (or beyond it) id order, as before
{
  const rows = [row("R1", "L1", "C1", "B1", null, "Blocked", 5), row("R2", "L1", "C1", "B1", null, "Unrestricted", 5)];
  const c = C.hdClose(rows, { ["C1|B1|"]: 5 }, items, { ["L1|C1|B1||Unrestricted"]: 5 });
  eq("hdClose by the split: the Unrestricted hold delivered, the older Blocked one released back to Blocked",
    [c.deliver.map((x) => [x.id, x.delivered_qty]), c.releases.map((r) => [r.source, r.whole, r.frag.cat])], [[["R2", "5.00000000"]], [["R1", true, "Blocked"]]]);
  eq("hdClose without the split: id order (as before)", C.hdClose(rows, { ["C1|B1|"]: 5 }, items).deliver.map((x) => x.id), ["R1"]);
  const more = C.hdClose(rows, { ["C1|B1|"]: 7 }, items, { ["L1|C1|B1||Unrestricted"]: 5 });
  eq("hdClose: issued beyond the split's attribution -> the rest in id order", more.deliver.map((x) => [x.id, x.delivered_qty]), [["R1", "2.00000000"], ["R2", "5.00000000"]]);
  const ctn = C.hdClose([Object.assign(row("R3", "L2", "C1", "B2", null, "Blocked", 1), { item_uom: CTN }), row("R4", "L2", "C1", "B2", null, "Unrestricted", 12)],
    { ["C1|B2|"]: 12 }, items, { ["L2|C1|B2||Unrestricted"]: 12 });
  eq("hdClose by the split, in base units: 12 EA attributed to the EA hold, the 1 CTN Blocked hold released", [ctn.deliver.map((x) => x.id), ctn.releases.map((r) => r.source)], [["R4"], ["R3"]]);
}
console.log((fails ? "FAILED " + fails : "ok") + " - " + n + " checks");
process.exit(fails ? 1 : 0);

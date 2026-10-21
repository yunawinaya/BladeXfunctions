// Small Cycle (scratchpad/iasc): RES-01 - this IA's own holds (its Allocated on_reserved_gd rows, doc_type Item Assembly) are its
// own stock: its auto-allocation and its Transfer Stock picker add them back to the free stock they read (the hold moved them to
// Reserved). Another document's holds never. Only a stored IA that reserves (page Edit, a hold status: a clone carries its source's id
// and status, review I2), whatever the switch (it only makes holds, review I4); any other IA: nothing added.
const resOwnId = (v) => {
  const s = (x) => (x === undefined || x === null ? "" : String(x));
  const id = s(v && v.id);
  return v && s(v.page_status) === "Edit" && s(v.material_hold_status) !== "" && /^[0-9]{1,20}$/.test(id) ? id : "";
};
// the form read only when the reservations already read hold an Item Assembly's row (an IA that never reserved keeps v36's calls)
const resOwnIdOf = (rows, values) => ((Array.isArray(rows) ? rows : []).some((r) => r && String(r.doc_type) === "Item Assembly") ? resOwnId(values()) : "");
// the base quantity this IA holds at material + bin + batch from one category (Unrestricted / Blocked)
const resOwnHeld = (rows, iaId, materialId, binId, batchId, category, item) => {
  const s = (v) => String(v && typeof v === "object" && v.dict_key !== undefined ? v.dict_key : v === undefined || v === null ? "" : v);
  if (!/^[0-9]{1,20}$/.test(s(iaId))) return 0;
  let base = 0;
  (Array.isArray(rows) ? rows : []).forEach((r) => {
    if (!r || Number(r.is_deleted) === 1 || s(r.doc_type) !== "Item Assembly" || s(r.doc_id) !== s(iaId) || s(r.status) !== "Allocated" || s(r.handling_unit_id)) return;
    if ((s(r.from_category) || "Unrestricted") !== category || s(r.material_id) !== s(materialId) || s(r.bin_location) !== s(binId) || s(r.batch_id) !== s(batchId)) return;
    const uom = s(r.item_uom);
    const conv = item && uom && uom !== s(item.based_uom) ? (Array.isArray(item.table_uom_conversion) ? item.table_uom_conversion : []).find((c) => s(c && c.alt_uom_id) === uom) : null;
    base += (parseFloat(r.open_qty) || 0) * (conv && parseFloat(conv.base_qty) > 0 ? parseFloat(conv.base_qty) : 1);
  });
  return base;
};
// -- end Small Cycle --

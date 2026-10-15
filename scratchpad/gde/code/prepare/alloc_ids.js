// GD Edit V2 - the edit's rows that may need GOODS_DELIVERY's save-time auto allocation (code_node_kJx9p9Nh: gd_qty > 0, no
// temp_qty_data, a material) as digit lists for the allocation reads: the materials of such rows (a patched line's new material
// too) and the stored lines whose temp_qty_data the edit empties (their stored material is read). A superset; the loop filters.
const geAllocIds = function geAllocIds(rows, patches) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const digits = (v) => /^[0-9]{1,20}$/.test(s(v));
  const noTemp = (v) => s(v) === "" || s(v) === "[]";
  const mats = new Set(), lines = new Set();
  for (const r of rows || []) if (r && digits(r.material_id) && Number(r.gd_qty) > 0 && noTemp(r.temp_qty_data)) mats.add(s(r.material_id));
  for (const l of patches || []) {
    const c = (l && l.cells) || {};
    if (digits(c.material_id)) mats.add(s(c.material_id));
    const emptied = (Object.prototype.hasOwnProperty.call(c, "temp_qty_data") && noTemp(c.temp_qty_data)) || (l.drop || []).indexOf("temp_qty_data") >= 0;
    if (emptied && digits(l.id)) lines.add(s(l.id));
  }
  const sql = (set) => (set.size ? [...set].join(",") : "0");
  return { deltaAllocMaterialIdsSql: sql(mats), deltaAllocLineIdsSql: sql(lines) };
};
